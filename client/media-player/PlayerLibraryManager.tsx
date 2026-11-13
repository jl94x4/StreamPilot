import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, ChevronUp, Heart, X } from 'lucide-react';
import { lockBackgroundScroll, useDiscoverI18n } from './host';
import { fetchMediaPlayerServers, saveMediaPlayerSettings } from './api';
import { homeLibraryKey, homeLibraryShown, type HomeLibraryPicks } from './homeLibraries';
import { homeLibraryChoices, toggleHomeLibraryPick } from './HomeLibraryHearts';
import { invalidatePlayerHomeCache } from './playerMemory';
import { applyLibraryNavOrder, readPlayerSettings, writePlayerSettings, type PlayerSettings } from './playerSettings';
import type { PlayerSection } from './types';
import { TvButton } from '../shared/TvButton';

let serverSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Apply a change straight away (sidebar, Home, library row) and sync it to the server shortly after. */
const persistNow = (patch: Partial<PlayerSettings>) => {
    const saved = { ...readPlayerSettings(), ...patch };
    writePlayerSettings(saved);
    // Only the hearts change which rows Home fetches. Reordering is applied to the rows already loaded,
    // and dropping the cache for it made Home reload from the server (showing only the local rows meanwhile).
    if (patch.homeLibraries) invalidatePlayerHomeCache();
    if (serverSaveTimer) clearTimeout(serverSaveTimer);
    serverSaveTimer = setTimeout(() => {
        serverSaveTimer = null;
        void saveMediaPlayerSettings(readPlayerSettings()).catch(() => undefined);
    }, 350);
};

/**
 * Library keys in their saved order with `key` swapped with its neighbour inside the same server.
 * Order is one list for every server, so only the two positions involved change.
 */
export const moveLibraryWithinGroup = (
    fullOrder: string[],
    groupKeys: string[],
    key: string,
    delta: -1 | 1,
): string[] => {
    const at = groupKeys.indexOf(key);
    const neighbour = groupKeys[at + delta];
    if (at < 0 || !neighbour) return fullOrder;
    const next = [...fullOrder];
    const a = next.indexOf(key);
    const b = next.indexOf(neighbour);
    if (a < 0 || b < 0) return fullOrder;
    next[a] = neighbour;
    next[b] = key;
    return next;
};

type Props = {
    open: boolean;
    libraries: PlayerSection[];
    order: string[];
    picks: HomeLibraryPicks;
    /** Width of the side menu in rem, so the panel sits right next to it. */
    navWidthRem?: number;
    onOpenLibrary?: (library: PlayerSection) => void;
    /** Servers that did not answer: marked in their heading. */
    offlineServerIds?: string[];
    onClose: () => void;
};

export const PlayerLibraryManager: React.FC<Props> = ({ open, libraries, order, picks, navWidthRem = 16.25, onOpenLibrary, offlineServerIds = [], onClose }) => {
    const { t } = useDiscoverI18n();
    // Names of the servers this account can reach, so each group carries its server's name.
    const [serverNames, setServerNames] = useState<Record<string, string>>({});
    useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        fetchMediaPlayerServers()
            .then((data) => {
                if (cancelled) return;
                const names: Record<string, string> = {};
                for (const row of data?.servers || []) {
                    if (row?.id && row.name) names[String(row.id)] = String(row.name);
                }
                setServerNames(names);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [open]);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );

    useEffect(() => {
        if (!open) return undefined;
        const unlock = lockBackgroundScroll();
        const onOverlayClose = () => onCloseRef.current();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCloseRef.current();
        };
        window.addEventListener('smp-tv-overlay-close', onOverlayClose);
        window.addEventListener('keydown', onKey);
        const id = window.requestAnimationFrame(() => {
            const root = document.querySelector<HTMLElement>('[data-tv-library-manager="1"]');
            root?.querySelector<HTMLElement>('[data-tv-item="1"]:not([disabled])')?.focus({ preventScroll: true });
        });
        return () => {
            unlock();
            window.removeEventListener('smp-tv-overlay-close', onOverlayClose);
            window.removeEventListener('keydown', onKey);
            window.cancelAnimationFrame(id);
        };
    }, [open]);

    if (!open || typeof document === 'undefined') return null;

    const choices = homeLibraryChoices(libraries);
    const ordered = applyLibraryNavOrder(choices, order);
    const fullOrder = ordered.map((row) => row.key);
    const groups = new Map<string, PlayerSection[]>();
    for (const library of ordered) {
        const id = String(library.serverId || '');
        groups.set(id, [...(groups.get(id) || []), library]);
    }
    const favouriteCount = choices.filter((row) => homeLibraryShown(picks, row.serverId, row.key)).length;

    const refocus = (key: string, delta: -1 | 1) => {
        window.requestAnimationFrame(() => {
            const root = document.querySelector<HTMLElement>('[data-tv-library-manager="1"]');
            if (!root) return;
            const pick = (dir: 'up' | 'down') => root.querySelector<HTMLElement>(`[data-tv-key="lib-${key}-${dir}"]:not([disabled])`);
            (pick(delta < 0 ? 'up' : 'down') || pick(delta < 0 ? 'down' : 'up')
                || root.querySelector<HTMLElement>(`[data-tv-key="lib-${key}-heart"]`))?.focus({ preventScroll: true });
        });
    };

    const move = (group: PlayerSection[], key: string, delta: -1 | 1) => {
        const next = moveLibraryWithinGroup(fullOrder, group.map((row) => row.key), key, delta);
        if (next.join('|') === fullOrder.join('|')) return;
        persistNow({ libraryNavOrder: next });
        refocus(key, delta);
    };

    const iconButton = 'flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted outline-none disabled:opacity-30';
    const iconSize = isTvShell ? 'h-10 w-10' : 'h-9 w-9';

    // Wide screens (TV, desktop): a second panel right beside the side menu, which stays on screen.
    // Phones keep a bottom sheet because the menu itself is a sheet there.
    const beside = isTvShell || (typeof window !== 'undefined' && window.innerWidth >= 768);
    const panelLeft = `calc(0.75rem + ${navWidthRem}rem + 0.75rem)`;

    return ReactDOM.createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-library-manager-title"
        >
            <button
                type="button"
                tabIndex={-1}
                className={`fixed inset-0 cursor-default ${
                    beside ? 'z-[35] bg-black/55' : 'z-[110] bg-black/75 backdrop-blur-xl'
                }`}
                aria-label={t('mediaPlayerPage.manageLibrariesClose')}
                onClick={onClose}
            />
            <div
                data-tv-library-manager="1"
                style={beside ? { left: panelLeft, width: `min(27rem, calc(100vw - ${panelLeft} - 1.5rem))` } : undefined}
                className={`flex flex-col overflow-hidden ${
                    beside
                        ? 'fixed top-1/2 z-[45] max-h-[calc(100%-3rem)] -translate-y-1/2 rounded-[28px] bg-[#0b1018]/80 backdrop-blur-2xl'
                        : 'player-popup-surface fixed inset-x-0 bottom-0 z-[111] max-h-[min(86dvh,44rem)] w-full rounded-t-2xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.55)]'
                }`}
            >
                <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-1 pt-4">
                    <div className="min-w-0">
                        <h2 id="player-library-manager-title" className="text-lg font-black tracking-tight text-text">
                            {t('mediaPlayerPage.manageLibrariesTitle')}
                        </h2>
                        <p className="mt-1 text-xs leading-relaxed text-muted">{t('mediaPlayerPage.manageLibrariesHint')}</p>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                            {t('mediaPlayerPage.manageLibrariesCount', { count: favouriteCount })}
                        </p>
                    </div>
                    <TvButton
                        type="button"
                        data-tv-item="1"
                        data-tv-key="lib-manager-close"
                        onClick={onClose}
                        className="shrink-0 rounded-xl p-2 text-muted outline-none hover:bg-white/5 hover:text-text"
                        aria-label={t('mediaPlayerPage.manageLibrariesClose')}
                    >
                        <X className="h-5 w-5" />
                    </TvButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
                    {!ordered.length ? (
                        <p className="text-sm text-muted">{t('mediaPlayerPage.homeLibrariesEmpty')}</p>
                    ) : null}
                    <div className="flex flex-col gap-4">
                        {[...groups.entries()].map(([serverId, rows]) => {
                            const serverName = serverNames[serverId] || String(rows[0]?.serverName || '').trim();
                            const serverOffline = offlineServerIds.includes(serverId);
                            return (
                                <div key={serverId || 'server'} className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2 px-1 pb-0.5">
                                        <h3 className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                                            {serverName || t('mediaPlayerPage.manageLibrariesServer')}
                                        </h3>
                                        <div className="h-px min-w-0 flex-1 bg-white/10" />
                                        {serverOffline ? (
                                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                                                {t('mediaPlayerPage.libraryServerOffline')}
                                            </span>
                                        ) : null}
                                    </div>
                                    {rows.map((library, index) => {
                                        const shown = homeLibraryShown(picks, library.serverId, library.key);
                                        const key = library.key;
                                        return (
                                            <div
                                                key={homeLibraryKey(library.serverId, library.key) || key}
                                                data-tv-rail="1"
                                                className="flex items-center gap-1.5"
                                            >
                                                <TvButton
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-key={`lib-${key}-open`}
                                                    onClick={() => onOpenLibrary?.(library)}
                                                    className={`min-w-0 flex-1 rounded-full px-4 py-2 text-left outline-none ${
                                                        shown ? 'bg-white/10' : 'bg-white/[0.05]'
                                                    }`}
                                                >
                                                    <span className={`block truncate text-sm font-bold ${shown ? 'text-text' : 'text-muted'}`}>{library.title}</span>
                                                </TvButton>
                                                <TvButton
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-key={`lib-${key}-heart`}
                                                    aria-pressed={shown}
                                                    onClick={() => persistNow({ homeLibraries: toggleHomeLibraryPick(picks, libraries, library) })}
                                                    className={`${iconButton} ${iconSize} border-transparent bg-transparent`}
                                                    aria-label={shown ? t('mediaPlayerPage.homeLibraryShown') : t('mediaPlayerPage.homeLibraryHidden')}
                                                >
                                                    <Heart
                                                        className={`h-5 w-5 ${shown ? 'text-white' : 'text-muted'}`}
                                                        fill={shown ? 'currentColor' : 'none'}
                                                        strokeWidth={2.2}
                                                    />
                                                </TvButton>
                                                <TvButton
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-key={`lib-${key}-up`}
                                                    disabled={index === 0}
                                                    onClick={() => move(rows, key, -1)}
                                                    className={`${iconButton} ${iconSize}`}
                                                    aria-label={t('mediaPlayerPage.homeRowMoveUp')}
                                                >
                                                    <ChevronUp className="h-4 w-4" />
                                                </TvButton>
                                                <TvButton
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-key={`lib-${key}-down`}
                                                    disabled={index === rows.length - 1}
                                                    onClick={() => move(rows, key, 1)}
                                                    className={`${iconButton} ${iconSize}`}
                                                    aria-label={t('mediaPlayerPage.homeRowMoveDown')}
                                                >
                                                    <ChevronDown className="h-4 w-4" />
                                                </TvButton>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};
