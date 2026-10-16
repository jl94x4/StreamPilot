import React, { useState, useEffect } from 'react';
import {
    Settings, Sparkles, ChevronRight, ChevronLeft, Check, Palette, Mail, Layers, Server, PartyPopper, BookOpen, Upload,
    Bell, Eye,
} from 'lucide-react';
import { apiFetch, PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE } from '../shared/api';
import { getPublicOrigin, logoUrl, portalUrl, stripBasePath, PLEX_ICON_URL } from '../shared/basePath';
import { IntegrationTestButton } from '../shared/IntegrationTestButton';
import { CustomSelect } from '../shared/ui';
import { AuthPageBackground, themeClasses } from '../shared/theme';
import { accentHoverRgb, hexToRgb } from '../shared/format';
import type { PlexServer, ArrInstance } from '../shared/types';
import { ArrInstancesPanel, createEmptyArrInstance } from '../settings/ArrInstancesPanel';
import { ALWAYS_VISIBLE_MEMBER_NAV_KEYS, NAV_ITEM_LABELS } from '../shared/nav';

const normalizeSetupArrInstances = (stored: Record<string, any> = {}): ArrInstance[] => {
    if (Array.isArray(stored.arrInstances) && stored.arrInstances.length > 0) {
        return stored.arrInstances.map((entry: ArrInstance) => ({ ...entry }));
    }
    const instances: ArrInstance[] = [];
    if (stored.sonarrUrl || stored.sonarrApiKey) {
        instances.push({
            ...createEmptyArrInstance('sonarr', true),
            url: stored.sonarrUrl || '',
            apiKey: stored.sonarrApiKey || '',
        });
    }
    if (stored.radarrUrl || stored.radarrApiKey) {
        instances.push({
            ...createEmptyArrInstance('radarr', true),
            url: stored.radarrUrl || '',
            apiKey: stored.radarrApiKey || '',
        });
    }
    return instances;
};

const STEPS = [
    { id: 'welcome', label: 'Welcome', icon: Sparkles, hint: 'Overview & what to expect' },
    { id: 'plex', label: 'Media Server', icon: Server, hint: 'Choose Plex or Jellyfin' },
    { id: 'branding', label: 'Branding', icon: Palette, hint: 'Colors, logo & domain' },
    { id: 'notifications', label: 'Notifications', icon: Bell, hint: 'Optional email & Gotify' },
    { id: 'integrations', label: 'Integrations', icon: Layers, hint: 'Optional Arr apps & requests' },
    { id: 'members', label: 'Member pages', icon: Eye, hint: 'Optional — what members see' },
    { id: 'finish', label: 'Finish', icon: PartyPopper, hint: 'Review & launch' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

const OPTIONAL_STEPS = new Set<StepId>(['notifications', 'integrations', 'members']);

const WELCOME_FEATURES = [
    { icon: Server, title: 'Plex, Jellyfin or Emby', desc: 'Connect and test your media server' },
    { icon: Palette, title: 'Your Brand', desc: 'Custom colors, logo & domain' },
    { icon: Bell, title: 'Notifications', desc: 'Optional email and Gotify alerts' },
    { icon: Layers, title: 'Media Stack', desc: 'Optional Sonarr, Radarr, Lidarr & requests' },
    { icon: Eye, title: 'Member pages', desc: 'Optional — choose what members see' },
] as const;

const SETUP_MEMBER_NAV_TOGGLES = [
    'request',
    'discover',
    'analytics',
    'mediastack',
    'downloads',
    'status',
    'achievements',
    'support',
    'chat',
    'profile',
    'preferences',
    'about',
] as const;

const normalizeSetupMemberNavHiddenKeys = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of raw) {
        const key = String(entry || '').trim();
        if (!key || ALWAYS_VISIBLE_MEMBER_NAV_KEYS.has(key) || seen.has(key)) continue;
        if (!(SETUP_MEMBER_NAV_TOGGLES as readonly string[]).includes(key)) continue;
        seen.add(key);
        result.push(key);
    }
    return result;
};

const SETUP_PLEX_STORAGE_KEY = 'setupWizardPlex';
const SETUP_TOKEN_STORAGE_KEY = 'setupWizardSetupToken';

const readSetupAccessToken = (): string => {
    try {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = String(params.get('setupToken') || '').trim();
        if (fromQuery) {
            sessionStorage.setItem(SETUP_TOKEN_STORAGE_KEY, fromQuery);
            return fromQuery;
        }
        return String(sessionStorage.getItem(SETUP_TOKEN_STORAGE_KEY) || '').trim();
    } catch {
        return '';
    }
};

const setupAuthHeaders = (setupToken: string): Record<string, string> => ({
    [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
    ...(setupToken ? { 'X-Setup-Token': setupToken } : {}),
});

const MIGRATE_SEERR_OPTIONS = [
    { label: 'Seerr / Overseerr', value: 'seerr' },
    { label: 'Jellyseerr', value: 'jellyseerr' },
];

type RequestSetupMode = 'portal' | 'seerr';

const SELFHST_ICON_BASE = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg';
const APP_ICONS: Record<string, string> = {
    sonarr: `${SELFHST_ICON_BASE}/sonarr.svg`,
    radarr: `${SELFHST_ICON_BASE}/radarr.svg`,
    lidarr: `${SELFHST_ICON_BASE}/lidarr.svg`,
    bazarr: `${SELFHST_ICON_BASE}/bazarr.svg`,
    tautulli: `${SELFHST_ICON_BASE}/tautulli.svg`,
    seerr: `${SELFHST_ICON_BASE}/seerr.svg`,
    overseerr: `${SELFHST_ICON_BASE}/seerr.svg`,
    jellyseerr: `${SELFHST_ICON_BASE}/jellyseerr.svg`,
    ombi: `${SELFHST_ICON_BASE}/ombi.svg`,
    tmdb: `${SELFHST_ICON_BASE}/themoviedb.svg`,
    jellystat: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/png/jellystat.png',
    jellyglance: '/static/logos/jellyglance.png',
    gotify: `${SELFHST_ICON_BASE}/gotify.svg`,
};

const JELLYFIN_ANALYTICS_OPTIONS = [
    { label: 'Jellystat', value: 'jellystat' },
    { label: 'JellyGlance', value: 'jellyglance' },
];

const getUploadedLogoPath = (file: File) => {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    if (type.includes('webp') || name.endsWith('.webp')) return '/static/logo.webp';
    if (type.includes('jpeg') || type.includes('jpg') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return '/static/logo.jpg';
    return '/static/logo.png';
};

const ProgramIcon: React.FC<{ app: string; label: string }> = ({ app, label }) => (
    <span className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
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

const MEDIA_SERVER_OPTIONS = [
    { label: 'Plex', value: 'plex' },
    { label: 'Jellyfin', value: 'jellyfin' },
    { label: 'Emby', value: 'emby' },
];
const MEDIA_SERVER_LOGOS: Record<string, string> = {
    plex: PLEX_ICON_URL,
    jellyfin: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyfin.svg',
    emby: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/emby.svg',
};

const BRAND_THEME_OPTIONS = [
    { label: 'Plex', value: 'plex' },
    { label: 'Jellyfin', value: 'jellyfin' },
    { label: 'Emby', value: 'emby' },
    { label: 'Ocean Teal', value: 'ocean' },
    { label: 'Rose Pink', value: 'rose' },
    { label: 'Royal Blue', value: 'royal' },
    { label: 'Graphite', value: 'graphite' },
    { label: 'Cyber Lime', value: 'cyberlime' },
    { label: 'Aurora', value: 'aurora' },
    { label: 'Custom', value: 'custom' },
];

const BRAND_THEME_COLORS: Record<string, string> = {
    plex: '#F7C600',
    jellyfin: '#00A4DC',
    emby: '#52B54B',
    ocean: '#14B8A6',
    rose: '#F472B6',
    royal: '#60A5FA',
    graphite: '#D4D4D8',
    cyberlime: '#A3E635',
    aurora: '#2DD4BF',
};

const readStoredSetupPlex = () => {
    try {
        const raw = sessionStorage.getItem(SETUP_PLEX_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as {
            token?: string;
            mediaServerType?: string;
            servers?: PlexServer[];
            serverIdentifier?: string;
            plexServerUrl?: string;
            jellyfinUrl?: string;
            jellyfinApiKey?: string;
            username?: string;
            step?: StepId;
            publicDomain?: string;
            brandTheme?: string;
            primaryColor?: string;
            customLogoUrl?: string;
            smtpHost?: string;
            smtpPort?: number;
            smtpUser?: string;
            smtpPass?: string;
            smtpFrom?: string;
            smtpSecure?: boolean;
            gotifyUrl?: string;
            gotifyToken?: string;
            autoApproveMovies?: boolean;
            autoApproveTv?: boolean;
            requestQuotaLimit?: number;
            requestQuotaDays?: number;
            memberNavHiddenKeys?: string[];
            sonarrUrl?: string;
            sonarrApiKey?: string;
            radarrUrl?: string;
            radarrApiKey?: string;
            arrInstances?: ArrInstance[];
            tautulliUrl?: string;
            tautulliApiKey?: string;
            jellyfinAnalyticsProvider?: string;
            jellystatUrl?: string;
            jellystatApiKey?: string;
            jellyglanceUrl?: string;
            jellyglanceApiKey?: string;
            requestAppType?: string;
            requestAppUrl?: string;
            requestAppApiKey?: string;
            tmdbApiKey?: string;
            migrateFromSeerr?: boolean;
            requestSetupMode?: RequestSetupMode;
        };
    } catch {
        return null;
    }
};

export const SetupWizard: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
    const storedPlex = readStoredSetupPlex();
    const isOAuthReturn = typeof window !== 'undefined' && stripBasePath(window.location.pathname).startsWith('/auth/setup/');
    const [setupToken] = useState(() => (typeof window !== 'undefined' ? readSetupAccessToken() : ''));

    const [step, setStep] = useState<StepId>(() => {
        if (isOAuthReturn) return 'plex';
        const storedStep = storedPlex?.step === 'email' ? 'notifications' : storedPlex?.step;
        if (storedStep && STEPS.some((entry) => entry.id === storedStep)) return storedStep;
        if (storedPlex?.token) return 'plex';
        return 'welcome';
    });
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const [token, setToken] = useState(storedPlex?.token || '');
    const [mediaServerType, setMediaServerType] = useState(storedPlex?.mediaServerType || 'plex');
    const [serverIdentifier, setServerIdentifier] = useState(storedPlex?.serverIdentifier || '');
    const [plexServerUrl, setPlexServerUrl] = useState(storedPlex?.plexServerUrl || '');
    const [jellyfinUrl, setJellyfinUrl] = useState(storedPlex?.jellyfinUrl || '');
    const [jellyfinApiKey, setJellyfinApiKey] = useState(storedPlex?.jellyfinApiKey || '');
    const [servers, setServers] = useState<PlexServer[]>(storedPlex?.servers || []);
    const [plexUsername, setPlexUsername] = useState(storedPlex?.username || '');
    const [showManualToken, setShowManualToken] = useState(false);

    const [publicDomain, setPublicDomain] = useState(storedPlex?.publicDomain ?? (typeof window !== 'undefined' ? getPublicOrigin() : ''));
    const [brandTheme, setBrandTheme] = useState(storedPlex?.brandTheme ?? 'plex');
    const [primaryColor, setPrimaryColor] = useState(storedPlex?.primaryColor ?? BRAND_THEME_COLORS.plex);
    const [customLogoUrl, setCustomLogoUrl] = useState(storedPlex?.customLogoUrl ?? '');
    const [logoFile, setLogoFile] = useState<File | null>(null);

    const [smtpHost, setSmtpHost] = useState(storedPlex?.smtpHost ?? '');
    const [smtpPort, setSmtpPort] = useState(storedPlex?.smtpPort ?? 587);
    const [smtpUser, setSmtpUser] = useState(storedPlex?.smtpUser ?? '');
    const [smtpPass, setSmtpPass] = useState(storedPlex?.smtpPass ?? '');
    const [smtpFrom, setSmtpFrom] = useState(storedPlex?.smtpFrom ?? '');
    const [smtpSecure, setSmtpSecure] = useState(storedPlex?.smtpSecure ?? false);
    const [testRecipient, setTestRecipient] = useState('');
    const [gotifyUrl, setGotifyUrl] = useState(storedPlex?.gotifyUrl ?? '');
    const [gotifyToken, setGotifyToken] = useState(storedPlex?.gotifyToken ?? '');
    const [autoApproveMovies, setAutoApproveMovies] = useState(!!storedPlex?.autoApproveMovies);
    const [autoApproveTv, setAutoApproveTv] = useState(!!storedPlex?.autoApproveTv);
    const [requestQuotaLimit, setRequestQuotaLimit] = useState(Number(storedPlex?.requestQuotaLimit) || 0);
    const [requestQuotaDays, setRequestQuotaDays] = useState(Number(storedPlex?.requestQuotaDays) || 7);
    const [memberNavHiddenKeys, setMemberNavHiddenKeys] = useState<string[]>(
        () => normalizeSetupMemberNavHiddenKeys(storedPlex?.memberNavHiddenKeys),
    );

    const [arrInstances, setArrInstances] = useState<ArrInstance[]>(() => normalizeSetupArrInstances(storedPlex || {}));
    const [plexLibraries, setPlexLibraries] = useState<Array<{ id: string; title: string; type: string }>>([]);
    const [plexLibrariesLoading, setPlexLibrariesLoading] = useState(false);
    const [plexLibrariesError, setPlexLibrariesError] = useState('');
    const [tautulliUrl, setTautulliUrl] = useState(storedPlex?.tautulliUrl ?? '');
    const [tautulliApiKey, setTautulliApiKey] = useState(storedPlex?.tautulliApiKey ?? '');
    const [jellyfinAnalyticsProvider, setJellyfinAnalyticsProvider] = useState(storedPlex?.jellyfinAnalyticsProvider === 'jellystat' ? 'jellystat' : 'jellyglance');
    const [jellystatUrl, setJellystatUrl] = useState(storedPlex?.jellystatUrl ?? '');
    const [jellystatApiKey, setJellystatApiKey] = useState(storedPlex?.jellystatApiKey ?? '');
    const [jellyglanceUrl, setJellyglanceUrl] = useState(storedPlex?.jellyglanceUrl ?? '');
    const [jellyglanceApiKey, setJellyglanceApiKey] = useState(storedPlex?.jellyglanceApiKey ?? '');
    const [tmdbApiKey, setTmdbApiKey] = useState(storedPlex?.tmdbApiKey ?? '');
    const [requestSetupMode, setRequestSetupMode] = useState<RequestSetupMode>(
        storedPlex?.requestSetupMode === 'seerr' ? 'seerr' : 'portal',
    );
    const [migrateFromSeerr, setMigrateFromSeerr] = useState(!!storedPlex?.migrateFromSeerr);
    const [requestAppType, setRequestAppType] = useState(
        storedPlex?.requestAppType === 'jellyseerr' ? 'jellyseerr' : 'seerr',
    );
    const [requestAppUrl, setRequestAppUrl] = useState(storedPlex?.requestAppUrl ?? '');
    const [requestAppApiKey, setRequestAppApiKey] = useState(storedPlex?.requestAppApiKey ?? '');
    const [seerrImportBusy, setSeerrImportBusy] = useState(false);
    const [seerrImportSummary, setSeerrImportSummary] = useState<string | null>(null);
    const [seerrImportDone, setSeerrImportDone] = useState(false);
    const [integrationTab, setIntegrationTab] = useState<'arr' | 'requests' | 'analytics'>('arr');

    const stepIndex = STEPS.findIndex((s) => s.id === step);
    const canGoNext = step !== 'plex'
        || (mediaServerType !== 'plex'
            ? Boolean(jellyfinUrl && jellyfinApiKey)
            : Boolean(token && serverIdentifier));

    const applyBrandTheme = (theme: string) => {
        setBrandTheme(theme);
        if (BRAND_THEME_COLORS[theme]) {
            setPrimaryColor(BRAND_THEME_COLORS[theme]);
        }
    };

    const applyMediaServerType = (type: string) => {
        const nextType = type === 'emby' ? 'emby' : type === 'jellyfin' ? 'jellyfin' : 'plex';
        setMediaServerType(nextType);
        if (brandTheme === 'plex' || brandTheme === 'jellyfin' || brandTheme === 'emby') {
            applyBrandTheme(nextType);
        }
        if (requestSetupMode === 'seerr' || migrateFromSeerr) {
            setRequestAppType(nextType === 'jellyfin' || nextType === 'emby' ? 'jellyseerr' : 'seerr');
        }
    };

    useEffect(() => {
        document.documentElement.style.setProperty('--color-plex', hexToRgb(primaryColor));
        document.documentElement.style.setProperty('--color-plex-hover', accentHoverRgb(primaryColor));
    }, [primaryColor]);

    useEffect(() => {
        if (step !== 'integrations' || mediaServerType !== 'plex' || !token.trim() || !serverIdentifier.trim()) {
            setPlexLibraries([]);
            setPlexLibrariesError('');
            setPlexLibrariesLoading(false);
            return undefined;
        }

        let cancelled = false;
        setPlexLibrariesLoading(true);
        setPlexLibrariesError('');

        (async () => {
            try {
                const libs = await apiFetch('/api/plex/libraries', {
                    method: 'POST',
                    headers: setupAuthHeaders(setupToken),
                    body: JSON.stringify({
                        type: 'plex',
                        token: token.trim(),
                        serverIdentifier: serverIdentifier.trim(),
                        ...(plexServerUrl.trim() ? { plexServerUrl: plexServerUrl.trim() } : {}),
                        ...(setupToken ? { setupToken } : {}),
                    }),
                });
                if (cancelled) return;
                setPlexLibraries(Array.isArray(libs) ? libs : []);
            } catch (e) {
                if (cancelled) return;
                setPlexLibraries([]);
                setPlexLibrariesError(e instanceof Error ? e.message : 'Failed to load Plex libraries.');
            } finally {
                if (!cancelled) setPlexLibrariesLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [step, mediaServerType, token, serverIdentifier, plexServerUrl, setupToken]);

    // Only non-secret wizard state is persisted to sessionStorage (it survives the
    // Plex OAuth redirect). API keys and passwords stay in memory so they are never
    // written to browser storage in clear text; a reload means re-entering them.
    const persistSetupPlex = (patch: Partial<ReturnType<typeof readStoredSetupPlex>>) => {
        const next = {
            token,
            mediaServerType,
            servers,
            serverIdentifier,
            plexServerUrl,
            jellyfinUrl,
            username: plexUsername,
            step,
            publicDomain,
            brandTheme,
            primaryColor,
            customLogoUrl,
            smtpHost,
            smtpPort,
            smtpUser,
            smtpFrom,
            smtpSecure,
            gotifyUrl,
            gotifyToken,
            autoApproveMovies,
            autoApproveTv,
            requestQuotaLimit,
            requestQuotaDays,
            memberNavHiddenKeys,
            arrInstances: arrInstances.map((instance) => ({ ...instance, apiKey: '' })),
            tautulliUrl,
            jellyfinAnalyticsProvider,
            jellystatUrl,
            jellyglanceUrl,
            requestSetupMode,
            migrateFromSeerr,
            requestAppType,
            requestAppUrl,
            ...patch,
        };
        sessionStorage.setItem(SETUP_PLEX_STORAGE_KEY, JSON.stringify(next));
    };

    useEffect(() => {
        const path = stripBasePath(window.location.pathname);
        if (!path.startsWith('/auth/setup/')) return;

        const pinId = path.split('/').filter(Boolean).pop();
        if (!pinId || pinId === 'setup') return;

        const returnPath = sessionStorage.getItem('setupReturnPath') || portalUrl('/');

        setIsLoading(true);
        setError('');
        setStep('plex');

        apiFetch('/api/setup/plex/callback', {
            method: 'POST',
            headers: setupAuthHeaders(readSetupAccessToken()),
            body: JSON.stringify({
                pinId,
                ...(readSetupAccessToken() ? { setupToken: readSetupAccessToken() } : {}),
            }),
        }).then((data) => {
            const next = {
                token: data.token,
                servers: data.servers || [],
                serverIdentifier: data.servers?.[0]?.identifier || '',
                username: data.username || '',
                step: 'plex' as StepId,
            };
            sessionStorage.setItem(SETUP_PLEX_STORAGE_KEY, JSON.stringify(next));
            setToken(next.token);
            setServers(next.servers);
            setPlexUsername(next.username);
            setServerIdentifier(next.serverIdentifier);
        }).catch((e) => {
            setError(e instanceof Error ? e.message : 'Plex sign-in failed');
        }).finally(() => {
            sessionStorage.removeItem('setupReturnPath');
            window.history.replaceState({}, '', returnPath);
            setIsLoading(false);
        });
    }, []);

    const handlePlexSignIn = async () => {
        setIsLoading(true);
        setError('');
        try {
            sessionStorage.setItem('setupReturnPath', window.location.pathname + window.location.search);
            sessionStorage.setItem(SETUP_PLEX_STORAGE_KEY, JSON.stringify({ step: 'plex' }));
            const data = await apiFetch('/api/auth/plex/login', { method: 'POST' });
            const clientId = data.clientIdentifier || data.clientId || '';
            const forwardUrl = `${window.location.origin}${portalUrl(`/auth/setup/${data.id}`)}`;
            const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}&code=${data.code}&context[device][product]=StreamPilot&forwardUrl=${encodeURIComponent(forwardUrl)}`;
            window.location.href = authUrl;
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start Plex sign-in');
            setIsLoading(false);
        }
    };

    const handleFetchServers = async () => {
        if (!token) {
            setError('Please enter a Plex token first.');
            return;
        }
        setIsLoading(true);
        setError('');
        try {
            const foundServers = await apiFetch('/api/plex/servers', {
                method: 'POST',
                headers: setupAuthHeaders(setupToken),
                body: JSON.stringify({
                    token: token.trim(),
                    plexServerUrl: plexServerUrl || undefined,
                    ...(setupToken ? { setupToken } : {}),
                }),
            });
            setServers(foundServers);
            if (foundServers.length > 0) {
                setServerIdentifier(foundServers[0].identifier);
            } else {
                setError('No owned servers found for this token.');
                setServerIdentifier('');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch servers.');
            setServers([]);
            setServerIdentifier('');
        } finally {
            setIsLoading(false);
        }
    };

    const handleTestEmail = async () => {
        if (!smtpHost || !smtpUser || !smtpPass || !testRecipient) {
            setError('Fill in SMTP host, user, password, and test recipient.');
            return;
        }
        setIsLoading(true);
        setError('');
        try {
            await apiFetch('/api/config/test-email', {
                method: 'POST',
                headers: setupAuthHeaders(setupToken),
                body: JSON.stringify({ smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpSecure, testRecipient }),
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Test email failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleTestGotify = async () => {
        if (!gotifyUrl.trim() || !gotifyToken.trim()) {
            setError('Fill in Gotify URL and application token to send a test.');
            return;
        }
        setIsLoading(true);
        setError('');
        try {
            await apiFetch('/api/config/test-gotify', {
                method: 'POST',
                headers: setupAuthHeaders(setupToken),
                body: JSON.stringify({ gotifyUrl: gotifyUrl.trim(), gotifyToken: gotifyToken.trim() }),
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Gotify test failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleComplete = async () => {
        setIsLoading(true);
        setError('');
        try {
            let savedCustomLogoUrl = customLogoUrl;
            if (logoFile) {
                const uploadResponse = await fetch(portalUrl('/api/config/logo'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': logoFile.type || (logoFile.name.toLowerCase().endsWith('.png') ? 'image/png' : (logoFile.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')),
                        ...setupAuthHeaders(setupToken),
                    },
                    body: logoFile,
                });
                if (!uploadResponse.ok) {
                    const errorData = await uploadResponse.json().catch(() => ({ error: 'Logo upload failed.' }));
                    throw new Error(errorData.error || 'Logo upload failed.');
                }
                const uploadResult = await uploadResponse.json().catch(() => ({}));
                savedCustomLogoUrl = uploadResult.logoUrl || getUploadedLogoPath(logoFile);
            }
            await apiFetch('/api/config', {
                method: 'POST',
                headers: setupAuthHeaders(setupToken),
                body: JSON.stringify({
                    token: token.trim(),
                    mediaServerType,
                    serverIdentifier: serverIdentifier.trim(),
                    plexServerUrl: plexServerUrl || undefined,
                    jellyfinUrl,
                    jellyfinApiKey,
                    publicDomain,
                    primaryColor,
                    customLogoUrl: savedCustomLogoUrl,
                    brandingTheme: brandTheme === 'custom' ? 'plex' : brandTheme,
                    smtpHost,
                    smtpPort,
                    smtpUser,
                    smtpPass,
                    smtpFrom,
                    smtpSecure,
                    gotifyEnabled: Boolean(gotifyUrl.trim() && gotifyToken.trim()),
                    gotifyUrl: gotifyUrl.trim(),
                    gotifyToken: gotifyToken.trim(),
                    arrInstances,
                    tautulliUrl,
                    tautulliApiKey,
                    jellyfinAnalyticsProvider,
                    jellystatUrl,
                    jellystatApiKey,
                    jellyglanceUrl,
                    jellyglanceApiKey,
                    tmdbApiKey: requestSetupMode === 'portal' ? tmdbApiKey : (tmdbApiKey || ''),
                    requestEngine: requestSetupMode === 'seerr' ? 'seerr' : 'portal',
                    discoverySource: requestSetupMode === 'seerr' ? 'seerr' : 'tmdb',
                    requestAppType: (
                        requestSetupMode === 'seerr' || (migrateFromSeerr && requestAppUrl && requestAppApiKey)
                    ) && requestAppUrl && requestAppApiKey
                        ? requestAppType
                        : 'none',
                    requestAppUrl: (
                        requestSetupMode === 'seerr' || migrateFromSeerr
                    ) ? requestAppUrl : '',
                    requestAppApiKey: (
                        requestSetupMode === 'seerr' || migrateFromSeerr
                    ) ? requestAppApiKey : '',
                    ...(requestSetupMode === 'portal' ? {
                        autoApproveMovies,
                        autoApproveTv,
                        requestQuotaLimit: Math.max(0, Number(requestQuotaLimit) || 0),
                        requestQuotaDays: Math.max(1, Number(requestQuotaDays) || 7),
                    } : {}),
                    memberNavHiddenKeys,
                    downloadsVisibleToMembers: !memberNavHiddenKeys.includes('downloads'),
                    ...(setupToken ? { setupToken } : {}),
                }),
            });

            if (
                requestSetupMode === 'portal'
                && migrateFromSeerr
                && requestAppUrl
                && requestAppApiKey
                && !seerrImportDone
            ) {
                try {
                    const summary = await apiFetch('/api/setup/import-seerr', {
                        method: 'POST',
                        headers: setupAuthHeaders(setupToken),
                        body: JSON.stringify({
                            requestAppType,
                            requestAppUrl,
                            requestAppApiKey,
                            plexToken: token.trim(),
                            includeIssues: true,
                            includeBlocklist: true,
                            ...(setupToken ? { setupToken } : {}),
                        }),
                    });
                    const req = summary?.requests || {};
                    setSeerrImportSummary(
                        `Imported ${req.imported || 0} requests` +
                        (req.importedWithFallback ? ` (${req.importedWithFallback} under your account until members log in)` : '') +
                        `, ${summary?.issues?.imported || 0} issues` +
                        `, ${summary?.blocklist?.imported || 0} blocklist.`,
                    );
                    setSeerrImportDone(true);
                } catch (importError) {
                    // Config is already saved — surface import failure without blocking launch.
                    setError(
                        importError instanceof Error
                            ? `Portal saved, but Seerr import failed: ${importError.message}`
                            : 'Portal saved, but Seerr import failed. You can retry from Settings → Request.',
                    );
                    setIsLoading(false);
                    return;
                }
            }

            sessionStorage.removeItem(SETUP_PLEX_STORAGE_KEY);
            sessionStorage.removeItem('setupReturnPath');
            sessionStorage.removeItem(SETUP_TOKEN_STORAGE_KEY);
            onComplete();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save configuration.');
            setIsLoading(false);
        }
    };

    const goNext = () => {
        if (stepIndex < STEPS.length - 1) {
            const nextStep = STEPS[stepIndex + 1].id;
            setStep(nextStep);
            persistSetupPlex({ step: nextStep });
        }
    };
    const goBack = () => {
        if (stepIndex > 0) setStep(STEPS[stepIndex - 1].id);
    };

    const progressPct = Math.round(((stepIndex + 1) / STEPS.length) * 100);
    const inputClass = themeClasses.inputPremium;
    const labelClass = themeClasses.labelPremium;
    const primaryBtnClass = themeClasses.btnPrimary;
    const sectionCardClass = `${themeClasses.sectionCard} p-5 md:p-6`;

    const renderStepNav = (compact = false) => (
        STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = s.id === step;
            const done = i < stepIndex;
            return (
                <div
                    key={s.id}
                    className={`flex items-start gap-3 rounded-xl transition-all duration-300 ${compact ? 'flex-shrink-0 px-3 py-2' : 'p-3'} ${active ? 'bg-plex/10 border border-plex/25 shadow-[0_0_24px_rgba(229,160,13,0.12)]' : done ? 'opacity-90' : 'opacity-50'}`}
                >
                    <div className={`flex-shrink-0 rounded-full flex items-center justify-center border-2 transition-all ${compact ? 'w-8 h-8' : 'w-10 h-10'} ${active ? 'border-plex bg-plex/20 text-plex shadow-[0_0_18px_rgba(229,160,13,0.35)]' : done ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-white/10 bg-white/5 text-muted'}`}>
                        {done ? <Check className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> : <Icon className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
                    </div>
                    {!compact && (
                        <div className="min-w-0 pt-0.5">
                            <p className={`text-sm font-bold leading-tight ${active ? 'text-text' : done ? 'text-emerald-400/90' : 'text-muted'}`}>{s.label}</p>
                            <p className="text-xs text-muted/80 mt-0.5 leading-snug">{s.hint}</p>
                        </div>
                    )}
                    {compact && (
                        <span className={`text-xs font-bold whitespace-nowrap ${active ? 'text-plex' : done ? 'text-emerald-400' : 'text-muted'}`}>{s.label}</span>
                    )}
                </div>
            );
        })
    );

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-10 overflow-hidden">
            <AuthPageBackground />

            <div className="relative z-10 w-full max-w-6xl">
                <div className="glass-card-lg overflow-hidden flex flex-col lg:flex-row min-h-[min(720px,calc(100vh-3rem))]">
                    {/* Sidebar stepper — desktop */}
                    <aside className="hidden lg:flex flex-col w-[320px] xl:w-[360px] flex-shrink-0 border-r border-white/10 bg-gradient-to-b from-plex/[0.08] via-plex/[0.03] to-transparent p-8">
                        <div className="mb-8">
                            <div className="w-12 h-12 rounded-2xl bg-plex/15 border border-plex/30 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(229,160,13,0.2)]">
                                <Settings className="w-6 h-6 text-plex" />
                            </div>
                            <h1 className="text-xl font-black text-text tracking-tight leading-tight">StreamPilot</h1>
                            <p className="text-[11px] font-bold text-muted uppercase tracking-[0.2em] mt-2">Initial Setup</p>
                        </div>

                        <nav className="flex-1 space-y-1.5">{renderStepNav()}</nav>

                        <div className="mt-8 pt-6 border-t border-white/10">
                            <div className="flex justify-between text-xs font-semibold text-muted mb-2.5">
                                <span>Setup progress</span>
                                <span className="text-plex">{progressPct}%</span>
                            </div>
                            <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                <div
                                    className="h-full bg-gradient-to-r from-plex via-plex-hover to-plex rounded-full transition-all duration-500 ease-out shadow-plex/20 shadow-lg"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                            <p className="text-[11px] text-muted/70 mt-3">Step {stepIndex + 1} of {STEPS.length}</p>
                        </div>
                    </aside>

                    {/* Main panel */}
                    <div className="flex-1 flex flex-col min-h-0 min-w-0">
                        {/* Mobile / tablet step strip */}
                        <div className="lg:hidden border-b border-white/10 bg-black/20 px-4 py-4 overflow-x-auto">
                            <div className="flex items-center gap-2 min-w-max">{renderStepNav(true)}</div>
                            <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-plex to-plex-hover transition-all duration-500" style={{ width: `${progressPct}%` }} />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 sm:p-8 lg:p-10 xl:p-12">
                            {error && (
                                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 mb-6 text-sm flex items-start gap-3">
                                    <span className="text-red-400 flex-shrink-0 mt-0.5">⚠</span>
                                    <span>{error}</span>
                                </div>
                            )}

                            {step === 'welcome' && (
                                <div>
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-plex/10 border border-plex/25 text-plex text-[11px] font-bold uppercase tracking-widest mb-5">
                                        <Sparkles className="w-3.5 h-3.5" /> First-time setup
                                    </div>
                                    <h2 className="text-3xl sm:text-4xl font-black text-text tracking-tight mb-3 leading-tight">
                                        Welcome to your<br className="hidden sm:block" /> media portal
                                    </h2>
                                    <p className="text-muted text-base sm:text-lg leading-relaxed mb-8 max-w-xl">
                                        A guided setup to connect Plex, Jellyfin, or Emby and brand your portal. Notifications, the media stack, request quotas, and member pages are all optional — skip anything you don&apos;t have yet.
                                    </p>
                                    <div className="grid sm:grid-cols-2 gap-3 mb-2">
                                        {WELCOME_FEATURES.map(({ icon: Icon, title, desc }) => (
                                            <div key={title} className={`${sectionCardClass} flex gap-3.5 items-start hover:border-plex/20 transition-colors`}>
                                                <div className="w-11 h-11 rounded-xl bg-plex/10 border border-plex/20 flex items-center justify-center flex-shrink-0">
                                                    <Icon className="w-5 h-5 text-plex" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-text text-sm">{title}</p>
                                                    <p className="text-xs text-muted mt-1 leading-relaxed">{desc}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                    {step === 'plex' && (
                        <div className="flex flex-col gap-6 max-w-2xl">
                            <div>
                                <p className={labelClass + ' mb-2'}>Step {stepIndex + 1}</p>
                                <h2 className="text-2xl sm:text-3xl font-black text-text tracking-tight mb-2">Media Server Connection</h2>
                                <p className="text-muted text-sm sm:text-base leading-relaxed">Choose and connect the media server that will back this portal.</p>
                            </div>

                            <div className={`${sectionCardClass} flex flex-col gap-4`}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {MEDIA_SERVER_OPTIONS.map((option) => {
                                        const selected = mediaServerType === option.value;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => applyMediaServerType(option.value)}
                                                className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${
                                                    selected
                                                        ? 'border-plex/50 bg-plex/10 text-text'
                                                        : 'border-white/10 bg-white/[0.03] text-muted hover:border-white/20 hover:bg-white/[0.06]'
                                                }`}
                                            >
                                                <span className="w-12 h-12 rounded-xl bg-background border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                                    <img
                                                        src={MEDIA_SERVER_LOGOS[option.value]}
                                                        alt=""
                                                        className="w-8 h-8 object-contain"
                                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                    />
                                                </span>
                                                <span className="min-w-0">
                                                    <span className={`block text-sm font-black ${selected ? 'text-plex' : 'text-text'}`}>{option.label}</span>
                                                    <span className="block text-xs text-muted mt-1">
                                                        {option.value === 'plex' ? 'Connect through Plex OAuth' : `Connect with ${option.label} API key`}
                                                    </span>
                                                </span>
                                                {selected && <Check className="w-5 h-5 text-plex ml-auto shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                                {mediaServerType !== 'plex' && (
                                    <>
                                        <div className="flex flex-col gap-2.5">
                                            <label className={labelClass}>{mediaServerType === 'emby' ? 'Emby' : 'Jellyfin'} URL</label>
                                            <input type="url" className={inputClass} value={jellyfinUrl} onChange={(e) => setJellyfinUrl(e.target.value)} placeholder="http://192.168.1.6:8096" />
                                        </div>
                                        <div className="flex flex-col gap-2.5">
                                            <label className={labelClass}>{mediaServerType === 'emby' ? 'Emby' : 'Jellyfin'} API Key</label>
                                            <input type="password" className={inputClass} value={jellyfinApiKey} onChange={(e) => setJellyfinApiKey(e.target.value)} placeholder={`API key from ${mediaServerType === 'emby' ? 'Emby' : 'Jellyfin'} dashboard`} />
                                        </div>
                                        <IntegrationTestButton type={mediaServerType === 'emby' ? 'emby' : 'jellyfin'} payload={{ jellyfinUrl, jellyfinApiKey }} disabled={!jellyfinUrl || !jellyfinApiKey} />
                                    </>
                                )}
                            </div>

                            {mediaServerType === 'plex' && (!token ? (
                                <div className={`${sectionCardClass} flex flex-col gap-4`}>
                                    <button
                                        type="button"
                                        onClick={handlePlexSignIn}
                                        disabled={isLoading}
                                        className={`${primaryBtnClass} w-full sm:w-auto text-base py-4`}
                                    >
                                        <img src={PLEX_ICON_URL} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                        {isLoading ? 'Redirecting to Plex…' : 'Sign in with Plex'}
                                    </button>
                                    <p className="text-xs text-muted leading-relaxed">Uses secure Plex OAuth — we&apos;ll fetch your owned servers automatically. No password stored.</p>
                                </div>
                            ) : (
                                <div className="p-4 sm:p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center gap-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                                    <div className="w-11 h-11 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                                        <Check className="w-5 h-5 text-emerald-400" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-emerald-400 font-bold">Signed in as {plexUsername || 'Plex User'}</p>
                                        <p className="text-muted text-sm mt-0.5">{servers.length} owned server{servers.length !== 1 ? 's' : ''} found</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setToken('');
                                            setServers([]);
                                            setServerIdentifier('');
                                            setPlexUsername('');
                                            sessionStorage.removeItem(SETUP_PLEX_STORAGE_KEY);
                                        }}
                                        className="text-xs font-semibold text-muted hover:text-text px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors flex-shrink-0"
                                    >
                                        Sign out
                                    </button>
                                </div>
                            ))}

                            {mediaServerType === 'plex' && (servers.length > 0 ? (
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>Select Server</label>
                                    <CustomSelect value={serverIdentifier} onChange={setServerIdentifier} options={servers.map((s) => ({ label: `${s.name} (${s.identifier})`, value: s.identifier }))} />
                                </div>
                            ) : token ? (
                                <div className={`${sectionCardClass} flex flex-col gap-4`}>
                                    <div className="flex flex-col gap-2.5">
                                        <label className={labelClass}>Server Identifier</label>
                                        <input type="text" className={inputClass} value={serverIdentifier} onChange={(e) => setServerIdentifier(e.target.value)} placeholder="No servers returned — enter identifier manually" />
                                    </div>
                                    <div className="text-xs text-muted p-4 rounded-xl bg-background/50 border border-white/5 space-y-1.5 leading-relaxed">
                                        <p className="font-semibold text-text">How to find Server Identifier manually:</p>
                                        <p>1) Open: <code className="bg-background px-1.5 py-0.5 rounded text-plex/90">http://YOUR_PLEX_IP:32400/identity?X-Plex-Token=YOUR_TOKEN</code></p>
                                        <p>2) Copy <code className="bg-background px-1.5 py-0.5 rounded">machineIdentifier</code> from the response.</p>
                                    </div>
                                </div>
                            ) : null)}

                            {mediaServerType === 'plex' && <div className="flex flex-col gap-2.5">
                                <label className={labelClass}>
                                    Direct Plex URL <span className="text-muted/70 font-normal normal-case tracking-normal">(required in Docker)</span>
                                </label>
                                <input
                                    type="url"
                                    className={inputClass}
                                    value={plexServerUrl}
                                    onChange={(e) => setPlexServerUrl(e.target.value)}
                                    placeholder="http://192.168.1.6:32400"
                                />
                                <p className="text-xs text-muted leading-relaxed">Your Plex server&apos;s LAN address. Required when Plex.tv discovery fails from inside the container.</p>
                            </div>}

                            {mediaServerType === 'plex' && <IntegrationTestButton
                                type="plex"
                                payload={{ token, serverIdentifier, plexServerUrl: plexServerUrl || undefined }}
                                disabled={!token || !serverIdentifier}
                            />}

                            {mediaServerType === 'plex' && <div className="border-t border-white/10 pt-5">
                                <button
                                    type="button"
                                    onClick={() => setShowManualToken(!showManualToken)}
                                    className="text-sm font-semibold text-muted hover:text-plex transition-colors"
                                >
                                    {showManualToken ? '▾ Hide manual token entry' : '▸ Enter Plex token manually'}
                                </button>
                                {showManualToken && (
                                    <div className={`${sectionCardClass} mt-4 flex flex-col gap-4`}>
                                        <div className="p-4 bg-plex/5 border border-plex/20 rounded-xl text-sm text-muted leading-relaxed">
                                            <strong className="text-plex">Tip:</strong> Log into Plex Web, open any library item XML, and find <code className="bg-background px-1.5 py-0.5 rounded">X-Plex-Token=...</code> in the URL.
                                        </div>
                                        <div className="flex flex-col gap-2.5">
                                            <label className={labelClass}>Plex Token</label>
                                            <div className="flex flex-col sm:flex-row gap-2">
                                                <input type="password" className={inputClass} value={token} onChange={(e) => setToken(e.target.value)} placeholder="X-Plex-Token" />
                                                <button type="button" onClick={handleFetchServers} disabled={isLoading || !token} className="px-5 py-3.5 bg-plex/15 text-plex border border-plex/30 rounded-xl font-bold hover:bg-plex/25 whitespace-nowrap transition-colors disabled:opacity-50">
                                                    Fetch Servers
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>}
                        </div>
                    )}

                    {step === 'branding' && (
                        <div className="flex flex-col gap-6 max-w-2xl">
                            <div>
                                <p className={labelClass + ' mb-2'}>Step {stepIndex + 1}</p>
                                <h2 className="text-2xl sm:text-3xl font-black text-text tracking-tight mb-2">Portal Branding</h2>
                                <p className="text-muted text-sm sm:text-base">How your portal looks to users. You can change these anytime in Settings.</p>
                            </div>
                            <div className={`${sectionCardClass} flex flex-col gap-5`}>
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>Public Base URL</label>
                                    <input type="text" className={inputClass} value={publicDomain} onChange={(e) => setPublicDomain(e.target.value)} placeholder="https://portal.yourdomain.com" />
                                    <p className="text-xs text-muted mt-1.5">Used for invite emails and shareable portal links. Include a subpath when hosted under one.</p>
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>Theme</label>
                                    <CustomSelect value={brandTheme} onChange={applyBrandTheme} options={BRAND_THEME_OPTIONS} />
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>Primary Color</label>
                                    <div className="flex gap-3 items-center">
                                        <input
                                            type="color"
                                            value={primaryColor}
                                            onChange={(e) => {
                                                setBrandTheme('custom');
                                                setPrimaryColor(e.target.value);
                                            }}
                                            className="w-14 h-14 rounded-xl border border-white/10 cursor-pointer bg-transparent flex-shrink-0"
                                        />
                                        <input
                                            type="text"
                                            className={inputClass}
                                            value={primaryColor}
                                            onChange={(e) => {
                                                setBrandTheme('custom');
                                                setPrimaryColor(e.target.value);
                                            }}
                                            placeholder="#F7C600"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>Custom Logo URL (optional)</label>
                                    <input type="text" className={inputClass} value={customLogoUrl} onChange={(e) => setCustomLogoUrl(e.target.value)} placeholder="https://… or /static/logo.png" />
                                    <div className="flex items-center gap-3">
                                        <label className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-text text-sm font-bold cursor-pointer transition-colors">
                                            <Upload className="w-4 h-4" />
                                            Upload Logo
                                            <input
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp"
                                                className="sr-only"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0] || null;
                                                    setLogoFile(file);
                                                    if (file) setCustomLogoUrl(getUploadedLogoPath(file));
                                                }}
                                            />
                                        </label>
                                        <span className="min-w-0 truncate text-xs text-muted">
                                            {logoFile ? logoFile.name : 'PNG, JPEG, or WebP, max 5MB'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'notifications' && (
                        <div className="flex flex-col gap-6 max-w-2xl">
                            <div>
                                <p className={labelClass + ' mb-2'}>Step {stepIndex + 1}</p>
                                <h2 className="text-2xl sm:text-3xl font-black text-text tracking-tight mb-2">Notifications</h2>
                                <p className="text-muted text-sm sm:text-base">Optional — skip this whole step if you&apos;ll configure alerts later in Settings.</p>
                            </div>
                            <div className={`${sectionCardClass} grid grid-cols-1 md:grid-cols-2 gap-5`}>
                                <div className="md:col-span-2 flex items-center gap-3">
                                    <Mail className="w-5 h-5 text-plex flex-shrink-0" />
                                    <div>
                                        <h3 className="font-bold text-text text-base leading-tight">Email (SMTP)</h3>
                                        <p className="text-xs text-muted mt-0.5">Expiry reminders and newsletters. Leave blank to skip.</p>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2.5 md:col-span-2">
                                    <label className={labelClass}>SMTP Host</label>
                                    <input type="text" className={inputClass} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.mailgun.org" />
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>Port</label>
                                    <input type="number" className={inputClass} value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>Secure (TLS)</label>
                                    <label className="flex items-center gap-3 cursor-pointer mt-1 p-3.5 rounded-xl bg-background/50 border border-white/5">
                                        <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} className="w-4 h-4 accent-plex" />
                                        <span className="text-sm text-text font-medium">Use SSL/TLS</span>
                                    </label>
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>SMTP User</label>
                                    <input type="text" className={inputClass} value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    <label className={labelClass}>SMTP Password</label>
                                    <input type="password" className={inputClass} value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
                                </div>
                                <div className="flex flex-col gap-2.5 md:col-span-2">
                                    <label className={labelClass}>From Address</label>
                                    <input type="text" className={inputClass} value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="Plex Server &lt;noreply@domain.com&gt;" />
                                </div>
                            </div>
                            {smtpHost && smtpUser && smtpPass && (
                                <div className={`${sectionCardClass} flex flex-col gap-3`}>
                                    <label className={labelClass}>Send Test Email</label>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <input type="email" className={inputClass} value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} placeholder="you@example.com" />
                                        <button type="button" onClick={handleTestEmail} disabled={isLoading} className="px-5 py-3.5 bg-white/5 border border-white/10 text-text rounded-xl font-bold hover:bg-white/10 whitespace-nowrap transition-colors disabled:opacity-50">
                                            Send Test
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div className={`${sectionCardClass} grid grid-cols-1 md:grid-cols-2 gap-5`}>
                                <div className="md:col-span-2 flex items-center gap-3">
                                    <ProgramIcon app="gotify" label="Gotify" />
                                    <div>
                                        <h3 className="font-bold text-text text-base leading-tight">Gotify</h3>
                                        <p className="text-xs text-muted mt-0.5">Admin push alerts. Leave blank to skip — Gotify stays off until both fields are filled.</p>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2.5 md:col-span-2">
                                    <label className={labelClass}>Gotify URL</label>
                                    <input type="text" className={inputClass} value={gotifyUrl} onChange={(e) => setGotifyUrl(e.target.value)} placeholder="https://gotify.example.com" />
                                </div>
                                <div className="flex flex-col gap-2.5 md:col-span-2">
                                    <label className={labelClass}>Application Token</label>
                                    <input type="password" className={inputClass} value={gotifyToken} onChange={(e) => setGotifyToken(e.target.value)} placeholder="App token" autoComplete="off" />
                                </div>
                                {gotifyUrl.trim() && gotifyToken.trim() && (
                                    <div className="md:col-span-2">
                                        <button type="button" onClick={handleTestGotify} disabled={isLoading} className="px-5 py-3.5 bg-white/5 border border-white/10 text-text rounded-xl font-bold hover:bg-white/10 whitespace-nowrap transition-colors disabled:opacity-50">
                                            Send Test Alert
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {step === 'integrations' && (
                        <div className="flex flex-col gap-5 max-w-4xl">
                            <div>
                                <p className={labelClass + ' mb-2'}>Step {stepIndex + 1}</p>
                                <h2 className="text-2xl sm:text-3xl font-black text-text tracking-tight mb-2">Media Stack</h2>
                                <p className="text-muted text-sm sm:text-base">All optional. Skip this step if you don&apos;t have Arr apps, TMDB, or analytics yet — you can add them later in Settings.</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-background/50 p-1.5">
                                {[
                                    { id: 'arr' as const, label: 'Arr Apps' },
                                    { id: 'requests' as const, label: 'Requests' },
                                    { id: 'analytics' as const, label: mediaServerType !== 'plex' ? 'Analytics' : 'Tautulli' },
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setIntegrationTab(tab.id)}
                                        className={`px-3 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${integrationTab === tab.id ? 'bg-plex text-background shadow-lg shadow-plex/20' : 'text-muted hover:text-text hover:bg-white/5'}`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {integrationTab === 'arr' && (
                                <div className="space-y-8">
                                    {mediaServerType === 'plex' && (
                                        <div className="rounded-xl border border-border bg-white/[0.03] px-4 py-3 text-sm text-muted">
                                            {plexLibrariesLoading ? (
                                                <p>Loading Plex libraries for Sonarr/Radarr mapping…</p>
                                            ) : plexLibrariesError ? (
                                                <p className="text-amber-200">
                                                    Could not load Plex libraries ({plexLibrariesError}). You can map them later in Settings → Integrations.
                                                </p>
                                            ) : plexLibraries.length > 0 ? (
                                                <p>
                                                    Map TV libraries to Sonarr and movie libraries to Radarr below. Unmapped libraries use the default instance — same as Settings.
                                                </p>
                                            ) : (
                                                <p>No Plex libraries found yet. You can map them later in Settings → Integrations.</p>
                                            )}
                                        </div>
                                    )}
                                    {mediaServerType !== 'plex' && (
                                        <div className="rounded-xl border border-border bg-white/[0.03] px-4 py-3 text-sm text-muted">
                                            Library mapping during setup is available for Plex. Jellyfin/Emby Arr routing can be adjusted later in Settings if needed.
                                        </div>
                                    )}
                                    <ArrInstancesPanel
                                        type="sonarr"
                                        title="Sonarr Instances"
                                        subtitle="TV series automation"
                                        instances={arrInstances.filter((entry) => entry.type === 'sonarr')}
                                        savedInstances={arrInstances.filter((entry) => entry.type === 'sonarr')}
                                        libraries={plexLibraries}
                                        allInstances={arrInstances}
                                        onChange={(nextSonarr) => {
                                            const other = arrInstances.filter((entry) => entry.type !== 'sonarr');
                                            setArrInstances([...other, ...nextSonarr]);
                                        }}
                                        onMessage={(msg, ok) => setError(ok ? '' : msg)}
                                    />
                                    <ArrInstancesPanel
                                        type="radarr"
                                        title="Radarr Instances"
                                        subtitle="Movie automation"
                                        instances={arrInstances.filter((entry) => entry.type === 'radarr')}
                                        savedInstances={arrInstances.filter((entry) => entry.type === 'radarr')}
                                        libraries={plexLibraries}
                                        allInstances={arrInstances}
                                        onChange={(nextRadarr) => {
                                            const other = arrInstances.filter((entry) => entry.type !== 'radarr');
                                            setArrInstances([...other, ...nextRadarr]);
                                        }}
                                        onMessage={(msg, ok) => setError(ok ? '' : msg)}
                                    />
                                    <ArrInstancesPanel
                                        type="lidarr"
                                        title="Lidarr Instances"
                                        subtitle="Music automation"
                                        instances={arrInstances.filter((entry) => entry.type === 'lidarr')}
                                        savedInstances={arrInstances.filter((entry) => entry.type === 'lidarr')}
                                        allInstances={arrInstances}
                                        onChange={(nextLidarr) => {
                                            const other = arrInstances.filter((entry) => entry.type !== 'lidarr');
                                            setArrInstances([...other, ...nextLidarr]);
                                        }}
                                        onMessage={(msg, ok) => setError(ok ? '' : msg)}
                                    />
                                    <ArrInstancesPanel
                                        type="bazarr"
                                        title="Bazarr Instances"
                                        subtitle="Subtitle automation"
                                        instances={arrInstances.filter((entry) => entry.type === 'bazarr')}
                                        savedInstances={arrInstances.filter((entry) => entry.type === 'bazarr')}
                                        allInstances={arrInstances}
                                        onChange={(nextBazarr) => {
                                            const other = arrInstances.filter((entry) => entry.type !== 'bazarr');
                                            setArrInstances([...other, ...nextBazarr]);
                                        }}
                                        onMessage={(msg, ok) => setError(ok ? '' : msg)}
                                    />
                                </div>
                            )}

                            {integrationTab === 'requests' && (
                                <div className={`${sectionCardClass} flex flex-col gap-3.5`}>
                                    <div>
                                        <h3 className="font-bold text-text text-base leading-tight">How should members request media?</h3>
                                        <p className="text-xs text-muted mt-1">
                                            Choose the built-in portal engine, or connect Seerr / Jellyseerr. You can change this later in Settings.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setRequestSetupMode('portal');
                                                persistSetupPlex({ requestSetupMode: 'portal' });
                                            }}
                                            className={`text-left rounded-xl border p-4 transition-colors ${
                                                requestSetupMode === 'portal'
                                                    ? 'border-plex/50 bg-plex/10 ring-1 ring-plex/30'
                                                    : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 mb-2">
                                                <ProgramIcon app="tmdb" label="TMDB" />
                                                <span className="font-bold text-text text-sm">Built-in (Portal)</span>
                                            </div>
                                            <p className="text-[11px] text-muted leading-relaxed">
                                                Discover &amp; Request in the portal. Needs TMDB + Sonarr/Radarr. No Seerr required.
                                            </p>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setRequestSetupMode('seerr');
                                                setMigrateFromSeerr(false);
                                                const nextType = mediaServerType === 'jellyfin' || mediaServerType === 'emby'
                                                    ? 'jellyseerr'
                                                    : 'seerr';
                                                setRequestAppType(nextType);
                                                persistSetupPlex({ requestSetupMode: 'seerr', migrateFromSeerr: false, requestAppType: nextType });
                                            }}
                                            className={`text-left rounded-xl border p-4 transition-colors ${
                                                requestSetupMode === 'seerr'
                                                    ? 'border-plex/50 bg-plex/10 ring-1 ring-plex/30'
                                                    : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 mb-2">
                                                <ProgramIcon app={requestAppType === 'jellyseerr' ? 'jellyseerr' : 'seerr'} label="Seerr" />
                                                <span className="font-bold text-text text-sm">Seerr / Jellyseerr</span>
                                            </div>
                                            <p className="text-[11px] text-muted leading-relaxed">
                                                Keep using your existing request app for queue, quotas, and approvals.
                                            </p>
                                        </button>
                                    </div>

                                    {requestSetupMode === 'portal' && (
                                        <>
                                            <div>
                                                <label className={labelClass}>TMDB API Key</label>
                                                <input
                                                    type="password"
                                                    className={inputClass}
                                                    value={tmdbApiKey}
                                                    onChange={(e) => setTmdbApiKey(e.target.value)}
                                                    placeholder="Paste key to enable Discover posters &amp; search"
                                                    autoComplete="off"
                                                />
                                                <p className="text-[11px] text-muted mt-1.5">
                                                    Free from{' '}
                                                    <a
                                                        href="https://www.themoviedb.org/settings/api"
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-plex hover:underline"
                                                    >
                                                        themoviedb.org/settings/api
                                                    </a>
                                                    . You can skip this and add it later in Settings, but Discover will be empty until then.
                                                </p>
                                                <div className="mt-2">
                                                    <IntegrationTestButton
                                                        type="tmdb"
                                                        payload={{ tmdbApiKey }}
                                                        disabled={!String(tmdbApiKey || '').trim()}
                                                    />
                                                </div>
                                            </div>

                                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
                                                <div>
                                                    <h4 className="text-sm font-bold text-text">Auto-approve &amp; quotas</h4>
                                                    <p className="text-xs text-muted mt-0.5">Optional. Leave these off / at 0 for manual review and unlimited requests. You can change them later in Settings → Request.</p>
                                                </div>
                                                <label className="flex items-start gap-3 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="mt-1 accent-plex"
                                                        checked={autoApproveMovies}
                                                        onChange={(e) => setAutoApproveMovies(e.target.checked)}
                                                    />
                                                    <span>
                                                        <span className="block text-sm font-bold text-text">Auto-approve movies</span>
                                                        <span className="block text-xs text-muted mt-0.5">Send movie requests straight to Radarr without Review Queue.</span>
                                                    </span>
                                                </label>
                                                <label className="flex items-start gap-3 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="mt-1 accent-plex"
                                                        checked={autoApproveTv}
                                                        onChange={(e) => setAutoApproveTv(e.target.checked)}
                                                    />
                                                    <span>
                                                        <span className="block text-sm font-bold text-text">Auto-approve series</span>
                                                        <span className="block text-xs text-muted mt-0.5">Send TV requests straight to Sonarr without Review Queue.</span>
                                                    </span>
                                                </label>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="flex flex-col gap-2">
                                                        <label className={labelClass}>Request quota</label>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            className={inputClass}
                                                            value={requestQuotaLimit}
                                                            onChange={(e) => setRequestQuotaLimit(Math.max(0, Number(e.target.value) || 0))}
                                                            placeholder="0"
                                                        />
                                                        <p className="text-[11px] text-muted">0 = unlimited</p>
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        <label className={labelClass}>Quota window (days)</label>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            className={inputClass}
                                                            value={requestQuotaDays}
                                                            onChange={(e) => setRequestQuotaDays(Math.max(1, Number(e.target.value) || 7))}
                                                        />
                                                        <p className="text-[11px] text-muted">Rolling window for member requests</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                                                <label className="flex items-start gap-3 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="mt-1 accent-plex"
                                                        checked={migrateFromSeerr}
                                                        onChange={(e) => setMigrateFromSeerr(e.target.checked)}
                                                    />
                                                    <span>
                                                        <span className="block text-sm font-bold text-text">Coming from Seerr / Jellyseerr?</span>
                                                        <span className="block text-xs text-muted mt-0.5">
                                                            Optional one-time import of requests, issues, and blocklist into the portal.
                                                        </span>
                                                    </span>
                                                </label>
                                                {migrateFromSeerr && (
                                                    <>
                                                        <div className="flex items-center gap-3">
                                                            <ProgramIcon app={requestAppType} label="Seerr" />
                                                            <CustomSelect
                                                                value={requestAppType}
                                                                onChange={setRequestAppType}
                                                                options={MIGRATE_SEERR_OPTIONS}
                                                            />
                                                        </div>
                                                        <input
                                                            type="text"
                                                            className={inputClass}
                                                            value={requestAppUrl}
                                                            onChange={(e) => setRequestAppUrl(e.target.value)}
                                                            placeholder="http://localhost:5055"
                                                        />
                                                        <input
                                                            type="password"
                                                            className={inputClass}
                                                            value={requestAppApiKey}
                                                            onChange={(e) => setRequestAppApiKey(e.target.value)}
                                                            placeholder="API Key"
                                                        />
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <IntegrationTestButton
                                                                type="requestApp"
                                                                payload={{ requestAppType, requestAppUrl, requestAppApiKey }}
                                                                disabled={!requestAppUrl || !requestAppApiKey}
                                                            />
                                                            <button
                                                                type="button"
                                                                disabled={seerrImportBusy || !requestAppUrl || !requestAppApiKey}
                                                                onClick={async () => {
                                                                    setSeerrImportBusy(true);
                                                                    setSeerrImportSummary(null);
                                                                    setError('');
                                                                    try {
                                                                        const summary = await apiFetch('/api/setup/import-seerr', {
                                                                            method: 'POST',
                                                                            headers: setupAuthHeaders(setupToken),
                                                                            body: JSON.stringify({
                                                                                requestAppType,
                                                                                requestAppUrl,
                                                                                requestAppApiKey,
                                                                                plexToken: token.trim(),
                                                                                includeIssues: true,
                                                                                includeBlocklist: true,
                                                                                ...(setupToken ? { setupToken } : {}),
                                                                            }),
                                                                        });
                                                                        const req = summary?.requests || {};
                                                                        setSeerrImportSummary(
                                                                            `Imported ${req.imported || 0} requests` +
                                                                            (req.importedWithFallback ? ` (${req.importedWithFallback} labeled under your name until members sign in)` : '') +
                                                                            `, ${summary?.issues?.imported || 0} issues` +
                                                                            `, ${summary?.blocklist?.imported || 0} blocklist.`,
                                                                        );
                                                                        setSeerrImportDone(true);
                                                                    } catch (e) {
                                                                        setError(e instanceof Error ? e.message : 'Seerr import failed');
                                                                    } finally {
                                                                        setSeerrImportBusy(false);
                                                                    }
                                                                }}
                                                                className="inline-flex items-center rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                                                            >
                                                                {seerrImportBusy ? 'Importing…' : 'Import now'}
                                                            </button>
                                                        </div>
                                                        {seerrImportSummary && (
                                                            <p className="text-xs text-emerald-300/90">{seerrImportSummary}</p>
                                                        )}
                                                        <p className="text-[11px] text-muted">
                                                            If a Seerr user isn&apos;t in the portal yet, their imported request history is temporarily labeled under your name for display only — it does not grant them access or permissions. Re-run import from Settings after they sign in to attribute correctly.
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                        </>
                                    )}

                                    {requestSetupMode === 'seerr' && (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-3">
                                                <ProgramIcon app={requestAppType} label="Seerr" />
                                                <CustomSelect
                                                    value={requestAppType}
                                                    onChange={setRequestAppType}
                                                    options={MIGRATE_SEERR_OPTIONS}
                                                />
                                            </div>
                                            <input
                                                type="text"
                                                className={inputClass}
                                                value={requestAppUrl}
                                                onChange={(e) => setRequestAppUrl(e.target.value)}
                                                placeholder="http://localhost:5055"
                                            />
                                            <input
                                                type="password"
                                                className={inputClass}
                                                value={requestAppApiKey}
                                                onChange={(e) => setRequestAppApiKey(e.target.value)}
                                                placeholder="API Key"
                                            />
                                            <IntegrationTestButton
                                                type="requestApp"
                                                payload={{ requestAppType, requestAppUrl, requestAppApiKey }}
                                                disabled={!requestAppUrl || !requestAppApiKey}
                                            />
                                            <p className="text-[11px] text-muted">
                                                Quotas, permissions, and auto-approve stay in Seerr. Connect Sonarr/Radarr there as usual. You can switch to the built-in portal engine later in Settings.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {integrationTab === 'analytics' && (
                                <div className={`${sectionCardClass} flex flex-col gap-3.5`}>
                                    {mediaServerType !== 'plex' ? (
                                        <>
                                            <div className="flex items-center gap-3">
                                                <ProgramIcon app={jellyfinAnalyticsProvider} label={jellyfinAnalyticsProvider === 'jellyglance' ? 'JellyGlance' : 'Jellystat'} />
                                                <div>
                                                    <h3 className="font-bold text-text text-base leading-tight">{jellyfinAnalyticsProvider === 'jellyglance' ? 'JellyGlance' : 'Jellystat'}</h3>
                                                    <p className="text-xs text-muted mt-0.5">Jellyfin activity and analytics.</p>
                                                </div>
                                            </div>
                                            <CustomSelect value={jellyfinAnalyticsProvider} onChange={setJellyfinAnalyticsProvider} options={JELLYFIN_ANALYTICS_OPTIONS} />
                                            {jellyfinAnalyticsProvider === 'jellyglance' ? (
                                                <>
                                                    <input type="text" className={inputClass} value={jellyglanceUrl} onChange={(e) => setJellyglanceUrl(e.target.value)} placeholder="http://localhost:3000" />
                                                    <input type="password" className={inputClass} value={jellyglanceApiKey} onChange={(e) => setJellyglanceApiKey(e.target.value)} placeholder="API Key" />
                                                    <IntegrationTestButton type="jellyglance" payload={{ jellyglanceUrl, jellyglanceApiKey }} disabled={!jellyglanceUrl || !jellyglanceApiKey} />
                                                </>
                                            ) : (
                                                <>
                                                    <input type="text" className={inputClass} value={jellystatUrl} onChange={(e) => setJellystatUrl(e.target.value)} placeholder="http://localhost:3000" />
                                                    <input type="password" className={inputClass} value={jellystatApiKey} onChange={(e) => setJellystatApiKey(e.target.value)} placeholder="API Key" />
                                                    <IntegrationTestButton type="jellystat" payload={{ jellystatUrl, jellystatApiKey }} disabled={!jellystatUrl || !jellystatApiKey} />
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-3">
                                                <ProgramIcon app="tautulli" label="Tautulli" />
                                                <div>
                                                    <h3 className="font-bold text-text text-base leading-tight">Tautulli</h3>
                                                    <p className="text-xs text-muted mt-0.5">Plex activity and analytics.</p>
                                                </div>
                                            </div>
                                            <input type="text" className={inputClass} value={tautulliUrl} onChange={(e) => setTautulliUrl(e.target.value)} placeholder="http://localhost:8181" />
                                            <input type="password" className={inputClass} value={tautulliApiKey} onChange={(e) => setTautulliApiKey(e.target.value)} placeholder="API Key" />
                                            <IntegrationTestButton type="tautulli" payload={{ tautulliUrl, tautulliApiKey }} disabled={!tautulliUrl || !tautulliApiKey} />
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 'members' && (
                        <div className="flex flex-col gap-6 max-w-2xl">
                            <div>
                                <p className={labelClass + ' mb-2'}>Step {stepIndex + 1}</p>
                                <h2 className="text-2xl sm:text-3xl font-black text-text tracking-tight mb-2">Member pages</h2>
                                <p className="text-muted text-sm sm:text-base">
                                    Optional — leave everything on for the usual member sidebar, or uncheck pages you don&apos;t want members to see yet. Home stays visible. You can change this anytime in Settings → Layout.
                                </p>
                            </div>
                            <div className={`${sectionCardClass} grid grid-cols-1 sm:grid-cols-2 gap-2`}>
                                {SETUP_MEMBER_NAV_TOGGLES.map((key) => {
                                    const visible = !memberNavHiddenKeys.includes(key);
                                    return (
                                        <label
                                            key={key}
                                            className="flex items-start gap-3 cursor-pointer p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/15 transition-colors"
                                        >
                                            <input
                                                type="checkbox"
                                                className="mt-1 accent-plex"
                                                checked={visible}
                                                onChange={(e) => {
                                                    const nextVisible = e.target.checked;
                                                    setMemberNavHiddenKeys((prev) => {
                                                        const next = new Set(prev);
                                                        if (nextVisible) next.delete(key);
                                                        else next.add(key);
                                                        return Array.from(next);
                                                    });
                                                }}
                                            />
                                            <span>
                                                <span className="block text-sm font-bold text-text">{NAV_ITEM_LABELS[key] || key}</span>
                                                <span className="block text-[11px] text-muted mt-0.5">{visible ? 'Shown to members' : 'Hidden from members'}</span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {step === 'finish' && (
                        <div className="max-w-lg mx-auto text-center py-4">
                            <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-emerald-500/30 shadow-[0_0_40px_rgba(52,211,153,0.15)]">
                                <PartyPopper className="w-10 h-10 text-emerald-400" />
                            </div>
                            <p className={labelClass + ' mb-3'}>Step {stepIndex + 1}</p>
                            <h2 className="text-3xl sm:text-4xl font-black text-text tracking-tight mb-4">Ready to launch</h2>
                            <p className="text-muted text-base leading-relaxed mb-8">
                                Your {mediaServerType !== 'plex' ? (mediaServerType === 'emby' ? 'Emby' : 'Jellyfin') : 'Plex'} server{arrInstances.some((entry) => entry.type === 'sonarr' && entry.url) ? ', Sonarr' : ''}{arrInstances.some((entry) => entry.type === 'radarr' && entry.url) ? ', Radarr' : ''}{arrInstances.some((entry) => entry.type === 'lidarr' && entry.url) ? ', Lidarr' : ''}{arrInstances.some((entry) => entry.type === 'bazarr' && entry.url) ? ', Bazarr' : ''}{tautulliUrl ? ', Tautulli' : ''}{jellystatUrl ? ', Jellystat' : ''}{jellyglanceUrl ? ', JellyGlance' : ''} will be saved.
                                {smtpHost ? ' Email notifications enabled.' : ' Email can be added later in Settings.'}
                                {gotifyUrl.trim() && gotifyToken.trim() ? ' Gotify alerts enabled.' : ' Gotify can be added later in Settings.'}
                                {memberNavHiddenKeys.length > 0
                                    ? ` ${memberNavHiddenKeys.length} member page${memberNavHiddenKeys.length === 1 ? '' : 's'} hidden.`
                                    : ' Members see the default pages.'}
                            </p>
                            <div className={`${sectionCardClass} text-left text-sm space-y-3`}>
                                <p className="flex justify-between gap-4 border-b border-white/5 pb-3"><span className="text-muted">Server</span> <strong className="text-text truncate">{mediaServerType !== 'plex' ? (jellyfinUrl || '—') : (serverIdentifier || '—')}</strong></p>
                                <p className="flex justify-between gap-4 border-b border-white/5 pb-3"><span className="text-muted">Portal URL</span> <strong className="text-text truncate">{publicDomain || '—'}</strong></p>
                                <p className="flex justify-between gap-4 items-center"><span className="text-muted">Accent</span> <span className="flex items-center gap-2"><span className="inline-block w-5 h-5 rounded-md border border-white/20 shadow-inner" style={{ backgroundColor: primaryColor }} /><strong className="text-text">{primaryColor}</strong></span></p>
                            </div>
                        </div>
                    )}
                        </div>

                        {/* Footer navigation */}
                        <div className="flex-shrink-0 border-t border-white/10 bg-black/25 backdrop-blur-md px-6 sm:px-8 lg:px-10 xl:px-12 py-5 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 sm:gap-4">
                                <button type="button" onClick={goBack} disabled={stepIndex === 0 || isLoading}
                                    className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm text-muted hover:text-text hover:bg-white/5 border border-transparent hover:border-white/10 transition-all disabled:opacity-30 disabled:pointer-events-none">
                                    <ChevronLeft className="w-4 h-4" /> Back
                                </button>
                                <a href="https://jl94x4.github.io/StreamPilot/" target="_blank" rel="noreferrer" className="hidden sm:flex items-center gap-2 px-4 py-3 rounded-xl font-bold text-sm text-muted hover:text-text hover:bg-white/5 border border-transparent transition-all">
                                    <BookOpen className="w-4 h-4" /> Docs
                                </a>
                            </div>
                            <span className="hidden sm:block text-xs font-semibold text-muted/70">
                                {STEPS[stepIndex].label} · {stepIndex + 1}/{STEPS.length}
                            </span>
                            {step === 'finish' ? (
                                <button type="button" onClick={handleComplete} disabled={isLoading || !canGoNext}
                                    className={primaryBtnClass}>
                                    {isLoading ? 'Saving…' : 'Complete Setup'} <Check className="w-4 h-4" />
                                </button>
                            ) : (
                                <div className="flex items-center gap-2">
                                    {OPTIONAL_STEPS.has(step) && (
                                        <button
                                            type="button"
                                            onClick={goNext}
                                            disabled={!canGoNext || isLoading}
                                            className="px-4 py-3 rounded-xl font-bold text-sm text-muted hover:text-text hover:bg-white/5 border border-transparent hover:border-white/10 transition-all disabled:opacity-30"
                                        >
                                            Skip for now
                                        </button>
                                    )}
                                    <button type="button" onClick={goNext} disabled={!canGoNext || isLoading}
                                        className={primaryBtnClass}>
                                        Continue <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
