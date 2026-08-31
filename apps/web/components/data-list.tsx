import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
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
  className,
  minWidth = '760px',
}: {
  columns: string;
  children: ReactNode;
  className?: string;
  minWidth?: string;
}) {
  const style = {
    '--data-list-min-width': minWidth,
  } as CSSProperties;

  return (
    <div
      className={cn(
        'mt-6 overflow-x-auto rounded-lg border border-border/80 bg-card/35',
        className,
      )}
      data-columns={columns}
      style={style}
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
      className="grid min-w-[var(--data-list-min-width)] items-center gap-4 border-b bg-muted/45 px-4 py-2.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  );
}

/**
 * A row. Becomes a link when given an `href`, and a plain grid otherwise.
 *
 * Some lists are navigation and some are not: a member row carries its own buttons, and nesting
 * those inside a link is both invalid markup and impossible to operate by keyboard. So the row
 * without a destination is a `div`, and it also drops the hover affordance rather than inviting a
 * click that does nothing.
 */
export function DataListRow({
  href,
  columns,
  children,
}: {
  href?: string;
  columns: string;
  children: ReactNode;
}) {
  const layout =
    'grid min-w-[var(--data-list-min-width)] items-center gap-4 px-4 py-3.5 text-sm border-b last:border-b-0';
  const style = { gridTemplateColumns: columns };

  if (!href) {
    return (
      <div className={layout} style={style}>
        {children}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        layout,
        'transition-colors hover:bg-muted/45',
        'ease-brand duration-200',
        'focus-visible:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
      )}
      style={style}
    >
      {children}
    </Link>
  );
}
