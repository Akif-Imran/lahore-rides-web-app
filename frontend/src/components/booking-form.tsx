'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { Controller, type FieldPath, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useRiderActor } from '@/hooks/use-actor';
import { useCountdown } from '@/hooks/use-countdown';
import { useFareEstimate } from '@/hooks/use-fare-estimate';
import { useActiveRide, useCreateRide } from '@/hooks/use-rides';
import {
  type BookingState,
  canRequest,
  deriveBookingState,
  type RequestStatus,
} from '@/lib/booking-state';
import { isApiError, isTransientError, toUserMessage } from '@/lib/errors';
import { CATEGORY_LABEL, formatFare } from '@/lib/format';
import { canonicalJson, IntentKeyStore } from '@/lib/idempotency';
import { findLandmark, isLandmarkId, LANDMARKS, toApiLocation } from '@/lib/landmarks';
import { queryKeys } from '@/lib/query-client';
import { type CreateRideRequest, RIDE_CATEGORIES } from '@/types/api';
import { CategorySelector } from './category-selector';
import { ErrorBanner } from './error-banner';
import { FareCard } from './fare-card';
import { LocationPicker } from './location-picker';
import { MapPlaceholder } from './map-placeholder';
import { Button } from './ui/button';
import { Card } from './ui/card';

export const SAME_LOCATION_MESSAGE = 'Pickup and destination must be different';

export const bookingSchema = z
  .object({
    pickupId: z.string().refine(isLandmarkId, 'Choose a pickup location from the list'),
    destinationId: z.string().refine(isLandmarkId, 'Choose a destination from the list'),
    category: z.enum(RIDE_CATEGORIES),
  })
  .refine((v) => v.pickupId !== v.destinationId, {
    path: ['destinationId'],
    message: SAME_LOCATION_MESSAGE,
  });

export type BookingValues = z.infer<typeof bookingSchema>;

/** Maps a backend field path (`pickup.lat`, `destination`) to the form field it belongs to. */
export function formFieldFor(serverField: string): FieldPath<BookingValues> | null {
  const root = serverField.split('.')[0];
  if (root === 'pickup') return 'pickupId';
  if (root === 'destination') return 'destinationId';
  if (root === 'category') return 'category';
  return null;
}

function toRequestBody(values: BookingValues): CreateRideRequest | null {
  const pickup = findLandmark(values.pickupId);
  const destination = findLandmark(values.destinationId);
  if (!pickup || !destination) return null;
  return {
    pickup: toApiLocation(pickup),
    destination: toApiLocation(destination),
    category: values.category,
  };
}

/**
 * The rider's booking screen: landmarks + category (react-hook-form + zod), live fare estimate,
 * and an idempotent "Request ride" (one Idempotency-Key per intent, reused by every retry).
 * All UI state comes from `deriveBookingState`.
 */
export function BookingForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const actor = useRiderActor();
  const activeRide = useActiveRide();
  const createRide = useCreateRide();
  const rateLimit = useCountdown();
  const [intentKeys] = useState(() => new IntentKeyStore());
  // Synchronous guard: a second click can land before React re-renders the disabled button.
  const inFlight = useRef(false);

  const {
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, touchedFields },
  } = useForm<BookingValues>({
    resolver: zodResolver(bookingSchema),
    mode: 'onTouched',
    defaultValues: { pickupId: '', destinationId: '', category: 'ECONOMY' },
  });

  const [pickupId, destinationId, category] = useWatch({
    control,
    name: ['pickupId', 'destinationId', 'category'],
  });
  const values: BookingValues = { pickupId, destinationId, category };
  const tripValid = bookingSchema.safeParse(values).success;
  const body = tripValid ? toRequestBody(values) : null;
  const fingerprint = actor && body ? canonicalJson({ riderId: actor.id, ...body }) : null;

  const { estimate, retry: retryEstimate } = useFareEstimate(actor, pickupId, destinationId);

  // Only a request made for the trip currently on screen counts; an error from an earlier
  // trip disappears as soon as the rider changes the form.
  const request: RequestStatus = createRide.isPending
    ? { status: 'pending' }
    : createRide.isSuccess
      ? { status: 'success', rideId: createRide.data.ride.id }
      : createRide.isError && createRide.variables?.fingerprint === fingerprint
        ? { status: 'error', error: createRide.error }
        : { status: 'idle' };

  const state = deriveBookingState({
    tripValid,
    category,
    estimate,
    request,
    hasActiveRide: !!activeRide.data,
    rateLimitSecondsLeft: rateLimit.secondsLeft,
  });

  const handleRequestError = (error: unknown) => {
    if (!isApiError(error) || !actor) return;
    switch (error.code) {
      case 'ACTIVE_RIDE_EXISTS': {
        void queryClient.invalidateQueries({ queryKey: queryKeys.activeRide(actor.id) });
        const activeRideId = error.detail('activeRideId');
        if (activeRideId) router.push(`/ride/${activeRideId}`);
        break;
      }
      case 'VALIDATION_ERROR':
        for (const fieldError of error.fieldErrors) {
          const field = formFieldFor(fieldError.field);
          if (field) setError(field, { type: 'server', message: fieldError.message });
        }
        break;
      case 'RATE_LIMITED':
        rateLimit.start(error.retryAfterSeconds ?? 60);
        break;
      case 'IDEMPOTENCY_KEY_REUSED':
        intentKeys.reset();
        break;
      default:
        break;
    }
  };

  const requestRide = (submitted: BookingValues) => {
    const requestBody = toRequestBody(submitted);
    if (!actor || !requestBody || inFlight.current || !canRequest(state)) return;
    const requestFingerprint = canonicalJson({ riderId: actor.id, ...requestBody });
    const idempotencyKey = intentKeys.keyFor(requestFingerprint);

    inFlight.current = true;
    createRide.mutate(
      { actor, body: requestBody, idempotencyKey, fingerprint: requestFingerprint },
      {
        onSuccess: ({ ride }) => {
          intentKeys.reset();
          router.push(`/ride/${ride.id}`);
        },
        onError: handleRequestError,
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  // Built per event so the ref-reading callback never runs (or is wrapped) during render.
  const submit = (event?: FormEvent<HTMLFormElement>) => handleSubmit(requestRide)(event);

  const swap = () => {
    const { pickupId: from, destinationId: to } = getValues();
    const validate = !!touchedFields.pickupId || !!touchedFields.destinationId;
    setValue('pickupId', to, { shouldValidate: validate });
    setValue('destinationId', from, { shouldValidate: validate });
  };

  const locked = state.kind === 'requesting' || state.kind === 'active';
  const sameLocation = !!pickupId && pickupId === destinationId;
  const pickup = findLandmark(pickupId);
  const destination = findLandmark(destinationId);

  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-start">
      <Card aria-labelledby="booking-heading">
        <h2 id="booking-heading" className="sr-only">
          Trip details
        </h2>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Controller
            control={control}
            name="pickupId"
            render={({ field }) => (
              <LocationPicker
                label="Pickup"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                options={LANDMARKS}
                error={errors.pickupId?.message}
                disabled={locked}
              />
            )}
          />

          <div className="flex justify-end">
            <Button
              variant="ghost"
              onClick={swap}
              disabled={locked || (!pickupId && !destinationId)}
              aria-label="Swap pickup and destination"
              className="-my-2"
            >
              <span aria-hidden="true">⇅</span> Swap
            </Button>
          </div>

          <Controller
            control={control}
            name="destinationId"
            render={({ field }) => (
              <LocationPicker
                label="Destination"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                options={LANDMARKS}
                error={
                  errors.destinationId?.message ??
                  (sameLocation ? SAME_LOCATION_MESSAGE : undefined)
                }
                disabled={locked}
              />
            )}
          />

          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <CategorySelector
                value={field.value}
                onChange={field.onChange}
                estimates={estimate.status === 'success' ? estimate.data.estimates : null}
                disabled={locked}
              />
            )}
          />

          <FareCard estimate={estimate} category={category} onRetry={retryEstimate} />

          <RequestSection
            state={state}
            category={category}
            rateLimitSecondsLeft={rateLimit.secondsLeft}
            onRetry={() => void submit()}
          />
        </form>
      </Card>

      <MapPlaceholder
        pickup={pickup ?? null}
        destination={destination ?? null}
        className="md:sticky md:top-6"
      />
    </div>
  );
}

function RequestSection({
  state,
  category,
  rateLimitSecondsLeft,
  onRetry,
}: {
  state: BookingState;
  category: BookingValues['category'];
  rateLimitSecondsLeft: number;
  onRetry: () => void;
}) {
  const hint = requestHint(state, rateLimitSecondsLeft);
  const requestError = state.kind === 'ready' ? state.requestError : null;

  return (
    <div className="space-y-3">
      {requestError !== null && (
        <ErrorBanner
          title="Your ride was not requested"
          error={requestError}
          message={
            isTransientError(requestError) ? (
              <>{toUserMessage(requestError)} Retrying is safe: you will not be booked twice.</>
            ) : undefined
          }
          onRetry={isTransientError(requestError) ? onRetry : undefined}
        />
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!canRequest(state)}
        loading={state.kind === 'requesting'}
        aria-describedby={hint ? 'request-hint' : undefined}
      >
        {state.kind === 'requesting'
          ? 'Requesting ride…'
          : state.kind === 'active'
            ? 'Ride requested'
            : state.kind === 'ready'
              ? `Request ${CATEGORY_LABEL[category]} · ${formatFare(state.estimate.total)}`
              : 'Request ride'}
      </Button>

      {hint && (
        <p id="request-hint" className="text-center text-sm text-slate-600" aria-live="polite">
          {hint}
        </p>
      )}

      {state.kind === 'active' && (
        <p className="text-center text-sm">
          <Link href={`/ride/${state.rideId}`} className="font-semibold text-emerald-800 underline">
            View your ride
          </Link>
        </p>
      )}
    </div>
  );
}

function requestHint(state: BookingState, rateLimitSecondsLeft: number): string | null {
  switch (state.kind) {
    case 'idle':
      return 'Choose a pickup and a destination to request a ride.';
    case 'estimating':
      return 'Calculating your fare…';
    case 'estimate-error':
      return 'A fare estimate is needed before you can request a ride.';
    case 'no-drivers':
      return `No ${CATEGORY_LABEL[state.estimate.category]} drivers are nearby right now.`;
    case 'ready':
      if (state.blockedBy === 'active-ride') return 'You already have a ride in progress.';
      if (state.blockedBy === 'rate-limited') {
        return `Too many attempts. Try again in ${rateLimitSecondsLeft} s.`;
      }
      return null;
    case 'requesting':
      return 'Sending your request. You can safely retry if it fails.';
    case 'active':
      return 'Ride requested. Opening your ride…';
  }
}
