import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DashboardHero, DashboardPageShell, DashboardPanel } from '../shared/dashboard/DashboardChrome';
import { useDiscoverI18n } from '../discovery/i18n';

/**
 * Members' Help page: one page the admin writes (installing apps, house rules, who to ask).
 * Written in a small Markdown subset and rendered as React elements, never as raw HTML.
 */

type HelpPageDoc = { enabled: boolean; title: string; body: string };

const SAFE_LINK = /^(https?:\/\/|mailto:|\/)/i;

/** **bold**, *italic*, `code` and [text](url) inside one line. */
const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = pattern.exec(text))) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const key = `${keyPrefix}-${index++}`;
        if (match[2]) nodes.push(<strong key={key} className="text-text">{match[2]}</strong>);
        else if (match[3]) nodes.push(<em key={key}>{match[3]}</em>);
        else if (match[4]) nodes.push(<code key={key} className="px-1.5 py-0.5 rounded bg-black/30 text-[0.9em]">{match[4]}</code>);
        else if (match[5] && SAFE_LINK.test(match[6])) {
            const external = /^https?:/i.test(match[6]);
            nodes.push(
                <a key={key} href={match[6]} className="text-plex underline underline-offset-2" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    {match[5]}
                </a>,
            );
        } else nodes.push(match[0]);
        last = match.index + match[0].length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
};

/** Headings (#, ##, ###), bullet and numbered lists, and paragraphs separated by blank lines. */
export const renderHelpMarkdown = (body: string): React.ReactNode[] => {
    const blocks: React.ReactNode[] = [];
    const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    const flushParagraph = () => {
        if (!paragraph.length) return;
        const key = `p-${blocks.length}`;
        blocks.push(
            <p key={key} className="text-sm text-muted leading-relaxed">
                {paragraph.flatMap((line, i) => (i ? [<br key={`${key}-br-${i}`} />, ...renderInline(line, `${key}-${i}`)] : renderInline(line, `${key}-${i}`)))}
            </p>,
        );
        paragraph = [];
    };
    const flushList = () => {
        if (!list) return;
        const key = `l-${blocks.length}`;
        const items = list.items.map((item, i) => <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>);
        blocks.push(list.ordered
            ? <ol key={key} className="list-decimal pl-5 space-y-1 text-sm text-muted">{items}</ol>
            : <ul key={key} className="list-disc pl-5 space-y-1 text-sm text-muted">{items}</ul>);
        list = null;
    };
    for (const raw of lines) {
        const line = raw.trimEnd();
        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (!line.trim()) {
            flushParagraph();
            flushList();
        } else if (heading) {
            flushParagraph();
            flushList();
            const key = `h-${blocks.length}`;
            const level = heading[1].length;
            const className = level === 1 ? 'text-xl font-bold text-text pt-2' : level === 2 ? 'text-lg font-bold text-text pt-2' : 'text-base font-bold text-text pt-1';
            blocks.push(React.createElement(`h${level + 1}`, { key, className }, renderInline(heading[2], key)));
        } else if (bullet || numbered) {
            flushParagraph();
            const ordered = !bullet;
            if (list && list.ordered !== ordered) flushList();
            if (!list) list = { ordered, items: [] };
            list.items.push((bullet || numbered)![1]);
        } else {
            flushList();
            paragraph.push(line.trim());
        }
    }
    flushParagraph();
    flushList();
    return blocks;
};

/** Member view. */
export const HelpPage: React.FC = () => {
    const { t } = useDiscoverI18n();
    const [doc, setDoc] = useState<HelpPageDoc | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        apiFetch('/api/me/help-page')
            .then((data: any) => setDoc({ enabled: !!data?.enabled, title: String(data?.title || ''), body: String(data?.body || '') }))
            .catch(() => setFailed(true));
    }, []);

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="plex"
                eyebrow={t('helpPage.eyebrow')}
                title={doc?.title || t('helpPage.defaultTitle')}
                icon={<BookOpen className="h-3.5 w-3.5" />}
            />
            {failed || (doc && (!doc.enabled || !doc.body.trim())) ? (
                <DashboardPanel title={t('helpPage.emptyTitle')} subtitle={t('helpPage.emptyHint')} />
            ) : !doc ? (
                <DashboardPanel title={t('helpPage.loading')} />
            ) : (
                <DashboardPanel title={doc.title || t('helpPage.defaultTitle')}>
                    <div className="flex flex-col gap-3 max-w-3xl">{renderHelpMarkdown(doc.body)}</div>
                </DashboardPanel>
            )}
        </DashboardPageShell>
    );
};

/** Settings → Contact: the admin writes the page here, with a live preview. */
export const HelpPageEditor: React.FC<{ addToast: (message: string, type?: 'success' | 'error') => void }> = ({ addToast }) => {
    const { t } = useDiscoverI18n();
    const [doc, setDoc] = useState<HelpPageDoc>({ enabled: false, title: '', body: '' });
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState(false);

    useEffect(() => {
        apiFetch('/api/help-page')
            .then((data: any) => setDoc({ enabled: !!data?.enabled, title: String(data?.title || ''), body: String(data?.body || '') }))
            .catch(() => undefined)
            .finally(() => setLoaded(true));
    }, []);

    const save = async () => {
        setBusy(true);
        try {
            const saved: any = await apiFetch('/api/help-page', { method: 'PUT', body: JSON.stringify(doc) });
            setDoc({ enabled: !!saved?.enabled, title: String(saved?.title || ''), body: String(saved?.body || '') });
            addToast(t('helpPage.saved'), 'success');
        } catch (err: any) {
            addToast(String(err?.message || t('helpPage.saveFailed')), 'error');
        } finally {
            setBusy(false);
        }
    };

    if (!loaded) return null;
    const inputClass = 'w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all';
    return (
        <div className="mb-8">
            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('helpPage.editorTitle')}</h3>
            <p className="text-sm text-muted mb-6">{t('helpPage.editorHint')}</p>
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between bg-black/10 p-4 rounded-lg border border-border gap-3">
                    <div className="min-w-0">
                        <label className="font-bold block mb-1">{t('helpPage.enable')}</label>
                        <span className="text-xs text-muted block">{t('helpPage.enableHint')}</span>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={doc.enabled}
                        aria-label={t('helpPage.enable')}
                        onClick={() => setDoc({ ...doc, enabled: !doc.enabled })}
                        className={`relative inline-flex items-center h-6 rounded-full w-11 shrink-0 transition-colors ${doc.enabled ? 'bg-plex' : 'bg-border'}`}
                    >
                        <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${doc.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
                <input
                    className={inputClass}
                    value={doc.title}
                    onChange={(event) => setDoc({ ...doc, title: event.target.value })}
                    placeholder={t('helpPage.titlePlaceholder')}
                    maxLength={120}
                />
                <div className="flex gap-2 text-sm">
                    <button type="button" onClick={() => setPreview(false)} className={`px-3 py-1.5 rounded-lg border ${!preview ? 'border-plex text-plex' : 'border-border text-muted'}`}>{t('helpPage.write')}</button>
                    <button type="button" onClick={() => setPreview(true)} className={`px-3 py-1.5 rounded-lg border ${preview ? 'border-plex text-plex' : 'border-border text-muted'}`}>{t('helpPage.preview')}</button>
                </div>
                {preview ? (
                    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-black/10 min-h-[12rem]">
                        {doc.body.trim() ? renderHelpMarkdown(doc.body) : <p className="text-sm text-muted">{t('helpPage.previewEmpty')}</p>}
                    </div>
                ) : (
                    <textarea
                        className={`${inputClass} min-h-[16rem] font-mono text-sm`}
                        value={doc.body}
                        onChange={(event) => setDoc({ ...doc, body: event.target.value })}
                        placeholder={t('helpPage.bodyPlaceholder')}
                    />
                )}
                <p className="text-xs text-muted">{t('helpPage.formattingHint')}</p>
                <div>
                    <button
                        type="button"
                        onClick={save}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg bg-plex text-black font-bold text-sm disabled:opacity-60"
                    >
                        {t('helpPage.save')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default HelpPage;
