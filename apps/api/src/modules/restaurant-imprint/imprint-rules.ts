import { createHash } from 'node:crypto';
import { ImprintPersistenceError } from './errors.js';

export const IMPRINT_ORIGINS = ['DECLARED', 'CONFIGURED', 'OBSERVED', 'TARGET'] as const;
export type ImprintOrigin = (typeof IMPRINT_ORIGINS)[number];

export const IMPRINT_FIELD_STATES = ['KNOWN', 'UNKNOWN', 'CONFLICT', 'STALE', 'DEGRADED'] as const;
export type ImprintFieldState = (typeof IMPRINT_FIELD_STATES)[number];

export const IMPRINT_SENSITIVITY = ['PUBLIC_REFERENCE', 'INTERNAL_REFERENCE'] as const;
export type ImprintSensitivity = (typeof IMPRINT_SENSITIVITY)[number];

const FACT_PATH = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SOURCE_MODULE = /^[a-z][a-z0-9_-]{0,63}$/;
const SOURCE_ENTITY_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const CURSOR_NAME = /^[a-z][a-z0-9_]{0,79}$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

export type AssertionInput = {
  tenantId: string;
  outletId: string;
  origin: ImprintOrigin;
  factPath: string;
  sensitivityClass: ImprintSensitivity;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceRevision: string;
  canonicalValue: string;
  supersedesClaimId?: string | null;
  observedAt?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  businessDate?: string | null;
  businessOrder?: string | null;
};

export type CursorInput = {
  tenantId: string;
  outletId: string;
  sourceModule: string;
  cursorName: string;
  watermark: string;
};

export type SnapshotFieldInput = {
  factPath: string;
  fieldState: ImprintFieldState;
  claimId?: string | null;
};

export type RebuildCursor = {
  sourceModule: string;
  cursorName: string;
  watermark: string;
};

export type RebuildField = {
  factPath: string;
  fieldState: string;
  claimId: string | null;
  canonicalValue: string | null;
};

export function imprintPayloadFingerprint(
  origin: string,
  factPath: string,
  canonicalValue: string,
): string {
  return createHash('sha256')
    .update(`${origin}\n${factPath}\n${canonicalValue}`, 'utf8')
    .digest('hex');
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCursorIdentity(left: RebuildCursor, right: RebuildCursor): number {
  const byModule = compareCodeUnits(left.sourceModule, right.sourceModule);
  if (byModule !== 0) return byModule;
  return compareCodeUnits(left.cursorName, right.cursorName);
}

export function imprintRebuildInputHash(input: {
  resolverVersion: string;
  cursors: readonly RebuildCursor[];
  fields: readonly RebuildField[];
}): string {
  const cursors = [...input.cursors].sort(compareCursorIdentity);
  const fields = [...input.fields].sort((a, b) => compareCodeUnits(a.factPath, b.factPath));
  const body = [
    `resolver=${input.resolverVersion}`,
    ...cursors.map((cursor) => `cursor=${cursor.sourceModule}|${cursor.cursorName}|${cursor.watermark}`),
    ...fields.map(
      (field) =>
        `field=${field.factPath}|${field.fieldState}|${field.claimId ?? ''}|${field.canonicalValue ?? ''}`,
    ),
  ].join('\n');
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function assertMinimizedText(value: string, label: string, max: number): void {
  if (value.length < 1 || value.length > max || CONTROL.test(value)) {
    throw new ImprintPersistenceError(
      'IMPRINT_VALUE_REJECTED',
      `${label} must be a short value without control characters`,
    );
  }
}

export function assertFactPath(factPath: string): void {
  if (!FACT_PATH.test(factPath) || factPath.length > 160) {
    throw new ImprintPersistenceError(
      'IMPRINT_PATH_REJECTED',
      'fact path must be a registered dotted identifier',
    );
  }
}

export function assertAssertionShape(input: AssertionInput): void {
  if (!IMPRINT_ORIGINS.includes(input.origin)) {
    throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'origin is not a claim origin');
  }
  if (!IMPRINT_SENSITIVITY.includes(input.sensitivityClass)) {
    throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'sensitivity class is not allowed');
  }
  assertFactPath(input.factPath);
  if (!SOURCE_MODULE.test(input.sourceModule)) {
    throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'source module is not a stable identifier');
  }
  if (!SOURCE_ENTITY_TYPE.test(input.sourceEntityType)) {
    throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'source entity type is not a stable identifier');
  }
  assertMinimizedText(input.sourceEntityId, 'source entity id', 80);
  assertMinimizedText(input.sourceRevision, 'source revision', 128);
  assertMinimizedText(input.canonicalValue, 'canonical value', 256);
  if (input.businessDate != null && !BUSINESS_DATE.test(input.businessDate)) {
    throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'business date must be a real source date');
  }
  if (input.businessOrder != null) assertMinimizedText(input.businessOrder, 'business order', 64);
  for (const [label, value] of [
    ['observed at', input.observedAt],
    ['effective from', input.effectiveFrom],
    ['effective to', input.effectiveTo],
  ] as const) {
    if (value != null && Number.isNaN(Date.parse(value))) {
      throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', `${label} is not a timestamp`);
    }
  }
}

export function assertCursorShape(input: CursorInput): void {
  if (!SOURCE_MODULE.test(input.sourceModule) || !CURSOR_NAME.test(input.cursorName)) {
    throw new ImprintPersistenceError('IMPRINT_VALUE_REJECTED', 'cursor identity is not stable');
  }
  assertMinimizedText(input.watermark, 'watermark', 256);
}

export function assertSnapshotField(input: SnapshotFieldInput): void {
  assertFactPath(input.factPath);
  if (!IMPRINT_FIELD_STATES.includes(input.fieldState)) {
    throw new ImprintPersistenceError('IMPRINT_FIELD_REJECTED', 'field state is not a snapshot state');
  }
  if (input.fieldState === 'KNOWN' && !input.claimId) {
    throw new ImprintPersistenceError('IMPRINT_FIELD_REJECTED', 'a known field names its claim');
  }
  if (input.fieldState !== 'KNOWN' && input.claimId) {
    throw new ImprintPersistenceError(
      'IMPRINT_FIELD_REJECTED',
      'unknown, conflict, stale, and degraded fields do not carry a winning value',
    );
  }
}
