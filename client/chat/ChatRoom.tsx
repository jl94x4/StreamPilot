import React, {
    useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import {
    GripVertical, Hash, Loader2, MessageSquare, Plus, Send, Trash2, X,
} from 'lucide-react';
import { ChatEmojiPicker } from './ChatEmojiPicker';
import { insertAtCursor } from './insertAtCursor';
import { useVisualViewportInset } from './useVisualViewportInset';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { DashboardHero, DashboardPageShell } from '../shared/dashboard/DashboardChrome';
import { formatDateTime } from '../shared/format';
import { ModalPortal } from '../shared/ModalPortal';
import { ConfirmModal } from '../shared/ui';
import { ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { usePoll } from '../shared/usePoll';
import { goToProfile } from '../profile/helpers';
import {
    getActiveMentionQuery,
    insertMention,
    renderMessageWithMentions,
    type ChatMention,
} from './renderMentions';

type MentionableUser = {
    id: string;
    username: string;
    displayName?: string;
    avatar?: string;
};

type ChatRoom = {
    id: string;
    name: string;
    description?: string;
    unreadCount?: number;
    lastMessageAt?: string | null;
    lastMessagePreview?: string;
};

type ChatMessage = {
    id: number;
    message: string;
    mentions?: ChatMention[];
    createdAt: string | null;
    user: {
        id?: string | null;
        displayName: string;
        avatar?: string;
        isAdmin?: boolean;
    };
};

type Props = {
    sessionInfo: any;
    onCountsChange?: () => void;
    initialRoomId?: string | null;
};

type ConfirmDialogState = {
    title: string;
    message: string;
    danger?: boolean;
    confirmLabel?: string;
};

const MESSAGE_POLL_MS = 5000;
const ROOM_POLL_MS = 15000;

const resolveAvatar = (thumb?: string | null, size = 80): string => {
    if (!thumb) return '';
    if (thumb.startsWith('http://') || thumb.startsWith('https://')) return thumb;
    if (thumb.startsWith('/api/')) return portalUrl(thumb);
    return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=${size}&height=${size}`);
};

const ChatAvatar: React.FC<{ src?: string | null; name: string; size?: number }> = ({
    src,
    name,
    size = 32,
}) => {
    const [broken, setBroken] = useState(false);
    useEffect(() => { setBroken(false); }, [src]);
    const url = !broken ? resolveAvatar(src, size * 2) : '';
    const initial = String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
    return (
        <span
            className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/10 text-[10px] font-bold text-white/80"
            style={{ width: size, height: size, minWidth: size, minHeight: size }}
            title={name}
        >
            {url ? (
                <img
                    src={url}
                    alt=""
                    width={size}
                    height={size}
                    className="block h-full w-full object-cover"
                    onError={() => setBroken(true)}
                />
            ) : (
                <span className="flex h-full w-full items-center justify-center">{initial}</span>
            )}
        </span>
    );
};

export const ChatRoom: React.FC<Props> = ({ sessionInfo, onCountsChange, initialRoomId = null }) => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [rooms, setRooms] = useState<ChatRoom[]>([]);
    const [activeRoomId, setActiveRoomId] = useState<string | null>(initialRoomId);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [isAdmin, setIsAdmin] = useState(!!sessionInfo?.session?.isAdmin);
    const [createOpen, setCreateOpen] = useState(false);
    const [newRoomName, setNewRoomName] = useState('');
    const [newRoomDescription, setNewRoomDescription] = useState('');
    const [creatingRoom, setCreatingRoom] = useState(false);
    const [mentionables, setMentionables] = useState<MentionableUser[]>([]);
    const [mentionOpen, setMentionOpen] = useState(false);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [mentionStart, setMentionStart] = useState(-1);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [composeFocused, setComposeFocused] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [dragRoomId, setDragRoomId] = useState<string | null>(null);
    const [reorderingRooms, setReorderingRooms] = useState(false);
    const confirmActionRef = useRef<(() => void | Promise<void>) | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const draftRef = useRef<HTMLTextAreaElement | null>(null);
    const mentionTimerRef = useRef<number | null>(null);
    const lastMessageIdRef = useRef(0);
    const activeRoomIdRef = useRef<string | null>(activeRoomId);
    const composeFocusedRef = useRef(false);
    const selectionRef = useRef({ start: 0, end: 0 });
    const stickToBottomRef = useRef(true);
    const currentUserId = String(sessionInfo?.account?.id || sessionInfo?.session?.id || '');
    const pausePolls = composeFocused || draft.length > 0;
    const keyboardInset = useVisualViewportInset(composeFocused);

    useEffect(() => {
        activeRoomIdRef.current = activeRoomId;
    }, [activeRoomId]);

    useEffect(() => {
        composeFocusedRef.current = composeFocused;
    }, [composeFocused]);

    const syncSelection = useCallback(() => {
        const node = draftRef.current;
        if (!node) return;
        selectionRef.current = {
            start: node.selectionStart ?? node.value.length,
            end: node.selectionEnd ?? node.value.length,
        };
    }, []);

    const restoreComposeFocus = useCallback(() => {
        if (!composeFocusedRef.current) return;
        const node = draftRef.current;
        if (!node || document.activeElement === node) return;
        const { start, end } = selectionRef.current;
        node.focus({ preventScroll: true });
        node.setSelectionRange(start, end);
    }, []);

    const openUserProfile = useCallback((userId?: string | null) => {
        if (!userId) return;
        goToProfile(undefined, userId);
    }, []);

    const toast = useCallback((message: string, type: ToastMessage['type'] = 'info') => {
        pushToast(setToasts, message, type);
    }, []);

    const openConfirm = useCallback((opts: ConfirmDialogState & { onConfirm: () => void | Promise<void> }) => {
        confirmActionRef.current = opts.onConfirm;
        setConfirmDialog({
            title: opts.title,
            message: opts.message,
            danger: opts.danger,
            confirmLabel: opts.confirmLabel,
        });
    }, []);

    const closeConfirm = useCallback(() => {
        confirmActionRef.current = null;
        setConfirmDialog(null);
    }, []);

    const handleConfirm = useCallback(() => {
        const action = confirmActionRef.current;
        confirmActionRef.current = null;
        setConfirmDialog(null);
        if (action) void action();
    }, []);

    const activeRoom = useMemo(
        () => rooms.find((room) => String(room.id) === String(activeRoomId)) || null,
        [rooms, activeRoomId],
    );

    const loadRooms = useCallback(async (selectRoomId?: string | null) => {
        const data = await apiFetch('/api/chat/rooms');
        const nextRooms = Array.isArray(data?.rooms) ? data.rooms as ChatRoom[] : [];
        setRooms(nextRooms);
        setIsAdmin(!!data?.isAdmin);

        const hasRoom = (roomId: string | null | undefined) => (
            !!roomId && nextRooms.some((room) => String(room.id) === String(roomId))
        );

        if (selectRoomId != null && String(selectRoomId).trim() !== '') {
            const preferred = String(selectRoomId);
            if (hasRoom(preferred)) setActiveRoomId(preferred);
            return nextRooms;
        }

        const current = activeRoomIdRef.current;
        if (hasRoom(current)) return nextRooms;

        const fallback = initialRoomId || nextRooms[0]?.id || null;
        if (hasRoom(fallback)) {
            setActiveRoomId(String(fallback));
        } else if (nextRooms[0]?.id) {
            setActiveRoomId(String(nextRooms[0].id));
        }
        return nextRooms;
    }, [initialRoomId]);

    const reorderChannels = useCallback(async (fromId: string, toId: string) => {
        if (!isAdmin || fromId === toId || reorderingRooms) return;
        const ids = rooms.map((room) => String(room.id));
        const fromIndex = ids.indexOf(fromId);
        const toIndex = ids.indexOf(toId);
        if (fromIndex < 0 || toIndex < 0) return;
        const nextIds = [...ids];
        nextIds.splice(fromIndex, 1);
        nextIds.splice(toIndex, 0, fromId);
        const previous = rooms;
        const roomMap = new Map(rooms.map((room) => [String(room.id), room]));
        setRooms(nextIds.map((id) => roomMap.get(id)).filter(Boolean) as ChatRoom[]);
        setReorderingRooms(true);
        try {
            const data = await apiFetch('/api/chat/rooms/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomIds: nextIds }),
            });
            if (Array.isArray(data?.rooms)) setRooms(data.rooms as ChatRoom[]);
        } catch (error) {
            setRooms(previous);
            toast(error instanceof Error ? error.message : 'Failed to reorder channels', 'error');
        } finally {
            setReorderingRooms(false);
        }
    }, [isAdmin, rooms, reorderingRooms, toast]);

    const loadMessages = useCallback(async (roomId: string, { after = 0, replace = false } = {}) => {
        if (!roomId) return;
        setMessagesLoading(replace);
        try {
            const query = after > 0 ? `?after=${after}` : '';
            const data = await apiFetch(`/api/chat/rooms/${encodeURIComponent(roomId)}/messages${query}`);
            const batch = Array.isArray(data?.messages) ? data.messages as ChatMessage[] : [];
            if (replace) {
                setMessages(batch);
            } else if (batch.length) {
                setMessages((prev) => {
                    const seen = new Set(prev.map((item) => item.id));
                    const merged = [...prev];
                    for (const item of batch) {
                        if (!seen.has(item.id)) merged.push(item);
                    }
                    return merged.sort((a, b) => Number(a.id) - Number(b.id));
                });
            }
            const latest = batch[batch.length - 1];
            if (latest?.id) {
                lastMessageIdRef.current = Math.max(lastMessageIdRef.current, Number(latest.id));
                await apiFetch(`/api/chat/rooms/${encodeURIComponent(roomId)}/read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messageId: latest.id }),
                }).catch(() => {});
                onCountsChange?.();
            }
        } finally {
            setMessagesLoading(false);
        }
    }, [onCountsChange]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const meta = await apiFetch('/api/chat/meta');
                if (!meta?.enabled) {
                    toast('Community chat is disabled.', 'error');
                    return;
                }
                await loadRooms(initialRoomId);
            } catch (error) {
                if (!cancelled) {
                    toast(error instanceof Error ? error.message : 'Failed to load chat', 'error');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [initialRoomId, toast]);

    useEffect(() => {
        if (!activeRoomId) return;
        lastMessageIdRef.current = 0;
        setMessages([]);
        void loadMessages(activeRoomId, { replace: true });
    }, [activeRoomId, loadMessages]);

    useEffect(() => {
        if (!activeRoomId || typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        if (url.searchParams.get('room') === String(activeRoomId)) return;
        url.searchParams.set('room', String(activeRoomId));
        window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
    }, [activeRoomId]);

    const updateStickToBottom = useCallback(() => {
        const node = scrollRef.current;
        if (!node) return;
        stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    }, []);

    const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
        const node = scrollRef.current;
        if (!node) return;
        stickToBottomRef.current = true;
        node.scrollTo({ top: node.scrollHeight, behavior });
    }, []);

    useEffect(() => {
        const node = scrollRef.current;
        if (!node) return;
        if (!stickToBottomRef.current && composeFocusedRef.current) return;
        scrollMessagesToBottom();
    }, [messages, activeRoomId, scrollMessagesToBottom]);

    useLayoutEffect(() => {
        if (!composeFocused) return;
        scrollMessagesToBottom();
        const viewport = window.visualViewport;
        if (!viewport) return undefined;
        const handleViewportChange = () => {
            scrollMessagesToBottom();
        };
        viewport.addEventListener('resize', handleViewportChange);
        viewport.addEventListener('scroll', handleViewportChange);
        const timerId = window.setTimeout(() => scrollMessagesToBottom(), 120);
        return () => {
            viewport.removeEventListener('resize', handleViewportChange);
            viewport.removeEventListener('scroll', handleViewportChange);
            window.clearTimeout(timerId);
        };
    }, [composeFocused, keyboardInset, scrollMessagesToBottom]);

    useLayoutEffect(() => {
        restoreComposeFocus();
    }, [messages, rooms, restoreComposeFocus]);

    usePoll(() => {
        if (!activeRoomId || pausePolls) return;
        void loadMessages(activeRoomId, { after: lastMessageIdRef.current });
    }, activeRoomId && !pausePolls ? MESSAGE_POLL_MS : null);

    usePoll(() => {
        if (pausePolls) return;
        void loadRooms();
    }, pausePolls ? null : ROOM_POLL_MS);

    const closeMentions = useCallback(() => {
        setMentionOpen(false);
        setMentionables([]);
        setMentionIndex(0);
        setMentionStart(-1);
    }, []);

    const loadMentionables = useCallback(async (query: string) => {
        try {
            const data = await apiFetch(`/api/chat/mentionables?q=${encodeURIComponent(query)}`);
            const users = Array.isArray(data?.users) ? data.users as MentionableUser[] : [];
            setMentionables(users);
            setMentionIndex(0);
            setMentionOpen(users.length > 0);
        } catch {
            closeMentions();
        }
    }, [closeMentions]);

    const syncMentionSuggestions = useCallback((text: string, cursor: number) => {
        const active = getActiveMentionQuery(text, cursor);
        if (!active) {
            closeMentions();
            return;
        }
        setMentionStart(active.start);
        if (mentionTimerRef.current) window.clearTimeout(mentionTimerRef.current);
        mentionTimerRef.current = window.setTimeout(() => {
            void loadMentionables(active.query);
        }, 120);
    }, [closeMentions, loadMentionables]);

    const insertEmoji = useCallback((emoji: string) => {
        const node = draftRef.current;
        const { start, end } = node
            ? { start: node.selectionStart ?? draft.length, end: node.selectionEnd ?? draft.length }
            : selectionRef.current;
        const { nextText, nextCursor } = insertAtCursor(draft, emoji, start, end);
        setDraft(nextText);
        selectionRef.current = { start: nextCursor, end: nextCursor };
        window.requestAnimationFrame(() => {
            const textarea = draftRef.current;
            if (!textarea) return;
            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(nextCursor, nextCursor);
        });
    }, [draft]);

    const applyMention = useCallback((user: MentionableUser) => {
        if (mentionStart < 0) return;
        const { nextText, nextCursor } = insertMention(draft, mentionStart, user.username);
        setDraft(nextText);
        closeMentions();
        window.requestAnimationFrame(() => {
            const node = draftRef.current;
            if (!node) return;
            node.focus();
            node.setSelectionRange(nextCursor, nextCursor);
        });
    }, [closeMentions, draft, mentionStart]);

    useEffect(() => () => {
        if (mentionTimerRef.current) window.clearTimeout(mentionTimerRef.current);
    }, []);

    const handleSend = async () => {
        const text = draft.trim();
        if (!text || !activeRoomId || sending) return;
        setSending(true);
        try {
            const data = await apiFetch(`/api/chat/rooms/${encodeURIComponent(activeRoomId)}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
            });
            const message = data?.message as ChatMessage | undefined;
            if (message?.id) {
                setMessages((prev) => [...prev, message]);
                lastMessageIdRef.current = Math.max(lastMessageIdRef.current, Number(message.id));
                setDraft('');
                closeMentions();
                setEmojiOpen(false);
                stickToBottomRef.current = true;
                onCountsChange?.();
            }
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to send message', 'error');
        } finally {
            setSending(false);
        }
    };

    const handleCreateRoom = async () => {
        const name = newRoomName.trim();
        if (!name || creatingRoom) return;
        setCreatingRoom(true);
        try {
            const data = await apiFetch('/api/chat/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    description: newRoomDescription.trim(),
                }),
            });
            const room = data?.room as ChatRoom | undefined;
            setCreateOpen(false);
            setNewRoomName('');
            setNewRoomDescription('');
            if (room?.id) {
                await loadRooms(String(room.id));
                toast(`Created #${room.name}`, 'success');
            }
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to create channel', 'error');
        } finally {
            setCreatingRoom(false);
        }
    };

    const handleDeleteRoom = (room: ChatRoom) => {
        if (!isAdmin) return;
        openConfirm({
            title: 'Delete channel',
            message: `Delete #${room.name}? Messages in this channel will be removed from the room list.`,
            danger: true,
            confirmLabel: 'Delete channel',
            onConfirm: async () => {
                try {
                    await apiFetch(`/api/chat/rooms/${encodeURIComponent(room.id)}`, { method: 'DELETE' });
                    const nextRooms = await loadRooms();
                    if (String(activeRoomId) === String(room.id)) {
                        setActiveRoomId(nextRooms[0]?.id ? String(nextRooms[0].id) : null);
                    }
                    toast(`Deleted #${room.name}`, 'success');
                } catch (error) {
                    toast(error instanceof Error ? error.message : 'Failed to delete channel', 'error');
                }
            },
        });
    };

    const handleDeleteMessage = (message: ChatMessage) => {
        if (!activeRoomId) return;
        const canDelete = isAdmin || String(message.user.id) === currentUserId;
        if (!canDelete) return;
        openConfirm({
            title: 'Delete message',
            message: 'Delete this message? This cannot be undone.',
            danger: true,
            confirmLabel: 'Delete message',
            onConfirm: async () => {
                try {
                    await apiFetch(`/api/chat/rooms/${encodeURIComponent(activeRoomId)}/messages/${message.id}`, {
                        method: 'DELETE',
                    });
                    setMessages((prev) => prev.filter((item) => item.id !== message.id));
                } catch (error) {
                    toast(error instanceof Error ? error.message : 'Failed to delete message', 'error');
                }
            },
        });
    };

    if (loading) {
        return (
            <DashboardPageShell>
                <div className="flex min-h-[50vh] items-center justify-center text-muted">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Loading chat…
                </div>
            </DashboardPageShell>
        );
    }

    return (
        <DashboardPageShell className="gap-3 max-md:fixed max-md:inset-x-0 max-md:top-[calc(4rem+env(safe-area-inset-top,0px))] max-md:bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] max-md:z-20 max-md:overflow-hidden max-md:pb-0 max-md:gap-2">
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <ConfirmModal
                isOpen={!!confirmDialog}
                title={confirmDialog?.title || 'Are you sure?'}
                message={confirmDialog?.message || ''}
                danger={confirmDialog?.danger}
                confirmLabel={confirmDialog?.confirmLabel || 'Confirm'}
                onCancel={closeConfirm}
                onConfirm={handleConfirm}
            />
            <div className="hidden md:block">
                <DashboardHero
                    eyebrow="Community"
                    title="Live chat"
                    description="Talk with everyone on this server in real time. Admins can create text channels for different topics."
                    icon={<MessageSquare className="h-3.5 w-3.5" />}
                />
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/20 md:min-h-[80vh] lg:min-h-[calc(100dvh-13rem)] lg:flex-row">
                <aside className="flex w-full shrink-0 flex-col border-b border-white/10 lg:w-64 lg:border-b-0 lg:border-r">
                    <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                        <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-wide text-muted">Channels</p>
                            {isAdmin ? (
                                <p className="mt-0.5 text-[10px] text-muted/80">Drag to reorder</p>
                            ) : null}
                        </div>
                        {isAdmin ? (
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] font-semibold text-text hover:bg-white/5"
                                onClick={() => setCreateOpen(true)}
                            >
                                <Plus className="h-3.5 w-3.5" />
                                New
                            </button>
                        ) : null}
                    </div>
                    <div className="max-h-48 overflow-y-auto lg:max-h-none lg:flex-1">
                        {rooms.map((room) => {
                            const active = String(room.id) === String(activeRoomId);
                            const dragging = dragRoomId === String(room.id);
                            return (
                                <div
                                    key={room.id}
                                    className={`flex items-center gap-0.5 transition-opacity ${dragging ? 'opacity-50' : ''}`}
                                    onDragOver={(event) => {
                                        if (!isAdmin || !dragRoomId) return;
                                        event.preventDefault();
                                    }}
                                    onDrop={(event) => {
                                        if (!isAdmin || !dragRoomId) return;
                                        event.preventDefault();
                                        const fromId = dragRoomId;
                                        setDragRoomId(null);
                                        if (fromId !== String(room.id)) {
                                            void reorderChannels(fromId, String(room.id));
                                        }
                                    }}
                                >
                                    {isAdmin ? (
                                        <button
                                            type="button"
                                            draggable={!reorderingRooms}
                                            onDragStart={(event) => {
                                                event.stopPropagation();
                                                setDragRoomId(String(room.id));
                                                event.dataTransfer.effectAllowed = 'move';
                                            }}
                                            onDragEnd={() => setDragRoomId(null)}
                                            className="ml-1 flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-text cursor-grab active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                                            aria-label={`Drag ${room.name} to reorder`}
                                            disabled={reorderingRooms}
                                        >
                                            <GripVertical className="h-3.5 w-3.5" />
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm transition ${
                                            active ? 'bg-plex/15 text-plex' : 'text-text/85 hover:bg-white/5'
                                        }`}
                                        onClick={() => setActiveRoomId(String(room.id))}
                                    >
                                        <Hash className="h-4 w-4 shrink-0 opacity-70" />
                                        <span className="min-w-0 flex-1 truncate font-medium">{room.name}</span>
                                        {room.unreadCount ? (
                                            <span className="rounded-full bg-plex px-1.5 py-0.5 text-[10px] font-bold text-background">
                                                {room.unreadCount}
                                            </span>
                                        ) : null}
                                    </button>
                                </div>
                            );
                        })}
                        {!rooms.length ? (
                            <p className="px-4 py-6 text-sm text-muted">No channels yet.</p>
                        ) : null}
                    </div>
                </aside>

                <section className="flex min-h-0 flex-1 flex-col">
                    {activeRoom ? (
                        <>
                            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
                                <div className="min-w-0">
                                    <p className="flex items-center gap-1 text-base font-bold text-text">
                                        <Hash className="h-4 w-4 text-plex" />
                                        {activeRoom.name}
                                    </p>
                                    {activeRoom.description ? (
                                        <p className="mt-1 text-xs text-muted">{activeRoom.description}</p>
                                    ) : null}
                                </div>
                                {isAdmin ? (
                                    <button
                                        type="button"
                                        className="rounded-md border border-red-400/20 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/10"
                                        onClick={() => void handleDeleteRoom(activeRoom)}
                                    >
                                        Delete channel
                                    </button>
                                ) : null}
                            </div>

                            <div
                                ref={scrollRef}
                                className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
                                onScroll={updateStickToBottom}
                            >
                                {messagesLoading && !messages.length ? (
                                    <div className="flex items-center justify-center py-10 text-muted">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Loading messages…
                                    </div>
                                ) : null}
                                {messages.map((message) => {
                                    const mine = String(message.user.id) === currentUserId;
                                    const canDelete = isAdmin || mine;
                                    return (
                                        <div key={message.id} className="group flex gap-3">
                                            <button
                                                type="button"
                                                className="shrink-0"
                                                onClick={() => openUserProfile(message.user.id)}
                                            >
                                                <ChatAvatar src={message.user.avatar} name={message.user.displayName} />
                                            </button>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-baseline gap-2">
                                                    <button
                                                        type="button"
                                                        className="text-sm font-semibold text-text hover:text-plex"
                                                        onClick={() => openUserProfile(message.user.id)}
                                                    >
                                                        {message.user.displayName}
                                                    </button>
                                                    {message.user.isAdmin ? (
                                                        <span className="rounded bg-plex/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-plex">
                                                            Admin
                                                        </span>
                                                    ) : null}
                                                    <span className="text-[11px] text-muted">
                                                        {message.createdAt ? formatDateTime(message.createdAt) : ''}
                                                    </span>
                                                    {canDelete ? (
                                                        <button
                                                            type="button"
                                                            className="ml-auto opacity-0 transition group-hover:opacity-100"
                                                            title="Delete message"
                                                            onClick={() => void handleDeleteMessage(message)}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5 text-red-300" />
                                                        </button>
                                                    ) : null}
                                                </div>
                                                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text/90">
                                                    {renderMessageWithMentions(
                                                        message.message,
                                                        message.mentions || [],
                                                        (userId) => openUserProfile(userId),
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                                {!messages.length && !messagesLoading ? (
                                    <p className="py-10 text-center text-sm text-muted">
                                        No messages yet. Say hello!
                                    </p>
                                ) : null}
                            </div>

                            <div
                                className="shrink-0 border-t border-white/10 bg-[#0a0b0f] p-3 md:bg-transparent md:p-4"
                                style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}
                            >
                                <div className="relative flex items-center gap-2">
                                    {mentionOpen ? (
                                        <div className="absolute bottom-full left-0 right-[5.5rem] z-20 mb-2 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#12141c] p-1 shadow-2xl">
                                            {mentionables.map((user, index) => (
                                                <button
                                                    key={user.id}
                                                    type="button"
                                                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                                                        index === mentionIndex ? 'bg-plex/15 text-plex' : 'text-text hover:bg-white/5'
                                                    }`}
                                                    onMouseDown={(event) => {
                                                        event.preventDefault();
                                                        applyMention(user);
                                                    }}
                                                >
                                                    <ChatAvatar src={user.avatar} name={user.username} size={24} />
                                                    <span className="font-medium">@{user.username}</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                    <ChatEmojiPicker
                                        open={emojiOpen}
                                        onToggle={() => setEmojiOpen((value) => !value)}
                                        onClose={() => setEmojiOpen(false)}
                                        onPick={(emoji) => {
                                            insertEmoji(emoji);
                                            setEmojiOpen(false);
                                        }}
                                    />
                                    <textarea
                                        ref={draftRef}
                                        className="h-10 min-h-10 max-h-10 flex-1 resize-none overflow-hidden rounded-xl border border-white/10 bg-black/30 px-3 py-[7px] appearance-none text-[16px] leading-6 text-text placeholder:text-muted focus:border-plex/40 focus:outline-none"
                                        placeholder={`Message #${activeRoom.name} · type @ to mention`}
                                        rows={1}
                                        enterKeyHint="send"
                                        autoComplete="off"
                                        autoCorrect="on"
                                        value={draft}
                                        onChange={(event) => {
                                            const next = event.target.value;
                                            setDraft(next);
                                            syncSelection();
                                            syncMentionSuggestions(next, event.target.selectionStart || next.length);
                                        }}
                                        onClick={(event) => {
                                            const target = event.currentTarget;
                                            syncSelection();
                                            syncMentionSuggestions(target.value, target.selectionStart || target.value.length);
                                        }}
                                        onSelect={syncSelection}
                                        onKeyUp={syncSelection}
                                        onFocus={() => {
                                            setComposeFocused(true);
                                            setEmojiOpen(false);
                                            syncSelection();
                                            scrollMessagesToBottom();
                                        }}
                                        onBlur={() => {
                                            setComposeFocused(false);
                                        }}
                                        onTouchStart={(event) => {
                                            if (document.activeElement === event.currentTarget) return;
                                            event.preventDefault();
                                            event.currentTarget.focus({ preventScroll: true });
                                            scrollMessagesToBottom();
                                        }}
                                        onKeyDown={(event) => {
                                            if (mentionOpen && mentionables.length) {
                                                if (event.key === 'ArrowDown') {
                                                    event.preventDefault();
                                                    setMentionIndex((value) => (value + 1) % mentionables.length);
                                                    return;
                                                }
                                                if (event.key === 'ArrowUp') {
                                                    event.preventDefault();
                                                    setMentionIndex((value) => (value - 1 + mentionables.length) % mentionables.length);
                                                    return;
                                                }
                                                if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                                                    event.preventDefault();
                                                    const selected = mentionables[mentionIndex];
                                                    if (selected) applyMention(selected);
                                                    return;
                                                }
                                                if (event.key === 'Escape') {
                                                    event.preventDefault();
                                                    closeMentions();
                                                    return;
                                                }
                                            }
                                            if (event.key === 'Enter' && !event.shiftKey) {
                                                event.preventDefault();
                                                void handleSend();
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-plex text-background hover:bg-plex-hover disabled:opacity-50"
                                        disabled={sending || !draft.trim()}
                                        onClick={() => void handleSend()}
                                    >
                                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    </button>
                                </div>
                                <p className="mt-2 hidden text-[11px] text-muted md:block">Enter to send · Shift+Enter for a new line · @username to mention someone</p>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted">
                            Select a channel to start chatting.
                        </div>
                    )}
                </section>
            </div>

            <ModalPortal open={createOpen}>
                    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
                        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12141c] p-5 shadow-2xl">
                            <div className="mb-4 flex items-center justify-between">
                                <h3 className="text-lg font-bold text-text">Create channel</h3>
                                <button type="button" onClick={() => setCreateOpen(false)}>
                                    <X className="h-5 w-5 text-muted" />
                                </button>
                            </div>
                            <label className="block">
                                <span className="text-xs font-bold uppercase tracking-wide text-muted">Name</span>
                                <input
                                    className="appearance-none text-[16px] leading-5 mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[16px] text-text"
                                    placeholder="general"
                                    value={newRoomName}
                                    onChange={(event) => setNewRoomName(event.target.value)}
                                />
                            </label>
                            <label className="mt-4 block">
                                <span className="text-xs font-bold uppercase tracking-wide text-muted">Description</span>
                                <input
                                    className="appearance-none text-[16px] leading-5 mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[16px] text-text"
                                    placeholder="Optional topic for this channel"
                                    value={newRoomDescription}
                                    onChange={(event) => setNewRoomDescription(event.target.value)}
                                />
                            </label>
                            <div className="mt-5 flex justify-end gap-2">
                                <button
                                    type="button"
                                    className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-text"
                                    onClick={() => setCreateOpen(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="rounded-lg bg-plex px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
                                    disabled={creatingRoom || !newRoomName.trim()}
                                    onClick={() => void handleCreateRoom()}
                                >
                                    {creatingRoom ? 'Creating…' : 'Create channel'}
                                </button>
                            </div>
                        </div>
                    </div>
            </ModalPortal>
        </DashboardPageShell>
    );
};

export default ChatRoom;
