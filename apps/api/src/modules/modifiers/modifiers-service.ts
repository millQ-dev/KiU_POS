import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  sumAdditivePriceAdjustmentsMinor,
  type ModifierRecipeDelta,
} from '@millq/domain';
import { ModifierDomainError } from './errors.js';
import {
  buildKitchenInstructionsSnapshot,
  type KitchenInstructionsSnapshot,
} from './kitchen-instructions.js';

type GroupBinding = {
  modifier_group_id: string;
  required: boolean;
  min_select: number;
  max_select: number;
  ask_every_time: boolean;
  selection_mode: string;
};

export type CatalogModifierOptionView = {
  modifierOptionId: string;
  code: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  priceAdjustmentMinor: string;
  kitchenInstructionCode: string | null;
};

export type CatalogModifierGroupView = {
  modifierGroupId: string;
  code: string;
  name: string;
  selectionMode: 'SINGLE' | 'MULTI';
  minSelect: number;
  maxSelect: number;
  askEveryTime: boolean;
  required: boolean;
  sortOrder: number;
  options: CatalogModifierOptionView[];
};

export class ModifiersService {
  constructor(private readonly pool: Pool) {}

  /**
   * Menu bindings for a sellable catalog item (counter POS configure UI).
   */
  async listCatalogItemModifierGroups(input: {
    tenantId: string;
    catalogItemId: string;
  }): Promise<CatalogModifierGroupView[]> {
    const bindings = await this.pool.query<{
      modifier_group_id: string;
      code: string;
      name: string;
      selection_mode: 'SINGLE' | 'MULTI';
      min_select: number;
      max_select: number;
      ask_every_time: boolean;
      required: boolean;
      sort_order: number;
    }>(
      `SELECT b.modifier_group_id, g.code, g.name, g.selection_mode, g.min_select, g.max_select,
              g.ask_every_time, b.required, b.sort_order
       FROM catalog_item_modifier_group b
       JOIN modifier_group g ON g.modifier_group_id = b.modifier_group_id
       WHERE b.catalog_item_id = $1 AND b.tenant_id = $2
       ORDER BY b.sort_order, g.code`,
      [input.catalogItemId, input.tenantId],
    );
    const out: CatalogModifierGroupView[] = [];
    for (const b of bindings.rows) {
      const opts = await this.pool.query<{
        modifier_option_id: string;
        code: string;
        name: string;
        sort_order: number;
        is_default: boolean;
        price_adjustment_minor: string;
        kitchen_instruction_code: string | null;
      }>(
        `SELECT modifier_option_id, code, name, sort_order, is_default,
                price_adjustment_minor, kitchen_instruction_code
         FROM modifier_option
         WHERE modifier_group_id = $1 AND tenant_id = $2
         ORDER BY sort_order, code`,
        [b.modifier_group_id, input.tenantId],
      );
      out.push({
        modifierGroupId: b.modifier_group_id,
        code: b.code,
        name: b.name,
        selectionMode: b.selection_mode,
        minSelect: b.min_select,
        maxSelect: b.max_select,
        askEveryTime: b.ask_every_time,
        required: b.required,
        sortOrder: b.sort_order,
        options: opts.rows.map((o) => ({
          modifierOptionId: o.modifier_option_id,
          code: o.code,
          name: o.name,
          sortOrder: o.sort_order,
          isDefault: o.is_default,
          priceAdjustmentMinor: o.price_adjustment_minor,
          kitchenInstructionCode: o.kitchen_instruction_code,
        })),
      });
    }
    return out;
  }

  /**
   * Configure OPEN OrderLine modifier selections (ADR-0049).
   * Fail-closed on required / ask-every-time / min-max. Freezes additive price + kitchen codes.
   */
  async configureOrderLine(input: {
    orderId: string;
    orderLineId: string;
    selections: ReadonlyArray<{ modifierGroupId: string; modifierOptionId: string }>;
    guestNote?: string | null;
  }): Promise<{
    orderLineConfigurationId: string;
    additivePriceAdjustmentMinor: string;
    configurationFingerprint: string;
    kitchenInstructions: KitchenInstructionsSnapshot;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query<{
        order_id: string;
        tenant_id: string;
        status: string;
      }>(
        `SELECT order_id, tenant_id, status FROM sales_order WHERE order_id = $1 FOR UPDATE`,
        [input.orderId],
      );
      if (!order.rows[0]) throw new ModifierDomainError('ORDER_NOT_FOUND', 'Order not found');
      if (order.rows[0].status !== 'OPEN') {
        throw new ModifierDomainError('ORDER_NOT_OPEN', 'Modifiers only on OPEN orders');
      }
      // ADR-0032: live Settlement freezes commercial edits (same as other line mutations).
      const liveSettlement = await client.query(
        `SELECT 1 FROM settlement_group
         WHERE order_id = $1 AND state IN ('COLLECTING', 'SATISFIED')
         LIMIT 1`,
        [input.orderId],
      );
      if ((liveSettlement.rowCount ?? 0) > 0) {
        throw new ModifierDomainError(
          'SETTLEMENT_EDIT_LOCKED',
          'Order commercial content cannot mutate while a live Settlement exists',
        );
      }

      const line = await client.query<{
        order_line_id: string;
        catalog_item_id: string;
      }>(
        `SELECT order_line_id, catalog_item_id FROM sales_order_line
         WHERE order_line_id = $1 AND order_id = $2 FOR UPDATE`,
        [input.orderLineId, input.orderId],
      );
      if (!line.rows[0]) throw new ModifierDomainError('LINE_NOT_FOUND', 'Order line not found');

      const existing = await client.query<{ frozen_at: string | null }>(
        `SELECT frozen_at FROM order_line_configuration WHERE order_line_id = $1 FOR UPDATE`,
        [input.orderLineId],
      );
      if (existing.rows[0]?.frozen_at) {
        throw new ModifierDomainError('CONFIGURATION_FROZEN', 'Line configuration already frozen');
      }

      const bindings = await client.query<GroupBinding>(
        `SELECT b.modifier_group_id, b.required, g.min_select, g.max_select, g.ask_every_time, g.selection_mode
         FROM catalog_item_modifier_group b
         JOIN modifier_group g ON g.modifier_group_id = b.modifier_group_id
         WHERE b.catalog_item_id = $1 AND b.tenant_id = $2
         ORDER BY b.sort_order, g.code`,
        [line.rows[0].catalog_item_id, order.rows[0].tenant_id],
      );

      const boundGroupIds = new Set(bindings.rows.map((b) => b.modifier_group_id));
      const byGroup = new Map<string, string[]>();
      for (const s of input.selections) {
        if (!boundGroupIds.has(s.modifierGroupId)) {
          throw new ModifierDomainError(
            'MODIFIER_GROUP_UNBOUND',
            `Modifier group ${s.modifierGroupId} is not bound to this catalog item`,
          );
        }
        const list = byGroup.get(s.modifierGroupId) ?? [];
        list.push(s.modifierOptionId);
        byGroup.set(s.modifierGroupId, list);
      }

      const priceParts: string[] = [];
      const kitchen: string[] = [];
      const deltas: ModifierRecipeDelta[] = [];
      const validatedSelections: Array<{ groupId: string; optionId: string }> = [];

      for (const b of bindings.rows) {
        let chosen = byGroup.get(b.modifier_group_id) ?? [];
        // ADR-0052 M4: a valid default satisfies a mandatory group unless askEveryTime.
        // askEveryTime never auto-applies a default — operator must confirm explicitly.
        if (chosen.length === 0 && !b.ask_every_time) {
          const defaults = await client.query<{ modifier_option_id: string }>(
            `SELECT modifier_option_id FROM modifier_option
             WHERE modifier_group_id = $1 AND is_default = TRUE
             ORDER BY sort_order`,
            [b.modifier_group_id],
          );
          chosen = defaults.rows.map((r) => r.modifier_option_id);
        }
        // ADR-0049 #5 / ADR-0052 M4: ask-every-time always needs an explicit selection (≥1).
        const explicitMin = b.required || b.ask_every_time ? Math.max(1, b.min_select) : b.min_select;
        if (chosen.length < explicitMin || chosen.length > b.max_select) {
          if ((b.required || b.ask_every_time) && chosen.length === 0) {
            throw new ModifierDomainError(
              'MODIFIER_REQUIRED',
              `Modifier group ${b.modifier_group_id} requires selection`,
            );
          }
          throw new ModifierDomainError(
            'MODIFIER_SELECTION_COUNT',
            `Group ${b.modifier_group_id} expects ${explicitMin}..${b.max_select} selections`,
          );
        }
        if (b.selection_mode === 'SINGLE' && chosen.length > 1) {
          throw new ModifierDomainError('MODIFIER_SINGLE_ONLY', 'Single-select group');
        }
        for (const optionId of chosen) {
          const opt = await client.query<{
            modifier_option_id: string;
            price_adjustment_minor: string;
            kitchen_instruction_code: string | null;
          }>(
            `SELECT modifier_option_id, price_adjustment_minor, kitchen_instruction_code
             FROM modifier_option
             WHERE modifier_option_id = $1 AND modifier_group_id = $2 AND tenant_id = $3`,
            [optionId, b.modifier_group_id, order.rows[0].tenant_id],
          );
          if (!opt.rows[0]) {
            throw new ModifierDomainError('MODIFIER_OPTION_INVALID', 'Option not in group');
          }
          priceParts.push(opt.rows[0].price_adjustment_minor);
          if (opt.rows[0].kitchen_instruction_code) {
            kitchen.push(opt.rows[0].kitchen_instruction_code);
          }
          const drows = await client.query<{
            delta_kind: string;
            target_catalog_item_id: string | null;
            replacement_catalog_item_id: string | null;
            replacement_quantity: string | null;
            replacement_unit: string | null;
            replacement_dimension: string | null;
            add_catalog_item_id: string | null;
            add_quantity: string | null;
            add_unit: string | null;
            add_dimension: string | null;
          }>(
            `SELECT delta_kind, target_catalog_item_id, replacement_catalog_item_id,
                    replacement_quantity, replacement_unit, replacement_dimension,
                    add_catalog_item_id, add_quantity, add_unit, add_dimension
             FROM modifier_option_recipe_delta
             WHERE modifier_option_id = $1 ORDER BY sort_order`,
            [optionId],
          );
          for (const d of drows.rows) {
            if (d.delta_kind === 'REMOVE_COMPONENT' && d.target_catalog_item_id) {
              deltas.push({ kind: 'REMOVE_COMPONENT', targetCatalogItemId: d.target_catalog_item_id });
            } else if (
              d.delta_kind === 'REPLACE_COMPONENT' &&
              d.target_catalog_item_id &&
              d.replacement_catalog_item_id
            ) {
              const yieldCount = [
                d.replacement_quantity,
                d.replacement_unit,
                d.replacement_dimension,
              ].filter((v) => v != null).length;
              if (yieldCount !== 0 && yieldCount !== 3) {
                throw new ModifierDomainError(
                  'MODIFIER_DELTA_INVALID',
                  `Option ${optionId} REPLACE yield must include quantity, unit, and dimension`,
                );
              }
              deltas.push({
                kind: 'REPLACE_COMPONENT',
                targetCatalogItemId: d.target_catalog_item_id,
                replacementCatalogItemId: d.replacement_catalog_item_id,
                ...(yieldCount === 3
                  ? {
                      replacementQuantity: d.replacement_quantity!,
                      replacementUnit: d.replacement_unit!,
                      replacementDimension: d.replacement_dimension as 'MASS' | 'VOLUME' | 'COUNT',
                    }
                  : {}),
              });
            } else if (
              d.delta_kind === 'ADD_COMPONENT' &&
              d.add_catalog_item_id &&
              d.add_quantity &&
              d.add_unit &&
              d.add_dimension
            ) {
              deltas.push({
                kind: 'ADD_COMPONENT',
                addCatalogItemId: d.add_catalog_item_id,
                quantity: d.add_quantity,
                unit: d.add_unit,
                dimension: d.add_dimension as 'MASS' | 'VOLUME' | 'COUNT',
              });
            } else {
              throw new ModifierDomainError(
                'MODIFIER_DELTA_INVALID',
                `Option ${optionId} has an incomplete recipe delta`,
              );
            }
          }
          validatedSelections.push({ groupId: b.modifier_group_id, optionId });
        }
      }

      // ADR-0052 M5: typed separation — codes authoritative; guestNote never recipe/allergen/inventory SoT.
      const kitchenSnapshot = buildKitchenInstructionsSnapshot({
        instructionCodes: kitchen,
        ...(input.guestNote !== undefined ? { guestNote: input.guestNote } : {}),
      });

      const additive = sumAdditivePriceAdjustmentsMinor(priceParts);
      // Snapshot deltas now (ADR-0049 #9); consumption must not re-resolve live menu deltas.
      const recipeDeltasJson = JSON.stringify(deltas);
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            line: input.orderLineId,
            selections: validatedSelections,
            additive,
            deltas,
          }),
        )
        .digest('hex');

      await client.query(`DELETE FROM order_line_configuration WHERE order_line_id = $1`, [
        input.orderLineId,
      ]);
      const configId = randomUUID();
      await client.query(
        `INSERT INTO order_line_configuration (
           order_line_configuration_id, tenant_id, order_id, order_line_id,
           configuration_fingerprint, additive_price_adjustment_minor, kitchen_instructions_json,
           effective_recipe_deltas_json
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
        [
          configId,
          order.rows[0].tenant_id,
          input.orderId,
          input.orderLineId,
          fingerprint,
          additive,
          JSON.stringify(kitchenSnapshot),
          recipeDeltasJson,
        ],
      );
      for (const s of validatedSelections) {
        await client.query(
          `INSERT INTO order_line_modifier_selection (
             order_line_modifier_selection_id, order_line_configuration_id,
             modifier_group_id, modifier_option_id
           ) VALUES ($1,$2,$3,$4)`,
          [randomUUID(), configId, s.groupId, s.optionId],
        );
      }

      // Line economics changed — invalidate accepted commercial terms (must re-accept).
      await client.query(`DELETE FROM sales_order_commercial_line_terms WHERE order_id = $1`, [
        input.orderId,
      ]);
      await client.query(`DELETE FROM sales_order_commercial_terms WHERE order_id = $1`, [
        input.orderId,
      ]);
      // ADR-0050: lift allergen freeze so reconfigure can re-resolve before next accept.
      const { AllergensService } = await import('../allergens/index.js');
      await new AllergensService(this.pool).unfreezeForCommercialInvalidation(client, input.orderId);

      await client.query('COMMIT');
      return {
        orderLineConfigurationId: configId,
        additivePriceAdjustmentMinor: additive,
        configurationFingerprint: fingerprint,
        kitchenInstructions: kitchenSnapshot,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** ADR-0052 T8 — pin configuration when commercial terms are accepted. */
  async freezeConfigurationsForOrder(client: PoolClient, orderId: string): Promise<void> {
    await client.query(
      `UPDATE order_line_configuration SET frozen_at = COALESCE(frozen_at, NOW()) WHERE order_id = $1`,
      [orderId],
    );
  }

  /** Lift configuration freeze when open commercial terms are invalidated. */
  async unfreezeConfigurationsForOrder(client: PoolClient, orderId: string): Promise<void> {
    await client.query(`UPDATE order_line_configuration SET frozen_at = NULL WHERE order_id = $1`, [
      orderId,
    ]);
  }

  /**
   * Fail-closed before commercial accept: every line with required or ask-every-time
   * bindings must have an order_line_configuration snapshot.
   */
  async assertLineConfigurationComplete(client: PoolClient, orderId: string): Promise<void> {
    const lines = await client.query<{
      order_line_id: string;
      catalog_item_id: string;
    }>(`SELECT order_line_id, catalog_item_id FROM sales_order_line WHERE order_id = $1`, [orderId]);
    for (const line of lines.rows) {
      const needsConfig = await client.query<{ modifier_group_id: string }>(
        `SELECT b.modifier_group_id
         FROM catalog_item_modifier_group b
         JOIN modifier_group g ON g.modifier_group_id = b.modifier_group_id
         WHERE b.catalog_item_id = $1
           AND (b.required = TRUE OR g.ask_every_time = TRUE)`,
        [line.catalog_item_id],
      );
      if (needsConfig.rowCount === 0) continue;
      const cfg = await client.query<{ order_line_configuration_id: string }>(
        `SELECT order_line_configuration_id FROM order_line_configuration WHERE order_line_id = $1`,
        [line.order_line_id],
      );
      if (!cfg.rows[0]) {
        throw new ModifierDomainError(
          'MODIFIER_CONFIGURATION_MISSING',
          `Order line ${line.order_line_id} missing required modifier configuration`,
        );
      }
    }
  }
}
