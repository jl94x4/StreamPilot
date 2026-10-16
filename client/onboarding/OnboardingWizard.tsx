import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ExternalLink, Gift, Shield, Sparkles } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { useDiscoverI18n } from '../discovery/i18n';

type OnboardingLink = { label: string; href: string };
export type OnboardingStep = {
    id: string;
    type: string;
    title: string;
    body: string;
    required?: boolean;
    enabled?: boolean;
    requireAck?: boolean;
    links?: OnboardingLink[];
    order?: number;
};

type OnboardingWizardProps = {
    preview?: boolean;
    previewSteps?: OnboardingStep[];
    mediaServerType?: string;
    onComplete: () => void;
    onCancelPreview?: () => void;
};

const mediaLabel = (type?: string) => {
    const value = String(type || 'plex').toLowerCase();
    if (value === 'jellyfin') return 'Jellyfin';
    if (value === 'emby') return 'Emby';
    return 'Plex';
};

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
    preview = false,
    previewSteps,
    mediaServerType,
    onComplete,
    onCancelPreview,
}) => {
    const { t } = useDiscoverI18n();
    const [loading, setLoading] = useState(!preview);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [steps, setSteps] = useState<OnboardingStep[]>(previewSteps || []);
    const [serverType, setServerType] = useState(mediaServerType || 'plex');
    const [navFeatures, setNavFeatures] = useState<Record<string, boolean>>({});
    const [index, setIndex] = useState(0);
    const [acked, setAcked] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (preview) {
            setSteps(previewSteps || []);
            setServerType(mediaServerType || 'plex');
            setIndex(0);
            setAcked(new Set());
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        apiFetch('/api/me/onboarding')
            .then((data) => {
                if (cancelled) return;
                setSteps(Array.isArray(data?.steps) ? data.steps : []);
                setServerType(data?.mediaServerType || 'plex');
                setNavFeatures(data?.navFeatures || {});
                setAcked(new Set(Array.isArray(data?.ackedStepIds) ? data.ackedStepIds : []));
                if (!data?.needsOnboarding || !Array.isArray(data?.steps) || data.steps.length === 0) {
                    onComplete();
                }
            })
            .catch((e) => {
                if (!cancelled) setError(e.message || t('onboarding.loadFailed'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [preview, previewSteps, mediaServerType, onComplete, t]);

    const step = steps[index] || null;
    const isLast = index >= steps.length - 1;
    const canContinue = !step?.requireAck || acked.has(step.id);

    const featureHints = useMemo(() => {
        const items: string[] = [];
        if (navFeatures.discover !== false) items.push(t('onboarding.featureDiscover'));
        if (navFeatures.request) items.push(t('onboarding.featureRequests'));
        if (navFeatures.support !== false) items.push(t('onboarding.featureSupport'));
        if (navFeatures.chat) items.push(t('onboarding.featureChat'));
        if (navFeatures.achievements) items.push(t('onboarding.featureAchievements'));
        return items;
    }, [navFeatures, t]);

    const finish = useCallback(async () => {
        if (preview) {
            onComplete();
            return;
        }
        setSaving(true);
        setError('');
        try {
            await apiFetch('/api/me/onboarding/complete', {
                method: 'POST',
                body: JSON.stringify({ ackedStepIds: Array.from(acked) }),
            });
            onComplete();
        } catch (e: any) {
            setError(e.message || t('onboarding.completeFailed'));
        } finally {
            setSaving(false);
        }
    }, [acked, onComplete, preview, t]);

    const goNext = async () => {
        if (!canContinue) return;
        if (isLast) {
            await finish();
            return;
        }
        setIndex((value) => Math.min(value + 1, steps.length - 1));
    };

    if (loading) {
        return <div className="min-h-[50vh] flex items-center justify-center text-muted">{t('onboarding.loading')}</div>;
    }

    if (!step) {
        return (
            <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 text-muted">
                <p>{t('onboarding.empty')}</p>
                <button type="button" className="px-4 py-2 rounded-lg bg-plex text-background font-bold" onClick={onComplete}>
                    {t('onboarding.enterPortal')}
                </button>
            </div>
        );
    }

    return (
        <div className="w-full max-w-2xl mx-auto animate-fade-in">
            <div className="glass-card border border-border rounded-2xl p-5 md:p-8 shadow-xl">
                <div className="flex items-center justify-between gap-3 mb-6">
                    <div>
                        <p className="text-xs uppercase tracking-wider text-plex font-bold mb-1">{t('onboarding.badge')}</p>
                        <h1 className="text-2xl font-bold text-text">{step.title}</h1>
                    </div>
                    <div className="text-sm text-muted shrink-0">{index + 1} / {steps.length}</div>
                </div>

                <div className="h-1.5 rounded-full bg-border mb-6 overflow-hidden">
                    <div className="h-full bg-plex transition-all" style={{ width: `${((index + 1) / Math.max(steps.length, 1)) * 100}%` }} />
                </div>

                {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

                <div className="space-y-4 mb-8">
                    {step.body && (
                        <p className="text-text whitespace-pre-wrap leading-relaxed">{step.body}</p>
                    )}

                    {step.type === 'media_tips' && (
                        <div className="rounded-xl border border-border bg-background/60 p-4 text-sm text-muted">
                            {t('onboarding.mediaTipsHint', { server: mediaLabel(serverType) })}
                        </div>
                    )}

                    {step.type === 'features' && featureHints.length > 0 && (
                        <ul className="space-y-2">
                            {featureHints.map((item) => (
                                <li key={item} className="flex items-start gap-2 text-sm text-text">
                                    <Sparkles className="w-4 h-4 text-plex mt-0.5 shrink-0" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {Array.isArray(step.links) && step.links.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {step.links.map((link) => (
                                <a
                                    key={`${link.label}-${link.href}`}
                                    href={link.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 text-plex hover:underline text-sm font-medium"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                    {link.label}
                                </a>
                            ))}
                        </div>
                    )}

                    {step.requireAck && (
                        <label className="flex items-start gap-3 rounded-xl border border-border bg-background/50 p-4 cursor-pointer">
                            <input
                                type="checkbox"
                                className="accent-plex mt-1"
                                checked={acked.has(step.id)}
                                onChange={(e) => {
                                    setAcked((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(step.id);
                                        else next.delete(step.id);
                                        return next;
                                    });
                                }}
                            />
                            <span className="text-sm text-text">
                                <Shield className="w-4 h-4 inline text-plex mr-1" />
                                {t('onboarding.ackRules')}
                            </span>
                        </label>
                    )}

                    {step.type === 'finish' && (
                        <div className="rounded-xl border border-plex/30 bg-plex/10 p-4 text-sm text-text flex items-start gap-2">
                            <Gift className="w-4 h-4 text-plex mt-0.5 shrink-0" />
                            <span>{t('onboarding.finishHint')}</span>
                        </div>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-between">
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => setIndex((value) => Math.max(0, value - 1))}
                            className="inline-flex items-center gap-1 px-4 py-2.5 rounded-lg border border-border text-sm font-medium disabled:opacity-40 hover:border-plex transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            {t('onboarding.back')}
                        </button>
                        {preview && onCancelPreview && (
                            <button
                                type="button"
                                onClick={onCancelPreview}
                                className="px-4 py-2.5 rounded-lg border border-border text-sm font-medium hover:border-plex transition-colors"
                            >
                                {t('onboarding.closePreview')}
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        disabled={!canContinue || saving}
                        onClick={goNext}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-plex text-background font-bold disabled:opacity-50 hover:bg-plex-hover transition-colors"
                    >
                        {isLast ? (
                            <>
                                <Check className="w-4 h-4" />
                                {preview ? t('onboarding.closePreview') : t('onboarding.enterPortal')}
                            </>
                        ) : (
                            <>
                                {t('onboarding.next')}
                                <ChevronRight className="w-4 h-4" />
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
