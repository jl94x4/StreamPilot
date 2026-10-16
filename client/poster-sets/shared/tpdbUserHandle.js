/** TPDB creator handle from a user URL, @handle, or bare username (not a numeric set/poster id). */
export const parseTpdbUserHandle = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const fromUrl = raw.match(/theposterdb\.com\/user\/([^/?#]+)/i);
    if (fromUrl) {
        let handle = fromUrl[1];
        try {
            handle = decodeURIComponent(handle);
        } catch {
            /* keep encoded */
        }
        handle = handle.replace(/^@+/, '').trim();
        return handle || null;
    }
    if (/^https?:\/\//i.test(raw)) return null;
    const handle = raw.replace(/^@+/, '').trim();
    if (!handle || /^\d+$/.test(handle)) return null;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(handle)) return null;
    return handle;
};

export const isTpdbRecentUrl = (value) => /theposterdb\.com\/recent(?:[/?#]|$)/i.test(String(value || '').trim());
export const isTpdbFeedUrl = (value) => /theposterdb\.com\/feed(?:[/?#]|$)/i.test(String(value || '').trim());

export default parseTpdbUserHandle;
