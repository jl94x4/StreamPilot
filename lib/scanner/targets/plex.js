import path from 'path';
import fetch from 'node-fetch';
import {
    createRewriter,
    expandPathRewriteCandidates,
    pathMatchesLibraryRoot,
    remapPathOntoLibraryRoot,
    ensureTrailingSlash,
    joinUrl,
} from '../rewrite.js';

const plexHeaders = (token) => ({
    Accept: 'application/json',
    'X-Plex-Token': token,
    'X-Plex-Product': 'StreamPilot-Scanner',
    'X-Plex-Client-Identifier': 'portal-scanner',
});

const normalizePlexPath = (value) => String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');

const pathsMatch = (left, right) => {
    const a = normalizePlexPath(left).toLowerCase();
    const b = normalizePlexPath(right).toLowerCase();
    return !!a && !!b && (a === b || a.endsWith(b) || b.endsWith(a));
};

const collectMetadataNodes = (payload) => {
    const nodes = [];
    const root = payload?.MediaContainer || payload || {};
    if (Array.isArray(root.Metadata)) nodes.push(...root.Metadata);
    for (const hub of Array.isArray(root.Hub) ? root.Hub : []) {
        if (Array.isArray(hub?.Metadata)) nodes.push(...hub.Metadata);
    }
    return nodes;
};

/** Movie / episode / track — not show/season (analyzing a show won't update episode codecs). */
const isLeafMediaType = (meta) => {
    const raw = meta?.type ?? meta?.Type;
    const value = String(raw ?? '').trim().toLowerCase();
    return value === '1' || value === '4' || value === '10'
        || value === 'movie' || value === 'episode' || value === 'track';
};

const collectPartFiles = (meta) => {
    const parts = [];
    for (const media of Array.isArray(meta?.Media) ? meta.Media : []) {
        for (const part of Array.isArray(media?.Part) ? media.Part : []) {
            if (part?.file) parts.push(part.file);
        }
    }
    return parts;
};

const videoCodecFromMeta = (meta) => {
    for (const media of Array.isArray(meta?.Media) ? meta.Media : []) {
        const codec = String(media?.videoCodec || media?.VideoCodec || '').trim();
        if (codec) return codec.toLowerCase();
    }
    return '';
};

const normalizeCodecName = (value) => {
    const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!raw) return '';
    if (raw === 'h265' || raw === 'hevc' || raw === 'x265') return 'hevc';
    if (raw === 'h264' || raw === 'avc' || raw === 'x264') return 'h264';
    if (raw === 'av1') return 'av1';
    if (raw === 'mpeg2video' || raw === 'mpeg2') return 'mpeg2';
    return raw;
};

const codecsMatch = (left, right) => {
    const a = normalizeCodecName(left);
    const b = normalizeCodecName(right);
    return !!a && !!b && a === b;
};

const ratingKeysMatchingFile = (nodes, candidates, { trustWithoutParts = false } = {}) => {
    const keys = new Set();
    for (const meta of nodes) {
        const ratingKey = String(meta?.ratingKey || '').trim();
        if (!ratingKey) continue;
        const parts = collectPartFiles(meta);
        if (!parts.length) {
            // `/all?file=` often omits Part.file — only trust leaf types (not the parent show).
            if (trustWithoutParts && isLeafMediaType(meta)) keys.add(ratingKey);
            continue;
        }
        if (parts.some((file) => candidates.some((candidate) => pathsMatch(file, candidate)))) {
            keys.add(ratingKey);
        }
    }
    return [...keys];
};

/**
 * @param {{ url: string, token: string, rewrite?: { from: string, to: string }[] }} cfg
 */
export const createPlexTarget = (cfg) => {
    const baseURL = String(cfg.url || '').replace(/\/+$/, '');
    const token = String(cfg.token || '');
    const rewriteRules = Array.isArray(cfg.rewrite) ? cfg.rewrite : [];
    const rewrite = createRewriter(rewriteRules);
    let librariesCache = null;
    let librariesAt = 0;

    const pathCandidates = (input) => expandPathRewriteCandidates(input, rewriteRules);

    const candidatesForLibraries = (input, libraries) => {
        const base = pathCandidates(input);
        const remapped = [];
        for (const lib of libraries || []) {
            for (const candidate of base) {
                const next = remapPathOntoLibraryRoot(candidate, lib.path);
                if (next) remapped.push(next);
            }
        }
        return [...new Set([...base, ...remapped])];
    };

    const loadLibraries = async (force = false) => {
        if (!force && librariesCache && Date.now() - librariesAt < 60_000) return librariesCache;
        const res = await fetch(joinUrl(baseURL, 'library', 'sections'), {
            headers: plexHeaders(token),
        });
        if (!res.ok) {
            const err = new Error(`Plex libraries HTTP ${res.status}`);
            err.code = res.status === 401 ? 'FATAL' : 'UNAVAILABLE';
            throw err;
        }
        const data = await res.json();
        const dirs = data?.MediaContainer?.Directory || [];
        const libraries = [];
        for (const lib of dirs) {
            const locations = lib.Location || [];
            for (const loc of locations) {
                libraries.push({
                    id: Number(lib.key),
                    name: String(lib.title || ''),
                    path: ensureTrailingSlash(loc.path || ''),
                });
            }
        }
        librariesCache = libraries;
        librariesAt = Date.now();
        return libraries;
    };

    const matchingLibraries = async (sourceFile) => {
        const libraries = await loadLibraries();
        const folderCandidates = candidatesForLibraries(path.dirname(sourceFile), libraries);
        const fileCandidates = candidatesForLibraries(sourceFile, libraries);
        return libraries.filter((lib) => (
            folderCandidates.some((candidate) => pathMatchesLibraryRoot(candidate, lib.path))
            || fileCandidates.some((candidate) => pathMatchesLibraryRoot(candidate, lib.path))
        ));
    };

    /** Pick the candidate path that sits under this Plex library root (host or container). */
    const refreshPathForLibrary = (sourceFolder, libPath, libraries) => {
        const candidates = candidatesForLibraries(sourceFolder, libraries || [{ path: libPath }]);
        return candidates.find((candidate) => pathMatchesLibraryRoot(candidate, libPath)) || null;
    };

    const fetchJson = async (url) => {
        const res = await fetch(url.toString(), { headers: plexHeaders(token) });
        if (!res.ok) return null;
        return res.json().catch(() => null);
    };

    const addKeysFromPayload = (keys, payload, candidates, trustWithoutParts) => {
        for (const key of ratingKeysMatchingFile(collectMetadataNodes(payload), candidates, { trustWithoutParts })) {
            keys.add(key);
        }
    };

    const resolveRatingKeys = async (filePath) => {
        const sourceFile = String(filePath || '').trim();
        if (!sourceFile) return [];
        const basename = path.basename(sourceFile);
        const stem = basename.replace(/\.[^.]+$/, '');
        const keys = new Set();

        let libraries = await matchingLibraries(sourceFile);
        // Only trust ?file= hits without Part.file when we already scoped to matching library roots.
        // Broad "all sections" fallback requires Part.file verification.
        let trustFileFilter = libraries.length > 0;
        if (!libraries.length) {
            libraries = await loadLibraries();
            trustFileFilter = false;
        }
        const candidates = [...new Set(
            candidatesForLibraries(sourceFile, libraries).map((entry) => normalizePlexPath(entry)).filter(Boolean),
        )];

        for (const lib of libraries) {
            for (const fileCandidate of candidates) {
                // Prefer allLeaves first — `/all?file=` on TV libraries often returns the show, not the episode.
                for (const endpoint of ['allLeaves', 'all']) {
                    const byFile = new URL(joinUrl(baseURL, 'library', 'sections', String(lib.id), endpoint));
                    byFile.searchParams.set('file', fileCandidate);
                    const payload = await fetchJson(byFile);
                    addKeysFromPayload(keys, payload, candidates, trustFileFilter);
                    if (keys.size) break;
                }
                if (keys.size) break;
            }
            if (keys.size) break;
            // Some PMS builds prefer path= (file or parent folder) over file=.
            for (const pathCandidate of [...candidates, ...candidates.map((entry) => path.posix.dirname(entry))]) {
                if (!pathCandidate || pathCandidate === '/' || pathCandidate === '.') continue;
                const byPath = new URL(joinUrl(baseURL, 'library', 'sections', String(lib.id), 'allLeaves'));
                byPath.searchParams.set('path', pathCandidate);
                const pathPayload = await fetchJson(byPath);
                addKeysFromPayload(keys, pathPayload, candidates, false);
                if (keys.size) break;
            }
            if (keys.size) break;
        }

        if (!keys.size && (basename || stem)) {
            const queries = [...new Set([basename, stem].filter(Boolean))];
            for (const query of queries) {
                const searchUrl = new URL(joinUrl(baseURL, 'hubs', 'search'));
                searchUrl.searchParams.set('query', query);
                searchUrl.searchParams.set('limit', '50');
                const searchPayload = await fetchJson(searchUrl);
                const searchNodes = collectMetadataNodes(searchPayload);
                for (const meta of searchNodes.slice(0, 25)) {
                    const ratingKey = String(meta?.ratingKey || '').trim();
                    if (!ratingKey) continue;
                    if (ratingKeysMatchingFile([meta], candidates).length) {
                        keys.add(ratingKey);
                        continue;
                    }
                    const detailUrl = new URL(joinUrl(baseURL, 'library', 'metadata', ratingKey));
                    const detail = await fetchJson(detailUrl);
                    addKeysFromPayload(keys, detail, candidates, false);
                }
            }
        }

        return [...keys];
    };

    const analyzeRatingKey = async (ratingKey) => {
        const url = new URL(joinUrl(baseURL, 'library', 'metadata', String(ratingKey), 'analyze'));
        const res = await fetch(url.toString(), {
            method: 'PUT',
            headers: plexHeaders(token),
        });
        if (!res.ok) {
            const err = new Error(`Plex analyze HTTP ${res.status}`);
            err.code = [404, 500, 502, 503, 504].includes(res.status) ? 'UNAVAILABLE' : 'FATAL';
            throw err;
        }
        return { ratingKey: String(ratingKey) };
    };

    const fetchMetadata = async (ratingKey) => {
        const detailUrl = new URL(joinUrl(baseURL, 'library', 'metadata', String(ratingKey)));
        const detail = await fetchJson(detailUrl);
        return collectMetadataNodes(detail)[0] || null;
    };

    const waitForCodec = async (ratingKey, expectedVideoCodec, {
        timeoutMs = 45_000,
        pollMs = 2500,
        reanalyzeEvery = 2,
    } = {}) => {
        const expected = normalizeCodecName(expectedVideoCodec);
        if (!expected) return { matched: false, videoCodec: null, polls: 0 };
        const started = Date.now();
        let polls = 0;
        let lastCodec = '';
        while (Date.now() - started < timeoutMs) {
            polls += 1;
            const meta = await fetchMetadata(ratingKey);
            lastCodec = videoCodecFromMeta(meta);
            if (codecsMatch(lastCodec, expected)) {
                return { matched: true, videoCodec: lastCodec, polls };
            }
            if (polls % reanalyzeEvery === 0) {
                await analyzeRatingKey(ratingKey).catch(() => null);
            }
            await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
        return { matched: false, videoCodec: lastCodec || null, polls };
    };

    return {
        type: 'plex',
        available: async () => {
            const res = await fetch(baseURL + '/', { headers: plexHeaders(token) });
            if (!res.ok) {
                const err = new Error(`Plex unavailable HTTP ${res.status}`);
                err.code = 'UNAVAILABLE';
                throw err;
            }
        },
        scan: async (folder) => {
            const sourceFolder = String(folder || '');
            const libraries = await loadLibraries();
            // Rewrite variants + shared-folder remaps so /media/TV SHOWS/... can refresh
            // a Plex library rooted at /mnt/user/TV SHOWS/ without assuming rewrite direction.
            const matches = libraries
                .map((lib) => {
                    const pathForRefresh = refreshPathForLibrary(sourceFolder, lib.path, libraries);
                    return pathForRefresh ? { lib, pathForRefresh } : null;
                })
                .filter(Boolean);
            if (!matches.length) {
                const tried = candidatesForLibraries(sourceFolder, libraries);
                return {
                    skipped: true,
                    reason: 'no matching library',
                    path: tried[0] || sourceFolder,
                    sourcePath: sourceFolder,
                    candidates: tried,
                };
            }
            const results = [];
            for (const { lib, pathForRefresh } of matches) {
                const url = new URL(joinUrl(baseURL, 'library', 'sections', String(lib.id), 'refresh'));
                url.searchParams.set('path', pathForRefresh);
                const res = await fetch(url.toString(), { headers: plexHeaders(token) });
                if (!res.ok) {
                    const err = new Error(`Plex scan HTTP ${res.status}`);
                    err.code = [404, 500, 502, 503, 504].includes(res.status) ? 'UNAVAILABLE' : 'FATAL';
                    throw err;
                }
                results.push({ library: lib.name, id: lib.id, path: pathForRefresh });
            }
            return { skipped: false, results };
        },
        /**
         * Force Plex to re-read media tech metadata for a file (codec/bitrate).
         * Needed after same-path Replace — folder refresh alone often leaves stale HEVC/H264 info.
         */
        analyzeFile: async (filePath, {
            retries = 4,
            retryDelayMs = 2500,
            initialDelayMs = 0,
            expectedVideoCodec = null,
            verifyTimeoutMs = 45_000,
        } = {}) => {
            const sourceFile = String(filePath || '').trim();
            if (!sourceFile) return { skipped: true, reason: 'missing-path', analyzed: [] };

            if (initialDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, initialDelayMs));
            }

            let ratingKeys = await resolveRatingKeys(sourceFile);
            for (let attempt = 0; attempt < retries && !ratingKeys.length; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                ratingKeys = await resolveRatingKeys(sourceFile);
            }
            if (!ratingKeys.length) {
                return {
                    skipped: true,
                    reason: 'item-not-found',
                    path: rewrite(sourceFile),
                    sourcePath: sourceFile,
                    candidates: [...new Set(
                        candidatesForLibraries(sourceFile, await loadLibraries())
                            .map((entry) => normalizePlexPath(entry))
                            .filter(Boolean),
                    )],
                    analyzed: [],
                };
            }

            const analyzed = [];
            for (const ratingKey of ratingKeys) {
                const entry = await analyzeRatingKey(ratingKey);
                let verify = null;
                if (expectedVideoCodec) {
                    verify = await waitForCodec(ratingKey, expectedVideoCodec, { timeoutMs: verifyTimeoutMs });
                    if (!verify.matched) {
                        // One more hard analyze pass before giving up.
                        await analyzeRatingKey(ratingKey).catch(() => null);
                        verify = await waitForCodec(ratingKey, expectedVideoCodec, {
                            timeoutMs: Math.min(20_000, verifyTimeoutMs),
                            pollMs: 2000,
                            reanalyzeEvery: 1,
                        });
                    }
                }
                analyzed.push({
                    ...entry,
                    videoCodec: verify?.videoCodec || null,
                    codecMatched: verify ? verify.matched : null,
                });
            }
            return {
                skipped: false,
                path: rewrite(sourceFile),
                sourcePath: sourceFile,
                expectedVideoCodec: expectedVideoCodec || null,
                analyzed,
            };
        },
    };
};
