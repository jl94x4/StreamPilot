const lower = (value) => String(value || '').trim().toLowerCase();

const HANDLING = Object.freeze(['skip', 'preserve', 'strip', 'inherit']);

const normalizeHandling = (value, fallback) => {
    const normalized = lower(value);
    if (normalized === 'inherit' || normalized === '') return fallback;
    return ['skip', 'preserve', 'strip'].includes(normalized) ? normalized : fallback;
};

const sideDataList = (video) => (Array.isArray(video?.side_data_list) ? video.side_data_list : []);

const sideDataType = (entry) => lower(entry?.side_data_type || entry?.type);

const findSideData = (video, matcher) => sideDataList(video).find((entry) => matcher(sideDataType(entry), entry));

const asFraction50500 = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    // ffprobe often reports CIE xy as fractions (0-1) or already scaled.
    if (number > 0 && number <= 1) return Math.round(number * 50000);
    return Math.round(number);
};

const asNits = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return number;
};

/**
 * Format mastering display metadata for x265 `master-display=...`.
 * @returns {string|null}
 */
export const formatMasterDisplay = (sideData) => {
    if (!sideData || typeof sideData !== 'object') return null;
    const redX = asFraction50500(sideData.red_x ?? sideData.r_x);
    const redY = asFraction50500(sideData.red_y ?? sideData.r_y);
    const greenX = asFraction50500(sideData.green_x ?? sideData.g_x);
    const greenY = asFraction50500(sideData.green_y ?? sideData.g_y);
    const blueX = asFraction50500(sideData.blue_x ?? sideData.b_x);
    const blueY = asFraction50500(sideData.blue_y ?? sideData.b_y);
    const whiteX = asFraction50500(sideData.white_point_x ?? sideData.wp_x);
    const whiteY = asFraction50500(sideData.white_point_y ?? sideData.wp_y);
    let maxL = asNits(sideData.max_luminance ?? sideData.luminance_max);
    let minL = asNits(sideData.min_luminance ?? sideData.luminance_min);
    if ([redX, redY, greenX, greenY, blueX, blueY, whiteX, whiteY].some((value) => value == null)) {
        return null;
    }
    // x265 expects luminance in 0.0001 nits units.
    if (maxL != null && maxL < 1000) maxL = Math.round(maxL * 10000);
    else if (maxL != null) maxL = Math.round(maxL);
    if (minL != null && minL < 1) minL = Math.round(minL * 10000);
    else if (minL != null) minL = Math.round(minL);
    if (maxL == null) maxL = 10000000;
    if (minL == null) minL = 1;
    return `G(${greenX},${greenY})B(${blueX},${blueY})R(${redX},${redY})WP(${whiteX},${whiteY})L(${maxL},${minL})`;
};

export const formatMaxCll = (sideData) => {
    if (!sideData || typeof sideData !== 'object') return null;
    const maxContent = Number(sideData.max_content ?? sideData.max_content_light_level);
    const maxAverage = Number(sideData.max_average ?? sideData.max_average_light_level);
    if (!Number.isFinite(maxContent) || !Number.isFinite(maxAverage)) return null;
    return `${Math.round(maxContent)},${Math.round(maxAverage)}`;
};

const hasDolbyVision = (video) => {
    const tag = lower(video?.codec_tag_string || video?.codec_tag);
    if (tag.startsWith('dvh') || tag === 'dvhe' || tag === 'dav1') return true;
    const profile = lower(video?.profile);
    if (profile.includes('dolby vision') || profile.includes('dovi')) return true;
    return !!findSideData(video, (type) => (
        type.includes('dovi') || type.includes('dolby vision') || type.includes('dolbyvision')
    ));
};

const hasHdr10Plus = (video) => !!findSideData(video, (type) => (
    type.includes('hdr10+')
    || type.includes('hdr10plus')
    || type.includes('smpte2094-40')
    || type.includes('smpte 2094-40')
    || type.includes('dynamic metadata smpte2094')
));

const masteringSideData = (video) => findSideData(video, (type) => (
    type.includes('mastering display') || type.includes('mastering_display')
));

const contentLightSideData = (video) => findSideData(video, (type) => (
    type.includes('content light') || type.includes('content_light') || type.includes('maxcll')
));

/**
 * Classify HDR / Dolby Vision from an ffprobe video stream (or full probe).
 */
export const detectHdr = (probeOrVideo) => {
    const video = probeOrVideo?.codec_type === 'video'
        ? probeOrVideo
        : (Array.isArray(probeOrVideo?.streams)
            ? probeOrVideo.streams.find((stream) => stream.codec_type === 'video')
            : probeOrVideo) || null;

    const colorTransfer = lower(video?.color_transfer);
    const colorPrimaries = lower(video?.color_primaries);
    const colorSpace = lower(video?.color_space || video?.colorspace);
    const colorRange = lower(video?.color_range);
    const isDolbyVision = hasDolbyVision(video);
    const isHdr10Plus = !isDolbyVision && hasHdr10Plus(video);
    const isPq = colorTransfer === 'smpte2084';
    const isHlg = colorTransfer === 'arib-std-b67';
    const master = masteringSideData(video);
    const cll = contentLightSideData(video);

    let kind = 'none';
    if (isDolbyVision) kind = 'dolby-vision';
    else if (isHdr10Plus) kind = 'hdr10plus';
    else if (isPq) kind = 'hdr10';
    else if (isHlg) kind = 'hlg';

    const isHdr = kind !== 'none';
    return {
        kind,
        isHdr,
        isDolbyVision,
        isHdr10: kind === 'hdr10' || kind === 'hdr10plus',
        isHlg,
        isHdr10Plus,
        colorTransfer: colorTransfer || null,
        colorPrimaries: colorPrimaries || null,
        colorSpace: colorSpace || null,
        colorRange: colorRange || null,
        masterDisplay: formatMasterDisplay(master),
        maxCll: formatMaxCll(cll),
        dovi: isDolbyVision
            ? {
                profile: Number(findSideData(video, (type) => type.includes('dovi'))?.dv_profile) || null,
                blSignalCompatibilityId: Number(
                    findSideData(video, (type) => type.includes('dovi'))?.dv_bl_signal_compatibility_id,
                ) || null,
            }
            : null,
    };
};

export const pipelineHasVideoTranscode = (steps = []) => (
    (Array.isArray(steps) ? steps : []).some((step) => {
        const mode = lower(step?.mode || step?.type);
        if (mode !== 'transcode') return false;
        return lower(step?.videoCodec || 'h264') !== 'copy';
    })
);

/**
 * Resolve effective HDR policy from global settings + optional pipeline overrides.
 */
export const resolveHdrHandling = ({ settings = {}, pipeline = null, hdr = null } = {}) => {
    const info = hdr && typeof hdr === 'object' ? hdr : { kind: 'none' };
    const dolbyVisionHandling = normalizeHandling(
        pipeline?.dolbyVisionHandling,
        normalizeHandling(settings.dolbyVisionHandling, 'skip'),
    );
    const hdr10Handling = normalizeHandling(
        pipeline?.hdr10Handling,
        normalizeHandling(settings.hdr10Handling, 'preserve'),
    );
    if (info.kind === 'dolby-vision') return { target: 'dolby-vision', handling: dolbyVisionHandling, dolbyVisionHandling, hdr10Handling };
    if (info.kind === 'hdr10' || info.kind === 'hdr10plus' || info.kind === 'hlg') {
        return { target: info.kind, handling: hdr10Handling, dolbyVisionHandling, hdr10Handling };
    }
    return { target: 'none', handling: 'preserve', dolbyVisionHandling, hdr10Handling };
};

/**
 * Should this transcode job be refused because of HDR / Dolby Vision policy?
 */
export const shouldSkipForHdr = ({ hdr, settings, pipeline, steps } = {}) => {
    const info = hdr && typeof hdr === 'object' ? hdr : detectHdr(null);
    if (!info?.isHdr) return null;
    if (!pipelineHasVideoTranscode(steps)) return null;
    const policy = resolveHdrHandling({ settings, pipeline, hdr: info });
    if (policy.handling !== 'skip') return null;
    if (info.isDolbyVision) {
        return {
            reason: 'dolby-vision',
            message: 'Skipped Dolby Vision source: re-encoding drops the DV RPU and usually washes out the image. Remux/copy is still allowed.',
            hdr: info,
            handling: policy.handling,
        };
    }
    return {
        reason: 'hdr-skip',
        message: `Skipped ${info.kind.toUpperCase()} source per HDR handling policy. Remux/copy is still allowed.`,
        hdr: info,
        handling: policy.handling,
    };
};

const colorArgsForHdr = (hdr) => {
    const args = [];
    const primaries = hdr.colorPrimaries || 'bt2020';
    const transfer = hdr.colorTransfer
        || (hdr.kind === 'hlg' ? 'arib-std-b67' : 'smpte2084');
    const space = hdr.colorSpace || 'bt2020nc';
    args.push('-color_primaries', primaries);
    args.push('-color_trc', transfer);
    args.push('-colorspace', space);
    if (hdr.colorRange === 'pc' || hdr.colorRange === 'jpeg') args.push('-color_range', 'pc');
    else args.push('-color_range', 'tv');
    return args;
};

/**
 * Extra ffmpeg args to preserve HDR10/HLG metadata on re-encode.
 * Call after encoder selection; for CPU HEVC may append `-x265-params`.
 */
export const buildHdrPreserveArgs = ({ hdr, adapterName = 'cpu', videoEncoder = '', logicalCodec = 'hevc' } = {}) => {
    if (!hdr?.isHdr || hdr.isDolbyVision) return [];
    const args = colorArgsForHdr(hdr);
    const encoder = lower(videoEncoder);
    if (adapterName === 'cpu' && logicalCodec === 'hevc' && encoder.includes('x265')) {
        const params = ['hdr10-opt=1', 'repeat-headers=1'];
        if (hdr.masterDisplay) params.push(`master-display=${hdr.masterDisplay}`);
        if (hdr.maxCll) params.push(`max-cll=${hdr.maxCll}`);
        args.push('-x265-params', params.join(':'));
    }
    return args;
};

/**
 * Decide whether a transcode step should force 10-bit because of HDR preserve policy.
 */
export const shouldForceTenBitForHdr = ({ hdr, handling } = {}) => {
    if (!hdr?.isHdr || hdr.isDolbyVision) return false;
    return handling === 'preserve';
};

export const normalizeHdrHandlingValue = (value, { allowInherit = false } = {}) => {
    const normalized = lower(value);
    if (allowInherit && (normalized === '' || normalized === 'inherit')) return 'inherit';
    if (HANDLING.includes(normalized) && normalized !== 'inherit') return normalized;
    return allowInherit ? 'inherit' : null;
};

export default {
    detectHdr,
    formatMasterDisplay,
    formatMaxCll,
    resolveHdrHandling,
    shouldSkipForHdr,
    buildHdrPreserveArgs,
    shouldForceTenBitForHdr,
    pipelineHasVideoTranscode,
    normalizeHdrHandlingValue,
};
