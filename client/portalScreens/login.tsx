import { Activity,AlertCircle,AlertTriangle,CheckCircle,Film,Music,RefreshCw,Sparkles,Tv } from 'lucide-react';
import React,{ useCallback,useEffect,useRef,useState } from 'react';

import { SetupWizard } from '../setup/SetupWizard';
import { apiFetch } from '../shared/api';
import { EMBY_ICON_URL,JELLYFIN_ICON_URL,PLEX_ICON_URL,portalUrl,resolvePortalAssetUrl,stripBasePath } from '../shared/basePath';
import { formatPortalDateTime,formatTime } from '../shared/format';
import { LoginBrandMark } from '../shared/LoginBrandMark';
import { PlexHomeSwitchModal } from '../shared/PlexHomeSwitchModal';
import { AuthPageBackground,themeClasses } from '../shared/theme';
import { Loader } from '../shared/toast';
import { usePoll } from '../shared/usePoll';
import { clearStoredReferralRef,copyTextToClipboard,jellyfinQuickConnectUrl,readStoredReferralRef,writeStoredReferralRef } from './common';


// --- User Portal Components ---

const loginPrimaryBtnClass = themeClasses.btnPrimaryLg;
const loginSecondaryBtnClass = `${themeClasses.btnSecondary} w-full px-8 py-4 text-base`;

const PublicUptimeBanner: React.FC = () => {
    const [healthData, setHealthData] = useState<Record<string, any>>({});
    const [config, setConfig] = useState<any>({});
    const [statusError, setStatusError] = useState<string | null>(null);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
    const [staleHint, setStaleHint] = useState(false);
    const hasLoadedRef = useRef(false);
    hasLoadedRef.current = hasLoaded;

    const fetchStatus = useCallback(async () => {
        try {
            const res = await apiFetch('/api/status');
            setConfig(res.config);
            setHealthData(res.healthData);
            setStatusError(null);
            setHasLoaded(true);
            setLastUpdatedAt(Date.now());
            setStaleHint(false);
        } catch (e) {
            setStatusError(e instanceof Error ? e.message : 'Status unavailable');
            if (hasLoadedRef.current) setStaleHint(true);
        }
    }, []);

    useEffect(() => {
        void fetchStatus();
    }, [fetchStatus]);

    usePoll(() => { void fetchStatus(); }, 15_000);

    if (statusError && !hasLoaded) {
        return (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 backdrop-blur-xl px-4 py-4 sm:px-6 w-full">
                <p className="text-sm text-amber-200 text-center">Live status temporarily unavailable.</p>
            </div>
        );
    }

    if (!config.services?.length) return null;

    const visibleServices = config.services.filter((service: any) => healthData[service.id]);
    if (visibleServices.length === 0) return null;

    return (
        <div className="rounded-2xl border border-white/10 bg-card/40 backdrop-blur-xl px-4 py-5 sm:px-6 w-full">
            <div className="w-full flex flex-col">
                <div className="flex flex-col items-center text-center mb-4">
                    <a href={portalUrl('/status')} className="text-plex hover:text-plex-hover font-bold text-[10px] tracking-[0.16em] uppercase mb-1.5 transition-colors">
                        View Full Status Page &rarr;
                    </a>
                    <h3 className="text-text font-bold uppercase tracking-[0.14em] text-xs">Live System Status</h3>
                    {staleHint ? (
                        <p className="mt-1 text-[11px] text-amber-300/90">
                            Showing last update{lastUpdatedAt ? ` (${formatTime(new Date(lastUpdatedAt))})` : ''} — refresh failed
                        </p>
                    ) : null}
                </div>
                <div className="flex flex-wrap justify-center gap-2 sm:gap-3 w-full">
                    {visibleServices.map((service: any) => {
                        const health = healthData[service.id];
                        const isUp = health.currentStatus === 'online';
                        const colorClass = isUp ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10';
                        const dotClass = isUp ? 'bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]';

                        return (
                            <div key={service.id} className={`inline-flex items-center gap-1.5 sm:gap-2.5 px-2.5 py-1.5 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl border ${colorClass} backdrop-blur-sm`}>
                                <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 ${dotClass}`} />
                                <span className="text-[11px] sm:text-sm font-bold text-text leading-tight">{service.name}</span>
                                <span className="text-[10px] sm:text-xs font-bold text-muted tabular-nums">{health.uptimePercentage}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export const LivePlexStats: React.FC = () => {
    const [stats, setStats] = useState<{ movies: number, shows: number, music: number, fourKPercent?: number } | null>(null);

    const fetchStats = useCallback(async () => {
        const endpoints = [portalUrl('/api/public/plex/stats'), portalUrl('/api/plex/stats')];

        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
                if (!response.ok) continue;
                const res = await response.json();
                if (res && typeof res.movies === 'number' && typeof res.shows === 'number' && typeof res.music === 'number') {
                    setStats(res);
                    return;
                }
            } catch {
                // Try next endpoint
            }
        }
    }, []);

    useEffect(() => {
        void fetchStats();
    }, [fetchStats]);

    usePoll(() => { void fetchStats(); }, 30_000);

    if (!stats) return (
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
                { icon: Film, label: 'Movies & TV', desc: 'Massive library' },
                { icon: Music, label: 'Music', desc: 'Thousands of albums' },
                { icon: Sparkles, label: 'Requests', desc: 'Automated system' },
            ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-4 flex flex-col items-center text-center gap-2 animate-pulse">
                    <Icon className="w-5 h-5 text-plex/60" />
                    <span className="text-xs font-bold text-muted uppercase tracking-wider">{label}</span>
                    <span className="text-[11px] text-muted/70">{desc}</span>
                </div>
            ))}
        </div>
    );

    const statCardClass = 'section-card p-4 flex flex-col items-center justify-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

    return (
        <div className="w-full flex flex-col">
            <div className="inline-flex self-center items-center gap-2 px-3 py-1 rounded-full bg-plex/10 border border-plex/25 text-plex text-[10px] font-bold uppercase tracking-[0.14em] mb-4">
                <Activity className="w-3 h-3" /> Live Library Stats
            </div>
            <div className={`grid gap-3 w-full ${stats.music > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div className={statCardClass}>
                    <Film className="w-5 h-5 text-plex mb-0.5" />
                    <span className="text-plex font-black text-xl tabular-nums">{stats.movies.toLocaleString()}</span>
                    <span className="text-muted text-[10px] uppercase tracking-[0.12em] font-bold">Movies</span>
                </div>
                <div className={statCardClass}>
                    <Tv className="w-5 h-5 text-plex mb-0.5" />
                    <span className="text-plex font-black text-xl tabular-nums">{stats.shows.toLocaleString()}</span>
                    <span className="text-muted text-[10px] uppercase tracking-[0.12em] font-bold">TV Shows</span>
                </div>
                {stats.music > 0 && (
                    <div className={statCardClass}>
                        <Music className="w-5 h-5 text-plex mb-0.5" />
                        <span className="text-plex font-black text-xl tabular-nums">{stats.music.toLocaleString()}</span>
                        <span className="text-muted text-[10px] uppercase tracking-[0.12em] font-bold">Artists</span>
                    </div>
                )}
            </div>
            <div className="w-full mt-3">
                <div className={statCardClass + ' py-3.5'}>
                    <span className="text-plex font-black text-lg flex items-center gap-2 tabular-nums">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        {stats.fourKPercent !== undefined ? stats.fourKPercent : 30}%
                    </span>
                    <span className="text-muted text-[10px] uppercase tracking-[0.12em] font-bold">Available in 4K</span>
                </div>
            </div>
        </div>
    );
};

export const Login: React.FC<{ onLoginSuccess: () => void, publicConfig?: any, publicConfigWarning?: string | null, initialError?: string }> = ({ onLoginSuccess, publicConfig, publicConfigWarning, initialError }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(initialError || '');
    const [jellyfinUsername, setJellyfinUsername] = useState('');
    const [jellyfinPassword, setJellyfinPassword] = useState('');
    const [showJellyfinPassword, setShowJellyfinPassword] = useState(false);
    const [quickConnect, setQuickConnect] = useState<{ sessionId: string, code: string, jellyfinUrl: string } | null>(null);
    const [homeSelectUsers, setHomeSelectUsers] = useState<any[] | null>(null);
    const [homeSelectBusy, setHomeSelectBusy] = useState(false);
    const [homeSelectRememberUserId, setHomeSelectRememberUserId] = useState<string | null>(null);
    const quickConnectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [publicInfo, setPublicInfo] = useState<{ thumb: string | null, customLogoUrl?: string | null, serverName: string, isConfigured: boolean | null, mediaServerType?: string }>({ thumb: null, customLogoUrl: null, serverName: 'StreamPilot', isConfigured: null, mediaServerType: 'plex' });
    const [publicInfoLoading, setPublicInfoLoading] = useState(true);
    const [publicInfoLoadFailed, setPublicInfoLoadFailed] = useState(false);

    const fetchPublicInfo = () => {
        setPublicInfoLoading(true);
        setPublicInfoLoadFailed(false);
        apiFetch('/api/public/info').then(data => {
            if (data) {
                setPublicInfo({
                    thumb: data.thumb || null,
                    customLogoUrl: data.customLogoUrl || null,
                    serverName: data.serverName || 'StreamPilot',
                    isConfigured: data.isConfigured !== false,
                    mediaServerType: data.mediaServerType || 'plex'
                });
                if (data.serverName) document.title = `${data.serverName} Portal`;
            }
        }).catch(() => {
            setPublicInfoLoadFailed(true);
            setError('Could not reach the portal. If you just restarted or updated, wait a few seconds and refresh.');
        }).finally(() => setPublicInfoLoading(false));
    };

    const handleSetupComplete = () => {
        window.dispatchEvent(new CustomEvent('portal-public-config-updated'));
        fetchPublicInfo();
    };

    useEffect(() => {
        if (initialError) {
            window.history.replaceState({}, '', portalUrl('/'));
        }
    }, [initialError]);

    const pollJellyfinQuickConnect = useCallback(async () => {
        if (!quickConnect?.sessionId) return;
        try {
            const storedRef = readStoredReferralRef();
            const data = await apiFetch('/api/auth/jellyfin/quick-connect/poll', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: quickConnect.sessionId,
                    ...(storedRef ? { ref: storedRef } : {}),
                }),
            });
            if (data?.success) {
                clearStoredReferralRef();
                setQuickConnect(null);
                onLoginSuccess();
            }
        } catch (e: any) {
            setQuickConnect(null);
            setIsLoading(false);
            setError(e.message || 'Jellyfin Quick Connect failed');
        }
    }, [quickConnect?.sessionId, onLoginSuccess]);

    usePoll(() => { void pollJellyfinQuickConnect(); }, quickConnect?.sessionId ? 5000 : null);

    useEffect(() => {
        fetchPublicInfo();

        const path = stripBasePath(window.location.pathname);
        const params = new URLSearchParams(window.location.search);
        const referralRef = String(params.get('ref') || '').trim();
        if (referralRef) {
            writeStoredReferralRef(referralRef);
        }
        const loginError = params.get('loginError');
        if (loginError) {
            setError(loginError);
            window.history.replaceState({}, '', portalUrl('/'));
            return;
        }

        if (params.get('homeSelect') === '1') {
            window.history.replaceState({}, '', portalUrl('/'));
            setIsLoading(true);
            apiFetch('/api/auth/plex/home-users')
                .then((data) => {
                    if (Array.isArray(data?.users) && data.users.length) {
                        setHomeSelectUsers(data.users);
                        setHomeSelectRememberUserId(data.rememberUserId || null);
                        return;
                    }
                    setError('No Plex Home profiles were found. Please sign in again.');
                })
                .catch((e) => {
                    setError(e.message || 'Plex Home selection expired. Please sign in again.');
                })
                .finally(() => setIsLoading(false));
            return;
        }

        // Setup wizard OAuth return — SetupWizard handles this, not login
        if (path.startsWith('/auth/setup/')) {
            return;
        }

        if (path.startsWith('/auth/')) {
            const pinId = path.split('/')[2];
            setIsLoading(true);
            window.history.replaceState({}, '', portalUrl('/'));
            const storedRef = readStoredReferralRef();
            apiFetch('/api/auth/plex/callback', {
                method: 'POST',
                body: JSON.stringify({ pinId, ...(storedRef ? { ref: storedRef } : {}) }),
            }).then((data) => {
                if (data?.needsHomeSelect && Array.isArray(data.users)) {
                    setHomeSelectUsers(data.users);
                    setHomeSelectRememberUserId(data.rememberUserId || null);
                    return;
                }
                clearStoredReferralRef();
                onLoginSuccess();
            }).catch(e => {
                setError(e.message || 'Login failed');
            }).finally(() => {
                setIsLoading(false);
            });
        }
    }, [onLoginSuccess]);

    const handlePlexLogin = async () => {
        setIsLoading(true);
        setError('');
        try {
            const data = await apiFetch('/api/auth/plex/login', { method: 'POST' });
            const clientId = data.clientIdentifier || data.clientId || '';
            const storedRef = readStoredReferralRef();
            const callbackParams = new URLSearchParams({ pinId: String(data.id) });
            if (storedRef) callbackParams.set('ref', storedRef);
            const forwardUrl = window.location.origin + portalUrl(`/api/auth/plex/callback?${callbackParams.toString()}`);
            const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}&code=${data.code}&context[device][product]=StreamPilot&forwardUrl=${encodeURIComponent(forwardUrl)}`;
            window.location.href = authUrl;
        } catch (e) {
            setError('Failed to initiate Plex login');
            setIsLoading(false);
        }
    };

    const handlePlexHomeSelect = async (user: { id: string }, pin: string | undefined, remember: boolean) => {
        setHomeSelectBusy(true);
        setError('');
        try {
            await apiFetch('/api/auth/plex/home-switch', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    remember: remember === true,
                    ...(pin ? { pin } : {}),
                }),
            });
            clearStoredReferralRef();
            setHomeSelectUsers(null);
            setHomeSelectRememberUserId(null);
            onLoginSuccess();
        } catch (e: any) {
            setError(e.message || 'Could not switch Plex Home profile.');
        } finally {
            setHomeSelectBusy(false);
        }
    };

    const handlePlexHomeSelectCancel = async () => {
        setHomeSelectBusy(true);
        try {
            await apiFetch('/api/auth/plex/home-select/cancel', { method: 'POST' });
        } catch {
            // Cookie may already be gone
        } finally {
            setHomeSelectUsers(null);
            setHomeSelectRememberUserId(null);
            setHomeSelectBusy(false);
            setError('');
        }
    };

    const handleJellyfinLogin = async (event?: React.FormEvent) => {
        event?.preventDefault();
        setIsLoading(true);
        setError('');
        try {
            const storedRef = readStoredReferralRef();
            await apiFetch('/api/auth/jellyfin/login', {
                method: 'POST',
                body: JSON.stringify({
                    username: jellyfinUsername.trim(),
                    password: jellyfinPassword,
                    ...(storedRef ? { ref: storedRef } : {}),
                }),
            });
            clearStoredReferralRef();
            onLoginSuccess();
        } catch (e: any) {
            setError(e.message || 'Failed to authenticate with Jellyfin');
        } finally {
            setIsLoading(false);
        }
    };

    const handleJellyfinQuickConnect = async () => {
        setIsLoading(true);
        setError('');
        try {
            const data = await apiFetch('/api/auth/jellyfin/quick-connect/initiate', { method: 'POST' });
            setQuickConnect({
                sessionId: data.sessionId,
                code: data.code,
                jellyfinUrl: data.jellyfinUrl || '',
            });
            setIsLoading(false);
        } catch (e: any) {
            setIsLoading(false);
            setError(e.message || 'Failed to start Jellyfin Quick Connect');
        }
    };

    const handleOpenJellyfinQuickConnect = async () => {
        if (!quickConnect?.jellyfinUrl) return;
        try {
            await copyTextToClipboard(quickConnect.code);
        } catch {
            // Clipboard access can be blocked by browser settings; opening Jellyfin is still useful.
        }
        window.open(jellyfinQuickConnectUrl(quickConnect.jellyfinUrl), '_blank', 'noopener,noreferrer');
    };

    if (publicInfo.isConfigured === false || (typeof window !== 'undefined' && stripBasePath(window.location.pathname).startsWith('/auth/setup/'))) {
        return <SetupWizard onComplete={handleSetupComplete} />;
    }

    if (publicInfoLoading || (publicInfo.isConfigured === null && !publicInfoLoadFailed)) {
        return <Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />;
    }

    const mediaServerType = String(publicInfo.mediaServerType || publicConfig?.mediaServerType || 'plex').toLowerCase();
    const isJellyfinAuth = mediaServerType === 'jellyfin';
    const isEmbyAuth = mediaServerType === 'emby';
    const isEmbyLikeAuth = isJellyfinAuth || isEmbyAuth;
    const mediaServerLabel = isEmbyAuth ? 'Emby' : 'Jellyfin';
    const mediaServerIconUrl = isEmbyAuth ? EMBY_ICON_URL : JELLYFIN_ICON_URL;
    const showMediaServerPasswordLogin = isEmbyAuth || showJellyfinPassword;
    // Opt-in only — undefined/empty publicConfig must not flash the trial panel before /api/config/public loads.
    const showTrialAccess = !isEmbyLikeAuth && publicConfig?.allowTemporaryAccess === true;
    const sidebarLogoSrc = publicConfig?.customLogoUrl
        ? resolvePortalAssetUrl(publicConfig.customLogoUrl)
        : (publicInfo.customLogoUrl
            ? resolvePortalAssetUrl(publicInfo.customLogoUrl)
            : (publicInfo.thumb ? resolvePortalAssetUrl(publicInfo.thumb) : ''));
    const loginLogoSrc = publicConfig?.customLoginLogoUrl
        ? resolvePortalAssetUrl(publicConfig.customLoginLogoUrl)
        : sidebarLogoSrc;
    const splashBackgroundUrl = publicConfig?.backgroundImageUrl ? resolvePortalAssetUrl(publicConfig.backgroundImageUrl) : undefined;

    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 lg:p-10 overflow-hidden">
            <AuthPageBackground backgroundImageUrl={splashBackgroundUrl} trendingBackgrounds={publicConfig?.useTrendingSlideshowOnLogin ? publicConfig?.trendingBackgrounds : undefined} trendingSlideshowInterval={publicConfig?.trendingSlideshowInterval} />
            <Loader isLoading={isLoading} isCinematic={!!publicConfig?.useCinematicLoading} />

            <div className="relative z-10 w-full max-w-6xl flex flex-col gap-6">
                <div className={`glass-card-lg overflow-hidden flex flex-col ${showTrialAccess ? 'lg:flex-row min-h-[min(680px,calc(100vh-3rem))]' : 'max-w-xl mx-auto w-full'}`}>
                    {showTrialAccess && (
                        <div className="flex-1 flex flex-col justify-center p-6 sm:p-8 lg:p-10 xl:p-12 border-t lg:border-t-0 lg:border-r border-white/10 bg-gradient-to-br from-plex/[0.08] via-plex/[0.03] to-transparent min-w-0 order-last lg:order-none">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-plex/10 border border-plex/25 text-plex text-[11px] font-bold uppercase tracking-widest mb-5 w-fit">
                                <Sparkles className="w-3.5 h-3.5" /> New here?
                            </div>
                            <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight leading-tight mb-3">
                                Welcome to{' '}
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-plex to-amber-400">{publicInfo.serverName}</span>
                            </h1>
                            <p className="text-muted text-sm sm:text-base leading-relaxed mb-6 max-w-lg">
                                The ultimate Plex experience. Get instant access to our entire library with a{' '}
                                <strong className="text-text font-semibold">3-Day Temporary Access</strong> pass.
                            </p>

                            {publicConfig?.showPublicLibraryStats !== false && (
                                <div className="mb-6">
                                    <LivePlexStats />
                                </div>
                            )}

                            <p className="text-xs text-muted/80 leading-relaxed mb-5">
                                You&apos;ll need a free Plex account to continue. You can create one securely on the next screen.
                            </p>
                            <button type="button" className={loginPrimaryBtnClass} onClick={handlePlexLogin} disabled={isLoading}>
                                <img src={PLEX_ICON_URL} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                Request Temporary Access
                            </button>
                        </div>
                    )}

                    <div className={`flex flex-col justify-center items-center text-center p-6 sm:p-8 lg:p-10 xl:p-12 min-w-0 ${showTrialAccess ? 'flex-1 order-first lg:order-none' : 'w-full py-10 sm:py-12'}`}>
                        {publicConfigWarning && (
                            <div className="w-full mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 text-center">
                                {publicConfigWarning}
                            </div>
                        )}
                        <div className={`relative mb-8 flex justify-center w-full ${(!loginLogoSrc || publicConfig?.loginLogoCircleFrame === false) ? 'max-w-lg px-2' : ''}`}>
                            {!loginLogoSrc ? (
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-16 bg-plex/20 rounded-full blur-[60px] pointer-events-none" />
                            ) : publicConfig?.loginLogoCircleFrame !== false ? (
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36 bg-plex/20 rounded-full blur-[60px] pointer-events-none" />
                            ) : null}
                            <LoginBrandMark
                                src={loginLogoSrc}
                                circleFrame={Boolean(loginLogoSrc) && publicConfig?.loginLogoCircleFrame !== false}
                            />
                        </div>

                        {!showTrialAccess && (
                            <>
                                <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight mb-3">
                                    {publicInfo.serverName}
                                </h1>
                                <p className="text-muted text-sm sm:text-base leading-relaxed mb-8 max-w-sm">
                                    {isEmbyLikeAuth
                                        ? `Sign in with your ${mediaServerLabel} account to access your portal and manage your subscription.`
                                        : 'Sign in with Plex to access your portal and manage your subscription.'}
                                </p>
                            </>
                        )}

                        {showTrialAccess && (
                            <>
                                <p className="text-[11px] font-bold text-muted uppercase tracking-[0.16em] mb-2">Returning member</p>
                                <h2 className="text-2xl sm:text-3xl font-black text-text tracking-tight mb-3">Already on our server?</h2>
                                <p className="text-muted text-sm sm:text-base leading-relaxed mb-8 max-w-sm">
                                    Manage your existing access or re-link your Plex account.
                                </p>
                            </>
                        )}

                        {isEmbyLikeAuth ? (
                            <div className="w-full max-w-sm flex flex-col gap-4 text-left">
                                {isJellyfinAuth && (
                                    <button type="button" className={loginSecondaryBtnClass} onClick={handleJellyfinQuickConnect} disabled={isLoading}>
                                        <img src={mediaServerIconUrl} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                        Login with Jellyfin
                                    </button>
                                )}

                                {isJellyfinAuth && quickConnect && (
                                    <div className="w-full rounded-xl border border-plex/30 bg-plex/10 p-4 text-center">
                                        <p className="text-[10px] font-bold text-muted uppercase tracking-[0.14em] mb-2">Quick Connect code</p>
                                        <div className="font-black text-3xl tracking-[0.18em] text-text tabular-nums mb-3">{quickConnect.code}</div>
                                        <p className="text-xs text-muted leading-relaxed">
                                            Approve this code in Jellyfin Quick Connect. This page will finish login automatically.
                                        </p>
                                        {quickConnect.jellyfinUrl && (
                                            <button
                                                type="button"
                                                onClick={handleOpenJellyfinQuickConnect}
                                                className="mt-3 inline-flex items-center justify-center text-xs font-bold text-plex hover:text-text transition"
                                            >
                                                Copy code & open Quick Connect
                                            </button>
                                        )}
                                    </div>
                                )}

                                {isJellyfinAuth && (
                                    <button
                                        type="button"
                                        className="self-center text-xs font-bold text-muted hover:text-text transition"
                                        onClick={() => setShowJellyfinPassword((value) => !value)}
                                    >
                                        {showJellyfinPassword ? 'Hide password login' : 'Use password instead'}
                                    </button>
                                )}

                                {showMediaServerPasswordLogin && (
                                    <form onSubmit={handleJellyfinLogin} className="w-full flex flex-col gap-3 text-left">
                                        <label className="flex flex-col gap-1.5">
                                            <span className="text-[10px] font-bold text-muted uppercase tracking-[0.14em]">{mediaServerLabel} username</span>
                                            <input
                                                value={jellyfinUsername}
                                                onChange={(e) => setJellyfinUsername(e.target.value)}
                                                autoComplete="username"
                                                className="w-full bg-black/25 border border-white/15 rounded-xl px-4 py-3 text-sm text-text outline-none focus:border-plex/70 focus:ring-2 focus:ring-plex/20 transition"
                                                placeholder="Username"
                                                disabled={isLoading}
                                                required
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1.5">
                                            <span className="text-[10px] font-bold text-muted uppercase tracking-[0.14em]">Password</span>
                                            <input
                                                value={jellyfinPassword}
                                                onChange={(e) => setJellyfinPassword(e.target.value)}
                                                type="password"
                                                autoComplete="current-password"
                                                className="w-full bg-black/25 border border-white/15 rounded-xl px-4 py-3 text-sm text-text outline-none focus:border-plex/70 focus:ring-2 focus:ring-plex/20 transition"
                                                placeholder="Password"
                                                disabled={isLoading}
                                                required
                                            />
                                        </label>
                                        <button type="submit" className={loginSecondaryBtnClass} disabled={isLoading || !jellyfinUsername.trim() || !jellyfinPassword}>
                                            <img src={mediaServerIconUrl} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                            Login with {mediaServerLabel}
                                        </button>
                                    </form>
                                )}
                            </div>
                        ) : (
                            <button type="button" className={loginSecondaryBtnClass} onClick={handlePlexLogin} disabled={isLoading}>
                                <img src={PLEX_ICON_URL} alt="" className="w-5 h-5 object-contain opacity-90" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                Login with Plex
                            </button>
                        )}

                        {!showTrialAccess && !isEmbyLikeAuth && publicConfig?.showPublicLibraryStats !== false && (
                            <div className="w-full mt-10 pt-8 border-t border-white/10">
                                <LivePlexStats />
                            </div>
                        )}
                    </div>
                </div>

                {publicConfig?.showPublicStatusMonitor !== false && <PublicUptimeBanner />}

                {error && !homeSelectUsers && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm flex items-start gap-3">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                        <span>{error}</span>
                    </div>
                )}
            </div>
            <PlexHomeSwitchModal
                open={!!homeSelectUsers}
                users={homeSelectUsers || []}
                rememberUserId={homeSelectRememberUserId}
                showRemember
                rememberDefault
                loginMode
                busy={homeSelectBusy}
                error={error}
                onSelect={handlePlexHomeSelect}
                onClose={handlePlexHomeSelectCancel}
                onUseDifferentAccount={handlePlexHomeSelectCancel}
            />
        </div>
    );
};

export const RebuildLibraryCacheButton: React.FC = () => {
    const [status, setStatus] = useState<'idle' | 'starting' | 'building' | 'done' | 'warn' | 'error'>('idle');
    const [lastBuilt, setLastBuilt] = useState<number | null>(null);
    const [lastWarning, setLastWarning] = useState<string | null>(null);

    const applyStatusPayload = (s: any, { finishing = false } = {}) => {
        if (s.lastGeneratedAt) setLastBuilt(s.lastGeneratedAt);
        const warning = String(s.lastWarning || '').trim() || null;
        setLastWarning(warning);
        if (s.isBuilding) {
            setStatus('building');
            return;
        }
        if (!finishing) return;
        if (s.lastError) setStatus('error');
        else if (warning || (Array.isArray(s.lastBuildFailures) && s.lastBuildFailures.length)) setStatus('warn');
        else setStatus('done');
        window.setTimeout(() => setStatus('idle'), 4000);
    };

    const pollBuildStatus = useCallback(async () => {
        try {
            const s: any = await apiFetch('/api/plex/stats/status');
            applyStatusPayload(s, { finishing: true });
        } catch {
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        apiFetch('/api/plex/stats/status').then((s: any) => {
            applyStatusPayload(s, { finishing: false });
        }).catch(() => { });
    }, []);

    usePoll(() => { void pollBuildStatus(); }, status === 'building' ? 3000 : null, { immediate: true });

    const handleRebuild = async () => {
        setStatus('starting');
        try {
            await apiFetch('/api/plex/stats/rebuild', { method: 'POST' });
            setStatus('building');
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const isRunning = status === 'building' || status === 'starting';
    return (
        <div className="flex flex-col gap-1.5">
            <button
                onClick={handleRebuild}
                disabled={isRunning}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all border
                    ${status === 'done' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                        status === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                        status === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                            isRunning ? 'bg-white/5 border-white/10 text-muted cursor-not-allowed' :
                                'bg-white/5 border-white/10 text-text hover:bg-white/10'}`}
            >
                {isRunning ? (
                    <><div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> Building Cache...</>
                ) : status === 'done' ? (
                    <><CheckCircle size={14} /> Cache Updated!</>
                ) : status === 'warn' ? (
                    <><AlertCircle size={14} /> Totals kept</>
                ) : status === 'error' ? (
                    <><AlertCircle size={14} /> Build Failed</>
                ) : (
                    <><RefreshCw size={14} /> Rebuild Library Cache</>
                )}
            </button>
            {lastBuilt && (
                <p className="text-[10px] text-muted text-center">
                    Last built: {formatPortalDateTime(lastBuilt)}
                </p>
            )}
            {lastWarning && status !== 'building' && status !== 'starting' && (
                <p className="text-[10px] text-amber-300/90 text-center leading-snug">{lastWarning}</p>
            )}
        </div>
    );
};
