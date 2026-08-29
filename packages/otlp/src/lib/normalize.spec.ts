import { describe, expect, it } from 'vitest';
import { decodeAnyValue, decodeAttributes, decodeId, normalizeOtlp } from './normalize.js';

const TRACE_HEX = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_HEX = '00f067aa0ba902b7';

function payload(span: Record<string, unknown>, serviceName = 'api') {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
        },
        scopeSpans: [{ spans: [span] }],
      },
    ],
  };
}

const VALID_SPAN = {
  traceId: TRACE_HEX,
  spanId: SPAN_HEX,
  name: 'POST /api/checkout',
  kind: 2,
  startTimeUnixNano: '1724832000131000000',
  endTimeUnixNano: '1724832001880000000',
  status: { code: 2, message: 'internal error' },
  attributes: [{ key: 'http.status_code', value: { intValue: '500' } }],
};

describe('decodeId', () => {
  it('accepts hex, which is what OTLP/JSON actually specifies', () => {
    expect(decodeId(TRACE_HEX, 16)).toBe(TRACE_HEX);
    expect(decodeId(SPAN_HEX, 8)).toBe(SPAN_HEX);
  });

  it('accepts base64, because not every producer follows the spec', () => {
    const base64 = Buffer.from(TRACE_HEX, 'hex').toString('base64');
    expect(decodeId(base64, 16)).toBe(TRACE_HEX);
  });

  it('normalizes uppercase hex', () => {
    expect(decodeId(TRACE_HEX.toUpperCase(), 16)).toBe(TRACE_HEX);
  });

  it('rejects all-zero ids, which the spec calls invalid', () => {
    expect(decodeId('0'.repeat(32), 16)).toBeNull();
    expect(decodeId(Buffer.alloc(16).toString('base64'), 16)).toBeNull();
  });

  it('rejects wrong lengths and junk', () => {
    expect(decodeId(SPAN_HEX, 16)).toBeNull();
    expect(decodeId('', 16)).toBeNull();
    expect(decodeId(null, 16)).toBeNull();
    expect(decodeId(42, 8)).toBeNull();
  });
});

describe('decodeAnyValue', () => {
  it('unwraps each variant', () => {
    expect(decodeAnyValue({ stringValue: 'x' })).toBe('x');
    expect(decodeAnyValue({ boolValue: true })).toBe(true);
    expect(decodeAnyValue({ doubleValue: 1.5 })).toBe(1.5);
    expect(decodeAnyValue({ intValue: '500' })).toBe(500);
  });

  it('keeps an int too large for a double as a string rather than rounding it', () => {
    const huge = '9007199254740993'; // MAX_SAFE_INTEGER + 2
    expect(decodeAnyValue({ intValue: huge })).toBe(huge);
  });

  it('handles nested arrays and key-value lists', () => {
    expect(decodeAnyValue({ arrayValue: { values: [{ stringValue: 'a' }, { intValue: '2' }] } })).toEqual([
      'a',
      2,
    ]);
    expect(
      decodeAnyValue({ kvlistValue: { values: [{ key: 'k', value: { stringValue: 'v' } }] } })
    ).toEqual({ k: 'v' });
  });

  it('returns null for an unrecognized shape instead of throwing', () => {
    expect(decodeAnyValue({ somethingNew: 1 })).toBeNull();
    expect(decodeAnyValue('bare string')).toBeNull();
  });
});

describe('decodeAttributes', () => {
  it('flattens the key-value list into an object', () => {
    expect(
      decodeAttributes([
        { key: 'db.system', value: { stringValue: 'postgresql' } },
        { key: 'db.rows', value: { intValue: '12' } },
      ])
    ).toEqual({ 'db.system': 'postgresql', 'db.rows': 12 });
  });

  it('skips malformed entries rather than failing the span', () => {
    expect(decodeAttributes([{ value: { stringValue: 'no key' } }, 'junk', null])).toEqual({});
  });
});

describe('normalizeOtlp', () => {
  it('produces a flat span record', () => {
    const { spans, dropped } = normalizeOtlp(payload(VALID_SPAN));

    expect(dropped).toBe(0);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      traceId: TRACE_HEX,
      spanId: SPAN_HEX,
      name: 'POST /api/checkout',
      kind: 'SERVER',
      serviceName: 'api',
      startNs: 1724832000131000000n,
      endNs: 1724832001880000000n,
      durationNs: 1749000000n,
      statusCode: 'ERROR',
      statusMsg: 'internal error',
      attributes: { 'http.status_code': 500 },
    });
  });

  it('takes service.name from the resource, where OpenTelemetry puts it', () => {
    const { spans } = normalizeOtlp(payload(VALID_SPAN, 'checkout-worker'));
    expect(spans[0].serviceName).toBe('checkout-worker');
  });

  it('falls back to unknown rather than dropping a span with no service name', () => {
    const { spans } = normalizeOtlp({
      resourceSpans: [{ resource: {}, scopeSpans: [{ spans: [VALID_SPAN] }] }],
    });
    expect(spans[0].serviceName).toBe('unknown');
  });

  it('reads the pre-1.0 instrumentationLibrarySpans key that old collectors still emit', () => {
    const { spans } = normalizeOtlp({
      resourceSpans: [{ resource: {}, instrumentationLibrarySpans: [{ spans: [VALID_SPAN] }] }],
    });
    expect(spans).toHaveLength(1);
  });

  it('accepts snake_case field names', () => {
    const { spans } = normalizeOtlp(
      payload({
        trace_id: TRACE_HEX,
        span_id: SPAN_HEX,
        parent_span_id: '11f067aa0ba902b7',
        name: 'query',
        start_time_unix_nano: '1000',
        end_time_unix_nano: '2000',
      })
    );
    expect(spans[0]).toMatchObject({ parentSpanId: '11f067aa0ba902b7', durationNs: 1000n });
  });

  it('drops one malformed span without losing the rest of the batch', () => {
    const { spans, dropped } = normalizeOtlp({
      resourceSpans: [
        {
          resource: {},
          scopeSpans: [
            {
              spans: [VALID_SPAN, { name: 'no ids at all' }, { ...VALID_SPAN, spanId: 'nope' }],
            },
          ],
        },
      ],
    });

    expect(spans).toHaveLength(1);
    expect(dropped).toBe(2);
  });

  it('clamps a negative duration, which is a clock artifact rather than real', () => {
    const { spans } = normalizeOtlp(
      payload({ ...VALID_SPAN, startTimeUnixNano: '2000', endTimeUnixNano: '1000' })
    );
    expect(spans[0].durationNs).toBe(0n);
  });

  it('maps span kinds from both the enum value and the proto name', () => {
    expect(normalizeOtlp(payload({ ...VALID_SPAN, kind: 3 })).spans[0].kind).toBe('CLIENT');
    expect(normalizeOtlp(payload({ ...VALID_SPAN, kind: 'SPAN_KIND_CONSUMER' })).spans[0].kind).toBe(
      'CONSUMER'
    );
    expect(normalizeOtlp(payload({ ...VALID_SPAN, kind: 99 })).spans[0].kind).toBe('INTERNAL');
  });

  it('omits parentSpanId for a root span rather than carrying an empty string', () => {
    const { spans } = normalizeOtlp(payload({ ...VALID_SPAN, parentSpanId: '' }));
    expect(spans[0]).not.toHaveProperty('parentSpanId');
  });

  it('survives structurally wrong input', () => {
    expect(normalizeOtlp(null)).toEqual({ spans: [], dropped: 0 });
    expect(normalizeOtlp({})).toEqual({ spans: [], dropped: 0 });
    expect(normalizeOtlp({ resourceSpans: 'nope' })).toEqual({ spans: [], dropped: 0 });
    expect(normalizeOtlp({ resourceSpans: [null] })).toEqual({ spans: [], dropped: 0 });
  });
});
