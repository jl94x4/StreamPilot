import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TPDB_IMPORT_WINDOW_NAME,
    buildTpdbImportBookmarklet,
    buildTpdbImportUserscript,
    extractTpdbSetUrl,
    posterSetsImportHash,
    posterSetsImportHref,
} from './tpdbImportTools.js';

test('extractTpdbSetUrl canonicalizes set and poster URLs', () => {
    assert.equal(extractTpdbSetUrl('https://theposterdb.com/set/362735'), 'https://theposterdb.com/set/362735');
    assert.equal(extractTpdbSetUrl('https://www.theposterdb.com/poster/set/362735?foo=1'), 'https://theposterdb.com/set/362735');
    assert.equal(extractTpdbSetUrl('https://theposterdb.com/poster/99'), 'https://theposterdb.com/poster/99');
    assert.equal(extractTpdbSetUrl('https://theposterdb.com/user/n3rdplum'), null);
    assert.equal(extractTpdbSetUrl('https://theposterdb.com/recent'), null);
    assert.equal(extractTpdbSetUrl('https://mediux.pro/sets/1'), null);
});

test('posterSetsImportHref opens paste import without auto-apply', () => {
    const href = posterSetsImportHref('https://portal.example.com', 'https://theposterdb.com/set/1');
    assert.equal(href, 'https://portal.example.com/poster-sets#paste?url=https%3A%2F%2Ftheposterdb.com%2Fset%2F1');
    assert.equal(posterSetsImportHash('https://theposterdb.com/set/1', { apply: true }), '#paste?url=https%3A%2F%2Ftheposterdb.com%2Fset%2F1&action=apply');
});

test('bookmarklet and userscript bake the portal origin', () => {
    const root = 'https://portal.example.com/smp';
    const bookmarklet = buildTpdbImportBookmarklet(root);
    assert.match(bookmarklet, /^javascript:/);
    // CodeQL-safe literals escape "/" as \u002F; runtime still resolves to the portal URL.
    assert.match(bookmarklet, /portal\.example\.com(?:\/|\\u002F)smp/);
    assert.match(bookmarklet, /#paste\?url=/);
    assert.match(bookmarklet, new RegExp(TPDB_IMPORT_WINDOW_NAME));
    assert.doesNotMatch(bookmarklet, /action=apply/);
    const rootLit = bookmarklet.match(/window\.open\(("(?:\\.|[^"])*")/)?.[1];
    assert.equal(rootLit && Function(`"use strict"; return (${rootLit});`)(), root);

    const script = buildTpdbImportUserscript({
        portalRoot: root,
        scriptUrl: `${root}/api/poster-sets/tpdb-import.user.js`,
    });
    assert.match(script, /@match\s+https:\/\/theposterdb\.com\/\*/);
    assert.match(script, /portal\.example\.com(?:\/|\\u002F)smp/);
    assert.match(script, /#paste\?/);
    assert.match(script, /white_orange_link/);
    assert.match(script, /fa-file-import/);
    assert.match(script, new RegExp(TPDB_IMPORT_WINDOW_NAME));
    assert.doesNotMatch(script, /#e5a00d/);
    assert.match(script, /@downloadURL\s+https:\/\/portal\.example\.com\/smp\/api\/poster-sets\/tpdb-import\.user\.js/);
    const portalAssign = script.match(/var PORTAL = ("(?:\\.|[^"]*)");/)?.[1];
    assert.equal(portalAssign && Function(`"use strict"; return (${portalAssign});`)(), root);
});
