import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A list of records where each row is a single link.
 *
 * Not shadcn's `Table`. A table lays its columns out from its cells, so a row built as one
 * `colSpan` link cannot line up with the header — the two disagree about every width, and the
 * result is values sitting under the wrong headings. Here the header and every row share one grid
 * template, so they cannot drift.
 *
 * One link per row rather than one per cell means the whole strip is clickable and keyboard focus
 * stops once per record instead of once per column.
 */

export function DataList({
  columns,
  children,
}: {
  columns: string;
  children: ReactNode;
}) {
  return (
    <div
      className="mt-6 overflow-hidden rounded-lg border"
      data-columns={columns}
    >
      {children}
    </div>
  );
}

export function DataListHeader({
  columns,
  children,
}: {
  columns: string;
  children: ReactNode;
}) {
  return (
    <div
      className="sticky top-14 z-10 grid items-center gap-4 border-b bg-muted/40 px-4 py-2.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase backdrop-blur"
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  );
}

export function DataListRow({
  href,
  columns,
  children,
}: {
  href: string;
  columns: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'grid items-center gap-4 px-4 py-3 text-sm transition-colors',
        'border-b last:border-b-0 hover:bg-muted/40',
        'ease-brand duration-200',
        'focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
      )}
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </Link>
  );
}
