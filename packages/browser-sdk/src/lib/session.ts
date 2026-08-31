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
}

export interface SessionState {
  id: string;
  startedMs: number;
  isNew: boolean;
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

  if (!storage) return { id: ulid(now), startedMs: now, isNew: true };

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
        touch(storage, stored.id, now, startedMs);
        return { id: stored.id, startedMs, isNew: false };
      }
    }
  } catch {
    // Private mode, disabled storage, or corrupt JSON. A fresh in-memory session is a fine
    // outcome; failing to record because of it would not be.
  }

  const id = ulid(now);
  touch(storage, id, now, now);
  return { id, startedMs: now, isNew: true };
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
): void {
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id,
        lastSeenMs: now,
        startedMs,
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
