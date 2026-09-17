# KiU POS P0: Counter-Service Mixed Order

This is the first pilot scenario for KiU POS in `MillQ/apps/web`.

## Scenario

- Pilot: tableless Vietnamese counter-service cafe
- Role: Cashier
- Device: 10–15 inch landscape touch POS
- Test language: Russian, with EN and VI localization stress
- Channel: Takeaway
- Shift: persisted `OPEN` CashShift supplied by bootstrap/fixture

## Route

```text
New Order
→ add Coffee item
→ required modifier: Size / Medium
→ optional modifier: Milk / Oat
→ add Croissant
→ add kitchen item
→ change quantity 1 → 2
→ remove mistaken item
→ Pay (commercial acceptance and Settlement are automated behind the staff action)
→ Cash
→ enter tendered amount
→ confirm payment
→ Order SUBMITTED
→ create production tasks
→ receipt payload and preview
```

## Required outcomes

- modifiers are selected through human-readable questions;
- modifier fixed price deltas are included in backend pricing;
- frontend does not calculate official totals;
- cash tender and change are persisted;
- Payment is `PAID` independently from Order;
- Order is `SUBMITTED`, not `COMPLETED`;
- kitchen tasks are created from Order submission, once;
- fiscal status does not block this pilot;
- receipt payload is ready for preview and future printing;
- no table is required;
- no order, payment, or production state is silently lost.

## Test catalog shape

The first fixture should contain 15–20 synthetic-realistic items:

- Coffee: Espresso, Americano, Cappuccino, Latte, Iced Latte
- Food: Croissant, Ham & Cheese Croissant, Chicken Sandwich, Beef Sandwich, Caesar Salad
- Drinks: Water, Cola, Orange Juice
- edge data: missing price, unavailable, disabled, zero price, long RU name, long VI name

At least one coffee item has required and optional modifier groups, at least one
item requires production, and at least one item exercises a fixed `+10,000 VND`
modifier delta.
