import { cn } from '@/lib/utils';

/**
 * The mark is the product's own diagram at its smallest readable size: three strata, and one axis
 * cutting down through all of them. It uses the stratum tokens rather than `currentColor`, so it
 * stays the same three colors the viewer uses to mean the same three layers.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cn('size-4', className)}
    >
      <rect x="1" y="3" width="11" height="2" rx="1" fill="var(--stratum-network)" />
      <rect x="3" y="7" width="9" height="2" rx="1" fill="var(--stratum-backend)" />
      <rect x="5" y="11" width="6" height="2" rx="1" fill="var(--stratum-database)" />
      <path d="M9.5 1v14" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="font-display text-[15px] tracking-[-0.01em] font-semibold">
        syncline
      </span>
    </span>
  );
}
