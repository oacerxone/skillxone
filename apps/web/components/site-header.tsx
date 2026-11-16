import Link from 'next/link';
import { formatCount } from '@/lib/format';
import { OWN_SKILL_PATH, primaryNav, REPOSITORY_URL, secondaryNav } from '@/lib/navigation';
import { GitHubIcon, LogoMark, MenuIcon, SparklesIcon, StarIcon } from './icons';
import { MobileMenu } from './mobile-menu';
import { NavLinks } from './nav-links';
import { ThemeToggle } from './theme-toggle';

/** GitHub star button. The count is the stored value from the last sync, never fetched live. */
export function StarButton({
  stars,
  className = '',
}: {
  stars: number | null;
  className?: string;
}) {
  return (
    <a
      href={REPOSITORY_URL}
      rel="noopener noreferrer"
      className={`star-btn ${className}`}
      aria-label={
        stars === null ? 'Star skillxone on GitHub' : `Star skillxone on GitHub, ${stars} stars`
      }
    >
      <GitHubIcon size={15} />
      <span className="star-btn-label">
        <StarIcon size={12} className="star-icon" />
        Star
      </span>
      {stars !== null && <span className="star-btn-count">{formatCount(stars)}</span>}
    </a>
  );
}

export function SiteHeader({ stars }: { stars: number | null }) {
  return (
    <header className="site-header header-glass sticky top-0 z-20">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4">
        <Link href="/" className="brand group flex shrink-0 items-center gap-2.5">
          <LogoMark size={28} className="brand-mark" />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-text">skillxone</span>
          <span className="beta-pill" aria-hidden="true">
            beta
          </span>
        </Link>

        <nav aria-label="Primary" className="nav-bar ml-3 hidden lg:flex">
          <NavLinks items={primaryNav} variant="bar" />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <form
            action="/explore"
            method="get"
            role="search"
            aria-label="Site search"
            className="hidden 2xl:block"
          >
            <label htmlFor="header-q" className="sr-only">
              Search skills
            </label>
            <input
              id="header-q"
              name="q"
              type="search"
              data-search-input
              autoComplete="off"
              maxLength={100}
              placeholder="Search skills  /"
              className="input h-9 w-44"
            />
          </form>
          <StarButton stars={stars} className="hidden md:inline-flex" />
          <Link
            href={OWN_SKILL_PATH}
            className="btn btn-primary btn-shine hidden h-9 gap-1.5 sm:inline-flex"
          >
            <SparklesIcon size={15} />
            Get the skill
          </Link>
          <ThemeToggle />

          <MobileMenu
            summary={
              <>
                <MenuIcon size={15} />
                Menu
              </>
            }
          >
            <nav aria-label="Menu" className="menu-panel">
              <NavLinks items={primaryNav} variant="menu" />
              <hr className="my-1 border-border" />
              <NavLinks items={secondaryNav} variant="menu" />
              <a href={REPOSITORY_URL} className="menu-link" rel="noopener noreferrer">
                <GitHubIcon size={15} className="nav-icon" />
                <span>GitHub</span>
              </a>
            </nav>
          </MobileMenu>
        </div>
      </div>
      <div className="header-line" aria-hidden="true" />
    </header>
  );
}
