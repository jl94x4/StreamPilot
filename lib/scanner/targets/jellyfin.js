import fetch from 'node-fetch';
import {
    createRewriter,
    expandPathRewriteCandidates,
    pathMatchesLibraryRoot,
    ensureTrailingSlash,
    joinUrl,
} from '../rewrite.js';

const embyHeaders = (token) => ({
    Accept: 'application/json',
    'X-Emby-Token': token,
    'Content-Type': 'application/json',
});

/**
 * Shared Jellyfin/Emby target (same Media Updated API).
 * @param {'jellyfin'|'emby'} type
 * @param {{ url: string, apiKey: string, rewrite?: { from: string, to: string }[] }} cfg
 */
export const createJellyfinLikeTarget = (type, cfg) => {
    const baseURL = String(cfg.url || '').replace(/\/+$/, '');
    const token = String(cfg.apiKey || cfg.token || '');
    const rewriteRules = Array.isArray(cfg.rewrite) ? cfg.rewrite : [];
    const rewrite = createRewriter(rewriteRules);
    let librariesCache = null;
    let librariesAt = 0;

    const loadLibraries = async (force = false) => {
        if (!force && librariesCache && Date.now() - librariesAt < 60_000) return librariesCache;
        const res = await fetch(joinUrl(baseURL, 'Library', 'VirtualFolders'), {
            headers: embyHeaders(token),
        });
        if (!res.ok) {
            const err = new Error(`${type} libraries HTTP ${res.status}`);
            err.code = res.status === 401 ? 'FATAL' : 'UNAVAILABLE';
            throw err;
        }
        const data = await res.json();
        const libraries = [];
        for (const lib of Array.isArray(data) ? data : []) {
            for (const loc of lib.Locations || []) {
                libraries.push({
                    name: String(lib.Name || ''),
                    path: ensureTrailingSlash(loc),
                });
            }
        }
        librariesCache = libraries;
        librariesAt = Date.now();
        return libraries;
    };

    return {
        type,
        available: async () => {
            const res = await fetch(joinUrl(baseURL, 'System', 'Info'), {
                headers: embyHeaders(token),
            });
            if (!res.ok) {
                const err = new Error(`${type} unavailable HTTP ${res.status}`);
                err.code = 'UNAVAILABLE';
                throw err;
            }
        },
        scan: async (folder) => {
            const sourceFolder = String(folder || '');
            const candidates = expandPathRewriteCandidates(sourceFolder, rewriteRules);
            const libraries = await loadLibraries();
            let pathForUpdate = null;
            let match = null;
            for (const lib of libraries) {
                const hit = candidates.find((candidate) => pathMatchesLibraryRoot(candidate, lib.path));
                if (hit) {
                    match = lib;
                    pathForUpdate = hit;
                    break;
                }
            }
            if (!match || !pathForUpdate) {
                return {
                    skipped: true,
                    reason: 'no matching library',
                    path: rewrite(sourceFolder) || sourceFolder,
                    candidates,
                };
            }
            const res = await fetch(joinUrl(baseURL, 'Library', 'Media', 'Updated'), {
                method: 'POST',
                headers: embyHeaders(token),
                body: JSON.stringify({
                    Updates: [{ path: pathForUpdate, updateType: 'Modified' }],
                }),
            });
            if (!res.ok) {
                const err = new Error(`${type} scan HTTP ${res.status}`);
                err.code = [404, 500, 502, 503, 504].includes(res.status) ? 'UNAVAILABLE' : 'FATAL';
                throw err;
            }
            return { skipped: false, results: [{ library: match.name, path: pathForUpdate }] };
        },
    };
};

export const createJellyfinTarget = (cfg) => createJellyfinLikeTarget('jellyfin', cfg);
export const createEmbyTarget = (cfg) => createJellyfinLikeTarget('emby', cfg);
