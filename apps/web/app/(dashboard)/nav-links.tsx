'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The header's destinations, with the current one marked.
 *
 * This is a client component only because it needs the pathname; the layout around it stays a
 * server component so `requireViewer()` keeps running on the server, where the gate belongs.
 *
 * `/s/<id>` is a recording, so it lights "Recordings" — the viewer is reached from that list and
 * showing nothing selected there would read as having navigated out of the app.
 */
const LINKS = [
  { href: '/sessions', label: 'Recordings', match: ['/sessions', '/s/'] },
  { href: '/projects', label: 'Projects', match: ['/projects'] },
  { href: '/docs', label: 'Docs', match: ['/docs'] },
];

export function NavLinks() {
  const pathname = usePathname() ?? '';

  return (
    <nav className="flex items-center gap-1 text-sm">
      {LINKS.map((link) => {
        const active = link.match.some((prefix) => pathname.startsWith(prefix));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`relative rounded-md px-2.5 py-1.5 transition-colors duration-200 ${
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {link.label}
            {active && (
              <span
                aria-hidden="true"
                className="bg-network absolute inset-x-2.5 -bottom-[13px] h-px"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
