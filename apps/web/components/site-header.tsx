import Link from 'next/link';
import { primaryNav, secondaryNav } from '@/lib/navigation';
import type { NavItem } from '@/lib/navigation';
import { MobileMenu } from './mobile-menu';
import { ThemeToggle } from './theme-toggle';

function NavLink({ item, className }: { item: NavItem; className: string }) {
  if (item.external) {
    return (
      <a href={item.href} className={className} rel="noopener noreferrer">
        {item.label}
      </a>
    );
  }
  return (
    <Link href={item.href} className={className}>
      {item.label}
    </Link>
  );
}

const desktopLink =
  'rounded-sm px-2 py-1 text-[13px] text-text-muted transition-colors duration-100 hover:text-text';
const mobileLink = 'block rounded-sm px-3 py-2 text-text hover:bg-bg-muted';

export function SiteHeader() {
  return (
    <header className="header-glass sticky top-0 z-20 border-b border-border">
      <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-text">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
            <rect x="1" y="1" width="16" height="16" rx="4" fill="var(--accent)" />
            <path
              d="M5.5 6.5 9 4.5l3.5 2M5.5 9.5 9 11.5l3.5-2M5.5 12.5 9 14.5"
              fill="none"
              stroke="var(--accent-fg)"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          skillxone
        </Link>

        <nav aria-label="Primary" className="hidden flex-1 items-center gap-1 md:flex">
          {primaryNav.map((item) => (
            <NavLink key={item.href} item={item} className={desktopLink} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <form
            action="/explore"
            method="get"
            role="search"
            aria-label="Site search"
            className="hidden xl:block"
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
              className="input w-52"
            />
          </form>
          <ThemeToggle />

          <MobileMenu>
            <nav
              aria-label="Menu"
              className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-bg p-1 shadow-lg"
            >
              {primaryNav.map((item) => (
                <NavLink key={item.href} item={item} className={mobileLink} />
              ))}
              <hr className="my-1 border-border" />
              {secondaryNav.map((item) => (
                <NavLink key={item.href} item={item} className={mobileLink} />
              ))}
            </nav>
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}
