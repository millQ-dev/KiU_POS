/**
 * Shared harness for authenticated POS / financial HTTP tests (SEC-0).
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  IdentityService,
  PERMISSION_POS_OPERATE,
  SESSION_COOKIE_NAME,
} from '../modules/identity/index.js';
import type { BlockCFixture } from './seed.js';

export const TEST_ORIGIN = 'http://localhost:5173';
export const TEST_PIN = '123456';

export async function provisionPosOperator(
  identity: IdentityService,
  fx: BlockCFixture,
  opts?: { pin?: string; displayName?: string; outletScoped?: boolean },
): Promise<{ userId: string; employeeId: string }> {
  // Default tenant-wide grant so Payments HTTP (outlet often unknown a priori) authorizes
  // under Accepted assertPermission semantics. Outlet-scoped grants still work for POS
  // when outletId is supplied on the request.
  return identity.provisionUserWithPin({
    tenantId: fx.tenantId,
    displayName: opts?.displayName ?? 'SEC0 Cashier',
    pin: opts?.pin ?? TEST_PIN,
    grants: [
      {
        permissionKey: PERMISSION_POS_OPERATE,
        outletId: opts?.outletScoped === true ? fx.outletId : null,
      },
    ],
  });
}

export async function loginPosSession(
  app: FastifyInstance,
  pool: pg.Pool,
  fx: BlockCFixture,
  pin: string = TEST_PIN,
): Promise<string> {
  const row = await pool.query<{ company_code: string }>(
    `SELECT company_code FROM tenant WHERE tenant_id = $1`,
    [fx.tenantId],
  );
  const companyCode = row.rows[0]!.company_code;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/identity/pin/authenticate',
    payload: { companyCode, pin, channel: 'TERMINAL' },
    headers: { origin: TEST_ORIGIN },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  const match = cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) throw new Error('session cookie missing');
  return match[1];
}

export function authInjectHeaders(sessionToken: string): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    origin: TEST_ORIGIN,
  };
}
