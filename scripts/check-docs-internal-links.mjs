#!/usr/bin/env node
/**
 * Verifies relative markdown links under docs/ resolve to existing files.
 * Skips http(s), mailto, and pure #-anchors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(repoRoot, 'docs');

const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;

function walkMarkdown(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMarkdown(p, out);
    else if (ent.isFile() && ent.name.endsWith('.md')) out.push(p);
  }
}

function stripAnchor(href) {
  const i = href.indexOf('#');
  return i === -1 ? href : href.slice(0, i);
}

const mdFiles = [];
walkMarkdown(docsRoot, mdFiles);

const violations = [];

for (const mdPath of mdFiles) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const dir = path.dirname(mdPath);
  let m;
  linkRe.lastIndex = 0;
  while ((m = linkRe.exec(text)) !== null) {
    let href = m[1].trim();
    if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
      continue;
    }
    if (href.startsWith('#')) continue;
    href = stripAnchor(href);
    if (!href) continue;

    const target = path.normalize(path.resolve(dir, href));
    const relToRepo = path.relative(repoRoot, target);
    if (relToRepo.startsWith('..') || path.isAbsolute(relToRepo)) {
      violations.push({
        md: path.relative(repoRoot, mdPath),
        href: m[1].trim(),
        reason: 'link resolves outside repository',
      });
      continue;
    }
    if (!fs.existsSync(target)) {
      violations.push({
        md: path.relative(repoRoot, mdPath),
        href: m[1].trim(),
        reason: 'missing file',
      });
    }
  }
}

if (violations.length > 0) {
  console.error('\n[check-docs-internal-links] Broken or invalid relative links under docs/:\n');
  for (const v of violations) {
    console.error(`  ${v.md}\n    href: ${v.href}\n    (${v.reason})\n`);
  }
  process.exit(1);
}

console.log('[check-docs-internal-links] OK — docs/ relative markdown links resolve.');
