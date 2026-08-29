/**
 * Turns stored spans into something a timeline can draw without doing arithmetic.
 *
 * Two transformations happen here, and the distinction matters:
 *
 *   - **Ordering and depth** are structural. A trace is a tree; the viewer wants it flattened
 *     depth-first with parents before children so it can indent without walking parent pointers.
 *   - **Skew correction** is cosmetic. Server timestamps are shifted into the client's frame of
 *     reference purely so the lanes line up under the video. It can never change which spans
 *     belong to which request — that was decided by trace id at capture time.
 */

import type { SpanKind, SpanStatus, ViewerSpan } from '@syncline/protocol';
import type { SpanRecord } from '@syncline/models';

const NS_PER_MS = 1_000_000n;

const KINDS: SpanKind[] = ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];
const STATUSES: SpanStatus[] = ['UNSET', 'OK', 'ERROR'];

function toMs(ns: bigint): number {
  return Number(ns / NS_PER_MS);
}

function asKind(kind: string): SpanKind {
  return KINDS.includes(kind as SpanKind) ? (kind as SpanKind) : 'INTERNAL';
}

function asStatus(status: string | undefined): SpanStatus {
  return status && STATUSES.includes(status as SpanStatus) ? (status as SpanStatus) : 'UNSET';
}

/**
 * @param clockOffsetMs `serverMs - clientMs`, measured by the SDK. Subtracting it puts a server
 * timestamp back into the client's frame. Zero when the session never calibrated, which just means
 * the lanes are drawn against the server's own clock.
 */
export function buildSpanTree(spans: SpanRecord[], clockOffsetMs: number): ViewerSpan[] {
  if (spans.length === 0) return [];

  const byParent = new Map<string, SpanRecord[]>();
  const present = new Set(spans.map((s) => s.spanId));
  const roots: SpanRecord[] = [];

  for (const span of spans) {
    // A span whose parent is not in this trace is a root as far as the viewer is concerned. That
    // happens legitimately: the browser's own span is the parent of the server span, and it was
    // never exported to any collector.
    if (span.parentSpanId && present.has(span.parentSpanId)) {
      const siblings = byParent.get(span.parentSpanId);
      if (siblings) siblings.push(span);
      else byParent.set(span.parentSpanId, [span]);
    } else {
      roots.push(span);
    }
  }

  const byStart = (a: SpanRecord, b: SpanRecord) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0);
  roots.sort(byStart);
  for (const children of byParent.values()) children.sort(byStart);

  const out: ViewerSpan[] = [];
  const seen = new Set<string>();

  // Iterative rather than recursive: a pathological trace should not be able to blow the stack of
  // the process serving it.
  const stack: { span: SpanRecord; depth: number }[] = roots
    .slice()
    .reverse()
    .map((span) => ({ span, depth: 0 }));

  while (stack.length > 0) {
    const { span, depth } = stack.pop() as { span: SpanRecord; depth: number };

    // Guards against a cycle in parent pointers, which no correct producer emits and which would
    // otherwise loop forever.
    if (seen.has(span.spanId)) continue;
    seen.add(span.spanId);

    const startClientMs = toMs(span.startNs) - clockOffsetMs;
    const endClientMs = toMs(span.endNs) - clockOffsetMs;

    out.push({
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      depth,
      name: span.name,
      serviceName: span.serviceName,
      kind: asKind(span.kind),
      startClientMs,
      endClientMs,
      durationMs: toMs(span.durationNs),
      status: asStatus(span.statusCode),
      ...(span.statusMsg ? { statusMessage: span.statusMsg } : {}),
      attributes: span.attributes,
    });

    const children = byParent.get(span.spanId);
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ span: children[i], depth: depth + 1 });
      }
    }
  }

  return out;
}
