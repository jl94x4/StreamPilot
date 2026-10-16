import { probeMedia } from './ffprobe.js';
import { buildFfmpegPlan } from './ffmpeg-plan.js';

export const BUILTIN_PLUGIN_IDS = Object.freeze({
    PROBE_FFPROBE: 'builtin.ffprobe',
    REMUX_FFMPEG: 'builtin.ffmpeg.remux',
    TRANSCODE_FFMPEG: 'builtin.ffmpeg.transcode',
});

export const createMediaPluginRegistry = ({ includeBuiltins = true } = {}) => {
    const plugins = new Map();
    const register = (plugin) => {
        const id = String(plugin?.id || '').trim();
        const type = String(plugin?.type || '').trim();
        if (!id || !type) throw new Error('Plugin id and type are required');
        if (plugins.has(id)) throw new Error(`Plugin already registered: ${id}`);
        plugins.set(id, Object.freeze({ ...plugin, id, type }));
        return plugins.get(id);
    };
    const unregister = (id) => plugins.delete(String(id));
    const get = (id) => plugins.get(String(id)) || null;
    const list = (type) => [...plugins.values()].filter((plugin) => !type || plugin.type === type);

    if (includeBuiltins) {
        register({
            id: BUILTIN_PLUGIN_IDS.PROBE_FFPROBE,
            type: 'probe',
            label: 'FFprobe',
            probe: probeMedia,
        });
        register({
            id: BUILTIN_PLUGIN_IDS.REMUX_FFMPEG,
            type: 'pipeline',
            label: 'FFmpeg Remux',
            plan: (options) => buildFfmpegPlan({
                ...options,
                rule: { ...options.rule, then: { ...(options.rule?.then || options.rule?.action), mode: 'remux' } },
            }),
        });
        register({
            id: BUILTIN_PLUGIN_IDS.TRANSCODE_FFMPEG,
            type: 'pipeline',
            label: 'FFmpeg Transcode',
            plan: (options) => buildFfmpegPlan({
                ...options,
                rule: { ...options.rule, then: { ...(options.rule?.then || options.rule?.action), mode: 'transcode' } },
            }),
        });
    }
    return { register, unregister, get, list };
};

export default createMediaPluginRegistry;
