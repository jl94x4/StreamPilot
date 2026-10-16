const STORAGE_KEY = 'media-automation-system-metrics-refresh-ms';
export const SYSTEM_METRICS_REFRESH_EVENT = 'media-automation-system-metrics-refresh';

export const SYSTEM_METRICS_REFRESH_OPTIONS = [
    { value: 1, label: 'Maximum (1 ms)' },
    { value: 100, label: '100 ms' },
    { value: 250, label: '250 ms' },
    { value: 500, label: '500 ms' },
    { value: 1000, label: '1 second' },
    { value: 2000, label: '2 seconds' },
    { value: 5000, label: '5 seconds' },
    { value: 10000, label: '10 seconds' },
    { value: 30000, label: '30 seconds' },
] as const;

export type SystemMetricsRefreshMs = typeof SYSTEM_METRICS_REFRESH_OPTIONS[number]['value'];

export const DEFAULT_SYSTEM_METRICS_REFRESH_MS: SystemMetricsRefreshMs = 1;

const ALLOWED = new Set<number>(SYSTEM_METRICS_REFRESH_OPTIONS.map((option) => option.value));

export const readSystemMetricsRefreshMs = (): SystemMetricsRefreshMs => {
    try {
        const raw = Number(localStorage.getItem(STORAGE_KEY));
        if (ALLOWED.has(raw)) return raw as SystemMetricsRefreshMs;
    } catch {
        // ignore quota / private mode
    }
    return DEFAULT_SYSTEM_METRICS_REFRESH_MS;
};

export const writeSystemMetricsRefreshMs = (value: number): SystemMetricsRefreshMs => {
    const next = (ALLOWED.has(value) ? value : DEFAULT_SYSTEM_METRICS_REFRESH_MS) as SystemMetricsRefreshMs;
    try {
        localStorage.setItem(STORAGE_KEY, String(next));
        window.dispatchEvent(new CustomEvent(SYSTEM_METRICS_REFRESH_EVENT, { detail: next }));
    } catch {
        // ignore quota / private mode
    }
    return next;
};

export const formatSystemMetricsRefreshLabel = (ms: number) => {
    const match = SYSTEM_METRICS_REFRESH_OPTIONS.find((option) => option.value === ms);
    return match?.label || `${ms} ms`;
};
