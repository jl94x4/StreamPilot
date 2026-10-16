import fs from 'fs/promises';
import path from 'path';

const normalizePathKey = (value) => String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();

/** Escape for RegExp, then treat * as a wildcard segment matcher. */
const globToRegExp = (pattern) => {
    const escaped = String(pattern)
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
};

export const normalizePathDenyList = (value, { max = 200 } = {}) => {
    const raw = Array.isArray(value)
        ? value
        : String(value || '').split(/\r?\n|,/);
    return [...new Set(
        raw
            .map((entry) => String(entry || '').trim())
            .filter((entry) => entry && entry.length <= 512)
            .slice(0, max),
    )];
};

export const isPathDenied = (filePath, denyList = []) => {
    const target = normalizePathKey(path.resolve(String(filePath || '')));
    if (!target) return false;
    return (Array.isArray(denyList) ? denyList : []).some((entry) => {
        const pattern = String(entry || '').trim();
        if (!pattern) return false;
        if (pattern.includes('*')) {
            return globToRegExp(normalizePathKey(pattern)).test(target);
        }
        let prefix = normalizePathKey(path.resolve(pattern));
        if (!prefix) return false;
        if (prefix.endsWith('/')) prefix = prefix.slice(0, -1);
        return target === prefix || target.startsWith(`${prefix}/`);
    });
};

export const getFreeDiskBytes = async (dirPath) => {
    const target = String(dirPath || '').trim();
    if (!target) return null;
    try {
        if (typeof fs.statfs === 'function') {
            const stats = await fs.statfs(target);
            const available = Number(stats.bavail) * Number(stats.bsize);
            return Number.isFinite(available) ? Math.max(0, available) : null;
        }
    } catch {
        // Fall through — unknown free space should not hard-fail callers.
    }
    return null;
};

export const assertMinFreeDisk = async (dirPath, minFreeDiskGb = 20) => {
    const minGb = Number(minFreeDiskGb);
    if (!Number.isFinite(minGb) || minGb <= 0) return { ok: true, freeBytes: null, requiredBytes: 0 };
    const requiredBytes = Math.round(minGb * 1024 ** 3);
    const freeBytes = await getFreeDiskBytes(dirPath);
    if (freeBytes == null) return { ok: true, freeBytes: null, requiredBytes };
    if (freeBytes < requiredBytes) {
        const error = new Error(
            `Not enough free disk space on ${dirPath}: need ≥ ${minGb} GB free `
            + `(${(freeBytes / 1024 ** 3).toFixed(1)} GB available)`,
        );
        error.code = 'DISK_SPACE_LOW';
        error.freeBytes = freeBytes;
        error.requiredBytes = requiredBytes;
        throw error;
    }
    return { ok: true, freeBytes, requiredBytes };
};

export default {
    normalizePathDenyList,
    isPathDenied,
    getFreeDiskBytes,
    assertMinFreeDisk,
};
