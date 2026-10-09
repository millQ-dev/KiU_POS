/**
 * TAX1.1 — Minimal Vietnam direct-sale Tax runtime acceptance matrix.
 * Resolution: CatalogItem → TaxClassificationAssignment → TaxPolicyVersion.
 * Fiscal gate remains UNAVAILABLE — no fake Fiscal success.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/migrate.js';
import { CheckoutOrchestrator } from '../checkout/checkout-orchestrator.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { OrdersService } from '../orders/orders-service.js';
import { acceptFinalMerchandiseTerms } from '../../test/commercial-terms.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { stubPaymentCoverageReader } from '../settlement/settlement-ports.js';
import { SettlementService } from '../settlement/settlement-service.js';
import { TaxService } from './tax-service.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://millq:millq@localhost:5432/millq_dev';

describe('TAX1.1 Vietnam direct-sale Tax runtime', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let tax: TaxService;
  let settlements: SettlementService;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    fx = await seedBlockCFixture(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    tax = new TaxService(pool);
    settlements = new SettlementService(pool);

    // Assign inclusive 8% to egg + milk on primary LE (tax_required).
    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `vn-incl-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [fx.eggItemId],
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function openOrderWithGross(
    grossMinor: string,
    opts?: { merchantDiscount?: string; catalogItemId?: string },
  ) {
    const catalogItemId = opts?.catalogItemId ?? fx.eggItemId;
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const refreshed = await orders.getOrder(o.orderId);
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `tax11-${randomUUID()}`,
      defaultGrossMinor: grossMinor,
      grossByOrderLineId: {
        [refreshed.lines[0]!.orderLineId]: grossMinor,
      },
      ...(opts?.merchantDiscount
        ? {
            lineDiscountsByOrderLineId: {
              [refreshed.lines[0]!.orderLineId]: opts.merchantDiscount,
            },
          }
        : {}),
    });
    return orders.getOrder(o.orderId);
  }

  it('TAX_INCLUSIVE direct sale via assignment chain; Settlement freezes tax PRESENT', async () => {
    const o = await openOrderWithGross('108000');
    const snap = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-${o.orderId}`,
    });
    expect(snap.pricingTaxMode).toBe('TAX_INCLUSIVE');
    expect(snap.algorithmId).toBe('LINE_ROUND_THEN_SUM_V1');
    expect(snap.lines[0]!.taxClassificationAssignmentId).toBeTruthy();
    expect(snap.lines[0]!.taxClassificationId).toBeTruthy();
    expect(snap.vatTotalMinor).toBeTruthy();
    expect(BigInt(snap.taxableBaseTotalMinor!) + BigInt(snap.vatTotalMinor!)).toBe(
      BigInt(snap.amountIncludingTaxTotalMinor!),
    );
    expect(snap.customerPayableMinor).toBe('108000');

    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `open-${o.orderId}`,
    });
    expect(s.payableSnapshot.tax.presence).toBe('PRESENT');
    expect(s.payableSnapshot.tax).toEqual({
      presence: 'PRESENT',
      amountMinor: snap.vatTotalMinor,
    });
    expect(s.customerPayableMinor).toBe(snap.customerPayableMinor);
  });

  it('OpenSettlement without Tax snapshot fails closed when tax_required', async () => {
    const o = await openOrderWithGross('50000');
    await expect(
      settlements.openSettlement({
        orderId: o.orderId,
        idempotencyKey: `open-${o.orderId}`,
      }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_TAX_SNAPSHOT_REQUIRED' });
  });

  it('missing TaxClassificationAssignment fails closed', async () => {
    const unassigned = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Unassigned drink','ea','COUNT')`,
      [unassigned, fx.tenantId],
    );
    const o = await openOrderWithGross('100000', { catalogItemId: unassigned });
    await expect(
      tax.acceptTaxSnapshot({ orderId: o.orderId, idempotencyKey: `tax-${o.orderId}` }),
    ).rejects.toMatchObject({ code: 'TAX_CLASSIFICATION_REQUIRED' });
  });

  it('heterogeneous rates across lines in one Order', async () => {
    const pastryId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Pastry','ea','COUNT')`,
      [pastryId, fx.tenantId],
    );
    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `vn-pastry-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_EXCLUSIVE',
      taxTreatment: 'REDUCED_RATE',
      rateDecimal: '0.05',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [pastryId],
      classificationCode: `pastry-${randomUUID().slice(0, 8)}`,
      exclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
      setTaxRequired: true,
    });

    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: pastryId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const refreshed = await orders.getOrder(o.orderId);
    const eggLine = refreshed.lines.find((l) => l.catalogItemId === fx.eggItemId)!;
    const pastryLine = refreshed.lines.find((l) => l.catalogItemId === pastryId)!;
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `tax11-mix-${randomUUID()}`,
      grossByOrderLineId: {
        [eggLine.orderLineId]: '108000', // inclusive 8%
        [pastryLine.orderLineId]: '100000', // exclusive 5%
      },
    });

    const snap = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-${o.orderId}`,
    });
    expect(snap.lines).toHaveLength(2);
    const eggSnap = snap.lines.find((l) => l.soldCatalogItemId === fx.eggItemId)!;
    const pastrySnap = snap.lines.find((l) => l.soldCatalogItemId === pastryId)!;
    expect(eggSnap.pricingTaxMode).toBe('TAX_INCLUSIVE');
    expect(eggSnap.rateDecimal).toBe('0.08');
    expect(pastrySnap.pricingTaxMode).toBe('TAX_EXCLUSIVE');
    expect(pastrySnap.rateDecimal).toBe('0.05');
    expect(pastrySnap.vatMinor).toBe('5000');
    expect(snap.customerPayableMinor).toBe('213000');
    // Different policies + different modes → policy envelope null; mode MIXED at Settlement.
    expect(snap.taxPolicyId).toBeNull();
    expect(snap.rateDecimal).toBeNull();
    expect(snap.pricingTaxMode).toBeNull();

    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `open-${o.orderId}`,
    });
    expect(s.customerPayableMinor).toBe('213000');
    const prov = await pool.query<{ provenance_json: { taxPresentation?: string } }>(
      `SELECT provenance_json FROM settlement_payable_snapshot
       WHERE settlement_payable_snapshot_id = $1`,
      [s.payableSnapshot.settlementPayableSnapshotId],
    );
    expect(prov.rows[0]!.provenance_json.taxPresentation).toBe('MIXED');
  });

  it('overlapping TaxClassificationAssignments fail closed as AMBIGUOUS', async () => {
    const itemId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Ambiguous item','ea','COUNT')`,
      [itemId, fx.tenantId],
    );
    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `vn-amb-a-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [itemId],
      classificationCode: `amb-a-${randomUUID().slice(0, 8)}`,
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
      setTaxRequired: true,
    });
    // Simulate corrupted overlap that bypassed EXCLUDE (resolver must still fail closed).
    await pool.query(
      `ALTER TABLE tax_classification_assignment
         DROP CONSTRAINT IF EXISTS tax_classification_assignment_no_overlap`,
    );
    try {
      const first = await pool.query<{
        tax_classification_id: string;
        tax_policy_id: string;
      }>(
        `SELECT tax_classification_id, tax_policy_id
         FROM tax_classification_assignment
         WHERE catalog_item_id = $1 AND legal_entity_id = $2
         LIMIT 1`,
        [itemId, fx.legalEntityId],
      );
      await pool.query(
        `INSERT INTO tax_classification_assignment (
           tax_classification_assignment_id, tenant_id, legal_entity_id, catalog_item_id,
           tax_classification_id, tax_policy_id, effective_from
         ) VALUES ($1,$2,$3,$4,$5,$6,'2020-01-01T00:00:00Z')`,
        [
          randomUUID(),
          fx.tenantId,
          fx.legalEntityId,
          itemId,
          first.rows[0]!.tax_classification_id,
          first.rows[0]!.tax_policy_id,
        ],
      );
      const o = await openOrderWithGross('108000', { catalogItemId: itemId });
      await expect(
        tax.acceptTaxSnapshot({ orderId: o.orderId, idempotencyKey: `tax-${o.orderId}` }),
      ).rejects.toMatchObject({ code: 'TAX_CLASSIFICATION_AMBIGUOUS' });
    } finally {
      await pool.query(`DELETE FROM tax_classification_assignment WHERE catalog_item_id = $1`, [
        itemId,
      ]);
      await pool.query(`
        ALTER TABLE tax_classification_assignment
          DROP CONSTRAINT IF EXISTS tax_classification_assignment_no_overlap;
        ALTER TABLE tax_classification_assignment
          ADD CONSTRAINT tax_classification_assignment_no_overlap
          EXCLUDE USING gist (
            tenant_id WITH =,
            legal_entity_id WITH =,
            catalog_item_id WITH =,
            tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
          );
      `);
    }
  });

  it('same PricingTaxMode multi-rate keeps envelope INCLUDED presentation', async () => {
    const drinkId = randomUUID();
    await pool.query(
      `INSERT INTO catalog_item (catalog_item_id, tenant_id, name, base_unit, dimension)
       VALUES ($1,$2,'Special drink','ea','COUNT')`,
      [drinkId, fx.tenantId],
    );
    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `vn-drink10-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.10',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [drinkId],
      classificationCode: `drink10-${randomUUID().slice(0, 8)}`,
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
      setTaxRequired: true,
    });

    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: drinkId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const refreshed = await orders.getOrder(o.orderId);
    const eggLine = refreshed.lines.find((l) => l.catalogItemId === fx.eggItemId)!;
    const drinkLine = refreshed.lines.find((l) => l.catalogItemId === drinkId)!;
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `tax11-samemode-${randomUUID()}`,
      grossByOrderLineId: {
        [eggLine.orderLineId]: '108000',
        [drinkLine.orderLineId]: '110000',
      },
    });
    const snap = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-${o.orderId}`,
    });
    expect(snap.taxPolicyId).toBeNull();
    expect(snap.pricingTaxMode).toBe('TAX_INCLUSIVE');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `open-${o.orderId}`,
    });
    const prov = await pool.query<{ provenance_json: { taxPresentation?: string } }>(
      `SELECT provenance_json FROM settlement_payable_snapshot
       WHERE settlement_payable_snapshot_id = $1`,
      [s.payableSnapshot.settlementPayableSnapshotId],
    );
    expect(prov.rows[0]!.provenance_json.taxPresentation).toBe('INCLUDED');
  });

  it('merchant-funded discount supported; payable = C under inclusive mode', async () => {
    const o = await openOrderWithGross('100000', { merchantDiscount: '20000' });
    const snap = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-${o.orderId}`,
    });
    expect(snap.lines[0]!.cMinor).toBe('80000');
    expect(snap.customerPayableMinor).toBe('80000');
  });

  it('third-party funding rejected', async () => {
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const refreshed = await orders.getOrder(o.orderId);
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `tax11-tp-${randomUUID()}`,
      defaultGrossMinor: '100000',
      grossByOrderLineId: { [refreshed.lines[0]!.orderLineId]: '100000' },
      thirdPartyFundingByOrderLineId: { [refreshed.lines[0]!.orderLineId]: '20000' },
    });
    await expect(
      tax.acceptTaxSnapshot({ orderId: o.orderId, idempotencyKey: `tax-${o.orderId}` }),
    ).rejects.toMatchObject({ code: 'TAX_THIRD_PARTY_FUNDING_UNSUPPORTED' });
  });

  it('idempotent Tax accept retry returns same snapshot', async () => {
    const o = await openOrderWithGross('19000');
    const key = `tax-idem-${o.orderId}`;
    const a = await tax.acceptTaxSnapshot({ orderId: o.orderId, idempotencyKey: key });
    const b = await tax.acceptTaxSnapshot({ orderId: o.orderId, idempotencyKey: key });
    expect(b.taxOrderSnapshotId).toBe(a.taxOrderSnapshotId);
  });

  it('historical snapshot immutable when policy rate changes later', async () => {
    const o = await openOrderWithGross('108000');
    const snap = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-${o.orderId}`,
    });
    const vatBefore = snap.vatTotalMinor;
    const versionId = snap.lines[0]!.taxPolicyVersionId;
    await pool.query(
      `UPDATE tax_policy_version SET rate_decimal = '0.99' WHERE tax_policy_version_id = $1`,
      [versionId],
    );
    const again = await tax.getTaxSnapshot(snap.taxOrderSnapshotId);
    expect(again.vatTotalMinor).toBe(vatBefore);
    expect(again.lines[0]!.rateDecimal).toBe('0.08');
  });

  it('TAX_EXCLUSIVE on separate LegalEntity via assignment chain', async () => {
    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.otherLegalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `vn-excl-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_EXCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [fx.eggItemId],
      exclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
    });
    const outletB = randomUUID();
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Outlet B')`,
      [outletB, fx.tenantId, fx.brandId, fx.otherLegalEntityId],
    );
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.otherLegalEntityId,
      outletId: outletB,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const refreshed = await orders.getOrder(o.orderId);
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `tax11-ex-${randomUUID()}`,
      defaultGrossMinor: '12000',
      grossByOrderLineId: { [refreshed.lines[0]!.orderLineId]: '12000' },
    });
    const snap = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-${o.orderId}`,
    });
    expect(snap.pricingTaxMode).toBe('TAX_EXCLUSIVE');
    expect(snap.vatTotalMinor).toBe('960');
    expect(snap.customerPayableMinor).toBe('12960');
  });

  it('CompleteOrder still blocked by fiscal UNAVAILABLE after Tax+Settlement', async () => {
    const o = await openOrderWithGross('108000');
    await tax.acceptTaxSnapshot({ orderId: o.orderId, idempotencyKey: `tax-${o.orderId}` });
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `open-${o.orderId}`,
    });
    const checkId = s.checks[0]!.settlementCheckId;
    const covered = settlements.withDeps({
      coverageReader: stubPaymentCoverageReader([
        {
          allocationIdentity: `alloc-${o.orderId}`,
          settlementCheckId: checkId,
          amountMinor: s.customerPayableMinor,
          qualifies: true,
        },
      ]),
    });
    const reconciled = await covered.reconcileSettlementCoverage(s.settlementGroupId);
    expect(reconciled.state).toBe('SATISFIED');
    const checkout = new CheckoutOrchestrator(pool, orders, covered);
    await expect(
      checkout.tryAdvanceCheckout({
        settlementGroupId: s.settlementGroupId,
        completeIdempotencyKey: `complete-${o.orderId}`,
        businessDate: '2026-10-06',
        businessOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_FISCAL_PREREQUISITE_UNAVAILABLE' });
  });

  it('tax snapshots reject UPDATE/DELETE (DB immutability)', async () => {
    const o = await openOrderWithGross('108000');
    const snap = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-${o.orderId}`,
    });
    await expect(
      pool.query(`UPDATE tax_order_snapshot SET vat_total_minor = '1' WHERE tax_order_snapshot_id = $1`, [
        snap.taxOrderSnapshotId,
      ]),
    ).rejects.toThrow(/TAX_SNAPSHOT_IMMUTABLE|immutable/i);
  });

  it('Settlement does not recalculate Tax — uses snapshot amounts only', async () => {
    const o = await openOrderWithGross('108000');
    const snap = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-${o.orderId}`,
    });
    await pool.query(
      `UPDATE tax_policy_version SET rate_decimal = '0.99'
       WHERE tax_policy_version_id = $1`,
      [snap.lines[0]!.taxPolicyVersionId],
    );
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `open-${o.orderId}`,
    });
    expect(s.payableSnapshot.tax).toEqual({
      presence: 'PRESENT',
      amountMinor: snap.vatTotalMinor,
    });
    expect(s.customerPayableMinor).toBe(snap.customerPayableMinor);
  });
});

describe('TAX1.1 tax applicability (Gate A)', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let settlements: SettlementService;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    fx = await seedBlockCFixture(pool);
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    settlements = new SettlementService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function openCommercialOnLe(legalEntityId: string, outletId: string, gross = '100000') {
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId,
      outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    const refreshed = await orders.getOrder(o.orderId);
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `gate-a-${randomUUID()}`,
      defaultGrossMinor: gross,
      grossByOrderLineId: { [refreshed.lines[0]!.orderLineId]: gross },
    });
    return refreshed.orderId;
  }

  it('undecided tax_required (NULL) fails closed — no silent ABSENT for new VN LE', async () => {
    const leId = randomUUID();
    const outletId = randomUUID();
    await pool.query(
      `INSERT INTO legal_entity (legal_entity_id, tenant_id, name, jurisdiction_code)
       VALUES ($1,$2,'VN LE undecided','VN')`,
      [leId, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Undecided outlet')`,
      [outletId, fx.tenantId, fx.brandId, leId],
    );
    const taxCol = await pool.query<{ tax_required: boolean | null }>(
      `SELECT tax_required FROM legal_entity WHERE legal_entity_id = $1`,
      [leId],
    );
    expect(taxCol.rows[0]!.tax_required).toBeNull();
    const orderId = await openCommercialOnLe(leId, outletId);
    await expect(
      settlements.openSettlement({ orderId, idempotencyKey: `open-${orderId}` }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_TAX_APPLICABILITY_UNDECIDED' });
  });

  it('explicit tax_required=FALSE allows ABSENT merchandise-only Settlement', async () => {
    await pool.query(
      `UPDATE legal_entity SET tax_required = FALSE, default_tax_policy_id = NULL
       WHERE legal_entity_id = $1`,
      [fx.legalEntityId],
    );
    const orderId = await openCommercialOnLe(fx.legalEntityId, fx.outletId);
    const s = await settlements.openSettlement({
      orderId,
      idempotencyKey: `open-${orderId}`,
    });
    expect(s.payableSnapshot.tax.presence).toBe('ABSENT');
    expect(s.customerPayableMinor).toBe('100000');
  });

  it('explicit tax_required=TRUE without Tax snapshot fails closed', async () => {
    const leId = randomUUID();
    const outletId = randomUUID();
    await pool.query(
      `INSERT INTO legal_entity (legal_entity_id, tenant_id, name, jurisdiction_code, tax_required)
       VALUES ($1,$2,'VN LE required no config','VN', TRUE)`,
      [leId, fx.tenantId],
    );
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Required outlet')`,
      [outletId, fx.tenantId, fx.brandId, leId],
    );
    const orderId = await openCommercialOnLe(leId, outletId);
    await expect(
      settlements.openSettlement({ orderId, idempotencyKey: `open-${orderId}` }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_TAX_SNAPSHOT_REQUIRED' });
  });
});

describe('TAX1.1 concurrent accept vs reprice (Gate C)', () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let fx: BlockCFixture;
  let orders: OrdersService;
  let tax: TaxService;
  let settlements: SettlementService;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    fx = await seedBlockCFixture(pool);
    tax = new TaxService(pool);
    await tax.upsertC0TaxPolicy({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      jurisdictionCode: 'VN',
      policyCode: `vn-gatec-${randomUUID().slice(0, 8)}`,
      pricingTaxMode: 'TAX_INCLUSIVE',
      taxTreatment: 'STANDARD_RATE',
      rateDecimal: '0.08',
      taxableBaseRule: 'TB_CUSTOMER_PAYABLE_MERCHANDISE_SHARE',
      catalogItemIds: [fx.eggItemId, fx.milkItemId],
      inclusiveRounding: { roundingMode: 'HALF_UP', quantumMinor: '1' },
      setTaxRequired: true,
    });
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    settlements = new SettlementService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('stale Tax snapshot after reprice cannot authorize OpenSettlement', async () => {
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    let refreshed = await orders.getOrder(o.orderId);
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `gatec-a-${randomUUID()}`,
      defaultGrossMinor: '108000',
      grossByOrderLineId: { [refreshed.lines[0]!.orderLineId]: '108000' },
    });
    const stale = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-stale-${o.orderId}`,
    });
    expect(stale.customerPayableMinor).toBe('108000');

    refreshed = await orders.getOrder(o.orderId);
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `gatec-b-${randomUUID()}`,
      defaultGrossMinor: '216000',
      grossByOrderLineId: { [refreshed.lines[0]!.orderLineId]: '216000' },
    });

    await expect(
      settlements.openSettlement({
        orderId: o.orderId,
        idempotencyKey: `open-stale-${o.orderId}`,
      }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_TAX_SNAPSHOT_REQUIRED' });

    const fresh = await tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-fresh-${o.orderId}`,
    });
    expect(fresh.taxOrderSnapshotId).not.toBe(stale.taxOrderSnapshotId);
    expect(fresh.customerPayableMinor).toBe('216000');
    const s = await settlements.openSettlement({
      orderId: o.orderId,
      idempotencyKey: `open-fresh-${o.orderId}`,
    });
    expect(s.customerPayableMinor).toBe('216000');
  });

  it('concurrent Tax accept + commercial reprice: Settlement never binds stale snapshot', async () => {
    const o = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
    });
    await orders.addOrderLine({
      orderId: o.orderId,
      catalogItemId: fx.eggItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    let refreshed = await orders.getOrder(o.orderId);
    const lineId = refreshed.lines[0]!.orderLineId;
    await acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
      idempotencyKey: `gatec-c1-${randomUUID()}`,
      defaultGrossMinor: '108000',
      grossByOrderLineId: { [lineId]: '108000' },
    });

    const acceptP = tax.acceptTaxSnapshot({
      orderId: o.orderId,
      idempotencyKey: `tax-race-${o.orderId}`,
    });
    const repriceP = (async () => {
      // Yield so accept likely acquires order lock first; reprice waits then wins new fingerprint.
      await new Promise((r) => setTimeout(r, 5));
      refreshed = await orders.getOrder(o.orderId);
      return acceptFinalMerchandiseTerms(orders, refreshed.orderId, {
        idempotencyKey: `gatec-c2-${randomUUID()}`,
        defaultGrossMinor: '216000',
        grossByOrderLineId: { [lineId]: '216000' },
      });
    })();

    const [, repriceResult] = await Promise.allSettled([acceptP, repriceP]);
    expect(repriceResult.status).toBe('fulfilled');
    // After reprice, current commercial is 216000. OpenSettlement may succeed only if
    // accept raced after reprice and bound the new fingerprint — never with stale 108000.
    let opened = false;
    try {
      const early = await settlements.openSettlement({
        orderId: o.orderId,
        idempotencyKey: `open-race-${o.orderId}`,
      });
      expect(early.customerPayableMinor).toBe('216000');
      opened = true;
    } catch (err) {
      expect((err as { code?: string }).code).toBe('SETTLEMENT_TAX_SNAPSHOT_REQUIRED');
    }

    if (!opened) {
      const aligned = await tax.acceptTaxSnapshot({
        orderId: o.orderId,
        idempotencyKey: `tax-aligned-${o.orderId}`,
      });
      expect(aligned.customerPayableMinor).toBe('216000');
      const s = await settlements.openSettlement({
        orderId: o.orderId,
        idempotencyKey: `open-aligned-${o.orderId}`,
      });
      expect(s.customerPayableMinor).toBe(aligned.customerPayableMinor);
    }
  });
});
