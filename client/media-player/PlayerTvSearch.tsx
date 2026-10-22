import React from 'react';
import { useDiscoverI18n } from './host';
import { coversSearchQuery } from './recentSearch.js';

const KEY_ROWS = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace'],
    ['space', 'clear'],
];

type Props = {
    query: string;
    onChange: (value: string) => void;
};

type RecentsProps = {
    query: string;
    recent: string[];
    popular: string[];
    onPickRecent: (value: string) => void;
};

const appendChar = (query: string, char: string) => {
    const next = `${query}${char}`;
    return next.length > 64 ? query : next;
};

const ChipRow: React.FC<{
    label: string;
    items: string[];
    rowAttr: 'recent' | 'popular';
    onPick: (value: string) => void;
}> = ({ label, items, rowAttr, onPick }) => {
    if (!items.length) return null;
    return (
        <div
            data-tv-search-recent={rowAttr === 'recent' ? '1' : undefined}
            data-tv-search-popular={rowAttr === 'popular' ? '1' : undefined}
            className="player-tv-search-recent"
        >
            <p className="player-tv-search-recent-label">{label}</p>
            <div className="player-tv-search-recent-row">
                {items.map((row, index) => (
                    <button
                        key={row}
                        type="button"
                        className="player-tv-search-recent-chip"
                        data-tv-item="1"
                        data-tv-key={`search-${rowAttr}-${index}`}
                        onClick={() => onPick(row)}
                    >
                        {row}
                    </button>
                ))}
            </div>
        </div>
    );
};

export const PlayerTvSearchRecents: React.FC<RecentsProps> = ({
    query,
    recent,
    popular,
    onPickRecent,
}) => {
    const { t } = useDiscoverI18n();
    if (query.trim()) return null;
    const popularItems = popular.filter((row) => !coversSearchQuery(recent, row));
    return (
        <>
            <ChipRow
                label={t('mediaPlayerPage.searchRecent')}
                items={recent}
                rowAttr="recent"
                onPick={onPickRecent}
            />
            <ChipRow
                label={t('mediaPlayerPage.searchPopular')}
                items={popularItems}
                rowAttr="popular"
                onPick={onPickRecent}
            />
        </>
    );
};

export const PlayerTvSearch: React.FC<Props> = ({ query, onChange }) => {
    const { t } = useDiscoverI18n();
    const empty = !query.trim();

    const press = (key: string) => {
        if (key === 'backspace') {
            onChange(query.slice(0, -1));
            return;
        }
        if (key === 'clear') {
            onChange('');
            return;
        }
        if (key === 'space') {
            if (!query || query.endsWith(' ')) return;
            onChange(appendChar(query, ' '));
            return;
        }
        onChange(appendChar(query, key));
    };

    return (
        <div className="player-tv-search">
            <p
                className={`player-tv-search-query${empty ? ' is-empty' : ''}`}
                data-tv-search-query="1"
                data-empty={empty ? '1' : '0'}
            >
                {empty ? t('mediaPlayerPage.searchPlaceholder') : query}
                <span className="player-tv-search-caret" aria-hidden />
            </p>
            <div data-tv-search-pad="1" className="player-tv-search-pad">
                {KEY_ROWS.map((row, rowIndex) => (
                    <div key={row.join('')} className="player-tv-search-row">
                        {row.map((key, colIndex) => {
                            const wide = key === 'space' || key === 'clear' || key === 'backspace';
                            const label = key === 'space'
                                ? t('mediaPlayerPage.searchSpace')
                                : key === 'clear'
                                    ? t('mediaPlayerPage.searchClear')
                                    : key === 'backspace'
                                        ? '⌫'
                                        : key.toUpperCase();
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    className={`player-tv-search-key${wide ? ' is-wide' : ''}`}
                                    data-tv-item="1"
                                    data-tv-search-key={key}
                                    data-search-row={rowIndex}
                                    data-search-col={colIndex}
                                    data-tv-key={`search-key-${key}`}
                                    aria-label={label}
                                    onClick={() => press(key)}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
};
