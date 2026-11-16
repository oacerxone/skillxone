import Link from 'next/link';
import {
  listCategories,
  listCollections,
  listSkills,
  metricsHistoryDays,
} from '@skillxone/database';
import { HeroIllustration } from '@/components/hero-illustration';
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
  const withSkills = categories.filter((c) => c.skillCount > 0);
  const featured = withSkills.slice(0, 8);
  const featuredCount = withSkills.length;
  const totalSkills = updated.total;

  return (
    <>
      <section
        aria-labelledby="hero-heading"
        className="relative isolate grid items-center gap-12 pb-10 pt-12 sm:pt-16 lg:grid-cols-[1.1fr_1fr]"
      >
        <div className="hero-backdrop">
          <div className="grid-lines" />
          <div className="blob blob-a" />
          <div className="blob blob-b" />
        </div>

        <div>
          <p className="reveal mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-bg/70 px-3 py-1 text-[12px] text-text-muted">
            <span className="inline-block size-1.5 rounded-full bg-verified-fg" />
            Open source · self-hostable · security reports for every assessed version
          </p>
          <h1
            id="hero-heading"
            className="reveal max-w-2xl text-[32px] font-semibold leading-[38px] tracking-[-0.02em] sm:text-[48px] sm:leading-[52px] sm:tracking-[-0.03em]"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            Find agent skills{' '}
            <span className="text-gradient">you can check before you install.</span>
          </h1>
          <p
            className="reveal mt-5 max-w-xl text-[16px] leading-[26px] text-text-muted"
            style={{ '--i': 2 } as React.CSSProperties}
          >
            An open-source index of Claude Code and Codex skills from GitHub, with a published
            security report for every assessed version.
          </p>

          <form
            action="/explore"
            method="get"
            role="search"
            aria-label="Search skills"
            className="reveal mt-8 max-w-2xl"
            style={{ '--i': 3 } as React.CSSProperties}
          >
            <div className="glow-ring">
              <div className="flex gap-2 p-1.5">
                <label htmlFor="home-q" className="sr-only">
                  Search skills
                </label>
                <span aria-hidden="true" className="flex items-center pl-2 text-text-subtle">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <circle cx="7" cy="7" r="4.5" />
                    <path d="m10.5 10.5 3 3" />
                  </svg>
                </span>
                <input
                  id="home-q"
                  name="q"
                  type="search"
                  data-search-input
                  autoComplete="off"
                  maxLength={100}
                  placeholder="Search skills by name, description or repository"
                  className="input h-11 border-transparent text-[15px] shadow-none"
                />
                <button type="submit" className="btn btn-primary h-11 px-5">
                  Search
                </button>
              </div>
            </div>
          </form>
          <div
            className="reveal mt-4 flex flex-wrap items-center gap-2 text-[13px] text-text-muted"
            style={{ '--i': 4 } as React.CSSProperties}
          >
            <span id="quick-filter-label">Browse for</span>
            <ul aria-labelledby="quick-filter-label" className="flex flex-wrap gap-2">
              {AGENT_IDS.map((id) => (
                <li key={id}>
                  <Link href={`/explore?agent=${id}`} className="chip card-lift bg-bg">
                    {AGENT_INFO[id]?.label ?? id}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/verified" className="chip card-lift bg-bg">
                  Verified only
                </Link>
              </li>
            </ul>
          </div>

          {totalSkills > 0 && (
            <dl
              className="reveal mt-8 flex flex-wrap gap-x-8 gap-y-3"
              style={{ '--i': 5 } as React.CSSProperties}
            >
              <div>
                <dt className="text-[12px] text-text-muted">Skills indexed</dt>
                <dd className="font-mono text-[22px] font-semibold leading-7">
                  {totalSkills.toLocaleString('en')}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-text-muted">Verified now</dt>
                <dd className="font-mono text-[22px] font-semibold leading-7 text-verified-fg">
                  {verified.total.toLocaleString('en')}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-text-muted">Categories</dt>
                <dd className="font-mono text-[22px] font-semibold leading-7">
                  {featuredCount.toLocaleString('en')}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="reveal pb-8 lg:pb-0" style={{ '--i': 3 } as React.CSSProperties}>
          <HeroIllustration />
        </div>
      </section>

      <section aria-labelledby="how-heading" className="mt-6">
        <h2 id="how-heading" className="sr-only">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="panel card-lift reveal-scroll flex gap-3 p-4">
              <span className="icon-tile">{step.icon}</span>
              <div>
                <p className="text-[12px] font-mono text-text-subtle">0{index + 1}</p>
                <p className="font-medium">{step.title}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
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
                  className="panel card-lift reveal-scroll flex h-full flex-col gap-2 p-4"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5">
                      <span className="icon-tile size-8 text-[13px] font-semibold uppercase">
                        <span aria-hidden="true">{category.name.slice(0, 1)}</span>
                      </span>
                      <span className="font-medium">{category.name}</span>
                    </span>
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
                  className="panel card-lift reveal-scroll flex h-full flex-col gap-1 p-4"
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
        className="cta-panel reveal-scroll mt-12 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h2 id="contribute-heading" className="text-[18px] font-semibold leading-7">
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

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 18 18',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const STEPS = [
  {
    title: 'Discover',
    body: 'Skills are indexed from public GitHub repositories and ranked by transparent signals.',
    icon: (
      <svg {...iconProps}>
        <circle cx="8" cy="8" r="5" />
        <path d="m12 12 4 4" />
      </svg>
    ),
  },
  {
    title: 'Check',
    body: 'Each version gets a static security scan and a report you can read before deciding.',
    icon: (
      <svg {...iconProps}>
        <path d="M9 1.8 15 4v4.5c0 3.6-2.4 6.1-6 7.7-3.6-1.6-6-4.1-6-7.7V4l6-2.2Z" />
        <path d="m6.3 9 2 2 3.6-3.7" />
      </svg>
    ),
  },
  {
    title: 'Install',
    body: 'Copy a pinned command for Claude Code or Codex and run it on your own machine.',
    icon: (
      <svg {...iconProps}>
        <rect x="2" y="3" width="14" height="12" rx="2" />
        <path d="m5 7 2.5 2L5 11M9.5 11H13" />
      </svg>
    ),
  },
];
