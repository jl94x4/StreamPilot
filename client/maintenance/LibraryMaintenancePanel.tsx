import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../shared/api';
import { appConfirm } from '../shared/confirm';
import { CustomSelect, StyledCheckbox } from '../shared/ui';
import { useDiscoverI18n } from '../discovery/i18n';

const mkMaintenanceCondition = () => ({ field: 'daysSinceLastWatch', operator: 'greater_than', value: 30 });
const mkMaintenanceRule = () => ({
    id: `maintenance-${Date.now()}`,
    name: 'New Maintenance Rule',
    enabled: true,
    graceDays: 7,
    createdAt: new Date().toISOString(),
    settings: { dryRunByDefault: true, maxActionsPerRun: 25, requireConfirmForDestructive: true },
    collection: { enabled: false, nameTemplate: 'Leaving Soon - {{ruleName}}' },
    actions: { deleteFromArr: true, deleteFiles: true, unmonitor: false, qualityProfileId: 0 },
    filterTree: { logic: 'AND', conditions: [mkMaintenanceCondition()] }
});

const snapshotMaintenanceRules = (items: any[]) => JSON.stringify(
    (Array.isArray(items) ? items : []).map(({ overlay, _resetGrace, ...rule }) => rule)
);

const formatMaintenanceRunSummary = (run: any, t: (key: any, vars?: any) => string) => {
    const totals = run?.totals || {};
    const parts = [
        t('maintenance.summaries.matched', { count: totals.matched ?? 0 }),
        t('maintenance.summaries.deleted', { count: totals.deleted ?? 0 }),
        t('maintenance.summaries.skipped', { count: totals.skipped ?? 0 }),
        t('maintenance.summaries.failed', { count: totals.failed ?? 0 })
    ];
    return parts.join(', ');
};

const MaintenanceConditionRow: React.FC<{
    condition: any;
    fields: any[];
    onChange: (next: any) => void;
    onDelete: () => void;
}> = ({ condition, fields, onChange, onDelete }) => {
    const { t } = useDiscoverI18n();
    const fieldDef = fields.find((f: any) => f.field === condition.field) || fields[0];
    const operatorOptions = (fieldDef?.operators || ['equals']).map((op: string) => ({ label: op.replace(/_/g, ' '), value: op }));
    const selectedOperator = operatorOptions.find((o: any) => o.value === condition.operator)?.value || operatorOptions[0]?.value || 'equals';
    const updateField = (field: string) => {
        const nextField = fields.find((f: any) => f.field === field) || fields[0];
        const nextOperator = (nextField?.operators || ['equals'])[0];
        const defaultValue = nextField?.type === 'boolean' ? false : (nextField?.type === 'number' ? 0 : (nextField?.options?.[0] ?? ''));
        onChange({ ...condition, field, operator: nextOperator, value: defaultValue });
    };
    return (
        <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_2fr_auto] gap-2 p-1">
            <CustomSelect
                value={condition.field}
                onChange={updateField}
                options={fields.map((f: any) => ({ label: f.label, value: f.field }))}
                compact
            />
            <CustomSelect
                value={selectedOperator}
                onChange={(value) => onChange({ ...condition, operator: value })}
                options={operatorOptions}
                compact
            />
            {fieldDef?.type === 'boolean' ? (
                <CustomSelect
                    value={String(condition.value)}
                    onChange={(value) => onChange({ ...condition, value: value === 'true' })}
                     options={[{ label: t('maintenance.labels.true'), value: 'true' }, { label: t('maintenance.labels.false'), value: 'false' }]}
                    compact
                />
            ) : fieldDef?.type === 'select' ? (
                <CustomSelect
                    value={String(condition.value ?? '')}
                    onChange={(value) => onChange({ ...condition, value })}
                    options={(fieldDef.options || []).map((opt: string) => ({ label: opt, value: opt }))}
                    compact
                />
            ) : (
                <input
                    type={fieldDef?.type === 'number' ? 'number' : 'text'}
                    value={Array.isArray(condition.value) ? condition.value.join(',') : String(condition.value ?? '')}
                    onChange={(e) => {
                        const raw = e.target.value;
                        if (selectedOperator === 'between' || selectedOperator === 'in' || selectedOperator === 'not_in') {
                            const parsed = raw.split(',').map(v => v.trim()).filter(Boolean);
                            onChange({ ...condition, value: fieldDef?.type === 'number' ? parsed.map(Number) : parsed });
                        } else {
                            onChange({ ...condition, value: fieldDef?.type === 'number' ? Number(raw) : raw });
                        }
                    }}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background text-text outline-none focus:border-plex"
                     placeholder={selectedOperator === 'between' ? t('maintenance.labels.minMax') : (selectedOperator === 'in' || selectedOperator === 'not_in') ? t('maintenance.labels.values') : t('maintenance.labels.value')}
                />
            )}
             <button type="button" onClick={onDelete} className="px-2 py-1 text-[11px] rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10">{t('common.remove')}</button>
        </div>
    );
};

export const LibraryMaintenancePanel: React.FC<{ addToast: (m: string, t?: 'success' | 'error') => void; onRulesUpdated?: () => void }> = ({ addToast, onRulesUpdated }) => {
    const { t } = useDiscoverI18n();
    const [fields, setFields] = useState<any[]>([]);
    const [rules, setRules] = useState<any[]>([]);
    const [savedRulesSnapshot, setSavedRulesSnapshot] = useState('');
    const [runs, setRuns] = useState<any[]>([]);
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [indexInfo, setIndexInfo] = useState<any>(null);
    const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
    const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);
    const [resettingRuleId, setResettingRuleId] = useState<string | null>(null);
    const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);
    const [pinCollectionOnDestructiveRun, setPinCollectionOnDestructiveRun] = useState(false);
    const [excludingKey, setExcludingKey] = useState<string | null>(null);

    const selectedRule = useMemo(() => rules.find((rule: any) => rule.id === selectedRuleId) || null, [rules, selectedRuleId]);
    const selectedPreview = useMemo(() => previewData.find((preview: any) => preview.ruleId === selectedRuleId) || null, [previewData, selectedRuleId]);

    const refreshIndexInfo = useCallback(async () => {
        const data = await apiFetch('/api/maintenance/index');
        setIndexInfo(data);
    }, []);

    const refreshRuns = useCallback(async () => {
        const data = await apiFetch('/api/maintenance/runs');
        setRuns(Array.isArray(data) ? data : []);
    }, []);

    const refreshRules = useCallback(async () => {
        const data = await apiFetch('/api/maintenance/rules');
        const normalized = Array.isArray(data) ? data : [];
        setRules(normalized);
        setSavedRulesSnapshot(snapshotMaintenanceRules(normalized));
        setSelectedRuleId(prev => {
            if (!prev) return null;
            return normalized.some((rule: any) => rule.id === prev) ? prev : null;
        });
    }, []);

    const isRuleDirty = useCallback((ruleId: string) => {
        if (!savedRulesSnapshot) return false;
        try {
            const saved = JSON.parse(savedRulesSnapshot) as any[];
            const savedRule = saved.find((rule: any) => rule.id === ruleId);
            const currentRule = rules.find((rule: any) => rule.id === ruleId);
            if (!savedRule || !currentRule) return !!currentRule;
            const stripTransient = ({ overlay, _resetGrace, ...rest }: any) => rest;
            return JSON.stringify(stripTransient(savedRule)) !== JSON.stringify(stripTransient(currentRule));
        } catch {
            return false;
        }
    }, [rules, savedRulesSnapshot]);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [catalog, preview, index] = await Promise.all([
                apiFetch('/api/maintenance/filter-options'),
                apiFetch('/api/maintenance/preview', {
                    method: 'POST',
                    body: JSON.stringify({ includeAll: false, limit: 40, includeArrDiagnostics: true })
                }),
                apiFetch('/api/maintenance/index')
            ]);
            setFields(Array.isArray(catalog?.fields) ? catalog.fields : []);
            setPreviewData(Array.isArray(preview?.previews) ? preview.previews : []);
            setIndexInfo(index);
            await Promise.all([refreshRules(), refreshRuns()]);
        } catch (e: any) {
            addToast(e.message || t('maintenance.errors.load'), 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast, refreshRules, refreshRuns, t]);

    useEffect(() => { loadAll(); }, [loadAll]);

    const updateRule = (ruleId: string, patch: any) => setRules(prev => prev.map(rule => (rule.id === ruleId ? { ...rule, ...patch } : rule)));
    const addRule = (event?: React.MouseEvent) => {
        event?.preventDefault();
        event?.stopPropagation();
        const next = mkMaintenanceRule();
        setRules(prev => [...prev, next]);
        setSelectedRuleId(next.id);
    };
    const removeRule = (ruleId: string) => {
        setRules(prev => {
            const filtered = prev.filter(rule => rule.id !== ruleId);
            if (selectedRuleId === ruleId) {
                setSelectedRuleId(filtered[0]?.id || null);
            }
            return filtered;
        });
        setPreviewData(prev => prev.filter((p: any) => p.ruleId !== ruleId));
    };
    const deleteRule = async (ruleId: string, event?: React.MouseEvent) => {
        event?.preventDefault();
        event?.stopPropagation();
        const target = rules.find((rule: any) => rule.id === ruleId);
        if (!target) return;
        appConfirm(`${t('maintenance.confirmations.deleteFilter')} "${target.name || 'Unnamed Rule'}"?`, async () => {
            const previousRules = rules;
            const nextRules = rules.filter((rule: any) => rule.id !== ruleId);
            removeRule(ruleId);
            setSaving(true);
            try {
                await apiFetch('/api/maintenance/rules', { method: 'POST', body: JSON.stringify(nextRules) });
                addToast(`${t('maintenance.toasts.filterDeleted')}: ${target.name || 'Unnamed Rule'}.`);
                await Promise.all([refreshRules(), refreshRuns()]);
                onRulesUpdated?.();
            } catch (e: any) {
                setRules(previousRules);
                addToast(e.message || t('maintenance.errors.deleteFilter'), 'error');
            } finally {
                setSaving(false);
            }
        });
    };
    const addCondition = (ruleId: string) => {
        setRules(prev => prev.map(rule => {
            if (rule.id !== ruleId) return rule;
            const existing = Array.isArray(rule?.filterTree?.conditions) ? rule.filterTree.conditions : [];
            return { ...rule, filterTree: { logic: rule?.filterTree?.logic || 'AND', conditions: [...existing, mkMaintenanceCondition()] } };
        }));
    };
    const updateCondition = (ruleId: string, index: number, condition: any) => {
        setRules(prev => prev.map(rule => {
            if (rule.id !== ruleId) return rule;
            const conditions = [...(rule?.filterTree?.conditions || [])];
            conditions[index] = condition;
            return { ...rule, filterTree: { logic: rule?.filterTree?.logic || 'AND', conditions } };
        }));
    };
    const removeCondition = (ruleId: string, index: number) => {
        setRules(prev => prev.map(rule => {
            if (rule.id !== ruleId) return rule;
            const conditions = (rule?.filterTree?.conditions || []).filter((_: any, i: number) => i !== index);
            return { ...rule, filterTree: { logic: rule?.filterTree?.logic || 'AND', conditions } };
        }));
    };

    const saveRules = async (event?: React.MouseEvent) => {
        event?.preventDefault();
        event?.stopPropagation();
        setSaving(true);
        try {
            await apiFetch('/api/maintenance/rules', { method: 'POST', body: JSON.stringify(rules) });
            addToast(t('maintenance.toasts.rulesSaved'));
            await refreshRules();
            onRulesUpdated?.();
        } catch (e: any) {
            addToast(e.message || t('maintenance.errors.saveRules'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const rebuildIndex = async (event?: React.MouseEvent) => {
        event?.preventDefault();
        event?.stopPropagation();
        try {
            await apiFetch('/api/maintenance/index/rebuild', { method: 'POST' });
            addToast(t('maintenance.toasts.indexRebuilt'));
            await Promise.all([refreshIndexInfo(), loadAll()]);
        } catch (e: any) {
            addToast(e.message || t('maintenance.errors.rebuildIndex'), 'error');
        }
    };

    const runPreview = async (ruleId: string, event?: React.MouseEvent) => {
        event?.preventDefault();
        event?.stopPropagation();
        setPreviewRuleId(ruleId);
        try {
            const ruleDraft = rules.find((r: any) => r.id === ruleId);
            const payload = await apiFetch('/api/maintenance/preview', {
                method: 'POST',
                body: JSON.stringify({
                    ruleId,
                    rule: ruleDraft || undefined,
                    includeAll: true,
                    includeArrDiagnostics: true
                })
            });
            const previews = Array.isArray(payload?.previews) ? payload.previews : [];
            setPreviewData((prev) => {
                const map = new Map(prev.map((entry: any) => [entry.ruleId, entry]));
                previews.forEach((entry: any) => map.set(entry.ruleId, entry));
                return Array.from(map.values());
            });
            const current = previews.find((p: any) => p.ruleId === ruleId) || previews[0];
            const eligible = current?.eligibleCount ?? current?.totalMatches ?? 0;
            const actionable = current?.actionableCount ?? '—';
            const inGrace = current?.inGraceCount ?? 0;
            const graceDays = current?.graceRemainingDays ?? 0;
            const remaining = current?.remainingCount ?? ((current?.totalMatches ?? 0) - (current?.excludedCount ?? 0));
            const excluded = current?.excludedCount ?? 0;
            addToast(
                graceDays > 0
                    ? t('maintenance.summaries.previewAllInGrace', { matches: current?.totalMatches ?? 0, days: graceDays })
                    : t('maintenance.summaries.previewSummary', {
                        matches: current?.totalMatches ?? 0,
                        eligible,
                        mapped: actionable,
                        inGrace: inGrace ? t('maintenance.summaries.inGraceSuffix', { count: inGrace }) : '',
                    })
            );
            if (excluded > 0) {
                addToast(t('maintenance.summaries.previewRemaining', { remaining, excluded }));
            }
        } catch (e: any) {
            addToast(e.message || t('maintenance.errors.preview'), 'error');
        } finally {
            setPreviewRuleId(null);
        }
    };

    const runRule = async (ruleId: string, dryRun: boolean, event?: React.MouseEvent, extraOptions: Record<string, unknown> = {}) => {
        event?.preventDefault();
        event?.stopPropagation();
        if (isRuleDirty(ruleId)) {
            addToast(t('maintenance.errors.unsavedBeforeRun'), 'error');
            return;
        }
        const useCollectionPin = !dryRun && (pinCollectionOnDestructiveRun || extraOptions.createAndPinCollection === true);
        const bypassGrace = !dryRun && extraOptions.bypassGrace === true;
        const queueDelayedDelete = !dryRun && extraOptions.queueDelayedDelete === true;
        const delayDays = Number(extraOptions.delayDays || 7);

        const executeRun = async () => {
            setRunningRuleId(ruleId);
            try {
                const response = await apiFetch('/api/maintenance/run', {
                    method: 'POST',
                    body: JSON.stringify({
                        ruleId,
                        dryRun,
                        confirmToken: dryRun ? null : 'CONFIRM_MAINTENANCE_DELETE',
                        runOptions: dryRun ? {} : {
                            createAndPinCollection: useCollectionPin,
                            bypassGrace,
                            queueDelayedDelete,
                            delayDays,
                        }
                    })
                });
                const latestRun = Array.isArray(response?.runs) ? response.runs[0] : null;
                const summary = latestRun ? formatMaintenanceRunSummary(latestRun, t) : '';
                addToast(dryRun
                    ? (summary ? `${t('maintenance.status.dryRunCompleted')} (${summary}).` : `${t('maintenance.status.dryRunCompleted')}.`)
                    : queueDelayedDelete
                        ? (summary ? `${t('maintenance.status.queuedDelayed', { days: delayDays })} (${summary}).` : `${t('maintenance.status.queuedDelayed', { days: delayDays })}.`)
                        : (summary
                            ? (useCollectionPin ? `${t('maintenance.status.destructiveWithCollection')} (${summary}).` : `${t('maintenance.status.destructiveCompleted')} (${summary}).`)
                            : (useCollectionPin ? `${t('maintenance.status.executionWithCollection')}.` : `${t('maintenance.status.executionCompleted')}.`)));
                await Promise.all([refreshRuns(), runPreview(ruleId)]);
                onRulesUpdated?.();
            } catch (e: any) {
                addToast(e.message || t('maintenance.errors.run'), 'error');
            } finally {
                setRunningRuleId(null);
            }
        };

        if (!dryRun) {
            try {
                const preflight = await apiFetch('/api/maintenance/preflight', {
                    method: 'POST',
                    body: JSON.stringify({ ruleId })
                });
                if (!preflight.ok) {
                    addToast((preflight.errors || [t('maintenance.errors.preflight')]).join(' '), 'error');
                    return;
                }
                let confirmMessage = queueDelayedDelete
                    ? t('maintenance.confirmations.queueDelayed', { days: delayDays })
                    : bypassGrace
                        ? t('maintenance.confirmations.purgeRemaining')
                        : (useCollectionPin
                            ? t('maintenance.confirmations.destructiveWithCollection')
                            : t('maintenance.confirmations.destructive'));
                if (Array.isArray(preflight.warnings) && preflight.warnings.length) {
                    confirmMessage += `\n\n${t('maintenance.summaries.warnings')}\n- ${preflight.warnings.join('\n- ')}`;
                }
                const preview = preflight.preview;
                if (preview) {
                    const remaining = Number(preview.remainingCount ?? preview.wouldProcessCount ?? 0);
                    const processCount = (queueDelayedDelete || bypassGrace)
                        ? Math.min(Number(preview.maxActionsPerRun || remaining), remaining)
                        : preview.wouldProcessCount;
                    confirmMessage += `\n\n${t('maintenance.summaries.wouldProcess', { count: processCount, mapped: preview.actionableCount, unmapped: preview.unactionableCount })}`;
                    if (!queueDelayedDelete && !bypassGrace && preview.graceRemainingDays > 0) {
                        confirmMessage += ` ${t('maintenance.summaries.stillInGrace', { count: preview.inGraceCount, days: preview.graceRemainingDays })}`;
                    }
                }
                appConfirm(confirmMessage, executeRun);
            } catch (e: any) {
                addToast(e.message || t('maintenance.errors.preflight'), 'error');
            }
            return;
        }

        await executeRun();
    };

    const resetRuleGraceTimer = async (ruleId: string, event?: React.MouseEvent) => {
        event?.preventDefault();
        event?.stopPropagation();
        const target = rules.find((rule: any) => rule.id === ruleId);
        if (!target) return;
        setResettingRuleId(ruleId);
        try {
            await apiFetch('/api/maintenance/rules/reset-grace', { method: 'POST', body: JSON.stringify({ ruleId }) });
            addToast(`${t('maintenance.summaries.graceTimerReset')} for "${target.name || 'Unnamed Rule'}".`);
            await Promise.all([refreshRules(), runPreview(ruleId)]);
            onRulesUpdated?.();
        } catch (e: any) {
            addToast(e.message || t('maintenance.errors.resetGrace'), 'error');
        } finally {
            setResettingRuleId(null);
        }
    };

    const toggleRuleEnabled = async (ruleId: string, event?: React.MouseEvent) => {
        event?.preventDefault();
        event?.stopPropagation();
        const target = rules.find((rule: any) => rule.id === ruleId);
        if (!target) return;
        const previousRules = rules;
        const nextEnabled = target.enabled === false;
        const nextRules = rules.map((rule: any) => rule.id === ruleId ? { ...rule, enabled: nextEnabled } : rule);
        setRules(nextRules);
        setTogglingRuleId(ruleId);
        try {
            await apiFetch('/api/maintenance/rules', { method: 'POST', body: JSON.stringify(nextRules) });
            addToast(`${t(nextEnabled ? 'maintenance.toasts.filterEnabled' : 'maintenance.toasts.filterDisabled')}: "${target.name || 'Unnamed Rule'}".`);
            await Promise.all([refreshRules(), runPreview(ruleId)]);
            onRulesUpdated?.();
        } catch (e: any) {
            setRules(previousRules);
            addToast(e.message || t('maintenance.errors.toggleFilter'), 'error');
        } finally {
            setTogglingRuleId(null);
        }
    };

    const togglePreviewExclusion = async (item: any) => {
        const key = String(item?.ratingKey || '').trim();
        if (!key || excludingKey) return;
        const nextExcluded = !item.excluded;
        setExcludingKey(key);
        try {
            await apiFetch('/api/maintenance/exclusions/rating-key', {
                method: 'POST',
                body: JSON.stringify({ ratingKey: key, exclude: nextExcluded }),
            });
            setPreviewData((prev) => prev.map((preview: any) => {
                if (preview.ruleId !== selectedRuleId) return preview;
                const sample = (preview.sample || []).map((row: any) => (
                    String(row.ratingKey) === key ? { ...row, excluded: nextExcluded, eligible: nextExcluded ? false : row.eligible } : row
                ));
                const excludedCount = Math.max(0, Number(preview.excludedCount || 0) + (nextExcluded ? 1 : -1));
                const remainingCount = Math.max(0, Number(preview.remainingCount ?? ((preview.totalMatches || 0) - (preview.excludedCount || 0))) + (nextExcluded ? -1 : 1));
                return { ...preview, sample, excludedCount, remainingCount };
            }));
            addToast(nextExcluded
                ? t('maintenance.exclusions.excludedTitle', { title: item.title })
                : t('maintenance.exclusions.removed', { title: item.title }));
        } catch (e: any) {
            addToast(e.message || t('maintenance.errors.toggleExclude'), 'error');
        } finally {
            setExcludingKey(null);
        }
    };

    if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-plex border-t-transparent rounded-full animate-spin" /></div>;

    return (
        <div className="mb-8 animate-fade-in space-y-6" onSubmitCapture={(e) => e.preventDefault()}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div>
                    <h3 className="text-xl font-bold text-plex">{t('maintenance.rules.title')}</h3>
                    <p className="text-xs text-muted mt-1">{t('maintenance.rules.description')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className="px-2.5 py-1.5 text-xs bg-border text-text rounded-md font-semibold hover:bg-opacity-80" onClick={(e) => rebuildIndex(e)}>{t('maintenance.actions.rebuildIndex')}</button>
                    <button type="button" className="px-2.5 py-1.5 text-xs bg-border text-text rounded-md font-semibold hover:bg-opacity-80" onClick={(e) => addRule(e)}>{t('maintenance.actions.addFilter')}</button>
                </div>
            </div>

            <div className="bg-background/30 border border-white/5 rounded-xl p-3 text-xs text-muted">
                {t('maintenance.labels.index')}: <span className="text-text font-semibold">{indexInfo?.itemCount || 0}</span> {t('maintenance.labels.mediaItems')}
                {indexInfo?.generatedAt ? <> · {t('maintenance.labels.lastBuild')}: <span className="text-text">{new Date(indexInfo.generatedAt).toLocaleString()}</span></> : null}
                {' '}· {t('maintenance.labels.requestRecords')}: <span className="text-text font-semibold">{indexInfo?.requestItemCount || 0}</span>
            </div>

            <div className="glass-card-sm p-4">
                <p className="text-xs text-muted uppercase tracking-wider font-bold mb-3">{t('maintenance.rules.savedFilters')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {rules.map((rule: any) => {
                        const preview = previewData.find((p: any) => p.ruleId === rule.id);
                        return (
                            <div key={rule.id} className={`border rounded-lg p-3 transition-colors ${selectedRuleId === rule.id ? 'border-plex bg-plex/5' : 'border-white/5 bg-background/30'}`}>
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-semibold text-text">{rule.name || 'Unnamed Rule'}</p>
                                <p className="text-xs text-muted mt-1">{t('maintenance.summaries.conditions', { count: (rule?.filterTree?.conditions || []).length })}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => toggleRuleEnabled(rule.id, e)}
                                        disabled={togglingRuleId === rule.id}
                                        className={`inline-flex items-center gap-2 px-2 py-1 rounded border text-[11px] font-semibold transition-colors disabled:opacity-60 ${rule.enabled !== false ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-white/5 bg-background/30 text-muted'}`}
                                        title={`${t('maintenance.labels.enabled')} / ${t('maintenance.labels.disabled')}`}
                                    >
                                        <span className={`relative inline-flex h-3.5 w-7 rounded-full transition-colors ${rule.enabled !== false ? 'bg-green-500/40' : 'bg-border'}`}>
                                            <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${rule.enabled !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </span>
                                        {togglingRuleId === rule.id ? t('maintenance.statuses.saving') : (rule.enabled !== false ? t('maintenance.labels.enabled') : t('maintenance.labels.disabled'))}
                                    </button>
                                </div>
                                <p className="text-[11px] text-muted mt-2">{t('maintenance.labels.matches')}: {preview?.totalMatches ?? '—'}</p>
                                {(preview?.graceRemainingDays ?? 0) > 0 ? (
                                    <p className="text-[11px] text-amber-300 mt-1">{t('maintenance.labels.grace')}: {t('maintenance.summaries.dayLeft', { count: preview.graceRemainingDays })}</p>
                                ) : (
                                    <p className="text-[11px] text-muted mt-1">
                                        {t('maintenance.labels.eligible')}: {preview?.eligibleCount ?? '—'} · Sonarr/Radarr: {preview?.actionableCount ?? '—'} {t('maintenance.labels.mapped')}
                                        {(preview?.unactionableCount ?? 0) > 0 ? `, ${preview.unactionableCount} ${t('maintenance.labels.unmapped').toLowerCase()}` : ''}
                                    </p>
                                )}
                                <p className="text-[11px] text-muted mt-1" title="Grace countdown starts when the rule is created.">
                                        {t('maintenance.labels.grace')}: {Math.max(0, Number(rule?.graceDays || 0))} {rule?.createdAt ? `${t('maintenance.summaries.from')} ${new Date(rule.createdAt).toLocaleDateString()}` : t('maintenance.summaries.fromCreation')}
                                </p>
                                <div className="flex gap-2 mt-3">
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 text-xs rounded border border-border text-text hover:border-plex/50"
                                        onClick={() => setSelectedRuleId(rule.id)}
                                    >
                                        {t('maintenance.actions.edit')}
                                    </button>
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 text-xs rounded border border-border text-text hover:border-plex/50"
                                        onClick={(e) => runPreview(rule.id, e)}
                                    >
                                        {t('maintenance.actions.refresh')}
                                    </button>
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 text-xs rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
                                        title={t('maintenance.labels.resetGraceHint')}
                                        onClick={(e) => resetRuleGraceTimer(rule.id, e)}
                                        disabled={saving || resettingRuleId === rule.id}
                                    >
                                        {resettingRuleId === rule.id ? t('maintenance.statuses.resetting') : t('maintenance.actions.reset')}
                                    </button>
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 text-xs rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                                        onClick={(e) => deleteRule(rule.id, e)}
                                        disabled={saving}
                                    >
                                        {t('maintenance.actions.delete')}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    {rules.length === 0 && <span className="text-sm text-muted">{t('maintenance.rules.noFilters')}</span>}
                </div>
            </div>

            {selectedRule && (
                <div className="glass-card-sm p-4 space-y-4 w-full">
                    {isRuleDirty(selectedRule.id) && (
                        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs rounded-lg px-3 py-2">
                            {t('maintenance.rules.unsaved')}
                        </div>
                    )}
                    <div className="flex items-end justify-between gap-3">
                        <div className="flex-1">
                            <label className="text-xs text-muted font-bold uppercase mb-1 block">{t('maintenance.labels.filterName')}</label>
                            <input
                                value={selectedRule.name || ''}
                                onChange={(e) => updateRule(selectedRule.id, { name: e.target.value })}
                                className="w-full px-2.5 py-1.5 text-xs rounded border border-border bg-card text-text outline-none focus:border-plex"
                                placeholder={t('maintenance.labels.filterName')}
                            />
                        </div>
                        <div className="flex gap-2">
                            <button type="button" className="px-2.5 py-1.5 text-xs border border-border text-text rounded hover:bg-white/5" onClick={() => setSelectedRuleId(null)}>{t('maintenance.actions.closeEditor')}</button>
                            <button
                                type="button"
                                className="px-2.5 py-1.5 text-xs border border-red-500/40 text-red-300 rounded hover:bg-red-500/10 disabled:opacity-50"
                                onClick={(e) => deleteRule(selectedRule.id, e)}
                                disabled={saving}
                            >
                                {t('maintenance.actions.deleteFilter')}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                            <label className="text-xs text-muted font-bold uppercase" title={t('maintenance.labels.matchLogicHint')}>{t('maintenance.labels.matchLogic')}</label>
                            <CustomSelect
                                value={selectedRule?.filterTree?.logic || 'AND'}
                                onChange={(value) => updateRule(selectedRule.id, { filterTree: { ...(selectedRule.filterTree || {}), logic: value } })}
                                options={[{ label: 'AND', value: 'AND' }, { label: 'OR', value: 'OR' }, { label: 'NOT', value: 'NOT' }]}
                                compact
                            />
                        </div>
                        <div>
                            <label className="text-xs text-muted font-bold uppercase" title={t('maintenance.labels.graceHint')}>{t('maintenance.labels.graceDays')}</label>
                            <input type="number" min={0} className="appearance-none text-[16px] leading-5 w-full px-3 py-2 text-[16px] rounded-lg border border-border bg-card text-text" value={selectedRule?.graceDays || 0} onChange={(e) => updateRule(selectedRule.id, { graceDays: Number(e.target.value) })} />
                        </div>
                        <div>
                            <label className="text-xs text-muted font-bold uppercase">{t('maintenance.labels.maxActions')}</label>
                            <input type="number" min={1} className="appearance-none text-[16px] leading-5 w-full px-3 py-2 text-[16px] rounded-lg border border-border bg-card text-text" value={selectedRule?.settings?.maxActionsPerRun || 25} onChange={(e) => updateRule(selectedRule.id, { settings: { ...(selectedRule.settings || {}), maxActionsPerRun: Number(e.target.value) } })} />
                        </div>
                        <div>
                            <label className="text-xs text-muted font-bold uppercase">{t('maintenance.labels.collectionName')}</label>
                            <input type="text" className="appearance-none text-[16px] leading-5 w-full px-3 py-2 text-[16px] rounded-lg border border-border bg-card text-text" value={selectedRule?.collection?.nameTemplate || 'Leaving Soon - {{ruleName}}'} onChange={(e) => updateRule(selectedRule.id, { collection: { ...(selectedRule.collection || {}), nameTemplate: e.target.value } })} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <StyledCheckbox checked={selectedRule?.collection?.enabled !== false} onChange={(checked) => updateRule(selectedRule.id, { collection: { ...(selectedRule.collection || {}), enabled: checked } })} label={t('maintenance.options.createCollection')} />
                        <StyledCheckbox checked={selectedRule?.actions?.deleteFromArr !== false} onChange={(checked) => updateRule(selectedRule.id, { actions: { ...(selectedRule.actions || {}), deleteFromArr: checked } })} label={t('maintenance.options.deleteViaArr')} />
                        <StyledCheckbox checked={!!selectedRule?.actions?.deleteFiles} onChange={(checked) => updateRule(selectedRule.id, { actions: { ...(selectedRule.actions || {}), deleteFiles: checked } })} label={t('maintenance.options.deleteFiles')} />
                    </div>

                    <div className="space-y-2">
                        {(selectedRule?.filterTree?.conditions || []).map((cond: any, idx: number) => (
                            <MaintenanceConditionRow key={`${selectedRule.id}-${idx}`} condition={cond} fields={fields} onChange={(next) => updateCondition(selectedRule.id, idx, next)} onDelete={() => removeCondition(selectedRule.id, idx)} />
                        ))}
                        <button type="button" onClick={() => addCondition(selectedRule.id)} className="px-2 py-1 text-[11px] border border-border rounded-lg text-plex font-semibold">{t('maintenance.actions.addCondition')}</button>
                    </div>

                    <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                        <StyledCheckbox checked={pinCollectionOnDestructiveRun} onChange={setPinCollectionOnDestructiveRun} label={t('maintenance.options.pinCollection')} />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" className="px-2 py-1 text-[11px] bg-plex text-background rounded-md font-semibold hover:opacity-90 disabled:opacity-50" onClick={(e) => saveRules(e)} disabled={saving}>
                            {saving ? t('maintenance.statuses.saving') : t('maintenance.actions.saveFilter')}
                        </button>
                        <button type="button" className="px-2 py-1 text-[11px] bg-border text-text rounded-md font-semibold hover:bg-opacity-80 disabled:opacity-50" onClick={(e) => runPreview(selectedRule.id, e)} disabled={previewRuleId === selectedRule.id}>{previewRuleId === selectedRule.id ? t('maintenance.statuses.refreshingPreview') : t('maintenance.actions.previewMatches')}</button>
                        <button type="button" className="px-2 py-1 text-[11px] bg-blue-500/20 text-blue-300 rounded-md font-semibold border border-blue-500/30 disabled:opacity-50" onClick={(e) => runRule(selectedRule.id, true, e)} disabled={runningRuleId === selectedRule.id}>{runningRuleId === selectedRule.id ? t('maintenance.statuses.running') : t('maintenance.actions.runDry')}</button>
                        <button type="button" className="px-2 py-1 text-[11px] bg-red-500/20 text-red-300 rounded-md font-semibold border border-red-500/30 disabled:opacity-50" onClick={(e) => runRule(selectedRule.id, false, e)} disabled={runningRuleId === selectedRule.id}>{runningRuleId === selectedRule.id ? t('maintenance.statuses.executing') : t('maintenance.actions.runDestructive')}</button>
                    </div>
                </div>
            )}

            <div className="glass-card-sm p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                    <h4 className="font-bold text-text">{t('maintenance.labels.matchedTitles')}</h4>
                        <p className="text-[11px] text-muted mt-1 max-w-2xl">{t('maintenance.rules.previewHint')}</p>
                    </div>
                    <div className="text-right">
                        <span className="text-xs px-2 py-1 rounded bg-plex/20 text-plex font-semibold">{t('maintenance.summaries.matched', { count: selectedPreview?.totalMatches || 0 })}</span>
                        {selectedPreview && (
                            <p className="text-[11px] text-muted mt-1">
                                {t('maintenance.summaries.remainingExcluded', {
                                    remaining: selectedPreview.remainingCount ?? Math.max(0, (selectedPreview.totalMatches || 0) - (selectedPreview.excludedCount || 0)),
                                    excluded: selectedPreview.excludedCount || 0,
                                })}
                                {(selectedPreview.graceRemainingDays ?? 0) > 0
                                    ? ` · ${t('maintenance.summaries.allInGrace', { count: selectedPreview.graceRemainingDays })}`
                                    : ` · ${selectedPreview.eligibleCount ?? 0} ${t('maintenance.labels.eligible').toLowerCase()} · ${selectedPreview.actionableCount ?? 0} ${t('maintenance.labels.mapped').toLowerCase()}`}
                            </p>
                        )}
                    </div>
                </div>
                {selectedRule && selectedPreview ? (
                    <div className="flex flex-wrap gap-2 mb-3">
                        <button
                            type="button"
                            className="px-2 py-1 text-[11px] bg-red-500/20 text-red-300 rounded-md font-semibold border border-red-500/30 disabled:opacity-50"
                            disabled={runningRuleId === selectedRule.id || !(selectedPreview.remainingCount ?? selectedPreview.totalMatches)}
                            onClick={(e) => runRule(selectedRule.id, false, e, { bypassGrace: true })}
                        >
                            {t('maintenance.actions.purgeRemaining')}
                        </button>
                        <button
                            type="button"
                            className="px-2 py-1 text-[11px] bg-plex/20 text-plex rounded-md font-semibold border border-plex/30 disabled:opacity-50"
                            disabled={runningRuleId === selectedRule.id || !(selectedPreview.remainingCount ?? selectedPreview.totalMatches)}
                            onClick={(e) => runRule(selectedRule.id, false, e, {
                                queueDelayedDelete: true,
                                createAndPinCollection: true,
                                delayDays: Math.max(1, Number(selectedRule.graceDays || 7)),
                            })}
                        >
                            {t('maintenance.actions.queueDelayed', { days: Math.max(1, Number(selectedRule.graceDays || 7)) })}
                        </button>
                    </div>
                ) : null}
                {!selectedRuleId ? (
                    <p className="text-sm text-muted">{t('maintenance.rules.selectFilter')}</p>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-3 max-h-[640px] overflow-y-auto custom-scrollbar pr-1">
                        {(selectedPreview?.sample || []).map((item: any) => (
                            <div key={`${selectedRuleId}-${item.ratingKey}`} className={`bg-background/30 border rounded-lg overflow-hidden ${item.excluded ? 'border-red-500/50 opacity-70' : 'border-white/5'}`}>
                                <div className="aspect-[2/3] bg-black/40 relative">
                                    {item.thumb ? (
                                        <img
                                            src={`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=240&height=360`}
                                            alt={item.title}
                                            loading="lazy"
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-xs text-muted">{t('maintenance.labels.noPoster')}</div>
                                    )}
                                    {item.excluded ? (
                                        <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-red-600/95 text-white font-bold">
                                            {t('maintenance.exclusions.excluded')}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="p-2">
                                    <p className="text-xs text-text line-clamp-2">{item.title}</p>
                                    <p className="text-[11px] text-muted mt-1">{item.libraryTitle || item.mediaType}</p>
                                    {item.mediaType === 'show' && Number.isFinite(Number(item.daysSinceLastEpisodeAired)) ? (
                                        <p className="text-[10px] text-muted mt-1">
                                            {t('maintenance.calendar.lastEpisodeAired')} {Number(item.daysSinceLastEpisodeAired)}{t('maintenance.calendar.ago')}
                                        </p>
                                    ) : null}
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {item.excluded ? null : item.eligible === false ? (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{t('maintenance.labels.grace')}</span>
                                        ) : null}
                                        {item.arrResolvable ? (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-300">
                                                {item.arrInstanceName || item.arrType || 'ARR'}
                                            </span>
                                        ) : item.excluded || item.eligible === false ? null : (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">{t('maintenance.labels.unmapped')}</span>
                                        )}
                                        {item.arrAmbiguous && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300" title={item.arrWarning || t('maintenance.labels.instanceMappingHint')}>
                                                {t('maintenance.labels.ambiguous')}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className={`mt-2 text-[10px] font-semibold ${item.excluded ? 'text-muted hover:text-text' : 'text-plex hover:text-plex-hover'} disabled:opacity-50`}
                                        disabled={excludingKey === String(item.ratingKey)}
                                        onClick={() => togglePreviewExclusion(item)}
                                    >
                                        {item.excluded ? t('maintenance.exclusions.unexclude') : t('maintenance.exclusions.exclude')}
                                    </button>
                                </div>
                            </div>
                        ))}
                        {!(selectedPreview?.sample || []).length && (
                            <p className="text-sm text-muted col-span-full">{t('maintenance.candidates.noResults')}</p>
                        )}
                    </div>
                )}
            </div>

        </div>
    );
};
