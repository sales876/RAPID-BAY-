import { BUSINESS } from './config';

/**
 * All time handling is timezone-aware against the branch timezone so that the
 * "business day" boundary is the car wash's midnight, not the browser's.
 */

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: BUSINESS.timezone,
});

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: BUSINESS.timezone,
});

const longDateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: BUSINESS.timezone,
});

/** `10:32 AM` in branch time. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return timeFmt.format(d).toUpperCase();
}

/** `2026-08-18` in branch time — the business date key. */
export function businessDate(input: Date | string = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return dateFmt.format(d);
}

export function formatLongDate(dateKey: string): string {
  // Interpret a bare date key at midday to avoid offset-induced day slips.
  return longDateFmt.format(new Date(`${dateKey}T12:00:00Z`));
}

export function todayKey(): string {
  return businessDate(new Date());
}

export function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `18:42` / `04:21`. Always mm:ss so the digits do not jump around. */
export function formatCountdown(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** `35 min`, `1h 15m`. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Human phrasing for "when can this worker take another car". */
export function formatAvailability(seconds: number): string {
  if (seconds <= 0) return 'Available now';
  const minutes = Math.ceil(seconds / 60);
  if (minutes === 1) return 'Available in ~1 minute';
  if (minutes < 60) return `Available in ~${minutes} minutes`;
  return `Available in ~${formatMinutes(minutes)}`;
}

/** `4 min under target` / `8 min over target`. */
export function formatPerformance(delta: number | null): string {
  if (delta === null) return '—';
  const m = Math.abs(Math.round(delta));
  if (m === 0) return 'On target';
  return delta < 0 ? `${m} min under target` : `${m} min over target`;
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000;
}
