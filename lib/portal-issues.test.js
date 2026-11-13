import test from 'node:test';
import assert from 'node:assert/strict';
import {
    reportPortalIssue,
    clearPortalIssue,
    listPortalIssues,
    trackPortalIssue,
    __resetPortalIssuesForTest,
} from './portal-issues.js';

test('reports, counts and clears issues', () => {
    __resetPortalIssuesForTest();
    reportPortalIssue('a', { title: 'A broke', detail: 'boom' });
    reportPortalIssue('a', { title: 'A broke', detail: 'boom again' });
    const [issue] = listPortalIssues();
    assert.equal(issue.count, 2);
    assert.equal(issue.detail, 'boom again');
    clearPortalIssue('a');
    assert.equal(listPortalIssues().length, 0);
});

test('critical issues sort first and old ones expire', () => {
    __resetPortalIssuesForTest();
    reportPortalIssue('warn', { title: 'warn' });
    reportPortalIssue('crit', { severity: 'critical', title: 'crit' });
    assert.deepEqual(listPortalIssues().map((i) => i.key), ['crit', 'warn']);
    assert.equal(listPortalIssues(Date.now() + 25 * 3600_000).length, 0);
});

test('trackPortalIssue records a failure and clears on success', async () => {
    __resetPortalIssuesForTest();
    await assert.rejects(trackPortalIssue('t', { title: 'T' }, async () => { throw new Error('nope'); }));
    assert.equal(listPortalIssues()[0].detail, 'nope');
    await trackPortalIssue('t', { title: 'T' }, async () => 'ok');
    assert.equal(listPortalIssues().length, 0);
});
