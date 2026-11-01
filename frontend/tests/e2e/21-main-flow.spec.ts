import { expect, test } from '@playwright/test';
import {
  chooseTrip,
  DRIVERS,
  getRide,
  openAsRider,
  openDriverConsole,
  releaseRider,
  requestRide,
  RIDERS,
} from './support';

test.afterEach(async ({ request }) => {
  await releaseRider(request, RIDERS.ayesha);
});

test('blueprint 21: a rider books and a driver takes the ride through to the receipt', async ({
  browser,
  request,
}) => {
  // Rider: Liberty Market → Lahore Fort, Economy, with fare and ETA shown before requesting.
  const rider = await openAsRider(browser, RIDERS.ayesha);
  const fare = await chooseTrip(rider, 'Liberty Market', 'Lahore Fort');
  const rideId = await requestRide(rider);
  const status = rider.getByTestId('ride-status');
  await expect(status).toHaveText('Looking for a driver');
  await expect(rider.getByRole('button', { name: 'Cancel ride' })).toBeVisible();

  // Driver (second browser context): Hamza is seeded offline and goes online. If an earlier run
  // without a reset left him online, he goes offline first, so the test works from either state.
  const driver = await openDriverConsole(browser, DRIVERS.hamza);
  const availability = driver.getByTestId('driver-availability');
  await expect(availability).toHaveText(/^(Online|Offline)$/);
  if ((await availability.textContent())?.trim() === 'Online') {
    await driver.getByRole('button', { name: 'Go offline' }).click();
    await expect(availability).toHaveText('Offline');
  }
  await driver.getByRole('button', { name: 'Go online' }).click();
  await expect(availability).toHaveText('Online');

  const offer = driver
    .getByTestId('offer')
    .filter({ hasText: 'Liberty Market' })
    .filter({ hasText: 'Lahore Fort' });
  await expect(offer).toContainText(fare);
  await offer.getByRole('button', { name: /^Accept ride/ }).click();
  await expect(driver.getByText(/^Ride accepted\./)).toBeVisible();

  // Rider sees the assignment with the driver's details.
  await expect(status).toHaveText('Driver on the way');
  const driverCard = rider.getByTestId('driver-card');
  await expect(driverCard).toContainText(DRIVERS.hamza.name);
  await expect(driverCard).toContainText(DRIVERS.hamza.plate);

  // Start: the rider can no longer cancel.
  const trip = driver.getByTestId('driver-active-trip');
  await trip.getByRole('button', { name: 'Start trip' }).click();
  await expect(status).toHaveText('On trip');
  await expect(rider.getByRole('button', { name: 'Cancel ride' })).toHaveCount(0);

  // Complete: receipt with the fare the rider was quoted.
  await driver.getByRole('button', { name: 'Complete trip' }).click();
  await expect(driver.getByText(`Trip completed. Fare: ${fare}.`)).toBeVisible();
  await expect(status).toHaveText('Trip completed');
  await expect(rider.getByTestId('receipt-total')).toHaveText(fare);
  await expect(rider.getByRole('link', { name: 'Book another ride' })).toBeVisible();

  // The backend agrees: completed by Hamza, final fare equals the quote.
  const ride = await getRide(request, RIDERS.ayesha, rideId);
  expect(ride.status).toBe('COMPLETED');
  expect(ride.driver?.id).toBe(DRIVERS.hamza.id);
  expect(ride.fare.finalTotal).toBe(ride.fare.estimatedTotal);
  expect(`Rs ${ride.fare.finalTotal!.toLocaleString('en-PK')}`).toBe(fare);

  // And the driver is free for the next request.
  await expect(driver.getByTestId('driver-availability')).toHaveText('Online');
});
