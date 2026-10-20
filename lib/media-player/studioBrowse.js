/** Library Studios / Networks browse cards — shared helpers for portal + plex-direct. */

import { mapPoolLimited } from './mapItem.js';

export const STUDIO_BROWSE_CAP = 24;
/** Fetch extra facet rows so client logo preference can promote catalog hits. */
export const STUDIO_BROWSE_FETCH = 48;
export const STUDIO_BROWSE_ART_CONCURRENCY = 4;

export const mapStudioBrowseOptions = (options = [], limit = STUDIO_BROWSE_CAP) => (
    (Array.isArray(options) ? options : [])
        .map((row) => ({
            key: String(row?.key || '').trim(),
            title: String(row?.title || row?.key || '').trim(),
            logoPath: String(row?.logoPath || '').trim() || undefined,
            art: row?.art || null,
            thumb: row?.thumb || null,
        }))
        .filter((row) => row.key && row.title)
        .slice(0, Math.max(1, Number(limit) || STUDIO_BROWSE_CAP))
);

/**
 * Prefer catalog logos, collapse duplicate logos/aliases (Fox ×6 → one plate),
 * then alphabetical — keeps Netflix / Disney ahead of obscure tags.
 */
export const preferStudioBrowseLogos = (cards = [], limit = STUDIO_BROWSE_CAP, dedupeKey) => {
    const rows = (Array.isArray(cards) ? cards : []).slice();
    rows.sort((a, b) => {
        const logoA = a?.logoPath ? 1 : 0;
        const logoB = b?.logoPath ? 1 : 0;
        if (logoB !== logoA) return logoB - logoA;
        return String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
    });
    const keyOf = typeof dedupeKey === 'function'
        ? dedupeKey
        : (card) => {
            const logo = String(card?.logoPath || '').trim().toLowerCase();
            if (logo) return `logo:${logo}`;
            return `title:${String(card?.title || card?.key || '').trim().toLowerCase()}`;
        };
    const seen = new Set();
    const out = [];
    for (const row of rows) {
        const id = keyOf(row);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(row);
        if (out.length >= Math.max(1, Number(limit) || STUDIO_BROWSE_CAP)) break;
    }
    return out;
};

/**
 * Attach one sample thumb/art per card via limited concurrency.
 * `fetchSample(card)` → `{ art?, thumb? }` or null.
 */
export const fillStudioBrowseArt = async (cards, fetchSample, concurrency = STUDIO_BROWSE_ART_CONCURRENCY) => {
    const list = Array.isArray(cards) ? cards : [];
    if (!list.length || typeof fetchSample !== 'function') return list;
    await mapPoolLimited(list, concurrency, async (card) => {
        if (card.art || card.thumb) return;
        try {
            const sample = await fetchSample(card);
            if (sample?.art) card.art = sample.art;
            if (sample?.thumb) card.thumb = sample.thumb;
        } catch {
            /* leave blank plate */
        }
    });
    return list;
};
