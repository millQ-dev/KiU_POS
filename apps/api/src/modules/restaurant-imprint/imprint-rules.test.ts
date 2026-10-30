import { describe, expect, it } from 'vitest';
import {
  assertMinimizedText,
  imprintPayloadFingerprint,
  imprintRebuildInputHash,
} from './imprint-rules.js';
import { ImprintPersistenceError } from './errors.js';

describe('imprint persistence rules', () => {
  it('hashes the same minimized value to one fingerprint', () => {
    const first = imprintPayloadFingerprint('OBSERVED', 'organization.outlet.identity', 'outlet-a');
    const second = imprintPayloadFingerprint('OBSERVED', 'organization.outlet.identity', 'outlet-a');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(imprintPayloadFingerprint('DECLARED', 'organization.outlet.identity', 'outlet-a')).not.toBe(first);
  });

  it('builds the same rebuild hash when cursor and field order changes', () => {
    const left = imprintRebuildInputHash({
      resolverVersion: 'imprint-snapshot-1',
      cursors: [
        { sourceModule: 'organization', cursorName: 'outlet', watermark: 'rev-2' },
        { sourceModule: 'procurement', cursorName: 'receipt', watermark: 'rev-9' },
      ],
      fields: [
        { factPath: 'organization.outlet.identity', fieldState: 'KNOWN', claimId: 'c1', canonicalValue: 'Cafe' },
        { factPath: 'procurement.last_posted_receipt_ref', fieldState: 'UNKNOWN', claimId: null, canonicalValue: null },
      ],
    });
    const right = imprintRebuildInputHash({
      resolverVersion: 'imprint-snapshot-1',
      cursors: [
        { sourceModule: 'procurement', cursorName: 'receipt', watermark: 'rev-9' },
        { sourceModule: 'organization', cursorName: 'outlet', watermark: 'rev-2' },
      ],
      fields: [
        { factPath: 'procurement.last_posted_receipt_ref', fieldState: 'UNKNOWN', claimId: null, canonicalValue: null },
        { factPath: 'organization.outlet.identity', fieldState: 'KNOWN', claimId: 'c1', canonicalValue: 'Cafe' },
      ],
    });
    expect(left).toBe(right);
  });

  it('keeps one hash when cursor names would tie if a separator were ignored', () => {
    const forward = imprintRebuildInputHash({
      resolverVersion: 'imprint-snapshot-1',
      cursors: [
        { sourceModule: 'ab', cursorName: 'c', watermark: '1' },
        { sourceModule: 'a', cursorName: 'bc', watermark: '2' },
      ],
      fields: [],
    });
    const backward = imprintRebuildInputHash({
      resolverVersion: 'imprint-snapshot-1',
      cursors: [
        { sourceModule: 'a', cursorName: 'bc', watermark: '2' },
        { sourceModule: 'ab', cursorName: 'c', watermark: '1' },
      ],
      fields: [],
    });
    expect(forward).toBe(backward);
    expect(forward).not.toBe(
      imprintRebuildInputHash({
        resolverVersion: 'imprint-snapshot-1',
        cursors: [{ sourceModule: 'ab', cursorName: 'c', watermark: '1' }],
        fields: [],
      }),
    );
  });

  it('rejects a value that could carry raw text or control characters', () => {
    expect(() => assertMinimizedText('ok-id', 'canonical value', 256)).not.toThrow();
    expect(() => assertMinimizedText('line\nbreak', 'canonical value', 256)).toThrow(ImprintPersistenceError);
    expect(() => assertMinimizedText('x'.repeat(257), 'canonical value', 256)).toThrow(/short value/);
  });
});
