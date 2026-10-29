import { describe, expect, it } from 'vitest';
import {
  buildKitchenInstructionsSnapshot,
  parseKitchenInstructionsSnapshot,
} from './kitchen-instructions.js';

describe('kitchen instructions snapshot (ADR-0052 M5)', () => {
  it('builds typed codes and guest note separately', () => {
    expect(
      buildKitchenInstructionsSnapshot({
        instructionCodes: ['MILK_OAT', 'EXTRA_SHOT'],
        guestNote: '  extra hot ',
      }),
    ).toEqual({
      instructionCodes: ['MILK_OAT', 'EXTRA_SHOT'],
      guestNote: 'extra hot',
    });
  });

  it('parses typed object and ignores guest note for code list consumers', () => {
    const parsed = parseKitchenInstructionsSnapshot({
      instructionCodes: ['MILK_OAT'],
      guestNote: 'no foam',
    });
    expect(parsed.instructionCodes).toEqual(['MILK_OAT']);
    expect(parsed.guestNote).toBe('no foam');
  });

  it('parses legacy string[] and lifts GUEST_NOTE_NON_AUTHORITATIVE prefix', () => {
    const parsed = parseKitchenInstructionsSnapshot([
      'MILK_OAT',
      'GUEST_NOTE_NON_AUTHORITATIVE:extra hot',
    ]);
    expect(parsed.instructionCodes).toEqual(['MILK_OAT']);
    expect(parsed.guestNote).toBe('extra hot');
  });
});
