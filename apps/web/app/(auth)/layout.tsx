import type { ReactNode } from 'react';

/** A centred column for the two pages you can reach without an account. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
