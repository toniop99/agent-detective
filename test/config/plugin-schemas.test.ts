import { test, describe } from 'node:test';
import assert from 'node:assert';
import { localReposPluginOptionsSchema } from '@agent-detective/local-repos-plugin';
import { jiraAdapterOptionsSchema } from '@agent-detective/jira-adapter';

describe('plugin Zod schemas (.strict)', () => {
  test('local-repos rejects unknown option keys', () => {
    const bad = localReposPluginOptionsSchema.safeParse({
      repos: [],
      discovery: { enabled: true },
    });
    assert.ok(!bad.success);
  });

  test('jira rejects unknown option keys', () => {
    const bad = jiraAdapterOptionsSchema.safeParse({
      webhookPath: '/nope',
      enabled: true,
      mockMode: true,
    });
    assert.ok(!bad.success);
  });
});
