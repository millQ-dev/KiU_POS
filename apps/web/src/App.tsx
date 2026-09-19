import { useState } from 'react';
import type { CashierContext } from './api/types.js';
import { CashierShell } from './cashier/CashierShell.js';
import { DevContextBootstrap } from './cashier/DevContextBootstrap.js';
import {
  AuthenticatedIdentityHome,
  PinAuthScreen,
} from './cashier/PinAuthScreen.js';
import {
  clearCompanyRealm,
  CompanyIdentificationScreen,
  readCompanyRealm,
  type CompanyRealm,
} from './cashier/CompanyIdentificationScreen.js';
import { GuestMenuPage } from './guest/GuestMenuPage.js';

const DEV_STORAGE_KEY = 'millq.dev.cashierContext.v1';

function readDevStored(): CashierContext | null {
  try {
    const raw = sessionStorage.getItem(DEV_STORAGE_KEY);
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

function useDevCashierPath(): boolean {
  return new URLSearchParams(window.location.search).get('devCashier') === '1';
}

type AuthUser = {
  userId: string;
  employeeId: string | null;
  displayName: string;
};

export function App() {
  const guestToken = guestTokenFromPath();
  if (guestToken) {
    return <GuestMenuPage opaqueToken={guestToken} />;
  }

  const preferDev = useDevCashierPath();
  const [devContext, setDevContext] = useState<CashierContext | null>(() =>
    preferDev ? readDevStored() : null,
  );
  const [realm, setRealm] = useState<CompanyRealm | null>(() =>
    preferDev ? null : readCompanyRealm(),
  );
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  if (preferDev) {
    if (!devContext) {
      return (
        <DevContextBootstrap
          onSelect={(ctx) => {
            sessionStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(ctx));
            setDevContext(ctx);
          }}
        />
      );
    }
    return (
      <CashierShell
        context={devContext}
        onChangeContext={() => {
          sessionStorage.removeItem(DEV_STORAGE_KEY);
          setDevContext(null);
        }}
      />
    );
  }

  if (!realm) {
    return (
      <CompanyIdentificationScreen
        onResolved={(r) => {
          setRealm(r);
          setAuthUser(null);
        }}
      />
    );
  }

  if (!authUser) {
    return (
      <PinAuthScreen
        realm={realm}
        onAuthenticated={setAuthUser}
        onChangeCompany={() => {
          clearCompanyRealm();
          setRealm(null);
          setAuthUser(null);
        }}
      />
    );
  }

  return (
    <AuthenticatedIdentityHome
      user={authUser}
      realm={realm}
      onLogout={() => {
        setAuthUser(null);
      }}
    />
  );
}
