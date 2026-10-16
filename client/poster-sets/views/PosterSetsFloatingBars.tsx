import React from 'react';
import { Eye, ListOrdered, Loader2 } from 'lucide-react';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';
import { buttonClass, primaryButtonClass } from '../shared';

/** Bulk-selection sticky bar only — set inspect actions live in SetInspector (avoids overlapping Queue/Close). */
export const PosterSetsFloatingBars: React.FC = () => {
    const {
        selectedBulkCount,
        busy,
        queueBulkSelected,
        watchBulkSelected,
        clearBulkSelection,
    } = usePosterSetsDashboard();

    if (selectedBulkCount < 1) return null;

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center px-4 md:bottom-6">
            <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-plex/40 bg-card p-3 shadow-lg">
                <span className="text-sm font-semibold text-text">
                    {selectedBulkCount} selected
                </span>
                <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={busy !== null}
                    onClick={() => void queueBulkSelected()}
                >
                    {busy === 'bulk-select' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListOrdered className="h-4 w-4" />}
                    Queue & watch
                </button>
                <button
                    type="button"
                    className={buttonClass}
                    disabled={busy !== null}
                    onClick={() => void watchBulkSelected()}
                >
                    {busy === 'bulk-watch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    Watch selected
                </button>
                <button
                    type="button"
                    className={buttonClass}
                    disabled={busy !== null}
                    onClick={clearBulkSelection}
                >
                    Clear
                </button>
            </div>
        </div>
    );
};
