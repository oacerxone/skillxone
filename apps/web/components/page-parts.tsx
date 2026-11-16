import Link from 'next/link';
import type { NavIcon as NavIconName } from '@/lib/navigation';
import { CategoryTile, categoryArt } from './art';
import { NavIcon } from './nav-icon';

const ICON_ART: Partial<Record<NavIconName, [string, string]>> = {
  compass: ['art-1', 'art-6'],
  grid: ['art-5', 'art-1'],
  flame: ['art-8', 'art-4'],
  shield: ['art-7', 'art-2'],
  layers: ['art-6', 'art-5'],
  upload: ['art-2', 'art-6'],
  info: ['art-6', 'art-1'],
  book: ['art-3', 'art-8'],
  heart: ['art-4', 'art-5'],
  code: ['art-1', 'art-5'],
  flag: ['art-4', 'art-8'],
  sparkles: ['art-5', 'art-1'],
};

/**
 * Page title with an illustrated banner: an icon tile (or the category's art), a soft grid
 * and glow, and a large faint watermark icon. All decoration is aria-hidden.
 */
export function PageHeader({
  title,
  children,
  icon,
  category,
}: {
  title: string;
  children?: React.ReactNode;
  icon?: NavIconName;
  category?: string;
}) {
  const [a1, a2] = category
    ? [categoryArt(category).art, categoryArt(category).art2]
    : (icon && ICON_ART[icon]) || ['art-1', 'art-5'];
  const Watermark = category ? categoryArt(category).icon : null;
  return (
    <header
      className="page-banner pb-8 pt-10"
      style={{ '--a1': `var(--${a1})`, '--a2': `var(--${a2})` } as React.CSSProperties}
    >
      {(icon || category) && (
        <span className="page-banner-icon hidden sm:block" aria-hidden="true">
          {Watermark ? <Watermark size={150} /> : icon && <NavIcon name={icon} size={150} />}
        </span>
      )}
      <div className="flex items-start gap-4">
        {category ? (
          <span className="reveal">
            <CategoryTile slug={category} size={48} />
          </span>
        ) : (
          icon && (
            <span aria-hidden="true" className="art-tile reveal" style={{ width: 48, height: 48 }}>
              <NavIcon name={icon} size={23} />
            </span>
          )
        )}
        <div className="min-w-0">
          <h1
            className="reveal text-[28px] font-semibold leading-[34px] tracking-[-0.02em] sm:text-[32px] sm:leading-[38px]"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            {title}
          </h1>
          {children && (
            <div
              className="reveal mt-2 max-w-2xl text-[15px] leading-6 text-text-muted"
              style={{ '--i': 2 } as React.CSSProperties}
            >
              {children}
            </div>
          )}
        </div>
      </div>
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
