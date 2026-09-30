// Human-readable numbers, matching `human_bytes` / `human_speed` in the apps'
// shared kit so the popup shows exactly what the apps show.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(bytes)} B`;
  if (v >= 100) return `${v.toFixed(0)} ${UNITS[i]}`;
  if (v >= 10) return `${v.toFixed(1)} ${UNITS[i]}`;
  return `${v.toFixed(2)} ${UNITS[i]}`;
}

export function humanSpeed(bps) {
  if (!Number.isFinite(bps) || bps < 1) return '—';
  return `${humanBytes(bps)}/s`;
}

/** 0.4213 → "42%"; null/undefined → "". */
export function percent(fraction) {
  if (!Number.isFinite(fraction)) return '';
  return `${Math.floor(Math.min(Math.max(fraction, 0), 1) * 100)}%`;
}

/** Milliseconds → "4:05". */
export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Splits a byte count into the most natural {value, unit} for the size input. */
export function splitSize(bytes) {
  if (!bytes) return { value: 0, unit: 'KB' };
  if (bytes % (1024 * 1024) === 0) return { value: bytes / (1024 * 1024), unit: 'MB' };
  return { value: Math.round((bytes / 1024) * 100) / 100, unit: 'KB' };
}

export function joinSize(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * (unit === 'MB' ? 1024 * 1024 : 1024));
}
