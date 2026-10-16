import { askConfirm } from '../../shared/confirm';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePoll } from '../../shared/usePoll';
import {
    Play,
    Trash2,
    RefreshCcw,
    Clock,
    Calendar,
    Database,
    CheckCircle2,
    Activity,
    ChevronRight,
    Search,
    Settings2,
    Pencil,
    X,
    Plus,
    Loader2
} from 'lucide-react';

import { CustomSelect } from '../components/ui/Inputs';

interface ManagedJob {
    name: string;
    library: string;
    source_type: string;
    source_id: string;
    sort_order: string;
    last_run: string;
    next_run: string;
    created_at: string;
    auto_sync: boolean;
    last_status?: string;
    last_error?: string;
}

type JobMemberRow = {
    title?: string;
    plex_title?: string;
    year?: number | string | null;
    rating_key?: string;
    tmdb_id?: string;
    status?: string;
    reason?: string;
};

type JobPreview = {
    source_count?: number;
    matched?: JobMemberRow[];
    unmatched?: JobMemberRow[];
    excluded?: JobMemberRow[];
    extras?: JobMemberRow[];
    unexpected?: JobMemberRow[];
};

const SORT_OPTIONS = [
    { value: 'custom', label: 'Manual' },
    { value: 'random', label: 'Random 🎲' },
    { value: 'release', label: 'Release' },
];

const jobStatusPillClass = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap';

type JobRunProgress = {
    running: boolean;
    total: number;
    done: number;
    failed: number;
    current: string;
    currentId: string;
    percent: number;
};

const JobStatusPill: React.FC<{ job: ManagedJob; isRunning: boolean }> = ({ job, isRunning }) => {
    if (isRunning) {
        return (
            <span className={`${jobStatusPillClass} bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.15)] animate-pulse`}>
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-ping" />
                Running
            </span>
        );
    }
    const status = String(job.last_status || '').toLowerCase();
    if (status === 'failed') {
        return (
            <span
                className={`${jobStatusPillClass} bg-red-500/10 text-red-400 border-red-500/20`}
                title={job.last_error || 'Last sync failed'}
            >
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                Failed
            </span>
        );
    }
    if (status === 'warning') {
        return (
            <span
                className={`${jobStatusPillClass} bg-amber-500/10 text-amber-400 border-amber-500/20`}
                title={job.last_error || 'Last sync completed with a warning'}
            >
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                Warning
            </span>
        );
    }
    if (status === 'success' || job.last_run) {
        return (
            <span className={`${jobStatusPillClass} bg-emerald-500/10 text-emerald-300 border-emerald-500/20`}>
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                Success
            </span>
        );
    }
    return (
        <span className={`${jobStatusPillClass} bg-slate-500/10 text-muted border-border`}>
            Idle
        </span>
    );
};

const JobsPage: React.FC = () => {
    const [jobs, setJobs] = useState<Record<string, ManagedJob>>({});
    const [loading, setLoading] = useState(true);
    const [runningJob, setRunningJob] = useState<string | null>(null);
    const [runAllProgress, setRunAllProgress] = useState<JobRunProgress | null>(null);
    const [runFeedback, setRunFeedback] = useState('');
    const [runFeedbackTone, setRunFeedbackTone] = useState<'info' | 'error' | 'warning'>('info');
    const [updatingSort, setUpdatingSort] = useState<string | 'all' | null>(null);
    const [editingJobId, setEditingJobId] = useState<string | null>(null);
    const [editSort, setEditSort] = useState('custom');
    const [editAutoSync, setEditAutoSync] = useState(true);
    const [savingEdit, setSavingEdit] = useState(false);
    const [jobPreview, setJobPreview] = useState<JobPreview | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [memberBusy, setMemberBusy] = useState(false);
    const [addQuery, setAddQuery] = useState('');
    const [addResults, setAddResults] = useState<Array<{ title?: string; year?: number; ratingKey?: string | number }>>([]);
    const [addSearching, setAddSearching] = useState(false);

    // Search & Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [serviceFilter, setServiceFilter] = useState<'all' | 'trakt' | 'mdblist'>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    useEffect(() => {
        fetchJobs();
    }, []);

    usePoll(async () => {
        try {
            const latest = await api.getJobRunProgress();
            if (latest.running) {
                setRunAllProgress(latest);
                setRunningJob(latest.total > 1 ? 'all' : (latest.currentId || 'all'));
            } else {
                setRunAllProgress(null);
                setRunningJob(null);
            }
        } catch {
            // Worker may be restarting.
        }
    }, 2000);

    const fetchJobs = async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        try {
            const data = await api.getJobs();
            setJobs(data);
        } catch (e) {
            console.error("Failed to fetch jobs", e);
        }
        if (!opts?.silent) setLoading(false);
    };

    const isJobRunning = (id: string) => (
        runningJob === id || (runningJob === 'all' && runAllProgress?.currentId === id)
    );

    const watchRunAllProgress = async (): Promise<JobRunProgress | null> => {
        const deadline = Date.now() + 45 * 60 * 1000;
        let latest: JobRunProgress | null = null;
        while (Date.now() < deadline) {
            latest = await api.getJobRunProgress();
            setRunAllProgress(latest);
            await fetchJobs({ silent: true });
            if (!latest.running) return latest;
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        return latest;
    };

    const handleRunNow = async (id: string) => {
        setRunningJob(id);
        setRunFeedbackTone('info');
        setRunFeedback('Syncing collection…');
        try {
            const result = await api.runJobNow(id);
            await fetchJobs();
            const status = String(result?.last_status || '').toLowerCase();
            if (status === 'failed' || result?.success === false) {
                setRunFeedbackTone('error');
                setRunFeedback(result?.last_error || result?.error || 'Sync failed. Check logs for details.');
            } else if (status === 'warning') {
                setRunFeedbackTone('warning');
                setRunFeedback(result?.last_error || 'Sync completed with a warning.');
            } else {
                setRunFeedback('');
            }
        } catch (e) {
            console.error("Failed to run job", e);
            setRunFeedbackTone('error');
            setRunFeedback('Failed to start sync. Check logs for details.');
        } finally {
            setRunningJob(null);
        }
    };

    const handleRunAll = async () => {
        const count = Object.keys(jobs).length;
        if (!count || runningJob) return;
        const ok = await askConfirm(
            `Run all ${count} auto-sync job${count === 1 ? '' : 's'} now? They will sync one after another in the background.`,
            {
                title: 'Run all jobs?',
                confirmLabel: 'Run all',
                cancelLabel: 'Cancel',
            },
        );
        if (!ok) return;
        setRunningJob('all');
        setRunFeedbackTone('info');
        setRunFeedback(`Running all ${count} jobs…`);
        setRunAllProgress({
            running: true,
            total: count,
            done: 0,
            failed: 0,
            current: '',
            currentId: '',
            percent: 0,
        });
        try {
            try {
                const result = await api.runJobNow({ all: true });
                if (result?.progress) {
                    setRunAllProgress({
                        running: Boolean(result.progress.running),
                        total: Number(result.progress.total || result.count || count),
                        done: Number(result.progress.done || 0),
                        failed: Number(result.progress.failed || 0),
                        current: String(result.progress.current || ''),
                        currentId: String(result.progress.current_id || ''),
                        percent: Number(result.progress.percent || 0),
                    });
                }
            } catch (startErr) {
                const message = startErr instanceof Error ? startErr.message : '';
                if (!/already running/i.test(message)) throw startErr;
            }
            const final = await watchRunAllProgress();
            await fetchJobs();
            const done = Number(final?.done || count);
            const failed = Number(final?.failed || 0);
            if (failed > 0) {
                setRunFeedbackTone('warning');
                setRunFeedback(`Finished ${done} jobs — ${failed} failed. Check logs for details.`);
            } else {
                setRunFeedbackTone('info');
                setRunFeedback(`Finished all ${done} jobs.`);
            }
        } catch (e) {
            console.error('Failed to run all jobs', e);
            setRunFeedbackTone('error');
            setRunFeedback('Failed to start run-all. A sync may already be running.');
        } finally {
            setRunningJob(null);
            setRunAllProgress(null);
        }
    };

    const loadJobPreview = async (id: string) => {
        setPreviewLoading(true);
        setPreviewError('');
        try {
            const data = await api.getJobPreview(id);
            if (data?.success === false) {
                setPreviewError(data.error || 'Could not load collection members.');
                setJobPreview(null);
                return;
            }
            setJobPreview(data);
        } catch (e) {
            console.error('Failed to load job preview', e);
            setPreviewError('Could not load collection members.');
            setJobPreview(null);
        } finally {
            setPreviewLoading(false);
        }
    };

    const openEdit = (id: string) => {
        const job = jobs[id];
        if (!job) return;
        setEditingJobId(id);
        setEditSort(job.sort_order || 'custom');
        setEditAutoSync(job.auto_sync !== false);
        setJobPreview(null);
        setAddQuery('');
        setAddResults([]);
        void loadJobPreview(id);
    };

    const handleSaveEdit = async () => {
        if (!editingJobId) return;
        const job = jobs[editingJobId];
        setSavingEdit(true);
        try {
            const result = await api.updateJob({
                id: editingJobId,
                sort_order: editSort,
                auto_sync: editAutoSync,
            });
            setJobs((prev) => prev[editingJobId]
                ? { ...prev, [editingJobId]: { ...prev[editingJobId], sort_order: editSort, auto_sync: editAutoSync } }
                : prev);
            setEditingJobId(null);
            if (editSort === 'random') {
                setRunFeedbackTone('info');
                setRunFeedback(
                    result?.applied
                        ? `Saved “${job?.name || 'collection'}” — it now reshuffles every time it is opened.`
                        : `Saved “${job?.name || 'collection'}” as Random. Run Now to convert it if the order has not changed yet.`,
                );
            } else {
                setRunFeedbackTone('info');
                setRunFeedback(`Saved settings for “${job?.name || 'collection'}”.`);
            }
        } catch (e) {
            console.error('Failed to update job', e);
            setRunFeedbackTone('error');
            setRunFeedback('Failed to save collection settings.');
        } finally {
            setSavingEdit(false);
        }
    };

    const applyMemberChange = async (payload: {
        exclude_tmdb_ids?: string[];
        remove_rating_keys?: string[];
        add_rating_keys?: string[];
    }) => {
        if (!editingJobId) return;
        setMemberBusy(true);
        setPreviewError('');
        try {
            const result = await api.updateJobItems({ id: editingJobId, apply: true, ...payload });
            if (result?.success === false) {
                setPreviewError(result.error || 'Could not update collection members.');
                return;
            }
            setRunFeedbackTone('info');
            setRunFeedback(
                `Updated “${jobs[editingJobId]?.name || 'collection'}” — ${result.matched || 0} titles`
                + (result.removed ? `, removed ${result.removed}` : '')
                + (result.added ? `, added ${result.added}` : '')
                + '.',
            );
            await loadJobPreview(editingJobId);
        } catch (e) {
            console.error('Failed to update members', e);
            setPreviewError('Could not update collection members.');
        } finally {
            setMemberBusy(false);
        }
    };

    const handleSearchAdd = async () => {
        if (!editingJobId || !addQuery.trim()) return;
        const job = jobs[editingJobId];
        if (!job?.library) return;
        setAddSearching(true);
        try {
            const results = await api.searchLibrary(job.library, addQuery.trim());
            setAddResults(Array.isArray(results) ? results.slice(0, 8) : []);
        } catch (e) {
            console.error('Library search failed', e);
            setAddResults([]);
        } finally {
            setAddSearching(false);
        }
    };

    const handleBulkRandom = async () => {
        const ok = await askConfirm(
            'Set every auto-sync job to Random? Each collection becomes a Kometa-style label smart collection that reshuffles every time it is opened — safe for the Plex Web Collections tab.',
            {
                title: 'Restore random order?',
                confirmLabel: 'Set all to Random',
                cancelLabel: 'Cancel',
            },
        );
        if (!ok) return;
        setUpdatingSort('all');
        try {
            const result = await api.updateJob({ all: true, sort_order: 'random' });
            await fetchJobs();
            setRunFeedbackTone('info');
            setRunFeedback(
                result?.queued
                    ? `Random queued for ${result.updated || 'all'} jobs — converting in the background. They will reshuffle on every view.`
                    : 'All jobs set to Random — collections now reshuffle on every view.',
            );
        } catch (e) {
            console.error('Failed to set jobs to random', e);
            setRunFeedbackTone('error');
            setRunFeedback('Failed to set jobs to Random.');
        } finally {
            setUpdatingSort(null);
        }
    };

    const handleDelete = async (id: string) => {
        const ok = await askConfirm(`Are you sure you want to stop auto-syncing "${jobs[id].name}"?`, {
            title: 'Stop auto-sync?',
            confirmLabel: 'Stop syncing',
            cancelLabel: 'Keep',
        });
        if (!ok) return;
        try {
            await api.deleteJob(id);
            await fetchJobs();
        } catch (e) {
            console.error("Failed to delete job", e);
        }
    };

    const getSortBadge = (sort: string) => {
        const order = String(sort || 'custom').toLowerCase();
        if (order === 'random') {
            return <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded text-[10px] font-bold uppercase tracking-wider">Random</span>;
        }
        if (order === 'release') {
            return <span className="px-2 py-0.5 bg-sky-500/10 text-sky-400 border border-sky-500/30 rounded text-[10px] font-bold uppercase tracking-wider">Release</span>;
        }
        return <span className="px-2 py-0.5 bg-card text-muted border border-border rounded text-[10px] font-bold uppercase tracking-wider">Manual</span>;
    };

    const getSourceBadge = (type: string) => {
        if (type.includes('trakt')) return <span className="px-2 py-0.5 bg-red-900/40 text-red-400 border border-red-800/50 rounded text-[10px] font-bold uppercase tracking-wider">Trakt</span>;
        if (type.includes('tmdb')) return <span className="px-2 py-0.5 bg-plex/10 text-plex border border-plex/30 rounded text-[10px] font-bold uppercase tracking-wider">TMDb</span>;
        if (type.includes('mdblist')) return <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded text-[10px] font-bold uppercase tracking-wider">MdbList</span>;
        return <span className="px-2 py-0.5 bg-card text-muted border border-border rounded text-[10px] font-bold uppercase tracking-wider">Other</span>;
    };

    // Filter Logic
    const filteredJobs = Object.entries(jobs).filter(([_, job]) => {
        const matchesSearch = job.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            job.library.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesService = serviceFilter === 'all' ||
            (serviceFilter === 'trakt' && job.source_type.includes('trakt')) ||
            (serviceFilter === 'mdblist' && job.source_type.includes('mdblist'));
        return matchesSearch && matchesService;
    }).sort((a, b) => b[1].created_at.localeCompare(a[1].created_at));

    // Pagination Logic
    const totalPages = Math.ceil(filteredJobs.length / itemsPerPage);
    const paginatedJobs = filteredJobs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    if (loading && Object.keys(jobs).length === 0) {
        return (
            <div className="flex flex-col h-96 items-center justify-center text-muted animate-pulse">
                <Activity className="w-12 h-12 mb-4 opacity-50" />
                <p>loading auto-sync schedules...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight">Active Jobs</h2>
                    <p className="text-muted mt-1 flex items-center gap-2 text-sm md:text-base">
                        <Settings2 className="w-4 h-4 text-plex" />
                        Managed Auto-Sync Collections
                    </p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <button
                        onClick={fetchJobs}
                        className="flex items-center gap-2 bg-card hover:bg-white/10 text-text px-4 py-2.5 rounded-xl transition-colors border border-border"
                    >
                        <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">Refresh Status</span>
                    </button>
                    <button
                        onClick={handleRunAll}
                        disabled={runningJob !== null || updatingSort !== null || Object.keys(jobs).length === 0}
                        className="flex items-center gap-2 bg-green-950/30 hover:bg-green-600 text-green-400 hover:text-text px-4 py-2.5 rounded-xl transition-colors border border-green-900/50 disabled:opacity-50"
                    >
                        {runningJob === 'all'
                            ? <RefreshCcw className="w-4 h-4 animate-spin" />
                            : <Play className="w-4 h-4" />}
                        <span className="hidden sm:inline">{runningJob === 'all' ? 'Running all…' : 'Run all'}</span>
                        <span className="sm:hidden">All</span>
                    </button>
                    <button
                        onClick={handleBulkRandom}
                        disabled={updatingSort !== null || runningJob !== null || Object.keys(jobs).length === 0}
                        className="flex items-center gap-2 bg-card hover:bg-white/10 text-text px-4 py-2.5 rounded-xl transition-colors border border-border disabled:opacity-50"
                    >
                        <span className="hidden sm:inline">{updatingSort === 'all' ? 'Shuffling…' : 'Set all to Random'}</span>
                        <span className="sm:hidden">Random</span>
                    </button>
                </div>
            </div>

            {runAllProgress ? (
                <div className="rounded-xl border border-plex/30 bg-plex/10 px-4 py-3 text-sm text-text">
                    <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">
                            {runAllProgress.current
                                ? `Syncing “${runAllProgress.current}”…`
                                : runFeedback || 'Running all jobs…'}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-plex">
                            {runAllProgress.done}/{runAllProgress.total}
                            {runAllProgress.failed > 0 ? ` · ${runAllProgress.failed} failed` : ''}
                        </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30">
                        <div
                            className="h-full rounded-full bg-plex transition-[width] duration-500 ease-out"
                            style={{ width: `${Math.max(2, runAllProgress.percent)}%` }}
                        />
                    </div>
                </div>
            ) : runFeedback ? (
                <div className={`rounded-xl border px-4 py-3 text-sm text-text flex items-center gap-2 ${
                    runFeedbackTone === 'error'
                        ? 'border-red-500/30 bg-red-500/10'
                        : runFeedbackTone === 'warning'
                            ? 'border-amber-500/30 bg-amber-500/10'
                            : 'border-plex/30 bg-plex/10'
                }`}>
                    <RefreshCcw className={`w-4 h-4 shrink-0 ${runningJob ? 'animate-spin text-plex' : runFeedbackTone === 'error' ? 'text-red-400' : runFeedbackTone === 'warning' ? 'text-amber-400' : 'text-plex'}`} />
                    <span>{runFeedback}</span>
                </div>
            ) : null}

            {/* Filters Bar */}
            <div className="bg-card/50 border border-border p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-96 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted group-focus-within:text-plex transition-colors" />
                    <input
                        type="text"
                        placeholder="Search jobs or libraries..."
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                        className="w-full bg-background/60 border border-border rounded-xl pl-10 pr-4 py-2.5 text-text focus:outline-none focus:ring-2 focus:ring-plex/30 focus:border-plex/50 transition-all"
                    />
                </div>

                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="flex bg-background/60 border border-border rounded-xl p-1">
                        {(['all', 'trakt', 'mdblist'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => { setServiceFilter(f); setCurrentPage(1); }}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${serviceFilter === f ? 'bg-card text-text shadow-xl' : 'text-muted hover:text-text'
                                    }`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>

                    <CustomSelect
                        label=""
                        value={itemsPerPage}
                        onChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}
                        options={[10, 25, 50, 75, 100].map(v => ({ value: v, label: `${v} per page` }))}
                        className="w-44"
                    />
                </div>
            </div>

            {Object.keys(jobs).length === 0 ? (
                <div className="bg-card/60 border border-border rounded-2xl p-12 text-center flex flex-col items-center">
                    <div className="p-4 bg-card rounded-full mb-6 text-muted">
                        <Clock className="w-12 h-12" />
                    </div>
                    <h3 className="text-xl font-bold text-text mb-2">No Auto-Sync Jobs</h3>
                    <p className="text-muted mb-8">
                        Collections created with the "Auto-Sync" option in the Creator tab will appear here. These jobs automatically refresh your collections every 6 hours.
                    </p>
                    <Link
                        to="/creator"
                        className="inline-flex items-center gap-2 bg-plex hover:bg-plex/80 text-text px-6 py-3 rounded-xl font-bold transition-all transform hover:scale-105"
                    >
                        Go to Creator <ChevronRight className="w-5 h-5" />
                    </Link>
                </div>
            ) : filteredJobs.length === 0 ? (
                <div className="text-center py-20 bg-card/30 border border-dashed border-border rounded-3xl">
                    <Search className="w-12 h-12 text-muted mx-auto mb-4" />
                    <p className="text-muted">No jobs found matching your filters.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                        {paginatedJobs.map(([id, job]) => (
                            <div key={id} className="bg-card/50 border border-border rounded-xl p-5 hover:border-border transition-all group">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                                    {/* Left: Job Info */}
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 bg-card rounded-lg text-plex">
                                            <Database className="w-6 h-6" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-lg font-bold text-text uppercase tracking-tight truncate max-w-[200px] md:max-w-md">{job.name}</h3>
                                                {getSourceBadge(job.source_type)}
                                                {getSortBadge(job.sort_order)}
                                                <JobStatusPill job={job} isRunning={isJobRunning(id)} />
                                            </div>
                                            <div className="flex items-center gap-4 mt-1 text-sm text-muted">
                                                <span className="flex items-center gap-1">
                                                    <Database className="w-3 h-3" /> {job.library}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Activity className="w-3 h-3" /> {job.source_type.replace(/_/g, ' ')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Middle: Timing */}
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6 flex-1 max-w-2xl">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-muted font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <CheckCircle2 className={`w-3 h-3 ${String(job.last_status || '').toLowerCase() === 'failed' ? 'text-red-400' : String(job.last_status || '').toLowerCase() === 'warning' ? 'text-amber-400' : 'text-green-500'}`} /> Last Sync
                                            </span>
                                            <span className="text-sm font-mono text-text">{job.last_run}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-muted font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <Clock className="w-3 h-3 text-plex" /> Next Sync
                                            </span>
                                            <span className="text-sm font-mono text-text uppercase">{job.next_run}</span>
                                        </div>
                                        <div className="flex flex-col hidden md:flex">
                                            <span className="text-[10px] text-muted font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <Calendar className="w-3 h-3" /> Created
                                            </span>
                                            <span className="text-xs text-muted">{job.created_at}</span>
                                        </div>
                                    </div>

                                    {/* Right: Actions */}
                                    <div className="flex items-center gap-2 border-t lg:border-t-0 pt-4 lg:pt-0">
                                        <button
                                            onClick={() => handleRunNow(id)}
                                            disabled={runningJob !== null}
                                            className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-green-950/30 hover:bg-green-600 text-green-400 hover:text-text border border-green-900/50 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                                        >
                                            {isJobRunning(id) ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                            {isJobRunning(id) ? '...' : 'Run Now'}
                                        </button>
                                        <button
                                            onClick={() => openEdit(id)}
                                            className="flex items-center justify-center p-2.5 bg-card hover:bg-white/10 text-muted hover:text-text border border-border rounded-lg transition-all"
                                            title="Edit collection settings"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(id)}
                                            className="flex items-center justify-center p-2.5 bg-red-950/30 hover:bg-red-600 text-red-500 hover:text-text border border-red-950 rounded-lg transition-all"
                                            title="Stop Auto-Sync"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-6">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-4 py-2 bg-card border border-border rounded-xl text-muted hover:text-text disabled:opacity-30 transition-all font-bold"
                            >
                                Prev
                            </button>
                            <div className="flex items-center gap-2">
                                {[...Array(totalPages)].map((_, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setCurrentPage(i + 1)}
                                        className={`w-10 h-10 rounded-xl font-bold transition-all ${currentPage === i + 1
                                            ? 'bg-plex text-background shadow-lg'
                                            : 'bg-card border border-border text-muted hover:border-border'
                                            }`}
                                    >
                                        {i + 1}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-4 py-2 bg-card border border-border rounded-xl text-muted hover:text-text disabled:opacity-30 transition-all font-bold"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>
            )}

            {editingJobId && jobs[editingJobId] ? (
                <div
                    className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={() => { if (!savingEdit && !memberBusy) setEditingJobId(null); }}
                >
                    <div
                        className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border shrink-0">
                            <div className="min-w-0">
                                <h3 className="text-lg font-bold text-text flex items-center gap-2">
                                    <Pencil className="w-5 h-5 text-plex shrink-0" />
                                    Edit collection
                                </h3>
                                <p className="text-sm text-muted mt-1 truncate">{jobs[editingJobId].name}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditingJobId(null)}
                                disabled={savingEdit || memberBusy}
                                className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 disabled:opacity-50"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="px-5 py-4 space-y-4 overflow-y-auto">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="rounded-xl border border-border bg-background/40 p-3">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Library</p>
                                    <p className="text-text font-medium truncate">{jobs[editingJobId].library}</p>
                                </div>
                                <div className="rounded-xl border border-border bg-background/40 p-3">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Source</p>
                                    <p className="text-text font-medium truncate">{jobs[editingJobId].source_type.replace(/_/g, ' ')}</p>
                                </div>
                            </div>
                            <CustomSelect
                                label="Sort order"
                                value={editSort}
                                onChange={(v) => setEditSort(String(v))}
                                options={SORT_OPTIONS}
                                tooltip="Random uses a Kometa-style label smart collection — Plex reshuffles the order every time you open it."
                            />
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-4 py-3">
                                <div>
                                    <p className="text-sm font-bold text-text">Auto-sync</p>
                                    <p className="text-xs text-muted">Refresh this collection every 6 hours</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEditAutoSync(!editAutoSync)}
                                    className={`shrink-0 px-5 py-2 rounded-xl border font-bold transition-all ${editAutoSync ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-background/60 border-border text-muted'}`}
                                >
                                    {editAutoSync ? 'Enabled' : 'Disabled'}
                                </button>
                            </div>

                            <div className="rounded-xl border border-border bg-background/30 p-4 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-bold text-text">Titles in this collection</p>
                                        <p className="text-xs text-muted">
                                            Source list vs what Plex matched. Unexpected titles were not on the source list.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {previewLoading ? <Loader2 className="w-4 h-4 animate-spin text-plex" /> : null}
                                        <button
                                            type="button"
                                            disabled={memberBusy || previewLoading}
                                            onClick={() => void applyMemberChange({})}
                                            className="text-xs font-bold text-plex hover:text-white disabled:opacity-40"
                                        >
                                            Rebuild from source
                                        </button>
                                    </div>
                                </div>
                                {previewError ? (
                                    <p className="text-sm text-amber-200">{previewError}</p>
                                ) : null}
                                {jobPreview ? (
                                    <p className="text-[11px] text-muted">
                                        Source has {jobPreview.source_count || 0} title{(jobPreview.source_count || 0) === 1 ? '' : 's'}
                                        {' · '}
                                        {(jobPreview.matched || []).length} matched
                                        {(jobPreview.unexpected || []).length ? ` · ${(jobPreview.unexpected || []).length} unexpected` : ''}
                                        {(jobPreview.unmatched || []).length ? ` · ${(jobPreview.unmatched || []).length} missing from library` : ''}
                                    </p>
                                ) : null}

                                {(jobPreview?.unexpected || []).length ? (
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300 mb-2">Not on the source list</p>
                                        <div className="space-y-1 max-h-40 overflow-y-auto">
                                            {(jobPreview?.unexpected || []).map((row) => (
                                                <div key={row.rating_key || row.title} className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm">
                                                    <span className="min-w-0 truncate text-amber-100">
                                                        {row.plex_title || row.title}
                                                        {row.year ? ` (${row.year})` : ''}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        disabled={memberBusy || !row.rating_key}
                                                        onClick={() => void applyMemberChange({ remove_rating_keys: [String(row.rating_key)] })}
                                                        className="shrink-0 text-xs font-bold text-amber-200 hover:text-white disabled:opacity-40"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Matched from source</p>
                                    <div className="space-y-1 max-h-56 overflow-y-auto">
                                        {(jobPreview?.matched || []).length === 0 && !previewLoading ? (
                                            <p className="text-xs text-muted px-1">No strict matches yet. Save settings, then Run Now after the matcher update.</p>
                                        ) : (jobPreview?.matched || []).map((row) => (
                                            <div key={row.rating_key || row.tmdb_id || row.title} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
                                                <span className="min-w-0 truncate text-text">
                                                    {row.plex_title || row.title}
                                                    {row.year ? ` (${row.year})` : ''}
                                                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">
                                                        {row.reason === 'tmdb' ? 'TMDB id' : row.reason === 'title' ? 'title' : row.reason || ''}
                                                    </span>
                                                </span>
                                                <button
                                                    type="button"
                                                    disabled={memberBusy || !row.rating_key}
                                                    onClick={() => void applyMemberChange({
                                                        remove_rating_keys: [String(row.rating_key)],
                                                        exclude_tmdb_ids: row.tmdb_id ? [String(row.tmdb_id)] : [],
                                                    })}
                                                    className="shrink-0 text-xs font-bold text-muted hover:text-red-300 disabled:opacity-40"
                                                >
                                                    Exclude
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {(jobPreview?.unmatched || []).length ? (
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">On the source list, not in this library</p>
                                        <div className="space-y-1 max-h-32 overflow-y-auto">
                                            {(jobPreview?.unmatched || []).map((row) => (
                                                <p key={row.tmdb_id || row.title} className="text-xs text-muted px-1">
                                                    {row.title}{row.year ? ` (${row.year})` : ''}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {(jobPreview?.extras || []).length ? (
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Pinned extras</p>
                                        {(jobPreview?.extras || []).map((row) => (
                                            <div key={row.rating_key} className="flex items-center justify-between gap-2 text-sm px-1 py-1">
                                                <span className="truncate">{row.plex_title || row.title}</span>
                                                <button
                                                    type="button"
                                                    disabled={memberBusy || !row.rating_key}
                                                    onClick={() => void applyMemberChange({ remove_rating_keys: [String(row.rating_key)] })}
                                                    className="text-xs font-bold text-muted hover:text-red-300 disabled:opacity-40"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}

                                <div className="pt-1 space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Add from library</p>
                                    <div className="flex gap-2">
                                        <input
                                            className="flex-1 bg-background/60 border border-border rounded-xl px-3 py-2 text-sm text-text"
                                            placeholder="Search this library…"
                                            value={addQuery}
                                            onChange={(e) => setAddQuery(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    void handleSearchAdd();
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => void handleSearchAdd()}
                                            disabled={addSearching || !addQuery.trim()}
                                            className="px-3 py-2 rounded-xl border border-border text-sm font-bold text-text hover:bg-white/5 disabled:opacity-40"
                                        >
                                            {addSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                                        </button>
                                    </div>
                                    {addResults.length ? (
                                        <div className="space-y-1">
                                            {addResults.map((item) => (
                                                <div key={String(item.ratingKey)} className="flex items-center justify-between gap-2 text-sm px-1">
                                                    <span className="truncate">{item.title}{item.year ? ` (${item.year})` : ''}</span>
                                                    <button
                                                        type="button"
                                                        disabled={memberBusy || item.ratingKey == null}
                                                        onClick={() => void applyMemberChange({ add_rating_keys: [String(item.ratingKey)] })}
                                                        className="inline-flex items-center gap-1 text-xs font-bold text-plex hover:text-white disabled:opacity-40"
                                                    >
                                                        <Plus className="w-3 h-3" />
                                                        Add
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
                            <button
                                type="button"
                                onClick={() => setEditingJobId(null)}
                                disabled={savingEdit || memberBusy}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-muted border border-border hover:text-text hover:bg-white/5 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSaveEdit()}
                                disabled={savingEdit || memberBusy}
                                className="px-4 py-2 rounded-lg text-sm font-bold bg-plex text-background hover:bg-plex-hover disabled:opacity-50"
                            >
                                {savingEdit ? 'Saving…' : 'Save settings'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default JobsPage;
