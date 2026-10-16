import React, { useMemo, useState } from 'react';
import {
    ArrowRight,
    AudioLines,
    Captions,
    Film,
    Gauge,
    Layers3,
    Package,
    Sparkles,
    Wrench,
    X,
} from 'lucide-react';
import { ModalPortal } from '../shared/ModalPortal';
import { AppAmbientBackground } from '../shared/theme';
import {
    PIPELINE_PRESETS,
    PIPELINE_PRESET_CATEGORY_LABELS,
    type PipelinePresetCategory,
    type MediaAutomationPipeline,
    type MediaAutomationStep,
} from './types';

const CATEGORIES: PipelinePresetCategory[] = ['quality', 'remux', 'audio', 'subtitles', 'utility'];

const CATEGORY_META: Record<PipelinePresetCategory, {
    icon: React.ComponentType<{ className?: string }>;
    blurb: string;
    accent: string;
}> = {
    quality: {
        icon: Gauge,
        blurb: 'Encode for size or fidelity with HEVC profiles.',
        accent: 'from-amber-500/15 via-transparent to-transparent',
    },
    remux: {
        icon: Package,
        blurb: 'Repackage containers without re-encoding video.',
        accent: 'from-sky-500/15 via-transparent to-transparent',
    },
    audio: {
        icon: AudioLines,
        blurb: 'Normalize, downmix, or tidy soundtrack streams.',
        accent: 'from-emerald-500/15 via-transparent to-transparent',
    },
    subtitles: {
        icon: Captions,
        blurb: 'Keep, strip, or extract subtitle tracks.',
        accent: 'from-teal-500/15 via-transparent to-transparent',
    },
    utility: {
        icon: Wrench,
        blurb: 'Housekeeping moves and cleanup helpers.',
        accent: 'from-zinc-400/15 via-transparent to-transparent',
    },
};

type Props = {
    open: boolean;
    onClose: () => void;
    onSelect: (pipeline: MediaAutomationPipeline) => void;
};

const summarizeSteps = (steps: MediaAutomationStep[] = []) => {
    const facts: string[] = [];
    const primary = steps[0];
    if (!primary) return ['Empty pipeline'];

    if (primary.type === 'transcode' || primary.type === 'remux') {
        if (primary.videoCodec) facts.push(String(primary.videoCodec).toUpperCase());
        if (primary.videoBitrateKbps) facts.push(`${primary.videoBitrateKbps} kbps`);
        if (primary.crf != null) facts.push(`CRF ${primary.crf}`);
        if (primary.preset) facts.push(String(primary.preset));
        if (primary.maxWidth) facts.push(`≤${primary.maxWidth}px`);
        if (primary.audioCodec === 'copy') facts.push('audio copy');
        else if (primary.audioCodec) facts.push(`audio ${primary.audioCodec}`);
        if (primary.subtitleCodec === 'copy') facts.push('subs copy');
        else if (primary.subtitleCodec === 'drop') facts.push('drop subs');
    } else if (primary.type === 'move') {
        facts.push('rename / move');
        if (primary.destination) facts.push(primary.destination);
    } else {
        facts.push(primary.type.replace(/-/g, ' '));
    }

    if (steps.length > 1) facts.push(`+${steps.length - 1} step${steps.length > 2 ? 's' : ''}`);
    return facts.slice(0, 5);
};

export const PipelineTemplatePicker: React.FC<Props> = ({ open, onClose, onSelect }) => {
    const [category, setCategory] = useState<PipelinePresetCategory | 'all'>('quality');

    const presets = useMemo(
        () => (category === 'all' ? PIPELINE_PRESETS : PIPELINE_PRESETS.filter((preset) => preset.category === category)),
        [category],
    );

    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = { all: PIPELINE_PRESETS.length };
        for (const id of CATEGORIES) {
            counts[id] = PIPELINE_PRESETS.filter((preset) => preset.category === id).length;
        }
        return counts;
    }, []);

    const heading = category === 'all'
        ? 'Every starting point'
        : PIPELINE_PRESET_CATEGORY_LABELS[category];
    const subheading = category === 'all'
        ? 'Browse the full catalog, or filter by goal. Every template opens in dry-run so you can preview before writing.'
        : CATEGORY_META[category].blurb;

    return (
        <ModalPortal open={open}>
            <div
                className="fixed inset-0 z-[1200] flex flex-col overflow-hidden bg-background text-text md:left-72"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pipeline-template-title"
            >
                <AppAmbientBackground className="absolute inset-0" />

                <header className="relative z-10 border-b border-white/10 bg-background/40 backdrop-blur-md">
                    <div className="flex w-full items-start justify-between gap-4 px-4 py-5 md:px-8">
                        <div className="min-w-0">
                            <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-plex">
                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-plex/30 bg-plex/15">
                                    <Sparkles className="h-3.5 w-3.5" />
                                </span>
                                Pipeline gallery
                            </div>
                            <h2 id="pipeline-template-title" className="text-3xl font-black tracking-tight text-text sm:text-4xl">
                                Start from a template
                            </h2>
                            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">
                                Pick a proven encode or cleanup profile, then refine matching and output before you go live.
                            </p>
                        </div>
                        <button
                            type="button"
                            className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2.5 text-muted transition hover:border-white/20 hover:bg-white/10 hover:text-text"
                            onClick={onClose}
                            aria-label="Close template gallery"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="flex w-full gap-1 overflow-x-auto px-4 pb-4 md:px-8 custom-scrollbar">
                        <button
                            type="button"
                            onClick={() => setCategory('all')}
                            className={`min-w-max rounded-xl border px-3.5 py-2 text-left transition ${
                                category === 'all'
                                    ? 'border-plex/40 bg-plex/15 text-plex'
                                    : 'border-white/10 bg-black/20 text-muted hover:border-white/20 hover:text-text'
                            }`}
                        >
                            <span className="block text-xs font-bold uppercase tracking-wide">All</span>
                            <span className="mt-0.5 block text-[11px] opacity-80">{categoryCounts.all} templates</span>
                        </button>
                        {CATEGORIES.map((id) => {
                            const Icon = CATEGORY_META[id].icon;
                            const active = category === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setCategory(id)}
                                    className={`min-w-max rounded-xl border px-3.5 py-2 text-left transition ${
                                        active
                                            ? 'border-plex/40 bg-plex/15 text-plex'
                                            : 'border-white/10 bg-black/20 text-muted hover:border-white/20 hover:text-text'
                                    }`}
                                >
                                    <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
                                        <Icon className="h-3.5 w-3.5" />
                                        {PIPELINE_PRESET_CATEGORY_LABELS[id]}
                                    </span>
                                    <span className="mt-0.5 block text-[11px] opacity-80">{categoryCounts[id]} templates</span>
                                </button>
                            );
                        })}
                    </div>
                </header>

                <div className="relative z-10 flex-1 overflow-y-auto custom-scrollbar">
                    <div className="w-full px-4 py-6 md:px-8 lg:py-8">
                        <div className="mb-6 flex flex-col gap-1 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h3 className="text-xl font-bold tracking-tight text-text">{heading}</h3>
                                <p className="mt-1 max-w-2xl text-sm text-muted">{subheading}</p>
                            </div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                                {presets.length} shown · opens in dry-run
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {presets.map((preset, index) => {
                                const meta = CATEGORY_META[preset.category];
                                const CategoryIcon = meta.icon;
                                const facts = summarizeSteps(preset.pipeline.steps);
                                const hardware = preset.pipeline.hardware || 'auto';
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() => onSelect({
                                            ...preset.pipeline,
                                            samplePath: '',
                                        })}
                                        className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${meta.accent} from-white/[0.03] p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-plex/45 hover:bg-plex/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plex/50`}
                                        style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                                    >
                                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-60" />
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-plex">
                                                <CategoryIcon className="h-4 w-4" />
                                            </span>
                                            <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                                                {PIPELINE_PRESET_CATEGORY_LABELS[preset.category]}
                                            </span>
                                        </div>

                                        <h4 className="mt-4 text-lg font-bold tracking-tight text-text transition group-hover:text-plex">
                                            {preset.label}
                                        </h4>
                                        <p className="mt-2 min-h-[3.25rem] text-sm leading-relaxed text-muted">
                                            {preset.detail}
                                        </p>

                                        <div className="mt-4 flex flex-wrap gap-1.5">
                                            {facts.map((fact) => (
                                                <span
                                                    key={`${preset.id}-${fact}`}
                                                    className="rounded-md border border-white/10 bg-black/35 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-text/80"
                                                >
                                                    {fact}
                                                </span>
                                            ))}
                                            <span className="rounded-md border border-white/10 bg-black/35 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-text/80">
                                                {hardware}
                                            </span>
                                        </div>

                                        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted">
                                                <Film className="h-3.5 w-3.5" />
                                                {preset.pipeline.steps?.length || 0} step{(preset.pipeline.steps?.length || 0) === 1 ? '' : 's'}
                                            </span>
                                            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-plex opacity-90 transition group-hover:gap-2.5 group-hover:opacity-100">
                                                Use template
                                                <ArrowRight className="h-4 w-4" />
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {!presets.length && (
                            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center">
                                <Layers3 className="mx-auto h-8 w-8 text-muted" />
                                <p className="mt-3 font-semibold text-text">No templates in this category</p>
                                <p className="mt-1 text-sm text-muted">Try another filter or show all templates.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};
