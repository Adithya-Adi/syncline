import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_KEYS_PER_SESSION } from '@syncline/protocol';
import { SessionContext } from './context.js';

/**
 * What the application is allowed to attach to a recording, and what it is not.
 *
 * The interesting cases are all refusals and no-ops: this runs on someone else's page, on every
 * render if they wire it that way, and the values are about their customers.
 */

describe('setContext', () => {
  it('reports what changed', () => {
    const context = new SessionContext();
    expect(context.apply({ accountId: 'acct_9', plan: 'pro' }).entries).toEqual(
      [
        { key: 'accountId', value: 'acct_9' },
        { key: 'plan', value: 'pro' },
      ],
    );
  });

  it('says nothing when nothing moved', () => {
    // The case that decides whether this is safe to call from a render: an application setting the
    // same three values on every frame must not emit three entries per frame.
    const context = new SessionContext();
    context.apply({ plan: 'pro' });
    expect(context.apply({ plan: 'pro' }).entries).toEqual([]);
  });

  it('reports only the key that actually moved', () => {
    const context = new SessionContext();
    context.apply({ plan: 'free', accountId: 'acct_9' });
    expect(context.apply({ plan: 'pro', accountId: 'acct_9' }).entries).toEqual(
      [{ key: 'plan', value: 'pro' }],
    );
  });

  it('treats null as an unset and undefined as nothing at all', () => {
    // `{ plan: undefined }` is an application forgetting to set something. Taking that as an unset
    // would delete data on a typo.
    const context = new SessionContext();
    context.apply({ plan: 'pro', accountId: 'acct_9' });

    const change = context.apply({ plan: null, accountId: undefined });

    expect(change.entries).toEqual([{ key: 'plan', value: null }]);
    expect(context.snapshot()).toEqual({ accountId: 'acct_9' });
  });

  it('refuses anything that looks like a credential, before it reaches the network', () => {
    const context = new SessionContext();
    const change = context.apply({ apiKey: 'sk_live_1', password: 'hunter2' });

    expect(change.entries).toEqual([]);
    expect(change.refused).toEqual([
      { key: 'apiKey', reason: 'sensitive' },
      { key: 'password', reason: 'sensitive' },
    ]);
    expect(context.snapshot()).toEqual({});
  });

  it('refuses a value that is not something anyone would filter by', () => {
    // Objects and arrays are refused rather than serialized. An indexed value is something a
    // person types into a filter, and it is also what stops a whole user object — with whatever it
    // happens to contain — being flattened into the index by a careless spread.
    const context = new SessionContext();
    const change = context.apply({
      user: { id: 1 } as never,
      tags: ['a'] as never,
      ratio: Number.NaN,
    });

    expect(change.entries).toEqual([]);
    expect(change.refused.map((refusal) => refusal.reason)).toEqual([
      'invalid',
      'invalid',
      'invalid',
    ]);
  });

  it('keeps numbers and booleans as themselves', () => {
    // Stringifying here would lose the server's ability to index a number for threshold filters.
    const context = new SessionContext();
    expect(context.apply({ cartValue: 142.5, beta: false }).entries).toEqual([
      { key: 'cartValue', value: 142.5 },
      { key: 'beta', value: false },
    ]);
  });

  it('trims a key and drops an empty one', () => {
    const context = new SessionContext();
    const change = context.apply({ '  plan  ': 'pro', '   ': 'x' });

    expect(change.entries).toEqual([{ key: 'plan', value: 'pro' }]);
    expect(change.refused).toEqual([{ key: '   ', reason: 'invalid' }]);
  });

  it('stops adding keys at the ceiling, but still lets one be unset', () => {
    // A session at the limit must still be able to log out.
    const context = new SessionContext();
    for (let i = 0; i < MAX_CONTEXT_KEYS_PER_SESSION; i += 1) {
      context.apply({ [`k${i}`]: 'v' });
    }

    expect(context.apply({ overflow: 'v' }).refused).toEqual([
      { key: 'overflow', reason: 'full' },
    ]);
    expect(context.apply({ k0: null }).entries).toEqual([
      { key: 'k0', value: null },
    ]);
  });
});

describe('clearIdentity', () => {
  it('unsets everything currently held', () => {
    const context = new SessionContext();
    context.apply({ user: 'u_1', accountId: 'acct_9' });

    expect(context.clear().entries).toEqual([
      { key: 'user', value: null },
      { key: 'accountId', value: null },
    ]);
    expect(context.snapshot()).toEqual({});
  });

  it('says nothing when there was nothing attached', () => {
    expect(new SessionContext().clear().entries).toEqual([]);
  });

  it('lets the next person sign in afterwards', () => {
    const context = new SessionContext();
    context.apply({ user: 'u_1' });
    context.clear();

    expect(context.apply({ user: 'u_2' }).entries).toEqual([
      { key: 'user', value: 'u_2' },
    ]);
  });
});
