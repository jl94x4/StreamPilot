import { askConfirm, appAlert } from '../../shared/confirm';
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { api, collexionsImageUrl } from '../api';
import { PlexCollection } from '../types';
import {
    Image as ImageIcon,
    Pin,
    PinOff,
    Search,
    RefreshCw,
    Library,
    CheckCircle2,
    Info,
    ChevronDown,
    Check,
    ExternalLink,
    Square,
    CheckSquare,
    X,
    Trash2,
    AlertTriangle,
    Wrench,
} from 'lucide-react';
import { CustomSelect } from '../../shared/ui';
import { NoPosterPlaceholder } from '../../shared/NoPosterPlaceholder';
import { PosterGridSizeSlider } from '../../shared/PosterGridSizeSlider';
import {
    parsePosterGridValue,
    posterGridDensityBand,
    posterGridImageSize,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
    type PosterGridValue,
} from '../../shared/portalLayout';

const LEGACY_GRID_MAP: Record<string, string> = {
    sm: 'small',
    md: 'medium',
    lg: 'large',
};

const GALLERY_GRID_DEFAULT_VERSION = 2;

type StatusFilter = 'all' | 'pinned' | 'tracked' | 'missing_art';
type SortMode = 'title' | 'library';

const collKey = (c: { library: string; title: string; ratingKey?: string }) => (
    c.ratingKey ? `${c.library}\0${c.ratingKey}` : `${c.library}\0${c.title}`
);
const collId = (c: { library: string; title: string; ratingKey?: string }) => (
    c.ratingKey ? `${c.library}-${c.ratingKey}` : `${c.library}-${c.title}`
);

/** Collection art with Discover-style placeholder when missing or load fails. */
const GalleryCollectionArt: React.FC<{
    thumb?: string | null;
    title: string;
    imageSize: { width: number; height: number };
    compact?: boolean;
    imgClassName?: string;
    onClick?: () => void;
}> = ({ thumb, title, imageSize, compact = false, imgClassName = '', onClick }) => {
    const src = thumb ? collexionsImageUrl(thumb, imageSize) : '';
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    if (!src || failed) {
        return (
            <div className="w-full h-full" onClick={onClick} role={onClick ? 'button' : undefined}>
                <NoPosterPlaceholder compact={compact} />
            </div>
        );
    }

    return (
        <img
            src={src}
            alt={title}
            className={imgClassName || 'w-full h-full object-cover'}
            loading="lazy"
            decoding="async"
            onClick={onClick}
            onError={() => setFailed(true)}
        />
    );
};

const STATUS_FILTER_OPTIONS = [
    { value: 'all', label: 'All status' },
    { value: 'pinned', label: 'Pinned' },
    { value: 'tracked', label: 'Tracked' },
    { value: 'missing_art', label: 'Missing art' },
];

const SORT_OPTIONS = [
    { value: 'title', label: 'Sort: Title' },
    { value: 'library', label: 'Sort: Library' },
];

const Gallery: React.FC = () => {
    const [collections, setCollections] = useState<PlexCollection[]>([]);
    const [loading, setLoading] = useState(true);
    const [resolvingPins, setResolvingPins] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLibrary, setSelectedLibrary] = useState<string>('All');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [sortMode, setSortMode] = useState<SortMode>('title');
    const [gridSize, setGridSize] = useState<PosterGridValue>(9.5);
    const [pinningId, setPinningId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [fixingArtId, setFixingArtId] = useState<string | null>(null);
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkProgress, setBulkProgress] = useState<{ total: number; label: string } | null>(null);
    const [healthBusy, setHealthBusy] = useState(false);
    const [repairBusy, setRepairBusy] = useState(false);
    const [healthResult, setHealthResult] = useState<{
        scanned: number;
        deep?: boolean;
        suspects: Array<{ title: string; library: string; ratingKey?: string; smart?: boolean; issues: string[] }>;
        errors?: string[];
    } | null>(null);
    const resolveGenRef = useRef(0);

    useEffect(() => {
        const savedState = localStorage.getItem('collexions_gallery_state');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                if (state.searchQuery !== undefined) setSearchQuery(state.searchQuery);
                if (state.selectedLibrary !== undefined) setSelectedLibrary(state.selectedLibrary);
                if (state.statusFilter !== undefined) setStatusFilter(state.statusFilter);
                else if (state.showPinnedOnly) setStatusFilter('pinned');
                if (state.sortMode !== undefined) setSortMode(state.sortMode);
                if (Number(state.gridDefaultVersion) === GALLERY_GRID_DEFAULT_VERSION && state.gridSize !== undefined) {
                    const raw = String(state.gridSize);
                    setGridSize(parsePosterGridValue(LEGACY_GRID_MAP[raw] || raw, { allowList: true }));
                }
            } catch (e) {
                console.error('Failed to parse saved gallery state', e);
            }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('collexions_gallery_state', JSON.stringify({
            searchQuery,
            selectedLibrary,
            statusFilter,
            sortMode,
            gridSize,
            gridDefaultVersion: GALLERY_GRID_DEFAULT_VERSION,
        }));
    }, [searchQuery, selectedLibrary, statusFilter, sortMode, gridSize]);

    const libraries = useMemo(() => {
        const libs = ['All', ...new Set(collections.map(c => c.library))];
        return libs.sort();
    }, [collections]);

    const enrichPins = useCallback(async (list: PlexCollection[]) => {
        const needs = list.filter(c => c.pin_resolved === false);
        if (!needs.length) {
            setResolvingPins(false);
            return;
        }
        const gen = ++resolveGenRef.current;
        setResolvingPins(true);
        const chunkSize = 80;
        try {
            for (let i = 0; i < needs.length; i += chunkSize) {
                if (gen !== resolveGenRef.current) return;
                const chunk = needs.slice(i, i + chunkSize);
                const pins = await api.resolveCollectionPins(
                    chunk.map(c => ({ title: c.title, library: c.library })),
                );
                if (gen !== resolveGenRef.current) return;
                setCollections(prev => prev.map(c => {
                    const key = collKey(c);
                    if (!(key in pins)) return c;
                    return { ...c, is_pinned: !!pins[key], pin_resolved: true };
                }));
            }
        } catch (e) {
            console.error('Failed to resolve pin status', e);
            if (gen === resolveGenRef.current) {
                setCollections(prev => prev.map(c =>
                    c.pin_resolved === false ? { ...c, pin_resolved: true } : c,
                ));
            }
        } finally {
            if (gen === resolveGenRef.current) setResolvingPins(false);
        }
    }, []);

    const fetchCollections = useCallback(async (isManual = false) => {
        setLoading(true);
        setLoadError('');
        resolveGenRef.current += 1;
        setResolvingPins(false);
        try {
            const data = await api.getCollections(isManual, { light: true });
            const finalList = (Array.isArray(data) ? data : []).map(c => ({
                ...c,
                is_pinned: !!c.is_pinned,
                pin_resolved: typeof c.pin_resolved === 'boolean' ? c.pin_resolved : false,
            }));
            setCollections(finalList);
            setLoading(false);
            void enrichPins(finalList);
        } catch (e: any) {
            console.error('Failed to fetch collections', e);
            const raw = String(e?.message || '');
            const is524 = /\b524\b/.test(raw) || /origin took too long/i.test(raw);
            setLoadError(
                is524
                    ? 'Request timed out (HTTP 524) — the origin took too long. Retry; a cached list may appear after the first successful scan.'
                    : (raw || 'Failed to load collections from Plex.'),
            );
            setCollections([]);
            setLoading(false);
        }
    }, [enrichPins]);

    useEffect(() => {
        fetchCollections();
    }, [fetchCollections]);

    const handlePinToggle = async (coll: PlexCollection) => {
        const id = collId(coll);
        setPinningId(id);
        try {
            if (coll.is_pinned) {
                await api.unpinCollection(coll.title, coll.library);
                setCollections(prev => prev.map(c =>
                    collKey(c) === collKey(coll)
                        ? { ...c, is_pinned: false, pin_resolved: true, has_label: false }
                        : c,
                ));
            } else {
                await api.pinCollection(coll.title, coll.library);
                setCollections(prev => prev.map(c =>
                    collKey(c) === collKey(coll)
                        ? { ...c, is_pinned: true, pin_resolved: true, has_label: true }
                        : c,
                ));
            }
        } catch (e) {
            void appAlert('Action failed. Check Plex connection.');
        } finally {
            setPinningId(null);
        }
    };

    const handleDelete = async (coll: PlexCollection) => {
        const ok = await askConfirm(
            `Delete "${coll.title}" from Plex?\n\nThis permanently removes the collection from "${coll.library}" (titles stay in your library). Any Collexions auto-sync job for it will also be removed.`,
            { title: 'Delete collection?', confirmLabel: 'Delete', cancelLabel: 'Keep' },
        );
        if (!ok) return;
        const id = collId(coll);
        setDeletingId(id);
        try {
            await api.deleteCollection(coll.title, coll.library, coll.ratingKey);
            setCollections(prev => prev.filter(c => collKey(c) !== collKey(coll)));
            setSelectedKeys(prev => {
                const next = new Set(prev);
                next.delete(collKey(coll));
                return next;
            });
        } catch (e: any) {
            void appAlert(e?.message || 'Delete failed. Check Plex connection.');
        } finally {
            setDeletingId(null);
        }
    };

    const handleFixArt = async (coll: PlexCollection) => {
        const id = collId(coll);
        setFixingArtId(id);
        try {
            const res = await api.fixCollectionArt(coll.library, coll.title, true);
            if (!res.ok_count) {
                void appAlert('Could not find a poster source for this collection (need TMDB key or items with artwork).');
            }
            await fetchCollections(true);
        } catch (e: any) {
            const msg = String(e?.message || '');
            if (/504|timed out|timeout/i.test(msg)) {
                void appAlert('Poster refresh timed out. Try again — large collections can take a moment.');
            } else {
                void appAlert(msg || 'Failed to set collection art.');
            }
        } finally {
            setFixingArtId(null);
        }
    };

    const handleWebHealthScan = async () => {
        setHealthBusy(true);
        try {
            const lib = selectedLibrary !== 'All' ? selectedLibrary : undefined;
            const res = await api.scanCollectionWebHealth(lib);
            if (!res.success) {
                void appAlert(res.error || 'Scan failed.');
                return;
            }
            setHealthResult({
                scanned: Number(res.scanned || 0),
                deep: res.deep === true,
                suspects: Array.isArray(res.suspects) ? res.suspects : [],
                errors: res.errors,
            });
            if (!(res.suspects || []).length) {
                void appAlert(
                    `Scanned ${res.scanned || 0} collection(s) across Plex Web list endpoints — no bad types or posters found. `
                    + 'If Plex desktop still crashes on Movies → Collections, click Repair Plex tab here, '
                    + 'then check Plex Media Server.log for “unknown type: 99” if it still fails.',
                );
            }
        } catch (e: any) {
            void appAlert(e?.message || 'Scan failed.');
        } finally {
            setHealthBusy(false);
        }
    };

    const handleRepairCollectionsTab = async () => {
        const scope = selectedLibrary !== 'All' ? selectedLibrary : 'every managed library';
        const ok = await askConfirm(
            `Repair the Plex Collections tab for ${scope}?\n\nThis deletes folder (type 99) rows that make Plex show “Something went wrong” and fixes crash-prone smart filters. Random collections stay random — they use Kometa-style label smart collections that reshuffle on every view. Real library titles are not deleted.`,
            { title: 'Repair Plex Collections tab?', confirmLabel: 'Repair', cancelLabel: 'Cancel' },
        );
        if (!ok) return;
        setRepairBusy(true);
        try {
            const lib = selectedLibrary !== 'All' ? selectedLibrary : undefined;
            let res = await api.repairCollectionsWeb(lib);
            if (!res.success) {
                void appAlert(res.error || 'Repair failed.');
                return;
            }
            const deadline = Date.now() + 20 * 60 * 1000;
            while (res.running && Date.now() < deadline) {
                await new Promise((resolve) => window.setTimeout(resolve, 2000));
                res = await api.repairCollectionsWebStatus();
            }
            if (res.running) {
                void appAlert(
                    `Repair is still running (${res.phase || 'working'}). Reload Plex Web’s Collections tab in a minute — you do not need to click Repair again.`,
                );
                return;
            }
            if (res.error && !res.purged && !res.converted && !res.pruned) {
                void appAlert(res.error);
                return;
            }
            const extra = (res.errors || []).length ? `\n\nWarnings: ${res.errors?.join(' · ')}` : '';
            void appAlert(
                `Removed ${res.purged || 0} crashy folder row(s), `
                + `pruned ${res.pruned || 0} bad member(s), `
                + `and converted ${res.converted || 0} smart collection(s) `
                + `across ${res.scanned || 0} collection(s). `
                + 'Hard-reload Plex Web’s Collections tab (Ctrl+F5).'
                + extra,
            );
            await fetchCollections(true);
        } catch (e: any) {
            const msg = String(e?.message || '');
            if (/\b524\b/.test(msg) || /origin took too long/i.test(msg) || /timed out/i.test(msg)) {
                void appAlert(
                    'The repair is still running on the server (Cloudflare timed out waiting). '
                    + 'Wait a minute, reload Plex Web’s Collections tab, then refresh this gallery — do not click Repair again yet.',
                );
                return;
            }
            void appAlert(msg || 'Repair failed.');
        } finally {
            setRepairBusy(false);
        }
    };

    const handleHealthDelete = async (row: { title: string; library: string; ratingKey?: string }) => {
        await handleDelete({
            title: row.title,
            library: row.library,
            ratingKey: row.ratingKey,
        } as PlexCollection);
        setHealthResult((prev) => prev
            ? { ...prev, suspects: prev.suspects.filter((s) => !(s.library === row.library && s.title === row.title && (s.ratingKey || '') === (row.ratingKey || ''))) }
            : prev);
    };

    const toggleSelect = (coll: PlexCollection) => {
        const key = collKey(coll);
        setSelectedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const exitSelectMode = () => {
        setSelectMode(false);
        setSelectedKeys(new Set());
    };

    const filteredCollections = useMemo(() => {
        const q = searchQuery.toLowerCase();
        let list = collections.filter(c => {
            const matchSearch = c.title.toLowerCase().includes(q);
            const matchLib = selectedLibrary === 'All' || c.library === selectedLibrary;
            let matchStatus = true;
            if (statusFilter === 'pinned') matchStatus = c.is_pinned;
            else if (statusFilter === 'tracked') matchStatus = c.has_label && !c.is_pinned;
            else if (statusFilter === 'missing_art') matchStatus = !c.thumb;
            return matchSearch && matchLib && matchStatus;
        });
        list = [...list].sort((a, b) => {
            if (sortMode === 'library') {
                const libCmp = a.library.localeCompare(b.library);
                if (libCmp !== 0) return libCmp;
            }
            return a.title.localeCompare(b.title);
        });
        return list;
    }, [collections, searchQuery, selectedLibrary, statusFilter, sortMode]);

    const selectAllVisible = () => {
        setSelectedKeys(new Set(filteredCollections.map(collKey)));
    };

    const handleBulkFixArt = async () => {
        const items = collections.filter(c => selectedKeys.has(collKey(c)));
        if (!items.length) return;
        setBulkBusy(true);
        try {
            let okCount = 0;
            for (const coll of items) {
                try {
                    const res = await api.fixCollectionArt(coll.library, coll.title, true);
                    if (res.ok_count) okCount += 1;
                } catch {
                    /* continue */
                }
            }
            exitSelectMode();
            await fetchCollections(true);
            if (okCount < items.length) {
                void appAlert(`Set posters on ${okCount} of ${items.length}. Some need a TMDB key or items with artwork.`);
            }
        } catch (e: any) {
            void appAlert(e?.message || 'Bulk fix art failed.');
        } finally {
            setBulkBusy(false);
        }
    };

    const handleBulk = async (action: 'pin' | 'unpin' | 'delete') => {
        const items = collections
            .filter(c => selectedKeys.has(collKey(c)))
            .map(c => ({ title: c.title, library: c.library, ratingKey: c.ratingKey }));
        if (!items.length) return;
        if (action === 'delete') {
            const ok = await askConfirm(
                `Permanently delete ${items.length} collection${items.length === 1 ? '' : 's'} from Plex?\n\nTitles stay in your libraries. Matching Collexions auto-sync jobs will also be removed.`,
                { title: 'Delete collections?', confirmLabel: 'Delete', cancelLabel: 'Keep' },
            );
            if (!ok) return;
        }
        setBulkBusy(true);
        setBulkProgress({ total: items.length, label: action });
        try {
            const result = await api.bulkPinCollections(action, items);
            const okKeys = new Set(
                (result.results || [])
                    .filter(r => r.ok)
                    .map(r => collKey({ title: r.title, library: r.library })),
            );
            if (action === 'delete') {
                setCollections(prev => prev.filter(c => !okKeys.has(collKey(c))));
            } else {
                setCollections(prev => prev.map(c => {
                    if (!okKeys.has(collKey(c))) return c;
                    return {
                        ...c,
                        is_pinned: action === 'pin',
                        pin_resolved: true,
                        has_label: action === 'pin',
                    };
                }));
            }
            exitSelectMode();
            if (result.ok_count < items.length) {
                void appAlert(`${action === 'delete' ? 'Deleted' : 'Updated'} ${result.ok_count} of ${items.length}. Some actions failed.`);
            }
        } catch (e) {
            void appAlert('Bulk action failed. Check Plex connection.');
        } finally {
            setBulkBusy(false);
            setBulkProgress(null);
        }
    };

    const isCompact = posterGridDensityBand(gridSize) === 'small';
    const isList = gridSize === 'list';
    const imageSize = useMemo(() => posterGridImageSize(gridSize), [gridSize]);

    if (loading && collections.length === 0) {
        return (
            <div className="flex flex-col h-96 items-center justify-center text-muted animate-pulse">
                <ImageIcon className="w-12 h-12 mb-4 opacity-50" />
                <p>Scanning Plex Libraries...</p>
            </div>
        );
    }

    if (loadError && collections.length === 0) {
        return (
            <div className="flex flex-col h-96 items-center justify-center text-muted gap-3">
                <ImageIcon className="w-12 h-12 opacity-40" />
                <p className="text-sm text-red-300">{loadError}</p>
                <button
                    type="button"
                    onClick={() => fetchCollections(true)}
                    className="px-4 py-2 rounded-lg bg-plex text-background text-sm font-bold hover:bg-plex-hover transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight">Collection Gallery</h2>
                    <p className="text-muted mt-1 flex items-center gap-2 text-sm">
                        <Library className="w-4 h-4" />
                        Explore and manually pin collections to your Home Screen
                        {resolvingPins && (
                            <span className="inline-flex items-center gap-1.5 text-plex/80">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Updating pin status…
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void handleWebHealthScan()}
                        disabled={healthBusy || repairBusy}
                        className="px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-100 text-sm font-bold hover:bg-amber-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                        title="Probe each collection poster the same way Plex Web does when you scroll Collections"
                    >
                        {healthBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                        Find Plex crash
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleRepairCollectionsTab()}
                        disabled={healthBusy || repairBusy}
                        className="px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-100 text-sm font-bold hover:bg-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                        title="Delete type-99 folder rows that crash Plex Web’s Collections tab"
                    >
                        {repairBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                        Repair Plex tab
                    </button>
                    <button
                        type="button"
                        onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                        className={`px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${selectMode
                            ? 'bg-plex text-background border-plex'
                            : 'bg-card border-border text-muted hover:text-text'
                            }`}
                    >
                        {selectMode ? 'Cancel' : 'Select'}
                    </button>
                    <button
                        type="button"
                        onClick={() => fetchCollections(true)}
                        className="p-2 rounded-lg bg-card border border-border text-muted hover:text-text transition-colors"
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {healthResult ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <p className="text-sm font-bold text-amber-100">
                                Plex Web crash scan — {healthResult.scanned} collection(s)
                            </p>
                            <p className="text-[12px] text-muted mt-1">
                                Suspects are collections Plex Web cannot render (bad type, broken poster, or a corrupt page-2 list entry). The A–Z jumper in Plex still loads that broken page, so use this scan and delete/fix suspects here instead of Plex Web. Filter to your Movies library first for a faster scan.
                            </p>
                        </div>
                        <button
                            type="button"
                            className="text-xs font-bold text-muted hover:text-text"
                            onClick={() => setHealthResult(null)}
                        >
                            Dismiss
                        </button>
                    </div>
                    {healthResult.suspects.length === 0 ? (
                        <p className="text-sm text-emerald-200">
                            No broken collection rows or posters found (including paginated Plex Web list scans
                            {healthResult.deep ? ' and member checks' : ''}).
                            If Plex Web still crashes, the fault may be outside collections — check{' '}
                            <code className="text-emerald-100">Plex Media Server.log</code> for “unknown type: 99”,
                            run Clean Bundles + Optimize Database on the server, or browse collections here instead of Plex Web.
                        </p>
                    ) : (
                        <ul className="space-y-2 max-h-80 overflow-y-auto">
                            {healthResult.suspects.map((row) => (
                                <li
                                    key={`${row.library}-${row.ratingKey || row.title}`}
                                    className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-white/10 bg-black/30 p-3"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-text">
                                            {row.title}
                                            {row.smart ? <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-200">smart</span> : null}
                                        </p>
                                        <p className="text-[11px] text-muted">{row.library}{row.ratingKey ? ` · ${row.ratingKey}` : ''}</p>
                                        <ul className="mt-1 text-[12px] text-red-200 list-disc pl-4">
                                            {row.issues.map((issue) => <li key={issue}>{issue}</li>)}
                                        </ul>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <button
                                            type="button"
                                            className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-plex/15 text-plex border border-plex/30"
                                            onClick={() => void handleFixArt({
                                                title: row.title,
                                                library: row.library,
                                                ratingKey: row.ratingKey,
                                            } as PlexCollection)}
                                        >
                                            Fix poster
                                        </button>
                                        <button
                                            type="button"
                                            className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-red-600/20 text-red-300 border border-red-600/40"
                                            onClick={() => void handleHealthDelete(row)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                    {(healthResult.errors || []).length ? (
                        <p className="text-[11px] text-muted">{healthResult.errors?.join(' · ')}</p>
                    ) : null}
                </div>
            ) : null}

            {selectMode && (
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-card/60 border border-border">
                    <span className="text-sm text-muted mr-1">
                        {selectedKeys.size} selected
                    </span>
                    {bulkProgress ? (
                        <div className="w-full sm:w-auto sm:min-w-[220px] flex flex-col gap-1">
                            <span className="text-[11px] text-muted capitalize">
                                {bulkProgress.label}ing {bulkProgress.total} collection{bulkProgress.total === 1 ? '' : 's'}…
                            </span>
                            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div className="h-full w-full bg-plex animate-pulse rounded-full" />
                            </div>
                        </div>
                    ) : null}
                    <button
                        type="button"
                        onClick={selectAllVisible}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border text-muted hover:text-text"
                    >
                        Select visible ({filteredCollections.length})
                    </button>
                    <button
                        type="button"
                        disabled={bulkBusy || selectedKeys.size === 0}
                        onClick={() => handleBulk('pin')}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                        {bulkBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Pin className="w-3 h-3" />}
                        Pin selected
                    </button>
                    <button
                        type="button"
                        disabled={bulkBusy || selectedKeys.size === 0}
                        onClick={() => handleBulk('unpin')}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                        {bulkBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <PinOff className="w-3 h-3" />}
                        Unpin selected
                    </button>
                    <button
                        type="button"
                        disabled={bulkBusy || selectedKeys.size === 0}
                        onClick={() => handleBulk('delete')}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600/20 text-red-300 border border-red-600/40 hover:bg-red-600/30 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                        {bulkBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Delete selected
                    </button>
                    <button
                        type="button"
                        disabled={bulkBusy || selectedKeys.size === 0}
                        onClick={() => void handleBulkFixArt()}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-plex/15 text-plex border border-plex/30 hover:bg-plex/25 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                        {bulkBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                        Fix posters
                    </button>
                    <button
                        type="button"
                        onClick={exitSelectMode}
                        className="ml-auto p-1.5 rounded-lg text-muted hover:text-text"
                        title="Exit select mode"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            <div className="flex flex-col md:flex-row gap-4 flex-wrap">
                <div className="flex-1 relative min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input
                        type="text"
                        placeholder="Search collections..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-card/60 border border-border rounded-xl py-2.5 pl-10 pr-4 text-text focus:outline-none focus:border-plex transition-colors"
                    />
                </div>

                <div className="relative w-full md:w-52">
                    <button
                        type="button"
                        onClick={() => setIsLibraryOpen(!isLibraryOpen)}
                        className="w-full bg-card/60 border border-border rounded-xl py-2.5 pl-4 pr-10 text-text flex items-center justify-between focus:outline-none focus:border-plex transition-all hover:bg-white/5"
                    >
                        <div className="flex items-center gap-2 truncate">
                            <Library className="w-4 h-4 text-muted" />
                            <span className="truncate">{selectedLibrary}</span>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-muted transition-transform ${isLibraryOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isLibraryOpen && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setIsLibraryOpen(false)}
                            />
                            <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl overflow-hidden shadow-2xl z-20 animate-in fade-in slide-in-from-top-2 duration-200">
                                <div className="max-h-60 overflow-y-auto scrollbar-thin">
                                    {libraries.map(lib => (
                                        <button
                                            type="button"
                                            key={lib}
                                            onClick={() => {
                                                setSelectedLibrary(lib);
                                                setIsLibraryOpen(false);
                                            }}
                                            className={`w-full px-4 py-2.5 text-sm text-left flex items-center justify-between transition-colors hover:bg-white/5 ${selectedLibrary === lib ? 'text-plex bg-plex/5' : 'text-text'
                                                }`}
                                        >
                                            {lib}
                                            {selectedLibrary === lib && <Check className="w-4 h-4" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <CustomSelect
                    value={statusFilter}
                    onChange={(value) => setStatusFilter(value as StatusFilter)}
                    options={STATUS_FILTER_OPTIONS}
                    className="w-full md:w-40"
                    compact
                />

                <CustomSelect
                    value={sortMode}
                    onChange={(value) => setSortMode(value as SortMode)}
                    options={SORT_OPTIONS}
                    className="w-full md:w-40"
                    compact
                />

                <PosterGridSizeSlider
                    value={gridSize}
                    onChange={setGridSize}
                    allowList
                    className="w-full md:w-auto"
                />
            </div>

            <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                {filteredCollections.map((coll, idx) => {
                    const id = collId(coll);
                    const key = collKey(coll);
                    const uniqueKey = `${id}-${idx}`;
                    const isProcessing = pinningId === id || deletingId === id || fixingArtId === id;
                    const isDeleting = deletingId === id;
                    const isFixingArt = fixingArtId === id;
                    const isSelected = selectedKeys.has(key);
                    const pinPending = coll.pin_resolved === false;

                    if (isList) {
                        return (
                            <div
                                key={uniqueKey}
                                className={`group flex items-center gap-4 bg-card/50 border rounded-xl overflow-hidden hover:border-plex/40 transition-all p-3 ${isSelected ? 'border-plex ring-1 ring-plex/40' : 'border-border'}`}
                            >
                                {selectMode && (
                                    <button
                                        type="button"
                                        onClick={() => toggleSelect(coll)}
                                        className="shrink-0 text-plex"
                                        aria-label={isSelected ? 'Deselect' : 'Select'}
                                    >
                                        {isSelected
                                            ? <CheckSquare className="w-5 h-5" />
                                            : <Square className="w-5 h-5 text-muted" />}
                                    </button>
                                )}
                                <div className="w-14 h-[84px] shrink-0 rounded-lg overflow-hidden bg-card">
                                    <GalleryCollectionArt
                                        thumb={coll.thumb}
                                        title={coll.title}
                                        imageSize={imageSize}
                                        compact
                                        imgClassName="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {coll.plexUrl ? (
                                            <a
                                                href={coll.plexUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-bold text-text truncate hover:text-plex transition-colors"
                                                title={coll.title}
                                            >
                                                {coll.title}
                                            </a>
                                        ) : (
                                            <h3 className="font-bold text-text truncate group-hover:text-plex transition-colors" title={coll.title}>
                                                {coll.title}
                                            </h3>
                                        )}
                                        {pinPending ? (
                                            <span className="text-[10px] font-bold uppercase bg-white/5 text-muted px-1.5 py-0.5 rounded">…</span>
                                        ) : null}
                                        {coll.has_label && !coll.is_pinned && !pinPending && (
                                            <span className="text-[10px] font-bold uppercase bg-white/10 text-muted px-1.5 py-0.5 rounded">Tracked</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted uppercase mt-0.5">{coll.library}</p>
                                </div>
                                {!selectMode && (
                                    <div className="flex items-center gap-2 shrink-0">
                                        {coll.plexUrl && (
                                            <a
                                                href={coll.plexUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="rounded-lg border border-border bg-card/60 text-muted hover:text-plex hover:border-plex/40 p-2 transition-colors"
                                                title="Open in Plex"
                                            >
                                                <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handlePinToggle(coll)}
                                            disabled={isProcessing || pinPending}
                                            className={`rounded-lg font-bold flex items-center justify-center gap-2 transition-all border px-3 py-2 text-xs ${coll.is_pinned
                                                ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                                } disabled:opacity-50`}
                                        >
                                            {isProcessing && !isDeleting ? (
                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                            ) : coll.is_pinned ? (
                                                <>
                                                    <PinOff className="w-3 h-3" />
                                                    Unpin
                                                </>
                                            ) : (
                                                <>
                                                    <Pin className="w-3 h-3" />
                                                    Pin
                                                </>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(coll)}
                                            disabled={isProcessing}
                                            className="rounded-lg border border-border bg-card/60 text-red-400 hover:text-red-300 hover:border-red-500/40 p-2 transition-colors disabled:opacity-50"
                                            title="Delete collection from Plex"
                                        >
                                            {isDeleting
                                                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                : <Trash2 className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    }

                    return (
                        <div
                            key={uniqueKey}
                            className={`group relative flex h-full min-w-0 flex-col bg-card/50 border overflow-hidden hover:border-plex/40 transition-all hover:shadow-2xl hover:shadow-black/50 ${isCompact ? 'rounded-xl' : 'rounded-2xl'} ${isSelected ? 'border-plex ring-1 ring-plex/40' : 'border-border'}`}
                        >
                            {selectMode && (
                                <button
                                    type="button"
                                    onClick={() => toggleSelect(coll)}
                                    className="absolute top-2 left-2 z-10 bg-black/70 rounded p-1 text-white"
                                    aria-label={isSelected ? 'Deselect' : 'Select'}
                                >
                                    {isSelected
                                        ? <CheckSquare className="w-4 h-4 text-plex" />
                                        : <Square className="w-4 h-4" />}
                                </button>
                            )}
                            <div className="aspect-[2/3] bg-card relative overflow-hidden">
                                {coll.plexUrl && !selectMode ? (
                                    <a
                                        href={coll.plexUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block w-full h-full"
                                        title="Open in Plex"
                                    >
                                        <GalleryCollectionArt
                                            thumb={coll.thumb}
                                            title={coll.title}
                                            imageSize={imageSize}
                                            compact={isCompact}
                                            imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        />
                                    </a>
                                ) : (
                                    <GalleryCollectionArt
                                        thumb={coll.thumb}
                                        title={coll.title}
                                        imageSize={imageSize}
                                        compact={isCompact}
                                        imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        onClick={selectMode ? () => toggleSelect(coll) : undefined}
                                    />
                                )}
                                {coll.plexUrl && !selectMode && (
                                    <a
                                        href={coll.plexUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`absolute top-2 left-2 z-[1] bg-black/70 hover:bg-plex text-white rounded flex items-center gap-1 shadow-lg ring-1 ring-white/20 transition-colors ${isCompact ? 'px-1 py-0.5 text-[8px]' : 'px-2 py-1 text-[10px] font-bold'}`}
                                        title="Open in Plex"
                                    >
                                        <ExternalLink className={isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                                        {!isCompact && <span>Plex</span>}
                                    </a>
                                )}
                                {!selectMode && (
                                    <div className="absolute top-2 right-2 z-[1] flex flex-col items-end gap-1">
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => void handleFixArt(coll)}
                                                disabled={isProcessing}
                                                className={`bg-black/70 hover:bg-plex text-white rounded flex items-center justify-center shadow-lg ring-1 ring-white/20 transition-colors disabled:opacity-50 ${isCompact ? 'px-1 py-0.5' : 'px-2 py-1'}`}
                                                title="Set / refresh collection poster"
                                            >
                                                {isFixingArt
                                                    ? <RefreshCw className={`${isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'} animate-spin`} />
                                                    : <ImageIcon className={isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(coll)}
                                                disabled={isProcessing}
                                                className={`bg-black/70 hover:bg-red-600 text-white rounded flex items-center justify-center shadow-lg ring-1 ring-white/20 transition-colors disabled:opacity-50 ${isCompact ? 'px-1 py-0.5' : 'px-2 py-1'}`}
                                                title="Delete collection from Plex"
                                            >
                                                {isDeleting
                                                    ? <RefreshCw className={`${isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'} animate-spin`} />
                                                    : <Trash2 className={isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />}
                                            </button>
                                        </div>
                                        {pinPending ? (
                                            <div className={`bg-black/60 text-muted font-bold rounded flex items-center gap-1 ${isCompact ? 'px-1 py-0.5 text-[8px]' : 'px-2 py-1 text-[10px]'}`}>
                                                <RefreshCw className={`${isCompact ? 'w-2 h-2' : 'w-3 h-3'} animate-spin`} />
                                            </div>
                                        ) : coll.has_label && !coll.is_pinned ? (
                                            <div className={`bg-plex/90 text-background font-bold rounded flex items-center gap-1 shadow-lg ring-1 ring-white/20 ${isCompact ? 'px-1 py-0.5 text-[8px]' : 'px-2 py-1 text-[10px]'}`}>
                                                <CheckCircle2 className={`${isCompact ? 'w-2 h-2' : 'w-3 h-3'}`} /> TRACKED
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </div>

                            <div className={`${isCompact ? 'p-2 gap-1.5' : 'p-4 gap-3'} flex flex-col`}>
                                <div className={`min-w-0 ${isCompact ? 'min-h-[2rem]' : 'min-h-[3.25rem]'}`}>
                                    {coll.plexUrl ? (
                                        <a
                                            href={coll.plexUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`font-bold text-text line-clamp-2 leading-snug hover:text-plex transition-colors ${isCompact ? 'text-[10px]' : 'text-sm'}`}
                                            title={coll.title}
                                        >
                                            {coll.title}
                                        </a>
                                    ) : (
                                        <h3
                                            className={`font-bold text-text line-clamp-2 leading-snug group-hover:text-plex transition-colors ${isCompact ? 'text-[10px]' : 'text-sm'}`}
                                            title={coll.title}
                                        >
                                            {coll.title}
                                        </h3>
                                    )}
                                    {!isCompact && (
                                        <p className="text-[10px] text-muted font-medium uppercase mt-1 truncate" title={coll.library}>
                                            {coll.library}
                                        </p>
                                    )}
                                </div>

                                {!selectMode && (
                                    <button
                                        type="button"
                                        onClick={() => handlePinToggle(coll)}
                                        disabled={isProcessing || pinPending}
                                        className={`w-full rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all border whitespace-nowrap ${isCompact ? 'py-1 text-[10px]' : 'py-2 text-xs'} ${coll.is_pinned
                                            ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                            } disabled:opacity-50`}
                                    >
                                        {isProcessing && !isDeleting ? (
                                            <RefreshCw className={`${isCompact ? 'w-2 h-2' : 'w-3 h-3'} shrink-0 animate-spin`} />
                                        ) : coll.is_pinned ? (
                                            <>
                                                <PinOff className={`${isCompact ? 'w-2 h-2' : 'w-3 h-3'} shrink-0`} />
                                                <span>Unpin</span>
                                            </>
                                        ) : (
                                            <>
                                                <Pin className={`${isCompact ? 'w-2 h-2' : 'w-3 h-3'} shrink-0`} />
                                                <span className={isCompact ? 'hidden' : ''}>Pin to Home</span>
                                                {isCompact && <span>Pin</span>}
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {filteredCollections.length === 0 && (
                <div className="h-64 flex flex-col items-center justify-center text-muted border-2 border-dashed border-border rounded-3xl">
                    <Search className="w-12 h-12 mb-2 opacity-10" />
                    <p>No collections match your filters</p>
                </div>
            )}

            <div className="p-4 bg-card/30 border border-border rounded-2xl flex items-start gap-3 text-xs text-muted">
                <Info className="w-4 h-4 text-plex flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p><b className="text-text">Pinned</b>: Visible on your Plex Home Screen and Shared Home Screens.</p>
                    <p><b className="text-text">Tracked</b>: Has the script label but currently hidden from Home.</p>
                    <p><b className="text-text">Manual Pinning</b>: Overrides schedule until the next run unpins it (unless excluded).</p>
                    <p><b className="text-text">Delete</b>: Permanently removes the collection from Plex (movies/shows stay). Also removes any matching Collexions auto-sync job.</p>
                    <p><b className="text-text">Poster</b> (image icon): Pulls TMDB/franchise art or a 2×2 mosaic of titles into Plex. New creates/syncs do this automatically; use this to fix older blank collections.</p>
                </div>
            </div>
        </div>
    );
};

export default Gallery;
