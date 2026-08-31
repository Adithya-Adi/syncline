import { Tracer } from './otlp';

/**
 * Configuration, split along the line the two key kinds draw.
 *
 * The public key is `NEXT_PUBLIC_` because it is meant to ship to the browser — that is what makes
 * it public, and it is safe there because ingest gates it on the project's origin allowlist. The
 * secret key has no prefix, so Next will refuse to inline it into client code, which is exactly the
 * protection we want: it is only ever read inside a route handler.
 */

export const ENDPOINT = (
  process.env.NEXT_PUBLIC_SYNCLINE_ENDPOINT ?? 'http://localhost:4000'
).replace(/\/+$/, '');

export const PUBLIC_KEY = process.env.NEXT_PUBLIC_SYNCLINE_PUBLIC_KEY ?? '';

export const RELEASE =
  process.env.NEXT_PUBLIC_SYNCLINE_RELEASE ?? 'storefront@1.0.0';

/**
 * Reproduces the failure the setup doctor hunts for.
 *
 * With this set, the API stops advertising `traceparent` in Access-Control-Allow-Headers. Requests
 * from this app keep working — they are same-origin, so no preflight happens — but a cross-origin
 * probe starts failing, which is the real shape of the bug: it looks like Syncline broke the site,
 * and it is a CORS setting.
 */
export const BREAK_CORS = process.env.BREAK_CORS === '1';

/** One tracer per server process, reused by every route handler. */
export const tracer = new Tracer({
  endpoint: ENDPOINT,
  secretKey: process.env.SYNCLINE_SECRET_KEY ?? '',
  serviceName: 'storefront-api',
});

/**
 * CORS wide enough for a demo, and narrow in the one place that matters.
 *
 * `traceparent` is the header the browser SDK adds to traced requests, and an API that does not name
 * it here fails every traced request at the preflight. Same-origin requests from this app never
 * reach it, which is what makes the real version of this bug so confusing.
 */
export function corsHeaders(): Record<string, string> {
  const allowed = ['content-type'];
  if (!BREAK_CORS) allowed.push('traceparent');

  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': allowed.join(', '),
    'access-control-max-age': '600',
  };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders() });
}

/** Shared by every route handler, so a preflight is answered the same way everywhere. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
