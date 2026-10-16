/** Normalize overlay run result payloads for UI display. */
export type OverlayRunSummary = Record<string, unknown>;

export type ParsedRunSummary = {
    bundle: 'core' | 'recently' | 'kometa' | 'collections' | 'scan' | 'other';
    command: string;
    finishedAt: string | null;
    previewMode: boolean;
    added: number;
    removed: number;
    episodesAdded: number;
    episodesRemoved: number;
    skipped: number;
    eligible: number;
};

const num = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

export const inferRunBundle = (summary: OverlayRunSummary | null | undefined): ParsedRunSummary['bundle'] => {
    if (!summary) return 'other';
    const cmd = String(summary.command || '').toLowerCase();
    const bundle = String(summary.runBundle || '').toLowerCase();
    if (cmd === 'scan' || cmd === 'reconcile') return 'scan';
    if (bundle === 'collections' || cmd.includes('collections')) return 'collections';
    if (bundle === 'recently' || cmd.includes('recently')) return 'recently';
    if (bundle === 'kometa' || cmd.includes('kometa')) return 'kometa';
    if (bundle === 'core' || cmd === 'run' || cmd === 'preview' || cmd === 'cleanup') return 'core';
    return 'other';
};

export const parseRunSummary = (summary: OverlayRunSummary | null | undefined): ParsedRunSummary | null => {
    if (!summary || typeof summary !== 'object') return null;
    const bundle = inferRunBundle(summary);
    const command = String(summary.command || '—');
    const finishedAt = summary.finishedAt ? String(summary.finishedAt) : null;
    const previewMode = summary.previewMode === true;

    if (bundle === 'scan') {
        return {
            bundle,
            command,
            finishedAt,
            previewMode,
            added: 0,
            removed: 0,
            episodesAdded: 0,
            episodesRemoved: 0,
            skipped: 0,
            eligible: num(summary.eligible ?? summary.eligibleCount),
        };
    }

    if (bundle === 'kometa' || bundle === 'collections') {
        return {
            bundle,
            command,
            finishedAt,
            previewMode,
            added: num(summary.kometaAdded),
            removed: num(summary.kometaRemoved),
            episodesAdded: 0,
            episodesRemoved: 0,
            skipped: num(summary.kometaSkipped),
            eligible: num(summary.kometaEligible),
        };
    }

    if (bundle === 'recently') {
        return {
            bundle,
            command,
            finishedAt,
            previewMode,
            added: num(summary.recentlyAddedAdded ?? summary.recentlyAdded),
            removed: num(summary.recentlyAddedRemoved),
            episodesAdded: 0,
            episodesRemoved: 0,
            skipped: num(summary.recentlyAddedSkipped),
            eligible: num(summary.recentlyAddedEligible),
        };
    }

    return {
        bundle: bundle === 'other' ? 'core' : bundle,
        command,
        finishedAt,
        previewMode,
        added: num(summary.added),
        removed: num(summary.removed),
        episodesAdded: num(summary.episodesAdded),
        episodesRemoved: num(summary.episodesRemoved),
        skipped: num(summary.skipped),
        eligible: num(summary.eligible ?? summary.eligibleCount),
    };
};

export type RunSummaryI18nKey =
    | 'overlays.summary.scan'
    | 'overlays.summary.kometa'
    | 'overlays.summary.recently'
    | 'overlays.summary.core';

export const runSummaryI18nKey = (parsed: ParsedRunSummary): RunSummaryI18nKey => {
    if (parsed.bundle === 'scan') return 'overlays.summary.scan';
    if (parsed.bundle === 'kometa' || parsed.bundle === 'collections') return 'overlays.summary.kometa';
    if (parsed.bundle === 'recently') return 'overlays.summary.recently';
    return 'overlays.summary.core';
};

export const pickLatestRunSummary = (
    summaries: Array<OverlayRunSummary | null | undefined>,
): OverlayRunSummary | null => {
    let best: OverlayRunSummary | null = null;
    let bestTs = 0;
    for (const summary of summaries) {
        if (!summary || typeof summary !== 'object') continue;
        const ts = Date.parse(String(summary.finishedAt || ''));
        if (!Number.isFinite(ts)) continue;
        if (!best || ts > bestTs) {
            best = summary;
            bestTs = ts;
        }
    }
    return best;
};

export const formatRunSummaryDetail = (
    parsed: ParsedRunSummary,
    t: (key: string, vars?: Record<string, string | number>) => string,
): string => {
    const preview = parsed.previewMode ? t('overlays.overview.previewSuffix') : '';
    if (parsed.bundle === 'scan') {
        return t('overlays.summary.scan', { eligible: parsed.eligible });
    }
    if (parsed.bundle === 'kometa' || parsed.bundle === 'collections') {
        return t('overlays.summary.kometa', {
            added: parsed.added,
            removed: parsed.removed,
            skipped: parsed.skipped > 0
                ? t('overlays.summary.kometaSkipped', { skipped: parsed.skipped })
                : '',
            preview,
        });
    }
    if (parsed.bundle === 'recently') {
        return t('overlays.summary.recently', {
            added: parsed.added,
            removed: parsed.removed,
            preview,
        });
    }
    return t('overlays.summary.core', {
        added: parsed.added,
        removed: parsed.removed,
        episodesAdded: parsed.episodesAdded,
        episodesRemoved: parsed.episodesRemoved,
        preview,
    });
};

export const formatRunSummaryWhen = (
    summary: OverlayRunSummary | null | undefined,
    fallbackAt?: string | null,
): string | null => {
    const parsed = parseRunSummary(summary);
    if (parsed?.finishedAt) return parsed.finishedAt;
    return fallbackAt || null;
};
