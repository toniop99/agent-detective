import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/load.js';
import { applyLogLevelAliasForObservability } from '../../src/config/env-whitelist.js';

describe('loadConfig', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test('local.json overrides default.json (precedence)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    writeFileSync(join(dir, 'default.json'), JSON.stringify({ port: 3000, agent: 'opencode' }));
    writeFileSync(join(dir, 'local.json'), JSON.stringify({ port: 4000 }));

    const cfg = loadConfig({ configRoot: dir });
    assert.strictEqual(cfg.port, 4000);
    assert.strictEqual(cfg.agent, 'opencode');
  });

  test('PORT env overrides file config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    writeFileSync(join(dir, 'default.json'), JSON.stringify({ port: 3000 }));
    process.env.PORT = '5555';

    const cfg = loadConfig({ configRoot: dir });
    assert.strictEqual(cfg.port, 5555);
  });

  test('JIRA_* merges only into existing jira plugin entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    writeFileSync(
      join(dir, 'default.json'),
      JSON.stringify({
        plugins: [{ package: '@agent-detective/jira-adapter', options: { mockMode: true } }],
      })
    );
    process.env.JIRA_API_TOKEN = 'tok';
    process.env.JIRA_EMAIL = 'a@b.c';
    process.env.JIRA_BASE_URL = 'https://x.atlassian.net';

    const cfg = loadConfig({ configRoot: dir });
    const jira = cfg.plugins?.find((p) => p.package === '@agent-detective/jira-adapter');
    assert.ok(jira?.options);
    assert.strictEqual((jira!.options as Record<string, unknown>).apiToken, 'tok');
    assert.strictEqual((jira!.options as Record<string, unknown>).email, 'a@b.c');
    assert.strictEqual((jira!.options as Record<string, unknown>).baseUrl, 'https://x.atlassian.net');
    assert.strictEqual((jira!.options as Record<string, unknown>).mockMode, true);
  });

  test('JIRA_* is ignored when jira plugin is not in config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    writeFileSync(join(dir, 'default.json'), JSON.stringify({ plugins: [] }));
    process.env.JIRA_API_TOKEN = 'tok';

    const cfg = loadConfig({ configRoot: dir });
    assert.deepStrictEqual(cfg.plugins, []);
  });

  test('REPO_CONTEXT_GIT_LOG_MAX_COMMITS merges into local-repos plugin options', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    writeFileSync(
      join(dir, 'default.json'),
      JSON.stringify({
        plugins: [{ package: '@agent-detective/local-repos-plugin', options: { repos: [] } }],
      })
    );
    process.env.REPO_CONTEXT_GIT_LOG_MAX_COMMITS = '25';

    const cfg = loadConfig({ configRoot: dir });
    const p = cfg.plugins?.find((x) => x.package === '@agent-detective/local-repos-plugin');
    const rc = (p?.options as Record<string, unknown>)?.repoContext as Record<string, unknown>;
    assert.strictEqual(rc?.gitLogMaxCommits, 25);
  });

  test('throws on invalid config shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    writeFileSync(join(dir, 'default.json'), JSON.stringify({ plugins: 'not-an-array' }));

    assert.throws(() => loadConfig({ configRoot: dir }), /Invalid application config/);
  });
});

describe('applyLogLevelAliasForObservability', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test('mirrors LOG_LEVEL to OBSERVABILITY_LOG_LEVEL when unset', () => {
    delete process.env.OBSERVABILITY_LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';

    applyLogLevelAliasForObservability();
    assert.strictEqual(process.env.OBSERVABILITY_LOG_LEVEL, 'debug');
  });

  test('does not override existing OBSERVABILITY_LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.OBSERVABILITY_LOG_LEVEL = 'error';

    applyLogLevelAliasForObservability();
    assert.strictEqual(process.env.OBSERVABILITY_LOG_LEVEL, 'error');
  });

  test('ignores invalid LOG_LEVEL values', () => {
    delete process.env.OBSERVABILITY_LOG_LEVEL;
    process.env.LOG_LEVEL = 'verbose';

    applyLogLevelAliasForObservability();
    assert.strictEqual(process.env.OBSERVABILITY_LOG_LEVEL, undefined);
  });
});
