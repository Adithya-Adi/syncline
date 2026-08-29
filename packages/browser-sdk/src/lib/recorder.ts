/**
 * Wires rrweb, the trace patches, the buffer and the transport into one recording session.
 *
 * The whole of this file is written on the assumption that it is a guest in someone else's page.
 * Every entry point is wrapped; a failure disables recording rather than propagating.
 */

import { record } from 'rrweb';
import {
  MAX_CHUNKS_PER_SESSION,
  REQUEST_END,
  REQUEST_START,
  type RequestEndPayload,
  type RequestStartPayload,
  type SessionChunk,
} from '@syncline/protocol';
import { resolveOptions, type SynclineOptions } from './config.js';
import { EventBuffer, FLUSH_EVERY_MS, PendingRequests } from './buffer.js';
import { measureClock } from './clock.js';
import { resolveSession, touch } from './session.js';
import { installFetchPatch, installXhrPatch } from './trace.js';
import { sendChunk, type TransportOptions } from './transport.js';
import { sanitizeUrl } from './url.js';

const SDK_NAME = 'syncline-browser';
const SDK_VERSION = '0.1.0';

export interface Recording {
  sessionId: string;
  /** Sends whatever is buffered. Exposed mainly so tests and hosts can force a flush. */
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export function startRecording(options: SynclineOptions): Recording {
  const pageOrigin = window.location.origin;
  const resolved = resolveOptions(options, pageOrigin);

  const log = (message: string) => {
    if (resolved.debug) console.info(`[syncline] ${message}`);
  };

  // Captured before patching, so uploads never carry a traceparent and never appear in their own
  // recording. Without this the SDK would trace itself, once per chunk, forever.
  const rawFetch = window.fetch.bind(window);

  const transport: TransportOptions = {
    endpoint: resolved.endpoint,
    key: resolved.key,
    fetchImpl: rawFetch,
  };

  const session = resolveSession(safeSessionStorage());
  const buffer = new EventBuffer();
  const pending = new PendingRequests();

  let clock = { offsetMs: 0, rttMs: 0 };
  let seq = 0;
  let stopped = false;
  let flushing: Promise<void> = Promise.resolve();

  const stopRrweb = record({
    emit(event) {
      buffer.addEvent(event, approximateSize(event));
      if (buffer.shouldFlush()) void flush();
    },
    maskAllInputs: resolved.maskAllInputs,
    // Anything inside `.syncline-block` is never recorded; `.syncline-mask` keeps the structure
    // but replaces the text. These are the escape hatches a host page needs for a card form.
    blockClass: 'syncline-block',
    maskTextClass: 'syncline-mask',
  });

  const uninstallFetch = installFetchPatch(window, { traceOrigins: resolved.traceOrigins, pageOrigin }, {
    onStart(payload: RequestStartPayload) {
      pending.start(payload);
      addCustomEvent(REQUEST_START, payload);
    },
    onEnd(payload: RequestEndPayload) {
      addCustomEvent(REQUEST_END, payload);
      const link = pending.finish(payload.spanId, payload.endMs, payload.status);
      if (link) buffer.addLink(link);
    },
  });

  // Reached through the window object rather than as a bare global, and skipped when absent: some
  // webviews and worker-ish contexts have no XMLHttpRequest, and referencing it directly would
  // throw during setup — taking the host page down with it.
  const uninstallXhr = window.XMLHttpRequest
    ? installXhrPatch(
        window.XMLHttpRequest,
        { traceOrigins: resolved.traceOrigins, pageOrigin },
        {
          onStart(payload) {
            pending.start(payload);
            addCustomEvent(REQUEST_START, payload);
          },
          onEnd(payload) {
            addCustomEvent(REQUEST_END, payload);
            const link = pending.finish(payload.spanId, payload.endMs, payload.status);
            if (link) buffer.addLink(link);
          },
        }
      )
    : () => undefined;

  const interval = setInterval(() => void flush(), FLUSH_EVERY_MS);

  // `pagehide` rather than `unload`: it is the only one that fires reliably on mobile Safari, and
  // it also fires when a page enters the back/forward cache.
  const onPageHide = () => void flush({ keepalive: true });
  window.addEventListener('pagehide', onPageHide);

  void measureClock(resolved.endpoint, rawFetch)
    .then((measured) => {
      clock = measured;
      log(`clock offset ${measured.offsetMs}ms, rtt ${measured.rttMs}ms`);
    })
    .catch(() => undefined);

  function addCustomEvent(tag: string, payload: unknown): void {
    try {
      record.addCustomEvent(tag, payload);
    } catch {
      // rrweb not recording yet, or already stopped.
    }
  }

  async function flush(sendOptions: { keepalive?: boolean } = {}): Promise<void> {
    if (buffer.isEmpty) return;
    if (seq > MAX_CHUNKS_PER_SESSION) return;

    // Serialize flushes. Two in flight would race on `seq` and could file two different chunks
    // under the same sequence number, silently losing one of them.
    flushing = flushing.then(async () => {
      if (buffer.isEmpty) return;

      const drained = buffer.drain();
      const current = seq++;

      const payload: SessionChunk = {
        sessionId: session.id,
        seq: current,
        sdk: { name: SDK_NAME, version: SDK_VERSION },
        clock,
        events: drained.events,
        links: drained.links,
        ...(current === 0
          ? {
              meta: {
                url: sanitizeUrl(window.location.href),
                userAgent: navigator.userAgent,
                viewport: { w: window.innerWidth, h: window.innerHeight },
                ...(resolved.release ? { release: resolved.release } : {}),
                ...(resolved.user ? { user: resolved.user } : {}),
              },
            }
          : {}),
      };

      const ok = await sendChunk(transport, session.id, current, payload, sendOptions);
      log(`chunk ${current}: ${drained.events.length} events, ${ok ? 'sent' : 'dropped'}`);
      touch(safeSessionStorage(), session.id);
    });

    return flushing;
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;

    clearInterval(interval);
    window.removeEventListener('pagehide', onPageHide);
    uninstallFetch();
    uninstallXhr();
    stopRrweb?.();
    await flush();
  }

  return { sessionId: session.id, flush: () => flush(), stop };
}

function safeSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    // Throws outright in some privacy modes rather than returning null.
    return undefined;
  }
}

/**
 * A cheap size estimate, used only to decide when to flush.
 *
 * Serializing every event to measure it exactly would double the SDK's work on a busy page for no
 * benefit — being wrong here just means flushing slightly early or late.
 */
function approximateSize(event: unknown): number {
  try {
    return JSON.stringify(event).length;
  } catch {
    return 256;
  }
}
