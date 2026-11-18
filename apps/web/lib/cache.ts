/**
 * A small in-process cache for read-mostly catalog queries.
 *
 * The catalog changes only when the worker finishes a job, so a page does not need to
 * re-run every query on every request. Values are served fresh for `ttlMs`; after that the
 * stale value is still returned at once while one background refresh runs, so a visitor
 * never waits on a refresh that someone else's request already triggered. Concurrent
 * misses for the same key share one computation. Errors are never cached.
 *
 * The cache holds only public catalog data. Nothing per-user or secret may be stored here.
 */

interface Entry<T> {
  value?: T;
  storedAt: number;
  pending?: Promise<T>;
}

const MAX_ENTRIES = 500;

const store = globalThis as typeof globalThis & { __skillxoneCache?: Map<string, Entry<unknown>> };

function entries(): Map<string, Entry<unknown>> {
  store.__skillxoneCache ??= new Map();
  return store.__skillxoneCache;
}

function refresh<T>(key: string, entry: Entry<T>, load: () => Promise<T>, now: () => number) {
  // Promise.resolve().then turns a synchronous throw in `load` into a rejection.
  const pending = Promise.resolve()
    .then(load)
    .then(
      (value) => {
        entry.value = value;
        entry.storedAt = now();
        entry.pending = undefined;
        return value;
      },
      (error: unknown) => {
        entry.pending = undefined;
        // A failed first load leaves nothing to serve; drop the entry so the next call retries.
        if (entry.value === undefined) entries().delete(key);
        throw error;
      },
    );
  entry.pending = pending;
  return pending;
}

/**
 * Returns the cached value for `key`, loading it with `load` when absent. A value older than
 * `ttlMs` is returned as is while a single refresh runs in the background.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const map = entries();
  const existing = map.get(key) as Entry<T> | undefined;

  if (existing && existing.value !== undefined) {
    // Re-insert so the map's order tracks recent use for eviction.
    map.delete(key);
    map.set(key, existing);
    if (now() - existing.storedAt >= ttlMs && !existing.pending) {
      // Background refresh; a failure keeps the stale value and is retried next time.
      refresh(key, existing, load, now).catch(() => undefined);
    }
    return existing.value;
  }
  if (existing?.pending) return existing.pending;

  const entry: Entry<T> = { storedAt: 0 };
  map.set(key, entry as Entry<unknown>);
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return refresh(key, entry, load, now);
}

/** Empties the cache. Used by tests. */
export function clearCache(): void {
  entries().clear();
}
