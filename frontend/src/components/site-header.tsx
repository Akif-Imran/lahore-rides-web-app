'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/lib/cx';
import { RiderSwitcher } from './rider-switcher';

const NAV = [
  {
    href: '/',
    label: 'Book a ride',
    match: (path: string) => path === '/' || path.startsWith('/ride'),
  },
  { href: '/driver', label: 'Driver console', match: (path: string) => path.startsWith('/driver') },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const onDriverConsole = pathname.startsWith('/driver');

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-emerald-700 text-white"
          >
            LR
          </span>
          Lahore Rides
        </Link>

        <nav aria-label="Main" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex gap-1">
            {NAV.map((item) => {
              const current = item.match(pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={cx(
                      'inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium',
                      current ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* The driver console has its own driver picker; rider pages act as a rider. */}
        {!onDriverConsole && <RiderSwitcher />}
      </div>
    </header>
  );
}
