import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AnyActor,
  CurrentCaller,
  CurrentDriver,
  CurrentRider,
  DriverActor,
  RiderActor,
  type DriverCaller,
  type RiderCaller,
} from '../common/auth/actor.decorators.js';
import type { Caller } from '../common/domain/caller.js';
import { API_PREFIX } from '../common/http/api-prefix.js';
import { ApiErrors } from '../common/http/error-response.dto.js';
import { ApiIdempotencyKey, IdempotencyKey } from '../common/http/idempotency-key.decorator.js';
import { uuidParam } from '../common/http/pipes.js';
import { RateLimitRideCreation } from '../common/rate-limit/rate-limit.module.js';
import { CancelRideDto } from './dto/cancel-ride.dto.js';
import { CreateRideDto } from './dto/create-ride.dto.js';
import { RideResponseDto } from './dto/ride-response.dto.js';
import type { RideResponse } from './ride.mapper.js';
import { RidesService } from './rides.service.js';

export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

@ApiTags('rides')
@Controller('rides')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  @Post()
  @RiderActor()
  @RateLimitRideCreation()
  @ApiIdempotencyKey()
  @ApiOperation({
    summary: 'Request a ride',
    description:
      'Quotes the fare, estimates the pickup ETA and creates a REQUESTED ride. Safe to retry ' +
      'with the same Idempotency-Key: the original response is replayed and no second ride is created.',
  })
  @ApiCreatedResponse({ type: RideResponseDto, description: 'Ride requested' })
  @ApiOkResponse({
    type: RideResponseDto,
    description: 'Replay of an earlier request with the same Idempotency-Key',
    headers: { [IDEMPOTENT_REPLAYED_HEADER]: { schema: { type: 'string', example: 'true' } } },
  })
  @ApiErrors(
    400,
    [409, 'ACTIVE_RIDE_EXISTS: the rider already has an active ride (details.activeRideId)'],
    422,
    429,
  )
  async create(
    @CurrentRider() rider: RiderCaller,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: CreateRideDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RideResponse> {
    const { ride, replayed } = await this.rides.createRide(rider.id, dto, idempotencyKey);
    if (replayed) {
      res.status(HttpStatus.OK).setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    } else {
      res.status(HttpStatus.CREATED).setHeader('Location', `/${API_PREFIX}/rides/${ride.id}`);
    }
    return ride;
  }

  @Get(':id')
  @AnyActor()
  @Header('Cache-Control', 'no-cache')
  @ApiOperation({
    summary: 'Get a ride',
    description:
      'Visible to its rider, its assigned driver, and drivers who could accept it now. ' +
      'Supports If-None-Match (ETag) so status polling is cheap.',
  })
  @ApiOkResponse({ type: RideResponseDto })
  @ApiResponse({ status: 304, description: 'Not modified since the ETag in If-None-Match' })
  @ApiErrors(400, 404)
  get(
    @Param('id', uuidParam()) id: string,
    @CurrentCaller() caller: Caller,
  ): Promise<RideResponse> {
    return this.rides.getRide(id, caller);
  }

  @Post(':id/accept')
  @DriverActor()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a ride (driver)',
    description: 'Exactly one driver wins. Repeating the call as the winner returns 200 unchanged.',
  })
  @ApiOkResponse({ type: RideResponseDto, description: 'Ride is ASSIGNED to the caller' })
  @ApiErrors(400, [403, 'DRIVER_NOT_ELIGIBLE: vehicle category cannot serve this ride'], 404, [
    409,
    'RIDE_ALREADY_ASSIGNED | DRIVER_UNAVAILABLE | INVALID_STATE_TRANSITION',
  ])
  accept(
    @Param('id', uuidParam()) id: string,
    @CurrentDriver() driver: DriverCaller,
  ): Promise<RideResponse> {
    return this.rides.accept(id, driver);
  }

  @Post(':id/start')
  @DriverActor()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start the trip (assigned driver)' })
  @ApiOkResponse({ type: RideResponseDto, description: 'Ride is IN_PROGRESS' })
  @ApiErrors(400, 404, [409, 'INVALID_STATE_TRANSITION'])
  start(
    @Param('id', uuidParam()) id: string,
    @CurrentDriver() driver: DriverCaller,
  ): Promise<RideResponse> {
    return this.rides.start(id, driver);
  }

  @Post(':id/cancel')
  @AnyActor()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a ride',
    description:
      'Rider: while REQUESTED or ASSIGNED. Assigned driver: while ASSIGNED. Frees the driver. ' +
      'Cancelling an already cancelled ride returns 200.',
  })
  @ApiOkResponse({ type: RideResponseDto, description: 'Ride is CANCELLED' })
  @ApiErrors(400, 404, [409, 'INVALID_STATE_TRANSITION: trip already started or finished'])
  cancel(
    @Param('id', uuidParam()) id: string,
    @CurrentCaller() caller: Caller,
    @Body() dto: CancelRideDto,
  ): Promise<RideResponse> {
    return this.rides.cancel(id, caller, dto.reason);
  }

  @Post(':id/complete')
  @DriverActor()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete the trip (assigned driver)',
    description: 'Requires IN_PROGRESS. Sets the final fare and frees the driver.',
  })
  @ApiOkResponse({ type: RideResponseDto, description: 'Ride is COMPLETED' })
  @ApiErrors(400, 404, [409, 'INVALID_STATE_TRANSITION: must be IN_PROGRESS'])
  complete(
    @Param('id', uuidParam()) id: string,
    @CurrentDriver() driver: DriverCaller,
  ): Promise<RideResponse> {
    return this.rides.complete(id, driver);
  }
}
