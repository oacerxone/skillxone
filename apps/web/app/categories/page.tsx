import type { Metadata } from 'next';
import Link from 'next/link';
import { CategoryTile, categoryArt } from '@/components/art';
import { PageHeader } from '@/components/page-parts';
import { cachedCategories } from '@/lib/catalog-cache';

export const metadata: Metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  const categories = await cachedCategories();

  return (
    <>
      <PageHeader title="Categories" icon="grid">
        Browse skills by what they help with.
      </PageHeader>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={`/categories/${category.slug}`}
              className="panel card-lift category-card reveal-scroll flex h-full gap-4 p-5"
              style={{ '--a1': `var(--${categoryArt(category.slug).art})` } as React.CSSProperties}
            >
              <CategoryTile slug={category.slug} size={44} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{category.name}</span>
                  <span className="rounded-full bg-bg-muted px-2 font-mono text-[12px] text-text-muted">
                    {category.skillCount}
                    <span className="sr-only"> skills</span>
                  </span>
                </span>
                <span className="text-[13px] leading-5 text-text-muted">
                  {category.description}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
