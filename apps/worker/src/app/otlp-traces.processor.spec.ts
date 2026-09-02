import { linkSpansToSessions } from './otlp-traces.processor.js';

/**
 * What a batch of spans is allowed to do to a recording.
 *
 * The risk here is not getting the join wrong — it is doing anything at all to sessions the batch
 * has nothing to do with, and rewriting the same row on every one of the many batches a single
 * trace arrives in.
 */

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const OTHER = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SESSION = '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD';

function span(traceId: string, serviceName: string) {
  return { traceId, serviceName };
}

/** Enough of Prisma to see what the linkage tried to write. */
function fakeTx(
  links: { sessionId: string; traceId: string }[],
  sessions: {
    id: string;
    projectId: string;
    serviceNames: string[];
    hasBackendSpans: boolean;
  }[],
) {
  const tx = {
    requestLink: { findMany: jest.fn().mockResolvedValue(links) },
    session: {
      findMany: jest.fn().mockResolvedValue(sessions),
      update: jest.fn(),
    },
    sessionAttribute: { createMany: jest.fn() },
  };
  return tx;
}

describe('linkSpansToSessions', () => {
  it('marks the session its trace belongs to, and says which services answered', async () => {
    const tx = fakeTx(
      [{ sessionId: SESSION, traceId: TRACE }],
      [
        {
          id: SESSION,
          projectId: 'proj_1',
          serviceNames: [],
          hasBackendSpans: false,
        },
      ],
    );

    const updated = await linkSpansToSessions(tx, [
      span(TRACE, 'checkout-api'),
      span(TRACE, 'postgres'),
    ]);

    expect(updated).toBe(1);
    expect(tx.session.update).toHaveBeenCalledWith({
      where: { id: SESSION },
      data: {
        hasBackendSpans: true,
        serviceNames: ['checkout-api', 'postgres'],
      },
    });
  });

  it('makes the services searchable', async () => {
    const tx = fakeTx(
      [{ sessionId: SESSION, traceId: TRACE }],
      [
        {
          id: SESSION,
          projectId: 'proj_1',
          serviceNames: [],
          hasBackendSpans: false,
        },
      ],
    );

    await linkSpansToSessions(tx, [span(TRACE, 'checkout-api')]);

    expect(tx.sessionAttribute.createMany).toHaveBeenCalledWith({
      data: [
        {
          sessionId: SESSION,
          projectId: 'proj_1',
          key: 'service',
          value: 'checkout-api',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('merges with the services already recorded rather than replacing them', async () => {
    // A trace arrives in as many batches as it has services, and each batch only knows its own.
    const tx = fakeTx(
      [{ sessionId: SESSION, traceId: TRACE }],
      [
        {
          id: SESSION,
          projectId: 'proj_1',
          serviceNames: ['checkout-api'],
          hasBackendSpans: true,
        },
      ],
    );

    await linkSpansToSessions(tx, [span(TRACE, 'payments-api')]);

    expect(tx.session.update.mock.calls[0][0].data.serviceNames).toEqual([
      'checkout-api',
      'payments-api',
    ]);
  });

  it('does not rewrite a session that has nothing new to learn', async () => {
    // A redelivered batch, or a service exporting in many small ones, must not cost a write each.
    const tx = fakeTx(
      [{ sessionId: SESSION, traceId: TRACE }],
      [
        {
          id: SESSION,
          projectId: 'proj_1',
          serviceNames: ['checkout-api'],
          hasBackendSpans: true,
        },
      ],
    );

    const updated = await linkSpansToSessions(tx, [
      span(TRACE, 'checkout-api'),
    ]);

    expect(updated).toBe(0);
    expect(tx.session.update).not.toHaveBeenCalled();
    expect(tx.sessionAttribute.createMany).not.toHaveBeenCalled();
  });

  it('touches nothing when no recording references the batch', async () => {
    // Most spans in a real deployment are from cron jobs and queue consumers with no browser in
    // front of them. They must cost one lookup, not a write.
    const tx = fakeTx([], []);

    expect(await linkSpansToSessions(tx, [span(OTHER, 'nightly-job')])).toBe(0);
    expect(tx.session.findMany).not.toHaveBeenCalled();
    expect(tx.session.update).not.toHaveBeenCalled();
  });

  it('looks up only the traces the batch actually contains', async () => {
    const tx = fakeTx([], []);
    await linkSpansToSessions(tx, [span(TRACE, 'a'), span(TRACE, 'b')]);

    expect(tx.requestLink.findMany).toHaveBeenCalledWith({
      where: { traceId: { in: [TRACE] } },
      select: { sessionId: true, traceId: true },
    });
  });

  it('collapses a session that reached the same trace from several requests', async () => {
    const tx = fakeTx(
      [
        { sessionId: SESSION, traceId: TRACE },
        { sessionId: SESSION, traceId: TRACE },
      ],
      [
        {
          id: SESSION,
          projectId: 'proj_1',
          serviceNames: [],
          hasBackendSpans: false,
        },
      ],
    );

    await linkSpansToSessions(tx, [span(TRACE, 'checkout-api')]);

    expect(tx.session.update).toHaveBeenCalledTimes(1);
  });
});
