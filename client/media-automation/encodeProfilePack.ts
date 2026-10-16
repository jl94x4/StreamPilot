import type { MediaAutomationPipeline, PipelinePresetCategory } from './types';
import { PIPELINE_PRESETS } from './types';

export const PROFILE_PACK_VERSION = 1;

export type EncodeProfilePackPreset = {
    id: string;
    label: string;
    detail: string;
    category: PipelinePresetCategory;
    pipeline: MediaAutomationPipeline;
};

export type EncodeProfilePack = {
    version: number;
    exportedAt: string;
    name: string;
    presets: EncodeProfilePackPreset[];
};

export const buildEncodeProfilePack = (options?: {
    name?: string;
    presetIds?: string[];
}): EncodeProfilePack => {
    const wanted = options?.presetIds?.length
        ? new Set(options.presetIds)
        : null;
    const presets = PIPELINE_PRESETS
        .filter((preset) => !wanted || wanted.has(preset.id))
        .map((preset) => ({
            id: preset.id,
            label: preset.label,
            detail: preset.detail,
            category: preset.category,
            pipeline: {
                ...preset.pipeline,
                name: preset.pipeline.name || preset.label,
                samplePath: '',
            },
        }));
    return {
        version: PROFILE_PACK_VERSION,
        exportedAt: new Date().toISOString(),
        name: options?.name || 'StreamPilot encode profiles',
        presets,
    };
};

export const parseEncodeProfilePack = (raw: unknown): EncodeProfilePack => {
    const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const presetsRaw = Array.isArray(value.presets) ? value.presets : [];
    const presets = presetsRaw
        .map((entry, index) => {
            if (!entry || typeof entry !== 'object') return null;
            const record = entry as Record<string, unknown>;
            const pipeline = record.pipeline && typeof record.pipeline === 'object'
                ? record.pipeline as MediaAutomationPipeline
                : null;
            if (!pipeline || !String(pipeline.name || record.label || '').trim()) return null;
            return {
                id: String(record.id || `imported-${index + 1}`),
                label: String(record.label || pipeline.name),
                detail: String(record.detail || ''),
                category: (['quality', 'remux', 'audio', 'subtitles', 'utility'].includes(String(record.category))
                    ? record.category
                    : 'utility') as PipelinePresetCategory,
                pipeline: {
                    ...pipeline,
                    name: String(pipeline.name || record.label || `Imported ${index + 1}`),
                    enabled: pipeline.enabled !== false,
                    steps: Array.isArray(pipeline.steps) ? pipeline.steps : [],
                },
            } satisfies EncodeProfilePackPreset;
        })
        .filter(Boolean) as EncodeProfilePackPreset[];
    if (!presets.length) throw new Error('Profile pack has no valid pipelines.');
    return {
        version: Number(value.version) || PROFILE_PACK_VERSION,
        exportedAt: String(value.exportedAt || new Date().toISOString()),
        name: String(value.name || 'Imported encode profiles'),
        presets,
    };
};

export const downloadEncodeProfilePack = (pack: EncodeProfilePack) => {
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `media-automation-profiles-v${pack.version}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
};
