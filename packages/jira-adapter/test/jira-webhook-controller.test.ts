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
    // Both Automation's `issue_commented` and the native `comment_created`
    // route to `jira:comment_created` — that's the event the new
    // comment-triggered retry flow listens for.
    assert.equal(normalizeWebhookEventName('issue_commented'), 'jira:comment_created');
    assert.equal(normalizeWebhookEventName('comment_created'), 'jira:comment_created');
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

  // Regression for the webhook-echo loop: Jira Automation's "Automation
  // format" expands `{{issue}}` which embeds the issue's REST changelog
  // *page*, not the event's item list. Once the adapter posts a comment,
  // that page gains a `histories[]` entry. We must infer `issue_updated`
  // from `histories` (not just `items`) so the default `ignore` action
  // kicks in and breaks the loop.
  it('infers jira:issue_updated from changelog.histories (Automation {{issue}}.changelog page)', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          // Bare-issue payload as Automation emits it.
          key: 'KAN-16',
          fields: { summary: 's' },
          changelog: {
            startAt: 0,
            maxResults: 100,
            total: 1,
            histories: [{ id: '1', items: [{ field: 'comment' }] }],
          },
        },
      })
    );
    assert.equal(r.source, 'payload.shape');
    assert.equal(r.event, 'jira:issue_updated');
    assert.match(r.reason ?? '', /changelog activity.*histories/);
  });

  it('infers jira:issue_updated from changelog.total when histories/items are absent', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          key: 'KAN-16',
          fields: { summary: 's' },
          changelog: { total: 3 },
        },
      })
    );
    assert.equal(r.event, 'jira:issue_updated');
    assert.match(r.reason ?? '', /total=3/);
  });

  it('still classifies a brand-new issue with an empty changelog page as created', () => {
    // Automation's `{{issue}}.changelog` on a fresh issue has no histories
    // and total=0 — must NOT be mistaken for an update.
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          key: 'KAN-17',
          fields: { summary: 's' },
          changelog: { startAt: 0, maxResults: 100, total: 0, histories: [] },
        },
      })
    );
    assert.equal(r.event, 'jira:issue_created');
  });

  it('infers jira:comment_created when Automation sends bare {{issue}} with fields.comment.comments', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          key: 'KAN-18',
          fields: {
            summary: 's',
            comment: {
              comments: [
                {
                  body: '#agent-detective pr',
                  author: { accountId: 'u1', emailAddress: 'a@example.com' },
                },
              ],
            },
          },
          changelog: { startAt: 0, maxResults: 100, total: 0, histories: [] },
        },
      })
    );
    assert.equal(r.source, 'payload.shape');
    assert.equal(r.event, 'jira:comment_created');
    assert.match(r.reason ?? '', /fields\.comment\.comments non-empty/);
  });

  it('infers jira:comment_created when a comment object is present (takes precedence over changelog)', () => {
    const r = resolveWebhookEvent(
      mkReq({
        body: {
          issue: { key: 'KAN-7', fields: { summary: 's' } },
          comment: { body: '#agent-detective analyze', author: { accountId: 'u1' } },
          // A changelog might also be present if Automation bundled a field
          // change in the same webhook — comment still wins.
          changelog: { items: [{ field: 'labels', fromString: '', toString: 'api' }] },
        },
      })
    );
    assert.equal(r.source, 'payload.shape');
    assert.equal(r.event, 'jira:comment_created');
  });

  it('falls back to "unknown" only when the payload is not an issue shape at all', () => {
    const r = resolveWebhookEvent(mkReq({ body: { hello: 'world' } }));
    assert.equal(r.source, 'fallback');
    assert.equal(r.event, 'unknown');
  });
});
