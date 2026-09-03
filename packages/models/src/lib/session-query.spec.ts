import { describe, expect, it } from 'vitest';
import {
  compileQuery,
  parseDuration,
  parseQuery,
  type ParsedQuery,
} from './session-query.js';

/**
 * The search language.
 *
 * Two things are worth pinning hardest. What the parser refuses to guess at — a search that
 * silently drops half of what was typed and returns a confident result is worse than one that
 * admits it did not understand. And that a threshold never compares text, because `'90' > '100'`
 * is true as strings and the wrong sessions come back looking right.
 */

const compiled = (input: string) => compileQuery(parseQuery(input));

describe('parseQuery', () => {
  it('reads a key and a value', () => {
    expect(parseQuery('user:u_8823').terms).toEqual([
      { key: 'user', values: ['u_8823'], comparator: 'eq', negated: false },
    ]);
  });

  it('reads several terms', () => {
    expect(parseQuery('user:u_1 path:/checkout').terms).toHaveLength(2);
  });

  it('lowercases the key but never the value', () => {
    // Keys are a vocabulary; values are somebody's identifier, and `Acct_9` is not `acct_9`.
    const [term] = parseQuery('AccountId:Acct_9').terms;
    expect(term).toMatchObject({ key: 'accountid', values: ['Acct_9'] });
  });

  it('takes a comma as "any of"', () => {
    expect(parseQuery('plan:pro,enterprise').terms[0]?.values).toEqual([
      'pro',
      'enterprise',
    ]);
  });

  it('reads the comparators', () => {
    expect(
      parseQuery('duration:>10s slowest:>=2s chunks:<5 errors:<=1').terms.map(
        (term) => term.comparator,
      ),
    ).toEqual(['gt', 'gte', 'lt', 'lte']);
  });

  it('negates with a leading dash', () => {
    expect(parseQuery('-is:trivial').terms[0]).toMatchObject({
      key: 'is',
      values: ['trivial'],
      negated: true,
    });
  });

  it('keeps a quoted value whole, spaces and commas included', () => {
    expect(parseQuery('path:"/a b,c"').terms[0]?.values).toEqual(['/a b,c']);
  });

  it('recognizes a bare session id, because pasting one is the commonest search', () => {
    expect(parseQuery('01JQ8Z3KX9TVFMWQ2Y7B4CN5HD').terms[0]).toMatchObject({
      key: 'session',
      values: ['01JQ8Z3KX9TVFMWQ2Y7B4CN5HD'],
    });
  });

  it('recognizes a bare trace id, and lowercases it', () => {
    expect(
      parseQuery('4BF92F3577B34DA6A3CE929D0E0E4736').terms[0],
    ).toMatchObject({
      key: 'trace',
      values: ['4bf92f3577b34da6a3ce929d0e0e4736'],
    });
  });

  it('reports what it did not understand rather than dropping it', () => {
    // The whole point: a result that answers a different question than the one asked, silently,
    // is the worst thing a search can do.
    const parsed = parseQuery('user:u_1 something odd');
    expect(parsed.terms).toHaveLength(1);
    expect(parsed.unparsed).toEqual(['something', 'odd']);
  });

  it('treats a key with no value as unparsed', () => {
    expect(parseQuery('user:').unparsed).toEqual(['user:']);
  });

  it('is empty for an empty query', () => {
    expect(parseQuery('   ')).toEqual({ terms: [], unparsed: [] });
  });

  it('does not take a leading colon as a key', () => {
    expect(parseQuery(':value').unparsed).toEqual([':value']);
  });
});

describe('parseDuration', () => {
  it('reads the units people actually type', () => {
    expect(parseDuration('500')).toBe(500);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('10s')).toBe(10_000);
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration('1.5s')).toBe(1_500);
  });

  it('refuses what is not a duration', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('10 s')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});

describe('compileQuery', () => {
  it('matches an attribute through its own row', () => {
    // `some` and not a join: two terms have to be satisfied by two different rows, which is what
    // makes `path:/cart path:/checkout` mean a session that visited both.
    expect(compiled('accountId:acct_9').where).toEqual([
      { attributes: { some: { key: 'accountid', value: { in: ['acct_9'] } } } },
    ]);
  });

  it('compares a numeric attribute against numValue, never the text', () => {
    expect(compiled('cartValue:>100').where).toEqual([
      { attributes: { some: { key: 'cartvalue', numValue: { gt: 100 } } } },
    ]);
  });

  it('reads a duration in the unit it was typed in', () => {
    expect(compiled('duration:>10s').where).toEqual([
      { durationMs: { gt: 10_000 } },
    ]);
  });

  it('compares a count as a plain number', () => {
    expect(compiled('errors:>0').where).toEqual([{ errorCount: { gt: 0 } }]);
  });

  it('reads an equality on a column as equality, not a range', () => {
    expect(compiled('chunks:3').where).toEqual([{ chunkCount: 3 }]);
  });

  it('turns has: into the condition it names', () => {
    expect(compiled('has:gap').where).toEqual([
      { missingChunkSeqs: { isEmpty: false } },
    ]);
  });

  it('falls through to "has this attribute at all" for an unknown has:', () => {
    // What makes `has:accountId` work for a key nobody enumerated.
    expect(compiled('has:accountId').where).toEqual([
      { attributes: { some: { key: 'accountId' } } },
    ]);
  });

  it('wraps a negated term rather than inverting the comparison', () => {
    // `NOT { errorCount > 0 }` and `errorCount <= 0` differ on a null, and inverting by hand is
    // how a filter starts quietly excluding rows it should return.
    expect(compiled('-has:error').where).toEqual([
      { NOT: { errorCount: { gt: 0 } } },
    ]);
  });

  it('looks a trace up through the link that recorded it', () => {
    expect(compiled('trace:4bf92f3577b34da6a3ce929d0e0e4736').where).toEqual([
      {
        links: {
          some: { traceId: { in: ['4bf92f3577b34da6a3ce929d0e0e4736'] } },
        },
      },
    ]);
  });

  it('rejects a threshold that is not a number, and says so', () => {
    const result = compiled('duration:>soon');
    expect(result.where).toEqual([]);
    expect(result.rejected[0]?.reason).toContain('not a number');
  });

  it('rejects an is: it does not know', () => {
    const result = compiled('is:purple');
    expect(result.where).toEqual([]);
    expect(result.rejected[0]?.reason).toContain('unknown condition');
  });

  it('combines terms additively, so more typing is always narrower', () => {
    expect(compiled('user:u_1 is:failed duration:>5s').where).toHaveLength(3);
  });

  it('produces nothing that could widen the caller’s scope', () => {
    // Every clause is additive and none of them names a project or an organization. A filter bug
    // must return the wrong sessions from the right project, never the right ones from another.
    const serialized = JSON.stringify(
      compiled('user:u_1 -is:trivial has:backend account:acct_9 trace:abc'),
    );
    expect(serialized).not.toContain('projectId');
    expect(serialized).not.toContain('organizationId');
  });

  it('compiles an empty query to no clauses at all', () => {
    const empty: ParsedQuery = { terms: [], unparsed: [] };
    expect(compileQuery(empty).where).toEqual([]);
  });
});

describe('resolving a key against the project vocabulary', () => {
  // The bug this exists to prevent: keys are stored with the case the application sent —
  // `accountId` — and `accountId:acct_9` lowercases to `accountid`, which matches no row. The
  // search then returns nothing while looking like a confident answer.
  const keys = ['accountId', 'cartValue', 'plan'];

  it('matches a camelCase key however it was typed', () => {
    for (const typed of [
      'accountId:acct_9',
      'accountid:acct_9',
      'ACCOUNTID:acct_9',
    ]) {
      expect(compileQuery(parseQuery(typed), { keys }).where).toEqual([
        {
          attributes: { some: { key: 'accountId', value: { in: ['acct_9'] } } },
        },
      ]);
    }
  });

  it('resolves the key on a threshold too', () => {
    expect(compileQuery(parseQuery('cartvalue:>100'), { keys }).where).toEqual([
      { attributes: { some: { key: 'cartValue', numValue: { gt: 100 } } } },
    ]);
  });

  it('resolves the key behind has:', () => {
    expect(compileQuery(parseQuery('has:accountid'), { keys }).where).toEqual([
      { attributes: { some: { key: 'accountId' } } },
    ]);
  });

  it('still compiles a key the project has never sent', () => {
    // A search run before the first chunk landed has to behave like the same search a minute
    // later, or the feature looks broken exactly when someone is setting it up.
    expect(compileQuery(parseQuery('newKey:v'), { keys }).where).toEqual([
      { attributes: { some: { key: 'newkey', value: { in: ['v'] } } } },
    ]);
  });

  it('needs no vocabulary at all', () => {
    expect(compileQuery(parseQuery('plan:pro')).where).toEqual([
      { attributes: { some: { key: 'plan', value: { in: ['pro'] } } } },
    ]);
  });
});
