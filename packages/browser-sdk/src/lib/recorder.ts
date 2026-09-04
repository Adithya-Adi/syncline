/**
 * Wires rrweb, the trace patches, the buffer and the transport into one recording session.
 *
 * The whole of this file is written on the assumption that it is a guest in someone else's page.
 * Every entry point is wrapped; a failure disables recording rather than propagating.
 */

import { record } from 'rrweb';
import {
  CONSOLE,
  CONTEXT,
  ERROR,
  IDENTITY_KEY,
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
import {
  SessionContext,
  type ContextChange,
  type ContextInput,
} from './context.js';
import { EventBuffer, FLUSH_EVERY_MS, PendingRequests } from './buffer.js';
import { measureClock } from './clock.js';
import { installConsoleCapture, installErrorCapture } from './diagnostics.js';
import { installNavigationWatch } from './navigation.js';
import { PageviewTracker } from './pageviews.js';
import {
  clearSession,
  needsRotation,
  resolveSession,
  touch,
} from './session.js';
import { installFetchPatch, installXhrPatch } from './trace.js';
import { sendChunk, type TransportOptions } from './transport.js';
import { sanitizeUrl } from './url.js';

const SDK_NAME = 'syncline-browser';
const SDK_VERSION = '0.1.3';

export interface Recording {
  sessionId: string;
  /**
   * Says who this recording belongs to.
   *
   * Callable at any point, and normally called late — a recording starts at page load and identity
   * arrives after sign-in. The whole session becomes findable by it, not just the part after the
   * call: the server applies the latest identity to the recording, so the ten anonymous seconds
   * before someone logged in are still theirs.
   */
  identify(userId: string): void;
  /**
   * Attaches anything else the session should be findable by — an account, a tenant, a plan.
   *
   * `null` unsets a key. `undefined` is ignored rather than treated as an unset, so a missing
   * field in an object spread does not silently delete what is already there.
   */
  setContext(context: ContextInput): void;
  /** Forgets the identity and every context key. What logging out has to do to a recording. */
  clearIdentity(): void;
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
  const context = new SessionContext();

  let clock = { offsetMs: 0, rttMs: 0 };
  let seq = session.nextSeq;
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
    /**
     * Leaves out what a replay cannot use.
     *
     * Script contents are the reason this is set. Nothing executes during replay — the player
     * paints a DOM — so every inlined script is bytes carried to be ignored, and modern frameworks
     * inline a lot of them: an App Router page ships its RSC payload inside `<script>` tags, which
     * is re-sent in full with every snapshot. The rest of what this drops is comments, favicons,
     * head whitespace, and the social and robots meta tags, none of which are rendered.
     *
     * `true` rather than `'all'`: `'all'` additionally drops the description, keywords and
     * authorship meta tags and stops tracking title changes. Those are hidden but real page
     * content, and a recording is meant to be evidence of what was there.
     */
    slimDOMOptions: true,
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
   * Errors and console output, when the host asked for them.
   *
   * Both write two things: a marker into the replay stream, so the entry sits at the frame it
   * happened, and a denormalized copy on the chunk, so the worker can count them without walking
   * the events. The marker is skipped when the buffer refused the copy — past the per-chunk
   * ceiling, a page in an error loop would otherwise fill the stream with entries no table has.
   */
  const uninstallErrors = resolved.captureErrors
    ? installErrorCapture(
        window,
        {
          onError(payload) {
            if (!buffer.addError(payload)) return;
            addCustomEvent(ERROR, payload);
            log(`${payload.source}: ${payload.message}`);
          },
        },
        pageOrigin,
      )
    : () => undefined;

  const uninstallConsole =
    resolved.captureConsole.length > 0
      ? installConsoleCapture(
          window.console as unknown as Record<string, unknown>,
          resolved.captureConsole,
          {
            onConsole(payload) {
              if (!buffer.addLog(payload)) return;
              addCustomEvent(CONSOLE, payload);
            },
          },
        )
      : () => undefined;

  /**
   * Applies a context change: a marker in the replay, and a copy on the chunk.
   *
   * The marker is what puts "they signed in here" at a frame you can scrub to; the copy is what
   * the worker reads without decompressing the stream. Nothing is emitted when the change is
   * empty, which is the common case for an application that calls `setContext` on every render
   * with values that have not moved.
   */
  function applyContext(change: ContextChange): void {
    for (const refusal of change.refused) {
      log(`context key "${refusal.key}" refused: ${refusal.reason}`);
    }

    if (change.entries.length === 0) return;

    const timeMs = Date.now();
    const entries = change.entries.filter((entry) =>
      buffer.addContext({ ...entry, timeMs }),
    );

    if (entries.length === 0) return;
    addCustomEvent(CONTEXT, { entries, timeMs });
    log(`context: ${entries.map((entry) => entry.key).join(', ')}`);
  }

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

    if (trigger !== 'load') await flush({ rotate: false });

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
   * Flushes, and rotates the session when it has run too long or used too many chunks.
   *
   * Rotation rather than truncation: the recording continues under a new id, so a dashboard left
   * open all day becomes a series of loadable recordings instead of one that nothing can open.
   * Checked here rather than per event — crossing either limit is not urgent to the millisecond,
   * and a clock read in the emit path would be the hottest line in the SDK.
   */
  async function tick(): Promise<void> {
    if (stopped) return;

    if (needsRotation({ startedMs: session.startedMs, chunkCount: seq })) {
      await rotate();
      return;
    }

    await flush({ rotate: false });
  }

  /**
   * Set synchronously, before `rotate` reaches its first await.
   *
   * `rotate` begins by flushing the tail of the old session, and that flush must not look at the
   * limits and decide to rotate again — which would be a rotation waiting on a flush waiting on
   * that same rotation. A promise guard cannot express this: `rotating ??= rotate()` assigns only
   * once `rotate` has already suspended.
   */
  let rotating = false;

  async function rotate(): Promise<void> {
    if (rotating) return;
    rotating = true;

    try {
      // The tail of the outgoing session. This is why rotation happens at CHUNKS_BEFORE_ROTATION
      // rather than at the hard cap: this flush needs a sequence number ingest still accepts.
      await flush({ rotate: false });

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
    } finally {
      rotating = false;
    }
  }

  // `pagehide` rather than `unload`: it is the only one that fires reliably on mobile Safari, and
  // it also fires when a page enters the back/forward cache.
  const onPageHide = () => void flush({ keepalive: true, rotate: false });
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
    options: { keepalive?: boolean; rotate?: boolean } = {},
  ): Promise<void> {
    const { keepalive, rotate: mayRotate = true } = options;

    if (buffer.isEmpty) return;

    /**
     * The chunk budget is a reason to rotate, not a reason to stop.
     *
     * This path is what a busy page hits: the buffer fills on size long before the next tick, and
     * without this the flush would simply return and the recording would go on filming into a
     * buffer nothing ever uploads. Not awaited — the caller is usually rrweb's emit, and blocking
     * it on a network round trip would be worse than a rotation landing a moment later.
     */
    if (
      mayRotate &&
      !stopped &&
      !rotating &&
      needsRotation({ startedMs: session.startedMs, chunkCount: seq })
    ) {
      void rotate();
      return;
    }

    // The hard bound. Unreachable while rotation works, and kept because "silently stops uploading"
    // is a bad enough failure to deserve a second guard.
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
        errors: drained.errors,
        logs: drained.logs,
        context: drained.context,
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

      const ok = await sendChunk(transport, session.id, current, payload, {
        ...(keepalive ? { keepalive } : {}),
      });
      log(
        `chunk ${current}: ${drained.events.length} events, ${ok ? 'sent' : 'dropped'}`,
      );
      touch(
        safeSessionStorage(),
        session.id,
        Date.now(),
        session.startedMs,
        // The next number, so a page load mid-session resumes instead of overwriting.
        seq,
      );
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
    uninstallErrors();
    uninstallConsole();
    stopRrweb?.();
    await flush({ rotate: false });
  }

  // A getter, not a value: a session that rotates past its ceiling gets a new id, and a host that
  // reads this later should see the recording it is actually part of.
  return {
    get sessionId() {
      return session.id;
    },
    // Identity goes through the same path as any other context, under a reserved key. One ordering
    // rule, one way to clear it, one route into the index — rather than a second mechanism that
    // has to be kept in step with the first.
    identify: (userId: string) =>
      applyContext(context.apply({ [IDENTITY_KEY]: userId })),
    setContext: (values: ContextInput) => applyContext(context.apply(values)),
    clearIdentity: () => applyContext(context.clear()),
    flush: () => flush({ rotate: false }),
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
