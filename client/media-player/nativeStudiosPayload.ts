import { nativeAbsoluteUrl } from './nativeHomePayload';
import { plexImageUrl } from './playerUtils';
import { TILE_TINTS } from './PlayerStudioTiles';
import type { PlayerStudioBrowseCard } from './types';

export type StudioSection = {
    /** Prefix of the web tiles' data-tv-key (`${prefix}-${card.key}`). */
    prefix: string;
    title: string;
    cards: PlayerStudioBrowseCard[];
};

const num = (value: string, fallback: number) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
};

export const studioTileKey = (prefix: string, card: PlayerStudioBrowseCard) => `${prefix}-${card.key}`;

/** Sizes of the page's Studios tiles and section headers, in the page's layout px (the page keeps them in the DOM, invisible). */
export const measureStudiosLayout = (): { layout: Record<string, unknown>; vw: number } | null => {
    if (typeof document === 'undefined') return null;
    const sections = Array.from(document.querySelectorAll<HTMLElement>('.player-library-studios [data-tv-row="1"]'));
    if (!sections.length) return null;
    const zoom = num(getComputedStyle(document.documentElement).zoom, 1) || 1;
    const grid0 = sections[0].querySelector<HTMLElement>('.player-studio-tiles');
    const tiles = grid0 ? Array.from(grid0.querySelectorAll<HTMLElement>('.player-studio-tile')) : [];
    const head0 = sections[0].querySelector<HTMLElement>('[data-tv-studio-head="1"]');
    if (!grid0 || !tiles.length || !head0 || tiles[0].offsetWidth <= 0) return null;
    const r0 = tiles[0].getBoundingClientRect();
    let cols = 1;
    for (let i = 1; i < tiles.length; i += 1) {
        if (Math.abs(tiles[i].getBoundingClientRect().top - r0.top) > 2) break;
        cols += 1;
    }
    const cardW = tiles[0].offsetWidth * zoom;
    const pitch = tiles.length > 1 && cols > 1 ? tiles[1].getBoundingClientRect().left - r0.left : cardW;
    const gridStyle = getComputedStyle(grid0);
    const colGap = cols > 1 ? Math.max(0, pitch - cardW) : num(gridStyle.columnGap, 24) * zoom;
    const rowGap = num(gridStyle.rowGap, 24) * zoom;
    const sectionTop = sections[0].getBoundingClientRect().top + window.scrollY;
    const headRect = head0.getBoundingClientRect();
    const headTitle = head0.querySelector<HTMLElement>('h2, h3, span, p') || head0;
    // Space between the end of one section's last tile row and the next section's header (native adds the row gap itself).
    let sectionGap = 48 * zoom;
    if (sections.length > 1) {
        const lastTiles = Array.from(grid0.querySelectorAll<HTMLElement>('.player-studio-tile'));
        const lastBottom = lastTiles[lastTiles.length - 1].getBoundingClientRect().bottom;
        sectionGap = Math.max(0, sections[1].getBoundingClientRect().top - lastBottom);
    }
    const rootFont = num(getComputedStyle(document.documentElement).fontSize, 16);
    const textScale = num(getComputedStyle(document.documentElement).getPropertyValue('--tv-text-scale'), 1) || 1;
    return {
        vw: window.innerWidth,
        layout: {
            cols,
            cardW,
            colGap,
            rowGap,
            posterH: tiles[0].offsetHeight * zoom,
            radius: num(getComputedStyle(tiles[0]).borderTopLeftRadius, 12) * zoom,
            padL: r0.left + window.scrollX,
            padT: sectionTop,
            bottomPad: 160,
            tile: true,
            headH: r0.top - headRect.top,
            headRowH: headRect.height,
            headSize: num(getComputedStyle(headTitle).fontSize, 24) * zoom,
            nameSize: rootFont * 1.2 * textScale * zoom,
            sectionGap,
            capTop: 0,
            titleSize: 17,
            titleLine: 21,
            subSize: 14,
            subLine: 25,
            subTop: 2,
            capLeft: 0,
            square: false,
        },
    };
};

export const buildStudiosPayload = (
    sections: StudioSection[],
    layout: Record<string, unknown>,
    logos: Map<string, string | null>,
): string => {
    const rowGap = Number(layout.rowGap) || 0;
    const sectionGap = Number(layout.sectionGap) || 0;
    const items: Array<Record<string, unknown>> = [];
    let first = true;
    sections.forEach((section) => {
        if (!section.cards.length) return;
        items.push({
            type: 'header',
            key: `hdr-${section.prefix}`,
            title: section.title,
            top: first ? 0 : Math.max(0, sectionGap - rowGap),
        });
        first = false;
        section.cards.forEach((card, index) => {
            const art = card.art || card.thumb;
            const logoKey = card.logoPath || '';
            const logo = logoKey ? logos.get(logoKey) : null;
            items.push({
                type: 'tile',
                key: studioTileKey(section.prefix, card),
                title: card.title,
                img: art ? nativeAbsoluteUrl(plexImageUrl(art, 640, 360, { quality: 70 })) : '',
                tint: TILE_TINTS[index % TILE_TINTS.length],
                logo: logo || '',
                // A logo that is still being made hides the name; one that failed shows the name.
                wantLogo: Boolean(logoKey) && !logos.has(logoKey),
            });
        });
    });
    return JSON.stringify({ layout, items });
};
