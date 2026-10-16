import assert from 'node:assert/strict';
import test from 'node:test';
import {
    listRegisteredPortalJobs,
    registerPortalJobProvider,
    resetPortalJobProvidersForTests,
} from './portal-jobs.js';

test('listRegisteredPortalJobs only returns running jobs', () => {
    resetPortalJobProvidersForTests();
    registerPortalJobProvider(() => [
        { id: 'a', status: 'running', title: 'A', message: 'go' },
        { id: 'b', status: 'success', title: 'B', message: 'done' },
    ]);
    registerPortalJobProvider(() => {
        throw new Error('skip me');
    });
    const jobs = listRegisteredPortalJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'a');
});
