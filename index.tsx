import { createRoot } from 'react-dom/client';
import { MainApp } from './client/App';
import {
    installIosKeyboardScrollLock,
    installIosTextZoomGuard,
    isIosClient,
    VIEWPORT_BASE,
    VIEWPORT_NO_AUTOZOOM,
} from './client/shared/iosKeyboardScrollLock';

// iOS auto-zoom: 16px fields + maximum-scale=1 in index.html at parse time.
// Strip that lock here on non-iOS so desktop/Android keep pinch-zoom.
installIosTextZoomGuard();

const viewportMeta = document.querySelector('meta[name="viewport"]');
if (viewportMeta && !isIosClient()) {
    viewportMeta.setAttribute('content', VIEWPORT_BASE);
}
if (/Android/i.test(navigator.userAgent)) {
    // Android Chrome can keep a leftover pinch/focus scale across SPA loads.
    // Briefly lock maximum-scale to snap back to 1, then restore pinch-zoom.
    const resetAndroidZoom = () => {
        if (!viewportMeta) return;
        const scale = window.visualViewport?.scale ?? 1;
        if (scale <= 1.01) return;
        viewportMeta.setAttribute('content', VIEWPORT_NO_AUTOZOOM);
        requestAnimationFrame(() => {
            viewportMeta.setAttribute('content', VIEWPORT_BASE);
        });
    };
    resetAndroidZoom();
    window.addEventListener('pageshow', resetAndroidZoom);
}
// Stop iOS shoving the page up when the keyboard opens on an already-visible field.
installIosKeyboardScrollLock();

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<MainApp />);
