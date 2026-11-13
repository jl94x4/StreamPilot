import { Activity,AlertCircle,BarChart3,Calendar,CheckCircle,Clock,Film,HardDrive,Layers,Loader2,LineChart as LucideLineChart,Monitor,MonitorSmartphone,Music,PieChart,PlaySquare,RefreshCw,Search,Settings,Star,TrendingUp,Trophy,Tv,Users,X } from 'lucide-react';
import React,{ useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react';
import ReactDOM from 'react-dom';
import { Area,AreaChart,Bar,BarChart,CartesianGrid,Legend,Line,LineChart,Tooltip as RechartsTooltip,ResponsiveContainer,XAxis,YAxis } from 'recharts';

import { AchievementsAnalyticsLeaderboard } from '../achievements/AchievementsAnalyticsLeaderboard';
import { useDiscoverI18n } from '../discovery/i18n';
import { goToProfile } from '../profile/helpers';
import { apiFetch } from '../shared/api';
import { logoUrl,portalUrl,resolvePortalAssetUrl } from '../shared/basePath';
import {
DashboardHero,
DashboardPageShell,
DashboardPanel,
DashboardStatCard,
DashboardSubnav,
dashboardGlowClass,
dashboardSubnavLinkClass,
preferCollapsedOnNarrow,
usePersistedCollapsed
} from '../shared/dashboard/DashboardChrome';
import { formatPortalDateTime,formatSizeCeil } from '../shared/format';
import { Loader,ToastContainer,pushToast } from '../shared/toast';
import type { ToastMessage } from '../shared/types';
import { CustomSelect } from '../shared/ui';
import { UserAnalyticsModal } from './adminUsers';
import { CountUp } from './common';
import { ANALYTICS_OVERVIEW_SNAPSHOT_COLLAPSED_KEY } from './downloads';


// --- Analytics Dashboard Component ---
const PersonalAnalyticsDashboard: React.FC<{ username: string, thumb: string | null }> = ({ username, thumb }) => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [days, setDays] = useState<string>('30');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        apiFetch(`/api/plex/analytics/me?days=${days}`)
            .then(res => { if (!cancelled) setData(res); })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [days]);

    return (
        <div className="w-full animate-fade-in flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
                <div>
                    <h1 className="text-3xl font-bold text-text uppercase tracking-widest flex items-center gap-3">
                        <BarChart3 className="w-8 h-8 text-plex" />
                        Personal Analytics
                    </h1>
                    <p className="text-muted text-sm mt-1">Deep dive into your playback history</p>
                </div>
                <select
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="bg-card text-text border border-border rounded px-4 py-2 text-sm focus:outline-none focus:border-plex"
                >
                    <option value="30">Last 30 Days</option>
                    <option value="60">Last 60 Days</option>
                    <option value="365">Last 1 Year</option>
                    <option value="1825">Last 5 Years</option>
                    <option value="all">All Time</option>
                </select>
            </div>

            <div className="bg-card/90 border border-border w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                <div className="p-6 border-b border-border flex items-center justify-between bg-black/20 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-r from-plex to-[#e5a00d]">
                            <img src={thumb ? (thumb.startsWith('http') ? thumb : portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=128&height=128`)) : logoUrl()} alt={username} className="w-full h-full rounded-full object-cover bg-card" onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-text">{username}</h2>
                            <p className="text-muted text-sm">{loading ? 'Loading stats...' : `${data?.totalPlays || 0} total plays (${days === 'all' ? 'All Time' : `Last ${days} Days`})`}</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto flex-1 min-h-0 flex flex-col gap-8 custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center items-center h-40"><Loader isLoading={true} /></div>
                    ) : (error || !data) ? (
                        <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
                            <AlertCircle className="w-8 h-8 text-red-500" />
                            <p className="text-muted text-sm">Failed to load your analytics. Please try again later.</p>
                        </div>
                    ) : (
                        <>
                            <div>
                                <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><PlaySquare className="text-plex w-4 h-4" /> Favorite Libraries</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                    {(data.topLibraries ?? []).length === 0 ? <p className="text-muted text-sm col-span-full">No library data.</p> : data.topLibraries.map((lib: any, i: number) => (
                                        <div key={lib.id} className="flex justify-between items-center bg-black/20 p-2 rounded border border-white/5">
                                            <span className="font-bold text-sm text-text"><span className="text-muted mr-2">#{i + 1}</span>{lib.title}</span>
                                            <span className="text-plex text-xs font-mono">{lib.plays} plays</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {data.topMovies && data.topMovies.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><Film className="text-plex w-4 h-4" /> Top Watched Movies</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                                        {data.topMovies.map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-8 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Film className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{c.plays} plays</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {data.topShows && data.topShows.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><TrendingUp className="text-plex w-4 h-4" /> Top Watched TV Shows</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                                        {data.topShows.map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-8 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Film className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{c.plays} plays</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {data.topMusic && data.topMusic.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><Music className="text-plex w-4 h-4" /> Top Listened</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                                        {data.topMusic.map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-12 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Music className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{c.plays} plays</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div>

                                <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><Activity className="text-plex w-4 h-4" /> Recent Watch History</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {data.recentHistory.length === 0 ? <p className="text-muted text-sm col-span-full">No recent history.</p> : data.recentHistory.map((h: any, i: number) => (
                                        <a key={i} href={h.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-white/5 border border-white/5 p-2 rounded-lg hover:bg-white/10 transition-colors">
                                            <div className={`${h.type === 'track' ? 'w-12 h-12' : 'w-10 h-14'} bg-black/40 rounded overflow-hidden flex-shrink-0`}>
                                                {h.thumbUrl && <img src={resolvePortalAssetUrl(h.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                <div className={`w-full h-full p-2 opacity-50 flex items-center justify-center ${h.thumbUrl ? 'hidden' : ''}`}>
                                                    {h.type === 'track' ? <Music className="w-full h-full" /> : <Film className="w-full h-full" />}
                                                </div>
                                            </div>
                                            <div className="flex flex-col overflow-hidden">
                                                <span className="font-bold text-sm text-text truncate">{h.title}</span>
                                                {h.episodeTitle && <span className="text-muted text-xs truncate">{h.episodeTitle}</span>}
                                                <span className="text-plex font-mono text-[10px] mt-1">{formatPortalDateTime(h.viewedAt)}</span>
                                            </div>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const GRAPH_COLORS = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#14b8a6', // teal
    '#f97316', // orange
    '#a855f7'  // violet
];

const TautulliGraphsTab: React.FC = () => {
    const [graphs, setGraphs] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [days, setDays] = useState('30');
    const [yAxis, setYAxis] = useState<'plays' | 'duration'>('plays');

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setError('');
        apiFetch(`/api/tautulli/graphs?days=${days}&y_axis=${yAxis}`)
            .then(data => {
                if (cancelled) return;
                setGraphs(data);
                setIsLoading(false);
            })
            .catch(err => {
                if (cancelled) return;
                setError(err.message || 'Failed to load graphs');
                setIsLoading(false);
            });
        return () => { cancelled = true; };
    }, [days, yAxis]);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64 glass-card-sm mt-6">
                <RefreshCw className="w-8 h-8 text-plex animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-xl mt-6 flex items-center gap-3">
                <AlertCircle className="w-6 h-6" />
                <span>{error}</span>
            </div>
        );
    }

    if (!graphs || Object.keys(graphs).length === 0) {
        return null;
    }

    const {
        get_plays_by_date,
        get_plays_by_dayofweek,
        get_plays_by_hourofday,
        get_plays_by_stream_type,
        get_plays_by_stream_resolution,
        get_plays_by_top_10_platforms,
        get_concurrent_streams_by_stream_type,
        get_plays_by_source_resolution,
        get_plays_by_top_10_users
    } = graphs;

    const parseDateData = (data: any) => {
        if (!data || !data.categories || !data.series) return [];
        return data.categories.map((date: string, i: number) => {
            const obj: any = { date };
            data.series.forEach((s: any) => {
                let val = s.data[i] || 0;
                if (yAxis === 'duration') {
                    // Convert seconds to hours, rounded to 1 decimal place
                    val = parseFloat((val / 3600).toFixed(1));
                }
                obj[s.name] = val;
            });
            return obj;
        });
    };

    const parseConcurrentData = (data: any) => {
        if (!data || !data.categories || !data.series) return [];
        return data.categories.map((date: string, i: number) => {
            const obj: any = { date };
            data.series.forEach((s: any) => {
                obj[s.name] = s.data[i] || 0;
            });
            return obj;
        });
    };

    const getSeriesKeys = (data: any) => {
        if (!data || !data.series) return [];
        return data.series.map((s: any) => s.name);
    };

    const STREAM_COLORS: Record<string, string> = {
        'Direct Play': '#eab308',
        'Direct Stream': '#e2e8f0',
        'Transcode': '#ef4444'
    };

    const dailyData = parseDateData(get_plays_by_date);
    const dayOfWeekData = parseDateData(get_plays_by_dayofweek);
    const hourOfDayData = parseDateData(get_plays_by_hourofday);

    const streamTypeData = parseDateData(get_plays_by_stream_type);
    const streamTypeKeys = getSeriesKeys(get_plays_by_stream_type);

    const concurrentData = parseConcurrentData(get_concurrent_streams_by_stream_type);
    const concurrentKeys = getSeriesKeys(get_concurrent_streams_by_stream_type);

    const resolutionData = parseDateData(get_plays_by_stream_resolution);
    const resolutionKeys = getSeriesKeys(get_plays_by_stream_resolution);

    const platformData = parseDateData(get_plays_by_top_10_platforms);
    const platformKeys = getSeriesKeys(get_plays_by_top_10_platforms);

    const sourceResolutionData = parseDateData(get_plays_by_source_resolution);
    const sourceResolutionKeys = getSeriesKeys(get_plays_by_source_resolution);

    const topUsersData = parseDateData(get_plays_by_top_10_users);
    const topUsersKeys = getSeriesKeys(get_plays_by_top_10_users);

    return (
        <div className="space-y-6 mt-6 min-w-0">
            <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-4">
                {/* Y-Axis Toggle */}
                <div className="flex bg-black/40 rounded-lg p-1 border border-white/5 w-fit">
                    <button onClick={() => setYAxis('plays')} className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${yAxis === 'plays' ? 'bg-plex text-white shadow-lg' : 'text-muted hover:text-white'}`}>
                        Play Count
                    </button>
                    <button onClick={() => setYAxis('duration')} className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${yAxis === 'duration' ? 'bg-plex text-white shadow-lg' : 'text-muted hover:text-white'}`}>
                        Watch Duration
                    </button>
                </div>
                {/* Timeframe selector */}
                <div className="w-48">
                    <CustomSelect
                        value={days}
                        onChange={setDays}
                        options={[
                            { label: 'Last 7 Days', value: '7' },
                            { label: 'Last 30 Days', value: '30' },
                            { label: 'Last 90 Days', value: '90' },
                            { label: 'Last 365 Days', value: '365' },
                            { label: 'All Time', value: '0' }
                        ]}
                    />
                </div>
            </div>

            {/* Daily Play Count by Media Type */}
            <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                    <LucideLineChart className="w-5 h-5 text-[#3b82f6]" /> {yAxis === 'plays' ? 'Daily Play Count by Media Type' : 'Daily Watch Duration by Media Type (Hours)'}
                </h3>
                <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                            <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} tickMargin={10} minTickGap={20} />
                            <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                            <RechartsTooltip contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Line type="monotone" dataKey="TV" stroke="#eab308" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Movies" stroke="#3b82f6" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Music" stroke="#ef4444" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Total" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Play count by day of week */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-green-400" /> {yAxis === 'plays' ? 'Play Count by Day of Week' : 'Watch Duration by Day of Week (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dayOfWeekData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                <Bar dataKey="TV" stackId="a" fill="#eab308" />
                                <Bar dataKey="Movies" stackId="a" fill="#3b82f6" />
                                <Bar dataKey="Music" stackId="a" fill="#ef4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Play count by hour of day */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-5 h-5 text-orange-400" /> {yAxis === 'plays' ? 'Play Count by Hour of Day' : 'Watch Duration by Hour of Day (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={hourOfDayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                <Bar dataKey="TV" stackId="a" fill="#eab308" />
                                <Bar dataKey="Movies" stackId="a" fill="#3b82f6" />
                                <Bar dataKey="Music" stackId="a" fill="#ef4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Play count by stream type */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Activity className="w-5 h-5 text-sky-400" /> {yAxis === 'plays' ? 'Daily Stream Type Breakdown' : 'Daily Stream Type Duration Breakdown (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={streamTypeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                {streamTypeKeys.map((key: string) => (
                                    <Line key={key} type="monotone" dataKey={key} stroke={STREAM_COLORS[key] || '#3b82f6'} strokeWidth={2} dot={false} />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Concurrent streams by stream type */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-plex" /> Daily Concurrent Stream Count by Stream Type
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={concurrentData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                {concurrentKeys.map((key: string) => (
                                    <Line key={key} type="monotone" dataKey={key} stroke={STREAM_COLORS[key] || '#3b82f6'} strokeWidth={2} dot={false} />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Play count by stream resolution */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <MonitorSmartphone className="w-5 h-5 text-purple-400" /> {yAxis === 'plays' ? 'Stream Resolution Breakdown' : 'Stream Resolution Duration Breakdown (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={resolutionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                {resolutionKeys.map((key: string, idx: number) => (
                                    <Bar key={key} dataKey={key} stackId="a" fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Play count by platform */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                            <Users className="w-5 h-5 text-teal-400" /> {yAxis === 'plays' ? 'Top 10 Streaming Platforms' : 'Top 10 Platforms by Watch Duration (Hours)'}
                        </h3>
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={platformData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                    <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                    <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                    <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                    <Legend />
                                    {platformKeys.map((key: string, idx: number) => (
                                        <Bar key={key} dataKey={key} stackId="a" fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Play count by source resolution */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Layers className="w-5 h-5 text-indigo-400" /> {yAxis === 'plays' ? 'Source File Resolution Breakdown' : 'Source File Resolution Duration Breakdown (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={sourceResolutionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                {sourceResolutionKeys.map((key: string, idx: number) => (
                                    <Bar key={key} dataKey={key} stackId="a" fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Play count by top 10 users */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                            <Trophy className="w-5 h-5 text-amber-400" /> {yAxis === 'plays' ? 'Top 10 Active Users Breakdown' : 'Top 10 Users by Watch Duration (Hours)'}
                        </h3>
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topUsersData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                    <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                    <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                    <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                    <Legend />
                                    {topUsersKeys.map((key: string, idx: number) => (
                                        <Bar key={key} dataKey={key} stackId="a" fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ServerInsightsWidget: React.FC<{
    peakHours: number[],
    tautulliData: any,
    compare: any,
    analyticsSourceLabel: string,
    peakDate?: string,
    setPeakDate: (date: string) => void,
    peakDateData?: number[] | null,
    peakDateLoading?: boolean,
    isJellyfinPortal?: boolean,
    periodPlays?: number,
    uniqueViewers?: number,
}> = ({ peakHours, tautulliData, compare, analyticsSourceLabel, peakDate, setPeakDate, peakDateData, peakDateLoading, isJellyfinPortal = false, periodPlays = 0, uniqueViewers = 0 }) => {
    
    // Format chart data
    const activePeakHours = peakDateData || peakHours;
    const chartData = activePeakHours ? activePeakHours.map((count, hour) => {
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const h = hour % 12 || 12;
        return {
            time: `${h}${ampm}`,
            plays: count
        };
    }) : [];
    const statsAreJellystatTotals = isJellyfinPortal && tautulliData?.playbackMethodStatsAreTotals;
    const displayPeriodPlays = compare?.totalPlaybacks?.current ?? periodPlays ?? tautulliData?.totalPlays ?? 0;
    const displayUniqueViewers = compare?.uniqueViewers?.current ?? uniqueViewers ?? 0;
    const displayWatchTime = tautulliData?.totalTimeStr || (isJellyfinPortal ? 'Unavailable' : '0 mins');

    const formatChange = (data: any) => {
        if (!data || data.percent === null) return null;
        const isPos = data.percent > 0;
        const color = isPos ? 'text-green-500' : (data.percent < 0 ? 'text-red-500' : 'text-muted');
        const icon = isPos ? '↑' : (data.percent < 0 ? '↓' : '');
        return <span className={`text-xs font-bold ${color} ml-2`}>{icon}{Math.abs(data.percent)}%</span>;
    };

    return (
        <div className="w-full flex flex-col gap-6 lg:col-span-2">
            <h2 className="text-xl font-bold text-text uppercase tracking-wider flex items-center gap-2">
                <Activity className="text-plex w-5 h-5" /> Server Insights & Load
            </h2>

            {/* Peak Hours Chart */}
            <div className="glass-card-sm p-4 md:p-6 w-full flex flex-col flex-1 relative">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <h3 className="text-sm font-bold text-muted uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-4 h-4" /> Peak Playback Hours
                    </h3>
                    <div className="flex items-center gap-2 relative z-10">
                        {peakDate && (
                            <button onClick={() => setPeakDate('')} className="text-xs text-muted hover:text-white" title="Clear specific date view">
                                <X className="w-4 h-4" />
                            </button>
                        )}
                        <input 
                            type="date" 
                            value={peakDate} 
                            onChange={(e) => setPeakDate(e.target.value)} 
                            max={new Date().toISOString().split('T')[0]}
                            className="bg-black/40 border border-white/5 rounded-md px-2 py-1 text-xs text-white outline-none focus:border-plex transition-colors"
                        />
                    </div>
                </div>
                <div className="w-full h-[250px] sm:h-[320px] relative">
                    {peakDateLoading && (
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-10 flex items-center justify-center rounded-xl">
                            <Loader2 className="w-8 h-8 text-plex animate-spin" />
                        </div>
                    )}
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorPlays" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#e5a00d" stopOpacity={0.4}/>
                                    <stop offset="95%" stopColor="#e5a00d" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                            <XAxis dataKey="time" stroke="#ffffff40" fontSize={10} tickMargin={10} minTickGap={15} />
                            <YAxis stroke="#ffffff40" fontSize={10} tickFormatter={(val) => val} />
                            <RechartsTooltip 
                                contentStyle={{ backgroundColor: '#111315', borderColor: '#ffffff20', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                                itemStyle={{ color: '#e5a00d' }}
                                formatter={(value: any) => [`${value} plays`, 'Activity']}
                            />
                            <Area type="monotone" dataKey="plays" stroke="#e5a00d" strokeWidth={3} fillOpacity={1} fill="url(#colorPlays)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Server Records Grid */}
            {tautulliData && (
                <div className="glass-card-sm p-4 md:p-6 w-full flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-5 pointer-events-none">
                        <Activity className="w-48 h-48 text-[#3b82f6]" />
                    </div>
                    <h3 className="text-sm font-bold text-muted uppercase tracking-wider mb-4 flex items-center gap-2 relative z-10">
                        <Activity className="w-4 h-4 text-[#3b82f6]" /> {analyticsSourceLabel} Records & Period Stats
                    </h3>
                    <div className="grid grid-cols-2 gap-3 relative z-10">
                        {!isJellyfinPortal ? (
                            <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                                <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Users className="w-3 h-3 text-[#3b82f6]"/> Peak Streams</span>
                                <p className="text-xl font-black text-[#3b82f6]">{tautulliData?.streamsRecord || 0} <span className="text-[9px] font-normal text-muted">concurrent</span></p>
                            </div>
                        ) : (
                            <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                                <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Users className="w-3 h-3 text-[#3b82f6]"/> Active Streams</span>
                                <p className="text-xl font-black text-[#3b82f6]">{tautulliData?.activeStreams || 0} <span className="text-[9px] font-normal text-muted">now</span></p>
                            </div>
                        )}
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Clock className="w-3 h-3 text-green-400"/> Watch Time</span>
                            <p className="text-base font-black text-green-400 leading-tight">{displayWatchTime}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><TrendingUp className="w-3 h-3 text-yellow-400"/> Period Plays</span>
                            <p className="text-xl font-black text-yellow-400 flex items-center">{displayPeriodPlays.toLocaleString()} {formatChange(compare?.totalPlaybacks)}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Users className="w-3 h-3 text-pink-400"/> Unique Viewers</span>
                            <p className="text-xl font-black text-pink-400 flex items-center">{displayUniqueViewers.toLocaleString()} {formatChange(compare?.uniqueViewers)}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Monitor className="w-3 h-3 text-cyan-400" /> {statsAreJellystatTotals ? 'Direct Plays' : 'Peak Direct Plays'}</span>
                            <p className="font-mono font-black text-cyan-400 text-xl">{tautulliData?.directPlayRecord || 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Activity className="w-3 h-3 text-orange-400" /> {statsAreJellystatTotals ? 'Direct Streams' : 'Peak Direct Streams'}</span>
                            <p className="font-mono font-black text-orange-400 text-xl">{tautulliData?.directStreamRecord || 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Settings className="w-3 h-3 text-rose-400" /> {statsAreJellystatTotals ? 'Transcodes' : 'Peak Transcodes'}</span>
                            <p className="font-mono font-black text-rose-400 text-xl">{tautulliData?.transcodeRecord || 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><PlaySquare className="w-3 h-3 text-purple-400" /> TV Shows Played</span>
                            <p className="font-mono font-black text-purple-400 text-xl">{tautulliData?.tvPlays ? tautulliData.tvPlays.toLocaleString() : 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Film className="w-3 h-3 text-red-400" /> Movies Played</span>
                            <p className="font-mono font-black text-red-400 text-xl">{tautulliData?.moviePlays ? tautulliData.moviePlays.toLocaleString() : 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Music className="w-3 h-3 text-emerald-400" /> Music Played</span>
                            <p className="font-mono font-black text-emerald-400 text-xl">{tautulliData?.musicPlays ? tautulliData.musicPlays.toLocaleString() : 0}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const LibraryDeltaBadge: React.FC<{ value?: number }> = ({ value }) => {
    if (!value) return null;
    const isPos = value > 0;
    return (
        <span 
            className={`text-sm font-bold ml-2 ${isPos ? 'text-green-500' : 'text-red-500'} animate-[fade-in_0.5s_ease-out] cursor-help`}
            title="Change since the previous complete library scan"
        >
            {isPos ? '+' : ''}{value.toLocaleString()}
        </span>
    );
};

const formatCatalogScanAge = (generatedAt?: number | string | null) => {
    const n = typeof generatedAt === 'number' ? generatedAt : Date.parse(String(generatedAt || ''));
    if (!Number.isFinite(n) || n <= 0) return null;
    return formatPortalDateTime(n);
};
const AnimatedLeaderboard: React.FC<{ users: any[], resolveAvatar: (thumb: string | null | undefined, w?: number, h?: number) => string, isAdmin: boolean, onUserClick: (u: any) => void }> = ({ users, resolveAvatar, onUserClick }) => {
    const prevUsersRef = useRef<any[]>([]);
    
    useEffect(() => {
        prevUsersRef.current = users;
    }, [users]);

    const prevUsers = prevUsersRef.current;
    
    if (!users || users.length === 0) return null;

    const maxPlays = Math.max(...users.map(u => u.plays || 0), 1);

    const top3 = users.slice(0, 3);
    const rest = users.slice(3, 10);

    const getRankDelta = (userId: string, currentRank: number) => {
        if (!prevUsers || prevUsers.length === 0) return null;
        const prevIdx = prevUsers.findIndex(u => u.id === userId);
        if (prevIdx === -1) return { type: 'new' };
        const diff = prevIdx - (currentRank - 1);
        if (diff > 0) return { type: 'up', val: diff };
        if (diff < 0) return { type: 'down', val: Math.abs(diff) };
        return null;
    };

    const renderPodiumCard = (user: any, rank: number) => {
        const delta = getRankDelta(user.id, rank);
        const isFirst = rank === 1;
        const heightClass = isFirst ? 'h-48' : 'h-40';
        const ringClass = isFirst ? 'ring-2 ring-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : rank === 2 ? 'ring-1 ring-slate-300' : 'ring-1 ring-amber-700';
        
        return (
            <div onClick={() => onUserClick(user)} className={`flex flex-col items-center justify-end bg-card/80 border border-border rounded-xl p-4 relative cursor-pointer hover:bg-white/5 transition-all group w-full ${heightClass} ${ringClass}`}>
                {isFirst && <div className="absolute -top-6 text-4xl animate-[crown-pulse_2s_ease-in-out_infinite]">👑</div>}
                {!isFirst && <div className="absolute -top-4 text-3xl">{rank === 2 ? '🥈' : '🥉'}</div>}
                
                <img src={resolveAvatar(user.thumb, 80, 80)} alt={user.username} onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }} className={`rounded-full object-cover mb-2 border-2 ${isFirst ? 'w-20 h-20 border-yellow-500' : 'w-16 h-16 border-border'} bg-card`} />
                <span className="font-bold text-text group-hover:text-plex transition-colors truncate w-full text-center">{user.username}</span>
                <span className="text-xs text-muted font-mono mt-1">{user.plays} plays</span>
                
                {delta && (
                    <div className="absolute -right-2 -top-2">
                        {delta.type === 'new' && <span className="bg-plex text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-[rank-up_0.3s_ease-out]">NEW</span>}
                        {delta.type === 'up' && <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center animate-[rank-up_0.3s_ease-out]">↑{delta.val}</span>}
                        {delta.type === 'down' && <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center animate-[rank-down_0.3s_ease-out]">↓{delta.val}</span>}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="w-full flex flex-col gap-4">
            <h2 className="text-xl font-bold text-text uppercase tracking-wider flex items-center gap-2">
                <Trophy className="text-plex w-5 h-5" /> Hall of Fame
            </h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Podium */}
                {top3.length > 0 && (
                    <div className="lg:col-span-1 flex flex-col justify-center h-full pt-8 lg:pt-0">
                        <div className="flex items-end justify-center gap-2 sm:gap-4">
                            {top3[1] && <div className="flex-1 max-w-[120px]">{renderPodiumCard(top3[1], 2)}</div>}
                            <div className="flex-1 max-w-[140px] z-10">{renderPodiumCard(top3[0], 1)}</div>
                            {top3[2] && <div className="flex-1 max-w-[120px]">{renderPodiumCard(top3[2], 3)}</div>}
                        </div>
                    </div>
                )}

                {/* List */}
                <div className="lg:col-span-2 flex flex-col gap-2 justify-center">
                    {rest.map((user, idx) => {
                        const rank = idx + 4;
                        const delta = getRankDelta(user.id, rank);
                        const pct = Math.max(2, (user.plays / maxPlays) * 100);
                        const hasFire = user.plays >= (maxPlays * 0.4) && user.plays > 0;

                        return (
                            <div key={user.id} onClick={() => onUserClick(user)} className="flex items-center gap-3 sm:gap-4 bg-black/20 p-2 sm:p-3 rounded-lg border border-border/50 cursor-pointer hover:bg-black/40 hover:border-plex/50 transition-colors group relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 bg-plex/10 animate-[bar-grow_1s_ease-out]" style={{ width: `${pct}%` }}></div>
                                
                                <div className="w-6 text-center font-bold text-muted group-hover:text-text z-10">#{rank}</div>
                                <img src={resolveAvatar(user.thumb, 40, 40)} onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }} className="w-8 h-8 rounded-full border border-border z-10 bg-card flex-shrink-0" />
                                
                                <div className="flex-1 flex items-center gap-2 z-10 min-w-0">
                                    <span className="font-bold text-text truncate group-hover:text-plex transition-colors">{user.username}</span>
                                    {hasFire && <span className="text-sm" title="Hot Streak!">🔥</span>}
                                </div>

                                <div className="flex items-center gap-3 z-10 flex-shrink-0">
                                    {delta && (
                                        <div className="w-8 sm:w-10 text-right">
                                            {delta.type === 'new' && <span className="bg-plex/20 text-plex text-[9px] font-bold px-1.5 py-0.5 rounded animate-[rank-up_0.3s_ease-out]">NEW</span>}
                                            {delta.type === 'up' && <span className="text-green-400 text-xs font-bold animate-[rank-up_0.3s_ease-out]">↑{delta.val}</span>}
                                            {delta.type === 'down' && <span className="text-red-400 text-xs font-bold animate-[rank-down_0.3s_ease-out]">↓{delta.val}</span>}
                                        </div>
                                    )}
                                    <div className="w-16 sm:w-20 text-right font-mono text-xs sm:text-sm whitespace-nowrap">
                                        <CountUp end={user.plays} /> <span className="text-muted hidden sm:inline">plays</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
export const DetailsModal: React.FC<{ item: any, onClose: () => void }> = ({ item, onClose }) => {
    const [details, setDetails] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        if (!item) return;
        const fetchDetails = async () => {
            try {
                // Robust ratingKey extraction
                let ratingKey = '';
                if (item.ratingKey) {
                    ratingKey = item.ratingKey;
                } else if (item.key) {
                    const m = String(item.key).match(/\/(\d+)$/);
                    if (m) ratingKey = m[1];
                } else if (item.plexUrl) {
                    const decoded = decodeURIComponent(item.plexUrl);
                    const match = decoded.match(/metadata\/(\d+)/);
                    if (match) ratingKey = match[1];
                }

                if (!ratingKey) {
                    console.warn('Could not extract ratingKey from item:', item);
                    setLoading(false);
                    return;
                }
                const res = await apiFetch('/api/plex/item/' + encodeURIComponent(ratingKey));
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) setDetails(data);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchDetails();
    }, [item]);

    if (!item) return null;

    const formatDuration = (ms: number) => {
        if (!ms) return '0m';
        const mins = Math.floor(ms / 60000);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    const hasProgress = details?.viewOffset > 0 && details?.duration > 0;
    const progressPct = hasProgress ? Math.min(100, Math.max(0, (details.viewOffset / details.duration) * 100)) : 0;
    const isCompleted = details?.viewCount > 0;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 animate-fade-in backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border border-border w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animate-slide-up overflow-hidden relative isolate" onClick={e => e.stopPropagation()}>
                {/* Header with Background */}
                <div className="relative h-48 sm:h-56 flex-shrink-0 bg-black/50 border-b border-white/5 rounded-t-2xl overflow-hidden">
                    {details?.art ? (
                        <img src={resolvePortalAssetUrl(details.art)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/80 to-transparent" />
                    
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-black/40 hover:bg-black/60 rounded-full transition-colors text-white/70 hover:text-white z-10 border border-white/10">
                        <X className="w-5 h-5" />
                    </button>

                    <div className="absolute bottom-0 left-0 right-0 p-5 flex gap-4">
                        <div className={`w-16 sm:w-20 ${item.type === 'track' ? 'aspect-square' : 'aspect-[2/3]'} rounded-md overflow-hidden flex-shrink-0 shadow-lg border border-white/10 bg-black/50 z-10`}>
                            {details?.thumb || item.thumbUrl ? (
                                <img src={resolvePortalAssetUrl(details?.thumb || item.thumbUrl)} alt="" className="w-full h-full object-cover" />
                            ) : null}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-end pb-1 z-10">
                            <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight drop-shadow-md">
                                {details?.title || item.title}
                            </h2>
                            {(details?.year || details?.grandparentTitle) && (
                                <span className="text-sm text-white/70 font-semibold drop-shadow-sm mt-1">
                                    {details?.grandparentTitle ? `${details.grandparentTitle} • ` : ''}{details?.year || ''}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center items-center py-12"><span className="animate-pulse text-muted font-medium">Loading details...</span></div>
                    ) : details ? (
                        <div className="space-y-6">
                            {/* Watch Progress */}
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5 shadow-inner">
                                <div className="flex justify-between items-end mb-2.5">
                                    <div>
                                        <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Watch Status</h4>
                                        <p className="text-sm font-semibold text-text">
                                            {isCompleted ? 'Completed' : hasProgress ? `Watched ${formatDuration(details.viewOffset)} of ${formatDuration(details.duration)}` : `Duration: ${formatDuration(details.duration)}`}
                                        </p>
                                    </div>
                                    {isCompleted && <div className="text-plex drop-shadow-[0_0_8px_rgba(229,160,13,0.5)]"><CheckCircle className="w-5 h-5" /></div>}
                                </div>
                                {(hasProgress || isCompleted) && (
                                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                                        <div className="h-full bg-plex rounded-full transition-all duration-1000" style={{ width: isCompleted ? '100%' : `${progressPct}%` }} />
                                    </div>
                                )}
                            </div>

                            {/* Summary */}
                            {details.summary && (
                                <div>
                                    <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Overview</h4>
                                    <p className="text-sm text-text/80 leading-relaxed font-medium">{details.summary}</p>
                                </div>
                            )}
                            
                            <div className="pt-2">
                                <a href={item.plexUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-bold text-text transition-colors border border-white/5 hover:border-white/10">
                                    <PlaySquare className="w-4 h-4 text-plex" /> View on Plex
                                </a>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-muted font-medium">Details not available.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ItemViewersModal: React.FC<{
    item: { title: string, viewers: Record<string, any> } | null,
    onClose: () => void,
    resolveAvatar: (t: string|null|undefined) => string,
    onOpenProfile?: (accountId: string, username?: string) => void,
}> = ({ item, onClose, resolveAvatar, onOpenProfile }) => {
    if (!item) return null;
    const viewersArray = item.viewers
        ? Object.entries(item.viewers)
            .map(([accountId, row]: [string, any]) => ({
                ...row,
                accountId: row?.accountId || accountId,
            }))
            .sort((a: any, b: any) => (b.plays || 0) - (a.plays || 0))
        : [];
    
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 animate-fade-in backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[80vh] animate-slide-up overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-white/5 bg-black/20">
                    <h2 className="text-lg font-bold text-white pr-4 line-clamp-1 flex items-center gap-2"><PlaySquare className="w-5 h-5 text-plex" /> {item.title}</h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-muted hover:text-white flex-shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                    {viewersArray.length === 0 ? (
                        <p className="p-4 text-center text-muted text-sm leading-relaxed">No specific viewer data available for this item yet. Viewer data will populate automatically as new views occur.</p>
                    ) : (
                        <div className="flex flex-col gap-1 p-2">
                            {viewersArray.map((v: any, i: number) => {
                                const name = String(v.username || '').trim();
                                const anonymous = !name || name.toLowerCase() === 'anonymous' || /^viewer\s+\d+$/i.test(name);
                                const canOpen = !anonymous && typeof onOpenProfile === 'function' && (v.accountId || name);
                                return (
                                <div key={v.accountId || i} className="flex items-center justify-between p-3 bg-background/50 hover:bg-white/5 rounded-xl transition-colors border border-transparent hover:border-white/5">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 shadow-inner flex-shrink-0">
                                            <img src={resolveAvatar(v.thumb)} alt={name} className="w-full h-full object-cover" />
                                        </div>
                                        {canOpen ? (
                                            <button
                                                type="button"
                                                className="font-bold text-text truncate max-w-[150px] sm:max-w-[200px] hover:text-plex text-left"
                                                onClick={() => {
                                                    onOpenProfile(String(v.accountId || name), name);
                                                    onClose();
                                                }}
                                            >
                                                {name}
                                            </button>
                                        ) : (
                                            <span className="font-bold text-text truncate max-w-[150px] sm:max-w-[200px]">{name}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-plex/10 text-plex px-3 py-1.5 rounded-lg text-sm font-mono font-bold shadow-sm">
                                        {v.plays} {v.plays === 1 ? 'play' : 'plays'}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const AnalyticsDashboard: React.FC<{ isAdmin: boolean, sessionInfo: any, onNavigate?: (route: string, options?: { path?: string }) => void }> = ({ isAdmin, sessionInfo, onNavigate }) => {
    const { t } = useDiscoverI18n();
    const [analyticsData, setAnalyticsData] = useState<{
        topUsers: any[],
        topLibraries: any[],
        topMovies: any[],
        topShows: any[],
        topMusic: any[],
        topDevices: any[],
        peakHours: number[],
        totalPlaybacks: number,
        totalActiveUsers?: number,
        maxConcurrentStreams: number,
        maxDirectPlays: number,
        maxTranscodes: number,
        compare?: {
            previousPeriodDays: string,
            totalPlaybacks: { absolute: number, percent: number | null, previous?: number, current?: number },
            uniqueViewers: { absolute: number, percent: number | null, previous?: number, current?: number },
            libraryPlays: { absolute: number, percent: number | null, previous?: number, current?: number }
        } | null,
        libraryHealth?: {
            activeLibraries: number,
            concentrationPct: number,
            totalCatalogItems: number,
            totalCatalogBytes?: number,
            sizeGB: number,
            fourKPercent: number,
            catalogWatchedPct?: number,
            healthLabel: string,
            movies?: number,
            shows?: number,
            episodes?: number,
            artists?: number,
            albums?: number,
            tracks?: number,
            resolutions?: Record<string, number> | null,
            codecs?: Record<string, number> | null,
            fileSizes?: Record<string, any> | null,
            deltas?: any,
            generatedAt?: number | string | null,
            lastBuildFailures?: any[],
            failedLibraries?: any[],
        },
        requestedPeriodDays?: string | number,
        cachePeriodDays?: string | number | null,
        cacheFallback?: boolean,
        source?: string | null,
        fallback?: string | null,
        degraded?: boolean,
        rebuildPending?: boolean,
        preferredSource?: string | null,
        sourceLabel?: string | null,
        lastUpdated?: number | null,
    } | null>(null);
    const [tautulliData, setTautulliData] = useState<{ streamsRecord: number, transcodeRecord: number, directPlayRecord: number, directStreamRecord: number, totalPlays: number, tvPlays: number, moviePlays: number, musicPlays: number, totalTimeStr: string } | null>(null);
    const [isLoading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [days, setDays] = useState<string>('30');
    const [peakDate, setPeakDate] = useState<string>('');
    const [peakDateData, setPeakDateData] = useState<number[] | null>(null);
    const [peakDateLoading, setPeakDateLoading] = useState(false);
    const [selectedUser, setSelectedUser] = useState<{ id: string, username: string, thumb: string | null } | null>(null);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [userSearchOpen, setUserSearchOpen] = useState(false);
    const userSearchInputRef = useRef<HTMLInputElement>(null);
    const [userSearchMenuBox, setUserSearchMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
    const [contentTab, setContentTab] = useState<'movies' | 'shows' | 'music'>('movies');
    const [viewerItem, setViewerItem] = useState<{ title: string, viewers: Record<string, any> } | null>(null);
    const [viewerPage, setViewerPage] = useState(1);
    const viewersPerPage = 10;
    const [viewTab, setViewTab] = useState<'overview' | 'graphs'>('overview');
    const [analyticsToasts, setAnalyticsToasts] = useState<ToastMessage[]>([]);
    const [isRebuildingAnalytics, setIsRebuildingAnalytics] = useState(false);
    const [overviewSnapshotCollapsed, setOverviewSnapshotCollapsed] = usePersistedCollapsed(
        ANALYTICS_OVERVIEW_SNAPSHOT_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );
    const mediaServerType = String(sessionInfo?.mediaServerType || 'plex').toLowerCase();
    const isJellyfinPortal = mediaServerType === 'jellyfin' || mediaServerType === 'emby';
    const addAnalyticsToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setAnalyticsToasts((prev) => pushToast(prev, message, type));
    }, []);
    const analyticsSourceLabel = (() => {
        const stamped = String(analyticsData?.sourceLabel || '').trim();
        if (stamped) return stamped;
        const source = String(analyticsData?.source || '').toLowerCase();
        if (source === 'tautulli') return t('analytics.source.tautulli');
        if (source === 'plex') {
            if (analyticsData?.rebuildPending) return t('analytics.source.rebuildPending');
            if (analyticsData?.fallback === 'tautulli_not_configured') return t('analytics.source.tautulliNotConfigured');
            return analyticsData?.degraded
                ? t('analytics.source.plexDegraded')
                : t('analytics.source.plex');
        }
        if (source === 'jellystat') return t('analytics.source.jellystat');
        if (source === 'jellyglance') return t('analytics.source.jellyglance');
        if (source === 'emby') return t('analytics.source.emby');
        if (isJellyfinPortal) return mediaServerType === 'emby' ? t('analytics.source.emby') : t('analytics.source.jellystat');
        return t('analytics.source.plex');
    })();
    const analyticsSourceDegraded = !!analyticsData?.degraded;
    const analyticsRebuildPending = !!analyticsData?.rebuildPending;
    const analyticsLastUpdatedLabel = (() => {
        const ts = Number(analyticsData?.lastUpdated);
        if (!Number.isFinite(ts) || ts <= 0) return t('analytics.source.updatedUnknown');
        try {
            return t('analytics.source.updated', { time: new Date(ts).toLocaleString() });
        } catch {
            return t('analytics.source.updatedUnknown');
        }
    })();
    const libraryDeltas = (analyticsData?.libraryHealth as any)?.deltas || {};

    const resolveUserAvatar = (thumb: string | null | undefined, width = 80, height = 80) => {
        if (!thumb) return logoUrl();
        if (thumb.startsWith('http://') || thumb.startsWith('https://') || thumb.startsWith('/api/')) {
            return resolvePortalAssetUrl(thumb);
        }
        return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=${width}&height=${height}`);
    };

    useEffect(() => {
        if (!isAdmin) return;
        const fetchUsers = async () => {
            try {
                const usersData = await apiFetch('/api/users');
                setAllUsers(usersData);
            } catch (err) {
                console.error("Failed to fetch users", err);
            }
        };
        fetchUsers();
    }, []);

    useEffect(() => {
        const checkHash = () => {
            const hash = typeof window !== 'undefined' ? window.location.hash : '';
            if (!hash.startsWith('#user=')) return;
            const username = decodeURIComponent(hash.replace('#user=', '')).trim();
            if (!username) return;
            const found = allUsers.find((u: any) => String(u.username || '').toLowerCase() === username.toLowerCase());
            const fromLeaderboard = (analyticsData?.topUsers || []).find(
                (u: any) => String(u.username || '').toLowerCase() === username.toLowerCase(),
            );
            const analyticsId = String(
                found?.plexAccountId
                || fromLeaderboard?.id
                || found?.id
                || username,
            );
            setSelectedUser({
                id: analyticsId,
                username: found?.username || fromLeaderboard?.username || username,
                thumb: found?.thumb || fromLeaderboard?.thumb || null,
            });
        };

        checkHash();
        window.addEventListener('hashchange', checkHash);
        return () => window.removeEventListener('hashchange', checkHash);
    }, [allUsers, analyticsData?.topUsers]);

    const openUserAnalytics = useCallback((user: { id?: string | null; username?: string | null; thumb?: string | null; plexAccountId?: string | null }) => {
        const username = String(user?.username || '').trim();
        if (!username) return;
        const found = allUsers.find((u: any) => String(u.username || '').toLowerCase() === username.toLowerCase());
        const fromLeaderboard = (analyticsData?.topUsers || []).find(
            (u: any) => String(u.username || '').toLowerCase() === username.toLowerCase(),
        );
        const analyticsId = String(
            user?.plexAccountId
            || found?.plexAccountId
            || user?.id
            || fromLeaderboard?.id
            || found?.id
            || username,
        );
        setSelectedUser({
            id: analyticsId,
            username: found?.username || username,
            thumb: user?.thumb || found?.thumb || fromLeaderboard?.thumb || null,
        });
        if (typeof window !== 'undefined') {
            const nextHash = `#user=${encodeURIComponent(found?.username || username)}`;
            if (window.location.hash !== nextHash) {
                window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
            }
        }
        setUserSearchQuery('');
        setUserSearchOpen(false);
    }, [allUsers, analyticsData?.topUsers]);

    const openUserProfile = useCallback((user: { id?: string | null; username?: string | null; thumb?: string | null; plexAccountId?: string | null; accountId?: string | null }) => {
        const id = String(user?.plexAccountId || user?.accountId || user?.id || '').trim();
        if (id && onNavigate) {
            onNavigate('profile', { path: `/profile/${encodeURIComponent(id)}` });
            return;
        }
        if (isAdmin) openUserAnalytics(user);
    }, [isAdmin, onNavigate, openUserAnalytics]);

    const userSearchMatches = useMemo(() => {
        const q = userSearchQuery.trim().toLowerCase();
        if (!q || !isAdmin) return [];
        const seen = new Set<string>();
        const out: Array<{ id: string; username: string; thumb: string | null; email?: string; plexAccountId?: string | null }> = [];
        const push = (entry: { id?: string | null; username?: string | null; thumb?: string | null; email?: string; plexAccountId?: string | null }) => {
            const name = String(entry.username || '').trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (seen.has(key)) return;
            const hay = `${name} ${entry.email || ''}`.toLowerCase();
            if (!hay.includes(q)) return;
            seen.add(key);
            out.push({
                id: String(entry.plexAccountId || entry.id || name),
                username: name,
                thumb: entry.thumb || null,
                email: entry.email,
                plexAccountId: entry.plexAccountId || null,
            });
        };
        for (const u of allUsers) push(u);
        for (const u of analyticsData?.topUsers || []) push(u);
        return out.slice(0, 8);
    }, [allUsers, analyticsData?.topUsers, isAdmin, userSearchQuery]);

    useLayoutEffect(() => {
        if (!userSearchOpen || !userSearchQuery.trim()) {
            setUserSearchMenuBox(null);
            return;
        }
        const sync = () => {
            const el = userSearchInputRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const margin = 8;
            const maxHeight = Math.max(120, Math.min(288, window.innerHeight - rect.bottom - margin * 2));
            setUserSearchMenuBox({
                top: Math.round(rect.bottom + 4),
                left: Math.round(rect.left),
                width: Math.round(rect.width),
                maxHeight,
            });
        };
        sync();
        window.addEventListener('resize', sync);
        window.addEventListener('scroll', sync, true);
        window.visualViewport?.addEventListener('resize', sync);
        window.visualViewport?.addEventListener('scroll', sync);
        const mainScroll = document.getElementById('main-scroll-container');
        mainScroll?.addEventListener('scroll', sync, { passive: true });
        return () => {
            window.removeEventListener('resize', sync);
            window.removeEventListener('scroll', sync, true);
            window.visualViewport?.removeEventListener('resize', sync);
            window.visualViewport?.removeEventListener('scroll', sync);
            mainScroll?.removeEventListener('scroll', sync);
        };
    }, [userSearchOpen, userSearchQuery, userSearchMatches.length]);

    useEffect(() => {
        if (!peakDate) {
            setPeakDateData(null);
            return;
        }
        let cancelled = false;
        setPeakDateLoading(true);
        apiFetch(`/api/plex/analytics/day?date=${peakDate}`)
            .then(data => {
                if (!cancelled) setPeakDateData(data);
            })
            .catch(err => {
                console.error("Failed to fetch day analytics", err);
                if (!cancelled) setPeakDateData(null);
            })
            .finally(() => {
                if (!cancelled) setPeakDateLoading(false);
            });
        return () => { cancelled = true; };
    }, [peakDate]);

    useEffect(() => {
        let cancelled = false;
        const fetchAnalytics = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await apiFetch(`${isJellyfinPortal ? '/api/jellystat/analytics' : '/api/plex/analytics'}?days=${days}`);
                if (cancelled) return;
                setAnalyticsData(data);
            } catch (err: any) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchAnalytics();
        return () => { cancelled = true; };
    }, [days, isJellyfinPortal]);

    useEffect(() => {
        if (!analyticsData?.rebuildPending || isJellyfinPortal) return undefined;
        let cancelled = false;
        let attempts = 0;
        const maxAttempts = 24;
        let timer: number | undefined;
        const poll = () => {
            if (cancelled || attempts >= maxAttempts) return;
            attempts += 1;
            void apiFetch(`/api/plex/analytics?days=${days}`)
                .then((data) => {
                    if (cancelled) return;
                    setAnalyticsData(data);
                    if (data?.rebuildPending && attempts < maxAttempts) {
                        timer = window.setTimeout(poll, 8000);
                    }
                })
                .catch(() => {
                    if (!cancelled && attempts < maxAttempts) {
                        timer = window.setTimeout(poll, 8000);
                    }
                });
        };
        timer = window.setTimeout(poll, 8000);
        return () => {
            cancelled = true;
            if (timer) window.clearTimeout(timer);
        };
    }, [analyticsData?.rebuildPending, days, isJellyfinPortal]);

    const handleRebuildAnalyticsCache = useCallback(async () => {
        if (!isAdmin || isJellyfinPortal || isRebuildingAnalytics) return;
        setIsRebuildingAnalytics(true);
        try {
            const result = await apiFetch('/api/plex/analytics/rebuild', { method: 'POST' });
            if (result?.status === 'already_running') {
                addAnalyticsToast(t('analytics.source.rebuildRunning'), 'error');
            } else {
                addAnalyticsToast(result?.message || t('analytics.source.rebuildStarted'), 'success');
            }
            window.setTimeout(() => {
                void apiFetch(`/api/plex/analytics?days=${days}`)
                    .then((data) => setAnalyticsData(data))
                    .catch(() => { /* keep current */ });
            }, 8000);
        } catch (err: any) {
            addAnalyticsToast(err?.message || t('analytics.source.rebuildFailed'), 'error');
        } finally {
            setIsRebuildingAnalytics(false);
        }
    }, [addAnalyticsToast, days, isAdmin, isJellyfinPortal, isRebuildingAnalytics, t]);

    // Tautulli/Jellystat extras must not block the main analytics page (slow Tautulli = endless spinner).
    useEffect(() => {
        if (!isAdmin || isLoading) {
            if (!isAdmin) setTautulliData(null);
            return;
        }
        let cancelled = false;
        const fetchExtras = async () => {
            try {
                if (isJellyfinPortal) {
                    const embedded = (analyticsData as any)?.jellystatInsights || null;
                    if (!cancelled) setTautulliData(embedded);
                    return;
                }
                const tData = await apiFetch('/api/tautulli/stats');
                if (!cancelled) setTautulliData(tData);
            } catch {
                if (!cancelled) setTautulliData(null);
            }
        };
        fetchExtras();
        return () => { cancelled = true; };
    }, [days, isAdmin, isJellyfinPortal, isLoading, (analyticsData as any)?.jellystatInsights]);

    useEffect(() => {
        if (isJellyfinPortal && viewTab === 'graphs') setViewTab('overview');
    }, [isJellyfinPortal, viewTab]);

    const topUsersLength = analyticsData?.topUsers?.length || 0;
    const totalViewerPages = Math.max(1, Math.ceil(topUsersLength / viewersPerPage));

    useEffect(() => {
        setViewerPage(1);
    }, [days]);

    useEffect(() => {
        if (viewerPage > totalViewerPages) {
            setViewerPage(totalViewerPages);
        }
    }, [viewerPage, totalViewerPages]);

    if (isLoading) {
        return (
            <DashboardPageShell>
                <DashboardHero
                    accent="violet"
                    eyebrow="Analytics"
                    title="Advanced Analytics"
                    description="Playback trends, library health, and viewer insights for your server."
                    icon={<BarChart3 className="h-3.5 w-3.5" />}
                />
                <Loader isLoading={true} />
            </DashboardPageShell>
        );
    }
    if (error) {
        return (
            <DashboardPageShell>
                <DashboardHero
                    accent="violet"
                    eyebrow="Analytics"
                    title="Advanced Analytics"
                    icon={<BarChart3 className="h-3.5 w-3.5" />}
                />
                <div className="rounded-2xl border border-white/10 bg-black/25 p-8 text-center font-bold text-red-400">{error}</div>
            </DashboardPageShell>
        );
    }
    if (!analyticsData) return null;

    const { topUsers, topLibraries, topMovies, topShows, topMusic, topDevices, peakHours, totalPlaybacks, maxConcurrentStreams, maxDirectPlays, maxTranscodes } = analyticsData;
    const uniqueActiveViewers = topUsers.filter((u: any) => (u.plays || 0) > 0).length;
    const maxLibraryPlays = Math.max(...topLibraries.map(l => l.plays), 1);
    const maxDevicePlays = Math.max(...topDevices.map(d => d.plays), 1);
    const maxPeakHour = Math.max(...peakHours, 1);
    const viewerPageSafe = Math.min(viewerPage, totalViewerPages);
    const pagedTopUsers = topUsers.slice((viewerPageSafe - 1) * viewersPerPage, viewerPageSafe * viewersPerPage);

    let activeContent = topMovies;
    if (contentTab === 'shows') activeContent = topShows;
    else if (contentTab === 'music') activeContent = topMusic;
    const compare = analyticsData.compare || null;
    const libraryHealth = analyticsData.libraryHealth || null;

    const formatPriorPeriodLabel = (days: string) => {
        if (days === '1') return '24 hours';
        if (days === '7') return '7 days';
        if (days === '365') return 'year';
        if (days === '1825') return '5 years';
        return `${days} days`;
    };

    const renderDelta = (delta?: { absolute: number, percent: number | null, previous?: number, current?: number } | null) => {
        if (!delta) return null;
        if (delta.absolute === 0 && delta.previous === 0) return null;
        const isUp = delta.absolute >= 0;
        const sign = isUp ? '+' : '';
        let pctText: string;
        if (delta.percent !== null) {
            pctText = `${sign}${delta.percent}%`;
        } else if ((delta.previous ?? 0) === 0 && delta.absolute > 0) {
            pctText = 'New';
        } else {
            pctText = `${sign}${delta.absolute}`;
        }
        const priorLabel = compare?.previousPeriodDays ? formatPriorPeriodLabel(compare.previousPeriodDays) : null;
        const tooltip = priorLabel
            ? `Compared to the previous ${priorLabel}${delta.previous != null ? ` (${delta.previous})` : ''}`
            : undefined;
        return (
            <span
                title={tooltip}
                className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold mt-1 ${isUp ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}
            >
                {pctText}
            </span>
        );
    };
    const analyticsPeriodLabel = (() => {
        if (days === '1') return 'Last 24 hours';
        if (days === '7') return 'Last 7 days';
        if (days === '30') return 'Last 30 days';
        if (days === '60') return 'Last 60 days';
        if (days === '365') return 'Last year';
        if (days === '1825') return 'Last 5 years';
        if (days === 'all') return 'All time';
        return `Last ${days} days`;
    })();

    const analyticsTabs = [
        { id: 'overview' as const, label: 'Overview', icon: Activity },
        ...(!isJellyfinPortal ? [{ id: 'graphs' as const, label: 'Graphs', icon: LucideLineChart }] : []),
    ];

return (
        <DashboardPageShell>
            <ToastContainer toasts={analyticsToasts} setToasts={setAnalyticsToasts} />
            <DashboardHero
                accent="violet"
                eyebrow="Analytics"
                title="Advanced Analytics"
                description={(
                    <>
                        {totalPlaybacks.toLocaleString()} playbacks · {uniqueActiveViewers} active viewers · {analyticsPeriodLabel.toLowerCase()}
                        <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide align-middle ${
                            analyticsSourceDegraded || analyticsRebuildPending
                                ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                                : 'border-white/15 bg-white/5 text-muted'
                        }`}>
                            {t('analytics.source.badge', { source: analyticsSourceLabel })}
                        </span>
                        <span className="ml-2 inline-flex items-center rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-semibold text-muted align-middle normal-case tracking-normal">
                            {analyticsLastUpdatedLabel}
                        </span>
                    </>
                )}
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <div className="flex items-center gap-2 shrink-0">
                        {isAdmin && !isJellyfinPortal && (
                            <button
                                type="button"
                                onClick={() => void handleRebuildAnalyticsCache()}
                                disabled={isRebuildingAnalytics}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold text-text hover:bg-white/5 disabled:opacity-50"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${isRebuildingAnalytics ? 'animate-spin' : ''}`} />
                                {isRebuildingAnalytics ? t('analytics.source.rebuilding') : t('analytics.source.rebuild')}
                            </button>
                        )}
                        {viewTab === 'overview' ? (
                            <div className="w-[140px] md:w-48">
                                <CustomSelect
                                    value={days}
                                    onChange={(val) => setDays(val as string)}
                                    compact={true}
                                    options={[
                                        { label: 'Last 24 Hours', value: '1' },
                                        { label: 'Last 7 Days', value: '7' },
                                        { label: 'Last 30 Days', value: '30' },
                                        { label: 'Last 60 Days', value: '60' },
                                        { label: 'Last 1 Year', value: '365' },
                                        { label: 'Last 5 Years', value: '1825' },
                                        { label: 'All Time', value: 'all' },
                                    ]}
                                />
                            </div>
                        ) : null}
                    </div>
                )}
            />

            <div className="md:hidden">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">
                    Analytics section
                </label>
                <CustomSelect
                    id="analytics-section-select"
                    value={viewTab}
                    onChange={(val) => setViewTab(val as typeof viewTab)}
                    options={analyticsTabs.map((tab) => {
                        const Icon = tab.icon;
                        return {
                            label: tab.label,
                            value: tab.id,
                            icon: <Icon className="h-4 w-4" />,
                        };
                    })}
                />
            </div>

            <DashboardSubnav className="mb-1">
                {analyticsTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setViewTab(tab.id)}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors border-none outline-none cursor-pointer ${dashboardSubnavLinkClass(viewTab === tab.id)}`}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </DashboardSubnav>

            {viewTab === 'graphs' && <TautulliGraphsTab />}

            {viewTab === 'overview' && (
                <>
                    {analyticsData.cacheFallback && (
                        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                            Analytics cache for this period is still building. Showing cached data from the last {analyticsData.cachePeriodDays} day period instead.
                        </div>
                    )}
                    {analyticsRebuildPending && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            {t('analytics.source.mismatchHint')}
                        </div>
                    )}
                    {analyticsSourceDegraded && !analyticsRebuildPending && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            {t('analytics.source.degradedHint')}
                        </div>
                    )}
                    <section>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setOverviewSnapshotCollapsed(!overviewSnapshotCollapsed)}
                                aria-expanded={!overviewSnapshotCollapsed}
                                aria-label={overviewSnapshotCollapsed ? t('analytics.overviewSnapshot.expand') : t('analytics.overviewSnapshot.collapse')}
                            >
                                <span className="w-3 shrink-0 text-muted" aria-hidden>{overviewSnapshotCollapsed ? '▸' : '▾'}</span>
                                <h2 className="w-full border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-[2px] text-plex">
                                    {t('analytics.overviewSnapshot.title')}
                                </h2>
                            </button>
                            {overviewSnapshotCollapsed ? (
                                <span className="shrink-0 text-xs font-semibold text-muted">
                                    {[
                                        t('analytics.overviewSnapshot.playbacks', { count: totalPlaybacks }),
                                        t('analytics.overviewSnapshot.viewers', { count: uniqueActiveViewers }),
                                        libraryHealth?.healthLabel,
                                    ].filter(Boolean).join(' · ')}
                                </span>
                            ) : null}
                        </div>
                    {overviewSnapshotCollapsed ? null : (
                    <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                        <DashboardStatCard
                            label="Total Playbacks"
                            value={(
                                <span className="inline-flex flex-wrap items-center gap-2">
                                    <CountUp end={totalPlaybacks} />
                                    {renderDelta(compare?.totalPlaybacks)}
                                </span>
                            )}
                            icon={<PlaySquare className="h-4 w-4 text-plex" />}
                            glow={dashboardGlowClass('plex')}
                        />
                        <DashboardStatCard
                            label="Unique Viewers"
                            value={(
                                <span className="inline-flex flex-wrap items-center gap-2">
                                    {uniqueActiveViewers}
                                    {renderDelta(compare?.uniqueViewers)}
                                </span>
                            )}
                            icon={<Users className="h-4 w-4 text-violet-300" />}
                            glow={dashboardGlowClass('violet')}
                        />
                        <DashboardPanel
                            title="Peak viewing hours"
                            subtitle="Plays by hour of day"
                            className="col-span-2"
                        >
                            <div className="flex items-end gap-1 h-12 w-full">
                                {peakHours.map((val, idx) => (
                                    <div key={idx} className="flex-1 bg-plex opacity-20 hover:opacity-80 transition-opacity rounded-t-sm relative group" style={{ height: `${Math.max((val / maxPeakHour) * 100, 5)}%` }}>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-black/80 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                                            {idx === 0 ? '12 AM' : idx < 12 ? `${idx} AM` : idx === 12 ? '12 PM' : `${idx - 12} PM`}: {val} plays
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex justify-between text-[10px] text-muted mt-2 font-mono">
                                <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                            </div>
                        </DashboardPanel>
                    </div>
                    {libraryHealth && (
                        <>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                                <DashboardStatCard
                                    label="Library Balance"
                                    value={libraryHealth.healthLabel}
                                    hint="How evenly viewing is spread across libraries"
                                    icon={<PieChart className="h-4 w-4 text-plex" />}
                                    glow={dashboardGlowClass('plex')}
                                    valueClassName="text-plex text-xl md:text-2xl"
                                />
                                <DashboardStatCard
                                    label="Active Libraries"
                                    value={libraryHealth.activeLibraries}
                                    icon={<Layers className="h-4 w-4 text-sky-300" />}
                                    glow={dashboardGlowClass('sky')}
                                />
                                <DashboardStatCard
                                    label="Catalog Size"
                                    value={libraryHealth.totalCatalogItems.toLocaleString()}
                                    hint={`${formatSizeCeil(libraryHealth.totalCatalogBytes ?? libraryHealth.sizeGB * 1024 ** 3)}${formatCatalogScanAge(libraryHealth.generatedAt) ? ` · as of ${formatCatalogScanAge(libraryHealth.generatedAt)}` : ''}`}
                                    icon={<HardDrive className="h-4 w-4 text-violet-300" />}
                                    glow={dashboardGlowClass('violet')}
                                />
                                <DashboardStatCard
                                    label="Usage Concentration"
                                    value={`${libraryHealth.concentrationPct}%`}
                                    hint={`Watched: ${libraryHealth.catalogWatchedPct || 0}% · 4K: ${libraryHealth.fourKPercent}%`}
                                    icon={<TrendingUp className="h-4 w-4 text-amber-300" />}
                                    glow={dashboardGlowClass('amber')}
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
                                <DashboardStatCard
                                    label="Movies Catalog"
                                    value={(
                                        <span className="inline-flex items-center gap-1">
                                            <CountUp end={libraryHealth.movies || 0} />
                                            <LibraryDeltaBadge value={libraryDeltas.movies} />
                                        </span>
                                    )}
                                    hint="Total movies in library"
                                    icon={<Film className="h-4 w-4 text-plex" />}
                                    glow={dashboardGlowClass('plex')}
                                />
                                <DashboardStatCard
                                    label="TV Shows Catalog"
                                    value={(
                                        <span className="inline-flex items-center gap-1">
                                            <CountUp end={libraryHealth.shows || 0} />
                                            <span className="text-sm font-semibold text-muted">shows</span>
                                            <LibraryDeltaBadge value={libraryDeltas.shows} />
                                        </span>
                                    )}
                                    hint={(
                                        <span className="inline-flex items-center gap-1">
                                            <CountUp end={libraryHealth.episodes || 0} />
                                            <span>episodes</span>
                                            <LibraryDeltaBadge value={libraryDeltas.episodes} />
                                        </span>
                                    )}
                                    icon={<Tv className="h-4 w-4 text-sky-300" />}
                                    glow={dashboardGlowClass('sky')}
                                />
                                <DashboardStatCard
                                    label="Music Catalog"
                                    value={(
                                        <span className="inline-flex items-center gap-1">
                                            <CountUp end={libraryHealth.artists || 0} />
                                            <span className="text-sm font-semibold text-muted">artists</span>
                                            <LibraryDeltaBadge value={libraryDeltas.artists} />
                                        </span>
                                    )}
                                    hint={(
                                        <span className="inline-flex flex-wrap items-center gap-1">
                                            <CountUp end={libraryHealth.albums || 0} />
                                            <span>albums</span>
                                            <LibraryDeltaBadge value={libraryDeltas.albums} />
                                            <span>·</span>
                                            <CountUp end={libraryHealth.tracks || 0} />
                                            <span>tracks</span>
                                            <LibraryDeltaBadge value={libraryDeltas.tracks} />
                                        </span>
                                    )}
                                    icon={<Music className="h-4 w-4 text-violet-300" />}
                                    glow={dashboardGlowClass('violet')}
                                />
                            </div>
                            {((libraryHealth.lastBuildFailures || []).length > 0 || (libraryHealth.failedLibraries || []).length > 0) ? (
                                <p className="text-xs text-amber-300/90 -mt-1">
                                    Last library scan could not finish. Catalog totals are from the last complete count — nothing was deleted.
                                </p>
                            ) : null}

                            {libraryHealth.resolutions && libraryHealth.codecs && libraryHealth.fileSizes && (() => {
                                const sortedCodecs = Object.entries(libraryHealth.codecs || {})
                                    .map(([name, count]) => ({ name, count: count as number }))
                                    .sort((a, b) => b.count - a.count);
                                const totalCodecs = sortedCodecs.reduce((sum, item) => sum + item.count, 0) || 1;

                                const sortedResolutions = Object.entries(libraryHealth.resolutions || {})
                                    .map(([name, count]) => ({ name, count: count as number }))
                                    .sort((a, b) => b.count - a.count);
                                const totalResolutions = sortedResolutions.reduce((sum, item) => sum + item.count, 0) || 1;

                                const fileSizeEntries = Object.entries(libraryHealth.fileSizes || {})
                                    .map(([range, val]) => {
                                        let movies = 0;
                                        let shows = 0;
                                        if (val && typeof val === 'object') {
                                            movies = (val as any).movies || 0;
                                            shows = (val as any).shows || 0;
                                        } else if (typeof val === 'number') {
                                            shows = val;
                                        }
                                        return { range, movies, shows, total: movies + shows };
                                    });
                                const maxFileSizeCount = Math.max(...fileSizeEntries.map(e => e.total), 1);

                                return (
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <DashboardPanel title="Video Codecs" subtitle="Share of library by codec">
                                            <div className="flex flex-col gap-3">
                                                {sortedCodecs.map((item) => {
                                                    const pct = Math.round((item.count / totalCodecs) * 100);
                                                    return (
                                                        <div key={item.name} className="flex flex-col gap-1">
                                                            <div className="flex justify-between text-xs font-semibold">
                                                                <span className="text-text">{item.name}</span>
                                                                <span className="text-muted font-mono">{item.count.toLocaleString()} ({pct}%)</span>
                                                            </div>
                                                            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                                                                <div className="bg-plex h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </DashboardPanel>

                                        <DashboardPanel title="Resolutions" subtitle="Share of library by resolution">
                                            <div className="flex flex-col gap-3">
                                                {sortedResolutions.map((item) => {
                                                    const pct = Math.round((item.count / totalResolutions) * 100);
                                                    return (
                                                        <div key={item.name} className="flex flex-col gap-1">
                                                            <div className="flex justify-between text-xs font-semibold">
                                                                <span className="text-text">{item.name}</span>
                                                                <span className="text-muted font-mono">{item.count.toLocaleString()} ({pct}%)</span>
                                                            </div>
                                                            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                                                                <div className="bg-plex h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </DashboardPanel>

                                        <DashboardPanel
                                            title="File Size Distribution"
                                            subtitle="Movies vs TV episodes by size bucket"
                                            controls={(
                                                <div className="flex items-center gap-3 text-[10px] text-muted font-semibold">
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-2 h-2 bg-plex rounded-sm inline-block" />
                                                        <span>Movies</span>
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-2 h-2 bg-plex/30 rounded-sm inline-block border border-plex/20" />
                                                        <span>TV Shows</span>
                                                    </span>
                                                </div>
                                            )}
                                        >
                                            <div className="flex items-end justify-between h-40 pt-4 px-2 w-full gap-3">
                                                {fileSizeEntries.map((item) => {
                                                    const totalHeightPct = (item.total / maxFileSizeCount) * 100;
                                                    const moviesPctOfBar = item.total > 0 ? (item.movies / item.total) * 100 : 0;
                                                    const showsPctOfBar = item.total > 0 ? (item.shows / item.total) * 100 : 0;
                                                    
                                                    return (
                                                        <div key={item.range} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group relative">
                                                            <div 
                                                                className="w-full relative transition-all duration-500 flex flex-col justify-end" 
                                                                style={{ height: `${Math.max(totalHeightPct, 4)}%` }}
                                                            >
                                                                {/* Bar container with overflow-hidden for rounded-t corners */}
                                                                <div className="w-full h-full rounded-t overflow-hidden flex flex-col justify-end">
                                                                    {/* Movies part (Top) */}
                                                                    {item.movies > 0 && (
                                                                        <div 
                                                                            className="w-full bg-plex hover:opacity-100 transition-opacity" 
                                                                            style={{ height: `${moviesPctOfBar}%` }} 
                                                                        />
                                                                    )}
                                                                    {/* TV Shows part (Bottom) */}
                                                                    {item.shows > 0 && (
                                                                        <div 
                                                                            className="w-full bg-plex/30 hover:opacity-100 transition-opacity border-t border-black/10" 
                                                                            style={{ height: `${showsPctOfBar}%` }} 
                                                                        />
                                                                    )}
                                                                </div>

                                                                {/* Detailed Tooltip (Placed outside the overflow-hidden container, inside the height wrapper) */}
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-black/95 text-white text-[10px] px-2.5 py-1.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-20 font-mono shadow-md border border-white/5 flex flex-col gap-0.5 leading-none">
                                                                    <span className="font-bold text-plex mb-1 text-[11px]">{item.range}</span>
                                                                    <span className="flex justify-between gap-4"><span>Movies:</span> <span className="text-white font-bold">{item.movies.toLocaleString()}</span></span>
                                                                    <span className="flex justify-between gap-4"><span>TV Episodes:</span> <span className="text-white font-bold">{item.shows.toLocaleString()}</span></span>
                                                                    <span className="border-t border-white/10 mt-1 pt-1 flex justify-between gap-4"><span>Total:</span> <span className="text-plex font-bold">{item.total.toLocaleString()}</span></span>
                                                                </div>
                                                            </div>
                                                            <span className="text-[9px] text-muted font-bold tracking-wider text-center line-clamp-1 w-full" title={item.range}>{item.range}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </DashboardPanel>
                                    </div>
                                );
                            })()}
                        </>
                    )}
                    </div>
                    )}
                    </section>

                    {isAdmin ? (
                        <DashboardPanel
                            title="Find user"
                            subtitle="Search by username or email to open their stats and watch history."
                        >
                            <div className="relative w-full">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                <input
                                    ref={userSearchInputRef}
                                    type="text"
                                    inputMode="search"
                                    enterKeyHint="search"
                                    value={userSearchQuery}
                                    onChange={(event) => {
                                        setUserSearchQuery(event.target.value);
                                        setUserSearchOpen(true);
                                    }}
                                    onFocus={() => setUserSearchOpen(true)}
                                    onBlur={() => window.setTimeout(() => setUserSearchOpen(false), 150)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            const first = userSearchMatches[0];
                                            if (first) openUserAnalytics(first);
                                        }
                                        if (event.key === 'Escape') {
                                            setUserSearchOpen(false);
                                            setUserSearchQuery('');
                                        }
                                    }}
                                    placeholder="e.g. username or email…"
                                    className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 py-3 pr-10 pl-10 text-[16px] leading-5 text-text outline-none transition focus:border-plex/40 focus:ring-1 focus:ring-plex/20"
                                    style={{ fontSize: 16 }}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                />
                                {userSearchOpen && userSearchQuery.trim() && userSearchMenuBox && typeof document !== 'undefined'
                                    ? ReactDOM.createPortal(
                                            <div
                                                className="fixed z-[500] overflow-y-auto rounded-xl border border-border shadow-2xl custom-scrollbar"
                                                style={{
                                                    top: userSearchMenuBox.top,
                                                    left: userSearchMenuBox.left,
                                                    width: userSearchMenuBox.width,
                                                    maxHeight: userSearchMenuBox.maxHeight,
                                                    backgroundColor: 'rgb(var(--color-card))',
                                                }}
                                            >
                                                {userSearchMatches.length ? userSearchMatches.map((match) => (
                                                    <button
                                                        key={match.username}
                                                        type="button"
                                                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/10"
                                                        style={{ backgroundColor: 'rgb(var(--color-card))' }}
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() => openUserAnalytics(match)}
                                                    >
                                                        <img
                                                            src={resolveUserAvatar(match.thumb, 40, 40)}
                                                            alt=""
                                                            className="h-8 w-8 rounded-full object-cover bg-black/40"
                                                            onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                                                        />
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-sm font-semibold text-text">{match.username}</span>
                                                            {match.email ? (
                                                                <span className="block truncate text-[11px] text-muted">{match.email}</span>
                                                            ) : null}
                                                        </span>
                                                        <BarChart3 className="h-4 w-4 shrink-0 text-plex" />
                                                    </button>
                                                )) : (
                                                    <p className="px-3 py-3 text-sm text-muted" style={{ backgroundColor: 'rgb(var(--color-card))' }}>
                                                        No users match “{userSearchQuery.trim()}”.
                                                    </p>
                                                )}
                                            </div>,
                                            document.body,
                                        )
                                        : null}
                            </div>
                        </DashboardPanel>
                    ) : null}

                    <div className="w-full">
                        {(sessionInfo?.navFeatures?.achievementsLeaderboard
                            ?? sessionInfo?.navFeatures?.achievements) ? (
                            <AchievementsAnalyticsLeaderboard
                                resolveAvatar={resolveUserAvatar}
                                resolveThumbForUsername={(username) => {
                                    const key = String(username || '').toLowerCase();
                                    const fromUsers = allUsers.find((u: any) => String(u.username || '').toLowerCase() === key);
                                    if (fromUsers?.thumb) return fromUsers.thumb;
                                    const fromTop = (topUsers || []).find((u: any) => String(u.username || '').toLowerCase() === key);
                                    return fromTop?.thumb || null;
                                }}
                                isAdmin={isAdmin}
                                onUserClick={(u) => openUserProfile(u)}
                            />
                        ) : (
                            <AnimatedLeaderboard users={topUsers} resolveAvatar={resolveUserAvatar} isAdmin={isAdmin} onUserClick={(u: any) => openUserProfile(u)} />
                        )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                        <ServerInsightsWidget 
                            peakHours={analyticsData?.peakHours || []} 
                            tautulliData={tautulliData} 
                            compare={analyticsData?.compare} 
                            analyticsSourceLabel={analyticsSourceLabel}
                            peakDate={peakDate}
                            setPeakDate={setPeakDate}
                            peakDateData={peakDateData}
                            peakDateLoading={peakDateLoading}
                            isJellyfinPortal={isJellyfinPortal}
                            periodPlays={analyticsData?.totalPlaybacks || tautulliData?.totalPlays || 0}
                            uniqueViewers={analyticsData?.totalActiveUsers || topUsers?.length || 0}
                        />

                        {/* Top Devices & Libraries Container */}
                        <div className="flex flex-col gap-6 lg:col-span-1">
                            <DashboardPanel title="Popular Libraries" subtitle="Most played libraries in this period">
                                <div className="flex flex-col gap-5 mt-1">
                                    {topLibraries.length === 0 ? <p className="text-muted text-sm">No data available.</p> : topLibraries.map((lib, idx) => (
                                        <div key={lib.id} className="flex flex-col gap-2">
                                            <div className="flex justify-between items-end">
                                                <span className="font-bold text-text flex items-center gap-2"><span className="text-muted text-xs">#{idx + 1}</span> {lib.title}</span>
                                                <span className="text-xs text-muted font-mono">{lib.plays} plays</span>
                                            </div>
                                            <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-plex to-[#e5a00d] rounded-full" style={{ width: `${(lib.plays / maxLibraryPlays) * 100}%` }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </DashboardPanel>

                            {topDevices && topDevices.length > 0 && (
                                <DashboardPanel title="Top Devices" subtitle="Where your users watch from">
                                    <div className="flex flex-col gap-4">
                                        {topDevices.slice(0, 5).map((device: any, idx: number) => (
                                            <div key={idx} className="flex flex-col gap-1.5">
                                                <div className="flex justify-between items-end">
                                                    <span className="font-bold text-sm text-text truncate pr-2 flex items-center gap-2">
                                                        <span className="text-muted text-xs">#{idx + 1}</span> {device.name || 'Unknown Device'}
                                                    </span>
                                                    <span className="text-xs text-muted font-mono flex-shrink-0">{device.plays} plays</span>
                                                </div>
                                                <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
                                                    <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-1000" style={{ width: `${(device.plays / Math.max(maxDevicePlays, 1)) * 100}%` }}></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </DashboardPanel>
                            )}
                        </div>



                        <DashboardPanel
                            title="Trending Content"
                            subtitle="Most played titles in this period"
                            className="col-span-full"
                            controls={(
                                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                                    <button onClick={() => setContentTab('movies')} className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all border-none outline-none cursor-pointer ${contentTab === 'movies' ? 'bg-plex text-background shadow-md shadow-plex/25' : 'text-muted hover:text-text hover:bg-white/5'}`}>Movies</button>
                                    <button onClick={() => setContentTab('shows')} className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all border-none outline-none cursor-pointer ${contentTab === 'shows' ? 'bg-plex text-background shadow-md shadow-plex/25' : 'text-muted hover:text-text hover:bg-white/5'}`}>TV Shows</button>
                                    <button onClick={() => setContentTab('music')} className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all border-none outline-none cursor-pointer ${contentTab === 'music' ? 'bg-plex text-background shadow-md shadow-plex/25' : 'text-muted hover:text-text hover:bg-white/5'}`}>Music</button>
                                </div>
                            )}
                        >
                            <div className="flex flex-col gap-4">
                                {activeContent.length === 0 ? <p className="text-muted text-sm col-span-full">No data available.</p> : activeContent.slice(0, 10).map((item, idx) => {
                                    const viewerCount = item.viewers ? Object.keys(item.viewers).length : 0;
                                    return (
                                    <div key={item.key} className="flex flex-col sm:flex-row bg-black/20 rounded-xl overflow-hidden hover:bg-black/40 transition-all group hover:ring-1 hover:ring-plex shadow-md">
                                        <div className={`sm:w-32 lg:w-40 flex-shrink-0 relative ${contentTab === 'music' ? 'aspect-square' : 'aspect-[2/3]'}`}>
                                            {item.thumbUrl ? (
                                                <img src={resolvePortalAssetUrl(item.thumbUrl)} alt={item.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-black/40"><Film className="w-8 h-8 opacity-50 text-muted" /></div>
                                            )}
                                            <div className="absolute top-2 left-2 bg-plex text-black font-bold text-xs px-2 py-1 rounded-md shadow-lg drop-shadow-md">#{idx + 1}</div>
                                        </div>
                                        <div className="p-4 sm:p-5 flex flex-col justify-between flex-grow">
                                            <div>
                                                <div className="flex items-start justify-between gap-2 mb-2">
                                                    <h3 className="text-lg sm:text-xl font-bold text-text group-hover:text-plex transition-colors line-clamp-1">{item.title}</h3>
                                                    <div className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-md text-xs font-mono text-plex flex-shrink-0 whitespace-nowrap shadow-sm">
                                                        <PlaySquare className="w-3 h-3" /> {item.plays} plays
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted mb-3 font-medium">
                                                    {item.year && <span>{item.year}</span>}
                                                    {item.year && (item.contentRating || item.rating || item.duration > 0 || (item.genres && item.genres.length > 0)) && <span className="opacity-50">&bull;</span>}
                                                    {item.contentRating && <span>{item.contentRating}</span>}
                                                    {item.contentRating && (item.rating || item.duration > 0 || (item.genres && item.genres.length > 0)) && <span className="opacity-50">&bull;</span>}
                                                    {item.duration > 0 && <span>{Math.round(item.duration / 60000)} min</span>}
                                                    {item.duration > 0 && item.rating && <span className="opacity-50">&bull;</span>}
                                                    {item.rating && (
                                                        <span className="flex items-center gap-1 text-yellow-500">
                                                            <Star className="w-3 h-3 fill-current" /> {item.rating}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-text/80 line-clamp-2 sm:line-clamp-3 mb-3 leading-relaxed">
                                                    {item.summary || "No summary available."}
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 mt-auto">
                                                {item.genres && item.genres.length > 0 ? (
                                                    item.genres.slice(0, 4).map((g: string, i: number) => (
                                                        <span key={i} className="text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-muted px-2 py-1 rounded-full shadow-sm">{g}</span>
                                                    ))
                                                ) : null}
                                                {item.genres && item.genres.length > 4 ? (
                                                    <span className="text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-muted px-2 py-1 rounded-full shadow-sm">+{item.genres.length - 4}</span>
                                                ) : null}
                                                {viewerCount > 0 ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setViewerItem(item)}
                                                        className="text-[10px] uppercase tracking-wider bg-plex/15 border border-plex/30 text-plex px-2 py-1 rounded-full shadow-sm hover:bg-plex/25"
                                                    >
                                                        {t('analytics.overviewSnapshot.viewers', { count: viewerCount })}
                                                    </button>
                                                ) : null}
                                                {item.plexUrl ? (
                                                    <a
                                                        href={item.plexUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-muted px-2 py-1 rounded-full shadow-sm hover:text-text hover:border-plex/40"
                                                    >
                                                        {t('common.view')}
                                                    </a>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        </DashboardPanel>
                    </div>
                </>
            )}
            {isAdmin && selectedUser && (
                <UserAnalyticsModal
                    userId={selectedUser.id}
                    username={selectedUser.username}
                    thumb={selectedUser.thumb}
                    days={days}
                    onOpenProfile={(id) => {
                        setSelectedUser(null);
                        if (onNavigate) goToProfile(onNavigate, id, selectedUser.username);
                    }}
                    onClose={() => {
                        setSelectedUser(null);
                        if (window.location.hash.startsWith('#user=')) {
                            window.history.pushState('', document.title, window.location.pathname + window.location.search);
                        }
                    }}
                />
            )}
            {viewerItem ? (
                <ItemViewersModal
                    item={viewerItem}
                    onClose={() => setViewerItem(null)}
                    resolveAvatar={(thumb) => resolveUserAvatar(thumb, 80, 80)}
                    onOpenProfile={(id, username) => {
                        setViewerItem(null);
                        if (onNavigate) goToProfile(onNavigate, id, username);
                    }}
                />
            ) : null}
        </DashboardPageShell>
    );
};
