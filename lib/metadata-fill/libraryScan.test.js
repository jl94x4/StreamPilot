import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    _resetLibraryScanForTests,
    cancelLibraryScan,
    getLibraryScanStatus,
    startLibraryScan,
} from './libraryScan.js';
import { writeLibraryScanState } from './store.js';

test('cancel stops an in-process scan and is not clobbered by progress writes', async () => {
    const prev = process.cwd();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mf-scan-'));
    process.chdir(tmp);
    _resetLibraryScanForTests();
    try {
        await writeLibraryScanState({
            status: 'running',
            dryRun: true,
            cancelRequested: false,
            cursor: { libraryIndex: 0, showStart: 0, showRatingKey: null, episodeIndex: 0 },
            stats: { scanned: 0, needingFill: 0, previewed: 0, filled: 0, skipped: 0, failed: 0 },
            preview: [],
            libraries: [{ key: '1', title: 'TV' }],
            selectedLibraryKeys: ['1'],
            startedAt: new Date().toISOString(),
            finishedAt: null,
            error: null,
        });

        let releases = 0;
        const fetchImpl = async (url) => {
            const href = String(url || '');
            // Hold the first library listing so cancel can land mid-scan.
            if (href.includes('/library/sections/') && releases < 1) {
                releases += 1;
                await new Promise((r) => setTimeout(r, 150));
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    MediaContainer: {
                        size: 0,
                        totalSize: 0,
                        Metadata: [],
                        Directory: [],
                    },
                }),
                text: async () => '',
            };
        };

        const started = await startLibraryScan({
            config: {},
            baseUrl: 'http://127.0.0.1:32400',
            token: 'x',
            dryRun: true,
            resume: true,
            fetchImpl,
        });
        assert.equal(started.ok, true);

        const cancelled = await cancelLibraryScan();
        assert.equal(cancelled.cancelRequested, true);

        for (let i = 0; i < 80; i += 1) {
            const status = await getLibraryScanStatus();
            if (!status.inProcess && status.status === 'cancelled') break;
            await new Promise((r) => setTimeout(r, 25));
        }

        const status = await getLibraryScanStatus();
        assert.equal(status.inProcess, false);
        assert.equal(status.status, 'cancelled');
        assert.equal(!!status.cancelRequested, true);
    } finally {
        _resetLibraryScanForTests();
        process.chdir(prev);
        await fs.rm(tmp, { recursive: true, force: true });
    }
});
