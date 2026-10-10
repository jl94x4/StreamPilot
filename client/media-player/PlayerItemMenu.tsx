import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Bookmark,
    BookmarkCheck,
    Captions,
    CheckCircle2,
    ChevronRight,
    Circle,
    Disc,
    Download,
    Eye,
    EyeOff,
    Info,
    Layers,
    ListPlus,
    ListVideo,
    MoreVertical,
    Music,
    Play,
    Shuffle,
    Star,
    Trash2,
    Tv,
    Volume2,
    XCircle,
} from 'lucide-react';
import { useDiscoverI18n } from './host';
import { rectToFixedPixels } from '../shared/ui';
import {
    addMediaPlayerPlaylistItem,
    createMediaPlayerPlaylist,
    deleteMediaPlayerItem,
    fetchMediaPlayerItem,
    fetchMediaPlayerPlaylists,
    removeMediaPlayerProgress,
    setMediaPlayerRating,
    setMediaPlayerWatched,
    setMediaPlayerWatchlisted,
    setSeasonEpisodesWatched,
    startMediaPlayerDownload,
} from './api';
import { PLAYER_SCROLL_ID } from './paths';
import type { PlayerItem, PlayerPlayOptions } from './types';
import { PlayerClearLogo } from './PlayerClearLogo';
import { PlayerFileInfo } from './PlayerFileInfo';
import { PlayerSeasonWatchDialog } from './PlayerSeasonWatchDialog';
import { readPlayerItemCache } from './playerMemory';
import { applyRememberedProgress, isMusicPlayerItem, plexLogoUrl, shouldOfferResume } from './playerUtils';

export type PlayerItemMenuHandle = {
    openAt: (clientX: number, clientY: number) => void;
};

const TV_MENU_CLOSE_EVENT = 'smp-tv-menu-close';

type Props = {
    item: PlayerItem;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
    showRemoveFromContinueWatching?: boolean;
    variant?: 'poster' | 'toolbar';
    /** TV opens this from a long-press. The trigger stays out of the D-pad path. */
    hideTrigger?: boolean;
    onOpenItem?: (item: PlayerItem) => void;
    onPlay?: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onWatchedChange?: (item: PlayerItem, watched: boolean) => void;
    onRemovedFromContinueWatching?: (item: PlayerItem) => void;
    onDeleted?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    /** Version and audio currently chosen on the title page, so File Info matches them. */
    mediaIndex?: number;
    audioStreamId?: string;
    subtitleStreamId?: string;
    audioTracks?: Array<{ id: string; label: string }>;
    subtitleTracks?: Array<{ id: string; label: string }>;
    onAudioChange?: (id: string) => void;
    onSubtitleChange?: (id: string) => void;
};

type MenuMode = 'main' | 'playlist';

const MENU_MIN_WIDTH = 220;
const MENU_MAX_WIDTH = 420;

const rowClass = 'flex w-full items-center gap-3.5 px-1 py-3 text-left text-[1.02rem] font-semibold tracking-tight text-white/95 hover:bg-white/[0.06] disabled:opacity-50';
const compactRowClass = 'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left font-semibold hover:bg-white/10 disabled:opacity-50';
const mobileRowClass = 'flex w-full items-center gap-3 px-4 py-3.5 text-left text-[0.95rem] font-semibold text-white/95 active:bg-white/[0.08] disabled:opacity-50';

const isPhonePosterUi = () => {
    if (typeof window === 'undefined') return false;
    try {
        if (document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true) return false;
        if (document.documentElement?.dataset?.phone === '1') return true;
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches
            || window.matchMedia('(max-width: 767px)').matches;
    } catch {
        return false;
    }
};

export const PlayerItemMenu = forwardRef<PlayerItemMenuHandle, Props>(({
    item,
    isAdmin = false,
    playlistsEnabled = true,
    showRemoveFromContinueWatching = false,
    variant = 'poster',
    hideTrigger = false,
    onOpenItem,
    onPlay,
    onPlayNext,
    onWatchedChange,
    onRemovedFromContinueWatching,
    onDeleted,
    onToast,
    mediaIndex = 0,
    audioStreamId = '',
    subtitleStreamId = '',
    audioTracks = [],
    subtitleTracks = [],
    onAudioChange,
    onSubtitleChange,
}, ref) => {
    const { t } = useDiscoverI18n();
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const openedAtRef = useRef(0);
    const [mode, setMode] = useState<MenuMode>('main');
    const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 0 });
    const [playlists, setPlaylists] = useState<PlayerItem[]>([]);
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [fileInfoItem, setFileInfoItem] = useState<PlayerItem | null>(null);
    const [fileInfoLoading, setFileInfoLoading] = useState(false);
    const [trackPicker, setTrackPicker] = useState<'audio' | 'subtitles' | null>(null);
    const [seasonWatchOpen, setSeasonWatchOpen] = useState(false);
    const [seasonWatchBusy, setSeasonWatchBusy] = useState(false);
    const [sheetLogoFailed, setSheetLogoFailed] = useState(false);
    const [sheetSeasons, setSheetSeasons] = useState<PlayerItem[]>([]);
    const sheetLogoUrl = plexLogoUrl(item.logo);
    const tvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );
    const [phoneUi, setPhoneUi] = useState(() => isPhonePosterUi());
    useEffect(() => {
        if (tvShell) return undefined;
        const mq = window.matchMedia('(hover: none) and (pointer: coarse), (max-width: 767px)');
        const apply = () => setPhoneUi(isPhonePosterUi());
        apply();
        mq.addEventListener?.('change', apply);
        return () => mq.removeEventListener?.('change', apply);
    }, [tvShell]);

    useEffect(() => {
        setSheetLogoFailed(false);
    }, [item.ratingKey, sheetLogoUrl]);

    const canWatchToggle = item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season';
    const musicItem = isMusicPlayerItem(item);
    const canPlayNext = !!onPlayNext
        && (
            (item.canPlay !== false && (item.type === 'movie' || item.type === 'episode' || item.type === 'clip' || item.type === 'trailer' || item.type === 'track'))
            || item.type === 'album'
            || item.type === 'artist'
        );
    const canShuffle = !!onPlay && (item.type === 'show' || item.type === 'season' || item.type === 'playlist' || item.type === 'collection'
        || item.type === 'album' || item.type === 'artist');
    const canPlayFromHere = !!onPlay && (item.type === 'episode' || item.type === 'track');
    const canWatchlist = item.type === 'movie' || item.type === 'show';
    const canRate = item.type === 'movie' || item.type === 'show' || item.type === 'episode' || item.type === 'season';
    const ratingStars = Math.max(0, Math.min(5, Math.round(Number(item.userRating || 0) / 2)));
    const canPlaylist = playlistsEnabled
        && (item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season');
    const isTv = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );
    const useContextSheet = isTv;
    const useMobileModal = !isTv && variant !== 'toolbar' && phoneUi;
    const canFileInfo = variant !== 'toolbar'
        && (item.type === 'movie' || item.type === 'episode' || item.type === 'clip' || item.type === 'trailer');
    const canPickAudio = variant === 'toolbar' && audioTracks.length > 0 && !!onAudioChange;
    const canPickSubtitles = variant === 'toolbar' && !!onSubtitleChange
        && (item.type === 'movie' || item.type === 'episode');
    const canDownload = !isTv
        && isAdmin
        && (item.type === 'movie' || item.type === 'episode' || item.type === 'clip' || item.type === 'trailer');
    const canPrimaryOpen = !!onOpenItem && variant !== 'toolbar'
        && (item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season'
            || item.type === 'clip' || item.type === 'trailer' || item.type === 'album' || item.type === 'artist');
    const canPrimaryWatch = !!onPlay
        && (
            (item.canPlay !== false && (item.type === 'movie' || item.type === 'episode' || item.type === 'clip' || item.type === 'trailer'))
            || ((item.type === 'album' || item.type === 'artist' || item.type === 'track') && variant !== 'toolbar')
        );
    const showKey = item.type === 'episode'
        ? String(item.grandparentRatingKey || '')
        : item.type === 'season'
            ? String(item.parentRatingKey || '')
            : '';
    const showName = (item.type === 'season'
        ? (item.showTitle || item.seasonTitle || '')
        : (item.showTitle || '')).trim();
    const seasonKey = item.type === 'episode' ? String(item.parentRatingKey || '') : '';
    const seasonName = (
        item.seasonTitle
        || (item.parentIndex != null ? `Season ${item.parentIndex}` : '')
    ).trim();
    const artistKey = item.type === 'album'
        ? String(item.parentRatingKey || '')
        : item.type === 'track'
            ? String(item.grandparentRatingKey || '')
            : '';
    const artistName = (item.type === 'album' || item.type === 'track' ? (item.showTitle || '') : '').trim();
    const albumKey = item.type === 'track' ? String(item.parentRatingKey || '') : '';
    const albumName = (item.type === 'track' ? (item.seasonTitle || '') : '').trim();
    const resumeItem = applyRememberedProgress(item);
    const primaryWatchLabel = musicItem
        ? t('mediaPlayerPage.play')
        : shouldOfferResume(resumeItem)
            ? t('mediaPlayerPage.resume')
            : t('mediaPlayerPage.watch');
    const canGoShow = Boolean(onOpenItem && showKey);
    const canGoSeason = Boolean(onOpenItem && seasonKey);
    const canGoArtist = Boolean(onOpenItem && artistKey);
    const canGoAlbum = Boolean(onOpenItem && albumKey);
    const canMarkSeasonWatched = item.type === 'episode' && !!seasonKey;
    const goShowLabel = showName
        ? t('mediaPlayerPage.goToNamed', { title: showName })
        : t('mediaPlayerPage.goToShow');
    const goSeasonLabel = seasonName
        ? t('mediaPlayerPage.goToNamed', { title: seasonName })
        : t('mediaPlayerPage.goToSeason');
    const showSeasonQuickLinks = useContextSheet && item.type === 'show' && !!onOpenItem;
    const itemClass = useContextSheet ? rowClass : (useMobileModal ? mobileRowClass : compactRowClass);
    const iconClass = useContextSheet
        ? 'h-[1.15rem] w-[1.15rem] shrink-0 opacity-90'
        : useMobileModal
            ? 'h-[1.15rem] w-[1.15rem] shrink-0 opacity-90'
            : 'h-4 w-4 shrink-0 opacity-80';

    useEffect(() => {
        if (!open || !showSeasonQuickLinks || !item.ratingKey) {
            setSheetSeasons([]);
            return undefined;
        }
        const cached = readPlayerItemCache(item.ratingKey);
        const fromCache = (cached?.children || []).filter((row) => row.type === 'season');
        if (fromCache.length) setSheetSeasons(fromCache);
        let cancelled = false;
        void fetchMediaPlayerItem(item.ratingKey, { core: true, serverId: item.serverId || null })
            .then((page) => {
                if (cancelled) return;
                setSheetSeasons((page.children || []).filter((row) => row.type === 'season'));
            })
            .catch(() => {
                if (!cancelled && !fromCache.length) setSheetSeasons([]);
            });
        return () => { cancelled = true; };
    }, [open, showSeasonQuickLinks, item.ratingKey, item.serverId]);

    const close = () => {
        setOpen(false);
        setMode('main');
        setNewPlaylistName('');
        try {
            delete document.documentElement.dataset.tvMenuOpen;
        } catch {
            /* ignore */
        }
        if (isTv) {
            if (variant === 'toolbar' && triggerRef.current) {
                triggerRef.current.focus({ preventScroll: true });
                return;
            }
            const key = String(item.ratingKey || '');
            const poster = key
                ? document.querySelector<HTMLElement>([
                    `[data-tv-poster-btn="1"][data-tv-key="${CSS.escape(key)}"]`,
                    `[data-tv-season-poster-btn="1"][data-tv-key="${CSS.escape(key)}"]`,
                    `[data-tv-episode-btn="1"][data-tv-key="${CSS.escape(key)}"]`,
                    `[data-tv-extra-btn="1"][data-tv-key="${CSS.escape(key)}"]`,
                ].join(', '))
                : null;
            poster?.focus({ preventScroll: true });
        }
    };

    const placeMenu = (clientX?: number, clientY?: number) => {
        if (useContextSheet || useMobileModal) return;
        const pad = 10;
        const linkRows = mode === 'main'
            ? (canGoShow ? 1 : 0) + (canGoSeason ? 1 : 0) + (canGoArtist ? 1 : 0) + (canGoAlbum ? 1 : 0)
            : 0;
        const height = (mode === 'playlist' ? 280 : 340) + linkRows * 44;
        const rect = triggerRef.current?.getBoundingClientRect();
        const box = rect ? rectToFixedPixels(rect) : null;
        const zoom = box?.zoom || 1;
        const viewportW = (typeof window !== 'undefined' ? window.innerWidth : MENU_MIN_WIDTH) / zoom;
        const viewportH = (typeof window !== 'undefined' ? window.innerHeight : height) / zoom;
        const measured = menuRef.current
            ? Math.min(MENU_MAX_WIDTH, Math.max(MENU_MIN_WIDTH, menuRef.current.offsetWidth))
            : MENU_MIN_WIDTH;
        const hasPoint = clientX != null && clientY != null && Number.isFinite(clientX) && Number.isFinite(clientY);
        const alignEnd = variant === 'toolbar' && !hasPoint;
        let left = hasPoint
            ? Number(clientX) / zoom
            : (box ? (alignEnd ? box.left + box.width - measured : box.left) : 0);
        let top = hasPoint ? Number(clientY) / zoom : (box ? box.bottom + 6 : 0);
        left = Math.min(Math.max(pad, left), Math.max(pad, viewportW - measured - pad));
        const spaceBelow = Math.max(0, viewportH - top - pad);
        const spaceAbove = box ? Math.max(0, box.top - pad) : 0;
        if (spaceBelow < Math.min(height, 220) && spaceAbove > spaceBelow) {
            top = Math.max(pad, (box ? box.top : height) - Math.min(height, spaceAbove));
        }
        const maxHeight = Math.max(160, viewportH - top - pad);
        top = Math.min(Math.max(pad, top), Math.max(pad, viewportH - Math.min(height, maxHeight) - pad));
        setPos({ top, left, maxHeight });
    };

    const openAt = (clientX?: number, clientY?: number) => {
        openedAtRef.current = Date.now();
        setMode('main');
        placeMenu(clientX, clientY);
        setOpen(true);
        if (isTv) {
            try {
                document.documentElement.dataset.tvMenuOpen = '1';
            } catch {
                /* ignore */
            }
        }
    };

    useImperativeHandle(ref, () => ({
        openAt: (x, y) => openAt(x, y),
    }), [useMobileModal, isTv]);

    useLayoutEffect(() => {
        if (!open || useContextSheet || useMobileModal) return undefined;
        placeMenu();
        const id = window.requestAnimationFrame(() => placeMenu());
        return () => window.cancelAnimationFrame(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, open, variant, useContextSheet, useMobileModal]);

    useEffect(() => {
        if (!trackPicker) return undefined;
        const closePicker = () => setTrackPicker(null);
        window.addEventListener('smp-tv-overlay-close', closePicker);
        const id = window.setTimeout(() => {
            const el = document.querySelector<HTMLElement>('[data-tv-track-primary="1"]')
                || document.querySelector<HTMLElement>('[data-tv-track-dialog="1"] [data-tv-item="1"]');
            el?.focus({ preventScroll: true });
            el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }, 40);
        return () => {
            window.removeEventListener('smp-tv-overlay-close', closePicker);
            window.clearTimeout(id);
        };
    }, [trackPicker]);

    useEffect(() => {
        if (!open) return undefined;
        const openedAt = Date.now();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };
        const onPointer = (event: MouseEvent | TouchEvent) => {
            if (Date.now() - openedAt < (useMobileModal ? 600 : 400)) return;
            const target = event.target as Node | null;
            if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
            close();
        };
        const onTvClose = () => close();
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onPointer);
        window.addEventListener('touchstart', onPointer, { passive: true });
        window.addEventListener(TV_MENU_CLOSE_EVENT, onTvClose);
        window.addEventListener('smp-tv-overlay-close', onTvClose);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onPointer);
            window.removeEventListener('touchstart', onPointer);
            window.removeEventListener(TV_MENU_CLOSE_EVENT, onTvClose);
            window.removeEventListener('smp-tv-overlay-close', onTvClose);
        };
    }, [open]);

    useEffect(() => {
        if (!open || !isTv) return undefined;
        let cancelled = false;
        let focusTimer = 0;
        const focusFirst = () => {
            if (cancelled) return;
            const first = menuRef.current?.querySelector<HTMLElement>('[data-tv-item="1"]');
            first?.focus({ preventScroll: true });
        };
        // Wait for Select release after a long-press so focus+keyup doesn't fire Watch.
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ' && event.keyCode !== 23 && event.keyCode !== 66) return;
            window.removeEventListener('keyup', onKeyUp, true);
            if (focusTimer) window.clearTimeout(focusTimer);
            focusTimer = window.setTimeout(focusFirst, 40);
        };
        window.addEventListener('keyup', onKeyUp, true);
        // Fallback if the hold already ended before the menu mounted.
        focusTimer = window.setTimeout(focusFirst, 450);
        return () => {
            cancelled = true;
            window.removeEventListener('keyup', onKeyUp, true);
            if (focusTimer) window.clearTimeout(focusTimer);
        };
    }, [open, mode, isTv]);

    useEffect(() => {
        if (!open) return undefined;
        const scroller = document.getElementById(PLAYER_SCROLL_ID);
        if (!scroller) return undefined;
        const frozen = scroller.scrollTop;
        const hold = () => {
            if (scroller.scrollTop !== frozen) scroller.scrollTop = frozen;
        };
        scroller.addEventListener('scroll', hold);
        return () => scroller.removeEventListener('scroll', hold);
    }, [open]);

    const loadPlaylists = async () => {
        try {
            const data = await fetchMediaPlayerPlaylists();
            setPlaylists(Array.isArray(data.items) ? data.items : []);
        } catch {
            setPlaylists([]);
        }
    };

    const toast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        onToast?.(message, type);
    };

    const openFileInfo = () => {
        setOpen(false);
        setMode('main');
        setNewPlaylistName('');
        try {
            delete document.documentElement.dataset.tvMenuOpen;
        } catch {
            /* ignore */
        }
        setFileInfoItem(item);
        if ((item.mediaInfo || []).length) {
            setFileInfoLoading(false);
            return;
        }
        setFileInfoLoading(true);
        void fetchMediaPlayerItem(item.ratingKey, { core: true })
            .then((data) => {
                if (data?.item) setFileInfoItem(data.item);
            })
            .catch(() => {
                toast(t('mediaPlayerPage.actionError'), 'error');
            })
            .finally(() => setFileInfoLoading(false));
    };

    const choose = (action: () => void | Promise<void>) => {
        close();
        void Promise.resolve()
            .then(action)
            .catch(() => {
                toast(t('mediaPlayerPage.actionError'), 'error');
            });
    };

    const watchToggle = canWatchToggle ? (
        <button
            type="button"
            role="menuitem"
            data-tv-item="1"
            data-tv-menu-item="1"
            className={itemClass}
            onClick={() => {
                const next = !item.watched;
                if (item.type === 'season' && next) {
                    close();
                    setSeasonWatchOpen(true);
                    return;
                }
                choose(async () => {
                    if (item.type === 'season') await setSeasonEpisodesWatched(item.ratingKey, next, item.serverId);
                    else await setMediaPlayerWatched(item.ratingKey, next, item);
                    onWatchedChange?.(item, next);
                    toast(next ? t('mediaPlayerPage.markedWatched') : t('mediaPlayerPage.markedUnwatched'));
                });
            }}
        >
            {useContextSheet
                ? (item.watched
                    ? <Circle className={iconClass} />
                    : <CheckCircle2 className={iconClass} />)
                : (item.watched
                    ? <EyeOff className={iconClass} />
                    : <Eye className={iconClass} />)}
            {item.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
        </button>
    ) : null;

    const goToShowBtn = canGoShow ? (
        <button
            type="button"
            role="menuitem"
            data-tv-item="1"
            data-tv-menu-item="1"
            className={itemClass}
            onClick={() => choose(() => {
                onOpenItem?.({
                    ratingKey: showKey,
                    type: 'show',
                    title: showName,
                    showTitle: showName,
                    thumb: item.thumb,
                    art: item.art,
                    serverId: item.serverId,
                    canPlay: false,
                });
            })}
        >
            <Tv className={iconClass} />
            <span className="whitespace-nowrap">{goShowLabel}</span>
        </button>
    ) : null;
    const goToSeasonBtn = canGoSeason ? (
        <button
            type="button"
            role="menuitem"
            data-tv-item="1"
            data-tv-menu-item="1"
            className={itemClass}
            onClick={() => choose(() => {
                onOpenItem?.({
                    ratingKey: seasonKey,
                    type: 'season',
                    title: seasonName,
                    showTitle: showName,
                    seasonTitle: seasonName,
                    parentRatingKey: showKey || null,
                    thumb: item.thumb,
                    art: item.art,
                    serverId: item.serverId,
                    canPlay: false,
                });
            })}
        >
            <Layers className={iconClass} />
            <span className="whitespace-nowrap">{goSeasonLabel}</span>
        </button>
    ) : null;
    const markSeasonBtn = canMarkSeasonWatched ? (
        <button
            type="button"
            role="menuitem"
            data-tv-item="1"
            data-tv-menu-item="1"
            className={itemClass}
            onClick={() => {
                close();
                setSeasonWatchOpen(true);
            }}
        >
            <CheckCircle2 className={iconClass} />
            <span className="whitespace-nowrap">
                {seasonName
                    ? t('mediaPlayerPage.markSeasonWatchedNamed', { title: seasonName })
                    : t('mediaPlayerPage.markSeasonWatched')}
            </span>
        </button>
    ) : null;

    const actionRows = mode === 'main' ? (
        <>
            {!useContextSheet && isTv ? watchToggle : null}
            {canPlayNext ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => choose(() => {
                        onPlayNext?.(item);
                        toast(t('mediaPlayerPage.playNextQueued', { title: item.title }));
                    })}
                >
                    <ListVideo className={iconClass} />
                    {t('mediaPlayerPage.playNext')}
                </button>
            ) : null}
            {canShuffle ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => choose(() => onPlay?.(item, { shuffle: true, skipResume: true, offsetMs: 0 }))}
                >
                    <Shuffle className={iconClass} />
                    {t('mediaPlayerPage.shufflePlay')}
                </button>
            ) : null}
            {canPlayFromHere ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => choose(() => onPlay?.(item, { playFromHere: true }))}
                >
                    <Play className={iconClass} />
                    {t('mediaPlayerPage.playFromHere')}
                </button>
            ) : null}
            {useContextSheet && (item.type === 'episode' || item.type === 'season') ? (
                <>
                    {goToShowBtn}
                    {goToSeasonBtn}
                    {markSeasonBtn}
                </>
            ) : null}
            {canWatchlist ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => choose(async () => {
                        const next = !item.watchlisted;
                        await setMediaPlayerWatchlisted(item, next);
                        toast(next ? t('mediaPlayerPage.addedToWatchlist') : t('mediaPlayerPage.removedFromWatchlist'));
                    })}
                >
                    {item.watchlisted ? <BookmarkCheck className={iconClass} /> : <Bookmark className={iconClass} />}
                    {item.watchlisted ? t('mediaPlayerPage.removeFromWatchlist') : t('mediaPlayerPage.addToWatchlist')}
                </button>
            ) : null}
            {canRate ? (
                <div className="px-1 py-1.5" data-tv-rail="1">
                    <p className="px-2.5 pb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">
                        {t('mediaPlayerPage.rate')}
                    </p>
                    <div className="flex items-center gap-0.5 px-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                key={star}
                                type="button"
                                data-tv-item="1"
                                data-tv-menu-item="1"
                                title={t('mediaPlayerPage.rate')}
                                aria-label={`${star}`}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.06]"
                                onClick={() => choose(async () => {
                                    const rating = star * 2;
                                    await setMediaPlayerRating(item.ratingKey, rating, item.serverId);
                                    toast(t('mediaPlayerPage.ratingSaved'));
                                })}
                            >
                                <Star
                                    className={`h-5 w-5 ${ratingStars >= star ? 'fill-plex text-plex' : 'text-white/35'}`}
                                />
                            </button>
                        ))}
                        {ratingStars > 0 ? (
                            <button
                                type="button"
                                data-tv-item="1"
                                data-tv-menu-item="1"
                                className="ml-1 px-2 text-xs font-semibold text-white/55 hover:text-white"
                                onClick={() => choose(async () => {
                                    await setMediaPlayerRating(item.ratingKey, 0, item.serverId);
                                    toast(t('mediaPlayerPage.ratingCleared'));
                                })}
                            >
                                {t('mediaPlayerPage.clearRating')}
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
            {canPlaylist ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => {
                        setMode('playlist');
                        void loadPlaylists();
                    }}
                >
                    <ListPlus className={iconClass} />
                    <span className="min-w-0 flex-1 whitespace-nowrap">{t('mediaPlayerPage.addToPlaylist')}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                </button>
            ) : null}
            {useContextSheet || !isTv ? watchToggle : null}
            {canGoShow || canGoSeason || canGoArtist || canGoAlbum ? (
                useContextSheet
                    ? null
                    : <div className="my-1.5 border-t border-white/10" />
            ) : null}
            {!(useContextSheet && (item.type === 'episode' || item.type === 'season')) ? (
                <>
                    {goToShowBtn}
                    {goToSeasonBtn}
                </>
            ) : null}
            {canGoArtist ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => choose(() => {
                        onOpenItem?.({
                            ratingKey: artistKey,
                            type: 'artist',
                            title: artistName || t('mediaPlayerPage.goToArtist'),
                            showTitle: artistName,
                            thumb: item.thumb,
                            art: item.art,
                            serverId: item.serverId,
                            canPlay: true,
                        });
                    })}
                >
                    <Music className={iconClass} />
                    <span className="whitespace-nowrap">
                        {artistName ? t('mediaPlayerPage.goToNamed', { title: artistName }) : t('mediaPlayerPage.goToArtist')}
                    </span>
                </button>
            ) : null}
            {canGoAlbum ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => choose(() => {
                        onOpenItem?.({
                            ratingKey: albumKey,
                            type: 'album',
                            title: albumName || t('mediaPlayerPage.goToAlbum'),
                            showTitle: artistName,
                            parentRatingKey: artistKey || null,
                            thumb: item.thumb,
                            art: item.art,
                            serverId: item.serverId,
                            canPlay: true,
                        });
                    })}
                >
                    <Disc className={iconClass} />
                    <span className="whitespace-nowrap">
                        {albumName ? t('mediaPlayerPage.goToNamed', { title: albumName }) : t('mediaPlayerPage.goToAlbum')}
                    </span>
                </button>
            ) : null}
            {showRemoveFromContinueWatching ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => choose(async () => {
                        await removeMediaPlayerProgress(item.ratingKey);
                        onRemovedFromContinueWatching?.(item);
                        toast(t('mediaPlayerPage.removedFromContinueWatching'));
                    })}
                >
                    <XCircle className={iconClass} />
                    {t('mediaPlayerPage.removeFromContinueWatching')}
                </button>
            ) : null}
            {canPickAudio ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => {
                        setOpen(false);
                        setMode('main');
                        try {
                            delete document.documentElement.dataset.tvMenuOpen;
                        } catch {
                            /* ignore */
                        }
                        setTrackPicker('audio');
                    }}
                >
                    <Volume2 className={iconClass} />
                    {t('mediaPlayerPage.selectAudio')}
                </button>
            ) : null}
            {canPickSubtitles ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => {
                        setOpen(false);
                        setMode('main');
                        try {
                            delete document.documentElement.dataset.tvMenuOpen;
                        } catch {
                            /* ignore */
                        }
                        setTrackPicker('subtitles');
                    }}
                >
                    <Captions className={iconClass} />
                    {t('mediaPlayerPage.selectSubtitles')}
                </button>
            ) : null}
            {canFileInfo ? (
                <button
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={openFileInfo}
                >
                    <Info className={iconClass} />
                    {t('mediaPlayerPage.fileInfo')}
                </button>
            ) : null}
            {isAdmin ? (
                <>
                    {!useContextSheet ? <div className="my-1.5 border-t border-white/10" /> : null}
                    {canDownload ? (
                        <button
                            type="button"
                            role="menuitem"
                            data-tv-item="1"
                            data-tv-menu-item="1"
                            className={itemClass}
                            onClick={() => choose(async () => {
                                await startMediaPlayerDownload(item.ratingKey);
                                toast(t('mediaPlayerPage.downloadStarted'));
                            })}
                        >
                            <Download className={iconClass} />
                            {t('mediaPlayerPage.download')}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        role="menuitem"
                        data-tv-item="1"
                        data-tv-menu-item="1"
                        className={`${itemClass} text-red-300 hover:bg-red-500/15`}
                        onClick={() => {
                            close();
                            const ok = window.confirm(t('mediaPlayerPage.deleteConfirm', { title: item.title }));
                            if (!ok) return;
                            void deleteMediaPlayerItem(item.ratingKey).then(() => {
                                onDeleted?.(item);
                                toast(t('mediaPlayerPage.deletedTitle', { title: item.title }));
                            }).catch(() => {
                                toast(t('mediaPlayerPage.actionError'), 'error');
                            });
                        }}
                    >
                        <Trash2 className={iconClass} />
                        {t('mediaPlayerPage.delete')}
                    </button>
                </>
            ) : null}
        </>
    ) : (
        <div className={`flex flex-col ${useContextSheet ? 'min-h-0 flex-1' : 'max-h-72'}`}>
            <button
                type="button"
                data-tv-item="1"
                data-tv-menu-item="1"
                className={useContextSheet
                    ? 'mb-1 flex items-center gap-2 px-1 py-2.5 text-left text-sm font-bold uppercase tracking-wider text-white/55 hover:bg-white/[0.06]'
                    : 'flex items-center gap-2 px-3.5 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted hover:bg-white/5'}
                onClick={() => setMode('main')}
            >
                {t('mediaPlayerPage.back')}
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                {playlists.map((playlist) => (
                    <button
                        key={playlist.ratingKey}
                        type="button"
                        data-tv-item="1"
                        data-tv-menu-item="1"
                        className={itemClass}
                        onClick={() => choose(async () => {
                            await addMediaPlayerPlaylistItem(playlist.ratingKey, item.ratingKey);
                            toast(t('mediaPlayerPage.addedToPlaylist', { name: playlist.title }));
                        })}
                    >
                        <span className="truncate">{playlist.title}</span>
                    </button>
                ))}
            </div>
            <form
                className={`flex gap-1 ${useContextSheet ? 'mt-2 border-t border-white/10 pt-3' : 'border-t border-white/10 p-2'}`}
                onSubmit={(event) => {
                    event.preventDefault();
                    const title = newPlaylistName.trim();
                    if (!title) return;
                    choose(async () => {
                        const created = await createMediaPlayerPlaylist(title, item.ratingKey);
                        toast(t('mediaPlayerPage.addedToPlaylist', { name: created.item?.title || title }));
                    });
                }}
            >
                <input
                    value={newPlaylistName}
                    onChange={(event) => setNewPlaylistName(event.target.value)}
                    placeholder={t('mediaPlayerPage.playlistName')}
                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-white"
                />
                <button type="submit" className="rounded-lg bg-plex px-2 py-1.5 text-[10px] font-black text-black">
                    {t('mediaPlayerPage.createPlaylist')}
                </button>
            </form>
        </div>
    );

    const showSeasonLinks = showSeasonQuickLinks ? (
        <>
            <div className="my-2 border-t border-white/10" />
            <button
                type="button"
                role="menuitem"
                data-tv-item="1"
                data-tv-menu-item="1"
                className={itemClass}
                onClick={() => choose(() => onOpenItem?.(item))}
            >
                <Tv className={iconClass} />
                <span className="whitespace-nowrap">{t('mediaPlayerPage.goToShow')}</span>
            </button>
            {sheetSeasons.map((season) => (
                <button
                    key={season.ratingKey}
                    type="button"
                    role="menuitem"
                    data-tv-item="1"
                    data-tv-menu-item="1"
                    className={itemClass}
                    onClick={() => choose(() => {
                        onOpenItem?.({
                            ...season,
                            thumb: season.thumb || item.thumb,
                            art: season.art || item.art,
                            showTitle: season.showTitle || item.title || item.showTitle,
                            parentRatingKey: item.ratingKey,
                            serverId: season.serverId || item.serverId,
                            canPlay: false,
                        });
                    })}
                >
                    <Layers className={iconClass} />
                    <span className="min-w-0 flex-1 truncate">
                        {season.title || (season.index != null ? t('mediaPlayerPage.goToNamed', { title: `Season ${season.index}` }) : t('mediaPlayerPage.goToSeason'))}
                    </span>
                </button>
            ))}
        </>
    ) : null;

    const stopBubble = {
        onClick: (event: React.MouseEvent) => event.stopPropagation(),
        onClickCapture: (event: React.MouseEvent) => {
            if (Date.now() - openedAtRef.current < 450) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
    };

    const menuShell = open ? (
        useContextSheet ? (
            <div
                className="fixed inset-0 z-[3500] flex justify-end bg-black/35"
                data-tv-context-backdrop="1"
                onClick={(event) => {
                    if (event.target === event.currentTarget) close();
                }}
            >
                <div
                    ref={menuRef}
                    role="menu"
                    data-tv-item-menu="1"
                    data-tv-context-sheet="1"
                    tabIndex={-1}
                    className="player-context-sheet flex max-h-full w-[min(30rem,48vw)] min-w-[22rem] flex-col overflow-hidden outline-none"
                    {...stopBubble}
                >
                    {mode === 'main' ? (
                        <>
                            {sheetLogoUrl && !sheetLogoFailed ? (
                                <div className="player-context-logo mb-4 flex w-full shrink-0 items-center justify-center px-1 pt-1">
                                    <PlayerClearLogo
                                        src={sheetLogoUrl}
                                        alt={item.title || t('mediaPlayerPage.unknownTitle')}
                                        center
                                        className="mx-auto max-h-9 w-auto max-w-[78%] object-contain object-center drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
                                        onError={() => setSheetLogoFailed(true)}
                                    />
                                </div>
                            ) : (
                                <h2 className="shrink-0 truncate px-1 pb-4 pt-1 text-[1.35rem] font-bold leading-tight tracking-tight text-white">
                                    {item.title || t('mediaPlayerPage.unknownTitle')}
                                </h2>
                            )}
                            {(canPrimaryOpen || canPrimaryWatch) ? (
                                <div className="mb-4 flex w-full shrink-0 flex-col gap-2.5">
                                    {canPrimaryWatch ? (
                                        <button
                                            type="button"
                                            role="menuitem"
                                            data-tv-item="1"
                                            data-tv-menu-item="1"
                                            data-tv-menu-watch="1"
                                            className="flex w-full items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3.5 text-[1.08rem] font-bold text-zinc-900 outline-none"
                                            onClick={() => choose(() => onPlay?.(resumeItem))}
                                        >
                                            <Play className="h-5 w-5 fill-current" />
                                            {primaryWatchLabel}
                                        </button>
                                    ) : null}
                                    {canPrimaryOpen ? (
                                        <button
                                            type="button"
                                            role="menuitem"
                                            data-tv-item="1"
                                            data-tv-menu-item="1"
                                            data-tv-menu-watch="1"
                                            className="flex w-full items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3.5 text-[1.08rem] font-bold text-zinc-900 outline-none"
                                            onClick={() => choose(() => onOpenItem?.(item))}
                                        >
                                            {t('mediaPlayerPage.moreInfo')}
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain hide-scrollbar">
                                {actionRows}
                                {showSeasonLinks}
                            </div>
                        </>
                    ) : actionRows}
                </div>
            </div>
        ) : useMobileModal ? (
            <div
                className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/55 p-5"
                data-player-mobile-context="1"
                onClick={(event) => {
                    if (event.target === event.currentTarget) close();
                }}
            >
                <div
                    ref={menuRef}
                    role="menu"
                    data-tv-item-menu="1"
                    className="player-mobile-context-modal flex max-h-[min(78dvh,36rem)] w-full max-w-[22rem] flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#1c2028] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
                    {...stopBubble}
                >
                    <div className="shrink-0 border-b border-white/10 px-4 py-3.5">
                        <p className="truncate text-[1.05rem] font-bold leading-tight text-white">
                            {item.title || t('mediaPlayerPage.unknownTitle')}
                        </p>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        {actionRows}
                    </div>
                    <button
                        type="button"
                        className="shrink-0 border-t border-white/10 px-4 py-3.5 text-center text-sm font-bold text-white/75 active:bg-white/[0.06]"
                        onClick={close}
                    >
                        {t('common.close')}
                    </button>
                </div>
            </div>
        ) : (
            <div
                ref={menuRef}
                role="menu"
                data-tv-item-menu="1"
                className="player-popup-surface player-context-menu fixed z-[3500] w-max min-w-[220px] max-w-[min(calc(100vw-1.25rem),26rem)] overflow-y-auto overscroll-contain rounded-lg py-1.5 text-sm text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight || undefined }}
                {...stopBubble}
            >
                {actionRows}
            </div>
        )
    ) : null;

    const menu = !menuShell
        ? menuShell
        : createPortal(menuShell, document.body);

    return (
        <div className={variant === 'toolbar' ? 'relative media-details-action-slot' : ''}>
            <button
                ref={triggerRef}
                type="button"
                tabIndex={hideTrigger || useMobileModal ? -1 : undefined}
                data-tv-item={variant === 'toolbar' && !hideTrigger ? '1' : undefined}
                data-tv-action={variant === 'toolbar' && !hideTrigger ? '1' : undefined}
                data-tv-key={variant === 'toolbar' && !hideTrigger ? `more:${item.ratingKey}` : undefined}
                aria-hidden={hideTrigger || useMobileModal ? true : undefined}
                aria-label={t('mediaPlayerPage.moreActions')}
                aria-haspopup="menu"
                aria-expanded={open}
                className={hideTrigger || useMobileModal
                    ? 'sr-only'
                    : variant === 'toolbar'
                    ? 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10'
                    : 'pointer-events-auto absolute bottom-1.5 right-1.5 z-30 hidden h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black md:flex md:opacity-0 md:group-hover:opacity-100'}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (open) close();
                    else openAt();
                }}
            >
                <MoreVertical className="h-4 w-4" />
                {variant === 'toolbar' ? <span className="media-details-action-label">{t('mediaPlayerPage.actionMore')}</span> : null}
            </button>
            {menu}
            {fileInfoItem ? (
                <PlayerFileInfo
                    item={fileInfoItem}
                    loading={fileInfoLoading}
                    mediaIndex={mediaIndex}
                    audioStreamId={audioStreamId}
                    onClose={() => setFileInfoItem(null)}
                />
            ) : null}
            {trackPicker ? (
                <div
                    className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/70 p-4"
                    role="dialog"
                    aria-modal="true"
                    data-tv-track-dialog="1"
                >
                    <div className="player-popup-surface flex max-h-[min(78vh,44rem)] w-full max-w-lg flex-col rounded-2xl border border-white/10 p-5 shadow-2xl">
                        <p className="shrink-0 text-xs font-black uppercase tracking-widest text-muted">
                            {trackPicker === 'audio' ? t('mediaPlayerPage.selectAudio') : t('mediaPlayerPage.selectSubtitles')}
                        </p>
                        <h2 className="mt-2 shrink-0 truncate text-lg font-bold text-text">{item.title}</h2>
                        <div
                            className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain hide-scrollbar"
                            data-tv-rail="1"
                            data-tv-overlay-scroll="1"
                        >
                            <div className="flex flex-col gap-2 pr-1">
                                {(trackPicker === 'audio'
                                    ? audioTracks
                                    : [{ id: '0', label: t('mediaPlayerPage.subtitlesOff') }, ...subtitleTracks]
                                ).map((row) => {
                                    const selected = trackPicker === 'audio'
                                        ? String(row.id) === String(audioStreamId || audioTracks[0]?.id)
                                        : String(row.id) === String(subtitleStreamId || '0');
                                    return (
                                        <button
                                            key={row.id}
                                            type="button"
                                            data-tv-item="1"
                                            data-tv-action="1"
                                            data-tv-track-primary={selected ? '1' : undefined}
                                            onClick={() => {
                                                if (trackPicker === 'audio') onAudioChange?.(row.id);
                                                else onSubtitleChange?.(row.id);
                                                setTrackPicker(null);
                                            }}
                                            className={`rounded-xl border px-4 py-3 text-left text-sm font-bold outline-none ${
                                                selected
                                                    ? 'border-plex/50 bg-plex/15 text-text'
                                                    : 'border-white/10 bg-white/5 text-text hover:border-plex/40 hover:bg-white/10'
                                            }`}
                                        >
                                            {row.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            onClick={() => setTrackPicker(null)}
                            className="mt-3 shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-muted hover:text-text outline-none"
                        >
                            {t('common.close')}
                        </button>
                    </div>
                </div>
            ) : null}
            {seasonWatchOpen && (item.type === 'season' || canMarkSeasonWatched) ? (
                <PlayerSeasonWatchDialog
                    episodeCount={item.type === 'season' ? Number(item.leafCount || 0) : 0}
                    busy={seasonWatchBusy}
                    tvShell={tvShell}
                    onConfirm={() => {
                        if (seasonWatchBusy) return;
                        const seasonRatingKey = item.type === 'season' ? item.ratingKey : seasonKey;
                        if (!seasonRatingKey) return;
                        setSeasonWatchBusy(true);
                        void setSeasonEpisodesWatched(seasonRatingKey, true, item.serverId)
                            .then(() => {
                                onWatchedChange?.(item, true);
                                toast(t('mediaPlayerPage.markedWatched'));
                                setSeasonWatchOpen(false);
                            })
                            .catch(() => {
                                toast(t('mediaPlayerPage.actionError'), 'error');
                            })
                            .finally(() => setSeasonWatchBusy(false));
                    }}
                    onClose={() => { if (!seasonWatchBusy) setSeasonWatchOpen(false); }}
                />
            ) : null}
        </div>
    );
});

PlayerItemMenu.displayName = 'PlayerItemMenu';
