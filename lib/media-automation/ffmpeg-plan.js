import path from 'path';
import { CPU_ADAPTER, resolveAdapterEncoder } from './adapters.js';
import {
    buildHdrPreserveArgs,
    detectHdr,
    resolveHdrHandling,
    shouldForceTenBitForHdr,
} from './hdr.js';

const AUDIO_ENCODERS = new Set(['copy', 'aac', 'ac3', 'eac3', 'libopus', 'flac']);

const safeEncoder = (value, allowed, fallback) => allowed.has(String(value || '')) ? String(value) : fallback;

export const buildFfmpegPlan = ({
    inputPath,
    outputPath,
    rule = {},
    adapter = CPU_ADAPTER,
    capabilities = {},
    vaapiDevice,
    overwrite = true,
    probe = null,
    hdr = null,
    hdrSettings = null,
    pipeline = null,
} = {}) => {
    if (!inputPath || !outputPath) throw new Error('inputPath and outputPath are required');
    if (path.resolve(inputPath) === path.resolve(outputPath)) throw new Error('FFmpeg output must differ from input');
    const action = rule.then && typeof rule.then === 'object' ? rule.then : rule.action || {};
    const mode = String(action.mode || 'remux').toLowerCase();
    if (!['remux', 'transcode'].includes(mode)) throw new Error(`Unsupported FFmpeg mode: ${mode}`);
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-progress', 'pipe:1'];
    if (overwrite) args.push('-y');
    else args.push('-n');
    if (mode === 'transcode') args.push(...adapter.inputArgs({ device: vaapiDevice }));
    args.push('-i', String(inputPath), '-map', '0', '-map_metadata', '0', '-map_chapters', '0');

    const hdrInfo = hdr || (probe ? detectHdr(probe) : null);
    const hdrPolicy = hdrInfo
        ? resolveHdrHandling({ settings: hdrSettings || {}, pipeline, hdr: hdrInfo })
        : null;

    if (mode === 'remux') {
        args.push('-c', 'copy');
    } else {
        const logicalCodec = String(action.videoCodec || 'h264').toLowerCase();
        const audioEncoder = safeEncoder(action.audioCodec, AUDIO_ENCODERS, 'copy');
        if (logicalCodec === 'copy') {
            args.push('-c:v', 'copy');
        } else {
            // 10-bit only for HEVC/AV1: 10-bit H.264 is unsupported by hardware
            // encoders and unplayable on most clients.
            const preserveHdr = shouldForceTenBitForHdr({
                hdr: hdrInfo,
                handling: hdrPolicy?.handling,
            });
            const tenBit = (
                action.tenBit === true
                || Number(action.bitDepth) === 10
                || preserveHdr
            ) && ['hevc', 'av1'].includes(logicalCodec);
            const videoEncoder = resolveAdapterEncoder(adapter, logicalCodec, capabilities);
            args.push('-c:v', videoEncoder, ...adapter.outputArgs({
                codec: logicalCodec,
                preset: action.preset,
                crf: action.crf,
                videoBitrateKbps: action.videoBitrateKbps,
            }));
            if (tenBit) {
                // QSV/VAAPI get 10-bit via a p010 hwupload in the filter chain instead.
                if (adapter.name === 'cpu') args.push('-pix_fmt', 'yuv420p10le');
                else if (adapter.name === 'nvenc') args.push('-pix_fmt', 'p010le');
                if (logicalCodec === 'hevc') args.push('-profile:v', 'main10');
            }
            if (preserveHdr && hdrInfo) {
                args.push(...buildHdrPreserveArgs({
                    hdr: hdrInfo,
                    adapterName: adapter.name,
                    videoEncoder,
                    logicalCodec,
                }));
            }
            const width = Number.isFinite(Number(action.maxWidth)) && Number(action.maxWidth) > 0
                ? Math.max(2, Math.round(Number(action.maxWidth) / 2) * 2)
                : 0;
            // QSV/VAAPI need an explicit hwupload path; CPU only needs scale when capping width.
            const needsHwUpload = ['qsv', 'intel-vaapi', 'vaapi'].includes(adapter.name);
            const filter = needsHwUpload || width
                ? adapter.filter({ maxWidth: width, device: vaapiDevice, encode: true, tenBit })
                : null;
            if (filter) args.push('-vf', filter);
        }
        args.push('-c:a', audioEncoder);
        if (action.subtitleCodec === 'drop') args.push('-sn');
        else args.push('-c:s', safeEncoder(action.subtitleCodec, new Set(['copy', 'srt', 'webvtt']), 'copy'));
        if (Number.isFinite(Number(action.audioBitrateKbps)) && audioEncoder !== 'copy') {
            args.push('-b:a', `${Math.max(32, Math.min(1536, Math.round(Number(action.audioBitrateKbps))))}k`);
        }
    }
    args.push('-max_muxing_queue_size', '4096', String(outputPath));
    return {
        executable: 'ffmpeg',
        args,
        mode,
        adapter: mode === 'transcode' ? adapter.name : null,
        adapterLabel: mode === 'transcode' ? adapter.label : null,
        inputPath: String(inputPath),
        outputPath: String(outputPath),
        hdrKind: hdrInfo?.kind || 'none',
        hdrHandling: hdrPolicy?.handling || null,
    };
};

export default buildFfmpegPlan;
