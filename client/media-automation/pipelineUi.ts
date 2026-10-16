import type {
    MediaAutomationJob,
    MediaAutomationLibrary,
    MediaAutomationPipeline,
    MediaAutomationRuleCondition,
    MediaAutomationRules,
    MediaAutomationStatus,
    MediaAutomationStep,
    OutputMode,
} from './types';

const fieldLabel = (field: MediaAutomationRuleCondition['field']) => ({
    path: 'path',
    container: 'container',
    videoCodec: 'video codec',
    audioCodec: 'audio codec',
    width: 'width',
    bitrate: 'bitrate',
    hdr: 'HDR',
}[field] || field);

const operatorLabel = (operator: MediaAutomationRuleCondition['operator']) => ({
    equals: 'is',
    notEquals: 'is not',
    contains: 'contains',
    matches: 'matches',
    greaterThan: '>',
    lessThan: '<',
}[operator] || operator);

export const normalizePipelineRules = (value: unknown): MediaAutomationRules => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { operator: 'AND', conditions: [] };
    }
    const record = value as Partial<MediaAutomationRules>;
    return {
        operator: record.operator === 'OR' ? 'OR' : 'AND',
        conditions: Array.isArray(record.conditions)
            ? record.conditions.map((condition, index) => ({
                id: String((condition as MediaAutomationRuleCondition | undefined)?.id || `condition-${index + 1}`),
                field: (condition as MediaAutomationRuleCondition)?.field || 'videoCodec',
                operator: (condition as MediaAutomationRuleCondition)?.operator || 'equals',
                value: String((condition as MediaAutomationRuleCondition)?.value ?? ''),
            }))
            : [],
    };
};

export const summarizeMatchRules = (rulesInput: unknown): string => {
    const rules = normalizePipelineRules(rulesInput);
    if (!rules.conditions.length) return 'Matches every file';
    const parts = rules.conditions.map((condition) => {
        if (condition.field === 'hdr') {
            return `HDR is ${condition.value === 'false' ? 'no' : 'yes'}`;
        }
        return `${fieldLabel(condition.field)} ${operatorLabel(condition.operator)} ${condition.value || '…'}`;
    });
    const joiner = rules.operator === 'OR' ? ' or ' : ' and ';
    return `Runs when ${parts.join(joiner)}`;
};

const outputModeLabel = (mode?: OutputMode | string) => {
    const value = String(mode || 'dry-run').toLowerCase();
    if (value === 'copy') return 'Copy';
    if (value === 'replace') return 'Replace';
    return 'Plan only';
};

const hardwareLabel = (hardware?: string) => {
    const value = String(hardware || 'auto').toLowerCase();
    return ({
        auto: 'Auto HW',
        cpu: 'CPU',
        nvenc: 'NVENC',
        qsv: 'QSV',
        'intel-vaapi': 'Intel VAAPI',
        vaapi: 'AMD VAAPI',
    } as Record<string, string>)[value] || value;
};

const summarizeStep = (step: MediaAutomationStep): string => {
    if (step.type === 'transcode') {
        const codec = String(step.videoCodec || 'hevc').toUpperCase();
        const quality = step.videoBitrateKbps
            ? `${step.videoBitrateKbps}kbps`
            : (step.crf != null ? `CRF ${step.crf}` : null);
        const keepAv = step.audioCodec === 'copy' && (!step.subtitleCodec || step.subtitleCodec === 'copy');
        return [codec, quality, keepAv ? 'keep A/V' : null].filter(Boolean).join(' · ');
    }
    if (step.type === 'remux') return `Remux ${String(step.container || 'mkv').toUpperCase()}`;
    if (step.type === 'subtitle-strip') return 'Strip subtitles';
    if (step.type === 'subtitle-extract') return 'Extract subtitle';
    if (step.type === 'subtitle-keep-lang') return 'Keep subtitle languages';
    if (step.type === 'audio-normalize') return 'Loudnorm audio';
    if (step.type === 'audio-stereo') return 'Stereo downmix';
    if (step.type === 'drop-commentary') return 'Drop commentary';
    if (step.type === 'commercial-strip') return 'Strip commercials';
    if (step.type === 'move') return 'Move / rename';
    if (step.type === 'custom-command') return 'Custom command';
    return step.type;
};

export const summarizePipelineOutcome = (pipeline: MediaAutomationPipeline): string => {
    const first = (pipeline.steps || [])[0];
    const action = first ? summarizeStep(first) : 'No steps';
    const extra = (pipeline.steps || []).length > 1 ? `+${(pipeline.steps || []).length - 1} more` : null;
    return [action, extra, outputModeLabel(pipeline.outputMode), hardwareLabel(pipeline.hardware)]
        .filter(Boolean)
        .join(' · ');
};

const normalizeFsPath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export const libraryPipelineLabel = (
    library: MediaAutomationLibrary,
    pipelines: MediaAutomationPipeline[],
): string => {
    if (library.pipelineId == null || library.pipelineId === '') return 'Automatic';
    const match = pipelines.find((pipeline) => String(pipeline.id) === String(library.pipelineId));
    return match?.name || `Pipeline ${library.pipelineId}`;
};

export const summarizeLibraryOutcome = (
    library: MediaAutomationLibrary,
    pipelines: MediaAutomationPipeline[],
): string => {
    const root = String(library.rootPath || '').trim() || '…';
    const pipeline = libraryPipelineLabel(library, pipelines);
    const out = String(library.outputPath || '').trim();
    return [
        `Scans ${root}`,
        pipeline === 'Automatic' ? 'Automatic' : pipeline,
        out ? `out ${out}` : 'pipeline default out',
    ].join(' · ');
};

const ACTIVE_JOB_STATES = new Set([
    'queued', 'pending', 'waiting', 'running', 'active', 'processing', 'paused', 'retry', 'retrying',
]);

export const pathBelongsToLibrary = (filePath: string, library: MediaAutomationLibrary): boolean => {
    const root = normalizeFsPath(String(library.rootPath || '').trim());
    const file = normalizeFsPath(String(filePath || '').trim());
    if (!root || !file) return false;
    return file === root || file.startsWith(`${root}/`);
};

export const countJobsForLibrary = (
    jobs: MediaAutomationJob[],
    library: MediaAutomationLibrary,
): number => jobs.filter((job) => {
    const state = String(job.state || job.status || '').toLowerCase();
    if (!ACTIVE_JOB_STATES.has(state)) return false;
    const filePath = String(job.path || job.sourcePath || '');
    return pathBelongsToLibrary(filePath, library);
}).length;

export type SetupChecklistStep = {
    id: string;
    label: string;
    detail: string;
    done: boolean;
    warn?: boolean;
    actionLabel?: string;
    action?: 'settings' | 'libraries' | 'pipelines' | 'start-worker' | 'scan';
};

const SETUP_DISMISS_KEY = 'media-automation-setup-dismissed-v1';

export const isSetupChecklistDismissed = () => {
    try {
        return localStorage.getItem(SETUP_DISMISS_KEY) === '1';
    } catch {
        return false;
    }
};

export const setSetupChecklistDismissed = (dismissed: boolean) => {
    try {
        if (dismissed) localStorage.setItem(SETUP_DISMISS_KEY, '1');
        else localStorage.removeItem(SETUP_DISMISS_KEY);
    } catch {
        // ignore
    }
};

export const buildSetupChecklist = ({
    status,
    libraries,
    pipelines,
}: {
    status: MediaAutomationStatus;
    libraries: MediaAutomationLibrary[];
    pipelines: MediaAutomationPipeline[];
}): SetupChecklistStep[] => {
    const featureOn = status.enabled !== false;
    const hasLibrary = libraries.some((library) => String(library.rootPath || '').trim());
    const enabledPipelines = pipelines.filter((pipeline) => pipeline.enabled !== false);
    const hasPipeline = enabledPipelines.length > 0;
    const pipelineWrites = enabledPipelines.some((pipeline) => pipeline.outputMode === 'copy' || pipeline.outputMode === 'replace');
    const globalDryRun = !!(status.dryRun || status.outputMode === 'dry-run');
    const hasSample = enabledPipelines.some((pipeline) => String(pipeline.samplePath || '').trim());
    const workerPaused = (status.workerPaused ?? status.paused) !== false;
    const workerRunning = !workerPaused;

    return [
        {
            id: 'feature',
            label: 'Feature enabled',
            detail: featureOn ? 'Media Automation is on.' : 'Turn it on under Settings → Media Automation.',
            done: featureOn,
            actionLabel: featureOn ? undefined : 'Open Settings',
            action: featureOn ? undefined : 'settings',
        },
        {
            id: 'library',
            label: 'Library mapped',
            detail: hasLibrary ? 'At least one library root is configured.' : 'Add a library root the container can see (e.g. /media).',
            done: hasLibrary,
            actionLabel: hasLibrary ? undefined : 'Add library',
            action: hasLibrary ? undefined : 'libraries',
        },
        {
            id: 'pipeline',
            label: 'Pipeline ready',
            detail: !hasPipeline
                ? 'Create an enabled pipeline (start from a template if unsure).'
                : (pipelineWrites ? 'An enabled pipeline can write (copy/replace).' : 'Pipelines are still plan-only (dry-run).'),
            done: hasPipeline,
            warn: hasPipeline && !pipelineWrites,
            actionLabel: hasPipeline ? undefined : 'Add pipeline',
            action: hasPipeline ? undefined : 'pipelines',
        },
        {
            id: 'writes',
            label: 'Writes allowed',
            detail: globalDryRun
                ? 'Settings → Safe fallback is Dry run, so jobs will not rewrite media.'
                : 'Global Safe fallback allows copy/replace writes.',
            done: !globalDryRun,
            warn: globalDryRun && pipelineWrites,
            actionLabel: globalDryRun ? 'Fix Safe fallback' : undefined,
            action: globalDryRun ? 'settings' : undefined,
        },
        {
            id: 'sample',
            label: 'Sample file set',
            detail: hasSample
                ? 'A pipeline has a saved sample for dry-run / queue.'
                : 'Edit a pipeline and save a sample file, then run Dry-run once.',
            done: hasSample,
            actionLabel: hasSample ? undefined : 'Open pipelines',
            action: hasSample ? undefined : 'pipelines',
        },
        {
            id: 'worker',
            label: 'Encoding started',
            detail: workerRunning
                ? 'Worker is encoding queued jobs.'
                : 'Jobs can be queued while paused. Start when you want encodes to run.',
            done: workerRunning,
            actionLabel: workerRunning ? undefined : 'Start encoding',
            action: workerRunning ? undefined : 'start-worker',
        },
    ];
};

export const setupChecklistComplete = (steps: SetupChecklistStep[]) => steps.every((step) => step.done && !step.warn);
