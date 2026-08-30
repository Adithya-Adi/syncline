import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The top of every dashboard page.
 *
 * Each page used to hand-roll this, and they had drifted — different heading sizes, some with a
 * lede and some without, actions aligned three different ways. One component means a new page
 * inherits the shape instead of approximating it.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-4',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && (
          <div className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * What a list shows when it has nothing to show.
 *
 * Always carries the action that unblocks it. "Nothing here yet" without a next step leaves the
 * reader to work out whether they are misconfigured or merely early, which is exactly the question
 * the setup page exists to answer.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      {icon && (
        <div className="flex size-9 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
          {icon}
        </div>
      )}
      <h2 className="font-display text-sm font-semibold">{title}</h2>
      {children && (
        <div className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
