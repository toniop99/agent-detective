import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJiraOAuthRoutes } from '../src/presentation/jira-oauth-controller.js';

function mkReply() {
  const state: {
    redirectedTo?: string;
    statusCode?: number;
    headers: Record<string, string>;
    payload?: unknown;
  } = { headers: {} };
  return {
    state,
    header(key: string, value: string) {
      state.headers[key] = value;
      return this;
    },
    code(n: number) {
      state.statusCode = n;
      return this;
    },
    send(payload: unknown) {
      state.payload = payload;
      return payload;
    },
    redirect(url: string, code: number) {
      state.redirectedTo = url;
      state.statusCode = code;
      return undefined;
    },
  };
}

describe('jira-oauth-controller', () => {
  it('still registers routes when oauth is not configured (for API docs)', () => {
    const routes = buildJiraOAuthRoutes({ config: { enabled: true, mockMode: true } });
    assert.equal(routes.length, 2);
  });

  it('oauth/start returns 501 when oauth is not configured', async () => {
    const routes = buildJiraOAuthRoutes({ config: { enabled: true, mockMode: true } });
    const start = routes.find((r) => r.url === '/oauth/start');
    assert.ok(start, 'start route missing');
    const reply = mkReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await start!.handler({} as any, reply as any);
    assert.equal(reply.state.statusCode, 501);
    assert.deepEqual(reply.state.payload, {
      status: 'error',
      message:
        'Jira OAuth is not configured. Set oauthClientId, oauthClientSecret, oauthRedirectBaseUrl (or JIRA_OAUTH_CLIENT_ID, JIRA_OAUTH_CLIENT_SECRET, JIRA_OAUTH_REDIRECT_BASE_URL).',
    });
  });

  it('oauth/start redirects to auth.atlassian.com when configured', async () => {
    const routes = buildJiraOAuthRoutes({
      config: {
        enabled: true,
        mockMode: true,
        oauthClientId: 'cid',
        oauthClientSecret: 'secret',
        oauthRedirectBaseUrl: 'https://example.com',
      },
    });
    const start = routes.find((r) => r.url === '/oauth/start');
    assert.ok(start, 'start route missing');
    const reply = mkReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await start!.handler({} as any, reply as any);
    assert.equal(reply.state.statusCode, 302);
    assert.ok(reply.state.redirectedTo);
    const u = new URL(reply.state.redirectedTo!);
    assert.equal(u.origin, 'https://auth.atlassian.com');
    assert.equal(u.pathname, '/authorize');
    assert.equal(u.searchParams.get('client_id'), 'cid');
    assert.equal(
      u.searchParams.get('redirect_uri'),
      'https://example.com/plugins/agent-detective-jira-adapter/oauth/callback'
    );
  });
});

