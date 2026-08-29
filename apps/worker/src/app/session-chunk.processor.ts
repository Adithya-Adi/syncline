import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  isSynclineEvent,
  sessionChunkSchema,
  type SessionChunk,
  type SessionChunkJob,
} from '@syncline/protocol';
import type { PrismaClient } from '@syncline/models';
import type { ObjectStore } from '@syncline/storage';

/**
 * Turns a stored rrweb chunk into rows.
 *
 * This is where the payload is finally parsed. The API refused to, on purpose: decompressing and
 * validating attacker-controlled input belongs on a queue slot, not on an HTTP connection.
 *
 * Everything here is idempotent. A redelivered job re-reads the same object and upserts the same
 * rows, because at-least-once delivery is the only guarantee a queue actually gives you.
 */
export class SessionChunkProcessor {
  private readonly logger = new Logger(SessionChunkProcessor.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStore
  ) {}

  async process(job: Job<SessionChunkJob>): Promise<void> {
    const { projectId, sessionId, seq, storageKey, receivedMs } = job.data;

    const raw = await this.storage.getMaybeGzipped(storageKey);
    const parsed = this.parse(raw, storageKey);

    // The URL is what the storage key was built from; the body carries the same values. If they
    // disagree, one of them is a client bug or a forged path, and guessing which to trust would
    // let a chunk be filed under someone else's session.
    if (parsed.sessionId !== sessionId || parsed.seq !== seq) {
      throw new UnrecoverableChunkError(
        `chunk body (${parsed.sessionId}/${parsed.seq}) disagrees with its path (${sessionId}/${seq})`
      );
    }

    const timestamps = eventTimestamps(parsed.events);
    const startedMs = timestamps.first ?? receivedMs;
    const endedMs = timestamps.last ?? receivedMs;

    await this.prisma.$transaction(async (tx) => {
      // The first chunk carries the metadata; later ones only extend the session's end time.
      // Upsert rather than create because chunks can arrive out of order — seq 1 overtaking
      // seq 0 is ordinary on a lossy connection.
      await tx.session.upsert({
        where: { id: sessionId },
        create: {
          id: sessionId,
          projectId,
          startedAt: new Date(startedMs),
          endedAt: new Date(endedMs),
          durationMs: endedMs - startedMs,
          clockOffsetMs: parsed.clock.offsetMs,
          rttMs: parsed.clock.rttMs,
          ...(parsed.meta?.url ? { url: parsed.meta.url } : {}),
          ...(parsed.meta?.userAgent ? { userAgent: parsed.meta.userAgent } : {}),
          ...(parsed.meta?.release ? { release: parsed.meta.release } : {}),
          ...(parsed.meta?.user?.id ? { userId: parsed.meta.user.id } : {}),
          ...(parsed.meta?.viewport ? { viewport: parsed.meta.viewport } : {}),
        },
        update: {
          endedAt: new Date(endedMs),
          ...(parsed.meta ? { url: parsed.meta.url ?? null } : {}),
        },
      });

      await tx.sessionChunk.upsert({
        where: { sessionId_seq: { sessionId, seq } },
        create: {
          sessionId,
          seq,
          startedAt: new Date(startedMs),
          endedAt: new Date(endedMs),
          eventCount: parsed.events.length,
          sizeBytes: raw.byteLength,
          storageKey,
        },
        update: {
          eventCount: parsed.events.length,
          sizeBytes: raw.byteLength,
        },
      });

      if (parsed.links.length > 0) {
        await tx.requestLink.deleteMany({ where: { sessionId, spanId: { in: parsed.links.map((l) => l.spanId) } } });
        await tx.requestLink.createMany({
          data: parsed.links.map((link) => ({
            sessionId,
            traceId: link.traceId,
            spanId: link.spanId,
            method: link.method,
            url: link.url,
            status: link.status ?? null,
            clientStartMs: BigInt(link.startMs),
            clientEndMs: BigInt(link.endMs),
          })),
        });
      }

      // Recompute the session's span from its chunks so an out-of-order arrival cannot leave the
      // duration reflecting whichever chunk happened to land last.
      const bounds = await tx.sessionChunk.aggregate({
        where: { sessionId },
        _min: { startedAt: true },
        _max: { endedAt: true },
      });

      if (bounds._min.startedAt && bounds._max.endedAt) {
        await tx.session.update({
          where: { id: sessionId },
          data: {
            startedAt: bounds._min.startedAt,
            endedAt: bounds._max.endedAt,
            durationMs: bounds._max.endedAt.getTime() - bounds._min.startedAt.getTime(),
          },
        });
      }
    });

    this.logger.log(
      `session ${sessionId} seq ${seq}: ${parsed.events.length} events, ${parsed.links.length} links`
    );
  }

  private parse(raw: Buffer, storageKey: string): SessionChunk {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      throw new UnrecoverableChunkError(`${storageKey} is not valid JSON: ${(error as Error).message}`);
    }

    const result = sessionChunkSchema.safeParse(json);
    if (!result.success) {
      // Retrying will not make a malformed body valid, so this must not be retried three times
      // and then buried in the failed set as if it were a transient fault.
      throw new UnrecoverableChunkError(
        `${storageKey} failed validation: ${result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`
      );
    }

    return result.data;
  }
}

/**
 * A failure that reprocessing cannot fix.
 *
 * Extends BullMQ's UnrecoverableError so the job fails immediately instead of burning three
 * attempts and an exponential backoff on a body that will never become valid.
 */
export class UnrecoverableChunkError extends UnrecoverableError {}

/**
 * rrweb stamps every event with a client timestamp. Syncline's own custom events are excluded:
 * they mark request boundaries and can sit outside the window of recorded DOM activity.
 */
export function eventTimestamps(events: unknown[]): { first?: number; last?: number } {
  let first: number | undefined;
  let last: number | undefined;

  for (const event of events) {
    if (isSynclineEvent(event)) continue;
    const ts = (event as { timestamp?: unknown })?.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    if (first === undefined || ts < first) first = ts;
    if (last === undefined || ts > last) last = ts;
  }

  return { ...(first !== undefined ? { first } : {}), ...(last !== undefined ? { last } : {}) };
}
