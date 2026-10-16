import React, { useEffect, useState } from 'react';
import { Clock3, Cpu, FolderSearch, Gauge, Minus, Percent, PlayCircle, Plus, Radar, Server, ShieldCheck, Tags } from 'lucide-react';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import { askConfirm } from '../shared/confirm';
import type {
    HardwareMode,
    MediaAutomationDeliveryTarget,
    MediaAutomationSettingsConfig,
    MediaAutomationWorkerGroup,
    OutputMode,
} from './types';
import { emptyDeliveryTarget, emptyWorkerGroup } from './types';
import { portalUrl } from '../shared/basePath';
import {
    readSystemMetricsRefreshMs,
    SYSTEM_METRICS_REFRESH_OPTIONS,
    writeSystemMetricsRefreshMs,
    type SystemMetricsRefreshMs,
} from './systemMetricsRefresh';

type Props = {
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    homeWidgetEnabled: boolean;
    onHomeWidgetEnabledChange: (enabled: boolean) => void;
    config: MediaAutomationSettingsConfig;
    onConfigChange: (config: MediaAutomationSettingsConfig) => void;
};

const fieldClass = 'w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-[16px] leading-5 text-text outline-none transition focus:border-plex focus:ring-1 focus:ring-plex';
const stepperBtnClass = 'inline-flex h-[42px] w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-text transition hover:border-plex/50 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40';

/** Mobile-friendly concurrency field: +/- steppers + draft text so clearing does not force 0 → 02. */
const ConcurrencyCountInput: React.FC<{
    id?: string;
    value: number;
    min?: number;
    max: number;
    disabled?: boolean;
    onChange: (value: number) => void;
}> = ({ id, value, min = 0, max, disabled = false, onChange }) => {
    const [draft, setDraft] = useState<string | null>(null);
    const clamped = Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

    const commit = (raw: string) => {
        const trimmed = String(raw || '').trim();
        if (trimmed === '') {
            onChange(min);
            setDraft(null);
            return;
        }
        const next = Number(trimmed);
        if (!Number.isFinite(next)) {
            setDraft(null);
            return;
        }
        onChange(Math.min(max, Math.max(min, Math.round(next))));
        setDraft(null);
    };

    return (
        <div className="mt-2 flex items-stretch gap-2">
            <button
                type="button"
                className={stepperBtnClass}
                disabled={disabled || clamped <= min}
                aria-label="Decrease"
                onClick={() => {
                    setDraft(null);
                    onChange(Math.max(min, clamped - 1));
                }}
            >
                <Minus className="h-4 w-4" />
            </button>
            <input
                id={id}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                disabled={disabled}
                className={`${fieldClass} text-center tabular-nums`}
                value={draft !== null ? draft : String(clamped)}
                onFocus={() => setDraft(String(clamped))}
                onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === '' || /^\d{0,3}$/.test(raw)) setDraft(raw);
                }}
                onBlur={() => commit(draft !== null ? draft : String(clamped))}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        (event.target as HTMLInputElement).blur();
                    }
                }}
            />
            <button
                type="button"
                className={stepperBtnClass}
                disabled={disabled || clamped >= max}
                aria-label="Increase"
                onClick={() => {
                    setDraft(null);
                    onChange(Math.min(max, clamped + 1));
                }}
            >
                <Plus className="h-4 w-4" />
            </button>
        </div>
    );
};
const WEEKDAYS = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 0, label: 'Sun' },
];

export const MediaAutomationSettings: React.FC<Props> = ({
    enabled,
    onEnabledChange,
    homeWidgetEnabled,
    onHomeWidgetEnabledChange,
    config,
    onConfigChange,
}) => {
    const [systemMetricsRefreshMs, setSystemMetricsRefreshMs] = useState<SystemMetricsRefreshMs>(() => readSystemMetricsRefreshMs());

    useEffect(() => {
        setSystemMetricsRefreshMs(readSystemMetricsRefreshMs());
    }, []);

    const update = (patch: Partial<MediaAutomationSettingsConfig>) => onConfigChange({ ...config, ...patch });
    const setConcurrency = (lane: 'cpu' | 'gpu', value: number) => {
        const next = {
            ...config.concurrency,
            [lane]: value,
        };
        update({
            concurrency: next,
            cpuConcurrency: next.cpu,
            gpuConcurrency: next.gpu,
        } as Partial<MediaAutomationSettingsConfig>);
    };
    const globalDryRun = config.fallback.outputMode === 'dry-run';
    const quietDays = Array.isArray(config.quietHoursDays) ? config.quietHoursDays : [];
    const workerGroups = Array.isArray(config.workerGroups) ? config.workerGroups : [];
    const deliveryTargets = Array.isArray(config.deliveryTargets) ? config.deliveryTargets : [];

    const toggleQuietDay = (day: number) => {
        const next = quietDays.includes(day)
            ? quietDays.filter((entry) => entry !== day)
            : [...quietDays, day].sort((a, b) => a - b);
        update({ quietHoursDays: next });
    };

    const updateWorkerGroup = (index: number, patch: Partial<MediaAutomationWorkerGroup>) => {
        const next = workerGroups.map((group, i) => (i === index ? { ...group, ...patch } : group));
        update({ workerGroups: next });
    };

    const updateDeliveryTarget = (index: number, patch: Partial<MediaAutomationDeliveryTarget>) => {
        const next = deliveryTargets.map((target, i) => (i === index ? { ...target, ...patch } : target));
        update({ deliveryTargets: next });
    };

    return (
        <div className="mb-8 animate-fade-in space-y-6">
            <div>
                <h3 className="text-xl font-bold text-plex mb-2 border-b border-border pb-2">Media Automation</h3>
                <p className="text-sm text-muted max-w-3xl">
                    Configure the native FFmpeg worker, library scan/watch discovery, safe fallbacks, and dashboard visibility.
                </p>
            </div>

            <section className="glass-card-sm p-5 space-y-2">
                <SettingsToggleRow
                    title="Enable Media Automation"
                    description="Show the admin dashboard and allow native media jobs to run."
                    checked={enabled}
                    onChange={(next) => {
                        onEnabledChange(next);
                        update({ enabled: next });
                        if (!next) onHomeWidgetEnabledChange(false);
                    }}
                    border={false}
                />
                <SettingsToggleRow
                    title="Show home status widget"
                    description="Display a compact worker and queue summary on the admin home dashboard when supported."
                    checked={homeWidgetEnabled}
                    onChange={onHomeWidgetEnabledChange}
                    disabled={!enabled}
                    border={false}
                />
                <SettingsToggleRow
                    title="Gotify on job failure"
                    description="Send a Gotify alert when a Media Automation job fails. Requires Gotify to be configured under Settings → Notifications."
                    checked={config.notifyOnJobFailed === true}
                    onChange={(notifyOnJobFailed) => update({ notifyOnJobFailed })}
                    disabled={!enabled}
                    border={false}
                />
                <SettingsToggleRow
                    title="Gotify on scan complete"
                    description="Alert when a library scan finishes or is cancelled, including queued/skipped counts."
                    checked={config.notifyOnScanComplete === true}
                    onChange={(notifyOnScanComplete) => update({ notifyOnScanComplete })}
                    disabled={!enabled}
                    border={false}
                />
                <SettingsToggleRow
                    title="Gotify on failure burst"
                    description="Send one digest if 5 or more jobs fail within 15 minutes (debounced)."
                    checked={config.notifyOnFailBurst === true}
                    onChange={(notifyOnFailBurst) => update({ notifyOnFailBurst })}
                    disabled={!enabled}
                    border={false}
                />
                <div className="border-t border-white/5 pt-4">
                    <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-plex" />
                        <h4 className="font-bold text-text">System metrics refresh</h4>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                        How often Media Automation → System polls CPU, memory, and GPU. Maximum (1 ms) refreshes as fast as the host can respond.
                    </p>
                    <div className="mt-3 max-w-sm">
                        <CustomSelect
                            value={String(systemMetricsRefreshMs)}
                            onChange={(value) => setSystemMetricsRefreshMs(writeSystemMetricsRefreshMs(Number(value)))}
                            options={SYSTEM_METRICS_REFRESH_OPTIONS.map((option) => ({
                                value: String(option.value),
                                label: option.label,
                            }))}
                        />
                    </div>
                </div>
            </section>

            <section className="glass-card-sm p-5 space-y-4">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-plex" />
                    <h4 className="font-bold text-text">Queue safety</h4>
                </div>
                <label className="block space-y-2 text-sm font-semibold text-text">
                    Minimum free disk (GB)
                    <input
                        className={fieldClass}
                        type="number"
                        min={0}
                        max={10000}
                        value={config.minFreeDiskGb ?? 20}
                        onChange={(event) => {
                            const next = Number(event.target.value);
                            update({ minFreeDiskGb: Number.isFinite(next) ? Math.min(10000, Math.max(0, Math.round(next))) : 20 });
                        }}
                        disabled={!enabled}
                    />
                    <span className="block text-xs font-normal text-muted">Blocks non-preview scans and encode claims when free space on the library root is below this value. 0 disables.</span>
                </label>
                <label className="block space-y-2 text-sm font-semibold text-text">
                    Auto-pause queue depth
                    <input
                        className={fieldClass}
                        type="number"
                        min={0}
                        max={100000}
                        value={config.autoPauseQueueDepth ?? 0}
                        onChange={(event) => {
                            const next = Number(event.target.value);
                            update({ autoPauseQueueDepth: Number.isFinite(next) ? Math.min(100000, Math.max(0, Math.round(next))) : 0 });
                        }}
                        disabled={!enabled}
                    />
                    <span className="block text-xs font-normal text-muted">When queued jobs reach this depth, encoding claims pause automatically without flipping Start/Pause. 0 disables.</span>
                </label>
                <SettingsToggleRow
                    title="Pause encoding after manual scans"
                    description="When you press Scan, encoding flips to Paused so you can review queued jobs before Start. Scheduled library scans keep encoding running."
                    checked={config.pauseEncodingOnScan !== false}
                    onChange={(pauseEncodingOnScan) => update({ pauseEncodingOnScan })}
                    disabled={!enabled}
                />
                <label className="block space-y-2 text-sm font-semibold text-text">
                    Path deny list
                    <textarea
                        className={`appearance-none text-[16px] leading-5 ${fieldClass} min-h-28 font-mono text-[16px]`}
                        value={(config.pathDenyList || []).join('\n')}
                        placeholder={'/media/keep\n**/sample*'}
                        onChange={(event) => update({
                            pathDenyList: [...new Set(
                                event.target.value
                                    .split(/\r?\n/)
                                    .map((entry) => entry.trim())
                                    .filter(Boolean),
                            )].slice(0, 200),
                        })}
                        disabled={!enabled}
                    />
                    <span className="block text-xs font-normal text-muted">One path prefix or glob per line. Matching files are never enqueued (skip reason: denied-path).</span>
                </label>
            </section>

            <section className="glass-card-sm p-5 space-y-4">
                <div className="flex items-center gap-2">
                    <Clock3 className="w-5 h-5 text-plex" />
                    <h4 className="font-bold text-text">Quiet hours</h4>
                </div>
                <p className="text-sm text-muted">
                    Pause claiming new encode jobs overnight (or any window). Scans and ARR webhooks can still fill the queue; work starts when the window ends.
                </p>
                <SettingsToggleRow
                    title="Pause encoding during quiet hours"
                    description="Uses the container/host local clock. Example: 23:00 to 07:00."
                    checked={config.quietHoursEnabled === true}
                    onChange={(quietHoursEnabled) => update({ quietHoursEnabled })}
                    disabled={!enabled}
                    border={false}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Start (HH:MM)
                        <input
                            className={`${fieldClass} mt-2`}
                            value={config.quietHoursStart || '23:00'}
                            disabled={!enabled || config.quietHoursEnabled !== true}
                            onChange={(event) => update({ quietHoursStart: event.target.value })}
                            placeholder="23:00"
                        />
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        End (HH:MM)
                        <input
                            className={`${fieldClass} mt-2`}
                            value={config.quietHoursEnd || '07:00'}
                            disabled={!enabled || config.quietHoursEnabled !== true}
                            onChange={(event) => update({ quietHoursEnd: event.target.value })}
                            placeholder="07:00"
                        />
                    </label>
                </div>
                <div>
                    <p className="mb-2 text-xs uppercase tracking-wide font-bold text-muted">Active days</p>
                    <p className="mb-2 text-xs text-muted">Leave all off to apply quiet hours every day.</p>
                    <div className="flex flex-wrap gap-2">
                        {WEEKDAYS.map((day) => {
                            const active = quietDays.includes(day.value);
                            return (
                                <button
                                    key={day.value}
                                    type="button"
                                    disabled={!enabled || config.quietHoursEnabled !== true}
                                    onClick={() => toggleQuietDay(day.value)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                                        active
                                            ? 'border-plex/50 bg-plex/20 text-plex'
                                            : 'border-border bg-background/40 text-muted hover:text-text'
                                    }`}
                                >
                                    {day.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="glass-card-sm p-5 space-y-4">
                <div className="flex items-center gap-2">
                    <PlayCircle className="w-5 h-5 text-plex" />
                    <h4 className="font-bold text-text">Streaming & guardrails</h4>
                </div>
                <SettingsToggleRow
                    title="Pause encodes while anyone is streaming"
                    description="Holds new encode jobs while Plex/Jellyfin playback sessions are active, so transcodes never fight viewers for the GPU. Running jobs finish; new ones wait."
                    checked={config.pauseWhenStreamingEnabled === true}
                    onChange={(pauseWhenStreamingEnabled) => update({ pauseWhenStreamingEnabled })}
                    disabled={!enabled}
                    border={false}
                />
                <label className="block max-w-sm text-xs uppercase tracking-wide font-bold text-muted">
                    Lanes to pause
                    <div className="mt-2">
                        <CustomSelect
                            value={config.pauseWhenStreamingLanes === 'all' ? 'all' : 'gpu'}
                            onChange={(lanes) => update({ pauseWhenStreamingLanes: lanes as 'gpu' | 'all' })}
                            options={[
                                { value: 'gpu', label: 'GPU lane only (recommended)' },
                                { value: 'all', label: 'GPU and CPU lanes' },
                            ]}
                        />
                    </div>
                </label>
                <SettingsToggleRow
                    title="Notify Sonarr/Radarr after changes"
                    description="After a Replace or delivery succeeds, ask the matching Sonarr series or Radarr movie to rescan so their file/quality info stays accurate. Uses instances from Settings → Integrations."
                    checked={config.arrRescanEnabled === true}
                    onChange={(arrRescanEnabled) => update({ arrRescanEnabled })}
                    disabled={!enabled}
                />
                <SettingsToggleRow
                    title="Queue Scanner refresh after library writes"
                    description="After Copy or Replace into a library root (not your Output folder), queue an instant Scanner refresh for that season/parent folder. Paths are remapped using Settings → Scanner → Media Automation Rewrites (Automation path → Scanner/Plex path). Leave off if completed files live outside Plex library paths."
                    checked={config.scannerRefreshEnabled === true}
                    onChange={(scannerRefreshEnabled) => update({ scannerRefreshEnabled })}
                    disabled={!enabled}
                />
                <SettingsToggleRow
                    title="Refresh Plex after changes"
                    description="After Replace/Copy (or delivery) succeeds, partially refresh the parent folder and Analyze the item so codec/bitrate metadata updates when the filename stays the same. Uses your portal Plex URL/token (does not queue Scanner)."
                    checked={config.plexRescanEnabled === true}
                    onChange={(plexRescanEnabled) => update({ plexRescanEnabled })}
                    disabled={!enabled}
                    border={false}
                />
                <label className="block max-w-lg text-xs uppercase tracking-wide font-bold text-muted">
                    Dolby Vision handling
                    <div className="mt-2">
                        <CustomSelect
                            value={config.dolbyVisionHandling || 'skip'}
                            onChange={(dolbyVisionHandling) => update({
                                dolbyVisionHandling: dolbyVisionHandling as 'skip' | 'preserve' | 'strip',
                            })}
                            options={[
                                { value: 'skip', label: 'Skip (recommended)' },
                                { value: 'strip', label: 'Strip HDR and encode anyway' },
                                { value: 'preserve', label: 'Preserve best-effort (often lossy)' },
                            ]}
                        />
                    </div>
                </label>
                <p className="text-xs text-muted">
                    Re-encoding Dolby Vision usually drops the DV RPU and washes out the image. Remux/copy pipelines are still allowed.
                </p>
                <label className="block max-w-lg text-xs uppercase tracking-wide font-bold text-muted">
                    HDR10 / HLG handling
                    <div className="mt-2">
                        <CustomSelect
                            value={config.hdr10Handling || 'preserve'}
                            onChange={(hdr10Handling) => update({
                                hdr10Handling: hdr10Handling as 'preserve' | 'strip' | 'skip',
                            })}
                            options={[
                                { value: 'preserve', label: 'Preserve (force 10-bit + HDR tags)' },
                                { value: 'strip', label: 'Strip HDR metadata' },
                                { value: 'skip', label: 'Skip HDR10/HLG files' },
                            ]}
                        />
                    </div>
                </label>
                <p className="text-xs text-muted">
                    Preserve forces Main10/P010 on HEVC/AV1 and writes color + mastering/MaxCLL tags when ffprobe reports them (best on CPU x265).
                </p>
            </section>

            <section className="glass-card-sm p-5 space-y-4">
                <div className="flex items-center gap-2">
                    <Percent className="w-5 h-5 text-plex" />
                    <h4 className="font-bold text-text">ROI & niche gates</h4>
                </div>
                <p className="text-sm text-muted">
                    Skip low-value work before (and after) encode. 0 disables each numeric gate unless noted.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted" htmlFor="media-automation-min-savings">
                        Minimum savings (%)
                        <input
                            id="media-automation-min-savings"
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={95}
                            disabled={!enabled}
                            value={config.minSavingsPercent ?? 0}
                            onChange={(event) => update({
                                minSavingsPercent: Math.min(95, Math.max(0, Math.round(Number(event.target.value) || 0))),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Pre-filters via estimate and discards finished encodes below this %.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Min reclaim (GB)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={1000}
                            step={0.1}
                            disabled={!enabled}
                            value={config.minReclaimGb ?? 0}
                            onChange={(event) => update({
                                minReclaimGb: Math.min(1000, Math.max(0, Number(event.target.value) || 0)),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Skip when estimated bytes saved is below this.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Min source size (GB)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={1000}
                            step={0.1}
                            disabled={!enabled}
                            value={config.minSourceGb ?? 0}
                            onChange={(event) => update({
                                minSourceGb: Math.min(1000, Math.max(0, Number(event.target.value) || 0)),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Ignore files smaller than this.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Min bitrate (kbps)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={200000}
                            disabled={!enabled}
                            value={config.minBitrateKbps ?? 0}
                            onChange={(event) => update({
                                minBitrateKbps: Math.min(200000, Math.max(0, Math.round(Number(event.target.value) || 0))),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Skip already-compact sources.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Min file age (days)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={3650}
                            disabled={!enabled}
                            value={config.minFileAgeDays ?? 0}
                            onChange={(event) => update({
                                minFileAgeDays: Math.min(3650, Math.max(0, Math.round(Number(event.target.value) || 0))),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Let new downloads settle before encode.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Sample gate min size (GB)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={1000}
                            step={0.1}
                            disabled={!enabled || config.sampleGateEnabled !== true}
                            value={config.sampleGateMinSizeGb ?? 2}
                            onChange={(event) => update({
                                sampleGateMinSizeGb: Math.min(1000, Math.max(0, Number(event.target.value) || 0)),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Only sample-encode files at least this large.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Free-space ROI floor (%)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={95}
                            disabled={!enabled}
                            value={config.freeSpaceRoiMinPercent ?? 0}
                            onChange={(event) => update({
                                freeSpaceRoiMinPercent: Math.min(95, Math.max(0, Math.round(Number(event.target.value) || 0))),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            When disk is low, raise min savings to at least this.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Daytime extra savings (%)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={50}
                            disabled={!enabled}
                            value={config.daytimeExtraSavingsPercent ?? 0}
                            onChange={(event) => update({
                                daytimeExtraSavingsPercent: Math.min(50, Math.max(0, Math.round(Number(event.target.value) || 0))),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Add to threshold outside quiet hours.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Max watch count
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={100000}
                            disabled={!enabled}
                            value={config.maxWatchCount ?? 0}
                            onChange={(event) => update({
                                maxWatchCount: Math.min(100000, Math.max(0, Math.round(Number(event.target.value) || 0))),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Skip heavily watched titles (0 = off). Uses the Cleaner/Upgrader media index path map — rebuild that index if watch gates look stale.
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Skip watched within (days)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={3650}
                            disabled={!enabled}
                            value={config.skipWatchedWithinDays ?? 0}
                            onChange={(event) => update({
                                skipWatchedWithinDays: Math.min(3650, Math.max(0, Math.round(Number(event.target.value) || 0))),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Protect recently watched media (same index; 0 = off).
                        </span>
                    </label>
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                        Season match min (%)
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={0}
                            max={100}
                            disabled={!enabled}
                            value={config.seasonMatchMinPercent ?? 0}
                            onChange={(event) => update({
                                seasonMatchMinPercent: Math.min(100, Math.max(0, Math.round(Number(event.target.value) || 0))),
                            })}
                        />
                        <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
                            Hold mixed seasons until this % already match.
                        </span>
                    </label>
                </div>
                <SettingsToggleRow
                    title="Sample encode gate"
                    description="Before a full transcode, run a short sample and abort if projected savings miss the ROI thresholds."
                    checked={config.sampleGateEnabled === true}
                    onChange={(sampleGateEnabled) => update({ sampleGateEnabled })}
                    disabled={!enabled}
                    border={false}
                />
                <SettingsToggleRow
                    title="Replace quality guard"
                    description="Block replace commits that drop resolution class or HDR signaling."
                    checked={config.replaceQualityGuard !== false}
                    onChange={(replaceQualityGuard) => update({ replaceQualityGuard })}
                    disabled={!enabled}
                />
                <SettingsToggleRow
                    title="Audio cleanup only if video already matches"
                    description="Audio-only pipelines require source video to already be HEVC/AV1."
                    checked={config.audioOnlyIfVideoMatches === true}
                    onChange={(audioOnlyIfVideoMatches) => update({ audioOnlyIfVideoMatches })}
                    disabled={!enabled}
                    border={false}
                />
            </section>

            <section className="glass-card-sm p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Tags className="w-5 h-5 text-plex" />
                        <h4 className="font-bold text-text">Worker groups</h4>
                    </div>
                    <button
                        type="button"
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-text hover:border-plex/40"
                        disabled={!enabled}
                        onClick={() => update({ workerGroups: [...workerGroups, emptyWorkerGroup()] })}
                    >
                        Add group
                    </button>
                </div>
                <p className="text-sm text-muted">
                    Optional tagged lanes. Empty tags accept any job. Leave empty to use global CPU/GPU concurrency only.
                </p>
                {workerGroups.length === 0 && (
                    <p className="text-xs text-muted">No worker groups configured. Global concurrency applies.</p>
                )}
                {workerGroups.map((group, index) => (
                    <div key={group.id || index} className="space-y-3 rounded-xl border border-border/70 bg-background/30 p-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                Name
                                <input
                                    className={`${fieldClass} mt-2`}
                                    value={group.name}
                                    disabled={!enabled}
                                    onChange={(event) => updateWorkerGroup(index, { name: event.target.value })}
                                />
                            </label>
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                Tags (comma-separated)
                                <input
                                    className={`${fieldClass} mt-2`}
                                    value={(group.tags || []).join(', ')}
                                    disabled={!enabled}
                                    placeholder="tv, priority"
                                    onChange={(event) => updateWorkerGroup(index, {
                                        tags: event.target.value.split(/[,\s]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
                                    })}
                                />
                            </label>
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                CPU concurrency
                                <ConcurrencyCountInput
                                    value={group.cpuConcurrency}
                                    min={0}
                                    max={32}
                                    disabled={!enabled}
                                    onChange={(cpuConcurrency) => updateWorkerGroup(index, { cpuConcurrency })}
                                />
                            </label>
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                GPU concurrency
                                <ConcurrencyCountInput
                                    value={group.gpuConcurrency}
                                    min={0}
                                    max={16}
                                    disabled={!enabled}
                                    onChange={(gpuConcurrency) => updateWorkerGroup(index, { gpuConcurrency })}
                                />
                            </label>
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                Priority bias
                                <input
                                    className={`${fieldClass} mt-2`}
                                    type="number"
                                    min={-100}
                                    max={100}
                                    value={group.priorityBias}
                                    disabled={!enabled}
                                    onChange={(event) => updateWorkerGroup(index, {
                                        priorityBias: Math.min(100, Math.max(-100, Number(event.target.value) || 0)),
                                    })}
                                />
                            </label>
                        </div>
                        <button
                            type="button"
                            className="text-xs font-bold text-red-300 hover:underline"
                            disabled={!enabled}
                            onClick={() => update({ workerGroups: workerGroups.filter((_, i) => i !== index) })}
                        >
                            Remove group
                        </button>
                    </div>
                ))}
            </section>

            <section className="glass-card-sm p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Server className="w-5 h-5 text-plex" />
                        <h4 className="font-bold text-text">Delivery targets</h4>
                    </div>
                    <button
                        type="button"
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-text hover:border-plex/40"
                        disabled={!enabled}
                        onClick={() => update({ deliveryTargets: [...deliveryTargets, emptyDeliveryTarget()] })}
                    >
                        Add target
                    </button>
                </div>
                <p className="text-sm text-muted">
                    After a successful encode, copy or move the finished file into a container path mapped to another Unraid share (for example a Sonarr import drop). Encode stays on this server.
                </p>
                {deliveryTargets.map((target, index) => (
                    <div key={target.id || index} className="space-y-3 rounded-xl border border-border/70 bg-background/30 p-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                Name
                                <input
                                    className={`${fieldClass} mt-2`}
                                    value={target.name}
                                    disabled={!enabled}
                                    onChange={(event) => updateDeliveryTarget(index, { name: event.target.value })}
                                />
                            </label>
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                Container path
                                <input
                                    className={`${fieldClass} mt-2`}
                                    value={target.path}
                                    disabled={!enabled}
                                    placeholder="/exports/sonarr-drop"
                                    onChange={(event) => updateDeliveryTarget(index, { path: event.target.value })}
                                />
                            </label>
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                Mode
                                <div className="mt-2">
                                    <CustomSelect
                                        value={target.mode}
                                        onChange={(mode) => updateDeliveryTarget(index, { mode: mode as 'copy' | 'move' })}
                                        options={[
                                            { value: 'copy', label: 'Copy' },
                                            { value: 'move', label: 'Move' },
                                        ]}
                                    />
                                </div>
                            </label>
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                Naming
                                <div className="mt-2">
                                    <CustomSelect
                                        value={target.namingMode}
                                        onChange={(namingMode) => updateDeliveryTarget(index, {
                                            namingMode: namingMode as 'as-is' | 'sonarr-pattern',
                                        })}
                                        options={[
                                            { value: 'as-is', label: 'As-is (Sonarr renames on import)' },
                                            { value: 'sonarr-pattern', label: 'Sonarr naming pattern' },
                                        ]}
                                    />
                                </div>
                            </label>
                            <label className="block text-xs uppercase tracking-wide font-bold text-muted">
                                Sonarr instance id (optional)
                                <input
                                    className={`${fieldClass} mt-2`}
                                    value={target.sonarrInstanceId || ''}
                                    disabled={!enabled}
                                    placeholder="Default Sonarr instance"
                                    onChange={(event) => updateDeliveryTarget(index, {
                                        sonarrInstanceId: event.target.value.trim() || null,
                                    })}
                                />
                            </label>
                        </div>
                        <SettingsToggleRow
                            title="Enabled"
                            description="Disable to keep the target configured without delivering."
                            checked={target.enabled !== false}
                            onChange={(next) => updateDeliveryTarget(index, { enabled: next })}
                            disabled={!enabled}
                            border={false}
                        />
                        <button
                            type="button"
                            className="text-xs font-bold text-red-300 hover:underline"
                            disabled={!enabled}
                            onClick={() => update({ deliveryTargets: deliveryTargets.filter((_, i) => i !== index) })}
                        >
                            Remove target
                        </button>
                    </div>
                ))}
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="glass-card-sm p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-plex" />
                        <h4 className="font-bold text-text">Webhook Basic Auth</h4>
                    </div>
                    <input
                        className={fieldClass}
                        value={config.auth.username}
                        placeholder="Webhook username"
                        autoComplete="username"
                        onChange={(event) => update({ auth: { ...config.auth, username: event.target.value } })}
                    />
                    <input
                        className={fieldClass}
                        type="password"
                        value={config.auth.password}
                        placeholder="Leave blank to retain saved password"
                        autoComplete="new-password"
                        onChange={(event) => update({ auth: { ...config.auth, password: event.target.value } })}
                    />
                    <p className="text-xs text-muted">
                        Used by Sonarr, Radarr, and Lidarr webhook callers via HTTP Basic Auth at <code className="text-plex">/triggers/media-automation/*</code>.
                        ARR host path rewrites live under{' '}
                        <a className="text-plex hover:underline" href={portalUrl('/settings#scanner')}>Settings → Scanner</a>.
                    </p>
                </div>

                <div className="glass-card-sm p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <Gauge className="w-5 h-5 text-plex" />
                        <h4 className="font-bold text-text">Concurrency</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="block text-xs uppercase tracking-wide font-bold text-muted" htmlFor="media-automation-cpu-concurrency">
                            CPU jobs
                            <ConcurrencyCountInput
                                id="media-automation-cpu-concurrency"
                                value={config.concurrency.cpu}
                                min={0}
                                max={32}
                                onChange={(next) => setConcurrency('cpu', next)}
                            />
                        </label>
                        <label className="block text-xs uppercase tracking-wide font-bold text-muted" htmlFor="media-automation-gpu-concurrency">
                            GPU jobs
                            <ConcurrencyCountInput
                                id="media-automation-gpu-concurrency"
                                value={config.concurrency.gpu}
                                min={0}
                                max={16}
                                onChange={(next) => setConcurrency('gpu', next)}
                            />
                        </label>
                    </div>
                    <p className="text-xs text-muted">
                        CPU and GPU queues are limited independently. Set a lane to 0 to pause new jobs on that lane.
                        {(config.workerGroups || []).some((group) => group.enabled !== false) ? (
                            <span className="mt-1 block text-amber-200/90">
                                Worker groups are enabled — each group’s own GPU concurrency is what the scheduler uses, not this Global GPU jobs value. Set GPU concurrency on the worker group(s) above to 2.
                            </span>
                        ) : (
                            <span className="mt-1 block">Save Settings after changing these, then keep encoding started.</span>
                        )}
                    </p>
                </div>

                <div className="glass-card-sm p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <Cpu className="w-5 h-5 text-plex" />
                        <h4 className="font-bold text-text">Safe fallback</h4>
                    </div>
                    <p className="text-xs text-muted">
                        Global override for every job. Leave Dry run until a sample looks right, then switch to Copy or Replace so pipelines can write. The Media Automation Setup checklist flags this too.
                    </p>
                    <CustomSelect
                        value={config.fallback.hardware}
                        onChange={(hardware) => update({
                            hardwareAcceleration: hardware as HardwareMode,
                            fallback: { ...config.fallback, hardware: hardware as HardwareMode },
                        })}
                        options={[
                            { value: 'cpu', label: 'CPU' },
                            { value: 'auto', label: 'Auto detect' },
                            { value: 'nvenc', label: 'NVIDIA NVENC' },
                            { value: 'qsv', label: 'Intel Quick Sync' },
                            { value: 'intel-vaapi', label: 'Intel VAAPI' },
                            { value: 'vaapi', label: 'AMD VAAPI' },
                        ]}
                    />
                    <CustomSelect
                        value={config.fallback.outputMode}
                        onChange={(outputMode) => {
                            void (async () => {
                                if (outputMode === 'replace') {
                                    const ok = await askConfirm(
                                        'Replace mode permanently overwrites originals after verify. Continue?',
                                        { title: 'Replace originals?', confirmLabel: 'Use Replace', cancelLabel: 'Keep current' },
                                    );
                                    if (!ok) return;
                                }
                                update({
                                    outputMode: outputMode as OutputMode,
                                    fallback: { ...config.fallback, outputMode: outputMode as OutputMode },
                                });
                            })();
                        }}
                        options={[
                            { value: 'dry-run', label: 'Dry run (safest)' },
                            { value: 'copy', label: 'Copy beside source' },
                            { value: 'replace', label: 'Replace source' },
                        ]}
                    />
                    {globalDryRun && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/15 p-3 text-xs text-amber-50">
                            <p className="font-bold">Global dry-run override is ON</p>
                            <p className="mt-1 text-amber-100/90">
                                Every Media Automation job is forced to dry-run, even when a pipeline is set to Copy or Replace. Change Safe fallback to Copy or Replace and save before any real writes.
                            </p>
                        </div>
                    )}
                </div>
            </section>

            <section className="glass-card-sm p-5 space-y-3">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-plex" />
                    <h4 className="font-bold text-text">Custom command allowlist</h4>
                </div>
                <p className="text-sm text-muted">
                    Pipeline <span className="font-semibold text-text">custom-command</span> steps may only run these executable basenames or absolute paths. No shell is used.
                </p>
                <textarea
                    className={`appearance-none text-[16px] leading-5 ${fieldClass} min-h-28 font-mono text-[16px]`}
                    value={(config.customCommandAllowlist || []).join('\n')}
                    placeholder={'ffmpeg\nffprobe'}
                    onChange={(event) => update({
                        customCommandAllowlist: [...new Set(
                            event.target.value
                                .split(/\r?\n/)
                                .map((entry) => entry.trim())
                                .filter(Boolean)
                                .slice(0, 32),
                        )],
                    })}
                />
                <p className="text-xs text-muted">One entry per line. Defaults: ffmpeg, ffprobe. Absolute paths must match exactly.</p>
            </section>

            <section className="glass-card-sm p-5 space-y-3">
                <div className="flex items-center gap-2">
                    <FolderSearch className="w-5 h-5 text-plex" />
                    <h4 className="font-bold text-text">ARR path rewrite</h4>
                </div>
                <p className="text-sm text-muted">
                    Sonarr / Radarr / Lidarr webhooks reuse the same path rewrite rules as Scanner triggers. If ARR reports a host path that differs from the container mount, map it there so Media Automation can resolve files under library roots.
                </p>
                <p className="text-xs text-muted">
                    Configure under <span className="font-semibold text-text">Settings → Scanner</span> on the matching trigger (e.g. <code className="text-plex">sonarr</code> / <code className="text-plex">radarr</code>). Media Automation looks up rewrite by trigger name from the webhook query/body, then falls back to the first trigger for that ARR type.
                </p>
                <p className="text-xs text-muted mt-2">
                    For post-encode Scanner refreshes, use <span className="font-semibold text-text">Settings → Scanner → Media Automation Rewrites</span> (not the ARR triggers).
                </p>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="glass-card-sm p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <FolderSearch className="w-5 h-5 text-plex" />
                        <h4 className="font-bold text-text">Library scan</h4>
                    </div>
                    <SettingsToggleRow
                        title="Enable scheduled library scans"
                        description="Periodically discover media under configured library roots and enqueue matching files."
                        checked={config.libraryScanEnabled !== false}
                        onChange={(libraryScanEnabled) => update({ libraryScanEnabled })}
                        border={false}
                    />
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted" htmlFor="media-automation-scan-interval">
                        Scan interval (minutes)
                        <input
                            id="media-automation-scan-interval"
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={15}
                            max={10080}
                            disabled={config.libraryScanEnabled === false}
                            value={config.libraryScanIntervalMinutes}
                            onChange={(event) => update({
                                libraryScanIntervalMinutes: Math.min(10080, Math.max(15, Number(event.target.value) || 360)),
                            })}
                        />
                    </label>
                </div>
                <div className="glass-card-sm p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <Radar className="w-5 h-5 text-plex" />
                        <h4 className="font-bold text-text">Filesystem watcher</h4>
                    </div>
                    <SettingsToggleRow
                        title="Watch library folders"
                        description="Realtime enqueue for new/changed files. Keep OFF for large or remote Unraid mounts (can stall the portal). Prefer Scan now or ARR webhooks. Also requires Docker env MEDIA_AUTOMATION_ENABLE_WATCH=1."
                        checked={config.libraryWatchEnabled === true}
                        onChange={(libraryWatchEnabled) => update({ libraryWatchEnabled })}
                        border={false}
                    />
                    <label className="block text-xs uppercase tracking-wide font-bold text-muted" htmlFor="media-automation-watch-debounce">
                        Watch debounce (ms)
                        <input
                            id="media-automation-watch-debounce"
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={500}
                            max={120000}
                            disabled={config.libraryWatchEnabled === false}
                            value={config.libraryWatchDebounceMs}
                            onChange={(event) => update({
                                libraryWatchDebounceMs: Math.min(120000, Math.max(500, Number(event.target.value) || 5000)),
                            })}
                        />
                    </label>
                </div>
            </section>

            <p className="text-xs text-muted">
                Save Settings below to apply changes. Use Scan now on the Media Automation dashboard for an immediate library pass.
            </p>
        </div>
    );
};
