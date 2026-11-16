import Link from 'next/link';
import {
  listCategories,
  listCollections,
  listSkills,
  metricsHistoryDays,
} from '@skillxone/database';
import { Section } from '@/components/page-parts';
import { EmptyState, SkillList } from '@/components/skill-list';
import { getDatabase } from '@/lib/db';
import { AGENT_IDS, AGENT_INFO } from '@/lib/install';
import { REPOSITORY_URL } from '@/lib/navigation';
import { MIN_TREND_HISTORY_DAYS } from '@/lib/trending';

export default async function HomePage() {
  const { db } = await getDatabase();
  const now = new Date();
  // Trending is computed from star history this instance has recorded itself. Until a week
  // exists, the section is ordered by recent activity and labelled as such.
  const trendingReady = (await metricsHistoryDays(db)) >= MIN_TREND_HISTORY_DAYS;
  const [active, verified, updated, categories, collections] = await Promise.all([
    listSkills(db, { sort: trendingReady ? 'trending' : 'updated', pageSize: 8 }),
    listSkills(db, { verification: 'VERIFIED', sort: 'recommended', pageSize: 6 }),
    listSkills(db, { sort: 'newest', pageSize: 6 }),
    listCategories(db),
    listCollections(db),
  ]);
  const featured = categories.filter((c) => c.skillCount > 0).slice(0, 8);

  return (
    <>
      <section aria-labelledby="hero-heading" className="pb-2 pt-12">
        <h1
          id="hero-heading"
          className="max-w-2xl text-[28px] font-semibold leading-[34px] tracking-[-0.015em] sm:text-[40px] sm:leading-[44px] sm:tracking-[-0.02em]"
        >
          Find agent skills you can check before you install.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-[24px] text-text-muted">
          An open-source index of Claude Code and Codex skills from GitHub, with a published
          security report for every assessed version.
        </p>

        <form
          action="/explore"
          method="get"
          role="search"
          aria-label="Search skills"
          className="mt-8 flex max-w-2xl gap-2"
        >
          <label htmlFor="home-q" className="sr-only">
            Search skills
          </label>
          <input
            id="home-q"
            name="q"
            type="search"
            data-search-input
            autoComplete="off"
            maxLength={100}
            placeholder="Search skills by name, description or repository"
            className="input h-12 text-[15px]"
          />
          <button type="submit" className="btn btn-primary h-12 px-5">
            Search
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
          <span id="quick-filter-label">Browse for</span>
          <ul aria-labelledby="quick-filter-label" className="flex flex-wrap gap-2">
            {AGENT_IDS.map((id) => (
              <li key={id}>
                <Link href={`/explore?agent=${id}`} className="chip">
                  {AGENT_INFO[id].label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/verified" className="chip">
                Verified only
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <Section
        id="active-heading"
        title={trendingReady ? 'Trending' : 'Recently active'}
        note={
          trendingReady
            ? 'Fastest star growth over the last 7 days, from recorded history.'
            : 'Ordered by latest content change. Trending appears after a week of recorded star history.'
        }
        href="/trending"
      >
        {active.items.length > 0 ? (
          <SkillList skills={active.items} now={now} />
        ) : (
          <EmptyState title="No skills indexed yet">
            Skills appear here once repositories have been indexed.
          </EmptyState>
        )}
      </Section>

      {featured.length > 0 && (
        <Section id="categories-heading" title="Categories" href="/categories">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((category) => (
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
                  <span className="text-[13px] leading-5 text-text-muted">
                    {category.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {verified.items.length > 0 && (
        <Section
          id="verified-heading"
          title="Verified"
          note="The current version passed the published verification policy."
          href="/verified"
        >
          <SkillList skills={verified.items} now={now} />
        </Section>
      )}

      {updated.items.length > 0 && (
        <Section id="new-heading" title="Newly added" href="/explore?sort=newest">
          <SkillList skills={updated.items} now={now} />
        </Section>
      )}

      {collections.length > 0 && (
        <Section id="collections-heading" title="Collections" href="/collections">
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
                  <span className="text-[12px] text-text-subtle">
                    {collection.skillCount} skills
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <section
        aria-labelledby="contribute-heading"
        className="mt-10 flex flex-col gap-3 rounded-md border border-border bg-bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h2 id="contribute-heading" className="text-[16px] font-semibold leading-6">
            Built in the open
          </h2>
          <p className="text-[13px] leading-5 text-text-muted">
            Add a skill repository, improve a security rule, or run your own instance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/submit" className="btn btn-primary">
            Submit a skill
          </Link>
          <a href={REPOSITORY_URL} className="btn" rel="noopener noreferrer">
            Contribute on GitHub
          </a>
        </div>
      </section>
    </>
  );
}
