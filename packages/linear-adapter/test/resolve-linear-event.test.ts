import { test, describe } from 'node:test';
import assert from 'node:assert';
import { linearCanonicalWebhookEvent } from '../src/application/resolve-linear-event.js';

describe('linearCanonicalWebhookEvent', () => {
  test('Issue create', () => {
    assert.equal(linearCanonicalWebhookEvent('Issue', 'create'), 'linear:Issue:create');
  });

  test('Comment create', () => {
    assert.equal(linearCanonicalWebhookEvent('Comment', 'create'), 'linear:Comment:create');
  });

  test('unknown composite', () => {
    assert.equal(linearCanonicalWebhookEvent('Foo', 'bar'), 'linear:Foo:bar');
  });
});
