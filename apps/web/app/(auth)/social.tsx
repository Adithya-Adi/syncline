'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signIn } from '@/lib/auth-client';
import type { SocialProvider, SocialProviderId } from '@/lib/social-providers';

const ICONS: Record<SocialProviderId, ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.26a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.61l4.01 3.11C6.22 6.88 8.87 4.75 12 4.75Z"
      />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58l-.02-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.010 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.21.7.82.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  ),
  gitlab: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m23.55 13.94-1.32-4.07-2.62-8.06a.45.45 0 0 0-.86 0l-2.62 8.06H7.87L5.25 1.81a.45.45 0 0 0-.86 0L1.77 9.87.45 13.94a.9.9 0 0 0 .33 1.01l11.22 8.15 11.22-8.15a.9.9 0 0 0 .33-1.01Z" />
    </svg>
  ),
};

/**
 * The social sign-in buttons, above the email and password form on both auth pages. Rendered only
 * when at least one provider is configured, so a default install sees the form it always had.
 *
 * Sign-in and sign-up use the same call and the same button. OAuth does not distinguish them: a
 * provider identity nobody has used here yet creates the account on the way through. A separate
 * "sign up with Google" would be two buttons doing one thing.
 */
export function SocialSignIn({
  providers,
  next,
}: {
  providers: SocialProvider[];
  next: string;
}) {
  // The page navigates away on success, so this only ever clears on failure. Holding the id
  // gives the spinner to the button that was actually pressed.
  const [pending, setPending] = useState<SocialProviderId | null>(null);

  async function start(provider: SocialProviderId) {
    setPending(provider);

    const { error } = await signIn.social({
      provider,
      callbackURL: next,
      // Failures arrive as a redirect, not a rejected promise: the provider's callback hits the
      // server, which sends the browser here with `?error=<code>`. Carrying `next` along means a
      // retry still lands where they were headed.
      errorCallbackURL: `/sign-in?next=${encodeURIComponent(next)}`,
    });

    // Only reached when the redirect never happened, usually an unreachable provider.
    if (error) setPending(null);
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="space-y-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending !== null}
            onClick={() => start(provider.id)}
          >
            {pending === provider.id ? (
              <Loader2 className="animate-spin" />
            ) : (
              ICONS[provider.id]
            )}
            Continue with {provider.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
