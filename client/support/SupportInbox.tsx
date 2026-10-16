import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Check, ChevronLeft, Film, ImagePlus, LifeBuoy, Loader2, MessageSquare, Pencil, Plus, RotateCcw, Search, Send, SmilePlus, Trash2, X,
} from 'lucide-react';
import { apiFetch, PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { DashboardHero, DashboardPageShell } from '../shared/dashboard/DashboardChrome';
import { formatDateTime } from '../shared/format';
import { ModalPortal } from '../shared/ModalPortal';
import { ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { CustomSelect } from '../shared/ui';
import { formatIssueRelativeTime, issueStatusBadgeClass } from '../discovery/issueUtils';
import { useDiscoverI18n } from '../discovery/i18n';
import { goToProfile } from '../profile/helpers';
import { portalRequestTypeLabelKey } from '../requests/requestFilterUtils';

type TicketFilter = 'open' | 'resolved' | 'closed' | 'all';

type TicketReaction = { emoji: string; count: number; userIds: string[] };

type TicketAttachment = {
    id: string;
    filename?: string;
    mime?: string;
    size?: number;
    url: string;
};

type TicketComment = {
    id: number;
    message: string;
    createdAt: string | null;
    editedAt?: string | null;
    reactions?: TicketReaction[];
    attachments?: TicketAttachment[];
    user: { id?: string | null; displayName: string; avatar?: string; isAdmin?: boolean };
};

type LinkedMedia = {
    issueId?: string | null;
    title?: string | null;
    mediaType?: 'movie' | 'tv' | string | null;
    tmdbId?: number | null;
    posterUrl?: string;
    issueTypeLabel?: string | null;
    problemSeason?: number | null;
    problemEpisode?: number | null;
};

type Ticket = {
    id: number;
    subject: string;
    category: string;
    categoryLabel: string;
    status: number;
    statusLabel: string;
    createdAt: string | null;
    updatedAt: string | null;
    unreadForUser?: boolean;
    unreadForAdmin?: boolean;
    createdBy: { id?: string | null; displayName: string; email?: string | null; avatar?: string };
    comments: TicketComment[];
    commentCount: number;
    lastMessage?: { message: string; createdAt: string | null; displayName: string } | null;
    linkedMedia?: LinkedMedia | null;
};

const CATEGORY_FALLBACK = [
    { id: 'media' },
    { id: 'account' },
    { id: 'server' },
    { id: 'general' },
    { id: 'other' },
];

const CATEGORY_LABEL_KEYS: Record<string, string> = {
    media: 'support.categories.media',
    account: 'support.categories.account',
    server: 'support.categories.server',
    general: 'support.categories.general',
    other: 'support.categories.other',
};

const REACTION_EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '🎉', '👀'];
const MAX_SUPPORT_IMAGES = 5;
const SUPPORT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';

type PendingImage = {
    id: string;
    file: File;
    previewUrl: string;
};

const createPendingImages = (files: FileList | File[]): PendingImage[] => (
    Array.from(files).slice(0, MAX_SUPPORT_IMAGES).map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
    }))
);

const revokePendingImages = (items: PendingImage[]) => {
    for (const item of items) {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
    }
};

const uploadSupportImage = async (ticketId: number | string, file: File): Promise<TicketAttachment> => {
    const response = await fetch(portalUrl(`/api/support/tickets/${encodeURIComponent(String(ticketId))}/attachments`), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-Filename': file.name || 'image',
            [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
        },
        body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Failed to upload image');
    return data.attachment as TicketAttachment;
};

const resolveTicketAvatar = (thumb?: string | null, size = 80): string => {
    if (!thumb) return '';
    if (thumb.startsWith('http://') || thumb.startsWith('https://')) return thumb;
    if (thumb.startsWith('/api/')) return portalUrl(thumb);
    return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=${size}&height=${size}`);
};

const TicketAvatar: React.FC<{ src?: string | null; name: string; size?: number }> = ({
    src,
    name,
    size = 36,
}) => {
    const [broken, setBroken] = useState(false);
    useEffect(() => { setBroken(false); }, [src]);
    const url = !broken ? resolveTicketAvatar(src, size * 2) : '';
    const initial = String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
    return (
        <span
            className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/10 text-[11px] font-bold text-white/80"
            style={{
                width: size,
                height: size,
                minWidth: size,
                minHeight: size,
                maxWidth: size,
                maxHeight: size,
            }}
            title={name}
        >
            {url ? (
                <img
                    src={url}
                    alt=""
                    width={size}
                    height={size}
                    className="block h-full w-full max-h-full max-w-full object-cover"
                    onError={() => setBroken(true)}
                />
            ) : (
                <span className="flex h-full w-full items-center justify-center">{initial}</span>
            )}
        </span>
    );
};

const previewText = (value?: string | null, max = 72) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export const SupportInbox: React.FC<{ sessionInfo?: any; onCountsChange?: () => void }> = ({
    sessionInfo = null,
    onCountsChange,
}) => {
    const { t } = useDiscoverI18n();
    const isAdmin = !!sessionInfo?.session?.isAdmin;
    const viewerId = String(sessionInfo?.account?.id || sessionInfo?.session?.id || '');
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [filter, setFilter] = useState<TicketFilter>('open');
    const [search, setSearch] = useState('');
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [counts, setCounts] = useState({ open: 0, resolved: 0, closed: 0, unread: 0, total: 0 });
    const [categories, setCategories] = useState<Array<{ id: string; label?: string }>>(CATEGORY_FALLBACK);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [composeOpen, setComposeOpen] = useState(false);
    const [subject, setSubject] = useState('');
    const [category, setCategory] = useState('general');
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [active, setActive] = useState<Ticket | null>(null);
    const [reply, setReply] = useState('');
    const [replyImages, setReplyImages] = useState<PendingImage[]>([]);
    const [composeImages, setComposeImages] = useState<PendingImage[]>([]);
    const [busy, setBusy] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [reactingId, setReactingId] = useState<number | null>(null);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const threadRef = useRef<HTMLDivElement>(null);
    const replyFileRef = useRef<HTMLInputElement>(null);
    const composeFileRef = useRef<HTMLInputElement>(null);

    const addToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
        setToasts((prev) => pushToast(prev, text, type));
    }, []);

    const loadList = useCallback(async () => {
        setError(null);
        try {
            const data = await apiFetch(`/api/support/tickets?filter=${encodeURIComponent(filter)}&take=200`);
            setTickets(Array.isArray(data?.results) ? data.results : []);
            if (data?.counts) setCounts(data.counts);
        } catch (e: any) {
            setError(e?.message || t('support.errors.loadFailed'));
            setTickets([]);
        } finally {
            setLoading(false);
        }
    }, [filter, t]);

    useEffect(() => {
        apiFetch('/api/support/meta').then((meta) => {
            if (Array.isArray(meta?.categories) && meta.categories.length) setCategories(meta.categories);
        }).catch(() => null);
    }, []);

    useEffect(() => {
        setLoading(true);
        void loadList();
    }, [loadList]);

    useEffect(() => {
        const applyFromLocation = () => {
            const params = new URLSearchParams(window.location.search);
            const fromQuery = Number(params.get('ticket'));
            if (Number.isFinite(fromQuery) && fromQuery > 0) setActiveId(fromQuery);
            if (params.get('compose') === '1') setComposeOpen(true);
        };
        applyFromLocation();
        const onNavigate = (event: Event) => {
            const ticketId = Number((event as CustomEvent)?.detail?.ticketId);
            if (Number.isFinite(ticketId) && ticketId > 0) setActiveId(ticketId);
        };
        window.addEventListener('popstate', applyFromLocation);
        window.addEventListener('portal-support-navigate', onNavigate);
        return () => {
            window.removeEventListener('popstate', applyFromLocation);
            window.removeEventListener('portal-support-navigate', onNavigate);
        };
    }, []);

    useEffect(() => {
        if (!activeId) {
            setActive(null);
            setEditingId(null);
            setReactingId(null);
            return;
        }
        let cancelled = false;
        apiFetch(`/api/support/tickets/${activeId}`).then((data) => {
            if (cancelled) return;
            setActive(data?.ticket || null);
            onCountsChange?.();
        }).catch((e: any) => {
            if (!cancelled) addToast(e?.message || t('support.errors.openFailed'), 'error');
        });
        return () => { cancelled = true; };
    }, [activeId, addToast, onCountsChange, t]);

    useEffect(() => {
        if (reactingId == null) return undefined;
        const onPointer = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-ticket-reaction-picker]')) return;
            setReactingId(null);
        };
        window.addEventListener('mousedown', onPointer);
        return () => window.removeEventListener('mousedown', onPointer);
    }, [reactingId]);

    useEffect(() => {
        const el = threadRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [active?.id, active?.commentCount, active?.comments?.length]);

    const tabs = useMemo(() => ([
        { id: 'open' as const, label: t('support.filters.open'), count: counts.open },
        { id: 'resolved' as const, label: t('support.filters.resolved'), count: counts.resolved },
        { id: 'closed' as const, label: t('support.filters.closed'), count: counts.closed },
        { id: 'all' as const, label: t('support.filters.all'), count: counts.total },
    ]), [counts, t]);

    const displayStatus = (value: string) => ({
        open: t('support.status.open'),
        resolved: t('support.status.resolved'),
        closed: t('support.status.closed'),
    }[value.toLowerCase()] || value);

    const visibleTickets = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return tickets;
        return tickets.filter((ticket) => {
            const hay = [
                ticket.subject,
                ticket.createdBy?.displayName,
                ticket.categoryLabel,
                ticket.lastMessage?.message,
                String(ticket.id),
                ticket.linkedMedia?.title,
            ].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(query);
        });
    }, [tickets, search]);

    const selectTicket = (ticketId: number) => {
        setActiveId(ticketId);
        window.history.replaceState({}, '', portalUrl(`/support?ticket=${ticketId}`));
    };

    const submitTicket = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!subject.trim()) return;
        if (!message.trim() && composeImages.length === 0) {
            addToast(t('support.errors.messageOrImageRequired'), 'error');
            return;
        }
        setSaving(true);
        try {
            const data = await apiFetch('/api/support/tickets', {
                method: 'POST',
                body: JSON.stringify({
                    subject,
                    category,
                    message,
                    allowEmptyMessage: composeImages.length > 0,
                }),
            });
            const ticket = data?.ticket;
            if (ticket?.id && composeImages.length > 0) {
                const uploaded = [];
                for (const item of composeImages) {
                    uploaded.push(await uploadSupportImage(ticket.id, item.file));
                }
                const linked = await apiFetch(`/api/support/tickets/${ticket.id}/comments/1/attachments`, {
                    method: 'POST',
                    body: JSON.stringify({ attachments: uploaded }),
                });
                setActiveId(linked?.ticket?.id || ticket.id);
            } else {
                setActiveId(ticket?.id || null);
            }
            setSubject('');
            setMessage('');
            revokePendingImages(composeImages);
            setComposeImages([]);
            setComposeOpen(false);
            addToast(t('support.toasts.sent'));
            await loadList();
            onCountsChange?.();
        } catch (err: any) {
            addToast(err?.message || t('support.errors.sendFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const sendReply = async () => {
        if (!active || (!reply.trim() && replyImages.length === 0)) return;
        setBusy(true);
        try {
            const uploaded = [];
            for (const item of replyImages) {
                uploaded.push(await uploadSupportImage(active.id, item.file));
            }
            const data = await apiFetch(`/api/support/tickets/${active.id}/comment`, {
                method: 'POST',
                body: JSON.stringify({
                    message: reply,
                    attachments: uploaded,
                }),
            });
            setReply('');
            revokePendingImages(replyImages);
            setReplyImages([]);
            setActive(data?.ticket || active);
            await loadList();
            onCountsChange?.();
        } catch (err: any) {
            addToast(err?.message || t('support.errors.replyFailed'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const saveEdit = async (commentId: number) => {
        if (!active || !editDraft.trim()) return;
        setBusy(true);
        try {
            const data = await apiFetch(`/api/support/tickets/${active.id}/comments/${commentId}`, {
                method: 'PATCH',
                body: JSON.stringify({ message: editDraft }),
            });
            setActive(data?.ticket || active);
            setEditingId(null);
            setEditDraft('');
            addToast(t('support.toasts.edited'));
            await loadList();
        } catch (err: any) {
            addToast(err?.message || t('support.errors.editFailed'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const toggleReaction = async (commentId: number, emoji: string) => {
        if (!active) return;
        setReactingId(null);
        try {
            const data = await apiFetch(`/api/support/tickets/${active.id}/comments/${commentId}/reactions`, {
                method: 'POST',
                body: JSON.stringify({ emoji }),
            });
            setActive(data?.ticket || active);
        } catch (err: any) {
            addToast(err?.message || t('support.errors.reactFailed'), 'error');
        }
    };

    const setStatus = async (status: 'open' | 'resolved' | 'closed') => {
        if (!active) return;
        setBusy(true);
        try {
            const data = await apiFetch(`/api/support/tickets/${active.id}/status`, {
                method: 'POST',
                body: JSON.stringify({ status }),
            });
            setActive(data?.ticket || active);
            await loadList();
            onCountsChange?.();
        } catch (err: any) {
            addToast(err?.message || t('support.errors.statusFailed'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const deleteTicket = async () => {
        if (!active || !isAdmin) return;
        setBusy(true);
        try {
            await apiFetch(`/api/support/tickets/${active.id}`, { method: 'DELETE' });
            setActiveId(null);
            setActive(null);
            await loadList();
            onCountsChange?.();
            addToast(t('support.toasts.deleted'));
        } catch (err: any) {
            addToast(err?.message || t('support.errors.deleteFailed'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const unreadOn = (ticket: Ticket) => (isAdmin ? ticket.unreadForAdmin : ticket.unreadForUser);
    const canEdit = (comment: TicketComment) => (
        isAdmin || (!!viewerId && String(comment.user?.id || '') === viewerId)
    );
    const hasReacted = (reaction: TicketReaction) => (
        !!viewerId && reaction.userIds?.includes(viewerId)
    );

    const linked = active?.linkedMedia;
    const mediaHref = linked?.tmdbId
        ? portalUrl(`/discovery/${linked.mediaType === 'tv' ? 'tv' : 'movie'}/${linked.tmdbId}`)
        : '';

    return (
        <DashboardPageShell>
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <DashboardHero
                accent="plex"
                eyebrow={t('navigation.support')}
                title={isAdmin ? t('support.page.adminTitle') : t('support.page.memberTitle')}
                description={isAdmin
                    ? t('support.page.adminDescription')
                    : t('support.page.memberDescription')}
                icon={<LifeBuoy className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <button
                        type="button"
                        onClick={() => setComposeOpen(true)}
                        className="inline-flex items-center gap-2 rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background hover:bg-plex-hover"
                    >
                        <Plus className="w-4 h-4" /> {t('support.actions.newTicket')}
                    </button>
                )}
            />

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20 min-h-[32rem] lg:h-[calc(100dvh-16rem)] flex flex-col">
                <div className="flex flex-col gap-3 border-b border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-1.5">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setFilter(tab.id)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                                    filter === tab.id ? 'border-plex text-plex bg-plex/10' : 'border-border text-muted'
                                }`}
                            >
                                {tab.label} {tab.count}
                            </button>
                        ))}
                    </div>
                    <label className="relative block sm:w-72">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('support.labels.searchPlaceholder')}
                            className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-9 pr-3 appearance-none text-[16px] leading-5 text-text outline-none focus:border-plex/50"
                        />
                    </label>
                </div>

                {error && <p className="px-4 pt-3 text-sm text-red-300">{error}</p>}

                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
                    <div className={`${activeId ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col border-white/10 lg:border-r`}>
                        <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1.5">
                            {loading ? (
                                <div className="p-8 text-center text-muted text-sm">
                                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> {t('support.loading.tickets')}
                                </div>
                            ) : visibleTickets.length === 0 ? (
                                <div className="p-8 text-center text-muted text-sm">
                                    {tickets.length === 0 ? t('support.empty.noTickets') : t('support.labels.noMatch')}
                                </div>
                            ) : visibleTickets.map((ticket) => (
                                <button
                                    key={ticket.id}
                                    type="button"
                                    onClick={() => selectTicket(ticket.id)}
                                    className={`w-full text-left rounded-xl border px-3 py-3 transition-colors ${
                                        activeId === ticket.id ? 'border-plex/50 bg-plex/10' : 'border-transparent hover:border-white/10 hover:bg-white/5'
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <TicketAvatar
                                            src={ticket.createdBy?.avatar}
                                            name={ticket.createdBy?.displayName || 'Member'}
                                            size={36}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="font-bold text-sm truncate flex items-center gap-2">
                                                    {unreadOn(ticket) && <span className="w-2 h-2 rounded-full bg-plex shrink-0" />}
                                                    {ticket.subject}
                                                </p>
                                                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${issueStatusBadgeClass(ticket.statusLabel)}`}>
                                                    {displayStatus(ticket.statusLabel)}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-muted mt-0.5 truncate">
                                                {t('support.labels.ticketId', { id: ticket.id })}
                                                {' · '}
                                                {isAdmin ? ticket.createdBy?.displayName : ticket.categoryLabel}
                                                {ticket.linkedMedia ? ` · ${t('support.labels.mediaIssue')}` : ''}
                                            </p>
                                            {ticket.lastMessage?.message && (
                                                <p className="text-[11px] text-white/55 mt-1 truncate">
                                                    {ticket.lastMessage.displayName}: {previewText(ticket.lastMessage.message)}
                                                </p>
                                            )}
                                            {ticket.updatedAt && (
                                                <p className="text-[10px] text-muted/80 mt-1" title={ticket.updatedAt}>
                                                    {formatIssueRelativeTime(ticket.updatedAt, t)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={`${activeId ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col`}>
                        {!active ? (
                            <div className="flex h-full flex-col items-center justify-center text-center text-muted py-10 px-6">
                                <MessageSquare className="w-8 h-8 mb-3 opacity-60" />
                                <p className="text-sm">{t('support.empty.selectTicket')}</p>
                            </div>
                        ) : (
                            <>
                                <div className="border-b border-white/10 px-4 py-3 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex items-start gap-3">
                                            <button
                                                type="button"
                                                className="lg:hidden mt-1 rounded-lg p-1 text-muted hover:text-text hover:bg-white/10"
                                                aria-label={t('media.goBack')}
                                                onClick={() => {
                                                    setActiveId(null);
                                                    setActive(null);
                                                    window.history.replaceState({}, '', portalUrl('/support'));
                                                }}
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                            </button>
                                            <TicketAvatar
                                                src={active.createdBy?.avatar}
                                                name={active.createdBy?.displayName || 'Member'}
                                                size={40}
                                            />
                                            <div className="min-w-0">
                                                <h2 className="text-base font-black text-text truncate">{active.subject}</h2>
                                                <p className="text-xs text-muted mt-0.5">
                                                    {t('support.labels.ticketId', { id: active.id })}
                                                    {' · '}
                                                    {active.categoryLabel}
                                                    {' · '}
                                                    {active.createdBy?.id || active.createdBy?.displayName ? (
                                                        <button
                                                            type="button"
                                                            className="hover:text-plex hover:underline"
                                                            onClick={() => goToProfile(undefined, active.createdBy?.id, active.createdBy?.displayName)}
                                                        >
                                                            {active.createdBy?.displayName}
                                                        </button>
                                                    ) : (active.createdBy?.displayName || '')}
                                                    {active.createdAt ? ` · ${formatDateTime(active.createdAt)}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${issueStatusBadgeClass(active.statusLabel)}`}>
                                            {displayStatus(active.statusLabel)}
                                        </span>
                                    </div>
                                    {linked && (
                                        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-2">
                                            <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                                                {linked.posterUrl ? (
                                                    <img src={linked.posterUrl} alt="" className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-muted">
                                                        <Film className="h-4 w-4" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[10px] font-bold uppercase tracking-wide text-plex">{t('support.labels.mediaIssue')}</p>
                                                <p className="text-sm font-bold truncate">{linked.title || active.subject}</p>
                                                <p className="text-[11px] text-muted truncate">
                                                    {[linked.issueTypeLabel, t(portalRequestTypeLabelKey(linked.mediaType))]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </p>
                                            </div>
                                            {mediaHref && (
                                                <a
                                                    href={mediaHref}
                                                    className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-muted hover:text-text hover:border-plex/40"
                                                >
                                                    {t('support.labels.viewMedia')}
                                                </a>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        {isAdmin && active.statusLabel !== 'resolved' && (
                                            <button type="button" disabled={busy} onClick={() => { void setStatus('resolved'); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:border-plex/40">
                                                <Check className="w-3.5 h-3.5" /> {t('support.actions.resolve')}
                                            </button>
                                        )}
                                        {active.statusLabel !== 'open' && (
                                            <button type="button" disabled={busy} onClick={() => { void setStatus('open'); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:border-plex/40">
                                                <RotateCcw className="w-3.5 h-3.5" /> {t('support.actions.reopen')}
                                            </button>
                                        )}
                                        {active.statusLabel !== 'closed' && (
                                            <button type="button" disabled={busy} onClick={() => { void setStatus('closed'); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:border-plex/40">
                                                <X className="w-3.5 h-3.5" /> {t('common.close')}
                                            </button>
                                        )}
                                        {isAdmin && (
                                            <button type="button" disabled={busy} onClick={() => { void deleteTicket(); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-xs font-semibold text-red-300 hover:border-red-400/50 ml-auto">
                                                <Trash2 className="w-3.5 h-3.5" /> {t('common.delete')}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                                    {(active.comments || []).map((comment, index) => {
                                        const mine = !!viewerId && String(comment.user?.id || '') === viewerId;
                                        const prev = active.comments[index - 1];
                                        const clustered = !!prev && String(prev.user?.id || '') === String(comment.user?.id || '');
                                        return (
                                            <div
                                                key={comment.id}
                                                className={`group flex items-end gap-2 ${mine ? 'flex-row' : 'flex-row-reverse'} ${clustered ? 'mt-1' : 'mt-3 first:mt-0'}`}
                                            >
                                                <div className="w-8 shrink-0">
                                                    {!clustered && (
                                                        <TicketAvatar
                                                            src={comment.user?.avatar}
                                                            name={comment.user?.displayName || 'Member'}
                                                            size={32}
                                                        />
                                                    )}
                                                </div>
                                                <div className={`min-w-0 max-w-[78%] flex flex-col ${mine ? 'items-start' : 'items-end'}`}>
                                                    {!clustered && (
                                                        <div className={`flex flex-wrap items-baseline gap-x-2 ${mine ? '' : 'flex-row-reverse'}`}>
                                                            <p className="text-[11px] font-bold text-text">
                                                                {mine ? t('support.labels.you') : comment.user?.displayName}
                                                                {comment.user?.isAdmin ? (
                                                                    <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-plex">{t('support.labels.admin')}</span>
                                                                ) : null}
                                                            </p>
                                                            {comment.createdAt && (
                                                                <time
                                                                    className="text-[10px] text-muted"
                                                                    dateTime={comment.createdAt}
                                                                    title={comment.createdAt}
                                                                >
                                                                    {formatDateTime(comment.createdAt)}
                                                                </time>
                                                            )}
                                                            {comment.editedAt && (
                                                                <span className="text-[10px] text-muted/80" title={formatDateTime(comment.editedAt)}>
                                                                    ({t('support.labels.edited')})
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                    {editingId === comment.id ? (
                                                        <div className="mt-0.5 w-full space-y-2">
                                                            <textarea
                                                                value={editDraft}
                                                                onChange={(e) => setEditDraft(e.target.value)}
                                                                rows={3}
                                                                className="w-full rounded-xl border border-plex/40 bg-black/30 px-3 py-2 text-sm text-text outline-none"
                                                            />
                                                            <div className={`flex gap-2 ${mine ? '' : 'justify-end'}`}>
                                                                <button
                                                                    type="button"
                                                                    disabled={busy || !editDraft.trim()}
                                                                    onClick={() => { void saveEdit(comment.id); }}
                                                                    className="rounded-lg bg-plex px-3 py-1.5 text-xs font-bold text-background disabled:opacity-40"
                                                                >
                                                                    {t('support.actions.save')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { setEditingId(null); setEditDraft(''); }}
                                                                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold"
                                                                >
                                                                    {t('common.cancel')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {comment.message ? (
                                                                <div
                                                                    className={`mt-0.5 rounded-2xl px-3 py-1.5 ${
                                                                        mine
                                                                            ? 'rounded-bl-md border border-white/10 bg-white/5'
                                                                            : 'rounded-br-md border border-plex/25 bg-plex/10'
                                                                    }`}
                                                                    title={comment.createdAt ? formatDateTime(comment.createdAt) : undefined}
                                                                >
                                                                    <p className="text-sm text-text whitespace-pre-wrap">{comment.message}</p>
                                                                </div>
                                                            ) : null}
                                                            {Array.isArray(comment.attachments) && comment.attachments.length > 0 && (
                                                                <div className={`flex flex-wrap gap-1.5 ${comment.message ? 'mt-1' : 'mt-0.5'} ${mine ? '' : 'justify-end'}`}>
                                                                    {comment.attachments.map((attachment) => {
                                                                        const src = attachment.url?.startsWith('/api/')
                                                                            ? portalUrl(attachment.url)
                                                                            : attachment.url;
                                                                        return (
                                                                            <button
                                                                                key={attachment.id}
                                                                                type="button"
                                                                                onClick={() => setLightboxUrl(src)}
                                                                                className="overflow-hidden rounded-lg border border-white/10 p-0 leading-none"
                                                                                title={comment.createdAt && !comment.message ? formatDateTime(comment.createdAt) : undefined}
                                                                            >
                                                                                <img
                                                                                    src={src}
                                                                                    alt={attachment.filename || t('support.attachments.imageAlt')}
                                                                                    className="block h-28 w-auto max-w-[12rem] object-cover"
                                                                                    loading="lazy"
                                                                                />
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                    <div className={`mt-0.5 flex flex-wrap items-center gap-1 ${mine ? '' : 'flex-row-reverse'}`}>
                                                        {(comment.reactions || []).map((reaction) => (
                                                            <button
                                                                key={reaction.emoji}
                                                                type="button"
                                                                onClick={() => { void toggleReaction(comment.id, reaction.emoji); }}
                                                                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
                                                                    hasReacted(reaction)
                                                                        ? 'border-plex/50 bg-plex/15 text-text'
                                                                        : 'border-white/10 bg-black/20 text-muted hover:border-white/20'
                                                                }`}
                                                            >
                                                                <span>{reaction.emoji}</span>
                                                                <span>{reaction.count}</span>
                                                            </button>
                                                        ))}
                                                        <div className="relative" data-ticket-reaction-picker>
                                                            <button
                                                                type="button"
                                                                title={t('support.actions.react')}
                                                                onClick={() => setReactingId((id) => id === comment.id ? null : comment.id)}
                                                                className="rounded-full p-1 text-muted hover:bg-white/10 hover:text-text opacity-70 group-hover:opacity-100 focus:opacity-100"
                                                            >
                                                                <SmilePlus className="h-3.5 w-3.5" />
                                                            </button>
                                                            {reactingId === comment.id && (
                                                                <div className={`absolute top-7 z-20 flex gap-1 rounded-xl border border-white/10 bg-[#16181f] p-1.5 shadow-xl ${mine ? 'left-0' : 'right-0'}`}>
                                                                    {REACTION_EMOJIS.map((emoji) => (
                                                                        <button
                                                                            key={emoji}
                                                                            type="button"
                                                                            className="rounded-lg px-1.5 py-1 text-base hover:bg-white/10"
                                                                            onClick={() => { void toggleReaction(comment.id, emoji); }}
                                                                        >
                                                                            {emoji}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {canEdit(comment) && editingId !== comment.id && (
                                                            <button
                                                                type="button"
                                                                title={t('support.actions.edit')}
                                                                onClick={() => {
                                                                    setEditingId(comment.id);
                                                                    setEditDraft(comment.message);
                                                                    setReactingId(null);
                                                                }}
                                                                className="rounded-full p-1 text-muted hover:bg-white/10 hover:text-text opacity-70 group-hover:opacity-100 focus:opacity-100"
                                                            >
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="border-t border-white/10 p-3">
                                    {active.statusLabel === 'closed' ? (
                                        <p className="text-xs text-muted px-1 py-2">{t('support.reply.closedHint')}</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {replyImages.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {replyImages.map((item) => (
                                                        <div key={item.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/10">
                                                            <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                                                            <button
                                                                type="button"
                                                                className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white"
                                                                onClick={() => {
                                                                    URL.revokeObjectURL(item.previewUrl);
                                                                    setReplyImages((prev) => prev.filter((img) => img.id !== item.id));
                                                                }}
                                                                aria-label={t('support.attachments.remove')}
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex items-end gap-2">
                                                <input
                                                    ref={replyFileRef}
                                                    type="file"
                                                    accept={SUPPORT_IMAGE_ACCEPT}
                                                    multiple
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        const files = e.target.files;
                                                        if (!files?.length) return;
                                                        setReplyImages((prev) => {
                                                            const next = [...prev, ...createPendingImages(files)].slice(0, MAX_SUPPORT_IMAGES);
                                                            return next;
                                                        });
                                                        e.target.value = '';
                                                    }}
                                                />
                                                <button
                                                    type="button"
                                                    disabled={busy || replyImages.length >= MAX_SUPPORT_IMAGES}
                                                    onClick={() => replyFileRef.current?.click()}
                                                    className="self-end px-3 py-2 rounded-xl border border-white/10 text-muted hover:text-plex hover:border-plex/40 disabled:opacity-40"
                                                    title={t('support.attachments.add')}
                                                    aria-label={t('support.attachments.add')}
                                                >
                                                    <ImagePlus className="w-4 h-4" />
                                                </button>
                                                <textarea
                                                    value={reply}
                                                    onChange={(e) => setReply(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault();
                                                            void sendReply();
                                                        }
                                                    }}
                                                    rows={2}
                                                    placeholder={t('support.reply.placeholder')}
                                                    className="flex-1 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-text outline-none focus:border-plex/50"
                                                />
                                                <button
                                                    type="button"
                                                    disabled={busy || (!reply.trim() && replyImages.length === 0)}
                                                    onClick={() => { void sendReply(); }}
                                                    className="self-end px-3 py-2 rounded-xl bg-plex text-background font-bold disabled:opacity-40"
                                                >
                                                    <Send className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <ModalPortal open={composeOpen}>
                <div className="fixed inset-x-0 top-0 z-[340] flex items-end sm:items-center justify-center p-0 sm:p-5 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:inset-0 sm:bottom-0">
                    <button type="button" className="absolute inset-0 bg-black/70" aria-label={t('common.close')} onClick={() => setComposeOpen(false)} />
                    <form
                        onSubmit={submitTicket}
                        className="relative w-full sm:max-w-lg max-h-full overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#12141a] p-5 space-y-3"
                    >
                        <h2 className="text-lg font-black text-text">{t('support.compose.title')}</h2>
                        <div>
                            <label className="block text-xs font-bold text-muted uppercase tracking-wide mb-1">
                                {t('support.compose.category')}
                            </label>
                            <CustomSelect
                                value={category}
                                onChange={setCategory}
                                compact
                                options={categories.map((item) => ({ label: item.label || t(CATEGORY_LABEL_KEYS[item.id] || 'support.categories.other'), value: item.id }))}
                            />
                        </div>
                        <label className="block text-xs font-bold text-muted uppercase tracking-wide">
                            {t('support.compose.subject')}
                            <input
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                className="mt-1 w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-text"
                                placeholder={t('support.compose.subjectPlaceholder')}
                                required
                            />
                        </label>
                        <label className="block text-xs font-bold text-muted uppercase tracking-wide">
                            {t('support.compose.message')}
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                rows={5}
                                className="mt-1 w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-text"
                                placeholder={t('support.compose.messagePlaceholder')}
                            />
                        </label>
                        <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <p className="text-xs font-bold text-muted uppercase tracking-wide">{t('support.attachments.label')}</p>
                                <button
                                    type="button"
                                    disabled={composeImages.length >= MAX_SUPPORT_IMAGES}
                                    onClick={() => composeFileRef.current?.click()}
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-plex disabled:opacity-40"
                                >
                                    <ImagePlus className="w-3.5 h-3.5" />
                                    {t('support.attachments.add')}
                                </button>
                            </div>
                            <input
                                ref={composeFileRef}
                                type="file"
                                accept={SUPPORT_IMAGE_ACCEPT}
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                    const files = e.target.files;
                                    if (!files?.length) return;
                                    setComposeImages((prev) => [...prev, ...createPendingImages(files)].slice(0, MAX_SUPPORT_IMAGES));
                                    e.target.value = '';
                                }}
                            />
                            {composeImages.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {composeImages.map((item) => (
                                        <div key={item.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/10">
                                            <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                                            <button
                                                type="button"
                                                className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white"
                                                onClick={() => {
                                                    URL.revokeObjectURL(item.previewUrl);
                                                    setComposeImages((prev) => prev.filter((img) => img.id !== item.id));
                                                }}
                                                aria-label={t('support.attachments.remove')}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="mt-1 text-[11px] text-muted">{t('support.attachments.hint')}</p>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                type="button"
                                onClick={() => {
                                    revokePendingImages(composeImages);
                                    setComposeImages([]);
                                    setComposeOpen(false);
                                }}
                                className="px-3 py-2 rounded-xl border border-border text-sm font-semibold"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={saving || (!message.trim() && composeImages.length === 0)}
                                className="px-4 py-2 rounded-xl bg-plex text-background text-sm font-bold disabled:opacity-50"
                            >
                                {saving ? t('support.compose.sending') : t('support.actions.send')}
                            </button>
                        </div>
                    </form>
                </div>
            </ModalPortal>

            {lightboxUrl && (
                <ModalPortal open>
                    <div className="fixed inset-0 z-[360] flex items-center justify-center p-4 bg-black/85" onClick={() => setLightboxUrl(null)}>
                        <button type="button" className="absolute top-4 right-4 rounded-full border border-white/20 bg-black/50 p-2 text-white" onClick={() => setLightboxUrl(null)} aria-label={t('common.close')}>
                            <X className="w-5 h-5" />
                        </button>
                        <img
                            src={lightboxUrl}
                            alt={t('support.attachments.imageAlt')}
                            className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </ModalPortal>
            )}
        </DashboardPageShell>
    );
};

export default SupportInbox;
