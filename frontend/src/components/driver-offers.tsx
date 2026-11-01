'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { CATEGORY_LABEL, formatDistance, formatEta, formatFare } from '@/lib/format';
import type { DriverAvailability, Offer } from '@/types/api';
import { EmptyState } from './empty-state';
import { ErrorBanner } from './error-banner';
import { Skeleton } from './skeletons';
import { Button } from './ui/button';
import { Card } from './ui/card';

export interface DriverOffersProps {
  availability: DriverAvailability;
  offers: UseQueryResult<Offer[]>;
  /** Ride id currently being accepted, if any. */
  acceptingRideId: string | null;
  busy: boolean;
  onAccept: (offer: Offer) => void;
}

/** Open ride requests this driver could take now, nearest pickup first (polled). */
export function DriverOffers({
  availability,
  offers,
  acceptingRideId,
  busy,
  onAccept,
}: DriverOffersProps) {
  return (
    <Card aria-labelledby="offers-heading">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="offers-heading" className="text-lg font-semibold text-slate-900">
          Ride requests near you
        </h2>
        {availability === 'AVAILABLE' && (
          <span className="text-xs text-slate-500">Refreshes every few seconds</span>
        )}
      </div>
      <OffersBody
        availability={availability}
        offers={offers}
        acceptingRideId={acceptingRideId}
        busy={busy}
        onAccept={onAccept}
      />
    </Card>
  );
}

function OffersBody({ availability, offers, acceptingRideId, busy, onAccept }: DriverOffersProps) {
  if (availability === 'OFFLINE') {
    return <EmptyState title="You're offline">Go online to see ride requests near you.</EmptyState>;
  }
  if (offers.isPending) {
    return (
      <div role="status" aria-busy="true" className="space-y-2">
        <span className="sr-only">Loading ride requests…</span>
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }
  if (offers.isError && !offers.data) {
    return (
      <ErrorBanner
        title="Couldn't load ride requests"
        error={offers.error}
        onRetry={() => void offers.refetch()}
        retrying={offers.isFetching}
      />
    );
  }
  if (offers.data.length === 0) {
    return (
      <EmptyState title="No ride requests nearby">
        New requests within 5 km of you appear here automatically.
      </EmptyState>
    );
  }

  return (
    <ul className="space-y-3" aria-label="Ride requests">
      {offers.data.map((offer) => {
        const { ride } = offer;
        return (
          <li key={ride.id} className="rounded-xl border border-slate-200 p-3" data-testid="offer">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-slate-900">
                {ride.pickup.name} <span aria-hidden="true">→</span>
                <span className="sr-only">to</span> {ride.destination.name}
              </p>
              <p className="shrink-0 font-semibold text-slate-900">
                {formatFare(ride.fare.estimatedTotal)}
              </p>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {CATEGORY_LABEL[ride.category]} · {formatDistance(ride.distanceMeters)} trip · pickup{' '}
              {formatDistance(offer.distanceToPickupMeters)} away (about{' '}
              {formatEta(offer.pickupEtaMinutes)})
            </p>
            <Button
              className="mt-3 w-full sm:w-auto"
              onClick={() => onAccept(offer)}
              loading={acceptingRideId === ride.id}
              disabled={busy}
            >
              Accept ride
              <span className="sr-only">
                : {ride.pickup.name} to {ride.destination.name}
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
