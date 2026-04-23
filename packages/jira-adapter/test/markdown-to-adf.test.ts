import { describe, it } from 'node:test';
import assert from 'node:assert';
import { markdownToAdfDoc } from '../src/infrastructure/markdown-to-adf.js';

type AdfNode = { type: string; [key: string]: unknown };

function asNode(v: unknown): AdfNode {
  return v as AdfNode;
}

function walk(doc: AdfNode, pred: (n: AdfNode) => boolean): AdfNode[] {
  const out: AdfNode[] = [];
  const stack: AdfNode[] = [doc];
  while (stack.length) {
    const n = stack.pop()!;
    if (pred(n)) out.push(n);
    const content = (n as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c && typeof c === 'object') stack.push(c as AdfNode);
      }
    }
  }
  return out;
}

function findOne(doc: AdfNode, type: string): AdfNode | undefined {
  return walk(asNode(doc), (n) => n.type === type)[0];
}

describe('markdownToAdfDoc', () => {
  it('returns a valid empty doc for empty input', () => {
    const doc = markdownToAdfDoc('');
    assert.equal(doc.type, 'doc');
    assert.equal(doc.version, 1);
    assert.equal(doc.content.length, 1);
    assert.equal(doc.content[0].type, 'paragraph');
    // Empty paragraph must NOT have an empty-string text child.
    assert.equal((doc.content[0] as AdfNode).content, undefined);
  });

  it('converts plain text to a single paragraph', () => {
    const doc = markdownToAdfDoc('hello world');
    assert.equal(doc.content.length, 1);
    const p = doc.content[0] as AdfNode;
    assert.equal(p.type, 'paragraph');
    const text = (p.content as AdfNode[])[0];
    assert.equal(text.type, 'text');
    assert.equal(text.text, 'hello world');
  });

  it('splits blank-line-separated blocks into multiple paragraphs', () => {
    const doc = markdownToAdfDoc('first\n\nsecond');
    const paragraphs = walk(asNode(doc), (n) => n.type === 'paragraph');
    assert.equal(paragraphs.length, 2);
  });

  it('converts ATX headings and clamps levels 1-6', () => {
    const doc = markdownToAdfDoc('## Summary\n\n####### deep');
    const headings = walk(asNode(doc), (n) => n.type === 'heading');
    assert.equal(headings.length >= 1, true);
    const h2 = headings[0];
    assert.deepEqual(h2.attrs, { level: 2 });
    const text = (h2.content as AdfNode[])[0];
    assert.equal(text.text, 'Summary');
  });

  it('applies strong/em/code marks on inline spans', () => {
    const doc = markdownToAdfDoc('This is **bold**, *italic*, and `inline`.');
    const texts = walk(asNode(doc), (n) => n.type === 'text');
    const bold = texts.find((t) => t.text === 'bold');
    const ital = texts.find((t) => t.text === 'italic');
    const code = texts.find((t) => t.text === 'inline');
    assert.ok(bold, 'bold text node exists');
    assert.deepEqual(bold!.marks, [{ type: 'strong' }]);
    assert.ok(ital, 'italic text node exists');
    assert.deepEqual(ital!.marks, [{ type: 'em' }]);
    assert.ok(code, 'inline-code text node exists');
    assert.deepEqual(code!.marks, [{ type: 'code' }]);
  });

  it('applies link mark with href', () => {
    const doc = markdownToAdfDoc('See [docs](https://example.com/x).');
    const text = walk(asNode(doc), (n) => n.type === 'text').find((t) => t.text === 'docs');
    assert.ok(text, 'link text node exists');
    assert.deepEqual(text!.marks, [
      { type: 'link', attrs: { href: 'https://example.com/x' } },
    ]);
  });

  it('converts fenced code blocks with language', () => {
    const doc = markdownToAdfDoc('```ts\nconst x: number = 1;\n```');
    const cb = findOne(asNode(doc), 'codeBlock');
    assert.ok(cb, 'codeBlock present');
    assert.deepEqual(cb!.attrs, { language: 'ts' });
    const text = (cb!.content as AdfNode[])[0];
    assert.equal(text.text, 'const x: number = 1;');
  });

  it('omits language attr when fence has no info string', () => {
    const doc = markdownToAdfDoc('```\nhello\n```');
    const cb = findOne(asNode(doc), 'codeBlock');
    assert.ok(cb);
    assert.equal(cb!.attrs, undefined);
  });

  it('converts unordered lists to bulletList with listItem children', () => {
    const doc = markdownToAdfDoc('- alpha\n- beta\n- gamma');
    const list = findOne(asNode(doc), 'bulletList');
    assert.ok(list);
    const items = list!.content as AdfNode[];
    assert.equal(items.length, 3);
    for (const item of items) {
      assert.equal(item.type, 'listItem');
      const first = (item.content as AdfNode[])[0];
      assert.equal(first.type, 'paragraph');
    }
  });

  it('converts ordered lists and preserves a non-default start', () => {
    const doc = markdownToAdfDoc('3. foo\n4. bar');
    const list = findOne(asNode(doc), 'orderedList');
    assert.ok(list);
    assert.deepEqual(list!.attrs, { order: 3 });
    assert.equal((list!.content as AdfNode[]).length, 2);
  });

  it('supports nested lists', () => {
    const doc = markdownToAdfDoc('- outer\n  - inner');
    const outerList = findOne(asNode(doc), 'bulletList');
    const firstItem = (outerList!.content as AdfNode[])[0];
    // The item should contain a paragraph AND a nested bulletList.
    const types = (firstItem.content as AdfNode[]).map((n) => n.type);
    assert.ok(types.includes('paragraph'));
    assert.ok(types.includes('bulletList'));
  });

  it('converts blockquotes', () => {
    const doc = markdownToAdfDoc('> be careful\n> with this');
    const quote = findOne(asNode(doc), 'blockquote');
    assert.ok(quote);
    assert.equal((quote!.content as AdfNode[])[0].type, 'paragraph');
  });

  it('converts horizontal rules', () => {
    const doc = markdownToAdfDoc('a\n\n---\n\nb');
    const rule = findOne(asNode(doc), 'rule');
    assert.ok(rule);
  });

  it('never produces empty-string text nodes', () => {
    const doc = markdownToAdfDoc('# Title\n\n\n\nBody.');
    const texts = walk(asNode(doc), (n) => n.type === 'text');
    for (const t of texts) {
      assert.ok(typeof t.text === 'string' && t.text.length > 0, `empty text node: ${JSON.stringify(t)}`);
    }
  });

  it('handles a realistic analysis report end-to-end', () => {
    const md = [
      '## Summary',
      '',
      '**Likely root cause:** null dereference in `parseUser`.',
      '',
      '## Root Cause Analysis',
      '',
      '- `src/users/parse.ts:42` reads `user.profile.name` without a null guard.',
      '- When the Jira webhook omits `profile`, it throws.',
      '',
      '## Suggested Next Steps',
      '',
      '1. Add an optional-chaining guard:',
      '',
      '```ts',
      'const name = user.profile?.name ?? "unknown";',
      '```',
      '',
      '2. Add a regression test in `test/parse-user.test.ts`.',
    ].join('\n');

    const doc = markdownToAdfDoc(md);
    const types = doc.content.map((n) => (n as AdfNode).type);
    assert.ok(types.includes('heading'));
    assert.ok(types.includes('paragraph'));
    assert.ok(types.includes('bulletList'));
    assert.ok(types.includes('orderedList'));
    assert.ok(types.includes('codeBlock'));

    const code = findOne(asNode(doc), 'codeBlock')!;
    assert.deepEqual(code.attrs, { language: 'ts' });

    const strong = walk(asNode(doc), (n) => n.type === 'text').find(
      (t) => t.text === 'Likely root cause:'
    );
    assert.ok(strong, 'bold verdict text present');
    assert.deepEqual(strong!.marks, [{ type: 'strong' }]);
  });

  it('falls back to plain-text paragraphs when Markdown parsing yields nothing useful', () => {
    // Input that is purely whitespace should still yield a valid empty doc.
    const doc = markdownToAdfDoc('   \n\n   ');
    assert.equal(doc.type, 'doc');
    assert.equal(doc.content.length, 1);
    assert.equal(doc.content[0].type, 'paragraph');
  });

  describe('ADF-validator safety (regressions for Jira INVALID_INPUT 400s)', () => {
    it('demotes headings inside list items to paragraphs (listItem.content forbids heading)', () => {
      const md = [
        '- ## Critical:',
        '  Details about the critical issue.',
        '- Another item',
      ].join('\n');

      const doc = markdownToAdfDoc(md);
      const list = findOne(asNode(doc), 'bulletList')!;
      const items = list.content as AdfNode[];
      for (const item of items) {
        assert.equal(item.type, 'listItem');
        const children = item.content as AdfNode[];
        for (const child of children) {
          // heading is the only case we actively demote here; rules/blockquotes
          // are dropped. The important invariant is: no `heading` anywhere in
          // a listItem subtree.
          assert.notEqual(child.type, 'heading', 'listItem must not contain heading');
        }
      }
      // Make sure the heading's text wasn't discarded — it should be in a
      // paragraph inside the first list item.
      const firstItem = items[0]!;
      const firstChildren = firstItem.content as AdfNode[];
      assert.equal(firstChildren[0]!.type, 'paragraph');
      const firstText = ((firstChildren[0] as AdfNode).content as AdfNode[])[0];
      assert.match(firstText.text as string, /Critical/);
    });

    it('drops rules nested inside list items (rules are only valid at doc level)', () => {
      const md = ['- First item', '  ---', '  More text', '- Second item'].join('\n');
      const doc = markdownToAdfDoc(md);
      const rules = walk(asNode(doc), (n) => n.type === 'rule');
      // Any rules remaining must be at the top-level of the doc, not nested.
      for (const r of rules) {
        assert.ok(
          (doc.content as unknown[]).includes(r),
          'rule survived outside top-level (would nest inside listItem → INVALID_INPUT)'
        );
      }
    });

    it('strips clashing marks when the code mark is present (code is exclusive in ADF)', () => {
      // `**`x`**` — bold wrapping inline code. LLMs do this all the time.
      const doc = markdownToAdfDoc('normal **`x`** normal');
      const codeTexts = walk(asNode(doc), (n) => n.type === 'text').filter((t) =>
        Array.isArray(t.marks) && (t.marks as AdfNode[]).some((m) => m.type === 'code')
      );
      assert.ok(codeTexts.length >= 1, 'expected at least one text node with a code mark');
      for (const t of codeTexts) {
        const marks = t.marks as AdfNode[];
        assert.equal(marks.length, 1, `code mark must be exclusive, got ${JSON.stringify(marks)}`);
        assert.equal(marks[0].type, 'code');
      }
    });

    it('drops link marks with an empty href (ADF rejects them) but keeps the text', () => {
      // `[text]()` parses as a link with an empty href in marked.
      const doc = markdownToAdfDoc('see [click here]() for details');
      const anchors = walk(asNode(doc), (n) => n.type === 'text').filter(
        (t) => t.text === 'click here'
      );
      assert.ok(anchors.length >= 1, 'text node preserved');
      for (const t of anchors) {
        const marks = (t.marks as AdfNode[] | undefined) ?? [];
        for (const m of marks) {
          assert.notEqual(m.type, 'link', 'empty-href link mark must be dropped');
        }
      }
    });

    it('never emits newlines inside paragraph text nodes (ADF text runs are single-line)', () => {
      // Synthetic path that exercises the default-token fallback (which uses
      // raw text). Markdown tables go through that branch when not explicitly
      // handled and are the most common real-world source of embedded
      // newlines in paragraph text.
      const md = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n');
      const doc = markdownToAdfDoc(md);
      const paragraphTexts = walk(asNode(doc), (n) => n.type === 'paragraph').flatMap(
        (p) => ((p.content as AdfNode[] | undefined) ?? []).filter((c) => c.type === 'text')
      );
      for (const t of paragraphTexts) {
        assert.ok(
          typeof t.text === 'string' && !(t.text as string).includes('\n'),
          `paragraph text node must not contain newlines: ${JSON.stringify(t.text)}`
        );
      }
    });
  });
});
