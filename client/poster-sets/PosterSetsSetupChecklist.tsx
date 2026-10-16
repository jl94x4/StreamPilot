import React from 'react';
import { CheckCircle2, Circle, Loader2, Settings2 } from 'lucide-react';
import type { PosterSetsStatus } from './types';

const cardClass = 'rounded-xl border border-amber-500/30 bg-amber-500/10';
const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';
const primaryButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-plex px-2.5 py-1.5 text-xs font-bold text-background transition hover:bg-plex-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';

type PosterSetsSetupChecklistProps = {
    status: PosterSetsStatus | null;
    hasToken: boolean;
    hasTvLibraries: boolean;
    hasMovieLibraries: boolean;
    testing: boolean;
    onOpenSettings: () => void;
    onTestConnection: () => void;
    testResult?: string | null;
};

function CheckItem({ done, label, detail }: { done: boolean; label: string; detail?: string }) {
    return (
        <li className="flex items-start gap-3">
            {done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            )}
            <div className="min-w-0">
                <p className={`text-sm font-semibold ${done ? 'text-text' : 'text-muted'}`}>{label}</p>
                {detail ? <p className="mt-0.5 text-xs text-muted">{detail}</p> : null}
            </div>
        </li>
    );
}

export function PosterSetsSetupChecklist({
    status,
    hasToken,
    hasTvLibraries,
    hasMovieLibraries,
    testing,
    onOpenSettings,
    onTestConnection,
    testResult,
}: PosterSetsSetupChecklistProps) {
    const workerReady = Boolean(status?.workerReady);
    const configured = Boolean(status?.configured);
    const librariesOk = hasTvLibraries || hasMovieLibraries;
    const allDone = workerReady && configured && hasToken && librariesOk;

    if (allDone) return null;

    return (
        <section className={`${cardClass} space-y-4 p-4 sm:p-5`}>
            <div>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-200">Setup checklist</p>
                <h3 className="mt-1 text-base font-bold text-text sm:text-lg">Connect Poster Sets to your library</h3>
                <p className="mt-1 text-xs text-muted sm:text-sm">
                    Complete these steps once so you can search sets, preview art, and apply posters from your Plex library.
                </p>
            </div>
            <ul className="space-y-3">
                <CheckItem
                    done={workerReady}
                    label="Poster Sets worker"
                    detail={workerReady ? 'Python worker is available.' : 'Install the Poster Sets worker (see Settings).'}
                />
                <CheckItem
                    done={hasToken && configured}
                    label="Plex connection"
                    detail={hasToken
                        ? 'Using Settings → Media Player — run a test to confirm.'
                        : 'Set Direct Plex URL and token under Settings → Media Player.'}
                />
                <CheckItem
                    done={librariesOk}
                    label="Library mapping"
                    detail={librariesOk
                        ? 'TV and/or movie libraries are configured.'
                        : 'Add at least one TV or movie library name in Settings.'}
                />
            </ul>
            <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryButtonClass} onClick={onOpenSettings}>
                    <Settings2 className="h-4 w-4" />
                    Open Settings
                </button>
                <button type="button" className={buttonClass} disabled={testing || !hasToken} onClick={onTestConnection}>
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Test connection
                </button>
            </div>
            {testResult ? <p className="text-xs text-muted sm:text-sm">{testResult}</p> : null}
        </section>
    );
}
