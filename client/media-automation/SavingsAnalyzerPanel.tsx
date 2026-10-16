import React, { useMemo, useState } from 'react';
import { Gauge, Loader2, Play, Radar, RefreshCw } from 'lucide-react';
import { CustomSelect } from '../shared/ui';
import { mediaAutomationApi } from './api';
import type {
    MediaAutomationAnalyzeResult,
    MediaAutomationAnalyzeRow,
    MediaAutomationLibrary,
    MediaAutomationPipeline,
    MediaAutomationStatus,
} from './types';

const cardClass = 'rounded-2xl border border-border bg-card/70 shadow-sm';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-white/[0.04] px-3 py-2 text-sm font-semibold text-text transition hover:border-plex/50 hover:bg-plex/10 disabled:pointer-events-none disabled:opacity-40';
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-plex px-3 py-2 text-sm font-bold text-background transition hover:bg-plex-hover disabled:pointer-events-none disabled:opacity-40';
const fieldClass = 'w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-[16px] leading-5 text-text placeholder:text-muted/60 outline-none transition focus:border-plex focus:ring-1 focus:ring-plex';

type SortKey = 'savings' | 'size' | 'percent' | 'bitrate';

const formatBytes = (value?: number | null) => {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
    return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
};

const pathBasename = (value: string) => {
    const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || value;
};

const confidenceClass = (value?: string | null) => {
    if (value === 'high') return 'text-emerald-300';
    if (value === 'medium') return 'text-amber-300';
    return 'text-muted';
};

type Props = {
    libraries: MediaAutomationLibrary[];
    pipelines: MediaAutomationPipeline[];
    status?: MediaAutomationStatus | null;
    toast: (message: string, tone?: 'success' | 'error') => void;
    onEnqueued?: () => void | Promise<void>;
};

export const SavingsAnalyzerPanel: React.FC<Props> = ({
    libraries,
    pipelines,
    status,
    toast,
    onEnqueued,
}) => {
    const defaultMinPercent = Math.min(95, Math.max(0, Math.round(Number(status?.minSavingsPercent) || 20)));
    const [libraryId, setLibraryId] = useState('');
    const [pipelineId, setPipelineId] = useState('');
    const [force, setForce] = useState(false);
    const [limit, setLimit] = useState('150');
    const [minGb, setMinGb] = useState('0.05');
    const [busy, setBusy] = useState(false);
    const [enqueueBusy, setEnqueueBusy] = useState(false);
    const [result, setResult] = useState<MediaAutomationAnalyzeResult | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [sortKey, setSortKey] = useState<SortKey>('savings');
    const [matchedOnly, setMatchedOnly] = useState(true);
    const [enqueueMinPercentEnabled, setEnqueueMinPercentEnabled] = useState(false);
    const [enqueueMinPercent, setEnqueueMinPercent] = useState(String(defaultMinPercent));

    const rows = useMemo(() => {
        const list = Array.isArray(result?.rows) ? [...result.rows] : [];
        const filtered = matchedOnly ? list.filter((row) => row.matched) : list;
        filtered.sort((a, b) => {
            if (sortKey === 'size') return (Number(b.sizeBytes) || 0) - (Number(a.sizeBytes) || 0);
            if (sortKey === 'percent') return (Number(b.estimatedSavingsPercent) || 0) - (Number(a.estimatedSavingsPercent) || 0);
            if (sortKey === 'bitrate') return (Number(b.bitrateKbps) || 0) - (Number(a.bitrateKbps) || 0);
            return (Number(b.estimatedBytesSaved) || 0) - (Number(a.estimatedBytesSaved) || 0);
        });
        return filtered;
    }, [matchedOnly, result?.rows, sortKey]);

    const minEnqueuePercent = Math.min(95, Math.max(0, Math.round(Number(enqueueMinPercent) || 0)));

    const passesEnqueuePercentGate = (row: MediaAutomationAnalyzeRow) => {
        if (!enqueueMinPercentEnabled) return true;
        return (Number(row.estimatedSavingsPercent) || 0) >= minEnqueuePercent;
    };

    const selectedRows = useMemo(
        () => rows.filter((row) => selected.has(row.path)),
        [rows, selected],
    );

    const runAnalyze = async () => {
        setBusy(true);
        setSelected(new Set());
        try {
            const minSizeBytes = Math.max(0, Math.round((Number(minGb) || 0) * 1024 ** 3));
            const response = await mediaAutomationApi.analyze({
                libraryId: libraryId || null,
                pipelineId: pipelineId || null,
                force: force && !!pipelineId,
                limit: Math.min(500, Math.max(1, Number(limit) || 150)),
                minSizeBytes,
            });
            setResult(response);
            const saved = formatBytes(response.totals?.estimatedBytesSaved);
            toast(`Analyzed ${response.totals?.analyzed || 0} files · ~${saved} reclaimable`);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Analyze failed', 'error');
        } finally {
            setBusy(false);
        }
    };

    const toggleRow = (path: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    const toggleAllVisible = () => {
        const enqueueable = rows.filter((row) => row.matched && passesEnqueuePercentGate(row));
        const allSelected = enqueueable.length > 0 && enqueueable.every((row) => selected.has(row.path));
        if (allSelected) {
            setSelected(new Set());
            return;
        }
        setSelected(new Set(enqueueable.map((row) => row.path)));
    };

    const enqueueSelected = async () => {
        const paths = selectedRows
            .filter((row) => row.matched && passesEnqueuePercentGate(row))
            .map((row) => row.path);
        if (!paths.length) {
            toast(
                enqueueMinPercentEnabled
                    ? `Select matched files estimated ≥ ${minEnqueuePercent}% savings.`
                    : 'Select one or more matched files to enqueue.',
                'error',
            );
            return;
        }
        setEnqueueBusy(true);
        try {
            const response = await mediaAutomationApi.enqueueMany(paths, pipelineId || undefined) as {
                queued?: number;
                error?: string;
            };
            toast(`Queued ${response.queued ?? paths.length} file${(response.queued ?? paths.length) === 1 ? '' : 's'}.`);
            setSelected(new Set());
            await onEnqueued?.();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Bulk enqueue failed', 'error');
        } finally {
            setEnqueueBusy(false);
        }
    };

    const deepEstimate = async (row: MediaAutomationAnalyzeRow) => {
        if (!row.pipelineId && !pipelineId) {
            toast('Pick a pipeline (or use a matched row) before deep estimate.', 'error');
            return;
        }
        toast('Running 60s sample encode - this can take a minute…');
        try {
            const response = await mediaAutomationApi.estimate(row.path, row.pipelineId ?? pipelineId ?? null, undefined, {
                libraryId: row.libraryId ?? null,
            });
            const estimate = response.estimate;
            if (!estimate) throw new Error(response.error || 'Estimate failed');
            toast(
                `${pathBasename(row.path)}: ${estimate.estimatedSavingsPercent ?? '?'}%`
                + ` (~${formatBytes(estimate.estimatedBytesSaved)}) via sample encode`,
            );
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Deep estimate failed', 'error');
        }
    };

    return (
        <div className="space-y-5">
            <section className={`${cardClass} space-y-4 p-5`}>
                <div>
                    <h2 className="font-bold text-text">Library savings analyzer</h2>
                    <p className="mt-1 text-sm text-muted">
                        Probe the largest files, estimate reclaimable space from your pipeline targets (bitrate/CRF heuristics — no full encode), then bulk-enqueue the winners.
                    </p>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
                    <label className="space-y-1.5 text-sm font-semibold text-text">
                        Library
                        <CustomSelect
                            value={libraryId}
                            onChange={setLibraryId}
                            options={[
                                { value: '', label: 'All enabled libraries' },
                                ...libraries
                                    .filter((library) => library.enabled !== false)
                                    .map((library) => ({
                                        value: String(library.id ?? ''),
                                        label: library.name || String(library.id),
                                    })),
                            ]}
                        />
                    </label>
                    <label className="space-y-1.5 text-sm font-semibold text-text">
                        Pipeline
                        <CustomSelect
                            value={pipelineId}
                            onChange={setPipelineId}
                            options={[
                                { value: '', label: 'Auto-match rules' },
                                ...pipelines
                                    .filter((pipeline) => pipeline.enabled !== false)
                                    .map((pipeline) => ({
                                        value: String(pipeline.id ?? ''),
                                        label: pipeline.name,
                                    })),
                            ]}
                        />
                    </label>
                    <label className="space-y-1.5 text-sm font-semibold text-text">
                        Max files (largest first)
                        <input className={fieldClass} type="number" min={1} max={500} value={limit} onChange={(event) => setLimit(event.target.value)} />
                    </label>
                    <label className="space-y-1.5 text-sm font-semibold text-text">
                        Min size (GB)
                        <input className={fieldClass} type="number" min={0} step={0.05} value={minGb} onChange={(event) => setMinGb(event.target.value)} />
                    </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-text">
                        <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                            checked={force}
                            disabled={!pipelineId}
                            onChange={(event) => setForce(event.target.checked)}
                        />
                        Force selected pipeline (ignore match rules)
                    </label>
                    <button type="button" className={primaryButtonClass} disabled={busy || libraries.length === 0} onClick={() => void runAnalyze()}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                        {busy ? 'Analyzing…' : 'Run analyzer'}
                    </button>
                </div>
                {libraries.length === 0 && (
                    <p className="text-sm text-amber-200">Add an enabled library first — the analyzer needs a root path to walk.</p>
                )}
            </section>

            {result && (
                <section className={`${cardClass} space-y-4 p-5`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h3 className="font-bold text-text">Results</h3>
                            <p className="mt-1 text-sm text-muted">
                                Discovered {result.totals?.discovered ?? 0}
                                {' · '}considered {result.totals?.considered ?? 0}
                                {' · '}analyzed {result.totals?.analyzed ?? 0}
                                {' · '}matched {result.totals?.matched ?? 0}
                                {result.truncated ? ' · truncated to largest files' : ''}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-emerald-300">
                                ~{formatBytes(result.totals?.estimatedBytesSaved)} estimated reclaim
                                {' '}across {formatBytes(result.totals?.sourceBytes)} probed
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <CustomSelect
                                value={sortKey}
                                onChange={(value) => setSortKey(value as SortKey)}
                                options={[
                                    { value: 'savings', label: 'Sort: bytes saved' },
                                    { value: 'percent', label: 'Sort: % saved' },
                                    { value: 'size', label: 'Sort: file size' },
                                    { value: 'bitrate', label: 'Sort: bitrate' },
                                ]}
                            />
                            <label className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                                    checked={matchedOnly}
                                    onChange={(event) => setMatchedOnly(event.target.checked)}
                                />
                                Matched only
                            </label>
                            <label className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                                    checked={enqueueMinPercentEnabled}
                                    onChange={(event) => setEnqueueMinPercentEnabled(event.target.checked)}
                                />
                                Only enqueue estimated ≥
                                <input
                                    className="appearance-none text-[16px] leading-5 w-16 rounded border border-border bg-background px-2 py-1 text-[16px] text-text outline-none focus:border-plex"
                                    type="number"
                                    min={0}
                                    max={95}
                                    disabled={!enqueueMinPercentEnabled}
                                    value={enqueueMinPercent}
                                    onChange={(event) => setEnqueueMinPercent(event.target.value)}
                                    aria-label="Minimum estimated savings percent"
                                />
                                %
                            </label>
                            <button type="button" className={buttonClass} onClick={toggleAllVisible} disabled={!rows.some((row) => row.matched && passesEnqueuePercentGate(row))}>
                                {rows.filter((row) => row.matched && passesEnqueuePercentGate(row)).every((row) => selected.has(row.path))
                                    && rows.some((row) => row.matched && passesEnqueuePercentGate(row))
                                    ? 'Clear selection'
                                    : 'Select matched'}
                            </button>
                            <button
                                type="button"
                                className={primaryButtonClass}
                                disabled={enqueueBusy || selectedRows.filter((row) => row.matched && passesEnqueuePercentGate(row)).length === 0}
                                onClick={() => void enqueueSelected()}
                            >
                                {enqueueBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                Enqueue selected ({selectedRows.filter((row) => row.matched && passesEnqueuePercentGate(row)).length})
                            </button>
                        </div>
                    </div>

                    {rows.length === 0 ? (
                        <p className="rounded-lg bg-background/40 p-4 text-sm text-muted">
                            No rows to show. Try raising the file limit, lowering the min size, or disabling “Matched only”.
                        </p>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-border/60">
                            <table className="w-full min-w-[920px] text-sm">
                                <thead className="bg-background/50 text-left text-xs uppercase tracking-wide text-muted">
                                    <tr>
                                        <th className="px-3 py-2 font-semibold" />
                                        <th className="px-3 py-2 font-semibold">File</th>
                                        <th className="px-3 py-2 font-semibold">Codec</th>
                                        <th className="px-3 py-2 font-semibold">Size</th>
                                        <th className="px-3 py-2 font-semibold">Bitrate</th>
                                        <th className="px-3 py-2 font-semibold">Est. save</th>
                                        <th className="px-3 py-2 font-semibold">Pipeline</th>
                                        <th className="px-3 py-2 font-semibold" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                    {rows.map((row) => {
                                        const checked = selected.has(row.path);
                                        const resolution = row.width && row.height ? `${row.width}x${row.height}` : null;
                                        return (
                                            <tr key={row.path} className={row.matched ? '' : 'opacity-60'}>
                                                <td className="px-3 py-2 align-top">
                                                    <input
                                                        type="checkbox"
                                                        className="mt-1 h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                                                        checked={checked}
                                                        disabled={!row.matched}
                                                        onChange={() => toggleRow(row.path)}
                                                        aria-label={`Select ${pathBasename(row.path)}`}
                                                    />
                                                </td>
                                                <td className="px-3 py-2 align-top">
                                                    <p className="font-semibold text-text" title={row.path}>{pathBasename(row.path)}</p>
                                                    <p className="mt-0.5 max-w-xs truncate font-mono text-[11px] text-muted" title={row.path}>{row.path}</p>
                                                    {row.libraryName && <p className="mt-0.5 text-[11px] text-muted">{row.libraryName}</p>}
                                                </td>
                                                <td className="px-3 py-2 align-top text-text">
                                                    <p>{row.videoCodec || '-'}</p>
                                                    {resolution && <p className="text-[11px] text-muted">{resolution}</p>}
                                                </td>
                                                <td className="px-3 py-2 align-top text-text">{formatBytes(row.sizeBytes)}</td>
                                                <td className="px-3 py-2 align-top text-text">
                                                    {row.bitrateKbps != null ? `${Math.round(row.bitrateKbps)} kbps` : '-'}
                                                </td>
                                                <td className="px-3 py-2 align-top">
                                                    {row.matched ? (
                                                        <>
                                                            <p className="font-semibold text-emerald-300">
                                                                {formatBytes(row.estimatedBytesSaved)}
                                                                {row.estimatedSavingsPercent != null ? ` (${row.estimatedSavingsPercent}%)` : ''}
                                                            </p>
                                                            <p className={`text-[11px] ${confidenceClass(row.confidence)}`}>
                                                                {row.confidence || 'low'} confidence · {row.estimateReason || 'heuristic'}
                                                            </p>
                                                        </>
                                                    ) : (
                                                        <p className="text-muted">{row.matchReason || 'skipped'}</p>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 align-top text-text">
                                                    <p>{row.pipelineName || (row.pipelineId ? `Pipeline ${row.pipelineId}` : '-')}</p>
                                                    {row.forced && <p className="text-[11px] text-amber-300">Forced</p>}
                                                </td>
                                                <td className="px-3 py-2 align-top">
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={!row.matched && !pipelineId}
                                                        title="Run a 60s sample encode for a tighter estimate"
                                                        onClick={() => void deepEstimate(row)}
                                                    >
                                                        <Gauge className="h-4 w-4" /> Sample
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="text-xs text-muted">
                        Heuristic estimates use the pipeline’s target bitrate when set, otherwise CRF/codec ratios. Use Sample on a row for a real short encode before committing a big batch.
                    </p>
                    <button type="button" className={buttonClass} disabled={busy} onClick={() => void runAnalyze()}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Re-run
                    </button>
                </section>
            )}
        </div>
    );
};

export default SavingsAnalyzerPanel;
