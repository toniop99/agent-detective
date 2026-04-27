import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { isWebhookTimestampFresh, verifyLinearWebhookSignature } from '../src/infrastructure/verify-linear-signature.js';

describe('verifyLinearWebhookSignature', () => {
  test('accepts valid hex signature for raw body', () => {
    const secret = 'whsec_test';
    const raw = Buffer.from('{"action":"create","type":"Issue"}', 'utf8');
    const sig = createHmac('sha256', secret).update(raw).digest('hex');
    assert.ok(verifyLinearWebhookSignature(sig, raw, secret));
  });

  test('rejects wrong secret', () => {
    const raw = Buffer.from('{}', 'utf8');
    const sig = createHmac('sha256', 'a').update(raw).digest('hex');
    assert.ok(!verifyLinearWebhookSignature(sig, raw, 'b'));
  });

  test('accepts sha256= prefix', () => {
    const secret = 'x';
    const raw = Buffer.from('hello', 'utf8');
    const sig = createHmac('sha256', secret).update(raw).digest('hex');
    assert.ok(verifyLinearWebhookSignature(`sha256=${sig}`, raw, secret));
  });
});

describe('isWebhookTimestampFresh', () => {
  test('accepts recent ms timestamp', () => {
    const now = 1_700_000_000_000;
    assert.ok(isWebhookTimestampFresh(now, now));
    assert.ok(isWebhookTimestampFresh(now - 30_000, now));
  });

  test('rejects stale timestamp', () => {
    const now = 1_700_000_000_000;
    assert.ok(!isWebhookTimestampFresh(now - 120_000, now));
  });

  test('rejects non-number', () => {
    assert.ok(!isWebhookTimestampFresh('x', Date.now()));
  });
});
