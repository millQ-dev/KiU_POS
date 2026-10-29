/**
 * ADR-0050 order-local allergen M6 — capture, deterministic resolution, kitchen, readiness gate.
 * Disposable millq_ci_pos_* database only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../db/migrate.js';
import { seedBlockCFixture, type BlockCFixture } from '../../test/seed.js';
import { seedAllergenFixture, type AllergenFixture } from '../../test/allergen-fixture.js';
import { isPosDisposableDatabaseUrl } from '../../test/disposable-database-url.js';
import { GoodsIssueService } from '../inventory/goods-issue-service.js';
import { ModifiersService } from '../modifiers/index.js';
import { OrdersService } from '../orders/orders-service.js';
import { AllergenDomainError, AllergensService } from './index.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const describeAllergens = isPosDisposableDatabaseUrl(DATABASE_URL) ? describe : describe.skip;

describeAllergens('ADR-0050 order-local allergens (disposable PG)', () => {
  let pool: pg.Pool;
  let fx: BlockCFixture;
  let al: AllergenFixture;
  let orders: OrdersService;
  let modifiers: ModifiersService;
  let allergens: AllergensService;
  const actorId = randomUUID();

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    orders = new OrdersService(pool, { saleWriteOffPort: new GoodsIssueService(pool) });
    modifiers = new ModifiersService(pool);
    allergens = new AllergensService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE
        sales_order_line, sales_order, catalog_item, warehouse, outlet, brand, legal_entity, tenant
      RESTART IDENTITY CASCADE
    `);
    fx = await seedBlockCFixture(pool);
    al = await seedAllergenFixture(pool, fx);
  });

  async function openLatteOrder() {
    const opened = await orders.openOrder({
      tenantId: fx.tenantId,
      legalEntityId: fx.legalEntityId,
      outletId: fx.outletId,
      channel: 'DIRECT',
    });
    const withLine = await orders.addOrderLine({
      orderId: opened.orderId,
      catalogItemId: al.latteItemId,
      quantity: '1',
      unit: 'ea',
      dimension: 'COUNT',
    });
    return { orderId: opened.orderId, lineId: withLine.lines[0]!.orderLineId };
  }

  async function configure(orderId: string, lineId: string, optionId: string) {
    await modifiers.configureOrderLine({
      orderId,
      orderLineId: lineId,
      selections: [{ modifierGroupId: al.milkGroupId, modifierOptionId: optionId }],
    });
  }

  async function assertReady(orderId: string) {
    const client = await pool.connect();
    try {
      await allergens.assertReadyForCommercialAccept(client, orderId);
    } finally {
      client.release();
    }
  }

  it('migration adds order-local tables and no CustomerProfile linkage', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
       AND table_name IN (
         'order_allergen_context','order_allergen_context_event','order_line_allergen_resolution',
         'order_line_allergen_acknowledgement','catalog_item_allergen_profile',
         'catalog_item_allergen_declaration','allergen_kitchen_handling_policy')`,
    );
    expect(tables.rowCount).toBe(7);
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'order_allergen_context' AND (column_name ILIKE '%customer%' OR column_name ILIKE '%guest_id%')`,
    );
    expect(cols.rowCount).toBe(0);
  });

  describe('capture', () => {
    it('stores the three choices; revisions are audited and identical re-capture is idempotent', async () => {
      const { orderId } = await openLatteOrder();
      const first = await allergens.captureContext({
        orderId,
        captureChoice: 'SELECT_ALLERGENS',
        allergenCodes: ['MILK', 'EGG'],
        actorId,
      });
      expect(first).toMatchObject({ captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['EGG', 'MILK'], revision: 1 });

      const again = await allergens.captureContext({
        orderId,
        captureChoice: 'SELECT_ALLERGENS',
        allergenCodes: ['EGG', 'MILK', 'MILK'],
        actorId,
      });
      expect(again.revision).toBe(1);

      const unable = await allergens.captureContext({ orderId, captureChoice: 'UNABLE_TO_CLARIFY', actorId });
      expect(unable).toMatchObject({ captureChoice: 'UNABLE_TO_CLARIFY', allergenCodes: [], revision: 2 });
      const none = await allergens.captureContext({ orderId, captureChoice: 'NO_ALLERGIES_CONFIRMED', actorId });
      expect(none.revision).toBe(3);

      const events = await pool.query<{ revision: number; capture_choice: string; actor_id: string }>(
        `SELECT revision, capture_choice, actor_id FROM order_allergen_context_event
         WHERE order_id = $1 ORDER BY revision`,
        [orderId],
      );
      expect(events.rows.map((r) => r.capture_choice)).toEqual([
        'SELECT_ALLERGENS',
        'UNABLE_TO_CLARIFY',
        'NO_ALLERGIES_CONFIRMED',
      ]);
      expect(events.rows.every((r) => r.actor_id === actorId)).toBe(true);
    });

    it('rejects invalid choice/code combinations and unknown order', async () => {
      const { orderId } = await openLatteOrder();
      await expect(
        allergens.captureContext({ orderId, captureChoice: 'MAYBE' }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_CAPTURE_CHOICE_INVALID' });
      await expect(
        allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: [] }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_CODES_REQUIRED' });
      await expect(
        allergens.captureContext({ orderId, captureChoice: 'NO_ALLERGIES_CONFIRMED', allergenCodes: ['MILK'] }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_CODES_FORBIDDEN' });
      await expect(
        allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['milk'] }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_CODES_INVALID' });
      await expect(
        allergens.captureContext({ orderId: randomUUID(), captureChoice: 'UNABLE_TO_CLARIFY' }),
      ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    });

    it('rejects capture on cancelled orders and after freeze', async () => {
      const { orderId } = await openLatteOrder();
      await allergens.captureContext({ orderId, captureChoice: 'UNABLE_TO_CLARIFY' });
      const client = await pool.connect();
      try {
        await allergens.freezeForOrder(client, orderId);
      } finally {
        client.release();
      }
      await expect(
        allergens.captureContext({ orderId, captureChoice: 'NO_ALLERGIES_CONFIRMED' }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_CONTEXT_FROZEN' });

      const second = await openLatteOrder();
      await orders.cancelOrder({ orderId: second.orderId, reason: 'test', actorId });
      await expect(
        allergens.captureContext({ orderId: second.orderId, captureChoice: 'UNABLE_TO_CLARIFY' }),
      ).rejects.toMatchObject({ code: 'ORDER_NOT_OPEN' });
    });

    it('resolution requires a captured context (no silent default)', async () => {
      const { orderId } = await openLatteOrder();
      await expect(allergens.resolveOrderLines(orderId)).rejects.toMatchObject({
        code: 'ALLERGEN_CONTEXT_MISSING',
      });
      await expect(assertReady(orderId)).rejects.toMatchObject({ code: 'ALLERGEN_CONTEXT_MISSING' });
    });
  });

  describe('offer resolution', () => {
    it('NO_ALLERGIES_CONFIRMED → AVAILABLE and ready without acknowledgements', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.dairyOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'NO_ALLERGIES_CONFIRMED' });
      const [line] = await allergens.resolveOrderLines(orderId);
      expect(line).toMatchObject({ result: 'AVAILABLE', requiredAcknowledgements: [], kitchenWarnings: [] });
      await assertReady(orderId);
    });

    it('milk allergy + dairy configuration → BLOCKED; not acknowledgeable; blocks readiness', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.dairyOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });
      const [line] = await allergens.resolveOrderLines(orderId);
      expect(line!.result).toBe('BLOCKED');
      expect(line!.findings[0]).toMatchObject({ allergenCode: 'MILK', reason: 'CONTAINS_NOT_REMOVED' });
      await expect(
        allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'KITCHEN_ACKNOWLEDGED' }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_LINE_BLOCKED' });
      await expect(assertReady(orderId)).rejects.toMatchObject({ code: 'ALLERGEN_LINE_BLOCKED' });
    });

    it('offer preview surfaces the required oat option; actual oat configuration → AVAILABLE_WITH_MODIFICATION', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });

      const [offer] = await allergens.resolveOffers({ orderId, catalogItemIds: [al.latteItemId] });
      expect(offer).toMatchObject({
        result: 'AVAILABLE_WITH_MODIFICATION',
        requiredOptions: [{ modifierGroupId: al.milkGroupId, modifierOptionId: al.oatOptionId }],
      });
      expect(offer!.findings[0]?.handlingCode).toBe('CLEAN_STEAM_WAND');

      await configure(orderId, lineId, al.oatOptionId);
      const [line] = await allergens.resolveOrderLines(orderId);
      expect(line!.result).toBe('AVAILABLE_WITH_MODIFICATION');
      expect(line!.requiredAcknowledgements.map((a) => a.kind)).toEqual(['KITCHEN_ACKNOWLEDGED']);
    });

    it('missing kitchen policy fails closed: modification → REQUIRES_CONFIRMATION; forbidding policy → BLOCKED', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.oatOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });

      await pool.query(`DELETE FROM allergen_kitchen_handling_policy WHERE tenant_id = $1`, [fx.tenantId]);
      const [noPolicy] = await allergens.resolveOrderLines(orderId);
      expect(noPolicy!.result).toBe('REQUIRES_CONFIRMATION');
      expect(noPolicy!.findings[0]?.reason).toBe('KITCHEN_POLICY_MISSING');

      await pool.query(
        `INSERT INTO allergen_kitchen_handling_policy (tenant_id, allergen_code, modification_permitted)
         VALUES ($1,'MILK',FALSE)`,
        [fx.tenantId],
      );
      const [forbids] = await allergens.resolveOrderLines(orderId);
      expect(forbids!.result).toBe('BLOCKED');
      const offers = await allergens.resolveOffers({ orderId, catalogItemIds: [al.latteItemId] });
      expect(offers[0]!.result).toBe('BLOCKED');
    });

    it('UNABLE_TO_CLARIFY → REQUIRES_CONFIRMATION (never AVAILABLE), both acknowledgements needed', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.oatOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'UNABLE_TO_CLARIFY' });
      const [line] = await allergens.resolveOrderLines(orderId);
      expect(line!.result).toBe('REQUIRES_CONFIRMATION');
      expect(line!.kitchenWarnings[0]?.code).toBe('ALLERGY_STATUS_UNKNOWN');
      expect(line!.requiredAcknowledgements.map((a) => a.kind)).toEqual([
        'CASHIER_GUEST_INFORMED',
        'KITCHEN_ACKNOWLEDGED',
      ]);
      const [offer] = await allergens.resolveOffers({ orderId, catalogItemIds: [al.latteItemId] });
      expect(offer!.result).toBe('REQUIRES_CONFIRMATION');
    });

    it('UNKNOWN composition (INCOMPLETE leaf, unpublished recipe, no profile) never becomes SAFE', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.dairyOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['EGG'] });

      const [ok] = await allergens.resolveOrderLines(orderId);
      expect(ok!.result).toBe('AVAILABLE'); // all leaves COMPLETE and none declare EGG

      await pool.query(
        `UPDATE catalog_item_allergen_profile SET declaration_status = 'INCOMPLETE' WHERE catalog_item_id = $1`,
        [al.coffeeItemId],
      );
      const [incomplete] = await allergens.resolveOrderLines(orderId);
      expect(incomplete!.result).toBe('REQUIRES_CONFIRMATION');
      expect(incomplete!.findings[0]?.reason).toBe('UNCERTAIN_COMPOSITION');

      await pool.query(`DELETE FROM catalog_item_allergen_profile WHERE catalog_item_id = $1`, [al.coffeeItemId]);
      const [missing] = await allergens.resolveOrderLines(orderId);
      expect(missing!.result).toBe('REQUIRES_CONFIRMATION');

      await pool.query(`UPDATE recipe_version SET status = 'DRAFT'`);
      const [noRecipe] = await allergens.resolveOrderLines(orderId);
      expect(noRecipe!.result).toBe('REQUIRES_CONFIRMATION');
    });

    it('cross-contact declaration → REQUIRES_CONFIRMATION with structured kitchen warning', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.dairyOptionId);
      await pool.query(
        `INSERT INTO catalog_item_allergen_declaration (catalog_item_id, tenant_id, allergen_code, exposure)
         VALUES ($1,$2,'GLUTEN','CROSS_CONTAMINATION_RISK')`,
        [al.coffeeItemId, fx.tenantId],
      );
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['GLUTEN'] });
      const [line] = await allergens.resolveOrderLines(orderId);
      expect(line!.result).toBe('REQUIRES_CONFIRMATION');
      expect(line!.findings[0]?.reason).toBe('CROSS_CONTACT_RISK');
      expect(line!.kitchenWarnings.map((w) => w.code)).toContain('CROSS_CONTACT_RISK');
    });

    it('is deterministic across repeated resolution', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.oatOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });
      const [a] = await allergens.resolveOrderLines(orderId);
      const [b] = await allergens.resolveOrderLines(orderId);
      expect(b!.resolutionFingerprint).toBe(a!.resolutionFingerprint);
      expect(b).toEqual(a);
    });
  });

  describe('acknowledgements, revalidation, freeze', () => {
    it('kitchen ack makes the oat line ready; duplicate ack is idempotent', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.oatOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });
      await allergens.resolveOrderLines(orderId);
      await expect(assertReady(orderId)).rejects.toMatchObject({ code: 'ALLERGEN_ACK_REQUIRED' });

      await allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'KITCHEN_ACKNOWLEDGED', actorId });
      await allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'KITCHEN_ACKNOWLEDGED', actorId });
      const rows = await pool.query(`SELECT 1 FROM order_line_allergen_acknowledgement WHERE order_line_id = $1`, [lineId]);
      expect(rows.rowCount).toBe(1);
      await assertReady(orderId);

      await expect(
        allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'CASHIER_GUEST_INFORMED' }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_ACK_NOT_REQUIRED' });
      await expect(
        allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'LEGAL_OVERRIDE' }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_ACK_KIND_INVALID' });
    });

    it('changing the allergen context or line configuration invalidates prior acknowledgements', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.oatOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });
      await allergens.resolveOrderLines(orderId);
      await allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'KITCHEN_ACKNOWLEDGED' });
      await assertReady(orderId);

      // Constraint change → stale until re-resolved, and old ack no longer counts.
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['EGG', 'MILK'] });
      await expect(assertReady(orderId)).rejects.toMatchObject({ code: 'ALLERGEN_REVALIDATION_REQUIRED' });
      await expect(
        allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'KITCHEN_ACKNOWLEDGED' }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_REVALIDATION_REQUIRED' });
      await allergens.resolveOrderLines(orderId);
      await expect(assertReady(orderId)).rejects.toMatchObject({ code: 'ALLERGEN_ACK_REQUIRED' });
      await allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'KITCHEN_ACKNOWLEDGED' });
      await assertReady(orderId);

      // Configuration change (back to dairy) → stale, then BLOCKED after revalidation.
      await configure(orderId, lineId, al.dairyOptionId);
      await expect(assertReady(orderId)).rejects.toMatchObject({ code: 'ALLERGEN_REVALIDATION_REQUIRED' });
      const [line] = await allergens.resolveOrderLines(orderId);
      expect(line!.result).toBe('BLOCKED');
      expect(line!.acknowledgedKinds).toEqual([]);
    });

    it('a line added after capture has no resolution until revalidated', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.oatOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'UNABLE_TO_CLARIFY' });
      await allergens.resolveOrderLines(orderId);
      await orders.addOrderLine({
        orderId,
        catalogItemId: al.latteItemId,
        quantity: '1',
        unit: 'ea',
        dimension: 'COUNT',
      });
      await expect(assertReady(orderId)).rejects.toBeInstanceOf(AllergenDomainError);
      const lines = await allergens.resolveOrderLines(orderId);
      expect(lines).toHaveLength(2);
    });

    it('freeze pins the resolution snapshot against later recipe/policy changes', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.oatOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });
      const [before] = await allergens.resolveOrderLines(orderId);
      const client = await pool.connect();
      try {
        await allergens.freezeForOrder(client, orderId);
      } finally {
        client.release();
      }
      await pool.query(
        `UPDATE allergen_kitchen_handling_policy SET modification_permitted = FALSE WHERE tenant_id = $1`,
        [fx.tenantId],
      );
      const [after] = await allergens.resolveOrderLines(orderId);
      expect(after).toEqual(before);
      await expect(
        allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'KITCHEN_ACKNOWLEDGED' }),
      ).rejects.toMatchObject({ code: 'ALLERGEN_RESOLUTION_FROZEN' });
    });
  });

  describe('kitchen ticket', () => {
    it('carries conspicuous warnings, preparation changes, handling codes and ack status', async () => {
      const { orderId, lineId } = await openLatteOrder();
      await configure(orderId, lineId, al.oatOptionId);
      await allergens.captureContext({ orderId, captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });
      await allergens.resolveOrderLines(orderId);

      const before = await allergens.getKitchenTicket(orderId);
      expect(before.allergyContext).toMatchObject({ captureChoice: 'SELECT_ALLERGENS', allergenCodes: ['MILK'] });
      expect(before.notice).toMatch(/not a safety certification/i);
      const line = before.lines[0]!;
      expect(line.catalogItemName).toBe('Latte');
      expect(line.kitchenWarnings.map((w) => w.code)).toEqual(['ALLERGY_ORDER', 'ALLERGEN_MODIFICATION']);
      expect(line.kitchenWarnings.every((w) => w.severity === 'CRITICAL')).toBe(true);
      expect(line.kitchenWarnings[1]!.handlingCodes).toEqual(['CLEAN_STEAM_WAND']);
      expect(line.preparationChanges).toEqual([{ kind: 'REPLACE_COMPONENT', component: 'Milk', replacement: 'Oat drink' }]);
      expect(line.kitchenInstructions).toContain('MILK_OAT');
      expect(line.requiredAcknowledgements).toEqual([{ kind: 'KITCHEN_ACKNOWLEDGED', acknowledged: false }]);

      await allergens.recordAcknowledgement({ orderId, orderLineId: lineId, kind: 'KITCHEN_ACKNOWLEDGED' });
      const after = await allergens.getKitchenTicket(orderId);
      expect(after.lines[0]!.requiredAcknowledgements).toEqual([{ kind: 'KITCHEN_ACKNOWLEDGED', acknowledged: true }]);
    });
  });
});
