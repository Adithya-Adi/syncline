import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';

import { LogoMark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

/**
 * Chrome shared by the landing page and the docs.
 *
 * Kept deliberately thin: a nav, a footer, and nothing that competes with the page's own content.
 * Separation is a hairline border everywhere — no shadows, no glass beyond the nav's own blur.
 */

export const REPO = 'https://github.com/Adithya-Adi/syncline';

const NAV = [
  { href: '/docs', label: 'Docs' },
  { href: '/docs/quickstart', label: 'Quickstart' },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/80 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
        <Link
          href="/"
          className="flex items-center gap-2 transition-opacity duration-200 hover:opacity-80"
        >
          <LogoMark className="size-[18px]" />
          <span className="font-display text-[15px] font-semibold tracking-[-0.01em]">
            syncline
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <div className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <a
              href={REPO}
              rel="noreferrer"
              className="group inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              GitHub
              <ArrowUpRight className="size-3 opacity-50 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px" />
            </a>
          </div>

          <ThemeToggle className="ml-1" />

          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/docs/quickstart">Get started</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}

const FOOTER = [
  {
    heading: 'Docs',
    links: [
      { href: '/docs', label: 'Overview' },
      { href: '/docs/quickstart', label: 'Quickstart' },
      { href: '/docs/browser-sdk', label: 'Browser SDK' },
      { href: '/docs/backend', label: 'Backend tracing' },
    ],
  },
  {
    heading: 'Operating',
    links: [
      { href: '/docs/self-hosting', label: 'Self-hosting' },
      { href: '/docs/privacy', label: 'Privacy' },
      { href: '/docs/architecture', label: 'Architecture' },
    ],
  },
  {
    heading: 'Project',
    links: [
      { href: REPO, label: 'Source', external: true },
      { href: `${REPO}/issues`, label: 'Issues', external: true },
      { href: `${REPO}/blob/main/LICENSE`, label: 'License', external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/80">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark className="size-[18px]" />
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em]">
              syncline
            </span>
          </Link>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Every layer of your stack, folded onto one timeline.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
              AGPL-3.0
            </span>
            <span className="rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
              Self-hosted
            </span>
          </div>
        </div>

        {FOOTER.map((col) => (
          <div key={col.heading} className="flex flex-col gap-3">
            <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
              {col.heading}
            </span>
            {col.links.map((link) =>
              'external' in link && link.external ? (
                <a
                  key={link.label}
                  href={link.href}
                  rel="noreferrer"
                  className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                >
                  {link.label}
                </Link>
              ),
            )}
          </div>
        ))}
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteNav />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
