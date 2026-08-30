import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Chrome shared by the landing page and the docs.
 *
 * Kept deliberately thin: a nav, a footer, and nothing that competes with the page's own content.
 */

const NAV = [
  { href: '/docs', label: 'Docs' },
  { href: '/docs/quickstart', label: 'Quickstart' },
  { href: '/sessions', label: 'Recordings' },
];

export function SiteNav() {
  return (
    <nav className="nav">
      <Link href="/" className="wordmark">
        syncline
      </Link>
      <div className="nav__links">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
        <a
          href="https://github.com/Adithya-Adi/syncline"
          className="nav__github"
          rel="noreferrer"
        >
          GitHub
        </a>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="foot__col">
        <span className="wordmark">syncline</span>
        <p className="foot__note">
          Every layer of your stack, folded onto one timeline. AGPL-3.0,
          self-hosted.
        </p>
      </div>
      <div className="foot__col">
        <span className="eyebrow">Docs</span>
        <Link href="/docs">Overview</Link>
        <Link href="/docs/quickstart">Quickstart</Link>
        <Link href="/docs/browser-sdk">Browser SDK</Link>
        <Link href="/docs/backend">Backend tracing</Link>
      </div>
      <div className="foot__col">
        <span className="eyebrow">Operating</span>
        <Link href="/docs/self-hosting">Self-hosting</Link>
        <Link href="/docs/privacy">Privacy</Link>
        <Link href="/docs/architecture">Architecture</Link>
      </div>
      <div className="foot__col">
        <span className="eyebrow">Project</span>
        <a href="https://github.com/Adithya-Adi/syncline" rel="noreferrer">
          Source
        </a>
        <a
          href="https://github.com/Adithya-Adi/syncline/issues"
          rel="noreferrer"
        >
          Issues
        </a>
        <a
          href="https://github.com/Adithya-Adi/syncline/blob/main/LICENSE"
          rel="noreferrer"
        >
          License
        </a>
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
      <SiteFooter />
    </>
  );
}
