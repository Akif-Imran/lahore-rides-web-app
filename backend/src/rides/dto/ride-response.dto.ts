import { ApiProperty } from '@nestjs/swagger';
import { RIDE_CATEGORIES, type RideCategory } from '../../common/domain/ride-category.js';
import { CoordinatesDto, NamedLocationDto } from '../../common/dto/location.dto.js';
import type {
  FareBreakdownView,
  RideDriverView,
  RideFareView,
  RideResponse,
} from '../ride.mapper.js';
import { RIDE_STATUSES, type RideStatus } from '../ride-status.js';
import type { CancelledBy } from '../ride.types.js';

// Swagger schema classes. Each `implements` its mapper interface, so the documented shape
// cannot drift from what the API actually returns without a compile error.

export class FareBreakdownDto implements FareBreakdownView {
  @ApiProperty({ example: 150, description: 'PKR' }) base: number;
  @ApiProperty({ example: 475, description: 'PKR' }) distance: number;
  @ApiProperty({ example: 148, description: 'PKR' }) time: number;
  @ApiProperty({ example: 1 }) surge: number;
  @ApiProperty({ example: false }) minimumFareApplied: boolean;
}

export class RideFareDto implements RideFareView {
  @ApiProperty({ example: 'PKR' }) currency: string;
  @ApiProperty({ example: 773, description: 'Whole PKR' }) estimatedTotal: number;
  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Set on completion' })
  finalTotal: number | null;
  @ApiProperty({ type: FareBreakdownDto }) breakdown: FareBreakdownDto;
}

export class RideDriverDto implements RideDriverView {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Usman Tariq' }) name: string;
  @ApiProperty({ example: 'Suzuki Alto' }) vehicle: string;
  @ApiProperty({ example: 'LEA-1001' }) plate: string;
  @ApiProperty({ enum: RIDE_CATEGORIES }) vehicleCategory: RideCategory;
  @ApiProperty({
    type: CoordinatesDto,
    nullable: true,
    description: 'Live position while ASSIGNED or IN_PROGRESS; null otherwise',
  })
  location: CoordinatesDto | null;
}

export class RideResponseDto implements RideResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: RIDE_STATUSES, example: 'REQUESTED' }) status: RideStatus;
  @ApiProperty({ enum: RIDE_CATEGORIES, example: 'ECONOMY' }) category: RideCategory;
  @ApiProperty({ type: NamedLocationDto }) pickup: NamedLocationDto;
  @ApiProperty({ type: NamedLocationDto }) destination: NamedLocationDto;
  @ApiProperty({ example: 11873, description: 'Estimated road distance' }) distanceMeters: number;
  @ApiProperty({ example: 1781, description: 'Estimated trip duration' }) durationSeconds: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4,
    description: 'Pickup ETA at request time; null if no driver was nearby',
  })
  etaMinutes: number | null;
  @ApiProperty({ type: RideFareDto }) fare: RideFareDto;
  @ApiProperty({ type: RideDriverDto, nullable: true }) driver: RideDriverDto | null;
  @ApiProperty({ enum: ['RIDER', 'DRIVER', 'SYSTEM'], nullable: true, example: null })
  cancelledBy: CancelledBy | null;
  @ApiProperty({ type: String, nullable: true, example: null }) cancelReason: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) assignedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt: string | null;
  @ApiProperty({ example: 1, description: 'Incremented on every state change' }) version: number;
}

export class ActiveRideResponseDto {
  @ApiProperty({ type: RideResponseDto, nullable: true }) ride: RideResponseDto | null;
}
