import { describe, expect, it } from 'vitest';
import {
  describeUserAgent,
  hostOf,
  MAX_ATTRIBUTES_PER_SESSION,
  MAX_ATTRIBUTE_VALUE_CHARS,
  missingChunkSeqs,
  sessionAttributes,
  slowestRequestMs,
} from './session-index.js';

/**
 * These are the functions a search reads through, so what is pinned here is mostly what they
 * refuse to do: index an empty value, index the same fact twice, grow without limit, or answer
 * differently on a second run over the same session.
 */

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

describe('sessionAttributes', () => {
  it('indexes what a session can be looked up by', () => {
    const facts = sessionAttributes({
      userId: 'u_8823',
      release: 'web@2.4.1',
      url: 'https://app.acme.com/checkout?step=2',
      userAgent: CHROME,
      viewport: { w: 1440, h: 900 },
      paths: ['/', '/cart', '/checkout'],
      serviceNames: ['checkout-api'],
    });

    expect(facts).toEqual([
      { key: 'user', value: 'u_8823' },
      { key: 'release', value: 'web@2.4.1' },
      { key: 'host', value: 'app.acme.com' },
      { key: 'path', value: '/' },
      { key: 'path', value: '/cart' },
      { key: 'path', value: '/checkout' },
      { key: 'browser', value: 'Chrome 131' },
      { key: 'os', value: 'Windows' },
      { key: 'device', value: 'desktop' },
      { key: 'viewport', value: '1440x900' },
      { key: 'service', value: 'checkout-api' },
    ]);
  });

  it('produces the same list twice, so a redelivered chunk writes the same rows', () => {
    const facts = { userId: 'u_1', paths: ['/a', '/b'], userAgent: CHROME };
    expect(sessionAttributes(facts)).toEqual(sessionAttributes(facts));
  });

  it('indexes a repeated page once', () => {
    // A session that bounced between two pages ten times is findable by both, not twenty times.
    const facts = sessionAttributes({ paths: ['/a', '/b', '/a', '/b'] });
    expect(facts.filter((fact) => fact.key === 'path')).toEqual([
      { key: 'path', value: '/a' },
      { key: 'path', value: '/b' },
    ]);
  });

  it('drops empty and whitespace-only values instead of indexing them', () => {
    // `release = ''` matches a filter nobody meant to write, and every session that never set one.
    const facts = sessionAttributes({
      userId: '',
      release: '   ',
      paths: [''],
    });
    expect(facts).toEqual([{ key: 'device', value: 'desktop' }]);
  });

  it('truncates a value written by the page rather than storing it whole', () => {
    const facts = sessionAttributes({ userId: 'u'.repeat(5_000) });
    const user = facts.find((fact) => fact.key === 'user');
    expect(user?.value).toHaveLength(MAX_ATTRIBUTE_VALUE_CHARS);
  });

  it('stops at the ceiling instead of indexing an unbounded flow', () => {
    const paths = Array.from({ length: 500 }, (_, i) => `/page/${i}`);
    expect(sessionAttributes({ paths })).toHaveLength(
      MAX_ATTRIBUTES_PER_SESSION,
    );
  });

  it('ignores a viewport that is not one', () => {
    // The column is Json, so a zero, a negative, or a NaN can all reach here.
    expect(
      sessionAttributes({ viewport: { w: 0, h: 900 } }),
    ).not.toContainEqual(expect.objectContaining({ key: 'viewport' }));
    expect(
      sessionAttributes({ viewport: { w: Number.NaN, h: 900 } }),
    ).not.toContainEqual(expect.objectContaining({ key: 'viewport' }));
  });

  it('says nothing about a host it cannot parse', () => {
    expect(hostOf('not a url')).toBeUndefined();
    expect(hostOf(null)).toBeUndefined();
  });
});

describe('describeUserAgent', () => {
  it('reads Chrome on Windows', () => {
    expect(describeUserAgent(CHROME)).toEqual({
      browser: 'Chrome 131',
      os: 'Windows',
      device: 'desktop',
    });
  });

  it('calls Edge Edge, not Chrome', () => {
    // Every Chromium browser claims to be Chrome. Checking in the wrong order makes every row
    // Chrome, which is the failure worth a test rather than the parsing itself.
    const edge = `${CHROME.replace('Safari/537.36', 'Safari/537.36 Edg/131.0.0.0')}`;
    expect(describeUserAgent(edge).browser).toBe('Edge 131');
  });

  it('calls Safari Safari, not Chrome', () => {
    const safari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
    expect(describeUserAgent(safari)).toEqual({
      browser: 'Safari 17',
      os: 'macOS',
      device: 'desktop',
    });
  });

  it('reads an iPhone as mobile', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(describeUserAgent(iphone)).toMatchObject({
      os: 'iOS',
      device: 'mobile',
    });
  });

  it('reads an Android tablet as a tablet, not a phone', () => {
    // No `Mobile` token is the only thing separating the two, and getting it wrong puts every
    // tablet session in the phone bucket.
    const tablet =
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    expect(describeUserAgent(tablet)).toEqual({
      browser: 'Chrome 131',
      os: 'Android',
      device: 'tablet',
    });
  });

  it('reads Chrome on iOS as Chrome, which is the product being used', () => {
    const crios =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1';
    expect(describeUserAgent(crios).browser).toBe('Chrome 131');
  });

  it('still answers the device for a user agent it does not recognize', () => {
    // Every session was on some kind of device, so this one has no undefined answer to give.
    expect(describeUserAgent('curl/8.4.0')).toEqual({ device: 'desktop' });
    expect(describeUserAgent(undefined)).toEqual({ device: 'desktop' });
  });
});

describe('slowestRequestMs', () => {
  it('takes the worst request, as the browser timed it', () => {
    expect(
      slowestRequestMs([
        { startMs: 1_000, endMs: 1_041 },
        { startMs: 2_000, endMs: 3_180 },
      ]),
    ).toBe(1_180);
  });

  it('says null for a session that made none, not zero', () => {
    // A threshold filter must not treat "made no requests" like "made instant ones".
    expect(slowestRequestMs([])).toBeNull();
  });

  it('never reports a negative worst case', () => {
    // The client clock can jump backwards mid-request. One that did would otherwise sort to the
    // top of "fastest" and out of every threshold.
    expect(slowestRequestMs([{ startMs: 5_000, endMs: 4_000 }])).toBe(0);
  });
});

describe('missingChunkSeqs', () => {
  it('finds the holes', () => {
    expect(missingChunkSeqs([0, 1, 3, 6])).toEqual([2, 4, 5]);
  });

  it('reports a lost first chunk, which is the one that makes a recording unplayable', () => {
    expect(missingChunkSeqs([1, 2])).toEqual([0]);
  });

  it('says nothing for a complete session, or one with no chunks at all', () => {
    expect(missingChunkSeqs([0, 1, 2])).toEqual([]);
    expect(missingChunkSeqs([])).toEqual([]);
  });

  it('does not invent a gap past the last chunk received', () => {
    // A session still being recorded is not missing the chunks it has not sent yet.
    expect(missingChunkSeqs([0])).toEqual([]);
  });

  it('is unmoved by the order they arrived in', () => {
    expect(missingChunkSeqs([6, 0, 3, 1])).toEqual([2, 4, 5]);
  });
});
