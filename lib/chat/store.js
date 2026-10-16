/**
 * JSON chat store: rooms + per-room message logs under config/chat/.
 */

import fs from 'fs/promises';
import path from 'path';
import { CHAT_MESSAGES_PER_ROOM_CAP } from './constants.js';

const INDEX_FILE = 'index.json';
const ROOMS_DIR = 'rooms';
const MESSAGES_DIR = 'messages';
const READ_STATE_DIR = 'read-state';

const defaultIndex = () => ({
    version: 1,
    nextRoomId: 1,
    nextMessageId: 1,
    roomIds: [],
});

export const createChatStore = (options = {}) => {
    const dataDir = String(options.dataDir || '').trim();
    if (!dataDir) {
        throw new Error('[chat] dataDir is required');
    }

    let chain = Promise.resolve();
    const withLock = (fn) => {
        const run = chain.then(fn, fn);
        chain = run.catch(() => {});
        return run;
    };

    const indexPath = () => path.join(dataDir, INDEX_FILE);
    const roomPath = (id) => path.join(dataDir, ROOMS_DIR, `${id}.json`);
    const messagesPath = (roomId) => path.join(dataDir, MESSAGES_DIR, `${roomId}.json`);
    const readStatePath = (userId) => path.join(dataDir, READ_STATE_DIR, `${userId}.json`);

    const ensureDir = async (dir = dataDir) => {
        await fs.mkdir(dir, { recursive: true });
    };

    const readJson = async (filePath, fallback) => {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            return JSON.parse(raw);
        } catch (error) {
            if (error?.code === 'ENOENT') return fallback;
            throw error;
        }
    };

    const writeJsonAtomic = async (filePath, value) => {
        await ensureDir(path.dirname(filePath));
        const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        const payload = `${JSON.stringify(value, null, 2)}\n`;
        await fs.writeFile(tmp, payload, 'utf8');
        await fs.rename(tmp, filePath);
    };

    const loadIndex = async () => {
        await ensureDir();
        const index = await readJson(indexPath(), defaultIndex());
        if (!index || typeof index !== 'object') return defaultIndex();
        return {
            version: Number(index.version) || 1,
            nextRoomId: Math.max(1, Number(index.nextRoomId) || 1),
            nextMessageId: Math.max(1, Number(index.nextMessageId) || 1),
            roomIds: Array.isArray(index.roomIds) ? index.roomIds.map(String) : [],
        };
    };

    const saveIndex = async (index) => writeJsonAtomic(indexPath(), index);

    const readRoom = async (id) => {
        const record = await readJson(roomPath(id), null);
        return record && typeof record === 'object' ? record : null;
    };

    const readMessages = async (roomId) => {
        const payload = await readJson(messagesPath(roomId), { roomId: String(roomId), messages: [] });
        if (!payload || typeof payload !== 'object') return { roomId: String(roomId), messages: [] };
        return {
            roomId: String(payload.roomId || roomId),
            messages: Array.isArray(payload.messages) ? payload.messages : [],
        };
    };

    const saveMessages = async (roomId, messages) => {
        const trimmed = messages.slice(-CHAT_MESSAGES_PER_ROOM_CAP);
        await writeJsonAtomic(messagesPath(roomId), {
            roomId: String(roomId),
            messages: trimmed,
        });
        return trimmed;
    };

    const listRooms = async () => withLock(async () => {
        const index = await loadIndex();
        const rooms = [];
        for (const id of index.roomIds) {
            const room = await readRoom(id);
            if (!room || room.archived) continue;
            rooms.push(room);
        }
        rooms.sort((a, b) => {
            const sortA = Number(a.sortOrder) || 0;
            const sortB = Number(b.sortOrder) || 0;
            if (sortA !== sortB) return sortA - sortB;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
        return rooms;
    });

    const getRoom = async (id) => withLock(async () => readRoom(String(id || '').trim()));

    const createRoom = async (partial = {}) => withLock(async () => {
        const index = await loadIndex();
        const id = String(index.nextRoomId);
        const now = new Date().toISOString();
        const name = String(partial.name || '').trim();
        if (!name) {
            const err = new Error('Channel name is required');
            err.status = 400;
            throw err;
        }
        const record = {
            id,
            name: name.slice(0, 80),
            description: String(partial.description || '').trim().slice(0, 240),
            createdAt: now,
            updatedAt: now,
            createdBy: String(partial.createdBy || ''),
            sortOrder: Number.isFinite(Number(partial.sortOrder)) ? Number(partial.sortOrder) : index.roomIds.length,
            archived: false,
        };
        await ensureDir(path.join(dataDir, ROOMS_DIR));
        await writeJsonAtomic(roomPath(id), record);
        await writeJsonAtomic(messagesPath(id), { roomId: id, messages: [] });
        index.roomIds.push(id);
        index.nextRoomId = Math.max(index.nextRoomId, Number(id) + 1);
        await saveIndex(index);
        return record;
    });

    const updateRoom = async (id, patch = {}) => withLock(async () => {
        const key = String(id || '').trim();
        const room = await readRoom(key);
        if (!room) {
            const err = new Error('Channel not found');
            err.status = 404;
            throw err;
        }
        if (patch.name != null) {
            const name = String(patch.name || '').trim();
            if (!name) {
                const err = new Error('Channel name is required');
                err.status = 400;
                throw err;
            }
            room.name = name.slice(0, 80);
        }
        if (patch.description != null) {
            room.description = String(patch.description || '').trim().slice(0, 240);
        }
        if (patch.sortOrder != null && Number.isFinite(Number(patch.sortOrder))) {
            room.sortOrder = Number(patch.sortOrder);
        }
        room.updatedAt = new Date().toISOString();
        await writeJsonAtomic(roomPath(key), room);
        return room;
    });

    const reorderRooms = async (orderedIds = []) => withLock(async () => {
        const index = await loadIndex();
        const requested = [...new Set(
            (Array.isArray(orderedIds) ? orderedIds : [])
                .map((id) => String(id).trim())
                .filter(Boolean),
        )];
        const activeRooms = [];
        for (const id of index.roomIds) {
            const room = await readRoom(id);
            if (room && !room.archived) activeRooms.push(room);
        }
        const activeIdSet = new Set(activeRooms.map((room) => String(room.id)));
        const orderedActive = requested.filter((id) => activeIdSet.has(id));
        const remainder = activeRooms
            .map((room) => String(room.id))
            .filter((id) => !orderedActive.includes(id));
        const finalOrder = [...orderedActive, ...remainder];
        const now = new Date().toISOString();
        for (let i = 0; i < finalOrder.length; i += 1) {
            const room = await readRoom(finalOrder[i]);
            if (!room) continue;
            room.sortOrder = i;
            room.updatedAt = now;
            await writeJsonAtomic(roomPath(finalOrder[i]), room);
        }
        const archivedIds = index.roomIds.filter((id) => !activeIdSet.has(String(id)));
        index.roomIds = [...finalOrder, ...archivedIds];
        await saveIndex(index);
        return finalOrder;
    });

    const deleteRoom = async (id) => withLock(async () => {
        const key = String(id || '').trim();
        const index = await loadIndex();
        if (!index.roomIds.includes(key)) return false;
        const room = await readRoom(key);
        if (!room) return false;
        room.archived = true;
        room.updatedAt = new Date().toISOString();
        await writeJsonAtomic(roomPath(key), room);
        index.roomIds = index.roomIds.filter((entry) => entry !== key);
        await saveIndex(index);
        return true;
    });

    const appendMessage = async (roomId, partial = {}) => withLock(async () => {
        const key = String(roomId || '').trim();
        const room = await readRoom(key);
        if (!room || room.archived) {
            const err = new Error('Channel not found');
            err.status = 404;
            throw err;
        }
        const index = await loadIndex();
        const id = Number(index.nextMessageId);
        const now = new Date().toISOString();
        const message = {
            id,
            userId: String(partial.userId || ''),
            displayName: String(partial.displayName || 'Member'),
            avatar: String(partial.avatar || ''),
            isAdmin: !!partial.isAdmin,
            message: String(partial.message || ''),
            mentions: Array.isArray(partial.mentions) ? partial.mentions : [],
            createdAt: now,
            editedAt: null,
        };
        if (!message.userId || !message.message) {
            const err = new Error('Message is required');
            err.status = 400;
            throw err;
        }
        const payload = await readMessages(key);
        payload.messages.push(message);
        await saveMessages(key, payload.messages);
        room.updatedAt = now;
        room.lastMessageAt = now;
        room.lastMessagePreview = message.message.slice(0, 120);
        await writeJsonAtomic(roomPath(key), room);
        index.nextMessageId = Math.max(index.nextMessageId, id + 1);
        await saveIndex(index);
        return message;
    });

    const listMessages = async (roomId, opts = {}) => withLock(async () => {
        const key = String(roomId || '').trim();
        const room = await readRoom(key);
        if (!room || room.archived) {
            const err = new Error('Channel not found');
            err.status = 404;
            throw err;
        }
        const payload = await readMessages(key);
        let messages = payload.messages;
        const after = Number(opts.after);
        if (Number.isFinite(after) && after > 0) {
            messages = messages.filter((item) => Number(item.id) > after);
        }
        const limit = Math.min(200, Math.max(1, Number(opts.limit) || 80));
        if (messages.length > limit) {
            messages = messages.slice(-limit);
        }
        return messages;
    });

    const deleteMessage = async (roomId, messageId) => withLock(async () => {
        const key = String(roomId || '').trim();
        const mid = Number(messageId);
        const payload = await readMessages(key);
        const before = payload.messages.length;
        payload.messages = payload.messages.filter((item) => Number(item.id) !== mid);
        if (payload.messages.length === before) {
            const err = new Error('Message not found');
            err.status = 404;
            throw err;
        }
        await saveMessages(key, payload.messages);
        return true;
    });

    const getReadState = async (userId) => withLock(async () => {
        const key = String(userId || '').trim();
        if (!key) return {};
        const state = await readJson(readStatePath(key), {});
        return state && typeof state === 'object' ? state : {};
    });

    const setReadState = async (userId, roomId, messageId) => withLock(async () => {
        const userKey = String(userId || '').trim();
        const roomKey = String(roomId || '').trim();
        const mid = Number(messageId);
        if (!userKey || !roomKey || !Number.isFinite(mid)) return null;
        const state = await readJson(readStatePath(userKey), {});
        const next = state && typeof state === 'object' ? { ...state } : {};
        next[roomKey] = Math.max(Number(next[roomKey]) || 0, mid);
        await writeJsonAtomic(readStatePath(userKey), next);
        return next[roomKey];
    });

    const roomCount = async () => withLock(async () => {
        const index = await loadIndex();
        return index.roomIds.length;
    });

    return {
        listRooms,
        getRoom,
        createRoom,
        updateRoom,
        reorderRooms,
        deleteRoom,
        appendMessage,
        listMessages,
        deleteMessage,
        getReadState,
        setReadState,
        roomCount,
        dataDir,
    };
};

export default createChatStore;
