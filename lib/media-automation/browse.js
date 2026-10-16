import fs from 'fs/promises';
import path from 'path';
import { isPathContained } from './files.js';

export const DEFAULT_BROWSE_CANDIDATES = Object.freeze([
    '/media',
    '/movies',
    '/tv',
    '/music',
    '/downloads',
    '/completed',
    '/quarantine',
    '/output',
    '/media2',
    '/media3',
    '/data',
]);

/** Paths (and anything under them) that must never be browsable. */
export const BROWSE_DENY_PREFIXES = Object.freeze([
    '/proc',
    '/sys',
    '/dev',
    '/run',
    '/etc',
    '/boot',
    '/root',
    '/var/lib/docker',
    '/var/run',
    '/usr/lib',
    '/usr/bin',
    '/usr/sbin',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
]);

const SKIP_MOUNT_FSTYPES = new Set([
    'proc',
    'sysfs',
    'devtmpfs',
    'devpts',
    'cgroup',
    'cgroup2',
    'securityfs',
    'pstore',
    'bpf',
    'debugfs',
    'tracefs',
    'configfs',
    'fusectl',
    'mqueue',
    'hugetlbfs',
    'rpc_pipefs',
    'binfmt_misc',
    'autofs',
    'overlay',
    'tmpfs',
]);

/** Default page size for browse responses (large TV libraries exceed this easily). */
export const DEFAULT_BROWSE_LIMIT = 400;
/** Hard cap per request so a pathological directory cannot blow memory/JSON. */
export const MAX_BROWSE_LIMIT = 2000;

const canonical = (value) => (process.platform === 'win32' ? String(value).toLowerCase() : String(value));

const clampLimit = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return DEFAULT_BROWSE_LIMIT;
    return Math.min(MAX_BROWSE_LIMIT, Math.max(1, Math.round(number)));
};

const clampOffset = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(1_000_000, Math.round(number));
};

const unescapeMountField = (value) => String(value || '').replace(/\\([0-7]{3})/g, (_, octal) => (
    String.fromCharCode(Number.parseInt(octal, 8))
));

export const isBrowsePathDenied = (candidate) => {
    const raw = String(candidate || '').trim();
    if (!raw) return true;
    // Prefer POSIX-style comparison so Linux deny prefixes work in tests on Windows too.
    const posix = raw.replace(/\\/g, '/');
    if (posix === '/' || /^[a-zA-Z]:\/?$/.test(posix)) return true;
    const normalized = canonical(posix).replace(/\/+$/, '') || '/';
    return BROWSE_DENY_PREFIXES.some((prefix) => {
        const base = canonical(String(prefix)).replace(/\\/g, '/').replace(/\/+$/, '');
        return normalized === base || normalized.startsWith(`${base}/`);
    });
};

/**
 * Parse Linux mountinfo and return usable volume mount points (not OS virtual mounts).
 * Returns [] when mountinfo is unavailable (unless a custom readFile is injected for tests).
 */
export const discoverContainerMounts = async ({
    mountInfoPath = '/proc/self/mountinfo',
    readFile = fs.readFile,
} = {}) => {
    let text = '';
    try {
        text = await readFile(mountInfoPath, 'utf8');
    } catch {
        return [];
    }
    const mounts = [];
    for (const line of String(text || '').split('\n')) {
        if (!line.trim()) continue;
        const separator = line.indexOf(' - ');
        if (separator < 0) continue;
        const left = line.slice(0, separator).split(' ');
        const right = line.slice(separator + 3).split(' ');
        if (left.length < 5 || right.length < 1) continue;
        const mountPoint = unescapeMountField(left[4]);
        const fsType = String(right[0] || '').toLowerCase();
        if (!mountPoint || mountPoint === '/') continue;
        if (SKIP_MOUNT_FSTYPES.has(fsType)) continue;
        if (isBrowsePathDenied(mountPoint)) continue;
        mounts.push(mountPoint);
    }
    return mounts;
};

export const collectBrowseRoots = async ({
    candidates = DEFAULT_BROWSE_CANDIDATES,
    extraRoots = [],
    discoverMounts = true,
    mountInfoPath = '/proc/self/mountinfo',
    readFile = fs.readFile,
} = {}) => {
    const discovered = discoverMounts
        ? await discoverContainerMounts({ mountInfoPath, readFile })
        : [];
    const seen = new Set();
    const roots = [];
    for (const candidate of [...discovered, ...candidates, ...extraRoots]) {
        const raw = String(candidate || '').trim();
        if (!raw || raw.includes('\0')) continue;
        try {
            const resolved = path.resolve(raw);
            if (isBrowsePathDenied(resolved)) continue;
            const real = await fs.realpath(resolved);
            if (isBrowsePathDenied(real)) continue;
            const key = canonical(real);
            if (seen.has(key)) continue;
            const stat = await fs.stat(real);
            if (!stat.isDirectory()) continue;
            seen.add(key);
            roots.push(real);
        } catch {
            // skip missing mounts
        }
    }
    roots.sort((a, b) => a.localeCompare(b));
    return roots;
};

export const resolveBrowsePath = async (requestedPath, roots = [], {
    allowAdhoc = true,
} = {}) => {
    const raw = String(requestedPath || '').trim();
    if (!raw) {
        return { path: null, root: null, parent: null };
    }
    if (raw.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(raw)) {
        throw Object.assign(new Error('Path is invalid'), { code: 'INVALID_PATH', status: 400 });
    }
    if (isBrowsePathDenied(raw) || isBrowsePathDenied(path.resolve(raw))) {
        throw Object.assign(new Error('Path is outside allowed mount roots'), {
            code: 'PATH_DENIED',
            status: 400,
        });
    }
    const resolved = path.resolve(raw);
    let real;
    try {
        real = await fs.realpath(resolved);
    } catch (error) {
        throw Object.assign(new Error(`Path not found: ${resolved}`), {
            code: 'PATH_NOT_FOUND',
            status: 404,
            cause: error,
        });
    }
    if (isBrowsePathDenied(real)) {
        throw Object.assign(new Error('Path is outside allowed mount roots'), {
            code: 'PATH_DENIED',
            status: 400,
        });
    }
    const matchedRoot = (Array.isArray(roots) ? roots : []).find((entry) => isPathContained(entry, real)) || null;
    if (!matchedRoot && !allowAdhoc) {
        throw Object.assign(new Error('Path is outside allowed mount roots'), {
            code: 'PATH_ESCAPE',
            status: 400,
        });
    }
    const root = matchedRoot || real;
    const stat = await fs.lstat(real);
    if (stat.isSymbolicLink()) {
        throw Object.assign(new Error('Symbolic links are not browsable'), {
            code: 'SYMLINK_REJECTED',
            status: 400,
        });
    }
    if (!stat.isDirectory()) {
        throw Object.assign(new Error('Path is not a directory'), {
            code: 'NOT_DIRECTORY',
            status: 400,
        });
    }
    let parent = null;
    if (matchedRoot) {
        parent = real === matchedRoot ? null : path.dirname(real);
    } else {
        // Ad-hoc: allow Up within the typed tree, but never onto `/` or denied paths.
        const parentCandidate = path.dirname(real);
        if (
            parentCandidate
            && parentCandidate !== real
            && path.resolve(parentCandidate) !== path.resolve('/')
            && !isBrowsePathDenied(parentCandidate)
        ) {
            parent = parentCandidate;
        }
    }
    return { path: real, root, parent, adhoc: !matchedRoot };
};

const normalizeBrowseExtensions = (extensions = []) => new Set(
    (Array.isArray(extensions) ? extensions : [])
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)
        .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`)),
);

export const listBrowseDirectory = async (directoryPath, {
    roots = [],
    includeFiles = false,
    extensions = [],
    limit = DEFAULT_BROWSE_LIMIT,
    offset = 0,
    query = '',
    allowAdhoc = true,
} = {}) => {
    const resolved = await resolveBrowsePath(directoryPath, roots, { allowAdhoc });
    if (!resolved.path) {
        return {
            path: null,
            parent: null,
            root: null,
            roots,
            includeFiles: !!includeFiles,
            entries: roots.map((root) => ({
                name: root,
                path: root,
                type: 'root',
            })),
            total: roots.length,
            offset: 0,
            limit: roots.length,
            hasMore: false,
            query: '',
        };
    }

    const allowedExtensions = normalizeBrowseExtensions(extensions);
    const needle = String(query || '').trim().toLowerCase();
    const dirents = await fs.readdir(resolved.path, { withFileTypes: true });
    const entries = [];
    for (const dirent of dirents) {
        const name = dirent.name;
        if (!name || name === '.' || name === '..') continue;
        if (needle && !name.toLowerCase().includes(needle)) continue;
        const fullPath = path.join(resolved.path, name);
        try {
            if (dirent.isSymbolicLink()) continue;
            if (dirent.isDirectory()) {
                if (!isPathContained(resolved.root, fullPath)) continue;
                entries.push({ name, path: fullPath, type: 'directory' });
                continue;
            }
            if (includeFiles && dirent.isFile()) {
                const ext = path.extname(name).toLowerCase();
                if (allowedExtensions.size && !allowedExtensions.has(ext)) continue;
                entries.push({ name, path: fullPath, type: 'file' });
            }
        } catch {
            // skip unreadable
        }
    }
    // Sort the full set first — never truncate mid-readdir (FS order is not alphabetical).
    entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' || a.type === 'root' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const safeLimit = clampLimit(limit);
    const safeOffset = clampOffset(offset);
    const total = entries.length;
    const page = entries.slice(safeOffset, safeOffset + safeLimit);

    return {
        path: resolved.path,
        parent: resolved.parent,
        root: resolved.root,
        roots,
        includeFiles: !!includeFiles,
        entries: page,
        total,
        offset: safeOffset,
        limit: safeLimit,
        hasMore: safeOffset + page.length < total,
        query: String(query || '').trim(),
    };
};

export default listBrowseDirectory;
