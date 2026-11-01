'use client';

import { CATEGORY_LABEL, formatDistance, formatFare } from '@/lib/format';
import type { Ride } from '@/types/api';
import { Button } from './ui/button';
import { Card } from './ui/card';

export interface DriverActiveTripProps {
  ride: Ride;
  pendingAction: 'start' | 'complete' | 'cancel' | null;
  busy: boolean;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

const TRIP_STAGE: Partial<Record<Ride['status'], string>> = {
  ASSIGNED: 'Heading to pickup',
  IN_PROGRESS: 'On trip',
};

/** The driver's assigned ride, with the next lifecycle action. */
export function DriverActiveTrip({
  ride,
  pendingAction,
  busy,
  onStart,
  onComplete,
  onCancel,
}: DriverActiveTripProps) {
  return (
    <Card aria-labelledby="trip-heading" data-testid="driver-active-trip">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="trip-heading" className="text-lg font-semibold text-slate-900">
          Current trip
        </h2>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">
          {TRIP_STAGE[ride.status] ?? ride.status}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-600">Pickup</dt>
        <dd className="font-medium text-slate-900">{ride.pickup.name}</dd>
        <dt className="text-slate-600">Drop-off</dt>
        <dd className="font-medium text-slate-900">{ride.destination.name}</dd>
        <dt className="text-slate-600">Ride type</dt>
        <dd className="text-slate-900">{CATEGORY_LABEL[ride.category]}</dd>
        <dt className="text-slate-600">Trip</dt>
        <dd className="text-slate-900">{formatDistance(ride.distanceMeters)}</dd>
        <dt className="text-slate-600">Fare</dt>
        <dd className="font-semibold text-slate-900">{formatFare(ride.fare.estimatedTotal)}</dd>
      </dl>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {ride.status === 'ASSIGNED' && (
          <>
            <Button onClick={onStart} loading={pendingAction === 'start'} disabled={busy}>
              Start trip
            </Button>
            <Button
              variant="secondary"
              onClick={onCancel}
              loading={pendingAction === 'cancel'}
              disabled={busy}
            >
              Cancel ride
            </Button>
          </>
        )}
        {ride.status === 'IN_PROGRESS' && (
          <Button onClick={onComplete} loading={pendingAction === 'complete'} disabled={busy}>
            Complete trip
          </Button>
        )}
      </div>
    </Card>
  );
}
