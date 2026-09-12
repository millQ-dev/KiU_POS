/**
 * Shared inventory balance rebuild — Block C chronology replay (ADR-0003 / ADR-0018).
 * Used by Goods Receipt and Production posting so Production does not invent a second engine.
 */
import type pg from 'pg';
import {
  applyCompensatingOutbound,
  applyPositiveInbound,
  createCostValue,
  emptyCostStream,
} from '@millq/domain';

type Client = pg.PoolClient;

export async function rebuildInventoryBalance(
  client: Client,
  legalEntityId: string,
  warehouseId: string,
  catalogItemId: string,
): Promise<void> {
  const movements = await client.query(
    `SELECT direction, quantity, acquisition_cost_minor, currency_code, minor_unit_exponent,
            business_date, business_order
     FROM inventory_movement
     WHERE legal_entity_id = $1 AND warehouse_id = $2 AND catalog_item_id = $3
     ORDER BY business_date ASC, business_order ASC, recorded_at ASC`,
    [legalEntityId, warehouseId, catalogItemId],
  );

  let currency = 'VND';
  let exponent = 0;
  if (movements.rows[0]) {
    currency = movements.rows[0].currency_code as string;
    exponent = movements.rows[0].minor_unit_exponent as number;
  }
  let state = emptyCostStream(currency, exponent);

  for (const m of movements.rows as Array<{
    direction: string;
    quantity: string;
    acquisition_cost_minor: string;
    currency_code: string;
    minor_unit_exponent: number;
  }>) {
    const cost = createCostValue(m.acquisition_cost_minor, m.currency_code, m.minor_unit_exponent);
    if (m.direction === 'IN') {
      state = applyPositiveInbound(state, m.quantity, cost);
    } else {
      state = applyCompensatingOutbound(state, m.quantity, cost);
    }
  }

  await client.query(
    `INSERT INTO inventory_balance (
      legal_entity_id, warehouse_id, catalog_item_id, quantity, carrying_value_minor,
      currency_code, minor_unit_exponent, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (legal_entity_id, warehouse_id, catalog_item_id)
    DO UPDATE SET quantity = EXCLUDED.quantity,
                  carrying_value_minor = EXCLUDED.carrying_value_minor,
                  currency_code = EXCLUDED.currency_code,
                  minor_unit_exponent = EXCLUDED.minor_unit_exponent,
                  updated_at = NOW()`,
    [
      legalEntityId,
      warehouseId,
      catalogItemId,
      state.quantity,
      state.carryingValueMinor,
      state.currencyCode,
      state.minorUnitExponent,
    ],
  );
}
