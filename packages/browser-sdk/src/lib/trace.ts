/**
 * Patches `fetch` and `XMLHttpRequest` to mint W3C trace context.
 *
 * Two rules govern everything here (docs/ARCHITECTURE.md §3.7):
 *
 *   1. Never inject cross-origin. The allowlist is checked before a header is touched.
 *   2. Never break the page. Every piece of our logic is wrapped, and any failure falls through
 *      to the original implementation. A recording tool that takes down checkout is worse than no
 *      recording tool.
 */

import {
  formatTraceparent,
  newSpanId,
  newTraceId,
  TRACEPARENT_HEADER,
  type RequestEndPayload,
  type RequestStartPayload,
} from '@syncline/protocol';
import { shouldTrace } from './config.js';
import { sanitizeUrl } from './url.js';

export interface TraceHooks {
  onStart(payload: RequestStartPayload): void;
  onEnd(payload: RequestEndPayload): void;
}

export interface TraceContextOptions {
  traceOrigins: string[];
  pageOrigin: string;
}

/** Returns the ids for a request, or null when it must not be traced. */
function contextFor(
  url: string,
  method: string,
  options: TraceContextOptions
): RequestStartPayload | null {
  if (!shouldTrace(url, options.traceOrigins, options.pageOrigin)) return null;

  return {
    traceId: newTraceId(),
    spanId: newSpanId(),
    method: method.toUpperCase(),
    url: sanitizeUrl(url, options.pageOrigin),
    startMs: Date.now(),
  };
}

type FetchTarget = { fetch: typeof fetch };

/**
 * Installs the fetch patch and returns a function that removes it.
 *
 * When the caller passes a `Request`, its headers are set in place rather than reconstructing it.
 * `new Request(existing)` marks the original's body as used, which would break any caller that
 * still intended to read it.
 */
export function installFetchPatch(
  target: FetchTarget,
  options: TraceContextOptions,
  hooks: TraceHooks
): () => void {
  const original = target.fetch;

  target.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let started: RequestStartPayload | null = null;

    try {
      const isRequest = typeof Request !== 'undefined' && input instanceof Request;
      const url = isRequest ? input.url : String(input);
      const method = init?.method ?? (isRequest ? input.method : 'GET');

      started = contextFor(url, method, options);

      if (started) {
        const header = formatTraceparent({
          traceId: started.traceId,
          spanId: started.spanId,
          // Always sampled. The browser decides, so a recorded session can never end up without
          // the spans that explain it. See §3.4.
          sampled: true,
        });

        if (isRequest && !init?.headers) {
          input.headers.set(TRACEPARENT_HEADER, header);
        } else {
          const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
          headers.set(TRACEPARENT_HEADER, header);
          init = { ...init, headers };
        }

        hooks.onStart(started);
      }
    } catch {
      // Instrumentation failed. The request still has to go out.
      started = null;
    }

    try {
      const response = await original.call(target, input as RequestInfo, init);
      if (started) {
        safely(() => hooks.onEnd({ spanId: started.spanId, endMs: Date.now(), status: response.status }));
      }
      return response;
    } catch (error) {
      if (started) {
        safely(() =>
          hooks.onEnd({
            spanId: started.spanId,
            endMs: Date.now(),
            error: error instanceof Error ? error.message.slice(0, 256) : 'network error',
          })
        );
      }
      throw error;
    }
  } as typeof fetch;

  return () => {
    target.fetch = original;
  };
}

interface PatchedXhr extends XMLHttpRequest {
  __syncline?: RequestStartPayload | null;
}

export function installXhrPatch(
  ctor: typeof XMLHttpRequest,
  options: TraceContextOptions,
  hooks: TraceHooks
): () => void {
  const originalOpen = ctor.prototype.open;
  const originalSend = ctor.prototype.send;

  ctor.prototype.open = function open(
    this: PatchedXhr,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    try {
      this.__syncline = contextFor(String(url), method, options);
    } catch {
      this.__syncline = null;
    }
    // eslint-disable-next-line prefer-rest-params
    return originalOpen.apply(this, [method, url, ...rest] as never);
  } as typeof ctor.prototype.open;

  ctor.prototype.send = function send(this: PatchedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    const started = this.__syncline;

    if (started) {
      safely(() => {
        this.setRequestHeader(
          TRACEPARENT_HEADER,
          formatTraceparent({ traceId: started.traceId, spanId: started.spanId, sampled: true })
        );
        hooks.onStart(started);

        // `loadend` fires for success, error, timeout and abort alike, so one listener closes the
        // span in every case a request can actually finish.
        this.addEventListener('loadend', () => {
          safely(() =>
            hooks.onEnd({
              spanId: started.spanId,
              endMs: Date.now(),
              // status is 0 for network errors and aborts; reporting that as a status code would
              // be a lie, so it becomes an error instead.
              ...(this.status > 0 ? { status: this.status } : { error: 'request failed' }),
            })
          );
        });
      });
    }

    return originalSend.call(this, body ?? null);
  } as typeof ctor.prototype.send;

  return () => {
    ctor.prototype.open = originalOpen;
    ctor.prototype.send = originalSend;
  };
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Swallowed on purpose. Nothing this SDK does is worth an exception in someone else's page.
  }
}
