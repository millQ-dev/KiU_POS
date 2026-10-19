# Offline Operation Foundation

- **Status:** Foundation reference (Architecture v1.3 aware)
- **Date:** 2026-08-19
- **Updated:** 2026-10-19
- **Related:** ADR-0001, ADR-0003, ADR-0008, ADR-0018 (Accepted); Proposed Hybrid Edge Level C package `edge-auth-offline-financial-policy.md` + ADR-0043/0044/0045 (OFFLINE-001/002/003 aliases) — **not** Accepted until PO decision; PROJECT_CHARTER.md

## 1. Requirement

POS operation must survive unstable or no internet connectivity. Offline is first-class, not an afterthought.

Vietnam fiscal **architecture boundary** is fixed in ADR-0014; concrete provider adapters and legal production clearance are later / LEGAL GATE. Offline must not invent successful government fiscal acceptance.

## 2. Local-first operational actions

These must work on the device without server connectivity:

| Action | Local behavior |
| --- | --- |
| Open / modify order | Store locally with client-generated IDs |
| Add lines, modifiers | Same |
| Apply known menu/prices | From last synced catalog/menu/pricing snapshot |
| Record payment (cash) | Queue payment fact |
| Kitchen ticket display | From local order state; routing snapshot from last sync |
| Inventory write-off trigger | Queue command; valuation may be provisional offline |
| Employee sign-in | Last-known credential/session policy (deferred) |

Orders must work **without** a table assignment (takeaway / corner / delivery).

Cannot guarantee without sync:

- real-time Grab/external order intake
- central reporting
- Intelligence recommendations
- fiscal submission to government systems

## 3. Local identity and session

- Terminal has stable device identity registered with server when online
- Employee session cached with expiry policy (Product Owner — Block D)
- Offline login may use last-validated credentials within policy window
- All local actions attribute `actorId` and `terminalId`

## 4. Locally generated identifiers

- Client generates UUID v7 (time-sortable) for orders, lines, payments, movements
- Idempotency key = `{terminalId}:{clientCommandId}` for every mutating command
- Server deduplicates on idempotency key **plus semantic fingerprint**:
  - SAME key + SAME semantic operation → safe duplicate (return existing fact)
  - SAME key + DIFFERENT semantic operation → `IDEMPOTENCY_CONFLICT` (reject)
- Semantic fingerprint includes business-significant content (`factType`, `occurredAt`, business position, operational context, payload) and excludes server-generated metadata that may differ on retry (`factId`, `recordedAt`)

## 5. Synchronization boundary

```text
Local command queue
        ↓ upload when online
Server ingestion (idempotent)
        ↓
Operational Core modules persist facts
        ↓
Downstream: Costing replay, Analytics, Intelligence
```

Sync is pull + push:

- **Push:** queued commands with business chronology metadata
- **Pull:** catalog/menu/pricing/permission updates since cursor

## 6. Business chronology offline (ADR-0003)

Each queued command carries:

- `businessDate`, optional `businessTime`, `businessOrder`
- Device maintains monotonic `businessOrder` per business date per terminal
- Server never uses arrival order as costing tie-breaker
- Cross-terminal order conflicts on same date → `ORDER_UNRESOLVED` for affected cost streams

## 7. Conflict classes

| Class | Example | Handling |
| --- | --- | --- |
| **Idempotent retry** | Same command uploaded twice (same semantic fingerprint) | Server returns original result |
| **Idempotency conflict** | Same idempotency key reused for a different operation | Reject with `IDEMPOTENCY_CONFLICT` |
| **Version stale** | Menu price changed since snapshot | Policy: reject line or accept with snapshot flag (Product Owner) |
| **Stock unavailable** | Sale exceeds known stock | Allow negative stock per ADR-0003; label cost estimate |
| **Order merge** | Two devices edit same order | Exclusive order lock preferred; split orders if unavoidable (deferred) |
| **Clock skew** | Device date wrong | Flag for reconciliation; never fabricate business time |

## 8. Server reconciliation

After reconnect:

1. Ingest commands in stable idempotency-safe order
2. Validate structural context still valid (or store historical context from client snapshot)
3. Persist immutable facts
4. Trigger cost replay from earliest affected business position
5. Return sync result with accepted/rejected commands and revision pointers

## 9. Auditability after reconnect

- Local queue entries retained until server ACK
- Sync batch ID links device upload to server ingestion run
- Dangerous offline operations flagged in Audit & Risk if policy requires

## 10. Events and outbox (Architecture v1.2)

Offline sync uses **DOMAIN** (and necessary AUDIT) command/facts — not UI TELEMETRY. Prefer a transactional outbox for durable sync/integration side effects; do not use outbox for every internal method call.

## 11. Deferred

- Exact sync protocol (REST batch vs streaming)
- CRDT vs last-write-wins for specific entities
- Fiscal offline queue behavior (Vietnam)
- Full encryption at rest on device

**Hybrid Edge (2026-10-19):** Employee offline sign-in, single-writer fencing, OperationalClose vs CompleteOrder, and offline CASH evidence are proposed in ADR-0043/0044/0045 — see `edge-auth-offline-financial-policy.md`. Until Accept, Cloud-only C0 remain online-only fail-closed for CompleteOrder / fiscal gate.
