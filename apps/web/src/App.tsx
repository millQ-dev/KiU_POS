import { lazy, Suspense, useState } from 'react';
import type { CashierContext } from './api/types.js';
import { CashierShell } from './cashier/CashierShell.js';
import { DevContextBootstrap } from './cashier/DevContextBootstrap.js';

const STORAGE_KEY = 'millq.dev.cashierContext.v1';
const designLabEnabled = import.meta.env.VITE_ENABLE_DESIGN_LAB === 'true';
const DesignLabCashierWelcome = designLabEnabled
  ? lazy(() => import('./design-lab/cashier/DesignLabCashierWelcome.js').then((module) => ({ default: module.DesignLabCashierWelcome })))
  : null;

function readStored(): CashierContext | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CashierContext;
  } catch {
    return null;
  }
}

export function App() {
  const [context, setContext] = useState<CashierContext | null>(() => readStored());

  if (window.location.pathname === '/design-lab/cashier/01-welcome') {
    if (!DesignLabCashierWelcome) return null;
    return (
      <Suspense fallback={null}>
        <DesignLabCashierWelcome />
      </Suspense>
    );
  }

  if (!context) {
    return (
      <DevContextBootstrap
        onSelect={(ctx) => {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
          setContext(ctx);
        }}
      />
    );
  }

  return (
    <CashierShell
      context={context}
      onChangeContext={() => {
        sessionStorage.removeItem(STORAGE_KEY);
        setContext(null);
      }}
    />
  );
}
