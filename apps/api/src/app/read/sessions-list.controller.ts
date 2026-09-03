import { Controller, Get, Query } from '@nestjs/common';
import { CurrentProject, RequireKey } from '../auth/ingest-key.guard.js';
import type { ResolvedProject } from '../auth/project.service.js';
import type { SessionListResponse } from '@syncline/protocol';
import { compileQuery, parseQuery } from '@syncline/models';
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
    @Query('q') q?: string,
  ): Promise<SessionListResponse> {
    const limit = clampLimit(limitParam);

    // The same language the dashboard's search box speaks, compiled by the same code. Two
    // implementations of one query syntax is two sets of results for one question.
    const parsed = parseQuery(q ?? '');

    // The project's vocabulary, and only when something was typed. An attribute key is stored with
    // the case the application sent it in, and a caller will not have matched that exactly.
    const keys =
      parsed.terms.length > 0
        ? (
            await this.prisma.client.projectAttributeKey.findMany({
              where: { projectId: project.id, indexed: true },
              select: { key: true },
            })
          ).map((row) => row.key)
        : [];

    const search = compileQuery(parsed, { keys });

    // Keyset pagination on the id rather than an offset. Session ids are ULIDs, so they sort by
    // creation time, and a new recording arriving mid-scroll cannot shift a page boundary and make
    // a session appear twice or not at all.
    const rows = await this.prisma.client.session.findMany({
      where: {
        projectId: project.id,
        ...(before ? { id: { lt: before } } : {}),
        // Under the project scope, never beside it: a compiled clause names no project, so no
        // query string can reach another one's recordings.
        ...(search.where.length > 0 ? { AND: search.where } : {}),
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
        // The search summary, all of it counted by the worker as the rows landed. This is what
        // makes the list one query: every number a row shows, and every number a filter selects
        // on, is a column on the session rather than an aggregate over its links and chunks.
        errorCount: true,
        consoleErrorCount: true,
        consoleWarnCount: true,
        requestCount: true,
        failedRequestCount: true,
        slowestRequestMs: true,
        serviceNames: true,
        chunkCount: true,
        missingChunkSeqs: true,
        _count: { select: { pageviews: true } },
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

    return {
      sessions: page.map((s) => ({
        id: s.id,
        startedMs: s.startedAt.getTime(),
        durationMs: s.durationMs ?? 0,
        ...(s.url ? { url: s.url } : {}),
        ...(s.userId ? { userId: s.userId } : {}),
        ...(s.release ? { release: s.release } : {}),
        chunkCount: s.chunkCount,
        linkCount: s.requestCount,
        failedRequestCount: s.failedRequestCount,
        errorCount: s.errorCount,
        consoleErrorCount: s.consoleErrorCount,
        consoleWarnCount: s.consoleWarnCount,
        ...(s.slowestRequestMs !== null
          ? { slowestRequestMs: s.slowestRequestMs }
          : {}),
        serviceNames: s.serviceNames,
        missingChunkSeqs: s.missingChunkSeqs,
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
