import type { CashierContext } from '../api/types.js';

/** Server-derived terminal topology from GET /api/v1/cash/terminals. */
export type TerminalTopology = {
  outletId: string;
  outletName: string;
  terminalId: string;
  terminalCode: string;
  terminalName: string;
  brandId: string;
  brandName: string;
  legalEntityId: string;
  legalEntityName: string;
};

export type OpenCashShiftFacts = {
  cashShiftId: string;
  tenantId: string;
  terminalId: string;
  outletId: string;
  status: string;
};

/**
 * Build production CashierContext from authoritative server facts only.
 * Fail closed on Terminal ↔ CashShift mismatch.
 */
export function buildProductionCashierContext(input: {
  realmDisplayName: string;
  shift: OpenCashShiftFacts;
  terminal: TerminalTopology;
  orderChannel?: string;
}): CashierContext {
  if (input.shift.status !== 'OPEN') {
    throw new Error('CASH_SHIFT_NOT_OPEN');
  }
  if (input.shift.terminalId !== input.terminal.terminalId) {
    throw new Error('CASH_SHIFT_TERMINAL_MISMATCH');
  }
  if (input.shift.outletId !== input.terminal.outletId) {
    throw new Error('CASH_SHIFT_OUTLET_MISMATCH');
  }
  if (!input.shift.tenantId || !input.terminal.brandId || !input.terminal.legalEntityId) {
    throw new Error('CASHIER_TOPOLOGY_INCOMPLETE');
  }
  return {
    tenantId: input.shift.tenantId,
    tenantName: input.realmDisplayName,
    brandId: input.terminal.brandId,
    brandName: input.terminal.brandName,
    outletId: input.shift.outletId,
    outletName: input.terminal.outletName,
    legalEntityId: input.terminal.legalEntityId,
    legalEntityName: input.terminal.legalEntityName,
    orderChannel: input.orderChannel ?? 'DIRECT',
  };
}
