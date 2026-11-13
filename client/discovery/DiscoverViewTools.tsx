import React from 'react';
import { CheckSquare, LayoutGrid, List, Rows3 } from 'lucide-react';
import { useDiscoverI18n } from './i18n';
import {
    DISCOVER_LAYOUTS,
    discoverSelection,
    useDiscoverLayout,
    useDiscoverSelectMode,
    type DiscoverLayout,
} from './discoverViewState';

const LAYOUT_ICON: Record<DiscoverLayout, React.ComponentType<{ className?: string }>> = {
    grid: LayoutGrid,
    list: List,
    compact: Rows3,
};

/** Grid / List / Compact switch plus a Select toggle, shown beside the poster size slider. */
export const DiscoverViewTools: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { t } = useDiscoverI18n();
    const [layout, setLayout] = useDiscoverLayout();
    const selectMode = useDiscoverSelectMode();
    const labelFor = (value: DiscoverLayout) => (
        value === 'grid' ? t('browse.layoutGrid') : value === 'list' ? t('browse.layoutList') : t('browse.layoutCompact')
    );
    return (
        <div className={`inline-flex items-center gap-2 ${className}`.trim()}>
            <div className="inline-flex overflow-hidden rounded-lg border border-white/10 bg-white/5" role="group" aria-label={t('browse.layoutLabel')}>
                {DISCOVER_LAYOUTS.map((value) => {
                    const Icon = LAYOUT_ICON[value];
                    const active = layout === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            title={labelFor(value)}
                            aria-label={labelFor(value)}
                            aria-pressed={active}
                            onClick={() => setLayout(value)}
                            className={`flex h-8 w-8 items-center justify-center transition-colors ${
                                active ? 'bg-plex/15 text-plex' : 'text-muted hover:text-text'
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                aria-pressed={selectMode}
                onClick={() => discoverSelection.setActive(!selectMode)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-colors ${
                    selectMode
                        ? 'border-plex/40 bg-plex/15 text-plex'
                        : 'border-white/10 bg-white/5 text-muted hover:text-text'
                }`}
            >
                <CheckSquare className="h-3.5 w-3.5" />
                {selectMode ? t('browse.selectDone') : t('browse.select')}
            </button>
        </div>
    );
};
