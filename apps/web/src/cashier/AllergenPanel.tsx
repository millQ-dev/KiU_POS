import { useCallback, useEffect, useId, useState } from 'react';
import {
  allergenApi,
  type AllergenAckKind,
  type AllergenCaptureChoice,
  type AllergenOfferResult,
  type AllergenState,
} from '../api/allergenApi.js';
import type { OrderLine } from '../api/types.js';
import './AllergenPanel.css';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;

const CHOICE_LABEL: Record<AllergenCaptureChoice, string> = {
  NO_ALLERGIES_CONFIRMED: 'Guests confirmed: no allergies',
  SELECT_ALLERGENS: 'Select allergens',
  UNABLE_TO_CLARIFY: 'Unable to clarify',
};

const RESULT_LABEL: Record<AllergenOfferResult, string> = {
  AVAILABLE: 'No declared conflict (not a guarantee)',
  AVAILABLE_WITH_MODIFICATION: 'Modification applied — kitchen must follow handling',
  BLOCKED: 'Blocked — contains allergen; remove or reconfigure line',
  REQUIRES_CONFIRMATION: 'Uncertain — confirm with guest and kitchen (never safe)',
};

const ACK_LABEL: Record<AllergenAckKind, string> = {
  CASHIER_GUEST_INFORMED: 'Guest informed',
  KITCHEN_ACKNOWLEDGED: 'Kitchen acknowledgement',
};

/** Parse "milk, egg" style input into validated codes; returns null on any malformed entry. */
export function parseAllergenCodes(raw: string): string[] | null {
  const parts = raw
    .split(/[,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => CODE_PATTERN.test(p))) return null;
  return [...new Set(parts)].sort();
}

type Props = {
  orderId: string;
  lines: OrderLine[];
  editable: boolean;
  /** Changes whenever lines or their configuration change, forcing revalidation. */
  refreshKey: string;
  /** Optional tenant-provided code suggestions; taxonomy is not hard-coded (LEGAL GATE). */
  suggestedCodes?: readonly string[];
};

export function AllergenPanel({ orderId, lines, editable, refreshKey, suggestedCodes = [] }: Props) {
  const titleId = useId();
  const [state, setState] = useState<AllergenState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<AllergenCaptureChoice | null>(null);
  const [codesInput, setCodesInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  const load = useCallback(
    async (forOrderId: string = orderId) => {
      setLoadError(null);
      try {
        const next = await allergenApi.getState(forOrderId);
        if (forOrderId !== orderId) return;
        setState(next);
        setLoaded(true);
      } catch (err) {
        if (forOrderId !== orderId) return;
        setState(null);
        setLoaded(true);
        setLoadError(err instanceof Error ? err.message : 'Failed to load allergen context');
      }
    },
    [orderId],
  );

  useEffect(() => {
    setState(null);
    setLoaded(false);
    setChoice(null);
    setCodesInput('');
    setChanging(false);
    setFormError(null);
    void load(orderId);
  }, [load, orderId]);

  const hasContext = !!state?.context;
  useEffect(() => {
    if (!hasContext || !editable) return;
    let cancelled = false;
    void allergenApi
      .resolve(orderId)
      .then((resolved) => {
        if (!cancelled) setState((prev) => (prev ? { ...prev, lines: resolved } : prev));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Allergen revalidation failed');
      });
    return () => {
      cancelled = true;
    };
  }, [hasContext, editable, orderId, refreshKey]);

  const submit = async () => {
    if (!choice) return;
    let codes: string[] = [];
    if (choice === 'SELECT_ALLERGENS') {
      const parsed = parseAllergenCodes(codesInput);
      if (!parsed) {
        setFormError('Enter one or more allergen codes (A–Z, 0–9, _), e.g. MILK, EGG');
        return;
      }
      codes = parsed;
    }
    setBusy(true);
    setFormError(null);
    try {
      setState(await allergenApi.capture(orderId, { captureChoice: choice, allergenCodes: codes }));
      setChanging(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Capture failed');
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (lineId: string, kind: AllergenAckKind) => {
    setBusy(true);
    try {
      await allergenApi.acknowledge(orderId, lineId, kind);
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Acknowledgement failed');
    } finally {
      setBusy(false);
    }
  };

  const needsPrompt = editable && (changing || (loaded && !state?.context));

  if (loadError && !state?.context) {
    return (
      <div className="pos-allergen pos-allergen--error" role="alert" data-testid="allergen-load-error">
        <strong>Allergy status unavailable.</strong> {loadError} Do not send to kitchen until captured.
        <button type="button" className="pos-allergen__btn" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      {state?.context && (
        <section className="pos-allergen" aria-label="Allergy context" data-testid="allergen-banner">
          <div className="pos-allergen__head">
            <strong>
              {state.context.captureChoice === 'SELECT_ALLERGENS'
                ? `Allergens: ${state.context.allergenCodes.join(', ')}`
                : CHOICE_LABEL[state.context.captureChoice]}
            </strong>
            {editable && !state.context.frozen && (
              <button type="button" className="pos-allergen__btn" onClick={() => setChanging(true)}>
                Change
              </button>
            )}
          </div>
          {loadError && (
            <p className="pos-allergen__warn" role="alert">
              {loadError}
            </p>
          )}
          <ul className="pos-allergen__lines">
            {state.lines.map((l) => {
              const name = lines.find((x) => x.orderLineId === l.orderLineId)?.catalogItemName ?? 'Item';
              return (
                <li key={l.orderLineId} className={`pos-allergen__line pos-allergen__line--${l.result}`}>
                  <span>
                    {name}: {RESULT_LABEL[l.result]}
                  </span>
                  {l.requiredAcknowledgements.map((a) =>
                    l.acknowledgedKinds.includes(a.kind) ? (
                      <span key={a.kind} className="pos-allergen__ack">
                        ✓ {ACK_LABEL[a.kind]}
                      </span>
                    ) : a.kind === 'CASHIER_GUEST_INFORMED' && editable ? (
                      <button
                        key={a.kind}
                        type="button"
                        className="pos-allergen__btn"
                        disabled={busy}
                        onClick={() => void acknowledge(l.orderLineId, a.kind)}
                      >
                        {ACK_LABEL[a.kind]}
                      </button>
                    ) : (
                      <span key={a.kind} className="pos-allergen__ack pos-allergen__ack--pending">
                        {ACK_LABEL[a.kind]} pending
                      </span>
                    ),
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {needsPrompt && (
        <div className="pos-allergen-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="pos-allergen-modal__panel">
            <h3 id={titleId} className="pos-allergen-modal__title">
              Ask guests about allergies
            </h3>
            <div className="pos-allergen-modal__choices" role="radiogroup" aria-label="Allergy answer">
              {(Object.keys(CHOICE_LABEL) as AllergenCaptureChoice[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={choice === c}
                  className={`pos-allergen__btn${choice === c ? ' pos-allergen__btn--on' : ''}`}
                  onClick={() => {
                    setChoice(c);
                    setFormError(null);
                  }}
                >
                  {CHOICE_LABEL[c]}
                </button>
              ))}
            </div>
            {choice === 'SELECT_ALLERGENS' && (
              <label className="pos-allergen-modal__label">
                Allergen codes
                <input
                  className="pos-allergen-modal__input"
                  value={codesInput}
                  autoFocus
                  aria-label="Allergen codes"
                  placeholder="MILK, EGG"
                  onChange={(e) => {
                    setCodesInput(e.target.value);
                    setFormError(null);
                  }}
                />
                {suggestedCodes.length > 0 && (
                  <span className="pos-allergen-modal__suggest">
                    {suggestedCodes.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="pos-allergen__btn"
                        onClick={() => setCodesInput((prev) => (prev ? `${prev}, ${c}` : c))}
                      >
                        {c}
                      </button>
                    ))}
                  </span>
                )}
              </label>
            )}
            {choice === 'UNABLE_TO_CLARIFY' && (
              <p className="pos-allergen-modal__note">
                Allergy status stays unknown: every dish will require confirmation and the kitchen will be warned.
              </p>
            )}
            {formError && (
              <p className="pos-allergen__warn" role="alert">
                {formError}
              </p>
            )}
            <div className="pos-allergen-modal__actions">
              {changing && (
                <button type="button" className="pos-allergen__btn" disabled={busy} onClick={() => setChanging(false)}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="pos-allergen__btn pos-allergen__btn--on"
                disabled={busy || !choice}
                onClick={() => void submit()}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
