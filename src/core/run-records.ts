import { appendFile } from 'node:fs/promises';
import type { Logger } from '@agent-detective/types';
import type { TaskEvent } from './types.js';

export const RUN_RECORD_SCHEMA = 'agent-detective.run-record/v1' as const;

export type RunRecordPhase = 'started' | 'completed' | 'failed';

export interface RunRecordV1 {
  schema: typeof RUN_RECORD_SCHEMA;
  phase: RunRecordPhase;
  ts: string;
  taskId: string;
  source?: string;
  issueKey?: string;
  durationMs?: number;
  error?: string;
}

export interface RunRecordWriter {
  append(record: RunRecordV1): Promise<void>;
}

export function createRunRecordWriter(
  absolutePath: string,
  logger: Pick<Logger, 'warn'>
): RunRecordWriter {
  return {
    async append(record: RunRecordV1): Promise<void> {
      try {
        await appendFile(absolutePath, `${JSON.stringify(record)}\n`, 'utf8');
      } catch (err) {
        logger.warn(`runRecords: append failed (${absolutePath}): ${(err as Error).message}`);
      }
    },
  };
}

export function buildRunRecordBase(task: TaskEvent): Pick<RunRecordV1, 'taskId' | 'source' | 'issueKey'> {
  const issueKey =
    task.replyTo?.type === 'issue' && typeof task.replyTo.id === 'string' ? task.replyTo.id : undefined;
  return {
    taskId: task.id,
    ...(typeof task.source === 'string' && task.source.length > 0 ? { source: task.source } : {}),
    ...(issueKey ? { issueKey } : {}),
  };
}
