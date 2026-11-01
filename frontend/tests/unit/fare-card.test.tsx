import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type * as ConfigModule from '@/lib/config';
import { BookingForm } from '@/components/booking-form';
import { FareCard } from '@/components/fare-card';
import { ApiError } from '@/lib/errors';
import { chooseDefaultTrip } from '../helpers/booking';
import { makeEstimate } from '../helpers/fixtures';
import { apiUrl, errorResponse, server, setupMswServer } from '../helpers/msw';
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
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigModule>()),
  ESTIMATE_DEBOUNCE_MS: 0,
}));

setupMswServer();

describe('FareCard states (blueprint test 18)', () => {
  it('prompts for locations while the trip is incomplete', () => {
    render(<FareCard estimate={{ status: 'idle' }} category="ECONOMY" onRetry={vi.fn()} />);
    expect(screen.getByText(/Choose a pickup and a destination/)).toBeInTheDocument();
  });

  it('shows a loading skeleton, announced to screen readers', () => {
    render(<FareCard estimate={{ status: 'loading' }} category="ECONOMY" onRetry={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Calculating fare…');
    expect(screen.queryByTestId('fare-amount')).not.toBeInTheDocument();
  });

  it('shows the fare, trip and pickup ETA, with the other category for comparison', () => {
    render(
      <FareCard
        estimate={{ status: 'success', data: makeEstimate(7, 14) }}
        category="ECONOMY"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('fare-amount')).toHaveTextContent('Rs 767');
    expect(screen.getByText('About 11.8 km · 29 min trip')).toBeInTheDocument();
    expect(screen.getByTestId('pickup-eta')).toHaveTextContent('Pickup in about 7 min');
    expect(screen.getByText('Comfort for this trip: Rs 1,248')).toBeInTheDocument();
  });

  it('shows the "no drivers" empty state and points to a category that has one', () => {
    render(
      <FareCard
        estimate={{ status: 'success', data: makeEstimate(null, 6) }}
        category="ECONOMY"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('No drivers nearby right now')).toBeInTheDocument();
    expect(screen.getByText('Comfort has a driver about 6 min away.')).toBeInTheDocument();
    expect(screen.queryByTestId('pickup-eta')).not.toBeInTheDocument();
  });

  it('suggests checking back when no category has a driver', () => {
    render(
      <FareCard
        estimate={{ status: 'success', data: makeEstimate(null, null) }}
        category="COMFORT"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('Please check back in a few minutes.')).toBeInTheDocument();
  });

  it('shows an error with a Retry button that asks for the estimate again', async () => {
    const onRetry = vi.fn();
    const error = new ApiError({ code: 'NETWORK_ERROR', message: 'offline', status: 0 });
    render(<FareCard estimate={{ status: 'error', error }} category="ECONOMY" onRetry={onRetry} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't get a fare estimate");
    expect(alert).toHaveTextContent("Couldn't reach the server");
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('notes when the minimum fare applies', () => {
    const data = makeEstimate();
    data.estimates[0]!.breakdown.minimumFareApplied = true;
    render(
      <FareCard estimate={{ status: 'success', data }} category="ECONOMY" onRetry={vi.fn()} />,
    );
    expect(screen.getByText('The minimum fare applies to this trip.')).toBeInTheDocument();
  });
});

describe('fare estimate inside the booking form', () => {
  it('recovers from a failed estimate with Retry, showing the request id meanwhile', async () => {
    let failing = true;
    let attempts = 0;
    server.use(
      http.get(apiUrl('/riders/me/active-ride'), () => HttpResponse.json({ ride: null })),
      http.post(apiUrl('/fare-estimates'), () => {
        attempts += 1;
        return failing
          ? errorResponse(500, 'INTERNAL_ERROR', 'boom')
          : HttpResponse.json(makeEstimate());
      }),
    );
    const { user } = renderWithClient(<BookingForm />);
    await chooseDefaultTrip(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't get a fare estimate");
    expect(alert).toHaveTextContent('Reference: req-test-0001');
    // A 5xx is transient: the query retried 3 times before giving up.
    expect(attempts).toBe(4);
    expect(screen.getByRole('button', { name: /^Request/ })).toBeDisabled();

    failing = false;
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('fare-amount')).toHaveTextContent('Rs 767');
  });

  it('does not retry a definitive 4xx answer', async () => {
    let attempts = 0;
    server.use(
      http.get(apiUrl('/riders/me/active-ride'), () => HttpResponse.json({ ride: null })),
      http.post(apiUrl('/fare-estimates'), () => {
        attempts += 1;
        return errorResponse(401, 'UNAUTHENTICATED', 'who are you');
      }),
    );
    const { user } = renderWithClient(<BookingForm />);
    await chooseDefaultTrip(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a demo user to continue.');
    expect(attempts).toBe(1);
  });
});
