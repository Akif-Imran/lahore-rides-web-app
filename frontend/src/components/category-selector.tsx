'use client';

import { useId } from 'react';
import { cx } from '@/lib/cx';
import { CATEGORY_DESCRIPTION, CATEGORY_LABEL, formatEta, formatFare } from '@/lib/format';
import { type CategoryEstimate, RIDE_CATEGORIES, type RideCategory } from '@/types/api';

export interface CategorySelectorProps {
  value: RideCategory;
  onChange: (category: RideCategory) => void;
  /** Both categories' quotes, once known, so riders can compare. */
  estimates: readonly CategoryEstimate[] | null;
  disabled?: boolean;
}

/** Economy/Comfort choice as a native radio group (keyboard and screen-reader friendly). */
export function CategorySelector({ value, onChange, estimates, disabled }: CategorySelectorProps) {
  const name = useId();
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-slate-800">Ride type</legend>
      <div className="grid grid-cols-2 gap-3">
        {RIDE_CATEGORIES.map((category) => {
          const estimate = estimates?.find((e) => e.category === category);
          const checked = value === category;
          return (
            <label
              key={category}
              className={cx(
                'relative flex cursor-pointer flex-col rounded-xl border-2 bg-white p-3 transition-colors',
                'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-emerald-700',
                'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-70',
                checked
                  ? 'border-emerald-700 bg-emerald-50'
                  : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <input
                type="radio"
                name={name}
                value={category}
                checked={checked}
                onChange={() => onChange(category)}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{CATEGORY_LABEL[category]}</span>
                {/* Not colour alone: a check mark marks the selected option. */}
                <span
                  aria-hidden="true"
                  className={cx(
                    'flex size-5 items-center justify-center rounded-full border text-xs',
                    checked
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-slate-300 text-transparent',
                  )}
                >
                  ✓
                </span>
              </span>
              <span className="text-xs text-slate-600">{CATEGORY_DESCRIPTION[category]}</span>
              <span className="mt-2 text-sm font-semibold text-slate-900">
                {estimate ? formatFare(estimate.total) : ' '}
              </span>
              <span className="text-xs text-slate-600">
                {estimate
                  ? estimate.etaMinutes === null
                    ? 'No drivers nearby'
                    : `Driver ~${formatEta(estimate.etaMinutes)} away`
                  : ' '}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
