import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

/** Keep keyboard focus in the topmost dialog and restore its opener on close. */
export function useDialogFocus(onEscape: (() => void) | null, active = true) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!active || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const candidates = () => {
      const eligible = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) =>
        !el.matches(':disabled') && el.tabIndex >= 0 && !el.closest('[hidden], [inert], [aria-hidden="true"]'));
      return eligible.filter((el) => {
        if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true;
        const group = eligible.filter((candidate): candidate is HTMLInputElement =>
          candidate instanceof HTMLInputElement && candidate.type === 'radio' &&
          candidate.name === el.name && candidate.form === el.form);
        return el === (group.find((radio) => radio.checked) ?? group[0]);
      });
    };
    const topDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      .filter((el) => !el.closest('[hidden], [inert], [aria-hidden="true"]'))
      .reduce<HTMLElement | null>((top, el) => {
        const z = Number.parseInt(getComputedStyle(el).zIndex, 10) || 0;
        const topZ = top ? Number.parseInt(getComputedStyle(top).zIndex, 10) || 0 : -Infinity;
        return z >= topZ ? el : top;
      }, null);
    const isTop = () => topDialog() === dialog;
    const items = candidates();
    const preferred = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    const initial = (preferred && items.includes(preferred) ? preferred : items[0]) ?? dialog;
    if (isTop()) initial.focus();
    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape' && escapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = candidates();
      const current = document.activeElement;
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (current === items[0] || !(current instanceof HTMLElement && items.includes(current)))) {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (!event.shiftKey && (current === items[items.length - 1] || !(current instanceof HTMLElement && items.includes(current)))) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const top = topDialog();
      if (opener?.isConnected && (!top || top === dialog || top.contains(opener))) opener.focus();
    };
  }, [active]);
  return dialogRef;
}
