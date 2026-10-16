/**
 * Per-tab launcher logos stored under config/branding/custom-tabs/.
 */

import fs from 'fs/promises';
import path from 'path';

const EXTENSIONS = ['png', 'jpg', 'webp'];
const TAB_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const detectImageExtension = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
        && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp';
    return null;
};

export const isCustomTabLogoId = (tabId) => TAB_ID_RE.test(String(tabId || '').trim());

const logosDir = (brandingDir) => path.join(String(brandingDir || ''), 'custom-tabs');

export const writeCustomTabLogo = async (brandingDir, tabId, buffer) => {
    const id = String(tabId || '').trim();
    if (!isCustomTabLogoId(id)) throw new Error('Invalid tab id.');
    const extension = detectImageExtension(buffer);
    if (!extension) {
        throw new Error('Invalid image format. Only PNG, JPEG, and WebP files are accepted.');
    }
    const dir = logosDir(brandingDir);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(EXTENSIONS.map((ext) => (
        fs.unlink(path.join(dir, `${id}.${ext}`)).catch(() => null)
    )));
    const filePath = path.join(dir, `${id}.${extension}`);
    await fs.writeFile(filePath, buffer);
    return { filePath, extension, contentType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}` };
};

export const readCustomTabLogo = async (brandingDir, tabId) => {
    const id = String(tabId || '').trim();
    if (!isCustomTabLogoId(id)) return null;
    const dir = logosDir(brandingDir);
    for (const ext of EXTENSIONS) {
        const filePath = path.join(dir, `${id}.${ext}`);
        try {
            const buffer = await fs.readFile(filePath);
            if (!buffer.length) continue;
            return {
                buffer,
                extension: ext,
                contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
            };
        } catch {
            // try next
        }
    }
    return null;
};
