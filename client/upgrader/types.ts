export type UpgraderCodec = 'h264' | 'hevc' | 'av1' | 'vp9';
export type UpgraderResolution = 'sd' | '720p' | '1080p' | '4k';
export type UpgraderFeature = 'non_hevc' | 'hdr' | 'dolby_vision' | 'large' | 'zero_size';
export type UpgraderQuality = 'webdl' | 'webrip' | 'remux' | 'hdtv' | 'bluray';
export type UpgraderSort = 'title' | 'sizeGB' | 'watchCount' | 'addedAt' | 'daysSinceAdded' | 'staleAdded';

export type UpgraderStatus = {
    enabled: boolean;
    generatedAt: string | null;
    itemCount: number;
    rebuildInProgress: boolean;
    mediaServerType: string;
    plexConfigured: boolean;
    arrConfigured: boolean;
    automationEnabled: boolean;
    mediaAutomationEnabled?: boolean;
    profileMapConfigured: boolean;
    maxActionsPerHour: number;
    recentUpgradeCount: number;
    defaultPreset: string;
    defaultSort: UpgraderSort;
    minSizeGB: number;
};

export type UpgraderSummary = {
    generatedAt: string | null;
    totalItems: number;
    nonHevcCount: number;
    hevcCount: number;
    nonHevc4kCount: number;
    nonHevcHdrCount: number;
    arrMappedCount: number;
    arrUnmappedCount: number;
    estimatedReclaimableGB: number;
    minSizeGB: number;
};

export type UpgraderItem = {
    ratingKey: string;
    title: string;
    year: number | null;
    thumb: string;
    thumbUrl?: string | null;
    posterFallbackUrl?: string | null;
    overview?: string | null;
    mediaType: string;
    libraryTitle: string;
    libraryId: string;
    videoCodec: string;
    videoResolution: string;
    displayTags: string[];
    sizeGB: number;
    watchCount: number;
    addedAt: string | null;
    daysSinceAdded?: number | null;
    isHevc: boolean;
    hasHdr: boolean;
    hasDolbyVision: boolean;
    totalEpisodeCount?: number;
    nonHevcEpisodeCount?: number;
    nonHevcEpisodeSizeGB?: number;
    onDiskFileCount?: number;
    knownCodecFileCount?: number;
    unknownCodecCount?: number;
    codecCounts?: Record<string, number>;
    codecSizesGB?: Record<string, number>;
    resCounts?: Record<string, number>;
    zeroSizeCount?: number;
    plexUrl: string | null;
    arrMapped: boolean;
    arrType: string;
    arrInstanceName: string | null;
    arrInstanceId: string | null;
    arrDeepUrl: string | null;
    arrPath?: string | null;
    dataSource?: 'sonarr' | 'radarr';
    arrEntityId?: number;
    arrQualityProfileId?: number | null;
    excluded?: boolean;
    snoozed?: boolean;
};

export type UpgraderEpisode = {
    ratingKey: string;
    title: string;
    showTitle?: string;
    overview?: string;
    airDateUtc?: string;
    year?: number;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    thumb?: string;
    thumbUrl?: string | null;
    mediaType: string;
    videoCodec: string;
    videoResolution?: string;
    sizeGB: number;
    displayTags: string[];
    isHevc: boolean;
    hasHdr?: boolean;
    hasDolbyVision?: boolean;
    plexUrl: string | null;
    matchesPreset?: boolean;
    arrEpisodeId?: number | null;
    arrHasFile?: boolean;
    arrQualityLabel?: string | null;
    arrMonitored?: boolean | null;
    dataSource?: 'sonarr' | 'sonarr+plex' | 'plex';
};

export type UpgraderShowSeason = {
    seasonNumber: number;
    episodeCount: number;
    matchedCount: number;
    episodes: UpgraderEpisode[];
};

export type UpgraderShowDetail = {
    show: UpgraderItem & {
        arrQualityProfileName?: string | null;
        targetQualityProfileId?: number | null;
        targetQualityProfileName?: string | null;
    };
    codecs: string[];
    resolutions: string[];
    features: string[];
    episodeSource?: 'sonarr' | 'mixed' | 'plex' | 'none';
    matchMethod?: string | null;
    matchWarning?: string | null;
    stats: { total: number; matched: number; sonarrEpisodes?: number; plexEpisodes?: number };
    arr: {
        mapped: boolean;
        seriesId: number | null;
        instanceId: string | null;
        instanceName: string | null;
        monitored: boolean | null;
        currentProfileId: number | null;
        currentProfileName: string | null;
        targetProfileId: number | null;
        targetProfileName: string | null;
        deepUrl: string | null;
        matchMethod?: string | null;
    };
    seasons: UpgraderShowSeason[];
    episodes: UpgraderEpisode[];
    total: number;
};

export type UpgraderItemsResponse = {
    generatedAt: string | null;
    codecs: string[];
    resolutions: string[];
    features: string[];
    total: number;
    page: number;
    limit: number;
    libraries: Array<{ id: string; title: string; count: number }>;
    items: UpgraderItem[];
};

export type UpgraderQueueSummary = {
    instances: Array<{ instanceId: string; instanceName: string; type: string; total: number }>;
    totalQueued: number;
};

export type UpgraderProfileInstance = {
    id: string;
    name: string;
    type: string;
    profiles: Array<{ id: number; name: string }>;
    hevcProfileId: number | null;
    fallbackProfileId: number | null;
};

export type UpgraderUpgradePreviewEntry = {
    ratingKey: string;
    title?: string;
    success: boolean;
    skipped?: boolean;
    reason?: string;
    arrInstanceName?: string;
    currentProfileId?: number | null;
    currentProfileName?: string | null;
    targetProfileId?: number;
    targetProfileName?: string | null;
};

export type UpgraderUpgradePreviewResult = {
    dryRun: boolean;
    results: UpgraderUpgradePreviewEntry[];
    totals: { succeeded: number; failed: number };
};

export type UpgraderAuditEntry = {
    id: string;
    timestamp: string;
    action?: 'upgrade' | 'profile_change' | 'series_search' | 'episode_search' | 'movie_search' | string;
    success?: boolean;
    reason?: string | null;
    ratingKey: string;
    title: string;
    arrInstanceId?: string;
    arrInstanceName?: string;
    arrType?: string;
    currentProfileId?: number | null;
    currentProfileName?: string | null;
    targetProfileId?: number;
    targetProfileName?: string | null;
    episodeIds?: number[];
    triggerSearch?: boolean;
    commandId?: string | null;
    dryRun?: boolean;
    actor?: { username?: string | null; email?: string | null };
};

export type UpgraderPreferences = {
    exclusions: {
        ratingKeys: string[];
        episodeKeys: string[];
        titles: string[];
        libraries: string[];
    };
    snoozed: Array<{ ratingKey: string; until: string | null; reason?: string | null }>;
};
