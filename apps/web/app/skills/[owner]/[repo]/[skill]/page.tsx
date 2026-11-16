import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSkillBySlug, getSkillFile, listRelatedSkills } from '@skillxone/database';
import type { SecurityReport, SkillDetail } from '@skillxone/database';
import { SEVERITIES } from '@skillxone/shared/constants';
import { InstallPanel } from '@/components/install-panel';
import { MarkdownView } from '@/components/markdown-view';
import { Section } from '@/components/page-parts';
import { SkillList, skillHref } from '@/components/skill-list';
import { VerificationBadge } from '@/components/verification-badge';
import { getDatabase } from '@/lib/db';
import { formatBytes, formatCount, formatDate, relativeTime } from '@/lib/format';
import { agentLabel } from '@/lib/install';
import { stripFrontmatter } from '@/lib/markdown';

interface Props {
  params: Promise<{ owner: string; repo: string; skill: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const TABS = [
  ['overview', 'Overview'],
  ['files', 'Files'],
  ['security', 'Security'],
  ['versions', 'Versions'],
] as const;
type TabId = (typeof TABS)[number][0];

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? '';

async function load(params: Props['params']): Promise<SkillDetail | undefined> {
  const { owner, repo, skill } = await params;
  const slug = [owner, repo, skill].map((part) => decodeURIComponent(part)).join('/');
  if (slug.length > 300) return undefined;
  const { db } = await getDatabase();
  return getSkillBySlug(db, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const skill = await load(params);
  if (!skill) return { title: 'Skill not found' };
  return { title: `${skill.name} by ${skill.owner}`, description: skill.description };
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

function githubUrls(skill: SkillDetail) {
  const repo = `https://github.com/${encodeURIComponent(skill.owner)}/${encodeURIComponent(skill.repo)}`;
  const ref = skill.currentVersion?.commitSha ?? skill.repository.defaultBranch ?? 'HEAD';
  const dir = skill.path ? `${encodePath(skill.path)}/` : '';
  return {
    repo,
    root: `${repo}/`,
    blobBase: `${repo}/blob/${encodeURIComponent(ref)}/${dir}`,
    file: (path: string, line?: number | null) =>
      `${repo}/blob/${encodeURIComponent(ref)}/${dir}${encodePath(path)}${line ? `#L${line}` : ''}`,
  };
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-flagged-bg text-flagged-fg',
  high: 'bg-flagged-bg text-flagged-fg',
  medium: 'bg-warning-bg text-warning-fg',
  low: 'bg-unverified-bg text-unverified-fg',
  info: 'bg-unverified-bg text-unverified-fg',
};

function SecurityTab({
  skill,
  report,
  fileUrl,
}: {
  skill: SkillDetail;
  report: SecurityReport | null;
  fileUrl: (path: string, line?: number | null) => string;
}) {
  if (!report) {
    return (
      <div className="panel p-4">
        <h2 className="text-[16px] font-semibold leading-6">No assessment for this version</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-text-muted">
          The current version has not been scanned yet, so it is shown as Unverified. That is the
          absence of an assessment, not a finding. Review the source before installing.
        </p>
      </div>
    );
  }

  const order = (severity: string) => (SEVERITIES as readonly string[]).indexOf(severity);
  const findings = [...report.findings].sort((a, b) => order(a.severity) - order(b.severity));
  const counts = SEVERITIES.map(
    (s) => [s, findings.filter((f) => f.severity === s).length] as const,
  ).filter(([, n]) => n > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[16px] font-semibold leading-6">Security report</h2>
          <VerificationBadge state={skill.verificationState} />
        </div>
        <p className="mt-2 max-w-2xl text-[13px] leading-5 text-text-muted">
          Static analysis of one exact version. It reduces risk and shows evidence; it does not
          certify that a skill is safe.
        </p>
        <dl className="mt-3 max-w-2xl text-[13px] leading-5">
          <Meta label="Commit">
            <code className="font-mono text-[12px]">{report.scan.commit_sha}</code>
          </Meta>
          <Meta label="Content hash">
            <code className="font-mono text-[12px]">{report.scan.content_hash}</code>
          </Meta>
          <Meta label="Scanned">{formatDate(report.scan.finished_at)}</Meta>
          <Meta label="Scanner version">{report.scan.scanner_version}</Meta>
          <Meta label="Policy version">{report.scan.policy_version}</Meta>
          <Meta label="Verification expires">
            {skill.verification?.expires_at
              ? formatDate(skill.verification.expires_at)
              : 'Not applicable'}
          </Meta>
        </dl>
      </div>

      <div>
        <h3 className="text-[16px] font-semibold leading-6">
          Findings{' '}
          <span className="font-normal text-text-muted">
            ({findings.length === 0 ? 'none' : counts.map(([s, n]) => `${n} ${s}`).join(', ')})
          </span>
        </h3>
        {findings.length === 0 ? (
          <p className="mt-2 text-[13px] text-text-muted">No findings were recorded.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {findings.map((finding) => (
              <li key={finding.id} className="panel p-3 text-[13px] leading-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-[12px] font-medium uppercase leading-4 ${SEVERITY_CLASS[finding.severity] ?? ''}`}
                  >
                    {finding.severity}
                  </span>
                  <code className="font-mono text-[12px]">{finding.rule_id}</code>
                  {finding.file_path && (
                    <a
                      href={fileUrl(finding.file_path, finding.line_start)}
                      className="link font-mono text-[12px]"
                      rel="noopener noreferrer"
                    >
                      {finding.file_path}
                      {finding.line_start ? `:${finding.line_start}` : ''}
                    </a>
                  )}
                </div>
                <p className="mt-2">{finding.explanation}</p>
                {finding.excerpt && (
                  <pre tabIndex={0} className="code-block mt-2">
                    <code>{finding.excerpt}</code>
                  </pre>
                )}
                <p className="mt-2 text-text-muted">
                  <span className="font-medium text-text">Suggested fix: </span>
                  {finding.remediation}
                </p>
                <p className="mt-2">
                  <Link
                    href={`/report?skill=${encodeURIComponent(skill.slug)}&type=false_positive&finding=${encodeURIComponent(finding.id)}`}
                    className="link"
                  >
                    Report as false positive
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-[16px] font-semibold leading-6">Checks run</h3>
          <ul className="mt-2 list-disc pl-5 text-[13px] leading-6">
            {report.checksRun.map((check) => (
              <li key={check.scanner}>{check.scanner}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-[16px] font-semibold leading-6">Checks skipped</h3>
          {report.checksSkipped.length === 0 ? (
            <p className="mt-2 text-[13px] text-text-muted">None.</p>
          ) : (
            <ul className="mt-2 list-disc pl-5 text-[13px] leading-6">
              {report.checksSkipped.map((check) => (
                <li key={check.scanner}>
                  {check.scanner}: <span className="text-text-muted">{check.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function SkillPage({ params, searchParams }: Props) {
  const skill = await load(params);
  if (!skill) notFound();

  const query = await searchParams;
  const requestedTab = first(query.tab);
  const tab: TabId = TABS.some(([id]) => id === requestedTab)
    ? (requestedTab as TabId)
    : 'overview';
  const base = skillHref(skill.slug);
  const urls = githubUrls(skill);
  const now = new Date();
  const { db } = await getDatabase();
  const related = await listRelatedSkills(db, skill.id);

  const requestedFile = first(query.file);
  const openFile =
    tab === 'files' && requestedFile && skill.files.some((f) => f.path === requestedFile)
      ? await getSkillFile(db, skill.slug, requestedFile)
      : undefined;

  const markdown = skill.skillMarkdown ? stripFrontmatter(skill.skillMarkdown) : null;

  // The three signals that contribute most to the stored quality score.
  const ranking = Object.entries(skill.ranking?.signals ?? {})
    .map(([id, signal]) => ({
      id,
      weight: signal.value * signal.weight,
      explanation: signal.explanation,
    }))
    .filter((entry) => entry.weight > 0 && entry.explanation)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  return (
    <>
      <header className="pb-5 pt-8">
        <p className="font-mono text-[13px] text-text-muted">
          <a href={urls.repo} className="hover:underline" rel="noopener noreferrer">
            {skill.owner}/{skill.repo}
          </a>
          {skill.path && <span> / {skill.path}</span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.015em]">
            {skill.name}
          </h1>
          <VerificationBadge state={skill.verificationState} href={`${base}?tab=security`} />
          {skill.repositoryArchived && (
            <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 text-[12px] font-medium leading-4 text-warning-fg">
              Repository archived
            </span>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-text-muted">{skill.description}</p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The aside is first in the DOM on small screens so Install sits under the title. */}
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-16 lg:order-2 lg:self-start">
          <InstallPanel
            owner={skill.owner}
            repo={skill.repo}
            skillName={skill.name}
            agents={skill.agents}
            verificationState={skill.verificationState}
            verifiedCommit={
              skill.verificationState === 'VERIFIED' ? skill.currentVersion?.commitSha : undefined
            }
            repositoryUrl={urls.repo}
            securityHref={`${base}?tab=security`}
            isFixture={skill.repository.isFixture}
          />

          <section aria-labelledby="details-heading" className="panel p-4">
            <h2 id="details-heading" className="text-[16px] font-semibold leading-6">
              Details
            </h2>
            <dl className="mt-2 divide-y divide-border text-[13px] leading-5">
              <Meta label="Stars">
                <span className="font-mono">{formatCount(skill.stars)}</span>
              </Meta>
              <Meta label="Forks">
                <span className="font-mono">{formatCount(skill.repository.forks)}</span>
              </Meta>
              <Meta label="Skill updated">
                <time dateTime={skill.updatedAt ?? undefined} title={formatDate(skill.updatedAt)}>
                  {relativeTime(skill.updatedAt, now)}
                </time>
              </Meta>
              <Meta label="Last push">{relativeTime(skill.repository.pushedAt, now)}</Meta>
              <Meta label="License">{skill.license ?? 'Not specified'}</Meta>
              <Meta label="Categories">
                {skill.categories.length === 0
                  ? 'None'
                  : skill.categories.map((category, index) => (
                      <span key={category.slug}>
                        {index > 0 && ', '}
                        <Link href={`/categories/${category.slug}`} className="link">
                          {category.name}
                        </Link>
                      </span>
                    ))}
              </Meta>
              <Meta label="Dependencies">
                {skill.dependencies.length === 0 ? 'None declared' : skill.dependencies.length}
              </Meta>
            </dl>
          </section>

          <section aria-labelledby="compat-heading" className="panel p-4">
            <h2 id="compat-heading" className="text-[16px] font-semibold leading-6">
              Compatibility
            </h2>
            <ul className="mt-2 flex flex-col gap-2 text-[13px] leading-5">
              {skill.compatibility.map((entry) => (
                <li key={entry.agentId}>
                  <span className="font-medium">{agentLabel(entry.agentId)}</span>:{' '}
                  {entry.level === 'unsupported' ? 'not supported' : entry.level}
                  {entry.evidence && (
                    <span className="block text-text-muted">{entry.evidence}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {ranking.length > 0 && (
            <section aria-labelledby="ranking-heading" className="panel p-4">
              <h2 id="ranking-heading" className="text-[16px] font-semibold leading-6">
                Why it ranks where it does
              </h2>
              <p className="mt-1 text-[12px] leading-4 text-text-muted">
                The strongest factors in its position. This describes quality signals, not safety.
              </p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-5">
                {ranking.map((entry) => (
                  <li key={entry.id}>{entry.explanation}</li>
                ))}
                {skill.ranking?.adjustments.map((adjustment) => (
                  <li key={adjustment} className="text-flagged-fg">
                    {adjustment}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px]">
                <Link href="/docs#ranking" className="link">
                  How ranking works
                </Link>
              </p>
            </section>
          )}

          <p className="text-[13px]">
            <Link href={`/report?skill=${encodeURIComponent(skill.slug)}`} className="link">
              Report a problem with this skill
            </Link>
          </p>
        </aside>

        <div className="min-w-0 lg:order-1">
          <nav
            aria-label="Skill sections"
            className="mb-5 flex gap-1 overflow-x-auto border-b border-border"
          >
            {TABS.map(([id, label]) => (
              <Link
                key={id}
                href={id === 'overview' ? base : `${base}?tab=${id}`}
                aria-current={tab === id ? 'page' : undefined}
                className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] text-text-muted hover:text-text aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-text"
              >
                {label}
                {id === 'files' && ` (${skill.files.length})`}
              </Link>
            ))}
          </nav>

          {tab === 'overview' &&
            (markdown ? (
              <MarkdownView
                source={markdown.body}
                options={{ linkBase: urls.blobBase, linkRoot: urls.root }}
              />
            ) : (
              <p className="text-text-muted">No SKILL.md content is stored for this version.</p>
            ))}

          {tab === 'files' && (
            <div className="flex flex-col gap-4">
              <div
                className="panel overflow-x-auto"
                role="region"
                aria-label="Files in this skill"
                tabIndex={0}
              >
                <table className="w-full border-collapse text-left text-[13px] leading-5">
                  <thead className="border-b border-border bg-bg-subtle text-[12px] text-text-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        File
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Kind
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Size
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {skill.files.map((file) => (
                      <tr key={file.path} className="border-b border-border last:border-b-0">
                        <th scope="row" className="px-3 py-2 font-normal">
                          <Link
                            href={`${base}?tab=files&file=${encodeURIComponent(file.path)}`}
                            className="link font-mono"
                            aria-current={openFile?.path === file.path ? 'true' : undefined}
                          >
                            {file.path}
                          </Link>
                          {file.is_executable === 1 && (
                            <span className="ml-2 rounded-sm bg-warning-bg px-1.5 text-[12px] text-warning-fg">
                              executable
                            </span>
                          )}
                        </th>
                        <td className="px-3 py-2 text-text-muted">{file.kind.replace('_', ' ')}</td>
                        <td className="px-3 py-2 font-mono text-text-muted">
                          {formatBytes(file.size_bytes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {openFile && (
                <section aria-labelledby="file-heading">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h2 id="file-heading" className="font-mono text-[13px] font-medium">
                      {openFile.path}
                    </h2>
                    <a
                      href={urls.file(openFile.path)}
                      className="link text-[13px]"
                      rel="noopener noreferrer"
                    >
                      View on GitHub
                    </a>
                  </div>
                  {openFile.content === null ? (
                    <p className="text-[13px] text-text-muted">
                      This file is binary or too large to store. View it on GitHub.
                    </p>
                  ) : (
                    // Displayed as plain text: React escapes it, nothing is interpreted.
                    <pre tabIndex={0} className="code-block max-h-[70vh] overflow-auto">
                      <code>{openFile.content}</code>
                    </pre>
                  )}
                </section>
              )}
            </div>
          )}

          {tab === 'security' && (
            <SecurityTab skill={skill} report={skill.report} fileUrl={urls.file} />
          )}

          {tab === 'versions' && (
            <div
              className="panel overflow-x-auto"
              role="region"
              aria-label="Indexed versions"
              tabIndex={0}
            >
              <table className="w-full border-collapse text-left text-[13px] leading-5">
                <caption className="sr-only">Indexed versions of this skill</caption>
                <thead className="border-b border-border bg-bg-subtle text-[12px] text-text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Commit
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Indexed
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Files
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Content hash
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {skill.versions.map((version) => (
                    <tr key={version.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-3 py-2 font-normal">
                        <code className="font-mono">{version.commitSha.slice(0, 7)}</code>
                        {version.isCurrent && (
                          <span className="ml-2 rounded-sm bg-bg-muted px-1.5 text-[12px] text-text-muted">
                            current
                          </span>
                        )}
                      </th>
                      <td className="px-3 py-2 text-text-muted">{formatDate(version.indexedAt)}</td>
                      <td className="px-3 py-2 font-mono text-text-muted">
                        {version.fileCount} · {formatBytes(version.totalBytes)}
                      </td>
                      <td className="px-3 py-2">
                        <code className="font-mono text-[12px] text-text-muted">
                          {version.contentHash.slice(0, 16)}…
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <Section id="related-heading" title="Related skills">
          <SkillList skills={related} now={now} />
        </Section>
      )}
    </>
  );
}
