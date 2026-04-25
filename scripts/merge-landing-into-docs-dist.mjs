/**
 * Merges apps/landing/dist/ into apps/docs/dist/ (same level as dist/docs/ from Starlight).
 * Run after: pnpm --filter agent-detective-docs build && pnpm --filter agent-detective-landing build
 */
import { cp, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const from = join(root, 'apps', 'landing', 'dist');
const to = join(root, 'apps', 'docs', 'dist');

try {
  await stat(from);
} catch {
  console.error(`[merge-landing-into-docs-dist] missing ${from}; build the landing first.`);
  process.exit(1);
}
try {
  await stat(to);
} catch {
  console.error(`[merge-landing-into-docs-dist] missing ${to}; build the docs app first.`);
  process.exit(1);
}

const entries = await readdir(from, { withFileTypes: true });
for (const e of entries) {
  const src = join(from, e.name);
  const dest = join(to, e.name);
  await cp(src, dest, { recursive: true, force: true });
}
console.log(
  '[merge-landing-into-docs-dist] merged apps/landing/dist/* -> apps/docs/dist ( / + /docs/ )',
);
