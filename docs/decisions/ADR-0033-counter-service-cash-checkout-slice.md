# ADR-0033: Counter-Service Cash Checkout Vertical Slice

- **Status:** Accepted
- **Date:** 2026-09-17
- **Accepted:** 2026-09-17 (Product Owner decision recorded in the KiU POS product session)
- **Decision owners:** Product Owner and System Architect
- **Related:** ADR-0008, ADR-0013, ADR-0014, ADR-0016, ADR-0025, ADR-0028, ADR-0029, ADR-0030, ADR-0032

## Context

The first KiU POS pilot is a tableless Vietnamese counter-service cafe.
The first real vertical slice must prove that a cashier can create a mixed
takeaway order, select modifiers, accept cash, submit the order to production,
and produce receipt data without collapsing Order, Payment, Production, or
Fiscalization into one lifecycle.

The existing Orders runtime supports an editable `OPEN` order and authoritative
commercial acceptance, but Settlement, cash payment, modifier persistence,
production task creation, and receipt payloads are not yet connected to the POS
surface.

## Decision

### 1. First pilot and preconditions

The first pilot is counter-service / takeaway with tables disabled.

The first slice receives a real `OPEN` CashShift through a development
bootstrap/fixture containing:

- cashier identity;
- outlet;
- terminal/device reference;
- opening cash;
- VND currency.

The Open Shift / Close Shift interface is a following vertical slice. The shift
is still a real persisted business entity and is referenced by the cash sale.

### 2. Lifecycle separation

The first slice keeps these lifecycles separate:

```text
Order:       OPEN (draft) → SUBMITTED → COMPLETED / CANCELLED
Payment:     PENDING → SUCCEEDED (product: PAID) / FAILED / CANCELLED / EXPIRED / UNKNOWN
Production:  NOT_STARTED → IN_PROGRESS → READY → COMPLETED
Fiscal:      separate future lifecycle
```

`OPEN` remains the current persisted technical name for the editable draft
state, preserving the existing Orders contract. `SUBMITTED` is the new
post-checkout Order state. The product language may call the intermediate state
submitted/confirmed, but the implementation must use one repository enum and
must not create two synonymous persisted states.

Successful cash checkout produces:

- Order = `SUBMITTED`;
- Payment = `PAID` at the product level. The existing provider-neutral
  Payments Core records this authoritative lifecycle as `SUCCEEDED`;
  presentation may show it as Paid;
- Production = `IN_PROGRESS` when at least one line requires production;
- no Fiscal prerequisite or fiscal failure blocks this pilot path.

Payment does not make an Order `COMPLETED`. `COMPLETED` remains reserved for
actual fulfillment/hand-off and the existing inventory write-off boundary in
ADR-0025.

### 3. Order submission and production

Production work is created from an idempotent `OrderSubmitted` application
event/fact. It is never created by:

- adding a line to a basket;
- every product tap;
- a Payment row directly.

For this slice, a CatalogItem may carry an explicit `requiresProduction`
classification used to identify kitchen-relevant lines. This is a narrow
fixture/runtime marker, not the final Production Routing model. Full
condition → node → destination routing, stations, KDS, printers, re-fire, and
course timing remain later work.

### 4. Modifiers and authoritative pricing

The first slice supports only:

- required and optional groups;
- minimum and maximum selections;
- fixed price deltas in VND;
- zero-price modifiers;
- persistence of the selected modifier snapshot with each OrderLine.

The backend validates modifier membership and selection cardinality, then
performs the authoritative commercial calculation. The frontend never computes
the official total. The existing ADR-0030 rounding boundary remains the owner
of line gross rounding; modifier deltas are included in the backend commercial
basis before that calculation.

Percentage pricing, conditional pricing, size matrices, Effective Recipe
resolution, modifier-driven inventory consumption, and complex routing are
deferred.

### 5. Cash checkout and Settlement

The checkout path uses the ADR-0032 boundary:

```text
accepted Order
  → OpenSettlement
  → frozen Payable Snapshot
  → one full Check
  → Cash Payment
  → PaymentAllocation
  → satisfied Settlement
  → Order submission
```

The first slice supports one full Check and one cash tender. It records:

- customer payable;
- amount tendered;
- change;
- payment status;
- CashShift reference;
- idempotency evidence.

Split, mixed tenders, QR, provider callbacks, reconciliation, cash
denomination rounding, tips, tax, and fiscal adapters are outside this slice.

Payment remains non-custodial and does not write inventory.

### 6. Receipt

After successful cash payment, the system produces a canonical receipt payload
and a preview. The payload includes order identity, time, outlet, terminal,
cashier, lines, modifier snapshots, quantities, prices, subtotal/total,
payment method, tendered cash, change, and currency.

Physical printer adapters are not simulated or represented as successful
printing in this slice.

## Acceptance contract

```text
GIVEN
an authenticated cashier context, selected outlet and terminal, an OPEN
CashShift with opening cash, an available takeaway catalog, and no active Order

WHEN
the cashier creates an Order, adds five positions, selects required and
optional modifiers, changes one quantity, removes one mistaken line, accepts
the authoritative commercial result, and confirms a cash payment

THEN
the Order remains editable until checkout, selected modifiers and their price
deltas are persisted with OrderLines, the backend records the exact cash tender
and change, Payment is PAID, Order is SUBMITTED, production tasks are created
once for kitchen lines, and receipt data plus preview are available

PERSISTED STATE
Order, OrderLines, selected modifier snapshots, commercial terms, SettlementGroup,
Check, Payment, PaymentAllocation, CashShift transaction, production tasks,
receipt payload, and audit/idempotency evidence

DOWNSTREAM RESULT
the kitchen sees relevant production work, the cashier cannot lose the
completed payment context, the manager can find the sale, and the receipt is
ready for a future printer adapter
```

## Explicit non-goals

- production Identity implementation;
- Open Shift / Close Shift UI;
- QR or card provider integration;
- fiscal provider or Vietnam tax rules;
- physical printer integration;
- full KDS and routing configuration;
- tables, reservations, split bills, mixed tenders;
- Effective Recipe and modifier-driven inventory write-off;
- migration/import module.

## Consequences

- A new Order transition is required while preserving the existing `OPEN`
  draft state.
- Cash checkout must use Settlement and Payment boundaries from ADR-0032.
- Modifier data needs immutable line-level selection snapshots.
- Production task creation must be transactionally safe and idempotent.
- `CompleteOrder` and inventory write-off remain outside cash checkout.
- This block is Level C/B: the product and boundary decisions are accepted;
  implementation still requires specialist review of money, persistence,
  concurrency, and audit invariants.
