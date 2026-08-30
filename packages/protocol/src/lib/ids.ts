/**
 * W3C Trace Context identifiers.
 *
 * The browser SDK mints these, the customer's OpenTelemetry instrumentation continues them, and
 * everything downstream joins on them. See docs/ARCHITECTURE.md §3.1.
 */

export const TRACE_ID_LENGTH = 32;
export const SPAN_ID_LENGTH = 16;

/** All-zero IDs are explicitly invalid per the spec, and are what a broken generator produces. */
export const INVALID_TRACE_ID = '0'.repeat(TRACE_ID_LENGTH);
export const INVALID_SPAN_ID = '0'.repeat(SPAN_ID_LENGTH);

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;

export const TRACEPARENT_HEADER = 'traceparent';

/** The only version we emit, and the only one whose layout we can assume. */
export const TRACEPARENT_VERSION = '00';

const FLAG_SAMPLED = 0x01;

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function newTraceId(): string {
  return randomHex(16);
}

export function newSpanId(): string {
  return randomHex(8);
}

export function isTraceId(value: string): boolean {
  return TRACE_ID_RE.test(value) && value !== INVALID_TRACE_ID;
}

export function isSpanId(value: string): boolean {
  return SPAN_ID_RE.test(value) && value !== INVALID_SPAN_ID;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

export function formatTraceparent(ctx: TraceContext): string {
  const flags = (ctx.sampled ? FLAG_SAMPLED : 0).toString(16).padStart(2, '0');
  return `${TRACEPARENT_VERSION}-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Returns null for anything we cannot safely act on.
 *
 * Future spec versions may append fields, so a longer header with a known-good prefix is parsed
 * rather than rejected — that is what the spec asks implementations to do. A `version` of `ff` is
 * invalid, as are malformed or all-zero IDs.
 */
export function parseTraceparent(
  header: string,
): (TraceContext & { version: string }) | null {
  const parts = header.trim().split('-');
  if (parts.length < 4) return null;

  const [version, traceId, spanId, flags] = parts;
  if (!/^[0-9a-f]{2}$/.test(version) || version === 'ff') return null;
  if (version === TRACEPARENT_VERSION && parts.length !== 4) return null;
  if (!isTraceId(traceId) || !isSpanId(spanId)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  return {
    version,
    traceId,
    spanId,
    sampled: (parseInt(flags, 16) & FLAG_SAMPLED) === FLAG_SAMPLED,
  };
}
