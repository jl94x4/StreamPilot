/**
 * Daily backups of the Poster Sets "Watching" list, plus restore.
 * One file per day (watches-YYYY-MM-DD.json), the last KEEP_DAYS kept. A safety copy of the
 * current list is taken before every restore so a restore can itself be undone.
 */
import path from 'path';
import fs from 'fs/promises';
import { ensurePosterSetsDir, POSTER_SETS_DIR } from './config.js';
import { loadPosterSetsWatches, updatePosterSetsWatches } from './watches.js';

export const WATCH_BACKUP_DIR = path.join(POSTER_SETS_DIR, 'watch-backups');
const KEEP_DAYS = 14;
const KEEP_SAFETY = 5;
const DAILY_RE = /^watches-(\d{4}-\d{2}-\d{2})\.json$/;
const SAFETY_RE = /^watches-before-restore-(\d{8}T\d{6}Z)\.json$/;

const dayStamp = (date = new Date()) => date.toISOString().slice(0, 10);

const writeBackup = async (name, watches) => {
    await fs.mkdir(WATCH_BACKUP_DIR, { recursive: true });
    const file = path.join(WATCH_BACKUP_DIR, name);
    const body = `${JSON.stringify({ version: 1, savedAt: new Date().toISOString(), watches })}\n`;
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, file);
};

const readBackupFile = async (name) => {
    const raw = await fs.readFile(path.join(WATCH_BACKUP_DIR, name), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.watches) ? parsed.watches : [];
};

const prune = async () => {
    let names = [];
    try { names = await fs.readdir(WATCH_BACKUP_DIR); } catch { return; }
    const daily = names.filter((n) => DAILY_RE.test(n)).sort().reverse();
    const safety = names.filter((n) => SAFETY_RE.test(n)).sort().reverse();
    for (const name of [...daily.slice(KEEP_DAYS), ...safety.slice(KEEP_SAFETY)]) {
        await fs.unlink(path.join(WATCH_BACKUP_DIR, name)).catch(() => undefined);
    }
};

/** Writes today's backup once. An empty list never creates one, so a wipe cannot become "the backup". */
export const backupWatchesIfDue = async () => {
    await ensurePosterSetsDir();
    const name = `watches-${dayStamp()}.json`;
    try {
        await fs.access(path.join(WATCH_BACKUP_DIR, name));
        return { created: false, name };
    } catch { /* not there yet */ }
    const { watches } = await loadPosterSetsWatches();
    if (!watches.length) return { created: false, name, empty: true };
    await writeBackup(name, watches);
    await prune();
    return { created: true, name, count: watches.length };
};

export const backupWatchesNow = async () => {
    const { watches } = await loadPosterSetsWatches();
    if (!watches.length) return { created: false, empty: true };
    const name = `watches-${dayStamp()}.json`;
    await writeBackup(name, watches);
    await prune();
    return { created: true, name, count: watches.length };
};

export const listWatchBackups = async () => {
    let names = [];
    try { names = await fs.readdir(WATCH_BACKUP_DIR); } catch { return []; }
    const out = [];
    for (const name of names) {
        const daily = name.match(DAILY_RE);
        const safety = name.match(SAFETY_RE);
        if (!daily && !safety) continue;
        try {
            const stat = await fs.stat(path.join(WATCH_BACKUP_DIR, name));
            const watches = await readBackupFile(name);
            out.push({
                name,
                kind: daily ? 'daily' : 'before-restore',
                date: daily ? daily[1] : null,
                savedAt: stat.mtime.toISOString(),
                count: watches.length,
            });
        } catch { /* unreadable backup: skip */ }
    }
    return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
};

export const restoreWatchBackup = async (name) => {
    const safeName = path.basename(String(name || ''));
    if (!DAILY_RE.test(safeName) && !SAFETY_RE.test(safeName)) {
        const error = new Error('Unknown backup');
        error.status = 400;
        throw error;
    }
    let watches;
    try {
        watches = await readBackupFile(safeName);
    } catch {
        const error = new Error('Backup not found or unreadable');
        error.status = 404;
        throw error;
    }
    if (!watches.length) {
        const error = new Error('That backup is empty');
        error.status = 400;
        throw error;
    }
    const current = await loadPosterSetsWatches();
    if (current.watches.length) {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
        await writeBackup(`watches-before-restore-${stamp}.json`, current.watches);
    }
    await updatePosterSetsWatches(() => ({ version: 1, watches }));
    await prune();
    const after = await loadPosterSetsWatches();
    return { restored: after.watches.length, previous: current.watches.length };
};

let timer = null;
export const startWatchBackups = () => {
    if (timer) return;
    const tick = () => { void backupWatchesIfDue().catch(() => undefined); };
    setTimeout(tick, 60_000).unref?.();
    timer = setInterval(tick, 60 * 60 * 1000);
    timer.unref?.();
};
