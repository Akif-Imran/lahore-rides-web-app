'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCancelRide, useRide } from '@/hooks/use-rides';
import { isApiError, isTransientError, toUserMessage } from '@/lib/errors';
import {
  CANCELLED_BY_LABEL,
  CATEGORY_LABEL,
  formatDistance,
  formatDuration,
  formatEta,
  formatFare,
  formatTime,
} from '@/lib/format';
import { riderCanCancel } from '@/lib/ride-status';
import type { Ride } from '@/types/api';
import { ConfirmDialog } from './confirm-dialog';
import { DriverCard } from './driver-card';
import { ErrorBanner } from './error-banner';
import { MapPlaceholder } from './map-placeholder';
import { NotFoundView } from './not-found-view';
import { RideStatusHeadline, RideStatusStepper } from './ride-status';
import { RideSkeleton } from './skeletons';
import { Button } from './ui/button';
import { Card } from './ui/card';

/** Copy for a failed cancel; a 409 means the ride moved on (blueprint 5.4.2). */
export function cancelErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === 'INVALID_STATE_TRANSITION') {
    const current = error.detail('currentStatus');
    if (current === 'IN_PROGRESS') return "Trip already started, can't cancel.";
    if (current === 'COMPLETED') return 'This trip has already ended.';
    if (current === 'CANCELLED' || current === 'EXPIRED') return 'This ride is no longer active.';
  }
  return toUserMessage(error);
}

/** The rider's ride: live status while active, then a receipt or outcome view. */
export function RideView({ rideId }: { rideId: string }) {
  const query = useRide(rideId);
  const cancel = useCancelRide(rideId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (query.isPending) return <RideSkeleton />;

  if (!query.data) {
    const error = query.error;
    if (isApiError(error) && (error.status === 404 || error.status === 400)) {
      return (
        <NotFoundView
          title="Ride not found"
          message="This ride doesn't exist, or it belongs to a different rider."
        />
      );
    }
    return (
      <ErrorBanner
        title="Couldn't load your ride"
        error={error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const ride = query.data;
  // Keep showing the last known status while polling fails, with a visible notice.
  const reconnecting = query.failureCount > 0 || (query.isError && isTransientError(query.error));

  return (
    <div className="space-y-6">
      {reconnecting && (
        <ErrorBanner
          tone="warning"
          title="Reconnecting…"
          message="Showing the last known status while we try to reach the server."
          // Stays enabled during automatic retries: refetch() cancels the backoff wait and
          // tries immediately.
          onRetry={() => void query.refetch({ cancelRefetch: true })}
          retryLabel="Retry now"
        />
      )}

      <RideStatusHeadline status={ride.status} />

      {ride.status === 'COMPLETED' || ride.status === 'CANCELLED' || ride.status === 'EXPIRED' ? (
        <TerminalRide ride={ride} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 md:items-start">
          <div className="space-y-4">
            <Card>
              <RideStatusStepper status={ride.status} />
            </Card>

            {ride.driver ? (
              <Card aria-label="Your driver">
                <DriverCard driver={ride.driver} />
              </Card>
            ) : (
              <Card>
                <p className="text-sm text-slate-700">
                  {ride.etaMinutes !== null
                    ? `The nearest driver was about ${formatEta(ride.etaMinutes)} away when you requested.`
                    : 'No driver was nearby when you requested. We will keep looking.'}
                </p>
              </Card>
            )}

            <TripSummary ride={ride} />

            {cancel.isError && (
              <ErrorBanner error={cancel.error} message={cancelErrorMessage(cancel.error)} />
            )}

            {riderCanCancel(ride.status) && (
              <Button variant="secondary" className="w-full" onClick={() => setConfirmOpen(true)}>
                Cancel ride
              </Button>
            )}
          </div>

          <MapPlaceholder
            pickup={ride.pickup}
            destination={ride.destination}
            driver={ride.driver?.location ?? null}
            className="md:sticky md:top-6"
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen && riderCanCancel(ride.status)}
        title="Cancel this ride?"
        description={
          ride.status === 'ASSIGNED'
            ? 'Your driver is already on the way.'
            : 'We will stop looking for a driver.'
        }
        confirmLabel="Cancel ride"
        cancelLabel="Keep ride"
        confirming={cancel.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => cancel.mutate({}, { onSettled: () => setConfirmOpen(false) })}
      />
    </div>
  );
}

function TripSummary({ ride }: { ride: Ride }) {
  const fare = ride.fare.finalTotal ?? ride.fare.estimatedTotal;
  return (
    <Card aria-label="Trip summary">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-600">From</dt>
        <dd className="font-medium text-slate-900">{ride.pickup.name}</dd>
        <dt className="text-slate-600">To</dt>
        <dd className="font-medium text-slate-900">{ride.destination.name}</dd>
        <dt className="text-slate-600">Ride type</dt>
        <dd className="text-slate-900">{CATEGORY_LABEL[ride.category]}</dd>
        <dt className="text-slate-600">Trip</dt>
        <dd className="text-slate-900">
          {formatDistance(ride.distanceMeters)} · {formatDuration(ride.durationSeconds)}
        </dd>
        <dt className="text-slate-600">
          {ride.fare.finalTotal !== null ? 'Fare' : 'Estimated fare'}
        </dt>
        <dd className="font-semibold text-slate-900" data-testid="ride-fare">
          {formatFare(fare)}
        </dd>
      </dl>
    </Card>
  );
}

function TerminalRide({ ride }: { ride: Ride }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-start">
      <div className="space-y-4">
        {ride.status === 'COMPLETED' && <Receipt ride={ride} />}
        {ride.status === 'CANCELLED' && (
          <Card>
            <p className="text-sm text-slate-700">
              Cancelled by {ride.cancelledBy ? CANCELLED_BY_LABEL[ride.cancelledBy] : 'someone'}
              {ride.cancelledAt ? ` at ${formatTime(ride.cancelledAt)}` : ''}.
            </p>
            {ride.cancelReason && (
              <p className="mt-1 text-sm text-slate-700">Reason: {ride.cancelReason}</p>
            )}
          </Card>
        )}
        {ride.status !== 'COMPLETED' && <TripSummary ride={ride} />}
        <Link
          href="/"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800"
        >
          {ride.status === 'EXPIRED' ? 'Try again' : 'Book another ride'}
        </Link>
      </div>
      <MapPlaceholder pickup={ride.pickup} destination={ride.destination} />
    </div>
  );
}

function Receipt({ ride }: { ride: Ride }) {
  const { breakdown } = ride.fare;
  const total = ride.fare.finalTotal ?? ride.fare.estimatedTotal;
  return (
    <Card aria-label="Receipt" data-testid="receipt">
      <h2 className="text-sm font-medium tracking-wide text-slate-600 uppercase">Receipt</h2>
      <p className="mt-1 text-3xl font-bold text-slate-900" data-testid="receipt-total">
        {formatFare(total)}
      </p>
      <p className="text-sm text-slate-600">
        {ride.pickup.name} → {ride.destination.name}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-slate-600">Base fare</dt>
        <dd className="text-right">{formatFare(breakdown.base)}</dd>
        <dt className="text-slate-600">Distance ({formatDistance(ride.distanceMeters)})</dt>
        <dd className="text-right">{formatFare(breakdown.distance)}</dd>
        <dt className="text-slate-600">Time ({formatDuration(ride.durationSeconds)})</dt>
        <dd className="text-right">{formatFare(breakdown.time)}</dd>
        {breakdown.minimumFareApplied && (
          <>
            <dt className="text-slate-600">Minimum fare applied</dt>
            <dd className="text-right">Yes</dd>
          </>
        )}
        <dt className="border-t border-slate-200 pt-1 font-semibold">Total</dt>
        <dd className="border-t border-slate-200 pt-1 text-right font-semibold">
          {formatFare(total)}
        </dd>
      </dl>
      {ride.driver && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <DriverCard driver={ride.driver} />
        </div>
      )}
      {ride.completedAt && (
        <p className="mt-3 text-xs text-slate-600">Completed at {formatTime(ride.completedAt)}</p>
      )}
    </Card>
  );
}
