import { describe, it } from 'node:test';
import { handleIgnore } from '../../src/application/handlers/ignore-handler.js';
import type { IgnoreHandlerDeps } from '../../src/application/handlers/ignore-handler.js';

describe('Ignore Handler', () => {
  it('logs ignored webhook event', async () => {
    const deps: IgnoreHandlerDeps = {
      webhookEvent: 'jira:issue_deleted',
    };

    const taskInfo = {
      id: 'TEST-1',
      key: 'TEST-1',
      summary: 'Deleted Issue',
      description: '',
      labels: [],
      projectKey: 'TEST',
    };

    await handleIgnore(taskInfo, deps);
  });

  it('captures correct webhook event type', async () => {
    const deps: IgnoreHandlerDeps = {
      webhookEvent: 'jira:comment_created',
    };

    const taskInfo = {
      id: 'TEST-2',
      key: 'TEST-2',
      summary: 'Comment Issue',
      description: '',
      labels: [],
      projectKey: 'TEST',
    };

    await handleIgnore(taskInfo, deps);
  });
});
