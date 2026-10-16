import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Loader2, Sparkles, X, Film, Tv, TrendingUp, Laugh, Skull, Drama, Zap } from 'lucide-react';
import { SlideshowBackground } from '../shared/theme';
import { apiFetch } from '../shared/api';
import { discoveryTheme } from './discoveryThemeClasses';
import { useDiscoverI18n } from './i18n';

type SearchResultProps = {
    query: string;
    searchOpen: boolean;
    searchLoading: boolean;
    searchError?: string | null;
    searchResults: any[];
    onClose: () => void;
    onClear: () => void;
    onQueryChange: (value: string) => void;
    onFocus: () => void;
    onRetrySearch?: () => void;
    onSelect: (formatted: any) => void;
    formatItem: (item: any) => any;
    navigate?: (path: string) => void;
    searchInputRef?: React.RefObject<HTMLInputElement | null>;
};

const SearchDropdown: React.FC<SearchResultProps & { anchorRect: DOMRect | null }> = ({
    query,
    searchOpen,
    searchLoading,
    searchError,
    searchResults,
    anchorRect,
    onSelect,
    onRetrySearch,
    formatItem,
}) => {
    const { t } = useDiscoverI18n();
    if (!searchOpen || query.trim().length < 2 || !anchorRect) return null;

    return createPortal(
        <div
            data-discovery-search-dropdown
            className={discoveryTheme.searchDropdown}
            style={{
                position: 'fixed',
                top: anchorRect.bottom + 8,
                left: anchorRect.left,
                width: anchorRect.width,
                zIndex: 9999,
                backgroundColor: 'rgb(var(--color-card))',
            }}
        >
            {searchLoading ? (
                <div className="flex items-center justify-center gap-2 p-6 text-muted">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t('common.searching')}
                </div>
            ) : searchError ? (
                <div className="p-6 text-center flex flex-col items-center gap-3">
                    <p className="text-sm text-muted">{t('common.searchFailed')}</p>
                    {onRetrySearch && (
                        <button
                            type="button"
                            onClick={onRetrySearch}
                            className="text-xs font-bold text-plex hover:underline"
                        >
                            {t('common.tryAgain')}
                        </button>
                    )}
                </div>
            ) : searchResults.length === 0 ? (
                <div className="p-6 text-center text-muted text-sm">{t('common.noResults')}</div>
            ) : (
                searchResults.slice(0, 20).map((rawItem, idx) => {
                    const formatted = formatItem(rawItem);
                    const isPerson = formatted.type === 'person';
                    return (
                        <button
                            key={`${formatted.id}-${idx}`}
                            type="button"
                            onClick={() => onSelect(formatted)}
                            className={discoveryTheme.searchResultBtn}
                        >
                            <div className={`${isPerson ? 'w-12 h-12 rounded-full' : 'w-12 h-[72px] rounded-md'} overflow-hidden bg-white/5 flex-shrink-0`}>
                                {formatted.thumbUrl ? (
                                    <img src={formatted.thumbUrl} alt="" className="w-full h-full object-cover" />
                                ) : null}
                            </div>
                            <div className="min-w-0">
                                <div className="font-bold text-text truncate">{formatted.title}</div>
                                <div className="text-xs text-muted">
                                    {isPerson
                                        ? (formatted.tags?.[0] || t('mediaType.person'))
                                        : [formatted.year, formatted.tags?.[0]].filter(Boolean).join(' · ')}
                                </div>
                            </div>
                        </button>
                    );
                })
            )}
        </div>,
        document.body,
    );
};

/** Quick picks: mixed home jumps, movie genres, and TV genres. */
const QUICK_CHIPS = [
    { id: 'trending', labelKey: 'hero.chipTrending', icon: TrendingUp, path: '/discovery' },
    { id: 'movies', labelKey: 'hero.chipMovies', icon: Film, path: '/discovery/movies' },
    { id: 'series', labelKey: 'hero.chipSeries', icon: Tv, path: '/discovery/series' },
    { id: 'action', labelKey: 'hero.chipAction', icon: Zap, path: '/discovery/movies?genre=28' },
    { id: 'comedy', labelKey: 'hero.chipComedy', icon: Laugh, path: '/discovery/movies?genre=35' },
    { id: 'horror', labelKey: 'hero.chipHorror', icon: Skull, path: '/discovery/movies?genre=27' },
    { id: 'drama-tv', labelKey: 'hero.chipDramaTv', icon: Drama, path: '/discovery/series?genre=18' },
    { id: 'crime-tv', labelKey: 'hero.chipCrimeTv', icon: Tv, path: '/discovery/series?genre=80' },
    { id: 'scifi-tv', labelKey: 'hero.chipSciFiTv', icon: Sparkles, path: '/discovery/series?genre=10765' },
    { id: 'fresh', labelKey: 'hero.chipFresh', icon: Film, path: '/discovery/movies?sort=primary_release_date.desc&dateGte=' },
    { id: 'fresh-tv', labelKey: 'hero.chipFreshTv', icon: Sparkles, path: '/discovery/series?sort=first_air_date.desc&dateGte=' },
] as const;

export const DiscoverHeroHeader: React.FC<SearchResultProps> = (props) => {
    const { query, onClear, onQueryChange, onFocus, navigate, searchInputRef } = props;
    const { t } = useDiscoverI18n();
    const [backgrounds, setBackgrounds] = useState<string[]>([]);
    const [intervalSeconds, setIntervalSeconds] = useState(12);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const searchWrapRef = useRef<HTMLDivElement>(null);
    const localInputRef = useRef<HTMLInputElement>(null);

    const setInputRef = (node: HTMLInputElement | null) => {
        localInputRef.current = node;
        if (searchInputRef) {
            (searchInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
    };

    useEffect(() => {
        apiFetch('/api/discovery/hero-backdrops')
            .then((res) => {
                if (Array.isArray(res?.backgrounds) && res.backgrounds.length) {
                    setBackgrounds(res.backgrounds);
                }
                if (res?.interval) setIntervalSeconds(Number(res.interval) || 12);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        const updateRect = () => {
            if (searchWrapRef.current) {
                setAnchorRect(searchWrapRef.current.getBoundingClientRect());
            }
        };
        updateRect();
        if (!props.searchOpen) return undefined;

        window.addEventListener('resize', updateRect);
        window.addEventListener('scroll', updateRect, true);
        window.visualViewport?.addEventListener('resize', updateRect);
        window.visualViewport?.addEventListener('scroll', updateRect);
        return () => {
            window.removeEventListener('resize', updateRect);
            window.removeEventListener('scroll', updateRect, true);
            window.visualViewport?.removeEventListener('resize', updateRect);
            window.visualViewport?.removeEventListener('scroll', updateRect);
        };
    }, [props.searchOpen, query]);

    useEffect(() => {
        if (!props.searchOpen) return undefined;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (searchWrapRef.current?.contains(target)) return;
            if (target.closest('[data-discovery-search-dropdown]')) return;
            props.onClose();
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [props.searchOpen, props.onClose]);

    const freshFrom = () => {
        const from = new Date();
        from.setFullYear(from.getFullYear() - 1);
        return from.toISOString().slice(0, 10);
    };

    const handleChip = (chip: (typeof QUICK_CHIPS)[number]) => {
        if (!navigate) return;
        if (chip.id === 'fresh') {
            navigate(`/discovery/movies?sort=primary_release_date.desc&dateGte=${freshFrom()}`);
            return;
        }
        if (chip.id === 'fresh-tv') {
            navigate(`/discovery/series?sort=first_air_date.desc&dateGte=${freshFrom()}`);
            return;
        }
        if (chip.id === 'trending') {
            navigate('/discovery');
            return;
        }
        navigate(chip.path);
    };

    return (
        <>
            <div className={discoveryTheme.heroShell}>
                <div className={discoveryTheme.heroBackdrop}>
                    {backgrounds.length > 0 ? (
                        <SlideshowBackground
                            backgrounds={backgrounds}
                            intervalSeconds={intervalSeconds}
                            opacity={0.55}
                            smartFocus
                        />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/40 to-transparent pointer-events-none" />
                    <div className="absolute inset-0 bg-background/20 pointer-events-none" />
                </div>

                <div className="relative z-10 p-6 sm:p-10 flex flex-col items-center justify-center text-center gap-4 sm:gap-5">
                    <Sparkles className="w-10 h-10 sm:w-12 sm:h-12 text-plex opacity-90 drop-shadow-lg" />
                    <div className="flex flex-col gap-1.5">
                        <h1 className={discoveryTheme.heroTitle}>
                            {t('hero.title')}
                        </h1>
                        <p className="text-sm text-muted max-w-xl mx-auto">
                            {t('hero.subtitle')}
                        </p>
                    </div>

                    <div ref={searchWrapRef} className="w-full max-w-3xl relative mt-1">
                        <Search className="w-4 h-4 sm:w-5 sm:h-5 text-muted absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 z-10" />
                        <input
                            ref={setInputRef}
                            type="text"
                            inputMode="search"
                            enterKeyHint="search"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder={t('hero.searchPlaceholder')}
                            value={query}
                            onChange={(e) => onQueryChange(e.target.value)}
                            onFocus={onFocus}
                            className={discoveryTheme.searchInput}
                            aria-label={t('hero.searchAria')}
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={onClear}
                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-text z-10"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>

                    {navigate && (
                        <div className="flex flex-wrap items-center justify-center gap-2 max-w-4xl">
                            {QUICK_CHIPS.map((chip) => {
                                const Icon = chip.icon;
                                return (
                                    <button
                                        key={chip.id}
                                        type="button"
                                        onClick={() => handleChip(chip)}
                                        className={discoveryTheme.heroChip}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                        {t(chip.labelKey)}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <SearchDropdown {...props} anchorRect={anchorRect} />
        </>
    );
};
