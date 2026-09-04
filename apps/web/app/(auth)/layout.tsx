import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Fold } from '@/app/(marketing)/fold';
import { LogoMark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Never indexed. Every page under here is one organization's data, and a crawler reaching them
 * gets a redirect to sign-in anyway — but a permalink pasted into a public issue tracker is a
 * real way for one of these URLs to be discovered and followed.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The pages you can reach without an account.
 *
 * Below `lg` this is the centred column it has always been. Above it, the form keeps that column
 * and a second pane carries the product's argument, so the first screen of a self-hosted tool says
 * what the tool is rather than only asking for a password. The pane is decoration in the same
 * restricted sense as the landing hero: one grid, one glow, and the diagram.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative flex items-center justify-center px-6 py-16">
        <Link
          href="/"
          className="absolute top-5 left-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Home
        </Link>
        <ThemeToggle className="absolute top-5 right-5" />
        <div className="w-full max-w-sm">{children}</div>
      </div>

      <div className="relative hidden overflow-hidden border-l bg-muted/25 lg:flex lg:flex-col lg:justify-center">
        <div
          aria-hidden="true"
          className="grid-backdrop pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/4 left-1/2 h-[420px] w-[620px] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: 'var(--glow)' }}
        />

        <div className="relative mx-auto w-full max-w-md px-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 transition-opacity duration-200 hover:opacity-80"
          >
            <LogoMark className="size-[18px]" />
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em]">
              syncline
            </span>
          </Link>

          <h2 className="mt-6 text-2xl font-semibold">
            Every layer of your stack, folded onto{' '}
            <em className="text-backend not-italic">one timeline</em>.
          </h2>

          <div className="mt-8">
            <Fold compact />
          </div>

          <p className="mt-6 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            Self-hosted · AGPL-3.0
          </p>
        </div>
      </div>
    </div>
  );
}
