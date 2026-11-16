import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCollection } from '@skillxone/database';
import { PageHeader } from '@/components/page-parts';
import { EmptyState, SkillList } from '@/components/skill-list';
import { getDatabase } from '@/lib/db';

interface Props {
  params: Promise<{ slug: string }>;
}

async function load(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return undefined;
  const { db } = await getDatabase();
  return getCollection(db, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const collection = await load((await params).slug);
  return { title: collection ? `${collection.title} collection` : 'Collection not found' };
}

export default async function CollectionPage({ params }: Props) {
  const collection = await load((await params).slug);
  if (!collection) notFound();

  return (
    <>
      <PageHeader title={collection.title}>{collection.description}</PageHeader>
      {collection.skills.length === 0 ? (
        <EmptyState title="This collection is empty" />
      ) : (
        <SkillList skills={collection.skills} />
      )}
    </>
  );
}
