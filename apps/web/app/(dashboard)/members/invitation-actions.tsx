'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { invitationUrl } from './invitation-url';

/**
 * Copy and cancel, per pending invitation.
 *
 * The URL is rendered only after mount. It depends on `window.location.origin`, and rendering it on
 * the server would either need a configured base URL or produce a link built from the wrong
 * hostname — so the row shows the id until the browser can say where it actually is.
 */
export function InvitationActions({
  invitationId,
  canManage,
}: {
  invitationId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => setUrl(invitationUrl(invitationId)), [invitationId]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Refused outside a secure context, which includes plain http on a LAN address. The link is
      // selectable in the cell beside this button.
    }
  }

  async function cancel() {
    setCancelling(true);
    await authClient.organization.cancelInvitation({ invitationId });
    setCancelling(false);
    router.refresh();
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        disabled={!url}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? 'Copied' : 'Copy link'}
      </Button>

      {canManage && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cancel invitation"
          onClick={cancel}
          disabled={cancelling}
        >
          {cancelling ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <X className="size-3.5" />
          )}
        </Button>
      )}
    </span>
  );
}

/** The link itself, shown beside the actions so it can be read and selected without copying. */
export function InvitationLink({ invitationId }: { invitationId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => setUrl(invitationUrl(invitationId)), [invitationId]);

  return (
    <code className="block truncate font-mono text-[11px] text-muted-foreground select-all">
      {url ?? `…/accept-invitation/${invitationId}`}
    </code>
  );
}
