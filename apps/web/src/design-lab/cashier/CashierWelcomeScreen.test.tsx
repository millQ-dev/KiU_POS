import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CashierWelcomeScreen } from './CashierWelcomeScreen.js';
import type { CashierContext } from '../../api/types.js';

const context: CashierContext = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  tenantName: 'KiU Vietnam Demo',
  brandId: '10000000-0000-4000-8000-000000000002',
  brandName: 'Little Saigon Cafe',
  outletId: '10000000-0000-4000-8000-000000000003',
  outletName: 'Thao Dien Counter',
  legalEntityId: '10000000-0000-4000-8000-000000000004',
  legalEntityName: 'KiU Vietnam Demo LLC',
  orderChannel: 'DIRECT',
  cashShiftId: '10000000-0000-4000-8000-000000000005',
  cashierId: '10000000-0000-4000-8000-000000000006',
  deviceId: 'POS-01',
  openingCashMinor: '500000',
  shiftStatus: 'OPEN',
};

describe('cashier welcome design-lab screen', () => {
  it('renders the RU pilot state and supports EN/VI stress language selection', () => {
    function Harness() {
      const [language, setLanguage] = useState<'ru' | 'en' | 'vi'>('ru');
      return (
        <CashierWelcomeScreen
          context={context}
          language={language}
          onLanguageChange={setLanguage}
          onContinue={() => undefined}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole('heading', { name: 'Готовы к рабочему дню' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть кассу' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { name: 'Ready for service' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'VI' }));
    expect(screen.getByRole('heading', { name: 'Sẵn sàng phục vụ' })).toBeTruthy();
  });
});
