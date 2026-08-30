import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteNav, SiteFooter } from '../(marketing)/shell';

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
    <>
      <SiteNav />
      <div className="docs">
        <aside className="docs__side">
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
        <article className="docs__body">{children}</article>
      </div>
      <SiteFooter />
    </>
  );
}
