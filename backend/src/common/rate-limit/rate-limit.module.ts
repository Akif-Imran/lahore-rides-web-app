import { Module, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { isUUID } from 'class-validator';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

export const RIDE_CREATION_THROTTLER = 'ride-create';
const RIDE_CREATION_METADATA = 'ride-booking:rate-limit-ride-creation';

/** Applies the stricter, per-caller ride-creation limit (RATE_LIMIT_CREATE_RIDE_LIMIT). */
export const RateLimitRideCreation = () => SetMetadata(RIDE_CREATION_METADATA, true);

function isRideCreation(context: ExecutionContext): boolean {
  return Reflect.getMetadata(RIDE_CREATION_METADATA, context.getHandler()) === true;
}

type TrackableRequest = { headers?: Record<string, string | string[] | undefined>; ip?: string };

/**
 * Rate-limit bucket: the caller's identity when it looks like one, else the client IP.
 * Keying on identity stops one busy NAT/IP (or a demo with several tabs) from throttling
 * everyone behind it. With header-based demo identities this is spoofable; with real auth
 * the tracker becomes the authenticated user id.
 */
export function trackRequester(req: TrackableRequest): string {
  for (const name of ['x-rider-id', 'x-driver-id']) {
    const raw = req.headers?.[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && isUUID(value)) return `actor:${value.toLowerCase()}`;
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        getTracker: trackRequester,
        throttlers: [
          {
            name: 'default',
            ttl: seconds(config.rateLimit.ttlSeconds),
            limit: config.rateLimit.limit,
          },
          {
            name: RIDE_CREATION_THROTTLER,
            ttl: seconds(config.rateLimit.ttlSeconds),
            limit: config.rateLimit.createRideLimit,
            skipIf: (context: ExecutionContext) => !isRideCreation(context),
          },
        ],
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
