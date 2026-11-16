import Link from 'next/link';

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="pb-6 pt-8">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.015em]">{title}</h1>
      {children && <div className="mt-2 max-w-2xl text-text-muted">{children}</div>}
    </header>
  );
}

export function Section({
  id,
  title,
  href,
  linkLabel,
  note,
  children,
}: {
  id: string;
  title: string;
  href?: string;
  linkLabel?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-14">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <h2 id={id} className="text-[20px] font-semibold leading-7">
            {title}
          </h2>
          {note && <p className="text-[13px] leading-5 text-text-muted">{note}</p>}
        </div>
        {href && (
          <Link href={href} className="link shrink-0 text-[13px]">
            {linkLabel ?? 'View all'}
            <span className="sr-only"> {title}</span>
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  // First, last and a window around the current page; gaps are shown as an ellipsis.
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center gap-1">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className="chip" rel="prev">
          Previous
        </Link>
      )}
      {pages.map((p, index) => (
        <span key={p} className="flex items-center gap-1">
          {index > 0 && p - (pages[index - 1] ?? p) > 1 && (
            <span aria-hidden="true" className="px-1 text-text-subtle">
              …
            </span>
          )}
          <Link
            href={hrefFor(p)}
            className="chip"
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </Link>
        </span>
      ))}
      {page < pageCount && (
        <Link href={hrefFor(page + 1)} className="chip" rel="next">
          Next
        </Link>
      )}
    </nav>
  );
}
