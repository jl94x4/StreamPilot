import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Play, Radio, X } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { fetchLiveTvGuide, fetchLiveTvOnNow, fetchLiveTvSources } from './api';
import { plexImageUrl } from './playerUtils';
import type { PlayerItem, PlayerPlayOptions } from './types';

type GuideRow = {
    channel: {
        id: string;
        number: string;
        title: string;
        callSign: string;
        thumb?: string | null;
        dvrId: string;
        serverId: string;
    };
    airings: PlayerItem[];
};

const clock = (unix: number) => {
    const date = new Date(unix * 1000);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const pct = (value: number, start: number, end: number) => (
    Math.max(0, Math.min(100, ((value - start) / Math.max(1, end - start)) * 100))
);

const onAir = (airing: PlayerItem, nowSec: number) => (
    Number(airing.liveStartsAt || 0) <= nowSec && Number(airing.liveEndsAt || 0) > nowSec
);

/**
 * "1 British TV" on channel 1 reads as "British TV": the number is shown on its own. Plex's
 * channelTitle is "<number> <callSign>" and Tunarr's call sign starts with the number too,
 * so it can be there twice ("1 1 British TV").
 */
const channelName = (title?: string | null, number?: string | null) => {
    let name = String(title || '').trim();
    const num = String(number || '').trim();
    while (num && name.startsWith(`${num} `) && name.length > num.length + 1) {
        name = name.slice(num.length + 1).trim();
    }
    return name;
};

/**
 * Tunarr / HDHomeRun guides point artwork at the tuner's own http:// address on the LAN.
 * The page is https, so the WebView blocks those <img> loads (mixed content), and PMS's
 * photo transcoder won't fetch private addresses. The app's fetch can, so load them into
 * a blob. Away from that LAN they can't load at all and the caller shows its placeholder.
 */
const lanImageCache = new Map<string, Promise<string>>();
const loadLanImage = (src: string) => {
    let hit = lanImageCache.get(src);
    if (!hit) {
        hit = fetch(src)
            .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
            .then((blob) => URL.createObjectURL(blob));
        hit.catch(() => lanImageCache.delete(src));
        lanImageCache.set(src, hit);
    }
    return hit;
};

const LiveImg: React.FC<{
    src?: string | null;
    className?: string;
    fallback?: React.ReactNode;
    lazy?: boolean;
}> = ({ src, className, fallback = null, lazy = false }) => {
    const raw = String(src || '');
    const lan = /^http:\/\//i.test(raw);
    const [resolved, setResolved] = useState(() => (lan ? '' : raw));
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        setFailed(false);
        if (!lan) {
            setResolved(raw);
            return undefined;
        }
        let live = true;
        setResolved('');
        loadLanImage(raw).then((url) => { if (live) setResolved(url); }, () => { if (live) setFailed(true); });
        return () => { live = false; };
    }, [raw, lan]);
    if (!raw || failed) return <>{fallback}</>;
    if (!resolved) return null;
    return (
        <img
            className={className}
            src={resolved}
            alt=""
            aria-hidden
            loading={lazy ? 'lazy' : undefined}
            decoding="async"
            onError={() => setFailed(true)}
        />
    );
};

/**
 * Guide Up / Down: the cell in the neighbouring channel that is on at the same moment as the
 * focused one (its visible start), like a TV guide. Plain spatial nav picked the nearest box,
 * often a programme that had already ended at the left edge.
 */
const cellAt = (airings: PlayerItem[], at: number) => {
    const index = airings.findIndex((airing) => (
        Number(airing.liveStartsAt || 0) <= at && Number(airing.liveEndsAt || 0) > at
    ));
    if (index >= 0) return index;
    const after = airings.findIndex((airing) => Number(airing.liveStartsAt || 0) >= at);
    return after >= 0 ? after : Math.max(0, airings.length - 1);
};

const airingTitle = (airing: PlayerItem) => (
    airing.showTitle && airing.episodeTitle ? airing.showTitle : (airing.episodeTitle || airing.title)
);

type HeroHandle = { show: (airing: PlayerItem | null) => void };

/** "gb/15" reads as "15"; "TV-PG" stays. */
const ratingLabel = (value?: string | null) => String(value || '').replace(/^[a-z]{2}\//i, '').trim();

const resolutionLabel = (value?: string | null) => {
    const n = Number(String(value || '').replace(/\D/g, ''));
    if (!n) return '';
    if (n >= 2000) return '4K';
    if (n >= 1000) return '1080p';
    if (n >= 700) return '720p';
    return 'SD';
};

const lengthLabel = (seconds: number) => {
    if (!seconds || seconds < 60) return '';
    const minutes = Math.round(seconds / 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

/**
 * The big panel at the top of Live TV: whatever is focused below (a poster or a guide cell).
 * It keeps its own state, so moving focus never re-renders the guide grid or poster rows.
 */
const LiveHero = React.memo(forwardRef<HeroHandle, { initial: PlayerItem | null; compact?: boolean }>(
    ({ initial, compact = false }, ref) => {
        const { t } = useDiscoverI18n();
        const [airing, setAiring] = useState<PlayerItem | null>(initial);
        const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
        useImperativeHandle(ref, () => ({ show: (next) => { if (next) setAiring(next); } }), []);
        useEffect(() => { if (initial && !airing) setAiring(initial); }, [initial, airing]);
        useEffect(() => {
            const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
            return () => window.clearInterval(id);
        }, []);
        if (!airing) return <div className={`smp-live-hero is-empty${compact ? ' is-compact' : ''}`} aria-hidden />;
        const from = Number(airing.liveStartsAt || 0);
        const to = Number(airing.liveEndsAt || 0);
        const live = onAir(airing, nowSec);
        const left = live && to ? Math.max(1, Math.round((to - nowSec) / 60)) : 0;
        const channel = [airing.liveChannelNumber, channelName(airing.liveChannelTitle, airing.liveChannelNumber)]
            .filter(Boolean).join('  ·  ');
        const when = from ? `${clock(from)}${to ? ` – ${clock(to)}` : ''}` : '';
        const episodeLine = airing.showTitle && airing.episodeTitle
            ? [
                airing.parentIndex && airing.index ? `S${airing.parentIndex} · E${airing.index}` : '',
                airing.episodeTitle,
            ].filter(Boolean).join('  ·  ')
            : '';
        const pills = [
            ratingLabel(airing.contentRating),
            when,
            lengthLabel(to - from),
            ...(airing.genres || []).slice(0, 2),
            resolutionLabel(airing.liveResolution),
        ].filter(Boolean);
        const starring = (airing.cast || []).slice(0, 3).map((row) => row.name).filter(Boolean);
        return (
            <section className={`smp-live-hero${compact ? ' is-compact' : ''}`} aria-live="polite">
                {/* Tunarr guides have posters but no wide art: the poster then fills the
                    backdrop too (same cached image, no blur, so cheap on TV sticks). */}
                <LiveImg
                    src={airing.art || airing.thumb}
                    className={`smp-live-hero-art${airing.art ? '' : ' is-poster'}`}
                />
                <div className="smp-live-hero-fade" aria-hidden />
                <div className="smp-live-hero-copy">
                    <p className="smp-live-hero-eyebrow">
                        {live ? <span className="smp-live-badge"><i aria-hidden />{t('mediaPlayerPage.liveTvLive')}</span> : null}
                        <span>{channel}</span>
                        {airing.liveIsNew ? <span className="smp-live-new">{t('mediaPlayerPage.liveTvNew')}</span> : null}
                    </p>
                    <h2 className="smp-live-hero-title">{airingTitle(airing)}</h2>
                    {episodeLine ? <p className="smp-live-hero-episode">{episodeLine}</p> : null}
                    {pills.length ? (
                        <div className="smp-live-hero-pills">
                            {pills.map((pill, index) => <span key={`${pill}-${index}`}>{pill}</span>)}
                        </div>
                    ) : null}
                    {airing.summary ? <p className="smp-live-hero-summary">{airing.summary}</p> : null}
                    {starring.length ? (
                        <p className="smp-live-hero-cast">
                            <b>{t('mediaPlayerPage.liveTvStarring')}</b> {starring.join(', ')}
                        </p>
                    ) : null}
                    {live ? (
                        <div className="smp-live-hero-progress">
                            <div className="smp-live-hero-bar" aria-hidden>
                                <span style={{ width: `${pct(nowSec, from, to)}%` }} />
                            </div>
                            <span>{t('mediaPlayerPage.liveTvMinLeft', { n: left })}</span>
                        </div>
                    ) : null}
                </div>
                <LiveImg src={airing.thumb} className="smp-live-hero-poster" />
            </section>
        );
    },
));
LiveHero.displayName = 'LiveHero';

/** A poster for one channel's airing (On now / Up next). */
const LivePoster: React.FC<{
    airing: PlayerItem;
    nowSec: number;
    upNext?: boolean;
    onFocusAiring: (airing: PlayerItem) => void;
    onSelect: (airing: PlayerItem) => void;
}> = ({ airing, nowSec, upNext = false, onFocusAiring, onSelect }) => {
    const { t } = useDiscoverI18n();
    const from = Number(airing.liveStartsAt || 0);
    const to = Number(airing.liveEndsAt || 0);
    const live = !upNext && onAir(airing, nowSec);
    const name = channelName(airing.liveChannelTitle, airing.liveChannelNumber);
    return (
        <button
            type="button"
            data-tv-item="1"
            data-tv-live-poster="1"
            className="smp-live-poster"
            onFocus={() => onFocusAiring(airing)}
            onClick={() => onSelect(airing)}
        >
            <span className="smp-live-poster-art">
                <LiveImg
                    src={airing.thumb}
                    lazy
                    fallback={<span className="smp-live-poster-blank"><Radio className="h-8 w-8" /><b>{airingTitle(airing)}</b></span>}
                />
                {airing.liveChannelNumber ? <span className="smp-live-poster-ch">{airing.liveChannelNumber}</span> : null}
                {live ? <span className="smp-live-badge is-corner"><i aria-hidden />{t('mediaPlayerPage.liveTvLive')}</span> : null}
                {live && to ? (
                    <span className="smp-live-poster-bar" aria-hidden><span style={{ width: `${pct(nowSec, from, to)}%` }} /></span>
                ) : null}
            </span>
            <span className="smp-live-poster-name">{name || airingTitle(airing)}</span>
            <span className="smp-live-poster-time">
                {live
                    ? t('mediaPlayerPage.liveTvMinLeft', { n: Math.max(1, Math.round((to - nowSec) / 60)) })
                    : (from ? t('mediaPlayerPage.liveTvStartsAt', { time: clock(from) }) : '')}
            </span>
        </button>
    );
};

/**
 * Live TV from the Plex server's DVR: a Guide grid (channels down the side, time across,
 * a now line) and an On Now row. Styled like the rest of the TV app.
 */
export const PlayerLiveTv: React.FC<{
    onBack: () => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}> = ({ onBack, onPlay }) => {
    const { t } = useDiscoverI18n();
    const [tab, setTab] = useState<'guide' | 'onnow'>('guide');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [startsAt, setStartsAt] = useState(0);
    const [endsAt, setEndsAt] = useState(0);
    const [rows, setRows] = useState<GuideRow[]>([]);
    const [serverName, setServerName] = useState('');
    const [onNow, setOnNow] = useState<PlayerItem[]>([]);
    const [sheet, setSheet] = useState<PlayerItem | null>(null);
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
    const watchRef = useRef<HTMLButtonElement>(null);
    const heroRef = useRef<HeroHandle>(null);
    const showInHero = useCallback((airing: PlayerItem) => heroRef.current?.show(airing), []);
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const sources = await fetchLiveTvSources();
            if (!sources.available) {
                setRows([]);
                setOnNow([]);
                setError(t('mediaPlayerPage.liveTvEmpty'));
                return;
            }
            const [guide, now] = await Promise.all([
                fetchLiveTvGuide({ hours: 4 }),
                fetchLiveTvOnNow(),
            ]);
            setStartsAt(guide.startsAt);
            setEndsAt(guide.endsAt);
            setRows((guide.guides || []).flatMap((group) => group.rows || []));
            setServerName(String(guide.guides?.[0]?.source?.serverName || ''));
            setOnNow(now.items || []);
        } catch (err: any) {
            setError(err?.message || t('mediaPlayerPage.liveTvError'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { void load(); }, [load]);

    // The now line and "on now" tint follow the clock.
    useEffect(() => {
        const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
        return () => window.clearInterval(id);
    }, []);

    useEffect(() => {
        if (!sheet) return undefined;
        const id = window.setTimeout(() => watchRef.current?.focus(), 60);
        return () => window.clearTimeout(id);
    }, [sheet]);

    const ticks = useMemo(() => {
        if (!startsAt || !endsAt) return [];
        const out: number[] = [];
        for (let tick = Math.ceil(startsAt / 1800) * 1800; tick < endsAt; tick += 1800) out.push(tick);
        return out;
    }, [startsAt, endsAt]);

    /** Each channel's current and next airing, from the guide (the On Now feed as fallback). */
    const withChannel = (airing: PlayerItem, row: GuideRow): PlayerItem => ({
        ...airing,
        liveChannelId: airing.liveChannelId || row.channel.id,
        liveChannelNumber: airing.liveChannelNumber || row.channel.number,
        liveChannelTitle: airing.liveChannelTitle || row.channel.title,
        liveDvrId: airing.liveDvrId || row.channel.dvrId,
        serverId: airing.serverId || row.channel.serverId,
    });
    const minute = Math.floor(nowSec / 60);
    const nowRow = useMemo(() => {
        const at = minute * 60;
        const fromGuide = rows
            .map((row) => {
                const airing = row.airings.find((entry) => onAir(entry, at));
                return airing ? withChannel(airing, row) : null;
            })
            .filter(Boolean) as PlayerItem[];
        return fromGuide.length ? fromGuide : onNow;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, onNow, minute]);
    const nextRow = useMemo(() => {
        const at = minute * 60;
        return rows
            .map((row) => {
                const airing = row.airings.find((entry) => Number(entry.liveStartsAt || 0) > at);
                return airing ? withChannel(airing, row) : null;
            })
            .filter(Boolean) as PlayerItem[];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, minute]);
    const heroSeed = nowRow[0] || nextRow[0] || null;

    const nowPct = startsAt && endsAt && nowSec >= startsAt && nowSec < endsAt ? pct(nowSec, startsAt, endsAt) : null;

    const openAiring = (airing: PlayerItem, row?: GuideRow) => setSheet({
        ...airing,
        liveChannelId: airing.liveChannelId || row?.channel.id,
        liveChannelNumber: airing.liveChannelNumber || row?.channel.number,
        liveChannelTitle: airing.liveChannelTitle || row?.channel.title,
        liveDvrId: airing.liveDvrId || row?.channel.dvrId,
        serverId: airing.serverId || row?.channel.serverId,
    });

    const watch = (item: PlayerItem) => {
        const row = rows.find((entry) => (
            entry.channel.id === item.liveChannelId
            || entry.channel.number === item.liveChannelNumber
            || entry.channel.dvrId === item.liveDvrId
        ));
        setSheet(null);
        onPlay({
            ...item,
            liveChannelId: item.liveChannelId || row?.channel.id,
            liveChannelNumber: item.liveChannelNumber || row?.channel.number,
            liveChannelTitle: item.liveChannelTitle || row?.channel.title,
            liveDvrId: item.liveDvrId || row?.channel.dvrId,
            serverId: item.serverId || row?.channel.serverId,
            type: 'liveAiring',
            canPlay: true,
        });
    };

    const placeholder = (row: GuideRow): PlayerItem => ({
        ratingKey: `empty-${row.channel.id}`,
        title: row.channel.title || t('mediaPlayerPage.liveTvNoAiring'),
        type: 'liveAiring',
        liveStartsAt: startsAt,
        liveEndsAt: endsAt,
        liveChannelId: row.channel.id,
        liveChannelNumber: row.channel.number,
        liveChannelTitle: row.channel.title,
        liveDvrId: row.channel.dvrId,
        serverId: row.channel.serverId,
        canPlay: true,
    } as PlayerItem);

    const guideRows = rows.slice(0, 120);
    const cellsByRow = guideRows.map((row) => (row.airings.length ? row.airings : [placeholder(row)]));

    const sheetOnAir = sheet ? onAir(sheet, nowSec) : false;
    const sheetProgress = sheet && sheetOnAir
        ? pct(nowSec, Number(sheet.liveStartsAt), Number(sheet.liveEndsAt))
        : 0;

    return (
        <div className="smp-live" data-tv-live="1">
            <div data-tv-page-top="1" className="h-0 w-full" aria-hidden />
            <header className="smp-live-head">
                <div className="min-w-0">
                    <h1 className="smp-live-title">{t('mediaPlayerPage.liveTv')}</h1>
                    {serverName ? <p className="smp-live-sub">{serverName}</p> : null}
                </div>
                <div
                    className="smp-live-tabs"
                    data-tv-row="1"
                    data-tv-scroll-top="1"
                    role="tablist"
                    // Down lands on the first programme on now, not whatever sits under the tab.
                    data-tv-down-to={tab === 'onnow'
                        ? '[data-tv-row-id="livetv:onnow"] [data-tv-item="1"]'
                        : '.smp-live-rows .smp-live-cell.is-now'}
                >
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === 'guide'}
                        data-tv-item="1"
                        className={tab === 'guide' ? 'is-on' : ''}
                        onClick={() => setTab('guide')}
                    >
                        {t('mediaPlayerPage.liveTvGuide')}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === 'onnow'}
                        data-tv-item="1"
                        className={tab === 'onnow' ? 'is-on' : ''}
                        onClick={() => setTab('onnow')}
                    >
                        {t('mediaPlayerPage.liveTvOnNow')}
                    </button>
                    {!isTvShell ? (
                        <button type="button" onClick={onBack}>{t('common.back')}</button>
                    ) : null}
                </div>
            </header>

            {error && !rows.length && !loading ? (
                <div className="smp-live-empty">
                    <span className="smp-live-empty-icon"><Radio className="h-7 w-7" /></span>
                    <p>{error}</p>
                </div>
            ) : null}

            {!error || rows.length ? (
                <LiveHero key={tab} ref={heroRef} initial={heroSeed} compact={tab === 'guide'} />
            ) : null}

            {tab === 'onnow' ? (
                nowRow.length ? (
                    <>
                        <section className="smp-live-shelf">
                            <h3 className="smp-live-shelf-title">{t('mediaPlayerPage.liveTvOnAir')}</h3>
                            <div
                                className="smp-live-posters"
                                data-tv-row="1"
                                data-tv-rail="1"
                                data-tv-row-id="livetv:onnow"
                                data-tv-scroll-top="1"
                                data-tv-up-to=".smp-live-tabs button.is-on"
                            >
                                {nowRow.map((airing) => (
                                    <LivePoster
                                        key={`now:${airing.liveChannelId || airing.ratingKey}`}
                                        airing={airing}
                                        nowSec={nowSec}
                                        onFocusAiring={showInHero}
                                        onSelect={watch}
                                    />
                                ))}
                            </div>
                        </section>
                        {nextRow.length ? (
                            <section className="smp-live-shelf">
                                <h3 className="smp-live-shelf-title">{t('mediaPlayerPage.liveTvUpNext')}</h3>
                                <div className="smp-live-posters is-next" data-tv-row="1" data-tv-rail="1" data-tv-row-id="livetv:next">
                                    {nextRow.map((airing) => (
                                        <LivePoster
                                            key={`next:${airing.liveChannelId || airing.ratingKey}`}
                                            airing={airing}
                                            nowSec={nowSec}
                                            upNext
                                            onFocusAiring={showInHero}
                                            onSelect={(item) => openAiring(item)}
                                        />
                                    ))}
                                </div>
                            </section>
                        ) : null}
                    </>
                ) : (!loading && !error ? (
                    <div className="smp-live-empty"><p>{t('mediaPlayerPage.liveTvOnNowEmpty')}</p></div>
                ) : null)
            ) : (loading || rows.length) ? (
                <div className="smp-live-guide">
                    <div className="smp-live-ruler" aria-hidden>
                        <div className="smp-live-ruler-corner">{nowPct != null ? t('mediaPlayerPage.liveTvNow') : ''}</div>
                        <div className="smp-live-ruler-track">
                            {ticks.map((tick) => (
                                <span key={tick} style={{ left: `${pct(tick, startsAt, endsAt)}%` }}>{clock(tick)}</span>
                            ))}
                        </div>
                    </div>
                    <div className="smp-live-rows">
                        {nowPct != null ? (
                            <div className="smp-live-nowline" style={{ ['--now' as string]: `${nowPct}` } as React.CSSProperties} aria-hidden />
                        ) : null}
                        {loading && !rows.length ? (
                            Array.from({ length: 5 }, (_, index) => (
                                <div key={index} className="smp-live-row is-skeleton" aria-hidden>
                                    <div className="smp-live-channel"><span className="smp-live-logo" /></div>
                                    <div className="smp-live-track"><span className="smp-live-cell" style={{ left: '0%', width: '62%' }} /></div>
                                </div>
                            ))
                        ) : guideRows.map((row, rowIndex) => {
                            const airings = cellsByRow[rowIndex];
                            return (
                                <div
                                    key={row.channel.id}
                                    className="smp-live-row"
                                    data-tv-row="1"
                                    data-tv-up-to={rowIndex === 0 ? '.smp-live-tabs button.is-on' : undefined}
                                >
                                    <div className="smp-live-channel">
                                        <span className="smp-live-logo">
                                            <LiveImg
                                                src={row.channel.thumb ? (plexImageUrl(row.channel.thumb, 120, 120) || row.channel.thumb) : ''}
                                                fallback={<Radio className="h-5 w-5" />}
                                            />
                                        </span>
                                        <span className="smp-live-channel-text">
                                            <span className="smp-live-channel-number">{row.channel.number}</span>
                                            <span className="smp-live-channel-name">{channelName(row.channel.title, row.channel.number) || row.channel.callSign}</span>
                                        </span>
                                    </div>
                                    <div className="smp-live-track">
                                        {airings.map((airing, cellIndex) => {
                                            const from = Math.max(startsAt, Number(airing.liveStartsAt || startsAt));
                                            const to = Math.min(endsAt, Number(airing.liveEndsAt || endsAt));
                                            const live = onAir(airing, nowSec);
                                            const progress = live ? pct(nowSec, Number(airing.liveStartsAt), Number(airing.liveEndsAt)) : 0;
                                            return (
                                                <button
                                                    key={airing.ratingKey}
                                                    type="button"
                                                    data-tv-item="1"
                                                    id={`smp-live-cell-${rowIndex}-${cellIndex}`}
                                                    data-tv-up-to={rowIndex > 0
                                                        ? `#smp-live-cell-${rowIndex - 1}-${cellAt(cellsByRow[rowIndex - 1], Math.max(startsAt, from, nowSec))}`
                                                        : undefined}
                                                    data-tv-down-to={rowIndex < cellsByRow.length - 1
                                                        ? `#smp-live-cell-${rowIndex + 1}-${cellAt(cellsByRow[rowIndex + 1], Math.max(startsAt, from, nowSec))}`
                                                        : undefined}
                                                    className={`smp-live-cell${live ? ' is-now' : ''}`}
                                                    onFocus={() => showInHero(withChannel(airing, row))}
                                                    style={{
                                                        left: `${pct(from, startsAt, endsAt)}%`,
                                                        width: `${Math.max(2, pct(to, startsAt, endsAt) - pct(from, startsAt, endsAt))}%`,
                                                    }}
                                                    onClick={() => openAiring(airing, row)}
                                                >
                                                    <span className="smp-live-cell-title">{airing.showTitle && airing.episodeTitle ? airing.showTitle : (airing.episodeTitle || airing.title)}</span>
                                                    <span className="smp-live-cell-time">
                                                        {clock(Number(airing.liveStartsAt || startsAt))}
                                                        {airing.liveEndsAt ? ` – ${clock(Number(airing.liveEndsAt))}` : ''}
                                                    </span>
                                                    {live ? <span className="smp-live-cell-progress" style={{ width: `${progress}%` }} aria-hidden /> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            {sheet ? (
                <div className={`smp-resume${isTvShell ? ' is-tv' : ''}`} role="dialog" aria-modal="true" aria-labelledby="live-sheet-title" data-tv-overlay="1">
                    <div className="smp-resume-scrim" aria-hidden onClick={() => setSheet(null)} />
                    <div className="smp-resume-card player-resume-dialog-enter">
                        <LiveImg src={sheet.art} className="smp-resume-art" />
                        <div className="smp-resume-fade" aria-hidden />
                        <div className="smp-resume-body">
                            <p className="smp-resume-eyebrow">
                                {[sheet.liveChannelNumber, channelName(sheet.liveChannelTitle, sheet.liveChannelNumber)].filter(Boolean).join(' · ')}
                                {sheetOnAir ? ` · ${t('mediaPlayerPage.liveTvOnAir')}` : ''}
                            </p>
                            <h2 id="live-sheet-title" className="smp-resume-title">
                                {sheet.showTitle && sheet.episodeTitle ? sheet.showTitle : (sheet.episodeTitle || sheet.title)}
                            </h2>
                            {sheet.showTitle && sheet.episodeTitle ? <p className="smp-resume-episode">{sheet.episodeTitle}</p> : null}
                            {sheet.liveStartsAt ? (
                                <p className="smp-resume-episode">
                                    {clock(Number(sheet.liveStartsAt))}
                                    {sheet.liveEndsAt ? ` – ${clock(Number(sheet.liveEndsAt))}` : ''}
                                </p>
                            ) : null}
                            {sheet.summary ? <p className="smp-live-sheet-summary">{sheet.summary}</p> : null}
                            {sheetOnAir ? (
                                <div className="smp-resume-progress">
                                    <div className="smp-resume-bar"><span style={{ width: `${sheetProgress}%` }} /></div>
                                </div>
                            ) : null}
                            <div className="smp-resume-actions" data-tv-rail="1" data-tv-row="1">
                                <button
                                    ref={watchRef}
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    className="smp-resume-btn is-primary"
                                    onClick={() => watch(sheet)}
                                >
                                    <Play className="h-5 w-5 shrink-0 fill-current" />
                                    {t('mediaPlayerPage.liveTvWatch')}
                                </button>
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    className="smp-resume-btn is-icon"
                                    aria-label={t('common.close')}
                                    onClick={() => setSheet(null)}
                                >
                                    <X className="h-5 w-5 shrink-0" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
