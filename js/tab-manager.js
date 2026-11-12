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

const TAB_FILE_OBJECTS = new Map();

const BOOT_VIEW_KEY = 'paperly_boot_view';
function _releaseBootViewGuard() {
  try { const st = document.getElementById('boot-view-guard'); if (st) st.remove(); } catch (_) {}
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
  } catch (e) { console.warn('syncCurrentTabFileObjects failed:', e); }
}

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
    if (typeof window._unlockChatInput === 'function') { try { window._unlockChatInput(); } catch (_) {} }
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
  } catch (e) { console.warn('[TabManager] _resetTransientChatState failed:', e); }
}

// ========================================================================
// STUDIO SETTINGS — global user preferences (persisted in localStorage)
// ------------------------------------------------------------------------
// Two user-facing switches (all labels in English):
//
//   1) useAIVision          (default true)
//        ON  → AI vision is used as a fallback to read images/scanned
//              pages that local OCR cannot handle.
//        OFF → vision disabled entirely; content that cannot be read
//              locally is kept as-is (image).
//
//   2) keepFiguresAsImage   (default true)
//        ON  → figures in text-layer pages are cropped as images.
//        OFF → AI recreates figures from the text layer (requires
//              useAIVision to be ON to have any effect).
//
// ocr.js reads these through the compatibility API:
//   window.isOcrKeepImageSwitchOn()        → true  when images should NOT be read (vision off)
//   window.isTextFigureRecreateSwitchOn()  → true  only when vision is on AND keepFiguresAsImage is off
// ========================================================================
const STUDIO_SETTINGS_KEY = 'paperly_studio_settings_v1';

const STUDIO_SETTINGS_DEFAULTS = Object.freeze({
  useAIVision: true,
  keepFiguresAsImage: true,
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
    // Backward compat with the previous key scheme
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
    }));
  } catch (_) {}
}

(function _initStudioSettings() {
  if (!window.APP_STATE) window.APP_STATE = {};
  window.APP_STATE.studioSettings = _loadStudioSettings();
})();

window.STUDIO_SETTINGS_DEFAULTS = STUDIO_SETTINGS_DEFAULTS;

window.getStudioSettings = function () {
  if (!window.APP_STATE) window.APP_STATE = {};
  if (!window.APP_STATE.studioSettings) window.APP_STATE.studioSettings = _loadStudioSettings();
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

// ---- OCR compatibility API (ocr.js reads these) ----
window.isOcrKeepImageSwitchOn = function () {
  return !window.getStudioSetting('useAIVision');
};
window.isTextFigureRecreateSwitchOn = function () {
  return !!window.getStudioSetting('useAIVision') && !window.getStudioSetting('keepFiguresAsImage');
};
// Legacy policy getters kept for older call sites.
window.getOcrImagePolicy = function () {
  return window.getStudioSetting('useAIVision') ? 'read-vision' : 'keep-image';
};
window.getTextFigurePolicy = function () {
  return window.getStudioSetting('keepFiguresAsImage') ? 'crop' : 'recreate';
};

// ---- Settings panel switch renderer (English labels only) ----
window.renderStudioSwitches = function (containerEl, options) {
  if (!containerEl) return function () {};
  const opts = options || {};
  const idPrefix = opts.idPrefix || 'studio-setting';
  containerEl.textContent = '';
  const rows = [];

  function buildSwitch(key, labelText, descText) {
    const row = document.createElement('div');
    row.className = 'studio-setting-row';
    row.setAttribute('data-setting-key', key);
    row.style.cssText = 'display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid rgba(148,163,184,.22);';

    const text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:0;';

    const label = document.createElement('div');
    label.className = 'studio-setting-label';
    label.style.cssText = 'font-weight:600;font-size:14px;';
    label.textContent = labelText;

    const desc = document.createElement('div');
    desc.className = 'studio-setting-desc';
    desc.style.cssText = 'font-size:12.5px;opacity:0.72;margin-top:4px;line-height:1.5;';
    desc.textContent = descText;

    text.appendChild(label);
    text.appendChild(desc);
    row.appendChild(text);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = idPrefix + '-' + key;
    btn.className = 'studio-switch';
    btn.setAttribute('role', 'switch');
    btn.style.cssText = 'position:relative;width:46px;height:24px;border-radius:12px;border:none;cursor:pointer;background:#cbd5e1;transition:background 0.2s;flex:0 0 auto;padding:0;margin-top:2px;';

    const knob = document.createElement('span');
    knob.className = 'studio-switch-knob';
    knob.style.cssText = 'position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);';
    btn.appendChild(knob);
    row.appendChild(btn);

    function render() {
      const on = !!window.getStudioSetting(key);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.style.background = on ? '#22c55e' : '#cbd5e1';
      knob.style.left = on ? '24px' : '2px';
      // Visual hint: "Keep figures as image" has no visible effect unless
      // vision is ON, so dim it in that case.
      if (key === 'keepFiguresAsImage') {
        btn.style.opacity = window.getStudioSetting('useAIVision') ? '1' : '0.45';
        btn.title = window.getStudioSetting('useAIVision')
          ? (on ? 'Figures will be cropped as images' : 'AI will recreate figures (vision active)')
          : 'Turn on "Use AI Vision" first to recreate figures';
      } else {
        btn.title = on
          ? 'AI vision is available for fallback reading'
          : 'AI vision is off; unreadable content is kept as image';
      }
    }

    btn.addEventListener('click', function () {
      if (key === 'keepFiguresAsImage' && !window.getStudioSetting('useAIVision')) {
        // When vision is off, recreating figures is impossible — force ON so
        // the user's intent (crop as image) stays consistent.
        window.setStudioSetting('keepFiguresAsImage', true);
      } else {
        window.setStudioSetting(key, !window.getStudioSetting(key));
      }
      rows.forEach(function (r) { r.render(); });
    });

    render();
    return { row: row, render: render };
  }

  const s1 = buildSwitch(
    'useAIVision',
    'Use AI Vision',
    'When ON, local OCR runs first and AI vision is used as a fallback for images it cannot read. When OFF, AI vision is disabled entirely and unreadable content is kept as-is.'
  );
  const s2 = buildSwitch(
    'keepFiguresAsImage',
    'Keep figures as image',
    'When ON, diagrams and figures in text-layer pages are cropped as images. When OFF, AI recreates them from the text layer (requires "Use AI Vision" to be ON).'
  );
  containerEl.appendChild(s1.row);
  containerEl.appendChild(s2.row);
  rows.push(s1, s2);

  const unsubscribe = window.onStudioSettingChange(function () {
    rows.forEach(function (r) { r.render(); });
  });
  return unsubscribe;
};

// ---- Horizontal settings tabs (Preference / AI Models / Permissions) ----
window.initSettingsTabs = function () {
  const tabBar = document.querySelector('.settings-tab-bar');
  if (!tabBar) return;
  const panels = document.querySelectorAll('.settings-tab-panel');
  if (!panels.length) return;

  function showTab(tabName) {
    tabBar.querySelectorAll('[data-tab]').forEach(function (b) {
      const isActive = b.dataset.tab === tabName;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach(function (p) {
      p.hidden = p.dataset.panel !== tabName;
    });
  }

  tabBar.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    showTab(btn.dataset.tab);
  });

  const initial = tabBar.querySelector('[data-tab].active') || tabBar.querySelector('[data-tab]');
  if (initial) showTab(initial.dataset.tab);
};

// ---- Header rename: "AI Models" → "Settings" (best effort) ----
window.renameAIModelsHeaderToSettings = function () {
  try {
    let found = false;
    const selectors = ['#ai-models-btn', '.ai-models-btn', '[data-action="open-ai-models"]', '[data-i18n-key="aiModels"]', '[data-i18n="aiModels"]'];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        found = true;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let n;
        while ((n = walker.nextNode())) {
          n.textContent = n.textContent.replace(/AI\s*Models?/gi, 'Settings');
        }
        if (el.hasAttribute('title')) el.setAttribute('title', el.getAttribute('title').replace(/AI\s*Models?/gi, 'Settings'));
        if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.getAttribute('aria-label').replace(/AI\s*Models?/gi, 'Settings'));
      });
    });
    if (!found) {
      document.querySelectorAll('button, a, [role="button"]').forEach(function (el) {
        if (el.children.length > 2) return;
        if (/^\s*AI\s*Models?\s*$/i.test(el.textContent || '')) {
          el.textContent = 'Settings';
          found = true;
        }
      });
    }
    return found;
  } catch (e) {
    console.warn('[StudioSettings] header rename failed:', e);
    return false;
  }
};

// Deprecated: the settings panel now uses real HTML tabs, so this is a no-op kept for safety.
window.restructureSettingsPanel = function () { return true; };

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

  _generateId() { return 'tab_' + (this.nextId++); },

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
    } finally { this._loading = false; }
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
      try { setDocumentHTMLAndPaginate(html, false); } catch (e) { console.error('Tab switch: failed to paginate', e); }
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
    { let totalChars = 0; for (const tb of this.tabs) totalChars += (tb.htmlContent ? tb.htmlContent.length : 0);
      if (totalChars > 3400000) { this._persistEmergencyMetadata(); return; } }
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
          try { const serialized = JSON.stringify(t.slideDeck); slideDeck = serialized.length <= 900000 ? t.slideDeck : null; }
          catch (_) { slideDeck = null; }
        }
        const pendingOutline = _compactPendingOutlineForStorage(t.pendingOutline);
        return {
          id: t.id, name: t.name || 'Untitled', htmlContent: t.htmlContent || '',
          attachedFiles, selectedPage: t.selectedPage ?? null, projectVersion: t.projectVersion || 0,
          scrollPosition: t.scrollPosition || 0, theme: t.theme || 'light',
          pdfVisualFormat: t.pdfVisualFormat || window.APP_STATE?.pdfVisualFormat || 'default',
          pdfTextFormat: t.pdfTextFormat || window.APP_STATE?.pdfTextFormat || 'default',
          pdfLanguageFormat: t.pdfLanguageFormat || window.APP_STATE?.pdfLanguageFormat || 'default',
          photocopyMode: !!t.photocopyMode, slideDeck, pendingOutline
        };
      });
      const data = { version: 2, compact: true, tabs: compactTabs, activeId: this.activeId, nextId: this.nextId };
      const payload = JSON.stringify(data);
      if (payload.length / (1024 * 1024) > 3.6) { this._persistEmergencyMetadata(); return; }
      localStorage.setItem(TAB_STORAGE_KEY, payload);
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    } catch (e) { console.warn('Failed to persist compact tabs:', e); this._persistEmergencyMetadata(); }
  },

  _persistEmergencyMetadata() {
    try {
      const data = {
        version: 3, compact: true,
        tabs: this.tabs.map(t => {
          let slideDeck = null;
          if (t.id === this.activeId && t.slideDeck) {
            try { const serialized = JSON.stringify(t.slideDeck); slideDeck = serialized.length <= 300000 ? t.slideDeck : null; }
            catch (_) { slideDeck = null; }
          }
          return {
            id: t.id, name: t.name || 'Untitled',
            htmlContent: t.id === this.activeId ? String(t.htmlContent || '').slice(0, 180000) : '',
            selectedPage: t.selectedPage ?? null, projectVersion: t.projectVersion || 0,
            scrollPosition: t.scrollPosition || 0, theme: t.theme || 'light',
            pdfVisualFormat: t.pdfVisualFormat || 'default', pdfTextFormat: t.pdfTextFormat || 'default',
            pdfLanguageFormat: t.pdfLanguageFormat || 'default', photocopyMode: !!t.photocopyMode,
            slideDeck,
            pendingOutline: t.id === this.activeId ? _compactPendingOutlineForStorage(t.pendingOutline) : null
          };
        }),
        activeId: this.activeId, nextId: this.nextId
      };
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(data));
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    } catch (e2) { console.warn('Emergency persistence skipped:', e2); }
  },

  _restore() {
    try {
      const raw = localStorage.getItem(TAB_STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.tabs || !Array.isArray(data.tabs) || data.tabs.length === 0) return false;
      this.tabs = data.tabs.map(t => ({
        id: t.id || this._generateId(), name: t.name || 'Untitled',
        htmlContent: t.htmlContent || this._createBlankState().htmlContent,
        chatHistory: Array.isArray(t.chatHistory) ? t.chatHistory : [],
        attachedFiles: Object.fromEntries(Object.entries(t.attachedFiles || {}).map(([id, f]) => [id, { ...(f || {}), sourceMode: 'ocr' }])),
        undoStack: t.undoStack || [], redoStack: t.redoStack || [],
        selectedPage: t.selectedPage || null, projectVersion: t.projectVersion || 0,
        scrollPosition: t.scrollPosition || 0, theme: t.theme || 'light',
        pdfVisualFormat: t.pdfVisualFormat || 'default', pdfTextFormat: t.pdfTextFormat || 'default',
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
    if (this.tabs.length === 0) { const tab = this.createTab('Untitled'); this.switchTo(tab.id); return; }
    const active = this.getActive();
    if (!active) { const tab = this.createTab('Untitled'); this.switchTo(tab.id); return; }
    this._captureCurrentState(this.activeId);
    const newTab = this.createTab(active.name + ' (copy)', active.htmlContent, {
      htmlContent: active.htmlContent, chatHistory: [], attachedFiles: {},
      undoStack: [], redoStack: [], selectedPage: null, projectVersion: 0,
      scrollPosition: 0, theme: active.theme || window.APP_STATE?.theme || 'light',
      photocopyMode: active.photocopyMode !== undefined ? active.photocopyMode : document.body.classList.contains('photocopy-mode'),
      slideDeck: active.slideDeck || null
    });
    this.switchTo(newTab.id);
    if (typeof displayToastNotification === 'function') displayToastNotification(`✅ New tab: "${newTab.name}"`);
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
    if (typeof displayToastNotification === 'function') displayToastNotification("✅ New session");
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
    if (typeof displayToastNotification === 'function') displayToastNotification(`✅ New blank tab`);
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
    if (typeof displayToastNotification === 'function') displayToastNotification(`✅ New blank slide deck`);
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
        displayToastNotification("⚠️ Cannot delete the last tab. Start a new document if you need a fresh one.");
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
    }
    this._persist();
    this.renderTabBar();
    if (typeof displayToastNotification === 'function') displayToastNotification(`🗑️ Tab "${tab.name}" deleted`);
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
    } catch (e) { console.warn('[TabManager] ensure blank slide deck failed:', e); }
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
      const tab = this.createTab(this._getTabNameFromHtml(state.htmlContent) || 'Untitled', state.htmlContent, state, false);
      this.activeId = tab.id;
      this._persist();
      this._loadStateIntoUI(tab);
    } else {
      const active = this.getActive();
      if (active) this._loadStateIntoUI(active);
      else { const tab = this.tabs[0]; this.activeId = tab.id; this._loadStateIntoUI(tab); }
    }
    this._ensureBlankSlideTabHasDeck();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(_releaseBootViewGuard));
    } else { _releaseBootViewGuard(); }
    this.renderTabBar();
    const fab = document.getElementById('topbar-newtab-fab-btn');
    if (fab) fab.style.display = (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout()) ? 'flex' : 'none';
  }
};

// ===== TAB-AWARE SAVE/LOAD =====
window.saveProjectFile = function () {
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
  if (typeof displayToastNotification === 'function') displayToastNotification(`💾 Saved Project (tab: ${projectData.tabName})`);
};

window.loadProjectFromFile = function (fileList) {
  if (!fileList || fileList.length === 0) return;
  const reader = new FileReader();
  reader.onload = function (event) {
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
      const tab = TAB_MANAGER.createTab(parsedData.tabName || 'Loaded', state.htmlContent, state);
      TAB_MANAGER.switchTo(tab.id);
      if (typeof displayToastNotification === 'function') displayToastNotification(`📂 Loaded project: "${tab.name}"`);
    } catch (e) {
      if (typeof displayToastNotification === 'function') displayToastNotification('Error Invalid project format.');
    }
  };
  if (fileList[0]) reader.readAsText(fileList[0]);
  const input = document.getElementById('project-load-input');
  if (input) input.value = '';
};

function startNewProject() {
  const mode = (window.APP_STATE && window.APP_STATE.creationMode === 'slides') ? 'slides' : 'pdf';
  if (mode === 'slides') TAB_MANAGER.createBlankSlideTab();
  else TAB_MANAGER.createBlankTab();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); });
  }
}

window.saveStateToLocalStorage = function () { return true; };

window.TAB_MANAGER = TAB_MANAGER;
window.startNewProject = startNewProject;
window.saveProjectFile = saveProjectFile;
window.loadProjectFromFile = loadProjectFromFile;

try {
  window.addEventListener('pagehide', () => { try { TAB_MANAGER.flushPersist(); } catch (_) {} });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { try { TAB_MANAGER.flushPersist(); } catch (_) {} } });
} catch (_) {}
