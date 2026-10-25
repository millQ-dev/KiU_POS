/**
 * Prepare disposable DB + fixture JSON for CASH1.2 browser E2E.
 * Destructive — millq_ci_pos_* only.
 *
 * Usage:
 *   DATABASE_URL=... E2E_FIXTURE_PATH=... pnpm --filter @millq/api exec tsx src/test/cash12-close-e2e-prepare.ts
 */
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../db/migrate.js';
import { seedBlockCFixture } from './seed.js';
import { assertPosDisposableDatabaseUrl } from './disposable-database-url.js';
import { loadEnv, resolvePinPepper } from '../config.js';
import {
  IdentityService,
  PERMISSION_CASH_SHIFT_CLOSE,
  PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_POS_OPERATE,
} from '../modules/identity/index.js';
import { TEST_PIN } from './financial-auth-harness.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
assertPosDisposableDatabaseUrl(DATABASE_URL);

const FIXTURE_PATH = process.env.E2E_FIXTURE_PATH;
if (!FIXTURE_PATH) {
  throw new Error('E2E_FIXTURE_PATH is required');
}
const fixtureOutPath: string = FIXTURE_PATH;

/** Same pepper resolution as the running API (honours IDENTITY_PIN_PEPPER). */
const PEPPER = resolvePinPepper(loadEnv());

const MANAGER_PIN = '654321';

async function truncate(pool: pg.Pool) {
  await pool.query(`
    TRUNCATE
      payment_collection_event, payment_cash_collection_evidence,
      payment_allocation, payment_provider_outcome, payment, tender_definition,
      settlement_check_line_allocation, settlement_check, settlement_group,
      settlement_payable_snapshot,
      cash_shift,
      identity_notification_outbox, identity_audit_event,
      identity_approval_request, identity_login_challenge,
      identity_session, identity_access_grant, identity_auth_throttle,
      identity_network_throttle,
      identity_pin_credential, workforce_employee, identity_user, terminal,
      operational_fact_feed, audit_record,
      sales_order_line, sales_order,
      warehouse, outlet, brand, legal_entity, tenant
    RESTART IDENTITY CASCADE
  `);
}

async function main() {
  await runMigrations(DATABASE_URL);
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await truncate(pool);
    const fx = await seedBlockCFixture(pool);
    const identity = new IdentityService(pool, PEPPER);

    const terminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'T1','Front')`,
      [terminalId, fx.tenantId, fx.outletId],
    );

    const foreignTenantId = randomUUID();
    const foreignOutletId = randomUUID();
    const foreignBrandId = randomUUID();
    const foreignLeId = randomUUID();
    await pool.query(
      `INSERT INTO tenant (tenant_id, name, company_code) VALUES ($1,'Other Co',$2)`,
      [foreignTenantId, foreignTenantId.replace(/-/g, '').toUpperCase()],
    );
    await pool.query(
      `INSERT INTO legal_entity (legal_entity_id, tenant_id, name, jurisdiction_code, tax_required)
       VALUES ($1,$2,'Other LE','VN',FALSE)`,
      [foreignLeId, foreignTenantId],
    );
    await pool.query(`INSERT INTO brand (brand_id, tenant_id, name) VALUES ($1,$2,'Other')`, [
      foreignBrandId,
      foreignTenantId,
    ]);
    await pool.query(
      `INSERT INTO outlet (outlet_id, tenant_id, brand_id, legal_entity_id, name)
       VALUES ($1,$2,$3,$4,'Foreign Outlet')`,
      [foreignOutletId, foreignTenantId, foreignBrandId, foreignLeId],
    );
    const foreignTerminalId = randomUUID();
    await pool.query(
      `INSERT INTO terminal (terminal_id, tenant_id, outlet_id, code, name)
       VALUES ($1,$2,$3,'FX','Foreign')`,
      [foreignTerminalId, foreignTenantId, foreignOutletId],
    );

    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Cashier',
      pin: TEST_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_CLOSE, outletId: fx.outletId },
      ],
    });
    await identity.provisionUserWithPin({
      tenantId: fx.tenantId,
      displayName: 'Manager',
      pin: MANAGER_PIN,
      grants: [
        { permissionKey: PERMISSION_POS_OPERATE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_OPEN, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_CLOSE, outletId: fx.outletId },
        { permissionKey: PERMISSION_CASH_SHIFT_CLOSE_SHORTAGE, outletId: fx.outletId },
      ],
    });

    const company = await pool.query<{ company_code: string; name: string }>(
      `SELECT company_code, name FROM tenant WHERE tenant_id = $1`,
      [fx.tenantId],
    );

    const fixture = {
      tenantId: fx.tenantId,
      outletId: fx.outletId,
      legalEntityId: fx.legalEntityId,
      brandId: fx.brandId,
      terminalId,
      companyCode: company.rows[0]!.company_code,
      companyDisplayName: company.rows[0]!.name,
      cashierPin: TEST_PIN,
      managerPin: MANAGER_PIN,
      foreignCompanyCode: foreignTenantId.replace(/-/g, '').toUpperCase(),
      foreignTerminalId,
      openingAmountMinor: '100000',
      pceAmountMinor: '25000',
      expectedWithPceMinor: '125000',
    };
    writeFileSync(fixtureOutPath, JSON.stringify(fixture, null, 2));
    console.log(`e2e fixture written: ${fixtureOutPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
