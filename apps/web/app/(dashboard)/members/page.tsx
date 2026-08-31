import { Mail, Users } from 'lucide-react';

import { DataList, DataListHeader, DataListRow } from '@/components/data-list';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { organizationMembers, pendingInvitations } from '@/lib/organizations';
import { canManageMembers, requireViewer } from '@/lib/session';
import { InviteForm } from './invite-form';
import { InvitationActions, InvitationLink } from './invitation-actions';
import { MemberActions } from './member-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Members' };

const MEMBER_COLUMNS = 'minmax(220px,1.6fr) 150px 150px 56px';
const INVITE_COLUMNS = 'minmax(200px,1.2fr) minmax(220px,1.4fr) 120px 190px';

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/**
 * Who can see this organization's recordings.
 *
 * Everyone in the organization can read this page: knowing who your colleagues are is not
 * privileged, and hiding it would make an unexplained permission failure the first thing a member
 * learns about the model. The controls that change anything appear only for owners and admins, and
 * the server refuses them regardless.
 */
export default async function MembersPage() {
  const viewer = await requireViewer();
  const [members, invitations] = await Promise.all([
    organizationMembers(viewer),
    pendingInvitations(viewer),
  ]);

  const canManage = canManageMembers(viewer.role);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-7 px-5 py-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Organization"
        title="Members"
        description={
          <>
            Everyone listed here can read every recording in{' '}
            <span className="font-medium text-foreground">
              {viewer.organizationName}
            </span>
            . Access is per organization, not per project.
          </>
        }
      />

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              Creates a link you send yourself. It is bound to the address you
              enter, so forwarding it to anyone else does not work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>
      )}

      <section className="min-w-0">
        <h2 className="font-display text-base font-semibold">
          Members ({members.length})
        </h2>

        <DataList columns={MEMBER_COLUMNS} minWidth="640px" className="mt-4">
          <DataListHeader columns={MEMBER_COLUMNS}>
            <span>Person</span>
            <span>Role</span>
            <span>Joined</span>
            <span />
          </DataListHeader>

          {members.map((member) => (
            <DataListRow key={member.id} columns={MEMBER_COLUMNS}>
              <span className="min-w-0">
                <span className="block truncate text-sm">
                  {member.name || member.email}
                  {member.isViewer && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      you
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                  {member.email}
                </span>
              </span>
              <span>
                <Badge variant="outline" className="capitalize">
                  {member.role}
                </Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                {dateFormat.format(new Date(member.joinedAt))}
              </span>
              <span className="text-right">
                {/*
                 * No actions on your own row. Demoting or removing yourself is a real thing to
                 * want, but it is a decision with no undo from inside the app — the last owner
                 * locking themselves out cannot be repaired from the UI — so it is deliberately
                 * not one click away here.
                 */}
                {canManage && !member.isViewer && (
                  <MemberActions
                    memberId={member.id}
                    name={member.name || member.email}
                    role={member.role}
                  />
                )}
              </span>
            </DataListRow>
          ))}
        </DataList>
      </section>

      <section className="min-w-0">
        <h2 className="font-display text-base font-semibold">
          Pending invitations ({invitations.length})
        </h2>

        {invitations.length === 0 ? (
          <EmptyState
            icon={
              canManage ? (
                <Mail className="size-4" />
              ) : (
                <Users className="size-4" />
              )
            }
            title="No invitations waiting"
          >
            {canManage
              ? 'Invite someone above and the link will appear here until they accept it.'
              : 'An owner or admin can invite people to this organization.'}
          </EmptyState>
        ) : (
          <DataList columns={INVITE_COLUMNS} minWidth="820px" className="mt-4">
            <DataListHeader columns={INVITE_COLUMNS}>
              <span>Invited</span>
              <span>Link</span>
              <span>Expires</span>
              <span />
            </DataListHeader>

            {invitations.map((invitation) => (
              <DataListRow key={invitation.id} columns={INVITE_COLUMNS}>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">
                    {invitation.email}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {invitation.role} · by {invitation.invitedBy}
                  </span>
                </span>
                <span className="min-w-0">
                  <InvitationLink invitationId={invitation.id} />
                </span>
                <span className="text-xs">
                  {invitation.expired ? (
                    <Badge variant="destructive">Expired</Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {dateFormat.format(new Date(invitation.expiresAt))}
                    </span>
                  )}
                </span>
                <span className="text-right">
                  <InvitationActions
                    invitationId={invitation.id}
                    canManage={canManage}
                  />
                </span>
              </DataListRow>
            ))}
          </DataList>
        )}
      </section>
    </main>
  );
}
