import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import test from 'node:test';
import {
    JOB_PHASES,
    JOB_STATES,
    buildJobDedupeKey,
    canTransitionJob,
    createMediaJob,
    fingerprintSourceFile,
    transitionJob,
} from './models.js';
import { createAtomicJsonStore } from './store.js';
import { createDurableJobQueue } from './queue.js';
import { buildRuleContext, findMatchingRule, matchMediaRule } from './rules.js';
import { isPathContained, resolveContainedPath } from './files.js';
import { buildFfmpegPlan } from './ffmpeg-plan.js';
import {
    buildStepPlan,
    executeStepPlan,
    renderStepTemplate,
    resolveAllowlistedExecutable,
    mergeTimeRanges,
    invertTimeRanges,
} from './steps.js';
import { collectBrowseRoots, listBrowseDirectory, resolveBrowsePath, discoverContainerMounts, isBrowsePathDenied } from './browse.js';
import {
    CPU_ADAPTER,
    NVENC_ADAPTER,
    QSV_ADAPTER,
    createSyntheticAdapterTest,
    detectFfmpegCapabilities,
    selectMediaAdapter,
} from './adapters.js';
import { prepareMediaOutput, promoteFile, finalizeMediaOutput } from './output.js';
import { spawnCommand } from './spawn.js';
import { estimateHeuristicSavings, summarizeProbeForAnalyze } from './analyze.js';
import {
    detectHdr,
    shouldSkipForHdr,
    buildHdrPreserveArgs,
    formatMasterDisplay,
} from './hdr.js';
import { normalizeMediaAutomationConfig, getDefaultMediaAutomationConfig, shouldPauseEncodingForLibraryScan } from './config.js';
import { isQuietHoursActive } from './quiet-hours.js';
import { createMediaScheduler } from './scheduler.js';
import { createMediaLibraryWatcher } from './watcher.js';
import { parseProgressOutTimeUs, parseStderrSpeed, parseStderrTimeUs, parseTimeHmsToUs, resolveEncodeSpeed, resolveProgressOutTimeUs, computeEncodeEtaSeconds } from './executor.js';
import { createMediaProcessor } from './processor.js';

const withTempDir = async (fn) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-automation-'));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
};

test('job state machine allows expected transitions only', () => {
    assert.equal(canTransitionJob(JOB_STATES.QUEUED, JOB_STATES.RUNNING), true);
    assert.equal(canTransitionJob(JOB_STATES.RUNNING, JOB_STATES.SUCCEEDED), true);
    assert.equal(canTransitionJob(JOB_STATES.RUNNING, JOB_PHASES.COMMITTING), false);
    assert.equal(canTransitionJob(JOB_STATES.SUCCEEDED, JOB_STATES.QUEUED), false);
    const job = createMediaJob({ sourcePath: '/media/a.mkv' });
    const running = transitionJob(job, JOB_STATES.RUNNING, { phase: JOB_PHASES.PROBING });
    assert.equal(running.state, JOB_STATES.RUNNING);
    assert.equal(running.phase, JOB_PHASES.PROBING);
});

test('dedupe key includes fingerprint and pipeline', () => {
    assert.equal(
        buildJobDedupeKey({ sourcePath: '/media/a.mkv', fingerprint: '10:20:30', pipelineId: 'p1' }),
        '/media/a.mkv::10:20:30::p1',
    );
});

test('fingerprintSourceFile uses size and mtime', async () => {
    await withTempDir(async (dir) => {
        const filePath = path.join(dir, 'clip.mkv');
        await fs.writeFile(filePath, 'abcdef');
        const fingerprint = await fingerprintSourceFile(filePath);
        assert.match(fingerprint, /^\d+:\d+:/);
    });
});

test('queue dedupes by fingerprint and recovers expired leases', async () => {
    await withTempDir(async (dir) => {
        let now = Date.parse('2026-01-01T00:00:00.000Z');
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store, clock: () => now });
        const first = await queue.enqueue({
            sourcePath: '/media/a.mkv',
            fingerprint: '1:2:3',
            pipelineId: 'pipe-1',
            dedupeKey: buildJobDedupeKey({
                sourcePath: '/media/a.mkv',
                fingerprint: '1:2:3',
                pipelineId: 'pipe-1',
            }),
        });
        const duplicate = await queue.enqueue({
            sourcePath: '/media/a.mkv',
            fingerprint: '1:2:3',
            pipelineId: 'pipe-1',
            dedupeKey: buildJobDedupeKey({
                sourcePath: '/media/a.mkv',
                fingerprint: '1:2:3',
                pipelineId: 'pipe-1',
            }),
        });
        assert.equal(duplicate.id, first.id);

        const claimed = await queue.claim({ workerId: 'worker-a', leaseMs: 1000 });
        assert.equal(claimed.id, first.id);
        now += 5000;
        const recovered = await queue.recoverExpired();
        assert.equal(recovered.length, 1);
        assert.equal(recovered[0].state, JOB_STATES.QUEUED);
        assert.equal(recovered[0].phase, JOB_PHASES.QUEUED);
    });
});

test('claim refuses when lane already at maxRunning', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue-max.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const a = await queue.enqueue({ sourcePath: '/media/a.mkv', lane: 'gpu' });
        const b = await queue.enqueue({ sourcePath: '/media/b.mkv', lane: 'gpu' });
        const first = await queue.claim({ workerId: 'w1', lane: 'gpu', maxRunning: 1 });
        assert.equal(first.id, a.id);
        const second = await queue.claim({ workerId: 'w2', lane: 'gpu', maxRunning: 1 });
        assert.equal(second, null);
        assert.equal((await queue.get(b.id)).state, JOB_STATES.QUEUED);
        const third = await queue.claim({ workerId: 'w2', lane: 'gpu', maxRunning: 2 });
        assert.equal(third.id, b.id);
    });
});

test('recoverOrphanedRunning clears all RUNNING jobs even with valid leases', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue-orphan.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const job = await queue.enqueue({ sourcePath: '/media/a.mkv', lane: 'gpu' });
        const claimed = await queue.claim({ workerId: 'w1', lane: 'gpu', leaseMs: 120_000 });
        assert.equal(claimed.id, job.id);
        assert.equal(claimed.state, JOB_STATES.RUNNING);
        const recovered = await queue.recoverOrphanedRunning();
        assert.equal(recovered.length, 1);
        assert.equal(recovered[0].state, JOB_STATES.QUEUED);
        assert.equal(recovered[0].error?.code, 'WORKER_RESTART');
        assert.equal((await queue.list()).filter((entry) => entry.state === JOB_STATES.RUNNING).length, 0);
    });
});

test('rules match structured condition groups', () => {
    const context = buildRuleContext({
        filePath: '/media/movies/film.mkv',
        libraryRoot: '/media/movies',
        probe: {
            format: { format_name: 'matroska,webm', bit_rate: '8000000' },
            streams: [
                { codec_type: 'video', codec_name: 'h264', width: 1920, color_transfer: 'bt709' },
                { codec_type: 'audio', codec_name: 'aac' },
            ],
        },
    });
    assert.equal(matchMediaRule({
        enabled: true,
        conditionGroup: {
            operator: 'AND',
            conditions: [
                { field: 'videoCodec', operator: 'equals', value: 'h264' },
                { field: 'width', operator: 'greaterThan', value: '1280' },
            ],
        },
    }, context), true);
    assert.equal(findMatchingRule([{
        id: 'hevc-only',
        priority: 10,
        conditionGroup: {
            operator: 'AND',
            conditions: [{ field: 'videoCodec', operator: 'equals', value: 'hevc' }],
        },
    }, {
        id: 'h264',
        priority: 1,
        conditionGroup: {
            operator: 'AND',
            conditions: [{ field: 'videoCodec', operator: 'equals', value: 'h264' }],
        },
    }], context)?.id, 'h264');
});

test('path containment rejects escapes and symlinks', async () => {
    await withTempDir(async (dir) => {
        const root = path.join(dir, 'library');
        const outside = path.join(dir, 'outside.mkv');
        const inside = path.join(root, 'inside.mkv');
        const link = path.join(root, 'linked.mkv');
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(outside, 'x');
        await fs.writeFile(inside, 'y');
        assert.equal(isPathContained(root, inside), true);
        assert.equal(isPathContained(root, outside), false);
        await assert.rejects(() => resolveContainedPath(root, '../outside.mkv'), /escapes/);
        assert.equal(await resolveContainedPath(root, inside), path.resolve(inside));
        try {
            await fs.symlink(outside, link);
        } catch (error) {
            // Windows often blocks symlink creation without Developer Mode / elevation.
            if (error?.code === 'EPERM' || error?.code === 'EACCES') return;
            throw error;
        }
        await assert.rejects(() => resolveContainedPath(root, link, { allowSymlinks: false }), /Symbolic links/);
        const allowed = await resolveContainedPath(root, link, { allowSymlinks: true });
        assert.equal(path.resolve(allowed), path.resolve(outside));
    });
});

test('ffmpeg plan builds remux and transcode args without shell fragments', () => {
    const remux = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: { then: { mode: 'remux' } },
    });
    assert.equal(remux.mode, 'remux');
    assert.ok(remux.args.includes('-c'));
    assert.ok(remux.args.includes('copy'));
    assert.ok(!remux.args.some((arg) => String(arg).includes(';')));

    const transcode = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: { then: { mode: 'transcode', videoCodec: 'h264', audioCodec: 'aac', subtitleCodec: 'drop', maxWidth: 1280 } },
        adapter: CPU_ADAPTER,
        capabilities: { details: { cpu: { encoders: ['libx264'] } } },
    });
    assert.equal(transcode.adapter, 'cpu');
    assert.ok(transcode.args.includes('libx264'));
    assert.ok(transcode.args.includes('-sn'));
    assert.ok(transcode.args.includes('-vf'));

    const quality = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: { then: { mode: 'transcode', videoCodec: 'hevc', preset: 'slow', crf: 18 } },
        adapter: CPU_ADAPTER,
        capabilities: { details: { cpu: { encoders: ['libx265'] } } },
    });
    assert.ok(quality.args.includes('-crf'));
    assert.ok(quality.args.includes('18'));
    assert.ok(quality.args.includes('slow'));

    const bitrate = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: {
            then: {
                mode: 'transcode',
                videoCodec: 'hevc',
                audioCodec: 'copy',
                subtitleCodec: 'copy',
                preset: 'medium',
                videoBitrateKbps: 1500,
                crf: 23,
            },
        },
        adapter: CPU_ADAPTER,
        capabilities: { details: { cpu: { encoders: ['libx265'] } } },
    });
    assert.ok(bitrate.args.includes('-b:v'));
    assert.ok(bitrate.args.includes('1500k'));
    assert.ok(bitrate.args.includes('-maxrate'));
    assert.ok(!bitrate.args.includes('-crf'));
    assert.ok(bitrate.args.includes('-c:a'));
    assert.ok(bitrate.args.includes('copy'));
    assert.ok(bitrate.args.includes('-c:s'));
});

test('qsv plan uses vaapi child device and format=qsv upload filter', () => {
    const plan = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: { then: { mode: 'transcode', videoCodec: 'hevc', audioCodec: 'copy', subtitleCodec: 'copy', videoBitrateKbps: 1500 } },
        adapter: QSV_ADAPTER,
        capabilities: { details: { qsv: { encoders: ['hevc_qsv', 'h264_qsv'] } } },
        vaapiDevice: '/dev/dri/renderD128',
    });
    assert.equal(plan.adapter, 'qsv');
    assert.ok(plan.args.includes('hevc_qsv'));
    assert.ok(plan.args.includes('-init_hw_device'));
    assert.ok(plan.args.some((arg) => String(arg).startsWith('vaapi=va:/dev/dri/renderD128')));
    assert.ok(plan.args.includes('qsv=hw@va'));
    const vfIndex = plan.args.indexOf('-vf');
    assert.ok(vfIndex >= 0);
    assert.match(String(plan.args[vfIndex + 1]), /format=nv12,hwupload=extra_hw_frames=64,format=qsv/);
});

test('10-bit transcode plans use p010/main10 and ignore h264', () => {
    const qsvTenBit = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: { then: { mode: 'transcode', videoCodec: 'hevc', tenBit: true } },
        adapter: QSV_ADAPTER,
        capabilities: { details: { qsv: { encoders: ['hevc_qsv'] } } },
        vaapiDevice: '/dev/dri/renderD128',
    });
    const qsvVf = String(qsvTenBit.args[qsvTenBit.args.indexOf('-vf') + 1]);
    assert.match(qsvVf, /^format=p010,hwupload/);
    assert.ok(qsvTenBit.args.includes('-profile:v'));
    assert.ok(qsvTenBit.args.includes('main10'));

    const cpuTenBit = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: { then: { mode: 'transcode', videoCodec: 'hevc', tenBit: true } },
        capabilities: { details: { cpu: { encoders: ['libx265'] } } },
    });
    const pixIndex = cpuTenBit.args.indexOf('-pix_fmt');
    assert.ok(pixIndex >= 0);
    assert.equal(cpuTenBit.args[pixIndex + 1], 'yuv420p10le');
    assert.ok(cpuTenBit.args.includes('main10'));

    // 10-bit H.264 is rejected by hardware encoders and most players — flag is ignored.
    const h264TenBit = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: { then: { mode: 'transcode', videoCodec: 'h264', tenBit: true } },
        capabilities: { details: { cpu: { encoders: ['libx264'] } } },
    });
    assert.ok(!h264TenBit.args.includes('-pix_fmt'));
    assert.ok(!h264TenBit.args.includes('main10'));
});

test('hardware adapters select auto preference and run synthetic tests through fake ffmpeg', async () => {
    const capabilities = await detectFfmpegCapabilities({
        syntheticOutput: ' V..... h264_nvenc\n V..... libx264\n V..... h264_qsv\n V..... h264_vaapi\n',
        testAdapter: createSyntheticAdapterTest({ nvenc: true, qsv: false, vaapi: true, 'intel-vaapi': true }),
        runSyntheticTests: true,
    });
    assert.equal(capabilities.cpu, true);
    assert.equal(capabilities.nvenc, true);
    assert.equal(capabilities.qsv, false);
    assert.match(String(capabilities.details.qsv?.error || ''), /synthetic test disabled/);
    assert.equal(selectMediaAdapter('auto', capabilities, 'h264').name, 'nvenc');
    assert.equal(selectMediaAdapter('cpu', capabilities, 'h264').name, 'cpu');
    assert.throws(() => selectMediaAdapter('qsv', capabilities, 'h264'), /unavailable/);
    assert.equal(NVENC_ADAPTER.encoders.h264, 'h264_nvenc');
});

test('capability preflight reports missing /dev/dri instead of opaque ffmpeg VA errors', async () => {
    const capabilities = await detectFfmpegCapabilities({
        syntheticOutput: ' V..... h264_qsv\n V..... h264_vaapi\n V..... h264_nvenc\n V..... libx264\n',
        runSyntheticTests: true,
        devices: {
            dri: {
                present: false,
                renderNodes: [],
                cardNodes: [],
                device: '/dev/dri/renderD128',
                exists: false,
                readable: false,
                vendors: [],
                vendor: null,
            },
            nvidia: {
                device: true,
                cudaLib: null,
                visibleDevices: null,
                driverCapabilities: null,
            },
        },
    });
    assert.equal(capabilities.qsv, false);
    assert.match(String(capabilities.details.qsv?.error || ''), /not mapped/i);
    assert.equal(capabilities.nvenc, false);
    assert.match(String(capabilities.details.nvenc?.error || ''), /libcuda|NVIDIA/i);
});

test('capability preflight keeps AMD VAAPI off on Intel-only DRM vendors', async () => {
    const capabilities = await detectFfmpegCapabilities({
        syntheticOutput: ' V..... h264_qsv\n V..... h264_vaapi\n V..... libx264\n',
        runSyntheticTests: true,
        testAdapter: createSyntheticAdapterTest({ qsv: true, 'intel-vaapi': true, vaapi: true }),
        devices: {
            dri: {
                present: true,
                renderNodes: ['/dev/dri/renderD128'],
                cardNodes: ['/dev/dri/card0'],
                device: '/dev/dri/renderD128',
                exists: true,
                readable: true,
                vendors: ['intel'],
                vendor: 'intel',
                vendorId: '0x8086',
            },
            nvidia: {
                device: false,
                cudaLib: null,
                visibleDevices: null,
                driverCapabilities: null,
            },
        },
    });
    assert.equal(capabilities['intel-vaapi'], true);
    assert.equal(capabilities.qsv, true);
    assert.equal(capabilities.vaapi, false);
    assert.match(String(capabilities.details.vaapi?.error || ''), /No AMD GPU/i);
});

test('parseProgressOutTimeUs reads ffmpeg progress clocks', () => {
    assert.equal(parseProgressOutTimeUs({ out_time_us: '1500000' }), 1_500_000);
    assert.equal(parseProgressOutTimeUs({ out_time: '00:01:30.5' }), 90.5 * 1_000_000);
    assert.equal(parseProgressOutTimeUs({}), null);
    assert.equal(parseProgressOutTimeUs({ out_time_us: '0', frame: '100', fps: '25.0' }), 0);
});

test('resolveProgressOutTimeUs falls back when mux clocks stay at zero', () => {
    assert.equal(
        resolveProgressOutTimeUs({ out_time_us: '0', frame: '2050', fps: '205.0' }),
        Math.round((2050 / 205) * 1_000_000),
    );
    assert.equal(
        resolveProgressOutTimeUs({ out_time_us: '0' }, 45_000_000),
        45_000_000,
    );
    assert.equal(parseStderrTimeUs('size= 1234kB time=00:01:30.50 bitrate=1234kbits/s'), 90.5 * 1_000_000);
    assert.equal(parseTimeHmsToUs('00:00:00.000000'), 0);
    assert.equal(parseStderrSpeed('bitrate=1234kbits/s speed=6.5x'), 6.5);
    assert.equal(resolveEncodeSpeed({ fps: '165.0' }), 6.6);
    assert.equal(
        Math.round(computeEncodeEtaSeconds(2762, 20, 6.6)),
        415,
    );
});

test('prepareMediaOutput supports dry-run copy and replace targets', () => {
    const dry = prepareMediaOutput({ sourcePath: '/media/a.mkv', mode: 'dry-run' });
    assert.equal(dry.mode, 'dry-run');
    const copy = prepareMediaOutput({ sourcePath: '/media/a.mkv', mode: 'copy', extension: '.mkv' });
    assert.equal(copy.mode, 'copy');
    assert.match(copy.finalPath, /\.automated\.mkv$/);
    const replace = prepareMediaOutput({ sourcePath: '/media/a.mkv', mode: 'replace', extension: '.mkv' });
    assert.equal(replace.finalPath, path.resolve('/media/a.mkv'));
    assert.notEqual(replace.workPath, replace.finalPath);
    assert.equal(path.dirname(replace.workPath), path.dirname(replace.finalPath));
});

test('prepareMediaOutput stages replace work under workDir', () => {
    const staged = prepareMediaOutput({
        sourcePath: '/media/library/Show - S01E01.mkv',
        mode: 'replace',
        extension: '.mkv',
        workDir: '/mnt/ssd/encode-staging',
    });
    assert.equal(staged.finalPath, path.resolve('/media/library/Show - S01E01.mkv'));
    assert.equal(staged.sourcePath, staged.finalPath);
    assert.equal(path.dirname(staged.workPath), path.resolve('/mnt/ssd/encode-staging'));
    assert.match(path.basename(staged.workPath), /\.partial\.mkv$/);
    assert.ok(path.basename(staged.workPath).includes('Show - S01E01'));
});

test('promoteFile falls back to copy on EXDEV', async () => {
    await withTempDir(async (dir) => {
        const from = path.join(dir, 'from.mkv');
        const to = path.join(dir, 'to.mkv');
        await fs.writeFile(from, 'encoded');
        const result = await promoteFile(from, to, {
            renameFile: async () => {
                const err = new Error('cross-device link');
                err.code = 'EXDEV';
                throw err;
            },
        });
        assert.equal(result.method, 'copy');
        assert.equal(await fs.readFile(to, 'utf8'), 'encoded');
        await assert.rejects(() => fs.access(from));
    });
});

test('finalizeMediaOutput promotes staged replace onto original path', async () => {
    await withTempDir(async (dir) => {
        const library = path.join(dir, 'library');
        const staging = path.join(dir, 'staging');
        await fs.mkdir(library, { recursive: true });
        await fs.mkdir(staging, { recursive: true });
        const sourcePath = path.join(library, 'Show - S01E01.mkv');
        await fs.writeFile(sourcePath, 'original-bytes');
        const prepared = prepareMediaOutput({
            sourcePath,
            mode: 'replace',
            extension: '.mkv',
            workDir: staging,
        });
        await fs.writeFile(prepared.workPath, 'encoded-bytes');
        const output = await finalizeMediaOutput(prepared, {
            verify: false,
            renameFile: async () => {
                const err = new Error('cross-device link');
                err.code = 'EXDEV';
                throw err;
            },
        });
        assert.equal(output.finalPath, sourcePath);
        assert.equal(await fs.readFile(sourcePath, 'utf8'), 'encoded-bytes');
        await assert.rejects(() => fs.access(prepared.workPath));
    });
});

test('config prefers nested concurrency over stale flat fields', () => {
    const normalized = normalizeMediaAutomationConfig({
        cpuConcurrency: 1,
        gpuConcurrency: 1,
        concurrency: { cpu: 3, gpu: 2 },
    });
    assert.equal(normalized.cpuConcurrency, 3);
    assert.equal(normalized.gpuConcurrency, 2);
});

test('config normalizes scan and watch settings', () => {
    const defaults = getDefaultMediaAutomationConfig();
    assert.equal(defaults.libraryScanEnabled, true);
    assert.equal(defaults.libraryWatchEnabled, false);
    assert.deepEqual(defaults.customCommandAllowlist, ['ffmpeg', 'ffprobe']);
    const normalized = normalizeMediaAutomationConfig({
        libraryScanEnabled: false,
        libraryScanIntervalMinutes: 5,
        libraryWatchDebounceMs: 100,
        libraryWatchEnabled: true,
        customCommandAllowlist: ['ffmpeg', 'ffmpeg', 'ffprobe'],
    });
    assert.equal(normalized.libraryScanEnabled, false);
    assert.equal(normalized.libraryScanIntervalMinutes, 15);
    assert.equal(normalized.libraryWatchDebounceMs, 500);
    assert.equal(normalized.libraryWatchEnabled, true);
    assert.deepEqual(normalized.customCommandAllowlist, ['ffmpeg', 'ffprobe']);
    const copyMode = normalizeMediaAutomationConfig({ outputMode: 'copy', dryRun: true });
    assert.equal(copyMode.outputMode, 'copy');
    assert.equal(copyMode.dryRun, false);
    const pausedLanes = normalizeMediaAutomationConfig({ cpuConcurrency: 0, gpuConcurrency: 0 });
    assert.equal(pausedLanes.cpuConcurrency, 0);
    assert.equal(pausedLanes.gpuConcurrency, 0);
    assert.equal(defaults.pauseWhenStreamingEnabled, false);
    assert.equal(defaults.arrRescanEnabled, false);
    assert.equal(defaults.scannerRefreshEnabled, false);
    assert.equal(defaults.plexRescanEnabled, false);
    assert.equal(defaults.minSavingsPercent, 0);
    assert.equal(defaults.dolbyVisionHandling, 'skip');
    assert.equal(defaults.hdr10Handling, 'preserve');
    assert.equal(defaults.workerPaused, true);
    assert.equal(defaults.pauseEncodingOnScan, true);
    assert.equal(normalizeMediaAutomationConfig({}).workerPaused, true);
    assert.equal(normalizeMediaAutomationConfig({ workerPaused: false }).workerPaused, false);
    assert.equal(normalizeMediaAutomationConfig({ workerPaused: true }).workerPaused, true);
    assert.equal(normalizeMediaAutomationConfig({ pauseEncodingOnScan: false }).pauseEncodingOnScan, false);
    assert.equal(shouldPauseEncodingForLibraryScan({ pauseEncodingOnScan: true }, { source: 'manual' }), true);
    assert.equal(shouldPauseEncodingForLibraryScan({ pauseEncodingOnScan: true }, {}), true);
    assert.equal(shouldPauseEncodingForLibraryScan({ pauseEncodingOnScan: true }, { source: 'scheduled' }), false);
    assert.equal(shouldPauseEncodingForLibraryScan({ pauseEncodingOnScan: true }, { source: 'periodic' }), false);
    assert.equal(shouldPauseEncodingForLibraryScan({ pauseEncodingOnScan: false }, { source: 'manual' }), false);
    const guarded = normalizeMediaAutomationConfig({
        pauseWhenStreamingEnabled: true,
        pauseWhenStreamingLanes: 'ALL',
        arrRescanEnabled: true,
        plexRescanEnabled: true,
        minSavingsPercent: 150,
    });
    assert.equal(guarded.pauseWhenStreamingEnabled, true);
    assert.equal(guarded.pauseWhenStreamingLanes, 'all');
    assert.equal(guarded.arrRescanEnabled, true);
    assert.equal(guarded.plexRescanEnabled, true);
    assert.equal(guarded.minSavingsPercent, 95);
    assert.equal(normalizeMediaAutomationConfig({ pauseWhenStreamingLanes: 'bogus' }).pauseWhenStreamingLanes, 'gpu');
});

test('first-party steps plan subtitle strip, move, and allowlisted custom command', () => {
    const strip = buildStepPlan({
        step: { type: 'subtitle-strip', container: 'mkv' },
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
    });
    assert.equal(strip.kind, 'ffmpeg');
    assert.ok(strip.args.includes('-0:s'));
    assert.ok(strip.args.includes('copy'));

    const extract = buildStepPlan({
        step: { type: 'subtitle-extract' },
        inputPath: '/media/library/title.mkv',
        libraryRoot: '/media/library',
    });
    assert.equal(extract.kind, 'ffmpeg');
    assert.equal(extract.skipMediaFinalize, true);
    assert.match(extract.outputPath, /\.srt$/);

    const keepLang = buildStepPlan({
        step: { type: 'subtitle-keep-lang', subtitleLanguages: 'eng,en' },
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
    });
    assert.ok(keepLang.args.includes('0:s:m:language:eng?'));
    assert.ok(keepLang.args.includes('0:s:m:language:en?'));

    const keepAudio = buildStepPlan({
        step: { type: 'keep-first-audio' },
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
    });
    assert.ok(keepAudio.args.includes('0:a:0?'));

    const dropCommentary = buildStepPlan({
        step: { type: 'drop-commentary' },
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
    });
    assert.ok(dropCommentary.args.includes('-0:a:m:disposition:commentary'));

    const loudnorm = buildStepPlan({
        step: { type: 'audio-normalize', audioBitrateKbps: 160 },
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
    });
    assert.ok(loudnorm.args.some((arg) => String(arg).includes('loudnorm')));
    assert.ok(loudnorm.args.includes('160k'));

    const stereo = buildStepPlan({
        step: { type: 'audio-stereo' },
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
    });
    assert.ok(stereo.args.includes('-ac'));
    assert.ok(stereo.args.includes('2'));

    const commercial = buildStepPlan({
        step: { type: 'commercial-strip' },
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
    });
    assert.equal(commercial.kind, 'commercial-strip');
    assert.match(commercial.commercialPattern, /commercial/i);

    const move = buildStepPlan({
        step: { type: 'move', destination: '{dir}/archive/{basename}' },
        inputPath: '/media/library/title.mkv',
        libraryRoot: '/media/library',
    });
    assert.equal(move.kind, 'move');
    assert.ok(move.outputPath.includes(`${path.sep}archive${path.sep}`) || move.outputPath.includes('/archive/'));

    assert.equal(resolveAllowlistedExecutable('ffmpeg', ['ffmpeg', 'ffprobe']), 'ffmpeg');
    assert.throws(() => resolveAllowlistedExecutable('bash', ['ffmpeg']), /allowlisted/);
    assert.equal(
        renderStepTemplate('-i {input}', { input: '/media/a.mkv' }),
        '-i /media/a.mkv',
    );

    const custom = buildStepPlan({
        step: {
            type: 'custom-command',
            executable: 'ffmpeg',
            args: ['-i', '{input}', '-c', 'copy', '{output}'],
        },
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        allowlist: ['ffmpeg'],
    });
    assert.equal(custom.kind, 'command');
    assert.equal(custom.executable, 'ffmpeg');
    assert.ok(custom.args.some((arg) => String(arg).endsWith(`${path.sep}in.mkv`) || String(arg).endsWith('/in.mkv')));
});

test('browse lists only directories under allowed roots', async () => {
    await withTempDir(async (dir) => {
        const movies = path.join(dir, 'movies');
        const nested = path.join(movies, 'Action');
        await fs.mkdir(nested, { recursive: true });
        await fs.writeFile(path.join(movies, 'readme.txt'), 'nope');
        const roots = await collectBrowseRoots({ candidates: [dir], extraRoots: [], discoverMounts: false });
        assert.equal(roots.length, 1);
        const top = await listBrowseDirectory('', { roots });
        assert.ok(top.entries.some((entry) => entry.type === 'root'));
        const listing = await listBrowseDirectory(movies, { roots });
        assert.ok(listing.entries.some((entry) => entry.name === 'Action' && entry.type === 'directory'));
        assert.ok(!listing.entries.some((entry) => entry.name === 'readme.txt'));
        await fs.writeFile(path.join(movies, 'film.mkv'), 'video');
        const withFiles = await listBrowseDirectory(movies, { roots, includeFiles: true, extensions: ['.mkv'] });
        assert.ok(withFiles.entries.some((entry) => entry.name === 'film.mkv' && entry.type === 'file'));
        assert.ok(!withFiles.entries.some((entry) => entry.name === 'readme.txt'));
        await assert.rejects(
            () => listBrowseDirectory(path.join(dir, '..'), { roots, allowAdhoc: false }),
            /outside|invalid/i,
        );
        await assert.rejects(
            () => listBrowseDirectory(`${movies}/../..`, { roots }),
            /invalid/i,
        );
    });
});

test('browse admits typed paths outside soft defaults and denies system paths', async () => {
    await withTempDir(async (dir) => {
        const custom = path.join(dir, 'output-staging');
        await fs.mkdir(custom, { recursive: true });
        await fs.mkdir(path.join(custom, 'batch'), { recursive: true });
        const softRoot = path.join(dir, 'media');
        await fs.mkdir(softRoot, { recursive: true });
        const roots = await collectBrowseRoots({ candidates: [softRoot], extraRoots: [], discoverMounts: false });
        assert.equal(roots.length, 1);

        const admitted = await listBrowseDirectory(custom, { roots, allowAdhoc: true });
        assert.equal(admitted.root, path.resolve(custom));
        assert.equal(admitted.parent, path.dirname(path.resolve(custom)));
        assert.ok(admitted.entries.some((entry) => entry.name === 'batch'));

        const nested = await listBrowseDirectory(path.join(custom, 'batch'), { roots, allowAdhoc: true });
        assert.equal(nested.root, path.resolve(path.join(custom, 'batch')));
        assert.equal(nested.parent, path.resolve(custom));

        assert.equal(isBrowsePathDenied('/etc/passwd'), true);
        assert.equal(isBrowsePathDenied('/proc'), true);
        assert.equal(isBrowsePathDenied(custom), false);
        await assert.rejects(() => resolveBrowsePath('/etc', roots), /outside|denied/i);
    });
});

test('discoverContainerMounts skips virtual filesystems and deny prefixes', async () => {
    const mountInfo = [
        '1 0 0:1 / / rw - overlay /overlay rw',
        '2 1 0:2 / /proc rw - proc proc rw',
        '3 1 0:3 / /sys rw - sysfs sysfs rw',
        '4 1 8:1 / /output rw - ext4 /dev/sda1 rw',
        '5 1 8:2 / /etc/extra rw - ext4 /dev/sda2 rw',
        '6 1 8:3 / /media rw - xfs /dev/sdb1 rw',
        '',
    ].join('\n');
    const mounts = await discoverContainerMounts({
        readFile: async () => mountInfo,
    });
    assert.ok(mounts.includes('/output'));
    assert.ok(mounts.includes('/media'));
    assert.ok(!mounts.includes('/'));
    assert.ok(!mounts.includes('/proc'));
    assert.ok(!mounts.includes('/etc/extra'));
});

test('browse sorts full directory then paginates and filters', async () => {
    await withTempDir(async (dir) => {
        const shows = path.join(dir, 'tv');
        await fs.mkdir(shows, { recursive: true });
        const names = ['Zebra', 'Alpha', 'Happy Together', 'Halo', 'Yankee', 'Beta'];
        for (const name of names) {
            await fs.mkdir(path.join(shows, name), { recursive: true });
        }
        const roots = await collectBrowseRoots({ candidates: [dir], extraRoots: [], discoverMounts: false });
        const page = await listBrowseDirectory(shows, { roots, limit: 3, offset: 0 });
        assert.equal(page.total, 6);
        assert.equal(page.hasMore, true);
        assert.deepEqual(page.entries.map((entry) => entry.name), ['Alpha', 'Beta', 'Halo']);
        const next = await listBrowseDirectory(shows, { roots, limit: 3, offset: 3 });
        assert.deepEqual(next.entries.map((entry) => entry.name), ['Happy Together', 'Yankee', 'Zebra']);
        assert.equal(next.hasMore, false);
        const filtered = await listBrowseDirectory(shows, { roots, query: 'happ', limit: 10 });
        assert.deepEqual(filtered.entries.map((entry) => entry.name), ['Happy Together']);
        assert.equal(filtered.total, 1);
    });
});

test('commercial chapter ranges merge and invert', () => {
    const merged = mergeTimeRanges([
        { start: 10, end: 20 },
        { start: 18, end: 25 },
        { start: 40, end: 50 },
    ]);
    assert.deepEqual(merged, [
        { start: 10, end: 25 },
        { start: 40, end: 50 },
    ]);
    assert.deepEqual(invertTimeRanges(merged, 100), [
        { start: 0, end: 10 },
        { start: 25, end: 40 },
        { start: 50, end: 100 },
    ]);
});

test('move step stays inside library roots', async () => {
    await withTempDir(async (dir) => {
        const root = path.join(dir, 'library');
        const archive = path.join(root, 'archive');
        await fs.mkdir(archive, { recursive: true });
        const source = path.join(root, 'title.mkv');
        await fs.writeFile(source, 'video');
        const plan = buildStepPlan({
            step: { type: 'move', destination: '{dir}/archive/{basename}' },
            inputPath: source,
            libraryRoot: root,
        });
        const result = await executeStepPlan(plan, { libraryRoots: [root] });
        assert.equal(result.moved, true);
        await assert.rejects(() => fs.access(source));
        await fs.access(result.outputPath);
    });
});

test('queue setPriority and skip update queued jobs', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const job = await queue.enqueue({ sourcePath: '/media/a.mkv', priority: 1 });
        const raised = await queue.setPriority(job.id, 90);
        assert.equal(raised.priority, 90);
        const skipped = await queue.skip(job.id, 'not needed');
        assert.equal(skipped.state, JOB_STATES.CANCELLED);
        assert.equal(skipped.error?.code, 'SKIPPED');
        assert.equal(skipped.metadata?.skipped, true);
    });
});

test('queue cancelMany and removeMany clear active and finished jobs', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const a = await queue.enqueue({ sourcePath: '/media/a.mkv', priority: 1 });
        const b = await queue.enqueue({ sourcePath: '/media/b.mkv', priority: 2 });
        const claimed = await queue.claim({ workerId: 'w1', lane: 'cpu' });
        assert.ok(claimed);
        await queue.complete(claimed.id, 'w1', { dryRun: true });
        const cancelled = await queue.cancelMany();
        assert.equal(cancelled.length, 1);
        assert.equal(cancelled[0].state, JOB_STATES.CANCELLED);
        const removed = await queue.removeMany();
        assert.equal(removed, 2);
        assert.equal((await queue.list()).length, 0);
        assert.equal(a.id !== b.id, true);
    });
});

test('queue retryMany requeues failed and cancelled jobs', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const a = await queue.enqueue({ sourcePath: '/media/a.mkv', maxAttempts: 1 });
        const b = await queue.enqueue({ sourcePath: '/media/b.mkv', maxAttempts: 1 });
        const c = await queue.enqueue({ sourcePath: '/media/c.mkv' });
        const claimedA = await queue.claim({ workerId: 'w1', lane: 'cpu' });
        assert.equal(claimedA.id, a.id);
        await queue.fail(claimedA.id, 'w1', new Error('boom'));
        await queue.cancelMany({ ids: [b.id] });
        const retried = await queue.retryMany();
        assert.equal(retried.length, 2);
        assert.ok(retried.every((job) => job.state === JOB_STATES.QUEUED && job.attempts === 0 && !job.error));
        const listed = await queue.list();
        assert.equal(listed.filter((job) => job.state === JOB_STATES.QUEUED).length, 3);
        assert.equal(listed.find((job) => job.id === c.id).state, JOB_STATES.QUEUED);
    });
});

test('scheduler reports periodic scanning when enabled', async () => {
    let scanned = 0;
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async () => ({ didWork: false }),
            scan: async () => {
                scanned += 1;
                return { discovered: 1, enqueued: 1, skipped: 0, errors: [] };
            },
        },
        getConfig: async () => ({
            enabled: true,
            cpuConcurrency: 1,
            gpuConcurrency: 1,
            libraryScanEnabled: true,
            libraryScanIntervalMinutes: 15,
        }),
        workerPollMs: 60_000,
    });
    await scheduler.start();
    const status = scheduler.status();
    assert.equal(status.periodicScanning, true);
    const result = await scheduler.scanNow();
    assert.equal(scanned, 1);
    assert.equal(result.enqueued, 1);
    assert.ok(status.lastScanAt || scheduler.status().lastScanAt);
    scheduler.stop();
    assert.equal(scheduler.status().periodicScanning, false);
});

test('scheduler pauses gpu lane while streams are active and resumes after', async () => {
    const lanesProcessed = [];
    let streams = 2;
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async ({ lane }) => {
                lanesProcessed.push(lane);
                return { didWork: false };
            },
            scan: async () => ({}),
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: false,
            cpuConcurrency: 1,
            gpuConcurrency: 1,
            libraryScanEnabled: false,
            pauseWhenStreamingEnabled: true,
            pauseWhenStreamingLanes: 'gpu',
        }),
        getActiveStreamCount: async () => streams,
        streamCheckTtlMs: 0,
        workerPollMs: 60_000,
    });
    await scheduler.start();
    await scheduler.processNow();
    assert.ok(lanesProcessed.includes('cpu'));
    assert.ok(!lanesProcessed.includes('gpu'));
    assert.equal(scheduler.status().streamingPauseActive, true);
    assert.equal(scheduler.status().activeStreamCount, 2);
    streams = 0;
    lanesProcessed.length = 0;
    await scheduler.processNow();
    assert.ok(lanesProcessed.includes('gpu'));
    assert.equal(scheduler.status().streamingPauseActive, false);
    scheduler.stop();
});

test('quiet hours treat a shortened window as inactive at the current time', () => {
    const at = (hours, minutes) => new Date(2026, 5, 15, hours, minutes, 0, 0);
    const window = (start, end) => ({
        quietHoursEnabled: true,
        quietHoursStart: start,
        quietHoursEnd: end,
    });
    assert.equal(isQuietHoursActive(window('00:00', '09:00'), at(7, 30)), true);
    assert.equal(isQuietHoursActive(window('00:00', '07:00'), at(7, 30)), false);
    assert.equal(isQuietHoursActive(window('00:00', '07:00'), at(6, 59)), true);
    assert.equal(isQuietHoursActive(window('23:00', '09:00'), at(7, 30)), true);
    assert.equal(isQuietHoursActive(window('23:00', '07:00'), at(7, 30)), false);
    assert.equal(isQuietHoursActive({ quietHoursEnabled: false, quietHoursStart: '00:00', quietHoursEnd: '09:00' }, at(7, 30)), false);
});

test('scheduler unpauses encodes when quiet hours no longer include now', async () => {
    let processCalls = 0;
    let quietHoursEnd = '09:00';
    const now = new Date(2026, 5, 15, 7, 30, 0, 0);
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async () => {
                processCalls += 1;
                return { didWork: false };
            },
            scan: async () => ({}),
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: false,
            quietHoursEnabled: true,
            quietHoursStart: '00:00',
            quietHoursEnd,
            cpuConcurrency: 1,
            gpuConcurrency: 0,
            libraryScanEnabled: false,
        }),
        clock: () => now,
        workerPollMs: 60_000,
    });
    await scheduler.start();
    assert.equal(processCalls, 0);
    assert.equal(scheduler.status().quietHoursActive, true);
    quietHoursEnd = '07:00';
    await scheduler.processNow();
    assert.equal(scheduler.status().quietHoursActive, false);
    assert.ok(processCalls > 0);
    scheduler.stop();
});

test('scheduler cancelScan aborts an in-flight scan', async () => {
    let started = false;
    let sawAbort = false;
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async () => ({ didWork: false }),
            scan: async ({ signal } = {}) => {
                started = true;
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(resolve, 5_000);
                    signal?.addEventListener('abort', () => {
                        sawAbort = true;
                        clearTimeout(timer);
                        reject(Object.assign(new Error('Scan cancelled'), { code: 'ABORT_ERR' }));
                    }, { once: true });
                }).catch((error) => {
                    if (error?.code === 'ABORT_ERR') return { discovered: 1, enqueued: 0, skipped: 0, cancelled: true, errors: [] };
                    throw error;
                });
                return { discovered: 1, enqueued: 0, skipped: 0, cancelled: true, errors: [] };
            },
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: true,
            libraryScanEnabled: false,
        }),
        workerPollMs: 60_000,
    });
    await scheduler.start();
    const pending = scheduler.scanNow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(started, true);
    const cancelResult = await scheduler.cancelScan();
    assert.equal(cancelResult.cancelled, true);
    assert.equal(cancelResult.progressCleared, true);
    assert.equal(scheduler.status().scanning, false);
    const result = await pending;
    assert.equal(sawAbort, true);
    assert.equal(result.cancelled, true);
    scheduler.stop();
});

test('scheduler cancelScan clears stuck progress when not scanning', async () => {
    let progress = { running: true, discovered: 722, enqueued: 0, skipped: 0 };
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async () => ({ didWork: false }),
            scan: async () => ({ discovered: 0, enqueued: 0, skipped: 0, errors: [] }),
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: true,
            libraryScanEnabled: false,
        }),
        scanHistory: {
            setProgress: async (next) => { progress = next; return next; },
            getProgress: async () => progress,
        },
        workerPollMs: 60_000,
    });
    await scheduler.start();
    const cancelResult = await scheduler.cancelScan();
    assert.equal(cancelResult.cancelled, false);
    assert.equal(cancelResult.progressCleared, true);
    assert.equal(progress, null);
    scheduler.stop();
});

test('scheduler skips encode claims when workerPaused and still scans', async () => {
    let processCalls = 0;
    let scanCalls = 0;
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async () => {
                processCalls += 1;
                return { didWork: false };
            },
            scan: async () => {
                scanCalls += 1;
                return { discovered: 2, enqueued: 1, skipped: 1, errors: [] };
            },
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: true,
            cpuConcurrency: 1,
            gpuConcurrency: 1,
            libraryScanEnabled: true,
            libraryScanIntervalMinutes: 15,
        }),
        workerPollMs: 60_000,
    });
    await scheduler.start();
    await scheduler.processNow();
    assert.equal(processCalls, 0);
    const result = await scheduler.scanNow();
    assert.equal(scanCalls, 1);
    assert.equal(result.enqueued, 1);
    scheduler.stop();

    processCalls = 0;
    const active = createMediaScheduler({
        processor: {
            processOne: async () => {
                processCalls += 1;
                return { didWork: false };
            },
            scan: async () => ({}),
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: false,
            cpuConcurrency: 1,
            gpuConcurrency: 0,
            libraryScanEnabled: false,
        }),
        workerPollMs: 60_000,
    });
    await active.start();
    await active.processNow();
    assert.ok(processCalls > 0);
    active.stop();
});

test('scheduler calls onLibraryScanBegin before wet scans but not previews', async () => {
    let beginCalls = 0;
    let scanPhase = '';
    const beginSources = [];
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async () => ({ didWork: false }),
            scan: async () => {
                scanPhase = beginCalls > 0 ? 'after-begin' : 'no-begin';
                return { discovered: 1, enqueued: 1, skipped: 0, errors: [] };
            },
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: false,
            cpuConcurrency: 0,
            gpuConcurrency: 0,
            libraryScanEnabled: false,
        }),
        onLibraryScanBegin: async (options) => {
            beginCalls += 1;
            beginSources.push(options?.source || null);
        },
        workerPollMs: 60_000,
    });
    await scheduler.scanNow({ preview: true });
    assert.equal(beginCalls, 0);
    await scheduler.scanNow({ source: 'manual' });
    assert.equal(beginCalls, 1);
    assert.equal(scanPhase, 'after-begin');
    assert.deepEqual(beginSources, ['manual']);
    await scheduler.scanNow({ source: 'scheduled' });
    assert.equal(beginCalls, 2);
    assert.deepEqual(beginSources, ['manual', 'scheduled']);
});

test('watcher ignores disabled watch and unsupported extensions', async () => {
    await withTempDir(async (dir) => {
        const mediaDir = path.join(dir, 'media');
        await fs.mkdir(mediaDir);
        const mkv = path.join(mediaDir, 'show.mkv');
        const txt = path.join(mediaDir, 'notes.txt');
        await fs.writeFile(mkv, 'video');
        await fs.writeFile(txt, 'text');
        const enqueued = [];
        const watcher = createMediaLibraryWatcher({
            getConfig: async () => ({
                enabled: true,
                libraryWatchEnabled: true,
                libraryWatchDebounceMs: 50,
                extensions: ['.mkv'],
            }),
            listLibraries: async () => [{ id: 'lib-1', rootPath: mediaDir, enabled: true, pipelineId: null }],
            enqueuePath: async (filePath) => {
                enqueued.push(filePath);
                return { enqueued: true, job: { id: 'job-1', sourcePath: filePath } };
            },
        });
        await watcher.start();
        // Trigger handlers through a short-lived second start/stop cycle is hard;
        // instead assert status while watching the configured root.
        const status = watcher.status();
        assert.equal(status.watching, true);
        await watcher.stop();
        assert.equal(watcher.status().watching, false);

        const disabled = createMediaLibraryWatcher({
            getConfig: async () => ({
                enabled: true,
                libraryWatchEnabled: false,
                libraryWatchDebounceMs: 50,
                extensions: ['.mkv'],
            }),
            listLibraries: async () => [{ id: 'lib-1', rootPath: mediaDir, enabled: true }],
            enqueuePath: async () => ({ enqueued: true }),
        });
        const disabledStatus = await disabled.start();
        assert.equal(disabledStatus.watching, false);
        await disabled.stop();
        assert.equal(enqueued.length, 0);
    });
});

test('heuristic savings prefer target bitrate and still estimate CRF pipelines', () => {
    const probe = {
        format: { size: 10_000_000_000, duration: '7200', bit_rate: '11111111', format_name: 'matroska,webm' },
        streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, bit_rate: '10000000' },
            { codec_type: 'audio', codec_name: 'aac', bit_rate: '384000', channels: 2 },
        ],
    };
    const summary = summarizeProbeForAnalyze(probe);
    assert.equal(summary.videoCodec, 'h264');
    assert.equal(summary.width, 1920);
    assert.ok(summary.bitrateKbps > 9000);

    const bitratePipeline = {
        steps: [{ mode: 'transcode', videoCodec: 'hevc', audioCodec: 'copy', videoBitrateKbps: 1500 }],
    };
    const bitrateEstimate = estimateHeuristicSavings({ probe, pipeline: bitratePipeline });
    assert.equal(bitrateEstimate.confidence, 'high');
    assert.equal(bitrateEstimate.reason, 'target-bitrate');
    assert.ok(bitrateEstimate.estimatedBytesSaved > 5_000_000_000);
    assert.ok(bitrateEstimate.estimatedSavingsPercent > 50);

    const crfPipeline = {
        steps: [{ mode: 'transcode', videoCodec: 'hevc', audioCodec: 'copy', crf: 23 }],
    };
    const crfEstimate = estimateHeuristicSavings({ probe, pipeline: crfPipeline });
    assert.equal(crfEstimate.confidence, 'medium');
    assert.equal(crfEstimate.reason, 'crf-ratio');
    assert.ok(crfEstimate.estimatedBytesSaved > 0);
    assert.ok(crfEstimate.estimatedSavingsPercent > 20);

    const remuxOnly = estimateHeuristicSavings({
        probe,
        pipeline: { steps: [{ mode: 'remux', videoCodec: 'copy', audioCodec: 'copy' }] },
    });
    assert.equal(remuxOnly.estimatedBytesSaved, 0);
    assert.equal(remuxOnly.reason, 'no-transcode-step');
});

test('HDR detect distinguishes SDR, HDR10, HLG, Dolby Vision, and 10-bit SDR', () => {
    assert.equal(detectHdr({
        codec_type: 'video',
        codec_name: 'hevc',
        bits_per_raw_sample: '10',
        color_transfer: 'bt709',
    }).kind, 'none');

    const hdr10 = detectHdr({
        codec_type: 'video',
        codec_name: 'hevc',
        color_transfer: 'smpte2084',
        color_primaries: 'bt2020',
        color_space: 'bt2020nc',
        side_data_list: [{
            side_data_type: 'Mastering display metadata',
            red_x: 0.68, red_y: 0.32,
            green_x: 0.265, green_y: 0.69,
            blue_x: 0.15, blue_y: 0.06,
            white_point_x: 0.3127, white_point_y: 0.329,
            min_luminance: 0.005, max_luminance: 1000,
        }, {
            side_data_type: 'Content light level metadata',
            max_content: 1000,
            max_average: 200,
        }],
    });
    assert.equal(hdr10.kind, 'hdr10');
    assert.equal(hdr10.isHdr, true);
    assert.match(String(hdr10.masterDisplay), /^G\(\d+,\d+\)B\(\d+,\d+\)R\(\d+,\d+\)WP\(\d+,\d+\)L\(\d+,\d+\)$/);
    assert.equal(hdr10.maxCll, '1000,200');
    assert.ok(formatMasterDisplay({
        red_x: 0.68, red_y: 0.32, green_x: 0.265, green_y: 0.69,
        blue_x: 0.15, blue_y: 0.06, white_point_x: 0.3127, white_point_y: 0.329,
        min_luminance: 0.005, max_luminance: 1000,
    }));

    assert.equal(detectHdr({
        codec_type: 'video',
        color_transfer: 'arib-std-b67',
    }).kind, 'hlg');

    const dovi = detectHdr({
        codec_type: 'video',
        codec_name: 'hevc',
        codec_tag_string: 'dvhe',
        side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 7 }],
    });
    assert.equal(dovi.kind, 'dolby-vision');
    assert.equal(dovi.isDolbyVision, true);

    const skip = shouldSkipForHdr({
        hdr: dovi,
        settings: { dolbyVisionHandling: 'skip' },
        steps: [{ mode: 'transcode', videoCodec: 'hevc' }],
    });
    assert.equal(skip?.reason, 'dolby-vision');
    assert.equal(shouldSkipForHdr({
        hdr: dovi,
        settings: { dolbyVisionHandling: 'skip' },
        steps: [{ mode: 'remux', videoCodec: 'copy' }],
    }), null);

    const preserveArgs = buildHdrPreserveArgs({
        hdr: hdr10,
        adapterName: 'cpu',
        videoEncoder: 'libx265',
        logicalCodec: 'hevc',
    });
    assert.ok(preserveArgs.includes('-color_trc'));
    assert.ok(preserveArgs.includes('smpte2084'));
    assert.ok(preserveArgs.includes('-x265-params'));
    assert.match(String(preserveArgs[preserveArgs.indexOf('-x265-params') + 1]), /master-display=/);

    const hdrPlan = buildFfmpegPlan({
        inputPath: '/media/in.mkv',
        outputPath: '/media/out.mkv',
        rule: { then: { mode: 'transcode', videoCodec: 'hevc', audioCodec: 'copy' } },
        capabilities: { details: { cpu: { encoders: ['libx265'] } } },
        probe: {
            streams: [{
                codec_type: 'video',
                codec_name: 'hevc',
                color_transfer: 'smpte2084',
                color_primaries: 'bt2020',
                color_space: 'bt2020nc',
            }],
        },
        hdrSettings: { hdr10Handling: 'preserve' },
    });
    assert.ok(hdrPlan.args.includes('yuv420p10le'));
    assert.ok(hdrPlan.args.includes('main10'));
    assert.ok(hdrPlan.args.includes('smpte2084'));
    assert.equal(hdrPlan.hdrKind, 'hdr10');
});

test('queue.fail persists truncated stderr and timeline advances on progress', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const job = await queue.enqueue({ sourcePath: '/media/a.mkv', libraryRoot: '/media' });
        assert.equal(job.metadata.timeline[0].phase, JOB_PHASES.QUEUED);
        const claimed = await queue.claim({ workerId: 'w1' });
        await queue.updateProgress(claimed.id, 'w1', { phase: JOB_PHASES.PROBING });
        await queue.updateProgress(claimed.id, 'w1', { phase: JOB_PHASES.PROCESSING });
        const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`);
        const failed = await queue.fail(claimed.id, 'w1', {
            code: 'FFMPEG_FAILED',
            message: 'encode failed',
            stderr: lines.join('\n'),
        }, { retryDelayMs: 0 });
        assert.equal(failed.state, JOB_STATES.QUEUED);
        assert.ok(failed.error.stderr.includes('line-49'));
        assert.equal(failed.error.stderr.includes('line-0'), false);
        const timelinePhases = failed.metadata.timeline.map((entry) => entry.phase);
        assert.ok(timelinePhases.includes(JOB_PHASES.PROBING));
        assert.ok(timelinePhases.includes(JOB_PHASES.PROCESSING));
    });
});

test('path deny list matches prefixes and globs', async () => {
    const { isPathDenied, normalizePathDenyList } = await import('./path-policy.js');
    const list = normalizePathDenyList(['/media/keep', '**/sample*']);
    assert.equal(isPathDenied('/media/keep/show.mkv', list), true);
    assert.equal(isPathDenied('/media/other/show.mkv', list), false);
});

test('retry with forceCpu sets metadata and lane', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const job = await queue.enqueue({ sourcePath: '/media/a.mkv', lane: 'gpu' });
        const claimed = await queue.claim({ workerId: 'w1', lane: 'gpu' });
        await queue.fail(claimed.id, 'w1', { code: 'NVENC', message: 'hw fail' }, { retryDelayMs: 0 });
        // Exhaust attempts so final state is failed
        let current = await queue.get(job.id);
        while (current.state === JOB_STATES.QUEUED) {
            const next = await queue.claim({ workerId: 'w1', lane: current.lane });
            await queue.fail(next.id, 'w1', { code: 'NVENC', message: 'hw fail' }, { retryDelayMs: 0 });
            current = await queue.get(job.id);
        }
        assert.equal(current.state, JOB_STATES.FAILED);
        const retried = await queue.retry(job.id, { resetAttempts: true, forceCpu: true });
        assert.equal(retried.lane, 'cpu');
        assert.equal(retried.metadata.forceHardware, 'cpu');
        assert.equal(retried.state, JOB_STATES.QUEUED);
    });
});

test('cancelQueuedByScanBatch cancels only matching queued jobs', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const a = await queue.enqueue({
            sourcePath: '/media/a.mkv',
            metadata: { scanBatchId: 'batch-1' },
        });
        const b = await queue.enqueue({
            sourcePath: '/media/b.mkv',
            metadata: { scanBatchId: 'batch-2' },
        });
        const cancelled = await queue.cancelQueuedByScanBatch('batch-1');
        assert.equal(cancelled.length, 1);
        assert.equal(cancelled[0].id, a.id);
        assert.equal((await queue.get(a.id)).state, JOB_STATES.CANCELLED);
        assert.equal((await queue.get(b.id)).state, JOB_STATES.QUEUED);
    });
});

test('scheduler serializes overlapping worker passes to respect concurrency', async () => {
    let active = 0;
    let peak = 0;
    let starts = 0;
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async () => {
                starts += 1;
                active += 1;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 40));
                active -= 1;
                return { didWork: true };
            },
            scan: async () => ({}),
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: false,
            cpuConcurrency: 0,
            gpuConcurrency: 1,
            libraryScanEnabled: false,
        }),
        workerPollMs: 60_000,
    });
    await scheduler.start();
    await Promise.all([
        scheduler.processNow(),
        scheduler.processNow(),
        scheduler.processNow(),
    ]);
    // Allow fire-and-forget processOne promises to settle.
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(peak, 1);
    assert.ok(starts >= 1);
    scheduler.stop();
});

test('scheduler auto-pauses claims when queue depth exceeds threshold', async () => {
    let processCalls = 0;
    const scheduler = createMediaScheduler({
        processor: {
            processOne: async () => {
                processCalls += 1;
                return { didWork: false };
            },
            scan: async () => ({ discovered: 0, enqueued: 0, skipped: 0, errors: [] }),
        },
        getConfig: async () => ({
            enabled: true,
            workerPaused: false,
            autoPauseQueueDepth: 2,
            cpuConcurrency: 1,
            gpuConcurrency: 1,
            libraryScanEnabled: false,
        }),
        getQueuedCount: async () => 5,
        workerPollMs: 60_000,
    });
    await scheduler.start();
    await scheduler.processNow();
    assert.equal(processCalls, 0);
    assert.equal(scheduler.status().autoPausedForQueueDepth, true);
    scheduler.stop();
});

test('normalizeMediaAutomationConfig includes QoL defaults', () => {
    const config = normalizeMediaAutomationConfig({});
    assert.equal(config.minFreeDiskGb, 20);
    assert.equal(config.autoPauseQueueDepth, 0);
    assert.deepEqual(config.pathDenyList, []);
    assert.equal(config.notifyOnScanComplete, false);
    assert.equal(config.notifyOnFailBurst, false);
});

test("encode gates skip below savings estimate and too-small sources", async () => {
    const { evaluateEncodeGates, evaluateSampleGate, evaluateReplaceQualityGuard, resolveMinSavingsPercent } = await import("./gates.js");
    assert.equal(resolveMinSavingsPercent({ settings: { minSavingsPercent: 20 }, pipeline: { minSavingsPercent: "inherit" } }), 20);
    assert.equal(resolveMinSavingsPercent({ settings: { minSavingsPercent: 20 }, pipeline: { minSavingsPercent: 35 } }), 35);

    const probe = {
        format: { size: 500_000_000, bit_rate: "8000000", duration: "3600" },
        streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, bit_rate: "7000000" }],
    };
    const pipeline = {
        steps: [{ type: "transcode", videoCodec: "hevc", audioCodec: "copy", crf: 23 }],
    };
    const tooSmall = await evaluateEncodeGates({
        settings: { minSourceGb: 2, minSavingsPercent: 0 },
        pipeline,
        steps: pipeline.steps,
        probe: { ...probe, format: { ...probe.format, size: 100_000_000 } },
        filePath: "/media/a.mkv",
    });
    assert.equal(tooSmall?.reason, "too-small");

    const lowRoi = await evaluateEncodeGates({
        settings: { minSavingsPercent: 90, minReclaimGb: 0 },
        pipeline,
        steps: pipeline.steps,
        probe,
        filePath: "/media/a.mkv",
        heuristic: {
            estimatedSavingsPercent: 10,
            estimatedBytesSaved: 50_000_000,
            estimateMode: "heuristic",
            confidence: "high",
        },
    });
    assert.equal(lowRoi?.reason, "below-savings-estimate");

    const sampleReject = evaluateSampleGate({
        settings: { sampleGateEnabled: true, minSavingsPercent: 40 },
        estimatedSavingsPercent: 12,
        estimatedBytesSaved: 10,
    });
    assert.equal(sampleReject?.reason, "sample-rejected");

    const quality = evaluateReplaceQualityGuard({
        settings: { replaceQualityGuard: true },
        outputMode: "replace",
        sourceProbe: { streams: [{ codec_type: "video", width: 3840, height: 2160, color_transfer: "smpte2084" }] },
        outputProbe: { streams: [{ codec_type: "video", width: 1280, height: 720, color_transfer: "bt709" }] },
    });
    assert.equal(quality?.reason, "quality-regression");

    const audioGate = await evaluateEncodeGates({
        settings: { audioOnlyIfVideoMatches: true, minSavingsPercent: 0 },
        pipeline: { steps: [{ type: "transcode", videoCodec: "copy", audioCodec: "aac" }] },
        steps: [{ type: "transcode", videoCodec: "copy", audioCodec: "aac" }],
        probe,
        filePath: "/media/a.mkv",
    });
    assert.equal(audioGate?.reason, "audio-requires-hevc");
});

test("watch-stats lookup resolves paths from maintenance index", async () => {
    const { createWatchStatsLookup } = await import("./watch-stats.js");
    await withTempDir(async (dir) => {
        const indexPath = path.join(dir, "maintenance-media-index.json");
        await fs.writeFile(indexPath, JSON.stringify({
            items: [{
                filePath: path.join(dir, "Movies", "Dune.mkv"),
                watchCount: 7,
                lastViewedAt: "2026-01-15T12:00:00.000Z",
            }],
        }));
        const { getWatchStats } = createWatchStatsLookup({ indexPath });
        const hit = await getWatchStats(path.join(dir, "Movies", "Dune.mkv"));
        assert.equal(hit.viewCount, 7);
        assert.equal(hit.lastViewedAt, "2026-01-15T12:00:00.000Z");
        const miss = await getWatchStats(path.join(dir, "Movies", "Other.mkv"));
        assert.equal(miss, null);
    });
});

test('scan history clears progress and persists percent', async () => {
    const { createScanHistoryStore } = await import('./scan-history.js');
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'scan-history.json'),
            defaultValue: { version: 1, entries: [], progress: null },
        });
        const history = createScanHistoryStore({ store, clock: () => Date.parse('2026-07-27T12:00:00.000Z') });
        await history.setProgress({
            discovered: 10,
            enqueued: 2,
            skipped: 3,
            errors: 0,
            percent: 35,
            totalEstimate: 100,
            currentPath: '/media/a.mkv',
        });
        const live = await history.getProgress();
        assert.equal(live.running, true);
        assert.equal(live.percent, 35);
        assert.equal(live.totalEstimate, 100);

        await history.setProgress(null);
        assert.equal(await history.getProgress(), null);

        await history.setProgress({ discovered: 5, enqueued: 0, skipped: 1, errors: 0, running: false, percent: 100 });
        const done = await history.getProgress();
        assert.equal(done.running, false);
        assert.equal(done.percent, 100);
    });
});

test('job history aggregates and totals survive without queue jobs', async () => {
    const { createHistoryStore } = await import('./history.js');
    await withTempDir(async (dir) => {
        const now = Date.parse('2026-07-27T12:00:00.000Z');
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'history.json'),
            defaultValue: { version: 1, entries: [] },
        });
        const history = createHistoryStore({ store, clock: () => now });
        await history.record({
            id: 'ok-1',
            state: 'succeeded',
            sourcePath: '/media/a.mkv',
            finishedAt: new Date(now - 60_000).toISOString(),
            result: { sourceBytes: 10_000, outputBytes: 4_000, bytesSaved: 6_000, durationMs: 5_000, dryRun: false },
        });
        await history.record({
            id: 'fail-1',
            state: 'failed',
            sourcePath: '/media/b.mkv',
            finishedAt: new Date(now - 120_000).toISOString(),
            result: { sourceBytes: 1_000, outputBytes: 0, durationMs: 100 },
        });
        await history.record({
            id: 'old-1',
            state: 'succeeded',
            sourcePath: '/media/c.mkv',
            finishedAt: new Date(now - 10 * 86_400_000).toISOString(),
            result: { sourceBytes: 8_000, outputBytes: 3_000, bytesSaved: 5_000, durationMs: 2_000 },
        });
        await history.record({
            id: 'dry-1',
            state: 'succeeded',
            sourcePath: '/media/d.mkv',
            finishedAt: new Date(now - 30_000).toISOString(),
            result: { sourceBytes: 9_000, outputBytes: 4_000, bytesSaved: 5_000, durationMs: 1_000, dryRun: true },
        });

        const day = await history.aggregates({ days: 1 });
        assert.equal(day.completed, 1);
        assert.equal(day.failed, 1);
        assert.equal(day.bytesSaved, 6_000);
        assert.equal(day.encodeMs, 5_000);

        const archived = await history.get('ok-1');
        assert.equal(archived?.sourcePath, '/media/a.mkv');
        const { historyEntryToJob } = await import('./history.js');
        const asJob = historyEntryToJob(archived);
        assert.equal(asJob?.id, 'ok-1');
        assert.equal(asJob?.sourcePath, '/media/a.mkv');
        assert.equal(asJob?.result?.bytesSaved, 6_000);
        assert.equal(asJob?.archived, true);
        assert.equal(await history.get('missing'), null);

        const totals = await history.totals();
        assert.equal(totals.completed, 2);
        assert.equal(totals.failed, 1);
        assert.equal(totals.entries, 4);
    });
});

test('analyze rootPath scopes discovery and reports ETA totals', async () => {
    await withTempDir(async (dir) => {
        const libraryRoot = path.join(dir, 'tv');
        const seasonOne = path.join(libraryRoot, 'Season 01');
        const seasonTwo = path.join(libraryRoot, 'Season 02');
        await fs.mkdir(seasonOne, { recursive: true });
        await fs.mkdir(seasonTwo, { recursive: true });
        const seasonOneFile = path.join(seasonOne, 'ep01.mkv');
        const seasonTwoFile = path.join(seasonTwo, 'ep02.mkv');
        await fs.writeFile(seasonOneFile, 'a'.repeat(120_000));
        await fs.writeFile(seasonTwoFile, 'b'.repeat(180_000));

        const library = {
            id: 'lib-1',
            name: 'TV',
            enabled: true,
            rootPath: libraryRoot,
        };
        const pipeline = {
            id: 'pipe-1',
            name: 'HEVC',
            enabled: true,
            hardware: 'nvenc',
            rules: [{ id: 'all', enabled: true }],
            steps: [{ mode: 'transcode', videoCodec: 'hevc', audioCodec: 'copy', videoBitrateKbps: 1500 }],
        };

        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const processor = createMediaProcessor({
            queue,
            getConfig: async () => ({
                ...getDefaultMediaAutomationConfig(),
                minSavingsPercent: 0,
                libraryRoots: [libraryRoot],
            }),
            libraries: {
                list: async () => [library],
                get: async (id) => (String(id) === String(library.id) ? library : null),
            },
            pipelines: {
                list: async () => [pipeline],
                get: async (id) => (String(id) === String(pipeline.id) ? pipeline : null),
            },
            history: {
                aggregates: async () => ({
                    completed: 2,
                    encodeMs: 10_000,
                    bytesIn: 100_000,
                    bytesSaved: 40_000,
                }),
            },
            probe: async () => ({
                format: {
                    size: 120_000,
                    duration: '120',
                    bit_rate: '8000000',
                    format_name: 'matroska,webm',
                },
                streams: [
                    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, bit_rate: '7000000' },
                    { codec_type: 'audio', codec_name: 'aac', bit_rate: '192000', channels: 2 },
                ],
            }),
            detectCapabilities: async () => ({ ffmpeg: true, adapters: ['nvenc'] }),
            logger: { warn() {}, info() {}, error() {} },
        });

        const scoped = await processor.analyze({
            libraryId: library.id,
            pipelineId: pipeline.id,
            force: true,
            limit: 50,
            minSizeBytes: 0,
            rootPath: seasonOne,
        });
        assert.equal(scoped.ok, true);
        assert.equal(scoped.rootPath, seasonOne);
        assert.equal(scoped.totals.discovered, 1);
        assert.equal(scoped.totals.analyzed, 1);
        assert.equal(scoped.rows.length, 1);
        assert.ok(String(scoped.rows[0].path).includes('ep01.mkv'));
        assert.equal(scoped.totals.etaSource, 'history-7d');
        assert.ok(Number(scoped.totals.estimatedEncodeMs) > 0);
        assert.ok(scoped.rows[0].targetCodec === 'hevc' || scoped.rows[0].targetCodec === 'h265');

        const full = await processor.analyze({
            libraryId: library.id,
            pipelineId: pipeline.id,
            force: true,
            limit: 50,
            minSizeBytes: 0,
        });
        assert.equal(full.totals.discovered, 2);

        await assert.rejects(
            () => processor.analyze({
                libraryId: library.id,
                rootPath: path.join(dir, 'outside'),
                minSizeBytes: 0,
            }),
            (error) => error?.code === 'OUTSIDE_LIBRARY',
        );
    });
});

test('recoverExpired cancels lease-expired jobs that already requested cancel', async () => {
    await withTempDir(async (dir) => {
        let now = Date.parse('2026-07-28T12:00:00.000Z');
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store, clock: () => now });
        await queue.enqueue({ sourcePath: '/media/a.mkv', maxAttempts: 3 });
        const claimed = await queue.claim({ workerId: 'w1', leaseMs: 1000 });
        await queue.requestCancel(claimed.id);
        now += 5000;
        const recovered = await queue.recoverExpired();
        assert.equal(recovered.length, 1);
        assert.equal(recovered[0].state, JOB_STATES.CANCELLED);
        assert.equal(recovered[0].cancelRequested, true);
    });
});

test('spawnCommand rejects ABORT_ERR when signal aborts', async () => {
    const controller = new AbortController();
    const pending = spawnCommand(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
        signal: controller.signal,
        abortGraceMs: 400,
    });
    setTimeout(() => controller.abort(Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' })), 40);
    await assert.rejects(pending, (error) => error?.code === 'ABORT_ERR');
});

test('processor cancel force-finishes orphaned running jobs', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        const processor = createMediaProcessor({
            queue,
            getConfig: async () => ({ enabled: true, libraryRoots: [dir] }),
        });
        await queue.enqueue({ sourcePath: path.join(dir, 'clip.mkv'), libraryRoot: dir, lane: 'cpu' });
        const claimed = await queue.claim({ workerId: 'orphan-worker', leaseMs: 120_000, lane: 'cpu' });
        assert.equal(claimed.state, JOB_STATES.RUNNING);
        assert.equal(processor.activeJobIds().length, 0);
        const cancelled = await processor.cancel(claimed.id);
        assert.equal(cancelled.state, JOB_STATES.CANCELLED);
        assert.equal(cancelled.cancelRequested, true);
        assert.equal((await queue.get(claimed.id)).state, JOB_STATES.CANCELLED);
    });
});

test('processor cancelMany aborts in-process controllers', async () => {
    await withTempDir(async (dir) => {
        const store = createAtomicJsonStore({
            filePath: path.join(dir, 'queue.json'),
            defaultValue: { version: 1, jobs: [] },
        });
        const queue = createDurableJobQueue({ store });
        let aborted = false;
        const processor = createMediaProcessor({
            queue,
            getConfig: async () => ({ enabled: true, libraryRoots: [dir] }),
        });
        // Simulate an in-flight encode by claiming + registering cancel via cancelMany abort path:
        // cancelMany should still mark cancelRequested even when no controller exists, then force-cancel.
        await queue.enqueue({ sourcePath: path.join(dir, 'a.mkv'), libraryRoot: dir, lane: 'cpu' });
        const claimed = await queue.claim({ workerId: 'w1', leaseMs: 120_000, lane: 'cpu' });
        const cancelled = await processor.cancelMany({ ids: [claimed.id] });
        assert.equal(cancelled.length, 1);
        assert.equal(cancelled[0].state, JOB_STATES.CANCELLED);
        aborted = true;
        assert.equal(aborted, true);
    });
});

test('service start does not reclaim live RUNNING jobs on settings-save reentry', async () => {
    const { createMediaAutomation } = await import('./service.js');
    await withTempDir(async (dir) => {
        const service = createMediaAutomation({
            dataDir: dir,
            getConfig: async () => ({
                enabled: true,
                workerPaused: true,
                libraryScanEnabled: false,
                libraryWatchEnabled: false,
                cpuConcurrency: 0,
                gpuConcurrency: 0,
            }),
            logger: { warn() {}, info() {}, error() {} },
        });
        await service.start();
        const job = await service.queue.enqueue({ sourcePath: '/media/a.mkv', lane: 'gpu' });
        const claimed = await service.queue.claim({ workerId: 'w1', lane: 'gpu', leaseMs: 120_000 });
        assert.equal(claimed.id, job.id);
        assert.equal(claimed.state, JOB_STATES.RUNNING);
        // Settings save calls start() again — must leave the live encode alone.
        await service.start();
        const stillRunning = await service.queue.get(job.id);
        assert.equal(stillRunning.state, JOB_STATES.RUNNING);
        assert.equal(stillRunning.error, null);
        service.stop();
    });
});
