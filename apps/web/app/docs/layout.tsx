import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';

import { LogoMark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { REPO } from '../(marketing)/shell';

/**
 * Docs chrome.
 *
 * The sidebar is grouped by the question being asked rather than by which package the answer lives
 * in — someone reading "Privacy" does not care that the masking happens in the browser SDK.
 */

const SECTIONS = [
  {
    title: 'Start',
    links: [
      { href: '/docs', label: 'Overview' },
      { href: '/docs/quickstart', label: 'Quickstart' },
    ],
  },
  {
    title: 'Instrument',
    links: [
      { href: '/docs/browser-sdk', label: 'Browser SDK' },
      { href: '/docs/backend', label: 'Backend tracing' },
    ],
  },
  {
    title: 'Operate',
    links: [
      { href: '/docs/self-hosting', label: 'Self-hosting' },
      { href: '/docs/privacy', label: 'Privacy and masking' },
      { href: '/docs/architecture', label: 'Architecture' },
    ],
  },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs">
      <header className="docs__header">
        <div className="docs__header-inner">
          <Link href="/" className="docs__brand">
            <LogoMark className="size-[18px]" />
            <span>syncline</span>
          </Link>
          <div className="docs__header-actions">
            <Link href="/dashboard" className="docs__back-link">
              <ArrowLeft className="size-3.5" />
              Open app
            </Link>
            <a href={REPO} rel="noreferrer" className="docs__repo-link">
              GitHub
              <ArrowUpRight className="size-3" />
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="docs__layout">
        <aside className="docs__side">
          <div className="docs__side-heading">
            <span className="eyebrow">Documentation</span>
            <p>Build, instrument, and operate Syncline.</p>
          </div>
          {SECTIONS.map((section) => (
            <div className="docs__group" key={section.title}>
              <span className="eyebrow">{section.title}</span>
              {section.links.map((link) => (
                <Link key={link.href} href={link.href} className="docs__link">
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </aside>
        <main className="docs__body">{children}</main>
      </div>

      <footer className="docs__footer">
        <span>Syncline documentation</span>
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase">
          AGPL-3.0
        </span>
      </footer>
    </div>
  );
}
