import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { attachWatchTogether } from './index.js';

const SECRET = 'test-secret';

const start = async () => {
    const server = http.createServer();
    attachWatchTogether(server, { jwtSecret: SECRET });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, port: server.address().port };
};

const open = (port, user) => new Promise((resolve) => {
    const token = jwt.sign({ plexId: user, username: user }, SECRET);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/watch-together/ws?access_token=${token}`);
    const inbox = [];
    ws.on('message', (data) => inbox.push(JSON.parse(String(data))));
    ws.on('open', () => resolve({ ws, inbox }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
});

const until = async (predicate, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = predicate();
        if (value) return value;
        await new Promise((r) => setTimeout(r, 15));
    }
    return predicate();
};
const last = (inbox, type) => [...inbox].reverse().find((row) => row.type === type) || null;

test('the relay still creates rooms with six-letter codes and syncs two people', async () => {
    const { server, port } = await start();
    const a = await open(port, 'ann');
    const b = await open(port, 'bo');
    assert.equal((await until(() => last(a.inbox, 'wt_hello'))).userId, 'portal:ann');
    a.ws.send(JSON.stringify({ type: 'wt_create', ratingKey: '5', title: 'Film' }));
    const created = await until(() => last(a.inbox, 'wt_state'));
    assert.equal(created.inviteCode.length, 6);
    b.ws.send(JSON.stringify({ type: 'wt_join', inviteCode: created.inviteCode }));
    assert.equal((await until(() => last(b.inbox, 'wt_state'))).participants.length, 2);
    b.ws.send(JSON.stringify({ type: 'wt_play', positionMs: 4000 }));
    assert.ok(await until(() => {
        const state = last(a.inbox, 'wt_state');
        return state?.playing ? state : null;
    }));
    a.ws.close();
    b.ws.close();
    server.close();
    server.closeAllConnections?.();
});

test('the relay refuses a connection without a valid login', async () => {
    const { server, port } = await start();
    const result = await new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/watch-together/ws?access_token=not-a-token`);
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
        ws.on('open', () => resolve('open'));
        ws.on('error', () => resolve('error'));
    });
    assert.equal(result, 401);
    server.close();
    server.closeAllConnections?.();
});
