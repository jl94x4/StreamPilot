import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Calendar, Clapperboard, Clock, Coffee, Compass, Film, Layers, PieChart, PlayCircle, Tv, X } from 'lucide-react';
import { formatStreamingHour } from './format';
import { resolvePortalAssetUrl } from './basePath';
import { sizedPlexImageUrl } from './plexImageUrl';
import { lockBackgroundScroll } from './lockBackgroundScroll';

export const WrapUpModal: React.FC<{
    metric: string;
    analytics: any;
    days: number | string;
    onClose: () => void;
    onOpenProfile?: (accountId: string) => void;
}> = ({ metric, analytics, days, onClose, onOpenProfile }) => {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    useEffect(() => lockBackgroundScroll(), []);

    const renderContent = () => {
        switch (metric) {
            case 'Server Rank': {
                const leaderboardRank = Number(analytics.leaderboardRank);
                const totalActiveUsers = Number(analytics.totalActiveUsers) || 0;
                const hasRank = Number.isFinite(leaderboardRank) && leaderboardRank > 0;
                const percentile = hasRank && totalActiveUsers > 0 ? Math.max(1, Math.round((leaderboardRank / totalActiveUsers) * 100)) : null;
                const progressPct = hasRank && totalActiveUsers > 0 ? Math.max(2, 100 - Math.round(((leaderboardRank - 1) / totalActiveUsers) * 100)) : 0;
                const neighbourhood: any[] = analytics.leaderboardNeighbourhood || [];
                const isXpRank = analytics.leaderboardSource === 'achievements' || analytics.leaderboardMetric === 'xp';
                const myScore = isXpRank
                    ? (analytics.myXp ?? analytics.myPlaysOnLeaderboard ?? 0)
                    : (analytics.myPlaysOnLeaderboard || analytics.totalPlays || 0);
                const userAbove = hasRank ? neighbourhood.find((u: any) => !u.isMe && u.rank < leaderboardRank) : null;
                const aboveScore = userAbove ? Number(userAbove.xp ?? userAbove.plays ?? 0) : 0;
                const scoreToClimb = userAbove ? (aboveScore - Number(myScore) + 1) : null;

                const rankEmoji = (leaderboardRank === 1) ? '🥇' : (leaderboardRank === 2) ? '🥈' : (leaderboardRank === 3) ? '🥉' : '🏆';

                return (
                    <div className="flex flex-col items-center justify-center text-center p-6">
                        <span className="text-5xl mb-3">{rankEmoji}</span>
                        <h2 className="text-3xl font-black text-white mb-1">{hasRank ? `Rank #${leaderboardRank}` : 'Not ranked yet'}</h2>
                        <p className="text-muted mb-5 text-sm">
                            {isXpRank
                                ? `Overall · out of ${totalActiveUsers} on the achievements board`
                                : `Out of ${totalActiveUsers} active users`}
                        </p>

                        {/* Progress bar */}
                        <div className="w-full mb-1">
                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-1.5">
                                <span className="text-gray-500">#1 Top</span>
                                <span className="text-plex">{percentile ? `Top ${percentile}%` : 'No rank yet'}</span>
                                <span className="text-gray-500">{totalActiveUsers > 0 ? `#${totalActiveUsers} Last` : 'No users'}</span>
                            </div>
                            <div className="w-full h-3 bg-black/50 rounded-full overflow-hidden border border-white/10">
                                <div
                                    className="h-full bg-gradient-to-r from-plex via-amber-400 to-orange-400 rounded-full shadow-[0_0_10px_rgba(229,160,13,0.6)] transition-all duration-1000"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-2 gap-3 w-full mt-4 mb-4">
                            <div className="bg-gradient-to-b from-white/10 to-white/5 border border-white/10 rounded-xl p-4 flex flex-col items-center shadow-lg">
                                <span className="text-2xl font-black text-white mb-1">{myScore}</span>
                                <span className="text-[9px] text-muted uppercase tracking-widest font-black">
                                    {isXpRank ? 'My XP' : 'My Streams'}
                                </span>
                            </div>
                            <div className="bg-gradient-to-b from-plex/20 to-plex/5 border border-plex/30 rounded-xl p-4 flex flex-col items-center shadow-lg relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-16 h-16 bg-plex/20 blur-xl -mr-5 -mt-5 rounded-full" />
                                <span className="text-2xl font-black text-plex mb-1">{percentile ? `${percentile}%` : '-'}</span>
                                <span className="text-[9px] text-plex/80 uppercase tracking-widest font-black">Top Percentile</span>
                            </div>
                        </div>

                        {/* Score to climb */}
                        {scoreToClimb !== null && scoreToClimb > 0 && (
                            <div className="w-full bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 mb-4 text-sm text-blue-300 font-medium">
                                🎯 <strong>
                                    {isXpRank
                                        ? `${scoreToClimb.toLocaleString()} more XP`
                                        : `${scoreToClimb} more stream${scoreToClimb !== 1 ? 's' : ''}`}
                                </strong> to overtake <strong>{userAbove?.username}</strong> (Rank #{userAbove?.rank})
                            </div>
                        )}
                        {scoreToClimb === null && leaderboardRank === 1 && (
                            <div className="w-full bg-plex/10 border border-plex/30 rounded-xl px-4 py-3 mb-4 text-sm text-plex font-medium">
                                👑 You're at the top of the leaderboard!
                            </div>
                        )}
                        {!hasRank && (
                            <div className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-4 text-sm text-muted font-medium">
                                {isXpRank
                                    ? 'Earn XP from watch history to appear on the overall server leaderboard.'
                                    : 'Stream activity has not been matched to your account for this period yet.'}
                            </div>
                        )}

                        {/* Mini leaderboard neighbourhood */}
                        {neighbourhood.length > 0 && (
                            <div className="w-full">
                                <p className="text-left text-xs uppercase tracking-widest font-bold text-muted mb-3 border-b border-white/10 pb-2">
                                    {isXpRank ? 'Overall Leaderboard Position' : 'Your Leaderboard Position'}
                                </p>
                                <div className="flex flex-col gap-1.5">
                                    {neighbourhood.map((u: any, i: number) => {
                                        const canOpen = typeof onOpenProfile === 'function' && u.accountId;
                                        const className = `flex items-center justify-between rounded-lg px-3 py-2.5 border transition-all w-full text-left ${u.isMe
                                            ? 'bg-plex/15 border-plex/50 shadow-[0_0_12px_rgba(229,160,13,0.2)]'
                                            : 'bg-white/5 border-white/5'
                                            }${canOpen ? ' hover:border-plex/40 cursor-pointer' : ''}`;
                                        const body = (
                                            <>
                                            <div className="flex items-center gap-3">
                                                <span className={`font-black text-sm w-8 text-right ${u.isMe ? 'text-plex' : 'text-gray-500'}`}>#{u.rank}</span>
                                                <span className={`font-bold text-sm ${u.isMe ? 'text-white' : 'text-gray-300'}`}>
                                                    {u.isMe ? <span className="inline-flex items-center gap-1.5">{u.username} <span className="text-[9px] text-plex font-black uppercase tracking-widest bg-plex/20 px-1.5 py-0.5 rounded">You</span></span> : u.username}
                                                </span>
                                            </div>
                                            <span className={`text-xs font-black whitespace-nowrap ${u.isMe ? 'text-plex' : 'text-gray-400'}`}>
                                                {isXpRank
                                                    ? `${Number(u.xp ?? u.plays ?? 0).toLocaleString()} XP`
                                                    : `${u.plays} plays`}
                                            </span>
                                            </>
                                        );
                                        if (canOpen) {
                                            return (
                                                <button key={i} type="button" className={className} onClick={() => onOpenProfile(String(u.accountId))}>
                                                    {body}
                                                </button>
                                            );
                                        }
                                        return (
                                            <div key={i} className={className}>
                                                {body}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                );
            }
            case 'Total Streams': {
                const total = analytics.totalPlays || 0;
                const movies = analytics.moviesCount || 0;
                const episodes = analytics.showsCount || 0;
                const tracks = analytics.musicCount || 0;
                const moviePct = total > 0 ? Math.round((movies / total) * 100) : 0;
                const episodePct = total > 0 ? Math.round((episodes / total) * 100) : 0;
                const trackPct = total > 0 ? Math.round((tracks / total) * 100) : 0;
                // Approximate daily average based on current filter
                const filterDays = (days === 'all' || !days) ? 365 : (parseInt(String(days)) || 30);
                const dailyAvg = filterDays > 0 ? (total / filterDays).toFixed(1) : '—';
                const recentItems = (analytics.recentHistory || []).slice(0, 5);

                return (
                    <div className="flex flex-col items-center justify-center text-center p-6">
                        <PlayCircle className="w-14 h-14 text-plex mb-3 drop-shadow-lg" />
                        <h2 className="text-5xl font-black text-white mb-1">{total}</h2>
                        <p className="text-muted uppercase tracking-widest text-xs font-bold mb-5">Total Streams</p>

                        {/* Type breakdown bars */}
                        <div className="w-full flex flex-col gap-3 mb-5">
                            <div>
                                <div className="flex justify-between text-xs font-bold mb-1">
                                    <span className="text-blue-400">🎬 Movies</span>
                                    <span className="text-gray-300">{movies} <span className="text-gray-500">({moviePct}%)</span></span>
                                </div>
                                <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/5">
                                    <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-1000" style={{ width: `${moviePct}%` }} />
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-xs font-bold mb-1">
                                    <span className="text-green-400">📺 Episodes</span>
                                    <span className="text-gray-300">{episodes} <span className="text-gray-500">({episodePct}%)</span></span>
                                </div>
                                <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/5">
                                    <div className="h-full bg-gradient-to-r from-green-600 to-green-400 rounded-full transition-all duration-1000" style={{ width: `${episodePct}%` }} />
                                </div>
                            </div>
                            {tracks > 0 && (
                                <div>
                                    <div className="flex justify-between text-xs font-bold mb-1">
                                        <span className="text-purple-400">🎵 Tracks</span>
                                        <span className="text-gray-300">{tracks} <span className="text-gray-500">({trackPct}%)</span></span>
                                    </div>
                                    <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/5">
                                        <div className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full transition-all duration-1000" style={{ width: `${trackPct}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Extra stats */}
                        <div className="grid grid-cols-2 gap-3 w-full mb-5">
                            <div className="bg-gradient-to-b from-white/10 to-white/5 border border-white/10 rounded-xl p-4 flex flex-col items-center shadow-lg">
                                <span className="text-2xl font-black text-white mb-1">{dailyAvg}</span>
                                <span className="text-[9px] text-muted uppercase tracking-widest font-black">Per Day</span>
                            </div>
                            <div className="bg-gradient-to-b from-plex/20 to-plex/5 border border-plex/30 rounded-xl p-4 flex flex-col items-center shadow-lg relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-12 h-12 bg-plex/20 blur-xl -mr-4 -mt-4 rounded-full" />
                                <span className="text-2xl font-black text-plex mb-1">{analytics.uniqueTitles || 0}</span>
                                <span className="text-[9px] text-plex/80 uppercase tracking-widest font-black">Unique Titles</span>
                            </div>
                        </div>

                        {/* Recent activity */}
                        {recentItems.length > 0 && (
                            <div className="w-full">
                                <p className="text-left text-xs uppercase tracking-widest font-bold text-muted mb-3 border-b border-white/10 pb-2">Recently Watched</p>
                                <div className="flex flex-col gap-1.5">
                                    {recentItems.map((item: any, i: number) => (
                                        <div key={i} className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors">
                                            {item.thumbUrl
                                                ? <img src={sizedPlexImageUrl(item.thumbUrl, 160, item.type === 'track' ? 160 : 240)} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                                                : <div className="w-8 h-8 rounded bg-white/10 flex-shrink-0" />}
                                            <div className="flex flex-col text-left overflow-hidden">
                                                <span className="font-bold text-sm text-gray-200 truncate">{item.title}</span>
                                                {item.episodeTitle && <span className="text-[10px] text-gray-400 truncate">{item.episodeTitle}</span>}
                                            </div>
                                            <span className="ml-auto text-[10px] text-gray-500 whitespace-nowrap flex-shrink-0">
                                                {new Date(item.viewedAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            }
            case 'Top Binge':
                return (
                    <div className="flex flex-col items-center justify-center text-center p-6 relative">
                        {analytics.topBinge?.artUrl || analytics.topBinge?.thumbUrl ? (
                            <div className="w-full h-40 bg-cover bg-center rounded-xl shadow-lg mb-6 border border-white/10 relative overflow-hidden" style={{ backgroundImage: `url('${resolvePortalAssetUrl(analytics.topBinge.artUrl || analytics.topBinge.thumbUrl) || 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&q=80&w=600'}')` }}>
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                                <div className="absolute bottom-4 left-0 right-0 px-4 flex flex-col items-center">
                                    <h2 className="text-2xl font-black text-white mb-1 line-clamp-1 drop-shadow-md">{analytics.topBinge?.title || 'Nothing yet'}</h2>
                                    <p className="text-plex font-bold drop-shadow-md">{analytics.topBinge?.plays || 0} episodes</p>
                                </div>
                            </div>
                        ) : (
                            <Tv className="w-16 h-16 text-plex mb-6 drop-shadow-lg" />
                        )}

                        {analytics.topBinge?.summary && (
                            <div className="w-full mt-2 mb-4 bg-white/5 border border-white/5 rounded-lg p-4 text-left">
                                <p className="text-gray-300 text-sm leading-relaxed">{analytics.topBinge.summary}</p>
                                {analytics.topBinge.year && <span className="inline-block mt-3 text-xs font-black px-2 py-1 bg-black/40 rounded text-gray-400">{analytics.topBinge.year}</span>}
                            </div>
                        )}

                        {analytics.topShows && analytics.topShows.length > 1 ? (
                            <div className="w-full mt-2">
                                <p className="text-left text-xs uppercase tracking-widest font-bold text-muted mb-3 border-b border-white/10 pb-2">Runner Ups</p>
                                <div className="flex flex-col gap-2">
                                    {analytics.topShows.slice(1).map((show: any, i: number) => (
                                        <div key={i} className="flex items-center justify-between bg-white/5 border border-white/5 rounded-lg p-2 hover:bg-white/10 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <span className="text-gray-500 font-bold w-4 text-right">{i + 2}</span>
                                                {show.thumbUrl ? <img src={resolvePortalAssetUrl(show.thumbUrl)} className="w-8 h-12 object-cover rounded shadow-sm" /> : <div className="w-8 h-12 bg-white/10 rounded"></div>}
                                                <span className="font-bold text-sm text-gray-200 line-clamp-1 text-left">{show.title}</span>
                                            </div>
                                            <span className="text-xs font-black text-plex whitespace-nowrap">{show.plays} eps</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="w-full mt-2 py-6 border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center opacity-50">
                                <Tv className="w-8 h-8 text-gray-500 mb-2" />
                                <p className="text-sm font-bold text-gray-400">No other shows watched</p>
                            </div>
                        )}
                    </div>
                );
            case 'Top Movie':
                return (
                    <div className="flex flex-col items-center justify-center text-center p-6 relative">
                        {analytics.topMovie?.artUrl || analytics.topMovie?.thumbUrl ? (
                            <div className="w-full h-40 bg-cover bg-center rounded-xl shadow-lg mb-6 border border-white/10 relative overflow-hidden" style={{ backgroundImage: `url('${resolvePortalAssetUrl(analytics.topMovie.artUrl || analytics.topMovie.thumbUrl) || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&q=80&w=600'}')` }}>
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                                <div className="absolute bottom-4 left-0 right-0 px-4 flex flex-col items-center">
                                    <h2 className="text-2xl font-black text-white mb-1 line-clamp-1 drop-shadow-md">{analytics.topMovie?.title || 'Nothing yet'}</h2>
                                    <p className="text-plex font-bold drop-shadow-md">{analytics.topMovie?.plays || 0} plays</p>
                                </div>
                            </div>
                        ) : (
                            <Clapperboard className="w-16 h-16 text-plex mb-6 drop-shadow-lg" />
                        )}

                        {analytics.topMovie?.summary && (
                            <div className="w-full mt-2 mb-4 bg-white/5 border border-white/5 rounded-lg p-4 text-left">
                                {analytics.topMovie.tagline && <p className="italic text-plex text-xs mb-2 font-bold">"{analytics.topMovie.tagline}"</p>}
                                <p className="text-gray-300 text-sm leading-relaxed">{analytics.topMovie.summary}</p>
                                {analytics.topMovie.year && <span className="inline-block mt-3 text-xs font-black px-2 py-1 bg-black/40 rounded text-gray-400">{analytics.topMovie.year}</span>}
                            </div>
                        )}

                        {analytics.topMovies && analytics.topMovies.length > 1 ? (
                            <div className="w-full mt-2">
                                <p className="text-left text-xs uppercase tracking-widest font-bold text-muted mb-3 border-b border-white/10 pb-2">Runner Ups</p>
                                <div className="flex flex-col gap-2">
                                    {analytics.topMovies.slice(1).map((movie: any, i: number) => (
                                        <div key={i} className="flex items-center justify-between bg-white/5 border border-white/5 rounded-lg p-2 hover:bg-white/10 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <span className="text-gray-500 font-bold w-4 text-right">{i + 2}</span>
                                                {movie.thumbUrl ? <img src={resolvePortalAssetUrl(movie.thumbUrl)} className="w-8 h-12 object-cover rounded shadow-sm" /> : <div className="w-8 h-12 bg-white/10 rounded"></div>}
                                                <span className="font-bold text-sm text-gray-200 line-clamp-1 text-left">{movie.title}</span>
                                            </div>
                                            <span className="text-xs font-black text-plex whitespace-nowrap">{movie.plays} plays</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="w-full mt-2 py-6 border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center opacity-50">
                                <Film className="w-8 h-8 text-gray-500 mb-2" />
                                <p className="text-sm font-bold text-gray-400">No other movies watched</p>
                            </div>
                        )}
                    </div>
                );
            case 'Time of Day':
                const maxHour = Math.max(...(analytics.hourDistribution || [0]));
                return (
                    <div className="flex flex-col items-center justify-center text-center p-6">
                        <Clock className="w-16 h-16 text-plex mb-4 drop-shadow-lg" />
                        <h2 className="text-3xl font-black text-white mb-2">{analytics.timeOfDay || 'Unknown'}</h2>
                        <p className="text-muted mb-6">You typically stream around {formatStreamingHour(analytics.peakHour ?? analytics.avgHour)}.</p>

                        <div className="w-full mt-2 mb-6">
                            <p className="text-left text-xs uppercase tracking-widest font-bold text-muted mb-3 border-b border-white/10 pb-2">24-Hour Heat Map</p>
                            <div className="w-full flex items-end justify-between h-24 gap-[2px] mt-4 px-1">
                                {analytics.hourDistribution?.map((count: number, hour: number) => {
                                    const height = maxHour > 0 ? (count / maxHour) * 100 : 0;
                                    const isTop = count === maxHour && count > 0;
                                    return (
                                        <div key={hour} className="flex flex-col items-center justify-end w-full h-full group relative">
                                            <div className={`w-full rounded-t-sm transition-all duration-500 relative flex items-end justify-center overflow-hidden
                                                ${isTop ? 'bg-plex shadow-[0_0_10px_rgba(229,160,13,0.5)]' : 'bg-white/10 group-hover:bg-white/30'}`}
                                                style={{ height: `${Math.max(height, 2)}%` }}>
                                            </div>
                                            {hour % 6 === 0 && <span className="text-[8px] mt-1 font-bold text-muted absolute top-full pointer-events-none">{hour}h</span>}

                                            <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap z-10 transition-opacity">
                                                {count} plays at {formatStreamingHour(hour)}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="w-full bg-gradient-to-r from-plex/5 via-plex/10 to-plex/5 border border-plex/20 rounded-xl p-4 shadow-inner mt-4">
                            <p className="text-sm text-plex font-medium">
                                {analytics.timeOfDay === 'Early Bird' ? 'Catching the worm with those morning streams!' :
                                    analytics.timeOfDay === 'Afternoon Watcher' ? 'Perfect way to spend the afternoon.' :
                                        analytics.timeOfDay === 'Evening Streamer' ? 'Unwinding after a long day.' :
                                            'Burning the midnight oil with some late night streaming!'}
                            </p>
                        </div>
                    </div>
                );
            case 'Top Day':
                const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const maxCount = Math.max(...(analytics.dayOfWeekCounts ? Object.values(analytics.dayOfWeekCounts) as number[] : [0]));
                return (
                    <div className="flex flex-col items-center justify-center text-center p-6">
                        <Calendar className="w-16 h-16 text-plex mb-4 drop-shadow-lg" />
                        <h2 className="text-3xl font-black text-white mb-2">{analytics.popularDay || 'Unknown'}</h2>
                        <p className="text-muted mb-6 uppercase tracking-widest text-xs font-bold">Most Active Day</p>
                        <div className="w-full flex items-end justify-between h-32 gap-1.5 mt-4 px-2">
                            {daysOfWeek.map((day, i) => {
                                const count = analytics.dayOfWeekCounts ? analytics.dayOfWeekCounts[i] : 0;
                                const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
                                const isTop = count === maxCount && count > 0;
                                return (
                                    <div key={day} className="flex flex-col items-center justify-end w-full h-full group relative">
                                        <div className={`w-full rounded-t-md transition-all duration-500 relative flex items-end justify-center pb-1 overflow-hidden
                                            ${isTop ? 'bg-gradient-to-t from-plex/80 to-plex shadow-[0_0_15px_rgba(229,160,13,0.3)]' : 'bg-gradient-to-t from-white/10 to-white/20 group-hover:from-white/20 group-hover:to-white/30'}`}
                                            style={{ height: `${Math.max(height, 8)}%` }}>
                                        </div>
                                        <span className={`text-[9px] mt-2 font-black uppercase tracking-wider ${isTop ? 'text-plex' : 'text-muted'}`}>{day}</span>
                                        <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap z-10 transition-opacity">
                                            {count} plays
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                );
            case 'Top Library': {
                const libs = (Array.isArray(analytics.allLibraries) && analytics.allLibraries.length)
                    ? analytics.allLibraries
                    : (Array.isArray(analytics.topLibraries) ? analytics.topLibraries : []);
                const maxLibPlays = libs[0]?.plays || 1;
                return (
                    <div className="flex flex-col items-center justify-center text-center p-6 max-h-[80vh] overflow-hidden flex-1">
                        <Layers className="w-16 h-16 text-plex mb-4 drop-shadow-lg shrink-0" />
                        <h2 className="text-3xl font-black text-white mb-2 line-clamp-1 shrink-0">{analytics.favoriteLibrary || libs[0]?.title || 'None'}</h2>
                        <p className="text-muted mb-6 uppercase tracking-widest text-xs font-bold shrink-0">Library Breakdown</p>

                        <div className="w-full flex flex-col gap-3 overflow-y-auto pr-2 pb-2 custom-scrollbar">
                            {libs.length === 0 ? (
                                <p className="text-sm text-muted">No library metadata on these plays yet.</p>
                            ) : libs.map((lib: any, i: number) => {
                                const percent = (lib.plays / maxLibPlays) * 100;
                                return (
                                    <div key={lib.id || i} className="flex flex-col gap-1 w-full text-left">
                                        <div className="flex justify-between items-end">
                                            <span className={`font-bold text-sm truncate pr-2 ${i === 0 ? 'text-plex' : 'text-gray-300'}`}>{i + 1}. {lib.title}</span>
                                            <span className={`font-black text-xs whitespace-nowrap ${i === 0 ? 'text-plex' : 'text-gray-400'}`}>{lib.plays} plays</span>
                                        </div>
                                        <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden border border-white/5">
                                            <div className={`h-full rounded-full transition-all duration-1000 ${i === 0 ? 'bg-plex shadow-[0_0_8px_rgba(229,160,13,0.8)]' : 'bg-gray-400'}`} style={{ width: `${percent}%` }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            }
            case 'Media Profile': {
                const total = analytics.totalPlays || 1;
                const movies = analytics.moviesCount || 0;
                const shows = analytics.showsCount || 0;
                const music = analytics.musicCount || 0;
                const moviePct = Math.round((movies / total) * 100);
                const showPct = Math.round((shows / total) * 100);
                const musicPct = Math.round((music / total) * 100);

                const topMoviesList: any[] = (analytics.topMovies || []).slice(0, 3);
                const topShowsList: any[] = (analytics.topShows || []).slice(0, 3);

                const profileDesc = analytics.mediaPreference === 'Movie Buff'
                    ? 'You love the big screen experience. Movies are your go-to comfort.'
                    : analytics.mediaPreference === 'TV Show Binger'
                        ? 'You\'re a serial binger — once you start a show, you see it through.'
                        : analytics.mediaPreference === 'Music Lover'
                            ? 'Music is your thing — you\'re always on the listening grind.'
                            : 'You keep things varied. A bit of everything keeps it interesting.';

                return (
                    <div className="flex flex-col items-center justify-center text-center p-6">
                        <PieChart className="w-14 h-14 text-plex mb-3 drop-shadow-lg" />
                        <h2 className="text-3xl font-black text-white mb-1">{analytics.mediaPreference || 'Mixed Bag'}</h2>
                        <p className="text-muted mb-2 uppercase tracking-widest text-xs font-bold">Content Breakdown</p>
                        <p className="text-gray-400 text-sm mb-5 italic">{profileDesc}</p>

                        {/* Breakdown bars with percentages */}
                        <div className="w-full flex flex-col gap-4 mb-5">
                            <div>
                                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-1.5">
                                    <span className="text-blue-400 flex items-center gap-1.5">🎬 Movies</span>
                                    <span className="text-gray-300">{movies} <span className="text-gray-500 font-normal">({moviePct}%)</span></span>
                                </div>
                                <div className="w-full bg-black/60 rounded-full h-3 overflow-hidden shadow-inner border border-white/5">
                                    <div className="bg-gradient-to-r from-blue-600 to-blue-400 h-full rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)] transition-all duration-1000" style={{ width: `${moviePct}%` }} />
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-1.5">
                                    <span className="text-green-400 flex items-center gap-1.5">📺 Shows</span>
                                    <span className="text-gray-300">{shows} <span className="text-gray-500 font-normal">({showPct}%)</span></span>
                                </div>
                                <div className="w-full bg-black/60 rounded-full h-3 overflow-hidden shadow-inner border border-white/5">
                                    <div className="bg-gradient-to-r from-green-600 to-green-400 h-full rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)] transition-all duration-1000" style={{ width: `${showPct}%` }} />
                                </div>
                            </div>
                            {music > 0 && (
                                <div>
                                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-1.5">
                                        <span className="text-purple-400 flex items-center gap-1.5">🎵 Music</span>
                                        <span className="text-gray-300">{music} <span className="text-gray-500 font-normal">({musicPct}%)</span></span>
                                    </div>
                                    <div className="w-full bg-black/60 rounded-full h-3 overflow-hidden shadow-inner border border-white/5">
                                        <div className="bg-gradient-to-r from-purple-600 to-purple-400 h-full rounded-full shadow-[0_0_10px_rgba(168,85,247,0.5)] transition-all duration-1000" style={{ width: `${musicPct}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Top picks per category */}
                        {(topMoviesList.length > 0 || topShowsList.length > 0) && (
                            <div className="w-full">
                                <p className="text-left text-xs uppercase tracking-widest font-bold text-muted mb-3 border-b border-white/10 pb-2">Top Picks This Period</p>
                                <div className="flex flex-col gap-2">
                                    {topMoviesList.length > 0 && (
                                        <>
                                            <p className="text-left text-[9px] text-blue-400 font-black uppercase tracking-widest mt-1">🎬 Movies</p>
                                            {topMoviesList.map((m: any, i: number) => (
                                                <div key={i} className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-lg p-2 hover:bg-white/10 transition-colors">
                                                    <span className="text-gray-500 font-black text-xs w-4 text-right flex-shrink-0">{i + 1}</span>
                                                    {m.thumbUrl
                                                        ? <img src={resolvePortalAssetUrl(m.thumbUrl)} className="w-8 h-12 object-cover rounded shadow-sm flex-shrink-0" />
                                                        : <div className="w-8 h-12 bg-white/10 rounded flex-shrink-0" />}
                                                    <div className="flex flex-col text-left overflow-hidden">
                                                        <span className="font-bold text-sm text-gray-200 truncate">{m.title}</span>
                                                        <span className="text-[10px] text-gray-400">{m.plays} play{m.plays !== 1 ? 's' : ''}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {topShowsList.length > 0 && (
                                        <>
                                            <p className="text-left text-[9px] text-green-400 font-black uppercase tracking-widest mt-2">📺 Shows</p>
                                            {topShowsList.map((s: any, i: number) => (
                                                <div key={i} className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-lg p-2 hover:bg-white/10 transition-colors">
                                                    <span className="text-gray-500 font-black text-xs w-4 text-right flex-shrink-0">{i + 1}</span>
                                                    {s.thumbUrl
                                                        ? <img src={resolvePortalAssetUrl(s.thumbUrl)} className="w-8 h-12 object-cover rounded shadow-sm flex-shrink-0" />
                                                        : <div className="w-8 h-12 bg-white/10 rounded flex-shrink-0" />}
                                                    <div className="flex flex-col text-left overflow-hidden">
                                                        <span className="font-bold text-sm text-gray-200 truncate">{s.title}</span>
                                                        <span className="text-[10px] text-gray-400">{s.plays} episode{s.plays !== 1 ? 's' : ''}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                );
            }
            case 'Watch Style':
                const discoveryPlays = analytics.uniqueTitles || 0;
                const rewatchPlays = Math.max(0, (analytics.totalPlays || 0) - discoveryPlays);
                return (
                    <div className="flex flex-col items-center justify-center text-center p-6">
                        <Compass className="w-16 h-16 text-plex mb-4 drop-shadow-lg" />
                        <h2 className="text-3xl font-black text-white mb-2">{analytics.watchStyle || 'Unknown'}</h2>
                        <p className="text-muted mb-6 uppercase tracking-widest text-xs font-bold">Discovery vs Rewatch</p>

                        <div className="w-full relative h-4 rounded-full overflow-hidden flex shadow-inner bg-black/50 border border-white/10 mb-2 mt-2">
                            <div className="h-full bg-gradient-to-r from-plex to-orange-400 flex items-center justify-center transition-all duration-1000 shadow-[inset_0_0_20px_rgba(0,0,0,0.3)] relative overflow-hidden" style={{ width: `${((discoveryPlays) / Math.max(analytics.totalPlays || 1, 1)) * 100}%` }}>
                            </div>
                            <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 flex items-center justify-center transition-all duration-1000 shadow-[inset_0_0_20px_rgba(0,0,0,0.3)] relative overflow-hidden" style={{ width: `${((rewatchPlays) / Math.max(analytics.totalPlays || 1, 1)) * 100}%` }}>
                            </div>
                        </div>
                        <div className="flex justify-between w-full px-2 mb-6 text-[10px] font-black uppercase tracking-wider">
                            <span className="text-plex">{discoveryPlays} New</span>
                            <span className="text-blue-400">{rewatchPlays} Rewatches</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 w-full mb-6">
                            <div className="bg-gradient-to-b from-white/10 to-white/5 border border-white/10 rounded-xl p-4 flex flex-col items-center justify-center shadow-lg">
                                <span className="text-3xl font-black text-white mb-1 drop-shadow">{analytics.totalPlays || 0}</span>
                                <span className="text-[9px] text-muted uppercase tracking-widest font-black">Total Plays</span>
                            </div>
                            <div className="bg-gradient-to-b from-plex/20 to-plex/5 border border-plex/30 rounded-xl p-4 flex flex-col items-center justify-center shadow-lg relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-16 h-16 bg-plex/20 blur-xl -mr-5 -mt-5 rounded-full"></div>
                                <span className="text-3xl font-black text-plex mb-1 drop-shadow-md">{analytics.uniqueTitles || 0}</span>
                                <span className="text-[9px] text-plex/80 uppercase tracking-widest font-black">Unique Titles</span>
                            </div>
                        </div>

                        <p className="text-sm text-gray-300 italic bg-white/5 border border-white/10 rounded-lg px-4 py-3 w-full shadow-inner mb-4">
                            {analytics.watchStyle === 'Comfort Binger' ? 'You love returning to your favorite comfort shows.' :
                                analytics.watchStyle === 'Loyal Fan' ? 'You stick around to finish what you start.' :
                                    'You love exploring a wide variety of different content!'}
                        </p>

                        {analytics.topWatched && analytics.topWatched.filter((c: any) => c.plays > 1).length > 0 && (
                            <div className="w-full mt-2">
                                <p className="text-left text-xs uppercase tracking-widest font-bold text-muted mb-3 border-b border-white/10 pb-2">Top Obsessions</p>
                                <div className="flex flex-col gap-2">
                                    {analytics.topWatched.filter((c: any) => c.plays > 1).slice(0, 5).map((item: any, i: number) => (
                                        <div key={i} className="flex items-center justify-between bg-white/5 border border-white/5 rounded-lg p-2 hover:bg-white/10 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <span className="text-gray-500 font-bold w-4 text-right">{i + 1}</span>
                                                {item.thumbUrl ? <img src={resolvePortalAssetUrl(item.thumbUrl)} className="w-8 h-12 object-cover rounded shadow-sm" /> : <div className="w-8 h-12 bg-white/10 rounded"></div>}
                                                <div className="flex flex-col text-left">
                                                    <span className="font-bold text-sm text-gray-200 line-clamp-1">{item.title}</span>
                                                    <span className="text-[10px] text-gray-400 font-bold tracking-widest uppercase">{item.type}</span>
                                                </div>
                                            </div>
                                            <span className="text-xs font-black text-plex whitespace-nowrap">{item.plays} plays</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            case 'Streaming Habit':
                const avgWd = (analytics.weekdayPlays || 0) / 5;
                const avgWe = (analytics.weekendPlays || 0) / 2;
                return (
                    <div className="flex flex-col items-center justify-center text-center p-6">
                        <Coffee className="w-16 h-16 text-plex mb-4 drop-shadow-lg" />
                        <h2 className="text-3xl font-black text-white mb-2">{analytics.streamingHabit || 'Unknown'}</h2>
                        <p className="text-muted mb-8 uppercase tracking-widest text-xs font-bold">Weekday vs Weekend</p>

                        <div className="w-full relative h-16 rounded-2xl overflow-hidden flex shadow-inner bg-black/50 border border-white/10">
                            <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 flex items-center justify-center transition-all duration-1000 shadow-[inset_0_0_20px_rgba(0,0,0,0.3)] relative overflow-hidden group" style={{ width: `${((analytics.weekdayPlays || 0) / Math.max(analytics.totalPlays || 1, 1)) * 100}%` }}>
                                {analytics.weekdayPlays > 0 && <span className="text-white font-black drop-shadow-md z-10 text-sm">WD</span>}
                            </div>
                            <div className="h-full bg-gradient-to-r from-plex to-orange-400 flex items-center justify-center transition-all duration-1000 shadow-[inset_0_0_20px_rgba(0,0,0,0.3)] relative overflow-hidden group" style={{ width: `${((analytics.weekendPlays || 0) / Math.max(analytics.totalPlays || 1, 1)) * 100}%` }}>
                                {analytics.weekendPlays > 0 && <span className="text-white font-black drop-shadow-md z-10 text-sm">WE</span>}
                            </div>
                        </div>
                        <div className="flex justify-between w-full mt-3 px-2">
                            <div className="flex flex-col items-start">
                                <span className="text-[10px] uppercase tracking-widest font-bold text-blue-400">Weekdays (5 days)</span>
                                <span className="text-lg font-black text-white">{analytics.weekdayPlays || 0} <span className="text-[10px] text-gray-500 font-normal">({avgWd.toFixed(1)}/day)</span></span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-[10px] uppercase tracking-widest font-bold text-plex">Weekends (2 days)</span>
                                <span className="text-lg font-black text-white">{analytics.weekendPlays || 0} <span className="text-[10px] text-gray-500 font-normal">({avgWe.toFixed(1)}/day)</span></span>
                            </div>
                        </div>
                    </div>
                );
            case 'Achievements Hours': {
                const total = analytics.totalPlays || 0;
                const movies = analytics.moviesCount || 0;
                const episodes = analytics.showsCount || 0;
                const tracks = analytics.musicCount || 0;
                const hours = Math.round(Number(analytics.hoursWatched) || 0);
                const moviePct = total > 0 ? Math.round((movies / total) * 100) : 0;
                const episodePct = total > 0 ? Math.round((episodes / total) * 100) : 0;
                const trackPct = total > 0 ? Math.round((tracks / total) * 100) : 0;
                return (
                    <div className="flex flex-col items-center justify-center text-center p-6">
                        <Clock className="w-14 h-14 text-plex mb-3 drop-shadow-lg" />
                        <h2 className="text-5xl font-black text-white mb-1">{hours.toLocaleString()}</h2>
                        <p className="text-muted uppercase tracking-widest text-xs font-bold mb-5">Hours watched</p>

                        <div className="w-full flex flex-col gap-3 mb-5">
                            <div>
                                <div className="flex justify-between text-xs font-bold mb-1">
                                    <span className="text-sky-300">Movies</span>
                                    <span className="text-gray-300">{movies} <span className="text-gray-500">({moviePct}%)</span></span>
                                </div>
                                <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/5">
                                    <div className="h-full bg-gradient-to-r from-sky-600 to-sky-400 rounded-full" style={{ width: `${moviePct}%` }} />
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-xs font-bold mb-1">
                                    <span className="text-emerald-300">TV</span>
                                    <span className="text-gray-300">{episodes} <span className="text-gray-500">({episodePct}%)</span></span>
                                </div>
                                <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/5">
                                    <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full" style={{ width: `${episodePct}%` }} />
                                </div>
                            </div>
                            {tracks > 0 ? (
                                <div>
                                    <div className="flex justify-between text-xs font-bold mb-1">
                                        <span className="text-violet-300">Music</span>
                                        <span className="text-gray-300">{tracks} <span className="text-gray-500">({trackPct}%)</span></span>
                                    </div>
                                    <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/5">
                                        <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full" style={{ width: `${trackPct}%` }} />
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="grid grid-cols-2 gap-3 w-full">
                            <div className="bg-gradient-to-b from-white/10 to-white/5 border border-white/10 rounded-xl p-4 flex flex-col items-center shadow-lg">
                                <span className="text-2xl font-black text-white mb-1">{Number(analytics.activeDays) || 0}</span>
                                <span className="text-[9px] text-muted uppercase tracking-widest font-black">Active days</span>
                            </div>
                            <div className="bg-gradient-to-b from-plex/20 to-plex/5 border border-plex/30 rounded-xl p-4 flex flex-col items-center shadow-lg relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-12 h-12 bg-plex/20 blur-xl -mr-4 -mt-4 rounded-full" />
                                <span className="text-2xl font-black text-plex mb-1">{Number(analytics.currentStreak) || 0}</span>
                                <span className="text-[9px] text-plex/80 uppercase tracking-widest font-black">Current streak</span>
                            </div>
                        </div>
                    </div>
                );
            }
            default:
                return null;
        }
    };

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-[340] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
            <div
                className="relative bg-gradient-to-b from-card to-background border border-border/80 shadow-[0_0_50px_rgba(0,0,0,0.5)] rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[min(92dvh,calc(100dvh-4.5rem))] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-plex/0 via-plex to-plex/0 opacity-50 z-10 pointer-events-none"></div>
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 text-muted hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-full p-2 transition-all z-20 group"
                    aria-label="Close"
                >
                    <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                </button>
                <div
                    data-modal-scroll=""
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y custom-scrollbar [-webkit-overflow-scrolling:touch]"
                >
                    {(() => {
                        try {
                            return renderContent();
                        } catch (error) {
                            console.error('WrapUpModal failed to render', error);
                            return (
                                <div className="flex flex-col items-center justify-center text-center p-8 min-h-[16rem]">
                                    <p className="text-white font-bold mb-2">Could not load this wrap-up</p>
                                    <p className="text-sm text-muted">Close and try another card, or refresh the page.</p>
                                </div>
                            );
                        }
                    })()}
                </div>
            </div>
        </div>,
        document.body,
    );
};
