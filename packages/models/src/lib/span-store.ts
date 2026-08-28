/**
 * The span storage port.
 *
 * Spans are the one table with unbounded write volume, and the one destined for ClickHouse once
 * Postgres stops being enough. Everything that touches spans goes through this interface so that
 * migration is a new implementation plus a config flag, not a rewrite. See
 * docs/ARCHITECTURE.md §6.
 *
 * Nothing outside this file should import the Prisma client to read or write spans.
 */

import type { PrismaClient } from './client.js';

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  serviceName: string;
  /** Nanoseconds since epoch, as OpenTelemetry emits them. */
  startNs: bigint;
  endNs: bigint;
  durationNs: bigint;
  statusCode?: string;
  statusMsg?: string;
  attributes: Record<string, unknown>;
}

export interface SpanStore {
  /** Idempotent: a redelivered OTLP batch must not duplicate rows. */
  insert(spans: SpanRecord[]): Promise<void>;
  /** Ordered by start time. Empty when the trace has not arrived yet, which is normal. */
  byTrace(traceId: string): Promise<SpanRecord[]>;
  /** One round trip for a viewport's worth of traces. Traces with no spans are absent from the map. */
  byTraces(traceIds: string[]): Promise<Map<string, SpanRecord[]>>;
}

/** Rows above this per statement are chunked, to stay under Postgres's parameter limit. */
const INSERT_BATCH_SIZE = 1_000;

export class PostgresSpanStore implements SpanStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(spans: SpanRecord[]): Promise<void> {
    if (spans.length === 0) return;

    for (let i = 0; i < spans.length; i += INSERT_BATCH_SIZE) {
      const batch = spans.slice(i, i + INSERT_BATCH_SIZE);
      await this.prisma.span.createMany({
        data: batch.map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId ?? null,
          name: s.name,
          kind: s.kind,
          serviceName: s.serviceName,
          startNs: s.startNs,
          endNs: s.endNs,
          durationNs: s.durationNs,
          statusCode: s.statusCode ?? null,
          statusMsg: s.statusMsg ?? null,
          attributes: s.attributes as object,
        })),
        // Spans are immutable once written, so an existing row is already correct. This is what
        // makes a retried OTLP job safe.
        skipDuplicates: true,
      });
    }
  }

  async byTrace(traceId: string): Promise<SpanRecord[]> {
    const rows = await this.prisma.span.findMany({
      where: { traceId },
      orderBy: { startNs: 'asc' },
    });
    return rows.map(toRecord);
  }

  async byTraces(traceIds: string[]): Promise<Map<string, SpanRecord[]>> {
    const out = new Map<string, SpanRecord[]>();
    if (traceIds.length === 0) return out;

    const rows = await this.prisma.span.findMany({
      where: { traceId: { in: traceIds } },
      orderBy: [{ traceId: 'asc' }, { startNs: 'asc' }],
    });

    for (const row of rows) {
      const record = toRecord(row);
      const existing = out.get(record.traceId);
      if (existing) existing.push(record);
      else out.set(record.traceId, [record]);
    }

    return out;
  }
}

type SpanRow = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  serviceName: string;
  startNs: bigint;
  endNs: bigint;
  durationNs: bigint;
  statusCode: string | null;
  statusMsg: string | null;
  attributes: unknown;
};

function toRecord(row: SpanRow): SpanRecord {
  return {
    traceId: row.traceId,
    spanId: row.spanId,
    ...(row.parentSpanId ? { parentSpanId: row.parentSpanId } : {}),
    name: row.name,
    kind: row.kind,
    serviceName: row.serviceName,
    startNs: row.startNs,
    endNs: row.endNs,
    durationNs: row.durationNs,
    ...(row.statusCode ? { statusCode: row.statusCode } : {}),
    ...(row.statusMsg ? { statusMsg: row.statusMsg } : {}),
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
  };
}
