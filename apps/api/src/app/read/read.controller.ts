import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import {
  CLOCK_UNCERTAINTY_THRESHOLD_MS,
  sessionIdSchema,
  type SessionResponse,
  type TraceResponse,
} from '@syncline/protocol';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { buildSpanTree } from './span-tree.js';

/**
 * The read side, for the viewer.
 *
 * These endpoints are unauthenticated in the MVP. Access is by unguessable identifier: a session
 * id is a ULID carrying 80 bits of randomness, and a trace id is 128 bits. That is the same
 * property a signed share link relies on, and it is deliberately all there is right now —
 * multi-tenant auth is listed out of scope in docs/ARCHITECTURE.md §11.
 *
 * The consequence is worth stating plainly: anyone holding a session id can watch that recording.
 * Before this is exposed beyond a trusted network, it needs real authorization.
 */
@Controller()
export class ReadController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  @Get('sessions/:id')
  async session(@Param('id') id: string): Promise<SessionResponse> {
    if (!sessionIdSchema.safeParse(id).success) throw new NotFoundException('no such session');

    const session = await this.prisma.client.session.findUnique({
      where: { id },
      include: {
        chunks: { orderBy: { seq: 'asc' } },
        links: { orderBy: { clientStartMs: 'asc' } },
      },
    });

    if (!session) throw new NotFoundException('no such session');

    return {
      id: session.id,
      startedMs: session.startedAt.getTime(),
      ...(session.endedAt ? { endedMs: session.endedAt.getTime() } : {}),
      ...(session.durationMs !== null ? { durationMs: session.durationMs } : {}),
      clock: { offsetMs: session.clockOffsetMs, rttMs: session.rttMs },
      meta: {
        ...(session.url ? { url: session.url } : {}),
        ...(session.userAgent ? { userAgent: session.userAgent } : {}),
        ...(session.release ? { release: session.release } : {}),
        ...(session.userId ? { user: { id: session.userId } } : {}),
        ...(session.viewport ? { viewport: session.viewport as { w: number; h: number } } : {}),
      },
      chunks: session.chunks.map((chunk) => ({
        seq: chunk.seq,
        startedMs: chunk.startedAt.getTime(),
        endedMs: chunk.endedAt.getTime(),
        eventCount: chunk.eventCount,
        sizeBytes: chunk.sizeBytes,
        url: `/v1/sessions/${session.id}/chunks/${chunk.seq}`,
      })),
      links: session.links.map((link) => ({
        traceId: link.traceId,
        spanId: link.spanId,
        method: link.method,
        url: link.url,
        ...(link.status !== null ? { status: link.status } : {}),
        startMs: Number(link.clientStartMs),
        endMs: Number(link.clientEndMs),
      })),
    };
  }

  /**
   * Serves the rrweb events for one chunk.
   *
   * The stored bytes are handed back exactly as the SDK sent them, gzip and all, with
   * `Content-Encoding` set so the browser inflates them. Inflating here only to have the response
   * recompressed on the way out would be work for its own sake.
   */
  @Get('sessions/:id/chunks/:seq')
  async chunk(
    @Param('id') id: string,
    @Param('seq') seqParam: string,
    @Res({ passthrough: true }) res: ServerResponse
  ): Promise<StreamableFile> {
    const seq = Number(seqParam);
    if (!Number.isInteger(seq) || seq < 0) throw new NotFoundException('no such chunk');

    const chunk = await this.prisma.client.sessionChunk.findUnique({
      where: { sessionId_seq: { sessionId: id, seq } },
      select: { storageKey: true },
    });
    if (!chunk) throw new NotFoundException('no such chunk');

    const bytes = await this.storage.get(chunk.storageKey);
    const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

    res.setHeader('content-type', 'application/json');
    if (gzipped) res.setHeader('content-encoding', 'gzip');
    // Chunks are immutable once written, so this is safe to cache hard.
    res.setHeader('cache-control', 'private, max-age=31536000, immutable');

    return new StreamableFile(bytes);
  }

  /**
   * Serves a trace, already skew-corrected and tree-ordered.
   *
   * The offset comes from whichever session recorded this trace, found through the request link.
   * A trace with no link — one from a backend job, say — is returned uncorrected, which is right:
   * there is no client clock to correct it toward.
   */
  @Get('traces/:traceId')
  @Header('cache-control', 'private, max-age=60')
  async trace(@Param('traceId') traceId: string): Promise<TraceResponse> {
    if (!/^[0-9a-f]{32}$/.test(traceId)) throw new NotFoundException('no such trace');

    const spans = await this.prisma.spans.byTrace(traceId);
    if (spans.length === 0) throw new NotFoundException('no such trace');

    const link = await this.prisma.client.requestLink.findFirst({
      where: { traceId },
      select: { session: { select: { clockOffsetMs: true, rttMs: true } } },
    });

    const clockOffsetMs = link?.session.clockOffsetMs ?? 0;
    const rttMs = link?.session.rttMs ?? 0;

    return {
      traceId,
      spans: buildSpanTree(spans, clockOffsetMs),
      // Half the round trip, and only when it is large enough to matter. The viewer draws this as
      // a band rather than implying precision the measurement does not have.
      uncertaintyMs: rttMs >= CLOCK_UNCERTAINTY_THRESHOLD_MS ? Math.round(rttMs / 2) : 0,
    };
  }
}
