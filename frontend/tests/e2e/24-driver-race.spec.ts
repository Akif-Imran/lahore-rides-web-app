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

test('two drivers press Accept at the same moment: exactly one gets the ride', async ({
  browser,
  request,
}) => {
  const rider = await openAsRider(browser, RIDERS.ayesha);
  await chooseTrip(rider, 'Liberty Market', 'Badshahi Mosque');
  const rideId = await requestRide(rider);

  // Usman (Economy) and Zainab (Comfort, which may take Economy rides) are both within 5 km.
  const contenders = [
    { driver: DRIVERS.usman, page: await openDriverConsole(browser, DRIVERS.usman) },
    { driver: DRIVERS.zainab, page: await openDriverConsole(browser, DRIVERS.zainab) },
  ];
  const acceptButtons = contenders.map(({ page }) =>
    page
      .getByTestId('offer')
      .filter({ hasText: 'Badshahi Mosque' })
      .getByRole('button', { name: /^Accept ride/ }),
  );
  for (const button of acceptButtons) await expect(button).toBeEnabled();

  await Promise.all(acceptButtons.map((button) => button.click()));

  // Each console shows its own outcome: one success, one friendly "lost the race".
  const outcomes = await Promise.all(
    contenders.map(async ({ page }) => {
      const outcome = page.getByText(/^(Ride accepted\.|Another driver took this ride\.)/);
      await expect(outcome).toBeVisible();
      return (await outcome.textContent())!.startsWith('Ride accepted') ? 'won' : 'lost';
    }),
  );
  expect([...outcomes].sort()).toEqual(['lost', 'won']);

  // The winner is the ride's driver, and the rider sees them.
  const winner = contenders[outcomes.indexOf('won')]!.driver;
  const ride = await getRide(request, RIDERS.ayesha, rideId);
  expect(ride.status).toBe('ASSIGNED');
  expect(ride.driver?.id).toBe(winner.id);
  await expect(rider.getByTestId('ride-status')).toHaveText('Driver on the way');
  await expect(rider.getByTestId('driver-card')).toContainText(winner.name);
});
