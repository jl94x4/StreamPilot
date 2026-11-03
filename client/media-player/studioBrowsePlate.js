/**
 * Brand plate colors for Library → Studios cards (vision: tinted logo plates).
 * Keys match companyAliasKey() / studioLogo aliases.
 */

import { companyAliasKey } from './studioLogo.js';

/** Vision mock order — majors first, then the rest of the catalog. */
export const STUDIO_BROWSE_PRIORITY = [
    'disney',
    '20th century studios',
    'universal',
    'warner bros pictures',
    'paramount',
    'sony pictures',
    'columbia pictures',
    'pixar',
    'marvel studios',
    'dreamworks',
    'illumination',
    'lionsgate',
    'mgm',
    'new line cinema',
    'legendary pictures',
    'a24',
    'blumhouse',
    'focus features',
    'searchlight pictures',
    'dc',
];

export const NETWORK_BROWSE_PRIORITY = [
    'netflix',
    'disney',
    'apple tv',
    'prime video',
    'hbo',
    'max',
    'hulu',
    'peacock',
    'paramount',
    'discovery',
    'bbc',
    'channel 4',
    'itvx',
    'sky',
    'sky originals',
    'sky atlantic',
];

const PLATES = {
    // Vision: Disney = vivid solid blue; 20th = gold → charcoal sweep
    disney: 'linear-gradient(135deg, #1a6cff 0%, #0b4fd4 55%, #083db0 100%)',
    '20th century studios': 'linear-gradient(105deg, #c9a05a 0%, #8f6a2e 42%, #3a3a3a 100%)',
    universal: 'linear-gradient(135deg, #2f7ec4 0%, #1a4f82 55%, #0f2f4e 100%)',
    paramount: 'linear-gradient(135deg, #0090d8 0%, #0068a8 50%, #003f68 100%)',
    'warner bros pictures': 'linear-gradient(135deg, #2e4578 0%, #182848 55%, #0a1228 100%)',
    'sony pictures': 'linear-gradient(135deg, #3e3e48 0%, #1c1c22 100%)',
    'columbia pictures': 'linear-gradient(135deg, #2f5a90 0%, #163454 100%)',
    pixar: 'linear-gradient(135deg, #3f88c8 0%, #1e507e 100%)',
    'marvel studios': 'linear-gradient(135deg, #c4122e 0%, #7a0a18 55%, #3e040c 100%)',
    dreamworks: 'linear-gradient(135deg, #2f78a8 0%, #174564 100%)',
    lionsgate: 'linear-gradient(135deg, #564032 0%, #241c14 100%)',
    mgm: 'linear-gradient(135deg, #6a5828 0%, #322810 100%)',
    'new line cinema': 'linear-gradient(135deg, #323240 0%, #14141c 100%)',
    a24: 'linear-gradient(135deg, #1c1c1c 0%, #080808 100%)',
    blumhouse: 'linear-gradient(135deg, #321818 0%, #120808 100%)',
    illumination: 'linear-gradient(135deg, #f0a020 0%, #c87810 50%, #8a5008 100%)',
    'legendary pictures': 'linear-gradient(135deg, #463218 0%, #1a1208 100%)',
    'focus features': 'linear-gradient(135deg, #2e4868 0%, #142030 100%)',
    'searchlight pictures': 'linear-gradient(135deg, #966838 0%, #4a3018 100%)',
    dc: 'linear-gradient(135deg, #1e3870 0%, #0c1838 100%)',
    // Networks — plate under art stays near-black; these tint landscape fallbacks.
    netflix: 'linear-gradient(135deg, #2a0a0a 0%, #0e0404 100%)',
    'disney plus': 'linear-gradient(135deg, #0a1a48 0%, #040c28 100%)',
    'prime video': 'linear-gradient(135deg, #0a2848 0%, #041428 100%)',
    'apple tv': 'linear-gradient(135deg, #2a2a2e 0%, #121214 100%)',
    hbo: 'linear-gradient(135deg, #1a1a22 0%, #0a0a10 100%)',
    max: 'linear-gradient(135deg, #1a1a28 0%, #0a0a14 100%)',
    hulu: 'linear-gradient(135deg, #0a3a28 0%, #041c14 100%)',
    peacock: 'linear-gradient(135deg, #0a2840 0%, #041420 100%)',
    discovery: 'linear-gradient(135deg, #1a3a58 0%, #0c1c2c 100%)',
};

const DEFAULT_PLATE = 'linear-gradient(135deg, #2a3038 0%, #14181e 55%, #0c0e12 100%)';

/** CSS background for a studio/network logo plate. */
export const studioBrowsePlateBackground = (name = '') => {
    const key = companyAliasKey(name);
    if (PLATES[key]) return PLATES[key];
    // Disney+ alias collapses to "disney" — keep theatrical blue for movie studio plates.
    if (key === 'disney' && /plus|\+/.test(String(name || '').toLowerCase())) {
        return PLATES['disney plus'];
    }
    return DEFAULT_PLATE;
};

/** Stable dedupe key so Fox / 20th Century / Twentieth Century collapse to one card. */
export const studioBrowseDedupeKey = (card = {}) => {
    const logo = String(card.logoPath || '').trim().toLowerCase();
    if (logo) return `logo:${logo}`;
    const alias = companyAliasKey(card.title || card.name || '');
    if (alias) return `alias:${alias}`;
    return `title:${String(card.title || card.key || '').trim().toLowerCase()}`;
};

/** Rank cards like the vision mock (majors first), then logoful, then A–Z. */
export const sortStudioBrowseCards = (cards = [], priorityKeys = []) => {
    const prio = new Map(
        (Array.isArray(priorityKeys) ? priorityKeys : []).map((key, index) => [String(key), index]),
    );
    return (Array.isArray(cards) ? cards : []).slice().sort((a, b) => {
        const aliasA = companyAliasKey(a?.title || a?.name || '');
        const aliasB = companyAliasKey(b?.title || b?.name || '');
        const rankA = prio.has(aliasA) ? prio.get(aliasA) : 1000;
        const rankB = prio.has(aliasB) ? prio.get(aliasB) : 1000;
        if (rankA !== rankB) return rankA - rankB;
        const logoA = a?.logoPath ? 0 : 1;
        const logoB = b?.logoPath ? 0 : 1;
        if (logoA !== logoB) return logoA - logoB;
        return String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
    });
};
