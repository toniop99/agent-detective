#!/usr/bin/env node
/**
 * Ensures workspace packages never import the root app's `src/` tree via
 * relative paths (a common agent mistake that breaks standalone package builds).
 *
 * Remediation: use `@agent-detective/types` and other `workspace:*` packages.
 * See docs/development/agent-golden-rules.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const rootSrc = path.join(repoRoot, 'src');

/** Static relative imports only (ESM `from './x.js'`). */
const importRe = /\bfrom\s+['"](\.[^'"]+)['"]/g;

/** True if `target` is `parent` or a descendant (resolved paths). */
function isPathInsideOrEqual(target, parent) {
  const rel = path.relative(parent, target);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) return false;
  return true;
}

function walkDir(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      walkDir(p, out);
    } else if (
      ent.isFile() &&
      ent.name.endsWith('.ts') &&
      !ent.name.endsWith('.d.ts') &&
      !ent.name.endsWith('.test.ts')
    ) {
      out.push(p);
    }
  }
}

function packageSrcDirs() {
  const pkgs = [];
  const packagesDir = path.join(repoRoot, 'packages');
  for (const name of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const src = path.join(packagesDir, name.name, 'src');
    if (fs.existsSync(src)) pkgs.push(src);
  }
  return pkgs;
}

const violations = [];

for (const srcRoot of packageSrcDirs()) {
  const files = [];
  walkDir(srcRoot, files);
  for (const file of files) {
    const relFile = path.relative(repoRoot, file);
    const text = fs.readFileSync(file, 'utf8');
    let m;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(text)) !== null) {
      const spec = m[1];
      const resolved = path.normalize(path.resolve(path.dirname(file), spec));
      if (isPathInsideOrEqual(resolved, rootSrc)) {
        violations.push({
          file: relFile,
          spec,
          fix: 'Import from `@agent-detective/types` or another workspace package — not from `../../src/...` paths into the root app.',
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    '\n[check-package-root-imports] Workspace package imports must not reach the root app `src/` tree.\n',
  );
  for (const v of violations) {
    console.error(`  ${v.file}\n    import: ${v.spec}\n    → ${v.fix}\n`);
  }
  console.error('See docs/development/agent-golden-rules.md\n');
  process.exit(1);
}

console.log('[check-package-root-imports] OK — no package → root src/ relative imports.');
