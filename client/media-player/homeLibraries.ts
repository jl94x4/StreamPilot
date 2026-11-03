/**
 * Home libraries (hearts): Home is always what is pinned on the Plex server; a library
 * marked false just has its pinned rows (collections, Recently Added) left out of
 * StreamPilot. Keys are `serverId::sectionId`; missing or true means shown.
 */
export type HomeLibraryPicks = Record<string, boolean>;

export const homeLibraryKey = (serverId?: string | null, sectionKey?: string | number | null) => {
    const server = String(serverId || '').trim();
    const section = (String(sectionKey ?? '').split('::').pop() || '').replace(/\D/g, '');
    return server && section ? `${server}::${section}` : '';
};

export const normalizeHomeLibraryPicks = (raw: unknown): HomeLibraryPicks => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: HomeLibraryPicks = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 400)) {
        if (/^[^:\s]+::\d+$/.test(key) && typeof value === 'boolean') out[key] = value;
    }
    return out;
};

export const homeLibraryPicksEqual = (a: HomeLibraryPicks, b: HomeLibraryPicks) => {
    const ak = Object.keys(a);
    if (ak.length !== Object.keys(b).length) return false;
    return ak.every((key) => b[key] === a[key]);
};

export const homeLibraryShown = (picks: HomeLibraryPicks, serverId?: string | null, sectionKey?: string | number | null) => {
    const key = homeLibraryKey(serverId, sectionKey);
    return !key || picks[key] !== false;
};

type HubLike = {
    identifier?: string | null;
    title?: string | null;
    hubKey?: string | null;
    serverId?: string | null;
    items?: Array<{ librarySectionID?: string | number | null; serverId?: string | null }> | null;
};

const sectionFromPath = (text: string) => (
    text.match(/\/library\/sections\/(\d+)\//i)?.[1]
    || text.match(/\/hubs\/sections\/(\d+)/i)?.[1]
    || text.match(/[?&](?:sectionID|sectionId)=(\d+)/i)?.[1]
    || text.match(/recentlyadded\.(\d+)/i)?.[1]
    || ''
);

/** The library a Home row belongs to: its list path, else most of its items. '' when mixed/unknown. */
export const hubLibrarySection = (hub: HubLike): string => {
    const fromPath = sectionFromPath(`${hub.hubKey || ''} ${hub.identifier || ''}`);
    if (fromPath) return fromPath;
    const counts = new Map<string, number>();
    for (const item of hub.items || []) {
        const id = String(item?.librarySectionID ?? '').replace(/\D/g, '');
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    let best = '';
    let most = 0;
    for (const [id, count] of counts) {
        if (count > most) {
            best = id;
            most = count;
        }
    }
    // Only claim a library when it clearly owns the row (mixed rows stay).
    const total = (hub.items || []).length;
    return best && most * 2 > total ? best : '';
};

const isAlwaysKept = (hub: HubLike) => (
    /continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress|because|playlist/i
        .test(`${hub.identifier || ''} ${hub.title || ''}`)
);

/** True when the user un-hearted the library this row comes from. */
export const homeHubHiddenByPicks = (hub: HubLike, picks: HomeLibraryPicks) => {
    if (!picks || !Object.keys(picks).length || isAlwaysKept(hub)) return false;
    const section = hubLibrarySection(hub);
    if (!section) return false;
    const serverId = hub.serverId || hub.items?.[0]?.serverId || '';
    return !homeLibraryShown(picks, serverId, section);
};
