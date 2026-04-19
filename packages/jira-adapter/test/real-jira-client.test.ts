import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { plainTextToAdfDoc } from '../src/real-jira-client.js';
import { jiraAdapterOptionsSchema } from '../src/options-schema.js';

describe('real-jira-client', () => {
  it('plainTextToAdfDoc wraps text in ADF paragraph', () => {
    const doc = plainTextToAdfDoc('hello');
    assert.equal(doc.type, 'doc');
    assert.ok(Array.isArray(doc.content));
    assert.equal((doc.content[0] as { type: string }).type, 'paragraph');
  });

  it('plainTextToAdfDoc splits on blank lines', () => {
    const doc = plainTextToAdfDoc('a\n\nb');
    assert.equal(doc.content.length, 2);
  });

  it('schema rejects mockMode false without credentials', () => {
    const r = jiraAdapterOptionsSchema.safeParse({
      mockMode: false,
    });
    assert.equal(r.success, false);
  });

  it('schema accepts mockMode false with credentials', () => {
    const r = jiraAdapterOptionsSchema.safeParse({
      mockMode: false,
      baseUrl: 'https://example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'token',
    });
    assert.equal(r.success, true);
  });
});
