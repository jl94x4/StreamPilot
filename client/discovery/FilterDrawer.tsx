import React, { useMemo, useState } from 'react';
import { X, Filter, Sparkles } from 'lucide-react';
import { CustomSelect } from '../shared/ui';
import { DISCOVER_NETWORKS, DISCOVER_STUDIOS, MOVIE_GENRES, TV_GENRES } from './discoverConstants';
import { DISCOVER_LANGUAGE_OPTIONS, TV_STATUS_OPTIONS, US_CONTENT_RATINGS } from './discoverLanguages';
import { discoveryTheme } from './discoveryThemeClasses';
import { countActiveFilters } from './discoverUrlUtils';
import {
    AsyncTagSelect,
    CertificationToggles,
    ChipMultiSelect,
    DateRangeInputs,
    DualRangeSlider,
    FilterField,
    WatchProviderPicker,
    joinCsv,
    joinPipe,
    normalizeWatchRegion,
    optionsFromParallel,
    splitCsv,
    splitPipe,
    type FilterOption,
} from './filterControls';
import { useDiscoveryPreferences } from './useDiscoveryPreferences';
import { useDiscoverI18n } from './i18n';

export interface FilterState {
    sort: string;
    genre: string;
    /** @deprecated Prefer dateGte/dateLte; still parsed from old URLs. */
    year: string;
    dateGte: string;
    dateLte: string;
    network: string;
    networkName: string;
    studio: string;
    studioName: string;
    /** @deprecated Prefer voteAverageGte; still parsed from old URLs. */
    minRating: string;
    voteAverageGte: string;
    voteAverageLte: string;
    voteCountGte: string;
    voteCountLte: string;
    keywords: string;
    keywordName: string;
    excludeKeywords: string;
    excludeKeywordName: string;
    language: string;
    certification: string;
    withRuntimeGte: string;
    withRuntimeLte: string;
    watchProviders: string;
    watchRegion: string;
    status: string;
}

interface FilterDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'movie' | 'tv';
    filters: FilterState;
    onApply: (filters: FilterState) => void;
    onClear: () => void;
}

const MOVIE_SORT_OPTIONS = [
    { value: 'popularity.desc', label: 'Most Popular' },
    { value: 'vote_average.desc', label: 'Top Rated' },
    { value: 'vote_count.desc', label: 'Most Voted' },
    { value: 'revenue.desc', label: 'Highest Revenue' },
    { value: 'primary_release_date.desc', label: 'Release Date (Newest)' },
    { value: 'primary_release_date.asc', label: 'Release Date (Oldest)' },
];

const TV_SORT_OPTIONS = [
    { value: 'popularity.desc', label: 'Most Popular' },
    { value: 'vote_average.desc', label: 'Top Rated' },
    { value: 'vote_count.desc', label: 'Most Voted' },
    { value: 'first_air_date.desc', label: 'Premiere Date (Newest)' },
    { value: 'first_air_date.asc', label: 'Premiere Date (Oldest)' },
];

const SORT_LABEL_KEYS: Record<string, string> = {
    'popularity.desc': 'filters.mostPopular',
    'vote_average.desc': 'filters.topRated',
    'vote_count.desc': 'filters.mostVoted',
    'revenue.desc': 'filters.highestRevenue',
    'primary_release_date.desc': 'filters.releaseNewest',
    'primary_release_date.asc': 'filters.releaseOldest',
    'first_air_date.desc': 'filters.premiereNewest',
    'first_air_date.asc': 'filters.premiereOldest',
};

const PRESET_LABEL_KEYS: Record<string, string> = {
    'hidden-gems': 'filters.hiddenGems',
    'critically-acclaimed': 'filters.criticallyAcclaimed',
    fresh: 'filters.freshReleases',
    family: 'filters.familyNight',
    short: 'filters.shortWatch',
    binge: 'filters.bingeReady',
};

type FilterPreset = {
    id: string;
    label: string;
    apply: (type: 'movie' | 'tv') => Partial<FilterState>;
};

const FILTER_PRESETS: FilterPreset[] = [
    {
        id: 'hidden-gems',
        label: 'Hidden Gems',
        apply: () => ({
            sort: 'vote_average.desc',
            voteAverageGte: '7.5',
            voteAverageLte: '10',
            voteCountGte: '50',
            voteCountLte: '1500',
            minRating: '',
        }),
    },
    {
        id: 'critically-acclaimed',
        label: 'Critically Acclaimed',
        apply: () => ({
            sort: 'vote_average.desc',
            voteAverageGte: '8',
            voteAverageLte: '10',
            voteCountGte: '500',
            voteCountLte: '',
            minRating: '',
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
                dateGte: from.toISOString().slice(0, 10),
                dateLte: '',
                year: '',
            };
        },
    },
    {
        id: 'family',
        label: 'Family Night',
        apply: () => ({
            certification: 'G,PG',
            genre: '10751',
            voteAverageGte: '6',
            minRating: '',
        }),
    },
    {
        id: 'short',
        label: 'Short Watch',
        apply: () => ({
            withRuntimeGte: '0',
            withRuntimeLte: '100',
        }),
    },
    {
        id: 'binge',
        label: 'Binge Ready',
        apply: (mediaType) => (mediaType === 'tv'
            ? { status: '0', sort: 'popularity.desc' }
            : { sort: 'popularity.desc', voteCountGte: '200' }),
    },
];

const toNumber = (value: string, fallback: number) => {
    if (value === '' || value == null) return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

export const FilterDrawer: React.FC<FilterDrawerProps> = ({ isOpen, onClose, type, filters, onApply, onClear }) => {
    const { t } = useDiscoverI18n();
    const { preferences } = useDiscoveryPreferences();
    const [localFilters, setLocalFilters] = useState<FilterState>(filters);

    React.useEffect(() => {
        setLocalFilters(filters);
    }, [filters, isOpen]);

    const sortOptions = (type === 'movie' ? MOVIE_SORT_OPTIONS : TV_SORT_OPTIONS)
        .map((option) => ({
            ...option,
            label: t(SORT_LABEL_KEYS[option.value] || option.label),
        }));
    const genreOptions = useMemo(
        () => (type === 'movie' ? MOVIE_GENRES : TV_GENRES).map((genre) => ({
            value: String(genre.id),
            label: genre.name,
        })),
        [type],
    );

    const studioStatic = useMemo(
        () => DISCOVER_STUDIOS.map((studio) => ({ id: String(studio.id), label: studio.name })),
        [],
    );
    const networkStatic = useMemo(
        () => DISCOVER_NETWORKS.map((network) => ({ id: String(network.id), label: network.name })),
        [],
    );

    const activeCount = countActiveFilters(localFilters, type);

    const patch = (partial: Partial<FilterState>) => {
        setLocalFilters((prev) => ({ ...prev, ...partial }));
    };

    const selectedGenres = splitCsv(localFilters.genre);
    const keywordOptions = optionsFromParallel(localFilters.keywords, localFilters.keywordName);
    const excludeKeywordOptions = optionsFromParallel(localFilters.excludeKeywords, localFilters.excludeKeywordName);
    const studioOptions = localFilters.studio
        ? [{ id: localFilters.studio, label: localFilters.studioName || localFilters.studio }]
        : [];
    const networkOptions = localFilters.network
        ? [{ id: localFilters.network, label: localFilters.networkName || localFilters.network }]
        : [];
    const certificationSelected = splitCsv(localFilters.certification);
    const statusSelected = splitPipe(localFilters.status);
    const watchProviderIds = splitPipe(localFilters.watchProviders);

    const runtimeMin = toNumber(localFilters.withRuntimeGte, 0);
    const runtimeMax = toNumber(localFilters.withRuntimeLte, 400);
    const scoreMin = toNumber(localFilters.voteAverageGte || localFilters.minRating, 1);
    const scoreMax = toNumber(localFilters.voteAverageLte, 10);
    const voteMin = toNumber(localFilters.voteCountGte, 0);
    const voteMax = toNumber(localFilters.voteCountLte, 5000);

    const setKeywordOptions = (options: FilterOption[], exclude = false) => {
        if (exclude) {
            patch({
                excludeKeywords: joinCsv(options.map((option) => option.id)),
                excludeKeywordName: joinCsv(options.map((option) => option.label)),
            });
            return;
        }
        patch({
            keywords: joinCsv(options.map((option) => option.id)),
            keywordName: joinCsv(options.map((option) => option.label)),
        });
    };

    const handleApply = () => {
        onApply({
            ...localFilters,
            year: '',
            minRating: '',
            withRuntimeGte: runtimeMin <= 0 ? '' : String(runtimeMin),
            withRuntimeLte: runtimeMax >= 400 ? '' : String(runtimeMax),
            voteAverageGte: scoreMin <= 1 ? '' : String(scoreMin),
            voteAverageLte: scoreMax >= 10 ? '' : String(scoreMax),
            voteCountGte: voteMin <= 0 ? '' : String(voteMin),
            voteCountLte: voteMax >= 5000 ? '' : String(voteMax),
        });
        onClose();
    };

    const handleClear = () => {
        onClear();
        onClose();
    };

    const applyPreset = (preset: FilterPreset) => {
        const next = preset.apply(type);
        setLocalFilters((prev) => ({ ...prev, ...next }));
    };

    return (
        <>
            <div
                className={`${discoveryTheme.drawerOverlay} ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            />

            <div className={`${discoveryTheme.drawerPanel} ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className={discoveryTheme.drawerHeader}>
                    <div>
                        <h2 className={discoveryTheme.drawerTitle}>
                            <Filter className="w-6 h-6 text-plex" /> {t('filters.title')}
                        </h2>
                        <p className="text-xs text-muted mt-1 font-medium">
                            {t('filters.activeCount', { count: activeCount })}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-white/10 text-muted hover:text-text transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col gap-7">
                    <FilterField label={t('filters.quickPresets')} hint={t('filters.quickPresetsHint')}>
                        <div className="flex flex-wrap gap-2">
                            {FILTER_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => applyPreset(preset)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border border-border bg-white/5 text-muted hover:text-text hover:border-plex/50 transition-colors"
                                >
                                    <Sparkles className="w-3 h-3 text-plex" />
                                    {t(PRESET_LABEL_KEYS[preset.id] || preset.label)}
                                </button>
                            ))}
                        </div>
                    </FilterField>

                    <FilterField label={t('filters.sortBy')}>
                        <CustomSelect
                            value={localFilters.sort}
                            onChange={(sort) => patch({ sort })}
                            options={sortOptions}
                            className="w-full"
                        />
                    </FilterField>

                    <FilterField label={type === 'movie' ? t('filters.releaseDate') : t('filters.firstAirDate')}>
                        <DateRangeInputs
                            from={localFilters.dateGte}
                            to={localFilters.dateLte}
                            onFromChange={(dateGte) => patch({ dateGte, year: '' })}
                            onToChange={(dateLte) => patch({ dateLte, year: '' })}
                        />
                    </FilterField>

                    {type === 'movie' ? (
                        <FilterField label={t('filters.studio')}>
                            <AsyncTagSelect
                                mode="company"
                                values={studioOptions}
                                staticOptions={studioStatic}
                                placeholder={t('filters.searchStudios')}
                                onChange={(options) => {
                                    const next = options.slice(-1);
                                    patch({
                                        studio: next[0]?.id || '',
                                        studioName: next[0]?.label || '',
                                    });
                                }}
                            />
                        </FilterField>
                    ) : (
                        <FilterField label={t('filters.network')}>
                            <AsyncTagSelect
                                mode="company"
                                values={networkOptions}
                                staticOptions={networkStatic}
                                placeholder={t('filters.searchNetworks')}
                                onChange={(options) => {
                                    const next = options.slice(-1);
                                    patch({
                                        network: next[0]?.id || '',
                                        networkName: next[0]?.label || '',
                                    });
                                }}
                            />
                        </FilterField>
                    )}

                    <FilterField label={t('filters.genres')}>
                        <ChipMultiSelect
                            options={genreOptions}
                            selected={selectedGenres}
                            onChange={(values) => patch({ genre: joinCsv(values) })}
                        />
                    </FilterField>

                    {type === 'tv' && (
                        <FilterField label={t('filters.status')}>
                            <ChipMultiSelect
                                options={TV_STATUS_OPTIONS}
                                selected={statusSelected}
                                onChange={(values) => patch({ status: joinPipe(values) })}
                            />
                        </FilterField>
                    )}

                    <FilterField label={t('filters.keywords')}>
                        <AsyncTagSelect
                            mode="keyword"
                            values={keywordOptions}
                            placeholder={t('filters.searchKeywords')}
                            onChange={(options) => setKeywordOptions(options)}
                        />
                    </FilterField>

                    <FilterField label={t('filters.excludeKeywords')}>
                        <AsyncTagSelect
                            mode="keyword"
                            values={excludeKeywordOptions}
                            placeholder={t('filters.searchExcludeKeywords')}
                            onChange={(options) => setKeywordOptions(options, true)}
                        />
                    </FilterField>

                    <FilterField label={t('filters.originalLanguage')}>
                        <CustomSelect
                            value={localFilters.language}
                            onChange={(language) => patch({ language })}
                            options={DISCOVER_LANGUAGE_OPTIONS}
                            className="w-full"
                        />
                    </FilterField>

                    <FilterField label={t('filters.contentRating')} hint={t('filters.contentRatingHint')}>
                        <CertificationToggles
                            ratings={US_CONTENT_RATINGS}
                            selected={certificationSelected}
                            onChange={(values) => patch({ certification: joinCsv(values) })}
                        />
                    </FilterField>

                    <FilterField label={t('filters.runtime')}>
                        <DualRangeSlider
                            min={0}
                            max={400}
                            step={5}
                            valueMin={runtimeMin}
                            valueMax={runtimeMax}
                            onChange={(minValue, maxValue) => patch({
                                withRuntimeGte: String(minValue),
                                withRuntimeLte: String(maxValue),
                            })}
                            formatValue={(value) => `${value} min`}
                        />
                    </FilterField>

                    <FilterField label={t('filters.tmdbUserScore')}>
                        <DualRangeSlider
                            min={1}
                            max={10}
                            step={0.5}
                            valueMin={scoreMin}
                            valueMax={scoreMax}
                            onChange={(minValue, maxValue) => patch({
                                voteAverageGte: String(minValue),
                                voteAverageLte: String(maxValue),
                                minRating: '',
                            })}
                        />
                    </FilterField>

                    <FilterField label={t('filters.tmdbVoteCount')}>
                        <DualRangeSlider
                            min={0}
                            max={5000}
                            step={50}
                            valueMin={voteMin}
                            valueMax={voteMax}
                            onChange={(minValue, maxValue) => patch({
                                voteCountGte: String(minValue),
                                voteCountLte: String(maxValue),
                            })}
                            formatValue={(value) => t('filters.votes', { count: value })}
                        />
                    </FilterField>

                    <FilterField label={t('filters.streamingServices')}>
                        <WatchProviderPicker
                            type={type}
                            region={normalizeWatchRegion(
                                localFilters.watchRegion || preferences.discoverRegion || 'US',
                                preferences.discoverRegion || 'US',
                            )}
                            selectedIds={watchProviderIds}
                            onChange={(watchRegion, providerIds) => patch({
                                watchRegion: normalizeWatchRegion(watchRegion, 'US'),
                                watchProviders: joinPipe(providerIds),
                            })}
                        />
                    </FilterField>
                </div>

                <div className="px-5 py-4 border-t border-border bg-background/20 flex gap-3">
                    <button
                        type="button"
                        onClick={handleClear}
                        className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-border rounded-lg text-sm text-text font-bold transition-colors"
                    >
                        {t('filters.clearAll')}
                    </button>
                    <button
                        type="button"
                        onClick={handleApply}
                        className="flex-1 py-2.5 bg-plex hover:bg-plex-hover rounded-lg text-sm text-black font-black transition-colors shadow-[0_0_12px_rgba(229,160,13,0.25)]"
                    >
                        {t('filters.applyFilters')}
                    </button>
                </div>
            </div>
        </>
    );
};
