'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { agentLabel } from '@/lib/install';
import { buildExploreQuery } from '@/lib/search-params';
import type { ExploreFilters as Filters } from '@/lib/search-params';

interface Props {
  filters: Filters;
  agents: string[];
  categories: Array<{ slug: string; name: string }>;
}

const DEBOUNCE_MS = 250;

/**
 * Search and filter controls for Explore. All state lives in the URL, so results are
 * shareable and survive a reload. The controls are a plain GET form: without JavaScript
 * the Search button submits it; with JavaScript, changes apply as you type or select.
 */
export function ExploreFilters({ filters, agents, categories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  function onQueryChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: value.trim() }), DEBOUNCE_MS);
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
          autoComplete="off"
          maxLength={100}
          placeholder="Name, description or repository"
          className="input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="explore-agent" className="label">
          Agent
        </label>
        <select
          id="explore-agent"
          name="agent"
          className="input"
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
          <option value="popular">Most stars</option>
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
    </form>
  );
}
