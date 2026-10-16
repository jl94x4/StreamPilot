import React, { useCallback, useEffect, useState } from 'react';
import { CirclePause, CirclePlay, Cpu, Layers3, Loader2, MemoryStick, Zap } from 'lucide-react';
import { mediaAutomationApi } from './api';
import type { MediaAutomationHostMetrics, MediaAutomationStatus } from './types';
import {
    readSystemMetricsRefreshMs,
    SYSTEM_METRICS_REFRESH_EVENT,
} from './systemMetricsRefresh';
import { dashboardPanelClass } from '../shared/dashboard/DashboardChrome';

const panelClass = dashboardPanelClass;

const compactButtonClass =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40';
const compactPrimaryClass =
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-plex px-3 py-1.5 text-xs font-bold text-background transition hover:bg-plex-hover disabled:pointer-events-none disabled:opacity-40';

const clampPercent = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(Number(value))) return null;
    return Math.max(0, Math.min(100, Number(value)));
};

const toneFor = (percent: number | null) => {
    if (percent == null) return { stroke: 'rgb(var(--color-plex))', text: 'text-plex' };
    if (percent >= 90) return { stroke: '#f87171', text: 'text-rose-300' };
    if (percent >= 75) return { stroke: '#fb923c', text: 'text-orange-300' };
    return { stroke: 'rgb(var(--color-plex))', text: 'text-plex' };
};

const encodeControlTitle = (workerStatus: MediaAutomationStatus) => {
    if (workerStatus.autoPausedForQueueDepth || String(workerStatus.workerState || '').toLowerCase() === 'auto-paused') {
        return 'Auto-paused (queue depth)';
    }
    if ((workerStatus.workerPaused ?? workerStatus.paused) !== false) {
        return 'Paused (queue only)';
    }
    if (workerStatus.quietHoursActive) {
        return 'Quiet hours holding encodes';
    }
    if (workerStatus.streamingPauseActive) {
        return 'Streaming pause active';
    }
    if (String(workerStatus.workerState || workerStatus.state || '').toLowerCase() === 'running') {
        return 'Encoding';
    }
    return String(workerStatus.workerState || workerStatus.state || 'stopped');
};

const encodeControlSubtitle = (workerStatus: MediaAutomationStatus) => {
    if (workerStatus.autoPausedForQueueDepth || String(workerStatus.workerState || '').toLowerCase() === 'auto-paused') {
        return 'Queue depth exceeded the auto-pause limit.';
    }
    if ((workerStatus.workerPaused ?? workerStatus.paused) !== false) {
        return 'Jobs can still be queued and scanned. Start when you want encodes to run.';
    }
    if (workerStatus.quietHoursActive) {
        return `Quiet hours ${workerStatus.quietHoursStart || '23:00'}–${workerStatus.quietHoursEnd || '07:00'}.`;
    }
    if (workerStatus.streamingPauseActive) {
        const streams = Number(workerStatus.activeStreamCount) || 0;
        return `Holding encodes while ${streams} stream${streams === 1 ? '' : 's'} active.`;
    }
    if (workerStatus.dryRun || workerStatus.outputMode === 'dry-run') {
        return 'Global dry-run — nothing will rewrite media.';
    }
    return 'Worker may claim queued jobs.';
};

const MiniArcGauge: React.FC<{
    label: string;
    icon: React.ReactNode;
    percent: number | null;
}> = ({ label, icon, percent }) => {
    const tone = toneFor(percent);
    const radius = 28;
    const circumference = Math.PI * radius;
    const offset = circumference - (((percent ?? 0) / 100) * circumference);

    return (
        <div className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-black/25 p-2.5">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                {icon}
                <span className="truncate">{label}</span>
            </div>
            <div className="relative mx-auto h-12 w-full max-w-[5.5rem]">
                <svg viewBox="0 0 80 48" className="h-full w-full" aria-hidden>
                    <path
                        d="M 10 42 A 28 28 0 0 1 70 42"
                        fill="none"
                        stroke="rgb(255 255 255 / 0.08)"
                        strokeWidth="6"
                        strokeLinecap="round"
                    />
                    <path
                        d="M 10 42 A 28 28 0 0 1 70 42"
                        fill="none"
                        stroke={tone.stroke}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        className="ma-gauge-arc transition-[stroke-dashoffset] duration-700 ease-out"
                        style={{ filter: `drop-shadow(0 0 6px ${tone.stroke}55)` }}
                    />
                </svg>
                <p className={`absolute inset-x-0 bottom-0 text-center text-sm font-black tabular-nums tracking-tight ${tone.text}`}>
                    {percent != null ? `${Math.round(percent)}%` : '—'}
                </p>
            </div>
        </div>
    );
};

const StatTile: React.FC<{ label: string; value: string; sub?: string; icon: React.ReactNode }> = ({
    label,
    value,
    sub,
    icon,
}) => (
    <div className="flex min-w-0 flex-col justify-between rounded-xl border border-white/10 bg-black/25 p-2.5">
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
            {icon}
            <span className="truncate">{label}</span>
        </div>
        <p className="mt-2 text-xl font-black tabular-nums tracking-tight text-text">{value}</p>
        {sub ? <p className="mt-0.5 truncate text-[10px] text-muted">{sub}</p> : null}
    </div>
);

type Props = {
    status: MediaAutomationStatus;
    busy: string | null;
    onStart: () => void;
    onPause: () => void;
};

export const EncodeControlCard: React.FC<Props> = ({ status, busy, onStart, onPause }) => {
    const encodingPaused = (status.workerPaused ?? status.paused) !== false;
    const title = encodeControlTitle(status);
    const subtitle = encodeControlSubtitle(status);
    const streamCount = Number(status.activeStreamCount) || 0;
    const [metrics, setMetrics] = useState<MediaAutomationHostMetrics | null>(null);
    const [metricsLive, setMetricsLive] = useState(false);
    const [refreshMs, setRefreshMs] = useState(() => readSystemMetricsRefreshMs());

    const fetchMetrics = useCallback(async () => {
        try {
            const next = await mediaAutomationApi.metrics();
            setMetrics(next);
            setMetricsLive(true);
        } catch {
            setMetricsLive(false);
        }
    }, []);

    useEffect(() => {
        void fetchMetrics();
        const interval = window.setInterval(fetchMetrics, refreshMs);
        const onRefreshPref = (event: Event) => {
            const detail = (event as CustomEvent<number>).detail;
            if (Number.isFinite(detail)) setRefreshMs(detail);
        };
        window.addEventListener(SYSTEM_METRICS_REFRESH_EVENT, onRefreshPref);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener(SYSTEM_METRICS_REFRESH_EVENT, onRefreshPref);
        };
    }, [fetchMetrics, refreshMs]);

    const holdGates: Array<{ id: string; label: string }> = [];
    if (status.quietHoursActive) {
        holdGates.push({
            id: 'quiet',
            label: `Quiet hours ${status.quietHoursStart || '23:00'}–${status.quietHoursEnd || '07:00'}`,
        });
    }
    if (status.streamingPauseActive) {
        holdGates.push({
            id: 'streams',
            label: `${streamCount} stream${streamCount === 1 ? '' : 's'} active`,
        });
    }
    if (status.dryRun || status.outputMode === 'dry-run') {
        holdGates.push({ id: 'dry-run', label: 'Global dry-run' });
    }
    if (status.autoPausedForQueueDepth || String(status.workerState || '').toLowerCase() === 'auto-paused') {
        holdGates.push({ id: 'queue-depth', label: 'Auto-paused (queue depth)' });
    }

    const cpuPercent = clampPercent(metrics?.cpu?.usedPercent);
    const memPercent = clampPercent(metrics?.memory?.usedPercent);
    const queued = Number(status.queuedJobs) || 0;
    const cpuRunning = Number(status.lanes?.cpu?.running) || 0;
    const gpuRunning = Number(status.lanes?.gpu?.running) || 0;
    const activeTotal = Number(status.activeJobs) || (cpuRunning + gpuRunning);
    const encodingActive = !encodingPaused
        && String(status.workerState || status.state || '').toLowerCase() === 'running';

    return (
        <section className={`${panelClass} p-5`}>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgb(var(--color-plex)_/_0.08),transparent_45%)]" />
            <div className="relative flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                                Encode control
                            </span>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                encodingActive
                                    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                                    : encodingPaused
                                        ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                                        : 'border-white/10 bg-white/5 text-muted'
                            }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${
                                    encodingActive
                                        ? 'ma-live-dot bg-emerald-400'
                                        : encodingPaused
                                            ? 'bg-amber-400'
                                            : 'bg-white/40'
                                }`} />
                                {encodingActive ? 'Live' : encodingPaused ? 'Paused' : 'Idle'}
                            </span>
                            {metricsLive && (
                                <span className="text-[10px] text-muted/70">Host metrics synced</span>
                            )}
                        </div>
                        <h2 className="text-lg font-bold tracking-tight text-text">{title}</h2>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button
                            type="button"
                            className={encodingPaused ? compactPrimaryClass : compactButtonClass}
                            disabled={busy !== null || !encodingPaused}
                            onClick={onStart}
                        >
                            {busy === 'control-start'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <CirclePlay className="h-3.5 w-3.5" />}
                            Start
                        </button>
                        <button
                            type="button"
                            className={!encodingPaused ? compactPrimaryClass : compactButtonClass}
                            disabled={busy !== null || encodingPaused}
                            onClick={onPause}
                        >
                            {busy === 'control-pause'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <CirclePause className="h-3.5 w-3.5" />}
                            Pause
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MiniArcGauge
                        label="CPU"
                        icon={<Cpu className="h-3 w-3 shrink-0 text-plex" />}
                        percent={cpuPercent}
                    />
                    <MiniArcGauge
                        label="RAM"
                        icon={<MemoryStick className="h-3 w-3 shrink-0 text-plex" />}
                        percent={memPercent}
                    />
                    <StatTile
                        label="Queued"
                        value={String(queued)}
                        sub={queued === 1 ? 'job waiting' : 'jobs waiting'}
                        icon={<Layers3 className="h-3 w-3 shrink-0 text-plex" />}
                    />
                    <StatTile
                        label="Running"
                        value={`${activeTotal}`}
                        sub={`CPU ${cpuRunning} · GPU ${gpuRunning}`}
                        icon={<Zap className="h-3 w-3 shrink-0 text-plex" />}
                    />
                </div>

                {holdGates.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {holdGates.map((gate) => (
                            <span
                                key={gate.id}
                                className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100"
                            >
                                {gate.label}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
};

export default EncodeControlCard;
