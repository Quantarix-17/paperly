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
    page.style.cursor = 'default';
    // Reading layout here forces the browser to flush/paint the change
    // above before the line below runs, so the two writes can't get
    // batched into a single frame (which would skip the repaint).
    void page.offsetHeight;
    page.style.cursor = '';
  });
}

const themeCursorRepaintObserver = new MutationObserver(forceCursorRepaint);
themeCursorRepaintObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
themeCursorRepaintObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });


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
document.body.appendChild(measurePage);

const pageSnapshot = document.createElement('div');
pageSnapshot.className = 'doc-page-canvas pdf-export-measure-page';
pageSnapshot.style.cssText = measurePage.style.cssText;
document.body.appendChild(pageSnapshot);

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
// PAGE CONTENT VALIDATION (FIXED: ignores whitespace-only nodes
// and empty canvas elements that have no visible ink)
// ============================================================

// Check whether a <canvas> element actually has visible ink
// (not just that it exists in the DOM).  This prevents pages that
// contain empty / zero-ink canvases from being treated as content,
// which previously caused extra blank pages in the exported PDF.
function _canvasHasInk(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return false;
    const sampleW = Math.min(canvas.width, 160);
    const sampleH = Math.min(canvas.height, 220);
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
    let nonWhite = 0;
    let strong = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 8) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r * 0.299) + (g * 0.587) + (b * 0.114);
      if (lum < 248) nonWhite++;
      if (lum < 220) strong++;
    }
    const pixels = Math.max(1, (data.length / 4));
    return (nonWhite / pixels) > 0.0015 || (strong / pixels) > 0.0005;
  } catch (_) {
    return false;
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

function pageHasContent(page) {
  if (!page) return false;
  const clone = page.cloneNode(true);
  clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());

  // Important: hidden/export/offscreen measure pages can expose empty
  // innerText even when their page HTML still carries the real text node
  // chain. Fall back to textContent so list/table/plain paragraph flow
  // decisions do not collapse into a false empty-page signal.
  const rawText = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  const text = rawText.replace(/\u00a0/g, ' ');
  const normalized = text.toLowerCase();

  const placeholderStrings = [
    'start typing here',
    'or ask ai on the left to generate notes',
    'ask ai to create...',
    // The blank-document cover placeholder (_fillBlankSolePageWithCoverPlaceholder)
    // is a screen-only convenience, never something to export or count as real
    // work — treating it as "no content" here is what lets it get cleaned up
    // automatically by _removeEmptyEditorPages/_removeTrailingEmptyPages the
    // moment real content exists elsewhere, and what keeps it out of every
    // PDF/Word export path that already defers to pageHasContent().
    'created by tamim'
  ];
  // 'page 1' / 'page 1 of 1' must match exactly: a substring match would
  // wrongly treat real content like "see page 10" as an empty placeholder.
  const exactPlaceholders = ['page 1 of 1', 'page 1'];
  const isPlaceholderOnly = placeholderStrings.some(s => normalized.includes(s)) ||
    exactPlaceholders.includes(normalized) || normalized === '';

  const hasVisual = !!clone.querySelector('img, svg, table, .katex-eq, .fc-wrapper, .figure-pro, .block-solution, .quiz-container');

  let hasCanvasInk = false;
  const canvases = clone.querySelectorAll('canvas');
  for (const canvas of canvases) {
    if (_canvasHasInk(canvas)) { hasCanvasInk = true; break; }
  }

  const hasMeaningfulText = text.length >= 2 && !isPlaceholderOnly;
  return hasMeaningfulText || hasVisual || hasCanvasInk;
}

// ===== BLANK-DOCUMENT COVER-PAGE PLACEHOLDER =====
// A brand-new document (nothing generated/typed yet) used to end up with
// zero pages in the editor — see the "keep at least one page" guard added
// to _removeEmptyEditorPages below — which looked completely blank/broken.
// Now that a lone empty page is always kept, this fills THAT specific page
// (only when it's the sole page and it's genuinely empty) with a personal
// cover-page placeholder instead of leaving it looking like nothing.
function _fillBlankSolePageWithCoverPlaceholder() {
  if (!docContainer) return;
  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  if (pages.length !== 1) return;
  const page = pages[0];
  if (pageHasContent(page)) return;
  page.innerHTML = `
    <div style="min-height:900px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:'Times New Roman',Georgia,serif;color:#111827;">
      <p style="font-size:14pt;margin:0 0 10px;">Created by Tamim Hossen Emon</p>
      <p style="font-size:13pt;margin:0 0 10px;">Department of Statistics and Data Science</p>
      <p style="font-size:13pt;margin:0 0 10px;">Session:2025-2026</p>
      <p style="font-size:13pt;margin:0;">Islamic University,Kushtia</p>
    </div>`;
}

function _removeEmptyEditorPages() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (!pages.length) return;

  // Never strip every page down to zero — a lone empty page (a brand-new,
  // not-yet-generated document) should stay on screen as a visible page,
  // not disappear and leave the editor looking completely blank/broken.
  const empties = pages.filter(page => !pageHasContent(page));
  const removable = (empties.length === pages.length) ? empties.slice(1) : empties;
  removable.forEach(page => page.parentNode && page.parentNode.removeChild(page));

  if (typeof updatePageFooters === 'function') updatePageFooters();
}

function _removeTrailingEmptyPages() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length === 0) return;

  let removedCount = 0;
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i];
    const isLastPage = i === pages.length - 1;
    if (!pageHasContent(page) && !(i === 0 && pages.length === 1)) {
      page.remove();
      removedCount++;
      continue;
    }
    if (isLastPage && !pageHasContent(page) && pages.length > 1) {
      page.remove();
      removedCount++;
    }
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
    const currentHTML = getAllCanvasHTML();
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === currentHTML) return;
    this.undoStack.push(currentHTML);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
    if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
      TAB_MANAGER._persist();
    }
  },

  undo() {
    if (this.undoStack.length <= 1) {
      if (typeof displayToastNotification === 'function') displayToastNotification("ℹ Nothing to undo.");
      return;
    }
    const currentState = this.undoStack.pop();
    this.redoStack.push(currentState);
    const previousState = this.undoStack[this.undoStack.length - 1];
    setDocumentHTMLAndPaginate(previousState, false);
    if (typeof displayToastNotification === 'function') displayToastNotification("↶ Undone");
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
      TAB_MANAGER._persist();
    }
  },

  redo() {
    if (this.redoStack.length === 0) {
      if (typeof displayToastNotification === 'function') displayToastNotification("ℹ Nothing to redo.");
      return;
    }
    const nextState = this.redoStack.pop();
    this.undoStack.push(nextState);
    setDocumentHTMLAndPaginate(nextState, false);
    if (typeof displayToastNotification === 'function') displayToastNotification("↷ Redone");
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
      TAB_MANAGER._persist();
    }
  }
};

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
  if (e.ctrlKey && e.key === 'z') { e.preventDefault();
    HISTORY.undo(); } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
    e.preventDefault();
    HISTORY.redo();
  }
});

// ===== CANVAS HTML HELPERS =====
function getAllCanvasHTML() {
  if (!docContainer) return '';
  let combinedHTML = '';
  Array.from(docContainer.querySelectorAll('.doc-page-canvas')).forEach(page => {
    // Word export and the Image-PDF path (via computeTruePDFPages, which
    // takes its raw HTML from this function) both build their output from
    // this combined string rather than reading the live pages directly, so
    // the blank-document cover placeholder has to be filtered out here too
    // — pageHasContent() already treats it as "no content" (see its
    // placeholderStrings list), reuse that instead of re-checking by hand.
    if (typeof pageHasContent === 'function' && !pageHasContent(page)) return;
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(clone);
    combinedHTML += clone.innerHTML;
  });
  return combinedHTML;
}

// ===== SET DOCUMENT HTML WITH PAGINATION (FIXED: removes empty trailing pages) =====
let autoSaveTimer = null;
let paginationDebounceTimer = null;

function debouncedAutoSaveAndPaginate() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { HISTORY.saveState(); }, 1200);
  scheduleReflow();
}

function scheduleReflow() {
  clearTimeout(paginationDebounceTimer);
  paginationDebounceTimer = setTimeout(() => {
    reflowDocument();
  }, 300);
}

function saveCaretPosition() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const activePage = range.startContainer.nodeType === 3 ?
    range.startContainer.parentNode.closest('.doc-page-canvas') :
    range.startContainer.closest('.doc-page-canvas');
  if (!activePage) return null;
  const markerId = 'caret-marker-' + Date.now();
  const marker = document.createElement('span');
  marker.id = markerId;
  marker.style.display = 'none';
  range.insertNode(marker);
  return markerId;
}

function restoreCaretPosition(markerId) {
  if (!markerId) return;
  const marker = document.getElementById(markerId);
  if (marker) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStartBefore(marker);
    range.setEndBefore(marker);
    selection.removeAllRanges();
    selection.addRange(range);
    const page = marker.closest('.doc-page-canvas');
    if (page) page.focus();
    marker.parentNode.removeChild(marker);
  }
}

function _isWholeBlockNodeForPagination(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node.tagName || '').toUpperCase();
  return ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV', 'TABLE', 'UL', 'OL', 'FIGURE'].includes(tag);
}

function flattenContentTopLevelNodes(tempSource) {
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
      childNodes.forEach(child => {
        if (child.nodeType === Node.ELEMENT_NODE && inlineWrapperTags.has(child.tagName)) {
          topLevelNodes.push(child);
        } else {
          topLevelNodes.push(child);
        }
      });
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
  // FIX: "created PDF shows blank in the editor until I refresh".
  // Root cause: pagination below does real DOM measurement work
  // (KaTeX rendering, math processing, page-fit measurement) with
  // no error handling. If any of that throws mid-way — e.g. KaTeX
  // or a math/diagram helper hasn't finished loading yet right after
  // an AI generation finishes — execution stops after
  // `docContainer.innerHTML = ''` has already cleared the editor,
  // so the editor is left showing nothing. A manual page refresh
  // "fixes" it only because everything has finished loading by then
  // and pagination succeeds on that later attempt. We now catch that
  // failure, immediately show the content in an unpaginated fallback
  // page (so it's never blank), and automatically retry real
  // pagination once dependencies have had a moment to finish loading.
  try {
    await _paginateDocumentHTMLCore(rawHtml, triggerSave);
  } catch (err) {
    console.error('[setDocumentHTMLAndPaginate] pagination failed, showing plain fallback:', err);
    _renderDocumentHTMLPlainFallback(rawHtml, triggerSave);
    setTimeout(async () => {
      try {
        await _paginateDocumentHTMLCore(rawHtml, triggerSave);
      } catch (retryErr) {
        console.error('[setDocumentHTMLAndPaginate] retry also failed, keeping plain fallback:', retryErr);
        if (typeof displayToastNotification === 'function') {
          displayToastNotification('⚠️ Page formatting had an issue. Your content is still shown below — refresh if it looks off.');
        }
      }
    }, 400);
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
    page.innerHTML = typeof sanitizeHTML === 'function' ? sanitizeHTML(rawHtml || '') : (rawHtml || '');
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
  const savedScrollPos = docContainer.scrollTop;
  const markerId = saveCaretPosition();
  docContainer.innerHTML = '';
  const tempSource = document.createElement('div');
  tempSource.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(rawHtml)) : rawHtml;
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(tempSource);
  // FIX: render KaTeX equations BEFORE measuring/splitting into pages.
  // Previously equations were rendered only after a block was already
  // placed on a page, so contentFits() measured the small, unrendered
  // math markup. Rendered KaTeX (matrices, fractions, tall symbols) is
  // often much taller, so a block that "fit" during measurement would
  // grow after rendering and spill into the page-footer-number area —
  // this is the "text runs into the page footer" bug. Rendering here
  // first means every fit check below sees the real, final height.
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(tempSource);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(tempSource);
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

  function contentFits(pageElement, extraNode) {
    syncSnapshotFromPage(pageElement);
    if (extraNode) {
      pageSnapshot.appendChild(extraNode.cloneNode(true));
    }
    // NOTE: pageSnapshot already has the exact page width/height/padding
    // (it's built with the same style.cssText as measurePage). Cloning it
    // a second time INSIDE measurePage stacked two full "A4 page" frames
    // (each with its own fixed height + padding) on top of each other,
    // which made scrollHeight double-count padding and made almost any
    // single block look like it overflowed a fresh, empty page — that's
    // what was producing one heading/paragraph per page with a huge gap
    // underneath. Measure pageSnapshot's own scrollHeight directly instead.
    void pageSnapshot.offsetHeight;
    const fits = pageSnapshot.scrollHeight <= EDITOR_A4_HEIGHT + 1;
    if (extraNode && pageSnapshot.lastChild) {
      pageSnapshot.removeChild(pageSnapshot.lastChild);
    }
    return fits;
  }

  let currentPageElement = currentPage;
  for (let i = 0; i < topLevelNodes.length; i++) {
    const result = _processPaginationNode(topLevelNodes[i], currentPageElement, createdPages, contentFits, createNewPageElement);
    currentPageElement = result.currentPageElement;
  }

  normalizeAllEditorPagesToA4();
  _removeEmptyEditorPages();
  docContainer.scrollTop = savedScrollPos;
  restoreCaretPosition(markerId);
  
  // ===== FIX: Remove empty trailing pages =====
  _removeTrailingEmptyPages();
  _fillBlankSolePageWithCoverPlaceholder();
  
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(docContainer);
  if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(docContainer);
  if (typeof applyPDFVisualFormat === 'function') applyPDFVisualFormat(typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default');
  if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
  if (triggerSave) HISTORY.saveState();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    const tab = TAB_MANAGER.getActive();
    if (tab) {
      const newName = TAB_MANAGER._getTabNameFromHtml(getAllCanvasHTML());
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
  if (_pdfViewAfterPaginate && _pdfViewAfterPaginate.style.display !== 'none' && typeof generateLivePDFIframePreview === 'function') {
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
  const hasRadius = /border-radius\s*:\s*(?!0(px)?\s*[;$])/i.test(style);
  const hasBorder = /\bborder(-left|-right|-top|-bottom)?\s*:[^;]*\d/i.test(style);
  const hasTintedBg = /background(-color)?\s*:\s*(?!transparent|none|#fff(?:fff)?[;$]|white[;$])/i.test(noSpace + ';');
  // A "designed box" needs at least a background paired with a border or
  // rounded corners, or an explicit shadow — plain text divs with only
  // color/margin/font styling never match this and remain freely splittable.
  return hasShadow || (hasTintedBg && (hasBorder || hasRadius));
}

function _getSplittableChildrenForOverflow(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = (node.tagName || '').toUpperCase();
  if (tag === 'TABLE') {
    const rows = Array.from(node.querySelectorAll(':scope > tbody > tr, :scope > tr, :scope > thead > tr'));
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
  if (!splitChildren) {
    // Nothing safe to split on (a single image/equation/canvas taller than
    // a page, etc.) — place it as its own block. This rare case may still
    // slightly overflow visually, but that's far better than silently
    // losing an entire table or list of content.
    const clone = node.cloneNode(true);
    currentPageElement.appendChild(clone);
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(clone);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(clone);
    return currentPageElement;
  }

  // FIX: a table split across pages used to lose its column headings the
  // moment it spilled onto page 2 — only the very first wrapper ever got
  // the header row, since it's just one more entry in the flat row list.
  // Detect the header row(s) (inside a <thead>, or every cell in the row is
  // a <th>) and re-clone them onto the top of every continuation page too,
  // the way a printed table normally repeats its headings. Nothing changes
  // for non-table splittable blocks (lists, boxed divs, blockquotes).
  const isTable = (node.tagName || '').toUpperCase() === 'TABLE';
  const headerRows = isTable
    ? splitChildren.filter(r => (r.parentElement && r.parentElement.tagName === 'THEAD') ||
        (r.children.length > 0 && Array.from(r.children).every(c => c.tagName === 'TH')))
    : [];
  const bodyRows = headerRows.length ? splitChildren.filter(r => !headerRows.includes(r)) : splitChildren;

  function startWrapperOnCurrentPage() {
    const w = node.cloneNode(false); // tag + attributes only, no children yet
    currentPageElement.appendChild(w);
    headerRows.forEach(hr => {
      const hClone = hr.cloneNode(true);
      w.appendChild(hClone);
      if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(hClone);
      if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(hClone);
    });
    return w;
  }

  let wrapper = startWrapperOnCurrentPage();
  let wrapperHasChild = false;

  bodyRows.forEach(child => {
    const childClone = child.cloneNode(true);
    wrapper.appendChild(childClone);
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(childClone);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(childClone);

    if (wrapperHasChild && !contentFits(currentPageElement)) {
      // This child is the one that pushed the page over — move it (only
      // it) to a fresh wrapper (with the header row(s) repeated) on a new
      // page instead of losing it.
      wrapper.removeChild(childClone);
      currentPageElement = createNewPageElement();
      createdPages.push(currentPageElement);
      wrapper = startWrapperOnCurrentPage();
      wrapper.appendChild(childClone);
      wrapperHasChild = true;
    } else {
      wrapperHasChild = true;
    }
  });

  return currentPageElement;
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
  // FIX: same blank-until-refresh issue as setDocumentHTMLAndPaginate —
  // this is the pagination path used while a long/sectioned PDF is being
  // generated, so it needs the same safety net.
  try {
    await _paginateDocumentCanvasAsyncCore(rawHtml, triggerSave);
  } catch (err) {
    console.error('[paginateDocumentCanvasAsync] pagination failed, showing plain fallback:', err);
    _renderDocumentHTMLPlainFallback(rawHtml, triggerSave);
    await new Promise(resolve => setTimeout(resolve, 400));
    try {
      await _paginateDocumentCanvasAsyncCore(rawHtml, triggerSave);
    } catch (retryErr) {
      console.error('[paginateDocumentCanvasAsync] retry also failed, keeping plain fallback:', retryErr);
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('⚠️ Page formatting had an issue. Your content is still shown below — refresh if it looks off.');
      }
    }
  }
}

async function _paginateDocumentCanvasAsyncCore(rawHtml, triggerSave = true) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  if (!docContainer) return;
  const savedScrollPos = docContainer.scrollTop;
  const markerId = saveCaretPosition();
  docContainer.innerHTML = '';
  const tempSource = document.createElement('div');
  tempSource.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(rawHtml)) : rawHtml;
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(tempSource);
  // FIX: same fix as in setDocumentHTMLAndPaginate — render KaTeX before
  // splitting into pages so the fit-measurement below uses the real,
  // final (rendered) height instead of the smaller unrendered markup.
  // Otherwise a block that measured as "fits" grows after KaTeX renders
  // and overlaps the page-footer-number underneath it.
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(tempSource);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(tempSource);
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
  document.body.appendChild(measurePage);

  const pageSnapshot = document.createElement('div');
  pageSnapshot.className = 'doc-page-canvas pdf-export-measure-page';
  pageSnapshot.style.cssText = measurePage.style.cssText;
  document.body.appendChild(pageSnapshot);

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

  function contentFits(pageElement, extraNode) {
    syncSnapshotFromPage(pageElement);
    if (extraNode) {
      pageSnapshot.appendChild(extraNode.cloneNode(true));
    }
    // Same fix as in setDocumentHTMLAndPaginate: measure pageSnapshot
    // directly instead of cloning it into a second full-size page frame.
    void pageSnapshot.offsetHeight;
    const fits = pageSnapshot.scrollHeight <= EDITOR_A4_HEIGHT + 1;
    if (extraNode && pageSnapshot.lastChild) {
      pageSnapshot.removeChild(pageSnapshot.lastChild);
    }
    return fits;
  }

  let currentPageElement = currentPage;
  const useChunking = topLevelNodes.length > PAGINATION_CHUNK_SIZE * 2;
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

  while (i < topLevelNodes.length) {
    const end = useChunking ? Math.min(i + PAGINATION_CHUNK_SIZE, topLevelNodes.length) : topLevelNodes.length;
    for (; i < end; i++) {
      const result = _processPaginationNode(topLevelNodes[i], currentPageElement, createdPages, contentFits, createNewPageElement);
      currentPageElement = result.currentPageElement;
    }
    if (useChunking && i < topLevelNodes.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  docContainer.removeEventListener('wheel', _markUserScrollIntent);
  docContainer.removeEventListener('touchmove', _markUserScrollIntent);
  docContainer.removeEventListener('keydown', _markUserScrollIntent);

  normalizeAllEditorPagesToA4();
  if (!userScrolledDuringPagination) {
    docContainer.scrollTop = savedScrollPos;
  }
  restoreCaretPosition(markerId);

  _removeTrailingEmptyPages();

  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(docContainer);
  if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(docContainer);
  if (typeof applyPDFVisualFormat === 'function') applyPDFVisualFormat(typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default');
  if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
  if (triggerSave) HISTORY.saveState();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    const tab = TAB_MANAGER.getActive();
    if (tab) {
      const newName = TAB_MANAGER._getTabNameFromHtml(getAllCanvasHTML());
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
  if (_pdfViewAfterPaginateAsync && _pdfViewAfterPaginateAsync.style.display !== 'none' && typeof generateLivePDFIframePreview === 'function') {
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
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  scheduleReflow();
  debouncedAutoSaveAndPaginate();
}

function handlePageBlur(event) {
  const page = event.currentTarget;
  if (!/[$\\]/.test(page.textContent || '')) return;
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
  debouncedAutoSaveAndPaginate();
}

// ===== REFLOW DOCUMENT =====
function reflowDocument() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length === 0) return;

  const markerId = saveCaretPosition();
  let pageIndex = 0;
  while (pageIndex < pages.length) {
    const page = pages[pageIndex];
    const zoomFactor = parseFloat(page.style.zoom) || 1;
    if ((page.scrollHeight / zoomFactor) > 1123) {
      const overflow = getOverflowNodes(page);
      if (overflow.length > 0) {
        // FIX: "table/box jumps whole to a new page while typing" bug.
        // getOverflowNodes (below) only knows how to move a WHOLE top-level
        // node onto a fresh page — correct for an ordinary paragraph, but
        // for a table/list/boxed block with splittable rows/items/lines
        // this reintroduces, during live typing, the exact same blank-space
        // problem _processPaginationNode was fixed for elsewhere. Rather
        // than duplicate that splitting logic in this snapshot-based
        // algorithm, hand this one case off to the real, split-aware
        // paginator: put the node back where it was (getOverflowNodes has
        // already detached it) and run a full repagination, which fills
        // this page's remaining room with as much of the block as fits and
        // spills only the rest onward.
        if (overflow.length === 1 && _getSplittableChildrenForOverflow(overflow[0])) {
          page.appendChild(overflow[0]);
          restoreCaretPosition(markerId);
          if (typeof paginateDocumentCanvas === 'function') paginateDocumentCanvas();
          return;
        }
        const newPage = createNewPageAfter(page);
        const fragment = document.createDocumentFragment();
        overflow.forEach(node => fragment.appendChild(node));
        newPage.prepend(fragment);
        continue;
      }
    }
    pageIndex++;
  }
  normalizeAllEditorPagesToA4();
  // Remove empty trailing pages after reflow
  _removeTrailingEmptyPages();
  restoreCaretPosition(markerId);
  HISTORY.saveState();
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
}

function getOverflowNodes(page) {
  const maxHeight = 1123;
  const footer = page.querySelector('.page-footer-number');
  const children = Array.from(page.childNodes).filter(c => c !== footer);

  if (!children.length) return [];

  syncSnapshotFromPage(page);

  // Keep the overflow probe block-aware:
  // remove one complete top-level DOM node from the page snapshot at a time
  // until the measured snapshot becomes valid again. Never remove a fragment
  // of text or line inside a paragraph.
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

  if (overflow.length > 0) {
    overflow.forEach(node => {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    return overflow;
  }

  return [];
}

// ===== A4 PAGE SAFETY =====
function resetPageToA4(page) {
  if (!page) return;
  page.style.width = EDITOR_A4_WIDTH + 'px';
  page.style.height = EDITOR_A4_HEIGHT + 'px';
  page.style.minHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.overflow = 'hidden';
  delete page.dataset.oversized;
  page.style.zoom = '';
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
    page.querySelectorAll('table').forEach(table => {
      table.style.fontSize = pt >= 12 ? '' : '92%';
    });
    page.querySelectorAll('th, td').forEach(cell => {
      cell.style.padding = pt >= 12 ? '' : '4px 6px';
    });
    page.querySelectorAll('img, canvas').forEach(media => {
      media.style.maxHeight = Math.max(180, Math.floor(EDITOR_A4_HEIGHT * 0.72 * scale)) + 'px';
      media.style.width = 'auto';
    });
    page.querySelectorAll('svg').forEach(svg => {
      const parent = svg.closest('.figure-frame, .fc-svg-wrapper');
      if (parent) parent.style.maxHeight = Math.max(180, Math.floor(EDITOR_A4_HEIGHT * 0.72 * scale)) + 'px';
    });
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
  pages.forEach(page => {
    resetPageToA4(page);
    if (page.scrollHeight > EDITOR_A4_HEIGHT + 1) {
      tightenPageContentToA4(page);
    }
  });
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
    footer.textContent = `Page ${index + 1} of ${pages.length}`;
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
  const _first = docContainer.querySelector('.doc-page-canvas');
  if (_sig === _lastFitSig && _first && _first.style.transform) return;
  _lastFitSig = _sig;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (!pages.length) return;

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
    });
    docContainer.style.setProperty('--editor-page-scale', '1');
    docContainer.style.alignItems = 'center';
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
function updateSpecificPageByNumber(pageNumber, newHtml) {
  const pageNum = Number.parseInt(pageNumber, 10);
  if (!Number.isInteger(pageNum) || pageNum < 1 || typeof newHtml !== 'string') {
    return false;
  }
  if (!docContainer) return false;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const page = pages[pageNum - 1];
  if (!page) return false;

  try {
    const existingFooter = page.querySelector('.page-footer-number');
    if (existingFooter) existingFooter.remove();

    const cleanHtml = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(newHtml)) : newHtml;
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
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(clone);
    combined += clone.innerHTML;
    if (i === n - 1) combined += '<br>' + newHtml;
  });
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
    prepared.push({ n, page: pages[n - 1], html: typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(item.new_html)) : item.new_html });
  }
  try {
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

  const target = targetHeading.trim().replace(/\s+/g, ' ').toLowerCase();
  const headings = Array.from(docContainer.querySelectorAll('.doc-page-canvas h1, .doc-page-canvas h2, .doc-page-canvas h3'));
  let heading = headings.find(h => h.innerText.trim().replace(/\s+/g, ' ').toLowerCase() === target);
  if (!heading) {
    const candidates = headings.map(h => ({ h, text: h.innerText.trim().replace(/\s+/g, ' ').toLowerCase() }))
      .filter(x => x.text.includes(target) || target.includes(x.text));
    heading = candidates.sort((a, b) => Math.abs(a.text.length - target.length) - Math.abs(b.text.length - target.length))[0]?.h || null;
  }
  if (!heading) return false;

  try {
    const level = Number(heading.tagName.substring(1));
    const ownerPage = heading.closest('.doc-page-canvas');
    if (!ownerPage) return false;

    const nodes = [];
    let cursor = heading;
    let stop = false;
    const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
    const startPageIndex = pages.indexOf(ownerPage);
    if (startPageIndex < 0) return false;

    for (let pIdx = startPageIndex; pIdx < pages.length && !stop; pIdx++) {
      const page = pages[pIdx];
      const pageNodes = Array.from(page.childNodes);
      const startIndex = pIdx === startPageIndex ? pageNodes.indexOf(heading) : -1;
      const begin = pIdx === startPageIndex ? Math.max(0, startIndex) : 0;
      for (let i = begin + 1; i < pageNodes.length; i++) {
        const node = pageNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE) {
          const m = /^H([1-3])$/.exec(node.tagName);
          if (m && Number(m[1]) <= level) {
            stop = true;
            break;
          }
        }
        if (!(node.nodeType === Node.ELEMENT_NODE && node.classList.contains('page-footer-number'))) {
          nodes.push(node);
        }
      }
    }

    nodes.forEach(node => node.parentNode && node.parentNode.removeChild(node));

    const temp = document.createElement('div');
    temp.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(newHtml)) : newHtml;
    const fragment = document.createDocumentFragment();
    Array.from(temp.childNodes).forEach(node => fragment.appendChild(node));

    heading.parentNode.insertBefore(fragment, heading.nextSibling);

    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(docContainer);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(docContainer);
    if (typeof paginateDocumentCanvas === 'function') await paginateDocumentCanvas();
    updatePageFooters();
    _removeTrailingEmptyPages();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
    if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
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
  if (!confirm(`Remove page ${getPageIndex(currentPage) + 1}? This cannot be undone.`)) return;
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
  const currentHTML = getAllCanvasHTML();
  if (currentHTML && !currentHTML.includes('Start typing here')) {
    const tempSource = document.createElement('div');
    tempSource.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(currentHTML)) : currentHTML;
    const nodes = flattenContentTopLevelNodes(tempSource);
    if (nodes.length > PAGINATION_CHUNK_SIZE * 2 && typeof paginateDocumentCanvasAsync === 'function') {
      await paginateDocumentCanvasAsync(currentHTML);
    } else {
      setDocumentHTMLAndPaginate(currentHTML);
    }
    if (typeof displayToastNotification === 'function') displayToastNotification("📄 Document Paginated!");
  }
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
  const html = getAllCanvasHTML();
  if (!html || html.includes('Start typing here')) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(html)) : html;
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
      const t = h.innerText.trim();
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
  temp.innerHTML = rawHtml;
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
    if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
  });
}
if (docContainer) {
  docContainer.addEventListener('keyup', updateToolbarButtonStates);
  docContainer.addEventListener('mouseup', updateToolbarButtonStates);
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
  temp.innerHTML = rawHtml.trim();
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
  temp.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(wrapperHTML)) : wrapperHTML;
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
  tempOld.innerHTML = originalHtml || '';
  tempNew.innerHTML = replacementHtml || '';
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
  t.innerHTML = html || '';
  return (t.innerText || t.textContent || '').replace(/\s+/g, ' ').trim().length;
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
  temp.innerHTML = rawHtml;

  if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(temp);
  if (typeof cleanupEmptyVisualContainers === 'function') cleanupEmptyVisualContainers(temp);

  temp.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach(el => {
    if (!(el.innerText || '').trim() && !_elementHasVisualContent(el) && !el.querySelector('br')) {
      if (!el.classList.contains('manual-page-break')) el.remove();
    }
  });

  temp.querySelectorAll('p > h1, p > h2, p > h3, p > h4').forEach(h => {
    const parent = h.parentElement;
    if (parent) parent.parentNode.insertBefore(h, parent);
  });

  temp.querySelectorAll('table').forEach(table => {
    table.style.width = table.style.width || '100%';
    table.style.borderCollapse = 'collapse';
    table.querySelectorAll('th, td').forEach(cell => {
      if (!cell.style.border) cell.style.border = '1px solid #cbd5e1';
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
    const textLen = (clone.innerText || '').replace(/\s+/g, ' ').trim().length;
    if (textLen >= 2 || _elementHasVisualContent(clone)) {
      parts.push(html);
    }
  });
  return parts.join('\n');
}

function getBeautifyMaxTokens() {
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.PDF_TOKEN_BUDGETS) {
    const b = APP_CONFIG.PDF_TOKEN_BUDGETS;
    return b.LONG_DIRECT || b.DEFAULT_SINGLE || b.BEAUTIFY || 64000;
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
  const container = document.getElementById('document-view-container');
  if (!container) return [];
  const pages = Array.from(container.querySelectorAll('.doc-page-canvas'));
  const brokenIndices = [];
  pages.forEach((page, index) => {
    const brokenEquations = typeof findBrokenEquations === 'function' ? findBrokenEquations(page) : [];
    const hasBrokenKatex = page.querySelectorAll('.katex-eq.katex-render-failed, .katex-eq[data-render-pending="true"]').length > 0;
    const text = page.innerText.trim();
    const isEmpty = !text && !_elementHasVisualContent(page);
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

  const pageData = pageIndices.map(idx => {
    const page = pages[idx];
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    return { index: idx, html: clone.innerHTML, originalPage: page };
  });

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

    let applied = 0;
    for (const item of parsed) {
      const idx = parseInt(item.page_index, 10);
      if (isNaN(idx) || idx < 0 || idx >= pages.length) continue;
      const fixedHtml = item.fixed_html;
      if (typeof fixedHtml !== 'string' || !fixedHtml.trim()) continue;

      const pageNum = idx + 1;
      const success = updateSpecificPageByNumber(pageNum, fixedHtml);
      if (success) applied++;
    }

    if (applied > 0) {
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
  const currentFullHTML = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
  if (!currentFullHTML || currentFullHTML.includes('Start typing here')) {
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

  const applyResult = (html, toastMsg, chatMsg) => {
    if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
    if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(html, false);
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
    if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
      ProgressUI.show('Fixing broken pages...', `Detected ${brokenIndices.length} page(s) with rendering issues.`);
      ProgressUI.startAutoEstimate(8);
    }
    const fixed = await fixBrokenPagesWithAI(brokenIndices, modelsUsed);
    if (fixed) {
      const afterFixHTML = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
      if (afterFixHTML) {
        const localPolished = localBeautifyHTML(afterFixHTML);
        if (localPolished && localPolished !== afterFixHTML) {
          if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
          if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(localPolished, false);
        }
      }
      if (typeof ProgressUI !== 'undefined') ProgressUI.finish();
      setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 300);
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('✅ Fixed broken pages and applied local polish.');
      }
      if (typeof appendChatMessageToUI === 'function') {
        appendChatMessageToUI('ai', `✅ Fixed ${brokenIndices.length} page(s) with rendering issues and polished locally.`);
      }
      window.APP_STATE.isAIGenerating = false;
      if (sendBtn) sendBtn.disabled = false;
      return;
    } else {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
      const localPolished = localBeautifyHTML(currentFullHTML);
      if (localPolished && localPolished !== currentFullHTML) {
        if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
        if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(localPolished, false);
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
      window.APP_STATE.isAIGenerating = false;
      if (sendBtn) sendBtn.disabled = false;
      return;
    }
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
        if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(polished, false);
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
      `${typeof buildSharedRules === 'function' ? buildSharedRules(isMonochromeMode, outputLanguage) : ''}`;

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
      applyResult(
        safeHtml,
        '✅ Beautify applied (local polish — AI output was incomplete).',
        `✅ Document polished locally after AI safety check.${modelNames.length ? ' Models tried: ' + modelNames.join(', ') : ''}`
      );
    } else {
      applyResult(
        safeHtml,
        '✅ Beautify completed successfully!',
        `✅ Document beautified${modelNames.length ? ' using ' + modelNames.join(', ') : ''}.`
      );
    }
  } catch (error) {
    if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
    try {
      const polished = localBeautifyHTML(currentFullHTML) || currentFullHTML;
      if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
      if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(polished, false);
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
      if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(currentFullHTML, false);
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
    node.nodeValue = node.nodeValue.replace(EMOJI_RE, '');
  });
}

// ===== CLEANUP EMPTY VISUAL CONTAINERS =====
function cleanupEmptyVisualContainers(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.figure-pro').forEach(fig => {
    const frame = fig.querySelector('.figure-frame');
    const hasVisual = !!(frame && _elementHasVisualContent(frame));
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
        let fontSize = parseFloat(textEl.getAttribute('font-size') || getComputedStyle(textEl).fontSize) || 13;
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

        const fontSize = parseFloat(textEl.getAttribute('font-size') || getComputedStyle(textEl).fontSize) || 13;
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
    } else {
      page.style.background = '';
      page.style.color = '';
      page.style.borderColor = '';
      page.style.boxShadow = '';
      const activeFormat = getActivePDFVisualFormat();
      if (activeFormat && activeFormat !== 'default') page.classList.add('pdf-format-' + activeFormat);
    }

    page.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,dt,dd,th,td,caption,figcaption').forEach(el => {
      el.style.color = monochrome ? '#000' : '';
      if (!monochrome) el.style.removeProperty('border-color');
    });

    page.querySelectorAll('table, th, td, .figure-pro, .figure-frame').forEach(el => {
      if (monochrome) {
        el.style.setProperty('border-color', '#000', 'important');
        el.style.setProperty('box-shadow', 'none', 'important');
        el.style.setProperty('background', '#fff', 'important');
      } else {
        el.style.removeProperty('border-color');
        el.style.removeProperty('box-shadow');
        el.style.removeProperty('background');
      }
    });

    // block-solution / math-final-answer / sol-label should read as plain
    // text (no box, no side border) in monochrome (see styles.css),
    // not a boxed white rectangle — clear any leftover inline background
    // or border so the stylesheet rule is what actually applies.
    page.querySelectorAll('.block-solution, .math-final-answer, .sol-label').forEach(el => {
      el.style.removeProperty('background');
      el.style.removeProperty('border');
      el.style.removeProperty('border-color');
      el.style.removeProperty('box-shadow');
    });

    page.querySelectorAll('img').forEach(img => {
      img.style.filter = monochrome ? 'grayscale(1) contrast(1.05)' : '';
    });
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
  try { localStorage.setItem(PDF_VISUAL_FORMAT_KEY, id); } catch (e) {}
}

function applyPDFTextFormat(formatId) {
  const id = PDF_TEXT_FORMAT_IDS.includes(formatId) ? formatId : 'default';
  if (!docContainer) return;
  docContainer.querySelectorAll('.doc-page-canvas').forEach(page => {
    PDF_TEXT_FORMAT_IDS.forEach(f => page.classList.remove('text-format-' + f));
    if (id !== 'default') page.classList.add('text-format-' + id);
  });
  if (window.APP_STATE) window.APP_STATE.pdfTextFormat = id;
  try { localStorage.setItem(PDF_TEXT_FORMAT_KEY, id); } catch (e) {}
}

function choosePDFVisualFormat(formatId) {
  applyPDFVisualFormat(formatId);
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  const pdfView = document.getElementById('pdf-view-container');
  if (pdfView && getComputedStyle(pdfView).display !== 'none' && typeof generateLivePDFIframePreview === 'function') {
    generateLivePDFIframePreview();
  }
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER._persist) TAB_MANAGER._persist();
  if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
  if (typeof displayToastNotification === 'function') displayToastNotification('✅ Visual format applied');
}

function choosePDFTextFormat(formatId) {
  applyPDFTextFormat(formatId);
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  const pdfView = document.getElementById('pdf-view-container');
  if (pdfView && getComputedStyle(pdfView).display !== 'none' && typeof generateLivePDFIframePreview === 'function') {
    generateLivePDFIframePreview();
  }
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
