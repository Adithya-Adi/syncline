import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isInstanceUnclaimed } from '../../../lib/auth';
import { SignUpForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create your account · Syncline' };

/**
 * First-run only.
 *
 * Sign-up closes the moment the instance has an owner. A self-hosted tool that leaves registration
 * open collects strangers' accounts the first time it is exposed, and there is no honest reason for
 * a second person to arrive here uninvited.
 *
 * The check is repeated in a database hook, which is the version that actually enforces it — this
 * one only decides what to render.
 */
export default async function SignUpPage() {
  if (!(await isInstanceUnclaimed())) redirect('/sign-in?closed=1');

  return (
    <main className="auth">
      <Link href="/" className="wordmark">
        syncline
      </Link>

      <h1 className="auth__title">Claim this instance</h1>
      <p className="auth__sub">
        Nobody owns this Syncline yet. The account you create becomes the owner,
        takes the default organization, and adopts any projects already seeded
        here. Sign-up closes afterwards.
      </p>

      <SignUpForm />

      <p className="auth__foot">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
