import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { TvButton } from '../shared/TvButton';
import {
    applyManageMatch,
    fetchManageArtwork,
    fetchManageFields,
    fetchManageHistory,
    fetchManageMatches,
    fetchMediaPlayerItem,
    refreshAfterManageChange,
    saveManageFields,
    setManageArtwork,
    unmatchManageItem,
} from './api';
import type {
    ManageArtworkKind,
    ManageArtworkRow,
    ManageFields,
    ManageHistoryRow,
    ManageMatchRow,
} from './api';
import type { PlayerItem } from './types';

export type ManageView = 'artwork' | 'edit' | 'match' | 'history';

type Props = {
    item: PlayerItem;
    view: ManageView;
    onClose: () => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
};

const fieldClass = 'w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-base text-white outline-none placeholder:text-white/35 focus:border-plex focus:ring-2 focus:ring-plex/70';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-5 py-2.5 text-sm font-bold text-white outline-none hover:bg-white/15 focus:bg-white focus:text-black focus-visible:bg-white focus-visible:text-black disabled:opacity-50';
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-full bg-plex px-5 py-2.5 text-sm font-black text-black outline-none focus:ring-4 focus:ring-white disabled:opacity-50';
const tabClass = (on: boolean) => `${buttonClass}${on ? ' !bg-white !text-black' : ''}`;

const errorText = (error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    return message && message.length < 160 ? message : '';
};

const kindLabelKey: Record<ManageArtworkKind, string> = {
    poster: 'mediaPlayerPage.manageArtworkPoster',
    art: 'mediaPlayerPage.manageArtworkBackground',
    logo: 'mediaPlayerPage.manageArtworkLogo',
};

// A season page's menu belongs to the season, but the picture people want to change is usually an episode's card,
// so a season gets a second tab that lists its episodes and opens the same picker for the one chosen.
const SeasonArtwork: React.FC<{ item: PlayerItem; toast: NonNullable<Props['onToast']> }> = ({ item, toast }) => {
    const { t } = useDiscoverI18n();
    const [tab, setTab] = useState<'season' | 'episodes'>('season');
    const [episodes, setEpisodes] = useState<PlayerItem[] | null>(null);
    const [episode, setEpisode] = useState<PlayerItem | null>(null);

    useEffect(() => {
        if (tab !== 'episodes' || episodes) return;
        let cancelled = false;
        fetchMediaPlayerItem(item.ratingKey, { core: true, serverId: item.serverId || null })
            .then((page) => { if (!cancelled) setEpisodes((page?.children || []).filter((row) => row.type === 'episode')); })
            .catch(() => { if (!cancelled) setEpisodes([]); });
        return () => { cancelled = true; };
    }, [tab, episodes, item.ratingKey, item.serverId]);

    if (episode) {
        return (
            <>
                <div className="mb-4 flex items-center gap-3" data-tv-rail="1">
                    <TvButton type="button" data-tv-item="1" className={buttonClass} onClick={() => setEpisode(null)}>
                        {t('mediaPlayerPage.back')}
                    </TvButton>
                    <span className="min-w-0 truncate text-sm font-semibold text-white/70">{episode.title}</span>
                </div>
                <ArtworkView key={episode.ratingKey} item={episode} toast={toast} />
            </>
        );
    }
    return (
        <>
            <div className="mb-4 flex flex-wrap gap-2" data-tv-rail="1">
                <TvButton type="button" data-tv-item="1" className={tabClass(tab === 'season')} onClick={() => setTab('season')}>
                    {item.title}
                </TvButton>
                <TvButton type="button" data-tv-item="1" className={tabClass(tab === 'episodes')} onClick={() => setTab('episodes')}>
                    {t('mediaPlayerPage.manageArtworkEpisodes')}
                </TvButton>
            </div>
            {tab === 'season' ? <ArtworkView item={item} toast={toast} /> : null}
            {tab === 'episodes' && !episodes ? <p className="py-6 text-white/60">{t('mediaPlayerPage.loading')}</p> : null}
            {tab === 'episodes' && episodes ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-tv-rail="1">
                    {episodes.map((row) => (
                        <TvButton
                            key={row.ratingKey}
                            type="button"
                            data-tv-item="1"
                            onClick={() => setEpisode(row)}
                            className="overflow-hidden rounded-xl border-2 border-white/10 bg-black/40 p-0 text-left outline-none focus:border-white focus:ring-4 focus:ring-white/60"
                        >
                            {row.thumb ? <img src={row.thumb} alt="" loading="lazy" className="aspect-video w-full object-cover" /> : <div className="aspect-video w-full bg-white/5" />}
                            <span className="block truncate px-3 py-2 text-sm font-semibold">{row.index ? `${row.index}. ` : ''}{row.title}</span>
                        </TvButton>
                    ))}
                </div>
            ) : null}
        </>
    );
};

const ArtworkView: React.FC<{ item: PlayerItem; toast: NonNullable<Props['onToast']> }> = ({ item, toast }) => {
    const { t } = useDiscoverI18n();
    const [kind, setKind] = useState<ManageArtworkKind>('poster');
    const [rows, setRows] = useState<ManageArtworkRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [url, setUrl] = useState('');
    const [reload, setReload] = useState(0);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const isTv = typeof document !== 'undefined' && (document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setRows([]);
        fetchManageArtwork(item.ratingKey, kind, item.serverId)
            .then((data) => { if (!cancelled) setRows(Array.isArray(data?.items) ? data.items : []); })
            .catch((error) => { if (!cancelled) toast(errorText(error) || t('mediaPlayerPage.actionError'), 'error'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.ratingKey, item.serverId, kind, reload]);

    const choose = async (choice: { id?: string; url?: string; data?: string; contentType?: string }) => {
        if (busy) return;
        setBusy(true);
        try {
            await setManageArtwork(item.ratingKey, kind, choice, item.serverId);
            toast(t('mediaPlayerPage.manageArtworkApplied'));
            await refreshAfterManageChange(item.ratingKey, { serverId: item.serverId, baseline: item });
            setUrl('');
            setReload((n) => n + 1);
        } catch (error) {
            toast(errorText(error) || t('mediaPlayerPage.actionError'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const upload = (file: File | null | undefined) => {
        if (!file || busy) return;
        if (file.size > 8 * 1024 * 1024) {
            toast(t('mediaPlayerPage.manageArtworkTooBig'), 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result || '');
            const data = text.slice(text.indexOf(',') + 1);
            if (data) void choose({ data, contentType: file.type });
        };
        reader.readAsDataURL(file);
    };

    const current = rows.find((row) => row.selected) || null;
    // Episode images are 16:9 title cards; only show/season/movie posters are portrait.
    const tall = kind === 'poster' && item.type !== 'episode';
    return (
        <>
            <div className="mb-4 flex flex-wrap gap-2" data-tv-rail="1">
                {((item.type === 'episode' ? ['poster'] : ['poster', 'art', 'logo']) as ManageArtworkKind[]).map((id) => (
                    <TvButton key={id} type="button" data-tv-item="1" className={tabClass(kind === id)} onClick={() => setKind(id)}>
                        {id === 'poster' && item.type === 'episode' ? t('mediaPlayerPage.manageArtworkEpisode') : t(kindLabelKey[id])}
                    </TvButton>
                ))}
            </div>
            {current ? (
                <div className="mb-5 flex items-center gap-4">
                    <img
                        src={current.thumb}
                        alt=""
                        className={`${tall ? 'h-40 w-auto' : kind === 'logo' ? 'h-20 w-auto bg-white/5 p-2' : 'h-28 w-auto'} rounded-lg border border-white/15 object-contain`}
                    />
                    <span className="text-xs font-black uppercase tracking-widest text-plex">{t('mediaPlayerPage.manageArtworkCurrent')}</span>
                </div>
            ) : null}
            {!isTv ? (
                <div className="mb-5">
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(event) => {
                            upload(event.target.files?.[0]);
                            event.target.value = '';
                        }}
                    />
                    <TvButton type="button" data-tv-item="1" disabled={busy} className={buttonClass} onClick={() => fileRef.current?.click()}>
                        {t('mediaPlayerPage.manageArtworkUpload')}
                    </TvButton>
                </div>
            ) : null}
            {loading ? <p className="py-6 text-white/60">{t('mediaPlayerPage.loading')}</p> : null}
            {!loading && !rows.length ? <p className="py-6 text-white/60">{t('mediaPlayerPage.manageNoArtwork')}</p> : null}
            <div
                className={`grid gap-3 ${tall ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}
                data-tv-rail="1"
            >
                {rows.map((row) => (
                    <TvButton
                        key={row.id}
                        type="button"
                        data-tv-item="1"
                        disabled={busy || row.selected}
                        onClick={() => void choose({ id: row.id })}
                        className="relative overflow-hidden rounded-xl border-2 border-white/10 bg-black/40 p-0 outline-none focus:border-white focus:ring-4 focus:ring-white/60 disabled:opacity-100"
                        aria-label={row.provider || t(kindLabelKey[kind])}
                    >
                        <img
                            src={row.thumb}
                            alt=""
                            loading="lazy"
                            className={`w-full ${tall ? 'aspect-[2/3] object-cover' : kind === 'logo' ? 'aspect-[5/2] bg-white/5 object-contain p-2' : 'aspect-video object-cover'}`}
                        />
                        {row.selected ? (
                            <span className="absolute right-2 top-2 rounded-full bg-plex p-1 text-black"><Check className="h-4 w-4" /></span>
                        ) : null}
                    </TvButton>
                ))}
            </div>
            <form
                className="mt-6 flex flex-wrap items-center gap-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    const value = url.trim();
                    if (value) void choose({ url: value });
                }}
            >
                <input
                    data-tv-item="1"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder={t('mediaPlayerPage.manageArtworkUrl')}
                    inputMode="url"
                    className={`${fieldClass} min-w-0 flex-1`}
                />
                <TvButton type="submit" data-tv-item="1" className={primaryClass} disabled={busy || !url.trim()}>
                    {t('mediaPlayerPage.manageArtworkAddUrl')}
                </TvButton>
            </form>
        </>
    );
};

const FIELD_ROWS: Array<{ key: keyof ManageFields; label: string; area?: boolean; types?: string[] }> = [
    { key: 'title', label: 'mediaPlayerPage.manageFieldTitle' },
    { key: 'titleSort', label: 'mediaPlayerPage.manageFieldSortTitle', types: ['movie', 'show', 'episode', 'season'] },
    { key: 'originallyAvailableAt', label: 'mediaPlayerPage.manageFieldReleased', types: ['movie', 'show', 'episode', 'season'] },
    { key: 'tagline', label: 'mediaPlayerPage.manageFieldTagline', types: ['movie', 'show'] },
    { key: 'studio', label: 'mediaPlayerPage.manageFieldStudio', types: ['movie', 'show'] },
    { key: 'contentRating', label: 'mediaPlayerPage.manageFieldRating', types: ['movie', 'show', 'episode'] },
    { key: 'summary', label: 'mediaPlayerPage.manageFieldSummary', area: true },
];

const EditView: React.FC<{ item: PlayerItem; toast: NonNullable<Props['onToast']>; onDone: () => void }> = ({ item, toast, onDone }) => {
    const { t } = useDiscoverI18n();
    const [type, setType] = useState('');
    const [original, setOriginal] = useState<ManageFields | null>(null);
    const [draft, setDraft] = useState<ManageFields | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchManageFields(item.ratingKey, item.serverId)
            .then((data) => {
                if (cancelled) return;
                setType(data.type);
                setOriginal(data.fields);
                setDraft(data.fields);
            })
            .catch((error) => { if (!cancelled) toast(errorText(error) || t('mediaPlayerPage.actionError'), 'error'); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.ratingKey, item.serverId]);

    const save = async () => {
        if (!draft || !original || busy) return;
        const changed: Partial<ManageFields> = {};
        (Object.keys(draft) as Array<keyof ManageFields>).forEach((key) => {
            if (draft[key] !== original[key]) changed[key] = draft[key];
        });
        if (changed.originallyAvailableAt && !/^\d{4}-\d{2}-\d{2}$/.test(changed.originallyAvailableAt)) {
            toast(t('mediaPlayerPage.manageDateFormat'), 'error');
            return;
        }
        if (!Object.keys(changed).length) {
            onDone();
            return;
        }
        setBusy(true);
        try {
            await saveManageFields(item.ratingKey, changed, item.serverId);
            toast(t('mediaPlayerPage.manageSaved'));
            await refreshAfterManageChange(item.ratingKey, { serverId: item.serverId, baseline: item });
            onDone();
        } catch (error) {
            toast(errorText(error) || t('mediaPlayerPage.actionError'), 'error');
        } finally {
            setBusy(false);
        }
    };

    if (!draft) return <p className="py-6 text-white/60">{t('mediaPlayerPage.loading')}</p>;
    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            {FIELD_ROWS.filter((row) => !row.types || row.types.includes(type)).map((row) => (
                <label key={row.key} className="flex flex-col gap-1.5">
                    <span className="text-xs font-black uppercase tracking-widest text-white/55">{t(row.label)}</span>
                    {row.area ? (
                        <textarea
                            data-tv-item="1"
                            rows={5}
                            value={draft[row.key]}
                            onChange={(event) => setDraft({ ...draft, [row.key]: event.target.value })}
                            className={fieldClass}
                        />
                    ) : (
                        <input
                            data-tv-item="1"
                            value={draft[row.key]}
                            onChange={(event) => setDraft({ ...draft, [row.key]: event.target.value })}
                            placeholder={row.key === 'originallyAvailableAt' ? 'YYYY-MM-DD' : undefined}
                            className={fieldClass}
                        />
                    )}
                </label>
            ))}
            <p className="text-xs text-white/45">{t('mediaPlayerPage.manageLockNote')}</p>
            <div className="flex gap-3" data-tv-rail="1">
                <TvButton type="submit" data-tv-item="1" className={primaryClass} disabled={busy}>{t('mediaPlayerPage.manageSave')}</TvButton>
                <TvButton type="button" data-tv-item="1" className={buttonClass} onClick={onDone}>{t('mediaPlayerPage.manageCancel')}</TvButton>
            </div>
        </form>
    );
};

const MatchView: React.FC<{ item: PlayerItem; toast: NonNullable<Props['onToast']>; onDone: () => void }> = ({ item, toast, onDone }) => {
    const { t } = useDiscoverI18n();
    const [title, setTitle] = useState(String(item.type === 'episode' ? (item.showTitle || item.title) : item.title || ''));
    const [year, setYear] = useState(item.year ? String(item.year) : '');
    const [rows, setRows] = useState<ManageMatchRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [picked, setPicked] = useState<ManageMatchRow | null>(null);
    const [confirmUnmatch, setConfirmUnmatch] = useState(false);
    const [busy, setBusy] = useState(false);
    const searchRef = useRef(0);

    const search = useCallback(async () => {
        const run = ++searchRef.current;
        setLoading(true);
        setPicked(null);
        try {
            const data = await fetchManageMatches(item.ratingKey, title.trim(), year.trim(), item.serverId);
            if (run === searchRef.current) setRows(Array.isArray(data?.items) ? data.items : []);
        } catch (error) {
            if (run === searchRef.current) toast(errorText(error) || t('mediaPlayerPage.actionError'), 'error');
        } finally {
            if (run === searchRef.current) setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.ratingKey, item.serverId, title, year]);

    useEffect(() => {
        void search();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const apply = async () => {
        if (!picked || busy) return;
        setBusy(true);
        try {
            await applyManageMatch(item.ratingKey, { guid: picked.guid, name: picked.name, year: picked.year }, item.serverId);
            toast(t('mediaPlayerPage.manageMatchApplied'));
            window.setTimeout(() => { void refreshAfterManageChange(item.ratingKey, { serverId: item.serverId, baseline: item }); }, 4000);
            onDone();
        } catch (error) {
            toast(errorText(error) || t('mediaPlayerPage.actionError'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const unmatch = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await unmatchManageItem(item.ratingKey, item.serverId);
            toast(t('mediaPlayerPage.manageUnmatched'));
            void refreshAfterManageChange(item.ratingKey, { serverId: item.serverId, baseline: item });
            onDone();
        } catch (error) {
            toast(errorText(error) || t('mediaPlayerPage.actionError'), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <form
                className="mb-4 flex flex-wrap items-center gap-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    void search();
                }}
            >
                <input data-tv-item="1" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('mediaPlayerPage.manageFieldTitle')} className={`${fieldClass} min-w-0 flex-1`} />
                <input data-tv-item="1" value={year} onChange={(event) => setYear(event.target.value)} placeholder={t('mediaPlayerPage.manageFieldYear')} inputMode="numeric" className={`${fieldClass} !w-28`} />
                <TvButton type="submit" data-tv-item="1" className={primaryClass} disabled={loading}>{t('mediaPlayerPage.manageSearch')}</TvButton>
            </form>
            {loading ? <p className="py-4 text-white/60">{t('mediaPlayerPage.loading')}</p> : null}
            {!loading && !rows.length ? <p className="py-4 text-white/60">{t('mediaPlayerPage.manageNoMatches')}</p> : null}
            <div className="flex flex-col gap-2" data-tv-rail="1">
                {rows.map((row) => (
                    <TvButton
                        key={row.guid}
                        type="button"
                        data-tv-item="1"
                        onClick={() => setPicked(row)}
                        className={`flex w-full items-center gap-4 rounded-xl border-2 p-3 text-left outline-none focus:border-white focus:ring-4 focus:ring-white/60 ${picked?.guid === row.guid ? 'border-plex bg-plex/10' : 'border-white/10 bg-white/[0.04]'}`}
                    >
                        {row.thumb ? <img src={row.thumb} alt="" loading="lazy" className="h-20 w-14 shrink-0 rounded-md object-cover" /> : <span className="h-20 w-14 shrink-0 rounded-md bg-white/10" />}
                        <span className="min-w-0 flex-1">
                            <span className="block text-base font-bold text-white">{row.name}{row.year ? ` (${row.year})` : ''}</span>
                            {row.summary ? <span className="mt-0.5 line-clamp-2 block text-sm text-white/60">{row.summary}</span> : null}
                        </span>
                        <span className="shrink-0 text-sm font-black text-plex">{row.score ? `${Math.round(row.score)}%` : ''}</span>
                    </TvButton>
                ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4" data-tv-rail="1">
                {picked ? (
                    <>
                        <span className="text-sm text-white/80">{t('mediaPlayerPage.manageMatchConfirm', { name: `${picked.name}${picked.year ? ` (${picked.year})` : ''}` })}</span>
                        <TvButton type="button" data-tv-item="1" className={primaryClass} disabled={busy} onClick={() => void apply()}>{t('mediaPlayerPage.manageApplyMatch')}</TvButton>
                        <TvButton type="button" data-tv-item="1" className={buttonClass} onClick={() => setPicked(null)}>{t('mediaPlayerPage.manageCancel')}</TvButton>
                    </>
                ) : confirmUnmatch ? (
                    <>
                        <span className="text-sm text-white/80">{t('mediaPlayerPage.manageUnmatchConfirm')}</span>
                        <TvButton type="button" data-tv-item="1" className={primaryClass} disabled={busy} onClick={() => void unmatch()}>{t('mediaPlayerPage.manageUnmatch')}</TvButton>
                        <TvButton type="button" data-tv-item="1" className={buttonClass} onClick={() => setConfirmUnmatch(false)}>{t('mediaPlayerPage.manageCancel')}</TvButton>
                    </>
                ) : (
                    <TvButton type="button" data-tv-item="1" className={buttonClass} onClick={() => setConfirmUnmatch(true)}>{t('mediaPlayerPage.manageUnmatch')}</TvButton>
                )}
            </div>
        </>
    );
};

const HistoryView: React.FC<{ item: PlayerItem; toast: NonNullable<Props['onToast']> }> = ({ item, toast }) => {
    const { t } = useDiscoverI18n();
    const [rows, setRows] = useState<ManageHistoryRow[] | null>(null);
    useEffect(() => {
        let cancelled = false;
        fetchManageHistory(item.ratingKey, item.serverId)
            .then((data) => { if (!cancelled) setRows(Array.isArray(data?.items) ? data.items : []); })
            .catch((error) => {
                if (cancelled) return;
                setRows([]);
                toast(errorText(error) || t('mediaPlayerPage.actionError'), 'error');
            });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.ratingKey, item.serverId]);
    if (!rows) return <p className="py-6 text-white/60">{t('mediaPlayerPage.loading')}</p>;
    if (!rows.length) return <p className="py-6 text-white/60">{t('mediaPlayerPage.manageNoHistory')}</p>;
    return (
        <div className="flex flex-col divide-y divide-white/10" data-tv-overlay-scroll="1">
            {rows.map((row, index) => (
                <div key={`${row.viewedAt}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                    <span className="min-w-0 flex-1 text-base font-semibold text-white">{row.title}</span>
                    <span className="text-sm text-white/60">{[row.user, row.device].filter(Boolean).join(' · ')}</span>
                    <span className="text-sm text-white/80">{row.viewedAt ? new Date(row.viewedAt).toLocaleString() : ''}</span>
                </div>
            ))}
        </div>
    );
};

const TITLE_KEY: Record<ManageView, string> = {
    artwork: 'mediaPlayerPage.manageChangeArtwork',
    edit: 'mediaPlayerPage.manageEditMetadata',
    match: 'mediaPlayerPage.manageFixMatch',
    history: 'mediaPlayerPage.managePlayHistory',
};

/** One screen for the Manage actions that need more than a button: artwork, metadata, match and play history. */
export const PlayerManageDialog: React.FC<Props> = ({ item, view, onClose, onToast }) => {
    const { t } = useDiscoverI18n();
    const toast = useMemo(() => onToast || (() => undefined), [onToast]);
    const closeRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        window.addEventListener('smp-tv-overlay-close', onClose);
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        const focusId = window.setTimeout(() => {
            // Forms start on Close: focusing a text field would pop the on-screen keyboard over the form straight away.
            const first = view === 'artwork'
                ? '[data-tv-manage="1"] [data-tv-item="1"]:not([data-tv-manage-close="1"]):not(input):not(textarea)'
                : '[data-tv-manage-close="1"]';
            document.querySelector<HTMLElement>(first)?.focus({ preventScroll: true });
        }, 120);
        return () => {
            window.removeEventListener('smp-tv-overlay-close', onClose);
            window.removeEventListener('keydown', onKey);
            window.clearTimeout(focusId);
        };
    }, [onClose, view]);

    if (typeof document === 'undefined') return null;
    const heading = item.type === 'episode' ? `${item.showTitle || ''} · ${item.title}`.replace(/^ · /, '') : item.title;
    return createPortal(
        <div
            className="fixed inset-0 z-[3600] flex items-stretch justify-center bg-black/90 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={t(TITLE_KEY[view])}
            data-tv-select-menu="1"
            data-tv-manage="1"
        >
            <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden bg-[#121214] text-white sm:rounded-3xl sm:border sm:border-white/10">
                <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-8">
                    <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-widest text-plex">{t(TITLE_KEY[view])}</p>
                        <h2 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{heading}</h2>
                    </div>
                    <TvButton
                        ref={closeRef}
                        type="button"
                        data-tv-item="1"
                        data-tv-manage-close="1"
                        className="shrink-0 rounded-full bg-white/10 p-2.5 text-white outline-none hover:bg-white/20 focus:bg-white focus:text-black"
                        onClick={onClose}
                        aria-label={t('common.close')}
                    >
                        <X className="h-6 w-6" />
                    </TvButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8" data-tv-overlay-scroll="1">
                    {view === 'artwork' ? (item.type === 'season' ? <SeasonArtwork item={item} toast={toast} /> : <ArtworkView item={item} toast={toast} />) : null}
                    {view === 'edit' ? <EditView item={item} toast={toast} onDone={onClose} /> : null}
                    {view === 'match' ? <MatchView item={item} toast={toast} onDone={onClose} /> : null}
                    {view === 'history' ? <HistoryView item={item} toast={toast} /> : null}
                </div>
            </div>
        </div>,
        document.body,
    );
};
