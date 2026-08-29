/**
 * URL sanitization.
 *
 * A URL recorded against a session is data about a person's browsing, so query *values* are
 * dropped and only keys kept. `?token=abc123&page=2` becomes `?token&page`: enough to see the
 * shape of the request, not enough to leak a session token, an email address, or a search term
 * into a recording someone else will watch.
 */

const MAX_URL_LENGTH = 2048;

export function sanitizeUrl(raw: string, base?: string): string {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    // Not parseable, so it cannot be sanitized. Returning the path-ish prefix would risk keeping
    // exactly the part that carries secrets.
    return '(unparseable)';
  }

  const keys = [...new Set([...url.searchParams.keys()])];
  const query = keys.length > 0 ? `?${keys.join('&')}` : '';

  // The fragment never reaches a server and routinely holds tokens in OAuth implicit flows.
  const out = `${url.origin}${url.pathname}${query}`;
  return out.length > MAX_URL_LENGTH ? out.slice(0, MAX_URL_LENGTH) : out;
}
