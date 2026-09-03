/**
 * Sends chunks to the ingest API.
 *
 * The last flush of a session happens while the page is being torn down, when nothing can be
 * awaited. `fetch(..., { keepalive: true })` covers that: the browser completes the request after
 * the document is gone, and unlike `sendBeacon` it can still set headers — so the API key travels
 * in `x-syncline-key` as it does everywhere else, rather than in a query string.
 *
 * Keepalive requests are capped at 64 KB of body across all in-flight requests, which is why the
 * flush threshold is set where it is.
 */

import { INGEST_KEY_HEADER, type SessionChunk } from '@syncline/protocol';

export interface TransportOptions {
  endpoint: string;
  key: string;
  /** Captured before the fetch patch is installed, so the SDK never traces its own uploads. */
  fetchImpl: typeof fetch;
}

export function chunkUrl(
  endpoint: string,
  sessionId: string,
  seq: number,
): string {
  return `${endpoint}/v1/ingest/session/${sessionId}/${seq}`;
}

/**
 * Compresses with `CompressionStream` where it exists.
 *
 * It is absent in older Safari and some embedded webviews, so an uncompressed body is a supported
 * outcome rather than a failure — the API detects gzip from the bytes and does not care either
 * way. Compression is also skipped for the final flush, where there is no time to await it.
 */
export async function encodeBody(
  payload: SessionChunk,
  compress = true,
): Promise<{ body: BodyInit; gzipped: boolean }> {
  const json = JSON.stringify(payload);

  if (!compress || typeof CompressionStream === 'undefined') {
    return { body: json, gzipped: false };
  }

  try {
    const stream = new Blob([json])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    return { body: await new Response(stream).blob(), gzipped: true };
  } catch {
    return { body: json, gzipped: false };
  }
}

export interface SendOptions {
  /** Set on the final flush so the request outlives the page. */
  keepalive?: boolean;
}

/**
 * When the server last said "not now", and until when.
 *
 * Module-level rather than per-recording, because the ceiling belongs to the project rather than
 * to one tab: a site that opens Syncline in several tabs would otherwise have each of them
 * discover the limit separately, which is the flood the limit exists to stop.
 */
let throttledUntilMs = 0;

/** Used when a 429 arrives without a usable `Retry-After` — one flush interval, roughly. */
const DEFAULT_THROTTLE_MS = 60_000;

/** For tests, and for a host that wants to know whether recording is currently being refused. */
export function isThrottled(now: number = Date.now()): boolean {
  return now < throttledUntilMs;
}

export function resetThrottle(): void {
  throttledUntilMs = 0;
}

export async function sendChunk(
  options: TransportOptions,
  sessionId: string,
  seq: number,
  payload: SessionChunk,
  sendOptions: SendOptions = {},
): Promise<boolean> {
  // Still inside the window the server asked for. Dropping the chunk here costs a gap in one
  // replay; sending it costs the server the thing it just refused.
  if (isThrottled()) return false;

  const keepalive = sendOptions.keepalive ?? false;
  const { body, gzipped } = await encodeBody(payload, !keepalive);

  try {
    const response = await options.fetchImpl(
      chunkUrl(options.endpoint, sessionId, seq),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(gzipped ? { 'content-encoding': 'gzip' } : {}),
          [INGEST_KEY_HEADER]: options.key,
        },
        body,
        // Recording is never worth sending someone's cookies. The key identifies the project; there
        // is nothing here to authenticate as.
        credentials: 'omit',
        keepalive,
      },
    );

    // A 429 is the server asking for quiet, and the worst possible reply is the next chunk five
    // seconds later. `Retry-After` names the moment it is worth trying again; until then the
    // recorder stops sending rather than adding to the flood it is being asked to stop.
    if (response.status === 429) {
      const after = Number(response.headers.get('retry-after'));
      throttledUntilMs =
        Date.now() +
        (Number.isFinite(after) && after > 0
          ? after * 1000
          : DEFAULT_THROTTLE_MS);
      return false;
    }

    return response.ok;
  } catch {
    // A dropped chunk is a gap in a replay, not an error worth surfacing to the host page.
    return false;
  }
}
