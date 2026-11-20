export const num = (value: string | null | undefined, fallback: number) => {
    const n = Number.parseFloat(String(value || ''));
    return Number.isFinite(n) ? n : fallback;
};

/** An svg's shapes as path data (Lucide icons are stroked circles, rects, lines and paths). */
export const svgPaths = (svg: SVGElement): string[] => {
    const out: string[] = [];
    svg.querySelectorAll('*').forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const a = (name: string) => num(el.getAttribute(name), 0);
        if (tag === 'path') {
            const d = el.getAttribute('d');
            if (d) out.push(d);
        } else if (tag === 'circle') {
            const cx = a('cx');
            const cy = a('cy');
            const r = a('r');
            out.push(`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`);
        } else if (tag === 'ellipse') {
            const cx = a('cx');
            const cy = a('cy');
            const rx = a('rx');
            const ry = a('ry');
            out.push(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`);
        } else if (tag === 'rect') {
            const x = a('x');
            const y = a('y');
            const w = a('width');
            const h = a('height');
            const rx = Math.min(a('rx') || a('ry'), w / 2);
            const ry = Math.min(a('ry') || a('rx'), h / 2);
            out.push(`M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`);
        } else if (tag === 'line') {
            out.push(`M${a('x1')} ${a('y1')}L${a('x2')} ${a('y2')}`);
        } else if (tag === 'polyline' || tag === 'polygon') {
            const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
            let d = '';
            for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? 'L' : 'M'}${pts[i]} ${pts[i + 1]}`;
            if (d) out.push(tag === 'polygon' ? `${d}z` : d);
        }
    });
    return out;
};

/** First match that is actually on screen: a library page kept mounted (hidden) under a detail page has the same selectors. */
export const visibleEl = (selector: string): HTMLElement | null => {
    const all = document.querySelectorAll<HTMLElement>(selector);
    for (let i = 0; i < all.length; i += 1) {
        if (all[i].getClientRects().length > 0) return all[i];
    }
    return null;
};
