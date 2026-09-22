import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FONT_FILES } from './fontData';

/**
 * Fonts ship inside the code (fontData.ts, generated from assets/fonts – SIL Open Font License) so the creative renders
 * identically on every machine and inside any bundle (Next.js on Vercel). At first use they are written to a private
 * directory in the OS temp folder and libvips/pango find them through a private fontconfig file – no system fonts involved.
 * Must run before the first text render (pango picks its backend + config lazily).
 */
const BASE_DIR = path.join(os.tmpdir(), 'chheda-fontconfig');
export const FONT_DIR = path.join(BASE_DIR, 'fonts');
export const FONT_SERIF = 'Marcellus';
export const FONT_SANS = 'Poppins';

let configured = false;
export function configureFonts(): string {
  if (configured) return process.env.FONTCONFIG_FILE!;
  fs.mkdirSync(FONT_DIR, { recursive: true });
  fs.mkdirSync(path.join(BASE_DIR, 'cache'), { recursive: true });
  for (const [name, b64] of Object.entries(FONT_FILES)) {
    const p = path.join(FONT_DIR, name);
    const buf = Buffer.from(b64, 'base64');
    if (!fs.existsSync(p) || fs.statSync(p).size !== buf.length) fs.writeFileSync(p, buf);
  }
  const conf = path.join(BASE_DIR, 'fonts.conf');
  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <cachedir>${path.join(BASE_DIR, 'cache')}</cachedir>
  <config></config>
</fontconfig>
`;
  fs.writeFileSync(conf, xml);
  process.env.FONTCONFIG_FILE = conf;
  process.env.PANGOCAIRO_BACKEND = 'fontconfig'; // macOS builds default to CoreText, which ignores fontconfig
  configured = true;
  return conf;
}
