'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';

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
import { cn } from '@/lib/utils';
import type { ViewerOrganization } from '@/lib/session';

/**
 * Which organization you are looking at, and how to look at another one.
 *
 * Switching writes the active organization onto the session rather than into a URL or a cookie of
 * our own, because that is what every server-side scope check already reads. `router.refresh()`
 * afterwards is what makes the switch visible: every dashboard page is a server component whose
 * queries are scoped to the organization, so they have to be re-run rather than re-rendered.
 */
export function OrgSwitcher({
  organizations,
  onNavigate,
}: {
  organizations: ViewerOrganization[];
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);

  const active =
    organizations.find((organization) => organization.active) ??
    organizations[0];

  async function switchTo(organizationId: string) {
    setSwitching(organizationId);
    const { error } = await authClient.organization.setActive({
      organizationId,
    });
    setSwitching(null);

    if (error) return;

    onNavigate?.();
    // Back to the project picker rather than staying put: the page you were on belonged to the
    // organization you just left, and its ids resolve to nothing here.
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-between gap-2 px-2.5 py-2 text-left"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <Building2 className="size-3.5 text-muted-foreground" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {active?.name ?? 'No organization'}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {active ? roleLabel(active.role) : '—'}
              </span>
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Organizations
        </DropdownMenuLabel>

        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization.id}
            disabled={switching !== null}
            onSelect={(event) => {
              event.preventDefault();
              if (organization.active) return;
              void switchTo(organization.id);
            }}
          >
            {switching === organization.id ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check
                className={cn(
                  'size-3.5',
                  organization.active ? 'opacity-100' : 'opacity-0',
                )}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{organization.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {roleLabel(organization.role)}
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            onNavigate?.();
            router.push('/organizations/new');
          }}
        >
          <Plus className="size-3.5" />
          New organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Better Auth joins multiple roles with a comma; the switcher shows the strongest one. */
function roleLabel(role: string): string {
  const roles = role.split(',').map((part) => part.trim());
  for (const rank of ['owner', 'admin', 'member']) {
    if (roles.includes(rank)) return rank;
  }
  return roles[0] ?? 'member';
}
