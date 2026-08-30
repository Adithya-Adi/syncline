'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  BookOpen,
  FolderKanban,
  LayoutDashboard,
  Menu,
  X,
} from 'lucide-react';

import { LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AccountMenu } from './account-menu';

const PRIMARY_LINKS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    isActive: (pathname: string) =>
      pathname === '/dashboard' ||
      pathname.startsWith('/dashboard/') ||
      pathname.startsWith('/sessions') ||
      pathname.startsWith('/s/'),
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: FolderKanban,
    isActive: (pathname: string) => pathname.startsWith('/projects'),
  },
  {
    href: '/docs',
    label: 'Docs',
    icon: BookOpen,
    isActive: (pathname: string) => pathname.startsWith('/docs'),
  },
];

export function DashboardShell({
  children,
  organizationName,
  email,
}: {
  children: ReactNode;
  organizationName: string;
  email: string;
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur-md lg:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Open sidebar"
          onClick={() => setOpen(true)}
        >
          <Menu className="size-4" />
        </Button>
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2 transition-opacity duration-200 hover:opacity-80"
        >
          <LogoMark className="size-[18px]" />
          <span className="font-display text-[15px] font-semibold">
            syncline
          </span>
        </Link>
      </header>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-border/80 bg-muted/20 lg:flex">
        <SidebarContent
          organizationName={organizationName}
          email={email}
          pathname={pathname}
        />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close sidebar"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,calc(100vw-2rem))] border-r border-border/80 bg-background shadow-2xl">
            <SidebarContent
              organizationName={organizationName}
              email={email}
              pathname={pathname}
              onNavigate={() => setOpen(false)}
              closeButton={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close sidebar"
                  onClick={() => setOpen(false)}
                >
                  <X className="size-4" />
                </Button>
              }
            />
          </aside>
        </div>
      )}

      <div className="min-w-0 lg:pl-72">{children}</div>
    </div>
  );
}

function SidebarContent({
  organizationName,
  email,
  pathname,
  closeButton,
  onNavigate,
}: {
  organizationName: string;
  email: string;
  pathname: string;
  closeButton?: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-border/80 px-4">
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2 transition-opacity duration-200 hover:opacity-80"
          onClick={onNavigate}
        >
          <LogoMark className="size-[18px]" />
          <span className="font-display text-[15px] font-semibold">
            syncline
          </span>
        </Link>
        {closeButton && <div className="ml-auto">{closeButton}</div>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="px-2 pb-3">
          <div className="truncate text-sm font-medium">{organizationName}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {email}
          </div>
        </div>

        <nav className="space-y-1" aria-label="Primary">
          {PRIMARY_LINKS.map((link) => {
            const active = link.isActive(pathname);
            const Icon = link.icon;

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-200',
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{link.label}</span>
              </Link>
            );
          })}
        </nav>

      </div>

      <div className="border-t border-border/80 p-3">
        <AccountMenu
          organizationName={organizationName}
          email={email}
          align="start"
          className="w-full justify-between"
        />
      </div>
    </div>
  );
}
