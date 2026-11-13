// Slide outline awaiting review (see slide-studio.js). Stored per tab so the
// AI "remembers" it for this session, including after a page reload. Size is
// capped so a huge attached-file context can never break tab persistence.
function _compactPendingOutlineForStorage(po) {
  if (!po || !po.outline) return null;
  try {
    const copy = Object.assign({}, po, { approveNow: false });
    let ser = JSON.stringify(copy);
    if (ser.length > 150000) {
      copy.sourceContext = String(copy.sourceContext || '').slice(0, 20000);
      ser = JSON.stringify(copy);
    }
    return ser.length <= 150000 ? copy : null;
  } catch (_) { return null; }
}

// ========================================================================
// TAB MANAGER - Multi-tab workspace with isolated state per tab
// ========================================================================

// Per-tab live File object maps (cannot be JSON-serialized to localStorage)
const TAB_FILE_OBJECTS = new Map();

// ========================================================================
// BOOT VIEW GUARD (no flash of the blank PDF page on refresh)
// ========================================================================
const BOOT_VIEW_KEY = 'paperly_boot_view';
function _releaseBootViewGuard() {
  try {
    const st = document.getElementById('boot-view-guard');
    if (st) st.remove();
  } catch (_) {}
}
(function _bootViewGuard() {
  try {
    let view = localStorage.getItem(BOOT_VIEW_KEY);
    if (view === null && typeof TAB_STORAGE_KEY !== 'undefined') {
      const raw = localStorage.getItem(TAB_STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const tabs = Array.isArray(d.tabs) ? d.tabs : [];
        const a = tabs.find(t => t.id === d.activeId) || tabs[0];
        view = (a && a.slideDeck && Array.isArray(a.slideDeck.slides) && a.slideDeck.slides.length) ? 'slides' : 'editor';
      }
    }
    if (view !== 'slides') return;
    const st = document.createElement('style');
    st.id = 'boot-view-guard';
    st.textContent = '#document-view-container{visibility:hidden !important;}';
    (document.head || document.documentElement).appendChild(st);
    setTimeout(_releaseBootViewGuard, 4000);
  } catch (_) {}
})();

function syncCurrentTabFileObjects() {
  try {
    const id = (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) ? TAB_MANAGER.activeId : null;
    if (!id) return;
    TAB_FILE_OBJECTS.set(id, { ...(window.APP_STATE?.fileObjects || {}) });
  } catch (e) {
    console.warn('syncCurrentTabFileObjects failed:', e);
  }
}

// ========================================================================
// RESET OF TRANSIENT CHAT STATE (behaves like a page refresh)
// ========================================================================
function _resetTransientChatState() {
  try {
    const S = window.APP_STATE;
    if (S) {
      S.pendingClarify = null;
      S.pendingPDFOutline = null;
      S.pendingExamOutline = null;
      S.clarifyInputLock = null;
      S.isAIGenerating = false;
    }
    if (typeof window._unlockChatInput === 'function') {
      try { window._unlockChatInput(); } catch (_) {}
    }
    const ta = document.getElementById('chat-input-textarea');
    if (ta) {
      ta.readOnly = false;
      ta.disabled = false;
      ta.classList.remove('clarify-locked');
      ta.style.opacity = '';
      ta.style.cursor = '';
      if (ta.dataset && ta.dataset.prevPlaceholder !== undefined) {
        ta.placeholder = ta.dataset.prevPlaceholder;
        delete ta.dataset.prevPlaceholder;
      }
      ta.value = '';
    }
    const sendBtn = document.getElementById('send-message-btn');
    if (sendBtn) sendBtn.disabled = false;
  } catch (e) {
    console.warn('[TabManager] _resetTransientChatState failed:', e);
  }
}

// ========================================================================
// STUDIO SETTINGS — global user preferences (persisted in localStorage)
// ------------------------------------------------------------------------
// Two user-facing switches, both rendered with English labels only:
//
//   1) useAIVision          (default true)
//        ON  → local OCR runs first; AI vision used as a fallback for
//              images/scanned pages it cannot read.
//        OFF → vision disabled entirely; unreadable content kept as-is.
//
//   2) keepFiguresAsImage   (default true)
//        ON  → figures in text-layer pages are cropped as images.
//        OFF → AI recreates figures from the text layer (requires
//              useAIVision = ON to have any effect).
//
//   3) showQuotes           (default true)
//        ON  → the processing modal shows a fresh AI-written quote.
//        OFF → no quote is shown and no AI request is made for quotes.
//
//   4) showToasts           (default true)
//        ON  → toast notifications are shown.
//        OFF → every displayToastNotification() call is silently skipped.
//
//   5) pdfOutlineReview     (default true)
//        ON  → Create PDF first shows a compact outline for review/approval.
//        OFF → Create PDF skips the outline step and writes the PDF directly.
//
//   6) showPdfSummary       (default true)
//        ON  → a document summary card is shown in chat after a PDF is made.
//        OFF → no summary card is shown.
//
// ocr.js reads the values through these compatibility shims:
//   window.isOcrKeepImageSwitchOn()        → true  when images should NOT be read
//   window.isTextFigureRecreateSwitchOn()  → true  only when vision is on AND keepFiguresAsImage is off
// ========================================================================
const STUDIO_SETTINGS_KEY = 'paperly_studio_settings_v1';

const STUDIO_SETTINGS_DEFAULTS = Object.freeze({
  useAIVision: true,
  keepFiguresAsImage: true,
  showQuotes: true,
  showToasts: true,
  pdfOutlineReview: true,
  showPdfSummary: true,
  aiSuggestions: true,
});

function _loadStudioSettings() {
  const out = Object.assign({}, STUDIO_SETTINGS_DEFAULTS);
  try {
    const raw = localStorage.getItem(STUDIO_SETTINGS_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return out;
    if (typeof parsed.useAIVision === 'boolean') out.useAIVision = parsed.useAIVision;
    if (typeof parsed.keepFiguresAsImage === 'boolean') out.keepFiguresAsImage = parsed.keepFiguresAsImage;
    if (typeof parsed.showQuotes === 'boolean') out.showQuotes = parsed.showQuotes;
    if (typeof parsed.showToasts === 'boolean') out.showToasts = parsed.showToasts;
    if (typeof parsed.pdfOutlineReview === 'boolean') out.pdfOutlineReview = parsed.pdfOutlineReview;
    if (typeof parsed.showPdfSummary === 'boolean') out.showPdfSummary = parsed.showPdfSummary;
    if (typeof parsed.aiSuggestions === 'boolean') out.aiSuggestions = parsed.aiSuggestions;
    // Backward compat with the older key scheme
    if (parsed.ocrImagePolicy === 'keep-image' && typeof parsed.useAIVision !== 'boolean') out.useAIVision = false;
    if (parsed.ocrImagePolicy === 'read-vision' && typeof parsed.useAIVision !== 'boolean') out.useAIVision = true;
    if (parsed.textFigurePolicy === 'crop' && typeof parsed.keepFiguresAsImage !== 'boolean') out.keepFiguresAsImage = true;
    if (parsed.textFigurePolicy === 'recreate' && typeof parsed.keepFiguresAsImage !== 'boolean') out.keepFiguresAsImage = false;
  } catch (_) {}
  return out;
}

function _saveStudioSettings() {
  try {
    const s = (window.APP_STATE && window.APP_STATE.studioSettings) || STUDIO_SETTINGS_DEFAULTS;
    localStorage.setItem(STUDIO_SETTINGS_KEY, JSON.stringify({
      useAIVision: !!s.useAIVision,
      keepFiguresAsImage: !!s.keepFiguresAsImage,
      showQuotes: s.showQuotes !== false,
      showToasts: s.showToasts !== false,
      pdfOutlineReview: s.pdfOutlineReview !== false,
      showPdfSummary: s.showPdfSummary !== false,
      aiSuggestions: s.aiSuggestions !== false,
    }));
  } catch (_) {}
}

// Load settings the moment this file is parsed so ocr.js can read them
// synchronously even before DOMContentLoaded runs.
(function _initStudioSettings() {
  if (!window.APP_STATE) window.APP_STATE = {};
  window.APP_STATE.studioSettings = _loadStudioSettings();
})();

window.STUDIO_SETTINGS_DEFAULTS = STUDIO_SETTINGS_DEFAULTS;

window.getStudioSettings = function () {
  if (!window.APP_STATE) window.APP_STATE = {};
  if (!window.APP_STATE.studioSettings) {
    window.APP_STATE.studioSettings = _loadStudioSettings();
  }
  return Object.assign({}, window.APP_STATE.studioSettings);
};

window.getStudioSetting = function (key) {
  const s = window.getStudioSettings();
  return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : STUDIO_SETTINGS_DEFAULTS[key];
};

window.setStudioSetting = function (key, value) {
  if (!Object.prototype.hasOwnProperty.call(STUDIO_SETTINGS_DEFAULTS, key)) {
    console.warn('[StudioSettings] unknown key:', key);
    return;
  }
  value = !!value;
  if (!window.APP_STATE) window.APP_STATE = {};
  if (!window.APP_STATE.studioSettings) window.APP_STATE.studioSettings = _loadStudioSettings();
  if (!!window.APP_STATE.studioSettings[key] === value) return;
  window.APP_STATE.studioSettings[key] = value;
  _saveStudioSettings();
  try {
    window.dispatchEvent(new CustomEvent('studio-settings-changed', {
      detail: { key: key, value: value, settings: window.getStudioSettings() }
    }));
  } catch (_) {}
};

window.resetStudioSettings = function () {
  if (!window.APP_STATE) window.APP_STATE = {};
  window.APP_STATE.studioSettings = Object.assign({}, STUDIO_SETTINGS_DEFAULTS);
  _saveStudioSettings();
  try {
    window.dispatchEvent(new CustomEvent('studio-settings-changed', {
      detail: { key: '*', value: null, settings: window.getStudioSettings() }
    }));
  } catch (_) {}
};

window.onStudioSettingChange = function (callback) {
  if (typeof callback !== 'function') return function () {};
  const handler = function (e) { callback(e.detail || {}); };
  window.addEventListener('studio-settings-changed', handler);
  return function () { window.removeEventListener('studio-settings-changed', handler); };
};

// ---- Toast on/off gate ----
// displayToastNotification() lives in ui-helpers.js (loaded before this file)
// and is called from many places. Instead of touching every call site, the
// function is wrapped ONCE here: when the "showToasts" setting is off the call
// is skipped. The setting is read at call time, so toggling takes effect
// immediately. Safe to run more than once (the wrapper is tagged).
(function _installToastGate() {
  function install() {
    const orig = window.displayToastNotification;
    if (typeof orig !== 'function') return false;
    if (orig.__studioToastGate) return true;
    const gated = function () {
      let on = true;
      try { on = window.getStudioSetting('showToasts') !== false; } catch (_) {}
      if (!on) return undefined;
      return orig.apply(this, arguments);
    };
    gated.__studioToastGate = true;
    gated.__original = orig;
    window.displayToastNotification = gated;
    return true;
  }
  if (install()) return;
  // ui-helpers.js not ready yet — retry once the page has finished loading.
  const retry = function () { install(); };
  document.addEventListener('DOMContentLoaded', retry);
  window.addEventListener('load', function () {
    if (!install()) console.warn('[StudioSettings] displayToastNotification not found — the toast switch has no effect.');
  });
})();

// ---- OCR compatibility API (ocr.js reads only these) ----
window.isOcrKeepImageSwitchOn = function () {
  return !window.getStudioSetting('useAIVision');
};
window.isTextFigureRecreateSwitchOn = function () {
  return !!window.getStudioSetting('useAIVision') && !window.getStudioSetting('keepFiguresAsImage');
};
window.getOcrImagePolicy = function () {
  return window.getStudioSetting('useAIVision') ? 'read-vision' : 'keep-image';
};
window.getTextFigurePolicy = function () {
  return window.getStudioSetting('keepFiguresAsImage') ? 'crop' : 'recreate';
};

// ---- Settings panel switch renderer (English labels only) ----
// Renders the studio switches into the given container. Safe to call any
// number of times: the previous event subscription is always cleaned up
// before a new one is installed (avoids double-firing).
//
// UX notes:
//  - Each switch shows only its label + On/Off; the explanation and the
//    "what happens now" status are tucked behind a "See details" toggle.
//  - Clicking the label toggles the setting (bigger target than the switch).
//  - The dependent switch ("Keep figures as images") is truly disabled while
//    AI Vision is off and the stored choice is preserved, not overwritten.
//  - Focus / active / selection colours are light green (not browser blue).
//  - "Reset to defaults" appears only when something differs from defaults.
(function _injectStudioSettingsStyle() {
  if (typeof document === 'undefined') return;
  function inject() {
    if (document.getElementById('studio-settings-style')) return;
    const G = 'rgba(var(--ink-rgb),.55)';  // neutral ink accent (theme-aware)
    const GA = 'rgba(var(--ink-rgb),.10)'; // soft glass fill
    const st = document.createElement('style');
    st.id = 'studio-settings-style';
    st.textContent = [
      /* ---- layout fix: tab bar must never be squeezed out by tall panels ---- */
      '.settings-tab-bar{flex:0 0 auto !important;min-height:44px;max-height:none !important;}',
      '.settings-tab-bar [data-tab]{flex-shrink:0;}',
      /* ---- AGGRESSIVE top-space removal under the tab bar ---- */
      '.settings-tab-panel{min-height:0;padding-top:0 !important;margin-top:0 !important;}',
      '.settings-tab-panel>div:empty,.settings-tab-panel>section:empty,.settings-tab-panel>header:empty,.settings-tab-panel>p:empty,.settings-tab-panel>span:empty,.settings-tab-panel>h1:empty,.settings-tab-panel>h2:empty,.settings-tab-panel>h3:empty,.settings-tab-panel>h4:empty,.settings-tab-panel>h5:empty,.settings-tab-panel>h6:empty{display:none !important;height:0 !important;margin:0 !important;padding:0 !important;border:0 !important;}',
      '.settings-tab-panel>[class*="heading"]:empty,.settings-tab-panel>[class*="header"]:empty,.settings-tab-panel>[class*="title"]:empty,.settings-tab-panel>[class*="spacer"]:empty,.settings-tab-panel>[class*="gap"]:empty,.settings-tab-panel>[class*="divider"]:empty{display:none !important;height:0 !important;margin:0 !important;padding:0 !important;border:0 !important;}',
      '.settings-tab-panel>:first-child{margin-top:0 !important;padding-top:0 !important;}',
      '.settings-tab-panel>:first-child>:first-child{margin-top:0 !important;padding-top:0 !important;}',
      '.settings-tab-panel>:first-child>:first-child>:first-child{margin-top:0 !important;padding-top:0 !important;}',
      '.settings-tab-panel>:first-child>:is(h1,h2,h3,h4,h5,h6){margin-top:0 !important;padding-top:0 !important;}',
      '.settings-tab-panel>:first-child>:first-child>:is(h1,h2,h3,h4,h5,h6){margin-top:0 !important;padding-top:0 !important;}',
      /* ---- AI Configuration: collapse the dead band above "Model list" ---- */
      '[data-studio-gap="hide"]{display:none !important;}',
      '[data-studio-gap="flat"],[data-studio-gap="flat"] *{margin-top:0 !important;margin-bottom:0 !important;padding-top:0 !important;padding-bottom:0 !important;border-top-width:0 !important;border-bottom-width:0 !important;min-height:0 !important;height:auto !important;max-height:none !important;}',
      '[data-studio-top="1"]{margin-top:0 !important;padding-top:0 !important;border-top-width:0 !important;}',
      /* ---- green instead of blue: active tab, focus, selection ---- */
      '.settings-tab-bar [data-tab].active,.settings-tab-bar [data-tab][aria-selected="true"]{background:' + GA + ' !important;color:inherit !important;border-color:' + G + ' !important;box-shadow:inset 0 -2px 0 ' + G + ' !important;}',
      '.settings-tab-bar [data-tab]:focus-visible,.settings-tab-panel :is(button,a,input,select,textarea,[role="switch"]):focus-visible{outline:2px solid ' + G + ' !important;outline-offset:2px;}',
      '.settings-tab-panel :is(input,select,textarea):focus{border-color:' + G + ' !important;box-shadow:0 0 0 3px rgba(var(--ink-rgb),.14) !important;outline:none;}',
      '.settings-tab-panel{accent-color:' + G + ';}',
      '.settings-tab-panel ::selection{background:rgba(var(--ink-rgb),.22);}',
      /* ---- studio rows ---- */
      '.studio-settings-list{display:flex;flex-direction:column;}',
      '.studio-setting-row{display:flex;align-items:center;gap:16px;padding:12px 8px;border-bottom:1px solid rgba(var(--ink-rgb),.12);cursor:pointer;border-radius:8px;transition:background .15s;}',
      '.studio-setting-row:hover,.studio-setting-row:focus-within{background:rgba(var(--ink-rgb),.06);}',
      '.studio-setting-row.is-disabled{cursor:not-allowed;}',
      '.studio-setting-row.is-disabled:hover{background:transparent;}',
      '.studio-setting-text{flex:1;min-width:0;}',
      '.studio-setting-label{font-weight:600;font-size:14px;line-height:1.3;}',
      '.studio-setting-row.is-disabled .studio-setting-label{opacity:.55;}',
      /* ---- "See details" toggle: neutral gray (was green) ---- */
      '.studio-details-toggle{display:inline-flex;align-items:center;gap:4px;margin-top:3px;padding:0;border:none;background:none;font:inherit;font-size:12px;color:#6b7280;cursor:pointer;transition:color .15s;}',
      '.studio-details-toggle:hover{text-decoration:underline;color:#4b5563;}',
      '.studio-details-toggle::after{content:"";width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translateY(-1px);transition:transform .2s;}',
      '.studio-details-toggle[aria-expanded="true"]::after{transform:rotate(225deg);}',
      /* ---- Dark mode: keep the "See details" toggle gray, never green ---- */
      'html.dark .studio-details-toggle,body.dark .studio-details-toggle,body.dark-mode .studio-details-toggle,body.theme-dark .studio-details-toggle,body.dark-theme .studio-details-toggle,html.dark-mode .studio-details-toggle,html.theme-dark .studio-details-toggle,html.dark-theme .studio-details-toggle,[data-theme="dark"] .studio-details-toggle,.dark-theme .studio-details-toggle,.dark-mode .studio-details-toggle{color:#9ca3af !important;}',
      'html.dark .studio-details-toggle:hover,body.dark .studio-details-toggle:hover,body.dark-mode .studio-details-toggle:hover,body.theme-dark .studio-details-toggle:hover,body.dark-theme .studio-details-toggle:hover,html.dark-mode .studio-details-toggle:hover,html.theme-dark .studio-details-toggle:hover,html.dark-theme .studio-details-toggle:hover,[data-theme="dark"] .studio-details-toggle:hover,.dark-theme .studio-details-toggle:hover,.dark-mode .studio-details-toggle:hover{color:#d1d5db !important;}',
      /* Fallback when the OS prefers dark AND the app hasn't explicitly set light theme */
      '@media (prefers-color-scheme: dark){html:not([data-theme="light"]):not(.light):not(.light-theme):not(.light-mode) .studio-details-toggle{color:#9ca3af;}html:not([data-theme="light"]):not(.light):not(.light-theme):not(.light-mode) .studio-details-toggle:hover{color:#d1d5db;}}',
      '.studio-setting-details{margin-top:8px;padding:8px 10px;border-left:2px solid ' + G + ';background:rgba(var(--ink-rgb),.05);border-radius:0 6px 6px 0;cursor:default;}',
      '.studio-setting-details[hidden]{display:none;}',
      '.studio-setting-desc{font-size:12.5px;opacity:.8;line-height:1.5;}',
      '.studio-setting-status{font-size:12px;margin-top:6px;line-height:1.45;opacity:.95;}',
      '.studio-setting-control{display:flex;flex-direction:column;align-items:center;gap:4px;flex:0 0 auto;}',
      '.studio-switch{position:relative;width:46px;height:26px;border-radius:13px;border:none;cursor:pointer;background:rgba(var(--ink-rgb),.28);transition:background .2s;padding:0;flex:0 0 auto;}',
      '.studio-switch[aria-checked="true"]{background:var(--glass-active-bg,rgba(var(--ink-rgb),.2)),var(--glass-active-tint,rgba(var(--ink-rgb),.14));box-shadow:inset 0 0 0 1px var(--glass-active-border,rgba(var(--ink-rgb),.3)),inset 0 1px 0 var(--glass-hi,rgba(255,255,255,.5));backdrop-filter:blur(10px) saturate(160%);-webkit-backdrop-filter:blur(10px) saturate(160%);}',
      '.studio-switch[aria-disabled="true"]{cursor:not-allowed;opacity:.5;}',
      '.studio-switch::after{content:"";position:absolute;inset:-9px -4px;}',
      '.studio-switch-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(236,238,244,.92));box-shadow:0 1px 4px rgba(40,44,60,.28),inset 0 1px 0 #fff;transition:transform .2s;}',
      '.studio-switch[aria-checked="true"] .studio-switch-knob{transform:translateX(20px);}',
      '.studio-native-hidden{position:absolute !important;width:1px !important;height:1px !important;margin:-1px !important;padding:0 !important;overflow:hidden !important;clip:rect(0 0 0 0) !important;opacity:0 !important;pointer-events:none !important;border:0 !important;}',
      '.studio-switch-state{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.6;}',
      '.studio-settings-footer{display:flex;justify-content:flex-end;padding-top:12px;min-height:34px;}',
      '.studio-reset-btn{font:inherit;font-size:12.5px;padding:6px 12px;border-radius:8px;border:1px solid rgba(var(--ink-rgb),.22);background:transparent;color:inherit;cursor:pointer;transition:background .15s;}',
      '.studio-reset-btn:hover{background:' + GA + ';border-color:' + G + ';}',
      '.studio-reset-btn[hidden]{display:none;}',
      '@media (pointer:coarse){.studio-switch{width:52px;height:30px;border-radius:15px;}.studio-switch-knob{width:24px;height:24px;}.studio-switch[aria-checked="true"] .studio-switch-knob{transform:translateX(22px);}}',
      '@media (prefers-reduced-motion:reduce){.studio-switch,.studio-switch-knob,.studio-setting-row,.studio-reset-btn,.studio-details-toggle,.studio-details-toggle::after{transition:none;}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  if (document.head) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();

// Builds the shared "label + See details + control" row skeleton.
function _studioBuildRowShell(idBase, labelText, descText) {
  const row = document.createElement('div');
  row.className = 'studio-setting-row';

  const text = document.createElement('div');
  text.className = 'studio-setting-text';

  const label = document.createElement('div');
  label.className = 'studio-setting-label';
  label.id = idBase + '-label';
  label.textContent = labelText;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'studio-details-toggle';
  toggle.textContent = 'See details';
  toggle.setAttribute('aria-expanded', 'false');

  const details = document.createElement('div');
  details.className = 'studio-setting-details';
  details.id = idBase + '-details';
  details.hidden = true;
  toggle.setAttribute('aria-controls', details.id);

  const desc = document.createElement('div');
  desc.className = 'studio-setting-desc';
  desc.textContent = descText;

  const status = document.createElement('div');
  status.className = 'studio-setting-status';
  details.appendChild(desc);
  details.appendChild(status);

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Hide details' : 'See details';
    details.hidden = !open;
  });

  text.appendChild(label);
  text.appendChild(toggle);
  text.appendChild(details);
  row.appendChild(text);

  const control = document.createElement('div');
  control.className = 'studio-setting-control';
  row.appendChild(control);

  return { row: row, label: label, details: details, status: status, control: control };
}

window.renderStudioSwitches = function (containerEl, options) {
  if (!containerEl) return function () {};
  const opts = options || {};
  const idPrefix = opts.idPrefix || 'studio-setting';
  const showReset = opts.showReset !== false;

  // Tear down the previous listener if this container was already rendered.
  if (containerEl._studioSwitchUnsubscribe) {
    try { containerEl._studioSwitchUnsubscribe(); } catch (_) {}
    containerEl._studioSwitchUnsubscribe = null;
  }

  containerEl.textContent = '';
  const list = document.createElement('div');
  list.className = 'studio-settings-list';
  containerEl.appendChild(list);
  const rows = [];

  function buildSwitch(cfg) {
    const key = cfg.key;
    const shell = _studioBuildRowShell(idPrefix + '-' + key, cfg.label, cfg.desc);
    const row = shell.row;
    row.setAttribute('data-setting-key', key);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = idPrefix + '-' + key;
    btn.className = 'studio-switch';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-labelledby', shell.label.id);
    btn.setAttribute('aria-describedby', shell.details.id);

    const knob = document.createElement('span');
    knob.className = 'studio-switch-knob';
    btn.appendChild(knob);

    const stateText = document.createElement('span');
    stateText.className = 'studio-switch-state';
    stateText.setAttribute('aria-hidden', 'true');

    shell.control.appendChild(btn);
    shell.control.appendChild(stateText);

    function isLocked() {
      return !!cfg.requires && !window.getStudioSetting(cfg.requires);
    }

    function render() {
      const locked = isLocked();
      // While locked, show what will actually happen (the locked value),
      // but never overwrite the user's stored choice.
      const on = locked ? cfg.lockedValue : !!window.getStudioSetting(key);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      row.classList.toggle('is-on', on);
      row.classList.toggle('is-disabled', locked);
      stateText.textContent = on ? 'On' : 'Off';
      shell.status.textContent = locked ? cfg.lockedStatus : (on ? cfg.onStatus : cfg.offStatus);
      btn.title = locked ? cfg.lockedStatus : '';
    }

    function toggle() {
      if (isLocked()) return;
      window.setStudioSetting(key, !window.getStudioSetting(key));
      rows.forEach(function (r) { r.render(); });
    }

    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    row.addEventListener('click', function (e) {
      if (e.target.closest('.studio-switch, .studio-details-toggle, .studio-setting-details')) return;
      toggle();
    });

    render();
    list.appendChild(row);
    return { row: row, render: render };
  }

  rows.push(buildSwitch({
    key: 'useAIVision',
    label: 'Use AI Vision',
    desc: 'Read scanned pages and images that local OCR can\u2019t handle.',
    onStatus: 'Local OCR runs first; AI vision steps in only when it can\u2019t read something.',
    offStatus: 'AI vision is off. Unreadable images and scans are kept as they are.'
  }));
  rows.push(buildSwitch({
    key: 'keepFiguresAsImage',
    label: 'Keep figures as images',
    desc: 'How diagrams and figures on text-based pages are handled.',
    requires: 'useAIVision',
    lockedValue: true,
    onStatus: 'Figures are cropped from the page and inserted as images.',
    offStatus: 'AI recreates figures from the page text. Results may differ from the original.',
    lockedStatus: 'Locked on while AI Vision is off. Turn on \u201cUse AI Vision\u201d to let AI recreate figures.'
  }));
  rows.push(buildSwitch({
    key: 'showQuotes',
    label: 'Show quotes',
    desc: 'Show a short quote in the processing window while your file is being processed.',
    onStatus: 'A fresh AI-written quote appears in the processing window.',
    offStatus: 'No quote is shown, and no AI request is made for quotes.'
  }));
  rows.push(buildSwitch({
    key: 'showToasts',
    label: 'Toast notifications',
    desc: 'Small pop-up messages that appear briefly at the edge of the screen (for example when a note is generated).',
    onStatus: 'Toast notifications are shown.',
    offStatus: 'Toast notifications are hidden. Messages in the chat are not affected.'
  }));
  rows.push(buildSwitch({
    key: 'pdfOutlineReview',
    label: 'Outline before creating PDF',
    desc: 'Show a short outline in the chat for you to review before the PDF is written.',
    onStatus: 'You review and approve an outline first, then the PDF is written from it.',
    offStatus: 'The outline step is skipped. The PDF is written directly from your request.'
  }));
  rows.push(buildSwitch({
    key: 'showPdfSummary',
    label: 'Summary after creating PDF',
    desc: 'Show a summary card in the chat (pages, words, reading time, sections and more) once the PDF is ready.',
    onStatus: 'A summary card appears in the chat after the PDF is generated.',
    offStatus: 'No summary card is shown after the PDF is generated.'
  }));
  rows.push(buildSwitch({
    key: 'aiSuggestions',
    label: 'AI suggestions',
    desc: 'When Chat is switched on next to Add, Edit or Refine, the AI offers a set of 3–5 ready-to-tap suggestions.',
    onStatus: 'The AI shows 3–5 suggestion buttons you can tap to apply.',
    offStatus: 'No suggestion buttons. The AI replies with a short plain message instead.'
  }));

  let resetBtn = null;
  function renderReset() {
    if (!resetBtn) return;
    const cur = window.getStudioSettings();
    resetBtn.hidden = !Object.keys(STUDIO_SETTINGS_DEFAULTS).some(function (k) {
      return !!cur[k] !== !!STUDIO_SETTINGS_DEFAULTS[k];
    });
  }
  if (showReset) {
    const footer = document.createElement('div');
    footer.className = 'studio-settings-footer';
    resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'studio-reset-btn';
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.addEventListener('click', function () {
      window.resetStudioSettings();
      rows.forEach(function (r) { r.render(); });
      renderReset();
      if (typeof displayToastNotification === 'function') displayToastNotification('Settings reset to defaults');
    });
    footer.appendChild(resetBtn);
    containerEl.appendChild(footer);
    renderReset();
  }

  const unsubscribe = window.onStudioSettingChange(function () {
    rows.forEach(function (r) { r.render(); });
    renderReset();
  });
  containerEl._studioSwitchUnsubscribe = unsubscribe;
  return unsubscribe;
};

// ---- Backup / restore of the studio switches ----
// Same JSON-in / JSON-out shape idea as the AI model export: hook these two
// into the model Export / Import buttons so switches travel with the models.
window.getStudioSettingsBackup = function () {
  return { version: 1, studioSettings: window.getStudioSettings() };
};
window.restoreStudioSettingsBackup = function (data) {
  try {
    const src = data && typeof data === 'object' ? (data.studioSettings || data) : null;
    if (!src || typeof src !== 'object') return false;
    let applied = false;
    Object.keys(STUDIO_SETTINGS_DEFAULTS).forEach(function (k) {
      if (typeof src[k] === 'boolean') { window.setStudioSetting(k, src[k]); applied = true; }
    });
    return applied;
  } catch (_) { return false; }
};

// ---- Horizontal settings tabs (Preference / AI Configuration) ----
window.showSettingsTab = function (tabName) {
  const tabBar = document.querySelector('.settings-tab-bar');
  if (!tabBar) return false;
  const tabs = Array.prototype.slice.call(tabBar.querySelectorAll('[data-tab]'));
  const panels = document.querySelectorAll('.settings-tab-panel');
  if (!tabs.some(function (b) { return b.dataset.tab === tabName; })) return false;
  tabs.forEach(function (b) {
    const isActive = b.dataset.tab === tabName;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    b.tabIndex = isActive ? 0 : -1;
  });
  panels.forEach(function (p) {
    p.hidden = p.dataset.panel !== tabName;
  });
  try { _studioEnsureTabLabel(); } catch (_) {}
  try { _studioTrimEmptyPanelSpace(); } catch (_) {}
  return true;
};

window.initSettingsTabs = function () {
  try {
    const tabBar = document.querySelector('.settings-tab-bar');
    if (!tabBar) return;
    if (tabBar.dataset.tabsInit === '1') return;
    const panels = document.querySelectorAll('.settings-tab-panel');
    if (!panels.length) return;

    tabBar.dataset.tabsInit = '1';
    tabBar.setAttribute('role', 'tablist');

    // Drop Permissions and rename the middle tab BEFORE wiring ARIA/events.
    try { window.restructureSettingsPanel(); } catch (e) { console.warn('[StudioSettings] restructure failed:', e); }

    const livePanels = document.querySelectorAll('.settings-tab-panel');
    tabBar.querySelectorAll('[data-tab]').forEach(function (b) {
      const name = b.dataset.tab;
      b.setAttribute('role', 'tab');
      if (!b.id) b.id = 'settings-tab-' + name;
      livePanels.forEach(function (p) {
        if (p.dataset.panel !== name) return;
        if (!p.id) p.id = 'settings-panel-' + name;
        p.setAttribute('role', 'tabpanel');
        p.setAttribute('aria-labelledby', b.id);
        b.setAttribute('aria-controls', p.id);
      });
    });

    tabBar.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      window.showSettingsTab(btn.dataset.tab);
    });

    tabBar.addEventListener('keydown', function (e) {
      const tabs = Array.prototype.slice.call(tabBar.querySelectorAll('[data-tab]'));
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      tabs[next].focus();
      window.showSettingsTab(tabs[next].dataset.tab);
    });

    const initial = tabBar.querySelector('[data-tab].active') || tabBar.querySelector('[data-tab]');
    if (initial) window.showSettingsTab(initial.dataset.tab);
  } catch (e) {
    console.warn('[StudioSettings] initSettingsTabs failed:', e);
  }
};

// Restructures the settings modal at runtime (idempotent, best effort):
//  1) removes the "Permissions" tab + panel
//  2) renames the middle tab ("Settings") to "AI Configuration"
//  3) moves the Auto-switch control from the AI Models panel into Preference
window.restructureSettingsPanel = function () {
  try {
    const tabBar = document.querySelector('.settings-tab-bar');
    if (!tabBar) return false;

    // 1) Remove Permissions
    Array.prototype.slice.call(tabBar.querySelectorAll('[data-tab]')).forEach(function (b) {
      if (/permission/i.test(b.dataset.tab || '') || /^\s*permissions?\s*$/i.test(b.textContent || '')) {
        const name = b.dataset.tab;
        document.querySelectorAll('.settings-tab-panel').forEach(function (p) {
          if (p.dataset.panel === name) p.remove();
        });
        b.remove();
      }
    });

    // 2) Rename the middle tab
    _studioEnsureTabLabel();

    // Make sure something is selected after removals
    if (!tabBar.querySelector('[data-tab].active')) {
      const first = tabBar.querySelector('[data-tab]');
      if (first) window.showSettingsTab(first.dataset.tab);
    }

    // 3) Move Auto-switch into Preference (retry later if not rendered yet)
    _studioLateRestructure();
    return true;
  } catch (e) {
    console.warn('[StudioSettings] restructureSettingsPanel failed:', e);
    return false;
  }
};

function _studioMoveAutoSwitch() {
  // Already built and still attached: nothing to do.
  if (window._studioAutoSwitchRow && document.body.contains(window._studioAutoSwitchRow)) return true;

  // The real checkbox (owned by ai-models.js) stays in the page so its logic and
  // saved state keep working; this section only provides the Preference UI for it.
  const native = document.getElementById('ai-model-autoswitch-checkbox');
  const prefPanel = document.querySelector('.settings-tab-panel[data-panel="preference"]') ||
                    document.querySelector('.settings-tab-panel');
  if (!native || !prefPanel) return false;

  // Hide the old row inside the AI Models panel.
  const oldRow = native.closest('.ai-model-auto-row');
  if (oldRow) { oldRow.hidden = true; oldRow.style.display = 'none'; }
  else { native.classList.add('studio-native-hidden'); }

  const shell = _studioBuildRowShell(
    'studio-autoswitch',
    'Auto-switch on error',
    'Automatically switches to another working AI model when the current one fails.'
  );
  shell.row.setAttribute('data-setting-key', 'autoSwitch');
  shell.status.remove();

  const proxy = document.createElement('button');
  proxy.type = 'button';
  proxy.className = 'studio-switch';
  proxy.id = 'studio-autoswitch-proxy';
  proxy.setAttribute('role', 'switch');
  proxy.setAttribute('aria-labelledby', shell.label.id);
  proxy.setAttribute('aria-describedby', shell.details.id);
  const knob = document.createElement('span');
  knob.className = 'studio-switch-knob';
  proxy.appendChild(knob);
  const stateText = document.createElement('span');
  stateText.className = 'studio-switch-state';
  stateText.setAttribute('aria-hidden', 'true');
  shell.control.appendChild(proxy);
  shell.control.appendChild(stateText);

  const sync = function () {
    const on = !!native.checked;
    proxy.setAttribute('aria-checked', on ? 'true' : 'false');
    proxy.setAttribute('aria-disabled', native.disabled ? 'true' : 'false');
    stateText.textContent = on ? 'On' : 'Off';
    shell.row.classList.toggle('is-on', on);
  };
  const toggle = function () {
    if (native.disabled) return;
    native.click();                         // fires the original onchange handler
    setTimeout(sync, 0);
  };
  proxy.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
  shell.row.addEventListener('click', function (e) {
    if (e.target.closest('.studio-switch, .studio-details-toggle, .studio-setting-details')) return;
    toggle();
  });
  ['change', 'input', 'click'].forEach(function (ev) {
    native.addEventListener(ev, function () { setTimeout(sync, 0); });
  });
  try {
    new MutationObserver(sync).observe(native, { attributes: true, attributeFilter: ['checked', 'disabled'] });
  } catch (_) {}
  // programmatic changes (ai-models.js setting .checked) fire no events
  const iv = setInterval(function () {
    if (!document.body.contains(proxy)) { clearInterval(iv); return; }
    sync();
  }, 500);
  sync();

  // Own subsection in Preference, under the image/figure switches.
  const section = document.createElement('div');
  section.className = 'settings-subsection';
  section.id = 'studio-autoswitch-section';
  const title = document.createElement('h4');
  title.className = 'settings-subsection-title';
  title.textContent = 'AI Behavior';
  const list = document.createElement('div');
  list.className = 'studio-settings-list';
  list.appendChild(shell.row);
  section.appendChild(title);
  section.appendChild(list);
  prefPanel.appendChild(section);

  window._studioAutoSwitchRow = shell.row;
  return true;
}

// Renames the middle tab to "AI Configuration". Safe to call repeatedly: it
// re-applies the label if anything else rewrote it.
function _studioEnsureTabLabel() {
  const tabBar = document.querySelector('.settings-tab-bar');
  if (!tabBar) return;
  let mid = tabBar.querySelector('[data-ai-models-tab="1"]');
  if (!mid) {
    const tabs = Array.prototype.slice.call(tabBar.querySelectorAll('[data-tab]'));
    mid = tabs.slice(1).find(function (b) { return /model/i.test(b.dataset.tab || ''); }) ||
          tabs.slice(1).find(function (b) { return /setting/i.test(b.dataset.tab || '') || /setting/i.test(b.textContent || ''); }) ||
          tabs[1];
    if (!mid) return;
    mid.setAttribute('data-ai-models-tab', '1');
    mid.removeAttribute('data-i18n');
    mid.removeAttribute('data-i18n-key');
    mid.querySelectorAll('[data-i18n],[data-i18n-key]').forEach(function (el) {
      el.removeAttribute('data-i18n'); el.removeAttribute('data-i18n-key');
    });
  }
  if ((mid.textContent || '').trim() !== 'AI Configuration') {
    const walker = document.createTreeWalker(mid, NodeFilter.SHOW_TEXT, null);
    let n, done = false;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      n.textContent = done ? '' : 'AI Configuration';
      done = true;
    }
    if (!done) mid.textContent = 'AI Configuration';
  }
  mid.setAttribute('aria-label', 'AI Configuration');
  mid.title = 'AI Configuration';
}

// Moves "+ Add new AI model" into the Model list toolbar (far right, same row
// as Import / Export / Test all / Remove) and collapses the now-empty
// "Add a new model" section so no blank space is left behind.
function _studioMoveAddModelButton() {
  const panels = document.querySelectorAll('.settings-tab-panel');
  const findBtn = function (re) {
    let hit = null;
    panels.forEach(function (p) {
      if (hit) return;
      p.querySelectorAll('button,[role="button"],a').forEach(function (el) {
        if (!hit && re.test((el.textContent || '').replace(/\s+/g, ' ').trim())) hit = el;
      });
    });
    return hit;
  };
  const addBtn = findBtn(/^\+?\s*add new ai model$/i);
  const importBtn = findBtn(/^import$/i);
  if (!addBtn || !importBtn) return false;
  const toolbar = importBtn.parentElement;
  if (!toolbar) return false;
  if (addBtn.parentElement === toolbar && addBtn.dataset.studioMoved === '1') return true;

  const oldRow = addBtn.parentElement;
  const cs = window.getComputedStyle(toolbar);
  if (cs.display !== 'flex' && cs.display !== 'inline-flex') toolbar.style.display = 'flex';
  toolbar.style.flexWrap = 'wrap';
  toolbar.style.alignItems = 'center';
  addBtn.style.marginLeft = 'auto';
  addBtn.dataset.studioMoved = '1';
  toolbar.appendChild(addBtn);

  // Collapse the empty "Add a new model" section.
  const hasUi = function (el) { return !!el.querySelector('button,input,select,textarea,[role="switch"]'); };
  if (oldRow && oldRow !== toolbar && !oldRow.children.length) oldRow.style.display = 'none';
  let heading = null;
  panels.forEach(function (p) {
    if (heading) return;
    p.querySelectorAll('*').forEach(function (el) {
      if (!heading && !el.children.length && /^\s*add a new model\s*$/i.test(el.textContent || '')) heading = el;
    });
  });
  if (heading) {
    // Highest ancestor of the heading that does not contain the toolbar.
    let sec = heading;
    while (sec.parentElement && !sec.parentElement.contains(toolbar) &&
           !sec.parentElement.classList.contains('settings-tab-panel')) {
      sec = sec.parentElement;
    }
    if (!hasUi(sec)) sec.style.display = 'none';
    else heading.style.display = 'none';
  }
  return true;
}

// ---------- AGGRESSIVE TOP-SPACE TRIMMER ----------
// Returns true when it hid something or zeroed a margin/padding.
function _studioTrimEmptyPanelSpace() {
  let changed = false;
  try {
    document.querySelectorAll('.settings-tab-panel').forEach(function (panel) {
      // Only trim when the panel already contains real interactive content
      // (avoids hiding placeholders before content renders into them).
      if (!panel.querySelector('button,input,select,textarea,[role="switch"],.studio-setting-row,.studio-settings-list')) return;
      if (_studioTrimLeadingEmpty(panel, 0)) changed = true;
    });
    if (_studioCollapseAiPanelTop()) changed = true;
  } catch (e) {
    console.warn('[StudioSettings] trim empty panel space failed:', e);
  }
  return changed;
}

// Recursively hides leading empty siblings and zeroes the top
// margin/padding of the first visible content element.
function _studioTrimLeadingEmpty(container, depth) {
  if (!container || depth > 4) return false;
  let changed = false;
  const kids = Array.prototype.slice.call(container.children);
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (!child) continue;
    if (child.style.display === 'none') continue;
    if (_studioIsEmptyLeading(child)) {
      child.style.display = 'none';
      changed = true;
      continue;
    }
    // First visible content: force its top to zero so it hugs the tab bar.
    try {
      if (child.style.marginTop !== '0px') {
        child.style.setProperty('margin-top', '0', 'important');
        changed = true;
      }
      if (depth > 0 && child.style.paddingTop !== '0px') {
        child.style.setProperty('padding-top', '0', 'important');
        changed = true;
      }
    } catch (_) {}
    // Recurse so the nested first-child heading also loses its top margin.
    if (_studioTrimLeadingEmpty(child, depth + 1)) changed = true;
    break;
  }
  return changed;
}

// An element counts as "empty leading" when it carries no visible content
// and no interactive descendants — safe to hide without losing functionality.
function _studioIsEmptyLeading(el) {
  if (!el) return true;
  const tag = (el.tagName || '').toUpperCase();
  if (['BUTTON','INPUT','SELECT','TEXTAREA','IMG','CANVAS','VIDEO','AUDIO','SVG','HR'].indexOf(tag) !== -1) return false;
  if (el.matches('[role="switch"],button,input,select,textarea,[contenteditable]')) return false;
  const text = (el.textContent || '').replace(/\s+/g, '');
  if (text) return false;
  if (el.querySelector('button,input,select,textarea,[role="switch"],img,canvas,video,audio')) return false;
  if (el.children.length > 0) {
    // Hide only when every descendant is itself empty (decorative wrapper).
    return Array.prototype.every.call(el.children, function (c) {
      return _studioIsEmptyLeading(c);
    });
  }
  return true;
}

// ---------- AI CONFIGURATION: TOP GAP COLLAPSER ----------
// Everything that sits between the tab bar and the "Model list" heading but
// shows no real content (empty wrappers, dividers, the emptied "Add a new
// model" section, hidden forms ...) is collapsed so "Model list" hugs the
// tab bar. Nothing is deleted: wrappers that still hold a hidden form are only
// flattened (no padding / border / margin) and come back automatically if
// they ever show content again.
const _STUDIO_INTERACTIVE_SEL = 'button,input:not([type="hidden"]),select,textarea,img,svg,canvas,video,audio,[role="switch"],[contenteditable]';

function _studioIsShown(el) {
  try {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
  } catch (_) {}
  return !!(el.getClientRects && el.getClientRects().length);
}

// True when the element currently renders real, visible content.
function _studioHasVisibleContent(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'HR' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') return false;
  if (!_studioIsShown(el)) return false;
  if (tag === 'INPUT') return (el.type || '').toLowerCase() !== 'hidden';
  if (/^(BUTTON|SELECT|TEXTAREA|IMG|CANVAS|VIDEO|AUDIO|SVG)$/.test(tag)) return true;
  if (el.matches('[role="switch"],[contenteditable]')) return true;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    if (n.nodeType === 1 && _studioHasVisibleContent(n)) return true;
  }
  return false;
}

// DOM-level check (ignores rendering): any text or interactive descendant?
function _studioHasAnyContent(el) {
  return !!((el.textContent || '').trim() || el.querySelector(_STUDIO_INTERACTIVE_SEL));
}

// Cancels a flex/grid row-gap that a collapsed (zero-height) child would still cause.
function _studioFixGap(el) {
  try {
    const p = el.parentElement;
    if (!p) return;
    const cs = window.getComputedStyle(p);
    const col = cs.display.indexOf('grid') !== -1 ||
                (cs.display.indexOf('flex') !== -1 && cs.flexDirection.indexOf('column') === 0);
    if (!col) return;
    const g = parseFloat(cs.rowGap);
    if (g > 0) {
      el.style.setProperty('margin-bottom', '-' + g + 'px', 'important');
      el.setAttribute('data-studio-gapfix', '1');
    }
  } catch (_) {}
}

function _studioUncollapse(el) {
  el.removeAttribute('data-studio-gap');
  if (el.getAttribute('data-studio-gapfix') === '1') {
    el.style.removeProperty('margin-bottom');
    el.removeAttribute('data-studio-gapfix');
  }
}

// Returns true only when it actually changed something (idempotent).
function _studioCollapseAiPanelTop() {
  let changed = false;
  try {
    // 1) Revive anything collapsed earlier that has gained content since.
    document.querySelectorAll('[data-studio-gap]').forEach(function (el) {
      const mode = el.getAttribute('data-studio-gap');
      const revive = mode === 'hide' ? _studioHasAnyContent(el) : _studioHasVisibleContent(el);
      if (revive) { _studioUncollapse(el); changed = true; }
    });

    // 2) Find the visible "Model list" heading.
    let heading = null;
    document.querySelectorAll('.settings-tab-panel').forEach(function (p) {
      if (heading) return;
      p.querySelectorAll('*').forEach(function (el) {
        if (heading || el.children.length) return;
        if (/^\s*model list\s*$/i.test(el.textContent || '') && _studioIsShown(el)) heading = el;
      });
    });
    if (!heading) return changed;

    const panel = heading.closest('.settings-tab-panel');
    const tabBar = document.querySelector('.settings-tab-bar');

    // 3) Walk up from the heading; collapse empty leading siblings at each level.
    let node = heading;
    let leading = true;        // no real content above this node so far
    let guard = 0;
    while (node && node !== document.body && guard++ < 12) {
      const parent = node.parentElement;
      if (!parent) break;
      if (tabBar && node.contains(tabBar)) break;

      for (let s = node.previousElementSibling; s; s = s.previousElementSibling) {
        if (tabBar && (s === tabBar || s.contains(tabBar))) break;   // never touch the tab bar
        const tag = (s.tagName || '').toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') continue;
        if (s.hasAttribute('data-studio-gap')) continue;              // already collapsed
        const pos = window.getComputedStyle(s).position;
        if (pos === 'fixed' || pos === 'absolute') continue;          // overlays: leave alone
        if (_studioHasVisibleContent(s)) { leading = false; continue; }

        const hide = !(s.textContent || '').trim() && !s.querySelector(_STUDIO_INTERACTIVE_SEL);
        s.setAttribute('data-studio-gap', hide ? 'hide' : 'flat');
        if (!hide) _studioFixGap(s);
        changed = true;
      }

      // Remove the node's own top margin / padding / border while nothing real is above it.
      if (leading) {
        if (node.getAttribute('data-studio-top') !== '1') { node.setAttribute('data-studio-top', '1'); changed = true; }
      } else if (node.hasAttribute('data-studio-top')) {
        node.removeAttribute('data-studio-top'); changed = true;
      }

      if (tabBar && parent.contains(tabBar)) break;
      if (!tabBar && panel && parent === panel.parentElement) break;
      node = parent;
    }
  } catch (e) {
    console.warn('[StudioSettings] collapse AI panel top failed:', e);
  }
  return changed;
}

// Re-check right after any click inside the settings panels (inline forms
// opening / closing, tab switches ...), since attribute changes are not observed.
(function _studioBindGapRecheck() {
  if (typeof document === 'undefined' || window._studioGapClickBound) return;
  window._studioGapClickBound = true;
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest || !t.closest('.settings-tab-panel, .settings-tab-bar')) return;
    setTimeout(function () { try { _studioCollapseAiPanelTop(); } catch (_) {} }, 60);
    setTimeout(function () { try { _studioCollapseAiPanelTop(); } catch (_) {} }, 350);
  }, true);
})();

// Runs the DOM moves that depend on the AI Models panel being rendered;
// keeps watching (cheaply, throttled) until the panel content is stable.
let _studioLateObserver = null;
let _studioLateTimer = null;
let _studioLateIdle = 0;
function _studioLateRestructure() {
  let a = false, b = false, c = false;
  try { a = _studioMoveAutoSwitch(); } catch (e) { console.warn('[StudioSettings] auto-switch move failed:', e); }
  try { b = _studioMoveAddModelButton(); } catch (e) { console.warn('[StudioSettings] add-model move failed:', e); }
  try { c = _studioTrimEmptyPanelSpace(); } catch (e) { console.warn('[StudioSettings] trim gap failed:', e); }

  if (_studioLateObserver) {
    if (a && b && !c) _studioLateIdle++;
    else _studioLateIdle = 0;
    if (_studioLateIdle > 5) {
      try { _studioLateObserver.disconnect(); } catch (_) {}
      _studioLateObserver = null;
      _studioLateIdle = 0;
    }
    return a && b;
  }
  if (typeof MutationObserver === 'undefined') return a && b;

  _studioLateObserver = new MutationObserver(function () {
    clearTimeout(_studioLateTimer);
    _studioLateTimer = setTimeout(function () {
      try { _studioTrimEmptyPanelSpace(); } catch (_) {}
      try { _studioMoveAutoSwitch(); } catch (_) {}
      try { _studioMoveAddModelButton(); } catch (_) {}
    }, 150);
  });
  _studioLateObserver.observe(document.body, { childList: true, subtree: true });
  return a && b;
}

// ---- Header rename: "AI Models" → "Settings" (best effort) ----
// In the current index.html the header already says "Settings", so this
// is a harmless no-op there; it only matters for any residual "AI Models"
// labels left over from an older HTML.
window.renameAIModelsHeaderToSettings = function () {
  // Intentionally a no-op: the modal title already says "Settings", and the
  // middle tab must read "AI Configuration" (the old rewrite turned it back).
  return false;
};

// Wire up header rename + tabs once the DOM is ready. Both are idempotent.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      try { window.renameAIModelsHeaderToSettings(); } catch (_) {}
      try { window.initSettingsTabs(); } catch (_) {}
    });
  } else {
    try { window.renameAIModelsHeaderToSettings(); } catch (_) {}
    try { window.initSettingsTabs(); } catch (_) {}
  }
}

// ========================================================================
// TAB MANAGER
// ========================================================================
const TAB_MANAGER = {
  tabs: [],
  activeId: null,
  nextId: 1,
  _initialized: false,
  _loading: false,

  _defaultSlideDeck() {
    return {
      title: 'Untitled Deck',
      slides: [{ title: 'Untitled Deck', bullets: [], visual: null, visualSVG: null, align: null, bg: null }]
    };
  },

  _normalizeSlideDeck(deck) {
    if (!deck || typeof deck !== 'object' || !Array.isArray(deck.slides)) return null;
    if (deck.slides.length === 0) {
      deck.slides = this._defaultSlideDeck().slides;
      if (!deck.title) deck.title = 'Untitled Deck';
    }
    return deck;
  },

  _generateId() {
    return 'tab_' + (this.nextId++);
  },

  _getTabNameFromHtml(html) {
    if (!html) return 'Untitled';
    const head = html.length > 60000 ? html.slice(0, 60000) : html;
    if (this._nameHeadCache === head) return this._nameCache;
    const temp = document.createElement('div');
    temp.innerHTML = head;
    const h1 = temp.querySelector('h1, h2, h3');
    let result = 'Untitled';
    if (h1 && h1.innerText.trim() && !h1.innerText.includes('Start typing here')) {
      result = h1.innerText.trim().slice(0, 24);
    }
    this._nameHeadCache = head;
    this._nameCache = result;
    return result;
  },

  _createBlankState() {
    return {
      htmlContent: `<h1 style="text-align: center; margin-top: 30%; color: #9ca3af; font-family: 'Inter', sans-serif; font-weight:400;">Start typing here...<br><span style="font-size: 14pt;">Or ask AI on the left to generate notes, MCQ Quizzes, or charts!</span></h1>`,
      chatHistory: [],
      attachedFiles: {},
      undoStack: [],
      redoStack: [],
      selectedPage: null,
      projectVersion: 0,
      scrollPosition: 0,
      slideDeck: null
    };
  },

  _captureCurrentState(tabId, htmlOverride) {
    if (this._loading) return;
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const html = typeof htmlOverride === 'string' ? htmlOverride : (typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '');
    tab.htmlContent = html || tab.htmlContent;
    tab.name = this._getTabNameFromHtml(html);
    tab.chatHistory = Array.isArray(window.APP_STATE?.chatHistory) ? [...window.APP_STATE.chatHistory] : [];
    tab.attachedFiles = { ...(window.APP_STATE?.attachedFiles || {}) };
    syncCurrentTabFileObjects();
    tab.undoStack = Array.isArray(window.HISTORY?.undoStack) ? [...window.HISTORY.undoStack] : [];
    tab.redoStack = Array.isArray(window.HISTORY?.redoStack) ? [...window.HISTORY.redoStack] : [];
    tab.selectedPage = window.APP_STATE?.selectedPage || null;
    tab.projectVersion = window.APP_STATE?.projectVersion || 0;
    tab.scrollPosition = document.getElementById('document-view-container')?.scrollTop || 0;
    tab.theme = window.APP_STATE?.theme || 'light';
    tab.pdfVisualFormat = window.APP_STATE?.pdfVisualFormat || (typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default');
    tab.pdfTextFormat = window.APP_STATE?.pdfTextFormat || (typeof getActivePDFTextFormat === 'function' ? getActivePDFTextFormat() : 'default');
    tab.pdfLanguageFormat = window.APP_STATE?.pdfLanguageFormat || (typeof getActivePDFLanguageFormat === 'function' ? getActivePDFLanguageFormat() : 'default');
    tab.photocopyMode = document.body.classList.contains('photocopy-mode');
    tab.slideDeck = window.APP_STATE?.slideDeck || null;
  },

  _loadStateIntoUI(tab) {
    if (!tab) return;
    this._loading = true;
    try {
      tab.slideDeck = this._normalizeSlideDeck(tab.slideDeck);
      if (window.APP_STATE) window.APP_STATE.slideDeck = tab.slideDeck || null;
      this._loadStateIntoUIInner(tab);
    } finally {
      this._loading = false;
    }
    try { this._persist(); } catch (_) {}
  },

  _loadStateIntoUIInner(tab) {
    if (!tab) return;

    const chatHistoryArea = document.getElementById('chat-history');
    if (chatHistoryArea) {
      chatHistoryArea.innerHTML = '';
      const restoredChat = Array.isArray(tab.chatHistory) ? tab.chatHistory : [];
      if (window.APP_STATE) window.APP_STATE.chatHistory = [...restoredChat];
      restoredChat.forEach(msg => {
        if (msg && msg.content != null) {
          if (typeof appendChatMessageToUI === 'function') {
            appendChatMessageToUI(msg.role === 'user' ? 'user' : 'ai', msg.content, false);
          }
        }
      });
      if (restoredChat.length === 0) {
        chatHistoryArea.innerHTML = `
          <div id="chat-empty-state" class="chat-empty-state">
            <span class="chat-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H11l-4.5 4v-4.6A2.5 2.5 0 0 1 4 12.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </span>
            <div class="chat-empty-title">AI Chat</div>
            <div class="chat-empty-desc">Ask the AI to create notes, generate a PDF, or edit this document. Type below to get started.</div>
          </div>`;
      }
    }

    const html = tab.htmlContent || this._createBlankState().htmlContent;
    if (typeof setDocumentHTMLAndPaginate === 'function') {
      try {
        setDocumentHTMLAndPaginate(html, false);
      } catch (e) {
        console.error('Tab switch: failed to paginate document content', e);
      }
    }
    const docContainer = document.getElementById('document-view-container');
    if (docContainer) docContainer.scrollTop = tab.scrollPosition || 0;

    if (window.APP_STATE) {
      window.APP_STATE.attachedFiles = tab.attachedFiles && typeof tab.attachedFiles === 'object' ? { ...tab.attachedFiles } : {};
      window.APP_STATE.fileObjects = TAB_FILE_OBJECTS.has(tab.id) ? TAB_FILE_OBJECTS.get(tab.id) : {};
    }
    if (typeof renderAttachmentBar === 'function') renderAttachmentBar();

    if (window.HISTORY) {
      window.HISTORY.undoStack = Array.isArray(tab.undoStack) ? [...tab.undoStack] : [];
      window.HISTORY.redoStack = Array.isArray(tab.redoStack) ? [...tab.redoStack] : [];
    }

    if (window.APP_STATE) window.APP_STATE.projectVersion = tab.projectVersion || 0;

    if (tab.theme && window.APP_STATE) {
      window.APP_STATE.theme = tab.theme;
      if (typeof applyCurrentTheme === 'function') applyCurrentTheme();
    }
    if (tab.pdfVisualFormat && typeof applyPDFVisualFormat === 'function') {
      window.APP_STATE.pdfVisualFormat = tab.pdfVisualFormat;
      applyPDFVisualFormat(tab.pdfVisualFormat);
    }
    if (tab.pdfTextFormat && typeof applyPDFTextFormat === 'function') {
      window.APP_STATE.pdfTextFormat = tab.pdfTextFormat;
      applyPDFTextFormat(tab.pdfTextFormat);
    }
    if (tab.pdfLanguageFormat && typeof applyPDFLanguageFormat === 'function') {
      window.APP_STATE.pdfLanguageFormat = tab.pdfLanguageFormat;
      applyPDFLanguageFormat(tab.pdfLanguageFormat);
    }
    if (tab.photocopyMode) document.body.classList.add('photocopy-mode');
    else document.body.classList.remove('photocopy-mode');
    if (typeof updateModeButtonText === 'function') updateModeButtonText();
    if (typeof applyMonochromeDocumentStyles === 'function') applyMonochromeDocumentStyles();

    if (window.APP_STATE) window.APP_STATE.slideDeck = tab.slideDeck || null;
    if (typeof renderSlideDeckPreview === 'function') renderSlideDeckPreview(tab.slideDeck || null);

    if (window.APP_STATE) window.APP_STATE.pendingOutline = tab.pendingOutline || null;
    try {
      const _chatEl = document.getElementById('chat-history');
      const _chatWasEmpty = !Array.isArray(tab.chatHistory) || tab.chatHistory.length === 0;
      if (tab.pendingOutline && tab.pendingOutline.outline && _chatWasEmpty && _chatEl && typeof appendSlideOutlineToUI === 'function') {
        appendSlideOutlineToUI({
          outline: tab.pendingOutline.outline,
          isBn: /[\u0980-\u09FF]/.test(String(tab.pendingOutline.originalPrompt || '')),
          outlineNote: ''
        }, { record: false });
      }
    } catch (e) { console.warn('[TabManager] could not restore pending outline bubble:', e); }

    const _tabIsSlideDeck = !!(tab.slideDeck && Array.isArray(tab.slideDeck.slides) && tab.slideDeck.slides.length);
    const _isMobileLayout = typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout();
    const _prevMobileView = (window.APP_STATE && window.APP_STATE.currentMobileView) || 'chat';
    if (typeof switchPreviewTab === 'function') switchPreviewTab(_tabIsSlideDeck ? 'slides' : 'editor');
    if (_isMobileLayout && typeof setMobileView === 'function') {
      setMobileView(_prevMobileView === 'chat' ? 'chat' : 'editor');
    }

    if (window.APP_STATE) window.APP_STATE.selectedPage = null;
    _resetTransientChatState();
    if (typeof renderSelectedCommandChips === 'function') renderSelectedCommandChips();
    if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();

    if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();
  },

  _persist(htmlOverride) {
    if (!this.tabs.length) return;
    if (this.activeId) {
      this._captureCurrentState(this.activeId, htmlOverride);
      if (typeof updateCreationModeLockUI === 'function') updateCreationModeLockUI();
    }
    try {
      const a = this.getActive();
      const isDeck = !!(a && a.slideDeck && Array.isArray(a.slideDeck.slides) && a.slideDeck.slides.length);
      localStorage.setItem(BOOT_VIEW_KEY, isDeck ? 'slides' : 'editor');
    } catch (_) {}
    this._schedulePersistWrite();
  },

  _schedulePersistWrite() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      const run = () => { try { this._writeTabsToStorage(); } catch (e) { console.warn('persist failed', e); } };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
      else run();
    }, 1500);
  },

  flushPersist() {
    if (!this._persistTimer) return;
    clearTimeout(this._persistTimer);
    this._persistTimer = null;
    try { this._writeTabsToStorage(); } catch (_) {}
  },

  _writeTabsToStorage() {
    if (!this.tabs.length) return;
    {
      let totalChars = 0;
      for (const tb of this.tabs) totalChars += (tb.htmlContent ? tb.htmlContent.length : 0);
      if (totalChars > 3400000) { this._persistEmergencyMetadata(); return; }
    }
    try {
      const compactTabs = this.tabs.map(t => {
        const attachedFiles = {};
        const sourceFiles = (t.attachedFiles && typeof t.attachedFiles === 'object') ? t.attachedFiles : {};
        Object.entries(sourceFiles).forEach(([id, f]) => {
          if (!f) return;
          const rawContent = String(f.content || '');
          const maxPersistChars = 18000;
          attachedFiles[id] = {
            name: f.name || 'file',
            content: rawContent.length > maxPersistChars ? rawContent.slice(0, maxPersistChars) + '\n...[PERSISTENCE PREVIEW ONLY]' : rawContent,
            sent: !!f.sent,
            status: f.status || (rawContent ? 'ready' : 'queued'),
            sourceMode: 'ocr',
            order: Number.isFinite(f.order) ? f.order : 0,
            needsVision: !!f.needsVision,
            visionDataUrls: Array.isArray(f.visionDataUrls) ? f.visionDataUrls : []
          };
        });

        let slideDeck = null;
        if (t.slideDeck) {
          try {
            const serialized = JSON.stringify(t.slideDeck);
            slideDeck = serialized.length <= 900000 ? t.slideDeck : null;
          } catch (_) { slideDeck = null; }
        }

        const pendingOutline = _compactPendingOutlineForStorage(t.pendingOutline);

        return {
          id: t.id,
          name: t.name || 'Untitled',
          htmlContent: t.htmlContent || '',
          attachedFiles,
          selectedPage: t.selectedPage ?? null,
          projectVersion: t.projectVersion || 0,
          scrollPosition: t.scrollPosition || 0,
          theme: t.theme || 'light',
          pdfVisualFormat: t.pdfVisualFormat || window.APP_STATE?.pdfVisualFormat || 'default',
          pdfTextFormat: t.pdfTextFormat || window.APP_STATE?.pdfTextFormat || 'default',
          pdfLanguageFormat: t.pdfLanguageFormat || window.APP_STATE?.pdfLanguageFormat || 'default',
          photocopyMode: !!t.photocopyMode,
          slideDeck,
          pendingOutline
        };
      });

      const data = {
        version: 2,
        compact: true,
        tabs: compactTabs,
        activeId: this.activeId,
        nextId: this.nextId
      };

      const payload = JSON.stringify(data);
      const approxMB = payload.length / (1024 * 1024);
      if (approxMB > 3.6) {
        this._persistEmergencyMetadata();
        return;
      }

      localStorage.setItem(TAB_STORAGE_KEY, payload);
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    } catch (e) {
      console.warn('Failed to persist compact tabs:', e);
      this._persistEmergencyMetadata();
    }
  },

  _persistEmergencyMetadata() {
    try {
      const data = {
        version: 3,
        compact: true,
        tabs: this.tabs.map(t => {
          let slideDeck = null;
          if (t.id === this.activeId && t.slideDeck) {
            try {
              const serialized = JSON.stringify(t.slideDeck);
              slideDeck = serialized.length <= 300000 ? t.slideDeck : null;
            } catch (_) { slideDeck = null; }
          }
          return {
            id: t.id,
            name: t.name || 'Untitled',
            htmlContent: t.id === this.activeId ? String(t.htmlContent || '').slice(0, 180000) : '',
            selectedPage: t.selectedPage ?? null,
            projectVersion: t.projectVersion || 0,
            scrollPosition: t.scrollPosition || 0,
            theme: t.theme || 'light',
            pdfVisualFormat: t.pdfVisualFormat || 'default',
            pdfTextFormat: t.pdfTextFormat || 'default',
            pdfLanguageFormat: t.pdfLanguageFormat || 'default',
            photocopyMode: !!t.photocopyMode,
            slideDeck,
            pendingOutline: t.id === this.activeId ? _compactPendingOutlineForStorage(t.pendingOutline) : null
          };
        }),
        activeId: this.activeId,
        nextId: this.nextId
      };
      const payload = JSON.stringify(data);
      localStorage.setItem(TAB_STORAGE_KEY, payload);
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    } catch (e2) {
      console.warn('Emergency tab persistence skipped because browser storage is unavailable:', e2);
    }
  },

  _restore() {
    try {
      const raw = localStorage.getItem(TAB_STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.tabs || !Array.isArray(data.tabs) || data.tabs.length === 0) return false;

      this.tabs = data.tabs.map(t => ({
        id: t.id || this._generateId(),
        name: t.name || 'Untitled',
        htmlContent: t.htmlContent || this._createBlankState().htmlContent,
        chatHistory: Array.isArray(t.chatHistory) ? t.chatHistory : [],
        attachedFiles: Object.fromEntries(Object.entries(t.attachedFiles || {}).map(([id, f]) => [id, { ...(f || {}), sourceMode: 'ocr' }])),
        undoStack: t.undoStack || [],
        redoStack: t.redoStack || [],
        selectedPage: t.selectedPage || null,
        projectVersion: t.projectVersion || 0,
        scrollPosition: t.scrollPosition || 0,
        theme: t.theme || 'light',
        pdfVisualFormat: t.pdfVisualFormat || 'default',
        pdfTextFormat: t.pdfTextFormat || 'default',
        pdfLanguageFormat: t.pdfLanguageFormat || 'default',
        photocopyMode: t.photocopyMode !== undefined ? t.photocopyMode : false,
        slideDeck: this._normalizeSlideDeck(t.slideDeck),
        pendingOutline: (t.pendingOutline && t.pendingOutline.outline) ? Object.assign({}, t.pendingOutline, { tabId: t.id, approveNow: false }) : null
      }));

      this.activeId = data.activeId || (this.tabs[0] ? this.tabs[0].id : null);
      this.nextId = data.nextId || this.tabs.length + 1;
      return true;
    } catch (e) { return false; }
  },

  createTab(name, htmlContent, stateOverrides, insertAtStart) {
    const state = stateOverrides || this._createBlankState();
    const tab = {
      id: this._generateId(),
      name: name || this._getTabNameFromHtml(state.htmlContent) || 'Untitled',
      htmlContent: htmlContent || state.htmlContent || this._createBlankState().htmlContent,
      chatHistory: state.chatHistory ? [...state.chatHistory] : [],
      attachedFiles: state.attachedFiles ? { ...state.attachedFiles } : {},
      undoStack: state.undoStack ? [...state.undoStack] : [],
      redoStack: state.redoStack ? [...state.redoStack] : [],
      selectedPage: state.selectedPage || null,
      projectVersion: state.projectVersion || 0,
      scrollPosition: state.scrollPosition || 0,
      theme: state.theme || window.APP_STATE?.theme || 'light',
      photocopyMode: state.photocopyMode !== undefined ? state.photocopyMode : document.body.classList.contains('photocopy-mode'),
      slideDeck: state.slideDeck || null
    };
    if (this.tabs.length) {
      try { if (this.activeId) this._captureCurrentState(this.activeId); } catch (_) {}
      try { if (typeof window.__paperlyArchiveTabs === 'function') window.__paperlyArchiveTabs(this.tabs.slice()); } catch (_) {}
    }
    this.tabs = [tab];
    this._persist();
    return tab;
  },

  duplicateActiveTab() {
    if (this.tabs.length === 0) {
      const tab = this.createTab('Untitled');
      this.switchTo(tab.id);
      return;
    }
    const active = this.getActive();
    if (!active) {
      const tab = this.createTab('Untitled');
      this.switchTo(tab.id);
      return;
    }
    this._captureCurrentState(this.activeId);
    const newTab = this.createTab(
      active.name + ' (copy)',
      active.htmlContent, {
        htmlContent: active.htmlContent,
        chatHistory: [],
        attachedFiles: {},
        undoStack: [],
        redoStack: [],
        selectedPage: null,
        projectVersion: 0,
        scrollPosition: 0,
        theme: active.theme || window.APP_STATE?.theme || 'light',
        photocopyMode: active.photocopyMode !== undefined ? active.photocopyMode : document.body.classList.contains('photocopy-mode'),
        slideDeck: active.slideDeck || null
      }
    );
    this.switchTo(newTab.id);
    if (typeof displayToastNotification === 'function') displayToastNotification(`New tab: "${newTab.name}"`);
  },

  closeAllTabsWithConfirm() {
    try { if (this.activeId) this._captureCurrentState(this.activeId); if (typeof window.__paperlyArchiveTabs === 'function') window.__paperlyArchiveTabs(this.tabs.slice()); } catch (_) {}
    this.tabs = [];
    this.activeId = null;
    TAB_FILE_OBJECTS.clear();
    if (window.APP_STATE) {
      window.APP_STATE.activeSessionId = (window.APP_STATE.activeSessionId || 0) + 1;
      window.APP_STATE.fileObjects = {};
    }
    const mode = (window.APP_STATE && window.APP_STATE.creationMode === 'slides') ? 'slides' : 'pdf';
    const state = this._createBlankState();
    if (mode === 'slides') state.slideDeck = this._defaultSlideDeck();
    const tab = this.createTab(mode === 'slides' ? 'Untitled Deck' : 'Untitled', state.htmlContent, state, false);
    TAB_FILE_OBJECTS.set(tab.id, {});
    this.activeId = tab.id;
    this._loadStateIntoUI(tab);
    this._persist();
    this.renderTabBar();
    if (typeof displayToastNotification === 'function') displayToastNotification("New session");
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); });
    }
  },

  createBlankTab() {
    if (window.APP_STATE) {
      window.APP_STATE.activeSessionId = (window.APP_STATE.activeSessionId || 0) + 1;
      window.APP_STATE.fileObjects = {};
    }
    const state = this._createBlankState();
    const tab = this.createTab('Blank', state.htmlContent, state);
    TAB_FILE_OBJECTS.set(tab.id, {});
    this.switchTo(tab.id);
    if (typeof displayToastNotification === 'function') displayToastNotification(`New blank tab`);
  },

  createBlankSlideTab() {
    if (window.APP_STATE) {
      window.APP_STATE.activeSessionId = (window.APP_STATE.activeSessionId || 0) + 1;
      window.APP_STATE.fileObjects = {};
    }
    const state = this._createBlankState();
    state.slideDeck = this._defaultSlideDeck();
    const tab = this.createTab('Blank Slide Deck', state.htmlContent, state);
    TAB_FILE_OBJECTS.set(tab.id, {});
    this.switchTo(tab.id);
    if (typeof displayToastNotification === 'function') displayToastNotification(`New blank slide deck`);
  },

  switchTo(tabId) {
    if (!tabId) return;
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (this.activeId) this._captureCurrentState(this.activeId);
    if (window.APP_STATE) window.APP_STATE.activeSessionId = (window.APP_STATE.activeSessionId || 0) + 1;
    this.activeId = tabId;
    this._loadStateIntoUI(tab);
    this._persist();
    this.renderTabBar();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); });
    }
    if (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout()) {
      const currentView = window.APP_STATE?.currentMobileView || 'editor';
      if (typeof setMobileView === 'function') setMobileView(currentView);
    }
  },

  deleteTab(tabId) {
    if (this.tabs.length <= 1) {
      if (typeof displayToastNotification === 'function') {
        displayToastNotification("Cannot delete the last tab. Start a new document if you need a fresh one.");
      }
      return;
    }
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (!confirm(`Delete tab "${tab.name}"? This will discard all its content.`)) return;
    const wasActive = this.activeId === tabId;
    const index = this.tabs.indexOf(tab);
    this.tabs.splice(index, 1);
    if (wasActive) {
      const newActive = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeId = newActive.id;
      this._loadStateIntoUI(newActive);
    } else if (this.activeId === tabId) {
      this.activeId = this.tabs[0] ? this.tabs[0].id : null;
      if (this.activeId) this._loadStateIntoUI(this.tabs[0]);
    }
    this._persist();
    this.renderTabBar();
    if (typeof displayToastNotification === 'function') displayToastNotification(`Tab "${tab.name}" deleted`);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); });
    }
  },

  getActive() {
    if (!this.activeId) return this.tabs[0] || null;
    return this.tabs.find(t => t.id === this.activeId) || this.tabs[0] || null;
  },

  ensureTab() {
    if (this.tabs.length === 0) {
      const tab = this.createTab('Untitled');
      this.activeId = tab.id;
      this._loadStateIntoUI(tab);
      this._persist();
      return tab;
    }
    return this.getActive();
  },

  renderTabBar() {
    const bar = document.getElementById('tab-bar');
    if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
    const oldFab = document.getElementById('topbar-newtab-fab-btn');
    if (oldFab) oldFab.style.display = 'none';
  },

  _ensureBlankSlideTabHasDeck() {
    try {
      if (!window.APP_STATE || window.APP_STATE.creationMode !== 'slides') return;
      const tab = this.getActive();
      if (!tab || tab.slideDeck) return;
      const isBlank = String(tab.htmlContent || '').includes('Start typing here') &&
        !(Array.isArray(tab.chatHistory) && tab.chatHistory.length) &&
        !Object.keys(tab.attachedFiles || {}).length;
      if (!isBlank) return;
      tab.slideDeck = this._defaultSlideDeck();
      this._loadStateIntoUI(tab);
    } catch (e) {
      console.warn('[TabManager] ensure blank slide deck failed:', e);
    }
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;

    const restored = this._restore();

    if (!restored || this.tabs.length === 0) {
      const currentHtml = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
      const state = this._createBlankState();
      state.htmlContent = currentHtml || state.htmlContent;
      state.chatHistory = window.APP_STATE?.chatHistory ? [...window.APP_STATE.chatHistory] : [];
      state.attachedFiles = { ...(window.APP_STATE?.attachedFiles || {}) };
      state.undoStack = window.HISTORY?.undoStack ? [...window.HISTORY.undoStack] : [];
      state.redoStack = window.HISTORY?.redoStack ? [...window.HISTORY.redoStack] : [];
      state.projectVersion = window.APP_STATE?.projectVersion || 0;
      state.theme = window.APP_STATE?.theme || 'light';
      state.photocopyMode = document.body.classList.contains('photocopy-mode');

      const tab = this.createTab(
        this._getTabNameFromHtml(state.htmlContent) || 'Untitled',
        state.htmlContent,
        state,
        false
      );
      this.activeId = tab.id;
      this._persist();
      this._loadStateIntoUI(tab);
    } else {
      const active = this.getActive();
      if (active) {
        this._loadStateIntoUI(active);
      } else {
        const tab = this.tabs[0];
        this.activeId = tab.id;
        this._loadStateIntoUI(tab);
      }
    }

    this._ensureBlankSlideTabHasDeck();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(_releaseBootViewGuard));
    } else {
      _releaseBootViewGuard();
    }
    this.renderTabBar();
    const fab = document.getElementById('topbar-newtab-fab-btn');
    if (fab) {
      fab.style.display = (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout()) ? 'flex' : 'none';
    }
  }
};

// ===== TAB-AWARE SAVE/LOAD FUNCTIONS =====
window.saveProjectFile = function() {
  if (TAB_MANAGER.activeId) TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
  TAB_MANAGER._persist();

  const projectData = {
    htmlContent: typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '',
    chatHistory: window.APP_STATE?.chatHistory || [],
    theme: window.APP_STATE?.theme || 'light',
    photocopyMode: document.body.classList.contains('photocopy-mode'),
    attachedFiles: window.APP_STATE?.attachedFiles || {},
    selectedPage: window.APP_STATE?.selectedPage || null,
    projectVersion: window.APP_STATE?.projectVersion || 0,
    tabId: TAB_MANAGER.activeId,
    tabName: TAB_MANAGER.getActive() ? TAB_MANAGER.getActive().name : 'Untitled'
  };
  const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = (projectData.tabName || 'Document') + '.aipdf';
  link.click();
  URL.revokeObjectURL(link.href);
  if (typeof displayToastNotification === 'function') {
    displayToastNotification(`Saved Project (tab: ${projectData.tabName})`);
  }
};

window.loadProjectFromFile = function(fileList) {
  if (!fileList || fileList.length === 0) return;
  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const parsedData = JSON.parse(event.target.result);
      const state = TAB_MANAGER._createBlankState();
      state.htmlContent = parsedData.htmlContent || state.htmlContent;
      state.chatHistory = Array.isArray(parsedData.chatHistory) ? parsedData.chatHistory : [];
      state.attachedFiles = parsedData.attachedFiles && typeof parsedData.attachedFiles === 'object' ? parsedData.attachedFiles : {};
      state.selectedPage = parsedData.selectedPage || null;
      state.projectVersion = Number.isFinite(parsedData.projectVersion) ? parsedData.projectVersion : 0;
      state.theme = parsedData.theme || 'light';
      state.photocopyMode = !!parsedData.photocopyMode;
      state.undoStack = [];
      state.redoStack = [];

      const tab = TAB_MANAGER.createTab(
        parsedData.tabName || 'Loaded',
        state.htmlContent,
        state
      );
      TAB_MANAGER.switchTo(tab.id);
      if (typeof displayToastNotification === 'function') {
        displayToastNotification(`Loaded project: "${tab.name}"`);
      }
    } catch (e) {
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('Error Invalid project format.');
      }
    }
  };
  if (fileList[0]) reader.readAsText(fileList[0]);
  const input = document.getElementById('project-load-input');
  if (input) input.value = '';
};

// ===== START NEW PROJECT =====
function startNewProject() {
  const mode = (window.APP_STATE && window.APP_STATE.creationMode === 'slides') ? 'slides' : 'pdf';
  if (mode === 'slides') {
    TAB_MANAGER.createBlankSlideTab();
  } else {
    TAB_MANAGER.createBlankTab();
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); });
  }
}

// ===== LEGACY COMPATIBILITY =====
window.saveStateToLocalStorage = function() {
  return true;
};

// ============================================================
// WINDOW EXPOSURE – Tab Manager
// ============================================================
window.TAB_MANAGER = TAB_MANAGER;
window.startNewProject = startNewProject;
window.saveProjectFile = saveProjectFile;
window.loadProjectFromFile = loadProjectFromFile;

// Make sure a postponed save is never lost when the tab is hidden or closed.
try {
  window.addEventListener('pagehide', () => { try { TAB_MANAGER.flushPersist(); } catch (_) {} });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { try { TAB_MANAGER.flushPersist(); } catch (_) {} } });
} catch (_) { /* non-browser environment */ }

// ========================================================================
// SETTINGS MODAL AS A BOTTOM SHEET
// ------------------------------------------------------------------------
// The layout (card anchored to the bottom, max 2/3 of the screen so the top
// third stays free) is pure CSS in index.html. This adds the behaviour:
//   - slide-up animation every time the modal is shown
//   - drag down to slide the sheet away:
//       * from the handle or the header (mouse or touch), or
//       * from anywhere in the body when the content is scrolled to the top
//   - released past ~110px (or flicked down quickly) -> the modal closes;
//     released earlier -> it springs back.
// The modal is opened/closed by two different functions (index.html and
// ai-models.js both define openAIModelsModal), so instead of wrapping them
// we watch the element's own display style. Safe to call more than once.
// ========================================================================
// Desktop: settings modal centred on screen. Mobile: unchanged bottom sheet,
// plus scroll-performance tuning. Injected once; uses !important because the
// base sheet layout lives in index.html.
(function _injectSettingsModalLayoutStyle() {
  if (typeof document === 'undefined') return;
  function inject() {
    if (document.getElementById('studio-settings-layout-style')) return;
    const st = document.createElement('style');
    st.id = 'studio-settings-layout-style';
    st.textContent = [
      /* ---------- all screens: smooth, GPU-friendly scrolling ---------- */
      '#ai-models-modal .ai-models-modal-card{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scroll-behavior:auto;}',
      '#ai-models-modal .settings-tab-panel{overscroll-behavior:contain;}',
      '.studio-setting-row{contain:layout paint;}',
      /* ---------- even left/right gutters so text no longer hugs the left edge ---------- */
      '#ai-models-modal .settings-tab-panel{box-sizing:border-box;padding-left:max(16px,env(safe-area-inset-left)) !important;padding-right:max(16px,env(safe-area-inset-right)) !important;}',
      '#ai-models-modal .settings-tab-panel .settings-subsection-title{margin-left:0 !important;padding-left:2px;}',
      '#ai-models-modal .settings-tab-panel .studio-setting-row{padding-left:10px;padding-right:10px;}',
      /* ---------- mobile (bottom sheet stays as it is) ---------- */
      '@media (max-width:768px){',
      '  #ai-models-modal .ai-models-modal-card{touch-action:pan-y;will-change:scroll-position;transform:translateZ(0);}',
      /* expensive effects inside the scrolling area are dropped on phones */
      '  #ai-models-modal .ai-models-modal-card .studio-switch,#ai-models-modal .ai-models-modal-card .studio-setting-row{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}',
      '  #ai-models-modal .studio-setting-row,#ai-models-modal .studio-switch,#ai-models-modal .studio-switch-knob{transition:none !important;}',
      '  body.settings-sheet-dragging #ai-models-modal .ai-models-modal-card{will-change:transform;}',
      '}',
      /* ---------- desktop: centred dialog ---------- */
      '@media (min-width:769px){',
      '  #ai-models-modal .settings-sheet-handle{display:none !important;}',
      '  #ai-models-modal .settings-tab-panel{padding-left:26px !important;padding-right:26px !important;}',
      '  #ai-models-modal .ai-models-modal-card{position:fixed !important;top:50% !important;left:50% !important;right:auto !important;bottom:auto !important;margin:0 !important;transform:translate(-50%,-50%) !important;width:min(760px,92vw) !important;max-width:92vw !important;height:auto !important;max-height:min(86vh,820px) !important;border-radius:18px !important;overflow-y:auto;}',
      '  #ai-models-modal.settings-sheet-opening .ai-models-modal-card{animation:studioSettingsFadeIn .18s ease-out !important;}',
      '}',
      '@keyframes studioSettingsFadeIn{from{opacity:0}to{opacity:1}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  if (document.head) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();

window.initSettingsSheet = function () {
  if (typeof document === 'undefined') return false;
  const modal = document.getElementById('ai-models-modal');
  if (!modal) return false;
  if (modal.dataset.sheetInit === '1') return true;
  const card = modal.querySelector('.ai-models-modal-card');
  if (!card) return false;
  modal.dataset.sheetInit = '1';

  // Bottom-sheet behaviour only on narrow (mobile) screens; wider screens get
  // a centred dialog (see _injectSettingsModalLayoutStyle).
  const SHEET_MQ = (typeof window.matchMedia === 'function') ? window.matchMedia('(max-width: 768px)') : null;
  function isSheetMode() { return !SHEET_MQ || SHEET_MQ.matches; }

  const CLOSE_DISTANCE = 110;   // px dragged down before release closes the sheet
  const CLOSE_VELOCITY = 0.6;   // px/ms flick speed that also closes it
  const SLOP = 4;               // px of downward pull before a body-drag begins

  // Older markup without the handle: create it.
  let handle = card.querySelector('.settings-sheet-handle');
  if (!handle) {
    handle = document.createElement('div');
    handle.className = 'settings-sheet-handle';
    handle.setAttribute('aria-hidden', 'true');
    card.insertBefore(handle, card.firstChild);
  }
  const header = card.querySelector('.ai-models-modal-header');

  // ---- slide-up on open ------------------------------------------------
  const isShown = function () {
    try { return window.getComputedStyle(modal).display !== 'none'; } catch (_) { return modal.style.display !== 'none'; }
  };
  let wasShown = isShown();
  let openTimer = null;
  let lastShownAt = 0;
  function onShown() {
    // Play the open animation once per open: a second "shown" signal within
    // 700ms (double-fired click/touch, two open functions) must not replay it.
    const t0 = Date.now();
    if (t0 - lastShownAt < 700) return;
    lastShownAt = t0;
    card.style.transition = '';
    card.style.transform = '';
    card.scrollTop = 0;
    modal.classList.remove('settings-sheet-opening');
    void modal.offsetWidth;                       // restart the animation
    modal.classList.add('settings-sheet-opening');
    clearTimeout(openTimer);
    openTimer = setTimeout(function () { modal.classList.remove('settings-sheet-opening'); }, 400);
  }
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function () {
      const now = isShown();
      if (now && !wasShown) onShown();
      wasShown = now;
    }).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  // ---- drag core -------------------------------------------------------
  let drag = null;                                // { startY, dy, lastY, lastT, v }
  const now = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };

  function start(y) {
    clearTimeout(openTimer);
    modal.classList.remove('settings-sheet-opening');
    card.style.transition = 'none';
    document.body.classList.add('settings-sheet-dragging');
    drag = { startY: y, dy: 0, lastY: y, lastT: now(), v: 0 };
  }
  function move(y) {
    if (!drag) return;
    const t = now();
    const dt = t - drag.lastT;
    if (dt > 0) drag.v = 0.6 * ((y - drag.lastY) / dt) + 0.4 * drag.v;   // smoothed px/ms, + = downward
    drag.lastY = y; drag.lastT = t;
    drag.dy = Math.max(0, y - drag.startY);                              // never drag upward past rest
    card.style.transform = drag.dy ? 'translateY(' + drag.dy + 'px)' : '';
  }
  function finishClose() {
    card.style.transition = '';
    try {
      if (typeof window.closeAIModelsModal === 'function') window.closeAIModelsModal();
      else modal.style.display = 'none';
    } catch (_) { modal.style.display = 'none'; }
    card.style.transform = '';                    // reset while hidden, ready for the next open
  }
  function end() {
    if (!drag) return;
    const dy = drag.dy, v = drag.v;
    drag = null;
    document.body.classList.remove('settings-sheet-dragging');
    if (dy > CLOSE_DISTANCE || (v > CLOSE_VELOCITY && dy > 30)) {
      card.style.transition = 'transform .2s ease-out';
      card.style.transform = 'translateY(100%)';
      setTimeout(finishClose, 200);
    } else {
      card.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)';
      card.style.transform = '';
      setTimeout(function () { card.style.transition = ''; }, 240);
    }
  }

  // ---- 1) handle + header: pointer events (mouse and touch) -------------
  function bindPointerDrag(el) {
    if (!el) return;
    el.addEventListener('pointerdown', function (e) {
      if (!isSheetMode()) return;                 // desktop dialog: no drag-to-close
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button,a,input,select,textarea')) return;
      start(e.clientY);
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });
    el.addEventListener('pointermove', function (e) { if (drag) move(e.clientY); });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      el.addEventListener(t, function () { end(); });
    });
  }
  bindPointerDrag(handle);
  bindPointerDrag(header);

  // ---- 2) body: touch drag, only when scrolled to the very top ----------
  // PERF: a permanent non-passive touchmove listener on the scroll container
  // forces the browser to wait for JS on EVERY scroll frame (that was the
  // mobile scroll lag). The blocking listener is now attached only for a
  // touch that starts while the content is already at the very top (the only
  // case where a drag-to-close can begin) and is removed right after.
  let cand = null;                                // { y, active }
  let blockingAttached = false;
  function onBodyTouchMove(e) {
    if (!cand || !e.touches || !e.touches.length) return;
    const y = e.touches[0].clientY;
    if (!cand.active) {
      const dy = y - cand.y;
      if (dy < -SLOP) { detachBlocking(); cand = null; return; }  // scrolling up: ordinary scroll
      if (card.scrollTop > 0 || dy < SLOP) return;                // not pulled enough yet
      cand.active = true;
      start(y);
    }
    if (e.cancelable) e.preventDefault();                         // stop card scrolling while dragging
    move(y);
  }
  function attachBlocking() {
    if (blockingAttached) return;
    blockingAttached = true;
    card.addEventListener('touchmove', onBodyTouchMove, { passive: false });
  }
  function detachBlocking() {
    if (!blockingAttached) return;
    blockingAttached = false;
    card.removeEventListener('touchmove', onBodyTouchMove, { passive: false });
  }
  card.addEventListener('touchstart', function (e) {
    cand = null;
    detachBlocking();
    if (!isSheetMode()) return;                               // desktop: no drag-to-close
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.target;
    if (t && t.closest && t.closest('.settings-sheet-handle,.ai-models-modal-header,input,textarea,select,[contenteditable]')) return;
    if (card.scrollTop > 0) return;                           // mid-scroll: stay fully passive
    cand = { y: e.touches[0].clientY, active: false };
    attachBlocking();
  }, { passive: true });
  ['touchend', 'touchcancel'].forEach(function (t) {
    card.addEventListener(t, function () {
      if (cand && cand.active) end();
      cand = null;
      detachBlocking();
    }, { passive: true });
  });

  // Ignore a second openAIModelsModal() call that arrives right after the
  // first (the same tap reaching two handlers). index.html and ai-models.js
  // may define it, and scripts load in any order, so retry until it exists.
  function installOpenGuard() {
    const orig = window.openAIModelsModal;
    if (typeof orig !== 'function') return false;
    if (orig.__sheetOpenGuard) return true;
    const guarded = function () {
      if (isShown() && Date.now() - lastShownAt < 700) return undefined;
      return orig.apply(this, arguments);
    };
    guarded.__sheetOpenGuard = true;
    window.openAIModelsModal = guarded;
    return true;
  }
  if (!installOpenGuard()) {
    let tries = 0;
    const iv = setInterval(function () { if (installOpenGuard() || ++tries > 20) clearInterval(iv); }, 500);
  }

  if (wasShown) onShown();
  return true;
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { window.initSettingsSheet(); } catch (e) { console.warn('[Settings] sheet init failed:', e); } });
  } else {
    try { window.initSettingsSheet(); } catch (e) { console.warn('[Settings] sheet init failed:', e); }
  }
}
