import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-parts';
import { PreviewForm } from '@/components/preview-form';

export const metadata: Metadata = { title: 'Submit a skill repository' };

export default function SubmitPage() {
  return (
    <>
      <PageHeader title="Submit a skill repository">
        Suggest a public GitHub repository that contains one or more <code>SKILL.md</code> files.
        Every skill found in it is indexed separately.
      </PageHeader>

      <p
        role="note"
        className="mb-6 max-w-xl rounded-sm bg-warning-bg px-3 py-2 text-[13px] text-warning-fg"
      >
        Submissions are not open yet in this build. You can try the form, but nothing is sent or
        stored.
      </p>

      <PreviewForm
        submitLabel="Submit repository"
        notSentMessage="Not sent: submissions are not enabled in this build."
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
      </PreviewForm>
    </>
  );
}
