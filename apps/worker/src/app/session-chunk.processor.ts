import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  isSynclineEvent,
  REQUEST_END,
  REQUEST_START,
  sessionChunkSchema,
  TRIVIAL_SESSION_MS,
  type SessionChunk,
  type SessionChunkJob,
} from '@syncline/protocol';
import type { PrismaClient } from '@syncline/models';
import type { ObjectStore } from '@syncline/storage';

/**
 * The slice of the client the pageview helpers need.
 *
 * Typed structurally rather than as the transaction client so the helpers can be called with either,
 * and so a test can hand them a fake without constructing a Prisma transaction.
 */
type PageviewTx = {
  pageview: {
    findMany(args: unknown): Promise<
      {
        id: string;
        startedAt: Date;
        endedAt: Date | null;
        durationMs: number | null;
      }[]
    >;
    update(args: unknown): Promise<unknown>;
  };
};

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
    private readonly storage: ObjectStore,
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
        `chunk body (${parsed.sessionId}/${parsed.seq}) disagrees with its path (${sessionId}/${seq})`,
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
          ...(parsed.meta?.userAgent
            ? { userAgent: parsed.meta.userAgent }
            : {}),
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
          ...(parsed.pageviewOrdinal !== undefined
            ? { pageviewOrdinal: parsed.pageviewOrdinal }
            : {}),
          storageKey,
        },
        update: {
          eventCount: parsed.events.length,
          sizeBytes: raw.byteLength,
          ...(parsed.pageviewOrdinal !== undefined
            ? { pageviewOrdinal: parsed.pageviewOrdinal }
            : {}),
        },
      });

      // The flow. Upsert by (session, ordinal) because a redelivered chunk carries the same pages,
      // and because the SDK's ordinal is the authority on their order — not arrival time.
      for (const pageview of parsed.pageviews) {
        const startedAt = new Date(pageview.startMs);
        await tx.pageview.upsert({
          where: {
            sessionId_ordinal: { sessionId, ordinal: pageview.ordinal },
          },
          create: {
            sessionId,
            ordinal: pageview.ordinal,
            url: pageview.url,
            path: pathOf(pageview.url),
            trigger: pageview.trigger,
            startedAt,
          },
          update: {
            url: pageview.url,
            path: pathOf(pageview.url),
            trigger: pageview.trigger,
            startedAt,
          },
        });
      }

      if (parsed.links.length > 0) {
        await tx.requestLink.deleteMany({
          where: {
            sessionId,
            spanId: { in: parsed.links.map((l) => l.spanId) },
          },
        });
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
        const durationMs =
          bounds._max.endedAt.getTime() - bounds._min.startedAt.getTime();

        // Counted rather than tracked incrementally: a chunk can arrive twice, and a counter that
        // drifts is worse than one query per chunk on a table indexed by session.
        const [linkCount, failedCount] = await Promise.all([
          tx.requestLink.count({ where: { sessionId } }),
          tx.requestLink.count({ where: { sessionId, status: { gte: 400 } } }),
        ]);

        await tx.session.update({
          where: { id: sessionId },
          data: {
            startedAt: bounds._min.startedAt,
            endedAt: bounds._max.endedAt,
            durationMs,
            trivial: isTrivial({ durationMs, linkCount, failedCount }),
          },
        });

        await closePageviews(tx, sessionId, bounds._max.endedAt);
      }
    });

    this.logger.log(
      `session ${sessionId} seq ${seq}: ${parsed.events.length} events, ${parsed.links.length} links`,
    );
  }

  private parse(raw: Buffer, storageKey: string): SessionChunk {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      throw new UnrecoverableChunkError(
        `${storageKey} is not valid JSON: ${(error as Error).message}`,
      );
    }

    const result = sessionChunkSchema.safeParse(json);
    if (!result.success) {
      // Retrying will not make a malformed body valid, so this must not be retried three times
      // and then buried in the failed set as if it were a transient fault.
      throw new UnrecoverableChunkError(
        `${storageKey} failed validation: ${result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
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
 * The path a pageview URL points at, stored alongside the URL so filtering never parses per row.
 *
 * A hash route lives in the fragment, and for a hash router that fragment *is* the path — so it is
 * kept. Anything unparseable becomes `/`, because a null path would make every "which sessions
 * reached X" query decide what to do about it.
 */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    const hash = parsed.hash.startsWith('#/') ? parsed.hash.slice(1) : '';
    return hash || parsed.pathname || '/';
  } catch {
    return '/';
  }
}

/**
 * Gives every page an end: the next page's start, or the session's last event for the final one.
 *
 * Derived here rather than sent by the SDK because the SDK cannot know. It emits a page's start and
 * then, whenever the user leaves, a different page's start — the previous page's end is only knowable
 * once you have both, and the last page's end only once the recording stops arriving.
 *
 * Recomputed from scratch on every chunk, so a late-arriving page slots into the middle of the flow
 * and the pages either side of it correct themselves.
 */
async function closePageviews(
  tx: PageviewTx,
  sessionId: string,
  sessionEndedAt: Date,
): Promise<void> {
  const pageviews = await tx.pageview.findMany({
    where: { sessionId },
    orderBy: { ordinal: 'asc' },
    select: { id: true, startedAt: true, endedAt: true, durationMs: true },
  });

  for (const [index, pageview] of pageviews.entries()) {
    const next = pageviews[index + 1];
    const endedAt = next ? next.startedAt : sessionEndedAt;

    // A page cannot end before it began. Client clocks jump, and a negative duration on screen is
    // worse than none: it reads as a bug in the viewer rather than a bad clock on the device.
    if (endedAt.getTime() < pageview.startedAt.getTime()) continue;
    if (pageview.endedAt?.getTime() === endedAt.getTime()) continue;

    await tx.pageview.update({
      where: { id: pageview.id },
      data: {
        endedAt,
        durationMs: endedAt.getTime() - pageview.startedAt.getTime(),
      },
    });
  }
}

/**
 * Whether a recording is worth showing by default.
 *
 * Short *and* empty. A two-second visit that produced a failed request is exactly the recording
 * someone will come looking for, so a failure disqualifies it however brief it was. This is a label
 * and never a deletion: the recordings list hides these, and a filter brings them back.
 */
/** One of our request markers, as opposed to a pageview marker or a real rrweb event. */
function isRequestMarker(event: unknown): boolean {
  if (!isSynclineEvent(event)) return false;
  const tag = event.data.tag;
  return tag === REQUEST_START || tag === REQUEST_END;
}

export function isTrivial(session: {
  durationMs: number;
  linkCount: number;
  failedCount: number;
}): boolean {
  if (session.failedCount > 0) return false;
  if (session.linkCount > 0) return false;
  return session.durationMs < TRIVIAL_SESSION_MS;
}

/**
 * rrweb stamps every event with a client timestamp, and these are the bounds of the recording.
 *
 * Request markers are excluded: a response can arrive after the last DOM mutation, and letting it
 * extend the recording would claim frames that were never captured.
 *
 * Pageview markers are *not* excluded, and the difference matters. A navigation is by definition a
 * moment the user was on the page, and a chunk that carries only the marker — which is what a
 * route change immediately before leaving produces — would otherwise contribute nothing. The
 * session would then end before its own last page began, and that page would be left with no
 * duration at all.
 */
export function eventTimestamps(events: unknown[]): {
  first?: number;
  last?: number;
} {
  let first: number | undefined;
  let last: number | undefined;

  for (const event of events) {
    if (isRequestMarker(event)) continue;
    const ts = (event as { timestamp?: unknown })?.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    if (first === undefined || ts < first) first = ts;
    if (last === undefined || ts > last) last = ts;
  }

  return {
    ...(first !== undefined ? { first } : {}),
    ...(last !== undefined ? { last } : {}),
  };
}
