'use client';

import Link from 'next/link';
import { useActiveRide } from '@/hooks/use-rides';
import { RIDER_STATUS_COPY } from '@/lib/ride-status';

/** "Resume your ride": after a refresh or a new tab, the active ride is one tap away. */
export function ActiveRideNotice() {
  const { data: ride } = useActiveRide();
  if (!ride) return null;

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="font-semibold text-emerald-950">
          You have a ride in progress: {RIDER_STATUS_COPY[ride.status].title.toLowerCase()}
        </p>
        <p className="text-sm text-emerald-900">
          {ride.pickup.name} → {ride.destination.name}
        </p>
      </div>
      <Link
        href={`/ride/${ride.id}`}
        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
      >
        View ride
      </Link>
    </div>
  );
}
