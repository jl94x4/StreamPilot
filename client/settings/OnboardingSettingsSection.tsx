import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import { getSettingsSectionElementId } from './settingsIndex';
import { SettingHint } from './SettingHint';
import { useDiscoverI18n } from '../discovery/i18n';
import { OnboardingWizard, type OnboardingStep } from '../onboarding/OnboardingWizard';

type OnboardingDocument = {
    enabled: boolean;
    version: number;
    steps: OnboardingStep[];
};

const STEP_TYPE_OPTIONS = [
    { value: 'welcome', labelKey: 'settings.invites.onboardingTypeWelcome' },
    { value: 'rules', labelKey: 'settings.invites.onboardingTypeRules' },
    { value: 'text', labelKey: 'settings.invites.onboardingTypeText' },
    { value: 'media_tips', labelKey: 'settings.invites.onboardingTypeMedia' },
    { value: 'features', labelKey: 'settings.invites.onboardingTypeFeatures' },
    { value: 'links', labelKey: 'settings.invites.onboardingTypeLinks' },
    { value: 'finish', labelKey: 'settings.invites.onboardingTypeFinish' },
];

const newStepId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

export const OnboardingSettingsSection: React.FC<{
    addToast: (msg: string, type: 'success' | 'error') => void;
}> = ({ addToast }) => {
    const { t } = useDiscoverI18n();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [doc, setDoc] = useState<OnboardingDocument | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiFetch('/api/onboarding');
            setDoc(data);
        } catch (e: any) {
            addToast(e.message || t('settings.invites.onboardingLoadFailed'), 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast, t]);

    useEffect(() => { load(); }, [load]);

    const save = async (next: OnboardingDocument) => {
        setSaving(true);
        try {
            const saved = await apiFetch('/api/onboarding', {
                method: 'PUT',
                body: JSON.stringify(next),
            });
            setDoc(saved);
            addToast(t('settings.invites.onboardingSaved'), 'success');
        } catch (e: any) {
            addToast(e.message || t('settings.invites.onboardingSaveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const updateStep = (id: string, patch: Partial<OnboardingStep>) => {
        if (!doc) return;
        setDoc({
            ...doc,
            steps: doc.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
        });
    };

    const moveStep = (id: string, direction: -1 | 1) => {
        if (!doc) return;
        const index = doc.steps.findIndex((step) => step.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= doc.steps.length) return;
        const steps = [...doc.steps];
        const [item] = steps.splice(index, 1);
        steps.splice(target, 0, item);
        setDoc({ ...doc, steps: steps.map((step, order) => ({ ...step, order })) });
    };

    const addStep = () => {
        if (!doc) return;
        const step: OnboardingStep = {
            id: newStepId(),
            type: 'text',
            title: t('settings.invites.onboardingNewStepTitle'),
            body: '',
            required: false,
            enabled: true,
            requireAck: false,
            links: [],
            order: doc.steps.length,
        };
        setDoc({ ...doc, steps: [...doc.steps, step] });
        setExpandedId(step.id);
    };

    const removeStep = (id: string) => {
        if (!doc) return;
        setDoc({ ...doc, steps: doc.steps.filter((step) => step.id !== id).map((step, order) => ({ ...step, order })) });
    };

    if (loading || !doc) {
        return <div className="text-muted">{t('settings.invites.onboardingLoading')}</div>;
    }

    return (
        <section id={getSettingsSectionElementId('onboarding')} className="scroll-mt-24">
            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.invites.onboardingTitle')}</h3>
            <p className="text-sm text-muted mb-6">{t('settings.invites.onboardingDescription')}</p>

            <SettingsToggleRow
                title={t('settings.invites.onboardingEnable')}
                hint={<SettingHint>{t('settings.invites.onboardingEnableHint')}</SettingHint>}
                checked={doc.enabled}
                onChange={(enabled) => setDoc({ ...doc, enabled })}
                border={false}
                className="mb-6"
            />

            <div className="flex flex-wrap gap-2 mb-6">
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => save(doc)}
                    className="px-4 py-2 rounded-lg bg-plex text-background font-bold disabled:opacity-50 hover:bg-plex-hover transition-colors"
                >
                    {t('settings.invites.onboardingSave')}
                </button>
                <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="px-4 py-2 rounded-lg border border-border font-medium hover:border-plex transition-colors"
                >
                    {t('settings.invites.onboardingPreview')}
                </button>
                <button
                    type="button"
                    onClick={addStep}
                    className="px-4 py-2 rounded-lg border border-border font-medium hover:border-plex transition-colors"
                >
                    {t('settings.invites.onboardingAddStep')}
                </button>
            </div>

            <div className="space-y-3">
                {doc.steps.map((step, index) => {
                    const expanded = expandedId === step.id;
                    return (
                        <div key={step.id} className="border border-border rounded-lg p-3">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                                <button type="button" className="text-left min-w-0" onClick={() => setExpandedId(expanded ? null : step.id)}>
                                    <div className="font-semibold">{step.title || t('settings.invites.onboardingUntitled')}</div>
                                    <div className="text-xs text-muted mt-1">
                                        {t('settings.invites.onboardingStepMeta', {
                                            type: step.type,
                                            required: step.required ? t('settings.invites.onboardingRequired') : t('settings.invites.onboardingOptional'),
                                            enabled: step.enabled === false ? t('settings.invites.onboardingDisabled') : t('settings.invites.onboardingEnabled'),
                                        })}
                                    </div>
                                </button>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" className="text-xs border border-border px-2 py-1 rounded" onClick={() => moveStep(step.id, -1)} disabled={index === 0}>{t('settings.invites.onboardingMoveUp')}</button>
                                    <button type="button" className="text-xs border border-border px-2 py-1 rounded" onClick={() => moveStep(step.id, 1)} disabled={index === doc.steps.length - 1}>{t('settings.invites.onboardingMoveDown')}</button>
                                    <button type="button" className="text-xs border border-red-500/30 text-red-400 px-2 py-1 rounded" onClick={() => removeStep(step.id)}>{t('settings.invites.onboardingDeleteStep')}</button>
                                </div>
                            </div>
                            {expanded && (
                                <div className="mt-4 space-y-3 border-t border-border pt-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm mb-1 font-medium">{t('settings.invites.onboardingStepTitle')}</label>
                                            <input
                                                className="w-full p-2.5 rounded-lg bg-background border border-border outline-none focus:border-plex"
                                                value={step.title}
                                                onChange={(e) => updateStep(step.id, { title: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm mb-1 font-medium">{t('settings.invites.onboardingStepType')}</label>
                                            <CustomSelect
                                                value={step.type}
                                                onChange={(value) => updateStep(step.id, {
                                                    type: value,
                                                    requireAck: value === 'rules' ? true : step.requireAck,
                                                })}
                                                options={STEP_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm mb-1 font-medium">{t('settings.invites.onboardingStepBody')}</label>
                                        <textarea
                                            rows={5}
                                            className="w-full p-2.5 rounded-lg bg-background border border-border outline-none focus:border-plex resize-y"
                                            value={step.body || ''}
                                            onChange={(e) => updateStep(step.id, { body: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-4">
                                        <label className="inline-flex items-center gap-2 text-sm">
                                            <input type="checkbox" className="accent-plex" checked={step.enabled !== false} onChange={(e) => updateStep(step.id, { enabled: e.target.checked })} />
                                            {t('settings.invites.onboardingEnabled')}
                                        </label>
                                        <label className="inline-flex items-center gap-2 text-sm">
                                            <input type="checkbox" className="accent-plex" checked={step.required !== false} onChange={(e) => updateStep(step.id, { required: e.target.checked })} />
                                            {t('settings.invites.onboardingRequired')}
                                        </label>
                                        {(step.type === 'rules' || step.requireAck) && (
                                            <label className="inline-flex items-center gap-2 text-sm">
                                                <input type="checkbox" className="accent-plex" checked={!!step.requireAck} onChange={(e) => updateStep(step.id, { requireAck: e.target.checked })} />
                                                {t('settings.invites.onboardingRequireAck')}
                                            </label>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm mb-1 font-medium">{t('settings.invites.onboardingLinks')}</label>
                                        <p className="text-xs text-muted mb-2">{t('settings.invites.onboardingLinksHint')}</p>
                                        {(step.links || []).map((link, linkIndex) => (
                                            <div key={`${step.id}-link-${linkIndex}`} className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_auto] gap-2 mb-2">
                                                <input
                                                    placeholder={t('settings.invites.onboardingLinkLabel')}
                                                    className="p-2 rounded-lg bg-background border border-border outline-none focus:border-plex"
                                                    value={link.label}
                                                    onChange={(e) => {
                                                        const links = [...(step.links || [])];
                                                        links[linkIndex] = { ...links[linkIndex], label: e.target.value };
                                                        updateStep(step.id, { links });
                                                    }}
                                                />
                                                <input
                                                    placeholder="https://"
                                                    className="p-2 rounded-lg bg-background border border-border outline-none focus:border-plex"
                                                    value={link.href}
                                                    onChange={(e) => {
                                                        const links = [...(step.links || [])];
                                                        links[linkIndex] = { ...links[linkIndex], href: e.target.value };
                                                        updateStep(step.id, { links });
                                                    }}
                                                />
                                                <button
                                                    type="button"
                                                    className="text-xs border border-border px-2 py-1 rounded"
                                                    onClick={() => updateStep(step.id, { links: (step.links || []).filter((_, i) => i !== linkIndex) })}
                                                >
                                                    {t('settings.invites.onboardingRemoveLink')}
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            className="text-xs border border-border px-2.5 py-1 rounded"
                                            onClick={() => updateStep(step.id, { links: [...(step.links || []), { label: '', href: '' }] })}
                                        >
                                            {t('settings.invites.onboardingAddLink')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {previewOpen && (
                <div className="fixed inset-0 z-[1200] bg-black/80 backdrop-blur-sm overflow-y-auto p-4 md:p-8">
                    <OnboardingWizard
                        preview
                        previewSteps={doc.steps.filter((step) => step.enabled !== false)}
                        onComplete={() => setPreviewOpen(false)}
                        onCancelPreview={() => setPreviewOpen(false)}
                    />
                </div>
            )}
        </section>
    );
};
