import assert from 'node:assert/strict';
import test from 'node:test';
import {
    attachParticipant,
    detachParticipant,
    handleParticipantMessage,
    reapEmptyRooms,
    watchTogetherRoomExists,
} from './engine.js';

/** A fake connection that records what the engine sends it. */
const fakeSocket = () => {
    const sent = [];
    return {
        readyState: 1,
        sent,
        send: (data) => sent.push(JSON.parse(data)),
        close() { this.readyState = 3; },
        last: (type) => [...sent].reverse().find((row) => row.type === type) || null,
    };
};

const connect = (id, name) => {
    const socket = fakeSocket();
    const participant = attachParticipant(socket, { id, displayName: name, thumb: null, auth: 'plex' });
    return { socket, participant };
};

const say = (who, message) => handleParticipantMessage(who.participant, JSON.stringify(message));

test('a new connection is greeted with its client id', () => {
    const a = connect('plex:1', 'Ann');
    const hello = a.socket.last('wt_hello');
    assert.equal(hello.userId, 'plex:1');
    assert.ok(hello.clientId);
    detachParticipant(a.participant);
});

test('direct (in-app host) rooms can ask for a longer invite code; the default stays six', () => {
    const a = connect('plex:1', 'Ann');
    say(a, { type: 'wt_create', ratingKey: '10', title: 'Film', codeLength: 8 });
    const long = a.socket.last('wt_state');
    assert.equal(long.inviteCode.length, 8);
    assert.ok(watchTogetherRoomExists(long.inviteCode));

    const b = connect('plex:2', 'Bo');
    say(b, { type: 'wt_create', ratingKey: '11', title: 'Other' });
    assert.equal(b.socket.last('wt_state').inviteCode.length, 6);
    // The length is bounded either way.
    const c = connect('plex:3', 'Cy');
    say(c, { type: 'wt_create', ratingKey: '12', title: 'X', codeLength: 99 });
    assert.equal(c.socket.last('wt_state').inviteCode.length, 10);
    for (const row of [a, b, c]) detachParticipant(row.participant);
});

test('joining, playing and pausing are shared with everyone in the room', () => {
    const host = connect('plex:1', 'Ann');
    say(host, { type: 'wt_create', ratingKey: '20', title: 'Show', mediaType: 'episode', guids: ['tmdb://5'] });
    const code = host.socket.last('wt_state').inviteCode;

    const guest = connect('plex:2', 'Bo');
    say(guest, { type: 'wt_join', inviteCode: code });
    const joined = guest.socket.last('wt_state');
    assert.equal(joined.title, 'Show');
    assert.deepEqual(joined.guids, ['tmdb://5']);
    assert.equal(joined.participants.length, 2);
    assert.equal(host.socket.last('wt_joined').displayName, 'Bo');

    say(host, { type: 'wt_play', positionMs: 5000 });
    const playing = guest.socket.last('wt_state');
    assert.equal(playing.playing, true);
    assert.ok(playing.positionMs >= 5000);

    say(guest, { type: 'wt_pause', positionMs: 9000 });
    const paused = host.socket.last('wt_state');
    assert.equal(paused.playing, false);
    assert.equal(paused.positionMs, 9000);
    for (const row of [host, guest]) detachParticipant(row.participant);
});

test('a seek holds the room until everyone has caught up, then resumes together', () => {
    const host = connect('plex:1', 'Ann');
    say(host, { type: 'wt_create', ratingKey: '30', title: 'Film' });
    const code = host.socket.last('wt_state').inviteCode;
    const guest = connect('plex:2', 'Bo');
    say(guest, { type: 'wt_join', inviteCode: code });
    say(host, { type: 'wt_play', positionMs: 0 });

    say(host, { type: 'wt_seek', positionMs: 60000, playing: true });
    const waiting = guest.socket.last('wt_state');
    assert.equal(waiting.waitingForSeekReady, true);
    assert.equal(waiting.playing, false);
    assert.ok(waiting.seekId);

    say(guest, { type: 'wt_seek_ready', seekId: waiting.seekId });
    const resumed = host.socket.last('wt_state');
    assert.equal(resumed.waitingForSeekReady, false);
    assert.equal(resumed.playing, true);
    for (const row of [host, guest]) detachParticipant(row.participant);
});

test('an unknown code is refused and a full room turns people away', () => {
    const stranger = connect('plex:9', 'Zed');
    say(stranger, { type: 'wt_join', inviteCode: 'NOPE00' });
    assert.equal(stranger.socket.last('wt_error').code, 'room_not_found');

    const host = connect('plex:1', 'Ann');
    say(host, { type: 'wt_create', ratingKey: '40', title: 'Full' });
    const code = host.socket.last('wt_state').inviteCode;
    const guests = [];
    for (let i = 2; i <= 8; i += 1) {
        const guest = connect(`plex:${i}`, `G${i}`);
        say(guest, { type: 'wt_join', inviteCode: code });
        guests.push(guest);
    }
    const ninth = connect('plex:99', 'Late');
    say(ninth, { type: 'wt_join', inviteCode: code });
    assert.equal(ninth.socket.last('wt_error').code, 'room_full');
    for (const row of [host, ninth, stranger, ...guests]) detachParticipant(row.participant);
});

test('when the host leaves, the next person to join becomes host and the room lives on', () => {
    const host = connect('plex:1', 'Ann');
    say(host, { type: 'wt_create', ratingKey: '50', title: 'Film' });
    const code = host.socket.last('wt_state').inviteCode;
    const guest = connect('plex:2', 'Bo');
    say(guest, { type: 'wt_join', inviteCode: code });

    detachParticipant(host.participant);
    const state = guest.socket.last('wt_state');
    assert.equal(state.hostUserId, 'plex:2');
    assert.equal(state.participants.length, 1);
    assert.ok(watchTogetherRoomExists(code));

    detachParticipant(guest.participant);
    // Empty rooms are kept for a grace period (people reconnect), then reaped.
    assert.ok(watchTogetherRoomExists(code));
    reapEmptyRooms();
    assert.ok(watchTogetherRoomExists(code));
});
