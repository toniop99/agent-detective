import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AppPersistence,
  AppPersistenceTxn,
  JiraSpawnDedupeInsert,
  JiraSpawnDedupeRow,
  Logger,
} from '@agent-detective/types';
import { applyPendingMigrations } from './run-migrations.js';

function parseKeysJson(raw: string): readonly string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export function createSqliteAppPersistence(
  databasePath: string,
  options?: { logger?: Pick<Logger, 'warn' | 'info'> }
): AppPersistence {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  applyPendingMigrations(db);

  const log = options?.logger;

  const wrapTxn: AppPersistenceTxn = {
    findJiraSpawnByDedupeKey(dedupeKey: string): JiraSpawnDedupeRow | null {
      const row = db
        .prepare(
          `SELECT dedupe_key, parent_issue_key, task_id, created_issue_keys, created_at
           FROM jira_spawn_dedupe WHERE dedupe_key = ?`
        )
        .get(dedupeKey) as
        | {
            dedupe_key: string;
            parent_issue_key: string;
            task_id: string;
            created_issue_keys: string;
            created_at: string;
          }
        | undefined;
      if (!row) return null;
      return {
        dedupeKey: row.dedupe_key,
        parentIssueKey: row.parent_issue_key,
        taskId: row.task_id,
        createdIssueKeys: parseKeysJson(row.created_issue_keys),
        createdAt: row.created_at,
      };
    },
    recordJiraSpawnDedupe(row: JiraSpawnDedupeInsert): void {
      db.prepare(
        `INSERT INTO jira_spawn_dedupe (dedupe_key, parent_issue_key, task_id, created_issue_keys, created_at)
         VALUES (@dedupeKey, @parentIssueKey, @taskId, @createdIssueKeys, datetime('now'))`
      ).run({
        dedupeKey: row.dedupeKey,
        parentIssueKey: row.parentIssueKey,
        taskId: row.taskId,
        createdIssueKeys: JSON.stringify([...row.createdIssueKeys]),
      });
    },
  };

  return {
    withTransaction<T>(fn: (tx: AppPersistenceTxn) => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn(wrapTxn);
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    claimJiraSpawnDedupe(row: JiraSpawnDedupeInsert): boolean {
      const stmt = db.prepare(
        `INSERT INTO jira_spawn_dedupe (dedupe_key, parent_issue_key, task_id, created_issue_keys, created_at)
         SELECT @dedupeKey, @parentIssueKey, @taskId, @createdIssueKeys, datetime('now')
         WHERE NOT EXISTS (SELECT 1 FROM jira_spawn_dedupe WHERE dedupe_key = @dedupeKey)`
      );
      const info = stmt.run({
        dedupeKey: row.dedupeKey,
        parentIssueKey: row.parentIssueKey,
        taskId: row.taskId,
        createdIssueKeys: JSON.stringify([...row.createdIssueKeys]),
      }) as { changes: number };
      return info.changes > 0;
    },

    setJiraSpawnCreatedKeys(dedupeKey: string, keys: readonly string[]): void {
      db.prepare(`UPDATE jira_spawn_dedupe SET created_issue_keys = ? WHERE dedupe_key = ?`).run(
        JSON.stringify([...keys]),
        dedupeKey
      );
    },

    deleteJiraSpawnDedupe(dedupeKey: string): void {
      db.prepare(`DELETE FROM jira_spawn_dedupe WHERE dedupe_key = ?`).run(dedupeKey);
    },

    close(): void {
      try {
        db.close();
      } catch (err) {
        log?.warn?.(`persistence: close failed: ${(err as Error).message}`);
      }
    },
  };
}
