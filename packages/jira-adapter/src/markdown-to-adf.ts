/**
 * Markdown → Atlassian Document Format (ADF) converter.
 *
 * Turns the Markdown produced by the analysis agent into a well-formed ADF
 * document so that headings, bold, inline code, fenced code blocks, and lists
 * survive the round-trip into Jira Cloud comments instead of being flattened
 * to a wall of plain text.
 *
 * Supported Markdown features:
 * - Paragraphs
 * - ATX headings (#, ##, …, ######)
 * - Bold (`**`, `__`), italic (`*`, `_`), strikethrough (`~~`)
 * - Inline code (`` ` ``) and fenced code blocks (``` with optional language)
 * - Ordered and unordered lists, including nesting
 * - Blockquotes
 * - Links ([text](href)) and autolinks
 * - Hard breaks and horizontal rules
 *
 * Anything the lexer does not recognize is preserved as plain text so we never
 * throw away the agent's output.
 *
 * ADF reference: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */

import { marked, type Token, type Tokens } from 'marked';

// ----- ADF shapes (minimal subset we emit) -----

type AdfMark =
  | { type: 'strong' }
  | { type: 'em' }
  | { type: 'code' }
  | { type: 'strike' }
  | { type: 'link'; attrs: { href: string; title?: string } };

interface AdfText {
  type: 'text';
  text: string;
  marks?: AdfMark[];
}

interface AdfHardBreak {
  type: 'hardBreak';
}

type AdfInline = AdfText | AdfHardBreak;

interface AdfParagraph {
  type: 'paragraph';
  content?: AdfInline[];
}

interface AdfHeading {
  type: 'heading';
  attrs: { level: 1 | 2 | 3 | 4 | 5 | 6 };
  content?: AdfInline[];
}

interface AdfCodeBlock {
  type: 'codeBlock';
  attrs?: { language?: string };
  content?: Array<{ type: 'text'; text: string }>;
}

interface AdfListItem {
  type: 'listItem';
  content: AdfBlock[];
}

interface AdfBulletList {
  type: 'bulletList';
  content: AdfListItem[];
}

interface AdfOrderedList {
  type: 'orderedList';
  attrs?: { order: number };
  content: AdfListItem[];
}

interface AdfBlockquote {
  type: 'blockquote';
  content: AdfBlock[];
}

interface AdfRule {
  type: 'rule';
}

type AdfBlock =
  | AdfParagraph
  | AdfHeading
  | AdfCodeBlock
  | AdfBulletList
  | AdfOrderedList
  | AdfBlockquote
  | AdfRule;

export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfBlock[];
}

// ----- Inline conversion -----

function decodeEntities(s: string): string {
  return String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/**
 * Build a text node, applying a handful of ADF-specific invariants that
 * Jira's validator rejects outright with a generic `INVALID_INPUT`:
 *
 *   - Text must be non-empty (we return `null` so the caller can skip the
 *     slot entirely rather than emit `{type:"text", text:""}`).
 *   - ADF text nodes are a single run of inline text and **do not carry
 *     newlines**. We replace `\n` with a space; legitimate Markdown hard
 *     breaks come through as separate `br` tokens and are emitted as
 *     `hardBreak` nodes, not as embedded newlines.
 *   - The `code` mark is mutually exclusive with every other mark in ADF
 *     (strong, em, strike, link, …). When we see them stacked — which
 *     happens easily when an LLM emits `` **`x`** `` — we keep only
 *     `code` so the node remains valid.
 *   - `link` marks with an empty/whitespace `href` are invalid. We drop
 *     the mark while preserving the text.
 */
function textNode(text: string, marks: AdfMark[]): AdfText | null {
  if (!text) return null;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, ' ');
  if (!normalized) return null;
  const sanitizedMarks = sanitizeMarks(marks);
  const node: AdfText = { type: 'text', text: normalized };
  if (sanitizedMarks.length) node.marks = sanitizedMarks;
  return node;
}

function sanitizeMarks(marks: AdfMark[]): AdfMark[] {
  if (!marks.length) return marks;
  const filtered = marks.filter((m) => !isInvalidMark(m));
  const hasCode = filtered.some((m) => m.type === 'code');
  if (hasCode) {
    // `code` is exclusive in ADF.
    return filtered.filter((m) => m.type === 'code');
  }
  return filtered;
}

function isInvalidMark(mark: AdfMark): boolean {
  if (mark.type === 'link') {
    const href = mark.attrs?.href;
    if (typeof href !== 'string' || !href.trim()) return true;
  }
  return false;
}

function inlineFromTokens(tokens: Token[] | undefined, marks: AdfMark[] = []): AdfInline[] {
  if (!tokens?.length) return [];
  const out: AdfInline[] = [];
  for (const t of tokens) {
    out.push(...inlineFromToken(t, marks));
  }
  return out;
}

function inlineFromToken(t: Token, marks: AdfMark[]): AdfInline[] {
  switch (t.type) {
    case 'text': {
      const tx = t as Tokens.Text;
      if (tx.tokens?.length) return inlineFromTokens(tx.tokens, marks);
      const node = textNode(decodeEntities(tx.text), marks);
      return node ? [node] : [];
    }
    case 'strong':
      return inlineFromTokens((t as Tokens.Strong).tokens, [...marks, { type: 'strong' }]);
    case 'em':
      return inlineFromTokens((t as Tokens.Em).tokens, [...marks, { type: 'em' }]);
    case 'codespan': {
      const node = textNode((t as Tokens.Codespan).text, [...marks, { type: 'code' }]);
      return node ? [node] : [];
    }
    case 'del':
      return inlineFromTokens((t as Tokens.Del).tokens, [...marks, { type: 'strike' }]);
    case 'link': {
      const link = t as Tokens.Link;
      const linkMark: AdfMark = {
        type: 'link',
        attrs: link.title ? { href: link.href, title: link.title } : { href: link.href },
      };
      return inlineFromTokens(link.tokens, [...marks, linkMark]);
    }
    case 'br':
      return [{ type: 'hardBreak' }];
    case 'escape': {
      const node = textNode(decodeEntities((t as Tokens.Escape).text), marks);
      return node ? [node] : [];
    }
    case 'html': {
      // We don't render raw HTML — pass the source through as plain text so
      // nothing is silently dropped.
      const html = (t as Tokens.HTML).text ?? '';
      const node = textNode(html, marks);
      return node ? [node] : [];
    }
    default: {
      const raw = (t as { raw?: unknown }).raw;
      if (typeof raw === 'string' && raw.length) {
        const node = textNode(raw, marks);
        return node ? [node] : [];
      }
      return [];
    }
  }
}

// ----- Block conversion -----

function clampHeadingLevel(depth: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (!Number.isFinite(depth)) return 3;
  return Math.min(6, Math.max(1, Math.trunc(depth))) as 1 | 2 | 3 | 4 | 5 | 6;
}

function blocksFromTokens(tokens: Token[] | undefined): AdfBlock[] {
  if (!tokens?.length) return [];
  const out: AdfBlock[] = [];
  for (const t of tokens) {
    const block = blockFromToken(t);
    if (!block) continue;
    if (Array.isArray(block)) out.push(...block);
    else out.push(block);
  }
  return out;
}

function blockFromToken(t: Token): AdfBlock | AdfBlock[] | null {
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading;
      return {
        type: 'heading',
        attrs: { level: clampHeadingLevel(h.depth) },
        content: inlineFromTokens(h.tokens),
      };
    }
    case 'paragraph': {
      const p = t as Tokens.Paragraph;
      return { type: 'paragraph', content: inlineFromTokens(p.tokens) };
    }
    case 'code': {
      const c = t as Tokens.Code;
      const block: AdfCodeBlock = { type: 'codeBlock' };
      const lang = (c.lang || '').trim();
      if (lang) block.attrs = { language: lang };
      if (c.text) block.content = [{ type: 'text', text: c.text }];
      return block;
    }
    case 'list': {
      const l = t as Tokens.List;
      const items: AdfListItem[] = l.items.map((item) => {
        let children = blocksFromTokens(item.tokens);
        children = restrictToListItemChildren(children);
        if (children.length === 0) {
          children = [{ type: 'paragraph' }];
        }
        // Mark task-list checkboxes inline since ADF's taskItem type is a
        // different structure (taskList) and can't live inside a regular list.
        if (item.task) {
          const marker = item.checked ? '☑ ' : '☐ ';
          children = prependMarker(children, marker);
        }
        return { type: 'listItem', content: children };
      });
      if (l.ordered) {
        const start = typeof l.start === 'number' ? l.start : 1;
        const block: AdfOrderedList = { type: 'orderedList', content: items };
        if (start !== 1) block.attrs = { order: start };
        return block;
      }
      return { type: 'bulletList', content: items };
    }
    case 'blockquote': {
      const q = t as Tokens.Blockquote;
      const children = blocksFromTokens(q.tokens);
      return {
        type: 'blockquote',
        content: children.length ? children : [{ type: 'paragraph' }],
      };
    }
    case 'hr':
      return { type: 'rule' };
    case 'space':
      return null;
    case 'text': {
      // Top-level bare text line — wrap in a paragraph so the doc is valid.
      const tx = t as Tokens.Text;
      const inline = tx.tokens?.length
        ? inlineFromTokens(tx.tokens)
        : ([textNode(decodeEntities(tx.text ?? tx.raw ?? ''), [])].filter(Boolean) as AdfInline[]);
      return { type: 'paragraph', content: inline };
    }
    case 'html': {
      // Treat raw HTML blocks as paragraphs of plain text — never dropped.
      const html = (t as Tokens.HTML).text ?? '';
      const node = textNode(html.trim(), []);
      return { type: 'paragraph', content: node ? [node] : [] };
    }
    default: {
      const raw = (t as { raw?: unknown }).raw;
      if (typeof raw === 'string' && raw.trim().length) {
        const node = textNode(raw.trim(), []);
        return { type: 'paragraph', content: node ? [node] : [] };
      }
      return null;
    }
  }
}

/**
 * ADF's `listItem.content` only accepts
 * `paragraph | orderedList | bulletList | codeBlock`. Demote anything else
 * — headings most commonly — to a paragraph carrying the same inline
 * content, and drop structurally meaningless nodes (rules, blockquotes)
 * entirely. Without this, an LLM that writes `- ## Critical:` produces a
 * heading nested inside a listItem and Jira rejects the whole comment
 * with a generic `INVALID_INPUT`.
 */
function restrictToListItemChildren(blocks: AdfBlock[]): AdfBlock[] {
  const out: AdfBlock[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
      case 'orderedList':
      case 'bulletList':
      case 'codeBlock':
        out.push(block);
        break;
      case 'heading': {
        // Flatten heading into paragraph; the text still reads correctly,
        // it just loses its visual emphasis level.
        const paragraph: AdfParagraph = { type: 'paragraph' };
        if (block.content && block.content.length > 0) paragraph.content = block.content;
        out.push(paragraph);
        break;
      }
      case 'blockquote': {
        // A quoted block inside a list item is rare and tends to render
        // poorly even when valid. Inline its child paragraphs directly.
        for (const child of block.content) {
          if (child.type === 'paragraph' || child.type === 'orderedList' || child.type === 'bulletList' || child.type === 'codeBlock') {
            out.push(child);
          }
        }
        break;
      }
      case 'rule':
        // Rules are meaningless inside a list; drop silently.
        break;
      default:
        break;
    }
  }
  return out;
}

function prependMarker(blocks: AdfBlock[], marker: string): AdfBlock[] {
  if (blocks.length === 0) return blocks;
  const [head, ...rest] = blocks;
  if (head.type !== 'paragraph') {
    return [{ type: 'paragraph', content: [{ type: 'text', text: marker.trimEnd() }] }, ...blocks];
  }
  const inline = head.content ?? [];
  const prefixed: AdfInline[] = [{ type: 'text', text: marker } satisfies AdfText, ...inline];
  return [{ ...head, content: prefixed }, ...rest];
}

// ----- Sanitization -----

/**
 * ADF rejects `text` nodes whose `text` is an empty string. Normalize so
 * every text node is non-empty and drop paragraph content arrays that end up
 * empty (an empty paragraph must omit the `content` property entirely).
 */
function sanitize<T extends AdfBlock | AdfListItem | AdfInline>(node: T): T {
  if ((node as { type?: string }).type === 'text') {
    return node;
  }
  if ('content' in node && Array.isArray((node as { content?: unknown[] }).content)) {
    const inputContent = (node as { content: unknown[] }).content;
    const cleaned: unknown[] = [];
    for (const child of inputContent) {
      if (!child || typeof child !== 'object') continue;
      const type = (child as { type?: string }).type;
      if (type === 'text' && !(child as AdfText).text) continue;
      cleaned.push(sanitize(child as AdfBlock | AdfListItem | AdfInline));
    }
    if (cleaned.length === 0 && (node as { type: string }).type === 'paragraph') {
      const { content: _c, ...rest } = node as AdfParagraph;
      void _c;
      return rest as T;
    }
    return { ...(node as object), content: cleaned } as T;
  }
  return node;
}

// ----- Public API -----

/**
 * Minimal fallback when the Markdown lexer fails or produces an empty
 * document. Keeps behavior identical to the old plainTextToAdfDoc.
 */
function plainTextFallback(plainText: string): AdfDoc {
  const text = String(plainText ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph' }],
    };
  }
  const chunks = text.split(/\n{2,}/);
  const content: AdfBlock[] = chunks.map((chunk) => {
    const line = chunk.replace(/\n+/g, ' ').trim();
    return line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' };
  });
  return { type: 'doc', version: 1, content };
}

export function markdownToAdfDoc(source: string): AdfDoc {
  const text = String(source ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return plainTextFallback(text);

  let tokens: Token[];
  try {
    tokens = marked.lexer(text);
  } catch {
    return plainTextFallback(text);
  }

  const rawBlocks = blocksFromTokens(tokens);
  const content = rawBlocks.map((b) => sanitize(b));

  if (content.length === 0) return plainTextFallback(text);

  return { type: 'doc', version: 1, content };
}
