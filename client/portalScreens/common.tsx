import { Activity,AlertTriangle,Check,Film,RefreshCw,X } from 'lucide-react';
import React,{ useEffect,useState } from 'react';

import { apiFetch } from '../shared/api';
import { portalUrl,resolvePortalAssetUrl } from '../shared/basePath';



export const STATUS_ICON_BASE = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg';
const SIMPLE_STATUS_ICON_BASE = 'https://cdn.simpleicons.org';
const STATUS_SERVICE_ICONS: Record<string, string> = {
    plex: `${STATUS_ICON_BASE}/plex.svg`,
    jellyfin: `${STATUS_ICON_BASE}/jellyfin.svg`,
    emby: `${STATUS_ICON_BASE}/emby.svg`,
    tautulli: `${STATUS_ICON_BASE}/tautulli.svg`,
    jellystat: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/png/jellystat.png',
    sonarr: `${STATUS_ICON_BASE}/sonarr.svg`,
    radarr: `${STATUS_ICON_BASE}/radarr.svg`,
    lidarr: `${STATUS_ICON_BASE}/lidarr.svg`,
    bazarr: `${STATUS_ICON_BASE}/bazarr.svg`,
    qbittorrent: `${STATUS_ICON_BASE}/qbittorrent.svg`,
    rdtclient: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/rdt-client.svg',
    transmission: `${STATUS_ICON_BASE}/transmission.svg`,
    bittorrent: `${SIMPLE_STATUS_ICON_BASE}/bittorrent`,
    deluge: `${STATUS_ICON_BASE}/deluge.svg`,
    sabnzbd: `${STATUS_ICON_BASE}/sabnzbd.svg`,
    nzbget: `${STATUS_ICON_BASE}/nzbget.svg`,
    seerr: `${STATUS_ICON_BASE}/seerr.svg`,
    overseerr: `${STATUS_ICON_BASE}/seerr.svg`,
    jellyseerr: `${STATUS_ICON_BASE}/jellyseerr.svg`,
    ombi: `${STATUS_ICON_BASE}/ombi.svg`,
};

const NOW_PLAYING_COMPANION_PREF_KEY = 'portal.home.nowPlayingCompanion.v1';
const REFERRAL_REF_STORAGE_KEY = 'smp.referral.ref';
const REFERRAL_REF_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export const readStoredReferralRef = (): string => {
    try {
        const raw = String(sessionStorage.getItem(REFERRAL_REF_STORAGE_KEY) || '').trim();
        if (!raw) return '';
        if (raw.startsWith('{')) {
            const parsed = JSON.parse(raw);
            const ref = String(parsed?.ref || '').trim();
            const savedAt = Number(parsed?.savedAt) || 0;
            if (!ref || !savedAt || (Date.now() - savedAt) > REFERRAL_REF_MAX_AGE_MS) {
                sessionStorage.removeItem(REFERRAL_REF_STORAGE_KEY);
                return '';
            }
            return ref;
        }
        return raw;
    } catch {
        return '';
    }
};

export const writeStoredReferralRef = (ref: string) => {
    const value = String(ref || '').trim();
    if (!value) return;
    try {
        sessionStorage.setItem(REFERRAL_REF_STORAGE_KEY, JSON.stringify({ ref: value, savedAt: Date.now() }));
    } catch { /* ignore */ }
};

export const clearStoredReferralRef = () => {
    try { sessionStorage.removeItem(REFERRAL_REF_STORAGE_KEY); } catch { /* ignore */ }
};
const nowPlayingCompanionPrefKey = (subjectId: string): string =>
    `${NOW_PLAYING_COMPANION_PREF_KEY}:${String(subjectId || '').trim()}`;

export const readNowPlayingCompanionEnabled = (subjectId: string): boolean => {
    try {
        const key = String(subjectId || '').trim();
        if (!key) return true;
        // Per-subject keys avoid read-modify-write of opaque localStorage blobs.
        const single = localStorage.getItem(nowPlayingCompanionPrefKey(key));
        if (single === '0') return false;
        if (single === '1') return true;
        const raw = localStorage.getItem(NOW_PLAYING_COMPANION_PREF_KEY);
        if (!raw) return true;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return true;
        if (!(key in parsed)) return true;
        return parsed[key] !== false;
    } catch {
        return true;
    }
};

export const writeNowPlayingCompanionEnabled = (subjectId: string, enabled: boolean): void => {
    try {
        const key = String(subjectId || '').trim();
        if (!key) return;
        localStorage.setItem(nowPlayingCompanionPrefKey(key), enabled ? '1' : '0');
    } catch {
        // Ignore persistence failures.
    }
};

const getStatusServiceIconKey = (service: any) => {
    if (service?.clientType) return String(service.clientType).toLowerCase();
    const id = String(service?.id || '').toLowerCase();
    const name = String(service?.name || '').toLowerCase();
    for (const key of Object.keys(STATUS_SERVICE_ICONS)) {
        if (id.includes(key) || name.includes(key)) return key;
    }
    return '';
};

export const StatusServiceIcon: React.FC<{ service: any }> = ({ service }) => {
    const key = getStatusServiceIconKey(service);
    const iconUrl = key ? STATUS_SERVICE_ICONS[key] : '';
    return (
        <span className="inline-flex w-10 h-10 rounded-lg bg-white/5 border border-white/10 items-center justify-center overflow-hidden flex-shrink-0">
            {iconUrl ? (
                <img src={iconUrl} alt="" className="w-6 h-6 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
                <Activity className="w-5 h-5 text-plex" />
            )}
        </span>
    );
};

export const jellyfinQuickConnectUrl = (baseUrl: string) => {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    return base ? `${base}/web/#/quickconnect` : '';
};

export const copyTextToClipboard = async (value: string) => {
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
};

declare global {
    interface Window {
        __USE_24_HOUR_CLOCK__?: boolean;
    }
}

const HOME_SCREEN_FALLBACK_REV = 'hs13-ios-centered';

export const updateFavicon = (thumbUrl: string | null | undefined) => {
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        document.head.appendChild(link);
    }
    let appleLink = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement;
    if (!appleLink) {
        appleLink = document.createElement('link');
        appleLink.rel = 'apple-touch-icon';
        appleLink.setAttribute('sizes', '180x180');
        document.head.appendChild(appleLink);
    }
    // Prefer the server-stamped apple-touch path (rev + cache key in the filename).
    // Never add a ?query — iOS 26+ "Open as Web App" rendered a letter glyph for every
    // query-string icon URL. Always keep a same-origin relative URL — absolute
    // publicDomain hosts the phone cannot reach also fall back to a letter.
    void thumbUrl;
    const sameOriginPath = (raw: string, fallback: string) => {
        try {
            if (/^https?:\/\//i.test(raw) && typeof window !== 'undefined') {
                const parsed = new URL(raw, window.location.origin);
                if (parsed.origin === window.location.origin) return `${parsed.pathname}${parsed.search}`;
                return fallback;
            }
        } catch {
            return fallback;
        }
        return raw || fallback;
    };
    const appleFallback = portalUrl(`/static/apple-touch-${HOME_SCREEN_FALLBACK_REV}.png`);
    const faviconFallback = portalUrl('/static/favicon-180.png');
    const appleRaw = typeof window !== 'undefined'
        ? String((window as any).__APPLE_TOUCH_ICON_HREF__ || '').trim()
        : '';
    const faviconRaw = typeof window !== 'undefined'
        ? String((window as any).__FAVICON_HREF__ || '').trim()
        : '';
    appleLink.href = sameOriginPath(appleRaw, appleFallback);
    appleLink.setAttribute('sizes', '512x512');
    link.href = sameOriginPath(faviconRaw, faviconFallback);
};

// --- Components ---

const SettingsIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
        <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.44,0.17-0.48,0.41L9.22,5.72C8.63,5.96,8.1,6.29,7.6,6.67L5.21,5.71C4.99,5.62,4.74,5.7,4.62,5.92L2.7,9.24 c-0.11,0.2-0.06,0.47,0.12,0.61L4.85,11c-0.04,0.3-0.06,0.61-0.06,0.94c0,0.32,0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.38,2.91 c0.04,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44,0.17,0.48,0.41l0.38-2.91c0.59-0.24,1.12-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
    </svg>
);

export const CountUp: React.FC<{ end: number, duration?: number }> = ({ end, duration = 1500 }) => {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let startTime: number | null = null;
        let animationFrame: number;

        const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const progress = timestamp - startTime;
            const percentage = Math.min(progress / duration, 1);

            // easeOutQuart easing
            const easeOut = 1 - Math.pow(1 - percentage, 4);

            setCount(Math.floor(end * easeOut));

            if (percentage < 1) {
                animationFrame = requestAnimationFrame(animate);
            } else {
                setCount(end);
            }
        };

        animationFrame = requestAnimationFrame(animate);

        return () => cancelAnimationFrame(animationFrame);
    }, [end, duration]);

    return <span>{count.toLocaleString()}</span>;
};

export const ReportIssueModal: React.FC<{ item: any, onClose: () => void }> = ({ item, onClose }) => {
    const [issue, setIssue] = useState('');
    const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('submitting');
        try {
            const res = await apiFetch('/api/plex/report-issue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: item.title, key: item.key || item.ratingKey, issue })
            });
            if (res.success) {
                setStatus('success');
                setTimeout(() => onClose(), 2000);
            } else {
                setStatus('error');
            }
        } catch (e) {
            setStatus('error');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-card p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-plex" />
                        Report Issue
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-muted hover:text-text">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                {status === 'success' ? (
                    <div className="text-center py-8">
                        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Check className="w-8 h-8 text-green-500" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Report Sent!</h3>
                        <p className="text-muted">The server admin has been notified.</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="mb-4">
                            <p className="text-sm text-muted mb-2">Reporting issue for:</p>
                            <div className="bg-black/20 border border-white/5 p-3 rounded-xl flex items-center gap-3">
                                {item.thumbUrl ? (
                                    <img src={resolvePortalAssetUrl(item.thumbUrl)} className="w-10 h-10 rounded-lg object-cover" />
                                ) : (
                                    <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center"><Film className="w-5 h-5 text-muted/50" /></div>
                                )}
                                <div>
                                    <p className="font-bold text-sm truncate">{item.title}</p>
                                    {item.episodeTitle && <p className="text-xs text-muted truncate">{item.episodeTitle}</p>}
                                </div>
                            </div>
                        </div>
                        <div className="mb-6">
                            <label className="block text-sm font-bold text-muted mb-2 uppercase tracking-wider">What's wrong?</label>
                            <textarea
                                value={issue}
                                onChange={e => setIssue(e.target.value)}
                                placeholder="E.g., Audio is out of sync, subtitles are missing, buffering constantly..."
                                className="w-full bg-background border border-border/50 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-plex/50 text-text resize-none h-32"
                                required
                            />
                        </div>
                        <div className="flex gap-3">
                            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-border/50 text-text font-bold hover:bg-white/5 transition-colors">Cancel</button>
                            <button type="submit" disabled={status === 'submitting' || !issue.trim()} className="flex-1 px-4 py-2.5 rounded-xl bg-plex text-black font-black hover:bg-plex/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {status === 'submitting' ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending...</> : 'Send Report'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};
