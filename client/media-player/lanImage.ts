/**
 * Live TV artwork from Tunarr / HDHomeRun guides points at the tuner's own http:// address on
 * the LAN. The app page is https, so the WebView blocks those <img> loads (mixed content), and
 * PMS's photo transcoder won't fetch private addresses. The app's fetch can, so load them into
 * blob URLs. Away from that LAN they can't load at all and callers fall back to a placeholder.
 */
const cache = new Map<string, Promise<string>>();

export const isLanHttpImage = (src?: string | null) => /^http:\/\//i.test(String(src || ''));

export const loadLanImage = (src: string): Promise<string> => {
    let hit = cache.get(src);
    if (!hit) {
        hit = fetch(src)
            .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
            .then((blob) => URL.createObjectURL(blob));
        hit.catch(() => cache.delete(src));
        cache.set(src, hit);
    }
    return hit;
};

/** Swap http:// LAN artwork on these items for blob URLs (null when it can't be loaded). */
export const resolveLanImages = async <T extends { thumb?: string | null; art?: string | null }>(items: T[]): Promise<T[]> => (
    Promise.all(items.map(async (item) => {
        const next = { ...item };
        for (const field of ['thumb', 'art'] as const) {
            const value = next[field];
            if (!isLanHttpImage(value)) continue;
            next[field] = await loadLanImage(String(value)).catch(() => null) as T[typeof field];
        }
        return next;
    }))
);
