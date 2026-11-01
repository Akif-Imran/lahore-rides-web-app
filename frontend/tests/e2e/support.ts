import { type APIRequestContext, type Browser, expect, type Page } from '@playwright/test';
import {
  DEMO_DRIVERS,
  DEMO_RIDERS,
  type DemoDriver,
  type DemoRider,
} from '../../src/lib/demo-actors';
import type { Ride } from '../../src/types/api';

export const API_URL = (process.env.E2E_API_URL ?? 'http://localhost:3001/api/v1').replace(
  /\/+$/,
  '',
);

export const RIDERS = {
  ayesha: DEMO_RIDERS[0]!,
  bilal: DEMO_RIDERS[1]!,
  sana: DEMO_RIDERS[2]!,
};

export const DRIVERS = {
  usman: DEMO_DRIVERS[0]!, // Economy, Gulberg, seeded AVAILABLE
  hamza: DEMO_DRIVERS[1]!, // Economy, Model Town, seeded OFFLINE
  zainab: DEMO_DRIVERS[5]!, // Comfort, Mall Road, seeded AVAILABLE
};

/** A fresh browser context (its own storage) acting as `rider` on the booking page. */
export async function openAsRider(browser: Browser, rider: DemoRider): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  // Enabled only once the stored identity is known after hydration.
  await page.getByLabel('Riding as').selectOption(rider.id);
  return page;
}

/** A fresh browser context acting as `driver` in the driver console. */
export async function openDriverConsole(browser: Browser, driver: DemoDriver): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/driver');
  await page.getByLabel('Acting as driver').selectOption(driver.id);
  await expect(page.getByTestId('driver-availability')).toBeVisible();
  return page;
}

async function chooseLandmark(page: Page, label: 'Pickup' | 'Destination', name: string) {
  const input = page.getByRole('combobox', { name: label });
  await input.click();
  await input.fill(name);
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
  await expect(input).toHaveValue(name);
}

/** Fills the booking form and waits for the fare and pickup ETA; returns the shown fare. */
export async function chooseTrip(page: Page, pickup: string, destination: string) {
  await chooseLandmark(page, 'Pickup', pickup);
  await chooseLandmark(page, 'Destination', destination);
  await expect(page.getByRole('radio', { name: /^Economy/ })).toBeChecked();
  const fare = page.getByTestId('fare-amount');
  await expect(fare).toHaveText(/^Rs \d[\d,]*$/);
  await expect(page.getByTestId('pickup-eta')).toHaveText(/^Pickup in about \d+ min$/);
  return (await fare.textContent())!.trim();
}

/** Requests the chosen trip and waits for the ride page; returns the new ride id. */
export async function requestRide(page: Page): Promise<string> {
  await page.getByRole('button', { name: /^Request Economy · Rs / }).click();
  await expect(page).toHaveURL(/\/ride\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop()!;
}

const asRider = (rider: DemoRider) => ({ 'X-Rider-Id': rider.id });

export async function getRide(request: APIRequestContext, rider: DemoRider, rideId: string) {
  const res = await request.get(`${API_URL}/rides/${rideId}`, { headers: asRider(rider) });
  expect(res.status()).toBe(200);
  return (await res.json()) as Ride;
}

export async function getActiveRide(request: APIRequestContext, rider: DemoRider) {
  const res = await request.get(`${API_URL}/riders/me/active-ride`, { headers: asRider(rider) });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { ride: Ride | null }).ride;
}

/**
 * Cleanup: cancels the rider's active ride if it can still be cancelled, so the rider can book
 * again in the next test (one active ride per rider).
 */
export async function releaseRider(request: APIRequestContext, rider: DemoRider): Promise<void> {
  const ride = await getActiveRide(request, rider);
  if (ride && (ride.status === 'REQUESTED' || ride.status === 'ASSIGNED')) {
    await request.post(`${API_URL}/rides/${ride.id}/cancel`, {
      headers: asRider(rider),
      data: { reason: 'e2e cleanup' },
    });
  }
}
