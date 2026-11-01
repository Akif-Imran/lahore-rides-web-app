import { expect, test } from '@playwright/test';
import {
  chooseTrip,
  DRIVERS,
  getActiveRide,
  getRide,
  openAsRider,
  openDriverConsole,
  releaseRider,
  requestRide,
  RIDERS,
} from './support';

test.afterEach(async ({ request }) => {
  await releaseRider(request, RIDERS.bilal);
});

test('blueprint 22: a rider cancels and the ride leaves the driver console', async ({
  browser,
  request,
}) => {
  const rider = await openAsRider(browser, RIDERS.bilal);
  await chooseTrip(rider, 'Gaddafi Stadium', 'Model Town');
  const rideId = await requestRide(rider);
  await expect(rider.getByTestId('ride-status')).toHaveText('Looking for a driver');

  // A nearby available driver sees the request.
  const driver = await openDriverConsole(browser, DRIVERS.usman);
  const offer = driver.getByTestId('offer').filter({ hasText: 'Gaddafi Stadium' });
  await expect(offer).toBeVisible();

  // The rider cancels, after confirming.
  await rider.getByRole('button', { name: 'Cancel ride' }).click();
  const dialog = rider.getByRole('dialog', { name: 'Cancel this ride?' });
  await expect(dialog.getByRole('button', { name: 'Keep ride' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel ride' }).click();

  await expect(rider.getByTestId('ride-status')).toHaveText('Ride cancelled');
  await expect(rider.getByText(/^Cancelled by you/)).toBeVisible();

  // The driver console drops the ride on its next poll.
  await expect(offer).toHaveCount(0);

  // The backend agrees, and the rider is free to book again.
  const ride = await getRide(request, RIDERS.bilal, rideId);
  expect(ride.status).toBe('CANCELLED');
  expect(ride.cancelledBy).toBe('RIDER');
  expect(await getActiveRide(request, RIDERS.bilal)).toBeNull();

  await rider.getByRole('link', { name: 'Book another ride' }).click();
  await expect(rider.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  await expect(rider.getByText(/You have a ride in progress/)).toHaveCount(0);
});
