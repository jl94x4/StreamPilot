import React, { useEffect, useState } from 'react';
import { PLAYER_SETTINGS_EVENT, readPlayerSettings, type PlayerRowMarker } from '../media-player/playerSettings';

/** Shapes on a 24×24 box; .player-row-header-mark sizes and fills them (amber + glow). */
const MarkShape: React.FC<{ marker: PlayerRowMarker }> = ({ marker }) => {
    switch (marker) {
        case 'dot':
            return <circle cx="12" cy="12" r="7" />;
        case 'ring':
            return <path fillRule="evenodd" d="M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18Zm0 4.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9Z" />;
        case 'diamond':
            return <polygon points="12,2 22,12 12,22 2,12" />;
        case 'square':
            return <rect x="4" y="4" width="16" height="16" rx="3" />;
        case 'star':
            return <polygon points="12,2 14.9,8.6 22,9.3 16.6,14 18.2,21 12,17.3 5.8,21 7.4,14 2,9.3 9.1,8.6" />;
        case 'chevron':
            return <path d="M6.5 3 17.5 12 6.5 21 4 18 11.3 12 4 6Z" />;
        case 'bolt':
            return <polygon points="14,2 4,14 11,14 9.5,22 20,9.5 13,9.5" />;
        default:
            return <polygon points="4,2 22,12 4,22" />;
    }
};

const readMarker = (): PlayerRowMarker => readPlayerSettings().rowMarker;

/** Row title accent from Settings → Row marker. 'none' renders nothing, so the title moves left. */
export const RowHeaderMark: React.FC<{ marker?: PlayerRowMarker }> = ({ marker }) => {
    const [saved, setSaved] = useState<PlayerRowMarker>(readMarker);
    useEffect(() => {
        if (marker) return undefined;
        const sync = () => setSaved(readMarker());
        window.addEventListener(PLAYER_SETTINGS_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(PLAYER_SETTINGS_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, [marker]);
    const shape = marker || saved;
    if (shape === 'none') return null;
    // The original pre-play-button line: a slim gradient strip hugging the title (CSS-drawn).
    if (shape === 'bar') return <span className="player-row-header-mark player-row-header-mark--bar shrink-0" aria-hidden="true" />;
    return (
        <svg className="player-row-header-mark shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <MarkShape marker={shape} />
        </svg>
    );
};
