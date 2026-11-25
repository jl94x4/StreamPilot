import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { usePoll } from '../shared/usePoll';
import { useDiscoverI18n } from './i18n';
import { isPhoneUi } from '../plex-client/config';

type FactResponse = {
    facts?: string[];
    fact?: string | null;
    sources?: { wikipedia?: number; tmdb?: number };
};

/**
 * Strip MediaWiki markup so raw API text renders as clean readable prose.
 * Handles: == headings ==, [[links|labels]], {{templates}}, '''bold''',
 * ''italic'', <ref>...</ref>, HTML tags, and excess whitespace.
 */
function cleanWikiText(raw: string): string {
    let text = raw;

    // Remove <ref> blocks (citations)
    text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
    text = text.replace(/<ref[^/]*\/>/gi, '');

    // Remove HTML tags (repeat until stable so nested fragments like "<scr<b>ipt>" can't reassemble)
    let previous: string;
    do {
        previous = text;
        text = text.replace(/<[^>]+>/g, '');
    } while (text !== previous);

    // Strip == Section headings == (any level: ==, ===, ====)
    text = text.replace(/={2,}\s*[^=\n]+?\s*={2,}/g, '');

    // Unwrap [[File:...]] and [[Image:...]] / [[Category:...]] (no useful text)
    text = text.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');

    // Unwrap [[link|label]] → label, [[link]] → link
    text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
    text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');

    // Strip {{template}} blocks (iterate to handle nesting)
    for (let i = 0; i < 4; i++) {
        text = text.replace(/\{\{[^{}]*\}\}/g, '');
    }

    // Strip remaining stray { } [ ] brackets
    text = text.replace(/[{}[\]]/g, '');

    // Strip bold/italic wiki markers (''' and '')
    text = text.replace(/'{2,3}/g, '');

    // Collapse bullet/list markers at line starts
    text = text.replace(/^\s*[*#:;]+\s*/gm, '');

    // Collapse multiple spaces / newlines into a single space
    text = text.replace(/\s+/g, ' ').trim();

    // Fall back to raw if cleaning left nothing useful
    if (text.length < 10) return raw;

    return text;
}

export const DiscoveryFactWidget: React.FC<{
    mediaType: 'movie' | 'tv';
    mediaId: number;
    title?: string;
    year?: number | null;
    className?: string;
    /** Keep a short height; grow wider for longer facts instead of wrapping tall. */
    compact?: boolean;
    /** Season / episode number: lets the lookup find facts about this episode, not only the show. */
    season?: number | null;
    episode?: number | null;
    /** Facts built from the item's own Plex data. They join the fetched ones, so the box is rarely empty. */
    extraFacts?: string[];
}> = ({ mediaType, mediaId, title, year, className = '', compact = false, season, episode, extraFacts }) => {
    const shellClass = `rounded-xl border border-plex/20 bg-plex/5 flex gap-3 ${className || 'w-full'}`.trim();
    const filledShellClass = `rounded-xl border border-plex/25 bg-gradient-to-br from-plex/10 via-plex/5 to-transparent flex gap-3 ${className || 'w-full'}`.trim();
    const { t } = useDiscoverI18n();
    const [fetched, setFetched] = useState<string[]>([]);
    const [index, setIndex] = useState(0);
    const extraKey = (extraFacts || []).join('\n');
    const extraRef = useRef<string[]>([]);
    extraRef.current = extraFacts || [];
    const facts = useMemo(() => {
        const seen = new Set<string>();
        return [...fetched, ...(extraFacts || [])].filter((row) => {
            const key = String(row || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetched, extraKey]);
    const [loading, setLoading] = useState(true);

    const advanceFact = useCallback(() => {
        if (facts.length <= 1) return;
        setIndex((prev) => (prev + 1) % facts.length);
    }, [facts.length]);

    usePoll(advanceFact, facts.length > 1 ? 10_000 : null, { immediate: false });

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams({
                    mediaType,
                    mediaId: String(mediaId),
                });
                const expectedTitle = String(title || '').trim();
                if (expectedTitle) params.set('title', expectedTitle);
                if (year && Number.isFinite(year)) params.set('year', String(year));
                if (season && Number.isFinite(season) && episode && Number.isFinite(episode)) {
                    params.set('season', String(season));
                    params.set('episode', String(episode));
                }
                const res: FactResponse = await apiFetch(`/api/discovery/fact?${params.toString()}`);
                if (cancelled) return;
                const pool = Array.isArray(res?.facts) && res.facts.length
                    ? res.facts
                    : (res?.fact ? [res.fact] : []);
                setFetched(pool);
                const total = pool.length + extraRef.current.length;
                setIndex(total ? Math.floor(Math.random() * total) : 0);
            } catch {
                if (!cancelled) setFetched([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [mediaType, mediaId, title, year, season, episode]);

    const showAnother = useCallback(() => {
        if (facts.length <= 1) return;
        setIndex((prev) => {
            if (facts.length === 2) return prev === 0 ? 1 : 0;
            let next = prev;
            while (next === prev) {
                next = Math.floor(Math.random() * facts.length);
            }
            return next;
        });
    }, [facts.length]);

    if (loading && !facts.length) {
        return (
            <div className={`${shellClass} p-3 sm:p-4 items-center animate-pulse`}>
                <div className="w-9 h-9 rounded-lg bg-plex/10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 bg-white/10 rounded" />
                    <div className="h-3 w-full bg-white/5 rounded" />
                    <div className="h-3 w-4/5 bg-white/5 rounded" />
                </div>
            </div>
        );
    }

    // Nothing to say: no box at all.
    if (!facts.length) return null;

    const current = facts[index % facts.length] || facts[0];
    const bodyClass = compact
        ? `text-sm text-text/80 leading-snug whitespace-normal${isPhoneUi() ? '' : ' line-clamp-2'}`
        : 'text-sm text-text/80 leading-relaxed';
    const textColClass = compact
        ? 'flex min-w-0 max-w-full flex-col justify-center gap-1.5'
        : 'flex min-w-0 flex-1 flex-col gap-1.5 justify-center';

    return (
        <div className={`${filledShellClass} p-3 sm:p-4`}>
            <div className="w-9 h-9 rounded-lg bg-plex/15 border border-plex/20 flex items-center justify-center flex-shrink-0">
                <Lightbulb className="w-4 h-4 text-plex" />
            </div>
            <div className={textColClass}>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-plex">{t('facts.didYouKnow')}</span>
                    {facts.length > 1 && document.documentElement?.dataset?.plexClient !== '1' && (
                        <button
                            type="button"
                            onClick={showAnother}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-muted hover:text-plex transition-colors"
                        >
                            <RefreshCw className="w-3 h-3" />
                            {t('facts.another')}
                        </button>
                    )}
                </div>
                <p className={bodyClass} title={compact ? cleanWikiText(current) : undefined}>
                    {cleanWikiText(current)}
                </p>
            </div>
        </div>
    );
};
