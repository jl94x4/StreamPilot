import {
    CHAT_MESSAGE_MAX_LENGTH,
    CHAT_MESSAGES_PAGE_SIZE,
    CHAT_ROOM_NAME_MAX_LENGTH,
} from './constants.js';
import { mapMentions, resolveMentions } from './mentions.js';
import { createChatStore } from './store.js';

const normalizeRoomName = (name) => {
    const text = String(name || '').trim().replace(/^#+/, '');
    if (!text) {
        const err = new Error('Channel name is required');
        err.status = 400;
        throw err;
    }
    if (text.length > CHAT_ROOM_NAME_MAX_LENGTH) {
        const err = new Error(`Channel name is too long (max ${CHAT_ROOM_NAME_MAX_LENGTH} characters).`);
        err.status = 400;
        throw err;
    }
    return text;
};

const normalizeMessage = (message) => {
    const text = String(message || '').trim();
    if (!text) {
        const err = new Error('Message is required');
        err.status = 400;
        throw err;
    }
    if (text.length > CHAT_MESSAGE_MAX_LENGTH) {
        const err = new Error(`Message is too long (max ${CHAT_MESSAGE_MAX_LENGTH} characters).`);
        err.status = 400;
        throw err;
    }
    return text;
};

const mapMessage = (message = {}) => ({
    id: Number(message.id),
    message: String(message.message || ''),
    mentions: mapMentions(message.mentions),
    createdAt: message.createdAt || null,
    editedAt: message.editedAt || null,
    user: {
        id: message.userId || null,
        displayName: message.displayName || 'Member',
        avatar: message.avatar || '',
        isAdmin: !!message.isAdmin,
    },
});

const mapRoom = (room = {}, extras = {}) => ({
    id: String(room.id),
    name: room.name || 'general',
    description: room.description || '',
    createdAt: room.createdAt || null,
    updatedAt: room.updatedAt || null,
    lastMessageAt: room.lastMessageAt || null,
    lastMessagePreview: room.lastMessagePreview || '',
    unreadCount: Number(extras.unreadCount) || 0,
});

export const createChatService = ({
    dataDir,
    resolveUser = async () => null,
} = {}) => {
    const store = createChatStore({ dataDir });

    const actorProfile = (actor = {}) => ({
        id: String(actor.id || ''),
        displayName: actor.username || actor.email || 'Member',
        avatar: actor.thumb || actor.avatar || '',
        isAdmin: !!actor.isAdmin,
    });

    const ensureDefaultRoom = async () => {
        const count = await store.roomCount();
        if (count > 0) return null;
        return store.createRoom({
            name: 'general',
            description: 'General discussion for everyone on this server.',
            createdBy: 'system',
            sortOrder: 0,
        });
    };

    const listRooms = async ({ userId } = {}) => {
        await ensureDefaultRoom();
        const rooms = await store.listRooms();
        const readState = userId ? await store.getReadState(userId) : {};
        const enriched = [];
        for (const room of rooms) {
            const messages = await store.listMessages(room.id, { limit: 1 });
            const latest = messages[messages.length - 1];
            const lastRead = Number(readState[String(room.id)]) || 0;
            let unreadCount = 0;
            if (latest && Number(latest.id) > lastRead) {
                const all = await store.listMessages(room.id, { limit: 200 });
                unreadCount = all.filter((item) => Number(item.id) > lastRead
                    && String(item.userId) !== String(userId || '')).length;
            }
            enriched.push(mapRoom(room, { unreadCount }));
        }
        return enriched;
    };

    const createRoom = async (actor, body = {}) => {
        if (!actor?.isAdmin) {
            const err = new Error('Only admins can create channels');
            err.status = 403;
            throw err;
        }
        const room = await store.createRoom({
            name: normalizeRoomName(body.name),
            description: String(body.description || '').trim().slice(0, 240),
            createdBy: String(actor.id || ''),
        });
        return mapRoom(room);
    };

    const updateRoom = async (actor, roomId, body = {}) => {
        if (!actor?.isAdmin) {
            const err = new Error('Only admins can edit channels');
            err.status = 403;
            throw err;
        }
        const patch = {};
        if (body.name != null) patch.name = normalizeRoomName(body.name);
        if (body.description != null) patch.description = String(body.description || '').trim().slice(0, 240);
        if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder);
        const room = await store.updateRoom(roomId, patch);
        return mapRoom(room);
    };

    const reorderRooms = async (actor, orderedIds = []) => {
        if (!actor?.isAdmin) {
            const err = new Error('Only admins can reorder channels');
            err.status = 403;
            throw err;
        }
        const ids = Array.isArray(orderedIds) ? orderedIds : [];
        if (!ids.length) {
            const err = new Error('roomIds is required');
            err.status = 400;
            throw err;
        }
        await store.reorderRooms(ids);
        return listRooms({ userId: actor.id });
    };

    const deleteRoom = async (actor, roomId) => {
        if (!actor?.isAdmin) {
            const err = new Error('Only admins can delete channels');
            err.status = 403;
            throw err;
        }
        const ok = await store.deleteRoom(roomId);
        if (!ok) {
            const err = new Error('Channel not found');
            err.status = 404;
            throw err;
        }
        return { ok: true };
    };

    const getMessages = async (roomId, opts = {}) => {
        await ensureDefaultRoom();
        const messages = await store.listMessages(roomId, {
            after: opts.after,
            limit: opts.limit || CHAT_MESSAGES_PAGE_SIZE,
        });
        return messages.map(mapMessage);
    };

    const postMessage = async (actor, roomId, body = {}, opts = {}) => {
        const profile = actorProfile(actor);
        const text = normalizeMessage(body.message);
        const mentions = resolveMentions(text, opts.users || []);
        const message = await store.appendMessage(roomId, {
            userId: profile.id,
            displayName: profile.displayName,
            avatar: profile.avatar,
            isAdmin: profile.isAdmin,
            message: text,
            mentions,
        });
        await store.setReadState(profile.id, roomId, message.id);
        return mapMessage(message);
    };

    const deleteMessage = async (actor, roomId, messageId) => {
        const messages = await store.listMessages(roomId, { limit: 200 });
        const target = messages.find((item) => Number(item.id) === Number(messageId));
        if (!target) {
            const err = new Error('Message not found');
            err.status = 404;
            throw err;
        }
        const isOwner = String(target.userId) === String(actor?.id || '');
        if (!actor?.isAdmin && !isOwner) {
            const err = new Error('You can only delete your own messages');
            err.status = 403;
            throw err;
        }
        await store.deleteMessage(roomId, messageId);
        return { ok: true };
    };

    const markRead = async (userId, roomId, messageId) => {
        const value = await store.setReadState(userId, roomId, messageId);
        return { lastReadMessageId: value };
    };

    const getUnreadCount = async ({ userId } = {}) => {
        if (!userId) return { unread: 0 };
        const rooms = await listRooms({ userId });
        const unread = rooms.reduce((sum, room) => sum + (Number(room.unreadCount) || 0), 0);
        return { unread };
    };

    return {
        ensureDefaultRoom,
        listRooms,
        createRoom,
        updateRoom,
        reorderRooms,
        deleteRoom,
        getMessages,
        postMessage,
        deleteMessage,
        markRead,
        getUnreadCount,
        resolveUser,
    };
};

export default createChatService;
