import './theme.css';
import './global.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { SITE, TAGLINE } from '@/lib/site';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });

/*
 * Three families, each with a job: Space Grotesk sets display type, Geist sets everything a
 * person reads in a sentence, and Plex Mono is reserved for things that are data — keys, timings,
 * code, and the small uppercase labels.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

const DESCRIPTION =
  'Watch a user session replay and the backend distributed trace behind it on one timeline. ' +
  'Open source, self-hostable session replay with OpenTelemetry tracing built in.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  /*
   * `%s · Syncline` rather than a bare `%s`. A page title is the headline of a search result and
   * the label on a tab, and "Self-hosting" alone says nothing about whose. Every docs page already
   * exports its own title, so this is the only place the product name gets attached to them.
   */
  title: { default: `Syncline — ${TAGLINE}`, template: '%s · Syncline' },
  description: DESCRIPTION,
  applicationName: 'Syncline',
  keywords: [
    'session replay',
    'distributed tracing',
    'opentelemetry',
    'observability',
    'rrweb',
    'open source session replay',
    'self-hosted session replay',
  ],
  authors: [{ name: 'Syncline' }],
  alternates: { canonical: '/' },
  openGraph: {
    title: `Syncline — ${TAGLINE}`,
    description: DESCRIPTION,
    siteName: 'Syncline',
    type: 'website',
    url: SITE,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: `Syncline — ${TAGLINE}`,
    description: DESCRIPTION,
  },
  /*
   * The dashboard is behind a session and every page in it is one customer's data, so the parts
   * worth indexing opt in rather than out — see robots.ts, which allows the landing page and the
   * docs and nothing else. This is the belt to that braces: a crawler ignoring robots.txt still
   * reads the meta tag.
   */
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

/**
 * Dark is the default rather than the OS preference. This is a tool people keep open next to a
 * terminal for long stretches, and a light flash when the OS says light is worse than picking a
 * side. `enableSystem` means "follow the OS" is still reachable — it is just not the first answer.
 *
 * `suppressHydrationWarning` is required: next-themes writes the class onto <html> before React
 * hydrates, so the server and client markup deliberately disagree on that one attribute.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${spaceGrotesk.variable} ${plexMono.variable}`}
    >
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
