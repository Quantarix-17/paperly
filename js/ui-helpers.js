// ========================================================================
// UI HELPERS - Toast, Progress, Theme, and General UI Utilities
// ========================================================================

// ===== TOAST NOTIFICATION =====
let toastHideTimer = null;

function displayToastNotification(msg) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================================
// QUOTES — এখন সব উক্তি ai-quotes.js (AIQuote) থেকে আসে।
// প্রতিবার নতুন করে AI তৈরি করে; কিছুই সেভ/ক্যাশ হয় না।
// ============================================================
// আগের সংস্করণের সেভ করা পুরোনো উক্তি একবার মুছে ফেলা হচ্ছে
try {
  localStorage.removeItem('ai_bengali_quotes_cache');
  localStorage.removeItem('ai_bengali_quotes_timestamp');
} catch (_) {}
// প্রতিটি উক্তি কত সেকেন্ড দেখানো হবে
const QUOTE_ROTATION_INTERVAL_MS = 18000;

// ============================================================
// GLOBAL PROGRESS UI (ENHANCED)
// ============================================================

const ProgressUI = {
  _interval: null,
  _startTime: 0,
  _estimatedMs: 0,
  _stepStartTime: 0,
  _totalSteps: 0,
  _stepDone: 0,
  _lastPct: 0,
  _mode: 'idle',
  _stageStartPct: 0,
  _stageEndPct: 0,
  _stageStartedAt: 0,
  _previewContainer: null,
  _fileProgressItems: new Map(),
  _pageCount: 0,
  _totalPages: 0,
  
  // ---- Quote Engine (কোনো তালিকা/ইতিহাস রাখা হয় না) ----
  _quoteInterval: null,
  _quoteRunId: 0, // পুরোনো দেরিতে-আসা উত্তর বাদ দিতে
  _quoteBuffer: null,
  _quoteBusy: false,
  _aiQuoteLoading: null,

  _els() {
    return {
      overlay: document.getElementById('global-progress-overlay'),
      title: document.getElementById('progress-overlay-title'),
      subtitle: document.getElementById('progress-overlay-subtitle'),
      fill: document.getElementById('progress-bar-fill'),
      time: document.getElementById('progress-bar-time'),
      preview: document.getElementById('progress-live-preview-scroll'),
      previewWrap: document.getElementById('progress-live-preview-wrap'),
      badge: document.getElementById('progress-model-badge'),
      scope: document.getElementById('progress-scope'),
      steps: document.getElementById('progress-steps'),
      pageCount: document.getElementById('progress-page-count'),
      ringFill: document.getElementById('progress-ring-fill'),
      ringIcon: document.getElementById('progress-ring-icon'),
      quoteText: document.getElementById('progress-quote-text'),
      quoteContent: document.getElementById('progress-quote-content'),
      quoteAttribution: document.getElementById('progress-quote-attribution'),
      previewPageLabel: document.getElementById('progress-preview-page-label')
    };
  },

  _RING_CIRC: 2 * Math.PI * 27,

  _formatTime(ms) {
    const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (sec < 60) return sec + 's';
    return Math.floor(sec / 60) + 'm ' + String(sec % 60).padStart(2, '0') + 's';
  },

  _elapsed() {
    return this._formatTime(Date.now() - this._startTime);
  },

  // No percentage numbers are shown anymore — the bar and ring stay in a
  // continuous "Play Store"-style indeterminate motion for the whole
  // operation. We still track _lastPct internally (used by the time
  // estimator), but it never drives a visible width or number.
  _setPercent(p, force = false) {
    p = Math.max(0, Math.min(100, Number(p) || 0));
    if (!force && p < this._lastPct) p = this._lastPct;
    this._lastPct = p;
    const { fill, ringFill } = this._els();
    if (fill) fill.classList.add('indeterminate');
    if (ringFill) ringFill.classList.add('indeterminate');
  },

  _setIndeterminate() {
    const { fill, ringFill } = this._els();
    if (fill) fill.classList.add('indeterminate');
    if (ringFill) ringFill.classList.add('indeterminate');
  },

  _setVisualStage(n) {
    const wrap = this._els().steps;
    if (!wrap) return;
    const spans = Array.from(wrap.querySelectorAll('[data-step]'));
    const lines = Array.from(wrap.querySelectorAll('i'));
    spans.forEach(el => {
      const step = Number(el.dataset.step || 0);
      el.classList.toggle('done', step < n);
      el.classList.toggle('active', step === n);
    });
    lines.forEach((el, i) => el.classList.toggle('done', i + 1 < n));
  },

  _startTicker() {
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(() => {
      if (typeof isCancellationRequested !== 'undefined' && isCancellationRequested) return;
      if (!this._startTime) return;
      const now = Date.now(),
        elapsed = now - this._startTime;
      const { time, fill } = this._els();

      if (this._mode === 'indeterminate') {
        if (fill) fill.classList.add('indeterminate');
        if (time) time.textContent = `Elapsed ${this._formatTime(elapsed)} • AI processing…`;
      } else if (this._mode === 'steps') {
        const remain = Math.max(0, this._totalSteps - this._stepDone);
        if (this._stepDone > 0 && remain > 0) {
          const avg = (now - this._stepStartTime) / this._stepDone;
          if (time) time.textContent = `Elapsed ${this._formatTime(elapsed)} • ~${this._formatTime(avg * remain)} remaining`;
        } else if (time) {
          time.textContent = `Elapsed ${this._formatTime(elapsed)} • ${remain ? 'Estimating…' : 'Finishing…'}`;
        }
      } else if (this._mode === 'estimate') {
        const rem = Math.max(0, this._estimatedMs - elapsed);
        const span = Math.max(1, this._stageEndPct - this._stageStartPct);
        const target = this._stageStartPct + span * (1 - Math.exp(-elapsed / Math.max(6500, this._estimatedMs * 0.65)));
        this._setPercent(Math.max(this._lastPct, target));
        if (time) {
          time.textContent = rem > 1000 ?
            `Elapsed ${this._formatTime(elapsed)} • estimated ~${this._formatTime(rem)} remaining` :
            `Elapsed ${this._formatTime(elapsed)} • finishing…`;
        }
      } else {
        const span = Math.max(1, this._stageEndPct - this._stageStartPct);
        const stageElapsed = now - this._stageStartedAt;
        const target = this._stageStartPct + Math.min(span * 0.82, span * (1 - Math.exp(-stageElapsed / 9000)));
        this._setPercent(Math.max(this._lastPct, target));
        if (time) time.textContent = `Elapsed ${this._formatTime(elapsed)} • Working…`;
      }
      
      this._updatePageCountDisplay();
    }, 250);
  },

  _updatePageCountDisplay() {
    const el = this._els().pageCount;
    if (!el) return;
    if (this._totalPages > 0) {
      el.textContent = `📄 পৃষ্ঠা ${this._pageCount} এর ${this._totalPages}`;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  },

  // ===== QUOTE ENGINE — প্রতিবার নতুন AI উক্তি (ai-quotes.js) =====
  // কিছুই সেভ হয় না। শুধু "পরের উক্তি" আগে থেকে তৈরি করে মেমরিতে রাখা হয়,
  // একবার দেখানোর পর বা modal বন্ধ হলে ফেলে দেওয়া হয়।
  _setQuoteText(text, attribution) {
    const { quoteContent, quoteAttribution, quoteText } = this._els();
    if (!quoteContent || !quoteText) return;
    quoteContent.textContent = text || '';
    if (quoteAttribution) quoteAttribution.textContent = attribution || '';
    quoteText.classList.toggle('visible', !!text);
    // লেখা না থাকলে বক্সটাই লুকাই — নইলে ছবির মতো ফাঁকা বক্স পড়ে থাকে
    const box = quoteText.closest('.progress-quote-container');
    if (box) box.style.display = text ? '' : 'none';
  },

  _clearQuote() { this._setQuoteText('', ''); },

  _showQuote(quote) {
    const { quoteText } = this._els();
    if (!quote || !quote.text || !quoteText) return;
    quoteText.classList.remove('visible');
    const myRun = this._quoteRunId;
    setTimeout(() => { if (myRun === this._quoteRunId) this._setQuoteText(quote.text, '— AI'); }, 300);
  },

  // ai-quotes.js লোড না থাকলে নিজে থেকে লোড করার চেষ্টা (HTML-এ script tag ভুলে গেলেও কাজ করবে)
  _ensureAIQuote() {
    if (typeof AIQuote !== 'undefined' && AIQuote.generate) return Promise.resolve(true);
    if (!this._aiQuoteLoading) {
      this._aiQuoteLoading = new Promise(resolve => {
        const sc = document.createElement('script');
        sc.src = 'js/ai-quotes.js';
        sc.onload = () => resolve(typeof AIQuote !== 'undefined');
        sc.onerror = () => { console.warn('[Quotes] ai-quotes.js লোড হয়নি — ফাইলটি index.html-এর পাশে রাখুন বা <script src="ai-quotes.js"> যোগ করুন।'); resolve(false); };
        document.head.appendChild(sc);
      });
    }
    return this._aiQuoteLoading;
  },

  async _generateQuote(runId) {
    if (!(await this._ensureAIQuote())) return null;
    for (let i = 0; i < 3; i++) {
      if (runId !== this._quoteRunId) return null;
      try {
        const q = await AIQuote.generate();
        if (runId !== this._quoteRunId) return null;
        if (q) return q;
      } catch (e) { console.warn('[Quotes] generation error:', e && e.message); }
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
    return null;
  },

  _startQuoteRotation() {
    this._stopQuoteRotation();
    const runId = ++this._quoteRunId;
    // জায়গাটা ফাঁকা না রেখে অপেক্ষার লেখা দেখাই (পুরোনো উক্তি নয়)
    this._setQuoteText('✨ আপনার জন্য নতুন একটি উক্তি তৈরি হচ্ছে…', '');
    this._quoteBuffer = null;
    this._quoteBusy = false;

    (async () => {
      let first = null;
      for (let round = 0; round < 4 && !first; round++) {
        first = await this._generateQuote(runId);
        if (runId !== this._quoteRunId) return;
        if (!first) await new Promise(r => setTimeout(r, 3000)); // লোডিং লেখা থাকে, বক্স ফাঁকা হয় না
        if (runId !== this._quoteRunId) return;
      }
      if (first) this._showQuote(first); else this._clearQuote();
      this._quoteBuffer = this._generateQuote(runId); // পরেরটা আগে থেকে তৈরি
    })();

    this._quoteInterval = setInterval(async () => {
      if (runId !== this._quoteRunId || this._quoteBusy || !this._quoteBuffer) return;
      this._quoteBusy = true;
      try {
        const next = await this._quoteBuffer;
        if (runId !== this._quoteRunId) return;
        this._quoteBuffer = this._generateQuote(runId);
        if (next) this._showQuote(next); // তৈরি না হলে আগেরটাই থাকে, ফাঁকা হয় না
      } finally { this._quoteBusy = false; }
    }, QUOTE_ROTATION_INTERVAL_MS);
  },

  _stopQuoteRotation() {
    this._quoteRunId++; // চলমান অনুরোধের ফল আর দেখানো হবে না
    this._quoteBuffer = null; // আগে থেকে তৈরি উক্তিও ফেলে দেওয়া হয়
    if (this._quoteInterval) {
      clearInterval(this._quoteInterval);
      this._quoteInterval = null;
    }
  },

  // ===== LIVE PAGE NUMBER UPDATE (NO CONTENT PREVIEW) =====
  updateLivePageNumber(pageNumber, totalPages) {
    this._pageCount = Math.max(0, Number(pageNumber) || 0);
    this._totalPages = Math.max(0, Number(totalPages) || 0);
    this._updatePageCountDisplay();
    const label = this._els().previewPageLabel;
    if (label) {
      label.textContent = totalPages ? `পৃষ্ঠা ${pageNumber || 1} এর ${totalPages}` : `পৃষ্ঠা ${pageNumber || 1}`;
    }
  },

  // ===== SHOW =====
  show(title, subtitle) {
    const e = this._els();
    e.overlay.style.display = 'flex';
    e.title.textContent = title || 'Working...';
    e.subtitle.textContent = subtitle || '';
    if (e.badge) e.badge.textContent = '';
    if (e.scope) e.scope.textContent = '';
    if (e.time) e.time.textContent = 'Elapsed 0s';
    if (e.ringIcon) e.ringIcon.innerHTML = '';
    if (e.fill) { e.fill.classList.add('indeterminate'); e.fill.style.width = ''; }
    if (e.ringFill) e.ringFill.classList.add('indeterminate');

    this._startTime = Date.now();
    this._stepStartTime = this._startTime;
    this._estimatedMs = 0;
    this._totalSteps = 0;
    this._stepDone = 0;
    // প্রোগ্রেস বার ০% থেকে শুরু
    this._lastPct = 0;
    this._mode = 'stage';
    this._stageStartPct = 0;
    this._stageEndPct = 0;
    this._stageStartedAt = this._startTime;
    this._pageCount = 0;
    this._totalPages = 0;
    this._setPercent(0, true);
    this._fileProgressItems.clear();
    
    if (e.preview) e.preview.innerHTML = '';
    this._previewContainer = e.preview;
    if (e.previewWrap) e.previewWrap.classList.remove('has-items');

    this._setVisualStage(1);
    this._updatePageCountDisplay();

    // লাইভ কোটেশন শুরু
    this._startQuoteRotation();

    const cancel = document.getElementById('cancel-processing-btn');
    if (cancel) cancel.disabled = false;
    if (typeof resetCancellationState === 'function') resetCancellationState();

    this._startTicker();
  },

  setLabel(t) {
    const e = this._els().subtitle;
    if (e) e.textContent = t || '';
  },

  setScope(t) {
    const e = this._els().scope;
    if (e) e.textContent = t || '';
  },

  setStage(label, startPct, endPct, { indeterminate = false } = {}) {
    this._mode = indeterminate ? 'indeterminate' : 'stage';
    this._stageStartPct = Math.max(0, Math.min(100, startPct || 0));
    this._stageEndPct = Math.max(this._stageStartPct, Math.min(100, endPct || 0));
    this._stageStartedAt = Date.now();
    const stage = this._stageStartPct < 25 ? 1 : (this._stageStartPct < 72 ? 2 : (this._stageStartPct < 94 ? 3 : 4));
    this._setVisualStage(stage);
    if (label) this.setLabel(label);
    this._setPercent(this._stageStartPct);
    if (indeterminate) this._setIndeterminate();
    this._startTicker();
  },

  startAutoEstimate(seconds) {
    this._setVisualStage(1);
    this._estimatedMs = Math.max(Number(seconds) || 1, 1) * 1000;
    this._totalSteps = 0;
    this._mode = 'estimate';
    this._stageStartPct = 0;
    this._stageEndPct = 92;
    this._stageStartedAt = this._startTime;
    this._startTicker();
  },

  startStepEstimate(total) {
    this._setVisualStage(2);
    if (this._interval) clearInterval(this._interval);
    this._totalSteps = Math.max(Number(total) || 1, 1);
    this._stepDone = 0;
    this._stepStartTime = Date.now();
    this._mode = 'steps';
    this._setPercent(0, true);
    this._startTicker();
  },

  reportStepComplete(done) {
    if (typeof isCancellationRequested !== 'undefined' && isCancellationRequested) return;
    if (Number(done) >= this._totalSteps) this._setVisualStage(3);
    this._stepDone = Math.max(0, Math.min(this._totalSteps, Number(done) || 0));
    this._setPercent((this._stepDone / this._totalSteps) * 100);
    const remain = this._totalSteps - this._stepDone;
    const now = Date.now(),
      elapsed = now - this._startTime;
    const e = this._els().time;
    if (e) {
      e.textContent = remain ?
        `Elapsed ${this._formatTime(elapsed)} • ~${this._formatTime(((now - this._stepStartTime) / Math.max(this._stepDone, 1)) * remain)} remaining` :
        `Elapsed ${this._formatTime(elapsed)} • Finishing…`;
    }
  },

  finish() {
    if (this._interval) { clearInterval(this._interval);
      this._interval = null; }
    this._setVisualStage(4);
    this._mode = 'done';
    this._lastPct = 100;
    const e = this._els();
    if (e.fill) {
      e.fill.classList.remove('indeterminate');
      e.fill.style.width = '100%';
    }
    if (e.ringFill) {
      e.ringFill.classList.remove('indeterminate');
      e.ringFill.style.strokeDasharray = this._RING_CIRC;
      e.ringFill.style.strokeDashoffset = 0;
    }
    if (e.ringIcon) {
      e.ringIcon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (e.time) e.time.textContent = `Done • ${this._elapsed()}`;
    this._updatePageCountDisplay();
    this._stopQuoteRotation(); // শেষে বাড়তি AI কল নয়; যে উক্তিটা চলছিল সেটাই থাকে
  },

  setActiveModel(name) {
    const e = this._els().badge;
    if (e) e.textContent = name ? '🤖 ' + name : '';
  },

  setPageCount(current, total) {
    this._pageCount = Math.max(0, Number(current) || 0);
    this._totalPages = Math.max(0, Number(total) || 0);
    this._updatePageCountDisplay();
  },

  incrementPage() {
    if (this._totalPages > 0 && this._pageCount < this._totalPages) {
      this._pageCount++;
      this._updatePageCountDisplay();
      const label = this._els().previewPageLabel;
      if (label) {
        label.textContent = `পৃষ্ঠা ${this._pageCount} এর ${this._totalPages}`;
      }
    }
  },

  // ===== FILE PROGRESS (for OCR) =====
  addFileProgress(key, fileName, phase = 'Queued', meta = '') {
    if (!this._previewContainer) return null;
    const existing = this._fileProgressItems.get(key);
    if (existing) return existing;

    const div = document.createElement('div');
    div.className = 'progress-file-item';
    div.dataset.progressFileKey = String(key);
    div.innerHTML = `
      <div class="progress-file-head">
        <span class="progress-file-name"></span>
        <span class="progress-file-status">Queued</span>
      </div>
      <div class="progress-file-meta"></div>
      <div class="progress-file-track"><div class="progress-file-fill"></div></div>
    `;
    div.querySelector('.progress-file-name').textContent = fileName || 'File';
    div.querySelector('.progress-file-status').textContent = phase || 'Queued';
    div.querySelector('.progress-file-meta').textContent = meta || '';

    this._previewContainer.appendChild(div);
    this._fileProgressItems.set(key, div);
    this._previewContainer.scrollTop = this._previewContainer.scrollHeight;
    const wrap = this._els().previewWrap;
    if (wrap) wrap.classList.add('has-items');
    return div;
  },

  updateFileProgress(key, pct, phase, meta = '', state = 'working') {
    const div = this._fileProgressItems.get(key);
    if (!div) return;
    pct = Math.max(0, Math.min(100, Number(pct) || 0));

    const fill = div.querySelector('.progress-file-fill');
    const status = div.querySelector('.progress-file-status');
    const metaEl = div.querySelector('.progress-file-meta');

    if (fill) fill.style.width = pct + '%';
    if (status) {
      status.className = 'progress-file-status' +
        (state === 'done' ? ' done' : state === 'error' ? ' error' : state === 'fallback' ? ' fallback' : '');
      status.textContent = phase || (state === 'done' ? 'Done' : state === 'error' ? 'Error' : 'Working');
    }
    if (metaEl) metaEl.textContent = (meta || '') + (meta ? ' • ' : '') + Math.round(pct) + '%';
  },

  addPagePreview(label, content, status) {
    // আর ব্যবহার হচ্ছে না — শুধু পেজ নম্বর দেখানো হয়
  },

  clearPreview() {
    if (this._previewContainer) this._previewContainer.innerHTML = '';
    this._fileProgressItems.clear();
    const wrap = this._els().previewWrap;
    if (wrap) wrap.classList.remove('has-items');
  },

  hide() {
    if (this._interval) { clearInterval(this._interval);
      this._interval = null; }
    this._stopQuoteRotation();
    const e = this._els();
    e.overlay.style.display = 'none';
    if (e.badge) e.badge.textContent = '';
    if (e.scope) e.scope.textContent = '';
    if (e.fill) { e.fill.classList.remove('indeterminate'); e.fill.style.width = ''; }
    if (e.ringFill) e.ringFill.classList.remove('indeterminate');
    if (e.ringIcon) e.ringIcon.innerHTML = '';
    if (e.previewWrap) e.previewWrap.classList.remove('has-items');
    this._pageCount = 0;
    this._totalPages = 0;
    this._updatePageCountDisplay();
  }
};

// ===== THEME MANAGEMENT =====
function applyCurrentTheme() {
  const icon = document.getElementById('theme-toggle-icon');
  const themeState = (window.APP_STATE && APP_STATE.theme) || 'light';
  const finalDark = themeState === 'dark';
  document.body.classList.toggle('dark', finalDark);
  document.documentElement.classList.toggle('dark', finalDark);
  if (typeof syncActiveModelVisualTheme === 'function') syncActiveModelVisualTheme();
  if (icon) {
    icon.innerHTML = finalDark ?
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' :
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  }
}

function toggleDarkMode() {
  if (typeof APP_STATE === 'undefined') {
    window.APP_STATE = window.APP_STATE || { theme: 'light' };
  }
  APP_STATE.theme = APP_STATE.theme === 'light' ? 'dark' : 'light';
  document.body.classList.toggle('dark', APP_STATE.theme === 'dark');
  document.documentElement.classList.toggle('dark', APP_STATE.theme === 'dark');
  applyCurrentTheme();
  if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
    TAB_MANAGER._persist();
  }
  if (typeof invalidatePDFPreviewCache === 'function') {
    invalidatePDFPreviewCache();
    const pdfView = document.getElementById('pdf-view-container');
    if (pdfView && pdfView.style.display !== 'none' && typeof generateLivePDFIframePreview === 'function') {
      generateLivePDFIframePreview();
    }
  }
}

// ===== MODE BUTTON =====
function updateModeButtonText() {
  const btn = document.getElementById('mode-toggle-btn');
  if (!btn) return;
  const isMono = document.body.classList.contains('photocopy-mode');
  const icon = document.getElementById('mode-toggle-icon');
  const label = document.getElementById('mode-toggle-label');

  if (icon) {
    icon.innerHTML = isMono ?
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' :
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/><path d="M8.5 14.5c2 1.8 5 1.8 7 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  }
  // Shows the mode a click will switch TO (not the current one).
  if (label) label.textContent = isMono ? 'Color' : 'Monochrome';
  btn.setAttribute('aria-pressed', isMono ? 'true' : 'false');
  btn.title = isMono ? 'Switch to Color mode' : 'Switch to Monochrome mode';
}

function togglePhotocopyMode() {
  const isNowMonochrome = !document.body.classList.contains('photocopy-mode');
  document.body.classList.toggle('photocopy-mode', isNowMonochrome);

  updateModeButtonText();
  if (typeof applyMonochromeDocumentStyles === 'function') applyMonochromeDocumentStyles();

  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
    TAB_MANAGER._persist();
  }
  if (typeof invalidatePDFPreviewCache === 'function') {
    invalidatePDFPreviewCache();
    const pdfView = document.getElementById('pdf-view-container');
    if (pdfView && pdfView.style.display !== 'none' && typeof generateLivePDFIframePreview === 'function') {
      generateLivePDFIframePreview();
    }
  }
  displayToastNotification(isNowMonochrome ? 'Monochrome Mode Enabled' : 'Color Mode Enabled');
}

// ===== TEXTAREA AUTO-RESIZE =====
function autoResizeTextarea(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

// ===== DESKTOP WORKSPACE FIT =====
// This used to shrink the ENTIRE page with `document.body.style.zoom`
// whenever the window was narrower than a hardcoded 1180px — the same
// visual effect as the person hitting Ctrl/Cmd+"-" in their browser. That's
// a scaling hack, not a responsive layout: it blurs text, throws off click
// coordinates in some browsers, and still looks like a full desktop layout
// that's been shrunk to fit rather than a screen that was actually designed
// for its size — which is exactly the "forced to fit" feeling this was
// meant to solve, not fix.
//
// The desktop CSS (#sidebar, #preview-panel, #editor-toolbar, etc.) is now
// genuinely fluid down to the same <=850px breakpoint the mobile layout
// takes over at, so no artificial minimum width — and no zoom — is needed
// at any real desktop window size. This function is kept only so any
// leftover zoom from an old session/tab gets cleared once, and so existing
// calls to window.applyDesktopWorkspaceZoom() elsewhere don't break.
function applyDesktopWorkspaceZoom() {
  document.body.style.zoom = '';
}

if (typeof window !== 'undefined') {
  const runWorkspaceZoom = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyDesktopWorkspaceZoom);
    } else {
      applyDesktopWorkspaceZoom();
    }
  };

  runWorkspaceZoom();
  window.addEventListener('resize', () => {
    window.setTimeout(applyDesktopWorkspaceZoom, 80);
  });
  window.applyDesktopWorkspaceZoom = applyDesktopWorkspaceZoom;
}

// ===== SIDEBAR RESIZE =====
function initializeSidebarResize(event) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const startX = event.clientX;
  const startWidth = sidebar.offsetWidth;

  function onMouseMove(ev) {
    const newWidth = startWidth + (ev.clientX - startX);
    if (newWidth >= 300 && newWidth <= 550) sidebar.style.width = newWidth + 'px';
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// ===== MOBILE / DESKTOP TOPBAR MORE MENU =====
let __topbarMenuOpen = false;

function setTopbarMenuOpen(open) {
  const menu = document.getElementById('topbar-actions');
  const btn = document.getElementById('topbar-more-btn');
  if (!menu || !btn) return;
  __topbarMenuOpen = !!open;
  menu.classList.toggle('open', __topbarMenuOpen);
  btn.classList.toggle('active', __topbarMenuOpen);
  btn.setAttribute('aria-expanded', __topbarMenuOpen ? 'true' : 'false');
  menu.setAttribute('aria-hidden', __topbarMenuOpen ? 'false' : 'true');
  if (isMobileDeviceLayout()) document.body.classList.toggle('topbar-menu-open', __topbarMenuOpen);
}

function toggleTopbarMenu(forceClose) {
  if (forceClose === true) { setTopbarMenuOpen(false); return; }
  setTopbarMenuOpen(!__topbarMenuOpen);
}

function closeTopbarMenu() { setTopbarMenuOpen(false); }

// ===== MOBILE READING VIEW (reflow, not scale) =====
// On phones the A4 canvas is scaled to ~0.48x, making 12pt text unreadable.
// Reading mode reflows the document into a full-width, readable layout.
let _mobileReadingActive = false;

function _extractReadingHTML() {
  const pages = Array.from(document.querySelectorAll('#document-view-container .doc-page-canvas'));
  if (!pages.length) return '';
  const parts = [];
  pages.forEach(page => {
    const clone = page.cloneNode(true);
    // Strip page footers and any export-measure helper classes
    clone.querySelectorAll('.page-footer-number, .pdf-export-measure-page').forEach(f => f.remove());
    // Take the inner HTML (children) so the A4-canvas wrapper styles don't leak in
    const inner = (clone.innerHTML || '').trim();
    if (inner) parts.push(inner);
  });
  return parts.join('\n');
}

function _syncReadingPanel() {
  const panel = document.getElementById('mobile-reading-content');
  if (!panel) return;
  const html = _extractReadingHTML();
  panel.innerHTML = html || '<p style="color:var(--text-secondary);text-align:center;margin-top:40px;">No content yet. Ask AI on the left to generate notes.</p>';
}

function toggleMobileReadingView() {
  const isMobile = typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout();
  if (!isMobile) {
    // On desktop, just toggle the preview panel visibility (no-op)
    return;
  }
  _mobileReadingActive = !_mobileReadingActive;
  const docContainer = document.getElementById('document-view-container');
  const readingPanel = document.getElementById('mobile-reading-panel');
  const toggleBtn = document.getElementById('mobile-reading-toggle');
  const previewArea = document.getElementById('preview-content-area');

  if (_mobileReadingActive) {
    if (docContainer) docContainer.style.display = 'none';
    if (readingPanel) { readingPanel.style.display = 'flex'; _syncReadingPanel(); }
    if (toggleBtn) toggleBtn.classList.add('active');
    if (previewArea) { previewArea.style.flexDirection = 'column'; previewArea.style.overflow = 'hidden'; }
    displayToastNotification('📖 Reading mode — full-width reflow');
  } else {
    if (docContainer) docContainer.style.display = '';
    if (readingPanel) readingPanel.style.display = 'none';
    if (toggleBtn) toggleBtn.classList.remove('active');
    if (previewArea) { previewArea.style.flexDirection = ''; previewArea.style.overflow = ''; }
    displayToastNotification('Editor view restored');
  }
}

function isMobileReadingActive() { return _mobileReadingActive; }

// Auto-show reading toggle only on mobile + editor view
function _maybeShowReadingToggle() {
  const toggleBtn = document.getElementById('mobile-reading-toggle');
  if (!toggleBtn) return;
  const isMobile = typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout();
  const isEditorView = (document.getElementById('main-container') || {}).className && document.getElementById('main-container').className.includes('mobile-view-editor');
  toggleBtn.style.display = (isMobile && isEditorView) ? 'flex' : 'none';
  if (!_mobileReadingActive) return;
  // If we switched away from editor view while reading, exit reading mode
  if (!isEditorView && _mobileReadingActive) { toggleMobileReadingView(); }
}

function bindTopbarMoreMenu() {
  const btn = document.getElementById('topbar-more-btn');
  const menu = document.getElementById('topbar-actions');
  if (!btn || !menu || btn.dataset.moreMenuBound === '1') return;
  btn.dataset.moreMenuBound = '1';
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-hidden', 'true');

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTopbarMenu();
  }, false);

  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault();
      toggleTopbarMenu(); } else if (e.key === 'Escape') closeTopbarMenu();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!__topbarMenuOpen) return;
    const target = e.target;
    if (target && (btn.contains(target) || menu.contains(target))) return;
    closeTopbarMenu();
  }, false);

  document.addEventListener('click', (e) => {
    if (!__topbarMenuOpen) return;
    const target = e.target;
    if (target && (btn.contains(target) || menu.contains(target))) return;
    closeTopbarMenu();
  }, false);

  window.addEventListener('resize', () => {
    if (!isMobileDeviceLayout()) closeTopbarMenu();
  }, { passive: true });
}

// ===== PAGE RANGE MODAL =====
let pageRangeResolve = null;

function promptForPageRange(totalPages) {
  return new Promise((resolve) => {
    const modal = document.getElementById('page-range-modal');
    if (!modal) {
      resolve(null);
      return;
    }
    const startInput = document.getElementById('range-start');
    const endInput = document.getElementById('range-end');
    const badge = document.getElementById('page-range-total-badge');
    if (startInput) startInput.value = 1;
    if (endInput) endInput.value = totalPages;
    if (badge) badge.textContent = `Total: ${totalPages} pages`;
    modal.dataset.totalPages = totalPages;
    modal.style.display = 'flex';
    pageRangeResolve = resolve;
  });
}

function closePageRangeModal() {
  const modal = document.getElementById('page-range-modal');
  if (!modal) return;
  modal.style.display = 'none';
  if (pageRangeResolve) {
    pageRangeResolve(null);
    pageRangeResolve = null;
  }
}

function confirmPageRange() {
  const modal = document.getElementById('page-range-modal');
  if (!modal) return;
  const start = parseInt(document.getElementById('range-start').value) || 1;
  const end = parseInt(document.getElementById('range-end').value) || 1;
  const total = parseInt(modal.dataset.totalPages) || 1;
  const validStart = Math.max(1, Math.min(start, total));
  const validEnd = Math.max(validStart, Math.min(end, total));
  modal.style.display = 'none';
  if (pageRangeResolve) {
    pageRangeResolve({ start: validStart, end: validEnd });
    pageRangeResolve = null;
  }
}

// ===== EDIT PAGE MODAL =====
let _editModalResolve = null;

function openEditPageModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('edit-page-modal');
    if (!modal) {
      resolve(null);
      return;
    }
    const input = document.getElementById('edit-page-input');
    const hint = document.getElementById('edit-page-hint');
    const chips = document.getElementById('edit-page-chips');
    
    const totalPages = document.querySelectorAll('.doc-page-canvas').length || 0;
    if (hint) hint.textContent = `Document has ${totalPages} page${totalPages !== 1 ? 's' : ''}`;
    
    if (input) input.value = '';
    if (chips) chips.innerHTML = '';
    
    if (input) {
      input.oninput = function() {
        const raw = this.value.trim();
        if (!chips) return;
        chips.innerHTML = '';
        if (!raw) return;
        const numbers = raw.split(/\s+/).filter(p => p.length > 0).map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);
        numbers.forEach(num => {
          const chip = document.createElement('span');
          chip.className = 'page-chip';
          chip.textContent = num;
          chips.appendChild(chip);
        });
      };
    }
    
    modal.style.display = 'flex';
    _editModalResolve = resolve;
    setTimeout(() => { if (input) input.focus(); }, 100);
  });
}

function closeEditPageModal() {
  const modal = document.getElementById('edit-page-modal');
  if (!modal) return;
  modal.style.display = 'none';
  if (_editModalResolve) {
    _editModalResolve(null);
    _editModalResolve = null;
  }
}

function confirmEditPages() {
  const input = document.getElementById('edit-page-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) {
    displayToastNotification('⚠️ Please enter at least one page number.');
    return;
  }
  const parts = raw.split(/\s+/).filter(p => p.length > 0);
  const numbers = parts.map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);
  if (numbers.length === 0) {
    displayToastNotification('⚠️ Invalid page numbers. Use numbers separated by spaces (e.g., 9 10 11).');
    return;
  }
  const modal = document.getElementById('edit-page-modal');
  if (modal) modal.style.display = 'none';
  if (_editModalResolve) {
    _editModalResolve(numbers);
    _editModalResolve = null;
  }
}

// ===== VIEW TOGGLES =====
let _desktopView = 'editor';

function switchPreviewTabDesktop(view) {
  _desktopView = view;
  const btnChat = document.getElementById('tab-chat-btn-desktop');
  const btnEditor = document.getElementById('tab-editor-btn-desktop');
  const btnPdf = document.getElementById('tab-pdf-btn-desktop');
  if (btnChat) btnChat.classList.toggle('active', view === 'chat');
  if (btnEditor) btnEditor.classList.toggle('active', view === 'editor');
  if (btnPdf) btnPdf.classList.toggle('active', view === 'pdf');
  if (typeof switchPreviewTab === 'function') switchPreviewTab(view);
}

function setMobileView(viewName) {
  // FIX: 'slides' was not a known view, and only chat/editor/pdf classes were
  // removed. After a slide deck / Slide Deck mode switched main-container to
  // "mobile-view-slides", tapping "AI Chat" ADDED mobile-view-chat but left
  // mobile-view-slides in place; the later CSS rule (slides hides #sidebar)
  // won, so the chat input disappeared and could not be brought back.
  const MOBILE_VIEWS = ['chat', 'editor', 'pdf', 'slides'];
  let safeView = MOBILE_VIEWS.includes(viewName) ? viewName : 'chat';
  const deck = (typeof APP_STATE !== 'undefined') ? APP_STATE.slideDeck : null;
  const hasDeck = !!(deck && Array.isArray(deck.slides) && deck.slides.length);
  if (safeView === 'editor' && hasDeck) safeView = 'slides';
  if (typeof APP_STATE !== 'undefined') APP_STATE.currentMobileView = safeView;
  const main = document.getElementById('main-container');
  if (!main) return;
  const applyClass = () => {
    MOBILE_VIEWS.forEach(v => main.classList.remove('mobile-view-' + v));
    main.classList.add('mobile-view-' + safeView);
    // Slides and the A4 editor share the "Editor" nav button.
    const navId = (safeView === 'slides') ? 'editor' : safeView;
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('mob-btn-' + navId);
    if (activeBtn) activeBtn.classList.add('active');
  };
  applyClass();

  const backBtn = document.getElementById('mobile-back-to-chat-btn');
  if (backBtn) backBtn.style.display = (safeView === 'chat') ? 'none' : 'inline-flex';

  if (safeView === 'pdf' || safeView === 'slides') {
    if (typeof switchPreviewTab === 'function') switchPreviewTab(safeView);
  } else if (safeView === 'editor') {
    if (typeof switchPreviewTab === 'function') switchPreviewTab('editor');
    requestAnimationFrame(() => {
      try { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); } catch (_) {}
      setTimeout(() => {
        try { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); } catch (_) {}
      }, 200);
    });
  }
  // switchPreviewTab rewrites the mobile-view-* class itself; re-assert ours
  // so exactly one view class is ever present.
  if (isMobileDeviceLayout()) applyClass();

  if (!isMobileDeviceLayout()) {
    if (safeView === 'pdf') switchPreviewTabDesktop('pdf');
    else if (safeView === 'editor' || safeView === 'slides') switchPreviewTabDesktop('editor');
  }
}

// ===== CANCELLATION =====
let isCancellationRequested = false;
let activeRequestAbortController = null;
let lastCancellationAt = 0;

function requestCancelProcessing() {
  if (isCancellationRequested) return;
  isCancellationRequested = true;
  lastCancellationAt = Date.now();
  try { if (activeRequestAbortController) activeRequestAbortController.abort(); } catch (e) {}
  try {
    if (typeof terminateOcrWorkersForCancellation === 'function') terminateOcrWorkersForCancellation();
  } catch (e) {}
  const cancelBtn = document.getElementById('cancel-processing-btn');
  if (cancelBtn) { cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling…'; }
  if (ProgressUI && typeof ProgressUI.hide === 'function') ProgressUI.hide();
  displayToastNotification('Cancelled — processing stopped immediately.');
}

function resetCancellationState() {
  isCancellationRequested = false;
  lastCancellationAt = 0;
  activeRequestAbortController = null;
  const cancelBtn = document.getElementById('cancel-processing-btn');
  if (cancelBtn) { cancelBtn.disabled = false;
    cancelBtn.textContent = 'Cancel'; }
}

async function waitWhilePaused() {
  // No-op - kept for compatibility
  return;
}

// ============================================================
// WINDOW EXPOSURE – UI Helpers
// ============================================================
window.ProgressUI = ProgressUI;
window.toggleDarkMode = toggleDarkMode;
window.applyCurrentTheme = applyCurrentTheme;
window.displayToastNotification = displayToastNotification;
window.autoResizeTextarea = autoResizeTextarea;
window.initializeSidebarResize = initializeSidebarResize;
window.openEditPageModal = openEditPageModal;
window.closeEditPageModal = closeEditPageModal;
window.confirmEditPages = confirmEditPages;
window.promptForPageRange = promptForPageRange;
window.closePageRangeModal = closePageRangeModal;
window.confirmPageRange = confirmPageRange;
window.switchPreviewTabDesktop = switchPreviewTabDesktop;
window.setMobileView = setMobileView;
window.requestCancelProcessing = requestCancelProcessing;
window.resetCancellationState = resetCancellationState;
window.waitWhilePaused = waitWhilePaused;
window.bindTopbarMoreMenu = bindTopbarMoreMenu;
window.toggleTopbarMenu = toggleTopbarMenu;
window.closeTopbarMenu = closeTopbarMenu;
window.togglePhotocopyMode = togglePhotocopyMode;
window.updateModeButtonText = updateModeButtonText;
window.toggleMobileReadingView = toggleMobileReadingView;
window.isMobileReadingActive = isMobileReadingActive;
window._maybeShowReadingToggle = _maybeShowReadingToggle;
window._syncReadingPanel = _syncReadingPanel;

window._syncMobileTabFab = _syncMobileTabFab;
window.openMobileTabSheet = openMobileTabSheet;
window.closeMobileTabSheet = closeMobileTabSheet;

// ===== MOBILE TAB SWITCHER SHEET =====
function openMobileTabSheet() {
  const sheet = document.getElementById('mobile-tab-sheet');
  const list = document.getElementById('mobile-tab-list');
  if (!sheet || !list) return;
  list.innerHTML = '';
  const tabs = (TAB_MANAGER && TAB_MANAGER.tabs) || [];
  const activeId = (TAB_MANAGER && TAB_MANAGER.activeId) || null;
  tabs.forEach(tab => {
    const row = document.createElement('button');
    row.type = 'button';
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; text-align:left; padding:11px 14px; border:1px solid var(--border-color); border-radius:var(--radius-sm); background:var(--surface-color); color:var(--text-primary); font:600 .88rem var(--font-ui); cursor:pointer; touch-action:manipulation;';
    if (tab.id === activeId) {
      row.style.background = 'var(--primary-light)';
      row.style.borderColor = 'var(--primary-color)';
    }
    const name = document.createElement('span');
    name.textContent = tab.name || 'Untitled';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    name.style.minWidth = '0';
    name.style.flex = '1';
    row.appendChild(name);
    if (tabs.length > 1) {
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '✕';
      close.style.cssText = 'width:26px; height:26px; border:none; background:transparent; color:var(--text-secondary); font-size:.9rem; cursor:pointer; border-radius:50%; flex-shrink:0;';
      close.title = 'Close tab';
      close.onclick = (e) => { e.stopPropagation(); TAB_MANAGER.deleteTab(tab.id); openMobileTabSheet(); };
      row.appendChild(close);
    }
    row.onclick = () => { closeMobileTabSheet(); TAB_MANAGER.switchTo(tab.id); };
    list.appendChild(row);
  });
  sheet.style.display = 'flex';
  sheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMobileTabSheet() {
  const sheet = document.getElementById('mobile-tab-sheet');
  if (sheet) { sheet.style.display = 'none'; sheet.classList.remove('open'); }
  document.body.style.overflow = '';
}

function _syncMobileTabFab() {
  const fab = document.getElementById('topbar-tabs-fab-btn');
  if (!fab) return;
  const isMobile = typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout();
  const hasMultipleTabs = (TAB_MANAGER && TAB_MANAGER.tabs && TAB_MANAGER.tabs.length > 1);
  fab.style.display = (isMobile && hasMultipleTabs) ? 'flex' : 'none';
  if (hasMultipleTabs) document.body.classList.add('has-multiple-tabs');
  else document.body.classList.remove('has-multiple-tabs');
}