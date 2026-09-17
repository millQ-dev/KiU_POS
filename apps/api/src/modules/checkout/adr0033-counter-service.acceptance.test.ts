import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/migrate.js';
import { CashShiftService } from '../cash/cash-shift-service.js';
import { DomainValidationError } from '../orders/errors.js';
import { OrdersService } from '../orders/orders-service.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { MenuService } from '../menu/index.js';
import { BaseCommercialAcceptanceService } from '../commercial-rounding/base-commercial-acceptance.js';
import { CommercialRoundingPolicyService } from '../commercial-rounding/rounding-policy-service.js';
import { CashCheckoutService } from './cash-checkout-service.js';
import { PaymentsService } from '../payments/payments-service.js';
import { SettlementService } from '../settlement/settlement-service.js';
import { createWiredPaymentsAndSettlement } from '../../routes/payments.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

describe('ADR-0033 counter-service cash checkout', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let shifts: CashShiftService;
  let checkout: CashCheckoutService;
  let payments: PaymentsService;
  let settlements: SettlementService;
  let menu: MenuService;
  let commercialAcceptance: BaseCommercialAcceptanceService;
  let policies: CommercialRoundingPolicyService;
  let modifierGroupId: string;
  let mediumOptionId: string;
  let oatOptionId: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    fx = await seedBlockCFixture(pool);
    orders = new OrdersService(pool);
    shifts = new CashShiftService(pool);
    ({ payments, settlements } = createWiredPaymentsAndSettlement(
      pool,
      (paymentsSvc) => new SettlementService(pool, {
        coverageReader: paymentsSvc.createCoverageReader(),
        externalEffects: paymentsSvc.createExternalEffectProbe(),
      }),
    ));
    checkout = new CashCheckoutService(pool, orders, payments, settlements);
    menu = new MenuService(pool);
    commercialAcceptance = new BaseCommercialAcceptanceService(pool, orders);
    policies = new CommercialRoundingPolicyService(pool);
    await menu.setOutletTimezone({ tenantId: fx.tenantId, outletId: fx.outletId, timezone: 'Asia/Ho_Chi_Minh' });

    await pool.query(`UPDATE catalog_item SET name = 'Cappuccino', requires_production = TRUE WHERE catalog_item_id = $1`, [fx.milkItemId]);
    await pool.query(`UPDATE catalog_item SET name = 'Croissant', requires_production = FALSE WHERE catalog_item_id = $1`, [fx.eggItemId]);
    modifierGroupId = randomUUID();
    mediumOptionId = randomUUID();
    oatOptionId = randomUUID();
    await pool.query(
      `INSERT INTO modifier_group (modifier_group_id, tenant_id, code, label)
       VALUES ($1,$2,'size','Size')`,
      [modifierGroupId, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO modifier_option (
         modifier_option_id, modifier_group_id, label, price_delta_minor,
         currency_code, minor_unit_exponent, position
       ) VALUES
         ($1,$3,'Medium','0','VND',0,1),
         ($2,$3,'Oat','10000','VND',0,2)`,
      [mediumOptionId, oatOptionId, modifierGroupId],
    );
    await pool.query(
      `INSERT INTO catalog_item_modifier_group
         (catalog_item_id, modifier_group_id, position, min_selections, max_selections)
       VALUES ($1,$2,1,1,2)`,
      [fx.milkItemId, modifierGroupId],
    );

    const menuDefinition = await menu.createMenuDefinition({
      tenantId: fx.tenantId,
      code: `adr0033-${fx.tenantId.slice(0, 8)}`,
      name: 'Counter-service pilot menu',
    });
    await menu.setMenuDefinitionItems({
      menuDefinitionId: menuDefinition.menuDefinitionId,
      catalogItemIds: [fx.milkItemId, fx.eggItemId],
    });
    const publication = await menu.publishMenu({
      menuDefinitionId: menuDefinition.menuDefinitionId,
      idempotencyKey: `adr0033-menu-${fx.tenantId}`,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await menu.assignMenu({
      tenantId: fx.tenantId,
      menuPublicationId: publication.menuPublicationId,
      scopeKind: 'OUTLET',
      outletId: fx.outletId,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      idempotencyKey: `adr0033-menu-assignment-${fx.tenantId}`,
    });
    for (const [catalogItemId, amountMinor] of [[fx.milkItemId, '50000'], [fx.eggItemId, '45000']] as const) {
      await menu.activatePriceRule({
        tenantId: fx.tenantId,
        catalogItemId,
        scopeKind: 'OUTLET',
        outletId: fx.outletId,
        amountMinor,
        currencyCode: 'VND',
        minorUnitExponent: 0,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: `adr0033-price-${catalogItemId}`,
      });
    }
    await policies.createPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      calculationContext: 'BASE_LIST_LINE_GROSS',
      roundingMode: 'HALF_UP',
      quantumMinor: '1',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
      idempotencyKey: `adr0033-policy-${fx.tenantId}`,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function acceptedOrder() {
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'TAKEAWAY',
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.milkItemId,
      quantity: '1',
      unit: 'L',
      dimension: 'VOLUME',
      modifierSelections: [{ groupId: modifierGroupId, optionIds: [mediumOptionId, oatOptionId] }],
    });
    await orders.addOrderLine({
      orderId: order.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '2',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const accepted = await commercialAcceptance.calculateAndAcceptBaseCommercialTerms({
      orderId: order.orderId,
      salesContext: {
        tenantId: fx.tenantId,
        brandId: fx.brandId,
        outletId: fx.outletId,
        orderChannel: 'TAKEAWAY',
        businessDateTime: '2026-09-17T08:00:00.000Z',
      },
      idempotencyKey: `adr0033-commercial-${order.orderId}`,
    });
    expect(accepted.commercialStatus.merchandiseGrossMinor).toBe('150000');
    expect(accepted.commercialStatus.lines[0]!.grossMerchandiseMinor).toBe('60000');
    return orders.getOrder(order.orderId);
  }

  it('runs the golden cash route with separate lifecycles and downstream records', async () => {
    const order = await acceptedOrder();
    const shift = await shifts.ensureDevOpenShift({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      openingCashMinor: '500000',
      cashierId: fx.actorId,
    });

    const result = await checkout.checkout({
      orderId: order.orderId,
      cashShiftId: shift.cashShiftId,
      tenderedMinor: '200000',
      idempotencyKey: `adr0033-cash-${order.orderId}`,
      actorId: fx.actorId,
      deviceId: shift.deviceId,
    });

    expect(result.order.status).toBe('SUBMITTED');
    expect(result.payment).toMatchObject({ status: 'SUCCEEDED', tender_kind: 'CASH', amount_minor: '150000' });
    expect(result.settlement).toMatchObject({ settlement_state: 'SATISFIED', check_state: 'SATISFIED' });
    expect(result.productionTasks).toHaveLength(1);
    expect(result.productionTasks[0]).toMatchObject({ status: 'IN_PROGRESS', catalog_item_id: fx.milkItemId });
    expect(result.receipt).toMatchObject({
      orderId: order.orderId,
      paymentMethod: 'CASH',
      cashTenderedMinor: '200000',
      changeMinor: '50000',
      totalMinor: '150000',
    });
    expect((result.receipt as { lines: Array<{ modifiers: unknown[] }> }).lines[0]!.modifiers).toHaveLength(2);

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM payment WHERE payment_id = $1) AS payments,
         (SELECT COUNT(*)::int FROM payment_allocation WHERE payment_id = $1 AND active = TRUE) AS allocations,
         (SELECT requested_amount_minor FROM payment WHERE payment_id = $1) AS payable,
         (SELECT amount_minor FROM cash_shift_transaction WHERE payment_id = $1) AS shift_amount,
         (SELECT tendered_minor FROM cash_shift_transaction WHERE payment_id = $1) AS tendered,
         (SELECT change_minor FROM cash_shift_transaction WHERE payment_id = $1) AS change,
         (SELECT COUNT(*)::int FROM cash_shift_transaction WHERE payment_id = $1) AS shift_transactions,
         (SELECT COUNT(*)::int FROM production_task WHERE order_id = $2) AS production_tasks,
         (SELECT COUNT(*)::int FROM receipt WHERE order_id = $2) AS receipts`,
      [result.payment.payment_id, order.orderId],
    );
    expect(counts.rows[0]).toMatchObject({
      payments: 1, allocations: 1, payable: '150000', shift_amount: '150000',
      tendered: '200000', change: '50000', shift_transactions: 1, production_tasks: 1, receipts: 1,
    });
    expect(BigInt(counts.rows[0].shift_amount) + BigInt(counts.rows[0].change)).toBe(BigInt(counts.rows[0].tendered));

    const retry = await checkout.checkout({
      orderId: order.orderId,
      cashShiftId: shift.cashShiftId,
      tenderedMinor: '200000',
      idempotencyKey: `adr0033-cash-${order.orderId}`,
      actorId: fx.actorId,
      deviceId: shift.deviceId,
    });
    expect(retry.payment.payment_id).toBe(result.payment.payment_id);

    await expect(
      checkout.checkout({
        orderId: order.orderId,
        cashShiftId: shift.cashShiftId,
        tenderedMinor: '200000',
        idempotencyKey: `adr0033-cash-${order.orderId}`,
        actorId: randomUUID(),
        deviceId: shift.deviceId,
      }),
    ).rejects.toMatchObject({ code: 'CASHIER_CONTEXT_MISMATCH' });

    await expect(
      checkout.checkout({
        orderId: order.orderId,
        cashShiftId: shift.cashShiftId,
        tenderedMinor: '210000',
        idempotencyKey: `adr0033-cash-${order.orderId}`,
        actorId: fx.actorId,
        deviceId: shift.deviceId,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('serializes concurrent retries and rejects key reuse on another Order', async () => {
    const shift = await shifts.ensureDevOpenShift({
      tenantId: fx.tenantId, legalEntityId: fx.legalEntityId, outletId: fx.outletId,
      cashierId: fx.actorId, deviceId: randomUUID(),
    });
    const order = await acceptedOrder();
    const key = `adr0033-concurrent-${order.orderId}`;
    const payload = {
      orderId: order.orderId, cashShiftId: shift.cashShiftId, tenderedMinor: '150000',
      idempotencyKey: key, actorId: fx.actorId, deviceId: shift.deviceId,
    };
    const [first, second] = await Promise.all([checkout.checkout(payload), checkout.checkout(payload)]);
    expect(first.payment.payment_id).toBe(second.payment.payment_id);
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM payment WHERE create_idempotency_key = $1`, [key]);
    expect(count.rows[0]!.count).toBe(1);

    const otherShift = await shifts.ensureDevOpenShift({
      tenantId: fx.tenantId, legalEntityId: fx.legalEntityId, outletId: fx.outletId,
      cashierId: fx.actorId, deviceId: randomUUID(),
    });
    await expect(checkout.checkout({ ...payload, cashShiftId: otherShift.cashShiftId, deviceId: otherShift.deviceId })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const other = await acceptedOrder();
    await expect(checkout.checkout({ ...payload, orderId: other.orderId })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('validates CashShift cashier and device context', async () => {
    const order = await acceptedOrder();
    const shift = await shifts.ensureDevOpenShift({
      tenantId: fx.tenantId, legalEntityId: fx.legalEntityId, outletId: fx.outletId,
      cashierId: fx.actorId, deviceId: randomUUID(),
    });
    await expect(checkout.checkout({
      orderId: order.orderId, cashShiftId: shift.cashShiftId, tenderedMinor: '150000',
      idempotencyKey: `adr0033-wrong-cashier-${order.orderId}`, actorId: randomUUID(), deviceId: shift.deviceId,
    })).rejects.toMatchObject({ code: 'CASHIER_CONTEXT_MISMATCH' });
    const settlementsCreated = await pool.query(`SELECT COUNT(*)::int AS count FROM settlement_group WHERE order_id = $1`, [order.orderId]);
    expect(settlementsCreated.rows[0]!.count).toBe(0);

    const deviceOrder = await acceptedOrder();
    await expect(checkout.checkout({
      orderId: deviceOrder.orderId, cashShiftId: shift.cashShiftId, tenderedMinor: '150000',
      idempotencyKey: `adr0033-wrong-device-${deviceOrder.orderId}`, actorId: fx.actorId, deviceId: randomUUID(),
    })).rejects.toMatchObject({ code: 'DEVICE_CONTEXT_MISMATCH' });
    const deviceSettlements = await pool.query(`SELECT COUNT(*)::int AS count FROM settlement_group WHERE order_id = $1`, [deviceOrder.orderId]);
    expect(deviceSettlements.rows[0]!.count).toBe(0);
  });

  it('recovers after Payment reconciliation failpoint and finalizes exactly once', async () => {
    const order = await acceptedOrder();
    const shift = await shifts.ensureDevOpenShift({
      tenantId: fx.tenantId, legalEntityId: fx.legalEntityId, outletId: fx.outletId,
      cashierId: fx.actorId, deviceId: randomUUID(),
    });
    const key = `adr0033-recovery-${order.orderId}`;
    const failpointCheckout = new CashCheckoutService(
      pool,
      orders,
      payments,
      settlements,
      async () => { throw new Error('FAILPOINT_AFTER_PAYMENT_RECONCILIATION'); },
    );
    await expect(failpointCheckout.checkout({
      orderId: order.orderId, cashShiftId: shift.cashShiftId, tenderedMinor: '150000',
      idempotencyKey: key, actorId: fx.actorId, deviceId: shift.deviceId,
    })).rejects.toThrow('FAILPOINT_AFTER_PAYMENT_RECONCILIATION');

    const interrupted = await pool.query(
      `SELECT c.state, c.payment_id, o.status, sg.state AS settlement_state,
              (SELECT COUNT(*)::int FROM cash_shift_transaction tx WHERE tx.order_id = c.order_id) AS shift_transactions,
              (SELECT COUNT(*)::int FROM production_task pt WHERE pt.order_id = c.order_id) AS production_tasks,
              (SELECT COUNT(*)::int FROM receipt r WHERE r.order_id = c.order_id) AS receipts
       FROM cash_checkout_idempotency c
       JOIN sales_order o ON o.order_id = c.order_id
       JOIN settlement_group sg ON sg.settlement_group_id = c.settlement_group_id
       WHERE c.idempotency_key = $1`,
      [key],
    );
    expect(interrupted.rows[0]).toMatchObject({
      state: 'PAYMENT_RECONCILED', payment_id: expect.any(String), status: 'OPEN',
      settlement_state: 'SATISFIED', shift_transactions: 0, production_tasks: 0, receipts: 0,
    });

    const recovered = await checkout.checkout({
      orderId: order.orderId, cashShiftId: shift.cashShiftId, tenderedMinor: '150000',
      idempotencyKey: key, actorId: fx.actorId, deviceId: shift.deviceId,
    });
    expect(recovered.order.status).toBe('SUBMITTED');
    const finalized = await pool.query(
      `SELECT c.state,
              (SELECT COUNT(*)::int FROM payment p WHERE p.create_idempotency_key = $1) AS payments,
              (SELECT COUNT(*)::int FROM payment_allocation pa WHERE pa.payment_id = c.payment_id AND pa.active = TRUE) AS allocations,
              (SELECT COUNT(*)::int FROM cash_shift_transaction tx WHERE tx.order_id = c.order_id) AS shift_transactions,
              (SELECT COUNT(*)::int FROM production_task pt WHERE pt.order_id = c.order_id) AS production_tasks,
              (SELECT COUNT(*)::int FROM receipt r WHERE r.order_id = c.order_id) AS receipts,
              (SELECT COUNT(*)::int FROM audit_record a WHERE a.aggregate_id = c.order_id AND a.action = 'ORDER_SUBMITTED') AS audits
       FROM cash_checkout_idempotency c WHERE c.idempotency_key = $1`,
      [key],
    );
    expect(finalized.rows[0]).toEqual({
      state: 'FINALIZED', payments: 1, allocations: 1, shift_transactions: 1,
      production_tasks: 1, receipts: 1, audits: 1,
    });
    expect((await checkout.checkout({
      orderId: order.orderId, cashShiftId: shift.cashShiftId, tenderedMinor: '150000',
      idempotencyKey: key, actorId: fx.actorId, deviceId: shift.deviceId,
    })).payment.payment_id).toBe(recovered.payment.payment_id);
  });

  it('blocks Order cancellation behind a live Settlement until safe abort', async () => {
    const order = await acceptedOrder();
    const settlement = await settlements.openSettlement({
      orderId: order.orderId,
      idempotencyKey: `adr0033-cancel-lock-${order.orderId}`,
      actorId: fx.actorId,
      deviceId: randomUUID(),
    });
    await expect(orders.cancelOrder({ orderId: order.orderId, reason: 'test' })).rejects.toMatchObject({ code: 'SETTLEMENT_EDIT_LOCKED' });
    const aborted = await settlements.abortSettlement({ settlementGroupId: settlement.settlementGroupId, expectedVersion: settlement.version });
    expect(aborted.state).toBe('ABORTED');
    expect((await orders.cancelOrder({ orderId: order.orderId, reason: 'test' })).status).toBe('CANCELLED');
  });

  it('rejects a modifier snapshot whose currency differs from the authoritative item price', async () => {
    const order = await orders.openOrder({
      tenantId: fx.tenantId, legalEntityId: fx.legalEntityId, outletId: fx.outletId, channel: 'TAKEAWAY',
    });
    await orders.addOrderLine({
      orderId: order.orderId, catalogItemId: fx.milkItemId, quantity: '1', unit: 'L', dimension: 'VOLUME',
      modifierSelections: [{ groupId: modifierGroupId, optionIds: [mediumOptionId, oatOptionId] }],
    });
    await pool.query(`UPDATE sales_order_line_modifier SET currency_code = 'USD', minor_unit_exponent = 2 WHERE order_line_id = (SELECT order_line_id FROM sales_order_line WHERE order_id = $1) AND modifier_option_id = $2`, [order.orderId, oatOptionId]);
    await expect(commercialAcceptance.calculateAndAcceptBaseCommercialTerms({
      orderId: order.orderId,
      salesContext: { tenantId: fx.tenantId, brandId: fx.brandId, outletId: fx.outletId, orderChannel: 'TAKEAWAY', businessDateTime: '2026-09-17T08:00:00.000Z' },
      idempotencyKey: `adr0033-modifier-currency-${order.orderId}`,
    })).rejects.toMatchObject({ code: 'MODIFIER_CURRENCY_MISMATCH' });
  });

  it('rejects cash underpayment without mutating order or creating Payment', async () => {
    const order = await acceptedOrder();
    const shift = await shifts.ensureDevOpenShift({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      cashierId: fx.actorId,
    });
    const key = `adr0033-underpay-${order.orderId}`;

    await expect(
      checkout.checkout({
        orderId: order.orderId,
        cashShiftId: shift.cashShiftId,
        tenderedMinor: '149999',
        idempotencyKey: key,
        actorId: fx.actorId,
        deviceId: shift.deviceId,
      }),
    ).rejects.toMatchObject({ code: 'CASH_UNDERPAYMENT' });

    const state = await pool.query(
      `SELECT o.status, COUNT(p.payment_id)::int AS payments, sg.state AS settlement_state
       FROM sales_order o
       LEFT JOIN settlement_group sg ON sg.order_id = o.order_id
       LEFT JOIN settlement_check sc ON sc.settlement_group_id = sg.settlement_group_id
       LEFT JOIN payment_allocation pa ON pa.settlement_check_id = sc.settlement_check_id AND pa.active = TRUE
       LEFT JOIN payment p ON p.payment_id = pa.payment_id
       WHERE o.order_id = $1
       GROUP BY o.status, sg.state`,
      [order.orderId],
    );
    expect(state.rows[0]).toMatchObject({ status: 'OPEN', payments: 0, settlement_state: 'COLLECTING' });
  });

  it('requires the mandatory modifier selection before a line is created', async () => {
    const order = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'TAKEAWAY',
    });
    await expect(
      orders.addOrderLine({
        orderId: order.orderId,
        catalogItemId: fx.milkItemId,
        quantity: '1',
        unit: 'L',
        dimension: 'VOLUME',
      }),
    ).rejects.toMatchObject({ code: 'MODIFIERS_REQUIRED' });
    const lines = await pool.query(`SELECT COUNT(*)::int AS count FROM sales_order_line WHERE order_id = $1`, [order.orderId]);
    expect(lines.rows[0]!.count).toBe(0);
  });
});
