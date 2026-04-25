/**
 * Downscale public/icon-1024.png to favicon + Apple touch (requires sharp, same as docs app).
 */
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const src = join(publicDir, 'icon-1024.png');

async function fileExists(f) {
  try {
    await stat(f);
    return true;
  } catch {
    return false;
  }
}

try {
  if (!(await fileExists(src))) {
    console.warn(`[generate-favicons] skip: missing ${src}`);
    process.exit(0);
  }
  await sharp(src).resize(32, 32).png().toFile(join(publicDir, 'favicon-32.png'));
  await sharp(src).resize(180, 180).png().toFile(join(publicDir, 'apple-touch-icon.png'));
  console.log('[generate-favicons] wrote favicon-32.png, apple-touch-icon.png');
} catch (e) {
  console.error(e);
  process.exit(1);
}
