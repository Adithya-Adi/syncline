import { describe, expect, it } from 'vitest';
import { oauthErrorMessage } from './oauth-error';

describe('oauthErrorMessage', () => {
  it('says nothing when there was no error', () => {
    expect(oauthErrorMessage(undefined)).toBeNull();
    expect(oauthErrorMessage('')).toBeNull();
  });

  it('explains the one a real person hits', () => {
    expect(oauthErrorMessage('account_not_linked')).toContain('password');
  });

  it('never echoes an unrecognized code back into the page', () => {
    const message = oauthErrorMessage('<script>alert(1)</script>');

    expect(message).not.toContain('script');
    expect(message).toBe(oauthErrorMessage('something_nobody_ships'));
  });

  it('reads the first value when the parameter is repeated', () => {
    expect(oauthErrorMessage(['access_denied', 'no_code'])).toBe(
      oauthErrorMessage('access_denied'),
    );
  });
});
