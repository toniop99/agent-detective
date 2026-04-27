import { test, describe } from 'node:test';
import assert from 'node:assert';
import { linearAdapterOptionsSchema } from '../src/application/options-schema.js';

describe('linearAdapterOptionsSchema', () => {
  test('defaults enabled to false', () => {
    const r = linearAdapterOptionsSchema.parse({});
    assert.equal(r.enabled, false);
    assert.equal(r.mockMode, true);
    assert.equal(r.skipWebhookSignatureVerification, false);
  });

  test('parses minimal enabled config with apiKey', () => {
    const r = linearAdapterOptionsSchema.parse({
      enabled: true,
      mockMode: true,
      apiKey: 'lin_test',
    });
    assert.equal(r.enabled, true);
    assert.equal(r.webhookBehavior.events?.['linear:Issue:create']?.action, 'analyze');
  });

  test('rejects unknown option keys', () => {
    const bad = linearAdapterOptionsSchema.safeParse({
      enabled: false,
      unknownField: 1,
    });
    assert.ok(!bad.success);
  });

  test('parses oauthRefreshToken with client credentials', () => {
    const r = linearAdapterOptionsSchema.parse({
      enabled: false,
      oauthClientId: 'id',
      oauthClientSecret: 'sec',
      oauthRefreshToken: 'rt',
    });
    assert.equal(r.oauthRefreshToken, 'rt');
  });
});
