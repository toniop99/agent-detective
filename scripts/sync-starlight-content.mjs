/**
 * Copy docs/ into apps/docs/src/content/docs for Astro Starlight.
 * Rewrites relative .md links to site paths under BASE or GitHub blob URLs.
 * Run from repo root: node scripts/sync-starlight-content.mjs
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, dirname, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sourceRoot = join(root, 'docs');
const targetDir = join(root, 'apps', 'docs', 'src', 'content', 'docs');
const BASE = '/agent-detective';
const GITHUB = 'https://github.com/toniop99/agent-detective/blob/main';

const EXCLUDE = new Set(['IMPLEMENTATION-CHECKLIST.md']);
const SUB = new Set(['e2e', 'adr', 'generated']);

function posix(p) {
  return p.split(sep).join('/');
}

/** @type {Map<string, string>} docs/rel.md -> public path without base (pages/installation) */
const sourceToPublic = new Map();

function setMap(sourceRel, publicPath) {
  sourceToPublic.set(posix(sourceRel), publicPath);
}

/**
 * @param {string} fromSourceRel posix e.g. docs/installation.md
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

  const docKey = rel.endsWith('.md') ? rel : `${rel}.md`;
  if (sourceToPublic.has(docKey)) {
    return `${BASE}/${sourceToPublic.get(docKey)}/` + (hash ? `#${hash}` : '');
  }
  if (sourceToPublic.has(rel)) {
    return `${BASE}/${sourceToPublic.get(rel)}/` + (hash ? `#${hash}` : '');
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
function ensureFrontmatter(body, basename) {
  if (body.trimStart().startsWith('---')) return body;
  const m = body.match(/^#\s+(.+)$/m);
  const title = m ? m[1].trim() : basename.replace(/\.md$/, '');
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}`;
}

async function collectSubFiles(sub) {
  const base = join(sourceRoot, sub);
  const out = [];
  async function walk(dir, relUnderSub) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = relUnderSub ? `${relUnderSub}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(p, rel);
      } else if (e.name.endsWith('.md') && !EXCLUDE.has(e.name)) {
        out.push({ abs: p, rel: posix(join('docs', sub, rel)) });
      }
    }
  }
  try {
    await walk(base, '');
  } catch {
    return [];
  }
  return out;
}

async function main() {
  sourceToPublic.clear();

  // Plan root-level docs/*.md
  for (const name of await readdir(sourceRoot)) {
    if (!name.endsWith('.md') || EXCLUDE.has(name)) continue;
    const st = await stat(join(sourceRoot, name));
    if (!st.isFile()) continue;
    if (SUB.has(name)) continue;
    const sourceRel = posix(join('docs', name));
    if (name === 'README.md') {
      setMap('docs/README.md', 'pages/overview');
    } else {
      setMap(sourceRel, `pages/${name.replace(/\.md$/, '')}`);
    }
  }

  for (const sub of SUB) {
    const files = await collectSubFiles(sub);
    for (const { rel } of files) {
      const relPath = rel.replace(/^docs\//, '');
      const publicPath = relPath.replace(/\.md$/, '');
      setMap(rel, publicPath);
    }
  }

  // Clear target (keep index.md)
  for (const e of await readdir(targetDir, { withFileTypes: true })) {
    if (e.name === 'index.md') continue;
    await rm(join(targetDir, e.name), { recursive: true, force: true });
  }

  // Write files
  for (const name of await readdir(sourceRoot)) {
    if (!name.endsWith('.md') || EXCLUDE.has(name)) continue;
    const st = await stat(join(sourceRoot, name));
    if (!st.isFile()) continue;
    if (SUB.has(name)) continue;

    const src = join(sourceRoot, name);
    const sourceRel = posix(join('docs', name));
    let out;
    if (name === 'README.md') {
      out = join(targetDir, 'pages', 'overview.md');
    } else {
      out = join(targetDir, 'pages', name);
    }
    await mkdir(dirname(out), { recursive: true });
    let body = await readFile(src, 'utf8');
    if (name === 'README.md' && !body.startsWith('---')) {
      body = `---\ntitle: Documentation index\ndescription: Index of Agent Detective documentation\n---\n\n${body}`;
    } else {
      body = ensureFrontmatter(body, name);
    }
    body = rewriteContent(body, sourceRel);
    await writeFile(out, body, 'utf8');
  }

  for (const sub of SUB) {
    const files = await collectSubFiles(sub);
    for (const { abs, rel } of files) {
      const relPath = rel.replace(/^docs\//, '');
      const out = join(targetDir, ...relPath.split('/'));
      await mkdir(dirname(out), { recursive: true });
      let body = await readFile(abs, 'utf8');
      body = ensureFrontmatter(body, basename(abs));
      body = rewriteContent(body, rel);
      await writeFile(out, body, 'utf8');
    }
  }

  console.log(`[sync-starlight] ${sourceToPublic.size} doc pages → ${posix(relative(root, targetDir))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
