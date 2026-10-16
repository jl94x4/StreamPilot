import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { normalizeMediaAutomationConfig, resolveLaneConcurrencyLimit } from './config.js';
import { buildRuleContext, findMatchingRule, matchMediaRule } from './rules.js';
import { discoverMediaFiles, listMediaFiles, resolveContainedPath, isPathContained } from './files.js';
import { probeMedia } from './ffprobe.js';
import { buildAnalyzeRow, findTranscodeStep } from './analyze.js';
import { detectHdr, shouldSkipForHdr } from './hdr.js';
import {
    evaluateEncodeGates,
    evaluateSampleGate,
    evaluateReplaceQualityGuard,
    collectSeasonStats,
    resolveMinSavingsPercent,
    resolveEffectiveMinSavingsPercent,
} from './gates.js';
import { detectFfmpegCapabilities, selectMediaAdapter } from './adapters.js';
import {
    captureSourceFileMetadata,
    prepareMediaOutput,
    verifyMediaOutput,
    finalizeMediaOutput,
    discardMediaOutput,
    mediaDuration,
} from './output.js';
import { BUILTIN_PLUGIN_IDS, createMediaPluginRegistry } from './plugins.js';
import { buildStepPlan, executeStepPlan } from './steps.js';
import { spawnCommand } from './spawn.js';
import { JOB_PHASES, buildJobDedupeKey, fingerprintSourceFile } from './models.js';
import { deliverCompletedMedia } from './delivery.js';
import { buildNamingContext } from './naming.js';
import { assertMinFreeDisk, isPathDenied } from './path-policy.js';
import { buildCompletedJobMessage } from './mediaTitleFromPath.js';

const resolveOutputBytes = async (knownBytes, ...candidates) => {
    const known = Number(knownBytes) || 0;
    if (known > 0) return known;
    for (const candidate of candidates) {
        const filePath = String(candidate || '').trim();
        if (!filePath) continue;
        const size = await fs.stat(filePath).then((stats) => Number(stats.size) || 0).catch(() => 0);
        if (size > 0) return size;
    }
    return 0;
};

const planCommandText = (plan) => {
    if (!plan) return '';
    if (plan.kind === 'move') return `move ${plan.inputPath} -> ${plan.outputPath}`;
    const executable = plan.executable || 'ffmpeg';
    const args = Array.isArray(plan.args) ? plan.args.map(String) : [];
    return [executable, ...args].join(' ');
};

const FFMPEG_STEP_MODES = new Set([
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
]);

const errorWithCode = (message, code) => Object.assign(new Error(message), { code });

const normalizeTags = (value) => [...new Set(
    (Array.isArray(value) ? value : String(value || '').split(/[,\s]+/))
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter((entry) => entry && entry.length <= 40)
        .slice(0, 24),
)];

const parseEpisodeHint = (filePath = '') => {
    const base = path.basename(String(filePath || ''));
    const match = /[Ss](\d{1,2})[Ee](\d{1,3})/.exec(base)
        || /(\d{1,2})x(\d{1,3})/.exec(base);
    if (!match) return { seasonNumber: null, episodeNumber: null };
    return {
        seasonNumber: Number(match[1]),
        episodeNumber: Number(match[2]),
    };
};

export const createMediaProcessor = ({
    queue,
    getConfig,
    probe = probeMedia,
    detectCapabilities = detectFfmpegCapabilities,
    runner = spawnCommand,
    libraries,
    pipelines,
    registry = createMediaPluginRegistry(),
    activity,
    scanHistory,
    history,
    resolveDeliveryNaming,
    onMediaCommitted,
    getWatchStats = async () => null,
    workerId = `${process.pid}-${crypto.randomUUID()}`,
    logger = console,
} = {}) => {
    if (!queue || typeof getConfig !== 'function') throw new Error('queue and getConfig are required');
    let capabilitiesPromise = null;
    const activeControllers = new Map();

    const config = async () => normalizeMediaAutomationConfig(await getConfig());
    const getCapabilities = (settings) => {
        if (!capabilitiesPromise) {
            capabilitiesPromise = detectCapabilities({
                ffmpegPath: settings.ffmpegPath,
                vaapiDevice: settings.vaapiDevice,
            }).catch((error) => {
                capabilitiesPromise = null;
                throw error;
            });
        }
        return capabilitiesPromise;
    };
    const recordActivity = async (entry) => {
        try {
            return await activity?.append?.(entry);
        } catch (error) {
            logger.warn?.(`[media-automation] activity write failed: ${error.message}`);
            return null;
        }
    };

    const enqueuePath = async (filePath, {
        libraryId,
        libraryRoot,
        pipelineId,
        pipeline: pipelineOverride,
        ruleId,
        rule: ruleOverride,
        probeResult,
        priority = 0,
        scanBatchId = null,
        planOnly = false,
    } = {}) => {
        const settings = await config();
        if (isPathDenied(filePath, settings.pathDenyList)) {
            return {
                enqueued: false,
                wouldEnqueue: false,
                reason: 'denied-path',
                filePath: String(filePath || ''),
            };
        }
        const library = libraryId == null ? null : await libraries?.get?.(libraryId);
        if (libraryId != null && !library) throw errorWithCode(`Library not found: ${libraryId}`, 'LIBRARY_NOT_FOUND');
        const root = libraryRoot
            || library?.rootPath
            || library?.path
            || settings.libraryRoots.find((entry) => {
            const relative = path.relative(path.resolve(entry), path.resolve(filePath));
            return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        });
        if (!root) throw errorWithCode('File is outside configured library roots', 'OUTSIDE_LIBRARY');
        const safePath = await resolveContainedPath(root, filePath, { allowSymlinks: false });
        if (isPathDenied(safePath, settings.pathDenyList)) {
            return {
                enqueued: false,
                wouldEnqueue: false,
                reason: 'denied-path',
                filePath: safePath,
            };
        }
        const sourceFileMetadata = await captureSourceFileMetadata(safePath);
        const fingerprint = await fingerprintSourceFile(safePath);
        const probePlugin = registry.get(library?.probePluginId || BUILTIN_PLUGIN_IDS.PROBE_FFPROBE);
        if (!probePlugin?.probe) throw errorWithCode('Configured probe plugin is unavailable', 'PROBE_PLUGIN_NOT_FOUND');
        const probeFunction = probePlugin.id === BUILTIN_PLUGIN_IDS.PROBE_FFPROBE ? probe : probePlugin.probe;
        const media = probeResult || await probeFunction(safePath, { ffprobePath: settings.ffprobePath });
        const context = buildRuleContext({ filePath: safePath, libraryRoot: await resolveContainedPath(root, '.', { allowSymlinks: true }), probe: media });
        const pipeline = pipelineOverride || (pipelineId == null ? null : await pipelines?.get?.(pipelineId));
        if (pipelineId != null && !pipeline) throw errorWithCode(`Pipeline not found: ${pipelineId}`, 'PIPELINE_NOT_FOUND');
        const candidateRules = Array.isArray(pipeline?.compiledRules)
            ? pipeline.compiledRules
            : (Array.isArray(pipeline?.rules) ? pipeline.rules : settings.rules);
        const selectedById = ruleId == null
            ? null
            : candidateRules.find((entry) => String(entry.id ?? entry.name) === String(ruleId));
        if (ruleId != null && !selectedById && !ruleOverride) {
            throw errorWithCode(`Rule not found: ${ruleId}`, 'RULE_NOT_FOUND');
        }
        const rule = ruleOverride || selectedById || findMatchingRule(candidateRules, context);
        const hdr = context.hdr || detectHdr(media);
        if (!rule) {
            const videoCodec = String(media?.streams?.find?.((stream) => stream.codec_type === 'video')?.codec_name
                || media?.videoCodec
                || '')
                .toLowerCase();
            const reason = videoCodec && candidateRules.some((entry) => {
                const conditions = entry?.when?.conditions || entry?.conditions || [];
                return conditions.some((condition) => (
                    condition?.field === 'videoCodec'
                    && condition?.operator === 'notEquals'
                    && String(condition?.value || '').toLowerCase() === videoCodec
                ));
            })
                ? 'already-matches-target'
                : 'no-matching-rule';
            return { enqueued: false, wouldEnqueue: false, reason, filePath: safePath, probe: { videoCodec }, hdr };
        }
        const action = rule.then || rule.action || {};
        const selectedPipelineId = pipeline?.id ?? pipelineId ?? rule.pipelineId ?? null;
        const selectedPipeline = pipeline
            || (selectedPipelineId == null ? null : await pipelines?.get?.(selectedPipelineId));
        const pipelineSteps = Array.isArray(selectedPipeline?.steps) && selectedPipeline.steps.length
            ? selectedPipeline.steps
            : [action];
        const hdrSkip = shouldSkipForHdr({
            hdr,
            settings,
            pipeline: selectedPipeline,
            steps: pipelineSteps,
        });
        if (hdrSkip) {
            return {
                enqueued: false,
                wouldEnqueue: false,
                reason: hdrSkip.reason,
                filePath: safePath,
                probe: { videoCodec: context.video?.codec_name || null },
                hdr,
                message: hdrSkip.message,
            };
        }
        let seasonStats = null;
        if (Number(settings.seasonMatchMinPercent) > 0) {
            const targetCodec = findTranscodeStep({ steps: pipelineSteps })?.videoCodec || 'hevc';
            seasonStats = await collectSeasonStats(safePath, {
                extensions: settings.extensions,
                targetCodec,
                probeFn: async (siblingPath) => probeFunction(siblingPath, { ffprobePath: settings.ffprobePath }),
            });
        }
        let watchStats = null;
        if (Number(settings.maxWatchCount) > 0 || Number(settings.skipWatchedWithinDays) > 0) {
            try {
                watchStats = await getWatchStats(safePath);
            } catch {
                watchStats = null;
            }
        }
        const encodeGate = await evaluateEncodeGates({
            settings,
            pipeline: selectedPipeline,
            steps: pipelineSteps,
            probe: media,
            filePath: safePath,
            libraryRoot: root,
            sourceFileMetadata,
            watchStats,
            seasonStats,
        });
        if (encodeGate) {
            return {
                enqueued: false,
                wouldEnqueue: false,
                reason: encodeGate.reason,
                message: encodeGate.message,
                filePath: safePath,
                probe: { videoCodec: context.video?.codec_name || null },
                hdr,
            };
        }
        let hardware = String(
            action.hardwareAcceleration
            || library?.hardware
            || selectedPipeline?.hardware
            || selectedPipeline?.hardwareAcceleration
            || settings.hardwareAcceleration
        );
        const lane = pipelineSteps.some((step) => String(step.type || step.mode) === 'transcode')
            && hardware !== 'cpu'
            ? 'gpu'
            : 'cpu';
        const selectedRuleId = rule.id ?? rule.name ?? ruleId ?? rule._index;
        const dedupeKey = buildJobDedupeKey({
            sourcePath: safePath,
            fingerprint,
            pipelineId: selectedPipelineId,
            ruleId: selectedRuleId,
        });
        const activeJobs = await queue.list();
        const duplicate = activeJobs.find((entry) => {
            if (['succeeded', 'failed', 'cancelled', 'canceled', 'completed'].includes(String(entry.state || ''))) {
                return false;
            }
            if (entry.dedupeKey && entry.dedupeKey === dedupeKey) return true;
            return !!(
                fingerprint
                && entry.fingerprint === fingerprint
                && entry.sourcePath === safePath
                && String(entry.pipelineId || '') === String(selectedPipelineId || '')
            );
        });
        if (duplicate) {
            return {
                enqueued: false,
                wouldEnqueue: false,
                reason: 'already-queued',
                filePath: safePath,
                job: duplicate,
            };
        }
        if (planOnly) {
            return {
                enqueued: false,
                wouldEnqueue: true,
                reason: 'plan-only',
                filePath: safePath,
                pipelineId: selectedPipelineId,
                ruleId: selectedRuleId,
                lane,
                probe: { videoCodec: context.video?.codec_name || null },
            };
        }
        const tags = normalizeTags(library?.tags);
        const job = await queue.enqueue({
            sourcePath: safePath,
            fingerprint,
            libraryRoot: root,
            libraryId: library?.id ?? libraryId,
            pipelineId: selectedPipelineId,
            pipelineName: selectedPipeline?.name || null,
            dedupeKey,
            ruleId: selectedRuleId,
            lane,
            priority: Number(rule.priority ?? 0) + (Number(library?.priorityBoost) || 0) + (Number(priority) || 0),
            maxAttempts: settings.maxAttempts,
            metadata: {
                probe: media,
                hdr,
                rule,
                tags,
                ...(scanBatchId ? { scanBatchId: String(scanBatchId) } : {}),
                pipeline: selectedPipeline
                    ? {
                        ...selectedPipeline,
                        hardware: library?.hardware || selectedPipeline.hardware,
                        outputMode: library?.outputMode || selectedPipeline.outputMode,
                    }
                    : selectedPipeline,
                libraryPolicy: library
                    ? {
                        hardware: library.hardware || null,
                        outputMode: library.outputMode || null,
                        quarantinePath: library.quarantinePath || null,
                        deliveryTargetId: library.deliveryTargetId || null,
                        tags,
                    }
                    : null,
                probePluginId: probePlugin.id,
                sourceFileMetadata,
                fingerprint,
                deliveryTargetId: library?.deliveryTargetId || selectedPipeline?.deliveryTargetId || null,
            },
        });
        await recordActivity({
            type: 'job.enqueued',
            jobId: job.id,
            message: `Queued ${path.basename(safePath)}`,
            data: { lane, pipelineId: selectedPipelineId, ruleId: selectedRuleId, tags, scanBatchId },
        });
        return { enqueued: true, wouldEnqueue: true, job };
    };

    const estimateScanTotals = async (roots, settings, signal) => {
        const deadline = Date.now() + 15_000;
        let total = 0;
        for (const library of roots) {
            if (signal?.aborted) return null;
            const root = library.rootPath || library.path;
            if (!root || library.enabled === false) continue;
            try {
                for await (const _filePath of discoverMediaFiles(root, { extensions: settings.extensions, signal })) {
                    if (signal?.aborted) return null;
                    if (Date.now() > deadline) return null;
                    total += 1;
                }
            } catch (error) {
                if (signal?.aborted || error?.code === 'ABORT_ERR') return null;
                // Ignore listing errors during estimate; the real scan will report them.
            }
        }
        return total;
    };

    const scan = async ({
        signal,
        preview = false,
        planOnly = false,
        libraryId = null,
        scanBatchId = null,
    } = {}) => {
        const settings = await config();
        const dry = preview === true || planOnly === true;
        const batchId = scanBatchId || (dry ? null : crypto.randomUUID());
        const results = {
            discovered: 0,
            enqueued: 0,
            skipped: 0,
            wouldEnqueue: 0,
            wouldSkip: 0,
            errors: [],
            skippedDetails: [],
            sampleSkips: [],
            preview: preview === true,
            planOnly: planOnly === true,
            libraryId: libraryId == null ? null : String(libraryId),
            scanBatchId: batchId,
            totalEstimate: null,
            percent: null,
        };
        const startedAt = new Date().toISOString();
        const publishProgress = async (currentPath = null) => {
            if (signal?.aborted) return;
            try {
                const percent = results.totalEstimate
                    ? Math.min(99, Math.round((results.discovered / results.totalEstimate) * 100))
                    : null;
                results.percent = percent;
                await scanHistory?.setProgress?.({
                    ...results,
                    errors: results.errors.length,
                    currentPath,
                    startedAt,
                    percent,
                    totalEstimate: results.totalEstimate,
                    scanBatchId: batchId,
                });
            } catch {
                // Progress is best-effort.
            }
        };
        await publishProgress();
        const catalogLibraries = await libraries?.list?.() || [];
        let roots = [
            ...settings.libraryRoots.map((rootPath) => ({ rootPath })),
            ...catalogLibraries,
        ];
        if (libraryId != null && libraryId !== '') {
            roots = roots.filter((library) => String(library.id) === String(libraryId));
            if (!roots.length) {
                throw errorWithCode(`Library not found: ${libraryId}`, 'LIBRARY_NOT_FOUND');
            }
        }
        if (!dry) {
            for (const library of roots) {
                const root = library.rootPath || library.path;
                if (!root || library.enabled === false) continue;
                await assertMinFreeDisk(root, settings.minFreeDiskGb);
            }
        }
        results.totalEstimate = await estimateScanTotals(roots, settings, signal);
        await publishProgress();
        const pushSkip = (detail) => {
            results.skipped += 1;
            results.wouldSkip += 1;
            if (results.skippedDetails.length < 50) results.skippedDetails.push(detail);
            if (results.sampleSkips.length < 25) results.sampleSkips.push(detail);
        };
        try {
            for (const library of roots) {
                if (signal?.aborted) {
                    results.cancelled = true;
                    break;
                }
                const root = library.rootPath || library.path;
                if (!root || library.enabled === false) continue;
                try {
                    for await (const filePath of discoverMediaFiles(root, { extensions: settings.extensions, signal })) {
                        if (signal?.aborted) {
                            results.cancelled = true;
                            break;
                        }
                        results.discovered += 1;
                        if (results.discovered === 1 || results.discovered % 10 === 0) {
                            await publishProgress(filePath);
                        }
                        try {
                            const result = await enqueuePath(filePath, {
                                libraryId: library.id,
                                libraryRoot: root,
                                pipelineId: library.pipelineId,
                                scanBatchId: batchId,
                                planOnly: dry,
                            });
                            if (dry) {
                                if (result.wouldEnqueue) results.wouldEnqueue += 1;
                                else pushSkip({
                                    filePath: result.filePath || filePath,
                                    reason: result.reason || 'skipped',
                                    videoCodec: result.probe?.videoCodec || null,
                                });
                            } else if (result.enqueued) {
                                results.enqueued += 1;
                                results.wouldEnqueue += 1;
                            } else {
                                pushSkip({
                                    filePath: result.filePath || filePath,
                                    reason: result.reason || 'skipped',
                                    videoCodec: result.probe?.videoCodec || null,
                                });
                            }
                        } catch (error) {
                            results.errors.push({ filePath, message: error.message, code: error.code });
                        }
                    }
                    if (results.cancelled) break;
                } catch (error) {
                    if (signal?.aborted || error?.code === 'ABORT_ERR' || /abort/i.test(String(error?.message || ''))) {
                        results.cancelled = true;
                        break;
                    }
                    results.errors.push({ root, message: error.message, code: error.code });
                }
            }
        } finally {
            if (signal?.aborted || results.cancelled) {
                try {
                    await scanHistory?.setProgress?.(null);
                } catch {
                    // Best-effort.
                }
            } else {
                if (results.totalEstimate) {
                    results.percent = Math.min(100, Math.round((results.discovered / results.totalEstimate) * 100));
                }
                await publishProgress();
            }
        }
        return results;
    };

    const notifyCommitted = ({ job, sourcePath, outputMode, finalPath, delivery, moved = false }) => {
        if (typeof onMediaCommitted !== 'function') return;
        void Promise.resolve(onMediaCommitted({
            jobId: job.id,
            sourcePath,
            outputMode,
            finalPath: finalPath || null,
            deliveredPath: delivery?.deliveredPath || null,
            deliveryTargetId: delivery?.targetId || null,
            moved,
        })).catch((error) => {
            logger.warn?.(`[media-automation] media committed hook failed: ${error.message}`);
        });
    };

    const maybeDeliver = async ({ job, result, media, settings }) => {
        if (result?.dryRun) return result;
        const finalPath = result?.output?.finalPath;
        if (!finalPath) return result;
        const targetId = job.metadata?.deliveryTargetId
            || job.metadata?.libraryPolicy?.deliveryTargetId
            || null;
        if (!targetId) return result;
        const targets = Array.isArray(settings.deliveryTargets) ? settings.deliveryTargets : [];
        const target = targets.find((entry) => entry.enabled !== false && String(entry.id) === String(targetId));
        if (!target?.path) return result;
        try {
            const episodeHint = parseEpisodeHint(job.sourcePath || finalPath);
            let namingConfig = null;
            let namingContext = buildNamingContext({
                probe: media,
                sourcePath: job.sourcePath || finalPath,
                ...episodeHint,
            });
            if (target.namingMode === 'sonarr-pattern' && typeof resolveDeliveryNaming === 'function') {
                const resolved = await resolveDeliveryNaming({
                    target,
                    sourcePath: job.sourcePath || finalPath,
                    finalPath,
                    probe: media,
                }).catch(() => null);
                if (resolved?.namingConfig) namingConfig = resolved.namingConfig;
                if (resolved?.namingContext) namingContext = { ...namingContext, ...resolved.namingContext };
            }
            const delivery = await deliverCompletedMedia({
                sourcePath: finalPath,
                target,
                probe: media,
                namingContext,
                namingConfig,
            });
            return { ...result, delivery };
        } catch (error) {
            logger.warn?.(`[media-automation] delivery failed: ${error.message}`);
            return {
                ...result,
                delivery: {
                    targetId: target.id,
                    targetName: target.name,
                    error: error.message,
                    failed: true,
                },
            };
        }
    };

    const processOne = async ({ lane, tags, priorityBias = 0, workerGroupId = null } = {}) => {
        const settings = await config();
        await queue.recoverExpired();
        // Hard cap against in-memory slot races (retry while another encode runs, overlapping ticks).
        const maxRunning = resolveLaneConcurrencyLimit(settings, lane || 'gpu');
        const job = await queue.claim({
            workerId,
            leaseMs: settings.leaseMs,
            lane,
            tags,
            priorityBias,
            workerGroupId,
            maxRunning,
        });
        if (!job) return { didWork: false };
        if (settings.minFreeDiskGb > 0 && job.libraryRoot) {
            try {
                await assertMinFreeDisk(job.libraryRoot, settings.minFreeDiskGb);
            } catch (error) {
                if (error?.code === 'DISK_SPACE_LOW') {
                    await queue.fail(job.id, workerId, error, { retryDelayMs: settings.retryDelayMs }).catch(() => {});
                    await recordActivity({
                        type: 'job.failed',
                        jobId: job.id,
                        message: String(error.message || error),
                        data: { code: error.code, sourcePath: job.sourcePath },
                    });
                    return { didWork: true, job, error };
                }
                throw error;
            }
        }
        const controller = new AbortController();
        const jobKey = String(job.id);
        activeControllers.set(jobKey, controller);
        await recordActivity({
            type: 'job.started',
            jobId: job.id,
            message: `Started ${path.basename(job.sourcePath)}`,
            data: { lane: job.lane, attempt: job.attempts, workerGroupId },
        });
        // Poll cancel often — heartbeat alone can wait up to 30s before aborting.
        const cancelPollMs = 1_000;
        const heartbeatEveryMs = Math.min(settings.heartbeatMs, Math.floor(settings.leaseMs / 2));
        let lastHeartbeatAt = 0;
        const heartbeat = setInterval(async () => {
            try {
                const current = await queue.get(job.id);
                if (current?.cancelRequested) {
                    controller.abort(errorWithCode('Job cancelled', 'ABORT_ERR'));
                    return;
                }
                const now = Date.now();
                if (now - lastHeartbeatAt < heartbeatEveryMs) return;
                lastHeartbeatAt = now;
                await queue.heartbeat(job.id, workerId, settings.leaseMs);
            } catch (error) {
                logger.warn?.(`[media-automation] heartbeat failed for ${job.id}: ${error.message}`);
                controller.abort(error);
            }
        }, cancelPollMs);
        heartbeat.unref?.();
        let prepared;
        const intermediatePaths = [];
        try {
            await queue.updateProgress(job.id, workerId, { phase: JOB_PHASES.PROBING });
            const sourcePath = await resolveContainedPath(job.libraryRoot, job.sourcePath, { allowSymlinks: false });
            const sourceFileMetadata = job.metadata?.sourceFileMetadata
                || await captureSourceFileMetadata(sourcePath);
            const probePlugin = registry.get(job.metadata?.probePluginId || BUILTIN_PLUGIN_IDS.PROBE_FFPROBE);
            const probeFunction = probePlugin?.id === BUILTIN_PLUGIN_IDS.PROBE_FFPROBE ? probe : probePlugin?.probe;
            if (!probeFunction) throw errorWithCode('Configured probe plugin is unavailable', 'PROBE_PLUGIN_NOT_FOUND');
            const media = job.metadata?.probe || await probeFunction(sourcePath, {
                ffprobePath: settings.ffprobePath,
                signal: controller.signal,
            });
            const context = buildRuleContext({ filePath: sourcePath, libraryRoot: job.libraryRoot, probe: media });
            const rule = job.metadata?.rule || findMatchingRule(settings.rules, context);
            if (!rule) throw errorWithCode('Job no longer matches a rule', 'RULE_NOT_FOUND');
            await queue.updateProgress(job.id, workerId, { phase: JOB_PHASES.PLANNING });
            const action = rule.then || rule.action || {};
            const jobPipeline = job.metadata?.pipeline
                || (job.pipelineId == null ? null : await pipelines?.get?.(job.pipelineId));
            const jobLibrary = job.libraryId == null ? null : await libraries?.get?.(job.libraryId);
            const libraryHardware = String(jobLibrary?.hardware || job.metadata?.libraryPolicy?.hardware || '').toLowerCase();
            const libraryOutputMode = String(jobLibrary?.outputMode || job.metadata?.libraryPolicy?.outputMode || '').toLowerCase();
            const configuredSteps = Array.isArray(jobPipeline?.steps) && jobPipeline.steps.length
                ? jobPipeline.steps
                : [action];
            const hdr = job.metadata?.hdr || context.hdr || detectHdr(media);
            const hdrSkip = shouldSkipForHdr({
                hdr,
                settings,
                pipeline: jobPipeline,
                steps: configuredSteps,
            });
            if (hdrSkip) {
                const result = {
                    skipped: hdrSkip.reason,
                    hdr,
                    message: hdrSkip.message,
                };
                await queue.complete(job.id, workerId, result);
                await recordActivity({
                    type: 'job.skipped',
                    jobId: job.id,
                    message: hdrSkip.message,
                    data: { reason: hdrSkip.reason, hdrKind: hdr.kind },
                });
                return { didWork: true, job, result };
            }
            let seasonStats = null;
            if (Number(settings.seasonMatchMinPercent) > 0) {
                const targetCodec = findTranscodeStep({ steps: configuredSteps })?.videoCodec || 'hevc';
                seasonStats = await collectSeasonStats(sourcePath, {
                    extensions: settings.extensions,
                    targetCodec,
                    probeFn: async (siblingPath) => probeFunction(siblingPath, {
                        ffprobePath: settings.ffprobePath,
                        signal: controller.signal,
                    }),
                });
            }
            let watchStats = null;
            if (Number(settings.maxWatchCount) > 0 || Number(settings.skipWatchedWithinDays) > 0) {
                try {
                    watchStats = await getWatchStats(sourcePath);
                } catch {
                    watchStats = null;
                }
            }
            const encodeGate = await evaluateEncodeGates({
                settings,
                pipeline: jobPipeline,
                steps: configuredSteps,
                probe: media,
                filePath: sourcePath,
                libraryRoot: job.libraryRoot,
                sourceFileMetadata,
                watchStats,
                seasonStats,
            });
            if (encodeGate) {
                const result = {
                    skipped: encodeGate.reason,
                    message: encodeGate.message,
                    data: encodeGate.data || null,
                };
                await queue.complete(job.id, workerId, result);
                await recordActivity({
                    type: 'job.skipped',
                    jobId: job.id,
                    message: encodeGate.message,
                    data: { reason: encodeGate.reason, ...(encodeGate.data || {}) },
                });
                return { didWork: true, job, result };
            }
            const forceHardware = String(job.metadata?.forceHardware || '').toLowerCase() === 'cpu'
                ? 'cpu'
                : null;
            const steps = configuredSteps.map((step) => ({
                ...action,
                ...step,
                mode: String(step.mode || step.type || action.mode || 'remux').toLowerCase(),
                hardwareAcceleration: forceHardware
                    || step.hardwareAcceleration
                    || (['auto', 'cpu', 'nvenc', 'qsv', 'intel-vaapi', 'vaapi'].includes(libraryHardware) ? libraryHardware : null)
                    || jobPipeline?.hardware
                    || action.hardwareAcceleration
                    || settings.hardwareAcceleration,
            }));
            const finalStep = steps[steps.length - 1];
            // Pipeline UI is authoritative. Global Safe fallback (settings.outputMode/dryRun) can still force dry-run.
            // Per-library outputMode overrides pipeline when set.
            const pipelineOutputMode = String(jobPipeline?.outputMode || '').toLowerCase();
            const actionOutputMode = String(action.outputMode || '').toLowerCase();
            const settingsOutputMode = String(settings.outputMode || 'dry-run').toLowerCase();
            const libraryForcesMode = ['copy', 'replace', 'dry-run'].includes(libraryOutputMode)
                ? libraryOutputMode
                : null;
            const requestedOutputMode = libraryForcesMode
                || (['copy', 'replace', 'dry-run'].includes(pipelineOutputMode)
                    ? pipelineOutputMode
                    : (['copy', 'replace', 'dry-run'].includes(actionOutputMode)
                        ? actionOutputMode
                        : settingsOutputMode));
            const globalForcesDryRun = !!(settings.dryRun || settingsOutputMode === 'dry-run');
            const outputMode = globalForcesDryRun || requestedOutputMode === 'dry-run'
                ? 'dry-run'
                : (['copy', 'replace'].includes(requestedOutputMode) ? requestedOutputMode : 'dry-run');
            const dryRunReason = outputMode !== 'dry-run'
                ? null
                : (globalForcesDryRun
                    ? 'global-safe-fallback'
                    : (requestedOutputMode === 'dry-run' ? 'pipeline-output-mode' : 'default'));
            const outputExtension = action.outputExtension
                || (finalStep.container ? `.${finalStep.container}` : settings.outputExtension);
            const sourceRelativePath = path.relative(job.libraryRoot, sourcePath);
            const copyDestination = action.copyDestination
                || (outputMode === 'copy' && jobLibrary?.outputPath
                    ? path.join(
                        jobLibrary.outputPath,
                        path.dirname(sourceRelativePath),
                        `${path.parse(sourceRelativePath).name}${outputExtension}`,
                    )
                    : '');
            const replaceWorkDir = outputMode === 'replace' && String(jobLibrary?.outputPath || '').trim()
                ? String(jobLibrary.outputPath).trim()
                : '';
            prepared = prepareMediaOutput({
                sourcePath,
                mode: outputMode,
                extension: outputExtension,
                copyDestination,
                workDir: replaceWorkDir,
            });
            if (!settings.dryRun && outputMode !== 'dry-run') {
                await fs.mkdir(path.dirname(prepared.workPath), { recursive: true });
            }
            let capabilities = {};
            const needsCapabilities = steps.some((step) => (
                step.mode === 'transcode' && String(step.videoCodec || '').toLowerCase() !== 'copy'
            ));
            if (needsCapabilities) {
                capabilities = await getCapabilities(settings);
            }
            const libraryList = typeof libraries?.list === 'function' ? await libraries.list() : [];
            const libraryRoots = [
                ...new Set(
                    (Array.isArray(libraryList) ? libraryList : [])
                        .map((entry) => entry?.rootPath || entry?.path)
                        .filter(Boolean)
                        .map((root) => path.resolve(root)),
                ),
            ];
            if (job.libraryRoot) libraryRoots.unshift(path.resolve(job.libraryRoot));
            const plans = [];
            let currentInput = sourcePath;
            let hardwareFallback = null;
            let selectedAdapterName = null;
            let selectedAdapterLabel = null;
            for (let index = 0; index < steps.length; index += 1) {
                const step = steps[index];
                const mode = String(step.mode || step.type || 'remux').toLowerCase();
                const transcode = mode === 'transcode';
                const logicalCodec = String(step.videoCodec || 'h264').toLowerCase();
                let adapter;
                if (FFMPEG_STEP_MODES.has(mode)) {
                    try {
                        adapter = !transcode || logicalCodec === 'copy'
                            ? selectMediaAdapter('cpu')
                            : selectMediaAdapter(
                                step.hardwareAcceleration,
                                capabilities,
                                logicalCodec,
                            );
                    } catch (error) {
                        if (!transcode || logicalCodec === 'copy' || !settings.allowCpuFallback || step.hardwareAcceleration === 'cpu') throw error;
                        adapter = selectMediaAdapter('cpu', capabilities, logicalCodec);
                        hardwareFallback = {
                            requested: String(step.hardwareAcceleration || 'auto'),
                            reason: String(error.message || 'adapter unavailable'),
                            step: index + 1,
                        };
                        await recordActivity({
                            type: 'job.hardware-fallback',
                            jobId: job.id,
                            message: `Fell back to CPU for step ${index + 1}: ${error.message}`,
                            data: { requested: step.hardwareAcceleration, step: index + 1 },
                        });
                    }
                    if (adapter && (!selectedAdapterName || (transcode && logicalCodec !== 'copy'))) {
                        selectedAdapterName = adapter.name;
                        selectedAdapterLabel = adapter.label;
                    }
                }
                let outputPath = '';
                if (mode === 'move') {
                    outputPath = '';
                } else if (mode === 'subtitle-extract') {
                    outputPath = path.join(path.dirname(currentInput), `${path.parse(currentInput).name}.srt`);
                } else if (mode === 'custom-command') {
                    outputPath = index === steps.length - 1 ? (prepared.workPath || '') : '';
                } else if (index === steps.length - 1) {
                    outputPath = prepared.workPath;
                } else {
                    outputPath = path.join(
                        path.dirname(prepared.workPath),
                        `.${path.parse(prepared.workPath).name}.${job.id}.step-${index + 1}.${step.container || 'mkv'}`,
                    );
                }
                if (outputPath && index < steps.length - 1 && mode !== 'subtitle-extract' && mode !== 'move') {
                    intermediatePaths.push(outputPath);
                }
                const plan = buildStepPlan({
                    step: { ...step, mode },
                    inputPath: currentInput,
                    outputPath,
                    libraryRoot: job.libraryRoot,
                    adapter,
                    capabilities,
                    vaapiDevice: settings.vaapiDevice,
                    allowlist: settings.customCommandAllowlist,
                    probe: media,
                    hdr,
                    hdrSettings: settings,
                    pipeline: jobPipeline,
                    namingContext: buildNamingContext({
                        probe: media,
                        sourcePath,
                        ...parseEpisodeHint(sourcePath),
                    }),
                });
                plans.push(plan);
                if (!(plan.skipMediaFinalize && plan.stepType === 'subtitle-extract')) {
                    currentInput = plan.outputPath || currentInput;
                }
            }
            await queue.updateProgress(job.id, workerId, {
                phase: JOB_PHASES.PLANNED,
                plan: plans,
                progress: {
                    stepCount: plans.length,
                    command: planCommandText(plans[0]),
                    adapter: selectedAdapterName || plans[0]?.adapter || null,
                    adapterLabel: selectedAdapterLabel || plans[0]?.adapterLabel || null,
                    hardwareFallback: !!hardwareFallback,
                    requestedHardware: hardwareFallback?.requested
                        || String(steps[0]?.hardwareAcceleration || jobPipeline?.hardware || settings.hardwareAcceleration || ''),
                },
            });
            if (outputMode === 'dry-run') {
                const sourceBytes = Number(sourceFileMetadata?.size || media?.format?.size || 0) || 0;
                const result = {
                    dryRun: true,
                    outputMode,
                    dryRunReason,
                    requestedOutputMode,
                    adapter: selectedAdapterName || plans[0]?.adapter || null,
                    adapterLabel: selectedAdapterLabel || plans[0]?.adapterLabel || null,
                    hardwareFallback,
                    plans,
                    sourceBytes,
                    outputBytes: 0,
                    bytesSaved: 0,
                    durationMs: Math.max(0, Date.now() - Date.parse(job.startedAt || job.createdAt || Date.now())),
                };
                await queue.complete(job.id, workerId, result);
                await recordActivity({
                    type: 'job.completed',
                    jobId: job.id,
                    message: dryRunReason === 'global-safe-fallback'
                        ? `Dry-run planned ${path.basename(sourcePath)} (global Safe fallback is Dry run)`
                        : `Dry-run planned ${path.basename(sourcePath)} (pipeline output mode is Dry run)`,
                    data: { dryRun: true, dryRunReason, requestedOutputMode, sourcePath },
                });
                return { didWork: true, job, result };
            }
            const hasVideoTranscode = steps.some((step) => (
                String(step.mode) === 'transcode'
                && String(step.videoCodec || 'h264').toLowerCase() !== 'copy'
            ));
            const sampleMinBytes = Math.round(Number(settings.sampleGateMinSizeGb || 0) * 1024 ** 3);
            const gateSourceBytes = Number(sourceFileMetadata?.size || media?.format?.size || 0) || 0;
            const effectiveMinSavings = await resolveEffectiveMinSavingsPercent({
                settings,
                pipeline: jobPipeline,
                libraryRoot: job.libraryRoot,
            });
            if (settings.sampleGateEnabled === true
                && hasVideoTranscode
                && gateSourceBytes >= sampleMinBytes
                && (effectiveMinSavings > 0 || Number(settings.minReclaimGb) > 0)) {
                const sampleResult = await estimate({
                    filePath: sourcePath,
                    pipelineId: job.pipelineId,
                    libraryId: job.libraryId ?? null,
                    libraryRoot: job.libraryRoot ?? null,
                    signal: controller.signal,
                });
                const sampleGate = evaluateSampleGate({
                    settings,
                    pipeline: jobPipeline,
                    estimatedSavingsPercent: sampleResult.estimatedSavingsPercent,
                    estimatedBytesSaved: sampleResult.estimatedBytesSaved,
                    effectiveMinSavingsPercent: effectiveMinSavings,
                });
                if (sampleGate) {
                    await discardMediaOutput(prepared);
                    for (const intermediate of intermediatePaths) {
                        await fs.rm(intermediate, { force: true }).catch(() => {});
                    }
                    intermediatePaths.length = 0;
                    const result = {
                        skipped: sampleGate.reason,
                        message: sampleGate.message,
                        outputMode,
                        sample: sampleResult,
                        data: sampleGate.data || null,
                    };
                    await queue.complete(job.id, workerId, result);
                    await recordActivity({
                        type: 'job.skipped',
                        jobId: job.id,
                        message: sampleGate.message,
                        data: { reason: sampleGate.reason, ...(sampleGate.data || {}) },
                    });
                    return { didWork: true, job, result };
                }
            }
            const executions = [];
            for (let index = 0; index < plans.length; index += 1) {
                const plan = plans[index];
                const commandText = planCommandText(plan);
                await queue.updateProgress(job.id, workerId, {
                    phase: JOB_PHASES.PROCESSING,
                    plan: plans,
                    progress: {
                        step: index + 1,
                        stepCount: plans.length,
                        command: commandText,
                        currentCommand: commandText,
                        adapter: plan.adapter || selectedAdapterName || null,
                        adapterLabel: plan.adapterLabel || selectedAdapterLabel || null,
                        hardwareFallback: !!hardwareFallback,
                        requestedHardware: hardwareFallback?.requested
                            || String(steps[0]?.hardwareAcceleration || jobPipeline?.hardware || settings.hardwareAcceleration || ''),
                    },
                });
                let progressWrite = Promise.resolve();
                let lastProgressWrite = 0;
                const durationSeconds = mediaDuration(media);
                const execution = await executeStepPlan(plan, {
                    signal: controller.signal,
                    timeoutMs: settings.jobTimeoutMs,
                    ffmpegPath: settings.ffmpegPath,
                    ffprobePath: settings.ffprobePath,
                    durationSeconds,
                    libraryRoots,
                    runner,
                    onProgress: (progress) => {
                        const now = Date.now();
                        if (!progress.complete && now - lastProgressWrite < 1000) return;
                        lastProgressWrite = now;
                        const stepFraction = progress.percent == null
                            ? null
                            : Number(progress.percent) / 100;
                        const totalPercent = stepFraction == null
                            ? null
                            : ((index + stepFraction) / plans.length) * 100;
                        progressWrite = progressWrite
                            .then(() => queue.updateProgress(job.id, workerId, {
                                phase: progress.complete && index === plans.length - 1
                                    ? JOB_PHASES.VERIFYING
                                    : JOB_PHASES.PROCESSING,
                                progress: {
                                    ...(totalPercent == null
                                        ? {}
                                        : { percent: Math.min(100, Math.max(0, totalPercent)) }),
                                    outTimeUs: progress.outTimeUs,
                                    etaSeconds: progress.etaSeconds,
                                    speed: progress.speed,
                                    fps: progress.fps,
                                    durationSeconds: progress.durationSeconds ?? durationSeconds,
                                    step: index + 1,
                                    stepCount: plans.length,
                                    command: commandText,
                                    currentCommand: commandText,
                                },
                            }))
                            .catch((error) => controller.abort(error));
                    },
                });
                await progressWrite;
                executions.push(execution);
                if (index > 0 && FFMPEG_STEP_MODES.has(plans[index].stepType || plans[index].mode)) {
                    const consumedIntermediate = plans[index].inputPath;
                    if (consumedIntermediate && consumedIntermediate !== sourcePath) {
                        await fs.rm(consumedIntermediate, { force: true }).catch(() => {});
                        const consumedIndex = intermediatePaths.indexOf(consumedIntermediate);
                        if (consumedIndex >= 0) intermediatePaths.splice(consumedIndex, 1);
                    }
                }
            }
            const finalPlan = plans[plans.length - 1];
            const skipFinalize = finalPlan?.kind === 'move' || !!finalPlan?.skipMediaFinalize;
            if (skipFinalize) {
                const finalPath = executions[executions.length - 1]?.outputPath || finalPlan.outputPath || sourcePath;
                const sourceBytes = Number(sourceFileMetadata?.size || media?.format?.size || 0) || 0;
                const durationMs = executions.reduce((sum, entry) => sum + (Number(entry.durationMs) || 0), 0)
                    || Math.max(0, Date.now() - Date.parse(job.startedAt || job.createdAt || Date.now()));
                let result = {
                    plans,
                    executions,
                    output: { finalPath, skippedFinalize: true },
                    sourceBytes,
                    outputBytes: sourceBytes,
                    bytesSaved: 0,
                    durationMs,
                    adapter: selectedAdapterName || finalPlan?.adapter || null,
                    adapterLabel: selectedAdapterLabel || finalPlan?.adapterLabel || null,
                    hardwareFallback,
                };
                result = await maybeDeliver({ job, result, media, settings });
                const completedBytes = await resolveOutputBytes(
                    result.outputBytes,
                    result.delivery?.deliveredPath,
                    finalPath,
                );
                if (completedBytes > 0) result = { ...result, outputBytes: completedBytes };
                await queue.complete(job.id, workerId, result);
                await recordActivity({
                    type: 'job.completed',
                    jobId: job.id,
                    message: buildCompletedJobMessage(path.basename(sourcePath), completedBytes),
                    data: {
                        output: result.delivery?.deliveredPath || finalPath,
                        delivery: result.delivery || null,
                        sourcePath,
                        sourceBytes,
                        outputBytes: completedBytes,
                        bytesSaved: result.bytesSaved,
                    },
                });
                notifyCommitted({
                    job,
                    sourcePath,
                    outputMode,
                    finalPath,
                    delivery: result.delivery,
                    moved: finalPlan?.kind === 'move',
                });
                return { didWork: true, job, result };
            }
            await queue.updateProgress(job.id, workerId, { phase: JOB_PHASES.VERIFYING });
            let verification = null;
            if (settings.verifyOutput) {
                verification = await verifyMediaOutput(prepared.workPath, {
                    minimumBytes: settings.minimumOutputBytes,
                    ffprobePath: settings.ffprobePath,
                    probe: probeFunction,
                    signal: controller.signal,
                    sourceMetadata: media,
                    expectedStreamCounts: action.subtitleCodec === 'drop' || finalStep.mode === 'subtitle-strip'
                        ? { subtitle: 0 }
                        : undefined,
                    durationToleranceSeconds: action.durationToleranceSeconds,
                    durationToleranceRatio: action.durationToleranceRatio,
                });
            }
            let outputProbe = verification?.metadata || null;
            if (!outputProbe && settings.replaceQualityGuard !== false && outputMode === 'replace') {
                outputProbe = await probeFunction(prepared.workPath, {
                    ffprobePath: settings.ffprobePath,
                    signal: controller.signal,
                }).catch(() => null);
            }
            const qualityGate = evaluateReplaceQualityGuard({
                settings,
                outputMode,
                sourceProbe: media,
                outputProbe,
            });
            if (qualityGate) {
                await discardMediaOutput(prepared);
                for (const intermediate of intermediatePaths) {
                    await fs.rm(intermediate, { force: true }).catch(() => {});
                }
                intermediatePaths.length = 0;
                const guardDurationMs = executions.reduce((sum, entry) => sum + (Number(entry.durationMs) || 0), 0)
                    || Math.max(0, Date.now() - Date.parse(job.startedAt || job.createdAt || Date.now()));
                const result = {
                    skipped: qualityGate.reason,
                    message: qualityGate.message,
                    outputMode,
                    plans,
                    executions,
                    durationMs: guardDurationMs,
                    data: qualityGate.data || null,
                    adapter: selectedAdapterName || plans[plans.length - 1]?.adapter || null,
                    adapterLabel: selectedAdapterLabel || plans[plans.length - 1]?.adapterLabel || null,
                    hardwareFallback,
                };
                await queue.complete(job.id, workerId, result);
                await recordActivity({
                    type: 'job.skipped',
                    jobId: job.id,
                    message: qualityGate.message,
                    data: { reason: qualityGate.reason, ...(qualityGate.data || {}) },
                });
                return { didWork: true, job, result };
            }
            // Minimum-savings guardrail: discard transcode outputs that barely shrink
            // the file, keep the original, and complete the job as skipped.
            const minSavingsPercent = resolveMinSavingsPercent({ settings, pipeline: jobPipeline });
            if (minSavingsPercent > 0
                && steps.some((step) => String(step.mode) === 'transcode')) {
                const guardSourceBytes = Number(sourceFileMetadata?.size || media?.format?.size || 0) || 0;
                const candidateBytes = Number(verification?.size || 0)
                    || await fs.stat(prepared.workPath).then((stats) => stats.size).catch(() => 0);
                if (guardSourceBytes > 0 && candidateBytes > 0) {
                    const savingsPercent = (1 - candidateBytes / guardSourceBytes) * 100;
                    if (savingsPercent < minSavingsPercent) {
                        await discardMediaOutput(prepared);
                        const guardDurationMs = executions.reduce((sum, entry) => sum + (Number(entry.durationMs) || 0), 0)
                            || Math.max(0, Date.now() - Date.parse(job.startedAt || job.createdAt || Date.now()));
                        const result = {
                            skipped: 'insufficient-savings',
                            outputMode,
                            plans,
                            executions,
                            sourceBytes: guardSourceBytes,
                            outputBytes: candidateBytes,
                            bytesSaved: 0,
                            savingsPercent: Math.round(savingsPercent * 10) / 10,
                            minSavingsPercent,
                            durationMs: guardDurationMs,
                            adapter: selectedAdapterName || plans[plans.length - 1]?.adapter || null,
                            adapterLabel: selectedAdapterLabel || plans[plans.length - 1]?.adapterLabel || null,
                            hardwareFallback,
                        };
                        await queue.complete(job.id, workerId, result);
                        await recordActivity({
                            type: 'job.skipped',
                            jobId: job.id,
                            message: `Kept original ${path.basename(sourcePath)}: encode saved ${Math.max(0, Math.round(savingsPercent))}% (minimum is ${minSavingsPercent}%)`,
                            data: {
                                reason: 'insufficient-savings',
                                sourceBytes: guardSourceBytes,
                                outputBytes: candidateBytes,
                                savingsPercent: result.savingsPercent,
                                minSavingsPercent,
                            },
                        });
                        return { didWork: true, job, result };
                    }
                }
            }
            await queue.updateProgress(job.id, workerId, { phase: JOB_PHASES.COMMITTING });
            const output = await finalizeMediaOutput(prepared, {
                quarantineDir: jobLibrary?.quarantinePath || settings.quarantineDir,
                verify: false,
                minimumBytes: settings.minimumOutputBytes,
                ffprobePath: settings.ffprobePath,
                probe: probeFunction,
                signal: controller.signal,
                sourceMetadata: media,
                expectedStreamCounts: action.subtitleCodec === 'drop' || finalStep.mode === 'subtitle-strip'
                    ? { subtitle: 0 }
                    : undefined,
                durationToleranceSeconds: action.durationToleranceSeconds,
                durationToleranceRatio: action.durationToleranceRatio,
                sourceFileMetadata,
            });
            if (verification) output.verification = verification;
            const sourceBytes = Number(sourceFileMetadata?.size || media?.format?.size || 0) || 0;
            const outputBytes = Number(verification?.size || output?.verification?.size || 0) || 0;
            const durationMs = executions.reduce((sum, entry) => sum + (Number(entry.durationMs) || 0), 0)
                || Math.max(0, Date.now() - Date.parse(job.startedAt || job.createdAt || Date.now()));
            const resultBase = {
                plans,
                executions,
                output,
                sourceBytes,
                outputBytes,
                bytesSaved: Math.max(0, sourceBytes - outputBytes),
                durationMs,
                adapter: selectedAdapterName || plans[plans.length - 1]?.adapter || null,
                adapterLabel: selectedAdapterLabel || plans[plans.length - 1]?.adapterLabel || null,
                hardwareFallback,
            };
            let result = await maybeDeliver({ job, result: resultBase, media, settings });
            const completedBytes = await resolveOutputBytes(
                result.outputBytes || outputBytes,
                result.delivery?.deliveredPath,
                output.finalPath,
            );
            if (completedBytes > 0 && completedBytes !== Number(result.outputBytes || 0)) {
                result = {
                    ...result,
                    outputBytes: completedBytes,
                    bytesSaved: Math.max(0, sourceBytes - completedBytes),
                };
            }
            await queue.complete(job.id, workerId, result);
            await recordActivity({
                type: 'job.completed',
                jobId: job.id,
                message: buildCompletedJobMessage(path.basename(sourcePath), completedBytes),
                data: {
                    output: result.delivery?.deliveredPath || output.finalPath,
                    quarantinedPath: output.quarantinedPath || null,
                    sourceBytes,
                    outputBytes: completedBytes || outputBytes,
                    bytesSaved: result.bytesSaved,
                    durationMs,
                    delivery: result.delivery || null,
                    sourcePath,
                },
            });
            notifyCommitted({
                job,
                sourcePath,
                outputMode,
                finalPath: output.finalPath,
                delivery: result.delivery,
            });
            return { didWork: true, job, result };
        } catch (error) {
            await discardMediaOutput(prepared);
            await Promise.all(intermediatePaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
            const current = await queue.get(job.id);
            if (current?.cancelRequested || error?.code === 'ABORT_ERR') {
                await queue.cancelClaimed(job.id, workerId).catch(() => {});
            } else {
                await queue.fail(job.id, workerId, error, { retryDelayMs: settings.retryDelayMs }).catch(() => {});
            }
            await recordActivity({
                type: current?.cancelRequested || error?.code === 'ABORT_ERR' ? 'job.cancelled' : 'job.failed',
                jobId: job.id,
                message: String(error?.message || error),
                data: {
                    code: error?.code,
                    sourcePath: job.sourcePath,
                    ...(error?.stderr
                        ? {
                            stderr: String(error.stderr)
                                .split(/\r?\n/)
                                .filter(Boolean)
                                .slice(-40)
                                .join('\n')
                                .slice(0, 16_000),
                        }
                        : {}),
                },
            });
            return { didWork: true, job, error };
        } finally {
            clearInterval(heartbeat);
            activeControllers.delete(jobKey);
        }
    };

    const cancel = async (id) => {
        const key = String(id);
        const hadController = activeControllers.has(key);
        activeControllers.get(key)?.abort(errorWithCode('Job cancelled', 'ABORT_ERR'));
        const requested = await queue.requestCancel(id);
        // Orphaned "running" jobs (restart mid-encode, lost worker) never observe AbortController.
        if (requested?.state === 'running' && requested?.cancelRequested && !hadController) {
            return (await queue.forceCancelRunning(id)) || requested;
        }
        return requested;
    };

    const cancelMany = async ({ ids } = {}) => {
        const cancelled = await queue.cancelMany({ ids });
        const allow = Array.isArray(ids) && ids.length
            ? new Set(ids.map((id) => String(id)))
            : null;
        for (const key of [...activeControllers.keys()]) {
            if (allow && !allow.has(key)) continue;
            activeControllers.get(key)?.abort(errorWithCode('Job cancelled', 'ABORT_ERR'));
        }
        // Force-cancel orphaned running rows that we marked cancelRequested but aren't in-process.
        const forced = [];
        for (const job of cancelled) {
            if (job?.state !== 'running' || !job.cancelRequested) continue;
            if (activeControllers.has(String(job.id))) continue;
            const next = await queue.forceCancelRunning(job.id).catch(() => null);
            if (next) forced.push(next);
        }
        if (!forced.length) return cancelled;
        const byId = new Map(forced.map((job) => [String(job.id), job]));
        return cancelled.map((job) => byId.get(String(job.id)) || job);
    };

    const mapWithConcurrency = async (items, concurrency, worker) => {
        const results = new Array(items.length);
        let cursor = 0;
        const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
            while (cursor < items.length) {
                const index = cursor;
                cursor += 1;
                results[index] = await worker(items[index], index);
            }
        });
        await Promise.all(runners);
        return results;
    };

    /**
     * Probe library files and rank by cheap heuristic savings (no sample encode).
     * Picks the largest files first so the top of the report is usually the best reclaim.
     * Optional rootPath scopes the walk to a directory under an enabled library.
     */
    const analyze = async ({
        libraryId = null,
        pipelineId = null,
        force = false,
        limit = 150,
        minSizeBytes = 50 * 1024 * 1024,
        concurrency = 4,
        rootPath = null,
        signal,
    } = {}) => {
        const settings = await config();
        const maxRows = Math.min(500, Math.max(1, Math.round(Number(limit) || 150)));
        const minBytes = Math.max(0, Math.round(Number(minSizeBytes) || 0));
        const catalogLibraries = typeof libraries?.list === 'function' ? await libraries.list() : [];
        const enabledLibraries = catalogLibraries.filter((library) => (
            library?.enabled !== false && library?.rootPath
        ));
        const selectedLibraries = enabledLibraries.filter((library) => {
            if (libraryId == null || libraryId === '' || libraryId === 'all') return true;
            return String(library.id) === String(libraryId);
        });
        if (!selectedLibraries.length) {
            throw errorWithCode(
                libraryId ? `Library not found: ${libraryId}` : 'No enabled libraries to analyze',
                'LIBRARY_NOT_FOUND',
            );
        }

        const allPipelines = typeof pipelines?.list === 'function' ? await pipelines.list() : [];
        const forcedPipeline = pipelineId == null || pipelineId === ''
            ? null
            : allPipelines.find((entry) => String(entry.id) === String(pipelineId)) || null;
        if (pipelineId != null && pipelineId !== '' && !forcedPipeline) {
            throw errorWithCode(`Pipeline not found: ${pipelineId}`, 'PIPELINE_NOT_FOUND');
        }

        const discovered = [];
        const scopedInput = String(rootPath || '').trim();
        if (scopedInput) {
            const resolvedScope = path.resolve(scopedInput);
            const owningLibrary = selectedLibraries.find((library) => isPathContained(library.rootPath, resolvedScope))
                || enabledLibraries.find((library) => isPathContained(library.rootPath, resolvedScope));
            if (!owningLibrary) {
                throw errorWithCode('Path is outside configured library roots', 'OUTSIDE_LIBRARY');
            }
            if (libraryId != null && libraryId !== '' && libraryId !== 'all'
                && String(owningLibrary.id) !== String(libraryId)) {
                throw errorWithCode('Path is outside the selected library root', 'OUTSIDE_LIBRARY');
            }
            let scopedRoot = resolvedScope;
            try {
                scopedRoot = await resolveContainedPath(owningLibrary.rootPath, resolvedScope, {
                    mustExist: true,
                    allowSymlinks: false,
                });
            } catch (error) {
                throw errorWithCode(error.message || 'Invalid analyze path', error.code || 'OUTSIDE_LIBRARY');
            }
            const files = await listMediaFiles(scopedRoot, {
                extensions: settings.extensions,
                signal,
            });
            for (const filePath of files) {
                discovered.push({ filePath, library: owningLibrary });
            }
        } else {
            for (const library of selectedLibraries) {
                if (signal?.aborted) throw signal.reason || errorWithCode('Analyze aborted', 'ABORT_ERR');
                const files = await listMediaFiles(library.rootPath, {
                    extensions: settings.extensions,
                    signal,
                });
                for (const filePath of files) {
                    discovered.push({ filePath, library });
                }
            }
        }

        const sized = [];
        for (const entry of discovered) {
            if (signal?.aborted) throw signal.reason || errorWithCode('Analyze aborted', 'ABORT_ERR');
            const stats = await fs.stat(entry.filePath).catch(() => null);
            if (!stats?.isFile()) continue;
            if (stats.size < minBytes) continue;
            sized.push({ ...entry, sizeBytes: stats.size });
        }
        sized.sort((a, b) => b.sizeBytes - a.sizeBytes);
        const truncated = sized.length > maxRows;
        const candidates = sized.slice(0, maxRows);

        const rows = await mapWithConcurrency(candidates, Math.min(8, Math.max(1, Number(concurrency) || 4)), async (entry) => {
            if (signal?.aborted) throw signal.reason || errorWithCode('Analyze aborted', 'ABORT_ERR');
            const media = await probe(entry.filePath, { ffprobePath: settings.ffprobePath, signal });
            const context = buildRuleContext({
                filePath: entry.filePath,
                libraryRoot: entry.library.rootPath,
                probe: media,
            });

            let matchedPipeline = forcedPipeline;
            let matchedRule = null;
            let matchReason = 'no-matching-rule';
            let matched = false;
            let forcedMatch = false;

            if (forcedPipeline) {
                matchedRule = (forcedPipeline.compiledRules || forcedPipeline.rules || [])
                    .find((rule) => matchMediaRule(rule, context)) || null;
                if (matchedRule) {
                    matched = true;
                    matchReason = 'matched';
                } else if (force) {
                    matched = true;
                    forcedMatch = true;
                    matchReason = 'forced-pipeline';
                } else {
                    matchReason = 'no-matching-rule';
                }
            } else {
                const candidatesForLibrary = allPipelines
                    .filter((pipeline) => pipeline.enabled !== false)
                    .filter((pipeline) => !entry.library.pipelineId
                        || String(pipeline.id) === String(entry.library.pipelineId))
                    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
                for (const pipeline of candidatesForLibrary) {
                    const rule = (pipeline.compiledRules || pipeline.rules || [])
                        .find((entryRule) => matchMediaRule(entryRule, context)) || null;
                    if (rule) {
                        matchedPipeline = pipeline;
                        matchedRule = rule;
                        matched = true;
                        matchReason = 'matched';
                        break;
                    }
                }
            }

            if (!matched) {
                return buildAnalyzeRow({
                    filePath: entry.filePath,
                    library: entry.library,
                    probe: media,
                    pipeline: matchedPipeline,
                    rule: null,
                    matched: false,
                    matchReason,
                });
            }

            // Prefer explicit pipeline steps; fall back to the matched rule action.
            const pipelineForEstimate = matchedPipeline && findTranscodeStep(matchedPipeline)
                ? matchedPipeline
                : {
                    ...(matchedPipeline || {}),
                    steps: matchedRule?.then || matchedRule?.action
                        ? [matchedRule.then || matchedRule.action]
                        : (matchedPipeline?.steps || []),
                };
            const hdrSkip = shouldSkipForHdr({
                hdr: context.hdr,
                settings,
                pipeline: matchedPipeline,
                steps: pipelineForEstimate.steps || [],
            });
            if (hdrSkip) {
                return buildAnalyzeRow({
                    filePath: entry.filePath,
                    library: entry.library,
                    probe: media,
                    pipeline: matchedPipeline,
                    rule: matchedRule,
                    matched: false,
                    matchReason: hdrSkip.reason,
                    forced: forcedMatch,
                });
            }

            const encodeGate = await evaluateEncodeGates({
                settings,
                pipeline: matchedPipeline,
                steps: pipelineForEstimate.steps || [],
                probe: media,
                filePath: entry.filePath,
                libraryRoot: entry.library.rootPath,
                sourceFileMetadata: { size: entry.sizeBytes },
            });
            if (encodeGate) {
                return buildAnalyzeRow({
                    filePath: entry.filePath,
                    library: entry.library,
                    probe: media,
                    pipeline: matchedPipeline,
                    rule: matchedRule,
                    matched: false,
                    matchReason: encodeGate.reason,
                    forced: forcedMatch,
                });
            }

            return buildAnalyzeRow({
                filePath: entry.filePath,
                library: entry.library,
                probe: media,
                pipeline: pipelineForEstimate,
                rule: matchedRule,
                matched: true,
                matchReason,
                forced: forcedMatch,
            });
        });

        rows.sort((a, b) => {
            const savedDiff = (Number(b.estimatedBytesSaved) || 0) - (Number(a.estimatedBytesSaved) || 0);
            if (savedDiff !== 0) return savedDiff;
            return (Number(b.sizeBytes) || 0) - (Number(a.sizeBytes) || 0);
        });

        const matchedRows = rows.filter((row) => row.matched && (Number(row.estimatedBytesSaved) || 0) > 0);
        const allMatched = rows.filter((row) => row.matched);
        const totals = {
            discovered: discovered.length,
            considered: sized.length,
            analyzed: rows.length,
            matched: allMatched.length,
            estimatedBytesSaved: matchedRows.reduce((sum, row) => sum + (Number(row.estimatedBytesSaved) || 0), 0),
            sourceBytes: rows.reduce((sum, row) => sum + (Number(row.sizeBytes) || 0), 0),
            matchedSourceBytes: allMatched.reduce((sum, row) => sum + (Number(row.sizeBytes) || 0), 0),
            matchedDurationSeconds: allMatched.reduce((sum, row) => sum + (Number(row.durationSeconds) || 0), 0),
            estimatedOutputBytes: matchedRows.reduce((sum, row) => sum + (Number(row.estimatedOutputBytes) || 0), 0),
        };

        // ETA: prefer history encode throughput (ms per source byte), else duration × factor.
        let estimatedEncodeMs = null;
        let etaSource = 'none';
        const matchedSourceBytes = totals.matchedSourceBytes || 0;
        if (matchedSourceBytes > 0 && typeof history?.aggregates === 'function') {
            try {
                const week = await history.aggregates({ days: 7 });
                if ((Number(week.completed) || 0) > 0 && (Number(week.encodeMs) || 0) > 0 && (Number(week.bytesIn) || 0) > 0) {
                    const msPerByte = Number(week.encodeMs) / Number(week.bytesIn);
                    estimatedEncodeMs = Math.round(matchedSourceBytes * msPerByte);
                    etaSource = 'history-7d';
                }
            } catch {
                // Fall through to duration heuristic.
            }
        }
        if (estimatedEncodeMs == null && (Number(totals.matchedDurationSeconds) || 0) > 0) {
            const hardware = String(
                forcedPipeline?.hardware
                || settings.hardwareAcceleration
                || 'auto',
            ).toLowerCase();
            const factor = ['nvenc', 'qsv', 'intel-vaapi', 'vaapi'].includes(hardware) || hardware === 'auto'
                ? 0.55
                : 1.15;
            estimatedEncodeMs = Math.round(Number(totals.matchedDurationSeconds) * 1000 * factor);
            etaSource = 'duration-factor';
        }
        totals.estimatedEncodeMs = estimatedEncodeMs;
        totals.etaSource = etaSource;
        totals.estimatedSavingsPercent = totals.matchedSourceBytes > 0
            ? Math.round((1 - (totals.estimatedOutputBytes || 0) / totals.matchedSourceBytes) * 1000) / 10
            : null;

        return {
            ok: true,
            estimateMode: 'heuristic',
            libraryId: libraryId == null || libraryId === '' ? 'all' : libraryId,
            pipelineId: forcedPipeline?.id ?? null,
            rootPath: scopedInput || null,
            force: !!force,
            truncated,
            limit: maxRows,
            minSizeBytes: minBytes,
            totals,
            rows,
        };
    };

    /** Encode a short slice with the pipeline's transcode step and extrapolate full-file savings. */
    const estimate = async ({
        filePath,
        pipelineId,
        sampleSeconds = 60,
        libraryId = null,
        libraryRoot = null,
        signal,
    } = {}) => {
        const settings = await config();
        const catalogLibraries = typeof libraries?.list === 'function' ? await libraries.list() : [];
        const library = libraryId == null || libraryId === ''
            ? null
            : await libraries?.get?.(libraryId).catch(() => null);
        const isUnderRoot = (root, target) => {
            const relative = path.relative(path.resolve(root), path.resolve(target));
            return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        };
        // Prefer the job/library root used when queued — path-only matching can miss after
        // library edits or when settings.libraryRoots is empty.
        const candidateRoots = [
            libraryRoot,
            library?.rootPath,
            library?.path,
            ...settings.libraryRoots,
            ...catalogLibraries.map((entry) => entry?.rootPath || entry?.path).filter(Boolean),
        ].filter(Boolean);
        const uniqueRoots = [...new Set(candidateRoots.map((entry) => path.resolve(String(entry))))]
            .sort((a, b) => b.length - a.length);
        const root = uniqueRoots.find((entry) => isUnderRoot(entry, filePath));
        if (!root) throw errorWithCode('File is outside configured library roots', 'OUTSIDE_LIBRARY');
        const safePath = await resolveContainedPath(root, filePath, { allowSymlinks: false });
        const media = await probe(safePath, { ffprobePath: settings.ffprobePath, signal });
        if (signal?.aborted) throw signal.reason || errorWithCode('Estimate cancelled', 'ABORT_ERR');
        const durationSeconds = mediaDuration(media);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            throw errorWithCode('Could not determine media duration', 'NO_DURATION');
        }
        const pipeline = pipelineId == null ? null : await pipelines?.get?.(pipelineId);
        if (pipelineId != null && !pipeline) throw errorWithCode(`Pipeline not found: ${pipelineId}`, 'PIPELINE_NOT_FOUND');
        const pipelineSteps = Array.isArray(pipeline?.steps) ? pipeline.steps : [];
        const transcodeStep = pipelineSteps
            .map((step) => ({ ...step, mode: String(step.mode || step.type || '').toLowerCase() }))
            .find((step) => step.mode === 'transcode' && String(step.videoCodec || 'h264').toLowerCase() !== 'copy');
        if (!transcodeStep) throw errorWithCode('Pipeline has no transcode step to estimate', 'NO_TRANSCODE_STEP');
        const capabilities = await getCapabilities(settings);
        const requestedHardware = transcodeStep.hardwareAcceleration
            || pipeline?.hardware
            || settings.hardwareAcceleration;
        const logicalCodec = String(transcodeStep.videoCodec || 'h264').toLowerCase();
        let adapter;
        try {
            adapter = selectMediaAdapter(requestedHardware, capabilities, logicalCodec);
        } catch (error) {
            if (!settings.allowCpuFallback || requestedHardware === 'cpu') throw error;
            adapter = selectMediaAdapter('cpu', capabilities, logicalCodec);
        }
        const sample = Math.min(300, Math.max(10, Math.round(Number(sampleSeconds) || 60)));
        const startSeconds = Math.max(0, Math.min(durationSeconds * 0.2, Math.max(0, durationSeconds - sample)));
        const actualSample = Math.max(1, Math.min(sample, durationSeconds - startSeconds));
        const tmpOut = path.join(os.tmpdir(), `sm-estimate-${crypto.randomUUID()}${settings.outputExtension || '.mkv'}`);
        const plan = buildStepPlan({
            step: transcodeStep,
            inputPath: safePath,
            outputPath: tmpOut,
            libraryRoot: root,
            adapter,
            capabilities,
            vaapiDevice: settings.vaapiDevice,
            allowlist: settings.customCommandAllowlist,
            probe: media,
            hdr: detectHdr(media),
            hdrSettings: settings,
            pipeline,
            namingContext: buildNamingContext({
                probe: media,
                sourcePath: safePath,
                ...parseEpisodeHint(safePath),
            }),
        });
        const args = plan.args.map(String);
        const inputIndex = args.indexOf('-i');
        if (inputIndex >= 0) args.splice(inputIndex, 0, '-ss', String(Math.round(startSeconds)));
        args.splice(args.length - 1, 0, '-t', String(actualSample));
        try {
            await runner(settings.ffmpegPath, args, { timeoutMs: 15 * 60_000, signal });
            if (signal?.aborted) throw signal.reason || errorWithCode('Estimate cancelled', 'ABORT_ERR');
            const sampleBytes = (await fs.stat(tmpOut)).size;
            const sourceBytes = Number(media?.format?.size || 0) || (await fs.stat(safePath)).size;
            const estimatedOutputBytes = Math.round(sampleBytes * (durationSeconds / actualSample));
            const estimatedSavingsPercent = sourceBytes > 0
                ? Math.round((1 - estimatedOutputBytes / sourceBytes) * 1000) / 10
                : null;
            return {
                filePath: safePath,
                pipelineId: pipeline?.id ?? null,
                adapter: plan.adapter || adapter?.name || null,
                adapterLabel: plan.adapterLabel || adapter?.label || null,
                sampleSeconds: actualSample,
                sampleStartSeconds: Math.round(startSeconds),
                sampleBytes,
                durationSeconds,
                sourceBytes,
                estimatedOutputBytes,
                estimatedBytesSaved: Math.max(0, sourceBytes - estimatedOutputBytes),
                estimatedSavingsPercent,
            };
        } finally {
            await fs.rm(tmpOut, { force: true }).catch(() => {});
        }
    };

    return {
        workerId,
        enqueuePath,
        scan,
        processOne,
        cancel,
        cancelMany,
        analyze,
        estimate,
        activeJobIds: () => [...activeControllers.keys()],
    };
};

export default createMediaProcessor;
