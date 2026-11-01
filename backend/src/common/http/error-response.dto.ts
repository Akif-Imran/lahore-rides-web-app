import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiResponse } from '@nestjs/swagger';
import { ErrorCode } from '../errors/error-codes.js';
import type { ErrorEnvelope } from './error-envelope.js';

export class ErrorBodyDto {
  @ApiProperty({ enum: Object.values(ErrorCode), example: 'INVALID_STATE_TRANSITION' })
  code: ErrorCode;

  @ApiProperty({ example: 'Ride cannot move from CANCELLED to COMPLETED' })
  message: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Machine-readable context. VALIDATION_ERROR: `{ fields: [{ field, message, code? }] }`; ' +
      'INVALID_STATE_TRANSITION: `{ currentStatus, attempted }`; ACTIVE_RIDE_EXISTS: `{ activeRideId }`.',
    example: { currentStatus: 'CANCELLED', attempted: 'COMPLETED' },
  })
  details?: Record<string, unknown>;

  @ApiProperty({ example: '6f1c2a7e-3b0d-4c8e-9a51-2f4d7c9e1b3a' })
  requestId: string;
}

export class ErrorResponseDto implements ErrorEnvelope {
  @ApiProperty({ type: ErrorBodyDto })
  error: ErrorBodyDto;
}

const DEFAULT_DESCRIPTIONS: Readonly<Record<number, string>> = {
  400: 'VALIDATION_ERROR: invalid input (see details.fields)',
  401: 'UNAUTHENTICATED: missing or unknown X-Rider-Id / X-Driver-Id',
  403: 'FORBIDDEN: the caller may not perform this action',
  404: 'NOT_FOUND: the resource does not exist or is not visible to the caller',
  409: 'Conflict with the current state (see error.code)',
  422: 'IDEMPOTENCY_KEY_REUSED: same key, different request body',
  429: 'RATE_LIMITED: retry after the Retry-After header',
  503: 'SERVICE_UNAVAILABLE: transient failure, safe to retry',
};

/** Documents error responses with the shared envelope. Pass a status or [status, description]. */
export function ApiErrors(...responses: Array<number | [number, string]>) {
  return applyDecorators(
    ...responses.map((entry) => {
      const [status, description] = Array.isArray(entry)
        ? entry
        : [entry, DEFAULT_DESCRIPTIONS[entry] ?? 'Error'];
      return ApiResponse({ status, description, type: ErrorResponseDto });
    }),
  );
}
