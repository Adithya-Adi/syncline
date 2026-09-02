import type { Job } from 'bullmq';
import type { SessionChunkJob } from '@syncline/protocol';
import type { PrismaClient } from '@syncline/models';
import type { ObjectStore } from '@syncline/storage';
import {
  countConsole,
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
    session: {
      upsert: jest.fn(),
      update: jest.fn(),
      // The attribute index reads the session back. Null by default: a test that cares about
      // attributes says what the session says about itself.
      findUnique: jest.fn().mockResolvedValue(null),
    },
    sessionChunk: {
      upsert: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _min: {}, _max: {}, _sum: {} }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    requestLink: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    sessionError: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    sessionAttribute: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
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

describe('errors and console output', () => {
  const AT = 1_724_832_000_500;

  const ERROR = {
    source: 'onerror' as const,
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'total')",
    fileUrl: 'https://app.acme.com/static/main.js',
    line: 42,
    column: 7,
    stack: 'TypeError: ...\n  at checkout (main.js:42:7)',
    timeMs: AT,
  };

  it('writes a row per error, in client time', async () => {
    const { prisma, tx } = fakePrisma();
    const chunk = { ...CHUNK, errors: [ERROR] };
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(chunk))),
    );

    await processor.process(job());

    expect(tx.sessionError.createMany.mock.calls[0][0].data[0]).toMatchObject({
      sessionId: SESSION_ID,
      source: 'onerror',
      name: 'TypeError',
      line: 42,
      clientMs: BigInt(AT),
    });
  });

  it('replaces errors at the same instant rather than duplicating them on redelivery', async () => {
    const { prisma, tx } = fakePrisma();
    const chunk = { ...CHUNK, errors: [ERROR] };
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(chunk))),
    );

    await processor.process(job());

    expect(tx.sessionError.deleteMany).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID, clientMs: { in: [BigInt(AT)] } },
    });
  });

  it('counts console output onto the chunk, not the session', async () => {
    // The chunk row is an upsert, so a redelivered job overwrites the count. A counter on the
    // session would add to it a second time.
    const { prisma, tx } = fakePrisma();
    const chunk = {
      ...CHUNK,
      logs: [
        { level: 'error', message: 'checkout failed', timeMs: AT },
        { level: 'warn', message: 'retrying', timeMs: AT + 1 },
        { level: 'log', message: 'rendered', timeMs: AT + 2 },
      ],
    };
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(chunk))),
    );

    await processor.process(job());

    expect(tx.sessionChunk.upsert.mock.calls[0][0].create).toMatchObject({
      consoleErrorCount: 1,
      consoleWarnCount: 1,
    });
    expect(tx.sessionChunk.upsert.mock.calls[0][0].update).toMatchObject({
      consoleErrorCount: 1,
      consoleWarnCount: 1,
    });
  });

  it('touches neither table when a chunk carries neither', async () => {
    const { prisma, tx } = fakePrisma();
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );

    await processor.process(job());

    expect(tx.sessionError.createMany).not.toHaveBeenCalled();
    expect(tx.sessionChunk.upsert.mock.calls[0][0].create).toMatchObject({
      consoleErrorCount: 0,
      consoleWarnCount: 0,
    });
  });

  it('sums the session totals from its chunks and its error rows', async () => {
    const { prisma, tx } = fakePrisma();
    tx.sessionChunk.aggregate.mockResolvedValue({
      _min: { startedAt: new Date(1_724_832_000_000) },
      _max: { endedAt: new Date(1_724_832_030_000) },
      _sum: { consoleErrorCount: 4, consoleWarnCount: 2 },
    });
    tx.sessionError.count.mockResolvedValue(3);

    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );
    await processor.process(job());

    expect(tx.session.update.mock.calls[0][0].data).toMatchObject({
      errorCount: 3,
      consoleErrorCount: 4,
      consoleWarnCount: 2,
      // Thirty seconds with three errors in it is not a recording to hide.
      trivial: false,
    });
  });
});

describe('the search summary', () => {
  const START = 1_724_832_000_000;

  function withChunks(seqs: number[]) {
    const { prisma, tx } = fakePrisma();
    tx.sessionChunk.aggregate.mockResolvedValue({
      _min: { startedAt: new Date(START) },
      _max: { endedAt: new Date(START + 30_000) },
      _sum: {},
    });
    tx.sessionChunk.findMany.mockResolvedValue(
      seqs.map((seq: number) => ({ seq })),
    );
    return { prisma, tx };
  }

  it('writes the counts a list row shows and a filter selects on', async () => {
    const { prisma, tx } = withChunks([0, 1, 2]);
    tx.requestLink.count
      .mockResolvedValueOnce(12) // requests
      .mockResolvedValueOnce(2); // failures
    tx.requestLink.findMany.mockResolvedValue([
      { clientStartMs: BigInt(START), clientEndMs: BigInt(START + 41) },
      { clientStartMs: BigInt(START), clientEndMs: BigInt(START + 1_180) },
    ]);

    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );
    await processor.process(job());

    expect(tx.session.update.mock.calls[0][0].data).toMatchObject({
      requestCount: 12,
      failedRequestCount: 2,
      slowestRequestMs: 1_180,
      chunkCount: 3,
      missingChunkSeqs: [],
    });
  });

  it('records the sequence numbers that never arrived', async () => {
    // A gap means the recording is not the whole session. Storing it is what lets the viewer mark
    // the discontinuity instead of playing across it.
    const { prisma, tx } = withChunks([0, 1, 4]);

    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );
    await processor.process(job());

    expect(tx.session.update.mock.calls[0][0].data).toMatchObject({
      chunkCount: 3,
      missingChunkSeqs: [2, 3],
    });
  });

  it('leaves the slowest request null for a session that made none', async () => {
    const { prisma, tx } = withChunks([0]);

    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );
    await processor.process(job());

    expect(tx.session.update.mock.calls[0][0].data.slowestRequestMs).toBeNull();
  });
});

describe('the attribute index', () => {
  /**
   * A session row as Postgres hands it back — every optional column nullable, not absent. Typed
   * rather than inferred so that a test can say "this session has no release", which is what the
   * column actually holds and what the derivation has to cope with.
   */
  interface SessionRow {
    userId: string | null;
    release: string | null;
    url: string | null;
    userAgent: string | null;
    viewport: { w: number; h: number } | null;
    serviceNames: string[];
  }

  const SESSION: SessionRow = {
    userId: 'u_8823',
    release: 'web@2.4.1',
    url: 'https://app.acme.com/checkout',
    userAgent: null,
    viewport: { w: 1440, h: 900 },
    serviceNames: ['checkout-api'],
  };

  function indexing(over: Partial<SessionRow> = {}) {
    const { prisma, tx } = fakePrisma();
    tx.session.findUnique.mockResolvedValue({ ...SESSION, ...over });
    return { prisma, tx };
  }

  async function run(prisma: ReturnType<typeof fakePrisma>['prisma']) {
    const processor = new SessionChunkProcessor(
      prisma,
      storageReturning(Buffer.from(JSON.stringify(CHUNK))),
    );
    await processor.process(job());
  }

  it('writes a row per fact the session can be found by', async () => {
    const { prisma, tx } = indexing();
    tx.pageview.findMany.mockResolvedValue([
      { path: '/' },
      { path: '/checkout' },
    ]);

    await run(prisma);

    expect(tx.sessionAttribute.createMany.mock.calls[0][0].data).toEqual([
      {
        sessionId: SESSION_ID,
        projectId: 'proj_1',
        key: 'user',
        value: 'u_8823',
      },
      {
        sessionId: SESSION_ID,
        projectId: 'proj_1',
        key: 'release',
        value: 'web@2.4.1',
      },
      {
        sessionId: SESSION_ID,
        projectId: 'proj_1',
        key: 'host',
        value: 'app.acme.com',
      },
      { sessionId: SESSION_ID, projectId: 'proj_1', key: 'path', value: '/' },
      {
        sessionId: SESSION_ID,
        projectId: 'proj_1',
        key: 'path',
        value: '/checkout',
      },
      {
        sessionId: SESSION_ID,
        projectId: 'proj_1',
        key: 'device',
        value: 'desktop',
      },
      {
        sessionId: SESSION_ID,
        projectId: 'proj_1',
        key: 'viewport',
        value: '1440x900',
      },
      {
        sessionId: SESSION_ID,
        projectId: 'proj_1',
        key: 'service',
        value: 'checkout-api',
      },
    ]);
  });

  it('writes nothing twice when the rows are already there', async () => {
    // The whole session is reindexed on every chunk, so this is the ordinary case on any recording
    // longer than one flush — not an edge one.
    const { prisma, tx } = indexing({
      release: null,
      url: null,
      viewport: null,
    });
    tx.sessionAttribute.findMany.mockResolvedValue([
      { id: 'a1', key: 'user', value: 'u_8823' },
      { id: 'a2', key: 'device', value: 'desktop' },
      { id: 'a3', key: 'service', value: 'checkout-api' },
    ]);

    await run(prisma);

    expect(tx.sessionAttribute.createMany).not.toHaveBeenCalled();
    expect(tx.sessionAttribute.deleteMany).not.toHaveBeenCalled();
  });

  it('removes a fact that stopped being true', async () => {
    // The release the first chunk reported can be corrected by a later one. Keeping both would
    // make the session findable under a release it was never on.
    const { prisma, tx } = indexing({ release: 'web@2.4.2' });
    tx.sessionAttribute.findMany.mockResolvedValue([
      { id: 'stale', key: 'release', value: 'web@2.4.1' },
    ]);

    await run(prisma);

    expect(tx.sessionAttribute.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['stale'] } },
    });
    expect(tx.sessionAttribute.createMany.mock.calls[0][0].data).toContainEqual(
      expect.objectContaining({ key: 'release', value: 'web@2.4.2' }),
    );
  });

  it('does nothing for a session it cannot read back', async () => {
    // The upsert and the index are in one transaction, so this should not happen — and if it does,
    // indexing a session that is not there is not the way to find out.
    const { prisma, tx } = fakePrisma();
    await run(prisma);

    expect(tx.sessionAttribute.findMany).not.toHaveBeenCalled();
    expect(tx.sessionAttribute.createMany).not.toHaveBeenCalled();
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
      _sum: {},
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
      _sum: {},
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
      _sum: {},
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
  const empty = {
    durationMs: 900,
    linkCount: 0,
    failedCount: 0,
    errorCount: 0,
  };

  it('is true only for a recording that is both short and empty', () => {
    expect(isTrivial(empty)).toBe(true);
    expect(isTrivial({ ...empty, durationMs: 30_000 })).toBe(false);
    expect(isTrivial({ ...empty, linkCount: 3 })).toBe(false);
  });

  it('never marks a recording that contained a failure, however brief', () => {
    expect(
      isTrivial({
        durationMs: 200,
        linkCount: 1,
        failedCount: 1,
        errorCount: 0,
      }),
    ).toBe(false);
  });

  it('never marks a recording that threw, even with no requests at all', () => {
    // A two-second visit that ended in a TypeError is the shortest recording anyone will ever come
    // looking for, and hiding it by default would be the one unforgivable default.
    expect(isTrivial({ ...empty, errorCount: 1 })).toBe(false);
  });
});

describe('countConsole', () => {
  it('counts only the levels that mean something went wrong', () => {
    expect(
      countConsole([
        { level: 'error' },
        { level: 'warn' },
        { level: 'error' },
        { level: 'log' },
        { level: 'info' },
        { level: 'debug' },
      ]),
    ).toEqual({ error: 2, warn: 1 });
  });

  it('counts nothing when nothing was captured', () => {
    expect(countConsole([])).toEqual({ error: 0, warn: 0 });
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
