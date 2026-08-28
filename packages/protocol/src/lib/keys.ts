/**
 * Project API keys.
 *
 * `pk_*` ships inside browser bundles. It is public by construction, so it is write-only and
 * additionally gated on the project's origin allowlist. `sk_*` is server-side and never leaves the
 * customer's infrastructure. Neither key can read data.
 */

export const PUBLIC_KEY_PREFIX = 'pk_';
export const SECRET_KEY_PREFIX = 'sk_';

/** 32 bytes of base64url, which is what `newKey` produces. */
const KEY_BODY_RE = /^[A-Za-z0-9_-]{43}$/;

export type KeyKind = 'public' | 'secret';

export function keyKind(key: string): KeyKind | null {
  if (key.startsWith(PUBLIC_KEY_PREFIX)) return 'public';
  if (key.startsWith(SECRET_KEY_PREFIX)) return 'secret';
  return null;
}

export function isWellFormedKey(key: string): boolean {
  const kind = keyKind(key);
  if (!kind) return false;
  return KEY_BODY_RE.test(key.slice(3));
}

/**
 * Well-formedness only. This says nothing about whether the key exists or is authorized — that is
 * a database lookup, and it must run in constant time against a hash, not a string compare.
 */
export function assertWellFormedKey(key: string): void {
  if (!isWellFormedKey(key)) throw new Error('malformed API key');
}
