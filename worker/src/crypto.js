// Small Web Crypto helpers. No dependencies.
var enc = new TextEncoder();

export function toHex(buf) {
  return Array.prototype.map.call(new Uint8Array(buf), function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

export function b64encode(bytes) {
  var s = '';
  var u = new Uint8Array(bytes);
  for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

export function b64decode(str) {
  var s = atob(str);
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// Constant-time compare of two secrets (hash both so lengths match).
export async function secretsEqual(a, b) {
  var ha = await sha256Hex(String(a));
  var hb = await sha256Hex(String(b));
  var diff = 0;
  for (var i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export function randomToken() {
  var bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function importKey(keyB64) {
  var raw = b64decode(keyB64);
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes, base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptText(keyB64, plaintext) {
  var key = await importKey(keyB64);
  var iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext)));
  var out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptText(keyB64, packed) {
  var key = await importKey(keyB64);
  var all = b64decode(packed);
  var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
  return new TextDecoder().decode(pt);
}
