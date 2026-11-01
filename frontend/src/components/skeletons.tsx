import { cx } from '@/lib/cx';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none', className)}
    />
  );
}

/** Placeholder for the fare card while an estimate loads. */
export function FareSkeleton({ label = 'Calculating fare…' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-3" data-testid="fare-skeleton">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

/** Placeholder for the ride status page's first load. */
export function RideSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading ride…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
