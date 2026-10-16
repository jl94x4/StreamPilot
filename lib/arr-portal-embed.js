export const ARR_OPEN_IN_PORTAL_EVENT = 'portal-open-arr-embed';
export const ARR_EMBED_QUERY = 'embed';

const ARR_TYPE_HINTS = {
    radarr: ['radarr'],
    sonarr: ['sonarr'],
    lidarr: ['lidarr'],
};

const parseHttpUrl = (value, base) => {
    try {
        const url = base
            ? new URL(String(value || '').trim(), base)
            : new URL(String(value || '').trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url;
    } catch {
        return null;
    }
};

export const isSafeArrEmbedPath = (value) => {
    const raw = String(value || '');
    if (!raw || raw.length > 800) return false;
    if (raw.includes('\\') || raw.includes('\0')) return false;
    if (/(^|\/)\.\.(\/|$)/.test(raw)) return false;
    return true;
};

const tabLooksLikeArr = (tab, arrType) => {
    const hints = ARR_TYPE_HINTS[arrType] || [];
    if (!hints.length) return false;
    const hay = `${tab?.name || ''} ${tab?.url || ''} ${tab?.logoUrl || ''}`.toLowerCase();
    return hints.some((hint) => hay.includes(hint));
};

const sameHost = (left, right) => (
    !!left && !!right && String(left.host || '').toLowerCase() === String(right.host || '').toLowerCase()
);

export const findMatchingArrEmbedTab = (tabs, deepLinkUrl, arrType = 'radarr') => {
    const target = parseHttpUrl(deepLinkUrl);
    if (!target) return null;
    const list = (Array.isArray(tabs) ? tabs : []).filter((tab) => tab && tab.enabled !== false && tab.id);
    if (!list.length) return null;

    const scored = list.map((tab) => {
        const tabUrl = parseHttpUrl(tab.url);
        const hostMatch = sameHost(tabUrl, target);
        const named = tabLooksLikeArr(tab, arrType);
        let score = 0;
        if (hostMatch && named) score = 3;
        else if (hostMatch) score = 2;
        else if (named) score = 1;
        if (score > 0 && (tab.openMode === 'embed' || !tab.openMode)) score += 0.1;
        return { tab, score };
    }).filter((entry) => entry.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.tab || null;
};

/** Relative path (+ search) to load inside a matching applet iframe. */
export const resolveArrEmbedPath = (tabUrl, deepLinkUrl) => {
    const tab = parseHttpUrl(tabUrl);
    const deep = parseHttpUrl(deepLinkUrl);
    if (!tab || !deep) return '';

    let tabDir = tab.pathname || '/';
    if (!tabDir.endsWith('/')) tabDir += '/';
    let path = deep.pathname || '/';
    if (sameHost(tab, deep) && tabDir !== '/' && (path === tabDir.slice(0, -1) || path.startsWith(tabDir))) {
        path = `/${path.slice(tabDir.length)}`;
    }
    const rel = `${String(path || '/').replace(/^\/+/, '')}${deep.search || ''}`;
    return isSafeArrEmbedPath(rel) ? rel : '';
};

export const buildArrPortalEmbedHref = (tabId, embedPath = '') => {
    const id = encodeURIComponent(String(tabId || '').trim());
    if (!id) return '/external';
    const qs = new URLSearchParams();
    const safe = String(embedPath || '').trim();
    if (safe && isSafeArrEmbedPath(safe)) qs.set(ARR_EMBED_QUERY, safe);
    const query = qs.toString();
    return query ? `/external/${id}?${query}` : `/external/${id}`;
};

export const readArrEmbedQuery = (search) => {
    try {
        const params = typeof search === 'string' && search.startsWith('?')
            ? new URLSearchParams(search)
            : new URLSearchParams(String(search || ''));
        const raw = String(params.get(ARR_EMBED_QUERY) || '').trim();
        return isSafeArrEmbedPath(raw) ? raw : '';
    } catch {
        return '';
    }
};

export const dispatchArrPortalEmbed = (detail) => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return false;
    const url = String(detail?.url || '').trim();
    if (!url) return false;
    const event = new CustomEvent(ARR_OPEN_IN_PORTAL_EVENT, {
        cancelable: true,
        detail: {
            url,
            arrType: detail?.arrType === 'sonarr' || detail?.arrType === 'lidarr' ? detail.arrType : 'radarr',
            label: String(detail?.label || ''),
        },
    });
    return !window.dispatchEvent(event);
};

export const handleArrPortalEmbedAnchorClick = (event, detail) => {
    if (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey) return false;
    if (dispatchArrPortalEmbed(detail)) {
        event?.preventDefault?.();
        return true;
    }
    return false;
};
