import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { probeHardwareDevices } from './devices.js';

const runCommand = (command, args, { timeoutMs = 4_000 } = {}) => new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        resolve({ ok: false, stdout, stderr, error: 'timeout' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, stdout, stderr, error: error.message });
    });
    child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, code, stdout, stderr });
    });
});

const coreTimesSnapshot = () => {
    const cpus = os.cpus() || [];
    return cpus.map((cpu, index) => {
        const times = cpu.times || {};
        const total = Object.values(times).reduce((sum, value) => sum + Number(value || 0), 0);
        return {
            index,
            idle: Number(times.idle || 0),
            total,
            model: cpu.model || null,
        };
    });
};

const sumCpuTimes = () => {
    const cores = coreTimesSnapshot();
    let idle = 0;
    let total = 0;
    for (const core of cores) {
        idle += core.idle;
        total += core.total;
    }
    return { idle, total, count: cores.length, cores };
};

let lastCpuSample = null;
let lastCpuCoreSamples = null;
let lastCpuTimes = null;

const sampleCpuUsage = async () => {
    const current = sumCpuTimes();
    if (!lastCpuTimes) {
        lastCpuTimes = current;
        await new Promise((resolve) => setTimeout(resolve, 120));
        return sampleCpuUsage();
    }

    const idleDelta = current.idle - lastCpuTimes.idle;
    const totalDelta = current.total - lastCpuTimes.total;
    let usedPercent = lastCpuSample;
    if (totalDelta > 0) {
        usedPercent = Math.max(0, Math.min(100, (1 - (idleDelta / totalDelta)) * 100));
        lastCpuSample = usedPercent;
    }

    const prevCores = lastCpuTimes.cores || [];
    const cores = current.cores.map((core, index) => {
        const prev = prevCores[index] || prevCores[0] || core;
        const coreIdleDelta = core.idle - prev.idle;
        const coreTotalDelta = core.total - prev.total;
        let coreUsed = lastCpuCoreSamples?.[index]?.usedPercent ?? null;
        if (coreTotalDelta > 0) {
            coreUsed = Math.max(0, Math.min(100, (1 - (coreIdleDelta / coreTotalDelta)) * 100));
        }
        return {
            index: core.index,
            usedPercent: coreUsed,
            model: core.model,
        };
    });
    lastCpuCoreSamples = cores;
    lastCpuTimes = current;

    return {
        usedPercent: usedPercent == null ? null : usedPercent,
        cores,
    };
};

const parseNvidiaSmi = (stdout) => {
    const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
    return lines.map((line, index) => {
        const parts = line.split(',').map((part) => part.trim());
        const [name, util, memUsed, memTotal, temp] = parts;
        return {
            index,
            name: name || `GPU ${index}`,
            utilizationPercent: Number(util),
            memoryUsedMb: Number(memUsed),
            memoryTotalMb: Number(memTotal),
            temperatureC: Number(temp),
            vendor: 'nvidia',
        };
    }).filter((gpu) => Number.isFinite(gpu.utilizationPercent) || gpu.name);
};

const collectNvidiaGpus = async () => {
    const result = await runCommand('nvidia-smi', [
        '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
        '--format=csv,noheader,nounits',
    ]);
    if (!result.ok) {
        return {
            available: false,
            error: result.error || result.stderr?.trim() || 'nvidia-smi unavailable',
            gpus: [],
        };
    }
    const gpus = parseNvidiaSmi(result.stdout);
    return {
        available: gpus.length > 0,
        gpus,
        error: gpus.length ? null : 'No NVIDIA metrics reported',
    };
};

const readSysfsNumber = async (filePath) => {
    try {
        const raw = Number(String(await fs.readFile(filePath, 'utf8')).trim());
        return Number.isFinite(raw) ? raw : null;
    } catch {
        return null;
    }
};

const readSysfsText = async (filePath) => {
    try {
        return String(await fs.readFile(filePath, 'utf8')).trim() || null;
    } catch {
        return null;
    }
};

const walkSysfsNumbers = async (root, { nameRe, maxDepth = 4, limit = 24 } = {}) => {
    const found = [];
    const walk = async (dir, depth) => {
        if (!dir || depth > maxDepth || found.length >= limit) return;
        let entries = [];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (found.length >= limit) return;
            const full = path.posix.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full, depth + 1);
                continue;
            }
            if (!entry.isFile() && !entry.isSymbolicLink()) continue;
            if (!nameRe.test(entry.name)) continue;
            const value = await readSysfsNumber(full);
            if (value == null) continue;
            found.push({ path: full, name: entry.name, value });
        }
    };
    await walk(root, 0);
    return found;
};

const pickFreq = (entries, preferAct = true) => {
    if (!entries.length) return null;
    const ranked = [...entries].sort((a, b) => {
        const score = (entry) => {
            const name = String(entry.name || '');
            if (preferAct && /act|cur/i.test(name)) return 0;
            if (/max|rp0/i.test(name)) return 2;
            return 1;
        };
        return score(a) - score(b) || b.value - a.value;
    });
    const value = ranked[0]?.value;
    return Number.isFinite(value) ? value : null;
};

const resolveIntelCardName = async ({ cardNodes = [], intelNodes = [], vaapiDevice = null } = {}) => {
    for (const node of intelNodes) {
        const base = path.posix.basename(String(node.path || ''));
        if (/^card\d+$/.test(base)) return base;
        try {
            const drmDir = `/sys/class/drm/${base}/device/drm`;
            const entries = await fs.readdir(drmDir);
            const card = entries.find((name) => /^card\d+$/.test(name));
            if (card) return card;
        } catch {
            // keep looking
        }
    }
    for (const node of cardNodes) {
        const base = path.posix.basename(String(node || ''));
        if (/^card\d+$/.test(base)) {
            const vendor = await readSysfsText(`/sys/class/drm/${base}/device/vendor`);
            if (/8086/i.test(String(vendor || ''))) return base;
        }
    }
    const renderBase = path.posix.basename(String(vaapiDevice || 'renderD128'));
    try {
        const entries = await fs.readdir(`/sys/class/drm/${renderBase}/device/drm`);
        const card = entries.find((name) => /^card\d+$/.test(name));
        if (card) return card;
    } catch {
        // ignore
    }
    const firstCard = cardNodes.map((node) => path.posix.basename(String(node || ''))).find((name) => /^card\d+$/.test(name));
    return firstCard || null;
};

const parseIntelGpuTopJson = (stdout) => {
    const text = String(stdout || '').trim();
    if (!text) return null;
    const samples = [];
    // intel_gpu_top -J streams one JSON object per sample (sometimes concatenated).
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{') {
            if (depth === 0) start = i;
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                const chunk = text.slice(start, i + 1);
                try {
                    samples.push(JSON.parse(chunk));
                } catch {
                    // ignore incomplete chunk
                }
                start = -1;
            }
        }
    }
    if (!samples.length) {
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
    // Prefer the latest sample that includes engine busy data.
    for (let i = samples.length - 1; i >= 0; i -= 1) {
        const sample = samples[i];
        if (sample?.engines && typeof sample.engines === 'object' && Object.keys(sample.engines).length) {
            return sample;
        }
    }
    return samples[samples.length - 1];
};

const INTEL_DEVICE_NAMES = Object.freeze({
    '4680': 'Intel UHD Graphics 730',
    '4682': 'Intel UHD Graphics 730',
    '4690': 'Intel UHD Graphics 770',
    '4692': 'Intel UHD Graphics 770',
    '4693': 'Intel UHD Graphics 770',
    '46a6': 'Intel Iris Xe Graphics',
    '46a8': 'Intel Iris Xe Graphics',
    '46aa': 'Intel Iris Xe Graphics',
    '9a49': 'Intel Iris Xe Graphics',
    '9a40': 'Intel Iris Xe Graphics',
    '4c8a': 'Intel UHD Graphics 750',
    '4c8b': 'Intel UHD Graphics 730',
    '9bc5': 'Intel UHD Graphics 630',
    '3e9b': 'Intel UHD Graphics 630',
});

const cleanIntelGpuName = ({ biosLabel, lspciLine, deviceId } = {}) => {
    const id = String(deviceId || '').replace(/^0x/i, '').toLowerCase();
    if (id && INTEL_DEVICE_NAMES[id]) return INTEL_DEVICE_NAMES[id];

    if (lspciLine) {
        // "00:02.0 VGA compatible controller [0300]: Intel Corporation AlderLake-S GT1 [8086:4680] (rev 0c)"
        const named = String(lspciLine).match(/\]:\s*(.+?)\s*\[8086:[0-9a-f]+\]/i);
        if (named?.[1]) {
            return named[1]
                .replace(/^Intel Corporation\s+/i, 'Intel ')
                .replace(/\s+/g, ' ')
                .trim();
        }
    }

    const bios = String(biosLabel || '').trim();
    if (bios && !/^onboard\s*igd$/i.test(bios)) return bios;
    if (id) return `Intel Graphics (${id})`;
    return 'Intel Graphics (iGPU)';
};

const INTEL_GPU_TOP_CANDIDATES = [
    '/usr/bin/intel_gpu_top',
    '/usr/local/bin/intel_gpu_top',
    'intel_gpu_top',
];

const resolveIntelGpuTopBinary = async () => {
    for (const candidate of INTEL_GPU_TOP_CANDIDATES) {
        if (!candidate.startsWith('/')) continue;
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // try next absolute path
        }
    }
    const probe = await runCommand('intel_gpu_top', ['-h'], { timeoutMs: 1_500 });
    if (/ENOENT|not found/i.test(String(probe.error || ''))) return null;
    return 'intel_gpu_top';
};

const collectIntelGpuTop = async (deviceFilter = null) => {
    const binary = await resolveIntelGpuTopBinary();
    if (!binary) {
        return {
            available: false,
            binaryPresent: false,
            error: 'spawn intel_gpu_top ENOENT',
            sample: null,
        };
    }

    const buildArgs = (filter) => {
        const args = ['-J', '-s', '250', '-o', '-'];
        if (filter) args.push('-d', filter);
        return args;
    };

    // Prefer an explicit DRM/PCI filter when known; fall back to default device.
    const filters = deviceFilter ? [deviceFilter, null] : [null];
    let result = null;
    let lastError = 'intel_gpu_top failed (no output)';
    for (const filter of filters) {
        // Need >1 sample period so busy% deltas are meaningful; kill after a few samples.
        result = await runCommand(binary, buildArgs(filter), { timeoutMs: 2_800 });
        if (result.ok || result.stdout?.trim()) break;
        lastError = result.error || result.stderr?.trim() || lastError;
        result = null;
    }
    if (!result || (!result.ok && !result.stdout?.trim())) {
        return {
            available: false,
            binaryPresent: true,
            error: lastError,
            sample: null,
        };
    }
    const sample = parseIntelGpuTopJson(result.stdout);
    if (!sample) {
        return {
            available: false,
            binaryPresent: true,
            error: result.stderr?.trim()
                || 'intel_gpu_top returned no usable JSON (needs perf access — try lowering kernel.perf_event_paranoid on the host)',
            sample: null,
        };
    }
    const enginesRaw = sample.engines && typeof sample.engines === 'object' ? sample.engines : {};
    const engines = Object.entries(enginesRaw).map(([name, value]) => {
        const busy = Number(value?.busy);
        return {
            name,
            busyPercent: Number.isFinite(busy) ? Math.max(0, Math.min(100, busy)) : null,
        };
    }).filter((engine) => engine.busyPercent != null);

    const renderBusy = engines
        .filter((engine) => /render|3d/i.test(engine.name))
        .map((engine) => engine.busyPercent);
    const videoBusy = engines
        .filter((engine) => /video/i.test(engine.name))
        .map((engine) => engine.busyPercent);
    const utilizationPercent = renderBusy.length
        ? Math.max(...renderBusy)
        : (engines.length ? Math.max(...engines.map((engine) => engine.busyPercent || 0)) : null);
    const videoUtilizationPercent = videoBusy.length ? Math.max(...videoBusy) : null;
    const frequencyMhz = Number(sample.frequency?.actual ?? sample.frequency?.requested);
    return {
        available: engines.length > 0 || Number.isFinite(utilizationPercent) || Number.isFinite(frequencyMhz),
        binaryPresent: true,
        error: null,
        sample: {
            utilizationPercent: Number.isFinite(utilizationPercent) ? utilizationPercent : null,
            videoUtilizationPercent: Number.isFinite(videoUtilizationPercent) ? videoUtilizationPercent : null,
            frequencyMhz: Number.isFinite(frequencyMhz) ? frequencyMhz : null,
            engines,
        },
    };
};

const collectIntelGpuTemperature = async (deviceRoot = null, cardSysfs = null) => {
    const candidates = [];

    for (const root of [deviceRoot, cardSysfs].filter(Boolean)) {
        try {
            const hwmonRoot = path.posix.join(root, 'hwmon');
            const entries = await fs.readdir(hwmonRoot);
            for (const entry of entries) {
                candidates.push(path.posix.join(hwmonRoot, entry));
            }
        } catch {
            // no per-device hwmon
        }
        try {
            const nested = await walkSysfsNumbers(root, { nameRe: /^temp\d+_input$/, maxDepth: 5, limit: 12 });
            for (const entry of nested) {
                candidates.push(path.posix.dirname(entry.path));
            }
        } catch {
            // ignore
        }
    }

    try {
        const hwmonRoot = '/sys/class/hwmon';
        const entries = await fs.readdir(hwmonRoot);
        for (const entry of entries) {
            candidates.push(path.posix.join(hwmonRoot, entry));
        }
    } catch {
        // ignore
    }

    const unique = [...new Set(candidates)];
    for (const dir of unique) {
        const chip = (await readSysfsText(path.posix.join(dir, 'name'))) || path.posix.basename(dir);
        // Tiger Lake+ often names chips like i915_0000:00:02.0
        if (!/i915|xe/i.test(chip) && !String(dir).includes('/drm/')) continue;
        let files = [];
        try {
            files = await fs.readdir(dir);
        } catch {
            continue;
        }
        for (const file of files) {
            if (!/^temp\d+_input$/.test(file)) continue;
            const temperatureC = await readMilliC(path.posix.join(dir, file));
            if (temperatureC != null) {
                return { temperatureC: Math.round(temperatureC * 10) / 10, chip };
            }
        }
    }
    return { temperatureC: null, chip: null };
};

const collectIntelGpu = async ({ vaapiDevice = '/dev/dri/renderD128', devices = null } = {}) => {
    const dri = devices?.dri || null;
    const intelNodes = (dri?.nodes || []).filter((node) => node?.vendor === 'intel');
    const hasIntel = intelNodes.length > 0 || dri?.vendor === 'intel' || (dri?.vendors || []).includes('intel');
    if (!dri?.present && !hasIntel) {
        return {
            available: false,
            name: null,
            device: null,
            driver: null,
            utilizationPercent: null,
            videoUtilizationPercent: null,
            frequencyMhz: null,
            frequencyMaxMhz: null,
            temperatureC: null,
            engines: [],
            note: '/dev/dri is not mapped into this container.',
            topAvailable: false,
        };
    }
    if (!hasIntel && dri?.present) {
        return {
            available: false,
            name: null,
            device: dri.device || vaapiDevice,
            driver: null,
            utilizationPercent: null,
            videoUtilizationPercent: null,
            frequencyMhz: null,
            frequencyMaxMhz: null,
            temperatureC: null,
            engines: [],
            note: 'No Intel DRM node detected on /dev/dri.',
            topAvailable: false,
        };
    }

    const cardNodes = Array.isArray(dri?.cardNodes) ? dri.cardNodes : [];
    const cardName = await resolveIntelCardName({
        cardNodes,
        intelNodes,
        vaapiDevice,
    });
    const cardSysfs = cardName ? `/sys/class/drm/${cardName}` : null;
    const deviceRoot = cardSysfs ? `${cardSysfs}/device` : null;
    const preferredCard = cardName ? `/dev/dri/${cardName}` : null;

    const driver = deviceRoot
        ? (await readSysfsText(path.posix.join(deviceRoot, 'uevent')))?.match(/DRIVER=(\S+)/)?.[1] || null
        : null;
    const vendorId = deviceRoot ? await readSysfsText(path.posix.join(deviceRoot, 'vendor')) : null;
    const deviceId = deviceRoot ? await readSysfsText(path.posix.join(deviceRoot, 'device')) : null;

    let prettyName = 'Intel Graphics (iGPU)';
    const biosLabel = deviceRoot ? await readSysfsText(path.posix.join(deviceRoot, 'label')) : null;
    const lspci = await runCommand('lspci', ['-nn'], { timeoutMs: 2_000 });
    let lspciLine = null;
    if (lspci.ok && deviceId) {
        const id = String(deviceId).replace(/^0x/i, '').toLowerCase();
        lspciLine = String(lspci.stdout || '')
            .split(/\r?\n/)
            .find((entry) => /vga|display|3d/i.test(entry) && entry.toLowerCase().includes(`[8086:${id}]`))
            || null;
    }
    prettyName = cleanIntelGpuName({
        biosLabel,
        lspciLine,
        deviceId,
    });

    let deviceFilter = null;
    if (preferredCard) {
        deviceFilter = `drm:${preferredCard}`;
    }
    if (deviceRoot) {
        try {
            const real = await fs.realpath(deviceRoot);
            const pci = path.posix.basename(real);
            if (/^[\da-f]+:[\da-f]+\.\d+$/i.test(pci)) {
                deviceFilter = `pci:${pci}`;
            }
        } catch {
            // keep drm filter
        }
    }

    const freqCandidates = [];
    if (cardSysfs) {
        freqCandidates.push(...await walkSysfsNumbers(cardSysfs, { nameRe: /freq.*mhz$|mhz$/i, maxDepth: 5 }));
    }
    if (deviceRoot) {
        freqCandidates.push(...await walkSysfsNumbers(deviceRoot, { nameRe: /freq.*mhz$|mhz$/i, maxDepth: 5 }));
    }
    const actFreqEntries = freqCandidates.filter((entry) => /act|cur/i.test(entry.name) && !/max|rp0|rp1|min|boost/i.test(entry.name));
    const maxFreqEntries = freqCandidates.filter((entry) => /max|rp0/i.test(entry.name));
    const frequencyMhz = pickFreq(actFreqEntries.length ? actFreqEntries : freqCandidates.filter((entry) => !/max|rp0|rp1|min/i.test(entry.name)), true);
    const frequencyMaxMhz = pickFreq(maxFreqEntries, false);

    const [{ temperatureC }, top] = await Promise.all([
        collectIntelGpuTemperature(deviceRoot, cardSysfs),
        collectIntelGpuTop(deviceFilter),
    ]);

    const utilizationPercent = top.sample?.utilizationPercent ?? null;
    const videoUtilizationPercent = top.sample?.videoUtilizationPercent ?? null;
    const engines = top.sample?.engines || [];
    const topFrequency = top.sample?.frequencyMhz ?? null;
    const sysFreq = Number.isFinite(frequencyMhz) && frequencyMhz >= 0 ? frequencyMhz : null;
    const sysFreqMax = Number.isFinite(frequencyMaxMhz) && frequencyMaxMhz > 0 ? frequencyMaxMhz : null;

    let note = null;
    if (!top.available) {
        const missingBin = top.binaryPresent === false
            || /ENOENT|No such file|not found/i.test(String(top.error || ''));
        note = missingBin
            ? 'intel_gpu_top missing from this container image. Unraid template defaults to :latest — set Repository to ghcr.io/jl94x4/server-manager-portal:nightly, then Force Update (not Restart). Encode via /dev/dri still works.'
            : (top.error
                ? `Live util blocked: ${top.error}. Binary is present — on Unraid try host sysctl kernel.perf_event_paranoid=0 (or ≤2) and keep /dev/dri mapped. Encode still works.`
                : 'Live util needs perf access for intel_gpu_top (host perf_event_paranoid). Encode via /dev/dri still works.');
    }

    return {
        available: true,
        name: prettyName,
        device: dri?.device || preferredCard || vaapiDevice,
        driver: driver || 'i915',
        vendorId,
        deviceId,
        utilizationPercent,
        videoUtilizationPercent,
        frequencyMhz: topFrequency ?? sysFreq,
        frequencyMaxMhz: sysFreqMax,
        temperatureC,
        engines,
        note,
        topAvailable: top.available === true,
        topBinaryPresent: top.binaryPresent !== false,
        topError: top.error || null,
    };
};

const readMilliC = async (filePath) => {
    try {
        const raw = Number(String(await fs.readFile(filePath, 'utf8')).trim());
        if (!Number.isFinite(raw)) return null;
        // hwmon/thermal usually report millidegrees; some devices already report °C.
        const celsius = raw > 200 ? raw / 1000 : raw;
        if (!Number.isFinite(celsius) || celsius < 0 || celsius > 150) return null;
        return celsius;
    } catch {
        return null;
    }
};

const SENSOR_PRIORITY = [
    /package|x86_pkg|tctl|tdie|cpu[_ -]?temp|soc/i,
    /core/i,
];

const rankSensorLabel = (label = '') => {
    const text = String(label || '');
    const idx = SENSOR_PRIORITY.findIndex((pattern) => pattern.test(text));
    return idx === -1 ? SENSOR_PRIORITY.length : idx;
};

const collectCpuTemperature = async () => {
    const readings = [];

    try {
        const hwmonRoot = '/sys/class/hwmon';
        const entries = await fs.readdir(hwmonRoot);
        for (const entry of entries) {
            const dir = path.posix.join(hwmonRoot, entry);
            let chip = entry;
            try {
                chip = String(await fs.readFile(path.posix.join(dir, 'name'), 'utf8')).trim() || entry;
            } catch {
                // ignore
            }
            let files = [];
            try {
                files = await fs.readdir(dir);
            } catch {
                continue;
            }
            for (const file of files) {
                const match = /^temp(\d+)_input$/.exec(file);
                if (!match) continue;
                const id = match[1];
                const temperatureC = await readMilliC(path.posix.join(dir, file));
                if (temperatureC == null) continue;
                let label = `temp${id}`;
                try {
                    label = String(await fs.readFile(path.posix.join(dir, `temp${id}_label`), 'utf8')).trim() || label;
                } catch {
                    // ignore
                }
                readings.push({
                    temperatureC,
                    label: `${chip}:${label}`,
                    source: 'hwmon',
                });
            }
        }
    } catch {
        // hwmon unavailable (common on Windows / locked-down containers)
    }

    if (!readings.length) {
        try {
            const thermalRoot = '/sys/class/thermal';
            const entries = await fs.readdir(thermalRoot);
            for (const entry of entries) {
                if (!/^thermal_zone\d+$/.test(entry)) continue;
                const dir = path.posix.join(thermalRoot, entry);
                let type = entry;
                try {
                    type = String(await fs.readFile(path.posix.join(dir, 'type'), 'utf8')).trim() || entry;
                } catch {
                    // ignore
                }
                const temperatureC = await readMilliC(path.posix.join(dir, 'temp'));
                if (temperatureC == null) continue;
                readings.push({
                    temperatureC,
                    label: type,
                    source: 'thermal',
                });
            }
        } catch {
            // thermal sysfs unavailable
        }
    }

    if (!readings.length) {
        return {
            available: false,
            temperatureC: null,
            maxC: null,
            label: null,
            source: null,
            note: 'CPU temperature sensors are not exposed to this container.',
        };
    }

    readings.sort((a, b) => {
        const rankDelta = rankSensorLabel(a.label) - rankSensorLabel(b.label);
        if (rankDelta !== 0) return rankDelta;
        return b.temperatureC - a.temperatureC;
    });
    const best = readings[0];
    const maxC = Math.max(...readings.map((entry) => entry.temperatureC));
    return {
        available: true,
        temperatureC: Math.round(best.temperatureC * 10) / 10,
        maxC: Math.round(maxC * 10) / 10,
        label: best.label,
        source: best.source,
        note: null,
    };
};

/**
 * Host + process resource snapshot for Media Automation System tab.
 */
export const collectHostMetrics = async ({
    vaapiDevice = '/dev/dri/renderD128',
    activeEncodes = { cpu: 0, gpu: 0 },
} = {}) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(0, totalMem - freeMem);
    const proc = process.memoryUsage();
    const load = os.loadavg();
    const cpuSnapshot = sumCpuTimes();
    const [cpuUsage, cpuTemp, nvidia, devices] = await Promise.all([
        sampleCpuUsage(),
        collectCpuTemperature(),
        collectNvidiaGpus(),
        probeHardwareDevices({ vaapiDevice }).catch(() => null),
    ]);
    const intel = await collectIntelGpu({ vaapiDevice, devices });

    const amdPresent = (devices?.dri?.vendors || []).includes('amd') || devices?.dri?.vendor === 'amd';
    const intelOrAmd = {
        available: !!(devices?.dri?.present),
        dri: devices?.dri || null,
        vendors: devices?.dri?.vendors || [],
        note: devices?.dri?.present
            ? (amdPresent && !intel.available
                ? 'AMD GPU detected on /dev/dri. Live AMD util needs host tools (e.g. radeontop).'
                : null)
            : '/dev/dri is not mapped into this container.',
    };

    return {
        at: new Date().toISOString(),
        host: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        uptimeSec: Math.round(os.uptime()),
        process: {
            pid: process.pid,
            rssBytes: proc.rss,
            heapUsedBytes: proc.heapUsed,
            heapTotalBytes: proc.heapTotal,
            externalBytes: proc.external,
        },
        memory: {
            totalBytes: totalMem,
            freeBytes: freeMem,
            usedBytes: usedMem,
            usedPercent: totalMem > 0 ? (usedMem / totalMem) * 100 : null,
        },
        cpu: {
            cores: cpuSnapshot.count,
            model: os.cpus()?.[0]?.model || null,
            load1: load[0],
            load5: load[1],
            load15: load[2],
            usedPercent: cpuUsage?.usedPercent ?? null,
            perCore: cpuUsage?.cores || [],
            temperatureC: cpuTemp?.temperatureC ?? null,
            temperatureMaxC: cpuTemp?.maxC ?? null,
            temperatureLabel: cpuTemp?.label || null,
            temperatureAvailable: cpuTemp?.available === true,
            temperatureNote: cpuTemp?.note || null,
        },
        gpu: {
            nvidia,
            intel,
            intelOrAmd,
            activeEncodes: {
                cpu: Number(activeEncodes.cpu) || 0,
                gpu: Number(activeEncodes.gpu) || 0,
            },
        },
    };
};

export default collectHostMetrics;
