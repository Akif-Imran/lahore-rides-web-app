import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, Max, Min, ValidateIf } from 'class-validator';

export const SETTABLE_AVAILABILITY = ['AVAILABLE', 'OFFLINE'] as const;
export type SettableAvailability = (typeof SETTABLE_AVAILABILITY)[number];

/** If either coordinate is sent, both are required (a half location is meaningless). */
const hasLocation = (dto: UpdateAvailabilityDto) => dto.lat !== undefined || dto.lng !== undefined;

export class UpdateAvailabilityDto {
  @ApiProperty({
    enum: SETTABLE_AVAILABILITY,
    description: 'BUSY is controlled by the ride lifecycle and cannot be set directly',
  })
  @IsIn(SETTABLE_AVAILABILITY)
  status: SettableAvailability;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, example: 31.52, description: 'Send with lng' })
  @ValidateIf(hasLocation)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({
    minimum: -180,
    maximum: 180,
    example: 74.36,
    description: 'Send with lat',
  })
  @ValidateIf(hasLocation)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng?: number;
}
