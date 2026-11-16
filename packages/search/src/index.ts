import { sql } from 'kysely';
import { likePattern, searchTerms, writeTransaction } from '@skillxone/database';
import type { DatabaseHandle } from '@skillxone/database';

/**
 * Full-text search over the catalog.
 *
 * The index is derived data: it can be dropped and rebuilt from the `skills` tables at any
 * time, so a damaged index is repaired rather than restored. Search needs no external
 * service and no AI model.
 *
 *  - SQLite: an FTS5 virtual table with BM25 ranking and prefix matching.
 *  - PostgreSQL: a portable substring matcher for now. It is correct but unranked; a
 *    tsvector backend can replace it behind the same interface.
 *
 * To add a backend, implement `SearchBackend` and return it from `createSearchBackend`.
 */

export interface SearchHealth {
  ok: boolean;
  backend: string;
  indexed: number;
  expected: number;
  detail: string;
}

export interface Suggestion {
  slug: string;
  name: string;
  description: string;
}

export interface SearchBackend {
  readonly name: string;
  /** Creates the index structure if it does not exist. Safe to call repeatedly. */
  ensure(): Promise<void>;
  /** Drops and rebuilds the whole index. Returns the number of indexed skills. */
  rebuild(): Promise<number>;
  /** Re-indexes the skills of one repository (after a sync). */
  indexRepository(repositoryId: string): Promise<number>;
  /** Skill ids matching the query, best first. Empty for a query with no searchable terms. */
  search(query: string, limit?: number): Promise<string[]>;
  /** Name completions for a partly typed query. */
  suggest(prefix: string, limit?: number): Promise<Suggestion[]>;
  health(): Promise<SearchHealth>;
}

/** Upper bound on matches handed to the catalog for filtering and paging. */
export const MAX_SEARCH_RESULTS = 1000;
const MAX_TERMS = 8;
const MAX_BODY_CHARS = 60_000;

/** BM25 column weights, in table column order: skill_id, name, description, owner, repo, categories, body. */
const WEIGHTS = [0, 10, 4, 2, 2, 2, 1] as const;
const RANK_FUNCTION = `bm25(${WEIGHTS.join(', ')})`;
/** Quality assumed for a skill that has not been ranked yet. */
const UNRANKED_QUALITY = 0.3;

/** Words from user input: letters and digits only, lowercased, bounded in number and length. */
export function tokenize(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((token) => token.slice(0, 40))
    .slice(0, MAX_TERMS);
}

/**
 * Builds an FTS5 MATCH expression from user input. Every token is wrapped in double quotes
 * (tokens contain only letters and digits, so no quote can appear inside one), which makes
 * FTS5 operators such as AND, OR, NOT, NEAR, `*`, `:` and `^` in the input inert. The last
 * token is a prefix match so results appear while typing. Returns null if nothing is left.
 */
export function toFtsQuery(query: string, column?: string): string | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  const parts = tokens.map((token, index) => `"${token}"${index === tokens.length - 1 ? '*' : ''}`);
  const expression = parts.join(' ');
  return column ? `${column} : (${expression})` : expression;
}

type Db = DatabaseHandle['db'];

const documentSelect = sql`
  select
    s.id,
    s.name,
    coalesce(s.curated_description, s.description),
    r.owner,
    r.name,
    coalesce((
      select group_concat(c.name, ' ')
      from skill_categories sc join categories c on c.id = sc.category_id
      where sc.skill_id = s.id
    ), ''),
    coalesce((
      select substr(f.content, 1, ${MAX_BODY_CHARS})
      from skill_files f
      where f.version_id = s.current_version_id and f.kind = 'skill_md'
    ), '')
  from skills s
  join repositories r on r.id = s.repository_id
  where s.status = 'active' and r.status in ('active', 'archived')
`;

function fts5Backend(db: Db): SearchBackend {
  const bm25 = sql.raw(`bm25(skills_fts, ${WEIGHTS.join(', ')})`);

  const create = (executor: Db) =>
    sql`
      create virtual table if not exists skills_fts using fts5(
        skill_id unindexed, name, description, owner, repo, categories, body,
        tokenize = 'porter unicode61 remove_diacritics 2'
      )
    `.execute(executor);

  const expectedCount = async () => {
    const row = await db
      .selectFrom('skills as s')
      .innerJoin('repositories as r', 'r.id', 's.repository_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('s.status', '=', 'active')
      .where('r.status', 'in', ['active', 'archived'])
      .executeTakeFirstOrThrow();
    return Number(row.n);
  };
  const indexedCount = async () => {
    const result = await sql<{ n: number }>`select count(*) as n from skills_fts`.execute(db);
    return Number(result.rows[0]?.n ?? 0);
  };

  return {
    name: 'sqlite-fts5',

    async ensure() {
      await create(db);
    },

    async rebuild() {
      await writeTransaction(db, async (trx) => {
        await sql`drop table if exists skills_fts`.execute(trx);
        await create(trx);
        await sql`insert into skills_fts (skill_id, name, description, owner, repo, categories, body) ${documentSelect}`.execute(
          trx,
        );
      });
      // Merge index segments so queries stay fast after a bulk load.
      await sql`insert into skills_fts (skills_fts) values ('optimize')`.execute(db);
      return indexedCount();
    },

    async indexRepository(repositoryId) {
      await create(db);
      return writeTransaction(db, async (trx) => {
        await sql`delete from skills_fts where skill_id in (select id from skills where repository_id = ${repositoryId})`.execute(
          trx,
        );
        const result = await sql`
          insert into skills_fts (skill_id, name, description, owner, repo, categories, body)
          ${documentSelect} and s.repository_id = ${repositoryId}
        `.execute(trx);
        return Number(result.numAffectedRows ?? 0);
      });
    },

    async search(query, limit = MAX_SEARCH_RESULTS) {
      const match = toFtsQuery(query);
      if (!match) return [];
      // Two stages. First the index returns its best candidates by relevance alone, which
      // FTS5 can do without sorting every match (`order by rank limit`). Then those
      // candidates are re-ordered with quality blended in: quality reorders close matches
      // but cannot lift a poor match, because a poor match never makes the candidate set
      // ahead of better ones (ADR-008).
      const cap = Math.min(Math.max(1, Math.trunc(limit)), MAX_SEARCH_RESULTS);
      const result = await sql<{ skill_id: string }>`
        select c.skill_id as skill_id
        from (
          select skill_id, rank
          from skills_fts
          where skills_fts match ${match} and rank match ${RANK_FUNCTION}
          order by rank
          limit ${cap}
        ) c
        left join ranking_scores rs on rs.skill_id = c.skill_id
        order by (-c.rank) * (0.6 + 0.4 * coalesce(rs.quality_score, ${UNRANKED_QUALITY})) desc,
                 c.skill_id asc
      `.execute(db);
      return result.rows.map((row) => row.skill_id);
    },

    async suggest(prefix, limit = 8) {
      const match = toFtsQuery(prefix, 'name');
      if (!match) return [];
      const result = await sql<Suggestion>`
        select s.slug as slug, s.name as name, coalesce(s.curated_description, s.description) as description
        from skills_fts
        join skills s on s.id = skills_fts.skill_id
        left join ranking_scores rs on rs.skill_id = s.id
        where skills_fts match ${match}
        order by (-${bm25}) * (0.6 + 0.4 * coalesce(rs.quality_score, ${UNRANKED_QUALITY})) desc, s.id asc
        limit ${Math.min(Math.max(1, Math.trunc(limit)), 20)}
      `.execute(db);
      return result.rows;
    },

    async health() {
      const expected = await expectedCount();
      try {
        await create(db);
        // FTS5's built-in consistency check; it raises an error if the index is damaged.
        await sql`insert into skills_fts (skills_fts, rank) values ('integrity-check', 1)`.execute(
          db,
        );
        const indexed = await indexedCount();
        const ok = indexed === expected;
        return {
          ok,
          backend: 'sqlite-fts5',
          indexed,
          expected,
          detail: ok ? 'Index is consistent.' : 'Index is out of date; run `worker reindex`.',
        };
      } catch {
        return {
          ok: false,
          backend: 'sqlite-fts5',
          indexed: 0,
          expected,
          detail: 'Index is damaged; run `worker reindex` to rebuild it.',
        };
      }
    },
  };
}

/** Dialect-neutral fallback: every term must appear in the name, description or repository. */
function substringBackend(db: Db): SearchBackend {
  const matching = (query: string) => {
    let qb = db
      .selectFrom('skills as s')
      .innerJoin('repositories as r', 'r.id', 's.repository_id')
      .leftJoin('ranking_scores as rs', 'rs.skill_id', 's.id')
      .where('s.status', '=', 'active')
      .where('r.status', 'in', ['active', 'archived']);
    for (const term of searchTerms(query)) {
      const pattern = likePattern(term);
      qb = qb.where(
        sql<boolean>`(lower(s.name) like ${pattern} escape '\\' or lower(s.description) like ${pattern} escape '\\' or r.full_name_lower like ${pattern} escape '\\')`,
      );
    }
    return qb.orderBy(sql`coalesce(rs.quality_score, -1)`, 'desc').orderBy('s.id');
  };
  const count = async () => {
    const row = await db
      .selectFrom('skills')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    return Number(row.n);
  };

  return {
    name: 'substring',
    async ensure() {},
    rebuild: count,
    indexRepository: async () => 0,
    async search(query, limit = MAX_SEARCH_RESULTS) {
      if (searchTerms(query).length === 0) return [];
      const rows = await matching(query)
        .select('s.id as id')
        .limit(Math.min(limit, MAX_SEARCH_RESULTS))
        .execute();
      return rows.map((row) => row.id);
    },
    async suggest(prefix, limit = 8) {
      if (searchTerms(prefix).length === 0) return [];
      return matching(prefix)
        .select(['s.slug as slug', 's.name as name', 's.description as description'])
        .limit(Math.min(limit, 20))
        .execute();
    },
    async health() {
      const n = await count();
      return {
        ok: true,
        backend: 'substring',
        indexed: n,
        expected: n,
        detail: 'No index to maintain.',
      };
    },
  };
}

export function createSearchBackend(handle: Pick<DatabaseHandle, 'db' | 'dialect'>): SearchBackend {
  return handle.dialect === 'sqlite' ? fts5Backend(handle.db) : substringBackend(handle.db);
}
