import { createHash } from 'node:crypto';

/** Semantic fingerprint for production posting idempotency (frozen batch facts + chronology). */
export function productionPostFingerprint(input: {
  productionBatchId: string;
  preparationVersionId: string;
  warehouseId: string;
  legalEntityId: string;
  currencyCode: string;
  minorUnitExponent: number;
  businessDate: string;
  businessTime: string | null;
  businessOrder: number;
  actualOutputQuantity: string;
  actualOutputUnit: string;
  actualOutputDimension: string;
  deviationClass: string;
  inputs: Array<{
    lineNumber: number;
    catalogItemId: string;
    quantity: string;
    unit: string;
    dimension: string;
  }>;
}): string {
  const payload = {
    ...input,
    inputs: [...input.inputs].sort((a, b) => a.lineNumber - b.lineNumber),
  };
  return createHash('sha256').update(JSON.stringify(sortKeys(payload))).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}
