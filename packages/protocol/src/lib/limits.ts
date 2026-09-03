/**
 * Ingest limits and SDK transport tuning.
 *
 * These live in protocol rather than in each app's config because both sides have to agree: the
 * SDK flushes before it can breach a limit, and the API rejects anything that does. Numbers are
 * from docs/ARCHITECTURE.md §4 and are starting points, not laws of nature.
 */

/** Rejected with 413 above this. Measured on the compressed body. */
export const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

/** A chunk carrying more rrweb events than this is malformed or hostile. */
export const MAX_EVENTS_PER_CHUNK = 5000;

/**
 * The hard ceiling on chunks in one session. Ingest rejects a higher sequence number.
 *
 * This is a validation bound, not a policy: the SDK rotates well before reaching it, so a session
 * arriving at 100 chunks means something is wrong rather than something is busy.
 */
export const MAX_CHUNKS_PER_SESSION = 100;

/**
 * Where the SDK rotates the session instead of continuing to number chunks.
 *
 * The gap to `MAX_CHUNKS_PER_SESSION` is deliberate headroom. Rotating means flushing the tail of
 * the old session first, and that flush needs a sequence number the API will still accept — at the
 * hard limit there would be nowhere to put it, and the last few seconds before every rotation would
 * be lost.
 *
 * Without this the cap was a silent death: past 100 chunks the SDK kept recording into a buffer it
 * never uploaded, and a busy page reaches 100 long before the one-hour ceiling would have rotated
 * it.
 */
export const CHUNKS_BEFORE_ROTATION = 90;

/** Upper bound on `links` per chunk. Requests outstanding at the boundary roll to the next one. */
export const MAX_LINKS_PER_CHUNK = 1000;

/**
 * Upper bound on pageview markers in one chunk.
 *
 * A chunk flushes at every page boundary, so in normal operation it carries one. More than a
 * handful means a redirect loop or a router thrashing, and neither is worth recording in full.
 */
export const MAX_PAGEVIEWS_PER_CHUNK = 50;

/** The SDK flushes on whichever of these two trips first. */
export const FLUSH_INTERVAL_MS = 5_000;
export const FLUSH_BYTES = 64 * 1024;

/**
 * A tab untouched for this long resumes as a new session.
 *
 * Thirty minutes is the industry's answer (Hotjar and Google Analytics both use it), which matters
 * more than the exact number being right: an analyst comparing Syncline's session count against
 * another tool should not have to reconcile two different definitions of the word.
 */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * An absolute ceiling on one session, regardless of activity.
 *
 * Without it a dashboard left open all day becomes a single ten-hour recording that nothing can
 * load. The session is rotated rather than truncated, so the recording continues under a new id
 * instead of silently stopping. One hour matches Sentry's replay ceiling.
 */
export const SESSION_MAX_DURATION_MS = 60 * 60 * 1000;

/**
 * How stale a full DOM snapshot may be before a page boundary forces a new one.
 *
 * Each pageview wants to start with a self-contained keyframe so the viewer can jump straight to it
 * without replaying everything before it. A snapshot is expensive — hundreds of kilobytes on a real
 * page — so a boundary reached moments after the last one reuses it rather than paying twice.
 */
export const FULL_SNAPSHOT_MIN_INTERVAL_MS = 30_000;

/**
 * Below this, a session with nothing in it is noise rather than a recording.
 *
 * It is a label, never a delete: a two-second visit that produced a failed request or an error is
 * exactly the recording someone will come looking for. Only the empty ones are marked, and the
 * recordings list hides those by default.
 */
export const TRIVIAL_SESSION_MS = 5_000;

/**
 * Above this round-trip time the clock calibration is too coarse to draw precisely, and the viewer
 * shows an uncertainty band instead of implying accuracy it does not have. See §3.5.
 */
export const CLOCK_UNCERTAINTY_THRESHOLD_MS = 100;

export const INGEST_KEY_HEADER = 'x-syncline-key';

/**
 * Bounds on captured diagnostics.
 *
 * Every one of these exists because the value being captured is written by the host page, not by
 * us. A message is whatever the application threw, a stack is as deep as its bundler made it, and
 * an argument to `console.log` can be a whole response body. Truncating is the difference between
 * a recording and an exfiltration channel with a size limit.
 */
export const MAX_ERROR_MESSAGE_CHARS = 1_000;
export const MAX_ERROR_STACK_CHARS = 4_000;
export const MAX_CONSOLE_MESSAGE_CHARS = 1_000;

/**
 * Upper bounds per chunk, for the same reason `links` has one.
 *
 * A page in an error loop produces thousands of identical entries a second. Past these the SDK
 * stops recording them rather than turning a recording into a log drain — the count is what
 * answers "did this session break", and the first few are what say how.
 */
export const MAX_ERRORS_PER_CHUNK = 100;
export const MAX_CONSOLE_ENTRIES_PER_CHUNK = 500;

/**
 * Bounds on the context an application attaches to a session.
 *
 * These are the tightest bounds in this file, and deliberately so. Everything else here is written
 * by the browser about the browser; context is written by the application about its customer, ends
 * up in a search index, and is the one thing here that someone will eventually be asked to delete.
 *
 * The key cap is what stops an application that spreads a whole user object into `setContext` from
 * turning one bad deploy into a permanent column of noise on every recording. The value cap is
 * short because an indexed value is something you type into a filter — a two-hundred-character
 * value is not one anybody is going to match exactly.
 */
export const MAX_CONTEXT_KEY_CHARS = 64;
export const MAX_CONTEXT_VALUE_CHARS = 200;

/**
 * How many distinct keys one session may carry, and how many changes one chunk may report.
 *
 * The two differ because they bound different things: a session that names its customer, their
 * account and their plan uses three keys forever, while a page that calls `setContext` in a render
 * loop reports the same three thousands of times. Past the per-chunk ceiling entries are dropped
 * rather than flushed early — the same rule errors and console output follow, and for the same
 * reason.
 */
export const MAX_CONTEXT_KEYS_PER_SESSION = 50;
export const MAX_CONTEXT_ENTRIES_PER_CHUNK = 200;

/**
 * What one project may send, per minute and per day.
 *
 * Every other bound in this file limits a single request. None of them limits how many requests
 * arrive, and that gap is the whole reason these exist: the public key is *designed* to ship in a
 * browser bundle, and the origin allowlist is enforced by browsers rather than by us — `curl` sets
 * `Origin` to whatever it likes. So anybody who reads a customer's bundle can post as that project
 * for as long as they care to, and without these two numbers nothing in the system would stop it
 * or even notice.
 *
 * The defaults are deliberately generous. A limit that a real busy site trips is a limit somebody
 * disables, and a disabled limit protects nothing. 1200 requests a minute is twenty a second
 * sustained; at a five-second flush that is roughly a hundred sessions recording at once, per
 * project. 5 GiB a day is far more than an honest install of this size writes.
 *
 * Both are overridable per deployment, and `0` disables one — which is the right answer for an
 * install on a private network where the only client is your own application.
 */
export const DEFAULT_INGEST_REQUESTS_PER_MINUTE = 1_200;
export const DEFAULT_INGEST_BYTES_PER_DAY = 5 * 1024 * 1024 * 1024;

/** Which ceiling a 429 hit, so a client can tell "slow down" from "come back tomorrow". */
export const INGEST_LIMITS = ['rate', 'volume'] as const;

export type IngestLimit = (typeof INGEST_LIMITS)[number];
