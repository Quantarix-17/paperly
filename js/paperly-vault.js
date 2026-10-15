// PaperLy — client-side "vault": zero-knowledge encryption for cloud backup.
//
// Design (nothing readable ever leaves the device):
//   * A random 256-bit Data Key (DEK) is generated on first setup.
//   * The DEK is stored in Firestore ONLY in wrapped (encrypted) form, twice:
//       - wrapped by a key derived from the user's passphrase (PBKDF2-SHA256, 600k iters)
//       - wrapped by a key derived from a random 160-bit Recovery Key
//   * Per-purpose sub-keys (secrets / history / index) are derived from the DEK with HKDF,
//     so an API-key blob and a history blob never share a key.
//   * Every blob is gzip'd then sealed with AES-256-GCM. The AAD binds it to
//     (uid, purpose, id), so ciphertext cannot be swapped between users or documents.
//   * After unlock, the DEK lives on this device only as a NON-EXTRACTABLE CryptoKey in
//     IndexedDB (JS can use it but can never read the raw bytes back out).
(function (root) {
  'use strict';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const subtle = () => root.crypto.subtle;
  const KDF_ITER = 600000;
  const CHUNK_CHARS = 600000;            // Firestore doc limit is ~1 MiB
  const ZERO32 = new Uint8Array(32);
  const rand = n => root.crypto.getRandomValues(new Uint8Array(n));

  // ---------- encoding helpers ----------
  function b64(bytes) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(str), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no I/O/0/1
  function bytesToRecovery(bytes) {           // 20 bytes -> 32 chars -> XXXX-XXXX-...
    let bits = 0, val = 0, out = '';
    for (const b of bytes) {
      val = ((val << 8) | b) & 0xffff; bits += 8;
      while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    return out.match(/.{1,4}/g).join('-');
  }
  function recoveryToBytes(code) {
    const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 32) throw new Error('bad-recovery-key');
    let bits = 0, val = 0; const out = [];
    for (const ch of clean) {
      const i = B32.indexOf(ch);
      if (i < 0) throw new Error('bad-recovery-key');
      val = ((val << 5) | i) & 0xffff; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  }
  function hash(str) {                        // cyrb53 — change detection only, not security
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + str.length.toString(36);
  }
  function chunkString(s, size) {
    const out = []; size = size || CHUNK_CHARS;
    for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    return out.length ? out : [''];
  }
  const aadFor = (uid, purpose, id) => enc.encode(`pata:v1:${uid}:${purpose}:${id}`);

  // ---------- compression ----------
  async function gzip(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function gunzip(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // ---------- key derivation / wrapping ----------
  async function kekFromPassphrase(pass, salt, iter) {
    const base = await subtle().importKey('raw', enc.encode(String(pass).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function kekFromRecovery(recBytes, salt) {
    const base = await subtle().importKey('raw', recBytes, 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('pata-recovery-kek-v1') }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function wrap(kek, dek, aad) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, kek, dek));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function unwrap(kek, w, aad) {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(w.iv), additionalData: enc.encode(aad) }, kek, unb64(w.ct)));
  }
  async function subKey(hk, purpose) {
    return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: ZERO32, info: enc.encode('pata-subkey-v1:' + purpose) },
      hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function sessionFromHK(hk) {
    let cached = null;
    return {
      hk,
      keys: async () => cached || (cached = {
        secrets: await subKey(hk, 'secrets'), history: await subKey(hk, 'history'), index: await subKey(hk, 'index'), prefs: await subKey(hk, 'prefs')
      })
    };
  }
  async function sessionFromDek(dek) {
    return sessionFromHK(await subtle().importKey('raw', dek, 'HKDF', false, ['deriveKey']));
  }

  // ---------- vault lifecycle ----------
  function passphraseIssue(p) {
    p = String(p || '');
    if (p.length < 10) return 'Use at least 10 characters (a few random words work great).';
    if (/^(.)\1+$/.test(p)) return 'That passphrase is too repetitive.';
    return '';
  }
  async function createVault(uid, passphrase) {
    const dek = rand(32), recBytes = rand(20), salt = rand(16), recSalt = rand(16);
    const meta = {
      v: 1,
      kdf: { name: 'PBKDF2-SHA256', iter: KDF_ITER, salt: b64(salt) },
      wrapPass: await wrap(await kekFromPassphrase(passphrase, salt, KDF_ITER), dek, `pata:v1:${uid}:wrap:pass`),
      rec: Object.assign({ salt: b64(recSalt) }, await wrap(await kekFromRecovery(recBytes, recSalt), dek, `pata:v1:${uid}:wrap:rec`)),
      createdAt: Date.now()
    };
    const session = await sessionFromDek(dek);
    dek.fill(0);
    const recoveryKey = bytesToRecovery(recBytes);
    recBytes.fill(0);
    return { meta, session, recoveryKey };
  }
  async function unlockWithPassphrase(uid, meta, pass) {
    const kek = await kekFromPassphrase(pass, unb64(meta.kdf.salt), meta.kdf.iter);
    let dek;
    try { dek = await unwrap(kek, meta.wrapPass, `pata:v1:${uid}:wrap:pass`); }
    catch (_) { throw new Error('wrong-passphrase'); }
    const session = await sessionFromDek(dek);
    dek.fill(0);
    return { session };
  }
  async function unlockWithRecovery(uid, meta, code) {
    const rb = recoveryToBytes(code);
    const kek = await kekFromRecovery(rb, unb64(meta.rec.salt));
    let dek;
    try { dek = await unwrap(kek, meta.rec, `pata:v1:${uid}:wrap:rec`); }
    catch (_) { throw new Error('wrong-recovery-key'); }
    const session = await sessionFromDek(dek);
    return { session, dek };                 // caller must rewrap then dek.fill(0)
  }
  async function rewrapPassphrase(uid, meta, dek, newPass) {
    const salt = rand(16);
    return Object.assign({}, meta, {
      kdf: { name: 'PBKDF2-SHA256', iter: KDF_ITER, salt: b64(salt) },
      wrapPass: await wrap(await kekFromPassphrase(newPass, salt, KDF_ITER), dek, `pata:v1:${uid}:wrap:pass`),
      updatedAt: Date.now()
    });
  }

  // ---------- sealing data ----------
  async function seal(session, purpose, uid, id, obj) {
    const key = (await session.keys())[purpose];
    let raw = enc.encode(JSON.stringify(obj)), z = 0;
    const gz = await gzip(raw);
    if (gz && gz.length < raw.length) { raw = gz; z = 1; }
    const iv = rand(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(uid, purpose, id) }, key, raw));
    return { v: 1, z, iv: b64(iv), ct: b64(ct) };
  }
  async function open(session, purpose, uid, id, blob) {
    const key = (await session.keys())[purpose];
    let raw;
    try {
      raw = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), additionalData: aadFor(uid, purpose, id) }, key, unb64(blob.ct)));
    } catch (_) { throw new Error('decrypt-failed'); }
    if (blob.z) raw = await gunzip(raw);
    return JSON.parse(dec.decode(raw));
  }

  // NOTE: the app now stores API keys as plain text. This module is only kept to READ backups made by earlier
  // versions (passphrase vault / auto-encrypted keys) once and move them to the plain format.
  // ---------- automatic (passphrase-less) session ----------
  // Used for the always-on backup: the key is derived from the account id, so restoring on a new device needs no
  // extra step. Trade-off: this is encryption at rest, not zero-knowledge (whoever controls the project's database
  // AND knows the uid could derive it). The old passphrase vault code below is kept only to migrate old backups.
  async function autoSession(uid) {
    const seed = await subtle().digest('SHA-256', enc.encode('pata:auto:v2:' + uid));
    return sessionFromHK(await subtle().importKey('raw', seed, 'HKDF', false, ['deriveKey']));
  }

  // ---------- device cache (non-extractable key in IndexedDB) ----------
  function idb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('no-idb'));
      const r = indexedDB.open('pata-vault', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('k');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function cacheSession(uid, session) {
    try {
      const db = await idb();
      await new Promise((res, rej) => { const tx = db.transaction('k', 'readwrite'); tx.objectStore('k').put(session.hk, 'hk:' + uid); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (_) { /* private mode etc: user will just re-enter passphrase */ }
  }
  async function sessionFromCache(uid) {
    try {
      const db = await idb();
      const hk = await new Promise((res, rej) => { const rq = db.transaction('k').objectStore('k').get('hk:' + uid); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
      return hk ? sessionFromHK(hk) : null;
    } catch (_) { return null; }
  }
  async function clearCache() {
    try {
      const db = await idb();
      await new Promise((res, rej) => { const tx = db.transaction('k', 'readwrite'); tx.objectStore('k').clear(); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (_) {}
  }

  const api = {
    autoSession, createVault, unlockWithPassphrase, unlockWithRecovery, rewrapPassphrase, passphraseIssue,
    seal, open, chunkString, hash, cacheSession, sessionFromCache, clearCache,
    _internal: { bytesToRecovery, recoveryToBytes, b64, unb64, CHUNK_CHARS }
  };
  root.PaperlyVault = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);