import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImportedLog } from './import.js';

test('normalizeImportedLog accepts upstream overlaid_log shape', () => {
    const { log, imported, skipped } = normalizeImportedLog({
        '12345': {
            title: 'Example Show',
            timestamp: '2025-01-15T14:30:00',
            preview_only: false,
        },
        bad: { title: 'nope' },
    });
    assert.equal(imported, 1);
    assert.equal(skipped, 1);
    assert.equal(log['12345'].title, 'Example Show');
    assert.equal(log['12345'].preview_only, false);
});

test('normalizeImportedLog rejects arrays', () => {
    assert.throws(() => normalizeImportedLog([]), /JSON object/);
});
