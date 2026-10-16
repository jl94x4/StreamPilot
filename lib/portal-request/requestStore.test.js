import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJsonRequestStore } from './requestStore.js';

const tmpDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'request-store-'));
    return dir;
};

test('requestStore updateIf applies only when predicate matches', async () => {
    const dir = await tmpDir();
    const store = createJsonRequestStore({ dataDir: dir });
    const created = await store.create({
        userId: 'u1',
        mediaType: 'movie',
        tmdbId: 42,
        title: 'Demo',
        status: 2,
        meta: { arrPushPending: true, arrPushGeneration: 'gen-1' },
    });

    const skipped = await store.updateIf(
        created.id,
        (row) => row.meta?.arrPushGeneration === 'other',
        { status: 4 },
    );
    assert.equal(skipped.ok, false);
    assert.equal(Number((await store.get(created.id)).status), 2);

    const applied = await store.updateIf(
        created.id,
        (row) => row.meta?.arrPushGeneration === 'gen-1' && row.meta?.arrPushPending,
        (row) => ({
            status: 2,
            meta: { ...row.meta, arrPushPending: false },
        }),
    );
    assert.equal(applied.ok, true);
    assert.equal(applied.record.meta.arrPushPending, false);
});
