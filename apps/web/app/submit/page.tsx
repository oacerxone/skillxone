import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-parts';
import { JsonForm } from '@/components/json-form';
import { currentSession } from '@/lib/auth';

export const metadata: Metadata = { title: 'Submit a skill repository' };

export const dynamic = 'force-dynamic';

export default async function SubmitPage() {
  const session = await currentSession();
  return (
    <>
      <PageHeader title="Submit a skill repository" icon="upload">
        Suggest a public GitHub repository that contains one or more <code>SKILL.md</code> files.
        Every skill found in it is indexed separately.
      </PageHeader>

      <p className="mb-6 max-w-xl text-[13px] leading-5 text-text-muted">
        A maintainer reviews each suggestion before it is indexed. Nothing is fetched from GitHub
        when you submit. Suggesting a repository that is already listed or already suggested shows
        the existing entry instead of adding a new one.
      </p>

      <JsonForm
        endpoint="/api/v1/submissions"
        submitLabel="Submit repository"
        csrf={session?.csrf}
        successMessage="Thank you. The repository is queued for review."
        duplicateMessage="This repository has already been suggested or is already listed."
      >
        <div>
          <label htmlFor="submit-repo" className="label">
            GitHub repository
          </label>
          <input
            id="submit-repo"
            name="repository"
            className="input font-mono"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="owner/repository"
            pattern="(https://github\.com/)?[A-Za-z0-9][A-Za-z0-9\-]{0,38}/[A-Za-z0-9._\-]{1,100}/?"
            aria-describedby="submit-repo-help"
          />
          <p id="submit-repo-help" className="mt-1 text-[12px] leading-4 text-text-muted">
            Use <code>owner/repository</code> or a full <code>https://github.com/…</code> address.
            Only public GitHub repositories are accepted.
          </p>
        </div>
        <div>
          <label htmlFor="submit-note" className="label">
            Note for reviewers (optional)
          </label>
          <textarea id="submit-note" name="note" className="input" rows={4} maxLength={1000} />
        </div>
      </JsonForm>
    </>
  );
}
