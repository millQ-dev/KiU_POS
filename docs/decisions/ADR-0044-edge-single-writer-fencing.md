# ADR-0044: Edge / Cloud Single-Writer & Fencing (ADR-OFFLINE-002)

- **Status:** **Accepted WITH DELTAS** (PO 2026-10-19) — Level C docs only
- **Alias:** ADR-OFFLINE-002
- **Date:** 2026-10-19
- **Origin main reconciled:** `33dad072e014158c6658546abcda5de38e87f4b2`
- **Related:** ADR-0003, ADR-0010, ADR-0018, ADR-0043; `offline-foundation.md`; OFF-01 PR #90
- **LEVEL B GO:** **NOT ISSUED**
- **STOP:** No runtime, migrations, or merge-as-implement from this Accept alone

## Context

ADR-0018: server remains authoritative **after synchronization**; reject universal LWW; require Local Store / Outbox / Inbox / Sync Cursor concepts. Runtime at reconciled SHA has **no** Edge packaging, sync outbox, or DeviceIdentity implementation — Cloud API + Postgres only.

Hybrid Edge needs a **single authoritative writer** for an Outlet/site partition during WAN outage, with authenticated LAN terminals and safe recovery — without automatic Cloud takeover while a disconnected Edge may still process operations.

## Decision (Proposed)

### D1. One authoritative Edge writer

For a given **authority partition** (see D2), exactly one Edge Runtime holds **write authority** (Writer Epoch / fencing token). Multiple authorized terminals connect over **authenticated LAN transport** to that Edge. Local **PostgreSQL** is the transactional source of operational facts during WAN outage.

Same application/domain code runs under **Cloud** and **Edge** deployment profiles (config/profile switch — not a domain fork).

### D2. Authority partition (binding proposal)

Default partition key:

```text
EdgeWritePartition =
  tenant_id
  + legal_entity_id   -- fiscal/payment merchant identity owner
  + outlet_id         -- site / outlet operational locus
```

| Scenario | Rule |
| --- | --- |
| Co-located outlets (same building, different Outlet) | **Separate** partitions — separate writers unless explicitly configured as one Hub partition (Product Accept) |
| Multiple LegalEntities at one site | **Separate** partitions per LE (credentials / fiscal identity) |
| Dedicated Edge Hub | One Hub may host **multiple** partitions; each partition still has one writer epoch |
| Embedded POS Edge (single terminal) | Partition writer = that EdgeInstallation |
| Customer PC Edge | Same as Embedded unless Hub-certified multi-terminal |

Cloud does **not** independently accept **conflicting authoritative writes** for an Edge-owned partition **until an explicit recovery authority transfer** (D4) completes (graceful handback / confirmed Edge death / split-brain resolution / Cloud re-issue of WriterEpoch).

`WriterEpoch.expires_at` is a **lease hint for alerts and operator workflows only**. Lease expiry **never by itself** authorizes Cloud write authority for that partition — even if the epoch is “expired” — while a disconnected Edge could still be processing (see D4).

### D3. Writer epochs / fencing tokens

```text
WriterEpoch {
  partition_id
  edge_installation_id
  epoch_id          -- monotonic
  fencing_token     -- opaque, presented on every mutating command
  issued_at
  expires_at        -- lease hint only; NOT sole takeover trigger
  policy_version
  cloud_signature
}
```

Rules:

1. Mutating commands on Edge require current fencing token.
2. Stale epoch → reject (`WRITER_EPOCH_STALE`).
3. Cloud ingestion of Edge outbox validates fencing token / epoch continuity.
4. **No universal LWW.**
5. **No duplicate** cash, stock, order, or fiscal effects after replay — idempotency key **must** be `{terminalId}:{clientCommandId}` **plus** semantic fingerprint (offline-foundation §4) + domain uniqueness (CashShift, PCE, inventory posting). Bare opaque keys without terminal scope are insufficient.

### D4. Failover / recovery — no automatic Cloud takeover on lease expiry alone

**Forbidden:** Cloud automatically seizes partition write authority solely because a network lease timer expired, if the disconnected Edge **could still be processing**.

**Allowed recovery authority transfer** (explicit, audited):

| Path | Conditions |
| --- | --- |
| **Graceful handback** | Edge online; drains outbox; releases epoch; Cloud/new Edge acquires next epoch |
| **Confirmed Edge death** | Operator/support attest + installation unreachable beyond policy + no conflicting outbox risk assessment |
| **Split-brain detect** | Two writers claim same partition → **both** fail closed for new mutations until human/operator resolution; reconcile by chronology + idempotency, not LWW |
| **Backup restore** | Restored Edge must not resume old epoch; requires Cloud re-issue of WriterEpoch |

Lease expiry may trigger **alerts** and **read-only Cloud views**; it must **not** alone authorize Cloud writes that conflict with possible Edge progress.

#### D4.1 Safe manual recovery & old-writer quarantine (PO delta #4)

1. **Manual recovery only** — no automatic Cloud takeover; human/operator (or audited support procedure) initiates D4 transfer.  
2. **Old-writer quarantine:** when a new `WriterEpoch` is issued for a partition, any prior epoch’s fencing token is **QUARANTINED**:
   - Cloud **rejects** mutating ingest signed with quarantined tokens;
   - Edge holding a quarantined epoch must **refuse new financial mutations** and may only drain read-only / upload already-buffered outbox under Cloud quarantine rules;
   - Quarantined writers cannot be silently “un-quarantined” by lease timers.  
3. **Reconciliation:** after transfer, reconcile by business chronology + idempotency + domain uniqueness — **never** universal LWW. Duplicate cash/stock/order/fiscal effects remain forbidden.  
4. **Attestation record:** recovery path, actor, partition, old epoch id, new epoch id, reason — append-only audit.

### D5. LAN transport

- Terminals authenticate to Edge (mTLS or equivalent enrolled device credentials).
- LAN survival without WAN is expected (adversarial scenario 17).
- Edge DB/server failure → fail closed locally; no silent Cloud dual-write (scenario 18).

### D6. Acceptance scope

Freezes single-writer / fencing **contract**. Does not select Postgres HA topology or LAN crypto suite beyond “authenticated + enrolled.”

## Consequences

- Sync protocol must carry WriterEpoch.
- Cloud APIs for Edge-owned partitions need epoch-aware rejection paths.
- Complements ADR-0043 (who may act) and ADR-0045 (which ops).

## Alternatives considered

- Multi-master CRDT for cash/orders — rejected for financial facts.
- Universal LWW — rejected (ADR-0018).
- Automatic Cloud takeover on lease expiry — rejected (split-brain / duplicate effects risk).
- One writer for entire Tenant — rejected (LE/Outlet isolation).
