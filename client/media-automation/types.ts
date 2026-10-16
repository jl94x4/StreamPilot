export type MediaAutomationTab = 'overview' | 'queue' | 'pipelines' | 'libraries' | 'analyzer' | 'history' | 'system' | 'activity';

export type MediaAutomationHostMetrics = {
    at?: string;
    host?: string;
    platform?: string;
    arch?: string;
    uptimeSec?: number;
    process?: {
        pid?: number;
        rssBytes?: number;
        heapUsedBytes?: number;
        heapTotalBytes?: number;
    };
    memory?: {
        totalBytes?: number;
        freeBytes?: number;
        usedBytes?: number;
        usedPercent?: number | null;
    };
    cpu?: {
        cores?: number;
        model?: string | null;
        load1?: number;
        load5?: number;
        load15?: number;
        usedPercent?: number | null;
        temperatureC?: number | null;
        temperatureMaxC?: number | null;
        temperatureLabel?: string | null;
        temperatureAvailable?: boolean;
        temperatureNote?: string | null;
        perCore?: Array<{
            index?: number;
            usedPercent?: number | null;
            model?: string | null;
        }>;
    };
    gpu?: {
        nvidia?: {
            available?: boolean;
            error?: string | null;
            gpus?: Array<{
                index?: number;
                name?: string;
                utilizationPercent?: number;
                memoryUsedMb?: number;
                memoryTotalMb?: number;
                temperatureC?: number;
                vendor?: string;
            }>;
        };
        intel?: {
            available?: boolean;
            name?: string | null;
            device?: string | null;
            driver?: string | null;
            utilizationPercent?: number | null;
            videoUtilizationPercent?: number | null;
            frequencyMhz?: number | null;
            frequencyMaxMhz?: number | null;
            temperatureC?: number | null;
            engines?: Array<{
                name?: string;
                busyPercent?: number | null;
            }>;
            note?: string | null;
            topAvailable?: boolean;
            topBinaryPresent?: boolean;
            topError?: string | null;
        };
        intelOrAmd?: {
            available?: boolean;
            note?: string | null;
            dri?: {
                present?: boolean;
                readable?: boolean;
                device?: string | null;
            } | null;
            vendors?: string[];
        };
        activeEncodes?: {
            cpu?: number;
            gpu?: number;
        };
    };
};

export type MediaAutomationAnalyzeRow = {
    path: string;
    libraryId?: string | number | null;
    libraryName?: string | null;
    matched?: boolean;
    forced?: boolean;
    matchReason?: string;
    pipelineId?: string | number | null;
    pipelineName?: string | null;
    ruleId?: string | number | null;
    container?: string | null;
    videoCodec?: string | null;
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
    sizeBytes?: number | null;
    bitrateKbps?: number | null;
    estimateMode?: 'heuristic' | 'sample' | string;
    confidence?: 'high' | 'medium' | 'low' | string;
    estimateReason?: string;
    estimatedOutputBytes?: number | null;
    estimatedBytesSaved?: number | null;
    estimatedSavingsPercent?: number | null;
    targetCodec?: string | null;
};

export type MediaAutomationAnalyzeResult = {
    ok?: boolean;
    estimateMode?: string;
    libraryId?: string | number | null;
    pipelineId?: string | number | null;
    rootPath?: string | null;
    force?: boolean;
    truncated?: boolean;
    limit?: number;
    minSizeBytes?: number;
    totals?: {
        discovered?: number;
        considered?: number;
        analyzed?: number;
        matched?: number;
        estimatedBytesSaved?: number;
        sourceBytes?: number;
        matchedSourceBytes?: number;
        matchedDurationSeconds?: number;
        estimatedOutputBytes?: number;
        estimatedEncodeMs?: number | null;
        etaSource?: string;
        estimatedSavingsPercent?: number | null;
    };
    rows?: MediaAutomationAnalyzeRow[];
    error?: string;
};
export type OutputMode = 'dry-run' | 'copy' | 'replace';
export type HardwareMode = 'auto' | 'cpu' | 'nvenc' | 'qsv' | 'intel-vaapi' | 'vaapi';

export type MediaAutomationMetrics = {
    processed24h?: number;
    failed24h?: number;
    cancelled24h?: number;
    successRate24h?: number | null;
    bytesIn24h?: number;
    bytesOut24h?: number;
    bytesSaved24h?: number;
    encodeMs24h?: number;
    bytesSaved7d?: number;
    encodeMs7d?: number;
    bytesSaved30d?: number;
    encodeMs30d?: number;
};

export type MediaAutomationSavingsWindow = {
    days?: number;
    completed?: number;
    failed?: number;
    bytesIn?: number;
    bytesOut?: number;
    bytesSaved?: number;
    encodeMs?: number;
};

export type MediaAutomationWorkerGroup = {
    id: string;
    name: string;
    tags: string[];
    cpuConcurrency: number;
    gpuConcurrency: number;
    priorityBias: number;
    enabled?: boolean;
};

export type MediaAutomationDeliveryTarget = {
    id: string;
    name: string;
    path: string;
    mode: 'copy' | 'move';
    namingMode: 'as-is' | 'sonarr-pattern';
    enabled?: boolean;
    sonarrInstanceId?: string | null;
};

export type MediaAutomationScanProgress = {
    running?: boolean;
    discovered?: number;
    enqueued?: number;
    skipped?: number;
    errors?: number;
    currentPath?: string | null;
    startedAt?: string;
    updatedAt?: string;
    percent?: number | null;
    totalEstimate?: number | null;
    scanBatchId?: string | null;
};

export type MediaAutomationScanHistoryEntry = {
    id?: string;
    at?: string;
    discovered?: number;
    enqueued?: number;
    skipped?: number;
    errors?: unknown[];
    skippedDetails?: Array<{ filePath?: string; reason?: string; videoCodec?: string | null }>;
    sampleSkips?: Array<{ filePath?: string; reason?: string; videoCodec?: string | null }>;
};

export type MediaAutomationHistoryEntry = {
    id: string;
    sourcePath?: string;
    pipelineId?: string | null;
    pipelineName?: string;
    libraryId?: string | null;
    state?: string;
    lane?: string;
    tags?: string[];
    createdAt?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    sourceBytes?: number;
    outputBytes?: number;
    bytesSaved?: number;
    durationMs?: number;
    adapter?: string | null;
    adapterLabel?: string | null;
    dryRun?: boolean;
    finalPath?: string | null;
    quarantinedPath?: string | null;
    delivery?: Record<string, unknown> | null;
    error?: { code?: string; message?: string } | null;
};

export type MediaAutomationStatus = {
    enabled?: boolean;
    state?: string;
    workerState?: string;
    paused?: boolean;
    /** Persisted encode gate: true = queue only, false = worker may claim jobs. */
    workerPaused?: boolean;
    autoPausedForQueueDepth?: boolean;
    autoPauseQueueDepth?: number;
    minFreeDiskGb?: number;
    pathDenyList?: string[];
    activeJobs?: number;
    queuedJobs?: number;
    completedJobs?: number;
    failedJobs?: number;
    startedAt?: string;
    lastHeartbeat?: string;
    version?: string;
    scanning?: boolean;
    periodicScanning?: boolean;
    lastScanAt?: string;
    lastScanResult?: {
        discovered?: number;
        enqueued?: number;
        skipped?: number;
        errors?: unknown[];
        skippedDetails?: Array<{ filePath?: string; reason?: string; videoCodec?: string | null }>;
        sampleSkips?: Array<{ filePath?: string; reason?: string; videoCodec?: string | null }>;
        at?: string;
    } | null;
    libraryScanEnabled?: boolean;
    libraryWatchEnabled?: boolean;
    libraryScanIntervalMinutes?: number;
    watchEnvEnabled?: boolean;
    libraryWatchConfigured?: boolean;
    notifyOnJobFailed?: boolean;
    notifyOnScanComplete?: boolean;
    notifyOnFailBurst?: boolean;
    quietHoursEnabled?: boolean;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    quietHoursDays?: number[];
    quietHoursActive?: boolean;
    scanProgress?: MediaAutomationScanProgress | null;
    recentScans?: MediaAutomationScanHistoryEntry[];
    workerGroups?: MediaAutomationWorkerGroup[];
    deliveryTargets?: MediaAutomationDeliveryTarget[];
    savings?: {
        '7d'?: MediaAutomationSavingsWindow;
        '30d'?: MediaAutomationSavingsWindow;
    } | null;
    outputMode?: OutputMode;
    dryRun?: boolean;
    hardwareAcceleration?: HardwareMode;
    fallbackHardware?: HardwareMode;
    streamingPauseActive?: boolean;
    activeStreamCount?: number;
    pauseWhenStreamingEnabled?: boolean;
    pauseWhenStreamingLanes?: 'gpu' | 'all';
    arrRescanEnabled?: boolean;
    scannerRefreshEnabled?: boolean;
    plexRescanEnabled?: boolean;
    minSavingsPercent?: number;
    minReclaimGb?: number;
    minSourceGb?: number;
    minBitrateKbps?: number;
    minFileAgeDays?: number;
    sampleGateEnabled?: boolean;
    sampleGateMinSizeGb?: number;
    replaceQualityGuard?: boolean;
    freeSpaceRoiMinPercent?: number;
    daytimeExtraSavingsPercent?: number;
    maxWatchCount?: number;
    skipWatchedWithinDays?: number;
    seasonMatchMinPercent?: number;
    audioOnlyIfVideoMatches?: boolean;
    dolbyVisionHandling?: 'skip' | 'preserve' | 'strip';
    hdr10Handling?: 'preserve' | 'strip' | 'skip';
    watch?: {
        watching?: boolean;
        pending?: number;
        roots?: string[];
    };
    metrics?: MediaAutomationMetrics;
    lanes?: {
        cpu?: { active?: number; queued?: number; running?: number };
        gpu?: { active?: number; queued?: number; running?: number };
    };
    [key: string]: unknown;
};

export type MediaAutomationCapabilities = {
    available?: boolean;
    ffmpeg?: boolean | { available?: boolean; version?: string };
    ffprobe?: boolean | { available?: boolean; version?: string };
    hardware?: string[];
    encoders?: string[];
    details?: Record<string, { label?: string; encoders?: string[]; error?: string; syntheticTested?: boolean }>;
    devices?: {
        dri?: {
            present?: boolean;
            renderNodes?: string[];
            cardNodes?: string[];
            device?: string;
            exists?: boolean;
            readable?: boolean;
            vendors?: string[];
            vendor?: string | null;
            vendorId?: string | null;
        };
        nvidia?: {
            device?: boolean;
            cudaLib?: string | null;
            visibleDevices?: string | null;
            driverCapabilities?: string | null;
            runtimeHint?: string | null;
        };
    };
    error?: string;
    [key: string]: unknown;
};

export type MediaAutomationJobProgress = {
    percent?: number;
    outTimeUs?: number;
    etaSeconds?: number | null;
    speed?: number | string | null;
    fps?: number | null;
    durationSeconds?: number | null;
    step?: number;
    stepCount?: number;
    command?: string;
    currentCommand?: string;
    adapter?: string | null;
    adapterLabel?: string | null;
    hardwareFallback?: boolean;
    requestedHardware?: string | null;
};

export type MediaAutomationPlan = {
    mode?: string;
    kind?: string;
    stepType?: string;
    adapter?: string | null;
    adapterLabel?: string | null;
    executable?: string;
    args?: string[];
    inputPath?: string;
    outputPath?: string;
    [key: string]: unknown;
};

export type MediaAutomationJob = {
    id: string | number;
    path?: string;
    sourcePath?: string;
    libraryId?: string | number | null;
    libraryRoot?: string | null;
    pipelineId?: string | number;
    pipelineName?: string;
    status?: string;
    state?: string;
    phase?: string;
    lane?: string;
    priority?: number;
    attempts?: number;
    maxAttempts?: number;
    cancelRequested?: boolean;
    progress?: number | MediaAutomationJobProgress;
    plan?: MediaAutomationPlan | MediaAutomationPlan[] | null;
    createdAt?: string;
    startedAt?: string;
    completedAt?: string;
    finishedAt?: string;
    error?: string | { code?: string; message?: string; stderr?: string };
    outputPath?: string;
    result?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
};

export type MediaAutomationActivity = {
    id?: string | number;
    type?: string;
    action?: string;
    message?: string;
    status?: string;
    createdAt?: string;
    timestamp?: string;
    at?: string;
    jobId?: string | number;
    [key: string]: unknown;
};

export type MediaAutomationLibrary = {
    id?: string | number;
    name: string;
    rootPath: string;
    outputPath: string;
    quarantinePath: string;
    pipelineId?: string | number | null;
    enabled?: boolean;
    /** Optional per-library hardware override (empty = pipeline/global). */
    hardware?: HardwareMode | '' | null;
    /** Optional per-library output mode override (empty = pipeline/global). */
    outputMode?: OutputMode | '' | null;
    priorityBoost?: number;
    tags?: string[];
    deliveryTargetId?: string | null;
    [key: string]: unknown;
};

export type MediaAutomationPipelinePreview = {
    ok?: boolean;
    matched?: boolean;
    reason?: string;
    path?: string;
    probe?: {
        format?: string;
        duration?: string | number;
        videoCodec?: string;
        audioCodec?: string;
    };
    plans?: Array<{
        mode?: string;
        adapter?: string | null;
        adapterLabel?: string | null;
        args?: string[];
    }>;
    error?: string;
};

export type MediaAutomationPendingTest = {
    ok?: boolean;
    matched?: boolean;
    enqueued?: boolean;
    path?: string;
    libraryId?: string | number;
    pipelineId?: string | number | null;
    pipelineName?: string | null;
    ruleId?: string | null;
    reason?: string;
    probe?: MediaAutomationPipelinePreview['probe'];
    error?: string;
};

export type MediaAutomationStepType =
    | 'transcode'
    | 'remux'
    | 'subtitle-strip'
    | 'subtitle-extract'
    | 'subtitle-keep-lang'
    | 'keep-first-audio'
    | 'drop-commentary'
    | 'audio-normalize'
    | 'audio-stereo'
    | 'commercial-strip'
    | 'move'
    | 'custom-command';

export type MediaAutomationStep = {
    type: MediaAutomationStepType;
    container?: string;
    videoCodec?: string;
    audioCodec?: string;
    subtitleCodec?: string;
    audioBitrateKbps?: number;
    /** Fixed video bitrate in kbps. When set (>0), overrides CRF/CQ for ABR-style sizing. */
    videoBitrateKbps?: number;
    maxWidth?: number;
    preset?: string;
    /** Quality: CRF/CQ/QP style 0–51 (lower = higher quality / larger files). Ignored when videoBitrateKbps is set. */
    crf?: number;
    /** Encode 10-bit (Main10 / P010). HEVC and AV1 only; ignored for H.264. */
    tenBit?: boolean;
    /** Move destination template, e.g. `{dir}/archive/{basename}` */
    destination?: string;
    /** Allowlisted executable basename or absolute path for custom-command */
    executable?: string;
    /** Arg templates for custom-command (no shell). Placeholders: {input} {output} {dir} {name} {ext} {basename} {libraryRoot} */
    args?: string[];
    skipMediaFinalize?: boolean;
    /** Comma-separated ISO language codes for subtitle extract/keep */
    subtitleLanguages?: string;
    /** Keep subtitle streams when using keep-first-audio (default true) */
    keepSubtitles?: boolean;
    /** Regex matched against chapter titles for commercial-strip */
    commercialPattern?: string;
};

export type MediaAutomationRuleCondition = {
    id: string;
    field: 'path' | 'container' | 'videoCodec' | 'audioCodec' | 'width' | 'bitrate' | 'hdr';
    operator: 'equals' | 'notEquals' | 'contains' | 'matches' | 'greaterThan' | 'lessThan';
    value: string;
};

export type MediaAutomationRules = {
    operator: 'AND' | 'OR';
    conditions: MediaAutomationRuleCondition[];
};

export type MediaAutomationPipeline = {
    id?: string | number;
    name: string;
    enabled: boolean;
    priority: number;
    outputMode: OutputMode;
    hardware: HardwareMode;
    /** Saved sample media path for preview / one-click queue (container path). */
    samplePath?: string;
    /** inherit = use global Settings. */
    dolbyVisionHandling?: 'inherit' | 'skip' | 'preserve' | 'strip';
    hdr10Handling?: 'inherit' | 'preserve' | 'strip' | 'skip';
    /** inherit / null = use global Settings minSavingsPercent. */
    minSavingsPercent?: number | 'inherit' | null;
    rules: MediaAutomationRules;
    steps: MediaAutomationStep[];
    [key: string]: unknown;
};

export type MediaAutomationSettingsConfig = {
    enabled: boolean;
    auth: {
        username: string;
        password: string;
    };
    concurrency: {
        cpu: number;
        gpu: number;
    };
    /** Flat mirrors of concurrency — kept in sync so saves do not prefer a stale value. */
    cpuConcurrency?: number;
    gpuConcurrency?: number;
    fallback: {
        hardware: HardwareMode;
        outputMode: OutputMode;
    };
    /** Mirrored from Safe fallback so saves do not keep a stale top-level dry-run. */
    outputMode?: OutputMode;
    hardwareAcceleration?: HardwareMode;
    libraryScanEnabled: boolean;
    libraryScanIntervalMinutes: number;
    libraryWatchEnabled: boolean;
    libraryWatchDebounceMs: number;
    /** Basenames or absolute paths allowed for custom-command steps */
    customCommandAllowlist: string[];
    /** Send Gotify when a job fails (requires portal Gotify settings). */
    notifyOnJobFailed?: boolean;
    /** Gotify when a library scan finishes or is cancelled. */
    notifyOnScanComplete?: boolean;
    /** Gotify digest when ≥5 jobs fail within 15 minutes. */
    notifyOnFailBurst?: boolean;
    /** Block scan/encode when free space is below this many GB (0 = off). */
    minFreeDiskGb?: number;
    /** Auto-pause encode claims when queued depth ≥ N (0 = off). */
    autoPauseQueueDepth?: number;
    /**
     * After a library scan queues jobs, keep encoding paused until Start is pressed.
     */
    pauseEncodingOnScan?: boolean;
    /** Path prefixes/globs that must never be enqueued. */
    pathDenyList?: string[];
    quietHoursEnabled?: boolean;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    quietHoursDays?: number[];
    /** Hold encode lanes while Plex/Jellyfin playback sessions are active. */
    pauseWhenStreamingEnabled?: boolean;
    pauseWhenStreamingLanes?: 'gpu' | 'all';
    /** Ask Sonarr/Radarr to rescan the affected item after replace or delivery. */
    arrRescanEnabled?: boolean;
    /** Queue Scanner parent-folder refresh after a real copy/replace into a library root (not Output/). */
    scannerRefreshEnabled?: boolean;
    /** Ask Plex to partially refresh / Analyze after replace, copy, or delivery. */
    plexRescanEnabled?: boolean;
    /** 0 disables. Discard outputs / skip enqueue when estimated savings is below this %. */
    minSavingsPercent?: number;
    /** 0 disables. Skip when estimated reclaim is below this many GB. */
    minReclaimGb?: number;
    /** 0 disables. Skip sources smaller than this many GB. */
    minSourceGb?: number;
    /** 0 disables. Skip sources whose bitrate is below this kbps. */
    minBitrateKbps?: number;
    /** 0 disables. Skip files newer than this many days. */
    minFileAgeDays?: number;
    /** Run a short sample encode before full transcode and abort if ROI fails. */
    sampleGateEnabled?: boolean;
    /** Only run sample gate when source is at least this many GB. */
    sampleGateMinSizeGb?: number;
    /** Block replace commits that drop resolution class or HDR signaling. */
    replaceQualityGuard?: boolean;
    /** When free disk is low, raise effective min savings to at least this % (0 = off). */
    freeSpaceRoiMinPercent?: number;
    /** During daytime (outside quiet hours), add this % to the savings threshold (0 = off). */
    daytimeExtraSavingsPercent?: number;
    /** 0 disables. Skip when Plex/Jellyfin viewCount exceeds this. */
    maxWatchCount?: number;
    /** 0 disables. Skip when last viewed within this many days. */
    skipWatchedWithinDays?: number;
    /** 0 disables. Skip mixed season folders until ≥ this % match target. */
    seasonMatchMinPercent?: number;
    /** Audio-only cleanup pipelines require source video already HEVC/AV1. */
    audioOnlyIfVideoMatches?: boolean;
    /** Dolby Vision re-encodes: skip (default), strip, or preserve (best-effort, often lossy). */
    dolbyVisionHandling?: 'skip' | 'preserve' | 'strip';
    /** HDR10/HLG: preserve metadata + 10-bit (default), strip, or skip. */
    hdr10Handling?: 'preserve' | 'strip' | 'skip';
    /** When true, queue fills but encodes do not start until Start is pressed. */
    workerPaused?: boolean;
    workerGroups?: MediaAutomationWorkerGroup[];
    deliveryTargets?: MediaAutomationDeliveryTarget[];
};

export const DEFAULT_MEDIA_AUTOMATION_SETTINGS: MediaAutomationSettingsConfig = {
    enabled: false,
    auth: { username: '', password: '' },
    concurrency: { cpu: 1, gpu: 1 },
    fallback: { hardware: 'cpu', outputMode: 'dry-run' },
    libraryScanEnabled: true,
    libraryScanIntervalMinutes: 360,
    libraryWatchEnabled: false,
    libraryWatchDebounceMs: 5000,
    customCommandAllowlist: ['ffmpeg', 'ffprobe'],
    notifyOnJobFailed: false,
    notifyOnScanComplete: false,
    notifyOnFailBurst: false,
    minFreeDiskGb: 20,
    autoPauseQueueDepth: 0,
    pauseEncodingOnScan: true,
    pathDenyList: [],
    quietHoursEnabled: false,
    quietHoursStart: '23:00',
    quietHoursEnd: '07:00',
    quietHoursDays: [],
    pauseWhenStreamingEnabled: false,
    pauseWhenStreamingLanes: 'gpu',
    arrRescanEnabled: false,
    scannerRefreshEnabled: false,
    plexRescanEnabled: false,
    minSavingsPercent: 0,
    minReclaimGb: 0,
    minSourceGb: 0,
    minBitrateKbps: 0,
    minFileAgeDays: 0,
    sampleGateEnabled: false,
    sampleGateMinSizeGb: 2,
    replaceQualityGuard: true,
    freeSpaceRoiMinPercent: 0,
    daytimeExtraSavingsPercent: 0,
    maxWatchCount: 0,
    skipWatchedWithinDays: 0,
    seasonMatchMinPercent: 0,
    audioOnlyIfVideoMatches: false,
    dolbyVisionHandling: 'skip',
    hdr10Handling: 'preserve',
    workerPaused: true,
    workerGroups: [],
    deliveryTargets: [],
};

export const emptyLibrary = (): MediaAutomationLibrary => ({
    name: '',
    rootPath: '',
    outputPath: '',
    quarantinePath: '',
    pipelineId: '',
    enabled: true,
    hardware: '',
    outputMode: '',
    priorityBoost: 0,
    tags: [],
    deliveryTargetId: null,
});

export const emptyWorkerGroup = (): MediaAutomationWorkerGroup => ({
    id: `group-${Date.now()}`,
    name: 'Worker group',
    tags: [],
    cpuConcurrency: 1,
    gpuConcurrency: 1,
    priorityBias: 0,
    enabled: true,
});

export const emptyDeliveryTarget = (): MediaAutomationDeliveryTarget => ({
    id: `delivery-${Date.now()}`,
    name: 'Sonarr drop',
    path: '',
    mode: 'copy',
    namingMode: 'as-is',
    enabled: true,
    sonarrInstanceId: null,
});

export const emptyPipeline = (): MediaAutomationPipeline => ({
    name: '',
    enabled: true,
    priority: 50,
    outputMode: 'dry-run',
    hardware: 'auto',
    samplePath: '',
    dolbyVisionHandling: 'inherit',
    hdr10Handling: 'inherit',
    minSavingsPercent: 'inherit',
    rules: {
        operator: 'AND',
        conditions: [{
            id: 'condition-1',
            field: 'videoCodec',
            operator: 'notEquals',
            value: 'hevc',
        }],
    },
    steps: [{ type: 'transcode', container: 'mkv', videoCodec: 'hevc', audioCodec: 'copy', preset: 'medium' }],
});

const hevcSkipRule = (): MediaAutomationRules => ({
    operator: 'AND',
    conditions: [{
        id: 'condition-hevc',
        field: 'videoCodec',
        operator: 'notEquals',
        value: 'hevc',
    }],
});

const h264SkipRule = (): MediaAutomationRules => ({
    operator: 'AND',
    conditions: [{
        id: 'condition-h264',
        field: 'videoCodec',
        operator: 'notEquals',
        value: 'h264',
    }],
});

const av1SkipRule = (): MediaAutomationRules => ({
    operator: 'AND',
    conditions: [{
        id: 'condition-av1',
        field: 'videoCodec',
        operator: 'notEquals',
        value: 'av1',
    }],
});

/** Unmanic-inspired pipeline seeds (quality profiles + common remux/compat flows). */
export type PipelinePresetCategory = 'quality' | 'remux' | 'audio' | 'subtitles' | 'utility';

export const PIPELINE_PRESET_CATEGORY_LABELS: Record<PipelinePresetCategory, string> = {
    quality: 'Quality',
    remux: 'Remux',
    audio: 'Audio',
    subtitles: 'Subtitles',
    utility: 'Utility',
};

export const PIPELINE_PRESETS: Array<{
    id: string;
    label: string;
    detail: string;
    category: PipelinePresetCategory;
    pipeline: MediaAutomationPipeline;
}> = [
    {
        id: 'hevc-1500k-keep-streams',
        label: 'HEVC 1500kbps (keep A/V)',
        detail: 'Fixed 1500 kbps video bitrate - predictable file size. Copies audio and subtitles unchanged.',
        category: 'quality',
        pipeline: {
            name: 'HEVC 1500kbps keep streams',
            enabled: true,
            priority: 58,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: hevcSkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                videoBitrateKbps: 1500,
            }],
        },
    },
    {
        id: 'high-quality-hevc',
        label: 'High quality HEVC',
        detail: 'HEVC CRF 18 / slow - near-transparent quality, larger files (Unmanic high-quality style).',
        category: 'quality',
        pipeline: {
            name: 'High quality HEVC',
            enabled: true,
            priority: 60,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: hevcSkipRule(),
            steps: [{ type: 'transcode', container: 'mkv', videoCodec: 'hevc', audioCodec: 'copy', subtitleCodec: 'copy', preset: 'slow', crf: 18 }],
        },
    },
    {
        id: 'balanced-hevc',
        label: 'Balanced HEVC',
        detail: 'HEVC CRF 23 / medium - good quality-to-size default for most libraries.',
        category: 'quality',
        pipeline: {
            name: 'Balanced HEVC',
            enabled: true,
            priority: 50,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: hevcSkipRule(),
            steps: [{ type: 'transcode', container: 'mkv', videoCodec: 'hevc', audioCodec: 'copy', subtitleCodec: 'copy', preset: 'medium', crf: 23 }],
        },
    },
    {
        id: 'space-saver-hevc',
        label: 'Space saver HEVC',
        detail: 'HEVC CRF 28 / fast, AAC 96k - shrink libraries while staying watchable.',
        category: 'quality',
        pipeline: {
            name: 'Space saver HEVC',
            enabled: true,
            priority: 55,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: hevcSkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'aac',
                audioBitrateKbps: 96,
                subtitleCodec: 'copy',
                preset: 'fast',
                crf: 28,
            }],
        },
    },
    {
        id: 'low-quality-hevc',
        label: 'Low quality / archive',
        detail: 'HEVC CRF 32 / veryfast, capped 1280px - aggressive archive / storage reclaim.',
        category: 'quality',
        pipeline: {
            name: 'Low quality archive',
            enabled: true,
            priority: 45,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: hevcSkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'aac',
                audioBitrateKbps: 96,
                subtitleCodec: 'copy',
                preset: 'veryfast',
                crf: 32,
                maxWidth: 1280,
            }],
        },
    },
    {
        id: 'hevc-1080p',
        label: 'HEVC 1080p',
        detail: 'Downscale above 1080p to 1920px wide, then HEVC CRF 23.',
        category: 'quality',
        pipeline: {
            name: 'HEVC 1080p',
            enabled: true,
            priority: 52,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: {
                operator: 'OR',
                conditions: [
                    { id: 'c-codec', field: 'videoCodec', operator: 'notEquals', value: 'hevc' },
                    { id: 'c-width', field: 'width', operator: 'greaterThan', value: '1920' },
                ],
            },
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                crf: 23,
                maxWidth: 1920,
            }],
        },
    },
    {
        id: 'hevc-720p',
        label: 'HEVC 720p space saver',
        detail: 'Cap at 1280px + HEVC CRF 28 - common TV / mobile space-saver profile.',
        category: 'quality',
        pipeline: {
            name: 'HEVC 720p space saver',
            enabled: true,
            priority: 48,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: {
                operator: 'OR',
                conditions: [
                    { id: 'c-codec', field: 'videoCodec', operator: 'notEquals', value: 'hevc' },
                    { id: 'c-width', field: 'width', operator: 'greaterThan', value: '1280' },
                ],
            },
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'aac',
                audioBitrateKbps: 128,
                subtitleCodec: 'copy',
                preset: 'fast',
                crf: 28,
                maxWidth: 1280,
            }],
        },
    },
    {
        id: 'h264-compat',
        label: 'H.264 compatibility',
        detail: 'H.264 CRF 20 / medium - broad device compatibility when HEVC is not wanted.',
        category: 'quality',
        pipeline: {
            name: 'H.264 compatibility',
            enabled: true,
            priority: 40,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: h264SkipRule(),
            steps: [{ type: 'transcode', container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', audioBitrateKbps: 192, subtitleCodec: 'copy', preset: 'medium', crf: 20 }],
        },
    },
    {
        id: 'remux-mkv',
        label: 'Remux to MKV',
        detail: 'Copy streams into MKV without re-encoding (container cleanup only).',
        category: 'remux',
        pipeline: {
            name: 'Remux to MKV',
            enabled: true,
            priority: 35,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: {
                operator: 'AND',
                conditions: [{
                    id: 'condition-container',
                    field: 'container',
                    operator: 'notEquals',
                    value: 'matroska,mkv',
                }],
            },
            steps: [{ type: 'remux', container: 'mkv' }],
        },
    },
    {
        id: 'remux-mp4',
        label: 'Remux to MP4',
        detail: 'Copy streams into MP4 when the source is not already MP4.',
        category: 'remux',
        pipeline: {
            name: 'Remux to MP4',
            enabled: true,
            priority: 34,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: {
                operator: 'AND',
                conditions: [{
                    id: 'condition-mp4',
                    field: 'container',
                    operator: 'notEquals',
                    value: 'mp4,mov,m4v',
                }],
            },
            steps: [{ type: 'remux', container: 'mp4' }],
        },
    },
    {
        id: 'aac-audio-normalize',
        label: 'AAC stereo normalize',
        detail: 'Keep video, re-encode audio to AAC 192k - useful after remux/transcode cleanup.',
        category: 'audio',
        pipeline: {
            name: 'AAC stereo normalize',
            enabled: true,
            priority: 30,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: {
                operator: 'AND',
                conditions: [{
                    id: 'condition-audio',
                    field: 'audioCodec',
                    operator: 'notEquals',
                    value: 'aac',
                }],
            },
            steps: [{ type: 'transcode', container: 'mkv', videoCodec: 'copy', audioCodec: 'aac', audioBitrateKbps: 192, subtitleCodec: 'copy', preset: 'medium', crf: 23 }],
        },
    },
    {
        id: 'loudnorm-first-audio',
        label: 'Loudnorm first audio',
        detail: 'EBU R128 loudnorm on the first audio track (AAC), video/subs copied.',
        category: 'audio',
        pipeline: {
            name: 'Loudnorm first audio',
            enabled: true,
            priority: 28,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'audio-normalize', container: 'mkv', audioBitrateKbps: 192 }],
        },
    },
    {
        id: 'stereo-downmix',
        label: 'Stereo downmix (AAC)',
        detail: 'Downmix first audio to 2.0 AAC; keep video and subtitles.',
        category: 'audio',
        pipeline: {
            name: 'Stereo downmix',
            enabled: true,
            priority: 27,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'audio-stereo', container: 'mkv', audioBitrateKbps: 192 }],
        },
    },
    {
        id: 'drop-commentary-audio',
        label: 'Drop commentary audio',
        detail: 'Remux and drop audio streams marked commentary/comment disposition.',
        category: 'audio',
        pipeline: {
            name: 'Drop commentary audio',
            enabled: true,
            priority: 32,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'drop-commentary', container: 'mkv' }],
        },
    },
    {
        id: 'keep-english-subs',
        label: 'Keep English subtitles only',
        detail: 'Keep video/audio and only eng/en subtitle streams.',
        category: 'subtitles',
        pipeline: {
            name: 'Keep English subtitles',
            enabled: true,
            priority: 33,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'subtitle-keep-lang', container: 'mkv', subtitleLanguages: 'eng,en' }],
        },
    },
    {
        id: 'strip-commercial-chapters',
        label: 'Strip commercial chapters',
        detail: 'Cut chapters whose titles match commercial/advert/promo (requires chapter markers).',
        category: 'utility',
        pipeline: {
            name: 'Strip commercial chapters',
            enabled: true,
            priority: 22,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'commercial-strip', container: 'mkv' }],
        },
    },
    {
        id: 'dry-run-probe',
        label: 'Dry-run probe',
        detail: 'Match everything and plan only - safest way to validate rules and hardware.',
        category: 'utility',
        pipeline: {
            name: 'Dry-run probe',
            enabled: true,
            priority: 10,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'remux', container: 'mkv' }],
        },
    },
    {
        id: 'strip-subtitles',
        label: 'Strip embedded subtitles',
        detail: 'Remux with stream copy and drop subtitle streams.',
        category: 'subtitles',
        pipeline: {
            name: 'Strip embedded subtitles',
            enabled: true,
            priority: 35,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'subtitle-strip', container: 'mkv' }],
        },
    },
    {
        id: 'extract-first-subtitle',
        label: 'Extract first subtitle (SRT)',
        detail: 'Write the first subtitle stream beside the source as .srt (source file unchanged).',
        category: 'subtitles',
        pipeline: {
            name: 'Extract first subtitle',
            enabled: true,
            priority: 25,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'subtitle-extract', container: 'mkv', skipMediaFinalize: true }],
        },
    },
    {
        id: 'move-to-archive',
        label: 'Move to archive folder',
        detail: 'Rename/move within library roots using `{dir}/archive/{basename}`.',
        category: 'utility',
        pipeline: {
            name: 'Move to archive',
            enabled: true,
            priority: 20,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'move', destination: '{dir}/archive/{basename}' }],
        },
    },
    {
        id: 'hevc-2500k-keep-streams',
        label: 'HEVC 2500kbps (keep A/V)',
        detail: 'Fixed 2500 kbps HEVC - solid 1080p size target while copying audio and subs.',
        category: 'quality',
        pipeline: {
            name: 'HEVC 2500kbps keep streams',
            enabled: true,
            priority: 57,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: hevcSkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                videoBitrateKbps: 2500,
            }],
        },
    },
    {
        id: 'hevc-4000k-keep-streams',
        label: 'HEVC 4000kbps (keep A/V)',
        detail: 'Fixed 4000 kbps HEVC - higher-bitrate TV / movie profile with stream copy for audio/subs.',
        category: 'quality',
        pipeline: {
            name: 'HEVC 4000kbps keep streams',
            enabled: true,
            priority: 56,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: hevcSkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                videoBitrateKbps: 4000,
            }],
        },
    },
    {
        id: 'hevc-film-quality',
        label: 'HEVC film quality',
        detail: 'HEVC CRF 20 / slow - film/TV sweet spot between transparent and balanced.',
        category: 'quality',
        pipeline: {
            name: 'HEVC film quality',
            enabled: true,
            priority: 59,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: hevcSkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'slow',
                crf: 20,
            }],
        },
    },
    {
        id: 'hevc-4k-to-1080p',
        label: '4K → 1080p HEVC',
        detail: 'Downscale wider-than-1080p sources to 1920px, then HEVC CRF 22.',
        category: 'quality',
        pipeline: {
            name: '4K to 1080p HEVC',
            enabled: true,
            priority: 54,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: {
                operator: 'AND',
                conditions: [
                    { id: 'c-width', field: 'width', operator: 'greaterThan', value: '1920' },
                ],
            },
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                crf: 22,
                maxWidth: 1920,
            }],
        },
    },
    {
        id: 'av1-balanced',
        label: 'Balanced AV1',
        detail: 'AV1 CRF 30 / medium - modern codec for long-term space savings (slower encode).',
        category: 'quality',
        pipeline: {
            name: 'Balanced AV1',
            enabled: true,
            priority: 47,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: av1SkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'av1',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                crf: 30,
            }],
        },
    },
    {
        id: 'av1-space-saver',
        label: 'AV1 space saver',
        detail: 'AV1 CRF 34 / fast with AAC 96k - aggressive storage reclaim for cold archives.',
        category: 'quality',
        pipeline: {
            name: 'AV1 space saver',
            enabled: true,
            priority: 46,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: av1SkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'av1',
                audioCodec: 'aac',
                audioBitrateKbps: 96,
                subtitleCodec: 'copy',
                preset: 'fast',
                crf: 34,
            }],
        },
    },
    {
        id: 'h264-720p-compat',
        label: 'H.264 720p compatibility',
        detail: 'Cap at 1280px + H.264 CRF 23 AAC - max device compatibility profile.',
        category: 'quality',
        pipeline: {
            name: 'H.264 720p compatibility',
            enabled: true,
            priority: 38,
            outputMode: 'dry-run',
            hardware: 'auto',
            rules: h264SkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'h264',
                audioCodec: 'aac',
                audioBitrateKbps: 160,
                subtitleCodec: 'copy',
                preset: 'medium',
                crf: 23,
                maxWidth: 1280,
            }],
        },
    },
    {
        id: 'hevc-nvenc-balanced',
        label: 'HEVC NVENC balanced',
        detail: 'Same CRF 23 HEVC target with hardware set to NVENC when available.',
        category: 'quality',
        pipeline: {
            name: 'HEVC NVENC balanced',
            enabled: true,
            priority: 51,
            outputMode: 'dry-run',
            hardware: 'nvenc',
            rules: hevcSkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                crf: 23,
            }],
        },
    },
    {
        id: 'hevc-qsv-balanced',
        label: 'HEVC QSV balanced',
        detail: 'Balanced HEVC CRF 23 aimed at Intel Quick Sync hardware.',
        category: 'quality',
        pipeline: {
            name: 'HEVC QSV balanced',
            enabled: true,
            priority: 51,
            outputMode: 'dry-run',
            hardware: 'qsv',
            rules: hevcSkipRule(),
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                crf: 23,
            }],
        },
    },
    {
        id: 'remux-mkv-strip-subs',
        label: 'Remux MKV + strip subs',
        detail: 'Container cleanup to MKV, then drop embedded subtitle streams.',
        category: 'remux',
        pipeline: {
            name: 'Remux MKV strip subs',
            enabled: true,
            priority: 36,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [
                { type: 'remux', container: 'mkv' },
                { type: 'subtitle-strip', container: 'mkv' },
            ],
        },
    },
    {
        id: 'remux-mkv-keep-first-audio',
        label: 'Remux MKV + first audio',
        detail: 'Remux to MKV then keep only the first audio track (plus optional subs).',
        category: 'remux',
        pipeline: {
            name: 'Remux MKV first audio',
            enabled: true,
            priority: 35,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [
                { type: 'remux', container: 'mkv' },
                { type: 'keep-first-audio', container: 'mkv', keepSubtitles: true },
            ],
        },
    },
    {
        id: 'keep-first-audio',
        label: 'Keep first audio only',
        detail: 'Map first video + first audio (+ subs). Useful when extras tracks bloat files.',
        category: 'audio',
        pipeline: {
            name: 'Keep first audio only',
            enabled: true,
            priority: 31,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'keep-first-audio', container: 'mkv', keepSubtitles: true }],
        },
    },
    {
        id: 'opus-stereo-audio',
        label: 'Opus stereo audio',
        detail: 'Keep video, re-encode audio to Opus-friendly AAC path at 128k for smaller tracks.',
        category: 'audio',
        pipeline: {
            name: 'Compact stereo AAC',
            enabled: true,
            priority: 29,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: {
                operator: 'AND',
                conditions: [{
                    id: 'condition-audio',
                    field: 'audioCodec',
                    operator: 'notEquals',
                    value: 'aac',
                }],
            },
            steps: [{
                type: 'transcode',
                container: 'mkv',
                videoCodec: 'copy',
                audioCodec: 'aac',
                audioBitrateKbps: 128,
                subtitleCodec: 'copy',
                preset: 'medium',
                crf: 23,
            }],
        },
    },
    {
        id: 'loudnorm-then-stereo',
        label: 'Loudnorm + stereo',
        detail: 'Normalize first audio, then force a stereo AAC downmix for consistent playback.',
        category: 'audio',
        pipeline: {
            name: 'Loudnorm then stereo',
            enabled: true,
            priority: 26,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [
                { type: 'audio-normalize', container: 'mkv', audioBitrateKbps: 192 },
                { type: 'audio-stereo', container: 'mkv', audioBitrateKbps: 160 },
            ],
        },
    },
    {
        id: 'keep-en-es-subs',
        label: 'Keep English + Spanish subs',
        detail: 'Keep video/audio and only eng/en + spa/es subtitle streams.',
        category: 'subtitles',
        pipeline: {
            name: 'Keep EN+ES subtitles',
            enabled: true,
            priority: 33,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'subtitle-keep-lang', container: 'mkv', subtitleLanguages: 'eng,en,spa,es' }],
        },
    },
    {
        id: 'extract-english-subtitle',
        label: 'Extract English subtitle (SRT)',
        detail: 'Write preferred English subtitle stream beside the source as .srt.',
        category: 'subtitles',
        pipeline: {
            name: 'Extract English subtitle',
            enabled: true,
            priority: 24,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{
                type: 'subtitle-extract',
                container: 'mkv',
                subtitleLanguages: 'eng,en',
                skipMediaFinalize: true,
            }],
        },
    },
    {
        id: 'strip-subs-keep-first-audio',
        label: 'Strip subs + first audio',
        detail: 'Drop embedded subtitles and keep only the first audio track.',
        category: 'subtitles',
        pipeline: {
            name: 'Strip subs keep first audio',
            enabled: true,
            priority: 34,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [
                { type: 'subtitle-strip', container: 'mkv' },
                { type: 'keep-first-audio', container: 'mkv', keepSubtitles: false },
            ],
        },
    },
    {
        id: 'move-to-processed',
        label: 'Move to processed folder',
        detail: 'Move finished files into `{dir}/processed/{basename}` inside the library root.',
        category: 'utility',
        pipeline: {
            name: 'Move to processed',
            enabled: true,
            priority: 19,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{ type: 'move', destination: '{dir}/processed/{basename}' }],
        },
    },
    {
        id: 'move-named-episode',
        label: 'Move with Sonarr-ish name',
        detail: 'Archive using `{n} - {s00e00} - {quality}{ext}` tokens when probe/path hints resolve.',
        category: 'utility',
        pipeline: {
            name: 'Move named episode',
            enabled: true,
            priority: 18,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [{
                type: 'move',
                destination: '{dir}/archive/{n} - {s00e00} - {quality}{ext}',
            }],
        },
    },
    {
        id: 'commercial-strip-then-remux',
        label: 'Strip commercials + remux',
        detail: 'Cut commercial chapters when present, then remux the result to MKV.',
        category: 'utility',
        pipeline: {
            name: 'Strip commercials remux',
            enabled: true,
            priority: 22,
            outputMode: 'dry-run',
            hardware: 'cpu',
            rules: { operator: 'AND', conditions: [] },
            steps: [
                { type: 'commercial-strip', container: 'mkv' },
                { type: 'remux', container: 'mkv' },
            ],
        },
    },
];

/** Featured empty-state starters (subset of PIPELINE_PRESETS). */
export const PIPELINE_STARTER_IDS = [
    'remux-mkv',
    'hevc-nvenc-balanced',
    'balanced-hevc',
    'aac-audio-normalize',
] as const;
