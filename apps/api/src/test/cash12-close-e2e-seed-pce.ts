/**
 * Seed a confirmed CASH PaymentCollectionEvent for an OPEN CashShift (test fixture).
 * Not a product API — ReceiveCash UI is not yet on CashierShell (C0 gap).
 *
 * Usage:
 *   DATABASE_URL=... CASH_SHIFT_ID=... AMOUNT=25000 pnpm --filter @millq/api exec tsx src/test/cash12-close-e2e-seed-pce.ts
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { assertPosDisposableDatabaseUrl } from './disposable-database-url.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
assertPosDisposableDatabaseUrl(DATABASE_URL);

const cashShiftId = process.env.CASH_SHIFT_ID;
const amount = process.env.AMOUNT ?? '25000';
if (!cashShiftId) throw new Error('CASH_SHIFT_ID required');

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    const shift = await pool.query<{
      tenant_id: string;
      outlet_id: string;
      terminal_id: string;
      opened_by_user_id: string;
    }>(
      `SELECT tenant_id, outlet_id, terminal_id, opened_by_user_id
       FROM cash_shift WHERE cash_shift_id = $1 AND status = 'OPEN'`,
      [cashShiftId],
    );
    if (!shift.rows[0]) throw new Error('OPEN cash shift not found');
    const s = shift.rows[0];
    const le = await pool.query<{ legal_entity_id: string }>(
      `SELECT legal_entity_id FROM outlet WHERE outlet_id = $1`,
      [s.outlet_id],
    );
    const legalEntityId = le.rows[0]!.legal_entity_id;

    const orderId = randomUUID();
    const snapId = randomUUID();
    const groupId = randomUUID();
    const checkId = randomUUID();
    const tenderId = randomUUID();
    const paymentId = randomUUID();
    const evidenceId = randomUUID();
    const pceId = randomUUID();

    await pool.query(
      `INSERT INTO sales_order (order_id, tenant_id, legal_entity_id, outlet_id, status, channel)
       VALUES ($1,$2,$3,$4,'OPEN','DIRECT')`,
      [orderId, s.tenant_id, legalEntityId, s.outlet_id],
    );
    await pool.query(
      `INSERT INTO settlement_payable_snapshot (
         settlement_payable_snapshot_id, tenant_id, order_id, legal_entity_id,
         currency_code, minor_unit_exponent, commercial_fingerprint,
         merchandise_gross_minor, customer_payable_minor, semantic_fingerprint
       ) VALUES ($1,$2,$3,$4,'VND',0,'fp',$5,$5,'sem')`,
      [snapId, s.tenant_id, orderId, legalEntityId, amount],
    );
    await pool.query(
      `INSERT INTO settlement_group (
         settlement_group_id, tenant_id, order_id, legal_entity_id, state,
         currency_code, minor_unit_exponent, commercial_fingerprint,
         settlement_payable_snapshot_id, customer_payable_minor,
         open_idempotency_key, open_semantic_fingerprint
       ) VALUES ($1,$2,$3,$4,'COLLECTING','VND',0,'fp',$5,$6,$7,'sem')`,
      [groupId, s.tenant_id, orderId, legalEntityId, snapId, amount, `sg-${randomUUID()}`],
    );
    await pool.query(
      `INSERT INTO settlement_check (
         settlement_check_id, settlement_group_id, tenant_id, state,
         customer_payable_minor, currency_code, minor_unit_exponent, check_number
       ) VALUES ($1,$2,$3,'COLLECTING',$4,'VND',0,1)`,
      [checkId, groupId, s.tenant_id, amount],
    );
    await pool.query(
      `INSERT INTO tender_definition (
         tender_definition_id, tenant_id, legal_entity_id, code, display_name, instrument_family
       ) VALUES ($1,$2,$3,$4,'Cash','CASH')`,
      [tenderId, s.tenant_id, legalEntityId, `CASH-${randomUUID().slice(0, 8)}`],
    );
    await pool.query(
      `INSERT INTO payment (
         payment_id, tenant_id, legal_entity_id, tender_definition_id,
         currency_code, minor_unit_exponent, requested_amount_minor, lifecycle_state,
         create_idempotency_key, merchant_payment_reference
       ) VALUES ($1,$2,$3,$4,'VND',0,$5,'SUCCEEDED',$6,$7)`,
      [
        paymentId,
        s.tenant_id,
        legalEntityId,
        tenderId,
        amount,
        `pay-${randomUUID()}`,
        `mref-${randomUUID()}`,
      ],
    );
    await pool.query(
      `INSERT INTO payment_cash_collection_evidence (
         payment_cash_collection_evidence_id, payment_id, tenant_id, legal_entity_id,
         settlement_check_id, settlement_group_id, cash_shift_id, terminal_id, outlet_id,
         collected_by_user_id, amount_due_minor, amount_tendered_minor, change_minor,
         currency_code, minor_unit_exponent, human_confirmation, receive_idempotency_key, accepted_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'0','VND',0,TRUE,$12,NOW()
       )`,
      [
        evidenceId,
        paymentId,
        s.tenant_id,
        legalEntityId,
        checkId,
        groupId,
        cashShiftId,
        s.terminal_id,
        s.outlet_id,
        s.opened_by_user_id,
        amount,
        `rcv-${randomUUID()}`,
      ],
    );
    await pool.query(
      `INSERT INTO payment_collection_event (
         payment_collection_event_id, payment_id, tenant_id, legal_entity_id,
         settlement_check_id, settlement_group_id, instrument_family, collected_at,
         collection_evidence_kind, payment_cash_collection_evidence_id,
         amount_collected_minor, currency_code, minor_unit_exponent
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'CASH',NOW(),'CASH_RECEIVE',$7,$8,'VND',0
       )`,
      [pceId, paymentId, s.tenant_id, legalEntityId, checkId, groupId, evidenceId, amount],
    );
    console.log(JSON.stringify({ pceId, amountCollectedMinor: amount }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
