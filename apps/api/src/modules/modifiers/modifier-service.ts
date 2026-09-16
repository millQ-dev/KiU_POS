import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DomainValidationError } from '../orders/errors.js';

type Client = pg.Pool | pg.PoolClient;

export type ModifierSelectionInput = {
  groupId: string;
  optionIds: string[];
};

export type ModifierGroupDto = {
  groupId: string;
  label: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: Array<{
    optionId: string;
    label: string;
    priceDeltaMinor: string;
    currencyCode: string;
    minorUnitExponent: number;
    position: number;
  }>;
};

export type ModifierSnapshot = {
  orderLineModifierId: string;
  groupId: string;
  optionId: string;
  groupLabel: string;
  optionLabel: string;
  priceDeltaMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
  position: number;
};

type GroupRow = {
  group_id: string;
  group_label: string;
  min_selections: number;
  max_selections: number;
  group_position: number;
  option_id: string;
  option_label: string;
  price_delta_minor: string;
  currency_code: string;
  minor_unit_exponent: number;
  option_position: number;
};

export class ModifierService {
  async getForCatalogItem(client: Client, tenantId: string, catalogItemId: string): Promise<ModifierGroupDto[]> {
    const result = await client.query<GroupRow>(
      `SELECT mg.modifier_group_id AS group_id, mg.label AS group_label,
              mig.min_selections, mig.max_selections, mig.position AS group_position,
              mo.modifier_option_id AS option_id, mo.label AS option_label,
              mo.price_delta_minor, mo.currency_code, mo.minor_unit_exponent,
              mo.position AS option_position
       FROM catalog_item_modifier_group mig
       JOIN modifier_group mg ON mg.modifier_group_id = mig.modifier_group_id
       JOIN modifier_option mo ON mo.modifier_group_id = mg.modifier_group_id
       WHERE mig.catalog_item_id = $1 AND mg.tenant_id = $2 AND mo.active = TRUE
       ORDER BY mig.position, mo.position`,
      [catalogItemId, tenantId],
    );
    const groups = new Map<string, ModifierGroupDto>();
    for (const row of result.rows) {
      const group = groups.get(row.group_id) ?? {
        groupId: row.group_id,
        label: row.group_label,
        required: row.min_selections > 0,
        minSelections: row.min_selections,
        maxSelections: row.max_selections,
        options: [],
      };
      group.options.push({
        optionId: row.option_id,
        label: row.option_label,
        priceDeltaMinor: row.price_delta_minor,
        currencyCode: row.currency_code,
        minorUnitExponent: row.minor_unit_exponent,
        position: row.option_position,
      });
      groups.set(row.group_id, group);
    }
    return [...groups.values()];
  }

  async validateSelection(
    client: Client,
    input: { tenantId: string; catalogItemId: string; selections?: ModifierSelectionInput[] },
  ): Promise<{ groups: ModifierGroupDto[]; snapshots: ModifierSnapshot[]; priceDeltaMinor: string }> {
    const groups = await this.getForCatalogItem(client, input.tenantId, input.catalogItemId);
    const selections = input.selections ?? [];
    const byGroup = new Map(groups.map((group) => [group.groupId, group]));
    const seenGroups = new Set<string>();
    const snapshots: ModifierSnapshot[] = [];
    let delta = 0n;

    for (const selection of selections) {
      const group = byGroup.get(selection.groupId);
      if (!group) {
        throw new DomainValidationError('MODIFIER_GROUP_INVALID', 'Selected modifier group is not configured for this item');
      }
      if (seenGroups.has(selection.groupId)) {
        throw new DomainValidationError('MODIFIER_SELECTION_INVALID', 'Modifier group was selected more than once');
      }
      seenGroups.add(selection.groupId);
      const optionIds = [...new Set(selection.optionIds)];
      if (optionIds.length < group.minSelections || optionIds.length > group.maxSelections) {
        throw new DomainValidationError(
          'MODIFIER_SELECTION_INVALID',
          `${group.label} requires between ${group.minSelections} and ${group.maxSelections} selections`,
        );
      }
      const options = new Map(group.options.map((option) => [option.optionId, option]));
      for (const optionId of optionIds) {
        const option = options.get(optionId);
        if (!option) {
          throw new DomainValidationError('MODIFIER_OPTION_INVALID', `Selected option is not available in ${group.label}`);
        }
        delta += BigInt(option.priceDeltaMinor);
        snapshots.push({
          orderLineModifierId: randomUUID(),
          groupId: group.groupId,
          optionId: option.optionId,
          groupLabel: group.label,
          optionLabel: option.label,
          priceDeltaMinor: option.priceDeltaMinor,
          currencyCode: option.currencyCode,
          minorUnitExponent: option.minorUnitExponent,
          position: snapshots.length + 1,
        });
      }
    }

    for (const group of groups) {
      if (!seenGroups.has(group.groupId) && group.minSelections > 0) {
        throw new DomainValidationError('MODIFIERS_REQUIRED', `${group.label} requires a selection`);
      }
    }

    return { groups, snapshots, priceDeltaMinor: delta.toString() };
  }
}
