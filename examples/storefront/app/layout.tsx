import Link from 'next/link';
import type { ReactNode } from 'react';

import { ENDPOINT, PUBLIC_KEY, RELEASE } from '@/lib/syncline';
import { Recording } from './recording';
import { StoreProvider } from './store';
import { ActivityLog } from './activity';
import './globals.css';

export const metadata = {
  title: 'Syncline example storefront',
  description: 'A storefront that records itself.',
};

/**
 * The recorder starts here, in the root layout, so it starts once for the whole app and survives
 * client-side navigation between the routes below. Starting it inside a page would restart the
 * recording on every navigation and cut the session into unrelated pieces.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <header className="bar">
            <span className="brand">
              syncline<span className="dim">/example</span>
            </span>
            <nav className="nav">
              <Link href="/">Shop</Link>
              <Link href="/cart">Cart</Link>
              <Link href="/orders">Orders</Link>
            </nav>
            <Recording
              publicKey={PUBLIC_KEY}
              endpoint={ENDPOINT}
              release={RELEASE}
            />
          </header>

          <main className="page">
            {children}
            <ActivityLog />
          </main>
        </StoreProvider>
      </body>
    </html>
  );
}
