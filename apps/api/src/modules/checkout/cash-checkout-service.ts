import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { DomainValidationError, IdempotencyConflictError, NotFoundError } from '../orders/errors.js';
import type { OrdersService } from '../orders/orders-service.js';
import { PaymentsService } from '../payments/payments-service.js';
import { SettlementService } from '../settlement/settlement-service.js';

const cashCheckoutSchema = z
  .object({
    orderId: z.string().uuid(),
    cashShiftId: z.string().uuid(),
    tenderedMinor: z.string().regex(/^\d+$/),
    idempotencyKey: z.string().min(1),
    actorId: z.string().uuid(),
    deviceId: z.string().uuid(),
  })
  .strict();

/** ADR-0033 P0 cash checkout, using PAY1.1 Payment and S1.1 Settlement. */
export class CashCheckoutService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementService,
  ) {}

  async checkout(raw: unknown) {
    const input = cashCheckoutSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.idempotencyKey]);

      const prior = await client.query<{
        order_id: string;
        cash_shift_id: string;
        tendered_minor: string;
        payable_minor: string;
        currency_code: string;
        minor_unit_exponent: number;
      }>(
        `SELECT order_id, cash_shift_id, tendered_minor, payable_minor,
                currency_code, minor_unit_exponent
         FROM cash_checkout_idempotency
         WHERE idempotency_key = $1
           AND legal_entity_id = (SELECT legal_entity_id FROM sales_order WHERE order_id = $2)
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.idempotencyKey, input.orderId],
      );
      if (prior.rows[0]) {
        const row = prior.rows[0];
        if (
          row.order_id !== input.orderId ||
          row.cash_shift_id !== input.cashShiftId ||
          row.tendered_minor !== input.tenderedMinor
        ) {
          throw new IdempotencyConflictError(
            input.idempotencyKey,
            'Cash checkout key reused with different order, shift, or tendered amount',
          );
        }
        const currentSettlement = await this.settlements.getLiveSettlementForOrder(input.orderId);
        if (
          !currentSettlement ||
          row.payable_minor !== currentSettlement.customerPayableMinor ||
          row.currency_code !== currentSettlement.currencyCode ||
          row.minor_unit_exponent !== currentSettlement.minorUnitExponent
        ) {
          throw new IdempotencyConflictError(
            input.idempotencyKey,
            'Cash checkout key reused with different payable or currency semantics',
          );
        }
        await client.query('COMMIT');
        return this.loadResult(input.orderId);
      }

      // OpenSettlement has its own canonical transaction and must run before
      // this transaction locks the Order row.
      const opened =
        (await this.settlements.getLiveSettlementForOrder(input.orderId)) ??
        (await this.settlements.openSettlement({
          orderId: input.orderId,
          idempotencyKey: `cash-checkout:settlement:${input.idempotencyKey}`,
          actorId: input.actorId,
          deviceId: input.deviceId,
        }));
      if (opened.state !== 'COLLECTING') {
        throw new DomainValidationError('SETTLEMENT_NOT_PAYABLE', `Settlement is ${opened.state}`);
      }

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
      if (shift.cashier_id !== input.actorId) {
        throw new DomainValidationError('CASHIER_CONTEXT_MISMATCH', 'Cashier does not belong to CashShift context');
      }
      if (shift.device_id !== input.deviceId) {
        throw new DomainValidationError('DEVICE_CONTEXT_MISMATCH', 'Device does not belong to CashShift context');
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
         FROM settlement_check WHERE settlement_group_id = $1`,
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

      await client.query(
        `INSERT INTO cash_checkout_idempotency (
           cash_checkout_idempotency_id, tenant_id, legal_entity_id, order_id,
           cash_shift_id, settlement_check_id, idempotency_key, payable_minor,
           tendered_minor, currency_code, minor_unit_exponent
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(), order.tenant_id, order.legal_entity_id, input.orderId,
          input.cashShiftId, checkRow.settlement_check_id, input.idempotencyKey,
          checkRow.customer_payable_minor, input.tenderedMinor, shift.currency_code,
          shift.minor_unit_exponent,
        ],
      );

      const tender = await this.payments.ensureTenderDefinition({
        tenantId: order.tenant_id,
        legalEntityId: order.legal_entity_id,
        code: 'CASH',
        displayName: 'Cash',
        railIdentity: 'CASH',
        instrumentFamily: 'CASH',
      });
      const payment = await this.payments.createPayment({
        tenderDefinitionId: tender.tenderDefinitionId,
        createIdempotencyKey: input.idempotencyKey,
        merchantPaymentReference: `cash:${input.orderId}:${input.idempotencyKey}`,
        requestedAmountMinor: checkRow.customer_payable_minor,
        currencyCode: shift.currency_code,
        minorUnitExponent: shift.minor_unit_exponent,
        settlementCheckId: checkRow.settlement_check_id,
      });
      const outcome = await this.payments.recordVerifiedProviderOutcome({
        paymentId: payment.paymentId,
        providerEventIdentity: `cash:${input.idempotencyKey}`,
        rawProviderStatus: 'CASH_ACCEPTED',
        normalizedOutcome: 'SUCCEEDED',
        verificationStatus: 'VERIFIED',
        reconciliationOrigin: 'SYSTEM',
        merchantRequestIdentity: payment.merchantPaymentReference,
        evidenceAmountMinor: checkRow.customer_payable_minor,
        evidenceCurrencyCode: shift.currency_code,
        diagnosticMetadata: {
          cashShiftId: input.cashShiftId,
          orderId: input.orderId,
          tenderedMinor: input.tenderedMinor,
          changeMinor,
        },
        allocateToCheckId: checkRow.settlement_check_id,
        allocationIdempotencyKey: `cash-allocation:${input.idempotencyKey}`,
      });
      const authoritativeSettlement = await this.settlements.reconcileSettlementCoverage(opened.settlementGroupId);
      if (authoritativeSettlement.state !== 'SATISFIED') {
        throw new DomainValidationError('SETTLEMENT_NOT_SATISFIED', 'Cash Payment did not satisfy the Settlement');
      }

      await client.query(
        `UPDATE cash_checkout_idempotency SET payment_id = $2
         WHERE legal_entity_id = $1 AND idempotency_key = $3`,
        [order.legal_entity_id, outcome.payment.paymentId, input.idempotencyKey],
      );
      await client.query(
        `INSERT INTO cash_shift_transaction (
           cash_shift_transaction_id, cash_shift_id, order_id, payment_id,
           transaction_kind, amount_minor, tendered_minor, change_minor, currency_code
         ) VALUES ($1,$2,$3,$4,'SALE',$5,$6,$7,$8)`,
        [randomUUID(), input.cashShiftId, input.orderId, outcome.payment.paymentId, checkRow.customer_payable_minor, input.tenderedMinor, changeMinor, shift.currency_code],
      );
      await client.query(
        `UPDATE sales_order
         SET status = 'SUBMITTED', submitted_at = NOW(), submitted_by = $2,
             actor_id = $2, device_id = $3
         WHERE order_id = $1`,
        [input.orderId, input.actorId, input.deviceId],
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
        [randomUUID(), input.orderId, outcome.payment.paymentId, JSON.stringify(payload)],
      );
      await client.query(
        `INSERT INTO audit_record (
           audit_id, tenant_id, actor_id, aggregate_type, aggregate_id, action,
           before_state, after_state, correlation_id, risk_level
         ) VALUES ($1,$2,$3,'Order',$4,'CASH_CHECKOUT_SUBMITTED',$5::jsonb,$6::jsonb,$7,'NORMAL')`,
        [randomUUID(), order.tenant_id, input.actorId, input.orderId, JSON.stringify({ status: 'OPEN' }), JSON.stringify({ status: 'SUBMITTED', paymentId: outcome.payment.paymentId, settlementGroupId: opened.settlementGroupId }), randomUUID()],
      );
      await client.query('COMMIT');
      return this.loadResult(input.orderId);
    } catch (err) {
      await client.query('ROLLBACK');
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
       WHERE sg.order_id = $1 ORDER BY sg.settlement_group_id DESC LIMIT 1`,
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
}
