'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * A key with a copy button.
 *
 * `reveal` marks a value that will never be shown again, so it is displayed in full rather than
 * truncated — asking someone to copy a secret they cannot see is how secrets end up in a text file
 * instead of a password manager.
 */
export function CopyField({
  label,
  value,
  hint,
  reveal = false,
}: {
  label: string;
  value: string;
  hint?: string;
  reveal?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access is refused outside a secure context, which includes plain http on a LAN
      // address — exactly where a self-hosted install often runs. The value is selectable, so the
      // fallback is to select it by hand.
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-stretch gap-2">
        <code
          className={cn(
            'flex-1 select-all overflow-x-auto whitespace-nowrap rounded-md border px-3 py-2 font-mono text-xs leading-6',
            // A value that will never be shown again earns the one emphasis on the page.
            reveal
              ? 'border-primary/40 bg-primary/5 text-foreground'
              : 'bg-muted/40',
          )}
        >
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          className="shrink-0"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
