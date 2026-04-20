import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchRepoByLabels } from '../src/repo-matcher.js';
import type { ValidatedRepo } from '../src/types.js';

function repo(name: string, path = `/repos/${name}`): ValidatedRepo {
  return {
    name,
    path,
    exists: true,
    techStack: [],
    summary: '',
    commits: [],
    lastChecked: new Date(),
  };
}

describe('matchRepoByLabels', () => {
  const repos: ValidatedRepo[] = [
    repo('payments-api'),
    repo('web-app'),
    repo('mobile-app'),
  ];

  it('matches case-insensitively against repo names', () => {
    assert.equal(matchRepoByLabels(['Payments-API'], repos)?.name, 'payments-api');
    assert.equal(matchRepoByLabels(['WEB-APP'], repos)?.name, 'web-app');
  });

  it('returns the first configured-repo match when multiple labels match (label order matters)', () => {
    const match = matchRepoByLabels(['mobile-app', 'web-app'], repos);
    assert.equal(match?.name, 'mobile-app');
  });

  it('returns null when no label matches any configured repo', () => {
    assert.equal(matchRepoByLabels(['bug', 'frontend'], repos), null);
  });

  it('returns null for empty inputs', () => {
    assert.equal(matchRepoByLabels([], repos), null);
    assert.equal(matchRepoByLabels(['web-app'], []), null);
  });

  it('ignores non-string / empty labels without throwing', () => {
    const match = matchRepoByLabels(
      ['', null as unknown as string, undefined as unknown as string, 'web-app'],
      repos
    );
    assert.equal(match?.name, 'web-app');
  });
});
