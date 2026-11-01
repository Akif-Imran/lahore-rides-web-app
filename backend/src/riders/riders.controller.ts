import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentRider, RiderActor, type RiderCaller } from '../common/auth/actor.decorators.js';
import { ActiveRideResponseDto } from '../rides/dto/ride-response.dto.js';
import type { RideResponse } from '../rides/ride.mapper.js';
import { RidesService } from '../rides/rides.service.js';

@ApiTags('riders')
@Controller('riders')
export class RidersController {
  constructor(private readonly rides: RidesService) {}

  @Get('me/active-ride')
  @RiderActor()
  @Header('Cache-Control', 'no-cache')
  @ApiOperation({
    summary: "The caller's active ride, if any",
    description: 'Lets the UI restore an in-flight ride after a refresh. `ride` is null when none.',
  })
  @ApiOkResponse({ type: ActiveRideResponseDto })
  async activeRide(@CurrentRider() rider: RiderCaller): Promise<{ ride: RideResponse | null }> {
    return { ride: await this.rides.findActiveRideForRider(rider.id) };
  }
}
