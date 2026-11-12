import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from './api';
import type { PlexCollection } from './types';

type Item = {
    key: string;
    title: string;
    detail: string;
    tone: 'red' | 'amber';
    to: string;
};

const DAY = 24 * 60 * 60 * 1000;

const parseRun = (value?: string) => {
    const t = Date.parse(String(value || '').replace(' ', 'T'));
    return Number.isFinite(t) ? t : 0;
};

type Job = {
    name?: string;
    library?: string;
    auto_sync?: boolean;
    last_run?: string;
    last_status?: string;
    last_error?: string;
};

const buildItems = (jobs: Record<string, Job>, collections: PlexCollection[]): Item[] => {
    const items: Item[] = [];
    for (const [id, job] of Object.entries(jobs || {})) {
        const name = job.name || 'Unnamed collection';
        if (job.last_status === 'failed') {
            items.push({ key: `job-${id}`, title: name, detail: job.last_error || 'The last sync failed', tone: 'red', to: '/jobs' });
            continue;
        }
        if (job.last_status === 'warning') {
            items.push({ key: `job-${id}`, title: name, detail: job.last_error || 'The last sync finished with a warning', tone: 'amber', to: '/jobs' });
            continue;
        }
        // Syncs run about every 6 hours, so two days without one means something is stuck.
        const last = parseRun(job.last_run);
        if (job.auto_sync !== false && last && Date.now() - last > 2 * DAY) {
            const days = Math.floor((Date.now() - last) / DAY);
            items.push({ key: `stale-${id}`, title: name, detail: `Has not synced for ${days} days`, tone: 'amber', to: '/jobs' });
        }
    }
    for (const coll of collections) {
        if (typeof coll.itemCount === 'number' && coll.itemCount === 0) {
            items.push({
                key: `empty-${coll.library}-${coll.ratingKey}`,
                title: coll.title,
                detail: `Empty collection in ${coll.library}`,
                tone: 'amber',
                to: '/gallery',
            });
        }
    }
    return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1));
};

export const AttentionCard: React.FC = () => {
    const [items, setItems] = useState<Item[] | null>(null);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        const [jobs, collections] = await Promise.allSettled([
            api.getJobs(),
            api.getCollections(false, { light: true }),
        ]);
        if (jobs.status !== 'fulfilled' && collections.status !== 'fulfilled') return;
        setItems(buildItems(
            jobs.status === 'fulfilled' ? (jobs.value || {}) : {},
            collections.status === 'fulfilled' ? (collections.value || []) : [],
        ));
    }, []);

    useEffect(() => { void load(); }, [load]);

    if (items === null) return null;

    if (!items.length) {
        return (
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-muted">
                <CheckCircle2 className="h-4 w-4 text-plex" />
                All sync jobs are healthy and no collections are empty.
            </div>
        );
    }

    const red = items.filter((item) => item.tone === 'red').length;
    return (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                    <h3 className="text-sm font-bold text-amber-100">
                        Needs attention · {items.length}
                    </h3>
                    <span className="text-xs text-amber-100/70">
                        {red ? `${red} failed · ` : ''}{items.length - red} to look at
                    </span>
                </div>
                <button
                    type="button"
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text hover:bg-white/5"
                    onClick={() => setOpen((value) => !value)}
                >
                    {open ? 'Hide' : 'Show'}
                </button>
            </div>
            {open ? (
                <ul className="max-h-72 divide-y divide-white/10 overflow-y-auto">
                    {items.map((item) => (
                        <li key={item.key} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                                <p className="truncate text-sm text-text">{item.title}</p>
                                <p className={`line-clamp-2 break-words text-xs ${item.tone === 'red' ? 'text-red-300' : 'text-amber-200'}`}>{item.detail}</p>
                            </div>
                            <Link
                                to={item.to}
                                className="shrink-0 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text no-underline hover:bg-white/5"
                            >
                                Open
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
};
