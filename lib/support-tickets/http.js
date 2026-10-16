import { SUPPORT_TICKET_CATEGORIES, isSupportTicketsEnabled, SUPPORT_ATTACHMENT_MAX_BYTES } from './constants.js';
import { createSupportTicketService } from './service.js';
import { resolveMediaIssueFromSupportTicket } from './fromIssue.js';
import { notifySupportAdmins } from '../notifications/supportNotify.js';
import {
    collectReferencedAttachmentIds,
    pruneUnreferencedSupportAttachments,
    readSupportAttachment,
    writeSupportAttachment,
} from './attachments.js';

export const registerSupportTicketRoutes = (app, deps) => {
    const {
        requireAuth,
        requireMember,
        requireAdmin,
        loadFile,
        CONFIG_PATH,
        USERS_PATH,
        dataDir,
        createInAppNotification,
        appendAuditLog,
        resolveLocalUser = async () => null,
        sendGotifyAlert,
        alertRuleEnabled,
        resolvePublicBaseUrl,
        expressRaw = null,
        resolveLinkedMediaIssue = null,
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

    const getService = () => {
        let usersPromise = null;
        const resolveUser = async (userId) => {
            if (!userId || !USERS_PATH) return null;
            if (!usersPromise) {
                usersPromise = loadFile(USERS_PATH, []).then((users) => (
                    Array.isArray(users) ? users : []
                ));
            }
            const users = await usersPromise;
            return users.find((u) => String(u?.id) === String(userId)) || null;
        };
        return createSupportTicketService({ dataDir, resolveUser });
    };

    const requireEnabled = async (req, res) => {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isSupportTicketsEnabled(config)) {
            res.status(404).json({ error: 'Support tickets are disabled.' });
            return null;
        }
        return config;
    };

    const notifyAdmins = async (event, { title, body, href, meta = {}, excludeUserId = null } = {}) => {
        if (!USERS_PATH) return;
        try {
            const config = await loadFile(CONFIG_PATH, {});
            await notifySupportAdmins({
                event,
                config,
                title,
                body,
                href,
                meta,
                excludeUserId,
                loadUsers: () => loadFile(USERS_PATH, []),
                sendGotifyAlert,
                alertRuleEnabled,
                resolvePublicBaseUrl,
                log,
            });
        } catch (error) {
            log(`[support] admin notify failed: ${error?.message || error}`);
        }
    };

    const notifyUser = async (userId, title, body, href, meta = {}) => {
        if (!userId || typeof createInAppNotification !== 'function') return;
        try {
            await createInAppNotification({
                userId,
                type: 'support_ticket',
                title,
                body,
                href,
                meta: { ...meta, audience: 'owner' },
            });
        } catch (error) {
            log(`[support] user notify failed: ${error?.message || error}`);
        }
    };

    app.get('/api/support/meta', requireAuth, requireMember, async (req, res) => {
        try {
            const config = await loadFile(CONFIG_PATH, {});
            res.json({
                enabled: isSupportTicketsEnabled(config),
                categories: SUPPORT_TICKET_CATEGORIES,
            });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Support meta failed' });
        }
    });

    app.get('/api/support/unread-count', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const counts = await service.getCounts({
                userId: actor.id,
                isAdmin: !!actor.isAdmin,
            });
            res.json({ unread: counts.unread, ...counts });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Unread count failed' });
        }
    });

    app.get('/api/support/tickets', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const filter = String(req.query.filter || 'all').toLowerCase();
            const take = Math.min(200, Math.max(1, Number(req.query.take) || 80));
            const skip = Math.max(0, Number(req.query.skip) || 0);
            const actor = await actorFromReq(req);
            const isAdmin = !!actor.isAdmin;
            const payload = await service.listTickets({
                userId: actor.id,
                isAdmin,
                filter,
                take,
                skip,
            });
            const counts = await service.getCounts({
                userId: actor.id,
                isAdmin,
            });
            res.json({ ...payload, counts, isAdmin });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Failed to list tickets' });
        }
    });

    app.post('/api/support/tickets', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const ticket = await service.createTicket(actor, req.body || {});
            const href = `/support?ticket=${encodeURIComponent(String(ticket.id))}`;
            const username = ticket.createdBy?.displayName || 'A member';
            await notifyAdmins('support_ticket', {
                title: ticket.subject,
                body: `${username}: ${ticket.subject}`,
                href,
                meta: { ticketId: ticket.id, username },
                excludeUserId: actor.id,
            });
            if (typeof appendAuditLog === 'function') {
                await appendAuditLog('support_ticket_created', req.user, null, {
                    ticketId: ticket.id,
                    subject: ticket.subject,
                    category: ticket.category,
                });
            }
            res.json({ ticket });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to create ticket' });
        }
    });

    const attachmentUploadMiddleware = typeof expressRaw === 'function'
        ? expressRaw({ type: ['image/*', 'application/octet-stream'], limit: SUPPORT_ATTACHMENT_MAX_BYTES })
        : (_req, _res, next) => next();

    app.post(
        '/api/support/tickets/:id/attachments',
        requireAuth,
        requireMember,
        attachmentUploadMiddleware,
        async (req, res) => {
            try {
                if (!(await requireEnabled(req, res))) return;
                const service = getService();
                const actor = await actorFromReq(req);
                const isAdmin = !!actor.isAdmin;
                const { record } = await service.assertCanAccess(actor, req.params.id, { isAdmin });
                await pruneUnreferencedSupportAttachments(
                    dataDir,
                    req.params.id,
                    collectReferencedAttachmentIds(record),
                ).catch(() => {});
                const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
                const filename = String(req.headers['x-filename'] || req.query.filename || 'image').slice(0, 180);
                const attachment = await writeSupportAttachment(dataDir, req.params.id, buffer, filename);
                res.json({ attachment });
            } catch (e) {
                res.status(e.status || 500).json({ error: e.message || 'Failed to upload image' });
            }
        },
    );

    app.get('/api/support/tickets/:id/attachments/:attachmentId', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const isAdmin = !!actor.isAdmin;
            await service.assertCanAccess(actor, req.params.id, { isAdmin });
            const file = await readSupportAttachment(dataDir, req.params.id, req.params.attachmentId);
            if (!file) return res.status(404).json({ error: 'Attachment not found' });
            res.setHeader('Content-Type', file.mime);
            res.setHeader('Cache-Control', 'private, max-age=86400');
            res.send(file.buffer);
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to load attachment' });
        }
    });

    app.post('/api/support/tickets/:id/comments/:commentId/attachments', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const isAdmin = !!actor.isAdmin;
            await service.assertCanAccess(actor, req.params.id, { isAdmin });
            const ticket = await service.attachToComment(
                req.params.id,
                req.params.commentId,
                req.body?.attachments || [],
            );
            res.json({ ticket });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to attach images' });
        }
    });

    app.get('/api/support/tickets/:id', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const isAdmin = !!actor.isAdmin;
            const { dto } = await service.assertCanAccess(actor, req.params.id, { isAdmin });
            const ticket = await service.markRead(req.params.id, { isAdmin });
            res.json({ ticket: ticket || dto });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to load ticket' });
        }
    });

    app.post('/api/support/tickets/:id/comment', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const isAdmin = !!actor.isAdmin;
            const { record } = await service.assertCanAccess(actor, req.params.id, { isAdmin });
            const ticket = await service.addComment(req.params.id, req.body?.message, actor, {
                isAdmin,
                attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
            });
            const href = `/support?ticket=${encodeURIComponent(String(ticket.id))}`;
            if (isAdmin) {
                await notifyUser(
                    record.userId,
                    'Support reply',
                    `Admin replied to “${ticket.subject}”`,
                    href,
                    { ticketId: ticket.id },
                );
            } else {
                const username = ticket.createdBy?.displayName || 'A member';
                await notifyAdmins('support_reply', {
                    title: ticket.subject,
                    body: `${username} replied to “${ticket.subject}”`,
                    href,
                    meta: { ticketId: ticket.id, username },
                    excludeUserId: actor.id,
                });
            }
            res.json({ ticket });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to add reply' });
        }
    });

    app.patch('/api/support/tickets/:id/comments/:commentId', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const isAdmin = !!actor.isAdmin;
            await service.assertCanAccess(actor, req.params.id, { isAdmin });
            const ticket = await service.editComment(
                req.params.id,
                req.params.commentId,
                req.body?.message,
                actor,
                { isAdmin },
            );
            res.json({ ticket });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to edit message' });
        }
    });

    app.post('/api/support/tickets/:id/comments/:commentId/reactions', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const isAdmin = !!actor.isAdmin;
            await service.assertCanAccess(actor, req.params.id, { isAdmin });
            const ticket = await service.toggleReaction(
                req.params.id,
                req.params.commentId,
                req.body?.emoji,
                actor,
            );
            res.json({ ticket });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to update reaction' });
        }
    });

    app.post('/api/support/tickets/:id/status', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            const actor = await actorFromReq(req);
            const isAdmin = !!actor.isAdmin;
            await service.assertCanAccess(actor, req.params.id, { isAdmin });
            const next = String(req.body?.status || req.query.status || '').toLowerCase();
            if (!isAdmin && next !== 'closed' && next !== 'open') {
                return res.status(403).json({ error: 'Only admins can resolve tickets.' });
            }
            if (!['open', 'resolved', 'closed'].includes(next)) {
                return res.status(400).json({ error: 'Status must be open, resolved, or closed.' });
            }
            const ticket = await service.updateStatus(req.params.id, next, { isAdmin });
            if ((next === 'resolved' || next === 'closed') && typeof resolveLinkedMediaIssue === 'function') {
                await resolveMediaIssueFromSupportTicket({
                    ticket,
                    resolveIssue: resolveLinkedMediaIssue,
                    log,
                });
            }
            if (typeof appendAuditLog === 'function') {
                await appendAuditLog('support_ticket_status', req.user, null, {
                    ticketId: ticket.id,
                    status: next,
                });
            }
            if (isAdmin && ticket.createdBy?.id) {
                await notifyUser(
                    ticket.createdBy.id,
                    'Support ticket updated',
                    `“${ticket.subject}” is now ${ticket.statusLabel}.`,
                    `/support?ticket=${encodeURIComponent(String(ticket.id))}`,
                    { ticketId: ticket.id },
                );
            }
            res.json({ ticket });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to update ticket' });
        }
    });

    app.delete('/api/support/tickets/:id', requireAuth, requireAdmin, async (req, res) => {
        try {
            if (!(await requireEnabled(req, res))) return;
            const service = getService();
            await service.deleteTicket(req.params.id);
            if (typeof appendAuditLog === 'function') {
                await appendAuditLog('support_ticket_deleted', req.user, null, { ticketId: req.params.id });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || 'Failed to delete ticket' });
        }
    });
};

export default registerSupportTicketRoutes;
