import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildLinearAuthorizeUrl, exchangeLinearRefreshToken } from '../src/infrastructure/linear-oauth.js';

describe('buildLinearAuthorizeUrl', () => {
  test('adds actor=app when requested', () => {
    const url = buildLinearAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://example.com/cb',
      scope: 'read,write',
      state: 'st',
      actor: 'app',
    });
    const u = new URL(url);
    assert.equal(u.searchParams.get('actor'), 'app');
  });

  test('omits actor for default user authorization', () => {
    const url = buildLinearAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://example.com/cb',
      scope: 'read',
      state: 'st',
    });
    assert.equal(new URL(url).searchParams.get('actor'), null);
  });
});

describe('exchangeLinearRefreshToken', () => {
  test('POSTs refresh_token grant and parses response', async () => {
    const prev = globalThis.fetch;
    let postedBody = '';
    globalThis.fetch = async (_input, init) => {
      postedBody = typeof init?.body === 'string' ? init.body : '';
      return new Response(
        JSON.stringify({
          access_token: 'access-new',
          refresh_token: 'refresh-rotated',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    try {
      const r = await exchangeLinearRefreshToken({
        clientId: 'cid',
        clientSecret: 'sec',
        refreshToken: 'rt-old',
      });
      assert.equal(r.access_token, 'access-new');
      assert.equal(r.refresh_token, 'refresh-rotated');
      assert.equal(r.expires_in, 3600);
      const params = new URLSearchParams(postedBody);
      assert.equal(params.get('grant_type'), 'refresh_token');
      assert.equal(params.get('refresh_token'), 'rt-old');
      assert.equal(params.get('client_id'), 'cid');
      assert.equal(params.get('client_secret'), 'sec');
    } finally {
      globalThis.fetch = prev;
    }
  });

  test('throws on HTTP error', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 400 });
    try {
      await assert.rejects(
        exchangeLinearRefreshToken({
          clientId: 'c',
          clientSecret: 's',
          refreshToken: 'r',
        }),
        /token refresh failed/
      );
    } finally {
      globalThis.fetch = prev;
    }
  });
});
