'use client';

import { useState } from 'react';

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
    <div className={`keyfield${reveal ? ' keyfield--reveal' : ''}`}>
      <span className="field__label">{label}</span>
      <div className="keyfield__row">
        <code className="keyfield__value">{value}</code>
        <button type="button" className="button keyfield__copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}
