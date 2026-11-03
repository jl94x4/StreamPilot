/**
 * Plex share permissions beyond libraries: downloads (allowSync), camera upload, channels, and
 * content restrictions per media type (Plex "filterMovies" / "filterTelevision" / "filterMusic").
 *
 * Plex's wire format (matches python-plexapi): a filter is `key=v1%2Cv2|key2=v3`, where key is
 * contentRating or label, and a trailing "!" (contentRating!=…) means "block these" instead of
 * "only allow these". Updates are a PUT to plex.tv/api/v2/sharings/{plexUserId} with these as
 * query values; invites carry them as `sharing_settings`.
 */

const asList = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
    .map((row) => String(row || '').trim())
    .filter(Boolean);

const unique = (list) => [...new Set(list)];

const normalizeRule = (rule, { ratings = true } = {}) => {
    const out = {
        labels: unique(asList(rule?.labels)),
        labelMode: rule?.labelMode === 'block' ? 'block' : 'allow',
    };
    if (ratings) {
        out.ratings = unique(asList(rule?.ratings));
        out.ratingMode = rule?.ratingMode === 'block' ? 'block' : 'allow';
    }
    return out;
};

/** The portal's shape for one user's (or the invite defaults') permissions. */
export const normalizeSharePermissions = (input = {}) => ({
    allowSync: input?.allowSync === true,
    allowCameraUpload: input?.allowCameraUpload === true,
    allowChannels: input?.allowChannels === true,
    movies: normalizeRule(input?.movies),
    television: normalizeRule(input?.television),
    music: normalizeRule(input?.music, { ratings: false }),
});

/** { ratings, ratingMode, labels, labelMode } → "contentRating=G%2CPG|label!=Horror". */
export const filterToString = (rule) => {
    const parts = [];
    if (rule?.ratings?.length) {
        parts.push(`contentRating${rule.ratingMode === 'block' ? '!' : ''}=${rule.ratings.join('%2C')}`);
    }
    if (rule?.labels?.length) {
        parts.push(`label${rule.labelMode === 'block' ? '!' : ''}=${rule.labels.join('%2C')}`);
    }
    return parts.join('|');
};

/** Plex's stored filter string back into the portal's shape. Accepts encoded or plain commas. */
export const parseFilterString = (raw, { ratings = true } = {}) => {
    const rule = ratings
        ? { ratings: [], ratingMode: 'allow', labels: [], labelMode: 'allow' }
        : { labels: [], labelMode: 'allow' };
    let text = String(raw || '').trim();
    try {
        text = decodeURIComponent(text);
    } catch {
        /* keep as is */
    }
    for (const part of text.split('|')) {
        const match = part.match(/^\s*(contentRating|label)(!?)=(.*)$/);
        if (!match) continue;
        const values = unique(asList(match[3]));
        const block = match[2] === '!';
        if (match[1] === 'contentRating' && ratings) {
            rule.ratings = values;
            rule.ratingMode = block ? 'block' : 'allow';
        } else if (match[1] === 'label') {
            rule.labels = values;
            rule.labelMode = block ? 'block' : 'allow';
        }
    }
    return rule;
};

/** Attributes from plex.tv /api/users <User …> → permissions. */
export const permissionsFromUserAttrs = (attrs = {}) => normalizeSharePermissions({
    allowSync: String(attrs.allowSync) === '1',
    allowCameraUpload: String(attrs.allowCameraUpload) === '1',
    allowChannels: String(attrs.allowChannels) === '1',
    movies: parseFilterString(attrs.filterMovies),
    television: parseFilterString(attrs.filterTelevision),
    music: parseFilterString(attrs.filterMusic, { ratings: false }),
});

/** Read one opening XML tag's attributes (plex.tv /api/users is XML). */
export const parseXmlAttrs = (openTag) => {
    const attrs = {};
    const re = /([A-Za-z_][\w.-]*)="([^"]*)"/g;
    let match;
    while ((match = re.exec(String(openTag || '')))) {
        attrs[match[1]] = match[2]
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    }
    return attrs;
};

/** The sharing_settings object an invite carries. */
export const sharingSettingsBody = (input) => {
    const perms = normalizeSharePermissions(input);
    return {
        allowSync: perms.allowSync ? '1' : '0',
        allowCameraUpload: perms.allowCameraUpload ? '1' : '0',
        allowChannels: perms.allowChannels ? '1' : '0',
        filterMovies: filterToString(perms.movies),
        filterTelevision: filterToString(perms.television),
        filterMusic: filterToString(perms.music),
    };
};

/** Query string for PUT plex.tv/api/v2/sharings/{plexUserId}: every value URL-encoded. */
export const sharingUpdateQuery = (input) => {
    const body = sharingSettingsBody(input);
    return Object.keys(body)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map((key) => `${key}=${encodeURIComponent(body[key])}`)
        .join('&');
};
