/**
 * What the application says about the session it is recording.
 *
 * Two calls, and the difference between them matters. `identify` says who this is; `setContext`
 * says anything else worth finding the session by later — an account, a tenant, a plan, a flag.
 * Identity gets its own call because it is the one key the product treats specially: it answers
 * "every session this person had", and it is what a deletion request is scoped by.
 *
 * Both are *late*. A recording starts at page load, and who the user is becomes known after they
 * sign in — often several chunks later. So context is emitted as timestamped changes rather than
 * written into the session's opening metadata, and the server applies the latest value to the
 * whole recording. A session that was anonymous for its first ten seconds is still findable by the
 * person it turned out to be.
 *
 * Nothing here is retained beyond the current values: this holds what has been set so that
 * `clearIdentity` knows what to take away, and so a value re-set to what it already was is not
 * re-sent on every render.
 */

import {
  isSensitiveKey,
  MAX_CONTEXT_KEY_CHARS,
  MAX_CONTEXT_KEYS_PER_SESSION,
  MAX_CONTEXT_VALUE_CHARS,
  type ContextEntry,
  type ContextValue,
} from '@syncline/protocol';

/** What an application may pass. `null` unsets a key; `undefined` is ignored, not an unset. */
export type ContextInput = Record<string, ContextValue | undefined>;

export interface ContextChange {
  entries: { key: string; value: ContextValue }[];
  /** Keys that were refused, and why. Reported through debug mode, never sent. */
  refused: { key: string; reason: 'sensitive' | 'invalid' | 'full' }[];
}

/**
 * The context currently attached to the recording.
 *
 * Deliberately not persisted across a page load. The server holds the session's context and
 * applies it to the whole recording, so a reload does not need the SDK to remember anything — and
 * a copy in `sessionStorage` would be one more place a customer identifier lives on the device.
 */
export class SessionContext {
  private readonly values = new Map<string, ContextValue>();

  /**
   * Works out what actually changed, and what to refuse.
   *
   * Returns only the differences, because an application that calls `setContext` inside a render
   * would otherwise emit the same three keys on every frame — thousands of identical entries that
   * the server would then have to collapse.
   */
  apply(input: ContextInput): ContextChange {
    const entries: { key: string; value: ContextValue }[] = [];
    const refused: ContextChange['refused'] = [];

    for (const [rawKey, rawValue] of Object.entries(input)) {
      // Absent is not the same as null. `{ plan: undefined }` is an application forgetting to set
      // something, and taking that as "unset the plan" would delete data on a typo.
      if (rawValue === undefined) continue;

      const key = rawKey.trim();

      if (key.length === 0 || key.length > MAX_CONTEXT_KEY_CHARS) {
        refused.push({ key: rawKey, reason: 'invalid' });
        continue;
      }

      // Refused here, in the browser, so a credential never reaches the network. The server
      // refuses the same keys again — an older SDK is still a client — but the only version of
      // this that protects anybody is the one that does not transmit.
      if (isSensitiveKey(key)) {
        refused.push({ key, reason: 'sensitive' });
        continue;
      }

      const value = normalize(rawValue);
      if (value === undefined) {
        refused.push({ key, reason: 'invalid' });
        continue;
      }

      if (this.values.get(key) === value) continue;

      // The ceiling counts keys held, not calls made, and unsetting is always allowed: a session
      // at the limit must still be able to log out.
      if (
        value !== null &&
        !this.values.has(key) &&
        this.values.size >= MAX_CONTEXT_KEYS_PER_SESSION
      ) {
        refused.push({ key, reason: 'full' });
        continue;
      }

      if (value === null) this.values.delete(key);
      else this.values.set(key, value);

      entries.push({ key, value });
    }

    return { entries, refused };
  }

  /** Unsets everything currently held. What logging out has to do to a recording. */
  clear(): ContextChange {
    const entries = [...this.values.keys()].map((key) => ({
      key,
      value: null as ContextValue,
    }));
    this.values.clear();
    return { entries, refused: [] };
  }

  /** What is currently attached. For tests and for debug output. */
  snapshot(): Record<string, ContextValue> {
    return Object.fromEntries(this.values);
  }
}

/**
 * Coerces a value to something indexable, or refuses it.
 *
 * Strings, finite numbers and booleans only. Objects and arrays are refused rather than
 * serialized: an indexed value is something a person types into a filter, and `{"id":1}` is not.
 * Refusing is also what keeps a whole user object — with whatever it happens to contain — from
 * being flattened into the index by an application that spread it into `setContext`.
 */
function normalize(value: ContextValue | undefined): ContextValue | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.length > MAX_CONTEXT_VALUE_CHARS
      ? trimmed.slice(0, MAX_CONTEXT_VALUE_CHARS)
      : trimmed;
  }
  return undefined;
}

/** Stamps a change with the instant it was made, which is what makes later beat earlier. */
export function timestamp(change: ContextChange, atMs: number): ContextEntry[] {
  return change.entries.map((entry) => ({ ...entry, timeMs: atMs }));
}
