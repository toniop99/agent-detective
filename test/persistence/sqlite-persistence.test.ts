import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqliteAppPersistence } from '../../src/persistence/sqlite-app-persistence.js';

describe('createSqliteAppPersistence', () => {
  test('claim is idempotent per dedupe_key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ad-sql-'));
    const dbPath = join(dir, 't.db');
    const p = createSqliteAppPersistence(dbPath);
    const row = {
      dedupeKey: 'K:T1',
      parentIssueKey: 'K',
      taskId: 'T1',
      createdIssueKeys: [] as const,
    };
    assert.strictEqual(p.claimJiraSpawnDedupe(row), true);
    assert.strictEqual(p.claimJiraSpawnDedupe(row), false);
    p.setJiraSpawnCreatedKeys('K:T1', ['SUB-1']);
    const found = p.withTransaction((tx) => tx.findJiraSpawnByDedupeKey('K:T1'));
    assert.ok(found);
    assert.deepStrictEqual([...found!.createdIssueKeys], ['SUB-1']);
    p.deleteJiraSpawnDedupe('K:T1');
    assert.strictEqual(p.withTransaction((tx) => tx.findJiraSpawnByDedupeKey('K:T1')), null);
    assert.strictEqual(p.claimJiraSpawnDedupe(row), true);
    p.close();
  });
});
