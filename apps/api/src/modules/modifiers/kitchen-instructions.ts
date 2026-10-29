/**
 * ADR-0052 M5 — typed kitchen instructions vs guest note in kitchen_instructions_json.
 * Instruction codes are authoritative for preparation. guestNote is non-authoritative
 * and must never feed allergen resolution or inventory.
 */
export type KitchenInstructionsSnapshot = {
  readonly instructionCodes: string[];
  readonly guestNote: string | null;
};

const GUEST_NOTE_PREFIX = 'GUEST_NOTE_NON_AUTHORITATIVE:';

export function buildKitchenInstructionsSnapshot(input: {
  instructionCodes: readonly string[];
  guestNote?: string | null;
}): KitchenInstructionsSnapshot {
  const guest = input.guestNote?.trim() ?? '';
  return {
    instructionCodes: [...input.instructionCodes],
    guestNote: guest.length > 0 ? guest : null,
  };
}

/**
 * Reads the typed snapshot. Legacy string[] rows (pre-M5) are accepted:
 * codes stay as instructionCodes; GUEST_NOTE_NON_AUTHORITATIVE:… becomes guestNote.
 */
export function parseKitchenInstructionsSnapshot(raw: unknown): KitchenInstructionsSnapshot {
  if (raw == null) {
    return { instructionCodes: [], guestNote: null };
  }
  if (Array.isArray(raw)) {
    const instructionCodes: string[] = [];
    let guestNote: string | null = null;
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      if (entry.startsWith(GUEST_NOTE_PREFIX)) {
        const note = entry.slice(GUEST_NOTE_PREFIX.length).trim();
        guestNote = note.length > 0 ? note : null;
      } else {
        instructionCodes.push(entry);
      }
    }
    return { instructionCodes, guestNote };
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const codes = Array.isArray(obj.instructionCodes)
      ? obj.instructionCodes.filter((c): c is string => typeof c === 'string')
      : [];
    const guest =
      typeof obj.guestNote === 'string' && obj.guestNote.trim().length > 0
        ? obj.guestNote.trim()
        : null;
    return { instructionCodes: codes, guestNote: guest };
  }
  return { instructionCodes: [], guestNote: null };
}
