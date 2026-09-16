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

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

describe('ADR-0033 counter-service cash checkout', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let shifts: CashShiftService;
  let checkout: CashCheckoutService;
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
    checkout = new CashCheckoutService(pool, orders);
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
         (SELECT COUNT(*)::int FROM cash_shift_transaction WHERE payment_id = $1) AS shift_transactions,
         (SELECT COUNT(*)::int FROM production_task WHERE order_id = $2) AS production_tasks,
         (SELECT COUNT(*)::int FROM receipt WHERE order_id = $2) AS receipts`,
      [result.payment.payment_id, order.orderId],
    );
    expect(counts.rows[0]).toEqual({ payments: 1, allocations: 1, shift_transactions: 1, production_tasks: 1, receipts: 1 });

    const retry = await checkout.checkout({
      orderId: order.orderId,
      cashShiftId: shift.cashShiftId,
      tenderedMinor: '200000',
      idempotencyKey: `adr0033-cash-${order.orderId}`,
      actorId: fx.actorId,
      deviceId: shift.deviceId,
    });
    expect(retry.payment.payment_id).toBe(result.payment.payment_id);
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
