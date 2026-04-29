import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { handleAcknowledge } from '../../src/application/handlers/acknowledge-handler.js';
import type { AcknowledgeHandlerDeps } from '../../src/application/handlers/acknowledge-handler.js';
import { AGENT_DETECTIVE_MARKER } from '../../src/domain/comment-trigger.js';

interface MockComment {
  issueKey: string;
  text: string;
  createdAt: string;
}

interface MockJiraClientForTest {
  comments: MockComment[];
  addComment(issueKey: string, commentText: string): Promise<{ success: boolean; issueKey: string }>;
  getIssue?(): Promise<unknown>;
  createSubtasks?(): Promise<{ keys: string[] }>;
}

describe('Acknowledge Handler', () => {
  let mockComments: MockComment[];
  let mockJiraClient: MockJiraClientForTest;

  beforeEach(() => {
    mockComments = [];
    mockJiraClient = {
      comments: mockComments,
      async addComment(issueKey: string, commentText: string) {
        mockComments.push({
          issueKey,
          text: commentText,
          createdAt: new Date().toISOString(),
        });
        return { success: true, issueKey };
      },
      async getIssue() {
        return null;
      },
      async createSubtasks() {
        return { keys: [] };
      },
    };
  });

  it('posts acknowledgment comment to Jira', async () => {
    const deps: AcknowledgeHandlerDeps = {
      jiraClient: mockJiraClient as unknown as AcknowledgeHandlerDeps['jiraClient'],
      config: {},
    };

    const taskInfo = {
      id: 'TEST-1',
      key: 'TEST-1',
      summary: 'Test Issue',
      description: 'Test description',
      labels: [],
      projectKey: 'TEST',
    };

    await handleAcknowledge(taskInfo, 'Thanks for the update!', deps);

    assert.equal(mockComments.length, 1);
    assert.equal(mockComments[0].issueKey, 'TEST-1');
    // Every adapter-posted comment is stamped with the loop-protection
    // marker so a future `comment_created` webhook can tell our own output
    // apart from user replies.
    assert.match(mockComments[0].text, /^Thanks for the update!/);
    assert.ok(mockComments[0].text.includes(AGENT_DETECTIVE_MARKER));
  });

  it('uses default message when none provided', async () => {
    const deps: AcknowledgeHandlerDeps = {
      jiraClient: mockJiraClient as unknown as AcknowledgeHandlerDeps['jiraClient'],
      config: {},
    };

    const taskInfo = {
      id: 'TEST-2',
      key: 'TEST-2',
      summary: 'Another Test',
      description: '',
      labels: [],
      projectKey: 'TEST',
    };

    await handleAcknowledge(taskInfo, 'Thanks for the update! I will review this issue and provide feedback shortly.', deps);

    assert.equal(mockComments.length, 1);
    assert.ok(mockComments[0].text.includes('Thanks for the update!'));
  });
});
