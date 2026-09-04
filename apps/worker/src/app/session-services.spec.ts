import { applyServiceNames, type ServiceTx } from './session-services.js';

/**
 * Which backend services a session touched.
 *
 * The bug behind this file: the flag was only ever set when spans arrived, on the assumption that
 * spans come after the recording. An exporter flushing in a second beats a five-second chunk
 * interval, and when it won, the link did not exist yet, the update was skipped, and nothing
 * retried. Sessions ended up with spans in the database and `hasBackendSpans: false` on the row.
 */

function fakeTx(
  sessions: {
    id: string;
    projectId: string;
    serviceNames: string[];
    hasBackendSpans: boolean;
  }[],
) {
  const tx = {
    session: {
      findMany: jest.fn(async () => sessions),
      update: jest.fn(async () => ({})),
    },
    sessionAttribute: { createMany: jest.fn(async () => ({})) },
  };
  return tx as unknown as ServiceTx & typeof tx;
}

const SESSION = {
  id: 's1',
  projectId: 'p1',
  serviceNames: [],
  hasBackendSpans: false,
};

describe('applyServiceNames', () => {
  it('marks a session whose spans arrived before its chunk', () => {
    // The case that was silently lost.
    const tx = fakeTx([SESSION]);

    return applyServiceNames(
      tx,
      new Map([['s1', new Set(['storefront-api'])]]),
    ).then((updated) => {
      expect(updated).toBe(1);
      expect(tx.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { hasBackendSpans: true, serviceNames: ['storefront-api'] },
        }),
      );
    });
  });

  it('makes the service searchable as well as visible', async () => {
    const tx = fakeTx([SESSION]);

    await applyServiceNames(tx, new Map([['s1', new Set(['checkout-api'])]]));

    expect(tx.sessionAttribute.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            sessionId: 's1',
            projectId: 'p1',
            key: 'service',
            value: 'checkout-api',
          },
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('merges rather than replaces, since each batch knows only its own service', async () => {
    const tx = fakeTx([
      { ...SESSION, serviceNames: ['checkout-api'], hasBackendSpans: true },
    ]);

    await applyServiceNames(tx, new Map([['s1', new Set(['payments-api'])]]));

    expect(tx.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          hasBackendSpans: true,
          serviceNames: ['checkout-api', 'payments-api'],
        },
      }),
    );
  });

  it('writes nothing when both halves already agree', async () => {
    // Both ingest paths now try this, so the second one to run must be a no-op rather than a
    // second write of the same row.
    const tx = fakeTx([
      { ...SESSION, serviceNames: ['storefront-api'], hasBackendSpans: true },
    ]);

    const updated = await applyServiceNames(
      tx,
      new Map([['s1', new Set(['storefront-api'])]]),
    );

    expect(updated).toBe(0);
    expect(tx.session.update).not.toHaveBeenCalled();
  });

  it('does not go looking when there is nothing to apply', async () => {
    const tx = fakeTx([SESSION]);
    expect(await applyServiceNames(tx, new Map())).toBe(0);
    expect(tx.session.findMany).not.toHaveBeenCalled();
  });
});
