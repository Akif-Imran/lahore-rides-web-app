import type { ErrorDetails } from '../errors/domain-errors.js';
import type { ErrorCode } from '../errors/error-codes.js';

/** The body of every non-2xx response. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetails;
    requestId: string;
  };
}
