import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { DomainValidationError, IdempotencyConflictError, NotFoundError } from '../orders/errors.js';
import type { OrdersService } from '../orders/orders-service.js';
import { PaymentsService, type PaymentProjection } from '../payments/payments-service.js';
import { SettlementService, type SettlementProjection } from '../settlement/settlement-service.js';

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

type CashCheckoutInput = z.infer<typeof cashCheckoutSchema>;

type CashCommand = {
  cash_checkout_idempotency_id: string;
  tenant_id: string;
  legal_entity_id: string;
  order_id: string;
  cash_shift_id: string;
  settlement_check_id: string | null;
  settlement_group_id: string | null;
  payment_id: string | null;
  idempotency_key: string;
  payable_minor: string | null;
  tendered_minor: string;
  currency_code: string;
  minor_unit_exponent: number;
  actor_id: string;
  device_id: string;
  state: 'RESERVED' | 'PAYMENT_RECONCILED' | 'FINALIZED';
};

type CashCheckoutFailpoint = (point: 'after-payment-reconciliation') => Promise<void> | void;

/** ADR-0033 P0 cash checkout, using PAY1.1 Payment and S1.1 Settlement. */
export class CashCheckoutService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementService,
    private readonly failpoint?: CashCheckoutFailpoint,
  ) {}

  async checkout(raw: unknown) {
    const input = cashCheckoutSchema.parse(raw);
    const command = await this.reserveCommand(input);
    if (command.state === 'FINALIZED') return this.loadResult(input.orderId);

    const opened = await this.getOrOpenSettlement(input, command);
    const check = await this.loadCheck(opened, command);
    this.assertCommandEconomics(command, check, opened);
    await this.persistSettlementBinding(command, opened, check);

    let payment = command.payment_id
      ? await this.payments.getPayment(command.payment_id)
      : await this.payments.getPaymentByCreateIdempotencyKey(command.legal_entity_id, input.idempotencyKey);
    if (!payment) {
      if (opened.state !== 'COLLECTING') {
        throw new DomainValidationError(
          'CHECKOUT_RECOVERY_REQUIRED',
          'Settlement is satisfied but its canonical Payment cannot be recovered',
        );
      }
      const tender = await this.payments.ensureTenderDefinition({
        tenantId: command.tenant_id,
        legalEntityId: command.legal_entity_id,
        code: 'CASH',
        displayName: 'Cash',
        railIdentity: 'CASH',
        instrumentFamily: 'CASH',
      });
      payment = await this.payments.createPayment({
        tenderDefinitionId: tender.tenderDefinitionId,
        createIdempotencyKey: input.idempotencyKey,
        merchantPaymentReference: `cash:${input.orderId}:${input.idempotencyKey}`,
        requestedAmountMinor: check.customer_payable_minor,
        currencyCode: command.currency_code,
        minorUnitExponent: command.minor_unit_exponent,
        settlementCheckId: check.settlement_check_id,
      });
    }
    if (
      payment.requestedAmountMinor !== check.customer_payable_minor ||
      payment.currencyCode !== command.currency_code ||
      payment.minorUnitExponent !== command.minor_unit_exponent ||
      payment.intendedSettlementCheckId !== check.settlement_check_id
    ) {
      throw new IdempotencyConflictError(input.idempotencyKey, 'Recovered Payment has different cash checkout semantics');
    }

    if (payment.lifecycleState !== 'SUCCEEDED') {
      const outcome = await this.payments.recordVerifiedProviderOutcome({
        paymentId: payment.paymentId,
        providerEventIdentity: `cash:${input.idempotencyKey}`,
        rawProviderStatus: 'CASH_ACCEPTED',
        normalizedOutcome: 'SUCCEEDED',
        verificationStatus: 'VERIFIED',
        reconciliationOrigin: 'SYSTEM',
        merchantRequestIdentity: payment.merchantPaymentReference,
        evidenceAmountMinor: check.customer_payable_minor,
        evidenceCurrencyCode: command.currency_code,
        diagnosticMetadata: {
          cashShiftId: input.cashShiftId,
          orderId: input.orderId,
          tenderedMinor: input.tenderedMinor,
          changeMinor: (BigInt(input.tenderedMinor) - BigInt(check.customer_payable_minor)).toString(),
        },
        allocateToCheckId: check.settlement_check_id,
        allocationIdempotencyKey: `cash-allocation:${input.idempotencyKey}`,
      });
      payment = outcome.payment;
    }

    let authoritativeSettlement = await this.settlements.getSettlement(opened.settlementGroupId);
    if (authoritativeSettlement.state !== 'SATISFIED') {
      authoritativeSettlement = await this.settlements.reconcileSettlementCoverage(opened.settlementGroupId);
    }
    if (authoritativeSettlement.state !== 'SATISFIED') {
      throw new DomainValidationError('SETTLEMENT_NOT_SATISFIED', 'Cash Payment did not satisfy the Settlement');
    }

    await this.markPaymentReconciled(command, payment, authoritativeSettlement, check);
    await this.failpoint?.('after-payment-reconciliation');

    return this.finalizeLocal(input, command, payment, authoritativeSettlement, check);
  }

  private async reserveCommand(input: CashCheckoutInput): Promise<CashCommand> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.idempotencyKey]);
      const order = await this.lockOrder(client, input.orderId);
      const shift = await this.lockShift(client, input.cashShiftId);
      this.assertCashContext(order, shift, input);

      const prior = await client.query<CashCommand>(
        `SELECT * FROM cash_checkout_idempotency
         WHERE legal_entity_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [order.legal_entity_id, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        const row = prior.rows[0];
        if (
          row.order_id !== input.orderId ||
          row.cash_shift_id !== input.cashShiftId ||
          row.tendered_minor !== input.tenderedMinor ||
          row.actor_id !== input.actorId ||
          row.device_id !== input.deviceId
        ) {
          throw new IdempotencyConflictError(
            input.idempotencyKey,
            'Cash checkout key reused with different order, shift, tendered amount, cashier, or device',
          );
        }
        if (order.status !== 'OPEN' && order.status !== 'SUBMITTED') {
          throw new DomainValidationError('ORDER_NOT_OPEN', 'Cash checkout recovery requires an OPEN or SUBMITTED Order');
        }
        await client.query('COMMIT');
        return row;
      }
      if (order.status !== 'OPEN') {
        throw new DomainValidationError('ORDER_NOT_OPEN', 'Only OPEN orders can start cash checkout');
      }

      const inserted = await client.query<CashCommand>(
        `INSERT INTO cash_checkout_idempotency (
           cash_checkout_idempotency_id, tenant_id, legal_entity_id, order_id,
           cash_shift_id, idempotency_key, tendered_minor, currency_code,
           minor_unit_exponent, actor_id, device_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          randomUUID(), order.tenant_id, order.legal_entity_id, input.orderId,
          input.cashShiftId, input.idempotencyKey, input.tenderedMinor,
          shift.currency_code, shift.minor_unit_exponent, input.actorId, input.deviceId,
        ],
      );
      await client.query('COMMIT');
      return inserted.rows[0]!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async getOrOpenSettlement(input: CashCheckoutInput, command: CashCommand) {
    const live = await this.settlements.getLiveSettlementForOrder(input.orderId);
    if (live) return live;
    if (command.state !== 'RESERVED') {
      throw new DomainValidationError(
        'CHECKOUT_RECOVERY_REQUIRED',
        'A reconciled cash checkout has no live Settlement to recover',
      );
    }
    return this.settlements.openSettlement({
      orderId: input.orderId,
      idempotencyKey: `cash-checkout:settlement:${input.idempotencyKey}`,
      actorId: input.actorId,
      deviceId: input.deviceId,
    });
  }

  private async loadCheck(opened: SettlementProjection, command: CashCommand) {
    const checkId = command.settlement_check_id ?? opened.checks[0]?.settlementCheckId;
    if (!checkId) throw new NotFoundError('Settlement Check not found');
    const result = await this.pool.query<{
      settlement_check_id: string;
      settlement_group_id: string;
      state: string;
      customer_payable_minor: string;
    }>(
      `SELECT settlement_check_id, settlement_group_id, state, customer_payable_minor
       FROM settlement_check WHERE settlement_check_id = $1`,
      [checkId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Settlement Check not found');
    return row;
  }

  private assertCommandEconomics(
    command: CashCommand,
    check: { customer_payable_minor: string; state: string },
    opened: SettlementProjection,
  ) {
    if (command.payable_minor && command.payable_minor !== check.customer_payable_minor) {
      throw new IdempotencyConflictError(command.idempotency_key, 'Cash checkout payable semantics changed');
    }
    if (command.currency_code !== opened.currencyCode || command.minor_unit_exponent !== opened.minorUnitExponent) {
      throw new DomainValidationError('CURRENCY_MISMATCH', 'CashShift and Settlement currencies do not match');
    }
    if (check.state !== 'COLLECTING' && opened.state !== 'SATISFIED') {
      throw new DomainValidationError('SETTLEMENT_NOT_PAYABLE', `Check is ${check.state}`);
    }
    const payable = BigInt(check.customer_payable_minor);
    const tendered = BigInt(command.tendered_minor);
    if (payable === 0n) throw new DomainValidationError('ZERO_PAYABLE_NO_PAYMENT', 'Zero-payable checkout must not create a fake cash Payment');
    if (tendered < payable) throw new DomainValidationError('CASH_UNDERPAYMENT', 'Tendered cash is less than Customer Payable');
  }

  private async persistSettlementBinding(command: CashCommand, opened: SettlementProjection, check: { settlement_check_id: string; customer_payable_minor: string }) {
    await this.pool.query(
      `UPDATE cash_checkout_idempotency
       SET settlement_check_id = $2, settlement_group_id = $3,
           payable_minor = $4, updated_at = NOW()
       WHERE cash_checkout_idempotency_id = $1`,
      [command.cash_checkout_idempotency_id, check.settlement_check_id, opened.settlementGroupId, check.customer_payable_minor],
    );
    command.settlement_check_id = check.settlement_check_id;
    command.settlement_group_id = opened.settlementGroupId;
    command.payable_minor = check.customer_payable_minor;
  }

  private async markPaymentReconciled(
    command: CashCommand,
    payment: PaymentProjection,
    settlement: SettlementProjection,
    check: { settlement_check_id: string; customer_payable_minor: string },
  ) {
    const result = await this.pool.query<{ state: CashCommand['state'] }>(
      `UPDATE cash_checkout_idempotency
       SET payment_id = $2, settlement_check_id = $3, settlement_group_id = $4,
           payable_minor = $5,
           state = CASE WHEN state = 'FINALIZED' THEN 'FINALIZED' ELSE 'PAYMENT_RECONCILED' END,
           updated_at = NOW()
       WHERE cash_checkout_idempotency_id = $1
       RETURNING state`,
      [command.cash_checkout_idempotency_id, payment.paymentId, check.settlement_check_id, settlement.settlementGroupId, check.customer_payable_minor],
    );
    command.payment_id = payment.paymentId;
    command.state = result.rows[0]?.state ?? 'PAYMENT_RECONCILED';
  }

  private async finalizeLocal(
    input: CashCheckoutInput,
    command: CashCommand,
    payment: PaymentProjection,
    settlement: SettlementProjection,
    check: { settlement_check_id: string; customer_payable_minor: string },
  ) {
    await this.orders.submitOrderAfterPayment({
      orderId: input.orderId,
      idempotencyKey: input.idempotencyKey,
      paymentId: payment.paymentId,
      settlementGroupId: settlement.settlementGroupId,
      actorId: input.actorId,
      deviceId: input.deviceId,
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const shift = await this.lockShift(client, input.cashShiftId);
      const changeMinor = (BigInt(input.tenderedMinor) - BigInt(check.customer_payable_minor)).toString();
      await client.query(
        `INSERT INTO cash_shift_transaction (
           cash_shift_transaction_id, cash_shift_id, order_id, payment_id,
           transaction_kind, amount_minor, tendered_minor, change_minor, currency_code
         ) VALUES ($1,$2,$3,$4,'SALE',$5,$6,$7,$8)
         ON CONFLICT (cash_shift_id, order_id) DO NOTHING`,
        [randomUUID(), input.cashShiftId, input.orderId, payment.paymentId, check.customer_payable_minor, input.tenderedMinor, changeMinor, shift.currency_code],
      );
      const existingTx = await client.query<{ payment_id: string }>(
        `SELECT payment_id FROM cash_shift_transaction WHERE cash_shift_id = $1 AND order_id = $2`,
        [input.cashShiftId, input.orderId],
      );
      if (existingTx.rows[0]?.payment_id !== payment.paymentId) {
        throw new IdempotencyConflictError(input.idempotencyKey, 'CashShiftTransaction has different Payment semantics');
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
        outletId: shift.outlet_id,
        terminalId: shift.device_id,
        cashierId: shift.cashier_id,
        currencyCode: shift.currency_code,
        minorUnitExponent: shift.minor_unit_exponent,
        lines: receiptLines.rows,
        subtotalMinor: settlement.merchandiseGrossMinor,
        totalMinor: check.customer_payable_minor,
        paymentMethod: 'CASH',
        cashTenderedMinor: input.tenderedMinor,
        changeMinor,
      };
      await client.query(
        `INSERT INTO receipt (receipt_id, order_id, payment_id, payload_json)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (order_id) DO NOTHING`,
        [randomUUID(), input.orderId, payment.paymentId, JSON.stringify(payload)],
      );
      const existingReceipt = await client.query<{ payment_id: string }>(
        `SELECT payment_id FROM receipt WHERE order_id = $1`,
        [input.orderId],
      );
      if (existingReceipt.rows[0]?.payment_id !== payment.paymentId) {
        throw new IdempotencyConflictError(input.idempotencyKey, 'Receipt has different Payment semantics');
      }
      await client.query(
        `UPDATE cash_checkout_idempotency
         SET state = 'FINALIZED', updated_at = NOW()
         WHERE cash_checkout_idempotency_id = $1`,
        [command.cash_checkout_idempotency_id],
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

  private assertCashContext(
    order: { tenant_id: string; legal_entity_id: string; outlet_id: string; status: string },
    shift: { tenant_id: string; legal_entity_id: string; outlet_id: string; cashier_id: string; device_id: string; status: string },
    input: CashCheckoutInput,
  ) {
    if (shift.status !== 'OPEN') throw new DomainValidationError('CASH_SHIFT_NOT_OPEN', 'CashShift must be OPEN');
    if (shift.tenant_id !== order.tenant_id || shift.legal_entity_id !== order.legal_entity_id || shift.outlet_id !== order.outlet_id) {
      throw new DomainValidationError('CASH_SHIFT_CONTEXT_MISMATCH', 'CashShift does not belong to Order context');
    }
    if (shift.cashier_id !== input.actorId) throw new DomainValidationError('CASHIER_CONTEXT_MISMATCH', 'Cashier does not belong to CashShift context');
    if (shift.device_id !== input.deviceId) throw new DomainValidationError('DEVICE_CONTEXT_MISMATCH', 'Device does not belong to CashShift context');
  }

  private async lockOrder(client: pg.PoolClient, orderId: string) {
    const result = await client.query<{
      order_id: string; tenant_id: string; legal_entity_id: string; outlet_id: string; status: string;
    }>(`SELECT order_id, tenant_id, legal_entity_id, outlet_id, status FROM sales_order WHERE order_id = $1 FOR UPDATE`, [orderId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Order not found');
    return row;
  }

  private async lockShift(client: pg.PoolClient, shiftId: string) {
    const result = await client.query<{
      cash_shift_id: string; tenant_id: string; legal_entity_id: string; outlet_id: string;
      cashier_id: string; device_id: string; status: string; currency_code: string; minor_unit_exponent: number;
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
       FROM settlement_group sg JOIN settlement_check sc ON sc.settlement_group_id = sg.settlement_group_id
       WHERE sg.order_id = $1 ORDER BY sg.settlement_group_id DESC LIMIT 1`, [orderId],
    );
    const payment = await this.pool.query(
      `SELECT p.payment_id, p.lifecycle_state AS status, td.code AS tender_kind,
              p.requested_amount_minor AS amount_minor, tx.tendered_minor, tx.change_minor, p.currency_code
       FROM payment p JOIN tender_definition td ON td.tender_definition_id = p.tender_definition_id
       JOIN cash_shift_transaction tx ON tx.payment_id = p.payment_id
       JOIN payment_allocation pa ON pa.payment_id = p.payment_id AND pa.active = TRUE
       JOIN settlement_check sc ON sc.settlement_check_id = pa.settlement_check_id
       JOIN settlement_group sg ON sg.settlement_group_id = sc.settlement_group_id
       WHERE sg.order_id = $1 ORDER BY p.created_at DESC LIMIT 1`, [orderId],
    );
    const tasks = await this.pool.query(
      `SELECT production_task_id, order_line_id, catalog_item_id, status, quantity, unit, label, modifier_snapshot_json
       FROM production_task WHERE order_id = $1 ORDER BY created_at, production_task_id`, [orderId],
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
