import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ConfigModule from '@/lib/config';
import { ActiveRideNotice } from '@/components/active-ride-notice';
import { BookingForm, SAME_LOCATION_MESSAGE } from '@/components/booking-form';
import { bookingApi, chooseDefaultTrip, chooseLandmark, sleep } from '../helpers/booking';
import { makeRide, RIDE_ID } from '../helpers/fixtures';
import { server, setupMswServer } from '../helpers/msw';
import { renderWithClient } from '../helpers/render';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
// No 300 ms debounce in tests; the debounce itself is covered by the "stale price" rule.
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigModule>()),
  ESTIMATE_DEBOUNCE_MS: 0,
}));

setupMswServer();

beforeEach(() => {
  router.push.mockClear();
});

const requestButton = () => screen.getByRole('button', { name: /^Request/ });

describe('BookingForm validation (blueprint test 17)', () => {
  it('keeps Request disabled until both locations are chosen and a fare is known', async () => {
    server.use(...bookingApi().handlers);
    const { user } = renderWithClient(<BookingForm />);

    expect(requestButton()).toBeDisabled();
    expect(
      screen.getByText('Choose a pickup and a destination to request a ride.'),
    ).toBeInTheDocument();

    await chooseLandmark(user, 'Pickup', 'Liberty', /^Liberty Market/);
    expect(requestButton()).toBeDisabled();

    await chooseLandmark(user, 'Destination', 'Fort', /^Lahore Fort/);
    expect(await screen.findByRole('button', { name: 'Request Economy · Rs 767' })).toBeEnabled();
  });

  it('rejects the same pickup and destination, and asks for no fare', async () => {
    const api = bookingApi();
    server.use(...api.handlers);
    const { user } = renderWithClient(<BookingForm />);

    await chooseLandmark(user, 'Pickup', 'Liberty', /^Liberty Market/);
    await chooseLandmark(user, 'Destination', 'Liberty', /^Liberty Market/);

    const destination = screen.getByRole('combobox', { name: 'Destination' });
    expect(destination).toHaveAttribute('aria-invalid', 'true');
    expect(destination).toHaveAccessibleDescription(SAME_LOCATION_MESSAGE);
    expect(requestButton()).toBeDisabled();
    await sleep(50);
    expect(api.calls.estimates).toBe(0);
  });

  it('explains a missing location once the rider leaves the field empty', async () => {
    server.use(...bookingApi().handlers);
    const { user } = renderWithClient(<BookingForm />);

    await user.click(screen.getByRole('combobox', { name: 'Pickup' }));
    await user.tab();

    expect(await screen.findByText('Choose a pickup location from the list')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Pickup' })).toHaveAccessibleDescription(
      'Choose a pickup location from the list',
    );
  });

  it('accepts only listed landmarks: unmatched text is discarded on blur', async () => {
    server.use(...bookingApi().handlers);
    const { user } = renderWithClient(<BookingForm />);
    const pickup = screen.getByRole('combobox', { name: 'Pickup' });

    await user.type(pickup, 'Karachi');
    expect(screen.getByText('No matching places. Try another name.')).toBeInTheDocument();
    await user.tab();

    expect(pickup).toHaveValue('');
    expect(await screen.findByText('Choose a pickup location from the list')).toBeInTheDocument();
  });

  it('supports the keyboard: arrows move, Enter chooses, Escape closes', async () => {
    server.use(...bookingApi().handlers);
    const { user } = renderWithClient(<BookingForm />);
    const pickup = screen.getByRole('combobox', { name: 'Pickup' });

    await user.click(pickup);
    expect(pickup).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}');
    // The second landmark in the list is now the active option.
    expect(pickup).toHaveAttribute('aria-activedescendant', expect.stringContaining('lahore-fort'));
    await user.keyboard('{Enter}');
    expect(pickup).toHaveValue('Lahore Fort');
    expect(pickup).toHaveAttribute('aria-expanded', 'false');

    const destination = screen.getByRole('combobox', { name: 'Destination' });
    await user.type(destination, 'Mall');
    await user.keyboard('{Escape}');
    expect(destination).toHaveAttribute('aria-expanded', 'false');
    expect(destination).toHaveValue('');
  });

  it('swaps pickup and destination', async () => {
    server.use(...bookingApi().handlers);
    const { user } = renderWithClient(<BookingForm />);
    await chooseDefaultTrip(user);

    await user.click(screen.getByRole('button', { name: 'Swap pickup and destination' }));

    expect(screen.getByRole('combobox', { name: 'Pickup' })).toHaveValue('Lahore Fort');
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('Liberty Market');
  });

  it('offers "View ride" and blocks a second booking while a ride is active', async () => {
    server.use(...bookingApi({ activeRide: makeRide() }).handlers);
    const { user } = renderWithClient(
      <>
        <ActiveRideNotice />
        <BookingForm />
      </>,
    );

    expect(await screen.findByText(/You have a ride in progress/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View ride' })).toHaveAttribute(
      'href',
      `/ride/${RIDE_ID}`,
    );

    await chooseDefaultTrip(user);
    await waitFor(() =>
      expect(screen.getByText('You already have a ride in progress.')).toBeInTheDocument(),
    );
    expect(requestButton()).toBeDisabled();
  });
});
