import React, { useEffect, useMemo, useState } from 'react';
import {
    CheckCircle2,
    FileBarChart2,
    Loader2,
    Play,
    X,
} from 'lucide-react';
import { ModalPortal } from '../shared/ModalPortal';
import { CustomSelect } from '../shared/ui';
import { mediaAutomationApi } from './api';
import { PathBrowserField } from './PathBrowserField';
import type {
    MediaAutomationAnalyzeResult,
    MediaAutomationAnalyzeRow,
    MediaAutomationLibrary,
    MediaAutomationPipeline,
} from './types';

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40';
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-3 py-2 text-sm font-bold text-background transition hover:bg-plex-hover disabled:pointer-events-none disabled:opacity-40';
const fieldClass = 'w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-[16px] leading-5 text-text outline-none transition focus:border-plex focus:ring-1 focus:ring-plex';

const formatBytes = (value?: number | null) => {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
    return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
};

const formatDuration = (seconds?: number | null) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (!total) return '-';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

const pathBasename = (value: string) => {
    const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || value;
};

const codecLabel = (value?: string | null) => {
    const codec = String(value || '').toLowerCase();
    if (!codec) return '?';
    if (codec === 'h265' || codec === 'hevc') return 'HEVC';
    if (codec === 'h264' || codec === 'avc') return 'H264';
    return codec.toUpperCase();
};

export type ReportModalSeed = {
    libraryId?: string | number | null;
    libraryRoot?: string | null;
    pipelineId?: string | number | null;
    forcePipeline?: boolean;
};

type Props = {
    open: boolean;
    seed: ReportModalSeed | null;
    libraries: MediaAutomationLibrary[];
    pipelines: MediaAutomationPipeline[];
    onClose: () => void;
    toast: (message: string, tone?: 'success' | 'error') => void;
    onEnqueued?: () => void | Promise<void>;
};

export const ReportModal: React.FC<Props> = ({
    open,
    seed,
    pipelines,
    onClose,
    toast,
    onEnqueued,
}) => {
    const enabledPipelines = useMemo(
        () => pipelines.filter((pipeline) => pipeline.enabled !== false),
        [pipelines],
    );
    const [rootPath, setRootPath] = useState('');
    const [pipelineId, setPipelineId] = useState('');
    const [force, setForce] = useState(true);
    const [limit, setLimit] = useState('150');
    const [minGb, setMinGb] = useState('0.05');
    const [busy, setBusy] = useState(false);
    const [enqueueBusy, setEnqueueBusy] = useState(false);
    const [result, setResult] = useState<MediaAutomationAnalyzeResult | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!open || !seed) return;
        setRootPath(String(seed.libraryRoot || '').trim());
        const nextPipelineId = seed.pipelineId != null && seed.pipelineId !== '' ? String(seed.pipelineId) : '';
        setPipelineId(nextPipelineId);
        setForce(seed.forcePipeline === true || !!nextPipelineId);
        setResult(null);
        setSelected(new Set());
        setBusy(false);
        setEnqueueBusy(false);
    }, [open, seed]);

    const pipelineLocked = seed?.forcePipeline === true && seed.pipelineId != null && seed.pipelineId !== '';
    const matchedRows = useMemo(
        () => (Array.isArray(result?.rows) ? result.rows.filter((row) => row.matched) : []),
        [result?.rows],
    );
    const selectedRows = useMemo(
        () => matchedRows.filter((row) => selected.has(row.path)),
        [matchedRows, selected],
    );
    const totals = result?.totals;
    const selectedPipeline = enabledPipelines.find((pipeline) => String(pipeline.id) === String(pipelineId || seed?.pipelineId || ''));

    const toggleRow = (row: MediaAutomationAnalyzeRow) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(row.path)) next.delete(row.path);
            else next.add(row.path);
            return next;
        });
    };

    const selectAllMatched = () => {
        setSelected(new Set(matchedRows.map((row) => row.path)));
    };

    const runReport = async () => {
        const pathValue = String(rootPath || '').trim();
        if (!pathValue) {
            toast('Pick a media directory to analyze.', 'error');
            return;
        }
        const resolvedPipelineId = pipelineId || (seed?.pipelineId != null ? String(seed.pipelineId) : '');
        if (!resolvedPipelineId && force) {
            toast('Pick a pipeline for a forced report.', 'error');
            return;
        }
        setBusy(true);
        setSelected(new Set());
        try {
            const minSizeBytes = Math.max(0, Math.round((Number(minGb) || 0) * 1024 ** 3));
            const response = await mediaAutomationApi.analyze({
                libraryId: seed?.libraryId ?? null,
                pipelineId: resolvedPipelineId || null,
                force: force || pipelineLocked,
                limit: Math.min(500, Math.max(1, Math.round(Number(limit) || 150))),
                minSizeBytes,
                rootPath: pathValue,
            });
            if (response.error) throw new Error(response.error);
            setResult(response);
            const matched = (response.rows || []).filter((row) => row.matched);
            setSelected(new Set(matched.map((row) => row.path)));
            toast(`Report ready: ${matched.length} matched of ${response.totals?.analyzed || 0} analyzed.`);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Report failed', 'error');
        } finally {
            setBusy(false);
        }
    };

    const enqueueRows = async (rows: MediaAutomationAnalyzeRow[]) => {
        if (!rows.length) {
            toast('Nothing selected to enqueue.', 'error');
            return;
        }
        const resolvedPipelineId = pipelineId || (seed?.pipelineId != null ? String(seed.pipelineId) : '') || rows[0]?.pipelineId;
        setEnqueueBusy(true);
        try {
            await mediaAutomationApi.enqueueMany(
                rows.map((row) => row.path),
                resolvedPipelineId ?? undefined,
            );
            toast(`Queued ${rows.length} file${rows.length === 1 ? '' : 's'}.`);
            await onEnqueued?.();
            onClose();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Enqueue failed', 'error');
        } finally {
            setEnqueueBusy(false);
        }
    };

    if (!open) return null;

    return (
        <ModalPortal open={open}>
            <div
                className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
                onMouseDown={onClose}
            >
                <div
                    className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-w-4xl sm:rounded-2xl"
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <div className="flex items-start justify-between gap-3 border-b border-border bg-card/95 px-5 py-4 backdrop-blur-md">
                        <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-plex">Savings report</p>
                            <h2 className="mt-1 text-xl font-bold text-text">
                                {selectedPipeline?.name || 'Pipeline report'}
                            </h2>
                            <p className="mt-1 text-sm text-muted">
                                Heuristic scan of the selected folder — space savings and ETA before you enqueue.
                            </p>
                        </div>
                        <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text" onClick={onClose} aria-label="Close">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="custom-scrollbar space-y-5 overflow-y-auto p-5">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <PathBrowserField
                                    label="Directory"
                                    value={rootPath}
                                    onChange={setRootPath}
                                    mode="directory"
                                    placeholder="/media/Season 02"
                                    hint="Must be under a configured library root."
                                />
                            </div>
                            <label className="block text-xs font-bold uppercase tracking-wide text-muted">
                                Pipeline
                                <div className="mt-2">
                                    {pipelineLocked ? (
                                        <div className={`${fieldClass} opacity-80`}>
                                            {selectedPipeline?.name || `Pipeline ${pipelineId}`}
                                        </div>
                                    ) : (
                                        <CustomSelect
                                            value={pipelineId}
                                            onChange={(value) => {
                                                setPipelineId(value);
                                                if (!value) setForce(false);
                                            }}
                                            options={[
                                                { value: '', label: 'First matching / pick one' },
                                                ...enabledPipelines.map((pipeline) => ({
                                                    value: String(pipeline.id),
                                                    label: pipeline.name,
                                                })),
                                            ]}
                                        />
                                    )}
                                </div>
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block text-xs font-bold uppercase tracking-wide text-muted">
                                    Max files
                                    <input className={`${fieldClass} mt-2`} value={limit} onChange={(event) => setLimit(event.target.value)} disabled={busy} />
                                </label>
                                <label className="block text-xs font-bold uppercase tracking-wide text-muted">
                                    Min size (GB)
                                    <input className={`${fieldClass} mt-2`} value={minGb} onChange={(event) => setMinGb(event.target.value)} disabled={busy} />
                                </label>
                            </div>
                            {!pipelineLocked && (
                                <label className="flex items-center gap-2 text-sm text-text sm:col-span-2">
                                    <input
                                        type="checkbox"
                                        checked={force}
                                        onChange={(event) => setForce(event.target.checked)}
                                        disabled={busy || !pipelineId}
                                    />
                                    Force selected pipeline even when rules do not match
                                </label>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void runReport()}>
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBarChart2 className="h-4 w-4" />}
                                Generate report
                            </button>
                        </div>

                        {result && (
                            <>
                                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                    <div className="rounded-xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/10 to-transparent px-4 py-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/80">Bytes saved</p>
                                        <p className="mt-1 text-xl font-black text-emerald-50">{formatBytes(totals?.estimatedBytesSaved)}</p>
                                        <p className="mt-1 text-xs text-muted">
                                            {totals?.estimatedSavingsPercent != null ? `${totals.estimatedSavingsPercent}%` : '-'} of matched
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-sky-400/25 bg-gradient-to-br from-sky-500/10 to-transparent px-4 py-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-sky-200/80">Encode ETA</p>
                                        <p className="mt-1 text-xl font-black text-sky-50">
                                            {formatDuration(Math.round(Number(totals?.estimatedEncodeMs || 0) / 1000))}
                                        </p>
                                        <p className="mt-1 text-xs text-muted">
                                            {totals?.etaSource === 'history-7d' ? 'From 7d history' : totals?.etaSource === 'duration-factor' ? 'Duration heuristic' : 'Unavailable'}
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Matched</p>
                                        <p className="mt-1 text-xl font-black text-text">{totals?.matched ?? 0}</p>
                                        <p className="mt-1 text-xs text-muted">of {totals?.analyzed ?? 0} analyzed</p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Source size</p>
                                        <p className="mt-1 text-xl font-black text-text">{formatBytes(totals?.matchedSourceBytes || totals?.sourceBytes)}</p>
                                        <p className="mt-1 text-xs text-muted">→ {formatBytes(totals?.estimatedOutputBytes)}</p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <span className="rounded-lg border border-plex/30 bg-plex/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-plex">
                                        {selectedPipeline?.name || 'Auto-match'}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                                        {String(selectedPipeline?.hardware || 'auto').toUpperCase()}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                                        {String(selectedPipeline?.outputMode || 'pipeline').replace(/-/g, ' ')}
                                    </span>
                                    <span className="rounded-lg border border-sky-400/25 bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-200">
                                        Heuristic
                                    </span>
                                    {(result.force || pipelineLocked) && (
                                        <span className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-200">
                                            Forced pipeline
                                        </span>
                                    )}
                                </div>

                                {result.truncated && (
                                    <p className="text-xs text-amber-200">
                                        Truncated to the largest {result.limit} files under this folder.
                                    </p>
                                )}

                                <div className="overflow-hidden rounded-xl border border-border/70">
                                    <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-white/[0.03] px-3 py-2">
                                        <p className="text-xs font-bold uppercase tracking-wider text-muted">Files</p>
                                        <button type="button" className="text-xs font-semibold text-plex hover:underline" onClick={selectAllMatched}>
                                            Select all matched
                                        </button>
                                    </div>
                                    <div className="custom-scrollbar max-h-72 overflow-y-auto divide-y divide-border/50">
                                        {matchedRows.length === 0 ? (
                                            <p className="px-4 py-6 text-sm text-muted">No matching files for this pipeline in the selected folder.</p>
                                        ) : matchedRows.map((row) => (
                                            <label key={row.path} className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-white/[0.03]">
                                                <input
                                                    type="checkbox"
                                                    className="mt-1"
                                                    checked={selected.has(row.path)}
                                                    onChange={() => toggleRow(row)}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-semibold text-text" title={row.path}>
                                                        {pathBasename(row.path)}
                                                    </p>
                                                    <p className="mt-1 text-xs text-muted">
                                                        {codecLabel(row.videoCodec)} → {codecLabel(row.targetCodec || selectedPipeline?.steps?.find((step) => String(step.mode || step.type).toLowerCase() === 'transcode')?.videoCodec || 'hevc')}
                                                        {' · '}
                                                        {formatBytes(row.sizeBytes)} → {formatBytes(row.estimatedOutputBytes)}
                                                        {' · '}
                                                        {row.estimatedSavingsPercent != null ? `${row.estimatedSavingsPercent}%` : '-'}
                                                        {' · '}
                                                        {formatDuration(row.durationSeconds)}
                                                    </p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card/95 px-5 py-4">
                        <button type="button" className={buttonClass} onClick={onClose}>Close</button>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={!selectedRows.length || enqueueBusy || busy}
                                onClick={() => void enqueueRows(selectedRows)}
                            >
                                {enqueueBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                Enqueue selected ({selectedRows.length})
                            </button>
                            <button
                                type="button"
                                className={primaryButtonClass}
                                disabled={!matchedRows.length || enqueueBusy || busy}
                                onClick={() => void enqueueRows(matchedRows)}
                            >
                                {enqueueBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                Enqueue matched ({matchedRows.length})
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};

export default ReportModal;
