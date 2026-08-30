import Link from 'next/link';

import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata = { title: 'No organization' };

/**
 * Reached when a signed-in user belongs to no organization. No flow the app offers creates that
 * state, so it says so plainly rather than pretending to be an empty state.
 *
 * It sits outside the `(auth)` group because it is reached while signed in, so it repeats that
 * group's centred column rather than importing a layout that would also draw the brand pane.
 */
export default function NoOrganization() {
  return (
    <div className="relative flex min-h-svh items-center justify-center px-6 py-16">
      <ThemeToggle className="absolute top-5 right-5" />
      <div className="w-full max-w-sm">
        <Link href="/">
          <Wordmark />
        </Link>
        <h1 className="mt-8 text-2xl font-semibold">No organization</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Your account exists but belongs to no organization, so there is
          nothing to show. This is not a state the app creates on its own — it
          usually means a membership row was removed by hand. An owner can
          invite you again.
        </p>
        <p className="mt-6 text-sm">
          <Link
            href="/sign-in"
            className="underline underline-offset-4 transition-colors duration-200 hover:text-foreground"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
