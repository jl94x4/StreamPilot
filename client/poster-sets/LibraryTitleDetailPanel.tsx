import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CheckCircle2,
    ChevronLeft,
    Eye,
    Image as ImageIcon,
    Loader2,
    Ban,
    PanelRight,
    RotateCcw,
    Square,
    X,
} from 'lucide-react';
import { askConfirm } from '../shared/confirm';
import { ModalPortal } from '../shared/ModalPortal';
import { posterSetsApi, PosterSetsTitleWatchConflict } from './api';
import { addWatchWithTitleReplaceConfirm, confirmReplaceTitleWatch } from './pinWatch';
import { overlappingTitleWatches } from './watchArtSlots';
import { isPosterSetsUpstreamOutage } from './upstreamErrors';
import { pickAutoMatchedTitle, rankSearchTitlesForLibraryItem, catalogTitleMatchesLibraryItem } from './autoMatchTitle';
import { fetchPosterSetsForTitle } from './fetchPosterSetsForTitle';
import { collapseNearDuplicateSets, excludeBlockedCreators, prioritizeSetsByFollowedCreators } from './prioritizeCreatorSets';
import { classifyPreviewAsset, groupPreviewAssets, inspectorThumbsFromAssets } from './previewGroups';
import { libraryItemPosterSrc, type LibraryRecentItem } from './libraryRecent';
import { SetInspector, SetInspectorThumbStrip } from './SetInspector';
import { PreviewAssetGallery } from './shared/posterSetsPreview';
import {
    mediuxFiltersFromAssets,
    type PosterSetsPreview,
    type PosterSetsPreviewAsset,
    type PosterSetsSearchSet,
    type PosterSetsSearchTitle,
    type PosterSetsSetMeta,
    type PosterSetsTitleStatus,
    type PosterSetsWatch,
} from './types';
import { ProviderCornerBadge } from './shared/posterSetsPills';
import { CopyTitleButton } from './shared/posterSetsCards';
import {
    inferRecentSetKindFromAssets,
    inferRecentSetKindFromFilters,
    isTitleCardSet,
    isExclusiveTitleCardSet,
    partitionSetsByCategory,
    SEARCH_SET_CATEGORY_ORDER,
} from './shared/posterSetsRecent';
import { cardClass, type LibraryDetailLayout } from './shared/posterSetsUi';
import {
    captureElementScroll,
    restoreElementScroll,
    scheduleScrollRestore,
} from './shared/posterSetsScroll';

const TITLE_CARD_ONLY_FILTERS = ['title_card'];
const SETS_PAGE_SIZE_DRAWER = 16;
const SETS_PAGE_SIZE_MODAL = 36;

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';
const primaryButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-plex px-2.5 py-1.5 text-xs font-bold text-background transition hover:bg-plex-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';
const fieldClass = 'w-full appearance-none rounded-lg border border-white/10 bg-background/70 px-3 py-2 text-[16px] leading-5 text-text placeholder:text-muted/60 outline-none transition focus:border-plex focus:ring-1 focus:ring-plex sm:py-2.5';

function PosterThumb({
    src,
    alt,
    className = '',
    imgClassName = '',
}: {
    src: string;
    alt: string;
    className?: string;
    imgClassName?: string;
}) {
    if (!src) {
        return (
            <div className={`flex items-center justify-center bg-black/40 text-muted ${className}`}>
                <ImageIcon className="h-10 w-10 opacity-30" />
            </div>
        );
    }
    return (
        <div className={className}>
            <img src={src} alt={alt} className={imgClassName} loading="lazy" />
        </div>
    );
}

const formatWhen = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export type LibraryTitleDetailPanelProps = {
    item: LibraryRecentItem | null;
    onClose: () => void;
    dupePreference: 'mediux' | 'posterdb';
    /** Followed creators — their sets appear first in title search. */
    preferredCreators?: string[];
    /** Blocked creators — hidden from this title's set grid. */
    blockedCreators?: string[];
    onBlockCreator?: (handle: string) => Promise<void> | void;
    queuePaused: boolean;
    watches: PosterSetsWatch[];
    serverType?: string;
    layoutMode?: LibraryDetailLayout;
    /** Full-screen (in-page) panel is hidden when the Library tab is not active. */
    pageVisible?: boolean;
    onLayoutModeChange?: (layout: LibraryDetailLayout) => void;
    toast: (message: string, type?: 'success' | 'error') => void;
    onApplied?: () => void;
    onWatchAdded?: () => void;
    onArtReset?: () => void;
    /** When false, skip long TPDB waits and show login hint instead of empty-set toast. */
    tpdbConfigured?: boolean;
    tpdbEnabled?: boolean;
    mediuxEnabled?: boolean;
    onOpenTpdbSettings?: () => void;
    showCopyTitle?: boolean;
};

export function LibraryTitleDetailPanel({
    item,
    onClose,
    dupePreference,
    preferredCreators = [],
    blockedCreators = [],
    onBlockCreator,
    queuePaused,
    watches,
    toast,
    onApplied,
    onWatchAdded,
    onArtReset,
    serverType = 'plex',
    layoutMode = 'modal',
    pageVisible = true,
    onLayoutModeChange,
    tpdbConfigured = false,
    tpdbEnabled = true,
    mediuxEnabled = true,
    onOpenTpdbSettings,
    showCopyTitle = false,
}: LibraryTitleDetailPanelProps) {
    const [busy, setBusy] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMoreSets, setLoadingMoreSets] = useState(false);
    const [mediuxSettled, setMediuxSettled] = useState(false);
    const [tpdbSettled, setTpdbSettled] = useState(false);
    const [tpdbFromCache, setTpdbFromCache] = useState(false);
    const [titleStatus, setTitleStatus] = useState<PosterSetsTitleStatus | null>(null);
    const [statusLoading, setStatusLoading] = useState(false);
    const [resetScope, setResetScope] = useState<'poster' | 'seasons' | 'episodes' | 'all'>('poster');
    const [searchTitles, setSearchTitles] = useState<PosterSetsSearchTitle[]>([]);
    const [searchSets, setSearchSets] = useState<PosterSetsSearchSet[]>([]);
    const [searchContext, setSearchContext] = useState('');
    const [selectedTitle, setSelectedTitle] = useState<PosterSetsSearchTitle | null>(null);
    const [selectedSet, setSelectedSet] = useState<PosterSetsSearchSet | null>(null);
    const [preview, setPreview] = useState<PosterSetsPreview | null>(null);
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [showAssets, setShowAssets] = useState(false);
    const [titleCardsOnly, setTitleCardsOnly] = useState(false);
    const [setsPage, setSetsPage] = useState(1);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const scrollBodyRef = useRef<HTMLDivElement | null>(null);
    const setsScrollTopRef = useRef(0);
    const loadGenRef = useRef(0);

    const watchedUrlSet = useMemo(() => {
        const urls = new Set<string>();
        const setKeys = new Set<string>();
        for (const watch of watches) {
            const url = String(watch.url || '').trim();
            if (url) urls.add(url);
            const setId = watch.setId != null ? String(watch.setId) : '';
            const provider = String(watch.provider || '').toLowerCase();
            if (setId) setKeys.add(`${provider}:${setId}`);
        }
        return { urls, setKeys };
    }, [watches]);

    const isSetWatched = useCallback((set: { url?: string | null; setId?: string | null; provider?: string | null }) => {
        const url = String(set.url || '').trim();
        if (url && watchedUrlSet.urls.has(url)) return true;
        const setId = set.setId != null ? String(set.setId) : '';
        if (!setId) return false;
        const provider = String(set.provider || '').toLowerCase();
        return watchedUrlSet.setKeys.has(`${provider}:${setId}`);
    }, [watchedUrlSet]);

    const resetState = useCallback(() => {
        setBusy(null);
        setLoading(false);
        setLoadingMoreSets(false);
        setMediuxSettled(false);
        setTpdbSettled(false);
        setTpdbFromCache(false);
        setSearchTitles([]);
        setSearchSets([]);
        setSearchContext('');
        setSelectedTitle(null);
        setSelectedSet(null);
        setPreview(null);
        setSelectedAssetIds([]);
        setShowAssets(false);
        setTitleCardsOnly(false);
        setSetsPage(1);
        setTitleStatus(null);
    }, []);

    const backToSets = useCallback(() => {
        setPreview(null);
        setSelectedSet(null);
        setSelectedAssetIds([]);
        setShowAssets(false);
        setTitleCardsOnly(false);
        const top = setsScrollTopRef.current;
        scheduleScrollRestore(() => restoreElementScroll(scrollBodyRef.current, top));
    }, []);

    const loadSetsForTitle = useCallback(async (
        title: PosterSetsSearchTitle,
        libraryItem?: LibraryRecentItem | null,
        generation?: number,
    ) => {
        const gen = generation ?? loadGenRef.current;
        const stillCurrent = () => gen === loadGenRef.current;
        if (!stillCurrent()) return;

        setBusy('search');
        setSearchSets([]);
        setSelectedTitle(title);
        setSelectedSet(null);
        setPreview(null);
        const hasLinkedTmdb = String(title.provider || '').toLowerCase() === 'mediux' && Boolean(title.id);
        const waitForTpdb = hasLinkedTmdb && tpdbConfigured && tpdbEnabled;
        setMediuxSettled(!mediuxEnabled);
        setTpdbSettled(!tpdbEnabled);
        setTpdbFromCache(false);
        if (hasLinkedTmdb) setLoadingMoreSets(true);
        try {
            const response = await fetchPosterSetsForTitle(title, {
                dupePreference,
                mediaType: libraryItem?.mediaType,
                libraryItem: libraryItem || undefined,
                preferredCreators,
                blockedCreators,
                tpdbConfigured,
                tpdbEnabled,
                mediuxEnabled,
                onPartial: (partial) => {
                    if (!stillCurrent()) return;
                    if ((partial.sets?.length || 0) > 0) {
                        setSearchSets(partial.sets || []);
                        setSearchContext(partial.title || title.title);
                        setLoading(false);
                        if (partial.fromCache) setTpdbFromCache(true);
                        // Unlock as soon as either provider paints sets.
                        setBusy((current) => (current === 'search' ? null : current));
                        const hasPosterdb = (partial.sets || []).some((set) => {
                            const provider = String(set.provider || '').toLowerCase();
                            return provider === 'posterdb' || provider === 'tpdb' || provider === 'theposterdb';
                        });
                        if (partial.fromCache || hasPosterdb || !waitForTpdb) {
                            setLoadingMoreSets(Boolean(waitForTpdb && !partial.fromCache && !hasPosterdb));
                        } else {
                            setLoadingMoreSets(true);
                        }
                    }
                },
                onMediuxSettled: (mediux) => {
                    if (!stillCurrent()) return;
                    setMediuxSettled(true);
                    setLoading(false);
                    setBusy((current) => (current === 'search' ? null : current));
                    if ((mediux.sets?.length || 0) > 0 && !waitForTpdb && tpdbConfigured === false) {
                        setLoadingMoreSets(false);
                    }
                },
                onTpdbSettled: (tpdb) => {
                    if (!stillCurrent()) return;
                    setTpdbSettled(true);
                    if (tpdb?.fromCache) setTpdbFromCache(true);
                    setLoading(false);
                    setBusy((current) => (current === 'search' ? null : current));
                    // TPDB done (cache or live) — stop blocking on MediUX for perceived speed.
                    setLoadingMoreSets(false);
                },
            });
            if (!stillCurrent()) return;
            // Never wipe painted MediUX sets with an empty final merge.
            setSearchSets((prev) => {
                const next = response.sets || [];
                return next.length > 0 ? next : prev;
            });
            setSetsPage(1);
            if (libraryItem && !catalogTitleMatchesLibraryItem(libraryItem, title)) {
                setSearchSets([]);
                setSelectedTitle(null);
                setSearchContext('');
                toast(`Couldn't confirm a match for "${libraryItem.title}" — pick the correct title.`, 'error');
                return;
            }
            const responseLooksRight = catalogTitleMatchesLibraryItem(
                libraryItem || { title: title.title, mediaType: (title.mediaType as 'movie' | 'show') || 'movie' },
                { title: response.title || title.title, year: title.year, mediaType: title.mediaType },
            );
            setSearchContext(responseLooksRight ? (response.title || title.title) : title.title);
            setSearchTitles([]);
            if (response.partialErrors?.length) {
                const msg = response.partialErrors[0];
                if (msg.includes('ThePosterDB login not configured')) {
                    // Inline banner handles this — avoid misleading green toast.
                } else if (
                    msg.includes('Serving cached ThePosterDB')
                    || msg.includes('loaded from local')
                ) {
                    // Permanent local cache hit — never toast as an error.
                } else if (
                    msg.includes('taking longer')
                    || msg.includes('timed out')
                    || msg.includes('still searching')
                    || msg.includes('ThePosterDB returned no sets')
                    || msg.includes('ThePosterDB search timed out')
                    || msg.includes('MediUX search timed out')
                    || isPosterSetsUpstreamOutage(msg)
                ) {
                    toast(msg);
                } else {
                    toast(msg, 'error');
                }
            }
        } catch (error) {
            if (!stillCurrent()) return;
            toast(error instanceof Error ? error.message : 'Failed to load sets', 'error');
        } finally {
            if (!stillCurrent()) return;
            // Don't clobber an in-flight preview/apply/watch started during TPDB wait.
            setBusy((current) => (current === 'search' ? null : current));
            setLoadingMoreSets(false);
        }
    }, [blockedCreators, dupePreference, preferredCreators, toast, tpdbConfigured]);

    const runSearch = useCallback(async (libraryItem: LibraryRecentItem) => {
        const generation = ++loadGenRef.current;
        setLoading(true);
        setLoadingMoreSets(false);
        setMediuxSettled(false);
        setTpdbSettled(false);
        setTpdbFromCache(false);
        setSearchTitles([]);
        setSearchSets([]);
        setSearchContext('');
        setSelectedTitle(null);
        setSelectedSet(null);
        setPreview(null);
        setSetsPage(1);

        const queries = [libraryItem.title];

        try {
            const tmdbId = String(libraryItem.tmdbId || '').trim();
            if (tmdbId) {
                const directTitle: PosterSetsSearchTitle = {
                    id: tmdbId,
                    title: libraryItem.title,
                    year: libraryItem.year ?? null,
                    url: libraryItem.mediaType === 'show'
                        ? `https://mediux.pro/shows/${tmdbId}`
                        : `https://mediux.pro/movies/${tmdbId}`,
                    mediaType: libraryItem.mediaType,
                    provider: 'mediux',
                    thumbUrl: '',
                };
                if (generation !== loadGenRef.current) return;
                setLoading(false);
                setLoadingMoreSets(true);
                await loadSetsForTitle(directTitle, libraryItem, generation);
                return;
            }

            const responses = await Promise.all(queries.map((query) => posterSetsApi.search({
                provider: 'mediux',
                query,
                mode: 'title',
                dupePreference,
                limit: 24,
                mediaType: libraryItem.mediaType,
                titleHint: libraryItem.title,
                yearHint: libraryItem.year ?? undefined,
            })));

            if (generation !== loadGenRef.current) return;

            let autoMatch: PosterSetsSearchTitle | null = null;
            let titles: PosterSetsSearchTitle[] = [];
            let response: (typeof responses)[number] | null = null;

            for (const result of responses) {
                titles = [...titles, ...(result.titles || [])];
                response = result;
                const match = pickAutoMatchedTitle(libraryItem, result.titles || []);
                if (match) {
                    autoMatch = match;
                    break;
                }
            }

            if (generation !== loadGenRef.current) return;

            if (autoMatch) {
                setLoading(false);
                setLoadingMoreSets(true);
                await loadSetsForTitle(autoMatch, libraryItem, generation);
                return;
            }

            setSearchTitles(rankSearchTitlesForLibraryItem(libraryItem, titles));
            setSearchSets(response?.sets || []);
            setSearchContext(response?.title || libraryItem.title);
            if (response?.partialErrors?.length) {
                const msg = response.partialErrors[0];
                const soft = msg.includes('ThePosterDB returned no sets')
                    || msg.includes('ThePosterDB search timed out')
                    || isPosterSetsUpstreamOutage(msg);
                toast(msg, soft ? undefined : 'error');
            }
        } catch (error) {
            if (generation === loadGenRef.current) {
                toast(error instanceof Error ? error.message : 'Search failed', 'error');
            }
        } finally {
            if (generation === loadGenRef.current) setLoading(false);
        }
    }, [dupePreference, loadSetsForTitle, toast]);

    useEffect(() => {
        if (!item) {
            resetState();
            return;
        }
        void runSearch(item);
    }, [item, resetState, runSearch]);

    const refreshTitleStatus = useCallback(async () => {
        if (!item) return;
        setStatusLoading(true);
        try {
            const response = await posterSetsApi.titleStatus({
                title: item.title,
                mediaType: item.mediaType,
                ratingKey: item.id,
                tmdbId: item.tmdbId ? String(item.tmdbId) : undefined,
            });
            setTitleStatus(response);
        } catch {
            setTitleStatus(null);
        } finally {
            setStatusLoading(false);
        }
    }, [item]);

    useEffect(() => {
        if (!item) {
            setTitleStatus(null);
            return;
        }
        void refreshTitleStatus();
    }, [item, refreshTitleStatus]);

    const titleWatchEnabled = titleStatus?.titleWatch?.enabled === true;
    const titleWatchSetUrl = String(
        selectedSet?.url
        || preview?.url
        || titleStatus?.titleWatch?.url
        || titleStatus?.lastApply?.url
        || '',
    ).trim();
    const lastApplyMatchesSet = (set?: { url?: string | null } | null) => {
        const applyUrl = String(titleStatus?.lastApply?.url || '').trim();
        const setUrl = String(set?.url || '').trim();
        return Boolean(applyUrl && setUrl && applyUrl === setUrl);
    };

    const runResetArt = async () => {
        if (!item) return;
        const scopeLabel = item.mediaType === 'movie'
            ? 'poster'
            : resetScope === 'all'
                ? 'show poster, all season posters, and all episode thumbs'
                : resetScope === 'seasons'
                    ? 'show and season posters'
                    : resetScope === 'episodes'
                        ? 'all episode thumbs'
                        : 'show poster only';
        const ok = await askConfirm(
            `Reset ${scopeLabel} for “${item.title}” to Plex defaults? Custom art from poster sets will be cleared.`,
            {
                title: 'Reset artwork?',
                confirmLabel: 'Reset',
                cancelLabel: 'Cancel',
            },
        );
        if (!ok) return;
        setBusy('reset');
        try {
            await posterSetsApi.resetArt({
                ratingKey: item.id,
                mediaType: item.mediaType,
                scope: item.mediaType === 'movie' ? 'poster' : resetScope,
            });
            toast('Artwork reset to Plex defaults.');
            onArtReset?.();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to reset artwork', 'error');
        } finally {
            setBusy(null);
        }
    };

    useEffect(() => {
        if (!item) return undefined;
        if (layoutMode === 'modal' && !pageVisible) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (preview || selectedSet) {
                backToSets();
                return;
            }
            onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [item, layoutMode, pageVisible, onClose, preview, selectedSet, backToSets]);

    useEffect(() => {
        if (!item || layoutMode !== 'modal' || !pageVisible) return;
        requestAnimationFrame(() => {
            panelRef.current?.scrollIntoView({ block: 'nearest' });
        });
    }, [item?.id, layoutMode, pageVisible]);

    const currentSetMeta = (): PosterSetsSetMeta | null => {
        if (!selectedSet && !preview?.setMeta) return null;
        const previewMeta = preview?.setMeta;
        const selected = selectedAssetIds.length && preview?.assets?.length
            ? preview.assets.filter((asset) => selectedAssetIds.includes(asset.id))
            : [];
        const mediuxFilters = selected.length ? mediuxFiltersFromAssets(selected) : undefined;
        const setKind = inferRecentSetKindFromFilters(mediuxFilters)
            || (titleCardsOnly || isExclusiveTitleCardSet(selectedSet, { mediaType: item?.mediaType })
                ? 'title_cards'
                : null);
        return {
            provider: selectedSet?.provider || previewMeta?.provider || null,
            setId: selectedSet?.setId || previewMeta?.setId || null,
            url: selectedSet?.url || previewMeta?.url || null,
            title: previewMeta?.title || selectedSet?.title || item?.title || null,
            user: previewMeta?.user || selectedSet?.user || null,
            tmdbId: item?.tmdbId != null ? String(item.tmdbId) : previewMeta?.tmdbId || null,
            tvdbId: item?.tvdbId != null ? String(item.tvdbId) : previewMeta?.tvdbId || null,
            thumbUrl: selectedSet?.thumbUrl || previewMeta?.thumbUrl || '',
            assetCount: selectedSet?.posterCount ?? preview?.total ?? previewMeta?.assetCount ?? null,
            setKind,
            mediuxFilters: mediuxFilters?.length ? mediuxFilters : undefined,
        };
    };

    const toggleTitleWatch = async (enabled?: boolean) => {
        if (!item) return;
        const nextEnabled = enabled ?? !titleWatchEnabled;
        if (nextEnabled && !titleWatchSetUrl) {
            toast('Apply a poster set first, or select a set to watch.', 'error');
            return;
        }
        let replacedTitleWatch = false;
        if (nextEnabled) {
            const target = String(titleWatchSetUrl || '').trim();
            const meta = currentSetMeta();
            const others = overlappingTitleWatches(
                watches,
                {
                    url: target,
                    title: item.title,
                    tmdbId: item.tmdbId != null ? String(item.tmdbId) : null,
                    setKind: meta?.setKind,
                    mediuxFilters: meta?.mediuxFilters,
                    plexHint: { ratingKey: item.id },
                },
                (watch) => {
                    const itemTmdb = String(item.tmdbId || '').trim();
                    if (item.id && String(watch.plexHint?.ratingKey || '') === String(item.id)) return true;
                    if (itemTmdb && String(watch.tmdbId || '') === itemTmdb) return true;
                    return String(watch.title || '').trim().toLowerCase() === item.title.trim().toLowerCase();
                },
            );
            if (others.length) {
                const confirmed = await confirmReplaceTitleWatch(new PosterSetsTitleWatchConflict({
                    existing: others,
                    incoming: {
                        title: item.title,
                        url: target,
                        user: meta?.user,
                        provider: meta?.provider,
                        setKind: meta?.setKind,
                        mediuxFilters: meta?.mediuxFilters || undefined,
                    } as PosterSetsWatch,
                    error: `Already watching a set for ${item.title}.`,
                }));
                if (!confirmed) return;
                replacedTitleWatch = true;
            }
        }
        setBusy('title-watch');
        try {
            await posterSetsApi.titleWatch({
                title: item.title,
                mediaType: item.mediaType,
                ratingKey: item.id,
                setUrl: titleWatchSetUrl || undefined,
                enabled: nextEnabled,
                setMeta: nextEnabled ? currentSetMeta() : undefined,
                tmdbId: item.tmdbId ? String(item.tmdbId) : undefined,
            });
            toast(nextEnabled
                ? (replacedTitleWatch ? 'Replaced the watched set for this title.' : 'Watching this title for poster updates.')
                : 'Stopped watching this title.');
            await refreshTitleStatus();
            onWatchAdded?.();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to update title watch', 'error');
        } finally {
            setBusy(null);
        }
    };

    const filtersForSelectedIds = (ids: string[]) => {
        if (!ids.length) return undefined;
        const byId = new Map((preview?.assets || []).map((asset) => [asset.id, asset]));
        const selected = ids.map((id) => byId.get(id)).filter(Boolean) as PosterSetsPreviewAsset[];
        const filters = mediuxFiltersFromAssets(selected);
        return filters.length ? filters : undefined;
    };

    const selectedAssetsForIds = (ids: string[]) => {
        if (!ids.length) return undefined;
        const byId = new Map((preview?.assets || []).map((asset) => [asset.id, asset]));
        const assets = ids
            .map((id) => byId.get(id))
            .filter((asset): asset is PosterSetsPreviewAsset => Boolean(asset?.thumbUrl));
        if (!assets.length) return undefined;
        return assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            title: asset.title,
            year: asset.year ?? null,
            season: asset.season ?? null,
            episode: asset.episode ?? null,
            url: asset.thumbUrl,
            thumbUrl: asset.thumbUrl,
            source: asset.source,
            fileType: asset.fileType ?? null,
        }));
    };

    const runPreview = async (set: PosterSetsSearchSet) => {
        const target = String(set.url || '').trim();
        if (!target) {
            toast('This set is missing a URL.', 'error');
            return;
        }
        const restrictTitleCards = isExclusiveTitleCardSet(set, { mediaType: item?.mediaType });
        setsScrollTopRef.current = captureElementScroll(scrollBodyRef.current);
        setSelectedSet(set);
        setTitleCardsOnly(restrictTitleCards);
        setShowAssets(false);
        setBusy('preview');
        try {
            const response = await posterSetsApi.preview(
                target,
                restrictTitleCards ? TITLE_CARD_ONLY_FILTERS : undefined,
            );
            setPreview(response);
            if (!restrictTitleCards && inferRecentSetKindFromAssets(response.assets) === 'title_cards') {
                setTitleCardsOnly(true);
            }
            const assets = response.assets || [];
            const matchedIds = assets.filter((asset) => asset.matched === true).map((asset) => asset.id);
            setSelectedAssetIds(matchedIds.length ? matchedIds : assets.map((asset) => asset.id));
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Preview failed', 'error');
            setPreview(null);
        } finally {
            setBusy(null);
        }
    };

    const applyMatched = async () => {
        const target = String(selectedSet?.url || preview?.url || '').trim();
        if (!target) {
            toast('This set is missing a URL.', 'error');
            return;
        }
        if (!preview) {
            toast('Load the set preview first.', 'error');
            return;
        }
        const matchedIds = (preview.assets || []).filter((asset) => asset.matched === true).map((asset) => asset.id);
        const ids = selectedAssetIds.length ? selectedAssetIds : matchedIds;
        if (!ids.length) {
            toast('No posters to apply. Check at least one art type.', 'error');
            return;
        }
        setBusy('apply');
        try {
            await posterSetsApi.apply(
                target,
                ids,
                currentSetMeta(),
                undefined,
                filtersForSelectedIds(ids),
                {
                    ratingKey: item.id,
                    title: item.title,
                    mediaType: item.mediaType,
                },
                selectedAssetsForIds(ids),
            );
            toast(queuePaused
                ? `Queued ${ids.length} poster${ids.length === 1 ? '' : 's'} (queue paused).`
                : `Queued ${ids.length} poster${ids.length === 1 ? '' : 's'}.`);
            onApplied?.();
            await refreshTitleStatus();
            backToSets();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue apply', 'error');
        } finally {
            setBusy(null);
        }
    };

    const applySelected = async () => {
        const target = String(selectedSet?.url || preview?.url || '').trim();
        if (!target) {
            toast('This set is missing a URL.', 'error');
            return;
        }
        if (!preview) {
            toast('Load the set preview first.', 'error');
            return;
        }
        if (!selectedAssetIds.length) {
            toast('Select at least one asset to apply.', 'error');
            return;
        }
        const ids = [...selectedAssetIds];
        setBusy('apply');
        try {
            await posterSetsApi.apply(
                target,
                ids,
                currentSetMeta(),
                undefined,
                filtersForSelectedIds(ids),
                {
                    ratingKey: item.id,
                    title: item.title,
                    mediaType: item.mediaType,
                },
                selectedAssetsForIds(ids),
            );
            toast(queuePaused
                ? `Queued ${ids.length} selected asset(s) (queue paused).`
                : `Queued ${ids.length} selected asset(s).`);
            onApplied?.();
            await refreshTitleStatus();
            backToSets();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue apply', 'error');
        } finally {
            setBusy(null);
        }
    };

    const applyEntire = async () => {
        const target = String(selectedSet?.url || preview?.url || '').trim();
        if (!target) {
            toast('This set is missing a URL.', 'error');
            return;
        }
        if (!preview) {
            toast('Load the set preview first.', 'error');
            return;
        }
        const ok = await askConfirm('Queue the entire set, including posters not matched in your libraries?', {
            title: 'Queue full set?',
            confirmLabel: 'Add to queue',
            cancelLabel: 'Cancel',
        });
        if (!ok) return;
        setBusy('apply');
        try {
            // No selectedIds + no plexHint: multi-title franchise sets resolve each poster by title.
            await posterSetsApi.apply(
                target,
                undefined,
                currentSetMeta(),
                undefined,
                titleCardsOnly ? TITLE_CARD_ONLY_FILTERS : undefined,
            );
            toast(queuePaused
                ? 'Added full set to queue (paused — resume in Queue tab).'
                : 'Queued full set apply.');
            onApplied?.();
            await refreshTitleStatus();
            backToSets();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue apply', 'error');
        } finally {
            setBusy(null);
        }
    };

    const applyUnmatched = async () => {
        const target = String(selectedSet?.url || preview?.url || '').trim();
        if (!target || !preview) {
            toast('Load the set preview first.', 'error');
            return;
        }
        const unmatchedIds = (preview.assets || []).filter((asset) => asset.matched === false).map((asset) => asset.id);
        if (!unmatchedIds.length) {
            toast('No unmatched posters to queue.', 'error');
            return;
        }
        const ok = await askConfirm(
            `Queue ${unmatchedIds.length} unmatched poster${unmatchedIds.length === 1 ? '' : 's'} for apply?`,
            {
                title: 'Queue unmatched?',
                confirmLabel: 'Add to queue',
                cancelLabel: 'Cancel',
            },
        );
        if (!ok) return;
        setBusy('apply');
        try {
            await posterSetsApi.apply(
                target,
                unmatchedIds,
                currentSetMeta(),
                undefined,
                filtersForSelectedIds(unmatchedIds),
                undefined,
                selectedAssetsForIds(unmatchedIds),
            );
            toast(queuePaused
                ? `Queued ${unmatchedIds.length} unmatched poster(s) (queue paused).`
                : `Queued ${unmatchedIds.length} unmatched poster(s).`);
            onApplied?.();
            await refreshTitleStatus();
            backToSets();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue apply', 'error');
        } finally {
            setBusy(null);
        }
    };

    const addWatch = async (set: PosterSetsSearchSet) => {
        const target = String(set.url || '').trim();
        if (!target) return;
        if (isSetWatched(set)) {
            toast('Already watching this set.', 'error');
            return;
        }
        setBusy('watch');
        try {
            const result = await addWatchWithTitleReplaceConfirm({
                url: target,
                title: currentSetMeta()?.title || undefined,
                user: currentSetMeta()?.user || undefined,
                thumbUrl: currentSetMeta()?.thumbUrl || undefined,
                provider: currentSetMeta()?.provider || undefined,
                setId: currentSetMeta()?.setId || undefined,
                setKind: currentSetMeta()?.setKind,
                mediuxFilters: currentSetMeta()?.mediuxFilters || undefined,
                tmdbId: currentSetMeta()?.tmdbId || undefined,
                tvdbId: currentSetMeta()?.tvdbId || undefined,
            });
            if (result.cancelled) return;
            toast(result.replaced
                ? 'Replaced the watched set for this title.'
                : 'Watching set for updates.');
            onWatchAdded?.();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to add watch', 'error');
        } finally {
            setBusy(null);
        }
    };

    const matchedAssetCount = useMemo(
        () => (preview?.assets || []).filter((asset) => asset.matched === true).length,
        [preview],
    );

    const matchedThumbStrip = useMemo(() => {
        const selected = new Set(selectedAssetIds);
        let assets = preview?.assets || [];
        if (selected.size) {
            const filtered = assets.filter((asset) => selected.has(asset.id));
            if (filtered.length) assets = filtered;
            else assets = assets.filter((asset) => asset.matched === true);
        } else {
            assets = assets.filter((asset) => asset.matched === true);
        }
        if (titleCardsOnly) {
            const titleCards = assets.filter((asset) => classifyPreviewAsset(asset) === 'title_card');
            if (titleCards.length) assets = titleCards;
        }
        return inspectorThumbsFromAssets(
            assets,
            (url) => (url ? posterSetsApi.imageUrl(url) : ''),
        );
    }, [preview, titleCardsOnly, selectedAssetIds]);

    const previewSections = useMemo(
        () => groupPreviewAssets(preview?.assets || []),
        [preview],
    );

    const setsByCategory = useMemo(
        () => partitionSetsByCategory(
            excludeBlockedCreators(
                prioritizeSetsByFollowedCreators(
                    collapseNearDuplicateSets(searchSets).sets,
                    preferredCreators,
                ),
                blockedCreators,
            ),
            { mediaType: item?.mediaType },
        ),
        [searchSets, preferredCreators, blockedCreators, item?.mediaType],
    );
    const setsPageSize = layoutMode === 'modal' ? SETS_PAGE_SIZE_MODAL : SETS_PAGE_SIZE_DRAWER;
    const setsPageCount = Math.max(1, Math.ceil(setsByCategory.posters.length / setsPageSize));
    const paginatedPosters = useMemo(() => {
        const page = Math.min(Math.max(1, setsPage), setsPageCount);
        const start = (page - 1) * setsPageSize;
        return setsByCategory.posters.slice(start, start + setsPageSize);
    }, [setsByCategory.posters, setsPage, setsPageCount, setsPageSize]);

    const selectedSetUsesLandscape = useMemo(() => {
        if (titleCardsOnly || isTitleCardSet(selectedSet, { mediaType: item?.mediaType })) return true;
        if (selectedAssetIds.length && preview?.assets?.length) {
            const selected = new Set(selectedAssetIds);
            const picked = preview.assets.filter((asset) => selected.has(asset.id));
            if (picked.length && picked.every((asset) => classifyPreviewAsset(asset) === 'title_card')) return true;
        }
        return inferRecentSetKindFromAssets(preview?.assets) === 'title_cards';
    }, [preview?.assets, selectedSet, titleCardsOnly, item?.mediaType, selectedAssetIds]);

    const readyToApply = Boolean(preview && !busy);
    // Background TPDB fetch uses busy='search' / loadingMoreSets — keep MediUX sets clickable.
    const interactionLocked = busy !== null && busy !== 'search';
    const headerLabel = item
        ? (item.year ? `${item.title} (${item.year})` : item.title)
        : '';

    if (!item) return null;

    const isModalLayout = layoutMode === 'modal';
    // Cap card width so wide drawer/modal don't blow posters up when few sets match.
    const setsGridClass = isModalLayout
        ? 'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,11rem))] justify-start gap-3'
        : 'grid grid-cols-[repeat(auto-fill,minmax(7.5rem,9.5rem))] justify-start gap-2.5';
    const setsGridClassLandscape = isModalLayout
        ? 'grid grid-cols-[repeat(auto-fill,minmax(12rem,16rem))] justify-start gap-3'
        : 'grid grid-cols-[repeat(auto-fill,minmax(10rem,13rem))] justify-start gap-2.5';
    const panelShellClass = isModalLayout
        ? [
            cardClass,
            'flex w-full flex-col',
            'h-[calc(100dvh-11rem)] min-h-[32rem] max-h-[calc(100dvh-11rem)]',
            'max-md:h-[calc(100dvh-14.5rem)] max-md:max-h-[calc(100dvh-14.5rem)]',
        ].join(' ')
        : [
            'fixed top-0 right-0 z-[330] flex h-auto w-full max-w-[min(100%,520px)] flex-col border-l border-white/10 bg-card pt-[env(safe-area-inset-top,0px)] shadow-2xl',
            'bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
            'md:inset-y-0 md:bottom-0 md:h-auto md:max-h-none md:max-w-[min(100%,1040px)]',
        ].join(' ');

    const panel = (
            <div
                ref={panelRef}
                className={panelShellClass}
            >
                <div className={`flex shrink-0 items-start gap-3 border-b border-white/10 bg-black/20 p-4 sm:p-5 ${isModalLayout ? 'rounded-t-2xl' : 'md:rounded-t-2xl'}`}>
                    <div className={`group/poster relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-black ${
                        isModalLayout ? 'h-28 w-20 sm:h-36 sm:w-24' : 'h-20 w-14'
                    }`}>
                        <PosterThumb
                            src={libraryItemPosterSrc(item)}
                            alt={item.title}
                            className="absolute inset-0 h-full w-full"
                            imgClassName="absolute inset-0 h-full w-full object-cover"
                        />
                        {showCopyTitle ? (
                            <CopyTitleButton
                                title={item.title}
                                className="absolute left-1 top-1 z-10 h-6 w-6 opacity-0 pointer-events-none transition-opacity group-hover/poster:pointer-events-auto group-hover/poster:opacity-100 group-focus-within/poster:pointer-events-auto group-focus-within/poster:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                            />
                        ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-plex">
                            {item.mediaType === 'movie' ? 'Movie' : 'TV show'}
                        </p>
                        <h2 className={`mt-0.5 truncate font-bold text-text ${isModalLayout ? 'text-xl sm:text-2xl' : 'text-lg'}`} title={headerLabel}>
                            {item.title}
                        </h2>
                        {item.year ? <p className="text-sm text-muted">{item.year}</p> : null}
                        {searchContext && searchContext !== item.title ? (
                            <p className="mt-1 truncate text-xs text-muted">Matched as “{searchContext}”</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {statusLoading ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Status…
                                </span>
                            ) : titleStatus?.lastApply ? (
                                <span
                                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100"
                                    title={[
                                        titleStatus.lastApply.title || titleStatus.lastApply.url,
                                        titleStatus.lastApply.user ? `@${titleStatus.lastApply.user}` : '',
                                        titleStatus.lastApply.at ? formatWhen(titleStatus.lastApply.at) : '',
                                    ].filter(Boolean).join(' · ')}
                                >
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">
                                        Already applied
                                        {titleStatus.lastApply.title ? ` · ${titleStatus.lastApply.title}` : ''}
                                    </span>
                                </span>
                            ) : (
                                <span className="text-[11px] text-muted">Not applied yet</span>
                            )}
                            <button
                                type="button"
                                className={`${titleWatchEnabled ? primaryButtonClass : buttonClass} !px-2 !py-1 text-[11px]`}
                                disabled={interactionLocked || (!titleWatchEnabled && !titleWatchSetUrl)}
                                title={titleWatchSetUrl
                                    ? `Pin updates for ${titleStatus?.titleWatch?.setTitle || titleStatus?.lastApply?.title || 'the active poster set'}.`
                                    : 'Apply a poster set first, then auto-queue new art for this title.'}
                                onClick={() => void toggleTitleWatch()}
                            >
                                {busy === 'title-watch' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                                {titleWatchEnabled ? 'Watching' : 'Watch'}
                            </button>
                            {(titleStatus?.watchingCount || 0) > 0 ? (
                                <span className="text-[11px] text-plex">
                                    {titleStatus?.watchingCount} set{(titleStatus?.watchingCount || 0) === 1 ? '' : 's'}
                                </span>
                            ) : null}
                            {String(serverType).toLowerCase() === 'plex' ? (
                                <details className="relative">
                                    <summary className={`${buttonClass} !px-2 !py-1 text-[11px] cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                                        {busy === 'reset' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                        Reset art
                                    </summary>
                                    <div className="absolute right-0 z-20 mt-1 w-56 space-y-2 rounded-xl border border-white/10 bg-card p-2 shadow-xl">
                                        {item.mediaType === 'show' ? (
                                            <div className="flex flex-wrap gap-1">
                                                {([
                                                    ['poster', 'Show poster'],
                                                    ['seasons', '+ seasons'],
                                                    ['episodes', 'Episodes'],
                                                    ['all', 'All'],
                                                ] as const).map(([id, label]) => (
                                                    <button
                                                        key={id}
                                                        type="button"
                                                        className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${
                                                            resetScope === id
                                                                ? 'border-plex/40 bg-plex/15 text-plex'
                                                                : 'border-white/10 text-muted hover:text-text'
                                                        }`}
                                                        onClick={() => setResetScope(id)}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}
                                        <button
                                            type="button"
                                            className={`${buttonClass} w-full`}
                                            disabled={interactionLocked}
                                            onClick={() => void runResetArt()}
                                        >
                                            Reset to default art
                                        </button>
                                    </div>
                                </details>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {onLayoutModeChange ? (
                            <button
                                type="button"
                                className={buttonClass}
                                onClick={() => onLayoutModeChange(isModalLayout ? 'drawer' : 'modal')}
                                title={isModalLayout ? 'Switch to side drawer' : 'Switch to full screen'}
                                aria-label={isModalLayout ? 'Switch to side drawer' : 'Switch to full screen'}
                            >
                                {isModalLayout ? <PanelRight className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                            </button>
                        ) : null}
                        <button type="button" className={buttonClass} onClick={onClose} aria-label="Close">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div ref={scrollBodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-4 sm:p-5 custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted">
                            <Loader2 className="h-6 w-6 animate-spin text-plex" />
                            Finding title{mediuxEnabled ? ' on MediUX' : ''}…
                        </div>
                    ) : null}

                    {loadingMoreSets && searchSets.length === 0 && !mediuxSettled && !tpdbSettled ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted">
                            <Loader2 className="h-6 w-6 animate-spin text-plex" />
                            Loading {[tpdbEnabled && 'ThePosterDB', mediuxEnabled && 'MediUX'].filter(Boolean).join(' & ') || 'poster'} sets…
                        </div>
                    ) : null}

                    {loadingMoreSets && searchSets.length === 0 && (mediuxSettled || tpdbSettled) ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs text-muted">
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-plex" />
                                {!tpdbSettled
                                    ? 'Still checking ThePosterDB…'
                                    : 'Still checking MediUX…'}
                            </div>
                            <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
                                <ImageIcon className="mx-auto h-10 w-10 text-muted opacity-40" />
                                <p className="mt-3 text-sm font-semibold text-text">
                                    {!tpdbSettled ? 'Waiting on ThePosterDB' : 'Waiting on MediUX'}
                                </p>
                                <p className="mt-1 text-xs text-muted">
                                    {!tpdbSettled
                                        ? 'MediUX hasn\'t returned sets yet (or returned none). Still searching ThePosterDB.'
                                        : 'ThePosterDB hasn\'t returned sets yet (or returned none). Still searching MediUX.'}
                                </p>
                            </div>
                        </div>
                    ) : null}

                    {tpdbFromCache && searchSets.length > 0 ? (
                        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-text">
                            ThePosterDB sets loaded from local poster cache
                            {!mediuxSettled ? ' (MediUX still catching up in the background).' : '.'}
                        </div>
                    ) : null}

                    {loadingMoreSets && searchSets.length > 0 ? (
                        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs text-muted">
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-plex" />
                            {!tpdbSettled
                                ? 'Loading more sets from ThePosterDB…'
                                : !mediuxSettled
                                    ? 'Loading more sets from MediUX…'
                                    : 'Finishing set search…'}
                        </div>
                    ) : null}

                    {!tpdbConfigured && searchSets.length > 0 && !loadingMoreSets ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-text">
                            <p>
                                ThePosterDB isn&apos;t logged in — MediUX sets only. Many TV spin-offs need TPDB credentials for TMDB matching.
                            </p>
                            {onOpenTpdbSettings ? (
                                <button
                                    type="button"
                                    className="mt-1 font-semibold text-plex hover:underline"
                                    onClick={onOpenTpdbSettings}
                                >
                                    Open Poster Sets Settings
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {!loading && searchTitles.length > 0 ? (
                        <div className="space-y-3">
                            <p className="text-sm text-muted">
                                Pick the correct title match, then choose a poster set.
                            </p>
                            <div className="space-y-2">
                                {searchTitles.map((title) => (
                                    <button
                                        key={`${title.provider}-${title.id}-${title.title}`}
                                        type="button"
                                        className={`${fieldClass} text-left transition hover:border-plex/40`}
                                        disabled={interactionLocked}
                                        onClick={() => {
                                            const generation = ++loadGenRef.current;
                                            void loadSetsForTitle(title, item, generation);
                                        }}
                                    >
                                        <span className="font-semibold text-text">{title.title}</span>
                                        {title.year ? <span className="text-muted"> ({title.year})</span> : null}
                                        {title.provider ? (
                                            <span className="ml-2 text-[10px] uppercase text-muted">{title.provider}</span>
                                        ) : null}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {!loading && !loadingMoreSets && !searchTitles.length && !searchSets.length && !selectedSet ? (
                        <div className="rounded-xl border border-dashed border-white/10 px-4 py-12 text-center">
                            <ImageIcon className="mx-auto h-10 w-10 text-muted opacity-40" />
                            <p className="mt-3 text-sm font-semibold text-text">No poster sets found</p>
                            <p className="mt-1 text-xs text-muted">
                                Nothing matched “{item.title}” on MediUX or ThePosterDB yet. Try Discover to search manually, or pick a title match if shown above.
                            </p>
                        </div>
                    ) : null}

                    {!loading && searchSets.length > 0 && !selectedSet ? (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <h3 className="text-sm font-bold text-text">
                                    Available sets
                                    {searchContext ? ` · ${searchContext}` : ''}
                                </h3>
                                <span className="text-[11px] text-muted">{searchSets.length} found</span>
                            </div>
                            <div className="space-y-5">
                                {SEARCH_SET_CATEGORY_ORDER.map((category) => {
                                    const items = category.id === 'title_cards'
                                        ? setsByCategory.titleCards
                                        : category.id === 'backgrounds'
                                            ? setsByCategory.backgrounds
                                            : paginatedPosters;
                                    if (!items.length) return null;
                                    const landscape = category.landscape;
                                    return (
                                        <div key={category.id} className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
                                                    {category.title}
                                                </h4>
                                                <span className="text-[11px] text-muted">{items.length}</span>
                                            </div>
                                            <div className={landscape ? setsGridClassLandscape : setsGridClass}>
                                                {items.map((set) => {
                                                    const watching = isSetWatched(set);
                                                    const applied = lastApplyMatchesSet(set);
                                                    const setTitle = String(set.title || '').trim() || `Set #${set.setId}`;
                                                    const creator = String(set.user || '').trim().replace(/^@+/, '');
                                                    const expanded = selectedSet?.url === set.url;
                                                    return (
                                                        <div
                                                            key={`${set.provider}-${set.setId}-${set.url}`}
                                                            className={`flex flex-col overflow-hidden rounded-md border bg-black/20 transition ${
                                                                expanded ? 'border-plex/60 ring-1 ring-plex/30' : 'border-white/10 hover:border-plex/40'
                                                            }`}
                                                        >
                                                            <button
                                                                type="button"
                                                                className="text-left"
                                                                disabled={interactionLocked}
                                                                onClick={() => void runPreview(set)}
                                                            >
                                                                <div className={`relative bg-black text-center ${landscape ? 'aspect-[16/9]' : 'aspect-[2/3]'}`}>
                                                                    {set.thumbUrl ? (
                                                                        <img
                                                                            src={posterSetsApi.imageUrl(set.thumbUrl)}
                                                                            alt={setTitle}
                                                                            className="absolute inset-0 h-full w-full object-contain object-center"
                                                                            loading="lazy"
                                                                        />
                                                                    ) : (
                                                                        <div className="absolute inset-0 flex items-center justify-center text-muted">
                                                                            <ImageIcon className="h-8 w-8 opacity-40" />
                                                                        </div>
                                                                    )}
                                                                    <ProviderCornerBadge provider={set.provider} />
                                                                </div>
                                                                {applied || watching ? (
                                                                    <div className="flex flex-wrap justify-center gap-1 px-2 pt-2">
                                                                        {applied ? (
                                                                            <span className="inline-flex rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-100">
                                                                                Applied
                                                                            </span>
                                                                        ) : null}
                                                                        {watching ? (
                                                                            <span className="inline-flex rounded-full border border-plex/35 bg-plex/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-plex">
                                                                                Watching
                                                                            </span>
                                                                        ) : null}
                                                                    </div>
                                                                ) : null}
                                                                <div className="px-2 py-2 text-center">
                                                                    <p className="line-clamp-2 text-[11px] font-semibold text-text">
                                                                        {setTitle}
                                                                    </p>
                                                                    {creator ? (
                                                                        <p className="mt-0.5 truncate text-[10px] text-muted" title={`@${creator}`}>
                                                                            @{creator}
                                                                        </p>
                                                                    ) : null}
                                                                </div>
                                                            </button>
                                                            <div className="flex justify-center gap-1 px-2 pb-2">
                                                                <button
                                                                    type="button"
                                                                    className={buttonClass}
                                                                    disabled={interactionLocked || watching}
                                                                    title="Watch for updates"
                                                                    onClick={() => void addWatch(set)}
                                                                >
                                                                    <Eye className="h-3.5 w-3.5" />
                                                                </button>
                                                                {creator && onBlockCreator ? (
                                                                    <button
                                                                        type="button"
                                                                        className={buttonClass}
                                                                        disabled={interactionLocked || busy === 'save'}
                                                                        title={`Hide @${creator} sets and skip caching them`}
                                                                        onClick={() => void onBlockCreator(creator)}
                                                                    >
                                                                        <Ban className="h-3.5 w-3.5" />
                                                                    </button>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    {selectedSet ? (
                        <div className="sticky top-0 z-10 -mt-1 mb-4 border-b border-white/10 bg-card/95 pb-3 backdrop-blur-sm">
                            <button
                                type="button"
                                className={`${buttonClass} w-full justify-between`}
                                disabled={busy === 'preview'}
                                onClick={backToSets}
                            >
                                <span className="inline-flex items-center gap-1.5">
                                    <ChevronLeft className="h-4 w-4" />
                                    Back to all sets
                                </span>
                                <span className="text-muted">{searchSets.length}</span>
                            </button>
                        </div>
                    ) : null}

                    {selectedSet ? (
                        <div className="mt-0">
                            <SetInspector
                                set={selectedSet}
                                headerLabel={String(preview?.setMeta?.title || selectedSet.title || selectedSet.url || '')}
                                loading={busy === 'preview'}
                                ready={readyToApply}
                                matchedCount={matchedAssetCount}
                                unmatchedCount={preview?.unmatched ?? 0}
                                totalCount={preview?.total || 0}
                                selectedCount={selectedAssetIds.length}
                                titleCardsOnly={titleCardsOnly}
                                showAssets={showAssets}
                                busy={busy}
                                closeLabel="Back to sets"
                                assets={preview?.assets}
                                onChangeSelectedIds={setSelectedAssetIds}
                                alreadyApplied={lastApplyMatchesSet(selectedSet)}
                                alreadyAppliedLabel={titleStatus?.lastApply?.at ? formatWhen(titleStatus.lastApply.at) : undefined}
                                onToggleShowAssets={() => setShowAssets((value) => !value)}
                                onQueueMatched={() => void applyMatched()}
                                onQueueSelected={() => void applySelected()}
                                onQueueEntire={() => void applyEntire()}
                                onQueueUnmatched={() => void applyUnmatched()}
                                onQueueNewSinceWatch={() => {}}
                                onSelectMatched={() => {
                                    const ids = (preview.assets || []).filter((a) => a.matched === true).map((a) => a.id);
                                    setSelectedAssetIds(ids);
                                }}
                                onSelectAll={() => setSelectedAssetIds((preview.assets || []).map((a) => a.id))}
                                onClearSelection={() => setSelectedAssetIds([])}
                                onClose={backToSets}
                                thumbStrip={(
                                    <SetInspectorThumbStrip
                                        thumbs={matchedThumbStrip}
                                        layout={selectedSetUsesLandscape ? 'landscape' : 'poster'}
                                        setUrl={selectedSet.url}
                                        provider={selectedSet.provider}
                                    />
                                )}
                                gallery={showAssets && preview ? (
                                    <PreviewAssetGallery
                                        sections={previewSections}
                                        selectedAssetIds={selectedAssetIds}
                                        onToggle={(id) => setSelectedAssetIds((current) => (
                                            current.includes(id)
                                                ? current.filter((entry) => entry !== id)
                                                : [...current, id]
                                        ))}
                                    />
                                ) : undefined}
                            />
                            {!isSetWatched(selectedSet) ? (
                                <button
                                    type="button"
                                    className={`${buttonClass} mt-3 w-full`}
                                    disabled={interactionLocked}
                                    onClick={() => void addWatch(selectedSet)}
                                >
                                    <Eye className="h-4 w-4" />
                                    Watch for updates
                                </button>
                            ) : (
                                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-plex">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Watching this set for new art
                                </p>
                            )}
                        </div>
                    ) : null}
                </div>
                {setsPageCount > 1 && !selectedSet && searchSets.length > 0 && !loading ? (
                    <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 bg-card px-4 py-2.5">
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={setsPage <= 1 || interactionLocked}
                            onClick={() => setSetsPage((page) => Math.max(1, page - 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-xs text-muted">
                            Page {Math.min(setsPage, setsPageCount)} / {setsPageCount}
                        </span>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={setsPage >= setsPageCount || interactionLocked}
                            onClick={() => setSetsPage((page) => Math.min(setsPageCount, page + 1))}
                        >
                            <ChevronLeft className="h-4 w-4 rotate-180" />
                        </button>
                    </div>
                ) : null}
            </div>
    );

    if (isModalLayout) {
        return (
            <div className={pageVisible ? undefined : 'hidden'} aria-hidden={!pageVisible}>
                {panel}
            </div>
        );
    }

    return (
        <ModalPortal open>
            <>
            <button
                type="button"
                aria-label="Close title detail"
                className="fixed inset-0 z-[320] bg-background/80 backdrop-blur-sm"
                onClick={onClose}
            />
            {panel}
            </>
        </ModalPortal>
    );
}
