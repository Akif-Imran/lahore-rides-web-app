import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ServiceUnavailableError } from '../common/errors/index.js';
import { ApiErrors } from '../common/http/error-response.dto.js';
import { HealthService } from './health.service.js';

class HealthChecksDto {
  @ApiProperty({ enum: ['up'] }) database: 'up';
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok'] }) status: 'ok';
  @ApiPropertyOptional({ type: HealthChecksDto }) checks?: HealthChecksDto;
}

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Liveness: the process is up. Never touches dependencies.' })
  @ApiOkResponse({ type: HealthResponseDto })
  live(): HealthResponseDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Readiness: the instance can serve traffic (database reachable).' })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiErrors(503)
  async ready(): Promise<HealthResponseDto> {
    if (!(await this.health.isDatabaseReady())) {
      throw new ServiceUnavailableError('Database is not reachable');
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
