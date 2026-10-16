import React, { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch } from './api';
import { usePoll } from './usePoll';

export type PortalJob = {
    id?: string;
    source?: string;
    route?: string;
    title?: string;
    status?: string;
    message?: string;
    done?: number | null;
    total?: number | null;
};

export const usePortalJobs = ({ enabled = true, collexionsEnabled = false } = {}) => {
    const [jobs, setJobs] = useState<PortalJob[]>([]);

    const load = useCallback(async () => {
        if (!enabled) {
            setJobs([]);
            return;
        }
        const [portal, collexions] = await Promise.all([
            apiFetch('/api/portal-jobs').catch(() => ({ jobs: [] })),
            collexionsEnabled
                ? apiFetch('/api/collexions/jobs/progress').catch(() => null)
                : Promise.resolve(null),
        ]);
        const next: PortalJob[] = Array.isArray(portal?.jobs) ? portal.jobs : [];
        if (collexions?.running) {
            next.push({
                id: 'collexions',
                source: 'collexions',
                route: 'collexions',
                title: 'ColleXions',
                status: 'running',
                message: String(collexions.current || 'Syncing collections…'),
                done: Number(collexions.done || 0),
                total: Number(collexions.total || 0),
            });
        }
        setJobs(next);
    }, [collexionsEnabled, enabled]);

    const running = jobs.some((job) => job.status === 'running');
    usePoll(() => { void load(); }, enabled ? (running ? 2_000 : 15_000) : null, { immediate: true });

    return { jobs, running, refresh: load };
};

export const PortalJobsBanner: React.FC<{
    enabled?: boolean;
    collexionsEnabled?: boolean;
    currentRoute?: string;
    onNavigate?: (route: string) => void;
}> = ({ enabled = true, collexionsEnabled = false, currentRoute, onNavigate }) => {
    const { jobs, running } = usePortalJobs({ enabled, collexionsEnabled });
    const visible = jobs.filter((job) => job.status === 'running' && job.route !== currentRoute);
    if (!enabled || !running || !visible.length) return null;

    return (
        <div className="w-full space-y-2 mb-3">
            {visible.map((job) => (
                <button
                    key={job.id || job.source || job.title}
                    type="button"
                    onClick={() => { if (job.route && onNavigate) onNavigate(job.route); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-plex/40 bg-plex/10 text-left text-text shadow-lg backdrop-blur-md hover:border-plex/60 transition-colors"
                >
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-plex" />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{job.title || 'Portal job'}</p>
                        <p className="text-xs text-muted truncate">{job.message || 'Running…'}</p>
                    </div>
                    {job.total ? (
                        <span className="shrink-0 text-xs font-semibold text-plex">
                            {job.done || 0}/{job.total}
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    );
};
