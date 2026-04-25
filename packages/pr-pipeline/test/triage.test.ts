import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTriageVerdict } from '../src/application/run-pr-workflow.js';

describe('parseTriageVerdict', () => {
  it('returns proceed:true on VERDICT: PROCEED', () => {
    const result = parseTriageVerdict('Looking at the code...\n\nVERDICT: PROCEED');
    assert.equal(result.proceed, true);
  });

  it('returns proceed:false with reason on VERDICT: SKIP - reason', () => {
    const result = parseTriageVerdict('Analysis done.\n\nVERDICT: SKIP - This is a data configuration issue, not a code bug.');
    assert.equal(result.proceed, false);
    assert.equal(result.reason, 'This is a data configuration issue, not a code bug.');
  });

  it('returns proceed:false with default reason on VERDICT: SKIP without reason', () => {
    const result = parseTriageVerdict('VERDICT: SKIP');
    assert.equal(result.proceed, false);
    assert.ok(result.reason.length > 0);
  });

  it('fails open (proceed:true) when no verdict line is present', () => {
    const result = parseTriageVerdict('I looked at the code and it seems fine.');
    assert.equal(result.proceed, true);
  });

  it('fails open on empty text', () => {
    const result = parseTriageVerdict('');
    assert.equal(result.proceed, true);
  });

  it('finds verdict at the end even when buried in long output', () => {
    const text = [
      'The issue mentions a login failure.',
      'I checked src/auth/login.ts and the logic looks correct.',
      'The database query returns the right values.',
      'This appears to be a misconfigured environment variable.',
      '',
      'VERDICT: SKIP - Environment variable AUTH_SECRET is not set in production.',
    ].join('\n');
    const result = parseTriageVerdict(text);
    assert.equal(result.proceed, false);
    assert.match(result.reason, /AUTH_SECRET/);
  });

  it('is case-insensitive for the VERDICT prefix', () => {
    assert.equal(parseTriageVerdict('verdict: proceed').proceed, true);
    assert.equal(parseTriageVerdict('verdict: skip - data issue').proceed, false);
  });

  it('handles em-dash separator in SKIP verdict', () => {
    const result = parseTriageVerdict('VERDICT: SKIP – Already fixed in a recent commit.');
    assert.equal(result.proceed, false);
    assert.match(result.reason, /Already fixed/);
  });
});
