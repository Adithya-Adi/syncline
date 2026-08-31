/**
 * The API -> viewer contract. See docs/ARCHITECTURE.md §7.
 *
 * These are plain types rather than zod schemas: the server authors this data, so validating it on
 * arrival would only be checking our own work. The ingest boundary is where validation earns its
 * keep.
 *
 * All timestamps here are epoch **milliseconds in client time**, already skew-corrected by the
 * server. The viewer does no arithmetic — it has one clock and draws against it.
 */

import type { ClockCalibration, SessionMeta } from './ingest.js';

export interface ChunkIndexEntry {
  seq: number;
  startedMs: number;
  endedMs: number;
  eventCount: number;
  sizeBytes: number;
  /**
   * Which page's events these are.
   *
   * Chunks flush at page boundaries, so a chunk belongs to exactly one page — which is what lets a
   * viewer fetch one page of a long session instead of all of it. Absent for recordings made by an
   * SDK that predates pageviews.
   */
  pageviewOrdinal?: number;
  /** Where to fetch it. May be a presigned URL pointing straight at object storage. */
  url: string;
}

/**
 * One step in the session's flow.
 *
 * The flow is the readable spine of a recording: which pages, in which order, for how long. Ordered
 * by `ordinal`, which the SDK assigned — not by arrival, which a lossy connection reshuffles.
 */
export interface SessionPageview {
  ordinal: number;
  url: string;
  /** Pathname, or the hash route for a hash router. Split out so it can be filtered on. */
  path: string;
  /** load, pushState, replaceState, popstate, hashchange. */
  trigger: string;
  startedMs: number;
  /** Absent only while a page is the one still being recorded. */
  endedMs?: number;
  durationMs?: number;
}

export interface SessionLink {
  traceId: string;
  spanId: string;
  method: string;
  url: string;
  status?: number;
  startMs: number;
  endMs: number;
}

export interface SessionResponse {
  id: string;
  startedMs: number;
  endedMs?: number;
  durationMs?: number;
  clock: ClockCalibration;
  meta: SessionMeta;
  /**
   * Gaps in `seq` mean a chunk never arrived. The viewer marks the discontinuity rather than
   * playing across it as if nothing happened.
   */
  chunks: ChunkIndexEntry[];
  links: SessionLink[];
  /** The flow, in order. Empty for a recording made before pageviews existed. */
  pageviews: SessionPageview[];
}

export type SpanStatus = 'UNSET' | 'OK' | 'ERROR';

export type SpanKind =
  'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';

export interface ViewerSpan {
  spanId: string;
  parentSpanId?: string;
  /** Depth in the trace tree, precomputed so the viewer can indent without walking parents. */
  depth: number;
  name: string;
  serviceName: string;
  kind: SpanKind;
  startClientMs: number;
  endClientMs: number;
  durationMs: number;
  status: SpanStatus;
  statusMessage?: string;
  attributes: Record<string, unknown>;
}

export interface TraceResponse {
  traceId: string;
  /** Depth-first, parents before children — draw order for the lane. */
  spans: ViewerSpan[];
  /**
   * Half the round-trip time of the session's clock calibration. Above the threshold in
   * `limits.ts` the viewer draws this as a band around each span rather than a hard edge.
   */
  uncertaintyMs: number;
}

/** True for spans the database lane should render. */
export function isDatabaseSpan(span: ViewerSpan): boolean {
  return typeof span.attributes['db.system'] === 'string';
}

/**
 * A row in the recordings list.
 *
 * Deliberately not a trimmed `SessionResponse`: a list wants counts and a reason to click, while a
 * single session wants chunks and links. Sharing one type would make both worse.
 */
export interface SessionSummary {
  id: string;
  startedMs: number;
  durationMs: number;
  url?: string;
  userId?: string;
  release?: string;
  chunkCount: number;
  linkCount: number;
  /** Requests the browser saw fail. The reason to open one recording rather than another. */
  errorCount: number;
  /** How many pages the session visited, and where it came in. The flow at a glance. */
  pageCount: number;
  entryPath?: string;
  /**
   * Short, and with nothing in it. Hidden by default in a list, never deleted, and never true for a
   * recording that saw a failure.
   */
  trivial: boolean;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
  /** Pass back as `before` to page further. Absent when the end has been reached. */
  nextCursor?: string;
}
