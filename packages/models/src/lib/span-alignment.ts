import type { SpanRecord } from './span-store.js';

/**
 * How far the customer's backend clock sits from the browser's, measured from the request itself.
 *
 * The session carries a `clockOffsetMs` from an NTP-style handshake, and it is the wrong number for
 * this job. That handshake measures the browser against **Syncline's** API. Spans are produced by
 * the customer's own backend, which never spoke to that endpoint and keeps its own clock — in a
 * real deployment those are three different machines in three different places. Subtracting one
 * from the other is arithmetic between unrelated quantities, and it showed: on a session where the
 * browser and the backend were the same laptop, every span was drawn 363ms before the request that
 * caused it.
 *
 * The request is the measurement. A `RequestLink` records when the browser fired a request and when
 * it saw the response; the server spans for that trace record what the backend did in between. The
 * backend cannot have started before the browser asked, and cannot have finished after the browser
 * had the answer — so in a shared frame of reference the server's window is *contained* in the
 * client's. That containment is the whole constraint, and it needs no assumption about latency
 * being symmetric.
 */

const NS_PER_MS = 1_000_000n;

export interface AlignmentWindow {
  clientStartMs: bigint;
  clientEndMs: bigint;
}

/**
 * The offset to subtract from server timestamps, in ms.
 *
 * Zero whenever the spans already fall inside the request, which is the common case and the one
 * worth protecting: clocks that agree should produce a picture that is left alone. A correction is
 * applied only when the server window cannot fit inside the client window as recorded, and then
 * only by the smallest amount that makes it fit. That keeps the estimator from inventing skew out
 * of ordinary latency — the failure the old code made.
 *
 * The bound each way:
 *   - the server may not appear to start before the browser asked → offset ≤ serverStart − clientStart
 *   - the server may not appear to finish after the browser knew → offset ≥ serverEnd − clientEnd
 */
export function alignmentOffsetMs(
  link: AlignmentWindow,
  spans: readonly SpanRecord[],
): number {
  if (spans.length === 0) return 0;

  let serverStartNs = spans[0]!.startNs;
  let serverEndNs = spans[0]!.endNs;
  for (const span of spans) {
    if (span.startNs < serverStartNs) serverStartNs = span.startNs;
    if (span.endNs > serverEndNs) serverEndNs = span.endNs;
  }

  const serverStartMs = Number(serverStartNs / NS_PER_MS);
  const serverEndMs = Number(serverEndNs / NS_PER_MS);

  const highest = serverStartMs - Number(link.clientStartMs);
  const lowest = serverEndMs - Number(link.clientEndMs);

  // The server did more work than the browser observed the request taking, so no shift can contain
  // it. Nothing here is trustworthy enough to correct with — a clipped chunk, a span that outlived
  // the response, a backend that batched. Centre it and let the drawing be approximate rather than
  // confidently wrong.
  if (lowest > highest) return Math.round((lowest + highest) / 2);

  // Zero if it already fits; otherwise the nearest edge of the feasible range.
  return Math.round(Math.min(Math.max(0, lowest), highest));
}
