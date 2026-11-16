import type { Metadata } from 'next';
import Link from 'next/link';
import { getSkillBySlug } from '@skillxone/database';
import { PageHeader } from '@/components/page-parts';
import { PreviewForm } from '@/components/preview-form';
import { skillHref } from '@/components/skill-list';
import { getDatabase } from '@/lib/db';

export const metadata: Metadata = { title: 'Report a problem' };

const TYPES = [
  ['security_concern', 'Security concern'],
  ['false_positive', 'A security finding is a false positive'],
  ['inaccurate_metadata', 'Inaccurate information'],
  ['duplicate', 'Duplicate of another skill'],
  ['takedown', 'Takedown request'],
  ['other', 'Something else'],
] as const;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? '';

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const slug = first(query.skill).slice(0, 300);
  const requestedType = first(query.type);
  const type = TYPES.some(([id]) => id === requestedType) ? requestedType : 'security_concern';
  const { db } = await getDatabase();
  // Only a skill that exists is echoed back; an unknown value from the URL is ignored.
  const skill = slug ? await getSkillBySlug(db, slug) : undefined;
  const finding = skill?.report?.findings.find((f) => f.id === first(query.finding));

  return (
    <>
      <PageHeader title="Report a problem">
        Tell the maintainers about a security concern, a finding you believe is wrong, or inaccurate
        information.
      </PageHeader>

      <p
        role="note"
        className="mb-6 max-w-xl rounded-sm bg-warning-bg px-3 py-2 text-[13px] text-warning-fg"
      >
        Reports are not open yet in this build. You can try the form, but nothing is sent or stored.
      </p>

      <PreviewForm
        submitLabel="Send report"
        notSentMessage="Not sent: reports are not enabled in this build."
      >
        <div className="text-[13px] leading-5">
          <span className="label">About</span>
          {skill ? (
            <p>
              <Link href={skillHref(skill.slug)} className="link font-mono">
                {skill.slug}
              </Link>
              {finding && (
                <span className="block text-text-muted">
                  Finding <code className="font-mono">{finding.rule_id}</code>
                  {finding.file_path && ` in ${finding.file_path}`}
                </span>
              )}
            </p>
          ) : (
            <p className="text-text-muted">
              No skill selected. Open a skill and use its “Report a problem” link to attach one.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="report-type" className="label">
            Type of report
          </label>
          <select id="report-type" name="type" className="input" defaultValue={type}>
            {TYPES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="report-body" className="label">
            What is wrong?
          </label>
          <textarea
            id="report-body"
            name="body"
            className="input"
            rows={6}
            required
            minLength={20}
            maxLength={4000}
            aria-describedby="report-body-help"
          />
          <p id="report-body-help" className="mt-1 text-[12px] leading-4 text-text-muted">
            At least 20 characters. Do not include passwords, tokens or other secrets.
          </p>
        </div>
        <div>
          <label htmlFor="report-contact" className="label">
            Contact email (optional, visible to maintainers only)
          </label>
          <input
            id="report-contact"
            name="contact"
            type="email"
            className="input"
            autoComplete="email"
            maxLength={200}
          />
        </div>
      </PreviewForm>
    </>
  );
}
