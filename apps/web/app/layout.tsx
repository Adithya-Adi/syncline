import './theme.css';
import './global.css';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata = {
  title: 'Syncline',
  description: 'Every layer of your stack, folded onto one timeline.',
};

/**
 * `dark` is set on the html element rather than left to a media query. This is a tool people keep
 * open next to a terminal for long stretches; a light flash when the OS says light is worse than
 * not offering the choice yet.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
