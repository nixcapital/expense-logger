/* Expense Logger — household snapshot encryption (WebCrypto only, no DOM).
   Blob envelope: JSON { v, salt, iv, ct } with base64 fields; stored as one opaque string. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExpenseHouseholdCrypto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ENVELOPE_VERSION = 1;
  var PBKDF2_ITERATIONS = 600000;
  var SALT_BYTES = 16;
  var IV_BYTES = 12;

  function subtle() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
      return globalThis.crypto.subtle;
    }
    return null;
  }

  function randomBytes(n) {
    var buf = new Uint8Array(n);
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(buf);
      return buf;
    }
    throw new Error('no-webcrypto');
  }

  function b64Encode(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function b64Decode(str) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
    var bin = atob(str);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function encodeEnvelope(salt, iv, ct) {
    return JSON.stringify({
      v: ENVELOPE_VERSION,
      salt: b64Encode(salt),
      iv: b64Encode(iv),
      ct: b64Encode(ct)
    });
  }

  function parseEnvelope(blob) {
    if (typeof blob !== 'string' || !blob) return null;
    var o;
    try { o = JSON.parse(blob); } catch (e) { return null; }
    if (!o || o.v !== ENVELOPE_VERSION) return null;
    if (typeof o.salt !== 'string' || typeof o.iv !== 'string' || typeof o.ct !== 'string') return null;
    try {
      return { salt: b64Decode(o.salt), iv: b64Decode(o.iv), ct: b64Decode(o.ct) };
    } catch (e2) { return null; }
  }

  function deriveAesKey(passphrase, salt) {
    var sub = subtle();
    if (!sub) return Promise.reject(new Error('no-webcrypto'));
    var enc = new TextEncoder();
    return sub.importKey('raw', enc.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return sub.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    });
  }

  function encryptPlaintext(passphrase, saltBytes, plaintextUtf8) {
    var sub = subtle();
    if (!sub) return Promise.reject(new Error('no-webcrypto'));
    var salt = saltBytes && saltBytes.length ? saltBytes : randomBytes(SALT_BYTES);
    var iv = randomBytes(IV_BYTES);
    var enc = new TextEncoder();
    return deriveAesKey(passphrase, salt).then(function (key) {
      return sub.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintextUtf8)).then(function (ctBuf) {
        return {
          blob: encodeEnvelope(salt, iv, new Uint8Array(ctBuf)),
          saltB64: b64Encode(salt)
        };
      });
    });
  }

  function decryptBlob(passphrase, blob) {
    var parsed = parseEnvelope(blob);
    if (!parsed) return Promise.reject(new Error('bad-envelope'));
    var sub = subtle();
    if (!sub) return Promise.reject(new Error('no-webcrypto'));
    var dec = new TextDecoder();
    return deriveAesKey(passphrase, parsed.salt).then(function (key) {
      return sub.decrypt({ name: 'AES-GCM', iv: parsed.iv }, key, parsed.ct).then(function (plain) {
        return dec.decode(plain);
      });
    });
  }

  function newHouseholdSaltB64() {
    return b64Encode(randomBytes(SALT_BYTES));
  }

  return {
    ENVELOPE_VERSION: ENVELOPE_VERSION,
    PBKDF2_ITERATIONS: PBKDF2_ITERATIONS,
    b64Encode: b64Encode,
    b64Decode: b64Decode,
    encodeEnvelope: encodeEnvelope,
    parseEnvelope: parseEnvelope,
    encryptPlaintext: encryptPlaintext,
    decryptBlob: decryptBlob,
    newHouseholdSaltB64: newHouseholdSaltB64
  };
});
