import {
    SUPPORT_TICKET_STATUS,
    SUPPORT_CATEGORY_IDS,
    SUPPORT_REACTION_EMOJIS,
    SUPPORT_MESSAGE_MAX_LENGTH,
    SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
    supportStatusLabel,
    supportCategoryLabel,
    parseSupportStatus,
} from './constants.js';
import { createSupportTicketStore } from './store.js';
import {
    assertAttachmentsExist,
    deleteSupportTicketAttachments,
    mapAttachmentsForTicket,
} from './attachments.js';

const sanitizeMeta = (meta) => {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    return { ...meta };
};

const mapReactions = (reactions = {}) => {
    const entries = [];
    for (const [emoji, ids] of Object.entries(reactions || {})) {
        const userIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
        if (!userIds.length) continue;
        entries.push({ emoji, count: userIds.length, userIds });
    }
    return entries;
};

const mapComment = (comment = {}, ticketId = null) => ({
    id: comment.id != null ? Number(comment.id) : null,
    message: String(comment.message || ''),
    createdAt: comment.createdAt || null,
    editedAt: comment.editedAt || null,
    reactions: mapReactions(comment.reactions),
    attachments: mapAttachmentsForTicket(comment.attachments, ticketId ?? comment.ticketId),
    user: {
        id: comment.userId || comment.user?.id || null,
        displayName: comment.displayName || comment.user?.displayName || 'Member',
        avatar: comment.avatar || comment.user?.avatar || '',
        isAdmin: !!comment.isAdmin,
    },
});

const mapLinkedMedia = (meta = {}) => {
    if (!meta || typeof meta !== 'object') return null;
    if (!meta.linkedIssueId && meta.source !== 'media_issue') return null;
    const tmdbId = Number(meta.tmdbId);
    return {
        issueId: meta.linkedIssueId != null ? String(meta.linkedIssueId) : null,
        engine: meta.issueEngine || null,
        title: meta.mediaTitle || null,
        mediaType: meta.mediaType === 'tv' ? 'tv' : 'movie',
        tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
        posterUrl: meta.posterUrl || '',
        issueTypeLabel: meta.issueTypeLabel || null,
        problemSeason: meta.problemSeason != null ? Number(meta.problemSeason) : null,
        problemEpisode: meta.problemEpisode != null ? Number(meta.problemEpisode) : null,
    };
};

const lastMessageFromComments = (comments = []) => {
    const last = comments[comments.length - 1];
    if (!last) return null;
    return {
        message: last.message,
        createdAt: last.createdAt,
        displayName: last.user?.displayName || 'Member',
    };
};

export const mapSupportTicketToDto = (record, user = {}) => {
    const ticketId = Number(record?.id);
    const comments = Array.isArray(record?.comments)
        ? record.comments.map((comment) => mapComment(comment, ticketId))
        : [];
    return {
        id: Number(record?.id),
        subject: record?.subject || 'Support ticket',
        category: record?.category || 'other',
        categoryLabel: supportCategoryLabel(record?.category),
        status: Number(record?.status) || SUPPORT_TICKET_STATUS.OPEN,
        statusLabel: supportStatusLabel(record?.status),
        createdAt: record?.createdAt || null,
        updatedAt: record?.updatedAt || null,
        unreadForUser: !!record?.unreadForUser,
        unreadForAdmin: !!record?.unreadForAdmin,
        createdBy: {
            id: record?.userId || user?.id || null,
            displayName: user?.username || user?.email || record?.meta?.createdByName || 'Member',
            email: user?.email || record?.meta?.createdByEmail || null,
            avatar: user?.thumb || user?.avatar || '',
        },
        comments,
        commentCount: comments.length,
        lastMessage: lastMessageFromComments(comments),
        linkedMedia: mapLinkedMedia(record?.meta),
    };
};

const filterByTab = (dto, filter) => {
    const status = Number(dto?.status);
    if (!filter || filter === 'all') return true;
    if (filter === 'open') return status === SUPPORT_TICKET_STATUS.OPEN;
    if (filter === 'resolved') return status === SUPPORT_TICKET_STATUS.RESOLVED;
    if (filter === 'closed') return status === SUPPORT_TICKET_STATUS.CLOSED;
    return true;
};

const liveAvatar = (user, fallback = '') => user?.thumb || user?.avatar || fallback || '';

const liveDisplayName = (user, fallback = 'Member') => (
    user?.username || user?.email || fallback || 'Member'
);

const normalizeMessage = (message, { min = 1 } = {}) => {
    const text = String(message || '').trim();
    if (text.length < min) {
        const err = new Error(min > 1
            ? `Please describe the issue (at least ${min} characters).`
            : 'Message is required');
        err.status = 400;
        throw err;
    }
    if (text.length > SUPPORT_MESSAGE_MAX_LENGTH) {
        const err = new Error(`Message is too long (max ${SUPPORT_MESSAGE_MAX_LENGTH} characters).`);
        err.status = 400;
        throw err;
    }
    return text;
};

const assertAllowedEmoji = (emoji) => {
    const value = String(emoji || '').trim();
    if (!SUPPORT_REACTION_EMOJIS.includes(value)) {
        const err = new Error('That reaction is not allowed.');
        err.status = 400;
        throw err;
    }
    return value;
};

export const createSupportTicketService = ({
    dataDir,
    resolveUser = async () => null,
} = {}) => {
    const store = createSupportTicketStore({ dataDir });
    const userMemo = new Map();

    const getUser = async (userId) => {
        const key = String(userId || '').trim();
        if (!key) return null;
        if (userMemo.has(key)) return userMemo.get(key);
        const user = await resolveUser(key).catch(() => null);
        userMemo.set(key, user || null);
        return user || null;
    };

    const enrichComment = async (comment, ticketId) => {
        const mapped = mapComment(comment, ticketId);
        const author = await getUser(mapped.user.id);
        if (author) {
            mapped.user.avatar = liveAvatar(author, mapped.user.avatar);
            mapped.user.displayName = liveDisplayName(author, mapped.user.displayName);
        }
        return mapped;
    };

    const enrich = async (record) => {
        const user = await getUser(record?.userId);
        const dto = mapSupportTicketToDto(record, user || {});
        const ticketId = Number(record?.id);
        dto.comments = await Promise.all(
            (Array.isArray(record?.comments) ? record.comments : []).map((comment) => (
                enrichComment(comment, ticketId)
            )),
        );
        dto.commentCount = dto.comments.length;
        dto.lastMessage = lastMessageFromComments(dto.comments);
        if (user) {
            dto.createdBy.avatar = liveAvatar(user, dto.createdBy.avatar);
            dto.createdBy.displayName = liveDisplayName(user, dto.createdBy.displayName);
            dto.createdBy.email = user.email || dto.createdBy.email;
        }
        return dto;
    };

    const createTicket = async (user, body = {}) => {
        const subject = String(body.subject || '').trim();
        const message = normalizeMessage(body.message, { min: 0 });
        const category = SUPPORT_CATEGORY_IDS.includes(String(body.category || ''))
            ? String(body.category)
            : 'other';
        if (subject.length < 3) {
            const err = new Error('Please add a short subject (at least 3 characters).');
            err.status = 400;
            throw err;
        }
        if (!message) {
            // Allow empty body when the client will attach images to comment 1 next.
            // Still require something for text-only tickets.
            if (!body.allowEmptyMessage) {
                const err = new Error('Please describe the issue (at least 3 characters).');
                err.status = 400;
                throw err;
            }
        } else if (message.length < 3 && !body.allowEmptyMessage) {
            const err = new Error('Please describe the issue (at least 3 characters).');
            err.status = 400;
            throw err;
        }
        const now = new Date().toISOString();
        const record = await store.create({
            userId: String(user?.id || ''),
            subject,
            category,
            unreadForAdmin: true,
            unreadForUser: false,
            comments: [{
                id: 1,
                message,
                createdAt: now,
                userId: String(user?.id || ''),
                displayName: user?.username || user?.email || 'Member',
                avatar: user?.thumb || user?.avatar || '',
                isAdmin: false,
                reactions: {},
                attachments: [],
            }],
            meta: {
                createdByName: user?.username || user?.email || null,
                createdByEmail: user?.email || null,
                ...sanitizeMeta(body.meta),
            },
        });
        return enrich(record);
    };

    const listTickets = async ({ userId = null, isAdmin = false, filter = 'all', take = 40, skip = 0 } = {}) => {
        if (!isAdmin && !userId) {
            return {
                results: [],
                pageInfo: { total: 0, take, skip },
            };
        }
        const records = await store.list(isAdmin ? {} : { userId });
        const dtos = [];
        for (const record of records) dtos.push(await enrich(record));
        const filtered = dtos.filter((item) => filterByTab(item, filter));
        return {
            results: filtered.slice(skip, skip + take),
            pageInfo: { total: filtered.length, take, skip },
        };
    };

    const getCounts = async ({ userId = null, isAdmin = false } = {}) => {
        if (!isAdmin && !userId) {
            return { open: 0, resolved: 0, closed: 0, unread: 0, total: 0 };
        }
        const records = await store.list(isAdmin ? {} : { userId });
        let open = 0;
        let resolved = 0;
        let closed = 0;
        let unread = 0;
        for (const record of records) {
            const status = Number(record.status);
            if (status === SUPPORT_TICKET_STATUS.RESOLVED) resolved += 1;
            else if (status === SUPPORT_TICKET_STATUS.CLOSED) closed += 1;
            else open += 1;
            // Admins: only open tickets. Members: open + resolved (admin handled it).
            // Closed never contributes to the nav badge.
            const countsAsUnread = isAdmin
                ? (status === SUPPORT_TICKET_STATUS.OPEN && !!record.unreadForAdmin)
                : (!!record.unreadForUser && (
                    status === SUPPORT_TICKET_STATUS.OPEN
                    || status === SUPPORT_TICKET_STATUS.RESOLVED
                ));
            if (countsAsUnread) unread += 1;
        }
        return { open, resolved, closed, unread, total: records.length };
    };

    const getTicket = async (ticketId) => {
        const record = await store.get(ticketId);
        if (!record) {
            const err = new Error('Ticket not found');
            err.status = 404;
            throw err;
        }
        return { record, dto: await enrich(record) };
    };

    const assertCanAccess = async (user, ticketId, { isAdmin = false } = {}) => {
        const { record, dto } = await getTicket(ticketId);
        const viewerId = String(user?.id || '');
        if (!isAdmin && (!viewerId || String(record.userId) !== viewerId)) {
            const err = new Error('You can only view your own tickets.');
            err.status = 403;
            throw err;
        }
        return { record, dto };
    };

    const findTicketForIssue = async (issueId, engine = 'portal') => {
        const key = String(issueId || '').trim();
        if (!key) return null;
        const records = await store.list({});
        const hit = records.find((record) => (
            String(record?.meta?.linkedIssueId) === key
            && String(record?.meta?.issueEngine || 'portal') === String(engine || 'portal')
            && Number(record.status) !== SUPPORT_TICKET_STATUS.CLOSED
        ));
        return hit ? enrich(hit) : null;
    };

    const listLinkedIssueTicketIds = async () => {
        const records = await store.list({ category: 'media' });
        const map = {};
        for (const record of records) {
            const issueId = record?.meta?.linkedIssueId;
            if (issueId == null || issueId === '') continue;
            const engine = String(record.meta?.issueEngine || 'portal');
            map[`${engine}:${issueId}`] = Number(record.id);
        }
        return map;
    };

    const markRead = async (ticketId, { isAdmin = false } = {}) => {
        const record = await store.get(ticketId);
        if (!record) return null;
        const patch = isAdmin ? { unreadForAdmin: false } : { unreadForUser: false };
        const updated = await store.update(ticketId, patch);
        return enrich(updated);
    };

    const addComment = async (ticketId, message, actor = null, { isAdmin = false, attachments: rawAttachments = [] } = {}) => {
        const record = await store.get(ticketId);
        if (!record) {
            const err = new Error('Ticket not found');
            err.status = 404;
            throw err;
        }
        if (Number(record.status) === SUPPORT_TICKET_STATUS.CLOSED) {
            const err = new Error('This ticket is closed.');
            err.status = 400;
            throw err;
        }
        const attachments = await assertAttachmentsExist(dataDir, ticketId, rawAttachments);
        const text = normalizeMessage(message, { min: attachments.length > 0 ? 0 : 1 });
        if (!text && attachments.length === 0) {
            const err = new Error('Message is required');
            err.status = 400;
            throw err;
        }
        const now = new Date().toISOString();
        const comments = Array.isArray(record.comments) ? [...record.comments] : [];
        const nextId = comments.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0) + 1;
        comments.push({
            id: nextId,
            message: text,
            createdAt: now,
            userId: String(actor?.id || ''),
            displayName: actor?.username || actor?.email || (isAdmin ? 'Admin' : 'Member'),
            avatar: actor?.thumb || actor?.avatar || '',
            isAdmin,
            reactions: {},
            attachments,
        });
        const updated = await store.update(ticketId, {
            comments,
            status: Number(record.status) === SUPPORT_TICKET_STATUS.RESOLVED && !isAdmin
                ? SUPPORT_TICKET_STATUS.OPEN
                : record.status,
            unreadForAdmin: !isAdmin,
            unreadForUser: !!isAdmin,
        });
        return enrich(updated);
    };

    const attachToComment = async (ticketId, commentId, rawAttachments = []) => {
        const record = await store.get(ticketId);
        if (!record) {
            const err = new Error('Ticket not found');
            err.status = 404;
            throw err;
        }
        const comments = Array.isArray(record.comments) ? [...record.comments] : [];
        const index = comments.findIndex((c) => Number(c.id) === Number(commentId));
        if (index < 0) {
            const err = new Error('Message not found');
            err.status = 404;
            throw err;
        }
        const existing = mapAttachmentsForTicket(comments[index].attachments, ticketId);
        const incoming = await assertAttachmentsExist(dataDir, ticketId, rawAttachments);
        const byId = new Map(existing.map((item) => [item.id, item]));
        for (const item of incoming) byId.set(item.id, item);
        const attachments = Array.from(byId.values()).slice(0, SUPPORT_ATTACHMENT_MAX_PER_MESSAGE);
        comments[index] = { ...comments[index], attachments };
        const updated = await store.update(ticketId, { comments });
        return enrich(updated);
    };

    const editComment = async (ticketId, commentId, message, actor = null, { isAdmin = false } = {}) => {
        const record = await store.get(ticketId);
        if (!record) {
            const err = new Error('Ticket not found');
            err.status = 404;
            throw err;
        }
        const comments = Array.isArray(record.comments) ? [...record.comments] : [];
        const index = comments.findIndex((comment) => Number(comment.id) === Number(commentId));
        if (index < 0) {
            const err = new Error('Message not found');
            err.status = 404;
            throw err;
        }
        const existing = comments[index];
        const isAuthor = String(existing.userId) === String(actor?.id || '');
        if (!isAuthor && !isAdmin) {
            const err = new Error('You can only edit your own messages.');
            err.status = 403;
            throw err;
        }
        comments[index] = {
            ...existing,
            message: normalizeMessage(message, { min: 1 }),
            editedAt: new Date().toISOString(),
        };
        const updated = await store.update(ticketId, { comments });
        return enrich(updated);
    };

    const toggleReaction = async (ticketId, commentId, emoji, actor = null) => {
        const record = await store.get(ticketId);
        if (!record) {
            const err = new Error('Ticket not found');
            err.status = 404;
            throw err;
        }
        const allowed = assertAllowedEmoji(emoji);
        const actorId = String(actor?.id || '').trim();
        if (!actorId) {
            const err = new Error('You must be signed in to react.');
            err.status = 401;
            throw err;
        }
        const comments = Array.isArray(record.comments) ? [...record.comments] : [];
        const index = comments.findIndex((comment) => Number(comment.id) === Number(commentId));
        if (index < 0) {
            const err = new Error('Message not found');
            err.status = 404;
            throw err;
        }
        const existing = comments[index];
        const reactions = existing.reactions && typeof existing.reactions === 'object'
            ? { ...existing.reactions }
            : {};
        const current = Array.isArray(reactions[allowed]) ? reactions[allowed].map(String) : [];
        const next = current.includes(actorId)
            ? current.filter((id) => id !== actorId)
            : [...current, actorId];
        if (next.length) reactions[allowed] = next;
        else delete reactions[allowed];
        comments[index] = { ...existing, reactions };
        const updated = await store.update(ticketId, { comments });
        return enrich(updated);
    };

    const updateStatus = async (ticketId, status, { isAdmin = false } = {}) => {
        const record = await store.get(ticketId);
        if (!record) {
            const err = new Error('Ticket not found');
            err.status = 404;
            throw err;
        }
        const nextStatus = parseSupportStatus(status);
        let unreadForUser = false;
        let unreadForAdmin = false;
        if (nextStatus === SUPPORT_TICKET_STATUS.OPEN) {
            // Member reopen → alert admins; admin reopen clears admin unread.
            unreadForUser = false;
            unreadForAdmin = !isAdmin;
        } else if (nextStatus === SUPPORT_TICKET_STATUS.RESOLVED) {
            // Admin resolve → member unread cue; never leave admin badge.
            unreadForAdmin = false;
            unreadForUser = !!isAdmin;
        } else {
            // Closed is fully done — never keep a badge for either side.
            unreadForUser = false;
            unreadForAdmin = false;
        }
        const updated = await store.update(ticketId, {
            status: nextStatus,
            unreadForUser,
            unreadForAdmin,
        });
        return enrich(updated);
    };

    const deleteTicket = async (ticketId) => {
        const removed = await store.remove(ticketId);
        if (!removed) {
            const err = new Error('Ticket not found');
            err.status = 404;
            throw err;
        }
        await deleteSupportTicketAttachments(dataDir, ticketId);
        return true;
    };

    return {
        store,
        createTicket,
        listTickets,
        getCounts,
        getTicket,
        assertCanAccess,
        findTicketForIssue,
        listLinkedIssueTicketIds,
        markRead,
        addComment,
        attachToComment,
        editComment,
        toggleReaction,
        updateStatus,
        deleteTicket,
    };
};

export default createSupportTicketService;
