/**
 * Turns the `?error=` a failed OAuth round trip leaves on the sign-in URL into something readable.
 *
 * The code comes from the query string, so it comes from anyone: you can send someone a link with
 * any `error` value you like. It is only ever looked up in this table, never printed. An
 * unrecognized code gets the generic sentence.
 */

/**
 * The codes worth their own sentence. Better Auth's others (`invalid_code`, `state_not_found`,
 * `unable_to_get_user_info`, …) describe faults nobody signing in can do anything about, so they
 * get the generic message.
 */
const MESSAGES: Record<string, string> = {
  // The one a real person hits. Their address already has a password account, and nothing on a
  // self-hosted install sends mail, so it was never verified and the two cannot be merged on the
  // provider's word alone. See the linking note in auth.ts.
  account_not_linked:
    'That email already signs in with a password here. Use your password instead.',

  // Cancelled at the provider.
  access_denied: 'Sign-in was cancelled.',

  // The provider authenticated somebody but would not say who. Nothing to key an account on.
  email_not_found:
    'That provider did not share an email address, so there is nothing to sign in as.',
  email_not_verified:
    'That provider has not verified the email address on that account.',

  // Credentials are set for a provider the server no longer offers, or the button is stale.
  oauth_provider_not_found: 'That sign-in provider is not configured here.',
};

const GENERIC =
  'That sign-in did not complete. Try again, or use your email and password.';

/** The message for a code, or nothing at all when there was no error. */
export function oauthErrorMessage(raw?: string | string[]): string | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!code) return null;

  return MESSAGES[code] ?? GENERIC;
}
