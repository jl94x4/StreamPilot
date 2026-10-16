/**
 * Portal-native Discover / request engine seams.
 * Phase 2: TMDB client is wired behind discoverySource=tmdb.
 *
 * @see docs/development/seerr-uncouple-inventory.md
 */

export { createTmdbClient, buildTmdbDiscoverQuery } from './tmdbClient.js';
export { createTmdbDiscoverRouter } from './tmdbDiscover.js';
export { createLibraryAvailability } from './libraryAvailability.js';
export {
    emptyDiscoveryAvailabilityCache,
    normalizeDiscoveryAvailabilityCache,
    getDiscoveryAvailabilityCacheVersion,
    lookupDiscoveryAvailability,
    lookupDiscoveryAvailabilityForItem,
    mergeAvailabilityEntryOntoItem,
    discoveryAvailabilityCacheNeedsLiveRecheck,
    applyDiscoveryAvailabilityCacheToItems,
    applyDiscoveryAvailabilityCacheToPayload,
    rebuildDiscoveryAvailabilityCache,
} from './discoveryAvailabilityCache.js';
export {
    resolveTvdbIdFromTmdb,
    resolveTmdbIdFromTvdb,
    matchSonarrSeriesFromIndexes,
    buildSonarrSeriesIndexes,
} from './sonarrSeriesMatch.js';
export { createJsonRequestStore, createRequestStore } from './requestStore.js';
export { createPortalRequestService, mapPortalRecordToDto } from './portalRequestService.js';
export {
    listPortalArrServers,
    resolvePortalArrInstance,
    getPortalArrServiceOptions,
    clearPortalArrServiceOptionsCache,
    inferArrInstanceIs4k,
    inferServerIs4k,
    nameLooksLike4kServer,
    normalizeServerListIs4k,
} from './portalArrServices.js';
export { createJsonIssueStore, createIssueStore } from './issueStore.js';
export { createPortalIssueService, mapPortalIssueToDto } from './portalIssueService.js';
export {
    getPortalRequestQuotaSettings,
    evaluatePortalMemberQuota,
    shouldPortalAutoApprove,
    normalizeRequestQuotaLimit,
    normalizeRequestQuotaDays,
} from './portalQuota.js';
export {
    getPortalRequestDefaults,
    resolveMemberRequestPolicy,
    canPolicyRequestMedia,
    normalizeUserRequestOverrides,
    pickPortalRequestDefaultsForSave,
    portalRequestDefaultsForClient,
    normalizeMetadataProvider,
} from './portalRequestDefaults.js';
export { formatRootFolderLabel, rootFolderDisplayName } from './rootFolderLabel.js';
export {
    detectAnimeMedia,
    inferAnimeRootFolderPath,
    resolveAnimeAwareRootFolder,
} from './animeMedia.js';
export { syncPortalRequestStatuses } from './requestStatusSync.js';
export {
    importSeerrHistoryToPortal,
    resolvePortalUserFromSeerr,
} from './seerrHistoryImport.js';
export { createJsonBlocklistStore, createBlocklistStore } from './blocklistStore.js';
export { createPortalBlocklistService, mapPortalBlocklistToDto } from './portalBlocklistService.js';
export { createJsonWatchlistStore, createWatchlistStore } from './watchlistStore.js';
export { createPortalWatchlistService, shouldSkipWatchlistRequest } from './portalWatchlistService.js';
export { createTvdbClient } from './tvdbClient.js';
export {
    enrichDiscoveryPayloadWithTvdbPosters,
    resolveTvdbPosterForTmdbShow,
} from './discoverTvdbPosters.js';
export { fetchPlexWatchlist } from './plexWatchlist.js';
