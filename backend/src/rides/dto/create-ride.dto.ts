import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsObject, ValidateNested } from 'class-validator';
import { RIDE_CATEGORIES, type RideCategory } from '../../common/domain/ride-category.js';
import { LocationDto } from '../../common/dto/location.dto.js';

export class CreateRideDto {
  @ApiProperty({ type: LocationDto })
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  pickup: LocationDto;

  @ApiProperty({
    type: LocationDto,
    example: { name: 'Lahore Fort', lat: 31.588, lng: 74.315 },
  })
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  destination: LocationDto;

  @ApiProperty({ enum: RIDE_CATEGORIES, example: 'ECONOMY' })
  @IsIn(RIDE_CATEGORIES)
  category: RideCategory;
}
