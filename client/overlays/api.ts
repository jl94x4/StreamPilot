const ROOT = '/api/overlays';

const apiFetch = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, {
        credentials: 'include',
        ...init,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || `Request failed (${response.status})`);
    }
    return data;
};

const json = (body: unknown) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
});

export type OverlayPlacementKind = {
    x: number;
    y: number;
    width: number;
    anchorX?: 'left' | 'center' | 'right';
    anchorY?: 'top' | 'center' | 'bottom';
    bottomClip?: number;
    maxHeight?: number;
};

export type OverlaysPlacement = {
    show: OverlayPlacementKind;
    season: OverlayPlacementKind;
    episode: OverlayPlacementKind;
    media?: OverlayPlacementKind;
    status?: OverlayPlacementKind;
    ratings?: OverlayPlacementKind;
    network?: OverlayPlacementKind;
    recently?: OverlayPlacementKind;
    custom_collection?: OverlayPlacementKind;
    // Phase 3 — Kometa-parity families that previously rendered at a fixed,
    // non-adjustable position. Defaults below mirror KOMETA_SLOTS in
    // overlays/kometa_render.py exactly.
    edition?: OverlayPlacementKind;
    audio_codec?: OverlayPlacementKind;
    video_format?: OverlayPlacementKind;
    streaming?: OverlayPlacementKind;
    ribbon?: OverlayPlacementKind;
    aspect?: OverlayPlacementKind;
    versions?: OverlayPlacementKind;
    language_count?: OverlayPlacementKind;
    languages?: OverlayPlacementKind;
    runtimes?: OverlayPlacementKind;
    direct_play?: OverlayPlacementKind;
    content_rating?: OverlayPlacementKind;
    mediastinger?: OverlayPlacementKind;
    episode_info?: OverlayPlacementKind;
};

export type OverlayPlacement = OverlaysPlacement;

export type CustomCollectionOverlayRule = {
    id: string;
    name: string;
    /** Primary / first collection (back-compat mirror of collectionRatingKeys[0]). */
    collectionRatingKey: string;
    collectionTitle?: string;
    /** One or more Plex collection ratingKeys (OR membership across selected libraries). */
    collectionRatingKeys: string[];
    /** ratingKey -> display title for UI. */
    collectionTitles?: Record<string, string>;
    /** Primary / first library (back-compat mirror of libraries[0]). */
    library: string;
    /** One or more Plex library titles — badges only apply inside these libraries. */
    libraries: string[];
    librarySectionId?: string;
    librarySectionIds?: string[];
    image: string;
};

export const DEFAULT_OVERLAY_PLACEMENT: OverlaysPlacement = {
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
    recently: {
        x: 0.5,
        y: 1.0,
        width: 0.72,
        anchorX: 'center',
        anchorY: 'bottom',
        bottomClip: 0.10,
    },
    custom_collection: {
        x: 0.94,
        y: 0.035,
        width: 0.12,
        maxHeight: 0.09,
        anchorX: 'right',
        anchorY: 'top',
        bottomClip: 0,
    },
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

export type MediaInfoParts = {
    res4k?: boolean;
    res1080p?: boolean;
    res720p?: boolean;
    resOther?: boolean;
    hdr?: boolean;
    dolbyVision?: boolean;
    atmos?: boolean;
};

export type OverlaysConfig = {
    enabled?: boolean;
    previewMode?: boolean;
    newSeasonEnabled?: boolean;
    newSeasonDays?: number;
    newSeasonWatchNowStyle?: boolean;
    /** Stamp the latest season poster as well as the show poster. Default true. */
    newSeasonStampSeasonPoster?: boolean;
    newEpisodeEnabled?: boolean;
    newEpisodeDays?: number;
    newEpisodeWatchNowStyle?: boolean;
    skipNewEpisodeOnBinge?: boolean;
    recentlyAddedEnabled?: boolean;
    recentlyAddedDays?: number;
    recentlyAddedPresetId?: string;
    liveScheduleEnabled?: boolean;
    liveScheduleDays?: number;
    top10Enabled?: boolean;
    top10Count?: number;
    tmdbAirDateFallback?: boolean;
    mediaInfoEnabled?: boolean;
    mediaInfoParts?: MediaInfoParts;
    mediaInfoIncludeMovies?: boolean;
    mediaInfoIncludeShows?: boolean;
    mediaInfoLibrarySectionIds?: string[];
    mediaInfoAllowKeys?: string[];
    mediaInfoDenyKeys?: string[];
    editionOverlayEnabled?: boolean;
    audioCodecEnabled?: boolean;
    audioCodecStyle?: 'compact' | 'standard';
    videoFormatEnabled?: boolean;
    kometaAddOverlayLabel?: boolean;
    /** Add Plex “Overlay” label when banner / New Episode stamps apply (default true). */
    bannersAddOverlayLabel?: boolean;
    aspectOverlayEnabled?: boolean;
    versionsOverlayEnabled?: boolean;
    languageCountEnabled?: boolean;
    languagesOverlayEnabled?: boolean;
    languagesAllowCodes?: string[];
    kometaFlagStyle?: 'round' | 'square';
    runtimesOverlayEnabled?: boolean;
    directPlayOverlayEnabled?: boolean;
    episodeInfoOverlayEnabled?: boolean;
    contentRatingEnabled?: boolean;
    contentRatingScheme?: 'us' | 'uk' | 'de' | 'au' | 'nz' | 'commonsense';
    ribbonOverlayEnabled?: boolean;
    ribbonStyle?: 'yellow' | 'red' | 'black' | 'gray';
    ribbonIncludeMovies?: boolean;
    ribbonIncludeShows?: boolean;
    ribbonLibrarySectionIds?: string[];
    ribbonAllowKeys?: string[];
    ribbonDenyKeys?: string[];
    mediastingerOverlayEnabled?: boolean;
    ratingsSource?: string;
    customCollectionOverlaysEnabled?: boolean;
    /** Restamp only linked collection overlay rules when ColleXions updates that collection. */
    restampOnCollexionsUpdate?: boolean;
    customCollectionOverlays?: CustomCollectionOverlayRule[];
    statusOverlayEnabled?: boolean;
    statusAiringDays?: number;
    statusLibrarySectionIds?: string[];
    statusAllowKeys?: string[];
    statusDenyKeys?: string[];
    ratingsOverlayEnabled?: boolean;
    ratingsMinimum?: number;
    ratingsIncludeMovies?: boolean;
    ratingsIncludeShows?: boolean;
    ratingsLibrarySectionIds?: string[];
    ratingsAllowKeys?: string[];
    ratingsDenyKeys?: string[];
    networkOverlayEnabled?: boolean;
    networkLibrarySectionIds?: string[];
    networkAllowKeys?: string[];
    networkDenyKeys?: string[];
    streamingOverlayEnabled?: boolean;
    streamingRegion?: string;
    streamingIncludeMovies?: boolean;
    streamingIncludeShows?: boolean;
    streamingLibrarySectionIds?: string[];
    streamingAllowKeys?: string[];
    streamingDenyKeys?: string[];
    /** Banners (core) run — New Season / Episode / Live / Top 10. Empty = fallback. */
    coreLibrarySectionIds?: string[];
    /** Recently Added run. Empty = fallback. */
    recentlyAddedLibrarySectionIds?: string[];
    /** Media / Layer run default (family-specific lists still override). Empty = fallback. */
    kometaLibrarySectionIds?: string[];
    /** Advanced fallback when a per-run list is empty. Empty = all libraries. */
    librarySectionIds?: string[];
    overlayPresetId?: string;
    episodeOverlayPresetId?: string;
    placement?: OverlaysPlacement;
    scheduleHours?: number;
    recentlyAddedScheduleHours?: number;
    kometaScheduleHours?: number;
    skipIfKometaOverlayLabel?: boolean;
    plexSource?: string;
    lastRunAt?: string | null;
    recentlyAddedLastRunAt?: string | null;
    kometaLastRunAt?: string | null;
    lastRunSummary?: Record<string, unknown> | null;
    coreLastRunSummary?: Record<string, unknown> | null;
    recentlyLastRunSummary?: Record<string, unknown> | null;
    kometaLastRunSummary?: Record<string, unknown> | null;
    collectionsLastRunSummary?: Record<string, unknown> | null;
};

export type OverlayPreset = {
    id: string;
    file?: string;
    source?: 'bundled' | 'custom';
    kind?: 'season' | 'episode' | 'collection';
};

export const overlaysApi = {
    status: () => apiFetch(`${ROOT}/status`),
    getConfig: () => apiFetch(`${ROOT}/config`) as Promise<{ config: OverlaysConfig }>,
    saveConfig: (config: Partial<OverlaysConfig>) => apiFetch(`${ROOT}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    }) as Promise<{ ok: boolean; config: OverlaysConfig }>,
    shows: () => apiFetch(`${ROOT}/shows`),
    episodes: () => apiFetch(`${ROOT}/episodes`),
    kometa: () => apiFetch(`${ROOT}/kometa`) as Promise<{
        ok: boolean;
        items: Array<{
            ratingKey: string;
            title: string;
            library?: string;
            itemType?: string;
            timestamp?: string | null;
            previewOnly?: boolean;
            families?: Record<string, { name?: string; weight?: number }>;
            hasBackup?: boolean;
        }>;
        total: number;
    }>,
    revertKometa: (ratingKey?: string) => apiFetch(`${ROOT}/revert-kometa`, json(ratingKey ? { ratingKey } : {})),
    dropKometaFamily: (opts: { family: string; ruleId?: string; ratingKeys?: string[] }) => (
        apiFetch(`${ROOT}/drop-kometa-family`, json({
            family: opts.family,
            ...(opts.ruleId ? { ruleId: opts.ruleId } : {}),
            ...(opts.ratingKeys?.length ? { ratingKeys: opts.ratingKeys } : {}),
        }))
    ),
    presets: () => apiFetch(`${ROOT}/presets`) as Promise<{ presets: OverlayPreset[] }>,
    uploadPreset: async (kind: 'season' | 'episode' | 'collection', file: File) => {
        const buf = await file.arrayBuffer();
        const response = await fetch(
            `${ROOT}/presets/upload?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name || 'banner')}`,
            {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': file.type || 'application/octet-stream',
                    'X-Overlay-Kind': kind,
                    'X-Overlay-Name': file.name || 'banner',
                },
                body: buf,
            },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || `Upload failed (${response.status})`);
        return data;
    },
    deleteCustomPreset: (id: string) => apiFetch(`${ROOT}/presets/custom/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    sections: () => apiFetch(`${ROOT}/sections`),
    scan: () => apiFetch(`${ROOT}/scan`, json({})),
    reconcile: () => apiFetch(`${ROOT}/reconcile`, json({})),
    run: (options?: {
        preview?: boolean;
        bundle?: 'core' | 'recently' | 'kometa' | 'collections' | 'all';
        scope?: 'media' | 'collections' | 'all';
        onlyRatingKeys?: string[];
        onlyCollectionRatingKeys?: string[];
    }) => apiFetch(`${ROOT}/run`, json(options || {})),
    preview: (options?: {
        bundle?: 'core' | 'recently' | 'kometa' | 'collections' | 'all';
        scope?: 'media' | 'collections' | 'all';
        onlyRatingKeys?: string[];
    }) => apiFetch(`${ROOT}/preview`, json(options || {})),
    promote: () => apiFetch(`${ROOT}/promote`, json({})),
    stop: () => apiFetch(`${ROOT}/stop`, json({})),
    stopAndClearQueue: () => apiFetch(`${ROOT}/stop`, json({ clearQueue: true })),
    clearQueue: () => apiFetch(`${ROOT}/queue`, { method: 'DELETE' }),
    cancelQueuedJob: (jobId: string) => apiFetch(`${ROOT}/queue/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),
    importLog: (log: Record<string, unknown>, mode: 'merge' | 'replace' = 'merge') => (
        apiFetch(`${ROOT}/import-log`, json({ mode, log }))
    ),
    resetOne: (ratingKey: string, kind?: 'show' | 'episode' | 'seasonEpisode' | 'recently' | 'live' | 'top10') => (
        apiFetch(`${ROOT}/reset-one`, json({ ratingKey, kind }))
    ),
    resetAll: (scope: 'all' | 'shows' | 'episodes' = 'all') => apiFetch(`${ROOT}/reset-all`, json({ scope })),
    resetBingeGroup: (ratingKeys: string[]) => apiFetch(`${ROOT}/reset-binge-group`, json({ ratingKeys })),
    previewGallery: () => apiFetch(`${ROOT}/preview-gallery`) as Promise<{ items: Array<{
        name: string;
        kind: string;
        rel: string;
        mtime: number;
        url: string;
    }> }>,
    sampleMeta: () => apiFetch(`${ROOT}/sample/meta`) as Promise<{
        ok: boolean;
        exists: boolean;
        showTitle?: string | null;
        episodeTitle?: string | null;
        showTitleForEp?: string | null;
        generatedAt?: string | null;
        presetId?: string | null;
        showRatingKey?: string | null;
    }>,
    sampleGenerate: (opts?: { showRatingKey?: string; episodeRatingKey?: string }) => (
        apiFetch(`${ROOT}/sample`, json(opts || {})) as Promise<{
            ok: boolean;
            show?: { title?: string; source?: string; ratingKey?: string };
            episode?: { title?: string; showTitle?: string; source?: string };
            generatedAt?: string;
            presetId?: string;
            meta?: Record<string, unknown>;
        }>
    ),
    sampleCandidates: (q = '') => apiFetch(`${ROOT}/sample-candidates?q=${encodeURIComponent(q)}`) as Promise<{
        shows: Array<{ ratingKey: string; title: string; library?: string; type?: string }>;
        items?: Array<{ ratingKey: string; title: string; library?: string; type?: string }>;
    }>,
    sampleImageUrl: (kind: 'show' | 'episode' | 'season' | 'show-base' | 'episode-base', bust?: string | number) => (
        `${ROOT}/sample/${kind}?t=${encodeURIComponent(String(bust || Date.now()))}`
    ),
    presetFileUrl: (id: string, kind: 'season' | 'episode' = 'season', bust?: string | number) => (
        `${ROOT}/preset-file?id=${encodeURIComponent(id)}&kind=${kind}&t=${encodeURIComponent(String(bust || Date.now()))}`
    ),
};
