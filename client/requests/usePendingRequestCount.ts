import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';
import { usePoll } from '../shared/usePoll';
import type { PortalRequestCounts } from './types';

const POLL_MS = 90_000;

export const usePendingRequestCount = (enabled: boolean) => {
    const [counts, setCounts] = useState<PortalRequestCounts>({
        configured: false,
        connected: false,
        pending: 0,
        approved: 0,
        declined: 0,
        total: 0,
    });

    const refresh = useCallback(async () => {
        if (!enabled) {
            setCounts({ configured: false, connected: false, pending: 0, approved: 0, declined: 0, total: 0 });
            return;
        }
        try {
            const data = await apiFetch('/api/requests/count');
            setCounts({
                configured: !!data?.configured,
                connected: data?.connected !== false,
                supported: data?.supported !== false,
                pending: Number(data?.pending) || 0,
                approved: Number(data?.approved) || 0,
                declined: Number(data?.declined) || 0,
                total: Number(data?.total) || 0,
                error: data?.error || null,
            });
        } catch {
            // Keep last known counts on transient errors.
        }
    }, [enabled]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePoll(refresh, enabled ? POLL_MS : null);

    return { pendingCount: counts.pending, counts, refresh };
};
