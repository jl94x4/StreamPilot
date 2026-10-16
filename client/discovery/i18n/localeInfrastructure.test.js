import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeDiscoverMetadataLanguage } from '../../../lib/discovery-settings.js';

const loadTypes = () => {
    const source = fs.readFileSync(new URL('./types.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    const module = { exports: {} };
    vm.runInNewContext(`(function(module){${code}\n})(module)`, { module });
    return module.exports;
};

test('supported locale matching preserves regional Brazilian Portuguese', () => {
    const { matchDiscoverLocale, normalizeDiscoverLocale } = loadTypes();
    assert.equal(matchDiscoverLocale('it-IT'), 'it');
    assert.equal(matchDiscoverLocale('ja-JP'), 'ja');
    assert.equal(matchDiscoverLocale('pl-PL'), 'pl');
    assert.equal(matchDiscoverLocale('nl-NL'), 'nl');
    assert.equal(matchDiscoverLocale('ru-RU'), 'ru');
    assert.equal(matchDiscoverLocale('pt-BR'), 'pt-BR');
    assert.equal(matchDiscoverLocale('pt-PT'), null);
    assert.equal(normalizeDiscoverLocale('unsupported'), 'en');
});

test('metadata locale normalization supports all registered locales', () => {
    for (const locale of ['en', 'fr', 'de', 'es', 'it', 'ja', 'pl', 'nl', 'ru']) {
        assert.equal(normalizeDiscoverMetadataLanguage(locale), locale);
    }
    assert.equal(normalizeDiscoverMetadataLanguage('pt-BR'), 'pt-BR');
    assert.equal(normalizeDiscoverMetadataLanguage('pt-PT'), 'en');
    assert.equal(normalizeDiscoverMetadataLanguage('xx-YY'), 'en');
});
