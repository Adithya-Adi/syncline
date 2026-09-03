/**
 * The recordings search: what someone types, and what it selects.
 *
 * Two halves, kept apart on purpose. `parseQuery` turns text into terms and never touches the
 * database; `compileQuery` turns terms into a Prisma filter and never parses anything. That split
 * is what lets the whole language be tested without a database, and what keeps a parsing bug from
 * becoming a query that reads someone else's recordings.
 *
 * The syntax is `key:value`, because it is the one people already know from every issue tracker
 * and log tool. Three kinds of term:
 *
 *     user:u_8823 account:acct_412          an attribute, exactly
 *     duration:>10s slowest:>2s errors:>0   a threshold on a number
 *     has:error is:failed -is:trivial       presence, and its negation
 *
 * Everything unrecognized is an attribute lookup, which is what makes custom keys work with no
 * configuration: `plan:pro` filters on `plan` whether or not Syncline has ever heard of it.
 *
 * See PLAN.md §2.
 */

import { ATTRIBUTE_KEYS } from './session-index.js';

/** A comparison a threshold term can express. */
export type Comparator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte';

export interface QueryTerm {
  /** The filter's name as typed, lowercased. */
  key: string;
  /** Values to match. More than one means "any of" — `plan:pro,enterprise`. */
  values: string[];
  comparator: Comparator;
  /** `-user:u_1` excludes rather than selects. */
  negated: boolean;
}

export interface ParsedQuery {
  terms: QueryTerm[];
  /**
   * Words that were not `key:value`.
   *
   * Kept rather than dropped so the UI can say what it ignored. A search that silently discards
   * half of what was typed and returns a confident result is worse than one that says it did not
   * understand — the person reads the result as an answer to the question they asked.
   */
  unparsed: string[];
}

/**
 * Splits a query into terms.
 *
 * Whitespace separates, quotes group, and a leading `-` negates. Nothing here validates that a key
 * means anything: an unknown key is a valid attribute lookup, and the alternative — a list of
 * allowed keys inside the parser — is the pre-configuration trap in a different place.
 */
export function parseQuery(input: string): ParsedQuery {
  const terms: QueryTerm[] = [];
  const unparsed: string[] = [];

  for (const token of tokenize(input)) {
    const negated = token.startsWith('-');
    const body = negated ? token.slice(1) : token;

    const colon = body.indexOf(':');
    if (colon <= 0 || colon === body.length - 1) {
      // A bare ULID or trace id is unambiguous, so it is taken as the lookup it obviously is
      // rather than rejected — pasting an id from an alert is the commonest search there is.
      const bare = bareIdentifier(body);
      if (bare) {
        terms.push({ ...bare, negated });
        continue;
      }
      if (body.length > 0) unparsed.push(token);
      continue;
    }

    const key = body.slice(0, colon).toLowerCase();
    const raw = body.slice(colon + 1);
    const { comparator, rest } = comparatorOf(raw);

    // Commas separate alternatives — `plan:pro,enterprise` — and a value that contains one is
    // quoted. The split has to respect the quotes, or quoting stops being an escape hatch and
    // becomes a second way to get the wrong answer.
    const values = splitOutsideQuotes(rest, ',')
      .map((value) => unquote(value))
      .filter((value) => value.length > 0);

    if (values.length === 0) {
      unparsed.push(token);
      continue;
    }

    terms.push({ key, values, comparator, negated });
  }

  return { terms, unparsed };
}

/** ULIDs and trace ids are distinctive enough to recognize without being told what they are. */
function bareIdentifier(token: string): Omit<QueryTerm, 'negated'> | null {
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(token)) {
    return { key: 'session', values: [token], comparator: 'eq' };
  }
  if (/^[0-9a-f]{32}$/i.test(token)) {
    return { key: 'trace', values: [token.toLowerCase()], comparator: 'eq' };
  }
  return null;
}

function comparatorOf(raw: string): { comparator: Comparator; rest: string } {
  if (raw.startsWith('>=')) return { comparator: 'gte', rest: raw.slice(2) };
  if (raw.startsWith('<=')) return { comparator: 'lte', rest: raw.slice(2) };
  if (raw.startsWith('>')) return { comparator: 'gt', rest: raw.slice(1) };
  if (raw.startsWith('<')) return { comparator: 'lt', rest: raw.slice(1) };
  return { comparator: 'eq', rest: raw };
}

/** Splits on whitespace, except inside double quotes. */
function tokenize(input: string): string[] {
  return splitOutsideQuotes(input, null).filter(
    (token) => token.trim().length > 0,
  );
}

/**
 * Splits on a separator that appears outside quotes.
 *
 * `null` means "any whitespace", which is how tokenizing and value-splitting end up being the same
 * function — and being the same function is what keeps them from disagreeing about what a quote
 * means.
 */
function splitOutsideQuotes(input: string, separator: string | null): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }

    const splits = quoted
      ? false
      : separator === null
        ? /\s/.test(char)
        : char === separator;

    if (splits) {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts.filter((part) => part.length > 0);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1
    ? trimmed.slice(1, -1)
    : trimmed;
}

// ---------------------------------------------------------------------------------------------
// Compiling terms to a filter
// ---------------------------------------------------------------------------------------------

/**
 * Durations accept a unit, because "ten seconds" is what someone means and `10000` is not what
 * they want to type. A bare number is milliseconds, which is the unit everything else here uses.
 */
const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  sec: 1_000,
  m: 60_000,
  min: 60_000,
};

export function parseDuration(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)(ms|sec|min|s|m)?$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return Math.round(
    amount * (DURATION_UNITS[(match[2] ?? 'ms').toLowerCase()] ?? 1),
  );
}

/**
 * Filters that read a column on the session rather than an attribute row.
 *
 * These exist as columns because they are counts and durations — the things a list sorts by and a
 * threshold selects on. Everything not named here is an attribute, which is what leaves the custom
 * vocabulary open.
 */
const NUMERIC_COLUMNS: Record<string, string> = {
  duration: 'durationMs',
  requests: 'requestCount',
  failed: 'failedRequestCount',
  errors: 'errorCount',
  'console-errors': 'consoleErrorCount',
  'console-warns': 'consoleWarnCount',
  slowest: 'slowestRequestMs',
  chunks: 'chunkCount',
};

/** Which columns take a duration rather than a plain count. */
const DURATION_COLUMNS = new Set(['duration', 'slowest']);

/**
 * `has:` and `is:` — the presence questions, written the way people ask them.
 *
 * Each maps to a Prisma fragment rather than a column, because "has a gap" and "failed" are
 * conditions rather than values. `has:` with anything not listed falls through to "the session has
 * this attribute at all", which is how `has:accountId` works without being enumerated.
 */
const PRESENCE: Record<string, object> = {
  error: { errorCount: { gt: 0 } },
  'console-error': { consoleErrorCount: { gt: 0 } },
  'console-warn': { consoleWarnCount: { gt: 0 } },
  request: { requestCount: { gt: 0 } },
  failure: { failedRequestCount: { gt: 0 } },
  backend: { hasBackendSpans: true },
  gap: { missingChunkSeqs: { isEmpty: false } },
  user: { userId: { not: null } },
  release: { release: { not: null } },
};

const IS_CONDITIONS: Record<string, object> = {
  trivial: { trivial: true },
  failed: {
    OR: [{ failedRequestCount: { gt: 0 } }, { errorCount: { gt: 0 } }],
  },
  slow: { slowestRequestMs: { gte: 2_000 } },
  identified: { userId: { not: null } },
  instrumented: { hasBackendSpans: true },
};

export interface CompiledQuery {
  /** Prisma `AND` clauses, to be combined with the caller's own project scope. */
  where: object[];
  /** Terms that parsed but could not be compiled — a bad number, mostly. */
  rejected: { term: QueryTerm; reason: string }[];
}

export interface CompileOptions {
  /**
   * The keys this project actually uses, from `ProjectAttributeKey`.
   *
   * Attribute keys are stored with the case the application sent — `accountId`, not `accountid` —
   * because that is what the settings page and the suggestions have to show. But nobody types
   * case exactly, and an exact match on the wrong case returns nothing while looking like a
   * confident answer.
   *
   * So the typed key is resolved through the project's own vocabulary. Matching is exact once
   * resolved, which keeps the `(projectId, key, value)` index doing the work — a case-insensitive
   * comparison in SQL would not use it.
   */
  keys?: readonly string[];
}

/**
 * Turns terms into Prisma filter clauses.
 *
 * Every clause is additive and every one is a plain object — the caller supplies the project or
 * organization scope and this never sees it, so no query written here can widen it. That is the
 * property worth keeping: a filter bug returns the wrong sessions from the right project, never
 * the right sessions from the wrong one.
 */
export function compileQuery(
  parsed: ParsedQuery,
  options: CompileOptions = {},
): CompiledQuery {
  const where: object[] = [];
  const rejected: CompiledQuery['rejected'] = [];

  // Lowercase to as-stored. Built last-wins, which is arbitrary and only matters for a project
  // that sends both  and  — two keys that were always going to collide.
  const resolve = new Map(
    (options.keys ?? []).map((key) => [key.toLowerCase(), key]),
  );

  for (const term of parsed.terms) {
    const clause = compileTerm(term, rejected, resolve);
    if (!clause) continue;
    where.push(term.negated ? { NOT: clause } : clause);
  }

  return { where, rejected };
}

function compileTerm(
  term: QueryTerm,
  rejected: CompiledQuery['rejected'],
  resolve: ReadonlyMap<string, string>,
): object | null {
  const [first] = term.values;
  if (first === undefined) return null;

  if (term.key === 'session') {
    return { id: { in: term.values } };
  }

  if (term.key === 'trace') {
    // Through the request links, which is the only place a trace id is tied to a session.
    return { links: { some: { traceId: { in: term.values } } } };
  }

  if (term.key === 'has') {
    const named = PRESENCE[first.toLowerCase()];
    // Not a named condition, so it is an attribute key: "this session has one at all".
    return (
      named ?? {
        attributes: {
          some: { key: resolve.get(first.toLowerCase()) ?? first },
        },
      }
    );
  }

  if (term.key === 'is') {
    const condition = IS_CONDITIONS[first.toLowerCase()];
    if (!condition) {
      rejected.push({ term, reason: `unknown condition "${first}"` });
      return null;
    }
    return condition;
  }

  const column = NUMERIC_COLUMNS[term.key];
  if (column) return compileNumericColumn(term, column, rejected);

  return compileAttribute(term, rejected, resolve);
}

function compileNumericColumn(
  term: QueryTerm,
  column: string,
  rejected: CompiledQuery['rejected'],
): object | null {
  const [first] = term.values;
  if (first === undefined) return null;

  const amount = DURATION_COLUMNS.has(term.key)
    ? parseDuration(first)
    : Number(first);

  if (amount === null || !Number.isFinite(amount)) {
    rejected.push({ term, reason: `"${first}" is not a number` });
    return null;
  }

  return {
    [column]: term.comparator === 'eq' ? amount : { [term.comparator]: amount },
  };
}

/**
 * An attribute lookup: exact by text, or by number for a threshold.
 *
 * `some` rather than a join, because a session matching two terms has to match them in two
 * different rows — `path:/cart path:/checkout` means a session that visited both, and a single
 * joined row could never satisfy it.
 */
function compileAttribute(
  term: QueryTerm,
  rejected: CompiledQuery['rejected'],
  resolve: ReadonlyMap<string, string>,
): object | null {
  const [first] = term.values;
  if (first === undefined) return null;

  // As the project stores it when it is a key the project knows, as typed when it is not — an
  // unknown key still has to compile, or a search run before the first chunk landed would behave
  // differently from the same search a minute later.
  const key = resolve.get(term.key) ?? term.key;

  if (term.comparator !== 'eq') {
    const amount = Number(first);
    if (!Number.isFinite(amount)) {
      rejected.push({ term, reason: `"${first}" is not a number` });
      return null;
    }
    // Against `numValue`, never `value`: over text, '90' > '100' is true, so a threshold on the
    // text column returns the wrong sessions rather than failing.
    return {
      attributes: {
        some: { key, numValue: { [term.comparator]: amount } },
      },
    };
  }

  return { attributes: { some: { key, value: { in: term.values } } } };
}

/** Every filter name the query bar can suggest without having seen a project's data. */
export const BUILT_IN_FILTERS = [
  ...ATTRIBUTE_KEYS,
  ...Object.keys(NUMERIC_COLUMNS),
  'session',
  'trace',
  'has',
  'is',
] as const;

/** The values `has:` and `is:` understand, for suggestions. */
export const PRESENCE_VALUES = Object.keys(PRESENCE);
export const IS_VALUES = Object.keys(IS_CONDITIONS);
