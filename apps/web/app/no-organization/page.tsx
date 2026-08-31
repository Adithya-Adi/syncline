import Link from 'next/link';

import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'No organization' };

/**
 * Reached when a signed-in user belongs to no organization.
 *
 * Sign-up provisions one, so this is now reached only after leaving or being removed from the last
 * one. That makes it a dead end with an obvious way out rather than an error: creating a new
 * organization is something the account is allowed to do, so the page offers it instead of
 * suggesting someone else fix it.
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
          Your account belongs to no organization, so there is nothing to show.
          Create one to start recording, or wait for an invitation link from a
          team that already has projects.
        </p>

        <Button asChild className="mt-6 w-full">
          <Link href="/organizations/new">Create an organization</Link>
        </Button>

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
