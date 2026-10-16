import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
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
    X
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

const SORT_OPTIONS = [
    { value: 'custom', label: 'Manual' },
    { value: 'random', label: 'Random 🎲' },
    { value: 'release', label: 'Release' },
];

const jobStatusPillClass = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap';

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
        <span className={`${jobStatusPillClass} bg-slate-800 text-slate-400 border-slate-700`}>
            Idle
        </span>
    );
};

const JobsPage: React.FC = () => {
    const [jobs, setJobs] = useState<Record<string, ManagedJob>>({});
    const [loading, setLoading] = useState(true);
    const [runningJob, setRunningJob] = useState<string | null>(null);
    const [runAllProgress, setRunAllProgress] = useState<{ done: number; total: number; current: string; percent: number; failed: number } | null>(null);
    const [updatingSort, setUpdatingSort] = useState<string | 'all' | null>(null);
    const [editingJobId, setEditingJobId] = useState<string | null>(null);
    const [editSort, setEditSort] = useState('custom');
    const [editAutoSync, setEditAutoSync] = useState(true);
    const [savingEdit, setSavingEdit] = useState(false);

    // Search & Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [serviceFilter, setServiceFilter] = useState<'all' | 'trakt' | 'mdblist'>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    useEffect(() => {
        fetchJobs();
    }, []);

    const fetchJobs = async () => {
        setLoading(true);
        try {
            const data = await api.getJobs();
            setJobs(data);
        } catch (e) {
            console.error("Failed to fetch jobs", e);
        }
        setLoading(false);
    };

    const handleRunNow = async (id: string) => {
        setRunningJob(id);
        try {
            await api.runJobNow(id);
            await fetchJobs();
        } catch (e) {
            console.error("Failed to run job", e);
        }
        setRunningJob(null);
    };

    const handleRunAll = async () => {
        const count = Object.keys(jobs).length;
        if (!count || runningJob) return;
        if (!window.confirm(`Run all ${count} auto-sync job${count === 1 ? '' : 's'} now? They will sync one after another in the background.`)) {
            return;
        }
        setRunningJob('all');
        setRunAllProgress({ done: 0, total: count, current: '', percent: 0, failed: 0 });
        try {
            await api.runJobNow({ all: true });
            const deadline = Date.now() + 45 * 60 * 1000;
            while (Date.now() < deadline) {
                const p = await api.getJobRunProgress();
                setRunAllProgress({
                    done: p.done,
                    total: p.total || count,
                    current: p.current,
                    percent: p.percent,
                    failed: p.failed,
                });
                await fetchJobs();
                if (!p.running) break;
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        } catch (e) {
            console.error('Failed to run all jobs', e);
        }
        setRunningJob(null);
        setRunAllProgress(null);
    };

    const openEdit = (id: string) => {
        const job = jobs[id];
        if (!job) return;
        setEditingJobId(id);
        setEditSort(job.sort_order || 'custom');
        setEditAutoSync(job.auto_sync !== false);
    };

    const handleSaveEdit = async () => {
        if (!editingJobId) return;
        setSavingEdit(true);
        try {
            await api.updateJob({
                id: editingJobId,
                sort_order: editSort,
                auto_sync: editAutoSync,
            });
            setJobs((prev) => prev[editingJobId]
                ? { ...prev, [editingJobId]: { ...prev[editingJobId], sort_order: editSort, auto_sync: editAutoSync } }
                : prev);
            setEditingJobId(null);
        } catch (e) {
            console.error('Failed to update job', e);
        } finally {
            setSavingEdit(false);
        }
    };

    const handleBulkRandom = async () => {
        if (!window.confirm('Set every auto-sync job to Random? Each collection becomes a Kometa-style label smart collection that reshuffles every time it is opened.')) {
            return;
        }
        setUpdatingSort('all');
        try {
            await api.updateJob({ all: true, sort_order: 'random' });
            await fetchJobs();
        } catch (e) {
            console.error('Failed to set jobs to random', e);
        } finally {
            setUpdatingSort(null);
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm(`Are you sure you want to stop auto-syncing "${jobs[id].name}"?`)) {
            try {
                await api.deleteJob(id);
                await fetchJobs();
            } catch (e) {
                console.error("Failed to delete job", e);
            }
        }
    };

    const getSortBadge = (sort: string) => {
        const order = String(sort || 'custom').toLowerCase();
        if (order === 'random') {
            return <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded text-[10px] font-bold uppercase tracking-wider">Random</span>;
        }
        if (order === 'release') {
            return <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded text-[10px] font-bold uppercase tracking-wider">Release</span>;
        }
        return <span className="px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[10px] font-bold uppercase tracking-wider">Manual</span>;
    };

    const getSourceBadge = (type: string) => {
        if (type.includes('trakt')) return <span className="px-2 py-0.5 bg-red-900/40 text-red-400 border border-red-800/50 rounded text-[10px] font-bold uppercase tracking-wider">Trakt</span>;
        if (type.includes('tmdb')) return <span className="px-2 py-0.5 bg-blue-900/40 text-blue-400 border border-blue-800/50 rounded text-[10px] font-bold uppercase tracking-wider">TMDb</span>;
        if (type.includes('mdblist')) return <span className="px-2 py-0.5 bg-purple-900/40 text-purple-400 border border-purple-800/50 rounded text-[10px] font-bold uppercase tracking-wider">MdbList</span>;
        return <span className="px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[10px] font-bold uppercase tracking-wider">Other</span>;
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
            <div className="flex flex-col h-96 items-center justify-center text-slate-500 animate-pulse">
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
                    <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Active Jobs</h2>
                    <p className="text-slate-400 mt-1 flex items-center gap-2 text-sm md:text-base">
                        <Settings2 className="w-4 h-4 text-plex-orange" />
                        Managed Auto-Sync Collections
                    </p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <button
                        onClick={fetchJobs}
                        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl transition-colors border border-slate-700/50"
                    >
                        <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">Refresh Status</span>
                    </button>
                    <button
                        onClick={handleRunAll}
                        disabled={runningJob !== null || updatingSort !== null || Object.keys(jobs).length === 0}
                        className="flex items-center gap-2 bg-green-950/30 hover:bg-green-600 text-green-400 hover:text-white px-4 py-2.5 rounded-xl transition-colors border border-green-900/50 disabled:opacity-50"
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
                        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl transition-colors border border-slate-700/50 disabled:opacity-50"
                    >
                        <span className="hidden sm:inline">{updatingSort === 'all' ? 'Shuffling…' : 'Set all to Random'}</span>
                        <span className="sm:hidden">Random</span>
                    </button>
                </div>
            </div>

            {runAllProgress ? (
                <div className="rounded-xl border border-plex-orange/30 bg-plex-orange/10 px-4 py-3 text-sm text-white">
                    <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">
                            {runAllProgress.current ? `Syncing “${runAllProgress.current}”…` : 'Running all jobs…'}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-plex-orange">
                            {runAllProgress.done}/{runAllProgress.total}
                        </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30">
                        <div
                            className="h-full rounded-full bg-plex-orange transition-[width] duration-500 ease-out"
                            style={{ width: `${Math.max(2, runAllProgress.percent)}%` }}
                        />
                    </div>
                </div>
            ) : null}

            {/* Filters Bar */}
            <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-96 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-plex-orange transition-colors" />
                    <input
                        type="text"
                        placeholder="Search jobs or libraries..."
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                        className="w-full bg-slate-950/50 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-plex-orange/30 focus:border-plex-orange/50 transition-all"
                    />
                </div>

                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="flex bg-slate-950/50 border border-slate-800 rounded-xl p-1">
                        {(['all', 'trakt', 'mdblist'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => { setServiceFilter(f); setCurrentPage(1); }}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${serviceFilter === f ? 'bg-slate-800 text-white shadow-xl' : 'text-slate-500 hover:text-slate-300'
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
                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center">
                    <div className="p-4 bg-slate-800 rounded-full mb-6 text-slate-600">
                        <Clock className="w-12 h-12" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">No Auto-Sync Jobs</h3>
                    <p className="text-slate-400 mb-8">
                        Collections created with the "Auto-Sync" option in the Creator tab will appear here. These jobs automatically refresh your collections every 6 hours.
                    </p>
                    <Link
                        to="/creator"
                        className="inline-flex items-center gap-2 bg-plex-orange hover:bg-plex-orange/80 text-white px-6 py-3 rounded-xl font-bold transition-all transform hover:scale-105"
                    >
                        Go to Creator <ChevronRight className="w-5 h-5" />
                    </Link>
                </div>
            ) : filteredJobs.length === 0 ? (
                <div className="text-center py-20 bg-slate-900/20 border border-dashed border-slate-800 rounded-3xl">
                    <Search className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-500">No jobs found matching your filters.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                        {paginatedJobs.map(([id, job]) => (
                            <div key={id} className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all group">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                                    {/* Left: Job Info */}
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 bg-slate-800 rounded-lg text-plex-orange">
                                            <Database className="w-6 h-6" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-lg font-bold text-white uppercase tracking-tight truncate max-w-[200px] md:max-w-md">{job.name}</h3>
                                                {getSourceBadge(job.source_type)}
                                                {getSortBadge(job.sort_order)}
                                                <JobStatusPill job={job} isRunning={runningJob === id || (runningJob === 'all' && runAllProgress?.current === job.name)} />
                                            </div>
                                            <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
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
                                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <CheckCircle2 className={`w-3 h-3 ${String(job.last_status || '').toLowerCase() === 'failed' ? 'text-red-400' : String(job.last_status || '').toLowerCase() === 'warning' ? 'text-amber-400' : 'text-green-500'}`} /> Last Sync
                                            </span>
                                            <span className="text-sm font-mono text-slate-300">{job.last_run}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <Clock className="w-3 h-3 text-blue-500" /> Next Sync
                                            </span>
                                            <span className="text-sm font-mono text-slate-300 uppercase">{job.next_run}</span>
                                        </div>
                                        <div className="flex flex-col hidden md:flex">
                                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <Calendar className="w-3 h-3" /> Created
                                            </span>
                                            <span className="text-xs text-slate-400">{job.created_at}</span>
                                        </div>
                                    </div>

                                    {/* Right: Actions */}
                                    <div className="flex items-center gap-2 border-t lg:border-t-0 pt-4 lg:pt-0">
                                        <button
                                            onClick={() => handleRunNow(id)}
                                            disabled={runningJob === id || runningJob === 'all'}
                                            className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-green-950/30 hover:bg-green-600 text-green-400 hover:text-white border border-green-900/50 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                                        >
                                            {runningJob === id || runningJob === 'all' ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                            {runningJob === id || runningJob === 'all' ? '...' : 'Run Now'}
                                        </button>
                                        <button
                                            onClick={() => openEdit(id)}
                                            className="flex items-center justify-center p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded-lg transition-all"
                                            title="Edit collection settings"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(id)}
                                            className="flex items-center justify-center p-2.5 bg-red-950/30 hover:bg-red-600 text-red-500 hover:text-white border border-red-950 rounded-lg transition-all"
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
                                className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white disabled:opacity-30 transition-all font-bold"
                            >
                                Prev
                            </button>
                            <div className="flex items-center gap-2">
                                {[...Array(totalPages)].map((_, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setCurrentPage(i + 1)}
                                        className={`w-10 h-10 rounded-xl font-bold transition-all ${currentPage === i + 1
                                            ? 'bg-plex-orange text-white shadow-lg'
                                            : 'bg-slate-900 border border-slate-800 text-slate-400 hover:border-slate-700'
                                            }`}
                                    >
                                        {i + 1}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white disabled:opacity-30 transition-all font-bold"
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
                    onClick={() => { if (!savingEdit) setEditingJobId(null); }}
                >
                    <div
                        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-800">
                            <div className="min-w-0">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Pencil className="w-5 h-5 text-plex-orange shrink-0" />
                                    Edit collection
                                </h3>
                                <p className="text-sm text-slate-400 mt-1 truncate">{jobs[editingJobId].name}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditingJobId(null)}
                                disabled={savingEdit}
                                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-50"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="px-5 py-4 space-y-4">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Library</p>
                                    <p className="text-white font-medium truncate">{jobs[editingJobId].library}</p>
                                </div>
                                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Source</p>
                                    <p className="text-white font-medium truncate">{jobs[editingJobId].source_type.replace(/_/g, ' ')}</p>
                                </div>
                            </div>
                            <CustomSelect
                                label="Sort order"
                                value={editSort}
                                onChange={(v) => setEditSort(String(v))}
                                options={SORT_OPTIONS}
                            />
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                                <div>
                                    <p className="text-sm font-bold text-white">Auto-sync</p>
                                    <p className="text-xs text-slate-400">Refresh this collection every 6 hours</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEditAutoSync(!editAutoSync)}
                                    className={`shrink-0 px-5 py-2 rounded-xl border font-bold transition-all ${editAutoSync ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-950/50 border-slate-700 text-slate-400'}`}
                                >
                                    {editAutoSync ? 'Enabled' : 'Disabled'}
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-800">
                            <button
                                type="button"
                                onClick={() => setEditingJobId(null)}
                                disabled={savingEdit}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 border border-slate-700 hover:text-white hover:bg-white/5 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSaveEdit()}
                                disabled={savingEdit}
                                className="px-4 py-2 rounded-lg text-sm font-bold bg-plex-orange text-white hover:bg-plex-orange/80 disabled:opacity-50"
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
