import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prPipelineOptionsSchema } from '../src/application/options-schema.js';
import { resolveBitbucketAuth, resolveGithubToken } from '../src/infrastructure/resolve-tokens.js';

const saved = { ...process.env };

const defaults = prPipelineOptionsSchema.parse({});

describe('prPipelineOptionsSchema', () => {
  it('defaults enabled to true', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({}).enabled, true);
  });

  it('accepts enabled: false', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({ enabled: false }).enabled, false);
  });

  it('defaults worktreeSetupCommands to empty array', () => {
    assert.deepStrictEqual(prPipelineOptionsSchema.parse({}).worktreeSetupCommands, []);
  });

  it('accepts worktreeSetupCommands as array of strings', () => {
    const result = prPipelineOptionsSchema.parse({ worktreeSetupCommands: ['cp {{mainPath}}/.env .env'] });
    assert.deepStrictEqual(result.worktreeSetupCommands, ['cp {{mainPath}}/.env .env']);
  });

  it('rejects worktreeInstallDeps (removed option)', () => {
    const bad = prPipelineOptionsSchema.safeParse({ worktreeInstallDeps: true });
    assert.ok(!bad.success);
  });

  it('defaults includeIssueComments to true', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({}).includeIssueComments, true);
  });

  it('accepts includeIssueComments: false', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({ includeIssueComments: false }).includeIssueComments, false);
  });

  it('defaults triage.enabled to false', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({}).triage.enabled, false);
  });

  it('defaults triage.timeoutMs to 60000', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({}).triage.timeoutMs, 60_000);
  });

  it('accepts triage with model and agent overrides', () => {
    const result = prPipelineOptionsSchema.parse({
      triage: { enabled: true, model: 'claude-haiku-4-5-20251001', agent: 'claude', timeoutMs: 30_000 },
    });
    assert.strictEqual(result.triage.enabled, true);
    assert.strictEqual(result.triage.model, 'claude-haiku-4-5-20251001');
    assert.strictEqual(result.triage.agent, 'claude');
    assert.strictEqual(result.triage.timeoutMs, 30_000);
  });

  it('defaults images.enabled to false', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({}).images.enabled, false);
  });

  it('defaults images.maxCount to 5', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({}).images.maxCount, 5);
  });

  it('defaults images.maxTotalBytes to 10MB', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({}).images.maxTotalBytes, 10 * 1024 * 1024);
  });

  it('accepts images with custom limits', () => {
    const result = prPipelineOptionsSchema.parse({
      images: { enabled: true, maxCount: 3, maxTotalBytes: 5 * 1024 * 1024 },
    });
    assert.strictEqual(result.images.enabled, true);
    assert.strictEqual(result.images.maxCount, 3);
    assert.strictEqual(result.images.maxTotalBytes, 5 * 1024 * 1024);
  });
});

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('GITHUB_') || k === 'GH_TOKEN' || k.startsWith('BITBUCKET_')) {
      delete process.env[k];
    }
  }
});

afterEach(() => {
  process.env = { ...saved };
});

describe('resolveGithubToken', () => {
  it('prefers GITHUB_TOKEN over file', () => {
    process.env.GITHUB_TOKEN = 'from-env-gh';
    process.env.GH_TOKEN = 'from-env-alt';
    assert.strictEqual(
      resolveGithubToken({ ...defaults, githubToken: 'from-file' }),
      'from-env-gh'
    );
  });

  it('uses GH_TOKEN when GITHUB_TOKEN unset', () => {
    process.env.GH_TOKEN = 'from-gh';
    assert.strictEqual(
      resolveGithubToken({ ...defaults, githubToken: 'from-file' }),
      'from-gh'
    );
  });

  it('falls back to options.githubToken', () => {
    assert.strictEqual(resolveGithubToken({ ...defaults, githubToken: 'f' }), 'f');
  });
});

describe('resolveBitbucketAuth', () => {
  it('prefers access token from env over app password in file', () => {
    process.env.BITBUCKET_TOKEN = 'bbatoken';
    const r = resolveBitbucketAuth({
      ...defaults,
      bitbucketToken: 'file-token',
      bitbucketUsername: 'u',
      bitbucketAppPassword: 'p',
    });
    assert.deepStrictEqual(r, { mode: 'token', token: 'bbatoken' });
  });

  it('uses file bitbucketToken when env unset', () => {
    const r = resolveBitbucketAuth({
      ...defaults,
      bitbucketToken: 'file-only',
      bitbucketUsername: 'u',
      bitbucketAppPassword: 'p',
    });
    assert.deepStrictEqual(r, { mode: 'token', token: 'file-only' });
  });

  it('prefers env BITBUCKET_TOKEN over file bitbucketToken', () => {
    process.env.BITBUCKET_TOKEN = 'from-env';
    const r = resolveBitbucketAuth({ ...defaults, bitbucketToken: 'from-file' });
    assert.deepStrictEqual(r, { mode: 'token', token: 'from-env' });
  });

  it('falls back to app password when no token, email falls back to username', () => {
    process.env.BITBUCKET_USERNAME = 'u-env';
    process.env.BITBUCKET_APP_PASSWORD = 'p-env';
    const r = resolveBitbucketAuth({
      ...defaults,
      bitbucketUsername: 'u-file',
      bitbucketAppPassword: 'p-file',
    });
    assert.deepStrictEqual(r, { mode: 'appPassword', username: 'u-env', email: 'u-env', appPassword: 'p-env' });
  });

  it('uses BITBUCKET_EMAIL for REST when set', () => {
    process.env.BITBUCKET_USERNAME = 'myuser';
    process.env.BITBUCKET_EMAIL = 'me@example.com';
    process.env.BITBUCKET_APP_PASSWORD = 'mytoken';
    const r = resolveBitbucketAuth(defaults);
    assert.deepStrictEqual(r, { mode: 'appPassword', username: 'myuser', email: 'me@example.com', appPassword: 'mytoken' });
  });

  it('uses bitbucketEmail option when env unset', () => {
    const r = resolveBitbucketAuth({
      ...defaults,
      bitbucketUsername: 'u',
      bitbucketEmail: 'u@example.com',
      bitbucketAppPassword: 'p',
    });
    assert.deepStrictEqual(r, { mode: 'appPassword', username: 'u', email: 'u@example.com', appPassword: 'p' });
  });

  it('uses file app password when env unset, email falls back to username', () => {
    const r = resolveBitbucketAuth({
      ...defaults,
      bitbucketUsername: 'u',
      bitbucketAppPassword: 'p',
    });
    assert.deepStrictEqual(r, { mode: 'appPassword', username: 'u', email: 'u', appPassword: 'p' });
  });

  it('returns undefined when nothing is set', () => {
    assert.strictEqual(resolveBitbucketAuth(defaults), undefined);
  });
});
