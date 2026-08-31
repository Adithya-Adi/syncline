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

/**
 * A fragment that is a route rather than a payload.
 *
 * Path-like and short: `#/checkout`, `#details`. An OAuth implicit-flow fragment
 * (`#access_token=…&token_type=…`) carries `=` and `&` and is refused, which is the case the
 * fragment is normally dropped for.
 */
const ROUTE_FRAGMENT = /^#[A-Za-z0-9/_\-.~]{0,64}$/;

/**
 * Like `sanitizeUrl`, but keeps a route-shaped fragment.
 *
 * Used for pageviews only. A hash router puts the whole route in the fragment, so dropping it would
 * record every page of such an app under one identical URL and make the flow useless — while a
 * fragment carrying anything that looks like credentials is still discarded.
 */
export function sanitizeRouteUrl(raw: string, base?: string): string {
  const sanitized = sanitizeUrl(raw, base);
  if (sanitized === '(unparseable)') return sanitized;

  let hash = '';
  try {
    hash = new URL(raw, base).hash;
  } catch {
    return sanitized;
  }

  if (!hash || !ROUTE_FRAGMENT.test(hash)) return sanitized;

  const out = `${sanitized}${hash}`;
  return out.length > MAX_URL_LENGTH ? out.slice(0, MAX_URL_LENGTH) : out;
}
