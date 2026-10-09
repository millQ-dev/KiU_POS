import { useCallback, useEffect, useRef, useState } from 'react';
import type { CashierContext } from './api/types.js';
import {
  fetchCurrentSession,
  logoutSession,
  type OpenCashShift,
  type SessionUser,
} from './api/sessionClient.js';
import {
  buildProductionCashierContext,
  type TerminalTopology,
} from './cashier/buildCashierContext.js';
import { CashierShell } from './cashier/CashierShell.js';
import {
  clearCompanyRealm,
  CompanyIdentificationScreen,
  readCompanyRealm,
  type CompanyRealm,
} from './cashier/CompanyIdentificationScreen.js';
import { DevContextBootstrap } from './cashier/DevContextBootstrap.js';
import {
  DEV_CASHIER_STORAGE_KEY,
  isDevCashierPathEnabled,
} from './cashier/devCashierGate.js';
import { OpeningCashScreen } from './cashier/OpeningCashScreen.js';
import { PinAuthScreen } from './cashier/PinAuthScreen.js';
import { GuestMenuPage } from './guest/GuestMenuPage.js';

function readDevStored(): CashierContext | null {
  if (!isDevCashierPathEnabled()) return null;
  try {
    const raw = sessionStorage.getItem(DEV_CASHIER_STORAGE_KEY);
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

type SessionPhase = 'idle' | 'resolving' | 'ready';

/**
 * CASHIER-1 production front door:
 * Company ID → PIN Session → Terminal → OPEN CashShift → server-derived CashierContext → CashierShell
 */
export function App() {
  const guestToken = guestTokenFromPath();
  const preferDev = isDevCashierPathEnabled();

  const [devContext, setDevContext] = useState<CashierContext | null>(() =>
    preferDev ? readDevStored() : null,
  );
  const [realm, setRealm] = useState<CompanyRealm | null>(() =>
    preferDev ? null : readCompanyRealm(),
  );
  const [authUser, setAuthUser] = useState<SessionUser | null>(null);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('idle');
  const [cashierContext, setCashierContext] = useState<CashierContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  /** Bumps to cancel in-flight session resume and force a fresh resolve when needed. */
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const bootstrapGen = useRef(0);

  const clearLocalAuth = useCallback(() => {
    bootstrapGen.current += 1;
    setAuthUser(null);
    setCashierContext(null);
    setContextError(null);
  }, []);

  // Session resume after Company realm is known (production only).
  useEffect(() => {
    if (preferDev || guestToken || !realm) {
      setSessionPhase('idle');
      return;
    }
    const gen = ++bootstrapGen.current;
    setSessionPhase('resolving');
    void (async () => {
      const user = await fetchCurrentSession();
      if (bootstrapGen.current !== gen) return;
      setAuthUser(user);
      setSessionPhase('ready');
    })();
  }, [realm, sessionEpoch, preferDev, guestToken]);

  const enterShell = useCallback(
    (shift: OpenCashShift, terminal: TerminalTopology, company: CompanyRealm) => {
      try {
        const ctx = buildProductionCashierContext({
          realmDisplayName: company.displayName,
          shift,
          terminal,
        });
        setContextError(null);
        setCashierContext(ctx);
      } catch {
        setCashierContext(null);
        setContextError('Cash shift / terminal topology mismatch — cannot enter cashier');
      }
    },
    [],
  );

  async function handleLogout() {
    await logoutSession();
    clearLocalAuth();
    // Force session effect to re-resolve (will 401 → PIN) while keeping Company realm.
    setSessionEpoch((n) => n + 1);
  }

  async function handleChangeCompany() {
    await logoutSession();
    clearLocalAuth();
    clearCompanyRealm();
    setRealm(null);
    setSessionPhase('idle');
  }

  if (guestToken) {
    return <GuestMenuPage opaqueToken={guestToken} />;
  }

  // DEV-only path — impossible when import.meta.env.DEV is false.
  if (preferDev) {
    if (!devContext) {
      return (
        <DevContextBootstrap
          onSelect={(ctx) => {
            sessionStorage.setItem(DEV_CASHIER_STORAGE_KEY, JSON.stringify(ctx));
            setDevContext(ctx);
          }}
        />
      );
    }
    return (
      <CashierShell
        mode="dev"
        context={devContext}
        onChangeContext={() => {
          sessionStorage.removeItem(DEV_CASHIER_STORAGE_KEY);
          setDevContext(null);
        }}
      />
    );
  }

  if (!realm) {
    return (
      <CompanyIdentificationScreen
        onResolved={(r) => {
          // Always revoke prior Session before binding a new Company realm (shared terminal safety).
          void (async () => {
            await logoutSession();
            clearLocalAuth();
            setRealm(r);
            setSessionEpoch((n) => n + 1);
          })();
        }}
      />
    );
  }

  if (sessionPhase === 'resolving' || sessionPhase === 'idle') {
    return (
      <main className="session-resolving">
        <h1>{realm.displayName}</h1>
        <p role="status">Checking session…</p>
      </main>
    );
  }

  if (!authUser) {
    return (
      <PinAuthScreen
        realm={realm}
        onAuthenticated={(u) => {
          setAuthUser(u);
          setCashierContext(null);
          setContextError(null);
        }}
        onChangeCompany={() => {
          void handleChangeCompany();
        }}
      />
    );
  }

  if (cashierContext) {
    return (
      <CashierShell
        mode="production"
        context={cashierContext}
        onSignOut={() => {
          void handleLogout();
        }}
      />
    );
  }

  return (
    <>
      {contextError ? (
        <p role="alert" className="cashier-context-error">
          {contextError}
        </p>
      ) : null}
      <OpeningCashScreen
        user={authUser}
        realm={realm}
        onOpened={(shift, terminal) => enterShell(shift, terminal, realm)}
        onLogout={() => {
          void handleLogout();
        }}
      />
    </>
  );
}
