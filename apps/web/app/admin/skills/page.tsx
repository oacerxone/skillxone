import Link from 'next/link';
import { searchSkillsForAdmin } from '@skillxone/database';
import {
  AdminForm,
  AdminTitle,
  Done,
  Empty,
  NoteField,
  Submit,
} from '@/components/admin/admin-parts';
import { requireStaff } from '@/lib/admin';
import { getDatabase } from '@/lib/db';

export const metadata = { title: 'Skills' };

export default async function AdminSkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; done?: string }>;
}) {
  const session = await requireStaff();
  const query = await searchParams;
  const q = (query.q ?? '').slice(0, 100);
  const { db } = await getDatabase();
  const rows = await searchSkillsForAdmin(db, q);
  const back = `/admin/skills${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  return (
    <>
      <AdminTitle title="Skills">
        Hide a skill to remove it from listings, search and the API; the reason is kept in the audit
        log.
      </AdminTitle>
      <Done done={query.done} />
      <form method="get" className="mb-4 flex gap-2">
        <label htmlFor="admin-skill-q" className="sr-only">
          Filter by slug
        </label>
        <input
          id="admin-skill-q"
          name="q"
          defaultValue={q}
          placeholder="owner/repo/skill"
          className="h-8 w-72 max-w-full rounded-md border border-border-strong bg-bg px-2 text-[13px]"
        />
        <Submit>Filter</Submit>
      </form>
      {rows.length === 0 ? (
        <Empty>No skills match.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="panel p-3 text-[13px]">
              <p>
                {row.status === 'active' ? (
                  <Link href={`/skills/${row.slug}`} className="link font-mono">
                    {row.slug}
                  </Link>
                ) : (
                  <span className="font-mono">{row.slug}</span>
                )}
                <span className="text-text-muted">
                  {' '}
                  · {row.status} · {row.verification_state.toLowerCase()}
                </span>
              </p>
              <AdminForm
                action={`/api/admin/skills/${row.id}`}
                csrf={session.csrf}
                back={back}
                className="mt-2"
              >
                <NoteField id={`note-${row.id}`} label="Reason" required />
                <Submit name="visibility" value={row.status === 'hidden' ? 'active' : 'hidden'}>
                  {row.status === 'hidden' ? 'Show' : 'Hide'}
                </Submit>
              </AdminForm>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
