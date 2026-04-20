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
      if (ctx.nextAddCommentError) throw ctx.nextAddCommentError;
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
});
