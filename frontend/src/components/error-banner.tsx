import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { isApiError, shouldShowRequestId, toUserMessage } from '@/lib/errors';
import { Button } from './ui/button';

export interface ErrorBannerProps {
  /** The error to describe; ignored when `message` is given. */
  error?: unknown;
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  tone?: 'error' | 'warning';
  className?: string;
}

/**
 * Inline, announced error with an optional Retry. For server-side failures it shows the request
 * id, so a support person can find the matching log lines (blueprint 5.4.4).
 */
export function ErrorBanner({
  error,
  title,
  message,
  onRetry,
  retryLabel = 'Retry',
  retrying = false,
  tone = 'error',
  className,
}: ErrorBannerProps) {
  const requestId = isApiError(error) && shouldShowRequestId(error) ? error.requestId : null;

  return (
    <div
      role="alert"
      className={cx(
        'flex flex-col gap-3 rounded-xl border p-3 text-sm sm:flex-row sm:items-start sm:justify-between',
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-amber-200 bg-amber-50 text-amber-900',
        className,
      )}
    >
      <div className="flex gap-2">
        <span aria-hidden="true" className="mt-0.5 font-bold">
          !
        </span>
        <div>
          {title && <p className="font-semibold">{title}</p>}
          <p>{message ?? toUserMessage(error)}</p>
          {requestId && (
            <p className="mt-1 text-xs opacity-80">
              Reference: <span className="font-mono">{requestId}</span>
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} loading={retrying} className="shrink-0">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
