# Figma → KiU · P0 welcome review

Date: 2026-09-18
Branch: `feature/p0-counter-service`

## Scope

The ImaPos Figma kit is used as a visual reference for the first KiU cashier
screen. The product contract remains the KiU bible and the existing P0
architecture. No later cashier, QR, KDS or shift screen was added.

## Adopted visual patterns

- two-zone onboarding/context composition;
- restrained Copper and Teal gradient fields;
- large readable heading and short supporting copy;
- KiU wordmark and globe-based locale selector in the intro header;
- CloudPos-inspired context card with large outlined fields;
- explicit primary action;
- strong KiU borders and 48px touch controls.

## Changed canonical files

- `apps/web/src/design-lab/cashier/CashierWelcomeScreen.css`
- `apps/web/src/design-lab/cashier/CashierWelcomeScreen.tsx`
- `apps/web/src/design-lab/cashier/CashierWelcomeScreen.test.tsx`
- `apps/web/src/styles/tokens.css`
- `apps/web/public/brand/kiu-logo-transparent.png`
- `docs/design/figma-kiu-mapping.md`

Forge mirrors the same first-screen treatment in its local visual library:

- `src/components/system/KiuCashierWelcome.css`
- `public/kiu-p0-welcome-review.md`

## Verification

- web typecheck: passed;
- web production build: passed;
- Forge production build and static prerender: passed;
- Forge canvas visually reloaded with the updated screen;
- targeted web tests were attempted, but the local dependency tree currently
  fails before assertions with `React.act is not a function` from
  `@testing-library/react` / `react-dom`.

## Review gate

Review `01-welcome` on a real 10–15 inch landscape touch display. Check
contrast, hit areas, RU/EN/VI expansion and whether the gradient remains a
background aid. The next chronological cashier screen waits for this review.
