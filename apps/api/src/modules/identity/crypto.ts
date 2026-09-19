import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

/** Production default PIN length (ADR-0036). Configurable floor 4, ceiling 12. */
export const PIN_DEFAULT_LENGTH = 6;
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;
export const PIN_PATTERN = /^\d{4,12}$/;

export const KDF_VERSION_SCRYPT_V1 = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 } as const;
/** Opaque session secret bytes (>= 192-bit). */
export const SESSION_SECRET_BYTES = 32;
/** LoginChallenge QR token bytes (>= 192-bit). */
export const CHALLENGE_TOKEN_BYTES = 24;

/** Bound concurrent KDFs to limit event-loop / CPU DoS. */
const KDF_MAX_CONCURRENT = 2;
let kdfInFlight = 0;
const kdfWaiters: Array<() => void> = [];

async function withKdfSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (kdfInFlight >= KDF_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => kdfWaiters.push(resolve));
  }
  kdfInFlight += 1;
  try {
    return await fn();
  } finally {
    kdfInFlight -= 1;
    const next = kdfWaiters.shift();
    if (next) next();
  }
}

function scryptDerive(material: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(material, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function requirePepper(pepper: string | undefined): string {
  if (!pepper || pepper.length < 32) {
    throw new Error('IDENTITY_PIN_PEPPER is required (min 32 chars); refusing insecure PIN crypto');
  }
  return pepper;
}

export function pinLookupHash(pin: string, pepper: string, tenantId: string): string {
  return createHmac('sha256', pepper).update(`lookup:${tenantId}:${pin}`, 'utf8').digest('hex');
}

export async function hashPin(
  pin: string,
  pepper: string,
  saltHex?: string,
): Promise<{ saltHex: string; hashHex: string; kdfVersion: number }> {
  return withKdfSlot(async () => {
    const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
    const material = createHmac('sha256', pepper).update(`pin:${pin}`, 'utf8').digest();
    const hash = await scryptDerive(material, salt);
    return {
      saltHex: salt.toString('hex'),
      hashHex: hash.toString('hex'),
      kdfVersion: KDF_VERSION_SCRYPT_V1,
    };
  });
}

export async function verifyPin(
  pin: string,
  pepper: string,
  saltHex: string,
  hashHex: string,
): Promise<boolean> {
  try {
    const { hashHex: computed } = await hashPin(pin, pepper, saltHex);
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(hashHex, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateOpaqueToken(bytes = SESSION_SECRET_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-ish dummy work to reduce timing oracle on miss. */
export async function dummyPinWork(pepper: string): Promise<void> {
  await hashPin('000000', pepper);
}
