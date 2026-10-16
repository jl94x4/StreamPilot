export type PortalRequestSeason = {
    seasonNumber: number;
    status: number | null;
    statusLabel?: string;
};

export type PortalTvSeasonInfo = {
    seasonNumber: number;
    name: string;
    episodeCount: number;
};

export type PortalRequestItem = {
    id: number;
    status: number | null;
    statusLabel: string;
    type: 'movie' | 'tv' | 'music';
    is4k: boolean;
    title: string;
    year: string | null;
    overview: string;
    genres?: string[];
    /** ISO 639-1 code from TMDB (e.g. en, ko). */
    originalLanguage?: string | null;
    posterUrl: string;
    posterPath?: string | null;
    backdropUrl?: string;
    requestedBy: {
        id: number | null;
        displayName: string;
        email?: string | null;
        avatar: string;
    };
    modifiedBy?: {
        id: number;
        displayName: string;
    } | null;
    declineReason?: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    mediaStatus: number | null;
    isDownloading?: boolean;
    seerrUrl: string;
    tmdbId?: number | null;
    mbid?: string | null;
    albumMbid?: string | null;
    albumTitle?: string | null;
    mediaId?: number | null;
    serverId?: number | null;
    profileId?: number | null;
    profileName?: string | null;
    rootFolder?: string | null;
    languageProfileId?: number | null;
    tags?: number[];
    seasons?: PortalRequestSeason[];
    tvSeasons?: PortalTvSeasonInfo[];
    routingSummary?: string | null;
    canRemove?: boolean | null;
    canCancel?: boolean;
    canRetry?: boolean;
    isAnime?: boolean;
};

export type PortalRequestDetail = PortalRequestItem;

export type PortalIssueComment = {
    id: number | null;
    message: string;
    createdAt: string | null;
    updatedAt: string | null;
    user: {
        id: number | null;
        displayName: string;
        avatar: string;
    };
};

export type PortalIssueItem = {
    id: number;
    status: number | null;
    statusLabel: string;
    issueType: number | null;
    issueTypeLabel: string;
    problemSeason: number | null;
    problemEpisode: number | null;
    type: 'movie' | 'tv' | 'music';
    title: string;
    year: string | null;
    overview: string;
    posterUrl: string;
    backdropUrl?: string;
    posterPath?: string | null;
    tmdbId?: number | null;
    mediaId?: number | null;
    createdAt: string | null;
    updatedAt: string | null;
    createdBy: {
        id: number | null;
        displayName: string;
        email?: string | null;
        avatar: string;
    };
    modifiedBy?: {
        id: number;
        displayName: string;
    } | null;
    comments: PortalIssueComment[];
    commentCount: number;
    seerrUrl: string;
    ticketId?: number | null;
};

export type PortalIssueCounts = {
    configured?: boolean;
    connected?: boolean;
    supported?: boolean;
    open: number;
    closed?: number;
    resolved?: number;
    total: number;
    error?: string | null;
};

export type PortalBlocklistItem = {
    id: number | null;
    tmdbId: number | null;
    mediaType: 'movie' | 'tv';
    title: string;
    createdAt: string | null;
    blocklistedTags?: string | null;
    posterUrl: string;
    posterPath?: string | null;
    addedBy: {
        id: number | null;
        displayName: string;
        avatar?: string;
    };
    seerrUrl: string;
};

export type PortalBlocklistSearchResult = {
    tmdbId: number | null;
    mediaType: 'movie' | 'tv';
    title: string;
    year?: string | null;
    posterPath?: string | null;
    overview?: string;
};

export type PortalBlocklistCounts = {
    configured?: boolean;
    connected?: boolean;
    supported?: boolean;
    total: number;
    error?: string | null;
};

export type PortalServiceServer = {
    id: number;
    name: string;
    is4k: boolean;
    isDefault: boolean;
};

export type PortalServiceOptions = {
    server: {
        id: number;
        name: string;
        is4k: boolean;
        isDefault: boolean;
        activeProfileId?: number | null;
        activeDirectory?: string | null;
        activeLanguageProfileId?: number | null;
        activeAnimeProfileId?: number | null;
        activeAnimeDirectory?: string | null;
        activeAnimeLanguageProfileId?: number | null;
    };
    profiles: { id: number; name: string }[];
    rootFolders: { id: number; path: string; freeSpace?: number | null }[];
    languageProfiles?: { id: number; name: string }[];
    tags: { id: number; label: string }[];
};

export type PortalRequestUser = {
    id: number | string;
    displayName: string;
    email?: string | null;
    username?: string | null;
    plexId?: number | string | null;
    avatar?: string | null;
};

export type PortalRequestOverrides = {
    serverId?: number;
    profileId?: number;
    rootFolder?: string;
    languageProfileId?: number;
    userId?: number | string;
    tags?: number[];
    seasons?: number[];
};

export type PortalRequestCounts = {
    configured: boolean;
    connected?: boolean;
    supported?: boolean;
    pending: number;
    approved: number;
    declined: number;
    processing?: number;
    available?: number;
    failed?: number;
    completed?: number;
    total: number;
    error?: string | null;
};
