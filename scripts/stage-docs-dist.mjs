/**
 * Nests the Starlight `apps/docs/dist` output under `dist/docs/` so the site is served at
 *   https://<custom-domain>/docs/
 * (GitHub project Pages) when base is '/docs'. Run after `astro build` in apps/docs.
 */
import { rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appsDocs = join(__dirname, '..', 'apps', 'docs');
const dist = join(appsDocs, 'dist');
const flat = join(appsDocs, 'dist.__flat__');

async function main() {
  await rename(dist, flat);
  await mkdir(join(appsDocs, 'dist'), { recursive: true });
  await rename(flat, join(appsDocs, 'dist', 'docs'));
  console.log('[stage-docs-dist] dist/ -> dist/docs/ (served at /docs/ on the Pages host, e.g. custom domain)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
