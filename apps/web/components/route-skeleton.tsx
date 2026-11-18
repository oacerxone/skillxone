/**
 * Skeleton for listing pages while they render on the server (used by their loading.tsx).
 * Only routes that never answer 404 or 401 get a loading.tsx: a loading boundary makes
 * Next.js stream the response early, which would turn a not-found page into a 200.
 */
export function RouteSkeleton() {
  return (
    <div role="status" aria-live="polite" className="py-10">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true">
        <div className="skeleton mb-3 h-4 w-28 rounded-full" />
        <div className="skeleton mb-3 h-9 w-full max-w-[420px] rounded-lg" />
        <div className="skeleton mb-10 h-4 w-full max-w-[560px] rounded-full" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="panel flex gap-3 p-4">
              <div className="skeleton size-10 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-2/3 rounded-full" />
                <div className="skeleton h-3 w-full rounded-full" />
                <div className="skeleton h-3 w-4/5 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
