import { useState } from 'react';
import type { CashierContext } from './api/types.js';
import { CashierShell } from './cashier/CashierShell.js';
import { DevContextBootstrap } from './cashier/DevContextBootstrap.js';
import { GuestMenuPage } from './guest/GuestMenuPage.js';

const STORAGE_KEY = 'millq.dev.cashierContext.v1';

function readStored(): CashierContext | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CashierContext;
  } catch {
    return null;
  }
}

function guestTokenFromPath(): string | null {
  const m = window.location.pathname.match(/^\/m\/([A-Za-z0-9_-]{20,64})\/?$/);
  return m?.[1] ?? null;
}

export function App() {
  const guestToken = guestTokenFromPath();
  if (guestToken) {
    return <GuestMenuPage opaqueToken={guestToken} />;
  }

  const [context, setContext] = useState<CashierContext | null>(() => readStored());

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
