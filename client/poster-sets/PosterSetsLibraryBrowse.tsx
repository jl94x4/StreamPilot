import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { CustomSelect } from '../shared/ui';
import {
    upgraderPosterGridClass,
    type PosterGridValue,
} from '../shared/portalLayout';
import { posterSetsApi } from './api';
import { LibraryMediaCard } from './shared/posterSetsCards';
import { PosterSetsGridSizeSlider } from './shared/PosterSetsGridSizeSlider';
import { posterSetsPosterGridStyle } from './shared/posterSetsUi';
import { useTpdbCoverageMap } from './shared/useTpdbCoverageMap';
import {
    normalizeLibraryItems,
    type LibraryBrowseSort,
    type LibraryCacheStatus,
    type LibraryRecentItem,
    type LibrarySection,
} from './libraryRecent';
import { libraryItemIsWatching, type PosterSetsWatchingIndex } from './watchingIndex';

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';

const BROWSE_PAGE_SIZE = 60;
const SORT_OPTIONS = [
    { value: 'titleAsc', label: 'Title A–Z' },
    { value: 'titleDesc', label: 'Title Z–A' },
    { value: 'yearDesc', label: 'Year (newest)' },
    { value: 'yearAsc', label: 'Year (oldest)' },
    { value: 'addedDesc', label: 'Recently added' },
    { value: 'addedAsc', label: 'Oldest added' },
    { value: 'cachedFirst', label: 'Cached first' },
];

const CACHE_STATUS_OPTIONS = [
    { value: 'all', label: 'All titles' },
    { value: 'cached', label: 'Cached' },
    { value: 'uncached', label: 'Not cached' },
];

export type PosterSetsLibraryBrowseProps = {
    disabled?: boolean;
    gridSize: PosterGridValue;
    onGridSizeChange: (size: number) => void;
    onOpenItem: (item: LibraryRecentItem) => void;
    showTpdbCoverage?: boolean;
    showCopyTitle?: boolean;
    watchingIndex?: PosterSetsWatchingIndex | null;
};

export function PosterSetsLibraryBrowse({
    disabled,
    gridSize,
    onGridSizeChange,
    onOpenItem,
    showTpdbCoverage = true,
    showCopyTitle = false,
    watchingIndex = null,
}: PosterSetsLibraryBrowseProps) {
    const [sections, setSections] = useState<LibrarySection[]>([]);
    const [sectionKey, setSectionKey] = useState('');
    const [mediaType, setMediaType] = useState<'movie' | 'show' | ''>('');
    const [sort, setSort] = useState<LibraryBrowseSort>('titleAsc');
    const [cacheStatus, setCacheStatus] = useState<LibraryCacheStatus>('all');
    const [page, setPage] = useState(0);
    const [items, setItems] = useState<LibraryRecentItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [sectionsLoading, setSectionsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const loadGenRef = useRef(0);

    const posterGridClass = upgraderPosterGridClass(gridSize);
    const posterGridStyle = posterSetsPosterGridStyle(gridSize);
    const { levelFor } = useTpdbCoverageMap(items, items.length > 0 && showTpdbCoverage);

    useEffect(() => {
        let cancelled = false;
        setSectionsLoading(true);
        void posterSetsApi.librarySections()
            .then((response) => {
                if (cancelled) return;
                const next = (response.sections || [])
                    .map((section) => ({
                        key: String(section.key || ''),
                        title: String(section.title || ''),
                        type: section.type === 'show' ? 'show' as const : 'movie' as const,
                        count: Number(section.count) || 0,
                    }))
                    .filter((section) => section.key && section.title);
                setSections(next);
                if (next.length && !sectionKey) {
                    setSectionKey(next[0].key);
                }
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load library sections');
            })
            .finally(() => {
                if (!cancelled) setSectionsLoading(false);
            });
        return () => { cancelled = true; };
    }, []);

    const loadBrowse = useCallback(async () => {
        const generation = ++loadGenRef.current;
        setLoading(true);
        setError(null);
        try {
            const response = await posterSetsApi.libraryBrowse({
                section: sectionKey || undefined,
                type: mediaType || undefined,
                sort,
                cacheStatus,
                start: page * BROWSE_PAGE_SIZE,
                limit: BROWSE_PAGE_SIZE,
            });
            if (generation !== loadGenRef.current) return;
            setItems(normalizeLibraryItems(response.items || []));
            setTotal(Number(response.total) || 0);
        } catch (err) {
            if (generation !== loadGenRef.current) return;
            setError(err instanceof Error ? err.message : 'Failed to browse library');
            setItems([]);
            setTotal(0);
        } finally {
            if (generation === loadGenRef.current) setLoading(false);
        }
    }, [sectionKey, mediaType, sort, cacheStatus, page]);

    useEffect(() => {
        if (sectionsLoading) return;
        void loadBrowse();
    }, [loadBrowse, sectionsLoading]);

    const pageCount = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
    const sectionOptions = useMemo(() => sections.map((section) => ({
        value: section.key,
        label: `${section.title} (${section.count || 0})`,
    })), [sections]);

    return (
        <div className="space-y-4">
            <div className="flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CustomSelect
                        value={sectionKey}
                        onChange={(value) => {
                            setSectionKey(value);
                            setPage(0);
                        }}
                        options={sectionOptions.length ? sectionOptions : [{ value: '', label: 'No libraries' }]}
                        className="min-w-0 flex-1 basis-[10rem] sm:max-w-[14rem] sm:flex-none"
                        compact
                        disabled={sectionsLoading || !sectionOptions.length}
                    />
                    <div className="inline-flex shrink-0 rounded-xl border border-white/10 bg-black/20 p-0.5">
                        {([
                            ['', 'All'],
                            ['movie', 'Movies'],
                            ['show', 'TV'],
                        ] as const).map(([id, label]) => (
                            <button
                                key={id || 'all'}
                                type="button"
                                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition sm:px-3 sm:py-1.5 sm:text-sm ${
                                    mediaType === id ? 'bg-plex text-background' : 'text-muted hover:text-text'
                                }`}
                                onClick={() => {
                                    setMediaType(id);
                                    setPage(0);
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CustomSelect
                        value={cacheStatus}
                        onChange={(value) => {
                            setCacheStatus((value === 'cached' || value === 'uncached' ? value : 'all') as LibraryCacheStatus);
                            setPage(0);
                        }}
                        options={CACHE_STATUS_OPTIONS}
                        className="min-w-0 flex-1 basis-[8rem] sm:flex-none sm:w-[9.5rem]"
                        compact
                    />
                    <CustomSelect
                        value={sort}
                        onChange={(value) => {
                            setSort(value as LibraryBrowseSort);
                            setPage(0);
                        }}
                        options={SORT_OPTIONS}
                        className="min-w-0 flex-1 basis-[8rem] sm:flex-none sm:w-[10.5rem]"
                        compact
                    />
                    <PosterSetsGridSizeSlider
                        value={gridSize}
                        onChange={onGridSizeChange}
                        className="min-w-0 flex-1 basis-[8rem] sm:flex-none sm:w-[10.5rem]"
                    />
                    <button
                        type="button"
                        className={`${buttonClass} shrink-0`}
                        disabled={loading || disabled}
                        title="Refresh browse results"
                        onClick={() => void loadBrowse()}
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </div>
            </div>

            {error ? <p className="text-center text-xs text-amber-200">{error}</p> : null}

            {loading && !items.length ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading library…
                </div>
            ) : null}

            {!loading && !items.length && !sectionsLoading ? (
                <p className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted">
                    No titles found for this library section and filter.
                </p>
            ) : null}

            {items.length ? (
                <>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                        <h3 className="text-sm font-bold text-text">Browse library</h3>
                        <span className="text-[11px] text-muted">
                            {loading
                                ? 'Updating…'
                                : (total
                                    ? `${page * BROWSE_PAGE_SIZE + 1}–${Math.min(total, (page + 1) * BROWSE_PAGE_SIZE)} of ${total}`
                                    : `${items.length} titles`)}
                        </span>
                    </div>
                    <div className="relative">
                        <div className={`${posterGridClass} ${loading ? 'pointer-events-none opacity-40' : ''}`} style={posterGridStyle}>
                            {items.map((item) => (
                                <LibraryMediaCard
                                    key={`browse-${item.mediaType}-${item.id}`}
                                    item={item}
                                    disabled={disabled}
                                    onOpen={onOpenItem}
                                    cacheLevel={levelFor(item)}
                                    showCopyTitle={showCopyTitle}
                                    watching={libraryItemIsWatching(item, watchingIndex)}
                                />
                            ))}
                        </div>
                        {loading ? (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-sm text-text shadow-lg">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Updating filters…
                                </div>
                            </div>
                        ) : null}
                    </div>
                    {pageCount > 1 ? (
                        <div className="flex items-center justify-center gap-2 pt-1">
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={page <= 0 || loading}
                                onClick={() => setPage((current) => Math.max(0, current - 1))}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Prev
                            </button>
                            <span className="text-xs text-muted">Page {page + 1} / {pageCount}</span>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={page + 1 >= pageCount || loading}
                                onClick={() => setPage((current) => current + 1)}
                            >
                                Next
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
