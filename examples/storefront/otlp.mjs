import { randomBytes } from 'node:crypto';

/**
 * A minimal OTLP/HTTP JSON tracer, written by hand and on purpose.
 *
 * A real service should use the OpenTelemetry SDK — set OTEL_EXPORTER_OTLP_ENDPOINT to Syncline's
 * ingest URL and instrument nothing else. This example does not, for two reasons: it stays
 * dependency-free, so `node server.mjs` is the whole install story, and the payload it builds is
 * the clearest documentation of what Syncline actually accepts. If a hand-written exporter this
 * small stitches correctly, so will yours.
 *
 * Everything here is the standard wire format, not a Syncline dialect: ExportTraceServiceRequest
 * with hex trace ids, nanosecond timestamps as strings, and `service.name` on the resource.
 */

/**
 * Nanoseconds since the epoch, from a monotonic source.
 *
 * `Date.now()` alone would be milliseconds and would jump if the host's clock were corrected
 * mid-request, which is exactly the kind of skew Syncline exists to make visible — no reason to
 * introduce it here.
 */
const EPOCH_ANCHOR_NS =
  BigInt(Date.now()) * 1_000_000n - process.hrtime.bigint();

export function nowNs() {
  return EPOCH_ANCHOR_NS + process.hrtime.bigint();
}

export function randomHex(bytes) {
  return randomBytes(bytes).toString('hex');
}

/**
 * Reads the header the browser SDK injected.
 *
 * This is the whole stitch. The trace id continues the one minted in the page, and the span id
 * becomes this server span's parent — which is what lets the viewer put a backend span underneath
 * the request bar that caused it. Ignore this header and the two halves of the timeline never meet.
 */
export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;

  const parts = header.trim().split('-');
  if (parts.length < 4) return null;

  const [version, traceId, spanId, flags] = parts;
  if (!/^[0-9a-f]{2}$/.test(version) || version === 'ff') return null;
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(spanId) || /^0+$/.test(spanId)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

const KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3 };
const STATUS = { UNSET: 0, OK: 1, ERROR: 2 };

function attributeList(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (typeof value === 'number') {
        return Number.isInteger(value)
          ? { key, value: { intValue: String(value) } }
          : { key, value: { doubleValue: value } };
      }
      if (typeof value === 'boolean')
        return { key, value: { boolValue: value } };
      return { key, value: { stringValue: String(value) } };
    });
}

/**
 * One request's worth of spans, exported together when the request ends.
 *
 * Batching per request rather than per span is what a real exporter does too, and it means a failed
 * export loses a whole trace instead of half of one — a trace missing its root is harder to read
 * than no trace at all.
 */
class Trace {
  constructor(exporter, traceId, parentSpanId, name, attributes) {
    this.exporter = exporter;
    this.traceId = traceId;
    this.spans = [];
    this.root = {
      spanId: randomHex(8),
      parentSpanId,
      name,
      kind: KIND.SERVER,
      startNs: nowNs(),
      attributes,
    };
  }

  /** A child span. Returns a handle whose `end` is the only thing the caller has to remember. */
  child(name, attributes = {}, kind = 'INTERNAL') {
    const span = {
      spanId: randomHex(8),
      parentSpanId: this.root.spanId,
      name,
      kind: KIND[kind] ?? KIND.INTERNAL,
      startNs: nowNs(),
      attributes,
    };
    this.spans.push(span);

    return {
      end: (status = 'OK', message) => {
        span.endNs = nowNs();
        span.status = STATUS[status] ?? STATUS.UNSET;
        span.statusMessage = message;
      },
    };
  }

  /** Ends the root span and exports. Never throws: a tracing failure must not fail the request. */
  async end(httpStatus, status = 'OK', message) {
    this.root.endNs = nowNs();
    this.root.status = STATUS[status] ?? STATUS.UNSET;
    this.root.statusMessage = message;
    this.root.attributes['http.response.status_code'] = httpStatus;

    // Unfinished children would export with no end time and be dropped by the normalizer, which
    // looks like a missing span rather than a bug in this file.
    const finished = [this.root, ...this.spans].filter((span) => span.endNs);
    await this.exporter.send(this.traceId, finished);
  }
}

export class Tracer {
  constructor({ endpoint, secretKey, serviceName }) {
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.secretKey = secretKey;
    this.serviceName = serviceName;
    this.warned = false;
  }

  /** Starts a server span for an incoming request, continuing the browser's trace when present. */
  begin(req, name, attributes = {}) {
    const parent = parseTraceparent(req.headers['traceparent']);

    return new Trace(
      this,
      parent?.traceId ?? randomHex(16),
      parent?.spanId,
      name,
      {
        'http.request.method': req.method,
        'url.path': (req.url ?? '').split('?')[0],
        // Recorded so the viewer can show which requests arrived stitched and which arrived cold.
        'syncline.example.continued_trace': parent !== null,
        ...attributes,
      },
    );
  }

  async send(traceId, spans) {
    if (!this.secretKey) {
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
              'service.name': this.serviceName,
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
                endTimeUnixNano: span.endNs.toString(),
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
      // `/v1/ingest/v1/traces` is what an OTel exporter would produce from
      // OTEL_EXPORTER_OTLP_ENDPOINT=<endpoint>/v1/ingest — the same URL, spelled out.
      const response = await fetch(`${this.endpoint}/v1/ingest/v1/traces`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-syncline-key': this.secretKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.warnOnce(
          `ingest refused the spans with HTTP ${response.status}. A 401 means the secret key is wrong; a 404 means the endpoint is not a Syncline API.`,
        );
      }
    } catch (error) {
      this.warnOnce(
        `could not reach ${this.endpoint} to export spans (${error.message}). Is the API running?`,
      );
    }
  }

  /** Once, not once per request: a down collector should not become the loudest thing in the log. */
  warnOnce(message) {
    if (this.warned) return;
    this.warned = true;
    console.warn(`  ! tracing: ${message}`);
  }
}
