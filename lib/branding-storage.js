import fs from 'fs/promises';
import path from 'path';

export const BRANDING_ASSET_NAMES = new Set(['logo', 'background', 'favicon', 'login', 'badge']);
export const BRANDING_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

export const getBrandingDir = (configDir = '') => path.join(String(configDir || ''), 'branding');

export const brandingPublicPath = (assetName, extension) => {
    const name = String(assetName || '').trim().toLowerCase();
    const ext = String(extension || '').trim().toLowerCase().replace(/^jpeg$/, 'jpg');
    if (!BRANDING_ASSET_NAMES.has(name) || !BRANDING_EXTENSIONS.includes(ext)) return '';
    return `/static/${name}.${ext}`;
};

export const parseBrandingPublicPath = (value = '') => {
    const trimmed = String(value || '').trim().split('?')[0];
    const match = trimmed.match(/^\/static\/(logo|background|favicon|login|badge)\.(png|jpg|jpeg|webp)$/i);
    if (!match) return null;
    return {
        assetName: match[1].toLowerCase(),
        extension: match[2].toLowerCase().replace(/^jpeg$/, 'jpg'),
    };
};

const detectImageExtension = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
        && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp';
    return null;
};

export const findBrandingAssetPath = async (brandingDir, assetName) => {
    const name = String(assetName || '').trim().toLowerCase();
    if (!BRANDING_ASSET_NAMES.has(name)) return null;
    for (const ext of BRANDING_EXTENSIONS) {
        const filePath = path.join(brandingDir, `${name}.${ext}`);
        try {
            await fs.access(filePath);
            return filePath;
        } catch {
            // try next extension
        }
    }
    return null;
};

export const readBrandingAssetBuffer = async (brandingDir, assetName) => {
    const filePath = await findBrandingAssetPath(brandingDir, assetName);
    if (!filePath) return null;
    try {
        const buffer = await fs.readFile(filePath);
        return buffer.length ? buffer : null;
    } catch {
        return null;
    }
};

export const readBrandingAssetByPublicPath = async (publicPath, brandingDir) => {
    const parsed = parseBrandingPublicPath(publicPath);
    if (!parsed) return null;
    const filePath = path.join(brandingDir, `${parsed.assetName}.${parsed.extension}`);
    try {
        const buffer = await fs.readFile(filePath);
        return buffer.length ? buffer : null;
    } catch {
        return null;
    }
};

export const writeBrandingAsset = async (brandingDir, assetName, buffer) => {
    const name = String(assetName || '').trim().toLowerCase();
    if (!BRANDING_ASSET_NAMES.has(name)) {
        throw new Error(`Unsupported branding asset: ${assetName}`);
    }
    const extension = detectImageExtension(buffer);
    if (!extension) {
        throw new Error('Invalid image format. Only PNG, JPEG, and WebP files are accepted.');
    }
    await fs.mkdir(brandingDir, { recursive: true });
    await Promise.all(BRANDING_EXTENSIONS.map((ext) => (
        fs.unlink(path.join(brandingDir, `${name}.${ext}`)).catch(() => null)
    )));
    const filePath = path.join(brandingDir, `${name}.${extension}`);
    await fs.writeFile(filePath, buffer);
    return {
        filePath,
        publicPath: brandingPublicPath(name, extension),
        extension,
    };
};

/** Copy legacy /app/static uploads into the config volume so updates keep custom art. */
export const migrateLegacyBrandingAssets = async (brandingDir, staticDir, log = () => {}) => {
    await fs.mkdir(brandingDir, { recursive: true });
    let migrated = 0;
    for (const assetName of BRANDING_ASSET_NAMES) {
        const existing = await findBrandingAssetPath(brandingDir, assetName);
        if (existing) continue;
        for (const ext of BRANDING_EXTENSIONS) {
            const legacyPath = path.join(staticDir, `${assetName}.${ext}`);
            try {
                const buffer = await fs.readFile(legacyPath);
                if (!buffer.length) continue;
                await writeBrandingAsset(brandingDir, assetName, buffer);
                migrated += 1;
                log(`[Branding] migrated ${assetName}.${ext} from static/ into config volume`);
                break;
            } catch {
                // not in legacy static dir
            }
        }
    }
    return migrated;
};
