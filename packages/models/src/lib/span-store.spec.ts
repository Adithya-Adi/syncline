import { describe, expect, it, vi } from 'vitest';
import { PostgresSpanStore, type SpanRecord } from './span-store.js';
import type { PrismaClient } from './client.js';

function span(over: Partial<SpanRecord> = {}): SpanRecord {
  return {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: '00f067aa0ba902b7',
    name: 'POST /api/checkout',
    kind: 'SERVER',
    serviceName: 'api',
    startNs: 1_724_832_000_131_000_000n,
    endNs: 1_724_832_001_880_000_000n,
    durationNs: 1_749_000_000n,
    attributes: { 'http.status_code': 500 },
    ...over,
  };
}

/** Enough of the client for these tests. No database, no container. */
function fakePrisma(rows: unknown[] = []) {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const findMany = vi.fn().mockResolvedValue(rows);
  return {
    client: { span: { createMany, findMany } } as unknown as PrismaClient,
    createMany,
    findMany,
  };
}

describe('insert', () => {
  it('does not touch the database for an empty batch', async () => {
    const { client, createMany } = fakePrisma();
    await new PostgresSpanStore(client).insert([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('skips duplicates, which is what makes a redelivered OTLP batch safe', async () => {
    const { client, createMany } = fakePrisma();
    await new PostgresSpanStore(client).insert([span()]);
    expect(createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('chunks large batches to stay under the parameter limit', async () => {
    const { client, createMany } = fakePrisma();
    const spans = Array.from({ length: 2_500 }, (_, i) =>
      span({ spanId: i.toString(16).padStart(16, '0') })
    );

    await new PostgresSpanStore(client).insert(spans);

    expect(createMany).toHaveBeenCalledTimes(3);
    const sizes = createMany.mock.calls.map((c) => c[0].data.length);
    expect(sizes).toEqual([1000, 1000, 500]);
  });

  it('writes absent optional fields as null rather than undefined', async () => {
    const { client, createMany } = fakePrisma();
    await new PostgresSpanStore(client).insert([span()]);

    const row = createMany.mock.calls[0][0].data[0];
    expect(row.parentSpanId).toBeNull();
    expect(row.statusCode).toBeNull();
    expect(row.statusMsg).toBeNull();
  });
});

describe('byTraces', () => {
  it('is a single query, not one per trace', async () => {
    const { client, findMany } = fakePrisma();
    await new PostgresSpanStore(client).byTraces(['a'.repeat(32), 'b'.repeat(32)]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('groups rows by trace id', async () => {
    const a = 'a'.repeat(32);
    const b = 'b'.repeat(32);
    const { client } = fakePrisma([
      { ...span({ traceId: a }), parentSpanId: null, statusCode: null, statusMsg: null },
      {
        ...span({ traceId: a, spanId: '11f067aa0ba902b7' }),
        parentSpanId: '00f067aa0ba902b7',
        statusCode: null,
        statusMsg: null,
      },
      { ...span({ traceId: b }), parentSpanId: null, statusCode: null, statusMsg: null },
    ]);

    const grouped = await new PostgresSpanStore(client).byTraces([a, b]);

    expect(grouped.get(a)).toHaveLength(2);
    expect(grouped.get(b)).toHaveLength(1);
    expect(grouped.get(a)?.[1].parentSpanId).toBe('00f067aa0ba902b7');
  });

  it('omits traces that have no spans yet, which is a normal state', async () => {
    const { client } = fakePrisma([]);
    const grouped = await new PostgresSpanStore(client).byTraces(['c'.repeat(32)]);
    expect(grouped.size).toBe(0);
  });

  it('short-circuits on an empty id list', async () => {
    const { client, findMany } = fakePrisma();
    expect((await new PostgresSpanStore(client).byTraces([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('drops nulls instead of carrying them into the record', async () => {
    const { client } = fakePrisma([
      { ...span(), parentSpanId: null, statusCode: null, statusMsg: null, attributes: null },
    ]);

    const [record] = await new PostgresSpanStore(client).byTrace('a'.repeat(32));

    expect(record).not.toHaveProperty('parentSpanId');
    expect(record).not.toHaveProperty('statusCode');
    expect(record.attributes).toEqual({});
  });
});
