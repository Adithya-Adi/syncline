import { BadRequestException, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { ulid } from 'ulid';
import {
  MAX_CHUNK_BYTES,
  MAX_CHUNKS_PER_SESSION,
  otlpKey,
  sessionChunkKey,
  sessionIdSchema,
} from '@syncline/protocol';
import { CurrentProject, RequireKey } from '../auth/ingest-key.guard.js';
import type { ResolvedProject } from '../auth/project.service.js';
import { StorageService } from '../storage/storage.service.js';
import { QueueService } from '../queue/queue.service.js';
import { readBody } from './read-body.js';

/** OTLP bodies are not chunked by an SDK we control, so they get their own, looser ceiling. */
const MAX_OTLP_BYTES = 8 * 1024 * 1024;

/**
 * The two write paths. Both do the same four things and nothing else: authenticate, bound the
 * size, put the bytes in object storage, enqueue a pointer. Then 202.
 *
 * No parsing happens here. Validation, decompression and indexing are the worker's job, where a
 * slow or hostile payload costs a queue slot rather than an HTTP connection. See
 * docs/ARCHITECTURE.md §2.
 */
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly storage: StorageService,
    private readonly queue: QueueService
  ) {}

  /**
   * Session id and sequence travel in the URL rather than the body.
   *
   * They have to: the storage key is built from them, and reading them out of the body would mean
   * parsing the very payload this endpoint refuses to parse. In the URL they also make the object
   * key meaningful, give the queue a natural job id for deduplication, and show up in access logs
   * when something goes wrong. The body still carries them, and the worker checks that the two
   * agree.
   */
  @Post('session/:sessionId/:seq')
  @RequireKey('public')
  @HttpCode(202)
  async session(
    @CurrentProject() project: ResolvedProject,
    @Param('sessionId') sessionId: string,
    @Param('seq') seqParam: string,
    @Req() req: IncomingMessage
  ): Promise<{ ok: true }> {
    if (!sessionIdSchema.safeParse(sessionId).success) {
      throw new BadRequestException('sessionId must be a ULID');
    }

    const seq = Number(seqParam);
    if (!Number.isInteger(seq) || seq < 0 || seq > MAX_CHUNKS_PER_SESSION) {
      throw new BadRequestException(`seq must be an integer between 0 and ${MAX_CHUNKS_PER_SESSION}`);
    }

    const body = await readBody(req, MAX_CHUNK_BYTES);
    if (body.bytes.length === 0) throw new BadRequestException('empty body');

    const key = sessionChunkKey(project.id, sessionId, seq);
    await this.storage.put(key, body.bytes, {
      contentType: 'application/json',
      ...(body.gzipped ? { contentEncoding: 'gzip' } : {}),
    });

    await this.queue.enqueueSessionChunk({
      projectId: project.id,
      sessionId,
      seq,
      storageKey: key,
      receivedMs: Date.now(),
    });

    return { ok: true };
  }

  /**
   * Standard OTLP/HTTP. There is no Syncline backend SDK and there should not be one — being a
   * plain OTLP sink is what lets Syncline sit beside an existing tracing vendor instead of
   * replacing it.
   *
   * Two paths for one endpoint. An OTel exporter appends `/v1/traces` to
   * OTEL_EXPORTER_OTLP_ENDPOINT but uses OTEL_EXPORTER_OTLP_TRACES_ENDPOINT verbatim, so whichever
   * variable an operator reaches for, the request lands here. Getting this wrong produces a silent
   * 404 inside a batch exporter, which is a miserable thing to debug.
   */
  @Post(['traces', 'v1/traces'])
  @RequireKey('secret')
  @HttpCode(202)
  async traces(
    @CurrentProject() project: ResolvedProject,
    @Req() req: IncomingMessage
  ): Promise<{ ok: true }> {
    const body = await readBody(req, MAX_OTLP_BYTES);
    if (body.bytes.length === 0) throw new BadRequestException('empty body');

    const day = new Date().toISOString().slice(0, 10);
    const key = otlpKey(project.id, day, ulid());

    await this.storage.put(key, body.bytes, {
      contentType: 'application/json',
      ...(body.gzipped ? { contentEncoding: 'gzip' } : {}),
    });

    await this.queue.enqueueOtlpTraces({
      projectId: project.id,
      storageKey: key,
      receivedMs: Date.now(),
    });

    return { ok: true };
  }
}
