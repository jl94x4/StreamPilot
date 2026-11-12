import React from 'react';
import { createRoot } from 'react-dom/client';
import type { PosterSetsTitleWatchConflict } from './api';
import { posterSetsApi } from './api';
import { formatSetLabel, providerLabel } from './shared/posterSetsFormat';
import type { PosterSetsWatch } from './types';

const describe = (watch: PosterSetsWatch | null | undefined) => {
    const label = formatSetLabel(watch);
    if (label) return label;
    const creator = String(watch?.user || '').trim().replace(/^@/, '');
    if (creator) return `@${creator} on ${providerLabel(watch?.provider)}`;
    return String(watch?.url || '').trim() || 'Set';
};

const thumbSrc = (watch: PosterSetsWatch | null | undefined) => {
    const thumb = String(watch?.thumbUrl || '').trim();
    if (!thumb) return '';
    return thumb.startsWith('http') ? posterSetsApi.imageUrl(thumb) : thumb;
};

const Side: React.FC<{ heading: string; watch: PosterSetsWatch | null | undefined }> = ({ heading, watch }) => {
    const src = thumbSrc(watch);
    return (
        <div className="min-w-0 flex-1 space-y-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{heading}</p>
            <div className="mx-auto flex h-44 w-32 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                {src ? <img src={src} alt="" className="h-full w-full object-contain" loading="lazy" /> : <span className="px-2 text-xs text-muted">No preview</span>}
            </div>
            <p className="line-clamp-2 break-words text-xs font-semibold text-text">{describe(watch)}</p>
        </div>
    );
};

const Dialog: React.FC<{ conflict: PosterSetsTitleWatchConflict; onDone: (ok: boolean) => void }> = ({ conflict, onDone }) => {
    const title = String(conflict.incoming?.title || conflict.existing[0]?.title || 'this title').trim();
    return (
        <div
            className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
            onClick={() => onDone(false)}
        >
            <div
                role="dialog"
                aria-modal="true"
                className="w-full max-w-lg space-y-4 rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-plex">Already watching a set</p>
                    <h3 className="mt-1 text-base font-bold text-text">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                        Only one set can be watched per show or movie. Continuing stops watching the current set and removes it (you can bring it back from “Recently replaced” on Watching for 7 days).
                    </p>
                </div>
                <div className="flex items-start gap-3">
                    <Side heading="Watching now" watch={conflict.existing[0]} />
                    <span className="self-center text-lg text-muted" aria-hidden>→</span>
                    <Side heading="New set" watch={conflict.incoming} />
                </div>
                <div className="flex justify-end gap-2">
                    <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-text hover:bg-white/5" onClick={() => onDone(false)}>
                        Keep current
                    </button>
                    <button type="button" className="rounded-xl border border-red-400/40 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-500/30" onClick={() => onDone(true)}>
                        Replace set
                    </button>
                </div>
            </div>
        </div>
    );
};

/** Side-by-side compare before a watched set is replaced. Resolves true to replace. */
export const askReplaceCompare = (conflict: PosterSetsTitleWatchConflict): Promise<boolean> => (
    new Promise((resolve) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const finish = (ok: boolean) => {
            root.unmount();
            host.remove();
            resolve(ok);
        };
        root.render(<Dialog conflict={conflict} onDone={finish} />);
    })
);
