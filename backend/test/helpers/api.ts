import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { z } from 'zod';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type { FieldError } from '../../src/common/errors/domain-errors.js';
import type { RideResponse } from '../../src/rides/ride.mapper.js';
import { tripBody } from './fixtures.js';
import type { Http } from './test-app.js';

export const API = '/api/v1';

export const asRider = (id: string) => ({ 'X-Rider-Id': id });
export const asDriver = (id: string) => ({ 'X-Driver-Id': id });

export function requestRide(
  http: Http,
  riderId: string,
  options: { body?: object; key?: string } = {},
) {
  return http
    .post(`${API}/rides`)
    .set(asRider(riderId))
    .set('Idempotency-Key', options.key ?? randomUUID())
    .send(options.body ?? tripBody());
}

export const getRide = (http: Http, rideId: string, headers: Record<string, string>) =>
  http.get(`${API}/rides/${rideId}`).set(headers);
export const accept = (http: Http, rideId: string, driverId: string) =>
  http.post(`${API}/rides/${rideId}/accept`).set(asDriver(driverId));
export const start = (http: Http, rideId: string, driverId: string) =>
  http.post(`${API}/rides/${rideId}/start`).set(asDriver(driverId));
export const complete = (http: Http, rideId: string, driverId: string) =>
  http.post(`${API}/rides/${rideId}/complete`).set(asDriver(driverId));
export const cancel = (
  http: Http,
  rideId: string,
  headers: Record<string, string>,
  reason?: string,
) =>
  http
    .post(`${API}/rides/${rideId}/cancel`)
    .set(headers)
    .send(reason === undefined ? {} : { reason });

async function expectOk(promise: PromiseLike<Response>, status = 200): Promise<RideResponse> {
  const res = await promise;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as RideResponse;
}

export const createRequestedRide = (http: Http, riderId: string, body?: object) =>
  expectOk(requestRide(http, riderId, { body }), 201);

export async function createAssignedRide(http: Http, riderId: string, driverId: string) {
  const ride = await createRequestedRide(http, riderId);
  return expectOk(accept(http, ride.id, driverId));
}

export async function createInProgressRide(http: Http, riderId: string, driverId: string) {
  const ride = await createAssignedRide(http, riderId, driverId);
  return expectOk(start(http, ride.id, driverId));
}

export async function createCompletedRide(http: Http, riderId: string, driverId: string) {
  const ride = await createInProgressRide(http, riderId, driverId);
  return expectOk(complete(http, ride.id, driverId));
}

/** The contract every non-2xx response must satisfy (blueprint 4.1). */
export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
        message: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
        requestId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type ErrorBody = z.infer<typeof errorEnvelopeSchema>['error'];

/** Asserts status, code and the full envelope shape; the request id must match the header. */
export function expectError(res: Response, status: number, code: ErrorCode): ErrorBody {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const { error } = errorEnvelopeSchema.parse(res.body);
  expect(error.code).toBe(code);
  expect(error.requestId).toBe(res.headers['x-request-id']);
  return error;
}

export const fieldsOf = (error: ErrorBody): FieldError[] =>
  (error.details?.['fields'] as FieldError[] | undefined) ?? [];
