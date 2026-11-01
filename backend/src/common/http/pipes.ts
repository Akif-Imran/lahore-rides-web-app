import { ParseUUIDPipe } from '@nestjs/common';
import { ValidationError } from '../errors/domain-errors.js';

/** `:id` path parameter as UUID v4, failing with the standard VALIDATION_ERROR envelope. */
export const uuidParam = (field = 'id'): ParseUUIDPipe =>
  new ParseUUIDPipe({
    version: '4',
    exceptionFactory: () =>
      new ValidationError([{ field, code: 'INVALID_UUID', message: `${field} must be a UUID v4` }]),
  });
