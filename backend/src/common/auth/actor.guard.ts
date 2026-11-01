import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthenticatedError, ValidationError } from '../errors/domain-errors.js';
import {
  ACTOR_KINDS_METADATA,
  type ActorKind,
  type RequestWithCaller,
} from './actor.decorators.js';
import { IdentityService } from './identity.service.js';

const HEADER_FOR: Record<ActorKind, string> = { RIDER: 'X-Rider-Id', DRIVER: 'X-Driver-Id' };

function singleHeader(req: RequestWithCaller, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/**
 * Global guard. Routes declare who may call them (@RiderActor/@DriverActor/@AnyActor);
 * the guard checks the caller sent exactly one identity header of an allowed kind, that it
 * belongs to a known user, and attaches the resolved Caller to the request.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<ActorKind[] | undefined>(
      ACTOR_KINDS_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed) return true;

    const req = context.switchToHttp().getRequest<RequestWithCaller>();
    const riderId = singleHeader(req, HEADER_FOR.RIDER);
    const driverId = singleHeader(req, HEADER_FOR.DRIVER);

    if (riderId && driverId) {
      throw new ValidationError([
        { field: 'headers', message: 'Send exactly one of X-Rider-Id or X-Driver-Id' },
      ]);
    }
    const kind: ActorKind | null = riderId ? 'RIDER' : driverId ? 'DRIVER' : null;
    const id = riderId ?? driverId;
    if (!kind || !id) {
      throw new UnauthenticatedError(
        `Missing ${allowed.map((k) => HEADER_FOR[k]).join(' or ')} header`,
      );
    }
    if (!allowed.includes(kind)) {
      throw new ForbiddenError(
        `This endpoint is only available to ${allowed.map((k) => k.toLowerCase() + 's').join(' and ')}`,
      );
    }

    req.caller = await this.identity.resolve(kind, id);
    return true;
  }
}
