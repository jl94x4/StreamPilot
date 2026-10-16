import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowUpToLine,
    CheckCircle2,
    ChevronDown,
    CirclePause,
    CirclePlay,
    Copy,
    Cpu,
    FileBarChart2,
    FolderCog,
    FolderSearch,
    Gauge,
    History,
    Layers3,
    ListRestart,
    Loader2,
    Pencil,
    Play,
    Plus,
    Radar,
    RefreshCw,
    RotateCcw,
    ScanSearch,
    Save,
    ServerCog,
    SkipForward,
    Sparkles,
    Square,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { CustomSelect, SettingsSwitch } from '../shared/ui';
import { ModalPortal } from '../shared/ModalPortal';
import { askConfirm } from '../shared/confirm';
import { ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { portalUrl } from '../shared/basePath';
import { useDiscoverI18n } from '../discovery/i18n';
import type { DiscoverTranslate } from '../discovery/i18n/types';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardStatCard,
    DashboardSubnav,
    dashboardGlowClass,
    dashboardPanelClass,
    dashboardSubnavLinkClass,
} from '../shared/dashboard/DashboardChrome';
import { mediaAutomationApi } from './api';
import { PathBrowserField } from './PathBrowserField';
import { PipelineTemplatePicker } from './PipelineTemplatePicker';
import { MediaAutomationSetupChecklist } from './MediaAutomationSetupChecklist';
import { EncodeControlCard } from './EncodeControlCard';
import { MediaAutomationSystemPanel } from './MediaAutomationSystemPanel';
import { PipelineEditorForm } from './PipelineEditorForm';
import { SavingsAnalyzerPanel } from './SavingsAnalyzerPanel';
import { ReportModal, type ReportModalSeed } from './ReportModal';
import {
    buildEncodeProfilePack,
    downloadEncodeProfilePack,
    parseEncodeProfilePack,
} from './encodeProfilePack';
import {
    countJobsForLibrary,
    libraryPipelineLabel,
    normalizePipelineRules,
    summarizeLibraryOutcome,
    summarizeMatchRules,
    summarizePipelineOutcome,
} from './pipelineUi';
import {
    PIPELINE_PRESETS,
    PIPELINE_STARTER_IDS,
    emptyLibrary,
    emptyPipeline,
    type HardwareMode,
    type MediaAutomationActivity,
    type MediaAutomationCapabilities,
    type MediaAutomationHistoryEntry,
    type MediaAutomationJob,
    type MediaAutomationLibrary,
    type MediaAutomationPipeline,
    type MediaAutomationPipelinePreview,
    type MediaAutomationRuleCondition,
    type MediaAutomationPlan,
    type MediaAutomationStatus,
    type MediaAutomationTab,
    type OutputMode,
} from './types';

const jobProgressPercent = (job: MediaAutomationJob) => {
    if (typeof job.progress === 'number') return job.progress;
    if (job.progress && typeof job.progress === 'object' && Number.isFinite(Number(job.progress.percent))) {
        return Number(job.progress.percent);
    }
    return null;
};

const formatDurationSeconds = (value?: number | null) => {
    if (value == null) return null;
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
};

const jobProgressMeta = (job: MediaAutomationJob | null | undefined) => {
    if (!job?.progress || typeof job.progress !== 'object') {
        return { etaLabel: null as string | null, speedLabel: null as string | null, elapsedLabel: null as string | null, fpsLabel: null as string | null };
    }
    const progress = job.progress;
    const etaLabel = formatDurationSeconds(progress.etaSeconds);
    const speed = Number(progress.speed);
    const speedLabel = Number.isFinite(speed) && speed > 0 ? `${speed.toFixed(2)}x` : null;
    const elapsed = progress.outTimeUs != null && Number(progress.outTimeUs) >= 0
        ? Number(progress.outTimeUs) / 1_000_000
        : null;
    const duration = Number(progress.durationSeconds);
    const elapsedLabel = elapsed != null && Number.isFinite(elapsed)
        ? (Number.isFinite(duration) && duration > 0
            ? `${formatDurationSeconds(elapsed)} / ${formatDurationSeconds(duration)}`
            : formatDurationSeconds(elapsed))
        : null;
    const fps = Number(progress.fps);
    const fpsLabel = Number.isFinite(fps) && fps > 0 ? `${Math.round(fps)} fps` : null;
    return { etaLabel, speedLabel, elapsedLabel, fpsLabel };
};

const jobPlans = (job: MediaAutomationJob | null | undefined): MediaAutomationPlan[] => {
    if (!job?.plan) return [];
    return Array.isArray(job.plan) ? job.plan : [job.plan];
};

const jobLiveCommand = (job: MediaAutomationJob | null | undefined) => {
    if (!job) return '';
    if (job.progress && typeof job.progress === 'object') {
        return String(job.progress.currentCommand || job.progress.command || '');
    }
    const plans = jobPlans(job);
    const first = plans[0];
    if (!first) return '';
    if (Array.isArray(first.args) && first.args.length) {
        return [first.executable || 'ffmpeg', ...first.args].join(' ');
    }
    return '';
};

type MediaProbeSummary = {
    container: string | null;
    videoCodec: string | null;
    videoProfile: string | null;
    resolution: string | null;
    bitDepth: string | null;
    frameRate: string | null;
    bitrateKbps: number | null;
    audioSummary: string | null;
    durationSeconds: number | null;
    sizeBytes: number | null;
    hdrKind: string | null;
};

const probeSummary = (probe: unknown): MediaProbeSummary | null => {
    if (!probe || typeof probe !== 'object') return null;
    const record = probe as { format?: Record<string, unknown>; streams?: Array<Record<string, unknown>> };
    const format = record.format || {};
    const streams = Array.isArray(record.streams) ? record.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audios = streams.filter((stream) => stream.codec_type === 'audio');
    if (!video && streams.length === 0 && Object.keys(format).length === 0) return null;
    const positive = (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const durationSeconds = positive(format.duration) ?? positive(video?.duration);
    const sizeBytes = positive(format.size);
    let bitrateKbps = positive(format.bit_rate) != null ? Number(format.bit_rate) / 1000 : null;
    if (bitrateKbps == null && sizeBytes != null && durationSeconds != null) {
        bitrateKbps = (sizeBytes * 8) / durationSeconds / 1000;
    }
    const width = positive(video?.width);
    const height = positive(video?.height);
    const pixFmt = String(video?.pix_fmt || '');
    const bitsPerSample = positive(video?.bits_per_raw_sample);
    const bitDepth = !video
        ? null
        : (bitsPerSample != null
            ? `${bitsPerSample}-bit`
            : (pixFmt ? (/12/.test(pixFmt) ? '12-bit' : (/10/.test(pixFmt) ? '10-bit' : '8-bit')) : null));
    const frameRate = (() => {
        const raw = String(video?.avg_frame_rate || video?.r_frame_rate || '');
        const [numerator, denominator] = raw.split('/').map(Number);
        if (Number.isFinite(numerator) && Number.isFinite(denominator) && numerator > 0 && denominator > 0) {
            return `${Math.round((numerator / denominator) * 100) / 100} fps`;
        }
        return null;
    })();
    const audioSummary = audios.length
        ? audios.slice(0, 3).map((stream) => `${String(stream.codec_name || 'audio')}${stream.channels ? ` ${stream.channels}ch` : ''}`).join(', ')
            + (audios.length > 3 ? ` +${audios.length - 3} more` : '')
        : null;
    const transfer = String(video?.color_transfer || '').toLowerCase();
    const sideData = Array.isArray(video?.side_data_list) ? video.side_data_list : [];
    const hasDovi = sideData.some((entry) => /dovi|dolby vision/i.test(String((entry as { side_data_type?: string })?.side_data_type || '')))
        || /^dvh/i.test(String(video?.codec_tag_string || ''));
    const hdrKind = !video
        ? null
        : (hasDovi
            ? 'Dolby Vision'
            : (transfer === 'smpte2084'
                ? 'HDR10'
                : (transfer === 'arib-std-b67' ? 'HLG' : null)));
    return {
        container: String(format.format_name || '').split(',')[0] || null,
        videoCodec: video ? (String(video.codec_name || '') || null) : null,
        videoProfile: video ? (String(video.profile || '') || null) : null,
        resolution: width != null && height != null ? `${width}x${height}` : null,
        bitDepth,
        frameRate,
        bitrateKbps,
        audioSummary,
        durationSeconds,
        sizeBytes,
        hdrKind,
    };
};

const jobSourceSummary = (job: MediaAutomationJob | null | undefined) => probeSummary(job?.metadata?.probe);

const jobOutputSummary = (job: MediaAutomationJob | null | undefined) => {
    const result = job?.result;
    if (!result || typeof result !== 'object') return null;
    const output = (result as { output?: { verification?: { metadata?: unknown; size?: number } } }).output;
    const summary = probeSummary(output?.verification?.metadata);
    if (summary && summary.sizeBytes == null) {
        const fallbackSize = Number(output?.verification?.size) || Number((result as { outputBytes?: number }).outputBytes) || 0;
        summary.sizeBytes = fallbackSize > 0 ? fallbackSize : null;
    }
    return summary;
};

const formatMediaBytes = (value?: number | null) => {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
    return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
};

const formatBitrate = (kbps: number | null) => {
    if (kbps == null || !Number.isFinite(kbps) || kbps <= 0) return null;
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
    return `${Math.round(kbps)} kbps`;
};

const jobIsDryRun = (job: MediaAutomationJob | null | undefined) => {
    if (!job) return false;
    if (job.result && typeof job.result === 'object' && job.result.dryRun === true) return true;
    const pipeline = job.metadata?.pipeline;
    if (pipeline && typeof pipeline === 'object' && (pipeline as { outputMode?: string }).outputMode === 'dry-run') {
        return true;
    }
    return false;
};

/** Compact before→after line for completed (non-dry-run) queue rows. */
const jobQueueOutcomeSummary = (job: MediaAutomationJob | null | undefined) => {
    if (!job) return null;
    const state = String(job.state || job.status || '').toLowerCase();
    if (!['completed', 'succeeded', 'success', 'done', 'skipped'].includes(state)) return null;
    if (jobIsDryRun(job)) return null;

    const result = job.result && typeof job.result === 'object'
        ? job.result as {
            skipped?: boolean | string;
            reason?: string;
            sourceBytes?: number;
            outputBytes?: number;
            bytesSaved?: number;
        }
        : null;
    const skipReason = result?.skipped === true
        ? String(result.reason || 'skipped')
        : (typeof result?.skipped === 'string' && result.skipped
            ? String(result.skipped)
            : (state === 'skipped' ? String(result?.reason || 'skipped') : ''));
    if (skipReason) {
        return { skipped: true as const, skipReason, codecLine: null, sizeLine: null, savedLine: null, savingsPercent: null };
    }
    if (!['completed', 'succeeded', 'success', 'done'].includes(state)) return null;

    const before = jobSourceSummary(job);
    const after = jobOutputSummary(job);
    const sourceBytes = Number(result?.sourceBytes || 0) || before?.sizeBytes || 0;
    const outputBytes = Number(result?.outputBytes || 0) || after?.sizeBytes || 0;
    const reportedSaved = Number(result?.bytesSaved);
    const savedBytes = Number.isFinite(reportedSaved) && reportedSaved > 0
        ? reportedSaved
        : (sourceBytes > 0 && outputBytes > 0 ? Math.max(0, sourceBytes - outputBytes) : 0);
    const savingsPercent = sourceBytes > 0 && outputBytes > 0
        ? Math.round((1 - outputBytes / sourceBytes) * 1000) / 10
        : null;

    const codecFrom = before?.videoCodec ? String(before.videoCodec).toUpperCase() : null;
    const codecTo = after?.videoCodec ? String(after.videoCodec).toUpperCase() : null;
    const sizeFrom = formatMediaBytes(sourceBytes);
    const sizeTo = formatMediaBytes(outputBytes);
    const codecLine = codecFrom && codecTo
        ? (codecFrom === codecTo ? codecFrom : `${codecFrom} → ${codecTo}`)
        : (codecTo || codecFrom);
    const sizeLine = sizeFrom && sizeTo
        ? `${sizeFrom} → ${sizeTo}`
        : (sizeFrom || sizeTo);
    const savedLine = formatMediaBytes(savedBytes);

    if (!codecLine && !sizeLine && !savedLine) return null;
    return { skipped: false as const, skipReason: null, codecLine, sizeLine, savedLine, savingsPercent };
};

/** Source → output size for persisted history rows. */
const historySizeSummary = (entry: { sourceBytes?: number; outputBytes?: number; bytesSaved?: number }, t: DiscoverTranslate) => {
    const sourceBytes = Number(entry.sourceBytes || 0);
    const outputBytes = Number(entry.outputBytes || 0);
    const savedBytes = Number(entry.bytesSaved) || (sourceBytes > 0 && outputBytes > 0 ? Math.max(0, sourceBytes - outputBytes) : 0);
    const sizeLine = sourceBytes > 0 && outputBytes > 0
        ? `${formatMediaBytes(sourceBytes)} → ${formatMediaBytes(outputBytes)}`
        : (sourceBytes > 0
            ? t('mediaAutomation.history.sizeIn', { value: formatMediaBytes(sourceBytes) })
            : (outputBytes > 0 ? t('mediaAutomation.history.sizeOut', { value: formatMediaBytes(outputBytes) }) : null));
    if (!sizeLine) return null;
    const savedLine = savedBytes > 0 ? formatMediaBytes(savedBytes) : null;
    const savingsPercent = sourceBytes > 0 && outputBytes > 0 && savedBytes > 0
        ? Math.round((savedBytes / sourceBytes) * 1000) / 10
        : null;
    return { sizeLine, savedLine, savingsPercent };
};

const formatSkipReasonLabel = (reason?: string | null) => {
    const raw = String(reason || 'skipped').trim();
    if (!raw) return 'skipped';
    return raw.replace(/-/g, ' ');
};

const SKIP_REASON_CHIP_CLASS: Record<string, string> = {
    'below-savings-estimate': 'border-amber-500/40 bg-amber-500/15 text-amber-100',
    'below-reclaim-estimate': 'border-amber-500/40 bg-amber-500/15 text-amber-100',
    'insufficient-savings': 'border-amber-500/40 bg-amber-500/15 text-amber-100',
    'too-small': 'border-sky-500/40 bg-sky-500/15 text-sky-100',
    'too-new': 'border-sky-500/40 bg-sky-500/15 text-sky-100',
    'bitrate-too-low': 'border-sky-500/40 bg-sky-500/15 text-sky-100',
    'sample-rejected': 'border-amber-500/40 bg-amber-500/15 text-amber-100',
    'watch-score': 'border-violet-500/40 bg-violet-500/15 text-violet-100',
    'recently-watched': 'border-violet-500/40 bg-violet-500/15 text-violet-100',
    'season-incomplete': 'border-violet-500/40 bg-violet-500/15 text-violet-100',
    'audio-requires-hevc': 'border-violet-500/40 bg-violet-500/15 text-violet-100',
    'quality-regression': 'border-red-500/40 bg-red-500/15 text-red-100',
    'denied-path': 'border-red-500/40 bg-red-500/15 text-red-100',
};

const skipReasonChipClass = (reason?: string | null) => (
    SKIP_REASON_CHIP_CLASS[String(reason || '')]
    || 'border-border/70 bg-background/40 text-muted'
);

const jobDryRunReason = (job: MediaAutomationJob | null | undefined) => {
    if (!jobIsDryRun(job) || !job?.result || typeof job.result !== 'object') return '';
    const reason = String(job.result.dryRunReason || '');
    if (reason === 'global-safe-fallback') {
        return 'Blocked by Settings → Media Automation → Safe fallback (Dry run). Change that to Copy or Replace, save, then re-queue.';
    }
    if (reason === 'pipeline-output-mode') {
        return 'Pipeline output mode is still Dry run. Edit the pipeline, set Copy or Replace, save, then re-queue.';
    }
    return 'Planned only - FFmpeg was not run and no files were written.';
};

const jobErrorText = (error: MediaAutomationJob['error']) => {
    if (!error) return '';
    if (typeof error === 'string') return error;
    return error.message || error.code || '';
};

const jobErrorStderr = (error: MediaAutomationJob['error']) => {
    if (!error || typeof error === 'string') return '';
    return String(error.stderr || '');
};

const pathDirname = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.slice(0, idx) : normalized;
};

const confirmReplaceOutputMode = () => askConfirm(
    'Replace mode atomically promotes verified output over the source file. '
    + 'The original is moved to quarantine after verify. Continue?',
    { title: 'Replace original files?', confirmLabel: 'Use Replace', cancelLabel: 'Keep current mode' },
);

const workerStatusLabel = (workerStatus: MediaAutomationStatus) => {
    if (workerStatus.autoPausedForQueueDepth || String(workerStatus.workerState || '').toLowerCase() === 'auto-paused') {
        return 'Auto-paused (queue depth)';
    }
    if ((workerStatus.workerPaused ?? workerStatus.paused) !== false) {
        return 'Paused (queue only)';
    }
    if (String(workerStatus.workerState || workerStatus.state || '').toLowerCase() === 'running') {
        return 'Encoding';
    }
    return asText(workerStatus.workerState || workerStatus.state, 'stopped');
};

type ScanNowResponse = {
    wouldEnqueue?: number;
    wouldSkip?: number;
    enqueued?: number;
    skipped?: number;
    discovered?: number;
    preview?: boolean;
    planOnly?: boolean;
    result?: MediaAutomationStatus['lastScanResult'];
    status?: MediaAutomationStatus;
    skippedDetails?: Array<{ filePath?: string; reason?: string; videoCodec?: string | null }>;
    sampleSkips?: Array<{ filePath?: string; reason?: string; videoCodec?: string | null }>;
};

const jobFinalPath = (job: MediaAutomationJob | null | undefined) => {
    if (!job) return '';
    const result = job.result;
    if (result && typeof result === 'object') {
        const output = (result as { output?: { finalPath?: string } }).output;
        if (output?.finalPath) return String(output.finalPath);
        if ((result as { finalPath?: string }).finalPath) return String((result as { finalPath?: string }).finalPath);
    }
    return String(job.outputPath || '');
};

const jobStateValue = (job: MediaAutomationJob) => String(job.state || job.status || '').toLowerCase();
const jobStatusLabel = (value: unknown, t: (key: string) => string) => {
    const state = String(value || '').toLowerCase();
    const key = ({ queued: 'queued', pending: 'pending', waiting: 'waiting', running: 'running', active: 'active', processing: 'processing', paused: 'paused', retrying: 'retrying', completed: 'completed', failed: 'failed', skipped: 'skipped', cancelling: 'cancelling' } as Record<string, string>)[state];
    return key ? t(`mediaAutomation.status.jobs.${key}`) : String(value || '');
};
const isTerminalJob = (job: MediaAutomationJob) => (
    ['completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'success'].includes(jobStateValue(job))
);
const isCancellableJob = (job: MediaAutomationJob) => !isTerminalJob(job) && !job.cancelRequested;
const isCancelPendingJob = (job: MediaAutomationJob) => !isTerminalJob(job) && !!job.cancelRequested;
const pathBasename = (value: string) => {
    const parts = value.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || value;
};

/** Whole-library folder names that usually mean “scan everything under here”. */
const BROAD_LIBRARY_BASENAMES = new Set([
    'media', 'movies', 'movie', 'films', 'film', 'tv', 'tvs', 'shows', 'show',
    'television', 'series', 'anime', 'music', 'videos', 'video', 'library',
    'tv shows', 'tv-shows', 'tv_shows', 'tvshows',
]);

const SEASON_FOLDER_RE = /^(season[\s._-]?\d+|specials|extras)$/i;

/** Pull "Love Island All Stars (2024)" from episode filenames. */
const parseSeriesNameFromFile = (fileName: string) => {
    const base = String(fileName || '').replace(/\.[^.]+$/, '');
    // Prefer titles that already include (YYYY) before SxxExx.
    const withYear = base.match(/^(.*?\(\d{4}\))[\s._-]+[Ss](\d{1,4})[Ee](\d{1,4})\b/);
    if (withYear) {
        return withYear[1].replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
    }
    const match = base.match(/^(.*?)[\s._-]+[Ss](\d{1,4})[Ee](\d{1,4})\b/);
    if (!match) return null;
    const name = match[1].replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
    return name || null;
};

/** Sonarr-style relative path under a library root (falls back to absolute). */
const toDisplayPath = (
    fullPath: string,
    {
        relative = false,
        libraryRoot,
        libraryRoots = [],
        libraryId,
        libraries = [],
    }: {
        relative?: boolean;
        libraryRoot?: string | null;
        libraryRoots?: string[];
        libraryId?: string | number | null;
        libraries?: Array<{ id?: string | number; rootPath?: string }>;
    } = {},
) => {
    const abs = String(fullPath || '').trim();
    if (!abs) return '';
    if (!relative) return abs;
    const normalized = abs.replace(/\\/g, '/');
    const normalizeRoot = (root: string) => String(root || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const catalogRoot = libraryId != null
        ? normalizeRoot(String(libraries.find((library) => String(library.id) === String(libraryId))?.rootPath || ''))
        : '';
    // Prefer the mapped library root (e.g. /media/TV SHOWS) so show folders stay visible.
    // job.libraryRoot can be deeper and would incorrectly strip the series name.
    const roots = [
        catalogRoot,
        ...libraryRoots.map(normalizeRoot),
        normalizeRoot(String(libraryRoot || '')),
    ].filter(Boolean);
    const seen = new Set<string>();
    const uniqueRoots = roots.filter((root) => {
        const key = root.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    // Prefer the catalog root when it matches; otherwise longest configured match.
    const ordered = catalogRoot
        ? [catalogRoot, ...uniqueRoots.filter((root) => root.toLowerCase() !== catalogRoot.toLowerCase())
            .sort((left, right) => right.length - left.length)]
        : [...uniqueRoots].sort((left, right) => right.length - left.length);

    let relativePath = abs;
    for (const root of ordered) {
        const rootLower = root.toLowerCase();
        const pathLower = normalized.toLowerCase();
        if (pathLower === rootLower) {
            relativePath = '.';
            break;
        }
        if (pathLower.startsWith(`${rootLower}/`)) {
            relativePath = normalized.slice(root.length + 1);
            break;
        }
    }
    if (!relativePath || relativePath === '.' || relativePath === abs) return relativePath;

    const parts = relativePath.split('/').filter(Boolean);
    // Drop leading junk like media/ when the real layout is media/Season 13/file.mkv
    while (
        parts.length >= 2
        && BROAD_LIBRARY_BASENAMES.has(parts[0].toLowerCase())
        && SEASON_FOLDER_RE.test(parts[1])
    ) {
        parts.shift();
    }

    if (parts.length >= 1 && SEASON_FOLDER_RE.test(parts[0])) {
        const absParts = normalized.split('/').filter(Boolean);
        const relJoined = parts.join('/');
        // Find the Season folder in the absolute path that lines up with this relative tail.
        let seasonAt = -1;
        for (let i = 0; i < absParts.length; i += 1) {
            if (!SEASON_FOLDER_RE.test(absParts[i])) continue;
            if (absParts.slice(i).join('/').toLowerCase() === relJoined.toLowerCase()) {
                seasonAt = i;
                break;
            }
        }
        if (seasonAt < 0) seasonAt = Math.max(0, absParts.length - parts.length);
        // Prefer a real series folder (often includes the year) over parsing the filename.
        for (let i = seasonAt - 1; i >= 0; i -= 1) {
            const candidate = absParts[i];
            if (!candidate) continue;
            if (BROAD_LIBRARY_BASENAMES.has(candidate.toLowerCase())) continue;
            if (SEASON_FOLDER_RE.test(candidate)) continue;
            return [candidate, ...parts].join('/');
        }
        const fromFile = parseSeriesNameFromFile(parts[parts.length - 1] || '');
        if (fromFile) return [fromFile, ...parts].join('/');
    }
    return parts.join('/');
};

/** True when a library root looks like an entire media tree, not a show/season folder. */
const isBroadLibraryRoot = (rootPath: string) => {
    const normalized = String(rootPath || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized) return false;
    const segments = normalized.split('/').filter(Boolean);
    // Drop Windows drive letter so D:/Media counts as depth 1.
    const meaningful = segments[0] && /^[A-Za-z]:$/.test(segments[0]) ? segments.slice(1) : segments;
    if (meaningful.length === 0) return true;

    const base = meaningful[meaningful.length - 1];
    const baseLower = base.toLowerCase();

    // Season/specials folders are intentionally narrow — not whole-library roots.
    if (SEASON_FOLDER_RE.test(base)) return false;

    // Three or more folders deep is almost always a show/season path.
    if (meaningful.length >= 3) return false;

    // Single segment: broad only for known library container names (/media, /movies).
    if (meaningful.length === 1) {
        return BROAD_LIBRARY_BASENAMES.has(baseLower);
    }

    // Two segments: broad when the leaf is a library container (/media/tv, /data/movies).
    // Show folders under a generic parent (/media/Love Island) are narrow on purpose.
    if (meaningful.length === 2) {
        return BROAD_LIBRARY_BASENAMES.has(baseLower);
    }

    return false;
};

const confirmBroadLibrarySave = async (rootPath: string) => {
    if (!isBroadLibraryRoot(rootPath)) return true;
    return askConfirm(
        `This root looks like a whole library:\n\n${rootPath}\n\n`
        + 'Scans will walk everything under it and queue matching files for encode. '
        + 'Prefer a narrower folder (one show/season) if you only meant a small test.\n\n'
        + 'Save this library root anyway?',
        { title: 'Broad library root', confirmLabel: 'Save anyway', cancelLabel: 'Go back' },
    );
};

const confirmBroadLibraryScan = async (roots: string[]) => {
    const broad = roots.filter(isBroadLibraryRoot);
    if (!broad.length) return true;
    const listed = broad.slice(0, 8).join('\n');
    const extra = broad.length > 8 ? `\n…and ${broad.length - 8} more` : '';
    return askConfirm(
        'Scan will walk broad library root(s) and may queue a lot of files:\n\n'
        + `${listed}${extra}\n\n`
        + 'Encoding still needs Start if the worker is paused, but the queue can fill quickly.\n\n'
        + 'Run Scan now anyway?',
        { title: 'Scan broad libraries?', confirmLabel: 'Scan now', cancelLabel: 'Cancel' },
    );
};

const fieldClass = 'w-full appearance-none rounded-lg border border-white/10 bg-background/70 px-3 py-2.5 text-[16px] leading-5 text-text placeholder:text-muted/60 outline-none transition focus:border-plex focus:ring-1 focus:ring-plex';
const panelClass = dashboardPanelClass;
const listCardClass = 'rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent shadow-xl transition hover:border-plex/40';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40';
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-3 py-2 text-sm font-bold text-background transition hover:bg-plex-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40';

const asText = (value: unknown, fallback = '-') => value === undefined || value === null || value === '' ? fallback : String(value);

const historyEntryToJobClient = (entry: MediaAutomationHistoryEntry): MediaAutomationJob => {
    const sourcePath = String(entry.sourcePath || '');
    const state = String(entry.state || 'succeeded');
    return {
        id: entry.id,
        sourcePath,
        path: sourcePath,
        pipelineId: entry.pipelineId ?? undefined,
        pipelineName: entry.pipelineName || '',
        libraryId: entry.libraryId ?? null,
        state,
        status: state,
        phase: state,
        lane: entry.lane === 'gpu' ? 'gpu' : 'cpu',
        createdAt: entry.createdAt || undefined,
        startedAt: entry.startedAt || undefined,
        finishedAt: entry.finishedAt || undefined,
        completedAt: entry.finishedAt || undefined,
        error: entry.error || undefined,
        archived: true,
        metadata: {
            tags: Array.isArray(entry.tags) ? entry.tags : [],
            fromHistory: true,
        },
        result: {
            sourceBytes: Number(entry.sourceBytes || 0) || 0,
            outputBytes: Number(entry.outputBytes || 0) || 0,
            bytesSaved: Number(entry.bytesSaved || 0) || 0,
            durationMs: Number(entry.durationMs || 0) || 0,
            adapter: entry.adapter || null,
            adapterLabel: entry.adapterLabel || null,
            dryRun: entry.dryRun === true,
            delivery: entry.delivery || null,
            output: {
                finalPath: entry.finalPath || null,
                quarantinedPath: entry.quarantinedPath || null,
            },
        },
    };
};
const formatTime = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};
const createRuleCondition = (): MediaAutomationRuleCondition => ({
    id: `condition-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    field: 'videoCodec',
    operator: 'equals',
    value: '',
});
const normalizeRules = normalizePipelineRules;
const MEDIA_AUTOMATION_TABS: MediaAutomationTab[] = ['overview', 'queue', 'pipelines', 'libraries', 'analyzer', 'history', 'system', 'activity'];
const ACTIVITY_PAGE_SIZE_OPTIONS = [20, 50, 75, 100] as const;
const ACTIVITY_PAGE_SIZE_KEY = 'media-automation-activity-page-size';
const QUEUE_PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 200] as const;
const QUEUE_PAGE_SIZE_KEY = 'media-automation-queue-page-size';
const RELATIVE_PATHS_KEY = 'media-automation-relative-paths';
const QUEUE_JOBS_FETCH_LIMIT = 1000;
const QUEUE_FILTER_KEY = 'media-automation.queueFilters';
const QUEUE_FILTER_IDS = ['active', 'queued', 'dry-run', 'failed', 'completed'] as const;
type QueueFilterId = typeof QUEUE_FILTER_IDS[number];
type QueueViewFilter = 'all' | QueueFilterId;

const isQueueFilterId = (value: string): value is QueueFilterId => (
    (QUEUE_FILTER_IDS as readonly string[]).includes(value)
);

const readQueueViewFilter = (): QueueViewFilter => {
    try {
        const raw = localStorage.getItem(QUEUE_FILTER_KEY);
        if (!raw) return 'all';
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'string') {
            return parsed === 'all' || isQueueFilterId(parsed) ? parsed : 'all';
        }
        // Legacy multi-select: one choice → that tab; otherwise treat as All.
        if (Array.isArray(parsed)) {
            const valid = parsed.filter((entry): entry is QueueFilterId => typeof entry === 'string' && isQueueFilterId(entry));
            if (valid.length === 1) return valid[0];
            return 'all';
        }
        return 'all';
    } catch {
        return 'all';
    }
};

const writeQueueViewFilter = (filter: QueueViewFilter) => {
    try {
        localStorage.setItem(QUEUE_FILTER_KEY, JSON.stringify(filter));
    } catch {
        // ignore quota / private mode
    }
};

const ACTIVE_QUEUE_STATES = new Set([
    'running', 'processing', 'active', 'probing', 'planning', 'planned', 'verifying', 'committing',
]);
const COMPLETED_QUEUE_STATES = new Set(['completed', 'succeeded', 'success', 'done']);
const FAILED_QUEUE_STATES = new Set(['failed', 'error', 'cancelled', 'canceled']);

const jobMatchesQueueFilter = (job: MediaAutomationJob, filterId: QueueFilterId) => {
    const state = jobStateValue(job);
    const dryRunJob = jobIsDryRun(job);
    if (filterId === 'dry-run') return dryRunJob;
    if (filterId === 'queued') return state === 'queued' || state === 'pending' || state === 'waiting';
    if (filterId === 'active') return ACTIVE_QUEUE_STATES.has(state);
    if (filterId === 'failed') return FAILED_QUEUE_STATES.has(state);
    if (filterId === 'completed') return COMPLETED_QUEUE_STATES.has(state);
    return false;
};

/** Lower = higher in the queue list. Completed sinks to the bottom on All. */
const queueListSortRank = (job: MediaAutomationJob) => {
    const state = jobStateValue(job);
    if (ACTIVE_QUEUE_STATES.has(state) || job.cancelRequested) return 0;
    if (state === 'queued' || state === 'pending' || state === 'waiting') return 1;
    if (FAILED_QUEUE_STATES.has(state)) return 2;
    if (jobIsDryRun(job)) return 3;
    if (COMPLETED_QUEUE_STATES.has(state)) return 4;
    return 3;
};

const readActivityPageSize = (): typeof ACTIVITY_PAGE_SIZE_OPTIONS[number] => {
    try {
        const raw = Number(localStorage.getItem(ACTIVITY_PAGE_SIZE_KEY));
        return ACTIVITY_PAGE_SIZE_OPTIONS.includes(raw as typeof ACTIVITY_PAGE_SIZE_OPTIONS[number])
            ? (raw as typeof ACTIVITY_PAGE_SIZE_OPTIONS[number])
            : 20;
    } catch {
        return 20;
    }
};

const readQueuePageSize = (): typeof QUEUE_PAGE_SIZE_OPTIONS[number] => {
    try {
        const raw = Number(localStorage.getItem(QUEUE_PAGE_SIZE_KEY));
        return QUEUE_PAGE_SIZE_OPTIONS.includes(raw as typeof QUEUE_PAGE_SIZE_OPTIONS[number])
            ? (raw as typeof QUEUE_PAGE_SIZE_OPTIONS[number])
            : 50;
    } catch {
        return 50;
    }
};

const readRelativePathsPref = (): boolean => {
    try {
        const raw = localStorage.getItem(RELATIVE_PATHS_KEY);
        if (raw == null) return true;
        return raw === '1' || raw === 'true';
    } catch {
        return true;
    }
};

const parseMediaAutomationTab = (hash = typeof window !== 'undefined' ? window.location.hash : ''): MediaAutomationTab => {
    const raw = String(hash || '').replace(/^#/, '').split(/[/?&]/)[0].trim().toLowerCase();
    return MEDIA_AUTOMATION_TABS.includes(raw as MediaAutomationTab)
        ? (raw as MediaAutomationTab)
        : 'overview';
};

const mediaAutomationTabHash = (tab: MediaAutomationTab) => (tab === 'overview' ? '' : `#${tab}`);

const writeMediaAutomationTabHash = (tab: MediaAutomationTab) => {
    if (typeof window === 'undefined') return;
    const desired = mediaAutomationTabHash(tab);
    if ((window.location.hash || '') === desired) return;
    const next = `${window.location.pathname}${window.location.search}${desired}`;
    window.history.replaceState(null, '', next);
};
const statusTone = (status?: string) => {
    const value = String(status || '').toLowerCase();
    if (['dry-run', 'dry run', 'planned'].some((key) => value.includes(key))) {
        return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    }
    if (['completed', 'succeeded', 'ready', 'running', 'online', 'healthy', 'success', 'processing', 'committing', 'verifying', 'enabled'].some((key) => value.includes(key))) {
        return 'border-green-500/30 bg-green-500/10 text-green-300';
    }
    if (['failed', 'error', 'offline', 'stopped', 'cancelled', 'canceled', 'disabled'].some((key) => value.includes(key))) {
        return 'border-red-500/30 bg-red-500/10 text-red-300';
    }
    if (['cancelling', 'canceling'].some((key) => value.includes(key))) {
        return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    }
    if (['paused', 'queued', 'pending', 'probing', 'planning'].some((key) => value.includes(key))) {
        return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    }
    return 'border-white/10 bg-white/5 text-muted';
};

const StatusPill: React.FC<{ value?: string; size?: 'sm' | 'md' }> = ({ value, size = 'sm' }) => {
    const label = value || 'unknown';
    const completed = ['completed', 'succeeded', 'success', 'dry-run', 'dry run'].some((key) => (
        String(label).toLowerCase().includes(key)
    ));
    return (
        <span
            className={`inline-flex items-center justify-center gap-1 border font-bold uppercase tracking-wide ${
                size === 'md'
                    ? 'rounded-xl px-3 py-2 text-sm font-semibold'
                    : 'rounded-full px-2.5 py-1 text-[11px]'
            } ${statusTone(value)}`}
        >
            {completed ? <CheckCircle2 className={size === 'md' ? 'h-4 w-4' : 'h-3 w-3'} /> : null}
            {label}
        </span>
    );
};

/** Soft left rail so finished jobs read as done / failed / cancelled at a glance. */
const terminalJobCardTone = (job: MediaAutomationJob) => {
    if (!isTerminalJob(job)) return '';
    const state = jobStateValue(job);
    if (jobIsDryRun(job) && ['completed', 'succeeded', 'success'].includes(state)) {
        return 'border-l-2 border-l-amber-400/70 bg-amber-500/[0.04]';
    }
    if (['failed', 'error'].includes(state)) {
        return 'border-l-2 border-l-red-400/70 bg-red-500/[0.05]';
    }
    if (['cancelled', 'canceled'].includes(state)) {
        return 'border-l-2 border-l-white/25 bg-white/[0.02]';
    }
    return 'border-l-2 border-l-emerald-400/80 bg-emerald-500/[0.06]';
};

const statGlowFromTone = (tone: string) => {
    if (tone.includes('amber')) return dashboardGlowClass('amber');
    if (tone.includes('sky')) return dashboardGlowClass('sky');
    if (tone.includes('emerald')) return dashboardGlowClass('emerald');
    if (tone.includes('red')) return dashboardGlowClass('rose');
    if (tone.includes('plex')) return dashboardGlowClass('plex');
    return dashboardGlowClass('muted');
};

const StatCard: React.FC<{
    label: string;
    value: React.ReactNode;
    hint?: string;
    icon: React.ReactNode;
    tone: string;
}> = ({ label, value, hint, icon, tone }) => (
    <DashboardStatCard
        label={label}
        value={value}
        hint={hint}
        icon={icon}
        glow={statGlowFromTone(tone)}
    />
);

const GPU_ADAPTER_IDS = ['nvenc', 'qsv', 'intel-vaapi', 'vaapi'] as const;

/** Hardware modes actually configured in settings / pipelines (not every probe result). */
const collectConfiguredHardware = (
    status: MediaAutomationStatus,
    pipelines: MediaAutomationPipeline[],
): Set<string> => {
    const modes = new Set<string>();
    const add = (value: unknown) => {
        const mode = String(value || '').toLowerCase();
        if (['auto', 'cpu', 'nvenc', 'qsv', 'intel-vaapi', 'vaapi'].includes(mode)) modes.add(mode);
    };
    add(status.hardwareAcceleration);
    add(status.fallbackHardware);
    for (const pipeline of pipelines) {
        add(pipeline.hardware);
        add((pipeline as { hardwareAcceleration?: string }).hardwareAcceleration);
    }
    if (modes.size === 0) modes.add('auto');
    return modes;
};

const adapterRelevantToConfig = (adapterId: string, configured: Set<string>) => {
    if (configured.has(adapterId)) return true;
    // "auto" prefers any working GPU - only treat adapters as relevant when none are up yet
    // (handled separately). Explicit cpu-only configs never care about GPU probe failures.
    return false;
};

const jobHardwareInfo = (job: MediaAutomationJob | null | undefined) => {
    if (!job) return null;
    const plans = jobPlans(job);
    const planAdapter = plans.map((plan) => plan.adapter).find(Boolean) || null;
    const planLabel = plans.map((plan) => plan.adapterLabel).find(Boolean) || null;
    const progress = job.progress && typeof job.progress === 'object' ? job.progress : null;
    const result = job.result && typeof job.result === 'object' ? job.result : null;
    const adapter = String(progress?.adapter || result?.adapter || planAdapter || '').toLowerCase() || null;
    const fallbackMeta = result?.hardwareFallback && typeof result.hardwareFallback === 'object'
        ? result.hardwareFallback as { requested?: string }
        : null;
    const fallback = !!(progress?.hardwareFallback || fallbackMeta);
    const requested = String(progress?.requestedHardware || fallbackMeta?.requested || '').toLowerCase();
    if (adapter) {
        const labels: Record<string, string> = {
            cpu: fallback ? 'CPU fallback' : 'CPU',
            nvenc: 'NVENC',
            qsv: 'Intel QSV',
            'intel-vaapi': 'Intel VAAPI',
            vaapi: 'AMD VAAPI',
        };
        return {
            adapter,
            label: String(progress?.adapterLabel || result?.adapterLabel || planLabel || labels[adapter] || adapter.toUpperCase()),
            fallback,
            requested: requested || null,
            pending: false,
            isGpu: adapter !== 'cpu',
        };
    }
    const lane = String(job.lane || '').toLowerCase();
    if (lane === 'gpu') {
        return { adapter: null, label: 'GPU lane', fallback: false, requested: null, pending: true, isGpu: true };
    }
    if (lane === 'cpu') {
        return { adapter: 'cpu', label: 'CPU', fallback: false, requested: null, pending: true, isGpu: false };
    }
    return null;
};

const HardwareBadge: React.FC<{ job: MediaAutomationJob }> = ({ job }) => {
    const info = jobHardwareInfo(job);
    if (!info) return null;
    const tone = info.fallback
        ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
        : info.isGpu
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
            : 'border-sky-500/40 bg-sky-500/15 text-sky-200';
    const title = info.fallback
        ? `Requested ${info.requested || 'GPU'} but fell back to CPU`
        : info.pending
            ? `${info.label} - encoder chosen when the job starts`
            : `Using ${info.label}`;
    return (
        <span
            title={title}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tone}`}
        >
            <Cpu className="h-3 w-3" />
            {info.label}
        </span>
    );
};

const jobProfileLabel = (
    job: MediaAutomationJob | null | undefined,
    pipelines: MediaAutomationPipeline[] = [],
) => {
    if (!job) return 'Automatic';

    const pipelineId = job.pipelineId != null ? String(job.pipelineId).trim() : '';
    // Prefer the live catalog name so renames update existing queue/history pills.
    if (pipelineId) {
        const match = pipelines.find((pipeline) => String(pipeline.id ?? '') === pipelineId);
        const resolved = String(match?.name || '').trim();
        if (resolved) return resolved;
    }

    const direct = String(job.pipelineName || '').trim();
    if (direct && !/^[0-9a-f-]{8,}$/i.test(direct)) return direct;

    const metaPipeline = job.metadata?.pipeline;
    const metaName = metaPipeline && typeof metaPipeline === 'object'
        ? String((metaPipeline as { name?: string }).name || '').trim()
        : '';
    if (metaName) return metaName;

    if (pipelineId) {
        if (/^[0-9a-f-]{8,}$/i.test(pipelineId)) return 'Unknown profile';
        return `Pipeline ${pipelineId}`;
    }
    return 'Automatic';
};

/** Third queue pill: which encode profile / pipeline this job is using. */
const ProfileBadge: React.FC<{ job: MediaAutomationJob; pipelines?: MediaAutomationPipeline[] }> = ({
    job,
    pipelines = [],
}) => {
    const label = jobProfileLabel(job, pipelines);
    return (
        <span
            title={`Encode profile: ${label}`}
            className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-plex/35 bg-plex/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-plex"
        >
            <Layers3 className="h-3 w-3 shrink-0" />
            <span className="truncate normal-case tracking-normal">{label}</span>
        </span>
    );
};

const EmptyState: React.FC<{
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    detail: string;
    actionLabel?: string;
    onAction?: () => void;
}> = ({ icon: Icon, title, detail, actionLabel, onAction }) => (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-6 py-10 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-plex/30 bg-plex/10">
            <Icon className="h-6 w-6 text-plex" />
        </div>
        <h3 className="text-lg font-bold tracking-tight text-text">{title}</h3>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">{detail}</p>
        {actionLabel && onAction ? (
            <button type="button" className={`${primaryButtonClass} mt-5`} onClick={onAction}>
                {actionLabel}
            </button>
        ) : null}
    </div>
);

const EditorShell: React.FC<{ title: string; onClose: () => void; onSave: () => void; saving: boolean; children: React.ReactNode }> = ({
    title,
    onClose,
    onSave,
    saving,
    children,
}) => (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
        <div className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl custom-scrollbar sm:max-w-3xl sm:rounded-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur-md">
                <h2 className="text-lg font-bold text-text">{title}</h2>
                <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text" onClick={onClose}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-5 p-5">{children}</div>
            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-border bg-card/95 px-5 py-4 backdrop-blur-md">
                <button type="button" className={buttonClass} onClick={onClose}>Cancel</button>
                <button type="button" className={primaryButtonClass} onClick={onSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
            </div>
        </div>
    </div>
);

export const MediaAutomationDashboard: React.FC = () => {
    const { t } = useDiscoverI18n();
    const [tab, setTab] = useState<MediaAutomationTab>(() => parseMediaAutomationTab());
    const [status, setStatus] = useState<MediaAutomationStatus>({});
    const [capabilities, setCapabilities] = useState<MediaAutomationCapabilities>({});
    const [jobs, setJobs] = useState<MediaAutomationJob[]>([]);
    const [activity, setActivity] = useState<MediaAutomationActivity[]>([]);
    const [libraries, setLibraries] = useState<MediaAutomationLibrary[]>([]);
    const [pipelines, setPipelines] = useState<MediaAutomationPipeline[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [unavailable, setUnavailable] = useState<string[]>([]);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [enqueuePath, setEnqueuePath] = useState('');
    const [enqueuePipelineId, setEnqueuePipelineId] = useState('');
    const [libraryDraft, setLibraryDraft] = useState<MediaAutomationLibrary | null>(null);
    const [pipelineDraft, setPipelineDraft] = useState<MediaAutomationPipeline | null>(null);
    const [previewResult, setPreviewResult] = useState<MediaAutomationPipelinePreview | null>(null);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [savingEditor, setSavingEditor] = useState(false);
    const [selectedJobId, setSelectedJobId] = useState<string | number | null>(null);
    const [selectedJob, setSelectedJob] = useState<MediaAutomationJob | null>(null);
    const [jobLogs, setJobLogs] = useState<MediaAutomationActivity[]>([]);
    const [jobDetailBusy, setJobDetailBusy] = useState(false);
    const [activityFilter, setActivityFilter] = useState<'all' | 'job' | 'scan' | 'watch' | 'trigger'>('all');
    const [activityPageSize, setActivityPageSize] = useState<typeof ACTIVITY_PAGE_SIZE_OPTIONS[number]>(() => readActivityPageSize());
    const [activityPage, setActivityPage] = useState(1);
    const [queuePageSize, setQueuePageSize] = useState<typeof QUEUE_PAGE_SIZE_OPTIONS[number]>(() => readQueuePageSize());
    const [queuePage, setQueuePage] = useState(1);
    const [relativePaths, setRelativePaths] = useState(() => readRelativePathsPref());
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [queueViewFilter, setQueueViewFilter] = useState<QueueViewFilter>(() => readQueueViewFilter());
    const [queueSearch, setQueueSearch] = useState('');
    const [queueLibraryFilter, setQueueLibraryFilter] = useState('');
    const [queuePipelineFilter, setQueuePipelineFilter] = useState('');
    const [queueErrorFilter, setQueueErrorFilter] = useState('');
    const [workerTestResult, setWorkerTestResult] = useState<MediaAutomationCapabilities | null>(null);
    const [workerTestError, setWorkerTestError] = useState('');
    const [scanPreview, setScanPreview] = useState<MediaAutomationStatus['lastScanResult'] | null>(null);
    const [skipPreviewDismissedKey, setSkipPreviewDismissedKey] = useState<string | null>(null);
    const [historyEntries, setHistoryEntries] = useState<MediaAutomationHistoryEntry[]>([]);
    const [historyFilter, setHistoryFilter] = useState<'all' | 'completed' | 'failed' | 'cancelled' | 'dry-run'>('all');
    const [historySearch, setHistorySearch] = useState('');
    const profilesFileRef = React.useRef<HTMLInputElement | null>(null);
    const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
    const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(new Set());
    const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
    const [postSavePipeline, setPostSavePipeline] = useState<MediaAutomationPipeline | null>(null);
    const [editorAdvancedOpen, setEditorAdvancedOpen] = useState(false);
    const [editorMatchAdvancedOpen, setEditorMatchAdvancedOpen] = useState(false);
    const [forceSampleSection, setForceSampleSection] = useState(false);
    const [libraryPathHealth, setLibraryPathHealth] = useState<Record<string, { ok: boolean; message: string }>>({});
    const [reportSeed, setReportSeed] = useState<ReportModalSeed | null>(null);
    const reportDeepLinkHandled = React.useRef(false);
    const editLibraryDeepLinkHandled = React.useRef<string | null>(null);

    const toast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts((current) => pushToast(current, message, type));
    }, []);

    const load = useCallback(async (quiet = false) => {
        quiet ? setRefreshing(true) : setLoading(true);
        const requests = [
            ['status', mediaAutomationApi.status()],
            ['capabilities', mediaAutomationApi.capabilities()],
            ['jobs', mediaAutomationApi.jobs(QUEUE_JOBS_FETCH_LIMIT)],
            ['activity', mediaAutomationApi.activity(500)],
            ['history', mediaAutomationApi.history({ limit: 200 })],
            ['libraries', mediaAutomationApi.libraries()],
            ['pipelines', mediaAutomationApi.pipelines()],
        ] as const;
        const results = await Promise.allSettled(requests.map((entry) => entry[1]));
        const failed: string[] = [];
        results.forEach((result, index) => {
            const key = requests[index][0];
            if (result.status === 'rejected') {
                failed.push(key);
                return;
            }
            if (key === 'status') setStatus(result.value as MediaAutomationStatus);
            if (key === 'capabilities') setCapabilities(result.value as MediaAutomationCapabilities);
            if (key === 'jobs') setJobs(result.value as MediaAutomationJob[]);
            if (key === 'activity') setActivity(result.value as MediaAutomationActivity[]);
            if (key === 'history') {
                const payload = result.value as { entries?: MediaAutomationHistoryEntry[] };
                setHistoryEntries(payload.entries || []);
            }
            if (key === 'libraries') setLibraries(result.value as MediaAutomationLibrary[]);
            if (key === 'pipelines') setPipelines(result.value as MediaAutomationPipeline[]);
        });
        setUnavailable(failed);
        setLoading(false);
        setRefreshing(false);
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        writeMediaAutomationTabHash(tab);
    }, [tab]);
    useEffect(() => {
        const onHashChange = () => setTab(parseMediaAutomationTab());
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);
    useEffect(() => {
        if (reportDeepLinkHandled.current || typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const reportFlag = String(params.get('report') || '').trim().toLowerCase();
        if (reportFlag !== '1' && reportFlag !== 'true') return;

        const libraryName = String(params.get('libraryName') || '').trim().toLowerCase();
        // Wait for first status load so we can match an MA library by Upgrader name.
        if (libraryName && loading) return;

        let seed: ReportModalSeed = { forcePipeline: false };
        if (libraryName && libraries.length > 0) {
            const exact = libraries.find((library) => String(library.name || '').trim().toLowerCase() === libraryName);
            const partial = exact || libraries.find((library) => String(library.name || '').toLowerCase().includes(libraryName));
            if (partial) {
                seed = {
                    libraryId: partial.id,
                    libraryRoot: partial.rootPath,
                    pipelineId: partial.pipelineId ?? null,
                    forcePipeline: false,
                };
            }
        }

        reportDeepLinkHandled.current = true;
        setTab('libraries');
        writeMediaAutomationTabHash('libraries');
        setReportSeed(seed);

        params.delete('report');
        params.delete('libraryName');
        const qs = params.toString();
        const next = `${window.location.pathname}${qs ? `?${qs}` : ''}#libraries`;
        window.history.replaceState(null, '', next);
    }, [libraries, loading]);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const editLibrary = String(params.get('editLibrary') || params.get('libraryId') || '').trim();
        if (!editLibrary) return;
        if (loading) return;
        if (editLibraryDeepLinkHandled.current === editLibrary) return;

        let cancelled = false;
        const openEditor = async () => {
            let match = libraries.find((library) => String(library.id) === editLibrary) || null;
            if (!match) {
                try {
                    const fresh = await mediaAutomationApi.libraries();
                    match = fresh.find((library) => String(library.id) === editLibrary) || null;
                } catch {
                    match = null;
                }
            }
            if (cancelled) return;
            editLibraryDeepLinkHandled.current = editLibrary;
            setTab('libraries');
            writeMediaAutomationTabHash('libraries');
            if (match) {
                setLibraryDraft({ ...emptyLibrary(), ...match });
            }
            params.delete('editLibrary');
            params.delete('libraryId');
            const qs = params.toString();
            const next = `${window.location.pathname}${qs ? `?${qs}` : ''}#libraries`;
            window.history.replaceState(null, '', next);
        };
        void openEditor();
        return () => { cancelled = true; };
    }, [libraries, loading]);
    useEffect(() => {
        const hasActive = jobs.some((job) => {
            const state = jobStateValue(job);
            return ['running', 'processing', 'active', 'probing', 'planning', 'planned', 'verifying', 'committing'].includes(state)
                || ['running', 'processing', 'active'].includes(String(job.phase || '').toLowerCase());
        });
        const timer = window.setInterval(() => { load(true); }, hasActive ? 2000 : 15000);
        return () => window.clearInterval(timer);
    }, [load, jobs]);
    useEffect(() => {
        if (selectedJobId == null) return;
        const latest = jobs.find((job) => String(job.id) === String(selectedJobId));
        if (latest) setSelectedJob(latest);
    }, [jobs, selectedJobId]);

    const runAction = async (key: string, task: () => Promise<unknown>, success: string) => {
        setBusy(key);
        try {
            await task();
            toast(success);
            await load(true);
        } catch (error) {
            toast(error instanceof Error ? error.message : t('mediaAutomation.errors.requestFailed'), 'error');
        } finally {
            setBusy(null);
        }
    };

    const cancelScanWithConfirm = async () => {
        // Stuck banner after a finished scan: clear progress without the queue confirm.
        if (!status.scanning) {
            const result = await mediaAutomationApi.cancelScan({ clearQueued: false });
            setStatus((current) => ({ ...current, scanning: false, scanProgress: null }));
            return result;
        }
        const shouldCancel = await askConfirm(
            'Stop the in-progress library scan? Encoding jobs already queued will keep running unless you clear them next.',
            { title: 'Cancel scan?', confirmLabel: 'Cancel scan', cancelLabel: 'Keep scanning' },
        );
        if (!shouldCancel) return;
        const clearQueued = await askConfirm(
            'Also clear queued jobs from this scan batch?',
            { title: 'Clear queued jobs?', confirmLabel: 'Clear queue too', cancelLabel: 'Leave queue' },
        );
        const result = await mediaAutomationApi.cancelScan({ clearQueued });
        // Drop the banner immediately — the worker may still be unwinding a blocked probe.
        setStatus((current) => ({ ...current, scanning: false, scanProgress: null }));
        return result;
    };

    const runScanNow = async (
        options: { preview?: boolean; planOnly?: boolean; libraryId?: string | number | null } = {},
        rootsForConfirm?: string[],
    ) => {
        const roots = rootsForConfirm ?? (
            !options.preview && !options.planOnly
                ? (options.libraryId != null
                    ? libraries
                        .filter((library) => String(library.id) === String(options.libraryId))
                        .map((library) => String(library.rootPath || '').trim())
                        .filter(Boolean)
                    : libraries
                        .filter((library) => library.enabled !== false)
                        .map((library) => String(library.rootPath || '').trim())
                        .filter(Boolean))
                : []
        );
        if (!options.preview && !options.planOnly && roots.length && !(await confirmBroadLibraryScan(roots))) {
            return;
        }
        setBusy('scan-now');
        try {
            const response = await mediaAutomationApi.scanNow(options) as ScanNowResponse;
            const result = (response?.result || response) as ScanNowResponse;
            if (options.preview || options.planOnly) {
                setScanPreview(result || null);
                setSkipPreviewDismissedKey(null);
                const sampleSkips = result.sampleSkips
                    || result.result?.sampleSkips
                    || [];
                const roiSkips = sampleSkips.filter((entry) => String(entry.reason || '') === 'below-savings-estimate').length;
                toast(
                    `Would enqueue ${result.wouldEnqueue ?? 0}, would skip ${result.wouldSkip ?? 0}`
                    + (roiSkips > 0 ? ` (${roiSkips} below savings estimate)` : '')
                    + '.',
                );
            } else if (!options.libraryId) {
                setScanPreview(result || null);
                setSkipPreviewDismissedKey(null);
                toast(`Scan finished: ${result.enqueued ?? 0} queued, ${result.skipped ?? 0} skipped.`);
            } else {
                toast(`Scan finished: ${result.enqueued ?? 0} queued, ${result.skipped ?? 0} skipped.`);
            }
            if (response?.status) setStatus(response.status);
            await load(true);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Library scan failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    const saveLibrary = async () => {
        if (!libraryDraft?.name.trim() || !libraryDraft.rootPath.trim()) {
            toast('Library name and root path are required.', 'error');
            return;
        }
        if (!(await confirmBroadLibrarySave(libraryDraft.rootPath))) return;
        if (libraryDraft.outputMode === 'replace' && !(await confirmReplaceOutputMode())) return;
        setSavingEditor(true);
        try {
            if (libraryDraft.id !== undefined) await mediaAutomationApi.updateLibrary(libraryDraft.id, libraryDraft);
            else await mediaAutomationApi.createLibrary(libraryDraft);
            setLibraryDraft(null);
            toast('Library saved.');
            await load(true);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to save library', 'error');
        } finally {
            setSavingEditor(false);
        }
    };

    const setLibraryEnabled = async (library: MediaAutomationLibrary, enabled: boolean) => {
        if (library.id === undefined) return;
        const id = library.id;
        const previous = library.enabled;
        setLibraries((current) => current.map((item) => (
            String(item.id) === String(id) ? { ...item, enabled } : item
        )));
        try {
            await mediaAutomationApi.updateLibrary(id, { ...library, enabled });
            toast(enabled ? `Enabled ${library.name}.` : `Disabled ${library.name}.`);
        } catch (error) {
            setLibraries((current) => current.map((item) => (
                String(item.id) === String(id) ? { ...item, enabled: previous } : item
            )));
            toast(error instanceof Error ? error.message : 'Failed to update library', 'error');
        }
    };

    const toggleLibrarySelected = (id: string) => {
        setSelectedLibraryIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectableLibraryIds = libraries
        .filter((library) => library.id !== undefined)
        .map((library) => String(library.id));
    const allLibrariesSelected = selectableLibraryIds.length > 0
        && selectableLibraryIds.every((id) => selectedLibraryIds.has(id));
    const selectedLibraries = libraries.filter((library) => (
        library.id !== undefined && selectedLibraryIds.has(String(library.id))
    ));
    const selectedEnabledLibraries = selectedLibraries.filter((library) => library.enabled !== false);

    const disableSelectedLibraries = async () => {
        if (!selectedEnabledLibraries.length) return;
        const count = selectedEnabledLibraries.length;
        const ok = await askConfirm(
            `Disable ${count} selected ${count === 1 ? 'library' : 'libraries'}? Disabled libraries are skipped by scan and watch.`,
            {
                title: count === 1 ? 'Disable library?' : 'Disable selected libraries?',
                confirmLabel: count === 1 ? 'Disable' : `Disable ${count}`,
                cancelLabel: 'Keep enabled',
                danger: true,
            },
        );
        if (!ok) return;
        await runAction(
            'disable-libraries',
            async () => {
                for (const library of selectedEnabledLibraries) {
                    await mediaAutomationApi.updateLibrary(library.id!, { ...library, enabled: false });
                }
            },
            count === 1 ? `Disabled ${selectedEnabledLibraries[0].name}.` : `Disabled ${count} libraries.`,
        );
        setSelectedLibraryIds(new Set());
    };

    const savePipeline = async () => {
        if (!pipelineDraft?.name.trim()) {
            toast('Pipeline name is required.', 'error');
            return;
        }
        if (pipelineDraft.outputMode === 'replace' && !(await confirmReplaceOutputMode())) return;
        setSavingEditor(true);
        try {
            const payload = { ...pipelineDraft };
            if (pipelineDraft.id !== undefined) await mediaAutomationApi.updatePipeline(pipelineDraft.id, payload);
            else await mediaAutomationApi.createPipeline(payload);
            setPipelineDraft(null);
            setPostSavePipeline(payload);
            toast('Pipeline saved.');
            await load(true);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to save pipeline', 'error');
        } finally {
            setSavingEditor(false);
        }
    };

    const uniqueCopiedPipelineName = (baseName: string) => {
        const names = new Set(pipelines.map((pipeline) => String(pipeline.name || '').trim().toLowerCase()));
        const stem = String(baseName || 'Pipeline').trim() || 'Pipeline';
        const first = `${stem} (copy)`;
        if (!names.has(first.toLowerCase())) return first;
        let n = 2;
        while (names.has(`${stem} (copy ${n})`.toLowerCase())) n += 1;
        return `${stem} (copy ${n})`;
    };

    const copyPipeline = (pipeline: MediaAutomationPipeline) => {
        const { id: _copiedId, ...rest } = pipeline;
        setPreviewResult(null);
        setEditorAdvancedOpen(false);
        setEditorMatchAdvancedOpen(false);
        setForceSampleSection(!String(pipeline.samplePath || '').trim());
        setPipelineDraft({
            ...emptyPipeline(),
            ...rest,
            id: undefined,
            name: uniqueCopiedPipelineName(pipeline.name),
            samplePath: String(pipeline.samplePath || ''),
            rules: normalizeRules(pipeline.rules),
            steps: Array.isArray(pipeline.steps) ? pipeline.steps.map((step) => ({ ...step })) : [],
        });
    };

    const openPipelineFromPreset = (presetPipeline: MediaAutomationPipeline) => {
        setTemplatePickerOpen(false);
        setEditorAdvancedOpen(false);
        setEditorMatchAdvancedOpen(false);
        setForceSampleSection(true);
        setPipelineDraft({
            ...emptyPipeline(),
            ...presetPipeline,
            samplePath: String(presetPipeline.samplePath || ''),
            rules: normalizeRules(presetPipeline.rules),
            steps: Array.isArray(presetPipeline.steps) ? [...presetPipeline.steps] : [],
        });
    };

    const configuredHardware = useMemo(
        () => collectConfiguredHardware(status, pipelines),
        [status, pipelines],
    );
    const availableHardware = useMemo(
        () => (Array.isArray(capabilities.hardware) ? capabilities.hardware.map(String) : ['cpu']),
        [capabilities.hardware],
    );
    const anyGpuAvailable = useMemo(
        () => GPU_ADAPTER_IDS.some((id) => availableHardware.includes(id)),
        [availableHardware],
    );
    const caresAboutIntel = useMemo(() => (
        configuredHardware.has('qsv')
        || configuredHardware.has('intel-vaapi')
        || configuredHardware.has('vaapi')
        || (configuredHardware.has('auto') && !anyGpuAvailable)
    ), [configuredHardware, anyGpuAvailable]);
    const caresAboutNvenc = useMemo(() => (
        configuredHardware.has('nvenc')
        || (configuredHardware.has('auto') && !anyGpuAvailable)
    ), [configuredHardware, anyGpuAvailable]);
    const relevantAdapterErrors = useMemo(() => (
        (['qsv', 'intel-vaapi', 'vaapi', 'nvenc'] as const).filter((id) => {
            if (availableHardware.includes(id)) return false;
            if (!capabilities.details?.[id]?.error) return false;
            return adapterRelevantToConfig(id, configuredHardware);
        })
    ), [availableHardware, capabilities.details, configuredHardware]);

    const queueCounts = useMemo(() => {
        const counts = { queued: 0, active: 0, completed: 0, failed: 0, dryRun: 0 };
        jobs.forEach((job) => {
            const value = jobStateValue(job);
            if (jobIsDryRun(job)) counts.dryRun += 1;
            if (ACTIVE_QUEUE_STATES.has(value)) counts.active += 1;
            else if (COMPLETED_QUEUE_STATES.has(value)) counts.completed += 1;
            else if (FAILED_QUEUE_STATES.has(value)) counts.failed += 1;
            else counts.queued += 1;
        });
        return counts;
    }, [jobs]);

    const selectQueueViewFilter = (filter: QueueViewFilter) => {
        setQueueViewFilter(filter);
        writeQueueViewFilter(filter);
    };
    const cancellableJobs = useMemo(() => jobs.filter(isCancellableJob), [jobs]);
    const queuedTopPriority = useMemo(() => jobs.reduce(
        (max, job) => (jobStateValue(job) === 'queued' ? Math.max(max, Number(job.priority) || 0) : max),
        0,
    ), [jobs]);
    const finishedJobs = useMemo(() => jobs.filter(isTerminalJob), [jobs]);
    const retryableJobs = useMemo(
        () => jobs.filter((job) => ['failed', 'cancelled', 'canceled', 'error'].includes(jobStateValue(job))),
        [jobs],
    );
    const allJobIds = useMemo(() => jobs.map((job) => String(job.id)), [jobs]);
    const allSelected = allJobIds.length > 0 && allJobIds.every((id) => selectedJobIds.has(id));
    const selectedCancellableIds = useMemo(
        () => cancellableJobs.map((job) => String(job.id)).filter((id) => selectedJobIds.has(id)),
        [cancellableJobs, selectedJobIds],
    );
    const selectedFinishedIds = useMemo(
        () => finishedJobs.map((job) => String(job.id)).filter((id) => selectedJobIds.has(id)),
        [finishedJobs, selectedJobIds],
    );
    const selectedRetryableIds = useMemo(
        () => retryableJobs.map((job) => String(job.id)).filter((id) => selectedJobIds.has(id)),
        [retryableJobs, selectedJobIds],
    );
    const selectedDenyPaths = useMemo(() => {
        const paths = new Set<string>();
        jobs.filter((job) => selectedJobIds.has(String(job.id))).forEach((job) => {
            const source = String(job.sourcePath || job.path || '').trim();
            if (!source) return;
            const dir = pathDirname(source);
            paths.add(dir || source);
        });
        return [...paths];
    }, [jobs, selectedJobIds]);
    const queueLibraryOptions = useMemo(() => {
        const map = new Map<string, string>();
        jobs.forEach((job) => {
            const id = job.libraryId != null ? String(job.libraryId) : '';
            const name = String((job as { libraryName?: string }).libraryName || id);
            if (id) map.set(id, name || id);
        });
        libraries.forEach((library) => {
            if (library.id != null) map.set(String(library.id), library.name);
        });
        return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [jobs, libraries]);
    const queuePipelineOptions = useMemo(() => {
        const map = new Map<string, string>();
        jobs.forEach((job) => {
            const id = job.pipelineId != null ? String(job.pipelineId) : '';
            const name = String(job.pipelineName || id);
            if (id) map.set(id, name || id);
        });
        pipelines.forEach((pipeline) => {
            if (pipeline.id != null) map.set(String(pipeline.id), pipeline.name);
        });
        return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [jobs, pipelines]);

    useEffect(() => {
        const alive = new Set(allJobIds);
        setSelectedJobIds((current) => {
            const next = new Set([...current].filter((id) => alive.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [allJobIds]);

    const toggleJobSelected = (jobId: string | number) => {
        const id = String(jobId);
        setSelectedJobIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAllJobs = () => {
        setSelectedJobIds(allSelected ? new Set() : new Set(allJobIds));
    };

    const filteredActivity = useMemo(() => {
        if (activityFilter === 'all') return activity;
        return activity.filter((entry) => {
            const type = String(entry.type || entry.action || '').toLowerCase();
            if (activityFilter === 'job') return type.startsWith('job.') || type.includes('worker.');
            if (activityFilter === 'scan') return type.includes('library.scan') || type.includes('scan');
            if (activityFilter === 'watch') return type.includes('library.watch') || type.includes('watch');
            if (activityFilter === 'trigger') return type.includes('trigger') || type.includes('webhook') || type.includes('sonarr') || type.includes('radarr') || type.includes('lidarr');
            return true;
        });
    }, [activity, activityFilter]);

    const filteredJobs = useMemo(() => {
        const query = queueSearch.trim().toLowerCase();
        const errorQuery = queueErrorFilter.trim().toLowerCase();
        const list = jobs.filter((job) => {
            const matchesStatus = queueViewFilter === 'all' || jobMatchesQueueFilter(job, queueViewFilter);
            if (!matchesStatus) return false;
            if (queueLibraryFilter) {
                const libraryId = job.libraryId != null ? String(job.libraryId) : '';
                const libraryName = String((job as { libraryName?: string }).libraryName || '').toLowerCase();
                const filter = queueLibraryFilter.toLowerCase();
                if (libraryId !== queueLibraryFilter && !libraryName.includes(filter)) return false;
            }
            if (queuePipelineFilter) {
                const pipelineId = job.pipelineId != null ? String(job.pipelineId) : '';
                const pipelineName = String(job.pipelineName || '').toLowerCase();
                const filter = queuePipelineFilter.toLowerCase();
                if (pipelineId !== queuePipelineFilter && !pipelineName.includes(filter)) return false;
            }
            if (errorQuery) {
                const errorHaystack = `${jobErrorText(job.error)} ${jobErrorStderr(job.error)}`.toLowerCase();
                if (!errorHaystack.includes(errorQuery)) return false;
            }
            if (!query) return true;
            const haystack = `${job.path || ''} ${job.sourcePath || ''} ${job.pipelineName || ''} ${job.id} ${(job as { libraryName?: string }).libraryName || ''}`.toLowerCase();
            return haystack.includes(query);
        });
        // Active → queued → failed → dry-run → completed (completed stays at the bottom on All).
        list.sort((left, right) => queueListSortRank(left) - queueListSortRank(right));
        return list;
    }, [jobs, queueViewFilter, queueSearch, queueLibraryFilter, queuePipelineFilter, queueErrorFilter]);

    const queuePageCount = Math.max(1, Math.ceil(filteredJobs.length / queuePageSize));
    const pagedJobs = useMemo(() => {
        const start = (queuePage - 1) * queuePageSize;
        return filteredJobs.slice(start, start + queuePageSize);
    }, [filteredJobs, queuePage, queuePageSize]);

    useEffect(() => {
        setQueuePage(1);
    }, [queueViewFilter, queueSearch, queueLibraryFilter, queuePipelineFilter, queueErrorFilter, queuePageSize]);

    useEffect(() => {
        if (queuePage > queuePageCount) setQueuePage(queuePageCount);
    }, [queuePage, queuePageCount]);

    const activityPageCount = Math.max(1, Math.ceil(filteredActivity.length / activityPageSize));
    const pagedActivity = useMemo(() => {
        const start = (activityPage - 1) * activityPageSize;
        return filteredActivity.slice(start, start + activityPageSize);
    }, [filteredActivity, activityPage, activityPageSize]);

    useEffect(() => {
        setActivityPage(1);
    }, [activityFilter, activityPageSize]);

    useEffect(() => {
        if (activityPage > activityPageCount) setActivityPage(activityPageCount);
    }, [activityPage, activityPageCount]);

    const openJobDetail = async (
        jobId: string | number,
        options: { historyEntry?: MediaAutomationHistoryEntry | null } = {},
    ) => {
        setSelectedJobId(jobId);
        setJobDetailBusy(true);
        const fromJobs = jobs.find((entry) => String(entry.id) === String(jobId)) || null;
        const fromHistory = options.historyEntry
            || historyEntries.find((entry) => String(entry.id) === String(jobId))
            || null;
        const historyAsJob = fromHistory ? historyEntryToJobClient(fromHistory) : null;
        const initial = fromJobs || historyAsJob;
        if (initial) setSelectedJob(initial);
        try {
            const [job, logs] = await Promise.all([
                mediaAutomationApi.getJob(jobId).catch(() => null),
                mediaAutomationApi.jobLogs(jobId).catch(() => [] as MediaAutomationActivity[]),
            ]);
            // Live queue wins; archived/history payloads fill gaps after prune.
            const resolved = job && job.archived !== true ? job : (job || initial || null);
            setSelectedJob(resolved);
            setJobLogs(logs);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to load job details', 'error');
            setSelectedJob(initial || null);
            setJobLogs([]);
        } finally {
            setJobDetailBusy(false);
        }
    };

    const runEstimate = async (job: MediaAutomationJob) => {
        const jobId = String(job.id);
        const sourcePath = String(job.sourcePath || job.path || '');
        if (!sourcePath) {
            toast('Job has no source path to estimate.', 'error');
            return;
        }
        setBusy(`estimate-${jobId}`);
        toast('Estimating savings with a 60s sample encode - this can take a minute or two…');
        try {
            const response = await mediaAutomationApi.estimate(sourcePath, job.pipelineId ?? null, undefined, {
                libraryId: (job.libraryId as string | number | null | undefined) ?? null,
                libraryRoot: typeof job.libraryRoot === 'string' ? job.libraryRoot : null,
            });
            const estimate = response.estimate;
            if (!estimate) throw new Error(response.error || 'Estimate failed');
            const percent = estimate.estimatedSavingsPercent;
            toast(
                `Estimated savings for ${sourcePath.split(/[\\/]/).pop()}: `
                + `${percent != null ? `${percent}%` : 'unknown'}`
                + ` (~${formatBytes(estimate.estimatedBytesSaved)} of ${formatBytes(estimate.sourceBytes)})`
                + `${estimate.adapterLabel || estimate.adapter ? ` via ${estimate.adapterLabel || estimate.adapter}` : ''}.`,
            );
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Estimate failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    const formatBytes = (value?: number) => {
        const bytes = Number(value || 0);
        if (!Number.isFinite(bytes) || bytes <= 0) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
        return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
    };

    const openPipelineEditor = (pipeline?: MediaAutomationPipeline) => {
        setPreviewResult(null);
        setEditorAdvancedOpen(false);
        setEditorMatchAdvancedOpen(false);
        setForceSampleSection(!pipeline || !String(pipeline.samplePath || '').trim());
        if (!pipeline) {
            setPipelineDraft(emptyPipeline());
            return;
        }
        setPipelineDraft({
            ...emptyPipeline(),
            ...pipeline,
            samplePath: String(pipeline.samplePath || ''),
            rules: normalizeRules(pipeline.rules),
            steps: Array.isArray(pipeline.steps) ? pipeline.steps : [],
        });
    };

    const selectTab = useCallback((next: MediaAutomationTab) => {
        setTab(next);
        writeMediaAutomationTabHash(next);
    }, []);

    const handleSetupAction = (action: 'settings' | 'libraries' | 'pipelines' | 'start-worker' | 'scan') => {
        if (action === 'settings') {
            window.location.assign(portalUrl('/settings#media-automation'));
            return;
        }
        if (action === 'libraries') {
            selectTab('libraries');
            return;
        }
        if (action === 'pipelines') {
            selectTab('pipelines');
            return;
        }
        if (action === 'start-worker') {
            void runAction('start', () => mediaAutomationApi.control('start'), 'Worker started.');
            return;
        }
        if (action === 'scan') {
            void runScanNow();
        }
    };

    const runPipelinePreview = async () => {
        const samplePath = String(pipelineDraft?.samplePath || '').trim();
        if (!pipelineDraft?.id || !samplePath) {
            toast('Save the pipeline with a sample file path first.', 'error');
            return;
        }
        setPreviewBusy(true);
        setPreviewResult(null);
        try {
            const result = await mediaAutomationApi.previewPipeline(pipelineDraft.id, samplePath);
            setPreviewResult(result);
            toast(result.matched ? 'Pipeline matched the sample file.' : 'Pipeline did not match the sample file.');
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Pipeline preview failed', 'error');
        } finally {
            setPreviewBusy(false);
        }
    };

    const queuePipelineSample = async (
        pipeline: MediaAutomationPipeline,
        { dryRun = false }: { dryRun?: boolean } = {},
    ) => {
        const samplePath = String(pipeline.samplePath || '').trim();
        if (!pipeline.id || !samplePath) {
            toast('Save a sample file on this pipeline first.', 'error');
            return;
        }
        if (dryRun) {
            await runAction(
                `test-pipeline-${pipeline.id}`,
                () => mediaAutomationApi.testPipeline(pipeline.id!, samplePath),
                'Dry-run job queued.',
            );
            return;
        }
        await runAction(
            `queue-sample-${pipeline.id}`,
            () => mediaAutomationApi.enqueue(samplePath, pipeline.id),
            `Queued ${pathBasename(samplePath)} with ${pipeline.name}.`,
        );
    };

    const tabs: Array<{ id: MediaAutomationTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
        { id: 'overview', label: t('mediaAutomation.tabs.overview'), icon: Gauge },
        { id: 'queue', label: t('mediaAutomation.tabs.queue'), icon: ListRestart },
        { id: 'pipelines', label: t('mediaAutomation.tabs.pipelines'), icon: Layers3 },
        { id: 'libraries', label: t('mediaAutomation.tabs.libraries'), icon: FolderCog },
        { id: 'analyzer', label: t('mediaAutomation.tabs.analyzer'), icon: ScanSearch },
        { id: 'history', label: t('mediaAutomation.tabs.history'), icon: History },
        { id: 'system', label: t('mediaAutomation.tabs.system'), icon: ServerCog },
        { id: 'activity', label: t('mediaAutomation.tabs.activity'), icon: Activity },
    ];

    const activeSkipPreview = scanPreview || status?.lastScanResult || null;
    const skipPreviewKey = String(
        activeSkipPreview?.at
        || `${activeSkipPreview?.discovered || 0}:${activeSkipPreview?.enqueued || 0}:${activeSkipPreview?.skipped || 0}:${activeSkipPreview?.skippedDetails?.[0]?.filePath || ''}`,
    );
    const showSkipPreview = Boolean(activeSkipPreview)
        && skipPreviewDismissedKey !== skipPreviewKey
        && Boolean(scanPreview || activeSkipPreview?.skippedDetails?.length);

    if (loading) {
        return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-plex" /></div>;
    }

    return (
        <DashboardPageShell>
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <DashboardHero
                accent="sky"
                eyebrow={t('navigation.mediaAutomation')}
                title={t('mediaAutomation.hero.title')}
                description={t('mediaAutomation.hero.description')}
                icon={<ServerCog className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <>
                        <StatusPill value={workerStatusLabel(status)} size="md" />
                        {status.quietHoursActive && (
                            <span className="inline-flex items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-semibold uppercase tracking-wide text-sky-200">
                                {t('mediaAutomation.status.quietHours')}
                            </span>
                        )}
                        {status.streamingPauseActive && (
                            <span className="inline-flex items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold uppercase tracking-wide text-amber-200">
                                Paused — {Number(status.activeStreamCount) || 0} stream{(Number(status.activeStreamCount) || 0) === 1 ? '' : 's'} active
                            </span>
                        )}
                        <button type="button" className={buttonClass} onClick={() => load(true)} disabled={refreshing}>
                            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> {t('mediaAutomation.common.refresh')}
                        </button>
                    </>
                )}
            />

            {unavailable.length > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                    <div>
                        <p className="font-bold">Some automation endpoints are unavailable</p>
                        <p className="mt-0.5 text-amber-100/75">Unavailable: {unavailable.join(', ')}. Existing sections remain usable and will recover on refresh.</p>
                    </div>
                </div>
            )}

            <nav className="space-y-2">
                <div className="relative md:hidden">
                    {(() => {
                        const active = tabs.find((entry) => entry.id === tab) || tabs[0];
                        const ActiveIcon = active.icon;
                        return (
                            <>
                                <button
                                    type="button"
                                    className={`${buttonClass} w-full justify-between border-plex/40 bg-plex/15 text-plex`}
                                    onClick={() => setMobileNavOpen((open) => !open)}
                                    aria-expanded={mobileNavOpen}
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <ActiveIcon className="h-4 w-4" /> {active.label}
                                    </span>
                                    <ChevronDown className={`h-4 w-4 transition-transform ${mobileNavOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {mobileNavOpen && (
                                    <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                                        {tabs.map(({ id, label, icon: Icon }) => (
                                            <button
                                                key={id}
                                                type="button"
                                                className={`flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm font-bold transition ${
                                                    tab === id ? 'bg-plex/15 text-plex' : 'text-text hover:bg-white/5'
                                                }`}
                                                onClick={() => {
                                                    selectTab(id);
                                                    setMobileNavOpen(false);
                                                }}
                                            >
                                                <Icon className="h-4 w-4" /> {label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </div>
                <DashboardSubnav>
                        {tabs.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => selectTab(id)}
                                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(tab === id)}`}
                            >
                                <Icon className="h-4 w-4" /> {label}
                            </button>
                        ))}
                    </DashboardSubnav>
            </nav>

            {tab === 'overview' && (
                <div className="space-y-5">
                    <MediaAutomationSetupChecklist
                        status={status}
                        libraries={libraries}
                        pipelines={pipelines}
                        onAction={handleSetupAction}
                    />
                    {(status.dryRun || status.outputMode === 'dry-run') && (
                        <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                            <div>
                                <p className="font-bold text-amber-50">Global dry-run is forcing every job</p>
                                <p className="mt-1 text-xs text-amber-100/90">
                                    Settings → Media Automation → Safe fallback is set to Dry run. Pipeline output modes (copy/replace) are overridden until you change that fallback and save.
                                </p>
                                <button type="button" className={`${buttonClass} mt-3`} onClick={() => handleSetupAction('settings')}>
                                    Open Safe fallback settings
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatCard
                            label={t('mediaAutomation.stats.queued')}
                            value={asText(status.queuedJobs ?? queueCounts.queued, '0')}
                            hint={t('mediaAutomation.stats.waitingInLane')}
                            icon={<ListRestart className="h-4 w-4 text-amber-200" />}
                            tone="border-amber-400/30 bg-amber-500/10 text-amber-100"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.processing')}
                            value={asText(status.activeJobs ?? queueCounts.active, '0')}
                            hint={t('mediaAutomation.stats.activeEncodes')}
                            icon={<Loader2 className="h-4 w-4 text-sky-200" />}
                            tone="border-sky-400/30 bg-sky-500/10 text-sky-100"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.completed')}
                            value={asText(status.completedJobs ?? queueCounts.completed, '0')}
                            hint={t('mediaAutomation.stats.historyAllTime')}
                            icon={<CheckCircle2 className="h-4 w-4 text-emerald-200" />}
                            tone="border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.failed')}
                            value={asText(status.failedJobs ?? queueCounts.failed, '0')}
                            hint={t('mediaAutomation.stats.historyAllTime')}
                            icon={<AlertTriangle className="h-4 w-4 text-red-200" />}
                            tone="border-red-400/30 bg-red-500/10 text-red-100"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatCard
                            label={t('mediaAutomation.stats.processed24h')}
                            value={asText(status.metrics?.processed24h ?? 0, '0')}
                            hint={t('mediaAutomation.stats.historyLastDay')}
                            icon={<Gauge className="h-4 w-4 text-emerald-200" />}
                            tone="border-white/10 bg-white/[0.03] text-text"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.failed24h')}
                            value={asText(status.metrics?.failed24h ?? 0, '0')}
                            hint={t('mediaAutomation.stats.historyLastDay')}
                            icon={<AlertTriangle className="h-4 w-4 text-red-200" />}
                            tone="border-white/10 bg-white/[0.03] text-text"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.successRate')}
                            value={status.metrics?.successRate24h == null ? '-' : `${status.metrics.successRate24h}%`}
                            hint={t('mediaAutomation.stats.historyLast24h')}
                            icon={<CheckCircle2 className="h-4 w-4 text-plex" />}
                            tone="border-plex/30 bg-plex/10 text-text"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.bytesOut')}
                            value={formatBytes(status.metrics?.bytesOut24h)}
                            hint={t('mediaAutomation.stats.historyLast24h')}
                            icon={<ServerCog className="h-4 w-4 text-sky-200" />}
                            tone="border-white/10 bg-white/[0.03] text-text"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.bytesSaved')}
                            value={formatBytes(status.metrics?.bytesSaved24h)}
                            hint={t('mediaAutomation.stats.historyLast24h')}
                            icon={<CheckCircle2 className="h-4 w-4 text-emerald-200" />}
                            tone="border-emerald-500/30 bg-emerald-500/10 text-text"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.encodeTime')}
                            value={formatDurationSeconds(Math.round(Number(status.metrics?.encodeMs24h || 0) / 1000)) || '0s'}
                            hint={t('mediaAutomation.stats.historyLast24h')}
                            icon={<Gauge className="h-4 w-4 text-plex" />}
                            tone="border-white/10 bg-white/[0.03] text-text"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.saved7d')}
                            value={formatBytes(status.metrics?.bytesSaved7d ?? status.savings?.['7d']?.bytesSaved)}
                            hint={t('mediaAutomation.stats.historyAggregate')}
                            icon={<CheckCircle2 className="h-4 w-4 text-emerald-200" />}
                            tone="border-emerald-500/30 bg-emerald-500/10 text-text"
                        />
                        <StatCard
                            label={t('mediaAutomation.stats.saved30d')}
                            value={formatBytes(status.metrics?.bytesSaved30d ?? status.savings?.['30d']?.bytesSaved)}
                            hint={t('mediaAutomation.stats.historyAggregate')}
                            icon={<History className="h-4 w-4 text-sky-200" />}
                            tone="border-sky-500/30 bg-sky-500/10 text-text"
                        />
                    </div>
                    {(status.scanning || status.scanProgress?.running) && (
                        <section className={`${panelClass} space-y-3 p-5`}>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="font-bold text-text">Scan in progress</h2>
                                    <p className="mt-1 text-sm text-muted">
                                        {status.scanProgress?.discovered || 0} discovered · {status.scanProgress?.enqueued || 0} queued · {status.scanProgress?.skipped || 0} skipped
                                        {status.scanProgress?.percent != null ? ` · ${Math.round(status.scanProgress.percent)}%` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null}
                                        onClick={() => runAction('cancel-scan', cancelScanWithConfirm, 'Scan cancel requested.')}
                                    >
                                        {busy === 'cancel-scan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                                        Cancel scan
                                    </button>
                                    <Loader2 className="h-5 w-5 animate-spin text-plex" />
                                </div>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                {status.scanProgress?.percent != null ? (
                                    <div
                                        className="h-full rounded-full bg-plex/70 transition-all"
                                        style={{ width: `${Math.max(2, Math.min(100, status.scanProgress.percent))}%` }}
                                    />
                                ) : (
                                    <div className="h-full w-1/3 animate-pulse rounded-full bg-plex/70" />
                                )}
                            </div>
                            {status.scanProgress?.currentPath && (
                                <p className="truncate font-mono text-xs text-muted" title={status.scanProgress.currentPath}>
                                    {status.scanProgress.currentPath}
                                </p>
                            )}
                        </section>
                    )}
                    {!!(status.recentScans || []).length && (
                        <section className={`${panelClass} p-5`}>
                            <h2 className="font-bold text-text">Recent scans</h2>
                            <div className="mt-3 space-y-2">
                                {(status.recentScans || []).slice(0, 5).map((scan) => (
                                    <div key={scan.id || scan.at} className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-xs">
                                        <p className="font-semibold text-text">
                                            {scan.discovered || 0} discovered · {scan.enqueued || 0} queued · {scan.skipped || 0} skipped
                                        </p>
                                        <p className="mt-1 text-muted">{scan.at ? new Date(scan.at).toLocaleString() : '—'}</p>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                    {!!(status.deliveryTargets || []).length && (
                        <section className={`${panelClass} p-5`}>
                            <h2 className="font-bold text-text">Delivery targets</h2>
                            <p className="mt-1 text-sm text-muted">Cross-Unraid drop folders after successful encodes. Map the remote share into the container path below.</p>
                            <div className="mt-3 space-y-2">
                                {(status.deliveryTargets || []).map((target) => (
                                    <div key={target.id} className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-xs">
                                        <p className="font-semibold text-text">{target.name} · {target.mode} · {target.namingMode}</p>
                                        <p className="mt-1 truncate font-mono text-muted" title={target.path}>{target.path || '(path missing)'}</p>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                    {status.quietHoursEnabled && (
                        <div className={`rounded-xl border px-4 py-3 text-sm ${status.quietHoursActive ? 'border-sky-500/40 bg-sky-500/10 text-sky-50' : 'border-border/70 bg-background/30 text-muted'}`}>
                            Quiet hours {status.quietHoursStart || '23:00'} - {status.quietHoursEnd || '07:00'}
                            {status.quietHoursActive
                                ? ' are active now. New encodes are paused; queued jobs will start when the window ends.'
                                : ' are configured. Encoding runs outside that window.'}
                            {' '}
                            <a className="font-semibold text-plex hover:underline" href={portalUrl('/settings#media-automation')}>Edit in Settings</a>
                        </div>
                    )}
                    {!status.quietHoursEnabled && (
                        <div className="rounded-xl border border-border/70 bg-background/30 px-4 py-3 text-sm text-muted">
                            Quiet hours are off.
                            {' '}
                            <a className="font-semibold text-plex hover:underline" href={portalUrl('/settings#media-automation')}>Enable in Settings → Media Automation</a>
                        </div>
                    )}
                    {showSkipPreview && (
                        <section className={`${panelClass} p-5`}>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h2 className="font-bold text-text">Last scan skip preview</h2>
                                    <p className="mt-1 text-sm text-muted">
                                        {activeSkipPreview?.discovered || 0} discovered ·{' '}
                                        {activeSkipPreview?.enqueued || 0} queued ·{' '}
                                        {activeSkipPreview?.skipped || 0} skipped
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="rounded-lg p-2 text-muted hover:bg-white/5"
                                    onClick={() => {
                                        setScanPreview(null);
                                        setSkipPreviewDismissedKey(skipPreviewKey || 'dismissed');
                                    }}
                                    aria-label="Dismiss"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="mt-3 space-y-2">
                                {(activeSkipPreview?.skippedDetails || []).slice(0, 12).map((entry, index) => (
                                    <div key={`${entry.filePath}-${index}`} className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-xs">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${skipReasonChipClass(entry.reason)}`}>
                                                {formatSkipReasonLabel(entry.reason)}
                                            </span>
                                            {entry.videoCodec && (
                                                <span className="rounded-md border border-border/60 bg-background/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">
                                                    {entry.videoCodec}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-1 truncate font-mono text-muted" title={entry.filePath}>{entry.filePath}</p>
                                    </div>
                                ))}
                                {!(activeSkipPreview?.skippedDetails || []).length && (
                                    <p className="text-sm text-muted">No skip details recorded for this scan.</p>
                                )}
                            </div>
                        </section>
                    )}
                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                                                <section className={`${panelClass} relative overflow-hidden p-0`}>
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgb(var(--color-plex)_/_0.16),transparent_42%)]" />
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-plex/50 to-transparent" />
                            <div className="relative space-y-5 p-5 sm:p-6">
                                {(() => {
                                    const paused = (status.workerPaused ?? status.paused) !== false;
                                    const autoPaused = workerStatusLabel(status) === 'Auto-paused (queue depth)';
                                    const encoding = !paused && !autoPaused;
                                    const statusTone = autoPaused
                                        ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                                        : encoding
                                            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                                            : 'border-white/10 bg-white/5 text-muted';
                                    const statusText = autoPaused ? 'Auto-paused' : encoding ? 'Encoding' : 'Paused';
                                    const statusDetail = autoPaused
                                        ? 'Queue depth exceeded the configured limit. Jobs stay queued until depth drops or you adjust Settings.'
                                        : encoding
                                            ? 'Worker may claim queued jobs.'
                                            : 'Queue only — jobs can still enqueue. Start when you want encodes to run.';
                                    const cpuRunning = Number(status.lanes?.cpu?.running || 0);
                                    const cpuQueued = Number(status.lanes?.cpu?.queued || 0);
                                    const gpuRunning = Number(status.lanes?.gpu?.running || 0);
                                    const gpuQueued = Number(status.lanes?.gpu?.queued || 0);
                                    const watcherLabel = status.libraryWatchConfigured && status.watchEnvEnabled === false
                                        ? 'Blocked'
                                        : status.libraryWatchEnabled === false
                                            ? 'Disabled'
                                            : status.watch?.watching
                                                ? `Watching ${status.watch.roots?.length || 0}`
                                                : 'Idle';
                                    const periodicLabel = status.libraryScanEnabled === false
                                        ? 'Disabled'
                                        : status.periodicScanning
                                            ? `Every ${status.libraryScanIntervalMinutes || 360}m`
                                            : 'Idle';
                                    return (
                                        <>
                                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h2 className="text-lg font-black tracking-tight text-text">Worker</h2>
                                                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusTone}`}>
                                                            <span className={`h-1.5 w-1.5 rounded-full ${
                                                                encoding ? 'ma-live-dot bg-emerald-400' : autoPaused ? 'bg-amber-300' : 'bg-white/40'
                                                            }`} />
                                                            {statusText}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1.5 max-w-xl text-sm text-muted">{statusDetail}</p>
                                                </div>
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-plex/30 bg-plex/10 shadow-[0_0_24px_rgb(var(--color-plex)/0.18)]">
                                                    <Cpu className="h-5 w-5 text-plex" />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                                                {([
                                                    { action: 'start', label: 'Start', Icon: CirclePlay, primary: true },
                                                    { action: 'pause', label: 'Pause', Icon: CirclePause, primary: false },
                                                    { action: 'resume', label: 'Resume', Icon: Play, primary: false },
                                                    { action: 'stop', label: 'Stop', Icon: Square, primary: false },
                                                ] satisfies Array<{
                                                    action: string;
                                                    label: string;
                                                    Icon: React.ComponentType<{ className?: string }>;
                                                    primary: boolean;
                                                }>).map(({ action, label, Icon, primary }) => {
                                                    const ActionIcon = Icon;
                                                    return (
                                                        <button
                                                            key={action}
                                                            type="button"
                                                            className={primary
                                                                ? `${primaryButtonClass} min-h-[3rem] shadow-[0_10px_30px_-12px_rgb(var(--color-plex)/0.8)]`
                                                                : `${buttonClass} min-h-[3rem] bg-gradient-to-b from-white/[0.05] to-black/20`}
                                                            disabled={busy !== null}
                                                            onClick={() => runAction(`control-${action}`, () => mediaAutomationApi.control(action), `Worker ${action} requested.`)}
                                                        >
                                                            {busy === `control-${action}`
                                                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                                                : <ActionIcon className="h-4 w-4" />}
                                                            {label}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                                <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Library actions</p>
                                                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                                    <button
                                                        type="button"
                                                        className={`${buttonClass} justify-start bg-gradient-to-b from-white/[0.04] to-transparent px-3.5 py-3`}
                                                        disabled={busy !== null}
                                                        onClick={() => {
                                                            const enabledRoots = libraries
                                                                .filter((library) => library.enabled !== false)
                                                                .map((library) => String(library.rootPath || '').trim())
                                                                .filter(Boolean);
                                                            void runScanNow({}, enabledRoots);
                                                        }}
                                                    >
                                                        {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4 text-plex" />}
                                                        <span className="text-left">
                                                            <span className="block">Scan now</span>
                                                            <span className="block text-[11px] font-medium text-muted">Enqueue matching media</span>
                                                        </span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`${buttonClass} justify-start bg-gradient-to-b from-white/[0.04] to-transparent px-3.5 py-3`}
                                                        disabled={busy !== null}
                                                        onClick={() => void runScanNow({ preview: true })}
                                                    >
                                                        {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4 text-plex" />}
                                                        <span className="text-left">
                                                            <span className="block">Preview scan</span>
                                                            <span className="block text-[11px] font-medium text-muted">Dry discovery pass</span>
                                                        </span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`${buttonClass} justify-start bg-gradient-to-b from-white/[0.04] to-transparent px-3.5 py-3`}
                                                        disabled={busy !== null}
                                                        onClick={() => void runScanNow({ planOnly: true })}
                                                    >
                                                        {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-plex" />}
                                                        <span className="text-left">
                                                            <span className="block">Plan only</span>
                                                            <span className="block text-[11px] font-medium text-muted">Build plans, no encode</span>
                                                        </span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`${buttonClass} justify-start bg-gradient-to-b from-white/[0.04] to-transparent px-3.5 py-3`}
                                                        disabled={busy !== null}
                                                        onClick={async () => {
                                                            setBusy('worker-test');
                                                            setWorkerTestError('');
                                                            try {
                                                                const result = await mediaAutomationApi.testWorker() as MediaAutomationCapabilities & { ok?: boolean; error?: string };
                                                                if (result?.ok === false || result?.available === false) {
                                                                    setWorkerTestError(result.error || 'Worker test failed');
                                                                    setWorkerTestResult(result);
                                                                    toast(result.error || 'Worker test failed', 'error');
                                                                } else {
                                                                    setWorkerTestResult(result);
                                                                    setCapabilities(result);
                                                                    toast('Worker test completed.');
                                                                }
                                                                await load(true);
                                                            } catch (error) {
                                                                const message = error instanceof Error ? error.message : 'Worker test failed';
                                                                setWorkerTestError(message);
                                                                setWorkerTestResult(null);
                                                                toast(message, 'error');
                                                            } finally {
                                                                setBusy(null);
                                                            }
                                                        }}
                                                    >
                                                        {busy === 'worker-test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-plex" />}
                                                        <span className="text-left">
                                                            <span className="block">Test worker</span>
                                                            <span className="block text-[11px] font-medium text-muted">Probe FFmpeg + hardware</span>
                                                        </span>
                                                    </button>
                                                </div>
                                            </div>

                                            {(workerTestResult || workerTestError) && (
                                                <div className={`rounded-2xl border p-4 text-sm ${workerTestError ? 'border-red-500/30 bg-red-500/10 text-red-100' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-50'}`}>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <p className="font-bold">{workerTestError ? 'Worker test failed' : 'Worker test passed'}</p>
                                                            {workerTestError && <p className="mt-1 text-xs opacity-90">{workerTestError}</p>}
                                                            {workerTestResult && (
                                                                <div className="mt-2 space-y-1 text-xs opacity-90">
                                                                    <p>FFmpeg: {typeof workerTestResult.ffmpeg === 'object' ? (workerTestResult.ffmpeg.version || (workerTestResult.ffmpeg.available === false ? 'unavailable' : 'available')) : (workerTestResult.ffmpeg ? 'available' : 'unknown')}</p>
                                                                    <p>Hardware: {(Array.isArray(workerTestResult.hardware) ? workerTestResult.hardware : []).join(', ') || 'cpu only'}</p>
                                                                    {workerTestResult.devices?.dri && (
                                                                        <p>/dev/dri: {workerTestResult.devices.dri.present === false ? 'not mapped' : (workerTestResult.devices.dri.readable === false ? 'present but not readable' : (workerTestResult.devices.dri.device || 'present'))}</p>
                                                                    )}
                                                                    {(['qsv', 'nvenc', 'intel-vaapi', 'vaapi'] as const).map((id) => {
                                                                        const detail = workerTestResult.details?.[id];
                                                                        if (!detail?.error) return null;
                                                                        return <p key={id} className="text-amber-200">{detail.label || id}: {detail.error}</p>;
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <button type="button" className="rounded-lg p-1 text-current/70 hover:bg-white/10" onClick={() => { setWorkerTestResult(null); setWorkerTestError(''); }} aria-label="Dismiss">
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                                                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/25 p-3.5">
                                                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Last scan</p>
                                                    <p className="mt-2 text-sm font-semibold tabular-nums text-text">{formatTime(status.lastScanAt)}</p>
                                                    <p className="mt-1 text-[11px] text-muted">{status.lastScanResult ? `${status.lastScanResult.enqueued || 0} queued` : 'No scan yet'}</p>
                                                </div>
                                                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/25 p-3.5">
                                                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Periodic scan</p>
                                                    <p className="mt-2 text-sm font-semibold text-text">{periodicLabel}</p>
                                                    <p className="mt-1 text-[11px] text-muted">Library schedule</p>
                                                </div>
                                                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/25 p-3.5">
                                                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Watcher</p>
                                                    <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-text">
                                                        <Radar className="h-3.5 w-3.5 text-plex" />
                                                        {watcherLabel}
                                                    </p>
                                                    <p className="mt-1 text-[11px] text-muted">Filesystem events</p>
                                                </div>
                                                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/25 p-3.5">
                                                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Lanes</p>
                                                    <p className="mt-2 text-sm font-semibold tabular-nums text-text">CPU {cpuRunning}/{cpuQueued}</p>
                                                    <p className="mt-1 text-[11px] font-semibold tabular-nums text-muted">GPU {gpuRunning}/{gpuQueued}</p>
                                                </div>
                                            </div>

                                            {status.libraryWatchConfigured && status.watchEnvEnabled === false && (
                                                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                                                    Watcher is enabled in Settings, but the container env gate is off. Add <code className="font-mono text-plex">MEDIA_AUTOMATION_ENABLE_WATCH=1</code> and recreate the container.
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </section>
                        <section className={`${panelClass} relative overflow-hidden p-0`}>
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgb(var(--color-plex)_/_0.12),transparent_40%)]" />
                            <div className="relative space-y-4 p-5 sm:p-6">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-black tracking-tight text-text">Capabilities</h2>
                                    <p className="mt-1 text-sm text-muted">Detected encode adapters in this container.</p>
                                </div>
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                                    <Gauge className="h-5 w-5 text-plex" />
                                </div>
                            </div>
                            <div className="space-y-3 text-sm">
                                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/25 p-3.5"><p className="text-[11px] font-bold uppercase tracking-wide text-muted">FFmpeg</p><p className="mt-2 break-words font-semibold text-text">{typeof capabilities.ffmpeg === 'object' ? (capabilities.ffmpeg.available === false ? 'Unavailable' : capabilities.ffmpeg.version || 'Available') : capabilities.ffmpeg ? 'Available' : 'Unknown'}</p></div>
                                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/25 p-3.5"><p className="text-[11px] font-bold uppercase tracking-wide text-muted">FFprobe</p><p className="mt-2 break-words font-semibold text-text">{typeof capabilities.ffprobe === 'object' ? (capabilities.ffprobe.available === false ? 'Unavailable' : capabilities.ffprobe.version || 'Available') : capabilities.ffprobe ? 'Available' : 'Unknown'}</p></div>
                                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/25 p-3.5">
                                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Hardware adapters</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {[
                                            ['cpu', 'CPU'],
                                            ['qsv', 'Intel QSV'],
                                            ['intel-vaapi', 'Intel VAAPI'],
                                            ['nvenc', 'NVENC'],
                                            ['vaapi', 'AMD VAAPI'],
                                        ].map(([id, label]) => {
                                            const available = Array.isArray(capabilities.hardware)
                                                ? capabilities.hardware.map(String).includes(id)
                                                : id === 'cpu';
                                            return (
                                                <span
                                                    key={id}
                                                    className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                                                        available
                                                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                                                            : 'border-border bg-white/5 text-muted'
                                                    }`}
                                                >
                                                    {label}{available ? '' : ' · off'}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    {caresAboutIntel && !availableHardware.includes('qsv') && !availableHardware.includes('intel-vaapi') && (
                                        <p className="mt-2 text-xs text-amber-200/90">
                                            {capabilities.devices?.dri?.present === false
                                                ? <>Intel QSV needs <span className="font-mono text-plex">/dev/dri</span> mapped in the Unraid template (GPU Devices Intel/AMD).</>
                                                : capabilities.devices?.dri?.readable === false
                                                    ? <>Intel render node is present but not readable by PUID - recreate the container on the latest image so the entrypoint can attach DRI groups.</>
                                                    : <>Intel QSV/VAAPI is selected but unavailable - map <span className="font-mono text-plex">/dev/dri</span>, pull latest nightly, then Test worker.</>}
                                        </p>
                                    )}
                                    {caresAboutNvenc && !availableHardware.includes('nvenc') && (
                                        <p className="mt-2 text-xs text-amber-200/90">
                                            {capabilities.devices?.nvidia?.cudaLib
                                                ? 'NVENC is selected but the encoder test failed - check NVIDIA_DRIVER_CAPABILITIES=all and GPU UUID.'
                                                : <>NVENC is selected but not ready - set <span className="font-mono text-plex">NVIDIA_VISIBLE_DEVICES</span>, <span className="font-mono text-plex">NVIDIA_DRIVER_CAPABILITIES=all</span>, and Extra Parameters <span className="font-mono text-plex">--runtime=nvidia</span>.</>}
                                        </p>
                                    )}
                                    {configuredHardware.has('auto') && !anyGpuAvailable && !configuredHardware.has('cpu') && (
                                        <p className="mt-2 text-xs text-amber-200/90">
                                            Hardware is set to Auto but no GPU adapter passed the worker test. Use CPU, or map Intel <span className="font-mono text-plex">/dev/dri</span> / NVIDIA runtime and Test worker again.
                                        </p>
                                    )}
                                    {caresAboutIntel && capabilities.devices?.dri?.present && (
                                        <p className="mt-2 font-mono text-[11px] text-muted">
                                            DRI: {(capabilities.devices.dri.renderNodes || []).join(', ') || 'no render nodes'}
                                            {capabilities.devices.dri.readable ? ' · readable' : ' · not readable'}
                                            {capabilities.devices.dri.vendor
                                                ? ` · ${String(capabilities.devices.dri.vendor)}${capabilities.devices.dri.vendorId ? ` (${capabilities.devices.dri.vendorId})` : ''}`
                                                : (capabilities.devices.dri.vendors?.length
                                                    ? ` · ${capabilities.devices.dri.vendors.join(', ')}`
                                                    : '')}
                                        </p>
                                    )}
                                    {relevantAdapterErrors.map((id) => {
                                        const detailError = capabilities.details?.[id]?.error;
                                        if (!detailError) return null;
                                        return (
                                            <p key={`${id}-error`} className="mt-2 break-words text-xs text-red-300/90">
                                                <span className="font-semibold uppercase">{id}</span>: {detailError}
                                            </p>
                                        );
                                    })}
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/25 p-3.5"><p className="text-[11px] font-bold uppercase tracking-wide text-muted">Encoders</p><p className="mt-2 line-clamp-3 font-semibold text-text">{capabilities.encoders?.length ? capabilities.encoders.join(', ') : 'No encoder data reported'}</p></div>
                            </div>
                            </div>
                        </section>
                    </div>
                </div>
            )}

            {tab === 'queue' && (
                <div className="space-y-5">
                    {(status.dryRun || status.outputMode === 'dry-run') && (
                        <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                            <div>
                                <p className="font-bold text-amber-50">Global dry-run is still ON - jobs will not rewrite media</p>
                                <p className="mt-1 text-xs text-amber-100/90">
                                    Settings → Media Automation → Safe fallback must be Copy or Replace (then Save). Changing only the pipeline is not enough while this override is active.
                                </p>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                        <EncodeControlCard
                            status={status}
                            busy={busy}
                            onStart={() => runAction('control-start', () => mediaAutomationApi.control('start'), 'Encoding started.')}
                            onPause={() => runAction('control-pause', () => mediaAutomationApi.control('pause'), 'Encoding paused (queue only).')}
                        />
                        <section className={`${panelClass} h-full p-5`}>
                            <h2 className="mb-4 font-bold text-text">Enqueue a path</h2>
                            <div className="space-y-3">
                                <PathBrowserField
                                    label="Media file"
                                    mode="file"
                                    value={enqueuePath}
                                    onChange={setEnqueuePath}
                                    placeholder="/media/Movies/example.mkv"
                                    hint="Use container paths under your library root (e.g. /media/...), not Unraid /mnt/remotes/… paths."
                                />
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                                    <CustomSelect
                                        value={enqueuePipelineId}
                                        onChange={(value) => {
                                            setEnqueuePipelineId(value);
                                            const match = pipelines.find((pipeline) => String(pipeline.id ?? '') === value);
                                            const sample = String(match?.samplePath || '').trim();
                                            if (sample) setEnqueuePath(sample);
                                        }}
                                        options={[{ value: '', label: t('mediaAutomation.queue.automaticPipeline') }, ...pipelines.map((pipeline) => ({ value: String(pipeline.id ?? ''), label: pipeline.name }))]}
                                    />
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null || !enqueuePipelineId || !pipelines.some((pipeline) => String(pipeline.id ?? '') === enqueuePipelineId && String(pipeline.samplePath || '').trim())}
                                        onClick={() => {
                                            const match = pipelines.find((pipeline) => String(pipeline.id ?? '') === enqueuePipelineId);
                                            if (match) void queuePipelineSample(match);
                                        }}
                                    >
                                        {busy?.startsWith('queue-sample-') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                        {t('mediaAutomation.queue.queueSample')}
                                    </button>
                                    <button type="button" className={primaryButtonClass} disabled={!enqueuePath.trim() || busy !== null} onClick={() => runAction('enqueue', () => mediaAutomationApi.enqueue(enqueuePath.trim(), enqueuePipelineId || undefined), 'Path added to queue.').then(() => setEnqueuePath(''))}>
                                        {busy === 'enqueue' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('mediaAutomation.queue.enqueue')}
                                    </button>
                                </div>
                                <p className="text-xs text-muted">{t('mediaAutomation.queue.sampleHint')}</p>
                            </div>
                        </section>
                    </div>
                    {jobs.length === 0 ? (
                        <EmptyState
                            icon={ListRestart}
                            title={t('mediaAutomation.queue.emptyTitle')}
                            detail={t('mediaAutomation.queue.emptyDetail')}
                            actionLabel={t('mediaAutomation.queue.scanNow')}
                            onAction={() => void runScanNow()}
                        />
                    ) : (
                        <div className="space-y-3">
                            <section className={`${panelClass} p-4`}>
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            className={`${buttonClass} ${queueViewFilter === 'all' ? 'border-plex/50 bg-plex/15 text-plex' : ''}`}
                                            onClick={() => selectQueueViewFilter('all')}
                                            aria-pressed={queueViewFilter === 'all'}
                                        >
                                            {t('mediaAutomation.queue.all')}
                                        </button>
                                        {([
                                            ['active', t('mediaAutomation.queue.active'), queueCounts.active],
                                            ['queued', t('mediaAutomation.queue.queued'), queueCounts.queued],
                                            ['dry-run', t('mediaAutomation.queue.dryRun'), queueCounts.dryRun],
                                            ['failed', t('mediaAutomation.queue.failed'), queueCounts.failed],
                                            ['completed', t('mediaAutomation.queue.completed'), queueCounts.completed],
                                        ] as const).map(([id, label, count]) => (
                                            <button
                                                key={id}
                                                type="button"
                                                className={`${buttonClass} ${queueViewFilter === id ? 'border-plex/50 bg-plex/15 text-plex' : ''}`}
                                                onClick={() => selectQueueViewFilter(id)}
                                                aria-pressed={queueViewFilter === id}
                                            >
                                                {label} ({count})
                                            </button>
                                        ))}
                                    </div>
                                    <label className="relative block w-full lg:max-w-xs">
                                        <span className="sr-only">{t('mediaAutomation.queue.search')}</span>
                                        <input
                                            className={`${fieldClass} pl-3`}
                                            value={queueSearch}
                                            onChange={(event) => setQueueSearch(event.target.value)}
                                            placeholder={t('mediaAutomation.queue.searchPlaceholder')}
                                        />
                                    </label>
                                </div>
                                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                    <CustomSelect
                                        className="min-w-[10rem]"
                                        compact
                                        value={queueLibraryFilter}
                                        onChange={setQueueLibraryFilter}
                                        options={[
                                            { value: '', label: t('mediaAutomation.queue.allLibraries') },
                                            ...queueLibraryOptions.map(([id, name]) => ({ value: id, label: name })),
                                        ]}
                                    />
                                    <CustomSelect
                                        className="min-w-[10rem]"
                                        compact
                                        value={queuePipelineFilter}
                                        onChange={setQueuePipelineFilter}
                                        options={[
                                            { value: '', label: t('mediaAutomation.queue.allPipelines') },
                                            ...queuePipelineOptions.map(([id, name]) => ({ value: id, label: name })),
                                        ]}
                                    />
                                    <input
                                        className="appearance-none text-[16px] leading-5 w-full sm:max-w-xs rounded-lg border border-white/10 bg-background/70 px-3 py-2 text-[16px] text-text placeholder:text-muted/60 outline-none transition focus:border-plex focus:ring-1 focus:ring-plex"
                                        value={queueErrorFilter}
                                        onChange={(event) => setQueueErrorFilter(event.target.value)}
                                        placeholder={t('mediaAutomation.queue.errorFilterPlaceholder')}
                                    />
                                    <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                                        <span className="whitespace-nowrap" title={t('mediaAutomation.queue.relativePathsHint')}>
                                            {t('mediaAutomation.queue.relativePaths')}
                                        </span>
                                        <SettingsSwitch
                                            checked={relativePaths}
                                            onChange={(next) => {
                                                setRelativePaths(next);
                                                try {
                                                    localStorage.setItem(RELATIVE_PATHS_KEY, next ? '1' : '0');
                                                } catch {
                                                    // ignore
                                                }
                                            }}
                                        />
                                    </label>
                                    <label className="flex items-center gap-2 text-xs font-semibold text-muted sm:ml-auto">
                                        <span className="whitespace-nowrap">{t('mediaAutomation.queue.perPage')}</span>
                                        <CustomSelect
                                            compact
                                            className="min-w-[5.5rem]"
                                            value={queuePageSize}
                                            onChange={(value) => {
                                                const next = Number(value) as typeof QUEUE_PAGE_SIZE_OPTIONS[number];
                                                if (!QUEUE_PAGE_SIZE_OPTIONS.includes(next)) return;
                                                setQueuePageSize(next);
                                                try {
                                                    localStorage.setItem(QUEUE_PAGE_SIZE_KEY, String(next));
                                                } catch {
                                                    // ignore
                                                }
                                            }}
                                            options={QUEUE_PAGE_SIZE_OPTIONS.map((size) => ({
                                                value: String(size),
                                                label: String(size),
                                            }))}
                                        />
                                    </label>
                                </div>
                            </section>
                            <section className={`${panelClass} p-4`}>
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-text">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                                            checked={allSelected}
                                            onChange={toggleSelectAllJobs}
                                        />
                                        Select all ({filteredJobs.length}{filteredJobs.length !== jobs.length ? ` of ${jobs.length}` : ''})
                                        {selectedJobIds.size > 0 && (
                                            <span className="font-normal text-muted">· {selectedJobIds.size} selected</span>
                                        )}
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={busy !== null || selectedCancellableIds.length === 0}
                                            onClick={() => runAction(
                                                'cancel-selected',
                                                () => mediaAutomationApi.bulkCancelJobs(selectedCancellableIds),
                                                `Cancelled ${selectedCancellableIds.length} job${selectedCancellableIds.length === 1 ? '' : 's'} (stopping active encodes…).`,
                                            ).then(() => setSelectedJobIds(new Set()))}
                                        >
                                            {busy === 'cancel-selected' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                            Cancel selected
                                        </button>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={busy !== null || cancellableJobs.length === 0}
                                            onClick={() => runAction(
                                                'cancel-all',
                                                () => mediaAutomationApi.bulkCancelJobs(),
                                                `Cancelled ${cancellableJobs.length} active job${cancellableJobs.length === 1 ? '' : 's'} (stopping encodes…).`,
                                            ).then(() => setSelectedJobIds(new Set()))}
                                        >
                                            {busy === 'cancel-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                                            Cancel all active
                                        </button>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={busy !== null || (selectedFinishedIds.length === 0 && finishedJobs.length === 0)}
                                            onClick={() => {
                                                const ids = selectedFinishedIds.length > 0 ? selectedFinishedIds : undefined;
                                                const count = ids ? ids.length : finishedJobs.length;
                                                return runAction(
                                                    'clear-finished',
                                                    () => mediaAutomationApi.bulkRemoveJobs(ids),
                                                    `Cleared ${count} finished job${count === 1 ? '' : 's'}.`,
                                                ).then(() => setSelectedJobIds(new Set()));
                                            }}
                                        >
                                            {busy === 'clear-finished' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                            {selectedFinishedIds.length > 0 ? `Clear selected (${selectedFinishedIds.length})` : `Clear finished (${finishedJobs.length})`}
                                        </button>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={busy !== null || (selectedRetryableIds.length === 0 && retryableJobs.length === 0)}
                                            onClick={() => {
                                                const ids = selectedRetryableIds.length > 0 ? selectedRetryableIds : undefined;
                                                const count = ids ? ids.length : retryableJobs.length;
                                                return runAction(
                                                    'retry-failed',
                                                    () => mediaAutomationApi.bulkRetryJobs(ids),
                                                    `Queued ${count} job${count === 1 ? '' : 's'} for retry.`,
                                                ).then(() => setSelectedJobIds(new Set()));
                                            }}
                                        >
                                            {busy === 'retry-failed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                            {selectedRetryableIds.length > 0
                                                ? `Retry selected (${selectedRetryableIds.length})`
                                                : `Retry all failed (${retryableJobs.length})`}
                                        </button>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={busy !== null || (selectedRetryableIds.length === 0 && retryableJobs.length === 0)}
                                            onClick={() => {
                                                const ids = selectedRetryableIds.length > 0 ? selectedRetryableIds : undefined;
                                                const count = ids ? ids.length : retryableJobs.length;
                                                return runAction(
                                                    'retry-cpu-failed',
                                                    () => mediaAutomationApi.bulkRetryJobs(ids, { forceCpu: true }),
                                                    `Queued ${count} job${count === 1 ? '' : 's'} for CPU retry.`,
                                                ).then(() => setSelectedJobIds(new Set()));
                                            }}
                                        >
                                            {busy === 'retry-cpu-failed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                                            {selectedRetryableIds.length > 0
                                                ? `Retry (CPU) selected (${selectedRetryableIds.length})`
                                                : `Retry (CPU) all failed (${retryableJobs.length})`}
                                        </button>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={busy !== null || selectedDenyPaths.length === 0}
                                            onClick={() => runAction(
                                                'deny-paths',
                                                () => mediaAutomationApi.denyPaths(selectedDenyPaths),
                                                `Denied ${selectedDenyPaths.length} path${selectedDenyPaths.length === 1 ? '' : 's'}.`,
                                            ).then(() => setSelectedJobIds(new Set()))}
                                        >
                                            {busy === 'deny-paths' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                            Deny selected paths ({selectedDenyPaths.length})
                                        </button>
                                    </div>
                                </div>
                                <p className="mt-2 text-xs text-muted">
                                    Dry-run / completed jobs cannot be cancelled - use Clear finished to remove them. Cancel all active stops queued and running work. Retry all failed re-queues failed and cancelled jobs.
                                </p>
                            </section>
                            {filteredJobs.length === 0 ? (
                                <div className={`${panelClass} p-6 text-center text-sm text-muted`}>
                                    {t('mediaAutomation.queue.noMatches', { filters: queueSearch.trim() || queueLibraryFilter || queuePipelineFilter || queueErrorFilter.trim() ? t('mediaAutomation.queue.filtersSuffix') : '' })}
                                </div>
                            ) : (
                                <>
                                    {pagedJobs.map((job) => {
                                const jobId = job.id;
                                const state = jobStateValue(job);
                                const dryRunJob = jobIsDryRun(job);
                                const jobState = dryRunJob && ['completed', 'succeeded', 'success'].includes(state)
                                    ? 'dry-run'
                                    : (job.phase || job.state || job.status);
                                const terminal = isTerminalJob(job);
                                const percent = jobProgressPercent(job);
                                const progressMeta = jobProgressMeta(job);
                                const errorText = jobErrorText(job.error);
                                const canCancel = isCancellableJob(job);
                                const cancelPending = isCancelPendingJob(job);
                                const isActive = (canCancel || cancelPending) && ['running', 'processing', 'active', 'probing', 'planning', 'planned', 'verifying', 'committing', 'cancelling'].includes(String(job.phase || state).toLowerCase());
                                const canRetry = ['failed', 'cancelled', 'canceled', 'error'].includes(state);
                                const canSkip = state === 'queued' && !cancelPending;
                                const selected = selectedJobIds.has(String(jobId));
                                return (
                                    <article key={String(jobId)} className={`${listCardClass} cursor-pointer p-4 ${selected ? 'border-plex/50' : ''} ${terminalJobCardTone(job)}`} onClick={() => openJobDetail(jobId)}>
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="flex min-w-0 gap-3">
                                                <input
                                                    type="checkbox"
                                                    className="mt-1 h-4 w-4 shrink-0 rounded border-border bg-background text-plex focus:ring-plex"
                                                    checked={selected}
                                                    onClick={(event) => event.stopPropagation()}
                                                    onChange={() => toggleJobSelected(jobId)}
                                                    aria-label={`Select job ${jobId}`}
                                                />
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <StatusPill value={jobStatusLabel(cancelPending ? 'cancelling' : jobState, t)} />
                                                        <HardwareBadge job={job} />
                                                        <ProfileBadge job={job} pipelines={pipelines} />
                                                        {(Array.isArray(job.metadata?.tags) ? job.metadata.tags : []).map((tag: string) => (
                                                            <span key={tag} className="rounded border border-plex/30 bg-plex/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-plex">{tag}</span>
                                                        ))}
                                                        <span className="text-xs text-muted">#{jobId}</span>
                                                        {job.priority != null && <span className="text-xs text-muted">P{job.priority}</span>}
                                                        {!terminal && percent != null && <span className="text-xs font-semibold text-plex">{Math.round(percent)}%</span>}
                                                        {!terminal && progressMeta.etaLabel && <span className="text-xs text-amber-300">{t('mediaAutomation.progress.eta', { value: progressMeta.etaLabel })}</span>}
                                                        {!terminal && progressMeta.speedLabel && <span className="text-xs text-muted">{progressMeta.speedLabel}</span>}
                                                        {!terminal && progressMeta.fpsLabel && <span className="text-xs text-muted">{progressMeta.fpsLabel}</span>}
                                                    </div>
                                                    {jobHardwareInfo(job)?.fallback && (
                                                        <p className="mt-1 text-xs text-amber-300">
                                                            {t('mediaAutomation.jobs.hardwareFallback', { requested: jobHardwareInfo(job)?.requested ? ` (wanted ${jobHardwareInfo(job)?.requested})` : '' })}
                                                        </p>
                                                    )}
                                                    <p
                                                        className="mt-2 truncate font-semibold text-text"
                                                        title={String(job.path || job.sourcePath || '')}
                                                    >
                                                        {toDisplayPath(String(job.path || job.sourcePath || ''), {
                                                            relative: relativePaths,
                                                            libraryRoot: typeof job.libraryRoot === 'string' ? job.libraryRoot : null,
                                                            libraryId: job.libraryId,
                                                            libraries,
                                                            libraryRoots: libraries.map((library) => library.rootPath),
                                                        }) || t('mediaAutomation.jobs.pathNotReported')}
                                                    </p>
                                                    <p className="mt-1 text-xs text-muted">{formatTime(job.finishedAt || job.completedAt || job.createdAt)}</p>
                                                    {(() => {
                                                        const outcome = jobQueueOutcomeSummary(job);
                                                        if (!outcome) return null;
                                                        if (outcome.skipped) {
                                                            return (
                                                                <p className="mt-1 text-xs font-semibold text-amber-300">
                                                                    {t('mediaAutomation.progress.skipped', { reason: formatSkipReasonLabel(outcome.skipReason) })}
                                                                </p>
                                                            );
                                                        }
                                                        const parts = [outcome.codecLine, outcome.sizeLine].filter(Boolean);
                                                        return (
                                                            <p className="mt-1 text-xs text-muted">
                                                                {parts.join(' · ')}
                                                                {outcome.savedLine && (
                                                                    <span className="text-emerald-300">
                                                                        {parts.length ? ' · ' : ''}
                                                                        {t('mediaAutomation.progress.saved', { value: outcome.savedLine })}
                                                                        {outcome.savingsPercent != null && outcome.savingsPercent > 0
                                                                            ? ` (${outcome.savingsPercent}%)`
                                                                            : ''}
                                                                    </span>
                                                                )}
                                                            </p>
                                                        );
                                                    })()}
                                                    {!terminal && progressMeta.elapsedLabel && (
                                                        <p className="mt-1 text-xs text-muted">{t('mediaAutomation.progress.encoded', { value: progressMeta.elapsedLabel })}</p>
                                                    )}
                                                    {isActive && percent == null && (
                                                        <p className="mt-1 text-xs text-amber-300">{t('mediaAutomation.progress.waitingForProgress')}</p>
                                                    )}
                                                    {dryRunJob && ['completed', 'succeeded', 'success'].includes(state) && (
                                                        <p className="mt-1 text-xs text-amber-300">{jobDryRunReason(job)}</p>
                                                    )}
                                                    {!terminal && jobLiveCommand(job) && (
                                                        <p className="mt-1 truncate font-mono text-[11px] text-muted" title={jobLiveCommand(job)}>{jobLiveCommand(job)}</p>
                                                    )}
                                                    {errorText && <p className="mt-2 text-xs text-red-300">{errorText}</p>}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-2" onClick={(event) => event.stopPropagation()}>
                                                {canSkip && (
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={busy !== null || (Number(job.priority) || 0) >= 999}
                                                        title="Move to the front of the queue"
                                                        onClick={() => runAction(
                                                            `front-${jobId}`,
                                                            () => mediaAutomationApi.setPriority(jobId, Math.min(999, queuedTopPriority + 1)),
                                                            'Moved to front of queue.',
                                                        )}
                                                    >
                                                        {busy === `front-${jobId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpToLine className="h-4 w-4" />} Front
                                                    </button>
                                                )}
                                                {canSkip && job.pipelineId != null && <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void runEstimate(job)}><Gauge className="h-4 w-4" /> Estimate</button>}
                                                {canSkip && <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => runAction(`skip-${jobId}`, () => mediaAutomationApi.skipJob(jobId), 'Job skipped.')}><SkipForward className="h-4 w-4" /> Skip</button>}
                                                {canRetry && <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => runAction(`retry-${jobId}`, () => mediaAutomationApi.retryJob(jobId), 'Job queued for retry.')}><RotateCcw className="h-4 w-4" /> Retry</button>}
                                                {canCancel && <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => runAction(`cancel-${jobId}`, () => mediaAutomationApi.cancelJob(jobId), 'Stopping encode…')}><X className="h-4 w-4" /> Cancel</button>}
                                                {cancelPending && (
                                                    <button type="button" className={buttonClass} disabled title="Waiting for FFmpeg to stop">
                                                        <Loader2 className="h-4 w-4 animate-spin" /> Cancelling…
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        {!terminal && (percent != null || isActive) && (
                                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background">
                                                <div
                                                    className={`h-full rounded-full bg-plex transition-all ${percent == null ? 'animate-pulse w-1/5' : ''}`}
                                                    style={percent == null ? undefined : { width: `${Math.max(2, Math.min(100, percent))}%` }}
                                                />
                                            </div>
                                        )}
                                    </article>
                                );
                                    })}
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <p className="text-xs text-muted">
                                            Showing {Math.min(filteredJobs.length, (queuePage - 1) * queuePageSize + 1)}
                                            -
                                            {Math.min(filteredJobs.length, queuePage * queuePageSize)}
                                            {' '}of {filteredJobs.length}
                                            {jobs.length >= QUEUE_JOBS_FETCH_LIMIT ? ` (loaded first ${QUEUE_JOBS_FETCH_LIMIT})` : ''}
                                        </p>
                                        {queuePageCount > 1 && (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={queuePage <= 1}
                                                    onClick={() => setQueuePage((page) => Math.max(1, page - 1))}
                                                >
                                                    Previous
                                                </button>
                                                <span className="text-sm text-muted">
                                                    Page {queuePage} of {queuePageCount}
                                                </span>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={queuePage >= queuePageCount}
                                                    onClick={() => setQueuePage((page) => Math.min(queuePageCount, page + 1))}
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {tab === 'pipelines' && (
                <div className="space-y-4">
                    <MediaAutomationSetupChecklist
                        status={status}
                        libraries={libraries}
                        pipelines={pipelines}
                        compact
                        onAction={handleSetupAction}
                    />
                    {postSavePipeline && (
                        <section className={`${panelClass} border-plex/30 p-5`}>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h2 className="font-bold text-text">Pipeline saved - next steps</h2>
                                    <p className="mt-1 text-sm text-muted">
                                        {postSavePipeline.name} is ready to validate. Work through these before expecting files to change.
                                    </p>
                                </div>
                                <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5" onClick={() => setPostSavePipeline(null)} aria-label="Dismiss">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <ol className="mt-4 space-y-2 text-sm text-text">
                                <li className="rounded-lg bg-background/40 px-3 py-2">1. {String(postSavePipeline.samplePath || '').trim() ? 'Sample file is set - run Dry-run on the card below.' : 'Edit the pipeline and save a sample file.'}</li>
                                <li className="rounded-lg bg-background/40 px-3 py-2">
                                    2. {postSavePipeline.outputMode === 'dry-run'
                                        ? 'Still plan-only - switch to Copy or Replace when you want real writes.'
                                        : 'Output can write - confirm Settings → Safe fallback is not Dry run.'}
                                </li>
                                <li className="rounded-lg bg-background/40 px-3 py-2">3. Start the worker, then Queue sample or Scan now.</li>
                            </ol>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className={buttonClass}
                                    onClick={() => {
                                        const match = pipelines.find((pipeline) => pipeline.name === postSavePipeline.name)
                                            || postSavePipeline;
                                        openPipelineEditor(match);
                                        setEditorAdvancedOpen(true);
                                        setForceSampleSection(true);
                                        setPostSavePipeline(null);
                                    }}
                                >
                                    <Pencil className="h-4 w-4" /> Edit pipeline
                                </button>
                                {postSavePipeline.outputMode === 'dry-run' && (
                                    <button
                                        type="button"
                                        className={primaryButtonClass}
                                        onClick={() => {
                                            const match = pipelines.find((pipeline) => pipeline.name === postSavePipeline.name) || postSavePipeline;
                                            openPipelineEditor({ ...match, outputMode: 'copy' });
                                            setPostSavePipeline(null);
                                        }}
                                    >
                                        I want real writes
                                    </button>
                                )}
                                <button type="button" className={buttonClass} onClick={() => handleSetupAction('start-worker')}>
                                    <CirclePlay className="h-4 w-4" /> Start worker
                                </button>
                            </div>
                        </section>
                    )}
                    <section className={`${panelClass} p-5`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-lg font-bold tracking-tight text-text">Your pipelines</h2>
                                <p className="mt-1 text-sm leading-relaxed text-muted">Pipelines decide which files match and what FFmpeg does. Start from a template if you are unsure.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className={buttonClass}
                                    onClick={() => {
                                        const pack = buildEncodeProfilePack();
                                        downloadEncodeProfilePack(pack);
                                        toast('Encode profile pack downloaded.');
                                    }}
                                >
                                    <Save className="h-4 w-4" /> Export profiles
                                </button>
                                <button type="button" className={buttonClass} onClick={() => profilesFileRef.current?.click()}>
                                    <Upload className="h-4 w-4" /> Import profiles
                                </button>
                                <input
                                    ref={profilesFileRef}
                                    type="file"
                                    accept="application/json,.json"
                                    className="hidden"
                                    onChange={async (event) => {
                                        const file = event.target.files?.[0];
                                        event.target.value = '';
                                        if (!file) return;
                                        try {
                                            const pack = parseEncodeProfilePack(JSON.parse(await file.text()));
                                            setBusy('import-profiles');
                                            for (const preset of pack.presets) {
                                                await mediaAutomationApi.createPipeline({
                                                    ...emptyPipeline(),
                                                    ...preset.pipeline,
                                                    name: preset.pipeline.name || preset.label,
                                                    samplePath: '',
                                                });
                                            }
                                            toast(`Imported ${pack.presets.length} profile${pack.presets.length === 1 ? '' : 's'}.`);
                                            await load(true);
                                            selectTab('pipelines');
                                        } catch (error) {
                                            toast(error instanceof Error ? error.message : 'Failed to import profile pack', 'error');
                                        } finally {
                                            setBusy(null);
                                        }
                                    }}
                                />
                                <button type="button" className={buttonClass} onClick={() => setTemplatePickerOpen(true)}>
                                    <Layers3 className="h-4 w-4" /> Use template
                                </button>
                                <button type="button" className={primaryButtonClass} onClick={() => openPipelineEditor()}>
                                    <Plus className="h-4 w-4" /> Add pipeline
                                </button>
                            </div>
                        </div>
                    </section>
                    {pipelines.length === 0 ? (
                        <section className={`${panelClass} p-6`}>
                            <div className="mx-auto max-w-2xl text-center">
                                <Layers3 className="mx-auto h-10 w-10 text-plex" />
                                <h3 className="mt-3 text-lg font-bold text-text">Create your first pipeline</h3>
                                <p className="mt-2 text-sm text-muted">Pick a common goal - you can change hardware, matching, and output before anything writes.</p>
                            </div>
                            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                {PIPELINE_STARTER_IDS.map((id) => {
                                    const preset = PIPELINE_PRESETS.find((entry) => entry.id === id);
                                    if (!preset) return null;
                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            className="rounded-xl border border-border bg-background/30 p-4 text-left transition hover:border-plex/50 hover:bg-plex/10"
                                            onClick={() => openPipelineFromPreset(preset.pipeline)}
                                        >
                                            <p className="font-bold text-text">{preset.label}</p>
                                            <p className="mt-1 text-xs text-muted">{preset.detail}</p>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="mt-4 flex flex-wrap justify-center gap-2">
                                <button type="button" className={buttonClass} onClick={() => setTemplatePickerOpen(true)}>Browse all templates…</button>
                                <button type="button" className={buttonClass} onClick={() => openPipelineEditor()}>Blank pipeline</button>
                            </div>
                        </section>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {pipelines.map((pipeline) => {
                                const samplePath = String(pipeline.samplePath || '').trim();
                                return (
                                <article key={String(pipeline.id ?? pipeline.name)} className={`${listCardClass} p-5`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-bold text-text">{pipeline.name}</h3>
                                                <StatusPill value={pipeline.enabled ? 'enabled' : 'disabled'} />
                                            </div>
                                            <p className="mt-2 text-sm text-text">{summarizePipelineOutcome(pipeline)}</p>
                                            <p className="mt-2 text-xs text-muted">{summarizeMatchRules(pipeline.rules)}</p>
                                        </div>
                                        <div className="flex gap-1">
                                            <button
                                                type="button"
                                                className={buttonClass}
                                                title="Copy pipeline"
                                                aria-label={`Copy ${pipeline.name}`}
                                                onClick={() => copyPipeline(pipeline)}
                                            >
                                                <Copy className="h-4 w-4" />
                                            </button>
                                            <button type="button" className={buttonClass} onClick={() => openPipelineEditor(pipeline)}><Pencil className="h-4 w-4" /></button>
                                            <button type="button" className={buttonClass} disabled={pipeline.id === undefined || busy !== null} onClick={() => {
                                                if (pipeline.id === undefined) return;
                                                void askConfirm(`Delete pipeline "${pipeline.name}"?`, {
                                                    title: 'Delete pipeline?',
                                                    confirmLabel: 'Delete',
                                                    cancelLabel: 'Keep',
                                                }).then((ok) => {
                                                    if (!ok) return;
                                                    void runAction(`delete-pipeline-${pipeline.id}`, () => mediaAutomationApi.deletePipeline(pipeline.id!), 'Pipeline deleted.');
                                                });
                                            }}><Trash2 className="h-4 w-4 text-red-300" /></button>
                                        </div>
                                    </div>
                                    {samplePath ? (
                                        <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-background/30 p-3">
                                            <p className="truncate font-mono text-[11px] text-plex" title={samplePath}>{samplePath}</p>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    className={primaryButtonClass}
                                                    disabled={busy !== null || pipeline.id === undefined}
                                                    onClick={() => void queuePipelineSample(pipeline)}
                                                >
                                                    {busy === `queue-sample-${pipeline.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                                    Queue sample
                                                </button>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={busy !== null || pipeline.id === undefined}
                                                    onClick={() => void queuePipelineSample(pipeline, { dryRun: true })}
                                                >
                                                    {busy === `test-pipeline-${pipeline.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                                    Dry-run
                                                </button>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={pipeline.id === undefined}
                                                    onClick={() => setReportSeed({
                                                        pipelineId: pipeline.id,
                                                        forcePipeline: true,
                                                    })}
                                                >
                                                    <FileBarChart2 className="h-4 w-4" />
                                                    Report
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-3 space-y-2">
                                            <p className="text-xs text-muted">No sample file saved yet - edit the pipeline and set one for one-click queueing.</p>
                                            <button
                                                type="button"
                                                className={buttonClass}
                                                disabled={pipeline.id === undefined}
                                                onClick={() => setReportSeed({
                                                    pipelineId: pipeline.id,
                                                    forcePipeline: true,
                                                })}
                                            >
                                                <FileBarChart2 className="h-4 w-4" />
                                                Report
                                            </button>
                                        </div>
                                    )}
                                </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {tab === 'libraries' && (
                <div className="space-y-4">
                    <section className={`${panelClass} p-5`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-lg font-bold tracking-tight text-text">Your libraries</h2>
                                <p className="mt-1 text-sm leading-relaxed text-muted">
                                    Libraries are scan roots the container can see. Pipelines decide which files match and what FFmpeg does.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {libraries.length > 0 && (
                                    <>
                                        <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-background/40 px-3 py-2 text-sm font-semibold text-text">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                                                checked={allLibrariesSelected}
                                                onChange={() => setSelectedLibraryIds(allLibrariesSelected ? new Set() : new Set(selectableLibraryIds))}
                                            />
                                            Select all
                                            {selectedLibraryIds.size > 0 && (
                                                <span className="font-normal text-muted">· {selectedLibraryIds.size}</span>
                                            )}
                                        </label>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={busy !== null || selectedEnabledLibraries.length === 0}
                                            onClick={() => void disableSelectedLibraries()}
                                        >
                                            {busy === 'disable-libraries' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                            Disable selected{selectedEnabledLibraries.length > 0 ? ` (${selectedEnabledLibraries.length})` : ''}
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null || !!(status.scanning || status.scanProgress?.running)}
                                    onClick={() => {
                                        const enabledRoots = libraries
                                            .filter((library) => library.enabled !== false)
                                            .map((library) => String(library.rootPath || '').trim())
                                            .filter(Boolean);
                                        void runScanNow({}, enabledRoots);
                                    }}
                                >
                                    {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4" />}
                                    Scan now
                                </button>
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null || !!(status.scanning || status.scanProgress?.running)}
                                    onClick={() => void runScanNow({ preview: true })}
                                >
                                    {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                                    Preview
                                </button>
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null || !!(status.scanning || status.scanProgress?.running)}
                                    onClick={() => void runScanNow({ planOnly: true })}
                                >
                                    {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                    Plan only
                                </button>
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null || !(status.scanning || status.scanProgress?.running)}
                                    onClick={() => runAction('cancel-scan', cancelScanWithConfirm, 'Scan cancel requested.')}
                                >
                                    {busy === 'cancel-scan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                                    Cancel scan
                                </button>
                                <button type="button" className={primaryButtonClass} onClick={() => setLibraryDraft(emptyLibrary())}>
                                    <Plus className="h-4 w-4" /> New library
                                </button>
                            </div>
                        </div>
                        <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-border/60 pt-4 text-sm sm:grid-cols-3">
                            <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2.5">
                                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Last scan</dt>
                                <dd className="mt-1 font-semibold text-text">
                                    {status.scanning || status.scanProgress?.running
                                        ? `Scanning… ${status.scanProgress?.discovered || 0} discovered${status.scanProgress?.percent != null ? ` · ${Math.round(status.scanProgress.percent)}%` : ''}`
                                        : formatTime(status.lastScanAt)}
                                    {!status.scanning && status.lastScanResult ? ` · ${status.lastScanResult.enqueued || 0} queued` : ''}
                                </dd>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2.5">
                                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Periodic scan</dt>
                                <dd className="mt-1 font-semibold text-text">
                                    {status.libraryScanEnabled === false
                                        ? 'Disabled'
                                        : status.periodicScanning
                                            ? `Every ${status.libraryScanIntervalMinutes || 360}m`
                                            : 'Idle'}
                                </dd>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2.5">
                                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Watcher</dt>
                                <dd className="mt-1 flex items-center gap-2 font-semibold text-text">
                                    <Radar className="h-3.5 w-3.5 text-plex" />
                                    {status.libraryWatchConfigured && status.watchEnvEnabled === false
                                        ? 'Blocked: set MEDIA_AUTOMATION_ENABLE_WATCH=1'
                                        : status.libraryWatchEnabled === false
                                            ? 'Disabled'
                                            : status.watch?.watching
                                                ? `Watching ${status.watch.roots?.length || 0} root(s)`
                                                : 'Not watching'}
                                </dd>
                            </div>
                        </dl>
                    </section>
                    {libraries.length === 0 ? (
                        <section className={`${panelClass} p-6`}>
                            <div className="mx-auto max-w-2xl text-center">
                                <FolderCog className="mx-auto h-10 w-10 text-plex" />
                                <h3 className="mt-3 text-lg font-bold text-text">Map your first library</h3>
                                <p className="mt-2 text-sm text-muted">
                                    Use a container path under your media mount (e.g. <span className="font-mono text-plex">/media/movies</span>), not a host Unraid path.
                                </p>
                            </div>
                            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {[
                                    { name: 'Movies', rootPath: '/media/movies' },
                                    { name: 'TV', rootPath: '/media/tv' },
                                ].map((starter) => (
                                    <button
                                        key={starter.name}
                                        type="button"
                                        className="rounded-xl border border-border bg-background/30 p-4 text-left transition hover:border-plex/50 hover:bg-plex/10"
                                        onClick={() => setLibraryDraft({ ...emptyLibrary(), name: starter.name, rootPath: starter.rootPath })}
                                    >
                                        <p className="font-bold text-text">{starter.name}</p>
                                        <p className="mt-1 font-mono text-xs text-plex">{starter.rootPath}</p>
                                    </button>
                                ))}
                            </div>
                            <div className="mt-4 flex justify-center">
                                <button type="button" className={buttonClass} onClick={() => setLibraryDraft(emptyLibrary())}>
                                    Blank library
                                </button>
                            </div>
                        </section>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {libraries.map((library) => {
                                const libraryKey = String(library.id ?? library.name);
                                const health = libraryPathHealth[libraryKey];
                                const queueCount = countJobsForLibrary(jobs, library);
                                const pipelineName = libraryPipelineLabel(library, pipelines);
                                return (
                                    <article key={libraryKey} className={`${listCardClass} p-5 ${library.enabled === false ? 'opacity-70' : ''}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex min-w-0 items-start gap-3">
                                                <input
                                                    type="checkbox"
                                                    className="mt-1 h-4 w-4 shrink-0 rounded border-border bg-background text-plex focus:ring-plex"
                                                    checked={library.id !== undefined && selectedLibraryIds.has(String(library.id))}
                                                    disabled={library.id === undefined}
                                                    aria-label={`Select ${library.name}`}
                                                    onChange={() => {
                                                        if (library.id !== undefined) toggleLibrarySelected(String(library.id));
                                                    }}
                                                />
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="font-bold text-text">{library.name}</h3>
                                                        {queueCount > 0 && (
                                                            <span className="rounded-full border border-plex/30 bg-plex/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-plex">
                                                                {queueCount} in queue
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-2 text-sm text-text">{summarizeLibraryOutcome(library, pipelines)}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-2 shrink-0" title={library.enabled === false ? 'Disabled — skipped by scan and watch' : 'Enabled'}>
                                                    <span className="hidden text-[10px] font-bold uppercase tracking-wide text-muted sm:inline">Enabled</span>
                                                    <SettingsSwitch
                                                        className="ml-0"
                                                        checked={library.enabled !== false}
                                                        disabled={library.id === undefined}
                                                        onChange={(enabled) => void setLibraryEnabled(library, enabled)}
                                                    />
                                                </div>
                                                <button type="button" className={buttonClass} onClick={() => setLibraryDraft({ ...emptyLibrary(), ...library })}>
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={library.id === undefined || busy !== null}
                                                    onClick={async () => {
                                                        const ok = library.id !== undefined && await askConfirm(`Delete library "${library.name}"?`, {
                                                            title: 'Delete library?',
                                                            confirmLabel: 'Delete',
                                                            cancelLabel: 'Keep',
                                                        });
                                                        if (ok) {
                                                            runAction(`delete-library-${library.id}`, () => mediaAutomationApi.deleteLibrary(library.id!), 'Library deleted.');
                                                        }
                                                    }}
                                                >
                                                    <Trash2 className="h-4 w-4 text-red-300" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-background/30 p-3 text-xs">
                                            <div>
                                                <p className="text-muted">Root</p>
                                                <p className="mt-0.5 truncate font-mono text-plex" title={library.rootPath}>{library.rootPath || '-'}</p>
                                            </div>
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <div>
                                                    <p className="text-muted">Pipeline</p>
                                                    <p className="mt-0.5 break-all text-text">
                                                        {pipelineName === 'Automatic' ? 'Automatic - first matching' : pipelineName}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-muted">Output</p>
                                                    <p className="mt-0.5 break-all text-text">{library.outputPath || 'Pipeline default'}</p>
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <p className="text-muted">Quarantine</p>
                                                    <p className="mt-0.5 break-all text-text">{library.quarantinePath || 'Not set'}</p>
                                                </div>
                                            </div>
                                        </div>
                                        {library.id !== undefined && (
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={busy !== null || !!(status.scanning || status.scanProgress?.running)}
                                                    onClick={() => void runScanNow({ preview: true, libraryId: library.id })}
                                                >
                                                    {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                                                    Preview
                                                </button>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={busy !== null || !!(status.scanning || status.scanProgress?.running)}
                                                    onClick={() => void runScanNow({ planOnly: true, libraryId: library.id })}
                                                >
                                                    {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                                    Plan only
                                                </button>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={busy !== null || !!(status.scanning || status.scanProgress?.running)}
                                                    onClick={() => void runScanNow({ libraryId: library.id }, [String(library.rootPath || '').trim()].filter(Boolean))}
                                                >
                                                    {busy === 'scan-now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4" />}
                                                    Scan
                                                </button>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={busy !== null}
                                                    onClick={async () => {
                                                        const key = `test-library-${library.id}`;
                                                        setBusy(key);
                                                        try {
                                                            const result = await mediaAutomationApi.testLibrary(library.id!) as { ok?: boolean; rootPath?: string; error?: string };
                                                            const ok = result?.ok !== false;
                                                            setLibraryPathHealth((current) => ({
                                                                ...current,
                                                                [libraryKey]: {
                                                                    ok,
                                                                    message: ok
                                                                        ? `Readable${result?.rootPath ? ` · ${result.rootPath}` : ''}`
                                                                        : (result?.error || 'Path check failed'),
                                                                },
                                                            }));
                                                            toast(ok ? 'Library path is readable.' : (result?.error || 'Library path check failed'), ok ? 'success' : 'error');
                                                        } catch (error) {
                                                            const message = error instanceof Error ? error.message : 'Library path check failed';
                                                            setLibraryPathHealth((current) => ({
                                                                ...current,
                                                                [libraryKey]: { ok: false, message },
                                                            }));
                                                            toast(message, 'error');
                                                        } finally {
                                                            setBusy(null);
                                                        }
                                                    }}
                                                >
                                                    {busy === `test-library-${library.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                                    Test path
                                                </button>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    onClick={() => setReportSeed({
                                                        libraryId: library.id,
                                                        libraryRoot: library.rootPath,
                                                        pipelineId: library.pipelineId ?? null,
                                                        forcePipeline: false,
                                                    })}
                                                >
                                                    <FileBarChart2 className="h-4 w-4" />
                                                    Report
                                                </button>
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    disabled={busy !== null}
                                                    onClick={async () => {
                                                        const ok = await askConfirm(
                                                            `Reset task history stats for "${library.name}"? Savings totals for this library will be cleared. Queue jobs are not affected.`,
                                                            {
                                                                title: 'Reset library stats?',
                                                                confirmLabel: 'Reset stats',
                                                                cancelLabel: 'Cancel',
                                                            },
                                                        );
                                                        if (!ok) return;
                                                        void runAction(
                                                            `reset-stats-${library.id}`,
                                                            () => mediaAutomationApi.clearHistory(library.id),
                                                            `Stats reset for ${library.name}.`,
                                                        );
                                                    }}
                                                >
                                                    {busy === `reset-stats-${library.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                                    Reset stats
                                                </button>
                                                {health && (
                                                    <p className={`text-xs ${health.ok ? 'text-emerald-300' : 'text-red-300'}`}>{health.message}</p>
                                                )}
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {tab === 'analyzer' && (
                <SavingsAnalyzerPanel
                    libraries={libraries}
                    pipelines={pipelines}
                    status={status}
                    toast={toast}
                    onEnqueued={() => load(true)}
                />
            )}

            {tab === 'history' && (
                <div className="space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-text">{t('mediaAutomation.history.title')}</h2>
                            <p className="mt-1 text-sm text-muted">{t('mediaAutomation.history.description')}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                                <span className="whitespace-nowrap" title={t('mediaAutomation.queue.relativePathsHint')}>
                                    {t('mediaAutomation.queue.relativePaths')}
                                </span>
                                <SettingsSwitch
                                    checked={relativePaths}
                                    onChange={(next) => {
                                        setRelativePaths(next);
                                        try {
                                            localStorage.setItem(RELATIVE_PATHS_KEY, next ? '1' : '0');
                                        } catch {
                                            // ignore
                                        }
                                    }}
                                />
                            </label>
                            {(['all', 'completed', 'failed', 'cancelled', 'dry-run'] as const).map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    className={`${buttonClass} ${historyFilter === value ? 'border-plex/40 bg-plex/15 text-plex' : ''}`}
                                    onClick={() => setHistoryFilter(value)}
                                >
                                    {t(value === 'all'
                                        ? 'mediaAutomation.queue.all'
                                        : value === 'completed'
                                            ? 'mediaAutomation.status.jobs.completed'
                                            : value === 'failed'
                                                ? 'mediaAutomation.status.jobs.failed'
                                                : value === 'cancelled'
                                                    ? 'mediaAutomation.status.jobs.cancelled'
                                                    : 'mediaAutomation.queue.dryRun')}
                                </button>
                            ))}
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null}
                                onClick={async () => {
                                    const ok = await askConfirm(
                                        'Reset ALL Media Automation task history and savings stats? This cannot be undone. Live queue jobs are not affected.',
                                        {
                                            title: 'Reset all stats?',
                                            confirmLabel: 'Reset all',
                                            cancelLabel: 'Cancel',
                                        },
                                    );
                                    if (!ok) return;
                                    void runAction('reset-stats-all', () => mediaAutomationApi.clearHistory(null), 'All history stats cleared.');
                                }}
                            >
                                {busy === 'reset-stats-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                Reset all stats
                            </button>
                        </div>
                    </div>
                    <input
                        className={fieldClass}
                        value={historySearch}
                        onChange={(event) => setHistorySearch(event.target.value)}
                        placeholder={t('mediaAutomation.history.searchPlaceholder')}
                    />
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatCard label={t('mediaAutomation.stats.saved7d')} value={formatBytes(status.savings?.['7d']?.bytesSaved)} hint={t('mediaAutomation.tabs.history')} icon={<CheckCircle2 className="h-4 w-4 text-emerald-200" />} tone="border-emerald-500/30 bg-emerald-500/10 text-text" />
                        <StatCard label={t('mediaAutomation.stats.encode7d')} value={formatDurationSeconds(Math.round(Number(status.savings?.['7d']?.encodeMs || 0) / 1000)) || '0s'} hint={t('mediaAutomation.tabs.history')} icon={<Gauge className="h-4 w-4 text-plex" />} tone="border-white/10 bg-white/[0.03] text-text" />
                        <StatCard label={t('mediaAutomation.stats.saved30d')} value={formatBytes(status.savings?.['30d']?.bytesSaved)} hint={t('mediaAutomation.tabs.history')} icon={<History className="h-4 w-4 text-sky-200" />} tone="border-sky-500/30 bg-sky-500/10 text-text" />
                        <StatCard label={t('mediaAutomation.stats.encode30d')} value={formatDurationSeconds(Math.round(Number(status.savings?.['30d']?.encodeMs || 0) / 1000)) || '0s'} hint={t('mediaAutomation.tabs.history')} icon={<Gauge className="h-4 w-4 text-muted" />} tone="border-white/10 bg-white/[0.03] text-text" />
                    </div>
                    <div className="space-y-2">
                        {historyEntries
                            .filter((entry) => {
                                const state = String(entry.state || '').toLowerCase();
                                if (historyFilter === 'completed') return ['succeeded', 'completed', 'success'].includes(state) && !entry.dryRun;
                                if (historyFilter === 'failed') return ['failed', 'error'].includes(state);
                                if (historyFilter === 'cancelled') return ['cancelled', 'canceled'].includes(state);
                                if (historyFilter === 'dry-run') return entry.dryRun === true;
                                return true;
                            })
                            .filter((entry) => {
                                if (!historySearch.trim()) return true;
                                const needle = historySearch.toLowerCase();
                                return `${entry.sourcePath || ''} ${entry.pipelineName || ''} ${(entry.tags || []).join(' ')} ${entry.id}`
                                    .toLowerCase()
                                    .includes(needle);
                            })
                            .map((entry) => {
                                const sizeSummary = historySizeSummary(entry, t);
                                return (
                                <article key={entry.id} className={`${panelClass} space-y-2 p-4`}>
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p
                                                    className="truncate font-semibold text-text"
                                                    title={entry.sourcePath}
                                                >
                                                    {pathBasename(entry.sourcePath || entry.id)}
                                                </p>
                                                {sizeSummary?.sizeLine ? (
                                                    <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-200">
                                                        {sizeSummary.sizeLine}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <p
                                                className="mt-1 truncate font-mono text-xs text-muted"
                                                title={entry.sourcePath}
                                            >
                                                {toDisplayPath(String(entry.sourcePath || ''), {
                                                    relative: relativePaths,
                                                    libraryId: entry.libraryId,
                                                    libraries,
                                                    libraryRoots: libraries.map((library) => library.rootPath),
                                                }) || entry.sourcePath}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-1">
                                            <StatusPill value={entry.dryRun ? 'dry-run' : asText(entry.state, 'unknown')} />
                                            <time
                                                className="text-xs text-muted"
                                                dateTime={entry.finishedAt || entry.startedAt || entry.createdAt || undefined}
                                                title={entry.startedAt && entry.finishedAt
                                                    ? t('mediaAutomation.history.timestampTooltip', { started: formatTime(entry.startedAt), finished: formatTime(entry.finishedAt) })
                                                    : undefined}
                                            >
                                                {formatTime(entry.finishedAt || entry.startedAt || entry.createdAt)}
                                            </time>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                                        {sizeSummary?.sizeLine ? (
                                            <span className="font-mono text-emerald-200">{sizeSummary.sizeLine}</span>
                                        ) : (
                                            <>
                                                <span>{t('mediaAutomation.history.sizeIn', { value: formatBytes(entry.sourceBytes) })}</span>
                                                <span>{t('mediaAutomation.history.sizeOut', { value: formatBytes(entry.outputBytes) })}</span>
                                            </>
                                        )}
                                        <span className="text-emerald-300">{t('mediaAutomation.history.saved', { value: formatBytes(entry.bytesSaved) })}{sizeSummary?.savingsPercent != null && sizeSummary.savingsPercent > 0 ? ` (${sizeSummary.savingsPercent}%)` : ''}</span>
                                        <span>{formatDurationSeconds(Math.round(Number(entry.durationMs || 0) / 1000)) || '0s'}</span>
                                        {entry.adapterLabel || entry.adapter ? <span>{entry.adapterLabel || entry.adapter}</span> : null}
                                        {(entry.tags || []).map((tag) => (
                                            <span key={tag} className="rounded border border-plex/30 bg-plex/10 px-1.5 py-0.5 text-plex">{tag}</span>
                                        ))}
                                    </div>
                                    {entry.delivery && (
                                        <p className="text-xs text-muted">
                                            {t('mediaAutomation.history.delivery')} {String((entry.delivery as { deliveredPath?: string; error?: string }).deliveredPath
                                                || (entry.delivery as { error?: string }).error
                                                || t('mediaAutomation.history.deliveryRecorded'))}
                                        </p>
                                    )}
                                    <button
                                        type="button"
                                        className={`${buttonClass} text-xs`}
                                        onClick={() => void openJobDetail(entry.id, { historyEntry: entry })}
                                    >
                                        Open job detail
                                    </button>
                                </article>
                                );
                            })}
                        {!historyEntries.length && (
                            <p className={`${panelClass} p-5 text-sm text-muted`}>No history yet. Finished jobs will appear here.</p>
                        )}
                    </div>
                </div>
            )}

            {tab === 'system' && (
                <MediaAutomationSystemPanel toast={toast} />
            )}

            {tab === 'activity' && (
                <div className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap gap-2">
                            {([
                                ['all', 'All'],
                                ['job', 'Jobs'],
                                ['scan', 'Scans'],
                                ['watch', 'Watcher'],
                                ['trigger', 'ARR'],
                            ] as const).map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    className={`${buttonClass} ${activityFilter === id ? 'border-plex/50 bg-plex/15 text-plex' : ''}`}
                                    onClick={() => setActivityFilter(id)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                            <span className="whitespace-nowrap">Per page</span>
                            <CustomSelect
                                compact
                                className="min-w-[5.5rem]"
                                value={activityPageSize}
                                onChange={(value) => {
                                    const next = Number(value) as typeof ACTIVITY_PAGE_SIZE_OPTIONS[number];
                                    if (!ACTIVITY_PAGE_SIZE_OPTIONS.includes(next)) return;
                                    setActivityPageSize(next);
                                    try {
                                        localStorage.setItem(ACTIVITY_PAGE_SIZE_KEY, String(next));
                                    } catch {
                                        // ignore
                                    }
                                }}
                                options={ACTIVITY_PAGE_SIZE_OPTIONS.map((size) => ({
                                    value: String(size),
                                    label: String(size),
                                }))}
                            />
                        </label>
                    </div>
                    {filteredActivity.length === 0 ? (
                        <EmptyState
                            icon={Activity}
                            title="No activity recorded"
                            detail="Worker, scan, watcher, and queue events will appear here once the worker is running."
                            actionLabel="Start worker"
                            onAction={() => runAction('start', () => mediaAutomationApi.control('start'), 'Worker started.')}
                        />
                    ) : (
                        <>
                            <div className={`${panelClass} divide-y divide-border/60 overflow-hidden`}>
                                {pagedActivity.map((entry, index) => (
                                    <div
                                        key={String(entry.id ?? `${activityPage}-${index}`)}
                                        className={`flex gap-3 p-4 ${entry.jobId != null ? 'cursor-pointer transition hover:bg-white/[0.03]' : ''}`}
                                        onClick={() => {
                                            if (entry.jobId != null) void openJobDetail(entry.jobId);
                                        }}
                                        onKeyDown={(event) => {
                                            if (entry.jobId == null) return;
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                void openJobDetail(entry.jobId);
                                            }
                                        }}
                                        role={entry.jobId != null ? 'button' : undefined}
                                        tabIndex={entry.jobId != null ? 0 : undefined}
                                    >
                                        <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusTone(entry.status).includes('red') ? 'bg-red-400' : statusTone(entry.status).includes('green') ? 'bg-green-400' : 'bg-plex'}`} />
                                        <div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-text">{entry.message || entry.action || entry.type || 'Automation event'}</p><time className="text-xs text-muted">{formatTime(entry.createdAt || entry.timestamp || entry.at)}</time></div><p className="mt-1 text-xs text-muted">{entry.type || entry.action || 'activity'}{entry.jobId != null && String(entry.jobId) !== '' ? ` · Job #${entry.jobId}` : ''}{entry.jobId != null ? ' · Open' : ''}</p></div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-muted">
                                    Showing {Math.min(filteredActivity.length, (activityPage - 1) * activityPageSize + 1)}
                                    -
                                    {Math.min(filteredActivity.length, activityPage * activityPageSize)}
                                    {' '}of {filteredActivity.length}
                                </p>
                                {activityPageCount > 1 && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={activityPage <= 1}
                                            onClick={() => setActivityPage((page) => Math.max(1, page - 1))}
                                        >
                                            Previous
                                        </button>
                                        <span className="text-sm text-muted">
                                            Page {activityPage} of {activityPageCount}
                                        </span>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={activityPage >= activityPageCount}
                                            onClick={() => setActivityPage((page) => Math.min(activityPageCount, page + 1))}
                                        >
                                            Next
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            <ModalPortal open={selectedJobId !== null}>
                {selectedJobId !== null && (
                    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={() => { setSelectedJobId(null); setSelectedJob(null); setJobLogs([]); }}>
                        <div className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl custom-scrollbar sm:max-w-5xl sm:rounded-2xl" onMouseDown={(event) => event.stopPropagation()}>
                            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur-md">
                                <div>
                                    <h2 className="text-lg font-bold text-text">Job detail</h2>
                                    <p className="text-xs text-muted">#{selectedJobId}</p>
                                </div>
                                <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text" onClick={() => { setSelectedJobId(null); setSelectedJob(null); setJobLogs([]); }}><X className="h-5 w-5" /></button>
                            </div>
                            <div className="space-y-5 p-5">
                                {jobDetailBusy && !selectedJob ? (
                                    <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-plex" /></div>
                                ) : !selectedJob ? (
                                    <p className="rounded-lg border border-border/60 bg-white/[0.03] p-4 text-sm text-muted">
                                        This job is no longer in the live queue and no history snapshot was found. It may have been pruned before history was recorded.
                                    </p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StatusPill
                                                value={
                                                    isCancelPendingJob(selectedJob)
                                                        ? 'cancelling'
                                                        : (
                                                            jobIsDryRun(selectedJob)
                                                            && ['completed', 'succeeded', 'success'].includes(String(selectedJob.state || selectedJob.status || '').toLowerCase())
                                                                ? 'dry-run'
                                                                : (selectedJob.phase || selectedJob.state || selectedJob.status)
                                                        )
                                                }
                                            />
                                            <HardwareBadge job={selectedJob} />
                                            <ProfileBadge job={selectedJob} pipelines={pipelines} />
                                            {selectedJob.priority != null && (
                                                <label className="flex items-center gap-2 text-xs text-muted">
                                                    Priority
                                                    {['queued', 'running'].includes(String(selectedJob.state || selectedJob.status || '').toLowerCase()) ? (
                                                        <input
                                                            className="w-20 rounded border border-border bg-background px-2 py-1 text-text"
                                                            type="number"
                                                            min={0}
                                                            max={999}
                                                            defaultValue={selectedJob.priority}
                                                            onBlur={(event) => {
                                                                const priority = Math.max(0, Math.min(999, Number(event.target.value) || 0));
                                                                if (selectedJobId == null) return;
                                                                void runAction(`priority-${selectedJobId}`, () => mediaAutomationApi.setPriority(selectedJobId, priority), 'Priority updated.')
                                                                    .then(() => openJobDetail(selectedJobId));
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className="text-text">P{selectedJob.priority}</span>
                                                    )}
                                                </label>
                                            )}
                                        </div>
                                        {selectedJob && (
                                            <div className="flex flex-wrap gap-2">
                                                {isCancellableJob(selectedJob) && (
                                                    <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => runAction(`cancel-${selectedJobId}`, () => mediaAutomationApi.cancelJob(selectedJobId!), 'Stopping encode…').then(() => openJobDetail(selectedJobId!))}>
                                                        {busy === `cancel-${selectedJobId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Cancel
                                                    </button>
                                                )}
                                                {isCancelPendingJob(selectedJob) && (
                                                    <button type="button" className={buttonClass} disabled title="Waiting for FFmpeg to stop">
                                                        <Loader2 className="h-4 w-4 animate-spin" /> Cancelling…
                                                    </button>
                                                )}
                                                {jobStateValue(selectedJob) === 'queued' && !selectedJob.cancelRequested && (
                                                    <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => runAction(`skip-${selectedJobId}`, () => mediaAutomationApi.skipJob(selectedJobId!), 'Job skipped.').then(() => openJobDetail(selectedJobId!))}>
                                                        <SkipForward className="h-4 w-4" /> Skip
                                                    </button>
                                                )}
                                                {['failed', 'cancelled', 'canceled', 'error'].includes(jobStateValue(selectedJob)) && (
                                                    <>
                                                        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => runAction(`retry-${selectedJobId}`, () => mediaAutomationApi.retryJob(selectedJobId!), 'Job queued for retry.').then(() => openJobDetail(selectedJobId!))}>
                                                            <RotateCcw className="h-4 w-4" /> Retry
                                                        </button>
                                                        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => runAction(`retry-cpu-${selectedJobId}`, () => mediaAutomationApi.retryJob(selectedJobId!, { forceCpu: true }), 'Job queued for CPU retry.').then(() => openJobDetail(selectedJobId!))}>
                                                            <Cpu className="h-4 w-4" /> Retry (CPU)
                                                        </button>
                                                    </>
                                                )}
                                                {jobIsDryRun(selectedJob) && String(selectedJob.path || selectedJob.sourcePath || '').trim() && (
                                                    <button
                                                        type="button"
                                                        className={primaryButtonClass}
                                                        disabled={busy !== null}
                                                        onClick={() => runAction(
                                                            `requeue-write-${selectedJobId}`,
                                                            () => mediaAutomationApi.enqueue(String(selectedJob.path || selectedJob.sourcePath), selectedJob.pipelineId),
                                                            'Queued again for a real write (still subject to Safe fallback / pipeline output mode).',
                                                        )}
                                                    >
                                                        <Play className="h-4 w-4" /> Queue for real write
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        <p className="break-all font-semibold text-text">{selectedJob?.path || selectedJob?.sourcePath || 'Path not reported'}</p>
                                        {(() => {
                                            const outcome = jobQueueOutcomeSummary(selectedJob);
                                            if (!outcome?.skipped) return null;
                                            return (
                                                <div className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100">
                                                    Skipped: {formatSkipReasonLabel(outcome.skipReason)}
                                                </div>
                                            );
                                        })()}
                                        {jobFinalPath(selectedJob) && (
                                            <div className="rounded-lg border border-border/70 bg-background/30 p-3 text-sm">
                                                <p className="text-xs text-muted">{jobIsDryRun(selectedJob) ? 'Planned output path' : 'Output path'}</p>
                                                <p className="mt-1 break-all font-mono text-xs text-plex">{jobFinalPath(selectedJob)}</p>
                                            </div>
                                        )}
                                        {selectedJob?.result && typeof selectedJob.result === 'object' && (selectedJob.result as { output?: { quarantinedPath?: string } }).output?.quarantinedPath && (
                                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-50">
                                                <p className="font-bold">Original quarantined</p>
                                                <p className="mt-1 break-all font-mono text-xs text-amber-100/90">
                                                    {String((selectedJob.result as { output?: { quarantinedPath?: string } }).output?.quarantinedPath)}
                                                </p>
                                                <p className="mt-2 text-xs text-amber-100/80">
                                                    Replace mode moved the previous file here after verify. Restore manually if needed, then Retry.
                                                </p>
                                            </div>
                                        )}
                                        {selectedJob?.result && typeof selectedJob.result === 'object' && (
                                            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                                                <div><dt className="text-muted">Bytes in</dt><dd className="mt-1 font-semibold text-text">{formatBytes(Number((selectedJob.result as { sourceBytes?: number }).sourceBytes))}</dd></div>
                                                <div><dt className="text-muted">Bytes out</dt><dd className="mt-1 font-semibold text-text">{formatBytes(Number((selectedJob.result as { outputBytes?: number }).outputBytes))}</dd></div>
                                                <div><dt className="text-muted">Saved</dt><dd className="mt-1 font-semibold text-emerald-300">{formatBytes(Number((selectedJob.result as { bytesSaved?: number }).bytesSaved))}</dd></div>
                                                <div><dt className="text-muted">Encode</dt><dd className="mt-1 font-semibold text-text">{formatDurationSeconds(Math.round(Number((selectedJob.result as { durationMs?: number }).durationMs || 0) / 1000)) || '-'}</dd></div>
                                            </dl>
                                        )}
                                        {(() => {
                                            const before = jobSourceSummary(selectedJob);
                                            const after = jobOutputSummary(selectedJob);
                                            if (!before && !after) return null;
                                            const sourceBytes = Number((selectedJob?.result as { sourceBytes?: number } | null)?.sourceBytes || 0) || before?.sizeBytes || 0;
                                            const outputBytes = Number((selectedJob?.result as { outputBytes?: number } | null)?.outputBytes || 0) || after?.sizeBytes || 0;
                                            const savingsPercent = after && sourceBytes > 0 && outputBytes > 0
                                                ? Math.round((1 - outputBytes / sourceBytes) * 1000) / 10
                                                : null;
                                            const videoLabel = (summary: MediaProbeSummary | null) => {
                                                if (!summary?.videoCodec) return null;
                                                return summary.videoProfile ? `${summary.videoCodec} (${summary.videoProfile})` : summary.videoCodec;
                                            };
                                            const rows: Array<{ label: string; from: string | null; to: string | null }> = [
                                                { label: 'Container', from: before?.container ?? null, to: after?.container ?? null },
                                                { label: 'Video', from: videoLabel(before), to: videoLabel(after) },
                                                { label: 'HDR', from: before?.hdrKind ?? null, to: after?.hdrKind ?? null },
                                                { label: 'Resolution', from: before?.resolution ?? null, to: after?.resolution ?? null },
                                                { label: 'Bit depth', from: before?.bitDepth ?? null, to: after?.bitDepth ?? null },
                                                { label: 'Frame rate', from: before?.frameRate ?? null, to: after?.frameRate ?? null },
                                                { label: 'Bitrate', from: formatBitrate(before?.bitrateKbps ?? null), to: formatBitrate(after?.bitrateKbps ?? null) },
                                                { label: 'Audio', from: before?.audioSummary ?? null, to: after?.audioSummary ?? null },
                                                { label: 'Size', from: before?.sizeBytes ? formatBytes(before.sizeBytes) : null, to: after?.sizeBytes ? formatBytes(after.sizeBytes) : null },
                                                { label: 'Duration', from: formatDurationSeconds(before?.durationSeconds), to: formatDurationSeconds(after?.durationSeconds) },
                                            ].filter((row) => row.from != null || row.to != null);
                                            if (rows.length === 0) return null;
                                            return (
                                                <div className="rounded-xl border border-border bg-background/30 p-4">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <h3 className="font-bold text-text">{after ? 'Before / after' : 'Source media'}</h3>
                                                        {savingsPercent != null && (
                                                            <span className={`text-xs font-semibold ${savingsPercent > 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                                                                {savingsPercent > 0 ? `${savingsPercent}% smaller` : `${Math.abs(savingsPercent)}% larger`}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="mt-3 overflow-x-auto">
                                                        <table className="w-full min-w-[420px] text-sm">
                                                            <thead>
                                                                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                                                                    <th className="py-1.5 pr-4 font-semibold" />
                                                                    <th className="py-1.5 pr-4 font-semibold">Source</th>
                                                                    {after && <th className="py-1.5 font-semibold">Output</th>}
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-border/40">
                                                                {rows.map((row) => {
                                                                    const changed = after != null && row.from != null && row.to != null && row.from !== row.to;
                                                                    return (
                                                                        <tr key={row.label}>
                                                                            <td className="py-1.5 pr-4 text-xs text-muted">{row.label}</td>
                                                                            <td className="py-1.5 pr-4 text-text">{row.from ?? '-'}</td>
                                                                            {after && (
                                                                                <td className={`py-1.5 ${changed ? 'font-semibold text-plex' : 'text-text'}`}>{row.to ?? '-'}</td>
                                                                            )}
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        {jobIsDryRun(selectedJob) && (
                                            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                                                {jobDryRunReason(selectedJob) || 'Dry-run completed: the worker only planned FFmpeg steps. No media was rewritten.'}
                                            </p>
                                        )}
                                        {selectedJob && (jobProgressPercent(selectedJob) != null || jobProgressMeta(selectedJob).etaLabel || jobProgressMeta(selectedJob).elapsedLabel) && (
                                            <div className="rounded-xl border border-plex/30 bg-plex/10 p-4 space-y-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <h3 className="font-bold text-text">Progress</h3>
                                                    <div className="flex flex-wrap gap-3 text-xs text-muted">
                                                        {jobProgressPercent(selectedJob) != null && (
                                                            <span className="font-semibold text-plex">{Math.round(jobProgressPercent(selectedJob)!)}%</span>
                                                        )}
                                                        {jobProgressMeta(selectedJob).etaLabel && (
                                                            <span className="text-amber-300">ETA {jobProgressMeta(selectedJob).etaLabel}</span>
                                                        )}
                                                        {jobProgressMeta(selectedJob).speedLabel && <span>{jobProgressMeta(selectedJob).speedLabel}</span>}
                                                        {jobProgressMeta(selectedJob).fpsLabel && <span>{jobProgressMeta(selectedJob).fpsLabel}</span>}
                                                    </div>
                                                </div>
                                                {jobProgressMeta(selectedJob).elapsedLabel && (
                                                    <p className="text-xs text-muted">Encoded {jobProgressMeta(selectedJob).elapsedLabel}</p>
                                                )}
                                                {jobProgressPercent(selectedJob) != null && (
                                                    <div className="h-2 overflow-hidden rounded-full bg-background">
                                                        <div className="h-full rounded-full bg-plex transition-all" style={{ width: `${Math.max(2, Math.min(100, jobProgressPercent(selectedJob)!))}%` }} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                                            <div><dt className="text-muted">Pipeline</dt><dd className="mt-1 text-text">{selectedJob?.pipelineName || selectedJob?.pipelineId || 'Automatic'}</dd></div>
                                            <div><dt className="text-muted">Attempts</dt><dd className="mt-1 text-text">{asText(selectedJob?.attempts)} / {asText(selectedJob?.maxAttempts)}</dd></div>
                                            <div><dt className="text-muted">Created</dt><dd className="mt-1 text-text">{formatTime(selectedJob?.createdAt)}</dd></div>
                                            <div><dt className="text-muted">Finished</dt><dd className="mt-1 text-text">{formatTime(selectedJob?.finishedAt || selectedJob?.completedAt)}</dd></div>
                                        </dl>
                                        {jobErrorText(selectedJob?.error) && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{jobErrorText(selectedJob?.error)}</p>}
                                        {jobErrorStderr(selectedJob?.error) && (
                                            <details className="rounded-lg border border-border/70 bg-background/30 p-3 text-sm">
                                                <summary className="cursor-pointer font-semibold text-text">FFmpeg output</summary>
                                                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted custom-scrollbar">{jobErrorStderr(selectedJob?.error)}</pre>
                                            </details>
                                        )}
                                        {Array.isArray(selectedJob?.metadata?.timeline) && (selectedJob.metadata.timeline as Array<{ phase?: string; at?: string }>).length > 0 && (
                                            <div className="rounded-xl border border-border bg-background/30 p-4">
                                                <h3 className="font-bold text-text">Timeline</h3>
                                                <ol className="mt-3 space-y-2 border-l border-border/60 pl-4">
                                                    {(selectedJob.metadata.timeline as Array<{ phase?: string; at?: string }>).map((entry, index) => (
                                                        <li key={`${entry.phase}-${entry.at}-${index}`} className="text-sm">
                                                            <span className="font-semibold text-text">{entry.phase || 'phase'}</span>
                                                            <span className="ml-2 text-xs text-muted">{formatTime(entry.at)}</span>
                                                        </li>
                                                    ))}
                                                </ol>
                                            </div>
                                        )}
                                        {jobLiveCommand(selectedJob) && (
                                            <div className="rounded-xl border border-plex/30 bg-plex/10 p-4">
                                                <h3 className="font-bold text-text">{jobIsDryRun(selectedJob) ? 'Planned command (not executed)' : 'Live command'}</h3>
                                                <p className="mt-2 break-all font-mono text-[11px] text-muted">{jobLiveCommand(selectedJob)}</p>
                                            </div>
                                        )}
                                        {jobPlans(selectedJob).length > 0 && (
                                            <div className="rounded-xl border border-border bg-background/30 p-4 space-y-3">
                                                <h3 className="font-bold text-text">Planned steps</h3>
                                                {jobPlans(selectedJob).map((plan, index) => (
                                                    <div key={index} className="rounded-lg border border-border/60 bg-card/40 p-3">
                                                        <p className="text-xs text-muted">Step {index + 1}: {plan.mode || plan.stepType || plan.kind || 'plan'}{plan.adapterLabel ? ` · ${plan.adapterLabel}` : ''}</p>
                                                        <p className="mt-2 break-all font-mono text-[11px] text-muted">
                                                            {Array.isArray(plan.args) && plan.args.length
                                                                ? [plan.executable || (plan.kind === 'ffmpeg' ? 'ffmpeg' : ''), ...plan.args].filter(Boolean).join(' ')
                                                                : 'No args recorded yet'}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="rounded-xl border border-border bg-background/30 p-4">
                                            <h3 className="mb-3 font-bold text-text">Activity / logs</h3>
                                            {jobLogs.length === 0 ? <p className="text-sm text-muted">No log entries for this job yet.</p> : (
                                                <div className="max-h-64 space-y-2 overflow-y-auto custom-scrollbar">
                                                    {jobLogs.map((entry, index) => (
                                                        <div key={String(entry.id ?? index)} className="rounded-lg bg-card/60 p-2 text-xs">
                                                            <div className="flex justify-between gap-2"><span className="font-semibold text-text">{entry.type || 'event'}</span><span className="text-muted">{formatTime(entry.createdAt || entry.timestamp || entry.at)}</span></div>
                                                            <p className="mt-1 text-muted">{entry.message || '-'}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </ModalPortal>

            <ModalPortal open={libraryDraft !== null}>
                {libraryDraft && (
                    <EditorShell title={libraryDraft.id === undefined ? 'New library' : 'Edit library'} onClose={() => setLibraryDraft(null)} onSave={saveLibrary} saving={savingEditor}>
                        <section className="space-y-4">
                            <div>
                                <h3 className="text-sm font-bold text-text">Source</h3>
                                <p className="mt-1 text-xs text-muted">Name and root path the container can read for discovery.</p>
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="space-y-2 text-sm font-semibold text-text">Name<input className={fieldClass} value={libraryDraft.name} onChange={(event) => setLibraryDraft({ ...libraryDraft, name: event.target.value })} placeholder="Movies" /></label>
                                <div className="flex items-end pb-2"><label className="flex items-center gap-3 text-sm font-semibold text-text"><SettingsSwitch checked={libraryDraft.enabled !== false} onChange={(enabled) => setLibraryDraft({ ...libraryDraft, enabled })} /> Enabled</label></div>
                            </div>
                            <PathBrowserField
                                label="Root path"
                                value={libraryDraft.rootPath}
                                onChange={(rootPath) => setLibraryDraft({ ...libraryDraft, rootPath })}
                                placeholder="/media/movies"
                            />
                            {isBroadLibraryRoot(libraryDraft.rootPath) && (
                                <p className="text-xs text-amber-300">
                                    This looks like a whole-library folder. Scans will walk everything under it and can queue thousands of files. Prefer a narrower path for tests.
                                </p>
                            )}
                        </section>
                        <section className="space-y-4 border-t border-border/60 pt-4">
                            <div>
                                <h3 className="text-sm font-bold text-text">Routing</h3>
                                <p className="mt-1 text-xs text-muted">Automatic uses the first matching enabled pipeline. Optional overrides apply only to this library.</p>
                            </div>
                            <label className="block space-y-2 text-sm font-semibold text-text">Assigned pipeline
                                <CustomSelect
                                    value={String(libraryDraft.pipelineId ?? '')}
                                    onChange={(pipelineId) => setLibraryDraft({ ...libraryDraft, pipelineId })}
                                    options={[{ value: '', label: 'Automatic / first matching pipeline' }, ...pipelines.map((pipeline) => ({ value: String(pipeline.id ?? ''), label: pipeline.name }))]}
                                />
                            </label>
                            <label className="block space-y-2 text-sm font-semibold text-text">Tags
                                <input
                                    className={fieldClass}
                                    value={(libraryDraft.tags || []).join(', ')}
                                    placeholder="tv, priority"
                                    onChange={(event) => setLibraryDraft({
                                        ...libraryDraft,
                                        tags: event.target.value.split(/[,\s]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
                                    })}
                                />
                                <span className="block text-xs font-normal text-muted">Jobs inherit these tags for worker-group matching.</span>
                            </label>
                            <label className="block space-y-2 text-sm font-semibold text-text">Delivery target
                                <CustomSelect
                                    value={String(libraryDraft.deliveryTargetId ?? '')}
                                    onChange={(deliveryTargetId) => setLibraryDraft({
                                        ...libraryDraft,
                                        deliveryTargetId: deliveryTargetId || null,
                                    })}
                                    options={[
                                        { value: '', label: 'None (no delivery)' },
                                        ...(status.deliveryTargets || []).map((target) => ({
                                            value: String(target.id),
                                            label: target.name,
                                        })),
                                    ]}
                                />
                            </label>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block space-y-2 text-sm font-semibold text-text">Hardware override
                                    <CustomSelect
                                        value={String(libraryDraft.hardware || '')}
                                        onChange={(hardware) => setLibraryDraft({ ...libraryDraft, hardware: hardware as MediaAutomationLibrary['hardware'] })}
                                        options={[
                                            { value: '', label: 'Use pipeline / global' },
                                            { value: 'auto', label: 'Auto' },
                                            { value: 'cpu', label: 'CPU' },
                                            { value: 'nvenc', label: 'NVENC' },
                                            { value: 'qsv', label: 'QSV' },
                                            { value: 'intel-vaapi', label: 'Intel VAAPI' },
                                            { value: 'vaapi', label: 'AMD VAAPI' },
                                        ]}
                                    />
                                </label>
                                <label className="block space-y-2 text-sm font-semibold text-text">Output mode override
                                    <CustomSelect
                                        value={String(libraryDraft.outputMode || '')}
                                        onChange={(outputMode) => setLibraryDraft({ ...libraryDraft, outputMode: outputMode as MediaAutomationLibrary['outputMode'] })}
                                        options={[
                                            { value: '', label: 'Use pipeline / global' },
                                            { value: 'dry-run', label: 'Dry run' },
                                            { value: 'copy', label: 'Copy' },
                                            { value: 'replace', label: 'Replace' },
                                        ]}
                                    />
                                </label>
                            </div>
                        </section>
                        <section className="space-y-4 border-t border-border/60 pt-4">
                            <div>
                                <h3 className="text-sm font-bold text-text">Destinations</h3>
                                <p className="mt-1 text-xs text-muted">
                                    Output: Copy final destination, or Replace encode staging (then moves back to the original filename).
                                    Quarantine is used on Replace after verify.
                                </p>
                            </div>
                            <PathBrowserField
                                label="Output path"
                                value={libraryDraft.outputPath || ''}
                                onChange={(outputPath) => setLibraryDraft({ ...libraryDraft, outputPath })}
                                placeholder="/media/processed or /mnt/ssd/encode-staging"
                                optional
                            />
                            <PathBrowserField
                                label="Quarantine path"
                                value={libraryDraft.quarantinePath || ''}
                                onChange={(quarantinePath) => setLibraryDraft({ ...libraryDraft, quarantinePath })}
                                placeholder="/media/quarantine"
                                optional
                            />
                        </section>
                    </EditorShell>
                )}
            </ModalPortal>

            <ModalPortal open={pipelineDraft !== null}>
                {pipelineDraft && (
                    <EditorShell title={pipelineDraft.id === undefined ? 'New pipeline' : 'Edit pipeline'} onClose={() => setPipelineDraft(null)} onSave={savePipeline} saving={savingEditor}>
                        <PipelineEditorForm
                            pipelineDraft={pipelineDraft}
                            setPipelineDraft={setPipelineDraft}
                            createRuleCondition={createRuleCondition}
                            editorMatchAdvancedOpen={editorMatchAdvancedOpen}
                            setEditorMatchAdvancedOpen={setEditorMatchAdvancedOpen}
                            editorAdvancedOpen={editorAdvancedOpen}
                            setEditorAdvancedOpen={setEditorAdvancedOpen}
                            forceSampleSection={forceSampleSection}
                            previewBusy={previewBusy}
                            busy={busy}
                            previewResult={previewResult}
                            runPipelinePreview={runPipelinePreview}
                            queuePipelineSample={queuePipelineSample}
                            globalDryRun={!!(status.dryRun || status.outputMode === 'dry-run')}
                        />
                    </EditorShell>
                )}
            </ModalPortal>
            <PipelineTemplatePicker
                open={templatePickerOpen}
                onClose={() => setTemplatePickerOpen(false)}
                onSelect={openPipelineFromPreset}
            />
            <ReportModal
                open={reportSeed !== null}
                seed={reportSeed}
                libraries={libraries}
                pipelines={pipelines}
                onClose={() => setReportSeed(null)}
                toast={toast}
                onEnqueued={() => load(true)}
            />
        </DashboardPageShell>
    );
};
