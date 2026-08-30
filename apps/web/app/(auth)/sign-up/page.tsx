import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isInstanceUnclaimed } from '@/lib/auth';
import { SignUpForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create your account' };

/**
 * First-run only.
 *
 * Sign-up closes the moment the instance has an owner. A self-hosted tool that leaves registration
 * open collects strangers' accounts the first time it is exposed.
 *
 * The same check runs in a database hook, which is the version that actually enforces it — this one
 * only decides what to render.
 */
export default async function SignUpPage() {
  if (!(await isInstanceUnclaimed())) redirect('/sign-in?closed=1');

  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold lg:mt-0">
        Claim this instance
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Nobody owns this Syncline yet. The account you create becomes the owner,
        takes the default organization, and adopts any projects already seeded
        here. Sign-up closes afterwards.
      </p>

      <SignUpForm />

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/sign-in"
          className="text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
