import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { usePoll } from '../../shared/usePoll';
import { Plus, Search, ListMusic, Globe, Loader2, List, Trash2, Sparkles, Filter, ExternalLink, Compass, Clock, LayoutTemplate, Check } from 'lucide-react';
import { api, collexionsImageUrl } from '../api';
import { CustomSelect } from '../components/ui/Inputs';
import { AppConfig } from '../types';
import { DISCOVER_NETWORKS, DISCOVER_STUDIOS } from '../../discovery/discoverConstants';
import { DISCOVER_LANGUAGE_OPTIONS, TV_STATUS_OPTIONS } from '../../discovery/discoverLanguages';

type CreatorTab = 'templates' | 'trending' | 'discover' | 'search' | 'import' | 'manual';

type BusyOverlay = {
    headline: string;
    detail?: string;
    steps: string[];
};

const CREATOR_TABS: Array<{ id: CreatorTab; label: string }> = [
    { id: 'templates', label: 'Templates' },
    { id: 'trending', label: 'Trending' },
    { id: 'discover', label: 'Discover' },
    { id: 'search', label: 'Global Search' },
    { id: 'import', label: 'Import List' },
    { id: 'manual', label: 'Manual Build' },
];

const DISCOVER_MOVIE_SORT = [
    { value: 'popularity.desc', label: 'Most Popular' },
    { value: 'vote_average.desc', label: 'Highest Rated' },
    { value: 'vote_count.desc', label: 'Most Voted' },
    { value: 'revenue.desc', label: 'Highest Revenue' },
    { value: 'primary_release_date.desc', label: 'Newest First' },
    { value: 'primary_release_date.asc', label: 'Oldest First' },
];

const DISCOVER_TV_SORT = [
    { value: 'popularity.desc', label: 'Most Popular' },
    { value: 'vote_average.desc', label: 'Highest Rated' },
    { value: 'vote_count.desc', label: 'Most Voted' },
    { value: 'first_air_date.desc', label: 'Newest First' },
    { value: 'first_air_date.asc', label: 'Oldest First' },
];

const DISCOVER_CERT_OPTIONS = [
    { value: '', label: 'Any Rating' },
    { value: 'G', label: 'G' },
    { value: 'PG', label: 'PG' },
    { value: 'PG-13', label: 'PG-13' },
    { value: 'R', label: 'R' },
    { value: 'NC-17', label: 'NC-17' },
    { value: 'lte:PG', label: 'Up to PG' },
    { value: 'lte:PG-13', label: 'Up to PG-13' },
];

type DiscoverPreset = {
    id: string;
    label: string;
    apply: (type: 'movie' | 'tv') => Record<string, string>;
};

const DISCOVER_PRESETS: DiscoverPreset[] = [
    {
        id: 'hidden-gems',
        label: 'Hidden Gems',
        apply: () => ({
            sort: 'vote_average.desc',
            rating: '7.5',
            ratingMax: '10',
            voteCount: '50',
            voteCountMax: '1500',
        }),
    },
    {
        id: 'critically-acclaimed',
        label: 'Critically Acclaimed',
        apply: () => ({
            sort: 'vote_average.desc',
            rating: '8',
            ratingMax: '',
            voteCount: '500',
            voteCountMax: '',
        }),
    },
    {
        id: 'fresh',
        label: 'Fresh Releases',
        apply: (mediaType) => {
            const from = new Date();
            from.setFullYear(from.getFullYear() - 1);
            return {
                sort: mediaType === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
                yearFrom: String(from.getFullYear()),
                yearTo: '',
            };
        },
    },
    {
        id: 'family',
        label: 'Family Night',
        apply: () => ({
            certification: 'lte:PG-13',
            genre: '10751',
            rating: '6',
            ratingMax: '',
        }),
    },
    {
        id: 'short',
        label: 'Short Watch',
        apply: () => ({
            runtimeMin: '',
            runtimeMax: '100',
        }),
    },
    {
        id: 'binge',
        label: 'Binge Ready',
        apply: (mediaType) => (mediaType === 'tv'
            ? { status: '0', sort: 'popularity.desc', voteCount: '100' }
            : { sort: 'popularity.desc', voteCount: '200', voteCountMax: '' }),
    },
];

type JobTemplate = {
    id: string;
    name: string;
    description: string;
    category: string;
    media: string;
    source_type: string;
    source_id: string;
    default_sort: string;
    requires: string[];
    available: boolean;
};

type PlexLibraryInfo = { name: string; type: string };

type MediaKind = 'movie' | 'show';

/** True when the URL's host is mdblist.com (or a subdomain), not just containing the text. */
const isMdbListUrl = (value: string): boolean => {
    const raw = String(value || '').trim();
    try {
        const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
        return host === 'mdblist.com' || host.endsWith('.mdblist.com');
    } catch {
        return false;
    }
};

const normalizeMediaKind = (value?: string | null): MediaKind | null => {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'movie' || v === 'movies' || v === 'film' || v === 'films') return 'movie';
    if (v === 'show' || v === 'shows' || v === 'tv' || v === 'television' || v === 'series') return 'show';
    return null;
};

const mediaFromSourceType = (sourceType?: string): MediaKind | null => {
    const st = String(sourceType || '').toLowerCase();
    if (!st) return null;
    if (st.includes('show') || st.endsWith('_tv') || st.includes('_tv_') || st.startsWith('tmdb_tv')) return 'show';
    if (st.includes('movie') || st === 'tmdb_collection' || st === 'tmdb_genre') return 'movie';
    return null;
};

const mediaFromItems = (items?: Array<{ type?: string }>): MediaKind | null => {
    const kinds = new Set<MediaKind>();
    for (const it of items || []) {
        const kind = normalizeMediaKind(it?.type);
        if (kind) kinds.add(kind);
    }
    if (kinds.size === 1) return [...kinds][0];
    return null;
};

const titleFromSlug = (slug: string) =>
    slug.replace(/-/g, ' ').split(' ').filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const titleFromImportUrl = (url: string) => {
    try {
        const parsed = new URL(url.trim());
        const parts = parsed.pathname.split('/').filter(Boolean);
        const listIndex = parts.indexOf('lists');
        const slugPart = listIndex !== -1 && parts.length > listIndex + 2
            ? parts[listIndex + 2]
            : parts[parts.length - 1];
        return slugPart ? titleFromSlug(decodeURIComponent(slugPart)) : '';
    } catch {
        const parts = url.split('/').filter(Boolean);
        const slug = (parts[parts.length - 1] || '').replace(/\?.*$/, '');
        return slug ? titleFromSlug(decodeURIComponent(slug)) : '';
    }
};

const Creator: React.FC = () => {
    const [activeSubTab, setActiveSubTab] = useState<CreatorTab>('templates');
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [plexLibraries, setPlexLibraries] = useState<PlexLibraryInfo[]>([]);
    // Trending State
    const [trendingPresets, setTrendingPresets] = useState<any[]>([]);
    const [viewingPreset, setViewingPreset] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

    // Templates
    const [templates, setTemplates] = useState<JobTemplate[]>([]);
    const [templateCategories, setTemplateCategories] = useState<Array<{ id: string; label: string }>>([]);
    const [templateCategory, setTemplateCategory] = useState<string>('all');
    const [templateKeys, setTemplateKeys] = useState<{ tmdb: boolean; trakt: boolean }>({ tmdb: false, trakt: false });
    /** When a library is selected, hide the other media type (toggle to show all). */
    const [matchLibraryMedia, setMatchLibraryMedia] = useState(true);
    const [franchiseQuery, setFranchiseQuery] = useState('');
    const [franchiseResults, setFranchiseResults] = useState<any[]>([]);
    const [searchingFranchises, setSearchingFranchises] = useState(false);
    const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);

    // Shared State
    const [targetLibrary, setTargetLibrary] = useState<string>('');
    const [collectionTitle, setCollectionTitle] = useState('');
    const [sortOrder, setSortOrder] = useState<'custom' | 'random' | 'release'>('custom');
    const [autoSync, setAutoSync] = useState(true);
    const [creating, setCreating] = useState(false);
    const [busyOverlay, setBusyOverlay] = useState<BusyOverlay | null>(null);
    const [busyStep, setBusyStep] = useState(0);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 5000);
    };

    const startBusy = (overlay: BusyOverlay) => {
        setBusyStep(0);
        setBusyOverlay(overlay);
    };

    const stopBusy = () => {
        setBusyOverlay(null);
        setBusyStep(0);
    };

    usePoll(() => {
        setBusyStep((s) => Math.min(s + 1, (busyOverlay?.steps.length ?? 1) - 1));
    }, busyOverlay && busyOverlay.steps.length > 1 ? 4000 : null, { immediate: false });

    const ensureLibraryMatchesMedia = (media?: string | null): boolean => {
        const expected = normalizeMediaKind(media);
        if (!expected || !targetLibrary) return true;
        const lib = plexLibraries.find((l) => l.name === targetLibrary);
        const libType = normalizeMediaKind(lib?.type);
        if (!libType || libType === expected) return true;
        showToast(
            expected === 'movie'
                ? `"${targetLibrary}" is a TV Shows library — pick a Movies library for this collection.`
                : `"${targetLibrary}" is a Movies library — pick a TV Shows library for this collection.`,
            'error',
        );
        return false;
    };

    const managedLibraryNames = useMemo(() => {
        const configured = config?.library_names || [];
        if (configured.length) return configured;
        return plexLibraries.map((l) => l.name).filter(Boolean);
    }, [config?.library_names, plexLibraries]);

    const librarySelectOptions = useMemo(() => {
        return managedLibraryNames.map((name) => {
            const info = plexLibraries.find((l) => l.name === name);
            const kind = normalizeMediaKind(info?.type);
            const suffix = kind === 'show' ? 'TV' : kind === 'movie' ? 'Movies' : null;
            return { value: name, label: suffix ? `${name} (${suffix})` : name };
        });
    }, [managedLibraryNames, plexLibraries]);

    const suggestTargetLibrary = useCallback((
        items?: Array<{ type?: string }>,
        sourceUrl = '',
    ): string => {
        const names = managedLibraryNames;
        if (!names.length) return '';
        const expected = mediaFromItems(items)
            || mediaFromSourceType(
                isMdbListUrl(sourceUrl) ? 'mdblist' : 'trakt_list',
            );
        if (expected) {
            const match = plexLibraries.find(
                (l) => names.includes(l.name) && normalizeMediaKind(l.type) === expected,
            );
            if (match) return match.name;
        }
        if (names.length === 1) return names[0];
        const movieLib = plexLibraries.find(
            (l) => names.includes(l.name) && normalizeMediaKind(l.type) === 'movie',
        );
        if (movieLib) return movieLib.name;
        return names[0];
    }, [managedLibraryNames, plexLibraries]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [cfg, presets, tplPayload, libs] = await Promise.all([
                api.getConfig(),
                api.getTrending().catch(() => []),
                api.getTemplates().catch(() => ({ templates: [], categories: [], keys: { tmdb: false, trakt: false } })),
                api.getPlexLibraries().catch(() => []),
            ]);
            setConfig(cfg);
            setTrendingPresets(presets);
            setTemplates(tplPayload.templates || []);
            setTemplateCategories(tplPayload.categories || []);
            setTemplateKeys(tplPayload.keys || { tmdb: false, trakt: false });
            setPlexLibraries(
                Array.isArray(libs)
                    ? libs.map((l: any) => ({ name: String(l.name || ''), type: String(l.type || '') })).filter((l) => l.name)
                    : [],
            );
            const libNames = cfg?.library_names?.length
                ? cfg.library_names
                : (Array.isArray(libs)
                    ? libs.map((l: any) => String(l.name || '')).filter(Boolean)
                    : []);
            if (libNames.length >= 1) {
                setTargetLibrary((prev) => prev || libNames[0]);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, []);

    const selectedLibraryMedia = useMemo((): MediaKind | null => {
        if (!targetLibrary) return null;
        const lib = plexLibraries.find((l) => l.name === targetLibrary);
        return normalizeMediaKind(lib?.type);
    }, [targetLibrary, plexLibraries]);

    const templateMediaOf = (tpl: JobTemplate): MediaKind | null =>
        normalizeMediaKind(tpl.media) || mediaFromSourceType(tpl.source_type);

    const filteredTemplates = useMemo(() => {
        let list = templates;
        if (templateCategory !== 'all') {
            list = list.filter((t) => t.category === templateCategory);
        }
        if (selectedLibraryMedia && matchLibraryMedia) {
            list = list.filter((t) => {
                const m = templateMediaOf(t);
                return !m || m === selectedLibraryMedia;
            });
        } else if (selectedLibraryMedia) {
            list = [...list].sort((a, b) => {
                const am = templateMediaOf(a) === selectedLibraryMedia ? 0 : 1;
                const bm = templateMediaOf(b) === selectedLibraryMedia ? 0 : 1;
                return am - bm;
            });
        }
        return list;
    }, [templates, templateCategory, selectedLibraryMedia, matchLibraryMedia]);

    const filteredTrendingPresets = useMemo(() => {
        const mediaOf = (p: any): MediaKind | null =>
            normalizeMediaKind(p?.media)
            || mediaFromItems(p?.items)
            || mediaFromSourceType(p?.source_type);

        if (!selectedLibraryMedia || !matchLibraryMedia) {
            if (!selectedLibraryMedia) return trendingPresets;
            return [...trendingPresets].sort((a, b) => {
                const am = mediaOf(a) === selectedLibraryMedia ? 0 : 1;
                const bm = mediaOf(b) === selectedLibraryMedia ? 0 : 1;
                return am - bm;
            });
        }
        return trendingPresets.filter((p) => {
            const m = mediaOf(p);
            return !m || m === selectedLibraryMedia;
        });
    }, [trendingPresets, selectedLibraryMedia, matchLibraryMedia]);

    const handleCreateTemplate = async (tpl: JobTemplate) => {
        if (!targetLibrary) {
            showToast('Please select a target library first!', 'error');
            return;
        }
        if (!tpl.available) {
            showToast(`Add required API keys in Settings (${(tpl.requires || []).join(', ')}).`, 'error');
            return;
        }
        if (!ensureLibraryMatchesMedia(tpl.media || mediaFromSourceType(tpl.source_type))) return;
        setCreatingTemplateId(tpl.id);
        setCreating(true);
        const mediaLabel = normalizeMediaKind(tpl.media) === 'show' ? 'shows' : 'movies';
        startBusy({
            headline: `Creating “${tpl.name}”`,
            detail: `Collecting ${mediaLabel} into ${targetLibrary}`,
            steps: [
                `Fetching ${mediaLabel} from the source…`,
                'Matching titles to your Plex library…',
                'Building the collection in Plex…',
                'Finishing up — please don’t refresh…',
            ],
        });
        try {
            const res = await api.createFromTemplate({
                library: targetLibrary,
                template_id: tpl.id,
                sort_order: sortOrder || tpl.default_sort,
                auto_sync: autoSync,
            });
            if (res.success) {
                showToast(
                    `Created '${res.title || tpl.name}' — matched ${res.matched}/${res.total} titles.${autoSync ? ' Auto-sync job registered.' : ''}`,
                    'success',
                );
            } else {
                showToast(res.error || 'Failed to create collection.', 'error');
            }
        } catch (e: any) {
            showToast(e?.message || 'Failed to create collection.', 'error');
        } finally {
            stopBusy();
            setCreating(false);
            setCreatingTemplateId(null);
        }
    };

    const handleFranchiseSearch = async () => {
        if (!franchiseQuery.trim()) return;
        setSearchingFranchises(true);
        try {
            const results = await api.searchFranchises(franchiseQuery.trim());
            setFranchiseResults(Array.isArray(results) ? results : []);
            if (!Array.isArray(results) || results.length === 0) {
                showToast('No franchises found for that search.', 'info');
            }
        } catch (e: any) {
            showToast(e?.message || 'Franchise search failed.', 'error');
            setFranchiseResults([]);
        } finally {
            setSearchingFranchises(false);
        }
    };

    const handleCreateFranchise = async (franchise: { name: string; source_type: string; source_id: string }) => {
        if (!targetLibrary) {
            showToast('Please select a target library first!', 'error');
            return;
        }
        if (!templateKeys.tmdb) {
            showToast('TMDB API key required in Settings.', 'error');
            return;
        }
        if (!ensureLibraryMatchesMedia(mediaFromSourceType(franchise.source_type) || 'movie')) return;
        setCreatingTemplateId(`franchise-${franchise.source_id}`);
        setCreating(true);
        startBusy({
            headline: `Creating “${franchise.name}”`,
            detail: `Collecting franchise films into ${targetLibrary}`,
            steps: [
                'Fetching the franchise from TMDB…',
                'Matching titles to your Plex library…',
                'Building the collection in Plex…',
                'Finishing up — please don’t refresh…',
            ],
        });
        try {
            const res = await api.createFromTemplate({
                library: targetLibrary,
                title: franchise.name,
                source_type: franchise.source_type,
                source_id: franchise.source_id,
                sort_order: sortOrder === 'custom' ? 'release' : sortOrder,
                auto_sync: autoSync,
            });
            if (res.success) {
                showToast(
                    `Created '${res.title || franchise.name}' — matched ${res.matched}/${res.total} titles.`,
                    'success',
                );
            } else {
                showToast(res.error || 'Failed to create franchise collection.', 'error');
            }
        } catch (e: any) {
            showToast(e?.message || 'Failed to create franchise collection.', 'error');
        } finally {
            stopBusy();
            setCreating(false);
            setCreatingTemplateId(null);
        }
    };

    const handleCreatePreset = async (preset: any) => {
        if (!targetLibrary) {
            showToast("Please select a target library first!", "error");
            return;
        }
        const sourceType = preset.source_type
            || ({
                tmdb_movie_week: 'tmdb_trending_movie',
                tmdb_tv_week: 'tmdb_trending_tv',
                tmdb_tv_popular: 'tmdb_tv_popular',
                tmdb_movie_top: 'tmdb_movie_top',
                tmdb_kids: 'tmdb_kids',
                tmdb_horror: 'tmdb_horror',
                tmdb_docs: 'tmdb_docs',
                tmdb_scifi: 'tmdb_scifi',
                trakt_movie_trending: 'trakt_trending_movie',
                trakt_show_trending: 'trakt_trending_show',
                trakt_movie_anticipated: 'trakt_anticipated_movie',
                trakt_show_anticipated: 'trakt_anticipated_show',
            } as Record<string, string>)[preset.id]
            || 'trending_preset';
        const sourceId = preset.source_id || preset.id;
        const expectedMedia = normalizeMediaKind(preset.media)
            || mediaFromSourceType(sourceType)
            || mediaFromItems(preset.items);
        if (!ensureLibraryMatchesMedia(expectedMedia)) return;
        setCreating(true);
        startBusy({
            headline: `Creating “${preset.name}”`,
            detail: `Matching into ${targetLibrary}`,
            steps: [
                'Collecting titles from the source…',
                'Matching titles to your Plex library…',
                'Building the collection in Plex…',
                'Finishing up — please don’t refresh…',
            ],
        });
        try {
            const res = await api.createFromExternal(
                targetLibrary,
                preset.name,
                preset.items,
                sortOrder,
                autoSync,
                sourceType,
                sourceId
            );

            setSelectionPool([]);
            if (res.success) {
                showToast(`Successfully created '${preset.name}'! Matched ${res.matched}/${res.total} items.`, "success");
                setViewingPreset(null);
            } else showToast("Error: " + res.error, "error");
        } catch (e) {
            showToast("Failed to create collection.", "error");
        } finally {
            stopBusy();
            setCreating(false);
        }
    };

    // Manual Build State
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [localSearchYear, setLocalSearchYear] = useState('');
    const [localSearchGenre, setLocalSearchGenre] = useState('');
    const [localResults, setLocalResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);

    // Unified Selection Pool (The "Cart")
    const [selectionPool, setSelectionPool] = useState<any[]>([]);

    // Import State
    const [importUrl, setImportUrl] = useState('');
    const [importedItems, setImportedItems] = useState<any[]>([]);
    const [importing, setImporting] = useState(false);
    const [traktListQuery, setTraktListQuery] = useState('');
    const [traktListResults, setTraktListResults] = useState<Array<{
        name: string;
        description: string;
        username: string;
        slug: string;
        url: string;
        item_count?: number | null;
        likes?: number | null;
    }>>([]);
    const [searchingTraktLists, setSearchingTraktLists] = useState(false);
    const [loadingTraktListUrl, setLoadingTraktListUrl] = useState<string | null>(null);

    // Global Search State
    const [externalQuery, setExternalQuery] = useState('');
    const [externalResults, setExternalResults] = useState<any[]>([]);
    const [searchingExternal, setSearchingExternal] = useState(false);

    // Discover State
    const [discoverType, setDiscoverType] = useState<'movie' | 'tv'>('movie');
    const [discoverGenres, setDiscoverGenres] = useState<any[]>([]);
    const [selectedGenre, setSelectedGenre] = useState('');
    const [selectedGenreAnd, setSelectedGenreAnd] = useState('');
    const [excludeGenre, setExcludeGenre] = useState('');
    const [discoverYearFrom, setDiscoverYearFrom] = useState('');
    const [discoverYearTo, setDiscoverYearTo] = useState('');
    const [discoverRating, setDiscoverRating] = useState('');
    const [discoverRatingMax, setDiscoverRatingMax] = useState('');
    const [discoverVoteCount, setDiscoverVoteCount] = useState('');
    const [discoverVoteCountMax, setDiscoverVoteCountMax] = useState('');
    const [discoverRuntimeMin, setDiscoverRuntimeMin] = useState('');
    const [discoverRuntimeMax, setDiscoverRuntimeMax] = useState('');
    const [discoverLanguage, setDiscoverLanguage] = useState('');
    const [discoverNetwork, setDiscoverNetwork] = useState('');
    const [discoverCompany, setDiscoverCompany] = useState('');
    const [discoverKeywords, setDiscoverKeywords] = useState('');
    const [discoverExcludeKeywords, setDiscoverExcludeKeywords] = useState('');
    const [discoverSort, setDiscoverSort] = useState('popularity.desc');
    const [discoverCertification, setDiscoverCertification] = useState('');
    const [discoverStatus, setDiscoverStatus] = useState('');
    const [discoverResults, setDiscoverResults] = useState<any[]>([]);
    const [discovering, setDiscovering] = useState(false);
    const [showPoolDetails, setShowPoolDetails] = useState(false);
    const [activeDiscoverPreset, setActiveDiscoverPreset] = useState<string | null>(null);

    const studioOptions = useMemo(
        () => [
            { value: '', label: 'Any Studio' },
            ...DISCOVER_STUDIOS.map((s) => ({ value: String(s.id), label: s.name })),
        ],
        [],
    );
    const networkOptions = useMemo(
        () => [
            { value: '', label: 'Any Network' },
            ...DISCOVER_NETWORKS.map((n) => ({ value: String(n.id), label: n.name })),
        ],
        [],
    );
    const genreOptions = useMemo(
        () => [
            { value: '', label: 'Any Genre' },
            ...discoverGenres.map((g) => ({ value: g.id.toString(), label: g.name })),
        ],
        [discoverGenres],
    );

    const buildDiscoverFilterPayload = () => {
        const genres = [selectedGenre, selectedGenreAnd].filter(Boolean);
        const cert = discoverCertification.startsWith('lte:')
            ? { 'certification.lte': discoverCertification.slice(4), certification_country: 'US' }
            : discoverCertification
                ? { certification: discoverCertification, certification_country: 'US' }
                : {};
        return {
            type: discoverType,
            with_genres: genres.length ? genres.join(',') : undefined,
            without_genres: excludeGenre || undefined,
            year_from: discoverYearFrom || undefined,
            year_to: discoverYearTo || undefined,
            with_keywords: discoverKeywords || undefined,
            without_keywords: discoverExcludeKeywords || undefined,
            'vote_average.gte': discoverRating || undefined,
            'vote_average.lte': discoverRatingMax || undefined,
            'vote_count.gte': discoverVoteCount || undefined,
            'vote_count.lte': discoverVoteCountMax || undefined,
            'with_runtime.gte': discoverRuntimeMin || undefined,
            'with_runtime.lte': discoverRuntimeMax || undefined,
            with_original_language: discoverLanguage || undefined,
            with_networks: discoverType === 'tv' ? discoverNetwork || undefined : undefined,
            with_companies: discoverType === 'movie' ? discoverCompany || undefined : undefined,
            with_status: discoverType === 'tv' ? discoverStatus || undefined : undefined,
            sort_by: discoverSort,
            ...cert,
        };
    };

    const applyDiscoverPreset = (preset: DiscoverPreset) => {
        const next = preset.apply(discoverType);
        setActiveDiscoverPreset(preset.id);
        if (next.sort != null) setDiscoverSort(next.sort);
        if (next.rating != null) setDiscoverRating(next.rating);
        if (next.ratingMax != null) setDiscoverRatingMax(next.ratingMax);
        if (next.voteCount != null) setDiscoverVoteCount(next.voteCount);
        if (next.voteCountMax != null) setDiscoverVoteCountMax(next.voteCountMax);
        if (next.yearFrom != null) setDiscoverYearFrom(next.yearFrom);
        if (next.yearTo != null) setDiscoverYearTo(next.yearTo);
        if (next.certification != null) setDiscoverCertification(next.certification);
        if (next.genre != null) setSelectedGenre(next.genre);
        if (next.runtimeMin != null) setDiscoverRuntimeMin(next.runtimeMin);
        if (next.runtimeMax != null) setDiscoverRuntimeMax(next.runtimeMax);
        if (next.status != null) setDiscoverStatus(next.status);
    };

    // Keep Discover media type aligned with the selected library.
    useEffect(() => {
        if (!selectedLibraryMedia) return;
        setDiscoverType(selectedLibraryMedia === 'show' ? 'tv' : 'movie');
    }, [selectedLibraryMedia]);

    useEffect(() => {
        if (activeSubTab === 'discover') {
            api.getTmdbGenres(discoverType).then(setDiscoverGenres).catch(console.error);
        }
    }, [discoverType, activeSubTab]);

    // Keep sort option valid when switching movie ↔ TV.
    useEffect(() => {
        const allowed = (discoverType === 'tv' ? DISCOVER_TV_SORT : DISCOVER_MOVIE_SORT).map((o) => o.value);
        if (!allowed.includes(discoverSort)) {
            setDiscoverSort('popularity.desc');
        }
    }, [discoverType, discoverSort]);

    const handleDiscover = async () => {
        setDiscovering(true);
        try {
            const results = await api.discoverTmdb(buildDiscoverFilterPayload());
            setDiscoverResults(results);
        } catch (e) {
            showToast("Failed to discover content.", "error");
        } finally {
            setDiscovering(false);
        }
    };


    const loadImportedList = async (url: string, preferredTitle?: string) => {
        let items: any[] = [];
        if (isMdbListUrl(url)) {
            items = await api.getMdbList(url);
        } else {
            items = await api.getTraktList(url);
        }
        if (!Array.isArray(items)) {
            throw new Error((items as any)?.error || 'List response was invalid.');
        }
        setImportedItems(items);
        setImportUrl(url);
        const derivedTitle = preferredTitle || titleFromImportUrl(url);
        if (derivedTitle) setCollectionTitle(derivedTitle);
        const suggestedLibrary = suggestTargetLibrary(items, url);
        if (suggestedLibrary) {
            setTargetLibrary((prev) => {
                if (!prev) return suggestedLibrary;
                const expected = mediaFromItems(items);
                if (!expected) return prev;
                const current = plexLibraries.find((l) => l.name === prev);
                if (normalizeMediaKind(current?.type) === expected) return prev;
                return suggestedLibrary;
            });
        }
        return items;
    };

    const handleListImport = async () => {
        if (!importUrl) return;
        setImporting(true);
        try {
            const items = await loadImportedList(importUrl);
            showToast(`Loaded ${items.length} titles from list.`, 'success');
        } catch (e: any) {
            showToast(e?.message || 'Failed to fetch list. Check URL or API keys.', 'error');
        } finally {
            setImporting(false);
        }
    };

    const handleTraktListSearch = async () => {
        if (!traktListQuery.trim()) return;
        if (!config?.trakt_client_id && !templateKeys.trakt) {
            showToast('Add a Trakt client ID in Settings to search lists.', 'error');
            return;
        }
        setSearchingTraktLists(true);
        try {
            const results = await api.searchTraktLists(traktListQuery.trim());
            setTraktListResults(Array.isArray(results) ? results : []);
            if (!Array.isArray(results) || results.length === 0) {
                showToast('No public Trakt lists found for that search.', 'info');
            }
        } catch (e: any) {
            showToast(e?.message || 'Trakt list search failed.', 'error');
            setTraktListResults([]);
        } finally {
            setSearchingTraktLists(false);
        }
    };

    const handleSelectTraktList = async (list: {
        name: string;
        url: string;
    }) => {
        setLoadingTraktListUrl(list.url);
        setImporting(true);
        startBusy({
            headline: `Loading “${list.name}”`,
            detail: 'Pulling the full Trakt list for preview',
            steps: [
                'Contacting Trakt…',
                'Downloading every title from the list…',
                'Preparing your preview…',
            ],
        });
        try {
            const items = await loadImportedList(list.url, list.name);
            if (!items.length) {
                showToast(
                    `“${list.name}” returned 0 titles from Trakt (list may be private or empty).`,
                    'error',
                );
                return;
            }
            showToast(`Loaded “${list.name}” (${items.length} titles).`, 'success');
        } catch (e: any) {
            const msg = String(e?.message || '');
            showToast(
                /504|timeout/i.test(msg)
                    ? 'Preview timed out loading that list. Try again — large lists can take a moment.'
                    : (msg || 'Failed to load that Trakt list.'),
                'error',
            );
        } finally {
            stopBusy();
            setImporting(false);
            setLoadingTraktListUrl(null);
        }
    };

    const handleCreateTraktList = async (list: { name: string; url: string }) => {
        if (!targetLibrary) {
            showToast('Please select a target library first!', 'error');
            return;
        }
        setLoadingTraktListUrl(list.url);
        setCreating(true);
        startBusy({
            headline: `Creating “${list.name}”`,
            detail: `Matching into ${targetLibrary} — large lists can take a minute`,
            steps: [
                'Fetching titles from Trakt…',
                'Matching titles to your Plex library…',
                'Building the collection in Plex…',
                'Finishing up — please don’t refresh…',
            ],
        });
        try {
            let items: any[] = [];
            try {
                items = await loadImportedList(list.url, list.name);
            } catch (loadErr: any) {
                // Fall through — server can still fetch via source_type + URL.
                console.warn('Trakt preview load failed; creating via server fetch', loadErr);
            }
            if (items.length && !ensureLibraryMatchesMedia(mediaFromItems(items))) return;
            // For unknown/mixed media, assume show lists need a TV library when name hints TV.
            if (!items.length && /tv|show|series/i.test(list.name)) {
                if (!ensureLibraryMatchesMedia('show')) return;
            }
            setBusyStep((s) => Math.min(s + 1, 3));
            const res = await api.createFromExternal(
                targetLibrary,
                list.name,
                items,
                sortOrder,
                autoSync,
                'trakt_list',
                list.url,
            );
            if (res.success) {
                showToast(`Created '${list.name}' — matched ${res.matched}/${res.total} titles.`, 'success');
                setImportedItems([]);
                setCollectionTitle('');
            } else {
                showToast(res.error || 'Failed to create collection.', 'error');
            }
        } catch (e: any) {
            showToast(e?.message || 'Failed to create collection from Trakt list.', 'error');
        } finally {
            stopBusy();
            setCreating(false);
            setLoadingTraktListUrl(null);
        }
    };

    const handleExternalSearch = async () => {
        if (!externalQuery) return;
        setSearchingExternal(true);
        try {
            const results = await api.searchExternal(externalQuery, 'movie');
            setExternalResults(results);
        } catch (e) {
            console.error(e);
        } finally {
            setSearchingExternal(false);
        }
    };

    const handleLocalSearch = async () => {
        if (!targetLibrary) return;
        setSearching(true);
        try {
            const res = await api.searchLibrary(targetLibrary, localSearchQuery, localSearchGenre, localSearchYear);
            setLocalResults(res);
        } catch (e) {
            showToast("Failed to search library.", "error");
        } finally {
            setSearching(false);
        }
    };

    const toggleSelection = (item: any) => {
        setSelectionPool(prev => {
            const exists = prev.find(i => (i.id || i.guid) === (item.id || item.guid));
            if (exists) {
                return prev.filter(i => (i.id || i.guid) !== (item.id || i.guid));
            }
            return [...prev, item];
        });
    };

    const handleCreate = async () => {
        if (!targetLibrary || !collectionTitle || selectionPool.length === 0) return;
        setCreating(true);
        startBusy({
            headline: `Creating “${collectionTitle}”`,
            detail: `Matching ${selectionPool.length} titles into ${targetLibrary}`,
            steps: [
                'Preparing your selected titles…',
                'Matching titles to your Plex library…',
                'Building the collection in Plex…',
                'Finishing up — please don’t refresh…',
            ],
        });
        try {
            // Check if items are from library (ratingKey) or external (id)
            const hasExternal = selectionPool.some(i => i.id && !i.ratingKey);

            let res;
            if (hasExternal) {
                // If there are external items, we use the external creation logic
                res = await api.createFromExternal(
                    targetLibrary,
                    collectionTitle,
                    selectionPool,
                    sortOrder,
                    autoSync,
                    'manual_custom',
                    'custom_selection'
                );
            } else {
                // All items are local library keys
                const keys = selectionPool.map(i => i.ratingKey);
                res = await api.createCollection(targetLibrary, collectionTitle, keys, sortOrder);
            }

            if (res.success) {
                showToast("Collection created!", "success");
                setSelectionPool([]);
                setCollectionTitle('');
                setLocalSearchQuery('');
                setLocalResults([]);
                setDiscoverResults([]);
                setActiveSubTab('trending');
            } else showToast("Error: " + res.error, "error");
        } catch (e) {
            showToast("Failed to create collection.", "error");
        } finally {
            stopBusy();
            setCreating(false);
        }
    };


    const handleCreateFromExternal = async () => {
        if (!targetLibrary || !collectionTitle) return;
        const isDiscover = activeSubTab === 'discover';
        const isMdbList = isMdbListUrl(importUrl);
        const sourceType = activeSubTab === 'import' ? (isMdbList ? 'mdblist' : 'trakt_list') :
            (isDiscover ? 'tmdb_discover' : 'trakt_trending_movie');
        const itemsToUse = isDiscover ? discoverResults : importedItems;
        const expectedMedia = isDiscover
            ? normalizeMediaKind(discoverType)
            : (mediaFromSourceType(sourceType) || mediaFromItems(itemsToUse));
        if (!ensureLibraryMatchesMedia(expectedMedia)) return;
        setCreating(true);
        startBusy({
            headline: `Creating “${collectionTitle}”`,
            detail: `Matching into ${targetLibrary}`,
            steps: [
                'Collecting titles from the source…',
                'Matching titles to your Plex library…',
                'Building the collection in Plex…',
                'Finishing up — please don’t refresh…',
            ],
        });
        try {
            const sourceId = activeSubTab === 'import' ? importUrl :
                (isDiscover ? JSON.stringify(buildDiscoverFilterPayload()) : externalQuery);

            const res = await api.createFromExternal(
                targetLibrary,
                collectionTitle,
                itemsToUse,
                sortOrder,
                autoSync,
                sourceType,
                sourceId
            );
            if (res.success) {
                showToast(`Success! Matched ${res.matched}/${res.total} items.`, "success");
                // Clear form state for this flow but stay on the current tab
                // (Import List / Discover) so users can create another collection.
                if (isDiscover) {
                    setDiscoverResults([]);
                } else {
                    setImportedItems([]);
                    setImportUrl('');
                }
                setCollectionTitle('');
                setExternalQuery('');
                setExternalResults([]);
            } else showToast("Error: " + res.error, "error");
        } catch (e) {
            showToast("Failed to create collection.", "error");
        } finally {
            stopBusy();
            setCreating(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center text-muted flex-col gap-4">
                <Loader2 className="w-8 h-8 border-t-plex animate-spin" />
                <p>Connecting to external services... This may take a while on the first run.</p>
            </div>
        );
    }

    const hasKeys = config?.tmdb_api_key || config?.trakt_client_id;

    return (
        <div className="space-y-8 pb-20 animate-in fade-in duration-500">
            {/* Custom Toast Notification */}
            {toast && (
                <div className={`fixed bottom-8 right-8 z-[110] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl border animate-in slide-in-from-right-10 duration-500 ${toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100' :
                    toast.type === 'error' ? 'bg-rose-950/90 border-rose-500/50 text-rose-100' :
                        'bg-card/90 border-border text-text'
                    }`}>
                    {toast.type === 'success' && <div className="bg-emerald-500 rounded-full p-1"><Plus className="w-4 h-4 text-emerald-950 rotate-0" /></div>}
                    {toast.type === 'error' && <div className="bg-rose-500 rounded-full p-1"><Plus className="w-4 h-4 text-rose-950 rotate-45" /></div>}
                    <span className="font-bold">{toast.message}</span>
                    <button onClick={() => setToast(null)} className="ml-4 text-white/50 hover:text-text transition-colors">
                        <Plus className="w-4 h-4 rotate-45" />
                    </button>
                </div>
            )}

            {busyOverlay && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-background/75 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="w-full max-w-md rounded-3xl border border-border bg-card shadow-2xl p-6 sm:p-8 animate-in zoom-in-95 duration-300">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="relative w-16 h-16">
                                <div className="absolute inset-0 rounded-full border-2 border-plex/20" />
                                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-plex animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center text-plex">
                                    <Sparkles className="w-6 h-6 animate-pulse" />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <h3 className="text-xl font-bold text-text">{busyOverlay.headline}</h3>
                                {busyOverlay.detail && (
                                    <p className="text-sm text-muted">{busyOverlay.detail}</p>
                                )}
                            </div>
                            <div className="w-full space-y-2.5 pt-1">
                                {busyOverlay.steps.map((step, idx) => {
                                    const done = idx < busyStep;
                                    const active = idx === busyStep;
                                    return (
                                        <div
                                            key={step}
                                            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all duration-500 ${
                                                active
                                                    ? 'border-plex/40 bg-plex/10 text-text'
                                                    : done
                                                        ? 'border-border/60 bg-background/30 text-muted'
                                                        : 'border-transparent text-muted/50'
                                            }`}
                                        >
                                            <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                                                {done ? (
                                                    <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                                                        <Check className="w-3 h-3" />
                                                    </div>
                                                ) : active ? (
                                                    <Loader2 className="w-4 h-4 animate-spin text-plex" />
                                                ) : (
                                                    <div className="w-2 h-2 rounded-full bg-muted/40" />
                                                )}
                                            </div>
                                            <span className={`text-sm text-left ${active ? 'font-semibold' : ''}`}>
                                                {step}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-muted pt-1">
                                This can take a while for big lists. Don’t refresh the page.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal for viewing all items in a preset */}
            {viewingPreset && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-card border border-border w-full max-w-4xl max-h-[80vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col scale-in-center">
                        <div className="p-6 border-b border-border flex items-center justify-between bg-card/60">
                            <div>
                                <h2 className="text-2xl font-bold text-text">{viewingPreset.name}</h2>
                                <p className="text-muted">{viewingPreset.items.length} items to match</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleCreatePreset(viewingPreset)}
                                    disabled={creating}
                                    className="bg-plex hover:bg-plex/80 disabled:opacity-50 text-text px-6 py-2 rounded-xl font-bold transition-all shadow-lg flex items-center gap-2"
                                >
                                    {creating ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="w-5 h-5" />}
                                    Create Collection
                                </button>
                                <button
                                    onClick={() => setViewingPreset(null)}
                                    className="p-2 hover:bg-white/5 rounded-xl text-muted hover:text-text transition-all"
                                >
                                    <Plus className="w-6 h-6 rotate-45" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {viewingPreset.items.map((itm: any, idx: number) => (
                                    <div key={idx} className="space-y-2 group">
                                        <div className="aspect-[2/3] bg-card rounded-xl overflow-hidden ring-1 ring-border group-hover:ring-plex/50 transition-all">
                                            {itm.poster ? (
                                                <img src={itm.poster} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-muted">
                                                    <Globe className="w-8 h-8 opacity-20" />
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-xs font-bold text-text truncate px-1">{itm.title}</p>
                                        <p className="text-[10px] text-muted px-1">{itm.year || 'Unknown'}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="p-6 border-t border-border bg-card/60 flex justify-end gap-3">
                            <button
                                onClick={() => setViewingPreset(null)}
                                className="px-6 py-2 rounded-xl font-bold text-text hover:bg-white/5 transition-colors"
                            >
                                Close
                            </button>
                            <button
                                onClick={() => {
                                    handleCreatePreset(viewingPreset);
                                    setViewingPreset(null);
                                }}
                                disabled={creating || !targetLibrary}
                                className="bg-plex hover:bg-plex-hover text-text px-8 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg disabled:opacity-50"
                            >
                                <Sparkles className="w-4 h-4" />
                                Create Collection
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight">Collection Creator</h2>
                    <p className="text-muted mt-1 flex items-center gap-2 text-sm md:text-base">
                        <Plus className="w-5 h-5 text-plex" />
                        Create and sync collections from external sources or your library
                    </p>
                </div>
            </div>

            {/* Global Creation Settings — stay in document flow (sticky overlapped cards on scroll) */}
            <section className="bg-card/60 border border-border p-4 md:p-6 rounded-2xl flex flex-col xl:flex-row xl:items-center justify-between gap-4 md:gap-6 shadow-xl relative z-10">
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 md:gap-6 w-full xl:w-auto">
                    <div className="hidden sm:flex items-center gap-4">
                        <div className="bg-plex/20 p-3 rounded-xl text-plex">
                            <ListMusic className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-text whitespace-nowrap">Target Library</h3>
                            <p className="text-sm text-muted">Creation destination</p>
                        </div>
                    </div>
                    <CustomSelect
                        label="Target Library"
                        className="w-full sm:w-56"
                        value={targetLibrary}
                        options={librarySelectOptions}
                        onChange={setTargetLibrary}
                        placeholder="Select a library..."
                    />
                    {!librarySelectOptions.length ? (
                        <p className="text-xs text-amber-200 sm:max-w-xs">
                            No Plex libraries available. Add libraries under ColleXions Settings, or connect Plex in Media Player settings.
                        </p>
                    ) : null}
                </div>

                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 md:gap-6 w-full xl:w-auto xl:border-l xl:border-border xl:pl-6">
                    <div className="hidden sm:flex items-center gap-4">
                        <div className="bg-plex/20 p-3 rounded-xl text-plex">
                            <Sparkles className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-text whitespace-nowrap">Sort Order</h3>
                            <p className="text-sm text-muted">Random reshuffles every time the collection is opened (Kometa-style label smart collection).</p>
                        </div>
                    </div>
                    <CustomSelect
                        label="Sort Order"
                        className="w-full sm:w-48"
                        value={sortOrder}
                        options={[
                            { value: 'custom', label: 'Manual (Default)' },
                            { value: 'random', label: 'Random 🎲' },
                            { value: 'release', label: 'Release Date 📅' }
                        ]}
                        onChange={setSortOrder}
                    />
                </div>

                <div className="flex items-center justify-between gap-3 w-full xl:w-auto xl:border-l xl:border-border xl:pl-6">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="hidden sm:flex bg-emerald-500/20 p-3 rounded-xl text-emerald-400">
                            <Clock className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm sm:text-lg font-bold text-text whitespace-nowrap">Auto-Sync</h3>
                            <p className="text-xs sm:text-sm text-muted">Sync every 6 hours</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setAutoSync(!autoSync)}
                        className={`shrink-0 px-5 py-2 rounded-xl border font-bold transition-all ${autoSync ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-background/60 border-border text-muted'}`}
                    >
                        {autoSync ? 'Enabled' : 'Disabled'}
                    </button>
                </div>
            </section>

            {/* Mobile: mode dropdown · Desktop: tab row */}
            <div className="md:hidden">
                <CustomSelect
                    label="Creator mode"
                    className="w-full"
                    value={activeSubTab}
                    options={CREATOR_TABS.map((t) => ({ value: t.id, label: t.label }))}
                    onChange={(v) => setActiveSubTab(v as CreatorTab)}
                />
            </div>
            <div className="hidden md:flex border-b border-border overflow-x-auto no-scrollbar">
                {CREATOR_TABS.map((tab) => {
                    const icon = {
                        templates: <LayoutTemplate className="w-4 h-4" />,
                        trending: <Globe className="w-4 h-4" />,
                        discover: <Compass className="w-4 h-4" />,
                        search: <Search className="w-4 h-4" />,
                        import: <ExternalLink className="w-4 h-4" />,
                        manual: <ListMusic className="w-4 h-4" />,
                    }[tab.id];
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveSubTab(tab.id)}
                            className={`px-6 py-4 font-medium transition-all border-b-2 whitespace-nowrap text-sm flex items-center gap-2 ${activeSubTab === tab.id ? 'text-plex border-plex bg-card/30' : 'text-muted border-transparent hover:text-text hover:bg-white/5'
                                }`}
                        >
                            {icon}
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <div className="grid gap-6 relative z-0">
                {activeSubTab === 'templates' && (
                    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                        <div className="rounded-2xl border border-border bg-card/40 p-5 space-y-3">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-text flex items-center gap-2">
                                        <LayoutTemplate className="w-5 h-5 text-plex" />
                                        One-click collections
                                    </h3>
                                    <p className="text-sm text-muted mt-1">
                                        Creates a real Plex collection from titles you already own, and registers an auto-sync Job.
                                        {selectedLibraryMedia && matchLibraryMedia
                                            ? ` Showing ${selectedLibraryMedia === 'show' ? 'TV' : 'movie'} templates for your selected library.`
                                            : ''}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider">
                                    <span className={`px-2 py-1 rounded-lg border ${templateKeys.tmdb ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-border text-muted'}`}>
                                        TMDB {templateKeys.tmdb ? 'ready' : 'missing'}
                                    </span>
                                    <span className={`px-2 py-1 rounded-lg border ${templateKeys.trakt ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-border text-muted'}`}>
                                        Trakt {templateKeys.trakt ? 'ready' : 'missing'}
                                    </span>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setTemplateCategory('all')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${templateCategory === 'all' ? 'bg-plex/20 border-plex/40 text-plex' : 'border-border text-muted hover:text-text'}`}
                                >
                                    All
                                </button>
                                {templateCategories.map((cat) => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => setTemplateCategory(cat.id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${templateCategory === cat.id ? 'bg-plex/20 border-plex/40 text-plex' : 'border-border text-muted hover:text-text'}`}
                                    >
                                        {cat.label}
                                    </button>
                                ))}
                                {selectedLibraryMedia && (
                                    <button
                                        type="button"
                                        onClick={() => setMatchLibraryMedia((v) => !v)}
                                        className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                            matchLibraryMedia
                                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                                : 'border-border text-muted hover:text-text'
                                        }`}
                                        title={matchLibraryMedia ? 'Currently hiding the other media type' : 'Matching library type pinned to the top'}
                                    >
                                        {matchLibraryMedia
                                            ? `${selectedLibraryMedia === 'show' ? 'TV' : 'Movies'} only`
                                            : 'Show all media'}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {filteredTemplates.map((tpl) => {
                                const busy = creatingTemplateId === tpl.id;
                                return (
                                    <div
                                        key={tpl.id}
                                        className={`bg-card/50 border rounded-2xl p-5 flex flex-col justify-between shadow-lg transition-all ${tpl.available ? 'border-border hover:border-plex/30' : 'border-border/60 opacity-70'}`}
                                    >
                                        <div>
                                            <div className="flex items-center justify-between gap-2 mb-3">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-plex bg-plex/10 px-2 py-1 rounded-md border border-plex/20">
                                                    {tpl.category}
                                                </span>
                                                <span className="text-[10px] font-bold uppercase text-muted">
                                                    {tpl.media}
                                                </span>
                                            </div>
                                            <h3 className="text-lg font-bold text-text">{tpl.name}</h3>
                                            <p className="text-muted text-sm mt-2 leading-relaxed">{tpl.description}</p>
                                            {!tpl.available && (
                                                <p className="text-amber-300/90 text-xs mt-3">
                                                    Needs {(tpl.requires || []).join(' + ')} key in Settings.
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void handleCreateTemplate(tpl)}
                                            disabled={creating || !targetLibrary || !tpl.available}
                                            className="mt-5 w-full bg-plex hover:bg-plex-hover text-background py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                                        >
                                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                            {busy ? 'Creating…' : 'Create in Plex'}
                                        </button>
                                    </div>
                                );
                            })}
                            {filteredTemplates.length === 0 && (
                                <div className="md:col-span-2 xl:col-span-3 text-center text-muted py-10 border border-dashed border-border rounded-2xl space-y-3">
                                    <p>
                                        {selectedLibraryMedia && matchLibraryMedia
                                            ? `No ${selectedLibraryMedia === 'show' ? 'TV' : 'movie'} templates in this category.`
                                            : 'No templates in this category.'}
                                    </p>
                                    {selectedLibraryMedia && matchLibraryMedia && (
                                        <button
                                            type="button"
                                            onClick={() => setMatchLibraryMedia(false)}
                                            className="text-plex text-sm font-bold hover:underline"
                                        >
                                            Show all media types
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        <Card title="Search any franchise">
                            <div className="space-y-4">
                                <p className="text-sm text-muted">
                                    Find a TMDB movie collection (e.g. “Matrix”, “Batman”, “Despicable Me”) and create it as a managed Job.
                                    {selectedLibraryMedia === 'show' && (
                                        <span className="block mt-1 text-amber-300/90">
                                            Franchises are movie collections — switch Target Library to a Movies library to create them.
                                        </span>
                                    )}
                                </p>
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <input
                                        value={franchiseQuery}
                                        onChange={(e) => setFranchiseQuery(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') void handleFranchiseSearch(); }}
                                        placeholder="Search franchises…"
                                        className="flex-1 bg-background/60 border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-plex/50"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void handleFranchiseSearch()}
                                        disabled={searchingFranchises || !franchiseQuery.trim() || !templateKeys.tmdb}
                                        className="px-5 py-2.5 rounded-xl bg-card border border-border font-bold text-sm text-text hover:border-plex/40 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {searchingFranchises ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                        Search
                                    </button>
                                </div>
                                {!templateKeys.tmdb && (
                                    <p className="text-xs text-amber-300/90">Add a TMDB API key in Settings to search franchises.</p>
                                )}
                                {franchiseResults.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {franchiseResults.map((fr) => {
                                            const id = `franchise-${fr.source_id}`;
                                            const busy = creatingTemplateId === id;
                                            return (
                                                <div key={fr.id} className="flex gap-3 border border-border rounded-xl p-3 bg-background/40">
                                                    <div className="w-14 h-20 rounded-lg overflow-hidden bg-card shrink-0 border border-border">
                                                        {fr.poster ? (
                                                            <img src={fr.poster} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-muted text-[10px]">N/A</div>
                                                        )}
                                                    </div>
                                                    <div className="min-w-0 flex-1 flex flex-col">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <h4 className="font-bold text-text text-sm truncate min-w-0">{fr.name}</h4>
                                                            {typeof fr.film_count === 'number' && (
                                                                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-plex/15 text-plex border border-plex/30">
                                                                    {fr.film_count} {fr.film_count === 1 ? 'film' : 'films'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-muted mt-1 line-clamp-2 flex-1">{fr.overview || 'TMDB franchise collection'}</p>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleCreateFranchise(fr)}
                                                            disabled={creating || !targetLibrary}
                                                            className="mt-2 self-start text-xs font-bold px-3 py-1.5 rounded-lg bg-plex/20 text-plex border border-plex/30 hover:bg-plex/30 disabled:opacity-50 flex items-center gap-1.5"
                                                        >
                                                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                                            Create
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>
                )}

                {activeSubTab === 'trending' && (
                    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                        {!hasKeys ? (
                            <Card title="Global Trending Integration">
                                <div className="bg-card/50 border border-border p-8 rounded-2xl text-center space-y-4">
                                    <Globe className="w-12 h-12 text-muted mx-auto" />
                                    <div className="max-w-md mx-auto">
                                        <h3 className="text-lg font-bold text-text">External Integration Required</h3>
                                        <p className="text-muted text-sm mt-2">Add your API keys in Settings to see what's trending.</p>
                                    </div>
                                </div>
                            </Card>
                        ) : (
                            <div className="space-y-4">
                                {selectedLibraryMedia && (
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-sm text-muted">
                                            {matchLibraryMedia
                                                ? `Showing ${selectedLibraryMedia === 'show' ? 'TV' : 'movie'} trending for “${targetLibrary}”.`
                                                : 'Showing all trending — library type pinned first.'}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setMatchLibraryMedia((v) => !v)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                                matchLibraryMedia
                                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                                    : 'border-border text-muted hover:text-text'
                                            }`}
                                        >
                                            {matchLibraryMedia
                                                ? `${selectedLibraryMedia === 'show' ? 'TV' : 'Movies'} only`
                                                : 'Show all media'}
                                        </button>
                                    </div>
                                )}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {filteredTrendingPresets.map(preset => (
                                    <div key={preset.id} className="bg-card/50 border border-border p-6 rounded-2xl flex flex-col justify-between hover:border-plex/30 transition-all group shadow-lg">
                                        <div>
                                            <div className="flex items-center justify-between mb-4">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-plex bg-plex/10 px-2 py-1 rounded-md border border-plex/20">
                                                    {preset.source}
                                                </span>
                                                <span className="text-xs text-muted font-medium">{preset.items.length} titles</span>
                                            </div>
                                            <h3 className="text-xl font-bold text-text group-hover:text-plex transition-colors">{preset.name}</h3>
                                            <p className="text-muted text-sm mt-2 leading-relaxed">{preset.description}</p>

                                            <div
                                                className="mt-6 flex flex-wrap gap-3 cursor-pointer p-2 -m-2 rounded-xl hover:bg-white/5 transition-colors"
                                                onClick={() => setViewingPreset(preset)}
                                            >
                                                {preset.items.slice(0, 5).map((itm: any, idx: number) => (
                                                    <div key={idx} className="w-12 h-18 bg-card rounded-lg overflow-hidden ring-1 ring-border shadow-sm transition-transform group-hover:scale-105">
                                                        {itm.poster && <img src={itm.poster} alt="" className="w-full h-full object-cover" />}
                                                    </div>
                                                ))}
                                                {preset.items.length > 5 && (
                                                    <div className="w-12 h-18 bg-white/5 rounded-lg flex items-center justify-center text-[10px] font-bold text-muted border border-border transition-transform group-hover:scale-105">
                                                        +{preset.items.length - 5}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => handleCreatePreset(preset)}
                                            disabled={creating || !targetLibrary}
                                            className="mt-8 w-full bg-plex hover:bg-plex-hover text-background py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:hover:bg-plex shadow-md transform group-hover:-translate-y-1"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            Create Collection
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {filteredTrendingPresets.length === 0 && (
                                <div className="text-center text-muted py-10 border border-dashed border-border rounded-2xl space-y-3">
                                    <p>No trending presets for this library type.</p>
                                    <button
                                        type="button"
                                        onClick={() => setMatchLibraryMedia(false)}
                                        className="text-plex text-sm font-bold hover:underline"
                                    >
                                        Show all media types
                                    </button>
                                </div>
                            )}
                            </div>
                        )}
                    </div>
                )}

                {activeSubTab === 'discover' && (
                    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                        <Card title="Discover Curated Collections">
                            <div className="mb-4 space-y-2">
                                <p className="text-xs text-muted font-medium uppercase tracking-wide">Quick presets</p>
                                <div className="flex flex-wrap gap-2">
                                    {DISCOVER_PRESETS.map((preset) => (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => applyDiscoverPreset(preset)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                                activeDiscoverPreset === preset.id
                                                    ? 'border-plex bg-plex/15 text-plex'
                                                    : 'border-border bg-background/40 text-text hover:border-plex/40'
                                            }`}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                <div className="relative z-50">
                                    <CustomSelect
                                        label="Media Type"
                                        value={discoverType}
                                        onChange={v => setDiscoverType(v as 'movie' | 'tv')}
                                        options={[
                                            { value: 'movie', label: 'Movies' },
                                            { value: 'tv', label: 'TV Shows' }
                                        ]}
                                    />
                                </div>

                                <div className="relative z-40">
                                    <CustomSelect
                                        label="Genre"
                                        value={selectedGenre}
                                        onChange={setSelectedGenre}
                                        options={genreOptions}
                                    />
                                </div>

                                <div className="relative z-[39]">
                                    <CustomSelect
                                        label="Also Genre (AND)"
                                        value={selectedGenreAnd}
                                        onChange={setSelectedGenreAnd}
                                        options={[
                                            { value: '', label: 'None' },
                                            ...genreOptions.filter((o) => o.value),
                                        ]}
                                    />
                                </div>

                                <div className="relative z-[38]">
                                    <CustomSelect
                                        label="Exclude Genre"
                                        value={excludeGenre}
                                        onChange={setExcludeGenre}
                                        options={[
                                            { value: '', label: 'None' },
                                            ...genreOptions.filter((o) => o.value),
                                        ]}
                                    />
                                </div>

                                <div className="relative z-30">
                                    <CustomSelect
                                        label="Sort By"
                                        value={discoverSort}
                                        onChange={setDiscoverSort}
                                        options={discoverType === 'tv' ? DISCOVER_TV_SORT : DISCOVER_MOVIE_SORT}
                                    />
                                </div>

                                {discoverType === 'tv' ? (
                                    <div className="relative z-20">
                                        <CustomSelect
                                            label="Network"
                                            value={discoverNetwork}
                                            onChange={setDiscoverNetwork}
                                            options={networkOptions}
                                        />
                                    </div>
                                ) : (
                                    <div className="relative z-20">
                                        <CustomSelect
                                            label="Studio / Company"
                                            value={discoverCompany}
                                            onChange={setDiscoverCompany}
                                            options={studioOptions}
                                        />
                                    </div>
                                )}

                                <div className="relative z-10">
                                    <CustomSelect
                                        label="Language"
                                        value={discoverLanguage}
                                        onChange={setDiscoverLanguage}
                                        options={DISCOVER_LANGUAGE_OPTIONS}
                                    />
                                </div>

                                {discoverType === 'movie' ? (
                                    <div className="relative z-[9]">
                                        <CustomSelect
                                            label="US Content Rating"
                                            value={discoverCertification}
                                            onChange={setDiscoverCertification}
                                            options={DISCOVER_CERT_OPTIONS}
                                        />
                                    </div>
                                ) : (
                                    <div className="relative z-[9]">
                                        <CustomSelect
                                            label="Series Status"
                                            value={discoverStatus}
                                            onChange={setDiscoverStatus}
                                            options={[
                                                { value: '', label: 'Any Status' },
                                                ...TV_STATUS_OPTIONS,
                                            ]}
                                        />
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    <label className="block text-sm font-medium text-text">Year Range</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number" placeholder="From"
                                            className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted"
                                            value={discoverYearFrom} onChange={e => { setDiscoverYearFrom(e.target.value); setActiveDiscoverPreset(null); }}
                                        />
                                        <input
                                            type="number" placeholder="To"
                                            className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted"
                                            value={discoverYearTo} onChange={e => { setDiscoverYearTo(e.target.value); setActiveDiscoverPreset(null); }}
                                        />
                                    </div>
                                    <p className="text-[11px] text-muted">Use the same year in both for an exact match. Leave blank for any year.</p>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="block text-sm font-medium text-text">Include Keywords</label>
                                    <input
                                        type="text" placeholder="e.g. superhero, based on novel"
                                        className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted font-mono"
                                        value={discoverKeywords} onChange={e => setDiscoverKeywords(e.target.value)}
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="block text-sm font-medium text-text">Exclude Keywords</label>
                                    <input
                                        type="text" placeholder="e.g. anthology, remake"
                                        className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted font-mono"
                                        value={discoverExcludeKeywords} onChange={e => setDiscoverExcludeKeywords(e.target.value)}
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="block text-sm font-medium text-text">Rating (0–10)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number" step="0.1" min="0" max="10" placeholder="Min"
                                            className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted"
                                            value={discoverRating} onChange={e => setDiscoverRating(e.target.value)}
                                        />
                                        <input
                                            type="number" step="0.1" min="0" max="10" placeholder="Max"
                                            className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted"
                                            value={discoverRatingMax} onChange={e => setDiscoverRatingMax(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="block text-sm font-medium text-text">Vote Count</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number" step="10" min="0" placeholder="Min"
                                            className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted"
                                            value={discoverVoteCount} onChange={e => setDiscoverVoteCount(e.target.value)}
                                        />
                                        <input
                                            type="number" step="10" min="0" placeholder="Max"
                                            className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted"
                                            value={discoverVoteCountMax} onChange={e => setDiscoverVoteCountMax(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="block text-sm font-medium text-text">Runtime (minutes)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number" step="5" min="0" placeholder="Min"
                                            className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted"
                                            value={discoverRuntimeMin} onChange={e => setDiscoverRuntimeMin(e.target.value)}
                                        />
                                        <input
                                            type="number" step="5" min="0" placeholder="Max"
                                            className="w-full bg-background/60 border border-border rounded-lg px-3 py-2 text-text focus:outline-none focus:border-plex/50 transition-all placeholder:text-muted"
                                            value={discoverRuntimeMax} onChange={e => setDiscoverRuntimeMax(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="md:col-span-2 lg:col-span-3 flex items-end">
                                    <button onClick={handleDiscover} disabled={discovering} className="w-full bg-plex hover:bg-plex-hover text-text px-8 py-3 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 transition-transform active:scale-[0.98]">
                                        <Filter className="w-5 h-5" /> Search TMDb
                                    </button>
                                </div>
                            </div>
                        </Card>

                        {discoverResults.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 relative -z-10">
                                {discoverResults.map(item => {
                                    const isSelected = !!selectionPool.find(p => p.id === item.id);
                                    return (
                                        <div
                                            key={item.id}
                                            onClick={() => toggleSelection(item)}
                                            className={`group relative aspect-[2/3] rounded-2xl border-2 overflow-hidden cursor-pointer transition-all duration-300 ${isSelected
                                                ? 'border-plex shadow-[0_0_20px_rgba(231,155,23,0.2)]'
                                                : 'border-border hover:border-border'
                                                }`}
                                        >
                                            <img
                                                src={item.poster}
                                                alt=""
                                                className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 ${isSelected ? 'opacity-60' : ''}`}
                                            />
                                            <div className={`absolute inset-0 flex flex-col justify-end p-3 bg-gradient-to-t from-black/90 via-black/20 to-transparent transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                                <h4 className="text-sm font-bold text-text truncate">{item.title}</h4>
                                                <p className="text-[10px] text-muted font-medium uppercase">{item.year}</p>
                                            </div>
                                            {isSelected && (
                                                <div className="absolute top-2 right-2 bg-plex text-background p-1 rounded-lg shadow-lg">
                                                    <Plus className="w-4 h-4" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {discoverResults.length > 0 && (
                            <div className="px-1 space-y-4">
                                <div>
                                    <label className="text-sm text-muted mb-2 block font-medium">Collection Title</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Best Sci-Fi Movies..."
                                        className="w-full md:w-96 bg-background/60 border border-border rounded-xl px-4 py-3 text-text focus:outline-none focus:border-plex/50 transition-colors"
                                        value={collectionTitle}
                                        onChange={e => setCollectionTitle(e.target.value)}
                                    />
                                    <p className="text-xs text-muted mt-2">Set a Title & Target Library, then click to Create & Auto-Sync.</p>
                                </div>
                                <button
                                    onClick={() => handleCreateFromExternal()}
                                    disabled={creating || !targetLibrary || !collectionTitle}
                                    className="bg-plex hover:bg-plex-hover text-text px-8 py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 w-full md:w-auto"
                                >
                                    <Sparkles className="w-5 h-5" />
                                    {creating ? 'Creating...' : 'Create Auto-Syncing Collection'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeSubTab === 'search' && (
                    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                        <Card title="Global Content Search">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                                    <input className="appearance-none text-[16px] leading-5 w-full bg-background/60 border border-border rounded-lg pl-10 pr-4 py-2 text-[16px] text-text focus:outline-none focus:border-plex/50" placeholder="Search TMDb..." value={externalQuery} onChange={(e) => setExternalQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleExternalSearch()} />
                                </div>
                                <button onClick={handleExternalSearch} disabled={searchingExternal || !externalQuery} className="bg-card hover:bg-white/10 text-text px-6 py-2 rounded-lg border border-border disabled:opacity-50">Search</button>
                            </div>
                        </Card>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {externalResults.map(item => (
                                <div key={item.id} className="bg-card/50 border border-border rounded-2xl overflow-hidden group hover:border-plex/40 transition-all">
                                    <div className="aspect-[2/3] relative">
                                        {item.poster && <img src={item.poster} alt="" className="w-full h-full object-cover" />}
                                        <button onClick={() => setImportedItems(prev => [...prev, item])} className="absolute top-3 right-3 p-2 bg-card/80 backdrop-blur-md rounded-xl text-text opacity-0 group-hover:opacity-100 transition-all hover:bg-plex"><Plus className="w-5 h-5" /></button>
                                    </div>
                                    <div className="p-4">
                                        <h4 className="font-bold text-text truncate">{item.title}</h4>
                                        <p className="text-xs text-muted mt-1 uppercase">{item.year} • {item.type}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeSubTab === 'import' && (
                    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                        <Card title="Search Trakt lists">
                            <div className="space-y-4">
                                <p className="text-sm text-muted">
                                    Find a public Trakt list (e.g. “Oscar winners”, “Marvel”) and create a managed Plex collection from it.
                                </p>
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                                        <input
                                            className="appearance-none text-[16px] leading-5 w-full bg-background/60 border border-border rounded-lg pl-10 pr-4 py-2 text-[16px] text-text focus:outline-none focus:border-plex/50"
                                            placeholder="Search Trakt lists…"
                                            value={traktListQuery}
                                            onChange={(e) => setTraktListQuery(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') void handleTraktListSearch(); }}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleTraktListSearch()}
                                        disabled={searchingTraktLists || !traktListQuery.trim()}
                                        className="px-5 py-2 rounded-lg bg-card border border-border font-bold text-sm text-text hover:border-plex/40 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {searchingTraktLists ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                        Search
                                    </button>
                                </div>
                                {!templateKeys.trakt && !config?.trakt_client_id && (
                                    <p className="text-xs text-amber-300/90">Add a Trakt client ID in Settings to search lists.</p>
                                )}
                                {traktListResults.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {traktListResults.map((list) => {
                                            const busy = loadingTraktListUrl === list.url;
                                            return (
                                                <div key={list.url} className="border border-border rounded-xl p-4 bg-background/40 flex flex-col gap-3">
                                                    <div className="min-w-0">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <h4 className="font-bold text-text text-sm truncate">{list.name}</h4>
                                                            {typeof list.item_count === 'number' && (
                                                                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-300 border border-red-500/30">
                                                                    {list.item_count} titles
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-muted mt-1">
                                                            by <span className="text-text/80">{list.username}</span>
                                                            {typeof list.likes === 'number' ? ` · ${list.likes} likes` : ''}
                                                        </p>
                                                        {list.description && (
                                                            <p className="text-xs text-muted mt-2 line-clamp-2">{list.description}</p>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 mt-auto">
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleSelectTraktList(list)}
                                                            disabled={!!loadingTraktListUrl}
                                                            className="flex-1 px-3 py-2 rounded-lg border border-border text-xs font-bold text-muted hover:text-text hover:border-plex/40 disabled:opacity-50 flex items-center justify-center gap-1.5"
                                                        >
                                                            {busy && !creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                                            {busy && !creating ? 'Loading…' : 'Preview'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleCreateTraktList(list)}
                                                            disabled={!!loadingTraktListUrl || !targetLibrary}
                                                            className="flex-1 px-3 py-2 rounded-lg bg-plex hover:bg-plex-hover text-background text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
                                                        >
                                                            {busy && creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                                            {busy && creating ? 'Creating…' : 'Create in Plex'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card title="Or paste a Trakt / MDBList URL">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <ExternalLink className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                                    <input className="appearance-none text-[16px] leading-5 w-full bg-background/60 border border-border rounded-lg pl-10 pr-4 py-2 text-[16px] text-text focus:outline-none focus:border-plex/50" placeholder="Trakt or MDBList URL..." value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleListImport()} />
                                </div>
                                <button onClick={handleListImport} disabled={importing || !importUrl} className="bg-plex hover:bg-plex-hover text-text px-6 py-2 rounded-lg font-bold disabled:opacity-50">Fetch</button>
                            </div>
                        </Card>
                        {importedItems.length > 0 && (
                            <>
                                <Card
                                    title={`Import Preview (${importedItems.length} items)`}
                                    actions={
                                        <button
                                            onClick={() => setImportedItems([])}
                                            className="p-1.5 hover:bg-white/5 rounded-lg text-muted hover:text-text transition-all"
                                            title="Clear Import"
                                        >
                                            <Plus className="w-5 h-5 rotate-45" />
                                        </button>
                                    }
                                >
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
                                        {importedItems.map((item, idx) => (
                                            <div key={idx} className="p-3 bg-background/30 border border-border rounded-xl flex items-center justify-between group">
                                                <div className="min-w-0"><h4 className="text-sm font-bold text-text truncate">{item.title}</h4><p className="text-xs text-muted">{item.year} • {item.type}</p></div>
                                                <button onClick={() => setImportedItems(prev => prev.filter((_, i) => i !== idx))} className="text-muted hover:text-red-400 opacity-0 group-hover:opacity-100"><Plus className="w-4 h-4 rotate-45" /></button>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                                <div className="px-1 space-y-4">
                                    <div>
                                        <label className="text-sm text-muted mb-2 block font-medium">Collection Title</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. Oscar Winners..."
                                            className="w-full md:w-96 bg-background/60 border border-border rounded-xl px-4 py-3 text-text focus:outline-none focus:border-plex/50 transition-colors"
                                            value={collectionTitle}
                                            onChange={(e) => setCollectionTitle(e.target.value)}
                                        />
                                        <p className="text-xs text-muted mt-2">Creates a Plex collection from titles you already own{autoSync ? ', and registers an auto-sync Job.' : '.'}</p>
                                    </div>
                                    {!targetLibrary && librarySelectOptions.length > 0 ? (
                                        <div className="max-w-md">
                                            <CustomSelect
                                                label="Target Library"
                                                className="w-full"
                                                value={targetLibrary}
                                                options={librarySelectOptions}
                                                onChange={setTargetLibrary}
                                                placeholder="Select a library..."
                                            />
                                        </div>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={() => void handleCreateFromExternal()}
                                        disabled={creating || !targetLibrary || !collectionTitle.trim() || importedItems.length === 0}
                                        className="bg-plex hover:bg-plex-hover text-text px-8 py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto"
                                    >
                                        <Sparkles className="w-5 h-5" />
                                        {creating ? 'Creating...' : 'Create Auto-Syncing Collection'}
                                    </button>
                                    {!creating && (!targetLibrary || !collectionTitle.trim() || importedItems.length === 0) ? (
                                        <p className="text-xs text-amber-200/90">
                                            {!librarySelectOptions.length
                                                ? 'Add a Plex library in ColleXions Settings first.'
                                                : !targetLibrary
                                                    ? 'Choose a target library above (or in the creation settings bar).'
                                                    : !collectionTitle.trim()
                                                        ? 'Enter a collection title — we auto-fill this from the list URL when you Fetch.'
                                                        : 'Fetch a list to continue.'}
                                        </p>
                                    ) : null}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {activeSubTab === 'manual' && (
                    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                        <Card title="1. Search Library Items">
                            <div className="flex flex-col gap-4">
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                                        <input
                                            className="appearance-none text-[16px] leading-5 w-full bg-background/60 border border-border rounded-lg pl-10 pr-4 py-2 text-[16px] text-text focus:outline-none focus:border-plex/50"
                                            placeholder="Search title..."
                                            value={localSearchQuery}
                                            onChange={(e) => setLocalSearchQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleLocalSearch()}
                                        />
                                    </div>
                                    <button
                                        onClick={handleLocalSearch}
                                        disabled={searching || !targetLibrary || (!localSearchQuery && !localSearchYear && !localSearchGenre)}
                                        className="bg-card hover:bg-white/10 text-text px-6 py-2 rounded-lg font-bold disabled:opacity-50 transition-all border border-border"
                                    >
                                        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs text-muted font-medium ml-1">Year</label>
                                        <input
                                            type="number"
                                            placeholder="e.g. 2024"
                                            className="appearance-none text-[16px] leading-5 w-full bg-background/60 border border-border rounded-lg px-4 py-2 text-[16px] text-text focus:outline-none focus:border-plex/50"
                                            value={localSearchYear}
                                            onChange={(e) => setLocalSearchYear(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs text-muted font-medium ml-1">Genre</label>
                                        <input
                                            placeholder="e.g. Action"
                                            className="appearance-none text-[16px] leading-5 w-full bg-background/60 border border-border rounded-lg px-4 py-2 text-[16px] text-text focus:outline-none focus:border-plex/50"
                                            value={localSearchGenre}
                                            onChange={(e) => setLocalSearchGenre(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </Card>

                        {localResults.length > 0 && (
                            <Card
                                title="2. Pick Items to Add"
                                actions={
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                const toAdd = localResults.filter(r => !selectionPool.find(p => p.ratingKey === r.ratingKey));
                                                setSelectionPool(prev => [...prev, ...toAdd]);
                                            }}
                                            className="text-xs bg-card hover:bg-white/10 text-text px-3 py-1.5 rounded-lg border border-border transition-all font-medium"
                                        >
                                            Select All
                                        </button>
                                        <button
                                            onClick={() => {
                                                const resultKeys = localResults.map(r => r.ratingKey);
                                                setSelectionPool(prev => prev.filter(p => !resultKeys.includes(p.ratingKey)));
                                            }}
                                            className="text-xs bg-card hover:bg-white/10 text-text px-3 py-1.5 rounded-lg border border-border transition-all font-medium"
                                        >
                                            Clear Results
                                        </button>
                                    </div>

                                }
                            >
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                    {localResults.map(item => {
                                        const isSelected = !!selectionPool.find(p => p.ratingKey === item.ratingKey);
                                        return (
                                            <div
                                                key={item.ratingKey}
                                                onClick={() => toggleSelection(item)}
                                                className={`group relative aspect-[2/3] rounded-2xl border-2 overflow-hidden cursor-pointer transition-all duration-300 ${isSelected
                                                    ? 'border-plex shadow-[0_0_20px_rgba(231,155,23,0.2)]'
                                                    : 'border-border hover:border-border'
                                                    }`}
                                            >
                                                {item.thumb ? (
                                                    <img
                                                        src={collexionsImageUrl(item.thumb)}
                                                        alt=""
                                                        className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 ${isSelected ? 'opacity-60' : ''}`}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full bg-card flex items-center justify-center">
                                                        <Search className="w-8 h-8 text-muted" />
                                                    </div>
                                                )}

                                                <div className={`absolute inset-0 flex flex-col justify-end p-3 bg-gradient-to-t from-black/90 via-black/20 to-transparent transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                                    <h4 className="text-sm font-bold text-text truncate">{item.title}</h4>
                                                    <p className="text-[10px] text-muted font-medium uppercase">{item.year} • {item.type}</p>
                                                </div>

                                                {isSelected && (
                                                    <div className="absolute top-2 right-2 bg-plex text-background p-1 rounded-lg shadow-lg">
                                                        <Plus className="w-4 h-4" />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                </div>
                            </Card>
                        )}
                    </div>
                )}
            </div>

            {showPoolDetails && selectionPool.length > 0 && (
                <div className="fixed inset-x-0 bottom-[120px] max-w-2xl mx-auto px-4 z-[45] animate-in slide-in-from-bottom-4">
                    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xl">
                        <div className="p-4 border-b border-border flex justify-between items-center bg-white/5">
                            <h4 className="font-bold text-text flex items-center gap-2 text-sm">
                                <List className="w-4 h-4 text-plex" />
                                Current Selection ({selectionPool.length})
                            </h4>
                            <button onClick={() => setSelectionPool([])} className="text-[10px] text-muted hover:text-red-400 transition-colors uppercase font-bold tracking-wider">
                                Clear All
                            </button>
                        </div>
                        <div className="max-h-60 overflow-y-auto p-2 custom-scrollbar grid grid-cols-1 gap-1">
                            {selectionPool.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5/80 transition-colors group">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-8 h-12 rounded bg-card flex-shrink-0 overflow-hidden">
                                            {item.poster || item.thumb ? (
                                                <img
                                                    src={item.poster || collexionsImageUrl(item.thumb)}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : <ListMusic className="w-4 h-4 m-2 text-muted" />}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-text truncate">{item.title}</p>
                                            <p className="text-[10px] text-muted uppercase">{item.year} • {item.type || (item.id ? 'External' : 'Library')}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleSelection(item)}
                                        className="p-1.5 text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {selectionPool.length > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-50 animate-in slide-in-from-bottom-8">
                    <div className="bg-card/90 backdrop-blur-xl border border-plex/30 p-4 rounded-2xl shadow-2xl flex flex-col sm:flex-row items-center gap-4">
                        <div className="flex-1 flex gap-4 items-center">
                            <div className="bg-plex/20 p-2 rounded-lg text-plex cursor-pointer hover:bg-plex/30 transition-colors" onClick={() => setShowPoolDetails(!showPoolDetails)}>
                                <ListMusic className={`w-6 h-6 transition-transform ${showPoolDetails ? 'rotate-180' : ''}`} />
                            </div>
                            <div>
                                <p className="text-text font-bold">{selectionPool.length} items selected</p>
                                <p className="text-xs text-muted">{targetLibrary ? `Library: ${targetLibrary}` : 'Select a library above'}</p>
                            </div>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                            <input className="appearance-none text-[16px] leading-5 flex-1 sm:w-48 bg-background/60 border border-border rounded-lg px-3 py-2 text-[16px] text-text focus:outline-none focus:border-plex/50" placeholder="Collection Title..." value={collectionTitle} onChange={(e) => setCollectionTitle(e.target.value)} />
                            <div className="flex gap-2">
                                <button onClick={handleCreate} disabled={creating || !collectionTitle || !targetLibrary} className="bg-plex hover:bg-plex-hover text-text px-6 py-2 rounded-lg font-bold disabled:opacity-50 flex items-center gap-2">
                                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                    Create
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectionPool([]);
                                        setCollectionTitle('');
                                        setShowPoolDetails(false);
                                    }}
                                    className="p-2 hover:bg-white/5 rounded-lg text-muted hover:text-text transition-all"
                                    title="Clear All"
                                >
                                    <Plus className="w-6 h-6 rotate-45" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
};

export default Creator;
