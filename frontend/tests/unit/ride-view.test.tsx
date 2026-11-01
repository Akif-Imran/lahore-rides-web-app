import { focusManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ConfigModule from '@/lib/config';
import { RideView } from '@/components/ride-view';
import { resetRideEtagCache } from '@/lib/api';
import type { Ride, RideStatus } from '@/types/api';
import { sleep } from '../helpers/booking';
import { RIDE_ID, rideInStatus } from '../helpers/fixtures';
import { apiUrl, errorResponse, server, setupMswServer } from '../helpers/msw';
import { renderWithClient } from '../helpers/render';

const POLL_MS = 50;
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigModule>()),
  POLL_INTERVAL_MS: 50,
}));

setupMswServer();

afterEach(() => {
  resetRideEtagCache();
  focusManager.setFocused(undefined);
});

const RIDE_URL = apiUrl('/rides/:id');

/** Serves `rides` in order, one per GET, then keeps repeating the last one. */
function serveRides(...rides: Ride[]) {
  const calls = { count: 0 };
  server.use(
    http.get(RIDE_URL, () => {
      const ride = rides[Math.min(calls.count, rides.length - 1)]!;
      calls.count += 1;
      return HttpResponse.json(ride);
    }),
  );
  return calls;
}

const headline = () => screen.getByTestId('ride-status');
const cancelButton = () => screen.queryByRole('button', { name: 'Cancel ride' });

describe('Ride status view (blueprint test 20)', () => {
  it.each<[RideStatus, string, boolean]>([
    ['REQUESTED', 'Looking for a driver', true],
    ['ASSIGNED', 'Driver on the way', true],
    ['IN_PROGRESS', 'On trip', false],
    ['COMPLETED', 'Trip completed', false],
    ['CANCELLED', 'Ride cancelled', false],
    ['EXPIRED', 'No driver found', false],
  ])('renders %s as "%s" (cancel offered: %s)', async (status, title, cancellable) => {
    serveRides(rideInStatus(status));
    renderWithClient(<RideView rideId={RIDE_ID} />);

    expect(await screen.findByTestId('ride-status')).toHaveTextContent(title);
    if (cancellable) expect(cancelButton()).toBeInTheDocument();
    else expect(cancelButton()).not.toBeInTheDocument();
  });

  it('shows the status details each state needs', async () => {
    serveRides(rideInStatus('ASSIGNED'));
    const { unmount } = renderWithClient(<RideView rideId={RIDE_ID} />);
    const card = await screen.findByTestId('driver-card');
    expect(card).toHaveTextContent('Usman Tariq');
    expect(card).toHaveTextContent('LEA-1001');
    expect(screen.getByTestId('map-driver')).toBeInTheDocument();
    // The stepper marks progress with text, not only colour.
    expect(screen.getByText(/Driver assigned/).closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    unmount();

    serveRides(rideInStatus('COMPLETED'));
    renderWithClient(<RideView rideId={RIDE_ID} />);
    expect(await screen.findByTestId('receipt-total')).toHaveTextContent('Rs 767');
    expect(screen.getByRole('link', { name: 'Book another ride' })).toHaveAttribute('href', '/');
  });

  it('announces status changes in a polite live region', async () => {
    serveRides(rideInStatus('REQUESTED'));
    renderWithClient(<RideView rideId={RIDE_ID} />);
    const region = (await screen.findByTestId('ride-status')).closest('[aria-live]');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('role', 'status');
  });

  it('polls through every status and stops for good on a terminal one', async () => {
    const calls = serveRides(
      rideInStatus('REQUESTED'),
      rideInStatus('ASSIGNED'),
      rideInStatus('IN_PROGRESS'),
      rideInStatus('COMPLETED'),
    );
    renderWithClient(<RideView rideId={RIDE_ID} />);

    for (const title of ['Looking for a driver', 'Driver on the way', 'On trip']) {
      await waitFor(() => expect(headline()).toHaveTextContent(title));
    }
    await waitFor(() => expect(headline()).toHaveTextContent('Trip completed'));

    const afterTerminal = calls.count;
    await sleep(POLL_MS * 6);
    expect(calls.count).toBe(afterTerminal);
  });

  it('pauses polling while the tab is hidden and resumes when it is visible', async () => {
    const calls = serveRides(rideInStatus('REQUESTED'));
    renderWithClient(<RideView rideId={RIDE_ID} />);
    await waitFor(() => expect(calls.count).toBeGreaterThanOrEqual(2));

    focusManager.setFocused(false);
    await sleep(POLL_MS); // let an in-flight poll finish
    const whileHidden = calls.count;
    await sleep(POLL_MS * 6);
    expect(calls.count).toBe(whileHidden);

    focusManager.setFocused(true);
    await waitFor(() => expect(calls.count).toBeGreaterThan(whileHidden));
  });

  it('keeps the last status and shows "Reconnecting…" while the server is unreachable', async () => {
    let offline = false;
    let served = 0;
    server.use(
      http.get(RIDE_URL, () => {
        served += 1;
        return offline ? HttpResponse.error() : HttpResponse.json(rideInStatus('ASSIGNED'));
      }),
    );
    // A long backoff: the automatic retry would only come after 5 s, so recovering within
    // waitFor's 1 s proves the manual "Retry now" works *during* the backoff window.
    const { user } = renderWithClient(<RideView rideId={RIDE_ID} />, { retryDelay: 5_000 });
    await waitFor(() => expect(headline()).toHaveTextContent('Driver on the way'));

    offline = true;
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Reconnecting…');
    expect(banner).toHaveTextContent('Showing the last known status');
    expect(headline()).toHaveTextContent('Driver on the way');
    expect(screen.getByTestId('driver-card')).toBeInTheDocument();

    const retryNow = within(banner).getByRole('button', { name: 'Retry now' });
    expect(retryNow).toBeEnabled();
    offline = false;
    const before = served;
    await user.click(retryNow);
    await waitFor(() => expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument());
    expect(served).toBeGreaterThan(before);
  });

  it('cancels after confirmation and shows the cancelled view', async () => {
    let cancelBody: unknown = null;
    serveRides(rideInStatus('REQUESTED'));
    server.use(
      http.post(apiUrl('/rides/:id/cancel'), async ({ request }) => {
        cancelBody = await request.json();
        return HttpResponse.json(rideInStatus('CANCELLED'));
      }),
    );
    const { user } = renderWithClient(<RideView rideId={RIDE_ID} />);

    await user.click(await screen.findByRole('button', { name: 'Cancel ride' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this ride?' });
    expect(dialog).toHaveTextContent('We will stop looking for a driver.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel ride' }));

    await waitFor(() => expect(headline()).toHaveTextContent('Ride cancelled'));
    expect(screen.getByText(/Cancelled by you/)).toBeInTheDocument();
    expect(cancelBody).toEqual({});
  });

  it('does nothing when the rider keeps the ride', async () => {
    const cancelled = vi.fn();
    serveRides(rideInStatus('ASSIGNED'));
    server.use(http.post(apiUrl('/rides/:id/cancel'), () => cancelled()));
    const { user } = renderWithClient(<RideView rideId={RIDE_ID} />);

    await user.click(await screen.findByRole('button', { name: 'Cancel ride' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this ride?' });
    expect(dialog).toHaveTextContent('Your driver is already on the way.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep ride' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cancelled).not.toHaveBeenCalled();
    expect(headline()).toHaveTextContent('Driver on the way');
  });

  it('handles 409 on cancel: explains, then shows the authoritative status', async () => {
    let started = false;
    server.use(
      http.get(RIDE_URL, () =>
        HttpResponse.json(rideInStatus(started ? 'IN_PROGRESS' : 'ASSIGNED')),
      ),
      http.post(apiUrl('/rides/:id/cancel'), () => {
        started = true; // the driver started the trip a moment earlier
        return errorResponse(409, 'INVALID_STATE_TRANSITION', 'nope', {
          details: { currentStatus: 'IN_PROGRESS', attempted: 'CANCELLED' },
        });
      }),
    );
    const { user } = renderWithClient(<RideView rideId={RIDE_ID} />);

    await user.click(await screen.findByRole('button', { name: 'Cancel ride' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel ride' }),
    );

    expect(await screen.findByText("Trip already started, can't cancel.")).toBeInTheDocument();
    await waitFor(() => expect(headline()).toHaveTextContent('On trip'));
    expect(cancelButton()).not.toBeInTheDocument();
  });

  it('shows "Ride not found" for an unknown or hidden ride, without polling on', async () => {
    let calls = 0;
    server.use(
      http.get(RIDE_URL, () => {
        calls += 1;
        return errorResponse(404, 'NOT_FOUND', 'Ride not found');
      }),
    );
    renderWithClient(<RideView rideId={RIDE_ID} />);

    expect(await screen.findByRole('heading', { name: 'Ride not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book a ride' })).toHaveAttribute('href', '/');
    await sleep(POLL_MS * 4);
    expect(calls).toBe(1);
  });

  it('shows an error with the request id when the first load fails, and recovers on Retry', async () => {
    let failing = true;
    server.use(
      http.get(RIDE_URL, () =>
        failing
          ? errorResponse(503, 'SERVICE_UNAVAILABLE', 'db down')
          : HttpResponse.json(rideInStatus('REQUESTED')),
      ),
    );
    const { user } = renderWithClient(<RideView rideId={RIDE_ID} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your ride");
    expect(alert).toHaveTextContent('Reference: req-test-0001');

    failing = false;
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(headline()).toHaveTextContent('Looking for a driver'));
  });

  it('sends the rider identity on every poll', async () => {
    const riders: (string | null)[] = [];
    server.use(
      http.get(RIDE_URL, ({ request }) => {
        riders.push(request.headers.get('X-Rider-Id'));
        return HttpResponse.json(rideInStatus('REQUESTED'));
      }),
    );
    renderWithClient(<RideView rideId={RIDE_ID} />);
    await waitFor(() => expect(riders.length).toBeGreaterThanOrEqual(2));
    expect(new Set(riders)).toEqual(new Set(['11111111-1111-4111-8111-000000000001']));
  });
});
