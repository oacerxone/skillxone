import type { Metadata } from 'next';
import Link from 'next/link';
import { listCategories } from '@skillxone/database';
import { PageHeader } from '@/components/page-parts';
import { getDatabase } from '@/lib/db';

export const metadata: Metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  const { db } = await getDatabase();
  const categories = await listCategories(db);

  return (
    <>
      <PageHeader title="Categories">Browse skills by what they help with.</PageHeader>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={`/categories/${category.slug}`}
              className="panel flex h-full flex-col gap-1 p-3 hover:bg-bg-subtle"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{category.name}</span>
                <span className="font-mono text-[12px] text-text-muted">
                  {category.skillCount}
                  <span className="sr-only"> skills</span>
                </span>
              </span>
              <span className="text-[13px] leading-5 text-text-muted">{category.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
