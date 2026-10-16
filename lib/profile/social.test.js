import assert from 'node:assert/strict';
import test from 'node:test';
import {
    libraryNamesForUser,
    normalizeProfilePins,
    sanitizeProfileBio,
    setProfilePin,
} from './social.js';

test('sanitizeProfileBio strips tags and caps length', () => {
    assert.equal(sanitizeProfileBio('  hello <b>there</b> '), 'hello there');
    assert.equal(sanitizeProfileBio('x'.repeat(400)).length, 280);
});

test('setProfilePin prepends and caps at 12', () => {
    const pins = setProfilePin(['2', '3'], '1', true);
    assert.deepEqual(pins.slice(0, 2), ['1', '2']);
    assert.equal(setProfilePin(pins, '1', false).includes('1'), false);
    const many = setProfilePin(Array.from({ length: 12 }, (_, i) => String(i + 1)), '99', true);
    assert.equal(many.length, 12);
    assert.equal(many[0], '99');
});

test('libraryNamesForUser treats empty ids as all libraries', () => {
    assert.deepEqual(libraryNamesForUser({ libraryIds: [] }, [{ id: '1', title: 'Movies' }]), {
        all: true,
        names: [],
    });
    assert.deepEqual(libraryNamesForUser({ libraryIds: ['1'] }, [{ id: '1', title: 'Movies' }]), {
        all: false,
        names: ['Movies'],
    });
});

test('normalizeProfilePins drops blanks', () => {
    assert.deepEqual(normalizeProfilePins(['', '42', '42']), ['42']);
});
