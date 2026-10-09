import type { TerminalTopology } from '../cashier/buildCashierContext.js';

export type SessionUser = {
  userId: string;
  employeeId: string | null;
  displayName: string;
};

export type OpenCashShift = {
  cashShiftId: string;
  tenantId: string;
  terminalId: string;
  outletId: string;
  status: string;
  openingAmountMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
  authMode: string;
  openedAt: string;
};

/** Cookie-authenticated fetch — browser Origin/Referer for CSRF on mutations. */
export function sessionFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  });
}

export async function fetchCurrentSession(): Promise<SessionUser | null> {
  const res = await sessionFetch('/api/v1/identity/session');
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as SessionUser & { sessionToken?: string; tenantId?: string };
  if (body.sessionToken || body.tenantId) return null;
  return {
    userId: body.userId,
    employeeId: body.employeeId,
    displayName: body.displayName,
  };
}

export async function logoutSession(): Promise<void> {
  await sessionFetch('/api/v1/identity/session/logout', { method: 'POST' });
}

export async function listCashTerminals(): Promise<TerminalTopology[]> {
  const res = await sessionFetch('/api/v1/cash/terminals');
  if (!res.ok) throw new Error('TERMINALS_UNAVAILABLE');
  const body = (await res.json()) as { terminals: TerminalTopology[] };
  return body.terminals ?? [];
}

export async function getCurrentCashShift(terminalId: string): Promise<OpenCashShift | null> {
  const res = await sessionFetch(
    `/api/v1/cash/shifts/current?terminalId=${encodeURIComponent(terminalId)}`,
  );
  if (!res.ok) throw new Error('CASH_SHIFT_LOOKUP_FAILED');
  const body = (await res.json()) as { shift: OpenCashShift | null };
  return body.shift;
}
