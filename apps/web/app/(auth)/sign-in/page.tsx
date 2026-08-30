import Link from 'next/link';
import { isInstanceUnclaimed } from '../../../lib/auth';
import { SignInForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Syncline' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  const { closed } = await searchParams;
  const unclaimed = await isInstanceUnclaimed();

  return (
    <main className="auth">
      <Link href="/" className="wordmark">
        syncline
      </Link>

      <h1 className="auth__title">Sign in</h1>

      {closed && (
        <p className="auth__notice">
          This instance already has an owner, so sign-up is closed. Ask them for
          an invitation.
        </p>
      )}

      <SignInForm />

      {unclaimed && (
        <p className="auth__foot">
          Nobody owns this instance yet. <Link href="/sign-up">Claim it</Link>
        </p>
      )}
    </main>
  );
}
