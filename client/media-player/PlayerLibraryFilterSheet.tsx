import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { TvButton } from '../shared/TvButton';

export type LibraryFilterGroup = {
    id: string;
    label: string;
    /** "All genres" etc. — the empty value. */
    allLabel: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
};

export type LibraryFilterToggle = {
    id: string;
    label: string;
    on: boolean;
    onToggle: () => void;
};

type Props = {
    groups: LibraryFilterGroup[];
    toggles: LibraryFilterToggle[];
    onClearAll: () => void;
};

const rowClass = 'flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-[1.02rem] font-semibold tracking-tight outline-none';

/**
 * TV Browse filters, Plex style: one Filters button (plus a chip per active filter) instead of a
 * long row of dropdowns. The sheet lists every filter; picking one shows its values.
 */
export const PlayerLibraryFilterSheet: React.FC<Props> = ({ groups, toggles, onClearAll }) => {
    const { t } = useDiscoverI18n();
    const [open, setOpen] = useState(false);
    const [groupId, setGroupId] = useState<string | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const returnGroupRef = useRef<string | null>(null);
    const group = groupId ? groups.find((row) => row.id === groupId) || null : null;

    const activeGroups = groups.filter((row) => row.value);
    const activeToggles = toggles.filter((row) => row.on);
    const activeCount = activeGroups.length + activeToggles.length;

    const close = useCallback(() => {
        setOpen(false);
        setGroupId(null);
        try {
            delete document.documentElement.dataset.tvMenuOpen;
        } catch {
            /* ignore */
        }
        // Portal unmount drops focus to body; put it back on the Filters button.
        window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }, []);

    const openSheet = useCallback(() => {
        setGroupId(null);
        returnGroupRef.current = null;
        setOpen(true);
        try {
            document.documentElement.dataset.tvMenuOpen = '1';
        } catch {
            /* ignore */
        }
    }, []);

    const backToList = useCallback(() => {
        returnGroupRef.current = groupId;
        setGroupId(null);
    }, [groupId]);

    // Focus: the chosen value inside a filter, else the filter we came back from, else the top.
    useEffect(() => {
        if (!open) return undefined;
        const id = window.setTimeout(() => {
            const sheet = sheetRef.current;
            if (!sheet) return;
            const back = returnGroupRef.current;
            const target = sheet.querySelector<HTMLElement>('[data-tv-settings-primary="1"]')
                || (back ? sheet.querySelector<HTMLElement>(`[data-filter-group="${back}"]`) : null)
                || sheet.querySelector<HTMLElement>('[data-tv-item="1"]');
            target?.focus({ preventScroll: false });
            if (!group && !back) {
                const scroller = sheet.querySelector<HTMLElement>('[data-tv-overlay-scroll="1"]');
                if (scroller) scroller.scrollTop = 0;
            }
        }, 30);
        // Back inside a filter returns to the list; Back on the list closes.
        const onBack = () => {
            if (groupId) backToList();
            else close();
        };
        window.addEventListener('smp-tv-overlay-close', onBack);
        return () => {
            window.clearTimeout(id);
            window.removeEventListener('smp-tv-overlay-close', onBack);
        };
    }, [open, groupId, group, backToList, close]);

    const valueLabel = (row: LibraryFilterGroup) => (
        row.value ? row.options.find((opt) => opt.value === row.value)?.label || row.value : row.allLabel
    );

    return (
        <>
            <TvButton
                ref={triggerRef}
                type="button"
                data-tv-item="1"
                data-tv-action="1"
                data-tv-key="library-filters"
                onClick={openSheet}
                className={`player-library-filter-button inline-flex items-center gap-2 rounded-full border ${
                    activeCount ? 'is-active' : ''
                }`}
            >
                <SlidersHorizontal className="h-[1.1em] w-[1.1em]" strokeWidth={2.25} aria-hidden />
                <span>{t('mediaPlayerPage.filters')}</span>
                {activeCount ? <span className="player-library-filter-count">{activeCount}</span> : null}
            </TvButton>
            {activeGroups.map((row) => (
                <TvButton
                    key={`chip-${row.id}`}
                    type="button"
                    data-tv-item="1"
                    data-tv-action="1"
                    data-tv-key={`library-chip-${row.id}`}
                    onClick={() => row.onChange('')}
                    className="player-library-filter-chip inline-flex items-center gap-2 rounded-full border"
                    aria-label={`${t('common.remove')} ${row.label}: ${valueLabel(row)}`}
                >
                    <span>{valueLabel(row)}</span>
                    <X className="h-[0.95em] w-[0.95em]" strokeWidth={2.5} aria-hidden />
                </TvButton>
            ))}
            {activeToggles.map((row) => (
                <TvButton
                    key={`chip-${row.id}`}
                    type="button"
                    data-tv-item="1"
                    data-tv-action="1"
                    data-tv-key={`library-chip-${row.id}`}
                    onClick={row.onToggle}
                    className="player-library-filter-chip inline-flex items-center gap-2 rounded-full border"
                    aria-label={`${t('common.remove')} ${row.label}`}
                >
                    <span>{row.label}</span>
                    <X className="h-[0.95em] w-[0.95em]" strokeWidth={2.5} aria-hidden />
                </TvButton>
            ))}
            {open && typeof document !== 'undefined' ? createPortal(
                <div
                    className="fixed inset-0 z-[3500] flex justify-end bg-black/35"
                    data-tv-context-backdrop="1"
                    data-tv-settings-dialog="1"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) close();
                    }}
                >
                    <div
                        ref={sheetRef}
                        role="menu"
                        aria-label={group ? group.label : t('mediaPlayerPage.filters')}
                        data-tv-item-menu="1"
                        data-tv-context-sheet="1"
                        className="player-context-sheet flex max-h-full w-[min(30rem,48vw)] min-w-[22rem] flex-col overflow-hidden outline-none"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex shrink-0 items-center gap-2 px-1 pb-3 pt-1">
                            {group ? <ChevronLeft className="h-6 w-6 shrink-0 text-white/50" aria-hidden /> : null}
                            <h2 className="truncate text-[1.35rem] font-bold leading-tight tracking-tight text-white">
                                {group ? group.label : t('mediaPlayerPage.filters')}
                            </h2>
                        </div>
                        <div
                            className="min-h-0 flex-1 overflow-y-auto overscroll-contain hide-scrollbar"
                            data-tv-overlay-scroll="1"
                        >
                            {group ? (
                                [{ value: '', label: group.allLabel }, ...group.options].map((opt) => {
                                    const isSelected = opt.value === group.value;
                                    return (
                                        <TvButton
                                            key={opt.value || '__all'}
                                            type="button"
                                            role="menuitemradio"
                                            className={`${rowClass} ${isSelected ? 'text-white' : 'text-white/90'}`}
                                            data-tv-item="1"
                                            data-tv-menu-item="1"
                                            data-tv-action="1"
                                            data-tv-settings-primary={isSelected ? '1' : undefined}
                                            aria-checked={isSelected}
                                            onClick={() => {
                                                group.onChange(opt.value);
                                                backToList();
                                            }}
                                        >
                                            <span className="min-w-0 truncate">{opt.label}</span>
                                            {isSelected ? (
                                                <Check className="h-5 w-5 shrink-0" strokeWidth={2.75} aria-hidden />
                                            ) : (
                                                <span className="h-5 w-5 shrink-0" aria-hidden />
                                            )}
                                        </TvButton>
                                    );
                                })
                            ) : (
                                <>
                                    {activeCount ? (
                                        <TvButton
                                            type="button"
                                            role="menuitem"
                                            className={`${rowClass} text-white/90`}
                                            data-tv-item="1"
                                            data-tv-menu-item="1"
                                            data-tv-action="1"
                                            onClick={() => {
                                                onClearAll();
                                                close();
                                            }}
                                        >
                                            <span className="min-w-0 truncate">{t('mediaPlayerPage.clearFilters')}</span>
                                            <X className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden />
                                        </TvButton>
                                    ) : null}
                                    {toggles.map((row) => (
                                        <TvButton
                                            key={row.id}
                                            type="button"
                                            role="menuitemcheckbox"
                                            className={`${rowClass} ${row.on ? 'text-white' : 'text-white/90'}`}
                                            data-tv-item="1"
                                            data-tv-menu-item="1"
                                            data-tv-action="1"
                                            data-filter-group={row.id}
                                            aria-checked={row.on}
                                            onClick={row.onToggle}
                                        >
                                            <span className="min-w-0 truncate">{row.label}</span>
                                            {row.on ? (
                                                <Check className="h-5 w-5 shrink-0" strokeWidth={2.75} aria-hidden />
                                            ) : (
                                                <span className="h-5 w-5 shrink-0" aria-hidden />
                                            )}
                                        </TvButton>
                                    ))}
                                    {groups.map((row) => (
                                        <TvButton
                                            key={row.id}
                                            type="button"
                                            role="menuitem"
                                            className={`${rowClass} text-white/90`}
                                            data-tv-item="1"
                                            data-tv-menu-item="1"
                                            data-tv-action="1"
                                            data-filter-group={row.id}
                                            onClick={() => {
                                                returnGroupRef.current = null;
                                                setGroupId(row.id);
                                            }}
                                        >
                                            <span className="min-w-0 truncate">{row.label}</span>
                                            <span className={`inline-flex min-w-0 shrink items-center gap-1.5 truncate text-[0.95rem] ${
                                                row.value ? 'text-white' : 'text-white/45'
                                            }`}
                                            >
                                                <span className="truncate">{valueLabel(row)}</span>
                                                <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                                            </span>
                                        </TvButton>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            ) : null}
        </>
    );
};
