/**
 * Database access for the pipeline.
 *
 * Uses Neon's HTTP driver rather than a TCP `pg` connection: it works from
 * anywhere HTTPS works (GitHub Actions, Vercel, and this sandbox, which blocks
 * outbound 5432), and needs no connection pooling for a batch job.
 *
 * Connects as `app_pipeline` (BYPASSRLS). That role is the whole security model
 * for the ESPN-mirror tables, so its URL lives only in CI secrets.
 */
import { neon } from '@neondatabase/serverless';
import { describeUrlProblem } from '../lib/dburl.ts';

export type Sql = ReturnType<typeof neon>;

export function connect(url = process.env.PIPELINE_DATABASE_URL): Sql {
  if (!url) {
    throw new Error(
      'PIPELINE_DATABASE_URL is not set. It must be the app_pipeline connection string.'
    );
  }
  // Same guard as the web app. A malformed value here fails deep inside the
  // driver mid-run with the value masked by the CI log scrubber and no mention
  // of which variable was at fault -- which is exactly how APP_DATABASE_URL
  // cost three builds before anyone could tell what was wrong.
  const problem = describeUrlProblem(url);
  if (problem) {
    throw new Error(
      `PIPELINE_DATABASE_URL is malformed: ${problem}. ` +
      'Expected postgresql://user:password@host/dbname?sslmode=require — ' +
      'the bare URL, with no quotes, no "psql" prefix and no variable name.'
    );
  }
  return neon(url.trim());
}

/** A single statement plus its parameters, for batching into one transaction. */
export interface Stmt {
  text: string;
  params: unknown[];
}

export const stmt = (text: string, params: unknown[] = []): Stmt => ({ text, params });

/**
 * Run every statement in ONE transaction: all of it lands or none of it does.
 *
 * This is what makes a failed run leave the database untouched rather than
 * half-updated -- the requirement that the pipeline must never write partial
 * data. Neon's HTTP driver wraps a query array in a single transaction.
 */
export async function runTransaction(sql: Sql, statements: Stmt[]): Promise<void> {
  if (statements.length === 0) return;
  // The driver reserves plain `sql(...)` for tagged templates; parameterized
  // strings must go through sql.query(), which returns a promise the
  // transaction() batch accepts.
  const q = sql as unknown as {
    query: (t: string, p: unknown[]) => unknown;
    transaction: (batch: unknown[]) => Promise<unknown>;
  };
  await q.transaction(statements.map((s) => q.query(s.text, s.params)));
}

/**
 * Build a multi-row upsert.
 *
 * Idempotence lives here: every write is INSERT ... ON CONFLICT DO UPDATE keyed
 * on the table's natural key, so re-running the pipeline for a week that was
 * already loaded overwrites it with identical values instead of duplicating or
 * failing. Re-running is therefore always safe -- which matters because the
 * Tuesday job will sometimes be re-run by hand.
 */
export function upsert(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  conflictKey: string[],
  updateColumns?: string[]
): Stmt | null {
  if (rows.length === 0) return null;

  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((c) => {
      params.push(row[c] ?? null);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const updatable = (updateColumns ?? columns).filter((c) => !conflictKey.includes(c));
  const setClause = updatable.length
    ? `do update set ${updatable.map((c) => `${c} = excluded.${c}`).join(', ')}`
    : 'do nothing';

  return stmt(
    `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')}
     on conflict (${conflictKey.join(', ')}) ${setClause}`,
    params
  );
}

/** Chunk large row sets so a single statement never exceeds parameter limits. */
export function upsertChunked(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  conflictKey: string[],
  updateColumns?: string[],
  chunkSize = 500
): Stmt[] {
  const out: Stmt[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const s = upsert(table, columns, rows.slice(i, i + chunkSize), conflictKey, updateColumns);
    if (s) out.push(s);
  }
  return out;
}
