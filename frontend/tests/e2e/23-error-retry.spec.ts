import { expect, type Page, test } from '@playwright/test';
import type { Ride } from '../../src/types/api';
import { API_URL, chooseTrip, getActiveRide, openAsRider, releaseRider, RIDERS } from './support';

const RIDES_URL = `${API_URL}/rides`;
const isCreateRide = (method: string, url: string) => method === 'POST' && url === RIDES_URL;

test.afterEach(async ({ request }) => {
  await releaseRider(request, RIDERS.sana);
});

async function pressRequest(page: Page) {
  await page.getByRole('button', { name: /^Request Economy · Rs / }).click();
  // Scoped by text: Next's production build also renders an (empty) role="alert" route announcer.
  const alert = page.getByRole('alert').filter({ hasText: 'Your ride was not requested' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Retrying is safe: you will not be booked twice.');
  return alert;
}

test('blueprint 23: a 500 before the request is handled shows an error; Retry books exactly one ride', async ({
  browser,
  request,
}) => {
  const rider = await openAsRider(browser, RIDERS.sana);
  await chooseTrip(rider, 'Lahore Railway Station', 'Johar Town');

  // The first attempt fails with a server error and never reaches the API.
  const keys: string[] = [];
  let failNext = true;
  await rider.route(RIDES_URL, async (route) => {
    const req = route.request();
    if (!isCreateRide(req.method(), req.url())) return route.fallback();
    keys.push(req.headers()['idempotency-key'] ?? '');
    if (!failNext) return route.fallback();
    failNext = false;
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: {
        // Cross-origin response: without these the browser would hide it as a network error.
        'Access-Control-Allow-Origin': new URL(rider.url()).origin,
        'Access-Control-Expose-Headers': 'X-Request-Id',
      },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected error', requestId: 'e2e-forced-500' },
      }),
    });
  });

  const alert = await pressRequest(rider);
  await expect(alert).toContainText('Reference: e2e-forced-500');

  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(rider).toHaveURL(/\/ride\/[0-9a-f-]{36}$/);
  await expect(rider.getByTestId('ride-status')).toHaveText('Looking for a driver');

  // Same Idempotency-Key on both attempts; exactly one ride, the one on screen.
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const active = await getActiveRide(request, RIDERS.sana);
  expect(active?.id).toBe(rider.url().split('/').pop());
});

test('23b: the ride is created but the response is lost; Retry replays it instead of booking twice', async ({
  browser,
  request,
}) => {
  const rider = await openAsRider(browser, RIDERS.sana);
  await chooseTrip(rider, 'Lahore Railway Station', 'Johar Town');

  // The first attempt reaches the API, which commits the ride, but the browser never gets
  // the answer: the worst case for a retry.
  let lost: { key: string; status: number; ride: Ride } | null = null;
  await rider.route(RIDES_URL, async (route) => {
    const req = route.request();
    if (!isCreateRide(req.method(), req.url()) || lost) return route.fallback();
    const response = await route.fetch();
    lost = {
      key: req.headers()['idempotency-key'] ?? '',
      status: response.status(),
      ride: (await response.json()) as Ride,
    };
    return route.abort('connectionreset');
  });

  const alert = await pressRequest(rider);
  expect(lost).not.toBeNull();
  const { key, status, ride } = lost!;
  expect(status).toBe(201);

  // Retry: the API recognises the key and replays the original response.
  const retried = rider.waitForResponse((res) => isCreateRide(res.request().method(), res.url()));
  await alert.getByRole('button', { name: 'Retry' }).click();
  const replay = await retried;
  expect(replay.request().headers()['idempotency-key']).toBe(key);
  expect(replay.status()).toBe(200);
  expect(replay.headers()['idempotent-replayed']).toBe('true');
  expect(((await replay.json()) as Ride).id).toBe(ride.id);

  // The rider lands on the one ride that exists.
  await expect(rider).toHaveURL(new RegExp(`/ride/${ride.id}$`));
  await expect(rider.getByTestId('ride-status')).toHaveText('Looking for a driver');
  expect((await getActiveRide(request, RIDERS.sana))?.id).toBe(ride.id);
});
