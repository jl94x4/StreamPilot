import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Loader2, Sparkles, X, Film, Tv, Laugh, Skull, Drama, Zap, Clock } from 'lucide-react';
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
    /** Live counts for the signed-in member; each pill jumps to its tab. */
    pills?: Array<{ id: string; label: string; count: number; path: string }>;
};

type SearchScope = 'all' | 'movie' | 'tv' | 'person';

const SCOPES: Array<{ id: SearchScope; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'movie', label: 'Movies' },
    { id: 'tv', label: 'Series' },
    { id: 'person', label: 'People' },
];

const RECENT_KEY = 'discoverRecentSearches';

const readRecent = (): string[] => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 6) : [];
    } catch {
        return [];
    }
};

const rememberSearch = (term: string) => {
    const value = term.trim();
    if (value.length < 2) return;
    try {
        const next = [value, ...readRecent().filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 6);
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
};

const SearchDropdown: React.FC<SearchResultProps & { anchorRect: DOMRect | null; scope: SearchScope }> = ({
    query,
    searchOpen,
    searchLoading,
    searchError,
    searchResults,
    anchorRect,
    onSelect,
    onRetrySearch,
    formatItem,
    scope,
}) => {
    const { t } = useDiscoverI18n();
    if (!searchOpen || query.trim().length < 2 || !anchorRect) return null;
    const scoped = scope === 'all'
        ? searchResults
        : searchResults.filter((raw) => {
            const type = String(formatItem(raw)?.type || '');
            return type === scope;
        });

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
            ) : scoped.length === 0 ? (
                <div className="p-6 text-center text-muted text-sm">{t('common.noResults')}</div>
            ) : (
                scoped.slice(0, 20).map((rawItem, idx) => {
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

/** Genre shortcuts only; Movies / Series / Trending already live in the tab bar below. */
const QUICK_CHIPS = [
    { id: 'action', labelKey: 'hero.chipAction', icon: Zap, path: '/discovery/movies?genre=28' },
    { id: 'comedy', labelKey: 'hero.chipComedy', icon: Laugh, path: '/discovery/movies?genre=35' },
    { id: 'horror', labelKey: 'hero.chipHorror', icon: Skull, path: '/discovery/movies?genre=27' },
    { id: 'drama-tv', labelKey: 'hero.chipDramaTv', icon: Drama, path: '/discovery/series?genre=18' },
    { id: 'crime-tv', labelKey: 'hero.chipCrimeTv', icon: Tv, path: '/discovery/series?genre=80' },
    { id: 'scifi-tv', labelKey: 'hero.chipSciFiTv', icon: Sparkles, path: '/discovery/series?genre=10765' },
] as const;

export const DiscoverHeroHeader: React.FC<SearchResultProps> = (props) => {
    const { query, onClear, onQueryChange, onFocus, navigate, searchInputRef } = props;
    const { t } = useDiscoverI18n();
    const [backgrounds, setBackgrounds] = useState<string[]>([]);
    const [intervalSeconds, setIntervalSeconds] = useState(12);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const searchWrapRef = useRef<HTMLDivElement>(null);
    const localInputRef = useRef<HTMLInputElement>(null);
    const [scope, setScope] = useState<SearchScope>('all');
    const [recent, setRecent] = useState<string[]>(readRecent);
    const pills = (props.pills || []).filter((pill) => pill.count > 0);

    // "/" jumps to search from anywhere on the page (desktop keyboards).
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
            const el = document.activeElement as HTMLElement | null;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
            event.preventDefault();
            localInputRef.current?.focus();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const handleSelect = (formatted: any) => {
        rememberSearch(query);
        setRecent(readRecent());
        props.onSelect(formatted);
    };

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

    const handleChip = (chip: (typeof QUICK_CHIPS)[number]) => {
        if (!navigate) return;
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

                <div className="relative z-10 flex flex-col gap-3 p-4 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <h1 className={discoveryTheme.heroTitle}>
                            {t('hero.title')}
                        </h1>
                        {pills.length > 0 && navigate ? (
                            <div className="flex flex-wrap items-center gap-2">
                                {pills.map((pill) => (
                                    <button
                                        key={pill.id}
                                        type="button"
                                        onClick={() => navigate(pill.path)}
                                        className={discoveryTheme.heroChip}
                                    >
                                        <span className="rounded-full bg-plex px-1.5 text-[10px] font-black leading-4 text-background">{pill.count}</span>
                                        {pill.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div ref={searchWrapRef} className="relative w-full sm:flex-1">
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
                            {query ? (
                                <button
                                    type="button"
                                    onClick={onClear}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-text z-10"
                                    aria-label="Clear search"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            ) : (
                                <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded border border-border/80 px-1.5 text-[10px] font-bold text-muted/70 md:block">/</kbd>
                            )}
                        </div>
                        <div className="flex shrink-0 gap-1 self-start rounded-xl border border-border/80 bg-background/85 p-1 sm:self-auto" role="group" aria-label="Search scope">
                            {SCOPES.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setScope(item.id)}
                                    aria-pressed={scope === item.id}
                                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${scope === item.id ? 'bg-plex text-background' : 'text-muted hover:text-text'}`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {navigate ? (
                        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
                            {!query && recent.length > 0 ? recent.slice(0, 3).map((term) => (
                                <button
                                    key={`recent-${term}`}
                                    type="button"
                                    onClick={() => { onQueryChange(term); localInputRef.current?.focus(); }}
                                    className={`${discoveryTheme.heroChip} shrink-0`}
                                    title="Recent search"
                                >
                                    <Clock className="w-3.5 h-3.5" />
                                    {term}
                                </button>
                            )) : null}
                            {QUICK_CHIPS.map((chip) => {
                                const Icon = chip.icon;
                                return (
                                    <button
                                        key={chip.id}
                                        type="button"
                                        onClick={() => handleChip(chip)}
                                        className={`${discoveryTheme.heroChip} shrink-0`}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                        {t(chip.labelKey)}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            </div>

            <SearchDropdown {...props} onSelect={handleSelect} anchorRect={anchorRect} scope={scope} />
        </>
    );
};
