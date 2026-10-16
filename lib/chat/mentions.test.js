import assert from 'node:assert/strict';
import { parseMentionUsernames, resolveMentions } from './mentions.js';

const users = [
    { id: '1', username: 'Vik' },
    { id: '2', username: 'jason' },
];

assert.deepEqual(parseMentionUsernames('hey @Vik and @jason!'), ['vik', 'jason']);
assert.deepEqual(resolveMentions('cc @Vik please look', users), [
    { userId: '1', username: 'Vik' },
]);
assert.deepEqual(resolveMentions('@unknown @jason', users), [
    { userId: '2', username: 'jason' },
]);

console.log('chat mentions ok');
