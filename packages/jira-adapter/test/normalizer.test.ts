import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeJiraPayload, extractLabelsFromPayload, extractProjectKeyFromPayload } from '../src/normalizer.js';

describe('Jira normalizer', () => {
  it('converts jira webhook payload to TaskEvent', () => {
    const payload = {
      issue: {
        key: 'PROJ-123',
        fields: {
          summary: 'NullPointerException in UserService',
          description: 'When user logs in with empty password...',
          labels: ['backend', 'urgent'],
          project: { key: 'PROJ' },
          issuetype: { name: 'Bug' },
          reporter: { displayName: 'John Doe' },
          priority: { name: 'High' },
          status: { name: 'Open' },
        },
      },
    };

    const event = normalizeJiraPayload(payload);

    assert.equal(event.id, 'PROJ-123');
    assert.equal(event.type, 'incident');
    assert.equal(event.source, 'jira');
    assert.ok(event.message.includes('NullPointerException'));
    assert.equal(event.replyTo.type, 'issue');
    assert.equal(event.replyTo.id, 'PROJ-123');
    assert.equal(event.metadata.issueType, 'Bug');
    assert.equal(event.metadata.reporter, 'John Doe');
    assert.deepEqual(event.metadata.labels, ['backend', 'urgent']);
  });

  it('handles minimal payload', () => {
    const payload = {
      issue: {
        key: 'PROJ-456',
        fields: {
          summary: 'Simple issue',
        },
      },
    };

    const event = normalizeJiraPayload(payload);

    assert.equal(event.id, 'PROJ-456');
    assert.equal(event.type, 'incident');
    assert.ok(event.message.includes('Simple issue'));
  });

  it('extracts labels correctly', () => {
    const payload = {
      issue: {
        fields: {
          labels: ['frontend', 'ui', 'bug'],
        },
      },
    };

    const labels = extractLabelsFromPayload(payload);
    assert.deepEqual(labels, ['frontend', 'ui', 'bug']);
  });

  it('extracts project key correctly', () => {
    const payload = {
      issue: {
        fields: {
          project: { key: 'MYPROJ' },
        },
      },
    };

    const projectKey = extractProjectKeyFromPayload(payload);
    assert.equal(projectKey, 'MYPROJ');
  });
});
