import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, ValidateNested } from 'class-validator';
import { RIDE_CATEGORIES, type RideCategory } from '../../common/domain/ride-category.js';
import { LocationDto } from '../../common/dto/location.dto.js';
import { FareBreakdownDto } from '../../rides/dto/ride-response.dto.js';
import type { CategoryEstimate, FareEstimateResponse } from '../fare-estimates.service.js';

export class FareEstimateRequestDto {
  @ApiProperty({ type: LocationDto })
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  pickup: LocationDto;

  @ApiProperty({ type: LocationDto, example: { name: 'Lahore Fort', lat: 31.588, lng: 74.315 } })
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  destination: LocationDto;
}

export class CategoryEstimateDto implements CategoryEstimate {
  @ApiProperty({ enum: RIDE_CATEGORIES }) category: RideCategory;
  @ApiProperty({ example: 'PKR' }) currency: string;
  @ApiProperty({ example: 773, description: 'Whole PKR' }) total: number;
  @ApiProperty({ type: FareBreakdownDto }) breakdown: FareBreakdownDto;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4,
    description: 'Pickup ETA of the nearest eligible driver; null when none is nearby',
  })
  etaMinutes: number | null;
}

export class FareEstimateResponseDto implements FareEstimateResponse {
  @ApiProperty({ example: 11873 }) distanceMeters: number;
  @ApiProperty({ example: 1781 }) durationSeconds: number;
  @ApiProperty({ type: [CategoryEstimateDto] }) estimates: CategoryEstimateDto[];
}
