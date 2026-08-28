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
  /** Where to fetch it. May be a presigned URL pointing straight at object storage. */
  url: string;
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
}

export type SpanStatus = 'UNSET' | 'OK' | 'ERROR';

export type SpanKind = 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';

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
