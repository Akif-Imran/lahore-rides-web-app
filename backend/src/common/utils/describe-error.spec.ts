import { describeError } from './describe-error.js';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeError', () => {
  it('uses the message of a regular error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('falls back to the error code when the message is empty', () => {
    expect(describeError(withCode('', 'ECONNREFUSED'))).toBe('ECONNREFUSED');
  });

  it('falls back to the error name when there is neither message nor code', () => {
    expect(describeError(new TypeError(''))).toBe('TypeError');
  });

  it('describes an empty-message AggregateError by its de-duplicated inner errors', () => {
    const error = new AggregateError([
      withCode('connect ECONNREFUSED ::1:5432', 'ECONNREFUSED'),
      withCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'),
      withCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'),
    ]);
    expect(describeError(error)).toBe(
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  it('keeps the AggregateError message when present', () => {
    expect(describeError(new AggregateError([new Error('a')], 'all failed'))).toBe(
      'all failed (a)',
    );
  });

  it('handles non-Error throwables', () => {
    expect(describeError('plain string')).toBe('plain string');
    expect(describeError({ reason: 'x' })).toBe('{"reason":"x"}');
    expect(describeError(undefined)).toBe('undefined');
  });
});
