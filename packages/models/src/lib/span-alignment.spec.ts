import { describe, expect, it } from 'vitest';
import { alignmentOffsetMs } from './span-alignment.js';
import type { SpanRecord } from './span-store.js';

/**
 * Lining server spans up under the request that caused them.
 *
 * The bug this replaces: the viewer subtracted the session's `clockOffsetMs`, which measures the
 * browser against Syncline's API rather than against the customer's backend. On a real recording
 * that put every span 363ms before the request that caused it.
 */

const ms = (n: number) => BigInt(n) * 1_000_000n;

function span(startMs: number, endMs: number): SpanRecord {
  return {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    name: 'GET /api/products',
    kind: 'SERVER',
    serviceName: 'storefront-api',
    startNs: ms(startMs),
    endNs: ms(endMs),
    durationNs: ms(endMs - startMs),
    attributes: {},
  };
}

describe('alignmentOffsetMs', () => {
  it('does nothing when the spans already sit inside the request', () => {
    // The ordinary case, and the one the old code got wrong: a few ms of network latency is not
    // skew, and correcting for it is how a correct picture gets bent.
    const offset = alignmentOffsetMs(
      { clientStartMs: 1_000n, clientEndMs: 1_900n },
      [span(1_005, 1_050)],
    );

    expect(offset).toBe(0);
  });

  it('reproduces the real session that exposed the bug', () => {
    // Session 01M1NT3QNSSFZYGMV8YZM1TCRF: the browser and the backend were the same laptop, so the
    // true offset was zero, while the session's clockOffsetMs said 368.
    const offset = alignmentOffsetMs(
      { clientStartMs: 1_788_512_165_572n, clientEndMs: 1_788_512_166_468n },
      [span(1_788_512_165_577, 1_788_512_165_620)],
    );

    expect(offset).toBe(0);
  });

  it('shifts back by the least that fits when the server clock runs ahead', () => {
    // Server says it started 500ms after the browser asked but finished 400ms after the browser
    // had the answer, which cannot be. The smallest honest correction is the 400 that makes the
    // end fit; anything more would be invented.
    const offset = alignmentOffsetMs(
      { clientStartMs: 1_000n, clientEndMs: 1_100n },
      [span(1_500, 1_500)],
    );

    expect(offset).toBe(400);
  });

  it('shifts forward when the server clock runs behind', () => {
    // The span claims to have started before the request was sent.
    const offset = alignmentOffsetMs(
      { clientStartMs: 1_000n, clientEndMs: 2_000n },
      [span(700, 750)],
    );

    expect(offset).toBe(-300);
  });

  it('measures the whole trace, not just the first span', () => {
    // The window is the outermost extent. Here the last span is what pushes past the response, so
    // an implementation reading only `spans[0]` would find nothing to correct and leave it wrong.
    const offset = alignmentOffsetMs(
      { clientStartMs: 1_000n, clientEndMs: 1_200n },
      [span(1_050, 1_060), span(1_055, 1_250)],
    );

    expect(offset).toBe(50);
  });

  it('centres rather than pretending, when the server outlasted the request', () => {
    // 500ms of server work inside a 100ms request is not something a shift can reconcile. Better an
    // approximate drawing than a confidently wrong one.
    const offset = alignmentOffsetMs(
      { clientStartMs: 1_000n, clientEndMs: 1_100n },
      [span(1_000, 1_500)],
    );

    // lowest 400, highest 0 — infeasible, so the midpoint.
    expect(offset).toBe(200);
  });

  it('has nothing to say about a trace with no spans', () => {
    expect(
      alignmentOffsetMs({ clientStartMs: 1_000n, clientEndMs: 1_100n }, []),
    ).toBe(0);
  });
});
