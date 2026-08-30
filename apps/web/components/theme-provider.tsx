'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * next-themes has to run on the client, and the root layout is a server component. This is the
 * boundary between them and nothing else — every option is passed through from the caller so the
 * policy stays in one readable place, `app/layout.tsx`.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
