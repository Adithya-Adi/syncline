'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

/**
 * Accept or decline, for the recipient.
 *
 * Accepting switches the new organization on immediately: someone who followed an invitation link
 * wants to be looking at that organization, and the dashboard is scoped to whichever one the
 * session says is active — landing them in their own empty one would look like the invitation had
 * failed.
 */
export function InvitationActions({
  invitationId,
  organizationName,
}: {
  invitationId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setError(null);
    setPending('accept');

    const { data, error: failure } =
      await authClient.organization.acceptInvitation({ invitationId });

    if (failure || !data) {
      setPending(null);
      setError(failure?.message ?? 'Could not accept the invitation.');
      return;
    }

    const organizationId = data.invitation.organizationId;
    if (organizationId) {
      await authClient.organization.setActive({ organizationId });
    }

    router.push('/dashboard');
    router.refresh();
  }

  async function reject() {
    setError(null);
    setPending('reject');

    const { error: failure } = await authClient.organization.rejectInvitation({
      invitationId,
    });

    setPending(null);

    if (failure) {
      setError(failure.message ?? 'Could not decline the invitation.');
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="mt-8 space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          onClick={accept}
          disabled={pending !== null}
        >
          {pending === 'accept' && <Loader2 className="animate-spin" />}
          {pending === 'accept' ? 'Joining…' : `Join ${organizationName}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={reject}
          disabled={pending !== null}
        >
          {pending === 'reject' ? 'Declining…' : 'Decline'}
        </Button>
      </div>
    </div>
  );
}
