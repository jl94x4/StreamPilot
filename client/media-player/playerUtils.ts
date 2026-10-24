import { directPlexTranscodeUrl, portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import {
    clearWarmPosterUrls,
    forgetWarmPosterUrl,
    isPosterUrlWarm,
    warmPosterUrl,
} from '../shared/posterWarmCache';
import { notePlayerItemProgress } from './playerMemory';
import { PLAYER_API_ROOT, PLAYER_IMAGE_PATH } from './paths';
import { PLAYER_SETTINGS_EVENT, readPlayerSettings, sortContinueWatchingItems, type PlayerContinueWatchingLayout, type PlayerContinueWatchingSort, type PlayerDateFormat } from './playerSettings';
import type { PlayerItem } from './types';

/** Shared rail size so home, library, and season grids hit the same cached JPEG. */
export const PLAYER_POSTER_WIDTH = 300;
export const PLAYER_POSTER_HEIGHT = 450;
export const PLAYER_POSTER_QUALITY = 90;

export const warmPlayerPoster = warmPosterUrl;
export const isPlayerPosterWarm = isPosterUrlWarm;
export const forgetPlayerPoster = forgetWarmPosterUrl;

export const clearPrefetchedPlayerImages = () => {
    clearWarmPosterUrls();
};

export const prefetchPlayerImages = (urls: Array<string | null | undefined>, limit = 12) => {
    if (typeof window === 'undefined') return;
    let started = 0;
    for (const url of urls) {
        const key = String(url || '').trim();
        if (!key) continue;
        if (isPosterUrlWarm(key)) {
            warmPosterUrl(key);
            continue;
        }
        warmPosterUrl(key, started < 16);
        started += 1;
        if (started >= limit) return;
    }
};

export const playerRailPosterUrl = (
    item: { thumb?: string | null; type?: string | null; cardAspect?: string | null } | null | undefined,
    aspect?: '2/3' | 'square' | '16/9',
) => {
    if (!item) return '';
    const cardAspect = resolvePlayerCardAspect(item as PlayerItem, aspect);
    const raw = playerCardImageUrl(item.thumb, cardAspect);
    if (cardAspect === 'square') return resizePlexArtUrl(raw, 300, 300, PLAYER_POSTER_QUALITY) || '';
    if (cardAspect === '16/9') return resizePlexArtUrl(raw, 426, 240, PLAYER_POSTER_QUALITY) || '';
    return resizePlexArtUrl(raw, 300, 450, PLAYER_POSTER_QUALITY) || raw || '';
};

/**
 * Warm the posters near the row on screen: current, next two, previous. Queuing every
 * row's posters (hundreds) at once tied up the server's few connections, so the Home
 * hub fills and the rows you were looking at loaded last. Rows further away warm as you
 * reach them (this runs on every row change).
 */
export const prefetchHomeRowPosters = (
    rows: Array<{ items?: Array<PlayerItem | null | undefined> | null; aspect?: '2/3' | 'square' | '16/9' }>,
    startIndex = 0,
) => {
    if (typeof window === 'undefined' || !rows?.length) return;
    const urls: string[] = [];
    const pushRow = (row?: { items?: Array<PlayerItem | null | undefined> | null; aspect?: '2/3' | 'square' | '16/9' }) => {
        for (const item of row?.items || []) {
            const url = playerRailPosterUrl(item, row?.aspect);
            if (url) urls.push(url);
        }
    };
    const start = Math.max(0, Math.min(startIndex, rows.length - 1));
    pushRow(rows[start]);
    pushRow(rows[start + 1]);
    pushRow(rows[start + 2]);
    if (start > 0) pushRow(rows[start - 1]);
    prefetchPlayerImages(urls, urls.length);
};

const readyBackdrops = new Map<string, HTMLImageElement>();
const backdropWait: string[] = [];
const backdropInflight = new Set<string>();
/** Finished full-quality downloads. Far posters stay listed so a focus move does not fetch them again. */
const backdropLoaded = new Set<string>();
/** Full-quality URLs for the row on screen, focused poster first. */
let backdropRow: string[] = [];
let backdropEpoch = 0;
let backdropBusy = 0;
const BACKDROP_SLOTS = 2;
const BACKDROP_HOLD = 8;
const BACKDROP_QUEUE_CAP = 24;
let warmingPaused = false;
let warmingPauseDepth = 0;
/** First cards of the previous/next Home row — keep these decoded across a row change. */
const backdropPinned = new Set<string>();

const uniqueBackdropUrls = (urls: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of urls) {
        const key = String(raw || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
        if (out.length >= BACKDROP_QUEUE_CAP) break;
    }
    return out;
};

const rotateBackdropRow = (urls: string[], focusIndex: number) => {
    const start = Math.max(0, Math.min(focusIndex, Math.max(0, urls.length - 1)));
    return uniqueBackdropUrls(urls.slice(start).concat(urls.slice(0, start)));
};

const shouldHoldBackdrop = (key: string) => {
    if (backdropPinned.has(key)) return true;
    if (!backdropRow.length) return true;
    const pos = backdropRow.indexOf(key);
    return pos >= 0 && pos < BACKDROP_HOLD;
};

const trimReadyBackdrops = () => {
    while (readyBackdrops.size > BACKDROP_HOLD) {
        let victim = '';
        let rank = -1;
        for (const readyKey of readyBackdrops.keys()) {
            if (backdropPinned.has(readyKey)) continue;
            const pos = backdropRow.indexOf(readyKey);
            const score = pos < 0 ? -1 : pos;
            if (!victim || score > rank) {
                rank = score;
                victim = readyKey;
            }
        }
        if (!victim) break;
        readyBackdrops.delete(victim);
    }
};

const rememberBackdrop = (key: string, img: HTMLImageElement) => {
    if (!key || !img.complete || img.naturalWidth <= 0) return;
    if (!shouldHoldBackdrop(key)) return;
    readyBackdrops.delete(key);
    readyBackdrops.set(key, img);
    trimReadyBackdrops();
};

const startBackdrop = (key: string) => {
    if (!key || readyBackdrops.has(key) || backdropInflight.has(key)) return;
    const epoch = backdropEpoch;
    backdropBusy += 1;
    backdropInflight.add(key);
    const img = new Image();
    img.decoding = 'async';
    const finish = () => {
        backdropInflight.delete(key);
        backdropBusy = Math.max(0, backdropBusy - 1);
        pumpBackdrops();
    };
    img.onload = () => {
        if (epoch === backdropEpoch || backdropRow.includes(key)) {
            backdropLoaded.add(key);
            rememberBackdrop(key, img);
        }
        finish();
    };
    img.onerror = finish;
    img.src = key;
};

const rebuildBackdropWait = () => {
    backdropWait.length = 0;
    backdropRow.forEach((url, pos) => {
        if (readyBackdrops.has(url) || backdropInflight.has(url)) return;
        if (backdropLoaded.has(url) && pos >= BACKDROP_HOLD) return;
        backdropWait.push(url);
    });
};

const pumpBackdrops = () => {
    if (warmingPaused) return;
    while (backdropBusy < BACKDROP_SLOTS && backdropWait.length) {
        const key = backdropWait.shift();
        if (!key || readyBackdrops.has(key) || backdropInflight.has(key)) continue;
        startBackdrop(key);
    }
};

/** Stop row warming so a show page or playback can use the network. */
export const pausePlayerWarming = () => {
    warmingPauseDepth += 1;
    warmingPaused = true;
    backdropWait.length = 0;
};

export const resumePlayerWarming = () => {
    warmingPauseDepth = Math.max(0, warmingPauseDepth - 1);
    if (warmingPauseDepth > 0) return;
    warmingPaused = false;
    pumpBackdrops();
};

/** Decode a full backdrop ahead of focus so the billboard can swap without waiting on Plex. */
export const warmPlayerBackdrop = (url?: string | null, priority = false) => {
    const key = String(url || '').trim();
    if (!key || typeof window === 'undefined') return;
    if (warmingPaused && !priority) return;
    if (readyBackdrops.has(key)) {
        const img = readyBackdrops.get(key);
        if (img) {
            readyBackdrops.delete(key);
            readyBackdrops.set(key, img);
        }
        return;
    }
    if (backdropInflight.has(key)) return;
    if (priority) {
        startBackdrop(key);
        return;
    }
    if (backdropRow.includes(key)) return;
    const existing = backdropWait.indexOf(key);
    if (existing >= 0) backdropWait.splice(existing, 1);
    backdropWait.push(key);
    while (backdropWait.length > BACKDROP_QUEUE_CAP) backdropWait.pop();
    pumpBackdrops();
};

/**
 * Walk every backdrop on the current TV row, focused poster first, a few at a
 * time. The next row replaces this queue.
 */
export const beginTvRowBackdropPreload = (urls: string[], focusIndex = 0) => {
    const epoch = ++backdropEpoch;
    const ordered = rotateBackdropRow(urls, focusIndex);
    backdropRow = ordered;
    rebuildBackdropWait();
    pumpBackdrops();
    return () => {
        if (backdropEpoch !== epoch) return;
        // The next row replaces this queue. Do not drop decoded art here —
        // changing rows would otherwise refetch the billboard from scratch.
    };
};

/** Pull the focused poster to the front of the current row without dropping the rest. */
export const prioritizeTvRowBackdrop = (url?: string | null) => {
    const key = String(url || '').trim();
    if (!key || typeof window === 'undefined') return;
    if (!backdropRow.length) {
        warmPlayerBackdrop(key, true);
        return;
    }
    const index = backdropRow.indexOf(key);
    if (index > 0) {
        backdropRow = backdropRow.slice(index).concat(backdropRow.slice(0, index));
    } else if (index < 0) {
        backdropRow = uniqueBackdropUrls([key, ...backdropRow]);
    }
    rebuildBackdropWait();
    trimReadyBackdrops();
    if (warmingPaused) {
        warmPlayerBackdrop(key, true);
        return;
    }
    pumpBackdrops();
};

export const pinTvNeighborBackdrops = (urls: Array<string | null | undefined>) => {
    backdropPinned.clear();
    uniqueBackdropUrls(urls.map((url) => String(url || '').trim()).filter(Boolean)).slice(0, 6)
        .forEach((url) => backdropPinned.add(url));
};

export const playerItemBackdropUrl = (
    item?: { backdropArt?: string | null; art?: string | null; thumb?: string | null } | null,
) => plexBackdropUrl(item?.backdropArt || item?.art || item?.thumb);

/**
 * TV Home → title page handoff: the exact billboard art URL (and the page colour sampled
 * from it) Home showed per title. Home and title pages build their art URLs differently,
 * so without this the title page fetched and decoded the same picture again.
 */
const billboardHandoff = new Map<string, { url: string; surface: string | null }>();
const BILLBOARD_HANDOFF_MAX = 300;

export const rememberBillboardBackdrop = (key?: string | null, url?: string | null, surface?: string | null) => {
    const id = String(key || '').trim();
    const src = String(url || '').trim();
    if (!id || !src) return;
    const prev = billboardHandoff.get(id);
    billboardHandoff.delete(id);
    billboardHandoff.set(id, {
        url: src,
        surface: surface !== undefined ? surface : (prev && prev.url === src ? prev.surface : null),
    });
    if (billboardHandoff.size > BILLBOARD_HANDOFF_MAX) {
        const oldest = billboardHandoff.keys().next().value;
        if (oldest !== undefined) billboardHandoff.delete(oldest);
    }
};

export const billboardBackdropFor = (key?: string | null) => billboardHandoff.get(String(key || '').trim()) || null;

export const isPlayerBackdropReady = (url?: string | null) => {
    const key = String(url || '').trim();
    if (!key) return false;
    const held = readyBackdrops.get(key);
    if (held?.complete && held.naturalWidth > 0) return true;
    return Array.from(document.images).some((node) => (
        (node.currentSrc === key || node.src === key) && node.complete && node.naturalWidth > 0
    ));
};

/** Keep the focused poster at the front of the row that is already preloading. */
export const primeNearbyTvBillboard = (
    target: EventTarget | null,
    prefetchItem?: (ratingKey: string) => void,
) => {
    const el = target as HTMLElement | null;
    const btn = el?.closest?.('[data-tv-poster-btn="1"]') as HTMLElement | null;
    if (!btn) return;
    const art = btn.closest('[data-tv-backdrop]')?.getAttribute('data-tv-backdrop') || '';
    if (art) prioritizeTvRowBackdrop(art);
    const key = String(btn.getAttribute('data-tv-key') || '').trim();
    if (key && !key.startsWith('view-more:')) prefetchItem?.(key);
};

const MUSIC_ITEM_TYPES = new Set(['artist', 'album', 'track', 'audio', 'music']);

export const isMusicPlayerItem = (item?: { type?: string | null } | null) => (
    MUSIC_ITEM_TYPES.has(String(item?.type || '').toLowerCase())
);

export const MUSIC_NOW_PLAYING_EVENT = 'smp-music-now-playing';

export type MusicNowPlayingDetail = {
    item: PlayerItem;
    paused: boolean;
    positionMs: number;
    durationMs: number;
    minimized: boolean;
} | null;

/** Music stays square even when a rail asks for poster cards. */
export const resolvePlayerCardAspect = (
    item: { type?: string | null; cardAspect?: '2/3' | 'square' | '16/9' | null },
    forced?: '2/3' | 'square' | '16/9' | null,
): '2/3' | 'square' | '16/9' => {
    // Real music items always stay square. A wrong hub stamp must not override a
    // portrait rail (e.g. movie collections titled "Music …").
    if (isMusicPlayerItem(item)) return 'square';
    if (forced) return forced;
    if (item.cardAspect === 'square') return 'square';
    if (item.cardAspect) return item.cardAspect;
    if (String(item.type || '') === 'episode') return '16/9';
    return '2/3';
};

/** Rewrite a Plex photo transcode size (and optional quality) without changing the path. */
export const resizePlexArtUrl = (
    url: string | null | undefined,
    width: number,
    height: number,
    quality?: number,
) => {
    const value = String(url || '').trim();
    if (!value || !/\/photo\/:\/transcode|\/api\/plex\/image/i.test(value)) return value;
    try {
        const parsed = new URL(value, 'https://plex.local');
        parsed.searchParams.set('width', String(width));
        parsed.searchParams.set('height', String(height));
        if (quality != null && Number.isFinite(quality)) {
            parsed.searchParams.set('quality', String(Math.max(1, Math.min(100, Math.round(quality)))));
        }
        if (/^https?:/i.test(value)) return parsed.toString();
        return `${parsed.pathname}?${parsed.searchParams.toString()}`;
    } catch {
        return value;
    }
};

export const plexImageUrl = (path?: string | null, width = PLAYER_POSTER_WIDTH, height = PLAYER_POSTER_HEIGHT, opts?: { fit?: 'contain' | 'cover'; quality?: number }) => {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/api/')) {
        return resolvePortalAssetUrl(path);
    }
    const params = new URLSearchParams({
        path,
        width: String(width),
        height: String(height),
    });
    if (opts?.fit === 'contain') params.set('fit', 'contain');
    params.set('quality', String(opts?.quality ?? PLAYER_POSTER_QUALITY));
    return portalUrl(`${PLAYER_IMAGE_PATH}?${params.toString()}`);
};

export const playerCardImageUrl = (thumb?: string | null, aspect: '2/3' | 'square' | '16/9' = '2/3') => {
    if (!thumb) return '';
    if (aspect === '16/9') return plexImageUrl(thumb, 426, 240, { quality: PLAYER_POSTER_QUALITY });
    if (aspect === 'square') return plexImageUrl(thumb, 300, 300, { quality: PLAYER_POSTER_QUALITY });
    return plexImageUrl(thumb, PLAYER_POSTER_WIDTH, PLAYER_POSTER_HEIGHT, { quality: PLAYER_POSTER_QUALITY });
};

export const plexLogoUrl = (path?: string | null) => plexImageUrl(path, 640, 240, { fit: 'contain', quality: 70 });

/** Prefer the fullest synopsis (Plex agents often truncate mid-sentence). */
export const pickRicherSummary = (...parts: Array<string | null | undefined>) => {
    const cleaned = parts
        .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    if (!cleaned.length) return '';
    return cleaned.reduce((best, next) => {
        if (next.length >= best.length + 12) return next;
        if (best.length >= next.length + 12) return best;
        const bestEnds = /[.!?…]"?'?$/.test(best);
        const nextEnds = /[.!?…]"?'?$/.test(next);
        if (nextEnds && !bestEnds) return next;
        if (bestEnds && !nextEnds) return best;
        return next.length > best.length ? next : best;
    });
};

/**
 * Full hero art. 1920×1080 at quality 90 — sharp on TV without 4K transcodes
 * that stall logos, episodes, and Plex itself.
 */
export const PLAYER_BACKDROP_WIDTH = 1920;
export const PLAYER_BACKDROP_HEIGHT = 1080;
export const PLAYER_BACKDROP_QUALITY = 90;

const tmdbBackdropSize = (url: string, size: 'w300' | 'w1280' | 'w1920' | 'original') => (
    url.replace(/\/\/image\.tmdb\.org\/t\/p\/(?:original|w\d+)/, `//image.tmdb.org/t/p/${size}`)
);

const withPlexImageSize = (url: string, width: number, height: number, quality: number) => {
    const resolved = resolvePortalAssetUrl(url);
    if (!resolved.includes('/api/plex/image')) {
        const size = quality <= 50 ? 'w300' : (quality >= 95 ? 'original' : 'w1920');
        return tmdbBackdropSize(resolved, size);
    }
    const hashAt = resolved.indexOf('#');
    const withoutHash = hashAt >= 0 ? resolved.slice(0, hashAt) : resolved;
    const qAt = withoutHash.indexOf('?');
    const base = qAt >= 0 ? withoutHash.slice(0, qAt) : withoutHash;
    const params = new URLSearchParams(qAt >= 0 ? withoutHash.slice(qAt + 1) : '');
    params.set('width', String(width));
    params.set('height', String(height));
    params.set('quality', String(quality));
    return portalUrl(`${base}?${params.toString()}`);
};

const backdropRequestUrl = (path: string, width: number, height: number, quality: number) => {
    if (/\/photo\/:\/transcode|\/api\/plex\/image/i.test(path)) {
        return resizePlexArtUrl(path, width, height, quality);
    }
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/api/')) {
        return withPlexImageSize(path, width, height, quality);
    }
    return plexImageUrl(path, width, height, { quality });
};

const phoneShellActive = () => {
    try {
        return document.documentElement?.dataset?.phone === '1';
    } catch {
        return false;
    }
};

export const plexBackdropUrl = (path?: string | null) => {
    if (!path) return '';
    // A 1080p q90 transcode per hero slide took ages over mobile data; 720p is still sharp on a phone.
    if (phoneShellActive()) return backdropRequestUrl(path, 1280, 720, 80);
    return backdropRequestUrl(path, PLAYER_BACKDROP_WIDTH, PLAYER_BACKDROP_HEIGHT, PLAYER_BACKDROP_QUALITY);
};

/** Idle fullscreen art. One image at a time, so ask for the 4K source even on TV. */
export const plexScreensaverBackdropUrl = (path?: string | null) => {
    if (!path) return '';
    return backdropRequestUrl(path, PLAYER_BACKDROP_WIDTH, PLAYER_BACKDROP_HEIGHT, PLAYER_BACKDROP_QUALITY);
};

export const plexThemeUrl = (ratingKey?: string | null) => {
    const key = String(ratingKey || '').replace(/\D/g, '');
    if (!key) return '';
    return portalUrl(`${PLAYER_API_ROOT}/theme/${encodeURIComponent(key)}`);
};

export const formatBitrateMbps = (bitrate?: number | null) => {
    const n = Number(bitrate);
    if (!Number.isFinite(n) || n <= 0) return '';
    const mbps = n >= 100000 ? n / 1e6 : n / 1000;
    return `${mbps.toFixed(1)} Mbps`;
};

export const formatBytes = (bytes?: number | null) => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
    if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
    if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
    return `${n} B`;
};

const resolutionScanLetter = (scanType?: string | null, existing?: string | null) => {
    const tagged = String(existing || '').toLowerCase().match(/^(\d+)\s*([pi])$/);
    if (tagged) return tagged[2];
    const scan = String(scanType || '').toLowerCase();
    if (scan.startsWith('i') || scan.includes('interlace')) return 'i';
    return 'p';
};

export const formatPlayerResolution = (
    height?: number | null,
    videoResolution?: string | null,
    scanType?: string | null,
) => {
    const res = String(videoResolution || '').toLowerCase();
    const h = Number(height) || 0;
    const letter = resolutionScanLetter(scanType, res);
    if (res.includes('4k') || res.includes('2160') || h >= 2160) return '4K';
    if (res.includes('1080') || h >= 1080) return `1080${letter}`;
    if (res.includes('720') || h >= 720) return `720${letter}`;
    if (res.includes('576') || h >= 576) return `576${letter}`;
    if (res.includes('480') || h >= 480) return `480${letter}`;
    const tagged = res.match(/^(\d+)\s*([pi])$/);
    if (tagged) return `${tagged[1]}${tagged[2]}`;
    if (/^\d+$/.test(res)) return `${res}${letter}`;
    if (videoResolution) return String(videoResolution);
    if (h) return `${h}${letter}`;
    return '';
};

export type FileInfoPillTone =
    | '4k'
    | '1080'
    | '720'
    | 'sd'
    | 'hevc'
    | 'h264'
    | 'av1'
    | 'vp9'
    | 'truehd'
    | 'dts'
    | 'eac3'
    | 'ac3'
    | 'aac'
    | 'flac'
    | 'other';

export type FileInfoPill = {
    key: 'resolution' | 'video' | 'audio';
    label: string;
    tone: FileInfoPillTone;
};

type FileInfoPillSource = {
    versions?: Array<{
        resolution?: string | null;
        height?: number | null;
        scanType?: string | null;
        videoCodec?: string | null;
        audioCodec?: string | null;
    }>;
    mediaInfo?: Array<{
        height?: number | null;
        videoResolution?: string | null;
        scanType?: string | null;
        videoCodec?: string | null;
        audioCodec?: string | null;
    }>;
} | null;

const fileInfoSource = (item?: FileInfoPillSource) => {
    const version = item?.versions?.[0];
    const media = item?.mediaInfo?.[0];
    const scanType = version?.scanType || media?.scanType || null;
    return {
        resolution: formatPlayerResolution(
            version?.height || media?.height,
            version?.resolution || media?.videoResolution,
            scanType,
        ),
        video: String(version?.videoCodec || media?.videoCodec || '').trim(),
        audio: String(version?.audioCodec || media?.audioCodec || '').trim(),
    };
};

const resolutionPillTone = (label: string): FileInfoPillTone => {
    const value = label.toLowerCase();
    if (value.includes('4k') || value.includes('2160')) return '4k';
    if (value.includes('1080')) return '1080';
    if (value.includes('720')) return '720';
    return 'sd';
};

const videoPillTone = (codec: string): FileInfoPillTone => {
    const value = codec.toLowerCase();
    if (/hevc|h\.?265|x265|hev1/.test(value)) return 'hevc';
    if (/av1|av01/.test(value)) return 'av1';
    if (/vp9/.test(value)) return 'vp9';
    if (/h\.?264|x264|avc/.test(value)) return 'h264';
    return 'other';
};

const audioPillTone = (codec: string): FileInfoPillTone => {
    const value = codec.toLowerCase();
    if (/truehd|atmos|mlp/.test(value)) return 'truehd';
    if (/eac3|e-ac-3|ec-3/.test(value)) return 'eac3';
    if (/ac3|ac-3/.test(value)) return 'ac3';
    if (/dts|dca/.test(value)) return 'dts';
    if (/\baac\b|mp4a/.test(value)) return 'aac';
    if (/flac/.test(value)) return 'flac';
    return 'other';
};

const codecPillLabel = (codec: string) => codec.replace(/_/g, '-').toUpperCase();

export const fileInfoPills = (item?: FileInfoPillSource): FileInfoPill[] => {
    const source = fileInfoSource(item);
    const pills: FileInfoPill[] = [];
    if (source.resolution) {
        pills.push({ key: 'resolution', label: source.resolution, tone: resolutionPillTone(source.resolution) });
    }
    if (source.video) {
        pills.push({ key: 'video', label: codecPillLabel(source.video), tone: videoPillTone(source.video) });
    }
    if (source.audio) {
        pills.push({ key: 'audio', label: codecPillLabel(source.audio), tone: audioPillTone(source.audio) });
    }
    return pills;
};

export const formatFileInfoPill = (item?: FileInfoPillSource) => (
    fileInfoPills(item).map((pill) => pill.label).join(' ')
);

export const titleCaseProfile = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.replace(/\b\w/g, (char) => char.toUpperCase());
};

export type PlayerHdrBadge = 'DV' | 'DV HDR10' | 'HDR10+' | 'HDR10' | 'HLG' | 'HDR';

export {
    detectPlayerHdrLabel,
    playerHdrBadgeTitle,
} from './hdrBadge.js';

export const formatMediaVideoLine = (video?: {
    width?: number | null;
    height?: number | null;
    frameRate?: string | null;
    bitrate?: number | null;
    codec?: string | null;
    level?: string | null;
    profile?: string | null;
} | null) => {
    if (!video) return '';
    const dims = video.width && video.height ? `${video.width}x${video.height}` : '';
    const fps = String(video.frameRate || '').trim();
    const fpsLabel = fps ? (/fps|p$/i.test(fps) ? fps : `${fps} fps`) : '';
    const codec = [
        String(video.codec || '').toUpperCase(),
        video.level ? String(video.level) : '',
        titleCaseProfile(video.profile),
    ].filter(Boolean).join(' ');
    return [dims, fpsLabel, formatBitrateMbps(video.bitrate), codec].filter(Boolean).join(' · ');
};

export const formatMediaAudioLine = (audio?: {
    language?: string | null;
    displayTitle?: string | null;
    codec?: string | null;
    channelLayout?: string | null;
    channels?: number | null;
    bitrate?: number | null;
    samplingRate?: number | null;
} | null) => {
    if (!audio) return '';
    const lang = String(audio.language || '').trim();
    const language = lang && !/^[a-z]{2,3}$/i.test(lang)
        ? lang
        : (String(audio.displayTitle || '').split('(')[0].trim() || lang);
    const layout = String(audio.channelLayout || '').trim().replace(/\(/, ' (')
        || (audio.channels ? String(audio.channels) : '');
    const n = Number(audio.bitrate);
    const kbps = Number.isFinite(n) && n > 0
        ? `${n >= 100000 ? Math.round(n / 1000) : Math.round(n)} kbps`
        : '';
    return [
        language,
        String(audio.codec || '').toUpperCase(),
        layout,
        kbps,
        audio.samplingRate ? `${audio.samplingRate} kHz` : '',
    ].filter(Boolean).join(' · ');
};

export const isPlayerTrailer = (item?: PlayerItem | null) => {
    const extra = String(item?.extraType || '').toLowerCase();
    const subtype = String(item?.extraSubtype || '').toLowerCase();
    return extra === '1' || extra === 'trailer' || subtype.includes('trailer');
};

export const formatPlayerDuration = (ms?: number | null) => {
    const totalMin = Math.round(Number(ms || 0) / 60000);
    if (!Number.isFinite(totalMin) || totalMin <= 0) return '';
    if (totalMin < 60) return `${totalMin}m`;
    const hours = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

/** Plex-style spoken runtime for native player meta, e.g. "1 hour 59 minutes". */
export const formatPlayerDurationLong = (ms?: number | null) => {
    const totalMin = Math.round(Number(ms || 0) / 60000);
    if (!Number.isFinite(totalMin) || totalMin <= 0) return '';
    if (totalMin < 60) return totalMin === 1 ? '1 minute' : `${totalMin} minutes`;
    const hours = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    const hourPart = hours === 1 ? '1 hour' : `${hours} hours`;
    if (!minutes) return hourPart;
    const minPart = minutes === 1 ? '1 minute' : `${minutes} minutes`;
    return `${hourPart} ${minPart}`;
};

/** Native player top meta line: "S1 · E8 · Episode name · 26 minutes". */
export const formatNativePlayerMeta = (item?: PlayerItem | null) => {
    if (!item) return '';
    const parts: string[] = [];
    const ep = formatEpisodeCode(item);
    if (ep) parts.push(ep);
    const show = String(item.showTitle || '').trim();
    if (item.type === 'episode') {
        const episodeName = String(
            item.episodeTitle
            || (item.title && item.title !== show ? item.title : '')
            || '',
        ).trim();
        if (episodeName && episodeName.toLowerCase() !== show.toLowerCase()) parts.push(episodeName);
    } else {
        const label = String(item.showTitle || item.seasonTitle || item.title || '').trim();
        if (label) parts.push(label);
    }
    const runtime = formatPlayerDurationLong(item.durationMs);
    if (runtime) parts.push(runtime);
    // Episodes show the airdate (as Details does), movies the year — on their own line
    // (player_meta allows up to three, so a long title line can wrap).
    const when = item.type === 'episode'
        ? formatPlayerDate(item.originallyAvailableAt)
        : (item.type === 'movie' ? String(item.year || '').trim() : '');
    const line = parts.join(' · ');
    if (!when) return line;
    return line ? `${line}\n${when}` : when;
};

/** Continue Watching overlay — “42 min left”. */
export const formatRemainingWatchTime = (ms?: number | null) => {
    const totalMin = Math.round(Number(ms || 0) / 60000);
    if (!Number.isFinite(totalMin) || totalMin <= 0) return '';
    if (totalMin < 60) return `${totalMin} min`;
    const hours = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

export const remainingWatchMs = (item?: { durationMs?: number | null; viewOffsetMs?: number | null } | null) => {
    const duration = Number(item?.durationMs || 0);
    const offset = Number(item?.viewOffsetMs || 0);
    if (duration <= 0 || offset <= 0) return 0;
    return Math.max(0, duration - offset);
};

export const formatClock = (ms?: number | null) => {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
};

export const progressPercent = (item?: PlayerItem | null) => {
    const duration = Number(item?.durationMs || 0);
    const offset = Number(item?.viewOffsetMs || 0);
    if (duration <= 0 || offset <= 0) return 0;
    return Math.min(100, Math.max(2, (offset / duration) * 100));
};

export const isPlaybackFinished = (
    offsetMs?: number | null,
    durationMs?: number | null,
    opts?: { ended?: boolean; creditsStartMs?: number | null },
) => {
    if (opts?.ended) return true;
    const offset = Math.max(0, Number(offsetMs) || 0);
    const duration = Math.max(0, Number(durationMs) || 0);
    const credits = Number(opts?.creditsStartMs);
    if (Number.isFinite(credits) && credits > 0 && offset >= credits) return true;
    if (duration <= 0 || offset <= 0) return false;
    if (offset >= duration * 0.9) return true;
    return offset > Math.max(0, duration - 15_000);
};

export const shouldOfferResume = (item?: PlayerItem | null, offsetMs?: number | null) => {
    if (item?.watched) return false;
    const offset = offsetMs == null ? Number(item?.viewOffsetMs || 0) : Number(offsetMs);
    const duration = Number(item?.durationMs || 0);
    if (offset < 5000) return false;
    if (isPlaybackFinished(offset, duration)) return false;
    return true;
};

export const PLAYER_PROGRESS_EVENT = 'smp-playback-progress';

/** Browse grid ran out of loaded posters. Fetch the next page; do not move scroll. */
export const BROWSE_FOCUS_ABS_EVENT = 'smp-browse-focus-abs';

export const requestBrowseFocusAbs = (absIndex: number) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(BROWSE_FOCUS_ABS_EVENT, { detail: { absIndex: Math.max(0, Math.floor(absIndex)) } }));
};

type SavedPlaybackProgress = {
    ratingKey: string;
    viewOffsetMs: number;
    durationMs: number;
    at: number;
    watched?: boolean;
    item?: PlayerItem;
};

const savedPlaybackProgress = new Map<string, SavedPlaybackProgress>();
const PLAYBACK_PROGRESS_TTL_MS = 3 * 60_000;
/** Show/season just played, so the next On Deck episode still sorts as recently watched. */
const familyLastViewedAt = new Map<string, { at: number; unix: number }>();

const familyKeysOf = (item?: {
    grandparentRatingKey?: string | null;
    parentRatingKey?: string | null;
    ratingKey?: string | null;
} | null) => [item?.grandparentRatingKey, item?.parentRatingKey, item?.ratingKey]
    .map((key) => String(key || '').trim())
    .filter(Boolean);

export const noteFamilyLastViewed = (
    item?: {
        grandparentRatingKey?: string | null;
        parentRatingKey?: string | null;
        ratingKey?: string | null;
    } | null,
    atMs = Date.now(),
) => {
    const unix = Math.floor(atMs / 1000);
    if (unix <= 0) return;
    for (const key of familyKeysOf(item)) {
        familyLastViewedAt.set(key, { at: atMs, unix });
    }
};

/** The next episode often has no view time of its own. Keep the show's. */
export const stampFamilyLastViewed = <T extends PlayerItem>(item: T): T => {
    let best = 0;
    for (const key of familyKeysOf(item)) {
        const row = familyLastViewedAt.get(key);
        if (!row || Date.now() - row.at > PLAYBACK_PROGRESS_TTL_MS) continue;
        if (row.unix > best) best = row.unix;
    }
    if (!best) return item;
    const current = Number(item.lastViewedAt) || 0;
    const currentSec = current > 1e12 ? Math.floor(current / 1000) : current;
    if (currentSec >= best) return item;
    return { ...item, lastViewedAt: best };
};

/** Keep the exit position so posters can show Resume before Plex sends the list back. */
export const rememberPlaybackProgress = (
    item: PlayerItem | null | undefined,
    viewOffsetMs: number,
    durationMs = 0,
    continueWith?: PlayerItem | null,
    opts?: { ended?: boolean; creditsStartMs?: number | null },
) => {
    const ratingKey = String(item?.ratingKey || '');
    const offset = Math.max(0, Math.floor(Number(viewOffsetMs) || 0));
    const duration = Math.max(0, Math.floor(Number(durationMs) || Number(item?.durationMs) || 0));
    const finished = isPlaybackFinished(offset, duration, opts);
    if (!ratingKey || (!finished && offset < 5000)) return;
    const nextKey = String(continueWith?.ratingKey || '');
    const next = finished && nextKey && nextKey !== ratingKey && !continueWith?.watched
        ? continueWith
        : null;
    const saved: SavedPlaybackProgress = {
        ratingKey,
        viewOffsetMs: finished ? 0 : offset,
        durationMs: duration,
        at: Date.now(),
        watched: finished ? true : false,
        item: item ? { ...item, viewOffsetMs: finished ? 0 : offset, durationMs: duration || item.durationMs, watched: finished ? true : item.watched } : undefined,
    };
    savedPlaybackProgress.set(ratingKey, saved);
    noteFamilyLastViewed(item);
    if (next) noteFamilyLastViewed(next);
    notePlayerItemProgress(ratingKey, saved.viewOffsetMs, saved.durationMs, saved.watched);
    window.dispatchEvent(new CustomEvent(PLAYER_PROGRESS_EVENT, {
        detail: finished
            ? { ...saved, dropContinue: true, advanceContinue: true, continueWith: next }
            : saved,
    }));
};

/** Show/season scrobbles clear every episode that belongs to that key. */
const clearedWatchParents = new Map<string, { watched: boolean; at: number }>();

const freshSavedProgress = (ratingKey: string) => {
    const row = savedPlaybackProgress.get(String(ratingKey || ''));
    if (!row || Date.now() - row.at > PLAYBACK_PROGRESS_TTL_MS) return null;
    return row;
};

/** Mark watched/unwatched clears in-progress so Resume and Continue Watching drop it. */
export const noteItemWatched = (
    ratingKey: string,
    watched: boolean,
    continueWith?: PlayerItem | null,
    advanceContinue = false,
    restoreContinue?: PlayerItem | null,
) => {
    const key = String(ratingKey || '');
    if (!key || typeof window === 'undefined') return;
    const saved: SavedPlaybackProgress = {
        ratingKey: key,
        viewOffsetMs: 0,
        durationMs: 0,
        at: Date.now(),
        watched,
    };
    savedPlaybackProgress.set(key, saved);
    clearedWatchParents.set(key, { watched, at: saved.at });
    if (continueWith) noteFamilyLastViewed(continueWith, saved.at);
    if (restoreContinue) noteFamilyLastViewed(restoreContinue, saved.at);
    notePlayerItemProgress(key, 0, 0, watched);
    window.dispatchEvent(new CustomEvent(PLAYER_PROGRESS_EVENT, {
        detail: {
            ...saved,
            dropContinue: true,
            continueWith: continueWith || null,
            advanceContinue,
            restoreContinue: restoreContinue || null,
        },
    }));
};

/**
 * Progress replaces the Continue Watching card with the playback item, whose
 * thumb is the series poster. Keep the season poster already on the rail.
 */
export const keepContinueWatchingPoster = (next: PlayerItem, current?: PlayerItem | null): PlayerItem => {
    if (!current || current.cardAspect === '16/9') return next;
    const preferSeason = !!(current.preferSeasonPoster || next.preferSeasonPoster);
    const sameSeason = !!current.parentRatingKey
        && String(current.parentRatingKey) === String(next.parentRatingKey || '');
    return {
        ...next,
        preferSeasonPoster: preferSeason || undefined,
        cardAspect: current.cardAspect || next.cardAspect || '2/3',
        thumb: preferSeason && sameSeason ? (current.thumb || next.thumb) : next.thumb,
        thumbUpdatedAt: preferSeason
            ? (sameSeason ? (current.thumbUpdatedAt ?? null) : null)
            : (current.thumbUpdatedAt ?? next.thumbUpdatedAt ?? null),
        episodeThumb: next.episodeThumb || current.episodeThumb,
        episodeTitle: next.episodeTitle || current.episodeTitle,
    };
};

/** Swap a marked title for the next On Deck item in the same Continue Watching slot. */
export const replaceFamilyContinueSlot = (list: PlayerItem[], ratingKey: string, nextItem?: PlayerItem | null) => {
    const key = String(ratingKey || '');
    const index = list.findIndex((row) => watchTargetTouches(row, key));
    const without = list.filter((row) => !watchTargetTouches(row, key));
    const nextKey = String(nextItem?.ratingKey || '');
    if (!nextItem || !nextKey || nextItem.watched || without.some((row) => String(row.ratingKey) === nextKey)) {
        return without;
    }
    const current = index >= 0 ? list[index] : null;
    const card = keepContinueWatchingPoster({
        ...nextItem,
        viewOffsetMs: Number(nextItem.viewOffsetMs || 0),
        watched: false,
        lastViewedAt: Math.floor(Date.now() / 1000),
    }, current);
    noteFamilyLastViewed(card);
    if (index < 0) return [card, ...without].slice(0, 20);
    const copy = without.slice();
    copy.splice(Math.min(index, copy.length), 0, card);
    return copy.slice(0, 20);
};

/** Put a title back on Continue Watching after Mark Unwatched. */
export const restoreContinueSlot = (list: PlayerItem[], ratingKey: string, item?: PlayerItem | null) => {
    const key = String(ratingKey || '');
    if (!item?.ratingKey) return list.filter((row) => !watchTargetTouches(row, key));
    const familyKey = item.type === 'show'
        ? String(item.ratingKey)
        : item.type === 'season'
            ? String(item.parentRatingKey || item.ratingKey)
            : String(item.grandparentRatingKey || item.parentRatingKey || item.ratingKey);
    const without = list.filter((row) => (
        !watchTargetTouches(row, key)
        && !watchTargetTouches(row, familyKey)
        && String(row.ratingKey) !== String(item.ratingKey)
    ));
    return [{ ...item, watched: false }, ...without].slice(0, 20);
};

export const watchTargetTouches = (
    row: { ratingKey?: string; parentRatingKey?: string | null; grandparentRatingKey?: string | null },
    ratingKey: string,
) => {
    const key = String(ratingKey || '');
    if (!key) return false;
    return String(row.ratingKey || '') === key
        || String(row.parentRatingKey || '') === key
        || String(row.grandparentRatingKey || '') === key;
};

export const applyRememberedProgress = <T extends PlayerItem>(item: T): T => {
    const own = freshSavedProgress(String(item?.ratingKey || ''));
    const parentKey = String(item?.parentRatingKey || '');
    const showKey = String(item?.grandparentRatingKey || '');
    const parentClear = [parentKey, showKey].map((key) => (key ? clearedWatchParents.get(key) : null)).find((row) => (
        row && Date.now() - row.at <= PLAYBACK_PROGRESS_TTL_MS && (!own || row.at >= own.at)
    ));
    if (parentClear) {
        return { ...item, viewOffsetMs: 0, durationMs: item.durationMs || null, watched: parentClear.watched };
    }
    if (!own) return item;
    const durationMs = item.durationMs || own.durationMs || null;
    if (!own.viewOffsetMs) {
        const watched = own.watched !== false;
        if (!item.viewOffsetMs && Boolean(item.watched) === watched) return item;
        return { ...item, viewOffsetMs: 0, durationMs, watched };
    }
    if (item.viewOffsetMs === own.viewOffsetMs && item.durationMs) return item;
    return { ...item, viewOffsetMs: own.viewOffsetMs, durationMs, watched: false };
};

export const formatEpisodeCode = (item?: PlayerItem | null) => {
    const season = Number(item?.parentIndex);
    const episode = Number(item?.index);
    if (!Number.isFinite(season) || season <= 0 || !Number.isFinite(episode) || episode <= 0) return '';
    return `S${season} · E${episode}`;
};

let cachedDateFormat: PlayerDateFormat | null = null;
if (typeof window !== 'undefined') {
    window.addEventListener(PLAYER_SETTINGS_EVENT, () => { cachedDateFormat = null; });
    window.addEventListener('storage', () => { cachedDateFormat = null; });
}

const activeDateFormat = (): PlayerDateFormat => {
    if (!cachedDateFormat) cachedDateFormat = readPlayerSettings().dateFormat;
    return cachedDateFormat;
};

const ordinalDay = (day: number) => {
    const tens = day % 100;
    if (tens >= 11 && tens <= 13) return `${day}th`;
    return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] || 'th'}`;
};

const parsePlayerDate = (value: string | number) => {
    const raw = String(value);
    if (typeof value === 'number' || /^\d+$/.test(raw)) {
        const stamp = Number(value);
        return new Date(stamp * (stamp > 1e12 ? 1 : 1000));
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [year, month, day] = raw.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
    return new Date(raw);
};

/** True when the date falls after today (an episode that hasn't aired yet). */
export const isFuturePlayerDate = (value?: string | number | null) => {
    if (value == null || value === '') return false;
    const date = parsePlayerDate(value);
    if (Number.isNaN(date.getTime())) return false;
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return date.getTime() > endOfToday.getTime();
};

/** Dates in the user's Settings → Titles → Date format (full month by default). */
export const formatPlayerDate = (
    value?: string | number | null,
    locale = 'en',
    format: PlayerDateFormat = activeDateFormat(),
) => {
    if (value == null || value === '') return '';
    const date = parsePlayerDate(value);
    if (Number.isNaN(date.getTime())) return '';
    const lang = locale || 'en';
    const day = date.getDate();
    const year = date.getFullYear();
    const month = (style: 'long' | 'short') => date.toLocaleDateString(lang, { month: style });
    const pad = (n: number) => String(n).padStart(2, '0');
    switch (format) {
        case 'longDayFirst': return `${day} ${month('long')} ${year}`;
        // Ordinal suffixes are English; other languages get the plain day-first form.
        case 'ordinal': return /^en\b/i.test(lang)
            ? `${ordinalDay(day)} ${month('long')} ${year}`
            : `${day} ${month('long')} ${year}`;
        case 'weekday': return date.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        case 'short': return date.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
        case 'shortDayFirst': return `${day} ${month('short')} ${year}`;
        case 'numericDMY': return `${pad(day)}/${pad(date.getMonth() + 1)}/${year}`;
        case 'numericMDY': return `${pad(date.getMonth() + 1)}/${pad(day)}/${year}`;
        case 'iso': return `${year}-${pad(date.getMonth() + 1)}-${pad(day)}`;
        default: return date.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
    }
};

/** Prefer the higher watched count when the show record is 0 but seasons or episodes already know. */
export const withWatchedProgress = (item: PlayerItem, rows: PlayerItem[] = []): PlayerItem => {
    if (item.type !== 'show' && item.type !== 'season') return item;
    const own = Number(item.viewedLeafCount || 0);
    const fromChildren = item.type === 'show'
        ? rows.reduce((sum, row) => sum + Number(row.viewedLeafCount || 0), 0)
        : rows.filter((row) => row.type === 'episode' && Number(row.viewCount) > 0).length;
    const viewedLeafCount = Math.max(own, fromChildren);
    if (viewedLeafCount === own) return item;
    const leaves = Number(item.leafCount || 0);
    return {
        ...item,
        viewedLeafCount,
        watched: leaves > 0 ? viewedLeafCount >= leaves : item.watched,
    };
};

export const unwatchedCount = (item?: PlayerItem | null) => {
    if (!item || (item.type !== 'show' && item.type !== 'season')) return 0;
    const leaves = Number(item.leafCount || 0);
    const viewed = Number(item.viewedLeafCount || 0);
    if (leaves <= 0) return 0;
    return Math.max(0, leaves - Math.min(viewed, leaves));
};

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * Prefer Plex thumb paths that already include a `/thumb/<stamp>` cache buster.
 * Bare `/library/metadata/{id}/thumb` URLs keep serving stale art after poster changes.
 */
export const libraryThumbPathFrom = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('/library/') || raw.startsWith('/hubs/')) {
        return raw.split('#')[0].split('?')[0];
    }
    try {
        const parsed = new URL(raw);
        const inner = String(parsed.searchParams.get('url') || '').trim();
        if (inner.startsWith('/library/') || inner.startsWith('/hubs/')) {
            return inner.split('#')[0].split('?')[0];
        }
        if (parsed.pathname.includes('/library/metadata/')) {
            return `${parsed.pathname}`.split('#')[0];
        }
    } catch {
        /* ignore */
    }
    return '';
};

export const stampedMetadataThumb = (
    ratingKey?: string | null,
    existingPath?: string | null,
    updatedAt?: string | number | null,
) => {
    const key = String(ratingKey || '').replace(/\D/g, '');
    const existing = libraryThumbPathFrom(existingPath);
    const stamp = String(updatedAt ?? '').replace(/\D/g, '');
    // Prefer an explicit updatedAt stamp (fresh show metadata). Stamped paths from
    // episode/hub rows are immutable and keep serving pre-swap poster art forever.
    if (key && stamp) return `/library/metadata/${key}/thumb/${stamp}`;
    if (key && existing.includes(`/library/metadata/${key}/thumb`)) {
        // Keep only if already stamped for this key; else use unstamped current.
        if (/\/thumb\/\d+/.test(existing)) return existing;
        return `/library/metadata/${key}/thumb`;
    }
    if (key) return `/library/metadata/${key}/thumb`;
    return existing;
};

/** Recently Added must use the show poster, never the episode title card. */
export const withShowPoster = (item: PlayerItem): PlayerItem => {
    if (item.type !== 'episode' && item.type !== 'season') return item;
    const showKey = String(
        (item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey) || '',
    ).replace(/\D/g, '');
    const seasonKey = String(item.parentRatingKey || '').replace(/\D/g, '');
    if (!showKey && !seasonKey) return { ...item, cardAspect: item.cardAspect || '2/3' };

    const preferSeason = !!item.preferSeasonPoster && !!seasonKey;
    const targetKey = preferSeason ? seasonKey : showKey;
    const thumbUpdatedAt = (item as { thumbUpdatedAt?: number | string | null }).thumbUpdatedAt;
    // Rebuild show/season path (stamped when we have updatedAt). Always resolve to an
    // absolute PMS/portal image URL — bare /library/... paths blank out on TV when the
    // /api/plex/image rewrite misses.
    const stamped = stampedMetadataThumb(targetKey, null, preferSeason ? null : thumbUpdatedAt)
        || (targetKey ? `/library/metadata/${targetKey}/thumb` : '');
    const absolute = stamped
        ? (
            plexImageUrl(stamped, PLAYER_POSTER_WIDTH, PLAYER_POSTER_HEIGHT, { quality: PLAYER_POSTER_QUALITY })
            || stamped
        )
        : '';
    return {
        ...item,
        thumb: absolute || item.thumb,
        cardAspect: '2/3',
    };
};

/**
 * URLs needed when opening a Continue Watching episode (show poster on the rail,
 * episode still, and details backdrop). Warming these on Home makes OK feel instant.
 */
export const continueWatchingImageUrls = (item: PlayerItem): string[] => {
    const urls: string[] = [];
    const push = (url?: string | null) => {
        const key = String(url || '').trim();
        if (key && !urls.includes(key)) urls.push(key);
    };
    const showPoster = withShowPoster(item).thumb;
    push(playerCardImageUrl(showPoster, '2/3'));
    if (showPoster && !/^https?:\/\//i.test(showPoster)) {
        push(plexImageUrl(showPoster, PLAYER_POSTER_WIDTH, PLAYER_POSTER_HEIGHT, { quality: PLAYER_POSTER_QUALITY }));
    }
    const episodeStill = String(item.episodeThumb || (item.type === 'episode' ? item.thumb : '') || '').trim();
    if (episodeStill) {
        push(playerCardImageUrl(episodeStill, '16/9'));
        push(resizePlexArtUrl(episodeStill, 426, 240, PLAYER_POSTER_QUALITY));
        push(plexImageUrl(episodeStill, 426, 240, { quality: PLAYER_POSTER_QUALITY }));
    }
    const art = item.art || item.thumb || episodeStill;
    push(plexBackdropUrl(art));
    return urls;
};

/** Prefetch CW show posters + episode stills/backdrops ahead of opening details. */
export const prefetchContinueWatchingImages = (
    items: Array<PlayerItem | null | undefined>,
    limitItems = 24,
) => {
    if (typeof window === 'undefined' || !items?.length) return;
    const urls = items
        .filter((item): item is PlayerItem => !!item?.ratingKey)
        .slice(0, limitItems)
        .flatMap((item) => continueWatchingImageUrls(item));
    prefetchPlayerImages(urls, Math.max(urls.length, 1));
};

/**
 * Plex-style Recently Added: show poster + show title, keep episode key / SxxExx /
 * episode synopsis so home focus + click open that episode.
 * Optional `preferSeasonPoster` (settings) uses the season poster instead.
 */
export const asRecentlyAddedPlayerItem = (
    item: PlayerItem,
    opts?: { preferSeasonPoster?: boolean },
): PlayerItem => {
    const preferSeason = opts?.preferSeasonPoster === true || !!item.preferSeasonPoster;
    if (item.type !== 'episode' && item.type !== 'season') {
        return withShowPoster(preferSeason ? { ...item, preferSeasonPoster: true } : item);
    }
    const showName = String(
        item.type === 'season'
            ? (item.showTitle || item.seasonTitle || item.title)
            : (item.showTitle || item.title)
        || '',
    ).trim();
    const episodeTitle = item.type === 'episode'
        ? String(
            item.episodeTitle
            || (item.showTitle && item.title && item.title !== item.showTitle ? item.title : '')
            || '',
        ).trim()
        : '';
    const painted = withShowPoster({
        ...item,
        preferSeasonPoster: preferSeason || undefined,
    });
    return {
        ...painted,
        preferSeasonPoster: preferSeason || undefined,
        episodeTitle: episodeTitle || item.episodeTitle || null,
        title: showName || item.title,
        showTitle: showName || item.showTitle || null,
        // One card per episode. A show key here collapsed a 278-episode add into one poster.
        dedupeKey: item.ratingKey || null,
    };
};

/** Poster row vs widescreen episode still + episode title (Continue Watching layout). */
export const applyContinueWatchingLayout = (
    item: PlayerItem,
    layout: PlayerContinueWatchingLayout,
): PlayerItem => {
    if (layout !== 'title') {
        if (item.type === 'episode') return { ...item, cardAspect: '2/3' };
        return item;
    }
    if (item.type !== 'episode') {
        return { ...item, cardAspect: '16/9' };
    }
    const ratingKey = String(item.ratingKey || '').replace(/\D/g, '');
    const episodeThumb = stampedMetadataThumb(
        ratingKey,
        item.episodeThumb || item.thumb,
    ) || item.episodeThumb || item.thumb;
    const episodeTitle = String(item.episodeTitle || item.title || '').trim() || item.title;
    return {
        ...item,
        title: episodeTitle,
        thumb: episodeThumb,
        cardAspect: '16/9',
    };
};

export const keepContinueWatchingItem = (item?: PlayerItem | null) => {
    if (!item?.ratingKey) return false;
    const painted = applyRememberedProgress(item);
    if (isPlaybackFinished(item.viewOffsetMs, item.durationMs || painted.durationMs)) return false;
    if (painted.watched && Number(painted.viewOffsetMs || 0) <= 0 && Number(item.viewOffsetMs || 0) > 0) return false;
    return true;
};

export const mapContinueWatchingItemsForLayout = (
    items: PlayerItem[],
    layout: PlayerContinueWatchingLayout,
    sort?: PlayerContinueWatchingSort,
): PlayerItem[] => sortContinueWatchingItems(
    (Array.isArray(items) ? items : []).filter(keepContinueWatchingItem).map(applyRememberedProgress),
    sort,
).map((row) => applyContinueWatchingLayout(row, layout));

export const isPlayerItemWatched = (item?: PlayerItem | null) => {
    if (!item) return false;
    if (item.watched) return true;
    const leaves = Number(item.leafCount) || 0;
    const viewed = Number(item.viewedLeafCount) || 0;
    if ((item.type === 'show' || item.type === 'season') && leaves > 0 && viewed >= leaves) return true;
    return false;
};

/** Skip finished episodes so Play on a show/season starts at the next unwatched (or in-progress) leaf. */
export const sliceQueueToNextUnwatched = (items: PlayerItem[] | null | undefined): PlayerItem[] => {
    const rows = Array.isArray(items) ? items : [];
    const idx = rows.findIndex((row) => shouldOfferResume(row) || !isPlayerItemWatched(row));
    if (idx <= 0) return rows;
    return rows.slice(idx);
};

/**
 * Keep the focused “from here” leaf, then skip already-watched titles after it
 * (in-progress still included). Used by Play unwatched from here.
 */
export const sliceQueueUnwatchedFromHere = (items: PlayerItem[] | null | undefined): PlayerItem[] => {
    const rows = Array.isArray(items) ? items : [];
    if (rows.length <= 1) return rows;
    const [first, ...rest] = rows;
    return [first, ...rest.filter((row) => shouldOfferResume(row) || !isPlayerItemWatched(row))];
};

/** Unwatched + in-progress leaves only (for Shuffle unwatched). */
export const filterQueueUnwatched = (items: PlayerItem[] | null | undefined): PlayerItem[] => (
    (Array.isArray(items) ? items : []).filter((row) => shouldOfferResume(row) || !isPlayerItemWatched(row))
);

/** Fisher–Yates copy — used by Shuffle unwatched after filtering watched leaves. */
export const shufflePlayerItems = <T,>(items: T[] | null | undefined): T[] => {
    const rows = Array.isArray(items) ? items.slice() : [];
    for (let i = rows.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = rows[i];
        rows[i] = rows[j];
        rows[j] = tmp;
    }
    return rows;
};

/** Drop fully watched titles from Recently Added rows. */
export const hideWatchedPlayerItems = (items: PlayerItem[] | null | undefined): PlayerItem[] => (
    (Array.isArray(items) ? items : []).filter((row) => !isPlayerItemWatched(row))
);

/** Second line under a Heros-label home card: year, or season/episode count. */
export const heroRowSubtitle = (item: Pick<PlayerItem, 'type' | 'year' | 'childCount' | 'leafCount'>) => {
    const kind = String(item.type || '').toLowerCase();
    if (kind === 'show' || kind === 'season') {
        const seasons = Math.max(0, Number(item.childCount) || 0);
        const episodes = Math.max(0, Number(item.leafCount) || 0);
        if (seasons > 1) return `${seasons} seasons`;
        if (seasons === 1 && episodes > 1) return `${episodes} episodes`;
        if (seasons === 1 && episodes === 1) return '1 episode';
        if (seasons === 1) return '1 season';
        if (episodes > 1) return `${episodes} episodes`;
        if (episodes === 1) return '1 episode';
        return '';
    }
    const year = Number(item.year) || 0;
    return year > 0 ? String(year) : '';
};

/** Show the Replex coverArt file as Plex published it. A library fallback can still be transcoded. */
export const heroCardImageUrl = (source?: string | null) => {
    const value = String(source || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value) && !/\/photo\/:\/transcode/i.test(value)) return value;
    return directPlexTranscodeUrl(value, 1920, 1080, -1, { upscale: false }) || value;
};

/** Rail-sized coverArt. A published Plex hero file is already the 16:9 poster — do not transcode it into a backdrop. */
export const heroRailCardImageUrl = (source?: string | null) => {
    const value = String(source || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value) && !/\/photo\/:\/transcode/i.test(value)) return value;
    return directPlexTranscodeUrl(value, 854, 480, 72, { upscale: false }) || value;
};

export const heroRowCardItem = (item: PlayerItem): PlayerItem => ({
    ...item,
    cardAspect: '16/9',
    heroCard: true,
});

export const toPosterCardItem = (item: PlayerItem) => {
    const ratingKey = String(item.ratingKey || '').replace(/\D/g, '');
    const leafThumb = ratingKey ? `/library/metadata/${ratingKey}/thumb` : '';
    const showKey = String(
        (item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey) || '',
    ).replace(/\D/g, '');
    const seasonKey = item.type === 'episode'
        ? String(item.parentRatingKey || '').replace(/\D/g, '')
        : '';
    const thumbUpdatedAt = (item as { thumbUpdatedAt?: number | string | null }).thumbUpdatedAt;
    const showThumb = showKey
        ? (stampedMetadataThumb(showKey, null, item.preferSeasonPoster ? null : thumbUpdatedAt) || `/library/metadata/${showKey}/thumb`)
        : '';
    // Do not stamp the season poster with the episode or show updatedAt. That
    // path 404s and the card falls back to the series poster.
    const seasonThumb = item.preferSeasonPoster && seasonKey
        ? (stampedMetadataThumb(seasonKey, item.thumb, null) || `/library/metadata/${seasonKey}/thumb`)
        : '';
    const posterThumb = seasonThumb || showThumb;
    const preferShowPoster = (item.type === 'episode' || item.type === 'season')
        && item.cardAspect !== '16/9'
        && (item.cardAspect === '2/3' || !item.cardAspect)
        && !!posterThumb;
    // HEAD order: keep a working absolute item.thumb — never strip it via libraryThumbPathFrom.
    let thumb = (preferShowPoster ? posterThumb : '') || item.thumb || leafThumb || undefined;
    // Landscape episode cards size the still themselves. A portrait transcode here
    // crops the frame before the 16:9 card ever sees it.
    const keepEpisodeStill = item.cardAspect === '16/9'
        && item.type === 'episode'
        && String(thumb || '').startsWith('/library/');
    if (
        thumb
        && !keepEpisodeStill
        && !/^https?:\/\//i.test(thumb)
        && !String(thumb).startsWith('/api/')
    ) {
        thumb = plexImageUrl(
            thumb,
            PLAYER_POSTER_WIDTH,
            PLAYER_POSTER_HEIGHT,
            { quality: PLAYER_POSTER_QUALITY },
        ) || thumb;
    }
    const remoteThumb = /^https?:\/\//i.test(String(thumb || ''))
        || String(thumb || '').startsWith('/api/');
    // Episode stills are title cards. Never use them as a poster fallback.
    const movieLeafFallback = item.type !== 'episode' && item.type !== 'season'
        && leafThumb
        && (remoteThumb || (thumb && thumb !== leafThumb));
    const heroOriginal = item.heroCard ? String(item.heroArt || '').trim() : '';
    const posterFallbackUrl = heroOriginal && heroOriginal !== thumb
        ? heroOriginal
        : movieLeafFallback
            ? plexImageUrl(leafThumb, PLAYER_POSTER_WIDTH, PLAYER_POSTER_HEIGHT, { quality: PLAYER_POSTER_QUALITY })
                || `/api/plex/image?path=${encodeURIComponent(leafThumb)}&width=${PLAYER_POSTER_WIDTH}&height=${PLAYER_POSTER_HEIGHT}&quality=${PLAYER_POSTER_QUALITY}`
            : undefined;
    return {
        title: item.title,
        thumb: remoteThumb ? undefined : (thumb || undefined),
        thumbUrl: remoteThumb ? thumb : undefined,
        posterFallbackUrl,
        plexUrl: item.plexUrl || '',
        year: item.year || undefined,
        parentTitle: item.showTitle || item.seasonTitle || undefined,
        ratingKey: item.ratingKey || undefined,
    };
};

export const withPlayerStreamQuery = (src: string, updates: Record<string, string | number | null | undefined>) => {
    const qIndex = src.indexOf('?');
    const path = qIndex >= 0 ? src.slice(0, qIndex) : src;
    const qs = new URLSearchParams(qIndex >= 0 ? src.slice(qIndex + 1) : '');
    qs.delete('resume');
    for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === '') qs.delete(key);
        else qs.set(key, String(value));
    }
    const query = qs.toString();
    return query ? `${path}?${query}` : path;
};

const PLAY_SESSION_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|smp-[a-z0-9-]{6,40}|plex-\d{1,16})$/i;

export const newPlaySessionId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback without Math.random — CodeQL flags insecure randomness in session IDs.
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (Date.now() + i * 17) & 0xff;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const playSessionIdFromSrc = (src?: string | null) => {
    const params = new URLSearchParams(String(src || '').split('?')[1] || '');
    const id = params.get('session')
        || params.get('X-Plex-Session-Identifier')
        || '';
    return PLAY_SESSION_ID.test(id) ? id : '';
};

export const playbackQueryParam = (src: string | null | undefined, key: string) => (
    new URLSearchParams(String(src || '').split('?')[1] || '').get(key) || ''
);

export const audioStreamIdFromSrc = (src?: string | null) => playbackQueryParam(src, 'audioStreamID').replace(/\D/g, '');

export const subtitleStreamIdFromSrc = (src?: string | null) => playbackQueryParam(src, 'subtitleStreamID').replace(/\D/g, '');

export const isHlsPlaybackSrc = (src?: string | null) => /\.m3u8(\?|$)/i.test(String(src || ''));

export const isFilePlaybackSrc = (src?: string | null) => (
    String(src || '').includes(`${PLAYER_API_ROOT}/file/`)
);

/** plexDirect Direct Play of a PMS part (bitstream/passthrough when the sink allows it). */
export const isPlexPartPlaybackSrc = (src?: string | null) => (
    /\/library\/parts\//i.test(String(src || ''))
);

export const playbackModeFromSrc = (
    src?: string | null,
    qualityId?: string | null,
    canCopyOriginal?: boolean,
) => {
    if (isFilePlaybackSrc(src)) return 'directPlay' as const;
    if ((!qualityId || qualityId === 'original') && canCopyOriginal !== false) return 'directStream' as const;
    return 'transcode' as const;
};

export const isApplePlayback = () => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    if (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1) return true;
    return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|Android|Firefox/i.test(ua);
};

export const canUseNativeHls = () => {
    if (typeof document === 'undefined' || !isApplePlayback()) return false;
    const video = document.createElement('video');
    const result = video.canPlayType('application/vnd.apple.mpegurl');
    return result === 'probably' || result === 'maybe';
};

/** Chosen-bitrate fallback. Original stays original so ExoPlayer can Direct Play. */
export const NATIVE_SAFE_QUALITY_ID = '1080-12';

export const isPlexNativePlayback = () => (
    typeof window !== 'undefined'
    && !!window.__PLEX_CLIENT__
    && window.__PLEX_CLIENT__.nativePlayer !== false
);

export const nativeSafeQualityId = (qualityId?: string | null) => {
    const q = String(qualityId || '').trim();
    if (!q || q === 'auto') return 'original';
    return q;
};

/** Native TV/Fire TV should default to Original (Direct Play), not a transcode preset from settings. */
export const resolveStartPlaybackQualityId = (
    explicit?: string | null,
    settingsDefault?: string | null,
): string | undefined => {
    const picked = String(explicit || '').trim();
    if (picked && picked !== 'auto') return picked;
    if (isPlexNativePlayback()) return 'original';
    const def = String(settingsDefault || 'auto').trim();
    if (!def || def === 'auto') return undefined;
    return def;
};

const IMAGE_SUBTITLE_CODEC = /^(pgs|vobsub|dvd|dvdsub|image|bluray|dvbsub|xsub)$/i;
export type SubtitleBurnMode = 'auto' | 'always' | 'image';

export const subtitleCodecNeedsBurn = (
    codec?: string | null,
    mode: SubtitleBurnMode | string | null | undefined = 'auto',
) => {
    const policy = String(mode || 'auto').toLowerCase();
    const raw = String(codec || '').trim();
    if (!raw) return false;
    if (policy === 'always') return true;
    // auto — only image formats. Every caller is the native player, and ExoPlayer draws
    // ASS/SSA itself (like official Plex on Android), so those Direct Play.
    return IMAGE_SUBTITLE_CODEC.test(raw);
};

export const nativeDirectPlayEligible = (input: {
    canDirectPlay?: boolean;
    playbackMode?: string;
    qualityId?: string | null;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
    audioTracks?: Array<{ id: string; codec?: string | null }>;
    subtitles?: Array<{ id: string; codec?: string | null }>;
    source?: { audioCodec?: string | null };
}, opts?: {
    qualityId?: string | null;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
}) => {
    const sub = String(opts?.subtitleStreamId ?? input.subtitleStreamId ?? '').replace(/\D/g, '');
    if (sub) {
        const track = (input.subtitles || []).find((row) => String(row.id || '') === sub);
        // Image subs still need burn-in. Text / unknown ride with Direct Play.
        if (track) {
            let burnMode: SubtitleBurnMode = 'auto';
            try {
                const raw = window.localStorage?.getItem('portal-media-player-settings');
                const parsed = raw ? JSON.parse(raw) : null;
                const mode = String(parsed?.burnSubtitles || 'auto').toLowerCase();
                if (mode === 'always' || mode === 'image') burnMode = mode;
            } catch { /* default auto */ }
            if (subtitleCodecNeedsBurn(track.codec, burnMode)) return false;
        }
    }
    if (input.playbackMode === 'directPlay') return true;
    const quality = nativeSafeQualityId(opts?.qualityId ?? input.qualityId);
    if (quality !== 'original' || !input.canDirectPlay) return false;
    const audioId = opts?.audioStreamId ?? input.audioStreamId ?? '';
    const codec = (input.audioTracks || []).find((row) => row.id === audioId)?.codec
        || input.source?.audioCodec
        || '';
    return nativeAudioIsDirectPlayable(codec);
};

export const buildNativePlaybackSrc = (
    ratingKey: string,
    session: {
        src: string;
        sessionId: string;
        offsetMs?: number;
        qualityId?: string;
        audioStreamId?: string | null;
        subtitleStreamId?: string | null;
        mediaIndex?: number;
        canDirectPlay?: boolean;
        playbackMode?: string;
        audioTracks?: Array<{ id: string; codec?: string | null }>;
        subtitles?: Array<{ id: string; codec?: string | null }>;
        source?: { audioCodec?: string | null };
    },
    opts?: {
        qualityId?: string | null;
        audioStreamId?: string | null;
        subtitleStreamId?: string | null;
        mediaIndex?: number;
        offsetMs?: number;
        sessionId?: string;
    },
) => {
    const qualityId = nativeSafeQualityId(opts?.qualityId ?? session.qualityId);
    const audioStreamId = opts?.audioStreamId ?? session.audioStreamId ?? '';
    const subtitleStreamId = opts?.subtitleStreamId ?? session.subtitleStreamId ?? '';
    const mediaIndex = opts?.mediaIndex ?? session.mediaIndex ?? 0;
    const offsetMs = opts?.offsetMs ?? session.offsetMs ?? 0;
    const sessionId = opts?.sessionId ?? session.sessionId;
    const eligible = nativeDirectPlayEligible(session, {
        qualityId,
        audioStreamId,
        subtitleStreamId,
    });
    const mode = String(session.playbackMode || '').trim();
    const src = String(session.src || '').trim();
    const streamUpdates: Record<string, string | number | null | undefined> = {
        session: sessionId,
        offset: offsetMs > 0 ? Math.floor(offsetMs) : undefined,
        mediaIndex: mediaIndex > 0 ? mediaIndex : undefined,
        quality: qualityId && qualityId !== 'original' ? qualityId : undefined,
        audioStreamID: String(audioStreamId || '').replace(/\D/g, '') || undefined,
        subtitleStreamID: String(subtitleStreamId || '').replace(/\D/g, '') || undefined,
    };

    // Direct Plex hands ExoPlayer an absolute server URL. Keep the host, but
    // still apply the new session / offset / stream ids on rebuilds.
    if (/^https?:\/\//i.test(src)) {
        const transcode = /\/transcode\/|\.m3u8(\?|$)/i.test(src);
        // Cannot turn an HLS URL back into Direct Play by patching query params —
        // leave empty so the caller retries startMediaPlayerPlayback /portal play.
        if (transcode && eligible && qualityId === 'original') {
            return '';
        }
        return withPlayerStreamQuery(src, {
            session: sessionId,
            'X-Plex-Session-Identifier': sessionId,
            offset: offsetMs > 0
                ? (transcode ? Math.floor(offsetMs / 1000) : Math.floor(offsetMs))
                : undefined,
            mediaIndex: mediaIndex > 0 ? mediaIndex : undefined,
            audioStreamID: String(audioStreamId || '').replace(/\D/g, '') || undefined,
            subtitleStreamID: String(subtitleStreamId || '').replace(/\D/g, '') || undefined,
        });
    }

    // Never rewrite an HLS playlist as /file/ — Plex answers 409 JSON and
    // ExoPlayer reports ERROR_CODE_IO_BAD_HTTP_STATUS.
    if (isHlsPlaybackSrc(src)) {
        return withPlayerStreamQuery(src, streamUpdates);
    }
    if (isFilePlaybackSrc(src) && eligible && mode !== 'transcode') {
        return withPlayerStreamQuery(src, {
            ...streamUpdates,
            client: 'android',
            hevc: '1',
            ac3: '1',
            textSubs: '1',
            subtitleStreamID: undefined,
        });
    }

    return buildPlaybackSrc(ratingKey, {
        sessionId,
        offsetMs,
        qualityId,
        audioStreamId,
        subtitleStreamId,
        directFile: false,
        copy: true,
        mediaIndex,
    });
};

/**
 * Bitstream/passthrough codecs only (TrueHD/DTS). EAC3/AC3 always Direct Play
 * like official Plex — they are decoded or passed by Exo without this setting.
 */
const BITSTREAM_NATIVE_AUDIO = /^(truehd|mlp|dca|dts|dtsc|dtsh|dtshd|dtsma|dtsl)$/i;

export const nativeAudioIsDirectPlayable = (codec?: string | null) => {
    const value = String(codec || '').trim().toLowerCase();
    if (!value) return true;
    // EAC3 / Atmos JOC / AC3 are never gated by Bitstream.
    if (/eac3|ec-3|e-ac-3|ec\+3|joc|ac3|ac-3/.test(value)) return true;
    if (!BITSTREAM_NATIVE_AUDIO.test(value)) return true;
    try {
        const passthrough = window.localStorage?.getItem('portal-media-player-settings');
        if (!passthrough) return false;
        const parsed = JSON.parse(passthrough);
        // Opt-in only — TrueHD/DTS DP can native-abort on TVs without passthrough.
        return parsed?.audioPassthrough === true;
    } catch {
        return false;
    }
};

export const browserPlaybackCaps = () => {
    if (typeof document === 'undefined') return { hevc: false, ac3: false, hls: false };
    // ExoPlayer on Android TV Direct Plays HEVC/AC3 and bitstreams TrueHD/DTS
    // when the HDMI sink supports passthrough.
    if (isPlexNativePlayback()) {
        return { hevc: true, ac3: true, hls: true };
    }
    const video = document.createElement('video');
    const can = (type: string) => {
        const result = video.canPlayType(type);
        return result === 'probably' || result === 'maybe';
    };
    const apple = isApplePlayback();
    return {
        hevc: apple && (can('video/mp4; codecs="hvc1.1.6.L93.B0"') || can('video/mp4; codecs="hev1.1.6.L93.B0"')),
        ac3: apple && (can('audio/mp4; codecs="ac-3"') || can('audio/mp4; codecs="ec-3"')),
        hls: canUseNativeHls(),
    };
};

export const offsetMsFromSrc = (src?: string | null) => (
    Math.max(0, Math.floor(Number(new URLSearchParams(String(src || '').split('?')[1] || '').get('offset') || 0)))
);

export const buildFilePlaybackSrc = (ratingKey: string, {
    sessionId = '',
    offsetMs = 0,
    allowHevc = false,
    allowAc3 = false,
    mediaIndex = 0,
    client = '',
} = {}) => {
    const qs = new URLSearchParams();
    if (PLAY_SESSION_ID.test(String(sessionId || ''))) qs.set('session', String(sessionId));
    if (Number(offsetMs) > 0) qs.set('offset', String(Math.floor(Number(offsetMs))));
    if (allowHevc) qs.set('hevc', '1');
    if (allowAc3) qs.set('ac3', '1');
    if (client && client !== 'web') {
        qs.set('client', client);
        qs.set('textSubs', '1');
    }
    if (Number(mediaIndex) > 0) qs.set('mediaIndex', String(Math.floor(Number(mediaIndex))));
    return `${PLAYER_API_ROOT}/file/${encodeURIComponent(ratingKey)}?${qs}`;
};

export const buildPlaybackSrc = (ratingKey: string, {
    sessionId = '',
    offsetMs = 0,
    qualityId = '',
    audioStreamId = '',
    subtitleStreamId = '',
    directFile = false,
    copy = true,
    mediaIndex = 0,
}: {
    sessionId?: string;
    offsetMs?: number;
    qualityId?: string;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
    directFile?: boolean;
    copy?: boolean;
    mediaIndex?: number;
} = {}) => {
    const original = !qualityId || qualityId === 'original';
    // Native Direct Play can keep text subs via ExoPlayer track selection.
    if (directFile && original) {
        const caps = browserPlaybackCaps();
        const native = isPlexNativePlayback();
        return buildFilePlaybackSrc(ratingKey, {
            sessionId,
            offsetMs,
            allowHevc: caps.hevc || native,
            allowAc3: caps.ac3 || native,
            mediaIndex,
            client: native ? 'android' : '',
        });
    }
    const qs = new URLSearchParams();
    if (PLAY_SESSION_ID.test(String(sessionId || ''))) qs.set('session', String(sessionId));
    if (Number(offsetMs) > 0) qs.set('offset', String(Math.floor(Number(offsetMs))));
    if (qualityId) qs.set('quality', String(qualityId));
    if (copy === false) qs.set('copy', '0');
    if (Number(mediaIndex) > 0) qs.set('mediaIndex', String(Math.floor(Number(mediaIndex))));
    if (String(audioStreamId || '').replace(/\D/g, '')) qs.set('audioStreamID', String(audioStreamId).replace(/\D/g, ''));
    if (String(subtitleStreamId || '').replace(/\D/g, '')) qs.set('subtitleStreamID', String(subtitleStreamId).replace(/\D/g, ''));
    return `${PLAYER_API_ROOT}/hls/${encodeURIComponent(ratingKey)}/master.m3u8?${qs}`;
};
