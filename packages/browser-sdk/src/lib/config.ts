/**
 * SDK configuration and the origin allowlist.
 *
 * The allowlist decides which requests get a `traceparent` header. It is the most consequential
 * setting here: injecting the header into a third party leaks internal trace ids and, worse, adds
 * a header their CORS policy does not allow — turning a working request into a failed preflight.
 * See docs/ARCHITECTURE.md §3.7.
 */

export interface SynclineOptions {
  /** Public project key, `pk_*`. Safe to ship in a bundle; it is gated by the origin allowlist. */
  key: string;
  /** Base URL of the Syncline API, e.g. `https://syncline.example.com`. */
  endpoint: string;
  /**
   * Origins whose requests get a traceparent. Defaults to the page's own origin, which is the
   * answer for a same-origin API and the safe answer for everything else.
   */
  traceOrigins?: string[];
  /** Attached to the session so a replay can be tied back to a deploy. */
  release?: string;
  user?: { id: string };
  /**
   * Masks the value of every input, textarea and select. On by default: rrweb records whatever is
   * on screen, so the safe default has to be the one you opt out of.
   */
  maskAllInputs?: boolean;
  /** Emits SDK diagnostics to the console. Off by default. */
  debug?: boolean;
}

export interface ResolvedOptions extends Required<
  Omit<SynclineOptions, 'release' | 'user'>
> {
  release?: string;
  user?: { id: string };
}

export function resolveOptions(
  options: SynclineOptions,
  pageOrigin: string,
): ResolvedOptions {
  if (!options.key) throw new Error('syncline: `key` is required');
  if (!options.endpoint) throw new Error('syncline: `endpoint` is required');

  return {
    key: options.key,
    endpoint: options.endpoint.replace(/\/+$/, ''),
    traceOrigins: (options.traceOrigins ?? [pageOrigin]).map(normalizeOrigin),
    maskAllInputs: options.maskAllInputs ?? true,
    debug: options.debug ?? false,
    ...(options.release ? { release: options.release } : {}),
    ...(options.user ? { user: options.user } : {}),
  };
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    // Left as-is so an obviously wrong entry fails to match rather than throwing during setup and
    // taking the host page down with it.
    return origin;
  }
}

/**
 * Decides whether a request may carry a traceparent.
 *
 * Relative URLs are same-origin by definition and always qualify. Anything absolute has to match
 * an allowlisted origin exactly — no subdomain wildcards, because "*.acme.com" would happily
 * include a third-party widget someone parked on a subdomain.
 */
export function shouldTrace(
  url: string,
  allowlist: string[],
  pageOrigin: string,
): boolean {
  let target: URL;
  try {
    target = new URL(url, pageOrigin);
  } catch {
    return false;
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  return allowlist.includes(target.origin);
}
