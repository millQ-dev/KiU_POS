# MillQ

MillQ is a modern restaurant management platform for Vietnam.

The product consists of two deliberately separated capabilities:

1. **Operational Core** — authoritative POS, inventory, purchasing, recipes, payments, audit
2. **Production Intelligence** — recommendations and analytics built on operational facts (future sellable module)

## Hosting

**Cursor Origin is the source of truth.** GitHub `millQ-dev/MillQ` is a backup mirror only.

- Canonical remote: `https://origin.cursor.com/millqdev/MillQ.git`
- Browse: [cursor.com/codebase](https://cursor.com/codebase)
- Open PRs on Origin; Implementation Agent arms merge-when-ready; independent agent review; ruleset merges for Level A/B
- Do not merge work on GitHub; do not dual-write
- After cutover only the backup identity writes GitHub `main` and release/protected tags

Details: [`docs/processes/origin-github-hosting.md`](docs/processes/origin-github-hosting.md), [`docs/processes/autonomous-development.md`](docs/processes/autonomous-development.md), and [ADR-0004](docs/decisions/ADR-0004-origin-source-of-truth.md).

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
- Web KiU cashier shell: http://localhost:5173
- First load uses **development outlet bootstrap** (`GET /api/v1/dev/cashier-contexts`) — not production authorization. Seed local DB (acceptance fixtures or manual) so outlets exist, then select an outlet.

Cashier flow (P1.2): load ResolvedPosSurface → pages / Quick Access → New Order → tap ACTIVE **COUNT** item → `selectPosCountTap` → basket updates. MASS/VOLUME quantity entry is deferred (P1.3). No pay / commercial accept / tables.

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

Foundation Operational Core (Origin merge candidate): Accepted ADR-0001…0003, **ADR-0006**, **ADR-0007**; typed operational facts; CostValue yield math; fact feed guardrail. Full POS and Block C are not started. Block B domain-boundary ADRs remain Proposed on a separate draft (note: Origin hosting ADR-0004 is Accepted and is a different decision).

**CI:** Origin CI not attached yet. Current merge gates are local checks + independent Origin review + Origin ruleset. GitHub Actions workflow may exist as dormant/backup-compatible definition and is **not** a merge gate.
