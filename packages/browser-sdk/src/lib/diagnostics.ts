/**
 * Captures uncaught errors and console output.
 *
 * The same two rules the trace patches follow (docs/ARCHITECTURE.md §3.7) apply here, and the
 * second one harder:
 *
 *   1. Never break the page. `console.error` is called from inside error handlers, so a throw in
 *      our wrapper lands in the middle of somebody else's recovery path. Every wrapper calls the
 *      original first and does its own work afterwards, inside a try.
 *   2. Never keep more than was asked for. Messages, stacks and argument lists are all written by
 *      the host application, so all three are truncated here rather than at the API — and console
 *      arguments are rendered to a bounded string rather than serialized, because serializing an
 *      arbitrary object walks into DOM nodes, framework internals, and response bodies.
 *
 * Error listeners are added rather than assigned. `window.onerror = ...` would replace whatever
 * the application already had there, which on a page that also runs Sentry means one of the two
 * stops receiving errors — and it would be ours that won, silently.
 */

import {
  CONSOLE_LEVELS,
  MAX_CONSOLE_MESSAGE_CHARS,
  MAX_ERROR_MESSAGE_CHARS,
  MAX_ERROR_STACK_CHARS,
  type ConsoleLevel,
  type ConsolePayload,
  type ErrorPayload,
} from '@syncline/protocol';
import { sanitizeUrl } from './url.js';

/** Everything the capture needs from `window`, so a test can hand it an object. */
type ErrorTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

type ConsoleTarget = Record<string, unknown>;

export interface DiagnosticsHooks {
  onError(payload: ErrorPayload): void;
  onConsole(payload: ConsolePayload): void;
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * What was thrown, described.
 *
 * `unknown` because a page can throw anything — a string, a number, `undefined`, a DOM event. The
 * common case is an Error and gets the full treatment; everything else is rendered rather than
 * dropped, since "the app threw the string 'nope'" is still the answer to why it stopped.
 */
export function describeThrown(thrown: unknown): {
  name?: string;
  message: string;
  stack?: string;
} {
  if (thrown instanceof Error) {
    return {
      ...(thrown.name ? { name: clamp(thrown.name, 128) } : {}),
      message: clamp(thrown.message || String(thrown), MAX_ERROR_MESSAGE_CHARS),
      ...(typeof thrown.stack === 'string' && thrown.stack
        ? { stack: clamp(thrown.stack, MAX_ERROR_STACK_CHARS) }
        : {}),
    };
  }

  return { message: clamp(renderValue(thrown), MAX_ERROR_MESSAGE_CHARS) };
}

/**
 * One console argument, rendered.
 *
 * Shallow on purpose. A depth-one object gives "which shape was this" without recursing into a
 * React fibre or a response body, and anything that refuses to stringify becomes its type name
 * rather than throwing inside a console call.
 */
export function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function')
    return `[Function ${value.name || 'anonymous'}]`;

  if (value instanceof Error) return `${value.name}: ${value.message}`;

  // A DOM node's `outerHTML` is the page's content, which rrweb is already recording under the
  // masking rules the host chose. Repeating it here would route around those rules.
  if (isElementLike(value)) return `<${String(value.nodeName).toLowerCase()}>`;

  try {
    const json = JSON.stringify(value, replacer());
    return json === undefined ? Object.prototype.toString.call(value) : json;
  } catch {
    // Circular, a getter that threw, or a proxy that refuses inspection.
    return Object.prototype.toString.call(value);
  }
}

function isElementLike(value: unknown): value is { nodeName: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { nodeType?: unknown }).nodeType === 'number' &&
    typeof (value as { nodeName?: unknown }).nodeName === 'string'
  );
}

/** Stops `JSON.stringify` from descending past the first level, or into a cycle. */
function replacer(): (key: string, value: unknown) => unknown {
  let root = true;
  const seen = new WeakSet<object>();

  return (_key, value) => {
    if (root) {
      root = false;
      return value;
    }
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
  };
}

/** Joins the arguments of one console call into the bounded string that gets recorded. */
export function renderConsoleArgs(args: unknown[]): string {
  const parts: string[] = [];
  let length = 0;

  for (const arg of args) {
    const rendered = renderValue(arg);
    parts.push(rendered);
    length += rendered.length + 1;
    // Stop rendering once the result is already over the limit. A hundred-argument call should not
    // cost a hundred serializations to produce a string that is then thrown away.
    if (length >= MAX_CONSOLE_MESSAGE_CHARS) break;
  }

  return clamp(parts.join(' '), MAX_CONSOLE_MESSAGE_CHARS);
}

/**
 * Listens for uncaught errors and unhandled promise rejections.
 *
 * Returns a function that removes both listeners.
 */
export function installErrorCapture(
  target: ErrorTarget,
  hooks: Pick<DiagnosticsHooks, 'onError'>,
  pageOrigin: string,
): () => void {
  const onError = (event: Event) => {
    try {
      const e = event as globalThis.ErrorEvent;
      const described = describeThrown(e.error ?? e.message);

      hooks.onError({
        source: 'onerror',
        ...described,
        // `message` from the event beats a rendered non-Error: the browser has already formatted
        // it, and for a cross-origin script it is the only thing there is.
        message: described.message || String(e.message ?? 'Unknown error'),
        ...(e.filename ? { fileUrl: sanitizeUrl(e.filename, pageOrigin) } : {}),
        ...(typeof e.lineno === 'number' && e.lineno > 0
          ? { line: e.lineno }
          : {}),
        ...(typeof e.colno === 'number' && e.colno > 0
          ? { column: e.colno }
          : {}),
        timeMs: Date.now(),
      });
    } catch {
      // A recorder that throws inside the page's error handler turns one bug into two.
    }
  };

  const onRejection = (event: Event) => {
    try {
      const reason = (event as PromiseRejectionEvent).reason;
      const described = describeThrown(reason);

      hooks.onError({
        source: 'unhandledrejection',
        ...described,
        message: described.message || 'Unhandled promise rejection',
        timeMs: Date.now(),
      });
    } catch {
      // As above.
    }
  };

  // Capture phase, so an application that stops propagation in its own handler does not decide
  // whether the error was recorded.
  target.addEventListener('error', onError, true);
  target.addEventListener('unhandledrejection', onRejection, true);

  return () => {
    target.removeEventListener('error', onError, true);
    target.removeEventListener('unhandledrejection', onRejection, true);
  };
}

/**
 * Wraps the console methods for the levels asked for.
 *
 * Returns a function that puts the originals back — and it restores by comparison, not blindly: if
 * something else wrapped the same method after us, overwriting it would remove their patch as well
 * as ours, which is the kind of thing that makes another vendor's logging quietly stop working.
 */
export function installConsoleCapture(
  target: ConsoleTarget,
  levels: readonly ConsoleLevel[],
  hooks: Pick<DiagnosticsHooks, 'onConsole'>,
): () => void {
  const originals = new Map<ConsoleLevel, unknown>();
  const installed = new Map<ConsoleLevel, unknown>();

  for (const level of levels) {
    if (!CONSOLE_LEVELS.includes(level)) continue;

    const original = target[level];
    if (typeof original !== 'function') continue;

    const patched = (...args: unknown[]) => {
      // The application's own output happens first and unconditionally. Whatever we do afterwards
      // is ours to get wrong.
      const result = (original as (...a: unknown[]) => unknown).apply(
        target,
        args,
      );

      try {
        hooks.onConsole({
          level,
          message: renderConsoleArgs(args),
          timeMs: Date.now(),
        });
      } catch {
        // Never let capture interfere with logging.
      }

      return result;
    };

    originals.set(level, original);
    installed.set(level, patched);
    target[level] = patched;
  }

  return () => {
    for (const [level, original] of originals) {
      if (target[level] === installed.get(level)) target[level] = original;
    }
  };
}
