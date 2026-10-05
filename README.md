# MillQ

MillQ is a modern restaurant management platform for Vietnam.

The product consists of two deliberately separated capabilities:

1. **Operational Core** — authoritative POS, inventory, purchasing, recipes, payments, audit
2. **Production Intelligence** — recommendations and analytics built on operational facts (future sellable module)

## Hosting

**Cursor Origin is the source of truth.** GitHub is a backup mirror only.

- Canonical remote: `https://origin.cursor.com/millqdev/MillQ.git`
- Browse: [cursor.com/codebase](https://cursor.com/codebase)
- Sole GitHub backup: [`millQ-dev/KiU_POS`](https://github.com/millQ-dev/KiU_POS) (`https://github.com/millQ-dev/KiU_POS.git`). Legacy path `millQ-dev/MillQ` is a GitHub rename redirect to the same repository — not a second mirror.
- Open PRs on Origin; Implementation Agent arms merge-when-ready; independent agent review; ruleset merges for Level A/B
- Do not merge work on GitHub; do not dual-write
- After cutover only the backup identity writes GitHub `main` and release/protected tags

Details: [`docs/processes/origin-github-hosting.md`](docs/processes/origin-github-hosting.md), [`docs/processes/autonomous-development.md`](docs/processes/autonomous-development.md), and [ADR-0004](docs/decisions/ADR-0004-origin-source-of-truth.md).
See live checkpoint: [`docs/processes/current-state.md`](docs/processes/current-state.md).

## Repository structure

```text
.
├── apps/
│   ├── api/          # Node.js Operational Core HTTP service
│   └── web/          # React client shell
├── packages/
│   ├── domain/       # Money, quantity, conversion, yield (ADR-0002/0003)
│   └── contracts/    # Operational facts and Intelligence DTOs
├── infrastructure/   # Docker Compose + dormant GitHub Actions definition
├── docs/             # Architecture, ADRs, processes
├── scripts/          # Operational scripts (Origin→GitHub backup: main and tags via GitHub App)
├── tests/            # Cross-cutting test assets (future)
└── .github/          # Templates / dormant workflow for GitHub backup remote
```

## Local development

Requirements: Node.js ≥ 20, pnpm 9, PostgreSQL 16 (Docker Compose **or** local install).

```bash
cp .env.example .env
# Option A: Docker Compose
docker compose -f infrastructure/docker-compose.yml up -d
# Option B: local PostgreSQL matching DATABASE_URL

pnpm install --frozen-lockfile
pnpm --filter @millq/api run migrate
pnpm dev
```

- API health: http://localhost:3000/health
- Web: http://localhost:5173
- **Production auth path (CASH1.1):** Company ID → PIN → Opening cash → CashShift OPEN → cashier-ready stub (POS shell not mounted yet).
- **Dev POS shell:** `?devCashier=1` uses `GET /api/v1/dev/cashier-contexts` (not production authorization). Requires seeded outlet/menu/layout.

Dev cashier flow: ResolvedPosSurface → pages / Quick Access → New Order → COUNT / MASS / VOLUME selection → commercial accept → open settlement. Payments UI incomplete; CompleteOrder fail-closed without Fiscalization. Tables not implemented (ADR-0017 architecture only).

## Commands

| Command | Description |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install workspace dependencies |
| `pnpm dev` | Run API and web in parallel |
| `pnpm test` | Run all package tests |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages |

## Documentation

- [`PROJECT_CHARTER.md`](PROJECT_CHARTER.md) — product authority
- [`AGENTS.md`](AGENTS.md) — agent operating rules
- [`docs/processes/current-state.md`](docs/processes/current-state.md) — what exists now
- [`docs/decisions/`](docs/decisions/) — ADRs

## Status

**State freeze @ Origin main `4e47cb0` (CASH1.1).** Operational Core kernel verticals through CashShift Open, Identity, Settlement, Payments core, Menu/POS, Guest QR read, and economics read models are on main — maturity is **PARTIAL / SERVICE ONLY** for most surfaces; not a turnkey cafe product. Floor/Table, Tax runtime, Fiscalization, Owner/Accountant UI, and onboarding APIs are **not started**. See [`docs/processes/current-state.md`](docs/processes/current-state.md).

**CI:** Origin CI not attached yet. Merge gates: local checks + independent Origin review + Origin push ruleset. GitHub Actions may exist as dormant/backup-compatible definition and is **not** a merge gate.
