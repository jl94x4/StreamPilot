import fs from 'fs/promises';
import path from 'path';

const CUDA_CANDIDATES = Object.freeze([
    '/usr/lib/x86_64-linux-gnu/libcuda.so.1',
    '/usr/lib64/libcuda.so.1',
    '/usr/lib/libcuda.so.1',
    '/usr/local/nvidia/lib64/libcuda.so.1',
    '/usr/local/nvidia/lib/libcuda.so.1',
]);

/** PCI vendor id → logical GPU family used by adapter preflight. */
const PCI_VENDOR_FAMILY = Object.freeze({
    '0x8086': 'intel',
    '8086': 'intel',
    '0x1002': 'amd',
    '1002': 'amd',
    '0x10de': 'nvidia',
    '10de': 'nvidia',
});

const accessible = async (target, mode = fs.constants.R_OK) => {
    try {
        await fs.access(target, mode);
        return true;
    } catch {
        return false;
    }
};

const exists = async (target) => {
    try {
        await fs.stat(target);
        return true;
    } catch {
        return false;
    }
};

const normalizeVendorId = (raw) => {
    const text = String(raw || '').trim().toLowerCase();
    if (!text) return null;
    if (/^0x[0-9a-f]+$/.test(text)) return text;
    if (/^[0-9a-f]+$/.test(text)) return `0x${text}`;
    return null;
};

const familyForVendorId = (vendorId) => {
    const normalized = normalizeVendorId(vendorId);
    if (!normalized) return null;
    return PCI_VENDOR_FAMILY[normalized] || PCI_VENDOR_FAMILY[normalized.replace(/^0x/, '')] || null;
};

const readFileTrimmed = async (target) => {
    try {
        return String(await fs.readFile(target, 'utf8')).trim();
    } catch {
        return null;
    }
};

/** Resolve PCI vendor for a DRM render/card node via sysfs. */
export const probeDrmNodeVendor = async (devicePath) => {
    const node = path.posix.basename(String(devicePath || ''));
    if (!node) {
        return { path: String(devicePath || ''), vendorId: null, vendor: null };
    }
    const vendorFiles = [
        `/sys/class/drm/${node}/device/vendor`,
        `/sys/class/drm/${node}/device/device/vendor`,
    ];
    for (const file of vendorFiles) {
        const vendorId = normalizeVendorId(await readFileTrimmed(file));
        if (vendorId) {
            return { path: String(devicePath), vendorId, vendor: familyForVendorId(vendorId) };
        }
    }
    const ueventFiles = [
        `/sys/class/drm/${node}/device/uevent`,
        `/sys/class/drm/${node}/device/device/uevent`,
    ];
    for (const file of ueventFiles) {
        const uevent = await readFileTrimmed(file);
        if (!uevent) continue;
        const pciId = uevent.match(/(?:^|\n)PCI_ID=([0-9a-fA-F]+):/i)?.[1];
        const vendorId = normalizeVendorId(pciId);
        if (vendorId) {
            return { path: String(devicePath), vendorId, vendor: familyForVendorId(vendorId) };
        }
    }
    return { path: String(devicePath), vendorId: null, vendor: null };
};

/** Probe host GPU device visibility inside the container (Intel/AMD /dev/dri + NVIDIA). */
export const probeHardwareDevices = async ({
    vaapiDevice = '/dev/dri/renderD128',
} = {}) => {
    const configured = String(vaapiDevice || '/dev/dri/renderD128').trim() || '/dev/dri/renderD128';
    let renderNodes = [];
    let cardNodes = [];
    let driPresent = false;
    try {
        const entries = await fs.readdir('/dev/dri');
        driPresent = true;
        renderNodes = entries
            .filter((name) => /^renderD\d+$/.test(name))
            .map((name) => path.posix.join('/dev/dri', name))
            .sort();
        cardNodes = entries
            .filter((name) => /^card\d+$/.test(name))
            .map((name) => path.posix.join('/dev/dri', name))
            .sort();
    } catch {
        driPresent = false;
    }

    const deviceExists = await exists(configured);
    const deviceReadable = deviceExists ? await accessible(configured, fs.constants.R_OK) : false;

    const probePaths = [...new Set([configured, ...renderNodes, ...cardNodes].filter(Boolean))];
    const nodes = [];
    for (const devicePath of probePaths) {
        nodes.push(await probeDrmNodeVendor(devicePath));
    }
    const vendors = [...new Set(nodes.map((node) => node.vendor).filter(Boolean))];
    const configuredNode = nodes.find((node) => node.path === configured) || null;

    let cudaLib = null;
    for (const candidate of CUDA_CANDIDATES) {
        if (await accessible(candidate)) {
            cudaLib = candidate;
            break;
        }
    }

    return {
        dri: {
            present: driPresent,
            renderNodes,
            cardNodes,
            device: configured,
            exists: deviceExists,
            readable: deviceReadable,
            nodes,
            vendors,
            vendor: configuredNode?.vendor || vendors[0] || null,
            vendorId: configuredNode?.vendorId || null,
        },
        nvidia: {
            device: await exists('/dev/nvidia0'),
            cudaLib,
            visibleDevices: process.env.NVIDIA_VISIBLE_DEVICES || null,
            driverCapabilities: process.env.NVIDIA_DRIVER_CAPABILITIES || null,
            runtimeHint: process.env.NVIDIA_VISIBLE_DEVICES
                ? null
                : 'Set NVIDIA_VISIBLE_DEVICES and --runtime=nvidia for NVENC',
        },
    };
};

export default probeHardwareDevices;
