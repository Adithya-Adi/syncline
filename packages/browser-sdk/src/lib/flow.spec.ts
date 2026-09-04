import { describe, expect, it } from 'vitest';
import {
  installNavigationWatch,
  type NavigationChange,
  type NavigationTarget,
} from './navigation.js';
import { PageviewTracker } from './pageviews.js';
import {
  hasOutlivedCeiling,
  needsRotation,
  resolveSession,
  MAX_DURATION_MS,
  IDLE_TIMEOUT_MS,
} from './session.js';
import {
  CHUNKS_BEFORE_ROTATION,
  MAX_CHUNKS_PER_SESSION,
} from '@syncline/protocol';

const ORIGIN = 'https://app.acme.com';

/**
 * A window-shaped object, because the real one is not available under a node test environment and
 * because the interesting cases — a router replacing the URL it is already on, a host that wrapped
 * `pushState` first — are easier to construct than to provoke in a browser.
 */
function fakeWindow(href = `${ORIGIN}/`) {
  const listeners = new Map<string, Set<() => void>>();
  const location = { href };

  const target = {
    history: {
      pushState(_state: unknown, _title: string, url?: string | URL | null) {
        if (url != null)
          location.href = new URL(String(url), location.href).href;
      },
      replaceState(_state: unknown, _title: string, url?: string | URL | null) {
        if (url != null)
          location.href = new URL(String(url), location.href).href;
      },
    },
    location,
    addEventListener: ((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    }) as unknown as Window['addEventListener'],
    removeEventListener: ((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }) as unknown as Window['removeEventListener'],
  } satisfies NavigationTarget;

  return {
    target,
    location,
    listeners,
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

describe('navigation watch', () => {
  it('reports a pushState route change with its new URL', () => {
    const win = fakeWindow();
    const seen: NavigationChange[] = [];
    installNavigationWatch(win.target, (change) => seen.push(change));

    win.target.history.pushState({}, '', '/cart');

    expect(seen).toEqual([{ trigger: 'pushState', url: `${ORIGIN}/cart` }]);
  });

  it('ignores a navigation that did not move', () => {
    const win = fakeWindow(`${ORIGIN}/cart`);
    const seen: NavigationChange[] = [];
    installNavigationWatch(win.target, (change) => seen.push(change));

    // What a router does when it normalizes the URL it is already showing. A flow full of these
    // is harder to read than no flow at all.
    win.target.history.replaceState({}, '', '/cart');

    expect(seen).toEqual([]);
  });

  it('reports the back button and hash changes', () => {
    const win = fakeWindow();
    const seen: NavigationChange[] = [];
    installNavigationWatch(win.target, (change) => seen.push(change));

    win.location.href = `${ORIGIN}/previous`;
    win.fire('popstate');
    win.location.href = `${ORIGIN}/previous#details`;
    win.fire('hashchange');

    expect(seen.map((change) => change.trigger)).toEqual([
      'popstate',
      'hashchange',
    ]);
  });

  it('restores the original history methods and listeners on uninstall', () => {
    const win = fakeWindow();
    const originalPush = win.target.history.pushState;
    const seen: NavigationChange[] = [];

    const uninstall = installNavigationWatch(win.target, (change) =>
      seen.push(change),
    );
    expect(win.target.history.pushState).not.toBe(originalPush);

    uninstall();

    expect(win.target.history.pushState).toBe(originalPush);
    expect(win.listeners.get('popstate')?.size ?? 0).toBe(0);

    win.target.history.pushState({}, '', '/after-uninstall');
    expect(seen).toEqual([]);
  });

  it('keeps the navigation working when the callback throws', () => {
    const win = fakeWindow();
    installNavigationWatch(win.target, () => {
      throw new Error('instrumentation is broken');
    });

    expect(() => win.target.history.pushState({}, '', '/cart')).not.toThrow();
    expect(win.location.href).toBe(`${ORIGIN}/cart`);
  });
});

describe('pageview tracker', () => {
  it('numbers pages in flow order, starting at zero', () => {
    const tracker = new PageviewTracker();

    expect(tracker.enter(`${ORIGIN}/`, 'load', 1000).ordinal).toBe(0);
    expect(tracker.enter(`${ORIGIN}/cart`, 'pushState', 2000).ordinal).toBe(1);
    expect(tracker.enter(`${ORIGIN}/pay`, 'pushState', 3000).ordinal).toBe(2);
    expect(tracker.current).toBe(2);
  });

  it('strips query values from the recorded URL', () => {
    const tracker = new PageviewTracker();

    const pageview = tracker.enter(
      `${ORIGIN}/search?q=secret&page=2`,
      'pushState',
      1000,
    );

    expect(pageview.url).not.toContain('secret');
    // Keys are kept, values are not: enough to see the shape of the page, not what was searched.
    expect(pageview.url).toBe(`${ORIGIN}/search?q&page`);
  });

  it('keeps a hash route, because that is the whole path in a hash router', () => {
    const tracker = new PageviewTracker();

    expect(tracker.enter(`${ORIGIN}/#/cart`, 'hashchange', 1000).url).toBe(
      `${ORIGIN}/#/cart`,
    );
  });

  it('drops a fragment that looks like credentials rather than a route', () => {
    const tracker = new PageviewTracker();

    const pageview = tracker.enter(
      `${ORIGIN}/callback#access_token=abc123&token_type=bearer`,
      'load',
      1000,
    );

    expect(pageview.url).toBe(`${ORIGIN}/callback`);
  });

  it('restarts the count after a rotation, because that is a new flow', () => {
    const tracker = new PageviewTracker();
    tracker.enter(`${ORIGIN}/`, 'load', 1000);
    tracker.enter(`${ORIGIN}/cart`, 'pushState', 2000);

    tracker.reset();

    expect(tracker.enter(`${ORIGIN}/`, 'load', 3000).ordinal).toBe(0);
  });

  it('rate-limits full snapshots so a redirect chain pays for one, not three', () => {
    const tracker = new PageviewTracker(30_000);

    expect(tracker.shouldSnapshot(100_000)).toBe(true);
    expect(tracker.shouldSnapshot(101_000)).toBe(false);
    expect(tracker.shouldSnapshot(129_000)).toBe(false);
    expect(tracker.shouldSnapshot(131_000)).toBe(true);
  });

  it('reuses a snapshot rrweb already took for its own reasons', () => {
    const tracker = new PageviewTracker(30_000);

    tracker.noteSnapshot(100_000);

    expect(tracker.shouldSnapshot(110_000)).toBe(false);
  });
});

describe('session lifetime', () => {
  function memoryStorage(initial?: string) {
    const store = new Map<string, string>();
    if (initial) store.set('syncline.session', initial);
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      raw: store,
    };
  }

  it('keeps a session that is active and inside the ceiling', () => {
    const now = 10_000_000;
    const storage = memoryStorage(
      JSON.stringify({
        id: '01H0000000000000000000000A',
        lastSeenMs: now - 60_000,
        startedMs: now - 10 * 60_000,
      }),
    );

    const session = resolveSession(storage, now);

    expect(session.isNew).toBe(false);
    expect(session.id).toBe('01H0000000000000000000000A');
  });

  it('resumes chunk numbering across a page load', () => {
    // The bug this pins: the session id survives a navigation but the recorder's counter is
    // closure state, so the new page restarted at zero and uploaded over the previous page's
    // chunks. The storage key is (session, seq), so the objects were replaced — and ingest
    // deduplicates its queue job by the same pair, so the rows describing the originals were never
    // corrected. The recording became the second page's footage on the first page's timeline.
    const now = 10_000_000;
    const storage = memoryStorage(
      JSON.stringify({
        id: '01H0000000000000000000000A',
        lastSeenMs: now - 1_000,
        startedMs: now - 30_000,
        seq: 7,
      }),
    );

    expect(resolveSession(storage, now).nextSeq).toBe(7);
  });

  it('starts numbering at zero for a session written by an older SDK', () => {
    // No `seq` in storage. Resuming at zero is what those sessions already did, so an upgrade
    // makes nothing worse than it was.
    const now = 10_000_000;
    const storage = memoryStorage(
      JSON.stringify({
        id: '01H0000000000000000000000A',
        lastSeenMs: now - 1_000,
        startedMs: now - 30_000,
      }),
    );

    expect(resolveSession(storage, now).nextSeq).toBe(0);
  });

  it('numbers a brand-new session from zero', () => {
    expect(resolveSession(memoryStorage(), 10_000_000).nextSeq).toBe(0);
  });

  it('starts a new session after the idle timeout', () => {
    const now = 10_000_000;
    const storage = memoryStorage(
      JSON.stringify({
        id: '01H0000000000000000000000A',
        lastSeenMs: now - IDLE_TIMEOUT_MS - 1,
        startedMs: now - IDLE_TIMEOUT_MS - 1,
      }),
    );

    expect(resolveSession(storage, now).isNew).toBe(true);
  });

  it('starts a new session once the ceiling is reached, however busy the tab is', () => {
    const now = 10_000_000;
    const storage = memoryStorage(
      JSON.stringify({
        id: '01H0000000000000000000000A',
        // Touched a second ago: nothing about this session is idle. It is simply too long.
        lastSeenMs: now - 1_000,
        startedMs: now - MAX_DURATION_MS - 1,
      }),
    );

    const session = resolveSession(storage, now);

    expect(session.isNew).toBe(true);
    expect(session.id).not.toBe('01H0000000000000000000000A');
    expect(session.startedMs).toBe(now);
  });

  it('treats a session written by an older SDK as having just started', () => {
    const now = 10_000_000;
    const storage = memoryStorage(
      JSON.stringify({ id: '01H0000000000000000000000A', lastSeenMs: now - 1 }),
    );

    // No startedMs. Rotating every live session on deploy would be the worse reading.
    expect(resolveSession(storage, now).isNew).toBe(false);
  });

  it('reports the ceiling for a live session', () => {
    expect(hasOutlivedCeiling({ startedMs: 0 }, MAX_DURATION_MS - 1)).toBe(
      false,
    );
    expect(hasOutlivedCeiling({ startedMs: 0 }, MAX_DURATION_MS)).toBe(true);
  });
});

describe('rotation', () => {
  it('rotates on time, however few chunks were used', () => {
    expect(
      needsRotation({ startedMs: 0, chunkCount: 3 }, MAX_DURATION_MS),
    ).toBe(true);
  });

  it('rotates on the chunk budget, however recently it started', () => {
    // The case the old code got wrong: a busy page exhausts the budget in minutes, and the
    // one-hour ceiling would not have saved it for another fifty.
    expect(
      needsRotation(
        { startedMs: 0, chunkCount: CHUNKS_BEFORE_ROTATION },
        60_000,
      ),
    ).toBe(true);
  });

  it('leaves an ordinary session alone', () => {
    expect(needsRotation({ startedMs: 0, chunkCount: 12 }, 120_000)).toBe(
      false,
    );
  });

  it('rotates with sequence numbers left for the closing flush', () => {
    // Rotation flushes the tail of the outgoing session, and that chunk needs a sequence number
    // ingest still accepts. Without headroom, the last seconds before every rotation are lost.
    expect(CHUNKS_BEFORE_ROTATION).toBeLessThan(MAX_CHUNKS_PER_SESSION);
  });
});
