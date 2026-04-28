#!/usr/bin/env node
/**
 * Enforces ADR 0001: workspace *plugins* must not compile-import other plugins.
 * Use `@agent-detective/types` for shared ports and `getService()` at runtime.
 *
 * Scans all `.ts` files under each plugin package's `src/` tree (excludes `*.test.ts`).
 *
 * Remediation: move shared interfaces to `@agent-detective/types`; resolve services via
 * `context.getService<T>(pluginName)`.
 *
 * See docs/architecture/adr/0001-layering-and-plugin-boundaries.md
 * and docs/development/agent-golden-rules.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** Plugin package names (npm `name` field) — keep in sync with packages that register via Plugin. */
const PLUGIN_NAMES = new Set([
  '@agent-detective/jira-adapter',
  '@agent-detective/linear-adapter',
  '@agent-detective/local-repos-plugin',
  '@agent-detective/pr-pipeline',
]);

const importRe = /\bfrom\s+['"](@agent-detective\/[^'"]+)['"]/g;

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

function readPackageName(packageDir) {
  const pj = path.join(packageDir, 'package.json');
  if (!fs.existsSync(pj)) return null;
  const { name } = JSON.parse(fs.readFileSync(pj, 'utf8'));
  return typeof name === 'string' ? name : null;
}

const violations = [];

const packagesDir = path.join(repoRoot, 'packages');
for (const ent of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!ent.isDirectory()) continue;
  const packageDir = path.join(packagesDir, ent.name);
  const pkgName = readPackageName(packageDir);
  if (!pkgName || !PLUGIN_NAMES.has(pkgName)) continue;

  const srcRoot = path.join(packageDir, 'src');
  const files = [];
  walkDir(srcRoot, files);

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(text)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('@agent-detective/')) continue;
      if (!PLUGIN_NAMES.has(spec)) continue;
      if (spec === pkgName) continue;
      violations.push({
        file: path.relative(repoRoot, file),
        spec,
        fix: `Do not import another plugin (${spec}) from ${pkgName}. Use @agent-detective/types for ports and getService() at runtime.`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    '\n[check-plugin-cross-imports] Plugin packages must not compile-import other plugins.\n',
  );
  for (const v of violations) {
    console.error(`  ${v.file}\n    import: ${v.spec}\n    → ${v.fix}\n`);
  }
  console.error('See docs/architecture/adr/0001-layering-and-plugin-boundaries.md\n');
  process.exit(1);
}

console.log('[check-plugin-cross-imports] OK — no cross-plugin compile imports.');
