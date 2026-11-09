import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowDownUp, ArrowUp, Check, ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
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

export type LibrarySortControl = {
    /** The selected option's value (its base sort, without a direction). */
    value: string;
    descending: boolean;
    options: Array<{ value: string; label: string }>;
    /** Picking the selected option again flips ascending / descending. */
    onChange: (value: string) => void;
};

type Props = {
    groups: LibraryFilterGroup[];
    toggles: LibraryFilterToggle[];
    onClearAll: () => void;
    /** TV: Sort lives in the same sheet (its own button opens straight onto the list). */
    sort?: LibrarySortControl;
    /**
     * Active filters as removable chips (touch). Off on TV: every chip was another stop in the
     * toolbar and Right from the last one fell out into the letter bar. TV lists them as text and
     * they are changed or cleared in the sheet.
     */
    chips?: boolean;
};

const SORT_VIEW = '__sort';

const rowClass = 'flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-[1.02rem] font-semibold tracking-tight outline-none';

/**
 * Browse sort and filters, Plex style: a Sort button and a Filters button open one side sheet.
 * The sheet lists Sort by, the on / off filters and every filter group; picking a group shows
 * its values, and picking a value comes back to the list so several can be set in one go.
 */
export const PlayerLibraryFilterSheet: React.FC<Props> = ({ groups, toggles, onClearAll, sort, chips = true }) => {
    const { t } = useDiscoverI18n();
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<string | null>(null);
    const filtersRef = useRef<HTMLElement | null>(null);
    const sortRef = useRef<HTMLElement | null>(null);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const returnViewRef = useRef<string | null>(null);
    /** Opened from the Sort button: picking a sort closes the sheet instead of going back. */
    const sortOnlyRef = useRef(false);
    const triggerRef = useRef<'sort' | 'filters'>('filters');
    const group = view && view !== SORT_VIEW ? groups.find((row) => row.id === view) || null : null;
    const sortView = view === SORT_VIEW && !!sort;

    const activeGroups = groups.filter((row) => row.value);
    const activeToggles = toggles.filter((row) => row.on);
    const activeCount = activeGroups.length + activeToggles.length;
    const sortLabel = sort ? (sort.options.find((opt) => opt.value === sort.value)?.label || sort.value) : '';

    const close = useCallback(() => {
        setOpen(false);
        setView(null);
        sortOnlyRef.current = false;
        try {
            delete document.documentElement.dataset.tvMenuOpen;
        } catch {
            /* ignore */
        }
        // Portal unmount drops focus to body; put it back on the button that opened the sheet.
        const back = triggerRef.current === 'sort' ? sortRef.current : filtersRef.current;
        window.requestAnimationFrame(() => (back || filtersRef.current)?.focus({ preventScroll: true }));
    }, []);

    const openSheet = useCallback((startView: string | null, from: 'sort' | 'filters') => {
        triggerRef.current = from;
        sortOnlyRef.current = startView === SORT_VIEW;
        returnViewRef.current = null;
        setView(startView);
        setOpen(true);
        try {
            document.documentElement.dataset.tvMenuOpen = '1';
        } catch {
            /* ignore */
        }
    }, []);

    const backToList = useCallback(() => {
        returnViewRef.current = view;
        setView(null);
    }, [view]);

    // Focus: the chosen value inside a list, else the row we came back from, else the top.
    useEffect(() => {
        if (!open) return undefined;
        const id = window.setTimeout(() => {
            const sheet = sheetRef.current;
            if (!sheet) return;
            const back = returnViewRef.current;
            const target = sheet.querySelector<HTMLElement>('[data-tv-settings-primary="1"]')
                || (back ? sheet.querySelector<HTMLElement>(`[data-filter-group="${back}"]`) : null)
                || sheet.querySelector<HTMLElement>('[data-tv-item="1"]');
            target?.focus({ preventScroll: false });
            if (!view && !back) {
                const scroller = sheet.querySelector<HTMLElement>('[data-tv-overlay-scroll="1"]');
                if (scroller) scroller.scrollTop = 0;
            }
        }, 30);
        // Back inside a list returns to the main list; Back on the main list (or a Sort-only
        // sheet) closes.
        const onBack = () => {
            if (view && !(view === SORT_VIEW && sortOnlyRef.current)) backToList();
            else close();
        };
        window.addEventListener('smp-tv-overlay-close', onBack);
        return () => {
            window.clearTimeout(id);
            window.removeEventListener('smp-tv-overlay-close', onBack);
        };
    }, [open, view, backToList, close]);

    const valueLabel = (row: LibraryFilterGroup) => (
        row.value ? row.options.find((opt) => opt.value === row.value)?.label || row.value : row.allLabel
    );

    const check = (on: boolean) => (on
        ? <Check className="h-5 w-5 shrink-0" strokeWidth={2.75} aria-hidden />
        : <span className="h-5 w-5 shrink-0" aria-hidden />);

    const summary = [
        ...activeToggles.map((row) => row.label),
        ...activeGroups.map((row) => valueLabel(row)),
    ].join(' · ');

    const choiceList = (
        options: Array<{ value: string; label: string }>,
        current: string,
        onPick: (value: string) => void,
        /** Sort list: the selected row shows its direction instead of a tick. */
        direction?: 'asc' | 'desc',
    ) => options.map((opt) => {
        const isSelected = opt.value === current;
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
                onClick={() => onPick(opt.value)}
            >
                <span className="min-w-0 truncate">{opt.label}</span>
                {isSelected && direction
                    ? (direction === 'desc'
                        ? <ArrowDown className="h-5 w-5 shrink-0" strokeWidth={2.75} aria-hidden />
                        : <ArrowUp className="h-5 w-5 shrink-0" strokeWidth={2.75} aria-hidden />)
                    : check(isSelected)}
            </TvButton>
        );
    });

    const heading = sortView
        ? t('mediaPlayerPage.sortBy')
        : group ? group.label : t('mediaPlayerPage.filters');

    return (
        <>
            {sort ? (
                <TvButton
                    ref={sortRef}
                    type="button"
                    data-tv-item="1"
                    data-tv-action="1"
                    data-tv-key="library-sort"
                    onClick={() => openSheet(SORT_VIEW, 'sort')}
                    className="player-library-filter-button player-library-sort-button inline-flex items-center gap-2 rounded-full border"
                    aria-label={`${t('mediaPlayerPage.sortBy')}: ${sortLabel}`}
                >
                    {sort.descending
                        ? <ArrowDown className="h-[1.05em] w-[1.05em]" strokeWidth={2.5} aria-hidden />
                        : <ArrowUp className="h-[1.05em] w-[1.05em]" strokeWidth={2.5} aria-hidden />}
                    <span>{sortLabel}</span>
                </TvButton>
            ) : null}
            <TvButton
                ref={filtersRef}
                type="button"
                data-tv-item="1"
                data-tv-action="1"
                data-tv-key="library-filters"
                onClick={() => openSheet(null, 'filters')}
                className={`player-library-filter-button inline-flex items-center gap-2 rounded-full border ${
                    activeCount ? 'is-active' : ''
                }`}
            >
                <SlidersHorizontal className="h-[1.1em] w-[1.1em]" strokeWidth={2.25} aria-hidden />
                <span>{t('mediaPlayerPage.filters')}</span>
                {activeCount ? <span className="player-library-filter-count">{activeCount}</span> : null}
            </TvButton>
            {chips ? (
                <>
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
                </>
            ) : summary ? (
                <span className="player-library-filter-summary min-w-0 truncate">{summary}</span>
            ) : null}
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
                        aria-label={heading}
                        data-tv-item-menu="1"
                        data-tv-context-sheet="1"
                        className="player-context-sheet flex max-h-full w-[min(30rem,48vw)] min-w-[22rem] flex-col overflow-hidden outline-none"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex shrink-0 items-center gap-2 px-1 pb-3 pt-1">
                            {view && !(sortView && sortOnlyRef.current)
                                ? <ChevronLeft className="h-6 w-6 shrink-0 text-white/50" aria-hidden />
                                : null}
                            <h2 className="truncate text-[1.35rem] font-bold leading-tight tracking-tight text-white">
                                {heading}
                            </h2>
                        </div>
                        <div
                            className="min-h-0 flex-1 overflow-y-auto overscroll-contain hide-scrollbar"
                            data-tv-overlay-scroll="1"
                        >
                            {sortView && sort ? (
                                // Stays open: OK again on the chosen sort flips its direction, the
                                // grid updates behind the sheet, and Back closes it.
                                choiceList(sort.options, sort.value, (value) => sort.onChange(value), sort.descending ? 'desc' : 'asc')
                            ) : group ? (
                                choiceList(
                                    [{ value: '', label: group.allLabel }, ...group.options],
                                    group.value,
                                    (value) => {
                                        group.onChange(value);
                                        backToList();
                                    },
                                )
                            ) : (
                                <>
                                    {sort ? (
                                        <TvButton
                                            type="button"
                                            role="menuitem"
                                            className={`${rowClass} text-white/90`}
                                            data-tv-item="1"
                                            data-tv-menu-item="1"
                                            data-tv-action="1"
                                            data-filter-group={SORT_VIEW}
                                            onClick={() => {
                                                returnViewRef.current = null;
                                                sortOnlyRef.current = false;
                                                setView(SORT_VIEW);
                                            }}
                                        >
                                            <span className="min-w-0 truncate">{t('mediaPlayerPage.sortBy')}</span>
                                            <span className="inline-flex min-w-0 shrink items-center gap-1.5 truncate text-[0.95rem] text-white">
                                                <span className="truncate">{sortLabel}</span>
                                                <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                                            </span>
                                        </TvButton>
                                    ) : null}
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
                                            {check(row.on)}
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
                                                returnViewRef.current = null;
                                                setView(row.id);
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
