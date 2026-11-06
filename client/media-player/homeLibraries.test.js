import assert from 'node:assert/strict';
import test from 'node:test';
import { homeHubHiddenByPicks, hubLibrarySection } from './homeLibraries.ts';

const picks = { 'srvA::2': false, 'srvA::3': true, 'srvB::2': true };

test('a row stamped with its library is hidden when that library is switched off', () => {
    const hub = { identifier: 'custom.collection.2.9001', title: 'Marvel', serverId: 'srvA', librarySectionID: '2', items: [] };
    assert.equal(hubLibrarySection(hub), '2');
    assert.equal(homeHubHiddenByPicks(hub, picks), true);
});

test('the same library number on another server is not affected', () => {
    const hub = { identifier: 'movie.recentlyadded.2', title: 'Recently Added', serverId: 'srvB', librarySectionID: '2', items: [] };
    assert.equal(homeHubHiddenByPicks(hub, picks), false);
});

test('rows found by path still work, and Continue Watching is never hidden', () => {
    const byPath = { identifier: 'x', title: 'X', hubKey: 'srvA::/hubs/sections/2/recentlyAdded', serverId: 'srvA', items: [] };
    assert.equal(homeHubHiddenByPicks(byPath, picks), true);
    const cw = { identifier: 'home.continueWatching', title: 'Continue Watching', serverId: 'srvA', librarySectionID: '2', items: [] };
    assert.equal(homeHubHiddenByPicks(cw, picks), false);
});

test('with no choices saved everything is shown', () => {
    const hub = { identifier: 'x', title: 'X', serverId: 'srvA', librarySectionID: '2', items: [] };
    assert.equal(homeHubHiddenByPicks(hub, {}), false);
});
