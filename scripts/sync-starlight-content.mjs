/**
 * Copy docs/** (.md and .mdx) into apps/docs/src/content/docs/ for Astro Starlight.
 * Rewrites relative .md links to site paths under BASE or GitHub blob URLs.
 * .mdx files are copied with link rewriting but JSX/import lines are preserved.
 * Run from repo root: node scripts/sync-starlight-content.mjs
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, dirname, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sourceRoot = join(root, 'docs');
const targetDir = join(root, 'apps', 'docs', 'src', 'content', 'docs');
const BASE = '/docs';
const GITHUB = 'https://github.com/toniop99/agent-detective/blob/main';

/** Basenames to skip when walking `docs/` (e.g. future templates). */
const EXCLUDE_NAMES = new Set();

function posix(p) {
  return p.split(sep).join('/');
}

/** @type {Map<string, string>} docs/rel.md -> public path without base (e.g. operator/installation) */
const sourceToPublic = new Map();

function setMap(sourceRel, publicPath) {
  sourceToPublic.set(posix(sourceRel), publicPath);
}

/**
 * @param {string} fromSourceRel posix e.g. docs/operator/installation.mdx
 * @param {string} href
 */
function rewriteLink(fromSourceRel, href) {
  if (!href) return href;
  const t = href.trim();
  if (t.startsWith('http:') || t.startsWith('https:') || t.startsWith('mailto:')) return href;
  if (t.startsWith('/')) return href;
  const [pathPart, ...hashParts] = t.split('#');
  const hash = hashParts.length ? hashParts.join('#') : '';
  const fromDir = resolve(root, dirname(fromSourceRel));
  const full = resolve(fromDir, pathPart);
  let rel = posix(relative(root, full));
  if (rel.startsWith('..')) return href;

  const docKeyMd = rel.endsWith('.md') || rel.endsWith('.mdx') ? rel : `${rel}.md`;
  const docKeyMdx = rel.endsWith('.md') || rel.endsWith('.mdx') ? rel : `${rel}.mdx`;
  for (const key of [docKeyMd, docKeyMdx, rel]) {
    if (sourceToPublic.has(key)) {
      return `${BASE}/${sourceToPublic.get(key)}/` + (hash ? `#${hash}` : '');
    }
  }
  return `${GITHUB}/${rel}` + (hash ? `#${hash}` : '');
}

function rewriteContent(md, fromSourceRel) {
  return md.replace(/(\]\()([^)]+)(\))/g, (m, a, b, c) => {
    const inner = b.trim();
    if (inner.startsWith('http') || inner.startsWith('#') || inner.startsWith('/')) return m;
    return `${a}${rewriteLink(fromSourceRel, inner)}${c}`;
  });
}

/** Starlight requires frontmatter with `title` for the docs collection. */
function ensureFrontmatter(body, fileLabel) {
  if (body.trimStart().startsWith('---')) return body;
  const m = body.match(/^#\s+(.+)$/m);
  const title = m ? m[1].trim() : fileLabel.replace(/\.mdx?$/, '');
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}`;
}

/**
 * @param {string} dir
 * @param {string} relFromDocs
 * @returns {Promise<{ abs: string, relUnderDocs: string }[]>}
 */
async function collectMarkdownFiles(dir, relFromDocs) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const r = relFromDocs ? `${relFromDocs}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await collectMarkdownFiles(p, r)));
    } else if (
      e.isFile() &&
      (e.name.endsWith('.md') || e.name.endsWith('.mdx')) &&
      !EXCLUDE_NAMES.has(e.name)
    ) {
      out.push({ abs: p, relUnderDocs: r });
    }
  }
  return out;
}

function toPublicPath(sourceRel) {
  // sourceRel: docs/README.md or docs/operator/installation.mdx
  const u = sourceRel.replace(/^docs\//, '');
  if (u === 'README.md') {
    return 'overview';
  }
  return u.replace(/\.mdx?$/, '');
}

async function main() {
  sourceToPublic.clear();
  const files = await collectMarkdownFiles(sourceRoot, '');
  for (const { relUnderDocs } of files) {
    const sourceRel = posix(join('docs', relUnderDocs));
    setMap(sourceRel, toPublicPath(sourceRel));
  }

  for (const e of await readdir(targetDir, { withFileTypes: true })) {
    if (e.name === 'index.md' || e.name === 'index.mdx') continue; // home page; not mirrored from docs/
    await rm(join(targetDir, e.name), { recursive: true, force: true });
  }

  for (const { abs, relUnderDocs } of files) {
    const sourceRel = posix(join('docs', relUnderDocs));
    const publicPath = toPublicPath(sourceRel);
    const ext = abs.endsWith('.mdx') ? '.mdx' : '.md';
    const outFile = join(targetDir, publicPath + ext);
    await mkdir(dirname(outFile), { recursive: true });
    let body = await readFile(abs, 'utf8');
    if (relUnderDocs === 'README.md' && !body.startsWith('---')) {
      body = `---\ntitle: Documentation index\ndescription: Index of Agent Detective documentation\n---\n\n${body}`;
    } else {
      body = ensureFrontmatter(body, basename(abs));
    }
    body = rewriteContent(body, sourceRel);
    await writeFile(outFile, body, 'utf8');
  }

  console.log(
    `[sync-starlight] ${sourceToPublic.size} doc pages → ${posix(relative(root, targetDir))}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
