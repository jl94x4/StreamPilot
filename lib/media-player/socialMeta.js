/**
 * Open Graph / Twitter Card helpers for Media Player deep links.
 * Crawlers (Discord, Slack, Facebook, Twitter/X, iMessage, etc.) only see the
 * initial HTML — they never run the SPA — so titles and posters must be injected
 * server-side, with a public image URL that does not require a session cookie.
 */

const asList = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
};

const escapeHtmlAttr = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const clipText = (value = '', max = 280) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

const firstMeta = (payload) => {
    const list = asList(payload?.MediaContainer?.Metadata);
    return list[0] || null;
};

/** Pathname only, already stripped of BASE_PATH (e.g. /media-player/item/123). */
export const parseMediaPlayerSocialTarget = (pathname = '') => {
    const parts = String(pathname || '')
        .split('?')[0]
        .split('#')[0]
        .split('/')
        .filter(Boolean);
    if (parts[0] !== 'media-player') return null;

    if (parts[1] === 'item' && /^\d+$/.test(String(parts[2] || ''))) {
        return { kind: 'item', ratingKey: String(parts[2]) };
    }
    if (parts[1] === 'playlist' && /^\d+$/.test(String(parts[2] || ''))) {
        return { kind: 'playlist', ratingKey: String(parts[2]) };
    }
    if (parts[1] === 'collection' && /^\d+$/.test(String(parts[2] || ''))) {
        return { kind: 'collection', ratingKey: String(parts[2]) };
    }
    if (
        parts[1] === 'library'
        && parts[3] === 'collection'
        && /^\d+$/.test(String(parts[4] || ''))
    ) {
        return { kind: 'collection', ratingKey: String(parts[4]), sectionKey: String(parts[2] || '') };
    }
    if (parts[1] === 'library' && parts[2]) {
        return { kind: 'library', sectionKey: String(parts[2]) };
    }
    if (parts[1] === 'person' && parts[2]) {
        return { kind: 'person', actorId: decodeURIComponent(String(parts[2])) };
    }
    if (parts[1] === 'studio' && parts[2]) {
        return { kind: 'studio', studioKey: decodeURIComponent(String(parts[2])) };
    }
    if (parts[1] === 'settings') return { kind: 'settings' };
    return { kind: 'home' };
};

export const ogTypeForMedia = (type = '') => {
    const raw = String(type || '').toLowerCase();
    if (raw === 'movie') return 'video.movie';
    if (raw === 'show' || raw === 'season' || raw === 'episode') return 'video.tv_show';
    if (raw === 'playlist' || raw === 'collection') return 'website';
    return 'website';
};

export const formatMediaPlayerSocialTitle = (meta = {}, serverName = 'StreamPilot') => {
    const type = String(meta?.type || '').toLowerCase();
    const year = meta?.year ? ` (${meta.year})` : '';
    const site = String(serverName || 'StreamPilot').trim() || 'StreamPilot';

    if (type === 'episode') {
        const show = String(meta.grandparentTitle || meta.showTitle || '').trim();
        const ep = String(meta.title || '').trim() || 'Episode';
        const season = Number(meta.parentIndex);
        const index = Number(meta.index);
        const epCode = Number.isFinite(season) && Number.isFinite(index) && season > 0 && index > 0
            ? `S${season}E${index}`
            : '';
        const detail = [epCode, ep].filter(Boolean).join(' · ');
        const headline = show ? `${show} — ${detail}` : detail;
        return clipText(`${headline} · ${site}`, 110);
    }
    if (type === 'season') {
        const show = String(meta.parentTitle || meta.grandparentTitle || '').trim();
        const season = String(meta.title || '').trim() || 'Season';
        const headline = show ? `${show} — ${season}` : season;
        return clipText(`${headline}${year} · ${site}`, 110);
    }
    if (type === 'playlist') {
        return clipText(`${meta.title || 'Playlist'} · ${site}`, 110);
    }
    if (type === 'collection') {
        return clipText(`${meta.title || 'Collection'} · ${site}`, 110);
    }
    const title = String(meta.title || meta.grandparentTitle || 'Untitled').trim();
    return clipText(`${title}${year} · ${site}`, 110);
};

export const formatMediaPlayerSocialDescription = (meta = {}) => {
    const type = String(meta?.type || '').toLowerCase();
    const summary = clipText(meta?.summary || meta?.tagline || '', 240);
    if (summary) return summary;

    if (type === 'episode') {
        const show = String(meta.grandparentTitle || '').trim();
        return show ? `Watch ${show} on Media Player.` : 'Watch this episode on Media Player.';
    }
    if (type === 'playlist') return 'Open this playlist in Media Player.';
    if (type === 'collection') return 'Browse this collection in Media Player.';
    if (type === 'show') return 'Browse this show in Media Player.';
    if (type === 'movie') return 'Watch this movie in Media Player.';
    return 'Open this title in Media Player.';
};

/** Prefer portrait posters for side-thumbnail embeds (Discord/Slack summary cards). */
export const pickMediaPlayerSocialImagePath = (meta = {}) => {
    const type = String(meta?.type || '').toLowerCase();
    const candidates = type === 'episode' || type === 'season'
        ? [
            meta.grandparentThumb,
            meta.parentThumb,
            meta.thumb,
            meta.grandparentArt,
            meta.parentArt,
            meta.art,
        ]
        : [
            meta.thumb,
            meta.parentThumb,
            meta.grandparentThumb,
            meta.art,
            meta.parentArt,
            meta.grandparentArt,
        ];
    for (const raw of candidates) {
        const path = String(raw || '').trim().split('?')[0];
        if (!path.startsWith('/')) continue;
        if (path.startsWith('//') || path.includes('://') || path.includes('..')) continue;
        return path;
    }
    return '';
};

/** Portrait poster size — summary cards put this beside the title/description. */
export const MEDIA_PLAYER_OG_POSTER = { width: 600, height: 900 };

export const buildMediaPlayerOgImageUrl = (
    baseUrl = '',
    ratingKey = '',
    { width = MEDIA_PLAYER_OG_POSTER.width, height = MEDIA_PLAYER_OG_POSTER.height } = {},
) => {
    const id = String(ratingKey || '').trim();
    if (!/^\d+$/.test(id)) return '';
    const origin = String(baseUrl || '').replace(/\/+$/, '');
    const params = new URLSearchParams({
        width: String(Math.min(1600, Math.max(200, Number(width) || MEDIA_PLAYER_OG_POSTER.width))),
        height: String(Math.min(1600, Math.max(200, Number(height) || MEDIA_PLAYER_OG_POSTER.height))),
        kind: 'poster',
    });
    return `${origin}/api/public/media-player/og-image/${encodeURIComponent(id)}?${params.toString()}`;
};

export const buildSocialMetaTagBlock = ({
    title,
    description,
    pageUrl,
    imageUrl = '',
    siteName = 'StreamPilot',
    type = 'website',
    imageWidth = MEDIA_PLAYER_OG_POSTER.width,
    imageHeight = MEDIA_PLAYER_OG_POSTER.height,
    imageAlt = '',
    card = '',
} = {}) => {
    const safeTitle = escapeHtmlAttr(title);
    const safeDescription = escapeHtmlAttr(description);
    const safeUrl = escapeHtmlAttr(pageUrl);
    const safeSite = escapeHtmlAttr(siteName);
    const safeType = escapeHtmlAttr(type || 'website');
    const safeImage = imageUrl ? escapeHtmlAttr(imageUrl) : '';
    const safeAlt = escapeHtmlAttr(imageAlt || title || '');
    // Portrait posters use `summary` so Discord/Slack/iMessage put the image beside the text.
    // Landscape branding can still request summary_large_image.
    const cardType = String(card || '').trim()
        || (imageUrl && Number(imageWidth) > Number(imageHeight) ? 'summary_large_image' : 'summary');

    const tags = [
        `<meta property="og:type" content="${safeType}" />`,
        `<meta property="og:site_name" content="${safeSite}" />`,
        `<meta property="og:title" content="${safeTitle}" />`,
        `<meta property="og:description" content="${safeDescription}" />`,
        `<meta property="og:url" content="${safeUrl}" />`,
        `<meta name="twitter:card" content="${escapeHtmlAttr(cardType)}" />`,
        `<meta name="twitter:title" content="${safeTitle}" />`,
        `<meta name="twitter:description" content="${safeDescription}" />`,
        `<meta name="description" content="${safeDescription}" />`,
    ];
    if (safeImage) {
        tags.push(
            `<meta property="og:image" content="${safeImage}" />`,
            `<meta property="og:image:secure_url" content="${safeImage}" />`,
            `<meta property="og:image:width" content="${escapeHtmlAttr(String(imageWidth))}" />`,
            `<meta property="og:image:height" content="${escapeHtmlAttr(String(imageHeight))}" />`,
            `<meta property="og:image:alt" content="${safeAlt}" />`,
            `<meta name="twitter:image" content="${safeImage}" />`,
            `<meta name="twitter:image:alt" content="${safeAlt}" />`,
            `<link rel="image_src" href="${safeImage}" />`,
        );
    }
    return tags.join('\n    ');
};

export const socialPreviewFromPlexMetadata = (payload, {
    serverName = 'StreamPilot',
    baseUrl = '',
    pageUrl = '',
    ratingKey = '',
} = {}) => {
    const meta = firstMeta(payload);
    if (!meta?.ratingKey && !meta?.title) return null;
    const id = String(ratingKey || meta.ratingKey || '').trim();
    const title = formatMediaPlayerSocialTitle(meta, serverName);
    const description = formatMediaPlayerSocialDescription(meta);
    const imageUrl = id
        ? buildMediaPlayerOgImageUrl(baseUrl, id, MEDIA_PLAYER_OG_POSTER)
        : '';
    return {
        title,
        description,
        imageUrl,
        type: ogTypeForMedia(meta.type),
        card: 'summary',
        imageWidth: MEDIA_PLAYER_OG_POSTER.width,
        imageHeight: MEDIA_PLAYER_OG_POSTER.height,
        imageAlt: String(meta.title || meta.grandparentTitle || title),
        pageUrl,
        siteName: serverName,
        ratingKey: id,
        thumbPath: pickMediaPlayerSocialImagePath(meta),
    };
};

export { escapeHtmlAttr, firstMeta, clipText };
