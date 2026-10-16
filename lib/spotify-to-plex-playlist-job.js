import { registerPortalJobProvider } from './portal-jobs.js';

export const createSpotifyPlaylistSyncJobStore = ({
    now = () => Date.now(),
    schedule = (fn) => setImmediate(fn),
    historyLimit = 40,
} = {}) => {
    let job = null;
    let history = [];

    const snapshot = () => (job ? { ...job } : null);

    const remember = (entry) => {
        if (!entry?.id) return;
        history = [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, Math.max(1, historyLimit));
    };

    const listHistory = () => {
        const current = snapshot();
        if (current && !history.some((item) => item.id === current.id)) {
            return [current, ...history].slice(0, Math.max(1, historyLimit));
        }
        return history.map((item) => ({ ...item }));
    };

    const clearHistory = () => {
        history = [];
        if (job?.status !== 'running') job = null;
    };

    const start = ({ ids, all = false, fast = true, run } = {}) => {
        if (job?.status === 'running') {
            const error = new Error('A playlist sync is already running.');
            error.status = 409;
            error.job = snapshot();
            throw error;
        }
        if (typeof run !== 'function') throw new Error('Playlist sync runner is missing.');

        const id = `pls-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const list = Array.isArray(ids) ? ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
        job = {
            id,
            status: 'running',
            message: 'Starting Plex sync…',
            done: 0,
            total: 0,
            ids: list,
            all: !!all || !list.length,
            fast: fast !== false,
            startedAt: now(),
            finishedAt: null,
            ok: null,
        };
        const started = snapshot();

        schedule(async () => {
            try {
                const summary = await run({
                    ids: list,
                    all: started.all,
                    fast: started.fast,
                    onProgress: (progress = {}) => {
                        if (job?.id !== id || job.status !== 'running') return;
                        job = {
                            ...job,
                            message: String(progress.message || job.message),
                            done: Number.isFinite(Number(progress.done)) ? Number(progress.done) : job.done,
                            total: Number.isFinite(Number(progress.total)) ? Number(progress.total) : job.total,
                        };
                    },
                });
                if (job?.id !== id) return;
                const ok = summary?.ok !== false;
                job = {
                    ...job,
                    status: ok ? 'success' : 'error',
                    message: String(summary?.message || (ok ? 'Synced playlists to Plex' : 'Sync failed')),
                    ok,
                    finishedAt: now(),
                    summary: summary || null,
                };
                remember(snapshot());
            } catch (error) {
                if (job?.id !== id) return;
                job = {
                    ...job,
                    status: 'error',
                    message: String(error?.message || 'Failed to sync playlists to Plex'),
                    ok: false,
                    finishedAt: now(),
                };
                remember(snapshot());
            }
        });

        return started;
    };

    const reset = () => {
        job = null;
        history = [];
    };

    return { snapshot, start, reset, listHistory, clearHistory };
};

export const {
    snapshot: snapshotSpotifyPlaylistSyncJob,
    start: startSpotifyPlaylistSyncJob,
    reset: resetSpotifyPlaylistSyncJob,
    listHistory: listSpotifyPlaylistSyncHistory,
    clearHistory: clearSpotifyPlaylistSyncHistory,
} = createSpotifyPlaylistSyncJobStore();

registerPortalJobProvider(() => {
    const job = snapshotSpotifyPlaylistSyncJob();
    if (!job || job.status !== 'running') return [];
    return [{
        id: job.id,
        source: 'spotify-sync',
        route: 'spotify-sync',
        title: 'Spotify Sync',
        status: 'running',
        message: job.message,
        done: job.done,
        total: job.total,
    }];
});
