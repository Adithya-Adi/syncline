'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { ChevronDown, LogOut, Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/lib/auth-client';

/**
 * The header's right-hand side: which organization you are looking at, which account you are, the
 * theme, and the way out.
 *
 * The organization name was previously a `title` attribute holding the email — real information
 * hidden behind a hover that never appears on a touch device. It is a menu now so both are
 * readable, and sign-out stops being a button competing with the nav for attention.
 */
export function AccountMenu({
  organizationName,
  email,
}: {
  organizationName: string;
  email: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          {organizationName}
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs text-muted-foreground">Signed in as</span>
          <span className="block truncate font-mono text-xs">{email}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        {/*
         * Rendered only after mount. Before that the resolved theme is unknown, and a radio group
         * that guesses would show the wrong item checked for a frame.
         */}
        {mounted && (
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light">
              <Sun className="size-3.5" />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon className="size-3.5" />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor className="size-3.5" />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={pending}
          onSelect={async (event) => {
            event.preventDefault();
            setPending(true);
            await signOut();
            router.push('/sign-in');
            router.refresh();
          }}
        >
          <LogOut className="size-3.5" />
          {pending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
