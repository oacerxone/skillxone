import { monotonicFactory } from 'ulid';

// Monotonic: ids created within the same millisecond still sort in creation order,
// which keeps "oldest first" queries (such as the job queue) deterministic.
const nextUlid = monotonicFactory();

/** New ULID: a 26-character, lexically time-sortable identifier. */
export function newId(now?: Date): string {
  return nextUlid(now?.getTime());
}
