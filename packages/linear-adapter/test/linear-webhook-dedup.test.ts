import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  shouldSkipLinearWebhookDelivery,
  __resetLinearWebhookDedupForTests,
} from '../src/infrastructure/linear-webhook-dedup.js';

describe('shouldSkipLinearWebhookDelivery', () => {
  test('allows first delivery and skips second within window', () => {
    __resetLinearWebhookDedupForTests();
    const t0 = 1_000_000;
    assert.equal(shouldSkipLinearWebhookDelivery('del-1', 60_000, t0), false);
    assert.equal(shouldSkipLinearWebhookDelivery('del-1', 60_000, t0 + 1000), true);
  });

  test('allows repeat after window', () => {
    __resetLinearWebhookDedupForTests();
    const t0 = 0;
    assert.equal(shouldSkipLinearWebhookDelivery('del-2', 1000, t0), false);
    assert.equal(shouldSkipLinearWebhookDelivery('del-2', 1000, t0 + 500), true);
    assert.equal(shouldSkipLinearWebhookDelivery('del-2', 1000, t0 + 2000), false);
  });

  test('disabled when window is 0 or id missing', () => {
    __resetLinearWebhookDedupForTests();
    assert.equal(shouldSkipLinearWebhookDelivery('x', 0, 0), false);
    assert.equal(shouldSkipLinearWebhookDelivery(undefined, 60_000, 0), false);
    assert.equal(shouldSkipLinearWebhookDelivery('   ', 60_000, 0), false);
  });
});
