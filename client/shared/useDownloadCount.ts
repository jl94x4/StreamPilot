import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { isActiveDownloadItem } from './downloadStatus';
import { usePoll } from './usePoll';

export const useDownloadCount = (enabled: boolean, pollSeconds = 15) => {
    const [downloadCount, setDownloadCount] = useState(0);
    const intervalMs = Math.min(30, Math.max(5, Math.round(Number(pollSeconds) || 15))) * 1000;

    const refresh = useCallback(async () => {
        if (!enabled) {
            setDownloadCount(0);
            return;
        }
        try {
            const data = await apiFetch('/api/downloads/status');
            const list = Array.isArray(data?.downloads) ? data.downloads : [];
            const active = list.filter(isActiveDownloadItem).length;
            setDownloadCount(Math.max(0, active));
        } catch {
            // Keep the last good count during short client outages.
        }
    }, [enabled]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePoll(refresh, enabled ? intervalMs : null);

    return { downloadCount, refresh };
};
