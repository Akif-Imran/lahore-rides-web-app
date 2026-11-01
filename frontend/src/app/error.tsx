'use client';

import { Button } from '@/components/ui/button';

/**
 * Last-resort boundary for unexpected render errors; never shows internals.
 * `retry` (stable since Next 16.3) re-fetches and re-renders the failed segment.
 */
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Something went wrong</h1>
      <p className="mt-2 text-slate-600">
        An unexpected error stopped this page from loading. Please try again.
      </p>
      <Button className="mt-6" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
