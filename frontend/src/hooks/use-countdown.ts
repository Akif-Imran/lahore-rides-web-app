'use client';

import { useCallback, useEffect, useState } from 'react';

/** Whole seconds left until a deadline set with `start(seconds)`; 0 when idle. */
export function useCountdown(): { secondsLeft: number; start: (seconds: number) => void } {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) setDeadline(null);
    }, 250);
    return () => clearInterval(timer);
  }, [deadline]);

  const start = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setDeadline(current + Math.max(0, seconds) * 1000);
  }, []);

  const secondsLeft = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
  return { secondsLeft, start };
}
