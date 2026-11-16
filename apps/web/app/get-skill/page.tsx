import type { Metadata } from 'next';
import Link from 'next/link';
import { getSkillBySlug } from '@skillxone/database';
import { CopyButton } from '@/components/copy-button';
import {
  ArrowRightIcon,
  FlagIcon,
  LockIcon,
  PinIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
} from '@/components/icons';
import { StarButton } from '@/components/site-header';
import { skillHref } from '@/components/skill-list';
import { VerificationBadge } from '@/components/verification-badge';
import { getDatabase } from '@/lib/db';
import { REPOSITORY_URL, repositoryFullName } from '@/lib/navigation';
import { OWN_SKILL_NAME, ownSkillInstall } from '@/lib/own-skill';

export const metadata: Metadata = {
  title: 'Get the skillxone skill for Claude Code and Codex',
  description:
    'Install one skill and let Claude Code or OpenAI Codex search skillxone.online and install only verified agent skills, pinned to the scanned commit.',
};

export const dynamic = 'force-dynamic';

const SAFETY = [
  {
    icon: ShieldCheckIcon,
    title: 'Verified versions only',
    body: 'Your agent installs a skill only when its current version is Verified under the published policy. Anything Unverified or Flagged is shown to you, never installed.',
  },
  {
    icon: PinIcon,
    title: 'Pinned to the scanned commit',
    body: 'Install commands include the exact Git commit that was scanned, so a later change in the source repository cannot slip in unreviewed.',
  },
  {
    icon: LockIcon,
    title: 'You approve every install',
    body: 'Before running anything, the agent shows you the skill, its repository, the security report and the exact command, and waits for your yes.',
  },
  {
    icon: FlagIcon,
    title: 'Third-party text is data',
    body: 'Names and descriptions from other repositories are treated as information to show you, never as instructions for the agent.',
  },
];

const EXAMPLES = [
  'Find a verified skill for reviewing Dockerfiles and install it.',
  'Is there a skill for writing Playwright tests? Show me the security report first.',
  'Install a verified PDF skill for all my projects.',
  'Check whether my installed skills have newer verified versions.',
];

function Command({ label, command }: { label: string; command: string }) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle p-2 pl-3">
        <code
          tabIndex={0}
          aria-label={`${label} install command`}
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px]"
        >
          {command}
        </code>
        <CopyButton text={command} />
      </div>
    </div>
  );
}

export default async function GetSkillPage() {
  const repo = repositoryFullName();
  const slug = repo ? `${repo[0]}/${repo[1]}/${OWN_SKILL_NAME}` : null;
  let listing: { slug: string; state: Parameters<typeof VerificationBadge>[0]['state'] } | null =
    null;
  let stars: number | null = null;
  if (slug) {
    try {
      const { db } = await getDatabase();
      const skill = await getSkillBySlug(db, slug.toLowerCase());
      if (skill) {
        listing = { slug: skill.slug, state: skill.verificationState };
        stars = skill.stars;
      }
    } catch {
      // The page works without the database; the listing badge is simply omitted.
    }
  }
  const sourceUrl = `${REPOSITORY_URL}/blob/main/skills/${OWN_SKILL_NAME}/SKILL.md`;

  return (
    <>
      <section aria-labelledby="get-skill-heading" className="relative isolate pb-6 pt-12">
        <div className="hero-backdrop">
          <div className="grid-lines" />
          <div className="blob blob-a" />
        </div>
        <p className="reveal inline-flex items-center gap-2 rounded-full border border-border bg-bg/70 px-3 py-1 text-[12px] text-text-muted">
          <SparklesIcon size={13} className="text-accent" />
          One skill · the whole verified catalog
        </p>
        <h1
          id="get-skill-heading"
          className="reveal mt-4 max-w-3xl text-[32px] font-semibold leading-[38px] tracking-[-0.02em] sm:text-[44px] sm:leading-[50px] sm:tracking-[-0.03em]"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          Get the skillxone skill <span className="text-gradient">for Claude Code and Codex.</span>
        </h1>
        <p
          className="reveal mt-4 max-w-2xl text-[16px] leading-[26px] text-text-muted"
          style={{ '--i': 2 } as React.CSSProperties}
        >
          Install it once. Then ask your agent for any capability, and it searches skillxone.online
          and installs only skills whose exact version passed the security policy.
        </p>
        <div
          className="reveal mt-5 flex flex-wrap items-center gap-3"
          style={{ '--i': 3 } as React.CSSProperties}
        >
          <StarButton stars={stars} className="inline-flex" />
          {listing && (
            <span className="inline-flex items-center gap-2 text-[13px] text-text-muted">
              Listed here as
              <VerificationBadge
                state={listing.state}
                href={`${skillHref(listing.slug)}?tab=security`}
              />
            </span>
          )}
          <a href={sourceUrl} className="link text-[13px]" rel="noopener noreferrer">
            Read the skill source
          </a>
        </div>
      </section>

      <section aria-labelledby="install-heading" className="mt-6">
        <h2 id="install-heading" className="text-[20px] font-semibold leading-7">
          Install
        </h2>
        <p className="text-[13px] leading-5 text-text-muted">
          Uses the open-source <code className="font-mono">skills</code> CLI (Node.js 22.20 or
          later). Run in your project folder, or add <code className="font-mono">-g</code> for all
          projects.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="panel card-lift flex min-w-0 flex-col gap-4 p-5">
            <p className="flex items-center gap-2 font-medium">
              <span className="icon-tile size-8">
                <TerminalIcon size={16} />
              </span>
              Claude Code
            </p>
            <Command label="This project" command={ownSkillInstall.claudeCode} />
            <Command label="All projects" command={ownSkillInstall.claudeCodeGlobal} />
            <p className="text-[12px] text-text-muted">
              Then run <code className="font-mono">/reload-skills</code> or restart Claude Code.
            </p>
          </div>
          <div className="panel card-lift flex min-w-0 flex-col gap-4 p-5">
            <p className="flex items-center gap-2 font-medium">
              <span className="icon-tile size-8">
                <TerminalIcon size={16} />
              </span>
              OpenAI Codex
            </p>
            <Command label="This project" command={ownSkillInstall.codex} />
            <Command label="All projects" command={ownSkillInstall.codexGlobal} />
            <p className="text-[12px] text-text-muted">Then start a new Codex session.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="safety-heading" className="mt-14">
        <h2 id="safety-heading" className="text-[20px] font-semibold leading-7">
          Built so a bad skill never reaches you unnoticed
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {SAFETY.map(({ icon: Icon, title, body }) => (
            <li key={title} className="panel card-lift reveal-scroll flex gap-3 p-4">
              <span className="icon-tile">
                <Icon size={18} />
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 max-w-3xl text-[13px] leading-5 text-text-muted">
          “Verified” means a version passed static analysis under a{' '}
          <Link href="/docs" className="link">
            published policy
          </Link>
          . It is strong evidence, not a guarantee, which is why the agent always shows you the
          report and asks first.
        </p>
      </section>

      <section aria-labelledby="examples-heading" className="mt-14">
        <h2 id="examples-heading" className="text-[20px] font-semibold leading-7">
          Try asking
        </h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {EXAMPLES.map((text) => (
            <li
              key={text}
              className="panel reveal-scroll flex items-start gap-3 p-4 text-[14px] leading-6"
            >
              <SearchIcon size={16} className="mt-1 flex-none text-accent" />
              <span>“{text}”</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-skill-heading" className="mt-14">
        <h2 id="how-skill-heading" className="text-[20px] font-semibold leading-7">
          How it works
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            ['Search', 'The agent queries the public skillxone API, filtered to Verified skills.'],
            [
              'Review',
              'It shows you the best matches with stars, repository and a link to each security report.',
            ],
            [
              'Install',
              'After your yes, it runs the pinned install command exactly as the API returned it.',
            ],
          ].map(([title, body], index) => (
            <li key={title} className="panel reveal-scroll p-4">
              <p className="font-mono text-[12px] text-text-subtle">0{index + 1}</p>
              <p className="font-medium">{title}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-text-muted">{body}</p>
            </li>
          ))}
        </ol>
        <Link href="/explore" className="btn mt-6 h-9 gap-1.5">
          Browse the catalog yourself
          <ArrowRightIcon size={14} className="arrow-nudge" />
        </Link>
      </section>
    </>
  );
}
