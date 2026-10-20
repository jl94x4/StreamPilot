import React, { useEffect, useState } from 'react';
import { DISCOVER_NETWORKS, DISCOVER_STUDIOS } from '../discovery/discoverConstants';
import { DiscoveryLogo } from './host';
import { shouldPreserveColorLogo } from '../discovery/discoveryLogoUtils';
import { useDiscoveryPreferences } from '../discovery/useDiscoveryPreferences';
import { fetchMediaPlayerItem } from './api';
import { useOverviewServiceLogos } from './MediaPlayerOverview';
import {
    listPreferredServiceLogos,
    resolvePlayerBrandLogo,
} from './studioLogo.js';
import { usePlayerSettings } from './usePlayerSettings';
import type { PlayerItem } from './types';

type Props = {
    item: PlayerItem | null | undefined;
    className?: string;
};

/**
 * One brand mark for TV billboards / home spot.
 * Movies → TMDB studio (then streaming); TV → Plex Network / TMDB network (then streaming).
 * Discovery+ keeps coloured D + white wordmark.
 */
export const PlayerServiceBrandMark: React.FC<Props> = ({ item, className = '' }) => {
    const { preferences } = useDiscoveryPreferences();
    const [settings] = usePlayerSettings();
    const [failedKeys, setFailedKeys] = useState<string[]>([]);
    const [enriched, setEnriched] = useState<PlayerItem | null>(null);
    const enabled = settings.showServiceBrandLogos !== false;
    const resolved = (enriched && enriched.ratingKey === item?.ratingKey) ? enriched : item;
    const safeItem = resolved || ({
        ratingKey: '',
        title: '',
        type: 'movie',
        studio: '',
        canPlay: false,
    } as PlayerItem);
    const logos = useOverviewServiceLogos(safeItem, preferences.discoverRegion || 'US');
    const mediaType = resolved?.type === 'movie' ? 'movie' : 'show';
    const skip = new Set(failedKeys);

    const preferred = (() => {
        if (!enabled || !resolved) return null;
        const usable = (row: { key?: string; logoPath?: string; name?: string } | null | undefined) => {
            if (!row) return null;
            const key = String(row.key || row.logoPath || row.name || '').trim();
            if (key && skip.has(key)) return null;
            return row;
        };
        const fromTmdb = listPreferredServiceLogos(logos, mediaType).map(usable).find(Boolean) || null;
        const sync = usable(resolvePlayerBrandLogo(resolved, {
            networks: DISCOVER_NETWORKS,
            studios: DISCOVER_STUDIOS,
        }));
        // Movies: TMDB production company / streaming first.
        // TV: Plex Network sync first, then TMDB network / streaming.
        if (mediaType === 'movie') return fromTmdb || sync;
        return sync || fromTmdb;
    })();

    // Hub rows often omit Guids — enrich so TMDB studio/network/streaming can load.
    useEffect(() => {
        const key = String(item?.ratingKey || '').trim();
        setEnriched(null);
        if (!enabled || !key || !item) return undefined;
        const isTvChild = item.type === 'episode' || item.type === 'season';
        const hasTmdb = isTvChild
            ? (Number(item.showTmdbId) > 0 || Number(item.externalIds?.tmdb) > 0)
            : (Number(item.tmdbId) > 0 || Number(item.externalIds?.tmdb) > 0);
        const already = resolvePlayerBrandLogo(item, {
            networks: DISCOVER_NETWORKS,
            studios: DISCOVER_STUDIOS,
        });
        // Still enrich when TMDB id is missing — catalog sync alone leaves most titles blank.
        if (already && hasTmdb) return undefined;
        if (hasTmdb) return undefined;
        let cancelled = false;
        void fetchMediaPlayerItem(key, { core: true, serverId: item.serverId || null })
            .then((page) => {
                if (cancelled || !page?.item) return;
                setEnriched(page.item);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [
        enabled,
        item?.ratingKey,
        item?.serverId,
        item?.studio,
        item?.showTmdbId,
        item?.tmdbId,
        item?.type,
        item?.externalIds?.tmdb,
        Array.isArray(item?.studioLabels) ? item.studioLabels.join('|') : '',
        Array.isArray(item?.networkLabels) ? item.networkLabels.join('|') : '',
    ]);

    useEffect(() => {
        setFailedKeys([]);
    }, [
        resolved?.ratingKey,
        resolved?.studio,
        resolved?.tmdbId,
        resolved?.showTmdbId,
        resolved?.externalIds?.tmdb,
        Array.isArray(resolved?.studioLabels) ? resolved.studioLabels.join('|') : '',
        Array.isArray(resolved?.networkLabels) ? resolved.networkLabels.join('|') : '',
    ]);

    if (!enabled || !preferred) return null;

    const failKey = String(preferred.key || preferred.logoPath || preferred.name || '').trim();
    // Discovery+: coloured icon + white text — must not run through brightness/invert.
    const preserveColor = shouldPreserveColorLogo(String(preferred.logoPath), preferred.name);

    return (
        <DiscoveryLogo
            logoPath={String(preferred.logoPath)}
            alt={preferred.name}
            width={300}
            loading="eager"
            duotone={false}
            tone={preserveColor ? 'auto' : 'light'}
            onError={() => {
                if (!failKey) return;
                setFailedKeys((prev) => (prev.includes(failKey) ? prev : [...prev, failKey]));
            }}
            className={`player-service-brand-mark ${preserveColor ? 'player-service-brand-mark--color' : ''} ${className}`.trim()}
        />
    );
};
