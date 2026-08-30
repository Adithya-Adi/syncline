import Link from 'next/link';

export const metadata = { title: 'No organization · Syncline' };

/**
 * Reached when a signed-in user belongs to no organization. That should not happen through any
 * flow the app offers, so it says so plainly rather than pretending to be an empty state.
 */
export default function NoOrganization() {
  return (
    <main className="auth">
      <Link href="/" className="wordmark">
        syncline
      </Link>
      <h1 className="auth__title">No organization</h1>
      <p className="auth__sub">
        Your account exists but belongs to no organization, so there is nothing
        to show. This is not a state the app creates on its own — it usually
        means a membership row was removed by hand. An owner can invite you
        again.
      </p>
      <p className="auth__foot">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </main>
  );
}
