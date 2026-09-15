import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  allocateOrderMerchantDiscount,
  commercialSnapshotSemanticHash,
  commercialTermsSemanticFingerprint,
  computeLineNetMerchandiseSalesMinor,
  InvalidMoneyError,
  type CommercialCertainty,
} from '@millq/domain';
import { DomainValidationError } from './errors.js';
import type { SetOrderCommercialTermsInput } from './types.js';

type Client = pg.PoolClient | pg.Pool;

type OrderLineRow = {
  order_line_id: string;
  order_id: string;
  line_number: number;
  catalog_item_id: string;
  quantity: string;
};

export type BuiltCommercialLine = {
  orderLineId: string;
  lineNumber: number;
  soldCatalogItemId: string;
  quantity: string;
  resolvedUnitPriceMinor: string | null;
  grossMerchandiseMinor: string;
  lineMerchantFundedDiscountMinor: string;
  allocatedOrderMerchantDiscountMinor: string;
  thirdPartyMerchandiseFundingMinor: string;
  netMerchandiseSalesMinor: string | null;
  taxMinor: string | null;
  certainty: CommercialCertainty;
  fundingProvenance: string | null;
  provenance: unknown;
  eligibleForOrderDiscount: boolean;
};

export type BuiltCommercialState = {
  currencyCode: string;
  minorUnitExponent: number;
  certainty: CommercialCertainty;
  orderMerchantFundedDiscountMinor: string;
  taxMinor: string | null;
  nonMerchandiseChargesMinor: string | null;
  tipMinor: string | null;
  customerPayableMinor: string | null;
  commercialResolution: string | null;
  provenance: unknown;
  grossMerchandiseMinor: string;
  merchantFundedDiscountMinor: string;
  thirdPartyMerchandiseFundingMinor: string;
  netMerchandiseSalesMinor: string | null;
  lines: BuiltCommercialLine[];
  semanticFingerprint: string;
};

function mapMoney(err: unknown): never {
  if (err instanceof InvalidMoneyError) {
    throw new DomainValidationError(err.code, err.message);
  }
  throw err;
}

/** Validate command against authoritative OrderLines and build computed commercial state. */
export function buildCommercialStateFromCommand(
  cmd: SetOrderCommercialTermsInput,
  orderLines: ReadonlyArray<OrderLineRow>,
): BuiltCommercialState {
  if (orderLines.length === 0) {
    throw new DomainValidationError('EMPTY_ORDER', 'Cannot set commercial terms on an order with no lines');
  }

  const byId = new Map(orderLines.map((l) => [l.order_line_id, l]));
  const seen = new Set<string>();

  for (const lt of cmd.lineTerms) {
    if (seen.has(lt.orderLineId)) {
      throw new DomainValidationError(
        'DUPLICATE_LINE_TERM',
        `Duplicate commercial term for orderLineId ${lt.orderLineId}`,
      );
    }
    seen.add(lt.orderLineId);
    if (!byId.has(lt.orderLineId)) {
      throw new DomainValidationError(
        'FOREIGN_ORDER_LINE',
        `OrderLine ${lt.orderLineId} does not belong to this Order`,
      );
    }
  }
  if (seen.size !== orderLines.length) {
    throw new DomainValidationError(
      'INCOMPLETE_LINE_TERMS',
      'Commercial lineTerms must cover every OrderLine exactly once',
    );
  }

  const currencyCode = cmd.currencyCode.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new DomainValidationError('INVALID_CURRENCY', 'currencyCode must be ISO 4217 alphabetic');
  }

  // Aggregate certainty: any UNKNOWN line or order → UNKNOWN
  let certainty: CommercialCertainty = cmd.certainty;
  for (const lt of cmd.lineTerms) {
    const c = lt.certainty ?? cmd.certainty;
    if (c === 'UNKNOWN') certainty = 'UNKNOWN';
  }

  type Prep = {
    orderLineId: string;
    lineNumber: number;
    soldCatalogItemId: string;
    quantity: string;
    resolvedUnitPriceMinor: string | null;
    grossMerchandiseMinor: string;
    lineMerchantFundedDiscountMinor: string;
    eligibleForOrderDiscount: boolean;
    thirdPartyMerchandiseFundingMinor: string;
    taxMinor: string | null;
    certainty: CommercialCertainty;
    fundingProvenance: string | null;
    provenance: unknown;
    basisMinor: string;
  };

  const prepared: Prep[] = [];
  try {
    for (const lt of cmd.lineTerms) {
      const ol = byId.get(lt.orderLineId)!;
      const gross = BigInt(lt.grossMerchandiseMinor);
      const lineDisc = BigInt(lt.lineMerchantFundedDiscountMinor);
      if (lineDisc > gross) {
        throw new InvalidMoneyError(
          `lineMerchantFundedDiscountMinor exceeds grossMerchandiseMinor for line ${ol.line_number}`,
        );
      }
      const basis =
        lt.eligibleForOrderDiscount !== false ? (gross - lineDisc).toString() : '0';
      prepared.push({
        orderLineId: lt.orderLineId,
        lineNumber: ol.line_number,
        soldCatalogItemId: ol.catalog_item_id,
        quantity: ol.quantity,
        resolvedUnitPriceMinor: lt.resolvedUnitPriceMinor ?? null,
        grossMerchandiseMinor: lt.grossMerchandiseMinor,
        lineMerchantFundedDiscountMinor: lt.lineMerchantFundedDiscountMinor,
        eligibleForOrderDiscount: lt.eligibleForOrderDiscount !== false,
        thirdPartyMerchandiseFundingMinor: lt.thirdPartyMerchandiseFundingMinor,
        taxMinor: lt.taxMinor ?? null,
        certainty: (lt.certainty ?? cmd.certainty) as CommercialCertainty,
        fundingProvenance: lt.fundingProvenance ?? null,
        provenance: lt.provenance ?? null,
        basisMinor: basis,
      });
    }

    const allocations = allocateOrderMerchantDiscount(
      cmd.orderMerchantFundedDiscountMinor,
      prepared
        .filter((p) => p.eligibleForOrderDiscount)
        .map((p) => ({
          orderLineId: p.orderLineId,
          lineNumber: p.lineNumber,
          basisMinor: p.basisMinor,
        })),
    );

    const lines: BuiltCommercialLine[] = prepared
      .map((p) => {
        const allocated = allocations.get(p.orderLineId) ?? '0';
        let net: string | null = null;
        if (certainty === 'FINAL') {
          net = computeLineNetMerchandiseSalesMinor({
            grossMerchandiseMinor: p.grossMerchandiseMinor,
            lineMerchantFundedDiscountMinor: p.lineMerchantFundedDiscountMinor,
            allocatedOrderMerchantDiscountMinor: allocated,
            thirdPartyMerchandiseFundingMinor: p.thirdPartyMerchandiseFundingMinor,
          });
        }
        return {
          orderLineId: p.orderLineId,
          lineNumber: p.lineNumber,
          soldCatalogItemId: p.soldCatalogItemId,
          quantity: p.quantity,
          resolvedUnitPriceMinor: p.resolvedUnitPriceMinor,
          grossMerchandiseMinor: p.grossMerchandiseMinor,
          lineMerchantFundedDiscountMinor: p.lineMerchantFundedDiscountMinor,
          allocatedOrderMerchantDiscountMinor: allocated,
          thirdPartyMerchandiseFundingMinor: p.thirdPartyMerchandiseFundingMinor,
          netMerchandiseSalesMinor: net,
          taxMinor: p.taxMinor,
          certainty: p.certainty,
          fundingProvenance: p.fundingProvenance,
          provenance: p.provenance,
          eligibleForOrderDiscount: p.eligibleForOrderDiscount,
        };
      })
      .sort((a, b) => a.lineNumber - b.lineNumber);

    let grossSum = 0n;
    let lineDiscSum = 0n;
    let thirdSum = 0n;
    let netSum = 0n;
    for (const l of lines) {
      grossSum += BigInt(l.grossMerchandiseMinor);
      lineDiscSum += BigInt(l.lineMerchantFundedDiscountMinor);
      thirdSum += BigInt(l.thirdPartyMerchandiseFundingMinor);
      if (certainty === 'FINAL') {
        netSum += BigInt(l.netMerchandiseSalesMinor!);
      }
    }
    const orderDisc = BigInt(cmd.orderMerchantFundedDiscountMinor);
    const merchantFundedDiscountMinor = (lineDiscSum + orderDisc).toString();
    const netMerchandiseSalesMinor = certainty === 'FINAL' ? netSum.toString() : null;

    if (certainty === 'FINAL') {
      // Conservation: sum(line nets) already equals netSum; cross-check formula at order level
      const expected =
        grossSum - lineDiscSum - orderDisc + thirdSum;
      if (expected !== netSum) {
        throw new InvalidMoneyError('Order net merchandise sales does not conserve line allocations');
      }
    }

    const fingerprintLines = lines.map((l) => ({
      orderLineId: l.orderLineId,
      lineNumber: l.lineNumber,
      soldCatalogItemId: l.soldCatalogItemId,
      resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
      grossMerchandiseMinor: l.grossMerchandiseMinor,
      lineMerchantFundedDiscountMinor: l.lineMerchantFundedDiscountMinor,
      eligibleForOrderDiscount: l.eligibleForOrderDiscount,
      thirdPartyMerchandiseFundingMinor: l.thirdPartyMerchandiseFundingMinor,
      taxMinor: l.taxMinor,
      certainty: l.certainty,
      fundingProvenance: l.fundingProvenance,
      provenance: l.provenance,
    }));

    const semanticFingerprint = commercialTermsSemanticFingerprint({
      currencyCode,
      minorUnitExponent: cmd.minorUnitExponent,
      certainty,
      orderMerchantFundedDiscountMinor: cmd.orderMerchantFundedDiscountMinor,
      taxMinor: cmd.taxMinor ?? null,
      nonMerchandiseChargesMinor: cmd.nonMerchandiseChargesMinor ?? null,
      tipMinor: cmd.tipMinor ?? null,
      customerPayableMinor: cmd.customerPayableMinor ?? null,
      commercialResolution: cmd.commercialResolution ?? null,
      provenance: cmd.provenance ?? null,
      lines: fingerprintLines,
    });

    return {
      currencyCode,
      minorUnitExponent: cmd.minorUnitExponent,
      certainty,
      orderMerchantFundedDiscountMinor: cmd.orderMerchantFundedDiscountMinor,
      taxMinor: cmd.taxMinor ?? null,
      nonMerchandiseChargesMinor: cmd.nonMerchandiseChargesMinor ?? null,
      tipMinor: cmd.tipMinor ?? null,
      customerPayableMinor: cmd.customerPayableMinor ?? null,
      commercialResolution: cmd.commercialResolution ?? null,
      provenance: cmd.provenance ?? null,
      grossMerchandiseMinor: grossSum.toString(),
      merchantFundedDiscountMinor,
      thirdPartyMerchandiseFundingMinor: thirdSum.toString(),
      netMerchandiseSalesMinor,
      lines,
      semanticFingerprint,
    };
  } catch (e) {
    mapMoney(e);
  }
}

export async function persistOpenCommercialTerms(
  client: Client,
  input: {
    orderId: string;
    tenantId: string;
    idempotencyKey: string;
    actorId: string | null;
    deviceId: string | null;
    state: BuiltCommercialState;
  },
): Promise<void> {
  await client.query(`DELETE FROM sales_order_commercial_line_terms WHERE order_id = $1`, [
    input.orderId,
  ]);
  await client.query(`DELETE FROM sales_order_commercial_terms WHERE order_id = $1`, [input.orderId]);

  await client.query(
    `INSERT INTO sales_order_commercial_terms (
       order_id, tenant_id, currency_code, minor_unit_exponent, certainty,
       order_merchant_funded_discount_minor, tax_minor, non_merchandise_charges_minor,
       tip_minor, customer_payable_minor, commercial_resolution, provenance_json,
       idempotency_key, semantic_fingerprint, actor_id, device_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)`,
    [
      input.orderId,
      input.tenantId,
      input.state.currencyCode,
      input.state.minorUnitExponent,
      input.state.certainty,
      input.state.orderMerchantFundedDiscountMinor,
      input.state.taxMinor,
      input.state.nonMerchandiseChargesMinor,
      input.state.tipMinor,
      input.state.customerPayableMinor,
      input.state.commercialResolution,
      JSON.stringify(input.state.provenance ?? {}),
      input.idempotencyKey,
      input.state.semanticFingerprint,
      input.actorId,
      input.deviceId,
    ],
  );

  for (const l of input.state.lines) {
    await client.query(
      `INSERT INTO sales_order_commercial_line_terms (
         order_line_id, order_id, line_number, sold_catalog_item_id,
         resolved_unit_price_minor, gross_merchandise_minor, line_merchant_funded_discount_minor,
         eligible_for_order_discount, third_party_merchandise_funding_minor, tax_minor,
         certainty, funding_provenance, provenance_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        l.orderLineId,
        input.orderId,
        l.lineNumber,
        l.soldCatalogItemId,
        l.resolvedUnitPriceMinor,
        l.grossMerchandiseMinor,
        l.lineMerchantFundedDiscountMinor,
        l.eligibleForOrderDiscount,
        l.thirdPartyMerchandiseFundingMinor,
        l.taxMinor,
        l.certainty,
        l.fundingProvenance,
        JSON.stringify(l.provenance ?? {}),
      ],
    );
  }
}

export async function loadBuiltCommercialState(
  client: Client,
  orderId: string,
): Promise<BuiltCommercialState | null> {
  const head = await client.query<{
    currency_code: string;
    minor_unit_exponent: number;
    certainty: CommercialCertainty;
    order_merchant_funded_discount_minor: string;
    tax_minor: string | null;
    non_merchandise_charges_minor: string | null;
    tip_minor: string | null;
    customer_payable_minor: string | null;
    commercial_resolution: string | null;
    provenance_json: unknown;
    semantic_fingerprint: string;
  }>(`SELECT * FROM sales_order_commercial_terms WHERE order_id = $1`, [orderId]);
  const h = head.rows[0];
  if (!h) return null;

  const linesRes = await client.query<{
    order_line_id: string;
    line_number: number;
    sold_catalog_item_id: string;
    resolved_unit_price_minor: string | null;
    gross_merchandise_minor: string;
    line_merchant_funded_discount_minor: string;
    eligible_for_order_discount: boolean;
    third_party_merchandise_funding_minor: string;
    tax_minor: string | null;
    certainty: CommercialCertainty;
    funding_provenance: string | null;
    provenance_json: unknown;
  }>(
    `SELECT clt.order_line_id, clt.line_number, clt.sold_catalog_item_id,
            clt.resolved_unit_price_minor, clt.gross_merchandise_minor,
            clt.line_merchant_funded_discount_minor, clt.eligible_for_order_discount,
            clt.third_party_merchandise_funding_minor, clt.tax_minor, clt.certainty,
            clt.funding_provenance, clt.provenance_json
     FROM sales_order_commercial_line_terms clt
     WHERE clt.order_id = $1
     ORDER BY clt.line_number ASC`,
    [orderId],
  );

  // Rebuild nets from stored components for freeze (allocations already stored? we didn't store allocated on OPEN terms)
  // Recompute allocation from OPEN terms for freeze consistency.
  const qtyByLine = new Map(
    (
      await client.query<{ order_line_id: string; quantity: string }>(
        `SELECT order_line_id, quantity FROM sales_order_line WHERE order_id = $1`,
        [orderId],
      )
    ).rows.map((r) => [r.order_line_id, r.quantity]),
  );

  const prepared = linesRes.rows.map((r) => {
    const gross = BigInt(r.gross_merchandise_minor);
    const lineDisc = BigInt(r.line_merchant_funded_discount_minor);
    const basis = r.eligible_for_order_discount ? (gross - lineDisc).toString() : '0';
    return { ...r, basisMinor: basis, quantity: qtyByLine.get(r.order_line_id) ?? '0' };
  });

  let allocations: ReadonlyMap<string, string>;
  try {
    allocations = allocateOrderMerchantDiscount(
      h.order_merchant_funded_discount_minor,
      prepared
        .filter((p) => p.eligible_for_order_discount)
        .map((p) => ({
          orderLineId: p.order_line_id,
          lineNumber: p.line_number,
          basisMinor: p.basisMinor,
        })),
    );
  } catch (e) {
    mapMoney(e);
  }

  const certainty = h.certainty;
  const lines: BuiltCommercialLine[] = prepared.map((p) => {
    const allocated = allocations.get(p.order_line_id) ?? '0';
    let net: string | null = null;
    if (certainty === 'FINAL') {
      try {
        net = computeLineNetMerchandiseSalesMinor({
          grossMerchandiseMinor: p.gross_merchandise_minor,
          lineMerchantFundedDiscountMinor: p.line_merchant_funded_discount_minor,
          allocatedOrderMerchantDiscountMinor: allocated,
          thirdPartyMerchandiseFundingMinor: p.third_party_merchandise_funding_minor,
        });
      } catch (e) {
        mapMoney(e);
      }
    }
    return {
      orderLineId: p.order_line_id,
      lineNumber: p.line_number,
      soldCatalogItemId: p.sold_catalog_item_id,
      quantity: p.quantity,
      resolvedUnitPriceMinor: p.resolved_unit_price_minor,
      grossMerchandiseMinor: p.gross_merchandise_minor,
      lineMerchantFundedDiscountMinor: p.line_merchant_funded_discount_minor,
      allocatedOrderMerchantDiscountMinor: allocated,
      thirdPartyMerchandiseFundingMinor: p.third_party_merchandise_funding_minor,
      netMerchandiseSalesMinor: net,
      taxMinor: p.tax_minor,
      certainty: p.certainty,
      fundingProvenance: p.funding_provenance,
      provenance: p.provenance_json,
      eligibleForOrderDiscount: p.eligible_for_order_discount,
    };
  });

  let grossSum = 0n;
  let lineDiscSum = 0n;
  let thirdSum = 0n;
  let netSum = 0n;
  for (const l of lines) {
    grossSum += BigInt(l.grossMerchandiseMinor);
    lineDiscSum += BigInt(l.lineMerchantFundedDiscountMinor);
    thirdSum += BigInt(l.thirdPartyMerchandiseFundingMinor);
    if (certainty === 'FINAL') netSum += BigInt(l.netMerchandiseSalesMinor!);
  }
  const orderDisc = BigInt(h.order_merchant_funded_discount_minor);

  return {
    currencyCode: h.currency_code,
    minorUnitExponent: h.minor_unit_exponent,
    certainty,
    orderMerchantFundedDiscountMinor: h.order_merchant_funded_discount_minor,
    taxMinor: h.tax_minor,
    nonMerchandiseChargesMinor: h.non_merchandise_charges_minor,
    tipMinor: h.tip_minor,
    customerPayableMinor: h.customer_payable_minor,
    commercialResolution: h.commercial_resolution,
    provenance: h.provenance_json,
    grossMerchandiseMinor: grossSum.toString(),
    merchantFundedDiscountMinor: (lineDiscSum + orderDisc).toString(),
    thirdPartyMerchandiseFundingMinor: thirdSum.toString(),
    netMerchandiseSalesMinor: certainty === 'FINAL' ? netSum.toString() : null,
    lines,
    semanticFingerprint: h.semantic_fingerprint,
  };
}

export async function freezeCommercialSnapshot(
  client: Client,
  input: {
    orderId: string;
    tenantId: string;
    legalEntityId: string;
    outletId: string;
    businessDate: string;
    businessOrder: number;
    businessTime: string | null;
    state: BuiltCommercialState;
  },
): Promise<{ snapshotId: string; semanticHash: string }> {
  const snapshotId = randomUUID();
  const semanticHash = commercialSnapshotSemanticHash({
    orderId: input.orderId,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    outletId: input.outletId,
    currencyCode: input.state.currencyCode,
    minorUnitExponent: input.state.minorUnitExponent,
    businessDate: input.businessDate,
    businessOrder: input.businessOrder,
    businessTime: input.businessTime,
    certainty: input.state.certainty,
    grossMerchandiseMinor: input.state.grossMerchandiseMinor,
    merchantFundedDiscountMinor: input.state.merchantFundedDiscountMinor,
    thirdPartyMerchandiseFundingMinor: input.state.thirdPartyMerchandiseFundingMinor,
    netMerchandiseSalesMinor: input.state.netMerchandiseSalesMinor,
    taxMinor: input.state.taxMinor,
    nonMerchandiseChargesMinor: input.state.nonMerchandiseChargesMinor,
    tipMinor: input.state.tipMinor,
    customerPayableMinor: input.state.customerPayableMinor,
    lines: input.state.lines.map((l) => ({
      lineNumber: l.lineNumber,
      orderLineId: l.orderLineId,
      soldCatalogItemId: l.soldCatalogItemId,
      quantity: l.quantity,
      resolvedUnitPriceMinor: l.resolvedUnitPriceMinor,
      grossMerchandiseMinor: l.grossMerchandiseMinor,
      lineMerchantFundedDiscountMinor: l.lineMerchantFundedDiscountMinor,
      allocatedOrderMerchantDiscountMinor: l.allocatedOrderMerchantDiscountMinor,
      thirdPartyMerchandiseFundingMinor: l.thirdPartyMerchandiseFundingMinor,
      netMerchandiseSalesMinor: l.netMerchandiseSalesMinor,
      taxMinor: l.taxMinor,
      certainty: l.certainty,
      fundingProvenance: l.fundingProvenance,
    })),
  });

  await client.query(
    `INSERT INTO order_commercial_snapshot (
       order_commercial_snapshot_id, order_id, tenant_id, legal_entity_id, outlet_id,
       currency_code, minor_unit_exponent, business_date, business_order, business_time,
       certainty, gross_merchandise_minor, merchant_funded_discount_minor,
       third_party_merchandise_funding_minor, net_merchandise_sales_minor,
       tax_minor, non_merchandise_charges_minor, tip_minor, customer_payable_minor,
       commercial_resolution, semantic_hash, provenance_json
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb
     )`,
    [
      snapshotId,
      input.orderId,
      input.tenantId,
      input.legalEntityId,
      input.outletId,
      input.state.currencyCode,
      input.state.minorUnitExponent,
      input.businessDate,
      input.businessOrder,
      input.businessTime,
      input.state.certainty,
      input.state.grossMerchandiseMinor,
      input.state.merchantFundedDiscountMinor,
      input.state.thirdPartyMerchandiseFundingMinor,
      input.state.netMerchandiseSalesMinor,
      input.state.taxMinor,
      input.state.nonMerchandiseChargesMinor,
      input.state.tipMinor,
      input.state.customerPayableMinor,
      input.state.commercialResolution,
      semanticHash,
      JSON.stringify(input.state.provenance ?? {}),
    ],
  );

  for (const l of input.state.lines) {
    await client.query(
      `INSERT INTO order_line_commercial_snapshot (
         order_line_commercial_snapshot_id, order_commercial_snapshot_id, order_line_id,
         line_number, sold_catalog_item_id, quantity, resolved_unit_price_minor,
         gross_merchandise_minor, line_merchant_funded_discount_minor,
         allocated_order_merchant_discount_minor, third_party_merchandise_funding_minor,
         net_merchandise_sales_minor, tax_minor, certainty, funding_provenance, provenance_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
      [
        randomUUID(),
        snapshotId,
        l.orderLineId,
        l.lineNumber,
        l.soldCatalogItemId,
        l.quantity,
        l.resolvedUnitPriceMinor,
        l.grossMerchandiseMinor,
        l.lineMerchantFundedDiscountMinor,
        l.allocatedOrderMerchantDiscountMinor,
        l.thirdPartyMerchandiseFundingMinor,
        l.netMerchandiseSalesMinor,
        l.taxMinor,
        l.certainty,
        l.fundingProvenance,
        JSON.stringify(l.provenance ?? {}),
      ],
    );
  }

  return { snapshotId, semanticHash };
}
