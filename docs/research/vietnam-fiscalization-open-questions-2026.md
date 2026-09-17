# Vietnam Fiscalization — Open Questions (2026)

**Baseline:** `1390758879e3764557c0b6930fe640b00547b749`  
**Primary blocker:** `NEEDS_TAX_ARCHITECTURE`  
**Do not invent answers. Escalate to PO / counsel / Circular 91 PDF.**

---

## A. Tax architecture (Level C — blocking)

| ID | Question | Why it blocks |
| --- | --- | --- |
| TAX-1 | Inclusive vs exclusive VAT for restaurant list prices? | Invoice needs ex-VAT / rate / VAT / inc-VAT for deduction-method orgs |
| TAX-2 | Line-level vs order-level tax allocation? | Fiscal lines must not invent Money |
| TAX-3 | Named RoundingPolicy context(s) for VAT / tax amount / invoice total? | ADR-0030 only owns BASE_LIST_LINE_GROSS |
| TAX-4 | Freeze point: commercial accept vs payment vs fiscal issue? | Snapshot immutability |
| TAX-5 | Zero-rate / exempt / non-VAT (sales invoice) handling? | Wrong invoice type risk |
| TAX-6 | Catalog/menu tax classification owner? | Source of rate |

---

## B. Legal / Circular 91 (parallel counsel)

| ID | Question | Label |
| --- | --- | --- |
| LEG-1 | Exact offline / connectivity-loss transmission windows for máy tính tiền under Decree 254 + Circular 91? | LEGAL_UNKNOWN |
| LEG-2 | May customer leave / sale continue while invoice queued but not transmitted? | LEGAL_UNKNOWN |
| LEG-3 | Dine-in open-tab / deposit timing vs Art. 9 service rules? | LEGAL_UNKNOWN |
| LEG-4 | Confirm English LuatVietnam Art. 10 VAT content against official Vietnamese PDF? | Verify VERIFIED OFFICIAL FACT |
| LEG-5 | Adjustment vs replacement mandatory path for POS cash-register errors (Circular 91)? | LEGAL_UNKNOWN |
| LEG-6 | Multi-outlet “business location code” mandatory fields for corporate chains? | LEGAL_UNKNOWN |

---

## C. ADR-0014 delta candidates (after Tax)

| ID | Question |
| --- | --- |
| ADR-1 | First-class FiscalDocumentMode enum: CÓ_MÃ / KHÔNG_MÃ / MÁY_TÍNH_TIỀN? |
| ADR-2 | InvoiceType: GTGT vs BÁN_HÀNG ownership? |
| ADR-3 | Terminal / cash-register identity ownership under LegalEntity + Outlet? |
| ADR-4 | Numbering: forbid local sequence if provider/CQT owns? |
| ADR-5 | FiscalCheckoutGate state vocabulary freeze? |
| ADR-6 | Default FiscalPolicy for payment-OK / fiscal-pending CompleteOrder? |

---

## D. Provider (non-blocking for architecture)

| ID | Question |
| --- | --- |
| PRV-1 | Direct GDT vs certified e-invoice provider vs POS stack? (no selection this block) |
| PRV-2 | Who holds signing keys (merchant token / HSM / provider)? |
| PRV-3 | Sandbox + certification path for máy tính tiền data format? |
| PRV-4 | Callback vs poll for CQT acceptance? |

---

## E. Explicitly out of scope this review

- Payment provider / NAPAS / MoMo / VNPAY / ZaloPay / cash  
- Tax engine code  
- Fiscal adapter code  
- Credentials / certificates  
- Refund runtime  
- Invoice production UI  

---

## Recommended PO sequence

1. **Approve Tax/VAT Architecture ADR launch** (Level C).  
2. Parallel: counsel answers LEG-1…LEG-6 using Decree 254 + Circular 91 official text.  
3. Then ADR-0014 delta if still needed.  
4. Then FISC1.1 Fiscalization Core Runtime.  
5. Provider selection later (sales/legal, like payments).
