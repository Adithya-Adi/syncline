import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { safeNextPath } from '@/lib/next-path';
import { oauthErrorMessage } from '@/lib/oauth-error';
import { enabledSocialProviders } from '@/lib/social-providers';
import { SocialSignIn } from '../social';
import { SignInForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const destination = safeNextPath(next);
  const providers = enabledSocialProviders();

  // A failed social sign-in comes back as a redirect, so the reason arrives in the URL. It is
  // reported above the form, since it has nothing to do with the fields in it.
  const oauthError = oauthErrorMessage(error);

  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold lg:mt-0">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Recordings are readable only by members of the organization that owns
        them.
      </p>

      {oauthError && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{oauthError}</AlertDescription>
        </Alert>
      )}

      {providers.length > 0 && (
        <SocialSignIn providers={providers} next={destination} />
      )}

      <SignInForm next={destination} />

      <p className="mt-6 text-sm text-muted-foreground">
        No account yet?{' '}
        <Link
          href={`/sign-up?next=${encodeURIComponent(destination)}`}
          className="text-foreground underline underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </>
  );
}
