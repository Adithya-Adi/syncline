/**
 * The event buffer and its flush policy.
 *
 * rrweb produces events continuously; this decides when enough have accumulated to be worth a
 * request. Flushing on whichever of size or time trips first keeps a busy page from making a
 * request per mutation, and keeps an idle page from holding a recording in memory it may never
 * get to send.
 */

import {
  FLUSH_BYTES,
  FLUSH_INTERVAL_MS,
  MAX_EVENTS_PER_CHUNK,
  type Pageview,
  type RequestLink,
} from '@syncline/protocol';

export interface PendingChunk {
  events: unknown[];
  links: RequestLink[];
  pageviews: Pageview[];
}

export class EventBuffer {
  private events: unknown[] = [];
  private links: RequestLink[] = [];
  private pageviews: Pageview[] = [];
  /** Rough running total. Exact byte accounting would mean serializing on every event. */
  private approximateBytes = 0;

  constructor(
    private readonly maxBytes: number = FLUSH_BYTES,
    private readonly maxEvents: number = MAX_EVENTS_PER_CHUNK,
  ) {}

  addEvent(event: unknown, approximateSize = 0): void {
    this.events.push(event);
    this.approximateBytes += approximateSize;
  }

  addLink(link: RequestLink): void {
    this.links.push(link);
    this.approximateBytes += 200;
  }

  addPageview(pageview: Pageview): void {
    this.pageviews.push(pageview);
    this.approximateBytes += 200;
  }

  get size(): number {
    return this.events.length;
  }

  get isEmpty(): boolean {
    return (
      this.events.length === 0 &&
      this.links.length === 0 &&
      this.pageviews.length === 0
    );
  }

  shouldFlush(): boolean {
    return (
      this.approximateBytes >= this.maxBytes ||
      this.events.length >= this.maxEvents
    );
  }

  /** Hands over everything buffered and resets. */
  drain(): PendingChunk {
    const chunk = {
      events: this.events,
      links: this.links,
      pageviews: this.pageviews,
    };
    this.events = [];
    this.links = [];
    this.pageviews = [];
    this.approximateBytes = 0;
    return chunk;
  }
}

export const FLUSH_EVERY_MS = FLUSH_INTERVAL_MS;

/**
 * Tracks requests that started but have not finished.
 *
 * A request still in flight when a chunk flushes has no end time yet, so its link belongs in a
 * later chunk. The alternative — emitting a link with a guessed duration — would put a wrong
 * number on the timeline, which is worse than a link arriving a few seconds late.
 */
export class PendingRequests {
  private readonly started = new Map<
    string,
    Omit<RequestLink, 'status' | 'endMs'>
  >();

  start(payload: {
    traceId: string;
    spanId: string;
    method: string;
    url: string;
    startMs: number;
  }): void {
    this.started.set(payload.spanId, payload);
  }

  /** Returns the completed link, or null if we never saw the request begin. */
  finish(spanId: string, endMs: number, status?: number): RequestLink | null {
    const started = this.started.get(spanId);
    if (!started) return null;
    this.started.delete(spanId);

    return {
      traceId: started.traceId,
      spanId: started.spanId,
      method: started.method,
      url: started.url,
      startMs: started.startMs,
      endMs,
      ...(status !== undefined ? { status } : {}),
    };
  }

  get outstanding(): number {
    return this.started.size;
  }
}
