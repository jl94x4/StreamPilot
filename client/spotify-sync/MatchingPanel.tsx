import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Plus,
    RotateCcw,
    Save,
    Trash2,
    X,
} from 'lucide-react';
import {
    DashboardPanel,
} from '../shared/dashboard/DashboardChrome';
import { CustomSelect, SettingsSwitch, SettingsToggleRow } from '../shared/ui';
import { workerFetch } from './spotifySyncApi';
import {
    MATCH_FIELDS,
    MATCH_FILTER_PRESETS,
    TEXT_WORD_SUGGESTIONS,
    conditionsToFieldState,
    describeMatchRule,
    fieldStateToConditions,
    formatMatchThreshold,
    moveListItem,
    normalizeMatchFilters,
    normalizeSearchApproaches,
    normalizeTextProcessing,
    parseMatchFilter,
    serializeMatchFilters,
    serializeSearchApproaches,
    serializeTextProcessing,
} from '../../lib/spotify-to-plex-matching-config.js';

const buttonClass = 'inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-muted hover:border-plex hover:text-plex disabled:opacity-50';
const primaryButtonClass = 'inline-flex items-center gap-2 rounded-lg bg-plex px-3 py-1.5 text-xs font-bold text-background hover:brightness-110 disabled:opacity-50';

const FIELD_LABELS: Record<string, string> = {
    artist: 'Artist',
    title: 'Title',
    album: 'Album',
};

const OP_OPTIONS = [
    { value: 'off', label: 'Ignore' },
    { value: 'match', label: 'Exact' },
    { value: 'contains', label: 'Contains' },
    { value: 'similarity', label: 'Similar' },
];

type ToastFn = (message: string, type: 'success' | 'error') => void;

const nextKey = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const WordChips: React.FC<{
    values: string[];
    onChange: (next: string[]) => void;
    placeholder?: string;
}> = ({ values, onChange, placeholder = 'Add a phrase' }) => {
    const [draft, setDraft] = useState('');

    const add = (raw: string) => {
        const value = String(raw || '').trim();
        if (!value) return;
        if (values.some((item) => item.toLowerCase() === value.toLowerCase())) {
            setDraft('');
            return;
        }
        onChange([...values, value]);
        setDraft('');
    };

    return (
        <div className="rounded-xl border border-white/10 bg-black/30 p-2">
            <div className="flex flex-wrap gap-1.5">
                {values.map((word) => (
                    <span
                        key={word}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text"
                    >
                        {word}
                        <button
                            type="button"
                            className="rounded-full p-0.5 text-muted hover:text-rose-300"
                            onClick={() => onChange(values.filter((item) => item !== word))}
                            aria-label={`Remove ${word}`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                <input
                    className="min-w-[10rem] flex-1 bg-transparent px-2 py-1 text-[16px] leading-5 text-text outline-none placeholder:text-muted"
                    value={draft}
                    placeholder={placeholder}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ',') {
                            event.preventDefault();
                            add(draft);
                        }
                        if (event.key === 'Backspace' && !draft && values.length) {
                            onChange(values.slice(0, -1));
                        }
                    }}
                    onBlur={() => add(draft)}
                />
            </div>
        </div>
    );
};

const MatchRuleCard: React.FC<{
    rule: any;
    index: number;
    total: number;
    onChange: (next: any) => void;
    onMove: (delta: number) => void;
    onRemove: () => void;
}> = ({ rule, index, total, onChange, onMove, onRemove }) => {
    const fields = useMemo(() => conditionsToFieldState(rule.conditions), [rule.conditions]);

    const setField = (field: string, patch: { op?: string; threshold?: number }) => {
        const nextFields = {
            ...fields,
            [field]: { ...fields[field], ...patch },
        };
        onChange({
            ...rule,
            parsed: true,
            conditions: fieldStateToConditions(nextFields),
        });
    };

    return (
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted">Rule {index + 1}</p>
                    <p className="mt-0.5 text-sm font-semibold text-text">{describeMatchRule(rule)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button type="button" className={buttonClass} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
                        <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={buttonClass} disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
                        <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={buttonClass} onClick={onRemove} aria-label="Remove rule">
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {rule.parsed === false ? (
                <div className="space-y-2">
                    <p className="text-xs text-amber-200">This rule uses a custom expression, so it stays editable as text.</p>
                    <textarea
                        className="min-h-[72px] w-full rounded-lg border border-white/10 bg-black/40 p-3 text-[16px] leading-5 text-text"
                        value={rule.raw || ''}
                        onChange={(event) => {
                            const next = parseMatchFilter(event.target.value);
                            onChange(next.parsed ? next : { parsed: false, raw: event.target.value, conditions: [] });
                        }}
                    />
                </div>
            ) : (
                <div className="grid gap-3 md:grid-cols-3">
                    {MATCH_FIELDS.map((field) => {
                        const current = fields[field];
                        const percent = Math.round(Number(formatMatchThreshold(current.threshold)) * 100);
                        return (
                            <div key={field} className="rounded-lg border border-white/10 bg-black/20 p-3">
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">{FIELD_LABELS[field]}</p>
                                <CustomSelect
                                    compact
                                    id={`match-${index}-${field}`}
                                    value={current.op}
                                    onChange={(value) => setField(field, { op: value })}
                                    options={OP_OPTIONS}
                                    className="h-11"
                                />
                                {current.op === 'similarity' ? (
                                    <label className="mt-3 block">
                                        <span className="mb-1 flex items-center justify-between text-[11px] text-muted">
                                            Similarity
                                            <span className="font-semibold text-text">{percent}%</span>
                                        </span>
                                        <input
                                            type="range"
                                            min={50}
                                            max={100}
                                            step={5}
                                            value={percent}
                                            onChange={(event) => setField(field, { threshold: Number(event.target.value) / 100 })}
                                            className="w-full accent-[rgb(var(--color-plex))]"
                                        />
                                    </label>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const MatchingPanel: React.FC<{ onToast: ToastFn }> = ({ onToast }) => {
    const [filters, setFilters] = useState<any[]>([]);
    const [approaches, setApproaches] = useState<any[]>([]);
    const [text, setText] = useState<any>({ filterOutWords: [], extra: {} });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState('');
    const [preset, setPreset] = useState(MATCH_FILTER_PRESETS[0].label);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [match, search, processing] = await Promise.all([
                workerFetch('plex/music-search-config/match-filters'),
                workerFetch('plex/music-search-config/search-approaches'),
                workerFetch('plex/music-search-config/text-processing'),
            ]);
            setFilters(normalizeMatchFilters(match).map((rule) => ({ ...rule, key: nextKey() })));
            setApproaches(normalizeSearchApproaches(search).map((item) => ({ ...item, key: nextKey() })));
            setText(normalizeTextProcessing(processing));
        } catch (error: any) {
            onToast(error?.message || 'Could not load matching config', 'error');
        } finally {
            setLoading(false);
        }
    }, [onToast]);

    useEffect(() => { void load(); }, [load]);

    const saveSection = async (path: string, body: unknown, label: string) => {
        setSaving(path);
        try {
            await workerFetch(path, { method: 'POST', body: JSON.stringify(body) });
            onToast(`${label} saved`, 'success');
        } catch (error: any) {
            onToast(error?.message || `Could not save ${label}`, 'error');
        } finally {
            setSaving('');
        }
    };

    const saveAll = async () => {
        setSaving('all');
        try {
            await Promise.all([
                workerFetch('plex/music-search-config/match-filters', {
                    method: 'POST',
                    body: JSON.stringify(serializeMatchFilters(filters)),
                }),
                workerFetch('plex/music-search-config/search-approaches', {
                    method: 'POST',
                    body: JSON.stringify(serializeSearchApproaches(approaches)),
                }),
                workerFetch('plex/music-search-config/text-processing', {
                    method: 'POST',
                    body: JSON.stringify(serializeTextProcessing(text)),
                }),
            ]);
            onToast('Matching settings saved', 'success');
        } catch (error: any) {
            onToast(error?.message || 'Could not save matching settings', 'error');
        } finally {
            setSaving('');
        }
    };

    const reset = async () => {
        try {
            await workerFetch('plex/music-search-config/reset', { method: 'POST', body: JSON.stringify({}) });
            onToast('Matching config reset', 'success');
            await load();
        } catch (error: any) {
            onToast(error?.message || 'Reset failed', 'error');
        }
    };

    const addPreset = () => {
        const chosen = MATCH_FILTER_PRESETS.find((item) => item.label === preset) || MATCH_FILTER_PRESETS[0];
        setFilters((current) => [
            ...current,
            { parsed: true, conditions: chosen.conditions, raw: '', key: nextKey() },
        ]);
    };

    const unusedSuggestions = TEXT_WORD_SUGGESTIONS.filter(
        (word) => !text.filterOutWords.some((item: string) => item.toLowerCase() === word.toLowerCase()),
    );

    if (loading) return <p className="text-sm text-muted">Loading matching config…</p>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={buttonClass} onClick={() => void reset()}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset to defaults
                </button>
                <button type="button" className={primaryButtonClass} disabled={!!saving} onClick={() => void saveAll()}>
                    <Save className="h-3.5 w-3.5" />
                    {saving === 'all' ? 'Saving…' : 'Save all'}
                </button>
            </div>

            <DashboardPanel
                title="Match filters"
                subtitle="Tried in order. Keep stricter rules at the top so exact Plex matches win before looser ones."
                controls={(
                    <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={!!saving}
                        onClick={() => void saveSection(
                            'plex/music-search-config/match-filters',
                            serializeMatchFilters(filters),
                            'Match filters',
                        )}
                    >
                        Save
                    </button>
                )}
            >
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <CustomSelect
                        compact
                        id="match-filter-preset"
                        value={preset}
                        onChange={setPreset}
                        options={MATCH_FILTER_PRESETS.map((item) => ({ label: item.label, value: item.label }))}
                        className="h-11 min-w-0 flex-1"
                    />
                    <button type="button" className={buttonClass} onClick={addPreset}>
                        <Plus className="h-3.5 w-3.5" />
                        Add rule
                    </button>
                </div>
                <div className="space-y-3">
                    {filters.length === 0 ? (
                        <p className="text-sm text-muted">No rules yet. Add one above, or reset to defaults.</p>
                    ) : filters.map((rule, index) => (
                        <MatchRuleCard
                            key={rule.key}
                            rule={rule}
                            index={index}
                            total={filters.length}
                            onChange={(next) => setFilters((current) => current.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, ...next } : item
                            )))}
                            onMove={(delta) => setFilters((current) => moveListItem(current, index, delta))}
                            onRemove={() => setFilters((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        />
                    ))}
                </div>
            </DashboardPanel>

            <DashboardPanel
                title="Search passes"
                subtitle="Each pass searches Plex a different way. More passes can find more tracks, but take longer."
                controls={(
                    <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={!!saving}
                        onClick={() => void saveSection(
                            'plex/music-search-config/search-approaches',
                            serializeSearchApproaches(approaches),
                            'Search passes',
                        )}
                    >
                        Save
                    </button>
                )}
            >
                <div className="space-y-3">
                    {approaches.map((item, index) => (
                        <div key={item.key} className="rounded-xl border border-white/10 bg-black/25 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <input
                                    className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 text-[16px] font-semibold leading-5 text-text"
                                    value={item.id}
                                    onChange={(event) => setApproaches((current) => current.map((row, rowIndex) => (
                                        rowIndex === index ? { ...row, id: event.target.value } : row
                                    )))}
                                    aria-label={`Search pass ${index + 1} name`}
                                />
                                <div className="flex shrink-0 items-center gap-1">
                                    <button type="button" className={buttonClass} disabled={index === 0} onClick={() => setApproaches((current) => moveListItem(current, index, -1))}>
                                        <ChevronUp className="h-3.5 w-3.5" />
                                    </button>
                                    <button type="button" className={buttonClass} disabled={index === approaches.length - 1} onClick={() => setApproaches((current) => moveListItem(current, index, 1))}>
                                        <ChevronDown className="h-3.5 w-3.5" />
                                    </button>
                                    <button type="button" className={buttonClass} onClick={() => setApproaches((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className="divide-y divide-white/10">
                                <div className="flex items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-text">Search cleaned titles</p>
                                        <p className="text-xs text-muted">Ignore the phrases below before searching Plex.</p>
                                    </div>
                                    <SettingsSwitch
                                        checked={!!item.filtered}
                                        onChange={(checked) => setApproaches((current) => current.map((row, rowIndex) => (
                                            rowIndex === index ? { ...row, filtered: checked } : row
                                        )))}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-text">Trim extra title text</p>
                                        <p className="text-xs text-muted">Cut remix or version suffixes after parentheses or a dash.</p>
                                    </div>
                                    <SettingsSwitch
                                        checked={!!item.trim}
                                        onChange={(checked) => setApproaches((current) => current.map((row, rowIndex) => (
                                            rowIndex === index ? { ...row, trim: checked } : row
                                        )))}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                    <button
                        type="button"
                        className={buttonClass}
                        onClick={() => setApproaches((current) => [
                            ...current,
                            {
                                id: `pass-${current.length + 1}`,
                                filtered: false,
                                trim: false,
                                trimKey: 'trim',
                                extra: {},
                                key: nextKey(),
                            },
                        ])}
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add search pass
                    </button>
                </div>
            </DashboardPanel>

            <DashboardPanel
                title="Ignored phrases"
                subtitle="These words are stripped from titles before matching, so Radio Edit and Remastered do not block a hit."
                controls={(
                    <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={!!saving}
                        onClick={() => void saveSection(
                            'plex/music-search-config/text-processing',
                            serializeTextProcessing(text),
                            'Ignored phrases',
                        )}
                    >
                        Save
                    </button>
                )}
            >
                <WordChips
                    values={text.filterOutWords || []}
                    onChange={(filterOutWords) => setText((current: any) => ({ ...current, filterOutWords }))}
                    placeholder="Type a phrase and press Enter"
                />
                {unusedSuggestions.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {unusedSuggestions.map((word) => (
                            <button
                                key={word}
                                type="button"
                                className={buttonClass}
                                onClick={() => setText((current: any) => ({
                                    ...current,
                                    filterOutWords: [...(current.filterOutWords || []), word],
                                }))}
                            >
                                <Plus className="h-3 w-3" />
                                {word}
                            </button>
                        ))}
                    </div>
                ) : null}
                {text.filterOutQuotes != null ? (
                    <SettingsToggleRow
                        className="mt-2"
                        title="Strip quotes from titles"
                        checked={!!text.filterOutQuotes}
                        onChange={(filterOutQuotes) => setText((current: any) => ({ ...current, filterOutQuotes }))}
                        border={false}
                    />
                ) : null}
                {text.cutOffSeparators != null ? (
                    <div className="mt-4">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Cut titles at</p>
                        <WordChips
                            values={text.cutOffSeparators || []}
                            onChange={(cutOffSeparators) => setText((current: any) => ({ ...current, cutOffSeparators }))}
                            placeholder="Add a separator"
                        />
                    </div>
                ) : null}
            </DashboardPanel>
        </div>
    );
};
