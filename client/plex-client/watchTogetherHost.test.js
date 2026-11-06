import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';

// The host code expects a browser; Node has the pieces it uses on globalThis.
globalThis.window = globalThis;

const { __setHostPluginForTests, getInAppHost, startInAppHost, stopInAppHost } = await import('./watchTogetherHost.ts');

/**
 * A stand-in for the native plugin: real sockets, same accept/reject contract. Peers say where
 * they "come from" with an x-test-remote header (every test connection really is 127.0.0.1).
 */
const makeFakePlugin = (mapResult) => {
    const listeners = new Map();
    const pending = new Map();
    const sockets = new Map();
    let server;
    let wss;
    let nextId = 1;
    const emit = (name, event) => (listeners.get(name) || []).forEach((handler) => handler(event));
    return {
        start: async () => {
            wss = new WebSocketServer({ noServer: true });
            server = http.createServer();
            server.on('upgrade', (req, socket, head) => {
                const connId = `c${nextId++}`;
                pending.set(connId, { req, socket, head });
                const remote = String(req.headers['x-test-remote'] || req.socket.remoteAddress || '').replace('::ffff:', '');
                const query = new URL(req.url, 'http://x').search.slice(1);
                // The native layer calls the web layer, which answers later: do the same.
                emit('hostConnect', { connId, query, remote, local: remote === '127.0.0.1' });
            });
            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            return { port: server.address().port, lan: '192.168.1.50', lanIps: ['192.168.1.50'] };
        },
        stop: async () => {
            sockets.forEach((ws) => ws.terminate());
            await new Promise((resolve) => server.close(resolve));
        },
        accept: async ({ connId }) => {
            const row = pending.get(connId);
            pending.delete(connId);
            wss.handleUpgrade(row.req, row.socket, row.head, (ws) => {
                sockets.set(connId, ws);
                ws.on('message', (data) => emit('hostMessage', { connId, data: String(data) }));
                ws.on('close', () => {
                    sockets.delete(connId);
                    emit('hostClosed', { connId });
                });
            });
        },
        reject: async ({ connId, status }) => {
            const row = pending.get(connId);
            pending.delete(connId);
            row.socket.write(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`);
            row.socket.destroy();
        },
        send: async ({ connId, data }) => { sockets.get(connId)?.send(data); },
        close: async ({ connId }) => { sockets.get(connId)?.close(); },
        mapPort: async () => mapResult,
        unmapPort: async () => undefined,
        addListener: async (name, handler) => {
            listeners.set(name, [...(listeners.get(name) || []), handler]);
            return { remove: async () => { listeners.set(name, (listeners.get(name) || []).filter((h) => h !== handler)); } };
        },
    };
};

const open = (url, remote = '127.0.0.1') => new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { 'x-test-remote': remote } });
    const inbox = [];
    ws.on('message', (data) => inbox.push(JSON.parse(String(data))));
    ws.on('open', () => resolve({ ws, inbox }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
    ws.on('error', () => resolve({ status: -1 }));
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

test('hosting on a device: the host, an invited guest, strangers and the end of the room', async () => {
    const plugin = makeFakePlugin({
        ok: false, externalIp: '', externalPort: 0, publicAddress: false, reason: 'No router answered.',
    });
    __setHostPluginForTests(plugin);
    const info = await startInAppHost();
    assert.equal(getInAppHost(), info);
    assert.equal(info.lan, '192.168.1.50');
    assert.equal(info.publicReachable, false);
    assert.match(info.reason, /No router/);
    assert.ok(info.hostKey.length >= 32);
    const base = `ws://127.0.0.1:${info.port}/wt`;

    // The host's own connection needs the key only this device knows.
    assert.equal((await open(`${base}?k=wrong&n=Ann`)).status, 403);
    assert.equal((await open(`${base}?n=Ann`)).status, 403);
    const host = await open(`${base}?k=${info.hostKey}&n=Ann&u=ann`);
    assert.ok(host.ws);
    const hello = await until(() => last(host.inbox, 'wt_hello'));
    assert.match(hello.userId, /^host:/);
    host.ws.send(JSON.stringify({ type: 'wt_create', ratingKey: '77', title: 'Film', codeLength: 8, guids: ['tmdb://9'] }));
    const created = await until(() => last(host.inbox, 'wt_state'));
    const code = created.inviteCode;
    assert.equal(code.length, 8);

    // A stranger with no code, a wrong code, or the host key from outside is refused.
    const outside = '203.0.113.7';
    assert.equal((await open(`${base}?n=Eve`, outside)).status, 403);
    assert.equal((await open(`${base}?c=AAAAAAAA&n=Eve`, outside)).status, 403);
    assert.equal((await open(`${base}?k=${info.hostKey}&n=Eve`, outside)).status, 403);

    // An invited guest gets in, joins, and the two stay in step.
    const guest = await open(`${base}?c=${code}&n=Bo&u=bo`, outside);
    assert.ok(guest.ws);
    const guestHello = await until(() => last(guest.inbox, 'wt_hello'));
    assert.match(guestHello.userId, /^guest:bo:/);
    guest.ws.send(JSON.stringify({ type: 'wt_join', inviteCode: code }));
    const joined = await until(() => last(guest.inbox, 'wt_state'));
    assert.equal(joined.title, 'Film');
    assert.deepEqual(joined.guids, ['tmdb://9']);
    assert.deepEqual(joined.participants.map((p) => p.displayName).sort(), ['Ann', 'Bo']);
    assert.equal((await until(() => last(host.inbox, 'wt_joined'))).displayName, 'Bo');

    guest.ws.send(JSON.stringify({ type: 'wt_play', positionMs: 12000 }));
    const hostSaw = await until(() => {
        const state = last(host.inbox, 'wt_state');
        return state?.playing ? state : null;
    });
    assert.ok(hostSaw.positionMs >= 12000);

    // A guest cannot pose as the host to take over: ids are per connection, hosts are never guests.
    const twin = await open(`${base}?c=${code}&n=Fake&u=ann`, outside);
    twin.ws.send(JSON.stringify({ type: 'wt_join', inviteCode: code }));
    const afterTwin = await until(() => last(twin.inbox, 'wt_state'));
    assert.equal(afterTwin.hostUserId, joined.hostUserId);
    twin.ws.close();

    // Hammering with wrong codes is cut off (429) for that address, while others are unaffected.
    for (let i = 0; i < 6; i += 1) await open(`${base}?c=ZZZZZZZZ&n=Eve`, '198.51.100.9');
    assert.equal((await open(`${base}?c=${code}&n=Eve`, '198.51.100.9')).status, 429);
    assert.ok((await open(`${base}?c=${code}&n=Cy`, '192.0.2.44')).ws);

    // Stopping tells everyone the room is over.
    await stopInAppHost();
    assert.ok(await until(() => last(guest.inbox, 'wt_ended')));
    assert.ok(await until(() => last(host.inbox, 'wt_ended')));
    assert.equal(getInAppHost(), null);
});

test('when the router opens a port and has a public address, outside access is reported', async () => {
    __setHostPluginForTests(makeFakePlugin({
        ok: true, externalIp: '81.2.69.142', externalPort: 47653, publicAddress: true, reason: '',
    }));
    const info = await startInAppHost();
    assert.equal(info.publicReachable, true);
    assert.equal(info.publicIp, '81.2.69.142');
    assert.equal(info.publicPort, 47653);
    assert.equal(info.reason, '');
    await stopInAppHost();
});

test('a router that opens a port but sits behind another router is not called reachable', async () => {
    __setHostPluginForTests(makeFakePlugin({
        ok: true, externalIp: '100.72.4.9', externalPort: 47653, publicAddress: false,
        reason: 'The router\'s address (100.72.4.9) is not a public one, so it is behind another router or carrier-grade NAT.',
    }));
    const info = await startInAppHost();
    assert.equal(info.publicReachable, false);
    assert.equal(info.publicIp, '');
    assert.match(info.reason, /carrier-grade NAT/);
    await stopInAppHost();
});
