export interface NavItem {
  href: string;
  label: string;
  external?: boolean;
}

/** Repository URL shown in navigation. Override at build time for forks. */
export const REPOSITORY_URL =
  process.env.NEXT_PUBLIC_REPOSITORY_URL ?? 'https://github.com/skillxone/skillxone';

export const primaryNav: NavItem[] = [
  { href: '/explore', label: 'Explore' },
  { href: '/categories', label: 'Categories' },
  { href: '/trending', label: 'Trending' },
  { href: '/verified', label: 'Verified' },
  { href: '/collections', label: 'Collections' },
  { href: '/submit', label: 'Submit Skill' },
  { href: REPOSITORY_URL, label: 'GitHub', external: true },
];

export const secondaryNav: NavItem[] = [
  { href: '/docs', label: 'Documentation' },
  { href: '/docs/api', label: 'API' },
  { href: '/contribute', label: 'Contribute' },
  { href: '/about', label: 'About' },
];
