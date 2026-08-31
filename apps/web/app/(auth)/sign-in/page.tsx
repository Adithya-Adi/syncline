import Link from 'next/link';
import { safeNextPath } from '@/lib/next-path';
import { SignInForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeNextPath(next);

  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold lg:mt-0">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Recordings are readable only by members of the organization that owns
        them.
      </p>

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
