/**
 * The custom events Syncline writes into the replay stream.
 *
 * They are what make a recording self-describing. A trace ID sits at the exact frame the request
 * fired, so an exported session still resolves to its traces without a side table — and the same
 * holds for the rest: the page the user was on, the error that was thrown, the line that was
 * logged, all at the frame it happened rather than in a table joined on a timestamp.
 * See docs/ARCHITECTURE.md §3.2.
 */

import { z } from 'zod';
import {
  MAX_CONSOLE_MESSAGE_CHARS,
  MAX_CONTEXT_KEY_CHARS,
  MAX_CONTEXT_KEYS_PER_SESSION,
  MAX_CONTEXT_VALUE_CHARS,
  MAX_ERROR_MESSAGE_CHARS,
  MAX_ERROR_STACK_CHARS,
} from './limits.js';

/** rrweb's EventType.Custom. Hard-coded so protocol does not depend on rrweb. */
export const RRWEB_CUSTOM_EVENT_TYPE = 5;

export const REQUEST_START = 'syncline.request' as const;
export const REQUEST_END = 'syncline.response' as const;
export const PAGEVIEW = 'syncline.pageview' as const;
export const ERROR = 'syncline.error' as const;
export const CONSOLE = 'syncline.console' as const;
export const CONTEXT = 'syncline.context' as const;

/**
 * What moved the user to this page.
 *
 * Kept because the three are not equivalent when reading a flow: `load` is the entry point,
 * `popstate` is the back button — which is a usability signal, not navigation — and a `replaceState`
 * is usually a router normalizing a URL rather than the user going anywhere.
 */
export const PAGEVIEW_TRIGGERS = [
  'load',
  'pushState',
  'replaceState',
  'popstate',
  'hashchange',
] as const;

export type PageviewTrigger = (typeof PAGEVIEW_TRIGGERS)[number];

/**
 * A page in the session's flow.
 *
 * `ordinal` is assigned by the SDK and is the flow's order — not the arrival order of chunks, which
 * a lossy connection reshuffles. It resets to 0 when a session rotates, because that is a new flow.
 */
export const pageviewPayloadSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  /** Origin + pathname + sanitized search, same treatment as a request URL. */
  url: z.string().max(2048),
  startMs: z.number().int().nonnegative(),
  trigger: z.enum(PAGEVIEW_TRIGGERS),
});

export type PageviewPayload = z.infer<typeof pageviewPayloadSchema>;

/**
 * Start and end are separate events because rrweb's log is append-only — the SDK cannot reach back
 * and stamp a duration onto an event it has already emitted. They correlate by `spanId`.
 */
export const requestStartPayloadSchema = z.object({
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  spanId: z.string().regex(/^[0-9a-f]{16}$/),
  method: z.string().min(1).max(16),
  /** Origin + pathname + sanitized search. Query values are stripped by the SDK, keys kept. */
  url: z.string().max(2048),
  startMs: z.number().int().nonnegative(),
});

export const requestEndPayloadSchema = z.object({
  spanId: z.string().regex(/^[0-9a-f]{16}$/),
  endMs: z.number().int().nonnegative(),
  /** Absent when the request failed before producing a response. */
  status: z.number().int().min(100).max(599).optional(),
  error: z.string().max(256).optional(),
});

export type RequestStartPayload = z.infer<typeof requestStartPayloadSchema>;
export type RequestEndPayload = z.infer<typeof requestEndPayloadSchema>;

/**
 * Where an error came from.
 *
 * Kept apart because they answer different questions. `onerror` is code that threw on the main
 * thread and stopped whatever it was doing; `unhandledrejection` is a promise nobody caught, which
 * routinely means a request failed and the UI simply never updated — no stack trace at the point
 * the user noticed, and nothing on screen to say so.
 */
export const ERROR_SOURCES = ['onerror', 'unhandledrejection'] as const;

export type ErrorSource = (typeof ERROR_SOURCES)[number];

/**
 * An uncaught error, as the page reported it.
 *
 * Everything here is written by the host application, so everything here is bounded. The SDK
 * truncates before transmission rather than the API rejecting afterwards: a recording that drops
 * its last chunk because one stack trace was long is a worse outcome than a shortened stack.
 */
export const errorPayloadSchema = z.object({
  source: z.enum(ERROR_SOURCES),
  /** The constructor name — `TypeError`, `ChunkLoadError`. Absent when a non-Error was thrown. */
  name: z.string().max(128).optional(),
  message: z.string().max(MAX_ERROR_MESSAGE_CHARS),
  /** The script the error came from, sanitized the same way a request URL is. */
  fileUrl: z.string().max(2048).optional(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
  stack: z.string().max(MAX_ERROR_STACK_CHARS).optional(),
  timeMs: z.number().int().nonnegative(),
});

/**
 * Console levels worth keeping.
 *
 * `error` and `warn` are the two that describe something going wrong; the rest are opt-in on top
 * because an application that logs per render would otherwise dominate every chunk it appears in.
 */
export const CONSOLE_LEVELS = [
  'error',
  'warn',
  'info',
  'log',
  'debug',
] as const;

export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

/**
 * One console call, flattened to a string.
 *
 * Arguments are rendered by the SDK rather than sent structurally, and that is a privacy decision
 * rather than a convenience one: serializing arbitrary objects would walk into DOM nodes, framework
 * internals, and whatever a response body happened to contain. A bounded string of what was
 * printed is enough to read the recording alongside the replay.
 */
export const consolePayloadSchema = z.object({
  level: z.enum(CONSOLE_LEVELS),
  message: z.string().max(MAX_CONSOLE_MESSAGE_CHARS),
  timeMs: z.number().int().nonnegative(),
});

export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
export type ConsolePayload = z.infer<typeof consolePayloadSchema>;

/**
 * The key identity is stored under.
 *
 * Identity is context, not a parallel mechanism. Routing `identify()` through the same events as
 * `setContext()` means one ordering rule, one way to clear it, and one path into the search index —
 * rather than a second, subtly different one that has to be kept in step with the first.
 */
export const IDENTITY_KEY = 'user' as const;

/**
 * One thing the application says about the session it is recording.
 *
 * A value of `null` means unset, not "the empty string": logging out has to be able to take a key
 * away, and a recording that stays findable by the customer who left it is the wrong answer.
 *
 * Numbers and booleans are carried as themselves rather than stringified by the SDK, because the
 * server indexes a numeric value twice — as text for exact match, and as a number for the
 * threshold filters that a string index cannot answer.
 */
export const contextValueSchema = z.union([
  z.string().max(MAX_CONTEXT_VALUE_CHARS),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/**
 * Key names that are never transmitted and never stored, whatever anyone configures.
 *
 * Not a policy with an off switch, because the failure it prevents is not a preference: an
 * application that spreads its auth state into `setContext` would put a live credential into a
 * search index, readable by every member of the organization and surviving in backups long after
 * the token was rotated. There is no version of that which is the customer's call to make.
 *
 * It lives in protocol rather than beside the index because both ends need it. The SDK refuses
 * these before they reach the network, which is the only place refusing them actually protects
 * anybody; the server refuses them again, because an older SDK is still a client.
 *
 * Matched as a case-insensitive substring, so `apiKey`, `stripe_secret` and `X-Auth-Token` are all
 * caught. False positives are possible — a key genuinely called `tokenCount` is refused — and that
 * is the right side to be wrong on.
 */
export const SENSITIVE_KEY_PATTERN =
  /pass|secret|token|auth|cookie|session[_-]?id|credential|api[_-]?key|private|ssn|cvv|card[_-]?number/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export const contextEntrySchema = z.object({
  key: z.string().min(1).max(MAX_CONTEXT_KEY_CHARS),
  value: contextValueSchema,
  /** When the application said it. What makes a later call win over an earlier one. */
  timeMs: z.number().int().nonnegative(),
});

/**
 * One `identify` or `setContext` call, at the frame it happened.
 *
 * Grouped rather than one marker per key, because the call is the event: "they logged in here" is a
 * moment in the replay, and three markers in the same millisecond describe it worse than one.
 */
export const contextPayloadSchema = z.object({
  entries: z
    .array(contextEntrySchema.omit({ timeMs: true }))
    .max(MAX_CONTEXT_KEYS_PER_SESSION),
  timeMs: z.number().int().nonnegative(),
});

export type ContextValue = z.infer<typeof contextValueSchema>;
export type ContextEntry = z.infer<typeof contextEntrySchema>;
export type ContextPayload = z.infer<typeof contextPayloadSchema>;

export type SynclineEventTag =
  | typeof REQUEST_START
  | typeof REQUEST_END
  | typeof PAGEVIEW
  | typeof ERROR
  | typeof CONSOLE
  | typeof CONTEXT;

/** The shape rrweb wraps a custom event in. */
export interface RrwebCustomEvent<Tag extends string, Payload> {
  type: typeof RRWEB_CUSTOM_EVENT_TYPE;
  timestamp: number;
  data: { tag: Tag; payload: Payload };
}

export type RequestStartEvent = RrwebCustomEvent<
  typeof REQUEST_START,
  RequestStartPayload
>;
export type RequestEndEvent = RrwebCustomEvent<
  typeof REQUEST_END,
  RequestEndPayload
>;
export type PageviewEvent = RrwebCustomEvent<typeof PAGEVIEW, PageviewPayload>;
export type ErrorEvent = RrwebCustomEvent<typeof ERROR, ErrorPayload>;
export type ConsoleEvent = RrwebCustomEvent<typeof CONSOLE, ConsolePayload>;
export type ContextEvent = RrwebCustomEvent<typeof CONTEXT, ContextPayload>;
export type SynclineEvent =
  | RequestStartEvent
  | RequestEndEvent
  | PageviewEvent
  | ErrorEvent
  | ConsoleEvent
  | ContextEvent;

/**
 * Narrows an arbitrary rrweb event to one of ours.
 *
 * Deliberately structural rather than schema-validating: this runs while scanning thousands of
 * events, and the payloads are validated once at the ingest boundary instead.
 */
export function isSynclineEvent(event: unknown): event is SynclineEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as { type?: unknown; data?: { tag?: unknown } };
  if (e.type !== RRWEB_CUSTOM_EVENT_TYPE) return false;
  const tag = e.data?.tag;
  return (
    tag === REQUEST_START ||
    tag === REQUEST_END ||
    tag === PAGEVIEW ||
    tag === ERROR ||
    tag === CONSOLE ||
    tag === CONTEXT
  );
}
