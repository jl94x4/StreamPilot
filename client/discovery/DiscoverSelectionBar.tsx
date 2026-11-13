import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useDiscoverI18n } from './i18n';
import { discoverSelection, useDiscoverSelection } from './discoverViewState';
import { bulkRequestItems } from './discoverBulkRequest';

/** Floating bar shown while Select mode is on: count, clear, and Request selected. */
export const DiscoverSelectionBar: React.FC = () => {
    const { t } = useDiscoverI18n();
    const { active, items } = useDiscoverSelection();
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [summary, setSummary] = useState('');

    // Leaving the page must not leave Select mode switched on for the next one.
    useEffect(() => () => discoverSelection.setActive(false), []);

    useEffect(() => {
        if (!summary) return undefined;
        const timer = window.setTimeout(() => setSummary(''), 6000);
        return () => window.clearTimeout(timer);
    }, [summary]);

    if (typeof document === 'undefined' || (!active && !summary)) return null;

    const count = items.size;
    const run = async () => {
        if (busy || count === 0) return;
        setBusy(true);
        setSummary('');
        setProgress({ done: 0, total: count });
        try {
            const entries = [...items.entries()].map(([key, item]) => ({ key, item }));
            const result = await bulkRequestItems(entries, (done, total) => setProgress({ done, total }));
            discoverSelection.remove(result.doneKeys);
            const parts = [
                result.requested.length ? t('browse.bulkDone', { count: result.requested.length }) : '',
                result.skipped.length ? t('browse.bulkSkipped', { count: result.skipped.length }) : '',
                result.failed.length ? t('browse.bulkFailed', { count: result.failed.length }) : '',
            ].filter(Boolean);
            setSummary(parts.join(' · '));
            if (!result.failed.length) discoverSelection.setActive(false);
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    return createPortal(
        <div
            className="fixed inset-x-0 z-[150] flex justify-center px-3 pointer-events-none"
            style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
            <div className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-2xl">
                <span className="min-w-0 flex-1 text-sm font-bold text-text">
                    {summary && !active ? summary : (busy && progress
                        ? `${t('browse.bulkRequesting')} ${progress.done}/${progress.total}`
                        : t('browse.selectedCount', { count }))}
                    {summary && active ? <span className="mt-0.5 block text-xs font-medium text-muted">{summary}</span> : null}
                </span>
                {active && (
                    <>
                        <button
                            type="button"
                            disabled={busy || count === 0}
                            onClick={() => discoverSelection.clear()}
                            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-text/80 hover:bg-white/5 disabled:opacity-40"
                        >
                            {t('browse.selectClear')}
                        </button>
                        <button
                            type="button"
                            disabled={busy || count === 0}
                            onClick={() => void run()}
                            className="inline-flex items-center gap-2 rounded-lg bg-plex px-4 py-2 text-xs font-black text-black hover:bg-plex-hover disabled:opacity-40"
                        >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            {t('browse.requestSelected')}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => discoverSelection.setActive(false)}
                            className="rounded-lg px-2 py-2 text-xs font-bold text-muted hover:text-text disabled:opacity-40"
                        >
                            {t('browse.selectDone')}
                        </button>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
};
