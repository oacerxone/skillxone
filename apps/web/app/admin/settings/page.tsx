import { getSetting } from '@skillxone/database';
import { AdminForm, AdminTitle, Done, Submit } from '@/components/admin/admin-parts';
import { requireStaff } from '@/lib/admin';
import { getDatabase } from '@/lib/db';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const session = await requireStaff('admin');
  const query = await searchParams;
  const { db } = await getDatabase();
  const open = (await getSetting<boolean>(db, 'submissions_open')) ?? true;
  return (
    <>
      <AdminTitle title="Settings">
        Run-time settings. Credentials, schedules and limits are configured in the environment (see
        .env.example), not here.
      </AdminTitle>
      <Done done={query.done} />
      <section className="panel p-3 text-[13px]">
        <h2 className="font-medium">Repository submissions</h2>
        <p className="mt-1 text-text-muted">Currently {open ? 'open' : 'closed'}.</p>
        <AdminForm
          action="/api/admin/settings"
          csrf={session.csrf}
          back="/admin/settings"
          className="mt-2"
        >
          <Submit name="submissions_open" value={open ? 'false' : 'true'}>
            {open ? 'Close submissions' : 'Open submissions'}
          </Submit>
        </AdminForm>
      </section>
    </>
  );
}
