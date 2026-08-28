/**
 * The rrweb custom events that carry trace IDs inside the replay stream.
 *
 * These are what make a recording self-describing: the trace ID sits at the exact frame the
 * request fired, so an exported session still resolves to its traces without a side table.
 * See docs/ARCHITECTURE.md §3.2.
 */

import { z } from 'zod';

/** rrweb's EventType.Custom. Hard-coded so protocol does not depend on rrweb. */
export const RRWEB_CUSTOM_EVENT_TYPE = 5;

export const REQUEST_START = 'syncline.request' as const;
export const REQUEST_END = 'syncline.response' as const;

/**
 * Start and end are separate events because rrweb's log is append-only — the SDK cannot reach back
 * and stamp a duration onto an event it has already emitted. They correlate by `spanId`.
 */
export const requestStartPayloadSchema = z.object({
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  spanId: z.string().regex(/^[0-9a-f]{16}$/),
  method: z.string().min(1).max(16),
  /** Origin + pathname + sanitized search. Query values are stripped by the SDK, keys kept. */
  url: z.string().max(2048),
  startMs: z.number().int().nonnegative(),
});

export const requestEndPayloadSchema = z.object({
  spanId: z.string().regex(/^[0-9a-f]{16}$/),
  endMs: z.number().int().nonnegative(),
  /** Absent when the request failed before producing a response. */
  status: z.number().int().min(100).max(599).optional(),
  error: z.string().max(256).optional(),
});

export type RequestStartPayload = z.infer<typeof requestStartPayloadSchema>;
export type RequestEndPayload = z.infer<typeof requestEndPayloadSchema>;

export type SynclineEventTag = typeof REQUEST_START | typeof REQUEST_END;

/** The shape rrweb wraps a custom event in. */
export interface RrwebCustomEvent<Tag extends string, Payload> {
  type: typeof RRWEB_CUSTOM_EVENT_TYPE;
  timestamp: number;
  data: { tag: Tag; payload: Payload };
}

export type RequestStartEvent = RrwebCustomEvent<typeof REQUEST_START, RequestStartPayload>;
export type RequestEndEvent = RrwebCustomEvent<typeof REQUEST_END, RequestEndPayload>;
export type SynclineEvent = RequestStartEvent | RequestEndEvent;

/**
 * Narrows an arbitrary rrweb event to one of ours.
 *
 * Deliberately structural rather than schema-validating: this runs while scanning thousands of
 * events, and the payloads are validated once at the ingest boundary instead.
 */
export function isSynclineEvent(event: unknown): event is SynclineEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as { type?: unknown; data?: { tag?: unknown } };
  if (e.type !== RRWEB_CUSTOM_EVENT_TYPE) return false;
  const tag = e.data?.tag;
  return tag === REQUEST_START || tag === REQUEST_END;
}
