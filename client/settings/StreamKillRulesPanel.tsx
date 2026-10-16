import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Copy, ChevronUp, ChevronDown } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { appConfirm } from '../shared/confirm';
import { CustomSelect } from '../shared/ui';
import { Loader, ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { SettingHint } from './SettingHint';
import { useDiscoverI18n } from '../discovery/i18n';
import type { User, AuditEntry, DeletedUser } from '../shared/types';
import { formatDateTime, formatEventName, hexToRgb, getDaysUntilExpiry, addMonths, addYears, formatDate } from '../shared/format';
// ─────────────────────────────────────────────────────────────────────────────
// Stream Kill Rules Panel
// ─────────────────────────────────────────────────────────────────────────────
const RULE_FIELDS = [
    { value: 'isTranscoding', type: 'bool' as const },
    { value: 'videoResolution', type: 'select' as const, options: ['4k', '1080', '720', '480', 'sd'] },
    { value: 'transcodeVideoDecision', type: 'select' as const, options: ['transcode', 'copy', 'directplay'] },
    { value: 'mediaType', type: 'select' as const, options: ['movie', 'episode', 'track'] },
    { value: 'state', type: 'select' as const, options: ['playing', 'paused', 'buffering'] },
    { value: 'sessionLocation', type: 'select' as const, options: ['lan', 'wan', 'cellular'] },
    { value: 'videoCodec', type: 'text' as const },
    { value: 'audioCodec', type: 'text' as const },
    { value: 'bandwidth', type: 'number' as const },
    { value: 'user', type: 'text' as const },
    { value: 'playerProduct', type: 'text' as const },
    { value: 'playerTitle', type: 'text' as const },
];
const KR_OP_TEXT = [{ value: 'equals' }, { value: 'not_equals' }, { value: 'contains' }, { value: 'not_contains' }];
const KR_OP_NUMBER = [{ value: 'equals' }, { value: 'not_equals' }, { value: 'greater_than' }, { value: 'less_than' }];
const KR_OP_BOOL = [{ value: 'equals', labelKey: 'settings.streamKillRules.operators.is' }];
const KR_OP_SELECT = [{ value: 'equals' }, { value: 'not_equals' }];
const KR_FIELD_LABEL_KEYS: Record<string, string> = {
    isTranscoding: 'settings.streamKillRules.fields.isTranscoding',
    videoResolution: 'settings.streamKillRules.fields.videoResolution',
    transcodeVideoDecision: 'settings.streamKillRules.fields.transcodeVideoDecision',
    mediaType: 'settings.streamKillRules.fields.mediaType',
    state: 'settings.streamKillRules.fields.state',
    sessionLocation: 'settings.streamKillRules.fields.sessionLocation',
    videoCodec: 'settings.streamKillRules.fields.videoCodec',
    audioCodec: 'settings.streamKillRules.fields.audioCodec',
    bandwidth: 'settings.streamKillRules.fields.bandwidth',
    user: 'settings.streamKillRules.fields.user',
    playerProduct: 'settings.streamKillRules.fields.playerProduct',
    playerTitle: 'settings.streamKillRules.fields.playerTitle',
};
const KR_OPERATOR_LABEL_KEYS: Record<string, string> = {
    equals: 'settings.streamKillRules.operators.equals',
    not_equals: 'settings.streamKillRules.operators.not_equals',
    contains: 'settings.streamKillRules.operators.contains',
    not_contains: 'settings.streamKillRules.operators.not_contains',
    greater_than: 'settings.streamKillRules.operators.greater_than',
    less_than: 'settings.streamKillRules.operators.less_than',
};
const KR_OPTION_LABEL_KEYS: Record<string, string> = {
    transcode: 'settings.streamKillRules.options.transcode',
    copy: 'settings.streamKillRules.options.copy',
    directplay: 'settings.streamKillRules.options.directplay',
    movie: 'settings.streamKillRules.options.movie',
    episode: 'settings.streamKillRules.options.episode',
    track: 'settings.streamKillRules.options.track',
    playing: 'settings.streamKillRules.options.playing',
    paused: 'settings.streamKillRules.options.paused',
    buffering: 'settings.streamKillRules.options.buffering',
    cellular: 'settings.streamKillRules.options.cellular',
};
const KR_LOGIC_LABEL_KEYS: Record<string, string> = {
    AND: 'settings.streamKillRules.logic.and',
    OR: 'settings.streamKillRules.logic.or',
};
function krGetOps(field: any) {
    if (!field) return KR_OP_TEXT;
    if (field.type === 'bool') return KR_OP_BOOL;
    if (field.type === 'number') return KR_OP_NUMBER;
    if (field.type === 'select') return KR_OP_SELECT;
    return KR_OP_TEXT;
}
function krMkCond() { return { id: (typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2)), field: 'isTranscoding', operator: 'equals', value: 'true' }; }
function krMkRule(name: string, killMessage: string): any { return { id: Date.now().toString(), name, enabled: true, conditionLogic: 'AND', conditions: [krMkCond()], killMessage }; }

const KRConditionRow: React.FC<{ cond: any; onCh: (c: any) => void; onDel: () => void }> = ({ cond, onCh, onDel }) => {
    const { t } = useDiscoverI18n();
    const fd = RULE_FIELDS.find(f => f.value === cond.field);
    const ops = krGetOps(fd);
    const onField = (v: string) => {
        const def = RULE_FIELDS.find(f => f.value === v);
        const dv = def?.type === 'bool' ? 'true' : (def && 'options' in def && def.options ? def.options[0] : '');
        onCh({ ...cond, field: v, value: dv, operator: krGetOps(def)[0].value });
    };
    const fieldOptions = RULE_FIELDS.map(f => ({ label: t(KR_FIELD_LABEL_KEYS[f.value]), value: f.value }));
    const opOptions = ops.map(o => ({ label: t('labelKey' in o ? o.labelKey : KR_OPERATOR_LABEL_KEYS[o.value]), value: o.value }));
    const boolOptions = [{ label: t('settings.streamKillRules.boolean.yesTrue'), value: 'true' }, { label: t('settings.streamKillRules.boolean.noFalse'), value: 'false' }];
    const selectOptions = ('options' in (fd ?? {}) && (fd as any).options)
        ? (fd as any).options.map((o: string) => ({ label: KR_OPTION_LABEL_KEYS[o] ? t(KR_OPTION_LABEL_KEYS[o]) : o.toUpperCase(), value: o }))
        : [];

    return (
        <div className="flex flex-wrap items-center gap-2 py-2 border-b border-border/30 last:border-b-0">
            <CustomSelect
                value={cond.field}
                onChange={v => onField(v)}
                options={fieldOptions}
                className="flex-shrink-0 min-w-[160px]"
            />
            <CustomSelect
                value={cond.operator}
                onChange={v => onCh({ ...cond, operator: v })}
                options={opOptions}
                className="flex-shrink-0 min-w-[130px]"
            />
            {fd?.type === 'bool' ? (
                <CustomSelect
                    value={cond.value}
                    onChange={v => onCh({ ...cond, value: v })}
                    options={boolOptions}
                    className="flex-1 min-w-[110px]"
                />
            ) : fd?.type === 'select' ? (
                <CustomSelect
                    value={cond.value}
                    onChange={v => onCh({ ...cond, value: v })}
                    options={selectOptions}
                    className="flex-1 min-w-[110px]"
                />
            ) : (
                <input type={fd?.type === 'number' ? 'number' : 'text'} value={cond.value}
                    onChange={e => onCh({ ...cond, value: e.target.value })}
                    placeholder={fd?.type === 'number' ? t('settings.streamKillRules.placeholders.numberExample') : t('settings.streamKillRules.placeholders.playerExample')}
                    className="flex-1 min-w-[100px] bg-background border border-border text-text rounded-lg px-3 py-2 text-sm focus:border-plex focus:ring-1 focus:ring-plex outline-none transition-all" />
            )}
            <button onClick={onDel} title={t('settings.streamKillRules.actions.remove')} className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
        </div>
    );
};


export const StreamKillRulesPanel: React.FC<{ addToast: (m: string, t?: 'success' | 'error') => void; registerSaveHandler?: (handler: (() => Promise<boolean>) | null) => void }> = ({ addToast, registerSaveHandler }) => {
    const { t } = useDiscoverI18n();
    const tRef = useRef(t);
    tRef.current = t;
    const [rules, setRules] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        apiFetch('/api/kill-rules').then(d => setRules(Array.isArray(d) ? d : []))
            .catch(() => addToast(tRef.current('settings.streamKillRules.toasts.loadFailed'), 'error'))
            .finally(() => setLoading(false));
    }, []);

    const saveRules = async (r: any[]) => {
        setSaving(true);
        try {
            await apiFetch('/api/kill-rules', { method: 'POST', body: JSON.stringify(r) });
            addToast(tRef.current('settings.streamKillRules.toasts.saved'));
            return true;
        } catch {
            addToast(tRef.current('settings.streamKillRules.toasts.saveFailed'), 'error');
            return false;
        } finally { setSaving(false); }
    };
    const addRule = () => { const r = krMkRule(t('settings.streamKillRules.defaults.newRuleName'), t('settings.streamKillRules.defaults.killMessage')); const u = [...rules, r]; setRules(u); setExpanded(r.id); };
    const upd = (id: string, p: any) => setRules(prev => prev.map(r => r.id === id ? { ...r, ...p } : r));
    const del = (id: string) => setRules(prev => prev.filter(r => r.id !== id));
    const addCond = (id: string) => setRules(prev => prev.map(r => r.id === id ? { ...r, conditions: [...(r.conditions ?? []), krMkCond()] } : r));
    const updCond = (rId: string, i: number, c: any) => setRules(prev => prev.map(r => { if (r.id !== rId) return r; const cs = [...(r.conditions ?? [])]; cs[i] = c; return { ...r, conditions: cs }; }));
    const delCond = (rId: string, i: number) => setRules(prev => prev.map(r => r.id === rId ? { ...r, conditions: (r.conditions ?? []).filter((_: any, j: number) => j !== i) } : r));

    useEffect(() => {
        if (!registerSaveHandler) return;
        registerSaveHandler(() => saveRules(rules));
        return () => registerSaveHandler(null);
    }, [registerSaveHandler, rules]);

    if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-plex border-t-transparent rounded-full animate-spin" /></div>;

    return (
        <div className="mb-8 animate-fade-in">
            <h3 className="text-xl font-bold text-plex mb-1 border-b border-border pb-2 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                {t('settings.streamKillRules.title')}
            </h3>
            <p className="text-sm text-muted mb-6 leading-relaxed">
                {t('settings.streamKillRules.description.beforeInterval')}<strong className="text-text">{t('settings.streamKillRules.description.interval')}</strong>{t('settings.streamKillRules.description.afterInterval')}<strong className="text-plex">{t('settings.streamKillRules.logic.and')}</strong>{t('settings.streamKillRules.description.andAllMatch')}<strong className="text-plex">{t('settings.streamKillRules.logic.or')}</strong>{t('settings.streamKillRules.description.orAnyMatch')}{t('settings.streamKillRules.description.afterLogic')}
            </p>
            {rules.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-border rounded-xl text-center gap-3 mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted opacity-40"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    <p className="text-muted font-medium">{t('settings.streamKillRules.empty.title')}</p>
                    <p className="text-muted text-sm">{t('settings.streamKillRules.empty.description')}</p>
                </div>
            )}
            <div className="flex flex-col gap-4">
                {rules.map(rule => {
                    const isOpen = expanded === rule.id;
                    return (
                        <div key={rule.id} className={`border-b border-border/40 pb-4 mb-4 last:border-b-0 last:mb-0 transition-opacity duration-200 ${rule.enabled ? '' : 'opacity-70'}`}>
                            <div className="flex items-center gap-3 py-2 cursor-pointer select-none" onClick={() => setExpanded(isOpen ? null : rule.id)}>
                                <button onClick={e => { e.stopPropagation(); upd(rule.id, { enabled: !rule.enabled }); }}
                                    className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${rule.enabled ? 'bg-plex' : 'bg-border'}`}>
                                    <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${rule.enabled ? 'translate-x-5' : ''}`} />
                                </button>
                                <div className="flex-1 min-w-0">
                                    <input value={rule.name} onChange={e => { e.stopPropagation(); upd(rule.id, { name: e.target.value }); }} onClick={e => e.stopPropagation()}
                                        className="bg-transparent border-none outline-none text-text font-bold text-sm w-full placeholder-muted/50" placeholder={t('settings.streamKillRules.placeholders.ruleName')} />
                                    <p className="text-muted text-xs mt-0.5">
                                        {t('settings.streamKillRules.rule.conditionCount', { count: rule.conditions?.length || 0 })} · {t('settings.streamKillRules.rule.logic')} <span className="text-plex font-bold">{KR_LOGIC_LABEL_KEYS[rule.conditionLogic] ? t(KR_LOGIC_LABEL_KEYS[rule.conditionLogic]) : rule.conditionLogic}</span> · <span className={rule.enabled ? 'text-green-400 font-bold' : 'text-muted'}>{rule.enabled ? t('settings.streamKillRules.status.active') : t('settings.streamKillRules.status.disabled')}</span>
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <button onClick={e => { e.stopPropagation(); del(rule.id); }} title={t('settings.streamKillRules.actions.delete')} className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                    </button>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
                                </div>
                            </div>
                            {isOpen && (
                                <div className="pt-4 flex flex-col gap-5">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="text-muted text-xs font-bold uppercase tracking-wider">{t('settings.streamKillRules.match.title')}</span>
                                        <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
                                            {(['AND', 'OR'] as const).map(l => (
                                                <button key={l} onClick={() => upd(rule.id, { conditionLogic: l })}
                                                    className={`px-4 py-1.5 rounded-md text-xs font-black uppercase tracking-wider transition-all ${rule.conditionLogic === l ? 'bg-plex text-black shadow' : 'text-muted hover:text-text'}`}>{t(KR_LOGIC_LABEL_KEYS[l])}</button>
                                            ))}
                                        </div>
                                        <span className="text-muted text-xs font-bold uppercase tracking-wider">{t('settings.streamKillRules.match.followingConditions')}</span>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {(rule.conditions || []).map((c: any, i: number) => (
                                            <KRConditionRow key={c.id ?? i} cond={c} onCh={nc => updCond(rule.id, i, nc)} onDel={() => delCond(rule.id, i)} />
                                        ))}
                                        <button onClick={() => addCond(rule.id)} className="flex items-center gap-2 text-plex text-sm font-bold hover:text-plex/80 transition-colors mt-1 w-fit py-1">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                                            {t('settings.streamKillRules.actions.addCondition')}
                                        </button>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold uppercase tracking-wider text-muted mb-2 block">{t('settings.streamKillRules.editor.killMessage')} <span className="normal-case font-normal text-white/30">{t('settings.streamKillRules.editor.killMessageHint')}</span></label>
                                        <textarea value={rule.killMessage} onChange={e => upd(rule.id, { killMessage: e.target.value })} rows={2}
                                            className="w-full bg-background border border-border text-text rounded-lg px-3 py-2 text-sm focus:border-plex focus:ring-1 focus:ring-plex outline-none transition-all resize-none"
                                            placeholder={t('settings.streamKillRules.editor.killMessagePlaceholder')} />
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
                <button onClick={addRule} className="flex items-center gap-2 px-3 py-2 bg-border text-text rounded-lg font-bold text-xs hover:bg-opacity-80 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                    {t('settings.streamKillRules.actions.addRule')}
                </button>
                <button onClick={() => saveRules(rules)} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-plex text-background rounded-lg font-bold text-xs hover:opacity-90 transition-all disabled:opacity-50">
                    {saving ? <span className="w-4 h-4 border-2 border-background/50 border-t-transparent rounded-full animate-spin" /> : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>}
                    {t('settings.streamKillRules.actions.saveRules')}
                </button>
            </div>
        </div>
    );
};
