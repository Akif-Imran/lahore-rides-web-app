import { ValidationPipe } from '@nestjs/common';
import type { ValidationError as ClassValidatorError } from 'class-validator';
import { ValidationError, type FieldError } from '../errors/domain-errors.js';

/**
 * Turns class-validator's nested error tree into flat `{ field: 'pickup.lat', message }`
 * entries the frontend can attach directly to form fields.
 */
export function flattenValidationErrors(
  errors: readonly ClassValidatorError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    const nested = error.children?.length ? flattenValidationErrors(error.children, field) : [];
    return [...own, ...nested];
  });
}

/** Strict DTO validation: unknown properties are rejected, not silently dropped. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) => new ValidationError(flattenValidationErrors(errors)),
  });
}
