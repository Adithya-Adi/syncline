import {
  CLOCK_UNCERTAINTY_THRESHOLD_MS,
  sessionIdSchema,
  type ErrorSource,
  type SessionResponse,
  type TraceResponse,
} from '@syncline/protocol';
import { buildSpanTree, PostgresSpanStore } from '@syncline/models';
import { ObjectStore } from '@syncline/storage';
import { db } from './db';
import type { Viewer } from './session';

/**
 * Recording data, scoped to the viewer's organization.
 *
 * This exists because the viewer used to fetch straight from the ingest API, where the read
 * endpoints were protected by nothing but session ids being unguessable. Anyone holding an id
 * could watch that recording whether or not they were signed in, so locking the dashboard down
 * achieved nothing — the data path went around it.
 *
 * Every function here takes a `Viewer` and scopes its query through
 * `project.organizationId`. A recording belonging to someone else is not "forbidden", it is simply
 * not found: a 403 would confirm the recording exists.
 */

let store: ObjectStore | undefined;

function objectStore(): ObjectStore {
  if (!store) {
    store = new ObjectStore({
      endpoint: required('S3_ENDPOINT'),
      region: process.env['S3_REGION'] ?? 'us-east-1',
      bucket: required('S3_BUCKET'),
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    });
  }
  return store;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env.`);
  return value;
}

export async function recordingForViewer(
  viewer: Viewer,
  sessionId: string,
): Promise<SessionResponse | null> {
  if (!sessionIdSchema.safeParse(sessionId).success) return null;

  const session = await db.session.findFirst({
    where: {
      id: sessionId,
      project: { organizationId: viewer.organizationId },
    },
    include: {
      chunks: { orderBy: { seq: 'asc' } },
      links: { orderBy: { clientStartMs: 'asc' } },
      pageviews: { orderBy: { ordinal: 'asc' } },
      errors: { orderBy: { clientMs: 'asc' } },
    },
  });

  if (!session) return null;

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
      ...(session.viewport
        ? { viewport: session.viewport as { w: number; h: number } }
        : {}),
    },
    chunks: session.chunks.map((chunk) => ({
      seq: chunk.seq,
      startedMs: chunk.startedAt.getTime(),
      endedMs: chunk.endedAt.getTime(),
      eventCount: chunk.eventCount,
      sizeBytes: chunk.sizeBytes,
      ...(chunk.pageviewOrdinal !== null
        ? { pageviewOrdinal: chunk.pageviewOrdinal }
        : {}),
      // Points back through this app, not at the ingest API.
      url: `/api/recordings/${session.id}/chunks/${chunk.seq}`,
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
    pageviews: session.pageviews.map((pageview) => ({
      ordinal: pageview.ordinal,
      url: pageview.url,
      path: pageview.path,
      trigger: pageview.trigger,
      startedMs: pageview.startedAt.getTime(),
      ...(pageview.endedAt ? { endedMs: pageview.endedAt.getTime() } : {}),
      ...(pageview.durationMs !== null
        ? { durationMs: pageview.durationMs }
        : {}),
    })),
    // The source column is a plain string in Postgres — the enum lives in the protocol, and the
    // ingest schema is what enforces it. Nothing else can have written this row.
    errors: session.errors.map((error) => ({
      source: error.source as ErrorSource,
      ...(error.name ? { name: error.name } : {}),
      message: error.message,
      ...(error.fileUrl ? { fileUrl: error.fileUrl } : {}),
      ...(error.line !== null ? { line: error.line } : {}),
      ...(error.column !== null ? { column: error.column } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
      atMs: Number(error.clientMs),
    })),
  };
}

export async function chunkForViewer(
  viewer: Viewer,
  sessionId: string,
  seq: number,
): Promise<Buffer | null> {
  if (!Number.isInteger(seq) || seq < 0) return null;

  const chunk = await db.sessionChunk.findFirst({
    where: {
      seq,
      sessionId,
      session: { project: { organizationId: viewer.organizationId } },
    },
    select: { storageKey: true },
  });

  if (!chunk) return null;

  return objectStore().get(chunk.storageKey);
}

/**
 * A trace is reachable only through a recording the viewer can already see.
 *
 * Trace ids are 128 bits of randomness, but that is not what makes this safe — the membership
 * check is. Without it, a trace id lifted from an error alert would read another organization's
 * spans out of a shared table.
 */
export async function traceForViewer(
  viewer: Viewer,
  traceId: string,
): Promise<TraceResponse | null> {
  if (!/^[0-9a-f]{32}$/.test(traceId)) return null;

  const link = await db.requestLink.findFirst({
    where: {
      traceId,
      session: { project: { organizationId: viewer.organizationId } },
    },
    select: { session: { select: { clockOffsetMs: true, rttMs: true } } },
  });

  if (!link) return null;

  const spans = await new PostgresSpanStore(db).byTrace(traceId);
  if (spans.length === 0) return null;

  return {
    traceId,
    spans: buildSpanTree(spans, link.session.clockOffsetMs),
    uncertaintyMs:
      link.session.rttMs >= CLOCK_UNCERTAINTY_THRESHOLD_MS
        ? Math.round(link.session.rttMs / 2)
        : 0,
  };
}
