/** Display Money — string/BigInt only; never unit×qty gross (OPTION A / ADR-0030 reserved). */
export type MoneyParts = {
  amountMinor: string;
  currencyCode: string;
  minorUnitExponent: number;
};

export function formatMoneyDisplay(m: MoneyParts): string {
  const negative = m.amountMinor.startsWith('-');
  const digits = negative ? m.amountMinor.slice(1) : m.amountMinor;
  if (!/^\d+$/.test(digits)) return `${m.amountMinor} ${m.currencyCode}`;
  const exp = m.minorUnitExponent;
  if (exp === 0) return `${negative ? '-' : ''}${digits} ${m.currencyCode}`;
  const padded = digits.padStart(exp + 1, '0');
  const whole = padded.slice(0, -exp) || '0';
  const frac = padded.slice(-exp);
  return `${negative ? '-' : ''}${whole}.${frac} ${m.currencyCode}`;
}
