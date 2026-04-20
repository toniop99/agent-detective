import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWebhookEventName,
  resolveWebhookEvent,
} from '../src/jira-webhook-controller.js';

type PartialReq = {
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

function mkReq(partial: PartialReq): Parameters<typeof resolveWebhookEvent>[0] {
  return {
    body: partial.body ?? {},
    query: partial.query ?? {},
  } as unknown as Parameters<typeof resolveWebhookEvent>[0];
}

describe('normalizeWebhookEventName', () => {
  it('passes through already-canonical jira:* names', () => {
    assert.equal(normalizeWebhookEventName('jira:issue_created'), 'jira:issue_created');
    assert.equal(normalizeWebhookEventName('jira:issue_updated'), 'jira:issue_updated');
  });

  it('maps Automation short names to canonical', () => {
    assert.equal(normalizeWebhookEventName('issue_created'), 'jira:issue_created');
    assert.equal(normalizeWebhookEventName('issue_updated'), 'jira:issue_updated');
    assert.equal(normalizeWebhookEventName('issue_generic'), 'jira:issue_updated');
    assert.equal(normalizeWebhookEventName('issue_deleted'), 'jira:issue_deleted');
    assert.equal(normalizeWebhookEventName('issue_commented'), 'jira:issue_commented');
  });

  it('prefixes unknown but plausible issue_* names with jira:', () => {
    assert.equal(normalizeWebhookEventName('issue_estimated'), 'jira:issue_estimated');
  });

  it('leaves unrelated strings alone', () => {
    assert.equal(normalizeWebhookEventName('custom_event'), 'custom_event');
    assert.equal(normalizeWebhookEventName('unknown'), 'unknown');
  });

  it('handles empty/whitespace input', () => {
    assert.equal(normalizeWebhookEventName(''), '');
    assert.equal(normalizeWebhookEventName('   '), '');
  });
});

describe('resolveWebhookEvent precedence', () => {
  it('prefers body.webhookEvent (classic Jira webhook)', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          webhookEvent: 'jira:issue_created',
          issue_event_type_name: 'issue_generic',
        },
        query: { webhookEvent: 'jira:issue_deleted' },
      })
    );
    assert.equal(r.source, 'body.webhookEvent');
    assert.equal(r.event, 'jira:issue_created');
    assert.equal(r.rawEvent, 'jira:issue_created');
  });

  it('uses body.issue_event_type_name (Automation format) and normalizes it', () => {
    const r = resolveWebhookEvent(
      mkReq({ body: { issue_event_type_name: 'issue_created' } })
    );
    assert.equal(r.source, 'body.issue_event_type_name');
    assert.equal(r.rawEvent, 'issue_created');
    assert.equal(r.event, 'jira:issue_created');
  });

  it('maps issue_generic to jira:issue_updated', () => {
    const r = resolveWebhookEvent(
      mkReq({ body: { issue_event_type_name: 'issue_generic' } })
    );
    assert.equal(r.event, 'jira:issue_updated');
  });

  it('uses query.webhookEvent when body has no hints (Jira format + URL override)', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: { issue: { key: 'KAN-1' }, user: {}, timestamp: 123 },
        query: { webhookEvent: 'jira:issue_created' },
      })
    );
    assert.equal(r.source, 'query.webhookEvent');
    assert.equal(r.event, 'jira:issue_created');
  });

  it('normalizes query.webhookEvent short names too', () => {
    const r = resolveWebhookEvent(
      mkReq({ query: { webhookEvent: 'issue_created' } })
    );
    assert.equal(r.event, 'jira:issue_created');
    assert.equal(r.rawEvent, 'issue_created');
  });

  it('infers jira:issue_updated from payload shape when changelog has items (Automation-format fallback)', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          // Bare-issue shape as Automation emits it, no explicit event fields,
          // no URL query string.
          key: 'KAN-11',
          fields: { summary: 's' },
          changelog: {
            items: [{ field: 'labels', fromString: '', toString: 'api' }],
          },
        },
      })
    );
    assert.equal(r.source, 'payload.shape');
    assert.equal(r.rawEvent, 'jira:issue_updated');
    assert.equal(r.event, 'jira:issue_updated');
  });

  it('infers jira:issue_created from envelope shape when no changelog is present', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          issue: { key: 'KAN-2', fields: { summary: 's' } },
        },
      })
    );
    assert.equal(r.source, 'payload.shape');
    assert.equal(r.event, 'jira:issue_created');
  });

  it('does not infer when changelog.items is empty (no real update happened)', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          key: 'KAN-3',
          fields: { summary: 's' },
          changelog: { items: [] },
        },
      })
    );
    // Empty items → treat as create-like rather than update; either way this
    // tests that we fall through to the 'created' branch, not 'updated'.
    assert.equal(r.source, 'payload.shape');
    assert.equal(r.event, 'jira:issue_created');
  });

  it('falls back to "unknown" only when the payload is not an issue shape at all', () => {
    const r = resolveWebhookEvent(mkReq({ body: { hello: 'world' } }));
    assert.equal(r.source, 'fallback');
    assert.equal(r.event, 'unknown');
  });
});
