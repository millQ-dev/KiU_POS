# PREVIEW-1 review packet

## Scope

Branch: `feature/p0-counter-service`

This packet covers the first stationary cashier screen and the provider-neutral
PREVIEW-1 implementation contract. Later cashier screens, QR, KDS, shift UI,
printer adapters, offline runtime, staging/prod automation, and merge are out of
scope.

## Visual track

Route:

`/design-lab/cashier/01-welcome`

The screen uses the existing KiU tokens and hands off to the existing
`CashierShell` after the preview context is selected. RU is the default; EN and
VI are selectable for layout stress testing. The context and open shift are
fixture state, matching the approved first-slice boundary. No production
authentication or shift lifecycle UI was invented.

Visual review status: ready for independent review. Later screens must wait for
approval of this screen.

Local check:

```sh
VITE_ENABLE_DESIGN_LAB=true pnpm dev:web
```

Then open `/design-lab/cashier/01-welcome` on the 10–15 inch landscape target.

## Infrastructure track

- Cursor Origin branch SHA remains the deploy source of truth; GitHub remains a
  backup/optional CI mirror.
- The external preview origin has one surface: `/` to web, `/api/*` and
  `/health` to API. The web uses relative `/api` requests.
- Preview reset is guarded by `APP_ENV=preview`,
  `PREVIEW_DB_ISOLATED=1`, and `PREVIEW_RESET_CONFIRM=1`.
- `preview:reset` drops only the isolated preview schema, applies migrations,
  and seeds the deterministic synthetic cafe fixture.
- API startup never runs migrations; migration/reset is a dedicated job.
- Design-lab and dev cashier bootstrap are local/preview-only. A production web
  build with `VITE_ENABLE_DESIGN_LAB=false` emits no design-lab chunk.
- Node is pinned to `22.13.0` in `.nvmrc`, package engines, and CI workflows.
- Printer/KDS hardware bridges and offline runtime remain outside PREVIEW-1.

## Changed implementation files

- `apps/web/src/design-lab/cashier/` — first welcome surface, fixture route,
  styles, and RU/EN/VI render test.
- `apps/web/src/App.tsx` and `apps/web/src/vite-env.d.ts` — build-gated route
  loading.
- `apps/api/src/config.ts`, `src/index.ts`, and `src/routes/pos.ts` — explicit
  environment boundary for dev bootstrap.
- `apps/api/src/db/migrate.ts` — single-flight advisory lock for deploy-time
  migrations.
- `apps/api/src/db/preview-reset.ts` and `preview-seed.ts` — guarded reset and
  synthetic preview fixture.
- `infrastructure/preview/` and `scripts/preview/` — ingress and deploy
  adapter contract.
- `.nvmrc`, package scripts, `.env.example`, and CI Node versions.

## Verification

- `pnpm typecheck` — passed.
- `NODE_ENV=test pnpm --filter @millq/web test` — 37 tests passed.
- Full root test run with temporary PostgreSQL — 36 test files / 406 tests
  passed across web, API, domain, and contracts.
- API acceptance run with temporary PostgreSQL — 21 files / 281 tests passed.
- Production build with `VITE_ENABLE_DESIGN_LAB=false` — passed; no design-lab
  chunk emitted.
- Clean preview reset twice — passed; migrations and fixture seed completed.
- Preview API `/health` — database `up`.
- Preview cashier contexts and POS surface — returned the seeded outlet with
  Coffee/Food pages and active positions.
- `git diff --check` — passed.

## Review decision needed

Approve or request changes for the single welcome screen. Do not proceed to
`02-...` or later cashier screens until this screen has been visually reviewed.

The only remaining infrastructure choices are provider-specific: the hosting
adapter, isolated PostgreSQL/Neon provisioning adapter, ingress renderer, and
TTL cleanup controller. They are intentionally not selected in PREVIEW-1.
