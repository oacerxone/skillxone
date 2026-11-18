import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-parts';
import { EmptyState } from '@/components/skill-list';
import { cachedCollections } from '@/lib/catalog-cache';

export const metadata: Metadata = { title: 'Collections' };

export default async function CollectionsPage() {
  const collections = await cachedCollections();

  return (
    <>
      <PageHeader title="Collections" icon="layers">
        Curated sets of skills that work well together.
      </PageHeader>
      {collections.length === 0 ? (
        <EmptyState title="No collections published yet" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {collections.map((collection) => (
            <li key={collection.slug}>
              <Link
                href={`/collections/${collection.slug}`}
                className="panel flex h-full flex-col gap-1 p-3 hover:bg-bg-subtle"
              >
                <span className="font-medium">{collection.title}</span>
                <span className="text-[13px] leading-5 text-text-muted">
                  {collection.description}
                </span>
                <span className="text-[12px] text-text-subtle">{collection.skillCount} skills</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
