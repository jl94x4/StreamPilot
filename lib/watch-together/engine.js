/**
 * StreamPilot Watch Together — room engine (play/pause/seek sync).
 * Sync-only: each client plays their own library copy matched by guid/tmdb.
 * No host-library byte proxy.
 *
 * No Node-only imports, so the same code runs in the relay (Node, ./index.js) and inside the
 * Android app, where the person hosting runs the room on their own device. The transport is any
 * object with { readyState, send(string), close() }; the caller does the authentication.
 */

const MAX_PARTICIPANTS = 8;
const EMPTY_ROOM_GRACE_MS = 5 * 60 * 1000;
const DRIFT_MS = 3000;
/** Min gap between corrective seek nudges per client (avoids PMS session storms). */
const CORRECTIVE_COOLDOWN_MS = 5000;
/** Min gap between buffering pause/resume cycles per room. */
const BUFFER_CYCLE_COOLDOWN_MS = 2500;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** @type {Map<string, Room>} */
const roomsById = new Map();
/** @type {Map<string, string>} inviteCode → roomId */
const roomIdByCode = new Map();
/** @type {Map<import('ws').WebSocket, Participant>} */
const participantBySocket = new Map();

/**
 * @typedef {{
 *   id: string,
 *   displayName: string,
 *   thumb?: string | null,
 *   auth: 'portal' | 'plex',
 * }} WtUser
 */

/**
 * @typedef {{
 *   socket: import('ws').WebSocket,
 *   user: WtUser,
 *   clientId: string,
 *   roomId: string | null,
 *   joinedAt: number,
 *   lastReportMs: number,
 *   buffering: boolean,
 *   seekReadyFor: string | null,
 *   lastCorrectiveAt: number,
 * }} Participant
 */

/**
 * @typedef {{
 *   id: string,
 *   inviteCode: string,
 *   hostUserId: string,
 *   ratingKey: string,
 *   serverId: string,
 *   title: string,
 *   type: string,
 *   thumb?: string | null,
 *   guids: string[],
 *   tmdbId: number | null,
 *   year: number | null,
 *   playing: boolean,
 *   positionMs: number,
 *   clockAt: number,
 *   seekId: string | null,
 *   waitingForSeekReady: boolean,
 *   seekResumePlaying: boolean,
 *   pausedForBuffer: boolean,
 *   lastBufferCycleAt: number,
 *   participants: Map<string, Participant>,
 *   emptySince: number | null,
 * }} Room
 */

const normalizeGuidList = (value) => {
    const raw = Array.isArray(value) ? value : [];
    const out = [];
    for (const row of raw) {
        const guid = String(row || '').trim();
        if (guid && !out.includes(guid)) out.push(guid);
    }
    return out.slice(0, 12);
};

const nowMs = () => Date.now();

const makeInviteCode = (length = 6) => {
    const size = Math.max(6, Math.min(10, Math.floor(Number(length) || 6)));
    for (let attempt = 0; attempt < 40; attempt += 1) {
        let code = '';
        const bytes = randomBytes(size);
        for (let i = 0; i < size; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
        if (!roomIdByCode.has(code)) return code;
    }
    return randomUUID().replace(/-/g, '').slice(0, size).toUpperCase();
};

const send = (socket, payload) => {
    if (!socket || socket.readyState !== 1) return;
    try {
        socket.send(JSON.stringify(payload));
    } catch {
        /* ignore */
    }
};

const broadcast = (room, payload, exceptSocket = null) => {
    for (const participant of room.participants.values()) {
        if (exceptSocket && participant.socket === exceptSocket) continue;
        send(participant.socket, payload);
    }
};

const authoritativePositionMs = (room) => {
    if (!room.playing || room.waitingForSeekReady) return Math.max(0, room.positionMs);
    const elapsed = Math.max(0, nowMs() - room.clockAt);
    return Math.max(0, room.positionMs + elapsed);
};

const roomStatePayload = (room) => ({
    type: 'wt_state',
    roomId: room.id,
    inviteCode: room.inviteCode,
    hostUserId: room.hostUserId,
    ratingKey: room.ratingKey,
    serverId: room.serverId,
    title: room.title,
    mediaType: room.type,
    thumb: room.thumb || null,
    guids: Array.isArray(room.guids) ? room.guids : [],
    tmdbId: room.tmdbId != null ? room.tmdbId : null,
    year: room.year != null ? room.year : null,
    playing: room.waitingForSeekReady ? false : room.playing,
    positionMs: authoritativePositionMs(room),
    seekId: room.seekId,
    waitingForSeekReady: room.waitingForSeekReady,
    participants: [...room.participants.values()].map((row) => ({
        userId: row.user.id,
        displayName: row.user.displayName,
        thumb: row.user.thumb || null,
        clientId: row.clientId,
        buffering: row.buffering,
    })),
});

const destroyRoom = (room) => {
    roomIdByCode.delete(room.inviteCode);
    roomsById.delete(room.id);
    for (const participant of room.participants.values()) {
        participant.roomId = null;
        send(participant.socket, { type: 'wt_ended', roomId: room.id });
    }
    room.participants.clear();
};

const leaveRoom = (participant, { silent = false } = {}) => {
    const roomId = participant.roomId;
    if (!roomId) return;
    const room = roomsById.get(roomId);
    participant.roomId = null;
    participant.seekReadyFor = null;
    participant.buffering = false;
    if (!room) return;
    room.participants.delete(participant.clientId);
    if (!silent) {
        broadcast(room, {
            type: 'wt_left',
            roomId: room.id,
            userId: participant.user.id,
            clientId: participant.clientId,
        });
    }
    if (room.participants.size === 0) {
        room.emptySince = nowMs();
        return;
    }
    room.emptySince = null;
    if (room.hostUserId === participant.user.id) {
        const nextHost = [...room.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (nextHost) room.hostUserId = nextHost.user.id;
    }
    if (room.waitingForSeekReady) {
        maybeCompleteSeekBarrier(room);
    }
    broadcast(room, roomStatePayload(room));
};

const maybeCompleteSeekBarrier = (room) => {
    if (!room.waitingForSeekReady || !room.seekId) return;
    const pending = [...room.participants.values()].filter((row) => row.seekReadyFor !== room.seekId);
    if (pending.length) return;
    room.waitingForSeekReady = false;
    room.seekId = null;
    room.playing = room.seekResumePlaying;
    room.clockAt = nowMs();
    for (const row of room.participants.values()) row.seekReadyFor = null;
    broadcast(room, roomStatePayload(room));
};

const findRoomByCode = (code) => {
    const normalized = String(code || '').trim().toUpperCase();
    const roomId = roomIdByCode.get(normalized);
    return roomId ? roomsById.get(roomId) || null : null;
};


/**
 * Random source. The relay passes node:crypto in; in the browser / WebView the Web Crypto
 * global is used.
 */
let randomImpl = {
    bytes: (count) => {
        const out = new Uint8Array(count);
        globalThis.crypto.getRandomValues(out);
        return out;
    },
    uuid: () => globalThis.crypto.randomUUID(),
};

export const configureWatchTogetherEngine = ({ randomBytes: bytes, randomUUID: uuid } = {}) => {
    randomImpl = {
        bytes: typeof bytes === 'function' ? (count) => bytes(count) : randomImpl.bytes,
        uuid: typeof uuid === 'function' ? () => uuid() : randomImpl.uuid,
    };
};

const randomBytes = (count) => randomImpl.bytes(count);
const randomUUID = () => randomImpl.uuid();

const handleCreate = (participant, message) => {
    if (participant.roomId) leaveRoom(participant, { silent: true });
    const ratingKey = String(message?.ratingKey || '').trim();
    const serverId = String(message?.serverId || '').trim();
    const title = String(message?.title || 'Watch Together').trim() || 'Watch Together';
    const type = String(message?.mediaType || 'movie').trim() || 'movie';
    const guids = normalizeGuidList(message?.guids);
    const tmdbRaw = Number(message?.tmdbId);
    const tmdbId = Number.isFinite(tmdbRaw) && tmdbRaw > 0 ? Math.floor(tmdbRaw) : null;
    const yearRaw = Number(message?.year);
    const year = Number.isFinite(yearRaw) && yearRaw > 0 ? Math.floor(yearRaw) : null;
    if (!ratingKey) {
        send(participant.socket, { type: 'wt_error', code: 'invalid_media', message: 'Missing title.' });
        return;
    }
    const inviteCode = makeInviteCode(message?.codeLength);
    const roomId = randomUUID();
    /** @type {Room} */
    const room = {
        id: roomId,
        inviteCode,
        hostUserId: participant.user.id,
        ratingKey,
        serverId,
        title,
        type,
        thumb: message?.thumb || null,
        guids,
        tmdbId,
        year,
        playing: false,
        positionMs: Math.max(0, Number(message?.positionMs) || 0),
        clockAt: nowMs(),
        seekId: null,
        waitingForSeekReady: false,
        seekResumePlaying: false,
        pausedForBuffer: false,
        lastBufferCycleAt: 0,
        participants: new Map(),
        emptySince: null,
    };
    roomsById.set(roomId, room);
    roomIdByCode.set(inviteCode, roomId);
    participant.roomId = roomId;
    participant.joinedAt = nowMs();
    room.participants.set(participant.clientId, participant);
    send(participant.socket, {
        type: 'wt_created',
        roomId,
        inviteCode,
        hostUserId: room.hostUserId,
        ...roomStatePayload(room),
    });
};

const handleJoin = (participant, message) => {
    if (participant.roomId) leaveRoom(participant, { silent: true });
    const code = String(message?.inviteCode || message?.roomId || '').trim();
    const room = findRoomByCode(code) || roomsById.get(code) || null;
    if (!room) {
        send(participant.socket, { type: 'wt_error', code: 'room_not_found', message: 'Room not found.' });
        return;
    }
    if (room.participants.size >= MAX_PARTICIPANTS) {
        send(participant.socket, { type: 'wt_error', code: 'room_full', message: 'This room is full.' });
        return;
    }
    for (const existing of room.participants.values()) {
        if (existing.user.id === participant.user.id && existing.clientId !== participant.clientId) {
            leaveRoom(existing, { silent: true });
            try { existing.socket.close(); } catch { /* ignore */ }
        }
    }
    participant.roomId = room.id;
    participant.joinedAt = nowMs();
    room.emptySince = null;
    room.participants.set(participant.clientId, participant);
    broadcast(room, {
        type: 'wt_joined',
        roomId: room.id,
        userId: participant.user.id,
        displayName: participant.user.displayName,
        thumb: participant.user.thumb || null,
        clientId: participant.clientId,
    }, participant.socket);
    send(participant.socket, roomStatePayload(room));
    for (const other of room.participants.values()) {
        if (other.clientId === participant.clientId) continue;
        send(participant.socket, {
            type: 'wt_joined',
            roomId: room.id,
            userId: other.user.id,
            displayName: other.user.displayName,
            thumb: other.user.thumb || null,
            clientId: other.clientId,
        });
    }
};

const requireRoom = (participant) => {
    if (!participant.roomId) {
        send(participant.socket, { type: 'wt_error', code: 'not_participant', message: 'Not in a room.' });
        return null;
    }
    const room = roomsById.get(participant.roomId);
    if (!room || !room.participants.has(participant.clientId)) {
        send(participant.socket, { type: 'wt_error', code: 'not_participant', message: 'Not in a room.' });
        return null;
    }
    return room;
};

const applyTransport = (participant, message, playing) => {
    const room = requireRoom(participant);
    if (!room) return;
    if (room.waitingForSeekReady) {
        room.seekResumePlaying = playing;
        return;
    }
    room.positionMs = authoritativePositionMs(room);
    if (message?.positionMs != null && Number.isFinite(Number(message.positionMs))) {
        room.positionMs = Math.max(0, Number(message.positionMs));
    }
    room.playing = playing;
    room.pausedForBuffer = false;
    room.clockAt = nowMs();
    broadcast(room, {
        ...roomStatePayload(room),
        originClientId: participant.clientId,
    });
};

const handleSeek = (participant, message) => {
    const room = requireRoom(participant);
    if (!room) return;
    const positionMs = Math.max(0, Number(message?.positionMs) || 0);
    const seekId = randomUUID();
    room.positionMs = positionMs;
    room.clockAt = nowMs();
    room.seekId = seekId;
    room.waitingForSeekReady = true;
    room.seekResumePlaying = message?.playing != null ? !!message.playing : room.playing;
    room.playing = false;
    for (const row of room.participants.values()) row.seekReadyFor = null;
    // Seeker is already at the target — count them ready so solo rooms unlock.
    participant.seekReadyFor = seekId;
    broadcast(room, {
        ...roomStatePayload(room),
        originClientId: participant.clientId,
    });
    maybeCompleteSeekBarrier(room);
};

const handleSeekReady = (participant, message) => {
    const room = requireRoom(participant);
    if (!room) return;
    const seekId = String(message?.seekId || '').trim();
    if (!room.waitingForSeekReady || !seekId || seekId !== room.seekId) return;
    participant.seekReadyFor = seekId;
    maybeCompleteSeekBarrier(room);
};

const handleReport = (participant, message) => {
    const room = requireRoom(participant);
    if (!room) return;
    const positionMs = Math.max(0, Number(message?.positionMs) || 0);
    const buffering = !!message?.buffering;
    participant.lastReportMs = positionMs;
    const wasBuffering = participant.buffering;
    participant.buffering = buffering;

    // Solo host: keep position warm for late joiners, but never pause/seek the
    // only viewer off their own buffering pulse (that forced BAD_HTTP / PMS storms).
    if (room.participants.size <= 1) {
        if (room.playing && !room.waitingForSeekReady && Number.isFinite(positionMs)) {
            room.positionMs = positionMs;
            room.clockAt = nowMs();
        }
        return;
    }

    if (buffering && !wasBuffering && !room.waitingForSeekReady) {
        // Prefer the reporter's real offset — clock math is wrong if the room
        // never received wt_play (stale 0 → seek storm → PMS session spam).
        if (positionMs > 0) room.positionMs = positionMs;
        else room.positionMs = authoritativePositionMs(room);
        room.clockAt = nowMs();
        broadcast(room, { type: 'wt_buffering', roomId: room.id, userId: participant.user.id, clientId: participant.clientId });
        // Only pause the room if it was actually playing, and rate-limit cycles.
        if (!room.playing) return;
        const now = nowMs();
        if (now - (room.lastBufferCycleAt || 0) < BUFFER_CYCLE_COOLDOWN_MS) return;
        room.lastBufferCycleAt = now;
        room.pausedForBuffer = true;
        room.playing = false;
        broadcast(room, {
            ...roomStatePayload(room),
            originClientId: participant.clientId,
        });
        return;
    }
    if (!buffering && wasBuffering && !room.waitingForSeekReady) {
        const anyoneBuffering = [...room.participants.values()].some((row) => row.buffering);
        if (!anyoneBuffering && room.pausedForBuffer) {
            room.pausedForBuffer = false;
            room.playing = true;
            room.clockAt = nowMs();
            broadcast(room, { type: 'wt_resumed', roomId: room.id });
            broadcast(room, {
                ...roomStatePayload(room),
                originClientId: participant.clientId,
            });
        }
        return;
    }

    if (room.waitingForSeekReady || !room.playing) return;
    const expected = authoritativePositionMs(room);
    if (Math.abs(positionMs - expected) >= DRIFT_MS) {
        const now = nowMs();
        if (now - (participant.lastCorrectiveAt || 0) < CORRECTIVE_COOLDOWN_MS) return;
        participant.lastCorrectiveAt = now;
        send(participant.socket, {
            ...roomStatePayload(room),
            corrective: true,
            originClientId: 'server',
        });
    }
};

const onMessage = (participant, raw) => {
    let message;
    try {
        message = JSON.parse(String(raw || ''));
    } catch {
        return;
    }
    const type = String(message?.type || '');
    switch (type) {
        case 'wt_create':
            handleCreate(participant, message);
            break;
        case 'wt_join':
            handleJoin(participant, message);
            break;
        case 'wt_play':
            applyTransport(participant, message, true);
            break;
        case 'wt_pause':
            applyTransport(participant, message, false);
            break;
        case 'wt_seek':
            handleSeek(participant, message);
            break;
        case 'wt_seek_ready':
            handleSeekReady(participant, message);
            break;
        case 'wt_report':
            handleReport(participant, message);
            break;
        case 'wt_leave':
            leaveRoom(participant);
            break;
        default:
            break;
    }
};

export const getWatchTogetherRoomSummary = (code) => {
    const room = findRoomByCode(code);
    if (!room) return null;
    return {
        inviteCode: room.inviteCode,
        title: room.title,
        mediaType: room.type,
        thumb: room.thumb || null,
        ratingKey: room.ratingKey,
        serverId: room.serverId,
        guids: Array.isArray(room.guids) ? room.guids : [],
        tmdbId: room.tmdbId != null ? room.tmdbId : null,
        year: room.year != null ? room.year : null,
        hostUserId: room.hostUserId,
        participantCount: room.participants.size,
        playing: room.playing,
    };
};

const participantMatchesUserIds = (participant, userIds) => {
    const id = String(participant?.user?.id || '').trim();
    if (!id || !userIds?.length) return false;
    return userIds.some((row) => String(row || '').trim() === id);
};

/**
 * Host-stream proxy disabled (sync-only Watch Together).
 * Kept as a no-op so older media-player call sites stay safe.
 *
 * @returns {null}
 */
export const resolveWatchTogetherHostStream = () => null;

/**
 * Register a new connection. The caller has already authenticated it and supplies the user.
 * @param {{ readyState: number, send: (data: string) => void, close: () => void }} socket
 * @param {WtUser} user
 */
export const attachParticipant = (socket, user) => {
    /** @type {Participant} */
    const participant = {
        socket,
        user,
        clientId: randomUUID(),
        roomId: null,
        joinedAt: nowMs(),
        lastReportMs: 0,
        buffering: false,
        seekReadyFor: null,
        lastCorrectiveAt: 0,
    };
    participantBySocket.set(socket, participant);
    send(socket, {
        type: 'wt_hello',
        clientId: participant.clientId,
        userId: user.id,
        displayName: user.displayName,
    });
    return participant;
};

export const handleParticipantMessage = (participant, raw) => onMessage(participant, raw);

export const detachParticipant = (participant) => {
    leaveRoom(participant);
    participantBySocket.delete(participant.socket);
};

/** Drop rooms that have been empty past the grace period. Call every ~30s. */
export const reapEmptyRooms = () => {
    const cutoff = nowMs() - EMPTY_ROOM_GRACE_MS;
    for (const room of [...roomsById.values()]) {
        if (room.participants.size === 0 && room.emptySince && room.emptySince < cutoff) {
            destroyRoom(room);
        }
    }
};

/** Whether a room with this code exists (used to vet direct connections). */
export const watchTogetherRoomExists = (code) => !!findRoomByCode(code);
