import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Production default PIN length (ADR-0036). Configurable floor 4, ceiling 12. */
export const PIN_DEFAULT_LENGTH = 6;
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;
export const PIN_PATTERN = /^\d{4,12}$/;

export const KDF_VERSION_SCRYPT_V1 = 1;
const SCRYPT_KEYLEN = 64;
/** Opaque session secret bytes (>= 192-bit). */
export const SESSION_SECRET_BYTES = 32;
/** LoginChallenge QR token bytes (>= 192-bit). */
export const CHALLENGE_TOKEN_BYTES = 24;

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

export function hashPin(
  pin: string,
  pepper: string,
  saltHex?: string,
): { saltHex: string; hashHex: string; kdfVersion: number } {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const material = createHmac('sha256', pepper).update(`pin:${pin}`, 'utf8').digest();
  const hash = scryptSync(material, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 });
  return {
    saltHex: salt.toString('hex'),
    hashHex: hash.toString('hex'),
    kdfVersion: KDF_VERSION_SCRYPT_V1,
  };
}

export function verifyPin(pin: string, pepper: string, saltHex: string, hashHex: string): boolean {
  try {
    const { hashHex: computed } = hashPin(pin, pepper, saltHex);
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
export function dummyPinWork(pepper: string): void {
  hashPin('000000', pepper);
}
