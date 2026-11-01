'use client';

import { type KeyboardEvent, type Ref, useEffect, useId, useMemo, useState } from 'react';
import { cx } from '@/lib/cx';
import type { Landmark } from '@/lib/landmarks';

/** Case-insensitive match on name or area; names that start with the query come first. */
export function filterLandmarks(options: readonly Landmark[], query: string): Landmark[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  const matches = options.filter(
    (o) => o.name.toLowerCase().includes(q) || o.area.toLowerCase().includes(q),
  );
  return matches.sort(
    (a, b) =>
      Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)),
  );
}

export interface LocationPickerProps {
  label: string;
  /** Selected landmark id, or '' for none. */
  value: string;
  onChange: (landmarkId: string) => void;
  onBlur?: () => void;
  options: readonly Landmark[];
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Searchable landmark picker following the WAI-ARIA "combobox with list autocomplete" pattern:
 * type to filter, ArrowUp/ArrowDown to move, Enter to choose, Escape to close. Only listed
 * landmarks can be chosen; leaving the field with unmatched text restores the last choice.
 */
export function LocationPicker({
  label,
  value,
  onChange,
  onBlur,
  options,
  error,
  disabled = false,
  placeholder = 'Search Lahore landmarks',
  inputRef,
}: LocationPickerProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const optionId = (landmarkId: string) => `${id}-option-${landmarkId}`;

  const selected = options.find((o) => o.id === value);
  // `null` while not editing: the input then shows the selected landmark's name.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const filtered = useMemo(() => filterLandmarks(options, query ?? ''), [options, query]);
  const active = open && activeIndex >= 0 ? filtered[activeIndex] : undefined;
  const activeOptionId = active ? optionId(active.id) : undefined;

  useEffect(() => {
    if (!activeOptionId) return;
    // Optional call: scrollIntoView is missing in some test DOMs.
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const choose = (option: Landmark) => {
    onChange(option.id);
    setQuery(null);
    close();
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    const current = filtered.findIndex((o) => o.id === value);
    setActiveIndex(current >= 0 ? current : 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (open && active) {
          event.preventDefault();
          choose(active);
        }
        break;
      case 'Escape':
        if (open || query !== null) {
          event.preventDefault();
          setQuery(null);
          close();
        }
        break;
    }
  };

  const handleBlur = () => {
    if (query !== null) {
      const typed = query.trim().toLowerCase();
      if (typed === '') onChange('');
      else {
        const exact = options.find((o) => o.name.toLowerCase() === typed);
        if (exact) onChange(exact.id);
      }
    }
    setQuery(null);
    close();
    onBlur?.();
  };

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={query ?? selected?.name ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          setActiveIndex(filterLandmarks(options, next).length > 0 ? 0 : -1);
        }}
        onClick={() => !open && openList()}
        onKeyDown={onKeyDown}
        onBlur={handleBlur}
        className={cx(
          'block min-h-12 w-full rounded-xl border bg-white px-3 text-base text-slate-900 shadow-xs',
          'placeholder:text-slate-500 focus:outline-2 focus:outline-offset-1 focus:outline-emerald-700',
          'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
          error ? 'border-red-600' : 'border-slate-300',
        )}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
      >
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-slate-600" role="presentation">
            No matching places. Try another name.
          </li>
        ) : (
          filtered.map((option, index) => (
            <li
              key={option.id}
              id={optionId(option.id)}
              role="option"
              aria-selected={index === activeIndex}
              // Keep focus in the input so blur does not fire before the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              onMouseMove={() => index !== activeIndex && setActiveIndex(index)}
              className={cx(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-2',
                index === activeIndex && 'bg-emerald-50',
              )}
            >
              <span>
                <span className="block text-sm font-medium text-slate-900">{option.name}</span>
                <span className="block text-xs text-slate-600">{option.area}</span>
              </span>
              {option.id === value && (
                <span className="text-xs font-semibold text-emerald-800">Selected</span>
              )}
            </li>
          ))
        )}
      </ul>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
