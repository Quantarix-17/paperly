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
// TAB MANAGER - Multi‑tab workspace with isolated state per tab
// ========================================================================

// Per-tab live File object maps (cannot be JSON-serialized to localStorage)
const TAB_FILE_OBJECTS = new Map();

// ========================================================================
// BOOT VIEW GUARD (no flash of the blank PDF page on refresh)
// ------------------------------------------------------------------------
// index.html always starts with the A4 document editor visible. A slide-deck
// session only switches to the Slides view once TAB_MANAGER.init() runs, so
// for ~1 second the blank PDF page was visible and then jumped to the deck.
// This runs the moment this file loads: if the last session was a slide deck
// it hides the A4 editor immediately, and init() reveals things again once
// the right view is in place. A 4s failsafe guarantees it can never stay hidden.
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
      // First load after this update: no flag yet, so peek at the saved tabs.
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
// ------------------------------------------------------------------------
// BUG this fixes: while the AI is showing tap-to-choose options (outline /
// clarify selection) the chat box is locked (readOnly + disabled Send). Opening
// a NEW tab wipes the chat bubble that owned those options, but the lock stayed
// on the textarea -> nothing could be typed. The old code called
// `unlockChatInputAfterClarify()`, a function that does not exist anywhere,
// so the unlock was silently skipped. A page refresh worked only because it
// rebuilt all of this state from scratch. This helper does that same reset
// explicitly, every time a tab is loaded.
// ========================================================================
function _resetTransientChatState() {
  try {
    const S = window.APP_STATE;
    if (S) {
      S.pendingClarify = null;       // unanswered AI question
      S.pendingPDFOutline = null;    // PDF outline waiting for approval
      S.pendingExamOutline = null;   // exam outline waiting for approval
      S.clarifyInputLock = null;     // option-only input lock
      S.isAIGenerating = false;      // a stale "busy" flag must not block typing
    }
    // 1) Real unlock (the function that actually exists in app.js)
    if (typeof window._unlockChatInput === 'function') {
      try { window._unlockChatInput(); } catch (_) {}
    }
    // 2) Belt and braces: force the DOM back to an editable state even if
    //    the function above is missing or throws.
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

const TAB_MANAGER = {
  tabs: [],
  activeId: null,
  nextId: 1,
  _initialized: false,
  // true while _loadStateIntoUI() is running. During that window APP_STATE is
  // only half-restored (e.g. APP_STATE.slideDeck is still empty after a page
  // refresh), so _captureCurrentState() must NOT copy it back into the tab.
  _loading: false,

  // The default blank slide every new / empty slide deck starts with.
  _defaultSlideDeck() {
    return {
      title: 'Untitled Deck',
      slides: [{ title: 'Untitled Deck', bullets: [], visual: null, visualSVG: null, align: null, bg: null }]
    };
  },

  // A slide deck must always contain at least one slide. If a saved deck came
  // back with an empty slides list, put the default blank slide back so the
  // editor never shows "no page". Non-deck tabs (null) are left alone.
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
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const h1 = temp.querySelector('h1, h2, h3');
    if (h1 && h1.innerText.trim() && !h1.innerText.includes('Start typing here')) {
      return h1.innerText.trim().slice(0, 24);
    }
    return 'Untitled';
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

  _captureCurrentState(tabId) {
    // FIX: never overwrite a tab with half-restored APP_STATE while it is
    // still being loaded (this was wiping the default blank slide on refresh).
    if (this._loading) return;
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const html = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
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
      // Restore the slide deck into APP_STATE FIRST, before anything else
      // (pagination, preview, persist hooks) can run and read an empty value.
      tab.slideDeck = this._normalizeSlideDeck(tab.slideDeck);
      if (window.APP_STATE) window.APP_STATE.slideDeck = tab.slideDeck || null;
      this._loadStateIntoUIInner(tab);
    } finally {
      this._loading = false;
    }
    // Everything is restored now; persist the (normalized) tab once so the
    // saved copy always matches what is on screen.
    try { this._persist(); } catch (_) {}
  },

  _loadStateIntoUIInner(tab) {
    if (!tab) return;

    // Clear and restore the chat pane
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
        // Keep this in sync with index.html's own #chat-empty-state markup.
        // This used to be missing the suggestion-chips block that the static
        // HTML has, so on load the page would briefly show the full empty
        // state (from index.html) and then, the moment tab restoration ran,
        // silently swap it for this shorter version — chips popping in and
        // then disappearing a beat later, which is what looked like
        // something overlapping/duplicating in the AI panel during refresh.
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

    if (window.APP_STATE) {
      window.APP_STATE.projectVersion = tab.projectVersion || 0;
    }

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
    if (tab.photocopyMode) {
      document.body.classList.add('photocopy-mode');
    } else {
      document.body.classList.remove('photocopy-mode');
    }
    if (typeof updateModeButtonText === 'function') updateModeButtonText();
    if (typeof applyMonochromeDocumentStyles === 'function') applyMonochromeDocumentStyles();

    if (window.APP_STATE) window.APP_STATE.slideDeck = tab.slideDeck || null;
    if (typeof renderSlideDeckPreview === 'function') renderSlideDeckPreview(tab.slideDeck || null);

    // Keep the slide-outline memory in step with the tab being shown. After a
    // page reload the chat pane is empty (chat history is not persisted), so
    // show the pending outline again, with its Generate-deck button.
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

    // A slide-deck tab is slide-shaped (16:9) content, not an A4 document —
    // switch straight to the Slides view for it, and back to the normal A4
    // editor for everything else, so the shape of the page always matches
    // the kind of document this tab actually is.
    const _tabIsSlideDeck = !!(tab.slideDeck && Array.isArray(tab.slideDeck.slides) && tab.slideDeck.slides.length);
    // FIX (mobile): switchPreviewTab() forces the Editor/Slides panel open on
    // phones. Closing all tabs (or deleting a tab) reloads a tab through here,
    // so the person got yanked out of AI Chat into the document editor.
    // Remember the panel they were on BEFORE and put them back afterwards
    // (same pattern as _syncBlankActiveTabToCreationMode in app.js).
    const _isMobileLayout = typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout();
    const _prevMobileView = (window.APP_STATE && window.APP_STATE.currentMobileView) || 'chat';
    if (typeof switchPreviewTab === 'function') switchPreviewTab(_tabIsSlideDeck ? 'slides' : 'editor');
    if (_isMobileLayout && typeof setMobileView === 'function') {
      setMobileView(_prevMobileView === 'chat' ? 'chat' : 'editor');
    }

    if (window.APP_STATE) window.APP_STATE.selectedPage = null;
    // Selected @ commands (and Canvas / Page / Detailed / Compact ...) are NOT cleared on tab
    // switch or new tab — they stay until the person removes them by hand.
    // A different tab means any unanswered AI question no longer applies.
    _resetTransientChatState();
    if (typeof renderSelectedCommandChips === 'function') renderSelectedCommandChips();
    if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();

    if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();
  },

  _persist() {
    // FIX: a persist before tabs are restored/created would overwrite the
    // saved workspace with an empty list.
    if (!this.tabs.length) return;
    // Keep the header's "New document" format lock in sync with the active
    // tab's real, just-captured content on every persist — this is the one
    // choke point every generation/edit/tab-switch pipeline already runs
    // through, so it stays correct without extra hooks scattered everywhere.
    if (this.activeId) {
      this._captureCurrentState(this.activeId);
      if (typeof updateCreationModeLockUI === 'function') updateCreationModeLockUI();
    }
    // Remember which view this session opens in, for the boot guard above.
    try {
      const a = this.getActive();
      const isDeck = !!(a && a.slideDeck && Array.isArray(a.slideDeck.slides) && a.slideDeck.slides.length);
      localStorage.setItem(BOOT_VIEW_KEY, isDeck ? 'slides' : 'editor');
    } catch (_) {}
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

        // Slide decks can carry inline SVG (charts/diagrams), so cap the
        // persisted size defensively — same "truncate rather than fail"
        // approach used above for attachedFiles content. A deck that
        // exceeds the cap is dropped from persistence (not crashed on);
        // it still exists live in APP_STATE.slideDeck for the session.
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
          // Even in the emergency (payload-too-large) fallback, keep a
          // size-capped slideDeck for the ACTIVE tab so a Slides tab
          // doesn't come back as a blank PDF tab on the next load just
          // because its saved HTML/attachments were too big — losing the
          // deck here is exactly what made a Slides tab look like it had
          // been "converted" to PDF after a refresh.
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
    // SINGLE SESSION MODEL (no multi-tab): starting/opening anything replaces the current session.
    // The outgoing session is handed to the cloud-history archiver (js/paperly-cloud.js) first.
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

    // Match startNewProject()'s behavior: whether the fresh tab is a blank
    // A4 document or a blank slide deck is decided by the header's
    // creation-mode dropdown (same source of truth used everywhere else).
    // Previously this always built a plain document state regardless of
    // that dropdown, so closing all tabs while "Slide Deck" was selected
    // still landed you back in the document/PDF editor instead of a blank
    // slide deck.
    const mode = (window.APP_STATE && window.APP_STATE.creationMode === 'slides') ? 'slides' : 'pdf';
    const state = this._createBlankState();
    if (mode === 'slides') {
      state.slideDeck = this._defaultSlideDeck();
    }
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

  // Same as createBlankTab(), but for the "Slide Deck" creation mode: the
  // new tab starts with an empty, editable slide deck (one title slide)
  // instead of a blank A4 document, and switchTo() (via _loadStateIntoUI)
  // takes care of showing the Slides view automatically.
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

    if (this.activeId) {
      this._captureCurrentState(this.activeId);
    }

    if (window.APP_STATE) {
      window.APP_STATE.activeSessionId = (window.APP_STATE.activeSessionId || 0) + 1;
    }

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
    } else if (this.activeId === tabId) {
      this.activeId = this.tabs[0] ? this.tabs[0].id : null;
      if (this.activeId) this._loadStateIntoUI(this.tabs[0]);
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
    // Multi-tab UI removed (single-session model): the tab bar is never drawn.
    const bar = document.getElementById('tab-bar');
    if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
    const oldFab = document.getElementById('topbar-newtab-fab-btn');
    if (oldFab) oldFab.style.display = 'none';
    return;
    // eslint-disable-next-line no-unreachable
    if (!bar) return;
    const active = this.getActive();

    bar.innerHTML = '';

    // "New tab" button - fixed on the left
    const newBtn = document.createElement('button');
    newBtn.id = 'tab-new-btn';
    newBtn.innerHTML = '▢';
    newBtn.title = 'New tab (duplicate current)';
    newBtn.setAttribute('aria-label', 'New tab');
    newBtn.onclick = () => this.duplicateActiveTab();
    bar.appendChild(newBtn);

    const scrollWrap = document.createElement('div');
    scrollWrap.id = 'tab-items-scroll';

    this.tabs.forEach(tab => {
      const isActive = tab.id === (active ? active.id : null);
      const item = document.createElement('div');
      item.className = 'tab-item' + (isActive ? ' active' : '');
      item.setAttribute('data-tab-id', tab.id);
      item.title = tab.name;

      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      item.appendChild(dot);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      nameSpan.textContent = tab.name || 'Untitled';
      item.appendChild(nameSpan);

      if (this.tabs.length > 1) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'tab-close';
        closeBtn.innerHTML = typeof renderCommandIcon === 'function' ? renderCommandIcon('close') : '×';
        closeBtn.setAttribute('aria-label', `Close tab ${tab.name || 'Untitled'}`);
        closeBtn.title = 'Close tab';
        closeBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.deleteTab(tab.id);
        };
        item.appendChild(closeBtn);
      }

      item.onclick = (e) => {
        if (e.target.closest('.tab-close')) return;
        if (tab.id !== (active ? active.id : null)) {
          this.switchTo(tab.id);
        }
      };

      scrollWrap.appendChild(item);
    });

    bar.appendChild(scrollWrap);

    const fab = document.getElementById('topbar-newtab-fab-btn');
    if (fab) {
      fab.style.display = (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout()) ? 'flex' : 'none';
    }
  },

  // Safety net: in "Slide Deck" creation mode, a blank tab (placeholder
  // content, no chat, no attachments) must always have the default blank
  // slide. If anything left it without a deck (e.g. after a refresh),
  // put the default deck back and show the Slides view.
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
    // The right view (Slides or Editor) is now showing: reveal on the next
    // painted frame so the A4 page can never flash in between.
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
    displayToastNotification(`💾 Saved Project (tab: ${projectData.tabName})`);
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
        displayToastNotification(`📂 Loaded project: "${tab.name}"`);
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
  // What "New document" (+) actually creates is decided by the header's
  // creation-mode dropdown (PDF/Document vs Slide Deck) — same source of
  // truth the @ command menu's "New document" chip already resolves
  // against, so both entry points agree instead of the header saying
  // "Slide Deck" while this button keeps making a blank A4 document.
  const mode = (window.APP_STATE && window.APP_STATE.creationMode === 'slides') ? 'slides' : 'pdf';
  // No confirmation prompt: "New" starts a fresh session immediately.
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
  // Legacy compatibility shim - TAB_MANAGER is the single persistence owner
  return true;
};// ============================================================
// WINDOW EXPOSURE – Tab Manager
// ============================================================
window.TAB_MANAGER = TAB_MANAGER;
window.startNewProject = startNewProject;
window.saveProjectFile = saveProjectFile;
window.loadProjectFromFile = loadProjectFromFile;
// TAB_MANAGER এর মেথডগুলো ইতিমধ্যেই window.TAB_MANAGER এর মাধ্যমে অ্যাক্সেসযোগ্য