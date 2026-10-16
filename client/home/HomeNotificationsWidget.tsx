import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Inbox } from 'lucide-react';
import { apiFetch } from '../shared/api';
import {
    IN_APP_NOTIFICATIONS_CHANGED_EVENT,
    notifyInAppNotificationsChanged,
    openInAppNotifications,
} from '../shared/inAppNotificationsRefresh';
import { resolveNotificationDestination } from '../shared/notificationDestination';
import { navigateToSummaryDigest } from '../shared/SummaryDigestCard';
import { resolveTmdbImageUrl } from '../discovery/tmdbImageUrl';
import { resolvePortalAssetUrl } from '../shared/basePath';
import type { DiscoverTranslate } from '../discovery/i18n/types';
import type { InAppNotification } from '../shared/InAppNotificationsBell';

type NavigateFn = (route: string, options?: { path?: string; reviewId?: number }) => void;

type Props = {
    t: DiscoverTranslate;
    onNavigate?: NavigateFn;
};

const MAX_ROWS = 5;

const formatRelative = (iso: string | undefined, t: DiscoverTranslate) => {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return t('common.justNow');
    if (mins < 60) return t('common.minutesAgo', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 48) return t('common.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('common.daysAgo', { count: days });
};

const posterSrc = (item: InAppNotification) => {
    const url = String(item.meta?.posterUrl || '').trim();
    if (url) return resolvePortalAssetUrl(url);
    return resolveTmdbImageUrl(String(item.meta?.posterPath || ''), 'w92');
};

const goToDestination = (item: InAppNotification, onNavigate?: NavigateFn) => {
    const dest = resolveNotificationDestination(item);
    if (dest.kind === 'discovery') {
        onNavigate?.('discovery', { path: dest.path });
        return;
    }
    if (dest.kind === 'requests') {
        onNavigate?.('requests', dest.reviewId ? { reviewId: dest.reviewId } : undefined);
        return;
    }
    if (dest.kind === 'home') {
        onNavigate?.('user');
        return;
    }
    if (dest.kind === 'settings') {
        onNavigate?.('settings');
        return;
    }
    if (dest.kind === 'support') {
        onNavigate?.('support', { path: dest.path });
        return;
    }
    if (dest.kind === 'route') {
        onNavigate?.(dest.route);
        return;
    }
    if (dest.kind === 'summary') {
        navigateToSummaryDigest(dest.digestId || 'latest');
        return;
    }
    if (dest.kind === 'external' && dest.href.startsWith('/')) {
        window.location.assign(dest.href);
        return;
    }
    onNavigate?.('discovery', { path: '/discovery/requests' });
};

export const HomeNotificationsWidget: React.FC<Props> = ({ t, onNavigate }) => {
    const [items, setItems] = useState<InAppNotification[]>([]);
    const [unread, setUnread] = useState(0);
    const [loaded, setLoaded] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const data = await apiFetch('/api/notifications?limit=8');
            setItems(Array.isArray(data?.items) ? data.items : []);
            setUnread(Number(data?.unread) || 0);
        } catch {
            setItems([]);
            setUnread(0);
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        refresh();
        const onChanged = () => { refresh(); };
        const onFocus = () => { refresh(); };
        window.addEventListener(IN_APP_NOTIFICATIONS_CHANGED_EVENT, onChanged);
        window.addEventListener('focus', onFocus);
        return () => {
            window.removeEventListener(IN_APP_NOTIFICATIONS_CHANGED_EVENT, onChanged);
            window.removeEventListener('focus', onFocus);
        };
    }, [refresh]);

    const openItem = async (item: InAppNotification) => {
        if (!item.readAt) {
            try {
                await apiFetch('/api/notifications/read', {
                    method: 'POST',
                    body: JSON.stringify({ ids: [item.id] }),
                });
                setItems((prev) => prev.map((row) => (
                    row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row
                )));
                setUnread((n) => Math.max(0, n - 1));
                notifyInAppNotificationsChanged();
            } catch {
                // still navigate
            }
        }
        goToDestination(item, onNavigate);
    };

    if (!loaded) {
        return (
            <div className="glass-card p-4 md:p-5 shadow-xl flex-shrink-0 animate-pulse">
                <div className="h-3 w-28 bg-white/10 rounded mb-3" />
                <div className="space-y-2">
                    <div className="h-10 bg-white/5 rounded" />
                    <div className="h-10 bg-white/5 rounded" />
                </div>
            </div>
        );
    }
    if (!items.length && unread <= 0) return null;

    const rows = items.slice(0, MAX_ROWS);

    return (
        <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col flex-shrink-0">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                    <p className="text-muted text-xs uppercase tracking-widest font-semibold flex items-center gap-2">
                        <Bell className="w-3.5 h-3.5 text-plex shrink-0" />
                        {t('homeDashboard.homeNotifications.title')}
                    </p>
                    <p className="text-xs text-muted mt-1">
                        {unread > 0
                            ? t('notifications.unreadCount', { count: unread })
                            : t('notifications.allCaughtUp')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => openInAppNotifications()}
                    className="shrink-0 text-xs font-bold text-plex hover:underline"
                >
                    {t('common.viewAll')}
                </button>
            </div>
            {rows.length ? (
                <ul className="space-y-1.5">
                    {rows.map((item) => {
                        const poster = posterSrc(item);
                        const unreadItem = !item.readAt;
                        return (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    onClick={() => openItem(item)}
                                    className={`w-full flex items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                                        unreadItem
                                            ? 'border-plex/25 bg-plex/5 hover:bg-plex/10'
                                            : 'border-white/5 bg-background/40 hover:bg-white/5'
                                    }`}
                                >
                                    {poster ? (
                                        <img
                                            src={poster}
                                            alt=""
                                            className="w-8 h-12 rounded object-cover shrink-0 bg-black/40"
                                        />
                                    ) : (
                                        <span className="w-8 h-12 rounded bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                            <Inbox className="w-3.5 h-3.5 text-muted" />
                                        </span>
                                    )}
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5">
                                            {unreadItem ? (
                                                <span className="w-1.5 h-1.5 rounded-full bg-plex shrink-0" />
                                            ) : null}
                                            <span className="text-sm font-semibold text-text truncate">{item.title}</span>
                                        </span>
                                        {item.body ? (
                                            <span className="block text-[11px] text-muted line-clamp-2 mt-0.5">{item.body}</span>
                                        ) : null}
                                        <span className="block text-[10px] text-muted/70 mt-0.5">
                                            {formatRelative(item.createdAt, t)}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p className="text-sm text-muted">{t('notifications.empty')}</p>
            )}
        </div>
    );
};
