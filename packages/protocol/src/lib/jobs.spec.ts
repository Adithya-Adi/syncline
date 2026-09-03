import { describe, expect, it } from 'vitest';
import { DEFAULT_JOB_OPTIONS } from './jobs.js';

/**
 * What the queue is allowed to keep.
 *
 * This exists because the dangerous value here is a plausible one. `removeOnFail: false` reads as
 * "keep failures so somebody can look at them", which is a reasonable thing to want and was what
 * this held — but Redis runs with eviction switched off, so nothing is ever reclaimed for us, and
 * a full queue refuses writes and stops ingest. A systematic fault fails every arriving chunk, and
 * unbounded failures turn that outage into a longer one.
 *
 * So both outcomes are asserted to be bounded by a count, rather than asserting the exact numbers:
 * tuning them is fine, removing the bound is not.
 */
describe('finished jobs', () => {
  it('bounds how many completed jobs are kept', () => {
    const { removeOnComplete } = DEFAULT_JOB_OPTIONS;

    expect(removeOnComplete).not.toBe(false);
    expect(removeOnComplete.count).toBeGreaterThan(0);
  });

  it('bounds how many failed jobs are kept', () => {
    // The one that regressed. `false` here means "forever", which on a queue that cannot evict is
    // a slow way to take ingest down.
    const { removeOnFail } = DEFAULT_JOB_OPTIONS;

    expect(removeOnFail).not.toBe(false);
    expect(removeOnFail.count).toBeGreaterThan(0);
  });

  it('still retries, so a bounded history is not a bounded attempt', () => {
    // Capping what is *kept* must not be confused with capping what is *tried*. A chunk that fails
    // on a blip should still get its retries.
    expect(DEFAULT_JOB_OPTIONS.attempts).toBeGreaterThan(1);
  });
});
