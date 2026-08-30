/**
 * Project API key generation and hashing.
 *
 * Lives here rather than in @syncline/protocol because it needs node:crypto — protocol also runs
 * in the browser, where these functions have no business existing.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 32;

/** Public: ships in browser bundles. Write-only, and gated on the project's origin allowlist. */
export function newPublicKey(): string {
  return `pk_${randomBytes(KEY_BYTES).toString('base64url')}`;
}

/**
 * Secret: server-side only. Shown once at creation, then only its hash is retained — so this
 * return value is the only chance anyone has to record it.
 */
export function newSecretKey(): string {
  return `sk_${randomBytes(KEY_BYTES).toString('base64url')}`;
}

export function hashSecretKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Looking a key up by its hash is itself the comparison, so this is only needed where a candidate
 * is checked against a hash already in hand. Unequal lengths short-circuit, which leaks nothing a
 * caller does not already know.
 */
export function secretKeyMatches(
  candidate: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashSecretKey(candidate), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
