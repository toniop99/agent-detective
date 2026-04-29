import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  appendStructuredMetadataBlock,
  buildJiraCommentMetadata,
  JIRA_COMMENT_METADATA_SCHEMA,
} from '../src/application/structured-comment-metadata.js';
import type { TaskEvent } from '@agent-detective/sdk';

describe('structured-comment-metadata', () => {
  it('builds v1 metadata with issue key and repo', () => {
    const task: TaskEvent = {
      id: 'task-uuid-1',
      type: 'incident',
      source: '@agent-detective/jira-adapter',
      message: 'x',
      context: { repoPath: null, threadId: null, cwd: '/tmp' },
      metadata: {},
      replyTo: { type: 'issue', id: 'PROJ-42' },
    };

    const meta = buildJiraCommentMetadata(task, 'my-repo');
    assert.equal(meta.schema, JIRA_COMMENT_METADATA_SCHEMA);
    assert.equal(meta.taskId, 'task-uuid-1');
    assert.equal(meta.issueKey, 'PROJ-42');
    assert.equal(meta.matchedRepo, 'my-repo');
    assert.ok(meta.completedAt.length > 10);
  });

  it('appends fenced JSON after narrative', () => {
    const task: TaskEvent = {
      id: 't2',
      type: 'incident',
      source: 'src',
      message: 'm',
      context: { repoPath: null, threadId: null, cwd: '/tmp' },
      metadata: {},
      replyTo: { type: 'issue', id: 'K-1' },
    };
    const meta = buildJiraCommentMetadata(task, null);
    const out = appendStructuredMetadataBlock('Hello analysis', meta);
    assert.ok(out.startsWith('Hello analysis'));
    assert.ok(out.includes('```json'));
    assert.ok(out.includes(JIRA_COMMENT_METADATA_SCHEMA));
    assert.ok(out.includes('"taskId":"t2"'));
  });
});
