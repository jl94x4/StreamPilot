import { Calendar,ChevronLeft,ChevronRight,Clock,DownloadCloud,ExternalLink,FileText,Film,HardDrive,Music,RefreshCw,Tv } from 'lucide-react';
import React,{ useCallback,useEffect,useMemo,useState } from 'react';

import { useDiscoverI18n } from '../discovery/i18n';
import { apiFetch } from '../shared/api';
import {
DashboardHero,
DashboardPageShell,
DashboardPanel,
dashboardPanelClass,
dashboardSubnavLinkClass
} from '../shared/dashboard/DashboardChrome';
import { formatTime } from '../shared/format';
import { Loader } from '../shared/toast';
import { usePoll } from '../shared/usePoll';
import { DetailsModal } from './analytics';


export const MediaStackDashboard: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
    const { locale, t } = useDiscoverI18n();
    const [detailsItem, setDetailsItem] = useState<any>(null);
    const [data, setData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [monthOffset, setMonthOffset] = useState(0);
    const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
    const [activeCalendarItem, setActiveCalendarItem] = useState<any>(null);
    const [autoMonthNotice, setAutoMonthNotice] = useState('');

    const stackInstances = useMemo(() => {
        const fromApi = Array.isArray(data?.instances) ? data.instances : [];
        if (fromApi.length > 0) {
            return [...fromApi].sort((a: any, b: any) => {
                if (a.type !== b.type) return a.type === 'sonarr' ? -1 : 1;
                if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
        }
        const fallback: any[] = [];
        if (data?.sonarr) {
            fallback.push({
                ...data.sonarr,
                id: 'sonarr-default',
                type: 'sonarr',
                name: data.sonarr.instanceName || 'Sonarr',
            });
        }
        if (data?.radarr) {
            fallback.push({
                ...data.radarr,
                id: 'radarr-default',
                type: 'radarr',
                name: data.radarr.instanceName || 'Radarr',
            });
        }
        return fallback;
    }, [data]);

    const switchInstance = (instanceId: string) => {
        if (instanceId === activeInstanceId) return;
        setActiveInstanceId(instanceId);
        setAutoMonthNotice('');
        setMonthOffset(0);
    };

    useEffect(() => {
        if (stackInstances.length === 0) {
            setActiveInstanceId(null);
            return;
        }
        if (activeInstanceId && stackInstances.some((entry: any) => entry.id === activeInstanceId)) return;
        const preferred = stackInstances.find((entry: any) => entry.isDefault) || stackInstances[0];
        setActiveInstanceId(preferred?.id || null);
    }, [stackInstances, activeInstanceId]);

    const activeInstanceData = useMemo(() => {
        if (!stackInstances.length) return null;
        return stackInstances.find((entry: any) => entry.id === activeInstanceId) || stackInstances[0];
    }, [stackInstances, activeInstanceId]);

    const activeInstanceType = activeInstanceData?.type === 'radarr' ? 'radarr' : 'sonarr';
    const isTvInstance = activeInstanceType === 'sonarr';

    const fetchData = useCallback(async () => {
        try {
            const res = await apiFetch('/api/media-stack/summary?monthOffset=' + monthOffset);
            if (res.error) throw new Error(res.error);
            setData(res);
        } catch (err: any) {
            setError(err.message || t('calendar.errors.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    }, [monthOffset, t]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    usePoll(() => { void fetchData(); }, 30_000);

    const formatRelativeAirDate = (date: Date) => {
        const now = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;
        const timeStr = isMidnight ? '' : t('calendar.relative.atTime', { time: formatTime(date) });

        const diffDays = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (date >= today && date < tomorrow) {
            return `${t('calendar.relative.today')}${timeStr}`;
        }
        const dayAfterTomorrow = new Date(tomorrow);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
        if (date >= tomorrow && date < dayAfterTomorrow) {
            return `${t('calendar.relative.tomorrow')}${timeStr}`;
        }
        if (diffDays > 1 && diffDays < 7) {
            const dayName = date.toLocaleDateString(locale, { weekday: 'long' });
            return `${dayName}${timeStr}`;
        }
        return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) + timeStr;
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0.0 GB';
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return `${gb.toFixed(1)} GB`;
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
    };

    const calendarItems = useMemo(() => {
        if (!activeInstanceData?.calendar) return [];
        const items: any[] = [];
        if (isTvInstance) {
            activeInstanceData.calendar.forEach((ep: any) => {
                const poster = ep.series?.images?.find((img: any) => img.coverType === 'poster');
                items.push({
                    id: `${activeInstanceData.id}-sonarr-${ep.id || ep.airDateUtc || ep.airDate}-${ep.title}`,
                    type: 'tv',
                    service: activeInstanceData.name || 'Sonarr',
                    title: ep.series?.title || t('calendar.fallback.unknownSeries'),
                    subtitle: ep.portalRequest
                        ? t('calendar.labels.requestedNotAired')
                        : `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`,
                    date: new Date(ep.airDateUtc || ep.airDate),
                    hasFile: ep.hasFile,
                    monitored: ep.monitored,
                    imageUrl: poster ? (poster.remoteUrl || poster.url) : null,
                    network: ep.series?.network || '',
                    portalRequest: !!ep.portalRequest,
                });
            });
        } else {
            activeInstanceData.calendar.forEach((movie: any) => {
                const releaseDateStr = movie.digitalRelease || movie.physicalRelease || movie.inCinemas || movie.added;
                if (!releaseDateStr) return;
                const poster = movie.images?.find((img: any) => img.coverType === 'poster');
                items.push({
                    id: `${activeInstanceData.id}-radarr-${movie.id || releaseDateStr}-${movie.title}`,
                    type: 'movie',
                    service: activeInstanceData.name || 'Radarr',
                    title: movie.title,
                    subtitle: movie.portalRequest ? t('calendar.labels.requestedNotReleased') : (movie.studio || t('calendar.fallback.movieRelease')),
                    date: new Date(releaseDateStr),
                    hasFile: movie.hasFile,
                    monitored: movie.monitored,
                    imageUrl: poster ? (poster.remoteUrl || poster.url) : null,
                    portalRequest: !!movie.portalRequest,
                });
            });
        }
        return items.sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [activeInstanceData, isTvInstance, t]);

    const filteredCalendar = calendarItems;

    const activeStackConfigured = !!activeInstanceData?.configured;

    const activeStackLabel = activeInstanceData?.name || activeInstanceData?.instanceName || (isTvInstance ? 'Sonarr' : 'Radarr');
    const stackTools = useMemo(() => (
        Array.isArray(data?.tools)
            ? data.tools.filter((tool: any) => tool?.type === 'lidarr' || tool?.type === 'bazarr')
            : []
    ), [data]);

    useEffect(() => {
        let cancelled = false;
        const maybeAutoSelectMonthWithReleases = async () => {
            if (!data || monthOffset !== 0 || filteredCalendar.length > 0) {
                if (!cancelled && monthOffset === 0) {
                    setAutoMonthNotice('');
                }
                return;
            }
            for (let offset = 1; offset <= 6; offset += 1) {
                try {
                    const res = await apiFetch(`/api/media-stack/summary?monthOffset=${offset}${activeInstanceId ? `&instanceId=${encodeURIComponent(activeInstanceId)}` : ''}`);
                    const activeSummary = activeInstanceId
                        ? res?.instances?.find((entry: any) => entry.id === activeInstanceId)
                        : res?.instances?.[0];
                    const count = Array.isArray(activeSummary?.calendar) ? activeSummary.calendar.length : 0;
                    if (count > 0) {
                        if (cancelled) return;
                        setData(res);
                        setMonthOffset(offset);
                        setAutoMonthNotice(t('calendar.relative.nextMonthNotice', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie'), month: new Date(new Date().setFullYear(new Date().getFullYear(), new Date().getMonth() + offset, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric' }) }));
                        return;
                    }
                } catch {
                    // Keep trying next month; this is a best-effort UX fallback.
                }
            }
            if (!cancelled) {
                setAutoMonthNotice(t('calendar.relative.noNextReleases', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie') }));
            }
        };
        maybeAutoSelectMonthWithReleases();
        return () => {
            cancelled = true;
        };
    }, [isTvInstance, filteredCalendar.length, data, monthOffset, activeInstanceId, locale, t]);

    const groupedCalendar = useMemo(() => {
        const groups: { [dateStr: string]: typeof filteredCalendar } = {};
        filteredCalendar.forEach(item => {
            const dateStr = item.date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(item);
        });
        return groups;
    }, [filteredCalendar, locale]);

    useEffect(() => {
        if (filteredCalendar.length > 0) {
            setActiveCalendarItem((prev: any) => {
                if (prev && filteredCalendar.find(i => i.id === prev.id)) return prev;
                return filteredCalendar[0];
            });
        } else {
            setActiveCalendarItem(null);
        }
    }, [filteredCalendar]);

    const activeQueue = useMemo(() => {
        if (!activeInstanceData?.queue?.records) return [];
        return activeInstanceData.queue.records.map((item: any) => ({
            ...item,
            service: activeInstanceData.name || activeStackLabel,
        }));
    }, [activeInstanceData, activeStackLabel]);

    const activeHistory = useMemo(() => {
        if (!activeInstanceData?.history?.records) return [];
        const historyItems: any[] = [];
        if (isTvInstance) {
            activeInstanceData.history.records.forEach((item: any) => {
                let cleanTitle = '';
                if (item.series?.title) {
                    cleanTitle = item.series.title;
                    if (item.episode?.seasonNumber !== undefined && item.episode?.episodeNumber !== undefined) {
                        cleanTitle += ` - S${String(item.episode.seasonNumber).padStart(2, '0')}E${String(item.episode.episodeNumber).padStart(2, '0')}`;
                        if (item.episode.title) {
                            cleanTitle += ` - ${item.episode.title}`;
                        }
                    }
                } else {
                    cleanTitle = item.sourceTitle || t('calendar.fallback.unknownTvShow');
                }
                historyItems.push({
                    id: `${activeInstanceData.id}-sonarr-hist-${item.id}`,
                    service: activeInstanceData.name || 'Sonarr',
                    title: cleanTitle,
                    date: new Date(item.date),
                    eventType: item.eventType
                });
            });
        } else {
            activeInstanceData.history.records.forEach((item: any) => {
                historyItems.push({
                    id: `${activeInstanceData.id}-radarr-hist-${item.id}`,
                    service: activeInstanceData.name || 'Radarr',
                    title: item.movie?.title || item.sourceTitle || t('calendar.fallback.unknownMovie'),
                    date: new Date(item.date),
                    eventType: item.eventType
                });
            });
        }
        return historyItems.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 8);
    }, [activeInstanceData, isTvInstance, t]);

    if (isLoading) {
        return (
            <DashboardPageShell>
                <Loader isLoading={true} />
            </DashboardPageShell>
        );
    }
    if (error) {
        return (
            <DashboardPageShell>
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
            </DashboardPageShell>
        );
    }
    if (!data) return null;

    const getHistoryColor = (type: string) => {
        if (!type) return 'bg-muted';
        switch (type.toLowerCase()) {
            case 'grabbed':
                return 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]';
            case 'downloadfolderimported':
            case 'moviefileimported':
            case 'imported':
                return 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]';
            case 'downloadfailed':
            case 'failed':
                return 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]';
            case 'episodefiledeleted':
            case 'moviefiledeleted':
            case 'deleted':
                return 'bg-zinc-600 shadow-[0_0_6px_rgba(113,113,122,0.5)]';
            default:
                return 'bg-plex shadow-[0_0_6px_rgba(229,160,13,0.5)]';
        }
    };

    const formatEventType = (type: string) => {
        if (!type) return '';
        switch (type.toLowerCase()) {
            case 'grabbed':
                return t('calendar.events.grabbed');
            case 'downloadfolderimported':
            case 'moviefileimported':
            case 'imported':
                return t('calendar.events.imported');
            case 'downloadfailed':
            case 'failed':
                return t('calendar.events.failed');
            case 'episodefiledeleted':
            case 'moviefiledeleted':
            case 'deleted':
                return t('calendar.events.deleted');
            default:
                return type
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/^./, str => str.toUpperCase())
                    .trim();
        }
    };

    const renderStatusCard = (name: string, info: any) => {
        if (!info || !info.configured) {
            return (
                <div className="bg-card border border-border/40 rounded-2xl p-4 md:p-6 shadow-xl flex flex-col justify-between h-44 relative overflow-hidden">
                    <div className="flex justify-between items-start">
                        <h3 className="text-lg font-bold text-text/80">{name}</h3>
                        <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded bg-white/5 text-muted border border-white/5">{t('calendar.status.unconfigured')}</span>
                    </div>
                    <p className="text-xs text-muted leading-relaxed">{t('calendar.empty.configurationHint')}</p>
                    <div className="text-right">
                        <span className="text-xs font-bold text-plex hover:underline cursor-pointer">{t('calendar.actions.configureInSettings')}</span>
                    </div>
                </div>
            );
        }

        const status = info.status;
        const disk = info.disk ? info.disk[0] : null;
        const freeGB = disk ? (disk.freeSpace / 1024 / 1024 / 1024) : 0;
        const totalGB = disk ? (disk.totalSpace / 1024 / 1024 / 1024) : 1;
        const freePercent = disk ? (freeGB / totalGB) * 100 : 0;
        const usedPercent = 100 - freePercent;
        const isReachable = !!status;

        return (
            <div className="bg-card border border-white/5 shadow-2xl rounded-2xl p-4 md:p-6 relative overflow-hidden backdrop-blur-sm group hover:border-white/10 transition-all duration-300">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-all duration-500">
                    <HardDrive className="w-24 h-24" />
                </div>

                <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-plex/10 flex items-center justify-center border border-plex/20">
                        {name === 'Sonarr' ? <Tv className="w-5 h-5 text-plex" /> : <Film className="w-5 h-5 text-plex" />}
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-text tracking-wide">{name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`w-2 h-2 rounded-full ${isReachable ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></span>
                            <span className={`text-[10px] font-bold tracking-wider uppercase ${isReachable ? 'text-green-500' : 'text-red-400'}`}>{isReachable ? t('calendar.status.online') : t('status.unavailable')}</span>
                            {status?.version && <span className="text-[10px] text-muted font-bold">v{status.version}</span>}
                        </div>
                    </div>
                </div>
                {!isReachable && (
                    <p className="text-[11px] text-red-300 mb-2">{t('calendar.labels.unableToFetch', { name })}</p>
                )}

                {disk && (
                    <div className="bg-background/40 rounded-xl p-3 border border-white/5 mt-2">
                        <div className="flex justify-between items-end mb-1">
                            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{t('calendar.status.freeStorage')}</span>
                            <span className="text-xs font-bold text-text">{t('calendar.status.freeGb', { value: freeGB.toFixed(1) })}</span>
                        </div>
                        <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                            <div className="bg-plex h-full rounded-full transition-all duration-500" style={{ width: `${usedPercent}%` }}></div>
                        </div>
                        <div className="flex justify-between text-[9px] text-muted/60 mt-1 font-medium">
                            <span>{t('calendar.status.usedPercent', { value: usedPercent.toFixed(0) })}</span>
                            <span>{t('calendar.status.totalGb', { value: totalGB.toFixed(0) })}</span>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderToolCard = (tool: any) => {
        const isBazarr = tool?.type === 'bazarr';
        const label = tool?.name || (isBazarr ? 'Bazarr' : 'Lidarr');
        const isOnline = !!tool?.status && !tool?.error;
        const href = tool?.externalUrl || tool?.url || '';
        return (
            <div key={tool.id || `${tool.type}-${label}`} className={`${dashboardPanelClass} p-4 md:p-5 relative overflow-hidden`}>
                <div className="absolute top-0 right-0 p-4 opacity-5">
                    {isBazarr ? <FileText className="w-20 h-20" /> : <Music className="w-20 h-20" />}
                </div>
                <div className="flex items-center justify-between gap-3 relative">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-plex/10 flex items-center justify-center border border-plex/20 shrink-0">
                            {isBazarr ? <FileText className="w-5 h-5 text-plex" /> : <Music className="w-5 h-5 text-plex" />}
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-base font-bold text-text truncate">{label}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></span>
                                <span className={`text-[10px] font-bold tracking-wider uppercase ${isOnline ? 'text-green-500' : 'text-red-400'}`}>{isOnline ? t('calendar.status.online') : t('status.unavailable')}</span>
                                {tool?.version && <span className="text-[10px] text-muted font-bold">v{tool.version}</span>}
                            </div>
                        </div>
                    </div>
                    {isAdmin && href && (
                        <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors shrink-0"
                            title={`Open ${label}`}
                        >
                            <ExternalLink className="w-4 h-4" />
                        </a>
                    )}
                </div>
                <p className="text-xs text-muted mt-4 relative">
                    {isBazarr ? t('calendar.labels.subtitleAutomation') : t('calendar.labels.musicAutomation')}
                    {tool?.error ? ` · ${tool.error}` : ''}
                </p>
            </div>
        );
    };

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="plex"
                eyebrow={t('navigation.calendar')}
                title={activeStackLabel}
                description={isTvInstance ? t('calendar.page.tvDescription') : t('calendar.page.movieDescription')}
                icon={<Calendar className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <div className="flex flex-wrap items-center gap-2">
                        {stackInstances.length > 0 && (
                            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-1 no-scrollbar">
                                {stackInstances.map((instance: any) => (
                                    <button
                                        key={instance.id}
                                        type="button"
                                        onClick={() => switchInstance(instance.id)}
                                        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(activeInstanceId === instance.id)}`}
                                    >
                                        {instance.type === 'sonarr' ? <Tv className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
                                        {instance.name || (instance.type === 'radarr' ? 'Radarr' : 'Sonarr')}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={fetchData}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-text transition hover:border-plex/40 hover:bg-white/5"
                        >
                            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                            {t('calendar.actions.refresh')}
                        </button>
                    </div>
                )}
            />

            <DetailsModal item={detailsItem} onClose={() => setDetailsItem(null)} />

            <div className="flex flex-col gap-8 w-full">
                {stackTools.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-7xl">
                        {stackTools.map(renderToolCard)}
                    </div>
                )}

                <DashboardPanel
                    title={t('calendar.sections.upcomingReleases')}
                    controls={(
                        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                            <button type="button" onClick={() => { setAutoMonthNotice(''); setMonthOffset((m) => m - 1); }} className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text">
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-xs font-bold px-2 w-24 text-center text-text uppercase tracking-wider">
                                {new Date(new Date().setFullYear(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1)).toLocaleDateString('default', { month: 'short', year: 'numeric' })}
                            </span>
                            <button type="button" onClick={() => { setAutoMonthNotice(''); setMonthOffset((m) => m + 1); }} className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text">
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                >
                        {autoMonthNotice && (
                            <p className="text-xs text-plex/90 mb-3">{autoMonthNotice}</p>
                        )}

                        {filteredCalendar.length === 0 ? (
                            <div className="text-center py-12 bg-background/30 rounded-xl border border-white/5 text-muted text-sm">
                                <Calendar className="w-12 h-12 text-muted/30 mx-auto mb-3" />
                                {!activeStackConfigured ? (
                                    <>
                                        <p>{t('calendar.empty.notConfigured', { name: activeStackLabel })}</p>
                                        <p className="text-xs mt-2">{t('calendar.empty.configurationHint')}</p>
                                    </>
                                ) : (
                                    <p>{t('calendar.empty.noUpcoming', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie') })}</p>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-start gap-3 md:gap-5 xl:gap-6 w-full">
                                {/* Left Sticky Poster */}
                                <div className="sticky top-[64px] md:top-0 w-[100px] sm:w-[140px] md:w-[200px] xl:w-[240px] flex-shrink-0 hidden sm:block">
                                    <div className="flex flex-col gap-4 mt-8 md:mt-0">
                                        <div className="relative aspect-[2/3] rounded-lg md:rounded-2xl overflow-hidden shadow-2xl border border-white/10 group bg-card">
                                            {activeCalendarItem?.imageUrl ? (
                                                <img src={activeCalendarItem.imageUrl} alt={activeCalendarItem.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center opacity-30">
                                                    {activeCalendarItem?.type === 'tv' ? <Tv className="w-10 h-10 md:w-20 md:h-20 mb-2 md:mb-4" /> : <Film className="w-10 h-10 md:w-20 md:h-20 mb-2 md:mb-4" />}
                                                    <span className="font-bold uppercase tracking-widest text-[8px] md:text-sm">{t('calendar.empty.noPoster')}</span>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-transparent flex flex-col justify-start p-2 md:p-4">
                                                {activeCalendarItem?.network && (
                                                    <span className="hidden md:block text-sm text-white/90 uppercase tracking-widest font-bold text-left drop-shadow-lg">{activeCalendarItem.network}</span>
                                                )}
                                            </div>
                                        </div>
                                        {activeCalendarItem?.title && (
                                            <div className="hidden md:block px-0.5">
                                                <p className="text-sm font-bold text-text leading-snug break-words">{activeCalendarItem.title}</p>
                                                {activeCalendarItem.subtitle && (
                                                    <p className="text-xs text-muted mt-1 break-words">{activeCalendarItem.subtitle}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Right Side: day columns */}
                                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 md:gap-5 pb-4">
                                    {Object.entries(groupedCalendar).map(([dateStr, items]: [string, typeof filteredCalendar]) => (
                                        <div key={dateStr} className="flex flex-col gap-2 md:gap-3 min-w-0">
                                            <div className="sticky top-[64px] md:top-0 bg-card z-20 py-1 md:py-3 border-b border-white/10 md:mb-2 page-bleed-x page-x md:mx-0 md:px-0 md:w-full shadow-[0_10px_20px_-10px_rgba(0,0,0,0.5)]">
                                                <h3 className="text-sm md:text-base xl:text-lg font-black text-plex md:text-text tracking-tight uppercase truncate" title={dateStr}>{dateStr}</h3>
                                            </div>
                                            {items.map(item => (
                                                <div
                                                    key={item.id}
                                                    onMouseEnter={() => setActiveCalendarItem(item)}
                                                    onClick={() => setActiveCalendarItem(item)}
                                                    className={`bg-background/40 hover:bg-background/80 transition-all duration-300 rounded-lg md:rounded-xl p-2.5 md:p-3 flex flex-col gap-1.5 shadow-md border-l-4 cursor-pointer group min-w-0 ${item.hasFile ? 'border-l-green-500/80' : item.monitored ? 'border-l-red-500/80' : 'border-l-blue-500/80'} ${activeCalendarItem?.id === item.id ? 'bg-white/10 border border-white/30 scale-[1.01]' : 'border border-white/5 hover:border-white/20'}`}
                                                >
                                                    <div className="flex items-center justify-between gap-2 min-w-0">
                                                        <span className="text-[9px] md:text-[11px] text-plex flex items-center gap-1 md:gap-1.5 font-bold tracking-wide shrink-0">
                                                            <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                                            {formatTime(item.date).replace(/^0:/, '12:')}
                                                        </span>
                                                        {item.hasFile ? (
                                                            <span className="text-[8px] md:text-[10px] font-bold text-green-500 bg-green-500/10 border border-green-500/20 rounded md:rounded-md px-1.5 py-0.5 whitespace-nowrap shrink-0">
                                                                {t('calendar.status.ready')}
                                                            </span>
                                                        ) : (
                                                            item.monitored && (
                                                                <span className="text-[8px] md:text-[10px] font-bold text-plex bg-plex/10 border border-plex/20 rounded md:rounded-md px-1.5 py-0.5 flex items-center gap-1 whitespace-nowrap shrink-0">
                                                                    <span className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-plex animate-pulse"></span>
                                                                    {t('calendar.status.monitored')}
                                                                </span>
                                                            )
                                                        )}
                                                    </div>
                                                    <h4
                                                        className="font-bold text-xs sm:text-sm text-text leading-snug break-words group-hover:text-plex transition-colors"
                                                        title={item.title}
                                                    >
                                                        {item.title}
                                                    </h4>
                                                    <p
                                                        className="text-[10px] md:text-[12px] text-muted/80 leading-snug break-words font-medium"
                                                        title={item.subtitle}
                                                    >
                                                        {item.subtitle}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                </DashboardPanel>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="flex flex-col gap-8">
                        <DashboardPanel
                            title={t('calendar.sections.downloads', { name: activeStackLabel })}
                            subtitle={t('calendar.labels.active', { count: activeQueue.length })}
                            className="flex-grow flex flex-col"
                        >
                                {!activeStackConfigured ? (
                                    <div className="text-center py-8 bg-background/30 rounded-xl border border-white/5 text-muted text-sm flex-grow flex flex-col justify-center items-center">
                                        <DownloadCloud className="w-10 h-10 text-muted/30 mx-auto mb-2" />
                                        <p>{t('calendar.empty.notConfigured', { name: activeStackLabel })}</p>
                                    </div>
                                ) : activeQueue.length === 0 ? (
                                    <div className="text-center py-8 bg-background/30 rounded-xl border border-white/5 text-muted text-sm flex-grow flex flex-col justify-center items-center">
                                        <DownloadCloud className="w-10 h-10 text-muted/30 mx-auto mb-2" />
                                        {t('calendar.empty.noActiveDownloads', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie') })}
                                    </div>
                                ) : (
                                    activeQueue.map((item: any) => {
                                        const downloaded = item.size - item.sizeleft;
                                        const progress = item.size > 0 ? (downloaded / item.size) * 100 : 0;

                                        return (
                                            <div key={item.id} className="bg-background/40 hover:bg-background/60 transition-all rounded-xl p-4 border border-white/5 flex flex-col gap-2">
                                                <div className="flex justify-between items-start gap-4">
                                                    <div className="flex flex-col gap-1 min-w-0">
                                                        <span className="font-bold text-sm text-text line-clamp-1 leading-snug">{item.title}</span>
                                                        <span className="text-[10px] text-muted/60 font-semibold">{item.timeleft || t('calendar.empty.unknownTime')} left</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold px-2 py-0.5 bg-plex/10 text-plex rounded-md border border-plex/20 uppercase tracking-wider">{item.status}</span>
                                                </div>
                                                <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden mt-1 relative">
                                                    <div className="bg-plex h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                                                </div>
                                                <div className="flex justify-between text-[10px] text-muted/60 mt-0.5 font-medium">
                                                    <span>{progress.toFixed(1)}%</span>
                                                    <span>{formatBytes(downloaded)} / {formatBytes(item.size)}</span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                        </DashboardPanel>
                    </div>

                    <div className="flex flex-col gap-4">
                        <h2 className="text-xl font-bold text-text flex items-center gap-2 mb-1">
                            {isTvInstance ? <Tv className="w-5 h-5 text-plex" /> : <Film className="w-5 h-5 text-plex" />}
                            {t('calendar.sections.status', { name: activeStackLabel })}
                        </h2>
                        {renderStatusCard(activeStackLabel, activeInstanceData)}
                    </div>

                    <DashboardPanel
                        title={t('calendar.sections.history', { name: activeStackLabel })}
                        className="flex-grow flex flex-col"
                    >
                        <div className="flex flex-col gap-3 flex-grow justify-start">
                            {!activeStackConfigured ? (
                                <div className="text-center py-12 bg-background/30 rounded-xl border border-white/5 text-muted text-sm flex-grow flex flex-col justify-center items-center">
                                    <p>{t('calendar.empty.notConfigured', { name: activeStackLabel })}</p>
                                </div>
                            ) : activeHistory.length === 0 ? (
                                <div className="text-center py-12 bg-background/30 rounded-xl border border-white/5 text-muted text-sm flex-grow flex flex-col justify-center items-center">
                                    {t('calendar.empty.noRecentHistory', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie') })}
                                </div>
                            ) : (
                                activeHistory.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-3 bg-background/30 rounded-xl p-3 border border-white/5 hover:bg-background/50 transition-colors">
                                        <div className={`w-1 h-8 rounded-full flex-shrink-0 ${getHistoryColor(item.eventType)}`}></div>
                                        <div className="flex-grow min-w-0">
                                            <div className="font-bold text-xs text-text line-clamp-1 leading-snug">{item.title}</div>
                                            <div className="text-[10px] text-muted flex justify-between items-center mt-0.5">
                                                <span>{formatEventType(item.eventType)}</span>
                                                <span>{formatRelativeAirDate(item.date)}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </DashboardPanel>
                </div>
            </div>
        </DashboardPageShell>
    );
};
