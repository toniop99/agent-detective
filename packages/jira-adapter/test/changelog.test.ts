import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractAddedLabelsFromChangelog, extractLabelsBeforeUpdate } from '../src/changelog.js';

describe('extractAddedLabelsFromChangelog', () => {
  it('returns [] when there is no changelog', () => {
    assert.deepEqual(extractAddedLabelsFromChangelog({}), []);
    assert.deepEqual(extractAddedLabelsFromChangelog({ issue: { key: 'K-1' } }), []);
    assert.deepEqual(extractAddedLabelsFromChangelog(null), []);
  });

  it('returns [] when labels item is present but nothing was added', () => {
    const payload = {
      changelog: {
        items: [{ field: 'labels', fromString: 'bug frontend', toString: 'bug' }],
      },
    };
    assert.deepEqual(extractAddedLabelsFromChangelog(payload), []);
  });

  it('returns newly added labels even when other fields also changed in the same update', () => {
    const payload = {
      changelog: {
        items: [
          { field: 'status', fromString: 'Open', toString: 'In Progress' },
          { field: 'labels', fromString: 'bug', toString: 'bug web-app' },
        ],
      },
    };
    assert.deepEqual(extractAddedLabelsFromChangelog(payload), ['web-app']);
  });

  it('works on Automation "bare-issue" payload variant (changelog at top level)', () => {
    // Automation format emits the issue resource at the top level, but the
    // changelog stays at the root of the envelope — our helper reads
    // `payload.changelog.items` directly, so both shapes pass through.
    const payload = {
      key: 'K-10',
      fields: { summary: 's' },
      changelog: {
        items: [{ field: 'labels', fromString: '', toString: 'api' }],
      },
    };
    assert.deepEqual(extractAddedLabelsFromChangelog(payload), ['api']);
  });

  it('returns multiple added labels across multiple labels items, de-duplicated', () => {
    const payload = {
      changelog: {
        items: [
          { field: 'labels', fromString: '', toString: 'api web' },
          { field: 'labels', fromString: 'api', toString: 'api web' },
        ],
      },
    };
    assert.deepEqual(extractAddedLabelsFromChangelog(payload), ['api', 'web']);
  });

  it('ignores malformed / missing fields without throwing', () => {
    const payload: unknown = {
      changelog: {
        items: [
          null,
          { field: 'labels' },
          { field: 'labels', fromString: null, toString: 'api' },
        ],
      },
    };
    assert.deepEqual(extractAddedLabelsFromChangelog(payload), ['api']);
  });
});

describe('extractLabelsBeforeUpdate', () => {
  it('returns [] when there is no labels changelog item', () => {
    assert.deepEqual(extractLabelsBeforeUpdate({}), []);
    assert.deepEqual(
      extractLabelsBeforeUpdate({
        changelog: { items: [{ field: 'status', fromString: 'Open', toString: 'Closed' }] },
      }),
      []
    );
  });

  it('returns labels from fromString (space-separated)', () => {
    const payload = {
      changelog: {
        items: [{ field: 'labels', fromString: 'bug web-app', toString: 'bug web-app api' }],
      },
    };
    assert.deepEqual(extractLabelsBeforeUpdate(payload), ['bug', 'web-app']);
  });

  it('returns [] when fromString is empty (first-ever labels add)', () => {
    const payload = {
      changelog: {
        items: [{ field: 'labels', fromString: '', toString: 'api' }],
      },
    };
    assert.deepEqual(extractLabelsBeforeUpdate(payload), []);
  });

  it('merges labels across multiple labels items, de-duplicated', () => {
    const payload = {
      changelog: {
        items: [
          { field: 'labels', fromString: 'api', toString: 'api web' },
          { field: 'labels', fromString: 'api bug', toString: 'api bug web' },
        ],
      },
    };
    assert.deepEqual(extractLabelsBeforeUpdate(payload).sort(), ['api', 'bug']);
  });
});
