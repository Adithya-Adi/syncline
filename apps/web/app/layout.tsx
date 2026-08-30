import './theme.css';
import './global.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';

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

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const TAGLINE = 'Every layer of your stack, folded onto one timeline.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Syncline', template: '%s' },
  description: TAGLINE,
  openGraph: {
    title: 'Syncline',
    description: TAGLINE,
    siteName: 'Syncline',
    type: 'website',
    url: SITE,
  },
  twitter: { card: 'summary_large_image', title: 'Syncline', description: TAGLINE },
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
