import { describe, expect, it } from 'vitest';
import { sessionChunkSchema } from './ingest.js';
import { MAX_EVENTS_PER_CHUNK } from './limits.js';
import {
  isSynclineEvent,
  REQUEST_START,
  RRWEB_CUSTOM_EVENT_TYPE,
} from './events.js';

const valid = {
  sessionId: '01JQ8Z3KX9TVFMWQ2Y7B4CN5HD',
  seq: 0,
  sdk: { name: 'syncline-browser', version: '0.1.0' },
  clock: { offsetMs: -142, rttMs: 38 },
  meta: { url: 'https://app.acme.com/checkout', viewport: { w: 1512, h: 856 } },
  events: [],
  links: [
    {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      method: 'POST',
      url: '/api/checkout',
      status: 500,
      startMs: 1724832000123,
      endMs: 1724832001901,
    },
  ],
};

describe('session chunk envelope', () => {
  it('accepts a well-formed chunk', () => {
    expect(sessionChunkSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults links so the worker never branches on undefined', () => {
    const { links, ...withoutLinks } = valid;
    expect(sessionChunkSchema.parse(withoutLinks).links).toEqual([]);
  });

  it('strips unknown keys instead of rejecting, so an old server survives a new SDK', () => {
    const parsed = sessionChunkSchema.parse({
      ...valid,
      futureField: 'whatever',
    });
    expect(parsed).not.toHaveProperty('futureField');
  });

  it('rejects a session id that is not a ULID', () => {
    expect(
      sessionChunkSchema.safeParse({ ...valid, sessionId: 'nope' }).success,
    ).toBe(false);
  });

  it('rejects malformed trace ids on links', () => {
    const links = [{ ...valid.links[0], traceId: 'ZZZ' }];
    expect(sessionChunkSchema.safeParse({ ...valid, links }).success).toBe(
      false,
    );
  });

  it('caps event count, so a hostile chunk is rejected before it is walked', () => {
    const events = new Array(MAX_EVENTS_PER_CHUNK + 1).fill({});
    expect(sessionChunkSchema.safeParse({ ...valid, events }).success).toBe(
      false,
    );
  });

  it('passes rrweb events through untouched', () => {
    const events = [{ type: 3, data: { source: 2, id: 42 }, timestamp: 1 }];
    expect(sessionChunkSchema.parse({ ...valid, events }).events).toEqual(
      events,
    );
  });
});

describe('syncline event detection', () => {
  it('recognizes our custom events', () => {
    expect(
      isSynclineEvent({
        type: RRWEB_CUSTOM_EVENT_TYPE,
        timestamp: 1,
        data: { tag: REQUEST_START, payload: {} },
      }),
    ).toBe(true);
  });

  it('ignores ordinary rrweb events and junk', () => {
    expect(isSynclineEvent({ type: 3, timestamp: 1, data: {} })).toBe(false);
    expect(
      isSynclineEvent({
        type: RRWEB_CUSTOM_EVENT_TYPE,
        data: { tag: 'someone.else' },
      }),
    ).toBe(false);
    expect(isSynclineEvent(null)).toBe(false);
    expect(isSynclineEvent('nope')).toBe(false);
  });
});
