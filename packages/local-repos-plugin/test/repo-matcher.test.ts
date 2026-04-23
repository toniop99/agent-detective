import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchRepoByLabels, matchAllReposByLabels } from '../src/domain/repo-matcher.js';
import type { ValidatedRepo } from '../src/domain/types.js';

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

describe('matchAllReposByLabels', () => {
  const repos: ValidatedRepo[] = [
    repo('payments-api'),
    repo('web-app'),
    repo('mobile-app'),
  ];

  it('returns every configured repo whose name appears in the labels (fan-out)', () => {
    const matches = matchAllReposByLabels(['bug', 'web-app', 'mobile-app'], repos);
    assert.deepEqual(
      matches.map((r) => r.name),
      ['web-app', 'mobile-app']
    );
  });

  it('returns matches in configured-repo order regardless of label order (stable output)', () => {
    const matches = matchAllReposByLabels(['mobile-app', 'payments-api', 'web-app'], repos);
    assert.deepEqual(
      matches.map((r) => r.name),
      ['payments-api', 'web-app', 'mobile-app']
    );
  });

  it('matches case-insensitively', () => {
    const matches = matchAllReposByLabels(['WEB-APP', 'Mobile-App'], repos);
    assert.deepEqual(
      matches.map((r) => r.name),
      ['web-app', 'mobile-app']
    );
  });

  it('dedupes when the same repo is labeled twice (different casing)', () => {
    const matches = matchAllReposByLabels(['web-app', 'WEB-APP', 'Web-App'], repos);
    assert.deepEqual(
      matches.map((r) => r.name),
      ['web-app']
    );
  });

  it('returns an empty array when nothing matches', () => {
    assert.deepEqual(matchAllReposByLabels(['bug', 'frontend'], repos), []);
  });

  it('returns an empty array for empty inputs', () => {
    assert.deepEqual(matchAllReposByLabels([], repos), []);
    assert.deepEqual(matchAllReposByLabels(['web-app'], []), []);
  });

  it('ignores non-string / empty labels without throwing', () => {
    const matches = matchAllReposByLabels(
      ['', null as unknown as string, undefined as unknown as string, 'web-app'],
      repos
    );
    assert.deepEqual(
      matches.map((r) => r.name),
      ['web-app']
    );
  });
});
