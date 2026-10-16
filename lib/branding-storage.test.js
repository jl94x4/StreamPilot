import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    brandingPublicPath,
    getBrandingDir,
    migrateLegacyBrandingAssets,
    parseBrandingPublicPath,
    writeBrandingAsset,
} from './branding-storage.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

assert.equal(parseBrandingPublicPath('/static/login.webp?v=1')?.assetName, 'login');
assert.equal(brandingPublicPath('login', 'png'), '/static/login.png');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'branding-'));
const configDir = path.join(tmp, 'config');
const staticDir = path.join(tmp, 'static');
const brandingDir = getBrandingDir(configDir);
await fs.mkdir(staticDir, { recursive: true });
await fs.writeFile(path.join(staticDir, 'logo.png'), png);

const migrated = await migrateLegacyBrandingAssets(brandingDir, staticDir);
assert.equal(migrated, 1);

const saved = await writeBrandingAsset(brandingDir, 'favicon', png);
assert.equal(saved.publicPath, '/static/favicon.png');

await fs.rm(tmp, { recursive: true, force: true });
console.log('branding-storage ok');
