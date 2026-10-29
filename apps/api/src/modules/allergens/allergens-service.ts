import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ModifierRecipeDelta } from '@millq/domain';
import {
  applyDeltasToComposition,
  assertAllergenCodes,
  resolveCatalogOffer,
  resolveConfiguredOffer,
  resolutionFingerprint,
  type AcknowledgementKind,
  type AllergenCaptureChoice,
  type AllergenFinding,
  type KitchenWarning,
  type ModificationCandidate,
  type OfferResolution,
  type OfferResult,
  type RequiredAcknowledgement,
} from './allergen-resolution.js';
import {
  loadBaseComposition,
  loadKitchenPolicies,
  loadLeafProfiles,
} from './composition-loader.js';
import { AllergenDomainError } from './errors.js';

const CAPTURE_CHOICES: readonly AllergenCaptureChoice[] = [
  'NO_ALLERGIES_CONFIRMED',
  'SELECT_ALLERGENS',
  'UNABLE_TO_CLARIFY',
];
const ACK_KINDS: readonly AcknowledgementKind[] = ['CASHIER_GUEST_INFORMED', 'KITCHEN_ACKNOWLEDGED'];
const MAX_ALLERGEN_CODES = 32;
const NO_CONFIGURATION = 'NONE';

export type OrderAllergenContext = {
  orderId: string;
  captureChoice: AllergenCaptureChoice;
  allergenCodes: string[];
  revision: number;
  capturedAt: string;
  frozen: boolean;
};

export type LineAllergenResolution = {
  orderLineId: string;
  catalogItemId: string;
  result: OfferResult;
  findings: AllergenFinding[];
  kitchenWarnings: KitchenWarning[];
  requiredAcknowledgements: RequiredAcknowledgement[];
  acknowledgedKinds: AcknowledgementKind[];
  resolutionFingerprint: string;
};

export type CatalogOfferResolution = OfferResolution & {
  catalogItemId: string;
  requiredOptions: Array<{ modifierGroupId: string; modifierOptionId: string }>;
};

type ContextRow = {
  capture_choice: AllergenCaptureChoice;
  allergen_codes: string[];
  revision: number;
  captured_at: Date;
  frozen_at: Date | null;
};

type LineRow = { order_line_id: string; catalog_item_id: string; line_number: number };

function toContext(orderId: string, r: ContextRow): OrderAllergenContext {
  return {
    orderId,
    captureChoice: r.capture_choice,
    allergenCodes: r.allergen_codes,
    revision: r.revision,
    capturedAt: r.captured_at.toISOString(),
    frozen: r.frozen_at !== null,
  };
}

/**
 * ADR-0050 order-local allergen capture, deterministic resolution, kitchen warnings.
 * Reads Recipe/Modifier data; owns only order-scoped allergen context + resolution snapshots.
 * No CustomerProfile writes. No override catalog (LEGAL GATE).
 */
export class AllergensService {
  constructor(private readonly pool: Pool) {}

  /** Capture (or revise while OPEN and unfrozen) the order-local allergy context. */
  async captureContext(input: {
    orderId: string;
    captureChoice: string;
    allergenCodes?: readonly string[];
    actorId?: string | null;
  }): Promise<OrderAllergenContext> {
    if (!CAPTURE_CHOICES.includes(input.captureChoice as AllergenCaptureChoice)) {
      throw new AllergenDomainError('ALLERGEN_CAPTURE_CHOICE_INVALID', 'Unknown capture choice');
    }
    const choice = input.captureChoice as AllergenCaptureChoice;
    const rawCodes = input.allergenCodes ?? [];
    if (rawCodes.length > MAX_ALLERGEN_CODES) {
      throw new AllergenDomainError('ALLERGEN_CODES_INVALID', 'Too many allergen codes');
    }
    let codes: string[];
    try {
      codes = assertAllergenCodes(rawCodes);
    } catch (e) {
      throw new AllergenDomainError('ALLERGEN_CODES_INVALID', (e as Error).message);
    }
    if (choice === 'SELECT_ALLERGENS' && codes.length === 0) {
      throw new AllergenDomainError('ALLERGEN_CODES_REQUIRED', 'SELECT_ALLERGENS needs at least one code');
    }
    if (choice !== 'SELECT_ALLERGENS' && codes.length > 0) {
      throw new AllergenDomainError('ALLERGEN_CODES_FORBIDDEN', `${choice} must not carry allergen codes`);
    }

    return this.inTx(async (client) => {
      const order = await this.lockOpenOrder(client, input.orderId);
      const existing = await client.query<ContextRow>(
        `SELECT capture_choice, allergen_codes, revision, captured_at, frozen_at
         FROM order_allergen_context WHERE order_id = $1 FOR UPDATE`,
        [input.orderId],
      );
      const cur = existing.rows[0];
      if (cur?.frozen_at) {
        throw new AllergenDomainError('ALLERGEN_CONTEXT_FROZEN', 'Allergen context is frozen');
      }
      if (cur && cur.capture_choice === choice && sameCodes(cur.allergen_codes, codes)) {
        return toContext(input.orderId, cur);
      }
      await this.assertNoLiveSettlement(client, input.orderId);
      const revision = (cur?.revision ?? 0) + 1;
      if (cur) {
        await client.query(
          `UPDATE order_allergen_context
           SET capture_choice = $2, allergen_codes = $3::text[], revision = $4,
               captured_by = $5, captured_at = NOW()
           WHERE order_id = $1`,
          [input.orderId, choice, codes, revision, input.actorId ?? null],
        );
      } else {
        await client.query(
          `INSERT INTO order_allergen_context (
             order_allergen_context_id, tenant_id, order_id, capture_choice, allergen_codes,
             revision, captured_by
           ) VALUES ($1,$2,$3,$4,$5::text[],$6,$7)`,
          [randomUUID(), order.tenant_id, input.orderId, choice, codes, revision, input.actorId ?? null],
        );
      }
      await client.query(
        `INSERT INTO order_allergen_context_event (
           order_allergen_context_event_id, tenant_id, order_id, revision, capture_choice,
           allergen_codes, actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6::text[],$7)`,
        [randomUUID(), order.tenant_id, input.orderId, revision, choice, codes, input.actorId ?? null],
      );
      // Context revision invalidates commercial acceptance (same pattern as line mutations / modifiers).
      await this.clearOpenCommercialTerms(client, input.orderId);
      const fresh = await client.query<ContextRow>(
        `SELECT capture_choice, allergen_codes, revision, captured_at, frozen_at
         FROM order_allergen_context WHERE order_id = $1`,
        [input.orderId],
      );
      return toContext(input.orderId, fresh.rows[0]!);
    });
  }

  async getContext(orderId: string): Promise<OrderAllergenContext | null> {
    const res = await this.pool.query<ContextRow>(
      `SELECT capture_choice, allergen_codes, revision, captured_at, frozen_at
       FROM order_allergen_context WHERE order_id = $1`,
      [orderId],
    );
    return res.rows[0] ? toContext(orderId, res.rows[0]) : null;
  }

  /**
   * Offer-level resolution for catalog items (before a line exists).
   * Surfaces required modifier options for AVAILABLE_WITH_MODIFICATION.
   */
  async resolveOffers(input: {
    orderId: string;
    catalogItemIds: readonly string[];
  }): Promise<CatalogOfferResolution[]> {
    const client = await this.pool.connect();
    try {
      const order = await this.requireOrder(client, input.orderId);
      const ctx = await this.requireContext(client, input.orderId);
      const out: CatalogOfferResolution[] = [];
      for (const catalogItemId of [...new Set(input.catalogItemIds)]) {
        await this.assertCatalogItem(client, order.tenant_id, catalogItemId);
        const base = await loadBaseComposition(client, order.tenant_id, catalogItemId);
        const candidates = await this.loadCandidates(client, order.tenant_id, catalogItemId);
        const leafIds = [
          ...base.leafIds,
          ...candidates.flatMap((c) =>
            applyDeltasToComposition(base, c.deltas).leafIds,
          ),
        ];
        const profiles = await loadLeafProfiles(client, order.tenant_id, leafIds);
        const policies = await loadKitchenPolicies(client, order.tenant_id, ctx.allergen_codes);
        const resolved =
          ctx.capture_choice === 'SELECT_ALLERGENS'
            ? resolveCatalogOffer(
                {
                  choice: ctx.capture_choice,
                  allergenCodes: ctx.allergen_codes,
                  base,
                  profiles,
                  policies,
                },
                candidates,
              )
            : {
                ...resolveConfiguredOffer({
                  choice: ctx.capture_choice,
                  allergenCodes: ctx.allergen_codes,
                  base,
                  effective: base,
                  profiles,
                  policies,
                }),
                requiredOptions: [],
              };
        out.push({ catalogItemId, ...resolved });
      }
      return out;
    } finally {
      client.release();
    }
  }

  /**
   * Resolve every unfrozen line against the CURRENT context and ACTUAL line configuration
   * (frozen Effective Recipe deltas from order_line_configuration, ADR-0049 #9).
   */
  async resolveOrderLines(orderId: string): Promise<LineAllergenResolution[]> {
    return this.inTx(async (client) => {
      const order = await this.lockOpenOrder(client, orderId);
      const ctx = await this.requireContext(client, orderId);
      const lines = await this.loadLines(client, orderId);
      for (const line of lines) {
        const frozen = await client.query(
          `SELECT 1 FROM order_line_allergen_resolution WHERE order_line_id = $1 AND frozen_at IS NOT NULL`,
          [line.order_line_id],
        );
        if (frozen.rowCount) continue;
        const cfg = await this.loadLineConfig(client, line.order_line_id);
        const base = await loadBaseComposition(client, order.tenant_id, line.catalog_item_id);
        const effective = applyDeltasToComposition(base, cfg.deltas);
        const profiles = await loadLeafProfiles(client, order.tenant_id, [
          ...base.leafIds,
          ...effective.leafIds,
        ]);
        const policies = await loadKitchenPolicies(client, order.tenant_id, ctx.allergen_codes);
        const resolution = resolveConfiguredOffer({
          choice: ctx.capture_choice,
          allergenCodes: ctx.allergen_codes,
          base,
          effective,
          profiles,
          policies,
        });
        const fingerprint = resolutionFingerprint({
          orderLineId: line.order_line_id,
          contextRevision: ctx.revision,
          choice: ctx.capture_choice,
          allergenCodes: ctx.allergen_codes,
          configurationFingerprint: cfg.fingerprint,
          resolution,
        });
        await client.query(
          `INSERT INTO order_line_allergen_resolution (
             order_line_allergen_resolution_id, tenant_id, order_id, order_line_id, context_revision,
             configuration_fingerprint, result, resolution_fingerprint, findings_json,
             kitchen_warnings_json, required_acknowledgements_json
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)
           ON CONFLICT (order_line_id) DO UPDATE SET
             context_revision = EXCLUDED.context_revision,
             configuration_fingerprint = EXCLUDED.configuration_fingerprint,
             result = EXCLUDED.result,
             resolution_fingerprint = EXCLUDED.resolution_fingerprint,
             findings_json = EXCLUDED.findings_json,
             kitchen_warnings_json = EXCLUDED.kitchen_warnings_json,
             required_acknowledgements_json = EXCLUDED.required_acknowledgements_json,
             resolved_at = NOW()`,
          [
            randomUUID(),
            order.tenant_id,
            orderId,
            line.order_line_id,
            ctx.revision,
            cfg.fingerprint,
            resolution.result,
            fingerprint,
            JSON.stringify(resolution.findings),
            JSON.stringify(resolution.kitchenWarnings),
            JSON.stringify(resolution.requiredAcknowledgements),
          ],
        );
      }
      // Drop snapshots for lines that no longer exist is handled by ON DELETE CASCADE.
      return this.readLineResolutions(client, orderId);
    });
  }

  async getLineResolutions(orderId: string): Promise<LineAllergenResolution[]> {
    const client = await this.pool.connect();
    try {
      await this.requireOrder(client, orderId);
      return await this.readLineResolutions(client, orderId);
    } finally {
      client.release();
    }
  }

  /**
   * Record a human review acknowledgement for the CURRENT resolution of a line.
   * Idempotent per (line, kind, resolution fingerprint). BLOCKED lines cannot be acknowledged:
   * there is no override path (LEGAL GATE).
   */
  async recordAcknowledgement(input: {
    orderId: string;
    orderLineId: string;
    kind: string;
    actorId?: string | null;
  }): Promise<{ acknowledged: true; kind: AcknowledgementKind; resolutionFingerprint: string }> {
    if (!ACK_KINDS.includes(input.kind as AcknowledgementKind)) {
      throw new AllergenDomainError('ALLERGEN_ACK_KIND_INVALID', 'Unknown acknowledgement kind');
    }
    const kind = input.kind as AcknowledgementKind;
    return this.inTx(async (client) => {
      const order = await this.lockOpenOrder(client, input.orderId);
      const ctx = await this.requireContext(client, input.orderId);
      const row = await client.query<{
        result: OfferResult;
        context_revision: number;
        configuration_fingerprint: string;
        resolution_fingerprint: string;
        required_acknowledgements_json: RequiredAcknowledgement[];
        frozen_at: Date | null;
      }>(
        `SELECT result, context_revision, configuration_fingerprint, resolution_fingerprint,
                required_acknowledgements_json, frozen_at
         FROM order_line_allergen_resolution
         WHERE order_line_id = $1 AND order_id = $2 FOR UPDATE`,
        [input.orderLineId, input.orderId],
      );
      const res = row.rows[0];
      if (!res) {
        throw new AllergenDomainError('ALLERGEN_RESOLUTION_MISSING', 'Resolve the order line first');
      }
      if (res.frozen_at) {
        throw new AllergenDomainError('ALLERGEN_RESOLUTION_FROZEN', 'Resolution is frozen');
      }
      const cfg = await this.loadLineConfig(client, input.orderLineId);
      if (res.context_revision !== ctx.revision || res.configuration_fingerprint !== cfg.fingerprint) {
        throw new AllergenDomainError(
          'ALLERGEN_REVALIDATION_REQUIRED',
          'Allergen context or line configuration changed; re-resolve before acknowledging',
        );
      }
      if (res.result === 'BLOCKED') {
        throw new AllergenDomainError(
          'ALLERGEN_LINE_BLOCKED',
          'Blocked lines cannot be acknowledged; remove or reconfigure the line',
        );
      }
      if (!res.required_acknowledgements_json.some((a) => a.kind === kind)) {
        throw new AllergenDomainError('ALLERGEN_ACK_NOT_REQUIRED', `${kind} is not required for this line`);
      }
      await client.query(
        `INSERT INTO order_line_allergen_acknowledgement (
           order_line_allergen_acknowledgement_id, tenant_id, order_id, order_line_id,
           acknowledgement_kind, resolution_fingerprint, acknowledged_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (order_line_id, acknowledgement_kind, resolution_fingerprint) DO NOTHING`,
        [
          randomUUID(),
          order.tenant_id,
          input.orderId,
          input.orderLineId,
          kind,
          res.resolution_fingerprint,
          input.actorId ?? null,
        ],
      );
      return { acknowledged: true as const, kind, resolutionFingerprint: res.resolution_fingerprint };
    });
  }

  /** Structured kitchen payload: conspicuous warnings, preparation changes, required acks. */
  async getKitchenTicket(orderId: string) {
    const client = await this.pool.connect();
    try {
      await this.requireOrder(client, orderId);
      const ctx = await this.getContext(orderId);
      const lines = await this.readLineResolutions(client, orderId);
      const names = new Map<string, string>();
      const ids = new Set<string>();
      const lineDeltas = new Map<string, ModifierRecipeDelta[]>();
      const lineInstructions = new Map<string, string[]>();
      for (const l of lines) {
        const cfg = await this.loadLineConfig(client, l.orderLineId);
        lineDeltas.set(l.orderLineId, cfg.deltas);
        lineInstructions.set(l.orderLineId, cfg.kitchenInstructions);
        ids.add(l.catalogItemId);
        for (const d of cfg.deltas) {
          if (d.kind === 'REMOVE_COMPONENT') ids.add(d.targetCatalogItemId);
          else if (d.kind === 'REPLACE_COMPONENT') {
            ids.add(d.targetCatalogItemId);
            ids.add(d.replacementCatalogItemId);
          } else ids.add(d.addCatalogItemId);
        }
      }
      if (ids.size > 0) {
        const r = await client.query<{ catalog_item_id: string; name: string }>(
          `SELECT catalog_item_id, name FROM catalog_item WHERE catalog_item_id = ANY($1::uuid[])`,
          [[...ids]],
        );
        for (const row of r.rows) names.set(row.catalog_item_id, row.name);
      }
      const nameOf = (id: string) => names.get(id) ?? id;
      return {
        orderId,
        allergyContext: ctx
          ? {
              captureChoice: ctx.captureChoice,
              allergenCodes: ctx.allergenCodes,
              revision: ctx.revision,
            }
          : null,
        notice:
          'Structured allergy handling data. Not a safety certification; UNKNOWN is never safe.',
        lines: lines.map((l) => ({
          orderLineId: l.orderLineId,
          catalogItemId: l.catalogItemId,
          catalogItemName: nameOf(l.catalogItemId),
          result: l.result,
          kitchenWarnings: l.kitchenWarnings,
          preparationChanges: (lineDeltas.get(l.orderLineId) ?? []).map((d) =>
            d.kind === 'REMOVE_COMPONENT'
              ? { kind: d.kind, component: nameOf(d.targetCatalogItemId) }
              : d.kind === 'REPLACE_COMPONENT'
                ? {
                    kind: d.kind,
                    component: nameOf(d.targetCatalogItemId),
                    replacement: nameOf(d.replacementCatalogItemId),
                  }
                : { kind: d.kind, component: nameOf(d.addCatalogItemId) },
          ),
          // Guest note is carried verbatim but is non-authoritative (ADR-0049 #8).
          kitchenInstructions: lineInstructions.get(l.orderLineId) ?? [],
          requiredAcknowledgements: l.requiredAcknowledgements.map((a) => ({
            kind: a.kind,
            acknowledged: l.acknowledgedKinds.includes(a.kind),
          })),
        })),
      };
    } finally {
      client.release();
    }
  }

  /**
   * Commercial-accept gate (wired in OrdersService next to the ADR-0049 modifier gate).
   * ADR-0050: allergen capture is mandatory at order start — missing context fails closed.
   */
  async assertReadyWhenCaptured(client: PoolClient, orderId: string): Promise<void> {
    await this.assertReadyForCommercialAccept(client, orderId);
  }

  /** Fail-closed readiness: context captured, every line freshly resolved, none BLOCKED, acks recorded. */
  async assertReadyForCommercialAccept(client: PoolClient, orderId: string): Promise<void> {
    const ctxRes = await client.query<ContextRow>(
      `SELECT capture_choice, allergen_codes, revision, captured_at, frozen_at
       FROM order_allergen_context WHERE order_id = $1`,
      [orderId],
    );
    const ctx = ctxRes.rows[0];
    if (!ctx) {
      throw new AllergenDomainError('ALLERGEN_CONTEXT_MISSING', 'Allergen capture required at order start');
    }
    const lines = await this.loadLines(client, orderId);
    const states = await this.readLineResolutions(client, orderId);
    const byLine = new Map(states.map((s) => [s.orderLineId, s]));
    for (const line of lines) {
      const state = byLine.get(line.order_line_id);
      if (!state) {
        throw new AllergenDomainError(
          'ALLERGEN_REVALIDATION_REQUIRED',
          `Order line ${line.order_line_id} has no allergen resolution`,
        );
      }
      const res = await client.query<{ context_revision: number; configuration_fingerprint: string }>(
        `SELECT context_revision, configuration_fingerprint
         FROM order_line_allergen_resolution WHERE order_line_id = $1`,
        [line.order_line_id],
      );
      const cfg = await this.loadLineConfig(client, line.order_line_id);
      if (
        res.rows[0]!.context_revision !== ctx.revision ||
        res.rows[0]!.configuration_fingerprint !== cfg.fingerprint
      ) {
        throw new AllergenDomainError(
          'ALLERGEN_REVALIDATION_REQUIRED',
          `Order line ${line.order_line_id} allergen resolution is stale`,
        );
      }
      if (state.result === 'BLOCKED') {
        throw new AllergenDomainError(
          'ALLERGEN_LINE_BLOCKED',
          `Order line ${line.order_line_id} is blocked by the guest allergen context`,
        );
      }
      const missing = state.requiredAcknowledgements.filter(
        (a) => !state.acknowledgedKinds.includes(a.kind),
      );
      if (missing.length > 0) {
        throw new AllergenDomainError(
          'ALLERGEN_ACK_REQUIRED',
          `Order line ${line.order_line_id} missing acknowledgement: ${missing.map((m) => m.kind).join(', ')}`,
        );
      }
    }
  }

  /** Freeze the allergen context with the order lines (call alongside commercial accept). */
  async freezeForOrder(client: PoolClient, orderId: string): Promise<void> {
    await client.query(
      `UPDATE order_allergen_context SET frozen_at = COALESCE(frozen_at, NOW()) WHERE order_id = $1`,
      [orderId],
    );
    await client.query(
      `UPDATE order_line_allergen_resolution SET frozen_at = COALESCE(frozen_at, NOW()) WHERE order_id = $1`,
      [orderId],
    );
  }

  private async readLineResolutions(
    client: PoolClient,
    orderId: string,
  ): Promise<LineAllergenResolution[]> {
    const rows = await client.query<{
      order_line_id: string;
      catalog_item_id: string;
      result: OfferResult;
      resolution_fingerprint: string;
      findings_json: AllergenFinding[];
      kitchen_warnings_json: KitchenWarning[];
      required_acknowledgements_json: RequiredAcknowledgement[];
    }>(
      `SELECT r.order_line_id, l.catalog_item_id, r.result, r.resolution_fingerprint,
              r.findings_json, r.kitchen_warnings_json, r.required_acknowledgements_json
       FROM order_line_allergen_resolution r
       JOIN sales_order_line l ON l.order_line_id = r.order_line_id
       WHERE r.order_id = $1 ORDER BY l.line_number`,
      [orderId],
    );
    const acks = await client.query<{
      order_line_id: string;
      acknowledgement_kind: AcknowledgementKind;
      resolution_fingerprint: string;
    }>(
      `SELECT order_line_id, acknowledgement_kind, resolution_fingerprint
       FROM order_line_allergen_acknowledgement WHERE order_id = $1`,
      [orderId],
    );
    return rows.rows.map((r) => ({
      orderLineId: r.order_line_id,
      catalogItemId: r.catalog_item_id,
      result: r.result,
      findings: r.findings_json,
      kitchenWarnings: r.kitchen_warnings_json,
      requiredAcknowledgements: r.required_acknowledgements_json,
      acknowledgedKinds: acks.rows
        .filter(
          (a) =>
            a.order_line_id === r.order_line_id &&
            a.resolution_fingerprint === r.resolution_fingerprint,
        )
        .map((a) => a.acknowledgement_kind),
      resolutionFingerprint: r.resolution_fingerprint,
    }));
  }

  private async loadCandidates(
    client: PoolClient,
    tenantId: string,
    catalogItemId: string,
  ): Promise<ModificationCandidate[]> {
    const opts = await client.query<{
      modifier_group_id: string;
      modifier_option_id: string;
      selection_mode: 'SINGLE' | 'MULTI';
    }>(
      `SELECT o.modifier_group_id, o.modifier_option_id, g.selection_mode
       FROM catalog_item_modifier_group b
       JOIN modifier_group g ON g.modifier_group_id = b.modifier_group_id
       JOIN modifier_option o ON o.modifier_group_id = g.modifier_group_id
       WHERE b.catalog_item_id = $1 AND b.tenant_id = $2
       ORDER BY b.sort_order, g.code, o.sort_order, o.code`,
      [catalogItemId, tenantId],
    );
    const out: ModificationCandidate[] = [];
    for (const o of opts.rows) {
      const deltas = await this.loadOptionDeltas(client, o.modifier_option_id);
      if (deltas.length > 0) {
        out.push({
          modifierGroupId: o.modifier_group_id,
          modifierOptionId: o.modifier_option_id,
          selectionMode: o.selection_mode,
          deltas,
        });
      }
    }
    return out;
  }

  private async loadOptionDeltas(client: PoolClient, optionId: string): Promise<ModifierRecipeDelta[]> {
    const rows = await client.query<{
      delta_kind: string;
      target_catalog_item_id: string | null;
      replacement_catalog_item_id: string | null;
      add_catalog_item_id: string | null;
      add_quantity: string | null;
      add_unit: string | null;
      add_dimension: 'MASS' | 'VOLUME' | 'COUNT' | null;
    }>(
      `SELECT delta_kind, target_catalog_item_id, replacement_catalog_item_id,
              add_catalog_item_id, add_quantity, add_unit, add_dimension
       FROM modifier_option_recipe_delta WHERE modifier_option_id = $1 ORDER BY sort_order`,
      [optionId],
    );
    return rows.rows.flatMap((d): ModifierRecipeDelta[] => {
      if (d.delta_kind === 'REMOVE_COMPONENT' && d.target_catalog_item_id) {
        return [{ kind: 'REMOVE_COMPONENT', targetCatalogItemId: d.target_catalog_item_id }];
      }
      if (d.delta_kind === 'REPLACE_COMPONENT' && d.target_catalog_item_id && d.replacement_catalog_item_id) {
        return [
          {
            kind: 'REPLACE_COMPONENT',
            targetCatalogItemId: d.target_catalog_item_id,
            replacementCatalogItemId: d.replacement_catalog_item_id,
          },
        ];
      }
      if (
        d.delta_kind === 'ADD_COMPONENT' &&
        d.add_catalog_item_id &&
        d.add_quantity &&
        d.add_unit &&
        d.add_dimension
      ) {
        return [
          {
            kind: 'ADD_COMPONENT',
            addCatalogItemId: d.add_catalog_item_id,
            quantity: d.add_quantity,
            unit: d.add_unit,
            dimension: d.add_dimension,
          },
        ];
      }
      return [];
    });
  }

  private async loadLineConfig(
    client: PoolClient,
    orderLineId: string,
  ): Promise<{ fingerprint: string; deltas: ModifierRecipeDelta[]; kitchenInstructions: string[] }> {
    const res = await client.query<{
      configuration_fingerprint: string;
      effective_recipe_deltas_json: ModifierRecipeDelta[];
      kitchen_instructions_json: string[];
    }>(
      `SELECT configuration_fingerprint, effective_recipe_deltas_json, kitchen_instructions_json
       FROM order_line_configuration WHERE order_line_id = $1`,
      [orderLineId],
    );
    const row = res.rows[0];
    if (!row) return { fingerprint: NO_CONFIGURATION, deltas: [], kitchenInstructions: [] };
    return {
      fingerprint: row.configuration_fingerprint,
      deltas: row.effective_recipe_deltas_json,
      kitchenInstructions: row.kitchen_instructions_json,
    };
  }

  private async loadLines(client: PoolClient, orderId: string): Promise<LineRow[]> {
    const res = await client.query<LineRow>(
      `SELECT order_line_id, catalog_item_id, line_number
       FROM sales_order_line WHERE order_id = $1 ORDER BY line_number`,
      [orderId],
    );
    return res.rows;
  }

  private async assertCatalogItem(client: PoolClient, tenantId: string, catalogItemId: string) {
    const r = await client.query(`SELECT 1 FROM catalog_item WHERE catalog_item_id = $1 AND tenant_id = $2`, [
      catalogItemId,
      tenantId,
    ]);
    if (!r.rowCount) {
      throw new AllergenDomainError('CATALOG_ITEM_NOT_FOUND', 'Catalog item not found');
    }
  }

  private async requireContext(client: PoolClient, orderId: string): Promise<ContextRow> {
    const res = await client.query<ContextRow>(
      `SELECT capture_choice, allergen_codes, revision, captured_at, frozen_at
       FROM order_allergen_context WHERE order_id = $1`,
      [orderId],
    );
    if (!res.rows[0]) {
      throw new AllergenDomainError('ALLERGEN_CONTEXT_MISSING', 'Allergen capture required at order start');
    }
    return res.rows[0];
  }

  private async requireOrder(client: PoolClient, orderId: string) {
    const res = await client.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM sales_order WHERE order_id = $1`,
      [orderId],
    );
    if (!res.rows[0]) throw new AllergenDomainError('ORDER_NOT_FOUND', 'Order not found');
    return res.rows[0];
  }

  private async lockOpenOrder(client: PoolClient, orderId: string) {
    const res = await client.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM sales_order WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = res.rows[0];
    if (!order) throw new AllergenDomainError('ORDER_NOT_FOUND', 'Order not found');
    if (order.status !== 'OPEN') {
      throw new AllergenDomainError('ORDER_NOT_OPEN', 'Allergen context changes only on OPEN orders');
    }
    return order;
  }

  /** ADR-0032: live Settlement freezes order commercial edits. */
  private async assertNoLiveSettlement(client: PoolClient, orderId: string): Promise<void> {
    const res = await client.query(
      `SELECT 1 FROM settlement_group
       WHERE order_id = $1 AND state IN ('COLLECTING', 'SATISFIED')
       LIMIT 1`,
      [orderId],
    );
    if ((res.rowCount ?? 0) > 0) {
      throw new AllergenDomainError(
        'SETTLEMENT_EDIT_LOCKED',
        'Order allergen context cannot change while a live Settlement exists',
      );
    }
  }

  private async clearOpenCommercialTerms(client: PoolClient, orderId: string): Promise<void> {
    await client.query(`DELETE FROM sales_order_commercial_line_terms WHERE order_id = $1`, [orderId]);
    await client.query(`DELETE FROM sales_order_commercial_terms WHERE order_id = $1`, [orderId]);
  }

  private async inTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}
