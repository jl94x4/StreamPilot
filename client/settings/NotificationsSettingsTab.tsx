import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Loader2, RefreshCw, Send } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { apiFetch } from '../shared/api';
import { notifyInAppNotificationsChanged } from '../shared/inAppNotificationsRefresh';
import { navigateToSummaryDigest } from '../shared/SummaryDigestCard';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import { SettingFieldLabel, SettingHint } from './SettingHint';
import { NotificationTemplatesPanel } from './NotificationTemplatesPanel';
import { subscribeWebPush } from '../shared/webPushSubscribe';

const TEST_CHANNELS_STORAGE_KEY = 'portal-notification-test-channels';
const DEFAULT_TEST_CHANNELS = {
    inApp: true,
    webPush: false,
    email: false,
    discord: false,
    ntfy: false,
    webhook: false,
};

const readStoredTestChannels = () => {
    try {
        const raw = localStorage.getItem(TEST_CHANNELS_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_TEST_CHANNELS };
        const parsed = JSON.parse(raw);
        return {
            inApp: parsed?.inApp !== false,
            webPush: !!parsed?.webPush,
            email: !!parsed?.email,
            discord: !!parsed?.discord,
            ntfy: !!parsed?.ntfy,
            webhook: !!parsed?.webhook,
        };
    } catch {
        return { ...DEFAULT_TEST_CHANNELS };
    }
};

const persistTestChannels = (channels: typeof DEFAULT_TEST_CHANNELS) => {
    try {
        localStorage.setItem(TEST_CHANNELS_STORAGE_KEY, JSON.stringify(channels));
    } catch {
        // ignore quota / private mode
    }
};

const formatWhen = (iso: string | null | undefined, neverLabel: string) => {
    if (!iso) return neverLabel;
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
};

const formatDayKey = (iso: string | null | undefined, unknownLabel: string) => {
    if (!iso) return unknownLabel;
    try {
        return new Intl.DateTimeFormat(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(new Date(iso));
    } catch {
        return String(iso).slice(0, 10);
    }
};

const RecentNotificationsHistory: React.FC<{
    items: any[];
    t: ReturnType<typeof useDiscoverI18n>['t'];
}> = ({ items, t }) => {
    const types = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const item of items) {
            const key = String(item?.type || 'unknown');
            counts[key] = (counts[key] || 0) + 1;
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    }, [items]);
    const [filter, setFilter] = useState('all');
    const filtered = useMemo(
        () => (filter === 'all' ? items : items.filter((item) => String(item?.type || 'unknown') === filter)),
        [items, filter],
    );
    const groups = useMemo(() => {
        const map = new Map<string, any[]>();
        for (const item of filtered) {
            const key = formatDayKey(item?.createdAt, t('settings.notifications.common.unknownDate'));
            const list = map.get(key) || [];
            list.push(item);
            map.set(key, list);
        }
        return [...map.entries()];
    }, [filtered]);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                        filter === 'all' ? 'border-plex text-plex bg-plex/10' : 'border-border text-muted hover:text-text'
                    }`}
                >
                    {t('settings.notifications.common.all')} ({items.length})
                </button>
                {types.map(([type, count]) => (
                    <button
                        key={type}
                        type="button"
                        onClick={() => setFilter(type)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                            filter === type ? 'border-plex text-plex bg-plex/10' : 'border-border text-muted hover:text-text'
                        }`}
                    >
                        {type} ({count})
                    </button>
                ))}
            </div>
            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/60">
                {groups.map(([day, rows]) => (
                    <div key={day}>
                        <div className="px-3 py-1.5 bg-white/[0.03] text-[10px] uppercase tracking-wider font-bold text-muted">
                            {day}
                        </div>
                        {rows.map((item) => (
                            <div key={item.id} className="px-3 py-2.5 bg-background/30 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-semibold text-text truncate">{item.title}</p>
                                        {!item.readAt && (
                                            <span className="text-[10px] font-bold uppercase tracking-wide text-plex bg-plex/10 border border-plex/30 px-1.5 py-0.5 rounded">
                                                {t('settings.notifications.common.unread')}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted mt-0.5">
                                        {item.username || item.userId || t('settings.notifications.common.unknownUser')}
                                        {item.type ? ` · ${item.type}` : ''}
                                        {item.href ? ` · ${item.href}` : ''}
                                    </p>
                                    {item.body ? <p className="text-xs text-muted/80 mt-1 line-clamp-2">{item.body}</p> : null}
                                </div>
                                <p className="text-[10px] text-muted shrink-0 whitespace-nowrap">{formatWhen(item.createdAt, t('settings.notifications.common.never'))}</p>
                            </div>
                        ))}
                    </div>
                ))}
                {!filtered.length && (
                    <div className="px-4 py-8 text-center text-sm text-muted">{t('settings.notifications.history.noFilterResults')}</div>
                )}
            </div>
        </div>
    );
};

type StatusPayload = {
    requestAvailable?: {
        enabled?: boolean;
        email?: boolean;
        inApp?: boolean;
        webPush?: boolean;
        discord?: boolean;
        discordWebhookConfigured?: boolean;
    };
    webPush?: {
        enabled?: boolean;
        vapidReady?: boolean;
        usersWithSubscriptions?: number;
        deviceCount?: number;
        thisUserDeviceCount?: number;
        updatedAt?: string | null;
    };
    email?: { smtpReady?: boolean; requestAvailableAllowed?: boolean };
    discord?: { enabled?: boolean; webhookConfigured?: boolean };
    gotify?: { enabled?: boolean; configured?: boolean };
    ntfy?: { enabled?: boolean; configured?: boolean; events?: Record<string, boolean> };
    webhook?: { enabled?: boolean; configured?: boolean; events?: Record<string, boolean> };
    inApp?: {
        total?: number;
        unread?: number;
        updatedAt?: string | null;
        byType?: Record<string, number>;
    };
    jobs?: {
        requestEngine?: string;
        seerrAvailableNotify?: {
            lastRun?: string | null;
            nextRun?: string | null;
            running?: boolean;
            lastError?: string | null;
        } | null;
        requestStatusSync?: {
            lastRun?: string | null;
            nextRun?: string | null;
            running?: boolean;
            lastError?: string | null;
        } | null;
    };
    seerrSnapshot?: { updatedAt?: string | null; trackedRequests?: number };
};

type RecentItem = {
    id: string;
    userId?: string;
    username?: string | null;
    type?: string;
    title?: string;
    body?: string;
    readAt?: string | null;
    createdAt?: string | null;
};

type Props = {
    requestAvailableNotifyEnabled: boolean;
    setRequestAvailableNotifyEnabled: (v: boolean) => void;
    requestAvailableNotifyEmail: boolean;
    setRequestAvailableNotifyEmail: (v: boolean) => void;
    requestAvailableNotifyInApp: boolean;
    setRequestAvailableNotifyInApp: (v: boolean) => void;
    requestAvailableNotifyWebPush: boolean;
    setRequestAvailableNotifyWebPush: (v: boolean) => void;
    requestAvailableNotifyDiscord: boolean;
    setRequestAvailableNotifyDiscord: (v: boolean) => void;
    requestAvailableDiscordWebhookUrl: string;
    setRequestAvailableDiscordWebhookUrl: (v: string) => void;
    requestNotReleasedNotifyEnabled: boolean;
    setRequestNotReleasedNotifyEnabled: (v: boolean) => void;
    requestNotReleasedNotifyEmail: boolean;
    setRequestNotReleasedNotifyEmail: (v: boolean) => void;
    requestNotReleasedNotifyInApp: boolean;
    setRequestNotReleasedNotifyInApp: (v: boolean) => void;
    requestNotReleasedNotifyWebPush: boolean;
    setRequestNotReleasedNotifyWebPush: (v: boolean) => void;
    notifyReleaseDatePreference: string;
    setNotifyReleaseDatePreference: (v: string) => void;
    scannerNotifyDeleted: boolean;
    setScannerNotifyDeleted: (v: boolean) => void;
    scannerNotifyUpgrade: boolean;
    setScannerNotifyUpgrade: (v: boolean) => void;
    scannerNotifyImport: boolean;
    setScannerNotifyImport: (v: boolean) => void;
    scannerNotifyGrab: boolean;
    setScannerNotifyGrab: (v: boolean) => void;
    scannerNotifyUpdate: boolean;
    setScannerNotifyUpdate: (v: boolean) => void;
    scannerNotifyInteraction: boolean;
    setScannerNotifyInteraction: (v: boolean) => void;
    webPushEnabled: boolean;
    setWebPushEnabled: (v: boolean) => void;
    notificationTemplates: Record<string, Record<string, string>>;
    setNotificationTemplates: (v: Record<string, Record<string, string>>) => void;
    notificationTemplateDefaults: Record<string, Record<string, string>>;
    notificationTemplateEvents: string[];
    notificationTemplateFields: Record<string, string[]>;
    ntfyEnabled: boolean;
    setNtfyEnabled: (v: boolean) => void;
    ntfyServerUrl: string;
    setNtfyServerUrl: (v: string) => void;
    ntfyTopic: string;
    setNtfyTopic: (v: string) => void;
    ntfyToken: string;
    setNtfyToken: (v: string) => void;
    ntfyPriority: number;
    setNtfyPriority: (v: number) => void;
    ntfyEvents: Record<string, boolean>;
    setNtfyEvents: (v: Record<string, boolean>) => void;
    webhookEnabled: boolean;
    setWebhookEnabled: (v: boolean) => void;
    webhookUrl: string;
    setWebhookUrl: (v: string) => void;
    webhookHeadersJson: string;
    setWebhookHeadersJson: (v: string) => void;
    webhookEvents: Record<string, boolean>;
    setWebhookEvents: (v: Record<string, boolean>) => void;
    onOpenGotify: () => void;
    onOpenSmtp: () => void;
    summaryNotifyEnabled: boolean;
    setSummaryNotifyEnabled: (v: boolean) => void;
    summaryNotifyFrequency: string;
    setSummaryNotifyFrequency: (v: string) => void;
    summaryNotifyDay: number;
    setSummaryNotifyDay: (v: number) => void;
    summaryNotifyTime: string;
    setSummaryNotifyTime: (v: string) => void;
    summaryNotifyInApp: boolean;
    setSummaryNotifyInApp: (v: boolean) => void;
    summaryNotifyWebPush: boolean;
    setSummaryNotifyWebPush: (v: boolean) => void;
    summaryNotifyEmail: boolean;
    setSummaryNotifyEmail: (v: boolean) => void;
    summaryMetrics: Record<string, boolean>;
    setSummaryMetrics: (v: Record<string, boolean>) => void;
    addToast: (message: string, type?: 'success' | 'error') => void;
    getSettingsSectionElementId: (id: string) => string;
};

const Pill: React.FC<{ ok: boolean; label: string; detail?: string; t: ReturnType<typeof useDiscoverI18n>['t'] }> = ({ ok, label, detail, t }) => (
    <div className={`rounded-xl border px-3 py-2.5 ${ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
        <p className="text-xs font-bold uppercase tracking-wider text-text">{label}</p>
        <p className={`text-sm font-semibold mt-0.5 ${ok ? 'text-emerald-300' : 'text-amber-200'}`}>
            {ok ? t('settings.notifications.common.ready') : t('settings.notifications.common.needsSetup')}
        </p>
        {detail ? <p className="text-[11px] text-muted mt-1 leading-snug">{detail}</p> : null}
    </div>
);

export const NotificationsSettingsTab: React.FC<Props> = ({
    requestAvailableNotifyEnabled,
    setRequestAvailableNotifyEnabled,
    requestAvailableNotifyEmail,
    setRequestAvailableNotifyEmail,
    requestAvailableNotifyInApp,
    setRequestAvailableNotifyInApp,
    requestAvailableNotifyWebPush,
    setRequestAvailableNotifyWebPush,
    requestAvailableNotifyDiscord,
    setRequestAvailableNotifyDiscord,
    requestAvailableDiscordWebhookUrl,
    setRequestAvailableDiscordWebhookUrl,
    requestNotReleasedNotifyEnabled,
    setRequestNotReleasedNotifyEnabled,
    requestNotReleasedNotifyEmail,
    setRequestNotReleasedNotifyEmail,
    requestNotReleasedNotifyInApp,
    setRequestNotReleasedNotifyInApp,
    requestNotReleasedNotifyWebPush,
    setRequestNotReleasedNotifyWebPush,
    notifyReleaseDatePreference,
    setNotifyReleaseDatePreference,
    scannerNotifyDeleted,
    setScannerNotifyDeleted,
    scannerNotifyUpgrade,
    setScannerNotifyUpgrade,
    scannerNotifyImport,
    setScannerNotifyImport,
    scannerNotifyGrab,
    setScannerNotifyGrab,
    scannerNotifyUpdate,
    setScannerNotifyUpdate,
    scannerNotifyInteraction,
    setScannerNotifyInteraction,
    webPushEnabled,
    setWebPushEnabled,
    notificationTemplates,
    setNotificationTemplates,
    notificationTemplateDefaults,
    notificationTemplateEvents,
    notificationTemplateFields,
    ntfyEnabled,
    setNtfyEnabled,
    ntfyServerUrl,
    setNtfyServerUrl,
    ntfyTopic,
    setNtfyTopic,
    ntfyToken,
    setNtfyToken,
    ntfyPriority,
    setNtfyPriority,
    ntfyEvents,
    setNtfyEvents,
    webhookEnabled,
    setWebhookEnabled,
    webhookUrl,
    setWebhookUrl,
    webhookHeadersJson,
    setWebhookHeadersJson,
    webhookEvents,
    setWebhookEvents,
    onOpenGotify,
    onOpenSmtp,
    summaryNotifyEnabled,
    setSummaryNotifyEnabled,
    summaryNotifyFrequency,
    setSummaryNotifyFrequency,
    summaryNotifyDay,
    setSummaryNotifyDay,
    summaryNotifyTime,
    setSummaryNotifyTime,
    summaryNotifyInApp,
    setSummaryNotifyInApp,
    summaryNotifyWebPush,
    setSummaryNotifyWebPush,
    summaryNotifyEmail,
    setSummaryNotifyEmail,
    summaryMetrics,
    setSummaryMetrics,
    addToast,
    getSettingsSectionElementId,
}) => {
    const { t } = useDiscoverI18n();
    const tRef = useRef(t);
    tRef.current = t;
    const [status, setStatus] = useState<StatusPayload | null>(null);
    const [recent, setRecent] = useState<RecentItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [testing, setTesting] = useState(false);
    const [summaryBusy, setSummaryBusy] = useState(false);
    const [testChannels, setTestChannels] = useState(readStoredTestChannels);

    const eventLabels: Record<string, string> = useMemo(() => ({
        available: t('settings.notifications.events.available'),
        approved: t('settings.notifications.events.approved'),
        declined: t('settings.notifications.events.declined'),
        season: t('settings.notifications.events.season'),
        episode: t('settings.notifications.events.episode'),
        admin_pending: t('settings.notifications.events.admin_pending'),
        collexions_failed: t('settings.notifications.events.collexions_failed'),
        spotify_sync_failed: 'Spotify Sync failed',
        scanner_failed: t('settings.notifications.events.scanner_failed'),
        scanner_deleted: t('settings.notifications.events.scanner_deleted'),
        scanner_upgrade: t('settings.notifications.events.scanner_upgrade'),
        scanner_import: t('settings.notifications.events.scanner_import'),
        scanner_grab: t('settings.notifications.events.scanner_grab'),
        scanner_update: t('settings.notifications.events.scanner_update'),
        scanner_interaction: t('settings.notifications.events.scanner_interaction'),
        status_down: t('settings.notifications.events.status_down'),
        status_up: t('settings.notifications.events.status_up'),
        media_job_failed: t('settings.notifications.events.media_job_failed'),
        media_job_completed: t('settings.notifications.events.media_job_completed'),
        tautulli_api_failed: t('settings.notifications.events.tautulli_api_failed'),
        support_ticket: t('settings.notifications.events.support_ticket'),
        support_reply: t('settings.notifications.events.support_reply'),
        support_media_issue: t('settings.notifications.events.support_media_issue'),
    }), [t]);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [statusData, recentData] = await Promise.all([
                apiFetch('/api/admin/notifications/status'),
                apiFetch('/api/admin/notifications/recent?limit=40'),
            ]);
            setStatus(statusData || null);
            setRecent(Array.isArray(recentData?.items) ? recentData.items : []);
        } catch (error) {
            addToast(error instanceof Error ? error.message : tRef.current('settings.notifications.health.loadFailed'), 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const handleTest = async () => {
        const channels = Object.entries(testChannels)
            .filter(([, on]) => on)
            .map(([key]) => key);
        if (!channels.length) {
            addToast(tRef.current('settings.notifications.test.pickChannelError'), 'error');
            return;
        }
        setTesting(true);
        try {
            let subscribeError = '';
            if (channels.includes('webPush')) {
                try {
                    await subscribeWebPush();
                } catch (error) {
                    subscribeError = error instanceof Error
                        ? error.message
                        : tRef.current('settings.notifications.test.subscribeFailed');
                }
            }
            const result = await apiFetch('/api/admin/notifications/test', {
                method: 'POST',
                body: JSON.stringify({
                    channels,
                    title: 'Test notification',
                    body: 'This is a test from Settings → Notifications.',
                }),
            });
            const ok = !!result?.success;
            const bits = [
                result?.results?.inApp ? tRef.current('settings.notifications.test.results.inApp') : null,
                result?.results?.webPush ? tRef.current('settings.notifications.test.results.webPush') : null,
                result?.results?.email ? tRef.current('settings.notifications.test.results.email') : null,
                result?.results?.discord ? tRef.current('settings.notifications.test.results.discord') : null,
            ].filter(Boolean);
            if (result?.results?.inApp) {
                notifyInAppNotificationsChanged();
            }
            if (channels.includes('webPush') && !result?.results?.webPush) {
                const webErr = (Array.isArray(result?.results?.errors) ? result.results.errors : [])
                    .find((entry: string) => String(entry).toLowerCase().includes('webpush'));
                addToast(webErr || subscribeError || tRef.current('settings.notifications.test.webPushFailed'), 'error');
            } else if (ok) {
                addToast(tRef.current('settings.notifications.test.successToast', { channels: bits.join(', ') || tRef.current('settings.notifications.test.results.ok') }), 'success');
            } else {
                const errors = Array.isArray(result?.results?.errors) ? result.results.errors.join('; ') : tRef.current('settings.notifications.test.noChannelSucceeded');
                addToast(errors, 'error');
            }
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : tRef.current('settings.notifications.test.failed'), 'error');
        } finally {
            setTesting(false);
        }
    };

    const engine = status?.jobs?.requestEngine || '—';
    const notifyJob = engine === 'seerr'
        ? status?.jobs?.seerrAvailableNotify
        : status?.jobs?.requestStatusSync;

    return (
        <div className="mb-8 space-y-8">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h3 className="text-xl font-bold text-plex mb-1 border-b border-border pb-2 inline-flex items-center gap-2">
                        <Bell className="w-5 h-5" />
                        {t('settings.notifications.page.title')}
                    </h3>
                    <p className="text-sm text-muted max-w-2xl mt-2">
                        {t('settings.notifications.page.description')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={refresh}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm font-bold text-text hover:border-plex/40 hover:text-plex transition-colors disabled:opacity-50"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {t('settings.notifications.actions.refreshStatus')}
                </button>
            </div>

            <div id={getSettingsSectionElementId('notifications-status')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.health.title')}</h4>
                {loading && !status ? (
                    <p className="text-sm text-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('settings.notifications.common.loading')}</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        <Pill
                            ok={!!status?.requestAvailable?.enabled}
                            label={t('settings.notifications.health.requestAvailableLabel')}
                            detail={t('settings.notifications.health.requestAvailableDetail', { engine, total: status?.inApp?.total ?? 0, unread: status?.inApp?.unread ?? 0 })}
                            t={t}
                        />
                        <Pill
                            ok={!!status?.email?.smtpReady}
                            label={t('settings.notifications.health.emailSmtpLabel')}
                            detail={status?.email?.smtpReady ? t('settings.notifications.health.smtpConfigured') : t('settings.notifications.health.smtpConfigure')}
                            t={t}
                        />
                        <Pill
                            ok={!!status?.webPush?.enabled && !!status?.webPush?.vapidReady}
                            label={t('settings.notifications.common.webPush')}
                            detail={t('settings.notifications.health.webPushDetail', {
                                devices: status?.webPush?.deviceCount ?? 0,
                                users: status?.webPush?.usersWithSubscriptions ?? 0,
                                mine: status?.webPush?.thisUserDeviceCount ?? 0,
                            })}
                            t={t}
                        />
                        <Pill
                            ok={!!status?.discord?.enabled && !!status?.discord?.webhookConfigured}
                            label="Discord"
                            detail={status?.discord?.webhookConfigured ? t('settings.notifications.health.discordWebhookSaved') : t('settings.notifications.health.discordAddWebhook')}
                            t={t}
                        />
                        <Pill
                            ok={!!status?.gotify?.configured}
                            label="Gotify"
                            detail={status?.gotify?.configured ? t('settings.notifications.health.gotifyReady') : t('settings.notifications.health.gotifyConfigure')}
                            t={t}
                        />
                        <Pill
                            ok={!!status?.ntfy?.configured}
                            label={t('settings.notifications.common.ntfy')}
                            detail={status?.ntfy?.configured ? t('settings.notifications.health.ntfyReady') : t('settings.notifications.health.ntfyConfigure')}
                            t={t}
                        />
                        <Pill
                            ok={!!status?.webhook?.configured}
                            label={t('settings.notifications.common.webhook')}
                            detail={status?.webhook?.configured ? t('settings.notifications.health.webhookReady') : t('settings.notifications.health.webhookConfigure')}
                            t={t}
                        />
                        <Pill
                            ok={!notifyJob?.lastError}
                            label={engine === 'seerr' ? t('settings.notifications.health.seerrNotifyJob') : t('settings.notifications.health.portalStatusSync')}
                            detail={notifyJob?.lastError
                                ? t('settings.notifications.health.jobDetailWithError', { lastRun: formatWhen(notifyJob?.lastRun, t('settings.notifications.common.never')), error: notifyJob.lastError })
                                : t('settings.notifications.health.jobDetail', { lastRun: formatWhen(notifyJob?.lastRun, t('settings.notifications.common.never')) })}
                            t={t}
                        />
                    </div>
                )}
                {engine === 'seerr' && (
                    <p className="text-xs text-muted">
                        {t('settings.notifications.health.seerrSnapshot', { count: status?.seerrSnapshot?.trackedRequests ?? 0 })}
                        {status?.seerrSnapshot?.updatedAt ? ` · ${t('settings.notifications.health.seerrSnapshotUpdated', { date: formatWhen(status.seerrSnapshot.updatedAt, t('settings.notifications.common.never')) })}` : ''}.
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={onOpenSmtp} className="text-xs font-bold text-plex hover:underline">{t('settings.notifications.actions.openSmtpSettings')}</button>
                    <span className="text-muted text-xs">·</span>
                    <button type="button" onClick={onOpenGotify} className="text-xs font-bold text-plex hover:underline">{t('settings.notifications.actions.openGotifySettings')}</button>
                </div>
            </div>

            <div id={getSettingsSectionElementId('notifications-request-available')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.requestAvailable.title')}</h4>
                <p className="text-xs text-muted max-w-2xl">
                    {t('settings.notifications.requestAvailable.description')}
                </p>
                <SettingsToggleRow
                    title={t('settings.notifications.requestAvailable.enableTitle')}
                    description={t('settings.notifications.requestAvailable.enableDescription')}
                    checked={requestAvailableNotifyEnabled}
                    onChange={setRequestAvailableNotifyEnabled}
                    border={false}
                />
                <div className={requestAvailableNotifyEnabled ? 'space-y-0' : 'space-y-0 opacity-50 pointer-events-none'}>
                    <SettingsToggleRow
                        title={t('settings.notifications.common.email')}
                        description={t('settings.notifications.requestAvailable.emailDescription')}
                        checked={requestAvailableNotifyEmail}
                        onChange={setRequestAvailableNotifyEmail}
                        border={false}
                    />
                    <SettingsToggleRow
                        title={t('settings.notifications.common.inAppBell')}
                        description={t('settings.notifications.requestAvailable.inAppDescription')}
                        checked={requestAvailableNotifyInApp}
                        onChange={setRequestAvailableNotifyInApp}
                        border={false}
                    />
                    <SettingsToggleRow
                        title={t('settings.notifications.common.browserPush')}
                        description={t('settings.notifications.requestAvailable.browserPushDescription')}
                        checked={requestAvailableNotifyWebPush}
                        onChange={setRequestAvailableNotifyWebPush}
                        border={false}
                    />
                    <SettingsToggleRow
                        title={t('settings.notifications.requestAvailable.discordWebhookTitle')}
                        description={t('settings.notifications.requestAvailable.discordWebhookDescription')}
                        checked={requestAvailableNotifyDiscord}
                        onChange={setRequestAvailableNotifyDiscord}
                        border={false}
                    />
                    {requestAvailableNotifyDiscord && (
                        <div className="pt-1 pb-3">
                            <SettingFieldLabel htmlFor="notificationsDiscordWebhookUrl">
                                {t('settings.notifications.requestAvailable.discordWebhookUrl')}
                            </SettingFieldLabel>
                            <input
                                id="notificationsDiscordWebhookUrl"
                                type="password"
                                autoComplete="off"
                                className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                                placeholder="https://discord.com/api/webhooks/..."
                                value={requestAvailableDiscordWebhookUrl}
                                onChange={(e) => setRequestAvailableDiscordWebhookUrl(e.target.value)}
                            />
                            <p className="text-[11px] text-muted mt-1.5">
                                {t('settings.notifications.requestAvailable.discordWebhookSavedHint')}
                            </p>
                        </div>
                    )}
                </div>
                <SettingsToggleRow
                    title={t('settings.notifications.requestAvailable.webPushGlobalTitle')}
                    description={t('settings.notifications.requestAvailable.webPushGlobalDescription')}
                    checked={webPushEnabled}
                    onChange={setWebPushEnabled}
                    border={false}
                />
            </div>

            <div id={getSettingsSectionElementId('notifications-not-released')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.notReleased.title')}</h4>
                <p className="text-xs text-muted max-w-2xl">
                    {t('settings.notifications.notReleased.description')}
                </p>
                <SettingsToggleRow
                    title={t('settings.notifications.notReleased.enableTitle')}
                    description={t('settings.notifications.notReleased.enableDescription')}
                    checked={requestNotReleasedNotifyEnabled}
                    onChange={setRequestNotReleasedNotifyEnabled}
                    border={false}
                />
                <div className={requestNotReleasedNotifyEnabled ? 'space-y-3' : 'space-y-3 opacity-50 pointer-events-none'}>
                    <div className="w-full max-w-md">
                        <SettingFieldLabel htmlFor="notifyReleaseDatePreference">{t('settings.notifications.notReleased.preferredReleaseDate')}</SettingFieldLabel>
                        <CustomSelect
                            id="notifyReleaseDatePreference"
                            value={notifyReleaseDatePreference || 'digital'}
                            onChange={setNotifyReleaseDatePreference}
                            options={[
                                { value: 'digital', label: t('settings.notifications.notReleased.options.digital') },
                                { value: 'theatrical', label: t('settings.notifications.notReleased.options.theatrical') },
                                { value: 'physical', label: t('settings.notifications.notReleased.options.physical') },
                                { value: 'tmdb', label: t('settings.notifications.notReleased.options.tmdb') },
                            ]}
                            className="w-full"
                        />
                    </div>
                    <SettingsToggleRow
                        title={t('settings.notifications.common.email')}
                        checked={requestNotReleasedNotifyEmail}
                        onChange={setRequestNotReleasedNotifyEmail}
                        border={false}
                    />
                    <SettingsToggleRow
                        title={t('settings.notifications.common.inAppBell')}
                        checked={requestNotReleasedNotifyInApp}
                        onChange={setRequestNotReleasedNotifyInApp}
                        border={false}
                    />
                    <SettingsToggleRow
                        title={t('settings.notifications.common.browserPush')}
                        checked={requestNotReleasedNotifyWebPush}
                        onChange={setRequestNotReleasedNotifyWebPush}
                        border={false}
                    />
                </div>
            </div>

            <div id={getSettingsSectionElementId('notifications-scanner')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.scannerActivity.title')}</h4>
                <p className="text-xs text-muted max-w-2xl">
                    {t('settings.notifications.scannerActivity.description')}
                </p>
                <SettingsToggleRow
                    title={t('settings.notifications.scannerActivity.deletedTitle')}
                    description={t('settings.notifications.scannerActivity.deletedDescription')}
                    checked={scannerNotifyDeleted}
                    onChange={setScannerNotifyDeleted}
                    border={false}
                />
                <SettingsToggleRow
                    title={t('settings.notifications.scannerActivity.upgradeTitle')}
                    description={t('settings.notifications.scannerActivity.upgradeDescription')}
                    checked={scannerNotifyUpgrade}
                    onChange={setScannerNotifyUpgrade}
                    border={false}
                />
                <SettingsToggleRow
                    title={t('settings.notifications.scannerActivity.importTitle')}
                    description={t('settings.notifications.scannerActivity.importDescription')}
                    checked={scannerNotifyImport}
                    onChange={setScannerNotifyImport}
                    border={false}
                />
                <SettingsToggleRow
                    title={t('settings.notifications.scannerActivity.grabTitle')}
                    description={t('settings.notifications.scannerActivity.grabDescription')}
                    checked={scannerNotifyGrab}
                    onChange={setScannerNotifyGrab}
                    border={false}
                />
                <SettingsToggleRow
                    title={t('settings.notifications.scannerActivity.updateTitle')}
                    description={t('settings.notifications.scannerActivity.updateDescription')}
                    checked={scannerNotifyUpdate}
                    onChange={setScannerNotifyUpdate}
                    border={false}
                />
                <SettingsToggleRow
                    title={t('settings.notifications.scannerActivity.interactionTitle')}
                    description={t('settings.notifications.scannerActivity.interactionDescription')}
                    checked={scannerNotifyInteraction}
                    onChange={setScannerNotifyInteraction}
                    border={false}
                />
            </div>

            <div id={getSettingsSectionElementId('notifications-ntfy')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.common.ntfy')}</h4>
                <p className="text-xs text-muted max-w-2xl">
                    {t('settings.notifications.ntfy.description')}
                </p>
                <SettingsToggleRow
                    title={t('settings.notifications.ntfy.enableTitle')}
                    description={t('settings.notifications.ntfy.enableDescription')}
                    checked={ntfyEnabled}
                    onChange={setNtfyEnabled}
                    border={false}
                />
                <div className={ntfyEnabled ? 'space-y-3' : 'space-y-3 opacity-50 pointer-events-none'}>
                    <div>
                        <SettingFieldLabel htmlFor="ntfyServerUrl">{t('settings.notifications.ntfy.serverUrl')}</SettingFieldLabel>
                        <input
                            id="ntfyServerUrl"
                            className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                            placeholder="https://ntfy.sh"
                            value={ntfyServerUrl}
                            onChange={(e) => setNtfyServerUrl(e.target.value)}
                        />
                    </div>
                    <div>
                        <SettingFieldLabel htmlFor="ntfyTopic">{t('settings.notifications.ntfy.topic')}</SettingFieldLabel>
                        <input
                            id="ntfyTopic"
                            className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                            placeholder="server-manager-portal"
                            value={ntfyTopic}
                            onChange={(e) => setNtfyTopic(e.target.value)}
                        />
                    </div>
                    <div>
                        <SettingFieldLabel htmlFor="ntfyToken">{t('settings.notifications.ntfy.accessTokenOptional')}</SettingFieldLabel>
                        <input
                            id="ntfyToken"
                            type="password"
                            autoComplete="off"
                            className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                            value={ntfyToken}
                            onChange={(e) => setNtfyToken(e.target.value)}
                        />
                    </div>
                    <div className="w-full max-w-xs">
                        <SettingFieldLabel htmlFor="ntfyPriority">{t('settings.notifications.ntfy.priority')}</SettingFieldLabel>
                        <CustomSelect
                            id="ntfyPriority"
                            value={ntfyPriority}
                            onChange={(value) => setNtfyPriority(Math.max(1, Math.min(5, Number(value) || 3)))}
                            options={[
                                { value: 1, label: '1' },
                                { value: 2, label: '2' },
                                { value: 3, label: '3' },
                                { value: 4, label: '4' },
                                { value: 5, label: '5' },
                            ]}
                            className="w-full"
                        />
                    </div>
                    <div className="flex flex-wrap gap-3 pt-1">
                        {Object.keys(eventLabels).map((key) => (
                            <label key={key} className="inline-flex items-center gap-2 text-sm text-text cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={ntfyEvents?.[key] !== false}
                                    onChange={(e) => setNtfyEvents({ ...ntfyEvents, [key]: e.target.checked })}
                                    className="rounded border-border"
                                />
                                {eventLabels[key]}
                            </label>
                        ))}
                    </div>
                </div>
            </div>

            <div id={getSettingsSectionElementId('notifications-webhook')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.webhook.title')}</h4>
                <p className="text-xs text-muted max-w-2xl">
                    {t('settings.notifications.webhook.description')}
                </p>
                <SettingsToggleRow
                    title={t('settings.notifications.webhook.enableTitle')}
                    description={t('settings.notifications.webhook.enableDescription')}
                    checked={webhookEnabled}
                    onChange={setWebhookEnabled}
                    border={false}
                />
                <div className={webhookEnabled ? 'space-y-3' : 'space-y-3 opacity-50 pointer-events-none'}>
                    <div>
                        <SettingFieldLabel htmlFor="webhookUrl">{t('settings.notifications.webhook.url')}</SettingFieldLabel>
                        <input
                            id="webhookUrl"
                            type="password"
                            autoComplete="off"
                            className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                            placeholder="https://example.com/hooks/portal"
                            value={webhookUrl}
                            onChange={(e) => setWebhookUrl(e.target.value)}
                        />
                    </div>
                    <div>
                        <SettingFieldLabel htmlFor="webhookHeadersJson">{t('settings.notifications.webhook.extraHeadersJson')}</SettingFieldLabel>
                        <textarea
                            id="webhookHeadersJson"
                            className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px] min-h-[72px]"
                            placeholder={'{"Authorization":"Bearer …"}'}
                            value={webhookHeadersJson}
                            onChange={(e) => setWebhookHeadersJson(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-wrap gap-3 pt-1">
                        {Object.keys(eventLabels).map((key) => (
                            <label key={key} className="inline-flex items-center gap-2 text-sm text-text cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={!!webhookEvents?.[key]}
                                    onChange={(e) => setWebhookEvents({ ...webhookEvents, [key]: e.target.checked })}
                                    className="rounded border-border"
                                />
                                {eventLabels[key]}
                            </label>
                        ))}
                    </div>
                    <SettingHint>
                        {t('settings.notifications.webhook.defaultsHint')}
                    </SettingHint>
                </div>
            </div>

            <div id={getSettingsSectionElementId('notifications-summary')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">Smart summary notifications</h4>
                <p className="text-xs text-muted max-w-2xl">
                    Scheduled digest for admins with uptime, requests, imports, ColleXions rotations, and media automation jobs.
                    Clicking the notification opens a rich summary card in the portal.
                </p>
                <SettingsToggleRow
                    title="Enable smart summaries"
                    description="Send a scheduled snapshot to admins (in-app bell, optional push/email)."
                    checked={summaryNotifyEnabled}
                    onChange={setSummaryNotifyEnabled}
                    border={false}
                />
                <div className={summaryNotifyEnabled ? 'space-y-3' : 'space-y-3 opacity-50 pointer-events-none'}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <SettingFieldLabel htmlFor="summaryNotifyFrequency">Frequency</SettingFieldLabel>
                            <CustomSelect
                                id="summaryNotifyFrequency"
                                value={summaryNotifyFrequency}
                                onChange={setSummaryNotifyFrequency}
                                options={[
                                    { value: 'disabled', label: 'Disabled' },
                                    { value: 'daily', label: 'Daily' },
                                    { value: 'weekly', label: 'Weekly' },
                                    { value: 'monthly', label: 'Monthly' },
                                ]}
                                className="w-full"
                            />
                        </div>
                        {summaryNotifyFrequency === 'weekly' ? (
                            <div>
                                <SettingFieldLabel htmlFor="summaryNotifyDay">Send day</SettingFieldLabel>
                                <CustomSelect
                                    id="summaryNotifyDay"
                                    value={summaryNotifyDay}
                                    onChange={(value) => setSummaryNotifyDay(Number(value) || 0)}
                                    options={[
                                        { value: 0, label: 'Sunday' },
                                        { value: 1, label: 'Monday' },
                                        { value: 2, label: 'Tuesday' },
                                        { value: 3, label: 'Wednesday' },
                                        { value: 4, label: 'Thursday' },
                                        { value: 5, label: 'Friday' },
                                        { value: 6, label: 'Saturday' },
                                    ]}
                                    className="w-full"
                                />
                            </div>
                        ) : summaryNotifyFrequency === 'monthly' ? (
                            <div>
                                <SettingFieldLabel htmlFor="summaryNotifyDay">Day of month</SettingFieldLabel>
                                <input
                                    id="summaryNotifyDay"
                                    type="number"
                                    min={1}
                                    max={28}
                                    className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                                    value={summaryNotifyDay}
                                    onChange={(e) => setSummaryNotifyDay(Number(e.target.value) || 1)}
                                />
                            </div>
                        ) : null}
                        <div>
                            <SettingFieldLabel htmlFor="summaryNotifyTime">Send time</SettingFieldLabel>
                            <input
                                id="summaryNotifyTime"
                                type="time"
                                className="appearance-none text-[16px] leading-5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[16px]"
                                value={summaryNotifyTime}
                                onChange={(e) => setSummaryNotifyTime(e.target.value || '23:00')}
                            />
                            <SettingHint>
                                Sent at this exact time. Building the digest can take a short moment after that.
                            </SettingHint>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-4">
                        <SettingsToggleRow
                            title="In-app bell"
                            checked={summaryNotifyInApp}
                            onChange={setSummaryNotifyInApp}
                            border={false}
                        />
                        <SettingsToggleRow
                            title="Web push"
                            checked={summaryNotifyWebPush}
                            onChange={setSummaryNotifyWebPush}
                            border={false}
                        />
                        <SettingsToggleRow
                            title="Email"
                            description="Requires SMTP in this tab."
                            checked={summaryNotifyEmail}
                            onChange={setSummaryNotifyEmail}
                            border={false}
                        />
                    </div>
                    <div>
                        <SettingFieldLabel>Metrics to include</SettingFieldLabel>
                        <div className="flex flex-wrap gap-3 pt-1">
                            {([
                                ['uptime', 'Uptime'],
                                ['requests', 'Requests'],
                                ['scannerImports', 'Scanner imports'],
                                ['collexionsRotations', 'ColleXions rotations'],
                                ['mediaAutomationJobs', 'Media automation jobs'],
                                ['highlights', 'Highlights'],
                            ] as const).map(([key, label]) => (
                                <label key={key} className="inline-flex items-center gap-2 text-sm text-text cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={summaryMetrics?.[key] !== false}
                                        onChange={(e) => setSummaryMetrics({ ...summaryMetrics, [key]: e.target.checked })}
                                        className="rounded border-border"
                                    />
                                    {label}
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                        <button
                            type="button"
                            className="px-4 py-2 rounded-lg bg-plex text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                            disabled={summaryBusy}
                            onClick={() => {
                                setSummaryBusy(true);
                                void (async () => {
                                    try {
                                        await apiFetch('/api/admin/summary-digest/send-now', { method: 'POST' });
                                        notifyInAppNotificationsChanged();
                                        addToast('Summary digest sent to admins.', 'success');
                                    } catch (error) {
                                        addToast(error instanceof Error ? error.message : 'Failed to send summary digest.', 'error');
                                    } finally {
                                        setSummaryBusy(false);
                                    }
                                })();
                            }}
                        >
                            {summaryBusy ? 'Sending…' : 'Send now'}
                        </button>
                        <button
                            type="button"
                            className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-white/5 transition-colors"
                            onClick={() => navigateToSummaryDigest('latest')}
                        >
                            View last summary
                        </button>
                    </div>
                </div>
            </div>

            <NotificationTemplatesPanel
                notificationTemplates={notificationTemplates}
                setNotificationTemplates={setNotificationTemplates}
                defaults={notificationTemplateDefaults}
                events={notificationTemplateEvents}
                eventFields={notificationTemplateFields}
                getSettingsSectionElementId={getSettingsSectionElementId}
            />

            <div className="rounded-lg border border-border bg-background/40 p-4">
                <SettingFieldLabel hint={<SettingHint>{t('settings.notifications.saveReminder.hint')}</SettingHint>}>
                    {t('settings.notifications.saveReminder.title')}
                </SettingFieldLabel>
            </div>

            <div id={getSettingsSectionElementId('notifications-test')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.test.title')}</h4>
                <p className="text-xs text-muted max-w-2xl">
                    {t('settings.notifications.test.description')}
                </p>
                <div className="flex flex-wrap gap-4">
                    {([
                        ['inApp', t('settings.notifications.common.inAppBell')],
                        ['webPush', t('settings.notifications.common.webPush')],
                        ['email', t('settings.notifications.common.email')],
                        ['discord', 'Discord'],
                        ['ntfy', t('settings.notifications.common.ntfy')],
                        ['webhook', t('settings.notifications.common.webhook')],
                    ] as const).map(([key, label]) => (
                        <label key={key} className="inline-flex items-center gap-2 text-sm text-text cursor-pointer">
                            <input
                                type="checkbox"
                                checked={!!testChannels[key]}
                                onChange={(e) => setTestChannels((prev) => {
                                    const next = { ...prev, [key]: e.target.checked };
                                    persistTestChannels(next);
                                    return next;
                                })}
                                className="rounded border-border"
                            />
                            {label}
                        </label>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={handleTest}
                    disabled={testing}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-plex text-background font-bold hover:bg-plex-hover transition-colors disabled:opacity-50"
                >
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {testing ? t('settings.notifications.test.sending') : t('settings.notifications.test.send')}
                </button>
            </div>

            <div id={getSettingsSectionElementId('notifications-recent')} className="scroll-mt-24 space-y-3">
                <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.history.title')}</h4>
                <p className="text-xs text-muted">
                    {t('settings.notifications.history.description')}
                </p>
                {!recent.length ? (
                    <div className="rounded-xl border border-border bg-background/40 px-4 py-8 text-center text-sm text-muted">
                        {t('settings.notifications.history.empty')}
                    </div>
                ) : (
                    <RecentNotificationsHistory items={recent} t={t} />
                )}
            </div>
        </div>
    );
};

export default NotificationsSettingsTab;
