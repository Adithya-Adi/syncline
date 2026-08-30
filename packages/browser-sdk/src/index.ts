export { startRecording, type Recording } from './lib/recorder.js';
export { type SynclineOptions } from './lib/config.js';

// Exported for hosts that want to reason about what the SDK will and will not touch, and for the
// tests that pin those decisions.
export { shouldTrace, resolveOptions } from './lib/config.js';
export { sanitizeUrl } from './lib/url.js';
export { calibrate, bestOf, measureClock } from './lib/clock.js';
export { resolveSession, IDLE_TIMEOUT_MS } from './lib/session.js';
export { EventBuffer, PendingRequests } from './lib/buffer.js';
export {
  installFetchPatch,
  installXhrPatch,
  type TraceHooks,
} from './lib/trace.js';
export { encodeBody, sendChunk, chunkUrl } from './lib/transport.js';
