import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { CreateOrganizationForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New organization' };

/**
 * Deliberately outside the dashboard group.
 *
 * That layout redirects anyone without an organization *here*, so a page inside it could never be
 * the answer — it would redirect to itself. This one needs a signed-in user and nothing else.
 *
 * It is also where a new account arrives, which is why the copy does not assume there is anything
 * to go back to.
 */
export default async function NewOrganizationPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  // Whether this is somebody's first organization or their fourth changes what the page is. The
  // first is the last step of signing up and has nothing to go back to; the rest are a deliberate
  // second tenant, and the thing worth saying about those is that they share nothing.
  const first = !(await db.member.findFirst({
    where: { userId: user.id },
    select: { id: true },
  }));

  return (
    <div className="relative flex min-h-svh items-center justify-center px-6 py-16">
      <ThemeToggle className="absolute top-5 right-5" />
      <div className="w-full max-w-sm">
        <Link href={first ? '/' : '/dashboard'}>
          <Wordmark />
        </Link>

        <h1 className="mt-8 text-2xl font-semibold">
          {first ? 'Name your organization' : 'New organization'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {first ? (
            <>
              Projects, recordings, and members all live in an organization, so
              yours needs one before there is anything to look at. Your team’s
              name or your company’s is the usual answer.
            </>
          ) : (
            <>
              A separate tenant: its own projects, its own recordings, its own
              members. Nothing is shared with the organizations you already
              belong to.
            </>
          )}
        </p>

        <CreateOrganizationForm />

        {!first && (
          <p className="mt-6 text-sm text-muted-foreground">
            <Link
              href="/dashboard"
              className="underline underline-offset-4 transition-colors duration-200 hover:text-foreground"
            >
              Back to the dashboard
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
