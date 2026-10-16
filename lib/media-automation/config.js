const DEFAULTS = Object.freeze({
    enabled: false,
    dryRun: true,
    libraryRoots: [],
    extensions: ['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.ts', '.m2ts', '.webm'],
    cpuConcurrency: 1,
    gpuConcurrency: 1,
    leaseMs: 120_000,
    heartbeatMs: 30_000,
    jobTimeoutMs: 6 * 60 * 60 * 1000,
    maxAttempts: 3,
    retryDelayMs: 60_000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    hardwareAcceleration: 'auto',
    allowCpuFallback: true,
    outputMode: 'dry-run',
    outputExtension: '.mkv',
    quarantineDir: '',
    verifyOutput: true,
    minimumOutputBytes: 1024,
    vaapiDevice: '/dev/dri/renderD128',
    libraryScanEnabled: true,
    libraryScanIntervalMinutes: 360,
    // Off by default: recursive watches on large Unraid/remote mounts can stall or OOM the portal.
    libraryWatchEnabled: false,
    libraryWatchDebounceMs: 5000,
    libraryWatchUsePolling: true,
    libraryWatchPollIntervalMs: 15_000,
    customCommandAllowlist: ['ffmpeg', 'ffprobe'],
    /** Send Gotify when a job fails (requires portal Gotify settings). */
    notifyOnJobFailed: false,
    /** Gotify when a library scan finishes or is cancelled. */
    notifyOnScanComplete: false,
    /** Gotify digest when ≥5 jobs fail within 15 minutes. */
    notifyOnFailBurst: false,
    /** Block scan/encode when free space on the library root is below this many GB. */
    minFreeDiskGb: 20,
    /** Auto-pause encode claims when queued depth ≥ N (0 = off). */
    autoPauseQueueDepth: 0,
    /**
     * After a *manual* library scan queues jobs, keep encoding paused until Start is pressed.
     * Scheduled/periodic scans still fill the queue without flipping Start/Pause.
     */
    pauseEncodingOnScan: true,
    /** Normalized path prefixes/globs that must never be enqueued. */
    pathDenyList: [],
    /** Pause new encodes during this local-time window (scans/webhooks still enqueue). */
    quietHoursEnabled: false,
    quietHoursStart: '23:00',
    quietHoursEnd: '07:00',
    /** Empty = every day. 0=Sun … 6=Sat. */
    quietHoursDays: [],
    /** Hold encode lanes while Plex/Jellyfin sessions are active (host provides the stream count). */
    pauseWhenStreamingEnabled: false,
    /** 'gpu' pauses only GPU-lane encodes; 'all' also pauses CPU-lane work. */
    pauseWhenStreamingLanes: 'gpu',
    /** Ask Sonarr/Radarr to rescan the affected series/movie after replace or delivery. */
    arrRescanEnabled: false,
    /** Queue Scanner parent-folder refresh after copy/replace into a library root (not Output/). */
    scannerRefreshEnabled: false,
    /** Ask Plex to partially refresh the parent folder after replace, copy, or delivery. */
    plexRescanEnabled: false,
    /** 0 disables. Transcodes whose output saves less than this percent are discarded and the original kept. */
    minSavingsPercent: 0,
    /** 0 disables. Skip when heuristic estimated reclaim is below this many GB. */
    minReclaimGb: 0,
    /** 0 disables. Skip sources smaller than this many GB. */
    minSourceGb: 0,
    /** 0 disables. Skip sources whose bitrate is below this kbps. */
    minBitrateKbps: 0,
    /** 0 disables. Skip files newer than this many days (still settling). */
    minFileAgeDays: 0,
    /** When true, run a short sample encode before full transcode and abort if ROI fails. */
    sampleGateEnabled: false,
    /** Only run sample gate when source is at least this many GB (avoids sample cost on tiny files). */
    sampleGateMinSizeGb: 2,
    /** Block replace commits that drop resolution class or HDR signaling. */
    replaceQualityGuard: true,
    /** When free disk is under 2× minFreeDiskGb, raise effective min savings to at least this % (0 = off). */
    freeSpaceRoiMinPercent: 0,
    /** When quiet hours are enabled and it is currently daytime, add this % to the savings threshold (0 = off). */
    daytimeExtraSavingsPercent: 0,
    /** 0 disables. Skip when Plex/Jellyfin viewCount exceeds this. */
    maxWatchCount: 0,
    /** 0 disables. Skip when last viewed within this many days. */
    skipWatchedWithinDays: 0,
    /** 0 disables. Skip mixed season folders until ≥ this % match target or need encode. */
    seasonMatchMinPercent: 0,
    /** Audio-only cleanup pipelines require source video already HEVC/AV1. */
    audioOnlyIfVideoMatches: false,
    /** Dolby Vision re-encodes drop the RPU — skip by default. Remux/copy still allowed. */
    dolbyVisionHandling: 'skip',
    /** HDR10/HLG: preserve metadata + force 10-bit on HEVC/AV1, or strip / skip. */
    hdr10Handling: 'preserve',
    /**
     * When true, scan/enqueue still work but the worker does not claim encode jobs.
     * Default paused so enabling Media Automation cannot surprise-start encodes.
     */
    workerPaused: true,
    workerGroups: [],
    deliveryTargets: [],
    rules: [],
});

const asInt = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.min(max, Math.max(min, Math.round(number)))
        : fallback;
};

const normalizeExtension = (value) => {
    const extension = String(value || '').trim().toLowerCase();
    if (!extension || /[\\/\0]/.test(extension)) return '';
    return extension.startsWith('.') ? extension : `.${extension}`;
};

const normalizeTagList = (value, { max = 24 } = {}) => [...new Set(
    (Array.isArray(value) ? value : String(value || '').split(/[,\s]+/))
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter((entry) => entry && entry.length <= 40)
        .slice(0, max),
)];

const normalizeWorkerGroup = (value = {}, index = 0) => {
    const source = value && typeof value === 'object' ? value : {};
    const id = String(source.id || `group-${index + 1}`).trim().slice(0, 64) || `group-${index + 1}`;
    return {
        id,
        name: String(source.name || id).trim().slice(0, 80) || id,
        tags: normalizeTagList(source.tags),
        cpuConcurrency: asInt(source.cpuConcurrency, DEFAULTS.cpuConcurrency, 0, 32),
        gpuConcurrency: asInt(source.gpuConcurrency, DEFAULTS.gpuConcurrency, 0, 16),
        priorityBias: asInt(source.priorityBias, 0, -100, 100),
        enabled: source.enabled !== false,
    };
};

const normalizeDeliveryTarget = (value = {}, index = 0) => {
    const source = value && typeof value === 'object' ? value : {};
    const id = String(source.id || `delivery-${index + 1}`).trim().slice(0, 64) || `delivery-${index + 1}`;
    const mode = String(source.mode || 'copy').toLowerCase() === 'move' ? 'move' : 'copy';
    const namingMode = String(source.namingMode || 'as-is').toLowerCase() === 'sonarr-pattern'
        ? 'sonarr-pattern'
        : 'as-is';
    return {
        id,
        name: String(source.name || id).trim().slice(0, 80) || id,
        path: String(source.path || '').trim(),
        mode,
        namingMode,
        enabled: source.enabled !== false,
        sonarrInstanceId: source.sonarrInstanceId == null || source.sonarrInstanceId === ''
            ? null
            : String(source.sonarrInstanceId),
    };
};

const normalizeQuietHoursDays = (value) => {
    if (!Array.isArray(value) || value.length === 0) return [];
    return [...new Set(
        value
            .map((entry) => Number(entry))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    )].sort((a, b) => a - b);
};

const normalizePathDenyList = (value, { max = 200 } = {}) => {
    const raw = Array.isArray(value)
        ? value
        : String(value || '').split(/\r?\n|,/);
    return [...new Set(
        raw
            .map((entry) => String(entry || '').trim())
            .filter((entry) => entry && entry.length <= 512)
            .slice(0, max),
    )];
};

export const getDefaultMediaAutomationConfig = () => structuredClone(DEFAULTS);

/** Pause encoding for operator-triggered scans only — never for scheduled/periodic scans. */
export const shouldPauseEncodingForLibraryScan = (settings = {}, options = {}) => {
    if (settings.pauseEncodingOnScan === false) return false;
    const source = String(options.source || options.trigger || '').toLowerCase();
    if (source === 'scheduled' || source === 'periodic' || options.periodic === true) return false;
    return true;
};

export const normalizeMediaAutomationConfig = (incoming = {}, existing = {}) => {
    const source = incoming && typeof incoming === 'object' ? incoming : {};
    const previous = existing && typeof existing === 'object' ? existing : {};
    const merged = { ...getDefaultMediaAutomationConfig(), ...previous, ...source };
    const roots = Array.isArray(merged.libraryRoots) ? merged.libraryRoots : [];
    const extensions = Array.isArray(merged.extensions) ? merged.extensions : DEFAULTS.extensions;
    const hardware = String(merged.hardwareAcceleration || 'auto').toLowerCase();
    const outputMode = String(merged.outputMode || 'dry-run').toLowerCase();

    const normalizedOutputMode = ['replace', 'copy', 'dry-run'].includes(outputMode)
        ? outputMode
        : DEFAULTS.outputMode;

    const workerGroups = Array.isArray(merged.workerGroups)
        ? merged.workerGroups.map(normalizeWorkerGroup).slice(0, 16)
        : [];
    const deliveryTargets = Array.isArray(merged.deliveryTargets)
        ? merged.deliveryTargets.map(normalizeDeliveryTarget).slice(0, 16)
        : [];

    return {
        enabled: !!merged.enabled,
        // Keep dryRun aligned with outputMode so Copy/Replace are not silently forced back to plan-only.
        dryRun: normalizedOutputMode === 'dry-run',
        libraryRoots: [...new Set(roots.map((entry) => String(entry || '').trim()).filter(Boolean))],
        extensions: [...new Set(extensions.map(normalizeExtension).filter(Boolean))],
        // Prefer UI nested concurrency: { cpu, gpu } over stale flat fields.
        cpuConcurrency: asInt(
            (merged.concurrency && typeof merged.concurrency === 'object'
                ? merged.concurrency.cpu
                : undefined)
                ?? merged.cpuConcurrency
                ?? (typeof merged.concurrency === 'number' ? merged.concurrency : undefined),
            DEFAULTS.cpuConcurrency,
            0,
            32,
        ),
        gpuConcurrency: asInt(
            (merged.concurrency && typeof merged.concurrency === 'object'
                ? merged.concurrency.gpu
                : undefined)
                ?? merged.gpuConcurrency,
            DEFAULTS.gpuConcurrency,
            0,
            16,
        ),
        leaseMs: asInt(merged.leaseMs, DEFAULTS.leaseMs, 10_000, 86_400_000),
        heartbeatMs: asInt(merged.heartbeatMs, DEFAULTS.heartbeatMs, 1_000, 3_600_000),
        jobTimeoutMs: asInt(merged.jobTimeoutMs, DEFAULTS.jobTimeoutMs, 10_000, 7 * 86_400_000),
        maxAttempts: asInt(merged.maxAttempts, DEFAULTS.maxAttempts, 1, 100),
        retryDelayMs: asInt(merged.retryDelayMs, DEFAULTS.retryDelayMs, 0, 86_400_000),
        ffmpegPath: String(merged.ffmpegPath || DEFAULTS.ffmpegPath).trim(),
        ffprobePath: String(merged.ffprobePath || DEFAULTS.ffprobePath).trim(),
        hardwareAcceleration: ['auto', 'cpu', 'nvenc', 'qsv', 'intel-vaapi', 'vaapi'].includes(hardware) ? hardware : 'auto',
        allowCpuFallback: merged.allowCpuFallback !== false,
        outputMode: normalizedOutputMode,
        outputExtension: normalizeExtension(merged.outputExtension) || DEFAULTS.outputExtension,
        quarantineDir: String(merged.quarantineDir || '').trim(),
        verifyOutput: merged.verifyOutput !== false,
        minimumOutputBytes: asInt(merged.minimumOutputBytes, DEFAULTS.minimumOutputBytes, 1, Number.MAX_SAFE_INTEGER),
        vaapiDevice: String(merged.vaapiDevice || DEFAULTS.vaapiDevice).trim(),
        libraryScanEnabled: merged.libraryScanEnabled !== false,
        libraryScanIntervalMinutes: asInt(
            merged.libraryScanIntervalMinutes,
            DEFAULTS.libraryScanIntervalMinutes,
            15,
            10080,
        ),
        libraryWatchEnabled: merged.libraryWatchEnabled === true,
        libraryWatchDebounceMs: asInt(
            merged.libraryWatchDebounceMs,
            DEFAULTS.libraryWatchDebounceMs,
            500,
            120_000,
        ),
        libraryWatchUsePolling: merged.libraryWatchUsePolling !== false,
        libraryWatchPollIntervalMs: asInt(
            merged.libraryWatchPollIntervalMs,
            DEFAULTS.libraryWatchPollIntervalMs,
            2_000,
            300_000,
        ),
        customCommandAllowlist: [...new Set(
            (Array.isArray(merged.customCommandAllowlist)
                ? merged.customCommandAllowlist
                : DEFAULTS.customCommandAllowlist)
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
                .slice(0, 32),
        )],
        notifyOnJobFailed: merged.notifyOnJobFailed === true,
        notifyOnScanComplete: merged.notifyOnScanComplete === true,
        notifyOnFailBurst: merged.notifyOnFailBurst === true,
        minFreeDiskGb: asInt(merged.minFreeDiskGb, DEFAULTS.minFreeDiskGb, 0, 10_000),
        autoPauseQueueDepth: asInt(merged.autoPauseQueueDepth, DEFAULTS.autoPauseQueueDepth, 0, 100_000),
        pauseEncodingOnScan: merged.pauseEncodingOnScan !== false,
        pathDenyList: normalizePathDenyList(merged.pathDenyList),
        quietHoursEnabled: merged.quietHoursEnabled === true,
        quietHoursStart: /^\d{1,2}:\d{2}$/.test(String(merged.quietHoursStart || '').trim())
            ? String(merged.quietHoursStart).trim()
            : DEFAULTS.quietHoursStart,
        quietHoursEnd: /^\d{1,2}:\d{2}$/.test(String(merged.quietHoursEnd || '').trim())
            ? String(merged.quietHoursEnd).trim()
            : DEFAULTS.quietHoursEnd,
        quietHoursDays: normalizeQuietHoursDays(merged.quietHoursDays),
        pauseWhenStreamingEnabled: merged.pauseWhenStreamingEnabled === true,
        pauseWhenStreamingLanes: String(merged.pauseWhenStreamingLanes || '').toLowerCase() === 'all' ? 'all' : 'gpu',
        arrRescanEnabled: merged.arrRescanEnabled === true,
        scannerRefreshEnabled: merged.scannerRefreshEnabled === true,
        plexRescanEnabled: merged.plexRescanEnabled === true,
        minSavingsPercent: asInt(merged.minSavingsPercent, DEFAULTS.minSavingsPercent, 0, 95),
        minReclaimGb: asInt(merged.minReclaimGb, DEFAULTS.minReclaimGb, 0, 10_000),
        minSourceGb: asInt(merged.minSourceGb, DEFAULTS.minSourceGb, 0, 10_000),
        minBitrateKbps: asInt(merged.minBitrateKbps, DEFAULTS.minBitrateKbps, 0, 1_000_000),
        minFileAgeDays: asInt(merged.minFileAgeDays, DEFAULTS.minFileAgeDays, 0, 3650),
        sampleGateEnabled: merged.sampleGateEnabled === true,
        sampleGateMinSizeGb: asInt(merged.sampleGateMinSizeGb, DEFAULTS.sampleGateMinSizeGb, 0, 10_000),
        replaceQualityGuard: merged.replaceQualityGuard !== false,
        freeSpaceRoiMinPercent: asInt(merged.freeSpaceRoiMinPercent, DEFAULTS.freeSpaceRoiMinPercent, 0, 95),
        daytimeExtraSavingsPercent: asInt(merged.daytimeExtraSavingsPercent, DEFAULTS.daytimeExtraSavingsPercent, 0, 50),
        maxWatchCount: asInt(merged.maxWatchCount, DEFAULTS.maxWatchCount, 0, 1_000_000),
        skipWatchedWithinDays: asInt(merged.skipWatchedWithinDays, DEFAULTS.skipWatchedWithinDays, 0, 3650),
        seasonMatchMinPercent: asInt(merged.seasonMatchMinPercent, DEFAULTS.seasonMatchMinPercent, 0, 100),
        audioOnlyIfVideoMatches: merged.audioOnlyIfVideoMatches === true,
        dolbyVisionHandling: ['skip', 'preserve', 'strip'].includes(String(merged.dolbyVisionHandling || '').toLowerCase())
            ? String(merged.dolbyVisionHandling).toLowerCase()
            : DEFAULTS.dolbyVisionHandling,
        hdr10Handling: ['preserve', 'strip', 'skip'].includes(String(merged.hdr10Handling || '').toLowerCase())
            ? String(merged.hdr10Handling).toLowerCase()
            : DEFAULTS.hdr10Handling,
        // Absent / undefined → paused (safe default). Explicit false allows encoding.
        workerPaused: merged.workerPaused !== false,
        workerGroups,
        deliveryTargets,
        rules: Array.isArray(merged.rules) ? merged.rules.filter((rule) => rule && typeof rule === 'object') : [],
    };
};

/**
 * Total allowed in-flight jobs for a lane (cpu|gpu), matching scheduler worker groups.
 */
export const resolveLaneConcurrencyLimit = (settings, lane) => {
    const key = String(lane || '').toLowerCase() === 'cpu' ? 'cpuConcurrency' : 'gpuConcurrency';
    const groups = Array.isArray(settings?.workerGroups)
        ? settings.workerGroups.filter((group) => group?.enabled !== false)
        : [];
    if (groups.length) {
        return groups.reduce((sum, group) => {
            const raw = Number(group?.[key]);
            return sum + (Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0);
        }, 0);
    }
    const raw = Number(settings?.[key]);
    return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 1;
};

export {
    normalizeTagList,
    normalizeWorkerGroup,
    normalizeDeliveryTarget,
    normalizeQuietHoursDays,
    normalizePathDenyList,
};

export default normalizeMediaAutomationConfig;
