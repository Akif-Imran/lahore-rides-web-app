import type { ArgumentMetadata } from '@nestjs/common';
import { UpdateAvailabilityDto } from '../../drivers/dto/update-availability.dto.js';
import { FareEstimateRequestDto } from '../../fares/dto/fare-estimate.dto.js';
import { CancelRideDto } from '../../rides/dto/cancel-ride.dto.js';
import { CreateRideDto } from '../../rides/dto/create-ride.dto.js';
import type { FieldError } from '../errors/index.js';
import { createValidationPipe, flattenValidationErrors } from './validation.js';

const pipe = createValidationPipe();
const body = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

const validRide = () => ({
  pickup: { name: ' Liberty Market ', lat: 31.5106, lng: 74.344 },
  destination: { name: 'Lahore Fort', lat: 31.588, lng: 74.315 },
  category: 'ECONOMY',
});

async function fieldsOf(value: unknown, metatype: ArgumentMetadata['metatype']): Promise<string[]> {
  try {
    await pipe.transform(value, body(metatype));
  } catch (error) {
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400 });
    const fields = (error as { details: { fields: FieldError[] } }).details.fields;
    return [...new Set(fields.map((f) => f.field))].sort();
  }
  return [];
}

describe('flattenValidationErrors', () => {
  it('produces dotted paths for nested errors and one entry per failed constraint', () => {
    expect(
      flattenValidationErrors([
        {
          property: 'pickup',
          children: [
            {
              property: 'lat',
              constraints: { max: 'lat must not be greater than 90' },
              children: [],
            },
          ],
        },
        {
          property: 'category',
          constraints: { isIn: 'category must be one of', isString: 'category must be a string' },
          children: [],
        },
      ]),
    ).toEqual([
      { field: 'pickup.lat', message: 'lat must not be greater than 90' },
      { field: 'category', message: 'category must be one of' },
      { field: 'category', message: 'category must be a string' },
    ]);
  });
});

describe('CreateRideDto validation (blueprint test 6, DTO layer)', () => {
  it('accepts a valid request and trims names', async () => {
    const dto = await pipe.transform(validRide(), body(CreateRideDto));
    expect(dto).toBeInstanceOf(CreateRideDto);
    expect(dto.pickup.name).toBe('Liberty Market');
  });

  it.each<[string, (ride: ReturnType<typeof validRide>) => unknown, string[]]>([
    ['missing pickup', ({ pickup: _p, ...rest }) => rest, ['pickup']],
    ['pickup is not an object', (r) => ({ ...r, pickup: 'Liberty' }), ['pickup']],
    ['latitude out of range', (r) => ({ ...r, pickup: { ...r.pickup, lat: 95 } }), ['pickup.lat']],
    [
      'longitude out of range',
      (r) => ({ ...r, destination: { ...r.destination, lng: -181 } }),
      ['destination.lng'],
    ],
    [
      'coordinate sent as a string',
      (r) => ({ ...r, pickup: { ...r.pickup, lng: '74.3' } }),
      ['pickup.lng'],
    ],
    ['blank name', (r) => ({ ...r, pickup: { ...r.pickup, name: '   ' } }), ['pickup.name']],
    [
      'name too long',
      (r) => ({ ...r, pickup: { ...r.pickup, name: 'x'.repeat(121) } }),
      ['pickup.name'],
    ],
    ['unknown category', (r) => ({ ...r, category: 'LUXURY' }), ['category']],
    ['unknown top-level property', (r) => ({ ...r, promoCode: 'FREE' }), ['promoCode']],
    [
      'unknown nested property',
      (r) => ({ ...r, pickup: { ...r.pickup, floor: 3 } }),
      ['pickup.floor'],
    ],
    ['empty body', () => ({}), ['category', 'destination', 'pickup']],
  ])('rejects %s', async (_label, mutate, expected) => {
    expect(await fieldsOf(mutate(validRide()), CreateRideDto)).toEqual(expected);
  });
});

describe('FareEstimateRequestDto validation', () => {
  it('rejects a category (estimates cover every category)', async () => {
    expect(await fieldsOf(validRide(), FareEstimateRequestDto)).toEqual(['category']);
  });
});

describe('CancelRideDto validation', () => {
  it('accepts an empty body and trims the reason', async () => {
    expect(await pipe.transform({}, body(CancelRideDto))).toBeInstanceOf(CancelRideDto);
    const dto = await pipe.transform({ reason: '  Plans changed ' }, body(CancelRideDto));
    expect(dto.reason).toBe('Plans changed');
  });

  it('rejects an over-long reason', async () => {
    expect(await fieldsOf({ reason: 'x'.repeat(256) }, CancelRideDto)).toEqual(['reason']);
  });
});

describe('UpdateAvailabilityDto validation', () => {
  it('accepts a status with or without a full location', async () => {
    expect(await fieldsOf({ status: 'OFFLINE' }, UpdateAvailabilityDto)).toEqual([]);
    expect(
      await fieldsOf({ status: 'AVAILABLE', lat: 31.5, lng: 74.3 }, UpdateAvailabilityDto),
    ).toEqual([]);
  });

  it('requires both coordinates when either is sent', async () => {
    expect(await fieldsOf({ status: 'AVAILABLE', lat: 31.5 }, UpdateAvailabilityDto)).toEqual([
      'lng',
    ]);
  });

  it('does not let a driver set BUSY directly', async () => {
    expect(await fieldsOf({ status: 'BUSY' }, UpdateAvailabilityDto)).toEqual(['status']);
  });
});
