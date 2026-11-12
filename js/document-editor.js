// ========================================================================
// DOCUMENT EDITOR - History, Pagination, Page Management, and Core Editing
// ========================================================================
// SILENT PAGINATION (this round):
//   Pagination now runs completely silently in the background — no overlay,
//   no spinner, no modal, no visual indicator of any kind. The user simply
//   sees the document when it's ready. To make this pleasant (no flash of
//   empty content, no scroll jump, no second reflow after the page settle),
//   all the previous stability fixes remain in force:
//   1. `overflow-anchor: none` on the container.
//   2. `min-height` lock on the container during rebuild so the outer
//      layout (and page scroll) doesn't collapse and snap back.
//   3. `_enterPagination` / `_exitPagination` are pure ref-counter calls now
//      — no DOM overlay, no CSS class, no `visibility`/`pointer-events`.
//   4. Settle runs BEFORE the first `await` so the first paint already shows
//      the final layout.
//   5. input/blur handlers check `isConnected` — phantom events from pages
//      removed by `innerHTML = ''` cannot schedule reflows.
//   6. Equation repair runs SYNCHRONOUSLY inside pagination (no delayed
//      180 ms `scheduleEquationRecovery` reflow).
//   7. `_suppressFontSettleUntil` (3 s) prevents the `document.fonts`
//      loadingdone handler from re-settling right after pagination.
//   8. Pending debounce / style-reflow timers are cleared at the start.
// ========================================================================

// ===== DOM REFS =====
const docContainer = document.getElementById('document-view-container');
const chatHistoryArea = document.getElementById('chat-history');

// ============================================================
// CARET / MOUSE-CURSOR THEME REPAINT FIX
// ============================================================
function forceCursorRepaint() {
  if (!docContainer) return;
  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  if (!pages.length) return;
  const containerRect = docContainer.getBoundingClientRect();
  const visTop = containerRect.top;
  const visBottom = containerRect.bottom;
  const touched = [];
  pages.forEach(page => {
    const r = page.getBoundingClientRect();
    if (r.bottom < visTop || r.top > visBottom) return;
    touched.push({ el: page, prev: page.style.cursor });
    page.style.cursor = 'default';
  });
  if (!touched.length) return;
  void docContainer.offsetHeight;
  touched.forEach(t => { t.el.style.cursor = t.prev; });
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

function _mirrorPageFormatClasses(snapEl, pageEl) {
  const extra = Array.from(pageEl.classList).filter(c => /^(pdf-format-|text-format-)/.test(c));
  snapEl.className = 'doc-page-canvas pdf-export-measure-page' + (extra.length ? ' ' + extra.join(' ') : '');
}

function syncSnapshotFromPage(pageEl) {
  _mirrorPageFormatClasses(pageSnapshot, pageEl);
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
// ============================================================
const PERF = {
  SLICE_MS: 12,
  BIG_DOC_NODES: 25,
  BIG_DOC_PAGES: 30,
  LOCAL_REFLOW_MIN_PAGES: 8,
  RESYNC_EVERY: 12,
  INCREMENTAL_MEASURE: true
};

let _paginateRunId = 0;

// ============================================================
// FIX 1 — EXPORT NEVER SEES AN EMPTY / HALF-BUILT DOCUMENT
// While a pagination run is in flight the container is cleared
// (innerHTML = '') and refilled page by page. Anything reading the
// canvas in that window (export, save, preview) got '' or a partial
// document. We remember the source HTML of the running pagination and
// hand THAT out until the pages are fully built.
// ============================================================
let _activeSourceHTML = null;

function _sourceHtmlForExport() {
  const t = document.createElement('div');
  try { t.innerHTML = _safeHTML(_activeSourceHTML); } catch (_) { t.innerHTML = String(_activeSourceHTML || ''); }
  t.querySelectorAll('.page-footer-number').forEach(f => f.remove());
  try { if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(t); } catch (_) {}
  return t.innerHTML;
}

// Export code can `await window.whenPaginationIdle()` before reading the DOM.
window.whenPaginationIdle = function(timeoutMs) {
  const limit = Date.now() + (timeoutMs || 15000);
  return new Promise(resolve => {
    const tick = () => {
      let busy = false;
      try {
        busy = _activeSourceHTML != null || _paginationActiveCount > 0 || _renderInFlight > 0 ||
               (typeof _paginateProgressiveBusy !== 'undefined' && _paginateProgressiveBusy);
      } catch (_) { busy = false; }
      if (!busy || Date.now() > limit) { resolve(!busy); return; }
      setTimeout(tick, 50);
    };
    tick();
  });
};

// Run `fn` with content-visibility virtualisation switched off, so every
// page is really laid out (html2canvas / measuring exporters need that).
window.withFullRender = async function(fn) {
  const root = document.documentElement;
  const hadNoCv = root.classList.contains('perf-no-cv');
  root.classList.add('perf-no-cv');
  root.classList.remove('perf-cv-on');
  void (docContainer && docContainer.offsetHeight);
  try { return await fn(); }
  finally {
    if (!hadNoCv) root.classList.remove('perf-no-cv');
    try { _syncVirtualRender(); } catch (_) {}
  }
};

// ============================================================
// FIX 2 — NO "SCROLL FROM THE TOP" WHEN CONTENT IS REBUILT / UPDATED
// - finds the REAL scrolling element (docContainer or an ancestor)
// - keeps the scroll range alive while the pages are rebuilt (bottom
//   padding), so the position can never clamp to 0
// - forces scroll-behavior:auto so restoring is instant, never animated
// ============================================================
function _getScrollEl() {
  let el = docContainer;
  while (el && el !== document.body && el !== document.documentElement) {
    let oy = '';
    try { oy = getComputedStyle(el).overflowY; } catch (_) {}
    if (/(auto|scroll|overlay)/.test(oy) && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function _beginScrollLock() {
  if (!docContainer) return null;
  const el = _getScrollEl();
  const st = {
    el,
    top: el.scrollTop,
    left: el.scrollLeft,
    prevBehavior: el.style.scrollBehavior,
    prevRootBehavior: document.documentElement.style.scrollBehavior,
    prevPad: docContainer.style.paddingBottom,
    userMoved: false,
    listeners: []
  };
  el.style.scrollBehavior = 'auto';
  document.documentElement.style.scrollBehavior = 'auto';
  try {
    const basePad = parseFloat(getComputedStyle(docContainer).paddingBottom) || 0;
    const extra = Math.max(el.scrollHeight || 0, docContainer.scrollHeight || 0);
    docContainer.style.paddingBottom = (basePad + extra) + 'px';
  } catch (_) {}
  const mark = () => { st.userMoved = true; };
  [docContainer, el].forEach(t => {
    if (!t || !t.addEventListener) return;
    ['wheel', 'touchmove'].forEach(ev => {
      t.addEventListener(ev, mark, { passive: true });
      st.listeners.push([t, ev, mark]);
    });
  });
  return st;
}

function _applyScrollLock(st) {
  if (!st || st.userMoved) return;
  try { st.el.scrollTop = st.top; st.el.scrollLeft = st.left; } catch (_) {}
}

function _endScrollLock(st) {
  if (!st) return;
  try { docContainer.style.paddingBottom = st.prevPad || ''; } catch (_) {}
  _applyScrollLock(st);
  st.listeners.forEach(([t, ev, fn]) => { try { t.removeEventListener(ev, fn); } catch (_) {} });
  st.listeners = [];
  const finish = () => {
    _applyScrollLock(st);
    st.el.style.scrollBehavior = st.prevBehavior || '';
    document.documentElement.style.scrollBehavior = st.prevRootBehavior || '';
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish); else finish();
}

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

// ---- CSS: off-screen pages skipped by layout & paint ----
(function injectPerfStyles() {
  if (document.getElementById('perf-boost-styles')) return;
  const st = document.createElement('style');
  st.id = 'perf-boost-styles';
  st.textContent = `
    html.perf-cv-on #document-view-container > .doc-page-canvas {
      content-visibility: auto;
      contain-intrinsic-size: ${EDITOR_A4_WIDTH}px ${EDITOR_A4_HEIGHT}px;
    }
    @media print {
      html.perf-cv-on #document-view-container > .doc-page-canvas { content-visibility: visible; }
    }`;
  document.head.appendChild(st);
})();
window.__setEditorVirtualRender = function(on) {
  document.documentElement.classList.toggle('perf-no-cv', !on);
};

// ---- WORD-NATIVE: square, flat editing pages (silent pagination) ----
// No overlay CSS, no spinner, no visibility hiding — pagination is silent.
(function injectWordNativePageStyles() {
  if (document.getElementById('word-native-page-styles')) return;
  const st = document.createElement('style');
  st.id = 'word-native-page-styles';
  st.textContent = `
    #document-view-container {
      scrollbar-gutter: stable;
      overflow-anchor: none;
      transition: none !important;
    }
    #document-view-container .doc-page-canvas,
    #document-view-container .doc-page-canvas[class*="pdf-format-"] {
      border-radius: 0 !important;
      border: 0 !important;
      outline: none;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.20) !important;
    }
    body.photocopy-mode #document-view-container .doc-page-canvas {
      box-shadow: 0 0 0 1px #000 !important;
    }
    #document-view-container .doc-page-canvas::before,
    #document-view-container .doc-page-canvas::after {
      border-radius: 0 !important;
    }
    .doc-page-canvas.pdf-export-measure-page {
      border: 0 !important;
      border-radius: 0 !important;
    }
    #document-view-container .doc-page-canvas[data-oversized="true"] {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }`;
  document.head.appendChild(st);
})();

// ============================================================
// SILENT PAGINATION — ref counter only (no DOM overlay, no CSS)
// Kept as a pure state counter so internal code can still check
// "is a pagination currently in progress?" without any visual side effect.
// ============================================================
let _paginationActiveCount = 0;

function _enterPagination() {
  _paginationActiveCount++;
}

function _exitPagination() {
  _paginationActiveCount = Math.max(0, _paginationActiveCount - 1);
}

// ---- Incremental "does it fit" measurer ----
function _makeContentFits(snapEl, syncFn) {
  let snapPage = null;
  let snapCount = 0;
  let pending = null;
  let pendingBase = -1;
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
    if (!extraNode) {
      syncFn(pageElement);
      snapPage = null; pending = null;
      void snapEl.offsetHeight;
      return snapEl.scrollHeight <= EDITOR_A4_HEIGHT + 1;
    }
    const n = pageElement.childNodes.length;
    if (snapPage === pageElement && pending && n === pendingBase + 1 && sinceSync < PERF.RESYNC_EVERY) {
      pending = null; snapCount = n; sinceSync++;
    } else if (snapPage === pageElement && pending && n === pendingBase) {
      try { snapEl.removeChild(pending); } catch (_) { fullSync(pageElement); }
      pending = null; snapCount = n;
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
let _htmlSetToken = 0;
let _renderInFlight = 0;

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

// ============================================================
// PAGINATION STABILITY HELPERS
// ============================================================
let _slicingDepth = 0;
let _suppressFontSettleUntil = 0;

async function _warmFonts(tempSource) {
  if (!document.fonts || !document.fonts.ready) return;
  const probe = document.createElement('div');
  probe.className = 'doc-page-canvas pdf-export-measure-page';
  probe.style.cssText = measurePage.style.cssText;
  probe.style.height = 'auto';
  probe.style.maxHeight = 'none';
  probe.style.overflow = 'visible';
  probe.style.visibility = 'visible';
  probe.style.opacity = '0';
  try {
    const kids = Array.from(tempSource.children);
    const step = Math.max(1, Math.floor(kids.length / 60));
    for (let i = 0; i < kids.length; i += step) probe.appendChild(kids[i].cloneNode(true));
    document.body.appendChild(probe);
    void probe.offsetHeight;
    await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 5000))]);
    void probe.offsetHeight;
  } catch (_) { /* best effort */ }
  finally { try { probe.remove(); } catch (_) {} }
}

function _settleOverflowingPages() {
  if (!docContainer) return;
  document.documentElement.classList.remove('perf-cv-on');
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  pages.forEach(resetPageToA4);
  let page = pages[0], moves = 0, guard = 0;
  while (page && moves < 3000 && guard++ < 30000) {
    if (page.dataset.oversized === 'true') { page = _nextEditorPage(page); continue; }
    if (!_wfFits(page)) {
      const overflow = getOverflowNodes(page);
      if (overflow.length) {
        if (overflow.length === 1 && _getSplittableChildrenForOverflow(overflow[0])) {
          _putBackBeforeFooter(page, overflow[0]);
          page = _nextEditorPage(page);
          continue;
        }
        _splitFirstOverflowParagraph(page, overflow);
        _moveOverflowToNextPage(page, overflow);
        moves++;
        continue;
      }
    }
    page = _nextEditorPage(page);
  }
  return moves;
}

function _reflowAfterStyleChange() {
  if (!docContainer) return;
  const marker = saveCaretPosition();
  try {
    _settleOverflowingPages();
    normalizeAllEditorPagesToA4();
    _removeTrailingEmptyPages();
    _syncVirtualRender();
  } finally { restoreCaretPosition(marker); }
}

let _styleReflowTimer = null;
function _scheduleStyleReflow() {
  if (_slicingDepth === 0 && _renderInFlight === 0 && _paginationActiveCount === 0) {
    clearTimeout(_styleReflowTimer);
    _styleReflowTimer = null;
    try { _reflowAfterStyleChange(); } catch (err) { console.warn('[style reflow]', err); }
    return;
  }
  clearTimeout(_styleReflowTimer);
  _styleReflowTimer = setTimeout(() => {
    if (_slicingDepth > 0 || _renderInFlight > 0 || _paginationActiveCount > 0) { _scheduleStyleReflow(); return; }
    try { _reflowAfterStyleChange(); } catch (err) { console.warn('[style reflow]', err); }
  }, 120);
}

async function _paginateNodesSliced(nodes, firstPage, createdPages, contentFits, createPage, runId, slicing) {
  let cur = firstPage;
  let t = performance.now();
  let lastFit = 0;
  _slicingDepth++;
  try {
    for (let i = 0; i < nodes.length; i++) {
      cur = _processPaginationNode(nodes[i], cur, createdPages, contentFits, createPage).currentPageElement;
      if (slicing && i < nodes.length - 1 && performance.now() - t > PERF.SLICE_MS) {
        _perfProgress(i + 1, nodes.length);
        if (performance.now() - lastFit > 250) {
          lastFit = performance.now();
          try { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); } catch (_) {}
        }
        await _perfYield();
        if (runId !== _paginateRunId) return false;
        t = performance.now();
      }
    }
    return true;
  } finally { _slicingDepth--; }
}

function _syncVirtualRender() {
  const n = docContainer ? docContainer.querySelectorAll(':scope > .doc-page-canvas').length : 0;
  document.documentElement.classList.toggle('perf-cv-on',
    n > 40 && !document.documentElement.classList.contains('perf-no-cv'));
}

// Font loadingdone debounce (silent — no overlay during this reflow either).
if (document.fonts && document.fonts.addEventListener && !window.__fontSettleBound) {
  window.__fontSettleBound = true;
  let _fontSettleTimer = null;
  document.fonts.addEventListener('loadingdone', () => {
    clearTimeout(_fontSettleTimer);
    _fontSettleTimer = setTimeout(() => {
      try {
        if (Date.now() < _suppressFontSettleUntil) return;
        if (!docContainer || _slicingDepth > 0 || _renderInFlight > 0 || _paginationActiveCount > 0) return;
        const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
        const bad = pages.some(p => p.dataset.oversized !== 'true' && !_wfFits(p));
        if (!bad) return;
        _enterPagination();
        const marker = saveCaretPosition();
        try {
          _settleOverflowingPages();
          normalizeAllEditorPagesToA4();
          _removeTrailingEmptyPages();
          _syncVirtualRender();
        } finally {
          restoreCaretPosition(marker);
          _exitPagination();
        }
      } catch (err) { console.warn('[font settle]', err); }
    }, 800);
  });
}

// ============================================================
// FIGURE LAYOUT
// ============================================================
const FIG = {
  ENABLED: true,
  SMALL_PCT: 34,
  MEDIUM_PCT: 62,
  LARGE_PCT: 90,
  SMALL_MAX_PX: 340,
  LARGE_MIN_TEXTS: 22,
  LARGE_MIN_PX: 1000
};
const _FIG_AUTO_PROPS = ['float', 'width', 'max-width', 'margin', 'display', 'clear', 'box-sizing'];

function _figIsFigureLike(el) {
  return !!(el && el.nodeType === 1 && el.matches && el.matches('.figure-pro, .figure-frame, .fc-wrapper'));
}
function _figInfo(fig) {
  const out = { w: 0, h: 0, texts: 0, media: 0 };
  const media = fig.querySelectorAll('svg, img, canvas');
  out.media = media.length;
  const svg = fig.querySelector('svg');
  if (svg) {
    out.texts = svg.querySelectorAll('text').length;
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { out.w = vb[2]; out.h = vb[3]; }
    else {
      const wa = svg.getAttribute('width') || '', ha = svg.getAttribute('height') || '';
      if (!/%/.test(wa) && !/%/.test(ha)) { out.w = parseFloat(wa) || 0; out.h = parseFloat(ha) || 0; }
    }
    return out;
  }
  const img = fig.querySelector('img');
  if (img) {
    out.w = img.naturalWidth || parseFloat(img.getAttribute('width')) || 0;
    out.h = img.naturalHeight || parseFloat(img.getAttribute('height')) || 0;
  }
  return out;
}
function _figSizeClass(fig, info) {
  const hint = (fig.getAttribute('data-fig-size') || '').toLowerCase();
  if (hint === 'small' || hint === 'medium' || hint === 'large') return hint;
  if (info.media > 1) return 'large';
  if (info.texts >= FIG.LARGE_MIN_TEXTS || info.w >= FIG.LARGE_MIN_PX) return 'large';
  if (info.w > 0 && info.w <= FIG.SMALL_MAX_PX && info.texts <= 8) return 'small';
  return 'medium';
}
function _figTextAfter(fig) {
  let n = fig.nextElementSibling, total = 0, count = 0;
  while (n && count < 3 && total < 2000) {
    if (!/^(P|UL|OL)$/.test(n.tagName)) break;
    if (n.querySelector('svg, img, table, .figure-pro, .figure-frame')) break;
    total += (n.textContent || '').trim().length;
    count++;
    n = n.nextElementSibling;
  }
  return total;
}
function _applyOneFigureLayout(fig, contentW) {
  if (fig.getAttribute('data-fig-layout') === 'manual') return;
  const wasAuto = fig.hasAttribute('data-fig-auto');
  if (!wasAuto && /^(left|right)$/.test(fig.style.float || '')) return;
  if (wasAuto) {
    _FIG_AUTO_PROPS.forEach(p => fig.style.removeProperty(p));
    fig.removeAttribute('data-fig-auto');
    fig.removeAttribute('data-fig-layout');
  }
  const info = _figInfo(fig);
  const size = _figSizeClass(fig, info);
  const prev = fig.previousElementSibling, next = fig.nextElementSibling;
  const parent = fig.parentElement;
  const siblingFigs = parent ? Array.from(parent.children).filter(_figIsFigureLike).length : 1;
  const single = !_figIsFigureLike(prev) && !_figIsFigureLike(next) && siblingFigs <= 1;
  const inBox = !!(parent && parent.closest && parent.closest('table, .block-solution, .quiz-container, .quiz-item, .cq-item'));

  let kind = 'center', pct = size === 'large' ? FIG.LARGE_PCT : FIG.MEDIUM_PCT;
  if (size === 'small' && single && !inBox) {
    const wantPct = info.w > 0 ? Math.min(FIG.SMALL_PCT, Math.max(22, (info.w / contentW) * 100)) : FIG.SMALL_PCT;
    const figW = contentW * wantPct / 100;
    const ratio = info.w > 0 && info.h > 0 ? info.h / info.w : 0.75;
    const figH = figW * ratio + 28;
    const needChars = Math.ceil(figH / 26) * ((contentW - figW - 20) / 8.5) * 0.7;
    if (_figTextAfter(fig) >= needChars) { kind = 'float'; pct = Math.round(wantPct); }
  }

  const s = fig.style;
  s.setProperty('box-sizing', 'border-box', 'important');
  s.setProperty('max-width', '100%', 'important');
  s.setProperty('display', 'block', 'important');
  s.setProperty('width', pct + '%', 'important');
  if (kind === 'float') {
    s.setProperty('float', 'right', 'important');
    s.setProperty('clear', 'none', 'important');
    s.setProperty('margin', '4px 0 10px 18px', 'important');
  } else {
    s.setProperty('float', 'none', 'important');
    s.setProperty('margin', '10px auto', 'important');
  }
  fig.setAttribute('data-fig-auto', '1');
  fig.setAttribute('data-fig-layout', kind === 'float' ? 'right-small' : 'center-' + (size === 'large' ? 'large' : 'medium'));
  fig.querySelectorAll('svg, img').forEach(m => {
    m.style.setProperty('max-width', '100%');
    const hasRatio = m.tagName === 'IMG' || m.getAttribute('viewBox') ||
      (parseFloat(m.getAttribute('width')) > 0 && parseFloat(m.getAttribute('height')) > 0 && !/%/.test(m.getAttribute('width') || ''));
    if (hasRatio) m.style.setProperty('height', 'auto');
  });
}
function _applyFigureLayout(root) {
  if (!FIG.ENABLED || !root || typeof root.querySelectorAll !== 'function') return;
  let contentW = 700;
  try { contentW = EDITOR_A4_WIDTH - (PDF_LAYOUT.padLeft + PDF_LAYOUT.padRight); } catch (_) {}
  if (!(contentW > 200)) contentW = 700;
  Array.from(root.querySelectorAll('.figure-pro, .figure-frame'))
    .filter(f => !(f.classList.contains('figure-frame') && f.parentElement && f.parentElement.closest('.figure-pro')))
    .forEach(f => { try { _applyOneFigureLayout(f, contentW); } catch (e) { console.warn('[figure layout]', e); } });
}
window.applyFigureLayout = _applyFigureLayout;
window.FIG_LAYOUT_CONFIG = FIG;

function _pageSnapshotHTML(page) {
  const clone = page.cloneNode(true);
  clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
  return clone.innerHTML;
}
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
    if (el.closest('.page-footer-number')) continue;
    const page = el.closest('.doc-page-canvas');
    if (!page) continue;
    if (r.type === 'attributes' && el === page) continue;
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
// PAGE CONTENT VALIDATION
// ============================================================
let _inkScratch = null;
function _canvasHasInk(canvas) {
  try {
    if (!canvas.width || !canvas.height) return false;
    if (!_inkScratch) _inkScratch = document.createElement('canvas');
    const W = Math.min(canvas.width, 320);
    const H = Math.max(1, Math.min(480, Math.round(canvas.height * (W / canvas.width))));
    _inkScratch.width = W;
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
function _getCoverLines() {
  try {
    if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG && Array.isArray(APP_CONFIG.BLANK_COVER_LINES)) return APP_CONFIG.BLANK_COVER_LINES;
  } catch (_) { /* use default */ }
  return DEFAULT_COVER_LINES;
}
const _squashText = (str) => String(str || '').replace(/[\s\u00a0]+/g, '').toLowerCase();

function pageHasContent(page) {
  if (!page) return false;
  if (page.querySelector('.blank-page-spacer')) return true;
  let rawText = '';
  for (const child of page.childNodes) {
    if (child.nodeType === 1 && child.classList && child.classList.contains('page-footer-number')) continue;
    rawText += child.textContent || '';
    rawText += ' ';
  }
  const text = rawText.replace(/[\s\u00a0]+/g, ' ').trim();
  const normalized = text.toLowerCase();

  const promptPhrases = [
    'start typing here',
    'or ask ai on the left to generate notes',
    'ask ai to create...'
  ];
  const coverJoined = _getCoverLines().join(' ');
  const placeholders = promptPhrases.concat([coverJoined]).map(_squashText).filter(Boolean);
  let rest = _squashText(text);
  placeholders.forEach(p => { rest = rest.split(p).join(''); });
  rest = rest.replace(/[^\p{L}\p{N}]+/gu, '');
  const isPhraseOnly = rest === '' || rest === 'page1' || rest === 'page1of1';
  const isShortWithPrompt = text.length <= 160 && promptPhrases.some(p => normalized.includes(p));
  const isCover = normalized.includes('created by tamim') && text.length <= 400;
  const isPlaceholderOnly = isPhraseOnly || isShortWithPrompt || isCover;

  const hasVisual = !!page.querySelector('img, svg, table, .katex-eq, .fc-wrapper, .figure-pro, .block-solution, .quiz-container');

  let hasCanvasInk = false;
  const canvases = page.querySelectorAll('canvas');
  for (const canvas of canvases) {
    if (_canvasHasInk(canvas)) { hasCanvasInk = true; break; }
  }

  const hasMeaningfulText = text.length >= 1 && !isPlaceholderOnly;
  return hasMeaningfulText || hasVisual || hasCanvasInk;
}

function _fillBlankSolePageWithCoverPlaceholder() {
  if (!docContainer) return;
  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  if (pages.length !== 1) return;
  const page = pages[0];
  if (pageHasContent(page)) return;
  try { if (getPaginateCompactLevel() > 0) _setPaginateCompactLevel(0); } catch (_) { /* not initialised yet */ }
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
  const allEmpty = pages.every(page => !pageHasContent(page));
  const empties = pages.filter(page => !pageHasContent(page) && !_pageIsActive(page));
  const removable = allEmpty ? empties.filter(p => p !== pages[0]) : empties;
  removable.forEach(page => page.parentNode && page.parentNode.removeChild(page));
  if (typeof updatePageFooters === 'function') updatePageFooters();
}

let _lastEmptyRemovalToastAt = 0;
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
    const now = Date.now();
    if (now - _lastEmptyRemovalToastAt > 500 && typeof displayToastNotification === 'function') {
      displayToastNotification(`🧹 Removed ${removedCount} empty page(s)`);
      _lastEmptyRemovalToastAt = now;
    }
  }
}

// ===== HISTORY (Undo/Redo) =====
const HISTORY = {
  undoStack: [],
  redoStack: [],
  maxSize: 30,

  saveState() {
    if (_slicingDepth > 0 || _paginationActiveCount > 0) {
      if (!this._saveRetry) {
        this._saveRetry = setTimeout(() => { this._saveRetry = null; this.saveState(); }, 400);
      }
      return;
    }
    const currentHTML = getCanvasSnapshotHTML();
    if (!currentHTML && _renderInFlight > 0 && this.undoStack.length > 0) return;
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === currentHTML) return;
    this.undoStack.push(currentHTML);
    const _limit = currentHTML.length > 3000000 ? 3 : currentHTML.length > 800000 ? 8 : this.maxSize;
    while (this.undoStack.length > _limit) this.undoStack.shift();
    this.redoStack = [];
    if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._persist(currentHTML);
    }
  },

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
      TAB_MANAGER._persist();
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
  if (ae && ae.isContentEditable && !(docContainer && docContainer.contains(ae))) return;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = (e.key || '').toLowerCase();
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
  if (_activeSourceHTML != null) return _sourceHtmlForExport();   // pagination in flight: DOM is half-built
  if (_pageCacheObserver) _perfInvalidateFromRecords(_pageCacheObserver.takeRecords());
  const parts = [];
  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  for (const page of pages) {
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

function getCanvasSnapshotHTML() {
  if (!docContainer) return '';
  if (_activeSourceHTML != null) return _activeSourceHTML;        // pagination in flight: DOM is half-built
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
    if (e.html.replace(/<p class="blank-page-spacer">(?:&nbsp;|\u00a0)<\/p>/g, '').trim() === '') return BR + e.html + BR;
    return e.html;
  }).join('');
}
window.getCanvasSnapshotHTML = getCanvasSnapshotHTML;

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

// ===== SET DOCUMENT HTML WITH PAGINATION =====
let autoSaveTimer = null;
let _autoSavePending = false;
let paginationDebounceTimer = null;

function debouncedAutoSaveAndPaginate() {
  clearTimeout(autoSaveTimer);
  _autoSavePending = true;
  autoSaveTimer = setTimeout(() => { _autoSavePending = false; HISTORY.saveState(); }, 1200);
  scheduleReflow();
}

let _imeComposing = false;
let _imeLastActivity = 0;
if (docContainer) {
  docContainer.addEventListener('compositionstart', () => { _imeComposing = true; _imeLastActivity = Date.now(); }, true);
  docContainer.addEventListener('compositionupdate', () => { _imeLastActivity = Date.now(); }, true);
  docContainer.addEventListener('compositionend', () => { _imeComposing = false; scheduleReflow(); }, true);
}

function scheduleReflow() {
  clearTimeout(paginationDebounceTimer);
  if (_paginationActiveCount > 0) {
    paginationDebounceTimer = setTimeout(() => scheduleReflow(), 300);
    return;
  }
  const _pageCount = docContainer ? docContainer.querySelectorAll('.doc-page-canvas').length : 0;
  const _delay = _pageCount <= PERF.LOCAL_REFLOW_MIN_PAGES ? 90 : 300;
  paginationDebounceTimer = setTimeout(() => {
    if (_imeComposing && Date.now() - _imeLastActivity < 1500) { scheduleReflow(); return; }
    _imeComposing = false;
    if (_slicingDepth > 0 || _renderInFlight > 0 || _paginationActiveCount > 0) { scheduleReflow(); return; }
    reflowDocument(_takeDirtyPages());
  }, _delay);
}

let _caretMarkerSeq = 0;
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
  if (parent.normalize) parent.normalize();
}

function _isWholeBlockNodeForPagination(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node.tagName || '').toUpperCase();
  return ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV', 'TABLE', 'UL', 'OL', 'FIGURE'].includes(tag);
}

function flattenContentTopLevelNodes(tempSource) {
  _mergeSplitBlocks(tempSource);
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

      if (onlyInlineChildren || !hasBlockChild) {
        topLevelNodes.push(node);
        return;
      }

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

// THEME-FLASH FIX: every page is born already wearing the active theme/text format.
function _stampActiveFormatsOnPage(page) {
  if (!page || page.nodeType !== 1) return page;
  try {
    const mono = !!(document.body && document.body.classList.contains('photocopy-mode'));
    let vis = 'default', txt = 'default';
    try { vis = (typeof getActivePDFVisualFormat === 'function' && getActivePDFVisualFormat()) || 'default'; } catch (_) {}
    try { txt = (typeof getActivePDFTextFormat === 'function' && getActivePDFTextFormat()) || 'default'; } catch (_) {}
    if (typeof PDF_VISUAL_FORMAT_IDS !== 'undefined' && !PDF_VISUAL_FORMAT_IDS.includes(vis)) vis = 'default';
    if (typeof PDF_TEXT_FORMAT_IDS !== 'undefined' && !PDF_TEXT_FORMAT_IDS.includes(txt)) txt = 'default';
    if (mono) vis = 'default';
    if (vis !== 'default') page.classList.add('pdf-format-' + vis);
    page.dataset.pdfFormatApplied = vis;
    if (txt !== 'default') page.classList.add('text-format-' + txt);
    page.dataset.pdfTextFormatApplied = txt;
  } catch (_) { /* never block page creation */ }
  return page;
}

function _renderDocumentHTMLPlainFallback(rawHtml, triggerSave) {
  if (!docContainer) return;
  docContainer.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'doc-page-canvas';
  _stampActiveFormatsOnPage(page);
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

// ========================================================================
// SILENT PAGINATION — no overlay, no spinner, no visual of any kind.
// All bounce-prevention logic is kept so that even though the user sees
// no indicator, they also see no flash, no scroll jump, and no second
// reflow after the pages have settled.
// ========================================================================
async function _paginateDocumentHTMLCore(rawHtml, triggerSave = true) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  if (!docContainer) return;
  const runId = ++_paginateRunId;
  _activeSourceHTML = rawHtml;

  // Cancel pending timers — a stray reflow mid-pagination would be visible.
  clearTimeout(paginationDebounceTimer);
  clearTimeout(_styleReflowTimer);
  paginationDebounceTimer = null;
  _styleReflowTimer = null;
  _dirtyPages.clear();

  // Lock the container height so the outer layout (scrollbar, other UI)
  // does not jump when innerHTML = '' collapses it. This is the #1 scroll
  // stability fix; it is invisible to the user.
  const prevHeight = Math.max(docContainer.scrollHeight || 0, 400);
  const prevMinHeight = docContainer.style.minHeight;
  docContainer.style.minHeight = prevHeight + 'px';
  const prevOverflowAnchor = docContainer.style.overflowAnchor;
  docContainer.style.overflowAnchor = 'none';

  _enterPagination();
  document.documentElement.classList.remove('perf-cv-on');
  window.__mathLastOverflowSig = null;
  const scrollLock = _beginScrollLock();
  const markerId = _saveCaretOffset();
  try {
    docContainer.innerHTML = '';
    const tempSource = document.createElement('div');
    tempSource.innerHTML = _prepareHTML(rawHtml);
    if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(tempSource);
    _applyFigureLayout(tempSource);
    if (!(await _perfPreRenderMath(tempSource, runId))) return;
    if (typeof ensureKatexDelimiterFonts === 'function') {
      try { await ensureKatexDelimiterFonts(); } catch (_) { /* best effort */ }
    }
    await _warmFonts(tempSource);

    function createNewPageElement() {
      const page = document.createElement('div');
      page.className = 'doc-page-canvas';
      _stampActiveFormatsOnPage(page);
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
    const contentFits = _makeContentFits(pageSnapshot, syncSnapshotFromPage);

    const okRun = await _paginateNodesSliced(topLevelNodes, currentPage, createdPages, contentFits,
      createNewPageElement, runId, topLevelNodes.length > PERF.BIG_DOC_NODES);
    if (!okRun) return;

    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();

    // Settle SYNCHRONOUSLY now, before any await, so the first paint
    // already shows the final layout (no visible intermediate state).
    _wfPostPaginate();
    _settleOverflowingPages();
    normalizeAllEditorPagesToA4();
    _syncVirtualRender();
    _removeEmptyEditorPages();

    // Restore scroll as early as possible so the user's viewport is stable.
    _applyScrollLock(scrollLock);

    await new Promise(r => setTimeout(r, 30));
    if (runId !== _paginateRunId) return;
    _settleOverflowingPages();
    normalizeAllEditorPagesToA4();
    _removeTrailingEmptyPages();
    _fillBlankSolePageWithCoverPlaceholder();

    if (!(await _perfPostProcessPages(runId))) return;
    if (typeof applyPDFVisualFormat === 'function') applyPDFVisualFormat(typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default');

    // Synchronous equation repair — replaces the old 180 ms delayed
    // scheduleEquationRecovery which was a second visible reflow.
    if (typeof repairEquationsInNewContent === 'function') {
      try { await repairEquationsInNewContent(); } catch (_) {}
    }

    _settleOverflowingPages();
    normalizeAllEditorPagesToA4();
    _removeTrailingEmptyPages();
    _syncVirtualRender();

    if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
    _applyScrollLock(scrollLock);
    _restoreCaretOffset(markerId);

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
    if (_isPdfViewVisible() && typeof generateLivePDFIframePreview === 'function') {
      generateLivePDFIframePreview();
    }
  } finally {
    // Release the min-height lock and restore overflow-anchor.
    docContainer.style.minHeight = prevMinHeight || '';
    docContainer.style.overflowAnchor = prevOverflowAnchor || '';
    if (runId === _paginateRunId) _activeSourceHTML = null;
    _endScrollLock(scrollLock);
    // Suppress font-loadingdone re-settle for 3 s.
    _suppressFontSettleUntil = Date.now() + 3000;
    _exitPagination();
  }
}


// ========================================================================
// WORD-LIKE FLOW
// ========================================================================
const WORD_FLOW = {
  SPLIT_DESIGNED_BOXES: true,
  KEEP_HEADING_WITH_NEXT: true,
  PULL_UP: true
};
const _WF_ALWAYS_WHOLE = ['figure-pro', 'figure-frame', 'fc-wrapper', 'omr-sheet-page',
  'quiz-item', 'cq-item', 'math-final-answer', 'sol-label'];
function _wfIsAlwaysWhole(node) {
  return !!(node && node.classList && _WF_ALWAYS_WHOLE.some(c => node.classList.contains(c)));
}
function _wfIsHeading(n) { return !!(n && n.nodeType === 1 && /^H[1-6]$/.test(n.tagName)); }
function _wfFooter(page) { return page.querySelector(':scope > .page-footer-number'); }
function _wfContent(page) {
  return Array.from(page.childNodes).filter(n => n.nodeType === 1
    ? !n.classList.contains('page-footer-number')
    : n.textContent.trim().length > 0);
}
function _wfFits(page) {
  const z = parseFloat(page.style.zoom) || 1;
  return (page.scrollHeight / z) <= EDITOR_A4_HEIGHT + 1;
}
function _wfCleanClass(el) { if (el && !el.getAttribute('class')) el.removeAttribute('class'); }

function _wfKeepWithNext(page) {
  if (!WORD_FLOW.KEEP_HEADING_WITH_NEXT) return false;
  const c = _wfContent(page);
  if (c.length < 2) return false;
  const last = c[c.length - 1];
  if (!_wfIsHeading(last)) return false;
  let next = _nextEditorPage(page);
  if (!next) return false;
  next.insertBefore(last, next.firstChild);
  return true;
}

function _wfPullUp(page) {
  const next = _nextEditorPage(page);
  if (!next) return 'none';
  const nc = _wfContent(next);
  if (!nc.length) {
    if (document.activeElement !== next) { next.remove(); return 'moved'; }
    return 'none';
  }
  const first = nc[0];
  const cur = _wfContent(page);
  const last = cur[cur.length - 1] || null;
  const footer = _wfFooter(page);
  const putBack = (n) => next.insertBefore(n, next.firstChild);
  const place = (n) => page.insertBefore(n, footer || null);

  if (_wfIsHeading(first) && WORD_FLOW.KEEP_HEADING_WITH_NEXT) {
    place(first);
    if (!_wfFits(page)) { putBack(first); return 'blocked'; }
    const r = _wfPullUp(page);
    if (r === 'blocked' || r === 'none') { putBack(first); return 'blocked'; }
    return r;
  }

  if (first.nodeType === 1 && first.classList.contains('split-tail') && last && last.nodeType === 1 &&
      last.classList.contains('split-head') && last.tagName === first.tagName) {
    while (first.firstChild) last.appendChild(first.firstChild);
    first.remove();
    last.classList.remove('split-head'); _wfCleanClass(last);
    if (_wfFits(page)) return 'moved';
    page.removeChild(last);
    return _wfSplitInto(page, next, last);
  }

  if (first.nodeType === 1 && first.hasAttribute('data-split-cont') && last && last.nodeType === 1 &&
      last.tagName === first.tagName) {
    const isTable = first.tagName === 'TABLE';
    const dst = isTable ? last.querySelector(':scope > tbody:last-of-type') : last;
    const src = isTable ? first.querySelector(':scope > tbody') : first;
    if (dst && src) {
      let moved = 0;
      while (src.firstElementChild) {
        const row = src.firstElementChild;
        dst.appendChild(row);
        if (!_wfFits(page)) { src.insertBefore(row, src.firstChild); break; }
        moved++;
      }
      if (first.tagName === 'OL' && moved && first.hasAttribute('start')) {
        first.setAttribute('start', String((parseInt(first.getAttribute('start'), 10) || 1) + moved));
      }
      if (!src.firstElementChild) { first.remove(); return 'moved'; }
      return moved ? 'partial' : 'blocked';
    }
  }

  place(first);
  if (_wfFits(page)) return 'moved';
  page.removeChild(first);
  putBack(first);

  if (first.nodeType === 1 && _isTextSplittableBlock(first)) {
    next.removeChild(first);
    return _wfSplitInto(page, next, first);
  }
  return 'blocked';
}

function _wfSplitInto(page, next, node) {
  const footer = _wfFooter(page);
  const probe = (head) => {
    page.insertBefore(head, footer || null);
    const fits = _wfFits(page);
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
  const split = _isTextSplittableBlock(node) ? _chooseParagraphSplit(node, probe, _wfContent(page).length > 0) : null;
  if (!split) { next.insertBefore(node, next.firstChild); return 'blocked'; }
  page.insertBefore(split.head, footer || null);
  next.insertBefore(split.tail, next.firstChild);
  return 'partial';
}

function _wfFillFromNext(page) {
  if (!WORD_FLOW.PULL_UP) return false;
  let guard = 0, r, any = false;
  while (guard++ < 400) {
    r = _wfPullUp(page);
    if (r === 'moved') { any = true; continue; }
    if (r === 'partial') any = true;
    break;
  }
  return any;
}

function _wfPostPaginate() {
  if (!docContainer || !WORD_FLOW.KEEP_HEADING_WITH_NEXT) return;
  let page = docContainer.querySelector('.doc-page-canvas');
  let guard = 0;
  while (page && guard++ < 5000) {
    if (_wfKeepWithNext(page)) {
      const nxt = _nextEditorPage(page);
      let g2 = 0;
      while (nxt && g2++ < 40 && !_wfFits(nxt)) {
        const ov = getOverflowNodes(nxt);
        if (!ov.length) break;
        _splitFirstOverflowParagraph(nxt, ov);
        _moveOverflowToNextPage(nxt, ov);
      }
    }
    page = _nextEditorPage(page);
  }
}

// ===== CHUNKED PAGINATION FOR LONG DOCUMENTS =====
const PAGINATION_CHUNK_SIZE = 60;

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
    if (_isDesignedBoxBlock(node) && !(WORD_FLOW.SPLIT_DESIGNED_BOXES && !_wfIsAlwaysWhole(node))) return null;
    const children = Array.from(node.childNodes).filter(c =>
      c.nodeType === Node.ELEMENT_NODE || (c.nodeType === Node.TEXT_NODE && c.textContent.trim().length > 0));
    return children.length > 1 ? children : null;
  }
  return null;
}

function _appendPossiblyOversizedNode(node, currentPageElement, createdPages, contentFits, createNewPageElement) {
  const splitChildren = _getSplittableChildrenForOverflow(node);
  const renderMath = (el) => {
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(el);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(el);
  };
  if (!splitChildren) {
    if (_isTextSplittableBlock(node)) {
      return _splitTextBlockAcrossPages(node, currentPageElement, createdPages, contentFits, createNewPageElement, renderMath);
    }
    const clone = node.cloneNode(true);
    currentPageElement.appendChild(clone);
    renderMath(clone);
    return currentPageElement;
  }

  const isTable = (node.tagName || '').toUpperCase() === 'TABLE';
  const headerRows = isTable
    ? splitChildren.filter(r => (r.parentElement && r.parentElement.tagName === 'THEAD') ||
        (r.children.length > 0 && Array.from(r.children).every(c => c.tagName === 'TH')))
    : [];
  const bodyRows = headerRows.length ? splitChildren.filter(r => !headerRows.includes(r)) : splitChildren;

  let firstWrapper = true;
  const isOl = (node.tagName || '').toUpperCase() === 'OL';
  const olBase = isOl ? (parseInt(node.getAttribute('start'), 10) || 1) : 1;
  let placedItems = 0;
  function startWrapperOnCurrentPage() {
    const isFirst = firstWrapper;
    firstWrapper = false;
    const w = node.cloneNode(false);
    if (!isFirst) {
      w.setAttribute('data-split-cont', '1');
      if (isOl) w.setAttribute('start', String(olBase + placedItems));
    }
    currentPageElement.appendChild(w);
    let host = w;
    if (isTable) {
      Array.from(node.children).forEach(ch => {
        if (ch.tagName === 'COLGROUP' || (isFirst && ch.tagName === 'CAPTION')) w.appendChild(ch.cloneNode(true));
      });
      if (headerRows.length) {
        const thead = document.createElement('thead');
        if (!isFirst) thead.setAttribute('data-split-repeat', '1');
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
      const otherContent = Array.from(currentPageElement.childNodes).some(n => n !== cur.w &&
        (n.nodeType === 1 ? !(n.classList && n.classList.contains('page-footer-number')) : n.textContent.trim().length > 0));
      if (wrapperHasChild || otherContent) {
        cur.host.removeChild(childClone);
        if (!wrapperHasChild) {
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
    if (isOl) placedItems++;
  });

  return currentPageElement;
}

// ===== TEXT-LEVEL PAGE BREAKING =====
const _TEXT_SPLIT_MIN_CHARS = 30;
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

function _canSplitBlock(node) {
  return !!_getSplittableChildrenForOverflow(node) || _isTextSplittableBlock(node);
}

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
      const off = m.index + m[0].length;
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

function _chooseParagraphSplit(node, probe, hasOtherContent) {
  const { pts, total } = _textBreakPoints(node);
  if (!pts.length) return null;
  let lo = 0, hi = pts.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (probe(_splitTextBlockAt(node, pts[mid], true).head).fits) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  let idx = best;
  const info = probe(_splitTextBlockAt(node, pts[best], true).head);
  if (info.fits && info.h > 0 && info.lh > 0) {
    const headLines = Math.max(1, Math.round(info.h / info.lh));
    const cpl = pts[best].chars / headLines;
    let strict = idx;
    while (strict >= 0 && (total - pts[strict].chars) < 2 * cpl) strict--;
    if (strict >= 0 && (!hasOtherContent || pts[strict].chars / cpl >= 1.5)) idx = strict;
    else if (hasOtherContent) return null;
  }
  return _splitTextBlockAt(node, pts[idx], false);
}

function _splitTextBlockAcrossPages(node, page, createdPages, contentFits, createNewPage, renderMath) {
  const hasOther = (p) => Array.from(p.childNodes).some(n => n.nodeType === 1
    ? !(n.classList && n.classList.contains('page-footer-number')) : n.textContent.trim().length > 0);
  let rest = node;
  let guard = 0;
  while (rest && guard++ < 500) {
    const probe = (head) => {
      page.appendChild(head);
      const fits = contentFits(page);
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
      if (hasOther(page)) { page = createNewPage(); createdPages.push(page); continue; }
      const c = rest.cloneNode(true);
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
  Array.from(root.querySelectorAll('[data-split-cont]')).forEach(el => {
    el.removeAttribute('data-split-cont');
    const prev = el.previousElementSibling;
    if (!prev || prev.tagName !== el.tagName) return;
    if (el.tagName === 'TABLE') {
      const dst = prev.querySelector(':scope > tbody:last-of-type') || prev;
      const src = el.querySelector(':scope > tbody');
      if (src) while (src.firstChild) dst.appendChild(src.firstChild);
    } else {
      while (el.firstChild) prev.appendChild(el.firstChild);
    }
    el.remove();
  });
  Array.from(root.querySelectorAll('[data-split-repeat]')).forEach(el => el.removeAttribute('data-split-repeat'));
  Array.from(root.querySelectorAll('.split-tail')).forEach(el => {
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

  const hasContent = Array.from(currentPageElement.childNodes).some(n => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim().length > 0;
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (n.classList && n.classList.contains('page-footer-number')) return false;
      return true;
    }
    return false;
  });

  if (hasContent && !contentFits(currentPageElement, node)) {
    const tag = (node.tagName || '').toUpperCase();
    const splitChildren = _getSplittableChildrenForOverflow(node);
    if (splitChildren) {
      currentPageElement = _appendPossiblyOversizedNode(node, currentPageElement, createdPages, contentFits, createNewPageElement);
      return { currentPageElement, createdPages, handled: true };
    }
    if (_isTextSplittableBlock(node)) {
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
    currentPageElement = _appendPossiblyOversizedNode(node, currentPageElement, createdPages, contentFits, createNewPageElement);
    return { currentPageElement, createdPages, handled: true };
  }

  const clone = node.cloneNode(true);
  currentPageElement.appendChild(clone);
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(clone);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(clone);
  return { currentPageElement, createdPages, handled: true };
}


// ========================================================================
// CHUNKED / ASYNC PAGINATION (silent — no overlay, no spinner)
// ========================================================================
async function paginateDocumentCanvasAsync(rawHtml, triggerSave = true) {
  if (!docContainer) return;
  const token = ++_htmlSetToken;
  _renderInFlight++;
  try {
    try {
      await _paginateDocumentCanvasAsyncCore(rawHtml, triggerSave);
    } catch (err) {
      console.error('[paginateDocumentCanvasAsync] pagination failed, showing plain fallback:', err);
      _renderDocumentHTMLPlainFallback(rawHtml, triggerSave);
      await new Promise(resolve => setTimeout(resolve, 400));
      if (token !== _htmlSetToken) return;
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
  finally { scratch.els.forEach(el => { try { el.remove(); } catch (_) {} }); }
}

// ========================================================================
// SILENT PAGINATION — chunked path. No overlay, no spinner, no visual.
// All bounce-prevention logic kept so the user sees no flash, no scroll
// jump, and no second reflow after the pages have settled.
// ========================================================================
async function _paginateDocumentCanvasAsyncCoreImpl(rawHtml, triggerSave, scratch) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  if (!docContainer) return;
  const runId = ++_paginateRunId;
  _activeSourceHTML = rawHtml;

  // Cancel pending timers — a stray reflow mid-pagination would be visible.
  clearTimeout(paginationDebounceTimer);
  clearTimeout(_styleReflowTimer);
  paginationDebounceTimer = null;
  _styleReflowTimer = null;
  _dirtyPages.clear();

  // Lock the container height so the outer layout doesn't jump during
  // innerHTML = '' — this is the #1 scroll stability fix. Invisible.
  const prevHeight = Math.max(docContainer.scrollHeight || 0, 400);
  const prevMinHeight = docContainer.style.minHeight;
  docContainer.style.minHeight = prevHeight + 'px';
  const prevOverflowAnchor = docContainer.style.overflowAnchor;
  docContainer.style.overflowAnchor = 'none';

  _enterPagination();
  document.documentElement.classList.remove('perf-cv-on');
  window.__mathLastOverflowSig = null;
  const scrollLock = _beginScrollLock();
  const markerId = _saveCaretOffset();
  try {
    docContainer.innerHTML = '';
    const tempSource = document.createElement('div');
    tempSource.innerHTML = _prepareHTML(rawHtml);
    if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(tempSource);
    _applyFigureLayout(tempSource);
    if (!(await _perfPreRenderMath(tempSource, runId))) return;
    if (typeof ensureKatexDelimiterFonts === 'function') {
      try { await ensureKatexDelimiterFonts(); } catch (_) { /* best effort */ }
    }
    await _warmFonts(tempSource);

    function createNewPageElement() {
      const page = document.createElement('div');
      page.className = 'doc-page-canvas';
      _stampActiveFormatsOnPage(page);
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

    const pageSnapshot = document.createElement('div');
    pageSnapshot.className = 'doc-page-canvas pdf-export-measure-page';
    pageSnapshot.style.cssText = measurePage.style.cssText;
    document.body.appendChild(pageSnapshot);
    scratch.els.push(pageSnapshot);

    function syncSnapshotFromPage(pageEl) {
      _mirrorPageFormatClasses(pageSnapshot, pageEl);
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
    const useChunking = topLevelNodes.length > PERF.BIG_DOC_NODES;

    let userScrolledDuringPagination = false;
    const _markUserScrollIntent = () => { userScrolledDuringPagination = true; };
    docContainer.addEventListener('wheel', _markUserScrollIntent, { passive: true });
    docContainer.addEventListener('touchmove', _markUserScrollIntent, { passive: true });
    docContainer.addEventListener('keydown', _markUserScrollIntent, { passive: true });

    const okRun = await _paginateNodesSliced(topLevelNodes, currentPage, createdPages, contentFits,
      createNewPageElement, runId, useChunking);
    if (!okRun) {
      docContainer.removeEventListener('wheel', _markUserScrollIntent);
      docContainer.removeEventListener('touchmove', _markUserScrollIntent);
      docContainer.removeEventListener('keydown', _markUserScrollIntent);
      return;
    }

    docContainer.removeEventListener('wheel', _markUserScrollIntent);
    docContainer.removeEventListener('touchmove', _markUserScrollIntent);
    docContainer.removeEventListener('keydown', _markUserScrollIntent);

    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();

    // Settle BEFORE the async yield (was after setTimeout(30) — the biggest
    // single source of the visible bounce on chunked documents).
    _wfPostPaginate();
    _settleOverflowingPages();
    normalizeAllEditorPagesToA4();
    _syncVirtualRender();
    if (!userScrolledDuringPagination) _applyScrollLock(scrollLock);

    await new Promise(r => setTimeout(r, 30));
    if (runId !== _paginateRunId) return;
    _settleOverflowingPages();
    normalizeAllEditorPagesToA4();

    _removeTrailingEmptyPages();
    _fillBlankSolePageWithCoverPlaceholder();

    if (!(await _perfPostProcessPages(runId))) return;
    if (typeof applyPDFVisualFormat === 'function') applyPDFVisualFormat(typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default');

    // Synchronous equation repair — replaces the old 180 ms delayed
    // scheduleEquationRecovery which was a second visible reflow.
    if (typeof repairEquationsInNewContent === 'function') {
      try { await repairEquationsInNewContent(); } catch (_) {}
    }

    _settleOverflowingPages();
    normalizeAllEditorPagesToA4();
    _removeTrailingEmptyPages();
    _syncVirtualRender();

    if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
    if (!userScrolledDuringPagination) _applyScrollLock(scrollLock);
    _restoreCaretOffset(markerId);

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
    if (_isPdfViewVisible() && typeof generateLivePDFIframePreview === 'function') {
      generateLivePDFIframePreview();
    }
  } finally {
    docContainer.style.minHeight = prevMinHeight || '';
    docContainer.style.overflowAnchor = prevOverflowAnchor || '';
    if (runId === _paginateRunId) _activeSourceHTML = null;
    _endScrollLock(scrollLock);
    _suppressFontSettleUntil = Date.now() + 3000;
    _exitPagination();
  }
}

// ===== PAGE EVENT HANDLERS =====

function _pgRectOfRange(range) {
  if (!range) return null;
  const list = range.getClientRects();
  if (list && list.length) return list[0];
  const r = range.getBoundingClientRect();
  if (r && (r.height || r.width)) return r;
  const el = range.startContainer && range.startContainer.nodeType === 1
    ? range.startContainer : (range.startContainer && range.startContainer.parentElement);
  return el ? el.getBoundingClientRect() : null;
}

function _pgCaretFromPoint(x, y) {
  try {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      const r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
      return r;
    }
  } catch (_) { /* fall through */ }
  return null;
}

function _pgOnEdgeLine(sel, dir) {
  try {
    if (!sel || !sel.rangeCount || typeof sel.modify !== 'function') return null;
    const r0 = sel.getRangeAt(0).cloneRange();
    const rect0 = _pgRectOfRange(r0);
    sel.modify('move', dir < 0 ? 'backward' : 'forward', 'line');
    const r1 = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const rect1 = _pgRectOfRange(r1);
    sel.removeAllRanges();
    sel.addRange(r0);
    if (!rect0 || !rect1) return null;
    const h = Math.max(rect0.height || 0, 8);
    const moved = dir < 0 ? (rect0.top - rect1.top) : (rect1.top - rect0.top);
    return moved < h * 0.5;
  } catch (_) { return null; }
}

function _pgCaretAtPageEnd(page, range) {
  try {
    const footer = page.querySelector(':scope > .page-footer-number');
    const post = document.createRange();
    post.selectNodeContents(page);
    post.setStart(range.endContainer, range.endOffset);
    if (footer) post.setEndBefore(footer);
    if (post.toString().replace(/[\s\u200b\u00a0]/g, '') !== '') return false;
    return !post.cloneContents().querySelector('img,svg,canvas,hr,video,iframe,.katex,.katex-eq');
  } catch (_) { return false; }
}

function _pgPlaceCaret(page, where, x) {
  if (!page) return;
  try { page.focus({ preventScroll: true }); } catch (_) { page.focus(); }
  const sel = window.getSelection();
  const footer = page.querySelector(':scope > .page-footer-number');
  const base = document.createRange();
  base.selectNodeContents(page);
  if (where === 'start') {
    base.collapse(true);
  } else if (footer) {
    base.setStartBefore(footer);
    base.setEndBefore(footer);
  } else {
    base.collapse(false);
  }
  let target = base;
  if (typeof x === 'number' && isFinite(x)) {
    const content = Array.from(page.children).filter(c => !c.classList.contains('page-footer-number'));
    const el = where === 'start' ? content[0] : content[content.length - 1];
    if (el) {
      const rr = el.getBoundingClientRect();
      const y = where === 'start' ? rr.top + 6 : rr.bottom - 6;
      const hit = _pgCaretFromPoint(x, y);
      if (hit && page.contains(hit.startContainer) && !(footer && footer.contains(hit.startContainer))) target = hit;
    }
  }
  sel.removeAllRanges();
  sel.addRange(target);
  const anchorEl = target.startContainer && target.startContainer.nodeType === 1
    ? target.startContainer : (target.startContainer && target.startContainer.parentElement);
  if (anchorEl && anchorEl.scrollIntoView) anchorEl.scrollIntoView({ block: 'nearest' });
}

function handlePageKeydown(e) {
  if (!docContainer) return;
  if (e.isComposing) return;
  const page = e.currentTarget;
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const pageIndex = pages.indexOf(page);

  const _upFallback = e.key === 'ArrowUp' && typeof selection.modify !== 'function';
  if ((e.key === 'Backspace' || e.key === 'ArrowLeft' || _upFallback) && !e.shiftKey && selection.focusOffset === 0) {
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
        return;
      }
    }
  }

  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !selection.isCollapsed) return;
  if (pageIndex < 0) return;
  const cur = selection.getRangeAt(0);

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const down = e.key === 'ArrowDown';
    const neighbour = pages[pageIndex + (down ? 1 : -1)];
    if (!neighbour) return;
    const rect = _pgRectOfRange(cur);
    const x = rect ? rect.left : undefined;
    if (_pgOnEdgeLine(selection, down ? 1 : -1) === true) {
      e.preventDefault();
      _pgPlaceCaret(neighbour, down ? 'start' : 'end', x);
    }
    return;
  }

  if (e.key === 'ArrowRight' || e.key === 'Delete') {
    const nextPage = pages[pageIndex + 1];
    if (!nextPage) return;
    if (_pgCaretAtPageEnd(page, cur)) {
      e.preventDefault();
      _pgPlaceCaret(nextPage, 'start');
      if (e.key === 'Delete') {
        try { document.execCommand('forwardDelete'); } catch (_) { /* ignore */ }
        scheduleReflow();
      }
    }
  }
}

// PAGINATION-BOUNCE FIX: input/blur handlers guard on isConnected. When
// `docContainer.innerHTML = ''` runs, phantom events fire on removed pages.
// Without these guards they would schedule a reflow right AFTER pagination
// finished — the visible second bounce.
function handleCanvasInput(event) {
  const page = event && event.currentTarget;
  if (!page || !page.isConnected) return;
  if (page.classList) _dirtyPages.add(page);
  _htmlSetToken++;
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  debouncedAutoSaveAndPaginate();
}

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
  if (!page || !page.isConnected) return;      // page was removed — skip
  if (!_pageNeedsMathPass(page)) return;
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
  if (_pageNeedsMathPass(page)) return;
  debouncedAutoSaveAndPaginate();
}

// ===== REFLOW DOCUMENT =====
function _nextEditorPage(page) {
  let n = page.nextElementSibling;
  while (n && !(n.classList && n.classList.contains('doc-page-canvas'))) n = n.nextElementSibling;
  return n;
}

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
  if (!docContainer || _slicingDepth > 0) return;
  if (_paginationActiveCount > 0) return;   // never reflow during pagination
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length === 0) return;
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
        if (overflow.length === 1 && _getSplittableChildrenForOverflow(overflow[0])) {
          _putBackBeforeFooter(page, overflow[0]);
          restoreCaretPosition(markerId);
          if (typeof paginateDocumentCanvas === 'function') paginateDocumentCanvas();
          return;
        }
        _splitFirstOverflowParagraph(page, overflow);
        _moveOverflowToNextPage(page, overflow);
        continue;
      }
    }
    if (_wfFits(page)) _wfFillFromNext(page);
    if (_wfKeepWithNext(page)) {
      const nxt = _nextEditorPage(page);
      if (nxt && !_wfFits(nxt)) { page = nxt; continue; }
    }
    page = _nextEditorPage(page);
  }
  normalizeAllEditorPagesToA4();
  _removeTrailingEmptyPages();
  restoreCaretPosition(markerId);
  if (!_autoSavePending) HISTORY.saveState();
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
}

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
      if (!queue.includes(target)) queue.push(target);
    }
    if (page.isConnected && _wfFits(page)) {
      const nxt0 = _nextEditorPage(page);
      if (_wfFillFromNext(page) && nxt0 && nxt0.isConnected) {
        touched.add(nxt0);
        if (!queue.includes(nxt0)) queue.push(nxt0);
      }
      if (_wfKeepWithNext(page)) {
        const nxt1 = _nextEditorPage(page);
        if (nxt1) { touched.add(nxt1); if (!queue.includes(nxt1)) queue.push(nxt1); }
      }
    }
  }
  touched.forEach(p => { resetPageToA4(p); });
  let removed = 0;
  const candidates = Array.from(touched).concat(docContainer.lastElementChild ? [docContainer.lastElementChild] : []);
  new Set(candidates).forEach(p => {
    if (!p || !p.isConnected || !p.classList || !p.classList.contains('doc-page-canvas')) return;
    if (docContainer.querySelectorAll('.doc-page-canvas').length <= 1) return;
    if (!pageHasContent(p) && !_pageIsActive(p)) { p.remove(); removed++; }
  });
  if (createdAny || removed) updatePageFooters();
  if (removed && typeof displayToastNotification === 'function' && Date.now() - _lastEmptyRemovalToastAt > 500) {
    displayToastNotification(`🧹 Removed ${removed} empty page(s)`);
    _lastEmptyRemovalToastAt = Date.now();
  }
  restoreCaretPosition(markerId);
  if (!_autoSavePending) HISTORY.saveState();
  touched.forEach(p => {
    if (!p.isConnected || !/[$\\]/.test(p.textContent || '')) return;
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(p);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(p);
  });
}

const _LOOSE_INLINE_TAGS = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'A', 'SMALL', 'SUB', 'SUP', 'CODE', 'BR', 'FONT', 'MARK', 'S', 'STRIKE']);
function _wrapLooseInlineRuns(page) {
  if (!page) return;
  const isLoose = (n) => n.nodeType === 3 || (n.nodeType === 1 && _LOOSE_INLINE_TAGS.has(n.tagName));
  const isMarker = (n) => n.nodeType === 1 && typeof n.id === 'string' && n.id.indexOf('caret-marker-') === 0;
  const meaningful = (run) => run.some(n => n.nodeType === 3 ? n.nodeValue.trim().length > 0 : !isMarker(n));
  const flush = (run) => {
    if (!run.length || !meaningful(run)) return;
    const wrap = document.createElement('div');
    page.insertBefore(wrap, run[0]);
    run.forEach(n => wrap.appendChild(n));
  };
  let run = [];
  Array.from(page.childNodes).forEach(n => {
    if (isLoose(n)) run.push(n);
    else { flush(run); run = []; }
  });
  flush(run);
}

function getOverflowNodes(page) {
  const zoom = parseFloat(page.style.zoom) || 1;
  const fits = () => (page.scrollHeight / zoom) <= EDITOR_A4_HEIGHT + 1;
  if (fits()) return [];

  _wrapLooseInlineRuns(page);
  const footer = page.querySelector(':scope > .page-footer-number');
  const children = Array.from(page.childNodes).filter(c => c !== footer);
  if (!children.length) return [];

  const overflow = [];
  for (let i = children.length - 1; i >= 0 && !fits(); i--) {
    page.removeChild(children[i]);
    overflow.unshift(children[i]);
  }

  if (overflow.length > 0 && overflow.length === children.length && !_canSplitBlock(overflow[0])) {
    page.insertBefore(overflow.shift(), page.firstChild);
  }
  return overflow;
}

// ===== A4 PAGE SAFETY =====
(function injectTightPageStyles() {
  if (!document.head || document.getElementById('tight-page-styles')) return;
  const st = document.createElement('style');
  st.id = 'tight-page-styles';
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
  if (!page) return false;

  page.style.width = EDITOR_A4_WIDTH + 'px';
  page.style.height = EDITOR_A4_HEIGHT + 'px';
  page.style.minHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.overflow = 'hidden';
  page.style.zoom = '';
  page.style.fontSize = '';
  page.style.lineHeight = '';
  page.style.removeProperty('--tight-media-max');
  page.removeAttribute('data-tight');

  if (page.scrollHeight <= EDITOR_A4_HEIGHT + 1) {
    delete page.dataset.oversized;
    return true;
  }

  for (const scale of [1, 0.85, 0.7, 0.55]) {
    page.style.setProperty('--tight-media-max', Math.max(180, Math.floor(EDITOR_A4_HEIGHT * 0.72 * scale)) + 'px');
    page.setAttribute('data-tight', 'media');
    if (page.scrollHeight <= EDITOR_A4_HEIGHT + 1) {
      delete page.dataset.oversized;
      return true;
    }
  }

  page.dataset.oversized = 'true';
  _applyOversizedBox(page);
  return false;
}

function _applyOversizedBox(page) {
  if (!page) return;
  page.style.height = 'auto';
  page.style.maxHeight = 'none';
  page.style.minHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.overflow = 'visible';
}

function tightenPageContentToA4(page) {
  if (!page) return false;
  return resetPageToA4(page);
}

function normalizeAllEditorPagesToA4() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  pages.forEach(resetPageToA4);
  updatePageFooters();
}

function createNewPageAfter(referencePage) {
  const newPage = document.createElement('div');
  newPage.className = 'doc-page-canvas';
  _stampActiveFormatsOnPage(newPage);
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
  const _pc = docContainer.querySelectorAll('.doc-page-canvas').length;
  const _rawW = docContainer.getBoundingClientRect().width || docContainer.clientWidth || 0;
  const _stableW = Math.round(_rawW / 4) * 4;
  const _sig = [_stableW, _pc, window.innerWidth <= 850 ? 'm' : 'd'].join('|');
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (!pages.length) return;
  if (_sig === _lastFitSig && pages.every(p => p.__fitSig === _sig)) return;
  _lastFitSig = _sig;

  const isNarrow = window.innerWidth <= 850 || (document.documentElement.clientWidth || 0) <= 850;

  if (!isNarrow) {
    pages.forEach(p => {
      p.style.zoom = '';
      p.style.transform = '';
      p.style.transformOrigin = '';
      p.style.margin = '';
      p.style.marginBottom = '12px';
      p.style.marginLeft = 'auto';
      p.style.marginRight = 'auto';
      p.style.width = EDITOR_A4_WIDTH + 'px';
      p.style.height = EDITOR_A4_HEIGHT + 'px';
      p.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
      p.style.minHeight = EDITOR_A4_HEIGHT + 'px';
      p.style.maxWidth = '';
      p.style.marginTop = '';
      p.style.boxSizing = '';
      if (p.dataset.oversized === 'true') _applyOversizedBox(p);
    });
    docContainer.style.overflowX = '';
    docContainer.style.width = '';
    docContainer.style.setProperty('--editor-page-scale', '1');
    docContainer.style.alignItems = 'center';
    pages.forEach(p => { p.__fitSig = _sig; });
    return;
  }

  docContainer.style.alignItems = 'flex-start';
  docContainer.style.overflowX = 'hidden';
  docContainer.style.width = '100%';

  const _cs = getComputedStyle(docContainer);
  const _padX = (parseFloat(_cs.paddingLeft) || 0) + (parseFloat(_cs.paddingRight) || 0);
  if (!docContainer.clientWidth) return;
  const containerWidth = Math.max(1, docContainer.clientWidth - _padX);
  const available = Math.max(1, containerWidth - 4);
  const scale = Math.round(Math.min(1, Math.max(0.2, available / EDITOR_A4_WIDTH)) * 1000) / 1000;

  const scaledW = EDITOR_A4_WIDTH * scale;
  const scaledH = EDITOR_A4_HEIGHT * scale;
  const offsetX = Math.max(0, Math.round((containerWidth - scaledW) / 2));
  const gap = Math.max(8, Math.round(12 * scale));

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
    if (p.dataset.oversized === 'true') _applyOversizedBox(p);
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
        clearTimeout(_fitEditorTimer);
        try { fitEditorPagesToScreen(); } catch (_) {}
      }
    });
    ro.observe(docContainer);
    if (docContainer.parentElement) ro.observe(docContainer.parentElement);
  }

  if (docContainer && typeof MutationObserver === 'function') {
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        const list = r.addedNodes;
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (n.nodeType === 1 && n.classList && n.classList.contains('doc-page-canvas')) { scheduleFitEditor(); return; }
        }
        const rlist = r.removedNodes;
        for (let i = 0; i < rlist.length; i++) {
          const n = rlist[i];
          if (n.nodeType === 1 && n.classList && n.classList.contains('doc-page-canvas')) { scheduleFitEditor(); return; }
        }
      }
    });
    mo.observe(docContainer, { childList: true });
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
  const _lock = _beginScrollLock();
  try { return _updateSpecificPageByNumberImpl(pageNumber, newHtml, opts); }
  finally { _endScrollLock(_lock); }
}
function _updateSpecificPageByNumberImpl(pageNumber, newHtml, opts) {
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

    updatePageFooters();
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

// ===== INSERT NEW CONTENT RIGHT AFTER A PAGE =====
async function insertHtmlAfterPage(pageNumber, newHtml) {
  const _lock = _beginScrollLock();
  try { return await _insertHtmlAfterPageImpl(pageNumber, newHtml); }
  finally { _endScrollLock(_lock); }
}
async function _insertHtmlAfterPageImpl(pageNumber, newHtml) {
  const n = Number.parseInt(pageNumber, 10);
  if (!docContainer || !Number.isInteger(n) || n < 1 || typeof newHtml !== 'string' || !newHtml.trim()) return false;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (n > pages.length) return false;
  let combined = '';
  pages.forEach((page, i) => {
    if (typeof pageHasContent === 'function' && !pageHasContent(page) && i !== n - 1) return;
    combined += _pageSnapshotHTML(page);
    if (i === n - 1) combined += '<br>' + newHtml;
  });
  HISTORY.saveState();
  await setDocumentHTMLAndPaginate(combined);
  return true;
}
window.insertHtmlAfterPage = insertHtmlAfterPage;

function updateSpecificPagesByNumber(updates) {
  const _lock = _beginScrollLock();
  try { return _updateSpecificPagesByNumberImpl(updates); }
  finally { _endScrollLock(_lock); }
}
function _updateSpecificPagesByNumberImpl(updates) {
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
  const _lock = _beginScrollLock();
  try { return await _updateSpecificSectionByHeadingImpl(targetHeading, newHtml); }
  finally { _endScrollLock(_lock); }
}
async function _updateSpecificSectionByHeadingImpl(targetHeading, newHtml) {
  if (typeof targetHeading !== 'string' || !targetHeading.trim() || typeof newHtml !== 'string') {
    return false;
  }
  if (!docContainer) return false;

  const norm = (str) => String(str || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const target = norm(targetHeading);
  const headings = Array.from(docContainer.querySelectorAll('.doc-page-canvas h1, .doc-page-canvas h2, .doc-page-canvas h3'));
  let heading = headings.find(h => norm(h.textContent) === target);
  if (!heading) {
    const candidates = headings.map(h => ({ h, text: norm(h.textContent) }))
      .filter(x => x.text.length >= 3 && (x.text.includes(target) || target.includes(x.text)));
    heading = candidates.sort((a, b) => Math.abs(a.text.length - target.length) - Math.abs(b.text.length - target.length))[0]?.h || null;
  }
  if (!heading) return false;

  try {
    const level = Number(heading.tagName.substring(1));
    const ownerPage = heading.closest('.doc-page-canvas');
    if (!ownerPage) return false;

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
      const begin = pIdx === startPageIndex ? pageNodes.indexOf(anchor) + 1 : 0;
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
  const currentHTML = getCanvasSnapshotHTML();
  if (!currentHTML) return;
  const tempSource = document.createElement('div');
  tempSource.innerHTML = _safeHTML(currentHTML);
  const nodes = flattenContentTopLevelNodes(tempSource);
  if (nodes.length > PAGINATION_CHUNK_SIZE * 2 && typeof paginateDocumentCanvasAsync === 'function') {
    await paginateDocumentCanvasAsync(currentHTML);
  } else {
    await setDocumentHTMLAndPaginate(currentHTML);
  }
  if (typeof displayToastNotification === 'function') displayToastNotification("📄 Document Paginated!");
}

// ===== PROGRESSIVE PAGINATE =====
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
  tmp.innerHTML = _safeHTML(html);
  const nodes = flattenContentTopLevelNodes(tmp);
  if (nodes.length > PAGINATION_CHUNK_SIZE * 2 && typeof paginateDocumentCanvasAsync === 'function') {
    await paginateDocumentCanvasAsync(html);
  } else {
    await setDocumentHTMLAndPaginate(html);
  }
  return true;
}

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
    if (!wasMax && paginateCompactLevel > 0) _setPaginateCompactLevel(paginateCompactLevel - 1);
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
(function setupToolbarSelectionPreservation() {
  const toolbar = document.getElementById('editor-toolbar');
  if (!toolbar) return;
  toolbar.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button');
    if (btn) e.preventDefault();
  });
})();

// ===== COLOR PICKER SELECTION FIX =====
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
    if (/diagram|figure|flowchart|concept map|mind map|schematic|chart|চিত্র|ডায়াগ্রাম|ডায়াগ্রাম|ফিগার|ফ্লোচার্ট/i.test(p)) score += 5;
    score -= i * 0.01;
    return { ...d, _score: score };
  }).sort((a, b) => b._score - a._score);
}

function validateDiagramReplacementAgainstOriginal(originalHtml, replacementHtml, promptText) {
  const tempOld = document.createElement('div');
  const tempNew = document.createElement('div');
  tempOld.innerHTML = _safeHTML(originalHtml || '');
  tempNew.innerHTML = _safeHTML(replacementHtml || '');
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
      return m[1].replace(/\\(u[0-9a-fA-F]{4}|["\\\/bfnrt])/g, (full, k) => {
        switch (k[0]) {
          case 'n': return '\n';
          case 'r': return '';
          case 't': return '\t';
          case 'b': return '\b';
          case 'f': return '\f';
          case 'u': return String.fromCharCode(parseInt(k.slice(1), 16));
          default: return k;
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

  const pageData = pageIndices.filter(idx => Number.isInteger(idx) && pages[idx]).map(idx => {
    const page = pages[idx];
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    let html = clone.innerHTML;
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

    HISTORY.saveState();
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
    if (parent.closest && parent.closest('.katex, .katex-eq')) return;
    const re = _getEmojiRe();
    if (!re) return;
    const before = node.nodeValue;
    const after = before.replace(re, m => (/^[\u200c\u200d]+$/.test(m) ? m : ''));
    if (after !== before) node.nodeValue = after;
  });
}

// ===== CLEANUP EMPTY VISUAL CONTAINERS =====
function cleanupEmptyVisualContainers(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.figure-pro').forEach(fig => {
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
          while (fontSize > MIN_FONT_SIZE && (neededH > bestBB.height || widestLine + PAD_X * 2 > bestBB.width)) {
            fontSize -= 0.5;
            lines = wrapAt(fontSize, bestBB.width);
            widestLine = Math.max(0, ...lines.map(l => measure(l, fontSize)));
            neededH = lines.length * fontSize * LINE_HEIGHT_EM + PAD_Y * 2;
          }
        }

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
      } catch (_) { /* leave this one label as-is */ }
    });
  } finally {
    if (probe.parentNode) probe.parentNode.removeChild(probe);
  }
}

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
  const rects = Array.from(svg.querySelectorAll('rect'));
  if (!texts.length || !rects.length) return;

  const monochrome = document.body.classList.contains('photocopy-mode');
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

        const widestLine = Math.max(0, ...lines.map(measure));
        let finalRectW = rectW;
        if (widestLine + PAD_X * 2 > rectW) {
          finalRectW = Math.min(widestLine + PAD_X * 2, rectW * 1.6);
        }

        const neededH = lines.length * fontSize * LINE_HEIGHT_EM + PAD_Y * 2;
        const finalRectH = Math.max(rectH, neededH);

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
      } catch (_) { /* leave this one label as-is */ }
    });
  } finally {
    if (probe.parentNode) probe.parentNode.removeChild(probe);
  }
}

// ===== APPLY MONOCHROME DOCUMENT STYLES =====
function _monoSet(el, props) {
  let rec = { props: {}, attr: el.getAttribute('style'), applied: null };
  if (el.dataset.monoOrig) { try { rec = JSON.parse(el.dataset.monoOrig) || rec; } catch (_) { /* start fresh */ } }
  Object.keys(props).forEach(p => {
    if (!(p in rec.props)) rec.props[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    el.style.setProperty(p, props[p][0], props[p][1]);
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
      if (rec.attr == null) el.removeAttribute('style'); else el.setAttribute('style', rec.attr);
    } else {
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
  const activeFormat = monochrome ? 'default' : getActivePDFVisualFormat();
  pages.forEach(page => {
    const prev = page.dataset.pdfFormatApplied || 'default';
    if (prev !== activeFormat) {
      if (prev !== 'default') page.classList.remove('pdf-format-' + prev);
      if (activeFormat !== 'default') page.classList.add('pdf-format-' + activeFormat);
      page.dataset.pdfFormatApplied = activeFormat;
    }

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
      page.querySelectorAll('[data-mono-orig]').forEach(_monoRestore);
    }
  });

  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(docContainer);
  if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(docContainer);

  _scheduleStyleReflow();
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
    const prev = page.dataset.pdfFormatApplied || 'default';
    const want = monochrome ? 'default' : id;
    if (prev === want && (want === 'default' || page.classList.contains('pdf-format-' + want))) return;
    if (prev !== 'default') page.classList.remove('pdf-format-' + prev);
    if (want !== 'default') page.classList.add('pdf-format-' + want);
    page.dataset.pdfFormatApplied = want;
  });

  if (window.APP_STATE) window.APP_STATE.pdfVisualFormat = id;
  try { localStorage.setItem(PDF_VISUAL_FORMAT_KEY, id); } catch (e) { console.warn('Could not save visual format:', e); }
}

function applyPDFTextFormat(formatId) {
  const id = PDF_TEXT_FORMAT_IDS.includes(formatId) ? formatId : 'default';
  if (!docContainer) return;

  docContainer.querySelectorAll('.doc-page-canvas').forEach(page => {
    const prev = page.dataset.pdfTextFormatApplied || 'default';
    if (prev === id && (id === 'default' || page.classList.contains('text-format-' + id))) return;
    if (prev !== 'default') page.classList.remove('text-format-' + prev);
    if (id !== 'default') page.classList.add('text-format-' + id);
    page.dataset.pdfTextFormatApplied = id;
  });

  if (window.APP_STATE) window.APP_STATE.pdfTextFormat = id;
  try { localStorage.setItem(PDF_TEXT_FORMAT_KEY, id); } catch (e) { console.warn('Could not save text format:', e); }
}

function choosePDFVisualFormat(formatId) {
  applyPDFVisualFormat(formatId);
  _scheduleStyleReflow();
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  _refreshPdfPreviewIfVisible();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER._persist) TAB_MANAGER._persist();
  if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
  if (typeof displayToastNotification === 'function') displayToastNotification('✅ Visual format applied');
}

function choosePDFTextFormat(formatId) {
  applyPDFTextFormat(formatId);
  _scheduleStyleReflow();
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
window.resetPaginateCompactSilently = () => _setPaginateCompactLevel(0);
window.setPaginateCompactLevelSilently = (n) => _setPaginateCompactLevel(n);
