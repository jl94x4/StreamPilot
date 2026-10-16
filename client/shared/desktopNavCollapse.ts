export const DESKTOP_NAV_COLLAPSE_KEY = 'portal.desktopNav.iconsOnly.v1';
export const DESKTOP_NAV_EXPANDED_WIDTH_PX = 288;
export const DESKTOP_NAV_COLLAPSED_WIDTH_PX = 72;

export const readDesktopNavIconsOnly = (): boolean => {
    try {
        return localStorage.getItem(DESKTOP_NAV_COLLAPSE_KEY) === '1';
    } catch {
        return false;
    }
};

export const writeDesktopNavIconsOnly = (value: boolean) => {
    try {
        localStorage.setItem(DESKTOP_NAV_COLLAPSE_KEY, value ? '1' : '0');
    } catch {
        // private mode / blocked storage
    }
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.desktopNavIcons = value ? '1' : '0';
    }
};
