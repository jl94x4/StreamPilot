import React from 'react';
import { Clock, Music, Play } from 'lucide-react';
import { resolvePortalAssetUrl } from './basePath';
import { sizedPlexImageUrl } from './plexImageUrl';
import { daysSinceDate, formatUkDate } from './format';
import { relativeFromDays } from '../profile/helpers';

export const formatWatchHistoryWhen = (
    viewedAt: unknown,
    t: (key: string, vars?: Record<string, string | number>) => string,
): string => {
    const ts = Number(viewedAt);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const millis = ts > 9_999_999_999 ? ts : ts * 1000;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) return '';
    const relative = relativeFromDays(daysSinceDate(date.toISOString()), t);
    if (relative) return relative;
    return formatUkDate(date.toISOString()) || '';
};

type WatchHistoryMediaCardItem = {
    title?: string;
    episodeTitle?: string;
    type?: string;
    thumbUrl?: string | null;
    artUrl?: string | null;
};

type Props = {
    item: WatchHistoryMediaCardItem;
    actionLabel: string;
    subtitle?: string | null;
    when?: string | null;
    href?: string | null;
    onOpen?: () => void;
};

const mediaUrl = (url: string | null | undefined, width: number, height: number) => {
    if (!url) return '';
    const sized = sizedPlexImageUrl(url, width, height);
    return sized || resolvePortalAssetUrl(url);
};

export const WatchHistoryMediaCard: React.FC<Props> = ({
    item,
    actionLabel,
    subtitle,
    when,
    href,
    onOpen,
}) => {
    const isMusic = String(item.type || '').toLowerCase() === 'track';
    const poster = mediaUrl(item.thumbUrl, isMusic ? 240 : 240, isMusic ? 240 : 360);
    const backdrop = mediaUrl(item.artUrl || item.thumbUrl, 1280, 720);
    const body = (
        <>
            {backdrop ? (
                <img
                    src={backdrop}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover opacity-45 transition-transform duration-500 group-hover:scale-105"
                />
            ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-plex/20 via-black/50 to-black/80" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/25" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgb(var(--color-plex)_/_0.16),transparent_55%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="relative flex min-h-[8.5rem] items-end gap-3 p-3">
                <div className={`relative shrink-0 overflow-hidden rounded-xl border border-white/15 bg-black/40 shadow-[0_12px_30px_rgba(0,0,0,0.45)] ${isMusic ? 'h-14 w-14' : 'aspect-[2/3] w-[4.5rem]'}`}>
                    {poster ? (
                        <img src={poster} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center text-plex">
                            {isMusic ? <Music className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                        </span>
                    )}
                </div>
                <div className="min-w-0 flex-1 pb-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-plex/90">{actionLabel}</p>
                    <p className="mt-1 truncate text-base font-black text-white">{item.title}</p>
                    {subtitle ? (
                        <p className="mt-0.5 truncate text-xs font-medium text-white/70">{subtitle}</p>
                    ) : null}
                    {when ? (
                        <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
                            <Clock className="h-3 w-3 text-plex/80" />
                            {when}
                        </p>
                    ) : null}
                </div>
            </div>
        </>
    );
    const className = 'group relative isolate w-full overflow-hidden rounded-2xl border border-white/10 bg-black/35 text-left shadow-lg transition-all hover:-translate-y-0.5 hover:border-plex/35 hover:shadow-[0_18px_40px_rgba(0,0,0,0.42)]';
    if (onOpen) {
        return (
            <button type="button" title={item.title} onClick={onOpen} className={className}>
                {body}
            </button>
        );
    }
    if (href) {
        return (
            <a href={href} target="_blank" rel="noreferrer" title={item.title} className={className}>
                {body}
            </a>
        );
    }
    return (
        <div className={className} title={item.title}>
            {body}
        </div>
    );
};
