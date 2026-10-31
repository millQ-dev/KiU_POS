# Restaurant Imprint Stage 1 — Acceptance matrix (I-09)

**STREAM:** KIU-IMPRINT · **TASK:** IMPRINT-I09-ACCEPTANCE-CERTIFICATION  
**Authority:** Accepted ADR-0054 + Gate 0 `ACCEPTANCE.md` (AC-01…AC-16)  
**Runtime:** disposable `millq_ci_pos_*` only. No production migrate/deploy. No JEV/LLM.

Statuses: **PASS** | **FAIL** | **UNVERIFIED**. Never mark PASS without executed evidence.

| AC | Criterion (short) | Status | Evidence |
| --- | --- | --- | --- |
| AC-01 | Org-only outlet → partial snapshot; other registered fields UNKNOWN | **PASS** | `imprint-stage1.acceptance.certification.test.ts` AC-01; also org adapter + claim service terminal UNKNOWN |
| AC-02 | Re-ingest identical source → one logical claim; cursor stable | **PASS** | I-02 persistence duplicate; I-04 checkpoint duplicate; I-05/I-06 deterministic repeat |
| AC-03 | Same identity, conflicting payload → quarantine; snapshot unchanged | **PASS** | I-02/I-04 conflict quarantine + race tests |
| AC-04 | Distinct origins/values → claims retained; unresolved contradiction | **PASS** | I-09 certification AC-04 (Stage 1 paths: DECLARED + two OBSERVED → CONFLICT); contracts `resolveImprintField` CONFLICT |
| AC-05 | GoodsReceipt DRAFT never posted evidence | **PASS** | I-06 selects POSTED/REVERSED only; excludes DRAFT |
| AC-06 | POSTED then REVERSED → history kept; projection updates; no source mutation invent | **PASS** | I-06 reverse re-read; I-08 reverse replay |
| AC-07 | Duplicate/late/out-of-order → no downgrade from stale event | **PASS** | I-09 certification AC-07 (late older receipt); I-06 chronological pick |
| AC-08 | Source unavailable → last-good + STALE/DEGRADED; ops unaffected | **PASS** | I-08 hard/soft retain; I-06 projection error; I-08 cash independence |
| AC-09 | Cross-tenant / ungranted outlet denied; no leakage | **PASS** | I-07 HTTP negatives; I-04/I-02/I-05/I-06/I-08 scope denials |
| AC-10 | Provenance sensitive redaction; no raw PII in default read | **PASS** | I-07 provenance grant gate + default redact; Stage 1 registry has no employee PII paths; sensitivity mismatch rejected (I-04) |
| AC-11 | Historical as-of query under recorded/effective cutoff | **UNVERIFIED** | No Stage 1 as-of query API. Partial: claim history by id + caller business time dropped (`AC-11 partial` in I-09 suite; I-04 supersede history). Full as-of cutoff remains future work (would need explicit product/API decision). |
| AC-12 | Concurrent rebuilds → one atomic coherent revision | **PASS** | I-08 concurrent rebuild; I-09 concurrent rebuild vs source update (settled head atomic; mid-flight publish may reject if a claim is superseded after resolve — residual TOCTOU, head never mixed) |
| AC-13 | Unknown taxonomy path rejected; prior snapshot usable | **PASS** | I-04 blocks unregistered path; contracts registry reject |
| AC-14 | Different legal entities under same tenant stay accurate | **PASS** | I-09 certification AC-14; I-06 LE+outlet warehouse scope |
| AC-15 | No regression in posting / inventory / recipe / Office permissions | **PASS** | Existing Depot disposable suites remain fail-closed (POS P0, orders replacement, goods receipt, identity, etc.). I-09 smoke: POSTED receipt while Imprint STALE. |
| AC-16 | Imprint unavailable/disabled → restaurant ops functional | **PASS** | No Stage 1 feature-flag “disable”; certified as Imprint STALE/unavailable: cash modules do not import Imprint (I-08/I-09); posting works under STALE. |

## Gap suite (this PR)

File: `apps/api/src/modules/restaurant-imprint/imprint-stage1.acceptance.certification.test.ts`  
CI label: `imprint-i09` · `--min-passed=8` · zero skips.

## Gate verdict

Stage 1 acceptance gate may **close with residual AC-11** (as-of query API absent by design of I-02…I-08). All other AC-01…AC-16 are **PASS** on disposable PostgreSQL evidence cited above. Closing the residual requires a later authorized slice for as-of semantics — not invented here (Level C if product wants a new query contract).
