import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_DETECTIVE_MARKER,
  extractCommentInfo,
  extraTextOutsideTriggerPhrase,
  hasTriggerPhrase,
  isOwnComment,
  stampComment,
} from '../src/domain/comment-trigger.js';
import { markdownToAdfDoc } from '../src/infrastructure/markdown-to-adf.js';

describe('stampComment', () => {
  it('appends the marker on a fresh body', () => {
    const out = stampComment('hello');
    assert.ok(out.includes(AGENT_DETECTIVE_MARKER));
    assert.ok(out.startsWith('hello'));
  });

  it('is idempotent: never stamps twice', () => {
    const once = stampComment('hello');
    const twice = stampComment(once);
    assert.equal(twice, once);
    // One occurrence, not two.
    const occurrences = twice.split(AGENT_DETECTIVE_MARKER).length - 1;
    assert.equal(occurrences, 1);
  });

  it('returns only the marker footer for empty input (still detectable as ours)', () => {
    const out = stampComment('');
    assert.ok(out.includes(AGENT_DETECTIVE_MARKER), 'marker should be present');
    assert.ok(!out.startsWith('\n'), 'should be trimmed of leading whitespace');
  });

  it('visible footer survives a Markdown → ADF → flatten round trip (the loop-safety invariant)', () => {
    // This is the exact failure mode that triggered the loop: we rely on the
    // marker surviving whatever Jira does to the body between posting and
    // webhook echo. Simulating only the local half (Markdown → ADF) is enough
    // to catch a regression where the marker stops reaching ADF text nodes.
    const stamped = stampComment('hi there');
    const doc = markdownToAdfDoc(stamped);
    const flattened = collectAdfText(doc.content);
    assert.ok(
      flattened.includes(AGENT_DETECTIVE_MARKER),
      `expected flattened ADF to contain marker, got:\n${flattened}`
    );
  });
});

function collectAdfText(nodes: unknown[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as { text?: unknown; content?: unknown };
    if (typeof n.text === 'string') parts.push(n.text);
    if (Array.isArray(n.content)) parts.push(collectAdfText(n.content));
  }
  return parts.join(' ');
}

describe('hasTriggerPhrase', () => {
  it('matches exact phrase (case-sensitive path)', () => {
    assert.equal(hasTriggerPhrase('#agent-detective analyze', '#agent-detective analyze'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(hasTriggerPhrase('#Agent-Detective ANALYZE', '#agent-detective analyze'), true);
    assert.equal(hasTriggerPhrase('#agent-detective analyze', '#AGENT-DETECTIVE ANALYZE'), true);
  });

  it('matches substring anywhere in the body', () => {
    assert.equal(
      hasTriggerPhrase('hey team, #agent-detective analyze please', '#agent-detective analyze'),
      true
    );
  });

  it('returns false when phrase is absent', () => {
    assert.equal(hasTriggerPhrase('labels updated, let me know', '#agent-detective analyze'), false);
  });

  it('returns false for empty body or empty phrase', () => {
    assert.equal(hasTriggerPhrase('', '#agent-detective analyze'), false);
    assert.equal(hasTriggerPhrase('some text', ''), false);
  });
});

describe('extraTextOutsideTriggerPhrase', () => {
  const pr = '#agent-detective pr';

  it('returns text after the trigger when the trigger is a prefix', () => {
    assert.equal(
      extraTextOutsideTriggerPhrase(
        '#agent-detective pr this error is related to authentication.php in commit 751b957',
        pr
      ),
      'this error is related to authentication.php in commit 751b957'
    );
  });

  it('joins text before and after the trigger and normalizes spaces', () => {
    assert.equal(
      extraTextOutsideTriggerPhrase('Please check   #agent-detective pr   the auth file', pr),
      'Please check the auth file'
    );
  });

  it('is case-insensitive for locating the trigger', () => {
    assert.equal(
      extraTextOutsideTriggerPhrase('#AGENT-Detective PR hello', pr),
      'hello'
    );
  });

  it('returns empty when nothing is left', () => {
    assert.equal(extraTextOutsideTriggerPhrase('  #agent-detective pr  ', pr), '');
  });
});

describe('isOwnComment', () => {
  it('returns true when the marker is present (primary signal)', () => {
    assert.equal(
      isOwnComment(`result text\n\n${AGENT_DETECTIVE_MARKER}`, undefined, undefined),
      true
    );
  });

  it('returns false with no marker and no identity info', () => {
    assert.equal(isOwnComment('user comment', undefined, undefined), false);
    assert.equal(
      isOwnComment('user comment', { accountId: 'reporter' }, undefined),
      false
    );
  });

  it('falls back to accountId match when marker is absent', () => {
    assert.equal(
      isOwnComment(
        'user-looking comment',
        { accountId: 'bot-account' },
        { accountId: 'bot-account' }
      ),
      true
    );
  });

  it('falls back to emailAddress match (case-insensitive) when accountId is absent', () => {
    assert.equal(
      isOwnComment(
        'user-looking comment',
        { emailAddress: 'BOT@Example.com' },
        { email: 'bot@example.com' }
      ),
      true
    );
  });

  it('returns false when identity info does not match (not our comment)', () => {
    assert.equal(
      isOwnComment(
        'user comment',
        { accountId: 'reporter', emailAddress: 'reporter@example.com' },
        { accountId: 'bot-account', email: 'bot@example.com' }
      ),
      false
    );
  });

  it('handles empty/undefined body safely', () => {
    assert.equal(isOwnComment(undefined, undefined, undefined), false);
    assert.equal(isOwnComment(null, undefined, undefined), false);
  });
});

describe('extractCommentInfo', () => {
  it('returns null when the payload has no comment-shaped object', () => {
    assert.equal(extractCommentInfo(null), null);
    assert.equal(extractCommentInfo({}), null);
    assert.equal(extractCommentInfo({ issue: { key: 'K-1' } }), null);
  });

  it('extracts plain-string body + author from native webhook envelope', () => {
    const out = extractCommentInfo({
      comment: {
        body: '#agent-detective analyze',
        author: { accountId: 'u1', emailAddress: 'u1@example.com' },
      },
    });
    assert.equal(out?.body, '#agent-detective analyze');
    assert.equal(out?.author?.accountId, 'u1');
    assert.equal(out?.author?.emailAddress, 'u1@example.com');
  });

  it('flattens ADF (REST v3) body into plain text', () => {
    const out = extractCommentInfo({
      comment: {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'labels added,' },
                { type: 'text', text: ' #agent-detective analyze ' },
                { type: 'text', text: 'thanks' },
              ],
            },
          ],
        },
        author: { accountId: 'u1' },
      },
    });
    assert.ok(out);
    assert.match(out!.body, /#agent-detective analyze/);
    assert.match(out!.body, /thanks/);
  });

  it('falls back to issue.fields.comment.comments[last] when top-level comment is missing', () => {
    const out = extractCommentInfo({
      issue: {
        fields: {
          comment: {
            comments: [
              { body: 'first comment', author: { accountId: 'u1' } },
              { body: 'go now #agent-detective analyze', author: { accountId: 'u2' } },
            ],
          },
        },
      },
    });
    assert.equal(out?.body, 'go now #agent-detective analyze');
    assert.equal(out?.author?.accountId, 'u2');
  });

  it('handles comments without an author (still usable for phrase matching)', () => {
    const out = extractCommentInfo({
      comment: { body: '#agent-detective analyze' },
    });
    assert.equal(out?.body, '#agent-detective analyze');
    assert.equal(out?.author, undefined);
  });
});
