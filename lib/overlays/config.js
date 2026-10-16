import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import {
    OVERLAYS_DIR,
    OVERLAYS_CONFIG_PATH,
} from '../data-paths.js';

export { OVERLAYS_DIR, OVERLAYS_CONFIG_PATH };
export const OVERLAYS_LOG_PATH = path.join(OVERLAYS_DIR, 'overlaid_log.json');
export const OVERLAYS_EPISODE_LOG_PATH = path.join(OVERLAYS_DIR, 'episode_overlaid_log.json');
export const OVERLAYS_RECENTLY_ADDED_LOG_PATH = path.join(OVERLAYS_DIR, 'recently_added_log.json');
export const OVERLAYS_LIVE_LOG_PATH = path.join(OVERLAYS_DIR, 'live_log.json');
export const OVERLAYS_TOP10_LOG_PATH = path.join(OVERLAYS_DIR, 'top10_log.json');
export const OVERLAYS_KOMETA_LOG_PATH = path.join(OVERLAYS_DIR, 'kometa_overlaid_log.json');
export const OVERLAYS_PREVIEW_DIR = path.join(OVERLAYS_DIR, 'preview');
export const OVERLAYS_BACKUPS_DIR = path.join(OVERLAYS_DIR, 'backups');
export const OVERLAYS_CUSTOM_PRESETS_DIR = path.join(OVERLAYS_DIR, 'presets', 'custom');
export const OVERLAYS_RUN_LOCK_PATH = path.join(OVERLAYS_DIR, 'run-lock.json');

/** Normalized banner placement per art target (fractions of base art size). */
export const DEFAULT_OVERLAY_PLACEMENT = {
    show: {
        x: 0.5,
        y: 1.0,
        width: 0.92,
        anchorX: 'center',
        anchorY: 'bottom',
        bottomClip: 0.10,
    },
    season: {
        x: 0.5,
        y: 1.0,
        width: 0.70,
        maxHeight: 0.14,
        anchorX: 'center',
        anchorY: 'bottom',
        // Match show-poster New Season flush edge (same badge plate shape).
        bottomClip: 0.10,
    },
    episode: {
        x: 0.5,
        y: 1.0,
        width: 0.50,
        maxHeight: 0.18,
        anchorX: 'center',
        anchorY: 'bottom',
        bottomClip: 0.10,
    },
    // Kometa-style defaults (1000×1500 → normalized)
    media: {
        x: 0.015,
        y: 0.01,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'left',
        anchorY: 'top',
        bottomClip: 0,
    },
    status: {
        x: 0.015,
        y: 0.22,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'left',
        anchorY: 'top',
        bottomClip: 0,
    },
    ratings: {
        x: 0.985,
        y: 0.5,
        width: 0.16,
        maxHeight: 0.14,
        anchorX: 'right',
        anchorY: 'center',
        bottomClip: 0,
    },
    network: {
        x: 0.015,
        y: 0.66,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'left',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    // Recently Added show-poster banner (separate from New Season show placement).
    recently: {
        x: 0.5,
        y: 1.0,
        width: 0.72,
        anchorX: 'center',
        anchorY: 'bottom',
        bottomClip: 0.10,
    },
    // Custom collection badge — inset so Plex rounded poster tiles do not clip it.
    custom_collection: {
        x: 0.94,
        y: 0.035,
        width: 0.12,
        maxHeight: 0.09,
        anchorX: 'right',
        anchorY: 'top',
        bottomClip: 0,
    },
    // Phase 3 Layer families — mirrors overlays/kometa_render.py's KOMETA_SLOTS
    // (the authoritative default) and client/overlays/api.ts's DEFAULT_OVERLAY_PLACEMENT.
    edition: {
        x: 0.015,
        y: 0.09,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'left',
        anchorY: 'top',
        bottomClip: 0,
    },
    audio_codec: {
        x: 0.5,
        y: 0.01,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'center',
        anchorY: 'top',
        bottomClip: 0,
    },
    video_format: {
        x: 0.015,
        y: 0.98,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'left',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    streaming: {
        x: 0.015,
        y: 0.74,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'left',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    ribbon: {
        x: 1.0,
        y: 1.0,
        width: 0.25,
        maxHeight: 0.25,
        anchorX: 'right',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    aspect: {
        x: 0.5,
        y: 0.90,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'center',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    versions: {
        x: 0.985,
        y: 0.223,
        width: 0.105,
        maxHeight: 0.07,
        anchorX: 'right',
        anchorY: 'top',
        bottomClip: 0,
    },
    language_count: {
        x: 0.5,
        y: 0.98,
        width: 0.188,
        maxHeight: 0.07,
        anchorX: 'center',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    languages: {
        x: 0.015,
        y: 0.30,
        width: 0.09,
        maxHeight: 0.28,
        anchorX: 'left',
        anchorY: 'top',
        bottomClip: 0,
    },
    runtimes: {
        x: 0.985,
        y: 0.98,
        width: 0.45,
        maxHeight: 0.07,
        anchorX: 'right',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    direct_play: {
        x: 0.5,
        y: 0.90,
        width: 0.305,
        maxHeight: 0.113,
        anchorX: 'center',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    content_rating: {
        x: 0.015,
        y: 0.82,
        width: 0.305,
        maxHeight: 0.07,
        anchorX: 'left',
        anchorY: 'bottom',
        bottomClip: 0,
    },
    mediastinger: {
        x: 0.80,
        y: 0.01,
        width: 0.105,
        maxHeight: 0.07,
        anchorX: 'right',
        anchorY: 'top',
        bottomClip: 0,
    },
    episode_info: {
        x: 0.015,
        y: 0.02,
        width: 0.305,
        maxHeight: 0.12,
        anchorX: 'left',
        anchorY: 'top',
        bottomClip: 0,
    },
};

export const DEFAULT_OVERLAYS_CONFIG = {
    enabled: true,
    previewMode: false,
    newSeasonEnabled: true,
    newSeasonDays: 21,
    newSeasonWatchNowStyle: false,
    newSeasonStampSeasonPoster: true,
    newEpisodeEnabled: true,
    newEpisodeDays: 6,
    newEpisodeWatchNowStyle: false,
    skipNewEpisodeOnBinge: true,
    recentlyAddedEnabled: false,
    recentlyAddedDays: 7,
    recentlyAddedPresetId: 'recently-added',
    liveScheduleEnabled: false,
    liveScheduleDays: 1,
    top10Enabled: false,
    top10Count: 10,
    tmdbAirDateFallback: true,
    mediaInfoEnabled: false,
    mediaInfoParts: {
        res4k: true,
        res1080p: true,
        res720p: true,
        resOther: false,
        hdr: true,
        dolbyVision: true,
        atmos: true,
    },
    mediaInfoIncludeMovies: true,
    mediaInfoIncludeShows: true,
    mediaInfoLibrarySectionIds: [],
    mediaInfoAllowKeys: [],
    mediaInfoDenyKeys: [],
    editionOverlayEnabled: false,
    audioCodecEnabled: false,
    audioCodecStyle: 'compact',
    videoFormatEnabled: false,
    kometaAddOverlayLabel: false,
    bannersAddOverlayLabel: true,
    statusOverlayEnabled: false,
    statusAiringDays: 14,
    statusLibrarySectionIds: [],
    statusAllowKeys: [],
    statusDenyKeys: [],
    ratingsOverlayEnabled: false,
    ratingsMinimum: 0,
    ratingsIncludeMovies: true,
    ratingsIncludeShows: true,
    ratingsLibrarySectionIds: [],
    ratingsAllowKeys: [],
    ratingsDenyKeys: [],
    networkOverlayEnabled: false,
    networkLibrarySectionIds: [],
    networkAllowKeys: [],
    networkDenyKeys: [],
    streamingOverlayEnabled: false,
    streamingRegion: 'US',
    streamingIncludeMovies: true,
    streamingIncludeShows: true,
    streamingLibrarySectionIds: [],
    streamingAllowKeys: [],
    streamingDenyKeys: [],
    aspectOverlayEnabled: false,
    versionsOverlayEnabled: false,
    languageCountEnabled: false,
    languagesOverlayEnabled: false,
    languagesAllowCodes: [],
    kometaFlagStyle: 'round',
    runtimesOverlayEnabled: false,
    directPlayOverlayEnabled: false,
    episodeInfoOverlayEnabled: false,
    contentRatingEnabled: false,
    contentRatingScheme: 'us',
    ribbonOverlayEnabled: false,
    ribbonStyle: 'yellow',
    ribbonIncludeMovies: true,
    ribbonIncludeShows: true,
    ribbonLibrarySectionIds: [],
    ribbonAllowKeys: [],
    ribbonDenyKeys: [],
    mediastingerOverlayEnabled: false,
    ratingsSource: 'tmdb',
    customCollectionOverlaysEnabled: false,
    /** When ColleXions updates a linked Plex collection, restamp only that overlay rule. */
    restampOnCollexionsUpdate: false,
    customCollectionOverlays: [],
    /** Per-run library scopes (empty = fall back to librarySectionIds / Advanced, then all). */
    coreLibrarySectionIds: [],
    recentlyAddedLibrarySectionIds: [],
    kometaLibrarySectionIds: [],
    /** Advanced default libraries — used when a per-run list is empty. */
    librarySectionIds: [],
    overlayPresetId: 'new-season',
    episodeOverlayPresetId: 'new-episode',
    placement: DEFAULT_OVERLAY_PLACEMENT,
    scheduleHours: 24,
    recentlyAddedScheduleHours: 24,
    kometaScheduleHours: 24,
    skipIfKometaOverlayLabel: true,
    plexSource: 'portal',
    lastRunAt: null,
    recentlyAddedLastRunAt: null,
    kometaLastRunAt: null,
    lastRunSummary: null,
    coreLastRunSummary: null,
    recentlyLastRunSummary: null,
    kometaLastRunSummary: null,
    collectionsLastRunSummary: null,
};

export const ensureOverlaysDir = async () => {
    await fs.mkdir(OVERLAYS_DIR, { recursive: true });
    await fs.mkdir(OVERLAYS_PREVIEW_DIR, { recursive: true });
    await fs.mkdir(OVERLAYS_BACKUPS_DIR, { recursive: true });
    await fs.mkdir(OVERLAYS_CUSTOM_PRESETS_DIR, { recursive: true });
};

const asStringList = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
        return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
};

const DEFAULT_MEDIA_INFO_PARTS = {
    res4k: true,
    res1080p: true,
    res720p: true,
    resOther: false,
    hdr: true,
    dolbyVision: true,
    atmos: true,
};

const normalizeMediaInfoParts = (input = {}) => {
    const raw = input && typeof input === 'object' ? input : {};
    const out = { ...DEFAULT_MEDIA_INFO_PARTS };
    for (const key of Object.keys(DEFAULT_MEDIA_INFO_PARTS)) {
        const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (raw[key] !== undefined) out[key] = Boolean(raw[key]);
        else if (raw[snake] !== undefined) out[key] = Boolean(raw[snake]);
    }
    return out;
};

export const isCollectionPresetId = (id) => {
    const name = String(id || '').toLowerCase();
    return name.startsWith('collection-')
        || name.startsWith('collection_')
        || name.startsWith('custom-collection');
};

const inferPresetKind = (id, source) => {
    const name = String(id || '').toLowerCase();
    if (source === 'custom') {
        if (isCollectionPresetId(name)) return 'collection';
        if (name.startsWith('episode-') || name.startsWith('episode_')) return 'episode';
        if (name.startsWith('season-') || name.startsWith('season_')) return 'season';
    }
    if (isCollectionPresetId(name)) return 'collection';
    if (name.startsWith('new-episode') || name.includes('episode')) return 'episode';
    return 'season';
};

/** Assets driven by mode toggles — hide from New Season / New Episode preset pickers. */
const isModeOnlyPresetId = (id) => {
    const name = String(id || '').toLowerCase();
    // recently-added stays pickable on the Recently Added card; hide elsewhere.
    if (name === 'top-10') return true;
    if (name.startsWith('live-')) return true;
    if (name.startsWith('placement-')) return true;
    if (name.endsWith('-watch-now') || name.includes('watch-now')) return true;
    return false;
};

/** Hide from the New Season / New Episode pickers only (still listed for Recently Added). */
export const isNewSeasonPickerExcludedPresetId = (id) => {
    const name = String(id || '').toLowerCase();
    return name === 'recently-added'
        || isCollectionPresetId(name)
        || isModeOnlyPresetId(name);
};

const clamp01 = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
};

const clampWidth = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0.05, Math.min(1, n));
};

const normalizeAnchor = (value, axis, fallback) => {
    const v = String(value || '').trim().toLowerCase();
    if (axis === 'x') {
        if (v === 'left' || v === 'center' || v === 'right') return v;
    } else if (v === 'top' || v === 'center' || v === 'bottom') {
        return v;
    }
    return fallback;
};

export const normalizePlacementKind = (input = {}, fallback = {}) => {
    const raw = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const out = {
        x: clamp01(raw.x ?? base.x, 0.5),
        y: clamp01(raw.y ?? base.y, 1),
        width: clampWidth(raw.width ?? base.width, 0.92),
        anchorX: normalizeAnchor(raw.anchorX ?? raw.anchor_x ?? base.anchorX, 'x', 'center'),
        anchorY: normalizeAnchor(raw.anchorY ?? raw.anchor_y ?? base.anchorY, 'y', 'bottom'),
        bottomClip: clamp01(
            raw.bottomClip ?? raw.bottom_clip ?? base.bottomClip,
            Number.isFinite(Number(base.bottomClip)) ? Number(base.bottomClip) : 0.10,
        ),
    };
    const maxH = raw.maxHeight ?? raw.max_height ?? base.maxHeight;
    if (maxH !== undefined && maxH !== null && maxH !== '') {
        const n = Number(maxH);
        if (Number.isFinite(n)) out.maxHeight = Math.max(0.05, Math.min(1, n));
    } else if (typeof base.maxHeight === 'number') {
        out.maxHeight = base.maxHeight;
    }
    return out;
};

const normalizeCustomCollectionRule = (raw = {}) => {
    const row = raw && typeof raw === 'object' ? raw : {};
    const singularKey = String(row.collectionRatingKey || row.collection_rating_key || '').trim();
    const rawKeys = row.collectionRatingKeys ?? row.collection_rating_keys;
    const keyList = [];
    const seenKeys = new Set();
    if (Array.isArray(rawKeys)) {
        for (const item of rawKeys) {
            const key = String(item || '').trim();
            if (!key || seenKeys.has(key)) continue;
            seenKeys.add(key);
            keyList.push(key);
        }
    }
    if (singularKey && !seenKeys.has(singularKey)) {
        keyList.unshift(singularKey);
        seenKeys.add(singularKey);
    }
    const collectionRatingKey = keyList[0] || '';
    const id = String(row.id || '').trim()
        || `rule-${collectionRatingKey || String(Date.now()).trim() || 'x'}`;
    const image = String(row.image || row.presetId || row.preset_id || '').trim();

    const libraries = [];
    const seenLibs = new Set();
    const rawLibs = row.libraries ?? row.libraryTitles ?? row.library_titles;
    if (Array.isArray(rawLibs)) {
        for (const item of rawLibs) {
            const lib = String(item || '').trim();
            if (!lib) continue;
            const key = lib.toLowerCase();
            if (seenLibs.has(key)) continue;
            seenLibs.add(key);
            libraries.push(lib);
        }
    }
    const singularLibrary = String(row.library || row.libraryTitle || row.library_title || '').trim();
    if (singularLibrary && !seenLibs.has(singularLibrary.toLowerCase())) {
        libraries.unshift(singularLibrary);
        seenLibs.add(singularLibrary.toLowerCase());
    }
    const library = libraries[0] || '';

    const librarySectionIds = [];
    const seenSids = new Set();
    const rawSids = row.librarySectionIds ?? row.library_section_ids;
    if (Array.isArray(rawSids)) {
        for (const item of rawSids) {
            const sid = String(item || '').trim();
            if (!sid || seenSids.has(sid)) continue;
            seenSids.add(sid);
            librarySectionIds.push(sid);
        }
    }
    const singularSid = String(
        row.librarySectionId || row.library_section_id || row.sectionId || row.section_id || '',
    ).trim();
    if (singularSid && !seenSids.has(singularSid)) {
        librarySectionIds.unshift(singularSid);
        seenSids.add(singularSid);
    }
    const librarySectionId = librarySectionIds[0] || '';

    const singularTitle = String(row.collectionTitle || row.collection_title || '').trim();
    const collectionTitles = {};
    const rawTitles = row.collectionTitles || row.collection_titles;
    if (rawTitles && typeof rawTitles === 'object' && !Array.isArray(rawTitles)) {
        for (const [k, v] of Object.entries(rawTitles)) {
            const key = String(k || '').trim();
            const title = String(v || '').trim();
            if (key && title) collectionTitles[key] = title;
        }
    }
    if (collectionRatingKey && singularTitle && !collectionTitles[collectionRatingKey]) {
        collectionTitles[collectionRatingKey] = singularTitle;
    }
    return {
        id,
        name: String(row.name || row.title || '').trim() || id,
        collectionRatingKey,
        collectionTitle: collectionTitles[collectionRatingKey] || singularTitle,
        collectionRatingKeys: keyList,
        collectionTitles,
        library,
        libraries,
        librarySectionId,
        librarySectionIds,
        image,
    };
};

export const normalizeCustomCollectionOverlays = (input) => {
    if (!Array.isArray(input)) return [];
    const out = [];
    const seen = new Set();
    for (const row of input) {
        const rule = normalizeCustomCollectionRule(row);
        // At least one library is required — never stamp without an explicit Plex library scope.
        if (!rule.collectionRatingKeys.length || !rule.image || !rule.libraries.length) continue;
        if (seen.has(rule.id)) continue;
        seen.add(rule.id);
        out.push(rule);
    }
    return out;
};

export const normalizeOverlaysPlacement = (input = {}) => {
    const raw = input && typeof input === 'object' ? input : {};
    const keys = [
        'show', 'season', 'episode', 'media', 'status', 'ratings', 'network', 'recently', 'custom_collection',
        'edition', 'audio_codec', 'video_format', 'streaming', 'ribbon', 'aspect', 'versions',
        'language_count', 'languages', 'runtimes', 'direct_play', 'content_rating', 'mediastinger', 'episode_info',
    ];
    const out = {};
    for (const key of keys) {
        const fallbackKey = key === 'recently' && !raw[key] && raw.recentlyAdded
            ? 'recentlyAdded'
            : key;
        out[key] = normalizePlacementKind(raw[fallbackKey] || raw[key], DEFAULT_OVERLAY_PLACEMENT[key]);
    }
    return out;
};

export const normalizeOverlaysConfig = (input = {}) => {
    const raw = input && typeof input === 'object' ? input : {};
    const days = Number(raw.newSeasonDays ?? raw.new_season_days);
    const episodeDays = Number(raw.newEpisodeDays ?? raw.new_episode_days);
    const recentlyDays = Number(raw.recentlyAddedDays ?? raw.recently_added_days);
    const liveDays = Number(raw.liveScheduleDays ?? raw.live_schedule_days);
    const top10Count = Number(raw.top10Count ?? raw.top10_count);
    const scheduleHours = Number(raw.scheduleHours ?? raw.schedule_hours);
    const bool = (camel, snake, defaultValue) => {
        if (raw[camel] === undefined && raw[snake] === undefined) return defaultValue;
        return Boolean(raw[camel] ?? raw[snake]);
    };
    const legacyLibraryIds = asStringList(raw.librarySectionIds ?? raw.library_section_ids);
    const hasKey = (camel, snake) => raw[camel] !== undefined || raw[snake] !== undefined;
    // One-time seed: older configs only had librarySectionIds. Copy into each
    // per-run scope so existing library picks keep working until the user edits them.
    const seedOrList = (camel, snake) => (
        hasKey(camel, snake)
            ? asStringList(raw[camel] ?? raw[snake])
            : [...legacyLibraryIds]
    );
    return {
        enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
        previewMode: raw.previewMode === undefined
            ? Boolean(raw.preview_mode)
            : Boolean(raw.previewMode),
        newSeasonEnabled: bool('newSeasonEnabled', 'new_season_enabled', true),
        newSeasonDays: Number.isFinite(days) ? Math.max(1, Math.min(365, Math.round(days))) : 21,
        newSeasonWatchNowStyle: bool('newSeasonWatchNowStyle', 'new_season_watch_now_style', false),
        newSeasonStampSeasonPoster: bool('newSeasonStampSeasonPoster', 'new_season_stamp_season_poster', true),
        newEpisodeEnabled: bool('newEpisodeEnabled', 'new_episode_enabled', true),
        newEpisodeDays: Number.isFinite(episodeDays)
            ? Math.max(1, Math.min(30, Math.round(episodeDays)))
            : 6,
        newEpisodeWatchNowStyle: bool('newEpisodeWatchNowStyle', 'new_episode_watch_now_style', false),
        skipNewEpisodeOnBinge: bool('skipNewEpisodeOnBinge', 'skip_new_episode_on_binge', true),
        recentlyAddedEnabled: bool('recentlyAddedEnabled', 'recently_added_enabled', false),
        recentlyAddedDays: Number.isFinite(recentlyDays)
            ? Math.max(1, Math.min(90, Math.round(recentlyDays)))
            : 7,
        liveScheduleEnabled: bool('liveScheduleEnabled', 'live_schedule_enabled', false),
        liveScheduleDays: Number.isFinite(liveDays)
            ? Math.max(0, Math.min(14, Math.round(liveDays)))
            : 1,
        top10Enabled: bool('top10Enabled', 'top10_enabled', false),
        top10Count: Number.isFinite(top10Count)
            ? Math.max(1, Math.min(50, Math.round(top10Count)))
            : 10,
        tmdbAirDateFallback: bool('tmdbAirDateFallback', 'tmdb_air_date_fallback', true),
        mediaInfoEnabled: bool('mediaInfoEnabled', 'media_info_enabled', false),
        mediaInfoParts: normalizeMediaInfoParts(raw.mediaInfoParts ?? raw.media_info_parts),
        mediaInfoIncludeMovies: bool('mediaInfoIncludeMovies', 'media_info_include_movies', true),
        mediaInfoIncludeShows: bool('mediaInfoIncludeShows', 'media_info_include_shows', true),
        mediaInfoLibrarySectionIds: asStringList(
            raw.mediaInfoLibrarySectionIds ?? raw.media_info_library_section_ids,
        ),
        mediaInfoAllowKeys: asStringList(raw.mediaInfoAllowKeys ?? raw.media_info_allow_keys),
        mediaInfoDenyKeys: asStringList(raw.mediaInfoDenyKeys ?? raw.media_info_deny_keys),
        editionOverlayEnabled: bool('editionOverlayEnabled', 'edition_overlay_enabled', false),
        audioCodecEnabled: bool('audioCodecEnabled', 'audio_codec_enabled', false),
        audioCodecStyle: ['compact', 'standard'].includes(String(raw.audioCodecStyle ?? raw.audio_codec_style ?? '').trim().toLowerCase())
            ? String(raw.audioCodecStyle ?? raw.audio_codec_style).trim().toLowerCase()
            : 'compact',
        videoFormatEnabled: bool('videoFormatEnabled', 'video_format_enabled', false),
        kometaAddOverlayLabel: bool('kometaAddOverlayLabel', 'kometa_add_overlay_label', false),
        bannersAddOverlayLabel: bool('bannersAddOverlayLabel', 'banners_add_overlay_label', true),
        statusOverlayEnabled: bool('statusOverlayEnabled', 'status_overlay_enabled', false),
        statusAiringDays: (() => {
            const n = Number(raw.statusAiringDays ?? raw.status_airing_days);
            return Number.isFinite(n) ? Math.max(1, Math.min(90, Math.round(n))) : 14;
        })(),
        statusLibrarySectionIds: asStringList(
            raw.statusLibrarySectionIds ?? raw.status_library_section_ids,
        ),
        statusAllowKeys: asStringList(raw.statusAllowKeys ?? raw.status_allow_keys),
        statusDenyKeys: asStringList(raw.statusDenyKeys ?? raw.status_deny_keys),
        ratingsOverlayEnabled: bool('ratingsOverlayEnabled', 'ratings_overlay_enabled', false),
        ratingsMinimum: (() => {
            const n = Number(raw.ratingsMinimum ?? raw.ratings_minimum);
            return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
        })(),
        ratingsIncludeMovies: bool('ratingsIncludeMovies', 'ratings_include_movies', true),
        ratingsIncludeShows: bool('ratingsIncludeShows', 'ratings_include_shows', true),
        ratingsLibrarySectionIds: asStringList(
            raw.ratingsLibrarySectionIds ?? raw.ratings_library_section_ids,
        ),
        ratingsAllowKeys: asStringList(raw.ratingsAllowKeys ?? raw.ratings_allow_keys),
        ratingsDenyKeys: asStringList(raw.ratingsDenyKeys ?? raw.ratings_deny_keys),
        networkOverlayEnabled: bool('networkOverlayEnabled', 'network_overlay_enabled', false),
        networkLibrarySectionIds: asStringList(
            raw.networkLibrarySectionIds ?? raw.network_library_section_ids,
        ),
        networkAllowKeys: asStringList(raw.networkAllowKeys ?? raw.network_allow_keys),
        networkDenyKeys: asStringList(raw.networkDenyKeys ?? raw.network_deny_keys),
        streamingOverlayEnabled: bool('streamingOverlayEnabled', 'streaming_overlay_enabled', false),
        streamingRegion: (() => {
            const v = String(raw.streamingRegion ?? raw.streaming_region ?? 'US').trim().toUpperCase();
            return /^[A-Z]{2}$/.test(v) ? v : 'US';
        })(),
        streamingIncludeMovies: bool('streamingIncludeMovies', 'streaming_include_movies', true),
        streamingIncludeShows: bool('streamingIncludeShows', 'streaming_include_shows', true),
        streamingLibrarySectionIds: asStringList(
            raw.streamingLibrarySectionIds ?? raw.streaming_library_section_ids,
        ),
        streamingAllowKeys: asStringList(raw.streamingAllowKeys ?? raw.streaming_allow_keys),
        streamingDenyKeys: asStringList(raw.streamingDenyKeys ?? raw.streaming_deny_keys),
        aspectOverlayEnabled: bool('aspectOverlayEnabled', 'aspect_overlay_enabled', false),
        versionsOverlayEnabled: bool('versionsOverlayEnabled', 'versions_overlay_enabled', false),
        languageCountEnabled: bool('languageCountEnabled', 'language_count_enabled', false),
        languagesOverlayEnabled: bool('languagesOverlayEnabled', 'languages_overlay_enabled', false),
        languagesAllowCodes: asStringList(raw.languagesAllowCodes ?? raw.languages_allow_codes),
        kometaFlagStyle: ['round', 'square'].includes(String(raw.kometaFlagStyle ?? raw.kometa_flag_style ?? '').trim().toLowerCase())
            ? String(raw.kometaFlagStyle ?? raw.kometa_flag_style).trim().toLowerCase()
            : 'round',
        runtimesOverlayEnabled: bool('runtimesOverlayEnabled', 'runtimes_overlay_enabled', false),
        directPlayOverlayEnabled: bool('directPlayOverlayEnabled', 'direct_play_overlay_enabled', false),
        episodeInfoOverlayEnabled: bool('episodeInfoOverlayEnabled', 'episode_info_overlay_enabled', false),
        contentRatingEnabled: bool('contentRatingEnabled', 'content_rating_enabled', false),
        contentRatingScheme: (() => {
            const v = String(raw.contentRatingScheme ?? raw.content_rating_scheme ?? 'us').trim().toLowerCase();
            return ['us', 'uk', 'de', 'au', 'nz', 'commonsense'].includes(v) ? v : 'us';
        })(),
        ribbonOverlayEnabled: bool('ribbonOverlayEnabled', 'ribbon_overlay_enabled', false),
        ribbonStyle: (() => {
            const v = String(raw.ribbonStyle ?? raw.ribbon_style ?? 'yellow').trim().toLowerCase();
            return ['yellow', 'red', 'black', 'gray'].includes(v) ? v : 'yellow';
        })(),
        ribbonIncludeMovies: bool('ribbonIncludeMovies', 'ribbon_include_movies', true),
        ribbonIncludeShows: bool('ribbonIncludeShows', 'ribbon_include_shows', true),
        ribbonLibrarySectionIds: asStringList(raw.ribbonLibrarySectionIds ?? raw.ribbon_library_section_ids),
        ribbonAllowKeys: asStringList(raw.ribbonAllowKeys ?? raw.ribbon_allow_keys),
        ribbonDenyKeys: asStringList(raw.ribbonDenyKeys ?? raw.ribbon_deny_keys),
        mediastingerOverlayEnabled: bool('mediastingerOverlayEnabled', 'mediastinger_overlay_enabled', false),
        ratingsSource: (() => {
            const v = String(raw.ratingsSource ?? raw.ratings_source ?? 'tmdb').trim().toLowerCase();
            return ['tmdb', 'audience', 'critic', 'user', 'imdb', 'rt'].includes(v) ? v : 'tmdb';
        })(),
        customCollectionOverlaysEnabled: bool(
            'customCollectionOverlaysEnabled',
            'custom_collection_overlays_enabled',
            false,
        ),
        restampOnCollexionsUpdate: bool(
            'restampOnCollexionsUpdate',
            'restamp_on_collexions_update',
            false,
        ),
        customCollectionOverlays: normalizeCustomCollectionOverlays(
            raw.customCollectionOverlays ?? raw.custom_collection_overlays,
        ),
        coreLibrarySectionIds: seedOrList('coreLibrarySectionIds', 'core_library_section_ids'),
        recentlyAddedLibrarySectionIds: seedOrList(
            'recentlyAddedLibrarySectionIds',
            'recently_added_library_section_ids',
        ),
        kometaLibrarySectionIds: seedOrList('kometaLibrarySectionIds', 'kometa_library_section_ids'),
        librarySectionIds: legacyLibraryIds,
        overlayPresetId: String(raw.overlayPresetId || raw.overlay_preset_id || 'new-season').trim() || 'new-season',
        episodeOverlayPresetId: String(
            raw.episodeOverlayPresetId || raw.episode_overlay_preset_id || 'new-episode',
        ).trim() || 'new-episode',
        recentlyAddedPresetId: String(
            raw.recentlyAddedPresetId || raw.recently_added_preset_id || 'recently-added',
        ).trim() || 'recently-added',
        placement: normalizeOverlaysPlacement(raw.placement || DEFAULT_OVERLAY_PLACEMENT),
        scheduleHours: Number.isFinite(scheduleHours)
            ? Math.max(0, Math.min(168, Math.round(scheduleHours)))
            : 24,
        recentlyAddedScheduleHours: (() => {
            const n = Number(raw.recentlyAddedScheduleHours ?? raw.recently_added_schedule_hours);
            return Number.isFinite(n) ? Math.max(0, Math.min(168, Math.round(n))) : 24;
        })(),
        kometaScheduleHours: (() => {
            const n = Number(raw.kometaScheduleHours ?? raw.kometa_schedule_hours);
            return Number.isFinite(n) ? Math.max(0, Math.min(168, Math.round(n))) : 24;
        })(),
        skipIfKometaOverlayLabel: bool('skipIfKometaOverlayLabel', 'skip_if_kometa_overlay_label', true),
        plexSource: String(raw.plexSource || raw.plex_source || 'portal').trim() || 'portal',
        lastRunAt: raw.lastRunAt || raw.last_run_at || null,
        recentlyAddedLastRunAt: raw.recentlyAddedLastRunAt || raw.recently_added_last_run_at || null,
        kometaLastRunAt: raw.kometaLastRunAt || raw.kometa_last_run_at || null,
        lastRunSummary: raw.lastRunSummary || raw.last_run_summary || null,
        coreLastRunSummary: raw.coreLastRunSummary || raw.core_last_run_summary || null,
        recentlyLastRunSummary: raw.recentlyLastRunSummary || raw.recently_last_run_summary || null,
        kometaLastRunSummary: raw.kometaLastRunSummary || raw.kometa_last_run_summary || null,
        collectionsLastRunSummary: raw.collectionsLastRunSummary || raw.collections_last_run_summary || null,
    };
};

export const loadOverlaysConfig = async () => {
    await ensureOverlaysDir();
    try {
        const raw = await fs.readFile(OVERLAYS_CONFIG_PATH, 'utf8');
        return normalizeOverlaysConfig(JSON.parse(raw));
    } catch (error) {
        if (error?.code === 'ENOENT') return normalizeOverlaysConfig(DEFAULT_OVERLAYS_CONFIG);
        throw error;
    }
};

export const saveOverlaysConfig = async (input = {}) => {
    const existing = await loadOverlaysConfig();
    const patch = input && typeof input === 'object' ? input : {};
    const merged = { ...existing, ...patch };
    if (patch.placement && typeof patch.placement === 'object') {
        const prev = existing.placement || DEFAULT_OVERLAY_PLACEMENT;
        const keys = [
            'show', 'season', 'episode', 'media', 'status', 'ratings', 'network', 'recently', 'custom_collection',
            'edition', 'audio_codec', 'video_format', 'streaming', 'ribbon', 'aspect', 'versions',
            'language_count', 'languages', 'runtimes', 'direct_play', 'content_rating', 'mediastinger', 'episode_info',
        ];
        merged.placement = {};
        for (const key of keys) {
            const patchKey = key === 'recently'
                ? (patch.placement.recently || patch.placement.recentlyAdded)
                : patch.placement[key];
            merged.placement[key] = { ...(prev[key] || {}), ...(patchKey || {}) };
        }
    }
    const next = normalizeOverlaysConfig(merged);
    await ensureOverlaysDir();
    await fs.writeFile(OVERLAYS_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
};

export const loadOverlaysLog = async () => {
    await ensureOverlaysDir();
    try {
        const raw = await fs.readFile(OVERLAYS_LOG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        if (error?.code === 'ENOENT') return {};
        throw error;
    }
};

export const loadOverlaysEpisodeLog = async () => {
    await ensureOverlaysDir();
    try {
        const raw = await fs.readFile(OVERLAYS_EPISODE_LOG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        if (error?.code === 'ENOENT') return {};
        throw error;
    }
};

export const saveOverlaysLog = async (log = {}) => {
    await ensureOverlaysDir();
    const data = log && typeof log === 'object' && !Array.isArray(log) ? log : {};
    await fs.writeFile(OVERLAYS_LOG_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return data;
};

const readPresetDir = async (dir, source) => {
    try {
        const names = await fs.readdir(dir);
        return names
            .filter((name) => /\.png$/i.test(name))
            .map((name) => {
                const id = name.replace(/\.png$/i, '');
                return {
                    id,
                    file: name,
                    source,
                    kind: inferPresetKind(id, source),
                    path: path.join(dir, name),
                };
            });
    } catch {
        return [];
    }
};

export const listOverlayPresets = async (assetsDir, customDir = OVERLAYS_CUSTOM_PRESETS_DIR) => {
    const bundled = await readPresetDir(assetsDir, 'bundled');
    const custom = await readPresetDir(customDir, 'custom');
    const byId = new Map();
    for (const preset of [...bundled, ...custom]) {
        if (preset.source === 'bundled' && isModeOnlyPresetId(preset.id)) continue;
        byId.set(`${preset.source}:${preset.id}`, preset);
    }
    const presets = [...byId.values()];
    presets.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'season' ? -1 : 1;
        if (a.source !== b.source) return a.source === 'bundled' ? -1 : 1;
        return a.id.localeCompare(b.id);
    });
    if (!presets.some((p) => p.kind === 'season')) {
        presets.push({ id: 'new-season', file: 'new-season.png', source: 'bundled', kind: 'season' });
    }
    if (!presets.some((p) => p.kind === 'episode')) {
        presets.push({ id: 'new-episode', file: 'new-episode.png', source: 'bundled', kind: 'episode' });
    }
    return presets;
};

export const resolveOverlayPresetPath = (presetId, kind, assetsDir, customDir = OVERLAYS_CUSTOM_PRESETS_DIR) => {
    const id = String(presetId || '').trim()
        || (kind === 'episode' ? 'new-episode' : 'new-season');
    const customPath = path.join(customDir, `${id}.png`);
    if (fsSync.existsSync(customPath)) return customPath;
    const bundledPath = path.join(assetsDir, `${id}.png`);
    if (fsSync.existsSync(bundledPath)) return bundledPath;
    return path.join(assetsDir, kind === 'episode' ? 'new-episode.png' : 'new-season.png');
};

export const sanitizePresetUploadName = (kind, originalName = '') => {
    const base = String(originalName || 'banner')
        .replace(/\.png$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'banner';
    const k = String(kind || 'season').toLowerCase();
    const prefix = k === 'episode' ? 'episode' : k === 'collection' ? 'collection' : 'season';
    return `${prefix}-${base}`;
};

/** Next free custom-collection1, custom-collection2, … (ignores upload filename). */
export const allocateUniqueCollectionPresetId = (customDir = OVERLAYS_CUSTOM_PRESETS_DIR) => {
    let n = 1;
    while (n <= 10000) {
        const id = `custom-collection${n}`;
        if (!fsSync.existsSync(path.join(customDir, `${id}.png`))) return id;
        n += 1;
    }
    throw new Error('Too many collection badge presets');
};

export const listPreviewGallery = async (previewDir = OVERLAYS_PREVIEW_DIR, limit = 100) => {
    const items = [];

    const classify = (name, walkKind) => {
        const n = String(name || '').toLowerCase();
        // Placement / Advanced visual-sample outputs — not Preview-run gallery art.
        if (n.endsWith('-base.png') || n.includes('-base.')) return null;
        if (walkKind === 'sample') return null;
        if (n === 'show.png' || n === 'season.png' || n === 'episode.png') return null;
        if (walkKind === 'episode') return 'episode';
        if (n.includes('_season_ne') || n.includes('season_ne') || /(^|[_-])season([_-]|\.png$)/.test(n)) {
            return 'season';
        }
        if (n.includes('episode')) return 'episode';
        if (n.includes('_show') || n.endsWith('-show.png') || walkKind === 'show') return 'show';
        return 'show';
    };

    const walk = async (dir, walkKind) => {
        let names = [];
        try {
            names = await fs.readdir(dir);
        } catch {
            return;
        }
        for (const name of names) {
            if (!/\.png$/i.test(name)) continue;
            if (name.startsWith('temp_')) continue;
            const kind = classify(name, walkKind);
            if (!kind) continue;
            const full = path.join(dir, name);
            try {
                const st = await fs.stat(full);
                if (!st.isFile()) continue;
                // Skip empty / truncated writes that browsers refuse to paint.
                if (st.size < 64) continue;
                const rel = path.relative(previewDir, full).replace(/\\/g, '/');
                items.push({
                    name,
                    kind,
                    rel,
                    mtime: st.mtimeMs,
                    size: st.size,
                    url: `/api/overlays/preview-file?path=${encodeURIComponent(rel)}`,
                });
            } catch {
                /* skip */
            }
        }
    };
    await walk(previewDir, 'show');
    await walk(path.join(previewDir, 'episodes'), 'episode');
    // Intentionally skip preview/samples/ — those are Placement editor canvases.
    items.sort((a, b) => b.mtime - a.mtime);
    return items.slice(0, Math.max(1, Math.min(200, limit)));
};
