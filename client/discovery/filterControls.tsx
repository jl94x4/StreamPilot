import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { CustomSelect } from '../shared/ui';
import { DISCOVER_REGION_OPTIONS } from '../settings/discoverySettingsOptions';
import { useDiscoverI18n } from './i18n';

export type FilterOption = { id: string; label: string };

const inputClass =
    'w-full appearance-none bg-background/60 border border-border focus:border-plex rounded-xl px-4 py-3 text-[16px] leading-5 text-text font-medium outline-none transition-colors shadow-inner';

const chipClass =
    'inline-flex items-center gap-1.5 max-w-full rounded-lg border border-plex/30 bg-plex/10 text-plex text-xs font-bold px-2.5 py-1';

/** TMDB/Seerr expect ISO 3166-1 alpha-2 (United Kingdom = GB, not UK). */
export const normalizeWatchRegion = (region: string, fallback = 'US'): string => {
    const raw = String(region || '').trim().toUpperCase();
    if (!raw) return fallback;
    if (raw === 'UK') return 'GB';
    if (raw === 'EN') return 'US';
    return raw.slice(0, 2);
};

const WATCH_REGION_OPTIONS = DISCOVER_REGION_OPTIONS
    .filter((option) => option.value)
    .map((option) => ({ value: option.value, label: `${option.label} (${option.value})` }));

export const FilterField: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({
    label,
    children,
    hint,
}) => (
    <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
            <label className="text-xs font-black text-muted uppercase tracking-[0.2em]">{label}</label>
            {hint ? <span className="text-[10px] text-muted/70">{hint}</span> : null}
        </div>
        {children}
    </div>
);

export const DateRangeInputs: React.FC<{
    from: string;
    to: string;
    onFromChange: (value: string) => void;
    onToChange: (value: string) => void;
}> = ({ from, to, onFromChange, onToChange }) => {
    const { t } = useDiscoverI18n();

    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted font-bold">{t('common.from')}</span>
                <input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted font-bold">{t('common.to')}</span>
                <input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className={inputClass} />
            </div>
        </div>
    );
};

export const DualRangeSlider: React.FC<{
    min: number;
    max: number;
    step?: number;
    valueMin: number;
    valueMax: number;
    onChange: (minValue: number, maxValue: number) => void;
    formatValue?: (value: number) => string;
}> = ({ min, max, step = 1, valueMin, valueMax, onChange, formatValue = String }) => {
    const low = Math.min(valueMin, valueMax);
    const high = Math.max(valueMin, valueMax);
    const span = Math.max(1, max - min);
    const leftPct = ((low - min) / span) * 100;
    const rightPct = ((high - min) / span) * 100;

    return (
        <div className="flex flex-col gap-3">
            <div className="relative h-8 flex items-center">
                <div className="absolute inset-x-0 h-1.5 rounded-full bg-white/10" />
                <div
                    className="absolute h-1.5 rounded-full bg-plex"
                    style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
                />
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={low}
                    onChange={(e) => {
                        const next = Number(e.target.value);
                        onChange(Math.min(next, high), high);
                    }}
                    className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-[1] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-plex [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-black/40 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-plex [&::-moz-range-thumb]:border-0"
                />
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={high}
                    onChange={(e) => {
                        const next = Number(e.target.value);
                        onChange(low, Math.max(next, low));
                    }}
                    className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-[2] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-plex [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-black/40 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-plex [&::-moz-range-thumb]:border-0"
                />
            </div>
            <p className="text-xs text-muted font-medium">
                {formatValue(low)} – {formatValue(high)}
            </p>
        </div>
    );
};

export const ChipMultiSelect: React.FC<{
    options: { value: string; label: string }[];
    selected: string[];
    onChange: (values: string[]) => void;
}> = ({ options, selected, onChange }) => {
    const selectedSet = useMemo(() => new Set(selected.map(String)), [selected]);
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((option) => {
                const active = selectedSet.has(String(option.value));
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                            if (active) onChange(selected.filter((value) => String(value) !== String(option.value)));
                            else onChange([...selected, String(option.value)]);
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                            active
                                ? 'bg-plex text-black border-plex'
                                : 'bg-white/5 text-muted border-border hover:text-text hover:border-plex/40'
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
};

export const CertificationToggles: React.FC<{
    selected: string[];
    onChange: (values: string[]) => void;
    ratings: readonly string[];
}> = ({ selected, onChange, ratings }) => {
    const selectedSet = useMemo(() => new Set(selected), [selected]);
    return (
        <div className="flex flex-wrap gap-2">
            {ratings.map((rating) => {
                const active = selectedSet.has(rating);
                return (
                    <button
                        key={rating}
                        type="button"
                        onClick={() => {
                            if (active) onChange(selected.filter((value) => value !== rating));
                            else onChange([...selected, rating]);
                        }}
                        className={`min-w-[3rem] h-10 px-2 rounded-full text-[11px] font-black border transition-colors ${
                            active
                                ? 'bg-plex text-black border-plex'
                                : 'bg-transparent text-text border-white/30 hover:border-plex/60'
                        }`}
                    >
                        {rating}
                    </button>
                );
            })}
        </div>
    );
};

type AsyncSearchMode = 'keyword' | 'company';

const searchEndpoint = (mode: AsyncSearchMode, query: string) => (
    mode === 'keyword'
        ? `/api/discovery/proxy/search/keyword?query=${encodeURIComponent(query)}`
        : `/api/discovery/proxy/search/company?query=${encodeURIComponent(query)}`
);

const normalizeSearchResults = (data: any): FilterOption[] => {
    const rows = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
    return rows
        .map((row: any) => ({
            id: String(row?.id ?? ''),
            label: String(row?.name || row?.title || '').trim(),
        }))
        .filter((row: FilterOption) => row.id && row.label);
};

export const AsyncTagSelect: React.FC<{
    mode: AsyncSearchMode;
    values: FilterOption[];
    onChange: (values: FilterOption[]) => void;
    placeholder: string;
    staticOptions?: FilterOption[];
}> = ({ mode, values, onChange, placeholder, staticOptions = [] }) => {
    const { t } = useDiscoverI18n();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<FilterOption[]>([]);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, []);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            const filtered = staticOptions
                .filter((option) => option.label.toLowerCase().includes(trimmed.toLowerCase()))
                .slice(0, 12);
            setResults(filtered);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        const timer = window.setTimeout(() => {
            apiFetch(searchEndpoint(mode, trimmed))
                .then((data) => {
                    if (!cancelled) setResults(normalizeSearchResults(data).slice(0, 12));
                })
                .catch(() => {
                    if (!cancelled) setResults([]);
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        }, 250);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [mode, query, staticOptions]);

    const selectedIds = useMemo(() => new Set(values.map((value) => value.id)), [values]);

    const addOption = (option: FilterOption) => {
        if (selectedIds.has(option.id)) return;
        onChange([...values, option]);
        setQuery('');
        setOpen(false);
    };

    return (
        <div className="flex flex-col gap-2" ref={wrapRef}>
            {values.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {values.map((value) => (
                        <span key={value.id} className={chipClass}>
                            <span className="truncate">{value.label}</span>
                            <button
                                type="button"
                                className="hover:text-white"
                                onClick={() => onChange(values.filter((entry) => entry.id !== value.id))}
                                aria-label={`${t('common.remove')} ${value.label}`}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <div className="relative">
                <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    placeholder={placeholder}
                    className={`${inputClass} pl-10 pr-10`}
                />
                {loading && (
                    <Loader2 className="w-4 h-4 text-muted absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin" />
                )}
                {open && (results.length > 0 || query.trim().length >= 2) && (
                    <div className="absolute z-30 mt-2 w-full max-h-56 overflow-y-auto custom-scrollbar rounded-xl border border-border bg-card shadow-2xl">
                        {results.length === 0 ? (
                            <p className="px-4 py-3 text-sm text-muted">{t('common.noMatches')}</p>
                        ) : (
                            results.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    disabled={selectedIds.has(option.id)}
                                    onClick={() => addOption(option)}
                                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {option.label}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export const WatchProviderPicker: React.FC<{
    type: 'movie' | 'tv';
    region: string;
    selectedIds: string[];
    onChange: (region: string, providerIds: string[]) => void;
}> = ({ type, region, selectedIds, onChange }) => {
    const { t } = useDiscoverI18n();
    const [providers, setProviders] = useState<{ id: string; name: string; logoPath?: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const effectiveRegion = normalizeWatchRegion(region, 'US');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        const path = type === 'movie'
            ? `/api/discovery/proxy/watchproviders/movies?watchRegion=${encodeURIComponent(effectiveRegion)}`
            : `/api/discovery/proxy/watchproviders/tv?watchRegion=${encodeURIComponent(effectiveRegion)}`;
        apiFetch(path)
            .then((data) => {
                if (cancelled) return;
                const rows = Array.isArray(data?.results)
                    ? data.results
                    : (Array.isArray(data) ? data : []);
                const mapped = rows
                    .map((row: any) => ({
                        id: String(row?.id ?? row?.provider_id ?? ''),
                        name: String(row?.name || row?.provider_name || '').trim(),
                        logoPath: row?.logoPath || row?.logo_path || '',
                        priority: Number(row?.displayPriority ?? row?.display_priority ?? 9999),
                    }))
                    .filter((row: { id: string; name: string }) => row.id && row.name)
                    .sort((a: { priority: number; name: string }, b: { priority: number; name: string }) => (
                        a.priority - b.priority || a.name.localeCompare(b.name)
                    ));
                setProviders(mapped.slice(0, 48));
            })
            .catch((err) => {
                if (cancelled) return;
                setProviders([]);
                setError(err?.message || t('filters.providersLoadFailed'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [type, effectiveRegion, t]);

    const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);

    return (
        <div className="flex flex-col gap-3">
            <CustomSelect
                value={effectiveRegion}
                onChange={(nextRegion) => onChange(normalizeWatchRegion(nextRegion, 'US'), selectedIds)}
                options={WATCH_REGION_OPTIONS}
                className="w-full"
            />
            {loading ? (
                <p className="text-xs text-muted flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('filters.loadingServices')}
                </p>
            ) : error ? (
                <p className="text-xs text-red-300">{error}</p>
            ) : (
                <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                    {providers.map((provider) => {
                        const active = selectedSet.has(provider.id);
                        return (
                            <button
                                key={provider.id}
                                type="button"
                                onClick={() => {
                                    const next = active
                                        ? selectedIds.filter((id) => id !== provider.id)
                                        : [...selectedIds, provider.id];
                                    onChange(effectiveRegion, next);
                                }}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                                    active
                                        ? 'bg-plex text-black border-plex'
                                        : 'bg-white/5 text-muted border-border hover:text-text'
                                }`}
                                title={provider.name}
                            >
                                {provider.name}
                            </button>
                        );
                    })}
                    {!providers.length && (
                        <p className="text-xs text-muted">
                            {t('filters.noProviders', { region: effectiveRegion })}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export const splitCsv = (value: string): string[] => (
    String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
);

export const splitPipe = (value: string): string[] => (
    String(value || '')
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean)
);

export const joinCsv = (values: string[]) => values.filter(Boolean).join(',');
export const joinPipe = (values: string[]) => values.filter(Boolean).join('|');

export const optionsFromParallel = (ids: string, names: string): FilterOption[] => {
    const idList = splitCsv(ids);
    const nameList = splitCsv(names);
    return idList.map((id, index) => ({
        id,
        label: nameList[index] || id,
    }));
};
