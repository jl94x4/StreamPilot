import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'discoveryView.';

const read = <T,>(key: string, fallback: T, valid?: (value: unknown) => boolean): T => {
    try {
        const raw = window.localStorage.getItem(PREFIX + key);
        if (raw == null) return fallback;
        const parsed = JSON.parse(raw);
        return valid && !valid(parsed) ? fallback : (parsed as T);
    } catch {
        return fallback;
    }
};

export const readPersistedView = read;

export const writePersistedView = (key: string, value: unknown) => {
    try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        /* storage blocked */
    }
};

/** useState that remembers its value in this browser between visits. */
export function usePersistedState<T>(key: string, fallback: T, valid?: (value: unknown) => boolean) {
    const [value, setValue] = useState<T>(() => read(key, fallback, valid));
    const keyRef = useRef(key);
    keyRef.current = key;
    useEffect(() => {
        writePersistedView(keyRef.current, value);
    }, [value]);
    const set = useCallback((next: T | ((prev: T) => T)) => setValue(next), []);
    return [value, set] as const;
}
