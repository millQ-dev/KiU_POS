import { describe, expect, it } from 'vitest';
import { POS_COPY_KEYS, posCopy } from './posCopy.js';

describe('POS localization coverage', () => {
  it.each(['en', 'ru', 'vi'] as const)('covers new modifier and payment strings in %s', (language) => {
    for (const key of POS_COPY_KEYS) expect(posCopy(language, key)).toMatch(/\S/);
  });
});
