/**
 * StreamPilot Watch Together — WebSocket sync relay.
 * Playback uses the host title on the portal PMS (joiners do not need their own copy).
 * Byte streams may use a WT-gated owner token; sync is still play/pause/seek only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { readBearerToken } from '../session-token.js';

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

const nowMs = () => Date.now();

const makeInviteCode = () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        let code = '';
        const bytes = randomBytes(6);
        for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
        if (!roomIdByCode.has(code)) return code;
    }
    return randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
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

const parseCookies = (header) => {
    const out = {};
    String(header || '').split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx < 0) return;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(value);
    });
    return out;
};

const readUpgradeToken = (req) => {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        const fromQuery = String(url.searchParams.get('access_token') || '').trim();
        if (fromQuery) return fromQuery;
    } catch {
        /* ignore */
    }
    const bearer = readBearerToken(req);
    if (bearer) return bearer;
    const cookies = parseCookies(req.headers?.cookie);
    return String(cookies.session || '').trim();
};

const fetchPlexAccount = async (token) => {
    const headers = {
        Accept: 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Product': 'StreamPilot',
        'X-Plex-Client-Identifier': 'streampilot-watch-together',
    };
    const tryUrls = [
        'https://plex.tv/api/v2/user',
        'https://plex.tv/users/account.json',
    ];
    for (const url of tryUrls) {
        try {
            const response = await fetch(url, { headers, cache: 'no-store' });
            if (!response.ok) continue;
            const data = await response.json();
            const user = data?.user || data;
            const id = String(user?.id || user?.uuid || '').trim();
            if (!id) continue;
            return {
                id: `plex:${id}`,
                displayName: String(user?.friendlyName || user?.username || user?.title || 'Plex user').trim(),
                thumb: user?.thumb || null,
                auth: /** @type {'plex'} */ ('plex'),
            };
        } catch {
            /* try next */
        }
    }
    return null;
};

/**
 * @param {import('http').IncomingMessage} req
 * @param {{ jwtSecret: string }} opts
 * @returns {Promise<WtUser | null>}
 */
export const resolveWatchTogetherUser = async (req, { jwtSecret }) => {
    const token = readUpgradeToken(req);
    if (!token) return null;

    try {
        const decoded = jwt.verify(token, jwtSecret);
        const id = String(decoded?.plexId || decoded?.id || '').trim();
        if (id) {
            return {
                id: String(decoded.plexId ? `portal:${decoded.plexId}` : `portal:${decoded.id}`),
                displayName: String(decoded.username || decoded.email || 'Member').trim(),
                thumb: decoded.thumb || null,
                auth: 'portal',
            };
        }
    } catch {
        /* not a portal JWT — try Plex */
    }

    return fetchPlexAccount(token);
};

const handleCreate = (participant, message) => {
    if (participant.roomId) leaveRoom(participant, { silent: true });
    const ratingKey = String(message?.ratingKey || '').trim();
    const serverId = String(message?.serverId || '').trim();
    const title = String(message?.title || 'Watch Together').trim() || 'Watch Together';
    const type = String(message?.mediaType || 'movie').trim() || 'movie';
    if (!ratingKey) {
        send(participant.socket, { type: 'wt_error', code: 'invalid_media', message: 'Missing title.' });
        return;
    }
    const inviteCode = makeInviteCode();
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
 * Allow portal play/file/hls/proxy to use the owner stream for a WT participant
 * so joiners can watch the host's library title without having it shared to them.
 *
 * @param {{ userIds?: string[], inviteCode?: string, ratingKey?: string }} opts
 * @returns {{ inviteCode: string, ratingKey: string, serverId: string } | null}
 */
export const resolveWatchTogetherHostStream = (opts = {}) => {
    const userIds = [...new Set((opts.userIds || []).map((row) => String(row || '').trim()).filter(Boolean))];
    if (!userIds.length) return null;
    const inviteCode = String(opts.inviteCode || '').trim().toUpperCase();
    const ratingKey = String(opts.ratingKey || '').trim();

    const roomMatches = (room) => {
        if (!room) return false;
        if (ratingKey && String(room.ratingKey) !== ratingKey) return false;
        return [...room.participants.values()].some((row) => participantMatchesUserIds(row, userIds));
    };

    if (inviteCode) {
        const room = findRoomByCode(inviteCode);
        if (!roomMatches(room)) return null;
        return {
            inviteCode: room.inviteCode,
            ratingKey: room.ratingKey,
            serverId: room.serverId || '',
        };
    }

    // Proxy/segment requests may omit wt= — any active room for this user (+ key) is enough.
    for (const room of roomsById.values()) {
        if (!roomMatches(room)) continue;
        return {
            inviteCode: room.inviteCode,
            ratingKey: room.ratingKey,
            serverId: room.serverId || '',
        };
    }
    return null;
};

/**
 * @param {import('http').Server} httpServer
 * @param {{ jwtSecret: string, basePath?: string, log?: (msg: string) => void }} opts
 */
export const attachWatchTogether = (httpServer, opts) => {
    const jwtSecret = String(opts?.jwtSecret || '');
    const basePath = String(opts?.basePath || '').replace(/\/+$/, '');
    const log = typeof opts?.log === 'function' ? opts.log : () => undefined;
    const wsPath = `${basePath}/api/watch-together/ws`;

    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
        let pathname = '';
        try {
            pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
        } catch {
            socket.destroy();
            return;
        }
        if (pathname !== wsPath && pathname !== `${wsPath}/`) {
            return;
        }
        void resolveWatchTogetherUser(req, { jwtSecret }).then((user) => {
            if (!user) {
                socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req, user);
            });
        }).catch(() => {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
        });
    });

    wss.on('connection', (ws, _req, user) => {
        /** @type {Participant} */
        const participant = {
            socket: ws,
            user,
            clientId: randomUUID(),
            roomId: null,
            joinedAt: nowMs(),
            lastReportMs: 0,
            buffering: false,
            seekReadyFor: null,
            lastCorrectiveAt: 0,
        };
        participantBySocket.set(ws, participant);
        send(ws, {
            type: 'wt_hello',
            clientId: participant.clientId,
            userId: user.id,
            displayName: user.displayName,
        });

        ws.on('message', (data) => onMessage(participant, data));
        ws.on('close', () => {
            leaveRoom(participant);
            participantBySocket.delete(ws);
        });
        ws.on('error', () => {
            leaveRoom(participant);
            participantBySocket.delete(ws);
        });
    });

    const reaper = setInterval(() => {
        const cutoff = nowMs() - EMPTY_ROOM_GRACE_MS;
        for (const room of [...roomsById.values()]) {
            if (room.participants.size === 0 && room.emptySince && room.emptySince < cutoff) {
                destroyRoom(room);
            }
        }
    }, 30000);
    if (typeof reaper.unref === 'function') reaper.unref();

    log(`[watch-together] relay listening on ${wsPath}`);
    return { wss, getWatchTogetherRoomSummary };
};
