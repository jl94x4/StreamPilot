import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock3,
    FolderKanban,
    Layers,
    List,
    Loader2,
    Move,
    Pencil,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    Settings2,
    Square,
    Trash2,
    Upload,
    XCircle,
} from 'lucide-react';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardPanel,
    DashboardStatCard,
    DashboardSubnav,
    dashboardSubnavLinkClass,
} from '../shared/dashboard/DashboardChrome';
import { CustomSelect, SettingsToggleRow, StyledCheckbox } from '../shared/ui';
import { askConfirm } from '../shared/confirm';
import { pushToast, ToastContainer, type ToastMessage } from '../shared/toast';
import { useDiscoverI18n } from '../discovery/i18n';
import { overlaysApi, DEFAULT_OVERLAY_PLACEMENT, type OverlaysConfig, type OverlaysPlacement, type CustomCollectionOverlayRule } from './api';
import { PlacementEditor } from './PlacementEditor';
import { OverlayJobCard, OverlayJobTitleTest, OverlaySettingsGroup } from './OverlayJobCard';
import { formatRunSummaryDetail, formatRunSummaryWhen, inferRunBundle, parseRunSummary } from './runSummary';
import { api as collexionsApi } from '../collexions/api';
import { safeImageSrc } from '../shared/safeUrl';

/** Primary tabs after UX overhaul. Legacy hashes map via parseOverlaysTab. */
type TabId = 'home' | 'badges' | 'tracked' | 'look' | 'activity';
type JobCardId = 'banners' | 'recently' | 'kometa' | 'collections';
type ActionId = 'refresh' | 'stop' | 'preview' | 'previewRecently' | 'previewKometa' | 'previewCollections' | 'promote' | 'resetAll' | 'resetShows' | 'resetEpisodes' | 'run' | 'runRecently' | 'runKometa' | 'runCollections' | 'saveSettings' | 'scan' | 'reconcile' | 'reset' | 'importLog' | 'sample' | 'revertKometa';

const TAB_ALIASES: Record<string, TabId> = {
    home: 'home',
    overview: 'home',
    badges: 'badges',
    collections: 'badges',
    tracked: 'tracked',
    shows: 'tracked',
    look: 'look',
    gallery: 'look',
    placement: 'look',
    activity: 'activity',
    // Advanced folds into Home → More settings
    advanced: 'home',
    settings: 'home',
};

const parseOverlaysTab = (hash = typeof window !== 'undefined' ? window.location.hash : ''): TabId => {
    const raw = String(hash || '').replace(/^#/, '').split(/[/?&]/)[0].trim().toLowerCase();
    return TAB_ALIASES[raw] || 'home';
};

const overlaysTabHash = (tab: TabId) => (tab === 'home' ? '' : `#${tab}`);

const writeOverlaysTabHash = (tab: TabId) => {
    if (typeof window === 'undefined') return;
    const desired = overlaysTabHash(tab);
    if ((window.location.hash || '') === desired) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${desired}`);
};

const hashWantsMoreSettings = (hash = typeof window !== 'undefined' ? window.location.hash : '') => {
    const raw = String(hash || '').replace(/^#/, '').split(/[/?&]/)[0].trim().toLowerCase();
    return raw === 'advanced' || raw === 'settings';
};

type SampleMeta = {
    exists: boolean;
    showTitle?: string | null;
    episodeTitle?: string | null;
    showTitleForEp?: string | null;
    generatedAt?: string | null;
    presetId?: string | null;
    showRatingKey?: string | null;
    showSource?: string | null;
    episodeSource?: string | null;
};

const overlayShowTypeLabel = (row: any, t: (key: string, vars?: Record<string, unknown>) => string) => {
    if (row.overlayMode === 'recently') return t('overlays.table.typeRecently');
    if (row.overlayMode === 'live') return t('overlays.table.typeLive');
    if (row.overlayMode === 'top10') return t('overlays.table.typeTop10');
    return t('overlays.table.typeNewSeason');
};

const overlayResetKindForShow = (row: any) => (
    row.overlayMode === 'recently'
        || row.overlayMode === 'live'
        || row.overlayMode === 'top10'
        ? row.overlayMode
        : 'show'
);

const buttonClass = 'inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-text hover:bg-white/10 disabled:opacity-50';
const primaryButtonClass = 'inline-flex items-center gap-2 rounded-md bg-plex px-3 py-2 text-sm font-bold text-background hover:bg-plex-hover disabled:opacity-50';
const ghostButtonClass = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted hover:bg-white/5 hover:text-text disabled:opacity-50';
const fieldInputClass = 'mt-1.5 w-full appearance-none rounded-lg border border-border bg-background p-3 text-[16px] leading-5 text-text outline-none transition-all focus:border-plex focus:ring-1 focus:ring-plex';
const fieldLabelClass = 'text-[10px] font-bold uppercase tracking-[0.14em] text-muted';

const DEFAULT_MEDIA_INFO_PARTS = {
    res4k: true,
    res1080p: true,
    res720p: true,
    resOther: false,
    hdr: true,
    dolbyVision: true,
    atmos: true,
};

const DEFAULT_CONFIG: OverlaysConfig = {
    enabled: true,
    previewMode: false,
    newSeasonEnabled: true,
    newSeasonDays: 7,
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
    mediaInfoParts: { ...DEFAULT_MEDIA_INFO_PARTS },
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
    ribbonAllowKeys: [],
    ribbonDenyKeys: [],
    mediastingerOverlayEnabled: false,
    ratingsSource: 'tmdb',
    customCollectionOverlaysEnabled: false,
    restampOnCollexionsUpdate: false,
    customCollectionOverlays: [],
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
    streamingAllowKeys: [],
    streamingDenyKeys: [],
    coreLibrarySectionIds: [],
    recentlyAddedLibrarySectionIds: [],
    kometaLibrarySectionIds: [],
    librarySectionIds: [],
    overlayPresetId: 'new-season',
    episodeOverlayPresetId: 'new-episode',
    placement: DEFAULT_OVERLAY_PLACEMENT,
    scheduleHours: 24,
    recentlyAddedScheduleHours: 24,
    kometaScheduleHours: 24,
    skipIfKometaOverlayLabel: true,
};

const keysToText = (keys?: string[]) => (keys || []).join('\n');
const textToKeys = (value: string) => value
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Gallery thumbnails: track load/error in React (imperative DOM hide caused false "failed" overlays). */
const GalleryPreviewImage: React.FC<{
    src: string;
    alt: string;
    className?: string;
    failedLabel: string;
}> = ({ src, alt, className, failedLabel }) => {
    const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
    const [attempt, setAttempt] = useState(0);
    const loadedSrcRef = React.useRef<string | null>(null);

    useEffect(() => {
        setStatus('loading');
        setAttempt(0);
        loadedSrcRef.current = null;
    }, [src]);

    const displaySrc = attempt > 0
        ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`
        : src;

    return (
        <>
            {status !== 'failed' && (
                <img
                    key={displaySrc}
                    src={displaySrc}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    className={className}
                    onLoad={() => {
                        loadedSrcRef.current = src;
                        setStatus('loaded');
                    }}
                    onError={() => {
                        // Ignore late errors after a successful paint for this logical src.
                        if (loadedSrcRef.current === src) return;
                        if (attempt < 1) {
                            setAttempt(1);
                            setStatus('loading');
                            return;
                        }
                        setStatus('failed');
                    }}
                />
            )}
            {status === 'failed' && (
                <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-[11px] text-muted">
                    {failedLabel}
                </div>
            )}
        </>
    );
};

export const OverlaysDashboard: React.FC = () => {
    const { t } = useDiscoverI18n();
    const [tab, setTab] = useState<TabId>(() => parseOverlaysTab());
    const [status, setStatus] = useState<any>(null);
    const [configDraft, setConfigDraft] = useState<OverlaysConfig>(DEFAULT_CONFIG);
    const configDraftRef = React.useRef(configDraft);
    useEffect(() => {
        configDraftRef.current = configDraft;
    }, [configDraft]);
    const [shows, setShows] = useState<any[]>([]);
    const [episodes, setEpisodes] = useState<any[]>([]);
    const [kometaItems, setKometaItems] = useState<any[]>([]);
    const [sections, setSections] = useState<Array<{ id: string; key: string; title: string; type?: string }>>([]);
    const [reconcile, setReconcile] = useState<any>(null);
    const [importText, setImportText] = useState('');
    const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
    const [busy, setBusy] = useState<ActionId | null>(null);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [sampleMeta, setSampleMeta] = useState<SampleMeta | null>(null);
    const [sampleBust, setSampleBust] = useState(() => Date.now());
    const [sampleError, setSampleError] = useState<string | null>(null);
    const [sampleShowKey, setSampleShowKey] = useState('');
    const [sampleQuery, setSampleQuery] = useState('');
    const [sampleCandidates, setSampleCandidates] = useState<Array<{ ratingKey: string; title: string }>>([]);
    const [gallery, setGallery] = useState<Array<{ name: string; kind: string; url: string; mtime: number }>>([]);
    const [galleryBust, setGalleryBust] = useState(0);
    const [galleryLoading, setGalleryLoading] = useState(false);
    const [collapsedBinges, setCollapsedBinges] = useState<Record<string, boolean>>({});
    const [collapsedKometaSections, setCollapsedKometaSections] = useState<Record<string, boolean>>({});
    const [jobCardExpanded, setJobCardExpanded] = useState<Record<JobCardId, boolean>>({
        banners: false,
        recently: false,
        kometa: false,
        collections: false,
    });
    const [moreSettingsOpen, setMoreSettingsOpen] = useState(() => hashWantsMoreSettings());
    const [badgeWizardStep, setBadgeWizardStep] = useState(1);
    const [collectionPickerOptions, setCollectionPickerOptions] = useState<Array<{
        value: string;
        label: string;
        title: string;
        library: string;
    }>>([]);
    const [collectionPickerLoading, setCollectionPickerLoading] = useState(false);
    const [collectionPickerError, setCollectionPickerError] = useState('');
    const [newCollectionRuleName, setNewCollectionRuleName] = useState('');
    const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
    const [selectedCollectionKeys, setSelectedCollectionKeys] = useState<string[]>([]);
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [editingRuleImageId, setEditingRuleImageId] = useState('');
    const [newCollectionRuleFile, setNewCollectionRuleFile] = useState<File | null>(null);
    const [newCollectionSearch, setNewCollectionSearch] = useState('');
    const [newCollectionFilePreview, setNewCollectionFilePreview] = useState<string | null>(null);
    const collectionBadgePreviewSrc = safeImageSrc(newCollectionFilePreview);
    const sampleLoadedRef = React.useRef(false);
    const wasRunningRef = React.useRef(false);
    const reconnectedRunRef = React.useRef(false);
    const intentionalStartRef = React.useRef(false);

    const toast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts((prev) => pushToast(prev, message, type));
    }, []);

    const refresh = useCallback(async (opts: { syncConfig?: boolean } = {}) => {
        const [nextStatus, showsRes, episodesRes, kometaRes, galleryRes] = await Promise.all([
            overlaysApi.status(),
            overlaysApi.shows().catch(() => ({ shows: [] })),
            overlaysApi.episodes().catch(() => ({ episodes: [] })),
            overlaysApi.kometa().catch(() => ({ items: [] })),
            overlaysApi.previewGallery().catch(() => ({ items: [] })),
        ]);
        setStatus(nextStatus);
        setShows(Array.isArray(showsRes?.shows) ? showsRes.shows : []);
        setEpisodes(Array.isArray(episodesRes?.episodes) ? episodesRes.episodes : []);
        setKometaItems(Array.isArray(kometaRes?.items) ? kometaRes.items : []);
        setGallery(Array.isArray(galleryRes?.items) ? galleryRes.items : []);
        // Never clobber unsaved Overview toggles during status polls / background jobs.
        if (opts.syncConfig && nextStatus?.config) {
            setConfigDraft({ ...DEFAULT_CONFIG, ...nextStatus.config });
        }
        return nextStatus;
    }, []);

    useEffect(() => {
        void refresh({ syncConfig: true }).catch((error) => toast(error.message || t('overlays.loadFailed'), 'error'));
    }, [refresh, toast, t]);

    useEffect(() => {
        const queueLen = Number(status?.queueLength || 0);
        if (!status?.running && queueLen <= 0) return undefined;
        const timer = window.setInterval(() => {
            void refresh().catch(() => {});
        }, 1500);
        return () => window.clearInterval(timer);
    }, [status?.running, status?.queueLength, refresh]);

    // After a page refresh, reconnect to a still-running server job.
    useEffect(() => {
        if (!status?.running) {
            reconnectedRunRef.current = false;
            return;
        }
        const cmd = String(status.command || '').trim();
        if (cmd === 'sections' || cmd === 'sample-candidates' || cmd === 'status') {
            return;
        }
        if (reconnectedRunRef.current) return;
        reconnectedRunRef.current = true;
        setTab('activity');
        if (intentionalStartRef.current || busy) {
            intentionalStartRef.current = false;
            return;
        }
        const label = cmd === 'preview-kometa'
            ? 'preview-layer'
            : cmd === 'run-kometa'
                ? 'run-layer'
                : cmd;
        toast(t('overlays.activity.stillRunning', { command: label }));
    }, [status?.running, status?.command, busy, toast, t]);

    useEffect(() => {
        const running = !!status?.running;
        if (wasRunningRef.current && !running) {
            if (status?.lastOutcome === 'cancelled') {
                // Stop action already toasts
            } else if (status?.lastError || status?.lastOutcome === 'error') {
                toast(status.lastError || t('overlays.jobFailed'), 'error');
            } else if (status?.lastOutcome === 'ok') {
                void refresh().then((next) => {
                    const s = next?.lastRunSummary;
                    const parsed = parseRunSummary(s);
                    if (!parsed) {
                        toast(t('overlays.jobFinished'));
                        return;
                    }
                    if (parsed.bundle === 'scan') {
                        toast(t('overlays.eligibleToast', { count: parsed.eligible }));
                        return;
                    }
                    if (parsed.previewMode || String(s?.command || '').startsWith('preview')) {
                        toast(t('overlays.previewFinishedSummary', {
                            eligible: Number(s?.eligible ?? 0),
                            added: Number(s?.added ?? 0),
                            refreshed: Number(s?.refreshed ?? 0),
                            episodesEligible: Number(s?.episodesEligible ?? 0),
                            episodesAdded: Number(s?.episodesAdded ?? 0),
                        }));
                        return;
                    }
                    toast(formatRunSummaryDetail(parsed, t));
                }).catch(() => {
                    toast(t('overlays.jobFinished'));
                });
            }
            void Promise.all([
                overlaysApi.shows().then((showsRes) => setShows(showsRes.shows || [])),
                overlaysApi.episodes().then((episodesRes) => setEpisodes(episodesRes.episodes || [])),
                overlaysApi.previewGallery().then((res) => {
                    setGallery(res.items || []);
                    setGalleryBust((n) => n + 1);
                }).catch(() => {}),
            ]).catch(() => {});
        }
        wasRunningRef.current = running;
    }, [status?.running, status?.lastError, status?.lastOutcome, status?.lastRunSummary, toast, t]);

    const loadSections = useCallback(async () => {
        try {
            const res = await overlaysApi.sections();
            setSections(res.sections || []);
        } catch (error) {
            toast(error instanceof Error ? error.message : t('overlays.sectionsLoadFailed'), 'error');
        }
    }, [toast, t]);

    useEffect(() => {
        if (tab !== 'home' && tab !== 'look' && tab !== 'badges') return;
        if (sections.length > 0) return;
        void loadSections();
    }, [tab, sections.length, loadSections]);

    useEffect(() => {
        if (!moreSettingsOpen || tab !== 'home') return;
        const el = document.getElementById('overlays-more-settings');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [moreSettingsOpen, tab]);

    useEffect(() => {
        writeOverlaysTabHash(tab);
    }, [tab]);

    useEffect(() => {
        const onHashChange = () => {
            setTab(parseOverlaysTab());
            if (hashWantsMoreSettings()) setMoreSettingsOpen(true);
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    const updateLibrarySectionIds = useCallback((
        field: 'coreLibrarySectionIds' | 'recentlyAddedLibrarySectionIds' | 'kometaLibrarySectionIds' | 'librarySectionIds',
        sectionId: string,
        nextChecked: boolean,
        scopedSections: Array<{ id: string; key: string; title: string; type?: string }>,
    ) => {
        setConfigDraft((prev) => {
            const allIds = scopedSections.map((s) => s.id || s.key).filter(Boolean);
            const currentSelected = (prev[field] as string[] | undefined) || [];
            const currentlyAll = currentSelected.length === 0;
            let nextIds: string[];
            if (currentlyAll) {
                nextIds = nextChecked
                    ? [...allIds]
                    : allIds.filter((value) => value !== sectionId);
            } else {
                const current = new Set(currentSelected);
                if (nextChecked) current.add(sectionId);
                else current.delete(sectionId);
                nextIds = [...current];
            }
            if (nextIds.length === allIds.length && allIds.every((value) => nextIds.includes(value))) {
                nextIds = [];
            }
            // Advanced libraries are the shared default — keep per-run scopes in sync
            // so Overview cards and workers all honour the same selection.
            if (field === 'librarySectionIds') {
                return {
                    ...prev,
                    librarySectionIds: nextIds,
                    coreLibrarySectionIds: nextIds,
                    recentlyAddedLibrarySectionIds: nextIds,
                    kometaLibrarySectionIds: nextIds,
                };
            }
            return { ...prev, [field]: nextIds };
        });
    }, []);

    const renderLibraryPicker = (
        field: 'coreLibrarySectionIds' | 'recentlyAddedLibrarySectionIds' | 'kometaLibrarySectionIds' | 'librarySectionIds',
        hintKey: string,
        typeFilter?: 'show' | 'movie' | 'all',
    ) => {
        const scoped = sections.filter((section) => {
            if (!typeFilter || typeFilter === 'all') return true;
            return String(section.type || '').toLowerCase() === typeFilter;
        });
        const selected = (configDraft[field] as string[] | undefined) || [];
        const allSelected = selected.length === 0;
        return (
            <div className="py-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={fieldLabelClass}>{t('overlays.settings.libraries')}</span>
                    <button type="button" className="text-xs font-semibold text-plex underline" onClick={() => void loadSections()}>
                        {t('overlays.actions.loadSections')}
                    </button>
                </div>
                <p className="mb-2 text-[11px] text-muted">{t(hintKey)}</p>
                {scoped.length === 0 ? (
                    <p className="text-xs text-muted">{t('overlays.settings.loadSectionsHint')}</p>
                ) : (
                    <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border bg-background/40 p-3">
                        {scoped.map((section) => {
                            const id = section.id || section.key;
                            const checked = allSelected || selected.includes(id);
                            const typeLabel = section.type === 'movie'
                                ? t('overlays.settings.libTypeMovie')
                                : t('overlays.settings.libTypeShow');
                            return (
                                <StyledCheckbox
                                    key={`${field}-${id}`}
                                    checked={checked}
                                    label={`${section.title} · ${typeLabel} (${id})`}
                                    onChange={(next) => updateLibrarySectionIds(field, id, next, scoped)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const summary = status?.lastRunSummary || configDraft.lastRunSummary || null;
    const parsedSummary = useMemo(() => parseRunSummary(summary), [summary]);
    const summaryDetail = useMemo(
        () => (parsedSummary ? formatRunSummaryDetail(parsedSummary, t) : ''),
        [parsedSummary, t],
    );
    const summaryWhen = useMemo(
        () => formatRunSummaryWhen(summary, status?.lastRunAt || configDraft.lastRunAt || null),
        [summary, status?.lastRunAt, configDraft.lastRunAt],
    );
    const bundleRunHint = useCallback((
        bundleSummary: Record<string, unknown> | null | undefined,
    ) => {
        const parsed = parseRunSummary(bundleSummary);
        return parsed ? formatRunSummaryDetail(parsed, t) : '';
    }, [t]);
    const legacySummary = summary && inferRunBundle(summary) !== 'other' ? summary : null;
    const coreRunHint = bundleRunHint(status?.coreLastRunSummary || configDraft.coreLastRunSummary
        || (legacySummary && inferRunBundle(legacySummary) === 'core' ? legacySummary : null));
    const recentlyRunHint = bundleRunHint(status?.recentlyLastRunSummary || configDraft.recentlyLastRunSummary
        || (legacySummary && inferRunBundle(legacySummary) === 'recently' ? legacySummary : null));
    const kometaRunHint = bundleRunHint(status?.kometaLastRunSummary || configDraft.kometaLastRunSummary
        || (legacySummary && inferRunBundle(legacySummary) === 'kometa' ? legacySummary : null));
    const collectionsRunHint = bundleRunHint(status?.collectionsLastRunSummary || configDraft.collectionsLastRunSummary
        || (legacySummary && inferRunBundle(legacySummary) === 'collections' ? legacySummary : null));
    const collectionsWhen = formatRunSummaryWhen(
        status?.collectionsLastRunSummary || configDraft.collectionsLastRunSummary
            || (legacySummary && inferRunBundle(legacySummary) === 'collections' ? legacySummary : null),
        status?.kometaLastRunAt || configDraft.kometaLastRunAt || null,
    );
    const activity = status?.activity || [];
    const workerReady = !!status?.workerReady;
    const runningCommand = String(status?.command || '').trim();
    // Test-title search / library pickers must never freeze settings editing.
    const quietHelperCommand = runningCommand === 'sections'
        || runningCommand === 'sample-candidates'
        || runningCommand === 'status';
    const jobRunning = !!status?.running && !quietHelperCommand;
    const showCount = shows.length || status?.logCount || 0;
    const episodeCount = episodes.length || status?.episodeLogCount || 0;
    const trackedTotal = showCount + episodeCount;
    const runningCommandLabel = runningCommand === 'preview-kometa'
        ? 'preview-layer'
        : runningCommand === 'run-kometa'
            ? 'run-layer'
            : runningCommand === 'preview-collections'
                ? 'preview-collections'
                : runningCommand === 'run-collections'
                    ? 'run-collections'
                    : (runningCommand || '…');
    const coreJobActive = jobRunning && (runningCommand === 'run' || runningCommand === 'preview');
    const recentlyJobActive = jobRunning && (runningCommand === 'run-recently' || runningCommand === 'preview-recently');
    const kometaJobActive = jobRunning && (runningCommand === 'run-kometa' || runningCommand === 'preview-kometa');
    const collectionsJobActive = jobRunning && (runningCommand === 'run-collections' || runningCommand === 'preview-collections');
    const bannersEnabled = configDraft.newSeasonEnabled !== false
        || configDraft.newEpisodeEnabled !== false
        || configDraft.liveScheduleEnabled === true
        || configDraft.top10Enabled === true;
    const kometaEnabled = configDraft.mediaInfoEnabled === true
        || configDraft.editionOverlayEnabled === true
        || configDraft.audioCodecEnabled === true
        || configDraft.videoFormatEnabled === true
        || configDraft.aspectOverlayEnabled === true
        || configDraft.versionsOverlayEnabled === true
        || configDraft.languageCountEnabled === true
        || configDraft.languagesOverlayEnabled === true
        || configDraft.runtimesOverlayEnabled === true
        || configDraft.directPlayOverlayEnabled === true
        || configDraft.episodeInfoOverlayEnabled === true
        || configDraft.contentRatingEnabled === true
        || configDraft.statusOverlayEnabled === true
        || configDraft.ratingsOverlayEnabled === true
        || configDraft.networkOverlayEnabled === true
        || configDraft.streamingOverlayEnabled === true
        || configDraft.ribbonOverlayEnabled === true
        || configDraft.mediastingerOverlayEnabled === true;
    const collectionRules = Array.isArray(configDraft.customCollectionOverlays)
        ? configDraft.customCollectionOverlays
        : [];
    const collectionsEnabled = configDraft.customCollectionOverlaysEnabled === true
        && collectionRules.length > 0;

    /** "At a glance" category rollup shown above the tabs, independent of which tab is open. */
    const categorySummary = useMemo(() => {
        const anyOn = (...vals: Array<boolean | undefined>) => vals.some((v) => v === true);
        return [
            {
                id: 'newReturning',
                label: t('overlays.categories.newReturning'),
                enabled: configDraft.newSeasonEnabled !== false || configDraft.newEpisodeEnabled !== false,
                jobCard: 'banners' as JobCardId,
                tabId: 'home' as TabId,
                sectionId: 'overlay-banners-newSeason',
            },
            {
                id: 'recentlyAdded',
                label: t('overlays.categories.recentlyAdded'),
                enabled: configDraft.recentlyAddedEnabled === true,
                jobCard: 'recently' as JobCardId,
                tabId: 'home' as TabId,
                sectionId: 'overlay-job-recently',
            },
            {
                id: 'live',
                label: t('overlays.categories.live'),
                enabled: configDraft.liveScheduleEnabled === true,
                jobCard: 'banners' as JobCardId,
                tabId: 'home' as TabId,
                sectionId: 'overlay-banners-liveTop10',
            },
            {
                id: 'top10',
                label: t('overlays.categories.top10'),
                enabled: configDraft.top10Enabled === true,
                jobCard: 'banners' as JobCardId,
                tabId: 'home' as TabId,
                sectionId: 'overlay-banners-liveTop10',
            },
            {
                id: 'qualityFormat',
                label: t('overlays.categories.qualityFormat'),
                enabled: anyOn(
                    configDraft.mediaInfoEnabled,
                    configDraft.editionOverlayEnabled,
                    configDraft.audioCodecEnabled,
                    configDraft.videoFormatEnabled,
                    configDraft.aspectOverlayEnabled,
                    configDraft.versionsOverlayEnabled,
                    configDraft.directPlayOverlayEnabled,
                ),
                jobCard: 'kometa' as JobCardId,
                tabId: 'home' as TabId,
                groupId: 'kometa.quality',
            },
            {
                id: 'availability',
                label: t('overlays.categories.availability'),
                enabled: anyOn(configDraft.statusOverlayEnabled, configDraft.networkOverlayEnabled, configDraft.streamingOverlayEnabled),
                jobCard: 'kometa' as JobCardId,
                tabId: 'home' as TabId,
                groupId: 'kometa.availability',
            },
            {
                id: 'ratingsReviews',
                label: t('overlays.categories.ratingsReviews'),
                enabled: anyOn(configDraft.ratingsOverlayEnabled, configDraft.contentRatingEnabled, configDraft.ribbonOverlayEnabled),
                jobCard: 'kometa' as JobCardId,
                tabId: 'home' as TabId,
                groupId: 'kometa.ratings',
            },
            {
                id: 'languageRuntime',
                label: t('overlays.categories.languageRuntime'),
                enabled: anyOn(
                    configDraft.languageCountEnabled,
                    configDraft.languagesOverlayEnabled,
                    configDraft.runtimesOverlayEnabled,
                    configDraft.episodeInfoOverlayEnabled,
                ),
                jobCard: 'kometa' as JobCardId,
                tabId: 'home' as TabId,
                groupId: 'kometa.technical',
            },
            {
                id: 'bonusContent',
                label: t('overlays.categories.bonusContent'),
                enabled: configDraft.mediastingerOverlayEnabled === true,
                jobCard: 'kometa' as JobCardId,
                tabId: 'home' as TabId,
                groupId: 'kometa.bonus',
            },
            {
                id: 'collectionBadges',
                label: t('overlays.categories.collectionBadges'),
                enabled: collectionsEnabled,
                jobCard: 'collections' as JobCardId,
                tabId: 'badges' as TabId,
            },
        ];
    }, [configDraft, collectionsEnabled, t]);

    const formatKometaFamilies = useCallback((row: any) => {
        if (row?.orphanBackup) return t('overlays.kometa.orphanBackup');
        if (!row?.families || typeof row.families !== 'object') return '—';
        const labels = Object.entries(row.families)
            .map(([family, meta]: [string, any]) => `${family}:${meta?.name || '?'}`)
            .join(', ');
        return labels || '—';
    }, [t]);

    const kometaSections = useMemo(() => {
        type Section = {
            id: string;
            title: string;
            library: string;
            kind: 'collection' | 'other';
            ruleId: string;
            rows: any[];
        };
        const byId = new Map<string, Section>();
        const other: Section = {
            id: 'other-kometa',
            title: '',
            library: '',
            kind: 'other',
            ruleId: '',
            rows: [],
        };
        for (const row of kometaItems) {
            const fam = row?.families?.custom_collection;
            if (!fam || typeof fam !== 'object') {
                other.rows.push(row);
                continue;
            }
            const badgeRows = [{
                ruleId: fam.extra?.ruleId || fam.name,
                name: fam.text || fam.name,
                collectionTitle: fam.extra?.collectionTitle,
                library: fam.extra?.library,
            }];
            const seenRule = new Set<string>();
            for (const badge of badgeRows) {
                const ruleId = String(badge.ruleId || fam.extra?.ruleId || fam.name || '').trim();
                if (ruleId && seenRule.has(ruleId)) continue;
                if (ruleId) seenRule.add(ruleId);
                const rule = collectionRules.find((r) => r.id === ruleId);
                // Prefer the user-editable rule name so renames show on the list immediately.
                const title = String(
                    rule?.name
                    || badge.name
                    || fam.text
                    || badge.collectionTitle
                    || fam.extra?.collectionTitle
                    || rule?.collectionTitle
                    || ruleId
                    || 'Collection',
                ).trim() || 'Collection';
                const library = String(
                    badge.library || fam.extra?.library || rule?.library || row.library || '',
                ).trim();
                const id = ruleId ? `collection:${ruleId}` : `collection:${title}:${library}`;
                let section = byId.get(id);
                if (!section) {
                    section = { id, title, library, kind: 'collection', ruleId, rows: [] };
                    byId.set(id, section);
                }
                section.rows.push(row);
            }
        }
        // Always show configured rules as their own collapsible section (even with 0 stamps).
        for (const rule of collectionRules) {
            if (!rule?.id) continue;
            const id = `collection:${rule.id}`;
            const existing = byId.get(id);
            if (existing) {
                if (rule.name) existing.title = rule.name;
                const libs = Array.isArray(rule.libraries) && rule.libraries.length
                    ? rule.libraries
                    : (rule.library ? [rule.library] : []);
                if (libs.length) existing.library = libs.join(' · ');
                continue;
            }
            const libs = Array.isArray(rule.libraries) && rule.libraries.length
                ? rule.libraries
                : (rule.library ? [rule.library] : []);
            byId.set(id, {
                id,
                title: String(rule.name || rule.collectionTitle || rule.id).trim() || rule.id,
                library: libs.join(' · '),
                kind: 'collection',
                ruleId: rule.id,
                rows: [],
            });
        }
        const next = [...byId.values()].sort((a, b) => {
            const la = `${a.library} ${a.title}`.toLowerCase();
            const lb = `${b.library} ${b.title}`.toLowerCase();
            return la.localeCompare(lb);
        });
        if (other.rows.length) next.push(other);
        return next;
    }, [kometaItems, collectionRules]);

    const collectionSections = useMemo(
        () => kometaSections.filter((section) => section.kind === 'collection'),
        [kometaSections],
    );
    const otherKometaSections = useMemo(
        () => kometaSections.filter((section) => section.kind === 'other'),
        [kometaSections],
    );
    const kometaOtherCount = useMemo(
        () => otherKometaSections.reduce((sum, section) => sum + section.rows.length, 0),
        [otherKometaSections],
    );
    const collectionTrackedCount = useMemo(() => {
        const keys = new Set<string>();
        for (const section of collectionSections) {
            for (const row of section.rows) {
                const key = String(row?.ratingKey || '').trim();
                if (key) keys.add(key);
            }
        }
        return keys.size;
    }, [collectionSections]);

    const tabs = useMemo(() => ([
        { id: 'home' as const, label: t('overlays.tabs.home'), icon: Layers },
        {
            id: 'badges' as const,
            label: t('overlays.tabs.badges', { count: collectionRules.length }),
            icon: FolderKanban,
        },
        {
            id: 'tracked' as const,
            label: t('overlays.tabs.tracked', {
                count: showCount,
                episodes: episodeCount,
                kometa: kometaOtherCount,
                collections: collectionTrackedCount,
            }),
            icon: List,
        },
        { id: 'look' as const, label: t('overlays.tabs.look'), icon: Move },
        { id: 'activity' as const, label: t('overlays.tabs.activity'), icon: Activity },
    ]), [showCount, episodeCount, kometaOtherCount, collectionTrackedCount, collectionRules.length, t]);

    const toggleJobCard = useCallback((id: JobCardId) => {
        setJobCardExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
    }, []);

    // Bumping a key here forces the matching OverlaySettingsGroup open and scrolls to itself.
    const [groupOpenSignal, setGroupOpenSignal] = useState<Record<string, number>>({});
    // A plain DOM id (job card or a non-collapsible divider) to scroll to once it exists on screen.
    const [pendingScrollTo, setPendingScrollTo] = useState<{ id: string; n: number } | null>(null);
    // Bumping this selects a target on the Placement tab (e.g. from a "Position on poster" link in Configure).
    const [placementFocusTarget, setPlacementFocusTarget] = useState<{ id: string; n: number } | null>(null);

    /** Jump to the Placement tab with a specific target (show/season/episode/media/status/ratings/network/…) pre-selected. */
    const openPlacement = useCallback((targetId: string) => {
        setTab('look');
        setPlacementFocusTarget({ id: targetId, n: Date.now() });
        setPendingScrollTo({ id: 'overlay-placement-panel', n: Date.now() });
    }, []);

    useEffect(() => {
        if (!pendingScrollTo) return undefined;
        let cancelled = false;
        let attempts = 0;
        const tryScroll = () => {
            if (cancelled) return;
            const el = document.getElementById(pendingScrollTo.id);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (attempts < 15) {
                attempts += 1;
                window.setTimeout(tryScroll, 60);
            }
        };
        tryScroll();
        return () => {
            cancelled = true;
        };
    }, [pendingScrollTo]);

    /** Jump from an "at a glance" category chip straight to its settings, expanded and in view. */
    const openCategory = useCallback((cat: {
        jobCard: JobCardId;
        tabId: TabId;
        groupId?: string;
        sectionId?: string;
    }) => {
        setJobCardExpanded((prev) => ({ ...prev, [cat.jobCard]: true }));
        setTab(cat.tabId);
        if (cat.groupId) {
            setGroupOpenSignal((prev) => ({ ...prev, [cat.groupId as string]: Date.now() }));
        } else if (cat.sectionId) {
            setPendingScrollTo({ id: cat.sectionId, n: Date.now() });
        }
    }, []);

    /** A small "Position the X on the poster →" link that jumps to the Placement tab with that target pre-selected. */
    const renderPlacementLink = (kindId: string) => (
        <button
            type="button"
            onClick={() => openPlacement(kindId)}
            className="mt-1 mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-plex hover:underline"
        >
            <Move className="h-3 w-3" />
            {t('overlays.placement.jumpTo', { name: t(`overlays.placement.kinds.${kindId}`) })}
        </button>
    );

    /** Explains, honestly, that a badge doesn't have an adjustable position yet — instead of a link that goes nowhere. */
    const renderFixedPositionNote = (noteKey: string) => (
        <p className="mt-1 mb-2 text-[11px] text-muted">{t(noteKey)}</p>
    );

    const seasonPresetOptions = useMemo(
        () => (status?.presets || [])
            .filter((preset: { kind?: string; id?: string }) => {
                const id = String(preset.id || '').toLowerCase();
                if (id === 'recently-added') return false;
                return (preset.kind || 'season') === 'season';
            })
            .map((preset: { id: string; source?: string }) => ({
                value: preset.id,
                label: preset.source === 'custom' ? `${preset.id} (custom)` : preset.id,
            })),
        [status?.presets],
    );

    const episodePresetOptions = useMemo(
        () => (status?.presets || [])
            .filter((preset: { kind?: string }) => preset.kind === 'episode')
            .map((preset: { id: string; source?: string }) => ({
                value: preset.id,
                label: preset.source === 'custom' ? `${preset.id} (custom)` : preset.id,
            })),
        [status?.presets],
    );

    const recentlyPresetOptions = useMemo(() => {
        const season = (status?.presets || [])
            .filter((preset: { kind?: string }) => (preset.kind || 'season') === 'season')
            .map((preset: { id: string; source?: string }) => ({
                value: preset.id,
                label: preset.source === 'custom' ? `${preset.id} (custom)` : preset.id,
            }));
        if (!season.some((opt) => opt.value === 'recently-added')) {
            return [{ value: 'recently-added', label: 'recently-added' }, ...season];
        }
        // Prefer recently-added first in the list.
        return [
            ...season.filter((opt) => opt.value === 'recently-added'),
            ...season.filter((opt) => opt.value !== 'recently-added'),
        ];
    }, [status?.presets]);

    const collectionPresetPreviewId = useMemo(() => {
        const fromRules = collectionRules.find((r) => r?.image)?.image;
        if (fromRules) return String(fromRules);
        const custom = (status?.presets || []).find((p: { kind?: string }) => p.kind === 'collection');
        return custom?.id || '';
    }, [collectionRules, status?.presets]);

    const loadCollectionPicker = useCallback(async () => {
        setCollectionPickerLoading(true);
        setCollectionPickerError('');
        try {
            if (sections.length === 0) {
                await loadSections();
            }
            const list = await collexionsApi.getCollections(false, { light: true });
            const opts = (Array.isArray(list) ? list : [])
                .filter((c) => c?.ratingKey && String(c.library || '').trim())
                .map((c) => ({
                    value: String(c.ratingKey),
                    label: `${c.title || c.ratingKey}${c.library ? ` (${c.library})` : ''}`,
                    title: String(c.title || ''),
                    library: String(c.library || ''),
                }))
                .sort((a, b) => a.label.localeCompare(b.label));
            setCollectionPickerOptions(opts);
            if (!opts.length) {
                setCollectionPickerError(t('overlays.jobs.collections.noCollections'));
            }
        } catch (e: any) {
            setCollectionPickerOptions([]);
            setCollectionPickerError(e?.message || t('overlays.jobs.collections.noCollections'));
        } finally {
            setCollectionPickerLoading(false);
        }
    }, [t, sections.length, loadSections]);

    useEffect(() => {
        if (tab === 'badges' || jobCardExpanded.collections) {
            if (collectionPickerOptions.length === 0 && !collectionPickerLoading) {
                void loadCollectionPicker();
            }
        }
    }, [tab, jobCardExpanded.collections, collectionPickerOptions.length, collectionPickerLoading, loadCollectionPicker]);

    const libraryPickerOptions = useMemo(() => {
        const fromSections = sections
            .map((s) => ({
                value: String(s.title || '').trim(),
                label: `${s.title}${s.type ? ` (${s.type})` : ''}`,
                sectionId: String(s.id || s.key || ''),
            }))
            .filter((s) => s.value);
        if (fromSections.length) return fromSections;
        // Fallback from known collection libraries if sections not loaded yet.
        const seen = new Set<string>();
        const fromCollections: Array<{ value: string; label: string; sectionId: string }> = [];
        for (const opt of collectionPickerOptions) {
            const lib = String(opt.library || '').trim();
            if (!lib || seen.has(lib.toLowerCase())) continue;
            seen.add(lib.toLowerCase());
            fromCollections.push({ value: lib, label: lib, sectionId: '' });
        }
        return fromCollections.sort((a, b) => a.label.localeCompare(b.label));
    }, [sections, collectionPickerOptions]);

    const filteredCollectionOptions = useMemo(() => {
        const libs = new Set(selectedLibraries.map((lib) => lib.trim().toLowerCase()).filter(Boolean));
        if (!libs.size) return [];
        const q = newCollectionSearch.trim().toLowerCase();
        return collectionPickerOptions.filter((o) => {
            if (!libs.has(String(o.library || '').trim().toLowerCase())) return false;
            if (!q) return true;
            const hay = `${o.title || ''} ${o.label || ''} ${o.value || ''}`.toLowerCase();
            return hay.includes(q);
        });
    }, [collectionPickerOptions, selectedLibraries, newCollectionSearch]);

    const selectedCollectionOptions = useMemo(
        () => collectionPickerOptions.filter((o) => selectedCollectionKeys.includes(o.value)),
        [collectionPickerOptions, selectedCollectionKeys],
    );

    /** Keys still selected in the form but gone from Plex / the picker (recreated collections). */
    const missingSelectedCollectionKeys = useMemo(() => {
        if (!collectionPickerOptions.length || !selectedCollectionKeys.length) return [] as string[];
        const known = new Set(collectionPickerOptions.map((o) => o.value));
        return selectedCollectionKeys.filter((key) => !known.has(key));
    }, [collectionPickerOptions, selectedCollectionKeys]);

    const collectionsInSelectedLibrariesCount = useMemo(() => {
        const libs = new Set(selectedLibraries.map((lib) => lib.trim().toLowerCase()).filter(Boolean));
        if (!libs.size) return 0;
        return collectionPickerOptions.filter(
            (o) => libs.has(String(o.library || '').trim().toLowerCase()),
        ).length;
    }, [collectionPickerOptions, selectedLibraries]);

    // Drop stale ratingKeys after the picker loads — edit form keeps old keys that no longer exist.
    useEffect(() => {
        if (!collectionPickerOptions.length || !missingSelectedCollectionKeys.length) return;
        const known = new Set(collectionPickerOptions.map((o) => o.value));
        setSelectedCollectionKeys((prev) => {
            const next = prev.filter((key) => known.has(key));
            return next.length === prev.length ? prev : next;
        });
    }, [collectionPickerOptions, missingSelectedCollectionKeys]);

    useEffect(() => {
        if (!newCollectionRuleFile) {
            setNewCollectionFilePreview(null);
            return;
        }
        const url = URL.createObjectURL(newCollectionRuleFile);
        setNewCollectionFilePreview(url);
        return () => URL.revokeObjectURL(url);
    }, [newCollectionRuleFile]);

    const ruleCollectionKeys = useCallback((rule: CustomCollectionOverlayRule | null | undefined) => {
        if (!rule) return [] as string[];
        if (Array.isArray(rule.collectionRatingKeys) && rule.collectionRatingKeys.length) {
            return rule.collectionRatingKeys.map((k) => String(k || '').trim()).filter(Boolean);
        }
        const singular = String(rule.collectionRatingKey || '').trim();
        return singular ? [singular] : [];
    }, []);

    const ruleLibraries = useCallback((rule: CustomCollectionOverlayRule | null | undefined) => {
        if (!rule) return [] as string[];
        if (Array.isArray(rule.libraries) && rule.libraries.length) {
            return rule.libraries.map((lib) => String(lib || '').trim()).filter(Boolean);
        }
        const singular = String(rule.library || '').trim();
        return singular ? [singular] : [];
    }, []);

    const ruleLibraryLabel = useCallback((rule: CustomCollectionOverlayRule | null | undefined) => {
        const libs = ruleLibraries(rule);
        if (!libs.length) return '';
        if (libs.length <= 2) return libs.join(' · ');
        return `${libs.slice(0, 2).join(' · ')} +${libs.length - 2}`;
    }, [ruleLibraries]);

    const ruleCollectionLabel = useCallback((rule: CustomCollectionOverlayRule | null | undefined) => {
        if (!rule) return '';
        const keys = ruleCollectionKeys(rule);
        const titles = keys.map((key) => {
            const mapped = rule.collectionTitles?.[key];
            if (mapped) return mapped;
            if (key === rule.collectionRatingKey && rule.collectionTitle) return rule.collectionTitle;
            return key;
        });
        return titles.filter(Boolean).join(' · ');
    }, [ruleCollectionKeys]);

    const resetNewCollectionForm = useCallback(() => {
        setNewCollectionRuleName('');
        setSelectedLibraries([]);
        setSelectedCollectionKeys([]);
        setEditingRuleId(null);
        setEditingRuleImageId('');
        setNewCollectionRuleFile(null);
        setNewCollectionSearch('');
        setNewCollectionFilePreview(null);
        setBadgeWizardStep(1);
    }, []);

    const beginEditCollectionRule = useCallback((rule: CustomCollectionOverlayRule) => {
        if (!rule?.id) return;
        setTab('badges');
        setBadgeWizardStep(1);
        setJobCardExpanded((prev) => ({ ...prev, collections: true }));
        setEditingRuleId(rule.id);
        setEditingRuleImageId(String(rule.image || '').trim());
        setNewCollectionRuleName(String(rule.name || '').trim());
        setSelectedLibraries(ruleLibraries(rule));
        setSelectedCollectionKeys(ruleCollectionKeys(rule));
        setNewCollectionRuleFile(null);
        setNewCollectionSearch('');
        void loadCollectionPicker();
    }, [loadCollectionPicker, ruleCollectionKeys, ruleLibraries]);

    const toggleLibrary = useCallback((lib: string) => {
        const value = String(lib || '').trim();
        if (!value) return;
        setSelectedLibraries((prev) => {
            const next = prev.includes(value)
                ? prev.filter((item) => item !== value)
                : [...prev, value];
            const allowed = new Set(next.map((item) => item.toLowerCase()));
            setSelectedCollectionKeys((keys) => keys.filter((key) => {
                const opt = collectionPickerOptions.find((o) => o.value === key);
                return opt && allowed.has(String(opt.library || '').trim().toLowerCase());
            }));
            return next;
        });
        setNewCollectionSearch('');
    }, [collectionPickerOptions]);

    const selectAllLibraries = useCallback(() => {
        setSelectedLibraries(libraryPickerOptions.map((o) => o.value).filter(Boolean));
    }, [libraryPickerOptions]);

    const clearLibraries = useCallback(() => {
        setSelectedLibraries([]);
        setSelectedCollectionKeys([]);
        setNewCollectionSearch('');
    }, []);

    const toggleCollectionKey = useCallback((opt: { value: string; title?: string; label?: string }) => {
        const key = String(opt.value || '').trim();
        if (!key) return;
        setSelectedCollectionKeys((prev) => (
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        ));
        setNewCollectionRuleName((prev) => {
            if (prev.trim()) return prev;
            return String(opt.title || opt.label || '').trim();
        });
    }, []);

    const selectAllFilteredCollections = useCallback(() => {
        const keys = filteredCollectionOptions.map((o) => o.value).filter(Boolean);
        setSelectedCollectionKeys((prev) => {
            const next = new Set(prev);
            keys.forEach((key) => next.add(key));
            return [...next];
        });
        setNewCollectionRuleName((prev) => {
            if (prev.trim()) return prev;
            const first = filteredCollectionOptions[0];
            return String(first?.title || first?.label || '').trim();
        });
    }, [filteredCollectionOptions]);

    const clearSelectedCollections = useCallback(() => {
        setSelectedCollectionKeys([]);
    }, []);

    const saveCollectionOverlayRule = useCallback(async () => {
        const libraries = selectedLibraries.map((lib) => lib.trim()).filter(Boolean);
        if (!libraries.length) {
            toast(t('overlays.jobs.collections.libraryRequired'), 'error');
            return;
        }
        if (!selectedCollectionKeys.length) {
            toast(t('overlays.jobs.collections.saveHint'), 'error');
            return;
        }
        const isEdit = Boolean(editingRuleId);
        if (!isEdit && !newCollectionRuleFile) {
            toast(t('overlays.jobs.collections.saveHint'), 'error');
            return;
        }
        const allowedLibs = new Set(libraries.map((lib) => lib.toLowerCase()));
        let keysToSave = [...selectedCollectionKeys];
        let pickedRows = keysToSave.map((key) => {
            const opt = collectionPickerOptions.find((o) => o.value === key);
            return { key, opt };
        });
        const missingRows = pickedRows.filter((row) => !row.opt);
        if (missingRows.length) {
            const known = new Set(collectionPickerOptions.map((o) => o.value));
            keysToSave = keysToSave.filter((key) => known.has(key));
            setSelectedCollectionKeys(keysToSave);
            if (!keysToSave.length) {
                toast(t('overlays.jobs.collections.missingCollections'), 'error');
                return;
            }
            toast(t('overlays.jobs.collections.missingCollectionsPruned', {
                count: missingRows.length,
            }));
            pickedRows = keysToSave.map((key) => ({
                key,
                opt: collectionPickerOptions.find((o) => o.value === key),
            }));
        }
        for (const row of pickedRows) {
            const lib = String(row.opt?.library || '').trim().toLowerCase();
            if (!row.opt || !lib || !allowedLibs.has(lib)) {
                toast(t('overlays.jobs.collections.libraryMismatch'), 'error');
                return;
            }
        }
        try {
            let imageId = editingRuleImageId;
            let previousImageId = '';
            if (newCollectionRuleFile) {
                const up = await overlaysApi.uploadPreset('collection', newCollectionRuleFile);
                imageId = String(up?.preset?.id || '').trim();
                if (!imageId) throw new Error(t('overlays.jobs.collections.uploadFailed'));
                if (isEdit) previousImageId = editingRuleImageId;
            }
            if (!imageId) {
                toast(t('overlays.jobs.collections.saveHint'), 'error');
                return;
            }
            const librarySectionIds = libraries
                .map((lib) => libraryPickerOptions.find(
                    (o) => o.value.toLowerCase() === lib.toLowerCase(),
                )?.sectionId || '')
                .filter(Boolean);
            const collectionTitles: Record<string, string> = {};
            for (const row of pickedRows) {
                const title = String(row.opt?.title || row.opt?.label || '').trim();
                if (title) collectionTitles[row.key] = title;
            }
            const firstKey = keysToSave[0];
            const defaultName = collectionTitles[firstKey] || firstKey || imageId;
            const rule: CustomCollectionOverlayRule = {
                id: isEdit && editingRuleId ? editingRuleId : `cc-${Date.now().toString(36)}`,
                name: (newCollectionRuleName || defaultName).trim(),
                collectionRatingKey: firstKey,
                collectionTitle: collectionTitles[firstKey] || '',
                collectionRatingKeys: [...keysToSave],
                collectionTitles,
                library: libraries[0],
                libraries: [...libraries],
                librarySectionId: librarySectionIds[0] || '',
                librarySectionIds,
                image: imageId,
            };
            const prev = configDraftRef.current;
            const prevRules = Array.isArray(prev.customCollectionOverlays) ? prev.customCollectionOverlays : [];
            const customCollectionOverlays = isEdit
                ? prevRules.map((r) => (r.id === rule.id ? rule : r))
                : [...prevRules, rule];
            if (isEdit && !prevRules.some((r) => r.id === rule.id)) {
                toast(t('overlays.jobs.collections.renameMissing'), 'error');
                return;
            }
            const saved = await overlaysApi.saveConfig({
                customCollectionOverlaysEnabled: true,
                customCollectionOverlays,
            });
            setConfigDraft((draft) => ({
                ...draft,
                ...(saved?.config || {}),
                customCollectionOverlaysEnabled: true,
                customCollectionOverlays: saved?.config?.customCollectionOverlays || customCollectionOverlays,
            }));
            if (previousImageId && previousImageId !== imageId) {
                const stillUsed = (saved?.config?.customCollectionOverlays || customCollectionOverlays)
                    .some((r: CustomCollectionOverlayRule) => r.image === previousImageId);
                if (!stillUsed) {
                    await overlaysApi.deleteCustomPreset(previousImageId).catch(() => {});
                }
            }
            resetNewCollectionForm();
            await refresh();
            toast(isEdit
                ? t('overlays.jobs.collections.ruleUpdated', { name: rule.name })
                : t('overlays.jobs.collections.ruleAdded', { name: rule.name }));
        } catch (e: any) {
            toast(e?.message || t('overlays.jobs.collections.uploadFailed'), 'error');
        }
    }, [
        selectedLibraries,
        selectedCollectionKeys,
        editingRuleId,
        editingRuleImageId,
        newCollectionRuleFile,
        newCollectionRuleName,
        collectionPickerOptions,
        libraryPickerOptions,
        toast,
        t,
        refresh,
        resetNewCollectionForm,
    ]);

    const removeCollectionOverlayRule = useCallback(async (id: string) => {
        const prev = configDraftRef.current;
        const prevRules = Array.isArray(prev.customCollectionOverlays) ? prev.customCollectionOverlays : [];
        const doomed = prevRules.find((r) => r.id === id);
        if (!doomed) {
            toast(t('overlays.jobs.collections.renameMissing'), 'error');
            return;
        }
        const stampRows = collectionSections
            .filter((section) => section.ruleId === id)
            .flatMap((section) => section.rows);
        const stampCount = stampRows.length;
        const ok = await askConfirm(
            stampCount > 0
                ? t('overlays.jobs.collections.deleteConfirmStamps', {
                    name: doomed.name,
                    count: stampCount,
                })
                : t('overlays.jobs.collections.deleteConfirm', { name: doomed.name }),
            {
                title: t('overlays.jobs.collections.deleteTitle'),
                confirmLabel: t('overlays.jobs.collections.deleteRule'),
                cancelLabel: t('common.cancel', { defaultValue: 'Cancel' }),
                danger: true,
            },
        );
        if (!ok) return;

        const next = prevRules.filter((r) => r.id !== id);
        const customCollectionOverlaysEnabled = next.length > 0
            ? prev.customCollectionOverlaysEnabled !== false
            : false;
        setConfigDraft((draft) => ({
            ...draft,
            customCollectionOverlays: next,
            customCollectionOverlaysEnabled,
        }));
        if (editingRuleId === id) resetNewCollectionForm();
        try {
            const saved = await overlaysApi.saveConfig({
                customCollectionOverlays: next,
                customCollectionOverlaysEnabled,
            });
            if (saved?.config) {
                setConfigDraft((draft) => ({
                    ...draft,
                    customCollectionOverlays: saved.config.customCollectionOverlays || next,
                    customCollectionOverlaysEnabled: saved.config.customCollectionOverlaysEnabled === true,
                }));
            }
            setBusy('revertKometa');
            try {
                await overlaysApi.dropKometaFamily({
                    family: 'custom_collection',
                    ruleId: id,
                });
            } finally {
                setBusy(null);
            }
            const imageId = String(doomed.image || '').trim();
            if (imageId) {
                const stillUsed = (saved?.config?.customCollectionOverlays || next)
                    .some((r: CustomCollectionOverlayRule) => r.image === imageId);
                if (!stillUsed) {
                    await overlaysApi.deleteCustomPreset(imageId).catch(() => {});
                }
            }
            toast(t('overlays.jobs.collections.ruleRemoved'));
            await refresh({ syncConfig: true });
        } catch (e: any) {
            toast(e?.message || t('overlays.jobs.collections.ruleRemoveFailed'), 'error');
            await refresh({ syncConfig: true }).catch(() => {});
        }
    }, [
        collectionSections,
        editingRuleId,
        refresh,
        resetNewCollectionForm,
        t,
        toast,
    ]);

    const bingeGroups = useMemo(() => {
        const map = new Map<string, any[]>();
        for (const row of episodes) {
            if (!row.bingeGroupId) continue;
            if (!map.has(row.bingeGroupId)) map.set(row.bingeGroupId, []);
            map.get(row.bingeGroupId)!.push(row);
        }
        return map;
    }, [episodes]);

    const episodeRowsGrouped = useMemo(() => {
        const rendered = new Set<string>();
        const out: Array<{ type: 'group' | 'row'; groupId?: string; rows?: any[]; row?: any }> = [];
        for (const row of episodes) {
            if (row.bingeGroupId) {
                if (rendered.has(row.bingeGroupId)) continue;
                rendered.add(row.bingeGroupId);
                out.push({ type: 'group', groupId: row.bingeGroupId, rows: bingeGroups.get(row.bingeGroupId) || [] });
            } else {
                out.push({ type: 'row', row });
            }
        }
        return out;
    }, [episodes, bingeGroups]);

    const importModeOptions = useMemo(() => ([
        { value: 'merge', label: t('overlays.import.modeMerge') },
        { value: 'replace', label: t('overlays.import.modeReplace') },
    ]), [t]);

    const actionLabel = (id: ActionId) => t(`overlays.actionLabels.${id}`);

    const runAction = async (
        id: ActionId,
        fn: () => Promise<unknown>,
        { startedToast = false, skipRefresh = false }: { startedToast?: boolean; skipRefresh?: boolean } = {},
    ) => {
        setBusy(id);
        const label = actionLabel(id);
        try {
            await fn();
            if (!skipRefresh) {
                // Only re-apply server config after an explicit save (or caller syncs itself).
                await refresh({ syncConfig: id === 'saveSettings' });
            }
            toast(startedToast ? t('overlays.actionStarted', { action: label }) : t('overlays.actionComplete', { action: label }));
        } catch (error) {
            toast(error instanceof Error ? error.message : t('overlays.actionFailed', { action: label }), 'error');
        } finally {
            setBusy(null);
        }
    };

    const startBackgroundJob = (id: ActionId, fn: () => Promise<unknown>) => {
        intentionalStartRef.current = true;
        setTab('activity');
        setBusy(id);
        const label = actionLabel(id);
        void (async () => {
            try {
                const result = await fn() as { queued?: boolean; position?: number } | undefined;
                if (result?.queued) {
                    toast(t('overlays.actionQueued', {
                        action: label,
                        position: result.position ?? '?',
                    }));
                } else {
                    toast(t('overlays.actionStarted', { action: label }));
                }
            } catch (error) {
                intentionalStartRef.current = false;
                toast(error instanceof Error ? error.message : t('overlays.actionFailed', { action: label }), 'error');
            } finally {
                setBusy(null);
            }
            void refresh().catch(() => {});
        })();
    };

    const jobTitleTestDisabled = busy !== null || jobRunning || !workerReady;

    /**
     * Single "test title" stamp: instead of a separate search/stamp bar on every job card,
     * one picked title is stamped across every overlay job that's currently enabled. Each
     * backend job already no-ops for titles it doesn't apply to (e.g. Recently Added on a
     * title outside its window), so it's safe to fire all active jobs at once and let each
     * decide for itself.
     */
    const stampAllActiveForTitle = (ratingKey: string, title: string) => {
        const jobs: Array<{ id: ActionId; fn: () => Promise<unknown> }> = [];
        if (bannersEnabled) {
            jobs.push({ id: 'run', fn: () => overlaysApi.run({ preview: false, bundle: 'core', onlyRatingKeys: [ratingKey] }) });
        }
        if (configDraft.recentlyAddedEnabled === true) {
            jobs.push({ id: 'runRecently', fn: () => overlaysApi.run({ preview: false, bundle: 'recently', onlyRatingKeys: [ratingKey] }) });
        }
        if (kometaEnabled) {
            jobs.push({
                id: 'runKometa',
                fn: () => overlaysApi.run({ preview: false, bundle: 'kometa', scope: 'media', onlyRatingKeys: [ratingKey] }),
            });
        }
        if (collectionsEnabled) {
            jobs.push({ id: 'runCollections', fn: () => overlaysApi.run({ preview: false, bundle: 'collections', onlyRatingKeys: [ratingKey] }) });
        }

        if (!jobs.length) {
            toast(t('overlays.jobs.testTitle.noneActive'), 'error');
            return;
        }

        toast(t('overlays.jobs.testTitle.startedAll', { title, count: jobs.length }));
        jobs.forEach(({ id, fn }) => startBackgroundJob(id, fn));
    };

    const activeTestTitleJobLabels = [
        bannersEnabled ? t('overlays.jobs.banners.title') : null,
        configDraft.recentlyAddedEnabled === true ? t('overlays.jobs.recently.title') : null,
        kometaEnabled ? t('overlays.jobs.kometa.title') : null,
        collectionsEnabled ? t('overlays.jobs.collections.title') : null,
    ].filter((label): label is string => Boolean(label));
    const testTitleHint = activeTestTitleJobLabels.length
        ? t('overlays.jobs.testTitle.hintActive', { jobs: activeTestTitleJobLabels.join(', ') })
        : t('overlays.jobs.testTitle.noneActive');
    const testTitleBusy = busy === 'run' || busy === 'runRecently' || busy === 'runKometa' || busy === 'runCollections' || jobRunning;

    const saveSettings = () => runAction('saveSettings', async () => {
        const draft = configDraftRef.current;
        const prevSeason = status?.config?.overlayPresetId || 'new-season';
        const prevEpisode = status?.config?.episodeOverlayPresetId || 'new-episode';
        await overlaysApi.saveConfig(draft);
        if (
            (draft.overlayPresetId || 'new-season') !== prevSeason
            || (draft.episodeOverlayPresetId || 'new-episode') !== prevEpisode
        ) {
            await regenerateSamples({ quiet: true });
        }
    });

    const placementDraft: OverlaysPlacement = {
        ...DEFAULT_OVERLAY_PLACEMENT,
        ...(configDraft.placement || {}),
        show: { ...DEFAULT_OVERLAY_PLACEMENT.show, ...(configDraft.placement?.show || {}) },
        season: { ...DEFAULT_OVERLAY_PLACEMENT.season, ...(configDraft.placement?.season || {}) },
        episode: { ...DEFAULT_OVERLAY_PLACEMENT.episode, ...(configDraft.placement?.episode || {}) },
        recently: { ...DEFAULT_OVERLAY_PLACEMENT.recently!, ...(configDraft.placement?.recently || {}) },
        media: { ...DEFAULT_OVERLAY_PLACEMENT.media!, ...(configDraft.placement?.media || {}) },
        status: { ...DEFAULT_OVERLAY_PLACEMENT.status!, ...(configDraft.placement?.status || {}) },
        ratings: { ...DEFAULT_OVERLAY_PLACEMENT.ratings!, ...(configDraft.placement?.ratings || {}) },
        network: { ...DEFAULT_OVERLAY_PLACEMENT.network!, ...(configDraft.placement?.network || {}) },
        custom_collection: {
            ...DEFAULT_OVERLAY_PLACEMENT.custom_collection!,
            ...(configDraft.placement?.custom_collection || {}),
        },
    };

    const savePlacement = () => runAction('saveSettings', async () => {
        const saved = await overlaysApi.saveConfig({
            placement: placementDraft,
            overlayPresetId: configDraft.overlayPresetId,
            episodeOverlayPresetId: configDraft.episodeOverlayPresetId,
            recentlyAddedPresetId: configDraft.recentlyAddedPresetId,
        });
        if (saved?.config) {
            setConfigDraft((prev) => ({ ...prev, ...saved.config, placement: saved.config.placement || placementDraft }));
        }
        try {
            await regenerateSamples({ quiet: true });
        } catch {
            /* sample refresh best-effort */
        }
    });

    const resetPlacementKind = (kind: 'show' | 'season' | 'episode' | 'recently' | 'media' | 'status' | 'ratings' | 'network' | 'custom_collection') => {
        setConfigDraft((prev) => {
            const nextPlacement = {
                ...DEFAULT_OVERLAY_PLACEMENT,
                ...(prev.placement || {}),
                show: { ...DEFAULT_OVERLAY_PLACEMENT.show, ...(prev.placement?.show || {}) },
                season: { ...DEFAULT_OVERLAY_PLACEMENT.season, ...(prev.placement?.season || {}) },
                episode: { ...DEFAULT_OVERLAY_PLACEMENT.episode, ...(prev.placement?.episode || {}) },
                recently: { ...DEFAULT_OVERLAY_PLACEMENT.recently!, ...(prev.placement?.recently || {}) },
                media: { ...DEFAULT_OVERLAY_PLACEMENT.media!, ...(prev.placement?.media || {}) },
                status: { ...DEFAULT_OVERLAY_PLACEMENT.status!, ...(prev.placement?.status || {}) },
                ratings: { ...DEFAULT_OVERLAY_PLACEMENT.ratings!, ...(prev.placement?.ratings || {}) },
                network: { ...DEFAULT_OVERLAY_PLACEMENT.network!, ...(prev.placement?.network || {}) },
                custom_collection: {
                    ...DEFAULT_OVERLAY_PLACEMENT.custom_collection!,
                    ...(prev.placement?.custom_collection || {}),
                },
                [kind]: { ...DEFAULT_OVERLAY_PLACEMENT[kind]! },
            };
            return { ...prev, placement: nextPlacement };
        });
    };

    const applySampleResult = (payload: {
        show?: { title?: string; ratingKey?: string; source?: string };
        episode?: { title?: string; showTitle?: string; source?: string };
        generatedAt?: string;
        presetId?: string;
        meta?: Record<string, unknown>;
    }) => {
        const meta = payload.meta || {};
        setSampleMeta({
            exists: true,
            showTitle: payload.show?.title || (meta.showTitle as string) || null,
            episodeTitle: payload.episode?.title || (meta.episodeTitle as string) || null,
            showTitleForEp: payload.episode?.showTitle || (meta.showTitleForEp as string) || null,
            generatedAt: payload.generatedAt || (meta.generatedAt as string) || null,
            presetId: payload.presetId || (meta.presetId as string) || null,
            showRatingKey: payload.show?.ratingKey || (meta.showRatingKey as string) || null,
            showSource: payload.show?.source || (meta.showSource as string) || null,
            episodeSource: payload.episode?.source || (meta.episodeSource as string) || null,
        });
        setSampleBust(Date.now());
        setSampleError(null);
    };

    const regenerateSamples = async ({
        quiet = false,
        showRatingKey,
    }: { quiet?: boolean; showRatingKey?: string } = {}) => {
        setBusy('sample');
        setSampleError(null);
        try {
            const key = showRatingKey !== undefined ? showRatingKey : sampleShowKey;
            const result = await overlaysApi.sampleGenerate(
                key ? { showRatingKey: key } : undefined,
            );
            applySampleResult(result);
            if (!quiet) toast(t('overlays.actionComplete', { action: actionLabel('sample') }));
        } catch (error) {
            const message = error instanceof Error ? error.message : t('overlays.actionFailed', { action: actionLabel('sample') });
            setSampleError(message);
            if (!quiet) toast(message, 'error');
        } finally {
            setBusy(null);
        }
    };

    const loadGallery = useCallback(async (opts: { bust?: boolean } = {}) => {
        setGalleryLoading(true);
        try {
            const res = await overlaysApi.previewGallery();
            setGallery(res.items || []);
            if (opts.bust) setGalleryBust((n) => n + 1);
        } finally {
            setGalleryLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tab !== 'gallery') return;
        void loadGallery().catch(() => setGallery([]));
    }, [tab, loadGallery]);

    useEffect(() => {
        if (tab !== 'advanced') return;
        const q = sampleQuery.trim();
        const timer = window.setTimeout(() => {
            void overlaysApi.sampleCandidates(q).then((res) => {
                const items = Array.isArray(res.items) && res.items.length
                    ? res.items
                    : (res.shows || []);
                setSampleCandidates(items.filter((s) => !s.type || s.type === 'show'));
            }).catch(() => setSampleCandidates([]));
        }, 250);
        return () => window.clearTimeout(timer);
    }, [tab, sampleQuery]);

    useEffect(() => {
        if (tab !== 'advanced' && tab !== 'placement') return;
        if (sampleLoadedRef.current) return;
        sampleLoadedRef.current = true;
        let cancelled = false;
        void (async () => {
            try {
                const meta = await overlaysApi.sampleMeta();
                if (cancelled) return;
                if (meta.exists) {
                    setSampleMeta({
                        exists: true,
                        showTitle: meta.showTitle,
                        episodeTitle: meta.episodeTitle,
                        showTitleForEp: meta.showTitleForEp,
                        generatedAt: meta.generatedAt,
                        presetId: meta.presetId,
                        showRatingKey: meta.showRatingKey,
                        showSource: meta.showSource,
                        episodeSource: meta.episodeSource,
                    });
                    if (meta.showRatingKey) setSampleShowKey(String(meta.showRatingKey));
                    setSampleBust(Date.now());
                    return;
                }
                await regenerateSamples({ quiet: true });
            } catch {
                /* ignore — placement/settings can regenerate later */
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    useEffect(() => {
        if (tab !== 'placement') return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(`/api/overlays/sample/show-base?t=${Date.now()}`, { credentials: 'include' });
                if (cancelled) return;
                if (!res.ok) await regenerateSamples({ quiet: true });
                else setSampleBust(Date.now());
            } catch {
                /* ignore */
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const resetBusy = busy === 'resetAll' || busy === 'resetShows' || busy === 'resetEpisodes';
    const canResetAll = trackedTotal > 0 && !jobRunning && !resetBusy;
    const canResetShows = showCount > 0 && !jobRunning && !resetBusy;
    const canResetEpisodes = episodeCount > 0 && !jobRunning && !resetBusy;
    const canRevertKometa = kometaItems.length > 0 && !jobRunning && busy !== 'revertKometa' && workerReady;
    const canRevertOtherKometa = kometaOtherCount > 0 && !jobRunning && busy !== 'revertKometa' && workerReady;
    const canRevertCollections = collectionTrackedCount > 0 && !jobRunning && busy !== 'revertKometa' && workerReady;
    const previewOnlyShows = status?.previewOnlyShows ?? shows.filter((row) => row.previewOnly).length;
    const previewOnlyEpisodes = status?.previewOnlyEpisodes ?? episodes.filter((row) => row.previewOnly).length;
    const previewOnlySeasons = status?.previewOnlySeasons ?? 0;
    const previewOnlyTotal = previewOnlyShows + previewOnlyEpisodes + previewOnlySeasons;
    const canPromote = previewOnlyTotal > 0 && !jobRunning && busy !== 'promote' && workerReady;

    const resetOverlays = (scope: 'all' | 'shows' | 'episodes') => {
        void (async () => {
            const confirmKey = scope === 'shows'
                ? 'overlays.resetShowsConfirm'
                : scope === 'episodes'
                    ? 'overlays.resetEpisodesConfirm'
                    : 'overlays.resetAllConfirm';
            const titleKey = scope === 'shows'
                ? 'overlays.resetShowsTitle'
                : scope === 'episodes'
                    ? 'overlays.resetEpisodesTitle'
                    : 'overlays.resetAllTitle';
            const actionId: ActionId = scope === 'shows'
                ? 'resetShows'
                : scope === 'episodes'
                    ? 'resetEpisodes'
                    : 'resetAll';
            const confirmLabel = scope === 'shows'
                ? t('overlays.actions.resetShows')
                : scope === 'episodes'
                    ? t('overlays.actions.resetEpisodes')
                    : t('overlays.actions.resetAllOverlays');
            const ok = await askConfirm(
                t(confirmKey, { count: showCount, episodes: episodeCount }),
                {
                    title: t(titleKey),
                    confirmLabel,
                    cancelLabel: t('common.cancel', { defaultValue: 'Cancel' }),
                    danger: true,
                },
            );
            if (!ok) return;
            await runAction(actionId, () => overlaysApi.resetAll(scope));
        })();
    };

    const revertAllKometa = () => {
        void (async () => {
            const ok = await askConfirm(
                t('overlays.kometa.revertAllConfirm', { count: kometaItems.length }),
                {
                    title: t('overlays.kometa.revertAllTitle'),
                    confirmLabel: t('overlays.actions.revertAllKometa'),
                    cancelLabel: t('common.cancel', { defaultValue: 'Cancel' }),
                    danger: true,
                },
            );
            if (!ok) return;
            await runAction('revertKometa', () => overlaysApi.revertKometa());
            await refresh();
        })();
    };

    const revertKometaRows = (
        rows: any[],
        {
            confirmKey,
            titleKey,
            confirmLabelKey,
            count,
        }: {
            confirmKey: string;
            titleKey: string;
            confirmLabelKey: string;
            count: number;
        },
    ) => {
        void (async () => {
            if (!count) return;
            const ok = await askConfirm(
                t(confirmKey, { count }),
                {
                    title: t(titleKey),
                    confirmLabel: t(confirmLabelKey),
                    cancelLabel: t('common.cancel', { defaultValue: 'Cancel' }),
                    danger: true,
                },
            );
            if (!ok) return;
            const seen = new Set<string>();
            await runAction('revertKometa', async () => {
                for (const row of rows) {
                    const key = String(row?.ratingKey || '').trim();
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    await overlaysApi.revertKometa(key);
                }
            });
            await refresh();
        })();
    };

    const revertOtherKometa = () => {
        const rows = otherKometaSections.flatMap((section) => section.rows);
        revertKometaRows(rows, {
            confirmKey: 'overlays.kometa.revertOtherConfirm',
            titleKey: 'overlays.kometa.revertOtherTitle',
            confirmLabelKey: 'overlays.actions.revertAllKometa',
            count: kometaOtherCount,
        });
    };

    const revertAllCollections = () => {
        void (async () => {
            if (!collectionTrackedCount) return;
            const ok = await askConfirm(
                t('overlays.kometa.revertCollectionsConfirm', { count: collectionTrackedCount }),
                {
                    title: t('overlays.kometa.revertCollectionsTitle'),
                    confirmLabel: t('overlays.actions.revertAllCollections'),
                    cancelLabel: t('common.cancel', { defaultValue: 'Cancel' }),
                    danger: true,
                },
            );
            if (!ok) return;
            await runAction('revertKometa', () => overlaysApi.dropKometaFamily({ family: 'custom_collection' }));
            await refresh();
        })();
    };

    const revertKometaSection = (section: { id: string; title: string; rows: any[]; kind?: string; ruleId?: string }) => {
        void (async () => {
            const count = section.rows.length;
            if (!count) return;
            const title = section.id === 'other-kometa'
                ? t('overlays.kometa.otherSection', { count })
                : section.title;
            const ok = await askConfirm(
                t('overlays.kometa.revertSectionConfirm', { count, title }),
                {
                    title: t('overlays.kometa.revertSectionTitle'),
                    confirmLabel: t('overlays.kometa.revertSection'),
                    cancelLabel: t('common.cancel', { defaultValue: 'Cancel' }),
                    danger: true,
                },
            );
            if (!ok) return;
            await runAction('revertKometa', async () => {
                if (section.kind === 'collection') {
                    await overlaysApi.dropKometaFamily({
                        family: 'custom_collection',
                        ...(section.ruleId ? { ruleId: section.ruleId } : {}),
                    });
                    return;
                }
                for (const row of section.rows) {
                    await overlaysApi.revertKometa(row.ratingKey);
                }
            });
            await refresh();
        })();
    };

    const revertCollectionRow = (row: any, ruleId?: string) => {
        void runAction('revertKometa', async () => {
            const key = String(row?.ratingKey || '').trim();
            if (!key) return;
            await overlaysApi.dropKometaFamily({
                family: 'custom_collection',
                ...(ruleId ? { ruleId } : {}),
                ratingKeys: [key],
            });
            await refresh();
        });
    };

    const sectionHeading = (section: { id: string; title: string; library: string; rows: any[] }) => {
        if (section.id === 'other-kometa') {
            return t('overlays.kometa.otherSection', { count: section.rows.length });
        }
        if (section.library) {
            return t('overlays.kometa.collectionSection', {
                title: section.title,
                library: section.library,
                count: section.rows.length,
            });
        }
        return t('overlays.kometa.collectionSectionNoLibrary', {
            title: section.title,
            count: section.rows.length,
        });
    };

    const promotePreview = () => {
        void (async () => {
            const ok = await askConfirm(
                t('overlays.promoteConfirm', {
                    shows: previewOnlyShows,
                    episodes: previewOnlyEpisodes + previewOnlySeasons,
                }),
                {
                    title: t('overlays.promoteTitle'),
                    confirmLabel: t('overlays.actions.promote'),
                    cancelLabel: t('common.cancel', { defaultValue: 'Cancel' }),
                },
            );
            if (!ok) return;
            startBackgroundJob('promote', () => overlaysApi.promote());
        })();
    };

    const badgeStepValid = {
        1: selectedLibraries.length > 0,
        2: selectedCollectionKeys.length > 0,
        3: Boolean(editingRuleId || newCollectionRuleFile),
        4: true,
    } as const;

    const collectionRuleForm = (
        <div className="space-y-4 rounded-xl border border-plex/20 bg-plex/5 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <p className="text-sm font-bold text-text">
                        {editingRuleId
                            ? t('overlays.jobs.collections.editTitle')
                            : t('overlays.jobs.collections.addTitle')}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                        {editingRuleId
                            ? t('overlays.jobs.collections.editSubtitle')
                            : t('overlays.jobs.collections.addSubtitle')}
                    </p>
                </div>
                {editingRuleId ? (
                    <button
                        type="button"
                        className="text-[11px] font-semibold text-muted hover:text-text hover:underline"
                        onClick={() => resetNewCollectionForm()}
                    >
                        {t('overlays.jobs.collections.cancelEdit')}
                    </button>
                ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
                {[
                    { step: 1, label: t('overlays.jobs.collections.stepLibrary') },
                    { step: 2, label: t('overlays.jobs.collections.stepCollection') },
                    { step: 3, label: t('overlays.jobs.collections.stepBadge') },
                    { step: 4, label: t('overlays.jobs.collections.stepName') },
                ].map(({ step, label }) => {
                    const active = badgeWizardStep === step;
                    const done = badgeWizardStep > step;
                    return (
                        <button
                            key={step}
                            type="button"
                            disabled={step > badgeWizardStep && !badgeStepValid[step as 1 | 2 | 3 | 4]}
                            onClick={() => {
                                if (step <= badgeWizardStep || (step === badgeWizardStep + 1 && badgeStepValid[badgeWizardStep as 1 | 2 | 3 | 4])) {
                                    setBadgeWizardStep(step);
                                }
                            }}
                            className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                                active
                                    ? 'border-plex/50 bg-plex/15 text-text'
                                    : done
                                        ? 'border-white/15 bg-white/5 text-text/90'
                                        : 'border-white/10 text-muted'
                            }`}
                        >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                                active || done ? 'bg-plex/25 text-plex' : 'bg-white/5 text-muted'
                            }`}
                            >
                                {step}
                            </span>
                            <span className="hidden sm:inline">{label}</span>
                        </button>
                    );
                })}
            </div>

            {badgeWizardStep === 1 ? (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={fieldLabelClass}>{t('overlays.jobs.collections.stepLibrary')}</span>
                        <button
                            type="button"
                            className="ml-auto text-[11px] font-semibold text-plex hover:underline disabled:opacity-50"
                            disabled={collectionPickerLoading}
                            onClick={() => void loadCollectionPicker()}
                        >
                            {collectionPickerLoading
                                ? t('overlays.jobs.collections.loadingCollections')
                                : t('overlays.jobs.collections.refreshList')}
                        </button>
                    </div>
                    <p className="text-[10px] text-muted">{t('overlays.jobs.collections.multiLibraryHint')}</p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className="text-[11px] font-semibold text-plex hover:underline disabled:opacity-50"
                            disabled={!libraryPickerOptions.length}
                            onClick={selectAllLibraries}
                        >
                            {t('overlays.jobs.collections.selectAllLibraries')}
                        </button>
                        {selectedLibraries.length ? (
                            <button
                                type="button"
                                className="text-[11px] font-semibold text-muted hover:text-text hover:underline"
                                onClick={clearLibraries}
                            >
                                {t('overlays.jobs.collections.clearLibraries')}
                            </button>
                        ) : null}
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-background/40 custom-scrollbar">
                        {!libraryPickerOptions.length ? (
                            <p className="px-3 py-4 text-center text-[11px] text-muted">
                                {collectionPickerLoading
                                    ? t('overlays.jobs.collections.loadingCollections')
                                    : t('overlays.jobs.collections.pickLibrary')}
                            </p>
                        ) : (
                            libraryPickerOptions.map((o) => {
                                const active = selectedLibraries.includes(o.value);
                                return (
                                    <button
                                        key={o.value}
                                        type="button"
                                        onClick={() => toggleLibrary(o.value)}
                                        className={`flex w-full items-start gap-2 border-b border-border/40 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                                            active
                                                ? 'bg-plex/15 text-text'
                                                : 'text-text/90 hover:bg-white/5'
                                        }`}
                                    >
                                        <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                            active ? 'border-plex bg-plex text-[9px] text-black' : 'border-muted'
                                        }`}
                                        >
                                            {active ? '✓' : ''}
                                        </span>
                                        <span className="min-w-0 truncate text-sm font-semibold">{o.label}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                    {selectedLibraries.length ? (
                        <p className="text-[11px] text-plex">
                            {t('overlays.jobs.collections.selectedLibraries', {
                                count: selectedLibraries.length,
                                titles: selectedLibraries.join(', '),
                            })}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {badgeWizardStep === 2 ? (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={fieldLabelClass}>{t('overlays.jobs.collections.stepCollection')}</span>
                        {!collectionPickerLoading ? (
                            <span className="ml-auto text-[10px] text-muted">
                                {t('overlays.jobs.collections.collectionCount', {
                                    count: filteredCollectionOptions.length,
                                    total: collectionsInSelectedLibrariesCount,
                                })}
                            </span>
                        ) : null}
                    </div>
                    <p className="text-[10px] text-muted">{t('overlays.jobs.collections.multiSelectHint')}</p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className="text-[11px] font-semibold text-plex hover:underline disabled:opacity-50"
                            disabled={!filteredCollectionOptions.length}
                            onClick={selectAllFilteredCollections}
                        >
                            {t('overlays.jobs.collections.selectAllCollections')}
                        </button>
                        {selectedCollectionKeys.length ? (
                            <button
                                type="button"
                                className="text-[11px] font-semibold text-muted hover:text-text hover:underline"
                                onClick={clearSelectedCollections}
                            >
                                {t('overlays.jobs.collections.clearCollections')}
                            </button>
                        ) : null}
                    </div>
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                        <input
                            className={`${fieldInputClass} pl-8`}
                            value={newCollectionSearch}
                            onChange={(e) => setNewCollectionSearch(e.target.value)}
                            placeholder={t('overlays.jobs.collections.searchPlaceholder')}
                        />
                    </div>
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-border/60 bg-background/40 custom-scrollbar">
                        {collectionPickerLoading ? (
                            <p className="px-3 py-4 text-center text-[11px] text-muted">
                                {t('overlays.jobs.collections.loadingCollections')}
                            </p>
                        ) : filteredCollectionOptions.length === 0 ? (
                            <p className="px-3 py-4 text-center text-[11px] text-muted">
                                {newCollectionSearch.trim()
                                    ? t('overlays.jobs.collections.searchEmpty')
                                    : t('overlays.jobs.collections.noCollections')}
                            </p>
                        ) : (
                            filteredCollectionOptions.map((o) => {
                                const active = selectedCollectionKeys.includes(o.value);
                                return (
                                    <button
                                        key={o.value}
                                        type="button"
                                        onClick={() => toggleCollectionKey(o)}
                                        className={`flex w-full items-start gap-2 border-b border-border/40 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                                            active
                                                ? 'bg-plex/15 text-text'
                                                : 'text-text/90 hover:bg-white/5'
                                        }`}
                                    >
                                        <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                            active ? 'border-plex bg-plex text-[9px] text-black' : 'border-muted'
                                        }`}
                                        >
                                            {active ? '✓' : ''}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold">
                                                {o.title || o.label}
                                            </span>
                                            {o.library ? (
                                                <span className="block truncate text-[10px] text-muted">
                                                    {o.library}
                                                </span>
                                            ) : null}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                    {collectionPickerError ? (
                        <p className="text-[11px] text-red-300">{collectionPickerError}</p>
                    ) : null}
                    {selectedCollectionOptions.length ? (
                        <p className="text-[11px] text-plex">
                            {t('overlays.jobs.collections.selectedCollections', {
                                count: selectedCollectionOptions.length,
                                titles: selectedCollectionOptions
                                    .map((o) => o.title || o.label)
                                    .join(', '),
                            })}
                        </p>
                    ) : null}
                    {missingSelectedCollectionKeys.length ? (
                        <p className="text-[11px] text-red-300">
                            {t('overlays.jobs.collections.missingCollectionsPruned', {
                                count: missingSelectedCollectionKeys.length,
                            })}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {badgeWizardStep === 3 ? (
                <div className="space-y-2">
                    <span className={fieldLabelClass}>{t('overlays.jobs.collections.stepBadge')}</span>
                    {editingRuleId && editingRuleImageId && !newCollectionRuleFile ? (
                        <div className="flex flex-wrap items-center gap-3">
                            <img
                                src={`/api/overlays/preset-file?id=${encodeURIComponent(editingRuleImageId)}&kind=season&t=${sampleBust}`}
                                alt=""
                                className="h-14 max-w-[180px] object-contain"
                            />
                            <p className="text-[11px] text-muted">
                                {t('overlays.jobs.collections.keepExistingBadge', { id: editingRuleImageId })}
                            </p>
                        </div>
                    ) : null}
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-4 transition-colors hover:border-plex/40 hover:bg-plex/5">
                        {collectionBadgePreviewSrc ? (
                            <img
                                src={collectionBadgePreviewSrc}
                                alt=""
                                className="h-14 max-w-[180px] object-contain"
                            />
                        ) : (
                            <Upload className="h-5 w-5 text-muted" />
                        )}
                        <span className="text-xs font-semibold text-text">
                            {newCollectionRuleFile
                                ? newCollectionRuleFile.name
                                : editingRuleId
                                    ? t('overlays.jobs.collections.replacePng')
                                    : t('overlays.jobs.collections.choosePng')}
                        </span>
                        <span className="text-[10px] text-muted">{t('overlays.jobs.collections.pngOnly')}</span>
                        <input
                            type="file"
                            accept="image/png,.png"
                            className="hidden"
                            onChange={(e) => setNewCollectionRuleFile(e.target.files?.[0] || null)}
                        />
                    </label>
                </div>
            ) : null}

            {badgeWizardStep === 4 ? (
                <div className="space-y-2">
                    <span className={fieldLabelClass}>{t('overlays.jobs.collections.stepName')}</span>
                    <input
                        className={fieldInputClass}
                        value={newCollectionRuleName}
                        onChange={(e) => setNewCollectionRuleName(e.target.value)}
                        placeholder={t('overlays.jobs.collections.namePlaceholder')}
                    />
                    <p className="text-[10px] text-muted">{t('overlays.jobs.collections.nameHint')}</p>
                    <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={
                            busy !== null
                            || !selectedLibraries.length
                            || !selectedCollectionKeys.length
                            || (!editingRuleId && !newCollectionRuleFile)
                        }
                        onClick={() => void saveCollectionOverlayRule()}
                    >
                        <Upload className="h-4 w-4" />
                        {editingRuleId
                            ? t('overlays.jobs.collections.saveRule')
                            : t('overlays.jobs.collections.addRule')}
                    </button>
                    <p className="text-[11px] text-muted">{t('overlays.jobs.collections.saveHint')}</p>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3">
                <button
                    type="button"
                    className={buttonClass}
                    disabled={badgeWizardStep <= 1}
                    onClick={() => setBadgeWizardStep((s) => Math.max(1, s - 1))}
                >
                    {t('overlays.badges.wizardBack')}
                </button>
                {badgeWizardStep < 4 ? (
                    <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={!badgeStepValid[badgeWizardStep as 1 | 2 | 3]}
                        onClick={() => {
                            if (badgeWizardStep === 1) void loadCollectionPicker();
                            setBadgeWizardStep((s) => Math.min(4, s + 1));
                        }}
                    >
                        {t('overlays.badges.wizardNext')}
                    </button>
                ) : null}
            </div>
        </div>
    );

    return (
        <DashboardPageShell>
            <ToastContainer toasts={toasts} setToasts={setToasts} />

            <DashboardHero
                accent="plex"
                eyebrow={t('overlays.eyebrow')}
                title={t('overlays.title')}
                description={t('overlays.description')}
                icon={<Layers className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={busy !== null}
                            onClick={() => void runAction('refresh', () => refresh({ syncConfig: true }), { skipRefresh: true })}
                        >
                            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> {t('overlays.actions.refresh')}
                        </button>
                        {jobRunning || (Number(status?.queueLength || 0) > 0) ? (
                            <>
                                {jobRunning ? (
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy === 'stop'}
                                        onClick={() => void runAction('stop', () => overlaysApi.stop())}
                                    >
                                        <Square className="h-4 w-4" /> {t('overlays.activity.stopCurrent')}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy === 'stop'}
                                    onClick={() => void runAction('stop', () => overlaysApi.stopAndClearQueue())}
                                >
                                    <Square className="h-4 w-4" /> {t('overlays.activity.stopAll')}
                                </button>
                            </>
                        ) : null}
                        {canPromote ? (
                            <button
                                type="button"
                                className={`${buttonClass} border-emerald-500/40 text-emerald-100`}
                                onClick={promotePreview}
                            >
                                <CheckCircle2 className="h-4 w-4" />
                                {t('overlays.actions.promote')}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className={`${buttonClass} border-amber-500/40 text-amber-100`}
                            disabled={!canResetAll}
                            onClick={() => resetOverlays('all')}
                        >
                            <RotateCcw className="h-4 w-4" /> {t('overlays.actions.resetAllOverlays')}
                        </button>
                    </>
                )}
            />

            <div className="grid gap-3 sm:grid-cols-3">
                <DashboardStatCard
                    label={t('overlays.status.worker')}
                    value={jobRunning
                        ? t('overlays.status.runningNow')
                        : workerReady
                            ? t('overlays.status.ready')
                            : t('overlays.status.missing')}
                    hint={jobRunning
                        ? t('overlays.activity.running', { command: runningCommandLabel })
                        : Number(status?.queueLength || 0) > 0
                            ? t('overlays.activity.queueTitle', { count: status.queueLength })
                            : workerReady
                                ? t('overlays.status.workerHintReady')
                                : t('overlays.status.workerHintMissing')}
                    icon={workerReady
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                        : <XCircle className="h-4 w-4 text-rose-300" />}
                    glow={workerReady ? 'bg-emerald-400/25' : 'bg-rose-400/25'}
                    valueClassName="text-xl md:text-2xl"
                />
                <DashboardStatCard
                    label={t('overlays.status.tracked')}
                    value={t('overlays.status.trackedValue', {
                        shows: status?.logCount ?? showCount,
                        episodes: status?.episodeLogCount ?? episodeCount,
                        layer: kometaOtherCount,
                        badges: collectionTrackedCount,
                    })}
                    hint={t('overlays.status.trackedHint')}
                    icon={<Layers className="h-4 w-4 text-sky-300" />}
                    glow="bg-sky-400/20"
                    valueClassName="text-lg md:text-xl"
                />
                <DashboardStatCard
                    label={t('overlays.status.lastRun')}
                    value={summaryWhen
                        ? new Date(summaryWhen).toLocaleString()
                        : t('overlays.overview.never')}
                    hint={summaryDetail
                        || (configDraft.scheduleHours
                            ? t('overlays.status.everyHours', { hours: configDraft.scheduleHours })
                            : t('overlays.status.disabled'))}
                    icon={<Clock3 className="h-4 w-4 text-plex" />}
                    glow="bg-plex/25"
                    valueClassName="text-lg md:text-xl"
                />
            </div>

            <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                <p className={`${fieldLabelClass} mb-2`}>{t('overlays.overview.atAGlance')}</p>
                <div className="flex flex-wrap gap-1.5">
                    {categorySummary.map((cat) => (
                        <button
                            key={cat.id}
                            type="button"
                            onClick={() => openCategory(cat)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                cat.enabled
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20'
                                    : 'border-white/10 bg-white/5 text-muted hover:bg-white/10'
                            }`}
                        >
                            <span className={`h-1.5 w-1.5 rounded-full ${cat.enabled ? 'bg-emerald-400' : 'bg-white/25'}`} />
                            {cat.label}
                        </button>
                    ))}
                </div>
            </div>

            {!workerReady && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <p className="font-semibold">{t('overlays.workerMissingTitle')}</p>
                        <p className="text-sm text-amber-100/80">
                            {t('overlays.workerMissingBeforeCli')} <code>overlays/cli.py</code> {t('overlays.workerMissingAfterCli')}{' '}
                            <code>pip install -r overlays/requirements.txt</code> {t('overlays.workerMissingAfterCommand')}
                        </p>
                    </div>
                </div>
            )}

            <div className="md:hidden">
                <span className={fieldLabelClass}>{t('overlays.tabs.select')}</span>
                <CustomSelect
                    className="mt-1.5"
                    value={tab}
                    onChange={(id) => setTab(id as TabId)}
                    options={tabs.map(({ id, label }) => ({ value: id, label }))}
                />
            </div>

            <DashboardSubnav className="!hidden md:!flex">
                {tabs.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(tab === id)}`}
                        onClick={() => setTab(id)}
                    >
                        <Icon className="h-4 w-4" />
                        {label}
                    </button>
                ))}
            </DashboardSubnav>

            {tab === 'home' && (
                <div className="space-y-3">
                    <section className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                        <div className="p-4 space-y-1">
                            <h3 className="text-base font-semibold text-text">{t('overlays.jobs.testTitle.heading')}</h3>
                            <p className="text-sm text-muted">{t('overlays.jobs.testTitle.description')}</p>
                        </div>
                        <OverlayJobTitleTest
                            searchLabel={t('overlays.jobs.testTitle.label')}
                            searchPlaceholder={t('overlays.jobs.testTitle.searchPlaceholder')}
                            pickLabel={t('overlays.jobs.testTitle.pick')}
                            stampLabel={t('overlays.jobs.testTitle.stampAll')}
                            hint={testTitleHint}
                            emptyPick={t('overlays.jobs.testTitle.empty')}
                            noResultsLabel={t('overlays.jobs.testTitle.noResults')}
                            searchingLabel={t('overlays.jobs.testTitle.searching')}
                            titleFilter="all"
                            disabled={jobTitleTestDisabled || activeTestTitleJobLabels.length === 0}
                            busy={testTitleBusy}
                            onStamp={stampAllActiveForTitle}
                        />
                    </section>

                    <div className="space-y-2">
                        <OverlayJobCard
                            id="overlay-job-banners"
                            title={t('overlays.jobs.banners.title')}
                            hint={t('overlays.jobs.banners.hint')}
                            statusLabel={coreJobActive
                                ? t('overlays.jobs.status.running')
                                : !bannersEnabled
                                    ? t('overlays.jobs.status.off')
                                    : status?.lastRunAt || configDraft.lastRunAt
                                        ? t('overlays.jobs.status.lastRun', {
                                            when: new Date(String(status?.lastRunAt || configDraft.lastRunAt)).toLocaleString(),
                                        })
                                        : t('overlays.jobs.status.idle')}
                            statusTone={coreJobActive ? 'running' : !bannersEnabled ? 'off' : 'idle'}
                            enabledSummary={[t('overlays.jobs.banners.enabledSummary', {
                                season: configDraft.newSeasonEnabled !== false ? t('overlays.jobs.on') : t('overlays.jobs.off'),
                                episode: configDraft.newEpisodeEnabled !== false ? t('overlays.jobs.on') : t('overlays.jobs.off'),
                                live: configDraft.liveScheduleEnabled === true ? t('overlays.jobs.on') : t('overlays.jobs.off'),
                                top10: configDraft.top10Enabled === true ? t('overlays.jobs.on') : t('overlays.jobs.off'),
                            }), coreRunHint].filter(Boolean).join(' · ')}
                            previewLabel={t('overlays.actions.preview')}
                            runLabel={t('overlays.actions.runNow')}
                            expandLabel={t('overlays.jobs.expand')}
                            collapseLabel={t('overlays.jobs.collapse')}
                            expanded={jobCardExpanded.banners}
                            onToggleExpand={() => toggleJobCard('banners')}
                            onPreview={() => startBackgroundJob('preview', () => overlaysApi.preview({ bundle: 'core' }))}
                            onRun={() => startBackgroundJob('run', () => overlaysApi.run({ preview: false, bundle: 'core' }))}
                            previewBusy={busy === 'preview' || (coreJobActive && runningCommand === 'preview')}
                            runBusy={busy === 'run' || (coreJobActive && runningCommand === 'run')}
                            actionsDisabled={busy !== null || jobRunning || !workerReady}
                        >
                            <div id="overlay-banners-newSeason" className="mb-3 scroll-mt-4 border-b border-border/40 pb-2">
                                <span className={fieldLabelClass}>{t('overlays.jobs.banners.groups.newSeason')}</span>
                            </div>
                            {renderPlacementLink('show')}
                            <SettingsToggleRow
                                title={t('overlays.settings.newSeasonEnabled')}
                                description={t('overlays.settings.newSeasonEnabledHint')}
                                checked={configDraft.newSeasonEnabled !== false}
                                onChange={(newSeasonEnabled) => setConfigDraft((prev) => ({ ...prev, newSeasonEnabled }))}
                            />
                            <SettingsToggleRow
                                title={t('overlays.settings.newSeasonWatchNowStyle')}
                                description={t('overlays.settings.newSeasonWatchNowStyleHint')}
                                checked={configDraft.newSeasonWatchNowStyle === true}
                                onChange={(newSeasonWatchNowStyle) => setConfigDraft((prev) => ({ ...prev, newSeasonWatchNowStyle }))}
                            />
                            <SettingsToggleRow
                                title={t('overlays.settings.newSeasonStampSeasonPoster')}
                                description={t('overlays.settings.newSeasonStampSeasonPosterHint')}
                                checked={configDraft.newSeasonStampSeasonPoster !== false}
                                onChange={(newSeasonStampSeasonPoster) => setConfigDraft((prev) => ({ ...prev, newSeasonStampSeasonPoster }))}
                            />
                            <div id="overlay-banners-newEpisode" className="mb-3 mt-4 scroll-mt-4 border-b border-border/40 pb-2">
                                <span className={fieldLabelClass}>{t('overlays.jobs.banners.groups.newEpisode')}</span>
                            </div>
                            {renderPlacementLink('episode')}
                            <SettingsToggleRow
                                title={t('overlays.settings.newEpisodeEnabled')}
                                description={t('overlays.settings.newEpisodeEnabledHint')}
                                checked={configDraft.newEpisodeEnabled !== false}
                                onChange={(newEpisodeEnabled) => setConfigDraft((prev) => ({ ...prev, newEpisodeEnabled }))}
                            />
                            <SettingsToggleRow
                                title={t('overlays.settings.newEpisodeWatchNowStyle')}
                                description={t('overlays.settings.newEpisodeWatchNowStyleHint')}
                                checked={configDraft.newEpisodeWatchNowStyle === true}
                                onChange={(newEpisodeWatchNowStyle) => setConfigDraft((prev) => ({ ...prev, newEpisodeWatchNowStyle }))}
                            />
                            <SettingsToggleRow
                                title={t('overlays.settings.skipNewEpisodeOnBinge')}
                                description={t('overlays.settings.skipNewEpisodeOnBingeHint')}
                                checked={configDraft.skipNewEpisodeOnBinge !== false}
                                onChange={(skipNewEpisodeOnBinge) => setConfigDraft((prev) => ({ ...prev, skipNewEpisodeOnBinge }))}
                            />
                            <div id="overlay-banners-liveTop10" className="mb-3 mt-4 scroll-mt-4 border-b border-border/40 pb-2">
                                <span className={fieldLabelClass}>{t('overlays.jobs.banners.groups.liveTop10')}</span>
                            </div>
                            {renderFixedPositionNote('overlays.placement.fixedNoteLiveTop10')}
                            <SettingsToggleRow
                                title={t('overlays.settings.liveScheduleEnabled')}
                                description={t('overlays.settings.liveScheduleEnabledHint')}
                                checked={configDraft.liveScheduleEnabled === true}
                                onChange={(liveScheduleEnabled) => setConfigDraft((prev) => ({ ...prev, liveScheduleEnabled }))}
                            />
                            <SettingsToggleRow
                                title={t('overlays.settings.top10Enabled')}
                                description={t('overlays.settings.top10EnabledHint')}
                                checked={configDraft.top10Enabled === true}
                                onChange={(top10Enabled) => setConfigDraft((prev) => ({ ...prev, top10Enabled }))}
                            />
                            <SettingsToggleRow
                                title={t('overlays.settings.tmdbAirDateFallback')}
                                description={t('overlays.settings.tmdbAirDateFallbackHint')}
                                checked={configDraft.tmdbAirDateFallback !== false}
                                onChange={(tmdbAirDateFallback) => setConfigDraft((prev) => ({ ...prev, tmdbAirDateFallback }))}
                            />
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="block">
                                    <span className={fieldLabelClass}>{t('overlays.fields.newSeasonWindowDays')}</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={365}
                                        className={fieldInputClass}
                                        value={configDraft.newSeasonDays ?? 7}
                                        onChange={(e) => setConfigDraft((prev) => ({
                                            ...prev,
                                            newSeasonDays: Math.max(1, Math.min(365, Number(e.target.value) || 7)),
                                        }))}
                                    />
                                    <span className="mt-1 block text-[11px] text-muted">{t('overlays.settings.windowHint')}</span>
                                </label>
                                <label className="block">
                                    <span className={fieldLabelClass}>{t('overlays.fields.newEpisodeWindowDays')}</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={30}
                                        className={fieldInputClass}
                                        value={configDraft.newEpisodeDays ?? 6}
                                        onChange={(e) => setConfigDraft((prev) => ({
                                            ...prev,
                                            newEpisodeDays: Math.max(1, Math.min(30, Number(e.target.value) || 6)),
                                        }))}
                                    />
                                    <span className="mt-1 block text-[11px] text-muted">{t('overlays.settings.newEpisodeWindowHint')}</span>
                                </label>
                                <label className="block">
                                    <span className={fieldLabelClass}>{t('overlays.fields.liveScheduleDays')}</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={14}
                                        className={fieldInputClass}
                                        value={configDraft.liveScheduleDays ?? 1}
                                        onChange={(e) => setConfigDraft((prev) => ({
                                            ...prev,
                                            liveScheduleDays: Math.max(0, Math.min(14, Number(e.target.value) || 0)),
                                        }))}
                                    />
                                    <span className="mt-1 block text-[11px] text-muted">{t('overlays.settings.liveScheduleDaysHint')}</span>
                                </label>
                                <label className="block">
                                    <span className={fieldLabelClass}>{t('overlays.fields.top10Count')}</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={50}
                                        className={fieldInputClass}
                                        value={configDraft.top10Count ?? 10}
                                        onChange={(e) => setConfigDraft((prev) => ({
                                            ...prev,
                                            top10Count: Math.max(1, Math.min(50, Number(e.target.value) || 10)),
                                        }))}
                                    />
                                </label>
                                <label className="block">
                                    <span className={fieldLabelClass}>{t('overlays.fields.scheduleHours')}</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={168}
                                        className={fieldInputClass}
                                        value={configDraft.scheduleHours ?? 24}
                                        onChange={(e) => setConfigDraft((prev) => ({
                                            ...prev,
                                            scheduleHours: Number(e.target.value) || 0,
                                        }))}
                                    />
                                    <span className="mt-1 block text-[11px] text-muted">{t('overlays.settings.coreScheduleHint')}</span>
                                </label>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                    <span className={fieldLabelClass}>{t('overlays.settings.overlayPreset')}</span>
                                    <CustomSelect
                                        className="mt-1.5"
                                        value={configDraft.overlayPresetId || 'new-season'}
                                        onChange={(value) => setConfigDraft((prev) => ({ ...prev, overlayPresetId: value }))}
                                        options={seasonPresetOptions.length ? seasonPresetOptions : [{ value: 'new-season', label: 'new-season' }]}
                                    />
                                    <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-plex">
                                        <input
                                            type="file"
                                            accept="image/png"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                e.target.value = '';
                                                if (!file) return;
                                                void runAction('saveSettings', async () => {
                                                    const up = await overlaysApi.uploadPreset('season', file);
                                                    const id = up?.preset?.id;
                                                    if (id) setConfigDraft((prev) => ({ ...prev, overlayPresetId: id }));
                                                    await refresh();
                                                });
                                            }}
                                        />
                                        {t('overlays.settings.uploadSeasonPreset')}
                                    </label>
                                </div>
                                <div>
                                    <span className={fieldLabelClass}>{t('overlays.settings.episodeOverlayPreset')}</span>
                                    <CustomSelect
                                        className="mt-1.5"
                                        value={configDraft.episodeOverlayPresetId || 'new-episode'}
                                        onChange={(value) => setConfigDraft((prev) => ({ ...prev, episodeOverlayPresetId: value }))}
                                        options={episodePresetOptions.length ? episodePresetOptions : [{ value: 'new-episode', label: 'new-episode' }]}
                                    />
                                    <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-plex">
                                        <input
                                            type="file"
                                            accept="image/png"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                e.target.value = '';
                                                if (!file) return;
                                                void runAction('saveSettings', async () => {
                                                    const up = await overlaysApi.uploadPreset('episode', file);
                                                    const id = up?.preset?.id;
                                                    if (id) setConfigDraft((prev) => ({ ...prev, episodeOverlayPresetId: id }));
                                                    await refresh();
                                                });
                                            }}
                                        />
                                        {t('overlays.settings.uploadEpisodePreset')}
                                    </label>
                                </div>
                            </div>
                            {renderLibraryPicker('coreLibrarySectionIds', 'overlays.settings.librariesHintCore', 'show')}
                            <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={() => void saveSettings()}>
                                <Save className="h-4 w-4" /> {t('overlays.actions.save')}
                            </button>
                        </OverlayJobCard>

                        <OverlayJobCard
                            id="overlay-job-recently"
                            title={t('overlays.jobs.recently.title')}
                            hint={t('overlays.jobs.recently.hint')}
                            statusLabel={recentlyJobActive
                                ? t('overlays.jobs.status.running')
                                : configDraft.recentlyAddedEnabled !== true
                                    ? t('overlays.jobs.status.off')
                                    : status?.recentlyAddedLastRunAt || configDraft.recentlyAddedLastRunAt
                                        ? t('overlays.jobs.status.lastRun', {
                                            when: new Date(String(status?.recentlyAddedLastRunAt || configDraft.recentlyAddedLastRunAt)).toLocaleString(),
                                        })
                                        : t('overlays.jobs.status.idle')}
                            statusTone={recentlyJobActive ? 'running' : configDraft.recentlyAddedEnabled !== true ? 'off' : 'idle'}
                            enabledSummary={[configDraft.recentlyAddedEnabled === true
                                ? t('overlays.jobs.recently.enabledOn', { days: configDraft.recentlyAddedDays ?? 7 })
                                : t('overlays.jobs.recently.enabledOff'), recentlyRunHint].filter(Boolean).join(' · ')}
                            previewLabel={t('overlays.actions.previewRecently')}
                            runLabel={t('overlays.actions.runRecently')}
                            expandLabel={t('overlays.jobs.expand')}
                            collapseLabel={t('overlays.jobs.collapse')}
                            expanded={jobCardExpanded.recently}
                            onToggleExpand={() => toggleJobCard('recently')}
                            onPreview={() => startBackgroundJob('previewRecently', () => overlaysApi.preview({ bundle: 'recently' }))}
                            onRun={() => startBackgroundJob('runRecently', () => overlaysApi.run({ preview: false, bundle: 'recently' }))}
                            previewBusy={busy === 'previewRecently' || (recentlyJobActive && runningCommand === 'preview-recently')}
                            runBusy={busy === 'runRecently' || (recentlyJobActive && runningCommand === 'run-recently')}
                            actionsDisabled={busy !== null || jobRunning || !workerReady}
                        >
                            {renderPlacementLink('recently')}
                            <SettingsToggleRow
                                title={t('overlays.settings.recentlyAddedEnabled')}
                                description={t('overlays.settings.recentlyAddedEnabledHint')}
                                checked={configDraft.recentlyAddedEnabled === true}
                                onChange={(recentlyAddedEnabled) => setConfigDraft((prev) => ({ ...prev, recentlyAddedEnabled }))}
                            />
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="block">
                                    <span className={fieldLabelClass}>{t('overlays.fields.recentlyAddedDays')}</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={90}
                                        className={fieldInputClass}
                                        value={configDraft.recentlyAddedDays ?? 7}
                                        onChange={(e) => setConfigDraft((prev) => ({
                                            ...prev,
                                            recentlyAddedDays: Math.max(1, Math.min(90, Number(e.target.value) || 7)),
                                        }))}
                                    />
                                </label>
                                <label className="block">
                                    <span className={fieldLabelClass}>{t('overlays.fields.recentlyAddedScheduleHours')}</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={168}
                                        className={fieldInputClass}
                                        value={configDraft.recentlyAddedScheduleHours ?? 24}
                                        onChange={(e) => setConfigDraft((prev) => ({
                                            ...prev,
                                            recentlyAddedScheduleHours: Number(e.target.value) || 0,
                                        }))}
                                    />
                                </label>
                            </div>
                            <div>
                                <span className={fieldLabelClass}>{t('overlays.settings.recentlyAddedPreset')}</span>
                                <CustomSelect
                                    className="mt-1.5"
                                    value={configDraft.recentlyAddedPresetId || 'recently-added'}
                                    onChange={(recentlyAddedPresetId) => setConfigDraft((prev) => ({ ...prev, recentlyAddedPresetId }))}
                                    options={recentlyPresetOptions.length
                                        ? recentlyPresetOptions
                                        : [{ value: 'recently-added', label: 'recently-added' }]}
                                />
                                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-plex">
                                    <input
                                        type="file"
                                        accept="image/png"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            e.target.value = '';
                                            if (!file) return;
                                            void runAction('saveSettings', async () => {
                                                const up = await overlaysApi.uploadPreset('season', file);
                                                const id = up?.preset?.id;
                                                if (id) setConfigDraft((prev) => ({ ...prev, recentlyAddedPresetId: id }));
                                                await refresh();
                                            });
                                        }}
                                    />
                                    {t('overlays.settings.uploadSeasonPreset')}
                                </label>
                            </div>
                            {renderLibraryPicker('recentlyAddedLibrarySectionIds', 'overlays.settings.librariesHintRecently', 'show')}
                            <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={() => void saveSettings()}>
                                <Save className="h-4 w-4" /> {t('overlays.actions.save')}
                            </button>
                        </OverlayJobCard>

                        <OverlayJobCard
                            id="overlay-job-kometa"
                            title={t('overlays.jobs.kometa.title')}
                            hint={t('overlays.jobs.kometa.hint')}
                            statusLabel={kometaJobActive
                                ? t('overlays.jobs.status.running')
                                : !kometaEnabled
                                    ? t('overlays.jobs.status.off')
                                    : status?.kometaLastRunAt || configDraft.kometaLastRunAt
                                        ? t('overlays.jobs.status.lastRun', {
                                            when: new Date(String(status?.kometaLastRunAt || configDraft.kometaLastRunAt)).toLocaleString(),
                                        })
                                        : t('overlays.jobs.status.idle')}
                            statusTone={kometaJobActive ? 'running' : !kometaEnabled ? 'off' : 'idle'}
                            enabledSummary={[t('overlays.jobs.kometa.enabledSummary', {
                                media: configDraft.mediaInfoEnabled === true ? t('overlays.jobs.on') : t('overlays.jobs.off'),
                                status: configDraft.statusOverlayEnabled === true ? t('overlays.jobs.on') : t('overlays.jobs.off'),
                                ratings: configDraft.ratingsOverlayEnabled === true ? t('overlays.jobs.on') : t('overlays.jobs.off'),
                                network: configDraft.networkOverlayEnabled === true ? t('overlays.jobs.on') : t('overlays.jobs.off'),
                                extra: [
                                    configDraft.streamingOverlayEnabled && 'streaming',
                                    configDraft.ribbonOverlayEnabled && 'ribbon',
                                    configDraft.audioCodecEnabled && 'audio',
                                    configDraft.editionOverlayEnabled && 'edition',
                                ].filter(Boolean).length
                                    ? t('overlays.jobs.on')
                                    : t('overlays.jobs.off'),
                            }), kometaRunHint].filter(Boolean).join(' · ')}
                            previewLabel={t('overlays.actions.previewKometa')}
                            runLabel={t('overlays.actions.runKometa')}
                            expandLabel={t('overlays.jobs.expand')}
                            collapseLabel={t('overlays.jobs.collapse')}
                            expanded={jobCardExpanded.kometa}
                            onToggleExpand={() => toggleJobCard('kometa')}
                            onPreview={() => startBackgroundJob('previewKometa', () => overlaysApi.preview({ bundle: 'kometa', scope: 'media' }))}
                            onRun={() => startBackgroundJob('runKometa', () => overlaysApi.run({ preview: false, bundle: 'kometa', scope: 'media' }))}
                            previewBusy={busy === 'previewKometa' || (kometaJobActive && runningCommand === 'preview-kometa')}
                            runBusy={busy === 'runKometa' || (kometaJobActive && runningCommand === 'run-kometa')}
                            actionsDisabled={busy !== null || jobRunning || !workerReady}
                        >
                            <p className="mb-3 text-[11px] text-muted">{t('overlays.jobs.kometa.settingsHint')}</p>

                            <OverlaySettingsGroup
                                id="kometa.quality"
                                title={t('overlays.jobs.kometa.groups.media')}
                                description={t('overlays.jobs.kometa.groups.mediaHint')}
                                openSignal={groupOpenSignal['kometa.quality']}
                                defaultOpen
                                activeCount={[
                                    configDraft.mediaInfoEnabled,
                                    configDraft.editionOverlayEnabled,
                                    configDraft.audioCodecEnabled,
                                    configDraft.videoFormatEnabled,
                                ].filter((v) => v === true).length}
                                totalCount={4}
                            >
                            {renderPlacementLink('media')}
                            <SettingsToggleRow
                                title={t('overlays.settings.mediaInfoEnabled')}
                                description={t('overlays.settings.mediaInfoEnabledHint')}
                                checked={configDraft.mediaInfoEnabled === true}
                                onChange={(mediaInfoEnabled) => setConfigDraft((prev) => ({ ...prev, mediaInfoEnabled }))}
                            />
                            {configDraft.mediaInfoEnabled === true && (
                                <div className="mb-3 space-y-3 rounded-lg border border-border/50 bg-background/30 p-3">
                                    <span className={fieldLabelClass}>{t('overlays.settings.mediaInfoParts')}</span>
                                    <p className="text-[11px] text-muted">{t('overlays.settings.mediaInfoPartsHint')}</p>
                                    <div className="flex flex-wrap gap-3">
                                        {([
                                            ['res4k', '4K'],
                                            ['res1080p', '1080p'],
                                            ['res720p', '720p'],
                                            ['resOther', t('overlays.settings.mediaPartOther')],
                                            ['hdr', 'HDR'],
                                            ['dolbyVision', 'Dolby Vision'],
                                            ['atmos', 'Atmos'],
                                        ] as const).map(([key, label]) => {
                                            const parts = { ...DEFAULT_MEDIA_INFO_PARTS, ...(configDraft.mediaInfoParts || {}) };
                                            return (
                                                <StyledCheckbox
                                                    key={key}
                                                    checked={!!parts[key]}
                                                    label={label}
                                                    onChange={(next) => setConfigDraft((prev) => ({
                                                        ...prev,
                                                        mediaInfoParts: {
                                                            ...DEFAULT_MEDIA_INFO_PARTS,
                                                            ...(prev.mediaInfoParts || {}),
                                                            [key]: next,
                                                        },
                                                    }))}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        <StyledCheckbox
                                            checked={configDraft.mediaInfoIncludeShows !== false}
                                            label={t('overlays.settings.includeShows')}
                                            onChange={(mediaInfoIncludeShows) => setConfigDraft((prev) => ({ ...prev, mediaInfoIncludeShows }))}
                                        />
                                        <StyledCheckbox
                                            checked={configDraft.mediaInfoIncludeMovies !== false}
                                            label={t('overlays.settings.includeMovies')}
                                            onChange={(mediaInfoIncludeMovies) => setConfigDraft((prev) => ({ ...prev, mediaInfoIncludeMovies }))}
                                        />
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.allowKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.allowKeysPlaceholder')}
                                                value={keysToText(configDraft.mediaInfoAllowKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    mediaInfoAllowKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.denyKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.denyKeysPlaceholder')}
                                                value={keysToText(configDraft.mediaInfoDenyKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    mediaInfoDenyKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                    </div>
                                </div>
                            )}
                            <SettingsToggleRow
                                title={t('overlays.settings.editionOverlayEnabled')}
                                description={t('overlays.settings.editionOverlayEnabledHint')}
                                checked={configDraft.editionOverlayEnabled === true}
                                onChange={(editionOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, editionOverlayEnabled }))}
                            />
                            {renderPlacementLink('edition')}
                            <SettingsToggleRow
                                title={t('overlays.settings.audioCodecEnabled')}
                                description={t('overlays.settings.audioCodecEnabledHint')}
                                checked={configDraft.audioCodecEnabled === true}
                                onChange={(audioCodecEnabled) => setConfigDraft((prev) => ({ ...prev, audioCodecEnabled }))}
                            />
                            {configDraft.audioCodecEnabled === true && (
                                <label className="mb-3 block max-w-xs">
                                    <span className={fieldLabelClass}>{t('overlays.settings.audioCodecStyle')}</span>
                                    <CustomSelect
                                        className="mt-1.5"
                                        value={configDraft.audioCodecStyle || 'compact'}
                                        onChange={(audioCodecStyle) => setConfigDraft((prev) => ({
                                            ...prev,
                                            audioCodecStyle: audioCodecStyle as 'compact' | 'standard',
                                        }))}
                                        options={[
                                            { value: 'compact', label: t('overlays.settings.audioCodecStyleCompact') },
                                            { value: 'standard', label: t('overlays.settings.audioCodecStyleStandard') },
                                        ]}
                                    />
                                </label>
                            )}
                            {renderPlacementLink('audio_codec')}
                            <SettingsToggleRow
                                title={t('overlays.settings.videoFormatEnabled')}
                                description={t('overlays.settings.videoFormatEnabledHint')}
                                checked={configDraft.videoFormatEnabled === true}
                                onChange={(videoFormatEnabled) => setConfigDraft((prev) => ({ ...prev, videoFormatEnabled }))}
                            />
                            {renderPlacementLink('video_format')}
                            </OverlaySettingsGroup>

                            <OverlaySettingsGroup
                                id="kometa.availability"
                                title={t('overlays.jobs.kometa.groups.showMeta')}
                                description={t('overlays.jobs.kometa.groups.showMetaHint')}
                                openSignal={groupOpenSignal['kometa.availability']}
                                activeCount={[
                                    configDraft.statusOverlayEnabled,
                                    configDraft.networkOverlayEnabled,
                                    configDraft.streamingOverlayEnabled,
                                ].filter((v) => v === true).length}
                                totalCount={3}
                            >
                            {renderPlacementLink('status')}
                            {renderPlacementLink('network')}
                            <SettingsToggleRow
                                title={t('overlays.settings.statusOverlayEnabled')}
                                description={t('overlays.settings.statusOverlayEnabledHint')}
                                checked={configDraft.statusOverlayEnabled === true}
                                onChange={(statusOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, statusOverlayEnabled }))}
                            />
                            {configDraft.statusOverlayEnabled === true && (
                                <div className="mb-3 space-y-3 rounded-lg border border-border/50 bg-background/30 p-3">
                                    <label className="block max-w-xs">
                                        <span className={fieldLabelClass}>{t('overlays.fields.statusAiringDays')}</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={90}
                                            className={fieldInputClass}
                                            value={configDraft.statusAiringDays ?? 14}
                                            onChange={(e) => setConfigDraft((prev) => ({
                                                ...prev,
                                                statusAiringDays: Math.max(1, Math.min(90, Number(e.target.value) || 14)),
                                            }))}
                                        />
                                    </label>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.allowKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.allowKeysPlaceholder')}
                                                value={keysToText(configDraft.statusAllowKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    statusAllowKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.denyKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.denyKeysPlaceholder')}
                                                value={keysToText(configDraft.statusDenyKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    statusDenyKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                    </div>
                                </div>
                            )}
                            <SettingsToggleRow
                                title={t('overlays.settings.networkOverlayEnabled')}
                                description={t('overlays.settings.networkOverlayEnabledHint')}
                                checked={configDraft.networkOverlayEnabled === true}
                                onChange={(networkOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, networkOverlayEnabled }))}
                            />
                            {configDraft.networkOverlayEnabled === true && (
                                <div className="mb-3 grid gap-3 rounded-lg border border-border/50 bg-background/30 p-3 md:grid-cols-2">
                                    <label className="block">
                                        <span className={fieldLabelClass}>{t('overlays.settings.allowKeys')}</span>
                                        <textarea
                                            className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                            placeholder={t('overlays.settings.allowKeysPlaceholder')}
                                            value={keysToText(configDraft.networkAllowKeys)}
                                            onChange={(e) => setConfigDraft((prev) => ({
                                                ...prev,
                                                networkAllowKeys: textToKeys(e.target.value),
                                            }))}
                                        />
                                    </label>
                                    <label className="block">
                                        <span className={fieldLabelClass}>{t('overlays.settings.denyKeys')}</span>
                                        <textarea
                                            className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                            placeholder={t('overlays.settings.denyKeysPlaceholder')}
                                            value={keysToText(configDraft.networkDenyKeys)}
                                            onChange={(e) => setConfigDraft((prev) => ({
                                                ...prev,
                                                networkDenyKeys: textToKeys(e.target.value),
                                            }))}
                                        />
                                    </label>
                                </div>
                            )}
                            <SettingsToggleRow
                                title={t('overlays.settings.streamingOverlayEnabled')}
                                description={t('overlays.settings.streamingOverlayEnabledHint')}
                                checked={configDraft.streamingOverlayEnabled === true}
                                onChange={(streamingOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, streamingOverlayEnabled }))}
                            />
                            {configDraft.streamingOverlayEnabled === true && (
                                <div className="mb-3 space-y-3 rounded-lg border border-border/50 bg-background/30 p-3">
                                    <label className="block max-w-xs">
                                        <span className={fieldLabelClass}>{t('overlays.settings.streamingRegion')}</span>
                                        <input
                                            type="text"
                                            maxLength={2}
                                            className={fieldInputClass}
                                            value={configDraft.streamingRegion || 'US'}
                                            onChange={(e) => setConfigDraft((prev) => ({
                                                ...prev,
                                                streamingRegion: e.target.value.toUpperCase().slice(0, 2),
                                            }))}
                                        />
                                    </label>
                                    <div className="flex flex-wrap gap-3">
                                        <StyledCheckbox
                                            checked={configDraft.streamingIncludeShows !== false}
                                            label={t('overlays.settings.includeShows')}
                                            onChange={(streamingIncludeShows) => setConfigDraft((prev) => ({ ...prev, streamingIncludeShows }))}
                                        />
                                        <StyledCheckbox
                                            checked={configDraft.streamingIncludeMovies !== false}
                                            label={t('overlays.settings.includeMovies')}
                                            onChange={(streamingIncludeMovies) => setConfigDraft((prev) => ({ ...prev, streamingIncludeMovies }))}
                                        />
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.allowKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.allowKeysPlaceholder')}
                                                value={keysToText(configDraft.streamingAllowKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    streamingAllowKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.denyKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.denyKeysPlaceholder')}
                                                value={keysToText(configDraft.streamingDenyKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    streamingDenyKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                    </div>
                                </div>
                            )}
                            {renderPlacementLink('streaming')}
                            </OverlaySettingsGroup>

                            <OverlaySettingsGroup
                                id="kometa.ratings"
                                title={t('overlays.jobs.kometa.groups.ratings')}
                                description={t('overlays.jobs.kometa.groups.ratingsHint')}
                                openSignal={groupOpenSignal['kometa.ratings']}
                                activeCount={[
                                    configDraft.ratingsOverlayEnabled,
                                    configDraft.contentRatingEnabled,
                                    configDraft.ribbonOverlayEnabled,
                                ].filter((v) => v === true).length}
                                totalCount={3}
                            >
                            {renderPlacementLink('ratings')}
                            <SettingsToggleRow
                                title={t('overlays.settings.ratingsOverlayEnabled')}
                                description={t('overlays.settings.ratingsOverlayEnabledHint')}
                                checked={configDraft.ratingsOverlayEnabled === true}
                                onChange={(ratingsOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, ratingsOverlayEnabled }))}
                            />
                            {configDraft.ratingsOverlayEnabled === true && (
                                <div className="mb-3 space-y-3 rounded-lg border border-border/50 bg-background/30 p-3">
                                    <div className="flex flex-wrap gap-3">
                                        <StyledCheckbox
                                            checked={configDraft.ratingsIncludeShows !== false}
                                            label={t('overlays.settings.includeShows')}
                                            onChange={(ratingsIncludeShows) => setConfigDraft((prev) => ({ ...prev, ratingsIncludeShows }))}
                                        />
                                        <StyledCheckbox
                                            checked={configDraft.ratingsIncludeMovies !== false}
                                            label={t('overlays.settings.includeMovies')}
                                            onChange={(ratingsIncludeMovies) => setConfigDraft((prev) => ({ ...prev, ratingsIncludeMovies }))}
                                        />
                                    </div>
                                    <label className="block max-w-xs">
                                        <span className={fieldLabelClass}>{t('overlays.settings.ratingsSource')}</span>
                                        <CustomSelect
                                            className="mt-1.5"
                                            value={configDraft.ratingsSource || 'tmdb'}
                                            onChange={(ratingsSource) => setConfigDraft((prev) => ({ ...prev, ratingsSource }))}
                                            options={[
                                                { value: 'tmdb', label: 'TMDB' },
                                                { value: 'audience', label: t('overlays.settings.ratingsSourceAudience') },
                                                { value: 'critic', label: t('overlays.settings.ratingsSourceCritic') },
                                                { value: 'user', label: t('overlays.settings.ratingsSourceUser') },
                                                { value: 'imdb', label: 'IMDb' },
                                                { value: 'rt', label: 'Rotten Tomatoes' },
                                            ]}
                                        />
                                    </label>
                                    <label className="block max-w-xs">
                                        <span className={fieldLabelClass}>{t('overlays.fields.ratingsMinimum')}</span>
                                        <input
                                            type="number"
                                            min={0}
                                            max={10}
                                            step={0.1}
                                            className={fieldInputClass}
                                            value={configDraft.ratingsMinimum ?? 0}
                                            onChange={(e) => setConfigDraft((prev) => ({
                                                ...prev,
                                                ratingsMinimum: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                                            }))}
                                        />
                                    </label>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.allowKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.allowKeysPlaceholder')}
                                                value={keysToText(configDraft.ratingsAllowKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    ratingsAllowKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.denyKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.denyKeysPlaceholder')}
                                                value={keysToText(configDraft.ratingsDenyKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    ratingsDenyKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                    </div>
                                </div>
                            )}
                            <SettingsToggleRow
                                title={t('overlays.settings.contentRatingEnabled')}
                                description={t('overlays.settings.contentRatingEnabledHint')}
                                checked={configDraft.contentRatingEnabled === true}
                                onChange={(contentRatingEnabled) => setConfigDraft((prev) => ({ ...prev, contentRatingEnabled }))}
                            />
                            {configDraft.contentRatingEnabled === true && (
                                <label className="mb-3 block max-w-xs">
                                    <span className={fieldLabelClass}>{t('overlays.settings.contentRatingScheme')}</span>
                                    <CustomSelect
                                        className="mt-1.5"
                                        value={configDraft.contentRatingScheme || 'us'}
                                        onChange={(contentRatingScheme) => setConfigDraft((prev) => ({
                                            ...prev,
                                            contentRatingScheme: contentRatingScheme as OverlaysConfig['contentRatingScheme'],
                                        }))}
                                        options={[
                                            { value: 'us', label: 'US' },
                                            { value: 'uk', label: 'UK' },
                                            { value: 'de', label: 'DE' },
                                            { value: 'au', label: 'AU' },
                                            { value: 'nz', label: 'NZ' },
                                            { value: 'commonsense', label: 'Common Sense' },
                                        ]}
                                    />
                                </label>
                            )}
                            {renderPlacementLink('content_rating')}
                            <SettingsToggleRow
                                title={t('overlays.settings.ribbonOverlayEnabled')}
                                description={t('overlays.settings.ribbonOverlayEnabledHint')}
                                checked={configDraft.ribbonOverlayEnabled === true}
                                onChange={(ribbonOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, ribbonOverlayEnabled }))}
                            />
                            {configDraft.ribbonOverlayEnabled === true && (
                                <div className="mb-3 space-y-3 rounded-lg border border-border/50 bg-background/30 p-3">
                                    <label className="block max-w-xs">
                                        <span className={fieldLabelClass}>{t('overlays.settings.ribbonStyle')}</span>
                                        <CustomSelect
                                            className="mt-1.5"
                                            value={configDraft.ribbonStyle || 'yellow'}
                                            onChange={(ribbonStyle) => setConfigDraft((prev) => ({
                                                ...prev,
                                                ribbonStyle: ribbonStyle as OverlaysConfig['ribbonStyle'],
                                            }))}
                                            options={[
                                                { value: 'yellow', label: t('overlays.settings.ribbonYellow') },
                                                { value: 'red', label: t('overlays.settings.ribbonRed') },
                                                { value: 'black', label: t('overlays.settings.ribbonBlack') },
                                                { value: 'gray', label: t('overlays.settings.ribbonGray') },
                                            ]}
                                        />
                                    </label>
                                    <div className="flex flex-wrap gap-3">
                                        <StyledCheckbox
                                            checked={configDraft.ribbonIncludeShows !== false}
                                            label={t('overlays.settings.includeShows')}
                                            onChange={(ribbonIncludeShows) => setConfigDraft((prev) => ({ ...prev, ribbonIncludeShows }))}
                                        />
                                        <StyledCheckbox
                                            checked={configDraft.ribbonIncludeMovies !== false}
                                            label={t('overlays.settings.includeMovies')}
                                            onChange={(ribbonIncludeMovies) => setConfigDraft((prev) => ({ ...prev, ribbonIncludeMovies }))}
                                        />
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.allowKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.allowKeysPlaceholder')}
                                                value={keysToText(configDraft.ribbonAllowKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    ribbonAllowKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.denyKeys')}</span>
                                            <textarea
                                                className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[72px] font-mono text-[16px]`}
                                                placeholder={t('overlays.settings.denyKeysPlaceholder')}
                                                value={keysToText(configDraft.ribbonDenyKeys)}
                                                onChange={(e) => setConfigDraft((prev) => ({
                                                    ...prev,
                                                    ribbonDenyKeys: textToKeys(e.target.value),
                                                }))}
                                            />
                                        </label>
                                    </div>
                                </div>
                            )}
                            {renderPlacementLink('ribbon')}
                            </OverlaySettingsGroup>

                            <OverlaySettingsGroup
                                id="kometa.technical"
                                title={t('overlays.jobs.kometa.groups.misc')}
                                description={t('overlays.jobs.kometa.groups.miscHint')}
                                openSignal={groupOpenSignal['kometa.technical']}
                                activeCount={[
                                    configDraft.aspectOverlayEnabled,
                                    configDraft.versionsOverlayEnabled,
                                    configDraft.languageCountEnabled,
                                    configDraft.languagesOverlayEnabled,
                                    configDraft.runtimesOverlayEnabled,
                                    configDraft.directPlayOverlayEnabled,
                                    configDraft.episodeInfoOverlayEnabled,
                                ].filter((v) => v === true).length}
                                totalCount={7}
                            >
                            <SettingsToggleRow
                                title={t('overlays.settings.aspectOverlayEnabled')}
                                description={t('overlays.settings.aspectOverlayEnabledHint')}
                                checked={configDraft.aspectOverlayEnabled === true}
                                onChange={(aspectOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, aspectOverlayEnabled }))}
                            />
                            {renderPlacementLink('aspect')}
                            <SettingsToggleRow
                                title={t('overlays.settings.versionsOverlayEnabled')}
                                description={t('overlays.settings.versionsOverlayEnabledHint')}
                                checked={configDraft.versionsOverlayEnabled === true}
                                onChange={(versionsOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, versionsOverlayEnabled }))}
                            />
                            {renderPlacementLink('versions')}
                            <SettingsToggleRow
                                title={t('overlays.settings.languageCountEnabled')}
                                description={t('overlays.settings.languageCountEnabledHint')}
                                checked={configDraft.languageCountEnabled === true}
                                onChange={(languageCountEnabled) => setConfigDraft((prev) => ({ ...prev, languageCountEnabled }))}
                            />
                            {renderPlacementLink('language_count')}
                            <SettingsToggleRow
                                title={t('overlays.settings.languagesOverlayEnabled')}
                                description={t('overlays.settings.languagesOverlayEnabledHint')}
                                checked={configDraft.languagesOverlayEnabled === true}
                                onChange={(languagesOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, languagesOverlayEnabled }))}
                            />
                            {configDraft.languagesOverlayEnabled === true && (
                                <div className="mb-3 space-y-3 rounded-lg border border-border/50 bg-background/30 p-3">
                                    <label className="block max-w-xs">
                                        <span className={fieldLabelClass}>{t('overlays.settings.kometaFlagStyle')}</span>
                                        <CustomSelect
                                            className="mt-1.5"
                                            value={configDraft.kometaFlagStyle || 'round'}
                                            onChange={(kometaFlagStyle) => setConfigDraft((prev) => ({
                                                ...prev,
                                                kometaFlagStyle: kometaFlagStyle as 'round' | 'square',
                                            }))}
                                            options={[
                                                { value: 'round', label: t('overlays.settings.flagStyleRound') },
                                                { value: 'square', label: t('overlays.settings.flagStyleSquare') },
                                            ]}
                                        />
                                    </label>
                                    <label className="block">
                                        <span className={fieldLabelClass}>{t('overlays.settings.languagesAllowCodes')}</span>
                                        <textarea
                                            className={`appearance-none text-[16px] leading-5 ${fieldInputClass} min-h-[56px] font-mono text-[16px]`}
                                            placeholder={t('overlays.settings.languagesAllowCodesPlaceholder')}
                                            value={keysToText(configDraft.languagesAllowCodes)}
                                            onChange={(e) => setConfigDraft((prev) => ({
                                                ...prev,
                                                languagesAllowCodes: textToKeys(e.target.value),
                                            }))}
                                        />
                                    </label>
                                </div>
                            )}
                            {renderPlacementLink('languages')}
                            <SettingsToggleRow
                                title={t('overlays.settings.runtimesOverlayEnabled')}
                                description={t('overlays.settings.runtimesOverlayEnabledHint')}
                                checked={configDraft.runtimesOverlayEnabled === true}
                                onChange={(runtimesOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, runtimesOverlayEnabled }))}
                            />
                            {renderPlacementLink('runtimes')}
                            <SettingsToggleRow
                                title={t('overlays.settings.directPlayOverlayEnabled')}
                                description={t('overlays.settings.directPlayOverlayEnabledHint')}
                                checked={configDraft.directPlayOverlayEnabled === true}
                                onChange={(directPlayOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, directPlayOverlayEnabled }))}
                            />
                            {renderPlacementLink('direct_play')}
                            <SettingsToggleRow
                                title={t('overlays.settings.episodeInfoOverlayEnabled')}
                                description={t('overlays.settings.episodeInfoOverlayEnabledHint')}
                                checked={configDraft.episodeInfoOverlayEnabled === true}
                                onChange={(episodeInfoOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, episodeInfoOverlayEnabled }))}
                            />
                            {renderPlacementLink('episode_info')}
                            </OverlaySettingsGroup>

                            <OverlaySettingsGroup
                                id="kometa.bonus"
                                title={t('overlays.jobs.kometa.groups.bonus')}
                                description={t('overlays.jobs.kometa.groups.bonusHint')}
                                openSignal={groupOpenSignal['kometa.bonus']}
                                activeCount={configDraft.mediastingerOverlayEnabled === true ? 1 : 0}
                                totalCount={1}
                            >
                            <SettingsToggleRow
                                title={t('overlays.settings.mediastingerOverlayEnabled')}
                                description={t('overlays.settings.mediastingerOverlayEnabledHint')}
                                checked={configDraft.mediastingerOverlayEnabled === true}
                                onChange={(mediastingerOverlayEnabled) => setConfigDraft((prev) => ({ ...prev, mediastingerOverlayEnabled }))}
                            />
                            {renderPlacementLink('mediastinger')}
                            </OverlaySettingsGroup>

                            <div className="mb-4 mt-4 border-b border-border/40 pb-2">
                                <span className={fieldLabelClass}>{t('overlays.jobs.kometa.groups.run')}</span>
                            </div>
                            <SettingsToggleRow
                                title={t('overlays.settings.kometaAddOverlayLabel')}
                                description={t('overlays.settings.kometaAddOverlayLabelHint')}
                                checked={configDraft.kometaAddOverlayLabel === true}
                                onChange={(kometaAddOverlayLabel) => setConfigDraft((prev) => ({ ...prev, kometaAddOverlayLabel }))}
                            />
                            <label className="mb-3 block max-w-xs">
                                <span className={fieldLabelClass}>{t('overlays.fields.kometaScheduleHours')}</span>
                                <input
                                    type="number"
                                    min={0}
                                    max={168}
                                    className={fieldInputClass}
                                    value={configDraft.kometaScheduleHours ?? 24}
                                    onChange={(e) => setConfigDraft((prev) => ({
                                        ...prev,
                                        kometaScheduleHours: Number(e.target.value) || 0,
                                    }))}
                                />
                                <span className="mt-1 block text-[11px] text-muted">{t('overlays.settings.kometaScheduleHint')}</span>
                            </label>
                            {renderLibraryPicker('kometaLibrarySectionIds', 'overlays.settings.librariesHintKometa', 'all')}
                            <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={() => void saveSettings()}>
                                <Save className="h-4 w-4" /> {t('overlays.actions.save')}
                            </button>
                            <button
                                type="button"
                                className={`${buttonClass} mt-2 border-amber-500/40 text-amber-100`}
                                disabled={!canRevertKometa}
                                onClick={revertAllKometa}
                            >
                                <RotateCcw className="h-4 w-4" /> {t('overlays.actions.revertAllKometa')}
                            </button>

                        </OverlayJobCard>

                        <OverlayJobCard
                            id="overlay-job-collections"
                            title={t('overlays.jobs.collections.title')}
                            hint={t('overlays.jobs.collections.homeHint')}
                            statusLabel={collectionsJobActive
                                ? t('overlays.jobs.status.running')
                                : !collectionsEnabled
                                    ? t('overlays.jobs.status.off')
                                    : collectionsWhen
                                        ? t('overlays.jobs.status.lastRun', {
                                            when: new Date(collectionsWhen).toLocaleString(),
                                        })
                                        : t('overlays.jobs.status.idle')}
                            statusTone={collectionsJobActive ? 'running' : !collectionsEnabled ? 'off' : 'idle'}
                            enabledSummary={[collectionsEnabled
                                ? t('overlays.jobs.collections.enabledOn', { count: collectionRules.length })
                                : t('overlays.jobs.collections.enabledOff'), collectionsRunHint].filter(Boolean).join(' · ')}
                            previewLabel={t('overlays.actions.previewCollections')}
                            runLabel={t('overlays.actions.runCollections')}
                            expandLabel={t('overlays.jobs.expand')}
                            collapseLabel={t('overlays.jobs.collapse')}
                            expanded={jobCardExpanded.collections}
                            onToggleExpand={() => toggleJobCard('collections')}
                            onPreview={() => startBackgroundJob('previewCollections', () => overlaysApi.preview({ bundle: 'collections' }))}
                            onRun={() => startBackgroundJob('runCollections', () => overlaysApi.run({ preview: false, bundle: 'collections' }))}
                            previewBusy={busy === 'previewCollections' || (collectionsJobActive && runningCommand === 'preview-collections')}
                            runBusy={busy === 'runCollections' || (collectionsJobActive && runningCommand === 'run-collections')}
                            actionsDisabled={busy !== null || jobRunning || !workerReady}
                        >
                            <p className="mb-3 text-sm text-muted">{t('overlays.jobs.collections.homeManageHint')}</p>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className={primaryButtonClass}
                                    onClick={() => {
                                        resetNewCollectionForm();
                                        setBadgeWizardStep(1);
                                        setTab('badges');
                                    }}
                                >
                                    {t('overlays.jobs.collections.openBadgesTab')}
                                </button>
                                <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void saveSettings()}>
                                    <Save className="h-4 w-4" /> {t('overlays.actions.save')}
                                </button>
                            </div>
                            <div className="mt-3 space-y-2">
                                <SettingsToggleRow
                                    title={t('overlays.jobs.collections.enableFeature')}
                                    description={t('overlays.jobs.collections.firstWins')}
                                    checked={configDraft.customCollectionOverlaysEnabled === true}
                                    onChange={(customCollectionOverlaysEnabled) => setConfigDraft((prev) => ({
                                        ...prev,
                                        customCollectionOverlaysEnabled,
                                    }))}
                                />
                                <SettingsToggleRow
                                    title={t('overlays.jobs.collections.restampOnCollexions')}
                                    description={t('overlays.jobs.collections.restampOnCollexionsHint')}
                                    checked={configDraft.restampOnCollexionsUpdate === true}
                                    onChange={(restampOnCollexionsUpdate) => setConfigDraft((prev) => ({
                                        ...prev,
                                        restampOnCollexionsUpdate,
                                    }))}
                                    disabled={configDraft.customCollectionOverlaysEnabled !== true}
                                />
                            </div>
                        </OverlayJobCard>
                    </div>

                    {parsedSummary && summaryDetail ? (
                        <DashboardPanel
                            title={t('overlays.home.lastRunTitle')}
                            subtitle={t('overlays.home.lastRunSubtitle')}
                        >
                            <p className="text-sm text-text">
                                {t('overlays.summary.lastRunBody', {
                                    command: String(summary?.command || runningCommandLabel || '—'),
                                    detail: summaryDetail,
                                    preview: '',
                                })}
                            </p>
                            <button
                                type="button"
                                className="mt-3 text-sm font-semibold text-plex hover:underline"
                                onClick={() => setTab('activity')}
                            >
                                {t('overlays.home.viewActivity')}
                            </button>
                        </DashboardPanel>
                    ) : null}

                    <div className="flex flex-col gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null || jobRunning || !workerReady}
                                onClick={() => startBackgroundJob('scan', () => overlaysApi.scan())}
                            >
                                {t('overlays.actions.scanLibrary')}
                            </button>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null || jobRunning || !workerReady}
                                onClick={() => startBackgroundJob('reconcile', async () => {
                                    await overlaysApi.reconcile();
                                    setTab('home');
                                    setMoreSettingsOpen(true);
                                })}
                            >
                                {t('overlays.actions.reconcileDryRun')}
                            </button>
                            <button
                                type="button"
                                className={buttonClass}
                                onClick={() => setMoreSettingsOpen((v) => !v)}
                            >
                                <Settings2 className="h-4 w-4" />
                                {moreSettingsOpen
                                    ? t('overlays.home.hideMoreSettings')
                                    : t('overlays.home.moreSettings')}
                            </button>
                        </div>
                        <p className="text-[11px] text-muted sm:max-w-md sm:text-right">
                            {t('overlays.quick.previewHintBeforePreviewPath')} <code>config/overlays/preview/</code>. {t('overlays.quick.previewHintBetweenPaths')} <code>overlaid_log.json</code>.
                        </p>
                    </div>

                    {moreSettingsOpen ? (
                        <div className="space-y-4" id="overlays-more-settings">
                            <DashboardPanel title={t('overlays.settings.title')} subtitle={t('overlays.settings.subtitle')}>
                                <SettingsToggleRow
                                    title={t('overlays.settings.moduleEnabled')}
                                    checked={configDraft.enabled !== false}
                                    onChange={(enabled) => setConfigDraft((prev) => ({ ...prev, enabled }))}
                                />
                                <SettingsToggleRow
                                    title={t('overlays.settings.defaultPreviewMode')}
                                    checked={configDraft.previewMode === true}
                                    onChange={(previewMode) => setConfigDraft((prev) => ({ ...prev, previewMode }))}
                                />
                                <SettingsToggleRow
                                    title={t('overlays.settings.skipKometa')}
                                    checked={configDraft.skipIfKometaOverlayLabel !== false}
                                    onChange={(skipIfKometaOverlayLabel) => setConfigDraft((prev) => ({ ...prev, skipIfKometaOverlayLabel }))}
                                />
                                <SettingsToggleRow
                                    title={t('overlays.settings.bannersAddOverlayLabel')}
                                    description={t('overlays.settings.bannersAddOverlayLabelHint')}
                                    checked={configDraft.bannersAddOverlayLabel !== false}
                                    onChange={(bannersAddOverlayLabel) => setConfigDraft((prev) => ({ ...prev, bannersAddOverlayLabel }))}
                                />

                                <div className="border-b border-border/40 py-4">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <span className={fieldLabelClass}>{t('overlays.settings.visualSample')}</span>
                                            <p className="mt-1 max-w-2xl text-[11px] text-muted">
                                                {t('overlays.settings.visualSampleHint')}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                className={buttonClass}
                                                disabled={busy !== null || jobRunning}
                                                onClick={() => {
                                                    setSampleShowKey('');
                                                    void regenerateSamples({ showRatingKey: '' });
                                                }}
                                            >
                                                {t('overlays.actions.randomSample')}
                                            </button>
                                            <button
                                                type="button"
                                                className={buttonClass}
                                                disabled={busy !== null || jobRunning}
                                                onClick={() => void regenerateSamples()}
                                            >
                                                {busy === 'sample' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                                {t('overlays.actions.refreshSample')}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="mb-3 grid gap-3 md:grid-cols-2">
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.sampleSearch')}</span>
                                            <input
                                                className={fieldInputClass}
                                                value={sampleQuery}
                                                onChange={(e) => setSampleQuery(e.target.value)}
                                                placeholder={t('overlays.settings.sampleSearchPlaceholder')}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className={fieldLabelClass}>{t('overlays.settings.sampleShow')}</span>
                                            <CustomSelect
                                                className="mt-1.5"
                                                value={sampleShowKey || ''}
                                                onChange={(value) => setSampleShowKey(value)}
                                                options={[
                                                    { value: '', label: t('overlays.settings.sampleRandom') },
                                                    ...sampleCandidates.map((s) => ({ value: s.ratingKey, label: s.title })),
                                                ]}
                                            />
                                        </label>
                                    </div>
                                    {sampleError ? (
                                        <p className="mb-3 text-xs text-red-400">{sampleError}</p>
                                    ) : null}
                                    {sampleMeta?.exists
                                        && (sampleMeta.showSource === 'placeholder' || sampleMeta.episodeSource === 'placeholder') ? (
                                        <p className="mb-3 text-xs text-amber-200/90">{t('overlays.settings.visualSamplePlaceholderNote')}</p>
                                    ) : null}
                                    {sampleMeta?.exists ? (
                                        <div className="flex flex-wrap items-end gap-6">
                                            <figure className="space-y-2">
                                                <figcaption className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                                                    {t('overlays.settings.visualSampleShow')}
                                                </figcaption>
                                                <img
                                                    src={overlaysApi.sampleImageUrl('show', sampleBust)}
                                                    alt={sampleMeta.showTitle || 'New Season sample'}
                                                    className="h-[180px] w-[120px] rounded-md border border-border object-cover bg-background/60"
                                                />
                                                <figcaption className="max-w-[120px] truncate text-xs text-text" title={sampleMeta.showTitle || ''}>
                                                    {sampleMeta.showTitle || '—'}
                                                </figcaption>
                                            </figure>
                                            <figure className="space-y-2">
                                                <figcaption className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                                                    {t('overlays.settings.visualSampleEpisode')}
                                                </figcaption>
                                                <img
                                                    src={overlaysApi.sampleImageUrl('episode', sampleBust)}
                                                    alt={sampleMeta.episodeTitle || 'New Episode sample'}
                                                    className="h-[135px] w-[240px] rounded-md border border-border object-cover bg-background/60"
                                                />
                                                <figcaption
                                                    className="max-w-[240px] truncate text-xs text-text"
                                                    title={[sampleMeta.showTitleForEp, sampleMeta.episodeTitle].filter(Boolean).join(' — ')}
                                                >
                                                    {[sampleMeta.showTitleForEp, sampleMeta.episodeTitle].filter(Boolean).join(' — ') || '—'}
                                                </figcaption>
                                            </figure>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted">
                                            {busy === 'sample' ? t('overlays.actionStarted', { action: actionLabel('sample') }) : t('overlays.settings.visualSampleEmpty')}
                                        </p>
                                    )}
                                </div>

                                {renderLibraryPicker('librarySectionIds', 'overlays.settings.librariesHintAdvanced', 'all')}

                                <div className="flex flex-wrap gap-2 border-t border-border/40 pt-4">
                                    <button
                                        type="button"
                                        className={primaryButtonClass}
                                        disabled={busy !== null}
                                        onClick={() => void saveSettings()}
                                    >
                                        <Save className="h-4 w-4" /> {t('overlays.actions.saveSettings')}
                                    </button>
                                </div>
                            </DashboardPanel>

                            <DashboardPanel title={t('overlays.import.title')} subtitle={t('overlays.import.subtitle')}>
                                <p className="text-sm text-muted">
                                    {t('overlays.import.bodyBeforeLog')} <code>overlaid_log.json</code> {t('overlays.import.bodyAfterLog')}
                                </p>
                                <textarea
                                    className="appearance-none text-[16px] leading-5 mt-3 min-h-[220px] w-full rounded-lg border border-border bg-background p-3 font-mono text-[16px] text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex"
                                    placeholder='{"12345":{"title":"Example Show","timestamp":"2025-01-15T14:30:00","preview_only":false}}'
                                    value={importText}
                                    onChange={(e) => setImportText(e.target.value)}
                                />
                                <div className="mt-4 flex flex-wrap items-center gap-3">
                                    <CustomSelect
                                        className="w-40"
                                        compact
                                        value={importMode}
                                        onChange={(value) => setImportMode(value === 'replace' ? 'replace' : 'merge')}
                                        options={importModeOptions}
                                    />
                                    <button
                                        type="button"
                                        className={primaryButtonClass}
                                        disabled={busy !== null || !importText.trim()}
                                        onClick={() => void runAction('importLog', async () => {
                                            const parsed = JSON.parse(importText);
                                            await overlaysApi.importLog(parsed, importMode);
                                        })}
                                    >
                                        <Upload className="h-4 w-4" /> {t('overlays.actions.importLog')}
                                    </button>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null || jobRunning || !workerReady}
                                        onClick={() => startBackgroundJob('reconcile', () => overlaysApi.reconcile())}
                                    >
                                        {t('overlays.actions.reconcileDryRun')}
                                    </button>
                                </div>
                                {reconcile && (
                                    <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3 text-sm">
                                        <p className="font-semibold">{t('overlays.reconcile.title')}</p>
                                        <p className="mt-1 text-muted">
                                            {t('overlays.reconcile.summary', {
                                                add: reconcile.wouldAddCount ?? 0,
                                                convert: reconcile.wouldConvertCount ?? 0,
                                                remove: reconcile.wouldRemoveCount ?? 0,
                                            })}
                                        </p>
                                    </div>
                                )}
                                {!reconcile && summary?.command === 'reconcile' && (
                                    <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3 text-sm">
                                        <p className="font-semibold">{t('overlays.reconcile.title')}</p>
                                        <p className="mt-1 text-muted">
                                            {t('overlays.reconcile.summary', {
                                                add: summary.wouldAddCount ?? 0,
                                                convert: summary.wouldConvertCount ?? 0,
                                                remove: summary.wouldRemoveCount ?? 0,
                                            })}
                                        </p>
                                    </div>
                                )}
                            </DashboardPanel>
                        </div>
                    ) : null}
                </div>
            )}

            {tab === 'tracked' && (
                <div className="space-y-4">
                <DashboardPanel
                    title={t('overlays.shows.title')}
                    subtitle={t('overlays.shows.subtitle')}
                    collapsible
                    defaultCollapsed
                    collapseLabel={t('overlays.kometa.collapseSection')}
                    expandLabel={t('overlays.kometa.expandSection')}
                    controls={(
                        <button
                            type="button"
                            className={`${buttonClass} border-amber-500/40 text-amber-100`}
                            disabled={!canResetShows}
                            onClick={() => resetOverlays('shows')}
                        >
                            <RotateCcw className="h-4 w-4" /> {t('overlays.actions.resetShows')}
                        </button>
                    )}
                >
                    {shows.length === 0 ? (
                        <p className="text-sm text-muted">{t('overlays.shows.empty')}</p>
                    ) : (
                        <>
                            <div className="space-y-2 md:hidden">
                                {shows.map((row) => (
                                    <div
                                        key={`${row.overlayMode || 'new-season'}:${row.ratingKey}`}
                                        className="rounded-xl border border-white/10 bg-black/25 p-3"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="font-semibold leading-snug text-text">{row.title}</p>
                                                <p className="mt-1 text-xs text-muted">
                                                    {[row.library, row.seasonIndex != null ? `S${row.seasonIndex}` : null]
                                                        .filter(Boolean)
                                                        .join(' · ') || '—'}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                className="shrink-0 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                disabled={busy !== null}
                                                onClick={() => void runAction('reset', () => overlaysApi.resetOne(
                                                    row.ratingKey,
                                                    overlayResetKindForShow(row),
                                                ))}
                                            >
                                                {t('overlays.actions.reset')}
                                            </button>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                                            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-muted">
                                                {overlayShowTypeLabel(row, t)}
                                            </span>
                                            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-muted">
                                                {row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}
                                            </span>
                                            {row.timestamp ? (
                                                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-muted">
                                                    {new Date(row.timestamp).toLocaleString()}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="hidden overflow-x-auto md:block">
                            <table className="min-w-full text-left text-sm">
                                <thead className="text-xs uppercase text-muted">
                                    <tr>
                                        <th className="px-2 py-2">{t('overlays.table.title')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.library')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.key')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.season')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.type')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.mode')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.when')}</th>
                                        <th className="px-2 py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {shows.map((row) => (
                                        <tr key={`${row.overlayMode || 'new-season'}:${row.ratingKey}`} className="border-t border-white/10">
                                            <td className="px-2 py-2 font-medium">{row.title}</td>
                                            <td className="px-2 py-2 text-muted">{row.library || '—'}</td>
                                            <td className="px-2 py-2 tabular-nums text-muted">{row.ratingKey}</td>
                                            <td className="px-2 py-2">{row.seasonIndex ?? '—'}</td>
                                            <td className="px-2 py-2">{overlayShowTypeLabel(row, t)}</td>
                                            <td className="px-2 py-2">{row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}</td>
                                            <td className="px-2 py-2 text-muted">
                                                {row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}
                                            </td>
                                            <td className="px-2 py-2 text-right">
                                                <button
                                                    type="button"
                                                    className="text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                    disabled={busy !== null}
                                                    onClick={() => void runAction('reset', () => overlaysApi.resetOne(
                                                        row.ratingKey,
                                                        overlayResetKindForShow(row),
                                                    ))}
                                                >
                                                    {t('overlays.actions.reset')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        </>
                    )}
                </DashboardPanel>

                <DashboardPanel
                    title={t('overlays.episodes.title')}
                    subtitle={t('overlays.episodes.subtitle')}
                    collapsible
                    defaultCollapsed
                    collapseLabel={t('overlays.kometa.collapseSection')}
                    expandLabel={t('overlays.kometa.expandSection')}
                    controls={(
                        <button
                            type="button"
                            className={`${buttonClass} border-amber-500/40 text-amber-100`}
                            disabled={!canResetEpisodes}
                            onClick={() => resetOverlays('episodes')}
                        >
                            <RotateCcw className="h-4 w-4" /> {t('overlays.actions.resetEpisodes')}
                        </button>
                    )}
                >
                    {episodes.length === 0 ? (
                        <p className="text-sm text-muted">{t('overlays.episodes.empty')}</p>
                    ) : (
                        <>
                            <div className="space-y-2 md:hidden">
                                {episodeRowsGrouped.map((entry) => {
                                    if (entry.type === 'group' && entry.groupId && entry.rows) {
                                        const rows = entry.rows;
                                        const first = rows[0];
                                        const collapsed = collapsedBinges[entry.groupId] !== false;
                                        return (
                                            <div key={entry.groupId} className="rounded-xl border border-white/10 bg-black/25 p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <button
                                                        type="button"
                                                        className="min-w-0 text-left"
                                                        onClick={() => setCollapsedBinges((prev) => ({
                                                            ...prev,
                                                            [entry.groupId!]: !collapsed,
                                                        }))}
                                                    >
                                                        <p className="font-semibold leading-snug text-text">
                                                            {collapsed ? '▸' : '▾'}{' '}
                                                            {t('overlays.episodes.bingeGroup', {
                                                                show: first?.showTitle || '—',
                                                                season: first?.seasonIndex ?? '?',
                                                                count: rows.length,
                                                            })}
                                                        </p>
                                                        <p className="mt-1 text-[11px] text-muted">{t('overlays.episodes.bingeTag')}</p>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="shrink-0 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                        disabled={busy !== null}
                                                        onClick={() => void runAction(
                                                            'reset',
                                                            () => overlaysApi.resetBingeGroup(rows.map((r) => r.ratingKey)),
                                                        )}
                                                    >
                                                        {t('overlays.actions.resetGroup')}
                                                    </button>
                                                </div>
                                                {!collapsed && (
                                                    <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
                                                        {rows.map((row) => (
                                                            <div key={row.ratingKey} className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <div className="min-w-0">
                                                                        <p className="text-sm font-medium text-text">{row.title}</p>
                                                                        <p className="mt-0.5 text-[11px] text-muted">
                                                                            {row.seasonIndex != null || row.episodeIndex != null
                                                                                ? `S${row.seasonIndex ?? '?'}E${row.episodeIndex ?? '?'}`
                                                                                : '—'}
                                                                            {row.airedAt ? ` · ${new Date(row.airedAt).toLocaleString()}` : ''}
                                                                        </p>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        className="shrink-0 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                                        disabled={busy !== null}
                                                                        onClick={() => void runAction('reset', () => overlaysApi.resetOne(row.ratingKey, 'episode'))}
                                                                    >
                                                                        {t('overlays.actions.reset')}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }
                                    const row = entry.row;
                                    if (!row) return null;
                                    return (
                                        <div key={row.ratingKey} className="rounded-xl border border-white/10 bg-black/25 p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-semibold leading-snug text-text">{row.title}</p>
                                                    <p className="mt-1 text-xs text-muted">
                                                        {[row.showTitle, row.library].filter(Boolean).join(' · ') || '—'}
                                                    </p>
                                                    <p className="mt-0.5 text-[11px] text-muted">
                                                        {row.seasonIndex != null || row.episodeIndex != null
                                                            ? `S${row.seasonIndex ?? '?'}E${row.episodeIndex ?? '?'}`
                                                            : '—'}
                                                        {row.airedAt ? ` · ${new Date(row.airedAt).toLocaleString()}` : ''}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="shrink-0 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                    disabled={busy !== null}
                                                    onClick={() => void runAction('reset', () => overlaysApi.resetOne(row.ratingKey, 'episode'))}
                                                >
                                                    {t('overlays.actions.reset')}
                                                </button>
                                            </div>
                                            <div className="mt-2">
                                                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-muted">
                                                    {row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="hidden overflow-x-auto md:block">
                            <table className="min-w-full text-left text-sm">
                                <thead className="text-xs uppercase text-muted">
                                    <tr>
                                        <th className="px-2 py-2">{t('overlays.table.show')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.library')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.title')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.episode')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.aired')}</th>
                                        <th className="px-2 py-2">{t('overlays.table.mode')}</th>
                                        <th className="px-2 py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {episodeRowsGrouped.map((entry) => {
                                        if (entry.type === 'group' && entry.groupId && entry.rows) {
                                            const rows = entry.rows;
                                            const first = rows[0];
                                            const collapsed = collapsedBinges[entry.groupId] !== false;
                                            return (
                                                <React.Fragment key={entry.groupId}>
                                                    <tr className="border-t border-white/10 bg-white/5">
                                                        <td className="px-2 py-2 font-semibold" colSpan={5}>
                                                            <button
                                                                type="button"
                                                                className="text-left hover:underline"
                                                                onClick={() => setCollapsedBinges((prev) => ({
                                                                    ...prev,
                                                                    [entry.groupId!]: !collapsed,
                                                                }))}
                                                            >
                                                                {collapsed ? '▸' : '▾'}{' '}
                                                                {t('overlays.episodes.bingeGroup', {
                                                                    show: first?.showTitle || '—',
                                                                    season: first?.seasonIndex ?? '?',
                                                                    count: rows.length,
                                                                })}
                                                            </button>
                                                        </td>
                                                        <td className="px-2 py-2 text-muted">{t('overlays.episodes.bingeTag')}</td>
                                                        <td className="px-2 py-2 text-right">
                                                            <button
                                                                type="button"
                                                                className="text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                                disabled={busy !== null}
                                                                onClick={() => void runAction(
                                                                    'reset',
                                                                    () => overlaysApi.resetBingeGroup(rows.map((r) => r.ratingKey)),
                                                                )}
                                                            >
                                                                {t('overlays.actions.resetGroup')}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {!collapsed && rows.map((row) => (
                                                        <tr key={row.ratingKey} className="border-t border-white/5">
                                                            <td className="px-2 py-2 pl-6 text-muted">{row.showTitle || '—'}</td>
                                                            <td className="px-2 py-2 text-muted">{row.library || '—'}</td>
                                                            <td className="px-2 py-2">{row.title}</td>
                                                            <td className="px-2 py-2 tabular-nums text-muted">
                                                                {row.seasonIndex != null || row.episodeIndex != null
                                                                    ? `S${row.seasonIndex ?? '?'}E${row.episodeIndex ?? '?'}`
                                                                    : '—'}
                                                            </td>
                                                            <td className="px-2 py-2 text-muted">
                                                                {row.airedAt ? new Date(row.airedAt).toLocaleString() : '—'}
                                                            </td>
                                                            <td className="px-2 py-2">{row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}</td>
                                                            <td className="px-2 py-2 text-right">
                                                                <button
                                                                    type="button"
                                                                    className="text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                                    disabled={busy !== null}
                                                                    onClick={() => void runAction('reset', () => overlaysApi.resetOne(row.ratingKey, 'episode'))}
                                                                >
                                                                    {t('overlays.actions.reset')}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            );
                                        }
                                        const row = entry.row;
                                        if (!row) return null;
                                        return (
                                            <tr key={row.ratingKey} className="border-t border-white/10">
                                                <td className="px-2 py-2 font-medium">{row.showTitle || '—'}</td>
                                                <td className="px-2 py-2 text-muted">{row.library || '—'}</td>
                                                <td className="px-2 py-2">{row.title}</td>
                                                <td className="px-2 py-2 tabular-nums text-muted">
                                                    {row.seasonIndex != null || row.episodeIndex != null
                                                        ? `S${row.seasonIndex ?? '?'}E${row.episodeIndex ?? '?'}`
                                                        : '—'}
                                                </td>
                                                <td className="px-2 py-2 text-muted">
                                                    {row.airedAt ? new Date(row.airedAt).toLocaleString() : '—'}
                                                </td>
                                                <td className="px-2 py-2">{row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}</td>
                                                <td className="px-2 py-2 text-right">
                                                    <button
                                                        type="button"
                                                        className="text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                        disabled={busy !== null}
                                                        onClick={() => void runAction('reset', () => overlaysApi.resetOne(row.ratingKey, 'episode'))}
                                                    >
                                                        {t('overlays.actions.reset')}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            </div>
                        </>
                    )}
                </DashboardPanel>

                <DashboardPanel
                    title={t('overlays.kometa.trackedTitle', { count: kometaOtherCount })}
                    subtitle={t('overlays.kometa.trackedSubtitleShows')}
                    collapsible
                    defaultCollapsed
                    collapseLabel={t('overlays.kometa.collapseSection')}
                    expandLabel={t('overlays.kometa.expandSection')}
                    controls={(
                        <button
                            type="button"
                            className={`${buttonClass} border-amber-500/40 text-amber-100`}
                            disabled={!canRevertOtherKometa}
                            onClick={revertOtherKometa}
                        >
                            <RotateCcw className="h-4 w-4" /> {t('overlays.actions.revertAllKometa')}
                        </button>
                    )}
                >
                    {kometaOtherCount === 0 ? (
                        <p className="text-sm text-muted">{t('overlays.kometa.emptyOther')}</p>
                    ) : (
                        <div className="space-y-3">
                            {otherKometaSections.map((section) => {
                                const collapsed = collapsedKometaSections[section.id] !== false;
                                return (
                                    <div
                                        key={section.id}
                                        className="overflow-hidden rounded-xl border border-white/10 bg-black/25"
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
                                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                                <button
                                                    type="button"
                                                    className="shrink-0 text-muted"
                                                    onClick={() => setCollapsedKometaSections((prev) => ({
                                                        ...prev,
                                                        [section.id]: !collapsed,
                                                    }))}
                                                    aria-expanded={!collapsed}
                                                    aria-label={collapsed
                                                        ? t('overlays.kometa.expandSection')
                                                        : t('overlays.kometa.collapseSection')}
                                                >
                                                    <span className="inline-block w-3">{collapsed ? '▸' : '▾'}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="group min-w-0 flex-1 text-left"
                                                    onClick={() => setCollapsedKometaSections((prev) => ({
                                                        ...prev,
                                                        [section.id]: !collapsed,
                                                    }))}
                                                >
                                                    <p className="truncate text-sm font-semibold text-text">
                                                        {sectionHeading(section)}
                                                    </p>
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                className="shrink-0 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                disabled={busy !== null || jobRunning || !workerReady || section.rows.length === 0}
                                                onClick={() => revertKometaSection(section)}
                                            >
                                                {t('overlays.kometa.revertSection')}
                                            </button>
                                        </div>
                                        {!collapsed && (
                                            section.rows.length === 0 ? (
                                                <p className="px-3 py-3 text-sm text-muted">
                                                    {t('overlays.kometa.sectionEmpty')}
                                                </p>
                                            ) : (
                                            <>
                                                <div className="space-y-2 p-3 md:hidden">
                                                    {section.rows.map((row) => (
                                                        <div key={row.ratingKey} className="rounded-lg border border-white/10 bg-black/20 p-3">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="min-w-0">
                                                                    <p className="font-semibold leading-snug text-text">{row.title}</p>
                                                                    <p className="mt-1 text-xs text-muted">{row.library || '—'}</p>
                                                                    <p className="mt-1 text-[11px] leading-snug text-muted">
                                                                        {formatKometaFamilies(row)}
                                                                    </p>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="shrink-0 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                                    disabled={busy !== null || jobRunning}
                                                                    onClick={() => void runAction('revertKometa', async () => {
                                                                        await overlaysApi.revertKometa(row.ratingKey);
                                                                        await refresh();
                                                                    })}
                                                                >
                                                                    {t('overlays.actions.revert')}
                                                                </button>
                                                            </div>
                                                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                                                                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-muted">
                                                                    {row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}
                                                                </span>
                                                                {row.orphanBackup ? (
                                                                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-100">
                                                                        {t('overlays.kometa.orphanBackup')}
                                                                    </span>
                                                                ) : null}
                                                                {row.timestamp ? (
                                                                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-muted">
                                                                        {new Date(row.timestamp).toLocaleString()}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="hidden overflow-x-auto md:block">
                                                    <table className="min-w-full text-left text-sm">
                                                        <thead className="text-xs uppercase text-muted">
                                                            <tr>
                                                                <th className="px-3 py-2">{t('overlays.table.title')}</th>
                                                                <th className="px-2 py-2">{t('overlays.table.library')}</th>
                                                                <th className="px-2 py-2">{t('overlays.kometa.families')}</th>
                                                                <th className="px-2 py-2">{t('overlays.table.mode')}</th>
                                                                <th className="px-2 py-2">{t('overlays.table.when')}</th>
                                                                <th className="px-2 py-2" />
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {section.rows.map((row) => (
                                                                <tr key={row.ratingKey} className="border-t border-white/10">
                                                                    <td className="px-3 py-2 font-medium">{row.title}</td>
                                                                    <td className="px-2 py-2 text-muted">{row.library || '—'}</td>
                                                                    <td className="px-2 py-2 text-xs text-muted">
                                                                        {formatKometaFamilies(row)}
                                                                    </td>
                                                                    <td className="px-2 py-2">{row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}</td>
                                                                    <td className="px-2 py-2 text-muted">
                                                                        {row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}
                                                                    </td>
                                                                    <td className="px-2 py-2 text-right">
                                                                        <button
                                                                            type="button"
                                                                            className="text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                                            disabled={busy !== null || jobRunning}
                                                                            onClick={() => void runAction('revertKometa', async () => {
                                                                                await overlaysApi.revertKometa(row.ratingKey);
                                                                                await refresh();
                                                                            })}
                                                                        >
                                                                            {t('overlays.actions.revert')}
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </>
                                            )
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </DashboardPanel>
                </div>
            )}

            {tab === 'badges' && (
                <div className="space-y-4">
                    <DashboardPanel
                        title={t('overlays.badges.settingsTitle')}
                        subtitle={t('overlays.badges.settingsSubtitle')}
                    >
                        <SettingsToggleRow
                            title={t('overlays.jobs.collections.enableFeature')}
                            description={t('overlays.jobs.collections.firstWins')}
                            checked={configDraft.customCollectionOverlaysEnabled === true}
                            onChange={(customCollectionOverlaysEnabled) => setConfigDraft((prev) => ({
                                ...prev,
                                customCollectionOverlaysEnabled,
                            }))}
                        />
                        <SettingsToggleRow
                            title={t('overlays.jobs.collections.restampOnCollexions')}
                            description={t('overlays.jobs.collections.restampOnCollexionsHint')}
                            checked={configDraft.restampOnCollexionsUpdate === true}
                            onChange={(restampOnCollexionsUpdate) => setConfigDraft((prev) => ({
                                ...prev,
                                restampOnCollexionsUpdate,
                            }))}
                            disabled={configDraft.customCollectionOverlaysEnabled !== true}
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={() => void saveSettings()}>
                                <Save className="h-4 w-4" /> {t('overlays.actions.save')}
                            </button>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null || jobRunning || !workerReady}
                                onClick={() => startBackgroundJob('previewCollections', () => overlaysApi.preview({ bundle: 'collections' }))}
                            >
                                {t('overlays.actions.previewCollections')}
                            </button>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null || jobRunning || !workerReady}
                                onClick={() => startBackgroundJob('runCollections', () => overlaysApi.run({ preview: false, bundle: 'collections' }))}
                            >
                                {t('overlays.actions.runCollections')}
                            </button>
                        </div>
                    </DashboardPanel>

                    <DashboardPanel
                        title={t('overlays.badges.listTitle', { count: collectionRules.length })}
                        subtitle={t('overlays.badges.listSubtitle')}
                    >
                        {collectionRules.length === 0 ? (
                            <p className="text-sm text-muted">{t('overlays.jobs.collections.emptyRules')}</p>
                        ) : (
                            <div className="space-y-2">
                                {collectionRules.map((rule) => {
                                    const libs = ruleLibraries(rule);
                                    const titles = ruleCollectionLabel(rule);
                                    const thumbId = String(rule.image || '').trim();
                                    return (
                                        <div
                                            key={rule.id}
                                            className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3"
                                        >
                                            {thumbId ? (
                                                <img
                                                    src={`/api/overlays/preset-file?id=${encodeURIComponent(thumbId)}&kind=season&t=${sampleBust}`}
                                                    alt=""
                                                    className="h-12 w-12 shrink-0 rounded-md border border-border/60 object-contain bg-background/40"
                                                />
                                            ) : (
                                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/40 text-muted">
                                                    <FolderKanban className="h-4 w-4" />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-semibold text-text">
                                                    {rule.name || titles || rule.id}
                                                </p>
                                                <p className="mt-0.5 truncate text-xs text-muted">
                                                    {[libs.join(', '), titles].filter(Boolean).join(' · ') || '—'}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    className="inline-flex items-center gap-1 text-xs font-semibold text-plex hover:underline disabled:opacity-50"
                                                    disabled={busy !== null || jobRunning}
                                                    onClick={() => beginEditCollectionRule(rule)}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                    {t('overlays.jobs.collections.editRule')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="inline-flex items-center gap-1 text-xs font-semibold text-red-300 hover:underline disabled:opacity-50"
                                                    disabled={busy !== null || jobRunning}
                                                    onClick={() => void removeCollectionOverlayRule(rule.id)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                    {t('overlays.jobs.collections.deleteRule')}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </DashboardPanel>

                    <DashboardPanel
                        title={editingRuleId
                            ? t('overlays.jobs.collections.editTitle')
                            : t('overlays.badges.wizardTitle')}
                        subtitle={t('overlays.badges.wizardSubtitle')}
                    >
                        {collectionRuleForm}
                    </DashboardPanel>

                    <DashboardPanel
                        title={t('overlays.kometa.trackedCollectionsTitle', { count: collectionTrackedCount })}
                        subtitle={t('overlays.kometa.trackedCollectionsSubtitle')}
                        collapsible
                        defaultCollapsed
                        collapseLabel={t('overlays.kometa.collapseSection')}
                        expandLabel={t('overlays.kometa.expandSection')}
                        controls={(
                            <button
                                type="button"
                                className={`${buttonClass} border-amber-500/40 text-amber-100`}
                                disabled={!canRevertCollections}
                                onClick={revertAllCollections}
                            >
                                <RotateCcw className="h-4 w-4" /> {t('overlays.actions.revertAllCollections')}
                            </button>
                        )}
                    >
                        {collectionRules.length === 0 && collectionTrackedCount === 0 ? (
                            <p className="text-sm text-muted">{t('overlays.kometa.emptyCollections')}</p>
                        ) : (
                            <div className="space-y-3">
                                {collectionSections.map((section) => {
                                    const collapsed = collapsedKometaSections[section.id] !== false;
                                    return (
                                        <div
                                            key={section.id}
                                            className="overflow-hidden rounded-xl border border-white/10 bg-black/25"
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
                                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                                    <button
                                                        type="button"
                                                        className="shrink-0 text-muted"
                                                        onClick={() => setCollapsedKometaSections((prev) => ({
                                                            ...prev,
                                                            [section.id]: !collapsed,
                                                        }))}
                                                        aria-expanded={!collapsed}
                                                        aria-label={collapsed
                                                            ? t('overlays.kometa.expandSection')
                                                            : t('overlays.kometa.collapseSection')}
                                                    >
                                                        <span className="inline-block w-3">{collapsed ? '▸' : '▾'}</span>
                                                    </button>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-semibold text-text">
                                                            {sectionHeading(section)}
                                                        </p>
                                                        {section.ruleId ? (() => {
                                                            const rule = collectionRules.find((r) => r.id === section.ruleId);
                                                            const label = rule ? ruleCollectionLabel(rule) : '';
                                                            return label ? (
                                                                <p className="mt-0.5 truncate text-[11px] text-muted">{label}</p>
                                                            ) : null;
                                                        })() : null}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {section.ruleId ? (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className="shrink-0 text-xs font-semibold text-plex hover:underline disabled:opacity-50"
                                                                disabled={busy !== null || jobRunning}
                                                                onClick={() => {
                                                                    const rule = collectionRules.find((r) => r.id === section.ruleId);
                                                                    if (rule) beginEditCollectionRule(rule);
                                                                }}
                                                            >
                                                                {t('overlays.jobs.collections.editRule')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="shrink-0 text-xs font-semibold text-red-300 hover:underline disabled:opacity-50"
                                                                disabled={busy !== null || jobRunning}
                                                                onClick={() => void removeCollectionOverlayRule(section.ruleId)}
                                                            >
                                                                {t('overlays.jobs.collections.deleteRule')}
                                                            </button>
                                                        </>
                                                    ) : null}
                                                    <button
                                                        type="button"
                                                        className="shrink-0 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                        disabled={busy !== null || jobRunning || !workerReady || section.rows.length === 0}
                                                        onClick={() => revertKometaSection(section)}
                                                    >
                                                        {t('overlays.kometa.revertSection')}
                                                    </button>
                                                </div>
                                            </div>
                                            {!collapsed && (
                                                section.rows.length === 0 ? (
                                                    <p className="px-3 py-3 text-sm text-muted">
                                                        {t('overlays.kometa.sectionEmpty')}
                                                    </p>
                                                ) : (
                                                    <>
                                                        <div className="space-y-2 p-3 md:hidden">
                                                            {section.rows.map((row) => (
                                                                <div key={row.ratingKey} className="rounded-lg border border-white/10 bg-black/20 p-3">
                                                                    <div className="flex items-start justify-between gap-3">
                                                                        <div className="min-w-0">
                                                                            <p className="font-semibold leading-snug text-text">{row.title}</p>
                                                                            <p className="mt-1 text-xs text-muted">{row.library || '—'}</p>
                                                                            <p className="mt-1 text-[11px] leading-snug text-muted">
                                                                                {formatKometaFamilies(row)}
                                                                            </p>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            className="shrink-0 text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                                            disabled={busy !== null || jobRunning}
                                                                            onClick={() => revertCollectionRow(row, section.ruleId)}
                                                                        >
                                                                            {t('overlays.actions.revert')}
                                                                        </button>
                                                                    </div>
                                                                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                                                                        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-muted">
                                                                            {row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}
                                                                        </span>
                                                                        {row.timestamp ? (
                                                                            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-muted">
                                                                                {new Date(row.timestamp).toLocaleString()}
                                                                            </span>
                                                                        ) : null}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="hidden overflow-x-auto md:block">
                                                            <table className="min-w-full text-left text-sm">
                                                                <thead className="text-xs uppercase text-muted">
                                                                    <tr>
                                                                        <th className="px-3 py-2">{t('overlays.table.title')}</th>
                                                                        <th className="px-2 py-2">{t('overlays.table.library')}</th>
                                                                        <th className="px-2 py-2">{t('overlays.kometa.families')}</th>
                                                                        <th className="px-2 py-2">{t('overlays.table.mode')}</th>
                                                                        <th className="px-2 py-2">{t('overlays.table.when')}</th>
                                                                        <th className="px-2 py-2" />
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {section.rows.map((row) => (
                                                                        <tr key={row.ratingKey} className="border-t border-white/10">
                                                                            <td className="px-3 py-2 font-medium">{row.title}</td>
                                                                            <td className="px-2 py-2 text-muted">{row.library || '—'}</td>
                                                                            <td className="px-2 py-2 text-xs text-muted">
                                                                                {formatKometaFamilies(row)}
                                                                            </td>
                                                                            <td className="px-2 py-2">{row.previewOnly ? t('overlays.mode.preview') : t('overlays.mode.live')}</td>
                                                                            <td className="px-2 py-2 text-muted">
                                                                                {row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}
                                                                            </td>
                                                                            <td className="px-2 py-2 text-right">
                                                                                <button
                                                                                    type="button"
                                                                                    className="text-xs font-semibold text-amber-200 hover:underline disabled:opacity-50"
                                                                                    disabled={busy !== null || jobRunning}
                                                                                    onClick={() => revertCollectionRow(row, section.ruleId)}
                                                                                >
                                                                                    {t('overlays.actions.revert')}
                                                                                </button>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </>
                                                )
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </DashboardPanel>
                </div>
            )}

            {tab === 'look' && (
                <div className="space-y-4">
                    <p className="text-sm text-muted">{t('overlays.look.intro')}</p>
                    <div id="overlay-placement-panel" className="scroll-mt-4">
                    <PlacementEditor
                        focusTarget={placementFocusTarget}
                        placement={placementDraft}
                        seasonPresetId={configDraft.overlayPresetId || 'new-season'}
                        episodePresetId={configDraft.episodeOverlayPresetId || 'new-episode'}
                        recentlyPresetId={configDraft.recentlyAddedPresetId || 'recently-added'}
                        collectionPresetId={collectionPresetPreviewId}
                        collectionRules={collectionRules.map((r) => ({
                            id: r.id,
                            name: r.name || r.collectionTitle || r.id,
                            image: r.image,
                        }))}
                        seasonPresetOptions={seasonPresetOptions}
                        episodePresetOptions={episodePresetOptions}
                        recentlyPresetOptions={recentlyPresetOptions}
                        sampleBust={sampleBust}
                        busy={busy !== null}
                        onChange={(next) => setConfigDraft((prev) => ({ ...prev, placement: next }))}
                        onSeasonPresetChange={(overlayPresetId) => setConfigDraft((prev) => ({ ...prev, overlayPresetId }))}
                        onEpisodePresetChange={(episodeOverlayPresetId) => setConfigDraft((prev) => ({ ...prev, episodeOverlayPresetId }))}
                        onRecentlyPresetChange={(recentlyAddedPresetId) => setConfigDraft((prev) => ({ ...prev, recentlyAddedPresetId }))}
                        onSave={() => void savePlacement()}
                        onResetKind={resetPlacementKind}
                    />
                    </div>
                    <DashboardPanel title={t('overlays.gallery.title')} subtitle={t('overlays.gallery.subtitle')}>
                    <div className="mb-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={busy !== null || galleryLoading}
                            onClick={() => void loadGallery({ bust: true }).catch((error) => {
                                setGallery([]);
                                toast(error instanceof Error ? error.message : t('overlays.gallery.loadFailed'), 'error');
                            })}
                        >
                            <RefreshCw className={`h-4 w-4 ${galleryLoading ? 'animate-spin' : ''}`} />
                            {t('overlays.actions.refresh')}
                        </button>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={busy !== null || jobRunning || !workerReady}
                            onClick={() => startBackgroundJob('preview', () => overlaysApi.preview({ bundle: 'core' }))}
                        >
                            {t('overlays.actions.preview')}
                        </button>
                    </div>
                    {gallery.length === 0 ? (
                        <p className="text-sm text-muted">{t('overlays.gallery.empty')}</p>
                    ) : (
                        <div className="space-y-6">
                            {([
                                {
                                    id: 'show' as const,
                                    title: t('overlays.gallery.rows.posters'),
                                    aspect: 'aspect-[2/3]',
                                    grid: 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
                                },
                                {
                                    id: 'season' as const,
                                    title: t('overlays.gallery.rows.seasons'),
                                    aspect: 'aspect-[2/3]',
                                    grid: 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
                                },
                                {
                                    id: 'episode' as const,
                                    title: t('overlays.gallery.rows.episodes'),
                                    aspect: 'aspect-video',
                                    grid: 'grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
                                },
                            ]).map((row) => {
                                const items = gallery.filter((item) => item.kind === row.id);
                                if (items.length === 0) return null;
                                return (
                                    <section key={row.id} className="space-y-2">
                                        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                                            {row.title}
                                            <span className="ml-2 font-semibold normal-case tracking-normal text-muted/70">
                                                ({items.length})
                                            </span>
                                        </h3>
                                        <div className={row.grid}>
                                            {items.map((item) => {
                                                const src = `${item.url}${item.url.includes('?') ? '&' : '?'}t=${item.mtime}&b=${galleryBust}`;
                                                return (
                                                <figure key={`${item.rel || item.url}:${galleryBust}`} className="space-y-1">
                                                    <div className={`relative overflow-hidden rounded-md border border-border bg-background/60 ${row.aspect}`}>
                                                        <GalleryPreviewImage
                                                            src={src}
                                                            alt={item.name}
                                                            className="h-full w-full object-cover"
                                                            failedLabel={t('overlays.gallery.loadFailed')}
                                                        />
                                                    </div>
                                                    <figcaption className="truncate text-[11px] text-muted" title={item.name}>
                                                        {item.name}
                                                    </figcaption>
                                                </figure>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    )}
                </DashboardPanel>
                </div>
            )}

            {tab === 'activity' && (
                <DashboardPanel title={t('overlays.activity.title')} subtitle={t('overlays.activity.subtitle')}>
                    {status?.running && (
                        <p className="mb-3 inline-flex items-center gap-2 text-sm text-plex">
                            <Loader2 className="h-4 w-4 animate-spin" /> {t('overlays.activity.running', { command: runningCommandLabel })}
                        </p>
                    )}
                    {Array.isArray(status?.queue) && status.queue.length > 0 ? (
                        <div className="mb-4 rounded-lg border border-white/10 bg-black/25 p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold">
                                    {t('overlays.activity.queueTitle', { count: status.queue.length })}
                                </p>
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null}
                                    onClick={() => void runAction('stop', () => overlaysApi.clearQueue(), { skipRefresh: false })}
                                >
                                    {t('overlays.activity.clearQueue')}
                                </button>
                            </div>
                            <p className="mt-1 text-[11px] text-muted">{t('overlays.activity.queueHint')}</p>
                            <ul className="mt-2 space-y-1">
                                {status.queue.map((job: { id: string; command?: string; position?: number }) => (
                                    <li key={job.id} className="flex items-center justify-between gap-2 text-xs">
                                        <span className="font-mono text-text/85">
                                            #{job.position ?? '?'} · {String(job.command || '—')}
                                        </span>
                                        <button
                                            type="button"
                                            className={ghostButtonClass}
                                            disabled={busy !== null}
                                            onClick={() => void runAction('stop', () => overlaysApi.cancelQueuedJob(job.id))}
                                        >
                                            {t('overlays.activity.removeQueued')}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {!status?.running && parsedSummary && summaryDetail ? (
                        <div className="mb-4 rounded-lg border border-white/10 bg-black/25 p-3 text-sm">
                            <p className="font-semibold">{t('overlays.home.lastRunTitle')}</p>
                            <p className="mt-1 text-muted">
                                {t('overlays.summary.lastRunBody', {
                                    command: String(summary?.command || '—'),
                                    detail: summaryDetail,
                                    preview: '',
                                })}
                            </p>
                        </div>
                    ) : null}
                    {activity.length === 0 ? (
                        <p className="text-sm text-muted">{t('overlays.activity.empty')}</p>
                    ) : (
                        <ul className="max-h-[480px] space-y-1 overflow-y-auto font-mono text-xs">
                            {activity.map((entry: any, index: number) => (
                                <li key={`${entry.at}-${index}`} className={entry.level === 'error' ? 'text-red-300' : 'text-text/80'}>
                                    <span className="text-muted">{new Date(entry.at).toLocaleTimeString()}</span>
                                    {' '}
                                    {entry.message}
                                </li>
                            ))}
                        </ul>
                    )}
                </DashboardPanel>
            )}

            {status?.lastError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="text-sm">{status.lastError}</span>
                </div>
            )}

            {configDraft.enabled !== false && workerReady && (
                <p className="inline-flex items-center gap-2 text-xs text-muted">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                    {t('overlays.footer.workerReadyBeforePath')} <code>config/overlays/</code>
                </p>
            )}
        </DashboardPageShell>
    );
};

export default OverlaysDashboard;
