import { describe, expect, it } from 'vitest';
import {
  formatTraceparent,
  INVALID_SPAN_ID,
  INVALID_TRACE_ID,
  isSpanId,
  isTraceId,
  newSpanId,
  newTraceId,
  parseTraceparent,
} from './ids.js';

describe('id generation', () => {
  it('produces ids of the lengths the spec requires', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 1000 }, newTraceId));
    expect(ids.size).toBe(1000);
  });
});

describe('id validation', () => {
  it('rejects the all-zero ids the spec calls invalid', () => {
    expect(isTraceId(INVALID_TRACE_ID)).toBe(false);
    expect(isSpanId(INVALID_SPAN_ID)).toBe(false);
  });

  it('rejects wrong lengths, uppercase, and non-hex', () => {
    expect(isTraceId('4bf92f3577b34da6a3ce929d0e0e473')).toBe(false); // 31
    expect(isTraceId('4BF92F3577B34DA6A3CE929D0E0E4736')).toBe(false);
    expect(isSpanId('00f067aa0ba902bz')).toBe(false);
  });
});

describe('traceparent', () => {
  const ctx = {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: '00f067aa0ba902b7',
    sampled: true,
  };

  it('formats the header the way the spec spells it', () => {
    expect(formatTraceparent(ctx)).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    );
  });

  it('round-trips', () => {
    expect(parseTraceparent(formatTraceparent(ctx))).toMatchObject(ctx);
  });

  it('encodes the sampled flag, which is what keeps a replay from losing its spans', () => {
    expect(formatTraceparent({ ...ctx, sampled: false })).toMatch(/-00$/);
    expect(parseTraceparent(formatTraceparent({ ...ctx, sampled: false }))?.sampled).toBe(false);
  });

  it('accepts a longer header from a future version, as the spec asks', () => {
    const future = '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-something';
    expect(parseTraceparent(future)).toMatchObject({ version: '01', sampled: true });
  });

  it('rejects a version-00 header with extra fields', () => {
    expect(
      parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra')
    ).toBeNull();
  });

  it('rejects ff, malformed, and all-zero ids', () => {
    expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent(`00-${INVALID_TRACE_ID}-00f067aa0ba902b7-01`)).toBeNull();
    expect(parseTraceparent(`00-4bf92f3577b34da6a3ce929d0e0e4736-${INVALID_SPAN_ID}-01`)).toBeNull();
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('')).toBeNull();
  });
});
