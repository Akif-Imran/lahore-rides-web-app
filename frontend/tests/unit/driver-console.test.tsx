import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { DriverConsole } from '@/components/driver-console';
import { DEMO_DRIVERS } from '@/lib/demo-actors';
import type { Driver, RideStatus } from '@/types/api';
import { makeDriver, makeOffer, rideInStatus } from '../helpers/fixtures';
import { apiUrl, errorResponse, server, setupMswServer } from '../helpers/msw';
import { renderWithClient } from '../helpers/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/driver',
}));

setupMswServer();

const usman = DEMO_DRIVERS[0]!;

describe('Driver console (blueprint 5.4.3)', () => {
  it('is clearly marked as a simulation', async () => {
    server.use(
      http.get(apiUrl('/drivers/:id'), () => HttpResponse.json(makeDriver())),
      http.get(apiUrl('/drivers/:id/offers'), () => HttpResponse.json({ offers: [] })),
    );
    renderWithClient(<DriverConsole />);
    expect(screen.getByRole('note')).toHaveTextContent('Simulation.');
    expect(await screen.findByText('No ride requests nearby')).toBeInTheDocument();
  });

  it('tells the driver when another driver won the race, then refreshes the offers', async () => {
    const acceptedBy: (string | null)[] = [];
    let offerFetches = 0;
    server.use(
      http.get(apiUrl('/drivers/:id'), () => HttpResponse.json(makeDriver())),
      http.get(apiUrl('/drivers/:id/offers'), () => {
        offerFetches += 1;
        return HttpResponse.json({ offers: offerFetches === 1 ? [makeOffer()] : [] });
      }),
      http.post(apiUrl('/rides/:id/accept'), ({ request }) => {
        acceptedBy.push(request.headers.get('X-Driver-Id'));
        return errorResponse(409, 'RIDE_ALREADY_ASSIGNED', 'taken');
      }),
    );
    const { user } = renderWithClient(<DriverConsole />);

    const offer = await screen.findByTestId('offer');
    expect(offer).toHaveTextContent('Liberty Market');
    expect(offer).toHaveTextContent('Rs 767');
    await user.click(within(offer).getByRole('button', { name: /^Accept ride/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Another driver took this ride.');
    expect(acceptedBy).toEqual([usman.id]);
    expect(await screen.findByText('No ride requests nearby')).toBeInTheDocument();
  });

  it('goes online at the driver’s home area when no position was reported yet', async () => {
    let driver: Driver = makeDriver({
      availability: 'OFFLINE',
      location: null,
      locationUpdatedAt: null,
    });
    let patchBody: unknown = null;
    server.use(
      http.get(apiUrl('/drivers/:id'), () => HttpResponse.json(driver)),
      http.get(apiUrl('/drivers/:id/offers'), () => HttpResponse.json({ offers: [] })),
      http.patch(apiUrl('/drivers/:id/availability'), async ({ request }) => {
        patchBody = await request.json();
        driver = makeDriver({ availability: 'AVAILABLE' });
        return HttpResponse.json(driver);
      }),
    );
    const { user } = renderWithClient(<DriverConsole />);

    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Position' })).toHaveValue('home');
    await user.click(screen.getByRole('button', { name: 'Go online' }));

    expect(await screen.findByText(/You're online/)).toBeInTheDocument();
    expect(patchBody).toEqual({ status: 'AVAILABLE', ...usman.home });
    expect(screen.getByTestId('driver-availability')).toHaveTextContent('Online');
  });

  it('drives an assigned trip through Start and Complete', async () => {
    let stage: RideStatus | 'DONE' = 'ASSIGNED';
    const profile = (): Driver =>
      stage === 'DONE'
        ? makeDriver()
        : makeDriver({ availability: 'BUSY', activeRide: rideInStatus(stage) });
    server.use(
      http.get(apiUrl('/drivers/:id'), () => HttpResponse.json(profile())),
      http.get(apiUrl('/drivers/:id/offers'), () => HttpResponse.json({ offers: [] })),
      http.post(apiUrl('/rides/:id/start'), () => {
        stage = 'IN_PROGRESS';
        return HttpResponse.json(rideInStatus('IN_PROGRESS'));
      }),
      http.post(apiUrl('/rides/:id/complete'), () => {
        stage = 'DONE';
        return HttpResponse.json(rideInStatus('COMPLETED'));
      }),
    );
    const { user } = renderWithClient(<DriverConsole />);

    const trip = await screen.findByTestId('driver-active-trip');
    expect(trip).toHaveTextContent('Heading to pickup');
    expect(screen.getByTestId('driver-availability')).toHaveTextContent('On a trip');
    await user.click(within(trip).getByRole('button', { name: 'Start trip' }));

    expect(await screen.findByText('Trip started.')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Complete trip' }));

    expect(await screen.findByText('Trip completed. Fare: Rs 767.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('driver-availability')).toHaveTextContent('Online'),
    );
    expect(screen.queryByTestId('driver-active-trip')).not.toBeInTheDocument();
  });
});
