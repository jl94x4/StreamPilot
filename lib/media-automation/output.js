import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { probeMedia } from './ffprobe.js';

const temporaryFor = (target) => {
    const parsed = path.parse(target);
    return path.join(
        parsed.dir,
        `.${parsed.name}.${process.pid}.${crypto.randomUUID()}.partial${parsed.ext}`,
    );
};

export const mediaDuration = (metadata) => {
    const formatDuration = Number(metadata?.format?.duration);
    if (Number.isFinite(formatDuration) && formatDuration > 0) return formatDuration;
    const durations = (metadata?.streams || [])
        .map((stream) => Number(stream.duration))
        .filter((duration) => Number.isFinite(duration) && duration > 0);
    return durations.length ? Math.max(...durations) : null;
};

const streamCounts = (metadata) => {
    const counts = { video: 0, audio: 0, subtitle: 0 };
    for (const stream of metadata?.streams || []) {
        if (Object.hasOwn(counts, stream.codec_type)) counts[stream.codec_type] += 1;
    }
    return counts;
};

export const captureSourceFileMetadata = async (filePath) => {
    const stat = await fs.stat(filePath);
    return {
        mode: stat.mode,
        size: Number(stat.size) || 0,
        atime: stat.atime.toISOString(),
        mtime: stat.mtime.toISOString(),
    };
};

const preserveFileMetadata = async (filePath, stat, { preserveTimes = true } = {}) => {
    const warnings = [];
    try {
        await fs.chmod(filePath, stat.mode);
    } catch (error) {
        warnings.push({ operation: 'chmod', code: error.code, message: error.message });
    }
    if (preserveTimes) {
        try {
            await fs.utimes(filePath, new Date(stat.atime), new Date(stat.mtime));
        } catch (error) {
            warnings.push({ operation: 'utimes', code: error.code, message: error.message });
        }
    }
    return warnings;
};

/** Rename, or copy+unlink when crossing devices (SSD staging → HDD library). */
export const promoteFile = async (from, to, { renameFile = fs.rename } = {}) => {
    try {
        await renameFile(from, to);
        return { method: 'rename' };
    } catch (error) {
        if (error?.code !== 'EXDEV') throw error;
        await fs.copyFile(from, to);
        await fs.unlink(from);
        return { method: 'copy' };
    }
};

const createRollbackFile = async (sourcePath) => {
    const rollbackPath = temporaryFor(`${sourcePath}.rollback`);
    try {
        await fs.link(sourcePath, rollbackPath);
    } catch {
        await fs.copyFile(sourcePath, rollbackPath, constants.COPYFILE_EXCL);
        const stat = await fs.stat(sourcePath);
        await preserveFileMetadata(rollbackPath, stat);
    }
    return rollbackPath;
};

export const prepareMediaOutput = ({
    sourcePath,
    mode = 'replace',
    extension = '.mkv',
    copyDestination = '',
    workDir = '',
} = {}) => {
    if (!sourcePath) throw new Error('sourcePath is required');
    const normalizedMode = String(mode).toLowerCase();
    if (!['replace', 'copy', 'dry-run'].includes(normalizedMode)) throw new Error(`Unknown output mode: ${mode}`);
    const source = path.resolve(sourcePath);
    const parsed = path.parse(source);
    const normalizedExtension = String(extension || parsed.ext || '.mkv').startsWith('.')
        ? String(extension || parsed.ext || '.mkv')
        : `.${extension}`;
    let finalPath;
    if (normalizedMode === 'copy') {
        finalPath = path.resolve(copyDestination || path.join(parsed.dir, `${parsed.name}.automated${normalizedExtension}`));
    } else if (normalizedMode === 'replace') {
        finalPath = path.join(parsed.dir, `${parsed.name}${normalizedExtension}`);
    } else {
        finalPath = source;
    }
    const stagingRoot = String(workDir || '').trim();
    const workAnchor = stagingRoot && normalizedMode !== 'dry-run'
        ? path.join(path.resolve(stagingRoot), path.basename(finalPath))
        : (normalizedMode === 'dry-run' ? source : finalPath);
    return {
        mode: normalizedMode,
        sourcePath: source,
        finalPath,
        workPath: temporaryFor(workAnchor),
        workDir: stagingRoot ? path.resolve(stagingRoot) : null,
    };
};

export const verifyMediaOutput = async (filePath, {
    minimumBytes = 1024,
    ffprobePath = 'ffprobe',
    probe = probeMedia,
    signal,
    sourceMetadata,
    expectedStreamCounts,
    durationToleranceSeconds = 2,
    durationToleranceRatio = 0.02,
} = {}) => {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size < minimumBytes) {
        throw Object.assign(new Error(`Output is too small (${stat.size} bytes)`), { code: 'INVALID_OUTPUT_SIZE' });
    }
    const metadata = await probe(filePath, { ffprobePath, signal });
    if (!metadata.streams.some((stream) => stream.codec_type === 'video')) {
        throw Object.assign(new Error('Output contains no video stream'), { code: 'INVALID_OUTPUT_STREAMS' });
    }
    let parity = null;
    if (sourceMetadata) {
        const sourceDuration = mediaDuration(sourceMetadata);
        const outputDuration = mediaDuration(metadata);
        if (sourceDuration != null && outputDuration == null) {
            throw Object.assign(new Error('Output duration is unavailable'), { code: 'OUTPUT_DURATION_MISSING' });
        }
        const durationDelta = sourceDuration == null ? null : Math.abs(outputDuration - sourceDuration);
        const allowedDelta = sourceDuration == null
            ? null
            : Math.max(Number(durationToleranceSeconds) || 0, sourceDuration * (Number(durationToleranceRatio) || 0));
        if (durationDelta != null && durationDelta > allowedDelta) {
            throw Object.assign(
                new Error(`Output duration differs by ${durationDelta.toFixed(3)}s (allowed ${allowedDelta.toFixed(3)}s)`),
                { code: 'OUTPUT_DURATION_MISMATCH', sourceDuration, outputDuration, durationDelta, allowedDelta },
            );
        }
        const sourceCounts = streamCounts(sourceMetadata);
        const outputCounts = streamCounts(metadata);
        const expectedCounts = { ...sourceCounts, ...(expectedStreamCounts || {}) };
        for (const type of Object.keys(expectedCounts)) {
            if (outputCounts[type] !== expectedCounts[type]) {
                throw Object.assign(
                    new Error(`Output ${type} stream count is ${outputCounts[type]}; expected ${expectedCounts[type]}`),
                    { code: 'OUTPUT_STREAM_MISMATCH', streamType: type, expected: expectedCounts[type], actual: outputCounts[type] },
                );
            }
        }
        parity = {
            sourceDuration,
            outputDuration,
            durationDelta,
            allowedDelta,
            sourceCounts,
            outputCounts,
            expectedCounts,
        };
    }
    return { size: stat.size, metadata, parity };
};

const quarantineCopy = async (sourcePath, quarantineDir, sourceStat) => {
    if (!quarantineDir) return null;
    await fs.mkdir(quarantineDir, { recursive: true });
    const parsed = path.parse(sourcePath);
    const target = path.join(
        quarantineDir,
        `${parsed.name}.${new Date().toISOString().replace(/[:.]/g, '-')}.${crypto.randomUUID()}${parsed.ext}`,
    );
    await fs.copyFile(sourcePath, target, constants.COPYFILE_EXCL);
    await preserveFileMetadata(target, sourceStat);
    return target;
};

export const finalizeMediaOutput = async (prepared, {
    dryRun = false,
    quarantineDir = '',
    verify = true,
    minimumBytes = 1024,
    ffprobePath = 'ffprobe',
    probe = probeMedia,
    signal,
    sourceMetadata,
    expectedStreamCounts,
    durationToleranceSeconds,
    durationToleranceRatio,
    renameFile = fs.rename,
    sourceFileMetadata,
} = {}) => {
    if (!prepared?.workPath) throw new Error('Prepared output is required');
    if (dryRun || prepared.mode === 'dry-run') {
        await fs.rm(prepared.workPath, { force: true }).catch(() => {});
        return { dryRun: true, changed: false, finalPath: prepared.finalPath };
    }
    const verification = verify
        ? await verifyMediaOutput(prepared.workPath, {
            minimumBytes,
            ffprobePath,
            probe,
            signal,
            sourceMetadata,
            expectedStreamCounts,
            durationToleranceSeconds,
            durationToleranceRatio,
        })
        : null;
    await fs.mkdir(path.dirname(prepared.finalPath), { recursive: true });
    const sourceStat = prepared.mode === 'replace'
        ? (sourceFileMetadata || await captureSourceFileMetadata(prepared.sourcePath))
        : null;
    // Staging (SSD → library): keep the encode's fresh mtime so Plex notices a change.
    const stagedWork = path.resolve(path.dirname(prepared.workPath)) !== path.resolve(path.dirname(prepared.finalPath));
    const preservationWarnings = sourceStat
        ? await preserveFileMetadata(prepared.workPath, sourceStat, { preserveTimes: !stagedWork })
        : [];
    if (sourceStat && prepared.finalPath !== prepared.sourcePath) {
        const targetExists = await fs.stat(prepared.finalPath).then(() => true, () => false);
        if (targetExists) {
            throw Object.assign(new Error('Replacement target already exists'), {
                code: 'REPLACEMENT_TARGET_EXISTS',
                finalPath: prepared.finalPath,
            });
        }
    }
    const quarantinedPath = sourceStat
        ? await quarantineCopy(prepared.sourcePath, quarantineDir, sourceStat)
        : null;
    const rollbackPath = sourceStat ? await createRollbackFile(prepared.sourcePath) : null;
    try {
        await promoteFile(prepared.workPath, prepared.finalPath, { renameFile });
        if (sourceStat && prepared.finalPath !== prepared.sourcePath) {
            await fs.rm(prepared.sourcePath);
        }
    } catch (error) {
        let rollback = 'not-needed';
        if (rollbackPath) {
            if (prepared.finalPath !== prepared.sourcePath) {
                await fs.rm(prepared.finalPath, { force: true }).catch(() => {});
            }
            const sourceExists = await fs.stat(prepared.sourcePath).then(() => true, () => false);
            if (sourceExists) {
                await fs.rm(rollbackPath, { force: true }).catch(() => {});
            } else {
                try {
                    await fs.rename(rollbackPath, prepared.sourcePath);
                    rollback = 'restored';
                } catch (rollbackError) {
                    rollback = 'failed';
                    error.rollbackError = rollbackError;
                    error.rollbackPath = rollbackPath;
                }
            }
        }
        error.finalizationCode = 'FINAL_RENAME_FAILED';
        error.code ||= 'FINAL_RENAME_FAILED';
        error.rollback = rollback;
        error.quarantinedPath = quarantinedPath;
        throw error;
    }
    if (rollbackPath) await fs.rm(rollbackPath, { force: true }).catch(() => {});
    return {
        dryRun: false,
        changed: true,
        finalPath: prepared.finalPath,
        quarantinedPath,
        verification,
        preservationWarnings,
    };
};

export const discardMediaOutput = async (prepared) => {
    if (prepared?.workPath) await fs.rm(prepared.workPath, { force: true }).catch(() => {});
};
