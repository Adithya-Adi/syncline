import { Logger } from '@nestjs/common';
import { sessionChunkKey } from '@syncline/protocol';
import type { PrismaClient } from '@syncline/models';
import type { ObjectStore } from '@syncline/storage';

/**
 * Deletes recordings that have outlived their project's retention.
 *
 * The rule that shapes everything here: **blobs go first, rows go second.** A session row is the
 * only record of where its chunks live — delete it first and the objects become unreachable
 * garbage that nothing will ever find again, because the key is built from ids the row held. Doing
 * it in this order means a crash halfway leaves objects already gone and rows still present, which
 * the next sweep simply redoes. Deleting a missing object is a success in S3, so that redo is free.
 *
 * Nothing is deleted unless somebody asked for it. `RETENTION_DAYS` is zero out of the box, which
 * keeps everything forever — an upgrade that quietly started destroying a customer's history would
 * be the worst possible way to discover this feature exists. A self-hosted install sets whatever
 * number suits it, and may set that number as high as it likes.
 */

/** How many sessions one pass handles. Bounded so a sweep is interruptible and predictable. */
const BATCH = 200;

export interface RetentionResult {
  sessions: number;
  objects: number;
  spans: number;
  otlp: number;
}

export class RetentionProcessor {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStore,
    /** Days to keep, from `RETENTION_DAYS`. Zero keeps everything, and is the default. */
    private readonly retentionDays: number,
  ) {}

  async run(): Promise<RetentionResult> {
    const total: RetentionResult = {
      sessions: 0,
      objects: 0,
      spans: 0,
      otlp: 0,
    };

    const days = retentionWindowDays(this.retentionDays);
    if (days === null) return total;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Walked per project because both things this deletes are addressed by project: a chunk's key
    // is built from it, and the OTLP prefixes start with it.
    const projects = await this.prisma.project.findMany({
      select: { id: true },
    });

    for (const project of projects) {
      const purged = await this.purgeProject(project.id, cutoff);

      total.sessions += purged.sessions;
      total.objects += purged.objects;
      total.spans += purged.spans;
      total.otlp += purged.otlp;
    }

    if (total.sessions > 0 || total.otlp > 0) {
      this.logger.log(
        `retention: removed ${total.sessions} session(s), ${total.objects} chunk object(s), ` +
          `${total.spans} span(s), ${total.otlp} raw OTLP body(ies)`,
      );
    }

    return total;
  }

  /**
   * One project, one batch at a time, until nothing is left older than the cutoff.
   *
   * Batched rather than one enormous statement because a project with a year of recordings would
   * otherwise mean a single delete holding locks over hundreds of thousands of rows while the
   * ingest path is still trying to write.
   */
  private async purgeProject(
    projectId: string,
    cutoff: Date,
  ): Promise<RetentionResult> {
    const result: RetentionResult = {
      sessions: 0,
      objects: 0,
      spans: 0,
      otlp: 0,
    };

    for (;;) {
      const expired = await this.prisma.session.findMany({
        where: { projectId, startedAt: { lt: cutoff } },
        take: BATCH,
        select: {
          id: true,
          chunks: { select: { seq: true } },
          links: { select: { traceId: true } },
        },
      });

      if (expired.length === 0) break;

      // Blobs first. The row is the only thing that knows the key.
      const keys = expired.flatMap((session) =>
        session.chunks.map((chunk) =>
          sessionChunkKey(projectId, session.id, chunk.seq),
        ),
      );
      result.objects += await this.storage.deleteMany(keys);

      const traceIds = [
        ...new Set(expired.flatMap((s) => s.links.map((l) => l.traceId))),
      ];

      const deleted = await this.prisma.session.deleteMany({
        where: { id: { in: expired.map((session) => session.id) } },
      });
      result.sessions += deleted.count;

      result.spans += await this.purgeOrphanSpans(traceIds);

      // A short batch means the table is drained; anything else risks looping on rows that keep
      // failing to delete.
      if (expired.length < BATCH) break;
    }

    result.otlp += await this.purgeOtlpBodies(projectId, cutoff);
    return result;
  }

  /**
   * Spans whose last recording has gone.
   *
   * Spans are keyed by trace, not by session, and one trace can be referenced by more than one
   * recording — so a span is only garbage once *no* request link points at its trace any more.
   * Checking that after the sessions are gone is what makes it safe; checking before would delete
   * spans a surviving session still needs.
   */
  private async purgeOrphanSpans(traceIds: string[]): Promise<number> {
    if (traceIds.length === 0) return 0;

    const stillLinked = new Set(
      (
        await this.prisma.requestLink.findMany({
          where: { traceId: { in: traceIds } },
          select: { traceId: true },
        })
      ).map((link) => link.traceId),
    );

    const orphaned = traceIds.filter((traceId) => !stillLinked.has(traceId));
    if (orphaned.length === 0) return 0;

    const { count } = await this.prisma.span.deleteMany({
      where: { traceId: { in: orphaned } },
    });
    return count;
  }

  /**
   * Raw OTLP bodies, which no row points at.
   *
   * These are kept for replay and debugging and are named with a ULID nothing records, so the only
   * index is the day in the key — which is exactly why the day is in the key. Listing by prefix
   * per expired day is the whole mechanism.
   */
  private async purgeOtlpBodies(
    projectId: string,
    cutoff: Date,
  ): Promise<number> {
    let removed = 0;

    // A bounded look back rather than "every day since the epoch". Anything older than this was
    // either already swept or predates retention being switched on, and a sweep that walks
    // thousands of empty prefixes every hour is a sweep somebody turns off.
    for (let back = 0; back < 60; back += 1) {
      const day = new Date(cutoff.getTime() - back * 24 * 60 * 60 * 1000);
      const prefix = `otlp/${projectId}/${day.toISOString().slice(0, 10)}/`;

      const keys = await this.storage.listPrefix(prefix);
      if (keys.length === 0) continue;

      removed += await this.storage.deleteMany(keys);
    }

    return removed;
  }
}

/**
 * The retention window, or null for "keep everything".
 *
 * Zero means forever rather than "delete everything now". An environment variable that arrived
 * empty, or a typo, must never be the instruction that wipes an install — there is no undo, and no
 * reading of zero is worth that risk.
 */
export function retentionWindowDays(days: number): number | null {
  return Number.isFinite(days) && days > 0 ? days : null;
}
