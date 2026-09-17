import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fonts are bundled in apps/api/assets/fonts (SIL Open Font License) so the creative renders identically
 * on every machine. libvips/pango find them through a private fontconfig file – no system fonts involved.
 * Must run before the first text render (pango picks its backend + config lazily).
 */
export const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');
export const FONT_SERIF = 'Marcellus';
export const FONT_SANS = 'Poppins';

let configured = false;
export function configureFonts(): string {
  if (configured) return process.env.FONTCONFIG_FILE!;
  for (const f of ['Marcellus-Regular.ttf', 'Poppins-Regular.ttf', 'Poppins-SemiBold.ttf']) {
    if (!fs.existsSync(path.join(FONT_DIR, f))) throw new Error(`Bundled font missing: ${path.join(FONT_DIR, f)}`);
  }
  const dir = path.join(os.tmpdir(), 'chheda-fontconfig');
  fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
  const conf = path.join(dir, 'fonts.conf');
  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <cachedir>${path.join(dir, 'cache')}</cachedir>
  <config></config>
</fontconfig>
`;
  fs.writeFileSync(conf, xml);
  process.env.FONTCONFIG_FILE = conf;
  process.env.PANGOCAIRO_BACKEND = 'fontconfig'; // macOS builds default to CoreText, which ignores fontconfig
  configured = true;
  return conf;
}
