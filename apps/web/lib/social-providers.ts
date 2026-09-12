import type { BetterAuthOptions } from 'better-auth';

/**
 * Social sign-in, configured entirely from the environment.
 *
 * Every provider is off until its credentials are set. Nothing else changes when they are: no
 * schema change, no migration, the button just appears.
 *
 * Detection is by credentials, not by a list of enabled names. A separate `OAUTH_PROVIDERS`
 * variable would be a second thing to keep in sync with the secrets, and getting it wrong gives
 * you a button that leads to a provider error page.
 */

/** The providers we ship. Adding one is a row here and a row in `ICONS`, nothing else. */
export const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google', env: 'GOOGLE' },
  { id: 'github', label: 'GitHub', env: 'GITHUB' },
  { id: 'gitlab', label: 'GitLab', env: 'GITLAB' },
] as const satisfies readonly {
  id: string;
  label: string;
  env: string;
}[];

export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number]['id'];

/** What the sign-in page needs to draw a button: no secrets, so it is safe to send to the browser. */
export type SocialProvider = { id: SocialProviderId; label: string };

function credentials(
  env: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = process.env[`${env}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${env}_CLIENT_SECRET`]?.trim();

  // Half a pair is a mistake, but it fails the same way as setting neither: the provider stays
  // off. Throwing here would take down a dashboard that email and password can still log into.
  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret };
}

/**
 * The `socialProviders` block for Better Auth, holding only the providers that are configured.
 *
 * Read once at module load, like every other secret in the app, so adding a provider needs a
 * restart.
 */
export function configuredSocialProviders(): BetterAuthOptions['socialProviders'] {
  const providers: Record<string, Record<string, string>> = {};

  for (const provider of SOCIAL_PROVIDERS) {
    const pair = credentials(provider.env);
    if (!pair) continue;

    providers[provider.id] = { ...pair };

    // Without this, a self-hosted install sends its users to gitlab.com.
    if (provider.id === 'gitlab') {
      const issuer = process.env.GITLAB_ISSUER?.trim();
      if (issuer) providers[provider.id].issuer = issuer;
    }
  }

  return providers;
}

/** The configured providers, in catalog order, for the sign-in and sign-up pages. */
export function enabledSocialProviders(): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter((provider) => credentials(provider.env)).map(
    ({ id, label }) => ({ id, label }),
  );
}
