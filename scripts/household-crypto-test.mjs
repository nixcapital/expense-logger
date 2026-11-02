/**
 * household-crypto.js envelope round-trip (Node WebCrypto). Fake passphrase only.
 * Run: node scripts/household-crypto-test.mjs
 */
import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const HC = require('../household-crypto.js');

const pass = 'fake-test-passphrase';
const plain = '{"backupFormat":2,"storage":{}}';

const enc = await HC.encryptPlaintext(pass, null, plain);
assert.ok(enc.blob.includes('"v":1'), 'envelope version');
assert.ok(!enc.blob.includes(pass), 'passphrase not in blob');

const parsed = HC.parseEnvelope(enc.blob);
assert.ok(parsed && parsed.salt.length === 16 && parsed.iv.length === 12, 'salt and iv');

const out = await HC.decryptBlob(pass, enc.blob);
assert.strictEqual(out, plain);

console.log('household-crypto-test: ok');
