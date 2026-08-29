/**
 * OTLP/JSON -> internal span records.
 *
 * This is the only place in Syncline that knows what OpenTelemetry's wire format looks like.
 * Everything downstream sees flat `SpanRecord`s, so a future move to protobuf, or an OTLP schema
 * change, stops here.
 *
 * The input is whatever a customer's collector or SDK emits, which in practice means the format is
 * a range rather than a point. Every field below is parsed defensively: a malformed span is
 * dropped, not thrown, because one bad span in a batch of 500 must not cost the other 499.
 */

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  serviceName: string;
  startNs: bigint;
  endNs: bigint;
  durationNs: bigint;
  statusCode?: string;
  statusMsg?: string;
  attributes: Record<string, unknown>;
}

export interface NormalizeResult {
  spans: SpanRecord[];
  /** Spans that could not be parsed. Surfaced so the worker can log a count rather than guess. */
  dropped: number;
}

/** OTLP SpanKind enum. Index is the wire value. */
const SPAN_KINDS = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'] as const;

/** OTLP StatusCode enum. */
const STATUS_CODES = ['UNSET', 'OK', 'ERROR'] as const;

const HEX_TRACE_ID = /^[0-9a-f]{32}$/i;
const HEX_SPAN_ID = /^[0-9a-f]{16}$/i;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * OTLP/JSON specifies hex for trace and span ids, unlike proto3 JSON's usual base64 for bytes
 * fields. Not every producer follows that, so both are accepted: hex is taken as-is, and anything
 * else is tried as base64. Getting this wrong would not throw — it would quietly produce ids that
 * match nothing, and the symptom would be a replay whose spans never resolve.
 */
export function decodeId(value: unknown, byteLength: 8 | 16): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  const expected = byteLength * 2;
  const pattern = byteLength === 16 ? HEX_TRACE_ID : HEX_SPAN_ID;
  if (value.length === expected && pattern.test(value)) {
    const lower = value.toLowerCase();
    return lower === '0'.repeat(expected) ? null : lower;
  }

  try {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== byteLength) return null;
    const hex = bytes.toString('hex');
    return hex === '0'.repeat(expected) ? null : hex;
  } catch {
    return null;
  }
}

/** Nanosecond timestamps exceed Number.MAX_SAFE_INTEGER, so they arrive as strings — usually. */
function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/** Unwraps OTLP's AnyValue union into a plain JavaScript value. */
export function decodeAnyValue(value: unknown): unknown {
  if (!isObject(value)) return null;

  if ('stringValue' in value) return value['stringValue'];
  if ('boolValue' in value) return value['boolValue'];
  // Ints are strings on the wire for the same reason timestamps are. Values beyond safe-integer
  // range keep their string form rather than being silently rounded.
  if ('intValue' in value) {
    const raw = value['intValue'];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : raw;
    }
    return null;
  }
  if ('doubleValue' in value) return value['doubleValue'];
  if ('bytesValue' in value) return value['bytesValue'];
  if ('arrayValue' in value) {
    const values = asArray((value['arrayValue'] as Json | undefined)?.['values']);
    return values.map(decodeAnyValue);
  }
  if ('kvlistValue' in value) {
    return decodeAttributes((value['kvlistValue'] as Json | undefined)?.['values']);
  }

  return null;
}

export function decodeAttributes(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of asArray(raw)) {
    if (!isObject(entry)) continue;
    const key = entry['key'];
    if (typeof key !== 'string') continue;
    out[key] = decodeAnyValue(entry['value']);
  }
  return out;
}

function decodeKind(value: unknown): string {
  if (typeof value === 'number' && SPAN_KINDS[value]) return SPAN_KINDS[value];
  // Some producers send the enum name, sometimes prefixed the way the proto declares it.
  if (typeof value === 'string') {
    const name = value.replace(/^SPAN_KIND_/, '').toUpperCase();
    if ((SPAN_KINDS as readonly string[]).includes(name)) return name;
  }
  return 'INTERNAL';
}

function decodeStatus(raw: unknown): { code?: string; message?: string } {
  if (!isObject(raw)) return {};

  const rawCode = raw['code'];
  let code: string | undefined;
  if (typeof rawCode === 'number' && STATUS_CODES[rawCode]) code = STATUS_CODES[rawCode];
  if (typeof rawCode === 'string') {
    const name = rawCode.replace(/^STATUS_CODE_/, '').toUpperCase();
    if ((STATUS_CODES as readonly string[]).includes(name)) code = name;
  }

  const message = typeof raw['message'] === 'string' ? raw['message'] : undefined;
  return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/**
 * Walks an ExportTraceServiceRequest into flat span records.
 *
 * `service.name` comes from the resource, which is where OpenTelemetry puts it — it is not on the
 * span, and a span without one is far less useful in a viewer, so it falls back to "unknown"
 * rather than being dropped.
 */
export function normalizeOtlp(payload: unknown): NormalizeResult {
  const spans: SpanRecord[] = [];
  let dropped = 0;

  if (!isObject(payload)) return { spans, dropped };

  for (const resourceSpan of asArray(payload['resourceSpans'])) {
    if (!isObject(resourceSpan)) continue;

    const resource = isObject(resourceSpan['resource']) ? resourceSpan['resource'] : {};
    const resourceAttributes = decodeAttributes(resource['attributes']);
    const serviceName =
      typeof resourceAttributes['service.name'] === 'string'
        ? resourceAttributes['service.name']
        : 'unknown';

    // `scopeSpans` is current; `instrumentationLibrarySpans` is the pre-1.0 name, still emitted by
    // older collectors sitting in front of newer applications.
    const scopeSpans = [
      ...asArray(resourceSpan['scopeSpans']),
      ...asArray(resourceSpan['instrumentationLibrarySpans']),
    ];

    for (const scopeSpan of scopeSpans) {
      if (!isObject(scopeSpan)) continue;

      for (const raw of asArray(scopeSpan['spans'])) {
        const span = toSpanRecord(raw, serviceName);
        if (span) spans.push(span);
        else dropped++;
      }
    }
  }

  return { spans, dropped };
}

function toSpanRecord(raw: unknown, serviceName: string): SpanRecord | null {
  if (!isObject(raw)) return null;

  const traceId = decodeId(raw['traceId'] ?? raw['trace_id'], 16);
  const spanId = decodeId(raw['spanId'] ?? raw['span_id'], 8);
  if (!traceId || !spanId) return null;

  const startNs = toBigInt(raw['startTimeUnixNano'] ?? raw['start_time_unix_nano']);
  const endNs = toBigInt(raw['endTimeUnixNano'] ?? raw['end_time_unix_nano']);
  if (startNs === null || endNs === null) return null;

  const parentSpanId = decodeId(raw['parentSpanId'] ?? raw['parent_span_id'], 8);
  const status = decodeStatus(raw['status']);

  return {
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name: typeof raw['name'] === 'string' ? raw['name'] : '(unnamed)',
    kind: decodeKind(raw['kind']),
    serviceName,
    startNs,
    endNs,
    // A span that ends before it starts is a clock artifact, not a negative duration. Clamping
    // keeps it from rendering as a bar extending backwards across the timeline.
    durationNs: endNs > startNs ? endNs - startNs : 0n,
    ...(status.code ? { statusCode: status.code } : {}),
    ...(status.message ? { statusMsg: status.message } : {}),
    attributes: decodeAttributes(raw['attributes']),
  };
}
