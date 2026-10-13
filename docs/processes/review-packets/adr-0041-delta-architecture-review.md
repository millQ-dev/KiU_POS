# PR #84 — ADR-0041 ACCEPT WITH DELTAS — targeted Architecture review

- **Subject:** ADR-0041 final text after PO D1–D4
- **Reviewed HEAD:** `9f20f592777951e77656eb527c945ca941eaeac6`
- **Branch:** `docs/taskservice-adr-0041`
- **Focus:** D1–D4 contract honesty only
- **Reviewer context:** independent Architecture review agent; no merge, no runtime, no #82
- **Reviewed:** 2026-10-13

## Delta checklist

| ID | Requirement | ADR loci | Honest? |
| --- | --- | --- | --- |
| **D1** | First Manager Dispatcher requires authorized `OfficeSession`; POS PIN separate; future POS/Mobile task commands need explicit principal mapping | §5, §11, Alternatives, §15 | **Yes** |
| **D2** | TaskService cannot independently approve regulated/financial ops; domain SoT authoritative; Task complete/priority/review ≠ domain approval | §1, §2 (D2), §13.6, §15 | **Yes** |
| **D3** | Absence reassignment only to authorized Manager with `task.dispatch` (+ scope); no auto Owner escalate from Channel A; Channel C independent | §9, Alternatives, §15 | **Yes** |
| **D4** | No invented reminder SLA defaults; no broad auto-derive by default; allowlisted/config-only when Level B ships | §8, §11 (D4), OPEN, §15 | **Yes** |

## Findings (5)

1. **D1:** M1 audience is explicitly `OfficeSession` + grants; POS PIN / TERMINAL/MOBILE sessions are rejected as Manager Dispatcher principal; future task-command mapping left OPEN as Proposed technical — no silent dual-stack.
2. **D2:** Channel separation A–D plus explicit non-substitution language keeps Payments/Settlement/Fiscal/Recipe/inventory posting/POS ApprovalRequest authoritative; overload of `identity_approval_request` as four-color Task remains rejected; B↔POS table mapping correctly OPEN.
3. **D3:** Operational fallback stays inside authorized Manager/`task.dispatch` audience or Manager-visible unassigned; RED and Manager absence do not auto-push Owner; Channel D remains the only manual Owner path for Channel A.
4. **D4:** Reminder timing and derive-event catalog stay OPEN; first vertical Out list and §15 forbid invented SLAs and broad auto-derive; empty allowlist = no auto-derive.
5. **Process honesty:** Status is Accept WITH DELTAS pending targeted confirmation; design-only; separate Level B for runtime; PR #84 must not merge until confirmation; #82 independent — adequate for Architecture sign-off on deltas.

## Non-blocking

- Checkpoint / PO packet “Post-delta HEAD” / “Final HEAD” may lag tip stamps after review commits; treat this packet’s Reviewed HEAD as authoritative for this Architecture pass.

## Verdict

D1–D4 are encoded honestly and consistently in ADR-0041 at the reviewed tip. Independent Architecture review: **APPROVE**. Does not merge PR #84, authorize runtime, or decide FinSec/Privacy.

```text
VERDICT: APPROVE
HEAD: 9f20f592777951e77656eb527c945ca941eaeac6
```
