import Link from 'next/link';
import { footerNav, OWN_SKILL_PATH, REPOSITORY_URL } from '@/lib/navigation';
import { ownSkillInstall } from '@/lib/own-skill';
import { CopyButton } from './copy-button';
import {
  ArrowRightIcon,
  ArrowUpIcon,
  GitHubIcon,
  LockIcon,
  LogoMark,
  PinIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from './icons';
import { StarButton } from './site-header';

function FooterLink({ href, label }: { href: string; label: string }) {
  const className = 'footer-link';
  if (href.startsWith('http'))
    return (
      <a href={href} className={className} rel="noopener noreferrer">
        {label}
      </a>
    );
  // Route handlers and JSON endpoints are plain links (no client-side prefetch).
  if (href.startsWith('/api') || href === '/admin')
    return (
      <a href={href} className={className}>
        {label}
      </a>
    );
  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

const PROMISES = [
  { icon: ShieldCheckIcon, text: 'Verified versions only' },
  { icon: PinIcon, text: 'Pinned to the scanned commit' },
  { icon: LockIcon, text: 'Asks before it installs' },
];

export function SiteFooter({ stars }: { stars: number | null }) {
  const year = new Date().getUTCFullYear();
  return (
    <footer className="site-footer mt-24">
      <div className="mx-auto max-w-[1200px] px-4">
        <section aria-labelledby="footer-cta-heading" className="footer-cta reveal-scroll">
          <div className="footer-cta-glow" aria-hidden="true" />
          <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg/70 px-2.5 py-0.5 text-[12px] text-text-muted">
                <TerminalIcon size={13} /> For Claude Code and Codex
              </p>
              <h2
                id="footer-cta-heading"
                className="mt-3 text-[24px] font-semibold leading-[30px] tracking-[-0.02em] sm:text-[28px] sm:leading-[34px]"
              >
                Give Claude Code and Codex the whole{' '}
                <span className="text-gradient">verified catalog</span>.
              </h2>
              <p className="mt-2 max-w-md text-[14px] leading-6 text-text-muted">
                Install the skillxone skill once. Your agent can then search skillxone.online and
                install only skills whose exact version passed the security policy.
              </p>
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-text-muted">
                {PROMISES.map(({ icon: Icon, text }) => (
                  <li key={text} className="inline-flex items-center gap-1.5">
                    <Icon size={14} className="text-accent" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <div className="term">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="flex items-center gap-1.5" aria-hidden="true">
                    <span className="size-2.5 rounded-full bg-border-strong" />
                    <span className="size-2.5 rounded-full bg-border-strong" />
                    <span className="size-2.5 rounded-full bg-border-strong" />
                  </span>
                  <span className="font-mono text-[11px] text-text-subtle">Claude Code</span>
                </div>
                <div className="flex items-center gap-2 p-3">
                  <code
                    tabIndex={0}
                    aria-label="Install command for Claude Code"
                    className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] text-text"
                  >
                    <span className="text-accent" aria-hidden="true">
                      ${' '}
                    </span>
                    {ownSkillInstall.claudeCode}
                  </code>
                  <CopyButton text={ownSkillInstall.claudeCode} label="Copy" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link href={OWN_SKILL_PATH} className="btn btn-primary btn-shine h-9 gap-1.5">
                  Setup for Codex and more
                  <ArrowRightIcon size={14} className="arrow-nudge" />
                </Link>
                <StarButton stars={stars} className="inline-flex" />
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark size={28} />
              <span className="text-[15px] font-semibold tracking-[-0.01em]">skillxone</span>
            </Link>
            <p className="mt-3 max-w-xs text-[13px] leading-5 text-text-muted">
              An open-source, self-hostable index of AI agent skills, with a published security
              report for every assessed version.
            </p>
            <a
              href={REPOSITORY_URL}
              rel="noopener noreferrer"
              className="social-btn mt-4"
              aria-label="skillxone on GitHub"
            >
              <GitHubIcon size={16} />
            </a>
          </div>
          {footerNav.map((group) => (
            <nav key={group.title} aria-label={`Footer: ${group.title}`}>
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-subtle">
                {group.title}
              </h2>
              <ul className="mt-3 space-y-2">
                {group.items.map((item) => (
                  <li key={item.href + item.label}>
                    <FooterLink href={item.href} label={item.label} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-border py-6 text-[12px] text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} skillxone · Apache-2.0. Indexed skills remain under their own licenses.
            “Verified” reflects static analysis, not a guarantee.
          </p>
          <div className="flex items-center gap-4">
            <FooterLink href="/admin" label="Maintainers" />
            <a href="#main" className="footer-link inline-flex items-center gap-1">
              Back to top <ArrowUpIcon size={13} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
