import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { currentUser } from '@/lib/session';
import { CreateOrganizationForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New organization' };

/**
 * Deliberately outside the dashboard group.
 *
 * That layout redirects anyone without an organization to `/no-organization`, which would make the
 * page that fixes that state unreachable from it. This one needs a signed-in user and nothing else.
 */
export default async function NewOrganizationPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  return (
    <div className="relative flex min-h-svh items-center justify-center px-6 py-16">
      <ThemeToggle className="absolute top-5 right-5" />
      <div className="w-full max-w-sm">
        <Link href="/dashboard">
          <Wordmark />
        </Link>

        <h1 className="mt-8 text-2xl font-semibold">New organization</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          A separate tenant: its own projects, its own recordings, its own
          members. Nothing is shared with the organizations you already belong
          to.
        </p>

        <CreateOrganizationForm />

        <p className="mt-6 text-sm text-muted-foreground">
          <Link
            href="/dashboard"
            className="underline underline-offset-4 transition-colors duration-200 hover:text-foreground"
          >
            Back to the dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
