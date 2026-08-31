import Link from 'next/link';
import { safeNextPath } from '@/lib/next-path';
import { SignUpForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create your account' };

/**
 * Registration is open.
 *
 * Each account is provisioned its own organization, so a new sign-up starts on an empty dashboard
 * and can never see recordings belonging to anyone else. Joining an existing organization is by
 * invitation only, which keeps that an explicit act by an existing member.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeNextPath(next);
  const invited = destination.startsWith('/accept-invitation/');

  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold lg:mt-0">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {invited ? (
          <>
            Sign up with the address the invitation was sent to — it will not
            accept any other one. You are returned to the invitation as soon as
            the account exists.
          </>
        ) : (
          <>
            You get your own organization, with nothing in it but the projects
            you create. To work on someone else&rsquo;s recordings, ask them for
            an invitation instead.
          </>
        )}
      </p>

      <SignUpForm next={destination} />

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href={`/sign-in?next=${encodeURIComponent(destination)}`}
          className="text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
