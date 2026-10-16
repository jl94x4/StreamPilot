import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpCircle, RefreshCw, Search, Settings as SettingsIcon, ArrowUpFromLine, Layers, Clock, History, Ban, Filter, Settings2, FileBarChart2, FolderPlus } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { askConfirm } from '../shared/confirm';
import { usePoll } from '../shared/usePoll';
import { CustomSelect, OverlayCheckbox } from '../shared/ui';
import { Loader, ToastContainer, pushToast } from '../shared/toast';
import { parsePosterGridValue, posterGridDensityBand, UPGRADER_GRID_SIZE_STORAGE_KEY, upgraderPosterGridClass, upgraderPosterGridStyle, type PosterGridValue } from '../shared/portalLayout';
import { PosterGridSizeSlider } from '../shared/PosterGridSizeSlider';
import { DiscoverPosterCard } from '../screens';
import type { ToastMessage } from '../shared/types';
import { mediaAutomationApi } from '../media-automation/api';
import { ReportModal, type ReportModalSeed } from '../media-automation/ReportModal';
import { emptyLibrary } from '../media-automation/types';
import type { MediaAutomationLibrary, MediaAutomationPipeline } from '../media-automation/types';
import { UpgraderUpgradeModal } from './UpgraderUpgradeModal';
import { UpgraderShowDrawer } from './UpgraderShowDrawer';
import { handleArrPortalEmbedAnchorClick } from '../../lib/arr-portal-embed.js';
import { UpgraderHistoryPanel } from './UpgraderHistoryPanel';
import { UpgraderExclusionsPanel } from './UpgraderExclusionsPanel';
import { UpgraderProfilesTab } from './UpgraderProfilesTab';
import type {
    UpgraderItem,
    UpgraderCodec,
    UpgraderResolution,
    UpgraderFeature,
    UpgraderQuality,
    UpgraderQueueSummary,
    UpgraderStatus,
    UpgraderSummary,
} from './types';
import {
    readUpgraderUrl,
    replaceUpgraderUrl,
    type UpgraderProfilesUrlState,
    type UpgraderTab,
} from './upgraderUrlState';
import { formatUpgraderCodecLabel, getDominantCodecShare, mergeUpgraderCodecCounts } from './codecUtils';

import { UPGRADER_CODEC_OPTIONS, UPGRADER_RESOLUTION_OPTIONS, UPGRADER_FEATURE_OPTIONS, UPGRADER_QUALITY_OPTIONS } from './presets';

type UpgraderMaHandoff = {
    ok?: boolean;
    mediaAutomationEnabled?: boolean;
    arrPath?: string | null;
    resolvedPath?: string | null;
    matchingLibrary?: {
        id?: string | number;
        name?: string;
        rootPath?: string;
        pipelineId?: string | number | null;
    } | null;
    suggestedLibrary?: {
        name?: string;
        rootPath?: string;
    } | null;
    error?: string;
};

const SORT_OPTIONS = [
    { value: 'sizeGB', label: 'Largest first' },
    { value: 'hevcFirst', label: 'Largest HEVC first' },
    { value: 'h264First', label: 'Largest H.264 first' },
    { value: 'av1First', label: 'Largest AV1 first' },
    { value: 'watchCount', label: 'Most watched' },
    { value: 'addedAt', label: 'Recently added' },
    { value: 'daysSinceAdded', label: 'Oldest added' },
    { value: 'staleAdded', label: 'Stale (old + unwatched)' },
    { value: 'title', label: 'Title A–Z' },
];

const isUpgradableItem = (item: UpgraderItem) => {
    if (item.mediaType === 'show') {
        if ((item.totalEpisodeCount ?? 0) > 0) return (item.nonHevcEpisodeCount ?? 0) > 0;
        return !item.isHevc;
    }
    return !item.isHevc;
};

type UpgraderTabId = UpgraderTab;

const readStoredSet = <T extends string>(key: string): Set<T> => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? new Set(JSON.parse(raw) as T[]) : new Set();
    } catch {
        return new Set();
    }
};

const formatIndexAge = (generatedAt: string | null) => {
    if (!generatedAt) return 'never built';
    const ageMs = Date.now() - Date.parse(generatedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0) return 'just now';
    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    if (hours < 1) return 'under 1h ago';
    if (hours < 48) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
};

const isUpgraderDisabledError = (error: unknown) => {
    const msg = String((error as Error)?.message || error || '').toLowerCase();
    return msg.includes('library upgrader is disabled') || msg.includes('plex-only');
};

export const UpgraderDashboard: React.FC = () => {
    const initialUrl = useMemo(() => readUpgraderUrl(), []);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [rebuilding, setRebuilding] = useState(false);
    const [featureEnabled, setFeatureEnabled] = useState(false);
    const [status, setStatus] = useState<UpgraderStatus | null>(null);
    const [summary, setSummary] = useState<UpgraderSummary | null>(null);
    const [queue, setQueue] = useState<UpgraderQueueSummary | null>(null);
    const [items, setItems] = useState<UpgraderItem[]>([]);
    const [total, setTotal] = useState(0);
    const [libraries, setLibraries] = useState<Array<{ id: string; title: string; count: number }>>([]);
    const [codecs, setCodecs] = useState<Set<UpgraderCodec>>(() => {
        const fromUrl = initialUrl.browse.codecs;
        if (fromUrl.length) return new Set(fromUrl as UpgraderCodec[]);
        return readStoredSet<UpgraderCodec>('upgrader_filters_codecs');
    });
    const [resolutions, setResolutions] = useState<Set<UpgraderResolution>>(() => {
        const fromUrl = initialUrl.browse.resolutions;
        if (fromUrl.length) return new Set(fromUrl as UpgraderResolution[]);
        return readStoredSet<UpgraderResolution>('upgrader_filters_resolutions');
    });
    const [features, setFeatures] = useState<Set<UpgraderFeature>>(() => {
        const fromUrl = initialUrl.browse.features;
        if (fromUrl.length) return new Set(fromUrl as UpgraderFeature[]);
        return readStoredSet<UpgraderFeature>('upgrader_filters_features');
    });
    const [qualities, setQualities] = useState<Set<UpgraderQuality>>(() => {
        const fromUrl = initialUrl.browse.qualities;
        if (fromUrl.length) return new Set(fromUrl as UpgraderQuality[]);
        return readStoredSet<UpgraderQuality>('upgrader_filters_qualities');
    });
    const [filtersExpanded, setFiltersExpanded] = useState(() => {
        try { return window.localStorage.getItem('upgrader_filters_expanded') === 'true'; } catch { return false; }
    });
    const [presetReady, setPresetReady] = useState(false);
    const [sort, setSort] = useState(() => initialUrl.browse.sort || window.localStorage.getItem('upgrader_filters_sort') || 'sizeGB');
    const [libraryId, setLibraryId] = useState(() => initialUrl.browse.library || window.localStorage.getItem('upgrader_filters_library') || 'all');
    const [mediaType, setMediaType] = useState(() => initialUrl.browse.type || window.localStorage.getItem('upgrader_filters_type') || 'all');
    const [search, setSearch] = useState(initialUrl.browse.search);
    const [searchInput, setSearchInput] = useState(initialUrl.browse.search);
    const [page, setPage] = useState(initialUrl.browse.page);
    const [showQualityBadges, setShowQualityBadges] = useState(true);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [upgradeItems, setUpgradeItems] = useState<UpgraderItem[]>([]);
    const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<UpgraderTabId>(initialUrl.tab);
    const [profilesUrl, setProfilesUrl] = useState<UpgraderProfilesUrlState>(initialUrl.profiles);
    const [showDrawerItem, setShowDrawerItem] = useState<UpgraderItem | null>(null);
    const [drawerPosition, setDrawerPosition] = useState<'sidebar' | 'modal'>('sidebar');
    const [reportSeed, setReportSeed] = useState<ReportModalSeed | null>(null);
    const [reportEphemeralLibrary, setReportEphemeralLibrary] = useState<{
        id: string | number;
        name: string;
        rootPath: string;
    } | null>(null);
    const [maLibraries, setMaLibraries] = useState<MediaAutomationLibrary[]>([]);
    const [maPipelines, setMaPipelines] = useState<MediaAutomationPipeline[]>([]);
    const [maHandoffBusyKey, setMaHandoffBusyKey] = useState<string | null>(null);
    const listScrollRef = useRef(0);
    const restoreScrollAfterDrawerRef = useRef(false);

    const getListScrollEl = () => (
        typeof document !== 'undefined'
            ? document.getElementById('main-scroll-container')
            : null
    );

    const captureListScroll = useCallback(() => {
        const el = getListScrollEl();
        listScrollRef.current = el ? el.scrollTop : window.scrollY;
    }, []);

    const restoreListScroll = useCallback(() => {
        const top = listScrollRef.current;
        const apply = () => {
            const el = getListScrollEl();
            if (el) el.scrollTop = top;
            else window.scrollTo(0, top);
        };
        apply();
        requestAnimationFrame(apply);
    }, []);

    const handleOpenDrawer = useCallback((item: UpgraderItem) => {
        captureListScroll();
        restoreScrollAfterDrawerRef.current = true;
        window.history.pushState({ drawerOpen: true }, '', window.location.href);
        setShowDrawerItem(item);
    }, [captureListScroll]);

    const handleCloseDrawer = useCallback(() => {
        if (window.history.state?.drawerOpen) {
            window.history.back();
        } else {
            setShowDrawerItem(null);
        }
    }, []);

    useEffect(() => {
        const onPopState = (e: PopStateEvent) => {
            if (!e.state?.drawerOpen) {
                setShowDrawerItem(null);
            }
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    // Closing the drawer uses history.back(), which can reload browse state and jump the list.
    // Restore the pre-open scroll only after that close transition (not on normal list refreshes).
    useEffect(() => {
        if (showDrawerItem) {
            restoreScrollAfterDrawerRef.current = true;
            return undefined;
        }
        if (!restoreScrollAfterDrawerRef.current || loading) return undefined;
        restoreScrollAfterDrawerRef.current = false;
        restoreListScroll();
        const timer = window.setTimeout(restoreListScroll, 120);
        return () => window.clearTimeout(timer);
    }, [showDrawerItem, loading, restoreListScroll]);

    const [gridSize, setGridSize] = useState<PosterGridValue>(() => {
        if (typeof window === 'undefined') return 9.5;
        return parsePosterGridValue(window.localStorage.getItem(UPGRADER_GRID_SIZE_STORAGE_KEY), { allowList: true });
    });

    useEffect(() => {
        window.localStorage.setItem(UPGRADER_GRID_SIZE_STORAGE_KEY, String(gridSize));
        window.localStorage.setItem('upgrader_filters_codecs', JSON.stringify(Array.from(codecs)));
        window.localStorage.setItem('upgrader_filters_resolutions', JSON.stringify(Array.from(resolutions)));
        window.localStorage.setItem('upgrader_filters_features', JSON.stringify(Array.from(features)));
        window.localStorage.setItem('upgrader_filters_qualities', JSON.stringify(Array.from(qualities)));
        window.localStorage.setItem('upgrader_filters_expanded', String(filtersExpanded));
        window.localStorage.setItem('upgrader_filters_sort', sort);
        window.localStorage.setItem('upgrader_filters_library', libraryId);
        window.localStorage.setItem('upgrader_filters_type', mediaType);
    }, [gridSize, codecs, resolutions, features, qualities, filtersExpanded, sort, libraryId, mediaType]);

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts((prev) => pushToast(prev, message, type));
    }, []);

    useEffect(() => {
        apiFetch('/api/config')
            .then((configData) => {
                const defaultSort = configData?.settings?.upgraderDefaultSort;
                const hasUrlSort = new URLSearchParams(window.location.search).has('sort');
                if (!hasUrlSort && !window.localStorage.getItem('upgrader_filters_sort') && defaultSort) {
                    setSort(defaultSort);
                }
            })
            .catch(() => {})
            .finally(() => setPresetReady(true));
    }, []);

    const syncUpgraderUrl = useCallback(() => {
        replaceUpgraderUrl({
            tab: activeTab,
            browse: {
                codecs: Array.from(codecs),
                resolutions: Array.from(resolutions),
                features: Array.from(features),
                qualities: Array.from(qualities),
                library: libraryId,
                type: mediaType,
                sort,
                search,
                page,
            },
            profiles: profilesUrl,
        });
    }, [activeTab, codecs, resolutions, features, qualities, libraryId, mediaType, sort, search, page, profilesUrl]);

    useEffect(() => {
        syncUpgraderUrl();
    }, [syncUpgraderUrl]);

    useEffect(() => {
        const sameSet = (current: Set<string>, next: string[]) => (
            current.size === next.length && next.every((value) => current.has(value))
        );
        const onPopState = () => {
            // Drawer open/close also uses history; don't churn identical browse state.
            if (window.history.state?.drawerOpen) return;
            const next = readUpgraderUrl();
            setActiveTab((prev) => (prev === next.tab ? prev : next.tab));
            setCodecs((prev) => (sameSet(prev, next.browse.codecs) ? prev : new Set(next.browse.codecs as UpgraderCodec[])));
            setResolutions((prev) => (sameSet(prev, next.browse.resolutions) ? prev : new Set(next.browse.resolutions as UpgraderResolution[])));
            setFeatures((prev) => (sameSet(prev, next.browse.features) ? prev : new Set(next.browse.features as UpgraderFeature[])));
            setQualities((prev) => (sameSet(prev, next.browse.qualities) ? prev : new Set(next.browse.qualities as UpgraderQuality[])));
            setLibraryId((prev) => (prev === next.browse.library ? prev : next.browse.library));
            setMediaType((prev) => (prev === next.browse.type ? prev : next.browse.type));
            setSort((prev) => (prev === next.browse.sort ? prev : next.browse.sort));
            setSearch((prev) => (prev === next.browse.search ? prev : next.browse.search));
            setSearchInput((prev) => (prev === next.browse.search ? prev : next.browse.search));
            setPage((prev) => (prev === next.browse.page ? prev : next.browse.page));
            setProfilesUrl((prev) => (
                prev.instance === next.profiles.instance
                && prev.formatPage === next.profiles.formatPage
                && prev.profilePage === next.profiles.profilePage
                    ? prev
                    : next.profiles
            ));
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const handleTabChange = useCallback((tab: UpgraderTabId) => {
        setActiveTab(tab);
    }, []);

    const handleProfilesUrlChange = useCallback((patch: Partial<UpgraderProfilesUrlState>) => {
        setProfilesUrl((prev) => ({ ...prev, ...patch }));
    }, []);

    const loadData = useCallback(async (silent = false) => {
        if (!presetReady) return;
        if (!silent) setLoading(true);
        try {
            const configData = await apiFetch('/api/config');
            const enabled = !!configData?.settings?.upgraderEnabled;
            setFeatureEnabled(enabled);
            if (configData?.settings?.upgraderDrawerPosition) setDrawerPosition(configData.settings.upgraderDrawerPosition);
            if (!enabled) return;

            const [statusData, summaryData, itemsData, queueData, publicConfig] = await Promise.all([
                apiFetch('/api/upgrader/status'),
                apiFetch('/api/upgrader/summary'),
                apiFetch(`/api/upgrader/items?codecs=${encodeURIComponent(Array.from(codecs).join(','))}&resolutions=${encodeURIComponent(Array.from(resolutions).join(','))}&features=${encodeURIComponent(Array.from(features).join(','))}&qualities=${encodeURIComponent(Array.from(qualities).join(','))}&libraryId=${encodeURIComponent(libraryId)}&mediaType=${encodeURIComponent(mediaType)}&search=${encodeURIComponent(search)}&sort=${encodeURIComponent(sort)}&page=${page}&limit=48`),
                apiFetch('/api/upgrader/queue').catch(() => null),
                apiFetch('/api/config/public').catch(() => ({})),
            ]);

            setStatus(statusData || null);
            setSummary(summaryData || null);
            setQueue(queueData || null);
            setItems(Array.isArray(itemsData?.items) ? itemsData.items : []);
            setTotal(Number(itemsData?.total || 0));
            setLibraries(Array.isArray(itemsData?.libraries) ? itemsData.libraries : []);
            setShowQualityBadges(publicConfig?.showPosterQualityBadges !== false);
        } catch (e: any) {
            if (isUpgraderDisabledError(e)) {
                setFeatureEnabled(false);
                return;
            }
            addToast(e.message || 'Failed to load upgrader data', 'error');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [addToast, libraryId, mediaType, page, codecs, resolutions, features, qualities, presetReady, search, sort]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 300);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => {
        setSelectedKeys(new Set());
    }, [codecs, resolutions, features, qualities, libraryId, mediaType, search, page, sort]);

    useEffect(() => {
        if (status?.rebuildInProgress) {
            setRebuilding(true);
        } else if (rebuilding) {
            setRebuilding(false);
        }
    }, [status?.rebuildInProgress]);

    usePoll(() => { loadData(true); }, (rebuilding || status?.rebuildInProgress) ? 2500 : null, { immediate: false });

    const maEnabled = status?.mediaAutomationEnabled !== false;

    const handleRebuild = async () => {
        try {
            await apiFetch('/api/upgrader/rebuild', { method: 'POST' });
            addToast('Library index rebuild started.', 'success');
            setRebuilding(true);
            await loadData(true);
        } catch (e: any) {
            addToast(e.message || 'Failed to rebuild index', 'error');
        }
    };

    const openUpgradeModal = (targets: UpgraderItem[]) => {
        if (!status?.automationEnabled) {
            addToast('Enable Upgrader automation in Settings first.', 'error');
            return;
        }
        if (!status?.profileMapConfigured) {
            addToast('Configure HEVC quality profiles per ARR instance in Settings.', 'error');
            return;
        }
        const upgradable = targets.filter((item) => isUpgradableItem(item));
        if (!upgradable.length) {
            addToast('No valid titles selected.', 'error');
            return;
        }
        setUpgradeItems(upgradable);
        setUpgradeModalOpen(true);
    };

    const toggleSelected = (ratingKey: string) => {
        setSelectedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(ratingKey)) next.delete(ratingKey);
            else next.add(ratingKey);
            return next;
        });
    };

    const handleSnooze = async (item: UpgraderItem, days = 30) => {
        try {
            await apiFetch('/api/upgrader/snooze', {
                method: 'POST',
                body: JSON.stringify({ ratingKey: item.ratingKey, days }),
            });
            addToast(`Snoozed “${item.title}” for ${days} days.`, 'success');
            await loadData(true);
        } catch (e: any) {
            addToast(e.message || 'Failed to snooze title', 'error');
        }
    };

    const mediaServerLabel = status?.mediaServerType === 'jellyfin' ? 'Jellyfin' : 'Plex';

    const selectedItems = useMemo(
        () => items.filter((item) => selectedKeys.has(item.ratingKey)),
        [items, selectedKeys],
    );

    const selectedLibraryTitle = useMemo(() => {
        if (!libraryId || libraryId === 'all') return '';
        return libraries.find((lib) => String(lib.id) === String(libraryId))?.title || '';
    }, [libraries, libraryId]);

    const savingsReportHref = useMemo(() => {
        const params = new URLSearchParams({ report: '1' });
        if (selectedLibraryTitle) params.set('libraryName', selectedLibraryTitle);
        return portalUrl(`/media-automation?${params.toString()}#libraries`);
    }, [selectedLibraryTitle]);

    const openSavingsReport = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        window.history.pushState({}, '', savingsReportHref);
        window.dispatchEvent(new PopStateEvent('popstate'));
    }, [savingsReportHref]);

    const ensureMaCatalog = useCallback(async () => {
        const [libraries, pipelines] = await Promise.all([
            mediaAutomationApi.libraries(),
            mediaAutomationApi.pipelines(),
        ]);
        setMaLibraries(libraries);
        setMaPipelines(pipelines);
        return { libraries, pipelines };
    }, []);

    const fetchMaHandoff = useCallback(async (item: UpgraderItem) => {
        const data = await apiFetch(
            `/api/upgrader/ma-handoff?ratingKey=${encodeURIComponent(item.ratingKey)}`,
        ) as UpgraderMaHandoff;
        if (data?.error) throw new Error(data.error);
        if (!data?.resolvedPath) throw new Error('Could not resolve an on-disk folder for this title.');
        return data;
    }, []);

    const openTitleSavingsReport = useCallback(async (item: UpgraderItem) => {
        if (!maEnabled) {
            addToast('Enable Media Automation in Settings for savings reports.', 'error');
            return;
        }
        const busyKey = `report:${item.ratingKey}`;
        setMaHandoffBusyKey(busyKey);
        try {
            const [handoff] = await Promise.all([fetchMaHandoff(item), ensureMaCatalog()]);
            let libraryId = handoff.matchingLibrary?.id ?? null;
            let pipelineId = handoff.matchingLibrary?.pipelineId ?? null;
            let ephemeral: { id: string | number; name: string; rootPath: string } | null = null;

            // Report must sit under an MA library root. If nothing covers this folder yet,
            // create a temporary title library for the scan — on close we ask Keep vs Delete.
            if (!handoff.matchingLibrary) {
                const { pipelines } = await ensureMaCatalog();
                const defaultPipeline = pipelines.find((pipeline) => pipeline.enabled !== false);
                const created = await mediaAutomationApi.createLibrary({
                    ...emptyLibrary(),
                    name: handoff.suggestedLibrary?.name || item.title,
                    rootPath: String(handoff.suggestedLibrary?.rootPath || handoff.resolvedPath || ''),
                    pipelineId: defaultPipeline?.id ?? '',
                    enabled: true,
                    tags: ['upgrader-report-temp'],
                }) as { library?: MediaAutomationLibrary };
                const library = created?.library;
                if (!library?.id) throw new Error('Could not create a temporary library for the report.');
                libraryId = library.id;
                pipelineId = library.pipelineId ?? defaultPipeline?.id ?? null;
                ephemeral = {
                    id: library.id,
                    name: library.name || item.title,
                    rootPath: library.rootPath || String(handoff.resolvedPath || ''),
                };
                await ensureMaCatalog();
            }

            setReportEphemeralLibrary(ephemeral);
            setReportSeed({
                libraryId,
                libraryRoot: handoff.resolvedPath,
                pipelineId,
                forcePipeline: false,
            });
        } catch (error) {
            setReportEphemeralLibrary(null);
            addToast(error instanceof Error ? error.message : 'Savings report failed', 'error');
        } finally {
            setMaHandoffBusyKey(null);
        }
    }, [addToast, ensureMaCatalog, fetchMaHandoff, maEnabled]);

    const closeTitleSavingsReport = useCallback(async () => {
        const ephemeral = reportEphemeralLibrary;
        setReportSeed(null);
        setReportEphemeralLibrary(null);
        if (!ephemeral?.id) return;

        const shouldDelete = await askConfirm(
            `Remove the temporary Media Automation library created for this report?\n\n`
            + `“${ephemeral.name}”\n${ephemeral.rootPath}\n\n`
            + 'Keep it if you want to encode this title later.',
            {
                title: 'Done with savings report',
                confirmLabel: 'Delete library',
                cancelLabel: 'Keep library',
            },
        );
        if (!shouldDelete) {
            addToast(`Kept MA library “${ephemeral.name}”.`, 'success');
            return;
        }
        try {
            await mediaAutomationApi.deleteLibrary(ephemeral.id);
            await ensureMaCatalog();
            addToast(`Deleted temporary MA library “${ephemeral.name}”.`, 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Failed to delete temporary library', 'error');
        }
    }, [addToast, ensureMaCatalog, reportEphemeralLibrary]);

    const goToMaLibraryEditor = useCallback((libraryId: string | number) => {
        const params = new URLSearchParams({ editLibrary: String(libraryId) });
        const href = portalUrl(`/media-automation?${params.toString()}#libraries`);
        window.history.pushState({}, '', href);
        window.dispatchEvent(new PopStateEvent('popstate'));
    }, []);

    const createMaLibraryForTitle = useCallback(async (item: UpgraderItem) => {
        if (!maEnabled) {
            addToast('Enable Media Automation in Settings to create libraries from Upgrader.', 'error');
            return;
        }
        const busyKey = `library:${item.ratingKey}`;
        setMaHandoffBusyKey(busyKey);
        try {
            const handoff = await fetchMaHandoff(item);
            const normalizeRoot = (value?: string | null) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
            if (handoff.matchingLibrary
                && normalizeRoot(handoff.matchingLibrary.rootPath) === normalizeRoot(handoff.resolvedPath)) {
                const openExisting = await askConfirm(
                    `A Media Automation library already points at this folder:\n\n`
                    + `${handoff.matchingLibrary.name}\n${handoff.matchingLibrary.rootPath}\n\n`
                    + 'Open it in Media Automation to edit?',
                );
                if (openExisting && handoff.matchingLibrary.id != null) {
                    goToMaLibraryEditor(handoff.matchingLibrary.id);
                }
                return;
            }
            const confirmed = await askConfirm(
                `Create a Media Automation library for:\n\n`
                + `${handoff.suggestedLibrary?.name || item.title}\n`
                + `${handoff.suggestedLibrary?.rootPath || handoff.resolvedPath}\n\n`
                + 'You’ll land on Media Automation to pick a pipeline and finish setup.',
            );
            if (!confirmed) return;
            const { pipelines } = await ensureMaCatalog();
            const defaultPipeline = pipelines.find((pipeline) => pipeline.enabled !== false);
            const created = await mediaAutomationApi.createLibrary({
                ...emptyLibrary(),
                name: handoff.suggestedLibrary?.name || item.title,
                rootPath: String(handoff.suggestedLibrary?.rootPath || handoff.resolvedPath || ''),
                pipelineId: defaultPipeline?.id ?? '',
                enabled: true,
            }) as { library?: MediaAutomationLibrary };
            const library = created?.library;
            if (!library?.id) throw new Error('Library create did not return an id.');
            addToast(`Created MA library “${library.name}”. Opening Media Automation…`, 'success');
            goToMaLibraryEditor(library.id);
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Create library failed', 'error');
        } finally {
            setMaHandoffBusyKey(null);
        }
    }, [addToast, ensureMaCatalog, fetchMaHandoff, goToMaLibraryEditor, maEnabled]);

    const summaryChips = useMemo(() => {
        if (!summary) return [];
        const chips = [
            `${summary.totalItems} titles indexed`,
            `index ${formatIndexAge(summary.generatedAt)}`,
        ];
        if (summary.estimatedReclaimableGB > 0) {
            chips.push(`~${summary.estimatedReclaimableGB} GB reclaimable`);
        }
        if (status?.automationEnabled) {
            chips.push(`${status.recentUpgradeCount}/${status.maxActionsPerHour} upgrades this hour`);
        }
        return chips;
    }, [summary, status]);

    const totalPages = Math.max(1, Math.ceil(total / 48));
    const automationReady = !!status?.automationEnabled && !!status?.profileMapConfigured;

    const tabButtonClass = (tab: UpgraderTabId) =>
        `inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
            activeTab === tab ? 'bg-plex text-background border-plex' : 'bg-white/5 text-muted border-white/10 hover:text-text'
        }`;

    return (
        <div className="w-full flex flex-col gap-6 pb-8">
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <UpgraderUpgradeModal
                isOpen={upgradeModalOpen}
                items={upgradeItems}
                onClose={() => setUpgradeModalOpen(false)}
                onCompleted={() => loadData(true)}
                addToast={addToast}
            />
            <UpgraderShowDrawer
                show={showDrawerItem}
                codecs={Array.from(codecs)}
                resolutions={Array.from(resolutions)}
                features={Array.from(features)}
                qualities={Array.from(qualities)}
                onClose={handleCloseDrawer}
                addToast={addToast}
                automationReady={automationReady}
                onProfileChanged={() => loadData(true)}
                position={drawerPosition}
            />
            <div className="flex flex-col gap-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <ArrowUpCircle className="w-8 h-8 text-plex" />
                            <h1 className="page-title">Upgrader</h1>
                        </div>
                        <p className="text-sm text-muted max-w-2xl">
                            Browse your Sonarr and Radarr libraries, filter by codec and quality, drill into series episodes, change quality profiles, and trigger searches.
                        </p>
                    </div>
                    {featureEnabled && (
                        <button
                            type="button"
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-plex text-background font-bold hover:bg-plex-hover transition-colors disabled:opacity-50"
                            onClick={handleRebuild}
                            disabled={rebuilding || !!status?.rebuildInProgress}
                        >
                            <RefreshCw className={`w-4 h-4 ${rebuilding || status?.rebuildInProgress ? 'animate-spin' : ''}`} />
                            {rebuilding || status?.rebuildInProgress ? 'Rebuilding…' : 'Rebuild Index'}
                        </button>
                    )}
                </div>

                {!featureEnabled && (
                    <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
                        <h3 className="text-xl font-bold text-plex mb-2">Upgrader Disabled</h3>
                        <p className="text-sm text-muted mb-3">Library Upgrader is currently OFF.</p>
                        <p className="text-xs text-muted mb-4">Enable it in Settings → Library Upgrader, then click Save Settings.</p>
                        <a
                            href={portalUrl('/settings#upgrader')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-plex text-background font-bold no-underline hover:bg-plex-hover transition-colors"
                        >
                            <SettingsIcon className="w-4 h-4" />
                            Open Settings
                        </a>
                    </div>
                )}

                {featureEnabled && (
                    <>
                        {summaryChips.length > 0 && activeTab === 'browse' && (
                            <div className="flex flex-wrap items-center gap-2">
                                {summaryChips.map((chip) => (
                                    <span key={chip} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-text">
                                        {chip}
                                    </span>
                                ))}
                                {!status?.arrConfigured && (
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-200">
                                        No Sonarr/Radarr instances configured
                                    </span>
                                )}
                                {status?.arrConfigured && status.automationEnabled && (
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">
                                        Automation is ON
                                    </span>
                                )}
                                {status?.arrConfigured && !status.automationEnabled && (
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">
                                        Manual Upgrades only
                                    </span>
                                )}
                                {!maEnabled && (
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-200">
                                        Media Automation off — savings reports disabled
                                    </span>
                                )}
                                <a
                                    href={savingsReportHref}
                                    onClick={openSavingsReport}
                                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border no-underline transition-colors ${
                                        maEnabled
                                            ? 'bg-plex/15 border-plex/40 text-plex hover:bg-plex/25'
                                            : 'bg-white/5 border-white/10 text-muted pointer-events-none opacity-60'
                                    }`}
                                    title={selectedLibraryTitle
                                        ? `Open Media Automation savings report for ${selectedLibraryTitle}`
                                        : 'Open Media Automation savings report'}
                                >
                                    <FileBarChart2 className="w-3.5 h-3.5" />
                                    Savings report
                                </a>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={tabButtonClass('browse')} onClick={() => handleTabChange('browse')}>
                                Browse
                            </button>
                            <button type="button" className={tabButtonClass('history')} onClick={() => handleTabChange('history')}>
                                <History className="w-4 h-4" />
                                History
                            </button>
                            <button type="button" className={tabButtonClass('exclusions')} onClick={() => handleTabChange('exclusions')}>
                                <Ban className="w-4 h-4" />
                                Exclusions
                            </button>
                            <button type="button" className={tabButtonClass('profiles')} onClick={() => handleTabChange('profiles')}>
                                <Settings2 className="w-4 h-4" />
                                Profiles
                            </button>
                        </div>

                        {activeTab === 'history' && <UpgraderHistoryPanel />}

                        {activeTab === 'exclusions' && (
                            <UpgraderExclusionsPanel addToast={addToast} onChanged={() => loadData(true)} />
                        )}

                        {activeTab === 'profiles' && (
                            <UpgraderProfilesTab
                                initialInstanceId={profilesUrl.instance}
                                initialFormatPage={profilesUrl.formatPage}
                                initialProfilePage={profilesUrl.profilePage}
                                onUrlStateChange={handleProfilesUrlChange}
                            />
                        )}

                        {activeTab === 'browse' && (
                            <>
                        {queue && queue.totalQueued > 0 && (
                            <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2 text-sm font-semibold text-text">
                                    <Layers className="w-4 h-4 text-plex" />
                                    ARR queue: {queue.totalQueued} active
                                </div>
                                {queue.instances.filter((entry) => entry.total > 0).map((entry) => (
                                    <span key={entry.instanceId} className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-muted">
                                        {entry.instanceName}: {entry.total}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="flex flex-col gap-4 p-4 rounded-2xl border border-border/60 bg-card/40">
                            <div className="flex flex-col w-full">
                                <button
                                    type="button"
                                    onClick={() => setFiltersExpanded(!filtersExpanded)}
                                    className="lg:hidden w-full py-2 mb-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Filter className="w-4 h-4" />
                                    {filtersExpanded ? 'Hide Filters' : 'Show Filters'}
                                </button>
                                
                                <div className={`flex flex-row flex-wrap items-start gap-x-8 gap-y-3 ${filtersExpanded ? 'flex' : 'hidden lg:flex'}`}>
                                    <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2">
                                        <span className="text-xs font-bold text-muted uppercase tracking-wider mr-1 hidden lg:inline">Codec:</span>
                                    {UPGRADER_CODEC_OPTIONS.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => {
                                                setCodecs(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(option.id)) next.delete(option.id);
                                                    else next.add(option.id);
                                                    return next;
                                                });
                                                setPage(1);
                                            }}
                                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${codecs.has(option.id) ? 'bg-plex text-background border-plex' : 'bg-white/5 text-muted border-white/10 hover:text-text'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                    </div>
                                    <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2">
                                        <span className="text-xs font-bold text-muted uppercase tracking-wider mr-1 hidden lg:inline">Resolution:</span>
                                    {UPGRADER_RESOLUTION_OPTIONS.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => {
                                                setResolutions(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(option.id)) next.delete(option.id);
                                                    else next.add(option.id);
                                                    return next;
                                                });
                                                setPage(1);
                                            }}
                                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${resolutions.has(option.id) ? 'bg-plex text-background border-plex' : 'bg-white/5 text-muted border-white/10 hover:text-text'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                    </div>
                                    <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2">
                                        <span className="text-xs font-bold text-muted uppercase tracking-wider mr-1 hidden lg:inline">Features:</span>
                                    {UPGRADER_FEATURE_OPTIONS.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => {
                                                setFeatures(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(option.id)) next.delete(option.id);
                                                    else next.add(option.id);
                                                    return next;
                                                });
                                                setPage(1);
                                            }}
                                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${features.has(option.id) ? 'bg-plex text-background border-plex' : 'bg-white/5 text-muted border-white/10 hover:text-text'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                    </div>
                                    <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2">
                                        <span className="text-xs font-bold text-muted uppercase tracking-wider mr-1 hidden lg:inline">Quality:</span>
                                    {UPGRADER_QUALITY_OPTIONS.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => {
                                                setQualities(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(option.id)) next.delete(option.id);
                                                    else next.add(option.id);
                                                    return next;
                                                });
                                                setPage(1);
                                            }}
                                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${qualities.has(option.id) ? 'bg-plex text-background border-plex' : 'bg-white/5 text-muted border-white/10 hover:text-text'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                    </div>
                                </div>
                            </div>
                            <div className={`flex flex-col sm:flex-row flex-wrap items-center gap-3 w-full pt-4 border-t border-white/5 ${filtersExpanded ? 'flex' : 'hidden lg:flex'}`}>
                                <PosterGridSizeSlider
                                    value={gridSize}
                                    onChange={setGridSize}
                                    allowList
                                    className="flex-1 w-full sm:w-auto min-w-[140px]"
                                />
                                <CustomSelect
                                    value={sort}
                                    onChange={(value) => { setSort(value); setPage(1); }}
                                    options={SORT_OPTIONS}
                                    className="flex-1 w-full sm:w-auto min-w-[140px]"
                                />
                                <CustomSelect
                                    value={libraryId}
                                    onChange={(value) => { setLibraryId(value); setPage(1); }}
                                    options={[{ value: 'all', label: 'All instances' }, ...libraries.map((lib) => ({ value: lib.id, label: `${lib.title} (${lib.count})` }))]}
                                    className="flex-1 w-full sm:w-auto min-w-[140px]"
                                />
                                <CustomSelect
                                    value={mediaType}
                                    onChange={(value) => { setMediaType(value); setPage(1); }}
                                    options={[
                                        { value: 'all', label: 'Movies & shows' },
                                        { value: 'movie', label: 'Movies only' },
                                        { value: 'show', label: 'Shows only' },
                                    ]}
                                    className="flex-1 w-full sm:w-auto min-w-[140px]"
                                />
                                <div className="relative flex-1 w-full sm:w-auto min-w-[140px]">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                                    <input
                                        type="text"
                                        inputMode="search"
                                        value={searchInput}
                                        onChange={(e) => setSearchInput(e.target.value)}
                                        placeholder="Search titles…"
                                        className="w-full pl-9 pr-3 py-2 h-[38px] rounded-lg border border-border bg-background text-text appearance-none text-[16px] leading-5 outline-none focus:border-plex"
                                    />
                                </div>
                            </div>
                        </div>

                        {automationReady && selectedItems.length > 0 && (
                            <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-plex/30 bg-plex/10 px-4 py-3 backdrop-blur-md">
                                <span className="text-sm font-semibold text-text">{selectedItems.length} selected</span>
                                <div className="flex gap-2">
                                    <button type="button" className="px-3 py-1.5 rounded-lg border border-border text-xs font-bold" onClick={() => setSelectedKeys(new Set())}>
                                        Clear
                                    </button>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-plex text-background text-xs font-bold"
                                        onClick={() => openUpgradeModal(selectedItems)}
                                    >
                                        <ArrowUpFromLine className="w-3.5 h-3.5" />
                                        Upgrade selected
                                    </button>
                                </div>
                            </div>
                        )}

                        {loading ? (
                            <Loader isLoading />
                        ) : (status?.itemCount ?? 0) === 0 ? (
                            <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-8 text-center">
                                <h3 className="text-xl font-bold text-yellow-200 mb-2">Index empty — rebuild from Sonarr/Radarr</h3>
                                <p className="text-sm text-muted mb-4">
                                    Upgrader reads directly from your Sonarr and Radarr libraries. Click Rebuild Index to populate the browse grid.
                                </p>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-plex text-background font-bold"
                                    onClick={handleRebuild}
                                    disabled={rebuilding || !!status?.rebuildInProgress}
                                >
                                    <RefreshCw className={`w-4 h-4 ${rebuilding ? 'animate-spin' : ''}`} />
                                    Rebuild Index
                                </button>
                            </div>
                        ) : total === 0 ? (
                            <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center">
                                <h3 className="text-xl font-bold text-text mb-2">No matches for this filter</h3>
                                <p className="text-sm text-muted">Try another preset, instance, or search term.</p>
                            </div>
                        ) : (
                            <>
                                <p className="text-xs text-muted">{total} title{total === 1 ? '' : 's'} · page {page} of {totalPages}</p>
                                <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                                    {items.map((item) => {
                                        const canUpgrade = automationReady && isUpgradableItem(item);
                                        const isSelected = selectedKeys.has(item.ratingKey);
                                        const isShow = item.mediaType === 'show';
                                        const epCount = (item as any).matchedEpisodeCount ?? item.nonHevcEpisodeCount ?? 0;
                                        const isCodecFiltered = codecs.size > 0 || features.has('non_hevc');
                                        const codecLabel = item.videoCodec
                                            ? formatUpgraderCodecLabel(item.videoCodec)
                                            : '';
                                        const showCodecLabel = isShow ? (isCodecFiltered ? codecLabel : '') : codecLabel;
                                        let gridBadgeText = '';
                                        let listBadgeText = '';
                                        if (isShow) {
                                            const codecc = mergeUpgraderCodecCounts((item as any).codecCounts || {});
                                            const ressc = (item as any).resCounts || {};
                                            const parts: string[] = [];
                                            
                                            Object.entries(codecc).sort((a: any, b: any) => b[1] - a[1]).forEach(([c, count]) => {
                                                parts.push(`${count} ${formatUpgraderCodecLabel(c)} eps`);
                                            });
                                            Object.entries(ressc).sort((a: any, b: any) => b[1] - a[1]).forEach(([r, count]) => {
                                                let label = 'SD';
                                                if (r === '1080') label = '1080p';
                                                else if (r === '720') label = '720p';
                                                else if (r === '4k') label = '4K';
                                                parts.push(`${count} ${label} eps`);
                                            });
                                            const unknownCodecs = Number((item as any).unknownCodecCount || 0);
                                            if (unknownCodecs > 0) {
                                                parts.push(`${unknownCodecs} no mediaInfo`);
                                            }
                                            const snapshot = parts.join(' | ');

                                            if (epCount > 0 && showCodecLabel) gridBadgeText = `${epCount} ${showCodecLabel} eps`;
                                            else if (epCount > 0) gridBadgeText = `${epCount} eps`;
                                            else if (showCodecLabel) gridBadgeText = `${showCodecLabel} eps`;
                                            else gridBadgeText = 'Episodes';
                                            if (epCount === 1) gridBadgeText = gridBadgeText.replace('eps', 'ep');
                                            
                                            listBadgeText = snapshot || gridBadgeText;
                                        } else {
                                            gridBadgeText = showCodecLabel || 'UNKNOWN';
                                            listBadgeText = gridBadgeText;
                                        }
                                        
                                        let dominantCodecPercentageLabel = '';
                                        let dominantCodecColorClass = 'bg-white/10 border-white/20 text-gray-300';
                                        
                                        if (isShow) {
                                            const onDisk = Number((item as any).onDiskFileCount || 0);
                                            const share = getDominantCodecShare((item as any).codecCounts, onDisk);
                                            if (share) {
                                                dominantCodecPercentageLabel = `${share.percentLabel}% ${share.label}`;
                                                const label = share.label;
                                                if (label.includes('HEVC') || label.includes('AV1') || share.key === 'hevc' || share.key === 'av1') {
                                                    dominantCodecColorClass = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
                                                } else if (share.key === 'h264' || label.includes('H.264') || label.includes('AVC')) {
                                                    dominantCodecColorClass = 'bg-amber-500/10 border-amber-500/20 text-amber-400';
                                                } else {
                                                    dominantCodecColorClass = 'bg-blue-500/10 border-blue-500/20 text-blue-400';
                                                }
                                            } else if ((item as any).totalEpisodeCount > 0) {
                                                const totalEps = (item as any).totalEpisodeCount;
                                                const nonHevcEps = item.nonHevcEpisodeCount || 0;
                                                const hevcEps = Math.max(0, totalEps - nonHevcEps);
                                                if (hevcEps >= nonHevcEps) {
                                                    const percent = Math.round((hevcEps / totalEps) * 100);
                                                    dominantCodecPercentageLabel = `${percent}% HEVC`;
                                                    dominantCodecColorClass = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
                                                } else {
                                                    const percent = Math.round((nonHevcEps / totalEps) * 100);
                                                    const fallbackCodec = item.videoCodec
                                                        ? formatUpgraderCodecLabel(item.videoCodec)
                                                        : 'H.264';
                                                    dominantCodecPercentageLabel = `${percent}% ${fallbackCodec}`;
                                                    if (fallbackCodec.includes('AV1')) {
                                                        dominantCodecColorClass = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
                                                    } else {
                                                        dominantCodecColorClass = 'bg-amber-500/10 border-amber-500/20 text-amber-400';
                                                    }
                                                }
                                            }
                                        }

                                        const sizesToShow: { label: string; sizeGB: number }[] = [];
                                        if (isShow && (item as any).codecSizesGB && codecs.size > 0) {
                                            for (const reqCodec of Array.from(codecs)) {
                                                let sizeForCodec = 0;
                                                for (const [actualCodec, sizeGB] of Object.entries((item as any).codecSizesGB)) {
                                                    const actUpper = actualCodec.toUpperCase();
                                                    let familyStr = 'other';
                                                    if (actUpper.includes('AV1') || actUpper.includes('AV01')) familyStr = 'av1';
                                                    else if (actUpper.includes('HEVC') || actUpper.includes('265')) familyStr = 'hevc';
                                                    else if (actUpper.includes('AVC') || actUpper.includes('264')) familyStr = 'h264';
                                                    else if (actUpper.includes('VP9')) familyStr = 'vp9';
                                                    
                                                    if (familyStr === reqCodec) {
                                                        sizeForCodec += (sizeGB as number);
                                                    }
                                                }
                                                if (sizeForCodec > 0) {
                                                    sizesToShow.push({ label: `${formatUpgraderCodecLabel(reqCodec)} eps`, sizeGB: sizeForCodec });
                                                }
                                            }
                                        }
                                        
                                        if (sizesToShow.length === 0 && isShow && codecs.size > 0 && item.sizeGB > 0) {
                                            const totalSize = item.sizeGB || 0;
                                            const nonHevcSize = item.nonHevcEpisodeSizeGB || 0;
                                            const hevcSize = Math.max(0, totalSize - nonHevcSize);
                                            
                                            // If multiple are selected, we can show fallback sizes for H264 and HEVC
                                            if (codecs.has('h264') && nonHevcSize > 0) {
                                                sizesToShow.push({ label: 'H.264 eps', sizeGB: nonHevcSize });
                                            }
                                            if (codecs.has('hevc') && hevcSize > 0) {
                                                sizesToShow.push({ label: 'HEVC eps', sizeGB: hevcSize });
                                            }
                                        }
                                        
                                        if (sizesToShow.length === 0 && (((item.mediaType === 'show' && (item.nonHevcEpisodeSizeGB ?? 0) > 0) || item.sizeGB > 0))) {
                                            const label = item.mediaType === 'show' ? (showCodecLabel ? `${showCodecLabel} eps` : '') : '';
                                            sizesToShow.push({
                                                label,
                                                sizeGB: item.mediaType === 'show' ? (item.nonHevcEpisodeSizeGB ?? 0) : item.sizeGB
                                            });
                                        }
                                        
                                        if (gridSize === 'list') {
                                            return (
                                                <div key={item.ratingKey} className="flex flex-col sm:flex-row gap-4 p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors relative">
                                                    {automationReady && (
                                                        <div className="absolute top-2 left-2 z-20">
                                                            <OverlayCheckbox
                                                                checked={isSelected}
                                                                onChange={() => toggleSelected(item.ratingKey)}
                                                                size="md"
                                                                title={isSelected ? 'Deselect' : 'Select for upgrade'}
                                                            />
                                                        </div>
                                                    )}
                                                    <div className="w-full sm:w-24 shrink-0 aspect-[2/3] sm:aspect-auto sm:h-36 rounded-md overflow-hidden bg-black/50 relative border border-white/5 cursor-pointer" onClick={isShow ? () => handleOpenDrawer(item) : undefined}>
                                                        <img src={item.thumbUrl ? resolvePortalAssetUrl(item.thumbUrl) : (item.thumb ? portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=200&height=300`) : item.posterFallbackUrl ? resolvePortalAssetUrl(item.posterFallbackUrl) : '')} alt={item.title} className="w-full h-full object-cover" />
                                                        {showQualityBadges && item.displayTags && item.displayTags.length > 0 && (
                                                            <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-0.5 pointer-events-none z-10">
                                                                {item.displayTags.map((tag) => (
                                                                    <span key={tag} className="text-[8px] font-bold px-1 py-px rounded bg-black/85 text-white/95 border border-white/15 uppercase tracking-wide">
                                                                        {tag}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                                                        <div className="flex items-start justify-between gap-4">
                                                            <div>
                                                                <button
                                                                    type="button"
                                                                    className={`text-lg font-bold text-text line-clamp-1 text-left ${isShow ? 'hover:text-plex transition-colors' : 'cursor-default'}`}
                                                                    onClick={isShow ? () => handleOpenDrawer(item) : undefined}
                                                                >
                                                                    {item.title}{item.year ? ` (${item.year})` : ''}
                                                                </button>
                                                                <div className="flex flex-wrap gap-2 mt-2">
                                                                    <span className="px-2 py-0.5 rounded-md bg-white/10 border border-white/5 text-xs font-semibold text-gray-300">
                                                                        {item.arrInstanceName || (item.arrType === 'radarr' ? 'Radarr' : 'Sonarr')}
                                                                    </span>
                                                                    {sizesToShow.map((s, idx) => (
                                                                        <span key={idx} className="px-2 py-0.5 rounded-md bg-white/10 border border-white/5 text-xs font-semibold text-gray-300">
                                                                            {`${s.sizeGB < 1 ? Math.round(s.sizeGB * 1024) + ' MB' : Math.round(s.sizeGB * 100) / 100 + ' GB'}${s.label ? ` (${s.label})` : ''}`}
                                                                        </span>
                                                                    ))}
                                                                    {dominantCodecPercentageLabel && (
                                                                        <span className={`px-2 py-0.5 rounded-md border text-xs font-semibold ${dominantCodecColorClass}`}>
                                                                            {dominantCodecPercentageLabel}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {listBadgeText && (
                                                                <button
                                                                    type="button"
                                                                    onClick={isShow ? () => handleOpenDrawer(item) : undefined}
                                                                    className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-black/75 border border-white/20 text-amber-200 ${isShow ? 'hover:border-plex/50 cursor-pointer' : 'cursor-default'}`}
                                                                >
                                                                    {listBadgeText}
                                                                </button>
                                                            )}
                                                        </div>
                                                        {item.overview && (
                                                            <div className="mt-2 text-xs text-muted line-clamp-2 md:line-clamp-3">
                                                                {item.overview}
                                                            </div>
                                                        )}
                                                        <div className="mt-auto pt-3 flex flex-wrap items-center gap-4">
                                                            {isShow && (
                                                                <button
                                                                    type="button"
                                                                    className="text-xs font-bold text-gray-300 hover:text-white transition-colors"
                                                                    onClick={() => handleOpenDrawer(item)}
                                                                >
                                                                    View Episodes
                                                                </button>
                                                            )}
                                                            {item.arrDeepUrl && (
                                                                <a
                                                                    href={item.arrDeepUrl}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="text-xs font-bold text-plex hover:text-orange-400 transition-colors"
                                                                    onClick={(event) => {
                                                                        handleArrPortalEmbedAnchorClick(event, {
                                                                            url: item.arrDeepUrl,
                                                                            arrType: item.arrType === 'radarr' ? 'radarr' : 'sonarr',
                                                                            label: item.arrType === 'radarr' ? 'Open in Radarr' : 'Open in Sonarr',
                                                                        });
                                                                    }}
                                                                >
                                                                    Open in {item.arrType === 'radarr' ? 'Radarr' : 'Sonarr'}
                                                                </a>
                                                            )}
                                                            <button
                                                                type="button"
                                                                className="inline-flex items-center gap-1 text-xs font-bold text-gray-300 hover:text-white transition-colors disabled:opacity-40"
                                                                disabled={!maEnabled || maHandoffBusyKey === `report:${item.ratingKey}`}
                                                                onClick={() => void openTitleSavingsReport(item)}
                                                                title="Estimate encode savings for this title folder"
                                                            >
                                                                <FileBarChart2 className="h-3.5 w-3.5" />
                                                                {maHandoffBusyKey === `report:${item.ratingKey}` ? 'Opening…' : 'Savings report'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="inline-flex items-center gap-1 text-xs font-bold text-gray-300 hover:text-white transition-colors disabled:opacity-40"
                                                                disabled={!maEnabled || maHandoffBusyKey === `library:${item.ratingKey}`}
                                                                onClick={() => void createMaLibraryForTitle(item)}
                                                                title="Create a Media Automation library for this title folder"
                                                            >
                                                                <FolderPlus className="h-3.5 w-3.5" />
                                                                {maHandoffBusyKey === `library:${item.ratingKey}` ? 'Creating…' : 'Create MA library'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const checkboxSize = posterGridDensityBand(gridSize) === 'small' || posterGridDensityBand(gridSize) === 'medium' ? 'sm' : 'md';
                                        return (
                                            <div key={item.ratingKey} className="relative min-w-0">
                                                {automationReady && (
                                                    <div className="absolute top-1.5 left-1.5 z-20 upgrader-card-select">
                                                        <OverlayCheckbox
                                                            checked={isSelected}
                                                            onChange={() => toggleSelected(item.ratingKey)}
                                                            size={checkboxSize}
                                                            title={isSelected ? 'Deselect' : 'Select for upgrade'}
                                                        />
                                                    </div>
                                                )}
                                                {gridBadgeText && (
                                                    <button
                                                        type="button"
                                                        onClick={isShow ? () => handleOpenDrawer(item) : undefined}
                                                        className={`absolute top-2 right-2 z-20 upgrader-card-badge text-[10px] font-bold px-2 py-1 rounded-full bg-black/75 border border-white/20 text-amber-200 ${isShow ? 'hover:border-plex/50 cursor-pointer' : 'cursor-default'}`}
                                                    >
                                                        {gridBadgeText}
                                                    </button>
                                                )}
                                                <DiscoverPosterCard
                                                    variant="home"
                                                    posterOnlyLink
                                                    onPosterClick={isShow ? () => handleOpenDrawer(item) : undefined}
                                                    showQualityBadges={showQualityBadges}
                                                    posterWidth={600}
                                                    posterHeight={900}
                                                    item={{
                                                        title: item.title,
                                                        thumb: item.thumb,
                                                        thumbUrl: item.thumbUrl || undefined,
                                                        posterFallbackUrl: item.posterFallbackUrl || undefined,
                                                        plexUrl: item.arrDeepUrl || '#',
                                                        tags: item.displayTags,
                                                        year: item.year ?? undefined,
                                                    }}
                                                    footer={(
                                                        <div className="px-1 space-y-1">
                                                            {isShow ? (
                                                                <button
                                                                    type="button"
                                                                    className="upgrader-card-title text-xs font-medium text-text line-clamp-2 leading-tight text-left hover:text-plex transition-colors"
                                                                    onClick={() => handleOpenDrawer(item)}
                                                                >
                                                                    {item.title}{item.year ? ` (${item.year})` : ''}
                                                                </button>
                                                            ) : (
                                                                <div className="upgrader-card-title text-xs font-medium text-text line-clamp-2 leading-tight">
                                                                    {item.title}{item.year ? ` (${item.year})` : ''}
                                                                </div>
                                                            )}
                                                            <div className="upgrader-card-meta flex flex-wrap gap-1.5 mt-2">
                                                                <span className="px-1.5 py-0.5 rounded-md bg-white/10 border border-white/5 text-[10px] font-semibold text-gray-300">
                                                                    {item.arrInstanceName || (item.arrType === 'radarr' ? 'Radarr' : 'Sonarr')}
                                                                </span>
                                                                {sizesToShow.map((s, idx) => (
                                                                    <span key={idx} className="px-1.5 py-0.5 rounded-md bg-white/10 border border-white/5 text-[10px] font-semibold text-gray-300">
                                                                        {`${s.sizeGB < 1 ? Math.round(s.sizeGB * 1024) + ' MB' : Math.round(s.sizeGB * 100) / 100 + ' GB'}${s.label ? ` (${s.label})` : ''}`}
                                                                    </span>
                                                                ))}
                                                                {dominantCodecPercentageLabel && (
                                                                    <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${dominantCodecColorClass}`}>
                                                                        {dominantCodecPercentageLabel}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="upgrader-card-actions flex flex-wrap gap-x-2 gap-y-1">

                                                                {isShow && (
                                                                    <button
                                                                        type="button"
                                                                        className="text-[10px] font-bold text-muted hover:underline"
                                                                        onClick={() => handleOpenDrawer(item)}
                                                                    >
                                                                        {gridBadgeText}
                                                                    </button>
                                                                )}
                                                                {item.arrDeepUrl && (
                                                                    <a
                                                                        href={item.arrDeepUrl}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="inline-block text-[10px] font-bold text-plex hover:underline"
                                                                        onClick={(event) => {
                                                                            handleArrPortalEmbedAnchorClick(event, {
                                                                                url: item.arrDeepUrl,
                                                                                arrType: item.arrType === 'radarr' ? 'radarr' : 'sonarr',
                                                                                label: item.arrType === 'radarr' ? 'Open in Radarr' : 'Open in Sonarr',
                                                                            });
                                                                        }}
                                                                    >
                                                                        Open in {item.arrType === 'radarr' ? 'Radarr' : 'Sonarr'}
                                                                    </a>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-muted hover:text-text disabled:opacity-40"
                                                                    disabled={!maEnabled || maHandoffBusyKey === `report:${item.ratingKey}`}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        void openTitleSavingsReport(item);
                                                                    }}
                                                                    title="Estimate encode savings for this title folder"
                                                                >
                                                                    <FileBarChart2 className="h-3 w-3" />
                                                                    Report
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-muted hover:text-text disabled:opacity-40"
                                                                    disabled={!maEnabled || maHandoffBusyKey === `library:${item.ratingKey}`}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        void createMaLibraryForTitle(item);
                                                                    }}
                                                                    title="Create a Media Automation library for this title folder"
                                                                >
                                                                    <FolderPlus className="h-3 w-3" />
                                                                    MA library
                                                                </button>
                                                                {canUpgrade && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            openUpgradeModal([item]);
                                                                        }}
                                                                        className="text-[10px] font-bold text-plex hover:underline"
                                                                    >
                                                                        Trigger Upgrade
                                                                    </button>
                                                                )}
                                                                {automationReady && (
                                                                    <button
                                                                        type="button"
                                                                        className="inline-flex items-center gap-1 text-[10px] font-bold text-muted hover:text-text"
                                                                        onClick={() => handleSnooze(item)}
                                                                        title="Hide from Upgrader for 30 days"
                                                                    >
                                                                        <Clock className="w-3 h-3" />
                                                                        Snooze
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-center gap-3">
                                        <button
                                            type="button"
                                            className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40"
                                            disabled={page <= 1}
                                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        >
                                            Previous
                                        </button>
                                        <span className="text-sm text-muted">{page} / {totalPages}</span>
                                        <button
                                            type="button"
                                            className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40"
                                            disabled={page >= totalPages}
                                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                        >
                                            Next
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                            </>
                        )}
                    </>
                )}
            </div>

            <ReportModal
                open={!!reportSeed}
                seed={reportSeed}
                libraries={maLibraries}
                pipelines={maPipelines}
                onClose={() => { void closeTitleSavingsReport(); }}
                toast={(message, tone) => addToast(message, tone === 'error' ? 'error' : 'success')}
            />
        </div>
    );
};
