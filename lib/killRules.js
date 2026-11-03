/**
 * Stream rules (Settings → Stream rules): which live Plex streams to stop. A rule's conditions
 * test one stream, but some read across all of that user's streams, worked out once per check
 * by annotateKillRuleSessions: how many streams the user has, from how many places, how long
 * this one has been paused, and the server's local hour.
 */

export const VALID_KILL_RULE_FIELDS = new Set([
    'isTranscoding', 'videoResolution', 'user', 'bandwidth', 'playerProduct', 'state', 'mediaType',
    'sessionLocation', 'playerTitle', 'videoCodec', 'audioCodec', 'transcodeVideoDecision',
    'userStreamCount', 'userLocationCount', 'pausedMinutes', 'hourOfDay',
]);
export const VALID_KILL_RULE_OPERATORS = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than']);

const NUMERIC_FIELDS = new Set(['bandwidth', 'userStreamCount', 'userLocationCount', 'pausedMinutes', 'hourOfDay']);

const userKeyOf = (session) => String(session.userId || session.user || '').trim().toLowerCase();

/**
 * Where a stream is watched from. Every device at home is one place (each has its own LAN IP);
 * remote streams are told apart by their public address.
 */
const placeOf = (session) => {
    if (String(session.sessionLocation || '').toLowerCase() === 'lan') return 'lan';
    return String(session.address || '').trim() || 'remote';
};

/**
 * Adds userStreamCount, userLocationCount, pausedMinutes and hourOfDay to each session.
 * pausedSince (sessionId → first seen paused) persists between checks; finished or resumed
 * streams are dropped from it.
 */
export const annotateKillRuleSessions = (sessions, { now = Date.now(), pausedSince = new Map(), hourOfDay } = {}) => {
    const list = Array.isArray(sessions) ? sessions : [];
    const byUser = new Map();
    for (const session of list) {
        const key = userKeyOf(session);
        if (!byUser.has(key)) byUser.set(key, []);
        byUser.get(key).push(session);
    }
    const live = new Set(list.map((session) => session.sessionId).filter(Boolean));
    for (const id of [...pausedSince.keys()]) {
        if (!live.has(id)) pausedSince.delete(id);
    }
    const hour = Number.isFinite(hourOfDay) ? hourOfDay : new Date(now).getHours();
    return list.map((session) => {
        const peers = byUser.get(userKeyOf(session)) || [session];
        let pausedMinutes = 0;
        if (String(session.state || '').toLowerCase() === 'paused' && session.sessionId) {
            if (!pausedSince.has(session.sessionId)) pausedSince.set(session.sessionId, now);
            pausedMinutes = Math.floor((now - pausedSince.get(session.sessionId)) / 60_000);
        } else if (session.sessionId) {
            pausedSince.delete(session.sessionId);
        }
        return {
            ...session,
            userStreamCount: peers.length,
            userLocationCount: new Set(peers.map(placeOf)).size,
            pausedMinutes,
            hourOfDay: hour,
        };
    });
};

/**
 * After stopping streams, recount each user's remaining ones. Without this a "more than 2
 * streams" rule matched every one of that user's streams and stopped them all, not just the
 * ones over the limit.
 */
export const recountAfterStopped = (sessions, stoppedIds) => {
    const remaining = sessions.filter((session) => !stoppedIds.has(session.sessionId));
    const byUser = new Map();
    for (const session of remaining) {
        const key = userKeyOf(session);
        if (!byUser.has(key)) byUser.set(key, []);
        byUser.get(key).push(session);
    }
    for (const session of remaining) {
        const peers = byUser.get(userKeyOf(session)) || [session];
        session.userStreamCount = peers.length;
        session.userLocationCount = new Set(peers.map(placeOf)).size;
    }
};

export const sessionMatchesCondition = (session, condition) => {
    const { field, operator, value } = condition || {};
    let sessionVal;
    switch (field) {
        case 'isTranscoding': sessionVal = session.isTranscoding ? 'true' : 'false'; break;
        case 'videoResolution': sessionVal = (session.resolution || '').toString().toLowerCase(); break;
        case 'user': sessionVal = (session.user || '').toLowerCase(); break;
        case 'bandwidth': sessionVal = Math.round((session.bandwidth || 0) / 1000); break; // in Mbps
        case 'playerProduct': sessionVal = (session.playerProduct || '').toLowerCase(); break;
        case 'state': sessionVal = (session.state || '').toLowerCase(); break;
        case 'mediaType': sessionVal = (session.type || '').toLowerCase(); break;
        case 'sessionLocation': sessionVal = (session.sessionLocation || '').toLowerCase(); break;
        case 'playerTitle': sessionVal = (session.playerTitle || '').toLowerCase(); break;
        case 'videoCodec': sessionVal = (session.videoCodec || '').toLowerCase(); break;
        case 'audioCodec': sessionVal = (session.audioCodec || '').toLowerCase(); break;
        case 'transcodeVideoDecision': sessionVal = (session.transcodeVideoDecision || '').toLowerCase(); break;
        case 'userStreamCount':
        case 'userLocationCount':
        case 'pausedMinutes':
        case 'hourOfDay':
            sessionVal = Number(session[field]) || 0;
            break;
        default: return false;
    }
    const compareVal = NUMERIC_FIELDS.has(field) ? parseFloat(value) : (value || '').toString().toLowerCase();
    switch (operator) {
        case 'equals': return String(sessionVal) === String(compareVal);
        case 'not_equals': return String(sessionVal) !== String(compareVal);
        case 'contains': return String(sessionVal).includes(String(compareVal));
        case 'not_contains': return !String(sessionVal).includes(String(compareVal));
        case 'greater_than': return parseFloat(sessionVal) > parseFloat(compareVal);
        case 'less_than': return parseFloat(sessionVal) < parseFloat(compareVal);
        default: return false;
    }
};
