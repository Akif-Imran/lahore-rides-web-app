import { describe, expect, it } from 'vitest';
import { formatAgo, formatDistance, formatDuration, formatEta, formatFare } from '@/lib/format';

describe('format helpers', () => {
  it('formats whole rupees with grouping', () => {
    expect(formatFare(640)).toBe('Rs 640');
    expect(formatFare(1240)).toBe('Rs 1,240');
  });

  it('formats distances in metres below 1 km, else km with one decimal', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(7240)).toBe('7.2 km');
  });

  it('formats durations in minutes, never below 1 min', () => {
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(1080)).toBe('18 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(4500)).toBe('1 h 15 min');
    expect(formatEta(0)).toBe('1 min');
    expect(formatEta(4)).toBe('4 min');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-11-01T10:00:00Z');
    expect(formatAgo('2026-11-01T09:59:40Z', now)).toBe('just now');
    expect(formatAgo('2026-11-01T09:57:00Z', now)).toBe('3 min ago');
    expect(formatAgo('2026-11-01T07:00:00Z', now)).toBe('3 h ago');
  });
});
