import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseAgentDiscoveryResponse } from '../src/discovery.js';
import type { RepoInfo } from '../src/types.js';

describe('Discovery Response Parsing', () => {
  const repos: RepoInfo[] = [
    { name: 'my-app', path: '/path/1', techStack: [], summary: 'App 1' },
    { name: 'backend-service', path: '/path/2', techStack: [], summary: 'App 2' },
    { name: 'frontend-web', path: '/path/3', techStack: [], summary: 'App 3' },
  ];

  test('handles exact match', () => {
    assert.strictEqual(parseAgentDiscoveryResponse('my-app', repos), 'my-app');
    assert.strictEqual(parseAgentDiscoveryResponse('backend-service', repos), 'backend-service');
  });

  test('handles case-insensitive match', () => {
    assert.strictEqual(parseAgentDiscoveryResponse('MY-APP', repos), 'my-app');
    assert.strictEqual(parseAgentDiscoveryResponse('Backend-Service', repos), 'backend-service');
  });

  test('handles bullet points', () => {
    assert.strictEqual(parseAgentDiscoveryResponse('- my-app', repos), 'my-app');
    assert.strictEqual(parseAgentDiscoveryResponse('* backend-service', repos), 'backend-service');
  });

  test('handles preamble with bullet point', () => {
    const response = 'I think the most relevant repository is:\n- backend-service';
    assert.strictEqual(parseAgentDiscoveryResponse(response, repos), 'backend-service');
  });

  test('handles repo name within first line', () => {
    assert.strictEqual(parseAgentDiscoveryResponse('The my-app repository seems right', repos), 'my-app');
  });

  test('handles "none" response', () => {
    assert.strictEqual(parseAgentDiscoveryResponse('none', repos), null);
    assert.strictEqual(parseAgentDiscoveryResponse('None', repos), null);
    assert.strictEqual(parseAgentDiscoveryResponse('No repository seems related.', repos), null);
  });

  test('returns null when no match found', () => {
    assert.strictEqual(parseAgentDiscoveryResponse('something-else', repos), null);
    assert.strictEqual(parseAgentDiscoveryResponse('', repos), null);
  });
});
