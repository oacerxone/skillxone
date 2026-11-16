/** Presentation helpers. Pure functions, safe to use in server and client components. */

/** 1240 -> "1.2k", 950 -> "950". */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(Math.floor(value / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`;
  if (value < 1_000_000) return `${Math.floor(value / 1000)}k`;
  return `${(Math.floor(value / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "2026-06-01" style date in UTC, stable between server and client. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
}

const UNITS: Array<[limit: number, divisor: number, unit: string]> = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86_400, 3600, 'hour'],
  [86_400 * 30, 86_400, 'day'],
  [86_400 * 365, 86_400 * 30, 'month'],
  [Infinity, 86_400 * 365, 'year'],
];

/** "3 days ago". Computed on the server at render time. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return 'just now';
  for (const [limit, divisor, unit] of UNITS) {
    if (seconds < limit) {
      const n = Math.max(1, Math.floor(seconds / divisor));
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'unknown';
}

export interface TextSegment {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into matching and non-matching segments for search highlighting.
 * Returns plain data: the caller renders `<mark>` elements, so no HTML is built from input.
 */
export function highlightSegments(text: string, terms: readonly string[]): TextSegment[] {
  const cleaned = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (cleaned.length === 0 || text.length === 0) return [{ text, match: false }];

  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const term of cleaned) {
    let from = 0;
    for (;;) {
      const index = lower.indexOf(term, from);
      if (index === -1) break;
      marks.fill(true, index, index + term.length);
      from = index + term.length;
    }
  }

  const segments: TextSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || marks[i] !== marks[start]) {
      segments.push({ text: text.slice(start, i), match: marks[start] === true });
      start = i;
    }
  }
  return segments;
}
