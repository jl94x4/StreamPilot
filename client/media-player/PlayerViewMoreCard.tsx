import React from 'react';
import { LayoutGrid } from 'lucide-react';

type Props = {
    label: string;
    title?: string;
    aspect?: '2/3' | 'square' | '16/9';
    onClick: () => void;
};

export const PlayerViewMoreCard: React.FC<Props> = ({ label, title, aspect = '2/3', onClick }) => {
    const ratio = aspect === '16/9' ? 'aspect-video' : aspect === 'square' ? 'aspect-square' : 'aspect-[2/3]';
    return (
        <button
            type="button"
            data-tv-item="1"
            data-tv-poster-btn="1"
            data-tv-key={`view-more:${title || label}`}
            onClick={onClick}
            className="relative w-full overflow-visible bg-transparent p-0 outline-none"
            aria-label={title ? `${label}: ${title}` : label}
        >
            <div
                data-tv-poster="1"
                className={`player-poster-frame flex ${ratio} w-full flex-col items-center justify-center gap-3 rounded-[12px] border border-white/15 bg-zinc-900 text-center`}
            >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white">
                    <LayoutGrid className="h-5 w-5" />
                </span>
                <span className="px-3 text-sm font-bold leading-tight text-white">{label}</span>
            </div>
        </button>
    );
};
