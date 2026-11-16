import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { getRepositoryStars, hasDevFixtures } from '@skillxone/database';
import { SearchShortcut } from '@/components/search-shortcut';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { getDatabase } from '@/lib/db';
import { repositoryFullName } from '@/lib/navigation';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'skillxone — agent skills marketplace', template: '%s — skillxone' },
  description:
    'Discover, evaluate, verify and install AI agent skills from GitHub. Open source and self-hostable.',
};

// The fixture banner reads the database, so the shell is rendered per request.
export const dynamic = 'force-dynamic';

/**
 * Applies a stored dark preference before first paint to avoid a flash. The script is a
 * constant string with no interpolated user data. Light is the default (no attribute).
 */
const themeScript = `try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

async function devFixturesPresent(): Promise<boolean> {
  try {
    const { db } = await getDatabase();
    return await hasDevFixtures(db);
  } catch {
    // An unreachable or unmigrated database is reported by /api/health, not by the banner.
    return false;
  }
}

/** Stars of this project's own repository, from the last sync. Null when not indexed. */
async function ownRepositoryStars(): Promise<number | null> {
  const repo = repositoryFullName();
  if (!repo) return null;
  try {
    const { db } = await getDatabase();
    return await getRepositoryStars(db, repo[0], repo[1]);
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [showFixtureBanner, stars] = await Promise.all([
    devFixturesPresent(),
    ownRepositoryStars(),
  ]);
  // Set by proxy.ts; the inline theme script must carry it to run under the CSP.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-30 focus:rounded-md focus:bg-bg focus:px-3 focus:py-2 focus:text-accent"
        >
          Skip to content
        </a>
        {showFixtureBanner && (
          <p
            role="status"
            className="border-b border-border bg-warning-bg px-4 py-1.5 text-center text-[13px] text-warning-fg"
          >
            Development data: the skills shown are fixtures, not real GitHub repositories.
          </p>
        )}
        <SiteHeader stars={stars} />
        <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4">
          {children}
        </main>
        <SiteFooter stars={stars} />
        <SearchShortcut />
      </body>
    </html>
  );
}
