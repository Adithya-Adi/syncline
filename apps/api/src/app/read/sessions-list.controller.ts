import { Controller, Get, Query } from '@nestjs/common';
import { CurrentProject, RequireKey } from '../auth/ingest-key.guard.js';
import type { ResolvedProject } from '../auth/project.service.js';
import type { SessionListResponse } from '@syncline/protocol';
import { PrismaService } from '../prisma/prisma.service.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Lists recordings for a project.
 *
 * Unlike the single-session endpoints, this one requires the **secret** key. Those are protected
 * only by their identifiers being unguessable, and a list endpoint would hand over every
 * identifier at once — turning the weakest acceptable protection into none at all. Browsers never
 * hold an `sk_` key, so this is called server-side, and the web app renders the result.
 */
@Controller('sessions')
export class SessionsListController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireKey('secret')
  async list(
    @CurrentProject() project: ResolvedProject,
    @Query('limit') limitParam?: string,
    @Query('before') before?: string,
  ): Promise<SessionListResponse> {
    const limit = clampLimit(limitParam);

    // Keyset pagination on the id rather than an offset. Session ids are ULIDs, so they sort by
    // creation time, and a new recording arriving mid-scroll cannot shift a page boundary and make
    // a session appear twice or not at all.
    const rows = await this.prisma.client.session.findMany({
      where: {
        projectId: project.id,
        ...(before ? { id: { lt: before } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        startedAt: true,
        durationMs: true,
        url: true,
        userId: true,
        release: true,
        trivial: true,
        // Counted by the worker onto the session, so a list of fifty rows costs no extra query.
        // The failed-request count below cannot work the same way — it is a predicate over a
        // second table rather than a number the ingest path already knew.
        errorCount: true,
        consoleErrorCount: true,
        consoleWarnCount: true,
        _count: { select: { chunks: true, links: true, pageviews: true } },
        // The first page of the flow: where the session came in. One row per session, not a join
        // per row, because a list of fifty must not become fifty-one queries.
        pageviews: {
          orderBy: { ordinal: 'asc' },
          take: 1,
          select: { path: true },
        },
      },
    });

    const page = rows.slice(0, limit);

    // Counting failures per session in one grouped query rather than one query per row: a list of
    // fifty recordings should cost two round trips, not fifty-one.
    const failures = await this.prisma.client.requestLink.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: page.map((s) => s.id) }, status: { gte: 400 } },
      _count: { _all: true },
    });
    const failedBySession = new Map(
      failures.map((f) => [f.sessionId, f._count._all]),
    );

    return {
      sessions: page.map((s) => ({
        id: s.id,
        startedMs: s.startedAt.getTime(),
        durationMs: s.durationMs ?? 0,
        ...(s.url ? { url: s.url } : {}),
        ...(s.userId ? { userId: s.userId } : {}),
        ...(s.release ? { release: s.release } : {}),
        chunkCount: s._count.chunks,
        linkCount: s._count.links,
        failedRequestCount: failedBySession.get(s.id) ?? 0,
        errorCount: s.errorCount,
        consoleErrorCount: s.consoleErrorCount,
        consoleWarnCount: s.consoleWarnCount,
        pageCount: s._count.pageviews,
        ...(s.pageviews[0]?.path ? { entryPath: s.pageviews[0].path } : {}),
        trivial: s.trivial,
      })),
      ...(rows.length > limit ? { nextCursor: page[page.length - 1]?.id } : {}),
    };
  }
}

function clampLimit(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}
