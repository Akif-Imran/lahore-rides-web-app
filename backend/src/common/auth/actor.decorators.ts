import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Caller } from '../domain/caller.js';
import { ForbiddenError } from '../errors/domain-errors.js';
import { DRIVER_SECURITY, RIDER_SECURITY } from '../http/openapi.js';
import { ApiErrors } from '../http/error-response.dto.js';

export type ActorKind = Caller['kind'];
export type RiderCaller = Extract<Caller, { kind: 'RIDER' }>;
export type DriverCaller = Extract<Caller, { kind: 'DRIVER' }>;
export type RequestWithCaller = Request & { caller?: Caller };

export const ACTOR_KINDS_METADATA = 'ride-booking:actor-kinds';

const securityFor = (kind: ActorKind) =>
  ApiSecurity(kind === 'RIDER' ? RIDER_SECURITY : DRIVER_SECURITY);

/** Restricts a route to the given caller kinds; routes without it are public (health). */
function Actors(...kinds: ActorKind[]) {
  return applyDecorators(
    SetMetadata(ACTOR_KINDS_METADATA, kinds),
    ...kinds.map(securityFor),
    ApiErrors(401, 403),
  );
}

export const RiderActor = () => Actors('RIDER');
export const DriverActor = () => Actors('DRIVER');
export const AnyActor = () => Actors('RIDER', 'DRIVER');

function callerFrom(context: ExecutionContext): Caller {
  const caller = context.switchToHttp().getRequest<RequestWithCaller>().caller;
  // The guard always sets it for routes that declare an actor; reaching this is a wiring bug.
  if (!caller) throw new Error('No resolved caller: is the route missing an actor decorator?');
  return caller;
}

export const CurrentCaller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Caller => callerFrom(context),
);

export const CurrentRider = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RiderCaller => {
    const caller = callerFrom(context);
    if (caller.kind !== 'RIDER')
      throw new ForbiddenError('This endpoint is only available to riders');
    return caller;
  },
);

export const CurrentDriver = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DriverCaller => {
    const caller = callerFrom(context);
    if (caller.kind !== 'DRIVER')
      throw new ForbiddenError('This endpoint is only available to drivers');
    return caller;
  },
);
