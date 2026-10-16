import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChatService } from './service.js';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-chat-'));

const service = createChatService({ dataDir: tmpDir });

const admin = { id: 'admin-1', username: 'Admin', isAdmin: true };
const member = { id: 'user-1', username: 'Vik', isAdmin: false };

const general = await service.createRoom(admin, { name: 'general', description: 'Main room' });
assert.equal(general.name, 'general');

const rooms = await service.listRooms({ userId: member.id });
assert.equal(rooms.length, 1);

const posted = await service.postMessage(member, general.id, { message: 'Hello everyone' });
assert.equal(posted.message, 'Hello everyone');

const messages = await service.getMessages(general.id);
assert.equal(messages.length, 1);

await assert.rejects(
    () => service.createRoom(member, { name: 'secret' }),
    (error) => error?.status === 403,
);

const ops = await service.createRoom(admin, { name: 'ops' });
const before = await service.listRooms({ userId: admin.id });
const reversed = [...before.map((room) => room.id)].reverse();
await service.reorderRooms(admin, reversed);
const after = await service.listRooms({ userId: admin.id });
assert.deepEqual(after.map((room) => room.id), reversed);

await assert.rejects(
    () => service.reorderRooms(member, reversed),
    (error) => error?.status === 403,
);

await fs.rm(tmpDir, { recursive: true, force: true });
console.log('chat service ok');
