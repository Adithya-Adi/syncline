'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

const countFormat = new Intl.NumberFormat('en-US');

/**
 * Deleting everything stored under one key.
 *
 * Confirmation is inline and states the count rather than being a modal saying "are you sure".
 * "Are you sure" is a question nobody reads; "delete 4,812 values" is the number that makes
 * somebody stop, and it is the only part of the sentence that changes between a mistake and an
 * intention.
 *
 * The server action is passed in rather than imported, so this stays a dumb control and the module
 * that owns the deletion is the one that also owns the scope check.
 */
export function DeleteKeyButton({
  projectId,
  attributeKey,
  values,
  action,
}: {
  projectId: string;
  attributeKey: string;
  values: number;
  action: (formData: FormData) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    );
  }

  return (
    <form
      action={async (formData) => {
        setPending(true);
        await action(formData);
        setPending(false);
        setConfirming(false);
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="key" value={attributeKey} />

      <span className="text-xs text-muted-foreground">
        Delete {countFormat.format(values)} {values === 1 ? 'value' : 'values'}{' '}
        and stop indexing?
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
    </form>
  );
}
