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

  test('parses minimal enabled config', () => {
    const r = linearAdapterOptionsSchema.parse({ enabled: true, mockMode: true });
    assert.equal(r.enabled, true);
  });
});
