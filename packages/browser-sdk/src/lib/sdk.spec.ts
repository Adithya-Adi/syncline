import { describe, expect, it, vi } from 'vitest';
import { resolveOptions, shouldTrace } from './config.js';
import { sanitizeUrl } from './url.js';
import { bestOf, calibrate, measureClock } from './clock.js';
import { resolveSession } from './session.js';
import { EventBuffer, PendingRequests } from './buffer.js';
import { encodeBody, chunkUrl } from './transport.js';

const ORIGIN = 'https://app.acme.com';

describe('options', () => {
  it('defaults the trace allowlist to the page origin', () => {
    expect(
      resolveOptions({ key: 'pk_x', endpoint: 'https://s.io' }, ORIGIN)
        .traceOrigins,
    ).toEqual([ORIGIN]);
  });

  it('masks inputs unless you opt out', () => {
    expect(
      resolveOptions({ key: 'pk_x', endpoint: 'https://s.io' }, ORIGIN)
        .maskAllInputs,
    ).toBe(true);
    expect(
      resolveOptions(
        { key: 'pk_x', endpoint: 'https://s.io', maskAllInputs: false },
        ORIGIN,
      ).maskAllInputs,
    ).toBe(false);
  });

  it('strips a trailing slash so URLs do not end up doubled', () => {
    expect(
      resolveOptions({ key: 'pk_x', endpoint: 'https://s.io/' }, ORIGIN)
        .endpoint,
    ).toBe('https://s.io');
  });

  it('fails loudly on missing configuration rather than recording nowhere', () => {
    expect(() =>
      resolveOptions({ key: '', endpoint: 'https://s.io' }, ORIGIN),
    ).toThrow(/key/);
    expect(() => resolveOptions({ key: 'pk_x', endpoint: '' }, ORIGIN)).toThrow(
      /endpoint/,
    );
  });
});

describe('shouldTrace', () => {
  const allow = [ORIGIN];

  it('allows the allowlisted origin and relative paths', () => {
    expect(shouldTrace(`${ORIGIN}/api`, allow, ORIGIN)).toBe(true);
    expect(shouldTrace('/api', allow, ORIGIN)).toBe(true);
  });

  it('refuses third parties', () => {
    expect(
      shouldTrace('https://analytics.example/collect', allow, ORIGIN),
    ).toBe(false);
  });

  it('refuses subdomains, since a widget can be parked on one', () => {
    expect(shouldTrace('https://cdn.acme.com/x', allow, ORIGIN)).toBe(false);
    expect(
      shouldTrace('https://evil-app.acme.com.attacker.net/x', allow, ORIGIN),
    ).toBe(false);
  });

  it('refuses non-http schemes', () => {
    expect(shouldTrace('data:text/plain,hi', allow, ORIGIN)).toBe(false);
    expect(shouldTrace('blob:https://app.acme.com/abc', allow, ORIGIN)).toBe(
      false,
    );
  });
});

describe('sanitizeUrl', () => {
  it('keeps query keys and drops their values', () => {
    expect(sanitizeUrl(`${ORIGIN}/search?token=secret&page=2`)).toBe(
      `${ORIGIN}/search?token&page`,
    );
  });

  it('drops the fragment, where implicit-flow tokens live', () => {
    expect(sanitizeUrl(`${ORIGIN}/cb#access_token=secret`)).toBe(
      `${ORIGIN}/cb`,
    );
  });

  it('resolves a relative URL against the page', () => {
    expect(sanitizeUrl('/api/checkout', ORIGIN)).toBe(`${ORIGIN}/api/checkout`);
  });

  it('refuses to guess at something it cannot parse', () => {
    expect(sanitizeUrl('::::')).toBe('(unparseable)');
  });
});

describe('clock calibration', () => {
  it('splits the round trip between the two legs', () => {
    // Server is 1000ms ahead; the round trip took 100ms.
    expect(calibrate({ t0: 1_000, serverMs: 2_050, t1: 1_100 })).toEqual({
      offsetMs: 1000,
      rttMs: 100,
    });
  });

  it('prefers the sample with the least jitter', () => {
    expect(
      bestOf([
        { offsetMs: 500, rttMs: 400 },
        { offsetMs: 1000, rttMs: 20 },
        { offsetMs: 900, rttMs: 90 },
      ]),
    ).toEqual({ offsetMs: 1000, rttMs: 20 });
  });

  it('falls back to no correction when every attempt fails', async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    // An uncalibrated session still replays; refusing to record over it would be worse.
    await expect(measureClock('https://s.io', failing, 2)).resolves.toEqual({
      offsetMs: 0,
      rttMs: 0,
    });
  });

  it('ignores a response that is not shaped like a clock reading', async () => {
    const nonsense = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ serverMs: 'soon' }),
    }) as unknown as typeof fetch;
    await expect(measureClock('https://s.io', nonsense, 1)).resolves.toEqual({
      offsetMs: 0,
      rttMs: 0,
    });
  });
});

describe('session identity', () => {
  function memoryStorage(initial?: string) {
    const store = new Map<string, string>();
    if (initial) store.set('syncline.session', initial);
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  }

  it('reuses the id across a navigation within the tab', () => {
    const now = 1_700_000_000_000;
    const storage = memoryStorage(
      JSON.stringify({
        id: '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD',
        lastSeenMs: now - 60_000,
      }),
    );

    const session = resolveSession(storage, now);
    expect(session).toMatchObject({
      id: '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD',
      isNew: false,
    });
  });

  it('starts fresh after the idle timeout, rather than recording an overnight gap', () => {
    const now = 1_700_000_000_000;
    const storage = memoryStorage(
      JSON.stringify({
        id: '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD',
        lastSeenMs: now - 60 * 60 * 1000,
      }),
    );

    expect(resolveSession(storage, now).isNew).toBe(true);
  });

  it('still produces an id when storage is unavailable', () => {
    expect(resolveSession(undefined).isNew).toBe(true);
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };
    expect(resolveSession(hostile).id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('ignores corrupt stored state', () => {
    expect(resolveSession(memoryStorage('not json')).isNew).toBe(true);
  });
});

describe('buffering', () => {
  it('flushes once enough bytes have accumulated', () => {
    const buffer = new EventBuffer(100, 1000);
    expect(buffer.shouldFlush()).toBe(false);
    buffer.addEvent({}, 150);
    expect(buffer.shouldFlush()).toBe(true);
  });

  it('flushes on event count even when the events are tiny', () => {
    const buffer = new EventBuffer(1_000_000, 2);
    buffer.addEvent({}, 1);
    buffer.addEvent({}, 1);
    expect(buffer.shouldFlush()).toBe(true);
  });

  it('empties on drain so a chunk is never sent twice', () => {
    const buffer = new EventBuffer();
    buffer.addEvent({ a: 1 }, 10);
    expect(buffer.drain().events).toHaveLength(1);
    expect(buffer.isEmpty).toBe(true);
  });
});

describe('pending requests', () => {
  const started = {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: '00f067aa0ba902b7',
    method: 'POST',
    url: '/api/checkout',
    startMs: 1000,
  };

  it('produces a link only once the request has finished', () => {
    const pending = new PendingRequests();
    pending.start(started);
    expect(pending.outstanding).toBe(1);

    expect(pending.finish(started.spanId, 2000, 500)).toMatchObject({
      traceId: started.traceId,
      startMs: 1000,
      endMs: 2000,
      status: 500,
    });
    expect(pending.outstanding).toBe(0);
  });

  it('leaves an in-flight request for a later chunk instead of guessing its duration', () => {
    const pending = new PendingRequests();
    pending.start(started);
    // Nothing to hand the buffer yet, which is the point.
    expect(pending.outstanding).toBe(1);
  });

  it('ignores an end with no matching start', () => {
    expect(
      new PendingRequests().finish('deadbeefdeadbeef', 2000, 200),
    ).toBeNull();
  });

  it('omits status when the request never got one', () => {
    const pending = new PendingRequests();
    pending.start(started);
    expect(pending.finish(started.spanId, 2000)).not.toHaveProperty('status');
  });
});

describe('transport', () => {
  const chunk = {
    sessionId: '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD',
    seq: 0,
    sdk: { name: 'syncline-browser', version: '0.1.0' },
    clock: { offsetMs: 0, rttMs: 0 },
    events: [{ type: 3, timestamp: 1 }],
    links: [],
  };

  it('builds the ingest URL the API actually serves', () => {
    expect(chunkUrl('https://s.io', '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD', 3)).toBe(
      'https://s.io/v1/ingest/session/01JQ8Z3KX9TVFMWQ2Y7B4CN5HD/3',
    );
  });

  it('sends uncompressed when asked not to compress, for the final flush', async () => {
    const { gzipped, body } = await encodeBody(chunk, false);
    expect(gzipped).toBe(false);
    expect(typeof body).toBe('string');
  });
});
