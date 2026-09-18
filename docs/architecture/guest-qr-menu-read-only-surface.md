# Guest QR Menu — Architecture Clarification (read-only public surface)

**Status:** Implemented in Level B runtime PR (`feature/guest-qr-menu-readonly`) — pending independent review  
**Date:** 2026-09-18  
**Related:** ADR-0029, ADR-0024, ADR-0008, ADR-0017, ADR-0031; Menu Configuration; Catalog ≠ Menu ≠ POS Presentation ≠ Channel Menu

## Pipeline (binding)

```text
MenuDefinition
  → immutable MenuPublication
  → MenuResolver
  → GuestMenuProjection
  → public read-only endpoint
  → Guest web UI
  → QR opaque token
```

## Capability

Canonical key:

```text
guest_menu.qr
```

Gated by **both** `PackageEntitlement` and `OutletCapabilityConfig` for key `guest_menu.qr` (ADR-0008). Fail closed if either is missing/false.  
**Forbidden:** `if package === CORNER|CAFE|RESTAURANT` domain forks.

## Module boundary

Supporting module (runtime PR B): `apps/api/src/modules/guest-menu/`

**May consume:** MenuResolver, Catalog presentation refs, AllergenResolver projection, Organization/outlet public presentation, opaque GuestMenuAccessToken.

**MUST NOT own:** Catalog identity, PriceRule, AvailabilityRule, MenuPublication, Order, Payment, Tax, Fiscal truth.

Guest QR Menu is a **Channel / Public presentation projection**. It does **not** become a second Menu engine. Grab/Shopee adapters remain separate Integration adapters (ADR-0012).

## Opaque token

Do **not** put tenantId / outletId / tableId / internal UUIDs in the QR URL.

```text
GuestMenuAccessToken / PublicMenuLink
  tokenHash, tenantId, outletId, diningAreaId?, tableId?,
  enabled, validFrom?, validTo?, createdAt, revokedAt?
```

URL: `/m/{opaqueToken}` — internal IDs resolved server-side.  
Token = identification/routing context, **not** employee authentication.

## MVP = READ ONLY

Public projection may include: localized name/description, media refs, resolved price/availability, modifiers when supported, allergen/dietary resolution (ADR-0024), outlet/brand public presentation, language selector.

**NO MVP:** AddOrderLine, CreateOrder, payment, customer account, guest PII, loyalty, table mutation, self-order, direct DB writes from guest UI.

## SalesContext / channel

Guest Menu **MUST** resolve via existing **MenuResolver** (ADR-0029). Do not reimplement PriceRule/AvailabilityRule precedence.

**MVP policy:** read-only QR resolves the same configured **DIRECT** commercial surface (`Order.channel` string already defaults to `DIRECT`).  

**Do not** introduce a new `GUEST_QR` channel enum value in this architecture pass — that would expand the channel taxonomy without a dedicated decision. If a future dedicated public channel is required, stop for architecture review rather than silently adding it.

## Media

No existing media/asset abstraction found in repo. Runtime PR B may introduce **minimum PresentationMediaAsset** (reference / URL / locale) for guest/POS presentation. Binary blobs are **not** MenuPublication economic truth. Image mutation must not rewrite historical Order/commercial snapshots.

## Allergens

ADR-0024 remains authority. Guest Menu may call AllergenResolver; must not invent safety. No second allergen model.

## Table context

Token **may** optionally bind DiningArea/Table. Read-only guest menu **must not require** Table (Order ≠ Table; Corner/Cafe without tables).

## Security (public API)

- No employee auth required for read  
- Tenant/outlet only from opaque token  
- Rate limiting; no arbitrary tenant ID parameter  
- No COGS / supplier / unpublished menu / employee / private Catalog leakage  
- Revoked/invalid token → fail closed  

## Guest UI

Separate mobile-first guest surface. Do not reuse cashier UI that leaks permissions, internal IDs, COGS, or POS layout controls. Shared dumb visual components OK.

## Out of scope for Guest QR MVP

Checkout, Payments, Tax/VAT, Fiscalization, Inventory/COGS, Revenue snapshots, Settlement, POS commercial semantics changes.
