import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { DomainValidationError, IdempotencyConflictError, NotFoundError } from '../orders/errors.js';
import type { OrdersService } from '../orders/orders-service.js';
import { SettlementService } from '../settlement/settlement-service.js';

const cashCheckoutSchema = z
  .object({
    orderId: z.string().uuid(),
    cashShiftId: z.string().uuid(),
    tenderedMinor: z.string().regex(/^\d+$/),
    idempotencyKey: z.string().min(1),
    actorId: z.string().uuid().optional(),
    deviceId: z.string().uuid().optional(),
  })
  .strict();

/**
 * Counter-service cash path for ADR-0033.
 * Settlement structure is created by the accepted ADR-0032 SettlementService;
 * this service owns only the cash Payment, allocation, submit transition,
 * production task creation, and receipt source record.
 */
export class CashCheckoutService {
  private readonly settlements: SettlementService;

  constructor(
    private readonly pool: pg.Pool,
    private readonly orders: OrdersService,
  ) {
    this.settlements = new SettlementService(pool);
  }

  async checkout(raw: unknown) {
    const input = cashCheckoutSchema.parse(raw);
    const prior = await this.pool.query<{ payment_id: string }>(
      `SELECT p.payment_id
       FROM payment p
       JOIN cash_shift_transaction tx ON tx.payment_id = p.payment_id
       WHERE tx.cash_shift_id = $1 AND p.create_idempotency_key = $2`,
      [input.cashShiftId, input.idempotencyKey],
    );
    if (prior.rowCount === 1) return this.loadResult(input.orderId);

    const opened =
      (await this.settlements.getLiveSettlementForOrder(input.orderId)) ??
      (await this.settlements.openSettlement({
        orderId: input.orderId,
        idempotencyKey: `cash-checkout:settlement:${input.idempotencyKey}`,
        actorId: input.actorId ?? null,
        deviceId: input.deviceId ?? null,
      }));
    if (opened.state !== 'COLLECTING') {
      throw new DomainValidationError('SETTLEMENT_NOT_PAYABLE', `Settlement is ${opened.state}`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await this.lockOrder(client, input.orderId);
      if (order.status !== 'OPEN') {
        throw new DomainValidationError('ORDER_NOT_OPEN', 'Only OPEN orders can be paid and submitted');
      }
      const shift = await this.lockShift(client, input.cashShiftId);
      if (shift.status !== 'OPEN') throw new DomainValidationError('CASH_SHIFT_NOT_OPEN', 'CashShift must be OPEN');
      if (
        shift.tenant_id !== order.tenant_id ||
        shift.legal_entity_id !== order.legal_entity_id ||
        shift.outlet_id !== order.outlet_id
      ) {
        throw new DomainValidationError('CASH_SHIFT_CONTEXT_MISMATCH', 'CashShift does not belong to Order context');
      }
      if (shift.currency_code !== opened.currencyCode || shift.minor_unit_exponent !== opened.minorUnitExponent) {
        throw new DomainValidationError('CURRENCY_MISMATCH', 'CashShift and Settlement currencies do not match');
      }

      const check = await client.query<{
        settlement_check_id: string;
        settlement_group_id: string;
        state: string;
        customer_payable_minor: string;
      }>(
        `SELECT settlement_check_id, settlement_group_id, state, customer_payable_minor
         FROM settlement_check WHERE settlement_group_id = $1 FOR UPDATE`,
        [opened.settlementGroupId],
      );
      const checkRow = check.rows[0];
      if (!checkRow) throw new NotFoundError('Settlement Check not found');
      if (checkRow.state !== 'COLLECTING') {
        throw new DomainValidationError('SETTLEMENT_NOT_PAYABLE', `Check is ${checkRow.state}`);
      }
      const payableMinor = BigInt(checkRow.customer_payable_minor);
      const tenderedMinor = BigInt(input.tenderedMinor);
      if (payableMinor === 0n) {
        throw new DomainValidationError('ZERO_PAYABLE_NO_PAYMENT', 'Zero-payable checkout must not create a fake cash Payment');
      }
      if (tenderedMinor < payableMinor) {
        throw new DomainValidationError('CASH_UNDERPAYMENT', 'Tendered cash is less than Customer Payable');
      }
      const changeMinor = (tenderedMinor - payableMinor).toString();
      const paymentId = randomUUID();
      const tender = await this.ensureCashTenderDefinition(client, {
        tenantId: order.tenant_id,
        legalEntityId: order.legal_entity_id,
      });

      await client.query(
        `INSERT INTO payment (
           payment_id, tenant_id, legal_entity_id, tender_definition_id,
           currency_code, minor_unit_exponent, requested_amount_minor,
           lifecycle_state, create_idempotency_key, merchant_payment_reference,
           reconciliation_state
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'SUCCEEDED',$8,$9,'NONE')`,
        [
          paymentId,
          order.tenant_id,
          order.legal_entity_id,
          tender.tender_definition_id,
          shift.currency_code,
          shift.minor_unit_exponent,
          checkRow.customer_payable_minor,
          input.idempotencyKey,
          `cash:${input.orderId}:${input.idempotencyKey}`,
        ],
      );
      await client.query(
        `INSERT INTO payment_allocation (
           payment_allocation_id, payment_id, settlement_check_id,
           settlement_group_id, tenant_id, legal_entity_id, amount_minor,
           currency_code, minor_unit_exponent, allocation_idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          paymentId,
          checkRow.settlement_check_id,
          checkRow.settlement_group_id,
          order.tenant_id,
          order.legal_entity_id,
          checkRow.customer_payable_minor,
          shift.currency_code,
          shift.minor_unit_exponent,
          `cash-allocation:${input.idempotencyKey}`,
        ],
      );
      await client.query(
        `INSERT INTO cash_shift_transaction (
           cash_shift_transaction_id, cash_shift_id, order_id, payment_id,
           transaction_kind, amount_minor, tendered_minor, change_minor, currency_code
         ) VALUES ($1,$2,$3,$4,'SALE',$5,$6,$7,$8)`,
        [
          randomUUID(),
          input.cashShiftId,
          input.orderId,
          paymentId,
          checkRow.customer_payable_minor,
          input.tenderedMinor,
          changeMinor,
          shift.currency_code,
        ],
      );

      await client.query(
        `UPDATE settlement_check SET state = 'SATISFIED', version = version + 1
         WHERE settlement_check_id = $1`,
        [checkRow.settlement_check_id],
      );
      await client.query(
        `UPDATE settlement_group SET state = 'SATISFIED', version = version + 1, satisfied_at = NOW()
         WHERE settlement_group_id = $1`,
        [checkRow.settlement_group_id],
      );
      await client.query(
        `UPDATE sales_order
         SET status = 'SUBMITTED', submitted_at = NOW(), submitted_by = COALESCE($2, submitted_by),
             actor_id = COALESCE($3, actor_id), device_id = COALESCE($4, device_id)
         WHERE order_id = $1`,
        [input.orderId, input.actorId ?? null, input.actorId ?? null, input.deviceId ?? null],
      );

      const taskRows = await client.query<{
        order_line_id: string;
        catalog_item_id: string;
        catalog_item_name: string;
        quantity: string;
        unit: string;
        modifiers: unknown;
      }>(
        `SELECT l.order_line_id, l.catalog_item_id, c.name AS catalog_item_name,
                l.quantity, l.unit,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'groupLabel', m.group_label, 'optionLabel', m.option_label,
                  'priceDeltaMinor', m.price_delta_minor
                ) ORDER BY m.position) FILTER (WHERE m.order_line_modifier_id IS NOT NULL), '[]'::jsonb) AS modifiers
         FROM sales_order_line l
         JOIN catalog_item c ON c.catalog_item_id = l.catalog_item_id
         LEFT JOIN sales_order_line_modifier m ON m.order_line_id = l.order_line_id
         WHERE l.order_id = $1 AND c.requires_production = TRUE
         GROUP BY l.order_line_id, l.catalog_item_id, c.name, l.quantity, l.unit, l.line_number
         ORDER BY l.line_number`,
        [input.orderId],
      );
      for (const task of taskRows.rows) {
        await client.query(
          `INSERT INTO production_task (
             production_task_id, tenant_id, outlet_id, order_id, order_line_id,
             catalog_item_id, status, quantity, unit, label, modifier_snapshot_json, idempotency_key
           ) VALUES ($1,$2,$3,$4,$5,$6,'IN_PROGRESS',$7,$8,$9,$10::jsonb,$11)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [randomUUID(), order.tenant_id, order.outlet_id, input.orderId, task.order_line_id, task.catalog_item_id, task.quantity, task.unit, task.catalog_item_name, JSON.stringify(task.modifiers), `order-submitted:${input.orderId}:${task.order_line_id}`],
        );
      }

      const receiptLines = await client.query(
        `SELECT l.order_line_id, l.line_number, l.quantity, l.unit,
                c.name AS catalog_item_name, t.resolved_unit_price_minor,
                t.gross_merchandise_minor,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'group', m.group_label, 'option', m.option_label,
                  'priceDeltaMinor', m.price_delta_minor
                ) ORDER BY m.position) FILTER (WHERE m.order_line_modifier_id IS NOT NULL), '[]'::jsonb) AS modifiers
         FROM sales_order_line l
         JOIN catalog_item c ON c.catalog_item_id = l.catalog_item_id
         JOIN sales_order_commercial_line_terms t ON t.order_line_id = l.order_line_id
         LEFT JOIN sales_order_line_modifier m ON m.order_line_id = l.order_line_id
         WHERE l.order_id = $1
         GROUP BY l.order_line_id, l.line_number, l.quantity, l.unit, c.name,
                  t.resolved_unit_price_minor, t.gross_merchandise_minor
         ORDER BY l.line_number`,
        [input.orderId],
      );
      const payload = {
        orderId: input.orderId,
        issuedAt: new Date().toISOString(),
        outletId: order.outlet_id,
        terminalId: shift.device_id,
        cashierId: shift.cashier_id,
        currencyCode: shift.currency_code,
        minorUnitExponent: shift.minor_unit_exponent,
        lines: receiptLines.rows,
        subtotalMinor: opened.merchandiseGrossMinor,
        totalMinor: checkRow.customer_payable_minor,
        paymentMethod: 'CASH',
        cashTenderedMinor: input.tenderedMinor,
        changeMinor,
      };
      await client.query(
        `INSERT INTO receipt (receipt_id, order_id, payment_id, payload_json) VALUES ($1,$2,$3,$4::jsonb)`,
        [randomUUID(), input.orderId, paymentId, JSON.stringify(payload)],
      );
      await client.query(
        `INSERT INTO audit_record (
           audit_id, tenant_id, actor_id, aggregate_type, aggregate_id, action,
           before_state, after_state, correlation_id, risk_level
         ) VALUES ($1,$2,$3,'Order',$4,'CASH_CHECKOUT_SUBMITTED',$5::jsonb,$6::jsonb,$7,'NORMAL')`,
        [randomUUID(), order.tenant_id, input.actorId ?? null, input.orderId, JSON.stringify({ status: 'OPEN' }), JSON.stringify({ status: 'SUBMITTED', paymentId, settlementGroupId: opened.settlementGroupId }), randomUUID()],
      );
      await client.query('COMMIT');
      return this.loadResult(input.orderId);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === '23505') {
        throw new IdempotencyConflictError(input.idempotencyKey, 'Cash checkout conflicts with an existing economic record');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async lockOrder(client: pg.PoolClient, orderId: string) {
    const result = await client.query<{
      order_id: string;
      tenant_id: string;
      legal_entity_id: string;
      outlet_id: string;
      status: string;
    }>(`SELECT order_id, tenant_id, legal_entity_id, outlet_id, status FROM sales_order WHERE order_id = $1 FOR UPDATE`, [orderId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Order not found');
    return row;
  }

  private async lockShift(client: pg.PoolClient, shiftId: string) {
    const result = await client.query<{
      cash_shift_id: string;
      tenant_id: string;
      legal_entity_id: string;
      outlet_id: string;
      cashier_id: string;
      device_id: string;
      status: string;
      currency_code: string;
      minor_unit_exponent: number;
    }>(`SELECT cash_shift_id, tenant_id, legal_entity_id, outlet_id, cashier_id, device_id, status, currency_code, minor_unit_exponent FROM cash_shift WHERE cash_shift_id = $1 FOR UPDATE`, [shiftId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('CashShift not found');
    return row;
  }

  private async loadResult(orderId: string) {
    const order = await this.orders.getOrder(orderId);
    const settlement = await this.pool.query(
      `SELECT sg.settlement_group_id, sg.state AS settlement_state, sg.customer_payable_minor,
              sc.settlement_check_id, sc.state AS check_state, sc.customer_payable_minor AS check_payable_minor
       FROM settlement_group sg
       JOIN settlement_check sc ON sc.settlement_group_id = sg.settlement_group_id
       WHERE sg.order_id = $1`,
      [orderId],
    );
    const payment = await this.pool.query(
       `SELECT p.payment_id, p.lifecycle_state AS status, td.code AS tender_kind,
              p.requested_amount_minor AS amount_minor,
              tx.tendered_minor, tx.change_minor, p.currency_code
       FROM payment p
       JOIN tender_definition td ON td.tender_definition_id = p.tender_definition_id
       JOIN cash_shift_transaction tx ON tx.payment_id = p.payment_id
       JOIN payment_allocation pa ON pa.payment_id = p.payment_id AND pa.active = TRUE
       JOIN settlement_check sc ON sc.settlement_check_id = pa.settlement_check_id
       JOIN settlement_group sg ON sg.settlement_group_id = sc.settlement_group_id
       WHERE sg.order_id = $1 ORDER BY p.created_at DESC LIMIT 1`,
      [orderId],
    );
    const tasks = await this.pool.query(
      `SELECT production_task_id, order_line_id, catalog_item_id, status,
              quantity, unit, label, modifier_snapshot_json
       FROM production_task WHERE order_id = $1 ORDER BY created_at, production_task_id`,
      [orderId],
    );
    const receipt = await this.pool.query<{ payload_json: unknown }>(`SELECT payload_json FROM receipt WHERE order_id = $1`, [orderId]);
    return {
      order,
      settlement: settlement.rows[0] ?? null,
      payment: payment.rows[0] ?? null,
      productionTasks: tasks.rows,
      receipt: receipt.rows[0]?.payload_json ?? null,
    };
  }

  private async ensureCashTenderDefinition(
    client: pg.PoolClient,
    input: { tenantId: string; legalEntityId: string },
  ) {
    const existing = await client.query<{ tender_definition_id: string }>(
      `SELECT tender_definition_id
       FROM tender_definition
       WHERE tenant_id = $1 AND legal_entity_id = $2 AND code = 'CASH'
       FOR UPDATE`,
      [input.tenantId, input.legalEntityId],
    );
    if (existing.rows[0]) return existing.rows[0];
    const tenderDefinitionId = randomUUID();
    await client.query(
      `INSERT INTO tender_definition (
         tender_definition_id, tenant_id, legal_entity_id, code, display_name,
         provider_identity, rail_identity, instrument_family, presentation_capability
       ) VALUES ($1,$2,$3,'CASH','Cash',NULL,'CASH','CASH','NONE')`,
      [tenderDefinitionId, input.tenantId, input.legalEntityId],
    );
    return { tender_definition_id: tenderDefinitionId };
  }
}
