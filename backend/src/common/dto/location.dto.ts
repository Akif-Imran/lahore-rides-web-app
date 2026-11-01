import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsString, Length, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * A named point. Range checks live here; the service-area and minimum-distance rules are
 * business validation in `validateTrip`, because they depend on configuration.
 */
export class LocationDto {
  @ApiProperty({ example: 'Liberty Market', minLength: 1, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty({ example: 31.5106, minimum: -90, maximum: 90 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 74.344, minimum: -180, maximum: 180 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng: number;
}

export class CoordinatesDto {
  @ApiProperty({ example: 31.5106 })
  lat: number;

  @ApiProperty({ example: 74.344 })
  lng: number;
}

export class NamedLocationDto extends CoordinatesDto {
  @ApiProperty({ example: 'Liberty Market' })
  name: string;
}
