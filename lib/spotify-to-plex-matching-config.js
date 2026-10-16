export const MATCH_FIELDS = ['artist', 'title', 'album'];
export const MATCH_OPS = ['off', 'match', 'contains', 'similarity'];

export const MATCH_FILTER_PRESETS = [
    {
        label: 'Exact artist and title',
        conditions: [{ field: 'artist', op: 'match' }, { field: 'title', op: 'match' }],
    },
    {
        label: 'Exact artist, title contains',
        conditions: [{ field: 'artist', op: 'match' }, { field: 'title', op: 'contains' }],
    },
    {
        label: 'Exact artist, title similar',
        conditions: [{ field: 'artist', op: 'match' }, { field: 'title', op: 'similarity', threshold: 0.8 }],
    },
    {
        label: 'Artist and title similar',
        conditions: [
            { field: 'artist', op: 'similarity', threshold: 0.85 },
            { field: 'title', op: 'similarity', threshold: 0.85 },
        ],
    },
    {
        label: 'Artist, title, and album contain',
        conditions: [
            { field: 'artist', op: 'contains' },
            { field: 'title', op: 'contains' },
            { field: 'album', op: 'contains' },
        ],
    },
];

export const TEXT_WORD_SUGGESTIONS = [
    'original mix',
    'radio edit',
    'single edit',
    'alternate mix',
    'remastered',
    'remaster',
    'single version',
    'retail mix',
    'quartet',
];

export const formatMatchThreshold = (value, fallback = 0.8) => {
    const numeric = Number(value);
    const n = Number.isFinite(numeric) ? numeric : fallback;
    const clamped = Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
    return String(Math.round(clamped * 100) / 100);
};

export const parseMatchCondition = (part) => {
    const text = String(part || '').trim();
    const similar = text.match(/^(artist|title|album)\s*:\s*similarity\s*(>=|>|=)\s*([0-9]*\.?[0-9]+)$/i);
    if (similar) {
        return {
            field: similar[1].toLowerCase(),
            op: 'similarity',
            threshold: Number(formatMatchThreshold(similar[3])),
        };
    }
    const exact = text.match(/^(artist|title|album)\s*:\s*(match|contains)$/i);
    if (exact) {
        return { field: exact[1].toLowerCase(), op: exact[2].toLowerCase() };
    }
    return null;
};

export const parseMatchFilter = (raw) => {
    const source = String(raw || '').trim();
    if (!source) return { parsed: true, raw: '', conditions: [] };
    if (/\bOR\b/i.test(source)) return { parsed: false, raw: source, conditions: [] };
    const parts = source.split(/\s+AND\s+/i).filter(Boolean);
    const conditions = [];
    for (const part of parts) {
        const condition = parseMatchCondition(part);
        if (!condition) return { parsed: false, raw: source, conditions: [] };
        conditions.push(condition);
    }
    return { parsed: true, raw: source, conditions };
};

export const serializeMatchFilter = (rule) => {
    if (rule && rule.parsed === false) return String(rule.raw || '');
    const conditions = Array.isArray(rule?.conditions) ? rule.conditions : [];
    return conditions
        .filter((item) => item && item.field && item.op && item.op !== 'off')
        .map((item) => {
            if (item.op === 'similarity') {
                return `${item.field}:similarity>=${formatMatchThreshold(item.threshold)}`;
            }
            return `${item.field}:${item.op}`;
        })
        .join(' AND ');
};

export const conditionsToFieldState = (conditions = []) => {
    const map = {
        artist: { op: 'off', threshold: 0.8 },
        title: { op: 'off', threshold: 0.8 },
        album: { op: 'off', threshold: 0.8 },
    };
    for (const item of conditions) {
        if (!item?.field || !map[item.field]) continue;
        map[item.field] = {
            op: item.op === 'similarity' || item.op === 'match' || item.op === 'contains' ? item.op : 'off',
            threshold: Number(formatMatchThreshold(item.threshold)),
        };
    }
    return map;
};

export const fieldStateToConditions = (map = {}) => MATCH_FIELDS
    .filter((field) => map[field]?.op && map[field].op !== 'off')
    .map((field) => (
        map[field].op === 'similarity'
            ? { field, op: 'similarity', threshold: Number(formatMatchThreshold(map[field].threshold)) }
            : { field, op: map[field].op }
    ));

export const unwrapConfigPayload = (data) => {
    if (Array.isArray(data) || (data && typeof data === 'object' && !Array.isArray(data) && data.filterOutWords)) {
        return data;
    }
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.value)) return data.value;
    if (data && typeof data === 'object' && data.config && typeof data.config === 'object') return data.config;
    return data;
};

export const normalizeMatchFilters = (raw) => {
    const list = unwrapConfigPayload(raw);
    if (!Array.isArray(list)) return [];
    return list.map((item) => {
        if (typeof item === 'string') return parseMatchFilter(item);
        if (item && typeof item.filter === 'string') return parseMatchFilter(item.filter);
        return { parsed: false, raw: JSON.stringify(item), conditions: [] };
    });
};

export const serializeMatchFilters = (rules = []) => rules
    .map((rule) => serializeMatchFilter(rule))
    .filter(Boolean);

export const normalizeSearchApproaches = (raw) => {
    const list = unwrapConfigPayload(raw);
    if (!Array.isArray(list)) return [];
    return list.map((item, index) => {
        const record = item && typeof item === 'object' ? item : {};
        const extra = { ...record };
        delete extra.id;
        delete extra.filtered;
        delete extra.trim;
        delete extra.trimmed;
        return {
            id: String(record.id || `approach-${index + 1}`),
            filtered: !!record.filtered,
            trim: !!(record.trim ?? record.trimmed),
            trimKey: record.trimmed != null && record.trim == null ? 'trimmed' : 'trim',
            extra,
        };
    });
};

export const serializeSearchApproaches = (approaches = []) => approaches.map((item, index) => ({
    id: String(item.id || `approach-${index + 1}`).trim() || `approach-${index + 1}`,
    filtered: !!item.filtered,
    [item.trimKey || 'trim']: !!item.trim,
    ...(item.extra && typeof item.extra === 'object' ? item.extra : {}),
}));

const asStringList = (value) => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
};

export const normalizeTextProcessing = (raw) => {
    const record = unwrapConfigPayload(raw);
    const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
    const extra = { ...source };
    delete extra.filterOutWords;
    delete extra.filterOutQuotes;
    delete extra.cutOffSeparators;
    return {
        filterOutWords: asStringList(source.filterOutWords),
        filterOutQuotes: source.filterOutQuotes == null ? null : !!source.filterOutQuotes,
        cutOffSeparators: source.cutOffSeparators == null ? null : asStringList(source.cutOffSeparators),
        extra,
    };
};

export const serializeTextProcessing = (text = {}) => {
    const next = {
        ...(text.extra && typeof text.extra === 'object' ? text.extra : {}),
        filterOutWords: asStringList(text.filterOutWords),
    };
    if (text.filterOutQuotes != null) next.filterOutQuotes = !!text.filterOutQuotes;
    if (text.cutOffSeparators != null) next.cutOffSeparators = asStringList(text.cutOffSeparators);
    return next;
};

export const moveListItem = (list, index, delta) => {
    const next = Array.isArray(list) ? [...list] : [];
    const to = index + delta;
    if (to < 0 || to >= next.length) return next;
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    return next;
};

export const describeMatchRule = (rule) => {
    if (!rule?.parsed) return 'Custom rule';
    const labels = {
        artist: 'Artist',
        title: 'Title',
        album: 'Album',
        match: 'exact',
        contains: 'contains',
    };
    const parts = (rule.conditions || []).map((item) => {
        if (item.op === 'similarity') {
            return `${labels[item.field] || item.field} similar (${Math.round(Number(formatMatchThreshold(item.threshold)) * 100)}%)`;
        }
        return `${labels[item.field] || item.field} ${labels[item.op] || item.op}`;
    });
    return parts.join(' · ') || 'Empty rule';
};
