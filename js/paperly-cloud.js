// PaperLy — Google Sign in / Sign up + AUTOMATIC cloud backup + session history, plus an offline Guest mode.
// ES module, loaded AFTER the classic app scripts. Needs js/firebase-config.js and js/paperly-vault.js.
//
//  * Signed-in account: backup is always on (no setup step, no passphrase, no off switch).
//      - API keys, history and preferences are all stored as plain text (no encryption, fast and simple).
//        Access is limited to the owner by the Firestore rules (see firestore.rules).
//  * Guest: 100% offline. Firebase is never loaded, nothing is uploaded, API keys stay in this browser only.
//
// Model: ONE working session at a time (no tabs). Starting a new session or opening one from History
// archives the outgoing session to the cloud history first (see TAB_MANAGER.createTab).
const CFG = window.PAPERLY_FIREBASE_CONFIG || {};
const SDK_VER = window.PAPERLY_FIREBASE_SDK_VERSION || '10.14.1';
const V = window.PaperlyVault;
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const configured = !!(CFG.apiKey && CFG.projectId && CFG.appId);

// ---------- what gets backed up ----------
const SECRET_KEYS = ['aiModelsConfig_v1', 'aiModelAutoSwitchEnabled_v1', 'OCR_PREFERRED_MODEL_ID'];   // holds API keys
const PREF_KEYS = ['aiPdfStudio.visualFormat', 'aiPdfStudio.textFormat', 'aiPdfStudio.languageFormat', 'aiStudioCreationMode_v1',
  'atCommandRecents_v1', 'aipdf_slide_auto_background_mode', 'aipdf_slide_auto_background_enabled', 'paperly_theme',
  'paperly_instruction_v1'];   // "Instruction" (how the AI should answer) — backed up with the other preferences
const SYNC_KEYS = SECRET_KEYS.concat(PREF_KEYS);
const WIPE_KEYS = SYNC_KEYS.concat(['aiDocTabs_v1', 'aiDocProState_v22', 'aiModelDailyResetDate_v1', 'studio_theme', 'paperly_sync_state', 'paperly_local_owner']);
const MODEL_FIELDS = ['id', 'name', 'apiUrl', 'apiKey', 'modelId', 'supportsJson', 'supportsVision', 'enableGoogleSearch', 'apiType'];
const MAX_INDEX = 300, MAX_UPLOAD_CHARS = 8000000, PLAIN_CHUNK = 250000;

// ---------- state / helpers ----------
const G = { fb: null, auth: null, db: null, user: null, uid: null, started: false, verifying: false, session: null, meta: null,
  index: null, hashes: {}, chunkCount: {}, pre: null, preAt: 0, timer: null, running: false, status: 'off', lastAt: 0, err: '', engineOn: false };
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const lsDel = k => { try { localStorage.removeItem(k); } catch (_) {} };
const isGuest = () => lsGet('paperly_mode') === 'guest';
const toast = m => { try { (window.displayToastNotification || console.log)(m); } catch (_) {} };
const readSync = () => { try { return JSON.parse(lsGet('paperly_sync_state') || '{}'); } catch (_) { return {}; } };
const writeSync = o => lsSet('paperly_sync_state', JSON.stringify(o));
// Every cloud call gets a timeout, so a bad network / missing database can never hang the UI forever.
const T = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms || 15000))]);
function explain(e) {
  const c = String((e && e.code) || '').replace(/^(firestore|auth)\//, ''), m = String((e && e.message) || e || '');
  if (c === 'permission-denied') return 'Firestore permission denied. Firebase Console → Firestore Database → Rules → paste firestore.rules and Publish.';
  if (c === 'not-found' || /does not exist/i.test(m)) return 'The Firestore database is not created yet. Firebase Console → Firestore Database → Create database.';
  if (c === 'unavailable' || c === 'timeout' || /offline|didn't respond|timeout/i.test(m)) return 'Cannot reach the cloud database. Check your internet — and make sure a Firestore database exists (Firebase Console → Firestore Database → Create database) and the rules are published.';
  if (c === 'network-request-failed') return 'Network error. Check your internet connection.';
  return 'Cloud error: ' + (c || m);
}

// ---------- CSS: modal + history drawer (gate CSS is inline in index.html) ----------
(function injectCss() {
  const st = document.createElement('style');
  st.textContent = `
#paperly-modal{position:fixed;inset:0;z-index:2147481500;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(15,23,42,.55);backdrop-filter:blur(6px)}
#paperly-modal.show{display:flex}
#paperly-modal .pm-card{width:100%;max-width:460px;max-height:86vh;display:flex;flex-direction:column;background:#fff;color:#0f172a;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden}
html.dark #paperly-modal .pm-card{background:#111827;color:#f1f5f9}
#paperly-modal .pm-head{display:flex;align-items:center;gap:8px;padding:16px 18px;border-bottom:1px solid rgba(148,163,184,.25)}
#paperly-modal .pm-head h3{margin:0;font-size:17px;flex:1}
#paperly-modal .pm-x{border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer;line-height:1}
#paperly-modal .pm-body{padding:14px 18px 18px;overflow:auto;font-size:14px;line-height:1.6}
#paperly-modal .pm-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
#paperly-modal .pm-b,#paperly-drawer .pd-b{border:0;border-radius:11px;padding:9px 13px;font:600 13.5px Inter,Arial,sans-serif;cursor:pointer;background:rgba(148,163,184,.2);color:inherit}
#paperly-modal .pm-b.pri,#paperly-drawer .pd-b.pri{background:#4f7df3;color:#fff}
#paperly-modal .pm-b.danger,#paperly-drawer .pd-b.danger{background:rgba(239,68,68,.14);color:#ef4444}
#paperly-drawer{position:fixed;inset:0;z-index:2147481200;display:none}
#paperly-drawer.show{display:block}
#paperly-drawer .pd-scrim{position:absolute;inset:0;background:rgba(15,23,42,.45);animation:pdfade .2s}
#paperly-drawer .pd-panel{position:absolute;left:0;top:0;bottom:0;width:min(380px,92vw);display:flex;flex-direction:column;gap:10px;background:#fff;color:#0f172a;
 box-shadow:8px 0 40px rgba(0,0,0,.3);padding:calc(14px + env(safe-area-inset-top,0px)) 14px calc(14px + env(safe-area-inset-bottom,0px));animation:pdslide .22s ease;font-family:Inter,"Hind Siliguri",Arial,sans-serif}
html.dark #paperly-drawer .pd-panel{background:#111827;color:#f1f5f9}
#paperly-drawer .pd-head{display:flex;align-items:center;gap:10px}
#paperly-drawer .pd-av{width:42px;height:42px;border-radius:50%;overflow:hidden;background:#4f7df3;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}
#paperly-drawer .pd-av img{width:100%;height:100%;object-fit:cover}
#paperly-drawer .pd-who{flex:1;min-width:0}#paperly-drawer .pd-who b,#paperly-drawer .pd-who small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#paperly-drawer .pd-who small{opacity:.65;font-size:12.5px}
#paperly-drawer .pd-x{border:0;background:transparent;color:inherit;font-size:24px;cursor:pointer;line-height:1}
#paperly-drawer .pd-stat{font-size:12.5px;opacity:.8}
#paperly-drawer .pd-inst{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left}#paperly-drawer .pd-inst small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:500;font-size:12px;opacity:.65;line-height:1.4}
#paperly-drawer .pd-btns{display:flex;gap:8px}#paperly-drawer .pd-btns .pd-b{flex:1}
#paperly-drawer .pd-search{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:11px;border:1px solid rgba(148,163,184,.4);background:transparent;color:inherit;font:500 14px Inter,Arial,sans-serif}
#paperly-drawer .pd-list{flex:1;overflow:auto;margin:0 -4px;padding:0 4px}
#paperly-drawer .pd-day{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.55;margin:12px 4px 4px}
#paperly-drawer .pd-row{display:flex;align-items:center;gap:8px;padding:9px 8px;border-radius:12px;cursor:pointer}
#paperly-drawer .pd-row:hover{background:rgba(79,125,243,.1)}#paperly-drawer .pd-row.cur{background:rgba(79,125,243,.16)}
#paperly-drawer .pd-t{flex:1;min-width:0}#paperly-drawer .pd-t b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
#paperly-drawer .pd-t small{opacity:.6;font-size:12px}
#paperly-drawer .pd-del{border:0;background:transparent;color:inherit;opacity:.45;cursor:pointer;font-size:15px;padding:6px}#paperly-drawer .pd-del:hover{opacity:1;color:#ef4444}
#paperly-drawer .pd-empty{padding:26px 10px;text-align:center;opacity:.65;font-size:13.5px;line-height:1.6}
#paperly-gate .pg-or{display:flex;align-items:center;gap:10px;margin:14px 0 10px;font-size:12px;opacity:.55}
#paperly-gate .pg-or::before,#paperly-gate .pg-or::after{content:"";flex:1;height:1px;background:rgba(148,163,184,.5)}
#paperly-gate .pg-guest{background:rgba(148,163,184,.18);color:inherit}
#paperly-gate .pg-note{margin:8px 2px 0;font-size:12px;line-height:1.5;color:#64748b}
html.dark #paperly-gate .pg-note{color:#94a3b8}
@keyframes pdslide{from{transform:translateX(-100%)}to{transform:none}}@keyframes pdfade{from{opacity:0}to{opacity:1}}`;
  document.head.appendChild(st);
})();

// ---------- gate UI ----------
const gate = $('#paperly-gate'), gbody = $('#pg-body');
const APP_IDS = ['topbar', 'mobile-nav-bar', 'main-container'];
let waitTimer = null;
function inertApp(on) { APP_IDS.forEach(id => { const el = document.getElementById(id); if (el) on ? el.setAttribute('inert', '') : el.removeAttribute('inert'); }); }
function view(html) { if (!gate) return; clearTimeout(waitTimer); gbody.innerHTML = html; gate.hidden = false; gate.classList.add('pg-on'); inertApp(true); }
function closeGate() { if (!gate) return; clearTimeout(waitTimer); gate.classList.remove('pg-on'); gate.hidden = true; inertApp(false); }
function wait(msg, escape) {
  view(`<div class="pg-spin"></div><p class="pg-muted">${esc(msg)}</p>`);
  if (escape) waitTimer = setTimeout(() => {
    if (!gbody.querySelector('.pg-spin')) return;
    const b = document.createElement('button'); b.className = 'pg-link'; b.textContent = escape.label; b.onclick = escape.fn; gbody.appendChild(b);
  }, 12000);
}
const setErr = m => { const e = $('#pg-err'); if (e) e.textContent = m || ''; };
const GOOGLE_SVG = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.7-9.9 6.7-17.4z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.9 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

// Separate Sign in / Sign up (both use Google; "Sign in" refuses to silently create an account) + Guest mode.
function showAuth(mode, err) {
  mode = mode === 'signup' ? 'signup' : 'signin';
  const webview = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|; wv\)/i.test(navigator.userAgent);
  view(`<div class="pg-tabs" role="tablist"><button role="tab" data-m="signin" class="${mode === 'signin' ? 'on' : ''}">Sign in</button><button role="tab" data-m="signup" class="${mode === 'signup' ? 'on' : ''}">Sign up</button></div>
    ${mode === 'signin'
      ? '<h2>Welcome back</h2><p class="pg-muted">Sign in with the Google account you used before. Your API keys and history are restored automatically.</p>'
      : '<h2>Create your account</h2><p class="pg-muted">Sign up with your Google account — no password, no setup.</p><ul class="pg-list"><li>Automatic backup — always on</li><li>API keys and settings are backed up too</li><li>Every session saved in your History</li><li>Restore on any device</li></ul>'}
    ${webview ? '<p class="pg-warn">Google blocks sign-in inside in-app browsers. Please open this page in Chrome or Safari.</p>' : ''}
    <button class="pg-btn pg-google" id="pg-go">${GOOGLE_SVG}<span>${mode === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}</span></button>
    <div id="pg-err" class="pg-err" role="alert">${esc(err || '')}</div>
    <button class="pg-link" data-m="${mode === 'signin' ? 'signup' : 'signin'}">${mode === 'signin' ? "New here? Create an account" : 'Already have an account? Sign in'}</button>
    <div class="pg-or"><span>or</span></div>
    <button class="pg-btn pg-guest" id="pg-guest">👤 Continue as Guest</button>
    <p class="pg-note">Guest mode is fully offline: no account, no backup, nothing is sent to our servers. Your API keys and sessions stay on this device only.</p>`);
  gbody.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => showAuth(b.dataset.m); });
  $('#pg-go').onclick = () => signIn(mode);
  $('#pg-guest').onclick = startGuest;
}
function showUnconfigured() {
  view(`<h2>Setup needed</h2><p class="pg-muted">Firebase isn't configured yet. Paste your Firebase web config into <code>js/firebase-config.js</code>, then reload — or use the app offline as a Guest.</p>
    <button class="pg-btn pg-guest" id="pg-guest">👤 Continue as Guest</button>
    ${isLocalHost ? '<button class="pg-link" id="pg-dev">Continue in setup mode (no login)</button>' : ''}`);
  $('#pg-guest').onclick = startGuest;
  const d = $('#pg-dev'); if (d) d.onclick = closeGate;
}
// offerGuest = also show "Continue as Guest" (used when the cloud can't be reached at all).
function showError(title, msg, retry, skip, offerGuest) {
  view(`<h2>${esc(title)}</h2><p class="pg-muted">${esc(msg)}</p><button class="pg-btn" id="pg-retry">Try again</button>
    ${skip ? '<button class="pg-link" id="pg-skip">Continue — backup keeps retrying in the background</button>' : ''}
    ${offerGuest ? '<button class="pg-link" id="pg-guest">Continue offline as Guest</button>' : ''}`);
  $('#pg-retry').onclick = retry;
  const s = $('#pg-skip'); if (s) s.onclick = skip;
  const g = $('#pg-guest'); if (g) g.onclick = startGuest;
}

// ---------- Guest mode: 100% offline, Firebase is never loaded, nothing is ever uploaded ----------
function startGuest() {
  if (lsGet('paperly_local_owner') && !confirm('This device still holds data from a signed-in account. Guest mode keeps it on this device only and never syncs it. Continue?')) return;
  lsSet('paperly_mode', 'guest');
  enterGuest();
}
function enterGuest() {
  G.guest = true; G.user = null; G.uid = null; G.ready = false;
  window.__paperlyGuest = true;
  document.documentElement.classList.add('paperly-guest');
  closeGate(); mountAvatar(); setStatus('guest');
}
function leaveGuest() {
  if (!confirm('Leave Guest mode and sign in with Google? Your API keys and current work stay on this device, and get backed up to your account after you sign in.')) return;
  lsDel('paperly_mode'); location.reload();
}

// ---------- Firebase loading + auth ----------
async function loadFirebase() {
  ['https://www.gstatic.com', 'https://firestore.googleapis.com', 'https://identitytoolkit.googleapis.com'].forEach(h => { const l = document.createElement('link'); l.rel = 'preconnect'; l.href = h; l.crossOrigin = ''; document.head.appendChild(l); });
  const base = `https://www.gstatic.com/firebasejs/${SDK_VER}/`;
  const [app, auth, fs] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  const fbApp = app.initializeApp(CFG);
  G.fb = { app, auth, fs };
  try {   // persistence fallbacks: some mobile browsers block IndexedDB or localStorage, and a plain getAuth() then loses the login
    G.auth = auth.initializeAuth(fbApp, { persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence, auth.browserSessionPersistence], popupRedirectResolver: auth.browserPopupRedirectResolver });
  } catch (_) { G.auth = auth.getAuth(fbApp); }
  // Auto-detect long-polling: makes Firestore work on networks/ISPs that break WebChannel streaming.
  try { G.db = fs.initializeFirestore(fbApp, { experimentalAutoDetectLongPolling: true }); } catch (_) { G.db = fs.getFirestore(fbApp); }
}
// Optional, most reliable on GitHub Pages / phones: Google's own sign-in popup hands the token straight to this page
// (no firebaseapp.com iframe, so browsers can't block it). Enabled when window.PAPERLY_GOOGLE_CLIENT_ID is set.
const gisReady = () => !!(window.PAPERLY_GOOGLE_CLIENT_ID && window.google && window.google.accounts && window.google.accounts.oauth2);
function preloadGis() {
  if (!window.PAPERLY_GOOGLE_CLIENT_ID || document.getElementById('gsi-client')) return;
  const sc = document.createElement('script'); sc.id = 'gsi-client'; sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; document.head.appendChild(sc);
}
function gisToken() {                                         // must be called synchronously from the tap (popup rule)
  return new Promise((resolve, reject) => {
    const c = window.google.accounts.oauth2.initTokenClient({ client_id: window.PAPERLY_GOOGLE_CLIENT_ID, scope: 'openid email profile',
      callback: r => (r && r.access_token ? resolve(r.access_token) : reject({ code: 'gis/' + ((r && r.error) || 'failed') })),
      error_callback: e => reject({ code: 'gis/' + ((e && e.type) || 'error') }) });
    c.requestAccessToken({ prompt: 'select_account' });
  });
}
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function signIn(mode) {
  const { auth } = G.fb;
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  G.verifying = true;                                       // ignore auth-state events until we've checked sign-in vs sign-up
  try { sessionStorage.setItem('paperly_auth_intent', mode); } catch (_) {}
  wait('Waiting for Google sign-in…', { label: 'Taking too long? Go back', fn: () => { G.verifying = false; showAuth(mode); } });
  let result;
  try {
    if (gisReady()) {
      const tok = await gisToken();
      result = await auth.signInWithCredential(G.auth, auth.GoogleAuthProvider.credential(null, tok));
    } else result = await auth.signInWithPopup(G.auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e && e.code)) {
      try { lsSet('paperly_redirect_pending', '1'); await auth.signInWithRedirect(G.auth, provider); return; } catch (e2) { e = e2; lsDel('paperly_redirect_pending'); }
    }
    G.verifying = false;
    if (e && (e.code === 'auth/cancelled-popup-request' || e.code === 'gis/popup_closed')) return showAuth(mode);
    if (e && e.code === 'gis/popup_failed_to_open') return showAuth(mode, 'Your browser blocked the Google window. Allow pop-ups for this site and try again.');
    if (e && e.code === 'auth/invalid-credential') return showAuth(mode, 'Google sign-in was rejected. Check that the Web client ID in firebase-config.js is the one shown in Firebase → Authentication → Google.');
    if (e && /^gis\//.test(e.code || '')) return showAuth(mode, 'Google sign-in failed (' + e.code.slice(4) + '). Check the Web client ID and its authorized JavaScript origins.');
    if (e && e.code === 'auth/popup-closed-by-user') return showAuth(mode, 'The Google window closed before sign-in finished. If you did pick an account, your browser blocked the hand-back — open the app in Chrome/Safari (not an in-app browser) and try again.');
    const map = { 'auth/unauthorized-domain': 'This domain is not in Firebase → Authentication → Settings → Authorized domains.',
      'auth/network-request-failed': 'Network error. Check your internet connection.',
      'auth/web-storage-unsupported': 'This browser blocks storage, which sign-in needs. Turn off private/incognito mode or allow site data, then try again.',
      'auth/missing-initial-state': 'Your browser blocked the sign-in hand-back. Open the app in Chrome/Safari (not an in-app browser or a home-screen app) and try again.',
      'auth/operation-not-allowed': 'Enable the Google provider in Firebase → Authentication → Sign-in method.' };
    return showAuth(mode, map[e && e.code] || ('Sign-in failed (' + ((e && e.code) || (e && e.message)) + ').'));
  }
  await finishAuth(result, mode);
}
async function finishAuth(result, mode) {
  const { auth } = G.fb, user = result.user, info = auth.getAdditionalUserInfo(result), isNew = !!(info && info.isNewUser);
  try { sessionStorage.removeItem('paperly_auth_intent'); } catch (_) {}
  const mail = user.email || 'this Google account';
  if (mode === 'signin' && isNew) {                          // Google just created an account the person never signed up for → undo it
    G.holdAuthUi = Date.now() + 2500;                        // keep the sign-out event below from redrawing the panel over our message
    try { await auth.deleteUser(user); } catch (_) { try { await auth.signOut(G.auth); } catch (__) {} }
    G.verifying = false;
    return showAuth('signup', `No PaperLy account found for ${mail}. Please Sign up first.`);
  }
  if (mode === 'signup' && !isNew) {                         // already registered → ask them to use Sign in instead
    G.holdAuthUi = Date.now() + 2500;
    try { await auth.signOut(G.auth); } catch (_) {}
    G.verifying = false;
    return showAuth('signin', `${mail} already has a PaperLy account. Please Sign in.`);
  }
  G.verifying = false;
  afterLogin(user);
}

// ---------- firestore refs ----------
// v2 = automatic backup (no passphrase). "old" = the previous passphrase vault, only ever READ, to migrate it once.
const R = {
  d: (...p) => G.fb.fs.doc(G.db, 'users', G.uid, ...p),
  secrets: () => R.d('sync', 'secrets2'), prefs: () => R.d('sync', 'prefs2'), index: () => R.d('sync', 'index2'),
  hist: id => R.d('h2', id), chunk: (id, i) => R.d('h2', id + '_c' + i),
  old: {
    meta: () => R.d('vault', 'meta'), secrets: () => R.d('sync', 'secrets'), prefs: () => R.d('sync', 'prefs'), index: () => R.d('sync', 'index'),
    hist: id => R.d('hist', id), chunk: (id, i) => R.d('hist', id + '_c' + i)
  }
};
async function getData(ref) { const s = await T(G.fb.fs.getDoc(ref), 15000); return s.exists() ? s.data() : null; }
const setData = (ref, data) => T(G.fb.fs.setDoc(ref, data), 15000);
const patchSync = o => writeSync(Object.assign(readSync(), o));
// Start every cloud read we know we will need AT THE SAME TIME as soon as the person is signed in, so the restore
// waits for ONE round-trip instead of four in a row (old-vault check, API keys, settings, history list).
function prefetchCloud() {
  const grab = f => { const p = f(); p.catch(() => {}); return p; };
  G.preAt = Date.now();
  G.pre = { meta: grab(() => getData(R.old.meta())), secrets: grab(() => getData(R.secrets())), prefs: grab(() => getData(R.prefs())), index: grab(() => loadIndex()) };
}
async function takePre(key, fetcher) {
  const p = G.pre && G.pre[key]; if (G.pre) delete G.pre[key];
  if (p && Date.now() - G.preAt < 60000) { try { return await p; } catch (_) {} }
  return fetcher();
}

// ---------- one-time upgrade of an OLD passphrase-protected backup ----------
// New accounts never see any of this. It only runs for accounts that created the old vault.
const LEGACY_MSG = 'Your account has an older backup protected by a passphrase. Enter it once and it moves into the new automatic backup — after that you never need the passphrase again.';
function promptUnlock(msg, skipLabel) {
  return new Promise(resolve => {
    view(`<h2>Upgrade your old backup</h2>
      <p class="pg-muted">${esc(msg || LEGACY_MSG)}</p>
      <input class="pg-in" id="pg-p1" type="password" autocomplete="current-password" placeholder="Old backup passphrase">
      <div id="pg-err" class="pg-err" role="alert"></div>
      <button class="pg-btn" id="pg-go">Unlock &amp; upgrade</button>
      <button class="pg-link" id="pg-rec">Forgot passphrase? Use recovery key</button>
      <button class="pg-link" id="pg-skip">${esc(skipLabel || 'Skip')}</button>`);
    $('#pg-skip').onclick = () => resolve(false);
    $('#pg-rec').onclick = () => resolve(promptRecovery(skipLabel));
    const go = async () => {
      const btn = $('#pg-go'); btn.disabled = true; btn.textContent = 'Unlocking…';
      try { const r = await V.unlockWithPassphrase(G.uid, G.meta, $('#pg-p1').value); G.legacy = r.session; resolve(true); }
      catch (e) { btn.disabled = false; btn.textContent = 'Unlock & upgrade'; setErr(e.message === 'wrong-passphrase' ? 'Wrong passphrase. Try again.' : 'Unlock failed: ' + e.message); }
    };
    $('#pg-go').onclick = go; $('#pg-p1').onkeydown = e => { if (e.key === 'Enter') go(); };
    setTimeout(() => { const i = $('#pg-p1'); if (i) i.focus(); }, 50);
  });
}
function promptRecovery(skipLabel) {
  return new Promise(resolve => {
    view(`<h2>Use recovery key</h2>
      <input class="pg-in" id="pg-rk" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">
      <div id="pg-err" class="pg-err" role="alert"></div>
      <button class="pg-btn" id="pg-go">Unlock &amp; upgrade</button>
      <button class="pg-link" id="pg-skip">Back</button>`);
    $('#pg-skip').onclick = () => resolve(promptUnlock(LEGACY_MSG, skipLabel));
    $('#pg-go').onclick = async () => {
      try { const r = await V.unlockWithRecovery(G.uid, G.meta, $('#pg-rk').value); r.dek.fill(0); G.legacy = r.session; resolve(true); }
      catch (e) { setErr(/recovery/.test(e.message) ? "That recovery key doesn't match." : explain(e)); }
    };
  });
}
async function readLegacyEntry(id) {
  const head = await getData(R.old.hist(id)); if (!head) throw new Error('missing');
  const parts = await Promise.all(Array.from({ length: head.n }, (_, i) => getData(R.old.chunk(id, i))));
  return V.open(G.legacy, 'history', G.uid, id, { v: 1, z: head.z, iv: head.iv, ct: parts.map(p => p.d).join('') });
}
// Returns true when settings were restored locally (caller must reload the page).
async function migrateLegacy(force) {
  const st = readSync();
  if (st.legacyDone || (st.legacySkipped && !force)) return false;
  if (!V || !(window.crypto && window.crypto.subtle)) return false;   // only needed to open an OLD passphrase backup
  G.meta = await takePre('meta', () => getData(R.old.meta()));
  if (!G.meta) { patchSync({ legacyDone: true }); return false; }
  G.legacyPending = true;
  G.legacy = await V.sessionFromCache(G.uid);                 // devices that were already unlocked need no passphrase
  if (!G.legacy && !(await promptUnlock(LEGACY_MSG, 'Skip — start fresh (old backup stays untouched)'))) { patchSync({ legacySkipped: true }); renderDrawerHead(); return false; }
  let applied = false, failed = 0;
  wait('Upgrading your backup…');
  try {
    const openOld = async (purpose, ref) => { const d = await getData(ref); return d ? V.open(G.legacy, purpose, G.uid, purpose, d) : null; };
    const sec = await openOld('secrets', R.old.secrets());
    if (sec && groupIsEmpty('secrets', collectGroup('secrets'))) { applyGroup('secrets', sec.values || {}); applied = true; }
    const pr = await openOld('prefs', R.old.prefs());
    if (pr && groupIsEmpty('prefs', collectGroup('prefs'))) { applyGroup('prefs', pr.values || {}); applied = true; }
    const oldIdx = await openOld('index', R.old.index()), entries = (oldIdx && oldIdx.entries) || [];
    if (entries.length) await serial(async () => {
      const byId = new Map((await loadIndex()).map(e => [e.id, e])); let n = 0;
      for (const e of entries) {
        wait(`Upgrading your history… ${++n}/${entries.length}`);
        if (byId.has(e.id)) continue;
        try { await writeEntry(e.id, await readLegacyEntry(e.id)); byId.set(e.id, e); }
        catch (err) { if (err.message === 'decrypt-failed') throw err; failed++; console.warn('[cloud] old entry skipped', e.id, err); }
      }
      await saveIndex([...byId.values()]);
    });
  } catch (e) {
    if (e.message === 'decrypt-failed') { await V.clearCache(); G.legacy = null; patchSync({ legacySkipped: true }); toast('⚠️ Could not open the old backup — check the passphrase'); return false; }
    throw e;
  }
  patchSync({ legacyDone: true, legacySkipped: false });
  G.legacyPending = false; G.legacy = null; G.index = null; renderDrawerHead();
  if (failed) toast(`⚠️ ${failed} old session(s) could not be moved`);
  return applied;
}
async function runLegacyRestore() {
  try { if (await migrateLegacy(true)) { wait('Applying restored settings…'); location.reload(); return; } toast('✅ Old backup checked'); }
  catch (e) { console.warn('[cloud] legacy restore failed', e); toast('⚠️ ' + explain(e)); }
  closeGate();
}

// ---------- settings sync (API keys + prefs) ----------
function collectGroup(g) {
  const keys = g === 'secrets' ? SECRET_KEYS : PREF_KEYS, values = {};
  keys.forEach(k => { const v = lsGet(k); if (v != null) values[k] = v; });
  if (g === 'secrets' && values.aiModelsConfig_v1) {
    // Only stable fields — status / failure counters / active model change constantly and are per-device.
    try {
      const cfg = JSON.parse(values.aiModelsConfig_v1);
      values.aiModelsConfig_v1 = JSON.stringify((cfg.models || []).map(m => MODEL_FIELDS.reduce((o, f) => (m[f] !== undefined && (o[f] = m[f]), o), {})));
    } catch (_) { delete values.aiModelsConfig_v1; }
  }
  return values;
}
const groupIsEmpty = (g, v) => g === 'secrets' ? !v.aiModelsConfig_v1 || v.aiModelsConfig_v1 === '[]' : !Object.keys(v).length;
function applyGroup(g, values) {
  if (g === 'secrets') {
    let cfg = {}; try { cfg = JSON.parse(lsGet('aiModelsConfig_v1') || '{}'); } catch (_) {}
    const oldById = {}; (cfg.models || []).forEach(m => { oldById[m.id] = m; });
    let incoming = []; try { incoming = JSON.parse(values.aiModelsConfig_v1 || '[]'); } catch (_) {}
    const models = incoming.map(m => Object.assign({ status: 'idle', statusMessage: '' }, oldById[m.id] || {}, m));
    const active = models.some(m => m.id === cfg.activeModelId) ? cfg.activeModelId : (models[0] && models[0].id) || null;
    lsSet('aiModelsConfig_v1', JSON.stringify(Object.assign({}, cfg, { models, activeModelId: active })));
    SECRET_KEYS.slice(1).forEach(k => (values[k] != null ? lsSet(k, values[k]) : lsDel(k)));
  } else PREF_KEYS.forEach(k => (values[k] != null ? lsSet(k, values[k]) : lsDel(k)));
}
function askChoice(title, text, choices) {
  return new Promise(resolve => {
    const m = openModal(title, `<p style="margin:0 0 6px">${esc(text)}</p><div class="pm-actions">${choices.map((c, i) => `<button class="pm-b ${c.cls || ''}" data-i="${i}">${esc(c.label)}</button>`).join('')}</div>`, { locked: true });
    m.body.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => { closeModal(); resolve(choices[+b.dataset.i].value); }; });
  });
}
// API keys and preferences are both stored as plain values.
const refOf = g => (g === 'secrets' ? R.secrets() : R.prefs());
const encodeGroup = async (g, values, rev) => ({ v: 3, values, rev });
const decodeGroup = async (g, cloud) => {
  if (cloud.ct && V) {                                           // a backup written by the earlier encrypted version: read it once, next upload is plain
    const sess = await V.autoSession(G.uid);
    return (await V.open(sess, g, G.uid, g, cloud)).values || {};
  }
  return cloud.values || {};
};
async function reconcileSettings() {
  const st = readSync(); let reload = false;
  for (const g of ['secrets', 'prefs']) {
    const ref = refOf(g), cloud = await takePre(g, () => getData(ref));
    const local = collectGroup(g), lh = V.hash(JSON.stringify(local)), s = st[g] || {};
    const upload = async () => { const rev = Date.now(); await setData(ref, await encodeGroup(g, local, rev)); st[g] = { hash: lh, rev }; };
    const download = async () => {
      applyGroup(g, await decodeGroup(g, cloud));
      st[g] = { hash: V.hash(JSON.stringify(collectGroup(g))), rev: cloud.rev }; reload = true;
    };
    if (!cloud) { if (!groupIsEmpty(g, local)) await upload(); continue; }
    if (cloud.rev === s.rev) { if (lh !== s.hash && !groupIsEmpty(g, local)) await upload(); continue; }
    const untouched = s.hash !== undefined && lh === s.hash;
    try {
      if (groupIsEmpty(g, local) || untouched || g === 'prefs') await download();
      else {
        const pick = await askChoice(g === 'secrets' ? 'API keys differ' : 'Settings differ', 'This device and your cloud backup have different data. Which one should win?',
          [{ label: 'Use cloud backup', value: 'cloud', cls: 'pri' }, { label: 'Keep this device', value: 'local' }]);
        pick === 'cloud' ? await download() : await upload();
      }
    } catch (e) {
      if (e.message !== 'decrypt-failed') throw e;              // cloud copy unreadable → replace it with this device's copy
      console.warn('[cloud] cloud keys unreadable, replacing with local copy');
      if (!groupIsEmpty(g, local)) await upload();
    }
  }
  st.synced = 1; writeSync(st);
  return reload;
}
async function pushSettingsIfChanged() {
  const st = readSync();
  for (const g of ['secrets', 'prefs']) {
    const local = collectGroup(g), lh = V.hash(JSON.stringify(local));
    if ((st[g] || {}).hash === lh || groupIsEmpty(g, local)) continue;
    const rev = Date.now();
    await G.fb.fs.setDoc(refOf(g), await encodeGroup(g, local, rev));
    st[g] = { hash: lh, rev };
  }
  writeSync(st);
}


// ---------- session history ----------
function tabHasContent(t) {
  if (t.slideDeck && t.slideDeck.slides && t.slideDeck.slides.length > 0 && (t.slideDeck.slides.length > 1 || (t.slideDeck.slides[0].bullets || []).length)) return true;
  if (t.chatHistory && t.chatHistory.length) return true;
  const h = String(t.htmlContent || '');
  if (!h || h.includes('Start typing here')) return false;
  return h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length > 30 || /<(svg|img|table)/i.test(h);
}
function tabPayload(t) {
  const files = {};
  Object.entries(t.attachedFiles || {}).forEach(([id, f]) => { if (f) files[id] = { name: f.name, content: String(f.content || '').slice(0, 60000), status: f.status, order: f.order, sent: !!f.sent }; });
  return { name: t.name || 'Untitled', htmlContent: t.htmlContent || '', chatHistory: t.chatHistory || [], attachedFiles: files, projectVersion: t.projectVersion || 0,
    theme: t.theme, pdfVisualFormat: t.pdfVisualFormat, pdfTextFormat: t.pdfTextFormat, pdfLanguageFormat: t.pdfLanguageFormat, photocopyMode: !!t.photocopyMode, slideDeck: t.slideDeck || null };
}
function sessionTitle(p) {
  const n = String(p.name || '').trim();
  if (n && !/^(untitled|blank|loaded|untitled deck)$/i.test(n)) return n.slice(0, 80);
  const m = (p.chatHistory || []).find(x => x && x.role === 'user');
  const t = m && (typeof m.content === 'string' ? m.content : (m.text || m.message || ''));
  return t ? String(t).replace(/\s+/g, ' ').trim().slice(0, 70) : (n || 'Untitled');
}
const newId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let chain = Promise.resolve();                     // serialise cloud writes so the index never races itself
const serial = fn => { const run = chain.then(() => fn()); chain = run.catch(() => {}); return run; };
// History is stored as PLAIN text (fast: no encryption, no compression).
// Split on a UTF-8-safe size (Bengali = 3 bytes/char → 250k chars ≈ 750 KB < Firestore's 1 MiB/doc) and never inside an emoji pair.
function chunkText(s, size) {
  const out = []; let i = 0;
  while (i < s.length) {
    let e = Math.min(i + size, s.length);
    if (e < s.length) { const c = s.charCodeAt(e - 1); if (c >= 0xD800 && c <= 0xDBFF) e--; }
    out.push(s.slice(i, e)); i = e;
  }
  return out.length ? out : [''];
}
async function loadIndex() { const d = await getData(R.index()); return d ? (d.entries || []) : []; }
async function saveIndex(entries) {
  entries.sort((a, b) => b.updatedAt - a.updatedAt); entries = entries.slice(0, MAX_INDEX);
  await G.fb.fs.setDoc(R.index(), { v: 2, entries, rev: Date.now() });
  G.index = entries;
}
// Chunks are written first, the head document LAST — so a half-finished upload never looks like a valid entry.
async function writeEntry(id, payload) {
  const text = JSON.stringify(payload);
  if (text.length > MAX_UPLOAD_CHARS) throw new Error('too-large');
  const chunks = chunkText(text, PLAIN_CHUNK), fs = G.fb.fs;
  const old = await getData(R.hist(id)), oldN = old ? old.n : 0;
  for (let i = 0; i < chunks.length; i += 6) {                 // ≤ 6 chunks per batch keeps every commit far below the 10 MB limit
    const batch = fs.writeBatch(G.db);
    chunks.slice(i, i + 6).forEach((c, j) => batch.set(R.chunk(id, i + j), { d: c }));
    await batch.commit();
  }
  await G.fb.fs.setDoc(R.hist(id), { v: 2, n: chunks.length, rev: Date.now() });
  if (oldN > chunks.length) { const batch = fs.writeBatch(G.db); for (let i = chunks.length; i < oldN; i++) batch.delete(R.chunk(id, i)); await batch.commit(); }
  G.chunkCount[id] = chunks.length;
  return text.length;
}
async function readEntry(id, nHint) {
  const load = async n => {
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => getData(R.chunk(id, i))));
    return JSON.parse(parts.map(p => p.d).join(''));
  };
  if (nHint > 0) { try { return await load(nHint); } catch (_) { /* stale hint → read the real chunk count below */ } }
  const head = await getData(R.hist(id)); if (!head) throw new Error('missing');
  return load(head.n);
}
function pushHistory(tabs) {
  return serial(async () => {
    const changed = [];
    for (const t of tabs || []) {
      if (!tabHasContent(t)) continue;
      t.__cid = t.__cid || newId();
      const p = tabPayload(t), h = V.hash(JSON.stringify(p));
      if (G.hashes[t.__cid] !== h) changed.push({ id: t.__cid, p, h });
    }
    if (!changed.length) return false;
    const byId = new Map((await loadIndex()).map(e => [e.id, e]));
    for (const c of changed) {
      const size = await writeEntry(c.id, c.p);
      byId.set(c.id, { id: c.id, title: sessionTitle(c.p), kind: c.p.slideDeck ? 'slides' : 'doc', updatedAt: Date.now(), chats: c.p.chatHistory.length, kb: Math.round(size / 1024), n: G.chunkCount[c.id] });
      G.hashes[c.id] = c.h;
    }
    await saveIndex([...byId.values()]);
    return true;
  });
}
// Called by TAB_MANAGER.createTab() just before the current session is replaced.
window.__paperlyArchiveTabs = tabs => { if (G.ready) T(pushHistory(tabs), 120000).catch(e => console.warn('[cloud] archive failed', e)); };

// ---------- backup engine ----------
function setStatus(s, err) {
  G.status = s; G.err = err || '';
  const b = $('#paperly-avatar-btn'); if (b) b.className = 'logo-img ' + ({ ok: 'ok', busy: 'busy', err: 'err' }[s] || '');
  window.__paperlyBackupOn = !!G.user; renderDrawerHead();
}
function liveTabs() {
  const tm = window.TAB_MANAGER; if (!tm || !Array.isArray(tm.tabs)) return [];
  try { if (tm.activeId) tm._captureCurrentState(tm.activeId); } catch (_) {}
  return tm.tabs;
}
async function runBackup(manual) {
  if (!G.ready || !G.user) return;
  if (G.running) { if (manual) toast('⏳ Backup already running…'); return; }
  if (!navigator.onLine) { setStatus('err', 'Offline — will retry when back online'); return; }
  G.running = true; setStatus('busy');
  try {
    if (!G.reconciled) {                          // first sync on this device: pull anything newer from the cloud BEFORE pushing
      const reload = await T(reconcileSettings(), 60000);
      G.reconciled = true;
      if (reload) { toast('☁️ Restored your latest settings…'); setTimeout(() => location.reload(), 600); return; }
    }
    await T(pushSettingsIfChanged(), 30000);
    await T(pushHistory(liveTabs()), 90000);
    G.lastAt = Date.now(); setStatus('ok'); if (manual) toast('☁️ Backed up');
  } catch (e) {
    console.warn('[cloud] backup failed', e);
    setStatus('err', e.message === 'too-large' ? 'A session is too large to back up' : explain(e));
    if (manual) toast('⚠️ Backup failed — ' + (G.err || ''));
  } finally { G.running = false; }
}
function schedule(ms) { if (!G.ready || G.timer) return; G.timer = setTimeout(() => { G.timer = null; runBackup(false); }, ms || 8000); }
function startEngine() {
  if (G.engineOn || !G.ready) return; G.engineOn = true;
  const tm = window.TAB_MANAGER;
  if (tm && !tm._paperlyWrapped) { const orig = tm._persist; tm._persist = function () { const r = orig.apply(this, arguments); schedule(); return r; }; tm._paperlyWrapped = true; }
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k) { const r = setItem.apply(this, arguments); if (SYNC_KEYS.includes(k)) schedule(4000); return r; };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(G.timer); G.timer = null; runBackup(false); } });
  window.addEventListener('online', () => runBackup(false));
  setInterval(() => runBackup(false), 60000);
}

// ---------- modal + avatar + history drawer ----------
function openModal(title, html, o) {
  let m = $('#paperly-modal'); if (!m) { m = document.createElement('div'); m.id = 'paperly-modal'; document.body.appendChild(m); }
  m.innerHTML = `<div class="pm-card"><div class="pm-head"><h3>${esc(title)}</h3>${o && o.locked ? '' : '<button class="pm-x" aria-label="Close">×</button>'}</div><div class="pm-body">${html}</div></div>`;
  m.classList.add('show'); const x = $('.pm-x', m); if (x) x.onclick = closeModal;
  return { root: m, body: $('.pm-body', m) };
}
function closeModal() { const m = $('#paperly-modal'); if (m) m.classList.remove('show'); }
function faceHtml(u) {
  if (u && u.photoURL) return `<img referrerpolicy="no-referrer" alt="" src="${esc(u.photoURL)}">`;   // no-referrer: Google can't see which site loaded it
  const ch = ((u && (u.displayName || u.email)) || '?').trim().charAt(0).toUpperCase();
  return esc(ch);
}
function mountAvatar() {
  if (G.guest) { const gb = $('#paperly-avatar-btn'); if (gb) gb.title = 'Guest mode (offline) — account'; return; }
  const f = $('#paperly-avatar-btn .pa-face'); if (f && G.user) f.innerHTML = faceHtml(G.user);
  const b = $('#paperly-avatar-btn'); if (b && G.user) b.title = (G.user.email || 'Account') + ' — History';
}
function ago(t) { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 10 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : new Date(t).toLocaleString(); }
function statusText() {
  if (G.guest) return '📴 Guest mode — fully offline, nothing is backed up';
  if (!G.user) return 'Setup mode — not signed in';
  if (G.status === 'busy') return 'Backing up…';
  if (G.status === 'err') return '⚠️ ' + (G.err || 'Backup problem') + ' — retrying automatically';
  return '☁️ Auto backup ON • ' + ago(G.lastAt);
}
function ensureDrawer() {
  let d = $('#paperly-drawer'); if (d) return d;
  d = document.createElement('div'); d.id = 'paperly-drawer';
  d.innerHTML = `<div class="pd-scrim"></div><aside class="pd-panel" role="dialog" aria-label="Account and history">
    <div class="pd-head"><div class="pd-av" id="pd-av"></div><div class="pd-who"><b id="pd-name"></b><small id="pd-mail"></small></div><button class="pd-x" aria-label="Close">×</button></div>
    <div class="pd-stat" id="pd-stat"></div>
    <div class="pd-btns"><button class="pd-b pri" id="pd-new">＋ New session</button><button class="pd-b" id="pd-backup">☁️ Back up now</button></div>
    <button class="pd-b pd-inst" id="pd-inst" type="button"><span>📝 Instruction</span><small id="pd-inst-sub"></small></button>
    <button class="pd-b" id="pd-legacy" style="display:none">🔓 Restore old passphrase backup</button>
    <input class="pd-search" id="pd-search" type="search" placeholder="Search history…">
    <div class="pd-list" id="pd-list"></div>
    <button class="pd-b pri" id="pd-login" style="display:none">Sign in with Google (optional)</button>
    <button class="pd-b danger" id="pd-out">Sign out</button></aside>`;
  document.body.appendChild(d);
  $('.pd-scrim', d).onclick = $('.pd-x', d).onclick = closeDrawer;
  $('#pd-new', d).onclick = () => { closeDrawer(); if (typeof window.startNewProject === 'function') window.startNewProject(); };
  $('#pd-inst', d).onclick = () => { closeDrawer(); if (window.PaperlyInstruction) window.PaperlyInstruction.open(); };
  window.addEventListener('paperly:instruction-changed', renderInstructionSub);
  $('#pd-backup', d).onclick = () => runBackup(true);
  $('#pd-legacy', d).onclick = () => { closeDrawer(); runLegacyRestore(); };
  $('#pd-login', d).onclick = leaveGuest;
  $('#pd-out', d).onclick = signOutFlow;
  $('#pd-search', d).oninput = renderList;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  return d;
}
function renderInstructionSub() {
  const el = $('#pd-inst-sub'); if (!el) return;
  const P = window.PaperlyInstruction; if (!P) { el.textContent = ''; return; }
  const t = P.getText();
  el.textContent = (P.isDefault() ? 'Default • ' : (t ? 'Custom • ' : 'Off')) + (t ? t.replace(/\s*\n+\s*/g, ' · ') : '');
}
function renderDrawerHead() {
  const d = $('#paperly-drawer'); if (!d) return;
  $('#pd-av', d).innerHTML = G.guest ? '👤' : faceHtml(G.user);
  $('#pd-name', d).textContent = G.guest ? 'Guest' : (G.user ? (G.user.displayName || 'Account') : 'Not signed in');
  $('#pd-mail', d).textContent = G.guest ? 'Offline • this device only' : (G.user ? (G.user.email || '') : '');
  $('#pd-stat', d).textContent = statusText();
  renderInstructionSub();
  $('#pd-backup', d).style.display = G.user ? '' : 'none';
  $('#pd-out', d).style.display = G.user ? '' : 'none';
  $('#pd-login', d).style.display = G.guest ? '' : 'none';
  $('#pd-legacy', d).style.display = (G.user && G.legacyPending) ? '' : 'none';
}
async function openDrawer() {
  const d = ensureDrawer(); d.classList.add('show'); renderDrawerHead();
  const list = $('#pd-list', d);
  if (G.guest) {
    $('#pd-search', d).style.display = 'none';
    list.innerHTML = '<div class="pd-empty">Guest mode is fully offline, so sessions are not kept in History.<br>Sign in with Google any time to get automatic backup and History — your API keys and current work come with you.</div>';
    return;
  }
  if (!G.user) { $('#pd-search', d).style.display = 'none'; list.innerHTML = '<div class="pd-empty">Sign-in is not active in setup mode.</div>'; return; }
  $('#pd-search', d).style.display = '';
  if (!G.ready) { list.innerHTML = '<div class="pd-empty">Setting up your backup…</div>'; return; }
  if (G.index) renderList(); else list.innerHTML = '<div class="pd-empty">Loading history…</div>';
  try { G.index = await T(serial(() => takePre('index', loadIndex)), 20000); renderList(); }
  catch (e) { if (!G.index) list.innerHTML = `<div class="pd-empty">${esc(explain(e))}</div>`; }
  T(pushHistory(liveTabs()), 60000).then(changed => { if (changed) renderList(); }).catch(() => {});   // list the current session too, without making the person wait
}
function closeDrawer() { const d = $('#paperly-drawer'); if (d) d.classList.remove('show'); }
const currentCid = () => { const tm = window.TAB_MANAGER; const a = tm && tm.getActive && tm.getActive(); return a && a.__cid; };
function dayLabel(t) {
  const d = new Date(t), n = new Date(), y = new Date(Date.now() - 864e5);
  return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function renderList() {
  const d = $('#paperly-drawer'); if (!d) return;
  const list = $('#pd-list', d), q = ($('#pd-search', d).value || '').trim().toLowerCase(), cur = currentCid();
  const rows = (G.index || []).filter(e => !q || String(e.title).toLowerCase().includes(q));
  if (!rows.length) { list.innerHTML = `<div class="pd-empty">${q ? 'No matching sessions.' : 'No sessions yet. Everything you create is saved here automatically.'}</div>`; return; }
  let last = '';
  list.innerHTML = rows.map(e => {
    const lab = dayLabel(e.updatedAt), head = lab !== last ? `<div class="pd-day">${esc(lab)}</div>` : ''; last = lab;
    return `${head}<div class="pd-row ${e.id === cur ? 'cur' : ''}" data-id="${esc(e.id)}"><span>${e.kind === 'slides' ? '🖼️' : '💬'}</span>
      <div class="pd-t"><b>${esc(e.title)}</b><small>${e.id === cur ? 'Current session · ' : ''}${esc(new Date(e.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))} · ${e.chats || 0} msgs</small></div>
      <button class="pd-del" data-del title="Delete from cloud" aria-label="Delete">🗑</button></div>`;
  }).join('');
  list.querySelectorAll('.pd-row').forEach(row => {
    const id = row.dataset.id;
    row.onclick = async ev => {
      if (ev.target.closest('[data-del]')) return;
      if (id === cur) return closeDrawer();
      row.style.opacity = '.5';
      try { await openEntry(id); closeDrawer(); } catch (e) { row.style.opacity = ''; toast('⚠️ Could not open (' + (e.message || 'error') + ')'); }
    };
    row.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Delete this session from your cloud history? This cannot be undone.')) return;
      try { await deleteEntry(id); renderList(); } catch (e) { toast('⚠️ Delete failed'); }
    };
  });
}
async function openEntry(id) {
  const known = (G.index || []).find(e => e.id === id), p = await readEntry(id, known && known.n), tm = window.TAB_MANAGER;
  // createTab() archives + REPLACES the current session (single-session model)
  const tab = tm.createTab(p.name, p.htmlContent, { chatHistory: p.chatHistory || [], attachedFiles: p.attachedFiles || {}, undoStack: [], redoStack: [],
    projectVersion: p.projectVersion || 0, theme: p.theme, photocopyMode: !!p.photocopyMode, slideDeck: p.slideDeck || null }, true);
  ['pdfVisualFormat', 'pdfTextFormat', 'pdfLanguageFormat'].forEach(k => { if (p[k]) tab[k] = p[k]; });
  tab.__cid = id;                        // further edits update THIS history entry instead of creating a duplicate
  tm.switchTo(tab.id);
}
async function deleteEntry(id) {
  await serial(async () => {
    const head = await getData(R.hist(id)), batch = G.fb.fs.writeBatch(G.db);
    if (head) for (let i = 0; i < head.n; i++) batch.delete(R.chunk(id, i));
    batch.delete(R.hist(id)); await batch.commit();
    await saveIndex((await loadIndex()).filter(e => e.id !== id));
  });
  delete G.hashes[id];
  ((window.TAB_MANAGER || {}).tabs || []).forEach(t => { if (t.__cid === id) delete t.__cid; });
}
async function signOutFlow() {
  closeDrawer();
  if (G.ready) await Promise.race([runBackup(false), new Promise(r => setTimeout(r, 10000))]);
  const ok = G.status === 'ok';
  const pick = await askChoice('Sign out?', (ok ? '' : '⚠️ Your latest changes could NOT be backed up. ') +
    'Signing out removes API keys, history and settings from THIS device. Your cloud backup stays safe and comes back when you sign in again.',
    [{ label: 'Sign out', value: true, cls: 'danger' }, { label: 'Cancel', value: false }]);
  if (!pick) return;
  WIPE_KEYS.forEach(lsDel); await V.clearCache();
  try { await G.fb.auth.signOut(G.auth); } catch (_) {}
  location.reload();
}

// ---------- login / backup orchestration ----------
// Backup is automatic and always on for signed-in accounts: there is no setup screen, no passphrase and no off switch.
// If the cloud can't be reached the app still opens, and the backup engine keeps retrying by itself.
function continueAnyway() { closeGate(); setStatus('err', 'Connecting to the cloud…'); startEngine(); runBackup(false); }
async function setupBackupFlow() {
  let escaped = false;
  wait('Setting up your backup…', { label: 'Taking too long? Continue (backup keeps retrying)', fn: () => { escaped = true; continueAnyway(); } });
  try {
    if (await migrateLegacy(false)) { if (!escaped) { wait('Applying restored settings…'); location.reload(); } return; }
    if (escaped) return;
    wait('Restoring your backup…');
    if (await reconcileSettings()) { wait('Applying restored settings…'); location.reload(); return; }
    G.reconciled = true;
    closeGate(); setStatus('busy'); startEngine(); runBackup(false);
  } catch (e) {
    if (escaped) return;
    console.warn('[cloud] backup setup failed', e);
    showError("Backup couldn't start", explain(e), setupBackupFlow, continueAnyway);
  }
}
async function afterLogin(user) {
  if (G.started && G.uid === user.uid) return;
  G.user = user; G.uid = user.uid; G.started = true;
  mountAvatar();
  const owner = lsGet('paperly_local_owner');
  if (owner && owner !== user.uid) { WIPE_KEYS.forEach(lsDel); lsSet('paperly_local_owner', user.uid); location.reload(); return; }   // never mix two accounts' data
  lsSet('paperly_local_owner', user.uid);
  G.ready = true; prefetchCloud();
  { const st = readSync(); if (!st.v3) { st.v3 = 1; if (st.secrets) st.secrets.hash = '__reupload'; writeSync(st); } }   // one-time: re-upload API keys as plain text
  if (readSync().synced) { closeGate(); setStatus('busy'); startEngine(); runBackup(false); return; }   // known device: never make the person wait
  await setupBackupFlow();
}
async function boot() {
  const av = $('#paperly-avatar-btn'); if (av) av.onclick = () => openDrawer();
  if (!gate) return;
  if (isGuest()) return enterGuest();                           // Guest: Firebase is never even loaded → zero network contact with the backend
  if (!configured) return showUnconfigured();
    wait('Loading…'); preloadGis();
  try { await loadFirebase(); } catch (e) { return showError("Can't connect", 'Could not reach the cloud. Check your internet connection — or continue offline as a Guest.', boot, null, true); }
  // Finish a redirect-based sign-in (installed PWA / popup blocked) before listening for auth changes.
  let rr = null; G.verifying = true;
  try { rr = await G.fb.auth.getRedirectResult(G.auth); } catch (e) { G.verifying = false; showAuth('signin', 'Sign-in failed (' + (e.code || e.message) + ').'); }
  const pendingRedirect = lsGet('paperly_redirect_pending'); lsDel('paperly_redirect_pending');
  if (rr && rr.user) { let mode = 'signin'; try { mode = sessionStorage.getItem('paperly_auth_intent') || 'signin'; } catch (_) {} await finishAuth(rr, mode); } else {
    G.verifying = false;
    if (pendingRedirect && !G.auth.currentUser) { showAuth('signin', 'Google sign-in could not come back to the app. This happens in home-screen apps and in-app browsers. Open the site in Chrome/Safari and sign in there.'); return listenAuth(true); }
  }
  listenAuth(false);
}
function listenAuth(keepMessage) {
  G.fb.auth.onAuthStateChanged(G.auth, user => {
    if (G.verifying) return;
    if (user) afterLogin(user);
    else if (G.holdAuthUi && Date.now() < G.holdAuthUi) return;     // we just showed a Sign in / Sign up hint — don't wipe it
    else { G.started = false; G.uid = null; G.user = null; G.ready = false; G.reconciled = false; setStatus('off'); if (keepMessage) { keepMessage = false; return; } showAuth('signin'); }
  });
}
boot();