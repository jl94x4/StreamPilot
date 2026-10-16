import { mediaDuration } from './output.js';
import { detectHdr } from './hdr.js';

const positive = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeCodec = (value) => String(value || '').trim().toLowerCase();

/** Typical output size as a fraction of source video bitrate for CRF/CQ encodes. */
const CODEC_RATIO = Object.freeze({
    'h264->hevc': 0.58,
    'h264->h265': 0.58,
    'h264->av1': 0.48,
    'mpeg2video->hevc': 0.35,
    'mpeg2video->h265': 0.35,
    'mpeg4->hevc': 0.4,
    'vc1->hevc': 0.4,
    'hevc->hevc': 0.82,
    'h265->hevc': 0.82,
    'hevc->av1': 0.78,
    'av1->av1': 0.9,
    'h264->h264': 0.85,
});

/**
 * Pull the fields the analyzer UI and heuristic need from an ffprobe JSON blob.
 * @param {object} probe
 */
export const summarizeProbeForAnalyze = (probe) => {
    const format = probe?.format || {};
    const streams = Array.isArray(probe?.streams) ? probe.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video') || null;
    const audios = streams.filter((stream) => stream.codec_type === 'audio');
    const durationSeconds = mediaDuration(probe);
    const sizeBytes = positive(format.size);
    const audioBitrate = audios.reduce((sum, stream) => sum + (positive(stream.bit_rate) || 0), 0);
    let videoBitrate = positive(video?.bit_rate);
    const containerBitrate = positive(format.bit_rate);
    if (videoBitrate == null && containerBitrate != null) {
        videoBitrate = Math.max(0, containerBitrate - audioBitrate) || containerBitrate;
    }
    if (videoBitrate == null && sizeBytes != null && durationSeconds != null) {
        const totalBitsPerSec = (sizeBytes * 8) / durationSeconds;
        videoBitrate = Math.max(0, totalBitsPerSec - audioBitrate) || totalBitsPerSec;
    }
    const hdr = detectHdr(video || probe);
    return {
        container: String(format.format_name || '').split(',')[0] || null,
        videoCodec: video ? normalizeCodec(video.codec_name) || null : null,
        width: positive(video?.width),
        height: positive(video?.height),
        durationSeconds,
        sizeBytes,
        videoBitrateBps: videoBitrate,
        audioBitrateBps: audioBitrate || null,
        audioTrackCount: audios.length,
        bitrateKbps: videoBitrate != null ? videoBitrate / 1000 : (containerBitrate != null ? containerBitrate / 1000 : null),
        hdrKind: hdr.kind,
        isHdr: hdr.isHdr,
        isDolbyVision: hdr.isDolbyVision,
    };
};

export const findTranscodeStep = (pipelineOrSteps) => {
    const steps = Array.isArray(pipelineOrSteps)
        ? pipelineOrSteps
        : (Array.isArray(pipelineOrSteps?.steps) ? pipelineOrSteps.steps : []);
    return steps
        .map((step) => ({ ...step, mode: String(step.mode || step.type || '').toLowerCase() }))
        .find((step) => step.mode === 'transcode' && normalizeCodec(step.videoCodec || 'h264') !== 'copy')
        || null;
};

const codecPairRatio = (sourceCodec, targetCodec) => {
    const key = `${normalizeCodec(sourceCodec)}->${normalizeCodec(targetCodec)}`;
    if (CODEC_RATIO[key] != null) return CODEC_RATIO[key];
    if (normalizeCodec(sourceCodec) === normalizeCodec(targetCodec)) return 0.85;
    if (normalizeCodec(targetCodec) === 'av1') return 0.5;
    if (normalizeCodec(targetCodec) === 'hevc' || normalizeCodec(targetCodec) === 'h265') return 0.6;
    return 0.75;
};

/**
 * Cheap savings estimate from probe + pipeline transcode step (no encode).
 * Prefer target `videoBitrateKbps` when set; otherwise CRF/CQ codec ratios.
 */
export const estimateHeuristicSavings = ({ probe, pipeline, step } = {}) => {
    const summary = summarizeProbeForAnalyze(probe);
    const transcode = step || findTranscodeStep(pipeline);
    const sourceBytes = summary.sizeBytes || 0;
    const durationSeconds = summary.durationSeconds;

    if (!transcode) {
        return {
            estimateMode: 'heuristic',
            confidence: 'high',
            reason: 'no-transcode-step',
            sourceBytes,
            estimatedOutputBytes: sourceBytes,
            estimatedBytesSaved: 0,
            estimatedSavingsPercent: 0,
            summary,
        };
    }
    if (!durationSeconds || !sourceBytes) {
        return {
            estimateMode: 'heuristic',
            confidence: 'low',
            reason: !durationSeconds ? 'no-duration' : 'no-size',
            sourceBytes,
            estimatedOutputBytes: null,
            estimatedBytesSaved: null,
            estimatedSavingsPercent: null,
            summary,
        };
    }

    const targetCodec = normalizeCodec(transcode.videoCodec || 'h264');
    const targetBitrateKbps = positive(transcode.videoBitrateKbps);
    const crf = Number.isFinite(Number(transcode.crf)) ? Number(transcode.crf) : 23;
    let estimatedVideoBytes;
    let confidence;

    if (targetBitrateKbps != null) {
        estimatedVideoBytes = (targetBitrateKbps * 1000 / 8) * durationSeconds;
        confidence = 'high';
    } else {
        const sourceVideoBps = summary.videoBitrateBps || ((sourceBytes * 8) / durationSeconds);
        const ratio = codecPairRatio(summary.videoCodec, targetCodec);
        const crfFactor = Math.pow(0.91, crf - 23);
        estimatedVideoBytes = (sourceVideoBps / 8) * durationSeconds * ratio * crfFactor;
        confidence = summary.videoBitrateBps != null ? 'medium' : 'low';
    }

    const audioMode = normalizeCodec(transcode.audioCodec || 'copy');
    let estimatedAudioBytes;
    if (!audioMode || audioMode === 'copy') {
        if (summary.audioBitrateBps != null) {
            estimatedAudioBytes = (summary.audioBitrateBps / 8) * durationSeconds;
        } else {
            // Assume ~10% of a typical file is audio when streams omit bitrates.
            estimatedAudioBytes = sourceBytes * 0.1;
        }
    } else {
        const audioBitrateKbps = positive(transcode.audioBitrateKbps) || 192;
        const tracks = Math.max(1, summary.audioTrackCount || 1);
        estimatedAudioBytes = (audioBitrateKbps * 1000 / 8) * durationSeconds * tracks;
    }

    // Small muxing overhead so we do not over-promise savings.
    const estimatedOutputBytes = Math.max(1, Math.round((estimatedVideoBytes + estimatedAudioBytes) * 1.02));
    const estimatedBytesSaved = Math.max(0, sourceBytes - estimatedOutputBytes);
    const estimatedSavingsPercent = Math.round((1 - estimatedOutputBytes / sourceBytes) * 1000) / 10;

    return {
        estimateMode: 'heuristic',
        confidence,
        reason: targetBitrateKbps != null ? 'target-bitrate' : 'crf-ratio',
        sourceBytes,
        estimatedOutputBytes,
        estimatedBytesSaved,
        estimatedSavingsPercent,
        targetCodec,
        targetBitrateKbps,
        summary,
    };
};

/**
 * Map probe + pipeline match + heuristic into one analyzer row.
 */
export const buildAnalyzeRow = ({
    filePath,
    library,
    probe,
    pipeline,
    rule,
    matched,
    matchReason,
    forced = false,
} = {}) => {
    const estimate = estimateHeuristicSavings({ probe, pipeline });
    const summary = estimate.summary || summarizeProbeForAnalyze(probe);
    return {
        path: filePath,
        libraryId: library?.id ?? null,
        libraryName: library?.name || null,
        matched: !!matched,
        forced: !!forced,
        matchReason: matchReason || (matched ? 'matched' : 'no-matching-rule'),
        pipelineId: pipeline?.id ?? null,
        pipelineName: pipeline?.name || null,
        ruleId: rule?.id ?? rule?.name ?? null,
        container: summary.container,
        videoCodec: summary.videoCodec,
        width: summary.width,
        height: summary.height,
        durationSeconds: summary.durationSeconds,
        sizeBytes: summary.sizeBytes,
        bitrateKbps: summary.bitrateKbps == null ? null : Math.round(summary.bitrateKbps),
        hdrKind: summary.hdrKind || 'none',
        isHdr: !!summary.isHdr,
        isDolbyVision: !!summary.isDolbyVision,
        estimateMode: estimate.estimateMode,
        confidence: estimate.confidence,
        estimateReason: estimate.reason,
        estimatedOutputBytes: estimate.estimatedOutputBytes,
        estimatedBytesSaved: estimate.estimatedBytesSaved,
        estimatedSavingsPercent: estimate.estimatedSavingsPercent,
        targetCodec: estimate.targetCodec || null,
    };
};

export default {
    summarizeProbeForAnalyze,
    findTranscodeStep,
    estimateHeuristicSavings,
    buildAnalyzeRow,
};
