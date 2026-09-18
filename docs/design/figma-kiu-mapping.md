# ImaPos → KiU visual mapping

Status: working reference for the first visual slice. This is not a product
behavior contract.

Source: [ImaPos Point-of-Sale App UI Kit](https://www.figma.com/design/THnpxfH1PbpuK4o6ZRFANc/Imapos---Point-of-Sale-App-UI-Kit?node-id=19-864&m=dev&t=5vaWmvpjqgU4rOXZ-1)

## What we take from the reference

The file is a broad pattern library with onboarding, order, payment, tables,
kitchen display and backoffice families. Shared `Buttons`, `Forms`, `Cards`,
order summary and kitchen display patterns are useful visual references.

For KiU, the reusable visual grammar is:

- two-zone composition for entry/context screens;
- warm light surface with restrained gradient fields;
- large readable heading and short supporting copy;
- compact context card with clear hierarchy;
- explicit primary action;
- calm depth and controlled colour accents.

## KiU adaptations

| ImaPos reference | KiU implementation | Reason |
| --- | --- | --- |
| Gradient background fields | Copper/Teal background accents | Keeps the ImaPos softness inside the KiU palette |
| Large rounded cards | 4–8px radius and visible borders | Preserves POS precision and touch clarity |
| Generic button instances | Astryx/KiU button states, 48px+ touch target | Prevents misses on 10–15 inch touch screens |
| Form/input patterns | KiU controls with strong focus, selected and error states | Supports stress work and RU/EN/VI expansion |
| Order and payment cards | Separate Order, Payment and Production components | Keeps the accepted lifecycle boundaries intact |
| Kitchen Display frames | Future KDS surface | Not part of the first cashier slice |
| Decorative imagery | Only allowed on non-operational surfaces | Does not compete with action or status |

## First screen: `01-welcome`

The first screen keeps the established KiU fixture contract:

- RU is the pilot default; EN and VI are selectable for stress testing;
- outlet, terminal, cashier and `OPEN` shift are visible;
- the context is a design-lab fixture, not production Identity or Shift UI;
- the primary action is `Open cashier`;
- no order, payment, kitchen or fiscal behavior is invented here.

The current implementation adds the ImaPos-inspired gradient fields and
two-zone visual hierarchy while retaining KiU borders, touch sizing, Copper,
Teal and the existing component boundaries.

## Next review gate

Review this screen at the 10–15 inch landscape target. Check:

1. context is readable from a normal working distance;
2. language buttons and primary action are easy to hit;
3. Russian, English and Vietnamese copy do not break the layout;
4. the gradient supports the screen without reducing contrast.

Only after this review should the next chronological cashier screen be added.

