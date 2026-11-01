import { CATEGORY_LABEL } from '@/lib/format';
import type { RideDriver } from '@/types/api';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function DriverCard({ driver }: { driver: RideDriver }) {
  return (
    <div className="flex items-center gap-3" data-testid="driver-card">
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sky-100 font-bold text-sky-900"
      >
        {initials(driver.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">{driver.name}</p>
        <p className="text-sm text-slate-600">
          {driver.vehicle} · {CATEGORY_LABEL[driver.vehicleCategory]}
        </p>
      </div>
      <span className="rounded-md border-2 border-slate-900 bg-yellow-50 px-2 py-1 font-mono text-sm font-bold tracking-wider text-slate-900">
        <span className="sr-only">Plate </span>
        {driver.plate}
      </span>
    </div>
  );
}
