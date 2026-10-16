import React from 'react';
import {
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Loader2,
    Play,
    Plus,
    Trash2,
} from 'lucide-react';
import { CustomSelect, SettingsSwitch } from '../shared/ui';
import { askConfirm } from '../shared/confirm';
import { PathBrowserField } from './PathBrowserField';
import { summarizeMatchRules } from './pipelineUi';
import type {
    HardwareMode,
    MediaAutomationPipeline,
    MediaAutomationPipelinePreview,
    MediaAutomationRuleCondition,
    MediaAutomationStep,
    OutputMode,
} from './types';

const fieldClass = 'w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-[16px] leading-5 text-text placeholder:text-muted/60 outline-none transition focus:border-plex focus:ring-1 focus:ring-plex';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-white/[0.04] px-3 py-2 text-sm font-semibold text-text transition hover:border-plex/50 hover:bg-plex/10 disabled:pointer-events-none disabled:opacity-40';
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-plex px-3 py-2 text-sm font-bold text-background transition hover:bg-plex-hover disabled:pointer-events-none disabled:opacity-40';

const asText = (value: unknown, fallback = '-') => value === undefined || value === null || value === '' ? fallback : String(value);

const confirmReplaceOutputMode = () => askConfirm(
    'Replace mode atomically promotes verified output over the source file. '
    + 'The original is moved to quarantine after verify. Continue?',
    { title: 'Replace original files?', confirmLabel: 'Use Replace', cancelLabel: 'Keep current mode' },
);

type Props = {
    pipelineDraft: MediaAutomationPipeline;
    setPipelineDraft: React.Dispatch<React.SetStateAction<MediaAutomationPipeline | null>>;
    createRuleCondition: () => MediaAutomationRuleCondition;
    editorMatchAdvancedOpen: boolean;
    setEditorMatchAdvancedOpen: (open: boolean) => void;
    editorAdvancedOpen: boolean;
    setEditorAdvancedOpen: (open: boolean) => void;
    forceSampleSection: boolean;
    previewBusy: boolean;
    busy: string | null;
    previewResult: MediaAutomationPipelinePreview | null;
    runPipelinePreview: () => void;
    queuePipelineSample: (pipeline: MediaAutomationPipeline, options?: { dryRun?: boolean }) => void | Promise<void>;
    globalDryRun: boolean;
};

export const PipelineEditorForm: React.FC<Props> = ({
    pipelineDraft,
    setPipelineDraft,
    createRuleCondition,
    editorMatchAdvancedOpen,
    setEditorMatchAdvancedOpen,
    editorAdvancedOpen,
    setEditorAdvancedOpen,
    forceSampleSection,
    previewBusy,
    busy,
    previewResult,
    runPipelinePreview,
    queuePipelineSample,
    globalDryRun,
}) => {
    const primaryStep = pipelineDraft.steps[0] || { type: 'transcode' as const, container: 'mkv', videoCodec: 'hevc', audioCodec: 'copy', subtitleCodec: 'copy' };
    const updatePrimaryStep = (patch: Partial<MediaAutomationStep>) => {
        const steps = [...pipelineDraft.steps];
        if (!steps.length) steps.push({ type: 'transcode', container: 'mkv', videoCodec: 'hevc', audioCodec: 'copy', subtitleCodec: 'copy' });
        steps[0] = { ...steps[0], ...patch };
        setPipelineDraft({ ...pipelineDraft, steps });
    };

    const showPrimarySimple = ['transcode', 'remux', 'subtitle-strip'].includes(primaryStep.type);

    return (
        <>
            <section className="space-y-4 rounded-xl border border-border bg-background/20 p-4">
                <div>
                    <h3 className="font-bold text-text">1. Goal</h3>
                    <p className="mt-1 text-xs text-muted">Name the pipeline and choose how files are written.</p>
                </div>
                <label className="block space-y-2 text-sm font-semibold text-text">
                    Name
                    <input className={fieldClass} value={pipelineDraft.name} onChange={(event) => setPipelineDraft({ ...pipelineDraft, name: event.target.value })} placeholder="HEVC conversion" />
                </label>
                <label className="flex items-center gap-3 text-sm font-semibold text-text">
                    <SettingsSwitch checked={pipelineDraft.enabled} onChange={(enabled) => setPipelineDraft({ ...pipelineDraft, enabled })} />
                    Pipeline enabled
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm font-semibold text-text">
                        When it writes
                        <CustomSelect
                            value={pipelineDraft.outputMode}
                            onChange={(outputMode) => {
                                void (async () => {
                                    if (outputMode === 'replace' && pipelineDraft.outputMode !== 'replace') {
                                        if (!(await confirmReplaceOutputMode())) return;
                                    }
                                    setPipelineDraft({ ...pipelineDraft, outputMode: outputMode as OutputMode });
                                })();
                            }}
                            options={[
                                { value: 'dry-run', label: 'Plan only (safe)' },
                                { value: 'copy', label: 'Write a copy' },
                                { value: 'replace', label: 'Replace original' },
                            ]}
                        />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-text">
                        Hardware
                        <CustomSelect
                            value={pipelineDraft.hardware}
                            onChange={(hardware) => setPipelineDraft({ ...pipelineDraft, hardware: hardware as HardwareMode })}
                            options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'cpu', label: 'CPU' },
                                { value: 'nvenc', label: 'NVIDIA NVENC' },
                                { value: 'qsv', label: 'Intel Quick Sync' },
                                { value: 'intel-vaapi', label: 'Intel VAAPI' },
                                { value: 'vaapi', label: 'AMD VAAPI' },
                            ]}
                        />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-text">
                        Dolby Vision
                        <CustomSelect
                            value={pipelineDraft.dolbyVisionHandling || 'inherit'}
                            onChange={(dolbyVisionHandling) => setPipelineDraft({
                                ...pipelineDraft,
                                dolbyVisionHandling: dolbyVisionHandling as 'inherit' | 'skip' | 'preserve' | 'strip',
                            })}
                            options={[
                                { value: 'inherit', label: 'Use global setting' },
                                { value: 'skip', label: 'Skip (recommended)' },
                                { value: 'strip', label: 'Strip and encode' },
                                { value: 'preserve', label: 'Preserve best-effort' },
                            ]}
                        />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-text">
                        HDR10 / HLG
                        <CustomSelect
                            value={pipelineDraft.hdr10Handling || 'inherit'}
                            onChange={(hdr10Handling) => setPipelineDraft({
                                ...pipelineDraft,
                                hdr10Handling: hdr10Handling as 'inherit' | 'preserve' | 'strip' | 'skip',
                            })}
                            options={[
                                { value: 'inherit', label: 'Use global setting' },
                                { value: 'preserve', label: 'Preserve + 10-bit' },
                                { value: 'strip', label: 'Strip HDR metadata' },
                                { value: 'skip', label: 'Skip HDR files' },
                            ]}
                        />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-text">
                        Min savings %
                        <CustomSelect
                            value={
                                pipelineDraft.minSavingsPercent == null
                                || String(pipelineDraft.minSavingsPercent).toLowerCase() === 'inherit'
                                    ? 'inherit'
                                    : 'custom'
                            }
                            onChange={(mode) => setPipelineDraft({
                                ...pipelineDraft,
                                minSavingsPercent: mode === 'inherit'
                                    ? 'inherit'
                                    : Math.min(95, Math.max(0, Math.round(Number(pipelineDraft.minSavingsPercent) || 0))),
                            })}
                            options={[
                                { value: 'inherit', label: 'Use global setting' },
                                { value: 'custom', label: 'Override' },
                            ]}
                        />
                    </label>
                    {!(
                        pipelineDraft.minSavingsPercent == null
                        || String(pipelineDraft.minSavingsPercent).toLowerCase() === 'inherit'
                    ) && (
                        <label className="space-y-2 text-sm font-semibold text-text">
                            Override value (%)
                            <input
                                className={fieldClass}
                                type="number"
                                min={0}
                                max={95}
                                value={Math.min(95, Math.max(0, Math.round(Number(pipelineDraft.minSavingsPercent) || 0)))}
                                onChange={(event) => setPipelineDraft({
                                    ...pipelineDraft,
                                    minSavingsPercent: Math.min(95, Math.max(0, Math.round(Number(event.target.value) || 0))),
                                })}
                            />
                        </label>
                    )}
                </div>
                {pipelineDraft.outputMode === 'dry-run' && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                        Plan only - jobs will not rewrite media. Switch to Write a copy or Replace original when you are ready.
                    </div>
                )}
                {(pipelineDraft.outputMode === 'replace' || pipelineDraft.outputMode === 'copy') && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                        {pipelineDraft.outputMode === 'replace'
                            ? 'Replace mode atomically promotes verified output over the source.'
                            : 'Copy mode writes beside the source and leaves the original untouched.'}
                        {globalDryRun
                            ? ' Global Safe fallback is still Dry run - Settings must allow writes or nothing will change.'
                            : ' Keep plan-only until paths and hardware look good.'}
                    </div>
                )}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-background/20 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="font-bold text-text">2. Match</h3>
                        <p className="mt-1 text-sm text-text">{summarizeMatchRules(pipelineDraft.rules)}</p>
                    </div>
                    <button type="button" className={buttonClass} onClick={() => setEditorMatchAdvancedOpen(!editorMatchAdvancedOpen)}>
                        {editorMatchAdvancedOpen ? 'Hide matching' : 'Advanced matching'}
                        {editorMatchAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                </div>
                {editorMatchAdvancedOpen && (
                    <div className="space-y-3 border-t border-border/60 pt-3">
                        <div className="flex flex-wrap gap-2">
                            <CustomSelect
                                className="min-w-32"
                                compact
                                value={pipelineDraft.rules.operator}
                                onChange={(operator) => setPipelineDraft({ ...pipelineDraft, rules: { ...pipelineDraft.rules, operator: operator as 'AND' | 'OR' } })}
                                options={[{ value: 'AND', label: 'Match ALL (AND)' }, { value: 'OR', label: 'Match ANY (OR)' }]}
                            />
                            <button
                                type="button"
                                className={buttonClass}
                                onClick={() => setPipelineDraft({
                                    ...pipelineDraft,
                                    rules: { ...pipelineDraft.rules, conditions: [...pipelineDraft.rules.conditions, createRuleCondition()] },
                                })}
                            >
                                <Plus className="h-4 w-4" /> Condition
                            </button>
                        </div>
                        {pipelineDraft.rules.conditions.length === 0 && (
                            <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted">No conditions - this pipeline matches every file.</div>
                        )}
                        {pipelineDraft.rules.conditions.map((condition, index) => {
                            const updateCondition = (patch: Partial<MediaAutomationRuleCondition>) => setPipelineDraft({
                                ...pipelineDraft,
                                rules: {
                                    ...pipelineDraft.rules,
                                    conditions: pipelineDraft.rules.conditions.map((current) => current.id === condition.id ? { ...current, ...patch } : current),
                                },
                            });
                            return (
                                <div key={condition.id} className="rounded-xl border border-border bg-background/30 p-4">
                                    <div className="mb-3 flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wide text-plex">Condition {index + 1}</span>
                                        <button
                                            type="button"
                                            className="p-1.5 text-muted hover:text-red-300"
                                            onClick={() => setPipelineDraft({
                                                ...pipelineDraft,
                                                rules: {
                                                    ...pipelineDraft.rules,
                                                    conditions: pipelineDraft.rules.conditions.filter((current) => current.id !== condition.id),
                                                },
                                            })}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                        <CustomSelect value={condition.field} onChange={(field) => updateCondition({ field: field as MediaAutomationRuleCondition['field'] })} options={[
                                            { value: 'path', label: 'Path' },
                                            { value: 'container', label: 'Container' },
                                            { value: 'videoCodec', label: 'Video codec' },
                                            { value: 'audioCodec', label: 'Audio codec' },
                                            { value: 'width', label: 'Video width' },
                                            { value: 'bitrate', label: 'Bitrate' },
                                            { value: 'hdr', label: 'HDR' },
                                        ]} />
                                        <CustomSelect value={condition.operator} onChange={(operator) => updateCondition({ operator: operator as MediaAutomationRuleCondition['operator'] })} options={[
                                            { value: 'equals', label: 'Equals' },
                                            { value: 'notEquals', label: 'Does not equal' },
                                            { value: 'contains', label: 'Contains' },
                                            { value: 'matches', label: 'Matches pattern' },
                                            { value: 'greaterThan', label: 'Greater than' },
                                            { value: 'lessThan', label: 'Less than' },
                                        ]} />
                                        {condition.field === 'hdr' ? (
                                            <CustomSelect value={condition.value || 'true'} onChange={(value) => updateCondition({ value })} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                                        ) : (
                                            <input className={fieldClass} value={condition.value} onChange={(event) => updateCondition({ value: event.target.value })} placeholder={condition.field === 'path' ? '*.mkv' : condition.field === 'width' ? '1920' : 'Value'} />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <section className="space-y-4 rounded-xl border border-border bg-background/20 p-4">
                <div>
                    <h3 className="font-bold text-text">3. Output</h3>
                    <p className="mt-1 text-xs text-muted">What happens to a matching file (primary step).</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <CustomSelect
                        value={primaryStep.type}
                        onChange={(type) => updatePrimaryStep({ type: type as MediaAutomationStep['type'] })}
                        options={[
                            { value: 'transcode', label: 'Transcode video' },
                            { value: 'remux', label: 'Remux container' },
                            { value: 'subtitle-strip', label: 'Strip subtitles' },
                            { value: 'subtitle-extract', label: 'Extract subtitle (SRT)' },
                            { value: 'subtitle-keep-lang', label: 'Keep subtitle languages' },
                            { value: 'keep-first-audio', label: 'Keep first audio' },
                            { value: 'drop-commentary', label: 'Drop commentary audio' },
                            { value: 'audio-normalize', label: 'Audio loudnorm' },
                            { value: 'audio-stereo', label: 'Audio stereo downmix' },
                            { value: 'commercial-strip', label: 'Strip commercial chapters' },
                            { value: 'move', label: 'Move / rename' },
                            { value: 'custom-command', label: 'Custom command' },
                        ]}
                    />
                    {showPrimarySimple && (
                        <input className={fieldClass} value={primaryStep.container || ''} onChange={(event) => updatePrimaryStep({ container: event.target.value })} placeholder="Container (mkv)" />
                    )}
                </div>
                {primaryStep.type === 'transcode' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input className={fieldClass} value={primaryStep.videoCodec || ''} onChange={(event) => updatePrimaryStep({ videoCodec: event.target.value })} placeholder="Video codec (hevc)" />
                        <input className={fieldClass} value={primaryStep.audioCodec || ''} onChange={(event) => updatePrimaryStep({ audioCodec: event.target.value })} placeholder="Audio codec (copy)" />
                        <input className={fieldClass} value={primaryStep.subtitleCodec || ''} onChange={(event) => updatePrimaryStep({ subtitleCodec: event.target.value })} placeholder="Subtitle codec (copy/drop)" />
                        <input className={fieldClass} value={primaryStep.preset || ''} onChange={(event) => updatePrimaryStep({ preset: event.target.value })} placeholder="Speed preset (medium)" />
                        <CustomSelect
                            value={primaryStep.tenBit === true ? 'yes' : 'no'}
                            onChange={(tenBit) => updatePrimaryStep({ tenBit: tenBit === 'yes' })}
                            options={[
                                { value: 'no', label: '10-bit: No (8-bit)' },
                                { value: 'yes', label: '10-bit: Yes (HEVC/AV1 Main10)' },
                            ]}
                        />
                        <input
                            className={fieldClass}
                            type="number"
                            min={100}
                            max={100000}
                            value={primaryStep.videoBitrateKbps || ''}
                            onChange={(event) => updatePrimaryStep({
                                videoBitrateKbps: event.target.value === '' ? undefined : Number(event.target.value),
                            })}
                            placeholder="Video bitrate kbps (optional)"
                        />
                        <input
                            className={fieldClass}
                            type="number"
                            min={0}
                            max={51}
                            value={primaryStep.crf ?? ''}
                            onChange={(event) => updatePrimaryStep({ crf: event.target.value === '' ? undefined : Number(event.target.value) })}
                            placeholder="Quality CRF/CQ"
                            disabled={!!primaryStep.videoBitrateKbps}
                        />
                    </div>
                )}
                {(pipelineDraft.steps || []).length > 1 && (
                    <p className="text-xs text-muted">This pipeline has {(pipelineDraft.steps || []).length} steps - open Advanced to reorder or edit the rest.</p>
                )}
            </section>

            <section className="rounded-xl border border-border bg-background/20 p-4">
                <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setEditorAdvancedOpen(!editorAdvancedOpen)}>
                    <div>
                        <h3 className="font-bold text-text">4. Advanced</h3>
                        <p className="mt-1 text-xs text-muted">Priority, multi-step list, sample file, and preview.</p>
                    </div>
                    {editorAdvancedOpen || forceSampleSection ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
                </button>
                {(editorAdvancedOpen || forceSampleSection) && (
                    <div className="mt-4 space-y-5 border-t border-border/60 pt-4">
                        <label className="block max-w-[8rem] space-y-2 text-sm font-semibold text-text">
                            Priority
                            <input className={fieldClass} type="number" min={0} max={999} value={pipelineDraft.priority} onChange={(event) => setPipelineDraft({ ...pipelineDraft, priority: Math.max(0, Number(event.target.value) || 0) })} />
                        </label>
                        <div>
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <h4 className="font-semibold text-text">Ordered steps</h4>
                                    <p className="mt-1 text-xs text-muted">Steps execute from top to bottom.</p>
                                </div>
                                <button
                                    type="button"
                                    className={buttonClass}
                                    onClick={() => setPipelineDraft({
                                        ...pipelineDraft,
                                        steps: [...pipelineDraft.steps, { type: 'transcode', container: 'mkv', videoCodec: 'hevc', audioCodec: 'copy', subtitleCodec: 'copy' }],
                                    })}
                                >
                                    <Plus className="h-4 w-4" /> Add step
                                </button>
                            </div>
                            <div className="space-y-3">
                                {pipelineDraft.steps.map((step, index) => {
                                    const updateStep = (patch: Partial<MediaAutomationStep>) => setPipelineDraft({
                                        ...pipelineDraft,
                                        steps: pipelineDraft.steps.map((current, currentIndex) => currentIndex === index ? { ...current, ...patch } : current),
                                    });
                                    const moveStep = (offset: number) => {
                                        const target = index + offset;
                                        if (target < 0 || target >= pipelineDraft.steps.length) return;
                                        const next = [...pipelineDraft.steps];
                                        [next[index], next[target]] = [next[target], next[index]];
                                        setPipelineDraft({ ...pipelineDraft, steps: next });
                                    };
                                    return (
                                        <div key={index} className="rounded-xl border border-border bg-background/30 p-4">
                                            <div className="mb-3 flex items-center justify-between">
                                                <span className="text-xs font-bold uppercase tracking-wide text-plex">Step {index + 1}</span>
                                                <div className="flex items-center gap-1">
                                                    <button type="button" aria-label="Move step up" disabled={index === 0} className="p-1.5 text-muted hover:text-text disabled:opacity-30" onClick={() => moveStep(-1)}><ChevronUp className="h-4 w-4" /></button>
                                                    <button type="button" aria-label="Move step down" disabled={index === pipelineDraft.steps.length - 1} className="p-1.5 text-muted hover:text-text disabled:opacity-30" onClick={() => moveStep(1)}><ChevronDown className="h-4 w-4" /></button>
                                                    <button type="button" aria-label="Delete step" className="p-1.5 text-muted hover:text-red-300" onClick={() => setPipelineDraft({ ...pipelineDraft, steps: pipelineDraft.steps.filter((_, currentIndex) => currentIndex !== index) })}><Trash2 className="h-4 w-4" /></button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                <CustomSelect
                                                    value={step.type}
                                                    onChange={(type) => updateStep({ type: type as MediaAutomationStep['type'] })}
                                                    options={[
                                                        { value: 'transcode', label: 'Transcode' },
                                                        { value: 'remux', label: 'Remux' },
                                                        { value: 'subtitle-strip', label: 'Strip subtitles' },
                                                        { value: 'subtitle-extract', label: 'Extract subtitle (SRT)' },
                                                        { value: 'subtitle-keep-lang', label: 'Keep subtitle languages' },
                                                        { value: 'keep-first-audio', label: 'Keep first audio' },
                                                        { value: 'drop-commentary', label: 'Drop commentary audio' },
                                                        { value: 'audio-normalize', label: 'Audio loudnorm' },
                                                        { value: 'audio-stereo', label: 'Audio stereo downmix' },
                                                        { value: 'commercial-strip', label: 'Strip commercial chapters' },
                                                        { value: 'move', label: 'Move / rename' },
                                                        { value: 'custom-command', label: 'Custom command' },
                                                    ]}
                                                />
                                                {['transcode', 'remux', 'subtitle-strip', 'subtitle-keep-lang', 'keep-first-audio', 'drop-commentary', 'audio-normalize', 'audio-stereo', 'commercial-strip'].includes(step.type) && (
                                                    <input className={fieldClass} value={step.container || ''} onChange={(event) => updateStep({ container: event.target.value })} placeholder="Container (mkv)" />
                                                )}
                                                {step.type === 'transcode' && <>
                                                    <input className={fieldClass} value={step.videoCodec || ''} onChange={(event) => updateStep({ videoCodec: event.target.value })} placeholder="Video codec (hevc)" />
                                                    <input className={fieldClass} value={step.audioCodec || ''} onChange={(event) => updateStep({ audioCodec: event.target.value })} placeholder="Audio codec (copy)" />
                                                    <input className={fieldClass} value={step.subtitleCodec || ''} onChange={(event) => updateStep({ subtitleCodec: event.target.value })} placeholder="Subtitle codec (copy/drop)" />
                                                    <input className={fieldClass} value={step.preset || ''} onChange={(event) => updateStep({ preset: event.target.value })} placeholder="Speed preset (medium/slow/fast)" />
                                                    <CustomSelect
                                                        value={step.tenBit === true ? 'yes' : 'no'}
                                                        onChange={(tenBit) => updateStep({ tenBit: tenBit === 'yes' })}
                                                        options={[
                                                            { value: 'no', label: '10-bit: No (8-bit)' },
                                                            { value: 'yes', label: '10-bit: Yes (HEVC/AV1 Main10)' },
                                                        ]}
                                                    />
                                                    <input className={fieldClass} type="number" min={100} max={100000} value={step.videoBitrateKbps || ''} onChange={(event) => updateStep({ videoBitrateKbps: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="Video bitrate kbps" />
                                                    <input className={fieldClass} type="number" min={0} max={51} value={step.crf ?? ''} onChange={(event) => updateStep({ crf: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="Quality CRF/CQ" disabled={!!step.videoBitrateKbps} />
                                                    <input className={fieldClass} type="number" min={32} max={1536} value={step.audioBitrateKbps || ''} onChange={(event) => updateStep({ audioBitrateKbps: event.target.value ? Number(event.target.value) : undefined })} placeholder="Audio bitrate kbps" />
                                                    <input className={fieldClass} type="number" min={2} value={step.maxWidth || ''} onChange={(event) => updateStep({ maxWidth: event.target.value ? Number(event.target.value) : undefined })} placeholder="Maximum width" />
                                                </>}
                                                {(step.type === 'audio-normalize' || step.type === 'audio-stereo') && (
                                                    <input className={fieldClass} type="number" min={32} max={1536} value={step.audioBitrateKbps || ''} onChange={(event) => updateStep({ audioBitrateKbps: event.target.value ? Number(event.target.value) : undefined })} placeholder="Audio bitrate kbps (AAC)" />
                                                )}
                                                {(step.type === 'subtitle-extract' || step.type === 'subtitle-keep-lang') && (
                                                    <input className={`${fieldClass} sm:col-span-2`} value={step.subtitleLanguages || ''} onChange={(event) => updateStep({ subtitleLanguages: event.target.value })} placeholder={step.type === 'subtitle-keep-lang' ? 'Languages to keep - eng,en' : 'Preferred languages (optional)'} />
                                                )}
                                                {step.type === 'keep-first-audio' && (
                                                    <label className="sm:col-span-2 flex items-center gap-2 text-sm text-text">
                                                        <input type="checkbox" checked={step.keepSubtitles !== false} onChange={(event) => updateStep({ keepSubtitles: event.target.checked })} />
                                                        Keep subtitle streams
                                                    </label>
                                                )}
                                                {step.type === 'commercial-strip' && (
                                                    <input className={`${fieldClass} sm:col-span-2`} value={step.commercialPattern || ''} onChange={(event) => updateStep({ commercialPattern: event.target.value })} placeholder="Chapter title regex" />
                                                )}
                                                {step.type === 'move' && (
                                                    <>
                                                        <input className={`${fieldClass} sm:col-span-2`} value={step.destination || ''} onChange={(event) => updateStep({ destination: event.target.value })} placeholder="Destination - {dir}/archive/{n} - {s00e00} - {quality}{ext}" />
                                                        <p className="sm:col-span-2 text-[11px] text-muted">Tokens: {'{dir} {name} {ext} {basename} {n} {s00e00} {quality} {year} {stem}'} and more.</p>
                                                    </>
                                                )}
                                                {step.type === 'custom-command' && <>
                                                    <input className={fieldClass} value={step.executable || ''} onChange={(event) => updateStep({ executable: event.target.value })} placeholder="Executable (ffmpeg / ffprobe)" />
                                                    <input
                                                        className={`${fieldClass} sm:col-span-2`}
                                                        value={(step.args || []).join(' ')}
                                                        onChange={(event) => updateStep({
                                                            args: event.target.value.trim()
                                                                ? event.target.value.trim().split(/\s+/).slice(0, 64)
                                                                : [],
                                                        })}
                                                        placeholder="Args (space-separated)"
                                                    />
                                                </>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="rounded-xl border border-border bg-background/30 p-4 space-y-3">
                            <div>
                                <h4 className="font-semibold text-text">Sample file</h4>
                                <p className="mt-1 text-xs text-muted">Saved for preview and one-click queueing. Use container paths (e.g. /media/…).</p>
                            </div>
                            <PathBrowserField
                                label="Sample file (saved)"
                                mode="file"
                                value={String(pipelineDraft.samplePath || '')}
                                onChange={(samplePath) => setPipelineDraft({ ...pipelineDraft, samplePath })}
                                placeholder="/media/Movies/example.mkv"
                                hint="Saved when you click Save. Not Unraid /mnt/… paths."
                            />
                            <div className="flex flex-wrap gap-3">
                                <button type="button" className={buttonClass} disabled={previewBusy || !pipelineDraft.id || !String(pipelineDraft.samplePath || '').trim()} onClick={runPipelinePreview}>
                                    {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Preview
                                </button>
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={previewBusy || busy !== null || !pipelineDraft.id || !String(pipelineDraft.samplePath || '').trim()}
                                    onClick={() => void queuePipelineSample(pipelineDraft, { dryRun: true })}
                                >
                                    {busy === `test-pipeline-${pipelineDraft.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Queue dry-run
                                </button>
                                <button
                                    type="button"
                                    className={primaryButtonClass}
                                    disabled={previewBusy || busy !== null || !pipelineDraft.id || !String(pipelineDraft.samplePath || '').trim()}
                                    onClick={() => void queuePipelineSample(pipelineDraft)}
                                >
                                    {busy === `queue-sample-${pipelineDraft.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Queue sample
                                </button>
                            </div>
                            {previewResult && (
                                <div className="rounded-lg bg-card/70 p-3 text-xs text-muted space-y-2">
                                    <p className="font-semibold text-text">{previewResult.matched ? 'Matched' : 'No match'}{previewResult.reason ? ` · ${previewResult.reason}` : ''}</p>
                                    {previewResult.probe && (
                                        <p>
                                            {asText(previewResult.probe.format)} · {asText(previewResult.probe.videoCodec)} / {asText(previewResult.probe.audioCodec)}
                                            {previewResult.probe.duration ? ` · ${previewResult.probe.duration}s` : ''}
                                        </p>
                                    )}
                                    {(previewResult.plans || []).map((plan, index) => (
                                        <div key={index} className="rounded-md border border-border/60 bg-background/40 p-2">
                                            <p className="font-semibold text-text">Step {index + 1}: {plan.mode || 'plan'}{plan.adapterLabel ? ` · ${plan.adapterLabel}` : ''}</p>
                                            <p className="mt-1 break-all font-mono text-[11px] text-muted">{(plan.args || []).join(' ')}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </section>
        </>
    );
};
