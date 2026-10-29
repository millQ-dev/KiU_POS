/**
 * Test helper: satisfy ADR-0050 commercial-accept allergen gate for non-allergen suites.
 * Seeds COMPLETE empty leaf profiles for order lines, captures NO_ALLERGIES_CONFIRMED when
 * missing, and resolves lines so AVAILABLE needs no acknowledgements.
 */
import type pg from 'pg';
import { AllergensService } from '../modules/allergens/index.js';

export async function ensureCompleteAllergenProfilesForOrder(
  pool: pg.Pool,
  orderId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO catalog_item_allergen_profile (catalog_item_id, tenant_id, declaration_status)
     SELECT DISTINCT l.catalog_item_id, o.tenant_id, 'COMPLETE'
     FROM sales_order_line l
     JOIN sales_order o ON o.order_id = l.order_id
     WHERE l.order_id = $1
     ON CONFLICT (catalog_item_id) DO UPDATE
       SET declaration_status = 'COMPLETE', updated_at = NOW()`,
    [orderId],
  );
}

/** Capture + resolve so calculateAndAcceptBaseCommercialTerms can proceed under ADR-0050. */
export async function ensureAllergenReadyForCommercialAccept(
  pool: pg.Pool,
  orderId: string,
): Promise<void> {
  await ensureCompleteAllergenProfilesForOrder(pool, orderId);
  const allergens = new AllergensService(pool);
  const existing = await allergens.getContext(orderId);
  if (!existing) {
    await allergens.captureContext({ orderId, captureChoice: 'NO_ALLERGIES_CONFIRMED' });
  }
  await allergens.resolveOrderLines(orderId);
}
