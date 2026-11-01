import { cx } from '@/lib/cx';
import { RIDER_STATUS_COPY, STATUS_STEPS, stepStates } from '@/lib/ride-status';
import type { RideStatus } from '@/types/api';

/**
 * Status headline inside a polite live region, so screen readers announce each change
 * ("Driver on the way") without the user moving focus.
 */
export function RideStatusHeadline({ status }: { status: RideStatus }) {
  const copy = RIDER_STATUS_COPY[status];
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl" data-testid="ride-status">
        {copy.title}
      </h1>
      <p className="mt-1 text-slate-600">{copy.description}</p>
    </div>
  );
}

/** Requested → Driver assigned → On trip → Completed, with text (not only colour) per step. */
export function RideStatusStepper({ status }: { status: RideStatus }) {
  const states = stepStates(status);
  if (!states) return null;

  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Ride progress">
      {STATUS_STEPS.map((step, index) => {
        const state = states[index]!;
        return (
          <li
            key={step.status}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex flex-col items-center gap-1 text-center"
          >
            <span
              aria-hidden="true"
              className={cx(
                'flex size-8 items-center justify-center rounded-full border-2 text-sm font-bold',
                state === 'complete' && 'border-emerald-700 bg-emerald-700 text-white',
                state === 'current' && 'border-emerald-700 bg-white text-emerald-800',
                state === 'upcoming' && 'border-slate-300 bg-white text-slate-500',
              )}
            >
              {state === 'complete' ? '✓' : index + 1}
            </span>
            <span
              className={cx(
                'text-xs',
                state === 'upcoming' ? 'text-slate-500' : 'font-semibold text-slate-900',
              )}
            >
              {step.label}
              <span className="sr-only">
                {state === 'complete' ? ' (done)' : state === 'current' ? ' (current)' : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
