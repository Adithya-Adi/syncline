/**
 * Queue contracts between apps/api (producer) and apps/worker (consumer).
 *
 * Payloads carry storage keys, never bodies. Redis is a queue, not a blob store — see
 * docs/ARCHITECTURE.md §2 and §5.
 */

export const SESSION_CHUNK_QUEUE = 'session-chunk';
export const OTLP_TRACES_QUEUE = 'otlp-traces';

export interface SessionChunkJob {
  projectId: string;
  sessionId: string;
  seq: number;
  /** Object storage key of the gzipped body the API streamed in. */
  storageKey: string;
  /** When the API accepted it, for measuring end-to-end ingest lag. */
  receivedMs: number;
}

export interface OtlpTracesJob {
  projectId: string;
  storageKey: string;
  receivedMs: number;
}

/**
 * Both jobs are idempotent — `SessionChunk` is unique on `(sessionId, seq)` and `Span` on
 * `(traceId, spanId)` — so a retry upserts rather than duplicating.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: false,
};

export function sessionChunkKey(
  projectId: string,
  sessionId: string,
  seq: number,
): string {
  return `sessions/${projectId}/${sessionId}/${seq}.json.gz`;
}

export function otlpKey(projectId: string, day: string, id: string): string {
  return `otlp/${projectId}/${day}/${id}.json.gz`;
}
