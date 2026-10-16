import { spawnCommand } from './spawn.js';

export const probeMedia = async (filePath, {
    ffprobePath = 'ffprobe',
    signal,
    timeoutMs = 60_000,
    runner = spawnCommand,
} = {}) => {
    const args = [
        '-v', 'error',
        '-show_format',
        '-show_streams',
        '-show_chapters',
        '-of', 'json',
        '--',
        String(filePath),
    ];
    const result = await runner(ffprobePath, args, { signal, timeoutMs });
    let probe;
    try {
        probe = JSON.parse(result.stdout);
    } catch {
        throw Object.assign(new Error('FFprobe returned invalid JSON'), {
            code: 'INVALID_FFPROBE_OUTPUT',
            stderr: result.stderr,
        });
    }
    if (!probe || !Array.isArray(probe.streams) || !probe.format) {
        throw Object.assign(new Error('FFprobe output is missing media metadata'), { code: 'INCOMPLETE_FFPROBE_OUTPUT' });
    }
    return probe;
};

export default probeMedia;
