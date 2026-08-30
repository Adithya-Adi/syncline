'use client';

import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

/**
 * A code sample with a copy button. Same clipboard caveat as `CopyField` in the dashboard: access
 * is refused outside a secure context, which includes plain http on a LAN address, so the text
 * stays selectable and the failure is silent rather than a broken-looking button.
 *
 * `plain` carries the copyable text, because the rendered children are spans carrying syntax
 * colors and copying their concatenation would drag the markup along with it.
 */
export function CodeBlock({
  children,
  plain,
  caption,
}: {
  children: ReactNode;
  plain: string;
  caption?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Nothing to do — the sample is selectable.
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card/50">
      {caption && (
        <div className="border-b px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          {caption}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        aria-label="Copy to clipboard"
        className="absolute top-2 right-2 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
        style={caption ? { top: 'calc(0.5rem + 2.1rem)' } : undefined}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-7 text-muted-foreground">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** Syntax accents, drawn from the stratum tokens so code matches the diagram it sits beside. */
export const K = ({ children }: { children: ReactNode }) => (
  <span className="text-network">{children}</span>
);
export const S = ({ children }: { children: ReactNode }) => (
  <span className="text-backend">{children}</span>
);
export const C = ({ children }: { children: ReactNode }) => (
  <span className="opacity-60">{children}</span>
);
