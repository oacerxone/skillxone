import Link from 'next/link';
import type { SkillListItem } from '@skillxone/database';
import { formatCount, formatDate, highlightSegments, relativeTime } from '@/lib/format';
import { agentLabel } from '@/lib/install';
import { Avatar, EmptyIllustration } from './art';
import { VerificationBadge } from './verification-badge';

export function skillHref(slug: string): string {
  return `/skills/${slug.split('/').map(encodeURIComponent).join('/')}`;
}

export function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((segment, index) =>
        segment.match ? <mark key={index}>{segment.text}</mark> : segment.text,
      )}
    </>
  );
}

function AgentMarks({ agents }: { agents: string[] }) {
  if (agents.length === 0) return <span className="text-text-subtle">None listed</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {agents.map((agent) => (
        <span
          key={agent}
          className="rounded-sm border border-border px-1.5 text-[12px] leading-[18px] text-text-muted"
        >
          {agentLabel(agent)}
        </span>
      ))}
    </span>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[13px]" title={`${value} stars`}>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d="m6 .8 1.6 3.3 3.6.5-2.6 2.5.6 3.6L6 9l-3.2 1.7.6-3.6L.8 4.6l3.6-.5L6 .8Z" />
      </svg>
      <span className="sr-only">Stars: </span>
      {formatCount(value)}
    </span>
  );
}

interface ListProps {
  skills: SkillListItem[];
  terms?: readonly string[];
  /** Render time, so relative dates are consistent across the list. */
  now?: Date;
}

/**
 * Compact listing. A real table on wide screens (so assistive technology gets column
 * headers); the same rows restack into labelled blocks on narrow screens.
 */
export function SkillList({ skills, terms = [], now = new Date() }: ListProps) {
  return (
    <div className="panel reveal-scroll overflow-hidden shadow-[0_1px_2px_color-mix(in_oklab,var(--text)_5%,transparent)]">
      <table className="w-full border-collapse text-left text-[13px] leading-5">
        <thead className="hidden border-b border-border bg-bg-subtle text-[12px] font-medium text-text-muted lg:table-header-group">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Skill
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Stars
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Updated
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Works with
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Install</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => (
            <tr
              key={skill.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-3 transition-colors duration-150 last:border-b-0 hover:bg-bg-subtle lg:table-row lg:p-0"
            >
              <th scope="row" className="w-full font-normal lg:w-auto lg:px-3 lg:py-2.5">
                <span className="flex items-start gap-3">
                  <span className="mt-0.5">
                    <Avatar name={skill.owner} size={30} />
                  </span>
                  <span className="min-w-0">
                    <Link
                      href={skillHref(skill.slug)}
                      className="font-medium text-text hover:underline"
                    >
                      <Highlight text={skill.name} terms={terms} />
                    </Link>
                    <span className="ml-2 font-mono text-[12px] text-text-subtle">
                      <Highlight text={`${skill.owner}/${skill.repo}`} terms={terms} />
                    </span>
                    <span className="block max-w-[60ch] text-text-muted lg:truncate">
                      <Highlight text={skill.description} terms={terms} />
                    </span>
                  </span>
                </span>
              </th>
              <td className="text-text-muted lg:px-3 lg:py-2.5">
                <Stars value={skill.stars} />
              </td>
              <td className="whitespace-nowrap text-text-muted lg:px-3 lg:py-2.5">
                <span className="lg:hidden">Updated </span>
                <time dateTime={skill.updatedAt ?? undefined} title={formatDate(skill.updatedAt)}>
                  {relativeTime(skill.updatedAt, now)}
                </time>
              </td>
              <td className="lg:px-3 lg:py-2.5">
                <AgentMarks agents={skill.agents} />
              </td>
              <td className="lg:px-3 lg:py-2.5">
                <VerificationBadge
                  state={skill.verificationState}
                  href={`${skillHref(skill.slug)}?tab=security`}
                />
              </td>
              <td className="ml-auto lg:px-3 lg:py-2.5 lg:text-right">
                <Link
                  href={`${skillHref(skill.slug)}#install`}
                  className="btn"
                  aria-label={`Install ${skill.name}`}
                >
                  Install
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkillCards({ skills, terms = [], now = new Date() }: ListProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((skill) => (
        <li key={skill.id} className="panel card-lift flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar name={skill.owner} size={32} />
              <Link href={skillHref(skill.slug)} className="font-medium hover:underline">
                <Highlight text={skill.name} terms={terms} />
              </Link>
            </span>
            <VerificationBadge
              state={skill.verificationState}
              href={`${skillHref(skill.slug)}?tab=security`}
            />
          </div>
          <p className="flex-1 text-[13px] leading-5 text-text-muted">
            <Highlight text={skill.description} terms={terms} />
          </p>
          <p className="font-mono text-[12px] text-text-subtle">
            {skill.owner}/{skill.repo}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-muted">
            <Stars value={skill.stars} />
            <time dateTime={skill.updatedAt ?? undefined} title={formatDate(skill.updatedAt)}>
              {relativeTime(skill.updatedAt, now)}
            </time>
            <AgentMarks agents={skill.agents} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel px-4 py-10 text-center">
      <EmptyIllustration />
      <p className="mt-4 font-medium">{title}</p>
      {children && <div className="mt-1 text-[13px] text-text-muted">{children}</div>}
    </div>
  );
}
