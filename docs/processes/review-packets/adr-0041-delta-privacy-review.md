# PR #84 — ADR-0041 ACCEPT WITH DELTAS Privacy review (targeted)

- **Subject:** ADR-0041 post-delta text (D1–D4) — Privacy confirmation only
- **PR:** Origin [#84](https://cursor.com/codebase/millqdev/MillQ/pull/84)
- **Reviewed HEAD:** `9f20f592777951e77656eb527c945ca941eaeac6` (ADR content tip `1a0e8c60a9b69a5431fc0f5fc6533b61a9d6549d`)
- **Branch:** `docs/taskservice-adr-0041`
- **Autonomy of subject:** Level C docs-only — **not** merge, runtime, or schema authorization
- **Reviewer context:** independent Privacy Review Agent (targeted re-confirm after ACCEPT WITH DELTAS)
- **Reviewed:** 2026-10-13
- **Prior APPROVE:** `adr-0041-privacy-review.md` @ `863d3df` (pre-delta §8.1 remediation)
- **STOP:** No merge, no merge-when-ready, no runtime, no #82 edits

## Focus (mandatory)

| # | Focus | Result |
| --- | --- | --- |
| 1 | §8.1 safe display metadata still locked after D1–D4 | **PASS** |
| 2 | D1 OfficeSession vs POS PIN separation | **PASS** |
| 3 | No silent Owner (RED / absence / delivery failure); Channel D only for ordinary Tasks | **PASS** |
| 4 | Fail-closed scope (empty LE/Outlet ≠ tenant-wide) | **PASS** |

## Verification

### §8.1 Safe display metadata (ADR-0015 — mandatory)

Still present and unchanged in substance at this HEAD:

- Scope: Task outbox, Channel D escalation payloads, reminder pushes, comment/attachment **metadata** → safe display fields only
- Forbidden: PIN, session tokens, password hashes, OTP, raw payment credentials, private e-sign keys, unrestricted PII dumps
- Attachment bytes → Privacy Control Plane; Task stores references + non-sensitive descriptors
- Rule **not optional** for Accept; retention TTLs remain OPEN for Level B
- §15 PO ACCEPTED row still lists Privacy §8.1

D1–D4 did **not** weaken, relocate, or make §8.1 optional.

### D1 — OfficeSession vs POS PIN

- §5: Manager Dispatcher (M1) audience = **OfficeSession** + grants; POS PIN session is not a substitute
- §11 D1: authorized `OfficeSession` required; POS PIN (`identity_user` / TERMINAL/MOBILE per ADR-0036/0039) must remain separate; future POS/Mobile task commands need **explicit** principal mapping — not silent POS-PIN-as-Office-Manager
- Alternatives: POS PIN as Manager Dispatcher principal for M1 — **rejected**
- §8.1 forbidden list still includes PIN and session tokens in notify payloads (session separation + payload hygiene)

### No silent Owner

- §2 / §10: Channel A Manager-only by default; Owner only via B, mandated C, or manual D
- §8: Channel A delivery failure must not escalate to Owner
- §9 / D3: absence / unavailable assignee → authorized Manager reassign or Manager-visible OPEN; **no** auto Owner push; Channel C independent
- §13 tests 1 and 7 encode no silent Owner notify

### Fail-closed scope

- §4: omitted/empty scope fields do **not** mean tenant-wide
- §5: empty LE/Outlet fail-closed; deny-by-default; tenant-wide only with explicit grant + confirmation + audit
- §12 / §15: fail-closed scopes remain PO ACCEPTED

## Findings (≤5)

1. **§8.1 remains locked** post-delta — same mandatory safe-metadata rule for outbox / Channel D / reminders / attachment metadata; secrets still forbidden.
2. **D1 strengthens identity hygiene:** OfficeSession required for M1 Dispatcher; POS PIN explicitly not a substitute; future Mobile/POS task principals must be mapped explicitly.
3. **No silent Owner path** holds under D3 (absence) and prior Channel A / delivery-failure rules; Channel D remains the only manual ordinary-Task Owner path.
4. **Fail-closed empty scope** unchanged and still PO ACCEPTED — never silent tenant-wide.
5. **Residual (non-blocking):** retention TTLs and Level B field allowlists stay OPEN — correctly deferred; not Accept-optional.

## Verdict

Post-delta Privacy posture of ADR-0041 remains adequate for Level C docs-only ACCEPT WITH DELTAS confirmation. Does **not** authorize merge of PR #84, TaskService runtime, migrations, or OFFICE1.1 Accept.

```text
VERDICT: APPROVE
```

**Not done by this reviewer:** merge, merge-when-ready, Architecture/FinSec/PO re-Accept, runtime/schema edits, changes to PR #82.
