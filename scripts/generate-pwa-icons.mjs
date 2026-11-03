/**
 * Regenerate static PWA / apple-touch icons from logo-app.png (stacked StreamPilot).
 * Run from repo root: node scripts/generate-pwa-icons.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import {
    readApplicationLogoBuffer,
    writePwaStaticIconFiles,
    HOME_SCREEN_ICON_REV,
} from '../lib/portal-branding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, '..', 'static');

const source = await readApplicationLogoBuffer(staticDir, { preferAppIcon: true });
if (!source) {
    console.error('Missing static/logo-app.png (or logo.png fallback)');
    process.exit(1);
}
const result = await writePwaStaticIconFiles(source, staticDir, { mode: 'application' });
console.log(`Wrote stacked PWA / apple-touch icons (rev=${HOME_SCREEN_ICON_REV}, file=${result.revName})`);
