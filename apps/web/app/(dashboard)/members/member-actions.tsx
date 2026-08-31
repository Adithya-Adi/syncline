'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';

const ROLES = ['owner', 'admin', 'member'] as const;

/**
 * Role changes and removal for one member.
 *
 * The rules about who may do what to whom live in Better Auth, not here: an admin demoting an owner
 * is refused by the server, and this only reports it. Enforcing it a second time in the UI would
 * mean two copies of a policy that can disagree — and the copy in the browser is the one that
 * cannot be trusted anyway.
 */
export function MemberActions({
  memberId,
  name,
  role,
}: {
  memberId: string;
  name: string;
  role: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function setRole(next: string) {
    setPending(true);
    const { error } = await authClient.organization.updateMemberRole({
      memberId,
      role: next as 'owner' | 'admin' | 'member',
    });
    setPending(false);

    if (error) {
      toast.error(error.message ?? 'Could not change the role.');
      return;
    }

    toast.success(`${name} is now ${next}.`);
    router.refresh();
  }

  async function remove() {
    setPending(true);
    const { error } = await authClient.organization.removeMember({
      memberIdOrEmail: memberId,
    });
    setPending(false);

    if (error) {
      toast.error(error.message ?? 'Could not remove the member.');
      return;
    }

    toast.success(`${name} was removed.`);
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Manage ${name}`}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <MoreHorizontal className="size-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Role
        </DropdownMenuLabel>
        {ROLES.map((candidate) => (
          <DropdownMenuItem
            key={candidate}
            disabled={candidate === role}
            onSelect={(event) => {
              event.preventDefault();
              void setRole(candidate);
            }}
          >
            <span className="capitalize">{candidate}</span>
            {candidate === role && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                current
              </span>
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onSelect={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          Remove from organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
