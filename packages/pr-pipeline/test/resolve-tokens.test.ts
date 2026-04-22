import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prPipelineOptionsSchema } from '../src/options-schema.js';
import { resolveBitbucketAuth, resolveGithubToken } from '../src/resolve-tokens.js';

const saved = { ...process.env };

const defaults = prPipelineOptionsSchema.parse({});

describe('prPipelineOptionsSchema', () => {
  it('defaults enabled to true', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({}).enabled, true);
  });

  it('accepts enabled: false', () => {
    assert.strictEqual(prPipelineOptionsSchema.parse({ enabled: false }).enabled, false);
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

  it('falls back to app password when no token', () => {
    process.env.BITBUCKET_USERNAME = 'u-env';
    process.env.BITBUCKET_APP_PASSWORD = 'p-env';
    const r = resolveBitbucketAuth({
      ...defaults,
      bitbucketUsername: 'u-file',
      bitbucketAppPassword: 'p-file',
    });
    assert.deepStrictEqual(r, { mode: 'appPassword', username: 'u-env', appPassword: 'p-env' });
  });

  it('uses file app password when env unset', () => {
    const r = resolveBitbucketAuth({
      ...defaults,
      bitbucketUsername: 'u',
      bitbucketAppPassword: 'p',
    });
    assert.deepStrictEqual(r, { mode: 'appPassword', username: 'u', appPassword: 'p' });
  });

  it('returns undefined when nothing is set', () => {
    assert.strictEqual(resolveBitbucketAuth(defaults), undefined);
  });
});
