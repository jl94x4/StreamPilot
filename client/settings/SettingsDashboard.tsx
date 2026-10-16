import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Copy,
    ChevronUp,
    ChevronDown,
    Check,
    BookOpen,
    Save,
    RefreshCw,
    Server,
    Bell,
    Newspaper,
    Trash2,
    Layers,
    Palette,
    LayoutDashboard,
    AppWindow,
    Activity,
    UserPlus,
    ListTodo,
    Wand2,
    Settings,
    Phone,
    Radio,
    Shield,
    ScrollText,
    Plus,
    Cpu,
    Image as ImageIcon,
    Trophy,
    Film,
    Clapperboard,
    Bookmark,
    ExternalLink,
    BarChart3,
    Music,
} from 'lucide-react';
import { apiFetch, PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE } from '../shared/api';
import { portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { safeHttpUrl, safeImageSrc } from '../shared/safeUrl';
import { appConfirm } from '../shared/confirm';
import { usePoll } from '../shared/usePoll';
import { CustomSelect, SettingsSwitch, SettingsToggleRow } from '../shared/ui';
import { StickySaveBar } from '../shared/StickySaveBar';
import { Loader, ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { SettingHint, SettingFieldLabel } from './SettingHint';
import type { User, AuditEntry, DeletedUser, PlexServer, ArrInstance, DownloadClientConfig, CustomNavTab, HomeCustomModule } from '../shared/types';
import type { NavItemIconsMap } from '../shared/navItemIcons';
import { formatDateTime, formatEventName, hexToRgb, accentHoverRgb, getDaysUntilExpiry, addMonths, addYears, formatDate, formatPortalDateTime } from '../shared/format';

import { StreamKillRulesPanel } from './StreamKillRulesPanel';
import { InvitesSettings } from './InvitesSettings';
import { StatusMonitorSettings } from './StatusMonitorSettings';
import { ScannerSettingsPanel, defaultScannerSettings, type ScannerSettings } from './ScannerSettingsPanel';
import { BroadcastSettingsTab } from './BroadcastSettingsTab';
import { EmailAutomatedTemplatesPanel } from './EmailAutomatedTemplatesPanel';
import { CleanupInactivePreview } from './CleanupInactivePreview';
import { NotificationsSettingsTab } from './NotificationsSettingsTab';
import { IntegrationTestButton } from '../shared/IntegrationTestButton';
import { HomeLayoutSettings } from './HomeLayoutSettings';
import { AchievementsSettings } from './AchievementsSettings';
import { AnalyticsSettings } from './AnalyticsSettings';
import { MemoryDiagnosticsSection } from './MemoryDiagnosticsSection';
import { LoginBrandMark } from '../shared/LoginBrandMark';
import { NavigationOrderSettings } from './NavigationOrderSettings';
import { CustomNavTabsSettings } from './CustomNavTabsSettings';
import { HomeCustomModulesSettings } from './HomeCustomModulesSettings';
import { ArrInstancesPanel, type ArrInstancesPanelCopy } from './ArrInstancesPanel';
import { DISCOVER_LANGUAGE_OPTIONS, DISCOVER_REGION_OPTIONS } from './discoverySettingsOptions';
import { DEFAULT_DASHBOARD_LAYOUT, normalizeSectionLayout, type DashboardLayoutConfig } from '../shared/dashboardLayout';
import { pruneDashboardLayoutCustomModules } from '../shared/homeCustomModules';
import { DEFAULT_NAV_ORDER, deriveMemberNavOrderFromAdmin, ensureCompleteMemberNavOrder, ensureCompleteNavOrder, normalizeMemberNavHiddenKeys, normalizeNavHiddenKeys, resolveMemberNavOrder } from '../shared/nav';
import {
    SETTINGS_TAB_GROUPS,
    SETTINGS_TAB_SECTIONS,
    buildSettingsHash,
    getSettingsSectionElementId,
    parseSettingsHash,
    recordRecentSetting,
    resolveSettingsEntry,
    type SettingsIndexEntry,
    type SettingsTabId,
} from './settingsIndex';
import { UPGRADER_PRESET_SELECT_OPTIONS } from '../upgrader/presets';
import { MediaAutomationSettings } from '../media-automation/MediaAutomationSettings';
import {
    DEFAULT_MEDIA_AUTOMATION_SETTINGS,
    type MediaAutomationSettingsConfig,
} from '../media-automation/types';
import { useDiscoverI18n } from '../discovery/i18n';
import { BetaBadge, PosterSetsBetaBanner } from '../shared/BetaBadge';

const SETTINGS_TAB_BETA_NOTICE: Record<string, string> = {
    'poster-sets': 'posterSetsPage.betaNotice',
};

const normalizeArrInstancesFromSettings = (settings: Record<string, any> = {}): ArrInstance[] => {
    if (Array.isArray(settings.arrInstances) && settings.arrInstances.length > 0) {
        return settings.arrInstances.map((entry: ArrInstance) => ({ ...entry }));
    }
    const instances: ArrInstance[] = [];
    if (settings.sonarrUrl || settings.sonarrApiKey) {
        instances.push({
            id: 'sonarr-default',
            type: 'sonarr',
            name: 'Sonarr',
            url: settings.sonarrUrl || '',
            apiKey: settings.sonarrApiKey || '',
            enabled: true,
            isDefault: true,
        });
    }
    if (settings.radarrUrl || settings.radarrApiKey) {
        instances.push({
            id: 'radarr-default',
            type: 'radarr',
            name: 'Radarr',
            url: settings.radarrUrl || '',
            apiKey: settings.radarrApiKey || '',
            enabled: true,
            isDefault: true,
        });
    }
    return instances;
};

const DOWNLOAD_CLIENT_TYPE_LABELS: Record<DownloadClientConfig['type'], string> = {
    qbittorrent: 'qBittorrent',
    rdtclient: 'Real-Debrid Client',
    transmission: 'Transmission',
    bittorrent: 'BitTorrent',
    deluge: 'Deluge',
    sabnzbd: 'SABnzbd',
    nzbget: 'NZBGet',
};

const taskStatusPillClass = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap';

type TaskStatusSource = {
    running?: boolean;
    lastRun?: string | null;
    lastError?: string | null;
    lastWarning?: string | null;
};

const TaskStatusPill: React.FC<{ task: TaskStatusSource }> = ({ task }) => {
    if (task.running) {
        return (
            <span className={`${taskStatusPillClass} bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.15)] animate-pulse`}>
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-ping" />
                Running
            </span>
        );
    }
    if (task.lastError) {
        return (
            <span className={`${taskStatusPillClass} bg-red-500/10 text-red-400 border-red-500/20`}>
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                Failed
            </span>
        );
    }
    if (task.lastWarning) {
        return (
            <span className={`${taskStatusPillClass} bg-amber-500/10 text-amber-400 border-amber-500/20`}>
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                Warning
            </span>
        );
    }
    if (task.lastRun) {
        return (
            <span className={`${taskStatusPillClass} bg-emerald-500/10 text-emerald-300 border-emerald-500/20`}>
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                Success
            </span>
        );
    }
    return (
        <span className={`${taskStatusPillClass} bg-slate-500/10 text-muted border-border`}>
            Idle
        </span>
    );
};

const downloadClientUrlPlaceholder = (type: DownloadClientConfig['type']) => (
    type === 'transmission' ? 'http://localhost:9091'
        : type === 'deluge' ? 'http://localhost:8112'
            : type === 'nzbget' ? 'http://localhost:6789'
                : type === 'rdtclient' ? 'http://localhost:6500'
                    : 'http://localhost:8080'
);

const createEmptyDownloadClient = (type: DownloadClientConfig['type'] = 'qbittorrent'): DownloadClientConfig => ({
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${type}-${Date.now()}`,
    type,
    name: DOWNLOAD_CLIENT_TYPE_LABELS[type] || 'qBittorrent',
    url: '',
    username: '',
    password: '',
    enabled: true,
});

const DEFAULT_ALERT_RULES = {
    expiryWarning: true,
    accessRevoked: true,
    newUserSynced: true,
    requestPending: true,
    supportTicket: true,
    supportReply: true,
    supportMediaIssue: true,
    syncSuccess: false,
    syncFailure: true,
};

const hasIntegrationCredentials = (
    url: string | undefined,
    apiKey: string | undefined,
    savedUrl?: string,
    savedApiKey?: string,
) => {
    const effectiveUrl = String(url || savedUrl || '').trim();
    const effectiveKey = String(apiKey || savedApiKey || '').trim();
    return Boolean(effectiveUrl && effectiveKey);
};

const SELFHST_ICON_BASE = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg';
const SIMPLE_ICON_BASE = 'https://cdn.simpleicons.org';
const APP_ICONS: Record<string, string> = {
    plex: `${SELFHST_ICON_BASE}/plex.svg`,
    jellyfin: `${SELFHST_ICON_BASE}/jellyfin.svg`,
    emby: `${SELFHST_ICON_BASE}/emby.svg`,
    sonarr: `${SELFHST_ICON_BASE}/sonarr.svg`,
    radarr: `${SELFHST_ICON_BASE}/radarr.svg`,
    lidarr: `${SELFHST_ICON_BASE}/lidarr.svg`,
    bazarr: `${SELFHST_ICON_BASE}/bazarr.svg`,
    tautulli: `${SELFHST_ICON_BASE}/tautulli.svg`,
    seerr: `${SELFHST_ICON_BASE}/seerr.svg`,
    overseerr: `${SELFHST_ICON_BASE}/seerr.svg`,
    jellyseerr: `${SELFHST_ICON_BASE}/jellyseerr.svg`,
    ombi: `${SELFHST_ICON_BASE}/ombi.svg`,
    download: `${SELFHST_ICON_BASE}/qbittorrent.svg`,
    qbittorrent: `${SELFHST_ICON_BASE}/qbittorrent.svg`,
    rdtclient: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/rdt-client.svg',
    transmission: `${SELFHST_ICON_BASE}/transmission.svg`,
    bittorrent: `${SIMPLE_ICON_BASE}/bittorrent`,
    deluge: `${SELFHST_ICON_BASE}/deluge.svg`,
    sabnzbd: `${SELFHST_ICON_BASE}/sabnzbd.svg`,
    nzbget: `${SELFHST_ICON_BASE}/nzbget.svg`,
    jellystat: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/png/jellystat.png',
    jellyglance: '/static/logos/jellyglance.png',
    tmdb: `${SELFHST_ICON_BASE}/tmdb.svg`,
};

const SETTINGS_TAB_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    plex: Server,
    notifications: Bell,
    newsletter: Newspaper,
    cleanup: Trash2,
    cleaner: Shield,
    mediastack: Layers,
    request: BookOpen,
    branding: Palette,
    layout: LayoutDashboard,
    applets: AppWindow,
    status: Activity,
    invites: UserPlus,
    tasks: ListTodo,
    upgrader: Wand2,
    collexions: Layers,
    'spotify-sync': Music,
    'metadata-fill': Wand2,
    scanner: Activity,
    'media-automation': Cpu,
    'poster-sets': ImageIcon,
    overlays: Layers,
    editions: Film,
    'watch-sync': Clapperboard,
    achievements: Trophy,
    analytics: BarChart3,
    system: Settings,
    contact: Phone,
    broadcast: Radio,
    'stream-rules': Shield,
    logs: ScrollText,
};

const SettingsTabIcon: React.FC<{ id: string }> = ({ id }) => {
    const Icon = SETTINGS_TAB_ICONS[id] || Settings;
    return <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />;
};

const ProgramIcon: React.FC<{ app: string; label: string }> = ({ app, label }) => (
    <span className="inline-flex w-8 h-8 rounded-lg bg-white/5 border border-white/10 items-center justify-center overflow-hidden flex-shrink-0">
        {APP_ICONS[app] ? (
            <img
                src={APP_ICONS[app]}
                alt=""
                className="w-5 h-5 object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
        ) : (
            <span className="text-[10px] font-black text-plex">{label.slice(0, 2).toUpperCase()}</span>
        )}
        <span className="sr-only">{label}</span>
    </span>
);

const IntegrationHeading: React.FC<{ app: string; title: string; subtitle?: string; className?: string; badge?: React.ReactNode }> = ({ app, title, subtitle, className = '', badge }) => (
    <div className={`integration-heading border-b border-border pb-3 mb-4 ${className}`}>
        <div className="grid grid-cols-[2rem_1fr] gap-x-3 gap-y-0.5">
            <div className="row-start-1 self-center">
                <ProgramIcon app={app} label={title} />
            </div>
            <h3 className="integration-heading-title text-xl font-bold text-text leading-tight min-w-0 col-start-2 row-start-1 flex items-center gap-2 flex-wrap">
                <span>{title}</span>
                {badge}
            </h3>
            {subtitle && <p className="text-xs text-muted col-start-2 row-start-2">{subtitle}</p>}
        </div>
    </div>
);

const JELLYFIN_BRAND_LOGO_URL = '/api/jellyfin/branding/icon';
const JELLYFIN_BRAND_BACKGROUND_URL = '/api/jellyfin/branding/splash';
const isJellyfinBrandingAsset = (value: string | null | undefined) => (
    [JELLYFIN_BRAND_LOGO_URL, JELLYFIN_BRAND_BACKGROUND_URL].includes(String(value || '').trim())
);

const getUploadedBrandingImagePath = (file: File, assetName: 'logo' | 'background' | 'favicon' | 'login') => {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    const extension = type.includes('webp') || name.endsWith('.webp')
        ? 'webp'
        : (type.includes('jpeg') || type.includes('jpg') || name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'jpg' : 'png');
    return `/static/${assetName}.${extension}`;
};

const SETTINGS_GROUP_TRANSLATION_KEYS: Record<string, string> = {
    Portal: 'settings.navigation.groups.portal',
    'Media Stack': 'settings.navigation.groups.mediaStack',
    Comms: 'settings.navigation.groups.comms',
    Automation: 'settings.navigation.groups.automation',
};

const SETTINGS_TAB_TRANSLATION_KEYS: Record<string, string> = {
    branding: 'settings.navigation.tabs.branding',
    contact: 'settings.navigation.tabs.contact',
    layout: 'settings.navigation.tabs.layout',
    applets: 'settings.navigation.tabs.applets',
    achievements: 'settings.navigation.tabs.achievements',
    analytics: 'settings.navigation.tabs.analytics',
    plex: 'settings.navigation.tabs.plex',
    mediastack: 'settings.navigation.tabs.mediastack',
    request: 'settings.navigation.tabs.request',
    status: 'settings.navigation.tabs.status',
    notifications: 'settings.navigation.tabs.notifications',
    newsletter: 'settings.navigation.tabs.newsletter',
    broadcast: 'settings.navigation.tabs.broadcast',
    invites: 'settings.navigation.tabs.invites',
    cleanup: 'settings.navigation.tabs.cleanup',
    cleaner: 'settings.navigation.tabs.cleaner',
    'stream-rules': 'settings.navigation.tabs.streamRules',
    tasks: 'settings.navigation.tabs.tasks',
    upgrader: 'settings.navigation.tabs.upgrader',
    collexions: 'settings.navigation.tabs.collexions',
    'spotify-sync': 'settings.navigation.tabs.spotifySync',
    'metadata-fill': 'settings.navigation.tabs.metadataFill',
    scanner: 'settings.navigation.tabs.scanner',
    'media-automation': 'settings.navigation.tabs.mediaAutomation',
    'poster-sets': 'settings.navigation.tabs.posterSets',
    overlays: 'settings.navigation.tabs.overlays',
    editions: 'settings.navigation.tabs.editions',
    'watch-sync': 'settings.navigation.tabs.watchSync',
    system: 'settings.navigation.tabs.system',
    logs: 'settings.navigation.tabs.logs',
};

const AUDIT_FILTER_PRESETS_KEY = 'portal.auditLog.filterPresets.v1';

type AuditFilterPreset = {
    id: string;
    name: string;
    event: string;
    user: string;
    from: string;
    to: string;
};

const readAuditFilterPresets = (): AuditFilterPreset[] => {
    try {
        const raw = localStorage.getItem(AUDIT_FILTER_PRESETS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string')
            .map((entry) => ({
                id: String(entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
                name: String(entry.name).trim() || 'Preset',
                event: String(entry.event || ''),
                user: String(entry.user || ''),
                from: String(entry.from || ''),
                to: String(entry.to || ''),
            }))
            .slice(0, 20);
    } catch {
        return [];
    }
};

const writeAuditFilterPresets = (presets: AuditFilterPreset[]) => {
    try {
        localStorage.setItem(AUDIT_FILTER_PRESETS_KEY, JSON.stringify(presets.slice(0, 20)));
    } catch {
        /* ignore quota / private mode */
    }
};

export const SettingsDashboard: React.FC = () => {
    const { t } = useDiscoverI18n();
    const arrIntegrationsCopy = useMemo<ArrInstancesPanelCopy>(() => ({
        addInstance: t('settings.arrIntegrations.actions.addInstance'),
        noInstances: (appName) => t('settings.arrIntegrations.empty.noInstances', { appName }),
        instanceLabel: (index) => t('settings.arrIntegrations.labels.instance', { index }),
        defaultLabel: t('settings.arrIntegrations.status.default'),
        defaultInstanceTitle: t('settings.arrIntegrations.actions.defaultInstance'),
        setAsDefaultTitle: t('settings.arrIntegrations.actions.setAsDefault'),
        removeInstanceTitle: t('settings.arrIntegrations.actions.removeInstance'),
        displayName: t('settings.arrIntegrations.labels.displayName'),
        ultraHdInstance: t('settings.arrIntegrations.labels.ultraHdInstance'),
        ultraHdRoutingHint: t('settings.arrIntegrations.hints.ultraHdRouting'),
        url: t('settings.arrIntegrations.labels.url'),
        externalUrl: t('settings.arrIntegrations.labels.externalUrl'),
        externalUrlOptional: t('settings.arrIntegrations.hints.externalUrlOptional'),
        apiKey: t('settings.arrIntegrations.labels.apiKey'),
        apiKeyPlaceholder: t('settings.arrIntegrations.placeholders.apiKey'),
        plexLibraries: t('settings.arrIntegrations.labels.plexLibraries'),
        libraryMappingHint: t('settings.arrIntegrations.hints.libraryMapping'),
        assignedElsewhere: t('settings.arrIntegrations.library.assignedToAnotherInstance'),
        defaultQualityProfile: t('settings.arrIntegrations.labels.defaultQualityProfile'),
        defaultRootFolder: t('settings.arrIntegrations.labels.defaultRootFolder'),
        routingDefaultsHint: t('settings.arrIntegrations.hints.routingDefaults'),
        useArrDefault: t('settings.arrIntegrations.placeholders.useArrDefault'),
        optionsNeedCredentials: t('settings.arrIntegrations.hints.optionsNeedCredentials'),
        optionsLoadFailed: t('settings.arrIntegrations.test.optionsLoadFailed'),
        testConnection: t('settings.arrIntegrations.actions.testConnection'),
        connectionSuccessful: t('settings.arrIntegrations.test.connectionSuccessful'),
        connectionFailed: t('settings.arrIntegrations.test.connectionFailed'),
    }), [t]);
    const [statusDraft, setStatusDraft] = useState<any>(null);
    const [isLoading, setLoading] = useState(true);
    const [configLoadError, setConfigLoadError] = useState<string | null>(null);
    const [initialSettings, setInitialSettings] = useState<any>({});
    const [isConfigLoaded, setIsConfigLoaded] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const streamRulesSaveHandlerRef = useRef<(() => Promise<boolean>) | null>(null);

    // Admin features moved here
    const [statusConfig, setStatusConfig] = useState<any>({});
    const [users, setUsers] = useState<User[]>([]);

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts(t => pushToast(t, message, type));
    }, []);

    const fetchStatusConfig = useCallback(async () => {
        try {
            const sConf = await apiFetch('/api/status/config');
            setStatusConfig(sConf);
        } catch (e) {
            addToast(e instanceof Error ? e.message : t('settings.statusMonitor.loadConfigFailed'), 'error');
        }
    }, [addToast, t]);

    useEffect(() => {
        const fetchConfig = async () => {
            setLoading(true);
            setConfigLoadError(null);
            try {
                const configData = await apiFetch('/api/config');
                if (configData.settings) {
                    setInitialSettings(configData.settings);
                }
                const usersData = await apiFetch('/api/users');
                setUsers(usersData);
                await fetchStatusConfig();
                setIsConfigLoaded(true);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to load config';
                setConfigLoadError(message);
                addToast(message, 'error');
            } finally {
                setLoading(false);
            }
        };
        fetchConfig();
        // Libraries call Plex on the server — can hang in Docker if a loopback URI is used.
        apiFetch('/api/plex/libraries').then((libData) => setLibraries(libData || [])).catch(() => setLibraries([]));
    }, [addToast, fetchStatusConfig]);

    const handleSaveConfig = async (newConfig: any) => {
        setLoading(true);
        try {
            const result = await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(newConfig) });
            const configData = await apiFetch('/api/config');
            if (configData.settings) {
                setInitialSettings(configData.settings);
            }
            window.dispatchEvent(new CustomEvent('portal-public-config-updated'));
            if (result?.seerrDiscoverySync && !result.seerrDiscoverySync.ok && !result.seerrDiscoverySync.skipped) {
                addToast(`Settings saved, but request app sync failed: ${result.seerrDiscoverySync.error}`, 'error');
            } else if (result?.discoveryAvailabilityRebuild?.triggered) {
                addToast('Settings saved — rebuilding Discover availability cache in the background.', 'success');
            } else {
                addToast('Settings Saved!');
            }
        } catch (e: any) {
            addToast(e.message || 'Failed to save config', 'error');
        } finally {
            setLoading(false);
        }
    };
    const [token, setToken] = useState('');
    const [mediaServerType, setMediaServerType] = useState<'plex' | 'jellyfin' | 'emby'>('plex');
    const [plexServerUrl, setPlexServerUrl] = useState('');
    const [jellyfinUrl, setJellyfinUrl] = useState('');
    const [jellyfinApiKey, setJellyfinApiKey] = useState('');
    const [servers, setServers] = useState<PlexServer[]>([]);
    const [selectedServer, setSelectedServer] = useState('');
    const [checkInterval, setCheckInterval] = useState(60);
    const [hideStreamUsers, setHideStreamUsers] = useState<string>('false');
    const [showUsernamesInAnalytics, setShowUsernamesInAnalytics] = useState(false);
    const [useTrendingSlideshowOnLogin, setUseTrendingSlideshowOnLogin] = useState(false);
    const [defaultLibraryIds, setDefaultLibraryIds] = useState<string[]>([]);
    const [libraries, setLibraries] = useState<any[]>([]);
    useEffect(() => {
        if (!libraries.length) return;
        setDefaultLibraryIds((prev) => {
            if (prev.length > 0) return prev;
            return libraries.map((l: any) => String(l.id));
        });
    }, [libraries]);
    const mediaServerLabel = mediaServerType === 'emby' ? 'Emby' : mediaServerType === 'jellyfin' ? 'Jellyfin' : 'Plex';
    const [activeTab, setActiveTab] = useState<SettingsTabId>(() => {
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get('focus') === 'maintenance-toggle') return 'cleaner';
        } catch {
            /* ignore invalid URL */
        }
        const { tabId } = parseSettingsHash(window.location.hash);
        return tabId || 'branding';
    });
    const initialHash = parseSettingsHash(window.location.hash);
    const [activeSectionId, setActiveSectionId] = useState<string | null>(initialHash.sectionId);
    const [scrollToSection, setScrollToSection] = useState<string | null>(initialHash.sectionId);
    const [highlightMaintenanceToggle, setHighlightMaintenanceToggle] = useState(false);

    const settingsTabGroups = useMemo(() => {
        // Collexions is Plex-only — hide the settings tab for Jellyfin/Emby.
        if (mediaServerType === 'plex') return SETTINGS_TAB_GROUPS;
        return SETTINGS_TAB_GROUPS.map((group) => ({
            ...group,
            tabs: group.tabs.filter((tab) => tab.id !== 'collexions' && tab.id !== 'spotify-sync' && tab.id !== 'metadata-fill' && tab.id !== 'overlays' && tab.id !== 'editions'),
        })).filter((group) => group.tabs.length > 0);
    }, [mediaServerType]);
    const settingsTabsFlat = settingsTabGroups.flatMap((group) => group.tabs);
    const visibleTabGroups = settingsTabGroups;

    const navigateToSetting = useCallback((entry: SettingsIndexEntry) => {
        setActiveTab(entry.tabId);
        setActiveSectionId(entry.sectionId || null);
        setScrollToSection(entry.sectionId || null);
        recordRecentSetting(entry.id);
    }, []);

    useEffect(() => {
        const hash = buildSettingsHash(activeTab, activeSectionId);
        if (window.location.hash !== hash) {
            window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}${hash}`);
        }
    }, [activeTab, activeSectionId]);

    useEffect(() => {
        const syncTabFromHash = () => {
            const { tabId, sectionId } = parseSettingsHash(window.location.hash);
            if (tabId) {
                setActiveTab(tabId);
                setActiveSectionId(sectionId);
                setScrollToSection(sectionId);
            } else if (!window.location.hash) {
                setActiveTab('branding');
                setActiveSectionId(null);
                setScrollToSection(null);
            }
        };
        window.addEventListener('hashchange', syncTabFromHash);
        return () => window.removeEventListener('hashchange', syncTabFromHash);
    }, []);

    useEffect(() => {
        if (!scrollToSection) return;
        const timer = window.setTimeout(() => {
            const el = document.getElementById(getSettingsSectionElementId(scrollToSection));
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                el.classList.add('settings-section-highlight');
                window.setTimeout(() => el.classList.remove('settings-section-highlight'), 2200);
            }
            setScrollToSection(null);
        }, 120);
        return () => window.clearTimeout(timer);
    }, [activeTab, scrollToSection]);

    useEffect(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.get('focus') !== 'maintenance-toggle') return;
        setActiveTab('cleaner');
        setHighlightMaintenanceToggle(true);
        const timer = window.setTimeout(() => setHighlightMaintenanceToggle(false), 4200);
        url.searchParams.delete('focus');
        url.hash = 'cleaner';
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        return () => window.clearTimeout(timer);
    }, []);

    // SMTP States
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState(587);
    const [smtpUser, setSmtpUser] = useState('');
    const [smtpPass, setSmtpPass] = useState('');
    const [smtpFrom, setSmtpFrom] = useState('');
    const [smtpSecure, setSmtpSecure] = useState(false);
    const [emailDaysBefore, setEmailDaysBefore] = useState(7);
    const [testRecipient, setTestRecipient] = useState('');
    const [isTestingSmtp, setIsTestingSmtp] = useState(false);
    const [gotifyEnabled, setGotifyEnabled] = useState(false);
    const [gotifyUrl, setGotifyUrl] = useState('');
    const [gotifyToken, setGotifyToken] = useState('');
    const [gotifyPriority, setGotifyPriority] = useState(5);
    const [alertRules, setAlertRules] = useState<Record<string, boolean>>(DEFAULT_ALERT_RULES);
    const [isTestingGotify, setIsTestingGotify] = useState(false);
    const [isTestingNewsletter, setIsTestingNewsletter] = useState(false);
    const [isSendingNewsletter, setIsSendingNewsletter] = useState(false);
    const [isGeneratingNewsletter, setIsGeneratingNewsletter] = useState(false);

    // Newsletter States
    const [newsletterFrequency, setNewsletterFrequency] = useState('disabled');
    const [newsletterDay, setNewsletterDay] = useState(0);
    const [publicDomain, setPublicDomain] = useState('');
    const [requestUrl, setRequestUrl] = useState('https://yourdomain.com');
    const [contactUrl, setContactUrl] = useState('');
    const [contactWhatsApp, setContactWhatsApp] = useState('');
    const [contactEmail, setContactEmail] = useState('');

    // Cleanup States
    const [inactiveCleanupEnabled, setInactiveCleanupEnabled] = useState(false);
    const [inactiveCleanupDays, setInactiveCleanupDays] = useState(90);

    // Media Stack States
    const [arrInstances, setArrInstances] = useState<ArrInstance[]>([]);
    const [savedArrInstances, setSavedArrInstances] = useState<ArrInstance[]>([]);
    const [downloadClients, setDownloadClients] = useState<DownloadClientConfig[]>([]);
    const [tautulliUrl, setTautulliUrl] = useState('');
    const [notifyTautulliApiFailed, setNotifyTautulliApiFailed] = useState(true);
    const [tautulliApiKey, setTautulliApiKey] = useState('');
    const [jellyfinAnalyticsProvider, setJellyfinAnalyticsProvider] = useState('jellyglance');
    const [jellystatUrl, setJellystatUrl] = useState('');
    const [jellystatApiKey, setJellystatApiKey] = useState('');
    const [jellyglanceUrl, setJellyglanceUrl] = useState('');
    const [jellyglanceApiKey, setJellyglanceApiKey] = useState('');
    const [requestAppType, setRequestAppType] = useState('none');
    const [requestAppUrl, setRequestAppUrl] = useState('');
    const [requestAppFetchUrl, setRequestAppFetchUrl] = useState('');
    const [requestAppApiKey, setRequestAppApiKey] = useState('');
    const [requestDiscoverRegion, setRequestDiscoverRegion] = useState('');
    const [requestDiscoverLanguage, setRequestDiscoverLanguage] = useState('');
    const [requestHideAvailableMedia, setRequestHideAvailableMedia] = useState(false);
    const [discoverySource, setDiscoverySource] = useState('tmdb');
    const [requestEngine, setRequestEngine] = useState('portal');
    const [importingSeerrHistory, setImportingSeerrHistory] = useState(false);
    const [requestQuotaLimit, setRequestQuotaLimit] = useState(0);
    const [requestQuotaDays, setRequestQuotaDays] = useState(7);
    const [requestQuotaLimit4k, setRequestQuotaLimit4k] = useState(0);
    const [autoApproveMovies, setAutoApproveMovies] = useState(false);
    const [autoApproveTv, setAutoApproveTv] = useState(false);
    const [autoApproveMovies4k, setAutoApproveMovies4k] = useState(false);
    const [autoApproveTv4k, setAutoApproveTv4k] = useState(false);
    const [portalAllowRequestMovies, setPortalAllowRequestMovies] = useState(true);
    const [portalAllowRequestTv, setPortalAllowRequestTv] = useState(true);
    const [portalAllowRequest4kMovies, setPortalAllowRequest4kMovies] = useState(true);
    const [portalAllowRequest4kTv, setPortalAllowRequest4kTv] = useState(true);
    const [portalAllowAdvancedRequests, setPortalAllowAdvancedRequests] = useState(true);
    const [portalAllowRequestTags, setPortalAllowRequestTags] = useState(true);
    const [portalShowRecentlyAdded, setPortalShowRecentlyAdded] = useState(true);
    const [portalShowWatchlist, setPortalShowWatchlist] = useState(true);
    const [discoverNowPlayingEnabled, setDiscoverNowPlayingEnabled] = useState(true);
    const [homeNowPlayingCompanionEnabled, setHomeNowPlayingCompanionEnabled] = useState(true);
    const [portalAutoRequestMovies, setPortalAutoRequestMovies] = useState(false);
    const [portalAutoRequestTv, setPortalAutoRequestTv] = useState(false);
    const [seriesMetadataProvider, setSeriesMetadataProvider] = useState('tmdb');
    const [animeMetadataProvider, setAnimeMetadataProvider] = useState('tmdb');
    const [tvdbApiKey, setTvdbApiKey] = useState('');
    const [testingTvdb, setTestingTvdb] = useState(false);
    const [maintenanceExperimentalEnabled, setMaintenanceExperimentalEnabled] = useState(false);
    const [upgraderEnabled, setUpgraderEnabled] = useState(false);
    const [collexionsEnabled, setCollexionsEnabled] = useState(false);
    const [spotifyToPlexEnabled, setSpotifyToPlexEnabled] = useState(false);
    const [metadataFillEnabled, setMetadataFillEnabled] = useState(false);
    const [metadataFillAutoImport, setMetadataFillAutoImport] = useState(true);
    const [scannerEnabled, setScannerEnabled] = useState(false);
    const [scannerHomeWidgetEnabled, setScannerHomeWidgetEnabled] = useState(false);
    const [mediaAutomationEnabled, setMediaAutomationEnabled] = useState(false);
    const [mediaAutomationHomeWidgetEnabled, setMediaAutomationHomeWidgetEnabled] = useState(false);
    const [posterSetsEnabled, setPosterSetsEnabled] = useState(false);
    const [overlaysEnabled, setOverlaysEnabled] = useState(false);
    const [editionsEnabled, setEditionsEnabled] = useState(false);
    const [watchSyncEnabled, setWatchSyncEnabled] = useState(false);
    const [achievementsEnabled, setAchievementsEnabled] = useState(false);
    const [supportTicketsEnabled, setSupportTicketsEnabled] = useState(true);
    const [chatEnabled, setChatEnabled] = useState(false);
    const [chatMentionNotifyInApp, setChatMentionNotifyInApp] = useState(true);
    const [achievementsLeaderboardEnabled, setAchievementsLeaderboardEnabled] = useState(true);
    const [achievementsHomeWidgetEnabled, setAchievementsHomeWidgetEnabled] = useState(true);
    const [achievementsShowOnProfile, setAchievementsShowOnProfile] = useState(true);
    const [achievementsXpWeights, setAchievementsXpWeights] = useState<Record<string, number>>({});
    const [achievementsDisabledBadgeIds, setAchievementsDisabledBadgeIds] = useState<string[]>([]);
    const [achievementsMinPercentComplete, setAchievementsMinPercentComplete] = useState(0);
    const [achievementsSeasons, setAchievementsSeasons] = useState<import('./AchievementsSettings').AchievementsSeason[]>([]);
    const [requestAvailableNotifyEnabled, setRequestAvailableNotifyEnabled] = useState(true);
    const [requestAvailableNotifyEmail, setRequestAvailableNotifyEmail] = useState(true);
    const [requestAvailableNotifyInApp, setRequestAvailableNotifyInApp] = useState(true);
    const [requestAvailableNotifyWebPush, setRequestAvailableNotifyWebPush] = useState(true);
    const [requestAvailableNotifyDiscord, setRequestAvailableNotifyDiscord] = useState(false);
    const [requestAvailableDiscordWebhookUrl, setRequestAvailableDiscordWebhookUrl] = useState('');
    const [requestNotReleasedNotifyEnabled, setRequestNotReleasedNotifyEnabled] = useState(true);
    const [requestNotReleasedNotifyEmail, setRequestNotReleasedNotifyEmail] = useState(true);
    const [requestNotReleasedNotifyInApp, setRequestNotReleasedNotifyInApp] = useState(true);
    const [requestNotReleasedNotifyWebPush, setRequestNotReleasedNotifyWebPush] = useState(true);
    const [notifyReleaseDatePreference, setNotifyReleaseDatePreference] = useState('digital');
    const [scannerNotifyDeleted, setScannerNotifyDeleted] = useState(false);
    const [scannerNotifyUpgrade, setScannerNotifyUpgrade] = useState(false);
    const [scannerNotifyImport, setScannerNotifyImport] = useState(false);
    const [scannerNotifyGrab, setScannerNotifyGrab] = useState(false);
    const [scannerNotifyUpdate, setScannerNotifyUpdate] = useState(false);
    const [scannerNotifyInteraction, setScannerNotifyInteraction] = useState(false);
    const [webPushEnabled, setWebPushEnabled] = useState(true);
    const [summaryNotifyEnabled, setSummaryNotifyEnabled] = useState(false);
    const [summaryNotifyFrequency, setSummaryNotifyFrequency] = useState('disabled');
    const [summaryNotifyDay, setSummaryNotifyDay] = useState(0);
    const [summaryNotifyTime, setSummaryNotifyTime] = useState('23:00');
    const [summaryNotifyInApp, setSummaryNotifyInApp] = useState(true);
    const [summaryNotifyWebPush, setSummaryNotifyWebPush] = useState(true);
    const [summaryNotifyEmail, setSummaryNotifyEmail] = useState(false);
    const [summaryMetrics, setSummaryMetrics] = useState<Record<string, boolean>>({
        uptime: true,
        requests: true,
        scannerImports: true,
        collexionsRotations: true,
        mediaAutomationJobs: true,
        highlights: true,
    });
    const [notificationTemplates, setNotificationTemplates] = useState<Record<string, Record<string, string>>>({});
    const [notificationTemplateDefaults, setNotificationTemplateDefaults] = useState<Record<string, Record<string, string>>>({});
    const [notificationTemplateEvents, setNotificationTemplateEvents] = useState<string[]>([]);
    const [notificationTemplateFields, setNotificationTemplateFields] = useState<Record<string, string[]>>({});
    const [emailTemplates, setEmailTemplates] = useState<Record<string, Record<string, string>>>({});
    const [emailTemplateDefaults, setEmailTemplateDefaults] = useState<Record<string, Record<string, string>>>({});
    const [emailTemplateEvents, setEmailTemplateEvents] = useState<string[]>([]);
    const [emailTemplateFields, setEmailTemplateFields] = useState<Record<string, string[]>>({});
    const [ntfyEnabled, setNtfyEnabled] = useState(false);
    const [ntfyServerUrl, setNtfyServerUrl] = useState('');
    const [ntfyTopic, setNtfyTopic] = useState('');
    const [ntfyToken, setNtfyToken] = useState('');
    const [ntfyPriority, setNtfyPriority] = useState(3);
    const [ntfyEvents, setNtfyEvents] = useState<Record<string, boolean>>({
        available: true, approved: true, declined: true, season: true, episode: false, admin_pending: true,
        collexions_failed: true, scanner_failed: true, scanner_deleted: true, scanner_upgrade: true, scanner_import: true, scanner_grab: true, scanner_update: true, scanner_interaction: true, spotify_sync_failed: true, status_down: true, status_up: true,
        media_job_failed: true, media_job_completed: false, tautulli_api_failed: true,
        support_ticket: true, support_reply: true, support_media_issue: true,
    });
    const [webhookEnabled, setWebhookEnabled] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookHeadersJson, setWebhookHeadersJson] = useState('');
    const [webhookEvents, setWebhookEvents] = useState<Record<string, boolean>>({
        available: true, approved: false, declined: false, season: false, episode: false, admin_pending: false,
        collexions_failed: false, scanner_failed: false, scanner_deleted: false, scanner_upgrade: false, scanner_import: false, scanner_grab: false, scanner_update: false, scanner_interaction: false, spotify_sync_failed: false, status_down: false, status_up: false,
        media_job_failed: false, media_job_completed: false, tautulli_api_failed: false,
        support_ticket: false, support_reply: false, support_media_issue: false,
    });
    const [watchHistorySource, setWatchHistorySource] = useState<'plex' | 'tautulli'>('plex');
    const [tautulliConfigured, setTautulliConfigured] = useState(false);
    const [mediaAutomation, setMediaAutomation] = useState<MediaAutomationSettingsConfig>(DEFAULT_MEDIA_AUTOMATION_SETTINGS);
    const [scannerWebhooksVisible, setScannerWebhooksVisible] = useState(true);
    const [scannerManualPathVisible, setScannerManualPathVisible] = useState(true);
    const [scanner, setScanner] = useState<ScannerSettings>(defaultScannerSettings);
    const [collexionsAutostart, setCollexionsAutostart] = useState(false);
    const [collexionsInternalUrl, setCollexionsInternalUrl] = useState('');
    const [collexionsServiceKey, setCollexionsServiceKey] = useState('');
    const [spotifyToPlexInternalUrl, setSpotifyToPlexInternalUrl] = useState('');
    const [spotifyToPlexClientId, setSpotifyToPlexClientId] = useState('');
    const [spotifyToPlexClientSecret, setSpotifyToPlexClientSecret] = useState('');
    const [spotifyToPlexEncryptionKey, setSpotifyToPlexEncryptionKey] = useState('');
    const [spotifyToPlexHomeWidgetEnabled, setSpotifyToPlexHomeWidgetEnabled] = useState(false);
    const [spotifyToPlexScheduleMode, setSpotifyToPlexScheduleMode] = useState<'sidecar' | 'portal'>('sidecar');
    const [spotifyToPlexScheduledSyncIntervalHours, setSpotifyToPlexScheduledSyncIntervalHours] = useState(24);
    const [spotifySyncHealth, setSpotifySyncHealth] = useState<{ ok?: boolean; issues?: string[] } | null>(null);
    const [spotifyPortalImportMessage, setSpotifyPortalImportMessage] = useState('');
    const [spotifyPortalImporting, setSpotifyPortalImporting] = useState(false);
    const [spotifySyncStarting, setSpotifySyncStarting] = useState(false);

    useEffect(() => {
        if (activeTab !== 'spotify-sync' || !spotifyToPlexEnabled) {
            setSpotifySyncHealth(null);
            return;
        }
        let cancelled = false;
        void apiFetch('/api/spotify-to-plex/health')
            .then((data) => {
                if (!cancelled) setSpotifySyncHealth(data || null);
            })
            .catch(() => {
                if (!cancelled) setSpotifySyncHealth({ ok: false, issues: ['Health check failed'] });
            });
        return () => { cancelled = true; };
    }, [activeTab, spotifyToPlexEnabled, spotifyToPlexInternalUrl]);

    const [upgraderDefaultPreset, setUpgraderDefaultPreset] = useState('non_hevc');
    const [upgraderMinSizeGB, setUpgraderMinSizeGB] = useState(5);
    const [upgraderAutomationEnabled, setUpgraderAutomationEnabled] = useState(false);
    const [upgraderMaxActionsPerHour, setUpgraderMaxActionsPerHour] = useState(25);
    const [upgraderDefaultSort, setUpgraderDefaultSort] = useState('sizeGB');
    const [upgraderDrawerPosition, setUpgraderDrawerPosition] = useState('sidebar');
    const [upgraderProfileMap, setUpgraderProfileMap] = useState<Record<string, { hevcProfileId: number; fallbackProfileId?: number }>>({});
    const [upgraderProfileInstances, setUpgraderProfileInstances] = useState<any[]>([]);
    const [loadingUpgraderProfiles, setLoadingUpgraderProfiles] = useState(false);
    const [dashboardLayout, setDashboardLayout] = useState<DashboardLayoutConfig>(DEFAULT_DASHBOARD_LAYOUT);
    const dashboardLayoutRef = useRef<DashboardLayoutConfig>(DEFAULT_DASHBOARD_LAYOUT);

    const updateDashboardLayout = useCallback((next: DashboardLayoutConfig) => {
        dashboardLayoutRef.current = next;
        setDashboardLayout(next);
    }, []);

    // Branding & UI States
    const [customLogoUrl, setCustomLogoUrl] = useState('');
    const [customLoginLogoUrl, setCustomLoginLogoUrl] = useState('');
    const [loginLogoCircleFrame, setLoginLogoCircleFrame] = useState(true);
    const [customFaviconUrl, setCustomFaviconUrl] = useState('');
    const [customBadgeUrl, setCustomBadgeUrl] = useState('');
    const [backgroundImageUrl, setBackgroundImageUrl] = useState('');
    const [useScrollRevealAnimations, setUseScrollRevealAnimations] = useState(false);
    const [useCinematicLoading, setUseCinematicLoading] = useState(false);
    const [useBrandedSkeleton, setUseBrandedSkeleton] = useState(true);
    const [useTrendingSlideshow, setUseTrendingSlideshow] = useState(false);
    const [trendingSlideshowInterval, setTrendingSlideshowInterval] = useState(30);
    const [tmdbApiKey, setTmdbApiKey] = useState('');
    const [brandingTheme, setBrandingTheme] = useState('plex');
    const [sidebarIdentityPosition, setSidebarIdentityPosition] = useState<'top' | 'bottom'>('bottom');
    const [pwaIconSource, setPwaIconSource] = useState<'server' | 'application'>('server');
    const [referralEnabled, setReferralEnabled] = useState(false);
    const [referralTrialDays, setReferralTrialDays] = useState(3);
    const [referralRewardDays, setReferralRewardDays] = useState(7);
    const [announcement, setAnnouncement] = useState('');
    const [expiredPortalTitle, setExpiredPortalTitle] = useState('');
    const [expiredPortalMessage, setExpiredPortalMessage] = useState('');
    const [isPushingAnnouncement, setIsPushingAnnouncement] = useState(false);
    const [use24HourClock, setUse24HourClock] = useState(initialSettings?.use24HourClock || false);
    const [showPosterQualityBadges, setShowPosterQualityBadges] = useState(initialSettings?.showPosterQualityBadges !== false);
    const [showDashboardWatchingBadge, setShowDashboardWatchingBadge] = useState(!!initialSettings?.showDashboardWatchingBadge);
    const [dashboardWatchingBadgePollSeconds, setDashboardWatchingBadgePollSeconds] = useState(
        Math.min(15, Math.max(1, Number(initialSettings?.dashboardWatchingBadgePollSeconds) || 15)),
    );
    const [showPublicStatusMonitor, setShowPublicStatusMonitor] = useState(initialSettings?.showPublicStatusMonitor !== false);
    const [showPublicLibraryStats, setShowPublicLibraryStats] = useState(initialSettings?.showPublicLibraryStats !== false);
    const [allowTemporaryAccess, setAllowTemporaryAccess] = useState(initialSettings?.allowTemporaryAccess || false);
    const [navOrder, setNavOrder] = useState<string[]>(() => ensureCompleteNavOrder([...DEFAULT_NAV_ORDER]));
    const [navHiddenKeys, setNavHiddenKeys] = useState<string[]>([]);
    const [memberNavOrder, setMemberNavOrder] = useState<string[]>(() => deriveMemberNavOrderFromAdmin([...DEFAULT_NAV_ORDER]));
    const [memberNavHiddenKeys, setMemberNavHiddenKeys] = useState<string[]>([]);
    const [customNavTabs, setCustomNavTabs] = useState<CustomNavTab[]>([]);
    const [navItemIcons, setNavItemIcons] = useState<NavItemIconsMap>({});
    const [customNavDisplay, setCustomNavDisplay] = useState<'links' | 'applets'>('links');
    const [arrOpenInPortalEmbed, setArrOpenInPortalEmbed] = useState(false);
    const [homeCustomModules, setHomeCustomModules] = useState<HomeCustomModule[]>([]);
    const [downloadsVisibleToMembers, setDownloadsVisibleToMembers] = useState(true);
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [loginLogoFile, setLoginLogoFile] = useState<File | null>(null);
    const [faviconFile, setFaviconFile] = useState<File | null>(null);
    const [badgeFile, setBadgeFile] = useState<File | null>(null);
    const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
    const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
    const [loginLogoPreviewUrl, setLoginLogoPreviewUrl] = useState('');
    const [backgroundPreviewUrl, setBackgroundPreviewUrl] = useState('');
    const logoPreviewObjectUrlRef = useRef('');
    const loginLogoPreviewObjectUrlRef = useRef('');
    const backgroundPreviewObjectUrlRef = useRef('');
    const [tasks, setTasks] = useState<any[]>([]);
    const [diagnostics, setDiagnostics] = useState<any>(null);
    const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
    const [backupRestoreText, setBackupRestoreText] = useState('');
    const [isRestoringBackup, setIsRestoringBackup] = useState(false);
    const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
    const [autoBackupIntervalDays, setAutoBackupIntervalDays] = useState(2);
    const [autoBackupRetentionCount, setAutoBackupRetentionCount] = useState(10);
    const [backupFiles, setBackupFiles] = useState<any[]>([]);
    const [auditLogEntries, setAuditLogEntries] = useState<any[]>([]);
    const [auditLogEvents, setAuditLogEvents] = useState<string[]>([]);
    const [auditLogTotal, setAuditLogTotal] = useState(0);
    const [auditLogTotalAll, setAuditLogTotalAll] = useState(0);
    const [auditFilterEvent, setAuditFilterEvent] = useState('');
    const [auditFilterUser, setAuditFilterUser] = useState('');
    const [auditFilterFrom, setAuditFilterFrom] = useState('');
    const [auditFilterTo, setAuditFilterTo] = useState('');
    const [auditFilterPresets, setAuditFilterPresets] = useState<AuditFilterPreset[]>(() => readAuditFilterPresets());
    const [selectedAuditPresetId, setSelectedAuditPresetId] = useState('');
    const [isLoadingAuditLog, setIsLoadingAuditLog] = useState(false);
    const [isExportingAuditLog, setIsExportingAuditLog] = useState(false);
    const [isExportingAuditCsv, setIsExportingAuditCsv] = useState(false);
    const [refreshingDiscoveryCache, setRefreshingDiscoveryCache] = useState(false);
    const [auditLogPage, setAuditLogPage] = useState(1);
    const [deletedUsersLog, setDeletedUsersLog] = useState<any[]>([]);
    const [emailLogPage, setEmailLogPage] = useState(1);

    const clearLogoPreview = useCallback(() => {
        if (logoPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(logoPreviewObjectUrlRef.current);
            logoPreviewObjectUrlRef.current = '';
        }
        setLogoPreviewUrl('');
    }, []);

    const clearBackgroundPreview = useCallback(() => {
        if (backgroundPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(backgroundPreviewObjectUrlRef.current);
            backgroundPreviewObjectUrlRef.current = '';
        }
        setBackgroundPreviewUrl('');
    }, []);

    const clearLoginLogoPreview = useCallback(() => {
        if (loginLogoPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(loginLogoPreviewObjectUrlRef.current);
            loginLogoPreviewObjectUrlRef.current = '';
        }
        setLoginLogoPreviewUrl('');
    }, []);

    const handleLogoFileChange = useCallback((file: File | null) => {
        clearLogoPreview();
        setLogoFile(file);
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        logoPreviewObjectUrlRef.current = objectUrl;
        setLogoPreviewUrl(objectUrl);
        setCustomLogoUrl(getUploadedBrandingImagePath(file, 'logo'));
    }, [clearLogoPreview]);

    const handleLoginLogoFileChange = useCallback((file: File | null) => {
        clearLoginLogoPreview();
        setLoginLogoFile(file);
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        loginLogoPreviewObjectUrlRef.current = objectUrl;
        setLoginLogoPreviewUrl(objectUrl);
        setCustomLoginLogoUrl(getUploadedBrandingImagePath(file, 'login'));
    }, [clearLoginLogoPreview]);

    const handleFaviconFileChange = useCallback((file: File | null) => {
        setFaviconFile(file);
        if (!file) return;
        setCustomFaviconUrl(getUploadedBrandingImagePath(file, 'favicon'));
    }, []);

    const handleBadgeFileChange = useCallback((file: File | null) => {
        setBadgeFile(file);
    }, []);

    const handleBackgroundFileChange = useCallback((file: File | null) => {
        clearBackgroundPreview();
        setBackgroundFile(file);
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        backgroundPreviewObjectUrlRef.current = objectUrl;
        setBackgroundPreviewUrl(objectUrl);
        setBackgroundImageUrl(getUploadedBrandingImagePath(file, 'background'));
    }, [clearBackgroundPreview]);

    useEffect(() => () => {
        if (logoPreviewObjectUrlRef.current) URL.revokeObjectURL(logoPreviewObjectUrlRef.current);
        if (loginLogoPreviewObjectUrlRef.current) URL.revokeObjectURL(loginLogoPreviewObjectUrlRef.current);
        if (backgroundPreviewObjectUrlRef.current) URL.revokeObjectURL(backgroundPreviewObjectUrlRef.current);
    }, []);

    const handlePushAnnouncement = async () => {
        setIsPushingAnnouncement(true);
        try {
            const res = await apiFetch('/api/announcements/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: announcement, sendEmail: true })
            });
            if (res.error) throw new Error(res.error);
            addToast('Announcement saved and email push started (staggered over 30 mins).');
        } catch (e: any) {
            addToast(e.message || 'Failed to push announcement', 'error');
        } finally {
            setIsPushingAnnouncement(false);
        }
    };

    const fetchTasks = async () => {
        try {
            const data = await apiFetch('/api/tasks');
            setTasks(data);
        } catch (e) {
            addToast('Failed to load tasks', 'error');
        }
    };

    const fetchDiagnostics = async () => {
        setIsLoadingDiagnostics(true);
        try {
            const data = await apiFetch('/api/admin/diagnostics');
            setDiagnostics(data);
        } catch (e) {
            addToast('Failed to load diagnostics', 'error');
        } finally {
            setIsLoadingDiagnostics(false);
        }
    };

    const fetchBackupFiles = async () => {
        try {
            const data = await apiFetch('/api/admin/backups');
            setBackupFiles(Array.isArray(data) ? data : []);
        } catch (e) {
            addToast('Failed to load backup files', 'error');
        }
    };

    const buildAuditLogQuery = useCallback((limit = 500) => {
        const params = new URLSearchParams();
        if (auditFilterEvent) params.set('event', auditFilterEvent);
        if (auditFilterUser.trim()) params.set('user', auditFilterUser.trim());
        if (auditFilterFrom) params.set('from', auditFilterFrom);
        if (auditFilterTo) params.set('to', auditFilterTo);
        params.set('limit', String(limit));
        return params.toString();
    }, [auditFilterEvent, auditFilterFrom, auditFilterTo, auditFilterUser]);

    const applyAuditFilterPreset = useCallback((presetId: string) => {
        setSelectedAuditPresetId(presetId);
        const preset = auditFilterPresets.find((entry) => entry.id === presetId);
        if (!preset) return;
        setAuditFilterEvent(preset.event || '');
        setAuditFilterUser(preset.user || '');
        setAuditFilterFrom(preset.from || '');
        setAuditFilterTo(preset.to || '');
    }, [auditFilterPresets]);

    const saveAuditFilterPreset = useCallback(() => {
        const name = window.prompt(t('settings.logs.filters.savePresetPrompt'))?.trim();
        if (!name) {
            if (name === '') addToast(t('settings.logs.filters.presetNameRequired'), 'error');
            return;
        }
        const next: AuditFilterPreset = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            event: auditFilterEvent,
            user: auditFilterUser,
            from: auditFilterFrom,
            to: auditFilterTo,
        };
        const presets = [next, ...auditFilterPresets.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase())].slice(0, 20);
        setAuditFilterPresets(presets);
        writeAuditFilterPresets(presets);
        setSelectedAuditPresetId(next.id);
        addToast(t('settings.logs.filters.presetSaved'), 'success');
    }, [addToast, auditFilterEvent, auditFilterFrom, auditFilterPresets, auditFilterTo, auditFilterUser, t]);

    const deleteSelectedAuditFilterPreset = useCallback(() => {
        if (!selectedAuditPresetId) return;
        const presets = auditFilterPresets.filter((entry) => entry.id !== selectedAuditPresetId);
        setAuditFilterPresets(presets);
        writeAuditFilterPresets(presets);
        setSelectedAuditPresetId('');
        addToast(t('settings.logs.filters.presetDeleted'), 'success');
    }, [addToast, auditFilterPresets, selectedAuditPresetId, t]);

    const auditSubjectLabel = (party?: { username?: string | null; email?: string | null } | null) =>
        String(party?.username || party?.email || '').trim();

    const openAuditSubjectUsers = (party?: { username?: string | null; email?: string | null } | null) => {
        const label = auditSubjectLabel(party);
        if (!label) return;
        window.location.assign(portalUrl(`/users?q=${encodeURIComponent(label)}`));
    };

    const openAuditSubjectAnalytics = (party?: { username?: string | null; email?: string | null } | null) => {
        const label = String(party?.username || '').trim();
        if (!label) return;
        window.location.assign(portalUrl(`/analytics#user=${encodeURIComponent(label)}`));
    };

    const fetchAuditLog = async () => {
        setIsLoadingAuditLog(true);
        try {
            const data = await apiFetch(`/api/audit-log?${buildAuditLogQuery(500)}`);
            const entries = Array.isArray(data?.entries) ? data.entries : (Array.isArray(data) ? data : []);
            setAuditLogEntries(entries);
            setAuditLogEvents(Array.isArray(data?.events) ? data.events : []);
            setAuditLogTotal(Number(data?.total) || entries.length);
            setAuditLogTotalAll(Number(data?.totalAll) || entries.length);
            setAuditLogPage(1);
            setEmailLogPage(1);
        } catch (e) {
            addToast(t('settings.logs.errors.loadAuditLog'), 'error');
        } finally {
            setIsLoadingAuditLog(false);
        }
    };

    const exportAuditLog = async () => {
        setIsExportingAuditLog(true);
        try {
            const data = await apiFetch('/api/audit-log/export');
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `portal-audit-export-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            addToast(t('settings.logs.toasts.auditExported'), 'success');
        } catch (e) {
            addToast(e instanceof Error ? e.message : t('settings.logs.errors.exportAuditLog'), 'error');
        } finally {
            setIsExportingAuditLog(false);
        }
    };

    const exportAuditLogCsv = async () => {
        setIsExportingAuditCsv(true);
        try {
            const response = await fetch(portalUrl(`/api/audit-log/export.csv?${buildAuditLogQuery(2000)}`), {
                credentials: 'same-origin',
                headers: { [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE },
            });
            if (!response.ok) {
                let message = t('settings.logs.errors.exportAuditCsv');
                try {
                    const body = await response.json();
                    if (body?.error) message = String(body.error);
                } catch { /* ignore */ }
                throw new Error(message);
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `portal-audit-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            addToast(t('settings.logs.toasts.auditCsvExported'), 'success');
        } catch (e) {
            addToast(e instanceof Error ? e.message : t('settings.logs.errors.exportAuditCsv'), 'error');
        } finally {
            setIsExportingAuditCsv(false);
        }
    };

    const refreshDiscoveryAvailabilityCache = async () => {
        setRefreshingDiscoveryCache(true);
        try {
            const res = await apiFetch('/api/tasks/run/discoveryAvailabilityCache', { method: 'POST' });
            addToast(res.message || 'Discovery availability rebuild started.', 'success');
            await fetchTasks();
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Failed to refresh availability cache', 'error');
        } finally {
            setRefreshingDiscoveryCache(false);
        }
    };

    const fetchDeletedUsersLog = async () => {
        try {
            const data = await apiFetch('/api/deleted-users');
            setDeletedUsersLog(Array.isArray(data) ? data : []);
        } catch (e) {
            addToast(t('settings.logs.errors.loadDeletedUsers'), 'error');
        }
    };

    const handleDownloadBackup = async () => {
        try {
            const response = await fetch(portalUrl('/api/admin/backup'), {
                credentials: 'same-origin',
                headers: { [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE },
            });
            if (!response.ok) throw new Error('Backup download failed');
            const text = await response.text();
            const blob = new Blob([text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `portal-backup-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            addToast('Backup downloaded successfully.');
        } catch (e: any) {
            addToast(e.message || 'Backup download failed', 'error');
        }
    };

    const handleCreateBackupFile = async () => {
        try {
            const res = await apiFetch('/api/admin/backups/create', { method: 'POST' });
            addToast(res?.filename ? `Backup created: ${res.filename}` : 'Backup created successfully.');
            await fetchBackupFiles();
            await fetchDiagnostics();
        } catch (e: any) {
            addToast(e.message || 'Failed to create backup file', 'error');
        }
    };

    const handleRestoreBackup = async () => {
        if (!backupRestoreText.trim()) {
            addToast('Paste a backup JSON payload before restoring.', 'error');
            return;
        }
        appConfirm('Restore backup now? This overwrites current data files.', async () => {
            setIsRestoringBackup(true);
            try {
                const response = await fetch(portalUrl('/api/admin/backup/restore?confirm=true'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'text/plain',
                        'x-confirm-restore': 'true',
                        [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
                    },
                    body: backupRestoreText
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || 'Backup restore failed');
                addToast(data.message || 'Backup restored successfully.');
                await Promise.all([fetchDiagnostics(), fetchTasks()]);
            } catch (e: any) {
                addToast(e.message || 'Backup restore failed', 'error');
            } finally {
                setIsRestoringBackup(false);
            }
        });
    };

    const handleRestoreFromFile = async (filename: string) => {
        appConfirm(`Restore from backup file "${filename}"? This will overwrite current data.`, async () => {
            try {
                const res = await apiFetch('/api/admin/backups/restore-file', {
                    method: 'POST',
                    body: JSON.stringify({ filename, confirm: true })
                });
                addToast(res?.message || 'Backup restored from file successfully.');
                await Promise.all([fetchDiagnostics(), fetchTasks(), fetchBackupFiles()]);
            } catch (e: any) {
                addToast(e.message || 'Failed to restore backup file', 'error');
            }
        });
    };

    const renderConfigPill = (configured: boolean) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${configured ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
            {configured ? 'Configured' : 'Missing'}
        </span>
    );

    const renderOptionalPill = (enabled: boolean, configured: boolean) => {
        if (!enabled) {
            return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-muted border border-border">
                    Disabled
                </span>
            );
        }
        return renderConfigPill(configured);
    };

    const renderOptionalIntegrationPill = (configured: boolean) => {
        if (configured) {
            return renderConfigPill(true);
        }
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-muted border border-border">
                Optional
            </span>
        );
    };

    const trackedIntegrationKeys = useMemo(() => {
        const mediaKey = mediaServerType !== 'plex' ? 'jellyfinConfigured' : 'plexConfigured';
        const analyticsKey = mediaServerType !== 'plex' ? 'jellyfinAnalyticsConfigured' : 'tautulliConfigured';
        return [mediaKey, 'sonarrConfigured', 'radarrConfigured', 'lidarrConfigured', 'bazarrConfigured', analyticsKey, 'requestAppConfigured'];
    }, [mediaServerType]);
    const integrationLabels: Record<string, string> = {
        jellyfinConfigured: 'Jellyfin',
        plexConfigured: 'Plex',
        sonarrConfigured: 'Sonarr',
        radarrConfigured: 'Radarr',
        lidarrConfigured: 'Lidarr',
        bazarrConfigured: 'Bazarr',
        tautulliConfigured: 'Tautulli',
        jellystatConfigured: 'Jellystat',
        jellyglanceConfigured: 'JellyGlance',
        jellyfinAnalyticsConfigured: jellyfinAnalyticsProvider === 'jellyglance' ? 'JellyGlance' : 'Jellystat',
        requestAppConfigured: 'Request App',
    };

    useEffect(() => {
        if (activeTab === 'tasks' || activeTab === 'system' || activeTab === 'request') {
            fetchTasks();
        }
        if (activeTab === 'system') {
            fetchDiagnostics();
            fetchBackupFiles();
            fetchAuditLog();
        }
        if (activeTab === 'logs') {
            fetchDeletedUsersLog();
            fetchAuditLog();
        }
    }, [activeTab]);

    const discoveryAvailabilityTask = useMemo(
        () => (Array.isArray(tasks) ? tasks.find((task) => task.id === 'discoveryAvailabilityCache') : null),
        [tasks],
    );

    const tasksNeedLivePoll = useMemo(() => {
        if (!['tasks', 'system', 'request'].includes(activeTab)) return false;
        return Array.isArray(tasks) && tasks.some((task) => !!task?.running);
    }, [activeTab, tasks]);

    usePoll(() => { void fetchTasks(); }, tasksNeedLivePoll ? 2000 : null, { immediate: false });

    const handleUnblockDeletedUser = async (deletedUser: any) => {
        const label = deletedUser.username || deletedUser.email || t('settings.logs.fallbacks.thisUser');
        appConfirm(t('settings.logs.dialogs.unblockUser', { name: label }), async () => {
            setLoading(true);
            try {
                await apiFetch(`/api/deleted-users/${encodeURIComponent(deletedUser.blockId)}`, { method: 'DELETE' });
                addToast(t('settings.logs.toasts.userUnblocked'));
                await Promise.all([fetchDeletedUsersLog(), fetchAuditLog()]);
            } catch (error: any) {
                addToast(error instanceof Error ? error.message : t('settings.logs.errors.unblockUser'), 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    const formatEventName = (event: string) => event
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

    const formatDateTime = (value?: string | null) => {
        if (!value) return t('settings.logs.fallbacks.notAvailable');
        const formatted = formatPortalDateTime(value);
        return formatted === 'Unknown' ? t('settings.logs.fallbacks.notAvailable') : formatted;
    };

    const stringifyAuditValue = (value: any) => {
        if (value === null || value === undefined) return '—';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    };

    const getAuditDiffRows = (details: any) => {
        if (!details || typeof details !== 'object') return [];
        const rows: { field: string; before: string; after: string }[] = [];
        const keys = Object.keys(details);
        const used = new Set<string>();
        const pairCandidate = (primaryKey: string, label: string, candidates: string[]) => {
            if (used.has(primaryKey)) return;
            for (const key of candidates) {
                if (key in details) {
                    rows.push({
                        field: label,
                        before: stringifyAuditValue(details[primaryKey]),
                        after: stringifyAuditValue(details[key])
                    });
                    used.add(primaryKey);
                    used.add(key);
                    return;
                }
            }
        };

        if ('before' in details && 'after' in details) {
            rows.push({ field: t('settings.logs.audit.value'), before: stringifyAuditValue(details.before), after: stringifyAuditValue(details.after) });
            used.add('before');
            used.add('after');
        }
        if ('oldValue' in details && 'newValue' in details) {
            rows.push({ field: t('settings.logs.audit.value'), before: stringifyAuditValue(details.oldValue), after: stringifyAuditValue(details.newValue) });
            used.add('oldValue');
            used.add('newValue');
        }

        keys.forEach((key) => {
            if (used.has(key)) return;
            if (!key.startsWith('previous')) return;
            const suffix = key.replace(/^previous/, '');
            if (!suffix) return;
            const lowerSuffix = suffix.charAt(0).toLowerCase() + suffix.slice(1);
            pairCandidate(key, suffix, [lowerSuffix, `new${suffix}`, `current${suffix}`]);
        });
        return rows;
    };

    const systemHealth = useMemo(() => {
        if (!diagnostics) {
            return {
                score: 0,
                status: 'Unknown',
                alerts: ['Diagnostics have not been loaded yet.'],
                integrationsConfigured: 0,
                integrationsTotal: 0,
                cacheHealthy: 0,
                cacheTotal: 0,
                runningJobs: 0,
                failingJobs: 0
            };
        }

        const integrations = diagnostics.integrations || {};
        const trackedIntegrations = trackedIntegrationKeys
            .filter((key) => key !== 'requestAppConfigured' || integrations.requestAppEnabled)
            .map((key) => [key, !!integrations[key]] as const);
        const cacheEntries = Object.entries(diagnostics.caches || {}).filter(([key]) => {
            if (!maintenanceExperimentalEnabled) {
                if (key.startsWith('maintenance')) return false;
            }
            if (mediaServerType !== 'plex' && key === 'plexStats') return false;
            return true;
        });
        const cacheValues = cacheEntries.map(([, entry]: any) => !!entry?.exists);
        const jobs = Array.isArray(diagnostics.jobs) ? diagnostics.jobs : [];
        const integrationsConfigured = trackedIntegrations.filter(([, configured]) => configured).length;
        const integrationsTotal = trackedIntegrations.length;
        const cacheHealthy = cacheValues.filter(Boolean).length;
        const cacheTotal = cacheValues.length;
        const runningJobs = jobs.filter((job: any) => !!job.running).length;
        const failingJobs = jobs.filter((job: any) => !!job.lastError).length;
        const warningJobs = jobs.filter((job: any) => !job.lastError && !!job.lastWarning).length;
        const alerts: string[] = [];

        // Not-configured integrations are informational only — they must not drag the
        // health score (issue #74). Score reflects caches + job health of the setup in use.
        if (cacheHealthy < cacheTotal) {
            alerts.push(`${cacheTotal - cacheHealthy} cache file(s) have not been built yet.`);
        }
        if (failingJobs > 0) {
            alerts.push(`${failingJobs} background job(s) reported recent errors.`);
        }
        if (warningJobs > 0) {
            alerts.push(`${warningJobs} background job(s) finished with a warning — last-good totals were kept.`);
        }
        if (diagnostics?.backup?.enabled && !diagnostics?.backup?.lastRunAt) {
            alerts.push('Auto backup is enabled but has not completed a run yet.');
        }

        const maxPenalty = 55;
        const integrationPenalty = 0;
        const cachePenalty = cacheTotal > 0 ? Math.round(((cacheTotal - cacheHealthy) / cacheTotal) * 20) : 0;
        const jobPenalty = Math.min(10, failingJobs * 5);
        const penalty = Math.min(maxPenalty, integrationPenalty + cachePenalty + jobPenalty);
        const score = Math.max(0, 100 - penalty);
        const status = score >= 85 ? 'Healthy' : score >= 65 ? 'Watch' : 'Needs Attention';

        return {
            score,
            status,
            alerts,
            integrationsConfigured,
            // Denominator matches configured only — not-configured apps are out of scope for health.
            integrationsTotal: integrationsConfigured,
            cacheHealthy,
            cacheTotal,
            runningJobs,
            failingJobs
        };
    }, [diagnostics, maintenanceExperimentalEnabled, mediaServerType, trackedIntegrationKeys]);

    const auditEventsPerPage = 12;
    const totalAuditLogPages = Math.max(1, Math.ceil(auditLogEntries.length / auditEventsPerPage));
    const pagedAuditEntries = auditLogEntries.slice((auditLogPage - 1) * auditEventsPerPage, auditLogPage * auditEventsPerPage);
    const emailAuditEntries = auditLogEntries.filter(entry => entry.event === 'system_email_sent');
    const emailsPerPage = 12;
    const totalEmailLogPages = Math.max(1, Math.ceil(emailAuditEntries.length / emailsPerPage));
    const pagedEmailEntries = emailAuditEntries.slice((emailLogPage - 1) * emailsPerPage, emailLogPage * emailsPerPage);

    const handleRunTask = async (taskId: string) => {
        setLoading(true);
        try {
            const res = await apiFetch(`/api/tasks/run/${taskId}`, { method: 'POST' });
            addToast(res.message || 'Task executed successfully', 'success');
            await fetchTasks();
            // Poll briefly so "Running" stays accurate after Run is clicked.
            window.setTimeout(() => { fetchTasks(); }, 1500);
            window.setTimeout(() => { fetchTasks(); }, 4000);
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Task failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isConfigLoaded) {
            setToken(initialSettings.token || '');
            setMediaServerType(['jellyfin', 'emby'].includes(initialSettings.mediaServerType) ? initialSettings.mediaServerType : 'plex');
            setPlexServerUrl(initialSettings.plexServerUrl || '');
            setJellyfinUrl(initialSettings.jellyfinUrl || '');
            setJellyfinApiKey(initialSettings.jellyfinApiKey || '');
            setSelectedServer(initialSettings.serverIdentifier || '');
            setCheckInterval(initialSettings.checkIntervalMinutes || 60);
            setSmtpHost(initialSettings.smtpHost || '');
            setSmtpPort(initialSettings.smtpPort || 587);
            setSmtpUser(initialSettings.smtpUser || '');
            setSmtpPass(initialSettings.smtpPass || '');
            setSmtpFrom(initialSettings.smtpFrom || '');
            setSmtpSecure(!!initialSettings.smtpSecure);
            setEmailDaysBefore(initialSettings.emailDaysBefore || 7);
            setGotifyEnabled(!!initialSettings.gotifyEnabled);
            setGotifyUrl(initialSettings.gotifyUrl || '');
            setGotifyToken(initialSettings.gotifyToken || '');
            setGotifyPriority(initialSettings.gotifyPriority || 5);
            setAlertRules({ ...DEFAULT_ALERT_RULES, ...(initialSettings.alertRules || {}) });
            setNewsletterFrequency(initialSettings.newsletterFrequency || 'disabled');
            setNewsletterDay(initialSettings.newsletterDay || 0);
            setInactiveCleanupEnabled(!!initialSettings.inactiveCleanupEnabled);
            setInactiveCleanupDays(initialSettings.inactiveCleanupDays || 90);
            setPublicDomain(initialSettings.publicDomain || '');
            setRequestUrl(initialSettings.requestUrl || 'https://yourdomain.com');
            setContactUrl(initialSettings.contactUrl || '');
            setContactWhatsApp(initialSettings.contactWhatsApp || '');
            setContactEmail(initialSettings.contactEmail || '');
            const loadedArrInstances = normalizeArrInstancesFromSettings(initialSettings);
            setArrInstances(loadedArrInstances);
            setSavedArrInstances(loadedArrInstances.map((entry) => ({ ...entry })));
            setDownloadClients(Array.isArray(initialSettings.downloadClients) ? initialSettings.downloadClients : []);
            setTautulliUrl(initialSettings.tautulliUrl || '');
            setNotifyTautulliApiFailed(initialSettings.notifyTautulliApiFailed !== false);
            setTautulliApiKey(initialSettings.tautulliApiKey || '');
            setJellyfinAnalyticsProvider(initialSettings.jellyfinAnalyticsProvider === 'jellystat' ? 'jellystat' : 'jellyglance');
            setJellystatUrl(initialSettings.jellystatUrl || '');
            setJellystatApiKey(initialSettings.jellystatApiKey || '');
            setJellyglanceUrl(initialSettings.jellyglanceUrl || '');
            setJellyglanceApiKey(initialSettings.jellyglanceApiKey || '');
            setRequestAppType(
                initialSettings.requestAppType === 'overseerr'
                    ? 'seerr'
                    : (initialSettings.requestAppType === 'jellyseerr' || initialSettings.requestAppType === 'seerr'
                        ? initialSettings.requestAppType
                        : 'none'),
            );
            setRequestAppUrl(initialSettings.requestAppUrl || '');
            setRequestAppFetchUrl(initialSettings.requestAppFetchUrl || '');
            setRequestAppApiKey(initialSettings.requestAppApiKey || '');
            setRequestDiscoverRegion(initialSettings.requestDiscoverRegion || '');
            setRequestDiscoverLanguage(initialSettings.requestDiscoverLanguage || '');
            setRequestHideAvailableMedia(!!initialSettings.requestHideAvailableMedia);
            setDiscoverySource(initialSettings.discoverySource === 'seerr' ? 'seerr' : 'tmdb');
            setRequestEngine(initialSettings.requestEngine === 'seerr' ? 'seerr' : 'portal');
            setRequestQuotaLimit(Number(initialSettings.requestQuotaLimit) || 0);
            setRequestQuotaDays(Number(initialSettings.requestQuotaDays) || 7);
            setRequestQuotaLimit4k(Number(initialSettings.requestQuotaLimit4k) || 0);
            setAutoApproveMovies(!!initialSettings.autoApproveMovies);
            setAutoApproveTv(!!initialSettings.autoApproveTv);
            setAutoApproveMovies4k(!!initialSettings.autoApproveMovies4k);
            setAutoApproveTv4k(!!initialSettings.autoApproveTv4k);
            setPortalAllowRequestMovies(initialSettings.portalAllowRequestMovies !== false);
            setPortalAllowRequestTv(initialSettings.portalAllowRequestTv !== false);
            setPortalAllowRequest4kMovies(initialSettings.portalAllowRequest4kMovies !== false);
            setPortalAllowRequest4kTv(initialSettings.portalAllowRequest4kTv !== false);
            setPortalAllowAdvancedRequests(initialSettings.portalAllowAdvancedRequests !== false);
            setPortalAllowRequestTags(initialSettings.portalAllowRequestTags !== false);
            setPortalShowRecentlyAdded(initialSettings.portalShowRecentlyAdded !== false);
            setPortalShowWatchlist(initialSettings.portalShowWatchlist !== false);
            setDiscoverNowPlayingEnabled(initialSettings.discoverNowPlayingEnabled !== false);
            setHomeNowPlayingCompanionEnabled(initialSettings.homeNowPlayingCompanionEnabled !== false);
            setPortalAutoRequestMovies(!!initialSettings.portalAutoRequestMovies);
            setPortalAutoRequestTv(!!initialSettings.portalAutoRequestTv);
            setSeriesMetadataProvider(initialSettings.seriesMetadataProvider === 'tvdb' ? 'tvdb' : 'tmdb');
            setAnimeMetadataProvider(initialSettings.animeMetadataProvider === 'tvdb' ? 'tvdb' : 'tmdb');
            setTvdbApiKey(initialSettings.tvdbApiKey || '');
            const savedBrandingTheme = localStorage.getItem('portal-theme') || initialSettings.brandingTheme || 'plex';
            setBrandingTheme(savedBrandingTheme === 'light' ? 'plex' : savedBrandingTheme);
            setCustomLogoUrl(initialSettings.mediaServerType === 'emby' && isJellyfinBrandingAsset(initialSettings.customLogoUrl) ? '' : (initialSettings.customLogoUrl || ''));
            setCustomLoginLogoUrl(initialSettings.customLoginLogoUrl || '');
            setLoginLogoCircleFrame(initialSettings.loginLogoCircleFrame !== false);
            setCustomFaviconUrl(initialSettings.customFaviconUrl || '');
            setCustomBadgeUrl(initialSettings.customBadgeUrl || '');
            setSidebarIdentityPosition(initialSettings.sidebarIdentityPosition === 'top' ? 'top' : 'bottom');
            setPwaIconSource(initialSettings.pwaIconSource === 'application' ? 'application' : 'server');
            setBackgroundImageUrl(initialSettings.mediaServerType === 'emby' && isJellyfinBrandingAsset(initialSettings.backgroundImageUrl) ? '' : (initialSettings.backgroundImageUrl || ''));
            setUseScrollRevealAnimations(!!initialSettings.useScrollRevealAnimations);
            setUseCinematicLoading(!!initialSettings.useCinematicLoading);
            setUseBrandedSkeleton(initialSettings.useBrandedSkeleton !== false);
            setUseTrendingSlideshow(!!initialSettings.useTrendingSlideshow);
            setTrendingSlideshowInterval(initialSettings.trendingSlideshowInterval || 30);
            setTmdbApiKey(initialSettings.tmdbApiKey || '');
            setReferralEnabled(!!initialSettings.referralEnabled);
            setReferralTrialDays(initialSettings.referralTrialDays || 3);
            setReferralRewardDays(initialSettings.referralRewardDays || 7);
            setAnnouncement(initialSettings.announcement || '');
            setExpiredPortalTitle(initialSettings.expiredPortalTitle || '');
            setExpiredPortalMessage(initialSettings.expiredPortalMessage || '');
            if (initialSettings.navOrder) setNavOrder(ensureCompleteNavOrder(initialSettings.navOrder));
            setNavHiddenKeys(normalizeNavHiddenKeys(initialSettings.navHiddenKeys, initialSettings.customNavTabs));
            setMemberNavOrder(resolveMemberNavOrder(initialSettings.memberNavOrder, initialSettings.navOrder, initialSettings.customNavTabs));
            setMemberNavHiddenKeys(normalizeMemberNavHiddenKeys(initialSettings.memberNavHiddenKeys, initialSettings.customNavTabs));
            if (Array.isArray(initialSettings.customNavTabs)) setCustomNavTabs(initialSettings.customNavTabs);
            setNavItemIcons(initialSettings.navItemIcons && typeof initialSettings.navItemIcons === 'object' ? initialSettings.navItemIcons : {});
            setCustomNavDisplay(initialSettings.customNavDisplay === 'applets' ? 'applets' : 'links');
            setArrOpenInPortalEmbed(!!initialSettings.arrOpenInPortalEmbed);
            if (Array.isArray(initialSettings.homeCustomModules)) setHomeCustomModules(initialSettings.homeCustomModules);
            if (initialSettings.downloadsVisibleToMembers !== undefined) {
                setDownloadsVisibleToMembers(!!initialSettings.downloadsVisibleToMembers);
            }
            setHideStreamUsers(initialSettings.hideStreamUsers === true ? 'anonymous' : (initialSettings.hideStreamUsers || 'false'));
            setShowUsernamesInAnalytics(!!initialSettings.showUsernamesInAnalytics);
            setUseTrendingSlideshowOnLogin(initialSettings.useTrendingSlideshowOnLogin !== false);
            if (Array.isArray(initialSettings.defaultLibraryIds) && initialSettings.defaultLibraryIds.length > 0) {
                setDefaultLibraryIds(initialSettings.defaultLibraryIds.map(String));
            } else if (libraries.length > 0) {
                setDefaultLibraryIds(libraries.map((l: any) => String(l.id)));
            } else {
                setDefaultLibraryIds([]);
            }
            if (initialSettings.use24HourClock !== undefined) setUse24HourClock(!!initialSettings.use24HourClock);
            if (initialSettings.showPosterQualityBadges !== undefined) setShowPosterQualityBadges(initialSettings.showPosterQualityBadges !== false);
            if (initialSettings.showDashboardWatchingBadge !== undefined) setShowDashboardWatchingBadge(!!initialSettings.showDashboardWatchingBadge);
            if (initialSettings.dashboardWatchingBadgePollSeconds !== undefined) {
                setDashboardWatchingBadgePollSeconds(Math.min(15, Math.max(1, Number(initialSettings.dashboardWatchingBadgePollSeconds) || 15)));
            }
            if (initialSettings.showPublicStatusMonitor !== undefined) setShowPublicStatusMonitor(initialSettings.showPublicStatusMonitor !== false);
            if (initialSettings.showPublicLibraryStats !== undefined) setShowPublicLibraryStats(initialSettings.showPublicLibraryStats !== false);
            if (initialSettings.allowTemporaryAccess !== undefined) setAllowTemporaryAccess(!!initialSettings.allowTemporaryAccess);
            if (initialSettings.autoBackupEnabled !== undefined) setAutoBackupEnabled(!!initialSettings.autoBackupEnabled);
            if (initialSettings.autoBackupIntervalDays !== undefined) setAutoBackupIntervalDays(Number(initialSettings.autoBackupIntervalDays) || 2);
            if (initialSettings.autoBackupRetentionCount !== undefined) setAutoBackupRetentionCount(Number(initialSettings.autoBackupRetentionCount) || 10);
            if (initialSettings.maintenanceExperimentalEnabled !== undefined) setMaintenanceExperimentalEnabled(!!initialSettings.maintenanceExperimentalEnabled);
            if (initialSettings.upgraderEnabled !== undefined) setUpgraderEnabled(!!initialSettings.upgraderEnabled);
            if (initialSettings.collexionsEnabled !== undefined) setCollexionsEnabled(!!initialSettings.collexionsEnabled);
            if (initialSettings.spotifyToPlexEnabled !== undefined) setSpotifyToPlexEnabled(!!initialSettings.spotifyToPlexEnabled);
            if (initialSettings.metadataFillEnabled !== undefined) setMetadataFillEnabled(!!initialSettings.metadataFillEnabled);
            if (initialSettings.metadataFillAutoImport !== undefined) setMetadataFillAutoImport(initialSettings.metadataFillAutoImport !== false);
            if (initialSettings.scannerEnabled !== undefined) setScannerEnabled(!!initialSettings.scannerEnabled);
            if (initialSettings.scannerHomeWidgetEnabled !== undefined) {
                setScannerHomeWidgetEnabled(!!initialSettings.scannerHomeWidgetEnabled);
            }
            if (initialSettings.mediaAutomationEnabled !== undefined) {
                setMediaAutomationEnabled(!!initialSettings.mediaAutomationEnabled);
            }
            if (initialSettings.mediaAutomationHomeWidgetEnabled !== undefined) {
                setMediaAutomationHomeWidgetEnabled(!!initialSettings.mediaAutomationHomeWidgetEnabled);
            }
            if (initialSettings.posterSetsEnabled !== undefined) {
                setPosterSetsEnabled(!!initialSettings.posterSetsEnabled);
            }
            if (initialSettings.overlaysEnabled !== undefined) {
                setOverlaysEnabled(!!initialSettings.overlaysEnabled);
            }
            if (initialSettings.editionsEnabled !== undefined) {
                setEditionsEnabled(!!initialSettings.editionsEnabled);
            }
            if (initialSettings.watchSyncEnabled !== undefined) {
                setWatchSyncEnabled(!!initialSettings.watchSyncEnabled);
            }
            if (initialSettings.achievementsEnabled !== undefined) {
                setAchievementsEnabled(!!initialSettings.achievementsEnabled);
            }
            if (initialSettings.supportTicketsEnabled !== undefined) {
                setSupportTicketsEnabled(initialSettings.supportTicketsEnabled !== false);
            }
            if (initialSettings.chatEnabled !== undefined) {
                setChatEnabled(!!initialSettings.chatEnabled);
            }
            if (initialSettings.chatMentionNotifyInApp !== undefined) {
                setChatMentionNotifyInApp(initialSettings.chatMentionNotifyInApp !== false);
            }
            if (initialSettings.achievementsLeaderboardEnabled !== undefined) {
                setAchievementsLeaderboardEnabled(initialSettings.achievementsLeaderboardEnabled !== false);
            }
            if (initialSettings.achievementsHomeWidgetEnabled !== undefined) {
                setAchievementsHomeWidgetEnabled(initialSettings.achievementsHomeWidgetEnabled !== false);
            }
            if (initialSettings.achievementsShowOnProfile !== undefined) {
                setAchievementsShowOnProfile(initialSettings.achievementsShowOnProfile !== false);
            }
            if (initialSettings.achievementsXpWeights && typeof initialSettings.achievementsXpWeights === 'object') {
                setAchievementsXpWeights({ ...initialSettings.achievementsXpWeights });
            } else {
                setAchievementsXpWeights({});
            }
            if (Array.isArray(initialSettings.achievementsDisabledBadgeIds)) {
                setAchievementsDisabledBadgeIds(initialSettings.achievementsDisabledBadgeIds.map(String).filter(Boolean));
            } else {
                setAchievementsDisabledBadgeIds([]);
            }
            if (initialSettings.achievementsMinPercentComplete !== undefined) {
                const n = Number(initialSettings.achievementsMinPercentComplete);
                setAchievementsMinPercentComplete(Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);
            } else {
                setAchievementsMinPercentComplete(0);
            }
            if (Array.isArray(initialSettings.achievementsSeasons)) {
                setAchievementsSeasons(initialSettings.achievementsSeasons.map((s: any) => ({
                    id: String(s.id || `season-${Math.random().toString(36).slice(2, 8)}`),
                    name: String(s.name || ''),
                    activeFrom: String(s.activeFrom || ''),
                    activeUntil: String(s.activeUntil || ''),
                    badgeIds: Array.isArray(s.badgeIds) ? s.badgeIds.map(String).filter(Boolean) : [],
                    spotlight: s.spotlight !== false,
                })).filter((s: any) => s.name));
            } else {
                setAchievementsSeasons([]);
            }
            setRequestAvailableNotifyEnabled(initialSettings.requestAvailableNotifyEnabled !== false);
            setRequestAvailableNotifyEmail(initialSettings.requestAvailableNotifyEmail !== false);
            setRequestAvailableNotifyInApp(initialSettings.requestAvailableNotifyInApp !== false);
            setRequestAvailableNotifyWebPush(initialSettings.requestAvailableNotifyWebPush !== false);
            setRequestAvailableNotifyDiscord(!!initialSettings.requestAvailableNotifyDiscord);
            setRequestAvailableDiscordWebhookUrl(initialSettings.requestAvailableDiscordWebhookUrl || '');
            setRequestNotReleasedNotifyEnabled(initialSettings.requestNotReleasedNotifyEnabled !== false);
            setRequestNotReleasedNotifyEmail(initialSettings.requestNotReleasedNotifyEmail !== false);
            setRequestNotReleasedNotifyInApp(initialSettings.requestNotReleasedNotifyInApp !== false);
            setRequestNotReleasedNotifyWebPush(initialSettings.requestNotReleasedNotifyWebPush !== false);
            setNotifyReleaseDatePreference(initialSettings.notifyReleaseDatePreference || 'digital');
            setScannerNotifyDeleted(initialSettings.scannerNotifyDeleted === true);
            setScannerNotifyUpgrade(initialSettings.scannerNotifyUpgrade === true);
            setScannerNotifyImport(initialSettings.scannerNotifyImport === true);
            setScannerNotifyGrab(initialSettings.scannerNotifyGrab === true);
            setScannerNotifyUpdate(initialSettings.scannerNotifyUpdate === true);
            setScannerNotifyInteraction(initialSettings.scannerNotifyInteraction === true);
            setWebPushEnabled(initialSettings.webPushEnabled !== false);
            setSummaryNotifyEnabled(!!initialSettings.summaryNotifyEnabled);
            setSummaryNotifyFrequency(initialSettings.summaryNotifyFrequency || 'disabled');
            setSummaryNotifyDay(Number(initialSettings.summaryNotifyDay) || 0);
            setSummaryNotifyTime(initialSettings.summaryNotifyTime || '23:00');
            setSummaryNotifyInApp(initialSettings.summaryNotifyInApp !== false);
            setSummaryNotifyWebPush(initialSettings.summaryNotifyWebPush !== false);
            setSummaryNotifyEmail(!!initialSettings.summaryNotifyEmail);
            setSummaryMetrics({
                uptime: initialSettings.summaryMetrics?.uptime !== false,
                requests: initialSettings.summaryMetrics?.requests !== false,
                scannerImports: initialSettings.summaryMetrics?.scannerImports !== false,
                collexionsRotations: initialSettings.summaryMetrics?.collexionsRotations !== false,
                mediaAutomationJobs: initialSettings.summaryMetrics?.mediaAutomationJobs !== false,
                highlights: initialSettings.summaryMetrics?.highlights !== false,
            });
            setNotificationTemplates(
                initialSettings.notificationTemplates && typeof initialSettings.notificationTemplates === 'object'
                    ? initialSettings.notificationTemplates
                    : {},
            );
            setNotificationTemplateDefaults(
                initialSettings.notificationTemplateDefaults && typeof initialSettings.notificationTemplateDefaults === 'object'
                    ? initialSettings.notificationTemplateDefaults
                    : {},
            );
            setNotificationTemplateEvents(
                Array.isArray(initialSettings.notificationTemplateEvents)
                    ? initialSettings.notificationTemplateEvents.map(String)
                    : [],
            );
            setNotificationTemplateFields(
                initialSettings.notificationTemplateFields && typeof initialSettings.notificationTemplateFields === 'object'
                    ? initialSettings.notificationTemplateFields
                    : {},
            );
            setEmailTemplates(
                initialSettings.emailTemplates && typeof initialSettings.emailTemplates === 'object'
                    ? initialSettings.emailTemplates
                    : {},
            );
            setEmailTemplateDefaults(
                initialSettings.emailTemplateDefaults && typeof initialSettings.emailTemplateDefaults === 'object'
                    ? initialSettings.emailTemplateDefaults
                    : {},
            );
            setEmailTemplateEvents(
                Array.isArray(initialSettings.emailTemplateEvents)
                    ? initialSettings.emailTemplateEvents.map(String)
                    : [],
            );
            setEmailTemplateFields(
                initialSettings.emailTemplateFields && typeof initialSettings.emailTemplateFields === 'object'
                    ? initialSettings.emailTemplateFields
                    : {},
            );
            setNtfyEnabled(!!initialSettings.ntfyEnabled);
            setNtfyServerUrl(initialSettings.ntfyServerUrl || '');
            setNtfyTopic(initialSettings.ntfyTopic || '');
            setNtfyToken(initialSettings.ntfyToken || '');
            setNtfyPriority(Math.max(1, Math.min(5, Number(initialSettings.ntfyPriority) || 3)));
            setNtfyEvents(
                initialSettings.ntfyEvents && typeof initialSettings.ntfyEvents === 'object'
                    ? {
                        available: true, approved: true, declined: true, season: true, episode: false, admin_pending: true,
                        collexions_failed: true, scanner_failed: true, scanner_deleted: true, scanner_upgrade: true, scanner_import: true, scanner_grab: true, scanner_update: true, scanner_interaction: true, spotify_sync_failed: true, status_down: true, status_up: true,
                        media_job_failed: true, media_job_completed: false, tautulli_api_failed: true,
                        support_ticket: true, support_reply: true, support_media_issue: true,
                        ...initialSettings.ntfyEvents,
                    }
                    : {
                        available: true, approved: true, declined: true, season: true, episode: false, admin_pending: true,
                        collexions_failed: true, scanner_failed: true, scanner_deleted: true, scanner_upgrade: true, scanner_import: true, scanner_grab: true, scanner_update: true, scanner_interaction: true, spotify_sync_failed: true, status_down: true, status_up: true,
                        media_job_failed: true, media_job_completed: false, tautulli_api_failed: true,
                        support_ticket: true, support_reply: true, support_media_issue: true,
                    },
            );
            setWebhookEnabled(!!initialSettings.webhookEnabled);
            setWebhookUrl(initialSettings.webhookUrl || '');
            setWebhookHeadersJson(initialSettings.webhookHeadersJson || '');
            setWebhookEvents(
                initialSettings.webhookEvents && typeof initialSettings.webhookEvents === 'object'
                    ? {
                        available: true, approved: false, declined: false, season: false, episode: false, admin_pending: false,
                        collexions_failed: false, scanner_failed: false, scanner_deleted: false, scanner_upgrade: false, scanner_import: false, scanner_grab: false, scanner_update: false, scanner_interaction: false, spotify_sync_failed: false, status_down: false, status_up: false,
                        media_job_failed: false, media_job_completed: false, tautulli_api_failed: false,
                        support_ticket: false, support_reply: false, support_media_issue: false,
                        ...initialSettings.webhookEvents,
                    }
                    : {
                        available: true, approved: false, declined: false, season: false, episode: false, admin_pending: false,
                        collexions_failed: false, scanner_failed: false, scanner_deleted: false, scanner_upgrade: false, scanner_import: false, scanner_grab: false, scanner_update: false, scanner_interaction: false, spotify_sync_failed: false, status_down: false, status_up: false,
                        media_job_failed: false, media_job_completed: false, tautulli_api_failed: false,
                        support_ticket: false, support_reply: false, support_media_issue: false,
                    },
            );
            if (initialSettings.watchHistorySource !== undefined) {
                setWatchHistorySource(initialSettings.watchHistorySource === 'tautulli' ? 'tautulli' : 'plex');
            }
            if (initialSettings.tautulliConfigured !== undefined) {
                setTautulliConfigured(!!initialSettings.tautulliConfigured);
            } else {
                setTautulliConfigured(!!(initialSettings.tautulliUrl && initialSettings.tautulliApiKey));
            }
            if (initialSettings.mediaAutomation && typeof initialSettings.mediaAutomation === 'object') {
                const saved = initialSettings.mediaAutomation;
                const fallback = {
                    ...DEFAULT_MEDIA_AUTOMATION_SETTINGS.fallback,
                    ...(saved.fallback || {}),
                    outputMode: (saved.fallback?.outputMode || saved.outputMode || DEFAULT_MEDIA_AUTOMATION_SETTINGS.fallback.outputMode) as typeof DEFAULT_MEDIA_AUTOMATION_SETTINGS.fallback.outputMode,
                    hardware: (saved.fallback?.hardware || saved.hardwareAcceleration || DEFAULT_MEDIA_AUTOMATION_SETTINGS.fallback.hardware) as typeof DEFAULT_MEDIA_AUTOMATION_SETTINGS.fallback.hardware,
                };
                setMediaAutomation({
                    ...DEFAULT_MEDIA_AUTOMATION_SETTINGS,
                    ...saved,
                    enabled: initialSettings.mediaAutomationEnabled ?? saved.enabled ?? false,
                    auth: {
                        ...DEFAULT_MEDIA_AUTOMATION_SETTINGS.auth,
                        ...(saved.auth || saved.webhookAuth || {}),
                    },
                    fallback,
                    outputMode: fallback.outputMode,
                    hardwareAcceleration: fallback.hardware,
                    concurrency: {
                        cpu: (() => {
                            const next = Number(saved.concurrency?.cpu ?? saved.cpuConcurrency ?? saved.concurrency);
                            return Number.isFinite(next) ? Math.min(32, Math.max(0, Math.round(next))) : 1;
                        })(),
                        gpu: (() => {
                            const next = Number(saved.concurrency?.gpu ?? saved.gpuConcurrency);
                            return Number.isFinite(next) ? Math.min(16, Math.max(0, Math.round(next))) : 1;
                        })(),
                    },
                    // Keep flat mirrors aligned with nested concurrency (save used to prefer stale flat values).
                    cpuConcurrency: (() => {
                        const next = Number(saved.concurrency?.cpu ?? saved.cpuConcurrency ?? saved.concurrency);
                        return Number.isFinite(next) ? Math.min(32, Math.max(0, Math.round(next))) : 1;
                    })(),
                    gpuConcurrency: (() => {
                        const next = Number(saved.concurrency?.gpu ?? saved.gpuConcurrency);
                        return Number.isFinite(next) ? Math.min(16, Math.max(0, Math.round(next))) : 1;
                    })(),
                    libraryScanEnabled: saved.libraryScanEnabled !== false,
                    libraryScanIntervalMinutes: Math.min(
                        10080,
                        Math.max(15, Number(saved.libraryScanIntervalMinutes) || DEFAULT_MEDIA_AUTOMATION_SETTINGS.libraryScanIntervalMinutes),
                    ),
                    libraryWatchEnabled: saved.libraryWatchEnabled === true,
                    libraryWatchDebounceMs: Math.min(
                        120000,
                        Math.max(500, Number(saved.libraryWatchDebounceMs) || DEFAULT_MEDIA_AUTOMATION_SETTINGS.libraryWatchDebounceMs),
                    ),
                    customCommandAllowlist: Array.isArray(saved.customCommandAllowlist)
                        ? [...new Set(saved.customCommandAllowlist.map((entry: unknown) => String(entry || '').trim()).filter(Boolean))].slice(0, 32)
                        : [...DEFAULT_MEDIA_AUTOMATION_SETTINGS.customCommandAllowlist],
                    notifyOnJobFailed: saved.notifyOnJobFailed === true,
                    notifyOnScanComplete: saved.notifyOnScanComplete === true,
                    notifyOnFailBurst: saved.notifyOnFailBurst === true,
                    minFreeDiskGb: Math.min(10000, Math.max(0, Math.round(Number(saved.minFreeDiskGb ?? DEFAULT_MEDIA_AUTOMATION_SETTINGS.minFreeDiskGb)))),
                    autoPauseQueueDepth: Math.min(100000, Math.max(0, Math.round(Number(saved.autoPauseQueueDepth) || 0))),
                    pauseEncodingOnScan: saved.pauseEncodingOnScan !== false,
                    pathDenyList: Array.isArray(saved.pathDenyList)
                        ? [...new Set(saved.pathDenyList.map((entry: unknown) => String(entry || '').trim()).filter(Boolean))].slice(0, 200)
                        : [],
                    quietHoursEnabled: saved.quietHoursEnabled === true,
                    quietHoursStart: String(saved.quietHoursStart || DEFAULT_MEDIA_AUTOMATION_SETTINGS.quietHoursStart),
                    quietHoursEnd: String(saved.quietHoursEnd || DEFAULT_MEDIA_AUTOMATION_SETTINGS.quietHoursEnd),
                    quietHoursDays: Array.isArray(saved.quietHoursDays)
                        ? saved.quietHoursDays.map((day: unknown) => Number(day)).filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6)
                        : [],
                    pauseWhenStreamingEnabled: saved.pauseWhenStreamingEnabled === true,
                    pauseWhenStreamingLanes: saved.pauseWhenStreamingLanes === 'all' ? 'all' : 'gpu',
                    arrRescanEnabled: saved.arrRescanEnabled === true,
                    scannerRefreshEnabled: saved.scannerRefreshEnabled === true,
                    plexRescanEnabled: saved.plexRescanEnabled === true,
                    minSavingsPercent: Math.min(95, Math.max(0, Math.round(Number(saved.minSavingsPercent) || 0))),
                    minReclaimGb: Math.min(1000, Math.max(0, Number(saved.minReclaimGb) || 0)),
                    minSourceGb: Math.min(1000, Math.max(0, Number(saved.minSourceGb) || 0)),
                    minBitrateKbps: Math.min(200000, Math.max(0, Math.round(Number(saved.minBitrateKbps) || 0))),
                    minFileAgeDays: Math.min(3650, Math.max(0, Math.round(Number(saved.minFileAgeDays) || 0))),
                    sampleGateEnabled: saved.sampleGateEnabled === true,
                    sampleGateMinSizeGb: Math.min(1000, Math.max(0, Number(saved.sampleGateMinSizeGb ?? DEFAULT_MEDIA_AUTOMATION_SETTINGS.sampleGateMinSizeGb))),
                    replaceQualityGuard: saved.replaceQualityGuard !== false,
                    freeSpaceRoiMinPercent: Math.min(95, Math.max(0, Math.round(Number(saved.freeSpaceRoiMinPercent) || 0))),
                    daytimeExtraSavingsPercent: Math.min(50, Math.max(0, Math.round(Number(saved.daytimeExtraSavingsPercent) || 0))),
                    maxWatchCount: Math.min(100000, Math.max(0, Math.round(Number(saved.maxWatchCount) || 0))),
                    skipWatchedWithinDays: Math.min(3650, Math.max(0, Math.round(Number(saved.skipWatchedWithinDays) || 0))),
                    seasonMatchMinPercent: Math.min(100, Math.max(0, Math.round(Number(saved.seasonMatchMinPercent) || 0))),
                    audioOnlyIfVideoMatches: saved.audioOnlyIfVideoMatches === true,
                    dolbyVisionHandling: ['skip', 'preserve', 'strip'].includes(String(saved.dolbyVisionHandling || ''))
                        ? saved.dolbyVisionHandling
                        : 'skip',
                    hdr10Handling: ['preserve', 'strip', 'skip'].includes(String(saved.hdr10Handling || ''))
                        ? saved.hdr10Handling
                        : 'preserve',
                    // Preserve Start/Pause across settings saves (UI controls live on Media Automation).
                    workerPaused: saved.workerPaused !== false,
                    workerGroups: Array.isArray(saved.workerGroups) ? saved.workerGroups : [],
                    deliveryTargets: Array.isArray(saved.deliveryTargets) ? saved.deliveryTargets : [],
                });
            } else {
                setMediaAutomation({
                    ...DEFAULT_MEDIA_AUTOMATION_SETTINGS,
                    enabled: !!initialSettings.mediaAutomationEnabled,
                });
            }
            if (initialSettings.scannerWebhooksVisible !== undefined) {
                setScannerWebhooksVisible(initialSettings.scannerWebhooksVisible !== false);
            }
            if (initialSettings.scannerManualPathVisible !== undefined) {
                setScannerManualPathVisible(initialSettings.scannerManualPathVisible !== false);
            }
            if (initialSettings.scanner && typeof initialSettings.scanner === 'object') {
                const defaults = defaultScannerSettings();
                const incoming = initialSettings.scanner as ScannerSettings;
                setScanner({
                    ...defaults,
                    ...incoming,
                    triggers: {
                        ...defaults.triggers,
                        ...(incoming.triggers || {}),
                    },
                    targets: {
                        ...defaults.targets,
                        ...(incoming.targets || {}),
                    },
                });
            }
            if (initialSettings.collexionsAutostart !== undefined) setCollexionsAutostart(!!initialSettings.collexionsAutostart);
            if (initialSettings.collexionsInternalUrl !== undefined) setCollexionsInternalUrl(String(initialSettings.collexionsInternalUrl || ''));
            if (initialSettings.collexionsServiceKey !== undefined) setCollexionsServiceKey(String(initialSettings.collexionsServiceKey || ''));
            if (initialSettings.spotifyToPlexInternalUrl !== undefined) setSpotifyToPlexInternalUrl(String(initialSettings.spotifyToPlexInternalUrl || ''));
            if (initialSettings.spotifyToPlexClientId !== undefined) setSpotifyToPlexClientId(String(initialSettings.spotifyToPlexClientId || ''));
            if (initialSettings.spotifyToPlexClientSecret !== undefined) setSpotifyToPlexClientSecret(String(initialSettings.spotifyToPlexClientSecret || ''));
            if (initialSettings.spotifyToPlexEncryptionKey !== undefined) setSpotifyToPlexEncryptionKey(String(initialSettings.spotifyToPlexEncryptionKey || ''));
            if (initialSettings.spotifyToPlexHomeWidgetEnabled !== undefined) setSpotifyToPlexHomeWidgetEnabled(!!initialSettings.spotifyToPlexHomeWidgetEnabled);
            if (initialSettings.spotifyToPlexScheduleMode === 'portal' || initialSettings.spotifyToPlexScheduleMode === 'sidecar') {
                setSpotifyToPlexScheduleMode(initialSettings.spotifyToPlexScheduleMode);
            } else if (initialSettings.spotifyToPlexScheduledSyncEnabled) {
                setSpotifyToPlexScheduleMode('portal');
            }
            if (initialSettings.spotifyToPlexScheduledSyncIntervalHours !== undefined) {
                setSpotifyToPlexScheduledSyncIntervalHours(
                    Math.min(168, Math.max(1, Number(initialSettings.spotifyToPlexScheduledSyncIntervalHours) || 24)),
                );
            }
            if (initialSettings.upgraderDefaultPreset) setUpgraderDefaultPreset(initialSettings.upgraderDefaultPreset);
            if (initialSettings.upgraderMinSizeGB !== undefined) setUpgraderMinSizeGB(Math.max(0, Number(initialSettings.upgraderMinSizeGB) || 5));
            if (initialSettings.upgraderAutomationEnabled !== undefined) setUpgraderAutomationEnabled(!!initialSettings.upgraderAutomationEnabled);
            if (initialSettings.upgraderMaxActionsPerHour !== undefined) setUpgraderMaxActionsPerHour(Math.max(1, Number(initialSettings.upgraderMaxActionsPerHour) || 25));
            if (initialSettings.upgraderDefaultSort) setUpgraderDefaultSort(initialSettings.upgraderDefaultSort);
            if (initialSettings.upgraderDrawerPosition) setUpgraderDrawerPosition(initialSettings.upgraderDrawerPosition);
            if (initialSettings.upgraderProfileMap && typeof initialSettings.upgraderProfileMap === 'object') {
                setUpgraderProfileMap(initialSettings.upgraderProfileMap);
            }
            const layout = normalizeSectionLayout(initialSettings.dashboardLayout, {
                homeCustomModules: Array.isArray(initialSettings.homeCustomModules) ? initialSettings.homeCustomModules : [],
            });
            dashboardLayoutRef.current = layout;
            setDashboardLayout(layout);
            setTestRecipient('');
            setServers([]);
        }
    }, [initialSettings, isConfigLoaded]);

    useEffect(() => {
        if (!upgraderEnabled) {
            setUpgraderProfileInstances([]);
            return;
        }
        let cancelled = false;
        setLoadingUpgraderProfiles(true);
        apiFetch('/api/upgrader/profiles')
            .then((data) => {
                if (cancelled) return;
                setUpgraderProfileInstances(Array.isArray(data?.instances) ? data.instances : []);
            })
            .catch(() => {
                if (!cancelled) setUpgraderProfileInstances([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingUpgraderProfiles(false);
            });
        return () => { cancelled = true; };
    }, [upgraderEnabled]);

    const handleFetchServers = async () => {
        if (!token) {
            addToast('Please enter a Plex token.', 'error');
            return;
        }
        setLoading(true);
        try {
            const foundServers = await apiFetch('/api/plex/servers', {
                method: 'POST',
                body: JSON.stringify({ token, plexServerUrl: plexServerUrl || undefined }),
            });

            setServers(foundServers);

            if (foundServers.length > 0) {
                addToast('Successfully fetched servers!', 'success');
                const currentServerStillExists = foundServers.some(s => s.identifier === selectedServer);
                if (!currentServerStillExists) {
                    setSelectedServer(foundServers[0].identifier);
                }
            } else {
                addToast('No owned servers found for this token. Make sure you are the owner of the server.', 'error');
                setSelectedServer('');
            }
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'An unknown error occurred.', 'error');
            setServers([]);
            setSelectedServer('');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (activeTab === 'stream-rules' && streamRulesSaveHandlerRef.current) {
            await streamRulesSaveHandlerRef.current();
            return;
        }
        if (mediaServerType === 'plex' && (!token || !selectedServer)) {
            addToast('Token and server must be selected.', 'error');
            return;
        }
        if (mediaServerType !== 'plex' && (!jellyfinUrl || !hasIntegrationCredentials(jellyfinUrl, jellyfinApiKey, initialSettings.jellyfinUrl, initialSettings.jellyfinApiKey))) {
            addToast(`${mediaServerLabel} URL and API key must be set.`, 'error');
            return;
        }

        let savedCustomLogoUrl = logoFile ? getUploadedBrandingImagePath(logoFile, 'logo') : customLogoUrl;
        let savedCustomLoginLogoUrl = loginLogoFile ? getUploadedBrandingImagePath(loginLogoFile, 'login') : customLoginLogoUrl;
        let savedCustomFaviconUrl = faviconFile ? getUploadedBrandingImagePath(faviconFile, 'favicon') : customFaviconUrl;
        let savedCustomBadgeUrl = customBadgeUrl;
        let savedBackgroundImageUrl = backgroundImageUrl;
        if (mediaServerType === 'emby') {
            if (isJellyfinBrandingAsset(savedCustomLogoUrl)) savedCustomLogoUrl = '';
            if (isJellyfinBrandingAsset(savedBackgroundImageUrl)) savedBackgroundImageUrl = '';
        }

        if (logoFile) {
            try {
                const uploadResponse = await fetch(portalUrl('/api/config/logo'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': logoFile.type || (logoFile.name.toLowerCase().endsWith('.png') ? 'image/png' : (logoFile.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')),
                        [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
                    },
                    body: logoFile,
                });
                if (!uploadResponse.ok) {
                    const errorData = await uploadResponse.json().catch(() => ({ error: 'Failed to upload logo' }));
                    throw new Error(errorData.error || 'Failed to upload logo');
                }
                const uploadResult = await uploadResponse.json().catch(() => ({}));
                savedCustomLogoUrl = uploadResult.logoUrl || savedCustomLogoUrl;
                setCustomLogoUrl(savedCustomLogoUrl);
                setLogoFile(null);
                clearLogoPreview();
            } catch (e) {
                addToast(e instanceof Error ? e.message : 'Failed to upload logo', 'error');
                return;
            }
        }

        if (loginLogoFile) {
            try {
                const uploadResponse = await fetch(portalUrl('/api/config/login-logo'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': loginLogoFile.type || (loginLogoFile.name.toLowerCase().endsWith('.png') ? 'image/png' : (loginLogoFile.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')),
                        [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
                    },
                    body: loginLogoFile,
                });
                if (!uploadResponse.ok) {
                    const errorData = await uploadResponse.json().catch(() => ({ error: 'Failed to upload login logo' }));
                    throw new Error(errorData.error || 'Failed to upload login logo');
                }
                const uploadResult = await uploadResponse.json().catch(() => ({}));
                savedCustomLoginLogoUrl = uploadResult.loginLogoUrl || savedCustomLoginLogoUrl;
                setCustomLoginLogoUrl(savedCustomLoginLogoUrl);
                setLoginLogoFile(null);
                clearLoginLogoPreview();
            } catch (e) {
                addToast(e instanceof Error ? e.message : 'Failed to upload login logo', 'error');
                return;
            }
        }

        if (faviconFile) {
            try {
                const uploadResponse = await fetch(portalUrl('/api/config/favicon'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': faviconFile.type || (faviconFile.name.toLowerCase().endsWith('.png') ? 'image/png' : (faviconFile.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')),
                        [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
                    },
                    body: faviconFile,
                });
                if (!uploadResponse.ok) {
                    const errorData = await uploadResponse.json().catch(() => ({ error: 'Failed to upload favicon' }));
                    throw new Error(errorData.error || 'Failed to upload favicon');
                }
                const uploadResult = await uploadResponse.json().catch(() => ({}));
                savedCustomFaviconUrl = uploadResult.faviconUrl || savedCustomFaviconUrl;
                setCustomFaviconUrl(savedCustomFaviconUrl);
                setFaviconFile(null);
            } catch (e) {
                addToast(e instanceof Error ? e.message : 'Failed to upload favicon', 'error');
                return;
            }
        }

        if (badgeFile) {
            try {
                const uploadResponse = await fetch(portalUrl('/api/config/notification-badge'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': badgeFile.type || (badgeFile.name.toLowerCase().endsWith('.png') ? 'image/png' : (badgeFile.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')),
                        [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
                    },
                    body: badgeFile,
                });
                if (!uploadResponse.ok) {
                    const errorData = await uploadResponse.json().catch(() => ({ error: 'Failed to upload notification badge' }));
                    throw new Error(errorData.error || 'Failed to upload notification badge');
                }
                const uploadResult = await uploadResponse.json().catch(() => ({}));
                savedCustomBadgeUrl = uploadResult.badgeUrl || savedCustomBadgeUrl;
                setCustomBadgeUrl(savedCustomBadgeUrl);
                setBadgeFile(null);
            } catch (e) {
                addToast(e instanceof Error ? e.message : 'Failed to upload notification badge', 'error');
                return;
            }
        }

        if (backgroundFile) {
            try {
                const uploadResponse = await fetch(portalUrl('/api/config/background'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': backgroundFile.type || (backgroundFile.name.toLowerCase().endsWith('.png') ? 'image/png' : (backgroundFile.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')),
                        [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
                    },
                    body: backgroundFile,
                });
                if (!uploadResponse.ok) {
                    const errorData = await uploadResponse.json().catch(() => ({ error: 'Failed to upload background' }));
                    throw new Error(errorData.error || 'Failed to upload background');
                }
                const uploadResult = await uploadResponse.json().catch(() => ({}));
                savedBackgroundImageUrl = uploadResult.backgroundImageUrl || savedBackgroundImageUrl;
                setBackgroundImageUrl(savedBackgroundImageUrl);
                setBackgroundFile(null);
                clearBackgroundPreview();
            } catch (e) {
                addToast(e instanceof Error ? e.message : 'Failed to upload background', 'error');
                return;
            }
        }

        if (statusDraft) {
            try {
                await apiFetch('/api/status/config', { method: 'POST', body: JSON.stringify(statusDraft) });
                setStatusConfig(statusDraft);
            } catch (e: any) {
                addToast(e?.message || 'Failed to save status monitor configuration', 'error');
                return;
            }
        }

        await handleSaveConfig({
            token,
            mediaServerType,
            serverIdentifier: selectedServer,
            plexServerUrl: plexServerUrl || '',
            jellyfinUrl,
            jellyfinApiKey,
            checkIntervalMinutes: checkInterval,
            smtpHost,
            smtpPort,
            smtpUser,
            smtpPass,
            smtpFrom,
            smtpSecure,
            emailDaysBefore,
            gotifyEnabled,
            gotifyUrl,
            gotifyToken,
            gotifyPriority,
            alertRules,
            newsletterFrequency,
            newsletterDay,
            inactiveCleanupEnabled,
            inactiveCleanupDays,
            publicDomain,
            requestUrl,
            contactUrl,
            contactWhatsApp,
            contactEmail,
            arrInstances,
            downloadClients,
            tautulliUrl,
            tautulliApiKey,
            notifyTautulliApiFailed,
            jellyfinAnalyticsProvider,
            jellystatUrl,
            jellystatApiKey,
            jellyglanceUrl,
            jellyglanceApiKey,
            requestAppType,
            requestAppUrl,
            requestAppFetchUrl,
            requestAppApiKey,
            requestDiscoverRegion,
            requestDiscoverLanguage,
            requestHideAvailableMedia,
            discoverySource,
            requestEngine,
            requestQuotaLimit,
            requestQuotaDays,
            requestQuotaLimit4k,
            autoApproveMovies,
            autoApproveTv,
            autoApproveMovies4k,
            autoApproveTv4k,
            portalAllowRequestMovies,
            portalAllowRequestTv,
            portalAllowRequest4kMovies,
            portalAllowRequest4kTv,
            portalAllowAdvancedRequests,
            portalAllowRequestTags,
            portalShowRecentlyAdded,
            portalShowWatchlist,
            discoverNowPlayingEnabled,
            homeNowPlayingCompanionEnabled,
            portalAutoRequestMovies,
            portalAutoRequestTv,
            seriesMetadataProvider,
            animeMetadataProvider,
            tvdbApiKey,
            primaryColor: '',
            customLogoUrl: savedCustomLogoUrl,
            customLoginLogoUrl: savedCustomLoginLogoUrl,
            loginLogoCircleFrame,
            customFaviconUrl: savedCustomFaviconUrl,
            customBadgeUrl: savedCustomBadgeUrl,
            brandingTheme,
            sidebarIdentityPosition,
            pwaIconSource,
            backgroundImageUrl: savedBackgroundImageUrl,
            useScrollRevealAnimations,
            useCinematicLoading,
            useBrandedSkeleton,
            useTrendingSlideshow,
            trendingSlideshowInterval,
            tmdbApiKey,
            referralEnabled,
            referralTrialDays,
            referralRewardDays,
            announcement,
            expiredPortalTitle,
            expiredPortalMessage,
            navOrder: ensureCompleteNavOrder(navOrder),
            navHiddenKeys: normalizeNavHiddenKeys(navHiddenKeys, customNavTabs),
            memberNavOrder: ensureCompleteMemberNavOrder(memberNavOrder, customNavTabs),
            memberNavHiddenKeys: normalizeMemberNavHiddenKeys(memberNavHiddenKeys, customNavTabs),
            customNavTabs,
            navItemIcons,
            customNavDisplay,
            arrOpenInPortalEmbed,
            homeCustomModules,
            downloadsVisibleToMembers,
            hideStreamUsers,
            showUsernamesInAnalytics,
            useTrendingSlideshowOnLogin,
            defaultLibraryIds: (() => {
                const allIds = libraries.map((l: any) => String(l.id));
                if (
                    allIds.length > 0 &&
                    (defaultLibraryIds.length === 0 ||
                        (defaultLibraryIds.length >= allIds.length && allIds.every((id) => defaultLibraryIds.map(String).includes(id))))
                ) {
                    return [];
                }
                return defaultLibraryIds;
            })(),
            use24HourClock,
            allowTemporaryAccess,
            showPosterQualityBadges,
            showDashboardWatchingBadge,
            dashboardWatchingBadgePollSeconds,
            showPublicStatusMonitor,
            showPublicLibraryStats,
            autoBackupEnabled,
            autoBackupIntervalDays,
            autoBackupRetentionCount,
            maintenanceExperimentalEnabled,
            upgraderEnabled,
            collexionsEnabled,
            spotifyToPlexEnabled,
            metadataFillEnabled,
            metadataFillAutoImport,
            scannerEnabled,
            scannerHomeWidgetEnabled,
            scannerWebhooksVisible,
            scannerManualPathVisible,
            scanner,
            mediaAutomationEnabled,
            mediaAutomationHomeWidgetEnabled,
            posterSetsEnabled,
            overlaysEnabled,
            editionsEnabled,
            watchSyncEnabled,
            achievementsEnabled,
            supportTicketsEnabled,
            chatEnabled,
            chatMentionNotifyInApp,
            achievementsLeaderboardEnabled,
            achievementsHomeWidgetEnabled,
            achievementsShowOnProfile,
            achievementsXpWeights: Object.keys(achievementsXpWeights).length ? achievementsXpWeights : null,
            achievementsDisabledBadgeIds,
            achievementsMinPercentComplete,
            achievementsSeasons,
            requestAvailableNotifyEnabled,
            requestAvailableNotifyEmail,
            requestAvailableNotifyInApp,
            requestAvailableNotifyWebPush,
            requestAvailableNotifyDiscord,
            requestAvailableDiscordWebhookUrl,
            requestNotReleasedNotifyEnabled,
            requestNotReleasedNotifyEmail,
            requestNotReleasedNotifyInApp,
            requestNotReleasedNotifyWebPush,
            notifyReleaseDatePreference,
            scannerNotifyDeleted,
            scannerNotifyUpgrade,
            scannerNotifyImport,
            scannerNotifyGrab,
            scannerNotifyUpdate,
            scannerNotifyInteraction,
            webPushEnabled,
            summaryNotifyEnabled,
            summaryNotifyFrequency,
            summaryNotifyDay,
            summaryNotifyTime,
            summaryNotifyInApp,
            summaryNotifyWebPush,
            summaryNotifyEmail,
            summaryMetrics,
            notificationTemplates,
            emailTemplates,
            ntfyEnabled,
            ntfyServerUrl,
            ntfyTopic,
            ntfyToken,
            ntfyPriority,
            ntfyEvents,
            webhookEnabled,
            webhookUrl,
            webhookHeadersJson,
            webhookEvents,
            watchHistorySource,
            mediaAutomation: {
                ...mediaAutomation,
                enabled: mediaAutomationEnabled,
                outputMode: mediaAutomation.fallback?.outputMode || mediaAutomation.outputMode || 'dry-run',
                hardwareAcceleration: mediaAutomation.fallback?.hardware || mediaAutomation.hardwareAcceleration || 'cpu',
                // Keep flat + nested concurrency in sync so the scheduler always sees the UI values.
                cpuConcurrency: Number(mediaAutomation.concurrency?.cpu ?? mediaAutomation.cpuConcurrency ?? 1) || 0,
                gpuConcurrency: Number(mediaAutomation.concurrency?.gpu ?? mediaAutomation.gpuConcurrency ?? 1) || 0,
                concurrency: {
                    cpu: Number(mediaAutomation.concurrency?.cpu ?? mediaAutomation.cpuConcurrency ?? 1) || 0,
                    gpu: Number(mediaAutomation.concurrency?.gpu ?? mediaAutomation.gpuConcurrency ?? 1) || 0,
                },
                fallback: {
                    hardware: mediaAutomation.fallback?.hardware || 'cpu',
                    outputMode: mediaAutomation.fallback?.outputMode || 'dry-run',
                },
            },
            collexionsAutostart,
            collexionsInternalUrl,
            collexionsServiceKey,
            spotifyToPlexInternalUrl,
            spotifyToPlexClientId,
            spotifyToPlexClientSecret,
            spotifyToPlexEncryptionKey,
            spotifyToPlexHomeWidgetEnabled,
            spotifyToPlexScheduleMode,
            spotifyToPlexScheduledSyncIntervalHours,
            upgraderDefaultPreset,
            upgraderMinSizeGB,
            upgraderAutomationEnabled,
            upgraderMaxActionsPerHour,
            upgraderDefaultSort,
            upgraderDrawerPosition,
            upgraderProfileMap,
            dashboardLayout: pruneDashboardLayoutCustomModules(
                normalizeSectionLayout(dashboardLayoutRef.current, { homeCustomModules }),
                homeCustomModules,
            ) as DashboardLayoutConfig,
        });
    };
    const applyJellyfinBranding = () => {
        clearLogoPreview();
        clearBackgroundPreview();
        setCustomLogoUrl(JELLYFIN_BRAND_LOGO_URL);
        setBackgroundImageUrl(JELLYFIN_BRAND_BACKGROUND_URL);
        setLogoFile(null);
        setBackgroundFile(null);
        addToast('Jellyfin server icon and splash background applied. Save settings to publish.');
    };

    const handleTestEmail = async () => {
        if (!smtpHost || !smtpUser || !smtpPass || !testRecipient) {
            addToast('Please fill out SMTP Host, User, Password, and Test Recipient.', 'error');
            return;
        }
        setIsTestingSmtp(true);
        try {
            const result = await apiFetch('/api/config/test-email', {
                method: 'POST',
                body: JSON.stringify({
                    smtpHost,
                    smtpPort,
                    smtpUser,
                    smtpPass,
                    smtpFrom,
                    smtpSecure,
                    testRecipient
                })
            });
            addToast(result.message || 'Test email sent successfully!', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'SMTP test failed.', 'error');
        } finally {
            setIsTestingSmtp(false);
        }
    };

    const handleTestGotify = async () => {
        if (!gotifyUrl || !gotifyToken) {
            addToast('Please fill out Gotify URL and app token.', 'error');
            return;
        }
        setIsTestingGotify(true);
        try {
            const result = await apiFetch('/api/config/test-gotify', {
                method: 'POST',
                body: JSON.stringify({
                    gotifyUrl,
                    gotifyToken,
                    gotifyPriority,
                })
            });
            addToast(result.message || 'Gotify test alert sent successfully!', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Gotify test failed.', 'error');
        } finally {
            setIsTestingGotify(false);
        }
    };

    const handleTestNewsletter = async () => {
        setIsTestingNewsletter(true);
        try {
            const result = await apiFetch('/api/newsletter/test', {
                method: 'POST'
            });
            addToast(result.message || 'Newsletter sent successfully!', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Newsletter test failed.', 'error');
        } finally {
            setIsTestingNewsletter(false);
        }
    };

    const handleSendNewsletterNow = async () => {
        appConfirm('Are you sure you want to send the newsletter to ALL configured users immediately? This cannot be undone.', async () => {
            setIsSendingNewsletter(true);
            try {
                const result = await apiFetch('/api/newsletter/send-now', {
                    method: 'POST'
                });
                addToast(result.message || 'Newsletter dispatch initiated!', 'success');
            } catch (error) {
                addToast(error instanceof Error ? error.message : 'Newsletter dispatch failed.', 'error');
            } finally {
                setIsSendingNewsletter(false);
            }
        });
    };

    const handlePreviewNewsletter = async () => {
        setIsGeneratingNewsletter(true);
        try {
            window.open(portalUrl(`/api/newsletter/preview?ts=${Date.now()}`), '_blank', 'noopener,noreferrer');
            addToast('Newsletter preview opened.', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Newsletter preview failed.', 'error');
        } finally {
            setIsGeneratingNewsletter(false);
        }
    };

    const handleRegenerateNewsletter = async () => {
        setIsGeneratingNewsletter(true);
        try {
            window.open(portalUrl(`/api/newsletter/preview?regenerate=${Date.now()}`), '_blank', 'noopener,noreferrer');
            addToast('Newsletter regenerated.', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Newsletter regeneration failed.', 'error');
        } finally {
            setIsGeneratingNewsletter(false);
        }
    };

    const handleDownloadNewsletter = async () => {
        setIsGeneratingNewsletter(true);
        try {
            const link = document.createElement('a');
            link.href = portalUrl(`/api/newsletter/download?ts=${Date.now()}`);
            link.download = '';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            addToast('Newsletter download started.', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Newsletter download failed.', 'error');
        } finally {
            setIsGeneratingNewsletter(false);
        }
    };

    const splashPreviewLogoSrc = safeImageSrc(
        loginLogoPreviewUrl
        || resolvePortalAssetUrl(customLoginLogoUrl)
        || logoPreviewUrl
        || resolvePortalAssetUrl(customLogoUrl),
    );
    const requestAppBaseUrl = safeHttpUrl(requestAppUrl).replace(/\/$/, '');
    const splashPreviewBackgroundSrc = backgroundPreviewUrl || resolvePortalAssetUrl(backgroundImageUrl);
    const splashPreviewKey = `${splashPreviewLogoSrc || 'no-logo'}|${splashPreviewBackgroundSrc || 'no-background'}`;

    return (
        <div className="w-full flex flex-col box-border">
            <Loader isLoading={isLoading} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />

            {configLoadError && (
                <div className="mb-6 p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 text-sm">
                    Could not load settings: {configLoadError}. Try refreshing the page. If this persists on Docker, confirm your session cookie is valid and the container can reach the API.
                </div>
            )}

            <div className="w-full flex flex-col min-w-0">
                <div className="w-full md:grid md:grid-cols-[18rem_minmax(0,1fr)] md:gap-8 xl:gap-10 md:items-start">
                    {/* Mobile Dropdown Category Select */}
                    <div className="block md:hidden mb-6 space-y-4">
                        <h1 className="text-xl font-bold text-plex">{t('navigation.settings')}</h1>
                        <div>
                        <label htmlFor="settings-tab-select" className="text-muted text-xs uppercase tracking-wider font-bold mb-2 block">{t('settings.navigation.category')}</label>
                        <CustomSelect
                            id="settings-tab-select"
                            value={activeSectionId && (SETTINGS_TAB_SECTIONS[activeTab] || []).some((section) => section.sectionId === activeSectionId)
                                ? `${activeTab}/${activeSectionId}`
                                : activeTab}
                            onChange={(val) => {
                                const entry = resolveSettingsEntry(val);
                                if (entry) navigateToSetting(entry);
                            }}
                            options={visibleTabGroups.flatMap((group) => [
                                { label: t(SETTINGS_GROUP_TRANSLATION_KEYS[group.title] || group.title), value: `__group_${group.title}`, isGroup: true as const },
                                ...group.tabs.flatMap((tab) => {
                                    const sections = SETTINGS_TAB_SECTIONS[tab.id as SettingsTabId] || [];
                                    return [
                                        {
                                            label: t(SETTINGS_TAB_TRANSLATION_KEYS[tab.id] || tab.label),
                                            value: tab.id,
                                            icon: <SettingsTabIcon id={tab.id} />,
                                        },
                                        ...sections.map((section) => ({
                                            label: `  ${t(section.translationKey)}`,
                                            value: `${tab.id}/${section.sectionId}`,
                                        })),
                                    ];
                                }),
                            ])}
                        />
                        </div>
                    </div>

                    {/* Desktop Sidebar Navigation — sticky within the main scroll area */}
                    <aside className="hidden md:flex md:flex-col w-72 shrink-0 sticky top-0 self-start glass-card nav-shell p-4 shadow-2xl z-10">
                        <div>
                        {visibleTabGroups.length === 0 ? (
                            <p className="text-xs text-muted px-2 py-2">{t('settings.navigation.noSections')}</p>
                        ) : (
                            <div className="space-y-2">
                                {visibleTabGroups.map(group => (
                                    <div key={group.title}>
                                        <p className="text-[10px] uppercase tracking-wider font-bold text-plex px-2 mb-0.5">{t(SETTINGS_GROUP_TRANSLATION_KEYS[group.title] || group.title)}</p>
                                        <div className="space-y-0.5">
                                            {group.tabs.map(tab => {
                                                const sections = SETTINGS_TAB_SECTIONS[tab.id as SettingsTabId] || [];
                                                const isChildActive = sections.some((section) => (
                                                    activeTab === tab.id && activeSectionId === section.sectionId
                                                ));
                                                const isTabActive = activeTab === tab.id && !isChildActive;
                                                return (
                                                <div key={tab.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => navigateToSetting({ id: tab.id, tabId: tab.id as SettingsTabId, label: tab.label, group: group.title, keywords: tab.keywords || [] })}
                                                    className={`w-full text-left px-2 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${isTabActive
                                                        ? 'nav-item-active'
                                                        : 'text-muted hover:text-text hover:bg-white/5'
                                                        }`}
                                                >
                                                    <SettingsTabIcon id={tab.id} />
                                                    <span className="flex items-center gap-1.5 min-w-0 flex-1">
                                                        <span className="truncate">{t(SETTINGS_TAB_TRANSLATION_KEYS[tab.id] || tab.label)}</span>
                                                        {SETTINGS_TAB_BETA_NOTICE[tab.id] ? (
                                                            <BetaBadge title={t(SETTINGS_TAB_BETA_NOTICE[tab.id])} className="shrink-0 scale-90" />
                                                        ) : null}
                                                    </span>
                                                </button>
                                                {sections.length > 0 ? (
                                                    <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border/70 pl-2">
                                                        {sections.map((section) => {
                                                            const entryId = `${tab.id}/${section.sectionId}`;
                                                            const isActive = activeTab === tab.id && activeSectionId === section.sectionId;
                                                            return (
                                                                <button
                                                                    key={entryId}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const entry = resolveSettingsEntry(entryId);
                                                                        if (entry) navigateToSetting(entry);
                                                                    }}
                                                                    className={`w-full text-left px-2 py-1 rounded-md text-[13px] font-medium transition-all ${isActive
                                                                        ? 'nav-item-active'
                                                                        : 'text-muted hover:text-text hover:bg-white/5'
                                                                        }`}
                                                                >
                                                                    <span className="truncate block">{t(section.translationKey)}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}
                                                </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        </div>
                    </aside>

                    <div className="min-w-0 w-full">
                        <div className="settings-panel">
                        {activeTab === 'stream-rules' && <StreamKillRulesPanel addToast={addToast} registerSaveHandler={(handler) => { streamRulesSaveHandlerRef.current = handler; }} />}
    
                        {activeTab === 'plex' && (
                            <div className="mb-8">
                                <IntegrationHeading
                                    app={mediaServerType === 'emby' ? 'emby' : mediaServerType === 'jellyfin' ? 'jellyfin' : 'plex'}
                                    title="Media Player"
                                    subtitle={`${mediaServerLabel} connection, access, privacy, and library defaults`}
                                />
                                <div id={getSettingsSectionElementId('connection')} className="scroll-mt-24 mb-4">
                                    <SettingFieldLabel
                                        htmlFor="mediaServerType"
                                        hint={(
                                            <SettingHint>
                                                Choose the media server used for portal authentication and server-specific integrations.
                                            </SettingHint>
                                        )}
                                    >
                                        Media Server Type
                                    </SettingFieldLabel>
                                    <CustomSelect
                                        id="mediaServerType"
                                        value={mediaServerType}
                                        onChange={(val) => {
                                            const next = val === 'emby' ? 'emby' : val === 'jellyfin' ? 'jellyfin' : 'plex';
                                            setMediaServerType(next);
                                            // Collexions is Plex-only — turn it off when leaving Plex.
                                            if (next !== 'plex') {
                                                setCollexionsEnabled(false);
                                                setCollexionsAutostart(false);
                                                setSpotifyToPlexEnabled(false);
                                                if (activeTab === 'collexions' || activeTab === 'spotify-sync' || activeTab === 'metadata-fill') setActiveTab('plex');
                                            }
                                        }}
                                        options={[
                                            { label: 'Plex', value: 'plex' },
                                            { label: 'Jellyfin', value: 'jellyfin' },
                                            { label: 'Emby', value: 'emby' }
                                        ]}
                                    />
                                {mediaServerType !== 'plex' && (
                                    <div className="mb-6 p-4 rounded-lg border border-border bg-background/40">
                                        <h4 className="font-bold text-text mb-3">{mediaServerLabel} Connection</h4>
                                        <div className="mb-4">
                                            <label htmlFor="jellyfinUrl">{mediaServerLabel} URL</label>
                                            <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="jellyfinUrl" type="url" value={jellyfinUrl} onChange={(e) => setJellyfinUrl(e.target.value)} placeholder="http://192.168.1.6:8096" />
                                        </div>
                                        <div className="mb-4">
                                            <label htmlFor="jellyfinApiKey">{mediaServerLabel} API Key</label>
                                            <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="jellyfinApiKey" type="password" value={jellyfinApiKey} onChange={(e) => setJellyfinApiKey(e.target.value)} placeholder="API key from media server dashboard" />
                                        </div>
                                        <IntegrationTestButton
                                            type={mediaServerType === 'emby' ? 'emby' : 'jellyfin'}
                                            payload={{ jellyfinUrl, jellyfinApiKey }}
                                            disabled={!hasIntegrationCredentials(jellyfinUrl, jellyfinApiKey, initialSettings.jellyfinUrl, initialSettings.jellyfinApiKey)}
                                            onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                                        />
                                    </div>
                                )}
                                {mediaServerType === 'plex' && (
                                    <>
                                <h4 className="text-lg font-bold text-text mb-4">Plex Connection</h4>
                                <div className="mb-4">
                                    <SettingFieldLabel
                                        htmlFor="plexToken"
                                        hint={(
                                            <SettingHint>
                                                Needed to fetch users and manage access. <a href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/" target="_blank" rel="noopener noreferrer">How to find your token.</a>
                                            </SettingHint>
                                        )}
                                    >
                                        Plex Token
                                    </SettingFieldLabel>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="plexToken" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Enter your X-Plex-Token" />
                                </div>
                                <div className="flex flex-wrap items-start gap-3">
                                    <button className="px-4 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center gap-2" onClick={handleFetchServers} disabled={!token}>Fetch Servers</button>
                                    <IntegrationTestButton
                                        type="plex"
                                        payload={{
                                            token,
                                            serverIdentifier: selectedServer || initialSettings.serverIdentifier,
                                            plexServerUrl: plexServerUrl || undefined,
                                        }}
                                        disabled={!token || !(selectedServer || initialSettings.serverIdentifier)}
                                        onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                                    />
                                </div>
                                {(selectedServer || initialSettings.serverIdentifier) && servers.length === 0 && (
                                    <p className="mt-3 text-sm text-muted inline-flex items-center gap-1.5 flex-wrap">
                                        <span>Saved server: <strong>{selectedServer || initialSettings.serverIdentifier}</strong></span>
                                    </p>
                                )}
                                {servers.length > 0 && (
                                    <div className="mb-4" style={{ marginTop: '1rem' }}>
                                        <SettingFieldLabel htmlFor="serverSelect">Select Server</SettingFieldLabel>
                                        <CustomSelect
                                            id="serverSelect"
                                            value={selectedServer}
                                            onChange={val => setSelectedServer(val)}
                                            options={servers.map(s => ({ label: `${s.name} (${s.identifier})`, value: s.identifier }))}
                                        />
                                        {initialSettings.serverIdentifier && (
                                            <p className="mt-2 text-xs text-muted">
                                                Currently saved server ID: <strong>{initialSettings.serverIdentifier}</strong>
                                            </p>
                                        )}
                                    </div>
                                )}
                                <div className="mb-4" style={{ marginTop: '1rem' }}>
                                    <SettingFieldLabel
                                        htmlFor="plexServerUrl"
                                        hint={(
                                            <SettingHint>
                                                Your Plex server&apos;s LAN address. Use this when Plex.tv discovery fails from inside the container (e.g. <code className="text-xs">getaddrinfo EAI_AGAIN …plex.direct</code> errors).
                                            </SettingHint>
                                        )}
                                    >
                                        Direct Plex URL{' '}
                                        <span className="text-muted font-normal normal-case">(required in Docker)</span>
                                    </SettingFieldLabel>
                                    <input
                                        className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                        id="plexServerUrl"
                                        type="url"
                                        value={plexServerUrl}
                                        onChange={(e) => setPlexServerUrl(e.target.value)}
                                        placeholder="http://192.168.1.6:32400"
                                    />
                                </div>
                                <div className="mb-4" style={{ marginTop: '1rem' }}>
                                    <SettingFieldLabel
                                        htmlFor="checkInterval"
                                        hint={<SettingHint>How often to check for expired users in the background.</SettingHint>}
                                    >
                                        Check Interval (minutes)
                                    </SettingFieldLabel>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="checkInterval" type="number" value={checkInterval} onChange={e => setCheckInterval(Number(e.target.value))} min="1" />
                                </div>

                                {libraries.length > 0 && (
                                    <div id={getSettingsSectionElementId('libraries')} className="mb-4 mt-4 scroll-mt-24">
                                        <SettingFieldLabel
                                            hint={(
                                                <SettingHint>
                                                    All libraries start checked — uncheck any you don&apos;t want shared for temporary access / auto-invite. Leaving all checked shares everything.
                                                </SettingHint>
                                            )}
                                        >
                                            Default Temporary Access/Automated Libraries
                                        </SettingFieldLabel>
                                        <div className="flex flex-wrap gap-3 mt-2">
                                            {libraries.map(lib => {
                                                const isSelected = defaultLibraryIds.includes(lib.id);
                                                return (
                                                    <label key={lib.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-all border shadow-sm select-none ${isSelected ? 'bg-plex/10 border-plex text-plex font-bold' : 'bg-background border-border/50 text-muted hover:border-white/20 hover:text-text font-medium'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setDefaultLibraryIds([...defaultLibraryIds, lib.id]);
                                                                else setDefaultLibraryIds(defaultLibraryIds.filter(id => id !== lib.id));
                                                            }}
                                                            className="hidden"
                                                        />
                                                        {isSelected && <Check className="w-3.5 h-3.5" />}
                                                        <span className="text-sm">{lib.title}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                    </>
                                )}
                                </div>

                                <section id={getSettingsSectionElementId('home-hero')} className="mb-6 mt-2 scroll-mt-24 rounded-xl border border-border/70 p-4">
                                    <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                        <div className="lg:w-52 shrink-0">
                                            <h4 className="font-bold text-text">Media Player Home</h4>
                                            <p className="text-xs text-muted mt-1">Hero banner slideshow on the Media Player home screen.</p>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-muted">
                                                Admins can change the home hero mode inside{' '}
                                                <span className="font-semibold text-text">Media Player → Settings → Home hero mode</span>.
                                                Non-admins do not see this control.
                                            </p>
                                        </div>
                                    </div>
                                </section>

                                <div id={getSettingsSectionElementId('privacy')} className="mb-4 mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4 border-b border-border/40 scroll-mt-24">
                                        <div>
                                            <h4 className="font-bold text-text">Stream User Privacy</h4>
                                            <p className="text-sm text-muted">Control how usernames and player/device names are shown to non-admins anywhere on the portal (dashboard streams, achievements leaderboard, analytics, and the public status page). When set to Show Names, each member can still opt out of their own name, player, or achievements in Preferences.</p>
                                        </div>
                                        <div className="w-56 ml-4 flex-shrink-0">
                                            <CustomSelect
                                                value={String(hideStreamUsers)}
                                                onChange={(val) => setHideStreamUsers(val)}
                                                options={[
                                                    { label: 'Show Names', value: 'false' },
                                                    { label: 'Show as Anonymous', value: 'anonymous' },
                                                    { label: 'Hide Completely', value: 'hidden' }
                                                ]}
                                            />
                                        </div>
                                    </div>

                                <div className="mb-4" style={{ marginTop: '1rem' }}>
                                    <SettingFieldLabel
                                        htmlFor="requestUrl"
                                        hint={<SettingHint>The URL users are redirected to when they click the Request Content button.</SettingHint>}
                                    >
                                        Request URL
                                    </SettingFieldLabel>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="requestUrl" type="text" value={requestUrl} onChange={e => setRequestUrl(e.target.value)} placeholder="https://yourdomain.com" />
                                </div>
                                <div className="mb-4" style={{ marginTop: '1rem' }}>
                                    <SettingFieldLabel
                                        htmlFor="contactUrl"
                                        hint={<SettingHint>Used for the "Request Extension" button in expiry emails. Defaults to sending an email to the SMTP User.</SettingHint>}
                                    >
                                        Contact URL / Email
                                    </SettingFieldLabel>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="contactUrl" type="text" value={contactUrl} onChange={e => setContactUrl(e.target.value)} placeholder="mailto:youremail@example.com OR https://wa.me/123456" />
                                </div>
                            </div>
                        )}

                    {activeTab === 'notifications' && (
                        <div className="mb-8 space-y-10">
                            <section id={getSettingsSectionElementId('smtp')} className="scroll-mt-24">
                                <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">SMTP Email Notifications</h3>
                                <div className="flex flex-col md:flex-row gap-4 mb-4">
                                    <div className="flex-2">
                                        <label htmlFor="smtpHost">SMTP Host</label>
                                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="smtpHost" type="text" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.mailgun.org" />
                                    </div>
                                    <div className="flex-1">
                                        <label htmlFor="smtpPort">Port</label>
                                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="smtpPort" type="number" value={smtpPort} onChange={e => setSmtpPort(Number(e.target.value))} placeholder="587" />
                                    </div>
                                </div>
                                <div className="flex flex-col md:flex-row gap-4 mb-4">
                                    <div className="flex-1">
                                        <label htmlFor="smtpUser">SMTP Username</label>
                                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="smtpUser" type="text" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="postmaster@yourdomain.com" />
                                    </div>
                                    <div className="flex-1">
                                        <label htmlFor="smtpPass">SMTP Password</label>
                                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="smtpPass" type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} placeholder="••••••••••••" />
                                    </div>
                                </div>
                                <div className="flex flex-col md:flex-row gap-4 mb-4 md:items-center">
                                    <div className="flex-[2]">
                                        <label htmlFor="smtpFrom">Sender Address (From)</label>
                                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="smtpFrom" type="text" value={smtpFrom} onChange={e => setSmtpFrom(e.target.value)} placeholder="StreamPilot <noreply@yourdomain.com>" />
                                    </div>
                                    <div className="flex-1">
                                        <SettingsToggleRow
                                            title="SSL / Secure"
                                            checked={smtpSecure}
                                            onChange={setSmtpSecure}
                                            border={false}
                                            className="!py-0"
                                        />
                                    </div>
                                </div>
                                <div className="mb-4">
                                    <SettingFieldLabel
                                        htmlFor="emailDaysBefore"
                                        hint={<SettingHint>Automated notification email will be sent when user has this many days left.</SettingHint>}
                                    >
                                        Warning Alert Threshold (Days Before Expiry)
                                    </SettingFieldLabel>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="emailDaysBefore" type="number" value={emailDaysBefore} onChange={e => setEmailDaysBefore(Number(e.target.value))} min="0" />
                                </div>

                                <div className="mt-6 space-y-3">
                                    <h4 className="font-bold text-text">Test SMTP Settings</h4>
                                    <div className="flex flex-col md:flex-row gap-4 mb-4">
                                        <input
                                            type="email"
                                            value={testRecipient}
                                            onChange={e => setTestRecipient(e.target.value)}
                                            placeholder="test-recipient@gmail.com"
                                            className="flex-grow p-3 rounded-lg border border-border bg-background text-text text-sm outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                        />
                                        <button className="px-4 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center gap-2" onClick={handleTestEmail} disabled={isTestingSmtp || !testRecipient}>
                                            {isTestingSmtp ? 'Sending...' : 'Send Test'}
                                        </button>
                                    </div>
                                </div>
                            </section>

                            <NotificationsSettingsTab
                                requestAvailableNotifyEnabled={requestAvailableNotifyEnabled}
                                setRequestAvailableNotifyEnabled={setRequestAvailableNotifyEnabled}
                                requestAvailableNotifyEmail={requestAvailableNotifyEmail}
                                setRequestAvailableNotifyEmail={setRequestAvailableNotifyEmail}
                                requestAvailableNotifyInApp={requestAvailableNotifyInApp}
                                setRequestAvailableNotifyInApp={setRequestAvailableNotifyInApp}
                                requestAvailableNotifyWebPush={requestAvailableNotifyWebPush}
                                setRequestAvailableNotifyWebPush={setRequestAvailableNotifyWebPush}
                                requestAvailableNotifyDiscord={requestAvailableNotifyDiscord}
                                setRequestAvailableNotifyDiscord={setRequestAvailableNotifyDiscord}
                                requestAvailableDiscordWebhookUrl={requestAvailableDiscordWebhookUrl}
                                setRequestAvailableDiscordWebhookUrl={setRequestAvailableDiscordWebhookUrl}
                                requestNotReleasedNotifyEnabled={requestNotReleasedNotifyEnabled}
                                setRequestNotReleasedNotifyEnabled={setRequestNotReleasedNotifyEnabled}
                                requestNotReleasedNotifyEmail={requestNotReleasedNotifyEmail}
                                setRequestNotReleasedNotifyEmail={setRequestNotReleasedNotifyEmail}
                                requestNotReleasedNotifyInApp={requestNotReleasedNotifyInApp}
                                setRequestNotReleasedNotifyInApp={setRequestNotReleasedNotifyInApp}
                                requestNotReleasedNotifyWebPush={requestNotReleasedNotifyWebPush}
                                setRequestNotReleasedNotifyWebPush={setRequestNotReleasedNotifyWebPush}
                                notifyReleaseDatePreference={notifyReleaseDatePreference}
                                setNotifyReleaseDatePreference={setNotifyReleaseDatePreference}
                                scannerNotifyDeleted={scannerNotifyDeleted}
                                setScannerNotifyDeleted={setScannerNotifyDeleted}
                                scannerNotifyUpgrade={scannerNotifyUpgrade}
                                setScannerNotifyUpgrade={setScannerNotifyUpgrade}
                                scannerNotifyImport={scannerNotifyImport}
                                setScannerNotifyImport={setScannerNotifyImport}
                                scannerNotifyGrab={scannerNotifyGrab}
                                setScannerNotifyGrab={setScannerNotifyGrab}
                                scannerNotifyUpdate={scannerNotifyUpdate}
                                setScannerNotifyUpdate={setScannerNotifyUpdate}
                                scannerNotifyInteraction={scannerNotifyInteraction}
                                setScannerNotifyInteraction={setScannerNotifyInteraction}
                                webPushEnabled={webPushEnabled}
                                setWebPushEnabled={setWebPushEnabled}
                                summaryNotifyEnabled={summaryNotifyEnabled}
                                setSummaryNotifyEnabled={setSummaryNotifyEnabled}
                                summaryNotifyFrequency={summaryNotifyFrequency}
                                setSummaryNotifyFrequency={setSummaryNotifyFrequency}
                                summaryNotifyDay={summaryNotifyDay}
                                setSummaryNotifyDay={setSummaryNotifyDay}
                                summaryNotifyTime={summaryNotifyTime}
                                setSummaryNotifyTime={setSummaryNotifyTime}
                                summaryNotifyInApp={summaryNotifyInApp}
                                setSummaryNotifyInApp={setSummaryNotifyInApp}
                                summaryNotifyWebPush={summaryNotifyWebPush}
                                setSummaryNotifyWebPush={setSummaryNotifyWebPush}
                                summaryNotifyEmail={summaryNotifyEmail}
                                setSummaryNotifyEmail={setSummaryNotifyEmail}
                                summaryMetrics={summaryMetrics}
                                setSummaryMetrics={setSummaryMetrics}
                                notificationTemplates={notificationTemplates}
                                setNotificationTemplates={setNotificationTemplates}
                                notificationTemplateDefaults={notificationTemplateDefaults}
                                notificationTemplateEvents={notificationTemplateEvents}
                                notificationTemplateFields={notificationTemplateFields}
                                ntfyEnabled={ntfyEnabled}
                                setNtfyEnabled={setNtfyEnabled}
                                ntfyServerUrl={ntfyServerUrl}
                                setNtfyServerUrl={setNtfyServerUrl}
                                ntfyTopic={ntfyTopic}
                                setNtfyTopic={setNtfyTopic}
                                ntfyToken={ntfyToken}
                                setNtfyToken={setNtfyToken}
                                ntfyPriority={ntfyPriority}
                                setNtfyPriority={setNtfyPriority}
                                ntfyEvents={ntfyEvents}
                                setNtfyEvents={setNtfyEvents}
                                webhookEnabled={webhookEnabled}
                                setWebhookEnabled={setWebhookEnabled}
                                webhookUrl={webhookUrl}
                                setWebhookUrl={setWebhookUrl}
                                webhookHeadersJson={webhookHeadersJson}
                                setWebhookHeadersJson={setWebhookHeadersJson}
                                webhookEvents={webhookEvents}
                                setWebhookEvents={setWebhookEvents}
                                onOpenGotify={() => {
                                    setActiveSectionId('gotify');
                                    setScrollToSection('gotify');
                                }}
                                onOpenSmtp={() => {
                                    setActiveSectionId('smtp');
                                    setScrollToSection('smtp');
                                }}
                                addToast={addToast}
                                getSettingsSectionElementId={getSettingsSectionElementId}
                            />

                            <section id={getSettingsSectionElementId('gotify')} className="scroll-mt-24">
                                <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Gotify Push Alerts</h3>
                                <p className="text-sm text-muted mb-4 max-w-2xl">
                                    Admin automation alerts (expiry, sync, revoke). Member request-available / in-app / web push channels are configured in the sections above.
                                </p>
                                <SettingsToggleRow
                                    title="Enable Gotify Alerts"
                                    description="Send admin push alerts for important portal automation events."
                                    checked={gotifyEnabled}
                                    onChange={setGotifyEnabled}
                                    className="mb-4"
                                />
                                <div className="flex flex-col md:flex-row gap-4 mb-4">
                                    <div className="flex-[2]">
                                        <label htmlFor="gotifyUrl">Gotify Server URL</label>
                                        <input
                                            className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                            id="gotifyUrl"
                                            type="url"
                                            value={gotifyUrl}
                                            onChange={e => setGotifyUrl(e.target.value)}
                                            placeholder="https://gotify.example.com"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label htmlFor="gotifyPriority">Priority</label>
                                        <input
                                            className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                            id="gotifyPriority"
                                            type="number"
                                            min={0}
                                            max={10}
                                            value={gotifyPriority}
                                            onChange={e => setGotifyPriority(Number(e.target.value))}
                                        />
                                    </div>
                                </div>
                                <div className="mb-4">
                                    <label htmlFor="gotifyToken">Application Token</label>
                                    <input
                                        className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                        id="gotifyToken"
                                        type="password"
                                        value={gotifyToken}
                                        onChange={e => setGotifyToken(e.target.value)}
                                        placeholder="Gotify app token"
                                    />
                                </div>
                                <div className="mt-6 rounded-lg border border-border bg-background/40 p-4">
                                    <h4 className="font-bold text-text mb-3">Alert Rules</h4>
                                    <div className="space-y-1">
                                        {[
                                            ['expiryWarning', 'Access Expiry Warnings', 'Alert when a user reaches the configured expiry-warning threshold.'],
                                            ['accessRevoked', 'Access Revoked', 'Alert when expired access is revoked automatically.'],
                                            ['newUserSynced', 'New Users During Sync', 'Alert when a Plex/Jellyfin sync discovers new users.'],
                                            ['requestPending', 'New Media Requests', 'Alert when a member submits a request that needs approval.'],
                                            ['supportTicket', 'New Support Tickets', 'Alert when a member opens a support ticket.'],
                                            ['supportReply', 'Support Ticket Replies', 'Alert when a member replies to a support ticket.'],
                                            ['supportMediaIssue', 'Media Issue Reports', 'Alert when a member reports a media issue (creates a ticket).'],
                                            ['syncFailure', 'Sync Failures', 'Alert when a manual user sync fails.'],
                                            ['syncSuccess', 'Sync Success', 'Alert after every successful manual user sync.'],
                                        ].map(([key, title, description]) => (
                                            <SettingsToggleRow
                                                key={key}
                                                title={title}
                                                description={description}
                                                checked={alertRules[key] !== false}
                                                onChange={(checked) => setAlertRules(prev => ({ ...prev, [key]: checked }))}
                                                border={false}
                                                className="!py-3"
                                            />
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-6 space-y-3">
                                    <h4 className="font-bold text-text">Test Gotify Settings</h4>
                                    <button
                                        className="px-4 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                        onClick={handleTestGotify}
                                        disabled={isTestingGotify || !gotifyUrl || !gotifyToken}
                                    >
                                        {isTestingGotify ? 'Sending...' : 'Send Test'}
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'newsletter' && (
                        <div className="mb-8">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Automated Newsletter</h3>
                            <div className="mb-4">
                                <SettingFieldLabel
                                    htmlFor="newsletterFrequency"
                                    hint={<SettingHint>How often should users receive the newsletter.</SettingHint>}
                                >
                                    Frequency
                                </SettingFieldLabel>
                                <CustomSelect
                                    id="newsletterFrequency"
                                    value={newsletterFrequency}
                                    onChange={val => setNewsletterFrequency(val)}
                                    options={[
                                        { label: 'Disabled', value: 'disabled' },
                                        { label: 'Weekly', value: 'weekly' },
                                        { label: 'Monthly', value: 'monthly' }
                                    ]}
                                />
                            </div>
                            {newsletterFrequency !== 'disabled' && (
                                <>
                                    <div className="mb-4" style={{ marginTop: '1rem' }}>
                                        <label htmlFor="newsletterDay">Send Day</label>
                                        {newsletterFrequency === 'weekly' ? (
                                            <CustomSelect
                                                id="newsletterDay"
                                                value={newsletterDay}
                                                onChange={val => setNewsletterDay(Number(val))}
                                                options={[
                                                    { label: 'Sunday', value: 0 },
                                                    { label: 'Monday', value: 1 },
                                                    { label: 'Tuesday', value: 2 },
                                                    { label: 'Wednesday', value: 3 },
                                                    { label: 'Thursday', value: 4 },
                                                    { label: 'Friday', value: 5 },
                                                    { label: 'Saturday', value: 6 }
                                                ]}
                                            />
                                        ) : (
                                            <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="newsletterDay" type="number" min="1" max="28" value={newsletterDay} onChange={e => setNewsletterDay(Number(e.target.value))} placeholder="Day of the month (1-28)" />
                                        )}
                                    </div>
                                </>
                            )}
                            <p className="text-sm text-muted mt-4">
                                Invite and newsletter email links use{' '}
                                <button
                                    type="button"
                                    className="text-plex hover:underline font-semibold"
                                    onClick={() => navigateToSetting({
                                        id: 'branding/public-base-url',
                                        tabId: 'branding',
                                        sectionId: 'public-base-url',
                                        label: 'Public Base URL',
                                        group: 'Portal',
                                        keywords: [],
                                    })}
                                >
                                    Settings → Portal UI → Public Base URL
                                </button>
                                .
                            </p>
                            <div className="mt-6 space-y-3">
                                <h4 className="font-bold text-text">Generate Newsletter</h4>
                                <div className="flex flex-col md:flex-row gap-4 mb-4">
                                    <button className="px-4 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center gap-2" onClick={handleRegenerateNewsletter} disabled={isTestingNewsletter || isSendingNewsletter || isGeneratingNewsletter}>
                                        <RefreshCw size={16} className={isGeneratingNewsletter ? 'animate-spin' : ''} aria-hidden="true" />
                                        {isGeneratingNewsletter ? 'Regenerating...' : 'Regenerate Newsletter'}
                                    </button>
                                    <button className="px-4 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center gap-2" onClick={handlePreviewNewsletter} disabled={isTestingNewsletter || isSendingNewsletter || isGeneratingNewsletter}>
                                        {isGeneratingNewsletter ? 'Generating...' : 'Preview Newsletter'}
                                    </button>
                                    <button className="px-4 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center gap-2" onClick={handleDownloadNewsletter} disabled={isTestingNewsletter || isSendingNewsletter || isGeneratingNewsletter}>
                                        Download HTML
                                    </button>
                                    <button className="px-4 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center gap-2" onClick={handleTestNewsletter} disabled={isTestingNewsletter || isSendingNewsletter || isGeneratingNewsletter}>
                                        {isTestingNewsletter ? 'Generating & Sending...' : 'Send Test Newsletter To Admin'}
                                    </button>
                                    <button className="px-4 py-2 bg-plex text-background rounded-md font-medium hover:bg-plex-hover transition-colors flex items-center justify-center gap-2" onClick={handleSendNewsletterNow} disabled={isTestingNewsletter || isSendingNewsletter || isGeneratingNewsletter}>
                                        {isSendingNewsletter ? 'Sending To All...' : 'Send Newsletter To ALL NOW'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'cleanup' && (
                        <div className="mb-8 animate-fade-in">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.cleanup.title')}</h3>
                            <div className="mb-6 bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-lg">
                                <p className="text-sm text-yellow-500 font-bold mb-1">{t('settings.cleanup.warningTitle')}</p>
                                <p className="text-xs text-muted">{t('settings.cleanup.warningBody')}</p>
                            </div>

                            <SettingsToggleRow
                                title={t('settings.cleanup.enableTitle')}
                                description={t('settings.cleanup.enableDescription')}
                                checked={inactiveCleanupEnabled}
                                onChange={setInactiveCleanupEnabled}
                                border={false}
                                className="mb-6"
                            />

                            <div>
                                <div className="mb-4">
                                    <SettingFieldLabel
                                        htmlFor="inactiveCleanupDays"
                                        hint={<SettingHint>{t('settings.cleanup.thresholdHint')}</SettingHint>}
                                    >
                                        {t('settings.cleanup.thresholdLabel')}
                                    </SettingFieldLabel>
                                    <input
                                        className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                        id="inactiveCleanupDays"
                                        type="number"
                                        min="1"
                                        value={inactiveCleanupDays}
                                        onChange={e => setInactiveCleanupDays(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                            <CleanupInactivePreview days={inactiveCleanupDays} addToast={addToast} />
                        </div>
                    )}
                    {activeTab === 'cleaner' && (
                        <div className="mb-8 animate-fade-in">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.navigation.tabs.cleaner')}</h3>
                            <section
                                id={getSettingsSectionElementId('maintenance')}
                                className={`space-y-3 mb-8 transition-all duration-300 scroll-mt-24 ${highlightMaintenanceToggle ? 'ring-2 ring-plex/50 rounded-lg p-3 -m-3' : ''}`}
                            >
                                <p className="text-sm text-muted mb-4">
                                    Maintainerr-style library rules for unwatched titles (Sonarr &amp; Radarr). This is not Settings → Cleanup, which only revokes inactive users.
                                </p>
                                <SettingsToggleRow
                                    title="Enable Library Cleaner"
                                    description="Shows Cleaner in the main sidebar. OFF by default."
                                    checked={maintenanceExperimentalEnabled}
                                    onChange={setMaintenanceExperimentalEnabled}
                                    border={false}
                                />
                                <p className={`text-xs mt-2 font-semibold ${maintenanceExperimentalEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {maintenanceExperimentalEnabled ? 'ON' : 'OFF'}
                                </p>
                                <p className="text-[11px] text-muted mt-1">After changing this toggle, click the main Save Settings button. Then open Cleaner from the main nav.</p>
                            </section>
                        </div>
                    )}
                    {activeTab === 'mediastack' && (
                        <div className="mb-8 animate-fade-in">
                            <div id={getSettingsSectionElementId('arr')} className="scroll-mt-24">
                            <ArrInstancesPanel
                                type="sonarr"
                                title={t('settings.arrIntegrations.titles.sonarrInstances')}
                                subtitle={t('settings.arrIntegrations.subtitles.sonarr')}
                                instances={arrInstances.filter((entry) => entry.type === 'sonarr')}
                                savedInstances={savedArrInstances.filter((entry) => entry.type === 'sonarr')}
                                libraries={libraries}
                                allInstances={arrInstances}
                                copy={arrIntegrationsCopy}
                                onChange={(nextSonarr) => {
                                    const other = arrInstances.filter((entry) => entry.type !== 'sonarr');
                                    setArrInstances([...other, ...nextSonarr]);
                                }}
                                onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                            />

                            <ArrInstancesPanel
                                type="radarr"
                                title={t('settings.arrIntegrations.titles.radarrInstances')}
                                subtitle={t('settings.arrIntegrations.subtitles.radarr')}
                                className="mt-10"
                                instances={arrInstances.filter((entry) => entry.type === 'radarr')}
                                savedInstances={savedArrInstances.filter((entry) => entry.type === 'radarr')}
                                libraries={libraries}
                                allInstances={arrInstances}
                                copy={arrIntegrationsCopy}
                                onChange={(nextRadarr) => {
                                    const other = arrInstances.filter((entry) => entry.type !== 'radarr');
                                    setArrInstances([...other, ...nextRadarr]);
                                }}
                                onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                            />
                            </div>

                            <div id={getSettingsSectionElementId('lidarr')} className="scroll-mt-24">
                            <ArrInstancesPanel
                                type="lidarr"
                                title={t('settings.arrIntegrations.titles.lidarrInstances')}
                                subtitle={t('settings.arrIntegrations.subtitles.lidarr')}
                                className="mt-10"
                                instances={arrInstances.filter((entry) => entry.type === 'lidarr')}
                                savedInstances={savedArrInstances.filter((entry) => entry.type === 'lidarr')}
                                libraries={libraries}
                                allInstances={arrInstances}
                                copy={arrIntegrationsCopy}
                                onChange={(nextLidarr) => {
                                    const other = arrInstances.filter((entry) => entry.type !== 'lidarr');
                                    setArrInstances([...other, ...nextLidarr]);
                                }}
                                onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                            />
                            </div>

                            <div id={getSettingsSectionElementId('bazarr')} className="scroll-mt-24">
                            <ArrInstancesPanel
                                type="bazarr"
                                title={t('settings.arrIntegrations.titles.bazarrInstances')}
                                subtitle={t('settings.arrIntegrations.subtitles.bazarr')}
                                className="mt-10"
                                instances={arrInstances.filter((entry) => entry.type === 'bazarr')}
                                savedInstances={savedArrInstances.filter((entry) => entry.type === 'bazarr')}
                                libraries={libraries}
                                allInstances={arrInstances}
                                copy={arrIntegrationsCopy}
                                onChange={(nextBazarr) => {
                                    const other = arrInstances.filter((entry) => entry.type !== 'bazarr');
                                    setArrInstances([...other, ...nextBazarr]);
                                }}
                                onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                            />
                            </div>

                            <div id={getSettingsSectionElementId('download-clients')} className="scroll-mt-24">
                            <IntegrationHeading app="download" title="Download Clients" subtitle="qBittorrent, Real-Debrid Client, Transmission, BitTorrent, Deluge, SABnzbd, and NZBGet status sources" className="mt-10" />
                            <div className="flex items-center justify-between gap-3 mb-4">
                                <p className="text-sm text-muted">These clients feed the Download Status page.</p>
                                <button
                                    type="button"
                                    onClick={() => setDownloadClients([...downloadClients, createEmptyDownloadClient()])}
                                    className="px-3 py-2 rounded-lg border border-border text-sm font-medium text-text hover:bg-white/5 transition-colors flex items-center gap-2 shrink-0"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Instance
                                </button>
                            </div>
                            {downloadClients.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted text-center">No download clients configured.</div>
                            ) : (
                                <div className="space-y-4">
                                    {downloadClients.map((client) => {
                                        const clientLabel = DOWNLOAD_CLIENT_TYPE_LABELS[client.type] || 'qBittorrent';
                                        return (
                                        <div key={client.id} className="rounded-xl border border-border bg-background/40 p-4">
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-border/50">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <ProgramIcon app={client.type} label={clientLabel} />
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-text truncate">{client.name || clientLabel}</p>
                                                        <p className="text-xs text-muted">{clientLabel} download client</p>
                                                    </div>
                                                </div>
                                                <IntegrationTestButton
                                                    type="downloadClient"
                                                    payload={{
                                                        downloadClientId: client.id,
                                                        downloadClientType: client.type,
                                                        downloadClientUrl: client.url,
                                                        downloadClientUsername: client.username || '',
                                                        downloadClientPassword: client.password || '',
                                                    }}
                                                    disabled={!client.url}
                                                    className="sm:items-end"
                                                />
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">Type</label>
                                                <CustomSelect
                                                    value={client.type}
                                                    onChange={(type) => setDownloadClients(downloadClients.map((entry) => {
                                                        if (entry.id !== client.id) return entry;
                                                        const nextType = type as DownloadClientConfig['type'];
                                                        const previousLabel = DOWNLOAD_CLIENT_TYPE_LABELS[entry.type] || 'qBittorrent';
                                                        const nextLabel = DOWNLOAD_CLIENT_TYPE_LABELS[nextType] || 'qBittorrent';
                                                        const name = !entry.name || entry.name === previousLabel ? nextLabel : entry.name;
                                                        return { ...entry, type: nextType, name };
                                                    }))}
                                                    options={[
                                                        { label: 'qBittorrent', value: 'qbittorrent' },
                                                        { label: 'Real-Debrid Client', value: 'rdtclient' },
                                                        { label: 'Transmission', value: 'transmission' },
                                                        { label: 'BitTorrent', value: 'bittorrent' },
                                                        { label: 'Deluge', value: 'deluge' },
                                                        { label: 'SABnzbd', value: 'sabnzbd' },
                                                        { label: 'NZBGet', value: 'nzbget' },
                                                    ]}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">Display Name</label>
                                                <input className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-[16px]" value={client.name} onChange={(e) => setDownloadClients(downloadClients.map((entry) => entry.id === client.id ? { ...entry, name: e.target.value } : entry))} />
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">URL</label>
                                                <input className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-[16px]" value={client.url} onChange={(e) => setDownloadClients(downloadClients.map((entry) => entry.id === client.id ? { ...entry, url: e.target.value } : entry))} placeholder={downloadClientUrlPlaceholder(client.type)} />
                                                {client.type === 'rdtclient' && (
                                                    <p className="text-[11px] text-muted mt-1">RDT-Client emulates the qBittorrent API. Default port is 6500.</p>
                                                )}
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">{client.type === 'sabnzbd' ? 'Username (Optional)' : 'Username'}</label>
                                                <input className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-[16px]" value={client.username || ''} onChange={(e) => setDownloadClients(downloadClients.map((entry) => entry.id === client.id ? { ...entry, username: e.target.value } : entry))} />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">{client.type === 'sabnzbd' ? 'API Key' : 'Password'}</label>
                                                <input className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-[16px]" type="password" value={client.password || ''} onChange={(e) => setDownloadClients(downloadClients.map((entry) => entry.id === client.id ? { ...entry, password: e.target.value } : entry))} />
                                            </div>
                                            <div className="md:col-span-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                                <label className="text-sm text-muted flex items-center gap-2">
                                                    <input type="checkbox" checked={client.enabled !== false} onChange={(e) => setDownloadClients(downloadClients.map((entry) => entry.id === client.id ? { ...entry, enabled: e.target.checked } : entry))} />
                                                    Enabled
                                                </label>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <IntegrationTestButton
                                                        type="downloadClient"
                                                        label="Test"
                                                        payload={{
                                                            downloadClientId: client.id,
                                                            downloadClientType: client.type,
                                                            downloadClientUrl: client.url,
                                                            downloadClientUsername: client.username || '',
                                                            downloadClientPassword: client.password || '',
                                                        }}
                                                        disabled={!client.url}
                                                    />
                                                    <button type="button" className="px-3 py-2 rounded-lg text-sm text-red-300 hover:bg-red-500/10" onClick={() => setDownloadClients(downloadClients.filter((entry) => entry.id !== client.id))}>
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                            </div>
                                        </div>
                                    );})}
                                </div>
                            )}
                            </div>

                            <div id={getSettingsSectionElementId('tmdb')} className="scroll-mt-24">
                            <IntegrationHeading app="tmdb" title="TMDB Integration" subtitle="Worldwide trending backgrounds" className="mt-8" />
                            <div className="mb-4">
                                <SettingFieldLabel
                                    htmlFor="tmdbApiKey"
                                    hint={<SettingHint>Used to fetch worldwide trending media backgrounds for the portal slideshow. Get one for free at themoviedb.org.</SettingHint>}
                                >
                                    TMDB API Key
                                </SettingFieldLabel>
                                <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="tmdbApiKey" type="password" value={tmdbApiKey} onChange={(e) => setTmdbApiKey(e.target.value)} placeholder="Enter TMDB API Key" />
                            </div>
                            <IntegrationTestButton
                                type="tmdb"
                                payload={{ tmdbApiKey }}
                                disabled={!String(tmdbApiKey || initialSettings.tmdbApiKey || '').trim()}
                                className="mb-6"
                                onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                            />
                            </div>
                            {mediaServerType === 'plex' && (
                                <div id={getSettingsSectionElementId('tautulli')} className="scroll-mt-24">
                                <IntegrationHeading app="tautulli" title="Tautulli Integration" subtitle="Plex activity and analytics" className="mt-8" />
                                <div className="mb-4">
                                    <label htmlFor="tautulliUrl">Tautulli URL</label>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="tautulliUrl" type="text" value={tautulliUrl} onChange={(e) => setTautulliUrl(e.target.value)} placeholder="http://localhost:8181" />
                                </div>
                                <div className="mb-8">
                                    <label htmlFor="tautulliApiKey">Tautulli API Key</label>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="tautulliApiKey" type="password" value={tautulliApiKey} onChange={(e) => setTautulliApiKey(e.target.value)} placeholder="Enter Tautulli API Key" />
                                </div>
                                <IntegrationTestButton
                                    type="tautulli"
                                    payload={{ tautulliUrl, tautulliApiKey }}
                                    disabled={!hasIntegrationCredentials(tautulliUrl, tautulliApiKey, initialSettings.tautulliUrl, initialSettings.tautulliApiKey)}
                                    className="mb-4"
                                    onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                                />
                                <SettingsToggleRow
                                    title="Notify when Tautulli API fails"
                                    description="Alert admins (bell / push / ntfy) when StreamPilot cannot reach Tautulli or the API returns an error. Cooldown 30 minutes. Each admin can mute this under Preferences."
                                    checked={notifyTautulliApiFailed}
                                    onChange={setNotifyTautulliApiFailed}
                                    className="mb-6"
                                />
                                </div>
                            )}

                            {mediaServerType !== 'plex' && (
                                <div id={getSettingsSectionElementId('jellystat')} className="scroll-mt-24">
                                <IntegrationHeading app={jellyfinAnalyticsProvider === 'jellyglance' ? 'jellyglance' : 'jellystat'} title="Jellyfin Analytics" subtitle="Jellystat or JellyGlance activity analytics" className="mt-8" />
                                <div className="mb-4">
                                    <SettingFieldLabel
                                        htmlFor="jellyfinAnalyticsProvider"
                                        hint={<SettingHint>Choose which Jellyfin analytics companion powers activity charts, wrap-ups, and heatmaps.</SettingHint>}
                                    >
                                        Analytics Provider
                                    </SettingFieldLabel>
                                    <CustomSelect
                                        id="jellyfinAnalyticsProvider"
                                        value={jellyfinAnalyticsProvider}
                                        onChange={setJellyfinAnalyticsProvider}
                                        options={[
                                            { label: 'Jellystat', value: 'jellystat' },
                                            { label: 'JellyGlance', value: 'jellyglance' },
                                        ]}
                                    />
                                </div>
                                {jellyfinAnalyticsProvider === 'jellyglance' ? (
                                    <>
                                        <div className="mb-4">
                                            <SettingFieldLabel
                                                htmlFor="jellyglanceUrl"
                                                hint={<SettingHint>The URL to your JellyGlance instance. JellyGlance exposes Jellyfin statistics through its API using a JellyGlance API key.</SettingHint>}
                                            >
                                                JellyGlance URL
                                            </SettingFieldLabel>
                                            <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="jellyglanceUrl" type="text" value={jellyglanceUrl} onChange={(e) => setJellyglanceUrl(e.target.value)} placeholder="http://localhost:3000" />
                                        </div>
                                        <div className="mb-8">
                                            <label htmlFor="jellyglanceApiKey">JellyGlance API Key</label>
                                            <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="jellyglanceApiKey" type="password" value={jellyglanceApiKey} onChange={(e) => setJellyglanceApiKey(e.target.value)} placeholder="API key from JellyGlance Settings" />
                                        </div>
                                        <IntegrationTestButton
                                            type="jellyglance"
                                            payload={{ jellyglanceUrl, jellyglanceApiKey }}
                                            disabled={!hasIntegrationCredentials(jellyglanceUrl, jellyglanceApiKey, initialSettings.jellyglanceUrl, initialSettings.jellyglanceApiKey)}
                                            className="mb-6"
                                            onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                                        />
                                    </>
                                ) : (
                                    <>
                                <div className="mb-4">
                                    <SettingFieldLabel
                                        htmlFor="jellystatUrl"
                                        hint={<SettingHint>The URL to your Jellystat instance. Jellystat is the Jellyfin analytics companion, similar to Tautulli for Plex.</SettingHint>}
                                    >
                                        Jellystat URL
                                    </SettingFieldLabel>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="jellystatUrl" type="text" value={jellystatUrl} onChange={(e) => setJellystatUrl(e.target.value)} placeholder="http://localhost:3000" />
                                </div>
                                <div className="mb-8">
                                    <label htmlFor="jellystatApiKey">Jellystat API Key</label>
                                    <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="jellystatApiKey" type="password" value={jellystatApiKey} onChange={(e) => setJellystatApiKey(e.target.value)} placeholder="API key from Jellystat Settings" />
                                </div>
                                <IntegrationTestButton
                                    type="jellystat"
                                    payload={{ jellystatUrl, jellystatApiKey }}
                                    disabled={!hasIntegrationCredentials(jellystatUrl, jellystatApiKey, initialSettings.jellystatUrl, initialSettings.jellystatApiKey)}
                                    className="mb-6"
                                    onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                                />
                                    </>
                                )}
                                </div>
                            )}

                            <div id={getSettingsSectionElementId('seerr')} className="scroll-mt-24">
                            <IntegrationHeading
                                app={requestAppType === 'none' ? 'seerr' : requestAppType}
                                title="Seerr / Jellyseerr"
                                subtitle="Optional — use as request engine, or only for history import"
                                className="mt-8"
                            />
                            <div className="mb-4">
                                <SettingFieldLabel
                                    htmlFor="requestAppType"
                                    hint={<SettingHint>Required when Request Engine is Seerr, or to import history into the portal. Leave Disabled for portal-only setups.</SettingHint>}
                                >
                                    Request App Type
                                </SettingFieldLabel>
                                <CustomSelect
                                    id="requestAppType"
                                    value={requestAppType}
                                    onChange={(val) => setRequestAppType(val)}
                                    options={[
                                        { label: 'Disabled', value: 'none' },
                                        { label: 'Seerr / Overseerr', value: 'seerr' },
                                        { label: 'Jellyseerr', value: 'jellyseerr' },
                                    ]}
                                />
                            </div>
                            <div className="mb-4">
                                <SettingFieldLabel
                                    htmlFor="requestAppUrl"
                                    hint={(
                                        <SettingHint>
                                            Public URL (reverse proxy is fine). Server-side API calls use the internal fetch URL below when set.
                                        </SettingHint>
                                    )}
                                >
                                    Seerr URL
                                </SettingFieldLabel>
                                <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="requestAppUrl" type="text" value={requestAppUrl} onChange={(e) => setRequestAppUrl(e.target.value)} placeholder="https://requests.yourdomain.com" />
                            </div>
                            <div className="mb-4">
                                <SettingFieldLabel
                                    htmlFor="requestAppFetchUrl"
                                    hint={(
                                        <SettingHint>
                                            Optional. URL the portal uses to reach Seerr from inside Docker (e.g. <code>http://jellyseerr:5055</code>). Leave blank to use the public URL above.
                                        </SettingHint>
                                    )}
                                >
                                    Internal fetch URL (optional)
                                </SettingFieldLabel>
                                <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="requestAppFetchUrl" type="text" value={requestAppFetchUrl} onChange={(e) => setRequestAppFetchUrl(e.target.value)} placeholder="http://jellyseerr:5055" />
                            </div>
                            <div className="mb-8">
                                <label htmlFor="requestAppApiKey">Seerr API Key</label>
                                <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="requestAppApiKey" type="password" value={requestAppApiKey} onChange={(e) => setRequestAppApiKey(e.target.value)} placeholder="API key from Seerr / Jellyseerr settings" />
                            </div>
                            <IntegrationTestButton
                                type="requestApp"
                                payload={{ requestAppType, requestAppUrl, requestAppFetchUrl, requestAppApiKey }}
                                disabled={requestAppType === 'none' || !hasIntegrationCredentials(requestAppUrl, requestAppApiKey, initialSettings.requestAppUrl, initialSettings.requestAppApiKey)}
                                onMessage={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
                            />
                            </div>
                        </div>
                    )}

                    {activeTab === 'request' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Request Discovery</h3>
                            <p className="text-muted text-sm max-w-3xl">
                                Portal (default) runs Discover &amp; Request with TMDB + *arr. Seerr/Jellyseerr remains available as an optional engine or for history import.
                            </p>

                            <div id={getSettingsSectionElementId('discovery-source')} className="scroll-mt-24">
                                <SettingFieldLabel
                                    htmlFor="discoverySource"
                                    hint={(
                                        <SettingHint>
                                            TMDB (default) browses Discover without Seerr — needs a TMDB API key; library overlays use Sonarr/Radarr.
                                            Seerr can proxy metadata if you prefer that stack.
                                        </SettingHint>
                                    )}
                                >
                                    Discover Metadata Source
                                </SettingFieldLabel>
                                <CustomSelect
                                    id="discoverySource"
                                    value={discoverySource}
                                    onChange={setDiscoverySource}
                                    options={[
                                        { value: 'tmdb', label: 'TMDB direct (default)' },
                                        { value: 'seerr', label: 'Seerr / Overseerr' },
                                    ]}
                                />
                                {discoverySource === 'tmdb' && !String(tmdbApiKey || '').trim() && !String(initialSettings.tmdbApiKey || '').trim() && (
                                    <p className="text-amber-300 text-sm mt-2">
                                        Set a TMDB API key under Integrations — required for Discover browse.
                                    </p>
                                )}
                                {discoverySource === 'seerr' && requestAppType === 'none' && (
                                    <p className="text-amber-300 text-sm mt-2">
                                        Configure Seerr under Integrations when using Seerr for Discover metadata.
                                    </p>
                                )}
                            </div>

                            <div id={getSettingsSectionElementId('request-engine')} className="scroll-mt-24">
                                <SettingFieldLabel
                                    htmlFor="requestEngine"
                                    hint={(
                                        <SettingHint>
                                            Portal stores requests/issues as JSON and pushes to *arr on approve.
                                            Seerr keeps requests in your request app — configure URL + API key under Integrations.
                                        </SettingHint>
                                    )}
                                >
                                    Request Engine
                                </SettingFieldLabel>
                                <CustomSelect
                                    id="requestEngine"
                                    value={requestEngine}
                                    onChange={setRequestEngine}
                                    options={[
                                        { value: 'portal', label: 'Portal (default)' },
                                        { value: 'seerr', label: 'Seerr / Overseerr / Jellyseerr' },
                                    ]}
                                />
                                {requestEngine === 'seerr' && requestAppType === 'none' && (
                                    <p className="text-amber-300 text-sm mt-2">
                                        Enable Seerr under Integrations to use it as the request engine.
                                    </p>
                                )}
                                {requestEngine === 'portal' && (
                                    <div className="mt-3 flex flex-wrap items-center gap-3">
                                        <button
                                            type="button"
                                            disabled={importingSeerrHistory || requestAppType === 'none'}
                                            onClick={async () => {
                                                setImportingSeerrHistory(true);
                                                try {
                                                    const summary = await apiFetch('/api/requests/import-from-seerr', {
                                                        method: 'POST',
                                                        body: JSON.stringify({ includeIssues: true, includeBlocklist: true }),
                                                    });
                                                    const req = summary?.requests || {};
                                                    const iss = summary?.issues || {};
                                                    addToast(
                                                        `Imported ${req.imported || 0} requests` +
                                                        (req.importedWithFallback ? ` (${req.importedWithFallback} labeled under your name for display)` : '') +
                                                        (req.skippedUnmapped ? ` (${req.skippedUnmapped} skipped — no matching user)` : '') +
                                                        `, ${iss.imported || 0} issues` +
                                                        `, ${summary?.blocklist?.imported || 0} blocklist.`,
                                                        'success',
                                                    );
                                                } catch (e: any) {
                                                    addToast(e?.message || 'Seerr import failed', 'error');
                                                } finally {
                                                    setImportingSeerrHistory(false);
                                                }
                                            }}
                                            className="inline-flex items-center rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                                        >
                                            {importingSeerrHistory ? 'Importing…' : 'Import Seerr history'}
                                        </button>
                                        <p className="text-xs text-white/45 max-w-md">
                                            Optional one-shot copy into portal JSON. Configure Seerr under Integrations first.
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div id={getSettingsSectionElementId('request-form')} className="scroll-mt-24 space-y-3">
                                <h4 className="text-sm font-bold text-text uppercase tracking-wider">Request form</h4>
                                <p className="text-xs text-muted max-w-2xl">
                                    These apply to Discover &amp; Request in StreamPilot for both Portal and Seerr engines.
                                    Turn them off to skip destination, quality profile, root folder/library, and tags on every confirmation.
                                </p>
                                <SettingsToggleRow
                                    title="Allow advanced request options"
                                    description="When off, members only submit Request Movie/Show (plus seasons or HD/4K if needed). Destination server, quality profile, root folder/library, and tags stay hidden; Seerr/*arr defaults are used."
                                    checked={portalAllowAdvancedRequests}
                                    onChange={setPortalAllowAdvancedRequests}
                                    border={false}
                                />
                                <SettingsToggleRow
                                    title="Allow request tags"
                                    description="When off, the tags field is hidden on the member request form. *arr still uses its default tags. Requires advanced request options."
                                    checked={portalAllowRequestTags}
                                    onChange={setPortalAllowRequestTags}
                                    disabled={!portalAllowAdvancedRequests}
                                    border={false}
                                />
                            </div>

                            {requestEngine === 'portal' && (
                            <div className="space-y-8">
                                    <div id={getSettingsSectionElementId('metadata-providers')} className="scroll-mt-24 space-y-4">
                                        <h4 className="text-sm font-bold text-text uppercase tracking-wider">Metadata providers</h4>
                                        <p className="text-xs text-muted max-w-2xl">
                                            Series/anime matching for Sonarr. TMDB is default; TVDB prefers TheTVDB ids when resolving library matches (browse catalog stays TMDB).
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <SettingFieldLabel htmlFor="seriesMetadataProvider">Series provider</SettingFieldLabel>
                                                <CustomSelect
                                                    id="seriesMetadataProvider"
                                                    value={seriesMetadataProvider}
                                                    onChange={setSeriesMetadataProvider}
                                                    options={[
                                                        { value: 'tmdb', label: 'TMDB' },
                                                        { value: 'tvdb', label: 'TVDB' },
                                                    ]}
                                                />
                                            </div>
                                            <div>
                                                <SettingFieldLabel htmlFor="animeMetadataProvider">Anime provider</SettingFieldLabel>
                                                <CustomSelect
                                                    id="animeMetadataProvider"
                                                    value={animeMetadataProvider}
                                                    onChange={setAnimeMetadataProvider}
                                                    options={[
                                                        { value: 'tmdb', label: 'TMDB' },
                                                        { value: 'tvdb', label: 'TVDB' },
                                                    ]}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <SettingFieldLabel
                                                htmlFor="tvdbApiKey"
                                                hint={<SettingHint>Optional. Used for Discover TV poster fallback when TMDB has no art, and for connectivity tests. Sonarr matching still works via TMDB external_ids when empty.</SettingHint>}
                                            >
                                                TVDB API key
                                            </SettingFieldLabel>
                                            <div className="flex flex-wrap gap-2">
                                                <input
                                                    id="tvdbApiKey"
                                                    type="password"
                                                    autoComplete="off"
                                                    className="appearance-none text-[16px] leading-5 flex-1 min-w-[12rem] rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                                                    value={tvdbApiKey}
                                                    onChange={(e) => setTvdbApiKey(e.target.value)}
                                                    placeholder={initialSettings.tvdbApiKey ? '•••••••• (unchanged if blank)' : 'Optional'}
                                                />
                                                <button
                                                    type="button"
                                                    disabled={testingTvdb}
                                                    className="rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                                                    onClick={async () => {
                                                        setTestingTvdb(true);
                                                        try {
                                                            const res = await apiFetch('/api/integrations/tvdb/test', {
                                                                method: 'POST',
                                                                body: JSON.stringify({ apiKey: tvdbApiKey }),
                                                            });
                                                            addToast(res?.message || (res?.ok ? 'TVDB OK' : 'TVDB test failed'), res?.ok ? 'success' : 'error');
                                                        } catch (e: any) {
                                                            addToast(e?.message || 'TVDB test failed', 'error');
                                                        } finally {
                                                            setTestingTvdb(false);
                                                        }
                                                    }}
                                                >
                                                    {testingTvdb ? 'Testing…' : 'Test TVDB'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div id={getSettingsSectionElementId('request-permissions')} className="scroll-mt-24 space-y-3">
                                        <h4 className="text-sm font-bold text-text uppercase tracking-wider">Request permissions (defaults)</h4>
                                        <SettingsToggleRow title="Request movies" checked={portalAllowRequestMovies} onChange={setPortalAllowRequestMovies} border={false} />
                                        <SettingsToggleRow title="Request series" checked={portalAllowRequestTv} onChange={setPortalAllowRequestTv} border={false} />
                                        <SettingsToggleRow title="Request 4K movies" checked={portalAllowRequest4kMovies} onChange={setPortalAllowRequest4kMovies} border={false} />
                                        <SettingsToggleRow title="Request 4K series" checked={portalAllowRequest4kTv} onChange={setPortalAllowRequest4kTv} border={false} />
                                        <SettingsToggleRow title="Show recently added on Discover home" checked={portalShowRecentlyAdded} onChange={setPortalShowRecentlyAdded} border={false} />
                                        <SettingsToggleRow title="Show Plex watchlist on Discover home" checked={portalShowWatchlist} onChange={setPortalShowWatchlist} border={false} />
                                        <SettingsToggleRow title="Show Now Playing strip on Home & Discover heroes" checked={discoverNowPlayingEnabled} onChange={setDiscoverNowPlayingEnabled} border={false} />
                                    </div>

                                    <div id={getSettingsSectionElementId('auto-approve')} className="scroll-mt-24 space-y-3">
                                        <h4 className="text-sm font-bold text-text uppercase tracking-wider">Auto-approve</h4>
                                        <SettingsToggleRow title="Auto-approve movies" checked={autoApproveMovies} onChange={setAutoApproveMovies} border={false} />
                                        <SettingsToggleRow title="Auto-approve series" checked={autoApproveTv} onChange={setAutoApproveTv} border={false} />
                                        <SettingsToggleRow title="Auto-approve 4K movies" checked={autoApproveMovies4k} onChange={setAutoApproveMovies4k} border={false} />
                                        <SettingsToggleRow title="Auto-approve 4K series" checked={autoApproveTv4k} onChange={setAutoApproveTv4k} border={false} />
                                    </div>

                                    <div id={getSettingsSectionElementId('auto-request')} className="scroll-mt-24 space-y-3">
                                        <h4 className="text-sm font-bold text-text uppercase tracking-wider">Auto-request (watchlist)</h4>
                                        <p className="text-xs text-muted">When a member’s Plex watchlist syncs, create portal requests for new titles.</p>
                                        <SettingsToggleRow title="Auto-request movies from watchlist" checked={portalAutoRequestMovies} onChange={setPortalAutoRequestMovies} border={false} />
                                        <SettingsToggleRow title="Auto-request series from watchlist" checked={portalAutoRequestTv} onChange={setPortalAutoRequestTv} border={false} />
                                    </div>

                                    <div id={getSettingsSectionElementId('portal-quotas')} className="scroll-mt-24 space-y-4">
                                        <h4 className="text-sm font-bold text-text uppercase tracking-wider">Quotas</h4>
                                        <SettingFieldLabel
                                            htmlFor="requestQuotaLimit"
                                            hint={<SettingHint>0 = Unlimited. Rolling window applies to member requests. Per-user overrides live on Users → Edit User.</SettingHint>}
                                        >
                                            Request quota (standard)
                                        </SettingFieldLabel>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div>
                                                <label className="text-xs text-muted mb-1 block">Limit</label>
                                                <input
                                                    id="requestQuotaLimit"
                                                    type="number"
                                                    min={0}
                                                    className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                                                    value={requestQuotaLimit}
                                                    onChange={(e) => setRequestQuotaLimit(Math.max(0, Number(e.target.value) || 0))}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted mb-1 block">Days</label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                                                    value={requestQuotaDays}
                                                    onChange={(e) => setRequestQuotaDays(Math.max(1, Number(e.target.value) || 7))}
                                                    aria-label="Quota days"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted mb-1 block">4K limit</label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                                                    value={requestQuotaLimit4k}
                                                    onChange={(e) => setRequestQuotaLimit4k(Math.max(0, Number(e.target.value) || 0))}
                                                    aria-label="4K quota limit"
                                                />
                                            </div>
                                        </div>
                                        <p className="text-xs text-white/45">
                                            {requestQuotaLimit === 0 ? 'Unlimited HD requests' : `${requestQuotaLimit} HD / ${requestQuotaDays} days`}
                                            {' · '}
                                            {requestQuotaLimit4k === 0 ? 'Unlimited 4K' : `${requestQuotaLimit4k} 4K`}
                                        </p>
                                    </div>
                            </div>
                            )}

                            {requestEngine === 'seerr' && requestAppType !== 'none' && requestAppBaseUrl && (
                                <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
                                    <h4 className="font-bold text-text">Seerr / Overseerr rules</h4>
                                    <p className="text-sm text-muted">
                                        Quotas, auto-approve, override rules, and watchlist sync are managed in your request app.
                                        The Request form toggles above still control whether StreamPilot shows destination, quality profile, library/root folder, and tags.
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <a
                                            href={`${requestAppBaseUrl}/settings/users`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm font-bold text-text hover:border-plex/40 hover:text-plex transition-colors"
                                        >
                                            Users &amp; permissions
                                        </a>
                                        <a
                                            href={`${requestAppBaseUrl}/settings/main`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm font-bold text-text hover:border-plex/40 hover:text-plex transition-colors"
                                        >
                                            Main settings
                                        </a>
                                        <a
                                            href={`${requestAppBaseUrl}/settings/services`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm font-bold text-text hover:border-plex/40 hover:text-plex transition-colors"
                                        >
                                            Services &amp; 4K
                                        </a>
                                    </div>
                                </div>
                            )}

                            <div id={getSettingsSectionElementId('request-available-notify')} className="scroll-mt-24 space-y-3">
                                <h4 className="text-sm font-bold text-text uppercase tracking-wider">Request available notifications</h4>
                                <p className="text-xs text-muted max-w-2xl">
                                    When a request finishes downloading and becomes available, notify the requester.
                                    Full health, test send, and history live under{' '}
                                    <button type="button" className="font-bold text-plex hover:underline" onClick={() => setActiveTab('notifications')}>
                                        Settings → Notifications
                                    </button>
                                    .
                                </p>
                                <SettingsToggleRow
                                    title="Enable notifications"
                                    description="Master switch for request-available alerts (portal or Seerr engine)."
                                    checked={requestAvailableNotifyEnabled}
                                    onChange={setRequestAvailableNotifyEnabled}
                                    border={false}
                                />
                                <div className={requestAvailableNotifyEnabled ? 'space-y-0' : 'space-y-0 opacity-50 pointer-events-none'}>
                                    <SettingsToggleRow
                                        title="Email"
                                        description="Send SMTP email when a request becomes available. Requires SMTP under Integrations."
                                        checked={requestAvailableNotifyEmail}
                                        onChange={setRequestAvailableNotifyEmail}
                                        border={false}
                                    />
                                    <SettingsToggleRow
                                        title="In-app bell"
                                        description="Show an unread notification in the portal nav for the requester."
                                        checked={requestAvailableNotifyInApp}
                                        onChange={setRequestAvailableNotifyInApp}
                                        border={false}
                                    />
                                    <SettingsToggleRow
                                        title="Browser push"
                                        description="Send a Web Push notification to subscribed browsers/devices."
                                        checked={requestAvailableNotifyWebPush}
                                        onChange={setRequestAvailableNotifyWebPush}
                                        border={false}
                                    />
                                    <SettingsToggleRow
                                        title="Discord webhook"
                                        description="Post to a Discord channel via incoming webhook when any request becomes available."
                                        checked={requestAvailableNotifyDiscord}
                                        onChange={setRequestAvailableNotifyDiscord}
                                        border={false}
                                    />
                                    {requestAvailableNotifyDiscord && (
                                        <div className="pt-1 pb-3">
                                            <SettingFieldLabel htmlFor="requestAvailableDiscordWebhookUrl">
                                                Discord webhook URL
                                            </SettingFieldLabel>
                                            <input
                                                id="requestAvailableDiscordWebhookUrl"
                                                type="password"
                                                autoComplete="off"
                                                className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                                                placeholder="https://discord.com/api/webhooks/..."
                                                value={requestAvailableDiscordWebhookUrl}
                                                onChange={(e) => setRequestAvailableDiscordWebhookUrl(e.target.value)}
                                            />
                                            <p className="text-[11px] text-muted mt-1.5">
                                                Leave as dots when editing other settings to keep the saved webhook.
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <SettingsToggleRow
                                    title="Enable Web Push (global)"
                                    description="Allows members to subscribe their browser for push. Also used for future in-app bell fan-out."
                                    checked={webPushEnabled}
                                    onChange={setWebPushEnabled}
                                    border={false}
                                />
                            </div>

                            <div id={getSettingsSectionElementId('region')} className="scroll-mt-24">
                                <SettingFieldLabel
                                    htmlFor="requestDiscoverRegion"
                                    hint={<SettingHint>Prioritizes content for your region on discover pages. Does not fully restrict results to that country.</SettingHint>}
                                >
                                    Discover Region
                                </SettingFieldLabel>
                                <CustomSelect
                                    id="requestDiscoverRegion"
                                    value={requestDiscoverRegion}
                                    onChange={setRequestDiscoverRegion}
                                    options={DISCOVER_REGION_OPTIONS}
                                />
                            </div>

                            <div id={getSettingsSectionElementId('language')} className="scroll-mt-24">
                                <SettingFieldLabel
                                    htmlFor="requestDiscoverLanguage"
                                    hint={<SettingHint>Only show titles whose original language matches your selection on Discover home and the Movies/Series browse tabs (same as Seerr). Titles may still appear in English translation — this filters by original language (e.g. French or Korean originals are hidden when English is selected). Search is not filtered.</SettingHint>}
                                >
                                    Discover Language
                                </SettingFieldLabel>
                                <CustomSelect
                                    id="requestDiscoverLanguage"
                                    value={requestDiscoverLanguage}
                                    onChange={setRequestDiscoverLanguage}
                                    options={DISCOVER_LANGUAGE_OPTIONS}
                                />
                            </div>

                            <div id={getSettingsSectionElementId('hide-available')} className="scroll-mt-24">
                                <SettingsToggleRow
                                    title="Hide Available Media"
                                    hint={(
                                        <SettingHint>
                                            When on, Available and Partially Available titles are hidden from Discover home/browse. Requested titles still appear (with badges) so you can track them. Movies/Series also have a per-page toggle. Search is never filtered.
                                        </SettingHint>
                                    )}
                                    checked={requestHideAvailableMedia}
                                    onChange={setRequestHideAvailableMedia}
                                    border={false}
                                />
                                <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300 border border-amber-500/20 mt-2">
                                    Experimental
                                </span>
                            </div>

                            <div className="rounded-xl border border-border/60 bg-background/40 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div>
                                    <p className="font-semibold text-text text-sm">Discover availability cache</p>
                                    <p className="text-xs text-muted mt-1">
                                        Sonarr/Radarr library badges on Discover are served from a background snapshot. Rebuild after *arr or library changes.
                                    </p>
                                    {discoveryAvailabilityTask ? (
                                        <p className="text-xs mt-2">
                                            {discoveryAvailabilityTask.running ? (
                                                <span className="text-blue-300 font-semibold">Rebuild running…</span>
                                            ) : discoveryAvailabilityTask.lastError ? (
                                                <span className="text-red-300">Last error: {discoveryAvailabilityTask.lastError}</span>
                                            ) : (
                                                <span className="text-muted">
                                                    Last rebuild:{' '}
                                                    {discoveryAvailabilityTask.lastRun
                                                        ? new Date(discoveryAvailabilityTask.lastRun).toLocaleString()
                                                        : 'Never'}
                                                    {discoveryAvailabilityTask.nextRun ? (
                                                        <>
                                                            {' '}
                                                            · Next: {new Date(discoveryAvailabilityTask.nextRun).toLocaleString()}
                                                        </>
                                                    ) : null}
                                                    {typeof discoveryAvailabilityTask.lastDurationMs === 'number' ? (
                                                        <>
                                                            {' '}
                                                            · Duration: {Math.round(discoveryAvailabilityTask.lastDurationMs / 1000)}s
                                                        </>
                                                    ) : null}
                                                </span>
                                            )}
                                        </p>
                                    ) : null}
                                </div>
                                <button
                                    type="button"
                                    className="btn-secondary px-4 py-2 text-sm font-bold whitespace-nowrap disabled:opacity-50"
                                    disabled={refreshingDiscoveryCache || discoveryAvailabilityTask?.running}
                                    onClick={() => void refreshDiscoveryAvailabilityCache()}
                                >
                                    {refreshingDiscoveryCache || discoveryAvailabilityTask?.running
                                        ? 'Refreshing…'
                                        : 'Refresh availability'}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'applets' && (
                        <div className="mb-8">
                            <section id={getSettingsSectionElementId('applets')} className="scroll-mt-24">
                                <CustomNavTabsSettings
                                    customNavTabs={customNavTabs}
                                    onChange={setCustomNavTabs}
                                    customNavDisplay={customNavDisplay}
                                    onDisplayChange={setCustomNavDisplay}
                                    arrOpenInPortalEmbed={arrOpenInPortalEmbed}
                                    onArrOpenInPortalEmbedChange={setArrOpenInPortalEmbed}
                                    navOrder={navOrder}
                                    onNavOrderChange={setNavOrder}
                                    memberNavOrder={memberNavOrder}
                                    onMemberNavOrderChange={setMemberNavOrder}
                                />
                            </section>
                        </div>
                    )}

                    {activeTab === 'layout' && (
                        <div className="mb-8 space-y-10">
                            <section id={getSettingsSectionElementId('navigation')} className="scroll-mt-24">
                                <NavigationOrderSettings
                                    navOrder={navOrder}
                                    onChange={setNavOrder}
                                    navHiddenKeys={navHiddenKeys}
                                    onHiddenKeysChange={setNavHiddenKeys}
                                    memberNavOrder={memberNavOrder}
                                    onMemberNavOrderChange={setMemberNavOrder}
                                    memberNavHiddenKeys={memberNavHiddenKeys}
                                    onMemberNavHiddenKeysChange={setMemberNavHiddenKeys}
                                    downloadsVisibleToMembers={downloadsVisibleToMembers}
                                    onDownloadsVisibleToMembersChange={setDownloadsVisibleToMembers}
                                    customNavTabs={customNavTabs}
                                    customNavDisplay={customNavDisplay}
                                    navItemIcons={navItemIcons}
                                    onNavItemIconsChange={setNavItemIcons}
                                    featureStatus={{
                                        upgrader: upgraderEnabled,
                                        collexions: collexionsEnabled,
                                        spotifySync: spotifyToPlexEnabled,
                                        metadataFill: metadataFillEnabled,
                                        scanner: scannerEnabled,
                                        mediaAutomation: mediaAutomationEnabled,
                                        posterSets: posterSetsEnabled,
                                        overlays: overlaysEnabled,
                                        editions: editionsEnabled,
                                        watchSync: watchSyncEnabled,
                                        achievements: achievementsEnabled,
                                        support: supportTicketsEnabled,
                                        chat: chatEnabled,
                                        maintenance: maintenanceExperimentalEnabled,
                                    }}
                                />
                            </section>
                            <section id={getSettingsSectionElementId('home-modules')} className="scroll-mt-24">
                                <HomeCustomModulesSettings
                                    homeCustomModules={homeCustomModules}
                                    onChange={setHomeCustomModules}
                                    dashboardLayout={dashboardLayout}
                                    onDashboardLayoutChange={updateDashboardLayout}
                                />
                            </section>
                            <section id={getSettingsSectionElementId('home-layout')} className="scroll-mt-24">
                                <HomeLayoutSettings layout={dashboardLayout} onChange={updateDashboardLayout} homeCustomModules={homeCustomModules} />
                            </section>
                        </div>
                    )}

                    {activeTab === 'achievements' && (
                        <div className="mb-8 animate-fade-in glass-card-sm p-5">
                            <AchievementsSettings
                                achievementsEnabled={achievementsEnabled}
                                setAchievementsEnabled={setAchievementsEnabled}
                                achievementsLeaderboardEnabled={achievementsLeaderboardEnabled}
                                setAchievementsLeaderboardEnabled={setAchievementsLeaderboardEnabled}
                                achievementsHomeWidgetEnabled={achievementsHomeWidgetEnabled}
                                setAchievementsHomeWidgetEnabled={setAchievementsHomeWidgetEnabled}
                                achievementsShowOnProfile={achievementsShowOnProfile}
                                setAchievementsShowOnProfile={setAchievementsShowOnProfile}
                                achievementsXpWeights={achievementsXpWeights}
                                setAchievementsXpWeights={setAchievementsXpWeights}
                                achievementsDisabledBadgeIds={achievementsDisabledBadgeIds}
                                setAchievementsDisabledBadgeIds={setAchievementsDisabledBadgeIds}
                                achievementsMinPercentComplete={achievementsMinPercentComplete}
                                setAchievementsMinPercentComplete={setAchievementsMinPercentComplete}
                                achievementsSeasons={achievementsSeasons}
                                setAchievementsSeasons={setAchievementsSeasons}
                            />
                        </div>
                    )}

                    {activeTab === 'analytics' && (
                        <div className="mb-8 animate-fade-in glass-card-sm p-5">
                            <AnalyticsSettings
                                mediaServerType={mediaServerType}
                                watchHistorySource={watchHistorySource}
                                setWatchHistorySource={setWatchHistorySource}
                                tautulliConfigured={tautulliConfigured || !!(tautulliUrl && tautulliApiKey)}
                                showUsernamesInAnalytics={showUsernamesInAnalytics}
                                setShowUsernamesInAnalytics={setShowUsernamesInAnalytics}
                                onOpenTautulliSettings={() => {
                                    const entry = resolveSettingsEntry('mediastack/tautulli');
                                    if (entry) navigateToSetting(entry);
                                }}
                            />
                        </div>
                    )}

                    {activeTab === 'broadcast' && (
                        <div className="mb-8 animate-fade-in space-y-10">
                            <div>
                                <h3 className="text-xl font-bold text-plex mb-2 border-b border-border pb-2">{t('settings.navigation.tabs.broadcast')}</h3>
                                <p className="text-sm text-muted mb-6">{t('settings.broadcast.pageHint')}</p>
                            </div>
                            <div className="space-y-3">
                                <h4 className="text-base font-bold text-text border-b border-border/60 pb-2">{t('settings.broadcast.automatedTitle')}</h4>
                                <EmailAutomatedTemplatesPanel
                                    emailTemplates={emailTemplates}
                                    setEmailTemplates={setEmailTemplates}
                                    defaults={emailTemplateDefaults}
                                    events={emailTemplateEvents}
                                    eventFields={emailTemplateFields}
                                    addToast={addToast}
                                />
                            </div>
                            <div className="space-y-3">
                                <h4 className="text-base font-bold text-text border-b border-border/60 pb-2">{t('settings.broadcast.composeTitle')}</h4>
                                <BroadcastSettingsTab users={users} selectedUserIds={[]} />
                            </div>
                        </div>
                    )}

                    {activeTab === 'status' && (
                        <div className="mb-8 animate-fade-in">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.statusMonitor.title')}</h3>
                            <StatusMonitorSettings
                                config={statusConfig}
                                onChange={setStatusDraft}
                                appConfirm={appConfirm}
                                fetchConfig={fetchStatusConfig}
                                addToast={addToast}
                            />
                        </div>
                    )}


                    {activeTab === 'contact' && (
                        <div className="mb-8">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Contact Details</h3>
                            <p className="text-sm text-muted mb-6">
                                These details are displayed in the "Need Help?" box on the User Dashboard. Users can click these buttons to contact you directly if they need to extend their access, report an issue, or request support.
                            </p>
                            <div id={getSettingsSectionElementId('whatsapp')} className="mb-4 scroll-mt-24">
                                <SettingFieldLabel
                                    htmlFor="contactWhatsApp"
                                    hint={<SettingHint>Enter your phone number including country code, without any '+', spaces, or dashes. If left blank, the WhatsApp button will be hidden.</SettingHint>}
                                >
                                    WhatsApp Number (Optional)
                                </SettingFieldLabel>
                                <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="contactWhatsApp" type="text" value={contactWhatsApp} onChange={(e) => setContactWhatsApp(e.target.value)} placeholder="e.g. 447303647923" />
                            </div>
                            <div id={getSettingsSectionElementId('email')} className="mb-4 scroll-mt-24">
                                <SettingFieldLabel
                                    htmlFor="contactEmail"
                                    hint={<SettingHint>The email address users should contact. If left blank, the Email button will be hidden.</SettingHint>}
                                >
                                    Email Address (Optional)
                                </SettingFieldLabel>
                                <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="e.g. admin@example.com" />
                            </div>
                        </div>
                    )}

                    {activeTab === 'branding' && (
                        <div className="mb-8 animate-fade-in">
                            <div className="mb-6 border-b border-border pb-4">
                                <h3 className="text-xl font-bold text-plex">Branding & UI</h3>
                                <p className="text-sm text-muted mt-1">Manage the portal logo, theme, splash background, and public-facing UI switches.</p>
                            </div>

                            <div className="space-y-6">
                                    <section id={getSettingsSectionElementId('public-base-url')} className="scroll-mt-24 rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Public Base URL</h4>
                                                <p className="text-xs text-muted mt-1">Used for invite emails, newsletter links, and shareable portal URLs.</p>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <SettingFieldLabel
                                                    htmlFor="publicDomain"
                                                    hint={(
                                                        <SettingHint>
                                                            Your HTTPS URL as users reach the portal (no trailing slash). Include a subpath when hosted under one, e.g. https://media.example.com/portal. Falls back to the PUBLIC_BASE_URL Docker/env variable when empty.
                                                        </SettingHint>
                                                    )}
                                                >
                                                    Public Base URL
                                                </SettingFieldLabel>
                                                <input
                                                    className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                                    id="publicDomain"
                                                    type="url"
                                                    value={publicDomain}
                                                    onChange={(e) => setPublicDomain(e.target.value)}
                                                    placeholder="https://portal.yourdomain.com"
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <section id={getSettingsSectionElementId('logo')} className="scroll-mt-24 rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Identity</h4>
                                                <p className="text-xs text-muted mt-1">Branding, theme, logo, and splash preview.</p>
                                            </div>
                                            <div className="flex-1 grid grid-cols-1 gap-4 min-w-0">
                                                {mediaServerType === 'jellyfin' && (
                                                    <div className="rounded-xl border border-plex/30 bg-plex/10 p-4">
                                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <span className="w-11 h-11 rounded-lg bg-background border border-plex/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                                    <img src={JELLYFIN_BRAND_LOGO_URL} alt="" className="w-8 h-8 object-contain" />
                                                                </span>
                                                                <div className="min-w-0">
                                                                    <h4 className="font-bold text-text">Jellyfin branding</h4>
                                                                    <p className="text-xs text-muted mt-1">Use the Jellyfin server icon and splash background across the portal.</p>
                                                                </div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={applyJellyfinBranding}
                                                                className="px-4 py-2 bg-plex hover:bg-plex-hover text-background rounded-md font-bold transition-colors whitespace-nowrap"
                                                            >
                                                                Use Jellyfin icon & splash
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                <div>
                                                    <SettingFieldLabel hint={<SettingHint>Wide logo shown in the sidebar navigation. Provide a URL or upload a file. Max 5MB.</SettingHint>}>
                                                        Sidebar Logo
                                                    </SettingFieldLabel>
                                                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_14rem] gap-3 mt-1">
                                                        <input
                                                            type="url"
                                                            className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all"
                                                            value={customLogoUrl}
                                                            onChange={e => {
                                                                clearLogoPreview();
                                                                setLogoFile(null);
                                                                setCustomLogoUrl(e.target.value);
                                                            }}
                                                            placeholder="https://example.com/logo.png"
                                                        />
                                                        <input
                                                            type="file"
                                                            accept="image/png,image/jpeg,image/webp"
                                                            className="w-full p-2 rounded-lg border border-border bg-background text-muted text-sm outline-none focus:border-plex transition-all file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-text hover:file:bg-white/20 file:cursor-pointer cursor-pointer"
                                                            onChange={e => {
                                                                const file = e.target.files?.[0] || null;
                                                                handleLogoFileChange(file);
                                                            }}
                                                        />
                                                    </div>
                                                    {logoFile && <p className="text-xs text-muted mt-2">{logoFile.name}</p>}
                                                </div>

                                                <div>
                                                    <SettingFieldLabel hint={<SettingHint>Shown on the login and invite screens. Use a separate asset here if your sidebar logo is wide or should not be cropped into a circle.</SettingHint>}>
                                                        Login Page Logo
                                                    </SettingFieldLabel>
                                                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_14rem] gap-3 mt-1">
                                                        <input
                                                            type="url"
                                                            className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all"
                                                            value={customLoginLogoUrl}
                                                            onChange={e => {
                                                                clearLoginLogoPreview();
                                                                setLoginLogoFile(null);
                                                                setCustomLoginLogoUrl(e.target.value);
                                                            }}
                                                            placeholder="https://example.com/login-logo.png"
                                                        />
                                                        <input
                                                            type="file"
                                                            accept="image/png,image/jpeg,image/webp"
                                                            className="w-full p-2 rounded-lg border border-border bg-background text-muted text-sm outline-none focus:border-plex transition-all file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-text hover:file:bg-white/20 file:cursor-pointer cursor-pointer"
                                                            onChange={e => {
                                                                const file = e.target.files?.[0] || null;
                                                                handleLoginLogoFileChange(file);
                                                            }}
                                                        />
                                                    </div>
                                                    {loginLogoFile && <p className="text-xs text-muted mt-2">{loginLogoFile.name}</p>}
                                                    <div className="mt-3 rounded-xl border border-border/60 bg-black/15 px-3 py-2">
                                                        <SettingsToggleRow
                                                            title="Circular login logo frame"
                                                            description="On by default. Turn off to show wide logos at full width without the round crop."
                                                            checked={loginLogoCircleFrame}
                                                            onChange={setLoginLogoCircleFrame}
                                                            border={false}
                                                        />
                                                    </div>
                                                </div>

                                                <div>
                                                    <SettingFieldLabel hint={<SettingHint>Square icon for browser tabs (PNG/JPEG/WebP, max 2MB). Use this when your logo is wide — the tab icon otherwise crops your logo into a circle.</SettingHint>}>
                                                        Browser Tab Favicon
                                                    </SettingFieldLabel>
                                                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_14rem] gap-3 mt-1">
                                                        <input
                                                            type="url"
                                                            className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all"
                                                            value={customFaviconUrl}
                                                            onChange={e => {
                                                                setFaviconFile(null);
                                                                setCustomFaviconUrl(e.target.value);
                                                            }}
                                                            placeholder="https://example.com/favicon.png"
                                                        />
                                                        <input
                                                            type="file"
                                                            accept="image/png,image/jpeg,image/webp"
                                                            className="w-full p-2 rounded-lg border border-border bg-background text-muted text-sm outline-none focus:border-plex transition-all file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-text hover:file:bg-white/20 file:cursor-pointer cursor-pointer"
                                                            onChange={e => {
                                                                const file = e.target.files?.[0] || null;
                                                                handleFaviconFileChange(file);
                                                            }}
                                                        />
                                                    </div>
                                                    {faviconFile && <p className="text-xs text-muted mt-2">{faviconFile.name}</p>}
                                                </div>

                                                <div>
                                                    <SettingFieldLabel hint={<SettingHint>Android renders push-notification status-bar icons as a monochrome silhouette (an alpha mask) — full colour is not possible for any app. Upload a simple white-on-transparent PNG (a bold monogram or mark works best) for a pixel-perfect badge. Leave empty to auto-generate the silhouette from your logo. The expanded notification always keeps the full-colour icon.</SettingHint>}>
                                                        Android Notification Badge
                                                    </SettingFieldLabel>
                                                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_14rem] gap-3 mt-1">
                                                        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
                                                            {customBadgeUrl && !badgeFile ? (
                                                                <>
                                                                    <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-800 shrink-0">
                                                                        <img
                                                                            src={portalUrl(`/api/public/pwa-badge?size=96&u=${encodeURIComponent(customBadgeUrl)}`)}
                                                                            alt="Status bar badge preview"
                                                                            className="w-6 h-6"
                                                                        />
                                                                    </span>
                                                                    <span className="text-sm text-muted flex-1">Custom badge uploaded</span>
                                                                    <button
                                                                        type="button"
                                                                        className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors"
                                                                        onClick={() => {
                                                                            setCustomBadgeUrl('');
                                                                            setBadgeFile(null);
                                                                        }}
                                                                    >
                                                                        Remove
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <span className="text-sm text-muted">
                                                                    {badgeFile ? 'Uploads when you save settings' : 'Auto-generated from your logo'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <input
                                                            type="file"
                                                            accept="image/png,image/jpeg,image/webp"
                                                            className="w-full p-2 rounded-lg border border-border bg-background text-muted text-sm outline-none focus:border-plex transition-all file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-text hover:file:bg-white/20 file:cursor-pointer cursor-pointer"
                                                            onChange={e => {
                                                                const file = e.target.files?.[0] || null;
                                                                handleBadgeFileChange(file);
                                                            }}
                                                        />
                                                    </div>
                                                    {badgeFile && <p className="text-xs text-muted mt-2">{badgeFile.name}</p>}
                                                </div>

                                                <div>
                                                    <SettingFieldLabel
                                                        hint={<SettingHint>Controls the installed app icon, browser tab favicon, Android notification status-bar silhouette, and newsletter header. Server logo uses your Plex/Jellyfin branding or uploaded custom logo. Android can only show a monochrome outline of that logo in the status bar; the expanded notification still uses the full-color icon.</SettingHint>}
                                                    >
                                                        PWA Home Screen Icon
                                                    </SettingFieldLabel>
                                                    <CustomSelect
                                                        value={pwaIconSource}
                                                        onChange={(value) => setPwaIconSource(value === 'application' ? 'application' : 'server')}
                                                        options={[
                                                            { label: 'Server logo (favicon)', value: 'server' },
                                                            { label: 'Application logo', value: 'application' },
                                                        ]}
                                                    />
                                                </div>

                                                <div id={getSettingsSectionElementId('theme')} className="scroll-mt-24 relative z-[50]">
                                                    <SettingFieldLabel
                                                        hint={<SettingHint>Users can still customize their local theme preference in the navigation menu.</SettingHint>}
                                                    >
                                                        Portal Theme
                                                    </SettingFieldLabel>
                                                    <CustomSelect
                                                        value={brandingTheme}
                                                        onChange={setBrandingTheme}
                                                        options={[
                                                            { label: 'Dynamic (Chameleon)', value: 'dynamic' },
                                                            { label: 'Plex Dark', value: 'plex' },
                                                            { label: 'Sleek Slate', value: 'slate' },
                                                            { label: 'Nordic Frost', value: 'nordic' },
                                                            { label: 'Jellyfin Purple', value: 'jellyfin' },
                                                            { label: 'Emby Green', value: 'emby' },
                                                            { label: 'Emerald Green', value: 'emerald' },
                                                            { label: 'Neon Midnight', value: 'midnight' },
                                                            { label: 'Crimson Red', value: 'crimson' },
                                                            { label: 'Deep Amethyst', value: 'amethyst' },
                                                            { label: 'Sunset Orange', value: 'sunset' },
                                                            { label: 'Ocean Teal', value: 'ocean' },
                                                            { label: 'Rose Pink', value: 'rose' },
                                                            { label: 'Royal Blue', value: 'royal' },
                                                            { label: 'Graphite', value: 'graphite' },
                                                            { label: 'Cyber Lime', value: 'cyberlime' },
                                                            { label: 'Aurora', value: 'aurora' },
                                                        ]}
                                                    />
                                                </div>

                                                <div>
                                                    <SettingFieldLabel
                                                        hint={<SettingHint>Choose where the server logo and server name appear in the desktop sidebar. Bottom keeps it near the profile area.</SettingHint>}
                                                    >
                                                        Server Logo Position
                                                    </SettingFieldLabel>
                                                    <CustomSelect
                                                        value={sidebarIdentityPosition}
                                                        onChange={(value) => setSidebarIdentityPosition(value === 'top' ? 'top' : 'bottom')}
                                                        options={[
                                                            { label: 'Bottom', value: 'bottom' },
                                                            { label: 'Top', value: 'top' },
                                                        ]}
                                                    />
                                                </div>

                                                <div id={getSettingsSectionElementId('slideshow')} className="scroll-mt-24">
                                                    <SettingFieldLabel hint={<SettingHint>Shown on login and portal backgrounds when the TMDB slideshow is disabled.</SettingHint>}>
                                                        Static Splash Background Image
                                                    </SettingFieldLabel>
                                                    <div className={`grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_14rem] gap-3 mt-1 transition-opacity ${useTrendingSlideshow ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                                                        <input
                                                            type="url"
                                                            className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all"
                                                            value={backgroundImageUrl}
                                                            onChange={e => {
                                                                clearBackgroundPreview();
                                                                setBackgroundFile(null);
                                                                setBackgroundImageUrl(e.target.value);
                                                            }}
                                                            placeholder="https://example.com/background.png"
                                                        />
                                                        <input
                                                            type="file"
                                                            accept="image/png,image/jpeg,image/webp"
                                                            className="w-full p-2 rounded-lg border border-border bg-background text-muted text-sm outline-none focus:border-plex transition-all file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-text hover:file:bg-white/20 file:cursor-pointer cursor-pointer"
                                                            onChange={e => {
                                                                const file = e.target.files?.[0] || null;
                                                                handleBackgroundFileChange(file);
                                                            }}
                                                        />
                                                    </div>
                                                    <p className="text-xs text-muted mt-2">{backgroundFile ? backgroundFile.name : 'PNG, JPEG, or WebP, max 10MB'}</p>
                                                </div>

                                                <div className="rounded-xl border border-border overflow-hidden bg-background/70">
                                                    <div className="px-4 py-3 border-b border-border/70 bg-black/20">
                                                        <h4 className="font-bold text-text">Portal splash preview</h4>
                                                    </div>
                                                    <div
                                                        key={splashPreviewKey}
                                                        className="relative min-h-[240px] flex items-center justify-center p-6 bg-card"
                                                        style={splashPreviewBackgroundSrc ? {
                                                            backgroundImage: `linear-gradient(rgba(10,15,20,0.42), rgba(10,15,20,0.56)), url("${splashPreviewBackgroundSrc.replace(/"/g, '%22')}")`,
                                                            backgroundRepeat: 'no-repeat',
                                                            backgroundPosition: 'center',
                                                            backgroundSize: 'cover',
                                                        } : undefined}
                                                    >
                                                        <div className="text-center w-full">
                                                            {splashPreviewLogoSrc ? (
                                                                <LoginBrandMark
                                                                    src={splashPreviewLogoSrc}
                                                                    circleFrame={loginLogoCircleFrame}
                                                                    className="mx-auto mb-4"
                                                                />
                                                            ) : (
                                                                <div className="w-24 h-24 rounded-full border-2 border-plex/50 bg-background/80 mx-auto mb-4 p-3 shadow-[0_0_36px_rgba(0,164,220,0.28)]">
                                                                    <span className="w-full h-full flex items-center justify-center text-3xl font-black text-plex">S</span>
                                                                </div>
                                                            )}
                                                            <p className="text-sm font-bold text-text">Portal splash preview</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Motion & Loading</h4>
                                                <p className="text-xs text-muted mt-1">Animation and loading states.</p>
                                            </div>
                                            <div className="flex-1 min-w-0 divide-y divide-border/40">
                                                <SettingsToggleRow
                                                    title="Scroll Reveal Animations"
                                                    hint={<SettingHint>Smoothly slide elements into place as you scroll down the dashboard.</SettingHint>}
                                                    checked={useScrollRevealAnimations}
                                                    onChange={setUseScrollRevealAnimations}
                                                    border={false}
                                                />
                                                <SettingsToggleRow
                                                    title="Cinematic Loading Sequences"
                                                    hint={<SettingHint>Replaces the standard loading spinner with an SVG line-drawing animation.</SettingHint>}
                                                    checked={useCinematicLoading}
                                                    onChange={setUseCinematicLoading}
                                                    border={false}
                                                />
                                                <SettingsToggleRow
                                                    title="Branded Skeleton Loading"
                                                    hint={<SettingHint>Use a branded shimmer effect for skeleton loaders.</SettingHint>}
                                                    checked={useBrandedSkeleton}
                                                    onChange={setUseBrandedSkeleton}
                                                    border={false}
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Slideshow</h4>
                                                <p className="text-xs text-muted mt-1">TMDB trending background behavior.</p>
                                            </div>
                                            <div className="flex-1 min-w-0 divide-y divide-border/40">
                                                <SettingsToggleRow
                                                    title="TMDB Trending Slideshow"
                                                    hint={<SettingHint>Requires a TMDB API key in Integrations.</SettingHint>}
                                                    checked={useTrendingSlideshow}
                                                    onChange={setUseTrendingSlideshow}
                                                    border={false}
                                                >
                                                    <div className={`transition-all overflow-hidden ${useTrendingSlideshow ? 'max-h-[120px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                                                        <SettingFieldLabel>Slideshow Interval</SettingFieldLabel>
                                                        <CustomSelect
                                                            value={String(trendingSlideshowInterval)}
                                                            onChange={(val) => setTrendingSlideshowInterval(parseInt(val, 10))}
                                                            options={[
                                                                { label: '10 Seconds', value: '10' },
                                                                { label: '20 Seconds', value: '20' },
                                                                { label: '30 Seconds', value: '30' },
                                                                { label: '40 Seconds', value: '40' },
                                                                { label: '50 Seconds', value: '50' },
                                                                { label: '60 Seconds', value: '60' },
                                                            ]}
                                                        />
                                                    </div>
                                                </SettingsToggleRow>
                                                <SettingsToggleRow
                                                    title="Slideshow on Login Page"
                                                    hint={<SettingHint>Display the TMDB trending slideshow background on the login and landing pages.</SettingHint>}
                                                    checked={useTrendingSlideshowOnLogin}
                                                    onChange={setUseTrendingSlideshowOnLogin}
                                                    border={false}
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Display Preferences</h4>
                                                <p className="text-xs text-muted mt-1">Shared display defaults.</p>
                                            </div>
                                            <div className="flex-1 min-w-0 divide-y divide-border/40">
                                                <SettingsToggleRow
                                                    title="Use 24-Hour Clock across the Portal"
                                                    description="Show times as 13:00 instead of 1:00 PM in watch history, now playing, and dashboards."
                                                    checked={use24HourClock}
                                                    onChange={setUse24HourClock}
                                                    border={false}
                                                />
                                                <div id={getSettingsSectionElementId('poster-badges')} className="scroll-mt-24">
                                                    <SettingsToggleRow
                                                        title="Poster Quality Badges"
                                                        description="Show quality badges on recently added and discover posters (4K, HDR, codec, Atmos)."
                                                        hint={<SettingHint>Applies to Home and Discover poster cards for all users.</SettingHint>}
                                                        checked={showPosterQualityBadges}
                                                        onChange={setShowPosterQualityBadges}
                                                        border={false}
                                                    />
                                                </div>
                                                <div id={getSettingsSectionElementId('dashboard-watching-badge')} className="scroll-mt-24">
                                                    <SettingsToggleRow
                                                        title="Dashboard Watching Badge"
                                                        hint={(
                                                            <SettingHint>
                                                                Show a live count of people currently watching next to Dashboard in the sidebar.
                                                            </SettingHint>
                                                        )}
                                                        checked={showDashboardWatchingBadge}
                                                        onChange={setShowDashboardWatchingBadge}
                                                        border={false}
                                                    >
                                                        <div className={`transition-all overflow-hidden ${showDashboardWatchingBadge ? 'max-h-[120px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                                                            <label className="text-sm font-medium text-muted">Poll Interval</label>
                                                            <CustomSelect
                                                                className="w-full mt-1"
                                                                value={String(dashboardWatchingBadgePollSeconds)}
                                                                onChange={(value) => setDashboardWatchingBadgePollSeconds(Math.min(15, Math.max(1, parseInt(value, 10) || 15)))}
                                                                options={Array.from({ length: 15 }, (_, i) => {
                                                                    const seconds = i + 1;
                                                                    return {
                                                                        value: String(seconds),
                                                                        label: `${seconds} ${seconds === 1 ? 'Second' : 'Seconds'}`,
                                                                    };
                                                                })}
                                                            />
                                                        </div>
                                                    </SettingsToggleRow>
                                                </div>
                                                <SettingsToggleRow
                                                    title="Enable Home second-screen companion panel"
                                                    description="Global admin switch for the Home hero companion. When off, the now-playing strip remains but companion details are hidden for everyone."
                                                    hint={<SettingHint>Settings {'>'} Portal UI controls this experience for all users.</SettingHint>}
                                                    checked={homeNowPlayingCompanionEnabled}
                                                    onChange={setHomeNowPlayingCompanionEnabled}
                                                    border={false}
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Access</h4>
                                                <p className="text-xs text-muted mt-1">Public access and pre-login visibility.</p>
                                            </div>
                                            <div className="flex-1 min-w-0 divide-y divide-border/40">
                                                <SettingsToggleRow title="Allow Temporary Access (Public Sign-ups)" checked={allowTemporaryAccess} onChange={setAllowTemporaryAccess} border={false} />
                                                <SettingsToggleRow
                                                    title="Show Status Monitor Before Login"
                                                    hint={<SettingHint>Allow visitors without a session to open the status page and see monitored service health.</SettingHint>}
                                                    checked={showPublicStatusMonitor}
                                                    onChange={setShowPublicStatusMonitor}
                                                    border={false}
                                                />
                                                <SettingsToggleRow
                                                    title="Show Library Stats Before Login"
                                                    hint={<SettingHint>Display public library counts on login and invite pages before users sign in.</SettingHint>}
                                                    checked={showPublicLibraryStats}
                                                    onChange={setShowPublicLibraryStats}
                                                    border={false}
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <section id={getSettingsSectionElementId('community-chat')} className="scroll-mt-24 rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Community chat</h4>
                                                <p className="text-xs text-muted mt-1">Discord-style text channels for members.</p>
                                            </div>
                                            <div className="flex-1 min-w-0 divide-y divide-border/40">
                                                <SettingsToggleRow
                                                    title="Community chat"
                                                    hint={<SettingHint>Let members talk in Discord-style text channels. Admins can create rooms; everyone logged in can chat. Messages refresh automatically while the page is open.</SettingHint>}
                                                    checked={chatEnabled}
                                                    onChange={setChatEnabled}
                                                    border={false}
                                                />
                                                {chatEnabled ? (
                                                    <>
                                                        <SettingsToggleRow
                                                            title="Chat @mention notifications"
                                                            hint={<SettingHint>Send in-app bell notifications when someone @mentions a member in live chat. Members can turn this off in Preferences.</SettingHint>}
                                                            checked={chatMentionNotifyInApp}
                                                            onChange={setChatMentionNotifyInApp}
                                                            border={false}
                                                        />
                                                        <div className="pt-4">
                                                            <button
                                                                type="button"
                                                                className="px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                                                onClick={() => window.location.assign(portalUrl('/chat'))}
                                                            >
                                                                Open live chat
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>
                                    </section>

                                    <section id={getSettingsSectionElementId('announcement')} className="scroll-mt-24 rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Announcement</h4>
                                                <p className="text-xs text-muted mt-1">Portal banner and email blast.</p>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <SettingFieldLabel hint={<SettingHint>If provided, this announcement will be prominently displayed to all users.</SettingHint>}>
                                                    Portal Announcement Banner
                                                </SettingFieldLabel>
                                                <textarea className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all mt-1" value={announcement} onChange={e => setAnnouncement(e.target.value)} placeholder="E.g. Server maintenance scheduled for Friday..." rows={3}></textarea>
                                                <div className="flex justify-end mt-3">
                                                    <button
                                                        onClick={handlePushAnnouncement}
                                                        disabled={isPushingAnnouncement || !announcement}
                                                        className="bg-plex hover:bg-plex-hover disabled:opacity-50 text-background font-bold py-2 px-4 rounded-lg transition-colors text-sm whitespace-nowrap"
                                                    >
                                                        {isPushingAnnouncement ? 'Pushing...' : 'Save & Send Email Blast'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section id={getSettingsSectionElementId('expired-portal')} className="scroll-mt-24 rounded-xl border border-border/70 p-4">
                                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                            <div className="lg:w-52 shrink-0">
                                                <h4 className="font-bold text-text">Expired access</h4>
                                                <p className="text-xs text-muted mt-1">Message shown when a member logs in after their subscription expired (#187).</p>
                                            </div>
                                            <div className="flex-1 min-w-0 space-y-4">
                                                <div>
                                                    <SettingFieldLabel hint={<SettingHint>Optional heading on the restricted expired-user page. Leave blank for “Access expired”.</SettingHint>}>
                                                        Expired portal title
                                                    </SettingFieldLabel>
                                                    <input
                                                        className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all mt-1"
                                                        value={expiredPortalTitle}
                                                        onChange={(e) => setExpiredPortalTitle(e.target.value)}
                                                        placeholder="Access expired"
                                                    />
                                                </div>
                                                <div>
                                                    <SettingFieldLabel hint={<SettingHint>Optional custom instructions (renewal, Discord, contact). Contact email / WhatsApp from Settings are also shown as buttons.</SettingHint>}>
                                                        Expired portal message
                                                    </SettingFieldLabel>
                                                    <textarea
                                                        className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all mt-1"
                                                        value={expiredPortalMessage}
                                                        onChange={(e) => setExpiredPortalMessage(e.target.value)}
                                                        placeholder="Your access has expired. Open Support to request a renewal…"
                                                        rows={4}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                            </div>

                        </div>
                    )}

                    {activeTab === 'invites' && (
                        <InvitesSettings
                            addToast={addToast}
                            publicDomain={publicDomain}
                            referralEnabled={referralEnabled}
                            setReferralEnabled={setReferralEnabled}
                            referralTrialDays={referralTrialDays}
                            setReferralTrialDays={setReferralTrialDays}
                            referralRewardDays={referralRewardDays}
                            setReferralRewardDays={setReferralRewardDays}
                        />
                    )}

                    {activeTab === 'tasks' && (
                        <div className="mb-8 animate-fade-in">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Background Tasks</h3>
                            <div className="flex flex-col gap-4">
                                {tasks.map(task => (
                                    <div key={task.id} className="py-4 border-b border-border/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                <h4 className="font-bold text-lg">{task.name}</h4>
                                                <TaskStatusPill task={task} />
                                            </div>
                                            <p className="text-sm text-muted mb-2">{task.description}</p>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                                                <span><strong className="text-text">Last Run:</strong> {task.lastRun ? new Date(task.lastRun).toLocaleString() : 'Never'}</span>
                                                <span><strong className="text-text">Next Run:</strong> {task.nextRun ? new Date(task.nextRun).toLocaleString() : 'Not Scheduled'}</span>
                                                {task.lastDurationMs !== null && <span><strong className="text-text">Duration:</strong> {Math.round(task.lastDurationMs / 1000)}s</span>}
                                                {task.lastDetail && !task.lastError && <span><strong className="text-text">Result:</strong> {task.lastDetail}</span>}
                                                {task.lastError && <span className="bg-red-500/20 text-red-300 px-2 py-1 rounded"><strong>Error:</strong> {task.lastError}</span>}
                                                {task.lastWarning && !task.lastError && <span className="bg-amber-500/20 text-amber-200 px-2 py-1 rounded"><strong>Warning:</strong> {task.lastWarning}</span>}
                                            </div>
                                        </div>
                                        <button
                                            className={`px-4 py-2 rounded-md font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
                                                task.running
                                                    ? 'bg-slate-800 text-muted border border-border cursor-not-allowed opacity-60'
                                                    : 'bg-plex text-background hover:bg-plex-hover'
                                            }`}
                                            disabled={task.running}
                                            onClick={() => handleRunTask(task.id)}
                                        >
                                            {task.running ? (
                                                <>
                                                    <svg className="animate-spin h-4 w-4 text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                    <span>Running...</span>
                                                </>
                                            ) : (
                                                'Run Now'
                                            )}
                                        </button>
                                    </div>
                                ))}
                                <div className="py-4 border-b border-border/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                            <h4 className="font-bold text-lg">Media Automation</h4>
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                                                mediaAutomationEnabled
                                                    ? 'bg-green-500/10 text-green-300 border-green-500/20'
                                                    : 'bg-slate-500/10 text-muted border-border'
                                            }`}>
                                                {mediaAutomationEnabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                            {mediaAutomation.fallback?.outputMode === 'dry-run' && mediaAutomationEnabled && (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-200 border border-amber-500/20">
                                                    Global dry-run
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted mb-2">
                                            Native FFmpeg worker with its own queue, library scan/watch, and ARR webhooks - managed from the Media Automation page (not a classic scheduled task).
                                        </p>
                                        <p className="text-xs text-muted">
                                            Configure scan/watch under Settings → Media Automation. Open the dashboard for Scan now, queue, and job commands.
                                        </p>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                                        <button
                                            type="button"
                                            className="px-4 py-2 rounded-md font-bold transition-all bg-white/5 text-text border border-border hover:border-plex/50"
                                            onClick={() => setActiveTab('media-automation')}
                                        >
                                            Settings
                                        </button>
                                        {mediaAutomationEnabled && (
                                            <button
                                                type="button"
                                                className="px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                                onClick={() => {
                                                    window.location.assign(portalUrl('/media-automation'));
                                                }}
                                            >
                                                Open dashboard
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'upgrader' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Library Upgrader</h3>
                            <section id={getSettingsSectionElementId('upgrader')} className="space-y-3 scroll-mt-24">
                                <SettingsToggleRow
                                    title="Enable Library Upgrader"
                                    hint={<SettingHint>Standalone admin view to find non-HEVC titles with Plex or Jellyfin and Sonarr/Radarr deep links. OFF by default.</SettingHint>}
                                    checked={upgraderEnabled}
                                    onChange={setUpgraderEnabled}
                                    border={false}
                                />
                                <p className={`text-xs mt-2 font-semibold ${upgraderEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {upgraderEnabled ? 'ON' : 'OFF'}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Default filter preset</label>
                                        <CustomSelect
                                            value={upgraderDefaultPreset}
                                            onChange={setUpgraderDefaultPreset}
                                            options={UPGRADER_PRESET_SELECT_OPTIONS}
                                        />
                                    </div>
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Large non-HEVC minimum size (GB)</label>
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.5}
                                            className="w-full p-2 rounded border border-border bg-background text-text"
                                            value={upgraderMinSizeGB}
                                            onChange={(e) => setUpgraderMinSizeGB(Math.max(0, Number(e.target.value) || 0))}
                                        />
                                    </div>
                                </div>
                                <SettingsToggleRow
                                    title="Enable ARR automation"
                                    hint={<SettingHint>Allow Upgrader to switch Sonarr/Radarr quality profiles and trigger searches. Opt-in per action with dry-run preview.</SettingHint>}
                                    checked={upgraderAutomationEnabled}
                                    onChange={setUpgraderAutomationEnabled}
                                    border={false}
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Default sort</label>
                                        <CustomSelect
                                            value={upgraderDefaultSort}
                                            onChange={setUpgraderDefaultSort}
                                            options={[
                                                { value: 'sizeGB', label: 'Largest first' },
                                                { value: 'watchCount', label: 'Most watched' },
                                                { value: 'addedAt', label: 'Recently added' },
                                                { value: 'daysSinceAdded', label: 'Oldest added' },
                                                { value: 'staleAdded', label: 'Stale (old + unwatched)' },
                                                { value: 'title', label: 'Title A–Z' },
                                            ]}
                                        />
                                    </div>
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Drawer display mode</label>
                                        <CustomSelect
                                            value={upgraderDrawerPosition}
                                            onChange={setUpgraderDrawerPosition}
                                            options={[
                                                { value: 'sidebar', label: 'Right sidebar (default)' },
                                                { value: 'modal', label: 'Center modal' },
                                            ]}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Max upgrades per hour</label>
                                        <input
                                            type="number"
                                            min={1}
                                            className="w-full p-2 rounded border border-border bg-background text-text"
                                            value={upgraderMaxActionsPerHour}
                                            onChange={(e) => setUpgraderMaxActionsPerHour(Math.max(1, Number(e.target.value) || 25))}
                                        />
                                    </div>
                                </div>
                                {upgraderAutomationEnabled && (
                                    <div className="mt-4 space-y-3">
                                        <h5 className="font-semibold text-sm text-text">HEVC quality profile per ARR instance</h5>
                                        {loadingUpgraderProfiles ? (
                                            <p className="text-xs text-muted">Loading quality profiles…</p>
                                        ) : upgraderProfileInstances.length === 0 ? (
                                            <p className="text-xs text-yellow-200">Configure ready Sonarr/Radarr instances first.</p>
                                        ) : upgraderProfileInstances.map((instance) => (
                                            <div key={instance.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3 items-end border border-border/40 rounded-lg p-3">
                                                <div>
                                                    <p className="text-sm font-semibold text-text">{instance.name}</p>
                                                    <p className="text-[11px] text-muted capitalize">{instance.type}</p>
                                                </div>
                                                <CustomSelect
                                                    value={String(upgraderProfileMap[instance.id]?.hevcProfileId || '')}
                                                    onChange={(value) => {
                                                        const hevcProfileId = Number(value);
                                                        setUpgraderProfileMap((prev) => {
                                                            const next = { ...prev };
                                                            if (hevcProfileId > 0) next[instance.id] = { hevcProfileId };
                                                            else delete next[instance.id];
                                                            return next;
                                                        });
                                                    }}
                                                    options={[
                                                        { value: '', label: 'Select HEVC profile…' },
                                                        ...(instance.profiles || []).map((profile: any) => ({
                                                            value: String(profile.id),
                                                            label: profile.name,
                                                        })),
                                                    ]}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="text-[11px] text-muted mt-1">Requires Plex or Jellyfin. Sonarr/Radarr recommended for deep links and automation.</p>
                                <p className="text-[11px] text-muted mt-1">After changing these options, click Save Settings.</p>
                            </section>
                        </div>
                    )}
                    {activeTab === 'collexions' && mediaServerType === 'plex' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Collexions</h3>
                            <section id={getSettingsSectionElementId('collexions')} className="space-y-3 scroll-mt-24">
                                <p className="text-xs text-muted -mt-2 mb-1">
                                    Plex-only integration — hidden when Media Server Type is Jellyfin or Emby.
                                </p>
                                <SettingsToggleRow
                                    title="Enable Collexions"
                                    hint={<SettingHint>
                                        {initialSettings.collexionsBundled
                                            ? 'Admin-only Plex collections manager. Runs inside the portal image — just enable and save. OFF by default.'
                                            : 'Admin-only Plex collections manager. This build has no bundled worker; set an internal URL to an external Collexions sidecar. OFF by default.'}
                                    </SettingHint>}
                                    checked={collexionsEnabled}
                                    onChange={(next) => {
                                        setCollexionsEnabled(next);
                                        if (!next) setCollexionsAutostart(false);
                                    }}
                                    border={false}
                                />
                                <SettingsToggleRow
                                    title="Auto-start pinning service"
                                    hint={<SettingHint>
                                        When ON, pinning starts on every portal boot. A portal update also resumes a loop that was already running, instead of leaving it Stopped. Requires Collexions enabled and Plex configured. OFF by default.
                                    </SettingHint>}
                                    checked={collexionsAutostart}
                                    onChange={setCollexionsAutostart}
                                    disabled={!collexionsEnabled}
                                    border={false}
                                />
                                <p className={`text-xs mt-2 font-semibold ${collexionsEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {collexionsEnabled
                                        ? (initialSettings.collexionsBundled
                                            ? (initialSettings.collexionsEmbedded?.running ? 'ON (worker running)' : 'ON (worker starts after Save)')
                                            : (collexionsInternalUrl.trim() ? 'ON (external URL set)' : 'Enabled (set internal URL)'))
                                        : 'OFF'}
                                    {collexionsEnabled && collexionsAutostart ? ' · auto-start pinning ON' : ''}
                                </p>
                                {!initialSettings.collexionsBundled && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                        <div>
                                            <label className="font-semibold text-sm block mb-2">Internal URL</label>
                                            <input
                                                type="text"
                                                className="w-full p-2 rounded border border-border bg-background text-text"
                                                placeholder="http://collexions:5000"
                                                value={collexionsInternalUrl}
                                                onChange={(e) => setCollexionsInternalUrl(e.target.value)}
                                                disabled={!collexionsEnabled}
                                            />
                                            <p className="text-[11px] text-muted mt-1">Docker service hostname preferred (e.g. http://collexions:5000).</p>
                                        </div>
                                        <div>
                                            <label className="font-semibold text-sm block mb-2">Service key</label>
                                            <input
                                                type="password"
                                                className="w-full p-2 rounded border border-border bg-background text-text"
                                                placeholder={collexionsServiceKey === '********' ? '•••••••• (unchanged)' : 'Shared with sidecar COLLEXIONS_SERVICE_KEY'}
                                                value={collexionsServiceKey === '********' ? '' : collexionsServiceKey}
                                                onChange={(e) => setCollexionsServiceKey(e.target.value)}
                                                disabled={!collexionsEnabled}
                                                autoComplete="new-password"
                                            />
                                            <p className="text-[11px] text-muted mt-1">Must match the sidecar env. Leave blank to keep the saved key.</p>
                                        </div>
                                    </div>
                                )}
                                {initialSettings.collexionsBundled && (
                                    <p className="text-[11px] text-muted mt-2">
                                        Worker data lives under the portal config volume (`config/collexions/`). Import your standalone `config.json` from Collexions → Config after enabling.
                                    </p>
                                )}
                                <p className="text-[11px] text-muted mt-2">After changing these options, click Save Settings. Admins use portal login — no Collexions password.</p>
                            </section>
                        </div>
                    )}
                    {activeTab === 'spotify-sync' && mediaServerType === 'plex' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <IntegrationHeading
                                app="lidarr"
                                title="Spotify Sync"
                                subtitle={initialSettings.spotifyToPlexBundled
                                    ? 'Sync Spotify playlists to Plex — spotify-to-plex is bundled in the portal image (no separate Compose service required).'
                                    : 'Sync Spotify playlists to Plex via the spotify-to-plex Compose service — credentials are written to config/spotify-to-plex.env, not the host .env'}
                            />
                            <section id={getSettingsSectionElementId('spotify-sync')} className="space-y-3 scroll-mt-24">
                                <SettingsToggleRow
                                    title="Enable Spotify Sync"
                                    hint={<SettingHint>
                                        {initialSettings.spotifyToPlexBundled
                                            ? 'Starts the bundled worker inside the portal image and shows Spotify Sync in admin nav. OFF by default.'
                                            : 'Shows the Spotify Sync admin nav and uses the bundled or external worker APIs. OFF by default.'}
                                    </SettingHint>}
                                    checked={spotifyToPlexEnabled}
                                    onChange={(next) => {
                                        setSpotifyToPlexEnabled(next);
                                        if (!next) setSpotifyToPlexHomeWidgetEnabled(false);
                                    }}
                                    border={false}
                                />
                                <p className={`text-xs mt-2 font-semibold ${spotifyToPlexEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {spotifyToPlexEnabled
                                        ? (spotifyToPlexInternalUrl.trim() ? 'ON' : 'Enabled — set internal URL')
                                        : 'OFF'}
                                    {spotifySyncHealth?.ok ? ' · container reachable' : ''}
                                    {initialSettings.spotifyToPlexBundled ? ' · bundled in portal image' : ''}
                                    {spotifyToPlexEnabled && initialSettings.spotifyToPlexCredentialsReady ? ' · credentials saved' : ''}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Spotify API Client ID</label>
                                        <input
                                            type="text"
                                            className="w-full p-2 rounded border border-border bg-background text-text"
                                            placeholder="From Spotify Developer Dashboard"
                                            value={spotifyToPlexClientId}
                                            onChange={(e) => setSpotifyToPlexClientId(e.target.value)}
                                            disabled={!spotifyToPlexEnabled}
                                        />
                                    </div>
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Spotify API Client Secret</label>
                                        <input
                                            type="password"
                                            className="w-full p-2 rounded border border-border bg-background text-text"
                                            placeholder={spotifyToPlexClientSecret === '********' ? '•••••••• (unchanged)' : 'Client secret'}
                                            value={spotifyToPlexClientSecret === '********' ? '' : spotifyToPlexClientSecret}
                                            onChange={(e) => setSpotifyToPlexClientSecret(e.target.value)}
                                            disabled={!spotifyToPlexEnabled}
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Encryption key</label>
                                        <input
                                            type="password"
                                            className="w-full p-2 rounded border border-border bg-background text-text"
                                            placeholder={spotifyToPlexEncryptionKey === '********' ? '•••••••• (unchanged)' : '64-char hex (openssl rand -hex 32)'}
                                            value={spotifyToPlexEncryptionKey === '********' ? '' : spotifyToPlexEncryptionKey}
                                            onChange={(e) => setSpotifyToPlexEncryptionKey(e.target.value)}
                                            disabled={!spotifyToPlexEnabled}
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    {!initialSettings.spotifyToPlexBundled && (
                                        <div>
                                            <label className="font-semibold text-sm block mb-2">Internal URL</label>
                                            <input
                                                type="text"
                                                className="w-full p-2 rounded border border-border bg-background text-text"
                                                placeholder="http://spotify-to-plex:9030"
                                                value={spotifyToPlexInternalUrl}
                                                onChange={(e) => setSpotifyToPlexInternalUrl(e.target.value)}
                                                disabled={!spotifyToPlexEnabled}
                                            />
                                            <p className="text-[11px] text-muted mt-1">Docker Compose service name on your private network.</p>
                                        </div>
                                    )}
                                    <div className="md:col-span-2">
                                        <label className="font-semibold text-sm block mb-2">Spotify redirect URI (register in Spotify Developer)</label>
                                        <input
                                            type="text"
                                            readOnly
                                            className="appearance-none text-[16px] leading-5 w-full p-2 rounded border border-border bg-background/60 text-text text-[16px]"
                                            value={String(initialSettings.spotifyToPlexCallbackUrl || '')}
                                        />
                                        <p className="text-[11px] text-muted mt-1">Requires Public Base URL in Settings → Portal UI. Saved to <code className="text-xs">config/spotify-to-plex.env</code> when you click Save Settings.</p>
                                    </div>
                                </div>
                                {spotifyToPlexEnabled && spotifySyncHealth?.issues?.length ? (
                                    <p className="text-xs text-yellow-300 mt-2">{spotifySyncHealth.issues.join(' · ')}</p>
                                ) : null}
                                {initialSettings.spotifyToPlexBundled ? (
                                    <p className="text-[11px] text-muted mt-2">
                                        Spotify-to-plex runs inside the portal container at <code className="text-xs">127.0.0.1:9030</code>.
                                        Data lives under <code className="text-xs">config/spotify-to-plex/</code> on the portal config volume.
                                        Credential and schedule changes apply when you save (bundled processes restart automatically).
                                    </p>
                                ) : (
                                    <p className="text-[11px] text-muted mt-2">
                                        After credential or schedule changes, restart the <code className="text-xs">spotify-to-plex</code> container so it reloads the generated <code className="text-xs">env_file</code> and supervisor config.
                                        Choose one schedule mode below — portal mode stops the container&apos;s built-in <code className="text-xs">sync-scheduler</code> process.
                                    </p>
                                )}
                                <div className="mt-2">
                                    <label className="font-semibold text-sm block mb-2">Sync schedule</label>
                                    <select
                                        className="w-full p-2 rounded border border-border bg-background text-text disabled:opacity-50"
                                        value={spotifyToPlexScheduleMode}
                                        onChange={(e) => setSpotifyToPlexScheduleMode(
                                            e.target.value === 'portal' ? 'portal' : 'sidecar',
                                        )}
                                        disabled={!spotifyToPlexEnabled}
                                    >
                                        <option value="sidecar">{initialSettings.spotifyToPlexBundled ? 'Built-in cron (daily ~02:00 UTC)' : 'Container cron (daily ~02:00 UTC)'}</option>
                                        <option value="portal">{initialSettings.spotifyToPlexBundled ? 'Portal Background Tasks interval (disables built-in sync-scheduler)' : 'Portal Background Tasks interval (disables container sync-scheduler)'}</option>
                                    </select>
                                    <p className="text-[11px] text-muted mt-1">
                                        Portal interval appears under Background Tasks → Spotify Sync.
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Portal sync interval (hours)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={168}
                                            className="w-full p-2 rounded border border-border bg-background text-text disabled:opacity-50"
                                            value={spotifyToPlexScheduledSyncIntervalHours}
                                            onChange={(e) => setSpotifyToPlexScheduledSyncIntervalHours(
                                                Math.min(168, Math.max(1, Number(e.target.value) || 24)),
                                            )}
                                            disabled={!spotifyToPlexEnabled || spotifyToPlexScheduleMode !== 'portal'}
                                        />
                                        <p className="text-[11px] text-muted mt-1">1–168 hours. Checked every 30 minutes.</p>
                                    </div>
                                    {initialSettings.spotifyToPlexScheduledSyncLastRunAt ? (
                                        <div>
                                            <label className="font-semibold text-sm block mb-2">Last portal-managed sync</label>
                                            <p className="text-sm text-muted">{String(initialSettings.spotifyToPlexScheduledSyncLastRunAt)}</p>
                                        </div>
                                    ) : null}
                                </div>
                                <SettingsToggleRow
                                    title="Home dashboard widget"
                                    hint={<SettingHint>Shows last sync status on Home for admins. Reorder under Home → Edit layout.</SettingHint>}
                                    checked={spotifyToPlexHomeWidgetEnabled}
                                    onChange={setSpotifyToPlexHomeWidgetEnabled}
                                    disabled={!spotifyToPlexEnabled}
                                    border={false}
                                />
                                <p className="text-[11px] text-muted mt-2">
                                    Plex URL and token from Settings → Plex (Media Player) are pushed into the worker automatically on save and when you open Spotify Sync.
                                </p>
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <button
                                        type="button"
                                        className="px-3 py-2 rounded-md text-xs font-bold border border-border hover:border-plex hover:text-plex disabled:opacity-50"
                                        disabled={!spotifyToPlexEnabled || spotifyPortalImporting}
                                        onClick={async () => {
                                            setSpotifyPortalImporting(true);
                                            setSpotifyPortalImportMessage('');
                                            try {
                                                const data = await apiFetch('/api/spotify-to-plex/apply-portal-defaults', { method: 'POST' });
                                                setSpotifyPortalImportMessage(data?.message || 'Portal defaults applied to the spotify-to-plex container.');
                                                pushToast(data?.message || 'Applied portal defaults', 'success');
                                            } catch (e: any) {
                                                setSpotifyPortalImportMessage(e?.message || 'Import failed');
                                                pushToast(e?.message || 'Import failed', 'error');
                                            } finally {
                                                setSpotifyPortalImporting(false);
                                            }
                                        }}
                                    >
                                        {spotifyPortalImporting ? 'Applying…' : 'Apply Plex/Lidarr from portal'}
                                    </button>
                                    <button
                                        type="button"
                                        className="px-3 py-2 rounded-md text-xs font-bold border border-border hover:border-plex hover:text-plex disabled:opacity-50"
                                        disabled={!spotifyToPlexEnabled || spotifySyncStarting}
                                        onClick={async () => {
                                            setSpotifySyncStarting(true);
                                            try {
                                                const data = await apiFetch('/api/spotify-to-plex/sync', {
                                                    method: 'POST',
                                                    body: JSON.stringify({ type: 'all' }),
                                                });
                                                pushToast(data?.message || 'Sync started', 'success');
                                            } catch (e: any) {
                                                pushToast(e?.message || 'Sync failed', 'error');
                                            } finally {
                                                setSpotifySyncStarting(false);
                                            }
                                        }}
                                    >
                                        {spotifySyncStarting ? 'Starting…' : 'Sync now'}
                                    </button>
                                    <button
                                        type="button"
                                        className="px-3 py-2 rounded-md text-xs font-bold border border-border hover:border-plex hover:text-plex"
                                        onClick={() => window.location.assign(portalUrl('/spotify-sync'))}
                                    >
                                        Open logs
                                    </button>
                                </div>
                                {spotifyPortalImportMessage ? (
                                    <p className="text-[11px] text-muted mt-2">{spotifyPortalImportMessage}</p>
                                ) : null}
                                {spotifyToPlexEnabled && (
                                    <button
                                        type="button"
                                        className="mt-3 px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                        onClick={() => window.location.assign(portalUrl('/spotify-sync'))}
                                    >
                                        Open Spotify Sync
                                    </button>
                                )}
                                <p className="text-[11px] text-muted mt-2">Click Save Settings at the top after editing this tab.</p>
                            </section>
                        </div>
                    )}
                    {activeTab === 'metadata-fill' && mediaServerType === 'plex' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <IntegrationHeading
                                app="tmdb"
                                title="Metadata Fill"
                                subtitle="Fill TBA / empty episode title, summary, and air date from TMDB, TheTVDB, and TVmaze into Plex (fields are locked so agents do not wipe them)."
                            />
                            <section id={getSettingsSectionElementId('metadata-fill')} className="space-y-3 scroll-mt-24">
                                <SettingsToggleRow
                                    title="Enable Metadata Fill"
                                    hint={<SettingHint>Shows Metadata Fill in admin nav. OFF by default. Uses TMDB/TVDB keys when set; TVmaze needs no key (lookup via TVDB/IMDb ids).</SettingHint>}
                                    checked={metadataFillEnabled}
                                    onChange={(next) => {
                                        setMetadataFillEnabled(next);
                                    }}
                                />
                                <SettingsToggleRow
                                    title="Auto-fill on Sonarr On Import"
                                    hint={<SettingHint>Uses the Scanner Sonarr webhook when a file is imported (Sonarr’s event is named “Download”, not Grab). Enable On Import / On Upgrade in Sonarr Connect. Waits ~3 minutes, then polls Plex for up to ~2 more minutes (~5 min total) so the episode can finish scanning.</SettingHint>}
                                    checked={metadataFillAutoImport}
                                    onChange={setMetadataFillAutoImport}
                                    disabled={!metadataFillEnabled}
                                />
                                <p className={`text-xs mt-2 font-semibold ${metadataFillEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {metadataFillEnabled ? 'Enabled' : 'Disabled'}
                                </p>
                                {metadataFillEnabled && (
                                    <button
                                        type="button"
                                        className="mt-3 px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                        onClick={() => window.location.assign(portalUrl('/metadata-fill'))}
                                    >
                                        Open Metadata Fill
                                    </button>
                                )}
                                <p className="text-[11px] text-muted mt-2">Click Save Settings at the top after editing this tab.</p>
                            </section>
                        </div>
                    )}
                    {activeTab === 'scanner' && (
                        <ScannerSettingsPanel
                            enabled={scannerEnabled}
                            onEnabledChange={(v) => {
                                setScannerEnabled(v);
                                if (!v) setScannerHomeWidgetEnabled(false);
                            }}
                            homeWidgetEnabled={scannerHomeWidgetEnabled}
                            onHomeWidgetEnabledChange={setScannerHomeWidgetEnabled}
                            webhooksVisible={scannerWebhooksVisible}
                            onWebhooksVisibleChange={setScannerWebhooksVisible}
                            manualPathVisible={scannerManualPathVisible}
                            onManualPathVisibleChange={setScannerManualPathVisible}
                            scanner={scanner}
                            onChange={setScanner}
                            sectionId={getSettingsSectionElementId('scanner')}
                            addToast={addToast}
                        />
                    )}
                    {activeTab === 'media-automation' && (
                        <MediaAutomationSettings
                            enabled={mediaAutomationEnabled}
                            onEnabledChange={setMediaAutomationEnabled}
                            homeWidgetEnabled={mediaAutomationHomeWidgetEnabled}
                            onHomeWidgetEnabledChange={setMediaAutomationHomeWidgetEnabled}
                            config={mediaAutomation}
                            onConfigChange={setMediaAutomation}
                        />
                    )}
                    {activeTab === 'poster-sets' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <h3 className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-2 text-xl font-bold text-plex">
                                <span>Poster Sets</span>
                                <BetaBadge title={t('posterSetsPage.betaNotice')} />
                            </h3>
                            <section id={getSettingsSectionElementId('poster-sets')} className="space-y-3 scroll-mt-24">
                                <PosterSetsBetaBanner />
                                <SettingsToggleRow
                                    title="Enable Poster Sets"
                                    hint={<SettingHint>Admin nav for applying MediUX / ThePosterDB artwork sets to Plex. Connection settings live inside the Poster Sets page — separate from ColleXions and portal Plex settings.</SettingHint>}
                                    checked={posterSetsEnabled}
                                    onChange={setPosterSetsEnabled}
                                />
                                <p className={`text-xs mt-2 font-semibold ${posterSetsEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {posterSetsEnabled ? 'ON' : 'OFF'}
                                </p>
                                {posterSetsEnabled && (
                                    <button
                                        type="button"
                                        className="mt-3 px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                        onClick={() => window.location.assign(portalUrl('/poster-sets'))}
                                    >
                                        Open Poster Sets
                                    </button>
                                )}
                            </section>
                        </div>
                    )}
                    {activeTab === 'overlays' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Overlays</h3>
                            <section id={getSettingsSectionElementId('overlays')} className="space-y-3 scroll-mt-24">
                                <SettingsToggleRow
                                    title="Enable Overlays"
                                    hint={<SettingHint>Admin nav for New Season poster banners (and Layer overlays). Uses Plex credentials from Media Player. Import an existing overlaid_log.json from the standalone tool inside the Overlays page.</SettingHint>}
                                    checked={overlaysEnabled}
                                    onChange={setOverlaysEnabled}
                                />
                                <p className={`text-xs mt-2 font-semibold ${overlaysEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {overlaysEnabled ? 'ON' : 'OFF'}
                                </p>
                                {overlaysEnabled && (
                                    <button
                                        type="button"
                                        className="mt-3 px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                        onClick={() => window.location.assign(portalUrl('/overlays'))}
                                    >
                                        Open Overlays
                                    </button>
                                )}
                                <p className="text-xs text-muted mt-3">
                                    Prefer off-hours runs if you also use Layer overlays or Poster Sets bulk poster uploads on the same libraries.
                                </p>
                            </section>
                        </div>
                    )}
                    {activeTab === 'editions' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Editions</h3>
                            <section id={getSettingsSectionElementId('editions')} className="space-y-3 scroll-mt-24">
                                <SettingsToggleRow
                                    title="Enable Editions"
                                    hint={<SettingHint>Admin nav for Plex Edition tags (cuts, HDR, codecs, sources, and more). Uses Plex credentials from Media Player. Module order and webhooks are configured on the Editions page.</SettingHint>}
                                    checked={editionsEnabled}
                                    onChange={setEditionsEnabled}
                                />
                                <p className={`text-xs mt-2 font-semibold ${editionsEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {editionsEnabled ? 'ON' : 'OFF'}
                                </p>
                                {editionsEnabled && (
                                    <button
                                        type="button"
                                        className="mt-3 px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                        onClick={() => window.location.assign(portalUrl('/editions'))}
                                    >
                                        Open Editions
                                    </button>
                                )}
                                <p className="text-xs text-muted mt-3">
                                    Requires the Editions Python worker (`editions/cli.py`). Prefer a backup before processing your whole library.
                                </p>
                            </section>
                        </div>
                    )}
                    {activeTab === 'watch-sync' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">Watch Sync</h3>
                            <section id={getSettingsSectionElementId('watch-sync')} className="space-y-3 scroll-mt-24">
                                <SettingsToggleRow
                                    title="Enable Watch Sync"
                                    hint={<SettingHint>Admin section for syncing watched status, ratings, collections, and watchlists between Plex and Trakt. Trakt API credentials and sync options live on the Watch Sync page. Plex uses the Media Player server URL and token.</SettingHint>}
                                    checked={watchSyncEnabled}
                                    onChange={setWatchSyncEnabled}
                                />
                                <p className={`text-xs mt-2 font-semibold ${watchSyncEnabled ? 'text-green-300' : 'text-yellow-300'}`}>
                                    Current status: {watchSyncEnabled ? 'ON' : 'OFF'}
                                </p>
                                {watchSyncEnabled && (
                                    <button
                                        type="button"
                                        className="mt-3 px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                        onClick={() => window.location.assign(portalUrl('/watch-sync'))}
                                    >
                                        Open Watch Sync
                                    </button>
                                )}
                                <p className="text-xs text-muted mt-3">
                                    Plex only. Create a Trakt API application, then connect the account inside Watch Sync.
                                </p>
                            </section>
                        </div>
                    )}
                    {activeTab === 'system' && (
                        <div className="mb-8 animate-fade-in space-y-6">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">System</h3>
                            <section id={getSettingsSectionElementId('support-tickets')} className="space-y-3 scroll-mt-24">
                                <SettingsToggleRow
                                    title="Support tickets"
                                    hint={<SettingHint>Let members message you from the portal (open / resolved / closed tickets, unread badges, and in-app notifications). No Discord or email required.</SettingHint>}
                                    checked={supportTicketsEnabled}
                                    onChange={setSupportTicketsEnabled}
                                />
                                {supportTicketsEnabled && (
                                    <button
                                        type="button"
                                        className="mt-1 px-4 py-2 rounded-md font-bold transition-all bg-plex text-background hover:bg-plex-hover"
                                        onClick={() => window.location.assign(portalUrl('/support'))}
                                    >
                                        Open Support inbox
                                    </button>
                                )}
                            </section>
                            <section id={getSettingsSectionElementId('health')} className="space-y-4 mb-8 scroll-mt-24">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-bold text-text">Health Dashboard</h4>
                                    <span className={`text-xs px-2 py-1 rounded font-bold ${systemHealth.score >= 85 ? 'bg-green-500/20 text-green-300' : systemHealth.score >= 65 ? 'bg-yellow-500/20 text-yellow-300' : 'bg-red-500/20 text-red-300'}`}>
                                        {systemHealth.status}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 text-sm">
                                    <div>
                                        <p className="text-muted text-xs mb-1">Health Score</p>
                                        <p className="text-xl font-bold text-text">{systemHealth.score}%</p>
                                    </div>
                                    <div>
                                        <p className="text-muted text-xs mb-1">Integrations</p>
                                        <p className="text-xl font-bold text-text">{systemHealth.integrationsConfigured}/{systemHealth.integrationsTotal}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted text-xs mb-1">Caches</p>
                                        <p className="text-xl font-bold text-text">{systemHealth.cacheHealthy}/{systemHealth.cacheTotal}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted text-xs mb-1">Running Jobs</p>
                                        <p className="text-xl font-bold text-text">{systemHealth.runningJobs}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted text-xs mb-1">Failing Jobs</p>
                                        <p className={`text-xl font-bold ${systemHealth.failingJobs > 0 ? 'text-red-300' : 'text-text'}`}>{systemHealth.failingJobs}</p>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-muted mb-2">Attention Needed</p>
                                    {systemHealth.alerts.length === 0 ? (
                                        <p className="text-sm text-green-300">No active health alerts.</p>
                                    ) : (
                                        <ul className="text-sm text-yellow-200 space-y-1">
                                            {systemHealth.alerts.map((alert, index) => (
                                                <li key={`health-alert-${index}`}>- {alert}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </section>
                            <section id={getSettingsSectionElementId('backup')} className="space-y-4 mb-8 scroll-mt-24">
                                <h4 className="font-bold text-text">Backup & Restore</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                    <SettingsToggleRow
                                        title="Auto Backup Enabled"
                                        checked={autoBackupEnabled}
                                        onChange={setAutoBackupEnabled}
                                        border={false}
                                        className="!py-0"
                                    />
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Interval (Days)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            className="w-full p-2 rounded border border-border bg-background text-text"
                                            value={autoBackupIntervalDays}
                                            onChange={(e) => setAutoBackupIntervalDays(Math.max(1, Number(e.target.value) || 1))}
                                        />
                                    </div>
                                    <div>
                                        <label className="font-semibold text-sm block mb-2">Rolling Backups Kept</label>
                                        <input
                                            type="number"
                                            min={1}
                                            className="w-full p-2 rounded border border-border bg-background text-text"
                                            value={autoBackupRetentionCount}
                                            onChange={(e) => setAutoBackupRetentionCount(Math.max(1, Number(e.target.value) || 1))}
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-3 mb-4">
                                    <button className="px-4 py-2 bg-plex text-background rounded-md font-bold hover:bg-plex-hover transition-colors" onClick={handleDownloadBackup}>Download Backup</button>
                                    <button className="px-4 py-2 bg-indigo-600 text-white rounded-md font-bold hover:bg-indigo-500 transition-colors" onClick={handleCreateBackupFile}>Create Backup File</button>
                                    <button className="px-4 py-2 bg-red-600 text-white rounded-md font-bold hover:bg-red-500 transition-colors disabled:opacity-50" onClick={handleRestoreBackup} disabled={isRestoringBackup}>
                                        {isRestoringBackup ? 'Restoring...' : 'Restore Backup'}
                                    </button>
                                </div>
                                <textarea
                                    className="w-full min-h-[140px] p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex"
                                    placeholder="Paste backup JSON here before clicking Restore Backup..."
                                    value={backupRestoreText}
                                    onChange={(e) => setBackupRestoreText(e.target.value)}
                                />
                                <div className="mt-4">
                                    <h5 className="font-semibold text-sm text-text mb-2">Auto Backup Files</h5>
                                    <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                                        {backupFiles.length === 0 ? (
                                            <p className="text-xs text-muted">No backup files found in backup folder.</p>
                                        ) : backupFiles.map(file => (
                                            <div key={file.filename} className="py-2 border-b border-border/40 flex items-center justify-between gap-2 last:border-b-0">
                                                <div className="text-xs">
                                                    <p className="font-semibold text-text">{file.filename}</p>
                                                    <p className="text-muted">{file.createdAt ? new Date(file.createdAt).toLocaleString() : 'Unknown date'} · {(file.size / 1024).toFixed(1)} KB</p>
                                                </div>
                                                <button className="px-3 py-1.5 bg-red-600/80 text-white rounded text-xs font-bold hover:bg-red-500" onClick={() => handleRestoreFromFile(file.filename)}>
                                                    Restore
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>

                            <MemoryDiagnosticsSection
                                diagnostics={diagnostics}
                                isLoading={isLoadingDiagnostics}
                                onRefresh={fetchDiagnostics}
                            />

                            <section id={getSettingsSectionElementId('diagnostics')} className="space-y-4 mb-8 scroll-mt-24">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-bold text-text">System Diagnostics</h4>
                                    <button className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80" onClick={fetchDiagnostics}>
                                        {isLoadingDiagnostics ? 'Refreshing...' : 'Refresh'}
                                    </button>
                                </div>
                                {diagnostics ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                                        <div><strong>App Version:</strong> {diagnostics?.app?.version || 'unknown'}</div>
                                        <div><strong>Uptime:</strong> {diagnostics?.app?.uptimeSeconds || 0}s</div>
                                        <div><strong>Node:</strong> {diagnostics?.app?.nodeVersion || 'n/a'}</div>
                                        <div className="flex items-center justify-between gap-2">
                                            <strong>Media Player ({mediaServerLabel})</strong>
                                            {renderConfigPill(mediaServerType !== 'plex' ? !!diagnostics?.integrations?.jellyfinConfigured : !!diagnostics?.integrations?.plexConfigured)}
                                        </div>
                                        <div className="flex items-center justify-between gap-2"><strong>SMTP</strong>{renderOptionalIntegrationPill(!!diagnostics?.integrations?.smtpConfigured)}</div>
                                        <div className="flex items-center justify-between gap-2"><strong>Gotify</strong>{renderOptionalIntegrationPill(!!diagnostics?.integrations?.gotifyConfigured)}</div>
                                        <div className="flex items-center justify-between gap-2">
                                            <strong>Sonarr</strong>
                                            {renderConfigPill(!!diagnostics?.integrations?.sonarrConfigured)}
                                            {diagnostics?.integrations?.arrInstanceCounts?.sonarr?.ready > 1 && (
                                                <span className="text-[10px] text-muted">{diagnostics.integrations.arrInstanceCounts.sonarr.ready} instances</span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <strong>Radarr</strong>
                                            {renderConfigPill(!!diagnostics?.integrations?.radarrConfigured)}
                                            {diagnostics?.integrations?.arrInstanceCounts?.radarr?.ready > 1 && (
                                                <span className="text-[10px] text-muted">{diagnostics.integrations.arrInstanceCounts.radarr.ready} instances</span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <strong>Lidarr</strong>
                                            {renderOptionalIntegrationPill(!!diagnostics?.integrations?.lidarrConfigured)}
                                            {diagnostics?.integrations?.arrInstanceCounts?.lidarr?.ready > 1 && (
                                                <span className="text-[10px] text-muted">{diagnostics.integrations.arrInstanceCounts.lidarr.ready} instances</span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <strong>Bazarr</strong>
                                            {renderOptionalIntegrationPill(!!diagnostics?.integrations?.bazarrConfigured)}
                                            {diagnostics?.integrations?.arrInstanceCounts?.bazarr?.ready > 1 && (
                                                <span className="text-[10px] text-muted">{diagnostics.integrations.arrInstanceCounts.bazarr.ready} instances</span>
                                            )}
                                        </div>
                                        {mediaServerType !== 'plex' ? (
                                            <>
                                            <div className="flex items-center justify-between gap-2"><strong>Jellystat</strong>{renderConfigPill(!!diagnostics?.integrations?.jellystatConfigured)}</div>
                                            <div className="flex items-center justify-between gap-2"><strong>JellyGlance</strong>{renderConfigPill(!!diagnostics?.integrations?.jellyglanceConfigured)}</div>
                                            </>
                                        ) : (
                                            <div className="flex items-center justify-between gap-2"><strong>Tautulli</strong>{renderConfigPill(!!diagnostics?.integrations?.tautulliConfigured)}</div>
                                        )}
                                        <div className="flex items-center justify-between gap-2"><strong>Request App</strong>{renderOptionalPill(!!diagnostics?.integrations?.requestAppEnabled, !!diagnostics?.integrations?.requestAppConfigured)}</div>
                                        <div className="flex items-center justify-between gap-2"><strong>Analytics Cache</strong>{renderConfigPill(!!diagnostics?.caches?.analytics?.exists)}</div>
                                        <div className="flex items-center justify-between gap-2"><strong>Trending Cache</strong>{renderConfigPill(!!diagnostics?.caches?.trending?.exists)}</div>
                                        {mediaServerType === 'plex' && (
                                            <div className="flex items-center justify-between gap-2"><strong>Plex Stats Cache</strong>{renderConfigPill(!!diagnostics?.caches?.plexStats?.exists)}</div>
                                        )}
                                        <div className="flex items-center justify-between gap-2"><strong>Users File</strong>{renderConfigPill(!!diagnostics?.files?.users?.exists)}</div>
                                        <div className="flex items-center justify-between gap-2"><strong>Config File</strong>{renderConfigPill(!!diagnostics?.files?.config?.exists)}</div>
                                        <div className="flex items-center justify-between gap-2"><strong>Auto Backup</strong>{renderConfigPill(!!diagnostics?.backup?.enabled)}</div>
                                        <div><strong>Backup Files:</strong> {diagnostics?.backup?.availableBackups ?? 0}</div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted">No diagnostics loaded yet.</p>
                                )}
                            </section>

                            <section className="space-y-4 mb-8">
                                <h4 className="font-bold text-text">Job Queue</h4>
                                <div className="flex flex-col gap-3">
                                    {tasks.map(task => (
                                        <div key={`system-${task.id}`} className="py-3 border-b border-border/40 last:border-b-0 flex items-center justify-between gap-4">
                                            <div>
                                                <p className="font-semibold text-text">{task.name}</p>
                                                <div className="text-xs text-muted mt-1">
                                                    Last: {task.lastRun ? new Date(task.lastRun).toLocaleString() : 'Never'} · Next: {task.nextRun ? new Date(task.nextRun).toLocaleString() : 'Not Scheduled'}
                                                    {task.lastDurationMs !== null ? ` · Duration: ${Math.round(task.lastDurationMs / 1000)}s` : ''}
                                                </div>
                                                {task.lastDetail && !task.lastError && <div className="text-xs text-muted mt-1">{task.lastDetail}</div>}
                                                {task.lastError && <div className="text-xs text-red-300 mt-1">Last error: {task.lastError}</div>}
                                                {task.lastWarning && !task.lastError && <div className="text-xs text-amber-300 mt-1">Last warning: {task.lastWarning}</div>}
                                            </div>
                                            <TaskStatusPill task={task} />
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section className="space-y-4 mb-8">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <h4 className="font-bold text-text">{t('settings.logs.audit.viewerTitle')}</h4>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <button
                                            className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80 disabled:opacity-50"
                                            disabled={isExportingAuditCsv}
                                            onClick={() => void exportAuditLogCsv()}
                                        >
                                            {isExportingAuditCsv ? t('settings.logs.actions.exportingCsv') : t('settings.logs.actions.exportCsv')}
                                        </button>
                                        <button
                                            className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80 disabled:opacity-50"
                                            disabled={isExportingAuditLog}
                                            onClick={() => void exportAuditLog()}
                                        >
                                            {isExportingAuditLog ? t('settings.logs.actions.exporting') : t('settings.logs.actions.exportAll')}
                                        </button>
                                        <button className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80" onClick={() => void fetchAuditLog()}>
                                            {isLoadingAuditLog ? t('settings.logs.actions.refreshing') : t('settings.logs.actions.refresh')}
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                    <label className="block text-[11px] font-bold uppercase tracking-wide text-muted">
                                        {t('settings.logs.filters.event')}
                                        <select
                                            value={auditFilterEvent}
                                            onChange={(e) => setAuditFilterEvent(e.target.value)}
                                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text"
                                        >
                                            <option value="">{t('settings.logs.filters.allEvents')}</option>
                                            {auditLogEvents.map((eventKey) => (
                                                <option key={eventKey} value={eventKey}>{formatEventName(eventKey)}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block text-[11px] font-bold uppercase tracking-wide text-muted">
                                        {t('settings.logs.filters.user')}
                                        <input
                                            type="text"
                                            value={auditFilterUser}
                                            onChange={(e) => setAuditFilterUser(e.target.value)}
                                            placeholder={t('settings.logs.filters.userPlaceholder')}
                                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text"
                                        />
                                    </label>
                                    <label className="block text-[11px] font-bold uppercase tracking-wide text-muted">
                                        {t('settings.logs.filters.from')}
                                        <input
                                            type="date"
                                            value={auditFilterFrom}
                                            onChange={(e) => setAuditFilterFrom(e.target.value)}
                                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text"
                                        />
                                    </label>
                                    <label className="block text-[11px] font-bold uppercase tracking-wide text-muted">
                                        {t('settings.logs.filters.to')}
                                        <input
                                            type="date"
                                            value={auditFilterTo}
                                            onChange={(e) => setAuditFilterTo(e.target.value)}
                                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text"
                                        />
                                    </label>
                                </div>
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <p className="text-xs text-muted">
                                        {t('settings.logs.filters.matched', { matched: auditLogTotal, total: auditLogTotalAll })}
                                    </p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <label className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted">
                                            <Bookmark className="w-3.5 h-3.5" />
                                            <span className="sr-only">{t('settings.logs.filters.presets')}</span>
                                            <select
                                                value={selectedAuditPresetId}
                                                onChange={(e) => {
                                                    const id = e.target.value;
                                                    if (!id) {
                                                        setSelectedAuditPresetId('');
                                                        return;
                                                    }
                                                    applyAuditFilterPreset(id);
                                                }}
                                                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-text"
                                            >
                                                <option value="">{t('settings.logs.filters.presetsPlaceholder')}</option>
                                                {auditFilterPresets.map((preset) => (
                                                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <button
                                            type="button"
                                            className="px-3 py-1.5 rounded-md border border-border text-xs font-semibold text-muted hover:text-text"
                                            onClick={saveAuditFilterPreset}
                                        >
                                            {t('settings.logs.filters.savePreset')}
                                        </button>
                                        <button
                                            type="button"
                                            className="px-3 py-1.5 rounded-md border border-border text-xs font-semibold text-muted hover:text-text disabled:opacity-40"
                                            disabled={!selectedAuditPresetId}
                                            onClick={deleteSelectedAuditFilterPreset}
                                        >
                                            {t('settings.logs.filters.deletePreset')}
                                        </button>
                                        <button
                                            type="button"
                                            className="px-3 py-1.5 rounded-md border border-border text-xs font-semibold text-muted hover:text-text"
                                            onClick={() => {
                                                setSelectedAuditPresetId('');
                                                setAuditFilterEvent('');
                                                setAuditFilterUser('');
                                                setAuditFilterFrom('');
                                                setAuditFilterTo('');
                                            }}
                                        >
                                            {t('settings.logs.filters.clear')}
                                        </button>
                                        <button
                                            type="button"
                                            className="px-3 py-1.5 rounded-md bg-plex text-background text-xs font-bold"
                                            onClick={() => void fetchAuditLog()}
                                        >
                                            {t('settings.logs.filters.apply')}
                                        </button>
                                    </div>
                                </div>
                                {pagedAuditEntries.length === 0 ? (
                                    <p className="text-sm text-muted">{t('settings.logs.audit.empty')}</p>
                                ) : (
                                    <div className="space-y-3">
                                        {pagedAuditEntries.map((entry) => {
                                            const diffRows = getAuditDiffRows(entry.details);
                                            const detailKeys = entry.details && typeof entry.details === 'object'
                                                ? Object.entries(entry.details).filter(([key]) => !diffRows.some(row => key.toLowerCase().includes(row.field.toLowerCase())))
                                                : [];
                                            const targetLabel = entry.target?.username || entry.target?.email || t('settings.logs.audit.system');
                                            const actorLabel = entry.actor?.username || entry.actor?.email || '';
                                            const targetJump = auditSubjectLabel(entry.target);
                                            const actorJump = auditSubjectLabel(entry.actor);
                                            return (
                                                <details key={entry.id} className="py-3 border-b border-border/40 last:border-b-0">
                                                    <summary className="cursor-pointer list-none">
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                            <p className="font-semibold text-text text-sm">{entry.event ? formatEventName(entry.event) : t('settings.logs.audit.unknownEvent')}</p>
                                                            <span className="text-[11px] text-muted">{formatDateTime(entry.timestamp)}</span>
                                                        </div>
                                                        <p className="text-xs text-muted mt-1">
                                                            {t('settings.logs.audit.target')}: {targetLabel}
                                                            {actorLabel ? ` · ${t('settings.logs.audit.actor')}: ${actorLabel}` : ''}
                                                        </p>
                                                    </summary>
                                                    <div className="mt-3 space-y-2">
                                                        {(targetJump || actorJump) && (
                                                            <div className="flex flex-wrap gap-2">
                                                                {targetJump && (
                                                                    <>
                                                                        <button
                                                                            type="button"
                                                                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-text"
                                                                            onClick={() => openAuditSubjectUsers(entry.target)}
                                                                        >
                                                                            <ExternalLink className="w-3 h-3" />
                                                                            {t('settings.logs.audit.openUser')}: {targetJump}
                                                                        </button>
                                                                        {entry.target?.username && (
                                                                            <button
                                                                                type="button"
                                                                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-text"
                                                                                onClick={() => openAuditSubjectAnalytics(entry.target)}
                                                                            >
                                                                                <ExternalLink className="w-3 h-3" />
                                                                                {t('settings.logs.audit.openAnalytics')}
                                                                            </button>
                                                                        )}
                                                                    </>
                                                                )}
                                                                {actorJump && actorJump !== targetJump && (
                                                                    <button
                                                                        type="button"
                                                                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-text"
                                                                        onClick={() => openAuditSubjectUsers(entry.actor)}
                                                                    >
                                                                        <ExternalLink className="w-3 h-3" />
                                                                        {t('settings.logs.audit.actor')}: {actorJump}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                        {diffRows.length > 0 && (
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full text-xs border border-border/60 rounded-lg overflow-hidden">
                                                                    <thead className="bg-black/30 text-muted">
                                                                        <tr>
                                                                            <th className="text-left px-2 py-1">{t('settings.logs.audit.field')}</th>
                                                                            <th className="text-left px-2 py-1">{t('settings.logs.audit.before')}</th>
                                                                            <th className="text-left px-2 py-1">{t('settings.logs.audit.after')}</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {diffRows.map((row, rowIdx) => (
                                                                            <tr key={`${entry.id}-diff-${rowIdx}`} className="border-t border-border/50">
                                                                                <td className="px-2 py-1 text-text">{row.field}</td>
                                                                                <td className="px-2 py-1 text-red-300">{row.before}</td>
                                                                                <td className="px-2 py-1 text-green-300">{row.after}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                        {detailKeys.length > 0 && (
                                                            <div className="text-xs text-muted bg-black/30 rounded p-2 space-y-1">
                                                                {detailKeys.map(([key, value]) => (
                                                                    <p key={`${entry.id}-${key}`}>
                                                                        <span className="text-text">{key}:</span> {stringifyAuditValue(value)}
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </details>
                                            );
                                        })}
                                        {totalAuditLogPages > 1 && (
                                            <div className="flex items-center justify-between pt-1">
                                                <button
                                                    className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80 disabled:opacity-50"
                                                    disabled={auditLogPage === 1}
                                                    onClick={() => setAuditLogPage(p => Math.max(1, p - 1))}
                                                >
                                                    {t('settings.logs.pagination.previous')}
                                                </button>
                                                <span className="text-xs text-muted">{t('settings.logs.pagination.pageOf', { page: auditLogPage, total: totalAuditLogPages })}</span>
                                                <button
                                                    className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80 disabled:opacity-50"
                                                    disabled={auditLogPage === totalAuditLogPages}
                                                    onClick={() => setAuditLogPage(p => Math.min(totalAuditLogPages, p + 1))}
                                                >
                                                    {t('settings.logs.pagination.next')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        </div>
                    )}
                    {activeTab === 'logs' && (
                        <div className="mb-8 animate-fade-in space-y-8">
                            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.navigation.tabs.logs')}</h3>

                            <section className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-bold text-text">{t('settings.logs.blocklist.title')}</h4>
                                    <span className="px-2 py-1 rounded text-xs font-semibold bg-red-500/20 text-red-300">{deletedUsersLog.length}</span>
                                </div>
                                <div className="space-y-2">
                                    {deletedUsersLog.length === 0 ? (
                                        <p className="text-sm text-muted">{t('settings.logs.blocklist.empty')}</p>
                                    ) : (
                                        deletedUsersLog.map((deletedUser) => (
                                            <div key={deletedUser.blockId} className="py-3 border-b border-border/40 flex items-center justify-between gap-3 last:border-b-0">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-text truncate">{deletedUser.username || t('settings.logs.blocklist.unknownUser')}</p>
                                                    <p className="text-xs text-muted truncate">{deletedUser.email || deletedUser.plexId || deletedUser.id || t('settings.logs.blocklist.noIdentifier')}</p>
                                                    <p className="text-[11px] text-muted/80">{t('settings.logs.blocklist.deletedBy', { date: formatDateTime(deletedUser.deletedAt), actor: deletedUser.deletedBy || t('settings.logs.blocklist.defaultActor') })}</p>
                                                </div>
                                                <button
                                                    className="px-3 py-1.5 bg-border text-text rounded text-xs font-semibold hover:bg-opacity-80"
                                                    onClick={() => handleUnblockDeletedUser(deletedUser)}
                                                >
                                                    {t('settings.logs.actions.unblock')}
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>

                            <section className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-bold text-text">{t('settings.logs.email.title')}</h4>
                                    <button className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80" onClick={fetchAuditLog}>
                                        {isLoadingAuditLog ? t('settings.logs.actions.refreshing') : t('settings.logs.actions.refresh')}
                                    </button>
                                </div>
                                {pagedEmailEntries.length === 0 ? (
                                    <p className="text-sm text-muted">{t('settings.logs.email.empty')}</p>
                                ) : (
                                    <div className="space-y-2">
                                        {pagedEmailEntries.map((entry) => (
                                            <div key={entry.id} className="py-3 border-b border-border/40 last:border-b-0">
                                                <div className="flex items-start justify-between gap-3">
                                                    <p className="text-sm font-semibold text-text line-clamp-1">{entry.details?.subject || t('settings.logs.email.systemEmail')}</p>
                                                    <span className="text-[11px] text-muted whitespace-nowrap">{formatDateTime(entry.timestamp)}</span>
                                                </div>
                                                <p className="text-xs text-muted mt-1">{t('settings.logs.email.to')}: {entry.target?.username || entry.target?.email || t('settings.logs.blocklist.unknownUser')}</p>
                                            </div>
                                        ))}
                                        {totalEmailLogPages > 1 && (
                                            <div className="flex items-center justify-between pt-1">
                                                <button
                                                    className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80 disabled:opacity-50"
                                                    disabled={emailLogPage === 1}
                                                    onClick={() => setEmailLogPage(p => Math.max(1, p - 1))}
                                                >
                                                    {t('settings.logs.pagination.previous')}
                                                </button>
                                                <span className="text-xs text-muted">{t('settings.logs.pagination.pageOf', { page: emailLogPage, total: totalEmailLogPages })}</span>
                                                <button
                                                    className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80 disabled:opacity-50"
                                                    disabled={emailLogPage === totalEmailLogPages}
                                                    onClick={() => setEmailLogPage(p => Math.min(totalEmailLogPages, p + 1))}
                                                >
                                                    {t('settings.logs.pagination.next')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        </div>
                    )}
                        </div>
                        <StickySaveBar>
                            <a href="https://jl94x4.github.io/StreamPilot/" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-3.5 py-2.5 text-sm font-bold text-text transition-colors hover:bg-white/10">
                                <BookOpen className="h-4 w-4" /> Docs
                            </a>
                            <button
                                type="button"
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background shadow-lg shadow-plex/15 transition-colors hover:bg-plex-hover disabled:opacity-50"
                                onClick={handleSave}
                                disabled={isLoading}
                            >
                                <Save className="h-4 w-4" />
                                {activeTab === 'stream-rules' ? 'Save Stream Rules' : 'Save Settings'}
                            </button>
                        </StickySaveBar>
                    </div>
                </div>
            </div>
        </div>
    );
};
