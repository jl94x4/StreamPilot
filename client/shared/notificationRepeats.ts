export type NotificationRepeatEntry = {
    body: string;
    createdAt?: string;
    posterUrl?: string | null;
    posterPath?: string | null;
};

export type RepeatableNotification = {
    body?: string;
    createdAt?: string;
    meta?: {
        repeatHistory?: unknown;
        repeatCount?: number;
        posterUrl?: string | null;
        posterPath?: string | null;
        [key: string]: unknown;
    };
};

export const getNotificationRepeatEntries = (item: RepeatableNotification): NotificationRepeatEntry[] => {
    const raw = item.meta?.repeatHistory;
    if (Array.isArray(raw)) {
        const parsed = raw
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const body = String((entry as { body?: string }).body || '').trim();
                if (!body) return null;
                return {
                    body,
                    createdAt: (entry as { createdAt?: string }).createdAt,
                    posterUrl: (entry as { posterUrl?: string | null }).posterUrl,
                    posterPath: (entry as { posterPath?: string | null }).posterPath,
                } as NotificationRepeatEntry;
            })
            .filter(Boolean) as NotificationRepeatEntry[];
        if (parsed.length) return parsed;
    }

    const body = String(item.body || '').trim();
    if (!body) return [];
    return [{
        body,
        createdAt: item.createdAt,
        posterUrl: item.meta?.posterUrl,
        posterPath: item.meta?.posterPath,
    }];
};
