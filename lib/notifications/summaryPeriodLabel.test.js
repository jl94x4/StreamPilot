import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStoredSummaryPeriodLabel } from './summaryPeriodLabel.js';

const at = (year, month, day, hour = 23, minute = 52) => new Date(year, month - 1, day, hour, minute, 0);

test('daily summary labels use Today, Yesterday, then weekday', () => {
    const now = at(2026, 8, 28, 0, 54);
    assert.equal(formatStoredSummaryPeriodLabel({
        frequency: 'daily',
        createdAt: at(2026, 8, 28, 0, 10).toISOString(),
    }, now), 'Today');
    assert.equal(formatStoredSummaryPeriodLabel({
        frequency: 'daily',
        periodLabel: 'Today',
        createdAt: at(2026, 8, 27, 23, 52).toISOString(),
    }, now), 'Yesterday');
    const twoDaysAgo = formatStoredSummaryPeriodLabel({
        frequency: 'daily',
        periodLabel: 'Today',
        createdAt: at(2026, 8, 26, 23, 20).toISOString(),
    }, now);
    assert.notEqual(twoDaysAgo, 'Today');
    assert.notEqual(twoDaysAgo, 'Yesterday');
});

test('weekly and monthly labels stay current only for the active period', () => {
    const now = at(2026, 8, 28, 12, 0);
    assert.equal(formatStoredSummaryPeriodLabel({
        frequency: 'weekly',
        periodLabel: 'This week',
        periodEnd: at(2026, 8, 27, 23, 0).toISOString(),
    }, now), 'This week');
    assert.equal(formatStoredSummaryPeriodLabel({
        frequency: 'monthly',
        periodLabel: 'This month',
        periodEnd: at(2026, 7, 31, 23, 0).toISOString(),
    }, now).toLowerCase().includes('july'), true);
});
