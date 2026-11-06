import assert from 'node:assert/strict';
import test from 'node:test';
import {
    decodeDirectInvite,
    encodeDirectInvite,
    looksLikeDirectInvite,
    normalizeInviteText,
} from './watchTogetherInvite.ts';

const ROOM = 'K7M3QXR9';

test('a room reachable on the local network and the internet round-trips', () => {
    const text = encodeDirectInvite({ code: ROOM, port: 47653, lan: '192.168.1.24', publicIp: '81.2.69.142' });
    assert.ok(text);
    assert.match(text, /^[A-Z2-9]{5}(-[A-Z2-9]{1,5})+$/);
    assert.deepEqual(decodeDirectInvite(text), {
        code: ROOM,
        port: 47653,
        lan: '192.168.1.24',
        publicIp: '81.2.69.142',
        publicPort: 47653,
    });
});

test('a different router port is carried too', () => {
    const text = encodeDirectInvite({ code: ROOM, port: 47653, lan: '10.0.0.5', publicIp: '203.0.113.9', publicPort: 51000 });
    assert.equal(decodeDirectInvite(text)?.publicPort, 51000);
    assert.equal(decodeDirectInvite(text)?.port, 47653);
});

test('local-network-only and internet-only invites work and are shorter', () => {
    const lanOnly = encodeDirectInvite({ code: ROOM, port: 40000, lan: '192.168.0.2' });
    const both = encodeDirectInvite({ code: ROOM, port: 40000, lan: '192.168.0.2', publicIp: '8.8.4.4' });
    assert.deepEqual(decodeDirectInvite(lanOnly), { code: ROOM, port: 40000, lan: '192.168.0.2' });
    assert.ok(lanOnly.replace(/-/g, '').length < both.replace(/-/g, '').length);
    const pubOnly = decodeDirectInvite(encodeDirectInvite({ code: ROOM, port: 40000, publicIp: '8.8.4.4' }));
    assert.equal(pubOnly.lan, undefined);
    assert.equal(pubOnly.publicIp, '8.8.4.4');
});

test('case, dashes and spaces do not matter when typing', () => {
    const text = encodeDirectInvite({ code: ROOM, port: 47653, lan: '192.168.1.24', publicIp: '81.2.69.142' });
    const sloppy = text.toLowerCase().replace(/-/g, '  ');
    assert.deepEqual(decodeDirectInvite(sloppy), decodeDirectInvite(text));
});

test('a mistyped character is caught, not connected to the wrong place', () => {
    const text = encodeDirectInvite({ code: ROOM, port: 47653, lan: '192.168.1.24', publicIp: '81.2.69.142' });
    const plain = normalizeInviteText(text);
    let caught = 0;
    for (let i = 0; i < plain.length - 1; i += 1) {
        const swap = plain[i] === 'A' ? 'B' : 'A';
        if (decodeDirectInvite(plain.slice(0, i) + swap + plain.slice(i + 1)) === null) caught += 1;
    }
    // Every single-character slip in the body fails the check.
    assert.equal(caught, plain.length - 1);
});

test('short relay codes and nonsense are not hosted-room invites', () => {
    assert.equal(decodeDirectInvite('ABC234'), null);
    assert.equal(looksLikeDirectInvite('ABC234'), false);
    assert.equal(decodeDirectInvite('AAAAAAAAAAAAAAAAAAAAAAAA'), null);
    assert.equal(looksLikeDirectInvite('AAAAAAAAAAAAAAAAAAAAAAAA'), true);
    assert.equal(decodeDirectInvite(''), null);
    assert.equal(decodeDirectInvite('0O1I-0O1I-0O1I-0O1I-0O1I'), null);
});

test('invalid inputs do not encode', () => {
    assert.equal(encodeDirectInvite({ code: 'SHORT', port: 1000, lan: '10.0.0.1' }), null);
    assert.equal(encodeDirectInvite({ code: ROOM, port: 0, lan: '10.0.0.1' }), null);
    assert.equal(encodeDirectInvite({ code: ROOM, port: 1000 }), null);
    assert.equal(encodeDirectInvite({ code: ROOM, port: 1000, lan: '300.1.1.1' }), null);
});
