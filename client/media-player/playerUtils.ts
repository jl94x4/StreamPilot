import { directPlexTranscodeUrl, portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { notePlayerItemProgress } from './playerMemory';
import { PLAYER_API_ROOT, PLAYER_IMAGE_PATH } from './paths';
import { sortContinueWatchingItems, type PlayerContinueWatchingLayout, type PlayerContinueWatchingSort } from './playerSettings';
import type { PlayerItem } from './types';

/** Shared rail size so home, library, and season grids hit the same cached JPEG. */
export const PLAYER_POSTER_WIDTH = 300;
export const PLAYER_POSTER_HEIGHT = 450;
export const PLAYER_POSTER_QUALITY = 60;

const prefetchedPlayerImages = new Set<string>();
const PREFETCHED_IMAGE_CAP = 500;

const rememberPrefetchedImage = (url: string) => {
    if (prefetchedPlayerImages.has(url)) return false;
    if (prefetchedPlayerImages.size >= PREFETCHED_IMAGE_CAP) {
        const first = prefetchedPlayerImages.values().next().value;
        if (first) prefetchedPlayerImages.delete(first);
    }
    prefetchedPlayerImages.add(url);
    return true;
};

export const clearPrefetchedPlayerImages = () => {
    prefetchedPlayerImages.clear();
};

export const prefetchPlayerImages = (urls: Array<string | null | undefined>, limit = 12) => {
    if (typeof window === 'undefined') return;
    let started = 0;
    for (const url of urls) {
        if (!url || !rememberPrefetchedImage(url)) continue;
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        started += 1;
        if (started >= limit) return;
    }
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
    if (isMusicPlayerItem(item) || item.cardAspect === 'square') return 'square';
    if (forced) return forced;
    if (item.cardAspect) return item.cardAspect;
    if (String(item.type || '') === 'episode') return '16/9';
    return '2/3';
};

/** Rewrite a Plex photo transcode so album art is not pre-cropped to 2:3. */
export const resizePlexArtUrl = (url: string | null | undefined, width: number, height: number) => {
    const value = String(url || '').trim();
    if (!value || !/\/photo\/:\/transcode|\/api\/plex\/image/i.test(value)) return value;
    try {
        const parsed = new URL(value, 'https://plex.local');
        parsed.searchParams.set('width', String(width));
        parsed.searchParams.set('height', String(height));
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
    if (opts?.quality) params.set('quality', String(opts.quality));
    return portalUrl(`${PLAYER_IMAGE_PATH}?${params.toString()}`);
};

export const playerCardImageUrl = (thumb?: string | null, aspect: '2/3' | 'square' | '16/9' = '2/3') => {
    if (!thumb) return '';
    if (aspect === '16/9') return plexImageUrl(thumb, 426, 240, { quality: PLAYER_POSTER_QUALITY });
    if (aspect === 'square') return plexImageUrl(thumb, 300, 300, { quality: PLAYER_POSTER_QUALITY });
    return plexImageUrl(thumb, PLAYER_POSTER_WIDTH, PLAYER_POSTER_HEIGHT, { quality: PLAYER_POSTER_QUALITY });
};

export const plexLogoUrl = (path?: string | null) => plexImageUrl(path, 640, 240, { fit: 'contain', quality: 70 });

/**
 * Full hero art. TV stays at 1920×1080 (layout width) but JPEG quality is maxed.
 * Desktop may request 4K when the source has it.
 */
export const PLAYER_BACKDROP_WIDTH = 3840;
export const PLAYER_BACKDROP_HEIGHT = 2160;
export const PLAYER_BACKDROP_QUALITY = 100;
export const PLAYER_BACKDROP_PREVIEW_WIDTH = 640;
export const PLAYER_BACKDROP_PREVIEW_HEIGHT = 360;
export const PLAYER_BACKDROP_PREVIEW_QUALITY = 40;

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

const isTvShellDocument = () => (
    typeof document !== 'undefined'
    && (
        document.documentElement?.dataset?.tv === '1'
        || (typeof window !== 'undefined' && window.__PLEX_CLIENT__?.isTv === true)
    )
);

export const plexBackdropUrl = (path?: string | null) => {
    if (!path) return '';
    const tv = isTvShellDocument();
    // TV WebView: stay at 1080p canvas (matches layout) but never soft-compress.
    const width = tv ? 1920 : PLAYER_BACKDROP_WIDTH;
    const height = tv ? 1080 : PLAYER_BACKDROP_HEIGHT;
    const quality = PLAYER_BACKDROP_QUALITY;
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/api/')) {
        return withPlexImageSize(path, width, height, quality);
    }
    return plexImageUrl(path, width, height, { quality });
};

export const plexBackdropPreviewUrl = (path?: string | null) => {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/api/')) {
        return withPlexImageSize(
            path,
            PLAYER_BACKDROP_PREVIEW_WIDTH,
            PLAYER_BACKDROP_PREVIEW_HEIGHT,
            PLAYER_BACKDROP_PREVIEW_QUALITY,
        );
    }
    return plexImageUrl(path, PLAYER_BACKDROP_PREVIEW_WIDTH, PLAYER_BACKDROP_PREVIEW_HEIGHT, {
        quality: PLAYER_BACKDROP_PREVIEW_QUALITY,
    });
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
    const card: PlayerItem = {
        ...nextItem,
        preferSeasonPoster: nextItem.preferSeasonPoster ?? current?.preferSeasonPoster,
        viewOffsetMs: Number(nextItem.viewOffsetMs || 0),
        watched: false,
    };
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

export const formatPlayerDate = (value?: string | number | null, locale = 'en') => {
    if (value == null || value === '') return '';
    const raw = String(value);
    let date: Date;
    if (typeof value === 'number' || /^\d+$/.test(raw)) {
        const stamp = Number(value);
        date = new Date(stamp * (stamp > 1e12 ? 1 : 1000));
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [year, month, day] = raw.split('-').map(Number);
        date = new Date(year, month - 1, day);
    } else {
        date = new Date(raw);
    }
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(locale || 'en', { day: 'numeric', month: 'short', year: 'numeric' });
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

/** Recently Added must use the show poster, never the episode title card. */
export const withShowPoster = (item: PlayerItem): PlayerItem => {
    if (item.type !== 'episode' && item.type !== 'season') return item;
    const showKey = String(
        (item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey) || '',
    ).replace(/\D/g, '');
    if (!showKey) return { ...item, cardAspect: item.cardAspect || '2/3' };
    return {
        ...item,
        thumb: `/library/metadata/${showKey}/thumb`,
        cardAspect: '2/3',
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
    const episodeThumb = item.episodeThumb
        || (ratingKey ? `/library/metadata/${ratingKey}/thumb` : item.thumb);
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

/** Rail-sized coverArt — same art type as Replex, not a 1920 still on every card. */
export const heroRailCardImageUrl = (source?: string | null) => {
    const value = String(source || '').trim();
    if (!value) return '';
    return directPlexTranscodeUrl(value, 854, 480, 72, { upscale: false }) || value;
};

export const heroRowCardItem = (item: PlayerItem): PlayerItem => ({
    ...item,
    cardAspect: '16/9',
    heroCard: true,
});

export const toPosterCardItem = (item: PlayerItem) => {
    const leafThumb = item.ratingKey ? `/library/metadata/${item.ratingKey}/thumb` : '';
    const showKey = String(
        (item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey) || '',
    ).replace(/\D/g, '');
    const showThumb = showKey ? `/library/metadata/${showKey}/thumb` : '';
    const seasonKey = item.type === 'episode'
        ? String(item.parentRatingKey || '').replace(/\D/g, '')
        : '';
    const seasonThumb = item.preferSeasonPoster && seasonKey
        ? `/library/metadata/${seasonKey}/thumb`
        : '';
    const posterThumb = seasonThumb || showThumb;
    const preferShowPoster = (item.type === 'episode' || item.type === 'season')
        && item.cardAspect !== '16/9'
        && (item.cardAspect === '2/3' || !item.cardAspect)
        && !!posterThumb;
    const thumb = (preferShowPoster ? posterThumb : '') || item.thumb || leafThumb || undefined;
    const remoteThumb = /^https?:\/\//i.test(String(thumb || ''));
    // Episode stills are title cards. Never use them as a poster fallback.
    const movieLeafFallback = item.type !== 'episode' && item.type !== 'season'
        && leafThumb
        && (remoteThumb || (thumb && thumb !== leafThumb));
    const heroOriginal = item.heroCard ? String(item.heroArt || '').trim() : '';
    const posterFallbackUrl = heroOriginal && heroOriginal !== thumb
        ? heroOriginal
        : movieLeafFallback
            ? `/api/plex/image?path=${encodeURIComponent(leafThumb)}&width=${PLAYER_POSTER_WIDTH}&height=${PLAYER_POSTER_HEIGHT}&quality=${PLAYER_POSTER_QUALITY}`
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

export const newPlaySessionId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
            const n = Math.floor(Math.random() * 16);
            const value = char === 'x' ? n : ((n & 0x3) | 0x8);
            return value.toString(16);
        })
);

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

export const nativeDirectPlayEligible = (input: {
    canDirectPlay?: boolean;
    playbackMode?: string;
    qualityId?: string | null;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
    audioTracks?: Array<{ id: string; codec?: string | null }>;
    source?: { audioCodec?: string | null };
}, opts?: {
    qualityId?: string | null;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
}) => {
    if (input.playbackMode === 'directPlay') return true;
    const quality = nativeSafeQualityId(opts?.qualityId ?? input.qualityId);
    if (quality !== 'original' || !input.canDirectPlay) return false;
    const sub = String(opts?.subtitleStreamId ?? input.subtitleStreamId ?? '').replace(/\D/g, '');
    if (sub) return false;
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
 * Bitstream/passthrough codecs. HDMI sinks can take these as encoded audio;
 * if the stick cannot pass them through, ExoPlayer falls back to HLS remux.
 */
const BITSTREAM_NATIVE_AUDIO = /^(truehd|mlp|dca|dts|dtsc|dtsh|dtshd|dtsma|dtsl)$/i;

export const nativeAudioIsDirectPlayable = (codec?: string | null) => {
    const value = String(codec || '').trim().toLowerCase();
    if (!value) return true;
    if (!BITSTREAM_NATIVE_AUDIO.test(value)) return true;
    try {
        const passthrough = window.localStorage?.getItem('portal-media-player-settings');
        if (!passthrough) return true;
        const parsed = JSON.parse(passthrough);
        return parsed?.audioPassthrough !== false;
    } catch {
        return true;
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
    const noSubs = !String(subtitleStreamId || '').replace(/\D/g, '');
    if (directFile && original && noSubs) {
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
