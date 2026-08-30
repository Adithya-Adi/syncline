/**
 * The browser -> API wire contract. See docs/ARCHITECTURE.md §4.
 *
 * Every schema here validates attacker-controlled input, so each one is the boundary where a
 * hostile payload stops. Objects strip unknown keys rather than rejecting them: an older server
 * must keep accepting chunks from a newer SDK that added a field.
 */

import { z } from 'zod';
import {
  MAX_EVENTS_PER_CHUNK,
  MAX_LINKS_PER_CHUNK,
  MAX_CHUNKS_PER_SESSION,
} from './limits.js';

const traceId = z.string().regex(/^[0-9a-f]{32}$/);
const spanId = z.string().regex(/^[0-9a-f]{16}$/);

/** Crockford base32, 26 chars — a ULID. Minted client-side so the SDK can label chunks offline. */
export const sessionIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

export const clockCalibrationSchema = z.object({
  /** serverMs - clientMs. Added to client time to reach server time; subtracted to come back. */
  offsetMs: z.number().int(),
  rttMs: z.number().int().nonnegative(),
});

export const viewportSchema = z.object({
  w: z.number().int().positive().max(20_000),
  h: z.number().int().positive().max(20_000),
});

/** Sent once, on `seq: 0`. */
export const sessionMetaSchema = z.object({
  url: z.string().max(2048).optional(),
  userAgent: z.string().max(512).optional(),
  viewport: viewportSchema.optional(),
  user: z.object({ id: z.string().max(128) }).optional(),
  release: z.string().max(128).optional(),
});

/**
 * A completed request, denormalized out of the rrweb stream by the SDK.
 *
 * This duplicates what is already inside `events`, on purpose: without it the worker would have to
 * decompress and walk the whole event array before it could index anything. See §4.
 */
export const requestLinkSchema = z.object({
  traceId,
  spanId,
  method: z.string().min(1).max(16),
  url: z.string().max(2048),
  status: z.number().int().min(100).max(599).optional(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});

export const sessionChunkSchema = z.object({
  sessionId: sessionIdSchema,
  seq: z.number().int().nonnegative().max(MAX_CHUNKS_PER_SESSION),
  sdk: z.object({
    name: z.string().max(64),
    version: z.string().max(32),
  }),
  clock: clockCalibrationSchema,
  meta: sessionMetaSchema.optional(),
  /**
   * Raw rrweb events, passed through untouched. Protocol deliberately does not model rrweb's
   * internal event shapes — that is rrweb's contract to keep, not ours to mirror.
   */
  events: z.array(z.unknown()).max(MAX_EVENTS_PER_CHUNK),
  links: z.array(requestLinkSchema).max(MAX_LINKS_PER_CHUNK).default([]),
});

export const clockResponseSchema = z.object({
  serverMs: z.number().int().nonnegative(),
});

export type ClockCalibration = z.infer<typeof clockCalibrationSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type SessionMeta = z.infer<typeof sessionMetaSchema>;
export type RequestLink = z.infer<typeof requestLinkSchema>;
export type SessionChunk = z.infer<typeof sessionChunkSchema>;
export type ClockResponse = z.infer<typeof clockResponseSchema>;

/** Error bodies are uniform so the SDK can decide whether a retry is pointless. */
export interface IngestError {
  error: string;
  /** False for 4xx that will fail identically on retry, so the SDK drops the chunk. */
  retryable: boolean;
}
