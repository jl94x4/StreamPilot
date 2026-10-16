export const ANALYTICS_PERIOD_OPTIONS = [
    { value: 7, label: 'Last 7 Days' },
    { value: 30, label: 'Last 30 Days' },
    { value: 60, label: 'Last 60 Days' },
    { value: 90, label: 'Last 90 Days' },
    { value: 120, label: 'Last 120 Days' },
    { value: 180, label: 'Last 180 Days' },
    { value: 365, label: 'Last 365 Days' },
    { value: 'all' as const, label: 'All Time' },
];

/** Periods offered inside the wrap-up recap story (needs a comparable window). */
export const WRAP_UP_RECAP_PERIODS = [7, 30, 90, 120, 365] as const;

export type AnalyticsPeriodDays = number | 'all';

const HOME_ANALYTICS_DAYS_KEY = 'portal-home-analytics-days';
const VALID_ANALYTICS_DAYS = new Set(
    ANALYTICS_PERIOD_OPTIONS.map((opt) => opt.value).filter((value): value is number => typeof value === 'number'),
);

/** Default / restore home wrap-up + most-watched period (persisted per browser). */
export const readPersistedAnalyticsDays = (): AnalyticsPeriodDays => {
    try {
        const raw = localStorage.getItem(HOME_ANALYTICS_DAYS_KEY);
        if (raw === 'all') return 'all';
        const days = Number(raw);
        if (VALID_ANALYTICS_DAYS.has(days)) return days;
    } catch {
        /* private mode / blocked storage */
    }
    return 7;
};

export const persistAnalyticsDays = (value: AnalyticsPeriodDays) => {
    try {
        if (value === 'all' || VALID_ANALYTICS_DAYS.has(Number(value))) {
            localStorage.setItem(HOME_ANALYTICS_DAYS_KEY, String(value));
        }
    } catch {
        /* ignore */
    }
};
