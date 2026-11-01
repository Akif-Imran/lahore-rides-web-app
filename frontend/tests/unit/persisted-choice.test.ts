import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistedChoice } from '@/lib/persisted-choice';

const options = {
  key: 'test:choice',
  storage: 'local' as const,
  fallback: 'a',
  isValid: (v: string) => ['a', 'b', 'c'].includes(v),
};

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('createPersistedChoice', () => {
  it('returns the fallback until something valid is stored', () => {
    const choice = createPersistedChoice(options);
    expect(choice.get()).toBe('a');
    window.localStorage.setItem('test:choice', 'not-a-valid-id');
    expect(choice.get()).toBe('a');
  });

  it('persists a valid choice and notifies subscribers', () => {
    const choice = createPersistedChoice(options);
    const listener = vi.fn();
    const unsubscribe = choice.subscribe(listener);

    choice.set('b');

    expect(choice.get()).toBe('b');
    expect(window.localStorage.getItem('test:choice')).toBe('b');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    choice.set('c');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid values', () => {
    const choice = createPersistedChoice(options);
    choice.set('zzz');
    expect(choice.get()).toBe('a');
    expect(window.localStorage.getItem('test:choice')).toBeNull();
  });

  it('keeps working in memory when storage throws (private mode, blocked storage)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const choice = createPersistedChoice(options);
    expect(choice.get()).toBe('a');
    choice.set('c');
    expect(choice.get()).toBe('c');
  });

  it('follows changes made in other tabs (storage events)', () => {
    const choice = createPersistedChoice(options);
    const listener = vi.fn();
    choice.subscribe(listener);

    window.localStorage.setItem('test:choice', 'c');
    window.dispatchEvent(new StorageEvent('storage', { key: 'test:choice', newValue: 'c' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'x' }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(choice.get()).toBe('c');
  });

  it('session storage keeps the choice per tab', () => {
    const choice = createPersistedChoice({ ...options, storage: 'session' });
    choice.set('b');
    expect(window.sessionStorage.getItem('test:choice')).toBe('b');
    expect(window.localStorage.getItem('test:choice')).toBeNull();
  });
});
