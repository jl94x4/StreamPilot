import React from 'react';
import { Delete, History, Search, Trash2 } from 'lucide-react';
import { useDiscoverI18n } from './host';

/** Alphabetical 6-column pad (Plex / Netflix TV style). Row and column feed the remote's search plan. */
export const TV_SEARCH_KEY_ROWS = [
    ['a', 'b', 'c', 'd', 'e', 'f'],
    ['g', 'h', 'i', 'j', 'k', 'l'],
    ['m', 'n', 'o', 'p', 'q', 'r'],
    ['s', 't', 'u', 'v', 'w', 'x'],
    ['y', 'z', '1', '2', '3', '4'],
    ['5', '6', '7', '8', '9', '0'],
    ['space', 'backspace', 'clear'],
];

/** The key search opens on. */
export const TV_SEARCH_FIRST_KEY = 'a';

type Props = {
    query: string;
    onChange: (value: string) => void;
};

type HistoryProps = {
    recent: string[];
    onPick: (value: string) => void;
    onClear: () => void;
    /** "Opened from search" row, rendered by Home (it owns the poster callbacks). */
    openedRow?: React.ReactNode;
};

const appendChar = (query: string, char: string) => {
    const next = `${query}${char}`;
    return next.length > 64 ? query : next;
};

/** Right panel with an empty query: everything searched before, newest first. */
export const PlayerTvSearchHistory: React.FC<HistoryProps> = ({ recent, onPick, onClear, openedRow }) => {
    const { t } = useDiscoverI18n();
    if (!recent.length && !openedRow) {
        return (
            <div className="player-tv-search-empty">
                <span className="player-tv-search-empty-icon"><History className="h-7 w-7" /></span>
                <p className="player-tv-search-empty-title">{t('mediaPlayerPage.searchHistoryEmpty')}</p>
                <p className="player-tv-search-empty-hint">{t('mediaPlayerPage.searchHistoryEmptyHint')}</p>
            </div>
        );
    }
    return (
        <div className="player-tv-search-history">
            {recent.length ? (
                <section className="player-tv-search-section" data-tv-search-history="1">
                    <p className="player-tv-search-label">{t('mediaPlayerPage.searchRecent')}</p>
                    <div className="player-tv-search-history-list">
                        {recent.map((row, index) => (
                            <button
                                key={row}
                                type="button"
                                className="player-tv-search-history-item"
                                data-tv-item="1"
                                data-tv-key={`search-history-${index}`}
                                onClick={() => onPick(row)}
                            >
                                <History className="player-tv-search-history-icon h-5 w-5" />
                                <span className="player-tv-search-history-text">{row}</span>
                            </button>
                        ))}
                        <button
                            type="button"
                            className="player-tv-search-history-clear"
                            data-tv-item="1"
                            data-tv-key="search-history-clear"
                            onClick={onClear}
                        >
                            <Trash2 className="h-4 w-4" />
                            {t('mediaPlayerPage.searchClearHistory')}
                        </button>
                    </div>
                </section>
            ) : null}
            {openedRow}
        </div>
    );
};

/** Right panel while typing: too short to search yet, or nothing found. */
export const PlayerTvSearchNotice: React.FC<{ query: string; kind: 'short' | 'none' }> = ({ query, kind }) => {
    const { t } = useDiscoverI18n();
    return (
        <div className="player-tv-search-empty">
            <span className="player-tv-search-empty-icon"><Search className="h-7 w-7" /></span>
            <p className="player-tv-search-empty-title">
                {kind === 'short' ? t('mediaPlayerPage.searchKeepTyping') : t('mediaPlayerPage.searchNoResults', { query: query.trim() })}
            </p>
            {kind === 'none' ? <p className="player-tv-search-empty-hint">{t('mediaPlayerPage.searchNoResultsHint')}</p> : null}
        </div>
    );
};

/** Left panel: what you have typed and the on-screen keyboard. */
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
            <span className="player-tv-search-eyebrow">
                <Search className="h-4 w-4" />
                {t('mediaPlayerPage.searchTitle')}
            </span>
            <p
                className={`player-tv-search-query${empty ? ' is-empty' : ''}`}
                data-tv-search-query="1"
                data-empty={empty ? '1' : '0'}
            >
                <span className="player-tv-search-query-text">{empty ? t('mediaPlayerPage.searchPlaceholder') : query}</span>
                <span className="player-tv-search-caret" aria-hidden />
            </p>
            <div data-tv-search-pad="1" className="player-tv-search-pad">
                {TV_SEARCH_KEY_ROWS.map((row, rowIndex) => row.map((key, colIndex) => {
                    const action = key === 'space' || key === 'clear' || key === 'backspace';
                    const label = key === 'space'
                        ? t('mediaPlayerPage.searchSpace')
                        : key === 'clear'
                            ? t('mediaPlayerPage.searchClear')
                            : key === 'backspace'
                                ? t('mediaPlayerPage.searchDelete')
                                : key.toUpperCase();
                    return (
                        <button
                            key={key}
                            type="button"
                            className={`player-tv-search-key${action ? ' is-action' : ''}`}
                            data-tv-item="1"
                            data-tv-search-key={key}
                            data-search-row={rowIndex}
                            data-search-col={colIndex}
                            data-tv-key={`search-key-${key}`}
                            aria-label={label}
                            onClick={() => press(key)}
                        >
                            {key === 'backspace' ? <Delete className="h-5 w-5" /> : label}
                        </button>
                    );
                }))}
            </div>
        </div>
    );
};
