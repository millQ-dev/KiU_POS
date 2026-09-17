import { useState } from 'react';
import type { CashierContext } from '../../api/types.js';
import { CashierShell } from '../../cashier/CashierShell.js';
import { CashierWelcomeScreen, type WelcomeLanguage } from './CashierWelcomeScreen.js';

const fixtureContext: CashierContext = {
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

export function DesignLabCashierWelcome() {
  const [language, setLanguage] = useState<WelcomeLanguage>('ru');
  const [context, setContext] = useState<CashierContext | null>(null);

  if (context) {
    return (
      <CashierShell
        context={context}
        onChangeContext={() => setContext(null)}
      />
    );
  }

  return (
    <CashierWelcomeScreen
      context={fixtureContext}
      language={language}
      onLanguageChange={setLanguage}
      onContinue={() => setContext(fixtureContext)}
    />
  );
}
