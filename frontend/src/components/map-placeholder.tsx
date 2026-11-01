import { SERVICE_AREA } from '@/lib/config';
import { cx } from '@/lib/cx';
import { fitBounds, type LatLng, project } from '@/lib/map-projection';

const SIZE = { width: 400, height: 300 };
const GRID_STEP = 40;
/** Approximate width of one 11px label character, for keeping labels inside the frame. */
const LABEL_CHAR_WIDTH = 6.2;

export interface MapPoint extends LatLng {
  name: string;
}

export interface MapPlaceholderProps {
  pickup?: MapPoint | null;
  destination?: MapPoint | null;
  driver?: LatLng | null;
  className?: string;
}

function shorten(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * A stand-in for a real map (a documented simplification): pins are placed by projecting
 * their coordinates, with no streets or tiles.
 */
export function MapPlaceholder({ pickup, destination, driver, className }: MapPlaceholderProps) {
  const points = [pickup, destination, driver].filter((p): p is LatLng => !!p);
  const bounds = fitBounds(points, SIZE, SERVICE_AREA);
  const at = (p: LatLng) => project(p, bounds, SIZE);

  const description = [
    pickup ? `Pickup: ${pickup.name}` : null,
    destination ? `Destination: ${destination.name}` : null,
    driver ? 'Driver position shown' : null,
  ]
    .filter(Boolean)
    .join('. ');

  /** Places a pin's label so it does not sit on the route line to the other pin. */
  const label = (point: MapPoint, text: string, other: LatLng | null | undefined) => {
    const p = at(point);
    const o = other ? at(other) : null;
    const common = {
      className: 'fill-slate-800 text-[11px] font-semibold',
      stroke: 'white',
      strokeWidth: 3,
      paintOrder: 'stroke' as const,
    };

    if (o && Math.abs(o.x - p.x) > Math.abs(o.y - p.y)) {
      // Mostly horizontal route: label above the pin (below it near the top edge), centred
      // and kept inside the frame.
      const half = (text.length * LABEL_CHAR_WIDTH) / 2;
      const x = Math.min(Math.max(p.x, half + 4), SIZE.width - half - 4);
      return (
        <text x={x} y={p.y > 28 ? p.y - 16 : p.y + 26} textAnchor="middle" {...common}>
          {text}
        </text>
      );
    }

    // Mostly vertical route (or a single pin): label beside the pin, towards the open side.
    const anchorEnd = p.x > SIZE.width * 0.6;
    return (
      <text
        x={anchorEnd ? p.x - 14 : p.x + 14}
        y={p.y + 4}
        textAnchor={anchorEnd ? 'end' : 'start'}
        {...common}
      >
        {text}
      </text>
    );
  };

  return (
    <figure
      className={cx('overflow-hidden rounded-2xl border border-slate-200 bg-white', className)}
    >
      <svg
        viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
        role="img"
        aria-label={`Map placeholder. ${description || 'No locations chosen yet.'}`}
        className="block h-auto w-full"
      >
        <rect width={SIZE.width} height={SIZE.height} className="fill-slate-100" />
        {Array.from({ length: SIZE.width / GRID_STEP + 1 }, (_, i) => (
          <line
            key={`v${i}`}
            x1={i * GRID_STEP}
            x2={i * GRID_STEP}
            y1={0}
            y2={SIZE.height}
            className="stroke-slate-200"
          />
        ))}
        {Array.from({ length: SIZE.height / GRID_STEP + 1 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            x2={SIZE.width}
            y1={i * GRID_STEP}
            y2={i * GRID_STEP}
            className="stroke-slate-200"
          />
        ))}

        {pickup && destination && (
          <line
            x1={at(pickup).x}
            y1={at(pickup).y}
            x2={at(destination).x}
            y2={at(destination).y}
            className="stroke-slate-500"
            strokeWidth={3}
            strokeDasharray="6 6"
            strokeLinecap="round"
          />
        )}

        {driver && (
          <g data-testid="map-driver">
            <circle
              cx={at(driver).x}
              cy={at(driver).y}
              r={14}
              className="animate-ping fill-sky-500/30 motion-reduce:animate-none"
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
            <circle
              cx={at(driver).x}
              cy={at(driver).y}
              r={8}
              className="fill-sky-600 stroke-white"
              strokeWidth={3}
            />
          </g>
        )}

        {pickup && (
          <g data-testid="map-pickup">
            <circle cx={at(pickup).x} cy={at(pickup).y} r={10} className="fill-emerald-700" />
            <text
              x={at(pickup).x}
              y={at(pickup).y + 4}
              textAnchor="middle"
              className="fill-white text-[11px] font-bold"
            >
              A
            </text>
            {label(pickup, shorten(pickup.name), destination)}
          </g>
        )}

        {destination && (
          <g data-testid="map-destination">
            <rect
              x={at(destination).x - 10}
              y={at(destination).y - 10}
              width={20}
              height={20}
              rx={4}
              className="fill-slate-900"
            />
            <text
              x={at(destination).x}
              y={at(destination).y + 4}
              textAnchor="middle"
              className="fill-white text-[11px] font-bold"
            >
              B
            </text>
            {label(destination, shorten(destination.name), pickup)}
          </g>
        )}
      </svg>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold">Map placeholder</span>
        <span>A pickup · B destination{driver ? ' · blue dot driver' : ''}</span>
      </figcaption>
    </figure>
  );
}
