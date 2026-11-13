import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, ChevronUp, Heart, X } from 'lucide-react';
import { lockBackgroundScroll, useDiscoverI18n } from './host';
import { saveMediaPlayerSettings } from './api';
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
    invalidatePlayerHomeCache();
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
    onClose: () => void;
};

/**
 * All libraries, split by server: a heart shows or hides each one in the side menu, on Home and in the
 * library row, and the arrows move it. Everything applies live, no Save and no trip to Settings.
 */
export const PlayerLibraryManager: React.FC<Props> = ({ open, libraries, order, picks, onClose }) => {
    const { t } = useDiscoverI18n();
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
    const typeLabel = (type: string) => (
        type === 'movie'
            ? t('mediaPlayerPage.homeLibraryMovies')
            : type === 'show' ? t('mediaPlayerPage.homeLibraryShows') : t('mediaPlayerPage.homeLibraryMusic')
    );

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

    const iconButton = 'flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted outline-none disabled:opacity-30';
    const iconSize = isTvShell ? 'h-12 w-12' : 'h-10 w-10';

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-library-manager-title"
        >
            <button
                type="button"
                tabIndex={-1}
                className={`absolute inset-0 cursor-default ${isTvShell ? 'bg-[rgb(5,7,11)]' : 'bg-black/75 backdrop-blur-xl'}`}
                aria-label={t('mediaPlayerPage.manageLibrariesClose')}
                onClick={onClose}
            />
            <div
                data-tv-library-manager="1"
                className="player-popup-surface relative flex max-h-[min(86dvh,44rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.55)] sm:max-w-xl sm:rounded-3xl"
            >
                <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-5 sm:px-7 sm:pt-6">
                    <div className="min-w-0">
                        <h2 id="player-library-manager-title" className="text-xl font-black tracking-tight text-text sm:text-2xl">
                            {t('mediaPlayerPage.manageLibrariesTitle')}
                        </h2>
                        <p className="mt-1 text-sm text-muted">{t('mediaPlayerPage.manageLibrariesHint')}</p>
                        <p className="mt-2 text-xs font-bold uppercase tracking-widest text-muted">
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
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-7 sm:pb-6">
                    {!ordered.length ? (
                        <p className="text-sm text-muted">{t('mediaPlayerPage.homeLibrariesEmpty')}</p>
                    ) : null}
                    <div className="flex flex-col gap-5">
                        {[...groups.entries()].map(([serverId, rows]) => {
                            const serverName = String(rows[0]?.serverName || '').trim();
                            return (
                                <div key={serverId || 'server'} className="flex flex-col gap-2">
                                    {groups.size > 1 ? (
                                        <h3 className="px-1 text-xs font-black uppercase tracking-widest text-muted">
                                            {serverName || t('mediaPlayerPage.manageLibrariesServer')}
                                        </h3>
                                    ) : null}
                                    {rows.map((library, index) => {
                                        const shown = homeLibraryShown(picks, library.serverId, library.key);
                                        const key = library.key;
                                        return (
                                            <div
                                                key={homeLibraryKey(library.serverId, library.key) || key}
                                                data-tv-rail="1"
                                                className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${
                                                    shown ? 'border-plex/40 bg-plex/10' : 'border-white/10 bg-white/[0.03]'
                                                }`}
                                            >
                                                <TvButton
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-key={`lib-${key}-heart`}
                                                    aria-pressed={shown}
                                                    onClick={() => persistNow({ homeLibraries: toggleHomeLibraryPick(picks, libraries, library) })}
                                                    className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-2 py-2 text-left outline-none"
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-base font-bold text-text">{library.title}</span>
                                                        <span className="mt-0.5 block text-xs text-muted">{typeLabel(String(library.type || ''))}</span>
                                                    </span>
                                                    <Heart
                                                        className={`h-6 w-6 shrink-0 ${shown ? 'text-plex' : 'text-muted'}`}
                                                        fill={shown ? 'currentColor' : 'none'}
                                                        strokeWidth={2.2}
                                                        aria-label={shown ? t('mediaPlayerPage.homeLibraryShown') : t('mediaPlayerPage.homeLibraryHidden')}
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
                                                    <ChevronUp className="h-5 w-5" />
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
                                                    <ChevronDown className="h-5 w-5" />
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
