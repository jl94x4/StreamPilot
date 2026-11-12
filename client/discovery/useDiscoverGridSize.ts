import { useCallback, useEffect, useState } from 'react';
import { isPhoneUi } from '../plex-client/config';
import {
    DEFAULT_POSTER_GRID_SCALE,
    parsePosterGridValue,
} from '../shared/portalLayout';

export const DISCOVERY_GRID_SIZE_STORAGE_KEY = 'discoveryGridSize.v2';

/** Phones keep their own size (and a slightly smaller default) so the portal's setting is untouched. */
const GRID_SIZE_EVENT = 'discovery-grid-size-change';
const PHONE_GRID_SIZE_STORAGE_KEY = 'discoveryGridSize.phone.v3';
const PHONE_DEFAULT_GRID_SCALE = 8.25;

export const useDiscoverGridSize = () => {
    const phone = typeof window !== 'undefined' && isPhoneUi();
    const storageKey = phone ? PHONE_GRID_SIZE_STORAGE_KEY : DISCOVERY_GRID_SIZE_STORAGE_KEY;
    const fallback = phone ? PHONE_DEFAULT_GRID_SCALE : DEFAULT_POSTER_GRID_SCALE;
    const [gridSize, setLocal] = useState<number>(() => {
        if (typeof window === 'undefined') return DEFAULT_POSTER_GRID_SCALE;
        let raw: string | null = null;
        try { raw = window.localStorage.getItem(storageKey); } catch { /* ignore */ }
        // Nothing saved yet: use the default (parsePosterGridValue would answer with its own).
        if (raw == null || raw === '') return fallback;
        const parsed = parsePosterGridValue(raw);
        return typeof parsed === 'number' ? parsed : fallback;
    });

    // Home and Library stay mounted side by side: a change in one reaches the other at once,
    // so the poster size is always the same on both.
    useEffect(() => {
        const onChange = (event: Event) => {
            const detail = (event as CustomEvent<{ key: string; value: number }>).detail;
            if (typeof detail?.value === 'number') setLocal(detail.value);
        };
        window.addEventListener(GRID_SIZE_EVENT, onChange);
        return () => window.removeEventListener(GRID_SIZE_EVENT, onChange);
    }, [storageKey]);

    const setGridSize = useCallback((value: number | ((prev: number) => number)) => {
        setLocal((prev) => {
            const next = typeof value === 'function' ? value(prev) : value;
            try { window.localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
            if (next !== prev) {
                window.setTimeout(() => window.dispatchEvent(new CustomEvent(GRID_SIZE_EVENT, { detail: { key: storageKey, value: next } })), 0);
            }
            return next;
        });
    }, [storageKey]);

    useEffect(() => {
        try { window.localStorage.setItem(storageKey, String(gridSize)); } catch { /* ignore */ }
    }, [gridSize, storageKey]);

    return [gridSize, setGridSize] as const;
};
