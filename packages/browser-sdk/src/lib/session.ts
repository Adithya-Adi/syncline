/**
 * Session identity and lifetime.
 *
 * The id is minted client-side so the SDK can label chunks before it has spoken to the server, and
 * it survives navigation within a tab. It deliberately does *not* survive a new tab: two tabs are
 * two recordings, and merging them would produce a replay whose DOM jumps between windows.
 *
 * `sessionStorage` gives exactly that scope. Two limits then bound the result:
 *
 *   - an idle timeout, so a tab left open overnight starts a new session in the morning rather than
 *     producing an eight-hour recording with a hole in the middle;
 *   - an absolute ceiling, so a dashboard someone leaves open and keeps clicking does not become a
 *     single ten-hour recording that nothing can load. The session rotates — a new id continues the
 *     work — rather than the recording simply stopping.
 */

import { ulid } from 'ulid';
import {
  CHUNKS_BEFORE_ROTATION,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_MAX_DURATION_MS,
} from '@syncline/protocol';

const STORAGE_KEY = 'syncline.session';

/** Re-exported so callers configure lifetime from one place. */
export const IDLE_TIMEOUT_MS = SESSION_IDLE_TIMEOUT_MS;
export const MAX_DURATION_MS = SESSION_MAX_DURATION_MS;

interface StoredSession {
  id: string;
  lastSeenMs: number;
  /**
   * When this session began. Absent in sessions written by an older SDK, which are then treated as
   * having just started — the alternative is rotating everyone's live session on deploy.
   */
  startedMs?: number;
  /**
   * The next chunk sequence number this session should use.
   *
   * Persisted because the session id deliberately survives a page load while the recorder's
   * counter does not — it is closure state, so every navigation restarted numbering at zero and
   * the new page uploaded its chunks over the old page's. The storage key is built from
   * (session, seq), so the object was replaced; ingest deduplicates its queue job by the same
   * pair, so the row describing the original was never corrected. The recording ended up as the
   * second page's footage indexed against the first page's timeline.
   *
   * Absent in sessions written by an older SDK. Those resume at zero, which is what they did
   * before, so nothing gets worse on upgrade.
   */
  seq?: number;
}

export interface SessionState {
  id: string;
  startedMs: number;
  isNew: boolean;
  /** Where this page starts numbering. Zero for a session that began here. */
  nextSeq: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SessionLimits {
  idleTimeoutMs?: number;
  maxDurationMs?: number;
}

export function resolveSession(
  storage: StorageLike | undefined,
  now = Date.now(),
  limits: SessionLimits | number = {},
): SessionState {
  // A number keeps the original signature working, where the third argument was the idle timeout.
  const { idleTimeoutMs = IDLE_TIMEOUT_MS, maxDurationMs = MAX_DURATION_MS } =
    typeof limits === 'number' ? { idleTimeoutMs: limits } : limits;

  if (!storage)
    return { id: ulid(now), startedMs: now, isNew: true, nextSeq: 0 };

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<StoredSession>;
      const startedMs =
        typeof stored.startedMs === 'number' ? stored.startedMs : now;

      if (
        typeof stored.id === 'string' &&
        typeof stored.lastSeenMs === 'number' &&
        now - stored.lastSeenMs < idleTimeoutMs &&
        now - startedMs < maxDurationMs
      ) {
        // Resume numbering where the last page left off, so this one cannot overwrite its chunks.
        const nextSeq =
          typeof stored.seq === 'number' && stored.seq >= 0 ? stored.seq : 0;

        touch(storage, stored.id, now, startedMs, nextSeq);
        return { id: stored.id, startedMs, isNew: false, nextSeq };
      }
    }
  } catch {
    // Private mode, disabled storage, or corrupt JSON. A fresh in-memory session is a fine
    // outcome; failing to record because of it would not be.
  }

  const id = ulid(now);
  touch(storage, id, now, now, 0);
  return { id, startedMs: now, isNew: true, nextSeq: 0 };
}

/** Forgets the stored session, so the next resolve mints a new one. Used when rotating. */
export function clearSession(storage: StorageLike | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* the caller mints a fresh session regardless */
  }
}

export function touch(
  storage: StorageLike | undefined,
  id: string,
  now = Date.now(),
  startedMs = now,
  /**
   * The next sequence number to hand out. Written on every flush, so a page load part-way through
   * a session resumes numbering instead of restarting it and overwriting what is already stored.
   */
  seq = 0,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id,
        lastSeenMs: now,
        startedMs,
        seq,
      } satisfies StoredSession),
    );
  } catch {
    // Quota or a blocked storage API. Not worth interrupting the page for.
  }
}

/**
 * Whether a live session has outlived the ceiling.
 *
 * Checked by the recorder on its flush tick rather than on every event: a session crossing the hour
 * mark is not urgent to the millisecond, and testing it per event would put a clock read in the
 * hottest path the SDK has.
 */
export function hasOutlivedCeiling(
  session: Pick<SessionState, 'startedMs'>,
  now = Date.now(),
  maxDurationMs = MAX_DURATION_MS,
): boolean {
  return now - session.startedMs >= maxDurationMs;
}

/**
 * Whether the session should be rotated: too long, or too many chunks.
 *
 * Two limits, because either one alone leaves a hole. Time alone lets a busy page exhaust the chunk
 * budget in minutes and then record into a buffer nothing uploads. Chunk count alone lets a page
 * that is open but idle run for a day inside one recording.
 */
export function needsRotation(
  state: { startedMs: number; chunkCount: number },
  now = Date.now(),
  limits: {
    maxDurationMs?: number;
    chunksBeforeRotation?: number;
  } = {},
): boolean {
  const {
    maxDurationMs = MAX_DURATION_MS,
    chunksBeforeRotation = CHUNKS_BEFORE_ROTATION,
  } = limits;

  if (state.chunkCount >= chunksBeforeRotation) return true;
  return hasOutlivedCeiling(state, now, maxDurationMs);
}
