'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Users,
  X,
} from 'lucide-react';

import { LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ViewerOrganization } from '@/lib/session';
import { AccountMenu } from './account-menu';
import { OrgSwitcher } from './org-switcher';

interface NavLink {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isActive: (pathname: string) => boolean;
}

/**
 * Recordings live under a project, so the two project-shaped destinations sit together, and the
 * organization's own settings sit apart from them. One section per tenancy level, which is also the
 * order someone works in: pick a project, then look at who can see it.
 */
const PROJECT_LINKS: NavLink[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    isActive: (pathname) =>
      pathname === '/dashboard' ||
      pathname.startsWith('/dashboard/') ||
      pathname.startsWith('/sessions') ||
      pathname.startsWith('/s/'),
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: FolderKanban,
    isActive: (pathname) => pathname.startsWith('/projects'),
  },
];

const ORGANIZATION_LINKS: NavLink[] = [
  {
    href: '/members',
    label: 'Members',
    icon: Users,
    isActive: (pathname) => pathname.startsWith('/members'),
  },
];

export function DashboardShell({
  children,
  organizations,
  email,
}: {
  children: ReactNode;
  organizations: ViewerOrganization[];
  email: string;
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  const organizationName =
    organizations.find((organization) => organization.active)?.name ??
    'No organization';

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
          organizations={organizations}
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
              organizations={organizations}
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
  organizations,
  organizationName,
  email,
  pathname,
  closeButton,
  onNavigate,
}: {
  organizations: ViewerOrganization[];
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

      <div className="border-b border-border/80 p-2">
        <OrgSwitcher organizations={organizations} onNavigate={onNavigate} />
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
        <NavSection
          links={PROJECT_LINKS}
          pathname={pathname}
          onNavigate={onNavigate}
        />
        <NavSection
          label="Organization"
          links={ORGANIZATION_LINKS}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      </div>

      <div className="border-t border-border/80 p-3">
        <Link
          href="/docs"
          target="_blank"
          rel="noreferrer"
          onClick={onNavigate}
          className="mb-2 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors duration-200 hover:bg-accent/60 hover:text-foreground"
        >
          <BookOpen className="size-4 shrink-0" />
          <span className="truncate">Docs</span>
          <ArrowUpRight className="ml-auto size-3.5 opacity-60" />
        </Link>
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

function NavSection({
  label,
  links,
  pathname,
  onNavigate,
}: {
  label?: string;
  links: NavLink[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div>
      {label && (
        <p className="mb-1.5 px-2.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground/80 uppercase">
          {label}
        </p>
      )}
      <nav className="space-y-1" aria-label={label ?? 'Primary'}>
        {links.map((link) => {
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
  );
}
