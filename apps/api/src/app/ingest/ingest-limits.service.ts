import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import type { IngestLimit } from '@syncline/protocol';
import { CONFIG, type AppConfig } from '../config/config.js';

/**
 * What one project is allowed to send.
 *
 * Every other bound in the ingest path limits a single request — the body cap, the chunk ceiling,
 * the per-session sequence limit. None of them limits how many requests arrive, and that is the
 * gap this closes: the public key ships in a browser bundle by design, and the origin allowlist is
 * enforced by browsers rather than by us. Anyone who reads a bundle can post as that project from
 * `curl` for as long as they like.
 *
 * Two ceilings, because there are two failure shapes. A **rate** limit stops a flood happening
 * right now. A **volume** limit stops a slow drip filling the object store over a week, which is
 * the one that arrives as a bill rather than an outage.
 *
 * Counters live in Redis, which the ingest path already depends on to enqueue. That is deliberate:
 * a limiter with its own datastore is a new thing that can be down, and if Redis is down ingest is
 * failing anyway.
 */

export interface LimitVerdict {
  ok: boolean;
  limit?: IngestLimit;
  /** The ceiling that was hit — requests for `rate`, bytes for `volume`. */
  allowed?: number;
  /** Seconds until the window rolls over. */
  resetsInSeconds?: number;
}

const ALLOWED: LimitVerdict = { ok: true };

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Increment a counter and give it a lifetime in the same breath.
 *
 * `INCR` then `EXPIRE` is two round trips and, worse, two failure points: a process that dies
 * between them leaves a counter with no TTL, which never resets and locks a project out forever.
 * The script makes it one atomic operation, and only sets the TTL on the first increment so a
 * window cannot be extended indefinitely by traffic arriving inside it.
 */
const INCREMENT = `
  local total = redis.call('INCRBY', KEYS[1], ARGV[1])
  if total == tonumber(ARGV[1]) then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
  end
  local ttl = redis.call('TTL', KEYS[1])
  return { total, ttl }
`;

@Injectable()
export class IngestLimitsService implements OnModuleDestroy {
  private readonly logger = new Logger(IngestLimitsService.name);
  private readonly redis: IORedis;
  private readonly perMinute: number;
  private readonly bytesPerDay: number;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.perMinute = config.INGEST_REQUESTS_PER_MINUTE;
    this.bytesPerDay = config.INGEST_BYTES_PER_DAY;

    this.redis = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
    });

    this.redis.defineCommand('bumpLimit', {
      numberOfKeys: 1,
      lua: INCREMENT,
    });

    if (this.perMinute === 0 && this.bytesPerDay === 0) {
      // Worth saying out loud once at boot. An install with both disabled is a deliberate choice
      // on a private network, not something anybody should discover from a storage bill.
      this.logger.warn(
        'ingest limits are disabled; any holder of a public key can write without bound',
      );
    }
  }

  /**
   * Counts one request against the project's rate.
   *
   * Called before the body is read, because the cheapest rejection is the one that never reads
   * two megabytes off a socket.
   */
  async takeRequest(projectId: string): Promise<LimitVerdict> {
    if (this.perMinute === 0) return ALLOWED;

    const minute = Math.floor(Date.now() / 60_000);
    const [total, ttl] = await this.bump(
      `ingest:rate:${projectId}:${minute}`,
      1,
      MINUTE_SECONDS,
    );

    if (total === null) return ALLOWED;
    if (total <= this.perMinute) return ALLOWED;

    return {
      ok: false,
      limit: 'rate',
      allowed: this.perMinute,
      resetsInSeconds: ttl > 0 ? ttl : MINUTE_SECONDS,
    };
  }

  /**
   * Counts bytes against the project's daily volume.
   *
   * Called with the body already in hand but *before* it is stored, so a refused request costs a
   * socket read and nothing durable.
   *
   * A rejection gives the bytes back. Otherwise a project that brushes the ceiling once would have
   * every later request that day counted against a total it never actually stored, and the limit
   * would ratchet rather than cap.
   */
  async takeBytes(projectId: string, bytes: number): Promise<LimitVerdict> {
    if (this.bytesPerDay === 0 || bytes <= 0) return ALLOWED;

    const day = new Date().toISOString().slice(0, 10);
    const key = `ingest:bytes:${projectId}:${day}`;
    const [total, ttl] = await this.bump(key, bytes, DAY_SECONDS);

    if (total === null) return ALLOWED;
    if (total <= this.bytesPerDay) return ALLOWED;

    await this.redis.decrby(key, bytes).catch(() => undefined);

    return {
      ok: false,
      limit: 'volume',
      allowed: this.bytesPerDay,
      resetsInSeconds: ttl > 0 ? ttl : DAY_SECONDS,
    };
  }

  /**
   * Runs the counter script, or gives up and allows the request.
   *
   * Failing open is the right call here and not laziness. The only way this throws is Redis being
   * unreachable — and the very next thing the ingest path does is enqueue a job to that same
   * Redis, which will fail and return a 500. Rejecting here as well would turn one outage into a
   * confusing second error class, and would mean a limiter outage looks exactly like abuse.
   */
  private async bump(
    key: string,
    amount: number,
    ttlSeconds: number,
  ): Promise<[number | null, number]> {
    try {
      const result = (await (
        this.redis as unknown as {
          bumpLimit(
            key: string,
            amount: string,
            ttl: string,
          ): Promise<[number, number]>;
        }
      ).bumpLimit(key, String(amount), String(ttlSeconds))) as [number, number];

      return [Number(result[0]), Number(result[1])];
    } catch (error) {
      this.logger.warn(
        `ingest limit check failed, allowing: ${(error as Error).message}`,
      );
      return [null, 0];
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
