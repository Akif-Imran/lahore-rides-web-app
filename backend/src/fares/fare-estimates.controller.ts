import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiderActor } from '../common/auth/actor.decorators.js';
import { ApiErrors } from '../common/http/error-response.dto.js';
import { FareEstimateRequestDto, FareEstimateResponseDto } from './dto/fare-estimate.dto.js';
import { FareEstimatesService, type FareEstimateResponse } from './fare-estimates.service.js';

@ApiTags('fares')
@Controller('fare-estimates')
export class FareEstimatesController {
  constructor(private readonly estimates: FareEstimatesService) {}

  @Post()
  @RiderActor()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Estimate fares and pickup ETA for every category',
    description: 'Creates nothing. Powers the booking screen before the rider requests a ride.',
  })
  @ApiOkResponse({ type: FareEstimateResponseDto })
  @ApiErrors(400)
  estimate(@Body() dto: FareEstimateRequestDto): Promise<FareEstimateResponse> {
    return this.estimates.estimate(dto.pickup, dto.destination);
  }
}
