import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center',
        className,
      )}
    >
      <p className="font-semibold text-slate-900">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
