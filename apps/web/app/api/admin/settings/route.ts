import { getSetting, setSetting, writeAudit } from '@skillxone/database';
import { apiError } from '@/lib/api';
import { adminAction, formText } from '@/lib/admin-action';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Site settings an admin may change at run time. */
export const POST = adminAction('admin', async ({ form, session, ipHash }) => {
  const value = formText(form, 'submissions_open');
  if (value !== 'true' && value !== 'false')
    return apiError(400, 'INVALID_REQUEST', 'Choose open or closed.');
  const { db } = await getDatabase();
  const now = new Date();
  const before = (await getSetting<boolean>(db, 'submissions_open')) ?? true;
  await setSetting(db, 'submissions_open', value === 'true', session.user.id, now);
  await writeAudit(
    db,
    {
      actorId: session.user.id,
      action: 'settings.update',
      targetType: 'setting',
      targetId: 'submissions_open',
      before,
      after: value === 'true',
      ipHash,
    },
    now,
  );
  return 'settings-saved';
});
