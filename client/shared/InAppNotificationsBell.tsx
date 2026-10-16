import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    BarChart3,
    Bell,
    Calendar,
    CheckCheck,
    ChevronDown,
    ChevronRight,
    CircleCheck,
    CircleX,
    Clapperboard,
    ClipboardList,
    Inbox,
    LifeBuoy,
    Radar,
    Layers,
    Music,
    AlertTriangle,
    Cpu,
    Download,
    Sparkles,
    Trash2,
    Tv,
    X,
} from 'lucide-react';
import { apiFetch } from './api';
import { IN_APP_NOTIFICATIONS_CHANGED_EVENT, OPEN_IN_APP_NOTIFICATIONS_EVENT, notifyInAppNotificationsChanged } from './inAppNotificationsRefresh';
import { resolveNotificationDestination } from './notificationDestination';
import { navigateToSummaryDigest } from './SummaryDigestCard';
import { stackInAppNotifications } from './notificationStacks';
import { getNotificationRepeatEntries, type NotificationRepeatEntry } from './notificationRepeats';
import { resolveTmdbImageUrl } from '../discovery/tmdbImageUrl';
import { useDiscoverI18n } from '../discovery/i18n';
import type { DiscoverTranslate } from '../discovery/i18n/types';
import { resolvePortalAssetUrl } from './basePath';

export type InAppNotification = {
    id: string;
    type?: string;
    title: string;
    body?: string;
    href?: string;
    readAt?: string | null;
    createdAt?: string;
    meta?: {
        requestId?: string | number | null;
        mediaType?: string | null;
        tmdbId?: string | number | null;
        posterUrl?: string | null;
        posterPath?: string | null;
        [key: string]: unknown;
    };
};

const ARR_SERVICE_KINDS = new Set(['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr']);
const ARR_SERVICE_MARK_RE = /^(📺|🎬|🎵|📚|🎞)\s+/u;

const arrServiceKindFromItem = (item: InAppNotification) => {
    const kind = String(item.meta?.serviceKind || '').toLowerCase();
    return ARR_SERVICE_KINDS.has(kind) ? kind : '';
};

const ArrServiceLogo: React.FC<{ item: InAppNotification }> = ({ item }) => {
    const kind = arrServiceKindFromItem(item);
    if (!kind) return null;
    const label = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
    return (
        <img
            src={resolvePortalAssetUrl(`/static/applets/${kind}.png`)}
            alt=""
            title={label}
            className="mr-1 inline-block h-3.5 w-3.5 shrink-0 object-contain align-[-0.15em]"
        />
    );
};

const NotificationBodyText: React.FC<{
    item: InAppNotification;
    body?: string;
    className?: string;
}> = ({ item, body, className }) => {
    const raw = String(body || item.body || '');
    if (!raw) return null;
    const text = arrServiceKindFromItem(item) ? raw.replace(ARR_SERVICE_MARK_RE, '') : raw;
    return (
        <p className={className}>
            <ArrServiceLogo item={item} />
            {text}
        </p>
    );
};

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

const typeVisual = (type?: string) => {
    switch (String(type || '')) {
        case 'request_available':
            return {
                Icon: CircleCheck,
                tone: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/35',
                tile: 'from-emerald-500/30 via-emerald-500/10 to-card',
            };
        case 'request_approved':
            return {
                Icon: Sparkles,
                tone: 'text-plex bg-plex/15 border-plex/35',
                tile: 'from-plex/30 via-plex/10 to-card',
            };
        case 'request_declined':
            return {
                Icon: CircleX,
                tone: 'text-rose-400 bg-rose-500/15 border-rose-500/35',
                tile: 'from-rose-500/30 via-rose-500/10 to-card',
            };
        case 'request_season_available':
            return {
                Icon: Tv,
                tone: 'text-sky-400 bg-sky-500/15 border-sky-500/35',
                tile: 'from-sky-500/30 via-sky-500/10 to-card',
            };
        case 'request_new_episode':
            return {
                Icon: Clapperboard,
                tone: 'text-violet-300 bg-violet-500/15 border-violet-500/35',
                tile: 'from-violet-500/30 via-violet-500/10 to-card',
            };
        case 'admin_pending':
            return {
                Icon: ClipboardList,
                tone: 'text-amber-300 bg-amber-500/15 border-amber-500/35',
                tile: 'from-amber-400/30 via-amber-500/10 to-card',
            };
        case 'request_not_released':
            return {
                Icon: Calendar,
                tone: 'text-sky-300 bg-sky-500/15 border-sky-500/35',
                tile: 'from-cyan-500/25 via-sky-500/10 to-card',
            };
        case 'admin_test':
            return {
                Icon: Bell,
                tone: 'text-plex bg-plex/15 border-plex/35',
                tile: 'from-plex/25 via-plex/10 to-card',
            };
        case 'summary_digest':
            return {
                Icon: BarChart3,
                tone: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/35',
                tile: 'from-cyan-500/25 via-cyan-500/10 to-card',
            };
        case 'support_ticket':
        case 'support_reply':
        case 'support_media_issue':
            return {
                Icon: LifeBuoy,
                tone: 'text-plex bg-plex/15 border-plex/35',
                tile: 'from-orange-400/25 via-plex/10 to-card',
            };
        case 'collexions_failed':
            return {
                Icon: Layers,
                tone: 'text-rose-400 bg-rose-500/15 border-rose-500/35',
                tile: 'from-rose-500/30 via-fuchsia-500/10 to-card',
            };
        case 'spotify_sync_failed':
            return {
                Icon: Music,
                tone: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/35',
                tile: 'from-emerald-500/25 via-green-500/10 to-card',
            };
        case 'scanner_failed':
            return {
                Icon: Radar,
                tone: 'text-amber-300 bg-amber-500/15 border-amber-500/35',
                tile: 'from-amber-500/30 via-orange-500/10 to-card',
            };
        case 'scanner_deleted':
            return {
                Icon: Trash2,
                tone: 'text-rose-400 bg-rose-500/15 border-rose-500/35',
                tile: 'from-rose-500/30 via-orange-500/10 to-card',
            };
        case 'scanner_upgrade':
            return {
                Icon: Sparkles,
                tone: 'text-plex bg-plex/15 border-plex/35',
                tile: 'from-plex/30 via-amber-500/10 to-card',
            };
        case 'scanner_import':
            return {
                Icon: CircleCheck,
                tone: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/35',
                tile: 'from-emerald-500/30 via-teal-500/10 to-card',
            };
        case 'scanner_grab':
            return {
                Icon: Download,
                tone: 'text-sky-400 bg-sky-500/15 border-sky-500/35',
                tile: 'from-sky-500/30 via-cyan-500/10 to-card',
            };
        case 'scanner_update':
            return {
                Icon: Sparkles,
                tone: 'text-indigo-400 bg-indigo-500/15 border-indigo-500/35',
                tile: 'from-indigo-500/30 via-violet-500/10 to-card',
            };
        case 'scanner_interaction':
            return {
                Icon: AlertTriangle,
                tone: 'text-orange-400 bg-orange-500/15 border-orange-500/35',
                tile: 'from-orange-500/30 via-amber-500/10 to-card',
            };
        case 'status_down':
            return {
                Icon: AlertTriangle,
                tone: 'text-rose-400 bg-rose-500/15 border-rose-500/35',
                tile: 'from-rose-600/35 via-rose-500/10 to-card',
            };
        case 'status_up':
            return {
                Icon: CircleCheck,
                tone: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/35',
                tile: 'from-emerald-400/30 via-teal-500/10 to-card',
            };
        case 'media_job_failed':
            return {
                Icon: CircleX,
                tone: 'text-rose-400 bg-rose-500/15 border-rose-500/35',
                tile: 'from-rose-500/30 via-orange-500/10 to-card',
            };
        case 'media_job_completed':
            return {
                Icon: Cpu,
                tone: 'text-plex bg-plex/15 border-plex/35',
                tile: 'from-plex/30 via-sky-500/10 to-card',
            };
        default:
            return {
                Icon: Inbox,
                tone: 'text-plex bg-plex/15 border-plex/35',
                tile: 'from-plex/20 via-white/5 to-card',
            };
    }
};

const STACK_TITLE_TYPES = new Set([
    'request_available',
    'request_approved',
    'request_declined',
    'request_season_available',
    'request_new_episode',
    'admin_pending',
    'request_not_released',
    'support_ticket',
    'collexions_failed',
    'spotify_sync_failed',
    'scanner_failed',
    'scanner_deleted',
    'scanner_upgrade',
    'scanner_import',
    'scanner_grab',
    'scanner_update',
    'scanner_interaction',
    'status_down',
    'status_up',
    'media_job_failed',
    'media_job_completed',
]);

const stackTitle = (type: string, count: number, t: DiscoverTranslate) => {
    const key = STACK_TITLE_TYPES.has(type) ? `notifications.stack.${type}` : 'notifications.stack.generic';
    return t(key, { count });
};

const posterSrcFor = (item: InAppNotification) => {
    const url = String(item.meta?.posterUrl || '').trim();
    if (url) return url;
    return resolveTmdbImageUrl(String(item.meta?.posterPath || ''), 'w185');
};

const STACK_FAN_X = 12;
const STACK_FAN_Y = 10;

/** Poster tile: mobile 40×56px; desktop md+ 48×72px (2:3). */
const NOTIF_ARTWORK_SIZE = 'h-14 w-10 md:h-[4.5rem] md:w-12';
const NOTIF_ARTWORK_STACK_FAN = 'w-[calc(2.5rem+12px)] h-[calc(3.5rem+10px)] md:w-[calc(3rem+12px)] md:h-[calc(4.5rem+10px)]';
const NOTIF_ARTWORK_STACK_SINGLE = 'w-10 h-14 md:w-12 md:h-[4.5rem]';

const NotificationArtwork: React.FC<{
    item: InAppNotification;
    hoverLift?: boolean;
    peek?: boolean;
}> = ({
    item,
    hoverLift = true,
    peek = false,
}) => {
    const [broken, setBroken] = useState(false);
    const posterSrc = posterSrcFor(item);
    const showPoster = Boolean(posterSrc) && !broken;
    const { Icon, tone, tile } = typeVisual(item.type);

    return (
        <span
            className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border ${NOTIF_ARTWORK_SIZE} ${
                peek
                    ? 'shadow-none opacity-70'
                    : 'shadow-[0_6px_14px_rgba(0,0,0,0.28)]'
            } ${
                hoverLift && !peek ? 'mt-0.5 transition-transform duration-300 ease-out group-hover:scale-[1.06] group-hover:-translate-y-0.5' : ''
            } ${showPoster ? 'border-white/15 bg-black/40' : `border ${tone} bg-gradient-to-br ${tile}`}`}
        >
            {showPoster ? (
                <img
                    src={posterSrc}
                    alt=""
                    className={`h-full w-full object-cover ${hoverLift && !peek ? 'transition-transform duration-500 ease-out group-hover:scale-110' : ''}`}
                    onError={() => setBroken(true)}
                />
            ) : (
                <Icon className="h-4 w-4 md:h-5 md:w-5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)]" />
            )}
            {showPoster && !peek && (
                <span className={`absolute bottom-0.5 right-0.5 inline-flex h-4 w-4 md:h-5 md:w-5 items-center justify-center rounded-md border shadow-sm ${tone}`}>
                    <Icon className="h-2.5 w-2.5 md:h-3 md:w-3" />
                </span>
            )}
        </span>
    );
};

const StackedArtwork: React.FC<{ items: InAppNotification[]; count: number }> = ({ items, count }) => {
    const posters = items.filter((item) => Boolean(posterSrcFor(item))).slice(0, 2);
    const fan = posters.length >= 2;
    const front = fan ? posters[0] : items[0];
    const back = fan ? posters[1] : null;
    if (!front) return null;
    return (
        <span
            className={`relative inline-flex shrink-0 items-start ${back ? NOTIF_ARTWORK_STACK_FAN : NOTIF_ARTWORK_STACK_SINGLE}`}
        >
            {back && (
                <span
                    className="absolute overflow-hidden rounded-xl"
                    style={{ left: STACK_FAN_X, top: STACK_FAN_Y, zIndex: 1 }}
                >
                    <NotificationArtwork item={back} hoverLift={false} peek />
                </span>
            )}
            <span className="relative z-[2] inline-flex shrink-0">
                <NotificationArtwork item={front} hoverLift={false} />
                {count > 1 && (
                    <span className="absolute -right-1 -top-1 z-20 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-plex/40 bg-plex px-1 text-[9px] font-black leading-none text-background tabular-nums shadow-sm">
                        {count > 99 ? '99+' : count}
                    </span>
                )}
            </span>
        </span>
    );
};

const RepeatEntryRow: React.FC<{
    entry: NotificationRepeatEntry;
    item: InAppNotification;
    t: DiscoverTranslate;
    onOpen: (item: InAppNotification) => void;
}> = ({ entry, item, t, onOpen }) => {
    const displayItem: InAppNotification = {
        ...item,
        body: entry.body,
        createdAt: entry.createdAt || item.createdAt,
        meta: {
            ...item.meta,
            posterUrl: entry.posterUrl ?? item.meta?.posterUrl,
            posterPath: entry.posterPath ?? item.meta?.posterPath,
        },
    };
    return (
        <button
            type="button"
            onClick={() => onOpen(item)}
            className="notif-row-btn w-full text-left rounded-xl px-1.5 py-1 transition-all duration-200 hover:bg-plex/[0.07] focus-visible:outline-none focus-visible:bg-plex/10"
        >
            <div className="flex items-start gap-2.5 md:gap-3">
                <NotificationArtwork item={displayItem} hoverLift={false} />
                <div className="min-w-0 flex-1">
                    <NotificationBodyText
                        item={displayItem}
                        body={entry.body}
                        className="text-sm text-muted leading-relaxed"
                    />
                    <span className="mt-1 block text-xs text-muted/80">
                        {formatRelative(entry.createdAt || item.createdAt, t)}
                    </span>
                </div>
            </div>
        </button>
    );
};

const NotificationItemRow: React.FC<{
    item: InAppNotification;
    t: DiscoverTranslate;
    onOpen: (item: InAppNotification) => void;
    onRemove: (item: InAppNotification) => void;
    compact?: boolean;
    expanded?: boolean;
    onToggleExpand?: () => void;
}> = ({ item, t, onOpen, onRemove, compact = false, expanded = false, onToggleExpand }) => {
    const unreadItem = !item.readAt;
    const dest = resolveNotificationDestination(item);
    const repeatEntries = getNotificationRepeatEntries(item);
    const repeatCount = Math.max(repeatEntries.length, Number(item?.meta?.repeatCount || 1));
    const isRepeatGroup = repeatEntries.length > 1 && !compact;
    const latestEntry = repeatEntries[0];
    const displayBody = latestEntry?.body || item.body;
    const displayCreatedAt = latestEntry?.createdAt || item.createdAt;

    if (isRepeatGroup) {
        return (
            <>
                <div
                    className={`group relative flex items-start ${
                        compact ? 'px-2 sm:px-3 py-1.5' : 'px-2 sm:px-3 py-2'
                    } ${unreadItem ? 'bg-plex/[0.045]' : ''}`}
                >
                    {unreadItem && (
                        <span className={`notif-unread-bar absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${item.type === 'media_job_completed' ? 'bg-emerald-500' : 'bg-plex'}`} />
                    )}
                    <button
                        type="button"
                        onClick={onToggleExpand}
                        aria-expanded={expanded}
                        aria-label={expanded
                            ? t('notifications.repeat.collapse')
                            : t('notifications.repeat.expand', { count: repeatCount })}
                        className={`notif-row-btn min-w-0 flex-1 text-left rounded-xl px-1.5 py-1 transition-all duration-200 hover:bg-plex/[0.07] focus-visible:outline-none focus-visible:bg-plex/10 ${
                            compact ? 'py-1' : 'py-1.5'
                        }`}
                    >
                        <div className="flex items-start gap-2.5 md:gap-3">
                            <NotificationArtwork item={item} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                    <p className={`text-sm leading-snug ${unreadItem ? 'font-bold text-text' : 'font-semibold text-text/90'}`}>
                                        {item.title}
                                    </p>
                                    <span className="shrink-0 rounded-md border border-plex/30 bg-plex/10 px-1.5 py-0.5 text-xs font-bold text-plex">
                                        {t('notifications.repeats', { count: repeatCount })}
                                    </span>
                                    <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${expanded ? 'rotate-180 text-plex' : 'group-hover:text-plex'}`} />
                                </div>
                                {displayBody ? (
                                    <NotificationBodyText
                                        item={item}
                                        body={displayBody}
                                        className="text-sm text-muted mt-0.5 line-clamp-2 leading-relaxed"
                                    />
                                ) : null}
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                                    <span className="text-muted/80">{formatRelative(displayCreatedAt, t)}</span>
                                    <span className="text-border">·</span>
                                    <span className="font-semibold text-plex/90 transition-colors duration-200 group-hover:text-plex">
                                        {t(dest.labelKey)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={() => onRemove(item)}
                        aria-label={t('notifications.removeAria')}
                        title={t('notifications.remove')}
                        className="mt-1.5 mr-0.5 shrink-0 rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-text focus-visible:outline-none focus-visible:bg-white/10"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
                {expanded ? (
                    <ul className="border-t border-border/40 bg-black/20">
                        {repeatEntries.map((entry, index) => (
                            <li key={`${item.id}-repeat-${index}`} className="border-b border-border/30 last:border-b-0 px-2 sm:px-3 py-1">
                                <RepeatEntryRow entry={entry} item={item} t={t} onOpen={onOpen} />
                            </li>
                        ))}
                    </ul>
                ) : null}
            </>
        );
    }

    return (
        <div
            className={`group relative flex items-start ${
                compact ? 'px-2 sm:px-3 py-1.5' : 'px-2 sm:px-3 py-2'
            } ${unreadItem ? 'bg-plex/[0.045]' : ''}`}
        >
            {unreadItem && (
                <span className={`notif-unread-bar absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${item.type === 'media_job_completed' ? 'bg-emerald-500' : 'bg-plex'}`} />
            )}
            <button
                type="button"
                onClick={() => onOpen(item)}
                className={`notif-row-btn min-w-0 flex-1 text-left rounded-xl px-1.5 py-1 transition-all duration-200 hover:bg-plex/[0.07] focus-visible:outline-none focus-visible:bg-plex/10 ${
                    compact ? 'py-1' : 'py-1.5'
                }`}
            >
                <div className="flex items-start gap-2.5 md:gap-3">
                    <NotificationArtwork item={item} />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm leading-snug ${unreadItem ? 'font-bold text-text' : 'font-semibold text-text/90'}`}>
                                {item.title}
                            </p>
                            {repeatCount > 1 && (
                                <span className="shrink-0 rounded-md border border-plex/30 bg-plex/10 px-1.5 py-0.5 text-xs font-bold text-plex">
                                    {t('notifications.repeats', { count: repeatCount })}
                                </span>
                            )}
                            {!compact && repeatCount > 1 && repeatEntries.length <= 1 ? null : (
                                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-plex" />
                            )}
                        </div>
                        {item.body ? (
                            <NotificationBodyText
                                item={item}
                                className="text-sm text-muted mt-0.5 line-clamp-2 leading-relaxed"
                            />
                        ) : null}
                        {repeatCount > 1 && repeatEntries.length <= 1 ? (
                            <p className="text-[11px] text-muted/70 mt-1">{t('notifications.repeat.legacyHint', { count: repeatCount })}</p>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                            <span className="text-muted/80">{formatRelative(item.createdAt, t)}</span>
                            <span className="text-border">·</span>
                            <span className="font-semibold text-plex/90 transition-colors duration-200 group-hover:text-plex">
                                {t(dest.labelKey)}
                            </span>
                        </div>
                    </div>
                </div>
            </button>
            <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={t('notifications.removeAria')}
                title={t('notifications.remove')}
                className="mt-1.5 mr-0.5 shrink-0 rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-text focus-visible:outline-none focus-visible:bg-white/10"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
};

type Props = {
    onNavigate?: (route: string, options?: { path?: string; reviewId?: number }) => void;
    className?: string;
    buttonClassName?: string;
    /** Panel opens above the bell (desktop sidebar) or below (mobile top bar). */
    placement?: 'up' | 'down';
};
type NotificationFilter = 'all' | 'unread';

type PanelBox = {
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
};

export const InAppNotificationsBell: React.FC<Props> = ({
    onNavigate,
    className = '',
    buttonClassName = '',
    placement = 'down',
}) => {
    const { t } = useDiscoverI18n();
    const [open, setOpen] = useState(false);
    const [filterMode, setFilterMode] = useState<NotificationFilter>('all');
    const [items, setItems] = useState<InAppNotification[]>([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [panelBox, setPanelBox] = useState<PanelBox | null>(null);
    const [expandedStacks, setExpandedStacks] = useState<Set<string>>(() => new Set());
    const [expandedRepeats, setExpandedRepeats] = useState<Set<string>>(() => new Set());
    const ignoreRefreshUntil = useRef(0);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const refresh = useCallback(async ({ silent = false, force = false }: { silent?: boolean; force?: boolean } = {}) => {
        if (!force && Date.now() < ignoreRefreshUntil.current) return;
        try {
            if (!silent) setLoading(true);
            const params = new URLSearchParams({ limit: '50' });
            if (filterMode === 'unread') params.set('unreadOnly', '1');
            const data = await apiFetch(`/api/notifications?${params.toString()}`);
            if (!force && Date.now() < ignoreRefreshUntil.current) return;
            setItems(Array.isArray(data?.items) ? data.items : []);
            setUnread(Number(data?.unread) || 0);
            setActionError(null);
        } catch {
            // ignore — bell stays quiet if API unavailable
        } finally {
            if (!silent) setLoading(false);
        }
    }, [filterMode]);

    useEffect(() => {
        refresh();

        const onChanged = () => { refresh({ silent: true }); };
        const onFocus = () => { refresh({ silent: true }); };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') refresh({ silent: true });
        };

        const onOpen = () => {
            setOpen(true);
            refresh({ silent: true });
        };

        window.addEventListener(IN_APP_NOTIFICATIONS_CHANGED_EVENT, onChanged);
        window.addEventListener(OPEN_IN_APP_NOTIFICATIONS_EVENT, onOpen);
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibility);

        const id = window.setInterval(() => {
            if (document.visibilityState === 'visible') refresh({ silent: true });
        }, open ? 12_000 : 30_000);

        return () => {
            window.clearInterval(id);
            window.removeEventListener(IN_APP_NOTIFICATIONS_CHANGED_EVENT, onChanged);
            window.removeEventListener(OPEN_IN_APP_NOTIFICATIONS_EVENT, onOpen);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [refresh, open]);

    const updatePanelBox = useCallback(() => {
        const button = buttonRef.current;
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const margin = 12;

        if (placement === 'up') {
            const available = Math.max(320, rect.top - margin * 2);
            const maxHeight = Math.max(360, Math.min(Math.floor(available * 0.72), Math.floor(window.innerHeight * 0.7)));
            const width = Math.min(
                Math.max(420, Math.floor(window.innerWidth * 0.42)),
                window.innerWidth - margin * 2,
                720,
            );
            let left = Math.max(margin, rect.left - 8);
            left = Math.min(left, window.innerWidth - margin - width);
            left = Math.max(margin, left);
            setPanelBox({
                left,
                width,
                maxHeight,
                bottom: window.innerHeight - rect.top + 8,
            });
            return;
        }

        // Mobile top bar: nearly full-width sheet under the bell so long labels fit.
        const width = Math.min(window.innerWidth - margin * 2, 420);
        const maxHeight = Math.max(
            220,
            Math.min(Math.floor(window.innerHeight * 0.52), window.innerHeight - rect.bottom - margin * 2),
        );
        const left = window.innerWidth <= 480
            ? margin
            : Math.min(Math.max(rect.right - width, margin), window.innerWidth - margin - width);
        setPanelBox({
            left,
            width,
            maxHeight,
            top: rect.bottom + margin,
        });
    }, [placement]);

    useLayoutEffect(() => {
        if (!open) {
            setPanelBox(null);
            return;
        }
        updatePanelBox();
        const onWin = () => updatePanelBox();
        window.addEventListener('resize', onWin);
        window.addEventListener('scroll', onWin, true);
        return () => {
            window.removeEventListener('resize', onWin);
            window.removeEventListener('scroll', onWin, true);
        };
    }, [open, updatePanelBox]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (event: MouseEvent) => {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    useEffect(() => {
        if (!open) {
            setExpandedStacks(new Set());
            setExpandedRepeats(new Set());
        }
    }, [open]);

    const toggleRepeat = (id: string) => {
        setExpandedRepeats((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const stacks = useMemo(() => stackInAppNotifications(items), [items]);

    const toggleStack = (key: string) => {
        setExpandedStacks((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const markAllRead = async () => {
        if (unread <= 0) return;
        try {
            setActionError(null);
            ignoreRefreshUntil.current = Date.now() + 2000;
            const data = await apiFetch('/api/notifications/read', {
                method: 'POST',
                body: JSON.stringify({ all: true }),
            });
            setItems((prev) => (
                filterMode === 'unread'
                    ? []
                    : prev.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() }))
            ));
            setUnread(Number.isFinite(Number(data?.unread)) ? Number(data.unread) : 0);
            notifyInAppNotificationsChanged();
        } catch (error: any) {
            ignoreRefreshUntil.current = 0;
            setActionError(String(error?.message || t('notifications.markAllReadFailed')));
        }
    };

    const clearAll = async () => {
        if (clearing) return;
        try {
            setClearing(true);
            setActionError(null);
            ignoreRefreshUntil.current = Date.now() + 2000;
            const data = await apiFetch('/api/notifications/clear', {
                method: 'POST',
                body: JSON.stringify({ all: true }),
            });
            setItems([]);
            setUnread(Number.isFinite(Number(data?.unread)) ? Number(data.unread) : 0);
            notifyInAppNotificationsChanged();
        } catch (error: any) {
            ignoreRefreshUntil.current = 0;
            setActionError(String(error?.message || t('notifications.clearAllFailed')));
        } finally {
            setClearing(false);
        }
    };

    const removeItems = async (ids: string[]) => {
        const unique = [...new Set(ids.map(String).filter(Boolean))];
        if (!unique.length) return;
        const idSet = new Set(unique);
        const unreadRemoved = items.filter((item) => idSet.has(item.id) && !item.readAt).length;
        try {
            setActionError(null);
            ignoreRefreshUntil.current = Date.now() + 2000;
            const data = await apiFetch('/api/notifications/clear', {
                method: 'POST',
                body: JSON.stringify({ ids: unique }),
            });
            setItems((prev) => prev.filter((item) => !idSet.has(item.id)));
            if (Number.isFinite(Number(data?.unread))) setUnread(Number(data.unread));
            else if (unreadRemoved) setUnread((n) => Math.max(0, n - unreadRemoved));
            notifyInAppNotificationsChanged();
        } catch (error: any) {
            ignoreRefreshUntil.current = 0;
            setActionError(String(error?.message || t('notifications.removeFailed')));
        }
    };

    const openItem = async (item: InAppNotification) => {
        if (!item.readAt) {
            try {
                await apiFetch('/api/notifications/read', {
                    method: 'POST',
                    body: JSON.stringify({ ids: [item.id] }),
                });
                setItems((prev) => (
                    filterMode === 'unread'
                        ? prev.filter((row) => row.id !== item.id)
                        : prev.map((row) => (row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row))
                ));
                setUnread((n) => Math.max(0, n - 1));
            } catch {
                // ignore
            }
        }
        setOpen(false);

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

    const panel = open && panelBox && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={panelRef}
                role="dialog"
                aria-label={t('notifications.title')}
                className={`notif-panel-enter fixed flex flex-col overflow-hidden rounded-2xl border border-border/80 shadow-[0_24px_64px_rgba(0,0,0,0.55)] z-[400] bg-card/90 backdrop-blur-xl ${
                    placement === 'up' ? 'notif-panel-enter-up' : 'notif-panel-enter-down'
                }`}
                style={{
                    left: panelBox.left,
                    width: panelBox.width,
                    ...(panelBox.top != null && panelBox.bottom != null
                        ? { top: panelBox.top, bottom: panelBox.bottom }
                        : panelBox.bottom != null
                            ? { bottom: panelBox.bottom, height: panelBox.maxHeight, maxHeight: panelBox.maxHeight }
                            : { top: panelBox.top, height: panelBox.maxHeight, maxHeight: panelBox.maxHeight }),
                }}
            >
                <div className="relative shrink-0 border-b border-border/70">
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-plex/20 via-plex/5 to-transparent" />
                    <div className="relative flex flex-col gap-2 px-4 py-4 sm:px-5">
                        <div className="flex items-center gap-3 min-w-0">
                            <span className="notif-header-icon inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-plex/35 bg-plex/15 text-plex">
                                <Bell className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                                <p className="text-sm font-bold tracking-wide text-text truncate">{t('notifications.title')}</p>
                                <p className="text-sm text-muted mt-0.5 truncate">
                                    {unread > 0
                                        ? t('notifications.unreadCount', { count: unread })
                                        : t('notifications.allCaughtUp')}
                                </p>
                            </div>
                        </div>
                        {(unread > 0 || items.length > 0) && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                <div className="inline-flex items-center rounded-lg border border-border/80 bg-black/20 p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setFilterMode('all')}
                                        className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                            filterMode === 'all'
                                                ? 'bg-plex/20 text-plex'
                                                : 'text-muted hover:text-text'
                                        }`}
                                    >
                                        {t('notifications.filterAll')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFilterMode('unread')}
                                        className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                            filterMode === 'unread'
                                                ? 'bg-plex/20 text-plex'
                                                : 'text-muted hover:text-text'
                                        }`}
                                    >
                                        {t('notifications.filterUnread')}
                                    </button>
                                </div>
                                <div className="ml-auto flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => { void markAllRead(); }}
                                        disabled={unread <= 0}
                                        className="notif-mark-read inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-plex/30 bg-plex/10 px-3 py-1.5 text-xs font-semibold text-plex transition-all duration-200 hover:bg-plex/20 hover:border-plex/50 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                                    >
                                        <CheckCheck className="h-3 w-3 shrink-0" />
                                        <span className="whitespace-nowrap">{t('notifications.markAllRead')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { void clearAll(); }}
                                        disabled={clearing}
                                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border/80 bg-white/5 px-3 py-1.5 text-xs font-semibold text-muted transition-all duration-200 hover:text-text hover:border-border hover:bg-white/10 active:scale-[0.97] disabled:opacity-50"
                                    >
                                        <Trash2 className="h-3 w-3 shrink-0" />
                                        <span className="whitespace-nowrap">{t('notifications.clearAll')}</span>
                                    </button>
                                </div>
                            </div>
                        )}
                        {actionError ? (
                            <p className="text-xs font-semibold text-rose-300">{actionError}</p>
                        ) : null}
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {loading && !items.length ? (
                        <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                            <span className="h-10 w-10 rounded-2xl border border-border bg-white/5 animate-pulse" />
                            <p className="text-sm text-muted">{t('common.loadingMore')}</p>
                        </div>
                    ) : !items.length ? (
                        <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
                            <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-plex/25 bg-plex/10 text-plex">
                                <Inbox className="h-7 w-7" />
                            </span>
                            <div>
                                <p className="text-sm font-semibold text-text">{t('notifications.empty')}</p>
                                <p className="text-sm text-muted mt-1 max-w-sm">{t('notifications.emptyHint')}</p>
                            </div>
                        </div>
                    ) : (
                        <ul className="py-1">
                            {stacks.map((stack, index) => {
                                if (stack.items.length === 1) {
                                    const item = stack.items[0];
                                    return (
                                        <li
                                            key={item.id}
                                            className="notif-row-enter border-b border-border/40 last:border-b-0"
                                            style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                                        >
                                            <NotificationItemRow
                                                item={item}
                                                t={t}
                                                onOpen={openItem}
                                                onRemove={(row) => { void removeItems([row.id]); }}
                                                expanded={expandedRepeats.has(item.id)}
                                                onToggleExpand={() => toggleRepeat(item.id)}
                                            />
                                        </li>
                                    );
                                }
                                const newest = stack.items[0];
                                const unreadCount = stack.items.filter((item) => !item.readAt).length;
                                const expanded = expandedStacks.has(stack.key);
                                const extra = Math.max(0, stack.items.length - 1);
                                return (
                                    <li
                                        key={stack.key}
                                        className="notif-row-enter border-b border-border/40 last:border-b-0"
                                        style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                                    >
                                        <div className={`group relative flex items-start px-2 sm:px-3 py-2 ${
                                            unreadCount > 0 ? 'bg-plex/[0.045]' : ''
                                        }`}>
                                            {unreadCount > 0 && (
                                                <span className={`notif-unread-bar absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${stack.type === 'media_job_completed' ? 'bg-emerald-500' : 'bg-plex'}`} />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => toggleStack(stack.key)}
                                                aria-expanded={expanded}
                                                aria-label={expanded
                                                    ? t('notifications.stack.collapse')
                                                    : t('notifications.stack.expand', { count: stack.items.length })}
                                                className="notif-row-btn min-w-0 flex-1 text-left rounded-xl px-1.5 py-1.5 transition-all duration-200 hover:bg-plex/[0.07] focus-visible:outline-none focus-visible:bg-plex/10"
                                            >
                                                <div className="flex items-start gap-2.5 md:gap-3">
                                                    <StackedArtwork items={stack.items} count={stack.items.length} />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <p className={`text-sm leading-snug ${unreadCount > 0 ? 'font-bold text-text' : 'font-semibold text-text/90'}`}>
                                                                {stackTitle(stack.type, stack.items.length, t)}
                                                            </p>
                                                            <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${expanded ? 'rotate-180 text-plex' : 'group-hover:text-plex'}`} />
                                                        </div>
                                                        <p className="text-sm text-muted mt-0.5 line-clamp-2 leading-relaxed">
                                                            {newest.title}
                                                            {extra > 0 ? ` · ${t('notifications.stack.more', { count: extra })}` : ''}
                                                        </p>
                                                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                                                            <span className="text-muted/80">{formatRelative(newest.createdAt, t)}</span>
                                                            {unreadCount > 0 && (
                                                                <>
                                                                    <span className="text-border">·</span>
                                                                    <span className="font-semibold text-plex/90">
                                                                        {t('notifications.unreadCount', { count: unreadCount })}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { void removeItems(stack.items.map((row) => row.id)); }}
                                                aria-label={t('notifications.removeStackAria', { count: stack.items.length })}
                                                title={t('notifications.remove')}
                                                className="mt-1.5 mr-0.5 shrink-0 rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-text focus-visible:outline-none focus-visible:bg-white/10"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        {expanded ? (
                                            <ul className="border-t border-border/40 bg-black/20">
                                                {stack.items.map((item) => (
                                                    <li key={item.id} className="border-b border-border/30 last:border-b-0">
                                                        <NotificationItemRow
                                                            item={item}
                                                            t={t}
                                                            onOpen={openItem}
                                                            onRemove={(row) => { void removeItems([row.id]); }}
                                                            compact
                                                        />
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>,
            document.body,
        )
        : null;

    return (
        <div className={`relative ${className}`}>
            <button
                ref={buttonRef}
                type="button"
                onClick={() => {
                    setOpen((v) => !v);
                    if (!open) refresh({ silent: true });
                }}
                className={buttonClassName || 'relative text-muted hover:text-text transition-colors'}
                title={t('notifications.title')}
                aria-label={t('notifications.title')}
                aria-expanded={open}
            >
                <Bell className="w-4 h-4" />
                {unread > 0 && (
                    <span className="notif-bell-count absolute top-0.5 right-0.5 pointer-events-none">
                        <span className="notif-bell-ping" aria-hidden="true" />
                        <span className="notif-bell-badge">
                            {unread > 9 ? '9+' : unread}
                        </span>
                    </span>
                )}
            </button>
            {panel}
        </div>
    );
};

export default InAppNotificationsBell;
