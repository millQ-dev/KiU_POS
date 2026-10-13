# Gate 0 — PO REVIEW DELTA (ACCEPT WITH REQUIRED DELTAS)

- **Date:** 2026-10-13
- **PR:** Origin [#83](https://cursor.com/codebase/millqdev/MillQ/pull/83)
- **Reviewed HEAD:** `e5452850845e06f2d49d490ab9148c1f5bd98d07`
- **PO verdict:** **APPROVE WITH CHANGES — NOT MERGE AUTHORIZATION**
- **Autonomy:** Level C docs-only
- **STOP:** Do not merge #83; no runtime; no migrations; do not modify PR #82

Independent Architecture / FinSec / Privacy APPROVE verdicts on the prior Gate 0 tip are **acknowledged**. This delta corrects Gate 0 wording and records Notion export reconciliation status.

---

## 1. Notion reconciliation status

| Source page | Notion ID | Export present? | Status in Gate 0 |
| --- | --- | --- | --- |
| Parent Index | `3f721d5d34878197bab3c0f34c6b3867` | **Yes** — Markdown export under `Downloads/Private & Shared/` | Consumed; older parent sections marked historical vs 13.10 handoff children |
| 00 Handoff | `3f821d5d34878186b682d5db96ff591d` | **Yes** | Consumed — **PO ACCEPTED** frames |
| Owner | `3f821d5d34878178b417e5e574d5e8d8` | **Yes** | Consumed — **PO ACCEPTED** product flow |
| Manager | `3f821d5d348781d09e3ad589f2c07726` | **Yes** | Consumed — **PO ACCEPTED** behavior |
| Accountant | `3f821d5d348781fb947fe08664edb8cc` | **Yes** | Consumed — **PO ACCEPTED** direction; legal/API **OPEN** |
| Chef | `3f821d5d3487810b9e86f82eb10159e1` | **Yes** | Consumed — **PO ACCEPTED** |
| Bar Manager | `3f821d5d34878172b4c8c018180d50c5` | **Yes** | Consumed — **PO ACCEPTED** |
| Engineering Contracts | `3f821d5d348781c49786ff2d638b94f6` | **Yes** | Consumed — ACCEPTED invariants + **PROPOSED** DTO/event names |
| Implementation Roadmap | `3f821d5d3487811eaa15d7a947ef89a0` | **Yes** | Consumed — **PROPOSED** order of work (not release dates) |
| Q Place + Q Card | `3f821d5d348781ed94e1e0c9dfbeb254` | **No** in supplied folder | **PARTIAL / OUT OF SCOPE** for five-cabinet delivery; separate discovery — do not invent |

Requirement matrix: [`backoffice-gate0-notion-origin-matrix.md`](backoffice-gate0-notion-origin-matrix.md).

**Status labels preserved:** PO ACCEPTED product behavior ≠ PROPOSED engineering entities ≠ OPEN architecture/legal decisions. DTO names from page 06 remain **PROPOSED**, not Accepted ADR terms.

---

## 2. Task priority clarification (replaces Gate 0 `priorityFloor` restriction)

**PO ACCEPTED:**

- Manager may move tasks across **all four colors**: RED / ORANGE / YELLOW / WHITE (including RED→YELLOW).
- Every manual priority change requires: nonempty explanation; actor; previous priority; new priority; timestamp; immutable append-only history.
- Display priority **≠** immutable original incident severity **≠** backend safety/financial enforcement.
- Changing display priority **must never** disable a mandatory legal, financial, food-safety, or operational gate.

**Corrected Gate 0 engineering stance:**

| Concept | Role |
| --- | --- |
| `displayPriority` | Mutable UI/dispatcher column (four colors); Manager may change with audited reason |
| `originalSeverity` (or equivalent) | Immutable snapshot of system-assigned / incident severity at creation — **not** blocked from display reclassification |
| Domain gates | Independent server rules (payment, recipe publish, refund, food-safety stock block, etc.) — **not** controlled by task color |

**Withdrawn:** interpreting `priorityFloor` as a prohibition on PO-approved red→yellow (or any four-color) reclassification.

**Retained:** priority change never satisfies or suppresses a gate; gates remain enforceable regardless of column color.

---

## 3. Separate lifecycles (channels)

Explicit distinct lifecycles — **do not collapse**:

| Channel | Purpose |
| --- | --- |
| **A. Ordinary Manager Task** | Four-color dispatcher work; manager-only notifications by default |
| **B. Owner ApprovalRequest** | Mandatory Owner approvals (recipe publish, payment/expense over threshold, hire/fire, etc.) — separate from Manager Task completion |
| **C. Compliance / safety incident** | Statutory / food-safety / legal notifications — cannot be suppressed by UI preference; not “manager task done” |
| **D. Manual Owner escalation** | Manager explicitly “Send to Owner” with task/context — not automatic on RED |

**Invariants:**

- Completing a Task **never** implies approving a payment, recipe publication, refund, or regulated operation.
- Manager operational notifications **do not** automatically push Owner.
- Mandatory Owner approvals and independent statutory/safety notifications are **separate channels**.

Existing POS `identity_approval_request` (dangerous-op) remains a related but **not identical** surface; mapping to channel B is Level C in TaskService ADR (PR-T0), without silently overloading mig `027` rows.

---

## 4. Authorization

- Empty LegalEntity / Outlet scope **must not** silently grant tenant-wide authority — **fail-closed**.
- Explicit tenant-wide grants require authorized scope, confirmation, and audit.
- Professional access (`ClientAccessGrant`) and employee membership paths remain **separate** (ADR-0022).
- Aligns with OPEN issue R82-3 on PR #82 (still unresolved; not Accepted here).

---

## 5. PR #82 dependency

- OFFICE1.1 PR #82 stays **independent**.
- Do **not** silently Accept Amendment A or ADR-0040.
- Known OPEN issues remain (duplicate Zalo OTP; trusted-device MFA; empty scope; accountant hub union; username/phone recovery) — see [`office1.1-pr82-open-review-issues.md`](office1.1-pr82-open-review-issues.md).

---

## 6. Next planned PR — PR-T0

Separate docs-only PR: **TaskService ADR** (proposed number **ADR-0041**), first implementation target = narrow Manager Dispatcher vertical. Boundaries recorded in that ADR; **must not duplicate** this Gate 0 packet wholesale.

---

## 7. Merge / runtime stance

| Action | Allowed? |
| --- | --- |
| Merge #83 now | **No** — awaiting separate PO merge authorization after delta review |
| Runtime / migrations | **No** |
| Modify PR #82 | **No** |
| Continue docs (this delta + matrix + PR-T0 ADR) | **Yes** |
