import assert from 'node:assert/strict';
import { workerContextSignature } from './collexions-embedded.js';

const base = {
    configDir: '/data',
    serviceKey: 'abc',
    autostart: true,
    clientId: 'portal-1',
};

assert.equal(workerContextSignature(base), workerContextSignature({ ...base }));
assert.notEqual(
    workerContextSignature(base),
    workerContextSignature({ ...base, autostart: false }),
);
assert.notEqual(
    workerContextSignature(base),
    workerContextSignature({ ...base, serviceKey: 'other' }),
);

console.log('collexions embedded context ok');
