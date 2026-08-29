import type { Job } from 'bullmq';
import type { SessionChunkJob } from '@syncline/protocol';
import type { PrismaClient } from '@syncline/models';
import type { ObjectStore } from '@syncline/storage';
import {
  eventTimestamps,
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
  return { getMaybeGzipped: jest.fn().mockResolvedValue(body) } as unknown as ObjectStore;
}

/** Enough of Prisma to see what the processor tried to write. */
function fakePrisma() {
  const tx = {
    session: { upsert: jest.fn(), update: jest.fn() },
    sessionChunk: {
      upsert: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _min: {}, _max: {} }),
    },
    requestLink: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

describe('validation', () => {
  it('rejects a body that is not JSON, without retrying', async () => {
    const { prisma } = fakePrisma();
    const processor = new SessionChunkProcessor(prisma, storageReturning(Buffer.from('not json')));

    await expect(processor.process(job())).rejects.toBeInstanceOf(UnrecoverableChunkError);
  });

  it('rejects a body that fails the schema, without retrying', async () => {
    const { prisma } = fakePrisma();
    const bad = Buffer.from(JSON.stringify({ ...CHUNK, sessionId: 'not-a-ulid' }));
    const processor = new SessionChunkProcessor(prisma, storageReturning(bad));

    await expect(processor.process(job())).rejects.toBeInstanceOf(UnrecoverableChunkError);
  });

  it('refuses a chunk whose body disagrees with the path it was stored under', async () => {
    const { prisma, tx } = fakePrisma();
    const body = Buffer.from(JSON.stringify({ ...CHUNK, seq: 5 }));
    const processor = new SessionChunkProcessor(prisma, storageReturning(body));

    await expect(processor.process(job({ seq: 0 }))).rejects.toThrow(/disagrees with its path/);
    expect(tx.session.upsert).not.toHaveBeenCalled();
  });

  it('delegates decompression to storage rather than handling encoding itself', async () => {
    const { prisma, tx } = fakePrisma();
    const storage = storageReturning(Buffer.from(JSON.stringify(CHUNK)));
    const processor = new SessionChunkProcessor(prisma, storage);

    await processor.process(job());

    expect(storage.getMaybeGzipped).toHaveBeenCalledWith(`sessions/proj_1/${SESSION_ID}/0.json.gz`);
    expect(tx.sessionChunk.upsert).toHaveBeenCalled();
  });
});

describe('writes', () => {
  it('upserts rather than creates, because chunks can arrive out of order', async () => {
    const { prisma, tx } = fakePrisma();
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK)))
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
      storageReturning(Buffer.from(JSON.stringify(CHUNK)))
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
      storageReturning(Buffer.from(JSON.stringify(withLinks)))
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
      storageReturning(Buffer.from(JSON.stringify(CHUNK)))
    );

    await processor.process(job());
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('eventTimestamps', () => {
  it('finds the first and last rrweb timestamps', () => {
    expect(
      eventTimestamps([
        { type: 3, timestamp: 300 },
        { type: 3, timestamp: 100 },
        { type: 3, timestamp: 200 },
      ])
    ).toEqual({ first: 100, last: 300 });
  });

  it('ignores our own custom events, which can sit outside the recorded window', () => {
    expect(
      eventTimestamps([
        { type: 3, timestamp: 200 },
        { type: 5, timestamp: 1, data: { tag: 'syncline.request', payload: {} } },
      ])
    ).toEqual({ first: 200, last: 200 });
  });

  it('returns nothing for a chunk with no usable timestamps', () => {
    expect(eventTimestamps([])).toEqual({});
    expect(eventTimestamps([{ type: 3 }, null, 'junk'])).toEqual({});
  });
});
