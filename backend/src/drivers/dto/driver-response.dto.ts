import { ApiProperty } from '@nestjs/swagger';
import { RIDE_CATEGORIES, type RideCategory } from '../../common/domain/ride-category.js';
import { CoordinatesDto } from '../../common/dto/location.dto.js';
import { RideResponseDto } from '../../rides/dto/ride-response.dto.js';
import { DRIVER_AVAILABILITY, type DriverAvailability } from '../driver-availability.js';
import type { DriverResponse, OfferResponse } from '../driver.mapper.js';

export class DriverResponseDto implements DriverResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Usman Tariq' }) name: string;
  @ApiProperty({ example: 'Suzuki Alto' }) vehicle: string;
  @ApiProperty({ example: 'LEA-1001' }) plate: string;
  @ApiProperty({ enum: RIDE_CATEGORIES }) vehicleCategory: RideCategory;
  @ApiProperty({ enum: DRIVER_AVAILABILITY }) availability: DriverAvailability;
  @ApiProperty({ type: CoordinatesDto, nullable: true }) location: CoordinatesDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  locationUpdatedAt: string | null;
  @ApiProperty({ type: RideResponseDto, nullable: true }) activeRide: RideResponseDto | null;
}

export class OfferDto implements OfferResponse {
  @ApiProperty({ type: RideResponseDto }) ride: RideResponseDto;
  @ApiProperty({ example: 1800, description: 'Straight-line distance to the pickup' })
  distanceToPickupMeters: number;
  @ApiProperty({ example: 7 }) pickupEtaMinutes: number;
}

export class OffersResponseDto {
  @ApiProperty({ type: [OfferDto] }) offers: OfferDto[];
}
