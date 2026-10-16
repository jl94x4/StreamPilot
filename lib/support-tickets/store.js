/**
 * JSON support-ticket store under config/support-tickets/.
 * Same locking / atomic-write pattern as portal issues.
 */

import fs from 'fs/promises';
import path from 'path';
import { SUPPORT_TICKET_STATUS } from './constants.js';

const INDEX_FILE = 'index.json';

const defaultIndex = () => ({
    version: 1,
    nextId: 1,
    ids: [],
});

export const createSupportTicketStore = (options = {}) => {
    const dataDir = String(options.dataDir || '').trim();
    if (!dataDir) {
        throw new Error('[support-tickets] dataDir is required');
    }

    let chain = Promise.resolve();
    const withLock = (fn) => {
        const run = chain.then(fn, fn);
        chain = run.catch(() => {});
        return run;
    };

    const indexPath = () => path.join(dataDir, INDEX_FILE);
    const recordPath = (id) => path.join(dataDir, `${id}.json`);

    const ensureDir = async () => {
        await fs.mkdir(dataDir, { recursive: true });
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
        await ensureDir();
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
            nextId: Math.max(1, Number(index.nextId) || 1),
            ids: Array.isArray(index.ids) ? index.ids.map(String) : [],
        };
    };

    const saveIndex = async (index) => writeJsonAtomic(indexPath(), index);

    const readRecord = async (id) => {
        const record = await readJson(recordPath(id), null);
        return record && typeof record === 'object' ? record : null;
    };

    const list = async (opts = {}) => withLock(async () => {
        const index = await loadIndex();
        const records = [];
        for (const id of index.ids) {
            const record = await readRecord(id);
            if (!record) continue;
            if (opts.userId != null && String(record.userId) !== String(opts.userId)) continue;
            if (opts.status != null && Number(record.status) !== Number(opts.status)) continue;
            if (opts.category && String(record.category) !== String(opts.category)) continue;
            records.push(record);
        }
        records.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
        return records;
    });

    const get = async (id) => withLock(async () => {
        const key = String(id || '').trim();
        if (!key) return null;
        return readRecord(key);
    });

    const create = async (partial = {}) => withLock(async () => {
        const index = await loadIndex();
        const id = String(index.nextId);
        const now = new Date().toISOString();
        const comments = Array.isArray(partial.comments) ? partial.comments : [];
        const record = {
            id,
            userId: String(partial.userId || ''),
            subject: String(partial.subject || '').trim().slice(0, 160),
            category: String(partial.category || 'other'),
            status: Number.isFinite(Number(partial.status)) ? Number(partial.status) : SUPPORT_TICKET_STATUS.OPEN,
            comments,
            unreadForUser: !!partial.unreadForUser,
            unreadForAdmin: partial.unreadForAdmin !== false,
            createdAt: now,
            updatedAt: now,
            meta: partial.meta && typeof partial.meta === 'object' ? partial.meta : {},
        };

        if (!record.userId) {
            const err = new Error('userId is required');
            err.status = 400;
            throw err;
        }
        if (!record.subject) {
            const err = new Error('Subject is required');
            err.status = 400;
            throw err;
        }

        await writeJsonAtomic(recordPath(id), record);
        index.ids.push(id);
        index.nextId = Number(id) + 1;
        await saveIndex(index);
        return record;
    });

    const update = async (id, patch = {}) => withLock(async () => {
        const key = String(id || '').trim();
        const existing = await readRecord(key);
        if (!existing) return null;
        const next = {
            ...existing,
            ...patch,
            id: existing.id,
            userId: patch.userId != null && String(patch.userId).trim()
                ? String(patch.userId)
                : existing.userId,
            updatedAt: new Date().toISOString(),
        };
        await writeJsonAtomic(recordPath(key), next);
        return next;
    });

    const remove = async (id) => withLock(async () => {
        const key = String(id || '').trim();
        const index = await loadIndex();
        if (!index.ids.includes(key)) return false;
        try {
            await fs.unlink(recordPath(key));
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        index.ids = index.ids.filter((entry) => entry !== key);
        await saveIndex(index);
        return true;
    });

    return {
        list,
        get,
        create,
        update,
        remove,
        dataDir,
    };
};

export default createSupportTicketStore;
