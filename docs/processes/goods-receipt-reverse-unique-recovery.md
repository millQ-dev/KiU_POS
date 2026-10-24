# GoodsReceipt reverse UNIQUE — recovery / rollback playbook

**Scope:** Index `uq_goods_receipt_reverses_original` from migration `033_goods_receipt_reverse_unique.sql`.  
**Not automatic:** Dropping the index requires a separate operational decision. Do not invent history rewrites.

## Intended apply path

1. Confirm target DB audit: zero duplicate `reverses_goods_receipt_id` groups (Phase 3 style).
2. Apply via MillQ transactional migrator (`pnpm --filter @millq/api run migrate`).
3. Migration runs in one transaction with other DDL in that file; failure rolls back the whole migration file + `schema_migrations` insert.

## Lock profile

- `CREATE UNIQUE INDEX` (non-`CONCURRENTLY`) takes a writer-blocking lock for the build duration.
- Acceptable for small tables (local/pilot). Large live tables need a separate online playbook (`CONCURRENTLY` outside the transactional runner) — not this migration.

## Name / definition collision

- Index name is fixed: `uq_goods_receipt_reverses_original`.
- Do **not** paper over collision with `IF NOT EXISTS`.
- If an object with that name already exists with a different definition, migration fails → investigate manually, do not force-apply.

## Rollback (ops-only)

Only after explicit owner/ops GO:

```sql
BEGIN;
DROP INDEX IF EXISTS uq_goods_receipt_reverses_original;
-- Optionally delete the schema_migrations row for 033_goods_receipt_reverse_unique.sql
-- so a corrected migration can be re-applied. Coordinate with engineering.
COMMIT;
```

Rollback removes the DB guard only. It does **not** delete reverse documents or movements. Application code that maps `23505` on this index should be reverted or remain harmless if the index is absent (no unique violation to catch).

## Forward repair if duplicates appear before apply

1. HOLD migration.
2. Read-only investigation (aggregate counts first).
3. Manual remediation plan with FinSec/Architecture — never auto-delete posted history.
