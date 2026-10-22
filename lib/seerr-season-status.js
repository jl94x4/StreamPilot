export const isReturningSeries = (details = {}) => (
    details?.inProduction === true
    || String(details?.status || '').toLowerCase() === 'returning series'
);

export const isEndedShow = (details = {}) => {
    if (details?.inProduction === true) return false;
    const status = String(details?.status || '').toLowerCase();
    return status === 'ended' || status === 'canceled' || status === 'cancelled';
};

/** Whether a season still has unaired episodes scheduled (currently airing). */
export const isSeasonStillAiring = (details = {}, seasonNumber) => {
    const next = details?.nextEpisodeToAir;
    if (next && Number(next.seasonNumber) === seasonNumber) return true;

    const last = details?.lastEpisodeToAir;
    const tmdbSeason = (Array.isArray(details?.seasons) ? details.seasons : []).find(
        (s) => Number(s?.seasonNumber ?? s?.season_number) === seasonNumber,
    );
    const totalEpisodes = Number(tmdbSeason?.episodeCount ?? tmdbSeason?.episode_count) || 0;

    if (last && Number(last.seasonNumber) === seasonNumber) {
        if (totalEpisodes > Number(last.episodeNumber)) return true;
        if (isReturningSeries(details)) return true;
    }

    return false;
};

/** Label for a season Seerr marks as PARTIAL (tracked in Sonarr with not-all episodes). */
export const resolvePartialSeasonLabel = (details = {}, seasonNumber) => (
    isSeasonStillAiring(details, seasonNumber) ? 'Up to date' : 'Partial'
);

/** Prefer "Up to date" over request/approval labels for ongoing seasons on returning series. */
export const resolveMonitoredSeasonLabel = (details = {}, seasonNumber, fallback) => (
    isReturningSeries(details) && isSeasonStillAiring(details, seasonNumber) ? 'Up to date' : fallback
);

export const isSeasonUpToDateLabel = (label) => label === 'Up to date';

export const isSeasonHandledInLibrary = (label) => (
    label === 'Available'
    || label === 'Up to date'
    || label === 'Requested'
    || label === 'Processing'
    || label === 'Pending'
    || label === 'Approved'
);

/**
 * Only lock a season Seerr did not list when Sonarr itself has that season.
 * Other aired seasons on a show that already has some seasons stay requestable.
 */
export const inferMissingLibrarySeasonStatus = (details = {}, mediaInfo = {}, seasonRow = {}) => {
    if (!seasonRow?.requestable || seasonRow?.statusLabel !== 'Not requested') return null;
    const seasonNumber = Number(seasonRow.seasonNumber);
    if (!Number.isFinite(seasonNumber)) return null;

    const sonarr = details?.sonarrLibraryStatus;
    if (!sonarr?.matched || !Array.isArray(sonarr.seasons)) return null;
    const probe = sonarr.seasons.find((season) => Number(season?.seasonNumber) === seasonNumber);
    if (!probe) return null;

    const withFile = Number(probe.airedWithFile ?? probe.withFile) || 0;
    const aired = Number(probe.airedTotal) || 0;
    const total = Number(probe.total) || 0;
    const complete = !!probe.complete || (total > 0 && Number(probe.withFile) >= total);
    if (complete && (aired > 0 || withFile > 0)) {
        return {
            requestable: false,
            statusLabel: isSeasonStillAiring(details, seasonNumber) ? 'Up to date' : 'Available',
        };
    }
    if (withFile > 0) {
        return {
            requestable: false,
            statusLabel: isSeasonStillAiring(details, seasonNumber) ? 'Up to date' : 'Partial',
        };
    }
    if (aired > 0 || total > 0) {
        return { requestable: false, statusLabel: 'Requested' };
    }
    return null;
};

export const applyMissingLibrarySeasonInference = (details = {}, mediaInfo = {}, seasonRows = []) => (
    seasonRows.map((row) => {
        const inferred = inferMissingLibrarySeasonStatus(details, mediaInfo, row);
        if (!inferred) return row;
        return { ...row, ...inferred };
    })
);

/**
 * Seerr / title-index stamps often attach the original series to a sequel.
 * Only strip those stamps when Sonarr was searched and confirmed this TMDB id
 * is not in the catalog. Missing/cold probes keep Seerr's Plex library truth.
 */
export const reconcileSeasonOptionsWithSonarr = (details = {}, seasonRows = []) => {
    const sonarr = details?.sonarrLibraryStatus;
    if (sonarr?.matched !== false) return seasonRows;
    return (Array.isArray(seasonRows) ? seasonRows : []).map((row) => {
        if (row?.requestStatus != null) return row;
        if (row?.requestable) return row;
        const label = String(row?.statusLabel || '');
        if (
            label === 'Available'
            || label === 'Up to date'
            || label === 'Partial'
            || label === 'Requested'
            || label === 'Processing'
        ) {
            return {
                ...row,
                requestable: true,
                statusLabel: 'Not requested',
                libraryStatus: null,
            };
        }
        return row;
    });
};
