import React from 'react';
import { createRoot } from 'react-dom/client';
import type { PosterSetsTitleWatchConflict } from './api';
import { posterSetsApi } from './api';
import { formatSetLabel, providerLabel } from './shared/posterSetsFormat';
import type { PosterSetsWatch } from './types';
import { formatWatchArtSlots, watchArtSlots, type WatchArtSlot } from './watchArtSlots';

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

/** Title cards and backdrops are widescreen; posters are portrait. A set covering both shows as portrait. */
const isWide = (watch: PosterSetsWatch | null | undefined) => {
    const slots = watchArtSlots(watch);
    return slots.size > 0 && [...slots].every((slot) => slot === 'title_cards' || slot === 'backgrounds');
};

const Side: React.FC<{ heading: string; watch: PosterSetsWatch | null | undefined }> = ({ heading, watch }) => {
    const src = thumbSrc(watch);
    const wide = isWide(watch);
    return (
        <div className="min-w-0 flex-1 space-y-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{heading}</p>
            <div className={`mx-auto flex items-center justify-center overflow-hidden rounded-lg bg-white/5 ${wide ? 'aspect-video w-full max-w-[13rem]' : 'aspect-[2/3] w-32'}`}>
                {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="px-2 text-xs text-muted">No preview</span>}
            </div>
            <p className="line-clamp-2 break-words text-xs font-semibold text-text">{describe(watch)}</p>
        </div>
    );
};

const Dialog: React.FC<{ conflict: PosterSetsTitleWatchConflict; onDone: (ok: boolean) => void }> = ({ conflict, onDone }) => {
    const title = String(conflict.incoming?.title || conflict.existing[0]?.title || 'this title').trim();
    // The art type both sets cover (a title-card set and a poster set can be watched side by side, so this is only ever a clash).
    const incomingSlots = watchArtSlots(conflict.incoming);
    const shared: WatchArtSlot[] = [...new Set(conflict.existing.flatMap((watch) => [...watchArtSlots(watch)]))]
        .filter((slot) => incomingSlots.has(slot));
    const kind = formatWatchArtSlots(shared);
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
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-plex">{kind === 'this title' ? 'Already watching a set' : `Already watching ${kind}`}</p>
                    <h3 className="mt-1 text-base font-bold text-text">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                        Only one set can be watched for each art type (posters, title cards or backdrops) on a show or movie. Continuing stops watching the current set for {kind} and removes it. Sets for other art types are kept. You can bring it back from “Recently replaced” on Watching for 7 days.
                    </p>
                </div>
                <div className="flex items-start gap-3">
                    {/* Every watch this one replaces (a set with all art types ticked can replace several). */}
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                        {conflict.existing.map((watch, index) => (
                            <Side key={watch.id || index} heading={index === 0 ? 'Watching now' : 'Also replaced'} watch={watch} />
                        ))}
                    </div>
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
