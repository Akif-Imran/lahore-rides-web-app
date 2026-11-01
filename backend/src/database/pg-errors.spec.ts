import { DatabaseError } from 'pg';
import { isConnectionError, isRetryablePgError, isUniqueViolation } from './pg-errors.js';

function pgError(code: string, constraint?: string): DatabaseError {
  const error = new DatabaseError('db error', 0, 'error');
  error.code = code;
  error.constraint = constraint;
  return error;
}

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('isUniqueViolation', () => {
  it('matches 23505, optionally on a specific constraint', () => {
    const error = pgError('23505', 'uq_one_active_ride_per_rider');
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, 'uq_one_active_ride_per_rider')).toBe(true);
    expect(isUniqueViolation(error, 'uq_active_assignment_per_ride')).toBe(false);
  });

  it('ignores other errors', () => {
    expect(isUniqueViolation(pgError('23503'))).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
  });
});

describe('isRetryablePgError', () => {
  it.each(['40001', '40P01', '55P03', '57014'])('treats %s as retryable', (code) => {
    expect(isRetryablePgError(pgError(code))).toBe(true);
  });

  it.each(['23505', '23514', '42P01'])('does not treat %s as retryable', (code) => {
    expect(isRetryablePgError(pgError(code))).toBe(false);
  });
});

describe('isConnectionError', () => {
  it.each<[string, unknown, boolean]>([
    ['ECONNREFUSED', withCode('connect ECONNREFUSED', 'ECONNREFUSED'), true],
    ['pool connect timeout', new Error('timeout exceeded when trying to connect'), true],
    ['connection terminated', new Error('Connection terminated unexpectedly'), true],
    ['pg class 08 code', pgError('08006'), true],
    ['admin shutdown', pgError('57P01'), true],
    [
      'AggregateError of refusals',
      new AggregateError([withCode('a', 'ECONNREFUSED'), withCode('b', 'ECONNREFUSED')]),
      true,
    ],
    ['AggregateError with a non-connection error', new AggregateError([new Error('nope')]), false],
    ['empty AggregateError', new AggregateError([]), false],
    ['query error', pgError('42P01'), false],
    ['plain error', new Error('something else'), false],
    ['non-error', 'ECONNREFUSED', false],
  ])('%s -> %s', (_label, error, expected) => {
    expect(isConnectionError(error)).toBe(expected);
  });
});
