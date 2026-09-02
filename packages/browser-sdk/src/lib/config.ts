/**
 * SDK configuration and the origin allowlist.
 *
 * The allowlist decides which requests get a `traceparent` header. It is the most consequential
 * setting here: injecting the header into a third party leaks internal trace ids and, worse, adds
 * a header their CORS policy does not allow — turning a working request into a failed preflight.
 * See docs/ARCHITECTURE.md §3.7.
 */

import { CONSOLE_LEVELS, type ConsoleLevel } from '@syncline/protocol';

export interface SynclineOptions {
  /** Public project key, `pk_*`. Safe to ship in a bundle; it is gated by the origin allowlist. */
  key: string;
  /** Base URL of the Syncline API, e.g. `https://syncline.example.com`. */
  endpoint: string;
  /**
   * Origins whose requests get a traceparent. Defaults to the page's own origin, which is the
   * answer for a same-origin API and the safe answer for everything else.
   */
  traceOrigins?: string[];
  /** Attached to the session so a replay can be tied back to a deploy. */
  release?: string;
  user?: { id: string };
  /**
   * Masks the value of every input, textarea and select. On by default: rrweb records whatever is
   * on screen, so the safe default has to be the one you opt out of.
   */
  maskAllInputs?: boolean;
  /**
   * Records uncaught errors and unhandled promise rejections. On by default.
   *
   * The one capture here that is not opt-in, because it is the one the product exists for: a
   * recording of a session that broke, with no record of what broke, answers nothing. The volume
   * is bounded by definition — a page throwing constantly is already unusable — and the content is
   * an error the application itself surfaced rather than data it was holding.
   */
  captureErrors?: boolean;
  /**
   * Records console output. Off by default, and `['error', 'warn']` when switched on with `true`.
   *
   * Opt-in because the arguments are whatever the application chose to print, which on plenty of
   * codebases includes tokens, request bodies, and personal data — none of which the person being
   * recorded agreed to hand over. Pass the levels explicitly to go wider.
   */
  captureConsole?: boolean | ConsoleLevel[];
  /** Emits SDK diagnostics to the console. Off by default. */
  debug?: boolean;
}

export interface ResolvedOptions extends Required<
  Omit<SynclineOptions, 'release' | 'user' | 'captureConsole'>
> {
  release?: string;
  user?: { id: string };
  /** Resolved to the levels themselves; empty means console capture is off. */
  captureConsole: ConsoleLevel[];
}

/** What `captureConsole: true` means. The two levels that describe something going wrong. */
const DEFAULT_CONSOLE_LEVELS: ConsoleLevel[] = ['error', 'warn'];

/**
 * Turns the console option into a level list.
 *
 * An unknown level is dropped rather than rejected: a config written against a newer SDK should
 * lose that one level, not stop the recording.
 */
export function resolveConsoleLevels(
  option: boolean | ConsoleLevel[] | undefined,
): ConsoleLevel[] {
  if (option === undefined || option === false) return [];
  if (option === true) return [...DEFAULT_CONSOLE_LEVELS];
  return option.filter((level) => CONSOLE_LEVELS.includes(level));
}

export function resolveOptions(
  options: SynclineOptions,
  pageOrigin: string,
): ResolvedOptions {
  if (!options.key) throw new Error('syncline: `key` is required');
  if (!options.endpoint) throw new Error('syncline: `endpoint` is required');

  return {
    key: options.key,
    endpoint: options.endpoint.replace(/\/+$/, ''),
    traceOrigins: (options.traceOrigins ?? [pageOrigin]).map(normalizeOrigin),
    maskAllInputs: options.maskAllInputs ?? true,
    captureErrors: options.captureErrors ?? true,
    captureConsole: resolveConsoleLevels(options.captureConsole),
    debug: options.debug ?? false,
    ...(options.release ? { release: options.release } : {}),
    ...(options.user ? { user: options.user } : {}),
  };
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    // Left as-is so an obviously wrong entry fails to match rather than throwing during setup and
    // taking the host page down with it.
    return origin;
  }
}

/**
 * Decides whether a request may carry a traceparent.
 *
 * Relative URLs are same-origin by definition and always qualify. Anything absolute has to match
 * an allowlisted origin exactly — no subdomain wildcards, because "*.acme.com" would happily
 * include a third-party widget someone parked on a subdomain.
 */
export function shouldTrace(
  url: string,
  allowlist: string[],
  pageOrigin: string,
): boolean {
  let target: URL;
  try {
    target = new URL(url, pageOrigin);
  } catch {
    return false;
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  return allowlist.includes(target.origin);
}
