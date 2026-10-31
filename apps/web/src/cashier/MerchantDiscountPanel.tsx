import { useEffect, useMemo, useRef, useState } from 'react';
import { posApi } from '../api/client.js';
import { ApiError } from '../api/types.js';
import type { CommercialStatus as CommercialStatusDto } from '../api/types.js';
import {
  buildMerchantDiscountApprovalFingerprint,
  type MerchantDiscountMode,
} from './merchantDiscountFingerprint.js';
import './MerchantDiscountPanel.css';

const OPERATION_TYPE = 'orders.merchant_discount.apply';
const IDEMPOTENCY_PREFIX = 'millq.merchantDiscountIdempotency.';

export type MerchantDiscountAppliedView = {
  status: 'applied' | 'duplicate';
  discountMinor: string;
  netMerchandiseSalesMinor: string;
  reason: string;
  mode: MerchantDiscountMode;
};

type Props = {
  orderId: string;
  outletId: string;
  terminalId: string | null;
  commercial: CommercialStatusDto | null;
  settlementLive: boolean;
  editable: boolean;
  busy: boolean;
  onApplied: (result: MerchantDiscountAppliedView) => void | Promise<void>;
};

type Phase = 'entry' | 'awaiting_approval' | 'uncertain' | 'applied';

function readAppliedFromCommercial(
  commercial: CommercialStatusDto | null,
): MerchantDiscountAppliedView | null {
  const md = commercial?.roundingProvenance?.orderProvenance?.merchantDiscount;
  if (!md || typeof md.discountMinor !== 'string' || md.discountMinor === '0') return null;
  return {
    status: 'applied',
    discountMinor: md.discountMinor,
    netMerchandiseSalesMinor:
      typeof md.netMerchandiseSalesMinor === 'string' ? md.netMerchandiseSalesMinor : '—',
    reason: typeof md.reason === 'string' ? md.reason : '',
    mode: md.mode === 'PERCENT' ? 'PERCENT' : 'FIXED_MINOR',
  };
}

/** Stable signature of server discount provenance for remount / stale-clear. */
export function merchantDiscountCommercialSignature(
  commercial: CommercialStatusDto | null,
): string {
  const md = readAppliedFromCommercial(commercial);
  return `${commercial?.commercialState ?? 'none'}:${md?.discountMinor ?? '0'}:${commercial?.presentationHint ?? ''}`;
}

function loadOrCreateIdempotencyKey(orderId: string, attemptToken: string): string {
  const storageKey = `${IDEMPOTENCY_PREFIX}${orderId}.${attemptToken}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing && existing.length >= 8) return existing;
  } catch {
    /* ignore */
  }
  const next = `md-${orderId.slice(0, 8)}-${crypto.randomUUID()}`.slice(0, 128);
  try {
    sessionStorage.setItem(storageKey, next);
  } catch {
    /* ignore */
  }
  return next;
}

function clearIdempotencyKey(orderId: string, attemptToken: string): void {
  try {
    sessionStorage.removeItem(`${IDEMPOTENCY_PREFIX}${orderId}.${attemptToken}`);
  } catch {
    /* ignore */
  }
}

/**
 * ADR-0051 cashier UI for ApplyOrderMerchantDiscount.
 * Reuses existing approval + apply HTTP contracts. No new permissions or money rules.
 */
export function MerchantDiscountPanel({
  orderId,
  outletId,
  terminalId,
  commercial,
  settlementLive,
  editable,
  busy,
  onApplied,
}: Props) {
  const commercialAccepted = commercial?.commercialState === 'ACCEPTED';
  const fromServer = readAppliedFromCommercial(commercial);

  const [phase, setPhase] = useState<Phase>(() => (fromServer ? 'applied' : 'entry'));
  const [mode, setMode] = useState<MerchantDiscountMode>('FIXED_MINOR');
  const [amountMinor, setAmountMinor] = useState('');
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [applied, setApplied] = useState<MerchantDiscountAppliedView | null>(fromServer);
  const attemptTokenRef = useRef(crypto.randomUUID());
  const pendingKeyRef = useRef<string | null>(null);
  const holdLocalAppliedRef = useRef(false);
  const lastSignatureRef = useRef(merchantDiscountCommercialSignature(commercial));

  // Clear stale "applied" when commercial re-accept drops merchantDiscount; do not
  // clobber a just-succeeded local apply while parent reloads commercial.
  useEffect(() => {
    const signature = merchantDiscountCommercialSignature(commercial);
    const server = readAppliedFromCommercial(commercial);
    if (server) {
      holdLocalAppliedRef.current = false;
      lastSignatureRef.current = signature;
      // Provenance omits netMerchandiseSalesMinor — keep apply-response net when discount matches.
      setApplied((prev) => {
        if (
          prev &&
          prev.discountMinor === server.discountMinor &&
          server.netMerchandiseSalesMinor === '—' &&
          prev.netMerchandiseSalesMinor !== '—'
        ) {
          return { ...server, netMerchandiseSalesMinor: prev.netMerchandiseSalesMinor };
        }
        return server;
      });
      if (phase === 'uncertain' || phase === 'awaiting_approval' || phase === 'entry') {
        setPhase('applied');
        setApprovalId(null);
        setError(null);
        pendingKeyRef.current = null;
      }
      return;
    }
    if (phase === 'uncertain' || phase === 'awaiting_approval') {
      lastSignatureRef.current = signature;
      return;
    }
    if (holdLocalAppliedRef.current) {
      if (signature !== lastSignatureRef.current) {
        // Parent reloaded commercial without discount after our local apply — unlikely;
        // drop the hold so a later reset can clear.
        holdLocalAppliedRef.current = false;
        lastSignatureRef.current = signature;
      }
      return;
    }
    if (phase === 'applied' && signature !== lastSignatureRef.current) {
      lastSignatureRef.current = signature;
      setApplied(null);
      setPhase('entry');
      setApprovalId(null);
      pendingKeyRef.current = null;
      attemptTokenRef.current = crypto.randomUUID();
      return;
    }
    lastSignatureRef.current = signature;
  }, [commercial, phase]);

  const disabled =
    !editable ||
    !commercialAccepted ||
    settlementLive ||
    !terminalId ||
    busy ||
    localBusy ||
    phase === 'applied';

  const currency = commercial?.currencyCode ?? 'VND';

  const formValid = useMemo(() => {
    if (reason.trim().length === 0) return false;
    if (mode === 'FIXED_MINOR') return /^[1-9]\d*$/.test(amountMinor);
    return /^\d{1,3}(?:\.\d{1,2})?$/.test(percent.trim()) && Number(percent) > 0;
  }, [reason, mode, amountMinor, percent]);

  async function reconcileAfterUncertain(): Promise<boolean> {
    const status = await posApi.getCommercialStatus(orderId);
    const found = readAppliedFromCommercial(status);
    if (found) {
      clearIdempotencyKey(orderId, attemptTokenRef.current);
      pendingKeyRef.current = null;
      setApplied(found);
      setPhase('applied');
      setError(null);
      await onApplied(found);
      return true;
    }
    return false;
  }

  async function tryApply(approvalRequestId?: string) {
    if (!terminalId) {
      setError('Terminal required to apply a discount');
      return;
    }
    setLocalBusy(true);
    setError(null);
    try {
      if (!pendingKeyRef.current) {
        pendingKeyRef.current = loadOrCreateIdempotencyKey(orderId, attemptTokenRef.current);
      }
      const body = {
        terminalId,
        idempotencyKey: pendingKeyRef.current,
        mode,
        reason: reason.trim(),
        ...(mode === 'FIXED_MINOR' ? { amountMinor } : { percent: percent.trim() }),
        ...(approvalRequestId ? { approvalRequestId } : {}),
      };
      const result = await posApi.applyMerchantDiscount(orderId, body);
      // HTTP success alone does not prove the command returned its final DTO.
      // Keep the attempt uncertain if a proxy or malformed response cannot be trusted.
      if (!result || (result.status !== 'applied' && result.status !== 'duplicate') ||
          result.orderId !== orderId || result.mode !== mode || result.reason !== reason.trim() ||
          result.certainty !== 'FINAL' || typeof result.discountMinor !== 'string' ||
          !/^\d+$/.test(result.discountMinor) || typeof result.netMerchandiseSalesMinor !== 'string' ||
          !/^\d+$/.test(result.netMerchandiseSalesMinor) ||
          (result.percentBasisPoints !== null && !Number.isInteger(result.percentBasisPoints)) ||
          typeof result.eligibleBasisMinor !== 'string' || !/^\d+$/.test(result.eligibleBasisMinor) ||
          (result.approvalRequestId !== null && typeof result.approvalRequestId !== 'string') ||
          typeof result.approverUserId !== 'string' || typeof result.semanticFingerprint !== 'string' ||
          !Array.isArray(result.lines) || result.lines.some((line) => !line ||
            typeof line.orderLineId !== 'string' || !Number.isInteger(line.lineNumber) ||
            typeof line.allocatedOrderMerchantDiscountMinor !== 'string' ||
            !/^\d+$/.test(line.allocatedOrderMerchantDiscountMinor) ||
            typeof line.netMerchandiseSalesMinor !== 'string' || !/^\d+$/.test(line.netMerchandiseSalesMinor))) {
        throw new Error('INVALID_DISCOUNT_RESPONSE');
      }
      const view: MerchantDiscountAppliedView = {
        status: result.status,
        discountMinor: result.discountMinor,
        netMerchandiseSalesMinor: result.netMerchandiseSalesMinor,
        reason: result.reason,
        mode: result.mode,
      };
      clearIdempotencyKey(orderId, attemptTokenRef.current);
      pendingKeyRef.current = null;
      attemptTokenRef.current = crypto.randomUUID();
      holdLocalAppliedRef.current = true;
      setApplied(view);
      setPhase('applied');
      setApprovalId(null);
      await onApplied(view);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'APPROVAL_REQUIRED') {
        try {
          const fingerprint = buildMerchantDiscountApprovalFingerprint({
            orderId,
            mode,
            ...(mode === 'FIXED_MINOR' ? { amountMinor } : { percent: percent.trim() }),
            reason,
          });
          const created = await posApi.createApprovalRequest({
            outletId,
            terminalId,
            operationType: OPERATION_TYPE,
            operationFingerprint: fingerprint,
          });
          setApprovalId(created.approvalRequestId);
          setPhase('awaiting_approval');
          setError(null);
        } catch (createErr) {
          setError(
            createErr instanceof ApiError
              ? createErr.message
              : 'Approval request failed',
          );
        }
        return;
      }
      if (err instanceof ApiError) {
        if (
          err.status === 401 ||
          err.status === 403 ||
          err.code === 'SETTLEMENT_EDIT_LOCKED' ||
          err.code === 'ORDER_IMMUTABLE' ||
          err.code === 'COMMERCIAL_TERMS_NOT_ACCEPTED' ||
          err.code === 'DISCOUNT_EXCEEDS_CAP' ||
          err.code === 'DISCOUNT_REASON_REQUIRED' ||
          err.code === 'IDEMPOTENCY_CONFLICT' ||
          err.code === 'VALIDATION'
        ) {
          setError(err.message || err.code);
          return;
        }
        if (err.status >= 500 || err.status === 0) {
          setPhase('uncertain');
          setError(
            'Discount outcome uncertain — check the order before applying again. The same attempt will not mint a new discount key.',
          );
          return;
        }
        setError(err.message || err.code);
        return;
      }
      // Network / abort / malformed — treat as uncertain; never auto-replay with a new key.
      setPhase('uncertain');
      setError(
        'Discount outcome uncertain — check the order before applying again. The same attempt will not mint a new discount key.',
      );
    } finally {
      setLocalBusy(false);
    }
  }

  async function onCheckOrder() {
    setLocalBusy(true);
    setError(null);
    try {
      const resolved = await reconcileAfterUncertain();
      if (!resolved) {
        setError(
          'Server still shows no merchant discount for this order. You may retry the same attempt, or cancel and start a new one after confirming nothing applied.',
        );
        setPhase('uncertain');
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reload commercial status — writes stay blocked until the check succeeds.',
      );
      setPhase('uncertain');
    } finally {
      setLocalBusy(false);
    }
  }

  async function onRetrySameAttempt() {
    await tryApply(approvalId ?? undefined);
  }

  async function onContinueAfterApproval() {
    if (!approvalId) return;
    await tryApply(approvalId);
  }

  function onCancelAttempt() {
    clearIdempotencyKey(orderId, attemptTokenRef.current);
    pendingKeyRef.current = null;
    attemptTokenRef.current = crypto.randomUUID();
    setApprovalId(null);
    setPhase(fromServer || applied ? 'applied' : 'entry');
    setError(null);
  }

  if (!commercialAccepted) {
    return (
      <section className="pos-merchant-discount" aria-label="Merchant discount">
        <h3 className="pos-merchant-discount__title">Merchant discount</h3>
        <p className="pos-merchant-discount__hint">
          Accept commercial terms before applying an order-level merchant discount.
        </p>
      </section>
    );
  }

  // Uncertain / approval must win over settlement lock so recovery actions stay available.
  if (phase === 'awaiting_approval') {
    return (
      <section className="pos-merchant-discount" aria-label="Merchant discount">
        <h3 className="pos-merchant-discount__title">Approval required</h3>
        <p className="pos-merchant-discount__hint">
          Waiting for a manager with orders.merchant_discount.approve. Continue only after they
          approve this request.
        </p>
        {settlementLive ? (
          <p className="pos-merchant-discount__alert" role="status">
            Settlement is already open — finish or abandon this approval attempt carefully.
          </p>
        ) : null}
        {error ? (
          <p className="pos-merchant-discount__alert" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pos-merchant-discount__actions">
          <button
            type="button"
            data-testid="merchant-discount-continue-approval"
            disabled={localBusy || busy || !approvalId || settlementLive}
            onClick={() => void onContinueAfterApproval()}
          >
            Continue after approval
          </button>
          <button type="button" disabled={localBusy || busy} onClick={onCancelAttempt}>
            Cancel attempt
          </button>
        </div>
      </section>
    );
  }

  if (phase === 'uncertain') {
    return (
      <section className="pos-merchant-discount" aria-label="Merchant discount">
        <h3 className="pos-merchant-discount__title">Discount outcome uncertain</h3>
        <p className="pos-merchant-discount__hint" role="alert">
          {error ??
            'The apply response was lost or incomplete. Check the order before mutating again. This screen will not auto-replay with a new key.'}
        </p>
        {settlementLive ? (
          <p className="pos-merchant-discount__alert" role="status">
            Settlement has started — reconcile this attempt before trusting the payable.
          </p>
        ) : null}
        <div className="pos-merchant-discount__actions">
          <button
            type="button"
            data-testid="merchant-discount-check-order"
            disabled={localBusy || busy}
            onClick={() => void onCheckOrder()}
          >
            Check order
          </button>
          <button
            type="button"
            data-testid="merchant-discount-retry-same"
            disabled={localBusy || busy || settlementLive}
            onClick={() => void onRetrySameAttempt()}
          >
            Retry same attempt
          </button>
          <button type="button" disabled={localBusy || busy} onClick={onCancelAttempt}>
            Cancel attempt
          </button>
        </div>
      </section>
    );
  }

  if (settlementLive) {
    return (
      <section className="pos-merchant-discount" aria-label="Merchant discount">
        <h3 className="pos-merchant-discount__title">Merchant discount</h3>
        <p className="pos-merchant-discount__hint" role="status">
          Settlement has started — merchant discount is locked.
        </p>
        {applied || fromServer ? (
          <p className="pos-merchant-discount__result" data-testid="merchant-discount-result">
            Discount {(applied ?? fromServer)!.discountMinor} {currency}; net merchandise{' '}
            {(applied ?? fromServer)!.netMerchandiseSalesMinor} {currency} (server)
          </p>
        ) : null}
      </section>
    );
  }

  if (phase === 'applied' && (applied || fromServer)) {
    const view = applied ?? fromServer!;
    return (
      <section className="pos-merchant-discount" aria-label="Merchant discount">
        <h3 className="pos-merchant-discount__title">Merchant discount</h3>
        <p className="pos-merchant-discount__result" data-testid="merchant-discount-result">
          Applied {view.mode === 'PERCENT' ? 'percent' : 'fixed'} discount{' '}
          {view.discountMinor} {currency}. Net merchandise (server):{' '}
          {view.netMerchandiseSalesMinor} {currency}.
          {view.reason ? ` Reason: ${view.reason}.` : ''}
        </p>
        <p className="pos-merchant-discount__hint">
          A second apply is not offered from this screen — re-apply requires a new commercial
          decision path.
        </p>
      </section>
    );
  }

  return (
    <section className="pos-merchant-discount" aria-label="Merchant discount">
      <h3 className="pos-merchant-discount__title">Merchant discount</h3>
      <p className="pos-merchant-discount__hint">
        Order-level merchant-funded discount (ADR-0051). Cap and rounding are enforced by the
        server. Final amounts shown only from the apply response.
      </p>
      {!terminalId ? (
        <p className="pos-merchant-discount__alert" role="alert">
          Open a cash shift / bind a terminal before applying a discount.
        </p>
      ) : null}
      <div className="pos-merchant-discount__row">
        <label>
          Mode
          <select
            data-testid="merchant-discount-mode"
            value={mode}
            disabled={disabled}
            onChange={(ev) => setMode(ev.target.value as MerchantDiscountMode)}
          >
            <option value="FIXED_MINOR">Fixed ({currency} minor)</option>
            <option value="PERCENT">Percent</option>
          </select>
        </label>
        {mode === 'FIXED_MINOR' ? (
          <label>
            Amount (minor)
            <input
              data-testid="merchant-discount-amount"
              inputMode="numeric"
              autoComplete="off"
              value={amountMinor}
              disabled={disabled}
              onChange={(ev) => setAmountMinor(ev.target.value.replace(/\D/g, '').slice(0, 18))}
            />
          </label>
        ) : (
          <label>
            Percent
            <input
              data-testid="merchant-discount-percent"
              inputMode="decimal"
              autoComplete="off"
              value={percent}
              disabled={disabled}
              onChange={(ev) => setPercent(ev.target.value.slice(0, 6))}
            />
          </label>
        )}
      </div>
      <label>
        Reason (required)
        <input
          className="pos-merchant-discount__reason"
          data-testid="merchant-discount-reason"
          value={reason}
          disabled={disabled}
          onChange={(ev) => setReason(ev.target.value.slice(0, 500))}
        />
      </label>
      {error ? (
        <p className="pos-merchant-discount__alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pos-merchant-discount__actions">
        <button
          type="button"
          data-testid="merchant-discount-apply"
          disabled={disabled || !formValid}
          onClick={() => void tryApply()}
        >
          {localBusy ? 'Applying…' : 'Apply discount'}
        </button>
      </div>
    </section>
  );
}
