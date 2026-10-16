import fs from 'fs/promises';
import path from 'path';
import { applyNamingTemplate, buildNamingContext, sanitizeFileToken } from './naming.js';

const uniqueTargetPath = async (dir, filename) => {
    const parsed = path.parse(filename);
    let candidate = path.join(dir, filename);
    let index = 1;
    while (true) {
        try {
            await fs.access(candidate);
            candidate = path.join(dir, `${parsed.name}.${index}${parsed.ext}`);
            index += 1;
        } catch {
            return candidate;
        }
    }
};

export const deliverCompletedMedia = async ({
    sourcePath,
    target,
    probe = {},
    namingContext = {},
    namingConfig = null,
} = {}) => {
    if (!sourcePath || !target?.path) {
        throw Object.assign(new Error('Delivery source and target path are required'), { code: 'DELIVERY_INVALID' });
    }
    const destDir = path.resolve(String(target.path));
    await fs.mkdir(destDir, { recursive: true });
    const context = buildNamingContext({
        probe,
        sourcePath,
        ...namingContext,
    });
    let filename = path.basename(sourcePath);
    let namingMode = String(target.namingMode || 'as-is');
    let namingFallback = false;
    if (namingMode === 'sonarr-pattern') {
        const template = namingConfig?.standardEpisodeFormat
            || namingConfig?.animeEpisodeFormat
            || namingConfig?.movieFormat
            || '{series} - {s00e00} - {quality}';
        try {
            const rendered = applyNamingTemplate(template, context);
            const ext = path.extname(sourcePath) || '.mkv';
            filename = `${rendered}${ext}`;
        } catch {
            namingFallback = true;
            namingMode = 'as-is';
            filename = path.basename(sourcePath);
        }
        if (!context.s00e00 && !context.movie) {
            namingFallback = true;
            filename = path.basename(sourcePath);
        }
    }
    filename = sanitizeFileToken(filename) || path.basename(sourcePath);
    const deliveredPath = await uniqueTargetPath(destDir, filename);
    const mode = String(target.mode || 'copy').toLowerCase() === 'move' ? 'move' : 'copy';
    if (mode === 'move') await fs.rename(sourcePath, deliveredPath).catch(async () => {
        await fs.copyFile(sourcePath, deliveredPath);
        await fs.rm(sourcePath, { force: true });
    });
    else await fs.copyFile(sourcePath, deliveredPath);
    return {
        targetId: target.id || null,
        targetName: target.name || null,
        mode,
        namingMode: String(target.namingMode || 'as-is'),
        namingFallback,
        deliveredPath,
    };
};

export default deliverCompletedMedia;
