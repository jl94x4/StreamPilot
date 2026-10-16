export type ScannerAction =
    | 'import'
    | 'upgrade'
    | 'grab'
    | 'file-delete'
    | 'series-delete'
    | 'movie-delete'
    | 'artist-delete'
    | 'rename'
    | 'manual'
    | 'manual-interaction'
    | 'app-update'
    | 'test'
    | 'refresh'
    | string;

export type ScannerEventMeta = {
    eventType?: string;
    action?: ScannerAction;
    reason?: string;
    title?: string;
    quality?: string;
    isUpgrade?: boolean;
    source?: string;
};

/** Stable filter bucket for activity list (upgrades, deletes, imports, …). */
export const scannerActionFilterKey = (action?: string, isUpgrade?: boolean): string => {
    const raw = String(action || '').toLowerCase().trim();
    if (isUpgrade && (raw === 'import' || raw === 'upgrade' || !raw)) return 'upgrade';
    if (raw === 'upgrade') return 'upgrade';
    if (raw.includes('delete')) {
        if (raw === 'series-delete' || raw === 'movie-delete' || raw === 'artist-delete' || raw === 'file-delete') {
            return raw;
        }
        return 'file-delete';
    }
    if (raw === 'import' || raw === 'grab' || raw === 'rename' || raw === 'manual' || raw === 'manual-interaction' || raw === 'app-update' || raw === 'refresh' || raw === 'test') {
        return raw;
    }
    return raw || 'other';
};

/** Coarse filter groups for the Recent activity dropdown. */
export const scannerActionFilterGroup = (action?: string, isUpgrade?: boolean): string => {
    const key = scannerActionFilterKey(action, isUpgrade);
    if (key === 'upgrade') return 'upgrade';
    if (key.includes('delete')) return 'deleted';
    if (key === 'import') return 'import';
    if (key === 'grab') return 'grab';
    if (key === 'rename') return 'rename';
    if (key === 'manual') return 'manual';
    if (key === 'manual-interaction') return 'manual-interaction';
    if (key === 'app-update') return 'app-update';
    if (key === 'refresh' || key === 'test') return 'refresh';
    return key || 'other';
};

export const SCANNER_ACTION_FILTER_LABELS: Record<string, string> = {
    all: 'All events',
    import: 'Imports',
    grab: 'Grabs',
    upgrade: 'Upgrades',
    deleted: 'Deleted',
    rename: 'Renames',
    manual: 'Manual',
    'manual-interaction': 'Needs attention',
    'app-update': 'Updates',
    refresh: 'Refresh',
    other: 'Other',
};

/** Translation keys for stable activity-filter buckets. */
export const SCANNER_ACTION_FILTER_LABEL_KEYS: Record<string, string> = {
    all: 'scanner.filters.allEvents',
    import: 'scanner.filters.imports',
    grab: 'scanner.filters.grabs',
    upgrade: 'scanner.filters.upgrades',
    deleted: 'scanner.filters.deleted',
    rename: 'scanner.filters.renames',
    manual: 'scanner.filters.manual',
    'manual-interaction': 'scanner.filters.interaction',
    'app-update': 'scanner.filters.updates',
    refresh: 'scanner.filters.refresh',
    other: 'scanner.filters.other',
};

export const scannerActionStyles = (action?: string, isUpgrade?: boolean): {
    label: string;
    labelKey?: string;
    className: string;
    iconTone: string;
} => {
    const key = scannerActionFilterKey(action, isUpgrade);
    switch (key) {
        case 'import':
            return {
                label: 'Import',
                labelKey: 'scanner.activity.actions.import',
                className: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
                iconTone: 'text-emerald-300',
            };
        case 'grab':
            return {
                label: 'Grab',
                labelKey: 'scanner.activity.actions.grab',
                className: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
                iconTone: 'text-sky-300',
            };
        case 'app-update':
            return {
                label: 'Update',
                labelKey: 'scanner.activity.actions.appUpdate',
                className: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30',
                iconTone: 'text-indigo-300',
            };
        case 'manual-interaction':
            return {
                label: 'Needs attention',
                labelKey: 'scanner.activity.actions.interaction',
                className: 'bg-orange-500/15 text-orange-300 border-orange-400/30',
                iconTone: 'text-orange-300',
            };
        case 'upgrade':
            return {
                label: 'Upgrade',
                labelKey: 'scanner.activity.actions.upgrade',
                className: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
                iconTone: 'text-amber-300',
            };
        case 'file-delete':
            return {
                label: 'File deleted',
                labelKey: 'scanner.activity.actions.fileDeleted',
                className: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
                iconTone: 'text-rose-300',
            };
        case 'series-delete':
            return {
                label: 'Series deleted',
                labelKey: 'scanner.activity.actions.seriesDeleted',
                className: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
                iconTone: 'text-rose-300',
            };
        case 'movie-delete':
            return {
                label: 'Movie deleted',
                labelKey: 'scanner.activity.actions.movieDeleted',
                className: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
                iconTone: 'text-rose-300',
            };
        case 'artist-delete':
            return {
                label: 'Artist deleted',
                labelKey: 'scanner.activity.actions.artistDeleted',
                className: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
                iconTone: 'text-rose-300',
            };
        case 'rename':
            return {
                label: 'Rename',
                labelKey: 'scanner.activity.actions.rename',
                className: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
                iconTone: 'text-violet-300',
            };
        case 'manual':
            return {
                label: 'Manual',
                labelKey: 'scanner.activity.actions.manual',
                className: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
                iconTone: 'text-sky-300',
            };
        case 'refresh':
            return {
                label: 'Refresh',
                labelKey: 'scanner.activity.actions.refresh',
                className: 'bg-plex/15 text-plex border-plex/30',
                iconTone: 'text-plex',
            };
        default:
            return {
                label: key === 'other' ? 'Other' : key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                labelKey: key === 'other' ? 'scanner.activity.actions.other' : undefined,
                className: 'bg-white/10 text-muted border-white/15',
                iconTone: 'text-muted',
            };
    }
};

export const formatScannerWhen = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

export const shortenScannerPath = (folder?: string, keep = 3) => {
    if (!folder) return '—';
    const parts = folder.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= keep) return folder;
    return `…/${parts.slice(-keep).join('/')}`;
};

export const sourceAppLabel = (source?: string) => {
    if (!source) return '';
    const head = String(source).split(':')[0];
    if (/^sonarr$/i.test(head)) return 'Sonarr';
    if (/^radarr$/i.test(head)) return 'Radarr';
    if (/^lidarr$/i.test(head)) return 'Lidarr';
    if (/^manual/i.test(head)) return 'Manual';
    if (/^media-automation$/i.test(head) || /^media_automation$/i.test(head)) return 'Automation';
    return head;
};

/** Official-ish ARR icons (same CDN used elsewhere in Settings). */
const SOURCE_APP_ICONS: Record<string, string> = {
    sonarr: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sonarr.svg',
    radarr: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/radarr.svg',
    lidarr: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/lidarr.svg',
};

export type ScannerSourceAppKey = 'sonarr' | 'radarr' | 'lidarr' | 'manual' | 'media-automation' | '';

export const sourceAppKey = (source?: string): ScannerSourceAppKey => {
    if (!source) return '';
    const head = String(source).split(':')[0].toLowerCase();
    if (head === 'sonarr') return 'sonarr';
    if (head === 'radarr') return 'radarr';
    if (head === 'lidarr') return 'lidarr';
    if (head === 'media-automation' || head === 'media_automation') return 'media-automation';
    if (head.startsWith('manual')) return 'manual';
    return '';
};

export const sourceAppIconUrl = (source?: string): string | null => {
    const key = sourceAppKey(source);
    if (!key || key === 'manual' || key === 'media-automation') return null;
    return SOURCE_APP_ICONS[key] || null;
};

