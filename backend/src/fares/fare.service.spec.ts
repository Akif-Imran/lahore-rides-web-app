import { RIDE_CATEGORIES } from '../common/domain/ride-category.js';
import { roadDistanceMeters, type LatLng } from '../common/utils/geo.js';
import { FARE_CONFIG, type FareConfig } from './fare.config.js';
import { FareService, quoteFare, quoteFareForDistance } from './fare.service.js';

const LIBERTY_MARKET: LatLng = { lat: 31.5106, lng: 74.344 };
const LAHORE_FORT: LatLng = { lat: 31.5889, lng: 74.3149 };

describe('quoteFareForDistance (blueprint test 2)', () => {
  // 10 km at 24 km/h = 1500 s = 25 min
  it('prices a 10 km Economy trip', () => {
    expect(quoteFareForDistance(10_000, 'ECONOMY')).toEqual({
      currency: 'PKR',
      category: 'ECONOMY',
      distanceM: 10_000,
      durationS: 1_500,
      breakdown: { base: 150, distance: 400, time: 125, surge: 1, minimumFareApplied: false },
      total: 675,
    });
  });

  it('prices the same trip higher in Comfort', () => {
    expect(quoteFareForDistance(10_000, 'COMFORT')).toMatchObject({
      breakdown: { base: 250, distance: 650, time: 200, minimumFareApplied: false },
      total: 1_100,
    });
  });

  it('applies the minimum fare to short trips', () => {
    // 1 km: 150 s = 2.5 min. Economy 150 + 40 + 13 = 203 < 250. Comfort 250 + 65 + 20 = 335 < 400.
    expect(quoteFareForDistance(1_000, 'ECONOMY')).toMatchObject({
      breakdown: { base: 150, distance: 40, time: 13, minimumFareApplied: true },
      total: 250,
    });
    expect(quoteFareForDistance(1_000, 'COMFORT')).toMatchObject({
      breakdown: { minimumFareApplied: true },
      total: 400,
    });
  });

  it('rounds each component to whole rupees so the breakdown adds up to the total', () => {
    // 12,345 m -> 1,852 s; distance 12.345 × 40 = 493.8 -> 494; time 30.87 min × 5 = 154.3 -> 154
    const quote = quoteFareForDistance(12_345, 'ECONOMY');
    expect(quote.durationS).toBe(1_852);
    expect(quote.breakdown).toMatchObject({ base: 150, distance: 494, time: 154 });
    expect(quote.total).toBe(798);
  });

  it('always returns integer rupees whose items sum to the total (without minimum/surge)', () => {
    for (const category of RIDE_CATEGORIES) {
      for (let meters = 300; meters <= 40_000; meters += 737) {
        const { breakdown, total, durationS } = quoteFareForDistance(meters, category);
        for (const value of [
          breakdown.base,
          breakdown.distance,
          breakdown.time,
          total,
          durationS,
        ]) {
          expect(Number.isInteger(value)).toBe(true);
        }
        if (!breakdown.minimumFareApplied) {
          expect(breakdown.base + breakdown.distance + breakdown.time).toBe(total);
        }
      }
    }
  });

  it('never prices Comfort below Economy', () => {
    for (let meters = 300; meters <= 40_000; meters += 1_013) {
      expect(quoteFareForDistance(meters, 'COMFORT').total).toBeGreaterThanOrEqual(
        quoteFareForDistance(meters, 'ECONOMY').total,
      );
    }
  });

  it('applies surge after the minimum fare', () => {
    const surged: FareConfig = { ...FARE_CONFIG, surgeMultiplier: 1.5 };
    expect(quoteFareForDistance(10_000, 'ECONOMY', surged).total).toBe(1_013); // 675 × 1.5
    expect(quoteFareForDistance(1_000, 'ECONOMY', surged).total).toBe(375); // 250 × 1.5
    expect(quoteFareForDistance(10_000, 'ECONOMY', surged).breakdown.surge).toBe(1.5);
  });

  it('is deterministic', () => {
    expect(quoteFareForDistance(8_765, 'COMFORT')).toEqual(quoteFareForDistance(8_765, 'COMFORT'));
  });

  it.each([0, -5, 10.5, Number.NaN])('rejects invalid distance %s', (meters) => {
    expect(() => quoteFareForDistance(meters, 'ECONOMY')).toThrow(RangeError);
  });
});

describe('quoteFare', () => {
  it('prices the estimated road distance between the two points', () => {
    const quote = quoteFare(LIBERTY_MARKET, LAHORE_FORT, 'ECONOMY');
    expect(quote.distanceM).toBe(roadDistanceMeters(LIBERTY_MARKET, LAHORE_FORT));
    // ~9.13 km straight line -> ~11.9 km road -> ~Rs 770 in Economy
    expect(quote.total).toBeGreaterThan(700);
    expect(quote.total).toBeLessThan(850);
  });
});

describe('FareService.quoteAll', () => {
  it('quotes every category for the same trip', () => {
    const quotes = new FareService().quoteAll(LIBERTY_MARKET, LAHORE_FORT);
    expect(Object.keys(quotes).sort()).toEqual([...RIDE_CATEGORIES].sort());
    expect(quotes.ECONOMY.distanceM).toBe(quotes.COMFORT.distanceM);
    expect(quotes.ECONOMY.durationS).toBe(quotes.COMFORT.durationS);
    expect(quotes.COMFORT.total).toBeGreaterThan(quotes.ECONOMY.total);
  });
});
