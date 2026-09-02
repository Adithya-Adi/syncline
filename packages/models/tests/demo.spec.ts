import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionChunkSchema } from '@syncline/protocol';
import { sessionAttributes } from '../src/lib/session-index.js';
import {
  freshIds,
  pathOf,
  rebaseChunk,
  type DemoFixture,
} from '../prisma/demo.js';

/**
 * What the demo recording has to keep being.
 *
 * The fixture is generated, not written, so these are not tests of code so much as a contract with
 * whoever regenerates it: a demo that no longer plays, or whose trace no longer resolves, is worse
 * than no demo at all — it is the first thing a new install sees.
 *
 * The seeding path itself needs Postgres and MinIO and is not exercised here. What is exercised is
 * everything that can go wrong without them: the fixture's shape, the rebasing, and the id rewrite
 * that keeps two installs from colliding.
 */

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../prisma/demo/recording.json'), 'utf8'),
) as DemoFixture;

const SESSION_ID = '01M1EYQTFV2V9YH0K37JEPD409';
const BASE_MS = 1_780_000_000_000;

function rebased(baseMs = BASE_MS, ids = freshIds(fixture)) {
  return fixture.chunks.map((chunk) =>
    sessionChunkSchema.parse(
      rebaseChunk(chunk, SESSION_ID, fixture, baseMs, ids),
    ),
  );
}

describe('the demo fixture', () => {
  it('is a recording the player has something to draw', () => {
    expect(fixture.chunks.length).toBeGreaterThan(0);
    expect(fixture.durationMs).toBeGreaterThan(0);
  });

  it('gives every page its own keyframe', () => {
    // A chunk without a full snapshot cannot be jumped to, and the flow's whole promise is that
    // clicking a page takes you there. rrweb's EventType.FullSnapshot is 2.
    for (const chunk of fixture.chunks) {
      const events = chunk.events;
      expect(events.some((event) => event.type === 2)).toBe(true);
    }
  });

  it('contains the failure the demo exists to show', () => {
    const links = fixture.chunks.flatMap((chunk) => chunk.links);
    expect(links.some((link) => (link.status ?? 200) >= 400)).toBe(true);
  });

  it('contains the error the failure caused, inside the recorded window', () => {
    // Both halves matter. Without the error the demo shows an empty lane where the frontend's own
    // failure should be; outside the window it would be drawn somewhere the replay cannot reach.
    const errors = fixture.chunks.flatMap((chunk) => chunk.errors ?? []);
    expect(errors.length).toBeGreaterThan(0);

    for (const error of errors) {
      expect(error.timeMs).toBeGreaterThanOrEqual(0);
      expect(error.timeMs).toBeLessThanOrEqual(fixture.durationMs);
    }
  });

  it('keeps the generator’s own paths out of the committed stack', () => {
    // A real stack here names an absolute path on whoever regenerated the fixture, which would
    // make it diff on every machine and leak a home directory into the repo.
    for (const error of fixture.chunks.flatMap((chunk) => chunk.errors ?? [])) {
      expect(error.stack ?? '').not.toMatch(/build-demo-recording|[A-Z]:\\/);
    }
  });

  it('is findable by the things someone would search for', () => {
    // The demo is the first thing a new install searches, and a fixture regenerated without a
    // user id or a release would leave those filters matching nothing on the only recording there
    // is — which reads as search being broken rather than as a seed missing a field.
    const meta = fixture.meta as {
      release?: string;
      userAgent?: string;
      user?: { id?: string };
      viewport?: { w: number; h: number };
    };
    const pageviews = fixture.chunks.flatMap((chunk) => chunk.pageviews);

    const facts = sessionAttributes({
      userId: meta.user?.id ?? null,
      release: meta.release ?? null,
      url: pageviews[0]?.url ?? null,
      userAgent: meta.userAgent ?? null,
      viewport: meta.viewport ?? null,
      paths: pageviews.map((pageview) => pathOf(pageview.url)),
      serviceNames: fixture.spans.map((span) => span.serviceName),
    });

    const keys = new Set(facts.map((fact) => fact.key));
    for (const key of ['user', 'release', 'host', 'path', 'service']) {
      expect(keys).toContain(key);
    }

    // The page the demo is built around, so a `path:/checkout` search finds it.
    expect(facts).toContainEqual({ key: 'path', value: '/checkout' });
  });

  it('has a span for every trace a request points at', () => {
    // A request whose trace resolves to nothing is the one thing the viewer cannot explain, and it
    // reads as a broken install rather than a missing export.
    const traces = new Set(fixture.spans.map((span) => span.traceId));
    for (const chunk of fixture.chunks) {
      for (const link of chunk.links)
        expect(traces.has(link.traceId)).toBe(true);
    }
  });

  it('places every span inside the request that caused it', () => {
    const links = fixture.chunks.flatMap((chunk) => chunk.links);
    for (const span of fixture.spans) {
      const link = links.find(
        (candidate) => candidate.traceId === span.traceId,
      );
      expect(link).toBeDefined();
      expect(span.startOffsetMs).toBeGreaterThanOrEqual(
        (link as { startMs: number }).startMs,
      );
      expect(span.startOffsetMs + span.durationMs).toBeLessThanOrEqual(
        (link as { endMs: number }).endMs,
      );
    }
  });
});

describe('rebaseChunk', () => {
  it('produces chunks the ingest schema accepts', () => {
    // The same validation the worker applies. A fixture regenerated against a newer protocol should
    // fail here rather than at seed time on someone else's machine.
    expect(() => rebased()).not.toThrow();
  });

  it('moves the recording onto the given base', () => {
    const [first] = rebased();
    const timestamps = (first.events as { timestamp: number }[]).map(
      (event) => event.timestamp,
    );
    expect(Math.min(...timestamps)).toBeGreaterThanOrEqual(BASE_MS);
  });

  it('keeps the relative timing of everything it moves', () => {
    const early = rebased(BASE_MS);
    const late = rebased(BASE_MS + 9_000_000);

    const spread = (chunks: typeof early) =>
      chunks.flatMap((chunk) =>
        chunk.links.map((link) => link.endMs - link.startMs),
      );

    expect(spread(late)).toEqual(spread(early));
  });

  it('moves the errors on the chunk and their markers together', () => {
    // Two copies of one error — the marker in the replay stream and the row the worker writes from
    // the chunk — and a viewer joins them by nothing but their instant. Rebasing one and not the
    // other would put the mark and the frame it describes in different eras.
    for (const chunk of rebased()) {
      for (const error of chunk.errors) {
        expect(error.timeMs).toBeGreaterThanOrEqual(BASE_MS);
      }

      const markers = (
        chunk.events as {
          data?: { tag?: string; payload?: { timeMs?: number } };
        }[]
      ).filter((event) => event.data?.tag === 'syncline.error');

      expect(markers.map((event) => event.data?.payload?.timeMs)).toEqual(
        chunk.errors.map((error) => error.timeMs),
      );
    }
  });

  it('moves the timestamps inside request markers, not just rrweb’s own', () => {
    // The marker is what the replay is annotated with; a marker left in 2026 while the recording
    // says today would put the request lane an eternity from the frames it describes.
    for (const chunk of rebased()) {
      for (const event of chunk.events as {
        type: number;
        data?: { payload?: { startMs?: number } };
      }[]) {
        const startMs = event.data?.payload?.startMs;
        if (typeof startMs === 'number')
          expect(startMs).toBeGreaterThanOrEqual(BASE_MS);
      }
    }
  });
});

describe('freshIds', () => {
  it('mints ids of the shape the trace context requires', () => {
    for (const [original, minted] of freshIds(fixture)) {
      expect(minted).toMatch(new RegExp(`^[0-9a-f]{${original.length}}$`));
    }
  });

  it('gives two installs different ids', () => {
    // Span is keyed by (traceId, spanId). Reuse would make the second demo a silent no-op against
    // the first, and its trace would then resolve to another session's timestamps.
    const first = freshIds(fixture);
    const second = freshIds(fixture);
    for (const [original, minted] of first) {
      expect(second.get(original)).not.toBe(minted);
    }
  });

  it('rewrites a marker and its link to the same id', () => {
    // The viewer joins the replay to the network lane on spanId, and the lane to the trace on
    // traceId. Rewriting one and not the other breaks the jump without breaking anything visible.
    const ids = freshIds(fixture);
    const chunks = rebased(BASE_MS, ids);

    const markerSpanIds = chunks
      .flatMap(
        (chunk) =>
          chunk.events as {
            data?: { tag?: string; payload?: { spanId?: string } };
          }[],
      )
      .filter((event) => event.data?.tag === 'syncline.request')
      .map((event) => event.data?.payload?.spanId);

    const linkSpanIds = chunks.flatMap((chunk) =>
      chunk.links.map((link) => link.spanId),
    );

    expect(markerSpanIds.length).toBeGreaterThan(0);
    expect(new Set(markerSpanIds)).toEqual(new Set(linkSpanIds));
  });

  it('leaves an id nothing claimed alone', () => {
    expect(freshIds(fixture).get('not-in-the-fixture')).toBeUndefined();
  });
});

describe('pathOf', () => {
  // The worker derives this column from the same rule; the two disagreeing would file a seeded
  // page under a different path than an ingested one.
  it('takes the pathname', () => {
    expect(pathOf('https://acme.test/checkout?step=2')).toBe('/checkout');
  });

  it('prefers a hash route, because that is the path for a hash router', () => {
    expect(pathOf('https://acme.test/#/orders/9')).toBe('/orders/9');
  });

  it('falls back to / rather than leaving a null for every filter to handle', () => {
    expect(pathOf('not a url')).toBe('/');
  });
});
