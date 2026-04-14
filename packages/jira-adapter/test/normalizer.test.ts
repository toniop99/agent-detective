import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeJiraPayload, extractLabelsFromPayload, extractProjectKeyFromPayload, extractProjectNameFromPayload } from '../src/normalizer.js';
import issueCreatedFixture from './fixtures/issue-created.json';

describe('Jira normalizer', () => {
  it('converts jira webhook payload to TaskEvent', () => {
    const payload = {
      issue: {
        key: 'PROJ-123',
        fields: {
          summary: 'NullPointerException in UserService',
          description: 'When user logs in with empty password...',
          labels: ['backend', 'urgent'],
          project: { key: 'PROJ', name: 'My Project' },
          issuetype: { name: 'Bug' },
          reporter: { displayName: 'John Doe' },
          assignee: { displayName: 'Jane Smith' },
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
    assert.equal(event.metadata.assignee, 'Jane Smith');
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

  it('extracts project name correctly', () => {
    const payload = {
      issue: {
        fields: {
          project: { key: 'MYPROJ', name: 'My Project Name' },
        },
      },
    };

    const projectName = extractProjectNameFromPayload(payload);
    assert.equal(projectName, 'My Project Name');
  });

  it('handles real Jira webhook structure from fixture', () => {
    const event = normalizeJiraPayload(issueCreatedFixture);

    assert.equal(event.id, 'KAN-4');
    assert.equal(event.type, 'incident');
    assert.equal(event.source, 'jira');
    assert.ok(event.message.includes('Error critico en la aplicacion'));
    assert.equal(event.replyTo.type, 'issue');
    assert.equal(event.replyTo.id, 'KAN-4');
    assert.equal(event.metadata.issueType, 'Task');
    assert.equal(event.metadata.reporter, 'Antonio Hernández');
    assert.equal(event.metadata.assignee, 'Antonio Hernández');
    assert.deepEqual(event.metadata.labels, ['probando', 'symfony']);
    assert.equal(event.metadata.projectKey, 'KAN');
    assert.equal(event.metadata.projectName, 'Bug Tracking');
    assert.equal(event.metadata.priority, 'Medium');
    assert.equal(event.metadata.status, 'To Do');
    assert.equal(event.metadata.webhookEvent, 'jira:issue_created');
  });

  it('extracts user info from root level user object', () => {
    const payload = {
      webhookEvent: 'jira:issue_created',
      timestamp: 1776193443333,
      issue: {
        key: 'TEST-1',
        fields: {
          summary: 'Test issue',
          project: { key: 'TEST' },
        },
      },
      user: {
        accountId: '12345',
        displayName: 'Test User',
        emailAddress: 'test@example.com',
      },
    };

    const event = normalizeJiraPayload(payload);

    assert.equal(event.metadata.user?.accountId, '12345');
    assert.equal(event.metadata.user?.displayName, 'Test User');
    assert.equal(event.metadata.user?.emailAddress, 'test@example.com');
    assert.equal(event.metadata.timestamp, 1776193443333);
    assert.equal(event.metadata.webhookEvent, 'jira:issue_created');
  });

  it('handles ADF description format', () => {
    const payload = {
      issue: {
        key: 'PROJ-789',
        fields: {
          summary: 'ADF Description Test',
          description: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'First line of description' },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Second line' },
                ],
              },
            ],
          },
          labels: [],
          project: { key: 'PROJ' },
        },
      },
    };

    const event = normalizeJiraPayload(payload);

    assert.ok(event.message.includes('ADF Description Test'));
    assert.ok(event.message.includes('First line of description'));
    assert.ok(event.message.includes('Second line'));
  });

  it('handles null assignee gracefully', () => {
    const payload = {
      issue: {
        key: 'PROJ-999',
        fields: {
          summary: 'No assignee',
          labels: [],
          project: { key: 'PROJ' },
          assignee: null,
        },
      },
    };

    const event = normalizeJiraPayload(payload);

    assert.equal(event.metadata.assignee, null);
  });
});
