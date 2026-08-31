const FALLBACK = '/dashboard';

/**
 * Sanitizes a post-sign-in destination taken from the query string.
 *
 * An invitation link sends someone to sign in and expects them back, so the destination has to
 * survive the round trip — but it arrives from the URL, which means it arrives from anyone. Only a
 * single-slash absolute path is allowed: `//evil.example` is a protocol-relative URL that a browser
 * treats as another origin, and `https://…` is one outright. Both would turn the sign-in page into
 * an open redirect that borrows this app's credibility.
 */
export function safeNextPath(raw?: string | string[]): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return FALLBACK;
  if (!value.startsWith('/')) return FALLBACK;
  if (value.startsWith('//')) return FALLBACK;
  // A backslash is normalized to a forward slash by some browsers, so `/\evil.example` is the same
  // trick wearing a different hat.
  if (value.startsWith('/\\')) return FALLBACK;
  return value;
}
