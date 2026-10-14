/**
 * Database-target safety for `jobs-admin`.
 *
 * The admin CLI loads its connection string from env files, so a shell in the
 * wrong directory or with the wrong NODE_ENV can silently point it at a
 * different database than the one the worker uses. Every command therefore
 * (1) prints the selected database, (2) refuses ambiguous targets, and
 * (3) for state-changing commands requires the operator to TYPE the database
 * name. Pure functions; no I/O except `confirmDatabase`'s prompt.
 */
export interface DbTarget {
  dbName: string | null;
  hosts: string[];
  scheme: string;
  /** True when the URI path names a database explicitly (otherwise the driver silently uses "test"). */
  hasExplicitDb: boolean;
}

export function parseMongoTarget(uri: string): DbTarget {
  const m = String(uri || '').match(/^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?]+)(\/[^?]*)?(\?.*)?$/i);
  if (!m) return { dbName: null, hosts: [], scheme: '', hasExplicitDb: false };
  const dbName = (m[3] || '').replace(/^\//, '') || null;
  return {
    dbName,
    hosts: m[2].split(',').map((h) => h.toLowerCase()),
    scheme: m[1].toLowerCase(),
    hasExplicitDb: !!dbName,
  };
}

export interface TargetVerdict {
  ok: boolean;
  /** Reasons the target is refused outright. */
  problems: string[];
  /** Non-blocking cautions shown to the operator. */
  warnings: string[];
}

export function evaluateAdminTarget(t: DbTarget, env: NodeJS.ProcessEnv = process.env): TargetVerdict {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!t.scheme) problems.push('MONGODB_URI could not be parsed');
  if (t.scheme && !t.hasExplicitDb) {
    problems.push('MONGODB_URI names no database; the driver would silently use "test" (ambiguous target)');
  }
  const looksProd = !!t.dbName && /prod/i.test(t.dbName);
  const prodEnv = env.NODE_ENV === 'production';
  if (looksProd && !prodEnv && env.ALLOW_PROD_DB !== 'iunderstand') {
    problems.push(
      `database "${t.dbName}" looks like production but NODE_ENV is not production (wrong env file?). ` +
        'Set ALLOW_PROD_DB=iunderstand to override.'
    );
  }
  if (prodEnv && t.dbName && /(^|[_-])(dev|test|local|staging|qa)([_-]|$)/i.test(t.dbName) && env.ALLOW_NONPROD_DB_IN_PROD !== 'iunderstand') {
    warnings.push(`NODE_ENV=production but database "${t.dbName}" looks non-production; confirm this is intended.`);
  }
  if (t.dbName === 'test') warnings.push('database is the MongoDB default "test"');
  return { ok: problems.length === 0, problems, warnings };
}

export interface ConfirmInput {
  expected: string;
  /** Value of `--confirm-db`, if given. */
  flag?: string;
  /** Interactive prompt (TTY only); returns what the operator typed. */
  prompt?: (question: string) => Promise<string>;
}

/** True only when the operator typed the exact database name (flag or interactive). Never defaults to yes. */
export async function confirmDatabase(i: ConfirmInput): Promise<boolean> {
  if (i.flag !== undefined) return i.flag === i.expected;
  if (!i.prompt) return false;
  const answer = await i.prompt(`This changes queue state in database "${i.expected}". Type the database name to confirm: `);
  return answer.trim() === i.expected;
}
