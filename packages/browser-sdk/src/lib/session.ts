/**
 * Session identity.
 *
 * The id is minted client-side so the SDK can label chunks before it has spoken to the server, and
 * it survives navigation within a tab. It deliberately does *not* survive a new tab: two tabs are
 * two recordings, and merging them would produce a replay whose DOM jumps between windows.
 *
 * `sessionStorage` gives exactly that scope. An idle timeout also applies, so a tab left open
 * overnight starts a new session in the morning rather than producing an eight-hour recording with
 * a hole in the middle.
 */

import { ulid } from 'ulid';

const STORAGE_KEY = 'syncline.session';

/** A tab untouched for this long starts a fresh session. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface StoredSession {
  id: string;
  lastSeenMs: number;
}

export interface SessionState {
  id: string;
  isNew: boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function resolveSession(
  storage: StorageLike | undefined,
  now = Date.now(),
  idleTimeoutMs = IDLE_TIMEOUT_MS,
): SessionState {
  if (!storage) return { id: ulid(now), isNew: true };

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<StoredSession>;
      if (
        typeof stored.id === 'string' &&
        typeof stored.lastSeenMs === 'number' &&
        now - stored.lastSeenMs < idleTimeoutMs
      ) {
        touch(storage, stored.id, now);
        return { id: stored.id, isNew: false };
      }
    }
  } catch {
    // Private mode, disabled storage, or corrupt JSON. A fresh in-memory session is a fine
    // outcome; failing to record because of it would not be.
  }

  const id = ulid(now);
  touch(storage, id, now);
  return { id, isNew: true };
}

export function touch(
  storage: StorageLike | undefined,
  id: string,
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ id, lastSeenMs: now } satisfies StoredSession),
    );
  } catch {
    // Quota or a blocked storage API. Not worth interrupting the page for.
  }
}
