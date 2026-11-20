import { useEffect } from 'react';
import { isNativeHomeSupported, nativeMenuHide, nativeMenuSet, onNativeHomeEvent } from '../plex-client/nativeHome';
import { PERF_FLAGS_EVENT, readPerfFlags } from './PlayerPerfOverlay';

/**
 * TV: the title menu (long-press on a poster, the page's ⋯ button) is drawn by the native menu view instead of
 * the web sheet. The web sheet still mounts, invisible, and stays the source of truth: its rows are read
 * into a list for the native view, and a pick clicks the matching web button, so every action, toast and
 * sub-menu (playlists, collections, tracks) behaves exactly as before.
 */

const SHEET = '[data-tv-item-menu="1"][data-tv-context-sheet="1"]';

type Ref = { kind: 'row'; el: HTMLElement } | { kind: 'stars'; stars: HTMLElement[]; clear: HTMLElement | null };

const iconCache = new Map<string, string>();

/** A lucide <svg> as a white PNG (base64), so the native rows can tint it. */
const svgToPng = (svg: SVGElement): Promise<string> => {
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '64');
    clone.setAttribute('height', '64');
    clone.setAttribute('style', 'color:#fff');
    clone.querySelectorAll<SVGElement>('[class]').forEach((node) => node.removeAttribute('class'));
    if (svg.classList.contains('fill-current')) clone.setAttribute('fill', '#fff');
    const markup = new XMLSerializer().serializeToString(clone);
    const cached = iconCache.get(markup);
    if (cached !== undefined) return Promise.resolve(cached);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 64;
                canvas.height = 64;
                canvas.getContext('2d')?.drawImage(img, 0, 0, 64, 64);
                const out = canvas.toDataURL('image/png').split(',')[1] || '';
                iconCache.set(markup, out);
                resolve(out);
            } catch {
                resolve('');
            }
        };
        img.onerror = () => resolve('');
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
};

const labelOf = (el: HTMLElement): string => (el.textContent || '').replace(/\s+/g, ' ').trim();

type Scraped = { json: string; refs: Ref[] } | null;

const scrape = async (sheet: HTMLElement): Promise<Scraped> => {
    const refs: Ref[] = [];
    const items: Array<Record<string, unknown>> = [];
    const buttons = Array.from(sheet.querySelectorAll<HTMLElement>('[data-tv-menu-item="1"]'));
    const starGroups = new Map<Element, { stars: HTMLElement[]; clear: HTMLElement | null; at: number }>();
    const pending: Array<Promise<void>> = [];
    buttons.forEach((el) => {
        const aria = el.getAttribute('aria-label') || '';
        const rail = el.closest('[data-tv-rail="1"]');
        if (rail && /^[1-5]$/.test(aria)) {
            let group = starGroups.get(rail);
            if (!group) {
                group = { stars: [], clear: null, at: items.length };
                starGroups.set(rail, group);
                const caption = rail.querySelector('p');
                items.push({ k: 'stars', label: labelOf(caption as HTMLElement || el), filled: 0, clear: false });
                refs.push({ kind: 'stars', stars: [], clear: null });
            }
            group.stars.push(el);
            if (el.querySelector('svg.fill-plex')) items[group.at].filled = Number(aria);
            return;
        }
        if (rail && starGroups.has(rail)) {
            const group = starGroups.get(rail);
            if (group) {
                group.clear = el;
                items[group.at].clear = true;
                items[group.at].clearLabel = labelOf(el);
            }
            return;
        }
        // A row with a value ("Sort by" | "Title" >): the label and the value are separate spans.
        const spans = Array.from(el.children).filter((c) => c.tagName === 'SPAN') as HTMLElement[];
        const valueEl = spans.length >= 2 && !spans[0].querySelector('svg') ? spans[1] : null;
        const label = valueEl ? labelOf(spans[0]) : labelOf(el);
        if (!label) return;
        const svg = el.querySelector<SVGElement>('svg:not([class*="chevron"])');
        const entry: Record<string, unknown> = {
            k: el.hasAttribute('data-tv-menu-watch') ? 'pill' : 'row',
            label,
            primary: el.hasAttribute('data-tv-menu-watch') && !!svg,
            chev: !!el.querySelector('svg.lucide-chevron-right'),
            dis: (el as HTMLButtonElement).disabled === true,
            sub: el.classList.contains('pl-10'),
            cur: el.getAttribute('aria-checked') === 'true',
            ...(valueEl && labelOf(valueEl) ? { val: labelOf(valueEl), valDim: valueEl.className.includes('white/45') } : {}),
        };
        const index = items.length;
        items.push(entry);
        refs.push({ kind: 'row', el });
        if (svg) {
            pending.push(svgToPng(svg).then((png) => {
                entry.icon = png;
                return undefined;
            }));
        }
        void index;
    });
    starGroups.forEach((group) => {
        const ref = refs[group.at];
        if (ref.kind === 'stars') {
            ref.stars = group.stars;
            ref.clear = group.clear;
        }
    });
    await Promise.all(pending);
    if (!items.length) return null;
    const logo = sheet.querySelector<HTMLImageElement>('.player-context-logo img');
    const title = sheet.querySelector('h2');
    let logoUrl = '';
    let logoData = '';
    const src = logo ? (logo.currentSrc || logo.src || '') : '';
    if (src.startsWith('data:')) logoData = src.split(',')[1] || '';
    else if (src) {
        try {
            logoUrl = new URL(src, window.location.href).toString();
        } catch {
            logoUrl = src;
        }
    }
    const server = sheet.querySelector('p.uppercase');
    return {
        json: JSON.stringify({
            title: title ? labelOf(title as HTMLElement) : '',
            server: server ? labelOf(server as HTMLElement) : '',
            logoUrl,
            logoData,
            items,
        }),
        refs,
    };
};

export const useNativeContextMenu = (enabled: boolean): void => {
    useEffect(() => {
        if (!enabled || !isNativeHomeSupported() || document.documentElement.dataset.tv !== '1') return undefined;
        let flag = readPerfFlags().nativeHome;
        const onFlags = () => {
            flag = readPerfFlags().nativeHome;
        };
        window.addEventListener(PERF_FLAGS_EVENT, onFlags);

        let refs: Ref[] = [];
        let shown = false;
        let sheetEl: HTMLElement | null = null;
        let busy = false;
        let again = false;
        let lastJson = '';

        const hideWeb = (sheet: HTMLElement | null, on: boolean) => {
            const backdrop = sheet?.closest<HTMLElement>('[data-tv-context-backdrop="1"]') || null;
            if (!backdrop) return;
            if (on) backdrop.setAttribute('data-nm-hide', '1');
            else backdrop.removeAttribute('data-nm-hide');
        };

        const sync = async () => {
            if (busy) {
                again = true;
                return;
            }
            busy = true;
            try {
                const sheet = flag ? document.querySelector<HTMLElement>(SHEET) : null;
                if (sheet && document.querySelector('[data-tv-screensaver="1"]')) {
                    // The screensaver came on with the menu open: close the menu (the web one does the same).
                    window.dispatchEvent(new Event('smp-tv-menu-close'));
                    window.dispatchEvent(new Event('smp-tv-overlay-close'));
                    if (shown) {
                        shown = false;
                        lastJson = '';
                        refs = [];
                        hideWeb(sheetEl, false);
                        delete document.documentElement.dataset.nativeMenu;
                        sheetEl = null;
                        await nativeMenuHide(false);
                    }
                    return;
                }
                if (!sheet) {
                    if (shown) {
                        shown = false;
                        lastJson = '';
                        refs = [];
                        hideWeb(sheetEl, false);
                        delete document.documentElement.dataset.nativeMenu;
                        sheetEl = null;
                        await nativeMenuHide(true);
                    }
                    return;
                }
                const scraped = await scrape(sheet);
                if (!scraped || !document.body.contains(sheet)) return;
                sheetEl = sheet;
                refs = scraped.refs;
                if (scraped.json === lastJson && shown) return;
                lastJson = scraped.json;
                hideWeb(sheet, true);
                shown = true;
                document.documentElement.dataset.nativeMenu = '1';
                await nativeMenuSet(scraped.json);
            } finally {
                busy = false;
                if (again) {
                    again = false;
                    void sync();
                }
            }
        };

        let timer = 0;
        const schedule = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void sync(), 30);
        };
        const observer = new MutationObserver(() => {
            // Before the next paint: the web sheet must never show for a frame while the native one is on its way.
            if (flag) {
                const fresh = document.querySelector<HTMLElement>(SHEET);
                if (fresh) hideWeb(fresh, true);
            }
            schedule();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled'] });

        const offPick = onNativeHomeEvent('menuPick', (data) => {
            const ref = refs[Number(data.rowId)];
            if (!ref) return;
            if (ref.kind === 'row') {
                ref.el.click();
                return;
            }
            const key = String(data.key || '');
            if (key === 'clear') ref.clear?.click();
            else ref.stars[Number(key) - 1]?.click();
        });
        const offBack = onNativeHomeEvent('menuBack', () => {
            window.dispatchEvent(new Event('smp-tv-select-close'));
            window.dispatchEvent(new Event('smp-tv-menu-close'));
            window.dispatchEvent(new Event('smp-tv-overlay-close'));
        });

        return () => {
            window.clearTimeout(timer);
            observer.disconnect();
            offPick();
            offBack();
            window.removeEventListener(PERF_FLAGS_EVENT, onFlags);
            if (shown) {
                delete document.documentElement.dataset.nativeMenu;
                hideWeb(sheetEl, false);
                void nativeMenuHide(true);
            }
        };
    }, [enabled]);
};
