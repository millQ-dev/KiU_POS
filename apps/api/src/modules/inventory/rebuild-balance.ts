/**
 * Shared inventory balance rebuild — Block C chronology replay (ADR-0003 / ADR-0018).
 * Used by Goods Receipt and Production posting so Production does not invent a second engine.
 *
 * Chronology: business_date, business_order only (plus reversal-after-primary effect class).
 * Never uses recorded_at as an economic tie-breaker.
 * Stream scope: legal_entity + warehouse + catalog_item + valuationCurrency.
 */
import type pg from 'pg';
import {
  applyCompensatingOutbound,
  applyPositiveInbound,
  createCostValue,
  emptyCostStream,
  mergeCertainty,
  orderMovementsForEconomicReplay,
  type CostCertainty,
} from '@millq/domain';

type Client = pg.PoolClient;

export async function lockValuationStream(
  client: Client,
  legalEntityId: string,
  warehouseId: string,
  catalogItemId: string,
  currencyCode: string,
  minorUnitExponent: number,
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_balance (
       legal_entity_id, warehouse_id, catalog_item_id, quantity, carrying_value_minor,
       currency_code, minor_unit_exponent, carrying_certainty, updated_at
     ) VALUES ($1,$2,$3,'0','0',$4,$5,'FINAL',NOW())
     ON CONFLICT (legal_entity_id, warehouse_id, catalog_item_id, currency_code) DO NOTHING`,
    [legalEntityId, warehouseId, catalogItemId, currencyCode, minorUnitExponent],
  );
  await client.query(
    `SELECT 1 FROM inventory_balance
     WHERE legal_entity_id = $1 AND warehouse_id = $2 AND catalog_item_id = $3 AND currency_code = $4
     FOR UPDATE`,
    [legalEntityId, warehouseId, catalogItemId, currencyCode],
  );
}

export async function rebuildInventoryBalance(
  client: Client,
  legalEntityId: string,
  warehouseId: string,
  catalogItemId: string,
  currencyCode: string,
  minorUnitExponent: number,
): Promise<void> {
  const movements = await client.query(
    `SELECT direction, quantity, acquisition_cost_minor, currency_code, minor_unit_exponent,
            business_date, business_order, source_document_type, cost_certainty
     FROM inventory_movement
     WHERE legal_entity_id = $1
       AND warehouse_id = $2
       AND catalog_item_id = $3
       AND currency_code = $4
       AND minor_unit_exponent = $5
     ORDER BY business_date ASC, business_order ASC`,
    [legalEntityId, warehouseId, catalogItemId, currencyCode, minorUnitExponent],
  );

  const rows = (
    movements.rows as Array<{
      direction: string;
      quantity: string;
      acquisition_cost_minor: string;
      currency_code: string;
      minor_unit_exponent: number;
      business_date: string | Date;
      business_order: number;
      source_document_type: string;
      cost_certainty: CostCertainty;
    }>
  ).map((m) => ({
    ...m,
    business_date:
      typeof m.business_date === 'string'
        ? m.business_date.slice(0, 10)
        : `${m.business_date.getFullYear()}-${String(m.business_date.getMonth() + 1).padStart(2, '0')}-${String(m.business_date.getDate()).padStart(2, '0')}`,
  }));

  const { ordered, orderUnresolved } = orderMovementsForEconomicReplay(rows);
  let state = emptyCostStream(currencyCode, minorUnitExponent);

  for (const m of ordered) {
    if (m.currency_code !== currencyCode || m.minor_unit_exponent !== minorUnitExponent) {
      throw new Error(
        `Valuation stream currency contamination: expected ${currencyCode}/${minorUnitExponent}`,
      );
    }
    const cost = createCostValue(m.acquisition_cost_minor, m.currency_code, m.minor_unit_exponent);
    const certainty = m.cost_certainty;
    if (m.direction === 'IN') {
      state = applyPositiveInbound(state, m.quantity, cost, certainty);
    } else {
      state = applyCompensatingOutbound(state, m.quantity, cost, certainty);
    }
  }

  if (orderUnresolved) {
    state = {
      ...state,
      carryingCertainty: mergeCertainty(state.carryingCertainty, 'ORDER_UNRESOLVED'),
    };
  }

  await client.query(
    `INSERT INTO inventory_balance (
      legal_entity_id, warehouse_id, catalog_item_id, quantity, carrying_value_minor,
      currency_code, minor_unit_exponent, carrying_certainty, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (legal_entity_id, warehouse_id, catalog_item_id, currency_code)
    DO UPDATE SET quantity = EXCLUDED.quantity,
                  carrying_value_minor = EXCLUDED.carrying_value_minor,
                  minor_unit_exponent = EXCLUDED.minor_unit_exponent,
                  carrying_certainty = EXCLUDED.carrying_certainty,
                  updated_at = NOW()`,
    [
      legalEntityId,
      warehouseId,
      catalogItemId,
      state.quantity,
      state.carryingValueMinor,
      state.currencyCode,
      state.minorUnitExponent,
      state.carryingCertainty,
    ],
  );
}
