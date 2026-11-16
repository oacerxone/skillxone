import { getDatabase } from '@/lib/db';

interface Snapshot {
  categories: number;
  skills: number;
  repositories: number;
}

async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const { db } = await getDatabase();
    const count = async (table: 'categories' | 'skills' | 'repositories') => {
      const row = await db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      return Number(row.n);
    };
    return {
      categories: await count('categories'),
      skills: await count('skills'),
      repositories: await count('repositories'),
    };
  } catch {
    return null;
  }
}

/**
 * Phase 1 shell. The real homepage (search, trending, categories) is built in Phase 2;
 * this page only proves that the layout, tokens and database connection work.
 */
export default async function HomePage() {
  const snapshot = await loadSnapshot();

  return (
    <div className="py-12">
      <h1 className="max-w-2xl text-[28px] font-semibold leading-[34px] tracking-[-0.015em] sm:text-[40px] sm:leading-[44px] sm:tracking-[-0.02em]">
        Find agent skills you can check before you install.
      </h1>
      <p className="mt-4 max-w-xl text-[15px] leading-[24px] text-text-muted">
        An open-source index of Claude Code and Codex skills from GitHub, with a published security
        report for every indexed version.
      </p>

      <section
        aria-labelledby="status-heading"
        className="mt-10 max-w-xl rounded-md border border-border bg-bg-subtle p-4"
      >
        <h2 id="status-heading" className="text-[16px] font-semibold leading-6">
          Project status: foundation
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-text-muted">
          The marketplace pages are not built yet. This shell confirms that the application, design
          tokens and database are wired together.
        </p>
        {snapshot ? (
          <dl className="mt-4 grid grid-cols-3 gap-4">
            {(
              [
                ['Categories', snapshot.categories],
                ['Repositories', snapshot.repositories],
                ['Skills', snapshot.skills],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-[12px] font-medium leading-4 text-text-subtle">{label}</dt>
                <dd className="font-mono text-[20px] leading-7">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-4 rounded-sm bg-flagged-bg px-3 py-2 text-[13px] text-flagged-fg">
            The database is not reachable or not migrated. Run <code>pnpm bootstrap</code>.
          </p>
        )}
      </section>
    </div>
  );
}
