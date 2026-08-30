import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Wordmark } from '@/components/logo';
import { isInstanceUnclaimed } from '@/lib/auth';
import { SignInForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  const { closed } = await searchParams;
  const unclaimed = await isInstanceUnclaimed();

  return (
    <>
      <Link href="/" className="lg:hidden">
        <Wordmark />
      </Link>

      <h1 className="mt-8 text-2xl font-semibold lg:mt-0">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Recordings are readable only by members of the organization that owns
        them.
      </p>

      {closed && (
        <Alert className="mt-4">
          <AlertDescription>
            This instance already has an owner, so sign-up is closed. Ask them
            for an invitation.
          </AlertDescription>
        </Alert>
      )}

      <SignInForm />

      {unclaimed && (
        <p className="mt-6 text-sm text-muted-foreground">
          Nobody owns this instance yet.{' '}
          <Link
            href="/sign-up"
            className="text-foreground underline underline-offset-4"
          >
            Claim it
          </Link>
        </p>
      )}
    </>
  );
}
