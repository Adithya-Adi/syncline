import type { SpanRecord } from './span-store.js';
import { describe, expect, it } from 'vitest';
import { buildSpanTree } from './span-tree.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const BASE_NS = 1_724_832_000_000_000_000n;

function span(over: Partial<SpanRecord> & { spanId: string }): SpanRecord {
  return {
    traceId: TRACE,
    name: 'span',
    kind: 'SERVER',
    serviceName: 'api',
    startNs: BASE_NS,
    endNs: BASE_NS + 1_000_000n,
    durationNs: 1_000_000n,
    attributes: {},
    ...over,
  };
}

describe('ordering', () => {
  it('returns parents before children, depth first', () => {
    const tree = buildSpanTree(
      [
        span({ spanId: 'cc', parentSpanId: 'bb', startNs: BASE_NS + 3n }),
        span({ spanId: 'aa', startNs: BASE_NS }),
        span({ spanId: 'bb', parentSpanId: 'aa', startNs: BASE_NS + 1n }),
      ],
      0,
    );

    expect(tree.map((s) => s.spanId)).toEqual(['aa', 'bb', 'cc']);
    expect(tree.map((s) => s.depth)).toEqual([0, 1, 2]);
  });

  it('sorts siblings by start time', () => {
    const tree = buildSpanTree(
      [
        span({ spanId: 'aa' }),
        span({ spanId: 'later', parentSpanId: 'aa', startNs: BASE_NS + 500n }),
        span({
          spanId: 'earlier',
          parentSpanId: 'aa',
          startNs: BASE_NS + 100n,
        }),
      ],
      0,
    );

    expect(tree.map((s) => s.spanId)).toEqual(['aa', 'earlier', 'later']);
  });

  it('treats a span whose parent is absent as a root', () => {
    // The browser's own span is the parent of the server span and was never exported anywhere.
    const tree = buildSpanTree(
      [span({ spanId: 'server', parentSpanId: 'browser-span' })],
      0,
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].parentSpanId).toBe('browser-span');
  });

  it('survives a cycle instead of looping forever', () => {
    const tree = buildSpanTree(
      [
        span({ spanId: 'aa', parentSpanId: 'bb' }),
        span({ spanId: 'bb', parentSpanId: 'aa' }),
      ],
      0,
    );

    expect(tree.length).toBeLessThanOrEqual(2);
  });

  it('returns nothing for an empty trace', () => {
    expect(buildSpanTree([], 0)).toEqual([]);
  });
});

describe('skew correction', () => {
  it('shifts server time into the client frame', () => {
    // Server clock is 5s ahead of the client.
    const [only] = buildSpanTree([span({ spanId: 'aa' })], 5_000);

    expect(only.startClientMs).toBe(Number(BASE_NS / 1_000_000n) - 5_000);
  });

  it('leaves timestamps alone when the session never calibrated', () => {
    const [only] = buildSpanTree([span({ spanId: 'aa' })], 0);
    expect(only.startClientMs).toBe(Number(BASE_NS / 1_000_000n));
  });

  it('reports duration from the span itself, not from the shifted endpoints', () => {
    const [only] = buildSpanTree(
      [span({ spanId: 'aa', durationNs: 1_749_000_000n })],
      12_345,
    );
    expect(only.durationMs).toBe(1_749);
  });
});

describe('field mapping', () => {
  it('carries status, service and attributes through', () => {
    const [only] = buildSpanTree(
      [
        span({
          spanId: 'aa',
          serviceName: 'checkout-api',
          statusCode: 'ERROR',
          statusMsg: 'internal error',
          attributes: { 'db.system': 'postgresql' },
        }),
      ],
      0,
    );

    expect(only).toMatchObject({
      serviceName: 'checkout-api',
      status: 'ERROR',
      statusMessage: 'internal error',
      attributes: { 'db.system': 'postgresql' },
    });
  });

  it('falls back for a kind or status it does not recognize', () => {
    const [only] = buildSpanTree(
      [span({ spanId: 'aa', kind: 'SOMETHING_NEW', statusCode: 'WEIRD' })],
      0,
    );

    expect(only.kind).toBe('INTERNAL');
    expect(only.status).toBe('UNSET');
  });

  it('omits statusMessage rather than sending an empty one', () => {
    const [only] = buildSpanTree([span({ spanId: 'aa' })], 0);
    expect(only).not.toHaveProperty('statusMessage');
  });
});
