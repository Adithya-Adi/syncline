import type { Pageview, PageviewTrigger } from '@syncline/protocol';
import { FULL_SNAPSHOT_MIN_INTERVAL_MS } from '@syncline/protocol';
import { sanitizeRouteUrl } from './url.js';

/**
 * The session's flow: which pages, in which order.
 *
 * Ordinals are assigned here rather than derived server-side from timestamps, because arrival order
 * is not flow order — a lossy connection reshuffles chunks, and two route changes inside the same
 * millisecond are indistinguishable by time. The SDK is the only place that knows the sequence for
 * certain.
 *
 * A rotation resets to zero. A new session id is a new flow, and continuing the count would imply
 * the two recordings were one journey.
 */
export class PageviewTracker {
  private ordinal = -1;
  private lastSnapshotMs = 0;

  constructor(
    private readonly snapshotIntervalMs: number = FULL_SNAPSHOT_MIN_INTERVAL_MS,
  ) {}

  get current(): number {
    return Math.max(this.ordinal, 0);
  }

  /** Starts the next page and returns the marker to record. */
  enter(url: string, trigger: PageviewTrigger, nowMs: number): Pageview {
    this.ordinal += 1;
    return {
      ordinal: this.ordinal,
      url: sanitizeRouteUrl(url),
      startMs: nowMs,
      trigger,
    };
  }

  reset(): void {
    this.ordinal = -1;
    this.lastSnapshotMs = 0;
  }

  /**
   * Whether this boundary should force a fresh full DOM snapshot.
   *
   * A snapshot is what lets the viewer jump to a page without replaying everything before it, so
   * every page wants one — but it costs hundreds of kilobytes on a real page, and a router that
   * redirects twice in a second would otherwise pay for it three times.
   */
  shouldSnapshot(nowMs: number): boolean {
    if (nowMs - this.lastSnapshotMs < this.snapshotIntervalMs) return false;
    this.lastSnapshotMs = nowMs;
    return true;
  }

  /** Called when rrweb takes a snapshot for its own reasons, so a boundary can reuse it. */
  noteSnapshot(nowMs: number): void {
    this.lastSnapshotMs = nowMs;
  }
}
