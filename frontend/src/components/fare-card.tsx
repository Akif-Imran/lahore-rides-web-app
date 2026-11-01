import type { EstimateStatus } from '@/lib/booking-state';
import {
  CATEGORY_LABEL,
  formatDistance,
  formatDuration,
  formatEta,
  formatFare,
} from '@/lib/format';
import type { RideCategory } from '@/types/api';
import { EmptyState } from './empty-state';
import { ErrorBanner } from './error-banner';
import { FareSkeleton } from './skeletons';

export interface FareCardProps {
  estimate: EstimateStatus;
  category: RideCategory;
  onRetry: () => void;
}

/** Fare and pickup ETA for the selected category, with every loading/empty/error state. */
export function FareCard({ estimate, category, onRetry }: FareCardProps) {
  return (
    <div aria-live="polite" className="min-h-28 rounded-xl bg-slate-50 p-4" data-testid="fare-card">
      <FareCardBody estimate={estimate} category={category} onRetry={onRetry} />
    </div>
  );
}

function FareCardBody({ estimate, category, onRetry }: FareCardProps) {
  switch (estimate.status) {
    case 'idle':
      return (
        <p className="text-sm text-slate-600">
          Choose a pickup and a destination to see the fare and pickup time.
        </p>
      );
    case 'loading':
      return <FareSkeleton />;
    case 'error':
      return (
        <ErrorBanner
          title="Couldn't get a fare estimate"
          error={estimate.error}
          onRetry={onRetry}
        />
      );
    case 'success': {
      const selected = estimate.data.estimates.find((e) => e.category === category);
      const other = estimate.data.estimates.find((e) => e.category !== category);
      if (!selected) {
        return <ErrorBanner title="Couldn't get a fare estimate" error={null} onRetry={onRetry} />;
      }
      const { breakdown } = selected;
      return (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-600 uppercase">
              Estimated fare · {CATEGORY_LABEL[category]}
            </p>
            <p className="text-3xl font-bold text-slate-900" data-testid="fare-amount">
              {formatFare(selected.total)}
            </p>
            <p className="text-sm text-slate-600">
              About {formatDistance(estimate.data.distanceMeters)} ·{' '}
              {formatDuration(estimate.data.durationSeconds)} trip
            </p>
          </div>

          {selected.etaMinutes === null ? (
            <EmptyState title="No drivers nearby right now">
              {other && other.etaMinutes !== null
                ? `${CATEGORY_LABEL[other.category]} has a driver about ${formatEta(other.etaMinutes)} away.`
                : 'Please check back in a few minutes.'}
            </EmptyState>
          ) : (
            <p className="text-sm font-medium text-emerald-800" data-testid="pickup-eta">
              Pickup in about {formatEta(selected.etaMinutes)}
            </p>
          )}

          <details className="text-sm text-slate-700">
            <summary className="cursor-pointer font-medium">Fare breakdown</summary>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <dt>Base fare</dt>
              <dd className="text-right">{formatFare(breakdown.base)}</dd>
              <dt>Distance</dt>
              <dd className="text-right">{formatFare(breakdown.distance)}</dd>
              <dt>Time</dt>
              <dd className="text-right">{formatFare(breakdown.time)}</dd>
              {breakdown.surge > 1 && (
                <>
                  <dt>Surge</dt>
                  <dd className="text-right">×{breakdown.surge}</dd>
                </>
              )}
            </dl>
            {breakdown.minimumFareApplied && (
              <p className="mt-2 text-xs text-slate-600">The minimum fare applies to this trip.</p>
            )}
          </details>

          {other && (
            <p className="text-xs text-slate-600">
              {CATEGORY_LABEL[other.category]} for this trip: {formatFare(other.total)}
            </p>
          )}
        </div>
      );
    }
  }
}
