'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { agentLabel } from '@/lib/install';
import { PRO_SORTS, STAR_OPTIONS, UPDATED_OPTIONS, buildExploreQuery } from '@/lib/search-params';
import type { ExploreFilters as Filters } from '@/lib/search-params';

interface Props {
  filters: Filters;
  agents: string[];
  categories: Array<{ slug: string; name: string }>;
  licenses: string[];
  /** Pro filters are shown but disabled for viewers without Pro (only when billing is on). */
  locked: boolean;
}

const UPDATED_LABEL: Record<number, string> = {
  0: 'Any time',
  30: 'Last 30 days',
  90: 'Last 90 days',
  365: 'Last year',
};

const DEBOUNCE_MS = 250;

/**
 * Search and filter controls for Explore. All state lives in the URL, so results are
 * shareable and survive a reload. The controls are a plain GET form: without JavaScript
 * the Search button submits it; with JavaScript, changes apply as you type or select.
 */
export function ExploreFilters({ filters, agents, categories, licenses, locked }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const latest = useRef(filters);
  latest.current = filters;

  // Keep the field in step when the URL changes from outside (back/forward, links).
  useEffect(() => {
    setQuery(filters.q);
  }, [filters.q]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function apply(overrides: Partial<Filters>) {
    // Any change to the filters returns to the first page.
    const target = `/explore${buildExploreQuery(latest.current, { page: 1, ...overrides })}`;
    startTransition(() => router.replace(target, { scroll: false }));
  }

  // Name completions, offered through a native <datalist> so they work with the keyboard
  // and screen readers without custom listbox code. Failures are ignored: suggestions are
  // a convenience, never required.
  async function loadSuggestions(value: string) {
    if (value.length < 2) return setSuggestions([]);
    try {
      const response = await fetch(`/api/v1/suggest?q=${encodeURIComponent(value)}`);
      if (!response.ok) return;
      const body = (await response.json()) as { data?: Array<{ name?: unknown }> };
      const names = (body.data ?? []).flatMap((item) =>
        typeof item.name === 'string' ? [item.name] : [],
      );
      setSuggestions([...new Set(names)]);
    } catch {
      /* offline or rate limited */
    }
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      apply({ q: value.trim() });
      void loadSuggestions(value.trim());
    }, DEBOUNCE_MS);
  }

  return (
    <form
      action="/explore"
      method="get"
      role="search"
      aria-label="Search skills"
      aria-busy={pending}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        apply({ q: query.trim() });
      }}
    >
      <div className="sm:col-span-2 lg:col-span-1">
        <label htmlFor="explore-q" className="label">
          Search <kbd className="ml-1 rounded-sm border border-border px-1 font-mono">/</kbd>
        </label>
        <input
          id="explore-q"
          name="q"
          type="search"
          data-search-input
          list="explore-suggestions"
          autoComplete="off"
          maxLength={100}
          placeholder="Name, description or repository"
          className="input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <datalist id="explore-suggestions">
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      <div>
        <label htmlFor="explore-agent" className="label">
          Agent{locked && <ProTag />}
        </label>
        <select
          id="explore-agent"
          name="agent"
          className="input"
          disabled={locked}
          value={filters.agent}
          onChange={(event) => apply({ agent: event.target.value })}
        >
          <option value="">Any agent</option>
          {agents.map((agent) => (
            <option key={agent} value={agent}>
              {agentLabel(agent)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="explore-verification" className="label">
          Verification
        </label>
        <select
          id="explore-verification"
          name="verification"
          className="input"
          value={filters.verification.toLowerCase()}
          onChange={(event) =>
            apply({ verification: event.target.value.toUpperCase() as Filters['verification'] })
          }
        >
          <option value="">Any status</option>
          <option value="verified">Verified</option>
          <option value="unverified">Unverified</option>
          <option value="flagged">Flagged</option>
        </select>
      </div>

      <div>
        <label htmlFor="explore-category" className="label">
          Category
        </label>
        <select
          id="explore-category"
          name="category"
          className="input"
          value={filters.category}
          onChange={(event) => apply({ category: event.target.value })}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="explore-sort" className="label">
          Sort by
        </label>
        <select
          id="explore-sort"
          name="sort"
          className="input"
          value={filters.sort}
          onChange={(event) => apply({ sort: event.target.value as Filters['sort'] })}
        >
          <option value="">{filters.q ? 'Best match' : 'Recommended'}</option>
          <option value="popular">Most stars</option>
          <option value="trending">Trending</option>
          {(['rising', 'maintained'] as const).map((sort) => (
            <option key={sort} value={sort} disabled={locked && PRO_SORTS.includes(sort)}>
              {sort === 'rising' ? 'Rising' : 'Best maintained'}
              {locked ? ' (Pro)' : ''}
            </option>
          ))}
          <option value="updated">Recently updated</option>
          <option value="newest">Newly added</option>
          <option value="name">Name</option>
        </select>
      </div>

      {filters.view === 'cards' && <input type="hidden" name="view" value="cards" />}

      <div className="flex items-end">
        <button type="submit" className="btn btn-primary w-full">
          Search
        </button>
      </div>

      <fieldset
        className="grid gap-3 rounded-lg border border-border p-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-6 lg:grid-cols-4"
        disabled={locked}
        aria-describedby={locked ? 'explore-pro-note' : undefined}
      >
        <legend className="px-1 text-[12px] font-medium text-text-muted">
          Advanced filters{locked && <ProTag />}
        </legend>
        <div>
          <label htmlFor="explore-stars" className="label">
            Repository stars
          </label>
          <select
            id="explore-stars"
            name="stars"
            className="input"
            value={filters.minStars}
            onChange={(event) => apply({ minStars: Number(event.target.value) })}
          >
            {STAR_OPTIONS.map((stars) => (
              <option key={stars} value={stars}>
                {stars === 0 ? 'Any' : `${stars.toLocaleString('en')}+`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="explore-license" className="label">
            Licence
          </label>
          <select
            id="explore-license"
            name="license"
            className="input"
            value={filters.license}
            onChange={(event) => apply({ license: event.target.value })}
          >
            <option value="">Any licence</option>
            {licenses.map((license) => (
              <option key={license} value={license}>
                {license}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="explore-updated" className="label">
            Updated
          </label>
          <select
            id="explore-updated"
            name="updated"
            className="input"
            value={filters.updatedDays}
            onChange={(event) => apply({ updatedDays: Number(event.target.value) })}
          >
            {UPDATED_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {UPDATED_LABEL[days]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-text">
          <input
            type="checkbox"
            name="scripts"
            value="none"
            checked={filters.noScripts}
            onChange={(event) => apply({ noScripts: event.target.checked })}
          />
          Instructions only (no scripts)
        </label>
        {locked && (
          <p
            id="explore-pro-note"
            className="text-[12px] text-text-muted sm:col-span-2 lg:col-span-4"
          >
            Agent, stars, licence, update date, script-free and score sorts are part of{' '}
            <a href="/pricing" className="link">
              skillxone Pro
            </a>
            . Search, categories and verification status stay free.
          </p>
        )}
      </fieldset>
    </form>
  );
}

function ProTag() {
  return (
    <span className="ml-1.5 rounded-sm border border-accent/40 px-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
      Pro
    </span>
  );
}
