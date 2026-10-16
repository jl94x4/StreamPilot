import fs from 'fs/promises';
import path from 'path';

const canonical = (value) => process.platform === 'win32' ? value.toLowerCase() : value;

export const isPathContained = (root, candidate) => {
    const base = canonical(path.resolve(root));
    const target = canonical(path.resolve(candidate));
    const relative = path.relative(base, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * Resolve a candidate under a library root after realpath, rejecting escapes.
 * Symbolic links are rejected by default so jobs cannot follow links outside the mount.
 */
export const resolveContainedPath = async (root, candidate, {
    mustExist = true,
    allowSymlinks = false,
} = {}) => {
    const base = await fs.realpath(path.resolve(root));
    const resolved = path.resolve(base, candidate);
    if (!isPathContained(base, resolved)) throw new Error('Path escapes the configured library root');
    if (!mustExist) return resolved;

    const lstat = await fs.lstat(resolved);
    if (lstat.isSymbolicLink() && !allowSymlinks) {
        throw Object.assign(new Error('Symbolic links are not allowed as media sources'), {
            code: 'SYMLINK_REJECTED',
        });
    }

    const absolute = await fs.realpath(resolved);
    if (!isPathContained(base, absolute)) throw new Error('Resolved path escapes the configured library root');
    return absolute;
};

export async function* discoverMediaFiles(root, {
    extensions = [],
    followSymlinks = false,
    signal,
} = {}) {
    const base = await fs.realpath(path.resolve(root));
    const allowed = new Set(extensions.map((extension) => String(extension).toLowerCase()));
    const pending = [base];
    const visited = new Set();

    while (pending.length) {
        if (signal?.aborted) throw signal.reason || new Error('Discovery aborted');
        const directory = pending.pop();
        const realDirectory = await fs.realpath(directory);
        if (!isPathContained(base, realDirectory) || visited.has(canonical(realDirectory))) continue;
        visited.add(canonical(realDirectory));
        const entries = await fs.readdir(realDirectory, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            if (signal?.aborted) throw signal.reason || new Error('Discovery aborted');
            const candidate = path.join(realDirectory, entry.name);
            if (entry.isSymbolicLink()) {
                if (!followSymlinks) continue;
                const real = await fs.realpath(candidate).catch(() => null);
                if (!real || !isPathContained(base, real)) continue;
                const stat = await fs.stat(real);
                if (stat.isDirectory()) pending.push(real);
                else if (stat.isFile() && (!allowed.size || allowed.has(path.extname(real).toLowerCase()))) yield real;
            } else if (entry.isDirectory()) {
                pending.push(candidate);
            } else if (entry.isFile() && (!allowed.size || allowed.has(path.extname(entry.name).toLowerCase()))) {
                yield candidate;
            }
        }
    }
}

export const listMediaFiles = async (root, options) => {
    const files = [];
    for await (const file of discoverMediaFiles(root, options)) files.push(file);
    return files;
};
