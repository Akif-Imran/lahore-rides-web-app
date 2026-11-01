'use client';

import { useState } from 'react';
import { setDriverId, useDriverActor, useDriverId } from '@/hooks/use-actor';
import {
  type DriverActionVariables,
  useDriverProfile,
  useDriverRideAction,
  useOffers,
  useSetAvailability,
} from '@/hooks/use-driver';
import { cx } from '@/lib/cx';
import { DEMO_DRIVERS, type DemoDriver, findDemoDriver } from '@/lib/demo-actors';
import { isApiError, toUserMessage } from '@/lib/errors';
import { CATEGORY_LABEL, formatAgo, formatFare } from '@/lib/format';
import { findLandmark, LANDMARKS } from '@/lib/landmarks';
import type { Coordinates, Driver, DriverAvailability, Offer, Ride } from '@/types/api';
import { ConfirmDialog } from './confirm-dialog';
import { DriverActiveTrip } from './driver-active-trip';
import { DriverOffers } from './driver-offers';
import { ErrorBanner } from './error-banner';
import { Skeleton } from './skeletons';
import { Button } from './ui/button';
import { Card } from './ui/card';

type Feedback = { tone: 'success'; text: string } | { tone: 'error'; text: string; error: unknown };

/** Driver-facing copy for a failed accept (blueprint 5.4.3). */
export function acceptErrorMessage(error: unknown): string {
  if (!isApiError(error)) return toUserMessage(error);
  switch (error.code) {
    case 'RIDE_ALREADY_ASSIGNED':
      return 'Another driver took this ride.';
    case 'INVALID_STATE_TRANSITION':
    case 'NOT_FOUND':
      return 'This ride is no longer available.';
    default:
      return toUserMessage(error);
  }
}

function availabilityErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === 'CONFLICT') {
    return "You can't change availability during a trip.";
  }
  if (isApiError(error) && error.code === 'VALIDATION_ERROR') {
    return 'That position is outside the service area.';
  }
  return toUserMessage(error);
}

const AVAILABILITY_LABEL: Record<DriverAvailability, string> = {
  AVAILABLE: 'Online',
  OFFLINE: 'Offline',
  BUSY: 'On a trip',
};

const CURRENT_POSITION = 'current';
const HOME_POSITION = 'home';

function resolvePosition(
  choice: string,
  driver: Driver | undefined,
  demo: DemoDriver | undefined,
): Coordinates | null {
  if (choice === CURRENT_POSITION && driver?.location) return driver.location;
  const landmark = findLandmark(choice);
  if (landmark) return { lat: landmark.lat, lng: landmark.lng };
  return demo?.home ?? driver?.location ?? null;
}

/**
 * Simulated driver app (blueprint 5.4.3): pick a seeded driver, go online, accept a request,
 * start and complete the trip. Each browser tab can act as a different driver.
 */
export function DriverConsole() {
  const driverId = useDriverId();
  const actor = useDriverActor();
  const profile = useDriverProfile(actor);
  const driver = profile.data;
  const offersEnabled = driver?.availability === 'AVAILABLE' && !driver.activeRide;
  const offers = useOffers(actor, offersEnabled);
  const rideAction = useDriverRideAction(actor);
  const availability = useSetAvailability(actor);

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [positionChoice, setPositionChoice] = useState(CURRENT_POSITION);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const demo = findDemoDriver(driverId);
  const effectivePosition =
    positionChoice === CURRENT_POSITION && !driver?.location ? HOME_POSITION : positionChoice;
  const busy = rideAction.isPending || availability.isPending;

  const switchDriver = (id: string) => {
    setDriverId(id);
    setFeedback(null);
    setPositionChoice(CURRENT_POSITION);
    rideAction.reset();
    availability.reset();
  };

  const runRideAction = (
    variables: DriverActionVariables,
    onSuccessText: (ride: Ride) => string,
  ) => {
    setFeedback(null);
    rideAction.mutate(variables, {
      onSuccess: (ride) => setFeedback({ tone: 'success', text: onSuccessText(ride) }),
      onError: (error) =>
        setFeedback({
          tone: 'error',
          error,
          text: variables.action === 'accept' ? acceptErrorMessage(error) : toUserMessage(error),
        }),
    });
  };

  const changeAvailability = (
    status: 'AVAILABLE' | 'OFFLINE',
    withPosition: boolean,
    successText: string,
  ) => {
    const position = withPosition ? resolvePosition(effectivePosition, driver, demo) : null;
    setFeedback(null);
    availability.mutate(
      { status, ...(position ?? {}) },
      {
        onSuccess: () => setFeedback({ tone: 'success', text: successText }),
        onError: (error) =>
          setFeedback({ tone: 'error', error, text: availabilityErrorMessage(error) }),
      },
    );
  };

  const accept = (offer: Offer) =>
    runRideAction(
      { rideId: offer.ride.id, action: 'accept' },
      (ride) => `Ride accepted. Head to the pickup at ${ride.pickup.name}.`,
    );

  const activeRide = driver?.activeRide ?? null;
  const pendingAction =
    rideAction.isPending && rideAction.variables.action !== 'accept'
      ? rideAction.variables.action
      : null;
  const acceptingRideId =
    rideAction.isPending && rideAction.variables.action === 'accept'
      ? rideAction.variables.rideId
      : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Driver console</h1>
        <p
          role="note"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <span className="font-semibold">Simulation.</span> This page stands in for a driver app so
          you can accept and complete rides in the demo. Open it in two tabs to race two drivers for
          the same ride.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
        <Card aria-labelledby="driver-heading">
          <h2 id="driver-heading" className="sr-only">
            Driver
          </h2>
          <label className="block text-sm font-medium text-slate-800">
            Acting as driver
            <select
              value={driverId ?? ''}
              onChange={(event) => switchDriver(event.target.value)}
              disabled={driverId === null}
              className="mt-1 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:outline-2 focus:outline-emerald-700"
            >
              {driverId === null && <option value="">Loading…</option>}
              {DEMO_DRIVERS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {CATEGORY_LABEL[d.vehicleCategory]} · {d.area}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4">
            {profile.isPending ? (
              <div role="status" aria-busy="true" className="space-y-2">
                <span className="sr-only">Loading driver…</span>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            ) : !driver ? (
              <ErrorBanner
                title="Couldn't load this driver"
                error={profile.error}
                onRetry={() => void profile.refetch()}
                retrying={profile.isFetching}
              />
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="flex items-center gap-2" data-testid="driver-availability">
                    <span
                      aria-hidden="true"
                      className={cx(
                        'size-2.5 rounded-full',
                        driver.availability === 'AVAILABLE' && 'bg-emerald-600',
                        driver.availability === 'BUSY' && 'bg-sky-600',
                        driver.availability === 'OFFLINE' && 'bg-slate-400',
                      )}
                    />
                    <span className="font-semibold text-slate-900">
                      {AVAILABILITY_LABEL[driver.availability]}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {driver.vehicle} · {driver.plate} · {CATEGORY_LABEL[driver.vehicleCategory]}
                  </p>
                  <p className="text-xs text-slate-500">
                    {driver.locationUpdatedAt
                      ? `Position reported ${formatAgo(driver.locationUpdatedAt)}`
                      : 'No position reported yet'}
                  </p>
                </div>

                {driver.availability === 'BUSY' ? (
                  <p className="text-sm text-slate-700">
                    You can go offline or move once the current trip ends.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-slate-800">
                      Position
                      <select
                        value={effectivePosition}
                        onChange={(event) => setPositionChoice(event.target.value)}
                        className="mt-1 block min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-2 focus:outline-emerald-700"
                      >
                        {driver.location && (
                          <option value={CURRENT_POSITION}>Current position</option>
                        )}
                        {demo && <option value={HOME_POSITION}>{demo.area} (home area)</option>}
                        {LANDMARKS.map((landmark) => (
                          <option key={landmark.id} value={landmark.id}>
                            Near {landmark.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {driver.availability === 'OFFLINE' ? (
                        <Button
                          onClick={() =>
                            changeAvailability(
                              'AVAILABLE',
                              true,
                              "You're online. Ride requests near you appear on this page.",
                            )
                          }
                          loading={availability.isPending}
                          disabled={busy}
                        >
                          Go online
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              changeAvailability('AVAILABLE', true, 'Position updated.')
                            }
                            disabled={busy}
                          >
                            Update position
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => changeAvailability('OFFLINE', false, "You're offline.")}
                            disabled={busy}
                          >
                            Go offline
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <div aria-live="polite" role="status" className={cx(!feedback && 'sr-only')}>
            {feedback?.tone === 'success' && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                {feedback.text}
              </p>
            )}
          </div>
          {feedback?.tone === 'error' && (
            <ErrorBanner error={feedback.error} message={feedback.text} />
          )}

          {driver &&
            (activeRide ? (
              <DriverActiveTrip
                ride={activeRide}
                pendingAction={pendingAction}
                busy={busy}
                onStart={() =>
                  runRideAction({ rideId: activeRide.id, action: 'start' }, () => 'Trip started.')
                }
                onComplete={() =>
                  runRideAction(
                    { rideId: activeRide.id, action: 'complete' },
                    (ride) =>
                      `Trip completed. Fare: ${formatFare(ride.fare.finalTotal ?? ride.fare.estimatedTotal)}.`,
                  )
                }
                onCancel={() => setConfirmCancel(true)}
              />
            ) : (
              <DriverOffers
                availability={driver.availability}
                offers={offers}
                acceptingRideId={acceptingRideId}
                busy={busy}
                onAccept={accept}
              />
            ))}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel && activeRide?.status === 'ASSIGNED'}
        title="Cancel this ride?"
        description="The rider will see that the driver cancelled."
        confirmLabel="Cancel ride"
        cancelLabel="Keep ride"
        confirming={rideAction.isPending}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          if (!activeRide) return;
          runRideAction({ rideId: activeRide.id, action: 'cancel' }, () => 'Ride cancelled.');
          setConfirmCancel(false);
        }}
      />
    </div>
  );
}
