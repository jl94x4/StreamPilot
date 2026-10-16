import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';
import { usePoll } from '../shared/usePoll';

const POLL_MS = 45_000;

export const useChatUnreadCount = (enabled: boolean) => {
    const [unread, setUnread] = useState(0);

    const refresh = useCallback(async () => {
        if (!enabled) {
            setUnread(0);
            return;
        }
        try {
            const data = await apiFetch('/api/chat/unread-count');
            setUnread(Number(data?.unread) || 0);
        } catch {
            /* keep last */
        }
    }, [enabled]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePoll(() => { void refresh(); }, enabled ? POLL_MS : null);

    return { unread, refresh };
};
