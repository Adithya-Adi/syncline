import Link from 'next/link';

import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { invitationById, maskEmail } from '@/lib/organizations';
import { currentUser } from '@/lib/session';
import { InvitationActions } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invitation' };

/**
 * The other end of an invitation link.
 *
 * Outside the dashboard group on purpose: it has to render for someone who is signed out, or signed
 * in as the wrong account, and both of those are the ordinary case for a link pasted into a chat
 * window. It also has to say which of those it is — "invalid invitation" for a link that is
 * perfectly valid but opened by the wrong person is how someone gives up on a working link.
 *
 * The invited address is masked unless the viewer is the recipient. The id is unguessable, but a
 * link like this gets forwarded, and the page behind it should not read out a colleague's address
 * to whoever ends up holding it.
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const [invitation, user] = await Promise.all([
    invitationById(invitationId),
    currentUser(),
  ]);

  const isRecipient =
    user !== null &&
    invitation !== null &&
    user.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <div className="relative flex min-h-svh items-center justify-center px-6 py-16">
      <ThemeToggle className="absolute top-5 right-5" />
      <div className="w-full max-w-sm">
        <Link href="/">
          <Wordmark />
        </Link>

        {!invitation ? (
          <Body title="Invitation not found">
            This link does not match an invitation. It may have been cancelled,
            or the address may have been truncated on its way to you — ask
            whoever sent it for a fresh one.
          </Body>
        ) : invitation.status !== 'pending' ? (
          <Body title="Already used">
            This invitation to {invitation.organizationName} was already{' '}
            {invitation.status}. Ask an owner or admin there to send another
            one.
          </Body>
        ) : invitation.expired ? (
          <Body title="Invitation expired">
            The invitation to {invitation.organizationName} has expired. Ask
            whoever invited you to issue a new one — invitations are short-lived
            on purpose.
          </Body>
        ) : !user ? (
          <Body title={`Join ${invitation.organizationName}`}>
            <p>
              You have been invited as a{' '}
              <span className="text-foreground">{invitation.role}</span>. Sign
              in as{' '}
              <code className="font-mono">{maskEmail(invitation.email)}</code>{' '}
              to accept it — the invitation only works for that address.
            </p>
            <div className="mt-6 flex gap-4 text-sm">
              <Link
                href={`/sign-in?next=/accept-invitation/${invitation.id}`}
                className="text-foreground underline underline-offset-4"
              >
                Sign in
              </Link>
              <Link
                href={`/sign-up?next=/accept-invitation/${invitation.id}`}
                className="text-foreground underline underline-offset-4"
              >
                Create an account
              </Link>
            </div>
          </Body>
        ) : !isRecipient ? (
          <Body title="Wrong account">
            <p>
              This invitation was issued to{' '}
              <code className="font-mono">{maskEmail(invitation.email)}</code>,
              and you are signed in as{' '}
              <code className="font-mono">{user.email}</code>. Sign in with the
              invited address, or ask for an invitation to the address you
              actually use.
            </p>
            <p className="mt-6 text-sm">
              <Link
                href="/dashboard"
                className="text-foreground underline underline-offset-4"
              >
                Back to the dashboard
              </Link>
            </p>
          </Body>
        ) : (
          <>
            <Body title={`Join ${invitation.organizationName}`}>
              You were invited as a{' '}
              <span className="text-foreground">{invitation.role}</span>.
              Accepting gives you access to every recording in that
              organization, and leaves the organizations you already belong to
              untouched.
            </Body>
            <InvitationActions
              invitationId={invitation.id}
              organizationName={invitation.organizationName}
            />
            <Alert className="mt-6">
              <AlertDescription className="text-xs leading-relaxed">
                Signed in as <code className="font-mono">{user.email}</code>.
              </AlertDescription>
            </Alert>
          </>
        )}
      </div>
    </div>
  );
}

function Body({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold">{title}</h1>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </>
  );
}
