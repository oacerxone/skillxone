/** Injectable clock so time-dependent logic can be tested deterministically. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/**
 * Timestamps are stored as ISO-8601 UTC text with millisecond precision.
 * The fixed width makes lexical comparison equal to chronological comparison.
 */
export function toIso(date: Date): string {
  return date.toISOString();
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}
