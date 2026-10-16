import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';
import { usePoll } from '../shared/usePoll';

export type MemberRequestCounts = {
    configured?: boolean;
    userMapped?: boolean;
    pending: number;
    approved: number;
    available: number;
    declined: number;
    failed: number;
    total: number;
    error?: string | null;
};

const POLL_MS = 90_000;

export const useMyRequestCount = (enabled: boolean) => {
    const [counts, setCounts] = useState<MemberRequestCounts>({
        pending: 0,
        approved: 0,
        available: 0,
        declined: 0,
        failed: 0,
        total: 0,
    });

    const refresh = useCallback(async () => {
        if (!enabled) {
            setCounts({
                pending: 0,
                approved: 0,
                available: 0,
                declined: 0,
                failed: 0,
                total: 0,
            });
            return;
        }
        try {
            const data = await apiFetch('/api/discovery/my-requests/count');
            setCounts({
                configured: !!data?.configured,
                userMapped: data?.userMapped !== false,
                pending: Number(data?.pending) || 0,
                approved: Number(data?.approved) || 0,
                available: Number(data?.available) || 0,
                declined: Number(data?.declined) || 0,
                failed: Number(data?.failed) || 0,
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
