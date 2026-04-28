import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJiraAuthorizeUrl,
  createJiraOAuthState,
  verifyJiraOAuthState,
} from '../src/infrastructure/jira-oauth.js';

describe('jira-oauth state', () => {
  it('creates a verifiable state token', () => {
    const secret = 'test-secret';
    const state = createJiraOAuthState(secret);
    assert.equal(typeof state, 'string');
    assert.ok(state.split('.').length === 3);
    assert.equal(verifyJiraOAuthState(state, secret), true);
  });

  it('rejects state signed with a different secret', () => {
    const state = createJiraOAuthState('secret-a');
    assert.equal(verifyJiraOAuthState(state, 'secret-b'), false);
  });
});

describe('buildJiraAuthorizeUrl', () => {
  it('includes required query params', () => {
    const url = buildJiraAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://example.com/callback',
      scope: 'read:jira-work offline_access',
      state: 'state123',
    });
    const u = new URL(url);
    assert.equal(u.origin, 'https://auth.atlassian.com');
    assert.equal(u.pathname, '/authorize');
    assert.equal(u.searchParams.get('audience'), 'api.atlassian.com');
    assert.equal(u.searchParams.get('client_id'), 'cid');
    assert.equal(u.searchParams.get('redirect_uri'), 'https://example.com/callback');
    assert.equal(u.searchParams.get('scope'), 'read:jira-work offline_access');
    assert.equal(u.searchParams.get('state'), 'state123');
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('prompt'), 'consent');
  });
});

