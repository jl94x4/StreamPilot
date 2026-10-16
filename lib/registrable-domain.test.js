import assert from 'node:assert/strict';
import { registrableDomainFromHost } from './registrable-domain.js';

assert.equal(registrableDomainFromHost('portal.strymx.co.uk'), 'strymx.co.uk');
assert.equal(registrableDomainFromHost('pw.strymx.co.uk'), 'strymx.co.uk');
assert.equal(registrableDomainFromHost('portal.example.com'), 'example.com');
assert.equal(registrableDomainFromHost('co.uk'), 'co.uk');

console.log('registrable-domain ok');
