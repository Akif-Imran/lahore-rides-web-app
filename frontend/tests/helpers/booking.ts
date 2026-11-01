import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { FareEstimateResponse, Ride } from '@/types/api';
import { makeEstimate } from './fixtures';
import { apiUrl } from './msw';

/** Picks a landmark through the combobox the way a user would: type, then click the option. */
export async function chooseLandmark(
  user: UserEvent,
  label: 'Pickup' | 'Destination',
  search: string,
  option: RegExp,
): Promise<void> {
  const input = screen.getByRole('combobox', { name: label });
  await user.clear(input);
  await user.type(input, search);
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Liberty Market → Lahore Fort, the trip used throughout the blueprint. */
export async function chooseDefaultTrip(user: UserEvent): Promise<void> {
  await chooseLandmark(user, 'Pickup', 'Liberty', /^Liberty Market/);
  await chooseLandmark(user, 'Destination', 'Fort', /^Lahore Fort/);
}

/** Handlers the booking screen always needs: active-ride lookup and fare estimates. */
export function bookingApi(
  options: { estimate?: FareEstimateResponse; activeRide?: Ride | null } = {},
) {
  const calls = { estimates: 0 };
  const handlers = [
    http.get(apiUrl('/riders/me/active-ride'), () =>
      HttpResponse.json({ ride: options.activeRide ?? null }),
    ),
    http.post(apiUrl('/fare-estimates'), () => {
      calls.estimates += 1;
      return HttpResponse.json(options.estimate ?? makeEstimate());
    }),
  ];
  return { calls, handlers };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
