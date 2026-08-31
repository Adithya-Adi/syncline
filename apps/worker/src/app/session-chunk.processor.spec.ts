import type { Job } from 'bullmq';
import type { SessionChunkJob } from '@syncline/protocol';
import type { PrismaClient } from '@syncline/models';
import type { ObjectStore } from '@syncline/storage';
import {
  eventTimestamps,
  isTrivial,
  pathOf,
  SessionChunkProcessor,
  UnrecoverableChunkError,
} from './session-chunk.processor.js';

const SESSION_ID = '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD';

const CHUNK = {
  sessionId: SESSION_ID,
  seq: 0,
  sdk: { name: 'syncline-browser', version: '0.1.0' },
  clock: { offsetMs: -142, rttMs: 38 },
  events: [{ type: 3, timestamp: 1_724_832_000_000, data: {} }],
  links: [],
};

function job(over: Partial<SessionChunkJob> = {}): Job<SessionChunkJob> {
  return {
    data: {
      projectId: 'proj_1',
      sessionId: SESSION_ID,
      seq: 0,
      storageKey: `sessions/proj_1/${SESSION_ID}/0.json.gz`,
      receivedMs: 1_724_832_000_000,
      ...over,
    },
  } as Job<SessionChunkJob>;
}

function storageReturning(body: Buffer): ObjectStore {
  return {
    getMaybeGzipped: jest.fn().mockResolvedValue(body),
  } as unknown as ObjectStore;
}

/** Enough of Prisma to see what the processor tried to write. */
function fakePrisma() {
  const tx = {
    session: { upsert: jest.fn(), update: jest.fn() },
    sessionChunk: {
      upsert: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _min: {}, _max: {} }),
    },
    requestLink: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    pageview: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) =>
      fn(tx),
    ),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

describe('validation', () => {
  it('rejects a body that is not JSON, without retrying', async () => {
    const { prisma } = fakePrisma();
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from('not json')),
    );

    await expect(processor.process(job())).rejects.toBeInstanceOf(
      UnrecoverableChunkError,
    );
  });

  it('rejects a body that fails the schema, without retrying', async () => {
    const { prisma } = fakePrisma();
    const bad = Buffer.from(
      JSON.stringify({ ...CHUNK, sessionId: 'not-a-ulid' }),
    );
    const processor = new SessionChunkProcessor(prisma, storageReturning(bad));

    await expect(processor.process(job())).rejects.toBeInstanceOf(
      UnrecoverableChunkError,
    );
  });

  it('refuses a chunk whose body disagrees with the path it was stored under', async () => {
    const { prisma, tx } = fakePrisma();
    const body = Buffer.from(JSON.stringify({ ...CHUNK, seq: 5 }));
    const processor = new SessionChunkProcessor(prisma, storageReturning(body));

    await expect(processor.process(job({ seq: 0 }))).rejects.toThrow(
      /disagrees with its path/,
    );
    expect(tx.session.upsert).not.toHaveBeenCalled();
  });

  it('delegates decompression to storage rather than handling encoding itself', async () => {
    const { prisma, tx } = fakePrisma();
    const storage = storageReturning(Buffer.from(JSON.stringify(CHUNK)));
    const processor = new SessionChunkProcessor(prisma, storage);

    await processor.process(job());

    expect(storage.getMaybeGzipped).toHaveBeenCalledWith(
      `sessions/proj_1/${SESSION_ID}/0.json.gz`,
    );
    expect(tx.sessionChunk.upsert).toHaveBeenCalled();
  });
});

describe('writes', () => {
  it('upserts rather than creates, because chunks can arrive out of order', async () => {
    const { prisma, tx } = fakePrisma();
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );

    await processor.process(job());

    expect(tx.session.upsert).toHaveBeenCalledTimes(1);
    expect(tx.sessionChunk.upsert).toHaveBeenCalledTimes(1);
    expect(tx.sessionChunk.upsert.mock.calls[0][0].where).toEqual({
      sessionId_seq: { sessionId: SESSION_ID, seq: 0 },
    });
  });

  it('carries the clock calibration onto the session', async () => {
    const { prisma, tx } = fakePrisma();
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );

    await processor.process(job());

    expect(tx.session.upsert.mock.calls[0][0].create).toMatchObject({
      clockOffsetMs: -142,
      rttMs: 38,
    });
  });

  it('replaces links for the same spans instead of duplicating them on redelivery', async () => {
    const { prisma, tx } = fakePrisma();
    const withLinks = {
      ...CHUNK,
      links: [
        {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: '00f067aa0ba902b7',
          method: 'POST',
          url: '/api/checkout',
          status: 500,
          startMs: 1_724_832_000_123,
          endMs: 1_724_832_001_901,
        },
      ],
    };
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(withLinks))),
    );

    await processor.process(job());

    expect(tx.requestLink.deleteMany).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID, spanId: { in: ['00f067aa0ba902b7'] } },
    });
    expect(tx.requestLink.createMany.mock.calls[0][0].data[0]).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      clientStartMs: 1_724_832_000_123n,
    });
  });

  it('does everything in one transaction, so a partial chunk is never visible', async () => {
    const { prisma } = fakePrisma();
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );

    await processor.process(job());
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('the flow', () => {
  const PAGE = 1_724_832_000_000;

  it('writes a row per page and files the chunk under the page it belongs to', async () => {
    const { prisma, tx } = fakePrisma();
    const chunk = {
      ...CHUNK,
      pageviewOrdinal: 1,
      pageviews: [
        {
          ordinal: 1,
          url: 'https://app.acme.com/cart?ref',
          startMs: PAGE,
          trigger: 'pushState',
        },
      ],
    };

    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(chunk))),
    );
    await processor.process(job());

    expect(tx.pageview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ordinal: 1,
          url: 'https://app.acme.com/cart?ref',
          path: '/cart',
          trigger: 'pushState',
        }),
      }),
    );
    expect(tx.sessionChunk.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ pageviewOrdinal: 1 }),
      }),
    );
  });

  it('leaves the page unset for a chunk from an SDK that predates pageviews', async () => {
    const { prisma, tx } = fakePrisma();
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );

    await processor.process(job());

    const create = tx.sessionChunk.upsert.mock.calls[0]?.[0]?.create;
    expect(create).not.toHaveProperty('pageviewOrdinal');
    expect(tx.pageview.upsert).not.toHaveBeenCalled();
  });

  it('ends each page where the next one begins, and the last at the session end', async () => {
    const { prisma, tx } = fakePrisma();
    tx.sessionChunk.aggregate.mockResolvedValue({
      _min: { startedAt: new Date(PAGE) },
      _max: { endedAt: new Date(PAGE + 30_000) },
    });
    tx.pageview.findMany.mockResolvedValue([
      { id: 'pv0', startedAt: new Date(PAGE), endedAt: null, durationMs: null },
      {
        id: 'pv1',
        startedAt: new Date(PAGE + 4_000),
        endedAt: null,
        durationMs: null,
      },
    ]);

    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );
    await processor.process(job());

    expect(tx.pageview.update).toHaveBeenCalledWith({
      where: { id: 'pv0' },
      data: { endedAt: new Date(PAGE + 4_000), durationMs: 4_000 },
    });
    expect(tx.pageview.update).toHaveBeenCalledWith({
      where: { id: 'pv1' },
      data: { endedAt: new Date(PAGE + 30_000), durationMs: 26_000 },
    });
  });

  it('refuses to write a negative duration when the client clock jumped backwards', async () => {
    const { prisma, tx } = fakePrisma();
    tx.sessionChunk.aggregate.mockResolvedValue({
      _min: { startedAt: new Date(PAGE) },
      _max: { endedAt: new Date(PAGE + 1_000) },
    });
    tx.pageview.findMany.mockResolvedValue([
      {
        // Started after the session apparently ended. A skewed device, not a bug in the viewer.
        id: 'pv0',
        startedAt: new Date(PAGE + 9_000),
        endedAt: null,
        durationMs: null,
      },
    ]);

    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );
    await processor.process(job());

    expect(tx.pageview.update).not.toHaveBeenCalled();
  });

  it('marks a short empty session trivial, and never one that failed', async () => {
    const { prisma, tx } = fakePrisma();
    tx.sessionChunk.aggregate.mockResolvedValue({
      _min: { startedAt: new Date(PAGE) },
      _max: { endedAt: new Date(PAGE + 1_200) },
    });

    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );
    await processor.process(job());

    expect(tx.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trivial: true, durationMs: 1_200 }),
      }),
    );
  });
});

describe('pathOf', () => {
  it('takes the pathname', () => {
    expect(pathOf('https://app.acme.com/checkout?step')).toBe('/checkout');
    expect(pathOf('https://app.acme.com')).toBe('/');
  });

  it('takes the hash route, because for a hash router that is the path', () => {
    expect(pathOf('https://app.acme.com/#/cart')).toBe('/cart');
  });

  it('falls back to the root rather than leaving a null every query has to handle', () => {
    expect(pathOf('not a url')).toBe('/');
  });
});

describe('isTrivial', () => {
  it('is true only for a recording that is both short and empty', () => {
    expect(isTrivial({ durationMs: 900, linkCount: 0, failedCount: 0 })).toBe(
      true,
    );
    expect(
      isTrivial({ durationMs: 30_000, linkCount: 0, failedCount: 0 }),
    ).toBe(false);
    expect(isTrivial({ durationMs: 900, linkCount: 3, failedCount: 0 })).toBe(
      false,
    );
  });

  it('never marks a recording that contained a failure, however brief', () => {
    expect(isTrivial({ durationMs: 200, linkCount: 1, failedCount: 1 })).toBe(
      false,
    );
  });
});

describe('eventTimestamps', () => {
  it('finds the first and last rrweb timestamps', () => {
    expect(
      eventTimestamps([
        { type: 3, timestamp: 300 },
        { type: 3, timestamp: 100 },
        { type: 3, timestamp: 200 },
      ]),
    ).toEqual({ first: 100, last: 300 });
  });

  it('ignores request markers, which can sit outside the recorded window', () => {
    expect(
      eventTimestamps([
        { type: 3, timestamp: 200 },
        {
          type: 5,
          timestamp: 1,
          data: { tag: 'syncline.request', payload: {} },
        },
        {
          type: 5,
          timestamp: 9_000,
          data: { tag: 'syncline.response', payload: {} },
        },
      ]),
    ).toEqual({ first: 200, last: 200 });
  });

  it('counts a pageview marker, so a session cannot end before its last page began', () => {
    // What a route change immediately before leaving produces: a chunk carrying the marker and
    // nothing else. Excluded, it would contribute no bounds at all.
    expect(
      eventTimestamps([
        {
          type: 5,
          timestamp: 5_000,
          data: { tag: 'syncline.pageview', payload: { ordinal: 1 } },
        },
      ]),
    ).toEqual({ first: 5_000, last: 5_000 });
  });

  it('returns nothing for a chunk with no usable timestamps', () => {
    expect(eventTimestamps([])).toEqual({});
    expect(eventTimestamps([{ type: 3 }, null, 'junk'])).toEqual({});
  });
});
