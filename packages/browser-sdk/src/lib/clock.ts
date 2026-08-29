/**
 * Clock calibration against the server (docs/ARCHITECTURE.md §3.5).
 *
 * This exists only so the viewer can *draw* server spans on the client's timeline. It can never
 * affect which spans belong to which request — that is decided by trace id, which no amount of
 * clock skew can corrupt.
 */

import type { ClockCalibration } from '@syncline/protocol';

export interface ClockSample {
  /** Client time when the request went out. */
  t0: number;
  /** Server time as reported. */
  serverMs: number;
  /** Client time when the response came back. */
  t1: number;
}

/**
 * NTP-style offset from a single round trip.
 *
 * Assumes the outbound and return legs took the same time, which is wrong in detail and close
 * enough at the resolution a timeline is drawn at. `rttMs` travels with it so the viewer can show
 * an uncertainty band instead of implying precision the measurement does not have.
 */
export function calibrate(sample: ClockSample): ClockCalibration {
  const rttMs = Math.max(0, sample.t1 - sample.t0);
  const offsetMs = Math.round(sample.serverMs - (sample.t0 + rttMs / 2));
  return { offsetMs, rttMs };
}

/** Picks the sample with the lowest round trip — the one least distorted by network jitter. */
export function bestOf(samples: ClockCalibration[]): ClockCalibration {
  if (samples.length === 0) return { offsetMs: 0, rttMs: 0 };
  return samples.reduce((best, s) => (s.rttMs < best.rttMs ? s : best));
}

export async function measureClock(
  endpoint: string,
  fetchImpl: typeof fetch,
  attempts = 3
): Promise<ClockCalibration> {
  const samples: ClockCalibration[] = [];

  for (let i = 0; i < attempts; i++) {
    try {
      const t0 = Date.now();
      const response = await fetchImpl(`${endpoint}/v1/clock`, { cache: 'no-store' });
      const t1 = Date.now();
      if (!response.ok) continue;

      const body = (await response.json()) as { serverMs?: unknown };
      if (typeof body.serverMs !== 'number') continue;

      samples.push(calibrate({ t0, serverMs: body.serverMs, t1 }));
    } catch {
      // A failed calibration is not a reason to stop recording. An uncalibrated session still
      // replays; its backend lane is just drawn with the client's own clock.
    }
  }

  return bestOf(samples);
}
