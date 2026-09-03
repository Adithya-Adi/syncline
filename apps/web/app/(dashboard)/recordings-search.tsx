'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The search box.
 *
 * The query lives in the URL, not in component state, for the same reason the "show empty" toggle
 * does: a search someone ran is a thing they will want to send to a colleague, come back to
 * tomorrow, or reload without losing. State that only React knows about survives none of that.
 *
 * Submitting navigates rather than fetching. Every row below is rendered by a server component
 * whose query is scoped to the viewer's organization, so re-running it on the server is both the
 * simplest path and the one where the scope check cannot be skipped.
 */
export function RecordingsSearch({
  projectId,
  query,
  showAll,
  /** Keys this project has actually used, for the hint line. */
  keys,
  /** Set when a query returned nothing, so the box can say so where it was typed. */
  unparsed,
}: {
  projectId: string;
  query: string;
  showAll: boolean;
  keys: { key: string; source: string }[];
  unparsed: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);

  // The box follows the URL when the URL changes underneath it — the back button, or a suggestion
  // clicked below. Without this, going back leaves the old text in a box that no longer describes
  // what is on screen.
  useEffect(() => setValue(query), [query]);

  function search(next: string) {
    const params = new URLSearchParams();
    if (next.trim()) params.set('q', next.trim());
    if (showAll) params.set('all', '1');
    // The cursor is deliberately dropped: page four of one search is not page four of another.
    const suffix = params.toString();
    router.push(
      `/projects/${projectId}/recordings${suffix ? `?${suffix}` : ''}`,
    );
  }

  const custom = keys.filter((entry) => entry.source === 'custom');

  return (
    <div className="min-w-0">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          search(value);
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="user:u_8823 path:/checkout has:error duration:>10s"
            aria-label="Search recordings"
            className="pl-9 font-mono text-[13px]"
          />
          {value.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setValue('');
                search('');
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>

      {/*
       * What was not understood, said next to where it was typed. A search that quietly drops half
       * the query and returns a confident list is the worst outcome here: the answer looks like an
       * answer to the question that was asked.
       */}
      {unparsed.length > 0 && (
        <p className="mt-2 text-xs text-destructive">
          Ignored: <span className="font-mono">{unparsed.join(' ')}</span>. Use{' '}
          <span className="font-mono">key:value</span>.
        </p>
      )}

      {/*
       * The keys this project actually sends, not a list of everything the language allows. A
       * suggestion for a key nobody uses is noise; `accountId` on a project that sends it is the
       * one thing worth knowing about this box.
       */}
      {custom.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span>Your keys:</span>
          {custom.slice(0, 8).map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                const next = `${value} ${entry.key}:`.trim();
                setValue(next);
              }}
              className="rounded border px-1.5 py-0.5 font-mono transition-colors hover:bg-muted"
            >
              {entry.key}
            </button>
          ))}
          {custom.length > 8 && <span>+{custom.length - 8}</span>}
        </p>
      )}
    </div>
  );
}
