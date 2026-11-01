import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/cx';

export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section
      className={cx('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}
      {...props}
    >
      {children}
    </section>
  );
}
