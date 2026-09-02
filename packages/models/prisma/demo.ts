/**
 * Installs the demo recording.
 *
 * The viewer is the product, and a fresh install has nothing in it. Someone evaluating Syncline
 * should be able to watch a session — replay, requests, a failure, the trace underneath it — before
 * deciding whether to integrate the SDK, not after.
 *
 * The recording itself is a fixture built by `tools/build-demo-recording.mjs` from the real SDK
 * driving real rrweb. This file only installs it: chunk bodies to object storage, rows to Postgres,
 * timestamps rebased so the session reads as one that finished a few minutes ago.
 *
 * Deliberately not routed through the ingest API and the worker. `pnpm db:seed` has to work with
 * nothing running but Postgres and MinIO, and requiring a live API, Redis, and a worker to see the
 * demo would put the same integration problem back in front of the person the demo exists for. The
 * cost is that this file duplicates a little of what the worker derives — page ends, the path
 * column, and the trivial flag. `tests/demo.spec.ts` pins the parts that can drift.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulid';
import { sessionChunkKey, sessionChunkSchema } from '@syncline/protocol';
import { ObjectStore } from '@syncline/storage';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  missingChunkSeqs,
  sessionAttributes,
  slowestRequestMs,
} from '../src/lib/session-index.js';
import { PostgresSpanStore } from '../src/lib/span-store.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'demo/recording.json',
);

/** How long ago the demo session ended. Recent enough to be the first row, not suspiciously now. */
const ENDED_MINUTES_AGO = 4;

export interface DemoFixture {
  sdk: { name: string; version: string };
  clock: { offsetMs: number; rttMs: number };
  meta: Record<string, unknown>;
  durationMs: number;
  chunks: {
    seq: number;
    pageviewOrdinal?: number;
    events: {
      type: number;
      timestamp: number;
      data?: Record<string, unknown>;
    }[];
    links: {
      traceId: string;
      spanId: string;
      method: string;
      url: string;
      status?: number;
      startMs: number;
      endMs: number;
    }[];
    pageviews: {
      ordinal: number;
      url: string;
      startMs: number;
      trigger: string;
    }[];
    /** Absent on a chunk that captured none, the same as the wire format. */
    errors?: {
      source: string;
      name?: string;
      message: string;
      fileUrl?: string;
      line?: number;
      column?: number;
      stack?: string;
      timeMs: number;
    }[];
    logs?: { level: string; message: string; timeMs: number }[];
  }[];
  spans: {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: string;
    serviceName: string;
    startOffsetMs: number;
    durationMs: number;
    statusCode?: string;
    statusMsg?: string;
    attributes: Record<string, unknown>;
  }[];
}

export interface DemoRecording {
  sessionId: string;
  chunkCount: number;
  pageCount: number;
  requestCount: number;
  errorCount: number;
  spanCount: number;
  durationMs: number;
}

/**
 * The object store, or a reason there isn't one.
 *
 * Replay bytes live in object storage, so without it there is no demo to install — but the rest of
 * the seed works fine, and failing the whole thing over a container nobody started would be a poor
 * trade for a convenience feature.
 */
function objectStore(): ObjectStore | string {
  const missing = [
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ].filter((name) => !process.env[name]);

  if (missing.length > 0) return `${missing.join(', ')} not set`;

  return new ObjectStore({
    endpoint: process.env['S3_ENDPOINT'] as string,
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: process.env['S3_BUCKET'] as string,
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] as string,
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] as string,
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
  });
}

/**
 * Fresh trace and span ids for one installation of the demo.
 *
 * The fixture's ids were minted once, when it was generated, and reusing them would make every
 * seeded demo share one set of spans: `Span` is keyed by `(traceId, spanId)`, so the second install
 * silently no-ops against the first, and its trace then resolves to timestamps from a session it
 * has nothing to do with. Two projects on one machine is the ordinary case — `pnpm db:seed` is
 * documented as re-runnable — so the ids have to be per install.
 *
 * A `Map` rather than a rewrite in place: the same id appears in the request marker inside the
 * replay, in the link row, and in the span, and all three have to agree or the jump from a request
 * to its trace lands nowhere.
 */
export function freshIds(fixture: DemoFixture): Map<string, string> {
  const ids = new Map<string, string>();

  const mint = (id: string, bytes: number) => {
    if (!ids.has(id)) ids.set(id, randomBytes(bytes).toString('hex'));
  };

  for (const chunk of fixture.chunks) {
    for (const link of chunk.links) {
      mint(link.traceId, 16);
      mint(link.spanId, 8);
    }
  }
  for (const span of fixture.spans) {
    mint(span.traceId, 16);
    mint(span.spanId, 8);
    if (span.parentSpanId) mint(span.parentSpanId, 8);
  }

  return ids;
}

/** The new id for a fixture id, or the original when nothing claimed it. */
function remap(ids: Map<string, string>, id: string): string {
  return ids.get(id) ?? id;
}

/**
 * Rebases one chunk onto a real point in time, under this installation's ids.
 *
 * The fixture stores every timestamp as an offset from the session's first event, which is what
 * lets the same bytes become a recording from four minutes ago however long ago they were
 * generated. rrweb's own stamp and the absolute times inside our custom-event payloads both move,
 * and the trace ids inside those payloads are rewritten alongside them.
 */
export function rebaseChunk(
  chunk: DemoFixture['chunks'][number],
  sessionId: string,
  fixture: Pick<DemoFixture, 'sdk' | 'clock' | 'meta'>,
  baseMs: number,
  ids: Map<string, string>,
): unknown {
  return {
    sessionId,
    seq: chunk.seq,
    sdk: fixture.sdk,
    clock: fixture.clock,
    // Only the first chunk carries metadata, the same as a real recording.
    ...(chunk.seq === 0 ? { meta: fixture.meta } : {}),
    events: chunk.events.map((event) => {
      const payload = event.data?.['payload'] as
        Record<string, unknown> | undefined;
      if (!payload) return { ...event, timestamp: event.timestamp + baseMs };

      const moved = { ...payload };
      // `timeMs` is the error and console markers' instant; `startMs`/`endMs` the request's window.
      for (const field of ['startMs', 'endMs', 'timeMs']) {
        if (typeof moved[field] === 'number')
          moved[field] = (moved[field] as number) + baseMs;
      }
      for (const field of ['traceId', 'spanId']) {
        if (typeof moved[field] === 'string')
          moved[field] = remap(ids, moved[field] as string);
      }
      return {
        ...event,
        timestamp: event.timestamp + baseMs,
        data: { ...event.data, payload: moved },
      };
    }),
    links: chunk.links.map((link) => ({
      ...link,
      traceId: remap(ids, link.traceId),
      spanId: remap(ids, link.spanId),
      startMs: link.startMs + baseMs,
      endMs: link.endMs + baseMs,
    })),
    pageviews: chunk.pageviews.map((pageview) => ({
      ...pageview,
      startMs: pageview.startMs + baseMs,
    })),
    // The denormalized copies, moved with their markers. Omitted rather than sent empty, so a
    // rebased chunk stays the shape the SDK would have posted.
    ...(chunk.errors?.length
      ? {
          errors: chunk.errors.map((error) => ({
            ...error,
            timeMs: error.timeMs + baseMs,
          })),
        }
      : {}),
    ...(chunk.logs?.length
      ? {
          logs: chunk.logs.map((log) => ({
            ...log,
            timeMs: log.timeMs + baseMs,
          })),
        }
      : {}),
    ...(chunk.pageviewOrdinal !== undefined
      ? { pageviewOrdinal: chunk.pageviewOrdinal }
      : {}),
  };
}

/**
 * The path a pageview URL points at.
 *
 * The same rule the worker applies, for the same reason: a hash route's path lives in its fragment,
 * and an unparseable URL still has to answer "which sessions reached X" with something.
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

export async function seedDemoRecording(
  prisma: PrismaClient,
  projectId: string,
): Promise<DemoRecording | string> {
  const store = objectStore();
  if (typeof store === 'string') return store;

  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as DemoFixture;

  const sessionId = ulid();
  const ids = freshIds(fixture);
  const endedMs = Date.now() - ENDED_MINUTES_AGO * 60_000;
  const baseMs = endedMs - fixture.durationMs;

  await store.ensureBucket();

  const chunks = fixture.chunks.map((chunk) => {
    const body = rebaseChunk(chunk, sessionId, fixture, baseMs, ids);

    // Validated against the wire schema rather than trusted. A fixture regenerated against a newer
    // protocol should fail here, loudly, and not as a chunk the worker rejects months later.
    const parsed = sessionChunkSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `demo chunk ${chunk.seq} does not satisfy the chunk schema: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}. Regenerate it with tools/build-demo-recording.mjs.`,
      );
    }

    const bytes = gzipSync(Buffer.from(JSON.stringify(parsed.data), 'utf8'));
    const timestamps = parsed.data.events
      .map((event) => (event as { timestamp?: number }).timestamp)
      .filter((ts): ts is number => typeof ts === 'number');

    return {
      seq: chunk.seq,
      key: sessionChunkKey(projectId, sessionId, chunk.seq),
      bytes,
      eventCount: parsed.data.events.length,
      startedAt: new Date(Math.min(...timestamps)),
      endedAt: new Date(Math.max(...timestamps)),
      // Taken from the validated chunk rather than the fixture, so these are the same numbers the
      // worker would have derived from the same bytes.
      errors: parsed.data.errors,
      consoleErrorCount: parsed.data.logs.filter((log) => log.level === 'error')
        .length,
      consoleWarnCount: parsed.data.logs.filter((log) => log.level === 'warn')
        .length,
      ...(chunk.pageviewOrdinal !== undefined
        ? { pageviewOrdinal: chunk.pageviewOrdinal }
        : {}),
    };
  });

  for (const chunk of chunks) {
    await store.put(chunk.key, chunk.bytes, {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    });
  }

  const pageviews = fixture.chunks.flatMap((chunk) => chunk.pageviews);
  const links = fixture.chunks.flatMap((chunk) => chunk.links);
  const meta = fixture.meta as {
    userAgent?: string;
    release?: string;
    user?: { id?: string };
    viewport?: { w: number; h: number };
  };

  await prisma.session.create({
    data: {
      id: sessionId,
      projectId,
      startedAt: new Date(baseMs),
      endedAt: new Date(endedMs),
      durationMs: fixture.durationMs,
      clockOffsetMs: fixture.clock.offsetMs,
      rttMs: fixture.clock.rttMs,
      // The page the session started on, not the one it ended on: this is the row's label in the
      // recordings list, and "where did they come in" is the more useful of the two.
      url: pageviews[0]?.url ?? null,
      userAgent: meta.userAgent ?? null,
      release: meta.release ?? null,
      userId: meta.user?.id ?? null,
      viewport: meta.viewport ?? undefined,
      // A failed request or a thrown error disqualifies a recording from being trivial however
      // short it is, and this one has both — the failure the demo is built around.
      trivial: false,
      errorCount: chunks.reduce(
        (total, chunk) => total + chunk.errors.length,
        0,
      ),
      consoleErrorCount: chunks.reduce(
        (total, chunk) => total + chunk.consoleErrorCount,
        0,
      ),
      consoleWarnCount: chunks.reduce(
        (total, chunk) => total + chunk.consoleWarnCount,
        0,
      ),
      // The search summary, computed the way the worker computes it. This is the third thing this
      // file duplicates from the worker and the reason tests/demo.spec.ts exists: a seeded
      // recording that is missing from a search someone runs on their first day reads as a broken
      // product, not as a seed that skipped a column.
      requestCount: links.length,
      failedRequestCount: links.filter((link) => (link.status ?? 0) >= 400)
        .length,
      slowestRequestMs: slowestRequestMs(links),
      hasBackendSpans: fixture.spans.length > 0,
      serviceNames: [
        ...new Set(fixture.spans.map((span) => span.serviceName)),
      ].sort(),
      chunkCount: chunks.length,
      // The fixture is complete by construction, so this is always empty — written anyway rather
      // than left to the default, because the next person to add a chunk to it should see where
      // the answer comes from.
      missingChunkSeqs: missingChunkSeqs(chunks.map((chunk) => chunk.seq)),
      attributes: {
        create: sessionAttributes({
          userId: meta.user?.id ?? null,
          release: meta.release ?? null,
          url: pageviews[0]?.url ?? null,
          userAgent: meta.userAgent ?? null,
          viewport: meta.viewport ?? null,
          paths: pageviews.map((pageview) => pathOf(pageview.url)),
          serviceNames: fixture.spans.map((span) => span.serviceName),
        }).map((fact) => ({
          projectId,
          key: fact.key,
          value: fact.value,
        })),
      },
      errors: {
        create: chunks.flatMap((chunk) =>
          chunk.errors.map((error) => ({
            source: error.source,
            name: error.name ?? null,
            message: error.message,
            fileUrl: error.fileUrl ?? null,
            line: error.line ?? null,
            column: error.column ?? null,
            stack: error.stack ?? null,
            clientMs: BigInt(error.timeMs),
          })),
        ),
      },
      chunks: {
        create: chunks.map((chunk) => ({
          seq: chunk.seq,
          startedAt: chunk.startedAt,
          endedAt: chunk.endedAt,
          eventCount: chunk.eventCount,
          sizeBytes: chunk.bytes.byteLength,
          storageKey: chunk.key,
          consoleErrorCount: chunk.consoleErrorCount,
          consoleWarnCount: chunk.consoleWarnCount,
          ...(chunk.pageviewOrdinal !== undefined
            ? { pageviewOrdinal: chunk.pageviewOrdinal }
            : {}),
        })),
      },
      pageviews: {
        create: pageviews.map((pageview, index) => {
          // A page ends where the next one begins; the last ends with the session. The worker
          // derives this the same way, because only the pages either side of one can say when it
          // ended.
          const startMs = pageview.startMs + baseMs;
          const nextMs = pageviews[index + 1]
            ? (pageviews[index + 1] as { startMs: number }).startMs + baseMs
            : endedMs;

          return {
            ordinal: pageview.ordinal,
            url: pageview.url,
            path: pathOf(pageview.url),
            trigger: pageview.trigger,
            startedAt: new Date(startMs),
            endedAt: new Date(nextMs),
            durationMs: nextMs - startMs,
          };
        }),
      },
      links: {
        create: links.map((link) => ({
          traceId: remap(ids, link.traceId),
          spanId: remap(ids, link.spanId),
          method: link.method,
          url: link.url,
          status: link.status ?? null,
          clientStartMs: BigInt(link.startMs + baseMs),
          clientEndMs: BigInt(link.endMs + baseMs),
        })),
      },
    },
  });

  // Through the span store, not the client: spans are the one table destined to move off Postgres,
  // and the port is what makes that possible.
  await new PostgresSpanStore(prisma).insert(
    fixture.spans.map((span) => {
      const startNs = BigInt(span.startOffsetMs + baseMs) * 1_000_000n;
      const durationNs = BigInt(span.durationMs) * 1_000_000n;
      return {
        traceId: remap(ids, span.traceId),
        spanId: remap(ids, span.spanId),
        ...(span.parentSpanId
          ? { parentSpanId: remap(ids, span.parentSpanId) }
          : {}),
        name: span.name,
        kind: span.kind,
        serviceName: span.serviceName,
        startNs,
        endNs: startNs + durationNs,
        durationNs,
        ...(span.statusCode ? { statusCode: span.statusCode } : {}),
        ...(span.statusMsg ? { statusMsg: span.statusMsg } : {}),
        attributes: span.attributes,
      };
    }),
  );

  return {
    sessionId,
    chunkCount: chunks.length,
    pageCount: pageviews.length,
    requestCount: links.length,
    errorCount: chunks.reduce((total, chunk) => total + chunk.errors.length, 0),
    spanCount: fixture.spans.length,
    durationMs: fixture.durationMs,
  };
}
