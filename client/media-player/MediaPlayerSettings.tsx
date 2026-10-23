import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Loader2, Save } from 'lucide-react';
import { CustomSelect, discoveryTheme, MediaPlayerBetaBanner, SettingsToggleRow, StickySaveBar, useDiscoverI18n } from './host';
import { fetchMediaPlayerHomeHeroConfig, fetchMediaPlayerLibraries, fetchMediaPlayerServers, saveMediaPlayerHomeHeroConfig, saveMediaPlayerServers } from './api';
import { clearHeroSlidesCache, notifyPlayerServersChanged, PLAYER_SERVERS_EVENT } from './playerMemory';
import {
    PLAYER_AUDIO_LANGUAGES,
    PLAYER_QUALITY_CHOICES,
    PLAYER_SCREENSAVER_SOURCE_LABEL_KEYS,
    PLAYER_SCREENSAVER_SOURCES,
    applyHomeRowOrder,
    applyLibraryNavOrder,
    defaultHomeRowIds,
    moveHomeRow,
    type PlayerContinueWatchingSort,
    type PlayerScreensaverSource,
    type PlayerSubtitleMode,
} from './playerSettings';
import { usePlayerSettings } from './usePlayerSettings';
import type { PlayerSection } from './types';
import {
    isPlexClientApp,
    normalizePortalBaseUrl,
    readStoredPortalBaseUrl,
    readStoredWtRelayUrl,
    writeStoredPortalBaseUrl,
    writeStoredWtRelayUrl,
} from '../plex-client/config';
import { PLAYER_APP_BASE, PLAYER_NAVIGATE_EVENT } from './paths';
import { isWatchTogetherAvailable } from './watchTogetherClient';

type Props = {
    onBack: () => void;
    isAdmin?: boolean;
};

const sectionClass = 'w-full overflow-hidden rounded-2xl border border-border bg-card';

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

const readAppVersion = (): string => {
    try {
        const fromWindow = String(window.__PLEX_CLIENT__?.appVersion || '').trim();
        if (fromWindow) return fromWindow;
    } catch {
        /* ignore */
    }
    try {
        return String(process.env.PLEX_CLIENT_APP_VERSION || '').trim();
    } catch {
        return '';
    }
};

const tvRowClass = 'flex w-full items-center justify-between gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-left outline-none';

type TvToggleRowProps = {
    title: string;
    description?: string;
    checked: boolean;
    onChange: (next: boolean) => void;
};

const TvToggleRow: React.FC<TvToggleRowProps> = ({ title, description, checked, onChange }) => {
    const { t } = useDiscoverI18n();
    return (
        <button
            type="button"
            data-tv-item="1"
            data-tv-action="1"
            data-tv-row="1"
            onClick={() => onChange(!checked)}
            className={tvRowClass}
        >
            <span className="min-w-0">
                <span className="block text-base font-bold text-text">{title}</span>
                {description ? <span className="mt-1 block text-sm leading-snug text-muted">{description}</span> : null}
            </span>
            <span className={`shrink-0 text-base font-black ${checked ? 'text-plex' : 'text-muted'}`}>
                {checked ? t('mediaPlayerPage.settingsOn') : t('mediaPlayerPage.settingsOff')}
            </span>
        </button>
    );
};

type TvChoice = { value: string; label: string };

type TvChoiceRowProps = {
    title: string;
    description?: string;
    value: string;
    options: TvChoice[];
    onChange: (value: string) => void;
};

const TvChoiceRow: React.FC<TvChoiceRowProps> = ({ title, description, value, options, onChange }) => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const selected = options.find((row) => row.value === value) || options[0];

    const closePicker = useCallback(() => {
        setOpen(false);
        try {
            delete document.documentElement.dataset.tvMenuOpen;
        } catch {
            /* ignore */
        }
        // Portal unmount drops focus to body; put it back on the settings row.
        window.requestAnimationFrame(() => {
            triggerRef.current?.focus({ preventScroll: true });
        });
    }, []);

    const openPicker = useCallback(() => {
        setOpen(true);
        try {
            document.documentElement.dataset.tvMenuOpen = '1';
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const id = window.setTimeout(() => {
            const sheet = document.querySelector('[data-tv-settings-choice="1"]');
            const target = sheet?.querySelector<HTMLElement>('[data-tv-settings-primary="1"]')
                || sheet?.querySelector<HTMLElement>('[data-tv-item="1"]');
            target?.focus({ preventScroll: true });
            const scroller = sheet?.querySelector<HTMLElement>('[data-tv-overlay-scroll="1"]');
            if (scroller) scroller.scrollTop = 0;
        }, 30);
        const close = () => closePicker();
        window.addEventListener('smp-tv-overlay-close', close);
        return () => {
            window.clearTimeout(id);
            window.removeEventListener('smp-tv-overlay-close', close);
        };
    }, [open, closePicker]);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                data-tv-item="1"
                data-tv-action="1"
                data-tv-row="1"
                onClick={openPicker}
                className={tvRowClass}
            >
                <span className="min-w-0">
                    <span className="block text-base font-bold text-text">{title}</span>
                    {description ? <span className="mt-1 block text-sm leading-snug text-muted">{description}</span> : null}
                </span>
                <span className="shrink-0 text-base font-bold text-white/85">{selected?.label || '—'}</span>
            </button>
            {open && typeof document !== 'undefined' ? createPortal(
                <div
                    className="fixed inset-0 z-[3500] flex justify-end bg-black/35"
                    data-tv-context-backdrop="1"
                    data-tv-settings-dialog="1"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) closePicker();
                    }}
                >
                    <div
                        role="menu"
                        aria-label={title}
                        data-tv-item-menu="1"
                        data-tv-context-sheet="1"
                        data-tv-settings-choice="1"
                        className="player-context-sheet flex max-h-full w-[min(30rem,48vw)] min-w-[22rem] flex-col overflow-hidden outline-none"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="shrink-0 px-1 pb-3 pt-1">
                            <h2 className="truncate text-[1.35rem] font-bold leading-tight tracking-tight text-white">
                                {title}
                            </h2>
                            {description ? (
                                <p className="mt-1.5 text-sm leading-snug text-white/50">{description}</p>
                            ) : null}
                        </div>
                        <div
                            className="min-h-0 flex-1 overflow-y-auto overscroll-contain hide-scrollbar"
                            data-tv-overlay-scroll="1"
                        >
                            {options.map((row) => {
                                const isSelected = row.value === value;
                                return (
                                    <button
                                        key={row.value}
                                        type="button"
                                        role="menuitem"
                                        className={`flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-[1.02rem] font-semibold tracking-tight outline-none ${
                                            isSelected ? 'text-white' : 'text-white/90'
                                        }`}
                                        data-tv-item="1"
                                        data-tv-menu-item="1"
                                        data-tv-action="1"
                                        data-tv-settings-primary={isSelected ? '1' : undefined}
                                        aria-checked={isSelected}
                                        onClick={() => {
                                            onChange(row.value);
                                            closePicker();
                                        }}
                                    >
                                        <span className="min-w-0 truncate">{row.label}</span>
                                        {isSelected ? (
                                            <Check className="h-5 w-5 shrink-0" strokeWidth={2.75} aria-hidden />
                                        ) : (
                                            <span className="h-5 w-5 shrink-0" aria-hidden />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>,
                document.body,
            ) : null}
        </>
    );
};

type TvReorderItem = { id: string; label: string };

const TvReorderList: React.FC<{
    title: string;
    description?: string;
    items: TvReorderItem[];
    onMove: (index: number, delta: -1 | 1) => void;
    onReset?: () => void;
    resetLabel?: string;
}> = ({ title, description, items, onMove, onReset, resetLabel }) => {
    const { t } = useDiscoverI18n();
    if (!items.length) return null;
    return (
        <section className="flex flex-col gap-3" data-tv-row="1">
            <div className="flex items-start justify-between gap-3 px-1">
                <div className="min-w-0">
                    <h2 className="text-xs font-black uppercase tracking-widest text-muted">{title}</h2>
                    {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
                </div>
                {onReset ? (
                    <button
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        onClick={onReset}
                        className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-muted outline-none"
                    >
                        {resetLabel || t('mediaPlayerPage.homeRowReset')}
                    </button>
                ) : null}
            </div>
            <div className="flex flex-col gap-2">
                {items.map((item, index) => (
                    <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                    >
                        <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-muted">
                            {index + 1}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-base font-bold text-text">{item.label}</p>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            disabled={index === 0}
                            onClick={() => onMove(index, -1)}
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-muted outline-none disabled:opacity-30"
                            aria-label={t('mediaPlayerPage.homeRowMoveUp')}
                        >
                            <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            disabled={index === items.length - 1}
                            onClick={() => onMove(index, 1)}
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-muted outline-none disabled:opacity-30"
                            aria-label={t('mediaPlayerPage.homeRowMoveDown')}
                        >
                            <ChevronDown className="h-4 w-4" />
                        </button>
                    </div>
                ))}
            </div>
        </section>
    );
};

type SettingsTabId = 'home' | 'player' | 'titles' | 'servers' | 'connection';

const SettingsTabBar: React.FC<{
    tabs: Array<{ id: SettingsTabId; label: string }>;
    value: SettingsTabId;
    onChange: (id: SettingsTabId) => void;
    tv: boolean;
}> = ({ tabs, value, onChange, tv }) => (
    <div
        className="flex flex-wrap gap-2"
        role="tablist"
        data-tv-settings-tabs={tv ? '1' : undefined}
        data-tv-row={tv ? '1' : undefined}
    >
        {tabs.map((row) => {
            const selected = value === row.id;
            return (
                <button
                    key={row.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-current={selected ? 'page' : undefined}
                    data-tv-item={tv ? '1' : undefined}
                    data-tv-action={tv ? '1' : undefined}
                    data-tv-key={tv ? `settings-tab-${row.id}` : undefined}
                    onClick={() => onChange(row.id)}
                    onFocus={() => { if (tv) onChange(row.id); }}
                    className={`rounded-lg border px-4 py-2 text-sm font-bold outline-none ${
                        selected
                            ? 'border-plex/50 bg-plex/15 text-plex'
                            : 'border-border bg-white/5 text-muted hover:text-text'
                    }`}
                >
                    {row.label}
                </button>
            );
        })}
    </div>
);

const HERO_MODE_VALUES = [
    'off',
    'trending_week',
    'continue_watching',
    'seasonal_halloween',
    'seasonal_christmas',
    'seasonal_nye',
    'seasonal_easter',
    'seasonal_thanksgiving',
    'recently_added',
    'most_watched',
    'unwatched_picks',
    'new_releases',
    'random_spotlight',
] as const;

type HeroMode = typeof HERO_MODE_VALUES[number];

export const MediaPlayerSettings: React.FC<Props> = ({ onBack, isAdmin = false }) => {
    const { t } = useDiscoverI18n();
    const tvShell = isTvShell();
    const [appVersion, setAppVersion] = useState(readAppVersion);
    const canEditHero = isAdmin || (typeof window !== 'undefined' && Boolean(window.__PLEX_CLIENT__));
    const [settings, updateSettings, { dirty: playerDirty, saving: playerSaving, saveSettings, discardSettings }] = usePlayerSettings();
    const [libraries, setLibraries] = useState<PlayerSection[]>([]);
    const [servers, setServers] = useState<Array<{ id: string; name: string; enabled: boolean }>>([]);
    const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
    const [settingsTab, setSettingsTab] = useState<SettingsTabId>('home');
    const showPortalUrlField = isPlexClientApp();
    const showWtRelayField = isPlexClientApp();
    const showConnectionTab = showPortalUrlField || showWtRelayField || isWatchTogetherAvailable();
    const [portalUrlDraft, setPortalUrlDraft] = useState(() => readStoredPortalBaseUrl());
    const [portalUrlBaseline, setPortalUrlBaseline] = useState(() => readStoredPortalBaseUrl());
    const [portalError, setPortalError] = useState('');
    const [wtRelayDraft, setWtRelayDraft] = useState(() => readStoredWtRelayUrl());
    const [wtRelayBaseline, setWtRelayBaseline] = useState(() => readStoredWtRelayUrl());
    const [wtRelayError, setWtRelayError] = useState('');
    const [heroMode, setHeroMode] = useState<HeroMode>('trending_week');
    const [heroSeasonalOnly, setHeroSeasonalOnly] = useState(false);
    const [cwSeasonPoster, setCwSeasonPoster] = useState(false);
    const [heroBaseline, setHeroBaseline] = useState<{
        mode: HeroMode;
        seasonalInWindowOnly: boolean;
        continueWatchingSeasonPoster: boolean;
    } | null>(null);
    const [heroSaving, setHeroSaving] = useState(false);
    const qualityOptions = [
        { id: 'auto', label: t('mediaPlayerPage.qualityAuto') },
        { id: 'original', label: t('mediaPlayerPage.qualityOriginal') },
        ...PLAYER_QUALITY_CHOICES.filter((row) => row.id !== 'original').map((row) => ({ id: row.id, label: row.label })),
    ];
    const subtitleOptions: Array<{ id: PlayerSubtitleMode; label: string }> = [
        { id: 'off', label: t('mediaPlayerPage.subtitleModeOff') },
        { id: 'forced', label: t('mediaPlayerPage.subtitleModeForced') },
        { id: 'always', label: t('mediaPlayerPage.subtitleModeAlways') },
    ];
    const heroModeOptions = useMemo(() => ([
        { value: 'off', label: t('mediaPlayerPage.homeHeroModeOff') },
        { value: 'trending_week', label: t('mediaPlayerPage.homeHeroModeTrending') },
        { value: 'continue_watching', label: t('mediaPlayerPage.homeHeroModeContinueWatching') },
        { value: 'seasonal_halloween', label: t('mediaPlayerPage.homeHeroModeHalloween') },
        { value: 'seasonal_christmas', label: t('mediaPlayerPage.homeHeroModeChristmas') },
        { value: 'seasonal_nye', label: t('mediaPlayerPage.homeHeroModeNye') },
        { value: 'seasonal_easter', label: t('mediaPlayerPage.homeHeroModeEaster') },
        { value: 'seasonal_thanksgiving', label: t('mediaPlayerPage.homeHeroModeThanksgiving') },
        { value: 'recently_added', label: t('mediaPlayerPage.homeHeroModeRecentlyAdded') },
        { value: 'most_watched', label: t('mediaPlayerPage.homeHeroModeMostWatched') },
        { value: 'unwatched_picks', label: t('mediaPlayerPage.homeHeroModeUnwatchedPicks') },
        { value: 'new_releases', label: t('mediaPlayerPage.homeHeroModeNewReleases') },
        { value: 'random_spotlight', label: t('mediaPlayerPage.homeHeroModeRandomSpotlight') },
    ]), [t]);

    useEffect(() => {
        let cancelled = false;
        fetchMediaPlayerLibraries()
            .then((data) => {
                if (!cancelled && !data.stale) setLibraries(data.libraries || []);
            })
            .catch(() => {
                if (!cancelled) setLibraries([]);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const refresh = () => {
            void fetchMediaPlayerLibraries()
                .then((data) => {
                    if (!data.stale) setLibraries(data.libraries || []);
                })
                .catch(() => undefined);
        };
        window.addEventListener(PLAYER_SERVERS_EVENT, refresh);
        return () => window.removeEventListener(PLAYER_SERVERS_EVENT, refresh);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.__PLEX_CLIENT__) return undefined;
        let cancelled = false;
        fetchMediaPlayerServers()
            .then((data) => {
                if (!cancelled) setServers(Array.isArray(data?.servers) ? data.servers : []);
            })
            .catch(() => {
                if (!cancelled) setServers([]);
            });
        return () => { cancelled = true; };
    }, []);

    const toggleServer = async (id: string) => {
        const next = servers.map((server) => (
            server.id === id ? { ...server, enabled: !server.enabled } : server
        ));
        if (!next.some((server) => server.enabled)) return;
        const enabledIds = new Set(next.filter((server) => server.enabled).map((server) => server.id));
        setServers(next);
        const previousLibraries = libraries;
        setLibraries((current) => current.filter((library) => {
            const key = String(library.key || '');
            const cut = key.indexOf('::');
            if (cut <= 0) return true;
            return enabledIds.has(key.slice(0, cut));
        }));
        const saved = await saveMediaPlayerServers(next.filter((server) => server.enabled).map((server) => server.id)).catch(() => null);
        if (saved?.servers) {
            setServers(saved.servers);
            notifyPlayerServersChanged();
        } else {
            setServers(servers);
            setLibraries(previousLibraries);
        }
    };

    const serverSettings = servers.length > 1 ? (
        <div className="mb-4 space-y-2">
            <h2 className="text-xs font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.plexServers')}</h2>
            <p className="text-sm text-muted">{t('mediaPlayerPage.plexServersHint')}</p>
            {servers.map((server) => (
                tvShell ? (
                    <TvToggleRow
                        key={server.id}
                        title={server.name}
                        checked={server.enabled}
                        onChange={() => { void toggleServer(server.id); }}
                    />
                ) : (
                    <SettingsToggleRow
                        key={server.id}
                        title={server.name}
                        checked={server.enabled}
                        onChange={() => { void toggleServer(server.id); }}
                    />
                )
            ))}
        </div>
    ) : null;

    useEffect(() => {
        if (!canEditHero) return undefined;
        let cancelled = false;
        fetchMediaPlayerHomeHeroConfig()
            .then((data) => {
                if (cancelled) return;
                const mode = HERO_MODE_VALUES.includes(data?.mode as HeroMode)
                    ? (data.mode as HeroMode)
                    : 'trending_week';
                const seasonalInWindowOnly = data?.seasonalInWindowOnly === true;
                const continueWatchingSeasonPoster = data?.continueWatchingSeasonPoster === true;
                setHeroMode(mode);
                setHeroSeasonalOnly(seasonalInWindowOnly);
                setCwSeasonPoster(continueWatchingSeasonPoster);
                setHeroBaseline({ mode, seasonalInWindowOnly, continueWatchingSeasonPoster });
            })
            .catch(() => {
                if (!cancelled) setHeroBaseline(null);
            });
        return () => { cancelled = true; };
    }, [canEditHero]);

    const rowLabels = useMemo(() => ({
        continueWatching: t('mediaPlayerPage.continueWatching'),
        recents: t('mediaPlayerPage.recents'),
    }), [t]);
    const continueWatchingSortOptions = useMemo(() => ([
        { value: 'releaseDate', label: t('mediaPlayerPage.continueWatchingSortReleaseDate') },
        { value: 'plex', label: t('mediaPlayerPage.continueWatchingSortPlex') },
        { value: 'recentlyWatched', label: t('mediaPlayerPage.continueWatchingSortRecentlyWatched') },
        { value: 'title', label: t('mediaPlayerPage.continueWatchingSortTitle') },
    ]), [t]);
    const screensaverSourceOptions = useMemo(() => (
        PLAYER_SCREENSAVER_SOURCES.map((value) => ({
            value,
            label: t(PLAYER_SCREENSAVER_SOURCE_LABEL_KEYS[value]),
        }))
    ), [t]);

    const orderedRowIds = applyHomeRowOrder(defaultHomeRowIds(), settings.homeRowOrder);
    const orderedLibraries = applyLibraryNavOrder(libraries, settings.libraryNavOrder);

    const hiddenRows = new Set<string>();
    if (!settings.showContinueWatching) hiddenRows.add('continueWatching');

    const settingsTabs = useMemo(() => {
        const rows: Array<{ id: SettingsTabId; label: string }> = [
            { id: 'home', label: t('mediaPlayerPage.settingsTabHome') },
            { id: 'player', label: t('mediaPlayerPage.settingsTabPlayer') },
            { id: 'titles', label: t('mediaPlayerPage.settingsTabTitles') },
        ];
        if (servers.length > 1) rows.push({ id: 'servers', label: t('mediaPlayerPage.settingsTabServers') });
        if (showConnectionTab) rows.push({ id: 'connection', label: t('mediaPlayerPage.settingsTabConnection') });
        return rows;
    }, [servers.length, showConnectionTab, t]);

    useEffect(() => {
        if (settingsTab === 'servers' && servers.length < 2) setSettingsTab('home');
        if (settingsTab === 'connection' && !showConnectionTab) setSettingsTab('home');
    }, [servers.length, settingsTab, showConnectionTab]);

    const heroDirty = !!heroBaseline && (
        heroMode !== heroBaseline.mode
        || heroSeasonalOnly !== heroBaseline.seasonalInWindowOnly
        || cwSeasonPoster !== heroBaseline.continueWatchingSeasonPoster
    );
    const portalDirty = showPortalUrlField
        && String(portalUrlDraft || '').trim().replace(/\/+$/, '') !== String(portalUrlBaseline || '').trim().replace(/\/+$/, '');
    const wtRelayDirty = showWtRelayField
        && String(wtRelayDraft || '').trim().replace(/\/+$/, '') !== String(wtRelayBaseline || '').trim().replace(/\/+$/, '');
    const dirty = playerDirty || heroDirty || portalDirty || wtRelayDirty;
    const saving = playerSaving || heroSaving;

    useEffect(() => {
        if (dirty) setSaveState('idle');
    }, [dirty]);

    useEffect(() => {
        const sync = () => {
            const next = readAppVersion();
            setAppVersion((prev) => (prev === next ? prev : next));
        };
        sync();
        const id = window.setInterval(sync, 400);
        const stop = window.setTimeout(() => window.clearInterval(id), 3000);
        return () => {
            window.clearInterval(id);
            window.clearTimeout(stop);
        };
    }, []);

    const discardAll = () => {
        discardSettings();
        if (heroBaseline) {
            setHeroMode(heroBaseline.mode);
            setHeroSeasonalOnly(heroBaseline.seasonalInWindowOnly);
            setCwSeasonPoster(heroBaseline.continueWatchingSeasonPoster);
        }
        if (showPortalUrlField) {
            setPortalUrlDraft(portalUrlBaseline);
            setPortalError('');
        }
        if (showWtRelayField) {
            setWtRelayDraft(wtRelayBaseline);
            setWtRelayError('');
        }
    };

    const persistPortalUrl = (): boolean => {
        if (!showPortalUrlField || !portalDirty) return true;
        const raw = String(portalUrlDraft || '').trim();
        if (!raw) {
            writeStoredPortalBaseUrl('');
            setPortalUrlBaseline('');
            setPortalUrlDraft('');
            setPortalError('');
            return true;
        }
        const normalized = normalizePortalBaseUrl(raw);
        if (!normalized.ok) {
            setPortalError(normalized.error || t('mediaPlayerPage.settingsPortalUrlInvalid'));
            return false;
        }
        writeStoredPortalBaseUrl(normalized.url);
        setPortalUrlBaseline(normalized.url);
        setPortalUrlDraft(normalized.url);
        setPortalError('');
        return true;
    };

    const persistWtRelayUrl = (): boolean => {
        if (!showWtRelayField || !wtRelayDirty) return true;
        const raw = String(wtRelayDraft || '').trim();
        if (!raw) {
            writeStoredWtRelayUrl('');
            setWtRelayBaseline('');
            setWtRelayDraft('');
            setWtRelayError('');
            return true;
        }
        const normalized = normalizePortalBaseUrl(raw);
        if (!normalized.ok) {
            setWtRelayError(normalized.error || t('mediaPlayerPage.settingsWtRelayUrlInvalid'));
            return false;
        }
        writeStoredWtRelayUrl(normalized.url);
        setWtRelayBaseline(normalized.url);
        setWtRelayDraft(normalized.url);
        setWtRelayError('');
        return true;
    };

    const handleSave = async () => {
        try {
            if (!persistWtRelayUrl() || !persistPortalUrl()) {
                setSaveState('error');
                return;
            }
            if (playerDirty) await saveSettings();
            if (heroDirty && canEditHero) {
                setHeroSaving(true);
                const saved = await saveMediaPlayerHomeHeroConfig({
                    mode: heroMode,
                    seasonalInWindowOnly: heroSeasonalOnly,
                    continueWatchingSeasonPoster: cwSeasonPoster,
                });
                const mode = HERO_MODE_VALUES.includes(saved?.mode as HeroMode)
                    ? (saved.mode as HeroMode)
                    : heroMode;
                const seasonalInWindowOnly = saved?.seasonalInWindowOnly === true;
                const continueWatchingSeasonPoster = saved?.continueWatchingSeasonPoster === true;
                setHeroMode(mode);
                setHeroSeasonalOnly(seasonalInWindowOnly);
                setCwSeasonPoster(continueWatchingSeasonPoster);
                setHeroBaseline({ mode, seasonalInWindowOnly, continueWatchingSeasonPoster });
                clearHeroSlidesCache();
            }
            setSaveState('saved');
        } catch {
            setSaveState('error');
        } finally {
            setHeroSaving(false);
        }
    };

    const connectionSettings = showConnectionTab ? (
        <section className={tvShell ? 'flex flex-col gap-3' : sectionClass}>
            {!tvShell ? (
                <div className="border-b border-border px-5 py-4 sm:px-6">
                    <h2 className="text-sm font-black uppercase tracking-widest text-muted">
                        {t('mediaPlayerPage.settingsConnection')}
                    </h2>
                    <p className="mt-1 text-xs text-muted">
                        {showWtRelayField
                            ? t('mediaPlayerPage.settingsWtRelayUrlHint')
                            : t('mediaPlayerPage.settingsWatchTogetherJoinHint')}
                    </p>
                </div>
            ) : (
                <p className="text-sm text-muted">
                    {showWtRelayField
                        ? t('mediaPlayerPage.settingsWtRelayUrlHint')
                        : t('mediaPlayerPage.settingsWatchTogetherJoinHint')}
                </p>
            )}
            <div className={tvShell ? 'flex flex-col gap-3' : 'px-5 py-4 sm:px-6'}>
                {showWtRelayField ? (
                    <>
                        <label className="block space-y-2">
                            <span className={`block font-bold text-text ${tvShell ? 'text-base' : 'text-sm'}`}>
                                {t('mediaPlayerPage.settingsWtRelayUrl')}
                            </span>
                            <input
                                data-tv-item="1"
                                data-tv-action="1"
                                data-tv-key="settings-wt-relay-url"
                                tabIndex={0}
                                className={
                                    tvShell
                                        ? 'w-full rounded-2xl border border-white/15 bg-black/40 px-5 py-4 text-base text-white outline-none focus:border-plex/70'
                                        : 'w-full max-w-xl rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-text outline-none focus:border-plex/60'
                                }
                                value={wtRelayDraft}
                                onChange={(e) => {
                                    setWtRelayDraft(e.target.value);
                                    setWtRelayError('');
                                    setSaveState('idle');
                                }}
                                placeholder={t('mediaPlayerPage.settingsWtRelayUrlPlaceholder')}
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                inputMode="url"
                                autoComplete="url"
                            />
                        </label>
                        {wtRelayError ? (
                            <p className={`font-bold text-red-400 ${tvShell ? 'text-sm' : 'text-xs'}`}>{wtRelayError}</p>
                        ) : wtRelayBaseline ? (
                            <p className={`text-muted ${tvShell ? 'text-sm' : 'text-xs'}`}>
                                {t('mediaPlayerPage.settingsWtRelayUrlSaved')}
                            </p>
                        ) : null}
                        {wtRelayDraft || wtRelayBaseline ? (
                            <button
                                type="button"
                                data-tv-item="1"
                                data-tv-action="1"
                                data-tv-key="settings-wt-relay-url-clear"
                                onClick={() => {
                                    setWtRelayDraft('');
                                    setWtRelayError('');
                                    setSaveState('idle');
                                }}
                                className={
                                    tvShell
                                        ? `${tvRowClass} justify-center text-base font-bold text-muted`
                                        : 'text-xs font-bold text-muted hover:text-text'
                                }
                            >
                                {t('mediaPlayerPage.settingsWtRelayUrlClear')}
                            </button>
                        ) : null}
                    </>
                ) : null}
                {showPortalUrlField ? (
                    <>
                        <label className={`block space-y-2 ${showWtRelayField ? (tvShell ? 'mt-2' : 'mt-4') : ''}`}>
                            <span className={`block font-bold text-text ${tvShell ? 'text-base' : 'text-sm'}`}>
                                {t('mediaPlayerPage.settingsPortalUrl')}
                            </span>
                            <input
                                data-tv-item="1"
                                data-tv-action="1"
                                data-tv-key="settings-portal-url"
                                tabIndex={0}
                                className={
                                    tvShell
                                        ? 'w-full rounded-2xl border border-white/15 bg-black/40 px-5 py-4 text-base text-white outline-none focus:border-plex/70'
                                        : 'w-full max-w-xl rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-text outline-none focus:border-plex/60'
                                }
                                value={portalUrlDraft}
                                onChange={(e) => {
                                    setPortalUrlDraft(e.target.value);
                                    setPortalError('');
                                    setSaveState('idle');
                                }}
                                placeholder={t('mediaPlayerPage.settingsPortalUrlPlaceholder')}
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                inputMode="url"
                                autoComplete="url"
                            />
                        </label>
                        {portalError ? (
                            <p className={`font-bold text-red-400 ${tvShell ? 'text-sm' : 'text-xs'}`}>{portalError}</p>
                        ) : portalUrlBaseline ? (
                            <p className={`text-muted ${tvShell ? 'text-sm' : 'text-xs'}`}>
                                {t('mediaPlayerPage.settingsPortalUrlSaved')}
                            </p>
                        ) : (
                            <p className={`text-muted ${tvShell ? 'text-sm' : 'text-xs'}`}>
                                {t('mediaPlayerPage.settingsPortalUrlOptionalHint')}
                            </p>
                        )}
                        {portalUrlDraft || portalUrlBaseline ? (
                            <button
                                type="button"
                                data-tv-item="1"
                                data-tv-action="1"
                                data-tv-key="settings-portal-url-clear"
                                onClick={() => {
                                    setPortalUrlDraft('');
                                    setPortalError('');
                                    setSaveState('idle');
                                }}
                                className={
                                    tvShell
                                        ? `${tvRowClass} justify-center text-base font-bold text-muted`
                                        : 'text-xs font-bold text-muted hover:text-text'
                                }
                            >
                                {t('mediaPlayerPage.settingsPortalUrlClear')}
                            </button>
                        ) : null}
                    </>
                ) : null}
                {isWatchTogetherAvailable() ? (
                    <div className={
                        (showWtRelayField || showPortalUrlField)
                            ? (tvShell ? 'mt-2 flex flex-col gap-2' : 'mt-4 border-t border-border/40 pt-4')
                            : 'flex flex-col gap-2'
                    }>
                        {(showWtRelayField || showPortalUrlField) ? (
                            <p className={`text-muted ${tvShell ? 'text-sm' : 'text-xs'}`}>
                                {t('mediaPlayerPage.settingsWatchTogetherJoinHint')}
                            </p>
                        ) : null}
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            data-tv-key="settings-watch-together-join"
                            onClick={() => {
                                try {
                                    window.history.pushState({}, '', `${PLAYER_APP_BASE}/watch-together/join`);
                                    window.dispatchEvent(new Event(PLAYER_NAVIGATE_EVENT));
                                } catch {
                                    /* ignore */
                                }
                            }}
                            className={
                                tvShell
                                    ? `${tvRowClass} justify-center text-base font-bold text-plex`
                                    : 'inline-flex items-center justify-center rounded-xl border border-plex/40 bg-plex/15 px-4 py-2.5 text-sm font-bold text-plex hover:bg-plex/25'
                            }
                        >
                            {t('mediaPlayerPage.settingsWatchTogetherJoin')}
                        </button>
                    </div>
                ) : null}
            </div>
        </section>
    ) : null;

    const saveLocked = !dirty || saving;
    const saveActions = (
        <div className="flex flex-col gap-3" data-tv-row="1" data-tv-settings-actions="1">
            {dirty ? (
                <p className="text-sm font-bold text-muted">{t('mediaPlayerPage.unsavedSettings')}</p>
            ) : saveState === 'saved' ? (
                <p className="text-sm font-bold text-muted">{t('mediaPlayerPage.settingsSaved')}</p>
            ) : saveState === 'error' ? (
                <p className="text-sm font-bold text-red-400">{t('mediaPlayerPage.settingsSaveError')}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    data-tv-item="1"
                    data-tv-action="1"
                    data-tv-settings-save="1"
                    onClick={() => { if (!saveLocked) void handleSave(); }}
                    aria-disabled={saveLocked}
                    className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-plex px-5 text-base font-bold text-white shadow-lg shadow-plex/20 outline-none hover:bg-plex-hover ${saveLocked ? 'opacity-50' : ''}`}
                >
                    {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
                    {t('mediaPlayerPage.saveSettings')}
                </button>
                <button
                    type="button"
                    data-tv-item="1"
                    data-tv-action="1"
                    onClick={() => { if (!saveLocked) discardAll(); }}
                    aria-disabled={saveLocked}
                    className={`inline-flex h-12 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 text-base font-bold text-text outline-none hover:bg-white/10 ${saveLocked ? 'opacity-40' : ''}`}
                >
                    {t('mediaPlayerPage.discardChanges')}
                </button>
            </div>
        </div>
    );

    const versionLabel = appVersion ? (
        <p className={tvShell ? 'mt-8 text-sm font-semibold text-muted/70' : 'px-1 text-xs font-bold text-muted/70'}>
            {t('mediaPlayerPage.appVersion', { version: appVersion })}
        </p>
    ) : null;

    if (tvShell) {
        return (
            <div className="flex w-full flex-col gap-8 pb-16" data-tv-settings="1">
                <div data-tv-page-top="1" className="h-0 w-full" aria-hidden />
                <div>
                    <p className={discoveryTheme.personalEyebrow}>{t('navigation.mediaPlayer')}</p>
                    <h1 className={discoveryTheme.heading}>{t('mediaPlayerPage.settings')}</h1>
                    <p className="mt-2 text-base text-muted">{t('mediaPlayerPage.settingsHintTv')}</p>
                </div>

                <SettingsTabBar tabs={settingsTabs} value={settingsTab} onChange={setSettingsTab} tv />

                <div className="flex flex-col gap-3" data-tv-settings-panel="1">
                {settingsTab === 'home' ? (
                <section className="flex flex-col gap-3">
                    <TvToggleRow
                        title={t('mediaPlayerPage.showContinueWatching')}
                        description={t('mediaPlayerPage.showContinueWatchingHint')}
                        checked={settings.showContinueWatching}
                        onChange={(checked) => updateSettings({ showContinueWatching: checked })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.continueWatchingSort')}
                        description={t('mediaPlayerPage.continueWatchingSortHint')}
                        value={settings.continueWatchingSort}
                        options={continueWatchingSortOptions}
                        onChange={(value) => updateSettings({
                            continueWatchingSort: value as PlayerContinueWatchingSort,
                        })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.showPlaylists')}
                        description={t('mediaPlayerPage.showPlaylistsHint')}
                        checked={settings.showPlaylists}
                        onChange={(checked) => updateSettings({ showPlaylists: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.showWatchlist')}
                        description={t('mediaPlayerPage.showWatchlistHint')}
                        checked={settings.showWatchlist}
                        onChange={(checked) => updateSettings({ showWatchlist: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.showBecauseYouWatched')}
                        description={t('mediaPlayerPage.showBecauseYouWatchedHint')}
                        checked={settings.showBecauseYouWatched}
                        onChange={(checked) => updateSettings({ showBecauseYouWatched: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.clock24Hour')}
                        description={t('mediaPlayerPage.clock24HourHint')}
                        checked={settings.clock24Hour}
                        onChange={(checked) => updateSettings({ clock24Hour: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.hideWatchedFromRecents')}
                        description={t('mediaPlayerPage.hideWatchedFromRecentsHint')}
                        checked={settings.hideWatchedFromRecents}
                        onChange={(checked) => updateSettings({ hideWatchedFromRecents: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.recentlyAddedSeasonPoster')}
                        description={t('mediaPlayerPage.recentlyAddedSeasonPosterHint')}
                        checked={settings.recentlyAddedSeasonPoster}
                        onChange={(checked) => updateSettings({ recentlyAddedSeasonPoster: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.reduceMotion')}
                        description={t('mediaPlayerPage.reduceMotionHint')}
                        checked={settings.reduceMotion}
                        onChange={(checked) => updateSettings({ reduceMotion: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.detailsArtworkTint')}
                        description={t('mediaPlayerPage.detailsArtworkTintHint')}
                        checked={settings.detailsArtworkTint}
                        onChange={(checked) => updateSettings({ detailsArtworkTint: checked })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.screensaverSource')}
                        description={t('mediaPlayerPage.screensaverSourceHint')}
                        value={settings.screensaverSource}
                        options={screensaverSourceOptions}
                        onChange={(value) => updateSettings({
                            screensaverSource: value as PlayerScreensaverSource,
                        })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.screensaverShiftClock')}
                        description={t('mediaPlayerPage.screensaverShiftClockHint')}
                        checked={settings.screensaverShiftClock}
                        onChange={(checked) => updateSettings({ screensaverShiftClock: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.continueWatchingSeasonPoster')}
                        description={t('mediaPlayerPage.continueWatchingSeasonPosterHint')}
                        checked={cwSeasonPoster}
                        onChange={setCwSeasonPoster}
                    />
                    {orderedLibraries.length ? (
                        <TvReorderList
                            title={t('mediaPlayerPage.libraryNavOrder')}
                            description={t('mediaPlayerPage.libraryNavOrderHint')}
                            items={orderedLibraries.map((library) => ({ id: library.key, label: library.title }))}
                            onMove={(index, delta) => updateSettings({
                                libraryNavOrder: moveHomeRow(orderedLibraries.map((row) => row.key), index, delta),
                            })}
                            onReset={settings.libraryNavOrder.length
                                ? () => updateSettings({ libraryNavOrder: [] })
                                : undefined}
                        />
                    ) : null}
                </section>
                ) : null}

                {settingsTab === 'player' ? (
                <section className="flex flex-col gap-3">
                    <TvToggleRow
                        title={t('mediaPlayerPage.autoplayNext')}
                        description={t('mediaPlayerPage.autoplayNextHint')}
                        checked={settings.autoplayNext}
                        onChange={(checked) => updateSettings({ autoplayNext: checked })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.stillWatchingAfter')}
                        description={t('mediaPlayerPage.stillWatchingAfterHint')}
                        value={String(settings.stillWatchingAfter)}
                        options={[
                            { value: '0', label: t('mediaPlayerPage.stillWatchingAfterOff') },
                            ...[2, 3, 4, 5, 6, 8, 10].map((count) => ({
                                value: String(count),
                                label: t('mediaPlayerPage.stillWatchingAfterN', { count }),
                            })),
                        ]}
                        onChange={(value) => updateSettings({ stillWatchingAfter: Number(value) || 0 })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.defaultQuality')}
                        description={t('mediaPlayerPage.defaultQualityHint')}
                        value={settings.defaultQualityId}
                        options={qualityOptions.map((row) => ({ value: row.id, label: row.label }))}
                        onChange={(value) => updateSettings({ defaultQualityId: value })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.audioLanguage')}
                        description={t('mediaPlayerPage.audioLanguageHint')}
                        value={settings.audioLanguage}
                        options={[
                            { value: '', label: t('mediaPlayerPage.audioLanguageDefault') },
                            ...PLAYER_AUDIO_LANGUAGES.map((row) => ({ value: row.id, label: row.label })),
                        ]}
                        onChange={(value) => updateSettings({ audioLanguage: value })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.subtitleMode')}
                        description={t('mediaPlayerPage.subtitleModeHint')}
                        value={settings.subtitleMode}
                        options={subtitleOptions.map((row) => ({ value: row.id, label: row.label }))}
                        onChange={(value) => updateSettings({ subtitleMode: value as PlayerSubtitleMode })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.subtitleSize')}
                        value={String(settings.subtitleSize)}
                        options={[50, 75, 100, 125, 150, 200].map((value) => ({ value: String(value), label: `${value}%` }))}
                        onChange={(value) => updateSettings({ subtitleSize: Number(value) })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.subtitleColor')}
                        value={settings.subtitleColor}
                        options={[
                            { value: '#ffffff', label: 'White' },
                            { value: '#ffe566', label: 'Yellow' },
                            { value: '#7dd3fc', label: 'Cyan' },
                        ]}
                        onChange={(value) => updateSettings({ subtitleColor: value })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.subtitleBackground')}
                        value={settings.subtitleBackground}
                        options={[
                            { value: 'none', label: t('mediaPlayerPage.subtitleBackgroundNone') },
                            { value: 'dim', label: t('mediaPlayerPage.subtitleBackgroundDim') },
                            { value: 'solid', label: t('mediaPlayerPage.subtitleBackgroundSolid') },
                        ]}
                        onChange={(value) => updateSettings({ subtitleBackground: value as typeof settings.subtitleBackground })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.subtitlePosition')}
                        value={settings.subtitlePosition}
                        options={[
                            { value: 'bottom', label: t('mediaPlayerPage.subtitlePositionBottom') },
                            { value: 'middle', label: t('mediaPlayerPage.subtitlePositionMiddle') },
                            { value: 'top', label: t('mediaPlayerPage.subtitlePositionTop') },
                        ]}
                        onChange={(value) => updateSettings({ subtitlePosition: value as typeof settings.subtitlePosition })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.nightMode')}
                        description={t('mediaPlayerPage.nightModeHint')}
                        checked={settings.nightMode}
                        onChange={(checked) => updateSettings({ nightMode: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.matchFrameRate')}
                        description={t('mediaPlayerPage.matchFrameRateHint')}
                        checked={settings.matchFrameRate}
                        onChange={(checked) => updateSettings({ matchFrameRate: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.audioPassthrough')}
                        description={t('mediaPlayerPage.audioPassthroughHint')}
                        checked={settings.audioPassthrough}
                        onChange={(checked) => updateSettings({ audioPassthrough: checked })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.cinemaTrailers')}
                        description={t('mediaPlayerPage.cinemaTrailersHint')}
                        value={String(settings.cinemaTrailerCount || 0)}
                        options={[0, 1, 2, 3, 4, 5].map((n) => ({
                            value: String(n),
                            label: n === 0 ? t('mediaPlayerPage.skipMarkerOff') : String(n),
                        }))}
                        onChange={(value) => {
                            const n = Math.min(5, Math.max(0, Number(value) || 0));
                            updateSettings({ cinemaTrailerCount: n, cinemaTrailers: n > 0 });
                        }}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.autoSkipIntro')}
                        description={t('mediaPlayerPage.autoSkipIntroHint')}
                        value={settings.skipIntroMode}
                        options={[
                            { value: 'off', label: t('mediaPlayerPage.skipMarkerOff') },
                            { value: 'manual', label: t('mediaPlayerPage.skipMarkerManual') },
                            { value: 'auto', label: t('mediaPlayerPage.skipMarkerAuto') },
                        ]}
                        onChange={(value) => updateSettings({
                            skipIntroMode: value as typeof settings.skipIntroMode,
                            autoSkipIntro: value === 'auto',
                        })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.autoSkipCredits')}
                        description={t('mediaPlayerPage.autoSkipCreditsHint')}
                        value={settings.skipCreditsMode}
                        options={[
                            { value: 'off', label: t('mediaPlayerPage.skipMarkerOff') },
                            { value: 'manual', label: t('mediaPlayerPage.skipMarkerManual') },
                            { value: 'auto', label: t('mediaPlayerPage.skipMarkerAuto') },
                        ]}
                        onChange={(value) => updateSettings({
                            skipCreditsMode: value as typeof settings.skipCreditsMode,
                            autoSkipCredits: value === 'auto',
                        })}
                    />
                </section>
                ) : null}

                {settingsTab === 'titles' ? (
                <section className="flex flex-col gap-3">
                    <TvToggleRow
                        title={t('mediaPlayerPage.playThemeTunes')}
                        description={t('mediaPlayerPage.playThemeTunesHint')}
                        checked={settings.playThemeTunes}
                        onChange={(checked) => updateSettings({ playThemeTunes: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.showServiceBrandLogos')}
                        description={t('mediaPlayerPage.showServiceBrandLogosHint')}
                        checked={settings.showServiceBrandLogos}
                        onChange={(checked) => updateSettings({ showServiceBrandLogos: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.serviceLogoPlates')}
                        description={t('mediaPlayerPage.serviceLogoPlatesHint')}
                        checked={settings.serviceLogoPlates}
                        onChange={(checked) => updateSettings({ serviceLogoPlates: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.showEpisodeFilePills')}
                        description={t('mediaPlayerPage.showEpisodeFilePillsHint')}
                        checked={settings.showEpisodeFilePills}
                        onChange={(checked) => updateSettings({ showEpisodeFilePills: checked })}
                    />
                    <TvToggleRow
                        title={t('mediaPlayerPage.skipSingleSeason')}
                        description={t('mediaPlayerPage.skipSingleSeasonHint')}
                        checked={settings.skipSingleSeason}
                        onChange={(checked) => updateSettings({ skipSingleSeason: checked })}
                    />
                    <TvChoiceRow
                        title={t('mediaPlayerPage.watchedTickPosition')}
                        description={t('mediaPlayerPage.watchedTickPositionHint')}
                        value={settings.watchedTickPosition}
                        options={[
                            { value: 'top-right', label: t('mediaPlayerPage.watchedTickTopRight') },
                            { value: 'top-left', label: t('mediaPlayerPage.watchedTickTopLeft') },
                            { value: 'bottom-right', label: t('mediaPlayerPage.watchedTickBottomRight') },
                            { value: 'bottom-left', label: t('mediaPlayerPage.watchedTickBottomLeft') },
                        ]}
                        onChange={(value) => updateSettings({
                            watchedTickPosition: value as typeof settings.watchedTickPosition,
                        })}
                    />
                </section>
                ) : null}

                {settingsTab === 'servers' ? serverSettings : null}
                {settingsTab === 'connection' ? connectionSettings : null}
                </div>
                {saveActions}
                {versionLabel}
            </div>
        );
    }

    return (
        <div className="flex w-full flex-col gap-6 pb-24" data-player-settings="1">
            <MediaPlayerBetaBanner />
            <div>
                <button
                    type="button"
                    onClick={onBack}
                    className="player-page-back mb-2 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text"
                >
                    <ArrowLeft className="h-4 w-4" />
                    {t('mediaPlayerPage.back')}
                </button>
                <p className={discoveryTheme.personalEyebrow}>{t('navigation.mediaPlayer')}</p>
                <h1 className={discoveryTheme.heading}>{t('mediaPlayerPage.settings')}</h1>
                <p className="mt-1 text-sm text-muted">{t('mediaPlayerPage.settingsHint')}</p>
            </div>

            <SettingsTabBar tabs={settingsTabs} value={settingsTab} onChange={setSettingsTab} tv={false} />

            {settingsTab === 'home' && canEditHero ? (
                <section className={sectionClass}>
                    <div className="border-b border-border px-5 py-4 sm:px-6">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.homeHeroMode')}</h2>
                            <span className="rounded-md bg-plex/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-plex">
                                {t('mediaPlayerPage.homeHeroAdminOnly')}
                            </span>
                        </div>
                        <p className="mt-1 text-xs text-muted">{t('mediaPlayerPage.homeHeroModeHint')}</p>
                    </div>
                    <div className="px-5 py-2 sm:px-6">
                        <div className="border-b border-border/40 py-4">
                            <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-home-hero-mode">
                                {t('mediaPlayerPage.homeHeroMode')}
                            </label>
                            <CustomSelect
                                id="media-player-home-hero-mode"
                                value={heroMode}
                                onChange={(value) => setHeroMode(value as HeroMode)}
                                className="max-w-xl"
                                options={heroModeOptions}
                            />
                        </div>
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.homeHeroSeasonalWindow')}
                            description={t('mediaPlayerPage.homeHeroSeasonalWindowHint')}
                            checked={heroSeasonalOnly}
                            onChange={setHeroSeasonalOnly}
                        />
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.continueWatchingSeasonPoster')}
                            description={t('mediaPlayerPage.continueWatchingSeasonPosterHint')}
                            checked={cwSeasonPoster}
                            onChange={setCwSeasonPoster}
                            border={false}
                        />
                    </div>
                </section>
            ) : null}

            {settingsTab === 'servers' ? (
                <section className={sectionClass}>
                    <div className="px-5 py-4 sm:px-6">{serverSettings}</div>
                </section>
            ) : null}

            {settingsTab === 'connection' ? connectionSettings : null}

            {settingsTab === 'home' ? (
            <section className={sectionClass}>
                <div className="border-b border-border px-5 py-4 sm:px-6">
                    <h2 className="text-sm font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.settingsHome')}</h2>
                    <p className="mt-1 text-xs text-muted">{t('mediaPlayerPage.homeFollowsPlexHint')}</p>
                </div>
                <div className="px-5 py-2 sm:px-6">
                    <div className="border-b border-border/40 py-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-bold text-text">{t('mediaPlayerPage.libraryNavOrder')}</p>
                                <p className="mt-1 text-xs text-muted">{t('mediaPlayerPage.libraryNavOrderHint')}</p>
                            </div>
                            {settings.libraryNavOrder.length ? (
                                <button
                                    type="button"
                                    onClick={() => updateSettings({ libraryNavOrder: [] })}
                                    className="shrink-0 text-xs font-bold text-muted hover:text-text"
                                >
                                    {t('mediaPlayerPage.homeRowReset')}
                                </button>
                            ) : null}
                        </div>
                        {orderedLibraries.length ? (
                            <div className="flex max-w-xl flex-col gap-2">
                                {orderedLibraries.map((library, index) => (
                                    <div
                                        key={library.key}
                                        className="flex items-center gap-2 rounded-xl border border-border bg-white/[0.03] px-3 py-2"
                                    >
                                        <span className="w-5 shrink-0 text-center text-xs font-bold tabular-nums text-muted">
                                            {index + 1}
                                        </span>
                                        <p className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                                            {library.title}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => updateSettings({
                                                libraryNavOrder: moveHomeRow(orderedLibraries.map((row) => row.key), index, -1),
                                            })}
                                            disabled={index === 0}
                                            className="rounded-lg border border-border bg-white/5 p-1.5 text-muted hover:text-text disabled:opacity-30"
                                            aria-label={t('mediaPlayerPage.homeRowMoveUp')}
                                        >
                                            <ChevronUp className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => updateSettings({
                                                libraryNavOrder: moveHomeRow(orderedLibraries.map((row) => row.key), index, 1),
                                            })}
                                            disabled={index === orderedLibraries.length - 1}
                                            className="rounded-lg border border-border bg-white/5 p-1.5 text-muted hover:text-text disabled:opacity-30"
                                            aria-label={t('mediaPlayerPage.homeRowMoveDown')}
                                        >
                                            <ChevronDown className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-muted">{t('mediaPlayerPage.emptyLibrariesNav')}</p>
                        )}
                    </div>
                    <SettingsToggleRow
                        title={t('mediaPlayerPage.mixLibraries')}
                        description={t('mediaPlayerPage.mixLibrariesHint')}
                        checked={settings.mixLibraries}
                        onChange={(checked) => updateSettings({ mixLibraries: checked })}
                    />
                    <SettingsToggleRow
                        title={t('mediaPlayerPage.showContinueWatching')}
                        description={t('mediaPlayerPage.showContinueWatchingHint')}
                        checked={settings.showContinueWatching}
                        onChange={(checked) => updateSettings({ showContinueWatching: checked })}
                    />
                    <div className="border-b border-border/40 py-4">
                        <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-cw-layout">
                            {t('mediaPlayerPage.continueWatchingLayout')}
                        </label>
                        <p className="mb-3 text-xs text-muted">{t('mediaPlayerPage.continueWatchingLayoutHint')}</p>
                        <CustomSelect
                            id="media-player-cw-layout"
                            value={settings.continueWatchingLayout}
                            onChange={(value) => updateSettings({
                                continueWatchingLayout: value as typeof settings.continueWatchingLayout,
                            })}
                            className="max-w-xl"
                            options={[
                                { value: 'poster', label: t('mediaPlayerPage.continueWatchingLayoutPoster') },
                                { value: 'title', label: t('mediaPlayerPage.continueWatchingLayoutTitle') },
                            ]}
                        />
                    </div>
                    <div className="border-b border-border/40 py-4">
                        <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-cw-sort">
                            {t('mediaPlayerPage.continueWatchingSort')}
                        </label>
                        <p className="mb-3 text-xs text-muted">{t('mediaPlayerPage.continueWatchingSortHint')}</p>
                        <CustomSelect
                            id="media-player-cw-sort"
                            value={settings.continueWatchingSort}
                            onChange={(value) => updateSettings({
                                continueWatchingSort: value as PlayerContinueWatchingSort,
                            })}
                            className="max-w-xl"
                            options={continueWatchingSortOptions}
                        />
                    </div>
                    <SettingsToggleRow
                        title={t('mediaPlayerPage.showPlaylists')}
                        description={t('mediaPlayerPage.showPlaylistsHint')}
                        checked={settings.showPlaylists}
                        onChange={(checked) => updateSettings({ showPlaylists: checked })}
                    />
                    <SettingsToggleRow
                        title={t('mediaPlayerPage.showWatchlist')}
                        description={t('mediaPlayerPage.showWatchlistHint')}
                        checked={settings.showWatchlist}
                        onChange={(checked) => updateSettings({ showWatchlist: checked })}
                    />
                    <SettingsToggleRow
                        title={t('mediaPlayerPage.showBecauseYouWatched')}
                        description={t('mediaPlayerPage.showBecauseYouWatchedHint')}
                        checked={settings.showBecauseYouWatched}
                        onChange={(checked) => updateSettings({ showBecauseYouWatched: checked })}
                    />
                    <SettingsToggleRow
                        title={t('mediaPlayerPage.hideWatchedFromRecents')}
                        description={t('mediaPlayerPage.hideWatchedFromRecentsHint')}
                        checked={settings.hideWatchedFromRecents}
                        onChange={(checked) => updateSettings({ hideWatchedFromRecents: checked })}
                    />
                    <SettingsToggleRow
                        title={t('mediaPlayerPage.recentlyAddedSeasonPoster')}
                        description={t('mediaPlayerPage.recentlyAddedSeasonPosterHint')}
                        checked={settings.recentlyAddedSeasonPoster}
                        onChange={(checked) => updateSettings({ recentlyAddedSeasonPoster: checked })}
                    />
                    <SettingsToggleRow
                        title={t('mediaPlayerPage.reduceMotion')}
                        description={t('mediaPlayerPage.reduceMotionHint')}
                        checked={settings.reduceMotion}
                        onChange={(checked) => updateSettings({ reduceMotion: checked })}
                    />
                    <div className="border-b border-border/40 py-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-bold text-text">{t('mediaPlayerPage.homeRowOrder')}</p>
                                <p className="mt-1 text-xs text-muted">{t('mediaPlayerPage.homeRowOrderHint')}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => updateSettings({ homeRowOrder: [] })}
                                className="shrink-0 text-xs font-bold text-muted hover:text-text"
                            >
                                {t('mediaPlayerPage.homeRowReset')}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                            {orderedRowIds.map((id, index) => (
                                <div
                                    key={id}
                                    className={`flex items-center gap-2 rounded-xl border border-border bg-white/[0.03] px-3 py-2 ${hiddenRows.has(id) ? 'opacity-50' : ''}`}
                                >
                                    <p className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                                        {rowLabels[id] || id}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => updateSettings({ homeRowOrder: moveHomeRow(orderedRowIds, index, -1) })}
                                        disabled={index === 0}
                                        className="rounded-lg border border-border bg-white/5 p-1.5 text-muted hover:text-text disabled:opacity-30"
                                        aria-label={t('mediaPlayerPage.homeRowMoveUp')}
                                    >
                                        <ChevronUp className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateSettings({ homeRowOrder: moveHomeRow(orderedRowIds, index, 1) })}
                                        disabled={index === orderedRowIds.length - 1}
                                        className="rounded-lg border border-border bg-white/5 p-1.5 text-muted hover:text-text disabled:opacity-30"
                                        aria-label={t('mediaPlayerPage.homeRowMoveDown')}
                                    >
                                        <ChevronDown className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
            ) : null}

            {settingsTab === 'titles' ? (
                <section className={sectionClass}>
                    <div className="px-5 py-2 sm:px-6">
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.playThemeTunes')}
                            description={t('mediaPlayerPage.playThemeTunesHint')}
                            checked={settings.playThemeTunes}
                            onChange={(checked) => updateSettings({ playThemeTunes: checked })}
                        />
                        {typeof document !== 'undefined' && document.documentElement?.dataset?.phone === '1' ? (
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.phoneOverviewPoster')}
                            description={t('mediaPlayerPage.phoneOverviewPosterHint')}
                            checked={settings.phoneOverviewPoster}
                            onChange={(checked) => updateSettings({ phoneOverviewPoster: checked })}
                        />
                        ) : null}
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.showServiceBrandLogos')}
                            description={t('mediaPlayerPage.showServiceBrandLogosHint')}
                            checked={settings.showServiceBrandLogos}
                            onChange={(checked) => updateSettings({ showServiceBrandLogos: checked })}
                        />
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.serviceLogoPlates')}
                            description={t('mediaPlayerPage.serviceLogoPlatesHint')}
                            checked={settings.serviceLogoPlates}
                            onChange={(checked) => updateSettings({ serviceLogoPlates: checked })}
                        />
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.showEpisodeFilePills')}
                            description={t('mediaPlayerPage.showEpisodeFilePillsHint')}
                            checked={settings.showEpisodeFilePills}
                            onChange={(checked) => updateSettings({ showEpisodeFilePills: checked })}
                        />
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.skipSingleSeason')}
                            description={t('mediaPlayerPage.skipSingleSeasonHint')}
                            checked={settings.skipSingleSeason}
                            onChange={(checked) => updateSettings({ skipSingleSeason: checked })}
                        />
                        <div className="py-4">
                            <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-watched-tick">
                                {t('mediaPlayerPage.watchedTickPosition')}
                            </label>
                            <p className="mb-3 text-xs text-muted">{t('mediaPlayerPage.watchedTickPositionHint')}</p>
                            <CustomSelect
                                id="media-player-watched-tick"
                                value={settings.watchedTickPosition}
                                onChange={(value) => updateSettings({
                                    watchedTickPosition: value as typeof settings.watchedTickPosition,
                                })}
                                className="max-w-xl"
                                options={[
                                    { value: 'top-right', label: t('mediaPlayerPage.watchedTickTopRight') },
                                    { value: 'top-left', label: t('mediaPlayerPage.watchedTickTopLeft') },
                                    { value: 'bottom-right', label: t('mediaPlayerPage.watchedTickBottomRight') },
                                    { value: 'bottom-left', label: t('mediaPlayerPage.watchedTickBottomLeft') },
                                ]}
                            />
                        </div>
                    </div>
                </section>
            ) : null}

            {settingsTab === 'player' ? (
            <div className="flex w-full flex-col gap-6">
                <section className={sectionClass}>
                    <div className="px-5 py-2 sm:px-6">
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.autoplayNext')}
                            description={t('mediaPlayerPage.autoplayNextHint')}
                            checked={settings.autoplayNext}
                            onChange={(checked) => updateSettings({ autoplayNext: checked })}
                        />
                    <div className="py-4">
                        <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-still-watching">
                            {t('mediaPlayerPage.stillWatchingAfter')}
                        </label>
                        <p className="mb-3 text-xs text-muted">{t('mediaPlayerPage.stillWatchingAfterHint')}</p>
                        <CustomSelect
                            id="media-player-still-watching"
                            value={String(settings.stillWatchingAfter)}
                            onChange={(value) => updateSettings({ stillWatchingAfter: Number(value) || 0 })}
                            className="max-w-xl"
                            options={[
                                { value: '0', label: t('mediaPlayerPage.stillWatchingAfterOff') },
                                ...[2, 3, 4, 5, 6, 8, 10].map((count) => ({
                                    value: String(count),
                                    label: t('mediaPlayerPage.stillWatchingAfterN', { count }),
                                })),
                            ]}
                        />
                    </div>
                    <div className="py-4">
                        <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-default-quality">
                            {t('mediaPlayerPage.defaultQuality')}
                        </label>
                        <p className="mb-3 text-xs text-muted">{t('mediaPlayerPage.defaultQualityHint')}</p>
                        <CustomSelect
                            id="media-player-default-quality"
                            value={settings.defaultQualityId}
                            onChange={(value) => updateSettings({ defaultQualityId: value })}
                            className="max-w-xl"
                            options={qualityOptions.map((row) => ({ value: row.id, label: row.label }))}
                        />
                    </div>
                </div>
            </section>
            <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
                <section className={sectionClass}>
                    <div className="border-b border-border px-5 py-4 sm:px-6">
                        <h2 className="text-sm font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.settingsAudio')}</h2>
                    </div>
                    <div className="px-5 py-2 sm:px-6">
                        <div className="border-b border-border/40 py-4">
                            <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-audio-language">
                                {t('mediaPlayerPage.audioLanguage')}
                            </label>
                            <p className="mb-3 text-xs text-muted">{t('mediaPlayerPage.audioLanguageHint')}</p>
                            <CustomSelect
                                id="media-player-audio-language"
                                value={settings.audioLanguage}
                                onChange={(value) => updateSettings({ audioLanguage: value })}
                                className="max-w-xl"
                                options={[
                                    { value: '', label: t('mediaPlayerPage.audioLanguageDefault') },
                                    ...PLAYER_AUDIO_LANGUAGES.map((row) => ({ value: row.id, label: row.label })),
                                ]}
                            />
                        </div>
                        <div className="py-4">
                            <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-subtitle-mode">
                                {t('mediaPlayerPage.subtitleMode')}
                            </label>
                            <p className="mb-3 text-xs text-muted">{t('mediaPlayerPage.subtitleModeHint')}</p>
                            <CustomSelect
                                id="media-player-subtitle-mode"
                                value={settings.subtitleMode}
                                onChange={(value) => updateSettings({ subtitleMode: value as PlayerSubtitleMode })}
                                className="max-w-xl"
                                options={subtitleOptions.map((row) => ({ value: row.id, label: row.label }))}
                            />
                        </div>
                        <div className="border-b border-border/40 py-4">
                            <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-subtitle-size">
                                {t('mediaPlayerPage.subtitleSize')}
                            </label>
                            <CustomSelect
                                id="media-player-subtitle-size"
                                value={String(settings.subtitleSize)}
                                onChange={(value) => updateSettings({ subtitleSize: Number(value) })}
                                className="max-w-xl"
                                options={[50, 75, 100, 125, 150, 200].map((value) => ({ value: String(value), label: `${value}%` }))}
                            />
                        </div>
                        <div className="border-b border-border/40 py-4">
                            <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-subtitle-color">
                                {t('mediaPlayerPage.subtitleColor')}
                            </label>
                            <CustomSelect
                                id="media-player-subtitle-color"
                                value={settings.subtitleColor}
                                onChange={(value) => updateSettings({ subtitleColor: value })}
                                className="max-w-xl"
                                options={[
                                    { value: '#ffffff', label: 'White' },
                                    { value: '#ffe566', label: 'Yellow' },
                                    { value: '#7dd3fc', label: 'Cyan' },
                                ]}
                            />
                        </div>
                        <div className="border-b border-border/40 py-4">
                            <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-subtitle-bg">
                                {t('mediaPlayerPage.subtitleBackground')}
                            </label>
                            <CustomSelect
                                id="media-player-subtitle-bg"
                                value={settings.subtitleBackground}
                                onChange={(value) => updateSettings({ subtitleBackground: value as typeof settings.subtitleBackground })}
                                className="max-w-xl"
                                options={[
                                    { value: 'none', label: t('mediaPlayerPage.subtitleBackgroundNone') },
                                    { value: 'dim', label: t('mediaPlayerPage.subtitleBackgroundDim') },
                                    { value: 'solid', label: t('mediaPlayerPage.subtitleBackgroundSolid') },
                                ]}
                            />
                        </div>
                        <div className="py-4">
                            <label className="mb-2 block text-sm font-bold text-text" htmlFor="media-player-subtitle-pos">
                                {t('mediaPlayerPage.subtitlePosition')}
                            </label>
                            <CustomSelect
                                id="media-player-subtitle-pos"
                                value={settings.subtitlePosition}
                                onChange={(value) => updateSettings({ subtitlePosition: value as typeof settings.subtitlePosition })}
                                className="max-w-xl"
                                options={[
                                    { value: 'bottom', label: t('mediaPlayerPage.subtitlePositionBottom') },
                                    { value: 'middle', label: t('mediaPlayerPage.subtitlePositionMiddle') },
                                    { value: 'top', label: t('mediaPlayerPage.subtitlePositionTop') },
                                ]}
                            />
                        </div>
                    </div>
                </section>

                <section className={sectionClass}>
                    <div className="border-b border-border px-5 py-4 sm:px-6">
                        <h2 className="text-sm font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.settingsSkipping')}</h2>
                    </div>
                    <div className="px-5 py-2 sm:px-6">
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.nightMode')}
                            description={t('mediaPlayerPage.nightModeHint')}
                            checked={settings.nightMode}
                            onChange={(checked) => updateSettings({ nightMode: checked })}
                        />
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.matchFrameRate')}
                            description={t('mediaPlayerPage.matchFrameRateHint')}
                            checked={settings.matchFrameRate}
                            onChange={(checked) => updateSettings({ matchFrameRate: checked })}
                        />
                        <SettingsToggleRow
                            title={t('mediaPlayerPage.audioPassthrough')}
                            description={t('mediaPlayerPage.audioPassthroughHint')}
                            checked={settings.audioPassthrough}
                            onChange={(checked) => updateSettings({ audioPassthrough: checked })}
                        />
                        <div className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 sm:pr-4">
                                <p className="text-sm font-semibold text-ink">{t('mediaPlayerPage.cinemaTrailers')}</p>
                                <p className="mt-0.5 text-xs text-muted">{t('mediaPlayerPage.cinemaTrailersHint')}</p>
                            </div>
                            <CustomSelect
                                value={String(settings.cinemaTrailerCount || 0)}
                                options={[0, 1, 2, 3, 4, 5].map((n) => ({
                                    value: String(n),
                                    label: n === 0 ? t('mediaPlayerPage.skipMarkerOff') : String(n),
                                }))}
                                onChange={(value) => {
                                    const n = Math.min(5, Math.max(0, Number(value) || 0));
                                    updateSettings({ cinemaTrailerCount: n, cinemaTrailers: n > 0 });
                                }}
                            />
                        </div>
                        <div className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 sm:pr-4">
                                <p className="text-sm font-semibold text-ink">{t('mediaPlayerPage.autoSkipIntro')}</p>
                                <p className="mt-0.5 text-xs text-muted">{t('mediaPlayerPage.autoSkipIntroHint')}</p>
                            </div>
                            <CustomSelect
                                value={settings.skipIntroMode}
                                options={[
                                    { value: 'off', label: t('mediaPlayerPage.skipMarkerOff') },
                                    { value: 'manual', label: t('mediaPlayerPage.skipMarkerManual') },
                                    { value: 'auto', label: t('mediaPlayerPage.skipMarkerAuto') },
                                ]}
                                onChange={(value) => updateSettings({
                                    skipIntroMode: value as typeof settings.skipIntroMode,
                                    autoSkipIntro: value === 'auto',
                                })}
                            />
                        </div>
                        <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 sm:pr-4">
                                <p className="text-sm font-semibold text-ink">{t('mediaPlayerPage.autoSkipCredits')}</p>
                                <p className="mt-0.5 text-xs text-muted">{t('mediaPlayerPage.autoSkipCreditsHint')}</p>
                            </div>
                            <CustomSelect
                                value={settings.skipCreditsMode}
                                options={[
                                    { value: 'off', label: t('mediaPlayerPage.skipMarkerOff') },
                                    { value: 'manual', label: t('mediaPlayerPage.skipMarkerManual') },
                                    { value: 'auto', label: t('mediaPlayerPage.skipMarkerAuto') },
                                ]}
                                onChange={(value) => updateSettings({
                                    skipCreditsMode: value as typeof settings.skipCreditsMode,
                                    autoSkipCredits: value === 'auto',
                                })}
                            />
                        </div>
                    </div>
                </section>
            </div>
            </div>
            ) : null}

            {versionLabel}

            <StickySaveBar className="!bottom-5">
                {dirty ? (
                    <p className="px-2 text-xs font-bold text-muted">{t('mediaPlayerPage.unsavedSettings')}</p>
                ) : saveState === 'saved' ? (
                    <p className="px-2 text-xs font-bold text-muted">{t('mediaPlayerPage.settingsSaved')}</p>
                ) : saveState === 'error' ? (
                    <p className="px-2 text-xs font-bold text-red-400">{t('mediaPlayerPage.settingsSaveError')}</p>
                ) : null}
                <button
                    type="button"
                    onClick={discardAll}
                    disabled={!dirty || saving}
                    className="inline-flex items-center justify-center rounded-xl bg-white/[0.06] px-3.5 py-2.5 text-sm font-bold text-text transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                    {t('mediaPlayerPage.discardChanges')}
                </button>
                <button
                    type="button"
                    onClick={() => { void handleSave(); }}
                    disabled={!dirty || saving}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background shadow-lg shadow-plex/15 transition-colors hover:bg-plex-hover disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t('mediaPlayerPage.saveSettings')}
                </button>
            </StickySaveBar>
        </div>
    );
};

