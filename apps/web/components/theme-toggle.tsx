'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * The server cannot know which theme the browser will resolve to, so rendering an icon before
 * mount would guarantee a hydration mismatch on every load. Until mounted this holds the exact
 * space the button will occupy — the layout never shifts, and no wrong icon flashes first.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={`size-8 ${className ?? ''}`} aria-hidden="true" />;
  }

  const dark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
