export type NavIcon =
  | 'compass'
  | 'grid'
  | 'flame'
  | 'shield'
  | 'layers'
  | 'upload'
  | 'sparkles'
  | 'book'
  | 'code'
  | 'heart'
  | 'info'
  | 'flag'
  | 'github';

export interface NavItem {
  href: string;
  label: string;
  icon?: NavIcon;
  external?: boolean;
}

/** Repository URL shown in navigation. Override at build time for forks. */
export const REPOSITORY_URL =
  process.env.NEXT_PUBLIC_REPOSITORY_URL ?? 'https://github.com/oacerxone/skillxone';

/** `owner/name` of the repository above, or null when it is not a github.com URL. */
export function repositoryFullName(url: string = REPOSITORY_URL): [string, string] | null {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    url,
  );
  return match ? [match[1]!, match[2]!] : null;
}

/** The project's own installable skill (skills/skillxone in the repository). */
export const OWN_SKILL_PATH = '/get-skill';

export const primaryNav: NavItem[] = [
  { href: '/explore', label: 'Explore', icon: 'compass' },
  { href: '/categories', label: 'Categories', icon: 'grid' },
  { href: '/trending', label: 'Trending', icon: 'flame' },
  { href: '/verified', label: 'Verified', icon: 'shield' },
  { href: '/collections', label: 'Collections', icon: 'layers' },
  { href: '/submit', label: 'Submit Skill', icon: 'upload' },
];

export const secondaryNav: NavItem[] = [
  { href: OWN_SKILL_PATH, label: 'Get the skill', icon: 'sparkles' },
  { href: '/docs', label: 'Documentation', icon: 'book' },
  { href: '/docs/api', label: 'API', icon: 'code' },
  { href: '/contribute', label: 'Contribute', icon: 'heart' },
  { href: '/about', label: 'About', icon: 'info' },
];

/** Footer link groups. */
export const footerNav: { title: string; items: NavItem[] }[] = [
  { title: 'Discover', items: primaryNav.slice(0, 5) },
  {
    title: 'Use',
    items: [
      { href: OWN_SKILL_PATH, label: 'Get the skill' },
      { href: '/docs', label: 'Documentation' },
      { href: '/docs/api', label: 'API' },
      { href: '/api/v1/openapi.json', label: 'OpenAPI spec' },
    ],
  },
  {
    title: 'Community',
    items: [
      { href: '/submit', label: 'Submit a skill' },
      { href: '/report', label: 'Report a problem' },
      { href: '/contribute', label: 'Contribute' },
      { href: '/about', label: 'About' },
      { href: REPOSITORY_URL, label: 'GitHub', external: true },
    ],
  },
];
