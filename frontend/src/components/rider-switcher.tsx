'use client';

import { setRiderId, useRiderId } from '@/hooks/use-actor';
import { DEMO_RIDERS } from '@/lib/demo-actors';

/** Demo "switch user": picks which seeded rider the app acts as (sent as X-Rider-Id). */
export function RiderSwitcher() {
  const riderId = useRiderId();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      {/* Visible from `sm` up; on phones it stays the select's accessible label. */}
      <span className="sr-only sm:not-sr-only">Riding as</span>
      <select
        value={riderId ?? ''}
        onChange={(event) => setRiderId(event.target.value)}
        disabled={riderId === null}
        className="min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-2 focus:outline-emerald-700"
      >
        {riderId === null && <option value="">Loading…</option>}
        {DEMO_RIDERS.map((rider) => (
          <option key={rider.id} value={rider.id}>
            {rider.name}
          </option>
        ))}
      </select>
    </label>
  );
}
