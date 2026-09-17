# Vietnam Fiscalization Gap Matrix — 2026

**Baseline:** `1390758879e3764557c0b6930fe640b00547b749`  
**Primary verdict:** `NEEDS_TAX_ARCHITECTURE`  
**Companion:** `vietnam-fiscalization-readiness-2026.md`

Gap types (exact): `NONE` | `IMPLEMENTATION` | `ADR_DELTA` | `UPSTREAM_TAX` | `LEGAL_UNKNOWN` | `PROVIDER_UNKNOWN`

Evidence labels: VERIFIED OFFICIAL FACT | PROVIDER IMPLEMENTATION FACT | LEGAL INTERPRETATION | UNKNOWN

---

## Gap matrix

| # | Requirement | Official / evidence source | Current ADR-0014 (and related) answer | Runtime capable? | Gap type |
| --- | --- | --- | --- | --- | --- |
| 1 | Dedicated Fiscalization module separate from Orders/Settlement/Payments | ADR-0014 Accepted | Yes — module + FiscalDocument ownership | No runtime | IMPLEMENTATION (blocked upstream) |
| 2 | Order ≠ FiscalDocument; immutable issued docs | ADR-0014 | Yes | Partial (gate only) | IMPLEMENTATION |
| 3 | FiscalDocument modes: có mã / không mã / máy tính tiền | Decree 254/2026 Art. 6 (gov) | ADR-0014 speaks generically of FiscalDocument / provider | No | ADR_DELTA |
| 4 | Invoice type VAT (GTGT) vs sales (bán hàng) | Decree 254 Art. 8 | Not typed in ADR-0014 | No | ADR_DELTA |
| 5 | Restaurant/F&B corporate → máy tính tiền eligible/required unless already coded/non-coded | Decree 254 Art. 6; gov FAQ lineage from 70/2025 | JurisdictionProfile / FiscalPolicy placeholder | No | IMPLEMENTATION + policy config |
| 6 | Do not apply household 1B VND threshold to enterprises | Decree 254 Art. 6 (LEGAL INTERPRETATION) | N/A | N/A | NONE (research constraint) |
| 7 | Issue timing for services: completion or payment collection | Decree 254 Art. 9 | ADR-0032: FiscalPolicy owns timing | Gate exists UNAVAILABLE | LEGAL_UNKNOWN (dine-in edge) + IMPLEMENTATION |
| 8 | Settlement SATISFIED → FiscalCheckoutGate → CompleteOrder | ADR-0032 / S1.1 | Yes | Yes (gate fail-closed) | NONE (architecture) |
| 9 | Gate states NOT_REQUIRED / PENDING / SATISFIED / FAILED_* / UNAVAILABLE | Launch + ADR-0032 port | Partial enum in S1.1 | UNAVAILABLE only in prod | ADR_DELTA (vocabulary polish) |
| 10 | Payment success + fiscal failure: CompleteOrder policy | ADR-0032 §20 | FiscalPolicy owns | No FiscalPolicy runtime | LEGAL_UNKNOWN + IMPLEMENTATION |
| 11 | Offline queue without fabricating acceptance | ADR-0014 | Yes | No | LEGAL_UNKNOWN (windows) + IMPLEMENTATION |
| 12 | Correction: điều chỉnh / thay thế; no silent mutate | Circular 91 summaries (LEGAL INTERPRETATION); ADR-0014 | Yes principle | No | IMPLEMENTATION |
| 13 | Refund → compensating fiscal document | Future Refund block | ADR-0014 correction chains | No | IMPLEMENTATION (future) |
| 14 | Seller LegalEntity name, address, MST | Decree 254 Art. 10 | ADR-0014 LegalEntity | LegalEntity exists; fiscal fields incomplete | ADR_DELTA / IMPLEMENTATION |
| 15 | Outlet / business location / cash-register / terminal id | Decree 254 Art. 10; KPMG note | Terminal concept weak | No | ADR_DELTA |
| 16 | Buyer identity only when requested (B2C) | Decree 254 Art. 10 | Not modeled | No | IMPLEMENTATION |
| 17 | B2B buyer tax code / company name | Decree 254 | Not modeled | No | IMPLEMENTATION |
| 18 | businessDateTime / invoice issue timestamp ≠ DB createdAt | ADR-0014 / SalesContext | businessDate on CompleteOrder | Partial | IMPLEMENTATION |
| 19 | Merchandise gross / payable ≠ invent fiscal Money | ADR-0014, ADR-0028 | Explicit | Yes (consume only) | NONE |
| 20 | **VAT ex-tax / rate / amount / inc-tax on invoice** | Decree 254 Art. 10.4(c) (LuatVietnam EN of official decree) — VERIFIED OFFICIAL FACT for architecture | Fiscalization must not invent Tax | **No Tax domain** | **UPSTREAM_TAX** |
| 21 | Tax rounding separate from BASE_LIST_LINE_GROSS | ADR-0030 | Only BASE_LIST_LINE_GROSS named | No | **UPSTREAM_TAX** |
| 22 | Tax classification / exemption / zero-rate snapshot | — | Absent | No | **UPSTREAM_TAX** |
| 23 | Provider-neutral Fiscalization Core → adapter | ADR-0014 | Yes direction | No | IMPLEMENTATION |
| 24 | Direct GDT vs certified provider vs platform API | Market research | Adapter ports | No selection | PROVIDER_UNKNOWN (allowed) |
| 25 | Issue / status / cancel / replace / adjust APIs | Provider docs (MISA, Viettel) | Ports sketched | No | PROVIDER_UNKNOWN + IMPLEMENTATION |
| 26 | Signing: token / HSM / provider | Provider docs | Prefer not hold keys in KiU | No | PROVIDER_UNKNOWN + security note |
| 27 | Numbering: symbol / series / sequential / CQT code | Decree + provider | Prefer provider/tax ownership | No | ADR_DELTA (ownership rule) |
| 28 | Idempotent Issue + inquiry; no duplicate legal invoice | ADR-0014 | Principle yes | No | IMPLEMENTATION |
| 29 | Provider truth ≠ UI success | ADR-0014 | Analogous PAY1.1 | No | IMPLEMENTATION |
| 30 | Delivery (print / QR / email) ≠ legal issuance | ADR-0014 | Presentation separate | No | IMPLEMENTATION |
| 31 | Revenue reporting ≠ fiscal calculator | ADR-0028 | Explicit | Reporting absent fiscal | NONE |

---

## Gap summary by type

| Gap type | Count (approx) | Blocking FISC1.1? |
| --- | --- | --- |
| **UPSTREAM_TAX** | 3 (#20–22) | **YES — highest** |
| ADR_DELTA | ~6 | After Tax ADR |
| LEGAL_UNKNOWN | ~3 | Parallel counsel / Circular 91 |
| PROVIDER_UNKNOWN | ~4 | Not blocking architecture |
| IMPLEMENTATION | many | After semantics closed |
| NONE | several | — |

---

## Decision packet (Level C — Tax)

**Required before Fiscal Runtime:**

1. Authoritative tax facts per line and/or order: classification, rate, taxable base, tax amount, inclusive vs exclusive semantics.  
2. Named RoundingPolicy context(s) for VAT / invoice tax / invoice total (not reuse `BASE_LIST_LINE_GROSS`).  
3. Historical snapshot at commercial acceptance (or defined fiscal freeze point).  
4. Exemption / zero-rate / non-VAT sales invoice handling.  
5. Explicit: Fiscalization consumes Tax snapshot; never recalculates.

Until then: **do not start FISC1.1**.
