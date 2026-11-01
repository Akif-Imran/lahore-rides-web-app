import type { ComponentProps, ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-600',
  secondary:
    'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-300 disabled:text-slate-600',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
};

const SIZES: Record<Size, string> = {
  md: 'min-h-10 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
};

/** Native button props, including `ref` (a plain prop in React 19). */
export interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button (blocks double submits). */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
