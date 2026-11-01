import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ConfigModule from '@/lib/config';
import { BookingForm } from '@/components/booking-form';
import { bookingApi, chooseDefaultTrip, chooseLandmark } from '../helpers/booking';
import { makeRide, OTHER_RIDE_ID, RIDE_ID } from '../helpers/fixtures';
import { apiUrl, deferred, errorResponse, server, setupMswServer } from '../helpers/msw';
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

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface SentRequest {
  key: string | null;
  riderId: string | null;
  body: unknown;
}

/**
 * Records every POST /rides and answers with `respond(attempt)`; attempt is 1-based.
 */
function ridesEndpoint(respond: (attempt: number) => Response | Promise<Response>) {
  const sent: SentRequest[] = [];
  const handler = http.post(apiUrl('/rides'), async ({ request }) => {
    sent.push({
      key: request.headers.get('Idempotency-Key'),
      riderId: request.headers.get('X-Rider-Id'),
      body: await request.json(),
    });
    return respond(sent.length);
  });
  return { sent, handler };
}

const created = () => HttpResponse.json(makeRide(), { status: 201 });

async function readyToRequest() {
  server.use(...bookingApi().handlers);
  const view = renderWithClient(<BookingForm />);
  await chooseDefaultTrip(view.user);
  const button = await screen.findByRole('button', { name: 'Request Economy · Rs 767' });
  return { ...view, button };
}

beforeEach(() => {
  router.push.mockClear();
});

describe('Request ride flow (blueprint test 19)', () => {
  it('shows a spinner, locks the form and sends one request on a double-click', async () => {
    const gate = deferred();
    const rides = ridesEndpoint(async () => {
      await gate.promise;
      return created();
    });
    server.use(rides.handler);
    const { user, button } = await readyToRequest();

    await user.dblClick(button);

    const busy = await screen.findByRole('button', { name: /Requesting ride/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('combobox', { name: 'Pickup' })).toBeDisabled();

    gate.resolve();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/ride/${RIDE_ID}`));
    expect(rides.sent).toHaveLength(1);
    expect(rides.sent[0]).toMatchObject({
      key: expect.stringMatching(UUID_V4),
      riderId: '11111111-1111-4111-8111-000000000001',
      body: {
        pickup: { name: 'Liberty Market', lat: 31.5106, lng: 74.344 },
        destination: { name: 'Lahore Fort', lat: 31.588, lng: 74.315 },
        category: 'ECONOMY',
      },
    });
  });

  it('ignores a second submit that lands before the button re-renders', async () => {
    const gate = deferred();
    const rides = ridesEndpoint(async () => {
      await gate.promise;
      return created();
    });
    server.use(rides.handler);
    const { button } = await readyToRequest();
    const form = button.closest('form')!;

    // Two submit events back to back, faster than any re-render could disable the button.
    fireEvent.submit(form);
    fireEvent.submit(form);

    await screen.findByRole('button', { name: /Requesting ride/ });
    gate.resolve();
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(rides.sent).toHaveLength(1);
  });

  it('on a network error offers Retry, and the retry reuses the same Idempotency-Key', async () => {
    const rides = ridesEndpoint((attempt) => (attempt === 1 ? HttpResponse.error() : created()));
    server.use(rides.handler);
    const { user, button } = await readyToRequest();

    await user.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your ride was not requested');
    expect(alert).toHaveTextContent("Couldn't reach the server");
    expect(alert).toHaveTextContent('Retrying is safe: you will not be booked twice.');
    expect(router.push).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/ride/${RIDE_ID}`));
    expect(rides.sent).toHaveLength(2);
    expect(rides.sent[0]!.key).toMatch(UUID_V4);
    expect(rides.sent[1]!.key).toBe(rides.sent[0]!.key);
    expect(rides.sent[1]!.body).toEqual(rides.sent[0]!.body);
  });

  it('also reuses the key when the rider presses Request again after a failure', async () => {
    const rides = ridesEndpoint((attempt) => (attempt === 1 ? HttpResponse.error() : created()));
    server.use(rides.handler);
    const { user, button } = await readyToRequest();

    await user.click(button);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Request Economy · Rs 767' }));

    await waitFor(() => expect(rides.sent).toHaveLength(2));
    expect(rides.sent[1]!.key).toBe(rides.sent[0]!.key);
  });

  it('uses a new key once the trip changes, and hides the old error', async () => {
    const rides = ridesEndpoint((attempt) => (attempt === 1 ? HttpResponse.error() : created()));
    server.use(rides.handler);
    const { user, button } = await readyToRequest();

    await user.click(button);
    await screen.findByRole('alert');

    await chooseLandmark(user, 'Destination', 'Badshahi', /^Badshahi Mosque/);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await user.click(await screen.findByRole('button', { name: 'Request Economy · Rs 767' }));

    await waitFor(() => expect(rides.sent).toHaveLength(2));
    expect(rides.sent[1]!.key).toMatch(UUID_V4);
    expect(rides.sent[1]!.key).not.toBe(rides.sent[0]!.key);
  });

  it('treats a 5xx like a network error: request id shown, same key on retry', async () => {
    const rides = ridesEndpoint((attempt) =>
      attempt === 1 ? errorResponse(500, 'INTERNAL_ERROR', 'boom') : created(),
    );
    server.use(rides.handler);
    const { user, button } = await readyToRequest();

    await user.click(button);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reference: req-test-0001');
    expect(alert).not.toHaveTextContent('boom');

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rides.sent).toHaveLength(2));
    expect(rides.sent[1]!.key).toBe(rides.sent[0]!.key);
  });

  it('opens the existing ride on 409 ACTIVE_RIDE_EXISTS', async () => {
    const rides = ridesEndpoint(() =>
      errorResponse(409, 'ACTIVE_RIDE_EXISTS', 'already riding', {
        details: { activeRideId: OTHER_RIDE_ID },
      }),
    );
    server.use(rides.handler);
    const { user, button } = await readyToRequest();

    await user.click(button);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/ride/${OTHER_RIDE_ID}`));
  });

  it('shows server validation errors under the matching field, without Retry', async () => {
    const message = 'Pickup and destination must be at least 200 m apart';
    const rides = ridesEndpoint(() =>
      errorResponse(400, 'VALIDATION_ERROR', 'invalid', {
        details: { fields: [{ field: 'destination', code: 'TRIP_TOO_SHORT', message }] },
      }),
    );
    server.use(rides.handler);
    const { user, button } = await readyToRequest();

    await user.click(button);

    const destination = screen.getByRole('combobox', { name: 'Destination' });
    await waitFor(() => expect(destination).toHaveAccessibleDescription(message));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Please check the highlighted fields.');
    expect(within(alert).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('turns 429 into a countdown from Retry-After and disables Request', async () => {
    const rides = ridesEndpoint(() =>
      errorResponse(429, 'RATE_LIMITED', 'slow down', { headers: { 'Retry-After': '30' } }),
    );
    server.use(rides.handler);
    const { user, button } = await readyToRequest();

    await user.click(button);

    expect(
      await screen.findByText(/^Too many attempts\. Try again in (30|29) s\.$/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Request Economy/ })).toBeDisabled();
    // Shown as the countdown only, not as an error banner as well.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
