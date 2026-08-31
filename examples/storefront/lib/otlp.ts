import { randomBytes } from 'node:crypto';

/**
 * A minimal OTLP/HTTP JSON tracer, written by hand and on purpose.
 *
 * A real service should not do this: set `OTEL_EXPORTER_OTLP_ENDPOINT` to Syncline's ingest URL and
 * let the OpenTelemetry SDK handle the wire format. It is hand-written here for two reasons — the
 * example stays installable with nothing but the workspace's own dependencies, and the payload
 * Syncline accepts ends up legible in one readable file. If an exporter this small stitches
 * correctly, so will yours.
 *
 * Nothing below is a Syncline dialect. It is standard ExportTraceServiceRequest: hex trace ids,
 * nanosecond timestamps as strings, `service.name` on the resource.
 */

/**
 * Nanoseconds since the epoch, from a monotonic source.
 *
 * `Date.now()` alone is milliseconds and jumps if the host's clock is corrected mid-request — which
 * is precisely the skew Syncline exists to make visible, so there is no reason to introduce it here.
 */
const EPOCH_ANCHOR_NS =
  BigInt(Date.now()) * 1_000_000n - process.hrtime.bigint();

export function nowNs(): bigint {
  return EPOCH_ANCHOR_NS + process.hrtime.bigint();
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export interface TraceParent {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

/**
 * Reads the header the browser SDK injected.
 *
 * This is the whole stitch. The trace id continues the one minted in the page, and the span id
 * becomes this server span's parent — which is what lets the viewer draw a backend span underneath
 * the request bar that caused it. Ignore this header and the two halves of the timeline never meet.
 */
export function parseTraceparent(
  header: string | null | undefined,
): TraceParent | null {
  if (typeof header !== 'string') return null;

  const parts = header.trim().split('-');
  if (parts.length < 4) return null;

  const [version, traceId, spanId, flags] = parts;
  if (!version || !traceId || !spanId || !flags) return null;
  if (!/^[0-9a-f]{2}$/.test(version) || version === 'ff') return null;
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(spanId) || /^0+$/.test(spanId)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

const KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3 } as const;
const STATUS = { UNSET: 0, OK: 1, ERROR: 2 } as const;

export type SpanKindName = keyof typeof KIND;
export type SpanStatusName = keyof typeof STATUS;

type AttributeValue = string | number | boolean | undefined | null;
export type Attributes = Record<string, AttributeValue>;

function attributeList(attributes: Attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (typeof value === 'number') {
        return Number.isInteger(value)
          ? { key, value: { intValue: String(value) } }
          : { key, value: { doubleValue: value } };
      }
      if (typeof value === 'boolean') {
        return { key, value: { boolValue: value } };
      }
      return { key, value: { stringValue: String(value) } };
    });
}

interface PendingSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startNs: bigint;
  endNs?: bigint;
  status?: number;
  statusMessage?: string;
  attributes: Attributes;
}

export interface SpanHandle {
  end(status?: SpanStatusName, message?: string): void;
}

/**
 * One request's worth of spans, exported together when the request ends.
 *
 * Batching per request is what a real exporter does too, and it means a failed export loses a whole
 * trace rather than half of one — a trace missing its root is harder to read than no trace at all.
 */
export class Trace {
  private readonly spans: PendingSpan[] = [];
  private readonly root: PendingSpan;

  constructor(
    private readonly tracer: Tracer,
    readonly traceId: string,
    parentSpanId: string | undefined,
    name: string,
    attributes: Attributes,
  ) {
    this.root = {
      spanId: randomHex(8),
      ...(parentSpanId ? { parentSpanId } : {}),
      name,
      kind: KIND.SERVER,
      startNs: nowNs(),
      attributes,
    };
  }

  /** A child span. Returns a handle whose `end` is the only thing the caller has to remember. */
  child(
    name: string,
    attributes: Attributes = {},
    kind: SpanKindName = 'INTERNAL',
  ): SpanHandle {
    const span: PendingSpan = {
      spanId: randomHex(8),
      parentSpanId: this.root.spanId,
      name,
      kind: KIND[kind],
      startNs: nowNs(),
      attributes,
    };
    this.spans.push(span);

    return {
      end: (status: SpanStatusName = 'OK', message?: string) => {
        span.endNs = nowNs();
        span.status = STATUS[status];
        if (message) span.statusMessage = message;
      },
    };
  }

  /** Ends the root span and exports. Never throws: a tracing failure must not fail the request. */
  async end(
    httpStatus: number,
    status: SpanStatusName = 'OK',
    message?: string,
  ): Promise<void> {
    this.root.endNs = nowNs();
    this.root.status = STATUS[status];
    if (message) this.root.statusMessage = message;
    this.root.attributes['http.response.status_code'] = httpStatus;

    // Unfinished children would export without an end time and be dropped by the normalizer, which
    // reads as a missing span rather than as a bug in this file.
    const finished = [this.root, ...this.spans].filter((span) => span.endNs);
    await this.tracer.send(this.traceId, finished);
  }
}

export class Tracer {
  private readonly endpoint: string;
  private warned = false;

  constructor(
    private readonly config: {
      endpoint: string;
      secretKey: string;
      serviceName: string;
    },
  ) {
    this.endpoint = config.endpoint.replace(/\/+$/, '');
  }

  /** Starts a server span for an incoming request, continuing the browser's trace when present. */
  begin(request: Request, name: string, attributes: Attributes = {}): Trace {
    const parent = parseTraceparent(request.headers.get('traceparent'));

    return new Trace(
      this,
      parent?.traceId ?? randomHex(16),
      parent?.spanId,
      name,
      {
        'http.request.method': request.method,
        'url.path': new URL(request.url).pathname,
        // Recorded so the viewer can tell a stitched request from one that arrived cold.
        'syncline.example.continued_trace': parent !== null,
        ...attributes,
      },
    );
  }

  async send(traceId: string, spans: PendingSpan[]): Promise<void> {
    if (!this.config.secretKey) {
      this.warnOnce(
        'no SYNCLINE_SECRET_KEY, so backend spans are not being exported',
      );
      return;
    }

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: attributeList({
              'service.name': this.config.serviceName,
              'deployment.environment.name': 'example',
            }),
          },
          scopeSpans: [
            {
              scope: { name: 'syncline-example', version: '1.0.0' },
              spans: spans.map((span) => ({
                traceId,
                spanId: span.spanId,
                ...(span.parentSpanId
                  ? { parentSpanId: span.parentSpanId }
                  : {}),
                name: span.name,
                kind: span.kind,
                startTimeUnixNano: span.startNs.toString(),
                endTimeUnixNano: span.endNs?.toString(),
                attributes: attributeList(span.attributes),
                status: {
                  code: span.status ?? STATUS.UNSET,
                  ...(span.statusMessage
                    ? { message: span.statusMessage }
                    : {}),
                },
              })),
            },
          ],
        },
      ],
    };

    try {
      // `/v1/ingest/v1/traces` is the URL an OTel exporter would build from
      // OTEL_EXPORTER_OTLP_ENDPOINT=<endpoint>/v1/ingest — the same path, spelled out.
      const response = await fetch(`${this.endpoint}/v1/ingest/v1/traces`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-syncline-key': this.config.secretKey,
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      if (!response.ok) {
        this.warnOnce(
          `ingest refused the spans with HTTP ${response.status}. A 401 means the secret key is wrong; a 404 means the endpoint is not a Syncline API.`,
        );
      }
    } catch (error) {
      this.warnOnce(
        `could not reach ${this.endpoint} to export spans (${(error as Error).message}). Is the API running?`,
      );
    }
  }

  /** Once, not once per request: a down collector should not become the loudest thing in the log. */
  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[syncline example] tracing: ${message}`);
  }
}
