import { isChatEnabled, isChatMentionNotifyEnabled, isUserChatMentionNotifyEnabled } from './constants.js';
import { listMentionableUsers } from './mentions.js';
import { createChatService } from './service.js';

export const registerChatRoutes = (app, deps) => {
    const {
        requireAuth,
        requireMember,
        loadFile,
        CONFIG_PATH,
        USERS_PATH,
        dataDir,
        createInAppNotification,
        appendAuditLog,
        resolveLocalUser = async () => null,
        log = () => {},
    } = deps;

    const actorFromReq = async (req) => {
        const local = req.localUser?.id
            ? req.localUser
            : await resolveLocalUser(req.user).catch(() => null);
        return {
            id: local?.id || req.user?.id,
            username: local?.username || req.user?.username,
            email: local?.email || req.user?.email,
            thumb: local?.thumb || req.user?.thumb,
            isAdmin: !!req.user?.isAdmin,
        };
    };

    const getService = () => createChatService({ dataDir });

    const loadMentionUsers = async () => {
        const users = await loadFile(USERS_PATH, []);
        return (Array.isArray(users) ? users : [])
            .map((user) => ({
                id: user?.id,
                username: user?.username,
                thumb: user?.thumb || user?.avatar || '',
            }))
            .filter((user) => user.id && user.username);
    };

    const requireEnabled = async (req, res) => {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isChatEnabled(config)) {
            res.status(404).json({ error: 'Community chat is disabled.' });
            return null;
        }
        return config;
    };

    const notifyMentionedUsers = async ({
        config,
        actor,
        roomId,
        roomName,
        message,
    }) => {
        if (!isChatMentionNotifyEnabled(config)) return;
        if (!message?.mentions?.length || typeof createInAppNotification !== 'function') return;

        const users = await loadFile(USERS_PATH, []);
        const href = `/chat?room=${encodeURIComponent(String(roomId || ''))}`;
        const preview = String(message.message || '').trim().slice(0, 160);
        const sender = actor?.username || actor?.displayName || 'Someone';

        for (const mention of message.mentions) {
            const userId = String(mention?.userId || '');
            if (!userId || userId === String(actor?.id || '')) continue;

            const target = (Array.isArray(users) ? users : []).find((row) => String(row?.id) === userId);
            if (!target || !isUserChatMentionNotifyEnabled(target)) continue;

            try {
                await createInAppNotification({
                    userId,
                    type: 'chat_mention',
                    title: `${sender} mentioned you in #${roomName || 'chat'}`,
                    body: preview,
                    href,
                    meta: {
                        roomId: String(roomId || ''),
                        messageId: message.id,
                        mentionedBy: String(actor?.id || ''),
                    },
                });
            } catch (error) {
                log(`[chat] mention notify failed for ${userId}: ${error?.message || error}`);
            }
        }
    };

    app.get('/api/chat/meta', requireAuth, requireMember, async (req, res) => {
        try {
            const config = await loadFile(CONFIG_PATH, {});
            const actor = await actorFromReq(req);
            res.json({
                enabled: isChatEnabled(config),
                isAdmin: !!actor.isAdmin,
                mentionNotifyInApp: isChatMentionNotifyEnabled(config),
            });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Chat meta failed' });
        }
    });

    app.get('/api/chat/mentionables', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const users = await loadMentionUsers();
            const q = String(req.query.q || '').trim();
            const limit = Number(req.query.limit);
            res.json({
                users: listMentionableUsers(users, q, Number.isFinite(limit) ? limit : 12),
            });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Failed to load mentionable users' });
        }
    });

    app.get('/api/chat/unread-count', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const payload = await service.getUnreadCount({ userId: actor.id });
            res.json(payload);
        } catch (e) {
            res.status(500).json({ error: e.message || 'Unread count failed' });
        }
    });

    app.get('/api/chat/rooms', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const rooms = await service.listRooms({ userId: actor.id });
            res.json({ rooms, isAdmin: !!actor.isAdmin });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Failed to list channels' });
        }
    });

    app.post('/api/chat/rooms', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const room = await service.createRoom(actor, req.body || {});
            if (typeof appendAuditLog === 'function') {
                await appendAuditLog('chat_room_created', req.user, null, {
                    roomId: room.id,
                    name: room.name,
                });
            }
            res.json({ room });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to create channel' });
        }
    });

    app.patch('/api/chat/rooms/:id', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const room = await service.updateRoom(actor, req.params.id, req.body || {});
            res.json({ room });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to update channel' });
        }
    });

    app.post('/api/chat/rooms/reorder', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const roomIds = Array.isArray(req.body?.roomIds) ? req.body.roomIds : [];
            const rooms = await service.reorderRooms(actor, roomIds);
            if (typeof appendAuditLog === 'function') {
                await appendAuditLog('chat_rooms_reordered', req.user, null, {
                    roomIds: roomIds.map(String),
                });
            }
            res.json({ rooms });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to reorder channels' });
        }
    });

    app.delete('/api/chat/rooms/:id', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const result = await service.deleteRoom(actor, req.params.id);
            if (typeof appendAuditLog === 'function') {
                await appendAuditLog('chat_room_deleted', req.user, null, {
                    roomId: String(req.params.id || ''),
                });
            }
            res.json(result);
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to delete channel' });
        }
    });

    app.get('/api/chat/rooms/:id/messages', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const after = Number(req.query.after);
            const messages = await service.getMessages(req.params.id, {
                after: Number.isFinite(after) ? after : undefined,
            });
            res.json({ messages });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to load messages' });
        }
    });

    app.post('/api/chat/rooms/:id/messages', requireAuth, requireMember, async (req, res) => {
        try {
            const config = await requireEnabled(req, res);
            if (!config) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const users = await loadMentionUsers();
            const message = await service.postMessage(actor, req.params.id, req.body || {}, { users });
            const rooms = await service.listRooms({ userId: actor.id });
            const room = rooms.find((row) => String(row.id) === String(req.params.id));
            await notifyMentionedUsers({
                config,
                actor,
                roomId: req.params.id,
                roomName: room?.name || 'chat',
                message,
            });
            res.json({ message });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to send message' });
        }
    });

    app.delete('/api/chat/rooms/:roomId/messages/:messageId', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const result = await service.deleteMessage(actor, req.params.roomId, req.params.messageId);
            res.json(result);
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to delete message' });
        }
    });

    app.post('/api/chat/rooms/:id/read', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const messageId = Number(req.body?.messageId);
            if (!Number.isFinite(messageId)) {
                return res.status(400).json({ error: 'messageId is required' });
            }
            const payload = await service.markRead(actor.id, req.params.id, messageId);
            res.json(payload);
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to mark read' });
        }
    });
};

export default registerChatRoutes;
