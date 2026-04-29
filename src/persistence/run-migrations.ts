import type { DatabaseSync } from 'node:sqlite';

/** Ordered host migrations (bundled; no filesystem reads — SEA-safe). */
const BUILTIN_MIGRATIONS: readonly { readonly version: string; readonly sql: string }[] = [
  {
    version: '001_initial',
    sql: `
-- Host persistence: Jira spawn idempotency (schema_migrations ensured by runner before first apply)
CREATE TABLE IF NOT EXISTS jira_spawn_dedupe (
  dedupe_key TEXT PRIMARY KEY NOT NULL,
  parent_issue_key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_issue_keys TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jira_spawn_dedupe_parent ON jira_spawn_dedupe (parent_issue_key);
`.trim(),
  },
];

/**
 * Apply ordered migrations once each (tracked in `schema_migrations`).
 */
export function applyPendingMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY NOT NULL)`);
  for (const { version, sql } of BUILTIN_MIGRATIONS) {
    const applied = db
      .prepare('SELECT 1 AS ok FROM schema_migrations WHERE version = ?')
      .get(version) as { ok: number } | undefined;
    if (applied) continue;

    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  }
}
