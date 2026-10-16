import { useEffect, useMemo, useRef, useState } from 'react';
import { posterSetsApi } from '../api';
import { coverageKeyForItem, coverageKeysForItem, type TpdbCoverageLevel } from './tpdbCacheUi';

type CoverageItem = {
    tmdbId?: string | number | null;
    tvdbId?: string | number | null;
    title?: string;
    year?: number | null;
    mediaType?: string | null;
};

export const useTpdbCoverageMap = (items: CoverageItem[], enabled = true) => {
    const [coverage, setCoverage] = useState<Record<string, TpdbCoverageLevel>>({});
    const itemsRef = useRef(items);
    itemsRef.current = items;

    const signature = useMemo(() => {
        const keys = items
            .flatMap((item) => coverageKeysForItem(item))
            .filter(Boolean)
            .sort();
        return keys.join('|');
    }, [items]);

    useEffect(() => {
        if (!enabled || !signature) {
            setCoverage({});
            return;
        }
        let cancelled = false;
        const payload = itemsRef.current
            .filter((item) => coverageKeyForItem(item))
            .slice(0, 240)
            .map((item) => ({
                tmdbId: item.tmdbId,
                tvdbId: item.tvdbId,
                title: item.title,
                year: item.year ?? null,
                mediaType: item.mediaType || 'movie',
            }));
        void posterSetsApi.tpdbCacheCoverage(payload)
            .then((result) => {
                if (cancelled) return;
                const next: Record<string, TpdbCoverageLevel> = {};
                for (const [key, value] of Object.entries(result.coverage || {})) {
                    const level = String(value?.level || 'none');
                    if (level === 'title' || level === 'sets' || level === 'images') {
                        next[key] = level;
                    }
                }
                setCoverage(next);
            })
            .catch(() => {
                if (!cancelled) setCoverage({});
            });
        return () => {
            cancelled = true;
        };
    }, [enabled, signature]);

    const levelFor = (item: CoverageItem): TpdbCoverageLevel | null => {
        for (const key of coverageKeysForItem(item)) {
            if (coverage[key]) return coverage[key];
        }
        return null;
    };

    return { coverage, levelFor };
};
