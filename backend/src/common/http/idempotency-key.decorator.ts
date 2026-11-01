import { applyDecorators, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { ValidationError } from '../errors/domain-errors.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Reads and validates the required `Idempotency-Key` header (any UUID, normalised to lower case). */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const raw = context.switchToHttp().getRequest<Request>().headers['idempotency-key'];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!value) {
      throw new ValidationError([
        {
          field: IDEMPOTENCY_KEY_HEADER,
          code: 'REQUIRED',
          message: 'Idempotency-Key header is required: a UUID generated once per ride request',
        },
      ]);
    }
    if (!isUUID(value)) {
      throw new ValidationError([
        {
          field: IDEMPOTENCY_KEY_HEADER,
          code: 'INVALID',
          message: 'Idempotency-Key must be a UUID',
        },
      ]);
    }
    return value.toLowerCase();
  },
);

export const ApiIdempotencyKey = () =>
  applyDecorators(
    ApiHeader({
      name: IDEMPOTENCY_KEY_HEADER,
      required: true,
      description: 'UUID generated once per ride request; reuse it when retrying the same request.',
      schema: { type: 'string', format: 'uuid' },
    }),
  );
