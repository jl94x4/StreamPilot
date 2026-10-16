import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';
import { createDiscoverTranslate } from './i18n';
import { readDiscoverUiLocale } from './i18n/types';

export type DiscoveryMeProfile = {
    configured?: boolean;
    musicConfigured?: boolean;
    userMapped: boolean;
    seerrUserId: number | null;
    displayName?: string | null;
    email?: string | null;
    seerrUrl?: string;
    seerrSettingsUrl?: string;
    seerrUserUrl?: string;
    permissions: {
        request: boolean;
        requestMovie?: boolean;
        requestTv?: boolean;
        requestMusic?: boolean;
        request4k: boolean;
        request4kMovie?: boolean;
        request4kTv?: boolean;
        requestAdvanced?: boolean;
        requestTags?: boolean;
        createIssues: boolean;
        viewIssues?: boolean;
        autoApprove?: boolean;
        autoApprove4k?: boolean;
    };
    quota: {
        movie: {
            standard?: { limit: number; days: number; used: number; remaining: number | null };
            fourK?: { limit: number; days: number; used: number; remaining: number | null };
        };
        tv: {
            standard?: { limit: number; days: number; used: number; remaining: number | null };
            fourK?: { limit: number; days: number; used: number; remaining: number | null };
        };
    };
    autoApprove?: {
        requests?: boolean;
        movies?: boolean;
        tv?: boolean;
        requests4k?: boolean;
        movies4k?: boolean;
        tv4k?: boolean;
    };
    discovery?: {
        showRecentlyAdded?: boolean;
        showWatchlist?: boolean;
        nowPlayingEnabled?: boolean;
        showNowPlaying?: boolean;
    };
};

const DEFAULT_PROFILE: DiscoveryMeProfile = {
    userMapped: false,
    seerrUserId: null,
    permissions: {
        request: true,
        request4k: true,
        createIssues: true,
    },
    quota: {
        movie: {},
        tv: {},
    },
};

/** Member Seerr profile for permissions / quota UI gating. */
export const useDiscoveryMe = (enabled = true) => {
    const [profile, setProfile] = useState<DiscoveryMeProfile>(DEFAULT_PROFILE);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!enabled) {
            setProfile(DEFAULT_PROFILE);
            setError(null);
            return;
        }
        setLoading(true);
        try {
            const data = await apiFetch('/api/discovery/me');
            if (data?.error) throw new Error(data.error);
            setProfile({
                ...DEFAULT_PROFILE,
                ...data,
                permissions: {
                    ...DEFAULT_PROFILE.permissions,
                    ...(data?.permissions || {}),
                },
                quota: {
                    movie: data?.quota?.movie || {},
                    tv: data?.quota?.tv || {},
                },
            });
            setError(null);
        } catch (e: any) {
            const t = createDiscoverTranslate(readDiscoverUiLocale());
            setError(e?.message || t('request.permissionsLoadFailed'));
            setProfile(DEFAULT_PROFILE);
        } finally {
            setLoading(false);
        }
    }, [enabled]);

    useEffect(() => {
        refresh();
        const onRefresh = () => refresh();
        window.addEventListener('portal-discover-me-refresh', onRefresh);
        return () => window.removeEventListener('portal-discover-me-refresh', onRefresh);
    }, [refresh]);

    return { profile, loading, error, refresh };
};
