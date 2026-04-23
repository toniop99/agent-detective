import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRealJiraClient, plainTextToAdfDoc, type Version3ClientSurface } from '../src/real-jira-client.js';
import { jiraAdapterOptionsSchema } from '../src/options-schema.js';
import { HttpException } from 'jira.js';

function createStubClient(): {
  client: Version3ClientSurface;
  spies: {
    addComment: Array<Record<string, unknown>>;
    getIssue: Array<Record<string, unknown>>;
    editIssue: Array<Record<string, unknown>>;
    getComments: Array<Record<string, unknown>>;
  };
  nextAddCommentError?: unknown;
  nextGetIssueError?: unknown;
  nextGetCommentsResponse?: unknown;
  nextGetIssueResponse?: unknown;
} {
  const spies = {
    addComment: [] as Array<Record<string, unknown>>,
    getIssue: [] as Array<Record<string, unknown>>,
    editIssue: [] as Array<Record<string, unknown>>,
    getComments: [] as Array<Record<string, unknown>>,
  };
  const ctx: {
    client: Version3ClientSurface;
    spies: typeof spies;
    nextAddCommentError?: unknown;
    nextGetIssueError?: unknown;
    nextGetCommentsResponse?: unknown;
    nextGetIssueResponse?: unknown;
  } = { client: {} as Version3ClientSurface, spies };

  const issueComments = {
    async addComment(params: Record<string, unknown>) {
      spies.addComment.push(params);
      if (ctx.nextAddCommentError) {
        // One-shot: clear after throwing so retries can observe success
        // unless the test explicitly re-arms the error.
        const err = ctx.nextAddCommentError;
        ctx.nextAddCommentError = undefined;
        throw err;
      }
      return { id: '10001', body: params.comment } as unknown;
    },
    async getComments(params: Record<string, unknown>) {
      spies.getComments.push(params);
      return (ctx.nextGetCommentsResponse ?? { comments: [] }) as unknown;
    },
  };

  const issues = {
    async getIssue(params: Record<string, unknown>) {
      spies.getIssue.push(params);
      if (ctx.nextGetIssueError) throw ctx.nextGetIssueError;
      return (ctx.nextGetIssueResponse ?? { key: params.issueIdOrKey, fields: {} }) as unknown;
    },
    async editIssue(params: Record<string, unknown>) {
      spies.editIssue.push(params);
      return undefined;
    },
  };

  ctx.client = { issueComments, issues } as unknown as Version3ClientSurface;
  return ctx;
}

describe('real-jira-client', () => {
  it('plainTextToAdfDoc wraps text in ADF paragraph', () => {
    const doc = plainTextToAdfDoc('hello');
    assert.equal(doc.type, 'doc');
    assert.ok(Array.isArray(doc.content));
    assert.equal((doc.content[0] as { type: string }).type, 'paragraph');
  });

  it('plainTextToAdfDoc splits on blank lines', () => {
    const doc = plainTextToAdfDoc('a\n\nb');
    assert.equal(doc.content.length, 2);
  });

  it('schema rejects mockMode false without credentials', () => {
    const r = jiraAdapterOptionsSchema.safeParse({ mockMode: false });
    assert.equal(r.success, false);
  });

  it('schema accepts mockMode false with credentials', () => {
    const r = jiraAdapterOptionsSchema.safeParse({
      mockMode: false,
      baseUrl: 'https://example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'token',
    });
    assert.equal(r.success, true);
  });

  it('createRealJiraClient throws when credentials are incomplete and no client override', () => {
    assert.throws(
      () => createRealJiraClient({ baseUrl: 'https://x.atlassian.net', email: 'a@b.c' }),
      /baseUrl, email, or apiToken is missing/
    );
  });

  it('createRealJiraClient accepts a client override without requiring credentials', () => {
    const stub = createStubClient();
    const client = createRealJiraClient({}, { client: stub.client });
    assert.ok(client);
  });

  it('addComment delegates to client.issueComments.addComment with ADF body', async () => {
    const stub = createStubClient();
    const client = createRealJiraClient(
      {
        baseUrl: 'https://acme.atlassian.net',
        email: 'bot@example.com',
        apiToken: 'secret-token',
      },
      { client: stub.client }
    );

    const out = await client.addComment('KAN-42', 'Root cause: null deref');
    assert.deepEqual(out, { success: true, issueKey: 'KAN-42' });
    assert.equal(stub.spies.addComment.length, 1);

    const call = stub.spies.addComment[0]!;
    assert.equal(call.issueIdOrKey, 'KAN-42');
    const body = call.comment as { type: string; content: unknown[] };
    assert.equal(body.type, 'doc');
    assert.ok(Array.isArray(body.content));
  });

  it('addComment renders Markdown as rich ADF (headings, code blocks, marks)', async () => {
    const stub = createStubClient();
    const client = createRealJiraClient({}, { client: stub.client });

    const md = [
      '## Root cause',
      '',
      '**Likely cause:** null deref in `parseUser`.',
      '',
      '```ts',
      'const name = user.profile?.name;',
      '```',
      '',
      '- touch `src/parse.ts:42`',
      '- add a regression test',
    ].join('\n');

    await client.addComment('KAN-42', md);

    const body = stub.spies.addComment[0]!.comment as {
      type: string;
      content: Array<{ type: string; [k: string]: unknown }>;
    };
    const types = body.content.map((n) => n.type);
    assert.ok(types.includes('heading'), `expected heading node, got: ${types.join(',')}`);
    assert.ok(types.includes('codeBlock'), 'expected codeBlock node');
    assert.ok(types.includes('bulletList'), 'expected bulletList node');
  });

  it('addComment wraps HttpException into a descriptive Error', async () => {
    const stub = createStubClient();
    stub.nextAddCommentError = new HttpException(
      { errorMessages: ['nope'] },
      400
    );
    const client = createRealJiraClient({}, { client: stub.client });

    await assert.rejects(client.addComment('X-1', 'hi'), /Jira addComment failed: 400/);
  });

  it('addComment retries as plain-text ADF when Jira rejects the body with INVALID_INPUT', async () => {
    // Jira returns this shape when its ADF validator refuses a comment body.
    // The retry must fire and succeed so the analysis result isn't lost.
    const stub = createStubClient();
    stub.nextAddCommentError = new HttpException(
      {
        errorMessages: ['INVALID_INPUT'],
        errors: { comment: 'INVALID_INPUT' },
      },
      400
    );
    const warnings: string[] = [];
    const infos: string[] = [];
    const client = createRealJiraClient(
      {},
      {
        client: stub.client,
        logger: {
          info: (msg: string) => infos.push(String(msg)),
          warn: (msg: string) => warnings.push(String(msg)),
          error: () => {},
          debug: () => {},
        },
      }
    );

    const result = await client.addComment(
      'KAN-42',
      '# Heading\n\n**Bold** and `code` and [text]().'
    );

    assert.equal(result.success, true);
    assert.equal(stub.spies.addComment.length, 2, 'should have posted twice (attempt + retry)');

    // Second call must use the plain-text ADF shape: a doc with only
    // paragraphs, no heading/codeBlock/marks.
    const retryBody = stub.spies.addComment[1]!.comment as {
      type: string;
      content: Array<{ type: string }>;
    };
    assert.equal(retryBody.type, 'doc');
    for (const block of retryBody.content) {
      assert.equal(block.type, 'paragraph');
    }

    assert.ok(
      warnings.some((w) => w.includes('INVALID_INPUT') && w.includes('KAN-42')),
      `expected a warn log for the retry, got: ${warnings.join(' | ')}`
    );
    assert.ok(
      infos.some((i) => i.includes('plain-text retry succeeded')),
      `expected an info log for the successful retry, got: ${infos.join(' | ')}`
    );
  });

  it('addComment does NOT retry on non-INVALID_INPUT 400s (avoids masking real bugs)', async () => {
    const stub = createStubClient();
    stub.nextAddCommentError = new HttpException(
      { errorMessages: ['issueIdOrKey is required'] },
      400
    );
    const client = createRealJiraClient({}, { client: stub.client });

    await assert.rejects(client.addComment('X-1', 'hi'), /Jira addComment failed: 400/);
    assert.equal(stub.spies.addComment.length, 1, 'should not retry for unrelated 400s');
  });

  it('addComment surfaces the retry error when the plain-text fallback also fails', async () => {
    // One-shot stub: first call throws INVALID_INPUT; then we immediately
    // rearm a different error for the retry.
    const stub = createStubClient();
    const firstErr = new HttpException(
      { errors: { comment: 'INVALID_INPUT' } },
      400
    );
    const secondErr = new HttpException({ errorMessages: ['rate limited'] }, 429);

    // Custom wrapper: override addComment to throw two different errors in sequence.
    const issueComments = (stub.client as unknown as { issueComments: Record<string, unknown> }).issueComments as {
      addComment: (p: Record<string, unknown>) => Promise<unknown>;
    };
    const calls: Array<Record<string, unknown>> = [];
    issueComments.addComment = async (p: Record<string, unknown>) => {
      calls.push(p);
      if (calls.length === 1) throw firstErr;
      throw secondErr;
    };

    const client = createRealJiraClient({}, { client: stub.client });
    await assert.rejects(
      client.addComment('X-1', '# Heading\n\nbody'),
      /Jira addComment failed: 429/
    );
    assert.equal(calls.length, 2);
  });

  it('getIssue returns null on HTTP 404 from SDK', async () => {
    const stub = createStubClient();
    stub.nextGetIssueError = new HttpException({ errorMessages: ['not found'] }, 404);
    const client = createRealJiraClient({}, { client: stub.client });

    const result = await client.getIssue('MISSING-1');
    assert.equal(result, null);
  });

  it('getIssue maps SDK response to JiraIssueRecord', async () => {
    const stub = createStubClient();
    stub.nextGetIssueResponse = { key: 'ABC-1', fields: { summary: 'Hello' } };
    const client = createRealJiraClient({}, { client: stub.client });

    const result = await client.getIssue('ABC-1');
    assert.deepEqual(result, { key: 'ABC-1', fields: { summary: 'Hello' } });
  });

  it('updateIssue calls editIssue with fields payload', async () => {
    const stub = createStubClient();
    const client = createRealJiraClient({}, { client: stub.client });

    await client.updateIssue('ABC-2', { summary: 'new' });
    assert.equal(stub.spies.editIssue.length, 1);
    assert.deepEqual(stub.spies.editIssue[0], { issueIdOrKey: 'ABC-2', fields: { summary: 'new' } });
  });

  it('getComments maps renderedBody or body to text', async () => {
    const stub = createStubClient();
    stub.nextGetCommentsResponse = {
      comments: [
        { renderedBody: '<p>hi</p>', created: '2026-04-01T00:00:00Z' },
        { body: { type: 'doc' }, created: '2026-04-02T00:00:00Z' },
      ],
    };
    const client = createRealJiraClient({}, { client: stub.client });

    const out = await client.getComments('C-1');
    assert.equal(out.length, 2);
    assert.equal(out[0]!.text, '<p>hi</p>');
    assert.ok(out[1]!.text.includes('doc'));
  });

  it('getComments maps author fields to JiraCommentRecord', async () => {
    const stub = createStubClient();
    stub.nextGetCommentsResponse = {
      comments: [
        {
          renderedBody: 'hello',
          created: '2026-04-01T00:00:00Z',
          author: {
            accountId: 'acc-123',
            emailAddress: 'alice@example.com',
            displayName: 'Alice',
          },
        },
        {
          renderedBody: 'no author',
          created: '2026-04-02T00:00:00Z',
        },
      ],
    };
    const client = createRealJiraClient({}, { client: stub.client });

    const out = await client.getComments('C-2');
    assert.equal(out.length, 2);
    assert.deepEqual(out[0]!.author, {
      accountId: 'acc-123',
      emailAddress: 'alice@example.com',
      displayName: 'Alice',
    });
    assert.equal(out[1]!.author, undefined);
  });
});
