import { useEffect, useState } from 'react';

/** How much of the layout viewport is covered by the on-screen keyboard. */
export const useVisualViewportInset = (active: boolean): number => {
    const [inset, setInset] = useState(0);

    useEffect(() => {
        if (!active || typeof window === 'undefined') {
            setInset(0);
            return undefined;
        }
        const viewport = window.visualViewport;
        if (!viewport) return undefined;

        const update = () => {
            setInset(Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height));
        };

        update();
        viewport.addEventListener('resize', update);
        viewport.addEventListener('scroll', update);
        return () => {
            viewport.removeEventListener('resize', update);
            viewport.removeEventListener('scroll', update);
        };
    }, [active]);

    return inset;
};
