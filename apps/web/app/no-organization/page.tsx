import Link from 'next/link';

export const metadata = { title: 'No organization · Syncline' };

/**
 * Reached when a signed-in user belongs to no organization. No flow the app offers creates that
 * state, so it says so plainly rather than pretending to be an empty state.
 */
export default function NoOrganization() {
  return (
    <div className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-mono text-sm font-medium tracking-tight">
          syncline
        </Link>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          No organization
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account exists but belongs to no organization, so there is
          nothing to show. This is not a state the app creates on its own — it
          usually means a membership row was removed by hand. An owner can
          invite you again.
        </p>
        <p className="mt-6 text-sm">
          <Link href="/sign-in" className="underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
