/** True when a dialog covers the page. The native context menu is drawn above the native page pieces itself, so the
 *  page stays visible beside it (a web menu/dialog still hides them: they would draw over it). */
export const nativeOverlayOpen = (selector: string): boolean => {
    const items = Array.from(document.querySelectorAll(selector));
    if (!items.length) return false;
    if (document.documentElement.dataset.nativeMenu !== '1') return true;
    return items.some((el) => !el.matches('[data-tv-item-menu="1"]'));
};

/** Calls back when the native-menu flag flips (it lives on <html>, which the body observers do not see). */
export const watchNativeMenuFlag = (cb: () => void): (() => void) => {
    const mo = new MutationObserver(cb);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-native-menu'] });
    return () => mo.disconnect();
};
