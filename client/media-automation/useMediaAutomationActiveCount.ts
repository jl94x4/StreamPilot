import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';

/** Poll Media Automation active (processing) job count for the sidebar badge. */
export const useMediaAutomationActiveCount = (enabled: boolean, pollSeconds = 15) => {
    const [activeCount, setActiveCount] = useState(0);
    const intervalMs = Math.min(60, Math.max(5, Math.round(Number(pollSeconds) || 15))) * 1000;

    const refresh = useCallback(async () => {
        if (!enabled) {
            setActiveCount(0);
            return;
        }
        try {
            const data = await apiFetch('/api/media-automation/status');
            setActiveCount(Math.max(0, Number(data?.activeJobs) || 0));
        } catch {
            // Keep the last good count during short client outages / feature gated 403s.
        }
    }, [enabled]);

    useEffect(() => {
        refresh();
        if (!enabled) return undefined;
        const timer = window.setInterval(refresh, intervalMs);
        return () => window.clearInterval(timer);
    }, [enabled, intervalMs, refresh]);

    return { activeCount, refresh };
};

export default useMediaAutomationActiveCount;
