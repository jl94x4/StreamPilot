import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderSearch, RefreshCw } from 'lucide-react';
import { TvButton } from '../shared/TvButton';
import { useDiscoverI18n } from './host';
import { scanMediaPlayerLibrary } from './api';

/**
 * Window event: open the library options (scan files / refresh metadata) for one library.
 * detail: { libraryId: string; title?: string }. Sent by the library page's ⋯ button and by a long-press on a
 * library in the sidebar. Admins only; the sheet ignores the event otherwise.
 */
export const LIBRARY_OPTIONS_EVENT = 'smp-library-options';

/** opener: where the focus goes back to when the sheet closes (default: whatever is focused when it opens). */
export type LibraryOptionsDetail = { libraryId: string; title?: string; opener?: HTMLElement | null };

export const openLibraryOptions = (detail: LibraryOptionsDetail): void => {
    window.dispatchEvent(new CustomEvent<LibraryOptionsDetail>(LIBRARY_OPTIONS_EVENT, { detail }));
};

type Props = {
    isAdmin: boolean;
    onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

/**
 * The sheet uses the same markup as the other TV menus (data-tv-item-menu + data-tv-context-sheet), so on TV the
 * native menu view draws it and Back closes it like any other menu.
 */
export const LibraryOptionsSheet: React.FC<Props> = ({ isAdmin, onToast }) => {
    const { t } = useDiscoverI18n();
    const [target, setTarget] = useState<LibraryOptionsDetail | null>(null);
    const opener = useRef<HTMLElement | null>(null);

    const close = useCallback((refocus = true) => {
        setTarget(null);
        try {
            delete document.documentElement.dataset.tvMenuOpen;
        } catch {
            /* ignore */
        }
        if (!refocus) return;
        const back = opener.current;
        // Now, before the sheet unmounts: when the native menu hands the remote back, the page regains window
        // focus on whatever is focused, and the native sidebar follows that (it would otherwise land on Home).
        if (back && document.body.contains(back)) back.focus({ preventScroll: true });
        // Twice: closing the native menu hands the remote to the page, which can put the focus back on the
        // current page's menu item (Home) a moment later; the row the options were opened from wins.
        [60, 300].forEach((ms) => window.setTimeout(() => {
            if (!back || !document.body.contains(back) || document.activeElement === back) return;
            if (document.querySelector('[data-tv-item-menu="1"], [data-tv-exit-dialog="1"]')) return;
            back.focus({ preventScroll: true });
        }, ms));
    }, []);

    useEffect(() => {
        const onOpen = (event: Event) => {
            const detail = (event as CustomEvent<LibraryOptionsDetail>).detail;
            if (!detail?.libraryId || !isAdmin) return;
            opener.current = detail.opener
                || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
            try {
                document.documentElement.dataset.tvMenuOpen = '1';
            } catch {
                /* ignore */
            }
            setTarget(detail);
        };
        window.addEventListener(LIBRARY_OPTIONS_EVENT, onOpen);
        return () => window.removeEventListener(LIBRARY_OPTIONS_EVENT, onOpen);
    }, [isAdmin]);

    useEffect(() => {
        if (!target) return undefined;
        const id = window.setTimeout(() => {
            document.querySelector<HTMLElement>('[data-tv-library-options="1"] [data-tv-menu-item="1"]')?.focus({ preventScroll: true });
        }, 30);
        const onClose = () => close();
        window.addEventListener('smp-tv-overlay-close', onClose);
        window.addEventListener('smp-tv-menu-close', onClose);
        return () => {
            window.clearTimeout(id);
            window.removeEventListener('smp-tv-overlay-close', onClose);
            window.removeEventListener('smp-tv-menu-close', onClose);
        };
    }, [target, close]);

    const run = (refresh: boolean) => {
        if (!target) return;
        const { libraryId, title } = target;
        close();
        const name = title || t('mediaPlayerPage.libraryOptionsThis');
        void scanMediaPlayerLibrary(libraryId, { refresh })
            .then((started) => {
                if (!started) {
                    onToast(t('mediaPlayerPage.libraryScanRunning').replace('{name}', name), 'info');
                    return;
                }
                onToast(
                    t(refresh ? 'mediaPlayerPage.libraryRefreshStarted' : 'mediaPlayerPage.libraryScanStarted').replace('{name}', name),
                    'success',
                );
            })
            .catch((error: unknown) => {
                const message = error instanceof Error && error.message ? error.message : '';
                onToast(message || t('mediaPlayerPage.libraryScanFailed'), 'error');
            });
    };

    if (!target || typeof document === 'undefined') return null;
    const rowClass = 'flex w-full items-center gap-3 px-3.5 py-3 text-left text-[1.02rem] font-semibold tracking-tight text-white/90 outline-none';
    return createPortal(
        <div
            className="fixed inset-0 z-[3500] flex justify-end bg-black/35"
            data-tv-context-backdrop="1"
            onClick={(event) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <div
                role="menu"
                aria-label={t('mediaPlayerPage.libraryOptions')}
                data-tv-item-menu="1"
                data-tv-context-sheet="1"
                data-tv-library-options="1"
                className="player-context-sheet flex max-h-full w-[min(30rem,48vw)] min-w-[22rem] flex-col overflow-hidden outline-none"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="shrink-0 px-1 pb-3 pt-1">
                    <h2 className="truncate text-[1.35rem] font-bold leading-tight tracking-tight text-white">
                        {target.title || t('mediaPlayerPage.libraryOptions')}
                    </h2>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain hide-scrollbar" data-tv-overlay-scroll="1" data-tv-rail="1">
                    <TvButton
                        type="button"
                        role="menuitem"
                        className={rowClass}
                        data-tv-item="1"
                        data-tv-menu-item="1"
                        data-tv-action="1"
                        onClick={() => run(false)}
                    >
                        <FolderSearch className="h-5 w-5 shrink-0" aria-hidden />
                        <span className="truncate">{t('mediaPlayerPage.libraryScanFiles')}</span>
                    </TvButton>
                    <TvButton
                        type="button"
                        role="menuitem"
                        className={rowClass}
                        data-tv-item="1"
                        data-tv-menu-item="1"
                        data-tv-action="1"
                        onClick={() => run(true)}
                    >
                        <RefreshCw className="h-5 w-5 shrink-0" aria-hidden />
                        <span className="truncate">{t('mediaPlayerPage.libraryRefreshMeta')}</span>
                    </TvButton>
                </div>
            </div>
        </div>,
        document.body,
    );
};
