import { Body, Controller, Get, Header, Param, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentDriver, DriverActor, type DriverCaller } from '../common/auth/actor.decorators.js';
import { ForbiddenError } from '../common/errors/index.js';
import { ApiErrors } from '../common/http/error-response.dto.js';
import { uuidParam } from '../common/http/pipes.js';
import type { DriverResponse, OfferResponse } from './driver.mapper.js';
import { DriverResponseDto, OffersResponseDto } from './dto/driver-response.dto.js';
import { UpdateAvailabilityDto } from './dto/update-availability.dto.js';
import { DriversService } from './drivers.service.js';

/** Driver-console endpoints. A driver may only act on their own profile. */
@ApiTags('drivers')
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get(':id')
  @DriverActor()
  @Header('Cache-Control', 'no-cache')
  @ApiOperation({ summary: "The driver's profile, availability and active ride" })
  @ApiOkResponse({ type: DriverResponseDto })
  @ApiErrors(400, 404)
  getProfile(
    @Param('id', uuidParam()) id: string,
    @CurrentDriver() driver: DriverCaller,
  ): Promise<DriverResponse> {
    assertSelf(driver, id);
    return this.drivers.getProfile(driver.id);
  }

  @Get(':id/offers')
  @DriverActor()
  @Header('Cache-Control', 'no-cache')
  @ApiOperation({
    summary: 'Open rides this driver can accept',
    description:
      'REQUESTED rides the vehicle category can serve, with pickups inside MAX_OFFER_RADIUS_KM, ' +
      'nearest first. Empty unless the driver is AVAILABLE with a fresh location.',
  })
  @ApiOkResponse({ type: OffersResponseDto })
  @ApiErrors(400, 404)
  async listOffers(
    @Param('id', uuidParam()) id: string,
    @CurrentDriver() driver: DriverCaller,
  ): Promise<{ offers: OfferResponse[] }> {
    assertSelf(driver, id);
    return { offers: await this.drivers.listOffers(driver.id) };
  }

  @Patch(':id/availability')
  @DriverActor()
  @ApiOperation({
    summary: 'Go AVAILABLE or OFFLINE (optionally reporting a location)',
    description: 'Rejected with 409 while the driver is BUSY on a trip.',
  })
  @ApiOkResponse({ type: DriverResponseDto })
  @ApiErrors(400, 404, [409, 'CONFLICT: the driver is on an active trip'])
  setAvailability(
    @Param('id', uuidParam()) id: string,
    @CurrentDriver() driver: DriverCaller,
    @Body() dto: UpdateAvailabilityDto,
  ): Promise<DriverResponse> {
    assertSelf(driver, id);
    return this.drivers.setAvailability(driver.id, dto);
  }
}

function assertSelf(driver: DriverCaller, pathId: string): void {
  if (driver.id !== pathId.toLowerCase()) {
    throw new ForbiddenError('Drivers can only access their own profile');
  }
}
