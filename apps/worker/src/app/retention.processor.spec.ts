import type { PrismaClient } from '@syncline/models';
import type { ObjectStore } from '@syncline/storage';
import {
  retentionWindowDays,
  RetentionProcessor,
} from './retention.processor.js';

/**
 * Deleting recordings that have aged out.
 *
 * This is the only code in the system that destroys customer data, so what is pinned here is
 * mostly what it refuses to do: delete anything nobody asked it to, delete rows before the blobs
 * they point at, or delete a span some surviving recording still needs.
 */

const DAY = 24 * 60 * 60 * 1000;

function fakeStore() {
  const deleted: string[] = [];
  return {
    deleted,
    deleteMany: jest.fn(async (keys: string[]) => {
      deleted.push(...keys);
      return keys.length;
    }),
    listPrefix: jest.fn(async () => []),
  } as unknown as ObjectStore & {
    deleted: string[];
    deleteMany: jest.Mock;
    listPrefix: jest.Mock;
  };
}

function fakePrisma(
  sessions: {
    id: string;
    chunks: { seq: number }[];
    links: { traceId: string }[];
  }[] = [],
  stillLinked: string[] = [],
  deletedProjects: { id: string; name: string }[] = [],
) {
  let served = false;

  const prisma = {
    project: {
      findMany: jest.fn(async (args?: { where?: { deletedAt?: unknown } }) =>
        // The sweep asks twice: once for deleted projects, once for live ones.
        args?.where?.deletedAt === null ? [{ id: 'proj_1' }] : deletedProjects,
      ),
      delete: jest.fn(async () => ({})),
    },
    projectAttributeKey: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    session: {
      // Served once, then empty — the sweep loops until a pass comes back short.
      findMany: jest.fn(async () => {
        if (served) return [];
        served = true;
        return sessions;
      }),
      deleteMany: jest.fn(async () => ({ count: sessions.length })),
      count: jest.fn(async () => 0),
    },
    requestLink: {
      findMany: jest.fn(async () => stillLinked.map((traceId) => ({ traceId }))),
    },
    span: { deleteMany: jest.fn(async () => ({ count: 1 })) },
  };

  return prisma as unknown as PrismaClient & typeof prisma;
}

describe('retentionWindowDays', () => {
  it('takes the configured number of days', () => {
    expect(retentionWindowDays(30)).toBe(30);
  });

  it('lets a self-hosted install keep things for as long as it likes', () => {
    expect(retentionWindowDays(3_650)).toBe(3_650);
  });

  it('reads zero as forever, not as "delete everything now"', () => {
    // The default, and the reason it is the default: an environment variable that arrived empty
    // must never be the instruction that wipes an install. There is no undo.
    expect(retentionWindowDays(0)).toBeNull();
  });

  it('ignores a negative or a non-number, which could only be a mistake', () => {
    expect(retentionWindowDays(-1)).toBeNull();
    expect(retentionWindowDays(Number.NaN)).toBeNull();
  });
});

describe('the sweep', () => {
  const session = {
    id: '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD',
    chunks: [{ seq: 0 }, { seq: 1 }],
    links: [{ traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }],
  };

  it('deletes no recordings when retention is unset', async () => {
    // Out of the box this destroys nothing. It still looks for deleted projects — that is not a
    // retention policy, it is an instruction somebody gave — but with none marked it stops there.
    const prisma = fakePrisma([session]);
    const store = fakeStore();

    const result = await new RetentionProcessor(prisma, store, 0).run();

    expect(result.sessions).toBe(0);
    expect(prisma.session.findMany).not.toHaveBeenCalled();
    expect(store.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the blobs before the rows that point at them', async () => {
    // The row is the only record of where its chunks live. Delete it first and the objects become
    // garbage nothing can ever find again — the key is built from ids the row held.
    const prisma = fakePrisma([session]);
    const store = fakeStore();

    await new RetentionProcessor(prisma, store, 30).run();

    const blobs = store.deleteMany.mock.invocationCallOrder[0];
    const rows = (prisma.session.deleteMany as jest.Mock).mock
      .invocationCallOrder[0];
    expect(blobs).toBeLessThan(rows);
  });

  it('removes every chunk of an expired session', async () => {
    const prisma = fakePrisma([session]);
    const store = fakeStore();

    const result = await new RetentionProcessor(prisma, store, 30).run();

    expect(store.deleted).toEqual([
      `sessions/proj_1/${session.id}/0.json.gz`,
      `sessions/proj_1/${session.id}/1.json.gz`,
    ]);
    expect(result.sessions).toBe(1);
  });

  it('cuts off at the configured age', async () => {
    const prisma = fakePrisma([session]);
    await new RetentionProcessor(prisma, fakeStore(), 7).run();

    const where = (prisma.session.findMany as jest.Mock).mock.calls[0][0].where;
    const days = Math.round(
      (Date.now() - (where.startedAt.lt as Date).getTime()) / DAY,
    );
    expect(days).toBe(7);
  });

  it('deletes spans whose last recording has gone', async () => {
    const prisma = fakePrisma([session], []);
    const result = await new RetentionProcessor(prisma, fakeStore(), 30).run();
    expect(result.spans).toBe(1);
  });

  it('keeps a span another recording still points at', async () => {
    // Spans are keyed by trace, and one trace can belong to more than one recording. Deleting on
    // age alone would take spans a surviving session still needs to draw.
    const prisma = fakePrisma([session], [
      '4bf92f3577b34da6a3ce929d0e0e4736',
    ]);

    const result = await new RetentionProcessor(prisma, fakeStore(), 30).run();

    expect(result.spans).toBe(0);
    expect(prisma.span.deleteMany).not.toHaveBeenCalled();
  });

  it('empties a deleted project even with retention switched off', async () => {
    // A deletion is not a retention policy. Someone typed the project's name to confirm it, and an
    // install that keeps everything forever must still honour that.
    const prisma = fakePrisma([session], [], [{ id: 'proj_1', name: 'Checkout' }]);
    const store = fakeStore();

    const result = await new RetentionProcessor(prisma, store, 0).run();

    expect(result.sessions).toBe(1);
    expect(result.projects).toBe(1);
    expect(store.deleted).toContain(`sessions/proj_1/${session.id}/0.json.gz`);
  });

  it('deletes the project row only once nothing is left behind it', async () => {
    // Session cascades from Project, so removing the row while sessions remain would take them
    // with it and strand every object they point at — unreachable, since the key came from the row.
    const prisma = fakePrisma([session], [], [{ id: 'proj_1', name: 'Checkout' }]);
    (prisma.session.count as jest.Mock).mockResolvedValue(3);

    const result = await new RetentionProcessor(prisma, fakeStore(), 0).run();

    expect(result.projects).toBe(0);
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('takes a deleted project regardless of how recent its recordings are', async () => {
    const prisma = fakePrisma([session], [], [{ id: 'proj_1', name: 'Checkout' }]);
    await new RetentionProcessor(prisma, fakeStore(), 0).run();

    // The cutoff for a deletion is "everything", not a window.
    const where = (prisma.session.findMany as jest.Mock).mock.calls[0][0].where;
    expect((where.startedAt.lt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('does no work for a project with nothing expired', async () => {
    const prisma = fakePrisma([]);
    const store = fakeStore();

    const result = await new RetentionProcessor(prisma, store, 30).run();

    expect(result.sessions).toBe(0);
    expect(store.deleteMany).not.toHaveBeenCalled();
  });
});
