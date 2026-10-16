import { detectHdr } from './hdr.js';

const asList = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const lower = (value) => String(value || '').toLowerCase();

const matchesPattern = (value, pattern) => {
    const source = String(pattern || '');
    if (!source) return true;
    const escaped = source.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(String(value || ''));
};

const includesAny = (values, expected) => {
    const haystack = values.map(lower);
    return asList(expected).some((needle) => haystack.includes(lower(needle)));
};

const conditionValues = (field, context) => {
    if (field === 'path') return [context.relativePath || ''];
    if (field === 'container') return String(context.format?.format_name || '').split(',').filter(Boolean);
    if (field === 'videoCodec') return [context.video?.codec_name || ''];
    if (field === 'audioCodec') return (context.audio || []).map((stream) => stream.codec_name || '');
    if (field === 'width') return [Number(context.video?.width || 0)];
    if (field === 'bitrate') return [Number(context.format?.bit_rate || 0)];
    if (field === 'hdr') return [!!context.isHdr];
    return [];
};

const matchesCondition = (condition, context) => {
    const values = conditionValues(String(condition?.field || ''), context);
    const operator = String(condition?.operator || 'equals');
    const expected = condition?.value;
    if (!values.length) return false;
    if (operator === 'greaterThan') return values.some((value) => Number(value) > Number(expected));
    if (operator === 'lessThan') return values.some((value) => Number(value) < Number(expected));
    if (operator === 'contains') {
        return values.some((value) => lower(value).includes(lower(expected)));
    }
    if (operator === 'matches') return values.some((value) => matchesPattern(value, expected));
    const expectedBoolean = ['true', '1', 'yes'].includes(lower(expected));
    const equal = values.some((value) => (
        typeof value === 'boolean'
            ? value === expectedBoolean
            : lower(value) === lower(expected)
    ));
    return operator === 'notEquals' ? !equal : equal;
};

const matchesConditionGroup = (group, context) => {
    if (!group || typeof group !== 'object') return true;
    const conditions = Array.isArray(group.conditions) ? group.conditions : [];
    if (!conditions.length) return true;
    const results = conditions.map((condition) => matchesCondition(condition, context));
    return String(group.operator || 'AND').toUpperCase() === 'OR'
        ? results.some(Boolean)
        : results.every(Boolean);
};

export const matchMediaRule = (rule, context = {}) => {
    if (!rule || rule.enabled === false) return false;
    if (!matchesConditionGroup(rule.conditionGroup, context)) return false;
    const when = rule.when && typeof rule.when === 'object' ? rule.when : rule.match || {};
    if (when.path && !asList(when.path).some((pattern) => matchesPattern(context.relativePath, pattern))) return false;
    if (when.container && !asList(when.container).map(lower).includes(lower(context.format?.format_name))) return false;
    if (when.videoCodec && !asList(when.videoCodec).map(lower).includes(lower(context.video?.codec_name))) return false;
    if (when.audioCodec && !includesAny(context.audio?.map((stream) => stream.codec_name) || [], when.audioCodec)) return false;
    if (when.minWidth != null && Number(context.video?.width || 0) < Number(when.minWidth)) return false;
    if (when.maxWidth != null && Number(context.video?.width || 0) > Number(when.maxWidth)) return false;
    if (when.minBitrate != null && Number(context.format?.bit_rate || 0) < Number(when.minBitrate)) return false;
    if (when.maxBitrate != null && Number(context.format?.bit_rate || 0) > Number(when.maxBitrate)) return false;
    if (when.hdr != null && !!context.isHdr !== !!when.hdr) return false;
    return true;
};

export const findMatchingRule = (rules = [], context = {}) => (
    [...rules]
        .map((rule, index) => ({ ...rule, _index: index }))
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || a._index - b._index)
        .find((rule) => matchMediaRule(rule, context)) || null
);

export const buildRuleContext = ({ filePath, libraryRoot, probe } = {}) => {
    const streams = Array.isArray(probe?.streams) ? probe.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video') || null;
    const audio = streams.filter((stream) => stream.codec_type === 'audio');
    const hdr = detectHdr(video || probe);
    return {
        filePath,
        libraryRoot,
        relativePath: libraryRoot && filePath ? filePath.slice(libraryRoot.length).replace(/^[\\/]+/, '') : filePath,
        probe,
        format: probe?.format || {},
        video,
        audio,
        subtitles: streams.filter((stream) => stream.codec_type === 'subtitle'),
        // True HDR transfer / Dolby Vision only — plain 10-bit SDR is not HDR.
        isHdr: hdr.isHdr,
        isDolbyVision: hdr.isDolbyVision,
        hdrKind: hdr.kind,
        hdr,
    };
};
