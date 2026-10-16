import { type PosterSetsJob, type PosterSetsSetMeta } from '../types';

export const providerLabel = (provider?: string | null) => {
    const value = String(provider || '').toLowerCase();
    if (value === 'mediux') return 'MediUX';
    if (value === 'posterdb' || value === 'tpdb' || value === 'theposterdb') return 'ThePosterDB';
    if (value === 'both') return 'Both';
    return provider || 'Provider';
};

export const normalizeProviderKey = (provider?: string | null) => {
    const value = String(provider || '').toLowerCase();
    if (value === 'mediux') return 'mediux';
    if (value === 'posterdb' || value === 'tpdb' || value === 'theposterdb') return 'posterdb';
    return value || '';
};

export const formatSetLabel = (meta?: { title?: string | null; user?: string | null } | null) => {
    const title = String(meta?.title || '').trim();
    const user = String(meta?.user || '').trim().replace(/^@/, '');
    if (!title) return user ? `@${user}` : '';
    return user ? `${title} · @${user}` : title;
};

export const listToText = (value: string[] | undefined) => (Array.isArray(value) ? value.join('\n') : '');
export const textToList = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

export const jobSetMeta = (job: PosterSetsJob | null | undefined): PosterSetsSetMeta | null => {
    if (!job) return null;
    if (job.setMeta) return job.setMeta;
    if (job.input?.setMeta) return job.input.setMeta;
    const resultMeta = job.result?.setMeta;
    if (resultMeta && typeof resultMeta === 'object') return resultMeta as PosterSetsSetMeta;
    return null;
};

export const formatTime = (value?: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

export const statusTone = (value?: string | null) => {
    const state = String(value || '').toLowerCase();
    if (['succeeded', 'completed', 'success', 'ready', 'connected', 'valid'].includes(state)) {
        return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
    }
    if (['warning', 'warn'].includes(state)) {
        return 'border-amber-500/40 bg-amber-500/15 text-amber-100';
    }
    if (['failed', 'error', 'missing'].includes(state)) {
        return 'border-red-500/40 bg-red-500/15 text-red-200';
    }
    if (['running', 'queued', 'setup'].includes(state)) {
        return 'border-plex/40 bg-plex/15 text-plex';
    }
    return 'border-white/10 bg-white/5 text-muted';
};

export const isWarningJobState = (value?: string | null) => (
    ['warning', 'warn'].includes(String(value || '').toLowerCase())
);

export const isFailedJobState = (value?: string | null) => (
    ['failed', 'error'].includes(String(value || '').toLowerCase())
);

export const isLibraryPendingWatchError = (message?: string | null) => {
    const text = String(message || '').toLowerCase();
    return text.includes('waiting for title in library')
        || text.includes('will auto-apply when');
};

export const jobErrorTextClass = (state?: string | null) => (
    isWarningJobState(state) ? 'text-amber-200' : 'text-red-300'
);

export const jobErrorBoxClass = (state?: string | null) => (
    isWarningJobState(state)
        ? 'rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100'
        : 'rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200'
);

export const jobCardTone = (job: PosterSetsJob) => {
    const state = String(job.state || '').toLowerCase();
    if (['warning', 'warn'].includes(state)) return 'border-l-2 border-l-amber-400/80 bg-amber-500/[0.06]';
    if (['failed', 'error'].includes(state)) return 'border-l-2 border-l-red-400/70 bg-red-500/[0.05]';
    if (['succeeded', 'completed', 'success'].includes(state)) return 'border-l-2 border-l-emerald-400/80 bg-emerald-500/[0.06]';
    if (['running', 'queued'].includes(state)) return 'border-l-2 border-l-plex/70 bg-plex/[0.06]';
    if (state === 'cancelled') return 'border-l-2 border-l-white/20 bg-white/[0.03]';
    return '';
};

export const jobTitle = (job: PosterSetsJob) => {
    const meta = jobSetMeta(job);
    const labeled = formatSetLabel(meta);
    if (labeled) return labeled;
    const input = job.input;
    if (input?.url) return input.url;
    if (input?.fromFile) {
        return `Bulk file · ${input.file || 'bulk_import.txt'}${typeof input.lineCount === 'number' ? ` (${input.lineCount})` : ''}`;
    }
    if (typeof input?.count === 'number') return `Bulk list · ${input.count} URL${input.count === 1 ? '' : 's'}`;
    if (input?.urls?.length) return input.urls[0];
    return `${job.type || 'job'} · #${job.id.slice(0, 8)}`;
};

export const jobLogLines = (job: PosterSetsJob | null) => (
    (job?.logs || []).map((entry) => (typeof entry === 'string' ? entry : String(entry.message || ''))).filter(Boolean)
);
