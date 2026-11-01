/**
 * A string choice (e.g. the demo rider id) kept in Web Storage and exposed as an external store
 * for `useSyncExternalStore`. Storage can be missing or throw (private mode, blocked cookies),
 * so every access is guarded and an in-memory value takes over.
 */
export interface PersistedChoice {
  subscribe(listener: () => void): () => void;
  get(): string;
  set(value: string): void;
}

export interface PersistedChoiceOptions {
  key: string;
  /** `local`: shared by all tabs. `session`: per tab, so two tabs can act as two drivers. */
  storage: 'local' | 'session';
  fallback: string;
  isValid: (value: string) => boolean;
}

export function createPersistedChoice(options: PersistedChoiceOptions): PersistedChoice {
  const { key, fallback, isValid } = options;
  const listeners = new Set<() => void>();
  let memory: string | null = null;

  const storage = (): Storage | null => {
    try {
      return options.storage === 'local' ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  };

  const read = (): string | null => {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  const notify = () => listeners.forEach((listener) => listener());

  const onStorage = (event: StorageEvent) => {
    if (event.key === key) {
      memory = null;
      notify();
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener('storage', onStorage);
      };
    },
    get() {
      const value = memory ?? read();
      return value !== null && isValid(value) ? value : fallback;
    },
    set(value) {
      if (!isValid(value)) return;
      memory = value;
      try {
        storage()?.setItem(key, value);
      } catch {
        // Storage unavailable: the in-memory value still applies for this page.
      }
      notify();
    },
  };
}
