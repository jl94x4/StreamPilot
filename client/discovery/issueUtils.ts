export const ISSUE_TYPE_OPTIONS = [
    { value: 1, label: 'Video' },
    { value: 2, label: 'Audio' },
    { value: 3, label: 'Subtitles' },
    { value: 4, label: 'Other' },
] as const;

export const issueStatusBadgeClass = (statusLabel: string) => {
    const value = String(statusLabel || '').toLowerCase();
    if (value === 'open') return 'bg-amber-500/15 border-amber-500/30 text-amber-200';
    if (value === 'resolved') return 'bg-green-500/15 border-green-500/30 text-green-300';
    if (value === 'closed') return 'bg-white/5 border-white/10 text-white/60';
    return 'bg-white/5 border-white/10 text-white/60';
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export const formatIssueRelativeTime = (value?: string | null, t?: Translate) => {
    if (!value) return t ? t('common.unknownTime') : 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return t ? t('common.justNow') : 'Just now';
    if (minutes < 60) return t ? t('common.minutesAgo', { count: minutes }) : `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t ? t('common.hoursAgo', { count: hours }) : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return t ? t('common.daysAgo', { count: days }) : `${days}d ago`;
    return date.toLocaleDateString();
};

export const formatIssueLocation = (item: {
    type: string;
    problemSeason?: number | null;
    problemEpisode?: number | null;
}, t?: Translate) => {
    if (item.type !== 'tv') return null;
    const season = Number(item.problemSeason);
    const episode = Number(item.problemEpisode);
    if (season > 0 && episode > 0) return `S${season} · E${episode}`;
    if (season > 0) return t ? t('common.seasonN', { number: season }) : `Season ${season}`;
    return null;
};
