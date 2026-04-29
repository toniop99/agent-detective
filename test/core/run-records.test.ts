import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRunRecordWriter, RUN_RECORD_SCHEMA } from '../../src/core/run-records.js';
import type { Logger } from '@agent-detective/types';

const testLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('run-records', () => {
  let path: string;

  beforeEach(() => {
    path = join(tmpdir(), `ad-run-records-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
  });

  afterEach(() => {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  });

  it('appends JSONL lines', async () => {
    const w = createRunRecordWriter(path, testLogger);
    await w.append({
      schema: RUN_RECORD_SCHEMA,
      phase: 'started',
      ts: new Date().toISOString(),
      taskId: 't1',
    });
    await w.append({
      schema: RUN_RECORD_SCHEMA,
      phase: 'completed',
      ts: new Date().toISOString(),
      taskId: 't1',
      durationMs: 12,
    });
    const text = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(text.length, 2);
    assert.equal(JSON.parse(text[0]!).phase, 'started');
    assert.equal(JSON.parse(text[1]!).phase, 'completed');
  });

  it('survives append errors without throwing', async () => {
    const badPath = join(tmpdir(), 'nonexistent-dir-ad', 'x.jsonl');
    const w = createRunRecordWriter(badPath, testLogger);
    await assert.doesNotReject(async () => {
      await w.append({
        schema: RUN_RECORD_SCHEMA,
        phase: 'failed',
        ts: new Date().toISOString(),
        taskId: 't2',
        error: 'x',
      });
    });
  });
});
