/** Group milestone badges that share a metric into one ladder family. */

export type BadgeLike = {
    id: string;
    name?: string;
    description?: string;
    icon?: string;
    category?: string;
    rarity?: string;
    metric?: string;
    threshold?: number;
    progress?: number;
    progressPct?: number;
    earned?: boolean;
    earnedAt?: string | null;
};

export type BadgeFamily = {
    key: string;
    metric: string;
    category: string;
    icon: string;
    label: string;
    tiers: BadgeLike[];
    earnedCount: number;
    totalCount: number;
    /** Highest earned tier, or first locked if none earned */
    focus: BadgeLike;
    next: BadgeLike | null;
    currentValue: number;
};

const familyLabel = (badges: BadgeLike[]) => {
    const first = badges[0];
    if (!first) return 'Ladder';
    // Prefer a clean label from id prefix: movies_10 → Movies
    const prefix = String(first.id || '').replace(/_\d+$/, '').replace(/_/g, ' ');
    if (prefix.startsWith('genre movies ')) return `Genre movies · ${prefix.slice('genre movies '.length)}`;
    if (prefix.startsWith('genre shows ')) return `Genre shows · ${prefix.slice('genre shows '.length)}`;
    if (prefix === 'genre explorer') return 'Genre explorer';
    return prefix.replace(/\b\w/g, (c) => c.toUpperCase()) || first.name || first.metric || 'Ladder';
};

export const groupBadgesIntoFamilies = (badges: BadgeLike[] = []): BadgeFamily[] => {
    const list = Array.isArray(badges) ? badges : [];
    const byMetric = new Map<string, BadgeLike[]>();
    const singles: BadgeLike[] = [];

    for (const badge of list) {
        const metric = String(badge?.metric || '').trim();
        if (!metric) {
            singles.push(badge);
            continue;
        }
        if (!byMetric.has(metric)) byMetric.set(metric, []);
        byMetric.get(metric)!.push(badge);
    }

    const families: BadgeFamily[] = [];

    for (const [metric, tiersRaw] of byMetric) {
        const tiers = [...tiersRaw].sort((a, b) => (Number(a.threshold) || 0) - (Number(b.threshold) || 0));
        if (tiers.length <= 1) {
            // Keep solitary metric badges as one-tier families for consistent rendering.
        }
        const earnedTiers = tiers.filter((t) => t.earned);
        const next = tiers.find((t) => !t.earned) || null;
        const focus = earnedTiers.length ? earnedTiers[earnedTiers.length - 1] : (next || tiers[0]);
        const liveProgress = Math.max(0, ...tiers.map((t) => {
            const n = Number(t.progress);
            return Number.isFinite(n) ? n : 0;
        }));
        const earnedFloor = earnedTiers.reduce((max, t) => Math.max(max, Number(t.threshold) || 0), 0);
        const currentValue = Math.max(liveProgress, earnedFloor);
        families.push({
            key: metric,
            metric,
            category: String(focus?.category || tiers[0]?.category || 'view'),
            icon: String(focus?.icon || tiers[0]?.icon || '🏅'),
            label: familyLabel(tiers),
            tiers,
            earnedCount: earnedTiers.length,
            totalCount: tiers.length,
            focus,
            next,
            currentValue,
        });
    }

    for (const badge of singles) {
        families.push({
            key: badge.id,
            metric: '',
            category: String(badge.category || 'special'),
            icon: String(badge.icon || '🏅'),
            label: String(badge.name || badge.id),
            tiers: [badge],
            earnedCount: badge.earned ? 1 : 0,
            totalCount: 1,
            focus: badge,
            next: badge.earned ? null : badge,
            currentValue: Math.max(
                Number(badge.progress) || 0,
                badge.earned ? Number(badge.threshold) || 0 : 0,
            ),
        });
    }

    return families.sort((a, b) => {
        // Incomplete ladders first, then by progress toward next, then name.
        const aDone = a.earnedCount >= a.totalCount ? 1 : 0;
        const bDone = b.earnedCount >= b.totalCount ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        const aPct = familyBarPercent(a);
        const bPct = familyBarPercent(b);
        if (aPct !== bPct) return bPct - aPct;
        return a.label.localeCompare(b.label);
    });
};

export const badgeBarPercent = (badge?: BadgeLike | null) => {
    if (!badge) return 0;
    if (badge.earned) return 100;
    const threshold = Number(badge.threshold) || 0;
    const progress = Number(badge.progress);
    const live = Number.isFinite(progress) ? Math.max(0, progress) : 0;
    if (threshold > 0) return Math.min(100, Math.max(0, (live / threshold) * 100));
    const pct = Number(badge.progressPct);
    return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
};

export const familyBarPercent = (family?: BadgeFamily | null) => {
    if (!family) return 0;
    if (!family.next || family.earnedCount >= family.totalCount) return 100;
    const threshold = Number(family.next.threshold) || 0;
    if (threshold <= 0) return 100;
    return Math.min(100, Math.max(0, (Number(family.currentValue) / threshold) * 100));
};
