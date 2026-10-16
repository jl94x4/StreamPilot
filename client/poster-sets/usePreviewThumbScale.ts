import { useCallback, useEffect, useState } from 'react';
import {
    PREVIEW_THUMB_SCALE_EVENT,
    clampPreviewThumbScale,
    readPreviewThumbScale,
    writePreviewThumbScale,
} from './previewThumbScale';

export function usePreviewThumbScale() {
    const [scale, setScaleState] = useState(readPreviewThumbScale);
    useEffect(() => {
        const onChange = (event: Event) => {
            const detail = (event as CustomEvent<number>).detail;
            setScaleState(clampPreviewThumbScale(detail));
        };
        window.addEventListener(PREVIEW_THUMB_SCALE_EVENT, onChange);
        return () => window.removeEventListener(PREVIEW_THUMB_SCALE_EVENT, onChange);
    }, []);
    const setScale = useCallback((value: number) => {
        setScaleState(writePreviewThumbScale(value));
    }, []);
    return [scale, setScale] as const;
}
