import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCategory } from '@skillxone/database';
import { SkillListingPage } from '@/components/skill-listing-page';
import { getDatabase } from '@/lib/db';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function load(slug: string) {
  // Category slugs are a fixed shape; anything else cannot exist.
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return undefined;
  const { db } = await getDatabase();
  return getCategory(db, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = await load((await params).slug);
  return { title: category ? `${category.name} skills` : 'Category not found' };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const category = await load((await params).slug);
  if (!category) notFound();

  return (
    <SkillListingPage
      title={category.name}
      intro={category.description}
      query={{ category: category.slug, sort: 'recommended' }}
      basePath={`/categories/${category.slug}`}
      rawPage={(await searchParams).page}
      emptyTitle="No skills in this category yet"
    >
      <p className="mb-4 text-[13px]">
        <Link href={`/explore?category=${category.slug}`} className="link">
          Search and filter within {category.name}
        </Link>
      </p>
    </SkillListingPage>
  );
}
