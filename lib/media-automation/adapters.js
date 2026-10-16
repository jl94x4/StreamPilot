import { spawnCommand } from './spawn.js';
import { probeHardwareDevices } from './devices.js';

/** Fixed ABR target in kbps; when set, adapters emit -b:v instead of CRF/CQ/QP. */
export const normalizeVideoBitrateKbps = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(100_000, Math.max(100, Math.round(number)));
};

const bitrateOutputArgs = (videoBitrateKbps) => {
    const kbps = normalizeVideoBitrateKbps(videoBitrateKbps);
    if (!kbps) return null;
    const rate = `${kbps}k`;
    return ['-b:v', rate, '-maxrate', rate, '-bufsize', `${kbps * 2}k`];
};

const adapter = (name, label, encoderDefinitions, {
    inputArgs = () => [],
    outputArgs = () => [],
    syntheticArgs = () => [],
    filter = () => null,
} = {}) => {
    const encoderCandidates = Object.fromEntries(
        Object.entries(encoderDefinitions).map(([codec, values]) => [codec, Array.isArray(values) ? values : [values]]),
    );
    const encoders = Object.fromEntries(
        Object.entries(encoderCandidates).map(([codec, values]) => [codec, values[0]]),
    );
    return Object.freeze({
        name,
        label,
        encoders: Object.freeze(encoders),
        encoderCandidates: Object.freeze(encoderCandidates),
        videoEncoder: encoders.h264,
        inputArgs,
        outputArgs,
        syntheticArgs,
        filter,
    });
};

export const CPU_ADAPTER = adapter('cpu', 'CPU', {
    h264: 'libx264',
    hevc: 'libx265',
    av1: ['libsvtav1', 'libaom-av1', 'librav1e'],
}, {
    outputArgs: ({ codec, preset, crf, videoBitrateKbps }) => {
        const bitrateArgs = bitrateOutputArgs(videoBitrateKbps);
        if (codec === 'av1') {
            if (bitrateArgs) return ['-preset', '8', ...bitrateArgs];
            const quality = Number.isFinite(Number(crf)) ? Math.min(51, Math.max(0, Math.round(Number(crf)))) : 28;
            return ['-preset', '8', '-crf', String(quality)];
        }
        const selected = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']
            .includes(String(preset || '').toLowerCase())
            ? String(preset).toLowerCase()
            : 'medium';
        if (bitrateArgs) return ['-preset', selected, ...bitrateArgs];
        const quality = Number.isFinite(Number(crf)) ? Math.min(51, Math.max(0, Math.round(Number(crf)))) : 20;
        return ['-preset', selected, '-crf', String(quality)];
    },
    filter: ({ maxWidth }) => maxWidth ? `scale=w='min(iw,${maxWidth})':h=-2` : null,
});
export const NVENC_ADAPTER = adapter('nvenc', 'NVIDIA NVENC', {
    h264: 'h264_nvenc',
    hevc: 'hevc_nvenc',
    av1: 'av1_nvenc',
}, {
    outputArgs: ({ preset, crf, videoBitrateKbps }) => {
        const normalized = String(preset || '').toLowerCase();
        const selected = /^p[1-7]$/.test(normalized)
            ? normalized
            : ({ fast: 'p3', medium: 'p5', slow: 'p7' }[normalized] || 'p5');
        const bitrateArgs = bitrateOutputArgs(videoBitrateKbps);
        if (bitrateArgs) return ['-preset', selected, '-rc', 'cbr', ...bitrateArgs];
        const quality = Number.isFinite(Number(crf)) ? Math.min(51, Math.max(0, Math.round(Number(crf)))) : 20;
        return ['-preset', selected, '-cq', String(quality)];
    },
    filter: ({ maxWidth }) => maxWidth ? `scale=w='min(iw,${maxWidth})':h=-2` : null,
});
const qsvDeviceArgs = ({ device } = {}) => {
    const render = String(device || '/dev/dri/renderD128');
    // Modern FFmpeg: derive QSV from a VAAPI child device on the render node.
    return [
        '-init_hw_device', `vaapi=va:${render}`,
        '-init_hw_device', 'qsv=hw@va',
        '-filter_hw_device', 'hw',
    ];
};

const qsvDirectDeviceArgs = ({ device } = {}) => {
    const render = String(device || '/dev/dri/renderD128');
    return [
        '-init_hw_device', `qsv=hw:${render}`,
        '-filter_hw_device', 'hw',
    ];
};

const driVendors = (probed) => {
    const listed = Array.isArray(probed?.dri?.vendors) ? probed.dri.vendors : [];
    if (listed.length) return listed.map(String);
    return probed?.dri?.vendor ? [String(probed.dri.vendor)] : [];
};

export const QSV_ADAPTER = adapter('qsv', 'Intel QSV', {
    h264: 'h264_qsv',
    hevc: 'hevc_qsv',
    av1: 'av1_qsv',
}, {
    inputArgs: qsvDeviceArgs,
    outputArgs: ({ preset, crf, videoBitrateKbps }) => {
        const normalized = String(preset || '').toLowerCase();
        const selected = ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'].includes(normalized)
            ? normalized
            : 'medium';
        const bitrateArgs = bitrateOutputArgs(videoBitrateKbps);
        if (bitrateArgs) return ['-preset', selected, ...bitrateArgs];
        const quality = Number.isFinite(Number(crf)) ? Math.min(51, Math.max(0, Math.round(Number(crf)))) : 20;
        return ['-preset', selected, '-global_quality', String(quality)];
    },
    syntheticArgs: qsvDeviceArgs,
    // QSV encode requires NV12 (or P010 for 10-bit) software frames uploaded into
    // the qsv frame context.
    filter: ({ maxWidth, tenBit } = {}) => {
        const parts = [`format=${tenBit ? 'p010' : 'nv12'}`, 'hwupload=extra_hw_frames=64', 'format=qsv'];
        const width = Number(maxWidth);
        if (Number.isFinite(width) && width > 0) {
            parts.push(`scale_qsv=w=${Math.max(2, Math.round(width / 2) * 2)}:h=-2`);
        }
        return parts.join(',');
    },
});
const vaapiImpl = {
    inputArgs: ({ device }) => [
        '-init_hw_device', `vaapi=va:${device || '/dev/dri/renderD128'}`,
        '-filter_hw_device', 'va',
    ],
    outputArgs: ({ crf, videoBitrateKbps }) => {
        const bitrateArgs = bitrateOutputArgs(videoBitrateKbps);
        if (bitrateArgs) return bitrateArgs;
        const quality = Number.isFinite(Number(crf)) ? Math.min(51, Math.max(0, Math.round(Number(crf)))) : 20;
        return ['-qp', String(quality)];
    },
    syntheticArgs: ({ device }) => [
        '-init_hw_device', `vaapi=va:${device || '/dev/dri/renderD128'}`,
        '-filter_hw_device', 'va',
    ],
    filter: ({ maxWidth, tenBit } = {}) => {
        const parts = [`format=${tenBit ? 'p010' : 'nv12'}`, 'hwupload'];
        const width = Number(maxWidth);
        if (Number.isFinite(width) && width > 0) {
            parts.push(`scale_vaapi=w=${Math.max(2, Math.round(width / 2) * 2)}:h=-2`);
        }
        return parts.join(',');
    },
};

export const INTEL_VAAPI_ADAPTER = adapter('intel-vaapi', 'Intel VAAPI', {
    h264: 'h264_vaapi',
    hevc: 'hevc_vaapi',
    av1: 'av1_vaapi',
}, vaapiImpl);

export const VAAPI_ADAPTER = adapter('vaapi', 'AMD VAAPI', {
    h264: 'h264_vaapi',
    hevc: 'hevc_vaapi',
    av1: 'av1_vaapi',
}, vaapiImpl);

export const MEDIA_ADAPTERS = Object.freeze({
    cpu: CPU_ADAPTER,
    nvenc: NVENC_ADAPTER,
    qsv: QSV_ADAPTER,
    'intel-vaapi': INTEL_VAAPI_ADAPTER,
    vaapi: VAAPI_ADAPTER,
});

const encoderAvailable = (output, encoder) => new RegExp(`\\b${encoder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(output);

export const resolveAdapterEncoder = (selected, codec = 'h264', capabilities = {}) => {
    const logical = String(codec || 'h264').toLowerCase();
    if (!['h264', 'hevc', 'av1'].includes(logical)) throw new Error(`Unsupported logical video codec: ${logical}`);
    const candidates = selected?.encoderCandidates?.[logical] || [];
    const advertised = capabilities?.details?.[selected?.name]?.encoders || [];
    const encoder = advertised.length
        ? candidates.find((candidate) => advertised.includes(candidate))
        : candidates[0];
    if (!encoder) {
        throw new Error(`${selected?.label || selected?.name} does not support ${logical.toUpperCase()}`);
    }
    return encoder;
};

const formatSyntheticError = (error) => {
    const stderr = String(error?.stderr || error?.message || error || 'synthetic encode failed').trim();
    return stderr.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ') || 'synthetic encode failed';
};

const buildSyntheticAttempts = (selected, { device, codec } = {}) => {
    const encoder = selected.encoders[codec];
    const filter = selected.filter({ synthetic: true, maxWidth: 0 });
    // QSV/VAAPI reject tiny lavfi sizes (e.g. 64x64). Use a standard progressive frame.
    const source = selected.name === 'cpu'
        ? 'color=c=black:s=64x64:r=1'
        : 'color=c=black:s=1280x720:r=25';
    const baseTail = [
        '-f', 'lavfi', '-i', source,
        '-frames:v', selected.name === 'qsv' ? '30' : '1',
        ...(filter ? ['-vf', filter] : []),
        '-c:v', encoder,
        ...(selected.name === 'qsv' ? ['-global_quality', '20'] : []),
        '-f', 'null', '-',
    ];
    if (selected.name !== 'qsv') {
        return [[
            '-hide_banner', '-loglevel', 'error',
            ...selected.syntheticArgs({ device }),
            ...baseTail,
        ]];
    }
    // Try VAAPI-child QSV first (canonical encode path), then direct render-node QSV.
    return [
        ['-hide_banner', '-loglevel', 'error', ...qsvDeviceArgs({ device }), ...baseTail],
        ['-hide_banner', '-loglevel', 'error', ...qsvDirectDeviceArgs({ device }), ...baseTail],
    ];
};

export const runSyntheticHardwareTest = async (selected, {
    ffmpegPath = 'ffmpeg',
    runner = spawnCommand,
    timeoutMs = 30_000,
    device,
    codec = 'h264',
} = {}) => {
    const encoder = selected.encoders[codec];
    if (!encoder) return { ok: false, error: `No ${codec} encoder on ${selected.name}` };
    const attempts = buildSyntheticAttempts(selected, { device, codec });
    let lastError = 'synthetic encode failed';
    for (const args of attempts) {
        try {
            await runner(ffmpegPath, args, { timeoutMs });
            return { ok: true };
        } catch (error) {
            lastError = formatSyntheticError(error);
        }
    }
    return { ok: false, error: lastError };
};

export const detectFfmpegCapabilities = async ({
    ffmpegPath = 'ffmpeg',
    runner = spawnCommand,
    syntheticOutput,
    testAdapter,
    runSyntheticTests = syntheticOutput == null,
    vaapiDevice = '/dev/dri/renderD128',
    timeoutMs = 30_000,
    devices,
} = {}) => {
    const listing = syntheticOutput == null
        ? await runner(ffmpegPath, ['-hide_banner', '-encoders'], { timeoutMs })
        : { stdout: String(syntheticOutput), stderr: '' };
    const output = `${listing.stdout || ''}\n${listing.stderr || ''}`;
    const probed = devices || (syntheticOutput == null
        ? await probeHardwareDevices({ vaapiDevice })
        : null);
    const capabilities = { details: {}, devices: probed };

    const preflightError = (name) => {
        if (!probed) return null;
        if (['qsv', 'intel-vaapi', 'vaapi'].includes(name)) {
            if (!probed.dri?.present) {
                return `${probed.dri?.device || '/dev/dri'} is not mapped into this container — add Unraid Device Host/Container /dev/dri (Intel/AMD GPU), then Test worker`;
            }
            if (!probed.dri?.exists) {
                const nodes = (probed.dri.renderNodes || []).join(', ') || 'none';
                return `Configured device ${probed.dri.device} is missing (render nodes: ${nodes})`;
            }
            if (!probed.dri?.readable) {
                return `Cannot read ${probed.dri.device} as PUID — check render/video group access (entrypoint should attach /dev/dri GIDs)`;
            }
            const vendors = driVendors(probed);
            const known = vendors.length > 0;
            if ((name === 'qsv' || name === 'intel-vaapi') && known && !vendors.includes('intel')) {
                return `No Intel GPU on ${probed.dri.device} (detected: ${vendors.join(', ')}) — use AMD VAAPI for this host`;
            }
            // AMD VAAPI shares h264_vaapi with Intel; require an AMD PCI vendor so Intel-only hosts do not light both.
            if (name === 'vaapi' && (known ? !vendors.includes('amd') : true)) {
                if (vendors.includes('intel')) {
                    return 'No AMD GPU detected (Intel GPU present) — use Intel VAAPI or QSV';
                }
                return 'No AMD GPU detected on /dev/dri — AMD VAAPI stays off until an AMD render node is present';
            }
        }
        if (name === 'nvenc') {
            if (!probed.nvidia?.device && !probed.nvidia?.visibleDevices) {
                return 'NVIDIA device not visible — set NVIDIA_VISIBLE_DEVICES and Extra Parameters --runtime=nvidia (leave blank if using Intel QSV only)';
            }
            if (!probed.nvidia?.cudaLib) {
                return 'libcuda.so.1 not found in container — need Unraid Nvidia Driver + --runtime=nvidia and NVIDIA_DRIVER_CAPABILITIES=all (or video,compute,utility)';
            }
        }
        return null;
    };

    for (const [name, selected] of Object.entries(MEDIA_ADAPTERS)) {
        const encoders = Object.values(selected.encoderCandidates)
            .flat()
            .filter((encoder) => encoderAvailable(output, encoder));
        let available = encoders.length > 0;
        let testError = null;
        const blocked = available && name !== 'cpu' ? preflightError(name) : null;
        if (blocked) {
            available = false;
            testError = blocked;
        } else if (available && name !== 'cpu' && (runSyntheticTests || typeof testAdapter === 'function')) {
            const tester = testAdapter || ((candidate, context) => {
                const codec = Object.entries(candidate.encoderCandidates)
                    .find(([, candidates]) => candidates.some((encoder) => context.encoders.includes(encoder)))?.[0] || 'h264';
                return runSyntheticHardwareTest(candidate, {
                    ffmpegPath,
                    runner,
                    timeoutMs,
                    device: vaapiDevice,
                    codec,
                });
            });
            const result = await tester(selected, { encoders, ffmpegPath, runner, timeoutMs, vaapiDevice });
            if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
                available = !!result.ok;
                testError = result.ok ? null : String(result.error || 'synthetic encode failed');
            } else {
                available = !!result;
            }
        }
        capabilities[name] = available;
        capabilities.details[name] = {
            label: selected.label,
            encoders,
            syntheticTested: name !== 'cpu' && runSyntheticTests && !blocked,
            ...(testError ? { error: testError } : {}),
        };
    }
    return capabilities;
};

export const selectMediaAdapter = (preference = 'auto', capabilities = {}, codec = 'h264') => {
    const requested = String(preference || 'auto').toLowerCase();
    const logicalCodec = String(codec || 'h264').toLowerCase();
    const detected = !!capabilities.details;
    const supportsCodec = (name) => {
        if (!detected) return true;
        const advertised = capabilities.details[name]?.encoders || [];
        return (MEDIA_ADAPTERS[name]?.encoderCandidates?.[logicalCodec] || [])
            .some((encoder) => advertised.includes(encoder));
    };
    if (requested !== 'auto') {
        if (!MEDIA_ADAPTERS[requested]) throw new Error(`Unknown media adapter: ${requested}`);
        if (detected && !capabilities[requested]) throw new Error(`Media adapter is unavailable: ${requested}`);
        if (!supportsCodec(requested)) throw new Error(`${MEDIA_ADAPTERS[requested].label} does not support ${logicalCodec.toUpperCase()}`);
        return MEDIA_ADAPTERS[requested];
    }
    for (const name of ['nvenc', 'qsv', 'intel-vaapi', 'vaapi', 'cpu']) {
        if ((capabilities[name] || (!detected && name === 'cpu')) && supportsCodec(name)) return MEDIA_ADAPTERS[name];
    }
    throw new Error('No supported FFmpeg video encoder is available');
};

export const createSyntheticAdapterTest = (availability = {}) => async (selected) => {
    const ok = availability[selected.name] !== false;
    return ok ? { ok: true } : { ok: false, error: `${selected.name} synthetic test disabled` };
};
