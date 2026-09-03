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
 *
 * Finished jobs are capped hard, on both outcomes. Redis here is a queue running with eviction
 * switched off — it has to be, because an evicting Redis drops queue keys silently and BullMQ
 * never learns the job existed — and the consequence of that choice is that a full Redis refuses
 * writes and stops ingest. So nothing finished is allowed to accumulate: the queue's size must
 * track work in flight, not work that has already happened.
 *
 * Failures used to be kept forever, which was the dangerous half. A systematic fault — the object
 * store unreachable, a bad deploy — fails every chunk arriving, and each one exhausts its attempts
 * and then stays. That turns an outage into a second, longer outage once Redis fills.
 *
 * Losing failure history costs less than it appears to. The body is already in object storage
 * under a key derived from ids the job carried, so a chunk whose job record has aged out is
 * reprocessable from the object itself; what is lost is the record of the attempt, not the data.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 3_600, count: 100 },
  removeOnFail: { count: 100 },
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
