import { describe, expect, it } from 'vitest';
import {
  FactPath,
  IMPRINT_RESOLVER_VERSION,
  canonicalImprintValue,
  parseImprintAssertion,
  ImprintContractError,
} from '@millq/contracts';
import { assertFactPath, assertMinimizedText } from './imprint-rules.js';

describe('imprint contract boundary', () => {
  it('leaves persistence on the syntax gate used by I-02 fixtures', () => {
    expect(() => assertFactPath('menu.item.not_registered')).not.toThrow();
    expect(() => assertFactPath(FactPath.OutletIdentity)).not.toThrow();
    expect(() =>
      parseImprintAssertion({
        tenantId: '00000000-0000-4000-8000-000000000001',
        outletId: '00000000-0000-4000-8000-000000000002',
        factPath: 'menu.item.not_registered',
        origin: 'OBSERVED',
        sensitivityClass: 'PUBLIC_REFERENCE',
        provenance: {
          sourceModule: 'organization',
          sourceEntityType: 'Outlet',
          sourceEntityId: '00000000-0000-4000-8000-000000000002',
          sourceRevision: 'rev-1',
        },
        value: { outletId: '00000000-0000-4000-8000-000000000002', name: 'Cafe' },
      }),
    ).toThrow(ImprintContractError);
  });

  it('emits a canonical value the persistence text rule accepts', () => {
    const canonical = canonicalImprintValue(FactPath.OutletIdentity, {
      outletId: '00000000-0000-4000-8000-000000000002',
      name: 'Cafe',
    });
    expect(() => assertMinimizedText(canonical, 'canonical value', 256)).not.toThrow();
    expect(IMPRINT_RESOLVER_VERSION).toBe('imprint-snapshot-1');
  });
});
