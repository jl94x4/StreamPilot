import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Radio, X } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { fetchLiveTvGuide, fetchLiveTvOnNow, fetchLiveTvSources } from './api';
import { PlayerRail } from './PlayerRail';
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
        setSheet(null);
        onPlay(item);
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
                <div className="smp-live-tabs" data-tv-row="1" role="tablist">
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

            {tab === 'onnow' ? (
                onNow.length ? (
                    <PlayerRail
                        title={t('mediaPlayerPage.liveTvOnNow')}
                        rowId="livetv:onnow"
                        items={onNow}
                        density={7}
                        aspect="16/9"
                        onOpenItem={(item) => openAiring(item)}
                        onPlay={watch}
                    />
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
                        ) : rows.slice(0, 120).map((row) => {
                            const airings = row.airings.length ? row.airings : [placeholder(row)];
                            return (
                                <div key={row.channel.id} className="smp-live-row" data-tv-row="1">
                                    <div className="smp-live-channel">
                                        <span className="smp-live-logo">
                                            {row.channel.thumb ? (
                                                <img src={plexImageUrl(row.channel.thumb, 120, 120) || row.channel.thumb} alt="" />
                                            ) : (
                                                <Radio className="h-5 w-5" />
                                            )}
                                        </span>
                                        <span className="smp-live-channel-text">
                                            <span className="smp-live-channel-number">{row.channel.number}</span>
                                            <span className="smp-live-channel-name">{row.channel.title || row.channel.callSign}</span>
                                        </span>
                                    </div>
                                    <div className="smp-live-track">
                                        {airings.map((airing) => {
                                            const from = Math.max(startsAt, Number(airing.liveStartsAt || startsAt));
                                            const to = Math.min(endsAt, Number(airing.liveEndsAt || endsAt));
                                            const live = onAir(airing, nowSec);
                                            const progress = live ? pct(nowSec, Number(airing.liveStartsAt), Number(airing.liveEndsAt)) : 0;
                                            return (
                                                <button
                                                    key={airing.ratingKey}
                                                    type="button"
                                                    data-tv-item="1"
                                                    className={`smp-live-cell${live ? ' is-now' : ''}`}
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
                        {sheet.art ? <img className="smp-resume-art" src={sheet.art} alt="" aria-hidden /> : null}
                        <div className="smp-resume-fade" aria-hidden />
                        <div className="smp-resume-body">
                            <p className="smp-resume-eyebrow">
                                {[sheet.liveChannelNumber, sheet.liveChannelTitle].filter(Boolean).join(' · ')}
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
