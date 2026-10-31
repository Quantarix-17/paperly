// ========================================================================
// DOCUMENT EDITOR - History, Pagination, Page Management, and Core Editing
// ========================================================================

// ===== DOM REFS =====
const docContainer = document.getElementById('document-view-container');
const chatHistoryArea = document.getElementById('chat-history');

// ============================================================
// CARET / MOUSE-CURSOR THEME REPAINT FIX
// The native text (I-beam) pointer's black-vs-white rendering is drawn
// by the browser from the element's `color-scheme`, but Chromium only
// re-evaluates that on the *next* mousemove — so toggling light/dark
// left the pointer showing the old color for a moment until the mouse
// moved again, even though color-scheme had already updated. Forcing a
// synchronous `cursor` property flip on every open page repaints the
// pointer immediately instead of waiting on the user's mouse.
// ============================================================
function forceCursorRepaint() {
  if (!docContainer) return;
  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  pages.forEach(page => {
    const _prevCursor = page.style.cursor;
    page.style.cursor = 'default';
    // Reading layout here forces the browser to flush/paint the change
    // above before the line below runs, so the two writes can't get
    // batched into a single frame (which would skip the repaint).
    void page.offsetHeight;
    page.style.cursor = _prevCursor;
  });
}

const themeCursorRepaintObserver = new MutationObserver(forceCursorRepaint);
themeCursorRepaintObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
if (document.body) themeCursorRepaintObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });


// ===== PERSISTENT MEASURE ELEMENTS =====
const measurePage = document.createElement('div');
measurePage.className = 'doc-page-canvas pdf-export-measure-page';
measurePage.style.position = 'absolute';
measurePage.style.left = '-9999px';
measurePage.style.top = '0';
measurePage.style.width = EDITOR_A4_WIDTH + 'px';
measurePage.style.height = EDITOR_A4_HEIGHT + 'px';
measurePage.style.padding = `${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px`;
measurePage.style.boxSizing = 'border-box';
measurePage.style.overflow = 'hidden';
measurePage.style.visibility = 'hidden';
measurePage.style.pointerEvents = 'none';
if (document.body) document.body.appendChild(measurePage);

const pageSnapshot = document.createElement('div');
pageSnapshot.className = 'doc-page-canvas pdf-export-measure-page';
pageSnapshot.style.cssText = measurePage.style.cssText;
if (document.body) document.body.appendChild(pageSnapshot);

function syncSnapshotFromPage(pageEl) {
  pageSnapshot.innerHTML = '';
  const fragment = document.createDocumentFragment();
  Array.from(pageEl.childNodes).forEach(child => {
    if (!(child.classList && child.classList.contains('page-footer-number'))) {
      fragment.appendChild(child.cloneNode(true));
    }
  });
  pageSnapshot.appendChild(fragment);
}

// ============================================================
// PERFORMANCE LAYER (big documents)
// ------------------------------------------------------------
// 1. Pagination is sliced into ~12ms pieces with a yield between them, so the page never freezes.
// 2. The "does the next block still fit on this page?" measurement is incremental (the measuring
//    page is kept and only the new block is added) instead of re-cloning the whole page every time.
// 3. getAllCanvasHTML() is cached PER PAGE and only re-reads pages that really changed.
// 4. Typing re-flows only the page being edited (not every page of the document).
// 5. Off-screen pages are not laid out / painted (CSS content-visibility), so scrolling stays smooth.
// To switch a piece off: PERF.INCREMENTAL_MEASURE = false, or run  __setEditorVirtualRender(false).
// ============================================================
const PERF = {
  SLICE_MS: 12,              // max milliseconds of work before giving the browser a turn
  BIG_DOC_NODES: 60,         // slicing / per-node rendering starts above this many top-level blocks
  BIG_DOC_PAGES: 30,         // per-page post-processing starts above this many pages
  LOCAL_REFLOW_MIN_PAGES: 8, // typing re-flows only the edited page when the document is bigger than this
  RESYNC_EVERY: 12,          // rebuild the measuring page from the real page every N appended blocks
  INCREMENTAL_MEASURE: true
};

let _paginateRunId = 0; // a newer pagination run cancels an older one that is paused between slices

function _perfYield() {
  return new Promise(resolve => {
    try {
      if (typeof MessageChannel !== 'undefined') {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
        ch.port2.postMessage(0);
        return;
      }
    } catch (_) { /* fall through */ }
    setTimeout(resolve, 0);
  });
}

let _perfLastProgress = 0;
function _perfProgress(done, total) {
  if (total < 150) return;
  const now = performance.now();
  if (now - _perfLastProgress < 250) return;
  _perfLastProgress = now;
  try {
    if (typeof ProgressUI !== 'undefined' && ProgressUI.setLabel) {
      ProgressUI.setLabel(`Laying out pages… ${Math.min(99, Math.round((done / total) * 100))}%`);
    }
  } catch (_) { /* cosmetic only */ }
}

// ---- CSS: off-screen pages are skipped by layout & paint ----
(function injectPerfStyles() {
  if (document.getElementById('perf-boost-styles')) return;
  const st = document.createElement('style');
  st.id = 'perf-boost-styles';
  st.textContent = `
    html:not(.perf-no-cv) #document-view-container > .doc-page-canvas {
      content-visibility: auto;
      contain-intrinsic-size: ${EDITOR_A4_WIDTH}px ${EDITOR_A4_HEIGHT}px;
    }
    @media print {
      html:not(.perf-no-cv) #document-view-container > .doc-page-canvas { content-visibility: visible; }
    }`;
  document.head.appendChild(st);
})();
window.__setEditorVirtualRender = function(on) {
  document.documentElement.classList.toggle('perf-no-cv', !on);
};

// ---- Incremental "does it fit" measurer (shared by both pagination paths) ----
function _makeContentFits(snapEl, syncFn) {
  let snapPage = null;   // real page the mirror (snapEl) currently represents
  let snapCount = 0;     // number of real child nodes mirrored
  let pending = null;    // block clone kept at the end of the mirror after a successful fit
  let pendingBase = -1;  // child count of the real page before that block
  let sinceSync = 0;

  const fullSync = (page) => {
    syncFn(page);
    snapPage = page;
    snapCount = page.childNodes.length;
    pending = null;
    sinceSync = 0;
  };

  return function contentFits(pageElement, extraNode) {
    if (!PERF.INCREMENTAL_MEASURE) {
      syncFn(pageElement);
      if (extraNode) snapEl.appendChild(extraNode.cloneNode(true));
      void snapEl.offsetHeight;
      const ok = snapEl.scrollHeight <= EDITOR_A4_HEIGHT + 1;
      if (extraNode && snapEl.lastChild) snapEl.removeChild(snapEl.lastChild);
      return ok;
    }
    // A check on the page as it is (no extra block) is only used while a block is being split
    // across pages: measure it from scratch and forget the mirror.
    if (!extraNode) {
      syncFn(pageElement);
      snapPage = null; pending = null;
      void snapEl.offsetHeight;
      return snapEl.scrollHeight <= EDITOR_A4_HEIGHT + 1;
    }
    const n = pageElement.childNodes.length;
    if (snapPage === pageElement && pending && n === pendingBase + 1 && sinceSync < PERF.RESYNC_EVERY) {
      pending = null; snapCount = n; sinceSync++;            // the last block was really appended: mirror already has it
    } else if (snapPage === pageElement && pending && n === pendingBase) {
      try { snapEl.removeChild(pending); } catch (_) { fullSync(pageElement); }
      pending = null; snapCount = n;                          // that block was NOT appended: drop it from the mirror
    } else if (snapPage === pageElement && !pending && n === snapCount && sinceSync < PERF.RESYNC_EVERY) {
      /* mirror is still exact */
    } else {
      fullSync(pageElement);
    }
    const clone = extraNode.cloneNode(true);
    snapEl.appendChild(clone);
    void snapEl.offsetHeight;
    const ok = snapEl.scrollHeight <= EDITOR_A4_HEIGHT + 1;
    if (ok) { pending = clone; pendingBase = n; }
    else { snapEl.removeChild(clone); }
    return ok;
  };
}

// ---- Math pre-render, in slices for big documents ----
async function _perfPreRenderMath(tempSource, runId) {
  const hasProc = typeof processMathEquationsInContainer === 'function';
  const hasRender = typeof renderAllKatexVisuals === 'function';
  const kids = Array.from(tempSource.childNodes);
  if (kids.length <= PERF.BIG_DOC_NODES) {
    if (hasProc) processMathEquationsInContainer(tempSource);
    if (hasRender) renderAllKatexVisuals(tempSource);
    return true;
  }
  let t = performance.now();
  for (const el of kids) {
    if (el.nodeType !== 1) continue;
    if (hasProc) processMathEquationsInContainer(el);
    if (hasRender) renderAllKatexVisuals(el);
    if (performance.now() - t > PERF.SLICE_MS) {
      await _perfYield();
      if (runId !== _paginateRunId) return false;
      t = performance.now();
    }
  }
  return true;
}

// ---- Diagram fix-ups after pagination, page by page, in slices ----
async function _perfPostProcessPages(runId) {
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const hasEnforce = typeof enforceDiagramVisualStyles === 'function';
  const hasFit = typeof autoFitDiagramTextToNodes === 'function';
  if (pages.length <= PERF.BIG_DOC_PAGES) {
    if (hasEnforce) enforceDiagramVisualStyles(docContainer);
    if (hasFit) autoFitDiagramTextToNodes(docContainer);
    return true;
  }
  let t = performance.now();
  for (const page of pages) {
    if (!page.isConnected) continue;
    if (hasEnforce) enforceDiagramVisualStyles(page);
    if (hasFit) autoFitDiagramTextToNodes(page);
    if (performance.now() - t > PERF.SLICE_MS) {
      await _perfYield();
      if (runId !== _paginateRunId) return false;
      t = performance.now();
    }
  }
  return true;
}

// ---- Shared safety / DOM helpers ----
const _pageSnapCache = new WeakMap();
let _htmlSetToken = 0;     // a newer render (or typing) cancels older delayed retries
let _renderInFlight = 0;   // >0 while the editor is being rebuilt (it is briefly blank)

// Minimal inert sanitizer, used only when the app's sanitizeHTML() is not available.
function _basicSanitize(html) {
  const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html || ''), 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,link,meta,base,form').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(a => {
      const name = a.name.toLowerCase();
      const val = String(a.value).replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if (['href', 'src', 'xlink:href', 'action', 'formaction'].includes(name) &&
               /^(javascript:|vbscript:|data:text\/html)/.test(val)) el.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}
function _safeHTML(html) {
  return typeof sanitizeHTML === 'function' ? sanitizeHTML(html) : _basicSanitize(html);
}
function _prepareHTML(html) {
  const safe = _safeHTML(html);
  return typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(safe) : safe;
}
function _escHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _isPdfViewVisible() {
  const v = document.getElementById('pdf-view-container');
  return !!v && getComputedStyle(v).display !== 'none';
}
function _refreshPdfPreviewIfVisible() {
  if (_isPdfViewVisible() && typeof generateLivePDFIframePreview === 'function') generateLivePDFIframePreview();
}
function _pageIsActive(page) {
  const ae = document.activeElement;
  return !!(page && ae && (ae === page || page.contains(ae)));
}
// Lossless copy of one page (no emoji stripping, footer removed).
function _pageSnapshotHTML(page) {
  const clone = page.cloneNode(true);
  clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
  return clone.innerHTML;
}
// Font size of an SVG <text> in px. Attributes such as "1.1em" or "90%" must not be parsed as pixels.
function _svgFontPx(el) {
  let v = NaN;
  try { v = parseFloat(getComputedStyle(el).fontSize); } catch (_) { /* ignore */ }
  if (!(v > 0)) {
    const a = el.getAttribute('font-size') || '';
    v = /%|em|rem|ex/i.test(a) ? NaN : parseFloat(a);
  }
  return v > 0 ? v : 13;
}
let _emojiReCache = null;
function _getEmojiRe() {
  if (typeof EMOJI_RE === 'undefined' || !EMOJI_RE) return null;
  if (_emojiReCache && _emojiReCache.src === EMOJI_RE) return _emojiReCache.re;
  const re = EMOJI_RE.global ? EMOJI_RE : new RegExp(EMOJI_RE.source, EMOJI_RE.flags + 'g');
  _emojiReCache = { src: EMOJI_RE, re };
  return re;
}

// ---- Caret save/restore that survives a full rebuild of the pages ----
// (A marker element cannot: docContainer.innerHTML = '' destroys it.) The caret is stored as a
// character offset into the document text, ignoring footers and rendered math.
function _caretTextWalker(root) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('.page-footer-number, .katex, .katex-eq, script, style')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
}
function _saveCaretOffset() {
  if (!docContainer) return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!docContainer.contains(r.startContainer)) return null;
  const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  if (!el || el.closest('.page-footer-number, .katex, .katex-eq')) return null;
  const w = _caretTextWalker(docContainer);
  let count = 0, n;
  while ((n = w.nextNode())) {
    if (n === r.startContainer) return { offset: count + r.startOffset };
    if (r.comparePoint(n, 0) >= 0) break;
    count += n.nodeValue.length;
  }
  return { offset: count };
}
function _restoreCaretOffset(info) {
  if (!info || !docContainer) return;
  const w = _caretTextWalker(docContainer);
  let remaining = info.offset, n, last = null, target = null, off = 0;
  while ((n = w.nextNode())) {
    last = n;
    if (remaining <= n.nodeValue.length) { target = n; off = remaining; break; }
    remaining -= n.nodeValue.length;
  }
  if (!target && last) { target = last; off = last.nodeValue.length; }
  if (!target) return;
  const page = target.parentElement && target.parentElement.closest('.doc-page-canvas');
  if (page) { try { page.focus({ preventScroll: true }); } catch (_) { page.focus(); } }
  const range = document.createRange();
  range.setStart(target, off);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---- Per-page HTML cache for getAllCanvasHTML ----
const _pageHtmlCache = new WeakMap();
let _pageCacheObserver = null;

function _perfInvalidateFromRecords(records) {
  for (const r of records) {
    const t = r.target;
    if (!t || t === docContainer) continue;
    const el = t.nodeType === 1 ? t : t.parentElement;
    if (!el || !el.closest) continue;
    if (el.closest('.page-footer-number')) continue;   // footer numbers are never exported
    const page = el.closest('.doc-page-canvas');
    if (!page) continue;
    if (r.type === 'attributes' && el === page) continue; // the page's own style (zoom/transform) is not part of its innerHTML
    _pageHtmlCache.delete(page);
    _pageSnapCache.delete(page);
  }
}

if (docContainer && typeof MutationObserver === 'function') {
  _pageCacheObserver = new MutationObserver(_perfInvalidateFromRecords);
  _pageCacheObserver.observe(docContainer, { childList: true, subtree: true, characterData: true, attributes: true });
}

// ---- Dirty pages (typing) ----
const _dirtyPages = new Set();
function _takeDirtyPages() {
  const list = Array.from(_dirtyPages);
  _dirtyPages.clear();
  return list;
}

// ============================================================
// PAGE CONTENT VALIDATION (FIXED: ignores whitespace-only nodes
// and empty canvas elements that have no visible ink)
// ============================================================

// Check whether a <canvas> element actually has visible ink
// (not just that it exists in the DOM).  This prevents pages that
// contain empty / zero-ink canvases from being treated as content,
// which previously caused extra blank pages in the exported PDF.
let _inkScratch = null;
function _canvasHasInk(canvas) {
  try {
    if (!canvas.width || !canvas.height) return false;
    if (!_inkScratch) _inkScratch = document.createElement('canvas');
    // Look at the WHOLE canvas (scaled down), not just its top-left corner.
    const W = Math.min(canvas.width, 320);
    const H = Math.max(1, Math.min(480, Math.round(canvas.height * (W / canvas.width))));
    _inkScratch.width = W;   // also clears the bitmap and any taint from a previous canvas
    _inkScratch.height = H;
    const ctx = _inkScratch.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(canvas, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
      if (lum < 235 && ++ink >= 3) return true;
    }
    return false;
  } catch (_) {
    // Unreadable (tainted / unsupported) canvas: assume it has content rather than delete the page.
    return true;
  }
}

function _elementHasVisualContent(el) {
  if (!el) return false;
  if (el.querySelector('img,svg,table,.katex-eq,.fc-wrapper,.figure-pro,.block-solution,.quiz-container')) return true;
  const canvases = el.querySelectorAll('canvas');
  for (const canvas of canvases) {
    if (_canvasHasInk(canvas)) return true;
  }
  return false;
}

const DEFAULT_COVER_LINES = [
  'Created by Tamim Hossen Emon',
  'Department of Statistics and Data Science',
  'Session:2025-2026',
  'Islamic University,Kushtia'
];
// Override with APP_CONFIG.BLANK_COVER_LINES (array of strings) to change or empty the placeholder.
function _getCoverLines() {
  try {
    if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG && Array.isArray(APP_CONFIG.BLANK_COVER_LINES)) return APP_CONFIG.BLANK_COVER_LINES;
  } catch (_) { /* use default */ }
  return DEFAULT_COVER_LINES;
}
const _squashText = (str) => String(str || '').replace(/[\s\u00a0]+/g, '').toLowerCase();

function pageHasContent(page) {
  if (!page) return false;
  // An intentionally blank page (see getCanvasSnapshotHTML) counts as content.
  if (page.querySelector('.blank-page-spacer')) return true;
  // Read the text straight from the live page (no clone). The page-number footer is skipped.
  let rawText = '';
  for (const child of page.childNodes) {
    if (child.nodeType === 1 && child.classList && child.classList.contains('page-footer-number')) continue;
    rawText += child.textContent || '';
    rawText += ' ';
  }
  const text = rawText.replace(/[\s\u00a0]+/g, ' ').trim();

  // Placeholder-only = the text is NOTHING but placeholder phrases. Real content that merely
  // mentions a phrase ("see page 10", "start typing here ...") is never treated as empty.
  const placeholders = [
    'start typing here',
    'or ask ai on the left to generate notes',
    'ask ai to create...',
    _getCoverLines().join(' ')
  ].map(_squashText).filter(Boolean);
  let rest = _squashText(text);
  placeholders.forEach(p => { rest = rest.split(p).join(''); });
  rest = rest.replace(/[.\u2026]+/g, '');
  const isPlaceholderOnly = rest === '' || rest === 'page1' || rest === 'page1of1';

  const hasVisual = !!page.querySelector('img, svg, table, .katex-eq, .fc-wrapper, .figure-pro, .block-solution, .quiz-container');

  let hasCanvasInk = false;
  const canvases = page.querySelectorAll('canvas');
  for (const canvas of canvases) {
    if (_canvasHasInk(canvas)) { hasCanvasInk = true; break; }
  }

  const hasMeaningfulText = text.length >= 1 && !isPlaceholderOnly;
  return hasMeaningfulText || hasVisual || hasCanvasInk;
}

// ===== BLANK-DOCUMENT COVER-PAGE PLACEHOLDER =====
// A brand-new document keeps one visible page; this fills that lone, empty page with a cover
// placeholder (screen-only, never counted as content by pageHasContent).
function _fillBlankSolePageWithCoverPlaceholder() {
  if (!docContainer) return;
  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  if (pages.length !== 1) return;
  const page = pages[0];
  if (pageHasContent(page)) return;
  const lines = _getCoverLines();
  if (!lines.length) return;
  const paras = lines.map((l, i) =>
    `<p style="font-size:${i === 0 ? 14 : 13}pt;margin:${i === lines.length - 1 ? '0' : '0 0 10px'};">${_escHtml(l)}</p>`).join('');
  page.innerHTML = `
    <div data-blank-cover="1" style="min-height:900px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:'Times New Roman',Georgia,serif;color:#111827;">${paras}</div>`;
}

function _removeEmptyEditorPages() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (!pages.length) return;

  // Never strip every page down to zero: a lone empty page stays on screen.
  const allEmpty = pages.every(page => !pageHasContent(page));
  const empties = pages.filter(page => !pageHasContent(page) && !_pageIsActive(page));
  const removable = allEmpty ? empties.filter(p => p !== pages[0]) : empties;
  removable.forEach(page => page.parentNode && page.parentNode.removeChild(page));

  if (typeof updatePageFooters === 'function') updatePageFooters();
}

// Removes only the empty pages at the END of the document (never a blank page in the middle,
// never the page being edited, and never the first page, so the editor can't end up page-less).
function _removeTrailingEmptyPages() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length <= 1) return;

  let removedCount = 0;
  for (let i = pages.length - 1; i > 0; i--) {
    const page = pages[i];
    if (pageHasContent(page) || _pageIsActive(page)) break;
    page.remove();
    removedCount++;
  }

  if (removedCount > 0) {
    updatePageFooters();
    if (typeof displayToastNotification === 'function') {
      displayToastNotification(`🧹 Removed ${removedCount} empty page(s)`);
    }
  }
}

// ===== HISTORY (Undo/Redo) =====
const HISTORY = {
  undoStack: [],
  redoStack: [],
  maxSize: 30,

  saveState() {
    // Lossless snapshot: undo/autosave must not strip emoji or drop blank pages.
    const currentHTML = getCanvasSnapshotHTML();
    // While the editor is being rebuilt it is briefly empty; never record that as a state.
    if (!currentHTML && _renderInFlight > 0 && this.undoStack.length > 0) return;
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === currentHTML) return;
    this.undoStack.push(currentHTML);
    // Every undo step is a full copy of the document. For big documents keep fewer steps.
    const _limit = currentHTML.length > 3000000 ? 3 : currentHTML.length > 800000 ? 8 : this.maxSize;
    while (this.undoStack.length > _limit) this.undoStack.shift();
    this.redoStack = [];
    if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._persist(currentHTML);
    }
  },

  // Edits typed in the last 1.2 s are not in the stack yet; record them so undo doesn't lose them.
  _flushPendingSave() {
    if (_autoSavePending) {
      clearTimeout(autoSaveTimer);
      _autoSavePending = false;
      this.saveState();
    }
  },

  async undo() {
    this._flushPendingSave();
    if (this.undoStack.length <= 1) {
      if (typeof displayToastNotification === 'function') displayToastNotification("ℹ Nothing to undo.");
      return;
    }
    const currentState = this.undoStack.pop();
    this.redoStack.push(currentState);
    const previousState = this.undoStack[this.undoStack.length - 1];
    await setDocumentHTMLAndPaginate(previousState, false);
    if (typeof displayToastNotification === 'function') displayToastNotification("↶ Undone");
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._persist(); // runs only after the DOM really shows the restored state
    }
  },

  async redo() {
    if (this.redoStack.length === 0) {
      if (typeof displayToastNotification === 'function') displayToastNotification("ℹ Nothing to redo.");
      return;
    }
    const nextState = this.redoStack.pop();
    this.undoStack.push(nextState);
    await setDocumentHTMLAndPaginate(nextState, false);
    if (typeof displayToastNotification === 'function') displayToastNotification("↷ Redone");
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._persist();
    }
  }
};

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const tag = ae ? ae.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // Don't hijack undo in other editable areas (chat box, titles ...).
  if (ae && ae.isContentEditable && !(docContainer && docContainer.contains(ae))) return;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = (e.key || '').toLowerCase();   // works with CapsLock / Shift
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    HISTORY.undo();
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault();
    HISTORY.redo();
  }
});

// ===== CANVAS HTML HELPERS =====
function getAllCanvasHTML() {
  if (!docContainer) return '';
  // Apply any DOM changes that happened since the last call, so a stale page is never returned.
  if (_pageCacheObserver) _perfInvalidateFromRecords(_pageCacheObserver.takeRecords());
  const parts = [];
  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  for (const page of pages) {
    // Word export and the Image-PDF path both build their output from this string, so the blank-document
    // cover placeholder has to be filtered out here too (pageHasContent treats it as "no content").
    if (typeof pageHasContent === 'function' && !pageHasContent(page)) continue;
    let entry = _pageHtmlCache.get(page);
    if (!entry) {
      const clone = page.cloneNode(true);
      clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
      if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(clone);
      entry = { html: clone.innerHTML };
      _pageHtmlCache.set(page, entry);
    }
    parts.push(entry.html);
  }
  return parts.join('');
}

// Lossless snapshot of the document for undo / autosave / re-pagination. Unlike getAllCanvasHTML()
// (which is the EXPORT view: emoji stripped, empty pages skipped) this keeps the user's text exactly
// and keeps blank pages that sit between content pages (as a page-break sandwich).
function getCanvasSnapshotHTML() {
  if (!docContainer) return '';
  if (_pageCacheObserver) _perfInvalidateFromRecords(_pageCacheObserver.takeRecords());
  const entries = [];
  docContainer.querySelectorAll('.doc-page-canvas').forEach(page => {
    const has = pageHasContent(page);
    let html = '';
    if (has) {
      let e = _pageSnapCache.get(page);
      if (!e) { e = { html: _pageSnapshotHTML(page) }; _pageSnapCache.set(page, e); }
      html = e.html;
    }
    entries.push({ has, html });
  });
  const first = entries.findIndex(e => e.has);
  if (first < 0) return '';
  let last = first;
  entries.forEach((e, i) => { if (e.has) last = i; });
  const BR = '<div class="manual-page-break"></div>';
  const SPACER = '<p class="blank-page-spacer">&nbsp;</p>';
  return entries.map((e, i) => {
    if (!e.has) return (i > first && i < last) ? BR + SPACER + BR : '';
    // A page that is ONLY a blank-page spacer must keep its own page when the text is re-paginated.
    if (e.html.replace(/<p class="blank-page-spacer">(?:&nbsp;|\u00a0)<\/p>/g, '').trim() === '') return BR + e.html + BR;
    return e.html;
  }).join('');
}
window.getCanvasSnapshotHTML = getCanvasSnapshotHTML;

// ---- Leading-pages HTML (for the tab title only) ----
// _getTabNameFromHtml() only ever reads the first 60 KB of the document, so building the HTML of
// every page (hundreds of cloneNode calls on freshly built, uncached pages) just to read a title
// was wasted work. This returns the same text getAllCanvasHTML() would start with (same pages
// skipped, same footer/emoji clean-up), but stops once enough has been collected.
function _getLeadingCanvasHTML(limitChars = 60000) {
  if (!docContainer) return '';
  const parts = [];
  let len = 0;
  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  for (const page of pages) {
    if (typeof pageHasContent === 'function' && !pageHasContent(page)) continue;
    const cached = _pageHtmlCache.get(page);
    let html;
    if (cached) {
      html = cached.html;
    } else {
      const clone = page.cloneNode(true);
      clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
      if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(clone);
      html = clone.innerHTML;
    }
    parts.push(html);
    len += html.length;
    if (len >= limitChars) break;
  }
  return parts.join('');
}

// ===== SET DOCUMENT HTML WITH PAGINATION (FIXED: removes empty trailing pages) =====
let autoSaveTimer = null;
let _autoSavePending = false; // true while the 1.2 s autosave below is still going to run
let paginationDebounceTimer = null;

function debouncedAutoSaveAndPaginate() {
  clearTimeout(autoSaveTimer);
  _autoSavePending = true;
  autoSaveTimer = setTimeout(() => { _autoSavePending = false; HISTORY.saveState(); }, 1200);
  scheduleReflow();
}

function scheduleReflow() {
  clearTimeout(paginationDebounceTimer);
  paginationDebounceTimer = setTimeout(() => {
    reflowDocument(_takeDirtyPages());
  }, 300);
}

let _caretMarkerSeq = 0;
// Marker-based caret save/restore: only for operations that MOVE existing nodes (reflow).
// Full rebuilds use _saveCaretOffset/_restoreCaretOffset instead.
function saveCaretPosition() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const c = range.startContainer;
  const el = c.nodeType === 3 ? c.parentElement : c;
  const activePage = el && el.closest ? el.closest('.doc-page-canvas') : null;
  if (!activePage) return null;
  const markerId = 'caret-marker-' + Date.now() + '-' + (++_caretMarkerSeq);
  const marker = document.createElement('span');
  marker.id = markerId;
  marker.style.display = 'none';
  const r = range.cloneRange();
  r.collapse(true);
  r.insertNode(marker);
  return markerId;
}

function restoreCaretPosition(markerId) {
  if (!markerId) return;
  const marker = document.getElementById(markerId);
  if (!marker) return;
  const parent = marker.parentNode;
  const page = marker.closest('.doc-page-canvas');
  if (page) { try { page.focus({ preventScroll: true }); } catch (_) { page.focus(); } }
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStartBefore(marker);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  parent.removeChild(marker);
  if (parent.normalize) parent.normalize();   // re-join the text nodes the marker split
}

function _isWholeBlockNodeForPagination(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node.tagName || '').toUpperCase();
  return ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV', 'TABLE', 'UL', 'OL', 'FIGURE'].includes(tag);
}

function flattenContentTopLevelNodes(tempSource) {
  _mergeSplitBlocks(tempSource);   // join paragraph pieces split by an earlier pagination
  const topLevelNodes = [];
  const inlineWrapperTags = new Set(['SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'A', 'SMALL', 'SUB', 'SUP', 'CODE']);
  const blockOnlyTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'CODE', 'DIV']);

  Array.from(tempSource.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) return;

    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'DIV' &&
      !node.className.includes('block-') &&
      !node.className.includes('fc-') &&
      !node.className.includes('toc-') &&
      !node.className.includes('manual-page-break')) {

      const childNodes = Array.from(node.childNodes).filter(child => {
        if (child.nodeType === Node.TEXT_NODE) return child.textContent.trim().length > 0;
        if (child.nodeType === Node.ELEMENT_NODE) return true;
        return false;
      });

      const childEls = childNodes.filter(child => child.nodeType === Node.ELEMENT_NODE);
      const onlyInlineChildren = childEls.length > 0 && childEls.every(child => inlineWrapperTags.has(child.tagName));
      const hasBlockChild = childEls.some(child => blockOnlyTags.has(child.tagName));

      // Keep the wrapper as a single top-level node when the DIV only carries
      // inline or text-like wrappers; do not unfold it into many fragments.
      // This is the class of structure that previously created the one-line-per-page
      // oversplit appearance in the PDF chunk stream.
      if (onlyInlineChildren || !hasBlockChild) {
        topLevelNodes.push(node);
        return;
      }

      // Only expand real block DIVs into their children if the children are an
      // actual block structure; otherwise keep wrapper cohesion stable.
      childNodes.forEach(child => topLevelNodes.push(child));
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE && inlineWrapperTags.has(node.tagName)) {
      topLevelNodes.push(node);
      return;
    }

    topLevelNodes.push(node);
  });
  return topLevelNodes;
}

async function setDocumentHTMLAndPaginate(rawHtml, triggerSave = true) {
  if (!docContainer) return;
  // If pagination throws midway the editor would stay blank (it was cleared first). Catch it, show
  // the content in an unpaginated page, and retry once. The retry is cancelled when anything newer
  // was rendered or typed in the meantime (otherwise it would overwrite the newer content).
  const token = ++_htmlSetToken;
  _renderInFlight++;
  try {
    await _paginateDocumentHTMLCore(rawHtml, triggerSave);
  } catch (err) {
    console.error('[setDocumentHTMLAndPaginate] pagination failed, showing plain fallback:', err);
    _renderDocumentHTMLPlainFallback(rawHtml, triggerSave);
    setTimeout(async () => {
      if (token !== _htmlSetToken) return;
      _renderInFlight++;
      try {
        await _paginateDocumentHTMLCore(rawHtml, triggerSave);
      } catch (retryErr) {
        console.error('[setDocumentHTMLAndPaginate] retry also failed, keeping plain fallback:', retryErr);
        if (typeof displayToastNotification === 'function') {
          displayToastNotification('⚠️ Page formatting had an issue. Your content is still shown below — refresh if it looks off.');
        }
      } finally {
        _renderInFlight--;
      }
    }, 400);
  } finally {
    _renderInFlight--;
  }
}

// ===== PLAIN (UNPAGINATED) FALLBACK RENDER =====
// Guarantees the editor never ends up blank if real pagination throws.
function _renderDocumentHTMLPlainFallback(rawHtml, triggerSave) {
  if (!docContainer) return;
  docContainer.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'doc-page-canvas';
  page.setAttribute('contenteditable', 'true');
  page.setAttribute('spellcheck', 'false');
  page.style.height = 'auto';
  page.style.minHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.maxHeight = 'none';
  page.style.overflow = 'visible';
  page.addEventListener('input', handleCanvasInput);
  page.addEventListener('keydown', handlePageKeydown);
  page.addEventListener('blur', handlePageBlur);
  try {
    page.innerHTML = _safeHTML(rawHtml || '');
  } catch (_) {
    page.textContent = (rawHtml || '').replace(/<[^>]*>/g, ' ');
  }
  docContainer.appendChild(page);
  _fillBlankSolePageWithCoverPlaceholder();
  if (triggerSave && typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
}

async function _paginateDocumentHTMLCore(rawHtml, triggerSave = true) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  if (!docContainer) return;
  const runId = ++_paginateRunId;
  window.__mathLastOverflowSig = null; // new content: forget the previous overflow/reflow attempt
  const savedScrollPos = docContainer.scrollTop;
  const markerId = _saveCaretOffset();
  docContainer.innerHTML = '';
  const tempSource = document.createElement('div');
  tempSource.innerHTML = _prepareHTML(rawHtml);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(tempSource);
  // FIX: render KaTeX equations BEFORE measuring/splitting into pages.
  // Previously equations were rendered only after a block was already
  // placed on a page, so contentFits() measured the small, unrendered
  // math markup. Rendered KaTeX (matrices, fractions, tall symbols) is
  // often much taller, so a block that "fit" during measurement would
  // grow after rendering and spill into the page-footer-number area —
  // this is the "text runs into the page footer" bug. Rendering here
  // first means every fit check below sees the real, final height.
  if (!(await _perfPreRenderMath(tempSource, runId))) return;
  // FIX: "table row splits onto a new page leaving a big empty gap" bug.
  // isKatexReady()/renderAllKatexVisuals() only confirm the katex JS
  // library is loaded — NOT that its @font-face files (KaTeX_Main,
  // KaTeX_Math, ...) have actually finished downloading. If a page's
  // math glyphs are being rendered for the first time in this session,
  // the browser paints them with a fallback font until the real KaTeX
  // font arrives, so contentFits() below can measure a fallback-font
  // height that's taller than the real, final height. That makes a row
  // (a table row with a matrix/formula cell, for example) look like it
  // "doesn't fit" and get bumped to a fresh page, even though the real
  // rendered content leaves plenty of room — exactly the empty-space-
  // then-page-break gap seen with math-heavy tables. Waiting for
  // document.fonts.ready here guarantees every contentFits() check from
  // this point on measures the final, real font metrics.
  if (typeof ensureKatexDelimiterFonts === 'function') {
    try { await ensureKatexDelimiterFonts(); } catch (_) { /* best effort */ }
  }
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (_) { /* proceed with best-effort metrics */ }
  }

  function createNewPageElement() {
    const page = document.createElement('div');
    page.className = 'doc-page-canvas';
    page.setAttribute('contenteditable', 'true');
    page.setAttribute('spellcheck', 'false');
    page.addEventListener('input', handleCanvasInput);
    page.addEventListener('keydown', handlePageKeydown);
    page.addEventListener('blur', handlePageBlur);
    docContainer.appendChild(page);
    return page;
  }

  let currentPage = createNewPageElement();
  const createdPages = [currentPage];
  const topLevelNodes = flattenContentTopLevelNodes(tempSource);

  // --- Pagination logic with proper spacing ---

  const contentFits = _makeContentFits(pageSnapshot, syncSnapshotFromPage);

  let currentPageElement = currentPage;
  let _sliceStart = performance.now();
  const _slicing = topLevelNodes.length > PERF.BIG_DOC_NODES;
  for (let i = 0; i < topLevelNodes.length; i++) {
    const result = _processPaginationNode(topLevelNodes[i], currentPageElement, createdPages, contentFits, createNewPageElement);
    currentPageElement = result.currentPageElement;
    if (_slicing && i < topLevelNodes.length - 1 && performance.now() - _sliceStart > PERF.SLICE_MS) {
      _perfProgress(i + 1, topLevelNodes.length);
      await _perfYield();                       // let the browser paint / handle clicks and scrolling
      if (runId !== _paginateRunId) return;     // a newer pagination replaced this one
      _sliceStart = performance.now();
    }
  }

  normalizeAllEditorPagesToA4();
  _removeEmptyEditorPages();
  docContainer.scrollTop = savedScrollPos;
  _restoreCaretOffset(markerId);
  
  // ===== FIX: Remove empty trailing pages =====
  _removeTrailingEmptyPages();
  _fillBlankSolePageWithCoverPlaceholder();
  
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
  if (!(await _perfPostProcessPages(runId))) return;
  if (typeof applyPDFVisualFormat === 'function') applyPDFVisualFormat(typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default');
  if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
  if (triggerSave) HISTORY.saveState();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    const tab = TAB_MANAGER.getActive();
    if (tab) {
      const newName = TAB_MANAGER._getTabNameFromHtml(_getLeadingCanvasHTML());
      if (newName && newName !== 'Untitled') {
        tab.name = newName;
        TAB_MANAGER._persist();
        TAB_MANAGER.renderTabBar();
      }
    }
  }
  // FIX: pagination already invalidated the PDF preview cache at the top
  // of this function, but nothing ever re-generated the preview once the
  // (now-final) pages were ready. If the PDF tab happened to already be
  // open — e.g. content is created/regenerated while the PDF preview is
  // visible — the iframe was left showing stale or blank content until
  // something else (like a full page refresh) forced a regeneration.
  // Refresh it here, the same way toggleDarkMode/choosePDFVisualFormat
  // already do, whenever the PDF tab is the one currently on screen.
  const _pdfViewAfterPaginate = document.getElementById('pdf-view-container');
  if (_isPdfViewVisible() && typeof generateLivePDFIframePreview === 'function') {
    generateLivePDFIframePreview();
  }
}

// ===== CHUNKED PAGINATION FOR LONG DOCUMENTS =====
const PAGINATION_CHUNK_SIZE = 60;

// FIX: "PDF page gets cut off / text goes missing" bug.
// Every top-level block (a <table>, a <ul>/<ol>, a long <blockquote>, etc.)
// was previously always moved to a page WHOLE, never split — which is
// correct and necessary for a normal paragraph or heading (so a page never
// starts mid-sentence), but breaks down the moment a single block is
// physically taller than one entire empty A4 page: a long table, a long
// list, or a big block wrapper. In that case the old code still just
// dropped the whole thing onto one page as-is (see the final unconditional
// contentFits(currentPageElement, node) check was allowed to fail and the
// block got appended anyway) — and because .doc-page-canvas has
// `overflow: hidden`, everything past the page's fixed height was simply
// invisible, both in the editor and in the exported PDF. This function
// finds a safe place to split such an oversized block (table rows, list
// items, or a wrapper's own block children) and spreads it across as many
// pages as it actually needs.
// FIX: "colored callout box gets sliced in half across a page break" bug.
// Boxed/tinted panels — a solution card, a proof block, a definition/warning
// callout, a figure frame, a quiz block, or any similar AI-authored div with
// its own background + border/border-radius/box-shadow — read as ONE visual
// unit (rounded corners, a colored background, a left rule). The generic
// "DIV with more than one child is splittable" rule below used to treat
// these exactly like a plain wrapper div and chop them wherever the page
// ran out of room, leaving half the rounded box on one page and the rest
// floating with no border/background on the next. This box carries both the
// known predefined callout classes (.block-solution, .block-important, etc.)
// and a heuristic for freeform inline-styled cards the AI writes on the fly
// (background + border/radius, or any box-shadow), so both are recognized
// and kept whole.
const UNSPLITTABLE_BLOCK_CLASSES = [
  'block-example', 'block-definition', 'block-warning', 'block-important',
  'block-note', 'block-accent', 'block-solution', 'math-final-answer',
  'figure-pro', 'figure-frame', 'fc-wrapper', 'quiz-container', 'quiz-item',
  'quiz-answer-key', 'omr-sheet-page', 'cq-item', 'cq-container'
];

function _isDesignedBoxBlock(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const classList = node.classList;
  if (classList && UNSPLITTABLE_BLOCK_CLASSES.some(c => classList.contains(c))) return true;

  const style = node.getAttribute('style') || '';
  if (!style) return false;
  const noSpace = style.replace(/\s+/g, '');
  const hasShadow = /box-shadow\s*:\s*(?!none)/i.test(style);
  const hasRadius = /border-radius\s*:\s*(?!0(?:px)?\s*(?:;|$))/i.test(style);
  const hasBorder = /\bborder(-left|-right|-top|-bottom)?\s*:\s*(?!none|0(?:px)?\s*(?:;|$))[^;]*\d/i.test(style);
  const hasTintedBg = /background(-color)?\s*:\s*(?!transparent|none|#fff(?:fff)?;|white;)/i.test(noSpace + ';');
  // A "designed box" needs at least a background paired with a border or
  // rounded corners, or an explicit shadow — plain text divs with only
  // color/margin/font styling never match this and remain freely splittable.
  return hasShadow || (hasTintedBg && (hasBorder || hasRadius));
}

function _getSplittableChildrenForOverflow(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = (node.tagName || '').toUpperCase();
  if (tag === 'TABLE') {
    const rows = Array.from(node.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr, :scope > tfoot > tr'));
    return rows.length > 1 ? rows : null;
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(node.children).filter(c => c.tagName === 'LI');
    return items.length > 1 ? items : null;
  }
  if (tag === 'DIV' || tag === 'BLOCKQUOTE') {
    if (_isDesignedBoxBlock(node)) return null;
    const children = Array.from(node.childNodes).filter(c =>
      c.nodeType === Node.ELEMENT_NODE || (c.nodeType === Node.TEXT_NODE && c.textContent.trim().length > 0));
    return children.length > 1 ? children : null;
  }
  return null;
}

// Appends `node` starting on `currentPageElement`, splitting it across as
// many additional pages as needed if it (or a smaller piece of it) still
// doesn't fit on a fresh, empty page. Returns the updated currentPageElement.
function _appendPossiblyOversizedNode(node, currentPageElement, createdPages, contentFits, createNewPageElement) {
  const splitChildren = _getSplittableChildrenForOverflow(node);
  const renderMath = (el) => {
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(el);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(el);
  };
  if (!splitChildren) {
    // A long paragraph is broken at a word boundary and continues on the next page(s).
    if (_isTextSplittableBlock(node)) {
      return _splitTextBlockAcrossPages(node, currentPageElement, createdPages, contentFits, createNewPageElement, renderMath);
    }
    // Nothing safe to split on (a single image/equation/canvas taller than a page, etc.).
    const clone = node.cloneNode(true);
    currentPageElement.appendChild(clone);
    renderMath(clone);
    return currentPageElement;
  }

  // A table split across pages repeats its header row(s) (thead rows, or rows made only of <th>),
  // keeps its <colgroup> on every part and its <caption> on the first part, and keeps rows inside
  // a real <tbody>/<thead> so stylesheet selectors still match.
  const isTable = (node.tagName || '').toUpperCase() === 'TABLE';
  const headerRows = isTable
    ? splitChildren.filter(r => (r.parentElement && r.parentElement.tagName === 'THEAD') ||
        (r.children.length > 0 && Array.from(r.children).every(c => c.tagName === 'TH')))
    : [];
  const bodyRows = headerRows.length ? splitChildren.filter(r => !headerRows.includes(r)) : splitChildren;

  let firstWrapper = true;
  function startWrapperOnCurrentPage() {
    const isFirst = firstWrapper;
    firstWrapper = false;
    const w = node.cloneNode(false); // tag + attributes only
    currentPageElement.appendChild(w);
    let host = w;
    if (isTable) {
      Array.from(node.children).forEach(ch => {
        if (ch.tagName === 'COLGROUP' || (isFirst && ch.tagName === 'CAPTION')) w.appendChild(ch.cloneNode(true));
      });
      if (headerRows.length) {
        const thead = document.createElement('thead');
        w.appendChild(thead);
        headerRows.forEach(hr => {
          const hClone = hr.cloneNode(true);
          thead.appendChild(hClone);
          renderMath(hClone);
        });
      }
      host = document.createElement('tbody');
      w.appendChild(host);
    }
    return { w, host, isFirst };
  }

  let cur = startWrapperOnCurrentPage();
  let wrapperHasChild = false;

  bodyRows.forEach(child => {
    const childClone = child.cloneNode(true);
    cur.host.appendChild(childClone);
    renderMath(childClone);

    if (!contentFits(currentPageElement)) {
      // Is there anything else on this page besides our wrapper (and the footer)?
      const otherContent = Array.from(currentPageElement.childNodes).some(n => n !== cur.w &&
        (n.nodeType === 1 ? !(n.classList && n.classList.contains('page-footer-number')) : n.textContent.trim().length > 0));
      // The piece overflows. Move it to a fresh page unless it is already the very first thing on an
      // otherwise empty page (then nothing better can be done). This also covers the FIRST row, which
      // used to be accepted without checking and got clipped at the bottom of the page.
      if (wrapperHasChild || otherContent) {
        cur.host.removeChild(childClone);
        if (!wrapperHasChild) {            // wrapper holds only repeated header rows: drop it
          currentPageElement.removeChild(cur.w);
          firstWrapper = cur.isFirst;
        }
        currentPageElement = createNewPageElement();
        createdPages.push(currentPageElement);
        cur = startWrapperOnCurrentPage();
        cur.host.appendChild(childClone);
      }
    }
    wrapperHasChild = true;
  });

  return currentPageElement;
}

// ===== TEXT-LEVEL PAGE BREAKING (paragraphs flow across pages like in Word) =====
// Before: a paragraph (or any block with no table-row/list-item/child parts) that did not fit on a
// whole empty page was appended anyway and its lower part was silently clipped by the page's
// overflow:hidden. Now such blocks are split at a word boundary: the part that fits stays, the rest
// continues on the next page(s). Orphan/widow control keeps at least 2 lines on each side.
const _TEXT_SPLIT_MIN_CHARS = 80;
const _BLOCK_CHILD_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'PRE', 'BLOCKQUOTE', 'FIGURE', 'SECTION', 'ARTICLE', 'HR', 'SVG', 'CANVAS', 'DL', 'FORM']);

function _isTextSplittableBlock(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node.tagName || '').toUpperCase();
  if (tag !== 'P' && tag !== 'DIV' && tag !== 'BLOCKQUOTE') return false;
  if (node.classList.contains('manual-page-break') || node.classList.contains('page-footer-number')) return false;
  if ((tag === 'DIV' || tag === 'BLOCKQUOTE') && _isDesignedBoxBlock(node)) return false;
  for (const ch of node.children) {
    if (_BLOCK_CHILD_TAGS.has((ch.tagName || '').toUpperCase())) return false;
  }
  return (node.textContent || '').trim().length >= _TEXT_SPLIT_MIN_CHARS;
}

// Anything that can be broken into smaller parts (table rows, list items, child blocks, or text).
function _canSplitBlock(node) {
  return !!_getSplittableChildrenForOverflow(node) || _isTextSplittableBlock(node);
}

// Word boundaries inside the block's own text (never inside rendered math / svg / non-editable bits).
function _textBreakPoints(node) {
  const pts = [];
  let chars = 0;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode(t) {
      const p = t.parentElement;
      if (p && p.closest('.katex, .katex-eq, svg, script, style, [contenteditable="false"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let t;
  while ((t = walker.nextNode())) {
    const v = t.nodeValue;
    const re = /[ \t\r\n]+/g;
    let m;
    while ((m = re.exec(v))) {
      const off = m.index + m[0].length;      // break AFTER the whitespace, so the tail starts with a word
      if (off > 0 && off < v.length) pts.push({ n: t, off, chars: chars + off });
    }
    chars += v.length;
  }
  return { pts: pts.filter(p => p.chars > 0 && p.chars < chars), total: chars };
}

function _splitTextBlockAt(node, pt, headOnly) {
  const r1 = document.createRange();
  r1.setStart(node, 0);
  r1.setEnd(pt.n, pt.off);
  const head = node.cloneNode(false);
  head.appendChild(r1.cloneContents());
  head.classList.add('split-head');
  if (headOnly) return { head };
  const r2 = document.createRange();
  r2.setStart(pt.n, pt.off);
  r2.setEnd(node, node.childNodes.length);
  const tail = node.cloneNode(false);
  tail.appendChild(r2.cloneContents());
  tail.removeAttribute('id');
  tail.classList.add('split-tail');
  return { head, tail };
}

// probe(headEl) -> { fits, h, lh }  (h = rendered height, lh = line height, only meaningful when fits)
function _chooseParagraphSplit(node, probe, hasOtherContent) {
  const { pts, total } = _textBreakPoints(node);
  if (!pts.length) return null;
  let lo = 0, hi = pts.length - 1, best = -1;
  while (lo <= hi) {                       // biggest head that still fits (monotonic)
    const mid = (lo + hi) >> 1;
    if (probe(_splitTextBlockAt(node, pts[mid], true).head).fits) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  let idx = best;
  const info = probe(_splitTextBlockAt(node, pts[best], true).head);
  if (info.fits && info.h > 0 && info.lh > 0) {
    const headLines = Math.max(1, Math.round(info.h / info.lh));
    const cpl = pts[best].chars / headLines;                       // characters per line (estimate)
    let strict = idx;
    while (strict >= 0 && (total - pts[strict].chars) < 2 * cpl) strict--;   // widow: >= 2 lines left for the tail
    if (strict >= 0 && (!hasOtherContent || pts[strict].chars / cpl >= 1.5)) idx = strict;   // orphan: >= 2 lines here
    else if (hasOtherContent) return null;                                                  // can't do it nicely: move whole block
  }
  return _splitTextBlockAt(node, pts[idx], false);
}

// Core-pagination version: fills the current page, continues on new pages. Returns the last page.
function _splitTextBlockAcrossPages(node, page, createdPages, contentFits, createNewPage, renderMath) {
  const hasOther = (p) => Array.from(p.childNodes).some(n => n.nodeType === 1
    ? !(n.classList && n.classList.contains('page-footer-number')) : n.textContent.trim().length > 0);
  let rest = node;
  let guard = 0;
  while (rest && guard++ < 500) {
    const probe = (head) => {
      page.appendChild(head);
      const fits = contentFits(page);          // no extra node => measured from scratch, mirror reset
      let h = 0, lh = 0;
      if (fits) {
        h = head.offsetHeight;
        const cs = getComputedStyle(head);
        lh = parseFloat(cs.lineHeight);
        if (!(lh > 0)) lh = (parseFloat(cs.fontSize) || 16) * 1.4;
      }
      page.removeChild(head);
      return { fits, h, lh };
    };
    if (probe(rest.cloneNode(true)).fits) {
      const c = rest.cloneNode(true);
      page.appendChild(c);
      renderMath(c);
      return page;
    }
    const split = _chooseParagraphSplit(rest, probe, hasOther(page));
    if (!split) {
      if (hasOther(page)) { page = createNewPage(); createdPages.push(page); continue; }   // retry on an empty page
      const c = rest.cloneNode(true);          // empty page and still no break possible: keep it whole
      page.appendChild(c);
      renderMath(c);
      return page;
    }
    page.appendChild(split.head);
    renderMath(split.head);
    page = createNewPage();
    createdPages.push(page);
    rest = split.tail;
  }
  return page;
}

// Live-editor version (typing): the first overflowing block is cut so its first part stays on `page`.
function _splitFirstOverflowParagraph(page, overflow) {
  const first = overflow[0];
  if (!_isTextSplittableBlock(first)) return;
  const footer = page.querySelector('.page-footer-number');
  const zoom = parseFloat(page.style.zoom) || 1;
  const hasOther = Array.from(page.childNodes).some(n => n !== footer &&
    (n.nodeType === 1 || n.textContent.trim().length > 0));
  const probe = (head) => {
    page.insertBefore(head, footer || null);
    const fits = (page.scrollHeight / zoom) <= EDITOR_A4_HEIGHT + 1;
    let h = 0, lh = 0;
    if (fits) {
      h = head.offsetHeight;
      const cs = getComputedStyle(head);
      lh = parseFloat(cs.lineHeight);
      if (!(lh > 0)) lh = (parseFloat(cs.fontSize) || 16) * 1.4;
    }
    page.removeChild(head);
    return { fits, h, lh };
  };
  const split = _chooseParagraphSplit(first, probe, hasOther);
  if (!split) return;
  page.insertBefore(split.head, footer || null);
  overflow[0] = split.tail;
}

// Re-joins pieces made by the splitter (head + tail) into one paragraph before the text is paginated
// again, so the layout is recomputed from the real paragraph and no stray break remains.
function _mergeSplitBlocks(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const gone = new Set();
  Array.from(root.querySelectorAll('.split-head')).forEach(el => {
    if (gone.has(el)) return;
    let next;
    while ((next = el.nextElementSibling) && next.classList.contains('split-tail') && next.tagName === el.tagName) {
      while (next.firstChild) el.appendChild(next.firstChild);
      gone.add(next);
      next.remove();
    }
    el.classList.remove('split-head', 'split-tail');
    if (!el.getAttribute('class')) el.removeAttribute('class');
  });
  Array.from(root.querySelectorAll('.split-tail')).forEach(el => {   // orphaned tails (head was edited away)
    el.classList.remove('split-tail');
    if (!el.getAttribute('class')) el.removeAttribute('class');
  });
}

function _processPaginationNode(node, currentPageElement, createdPages, contentFits, createNewPageElement) {
  if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
    return { currentPageElement, createdPages, handled: true };
  }

  if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('manual-page-break')) {
    if (currentPageElement.childNodes.length > 0) {
      currentPageElement = createNewPageElement();
      createdPages.push(currentPageElement);
    }
    return { currentPageElement, createdPages, handled: true };
  }

  // Editor pagination must never split a paragraph block into a page of one line.
  // If the whole element does not fit in the current page, move the full element
  // to the next page as one semantic block. This is the required fix for the
  // "paragraph ends, then next page begins with the last line or word only" bug.
  const hasContent = Array.from(currentPageElement.childNodes).some(n => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim().length > 0;
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (n.classList && n.classList.contains('page-footer-number')) return false;
      return true;
    }
    return false;
  });

  // FIX: "empty space left on the page" bug. A table, list, or boxed block
  // (.block-solution and similar bordered/boxed DIVs, blockquotes) has
  // safely splittable pieces inside it — whole rows, list items, or child
  // lines. Previously, the moment such a block didn't fit in the ROOM LEFT
  // on the current page — even though it would fit easily on a fresh page
  // on its own — it was moved WHOLE to a brand new page. That stranded
  // whatever room was left on the current page as dead blank space, and
  // disconnected the block from the text that came right before it. Now,
  // whenever the current page already has content and the block has
  // splittable pieces, it fills the remaining room with as much of itself
  // as fits — continuing immediately after the preceding text, without
  // breaking a row, item, or the block's own design apart — and only spills
  // whatever's left onto as many further pages as it needs. FIGURE (and any
  // other block _getSplittableChildrenForOverflow doesn't recognize) never
  // takes this path, so it keeps moving to a fresh page as one untouched
  // whole block, since a figure's visual layout matters more than filling
  // every last bit of space.
  if (hasContent && !contentFits(currentPageElement, node)) {
    // FIX: "table split across two pages just to fill leftover room" bug.
    // The row-splitting path below exists so a block taller than a whole
    // empty page doesn't get silently clipped — but it was also firing
    // whenever a TABLE simply didn't fit in the ROOM LEFT on the current
    // page, even though the whole table fits easily on a fresh page. That
    // produced a table cut in half with its header row repeated on the
    // second half. A table must always move to a fresh page as one whole
    // block here; it only gets split as a last resort a few lines below,
    // when it still doesn't fit on a completely empty page (so a
    // genuinely oversized table is still never clipped/lost).
    const tag = (node.tagName || '').toUpperCase();
    const isTable = tag === 'TABLE';
    const splitChildren = isTable ? null : _getSplittableChildrenForOverflow(node);
    if (splitChildren) {
      currentPageElement = _appendPossiblyOversizedNode(node, currentPageElement, createdPages, contentFits, createNewPageElement);
      return { currentPageElement, createdPages, handled: true };
    }
    if (_isTextSplittableBlock(node)) {
      // Fill the rest of this page with the first lines (>= 2) and continue on the next page (>= 2 lines),
      // instead of leaving a big blank gap at the bottom.
      const _renderMathNow = (el) => {
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(el);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(el);
      };
      currentPageElement = _splitTextBlockAcrossPages(node, currentPageElement, createdPages, contentFits, createNewPageElement, _renderMathNow);
      return { currentPageElement, createdPages, handled: true };
    }
    currentPageElement = createNewPageElement();
    createdPages.push(currentPageElement);
  }

  if (!contentFits(currentPageElement, node)) {
    // Even a completely fresh, empty page can't hold this block whole —
    // it's genuinely taller than one A4 page. Split it instead of
    // silently clipping it (see _appendPossiblyOversizedNode above).
    currentPageElement = _appendPossiblyOversizedNode(node, currentPageElement, createdPages, contentFits, createNewPageElement);
    return { currentPageElement, createdPages, handled: true };
  }

  const clone = node.cloneNode(true);
  currentPageElement.appendChild(clone);
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(clone);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(clone);
  return { currentPageElement, createdPages, handled: true };
}


async function paginateDocumentCanvasAsync(rawHtml, triggerSave = true) {
  if (!docContainer) return;
  // Same blank-until-refresh safety net as setDocumentHTMLAndPaginate.
  const token = ++_htmlSetToken;
  _renderInFlight++;
  try {
    try {
      await _paginateDocumentCanvasAsyncCore(rawHtml, triggerSave);
    } catch (err) {
      console.error('[paginateDocumentCanvasAsync] pagination failed, showing plain fallback:', err);
      _renderDocumentHTMLPlainFallback(rawHtml, triggerSave);
      await new Promise(resolve => setTimeout(resolve, 400));
      if (token !== _htmlSetToken) return;   // something newer was rendered/typed: don't overwrite it
      try {
        await _paginateDocumentCanvasAsyncCore(rawHtml, triggerSave);
      } catch (retryErr) {
        console.error('[paginateDocumentCanvasAsync] retry also failed, keeping plain fallback:', retryErr);
        if (typeof displayToastNotification === 'function') {
          displayToastNotification('⚠️ Page formatting had an issue. Your content is still shown below — refresh if it looks off.');
        }
      }
    }
  } finally {
    _renderInFlight--;
  }
}

async function _paginateDocumentCanvasAsyncCore(rawHtml, triggerSave = true) {
  const scratch = { els: [] };
  try { return await _paginateDocumentCanvasAsyncCoreImpl(rawHtml, triggerSave, scratch); }
  finally { scratch.els.forEach(el => { try { el.remove(); } catch (_) {} }); } // the measuring elements used to leak into <body> on every run
}

async function _paginateDocumentCanvasAsyncCoreImpl(rawHtml, triggerSave, scratch) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  if (!docContainer) return;
  const runId = ++_paginateRunId;
  window.__mathLastOverflowSig = null; // new content: forget the previous overflow/reflow attempt
  const savedScrollPos = docContainer.scrollTop;
  const markerId = _saveCaretOffset();
  docContainer.innerHTML = '';
  const tempSource = document.createElement('div');
  tempSource.innerHTML = _prepareHTML(rawHtml);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(tempSource);
  // FIX: same fix as in setDocumentHTMLAndPaginate — render KaTeX before
  // splitting into pages so the fit-measurement below uses the real,
  // final (rendered) height instead of the smaller unrendered markup.
  // Otherwise a block that measured as "fits" grows after KaTeX renders
  // and overlaps the page-footer-number underneath it.
  if (!(await _perfPreRenderMath(tempSource, runId))) return;
  // FIX: same "table row bumped to a new page, leaving a big empty gap"
  // bug as in _paginateDocumentHTMLCore — see the matching comment there.
  // This chunked/streamed pagination path renders KaTeX just like the
  // other one, so it needs the same wait for the real @font-face files
  // (not just the katex JS library) before contentFits() starts
  // measuring, or math-heavy rows can be mismeasured against fallback-
  // font heights.
  if (typeof ensureKatexDelimiterFonts === 'function') {
    try { await ensureKatexDelimiterFonts(); } catch (_) { /* best effort */ }
  }
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (_) { /* proceed with best-effort metrics */ }
  }

  function createNewPageElement() {
    const page = document.createElement('div');
    page.className = 'doc-page-canvas';
    page.setAttribute('contenteditable', 'true');
    page.setAttribute('spellcheck', 'false');
    page.addEventListener('input', handleCanvasInput);
    page.addEventListener('keydown', handlePageKeydown);
    page.addEventListener('blur', handlePageBlur);
    docContainer.appendChild(page);
    return page;
  }

  let currentPage = createNewPageElement();
  const createdPages = [currentPage];
  const topLevelNodes = flattenContentTopLevelNodes(tempSource);

  // Private measuring page (so live typing never collides with this run); removed again when the run ends.
  const pageSnapshot = document.createElement('div');
  pageSnapshot.className = 'doc-page-canvas pdf-export-measure-page';
  pageSnapshot.style.cssText = measurePage.style.cssText;
  document.body.appendChild(pageSnapshot);
  scratch.els.push(pageSnapshot);

  function syncSnapshotFromPage(pageEl) {
    pageSnapshot.innerHTML = '';
    const fragment = document.createDocumentFragment();
    Array.from(pageEl.childNodes).forEach(child => {
      if (!(child.classList && child.classList.contains('page-footer-number'))) {
        fragment.appendChild(child.cloneNode(true));
      }
    });
    pageSnapshot.appendChild(fragment);
  }

  const contentFits = _makeContentFits(pageSnapshot, syncSnapshotFromPage);

  let currentPageElement = currentPage;
  const useChunking = topLevelNodes.length > PERF.BIG_DOC_NODES;
  let i = 0;

  // FIX: "scroll jumps back up while I'm scrolling" bug. This chunked path
  // is async — it yields with `await` between chunks for long documents
  // (exactly the case a PDF gets generated from). Yielding hands control
  // back to the browser, so if the person scrolls the document while a
  // chunk boundary is paused, `docContainer.scrollTop = savedScrollPos`
  // below used to unconditionally snap them back to wherever they were
  // BEFORE this whole repagination started, fighting their scroll input.
  // Track real user scroll intent (wheel/touch/keyboard) during this
  // window and only restore the saved position if they never touched it.
  let userScrolledDuringPagination = false;
  const _markUserScrollIntent = () => { userScrolledDuringPagination = true; };
  docContainer.addEventListener('wheel', _markUserScrollIntent, { passive: true });
  docContainer.addEventListener('touchmove', _markUserScrollIntent, { passive: true });
  docContainer.addEventListener('keydown', _markUserScrollIntent, { passive: true });

  const _dropScrollListeners = () => {
    docContainer.removeEventListener('wheel', _markUserScrollIntent);
    docContainer.removeEventListener('touchmove', _markUserScrollIntent);
    docContainer.removeEventListener('keydown', _markUserScrollIntent);
  };
  let _sliceStart = performance.now();
  for (; i < topLevelNodes.length; i++) {
    const result = _processPaginationNode(topLevelNodes[i], currentPageElement, createdPages, contentFits, createNewPageElement);
    currentPageElement = result.currentPageElement;
    if (useChunking && i < topLevelNodes.length - 1 && performance.now() - _sliceStart > PERF.SLICE_MS) {
      _perfProgress(i + 1, topLevelNodes.length);
      await _perfYield();
      if (runId !== _paginateRunId) { _dropScrollListeners(); return; }
      _sliceStart = performance.now();
    }
  }

  docContainer.removeEventListener('wheel', _markUserScrollIntent);
  docContainer.removeEventListener('touchmove', _markUserScrollIntent);
  docContainer.removeEventListener('keydown', _markUserScrollIntent);

  normalizeAllEditorPagesToA4();
  if (!userScrolledDuringPagination) {
    docContainer.scrollTop = savedScrollPos;
  }
  _restoreCaretOffset(markerId);

  _removeTrailingEmptyPages();

  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
  if (!(await _perfPostProcessPages(runId))) return;
  if (typeof applyPDFVisualFormat === 'function') applyPDFVisualFormat(typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default');
  if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
  if (triggerSave) HISTORY.saveState();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    const tab = TAB_MANAGER.getActive();
    if (tab) {
      const newName = TAB_MANAGER._getTabNameFromHtml(_getLeadingCanvasHTML());
      if (newName && newName !== 'Untitled') {
        tab.name = newName;
        TAB_MANAGER._persist();
        TAB_MANAGER.renderTabBar();
      }
    }
  }
  // FIX: same fix as in setDocumentHTMLAndPaginate — this is the chunked
  // path used for long/math-heavy documents, where pagination itself runs
  // across several event-loop ticks (see the `await` above). If the PDF
  // tab is open and a preview got generated from an in-progress chunk,
  // nothing ever told it to re-render once chunking actually finished —
  // that's the "PDF looks blank/incomplete until I refresh the page" bug.
  // Refresh the live preview now that pagination is genuinely done.
  const _pdfViewAfterPaginateAsync = document.getElementById('pdf-view-container');
  if (_isPdfViewVisible() && typeof generateLivePDFIframePreview === 'function') {
    generateLivePDFIframePreview();
  }
}

// ===== PAGE EVENT HANDLERS =====
function handlePageKeydown(e) {
  if (!docContainer) return;
  const page = e.currentTarget;
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const pageIndex = pages.indexOf(page);

  if ((e.key === 'Backspace' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') && selection.focusOffset === 0) {
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(page);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    if (preCaretRange.toString().trim() === '') {
      if (pageIndex > 0) {
        e.preventDefault();
        const prevPage = pages[pageIndex - 1];
        prevPage.focus();
        const newRange = document.createRange();
        newRange.selectNodeContents(prevPage);
        newRange.collapse(false);
        const footer = prevPage.querySelector('.page-footer-number');
        if (footer) { newRange.setStartBefore(footer);
          newRange.setEndBefore(footer); }
        selection.removeAllRanges();
        selection.addRange(newRange);
        if (e.key === 'Backspace') {
          scheduleReflow();
        }
      }
    }
  }
}

function handleCanvasInput(event) {
  if (event && event.currentTarget && event.currentTarget.classList) _dirtyPages.add(event.currentTarget);
  _htmlSetToken++;   // typing cancels any delayed fallback re-render of older HTML
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  debouncedAutoSaveAndPaginate();   // also schedules the reflow
}

// True when the page has text that still needs math processing ($ or \\ outside already-rendered
// equations) or an equation that is not rendered correctly. page.textContent can NOT be used for this:
// rendered KaTeX keeps its TeX source (with backslashes) in a hidden annotation, so every page that
// contained any equation looked like it "needed work" on every blur.
function _pageNeedsMathPass(page) {
  const spans = page.querySelectorAll('.katex-eq');
  if (typeof isKatexSpanBroken === 'function') {
    for (const sp of spans) { if (isKatexSpanBroken(sp)) return true; }
  }
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('.katex-eq, .katex, script, style')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let n;
  while ((n = walker.nextNode())) { if (/[$\\]/.test(n.nodeValue)) return true; }
  return false;
}

function handlePageBlur(event) {
  const page = event.currentTarget;
  if (!_pageNeedsMathPass(page)) return;
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
  debouncedAutoSaveAndPaginate();
}

// ===== REFLOW DOCUMENT =====
function _nextEditorPage(page) {
  let n = page.nextElementSibling;
  while (n && !(n.classList && n.classList.contains('doc-page-canvas'))) n = n.nextElementSibling;
  return n;
}

// Overflowing blocks go to the START of the next page (which is then re-checked) instead of always
// creating a new page, so typing no longer leaves a trail of nearly empty pages.
function _moveOverflowToNextPage(page, overflow) {
  let target = _nextEditorPage(page);
  if (!target) target = createNewPageAfter(page);
  const fragment = document.createDocumentFragment();
  overflow.forEach(node => fragment.appendChild(node));
  target.prepend(fragment);
  return target;
}

function _putBackBeforeFooter(page, node) {
  const footer = page.querySelector('.page-footer-number');
  page.insertBefore(node, footer || null);
}

function reflowDocument(dirtyList) {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length === 0) return;
  // Big document + we know which page(s) were edited: re-flow only those (not all pages).
  if (Array.isArray(dirtyList) && dirtyList.length && pages.length > PERF.LOCAL_REFLOW_MIN_PAGES) {
    _reflowDirtyPagesOnly(dirtyList);
    return;
  }

  const markerId = saveCaretPosition();
  let page = pages[0];
  let guard = 0;
  while (page && guard++ < 5000) {
    const zoomFactor = parseFloat(page.style.zoom) || 1;
    if ((page.scrollHeight / zoomFactor) > EDITOR_A4_HEIGHT + 1) {
      const overflow = getOverflowNodes(page);
      if (overflow.length > 0) {
        // A table/list/boxed block with splittable parts is handed to the split-aware paginator.
        if (overflow.length === 1 && _getSplittableChildrenForOverflow(overflow[0])) {
          _putBackBeforeFooter(page, overflow[0]);
          restoreCaretPosition(markerId);
          if (typeof paginateDocumentCanvas === 'function') paginateDocumentCanvas();
          return;
        }
        _splitFirstOverflowParagraph(page, overflow);   // keep as many lines as fit on this page
        _moveOverflowToNextPage(page, overflow);
        continue;   // re-check this page, then the page that received the overflow
      }
    }
    page = _nextEditorPage(page);
  }
  normalizeAllEditorPagesToA4();
  _removeTrailingEmptyPages();
  restoreCaretPosition(markerId);
  // While typing, the pending autosave saves the final state once; saving here too doubled the work.
  if (!_autoSavePending) HISTORY.saveState();
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
}

// Typing in a big document: only the page being edited (and any page it spills onto) is measured.
function _reflowDirtyPagesOnly(dirtyList) {
  const dirty = Array.from(new Set(dirtyList)).filter(p => p && p.isConnected);
  if (!dirty.length) return;
  const markerId = saveCaretPosition();
  const touched = new Set(dirty);
  const queue = dirty.slice();
  let createdAny = false;
  for (let qi = 0; qi < queue.length && qi < 500; qi++) {
    const page = queue[qi];
    let guard = 0;
    while (guard++ < 40) {
      const zoomFactor = parseFloat(page.style.zoom) || 1;
      if ((page.scrollHeight / zoomFactor) <= EDITOR_A4_HEIGHT + 1) break;
      const overflow = getOverflowNodes(page);
      if (!overflow.length) break;
      if (overflow.length === 1 && _getSplittableChildrenForOverflow(overflow[0])) {
        _putBackBeforeFooter(page, overflow[0]);
        restoreCaretPosition(markerId);
        if (typeof paginateDocumentCanvas === 'function') paginateDocumentCanvas();
        return;
      }
      _splitFirstOverflowParagraph(page, overflow);
      const hadNext = !!_nextEditorPage(page);
      const target = _moveOverflowToNextPage(page, overflow);
      if (!hadNext) createdAny = true;
      touched.add(target);
      if (!queue.includes(target)) queue.push(target);   // the receiving page is checked too
    }
  }
  touched.forEach(p => {
    resetPageToA4(p);
    if (p.scrollHeight > EDITOR_A4_HEIGHT + 1) tightenPageContentToA4(p);
  });
  // Pages the edit may have emptied (and the last page) — not every page of the document.
  let removed = 0;
  const candidates = Array.from(touched).concat(docContainer.lastElementChild ? [docContainer.lastElementChild] : []);
  new Set(candidates).forEach(p => {
    if (!p || !p.isConnected || !p.classList || !p.classList.contains('doc-page-canvas')) return;
    if (docContainer.querySelectorAll('.doc-page-canvas').length <= 1) return;
    if (!pageHasContent(p) && !_pageIsActive(p)) { p.remove(); removed++; }
  });
  if (createdAny || removed) updatePageFooters();
  if (removed && typeof displayToastNotification === 'function') displayToastNotification(`🧹 Removed ${removed} empty page(s)`);
  restoreCaretPosition(markerId);
  if (!_autoSavePending) HISTORY.saveState();
  touched.forEach(p => {
    if (!p.isConnected || !/[$\\]/.test(p.textContent || '')) return;
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(p);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(p);
  });
}

function getOverflowNodes(page) {
  const maxHeight = EDITOR_A4_HEIGHT + 1;   // same tolerance as contentFits()
  const footer = page.querySelector('.page-footer-number');
  const children = Array.from(page.childNodes).filter(c => c !== footer);

  if (!children.length) return [];

  syncSnapshotFromPage(page);

  // Remove one complete top-level node from the snapshot at a time until it fits again.
  const overflow = [];
  while (pageSnapshot.scrollHeight > maxHeight && pageSnapshot.childNodes.length > 0) {
    const lastSnapshotNode = pageSnapshot.lastChild;
    if (!lastSnapshotNode) break;

    const childIndex = pageSnapshot.childNodes.length - 1;
    const realNode = children[childIndex];
    if (!realNode) break;

    pageSnapshot.removeChild(lastSnapshotNode);
    overflow.unshift(realNode);
  }

  // If even the first block alone is too tall and cannot be split, leave it where it is (moving it
  // would only leave an empty page behind and push the same problem onto the next page).
  if (overflow.length > 0 && overflow.length === children.length && !_canSplitBlock(overflow[0])) {
    overflow.shift();
  }

  if (overflow.length > 0) {
    overflow.forEach(node => {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    return overflow;
  }

  return [];
}

// ===== A4 PAGE SAFETY =====
(function injectTightPageStyles() {
  if (!document.head || document.getElementById('tight-page-styles')) return;
  const st = document.createElement('style');
  st.id = 'tight-page-styles';
  // Tightening is done with page-level CSS (attribute + variable on the page itself) instead of
  // inline styles on the user's elements, so it is never saved into the document and is fully
  // undone by resetPageToA4() when the content shrinks again.
  st.textContent = `
    .doc-page-canvas[data-tight~="media"] img,
    .doc-page-canvas[data-tight~="media"] canvas { max-height: var(--tight-media-max, none) !important; width: auto !important; }
    .doc-page-canvas[data-tight~="media"] .figure-frame,
    .doc-page-canvas[data-tight~="media"] .fc-svg-wrapper { max-height: var(--tight-media-max, none) !important; }
    .doc-page-canvas[data-tight~="small"] table { font-size: 92% !important; }
    .doc-page-canvas[data-tight~="small"] th,
    .doc-page-canvas[data-tight~="small"] td { padding: 4px 6px !important; }
    .split-head { margin-bottom: 0 !important; }
    .split-tail { margin-top: 0 !important; text-indent: 0 !important; }`;
  document.head.appendChild(st);
})();

function resetPageToA4(page) {
  if (!page) return;
  page.style.width = EDITOR_A4_WIDTH + 'px';
  page.style.height = EDITOR_A4_HEIGHT + 'px';
  page.style.minHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.overflow = 'hidden';
  delete page.dataset.oversized;
  page.style.zoom = '';
  // undo any previous tightening
  page.style.fontSize = '';
  page.style.lineHeight = '';
  page.style.removeProperty('--tight-media-max');
  page.removeAttribute('data-tight');
}

function tightenPageContentToA4(page) {
  if (!page) return false;
  resetPageToA4(page);
  const footer = page.querySelector('.page-footer-number');
  const contentNodes = Array.from(page.childNodes).filter(n => n !== footer);
  if (!contentNodes.length) return true;

  for (const pt of EDITOR_A4_TEXT_SIZES_PT) {
    const scale = pt / 12;
    page.style.fontSize = pt + 'pt';
    page.style.lineHeight = String(pt >= 12 ? 1.6 : 1.55);
    page.style.setProperty('--tight-media-max', Math.max(180, Math.floor(EDITOR_A4_HEIGHT * 0.72 * scale)) + 'px');
    page.setAttribute('data-tight', pt >= 12 ? 'media' : 'media small');
    if (page.scrollHeight <= EDITOR_A4_HEIGHT + 1) {
      delete page.dataset.oversized;
      return true;
    }
  }
  page.dataset.oversized = 'true';
  return false;
}

function normalizeAllEditorPagesToA4() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  // Write all, then read all (the old loop alternated write/read per page = one forced layout per page).
  pages.forEach(resetPageToA4);
  const tooTall = pages.filter(page => page.scrollHeight > EDITOR_A4_HEIGHT + 1);
  tooTall.forEach(tightenPageContentToA4);
  updatePageFooters();
}

function createNewPageAfter(referencePage) {
  const newPage = document.createElement('div');
  newPage.className = 'doc-page-canvas';
  newPage.setAttribute('contenteditable', 'true');
  newPage.setAttribute('spellcheck', 'false');
  newPage.addEventListener('input', handleCanvasInput);
  newPage.addEventListener('keydown', handlePageKeydown);
  newPage.addEventListener('blur', handlePageBlur);
  referencePage.parentNode.insertBefore(newPage, referencePage.nextSibling);
  return newPage;
}

// ===== PAGE FOOTERS =====
function updatePageFooters() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  pages.forEach((page, index) => {
    let footer = page.querySelector('.page-footer-number');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'page-footer-number';
      footer.setAttribute('contenteditable', 'false');
      page.appendChild(footer);
    }
    const _footerText = `Page ${index + 1} of ${pages.length}`;
    // Re-writing identical text still replaces the text node (a DOM mutation that wakes the observers).
    if (footer.textContent !== _footerText) footer.textContent = _footerText;
  });
  if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
}

// ===== FIT EDITOR PAGES TO SCREEN =====
let _fitEditorTimer = null;

function scheduleFitEditor() {
  clearTimeout(_fitEditorTimer);
  _fitEditorTimer = setTimeout(() => {
    try { fitEditorPagesToScreen(); } catch (_) {}
  }, 80);
}

let _lastFitSig = '';
function fitEditorPagesToScreen() {
  if (!docContainer) return;
  // Many code paths call this (view switch x3, resize, ResizeObserver,
  // MutationObserver...). Re-writing identical styles is wasted work on a phone
  // and re-running it mid-scroll caused visible shaking, so bail out when the
  // width, page count and mode are unchanged since the last real fit.
  const _pc = docContainer.querySelectorAll('.doc-page-canvas').length;
  const _sig = [docContainer.clientWidth, _pc, window.innerWidth <= 850 ? 'm' : 'd'].join('|');
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (!pages.length) return;
  // Nothing to do when the width/page count/mode are unchanged AND every page was already fitted for
  // this exact signature. (The old check looked at style.transform, which is always '' on desktop,
  // so on desktop it never skipped and re-wrote every page's styles on each call.) A page created
  // by a new pagination has no mark yet, so it is always fitted.
  if (_sig === _lastFitSig && pages.every(p => p.__fitSig === _sig)) return;
  _lastFitSig = _sig;

  const isNarrow = window.innerWidth <= 850 || (document.documentElement.clientWidth || 0) <= 850;

  if (!isNarrow) {
    pages.forEach(p => {
      p.style.zoom = '';
      p.style.transform = '';
      p.style.transformOrigin = '';
      p.style.margin = '';
      p.style.marginBottom = '30px';
      p.style.marginLeft = 'auto';
      p.style.marginRight = 'auto';
      p.style.width = EDITOR_A4_WIDTH + 'px';
      p.style.height = EDITOR_A4_HEIGHT + 'px';
      p.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
      p.style.minHeight = EDITOR_A4_HEIGHT + 'px';
      p.style.maxWidth = '';
      p.style.marginTop = '';
      p.style.boxSizing = '';
    });
    docContainer.style.overflowX = '';
    docContainer.style.width = '';
    docContainer.style.setProperty('--editor-page-scale', '1');
    docContainer.style.alignItems = 'center';
    pages.forEach(p => { p.__fitSig = _sig; });
    return;
  }

  // ---- Mobile narrow layout ----
  docContainer.style.alignItems = 'flex-start';
  docContainer.style.overflowX = 'hidden';
  docContainer.style.width = '100%';

  // Use the container's CONTENT width (client width minus its padding) and
  // never fit while it is hidden (width 0): a hidden-measure fallback made the
  // first fit differ from later ones, so the page visibly jumped on entry.
  const _cs = getComputedStyle(docContainer);
  const _padX = (parseFloat(_cs.paddingLeft) || 0) + (parseFloat(_cs.paddingRight) || 0);
  if (!docContainer.clientWidth) return;
  const containerWidth = Math.max(1, docContainer.clientWidth - _padX);
  const available = Math.max(1, containerWidth - 4);
  // FIX: the old 0.48 floor made the page 381px wide, wider than a 351px phone (clipped on the right). Always fit the real width.
  const scale = Math.round(Math.min(1, Math.max(0.2, available / EDITOR_A4_WIDTH)) * 1000) / 1000;

  const scaledW = EDITOR_A4_WIDTH * scale;
  const scaledH = EDITOR_A4_HEIGHT * scale;
  const offsetX = Math.max(0, Math.round((containerWidth - scaledW) / 2));
  const gap = Math.max(12, Math.round(16 * scale));

  const marginRightComp = Math.round(EDITOR_A4_WIDTH * (scale - 1));
  const marginBottomComp = Math.round(EDITOR_A4_HEIGHT * (scale - 1) + gap);

  pages.forEach(p => {
    p.style.zoom = '';
    p.style.boxSizing = 'border-box';
    p.style.width = EDITOR_A4_WIDTH + 'px';
    p.style.height = EDITOR_A4_HEIGHT + 'px';
    p.style.minHeight = EDITOR_A4_HEIGHT + 'px';
    p.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
    p.style.maxWidth = 'none';
    p.style.transformOrigin = 'top left';
    p.style.transform = 'scale(' + scale + ')';
    p.style.marginTop = '0';
    p.style.marginLeft = offsetX + 'px';
    p.style.marginRight = marginRightComp + 'px';
    p.style.marginBottom = marginBottomComp + 'px';
  });
  docContainer.style.setProperty('--editor-page-scale', String(scale));
  pages.forEach(p => { p.__fitSig = _sig; });
}

// ---- Attach resize and visibility observers ----
if (!window.__editorFitResizeBound) {
  window.__editorFitResizeBound = true;
  window.addEventListener('resize', scheduleFitEditor, { passive: true });
  window.addEventListener('orientationchange', () => { setTimeout(scheduleFitEditor, 200); }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleFitEditor, { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      setTimeout(scheduleFitEditor, 150);
    }
  }, { passive: true });

  if (docContainer && typeof ResizeObserver === 'function') {
    let _lastObservedW = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round((entries[0] && entries[0].contentRect && entries[0].contentRect.width) || 0);
      if (w > 0 && w !== _lastObservedW) {
        _lastObservedW = w;
        // FIX (mobile shake / jump on entry): when the Editor panel goes from
        // display:none to visible, the pages first paint at full A4 width
        // (794px) and only got scaled ~80ms later by the debounced fit, so
        // the page visibly jumped/wobbled on entry. ResizeObserver callbacks
        // run after layout but BEFORE paint, so fitting right here means the
        // first frame the person sees is already the correctly scaled page.
        // (fitEditorPagesToScreen bails out cheaply when nothing changed.)
        clearTimeout(_fitEditorTimer);
        try { fitEditorPagesToScreen(); } catch (_) {}
      }
    });
    ro.observe(docContainer);
    if (docContainer.parentElement) ro.observe(docContainer.parentElement);
  }

  if (docContainer && typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => scheduleFitEditor());
    mo.observe(docContainer, { childList: true, subtree: true });
  }

  setTimeout(scheduleFitEditor, 50);
  setTimeout(scheduleFitEditor, 300);
  setTimeout(scheduleFitEditor, 1000);
}

// ===== GET PAGE COUNT =====
function getPageCount() {
  if (!docContainer) return 0;
  return docContainer.querySelectorAll('.doc-page-canvas').length;
}

// ===== UPDATE PAGE BY NUMBER =====
function updateSpecificPageByNumber(pageNumber, newHtml, opts) {
  const pageNum = Number.parseInt(pageNumber, 10);
  if (!Number.isInteger(pageNum) || pageNum < 1 || typeof newHtml !== 'string') {
    return false;
  }
  if (!docContainer) return false;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const page = pages[pageNum - 1];
  if (!page) return false;

  try {
    const _saveHist = !opts || opts.saveHistory !== false;
    if (_saveHist) HISTORY.saveState();
    const existingFooter = page.querySelector('.page-footer-number');
    if (existingFooter) existingFooter.remove();

    const cleanHtml = _prepareHTML(newHtml);
    page.innerHTML = cleanHtml;
    if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(page);
    if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(page);

    page.setAttribute('contenteditable', 'true');
    page.setAttribute('spellcheck', 'false');

    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);

    resetPageToA4(page);
    if (page.scrollHeight > EDITOR_A4_HEIGHT + 1) {
      tightenPageContentToA4(page);
    }

    updatePageFooters();
    // Remove any resulting empty trailing pages
    _removeTrailingEmptyPages();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
    if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
    if (_saveHist) HISTORY.saveState();
    return true;
  } catch (error) {
    console.error('updateSpecificPageByNumber failed:', error);
    return false;
  }
}

// ===== INSERT NEW CONTENT RIGHT AFTER A PAGE (used by @Add + page) =====
// Unlike updateSpecificPageByNumber (which squeezes everything back onto ONE
// A4 page), this puts the new material straight after the selected page's
// content and re-paginates, so a long addition flows onto as many following
// pages as it needs. Pages before the insertion point are untouched.
async function insertHtmlAfterPage(pageNumber, newHtml) {
  const n = Number.parseInt(pageNumber, 10);
  if (!docContainer || !Number.isInteger(n) || n < 1 || typeof newHtml !== 'string' || !newHtml.trim()) return false;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (n > pages.length) return false;
  let combined = '';
  pages.forEach((page, i) => {
    if (typeof pageHasContent === 'function' && !pageHasContent(page) && i !== n - 1) return;
    combined += _pageSnapshotHTML(page);   // lossless: the user's own emoji are kept
    if (i === n - 1) combined += '<br>' + newHtml;
  });
  HISTORY.saveState();
  await setDocumentHTMLAndPaginate(combined);
  return true;
}
window.insertHtmlAfterPage = insertHtmlAfterPage;

function updateSpecificPagesByNumber(updates) {
  if (!Array.isArray(updates) || !updates.length) return false;
  if (!docContainer) return false;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const prepared = [];
  const seen = new Set();
  for (const item of updates) {
    const n = parseInt(item && item.page_number, 10);
    if (!Number.isInteger(n) || n < 1 || !pages[n - 1] || typeof item.new_html !== 'string' || seen.has(n)) return false;
    seen.add(n);
    prepared.push({ n, page: pages[n - 1], html: _prepareHTML(item.new_html) });
  }
  try {
    HISTORY.saveState();
    prepared.forEach(({ page, html }) => {
      const footer = page.querySelector('.page-footer-number');
      if (footer) footer.remove();
      page.innerHTML = html;
      page.setAttribute('contenteditable', 'true');
      page.setAttribute('spellcheck', 'false');
      if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(page);
      if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(page);
      if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
      if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
      resetPageToA4(page);
      if (page.scrollHeight > EDITOR_A4_HEIGHT + 1) tightenPageContentToA4(page);
    });
    updatePageFooters();
    _removeTrailingEmptyPages();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
    if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
    HISTORY.saveState();
    return true;
  } catch (e) {
    console.error('updateSpecificPagesByNumber failed:', e);
    return false;
  }
}

// ===== UPDATE SECTION BY HEADING =====
async function updateSpecificSectionByHeading(targetHeading, newHtml) {
  if (typeof targetHeading !== 'string' || !targetHeading.trim() || typeof newHtml !== 'string') {
    return false;
  }
  if (!docContainer) return false;

  const norm = (str) => String(str || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const target = norm(targetHeading);
  const headings = Array.from(docContainer.querySelectorAll('.doc-page-canvas h1, .doc-page-canvas h2, .doc-page-canvas h3'));
  let heading = headings.find(h => norm(h.textContent) === target);
  if (!heading) {
    // Fuzzy match. Ignore empty/very short headings: '' is "included" in every string.
    const candidates = headings.map(h => ({ h, text: norm(h.textContent) }))
      .filter(x => x.text.length >= 3 && (x.text.includes(target) || target.includes(x.text)));
    heading = candidates.sort((a, b) => Math.abs(a.text.length - target.length) - Math.abs(b.text.length - target.length))[0]?.h || null;
  }
  if (!heading) return false;

  try {
    const level = Number(heading.tagName.substring(1));
    const ownerPage = heading.closest('.doc-page-canvas');
    if (!ownerPage) return false;

    // The heading may sit inside a wrapper <div>; work with the wrapper that is a direct child of the page.
    let anchor = heading;
    while (anchor && anchor.parentNode !== ownerPage) anchor = anchor.parentNode;
    if (!anchor) return false;

    const startsNewSection = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      const m = /^H([1-3])$/.exec(node.tagName);
      if (m) return Number(m[1]) <= level;
      if (typeof node.querySelectorAll !== 'function') return false;
      return Array.from(node.querySelectorAll('h1, h2, h3')).some(h => Number(h.tagName[1]) <= level);
    };

    const nodes = [];
    let stop = false;
    const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
    const startPageIndex = pages.indexOf(ownerPage);
    if (startPageIndex < 0) return false;

    for (let pIdx = startPageIndex; pIdx < pages.length && !stop; pIdx++) {
      const page = pages[pIdx];
      const pageNodes = Array.from(page.childNodes);
      const begin = pIdx === startPageIndex ? pageNodes.indexOf(anchor) + 1 : 0;   // indexOf is never -1 now
      for (let i = begin; i < pageNodes.length; i++) {
        const node = pageNodes[i];
        if (startsNewSection(node)) { stop = true; break; }
        if (!(node.nodeType === Node.ELEMENT_NODE && node.classList.contains('page-footer-number'))) nodes.push(node);
      }
    }

    HISTORY.saveState();
    nodes.forEach(node => node.parentNode && node.parentNode.removeChild(node));

    const temp = document.createElement('div');
    temp.innerHTML = _prepareHTML(newHtml);
    const fragment = document.createDocumentFragment();
    Array.from(temp.childNodes).forEach(node => fragment.appendChild(node));

    anchor.parentNode.insertBefore(fragment, anchor.nextSibling);

    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(docContainer);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(docContainer);
    if (typeof paginateDocumentCanvas === 'function') await paginateDocumentCanvas();
    updatePageFooters();
    _removeTrailingEmptyPages();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
    if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
    HISTORY.saveState();
    return true;
  } catch (error) {
    console.error('updateSpecificSectionByHeading failed:', error);
    return false;
  }
}

// ===== PAGE OPERATIONS =====
function getSelectedPage() {
  if (!docContainer) return null;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length === 0) return null;
  if (window.APP_STATE && window.APP_STATE.selectedPage && docContainer.contains(window.APP_STATE.selectedPage)) {
    return window.APP_STATE.selectedPage;
  }
  const activeEl = document.activeElement;
  if (activeEl && activeEl.classList && activeEl.classList.contains('doc-page-canvas')) return activeEl;
  if (activeEl && activeEl.closest && activeEl.closest('.doc-page-canvas')) return activeEl.closest('.doc-page-canvas');
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const node = sel.getRangeAt(0).startContainer;
    if (node) {
      const page = node.nodeType === 3 ? node.parentElement.closest('.doc-page-canvas') : node.closest('.doc-page-canvas');
      if (page) return page;
    }
  }
  return pages[pages.length - 1];
}

function getPageIndex(page) {
  if (!docContainer) return -1;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  return pages.indexOf(page);
}

function addPageAfterCurrent() {
  const currentPage = getSelectedPage();
  if (!currentPage) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ No page selected.");
    return;
  }
  HISTORY.saveState();
  const newPage = createNewPageAfter(currentPage);
  newPage.focus();
  const range = document.createRange();
  range.selectNodeContents(newPage);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  updatePageFooters();
  if (typeof displayToastNotification === 'function') displayToastNotification("✅ Page added after current page.");
  HISTORY.saveState();
}

function removeCurrentPage() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length <= 1) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ Cannot remove the only page.");
    return;
  }
  const currentPage = getSelectedPage();
  if (!currentPage) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ No page selected to remove.");
    return;
  }
  if (!confirm(`Remove page ${getPageIndex(currentPage) + 1}? You can undo this with Ctrl+Z.`)) return;
  HISTORY.saveState();
  const index = getPageIndex(currentPage);
  const nextPage = pages[index + 1] || pages[index - 1];
  currentPage.remove();
  if (nextPage) {
    nextPage.focus();
    const range = document.createRange();
    range.selectNodeContents(nextPage);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  updatePageFooters();
  _removeTrailingEmptyPages();
  if (typeof displayToastNotification === 'function') displayToastNotification(`🗑️ Page ${index + 1} removed.`);
  HISTORY.saveState();
}

async function paginateDocumentCanvas() {
  // Lossless snapshot (the export view strips emoji and drops blank pages). An empty document or
  // one that holds only the placeholder yields '' and is skipped.
  const currentHTML = getCanvasSnapshotHTML();
  if (!currentHTML) return;
  // This pass only COUNTS top-level blocks to choose the pagination path; the real pagination below
  // does the full math processing itself, so doing it here as well was a second, wasted full pass.
  const tempSource = document.createElement('div');
  tempSource.innerHTML = _safeHTML(currentHTML);
  const nodes = flattenContentTopLevelNodes(tempSource);
  if (nodes.length > PAGINATION_CHUNK_SIZE * 2 && typeof paginateDocumentCanvasAsync === 'function') {
    await paginateDocumentCanvasAsync(currentHTML);
  } else {
    await setDocumentHTMLAndPaginate(currentHTML);   // awaited: callers continue only once pages exist
  }
  if (typeof displayToastNotification === 'function') displayToastNotification("📄 Document Paginated!");
}

// ===== PROGRESSIVE PAGINATE (toolbar "Paginate" button) =====
// Every click raises a compaction level (1..PAGINATE_COMPACT_MAX): spacing, type,
// tables and figures get tighter and typography gets cleaner (see styles.css,
// html[data-paginate-compact]). Internal re-pagination (typing, reflow, AI edits)
// still calls paginateDocumentCanvas() and never changes the level.
const PAGINATE_COMPACT_MAX = 6;
let paginateCompactLevel = 0;
let _paginateProgressiveBusy = false;

function _setPaginateCompactLevel(n) {
  paginateCompactLevel = Math.max(0, Math.min(PAGINATE_COMPACT_MAX, n | 0));
  const root = document.documentElement;
  if (paginateCompactLevel > 0) root.setAttribute('data-paginate-compact', String(paginateCompactLevel));
  else root.removeAttribute('data-paginate-compact');
  document.querySelectorAll('[data-paginate-btn]').forEach(b => {
    b.textContent = paginateCompactLevel > 0 ? `Paginate ${paginateCompactLevel}/${PAGINATE_COMPACT_MAX}` : 'Paginate';
    b.classList.toggle('paginate-active', paginateCompactLevel > 0);
    b.title = paginateCompactLevel >= PAGINATE_COMPACT_MAX
      ? 'Maximum compaction reached'
      : 'Click again to compact and polish the layout further';
  });
  document.querySelectorAll('[data-paginate-reset]').forEach(b => b.classList.toggle('show', paginateCompactLevel > 0));
}

async function _repaginateCurrentDocument() {
  const html = getCanvasSnapshotHTML();
  if (!html) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = _safeHTML(html); // count only — see paginateDocumentCanvas()
  const nodes = flattenContentTopLevelNodes(tmp);
  if (nodes.length > PAGINATION_CHUNK_SIZE * 2 && typeof paginateDocumentCanvasAsync === 'function') {
    await paginateDocumentCanvasAsync(html);
  } else {
    await setDocumentHTMLAndPaginate(html);
  }
  return true;
}

// Compact-level CSS for standalone documents (the True-PDF preview/print iframe is a
// separate document, so it never sees styles.css's html[data-paginate-compact] rules).
// Returns '' at level 0. Must stay in sync with the level table in styles.css.
const PAGINATE_COMPACT_LEVELS = {
  1: { fs: 12,   lh: 1.34, pmb: 6,   h1: 21, h1mb: 8, h2: 15.5, h2mt: 10, h2mb: 5,   h3: 12.5, h3mt: 8, h3mb: 3,   lmt: 5, lmb: 6, li: 2,   tm: 8, pad: '5px 7px', tf: 98, fz: 1 },
  2: { fs: 11.8, lh: 1.31, pmb: 5,   h1: 20, h1mb: 7, h2: 15,   h2mt: 8,  h2mb: 4,   h3: 12.5, h3mt: 7, h3mb: 3,   lmt: 4, lmb: 5, li: 1.5, tm: 7, pad: '4px 6px', tf: 96, fz: 0.97 },
  3: { fs: 11.5, lh: 1.28, pmb: 4.5, h1: 19, h1mb: 6, h2: 14.5, h2mt: 7,  h2mb: 3.5, h3: 12,   h3mt: 6, h3mb: 2.5, lmt: 3, lmb: 4, li: 1,   tm: 6, pad: '3px 6px', tf: 94, fz: 0.94 },
  4: { fs: 11.2, lh: 1.25, pmb: 4,   h1: 18, h1mb: 5, h2: 14,   h2mt: 6,  h2mb: 3,   h3: 12,   h3mt: 5, h3mb: 2,   lmt: 3, lmb: 3, li: 1,   tm: 5, pad: '3px 5px', tf: 92, fz: 0.90 },
  5: { fs: 10.8, lh: 1.22, pmb: 3,   h1: 17, h1mb: 4, h2: 13.5, h2mt: 5,  h2mb: 2.5, h3: 11.5, h3mt: 4, h3mb: 2,   lmt: 2, lmb: 2, li: 0.5, tm: 4, pad: '2px 4px', tf: 90, fz: 0.86 },
  6: { fs: 10.5, lh: 1.20, pmb: 2.5, h1: 16, h1mb: 4, h2: 13,   h2mt: 4,  h2mb: 2,   h3: 11.5, h3mt: 3, h3mb: 1.5, lmt: 2, lmb: 2, li: 0,   tm: 3, pad: '2px 4px', tf: 88, fz: 0.82 }
};

function getPaginateCompactLevel() { return paginateCompactLevel || 0; }

function getPaginateCompactCSS(scope) {
  const v = PAGINATE_COMPACT_LEVELS[paginateCompactLevel];
  if (!v) return '';
  const s = scope || '.pdf-page';
  return `
      ${s} { font-size:${v.fs}pt !important; }
      ${s} p { margin-bottom:${v.pmb}pt !important; line-height:${v.lh} !important; }
      ${s} li { margin-top:0 !important; margin-bottom:${v.li}pt !important; line-height:${v.lh} !important; }
      ${s} ul, ${s} ol { margin-top:${v.lmt}pt !important; margin-bottom:${v.lmb}pt !important; }
      ${s} h1 { font-size:${v.h1}pt !important; margin-bottom:${v.h1mb}pt !important; }
      ${s} h2 { font-size:${v.h2}pt !important; margin-top:${v.h2mt}pt !important; margin-bottom:${v.h2mb}pt !important; }
      ${s} h3 { font-size:${v.h3}pt !important; margin-top:${v.h3mt}pt !important; margin-bottom:${v.h3mb}pt !important; }
      ${s} table { margin:${v.tm}pt 0 !important; font-size:${v.tf}% !important; }
      ${s} table th, ${s} table td { padding:${v.pad} !important; }
      ${s} figure.figure-pro { zoom:${v.fz}; }
      ${paginateCompactLevel >= 3 ? `${s} p:not([style*="text-align"]) { text-align:justify; text-justify:inter-word; }` : ''}
  `;
}
window.getPaginateCompactCSS = getPaginateCompactCSS;
window.getPaginateCompactLevel = getPaginateCompactLevel;

async function paginateDocumentProgressive() {
  if (_paginateProgressiveBusy || !docContainer) return;
  const pagesOf = () => docContainer.querySelectorAll('.doc-page-canvas').length;
  const before = pagesOf();
  const wasMax = paginateCompactLevel >= PAGINATE_COMPACT_MAX;
  _paginateProgressiveBusy = true;
  document.querySelectorAll('[data-paginate-btn]').forEach(b => { b.disabled = true; });
  try {
    if (!wasMax) _setPaginateCompactLevel(paginateCompactLevel + 1);
    const ok = await _repaginateCurrentDocument();
    if (!ok) { _setPaginateCompactLevel(paginateCompactLevel - (wasMax ? 0 : 1)); return; }
    const after = pagesOf();
    if (typeof displayToastNotification === 'function') {
      const lvl = `${paginateCompactLevel}/${PAGINATE_COMPACT_MAX}`;
      displayToastNotification(wasMax
        ? `📄 সর্বোচ্চ সংকুচিত (${lvl}) — ${after} পেজ। আগের অবস্থায় ফিরতে ↺ চাপুন`
        : (after < before ? `📄 লেভেল ${lvl}: ${before} → ${after} পেজ` : `📄 লেভেল ${lvl}: ${after} পেজ, লেআউট আরও গোছানো হলো`));
    }
  } catch (err) {
    console.error('[paginateDocumentProgressive]', err);
    if (!wasMax && paginateCompactLevel > 0) _setPaginateCompactLevel(paginateCompactLevel - 1);   // roll back the level that was never applied
  } finally {
    _paginateProgressiveBusy = false;
    document.querySelectorAll('[data-paginate-btn]').forEach(b => { b.disabled = false; });
  }
}

async function resetPaginateCompact() {
  if (_paginateProgressiveBusy || paginateCompactLevel === 0) return;
  _paginateProgressiveBusy = true;
  try {
    _setPaginateCompactLevel(0);
    await _repaginateCurrentDocument();
    if (typeof displayToastNotification === 'function') displayToastNotification('📄 স্বাভাবিক লেআউটে ফেরানো হয়েছে');
  } finally { _paginateProgressiveBusy = false; }
}

window.paginateDocumentProgressive = paginateDocumentProgressive;
window.resetPaginateCompact = resetPaginateCompact;

// ===== GET PAGE RANGE CONTEXT =====
function convertBengaliDigitsToEnglish(str) {
  const bengaliDigits = '০১২৩৪৫৬৭৮৯';
  return str.replace(/[০-৯]/g, d => String(bengaliDigits.indexOf(d)));
}

function detectRequestedPageNumber(promptText) {
  if (!promptText) return null;
  const normalized = convertBengaliDigitsToEnglish(promptText);
  const patterns = [
    /\bpage\s*(?:number|no\.?|#)?\s*(\d+)\b/i,
    /(\d+)\s*(?:নম্বর|নং)?\s*(?:পেজ|পৃষ্ঠা|পাতা)/,
    /(?:পেজ|পৃষ্ঠা|পাতা)\s*(?:নম্বর|নং)?\s*(\d+)/
  ];
  for (const re of patterns) {
    const m = normalized.match(re);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

function getPageRangeContext(pageNumber) {
  if (!docContainer) return null;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const totalPages = pages.length;
  if (totalPages === 0 || pageNumber < 1 || pageNumber > totalPages) return null;
  const startIdx = Math.max(1, pageNumber - 1);
  const endIdx = Math.min(totalPages, pageNumber + 1);
  let contextString = '';
  for (let i = startIdx; i <= endIdx; i++) {
    const clone = pages[i - 1].cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    const cleanHTML = typeof convertKatexSpansToLatexSource === 'function' ? convertKatexSpansToLatexSource(clone.innerHTML) : clone.innerHTML;
    contextString += `\n[PAGE ${i}${i === pageNumber ? ' — TARGET, EDIT THIS ONE' : ' — context only, do not rewrite'}]\n${cleanHTML}\n[/PAGE ${i}]\n`;
  }
  return { contextString, startIdx, endIdx, totalPages, targetPage: pageNumber };
}

function getMultiPageEditContext(pageNumbers) {
  if (!docContainer) return null;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const totalPages = pages.length;
  const nums = [...new Set((pageNumbers || []).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= totalPages))].sort((a, b) => a - b);
  if (!nums.length) return null;
  const selected = new Set(nums);
  let contextString = '';
  nums.forEach(n => {
    const clone = pages[n - 1].cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    const cleanHTML = typeof convertKatexSpansToLatexSource === 'function' ? convertKatexSpansToLatexSource(clone.innerHTML) : clone.innerHTML;
    contextString += `\n[PAGE ${n} — TARGET, EDIT ONLY THIS PAGE]\n${cleanHTML}\n[/PAGE ${n}]\n`;
    for (const neighbor of [n - 1, n + 1]) {
      if (neighbor >= 1 && neighbor <= totalPages && !selected.has(neighbor)) {
        const nc = pages[neighbor - 1].cloneNode(true);
        nc.querySelectorAll('.page-footer-number').forEach(f => f.remove());
        contextString += `\n[PAGE ${neighbor} — CONTEXT ONLY, DO NOT MODIFY]\n${typeof convertKatexSpansToLatexSource === 'function' ? convertKatexSpansToLatexSource(nc.innerHTML) : nc.innerHTML}\n[/PAGE ${neighbor}]\n`;
      }
    }
  });
  return { contextString, totalPages, targetPages: nums };
}

// ===== GET EXISTING HEADINGS =====
function getExistingHeadings(options = {}) {
  const { unique = true } = options;
  if (!docContainer) return [];
  const headings = [];
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  pages.forEach(page => {
    page.querySelectorAll('h1, h2, h3').forEach(h => {
      const t = h.textContent.trim();
      if (t) headings.push(t);
    });
  });
  if (!unique) return headings;
  const seen = new Set();
  return headings.filter(h => {
    const key = h.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function checkForDuplicateHeadings() {
  const headings = getExistingHeadings({ unique: false });
  const seen = new Map();
  headings.forEach(h => {
    const key = h.toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  const duplicates = [];
  for (const [key, count] of seen.entries()) {
    if (count > 1) {
      const original = headings.find(h => h.toLowerCase() === key);
      duplicates.push(original);
    }
  }
  if (duplicates.length > 0) {
    const msg = `⚠️ Possible duplicate section(s) detected: "${duplicates.slice(0, 3).join('", "')}"${duplicates.length > 3 ? ' and more' : ''} — please review.`;
    if (typeof displayToastNotification === 'function') displayToastNotification(msg);
  }
}

// ===== DOCUMENT PROFESSIONALIZATION =====
function professionalizeDocumentHTML(rawHtml) {
  if (!rawHtml) return '';
  const temp = document.createElement('div');
  temp.innerHTML = _safeHTML(rawHtml);
  if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(temp);
  if (typeof cleanupEmptyVisualContainers === 'function') cleanupEmptyVisualContainers(temp);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(temp);
  return temp.innerHTML;
}

// ===== EXECUTE EDITOR COMMAND =====
function executeEditorCommand(command, value = null) {
  document.execCommand(command, false, value);
  updateToolbarButtonStates();
  debouncedAutoSaveAndPaginate();
}

// ===== KEEP DOCUMENT SELECTION ALIVE WHEN CLICKING RIBBON BUTTONS =====
// Clicking anything outside the contenteditable page — including a plain
// toolbar <button> — fires a mousedown first, and a browser's default
// mousedown behavior on a click target that isn't inside the current
// selection is to collapse that selection before the click (and the
// button's onclick handler) ever runs. That's why a single click on Bold/
// Italic/justify/etc. was wiping out whatever text had been selected in
// the document, so the command then had nothing left to act on.
// preventDefault() on mousedown stops the browser from touching focus/
// selection at all, so the selection the user made in the document is
// still fully intact by the time the button's click handler executes.
// Only plain <button>s are covered here — <select> and <input type="color">
// inside the toolbar still need their own default mousedown behavior to
// open (the color inputs already have their own selection save/restore
// fix above/below for that reason).
(function setupToolbarSelectionPreservation() {
  const toolbar = document.getElementById('editor-toolbar');
  if (!toolbar) return;
  toolbar.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button');
    if (btn) e.preventDefault();
  });
})();

// ===== COLOR PICKER SELECTION FIX =====
// A native <input type="color"> steals focus (and with it the browser's
// text selection inside the contenteditable page) the instant it's
// clicked/opened — well before its change event ever fires. By the time
// foreColor/hiliteColor actually ran, the document's selection was already
// gone, so execCommand had nothing left to color — which is why the color
// buttons looked like they "didn't work". Fix: capture the selection on
// mousedown (before the native picker takes focus) and restore it right
// before applying the color command.
let _savedEditorSelectionRange = null;

function saveEditorSelectionForColorPicker() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) { _savedEditorSelectionRange = null; return; }
  const range = selection.getRangeAt(0);
  const container = range.startContainer.nodeType === 3 ? range.startContainer.parentNode : range.startContainer;
  const page = container && container.closest ? container.closest('.doc-page-canvas') : null;
  _savedEditorSelectionRange = page ? range.cloneRange() : null;
}

function applyColorCommand(command, value) {
  // The saved range is useless once a re-pagination replaced its nodes.
  if (_savedEditorSelectionRange && !(_savedEditorSelectionRange.startContainer.isConnected && _savedEditorSelectionRange.endContainer.isConnected)) {
    _savedEditorSelectionRange = null;
  }
  if (_savedEditorSelectionRange) {
    const anchorNode = _savedEditorSelectionRange.startContainer;
    const anchorEl = anchorNode.nodeType === 3 ? anchorNode.parentNode : anchorNode;
    const page = anchorEl && anchorEl.closest ? anchorEl.closest('.doc-page-canvas') : null;
    if (page && typeof page.focus === 'function') page.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(_savedEditorSelectionRange);
  }
  executeEditorCommand(command, value);
  _savedEditorSelectionRange = null;
}
window.saveEditorSelectionForColorPicker = saveEditorSelectionForColorPicker;
window.applyColorCommand = applyColorCommand;

// ===== INCREMENTAL FONT SIZE (A+ / A-) =====
// The old font-size dropdown only offers a few fixed legacy steps. These
// buttons instead nudge the CURRENTLY SELECTED text's actual size up/down
// by a few pixels every click, so repeated clicking keeps growing/shrinking
// it smoothly rather than jumping between a few presets.
const FONT_SIZE_STEP_PX = 2;
const FONT_SIZE_MIN_PX = 8;
const FONT_SIZE_MAX_PX = 96;

function stepSelectedFontSize(deltaPx) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const anchorNode = range.startContainer;
  const anchorEl = anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode;
  const page = anchorEl && anchorEl.closest ? anchorEl.closest('.doc-page-canvas') : null;
  if (!page) return;

  // Measure the CURRENT size before we touch anything — wrapping with
  // execCommand('fontSize','7') below would otherwise make every run jump
  // to the browser's huge "size 7" default first, corrupting the reading.
  const currentPx = parseFloat(getComputedStyle(anchorEl).fontSize) || 12;
  const targetPx = Math.max(FONT_SIZE_MIN_PX, Math.min(FONT_SIZE_MAX_PX, Math.round(currentPx + deltaPx)));

  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  Array.from(page.querySelectorAll('font[size="7"]')).forEach(el => {
    el.removeAttribute('size');
    el.style.fontSize = targetPx + 'px';
  });

  updateToolbarButtonStates();
  debouncedAutoSaveAndPaginate();
}

function increaseSelectedFontSize() { stepSelectedFontSize(FONT_SIZE_STEP_PX); }
function decreaseSelectedFontSize() { stepSelectedFontSize(-FONT_SIZE_STEP_PX); }
window.increaseSelectedFontSize = increaseSelectedFontSize;
window.decreaseSelectedFontSize = decreaseSelectedFontSize;

function updateToolbarButtonStates() {
  ['bold', 'italic', 'underline', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].forEach(cmd => {
    const btn = document.getElementById('btn-' + cmd);
    let active = false;
    try { active = document.queryCommandState(cmd); } catch (_) { /* unsupported */ }
    if (btn) btn.classList.toggle('active', active);
  });
}
if (docContainer) {
  docContainer.addEventListener('keyup', updateToolbarButtonStates);
  docContainer.addEventListener('mouseup', updateToolbarButtonStates);
  // Touch selection (mobile) fires neither keyup nor mouseup.
  let _toolbarRaf = 0;
  document.addEventListener('selectionchange', () => {
    if (_toolbarRaf) return;
    _toolbarRaf = requestAnimationFrame(() => {
      _toolbarRaf = 0;
      const sel = window.getSelection();
      if (sel && sel.rangeCount && docContainer.contains(sel.anchorNode)) updateToolbarButtonStates();
    });
  });
}

// ===== DIAGRAM CANDIDATES =====
function getDiagramCandidates(pageContext = null) {
  if (!docContainer) return [];
  let roots = [];
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pageContext && Number.isFinite(pageContext.targetPage)) {
    const page = pages[pageContext.targetPage - 1];
    if (page) roots = Array.from(page.querySelectorAll('.fc-wrapper, .figure-pro'));
  }
  if (!roots.length) roots = Array.from(docContainer.querySelectorAll('.fc-wrapper, .figure-pro'));
  return roots.map((el, index) => {
    const title = el.querySelector('.fc-title, .figure-title, .figure-caption')?.textContent?.trim() || `Diagram ${index + 1}`;
    const ownerPage = el.closest('.doc-page-canvas');
    const pageNumber = ownerPage ? pages.indexOf(ownerPage) + 1 : null;
    let heading = '';
    let n = el.previousElementSibling;
    while (n) {
      if (/^H[1-3]$/.test(n.tagName)) { heading = n.textContent.trim(); break; }
      n = n.previousElementSibling;
    }
    return { index, title, pageNumber, heading, html: el.outerHTML, element: el };
  });
}

function extractDiagramWrapperFromAIHTML(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  const temp = document.createElement('div');
  temp.innerHTML = _safeHTML(rawHtml.trim());
  const wrapper = temp.querySelector('.fc-wrapper, .figure-pro');
  if (wrapper) return wrapper.outerHTML;
  const svg = temp.querySelector('svg');
  if (svg) {
    const wrap = document.createElement('div');
    wrap.className = 'fc-wrapper';
    wrap.innerHTML = '<div class="fc-svg-wrapper"></div>';
    wrap.querySelector('.fc-svg-wrapper').appendChild(svg);
    return wrap.outerHTML;
  }
  return '';
}

async function replaceExistingDiagramBlock(targetElement, newHtml) {
  const wrapperHTML = extractDiagramWrapperFromAIHTML(newHtml);
  if (!targetElement || !wrapperHTML || !targetElement.parentNode) return false;
  const temp = document.createElement('div');
  temp.innerHTML = _prepareHTML(wrapperHTML);
  const replacement = temp.querySelector('.fc-wrapper, .figure-pro');
  if (!replacement) return false;
  targetElement.parentNode.replaceChild(replacement, targetElement);
  if (typeof cleanupEmptyVisualContainers === 'function') cleanupEmptyVisualContainers(docContainer);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(docContainer);
  if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(docContainer);
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(docContainer);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(docContainer);
  await paginateDocumentCanvas();
  updatePageFooters();
  _removeTrailingEmptyPages();
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
  return true;
}

function rankDiagramCandidatesForPrompt(candidates, promptText, pageContext = null) {
  const p = String(promptText || '').toLowerCase();
  const tokens = p.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);
  return candidates.map((d, i) => {
    let score = 0;
    if (pageContext && d.pageNumber === pageContext.targetPage) score += 1000;
    const hay = `${d.title} ${d.heading}`.toLowerCase();
    tokens.forEach(t => { if (hay.includes(t)) score += 20; });
    if (/diagram|figure|flowchart|concept map|mind map|schematic|chart|চিত্র|ডায়াগ্রাম|ডায়াগ্রাম|ফিগার|ফ্লোচার্ট/i.test(p)) score += 5;
    score -= i * 0.01;
    return { ...d, _score: score };
  }).sort((a, b) => b._score - a._score);
}

function validateDiagramReplacementAgainstOriginal(originalHtml, replacementHtml, promptText) {
  const tempOld = document.createElement('div');
  const tempNew = document.createElement('div');
  tempOld.innerHTML = _safeHTML(originalHtml || '');
  tempNew.innerHTML = _safeHTML(replacementHtml || '');
  const oldSvg = tempOld.querySelector('svg');
  const newSvg = tempNew.querySelector('svg');
  if (!newSvg) return { ok: false, reason: 'replacement has no SVG' };
  const oldLabels = Array.from(tempOld.querySelectorAll('svg text, .fc-node-text, .fc-node-note')).map(x => x.textContent.trim()).filter(Boolean);
  const newText = (newSvg.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const explicitChange = /(?:rename|change label|replace label|remove node|delete node|change value|নাম বদল|লেবেল বদল|মুছে|বাদ)/i.test(promptText || '');
  if (!explicitChange && oldLabels.length >= 3) {
    const preserved = oldLabels.filter(t => newText.includes(t.replace(/\s+/g, ' ').toLowerCase())).length;
    const ratio = preserved / oldLabels.length;
    if (ratio < 0.65) return { ok: false, reason: `only ${Math.round(ratio * 100)}% of original labels preserved` };
  }
  return { ok: true };
}

function isDiagramEditRequest(promptText, intentPayload) {
  // Diagrams are permanently disabled across the app (product decision) —
  // the specialized diagram edit/redesign pipeline below
  // (getDiagramCandidates / handleDiagramEditOrRefine) would generate a
  // brand-new hand-drawn diagram, which is exactly what's banned, so this
  // detector is hard-wired off. A pre-existing diagram left over in an
  // older document can still be deleted or rewritten as text through the
  // normal edit flow — it just no longer routes through the
  // diagram-specific regeneration pipeline.
  return false;
}

// ===== BEAUTIFY HELPERS =====
function textContentLengthFromHTML(html) {
  const t = document.createElement('div');
  t.innerHTML = _safeHTML(html || '');
  return (t.textContent || '').replace(/\s+/g, ' ').trim().length;
}

function beautifyOutputLooksSafe(sourceHtml, outputHtml) {
  if (!outputHtml || !String(outputHtml).trim()) return false;
  const srcText = textContentLengthFromHTML(sourceHtml);
  const outText = textContentLengthFromHTML(outputHtml);
  if (srcText < 120) return outText > 0;
  return outText >= Math.floor(srcText * 0.82);
}

function extractBeautifyHtmlFromAIResponse(rawContent) {
  if (!rawContent) return '';
  const parsed = typeof safeParseAIJson === 'function' ? safeParseAIJson(rawContent, null) : null;
  if (parsed && typeof parsed.html_content === 'string' && parsed.html_content.trim()) {
    return parsed.html_content.trim();
  }
  const m = String(rawContent).match(/"html_content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m && m[1]) {
    try {
      return JSON.parse('"' + m[1] + '"');
    } catch (_) {
      // Single-pass JSON unescape. The old chain of .replace(/\\r/g,'') etc. ran over the
      // text several times and also matched the "\r" of LaTeX commands, so "\\right]"
      // became "\ight]" (and \theta/\times/\neq were corrupted too) - which is how matrix
      // brackets ended up broken or collapsed to plain [ ].
      return m[1].replace(/\\(u[0-9a-fA-F]{4}|["\\\/bfnrt])/g, (full, k) => {
        switch (k[0]) {
          case 'n': return '\n';
          case 'r': return '';
          case 't': return '\t';
          case 'b': return '\b';
          case 'f': return '\f';
          case 'u': return String.fromCharCode(parseInt(k.slice(1), 16));
          default: return k;   // \\  \"  \/
        }
      });
    }
  }
  const trimmed = String(rawContent).trim();
  if (/<(?:h[1-6]|p|div|table|ul|ol|section)\b/i.test(trimmed)) {
    return trimmed.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return '';
}

function localBeautifyHTML(rawHtml) {
  if (!rawHtml) return '';
  const temp = document.createElement('div');
  temp.innerHTML = _safeHTML(rawHtml);

  if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(temp);
  if (typeof cleanupEmptyVisualContainers === 'function') cleanupEmptyVisualContainers(temp);

  temp.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach(el => {
    if (!(el.textContent || '').trim() && !_elementHasVisualContent(el) && !el.querySelector('br, hr, .manual-page-break, .blank-page-spacer')) {
      // keep intentional page breaks / spacers and styled bars, lines and boxes
      const decorative = el.classList.contains('manual-page-break') || el.classList.contains('blank-page-spacer') ||
        _isDesignedBoxBlock(el) || /border|background|height/i.test(el.getAttribute('style') || '');
      if (!decorative) el.remove();
    }
  });

  temp.querySelectorAll('p > h1, p > h2, p > h3, p > h4').forEach(h => {
    const parent = h.parentElement;
    if (parent) parent.parentNode.insertBefore(h, parent);
  });

  temp.querySelectorAll('table').forEach(table => {
    table.style.width = table.style.width || '100%';
    table.style.borderCollapse = 'collapse';
    // Only add default borders to tables that have none (don't override borderless/layout tables).
    const _hasBorders = table.hasAttribute('border') || !!table.style.border || !!table.querySelector('[style*="border"]');
    table.querySelectorAll('th, td').forEach(cell => {
      if (!_hasBorders && !cell.style.border) cell.style.border = '1px solid #cbd5e1';
      if (!cell.style.padding) cell.style.padding = '6px 8px';
    });
  });

  temp.querySelectorAll('ul, ol').forEach(list => {
    if (!list.style.margin) list.style.margin = '8px 0 12px 1.2em';
  });

  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(temp);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(temp);

  return temp.innerHTML;
}

function getBeautifySourceHTML() {
  if (!docContainer) return '';
  const parts = [];
  Array.from(docContainer.querySelectorAll('.doc-page-canvas')).forEach(page => {
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(clone);
    let html = clone.innerHTML || '';
    if (typeof convertKatexSpansToLatexSource === 'function') {
      html = convertKatexSpansToLatexSource(html);
    }
    const textLen = (clone.textContent || '').replace(/\s+/g, ' ').trim().length;
    if (textLen >= 2 || _elementHasVisualContent(clone)) {
      parts.push(html);
    }
  });
  return parts.join('\n');
}

function getBeautifyMaxTokens() {
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.PDF_TOKEN_BUDGETS) {
    const b = APP_CONFIG.PDF_TOKEN_BUDGETS;
    return b.BEAUTIFY || b.LONG_DIRECT || b.DEFAULT_SINGLE || 64000;
  }
  return 64000;
}

function detectOutputLanguage(promptText) {
  const text = (promptText || '').toString();
  if (/\b(in\s+english|everything\s+(should\s+be\s+)?in\s+english|english\s+only|reply\s+in\s+english|write\s+in\s+english)\b/i.test(text)) return 'en';
  if (/(বাংলায়|বাংলা\s*ভাষায়)/i.test(text)) return 'bn';
  const bengaliChars = (text.match(/[\u0980-\u09FF]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  return bengaliChars > latinChars ? 'bn' : 'en';
}

// ===== DETECT BROKEN PAGES =====
function getBrokenPages() {
  const container = docContainer || document.getElementById('document-view-container');
  if (!container) return [];
  const pages = Array.from(container.querySelectorAll('.doc-page-canvas'));
  const brokenIndices = [];
  pages.forEach((page, index) => {
    const brokenEquations = typeof findBrokenEquations === 'function' ? findBrokenEquations(page) : [];
    const hasBrokenKatex = page.querySelectorAll('.katex-eq.katex-render-failed, .katex-eq[data-render-pending="true"]').length > 0;
    // pageHasContent() ignores the "Page x of y" footer (page.innerText included it, so a page was never "empty").
    const isEmpty = pages.length > 1 && !pageHasContent(page);
    if (brokenEquations.length > 0 || hasBrokenKatex || isEmpty) {
      brokenIndices.push(index);
    }
  });
  return brokenIndices;
}

// ===== FIX BROKEN PAGES WITH AI =====
async function fixBrokenPagesWithAI(pageIndices, modelsUsedSet) {
  const container = document.getElementById('document-view-container');
  if (!container || !pageIndices.length) return false;
  const pages = Array.from(container.querySelectorAll('.doc-page-canvas'));
  const totalPages = pages.length;

  const pageData = pageIndices.filter(idx => Number.isInteger(idx) && pages[idx]).map(idx => {
    const page = pages[idx];
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    let html = clone.innerHTML;
    // send LaTeX source, not the (huge) rendered KaTeX markup
    if (typeof convertKatexSpansToLatexSource === 'function') html = convertKatexSpansToLatexSource(html);
    return { index: idx, html, originalPage: page };
  });
  if (!pageData.length) return false;

  const prompt =
    `You are an expert LaTeX/KaTeX error fixer. The following are specific pages from a document that contain rendering errors (failed equations, malformed LaTeX, or empty content). 
Your task is to correct ONLY the LaTeX/KaTeX syntax and ensure all equations render properly. 
Preserve ALL other content, text, structure, and formatting exactly as-is. Do not add, remove, or modify any non-LaTeX content.
For each page, return the corrected HTML. 
Output MUST be a JSON array where each element has "page_index" (0-based index) and "fixed_html" (the corrected HTML fragment for that page).
Example: [{"page_index":0,"fixed_html":"<p>Corrected content...</p>"}]
Return ONLY the JSON array, no other text.`;

  let userContent = `Fix the following pages:\n\n`;
  pageData.forEach(({ index, html }) => {
    userContent += `--- PAGE ${index + 1} (index ${index}) ---\n${html}\n\n`;
  });

  try {
    const result = await callAIAPI([
      { role: 'system', content: prompt },
      { role: 'user', content: userContent }
    ], { forceJson: true, modelsUsedSet: modelsUsedSet });

    const parsed = safeParseAIJson(result.content, null);
    if (!parsed || !Array.isArray(parsed)) {
      console.warn('AI response for fixBrokenPages was not a valid JSON array.');
      return false;
    }

    HISTORY.saveState();   // one undo step for the whole batch
    let applied = 0;
    for (const item of parsed) {
      const idx = parseInt(item.page_index, 10);
      if (isNaN(idx) || idx < 0 || idx >= pages.length) continue;
      const fixedHtml = item.fixed_html;
      if (typeof fixedHtml !== 'string' || !fixedHtml.trim()) continue;

      const pageNum = idx + 1;
      const success = updateSpecificPageByNumber(pageNum, fixedHtml, { saveHistory: false });
      if (success) applied++;
    }

    if (applied > 0) {
      HISTORY.saveState();
      if (typeof displayToastNotification === 'function') {
        displayToastNotification(`✅ Fixed ${applied} page(s) with AI.`);
      }
      return true;
    } else {
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('⚠️ AI could not fix any broken pages.');
      }
      return false;
    }
  } catch (error) {
    console.error('fixBrokenPagesWithAI error:', error);
    if (typeof displayToastNotification === 'function') {
      displayToastNotification('Error fixing pages: ' + (error.message || 'unknown'));
    }
    return false;
  }
}

// ===== BEAUTIFY DOCUMENT =====
async function beautifyDocument(options = {}) {
  const currentFullHTML = typeof getCanvasSnapshotHTML === 'function' ? getCanvasSnapshotHTML() : '';
  if (!currentFullHTML) {
    if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ Document is empty.');
    return;
  }
  if (window.APP_STATE && window.APP_STATE.isAIGenerating && !options.allowDuringAIGeneration) {
    if (typeof displayToastNotification === 'function') displayToastNotification('⏳ Please wait for the current AI task to finish first.');
    return;
  }

  let hasAIModel = false;
  try {
    if (typeof getActiveAIModel === 'function') hasAIModel = !!getActiveAIModel();
  } catch (_) {}

  const requestSessionId = window.APP_STATE?.activeSessionId;
  if (window.APP_STATE) window.APP_STATE.isAIGenerating = true;
  const sendBtn = document.getElementById('send-message-btn');
  if (sendBtn) sendBtn.disabled = true;
  const isMonochromeMode = document.body.classList.contains('photocopy-mode');
  const modelsUsed = new Set();

  const applyResult = async (html, toastMsg, chatMsg) => {
    if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
    if (typeof setDocumentHTMLAndPaginate === 'function') await setDocumentHTMLAndPaginate(html, false);
    if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
    if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(200);
    if (typeof ProgressUI !== 'undefined' && ProgressUI.finish) ProgressUI.finish();
    setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 150);
    if (toastMsg && typeof displayToastNotification === 'function') displayToastNotification(toastMsg);
    if (chatMsg && typeof appendChatMessageToUI === 'function') appendChatMessageToUI('ai', chatMsg);
  };

  const brokenIndices = getBrokenPages();
  const totalPages = document.getElementById('document-view-container')?.querySelectorAll('.doc-page-canvas').length || 0;

  if (hasAIModel && brokenIndices.length > 0) {
    try {
    if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
      ProgressUI.show('Fixing broken pages...', `Detected ${brokenIndices.length} page(s) with rendering issues.`);
      ProgressUI.startAutoEstimate(8);
    }
    const fixed = await fixBrokenPagesWithAI(brokenIndices, modelsUsed);
    if (fixed) {
      const afterFixHTML = typeof getCanvasSnapshotHTML === 'function' ? getCanvasSnapshotHTML() : '';
      if (afterFixHTML) {
        const localPolished = localBeautifyHTML(afterFixHTML);
        if (localPolished && localPolished !== afterFixHTML) {
          if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
          if (typeof setDocumentHTMLAndPaginate === 'function') await setDocumentHTMLAndPaginate(localPolished, false);
        }
      }
      if (typeof ProgressUI !== 'undefined' && ProgressUI.finish) ProgressUI.finish();
      setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 300);
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('✅ Fixed broken pages and applied local polish.');
      }
      if (typeof appendChatMessageToUI === 'function') {
        appendChatMessageToUI('ai', `✅ Fixed ${brokenIndices.length} page(s) with rendering issues and polished locally.`);
      }
      if (window.APP_STATE) window.APP_STATE.isAIGenerating = false;
      if (sendBtn) sendBtn.disabled = false;
      return;
    } else {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
      const localPolished = localBeautifyHTML(currentFullHTML);
      if (localPolished && localPolished !== currentFullHTML) {
        if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
        if (typeof setDocumentHTMLAndPaginate === 'function') await setDocumentHTMLAndPaginate(localPolished, false);
        if (typeof displayToastNotification === 'function') {
          displayToastNotification('✅ Applied local polish (AI fix failed).');
        }
        if (typeof appendChatMessageToUI === 'function') {
          appendChatMessageToUI('ai', '⚠️ AI fix failed; applied local polish only.');
        }
      } else {
        if (typeof displayToastNotification === 'function') {
          displayToastNotification('⚠️ No changes made – broken pages could not be fixed.');
        }
      }
      if (window.APP_STATE) window.APP_STATE.isAIGenerating = false;
      if (sendBtn) sendBtn.disabled = false;
      return;
    }
    } catch (brokenErr) {
      console.error('[beautifyDocument] broken-page repair failed:', brokenErr);
      if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
      if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ Could not repair pages. Please try again.');
    } finally {
      if (window.APP_STATE) window.APP_STATE.isAIGenerating = false;
      if (typeof sendBtn !== 'undefined' && sendBtn) sendBtn.disabled = false;
    }
    return;
  }

  if (!hasAIModel) {
    try {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show('Beautifying…', 'Local formatting (no AI model configured)…');
        ProgressUI.startAutoEstimate(3);
      }
      const polished = localBeautifyHTML(currentFullHTML) || currentFullHTML;
      if (polished !== currentFullHTML) {
        if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
        if (typeof setDocumentHTMLAndPaginate === 'function') await setDocumentHTMLAndPaginate(polished, false);
        if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
        if (typeof displayToastNotification === 'function') {
          displayToastNotification('✅ Local beautify applied.');
        }
        if (typeof appendChatMessageToUI === 'function') {
          appendChatMessageToUI('ai', '✅ Document polished locally.');
        }
      } else {
        if (typeof displayToastNotification === 'function') {
          displayToastNotification('ℹ Document already looks good.');
        }
      }
    } catch (localErr) {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('Error Beautify failed: ' + (localErr && localErr.message ? localErr.message : 'unknown'));
      }
    } finally {
      if (window.APP_STATE) window.APP_STATE.isAIGenerating = false;
      if (sendBtn) sendBtn.disabled = false;
    }
    return;
  }

  const sourceForAI = typeof getCanvasContentWithLatexSource === 'function' ? getCanvasContentWithLatexSource() : currentFullHTML;
  const outputLanguage = detectOutputLanguage(sourceForAI || currentFullHTML);
  const source = getBeautifySourceHTML() || sourceForAI || currentFullHTML;
  const maxTokens = getBeautifyMaxTokens();

  if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
    ProgressUI.show('Beautifying…', 'Single-pass full-document formatting…');
    ProgressUI.startAutoEstimate(18);
  }

  try {
    if (requestSessionId !== window.APP_STATE?.activeSessionId) throw new Error('Beautify session changed.');
    if (typeof callAIAPI !== 'function') throw new Error('AI API unavailable');

    const systemPrompt =
      `You are a Document Beautification AI. MODE: ${isMonochromeMode ? 'MONOCHROME' : 'COLORFUL'}.\n` +
      `Return ONLY valid JSON: {"html_content":"<full beautified HTML>"}. No markdown fences, no commentary.\n` +
      `Preserve ALL supplied content exactly in substance and order: every fact, number, formula, example, heading, list item, table value and diagram markup. NEVER summarize, shorten, omit or invent content.\n` +
      `Only improve presentation: typography hierarchy, spacing, headings, callouts, table formatting and math markup ($...$ / $$...$$).\n` +
      `Keep existing class names for diagrams (.fc-wrapper, .figure-pro) and quiz blocks when present.\n` +
      `Output language of text content must stay unchanged (${outputLanguage || 'same as source'}).\n` +
      `Return the COMPLETE document in one response — do not split into sections or batches.\n` +
      `${typeof buildSharedRules === 'function' ? buildSharedRules(isMonochromeMode, outputLanguage, { skipInstruction: true }) : ''}`;

    let result = await callAIAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Beautify the full document below. Preserve every element. Return complete html_content in one shot.\n\n${source}` }
    ], { forceJson: true, modelsUsedSet: modelsUsed, maxTokens });

    if (requestSessionId !== window.APP_STATE?.activeSessionId) throw new Error('Beautify session changed.');
    if (!result) throw new Error('Empty AI response');

    let html = extractBeautifyHtmlFromAIResponse(result.content);

    if (result.finishReason === 'length' && html && typeof generateHtmlContentWithAutoContinue === 'function') {
      try {
        if (typeof ProgressUI !== 'undefined' && ProgressUI.setLabel) {
          ProgressUI.setLabel('Beautifying… continuing long output…');
        }
        html = await generateHtmlContentWithAutoContinue(
          'Continue beautifying the remaining HTML. Output only the continuation of html_content (valid HTML fragment). Do not repeat already returned content. Keep all facts and structure.',
          html,
          result.finishReason,
          modelsUsed,
          (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.CONTINUATION_MAX_LOOPS) || 8,
          result.modelConfig || null
        );
      } catch (contErr) {
        console.warn('Beautify continuation failed:', contErr);
      }
    }

    let usedLocal = false;
    let safeHtml = html;
    if (!beautifyOutputLooksSafe(source, html)) {
      console.warn('Beautify: AI output failed safety check; applying local polish.');
      safeHtml = localBeautifyHTML(currentFullHTML) || currentFullHTML;
      usedLocal = true;
    }

    const modelNames = Array.from(modelsUsed).filter(Boolean);
    if (usedLocal) {
      await applyResult(
        safeHtml,
        '✅ Beautify applied (local polish — AI output was incomplete).',
        `✅ Document polished locally after AI safety check.${modelNames.length ? ' Models tried: ' + modelNames.join(', ') : ''}`
      );
    } else {
      await applyResult(
        safeHtml,
        '✅ Beautify completed successfully!',
        `✅ Document beautified${modelNames.length ? ' using ' + modelNames.join(', ') : ''}.`
      );
    }
  } catch (error) {
    if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
    if (error && error.message === 'Beautify session changed.') {
      // The user switched documents meanwhile: abandon quietly instead of rewriting the wrong one.
      if (typeof displayToastNotification === 'function') displayToastNotification('ℹ️ Beautify cancelled (document changed).');
      return;
    }
    try {
      const polished = localBeautifyHTML(currentFullHTML) || currentFullHTML;
      if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
      if (typeof setDocumentHTMLAndPaginate === 'function') await setDocumentHTMLAndPaginate(polished, false);
      if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(200);
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('Beautify AI failed — applied local formatting instead.');
      }
      if (typeof appendChatMessageToUI === 'function') {
        appendChatMessageToUI('error', `⚠️ Beautify AI failed: ${error.message}. Local polish applied.`);
      }
    } catch (e2) {
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('Error Beautify failed: ' + error.message + ' — original content kept.');
      }
      if (typeof appendChatMessageToUI === 'function') {
        appendChatMessageToUI('error', `⚠️ Beautify failed: ${error.message}`);
      }
      if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
      if (typeof setDocumentHTMLAndPaginate === 'function') await setDocumentHTMLAndPaginate(currentFullHTML, false);
    }
  } finally {
    if (window.APP_STATE) window.APP_STATE.isAIGenerating = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ===== DIAGRAM EDIT / REFINE =====
async function handleDiagramEditOrRefine(promptText, intentPayload, pageContext, modelsUsedSet) {
  const rawCandidates = getDiagramCandidates(pageContext);
  const candidates = rankDiagramCandidatesForPrompt(rawCandidates, promptText, pageContext);
  if (!candidates.length) return { handled: false };

  const candidateList = candidates.slice(0, 6).map((d, i) =>
    `DIAGRAM ${i + 1}${i === 0 ? ' ← BEST MATCH' : ''}\nTitle: ${d.title}\nPage: ${d.pageNumber || 'unknown'}\nSection: ${d.heading || 'unknown'}\nHTML:\n${d.html}`
  ).join('\n\n---\n\n');

  const recreate = intentPayload && intentPayload.intent === 'redesign_diagram';
  const systemPrompt =
    `You are a specialist modern academic diagram editor. ${recreate ? 'Recreate the existing diagram as a genuinely new, improved visual design while preserving the requested factual subject matter.' : 'Modify ONLY the existing diagram most relevant to the user\'s request.'}\n` +
    `Do not rewrite surrounding prose. Preserve factual meaning, labels, values, relationships and equations unless the user explicitly asks to change them.\n` +
    `Choose the most semantically appropriate visual structure instead of blindly keeping a box-arrow layout. ${recreate ? 'Do not copy the old layout; change the visual structure, hierarchy, spacing or diagram language so this is a real redesign.' : 'If the user\'s request is only about styling, preserve the diagram\'s information architecture while modernizing its visual language.'}\n` +
    `Use responsive inline SVG with a clean editorial/academic design: clear whitespace, rounded cards where appropriate, restrained shadows, consistent typography, strong hierarchy, clean connector routing, print-safe labels, and A4-safe proportions.\n` +
    `Return ONLY valid JSON: {"target_index":1,"html_content":"<complete diagram wrapper HTML>","chat_summary":"..."}.\n` +
    `target_index is 1-based. Prefer DIAGRAM 1 unless another candidate is clearly a better semantic match. html_content MUST contain one COMPLETE .fc-wrapper or .figure-pro block with the COMPLETE SVG/visual markup, including all required nodes, connectors, labels, definitions and captions. Never return only a partial SVG or placeholder. Preserve all existing labels/values/relationships unless the user explicitly requests a content change.\n` +
    `Use the application's diagram classes where appropriate: .fc-wrapper, .fc-title, .fc-svg-wrapper, .fc-svg, .fc-node-rect, .fc-node-text, .fc-line.`;

  try {
    const result = typeof callAIAPI === 'function' ? await callAIAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `USER REQUEST:\n${promptText}\n\nAVAILABLE DIAGRAMS:\n${candidateList}` }
    ], { forceJson: true, modelsUsedSet: modelsUsedSet }) : null;

    if (!result) return { handled: false };
    const parsed = typeof safeParseAIJson === 'function' ? safeParseAIJson(result.content, null) : null;
    const idx = parsed ? Number(parsed.target_index) - 1 : -1;
    const target = Number.isInteger(idx) ? candidates[idx] : null;
    const wrapperHTML = parsed && typeof parsed.html_content === 'string' ? extractDiagramWrapperFromAIHTML(parsed.html_content) : '';
    if (!target || !wrapperHTML) return { handled: false };
    const validation = recreate ? { ok: true } : validateDiagramReplacementAgainstOriginal(target.html, wrapperHTML, promptText);
    if (!validation.ok) {
      console.warn('[Diagram Edit] replacement rejected:', validation.reason);
      return { handled: false };
    }
    HISTORY.saveState();
    if (!(await replaceExistingDiagramBlock(target.element, wrapperHTML))) return { handled: false };
    return { handled: true, summary: parsed.chat_summary || (recreate ? 'New diagram created successfully.' : 'Diagram updated successfully.') };
  } catch (e) {
    console.warn('[Diagram Edit] specialized flow failed:', e);
    return { handled: false };
  }
}

// ===== LOCAL POST-PROCESS =====
async function repairEquationsInNewContent(modelsUsedSet) {
  try {
    if (!docContainer) return;
    const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
    let touched = 0;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
      if (typeof forceRenderAllKatexVisuals === 'function') forceRenderAllKatexVisuals(page);
      if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(page);
      if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(page);
      if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(page);
      if (page.scrollHeight > EDITOR_A4_HEIGHT + 1) {
        tightenPageContentToA4(page);
        touched++;
      }
      if (i % 6 === 5) await new Promise(r => setTimeout(r, 0));
    }
    if (touched) updatePageFooters();
    _removeTrailingEmptyPages();
  } catch (e) {
    console.warn('Local post-process skipped:', e);
  }
}

// ===== RUN DOCUMENT INTEGRITY PASS =====
function runDocumentOutputIntegrityPass(root = docContainer) {
  if (!root) return { repaired: 0, brokenEquations: [] };
  let repaired = 0;
  if (typeof normalizeAIHTMLTextArtifacts === 'function') normalizeAIHTMLTextArtifacts(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  nodes.forEach(n => {
    if (n.parentElement && n.parentElement.closest('.katex, .katex-eq')) return;
    const fixed = typeof repairVisibleEscapeSequencesInText === 'function' ? repairVisibleEscapeSequencesInText(n.nodeValue) : n.nodeValue;
    if (fixed !== n.nodeValue) { n.nodeValue = fixed;
      repaired++; }
  });
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(root);
  if (typeof forceRenderAllKatexVisuals === 'function') forceRenderAllKatexVisuals(root);
  if (typeof prepareEquationsForPDF === 'function') prepareEquationsForPDF(root);
  return { repaired, brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(root) : [] };
}

// ===== STRIP EMOJI =====
function stripEmojiFromNode(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(node => {
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) return;
    // never touch rendered math glyphs (brackets, arrows, symbols inside KaTeX output)
    if (parent.closest && parent.closest('.katex, .katex-eq')) return;
    const re = _getEmojiRe();
    if (!re) return;
    const before = node.nodeValue;
    // keep ZWJ/ZWNJ that stand alone: Bengali (and Persian) conjuncts need them
    const after = before.replace(re, m => (/^[\u200c\u200d]+$/.test(m) ? m : ''));
    if (after !== before) node.nodeValue = after;   // no needless DOM mutation
  });
}

// ===== CLEANUP EMPTY VISUAL CONTAINERS =====
function cleanupEmptyVisualContainers(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.figure-pro').forEach(fig => {
    // A figure without a .figure-frame (plain <img>/<svg> inside) is judged as a whole, not deleted.
    const frame = fig.querySelector('.figure-frame') || fig;
    const hasVisual = _elementHasVisualContent(frame);
    if (!hasVisual) fig.remove();
  });
  root.querySelectorAll('.fc-wrapper').forEach(wrapper => {
    const svg = wrapper.querySelector('svg.fc-svg, svg');
    const hasDrawable = !!(svg && svg.querySelector('rect, circle, ellipse, line, path, polyline, polygon, text, image, foreignObject'));
    if (!svg || !hasDrawable) wrapper.remove();
  });
  root.querySelectorAll('.figure-frame').forEach(frame => {
    if (!_elementHasVisualContent(frame)) frame.remove();
  });
  root.querySelectorAll('.fc-svg-wrapper').forEach(frame => {
    if (!_elementHasVisualContent(frame)) frame.remove();
  });
}

// ===== ENFORCE DIAGRAM VISUAL STYLES =====
function enforceDiagramVisualStyles(root = docContainer) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const monochrome = document.body.classList.contains('photocopy-mode');
  const palette = {
    base: monochrome ? '#fff' : '#f8fafc',
    primary: monochrome ? '#fff' : '#eef2ff',
    secondary: monochrome ? '#fff' : '#f8fafc',
    accent: monochrome ? '#fff' : '#ecfeff',
    yellow: monochrome ? '#fff' : '#fffbeb',
    text: '#0f172a',
    note: '#64748b',
    stroke: monochrome ? '#000' : '#94a3b8',
    primaryStroke: monochrome ? '#000' : '#6366f1',
    secondaryStroke: monochrome ? '#000' : '#cbd5e1',
    accentStroke: monochrome ? '#000' : '#06b6d4',
    yellowStroke: monochrome ? '#000' : '#f59e0b'
  };

  root.querySelectorAll('.fc-node-rect').forEach(el => {
    let fill = palette.base;
    let stroke = palette.stroke;
    if (el.classList.contains('primary')) { fill = palette.primary;
      stroke = palette.primaryStroke; } else if (el.classList.contains('secondary')) { fill = palette.secondary;
      stroke = palette.secondaryStroke; } else if (el.classList.contains('accent')) { fill = palette.accent;
      stroke = palette.accentStroke; } else if (el.classList.contains('yellow')) { fill = palette.yellow;
      stroke = palette.yellowStroke; }
    el.style.setProperty('fill', fill, 'important');
    el.style.setProperty('stroke', stroke, 'important');
    el.style.setProperty('stroke-width', el.classList.contains('primary') ? '2.2' : '1.8', 'important');
  });

  root.querySelectorAll('.fc-node-text').forEach(el => {
    el.style.setProperty('fill', monochrome ? '#000' : '#0f172a', 'important');
    el.style.setProperty('color', monochrome ? '#000' : '#0f172a', 'important');
  });

  root.querySelectorAll('.fc-node-note').forEach(el => {
    el.style.setProperty('fill', monochrome ? '#000' : '#64748b', 'important');
    el.style.setProperty('color', monochrome ? '#000' : '#64748b', 'important');
  });

  root.querySelectorAll('.fc-line').forEach(el => {
    const stroke = el.classList.contains('primary') ? (monochrome ? '#000' : '#4f46e5') : (monochrome ? '#000' : '#64748b');
    el.style.setProperty('stroke', stroke, 'important');
    el.style.setProperty('fill', 'none', 'important');
  });

  root.querySelectorAll('.fc-label-pill').forEach(el => {
    el.style.setProperty('fill', monochrome ? '#fff' : '#f1f5f9', 'important');
    el.style.setProperty('stroke', monochrome ? '#000' : '#e2e8f0', 'important');
  });
}

// ===== AUTO-FIT DIAGRAM LABELS TO THEIR BOXES =====
// The AI picks each node's rect width/height AND its label's text independently
// in one shot — nothing ties them together, so the box is only ever as big as
// the AI guessed the text would need. When the guess is short, the label
// renders wider/taller than its rect and spills outside it. This measures
// each label's REAL rendered size in the browser (via SVG getComputedTextLength,
// so it matches the actual font/size being used, not an assumed average
// character width), wraps it onto as many lines as the box's current width
// allows, and grows the rect's height (and, only if a single word still can't
// fit, its width) to match — after the fact, based on real measurements,
// instead of trusting the AI's guess. Safe to call repeatedly on the same
// diagram; already-fitting labels are left alone.
function autoFitDiagramTextToNodes(root = docContainer) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('svg.fc-svg').forEach(svg => {
    try { fitOneDiagramSvgLabels(svg); } catch (_) { /* leave this diagram exactly as generated on any failure */ }
  });
  root.querySelectorAll('.figure-frame svg, .figure-pro svg').forEach(svg => {
    try { fitOneFigureProLabels(svg); } catch (_) { /* leave this figure exactly as generated on any failure */ }
    try { preventDarkFigureBoxes(svg); } catch (_) { /* leave this figure exactly as generated on any failure */ }
  });
}

// ===== NEVER LET TEXT IN A FREEFORM AI FIGURE SPILL OUTSIDE ITS BOX =====
// fitOneDiagramSvgLabels (above) only understands the fixed fc-node-rect/
// fc-node-text markup of the .fc-svg diagram system. .figure-pro/.figure-frame
// figures are freeform, AI-authored SVG — any shape can be a "box" (rect,
// circle, ellipse, polygon, even a path), and there's no class tying a label
// to its shape. This is the freeform equivalent of fitOneDiagramSvgLabels:
// for every text label, it finds the smallest shape whose real, rendered
// bounding box actually contains that label (mirroring preventDarkFigureBoxes'
// pairing heuristic below), measures the label's REAL rendered width via
// getComputedTextLength, and wraps it to fit inside that shape. Rects can be
// safely grown (wider only as a last resort, then taller) the same way the
// fixed system does. Other shapes — circles, blobs, arrows, anything whose
// geometry can't just be widened/heightened without redrawing it — are left
// exactly where they are, and instead the font is shrunk step by step (down
// to a readable floor) until the wrapped label fits inside the shape's own
// box both ways. Either path, once this runs, a label can never render wider
// or taller than the box it sits in. Safe to call repeatedly on the same
// figure; already-fitting labels are left alone.
function fitOneFigureProLabels(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function' || !svg.isConnected) return;
  const PAD_X = 10, PAD_Y = 6, LINE_HEIGHT_EM = 1.18, MIN_FONT_SIZE = 8, MAX_WIDTH_GROWTH = 1.6;

  const texts = Array.from(svg.querySelectorAll('text'));
  const shapes = Array.from(svg.querySelectorAll('rect, circle, ellipse, polygon, path'));
  if (!texts.length || !shapes.length) return;

  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  probe.style.visibility = 'hidden';
  svg.appendChild(probe);

  const claimedShapes = new Set();

  try {
    texts.forEach(textEl => {
      try {
        // Collapse any existing tspans (authored, or left over from a previous
        // fit pass) back into one plain string so wrapping always starts from
        // the label's real, full text instead of stacking wraps on wraps.
        const existingTspans = Array.from(textEl.querySelectorAll('tspan'));
        const original = (existingTspans.length
          ? existingTspans.map(t => t.textContent).join(' ')
          : (textEl.textContent || '')).replace(/\s+/g, ' ').trim();
        if (!original) return;

        let tbb;
        try { tbb = textEl.getBBox(); } catch (_) { return; }
        if (!tbb || (!tbb.width && !tbb.height)) return;
        const tx = tbb.x + tbb.width / 2;
        const ty = tbb.y + tbb.height / 2;

        // The label's own box is the smallest not-yet-claimed shape whose
        // bounding box contains its center — same heuristic as
        // preventDarkFigureBoxes, so a larger background/frame shape behind
        // several labels is never mistaken for one label's individual box.
        let bestShape = null, bestArea = Infinity, bestBB = null;
        shapes.forEach(shape => {
          if (claimedShapes.has(shape)) return;
          let sbb;
          try { sbb = shape.getBBox(); } catch (_) { return; }
          if (!sbb || !sbb.width || !sbb.height) return;
          if (tx >= sbb.x && tx <= sbb.x + sbb.width && ty >= sbb.y && ty <= sbb.y + sbb.height) {
            const area = sbb.width * sbb.height;
            if (area < bestArea) { bestArea = area; bestShape = shape; bestBB = sbb; }
          }
        });
        if (!bestShape) return;
        claimedShapes.add(bestShape);

        const isRect = bestShape.tagName && bestShape.tagName.toLowerCase() === 'rect';
        let fontSize = _svgFontPx(textEl);
        const originalFontSize = fontSize;
        probe.setAttribute('font-family', getComputedStyle(textEl).fontFamily || 'inherit');
        probe.setAttribute('font-weight', getComputedStyle(textEl).fontWeight || 'normal');
        const measure = (str, fs) => {
          probe.setAttribute('font-size', String(fs));
          probe.textContent = str;
          return probe.getComputedTextLength();
        };

        function wrapAt(fs, boxW) {
          const availableW = Math.max(boxW - PAD_X * 2, fs * 2);
          const words = original.split(' ');
          const out = [];
          let current = '';
          words.forEach(word => {
            const trial = current ? current + ' ' + word : word;
            if (!current || measure(trial, fs) <= availableW) current = trial;
            else { out.push(current); current = word; }
          });
          if (current) out.push(current);
          return out;
        }

        let lines = wrapAt(fontSize, bestBB.width);
        let widestLine = Math.max(0, ...lines.map(l => measure(l, fontSize)));
        let neededH = lines.length * fontSize * LINE_HEIGHT_EM + PAD_Y * 2;

        if (isRect) {
          // Rects can be safely resized: widen (capped) only if a single word
          // still can't fit even at the box's own width, then grow height to
          // match however many lines wrapping produced.
          let finalW = bestBB.width;
          if (widestLine + PAD_X * 2 > bestBB.width) {
            finalW = Math.min(widestLine + PAD_X * 2, bestBB.width * MAX_WIDTH_GROWTH);
          }
          const finalH = Math.max(bestBB.height, neededH);
          if (finalW > bestBB.width + 0.5 || finalH > bestBB.height + 0.5) {
            const cx = bestBB.x + bestBB.width / 2, cy = bestBB.y + bestBB.height / 2;
            bestShape.setAttribute('x', String(cx - finalW / 2));
            bestShape.setAttribute('y', String(cy - finalH / 2));
            bestShape.setAttribute('width', String(finalW));
            bestShape.setAttribute('height', String(finalH));
            bestBB = { x: cx - finalW / 2, y: cy - finalH / 2, width: finalW, height: finalH };
          }
        } else {
          // Non-rect boxes (circles, blobs, arrows, freeform paths) can't be
          // widened or heightened without redrawing their geometry, so shrink
          // the font instead, re-wrapping at each size, until the label fits
          // inside the shape's own box both ways — down to a readable floor.
          while (fontSize > MIN_FONT_SIZE && (neededH > bestBB.height || widestLine + PAD_X * 2 > bestBB.width)) {
            fontSize -= 0.5;
            lines = wrapAt(fontSize, bestBB.width);
            widestLine = Math.max(0, ...lines.map(l => measure(l, fontSize)));
            neededH = lines.length * fontSize * LINE_HEIGHT_EM + PAD_Y * 2;
          }
        }

        // Nothing actually needs to change — leave the markup untouched.
        if (fontSize === originalFontSize && lines.length <= 1 && !existingTspans.length &&
            widestLine + PAD_X * 2 <= bestBB.width + 0.5 && neededH <= bestBB.height + 0.5) return;

        const cx = bestBB.x + bestBB.width / 2, cy = bestBB.y + bestBB.height / 2;
        if (fontSize !== originalFontSize) textEl.setAttribute('font-size', String(fontSize));
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('dominant-baseline', 'middle');
        while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
        const startY = cy - ((lines.length - 1) * fontSize * LINE_HEIGHT_EM) / 2;
        lines.forEach((line, i) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', String(cx));
          tspan.setAttribute('y', String(startY + i * fontSize * LINE_HEIGHT_EM));
          tspan.textContent = line;
          textEl.appendChild(tspan);
        });
      } catch (_) { /* leave this one label as-is, keep fitting the rest */ }
    });
  } finally {
    if (probe.parentNode) probe.parentNode.removeChild(probe);
  }
}

// ===== NEVER LET AN AI-DRAWN FIGURE RENDER A LABELED BOX AS SOLID BLACK =====
// The prompt already tells the AI never to fill a labeled node with solid
// black (see buildSharedRules's figure rules in app.js), but the AI doesn't
// always follow that — and .figure-pro/.figure-frame figures are freeform,
// AI-authored SVG, not the fixed fc-node-rect/fc-node-text markup that
// enforceDiagramVisualStyles can safely recolor by class. This is a runtime
// safety net: for every text label, find the smallest shape whose bounding
// box actually contains it (that's its own box, not some larger background
// frame behind it), and if that shape's fill is near-black, lighten it and
// set the label to dark text — so a box can never render as solid black,
// no matter what the AI generated.
function preventDarkFigureBoxes(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function' || !svg.isConnected) return;
  const DARK_LUMINANCE_THRESHOLD = 0.22;

  function parseColorToRGB(str) {
    if (!str) return null;
    str = String(str).trim();
    if (!str || str === 'none' || str === 'transparent') return null;
    let m = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
    m = str.match(/^#([0-9a-f]{3})$/i);
    if (m) {
      const h = m[1];
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    m = str.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const h = m[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return null;
  }
  const luminanceOf = (rgb) => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const toHex = (rgb) => '#' + rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');

  const texts = Array.from(svg.querySelectorAll('text'));
  const shapes = Array.from(svg.querySelectorAll('rect, circle, ellipse, polygon, path'));
  if (!texts.length || !shapes.length) return;

  texts.forEach(textEl => {
    let tx, ty;
    try {
      const bb = textEl.getBBox();
      if (!bb || (!bb.width && !bb.height)) return;
      tx = bb.x + bb.width / 2;
      ty = bb.y + bb.height / 2;
    } catch (_) { return; }

    // The label's own box is the SMALLEST shape that contains it — a larger
    // shape containing the same point is usually a background/frame behind
    // several labels, not this label's individual box.
    let bestShape = null, bestArea = Infinity;
    shapes.forEach(shape => {
      let bb;
      try { bb = shape.getBBox(); } catch (_) { return; }
      if (!bb || !bb.width || !bb.height) return;
      if (tx >= bb.x && tx <= bb.x + bb.width && ty >= bb.y && ty <= bb.y + bb.height) {
        const area = bb.width * bb.height;
        if (area < bestArea) { bestArea = area; bestShape = shape; }
      }
    });
    if (!bestShape) return;

    let fillStr = '';
    try { fillStr = getComputedStyle(bestShape).fill || ''; } catch (_) { /* ignore */ }
    if (!fillStr || fillStr === 'none') fillStr = bestShape.getAttribute('fill') || '';
    const rgb = parseColorToRGB(fillStr);
    if (!rgb) return;

    if (luminanceOf(rgb) < DARK_LUMINANCE_THRESHOLD) {
      // Lighten the box well clear of "black" while keeping a hint of its
      // original hue, and force the label to dark text so it stays
      // readable against the now-light fill.
      const lightened = rgb.map(c => c + (255 - c) * 0.75);
      bestShape.style.setProperty('fill', toHex(lightened), 'important');
      textEl.style.setProperty('fill', '#111827', 'important');
      textEl.style.setProperty('color', '#111827', 'important');
    }
  });
}

function fitOneDiagramSvgLabels(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function' || !svg.isConnected) return;
  const PAD_X = 14, PAD_Y = 8, LINE_HEIGHT_EM = 1.18;
  const texts = Array.from(svg.querySelectorAll('text.fc-node-text'));
  // Every <rect> in the diagram, not just ones carrying the fc-node-rect
  // class — enforceDiagramVisualStyles only recolors classed rects, so a
  // rect the AI forgot to class (or drew as part of a freeform shape) keeps
  // whatever fill the AI gave it, sometimes a dark one. Widening the search
  // here means the contrast check below still finds and fixes that rect's
  // paired label instead of silently skipping it.
  const rects = Array.from(svg.querySelectorAll('rect'));
  if (!texts.length || !rects.length) return;

  const monochrome = document.body.classList.contains('photocopy-mode');
  // Reads whatever fill actually ends up on a rect — a class-driven color
  // from enforceDiagramVisualStyles, an AI-authored attribute, or an
  // AI-authored inline style — and picks whichever of light/dark text
  // stays readable on it, instead of assuming the box is always light
  // (which is what let dark, unclassed boxes end up with invisible
  // same-color-as-background text).
  function readableTextColorFor(rectEl) {
    let fillStr = '';
    try { fillStr = getComputedStyle(rectEl).fill || ''; } catch (_) { /* ignore */ }
    if (!fillStr || fillStr === 'none') fillStr = rectEl.getAttribute('fill') || '';
    const m = fillStr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!m) return monochrome ? '#000' : '#0f172a';
    const r = parseFloat(m[1]), g = parseFloat(m[2]), b = parseFloat(m[3]);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (luminance < 0.5) return '#ffffff';
    return monochrome ? '#000' : '#0f172a';
  }

  const claimedRects = new Set();
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  probe.style.visibility = 'hidden';
  svg.appendChild(probe);

  try {
    texts.forEach(textEl => {
      try {
        const tx = parseFloat(textEl.getAttribute('x')) || 0;
        const ty = parseFloat(textEl.getAttribute('y')) || 0;
        // The label belongs to whichever rect's center it's closest to — the
        // AI always places text at the rect's center (text-anchor="middle",
        // dominant-baseline="middle"), so this pairing is reliable even
        // though the markup never explicitly links a <text> to its <rect>.
        let best = null, bestDist = Infinity;
        rects.forEach(r => {
          if (claimedRects.has(r)) return;
          const rx = parseFloat(r.getAttribute('x')) || 0;
          const ry = parseFloat(r.getAttribute('y')) || 0;
          const rw = parseFloat(r.getAttribute('width')) || 0;
          const rh = parseFloat(r.getAttribute('height')) || 0;
          const dist = Math.hypot((rx + rw / 2) - tx, (ry + rh / 2) - ty);
          if (dist < bestDist && dist < Math.max(rw, rh, 60)) { bestDist = dist; best = r; }
        });
        if (!best) return;
        claimedRects.add(best);

        // Fix contrast first — unconditionally, regardless of whether the
        // box also needs resizing below — since this is what turns an
        // invisible (same-color-as-background) label back into a readable
        // one on a dark or unexpectedly-colored box.
        textEl.style.setProperty('fill', readableTextColorFor(best), 'important');
        textEl.style.setProperty('color', readableTextColorFor(best), 'important');

        const rectX = parseFloat(best.getAttribute('x')) || 0;
        const rectY = parseFloat(best.getAttribute('y')) || 0;
        const rectW = parseFloat(best.getAttribute('width')) || 0;
        const rectH = parseFloat(best.getAttribute('height')) || 0;
        const cx = rectX + rectW / 2;
        const cy = rectY + rectH / 2;

        const original = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (!original) return;

        const fontSize = _svgFontPx(textEl);
        probe.setAttribute('font-size', String(fontSize));
        probe.setAttribute('font-family', getComputedStyle(textEl).fontFamily || 'inherit');
        probe.setAttribute('font-weight', getComputedStyle(textEl).fontWeight || 'normal');
        const measure = (str) => { probe.textContent = str; return probe.getComputedTextLength(); };

        const availableW = Math.max(rectW - PAD_X * 2, fontSize * 3);
        const words = original.split(' ');
        const lines = [];
        let current = '';
        words.forEach(word => {
          const trial = current ? current + ' ' + word : word;
          if (!current || measure(trial) <= availableW) {
            current = trial;
          } else {
            lines.push(current);
            current = word;
          }
        });
        if (current) lines.push(current);
        if (!lines.length) return;

        // If a single word alone is wider than the box, that's the one case
        // wrapping can't solve — allow modest, capped width growth for it.
        const widestLine = Math.max(0, ...lines.map(measure));
        let finalRectW = rectW;
        if (widestLine + PAD_X * 2 > rectW) {
          finalRectW = Math.min(widestLine + PAD_X * 2, rectW * 1.6);
        }

        const neededH = lines.length * fontSize * LINE_HEIGHT_EM + PAD_Y * 2;
        const finalRectH = Math.max(rectH, neededH);

        // Nothing actually needs to change — leave the markup untouched.
        if (finalRectW <= rectW + 0.5 && finalRectH <= rectH + 0.5 && lines.length <= 1) return;

        best.setAttribute('x', String(cx - finalRectW / 2));
        best.setAttribute('y', String(cy - finalRectH / 2));
        best.setAttribute('width', String(finalRectW));
        best.setAttribute('height', String(finalRectH));

        while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
        const startY = cy - ((lines.length - 1) * fontSize * LINE_HEIGHT_EM) / 2;
        lines.forEach((line, i) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', String(cx));
          tspan.setAttribute('y', String(startY + i * fontSize * LINE_HEIGHT_EM));
          tspan.textContent = line;
          textEl.appendChild(tspan);
        });
      } catch (_) { /* leave this one label as-is, keep fitting the rest */ }
    });
  } finally {
    if (probe.parentNode) probe.parentNode.removeChild(probe);
  }
}

// ===== APPLY MONOCHROME DOCUMENT STYLES =====
// Monochrome mode is a VIEW option. The original inline values are remembered in data-mono-orig
// so switching back restores the author's colours/borders exactly, and nothing is touched at all
// while monochrome is off.
function _monoSet(el, props) {
  let rec = { props: {}, attr: el.getAttribute('style'), applied: null };
  if (el.dataset.monoOrig) { try { rec = JSON.parse(el.dataset.monoOrig) || rec; } catch (_) { /* start fresh */ } }
  Object.keys(props).forEach(p => {
    if (!(p in rec.props)) rec.props[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    el.style.setProperty(p, props[p][0], props[p][1]);   // an empty value removes the property
  });
  rec.applied = el.getAttribute('style');
  el.dataset.monoOrig = JSON.stringify(rec);
}
function _monoRestore(el) {
  const raw = el.dataset.monoOrig;
  if (!raw) return;
  try {
    const rec = JSON.parse(raw) || {};
    if (el.getAttribute('style') === rec.applied) {
      // untouched since monochrome was applied: put the exact original style attribute back
      if (rec.attr == null) el.removeAttribute('style'); else el.setAttribute('style', rec.attr);
    } else {
      // the user edited the element meanwhile (e.g. resized an image): restore only what we changed
      Object.keys(rec.props || {}).forEach(p => {
        const [val, prio] = rec.props[p];
        if (val) el.style.setProperty(p, val, prio); else el.style.removeProperty(p);
      });
    }
  } catch (_) { /* ignore corrupt marker */ }
  delete el.dataset.monoOrig;
  if (!el.getAttribute('style')) el.removeAttribute('style');
}

function applyMonochromeDocumentStyles() {
  if (!docContainer) return;
  const monochrome = document.body.classList.contains('photocopy-mode');
  docContainer.classList.toggle('monochrome-document', monochrome);

  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  pages.forEach(page => {
    PDF_VISUAL_FORMAT_IDS.forEach(f => page.classList.remove('pdf-format-' + f));
    if (monochrome) {
      page.style.background = '#fff';
      page.style.color = '#000';
      page.style.borderColor = '#000';
      page.style.boxShadow = 'none';

      page.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,dt,dd,th,td,caption,figcaption').forEach(el => {
        _monoSet(el, { 'color': ['#000', ''] });
      });
      page.querySelectorAll('table, th, td, .figure-pro, .figure-frame').forEach(el => {
        _monoSet(el, { 'border-color': ['#000', 'important'], 'box-shadow': ['none', 'important'], 'background': ['#fff', 'important'] });
      });
      // block-solution / math-final-answer / sol-label read as plain text in monochrome (see styles.css)
      page.querySelectorAll('.block-solution, .math-final-answer, .sol-label').forEach(el => {
        _monoSet(el, { 'background': ['', ''], 'border': ['', ''], 'border-color': ['', ''], 'box-shadow': ['', ''] });
      });
      page.querySelectorAll('img').forEach(img => {
        _monoSet(img, { 'filter': ['grayscale(1) contrast(1.05)', ''] });
      });
    } else {
      page.style.background = '';
      page.style.color = '';
      page.style.borderColor = '';
      page.style.boxShadow = '';
      const activeFormat = getActivePDFVisualFormat();
      if (activeFormat && activeFormat !== 'default') page.classList.add('pdf-format-' + activeFormat);
      page.querySelectorAll('[data-mono-orig]').forEach(_monoRestore);
    }
  });

  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(docContainer);
  if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(docContainer);
}

// ===== PDF VISUAL FORMAT =====
const PDF_VISUAL_FORMAT_IDS = ['default', 'aurora', 'editorial', 'midnight', 'blueprint', 'sage', 'minimal', 'rose', 'ocean', 'highcontrast'];
const PDF_TEXT_FORMAT_IDS = ['default', 'academic', 'modern', 'compact'];

function getActivePDFVisualFormat() {
  return (window.APP_STATE && window.APP_STATE.pdfVisualFormat) ||
    (function() { try { return localStorage.getItem(PDF_VISUAL_FORMAT_KEY) || 'default'; } catch (e) { return 'default'; } })();
}

function getActivePDFTextFormat() {
  return (window.APP_STATE && window.APP_STATE.pdfTextFormat) ||
    (function() { try { return localStorage.getItem(PDF_TEXT_FORMAT_KEY) || 'default'; } catch (e) { return 'default'; } })();
}

const PDF_LANGUAGE_FORMAT_IDS = ['default', 'english', 'bengali', 'english_bengali', 'bengali_english'];

function getActivePDFLanguageFormat() {
  return (window.APP_STATE && window.APP_STATE.pdfLanguageFormat) ||
    (function() { try { return localStorage.getItem(PDF_LANGUAGE_FORMAT_KEY) || 'default'; } catch (e) { return 'default'; } })();
}

function applyPDFLanguageFormat(formatId) {
  const id = PDF_LANGUAGE_FORMAT_IDS.includes(formatId) ? formatId : 'default';
  if (window.APP_STATE) window.APP_STATE.pdfLanguageFormat = id;
  try { localStorage.setItem(PDF_LANGUAGE_FORMAT_KEY, id); } catch (e) {}
}

function choosePDFLanguageFormat(formatId) {
  applyPDFLanguageFormat(formatId);
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  _refreshPdfPreviewIfVisible();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER._persist) TAB_MANAGER._persist();
  if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
  if (typeof displayToastNotification === 'function') displayToastNotification('✅ Language format applied');
}

function applyPDFVisualFormat(formatId) {
  const id = PDF_VISUAL_FORMAT_IDS.includes(formatId) ? formatId : 'default';
  const monochrome = !!(document.body && document.body.classList.contains('photocopy-mode'));
  if (!docContainer) return;
  docContainer.querySelectorAll('.doc-page-canvas').forEach(page => {
    PDF_VISUAL_FORMAT_IDS.forEach(f => page.classList.remove('pdf-format-' + f));
    if (!monochrome && id !== 'default') page.classList.add('pdf-format-' + id);
  });
  if (window.APP_STATE) window.APP_STATE.pdfVisualFormat = id;
  try { localStorage.setItem(PDF_VISUAL_FORMAT_KEY, id); } catch (e) { console.warn('Could not save visual format:', e); }
}

function applyPDFTextFormat(formatId) {
  const id = PDF_TEXT_FORMAT_IDS.includes(formatId) ? formatId : 'default';
  if (!docContainer) return;
  docContainer.querySelectorAll('.doc-page-canvas').forEach(page => {
    PDF_TEXT_FORMAT_IDS.forEach(f => page.classList.remove('text-format-' + f));
    if (id !== 'default') page.classList.add('text-format-' + id);
  });
  if (window.APP_STATE) window.APP_STATE.pdfTextFormat = id;
  try { localStorage.setItem(PDF_TEXT_FORMAT_KEY, id); } catch (e) { console.warn('Could not save text format:', e); }
}

function choosePDFVisualFormat(formatId) {
  applyPDFVisualFormat(formatId);
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  _refreshPdfPreviewIfVisible();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER._persist) TAB_MANAGER._persist();
  if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
  if (typeof displayToastNotification === 'function') displayToastNotification('✅ Visual format applied');
}

function choosePDFTextFormat(formatId) {
  applyPDFTextFormat(formatId);
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  _refreshPdfPreviewIfVisible();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER._persist) TAB_MANAGER._persist();
  if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
  if (typeof displayToastNotification === 'function') displayToastNotification('✅ Text format applied');
}

// ============================================================
// WINDOW EXPOSURE – Document Editor
// ============================================================
window._isDesignedBoxBlock = _isDesignedBoxBlock;
window._getSplittableChildrenForOverflow = _getSplittableChildrenForOverflow;
window.pageHasContent = pageHasContent;
window._canvasHasInk = _canvasHasInk;
window._elementHasVisualContent = _elementHasVisualContent;
window._removeTrailingEmptyPages = _removeTrailingEmptyPages;
window.getPageCount = getPageCount;
window.executeEditorCommand = executeEditorCommand;
window.paginateDocumentCanvas = paginateDocumentCanvas;
window.beautifyDocument = beautifyDocument;
window.addPageAfterCurrent = addPageAfterCurrent;
window.removeCurrentPage = removeCurrentPage;
window.handleCanvasInput = handleCanvasInput;
window.handlePageKeydown = handlePageKeydown;
window.setDocumentHTMLAndPaginate = setDocumentHTMLAndPaginate;
window.getAllCanvasHTML = getAllCanvasHTML;
window.getCanvasContentWithLatexSource = getCanvasContentWithLatexSource;
window.updateSpecificPageByNumber = updateSpecificPageByNumber;
window.updateSpecificPagesByNumber = updateSpecificPagesByNumber;
window.updateSpecificSectionByHeading = updateSpecificSectionByHeading;
window.checkForDuplicateHeadings = checkForDuplicateHeadings;
window.fitEditorPagesToScreen = fitEditorPagesToScreen;
window.runDocumentOutputIntegrityPass = runDocumentOutputIntegrityPass;
window.isDiagramEditRequest = isDiagramEditRequest;
window.handleDiagramEditOrRefine = handleDiagramEditOrRefine;
window.scheduleReflow = scheduleReflow;
window.applyPDFVisualFormat = applyPDFVisualFormat;
window.applyPDFTextFormat = applyPDFTextFormat;
window.getActivePDFVisualFormat = getActivePDFVisualFormat;
window.getActivePDFTextFormat = getActivePDFTextFormat;
window.getActivePDFLanguageFormat = getActivePDFLanguageFormat;
window.applyPDFLanguageFormat = applyPDFLanguageFormat;
window.choosePDFVisualFormat = choosePDFVisualFormat;
window.choosePDFTextFormat = choosePDFTextFormat;
window.choosePDFLanguageFormat = choosePDFLanguageFormat;
window.applyMonochromeDocumentStyles = applyMonochromeDocumentStyles;
window.repairEquationsInNewContent = repairEquationsInNewContent;
window.getExistingHeadings = getExistingHeadings;
window.getPageRangeContext = getPageRangeContext;
window.getMultiPageEditContext = getMultiPageEditContext;
window.detectRequestedPageNumber = detectRequestedPageNumber;
window.getBrokenPages = getBrokenPages;
window.fixBrokenPagesWithAI = fixBrokenPagesWithAI;