import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readCustomTabLogo, writeCustomTabLogo } from './custom-tab-logos.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-tab-logos-'));
try {
    const saved = await writeCustomTabLogo(dir, 'tab-abc12345', png);
    assert.equal(saved.extension, 'png');
    const loaded = await readCustomTabLogo(dir, 'tab-abc12345');
    assert.ok(loaded?.buffer?.length);
    assert.equal(loaded.contentType, 'image/png');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    await writeCustomTabLogo(dir, uuid, png);
    const uuidLoaded = await readCustomTabLogo(dir, uuid);
    assert.ok(uuidLoaded?.buffer?.length);
    await assert.rejects(() => writeCustomTabLogo(dir, '../evil', png));
    await assert.rejects(() => writeCustomTabLogo(dir, 'bad id', png));
    await assert.rejects(() => writeCustomTabLogo(dir, 'tab-abc12345', Buffer.from('not-an-image')));
} finally {
    await fs.rm(dir, { recursive: true, force: true });
}

console.log('custom tab logos ok');
