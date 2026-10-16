import path from 'path';
import fs from 'fs/promises';
import { buildFfmpegPlan } from './ffmpeg-plan.js';
import { resolveContainedPath } from './files.js';
import { spawnCommand } from './spawn.js';
import { probeMedia } from './ffprobe.js';
import { buildNamingContext } from './naming.js';
export const STEP_TYPES = Object.freeze([
    'transcode',
    'remux',
    'subtitle-strip',
    'subtitle-extract',
    'subtitle-keep-lang',
    'keep-first-audio',
    'drop-commentary',
    'audio-normalize',
    'audio-stereo',
    'commercial-strip',
    'move',
    'custom-command',
]);

const DEFAULT_COMMERCIAL_PATTERN = 'commercial|advert|ad\\s*break|promo';

const BASIC_PLACEHOLDER_RE = /\{(input|output|dir|name|ext|basename|libraryRoot)\}/g;
const EXTENDED_TOKEN_RE = /\{(n|title|series|movie|s00e00|season|episode|episodeTitle|year|quality|videoCodec|audioCodec|stem)\}/g;

export const renderStepTemplate = (template, vars = {}) => String(template || '')
    .replace(BASIC_PLACEHOLDER_RE, (_, key) => {
        const value = vars[key];
        return value == null ? '' : String(value);
    })
    .replace(EXTENDED_TOKEN_RE, (_, key) => {
        const value = vars[key];
        return value == null ? '' : String(value);
    });

export const buildStepVars = ({
    inputPath,
    outputPath = '',
    libraryRoot = '',
    probe = null,
    namingContext = null,
} = {}) => {
    const resolvedInput = path.resolve(String(inputPath || ''));
    const parsed = path.parse(resolvedInput);
    const context = namingContext || buildNamingContext({
        probe: probe || {},
        sourcePath: resolvedInput,
    });
    return {
        input: resolvedInput,
        output: outputPath ? path.resolve(String(outputPath)) : '',
        dir: parsed.dir,
        name: parsed.name,
        ext: parsed.ext,
        basename: parsed.base,
        libraryRoot: libraryRoot ? path.resolve(String(libraryRoot)) : '',
        ...context,
        stem: context.stem || parsed.name,
    };
};

const assertSafeRelative = (value, label) => {
    const text = String(value || '');
    if (!text) throw new Error(`${label} is required`);
    if (text.includes('\0') || text.includes('..')) {
        throw new Error(`${label} must not contain null bytes or '..'`);
    }
    return text;
};

const parseLanguageList = (value) => [...new Set(
    String(value || '')
        .split(/[,\s]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => /^[a-z]{2,3}$/.test(entry))
        .slice(0, 12),
)];

const ffmpegBaseArgs = () => [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-progress', 'pipe:1', '-y',
];

const makeFfmpegPlan = ({
    stepType,
    mode,
    inputPath,
    outputPath,
    args,
    skipMediaFinalize = false,
    meta = {},
}) => ({
    kind: 'ffmpeg',
    stepType,
    executable: 'ffmpeg',
    args,
    mode: mode || stepType,
    adapter: null,
    adapterLabel: null,
    inputPath: String(inputPath),
    outputPath: String(outputPath),
    skipMediaFinalize,
    ...meta,
});

export const resolveAllowlistedExecutable = (executable, allowlist = ['ffmpeg', 'ffprobe']) => {
    const requested = String(executable || '').trim();
    if (!requested) throw new Error('Executable is required');
    if (requested.includes('\0') || requested.includes('..')) {
        throw new Error('Executable path is invalid');
    }
    const allowed = (Array.isArray(allowlist) ? allowlist : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const basenames = new Set(allowed.map((entry) => path.basename(entry).toLowerCase()));
    const absoluteAllowed = new Set(allowed.filter((entry) => path.isAbsolute(entry)).map((entry) => path.resolve(entry)));
    if (path.isAbsolute(requested)) {
        const resolved = path.resolve(requested);
        if (!absoluteAllowed.has(resolved) && !basenames.has(path.basename(resolved).toLowerCase())) {
            throw new Error(`Executable is not allowlisted: ${requested}`);
        }
        return resolved;
    }
    if (!basenames.has(requested.toLowerCase())) {
        throw new Error(`Executable is not allowlisted: ${requested}`);
    }
    return requested;
};

export const mergeTimeRanges = (ranges = []) => {
    const sorted = [...ranges]
        .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
        .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (!last || range.start > last.end) merged.push({ start: range.start, end: range.end });
        else last.end = Math.max(last.end, range.end);
    }
    return merged;
};

export const invertTimeRanges = (removes = [], duration = 0) => {
    const merged = mergeTimeRanges(removes);
    const keep = [];
    let cursor = 0;
    for (const range of merged) {
        if (range.start > cursor) keep.push({ start: cursor, end: range.start });
        cursor = Math.max(cursor, range.end);
    }
    if (Number.isFinite(duration) && duration > cursor) {
        keep.push({ start: cursor, end: duration });
    }
    return keep;
};

export const buildStepPlan = ({
    step = {},
    inputPath,
    outputPath,
    libraryRoot,
    adapter,
    capabilities,
    vaapiDevice,
    allowlist,
    probe = null,
    namingContext = null,
    hdr = null,
    hdrSettings = null,
    pipeline = null,
} = {}) => {
    const mode = String(step.mode || step.type || 'remux').toLowerCase();
    const vars = buildStepVars({ inputPath, outputPath, libraryRoot, probe, namingContext });
    const audioBitrate = Math.min(1536, Math.max(32, Number(step.audioBitrateKbps) || 192));

    if (mode === 'transcode' || mode === 'remux') {
        const plan = buildFfmpegPlan({
            inputPath,
            outputPath,
            rule: { then: { ...step, mode } },
            adapter,
            capabilities,
            vaapiDevice,
            probe,
            hdr,
            hdrSettings,
            pipeline,
        });
        return { ...plan, kind: 'ffmpeg', stepType: mode };
    }

    if (mode === 'subtitle-strip') {
        return makeFfmpegPlan({
            stepType: mode,
            inputPath,
            outputPath,
            args: [
                ...ffmpegBaseArgs(),
                '-i', String(inputPath),
                '-map', '0', '-map', '-0:s', '-c', 'copy',
                String(outputPath),
            ],
        });
    }

    if (mode === 'subtitle-extract') {
        const languages = parseLanguageList(step.subtitleLanguages || step.languages);
        const target = outputPath || path.join(vars.dir, `${vars.name}.srt`);
        const args = [
            '-hide_banner', '-nostdin', '-loglevel', 'warning', '-y',
            '-i', String(inputPath),
        ];
        if (languages.length) {
            for (const language of languages) args.push('-map', `0:s:m:language:${language}?`);
        } else {
            args.push('-map', '0:s:0?');
        }
        args.push('-c:s', 'srt', String(target));
        return makeFfmpegPlan({
            stepType: mode,
            inputPath,
            outputPath: target,
            args,
            skipMediaFinalize: true,
            meta: { subtitleLanguages: languages },
        });
    }

    if (mode === 'subtitle-keep-lang') {
        const languages = parseLanguageList(step.subtitleLanguages || step.languages);
        if (!languages.length) throw new Error('subtitle-keep-lang requires subtitleLanguages (e.g. eng,en)');
        const args = [
            ...ffmpegBaseArgs(),
            '-i', String(inputPath),
            '-map', '0:v', '-map', '0:a',
        ];
        for (const language of languages) args.push('-map', `0:s:m:language:${language}?`);
        args.push('-c', 'copy', String(outputPath));
        return makeFfmpegPlan({
            stepType: mode,
            inputPath,
            outputPath,
            args,
            meta: { subtitleLanguages: languages },
        });
    }

    if (mode === 'keep-first-audio') {
        const keepSubtitles = step.keepSubtitles !== false;
        const args = [
            ...ffmpegBaseArgs(),
            '-i', String(inputPath),
            '-map', '0:v:0?',
            '-map', '0:a:0?',
        ];
        if (keepSubtitles) args.push('-map', '0:s?');
        args.push('-c', 'copy', String(outputPath));
        return makeFfmpegPlan({
            stepType: mode,
            inputPath,
            outputPath,
            args,
        });
    }

    if (mode === 'drop-commentary') {
        return makeFfmpegPlan({
            stepType: mode,
            inputPath,
            outputPath,
            args: [
                ...ffmpegBaseArgs(),
                '-i', String(inputPath),
                '-map', '0',
                '-map', '-0:a:m:disposition:comment',
                '-map', '-0:a:m:disposition:commentary',
                '-c', 'copy',
                String(outputPath),
            ],
        });
    }

    if (mode === 'audio-normalize') {
        return makeFfmpegPlan({
            stepType: mode,
            inputPath,
            outputPath,
            args: [
                ...ffmpegBaseArgs(),
                '-i', String(inputPath),
                '-map', '0:v',
                '-map', '0:a:0?',
                '-map', '0:s?',
                '-c:v', 'copy',
                '-c:s', 'copy',
                '-c:a', 'aac',
                '-b:a', `${audioBitrate}k`,
                '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
                String(outputPath),
            ],
        });
    }

    if (mode === 'audio-stereo') {
        return makeFfmpegPlan({
            stepType: mode,
            inputPath,
            outputPath,
            args: [
                ...ffmpegBaseArgs(),
                '-i', String(inputPath),
                '-map', '0:v',
                '-map', '0:a:0?',
                '-map', '0:s?',
                '-c:v', 'copy',
                '-c:s', 'copy',
                '-ac', '2',
                '-c:a', 'aac',
                '-b:a', `${audioBitrate}k`,
                String(outputPath),
            ],
        });
    }

    if (mode === 'commercial-strip') {
        const pattern = String(step.commercialPattern || DEFAULT_COMMERCIAL_PATTERN).trim().slice(0, 200)
            || DEFAULT_COMMERCIAL_PATTERN;
        try {
            RegExp(pattern, 'i');
        } catch {
            throw new Error('commercialPattern is not a valid regular expression');
        }
        return {
            kind: 'commercial-strip',
            stepType: mode,
            mode,
            executable: 'ffmpeg',
            args: ['commercial-strip', 'chapters', pattern, String(inputPath), '->', String(outputPath)],
            commercialPattern: pattern,
            inputPath: String(inputPath),
            outputPath: String(outputPath),
            adapter: null,
            adapterLabel: null,
        };
    }

    if (mode === 'move') {
        const template = assertSafeRelative(step.destination || step.destinationTemplate, 'Move destination');
        const rendered = renderStepTemplate(template, vars);
        if (!rendered) throw new Error('Move destination resolved empty');
        const absolute = path.isAbsolute(rendered)
            ? path.resolve(rendered)
            : path.resolve(libraryRoot || vars.dir, rendered);
        return {
            kind: 'move',
            stepType: mode,
            mode: 'move',
            inputPath: String(inputPath),
            outputPath: absolute,
            libraryRoot: libraryRoot ? path.resolve(libraryRoot) : '',
            adapter: null,
            adapterLabel: null,
            args: ['move', String(inputPath), '->', absolute],
        };
    }

    if (mode === 'custom-command') {
        const executable = resolveAllowlistedExecutable(step.executable || step.command, allowlist);
        const rawArgs = Array.isArray(step.args) ? step.args : [];
        if (!rawArgs.length) throw new Error('Custom command args are required');
        const args = rawArgs.map((entry) => renderStepTemplate(assertSafeRelative(entry, 'Command arg'), {
            ...vars,
            output: outputPath ? path.resolve(String(outputPath)) : vars.output,
        }));
        return {
            kind: 'command',
            stepType: mode,
            mode: 'custom-command',
            executable,
            args,
            inputPath: String(inputPath),
            outputPath: outputPath ? String(outputPath) : '',
            adapter: null,
            adapterLabel: null,
            skipMediaFinalize: !!step.skipMediaFinalize,
        };
    }

    throw new Error(`Unsupported pipeline step type: ${mode}`);
};

const concatListEntry = (filePath) => {
    const normalized = String(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
    return `file '${normalized}'`;
};

const executeCommercialStrip = async (plan, {
    signal,
    timeoutMs,
    runner,
    ffmpegPath,
    ffprobePath,
    onProgress,
    durationSeconds,
} = {}) => {
    const { createLocalMediaExecutor } = await import('./executor.js');
    const executor = createLocalMediaExecutor({ ffmpegPath, runner, timeoutMs });
    const probe = await probeMedia(plan.inputPath, {
        ffprobePath: ffprobePath || 'ffprobe',
        runner,
        signal,
        timeoutMs: Math.min(timeoutMs || 60_000, 60_000),
    });
    const duration = Number(probe.format?.duration) || Number(durationSeconds) || 0;
    const pattern = new RegExp(plan.commercialPattern || DEFAULT_COMMERCIAL_PATTERN, 'i');
    const ads = mergeTimeRanges(
        (Array.isArray(probe.chapters) ? probe.chapters : []).map((chapter) => ({
            start: Number(chapter.start_time),
            end: Number(chapter.end_time),
            title: String(chapter.tags?.title || chapter.tags?.TITLE || ''),
        })).filter((chapter) => pattern.test(chapter.title)),
    );
    const copyPlan = makeFfmpegPlan({
        stepType: 'commercial-strip',
        inputPath: plan.inputPath,
        outputPath: plan.outputPath,
        args: [
            ...ffmpegBaseArgs(),
            '-i', String(plan.inputPath),
            '-map', '0', '-c', 'copy',
            String(plan.outputPath),
        ],
    });
    if (!ads.length) {
        const execution = await executor.execute(copyPlan, { signal, onProgress, durationSeconds: duration, timeoutMs });
        return { ...execution, commercialsRemoved: 0, note: 'No matching commercial chapters; remuxed copy' };
    }
    const keep = invertTimeRanges(ads, duration);
    if (!keep.length) {
        throw Object.assign(new Error('Commercial strip would remove the entire file'), { code: 'COMMERCIAL_STRIP_EMPTY' });
    }
    if (keep.length === 1 && keep[0].start <= 0.05 && (!duration || keep[0].end >= duration - 0.05)) {
        const execution = await executor.execute(copyPlan, { signal, onProgress, durationSeconds: duration, timeoutMs });
        return { ...execution, commercialsRemoved: 0, note: 'Keep range covers full file' };
    }

    const workDir = path.join(
        path.dirname(plan.outputPath),
        `.ma-commercial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await fs.mkdir(workDir, { recursive: true });
    try {
        const partFiles = [];
        for (let index = 0; index < keep.length; index += 1) {
            const partPath = path.join(workDir, `part-${index}.mkv`);
            const args = [
                '-hide_banner', '-nostdin', '-loglevel', 'warning', '-y',
                '-ss', String(keep[index].start),
                '-to', String(keep[index].end),
                '-i', String(plan.inputPath),
                '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
                partPath,
            ];
            await runner(ffmpegPath || 'ffmpeg', args, { signal, timeoutMs });
            partFiles.push(partPath);
        }
        const listPath = path.join(workDir, 'concat.txt');
        await fs.writeFile(listPath, `${partFiles.map(concatListEntry).join('\n')}\n`, 'utf8');
        const concatPlan = makeFfmpegPlan({
            stepType: 'commercial-strip',
            inputPath: plan.inputPath,
            outputPath: plan.outputPath,
            args: [
                '-hide_banner', '-nostdin', '-loglevel', 'warning', '-progress', 'pipe:1', '-y',
                '-f', 'concat', '-safe', '0', '-i', listPath,
                '-c', 'copy',
                String(plan.outputPath),
            ],
        });
        const execution = await executor.execute(concatPlan, {
            signal,
            onProgress,
            durationSeconds: keep.reduce((sum, range) => sum + (range.end - range.start), 0),
            timeoutMs,
        });
        return {
            ...execution,
            commercialsRemoved: ads.length,
            keepSegments: keep.length,
        };
    } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
};

export const executeStepPlan = async (plan, {
    signal,
    timeoutMs,
    runner = spawnCommand,
    ffmpegPath = 'ffmpeg',
    ffprobePath = 'ffprobe',
    onProgress,
    durationSeconds,
    libraryRoots = [],
} = {}) => {
    if (!plan?.kind) throw new Error('A valid step plan is required');

    if (plan.kind === 'ffmpeg') {
        const { createLocalMediaExecutor } = await import('./executor.js');
        const executor = createLocalMediaExecutor({ ffmpegPath, runner, timeoutMs });
        return executor.execute(plan, { signal, onProgress, durationSeconds, timeoutMs });
    }

    if (plan.kind === 'commercial-strip') {
        return executeCommercialStrip(plan, {
            signal,
            timeoutMs,
            runner,
            ffmpegPath,
            ffprobePath,
            onProgress,
            durationSeconds,
        });
    }

    if (plan.kind === 'command') {
        const startedAt = Date.now();
        const result = await runner(plan.executable, plan.args.map(String), {
            signal,
            timeoutMs,
        });
        return {
            code: result.code,
            durationMs: Date.now() - startedAt,
            stderr: result.stderr,
            outputPath: plan.outputPath || null,
            command: [plan.executable, ...plan.args],
        };
    }

    if (plan.kind === 'move') {
        const roots = (libraryRoots || []).map((root) => path.resolve(root)).filter(Boolean);
        if (!roots.length && plan.libraryRoot) roots.push(path.resolve(plan.libraryRoot));
        if (!roots.length) throw new Error('Move requires a library root');
        const resolveUnderRoots = async (candidate, { mustExist = true } = {}) => {
            for (const root of roots) {
                try {
                    return await resolveContainedPath(root, candidate, { allowSymlinks: false, mustExist });
                } catch {
                    // try next root
                }
            }
            return null;
        };
        const sourcePath = await resolveUnderRoots(plan.inputPath, { mustExist: true });
        const destination = await resolveUnderRoots(plan.outputPath, { mustExist: false });
        if (!sourcePath || !destination) {
            throw Object.assign(new Error('Move paths must stay inside configured library roots'), { code: 'PATH_ESCAPE' });
        }
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const startedAt = Date.now();
        try {
            await fs.rename(sourcePath, destination);
        } catch (error) {
            if (error.code !== 'EXDEV') throw error;
            await fs.copyFile(sourcePath, destination);
            await fs.rm(sourcePath, { force: true });
        }
        return {
            code: 0,
            durationMs: Date.now() - startedAt,
            stderr: '',
            outputPath: destination,
            moved: true,
        };
    }

    throw new Error(`Unsupported plan kind: ${plan.kind}`);
};

export default buildStepPlan;
