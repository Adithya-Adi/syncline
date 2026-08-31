'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyField } from '@/components/copy-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { invitationUrl } from './invitation-url';

/**
 * Invites someone, then shows the link.
 *
 * This install cannot send mail — there is no SMTP configuration, and requiring one before anyone
 * could add a colleague would be a worse trade than handing over the URL. So the invitation is
 * created and its link is displayed for the inviter to pass along themselves.
 *
 * The link is shown once here, prominently, and remains available in the pending list below, so
 * closing this panel does not lose it.
 */
export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; email: string } | null>(
    null,
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setCreated(null);
    setPending(true);

    const { data, error: failure } = await authClient.organization.inviteMember(
      {
        email: email.trim(),
        role: role as 'member' | 'admin' | 'owner',
      },
    );

    setPending(false);

    if (failure || !data) {
      setError(failure?.message ?? 'Could not create the invitation.');
      return;
    }

    setCreated({ id: data.id, email: data.email });
    setEmail('');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <div className="min-w-[240px] flex-1 space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="colleague@example.com"
            autoComplete="off"
            required
          />
        </div>

        <div className="w-40 space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          {/*
           * A native select rather than a styled listbox: three fixed options, and the platform
           * control is the one that already works with a keyboard and a screen reader.
           */}
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>

        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <UserPlus className="size-3.5" />
          )}
          {pending ? 'Inviting…' : 'Invite'}
        </Button>
      </form>

      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        No mail is sent. Copy the link this creates and send it yourself — it
        only works for someone signed in with the address you invited.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {created && (
        <CopyField
          label={`Invitation link for ${created.email}`}
          value={invitationUrl(created.id)}
          reveal
          hint="Send this to them. They must sign in or sign up with that exact address before it will accept."
        />
      )}
    </div>
  );
}
