import { IngestLimitsService } from './ingest-limits.service.js';
import type { AppConfig } from '../config/config.js';

/**
 * What one project may send.
 *
 * These are the only bounds on *how many* requests arrive, so what matters here is the refusals:
 * that a flood is stopped, that a rejected request does not permanently consume the quota it was
 * refused for, and that a Redis outage does not turn into a total ingest outage.
 *
 * The Redis client is faked rather than mocked out entirely — the counter arithmetic is the thing
 * under test, and a fake that just returns fixed numbers would test nothing.
 */

/** A stand-in for the Lua counter: same semantics, in a Map. */
function fakeRedis(over: { fail?: boolean } = {}) {
  const values = new Map<string, number>();
  const ttls = new Map<string, number>();

  return {
    values,
    defineCommand: jest.fn(),
    disconnect: jest.fn(),
    decrby: jest.fn(async (key: string, amount: number) => {
      values.set(key, (values.get(key) ?? 0) - amount);
      return values.get(key) ?? 0;
    }),
    bumpLimit: jest.fn(async (key: string, amount: string, ttl: string) => {
      if (over.fail) throw new Error('redis is down');
      const next = (values.get(key) ?? 0) + Number(amount);
      values.set(key, next);
      if (!ttls.has(key)) ttls.set(key, Number(ttl));
      return [next, ttls.get(key) ?? 0];
    }),
  };
}

function service(
  config: Partial<AppConfig>,
  redis: ReturnType<typeof fakeRedis>,
) {
  const built = new IngestLimitsService({
    REDIS_URL: 'redis://localhost:6399',
    INGEST_REQUESTS_PER_MINUTE: 3,
    INGEST_BYTES_PER_DAY: 1_000,
    ...config,
  } as AppConfig);

  // The constructor opens a real connection; swap it for the fake before anything is counted.
  (built as unknown as { redis: unknown }).redis = redis;
  return built;
}

describe('rate limit', () => {
  it('allows requests up to the ceiling and refuses the one past it', async () => {
    const redis = fakeRedis();
    const limits = service({}, redis);

    for (let i = 0; i < 3; i += 1) {
      expect((await limits.takeRequest('proj_1')).ok).toBe(true);
    }

    const refused = await limits.takeRequest('proj_1');
    expect(refused).toMatchObject({ ok: false, limit: 'rate', allowed: 3 });
    expect(refused.resetsInSeconds).toBeGreaterThan(0);
  });

  it('counts each project separately', async () => {
    // Otherwise one noisy customer takes every other customer down with them.
    const redis = fakeRedis();
    const limits = service({}, redis);

    for (let i = 0; i < 3; i += 1) await limits.takeRequest('proj_1');

    expect((await limits.takeRequest('proj_2')).ok).toBe(true);
  });

  it('is disabled by zero, which is what a private install wants', async () => {
    const redis = fakeRedis();
    const limits = service({ INGEST_REQUESTS_PER_MINUTE: 0 }, redis);

    for (let i = 0; i < 50; i += 1) {
      expect((await limits.takeRequest('proj_1')).ok).toBe(true);
    }
    expect(redis.bumpLimit).not.toHaveBeenCalled();
  });
});

describe('volume limit', () => {
  it('refuses once the day’s bytes are spent', async () => {
    const redis = fakeRedis();
    const limits = service({}, redis);

    expect((await limits.takeBytes('proj_1', 600)).ok).toBe(true);
    const refused = await limits.takeBytes('proj_1', 600);

    expect(refused).toMatchObject({
      ok: false,
      limit: 'volume',
      allowed: 1_000,
    });
  });

  it('gives the bytes back when it refuses them', async () => {
    // Otherwise a project that brushes the ceiling once has every later request counted against a
    // total it never stored, and the limit ratchets shut instead of capping.
    const redis = fakeRedis();
    const limits = service({}, redis);

    await limits.takeBytes('proj_1', 900);
    await limits.takeBytes('proj_1', 900); // refused

    const key = [...redis.values.keys()].find((k) => k.includes('bytes'));
    expect(redis.values.get(key as string)).toBe(900);

    // And there is still room for a request that fits.
    expect((await limits.takeBytes('proj_1', 50)).ok).toBe(true);
  });

  it('ignores an empty body rather than spending a counter on it', async () => {
    const redis = fakeRedis();
    const limits = service({}, redis);

    expect((await limits.takeBytes('proj_1', 0)).ok).toBe(true);
    expect(redis.bumpLimit).not.toHaveBeenCalled();
  });
});

describe('when Redis is unreachable', () => {
  it('allows the request rather than refusing it', async () => {
    // Failing closed would turn a Redis blip into a total ingest outage — and the very next thing
    // the ingest path does is enqueue to that same Redis, which will fail with a 500 anyway. One
    // clear error beats two, and a limiter outage must not look like abuse.
    const redis = fakeRedis({ fail: true });
    const limits = service({}, redis);

    expect((await limits.takeRequest('proj_1')).ok).toBe(true);
    expect((await limits.takeBytes('proj_1', 5_000)).ok).toBe(true);
  });
});
