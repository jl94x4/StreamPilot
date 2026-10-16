import fs from 'fs/promises';
import path from 'path';
import { estimateHeuristicSavings, findTranscodeStep } from './analyze.js';
import { isQuietHoursActive } from './quiet-hours.js';
import { getFreeDiskBytes } from './path-policy.js';

const asNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const gbToBytes = (gb) => Math.round(asNumber(gb) * 1024 ** 3);

const videoStream = (probe) => {
    const streams = Array.isArray(probe?.streams) ? probe.streams : [];
    return streams.find((stream) => stream?.codec_type === 'video') || null;
};

const normalizeCodec = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const isHevcFamily = (codec) => ['hevc', 'h265', 'x265'].includes(normalizeCodec(codec));

/**
 * Resolve effective minimum savings % from global settings + pipeline override.
 * Pipeline may set a number, or 'inherit' / null / '' to use global.
 */
export const resolveMinSavingsPercent = ({ settings = {}, pipeline = null } = {}) => {
    const global = Math.min(95, Math.max(0, Math.round(asNumber(settings.minSavingsPercent, 0))));
    const raw = pipeline?.minSavingsPercent;
    if (raw == null || raw === '' || String(raw).toLowerCase() === 'inherit') return global;
    const local = Number(raw);
    if (!Number.isFinite(local)) return global;
    return Math.min(95, Math.max(0, Math.round(local)));
};

/**
 * Effective ROI threshold after daytime boost and free-space tighten.
 */
export const resolveEffectiveMinSavingsPercent = async ({
    settings = {},
    pipeline = null,
    libraryRoot = null,
    now = new Date(),
} = {}) => {
    let effective = resolveMinSavingsPercent({ settings, pipeline });
    const daytimeExtra = Math.min(50, Math.max(0, Math.round(asNumber(settings.daytimeExtraSavingsPercent, 0))));
    if (daytimeExtra > 0 && settings.quietHoursEnabled === true && !isQuietHoursActive(settings, now)) {
        effective = Math.min(95, effective + daytimeExtra);
    }
    const freeSpaceRoiMin = Math.min(95, Math.max(0, Math.round(asNumber(settings.freeSpaceRoiMinPercent, 0))));
    const minFreeGb = asNumber(settings.minFreeDiskGb, 20);
    if (freeSpaceRoiMin > 0 && libraryRoot && minFreeGb > 0) {
        const freeBytes = await getFreeDiskBytes(libraryRoot);
        const warnBytes = gbToBytes(minFreeGb) * 2;
        if (freeBytes != null && freeBytes < warnBytes) {
            effective = Math.max(effective, freeSpaceRoiMin);
        }
    }
    return effective;
};

const pipelineHasVideoTranscode = (steps = []) => (
    (Array.isArray(steps) ? steps : []).some((step) => {
        const type = String(step?.type || step?.mode || '').toLowerCase();
        if (type && type !== 'transcode') return false;
        return normalizeCodec(step?.videoCodec || 'h264') !== 'copy';
    })
);

const pipelineIsAudioOnlyCleanup = (steps = []) => {
    const list = Array.isArray(steps) ? steps : [];
    if (!list.length) return false;
    const hasAudioWork = list.some((step) => {
        const type = String(step?.type || step?.mode || '').toLowerCase();
        if (type && !['transcode', 'audio', 'loudnorm'].includes(type)) return false;
        const audio = normalizeCodec(step?.audioCodec || '');
        return audio && audio !== 'copy';
    });
    const videoCopyOnly = list.every((step) => {
        const type = String(step?.type || step?.mode || '').toLowerCase();
        if (type === 'remux' || type === 'subtitle-strip' || type === 'move') return true;
        return normalizeCodec(step?.videoCodec || 'copy') === 'copy';
    });
    return hasAudioWork && videoCopyOnly;
};

/**
 * Cheap pre-encode / pre-enqueue ROI and niche gates.
 * Returns null to proceed, or { reason, message, data }.
 */
export const evaluateEncodeGates = async ({
    settings = {},
    pipeline = null,
    steps = null,
    probe = null,
    filePath = null,
    libraryRoot = null,
    sourceFileMetadata = null,
    watchStats = null,
    seasonStats = null,
    heuristic = null,
    now = new Date(),
} = {}) => {
    const configuredSteps = Array.isArray(steps) && steps.length
        ? steps
        : (Array.isArray(pipeline?.steps) ? pipeline.steps : []);
    const video = videoStream(probe);
    const sourceBytes = asNumber(probe?.format?.size)
        || asNumber(sourceFileMetadata?.size)
        || 0;
    const bitrateKbps = (() => {
        const bps = asNumber(video?.bit_rate) || asNumber(probe?.format?.bit_rate);
        return bps > 0 ? bps / 1000 : null;
    })();

    const minSourceGb = asNumber(settings.minSourceGb, 0);
    if (minSourceGb > 0 && sourceBytes > 0 && sourceBytes < gbToBytes(minSourceGb)) {
        return {
            reason: 'too-small',
            message: `Skipped: source is below minimum size (${minSourceGb} GB).`,
            data: { sourceBytes, minSourceGb },
        };
    }

    const minBitrateKbps = asNumber(settings.minBitrateKbps, 0);
    if (minBitrateKbps > 0 && bitrateKbps != null && bitrateKbps < minBitrateKbps) {
        return {
            reason: 'bitrate-too-low',
            message: `Skipped: source bitrate ${Math.round(bitrateKbps)} kbps is below minimum ${minBitrateKbps} kbps.`,
            data: { bitrateKbps, minBitrateKbps },
        };
    }

    const minFileAgeDays = asNumber(settings.minFileAgeDays, 0);
    if (minFileAgeDays > 0 && filePath) {
        try {
            const stat = sourceFileMetadata?.mtimeMs
                ? { mtimeMs: sourceFileMetadata.mtimeMs }
                : await fs.stat(filePath);
            const ageMs = Date.now() - Number(stat.mtimeMs || stat.mtime?.getTime?.() || 0);
            const minAgeMs = minFileAgeDays * 86_400_000;
            if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < minAgeMs) {
                return {
                    reason: 'too-new',
                    message: `Skipped: file is younger than ${minFileAgeDays} day(s) (still settling).`,
                    data: { ageDays: Math.round((ageMs / 86_400_000) * 10) / 10, minFileAgeDays },
                };
            }
        } catch {
            // If stat fails, do not block on age.
        }
    }

    const maxWatchCount = asNumber(settings.maxWatchCount, 0);
    if (maxWatchCount > 0 && watchStats && asNumber(watchStats.viewCount) > maxWatchCount) {
        return {
            reason: 'watch-score',
            message: `Skipped: watch count ${watchStats.viewCount} exceeds max ${maxWatchCount}.`,
            data: { viewCount: watchStats.viewCount, maxWatchCount },
        };
    }

    const skipWatchedWithinDays = asNumber(settings.skipWatchedWithinDays, 0);
    if (skipWatchedWithinDays > 0 && watchStats?.lastViewedAt) {
        const last = Date.parse(watchStats.lastViewedAt);
        if (Number.isFinite(last)) {
            const days = (Date.now() - last) / 86_400_000;
            if (days >= 0 && days < skipWatchedWithinDays) {
                return {
                    reason: 'recently-watched',
                    message: `Skipped: watched within the last ${skipWatchedWithinDays} day(s).`,
                    data: { lastViewedAt: watchStats.lastViewedAt, skipWatchedWithinDays },
                };
            }
        }
    }

    if (settings.audioOnlyIfVideoMatches === true && pipelineIsAudioOnlyCleanup(configuredSteps)) {
        const codec = video?.codec_name || '';
        if (!isHevcFamily(codec) && normalizeCodec(codec) !== 'av1') {
            return {
                reason: 'audio-requires-hevc',
                message: 'Skipped audio cleanup: video is not already HEVC/AV1.',
                data: { videoCodec: codec || null },
            };
        }
    }

    const seasonMin = asNumber(settings.seasonMatchMinPercent, 0);
    if (seasonMin > 0 && seasonStats && seasonStats.siblingCount >= 3) {
        const matchRate = seasonStats.matchRate * 100;
        const needRate = seasonStats.needRate * 100;
        if (matchRate < seasonMin && needRate < seasonMin) {
            return {
                reason: 'season-incomplete',
                message: `Skipped: season folder is mixed (${Math.round(matchRate)}% target / ${Math.round(needRate)}% needing encode; want ≥ ${seasonMin}% on one side).`,
                data: {
                    siblingCount: seasonStats.siblingCount,
                    matchRate: Math.round(matchRate * 10) / 10,
                    needRate: Math.round(needRate * 10) / 10,
                    seasonMatchMinPercent: seasonMin,
                },
            };
        }
    }

    if (!pipelineHasVideoTranscode(configuredSteps)) {
        return null;
    }

    const effectiveMinSavings = await resolveEffectiveMinSavingsPercent({
        settings,
        pipeline,
        libraryRoot,
        now,
    });
    const minReclaimGb = asNumber(settings.minReclaimGb, 0);

    if (effectiveMinSavings <= 0 && minReclaimGb <= 0) {
        return null;
    }

    const estimate = heuristic || estimateHeuristicSavings({
        probe,
        pipeline,
        step: findTranscodeStep({ steps: configuredSteps }),
    });

    if (estimate?.estimatedSavingsPercent == null && estimate?.estimatedBytesSaved == null) {
        return null;
    }

    if (minReclaimGb > 0 && asNumber(estimate.estimatedBytesSaved) < gbToBytes(minReclaimGb)) {
        return {
            reason: 'below-reclaim-estimate',
            message: `Skipped: estimated reclaim ${((estimate.estimatedBytesSaved || 0) / 1024 ** 3).toFixed(2)} GB is below minimum ${minReclaimGb} GB.`,
            data: {
                estimatedBytesSaved: estimate.estimatedBytesSaved,
                minReclaimGb,
                estimatedSavingsPercent: estimate.estimatedSavingsPercent,
            },
        };
    }

    if (effectiveMinSavings > 0 && asNumber(estimate.estimatedSavingsPercent) < effectiveMinSavings) {
        return {
            reason: 'below-savings-estimate',
            message: `Skipped: estimated savings ${estimate.estimatedSavingsPercent}% is below minimum ${effectiveMinSavings}%.`,
            data: {
                estimatedSavingsPercent: estimate.estimatedSavingsPercent,
                minSavingsPercent: effectiveMinSavings,
                estimatedBytesSaved: estimate.estimatedBytesSaved,
                estimateMode: estimate.estimateMode,
                confidence: estimate.confidence,
            },
        };
    }

    return null;
};

/**
 * After a sample encode, decide whether to continue the full encode.
 */
export const evaluateSampleGate = ({
    settings = {},
    pipeline = null,
    estimatedSavingsPercent = null,
    estimatedBytesSaved = null,
    effectiveMinSavingsPercent = null,
} = {}) => {
    if (settings.sampleGateEnabled !== true) return null;
    const minSavings = effectiveMinSavingsPercent != null
        ? effectiveMinSavingsPercent
        : resolveMinSavingsPercent({ settings, pipeline });
    const minReclaimGb = asNumber(settings.minReclaimGb, 0);
    if (minSavings > 0 && estimatedSavingsPercent != null && estimatedSavingsPercent < minSavings) {
        return {
            reason: 'sample-rejected',
            message: `Sample encode projected ${estimatedSavingsPercent}% savings (minimum ${minSavings}%).`,
            data: { estimatedSavingsPercent, minSavingsPercent: minSavings, estimatedBytesSaved },
        };
    }
    if (minReclaimGb > 0 && estimatedBytesSaved != null && estimatedBytesSaved < gbToBytes(minReclaimGb)) {
        return {
            reason: 'sample-rejected',
            message: `Sample encode projected ${((estimatedBytesSaved || 0) / 1024 ** 3).toFixed(2)} GB reclaim (minimum ${minReclaimGb} GB).`,
            data: { estimatedBytesSaved, minReclaimGb, estimatedSavingsPercent },
        };
    }
    return null;
};

/**
 * Refuse replace commits that drop resolution class or HDR kind.
 */
export const evaluateReplaceQualityGuard = ({
    settings = {},
    outputMode = null,
    sourceProbe = null,
    outputProbe = null,
} = {}) => {
    if (settings.replaceQualityGuard === false) return null;
    if (String(outputMode || '').toLowerCase() !== 'replace') return null;
    const before = videoStream(sourceProbe);
    const after = videoStream(outputProbe);
    if (!before || !after) return null;

    const beforeW = asNumber(before.width);
    const beforeH = asNumber(before.height);
    const afterW = asNumber(after.width);
    const afterH = asNumber(after.height);
    if (beforeW > 0 && beforeH > 0 && afterW > 0 && afterH > 0) {
        const beforePixels = beforeW * beforeH;
        const afterPixels = afterW * afterH;
        if (afterPixels < beforePixels * 0.85) {
            return {
                reason: 'quality-regression',
                message: `Replace blocked: output resolution ${afterW}x${afterH} is materially smaller than source ${beforeW}x${beforeH}.`,
                data: { before: { width: beforeW, height: beforeH }, after: { width: afterW, height: afterH } },
            };
        }
    }

    const beforeTransfer = String(before.color_transfer || '').toLowerCase();
    const afterTransfer = String(after.color_transfer || '').toLowerCase();
    const beforeHdr = beforeTransfer === 'smpte2084' || beforeTransfer === 'arib-std-b67'
        || /dvh/i.test(String(before.codec_tag_string || ''));
    const afterHdr = afterTransfer === 'smpte2084' || afterTransfer === 'arib-std-b67'
        || /dvh/i.test(String(after.codec_tag_string || ''));
    if (beforeHdr && !afterHdr) {
        return {
            reason: 'quality-regression',
            message: 'Replace blocked: source is HDR/DV but output lost HDR signaling.',
            data: { beforeTransfer, afterTransfer },
        };
    }
    return null;
};

/**
 * Season-folder uniformity stats for episode-like filenames.
 */
export const collectSeasonStats = async (filePath, {
    extensions = ['.mkv', '.mp4', '.m4v'],
    targetCodec = 'hevc',
    probeFn = null,
} = {}) => {
    if (!filePath || typeof probeFn !== 'function') return null;
    const dir = path.dirname(filePath);
    let entries = [];
    try {
        entries = await fs.readdir(dir);
    } catch {
        return null;
    }
    const media = entries.filter((name) => {
        const ext = path.extname(name).toLowerCase();
        return extensions.includes(ext);
    });
    if (media.length < 3) return null;

    let matchCount = 0;
    let needCount = 0;
    for (const name of media.slice(0, 40)) {
        const full = path.join(dir, name);
        try {
            const probe = await probeFn(full);
            const codec = normalizeCodec(videoStream(probe)?.codec_name);
            const target = normalizeCodec(targetCodec);
            const matches = target === 'hevc'
                ? isHevcFamily(codec)
                : codec === target;
            if (matches) matchCount += 1;
            else needCount += 1;
        } catch {
            needCount += 1;
        }
    }
    const siblingCount = matchCount + needCount;
    if (siblingCount < 3) return null;
    return {
        siblingCount,
        matchCount,
        needCount,
        matchRate: matchCount / siblingCount,
        needRate: needCount / siblingCount,
    };
};

export default {
    resolveMinSavingsPercent,
    resolveEffectiveMinSavingsPercent,
    evaluateEncodeGates,
    evaluateSampleGate,
    evaluateReplaceQualityGuard,
    collectSeasonStats,
};
