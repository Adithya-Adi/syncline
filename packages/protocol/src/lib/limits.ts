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

/** Past this many chunks a session is cut off rather than grown without bound. */
export const MAX_CHUNKS_PER_SESSION = 100;

/** Upper bound on `links` per chunk. Requests outstanding at the boundary roll to the next one. */
export const MAX_LINKS_PER_CHUNK = 1000;

/** The SDK flushes on whichever of these two trips first. */
export const FLUSH_INTERVAL_MS = 5_000;
export const FLUSH_BYTES = 64 * 1024;

/**
 * Above this round-trip time the clock calibration is too coarse to draw precisely, and the viewer
 * shows an uncertainty band instead of implying accuracy it does not have. See §3.5.
 */
export const CLOCK_UNCERTAINTY_THRESHOLD_MS = 100;

export const INGEST_KEY_HEADER = 'x-syncline-key';
