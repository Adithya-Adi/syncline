/**
 * Formatting shared by the viewer and the sidecar.
 *
 * Both render the same two things — a duration and a request path — and rendering them differently
 * in the two halves of one screen would read as two different numbers.
 */

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/** Origin dropped. Every request in a recording is from one page, so the host is noise. */
export function shortPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}
