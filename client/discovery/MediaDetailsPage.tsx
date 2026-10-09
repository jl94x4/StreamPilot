import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PlusCircle, CheckCircle, Clock, ArrowLeft, Star, Calendar, Globe, Film, Tv, Loader2, Users, Ticket, Cloud, Disc, AlertTriangle, Bell } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { DiscoverPosterCard } from '../screens';
import { Carousel } from './Carousel';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { filterHiddenAvailableItems, useDiscoveryPreferences } from './useDiscoveryPreferences';
import { useDiscoveryMe } from './useDiscoveryMe';
import { tmdbBackdropUrl } from './discoverConstants';
import { resolveTmdbImageUrl } from './tmdbImageUrl';
import { RequestModal } from './RequestModal';
import { ReportIssueModal } from './ReportIssueModal';
import { SeasonEpisodesModal } from './SeasonEpisodesModal';
import { resolveMediaAvailabilityState } from './discoverAvailability';
import { enrichDiscoverItemsWithAvailability } from './discoverAvailabilityEnrich';
import { MediaStatusPanel, mediaStatusChipClass } from './DiscoverStatusOverlay';
import { currentDiscoverPathWithSearch, readDiscoverDetailSeed, scrollPortalToTop, stashDiscoverPersonReturn, stashDiscoverScrollPosition } from './discoverNavigationUtils';
import { MediaOverviewExtras } from './MediaOverviewExtras';
import { OpenInArrButton } from '../shared/OpenInArrButton';
import { OpenInLibraryButton } from '../shared/OpenInLibraryButton';
import type { CombinedRatings } from './mediaDetailUtils';
import { fetchCombinedRatings } from './mediaDetailUtils';
import {
    buildSeasonStatusFromDetails,
    canMarkTvAsAvailable,
    getRequestButtonState,
    seasonStatusBadgeClass,
    formatRequestedByCopy,
} from './requestSeasonUtils';
import { useDiscoverI18n, translateDiscoverStatus } from './i18n';

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex items-center gap-3 mb-4 pr-16">
        <h3 className="text-xs font-black text-muted uppercase tracking-[0.2em]">{children}</h3>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
);

type RadarrReleaseDates = {
    inCinemas?: string | null;
    digitalRelease?: string | null;
    physicalRelease?: string | null;
};

const formatOrdinalDay = (day: number) => {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
    const mod10 = day % 10;
    if (mod10 === 1) return `${day}st`;
    if (mod10 === 2) return `${day}nd`;
    if (mod10 === 3) return `${day}rd`;
    return `${day}th`;
};

const formatRadarrReleaseDate = (value?: string | null, locale = 'en') => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    if (locale !== 'en') {
        return parsed.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    }
    const day = parsed.getDate();
    const monthYear = parsed.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return `${formatOrdinalDay(day)} ${monthYear}`;
};

export const MediaDetailsPage: React.FC<{
    mediaType: 'movie' | 'tv';
    mediaId: number;
    onBack: () => void;
    formatItem: (item: any) => any;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    isAdmin?: boolean;
    mediaServerType?: string;
}> = ({ mediaType, mediaId, onBack, formatItem, pushToast, isAdmin = false, mediaServerType = 'plex' }) => {
    const { t, locale } = useDiscoverI18n();
    const { preferences } = useDiscoveryPreferences();
    const { profile: discoveryMe } = useDiscoveryMe(true);
    const [details, setDetails] = useState<any>(() => readDiscoverDetailSeed(mediaType, mediaId));
    const [loading, setLoading] = useState(() => !readDiscoverDetailSeed(mediaType, mediaId));
    const [loadError, setLoadError] = useState<string | null>(null);
    const [recommendations, setRecommendations] = useState<any[]>([]);
    const [posterFailed, setPosterFailed] = useState(false);
    const [backdropFailed, setBackdropFailed] = useState(false);
    const [radarrReleases, setRadarrReleases] = useState<RadarrReleaseDates | null>(null);
    const [ratings, setRatings] = useState<CombinedRatings | null>(null);
    const [requestModalOpen, setRequestModalOpen] = useState(false);
    const [requestNotify, setRequestNotify] = useState<{
        canNotify?: boolean;
        isWatching?: boolean;
        canRequest?: boolean;
        mediaStatus?: number | null;
        blockReason?: string | null;
        requestedByName?: string | null;
        requestedByCount?: number;
    } | null>(null);
    const [issueModalOpen, setIssueModalOpen] = useState(false);
    const [episodesSeason, setEpisodesSeason] = useState<{
        seasonNumber: number;
        name: string;
        episodeCount: number;
        statusLabel: string;
        posterPath?: string | null;
    } | null>(null);
    const autoRequestHandledRef = useRef('');

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const routeKey = `${mediaType}:${mediaId}`;
        if (autoRequestHandledRef.current === routeKey) return;
        autoRequestHandledRef.current = routeKey;
        const params = new URLSearchParams(window.location.search);
        if (params.get('request') !== '1') return;
        setRequestModalOpen(true);
        params.delete('request');
        const nextSearch = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`);
    }, [mediaType, mediaId]);

    useEffect(() => {
        let cancelled = false;
        const seed = readDiscoverDetailSeed(mediaType, mediaId);
        // Instant paint from the clicked poster when available — no blank spinner.
        setDetails(seed);
        setLoading(!seed);
        setLoadError(null);
        setPosterFailed(false);
        setBackdropFailed(false);
        setRecommendations([]);
        setRadarrReleases(null);
        setRatings(null);
        setRequestNotify(null);

        const fetchDetails = async () => {
            try {
                const detailEndpoint = mediaType === 'movie'
                    ? `/api/discovery/proxy/movie/${mediaId}`
                    : `/api/discovery/proxy/tv/${mediaId}`;

                // Paint on details alone — hard-cap wait so a hung proxy never owns the page.
                const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const timer = controller ? window.setTimeout(() => controller.abort(), 8000) : null;
                try {
                    const res = await apiFetch(
                        detailEndpoint,
                        controller ? { signal: controller.signal } : {},
                    );
                    if (cancelled) return;
                    if (!res?.error) {
                        setDetails(res);
                        setLoadError(null);
                    } else if (!seed) {
                        setLoadError(res.error || t('media.loadFailed'));
                    }
                } finally {
                    if (timer) window.clearTimeout(timer);
                }
            } catch (err: any) {
                console.error(err);
                if (!cancelled && !seed) {
                    setLoadError(
                        err?.name === 'AbortError'
                            ? t('media.loadTimedOut')
                            : (err?.message || t('media.loadFailed')),
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }

            if (cancelled) return;
            const recEndpoint = mediaType === 'movie'
                ? `/api/discovery/proxy/movie/${mediaId}/recommendations`
                : `/api/discovery/proxy/tv/${mediaId}/recommendations`;
            apiFetch(recEndpoint)
                .then(async (recRes) => {
                    if (cancelled || !recRes || recRes.error || !recRes.results) return;
                    const enriched = await enrichDiscoverItemsWithAvailability(recRes.results);
                    if (!cancelled) setRecommendations(enriched);
                })
                .catch(() => undefined);
        };

        fetchDetails();
        return () => {
            cancelled = true;
        };
    }, [mediaId, mediaType, locale]);

    useEffect(() => {
        if (loading || !details) return undefined;
        let cancelled = false;
        apiFetch(`/api/discovery/request-options?mediaType=${mediaType}&mediaId=${mediaId}`)
            .then((data) => {
                if (cancelled || data?.error) return;
                setRequestNotify({
                    canNotify: !!data?.canNotify,
                    isWatching: !!data?.isWatching,
                    canRequest: data?.canRequest !== false,
                    mediaStatus: Number.isFinite(Number(data?.mediaStatus)) ? Number(data.mediaStatus) : null,
                    blockReason: data?.blockReason || null,
                    requestedByName: data?.requestedByName || null,
                    requestedByCount: Number(data?.requestedByCount) || 0,
                });
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [loading, details, mediaId, mediaType]);

    useEffect(() => {
        if (loading || !details) return undefined;

        let cancelled = false;

        // Live library badge when disk cache missed (movies + TV).
        // Movies reconcile with Radarr, but keep Seerr/portal PENDING/PROCESSING so the
        // Request CTA matches the modal ("already requested") instead of flipping back
        // to "Request Movie".
        const existingStatus = Number(details?.mediaInfo?.status);
        const hasRequestStamp = Array.isArray(details?.mediaInfo?.requests)
            && details.mediaInfo.requests.length > 0;
        const preserveRequestState = existingStatus === 2
            || existingStatus === 3
            || hasRequestStamp;
        const needsLive = mediaType === 'movie'
            || !Number.isFinite(existingStatus);
        if (needsLive) {
            const enrichTarget = mediaType === 'movie' && !preserveRequestState
                ? { ...details, mediaInfo: null }
                : details;
            enrichDiscoverItemsWithAvailability([enrichTarget])
                .then((enriched) => {
                    if (cancelled || !enriched?.[0]) return;
                    setDetails((prev) => {
                        if (!prev) return enriched[0];
                        const next = { ...prev, ...enriched[0] };
                        const prevStatus = Number(prev?.mediaInfo?.status);
                        const nextStatus = Number(next?.mediaInfo?.status);
                        const keepPrevRequest = (
                            (prevStatus === 2 || prevStatus === 3
                                || (Array.isArray(prev?.mediaInfo?.requests) && prev.mediaInfo.requests.length > 0))
                            && !(nextStatus === 4 || nextStatus === 5 || nextStatus === 6)
                        );
                        if (keepPrevRequest) {
                            next.mediaInfo = {
                                ...(next.mediaInfo || {}),
                                status: Number.isFinite(prevStatus) && prevStatus > 1
                                    ? prevStatus
                                    : (next.mediaInfo?.status ?? 3),
                                ...(Array.isArray(prev?.mediaInfo?.requests) && prev.mediaInfo.requests.length
                                    ? { requests: prev.mediaInfo.requests }
                                    : {}),
                            };
                        }
                        return next;
                    });
                })
                .catch(() => undefined);
        }

        if (mediaType === 'tv') {
            apiFetch(`/api/discovery/tv/${mediaId}/library-status`)
                .then((res) => {
                    if (cancelled || !res?.sonarrLibraryStatus?.matched) return;
                    const sonarr = res.sonarrLibraryStatus;
                    setDetails((prev) => {
                        if (!prev) return prev;
                        const seasons = Array.isArray(sonarr.seasons) ? sonarr.seasons : [];
                        const airedMainSeasons = seasons.filter(
                            (s: any) => Number(s?.seasonNumber) > 0
                                && (Number(s?.airedTotal) > 0 || Number(s?.withFile) > 0),
                        );
                        const mainComplete = airedMainSeasons.length > 0
                            && airedMainSeasons.every((s: any) => !!s.complete
                                || (Number(s.total) > 0 && Number(s.withFile) >= Number(s.total)));
                        const effectivelyComplete = canMarkTvAsAvailable(prev)
                            && (
                                !!sonarr.showComplete
                                || (!sonarr.hasActiveDownloads && !sonarr.nextAiring && mainComplete)
                            );

                        let nextStatus = prev.mediaInfo?.status;
                        if (sonarr.hasActiveDownloads) {
                            nextStatus = 3; // PROCESSING — still downloading
                        } else if (effectivelyComplete) {
                            nextStatus = 5; // AVAILABLE
                        } else if (Number(sonarr.fileCount) > 0) {
                            nextStatus = 4; // PARTIAL
                        } else if (Number(sonarr.episodeCount) > 0) {
                            nextStatus = null; // tracked in Sonarr, nothing aired/on disk yet
                        }

                        const librarySeasons = seasons
                            .filter((s: any) => Number(s?.seasonNumber) > 0 && (Number(s?.airedTotal) > 0 || Number(s?.withFile) > 0))
                            .map((s: any) => ({
                                seasonNumber: Number(s.seasonNumber),
                                status: s.complete ? 5 : 4,
                            }));

                        return {
                            ...prev,
                            sonarrLibraryStatus: {
                                ...sonarr,
                                showComplete: effectivelyComplete,
                            },
                            mediaInfo: {
                                ...(prev.mediaInfo || {}),
                                ...(nextStatus != null ? { status: nextStatus } : {}),
                                ...(librarySeasons.length
                                    ? {
                                        seasons: librarySeasons,
                                    }
                                    : {}),
                            },
                        };
                    });
                })
                .catch(() => undefined);
        }

        return () => {
            cancelled = true;
        };
    }, [mediaId, mediaType, loading, details?.id]);

    useEffect(() => {
        if (!details) {
            setRatings(null);
            return undefined;
        }
        let cancelled = false;
        fetchCombinedRatings(mediaType, mediaId)
            .then((res) => {
                if (!cancelled) setRatings(res);
            })
            .catch(() => {
                if (!cancelled) setRatings(null);
            });
        return () => {
            cancelled = true;
        };
    }, [details, mediaId, mediaType]);

    useEffect(() => {
        if (mediaType !== 'movie') {
            setRadarrReleases(null);
            return;
        }
        let cancelled = false;
        apiFetch(`/api/discovery/radarr-releases?tmdbId=${mediaId}`)
            .then((res) => {
                if (!cancelled && res?.configured && res?.releases) {
                    setRadarrReleases(res.releases);
                }
            })
            .catch(() => {
                if (!cancelled) setRadarrReleases(null);
            });
        return () => {
            cancelled = true;
        };
    }, [mediaId, mediaType]);

    const refreshDetails = async () => {
        try {
            const endpoint = mediaType === 'movie'
                ? `/api/discovery/proxy/movie/${mediaId}`
                : `/api/discovery/proxy/tv/${mediaId}`;
            const res = await apiFetch(endpoint);
            if (!res.error) {
                setDetails(res);
                if (mediaType === 'tv') {
                    apiFetch(`/api/discovery/tv/${mediaId}/library-status`)
                        .then((lib) => {
                            if (!lib?.sonarrLibraryStatus?.matched) return;
                            const sonarr = lib.sonarrLibraryStatus;
                            setDetails((prev) => {
                                if (!prev) return prev;
                                let nextStatus = prev.mediaInfo?.status;
                                if (sonarr.hasActiveDownloads) {
                                    nextStatus = 3;
                                } else if (sonarr.showComplete && canMarkTvAsAvailable(prev)) {
                                    nextStatus = 5;
                                } else if (Number(sonarr.fileCount) > 0) {
                                    nextStatus = 4;
                                } else if (Number(sonarr.episodeCount) > 0) {
                                    nextStatus = null;
                                }
                                return {
                                    ...prev,
                                    sonarrLibraryStatus: sonarr,
                                    mediaInfo: {
                                        ...(prev.mediaInfo || {}),
                                        ...(nextStatus != null ? { status: nextStatus } : {}),
                                    },
                                };
                            });
                        })
                        .catch(() => undefined);
                }
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleRequestSuccess = (message: string, meta?: { notify?: boolean }) => {
        if (meta?.notify) {
            pushToast?.(message, 'success');
            return;
        }
        pushToast?.(message, 'success');
        // Optimistic stamp so the button flips immediately (auto-approve used to leave it as Request).
        setDetails((prev) => {
            if (!prev) return prev;
            const prevInfo = prev.mediaInfo || {};
            const currentStatus = Number(prevInfo.status);
            return {
                ...prev,
                mediaInfo: {
                    ...prevInfo,
                    status: (Number.isFinite(currentStatus) && currentStatus >= 4)
                        ? currentStatus
                        : 3, // PROCESSING / requested until refresh confirms
                    requests: [
                        {
                            status: 2, // REQUEST_STATUS.APPROVED-or-pending stand-in; refresh corrects
                            createdAt: new Date().toISOString(),
                        },
                        ...(Array.isArray(prevInfo.requests) ? prevInfo.requests : []),
                    ],
                },
            };
        });
        void refreshDetails();
    };

    const discoveryNavigate = (path: string) => {
        const current = currentDiscoverPathWithSearch();
        stashDiscoverScrollPosition(current);
        stashDiscoverPersonReturn(current, path);
        window.history.pushState({}, '', portalUrl(path));
        scrollPortalToTop();
        window.dispatchEvent(new Event('popstate'));
    };

    const openPerson = (personId: number) => {
        discoveryNavigate(`/discovery/person/${personId}`);
    };

    const openMedia = (type: string, id: number) => {
        discoveryNavigate(`/discovery/${type}/${id}`);
    };

    const openGenre = (genreId: number) => {
        const path = mediaType === 'movie'
            ? `/discovery/movies?genre=${genreId}`
            : `/discovery/series?genre=${genreId}`;
        discoveryNavigate(path);
    };

    const openKeyword = (keyword: { id: number; name: string }) => {
        const params = new URLSearchParams({
            keywords: String(keyword.id),
            keywordName: keyword.name,
        });
        const path = mediaType === 'movie'
            ? `/discovery/movies?${params.toString()}`
            : `/discovery/series?${params.toString()}`;
        discoveryNavigate(path);
    };

    const openStudio = (studioId: number) => {
        discoveryNavigate(`/discovery/movies/studio/${studioId}`);
    };

    const openNetwork = (networkId: number) => {
        discoveryNavigate(`/discovery/series/network/${networkId}`);
    };

    const seasonRows = useMemo(
        () => (mediaType === 'tv' && details ? buildSeasonStatusFromDetails(details) : []),
        [details, mediaType],
    );

    useEffect(() => {
        if (mediaType !== 'tv' || !seasonRows.length) return;
        const readSeasonQuery = () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const rawSeason = params.get('season');
                // Number(null) === 0, which would auto-open Specials on every TV details visit.
                if (rawSeason == null || String(rawSeason).trim() === '') {
                    setEpisodesSeason(null);
                    return;
                }
                const season = Number(rawSeason);
                if (!Number.isFinite(season) || season < 0) {
                    setEpisodesSeason(null);
                    return;
                }
                const row = seasonRows.find((s) => s.seasonNumber === season);
                if (!row) {
                    setEpisodesSeason(null);
                    return;
                }
                setEpisodesSeason({
                    seasonNumber: row.seasonNumber,
                    name: row.name,
                    episodeCount: row.episodeCount,
                    statusLabel: row.statusLabel,
                    posterPath: row.posterPath,
                });
            } catch {
                // ignore bad query
            }
        };
        readSeasonQuery();
        window.addEventListener('portal-discovery-navigate', readSeasonQuery);
        window.addEventListener('popstate', readSeasonQuery);
        return () => {
            window.removeEventListener('portal-discovery-navigate', readSeasonQuery);
            window.removeEventListener('popstate', readSeasonQuery);
        };
    }, [mediaType, mediaId, seasonRows]);

    const availability = useMemo(
        () => (details ? resolveMediaAvailabilityState(details) : null),
        [details],
    );

    const handleRetryRequest = async () => {
        if (!availability?.userRequestId) return;
        try {
            const res = await apiFetch(`/api/discovery/my-requests/${availability.userRequestId}/retry`, {
                method: 'POST',
            });
            if (res?.error) throw new Error(res.error);
            pushToast?.(res?.message || t('media.retrySubmitted'), 'success');
            await refreshDetails();
        } catch (err: any) {
            pushToast?.(err?.message || t('media.retryFailed'), 'error');
        }
    };

    const openMyRequests = () => {
        window.history.pushState({}, '', portalUrl('/discovery/requests'));
        window.dispatchEvent(new Event('popstate'));
    };

    if (loading && !details) {
        return (
            <div className="w-full h-[80vh] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-plex animate-spin" />
            </div>
        );
    }

    if (!details) {
        return (
            <div className="w-full h-[80vh] flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-lg font-bold text-text">{loadError || t('media.couldNotLoad')}</p>
                <button
                    type="button"
                    onClick={onBack}
                    className="px-4 py-2 rounded-lg border border-border bg-card text-sm font-bold text-text hover:border-plex/40"
                >
                    {t('media.goBack')}
                </button>
            </div>
        );
    }

    const title = mediaType === 'movie' ? details.title : details.name;
    const year = (details.releaseDate || details.firstAirDate || '').substring(0, 4);
    const mediaStatus = details.mediaInfo?.status ?? null;
    const requestButton = getRequestButtonState(mediaType, mediaStatus, seasonRows, details.mediaInfo, details);
    const requestBlockReason = String(requestNotify?.blockReason || '').toLowerCase();
    const requestOptionsStatus = Number.isFinite(Number(requestNotify?.mediaStatus))
        ? Number(requestNotify?.mediaStatus)
        : null;
    const requestOptionsBlocksAction = requestNotify?.canRequest === false;
    const requestOptionsSaysAvailable = requestOptionsStatus === 5
        || requestBlockReason.includes('already available');
    const requestOptionsSaysRequested = requestOptionsStatus === 2
        || requestOptionsStatus === 3
        || requestBlockReason.includes('pending request');
    const availabilitySaysAvailable = availability?.kind === 'available';
    const notifyCta = requestNotify?.canNotify || requestNotify?.isWatching
        ? {
            label: requestNotify.isWatching ? t('request.watching') : t('request.notifyMe'),
            disabled: false,
            variant: requestNotify.isWatching ? 'pending' as const : 'action' as const,
            hide: false,
        }
        : null;
    const preferRequestCta = !notifyCta && !requestButton.disabled && requestButton.variant === 'action';
    const visibleRequestButtonBase = preferRequestCta ? requestButton : (notifyCta || requestButton);
    const visibleRequestButton = (
        visibleRequestButtonBase.variant === 'action'
        && !notifyCta
        && (
            (requestOptionsBlocksAction && (requestOptionsSaysAvailable || requestOptionsSaysRequested))
            || availabilitySaysAvailable
        )
    )
        ? {
            label: requestOptionsSaysRequested ? 'Requested' : 'Available',
            disabled: true,
            variant: (requestOptionsSaysRequested ? 'pending' : 'available') as const,
        }
        : visibleRequestButtonBase;
    const requestButtonLabel = translateDiscoverStatus(t, visibleRequestButton.label);
    const mediaTypeLabel = mediaType === 'movie' ? t('mediaType.movie') : t('mediaType.tv');
    const seerrMediaId = Number(details.mediaInfo?.id);
    const tmdbId = Number(details.tmdbId ?? details.id);
    const canReportIssue = discoveryMe.permissions?.createIssues !== false
        && (
            (Number.isFinite(seerrMediaId) && seerrMediaId > 0)
            || (Number.isFinite(tmdbId) && tmdbId > 0)
        )
        && (
            mediaStatus === 4
            || mediaStatus === 5
            || availability?.kind === 'available'
            || availability?.kind === 'partial'
        );
    const posterUrl = resolveTmdbImageUrl(details.posterPath, 'w500');
    const posterHeroUrl = resolveTmdbImageUrl(details.posterPath, 'w780');
    const backdropUrl = tmdbBackdropUrl(details.backdropPath || '');
    const heroBackdropUrl = backdropUrl && !backdropFailed ? backdropUrl : '';
    const heroImageUrl = heroBackdropUrl || posterHeroUrl;
    const heroUsesPosterFallback = !heroBackdropUrl && !!posterHeroUrl;
    const voteCountLabel = details.voteCount > 0
        ? t('filters.votes', {
            count: details.voteCount >= 1000 ? `${(details.voteCount / 1000).toFixed(1)}k` : details.voteCount,
        })
        : null;

    const metaChips: { icon: React.ReactNode; label: string }[] = [];
    if (year) metaChips.push({ icon: <Calendar className="w-3.5 h-3.5 text-white/50" />, label: year });
    if (details.voteAverage > 0) {
        metaChips.push({
            icon: <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />,
            label: details.voteAverage.toFixed(1),
        });
    }
    if (details.productionCountries?.[0]) {
        metaChips.push({
            icon: <Globe className="w-3.5 h-3.5 text-white/50" />,
            label: details.productionCountries[0].iso_3166_1,
        });
    }
    if (mediaType === 'movie' && details.runtime > 0) {
        metaChips.push({ icon: <Clock className="w-3.5 h-3.5 text-white/50" />, label: t('common.runtimeMin', { count: details.runtime }) });
    }
    if (mediaType === 'tv' && details.numberOfSeasons) {
        metaChips.push({
            icon: <Tv className="w-3.5 h-3.5 text-white/50" />,
            label: t('common.seasonCount', { count: details.numberOfSeasons }),
        });
    }
    if (mediaType === 'tv' && details.numberOfEpisodes) {
        metaChips.push({
            icon: <Film className="w-3.5 h-3.5 text-white/50" />,
            label: t('common.episodeCount', { count: details.numberOfEpisodes }),
        });
    }

    const extraDetails: { label: string; value: string }[] = [];

    const visibleRecommendations = filterHiddenAvailableItems(recommendations, preferences.hideAvailableMedia);
    const releaseDateRows = mediaType === 'movie' && radarrReleases
        ? [
            { key: 'cinema', icon: Ticket, label: t('media.cinema'), date: formatRadarrReleaseDate(radarrReleases.inCinemas, locale) },
            { key: 'streaming', icon: Cloud, label: t('media.streaming'), date: formatRadarrReleaseDate(radarrReleases.digitalRelease, locale) },
            { key: 'bluray', icon: Disc, label: t('media.bluRay'), date: formatRadarrReleaseDate(radarrReleases.physicalRelease, locale) },
        ].filter((row) => row.date)
        : mediaType === 'tv'
            ? [
                { key: 'premiere', icon: Calendar, label: t('media.firstAired'), date: formatRadarrReleaseDate(details.firstAirDate, locale) },
                { key: 'last-aired', icon: Calendar, label: t('media.lastAired'), date: formatRadarrReleaseDate(details.lastAirDate, locale) },
                {
                    key: 'next-aired',
                    icon: Cloud,
                    label: t('media.nextEpisode'),
                    date: formatRadarrReleaseDate(details.nextEpisodeToAir?.airDate || details.nextEpisodeToAir?.air_date, locale),
                },
            ].filter((row) => row.date)
            : [];

    return (
        <>
        <div className="discover-media-details page-bleed-x md:w-full flex flex-col min-h-screen bg-card animate-fade-in pb-24 md:pb-16 rounded-none md:rounded-2xl lg:rounded-3xl overflow-x-hidden border-0 md:border border-white/5 shadow-2xl">
            <div className="relative isolate">
                <div
                    className="media-details-hero-backdrop absolute inset-x-0 top-0 h-[34rem] max-h-[72vh] sm:h-[36rem] md:h-[min(72vh,52rem)] md:max-h-none overflow-hidden pointer-events-none"
                    aria-hidden
                >
                    {heroImageUrl ? (
                        <img
                            src={heroImageUrl}
                            alt=""
                            className={`absolute inset-0 w-full h-full object-cover ${
                                heroUsesPosterFallback
                                    ? 'scale-[1.35] blur-2xl opacity-40 md:scale-125 md:blur-xl md:opacity-58'
                                    // Bias left so subjects land in the open right panel; slight scale avoids empty edges.
                                    : 'scale-110 object-[32%_30%] opacity-45 md:scale-[1.15] md:object-[22%_28%] md:opacity-90'
                            }`}
                            fetchPriority="high"
                            decoding="async"
                            onError={() => {
                                if (heroBackdropUrl) setBackdropFailed(true);
                            }}
                        />
                    ) : (
                        <div className="absolute inset-0 bg-black" />
                    )}
                    {/* Classic fade: image up top → dissolves into page card (dark & light). */}
                    <div className="media-details-hero-scrim-mobile absolute inset-0 bg-gradient-to-b from-black/50 via-card/65 via-[55%] to-card md:hidden" />
                    <div className="media-details-hero-scrim-bottom absolute inset-0 hidden md:block bg-gradient-to-t from-card from-0% via-card/80 via-[38%] to-transparent" />
                    <div className="media-details-hero-scrim-left absolute inset-0 hidden md:block bg-gradient-to-r from-card from-0% via-card/70 via-[32%] to-transparent to-[78%]" />
                </div>

                <div className="relative z-10 w-full max-w-[1600px] mx-auto page-x sm:px-8 xl:px-12 pt-4 sm:pt-5 pb-8">
                    <button
                        type="button"
                        onClick={onBack}
                        className="light-on-media mb-4 md:mb-6 inline-flex items-center gap-2 text-white/90 hover:text-white transition-colors bg-black/50 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 hover:border-white/20 hover:bg-black/65"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span className="font-bold text-sm">{t('media.backToDiscover')}</span>
                    </button>

                    <div className="flex flex-col md:flex-row gap-5 md:gap-6 lg:gap-10">
                <div className="w-full md:w-52 lg:w-60 flex-shrink-0 flex flex-col gap-4">
                    <div className="flex flex-row md:flex-col gap-4 items-stretch">
                        <div className="relative w-[38%] max-w-[10.5rem] sm:max-w-[12rem] md:w-full md:max-w-none aspect-[2/3] rounded-xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.55)] border border-white/15 bg-black/50 ring-1 ring-white/10 flex-shrink-0">
                            <div className="absolute -inset-4 bg-plex/10 blur-3xl opacity-40 pointer-events-none" />
                            {posterUrl && !posterFailed ? (
                                <img
                                    src={posterUrl}
                                    alt=""
                                    className="relative w-full h-full object-cover"
                                    onError={() => setPosterFailed(true)}
                                />
                            ) : (
                                <NoPosterPlaceholder />
                            )}
                        </div>

                        <div className="light-on-media flex-1 min-w-0 flex flex-col justify-end gap-2 md:hidden">
                            <div className="flex items-center gap-2 flex-wrap">
                                {mediaType === 'movie' ? <Film className="w-3.5 h-3.5 text-plex" /> : <Tv className="w-3.5 h-3.5 text-plex" />}
                                <span className="text-[10px] font-bold uppercase tracking-widest text-plex">{mediaTypeLabel}</span>
                                {details.status && (
                                    <>
                                        <span className="text-white/30">•</span>
                                        <span
                                            className="text-[10px] font-bold text-white/60 uppercase tracking-wide"
                                            title={t('media.tmdbProductionStatus')}
                                        >
                                            {details.status}
                                        </span>
                                    </>
                                )}
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-black text-white leading-[1.08] tracking-tight drop-shadow-lg">
                                {title}
                            </h1>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {metaChips.slice(0, 4).map((chip) => (
                                    <div
                                        key={chip.label}
                                        className="flex items-center gap-1 bg-black/45 px-2 py-1 rounded-md backdrop-blur-md border border-white/10 text-[11px] text-white/85 font-semibold"
                                    >
                                        {chip.icon}
                                        {chip.label}
                                    </div>
                                ))}
                                {voteCountLabel && (
                                    <div className="bg-black/45 px-2 py-1 rounded-md backdrop-blur-md border border-white/10 text-[11px] text-white/80 font-semibold">
                                        {voteCountLabel}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className={`grid gap-2.5 w-full ${canReportIssue && !visibleRequestButton.hide ? 'grid-cols-2 md:grid-cols-1' : 'grid-cols-1'}`}>
                    {!visibleRequestButton.hide && (
                    <div className="flex flex-col gap-1.5 min-w-0">
                    <button
                        type="button"
                        onClick={() => setRequestModalOpen(true)}
                        disabled={visibleRequestButton.disabled}
                        className={`w-full py-3 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-colors shadow-lg ${
                            visibleRequestButton.variant === 'available'
                                ? 'bg-green-500/20 text-green-500 border border-green-500/30 cursor-default'
                                : visibleRequestButton.variant === 'pending' && !notifyCta
                                    ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30 cursor-default'
                                    : visibleRequestButton.variant === 'blocked'
                                        ? 'bg-red-500/15 text-red-400 border border-red-500/25 cursor-default'
                                        : 'bg-plex hover:bg-plex-hover text-white disabled:opacity-50 disabled:cursor-not-allowed'
                        }`}
                    >
                        {visibleRequestButton.variant === 'available' ? (
                            <><CheckCircle className="w-4 h-4" /> {requestButtonLabel}</>
                        ) : notifyCta && !preferRequestCta ? (
                            <><Bell className="w-4 h-4" /> {requestButtonLabel}</>
                        ) : visibleRequestButton.variant === 'pending' ? (
                            <><Clock className="w-4 h-4" /> {requestButtonLabel}</>
                        ) : (
                            <><PlusCircle className="w-4 h-4" /> {requestButtonLabel}</>
                        )}
                    </button>
                    {notifyCta ? (
                        <p className="text-[11px] sm:text-xs text-white/55 text-center leading-snug px-1">
                            {formatRequestedByCopy(t, requestNotify?.requestedByName, requestNotify?.requestedByCount)}
                        </p>
                    ) : null}
                    {requestNotify?.isWatching ? (
                        <p className="text-[11px] text-white/40 text-center">{t('request.watchingHint')}</p>
                    ) : null}
                    </div>
                    )}

                    {canReportIssue && (
                        <button
                            type="button"
                            onClick={() => setIssueModalOpen(true)}
                            className="w-full py-3 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-colors shadow-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-100 border border-amber-500/30"
                        >
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span className="truncate">{t('media.reportIssue')}</span>
                        </button>
                    )}

                    {availability && availability.kind !== 'none' && (
                        <div className="col-span-2 md:col-span-1">
                            <MediaStatusPanel
                                state={availability}
                                onViewRequests={availability.hasUserRequest ? openMyRequests : undefined}
                                onRetry={availability.kind === 'failed' ? handleRetryRequest : undefined}
                                libraryAction={
                                    ['available', 'partial'].includes(availability.kind)
                                        ? (
                                            <OpenInLibraryButton
                                                mediaType={mediaType}
                                                tmdbId={mediaId}
                                                title={title}
                                                year={year}
                                                mediaInfo={details.mediaInfo}
                                                mediaServerType={mediaServerType}
                                                className="w-full px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                                                onError={(message) => pushToast?.(message, 'error')}
                                            />
                                        )
                                        : undefined
                                }
                                arrAction={
                                    isAdmin
                                    && ['available', 'partial', 'processing', 'requested', 'pending'].includes(availability.kind)
                                        ? (
                                            <OpenInArrButton
                                                mediaType={mediaType}
                                                tmdbId={mediaId}
                                                title={title}
                                                year={year}
                                                className="w-full px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                                                onError={(message) => pushToast?.(message, 'error')}
                                            />
                                        )
                                        : undefined
                                }
                            />
                        </div>
                    )}

                    {details.homepage && (
                        <a
                            href={details.homepage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="col-span-2 md:col-span-1 w-full py-2.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-border text-text transition-colors"
                        >
                            <Globe className="w-4 h-4" /> {t('media.visitWebsite')}
                        </a>
                    )}
                    </div>
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-4 pb-2">
                    <div className="light-on-media hidden md:flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            {mediaType === 'movie' ? <Film className="w-3.5 h-3.5 text-plex" /> : <Tv className="w-3.5 h-3.5 text-plex" />}
                            <span className="text-[10px] font-bold uppercase tracking-widest text-plex">{mediaTypeLabel}</span>
                            {details.status && (
                                <>
                                    <span className="text-white/30">•</span>
                                    <span
                                        className="text-[10px] font-bold text-white/60 uppercase tracking-wide"
                                        title={t('media.tmdbProductionStatus')}
                                    >
                                        {details.status}
                                    </span>
                                </>
                            )}
                        </div>
                        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white leading-[1.05] tracking-tight drop-shadow-lg">
                            {title}
                        </h1>
                        {details.tagline && (
                            <p className="text-sm sm:text-base text-white/55 italic max-w-4xl">{details.tagline}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            {metaChips.map((chip) => (
                                <div
                                    key={chip.label}
                                    className="flex items-center gap-1.5 bg-black/45 px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/10 text-xs text-white/85 font-semibold shadow-sm"
                                >
                                    {chip.icon}
                                    {chip.label}
                                </div>
                            ))}
                            {voteCountLabel && (
                                <div className="bg-black/45 px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/10 text-xs text-white/80 font-semibold shadow-sm">
                                    {voteCountLabel}
                                </div>
                            )}
                        </div>
                        {details.genres?.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {details.genres.map((g: any) => (
                                    <button
                                        key={g.id}
                                        type="button"
                                        onClick={() => openGenre(g.id)}
                                        className="px-2.5 py-1 bg-white/[0.06] border border-white/10 rounded-lg text-xs font-semibold text-white/75 backdrop-blur-sm transition-colors hover:bg-plex/15 hover:border-plex/40 hover:text-white cursor-pointer"
                                    >
                                        {g.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="media-details-panel flex flex-col gap-4 max-w-5xl">
                    <p className="text-sm sm:text-base lg:text-[17px] text-text leading-relaxed">
                        {details.overview || t('media.noDescription')}
                    </p>

                    {details.genres?.length > 0 && (
                        <div className="flex flex-wrap gap-2 md:hidden">
                            {details.genres.map((g: any) => (
                                <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => openGenre(g.id)}
                                    className="px-2.5 py-1 bg-white/5 border border-border rounded-lg text-xs font-semibold text-muted transition-colors hover:bg-plex/15 hover:border-plex/40 hover:text-text cursor-pointer"
                                >
                                    {g.name}
                                </button>
                            ))}
                        </div>
                    )}

                    {releaseDateRows.length > 0 && (
                        <div className="w-fit max-w-full rounded-xl border border-border bg-white/5 overflow-hidden">
                            <div
                                className={`grid divide-border ${
                                    releaseDateRows.length === 1
                                        ? 'grid-cols-1'
                                        : releaseDateRows.length === 2
                                            ? 'grid-cols-2 divide-x'
                                            : 'grid-cols-3 divide-x'
                                }`}
                            >
                                {releaseDateRows.map((row) => {
                                    const Icon = row.icon;
                                    return (
                                        <div
                                            key={row.key}
                                            className="group relative px-3 py-2.5 flex items-start gap-2 min-w-0 sm:min-w-[8.5rem]"
                                        >
                                            <div className="relative w-7 h-7 shrink-0 rounded-lg bg-white/5 border border-border flex items-center justify-center group-hover:border-plex/30 group-hover:bg-plex/10 transition-colors">
                                                <Icon className="w-3.5 h-3.5 text-muted group-hover:text-plex transition-colors" aria-hidden />
                                            </div>
                                            <div className="relative flex flex-col gap-0.5 min-w-0 pt-0.5">
                                                <span className="text-[9px] font-bold uppercase tracking-wider text-muted leading-none">
                                                    {row.label}
                                                </span>
                                                <span className="text-xs font-semibold text-text leading-snug">
                                                    {row.date}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <MediaOverviewExtras
                        mediaType={mediaType}
                        mediaId={mediaId}
                        details={details}
                        ratings={ratings}
                        onOpenPerson={openPerson}
                        onOpenKeyword={openKeyword}
                        onOpenStudio={openStudio}
                        onOpenNetwork={openNetwork}
                        onOpenCollection={(collectionId) => {
                            window.open(`https://www.themoviedb.org/collection/${collectionId}`, '_blank', 'noopener,noreferrer');
                        }}
                    />

                    {extraDetails.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                            {extraDetails.map((row) => (
                                <div key={row.label} className="flex flex-col gap-0.5 min-w-0">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted">{row.label}</span>
                                    <span className="text-sm text-text">{row.value}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    </div>
                </div>
                    </div>
                </div>
            </div>

            {/* Cast / seasons / recommendations stay on the same page card */}
            <div className="relative z-10 w-full max-w-[1600px] mx-auto page-x sm:px-8 xl:px-12 mt-2 md:mt-4 flex flex-col gap-8 md:gap-10 bg-card">
                {details.credits?.cast?.length > 0 && (
                    <section className="border-t border-border pt-8">
                        <SectionHeading>{t('media.topCast')}</SectionHeading>
                        <Carousel>
                            {details.credits.cast.slice(0, 15).map((actor: any) => (
                                <button
                                    key={actor.id}
                                    type="button"
                                    onClick={() => openPerson(actor.id)}
                                    className="group flex flex-col items-center gap-3 w-36 sm:w-40 flex-shrink-0 snap-start cursor-pointer transition-all duration-200 border-0 bg-transparent p-0 hover:-translate-y-1"
                                >
                                    <div className="w-32 h-32 rounded-full bg-white/5 border-2 border-border group-hover:border-plex/40 overflow-hidden ring-0 group-hover:ring-4 group-hover:ring-plex/10 transition-all">
                                        {actor.profilePath ? (
                                            <img
                                                src={`https://image.tmdb.org/t/p/w342${actor.profilePath}`}
                                                alt={actor.name}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-muted bg-white/5">
                                                <Users className="w-10 h-10" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-center w-full px-1">
                                        <div className="text-sm font-bold text-text leading-tight line-clamp-2 group-hover:text-plex transition-colors">{actor.name}</div>
                                        <div className="text-xs text-muted mt-1 leading-snug line-clamp-2">{actor.character}</div>
                                    </div>
                                </button>
                            ))}
                        </Carousel>
                    </section>
                )}

                {mediaType === 'tv' && seasonRows.length > 0 && (
                    <section className="border-t border-border pt-8">
                        <SectionHeading>{t('media.seasons')}</SectionHeading>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {seasonRows.map((season) => (
                                <button
                                    key={season.seasonNumber}
                                    type="button"
                                    onClick={() => setEpisodesSeason({
                                        seasonNumber: season.seasonNumber,
                                        name: season.name,
                                        episodeCount: season.episodeCount,
                                        statusLabel: season.statusLabel,
                                        posterPath: season.posterPath,
                                    })}
                                    className="bg-white/5 border border-border rounded-xl p-3 flex gap-3 items-center min-w-0 text-left hover:bg-white/10 hover:border-plex/30 transition-colors cursor-pointer"
                                >
                                    <div className="w-11 h-16 rounded-md overflow-hidden flex-shrink-0 bg-white/5 border border-border">
                                        {season.posterPath ? (
                                            <img src={resolveTmdbImageUrl(season.posterPath, 'w92')} className="w-full h-full object-cover" alt="" />
                                        ) : (
                                            <NoPosterPlaceholder compact />
                                        )}
                                    </div>
                                    <div className="flex flex-col min-w-0 gap-1">
                                        <span className="font-bold text-text text-sm truncate">{season.name}</span>
                                        <span className="text-xs text-muted">{t('common.episodeCount', { count: season.episodeCount })}</span>
                                        <span className={`self-start ${mediaStatusChipClass} ${seasonStatusBadgeClass(season.statusLabel, season.requestable)}`}>
                                            {translateDiscoverStatus(t, season.statusLabel)}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {visibleRecommendations.length > 0 && (
                    <section className="border-t border-border pt-8 pb-4">
                        <SectionHeading>{t('media.recommendations')}</SectionHeading>
                        <Carousel>
                            {visibleRecommendations.map((item, idx) => {
                                const formatted = formatItem(item);
                                return (
                                    <div key={`${formatted.id}-${idx}`} className="w-[120px] sm:w-[140px] flex-shrink-0 snap-start">
                                        <DiscoverPosterCard
                                            item={formatted}
                                            overlay={formatted.overlay}
                                            showQualityBadges={false}
                                            onPosterClick={() => openMedia(formatted.type, formatted.id)}
                                        />
                                    </div>
                                );
                            })}
                        </Carousel>
                    </section>
                )}
            </div>
        </div>
        <RequestModal
            open={requestModalOpen}
            mediaType={mediaType}
            mediaId={mediaId}
            title={title}
            posterPath={details.posterPath}
            overview={details.overview}
            onClose={() => setRequestModalOpen(false)}
            onSuccess={handleRequestSuccess}
            onNotifyChange={(watching) => setRequestNotify((prev) => ({
                ...prev,
                canNotify: true,
                isWatching: watching,
            }))}
            onError={(msg) => pushToast?.(msg, 'error')}
        />
        {mediaType === 'tv' && episodesSeason ? (
            <SeasonEpisodesModal
                open
                mediaId={mediaId}
                showTitle={title}
                showYear={year || undefined}
                showPosterPath={details.posterPath}
                seasonNumber={episodesSeason.seasonNumber}
                seasonName={episodesSeason.name}
                episodeCount={episodesSeason.episodeCount}
                statusLabel={episodesSeason.statusLabel}
                onClose={() => setEpisodesSeason(null)}
            />
        ) : null}
        {canReportIssue && (
            <ReportIssueModal
                open={issueModalOpen}
                mediaType={mediaType}
                title={title}
                seerrMediaId={Number.isFinite(seerrMediaId) && seerrMediaId > 0 ? seerrMediaId : null}
                tmdbId={Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null}
                onClose={() => setIssueModalOpen(false)}
                onSuccess={(msg) => pushToast?.(msg, 'success')}
                onError={(msg) => pushToast?.(msg, 'error')}
            />
        )}
        </>
    );
};
