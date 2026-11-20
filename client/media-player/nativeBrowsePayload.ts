import type { PlayerItem } from './types';
import { nativeCardImage } from './nativeHomePayload';
import { progressPercent } from './playerUtils';
import { visibleEl } from './nativeScan';

/** Layout numbers of the page's Browse grid, in the page's layout px (the native view scales them to the screen). */
export type BrowseLayoutMeasure = {
    cols: number;
    cardW: number;
    colGap: number;
    rowGap: number;
    posterH: number;
    radius: number;
    padL: number;
    padT: number;
    capTop: number;
    capLeft: number;
    titleSize: number;
    titleLine: number;
    subSize: number;
    subLine: number;
    subTop: number;
    bottomPad: number;
    square: boolean;
};

const num = (value: string, fallback: number) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Read the grid's real sizes off its first cards (the page keeps the grid in the DOM, invisible), so the
 * native cards line up with them whatever the density / zoom. Null until a card is laid out.
 */
export const measureBrowseLayout = (): { layout: BrowseLayoutMeasure; vw: number } | null => {
    if (typeof document === 'undefined') return null;
    const grid = visibleEl('[data-tv-browse-grid="1"]');
    const cards = grid ? Array.from(grid.querySelectorAll<HTMLElement>('[data-browse-index]')) : [];
    if (!grid || !cards.length) return null;
    const zoom = num(getComputedStyle(document.documentElement).zoom, 1) || 1;
    const c0 = cards[0];
    const frame = c0.querySelector<HTMLElement>('.player-poster-frame');
    const caption = c0.querySelector<HTMLElement>('.player-poster-caption');
    if (!frame || frame.offsetWidth <= 0) return null;
    const r0 = c0.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    let cols = 1;
    for (let i = 1; i < cards.length; i += 1) {
        if (Math.abs(cards[i].getBoundingClientRect().top - r0.top) > 2) break;
        cols += 1;
    }
    const cardW = frame.offsetWidth * zoom;
    const pitch = cards.length > 1 ? cards[1].getBoundingClientRect().left - r0.left : cardW;
    const gridStyle = getComputedStyle(grid);
    const colGap = cols > 1 ? Math.max(0, pitch - cardW) : num(gridStyle.columnGap, 12) * zoom;
    const rowGap = num(gridStyle.rowGap, 12) * zoom;
    const title = caption?.children[0] as HTMLElement | undefined;
    const sub = caption?.children[1] as HTMLElement | undefined;
    const titleStyle = title ? getComputedStyle(title) : null;
    const subStyle = sub ? getComputedStyle(sub) : null;
    const titleSize = num(titleStyle?.fontSize || '', 16) * zoom;
    const subSize = num(subStyle?.fontSize || '', 14) * zoom;
    const capRect = caption?.getBoundingClientRect();
    const titleRect = title?.getBoundingClientRect();
    const subRect = sub?.getBoundingClientRect();
    return {
        vw: window.innerWidth,
        layout: {
            cols,
            cardW,
            colGap,
            rowGap,
            posterH: frame.offsetHeight * zoom,
            radius: num(getComputedStyle(frame).borderTopLeftRadius, 6) * zoom,
            padL: r0.left + window.scrollX,
            padT: r0.top + window.scrollY,
            capTop: capRect ? capRect.top - fr.bottom : 6,
            capLeft: caption ? num(getComputedStyle(caption).paddingLeft, 0) * zoom : 0,
            titleSize,
            titleLine: num(titleStyle?.lineHeight || '', titleSize * 1.25 / zoom) * zoom,
            subSize,
            subLine: num(subStyle?.lineHeight || '', subSize * 1.5 / zoom) * zoom,
            subTop: titleRect && subRect ? Math.max(0, subRect.top - titleRect.bottom) : 1.25,
            bottomPad: 80,
            square: Math.abs(frame.offsetHeight - frame.offsetWidth) < 2,
        },
    };
};

export type BrowseCaptions = {
    /** Second caption line ("2024 · note"). */
    sub: (item: PlayerItem) => string;
    /** Third caption line (a new season notice). */
    note: (item: PlayerItem) => string;
};

export const buildNativeBrowsePayload = (
    items: PlayerItem[],
    layout: BrowseLayoutMeasure,
    captions: BrowseCaptions,
    tickPosition = 'bottom-left',
): string => JSON.stringify({
    layout,
    items: items.map((item) => ({
        key: String(item.ratingKey || ''),
        img: nativeCardImage(item, layout.square ? 'square' : '2/3'),
        title: item.title || '',
        sub: captions.sub(item),
        note: captions.note(item),
        progress: Math.round(progressPercent(item)) / 100,
        watched: item.watched === true,
        tick: item.type === 'episode' ? 'top-right' : tickPosition,
    })),
});
