/**
 * Wires rrweb, the trace patches, the buffer and the transport into one recording session.
 *
 * The whole of this file is written on the assumption that it is a guest in someone else's page.
 * Every entry point is wrapped; a failure disables recording rather than propagating.
 */

import { record } from 'rrweb';
import {
  MAX_CHUNKS_PER_SESSION,
  PAGEVIEW,
  REQUEST_END,
  REQUEST_START,
  type PageviewTrigger,
  type RequestEndPayload,
  type RequestStartPayload,
  type SessionChunk,
} from '@syncline/protocol';
import { resolveOptions, type SynclineOptions } from './config.js';
import { EventBuffer, FLUSH_EVERY_MS, PendingRequests } from './buffer.js';
import { measureClock } from './clock.js';
import { installNavigationWatch } from './navigation.js';
import { PageviewTracker } from './pageviews.js';
import {
  clearSession,
  hasOutlivedCeiling,
  resolveSession,
  touch,
} from './session.js';
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

  let session = resolveSession(safeSessionStorage());
  const buffer = new EventBuffer();
  const pending = new PendingRequests();
  const pageviews = new PageviewTracker();

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

  const uninstallFetch = installFetchPatch(
    window,
    { traceOrigins: resolved.traceOrigins, pageOrigin },
    {
      onStart(payload: RequestStartPayload) {
        pending.start(payload);
        addCustomEvent(REQUEST_START, payload);
      },
      onEnd(payload: RequestEndPayload) {
        addCustomEvent(REQUEST_END, payload);
        const link = pending.finish(
          payload.spanId,
          payload.endMs,
          payload.status,
        );
        if (link) buffer.addLink(link);
      },
    },
  );

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
            const link = pending.finish(
              payload.spanId,
              payload.endMs,
              payload.status,
            );
            if (link) buffer.addLink(link);
          },
        },
      )
    : () => undefined;

  /**
   * A route change closes one page and opens the next.
   *
   * Order matters. The old page's events flush first, so a chunk never straddles two pages and the
   * viewer can load one page of a long session without fetching the rest. Only then does the new
   * page's marker go in, followed by a full DOM snapshot — which makes the new chunk a self-contained
   * keyframe the player can jump straight to.
   */
  const uninstallNavigation = installNavigationWatch(window, (change) => {
    void enterPage(change.url, change.trigger);
  });

  async function enterPage(url: string, trigger: PageviewTrigger) {
    if (stopped) return;

    if (trigger !== 'load') await flush();

    const now = Date.now();
    const pageview = pageviews.enter(url, trigger, now);
    buffer.addPageview(pageview);
    addCustomEvent(PAGEVIEW, pageview);
    log(`pageview ${pageview.ordinal}: ${pageview.url} (${trigger})`);

    if (trigger !== 'load' && pageviews.shouldSnapshot(now)) {
      try {
        record.takeFullSnapshot(true);
      } catch {
        // rrweb refuses before it has recorded its first snapshot, which is exactly when one is
        // already on its way. Nothing to recover from.
      }
    }
  }

  // The first page of the flow. `load` skips the flush and the snapshot: there is nothing buffered
  // yet, and rrweb's own initial snapshot is moments away.
  void enterPage(window.location.href, 'load');

  const interval = setInterval(() => {
    void tick();
  }, FLUSH_EVERY_MS);

  /**
   * Flushes, and rotates the session once it has outlived its ceiling.
   *
   * Rotation rather than truncation: the recording continues under a new id, so a dashboard left
   * open all day becomes a series of loadable hour-long recordings instead of one that nothing can
   * open. Checked here rather than per event — crossing the hour mark is not urgent to the
   * millisecond, and a clock read in the emit path would be the hottest line in the SDK.
   */
  async function tick(): Promise<void> {
    if (stopped) return;

    if (hasOutlivedCeiling(session, Date.now())) {
      await rotate();
      return;
    }

    await flush();
  }

  async function rotate(): Promise<void> {
    await flush();

    const storage = safeSessionStorage();
    clearSession(storage);
    session = resolveSession(storage);
    seq = 0;
    pageviews.reset();
    log(`session rotated to ${session.id}`);

    // A new flow starts at its first page, and seq 0 carries the metadata again — so the new
    // recording is complete on its own rather than depending on the one before it.
    await enterPage(window.location.href, 'load');
    try {
      record.takeFullSnapshot(true);
      pageviews.noteSnapshot(Date.now());
    } catch {
      /* see enterPage */
    }
  }

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

  async function flush(
    sendOptions: { keepalive?: boolean } = {},
  ): Promise<void> {
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
        pageviews: drained.pageviews,
        // The page these events belong to. Every flush happens either at a boundary or inside one
        // page, so this is unambiguous for the whole chunk.
        pageviewOrdinal: pageviews.current,
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

      const ok = await sendChunk(
        transport,
        session.id,
        current,
        payload,
        sendOptions,
      );
      log(
        `chunk ${current}: ${drained.events.length} events, ${ok ? 'sent' : 'dropped'}`,
      );
      touch(safeSessionStorage(), session.id, Date.now(), session.startedMs);
    });

    return flushing;
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;

    clearInterval(interval);
    window.removeEventListener('pagehide', onPageHide);
    uninstallNavigation();
    uninstallFetch();
    uninstallXhr();
    stopRrweb?.();
    await flush();
  }

  // A getter, not a value: a session that rotates past its ceiling gets a new id, and a host that
  // reads this later should see the recording it is actually part of.
  return {
    get sessionId() {
      return session.id;
    },
    flush: () => flush(),
    stop,
  };
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
