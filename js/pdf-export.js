// ========================================================================
// PDF EXPORT - True PDF (Chromium print engine, one-click), Image PDF (rasterized), Word export,
// and live PDF iframe preview with enhanced UX and scroll fix
// ========================================================================

// ===== PDF LIBRARY LOADER =====
const PDF_LIBRARY_URLS = Object.freeze({
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
});
let _pdfLibrariesPromise = null;

function _loadScriptOnce(src, test) {
  return new Promise((resolve, reject) => {
    if (test()) return resolve(true);
    const existing = document.querySelector(`script[data-pdf-lib-src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => test() ? resolve(true) : reject(new Error('PDF library loaded but global is unavailable.')), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load PDF library.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.pdfLibSrc = src;
    script.onload = () => test() ? resolve(true) : reject(new Error('PDF library loaded but global is unavailable.'));
    script.onerror = () => reject(new Error('Unable to load PDF library.'));
    document.head.appendChild(script);
  });
}

async function ensurePDFRenderLibraries() {
  if (_pdfLibrariesPromise) return _pdfLibrariesPromise;
  _pdfLibrariesPromise = (async () => {
    const results = await Promise.allSettled([
      _loadScriptOnce(PDF_LIBRARY_URLS.html2canvas, () => typeof window.html2canvas === 'function'),
      _loadScriptOnce(PDF_LIBRARY_URLS.jspdf, () => !!(window.jspdf && typeof window.jspdf.jsPDF === 'function'))
    ]);
    const htmlOK = results[0].status === 'fulfilled' && typeof window.html2canvas === 'function';
    const jsPDFOK = results[1].status === 'fulfilled' && !!(window.jspdf && typeof window.jspdf.jsPDF === 'function');
    return { htmlOK, jsPDFOK };
  })().catch(err => {
    _pdfLibrariesPromise = null;
    throw err;
  });
  return _pdfLibrariesPromise;
}

function _assertPDFRenderLibraries(libs, requireRaster = true) {
  if (!libs || !libs.jsPDFOK) throw new Error('PDF engine is unavailable. Please keep the page online briefly and try again.');
  if (requireRaster && !libs.htmlOK) throw new Error('Image PDF renderer is unavailable. Please keep the page online briefly and try again.');
}

function _getPDFRenderScale() {
  return typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout() ? 1.15 : 1.55;
}

function _yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function _pdfCanUseNativePrint() {
  try {
    return !!window.print;
  } catch (_) {
    return false;
  }
}

// ===== EXPORT BUTTON STATE =====
function _setExportButtonBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.exportOriginalHtml) btn.dataset.exportOriginalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('btn-exporting');
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span class="btn-export-label">${label || 'Working'}</span>`;
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-exporting');
    if (btn.dataset.exportOriginalHtml) {
      btn.innerHTML = btn.dataset.exportOriginalHtml;
      delete btn.dataset.exportOriginalHtml;
    }
  }
}

function _updateExportButtonProgress(btn, text) {
  if (!btn || !btn.classList.contains('btn-exporting')) return;
  const label = btn.querySelector('.btn-export-label');
  if (label) label.textContent = text;
}

// ===== PRE-EXPORT QUALITY PASS =====
async function runPreExportLocalQualityPass() {
  try {
    if (typeof ensureAllPagesMathRendered === 'function') ensureAllPagesMathRendered();
    const currentHTML = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
    const cleaned = typeof professionalizeDocumentHTML === 'function' ? professionalizeDocumentHTML(currentHTML) : currentHTML;
    if (cleaned && cleaned !== currentHTML && typeof setDocumentHTMLAndPaginate === 'function') {
      setDocumentHTMLAndPaginate(cleaned, false);
    }
    const container = document.getElementById('document-view-container');
    if (container) {
      container.querySelectorAll('.figure-pro, .fc-wrapper').forEach(el => {
        const hasVisual = !!(el.querySelector('svg, img, table') ||
          Array.from(el.querySelectorAll('canvas')).some(c => _canvasHasVisibleInk(c)));
        const text = (el.innerText || '').trim();
        if (!hasVisual && !text) el.remove();
      });
    }
    if (typeof ensureAllPagesMathRendered === 'function') ensureAllPagesMathRendered();
    
    // Remove all blank pages (not just trailing) so the exported PDF
    // does not contain extra empty pages caused by empty canvas elements
    if (typeof _removeTrailingEmptyPages === 'function') _removeTrailingEmptyPages();
    
    return true;
  } catch (e) {
    console.warn('Local pre-export quality pass failed; continuing with current document:', e);
    return false;
  }
}

// ===== COLLECT RENDERABLE EDITOR PAGES =====
function _collectRenderableEditorPages() {
  const container = document.getElementById('document-view-container');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.doc-page-canvas')).filter(page => {
    if (typeof pageHasContent === 'function') return pageHasContent(page);
    const contentClone = page.cloneNode(true);
    contentClone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    const text = (contentClone.innerText || '').replace(/\s+/g, ' ').trim();
    const normalized = text.toLowerCase();
    if (normalized.includes('start typing here') || normalized.includes('ask ai on the left to generate notes')) return false;
    const hasVisual = !!contentClone.querySelector('img,svg,table,figure,.figure-pro,.fc-wrapper');
    let hasCanvasInk = false;
    const canvases = contentClone.querySelectorAll('canvas');
    for (const canvas of canvases) {
      if (_canvasHasVisibleInk(canvas)) { hasCanvasInk = true; break; }
    }
    return text.length >= 2 && (text || hasVisual || hasCanvasInk);
  });
}

// ===== ACTIVE DOCUMENT THEME (visual format) FOR THE EXPORT =====
// The themes picked in the command menu live on the editor pages as a `pdf-format-<id>` class. The export pages are
// rebuilt from scratch (className reset, background forced white), so the class has to be re-applied explicitly or
// every download silently comes out in the default theme. Returns '' for the default theme or monochrome mode.
function _pdfActiveFormatClass() {
  try {
    if (document.body.classList.contains('photocopy-mode')) return '';   // monochrome (photocopy) mode always wins
    let id = null;
    if (typeof getActivePDFVisualFormat === 'function') {
      try { id = getActivePDFVisualFormat(); } catch (_) { id = null; }
    }
    id = id == null ? '' : String(id).trim().replace(/^pdf-format-/, '');
    if (!id) {   // no getter / empty answer: read what the live editor pages are actually showing
      const live = document.querySelector('#document-view-container .doc-page-canvas[class*="pdf-format-"]') ||
                   document.querySelector('.doc-page-canvas[class*="pdf-format-"]');
      const m = live && /(?:^|\s)pdf-format-([\w-]+)/.exec(live.className);
      if (m) id = m[1];
    }
    return (id && id !== 'default' && /^[\w-]+$/.test(id)) ? 'pdf-format-' + id : '';
  } catch (_) { return ''; }
}

// Serialize an editor page for the print document. innerHTML drops a <canvas>'s pixels
// (the re-parsed canvas is blank), so charts drawn on canvas vanished from True PDF.
// Snapshot each canvas to an <img> first (canvas is raster by nature; it has no text layer).
function _serializePageForPDF(page) {
  try {
    const canvases = page.querySelectorAll('canvas');
    if (!canvases.length) return page.innerHTML;
    const clone = page.cloneNode(true);
    const dst = clone.querySelectorAll('canvas');
    canvases.forEach((src, i) => {
      const d = dst[i];
      if (!d || !d.parentNode) return;
      try {
        if (!src.width || !src.height) return;
        const img = document.createElement('img');
        img.src = src.toDataURL('image/png');
        img.style.cssText = 'max-width:100%;height:auto;' + (src.style.cssText || '');
        d.parentNode.replaceChild(img, d);
      } catch (_) {}
    });
    return clone.innerHTML;
  } catch (_) { return page.innerHTML; }
}

// ===== GET DOCUMENT TOPIC NAME =====
function getDocumentTopicName() {
  const PLACEHOLDER = /start typing here|ask ai on the left/i;
  const toFile = (t) => String(t || '')
    .replace(/[^a-zA-Z0-9\u0980-\u09FF\s_-]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 80).trim().replace(/\s+/g, '_');
  const pick = (root) => {
    if (!root || !root.querySelectorAll) return '';
    for (const h of root.querySelectorAll('h1, h2, h3, h4')) {
      const t = (h.textContent || '').trim();
      if (t && !PLACEHOLDER.test(t)) { const f = toFile(t); if (f) return f; }
    }
    return '';
  };
  try {
    let name = pick(document.getElementById('document-view-container'));
    if (!name) {                                   // any editor page, wherever it lives
      for (const pg of document.querySelectorAll('.doc-page-canvas')) { name = pick(pg); if (name) break; }
    }
    if (!name && typeof getAllCanvasHTML === 'function') {   // the document model itself
      const tmp = document.createElement('div');
      tmp.innerHTML = getAllCanvasHTML() || '';
      name = pick(tmp);
      if (!name) {                                 // no heading: use the first line of text
        const line = (tmp.textContent || '').split('\n').map(x => x.trim()).find(x => x && !PLACEHOLDER.test(x));
        if (line) name = toFile(line.slice(0, 60));
      }
    }
    return name || 'Document';
  } catch (_) { return 'Document'; }
}

// ===== WORD EXPORT (LEGACY / FALLBACK) =====
// NOTE: the primary Word export is now the native .docx builder in
// word-export.js, which owns window.exportToWordDocument. This raw-HTML
// ".doc" version is kept as a fallback: word-export.js calls it when the
// docx library is unavailable (CDN blocked/offline) or the native build throws.
// Word's ".doc" (Web-Page-Filtered / MHTML) import is already a real, fully
// editable document once opened — text, headings, lists and tables all
// survive as live Word content. What used to get lost was every VISUAL:
// KaTeX equations were swapped for a plain-text "[ Math: ... ]" placeholder,
// and every chart/diagram/illustration <svg> (chart-library.js,
// diagram-library.js, illustration-library.js, or any hand-drawn figure)
// either stayed as raw inline <svg> markup — which Word's filtered-HTML
// importer does not reliably render — or, for flowchart-style .fc-wrapper
// visuals, was flattened into a bare text table. Either way the visual
// itself disappeared on open in Word.
//
// Fix: before building the exported HTML, every equation and every SVG is
// rasterized to an embedded PNG — the same rasterizer PPTX export already
// relies on for visual fidelity (rasterizeSvgPreservingAspect in
// slide-studio.js) — so what opens in Word looks like the document on
// screen, while every other element stays plain, editable Word content.
async function exportToWordDocumentLegacy(btn) {
  if (typeof ensureAllPagesMathRendered === 'function') ensureAllPagesMathRendered();
  const rawContent = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
  if (!rawContent || rawContent.includes('Start typing here')) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ Document is empty.");
    return;
  }

  _setExportButtonBusy(btn, true, 'Word');

  try {
    const temp = document.createElement('div');
    temp.innerHTML = rawContent;
    temp.querySelectorAll('.page-footer-number').forEach(f => f.remove());

    await _rasterizeMathForWordExport(temp);
    await _rasterizeSvgVisualsForWordExport(temp);

    // .fc-wrapper visuals now hold a title plus an already-rasterized <img>
    // (from the SVG pass above) — simplify the wrapper to a plain centered
    // block so Word doesn't have to interpret the original flex/grid layout.
    temp.querySelectorAll('.fc-wrapper').forEach(fc => {
      const titleEl = fc.querySelector('.fc-title');
      const img = fc.querySelector('img');
      const holder = document.createElement('div');
      holder.style.cssText = 'margin:10pt 0; text-align:center;';
      if (titleEl && titleEl.innerText.trim()) {
        const h = document.createElement('p');
        h.style.cssText = 'font-weight:700; font-size:13pt; margin:0 0 6pt 0; text-align:left; color:#111;';
        h.textContent = titleEl.innerText.trim();
        holder.appendChild(h);
      }
      if (img) holder.appendChild(img);
      else if (!holder.childNodes.length) holder.textContent = 'Diagram / Chart';
      fc.parentNode.replaceChild(holder, fc);
    });

    Array.from(temp.querySelectorAll('*')).forEach(el => {
      el.removeAttribute('contenteditable');
      el.removeAttribute('spellcheck');
    });

    // Minimal inline styling so headings, tables and figures keep roughly
    // their on-screen look once opened in Word — the app's own stylesheet
    // isn't available inside a standalone exported file.
    const wordStyles = `
      body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; color:#111; line-height:1.5; }
      h1, h2, h3, h4 { font-family: Calibri, Arial, sans-serif; color:#111; }
      table { border-collapse: collapse; }
      td, th { border: 1pt solid #cbd5e1; padding: 4pt 6pt; }
      img { max-width: 100%; }
      figure { margin: 10pt 0; }
      figcaption { font-size: 10.5pt; color:#444; }
    `;
    const documentHtml = `<html xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>${getDocumentTopicName()}</title><style>${wordStyles}</style></head><body>${temp.innerHTML}</body></html>`;
    const blob = new Blob(['\ufeff', documentHtml], { type: 'application/msword;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = getDocumentTopicName() + '.doc';
    link.click();
    URL.revokeObjectURL(link.href);
    if (typeof displayToastNotification === 'function') displayToastNotification("✅ Word Document Saved");
  } catch (e) {
    console.error('[WordExport] failed:', e);
    if (typeof displayToastNotification === 'function') {
      displayToastNotification('⚠️ Word export failed: ' + (e?.message || 'Unknown error'));
    }
  } finally {
    _setExportButtonBusy(btn, false);
  }
}

// ===== WORD EXPORT — MATH RASTERIZATION =====
// Renders each .katex-eq node (already fully rendered by math-renderer.js)
// to a PNG via html2canvas, so the exact on-screen equation survives in
// Word instead of a "[ Math: latex ]" text placeholder. Falls back to that
// same text placeholder per-equation if rasterization isn't available or
// fails, so a raster problem never blocks the export.
async function _rasterizeMathForWordExport(temp) {
  const mathNodes = Array.from(temp.querySelectorAll('.katex-eq'));
  if (!mathNodes.length) return;

  const toTextFallback = (eq) => {
    const mathText = document.createElement('span');
    mathText.style.cssText = 'font-family:Cambria Math,serif;font-style:italic;background-color:#f1f5f9;padding:2pt 4pt;border:1pt solid #cbd5e1;';
    mathText.textContent = ` [ Math: ${eq.getAttribute('data-latex') || eq.innerText} ] `;
    eq.parentNode.replaceChild(mathText, eq);
  };

  let libsOK = false;
  try {
    const libs = await ensurePDFRenderLibraries();
    libsOK = !!(libs && libs.htmlOK && typeof window.html2canvas === 'function');
  } catch (_) { libsOK = false; }

  if (!libsOK) { mathNodes.forEach(toTextFallback); return; }

  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed; left:-10000px; top:0; background:#fff; display:inline-block;';
  document.body.appendChild(stage);

  for (const eq of mathNodes) {
    try {
      const holder = document.createElement('div');
      holder.style.cssText = 'display:inline-block; padding:2px 4px; background:#fff;';
      holder.appendChild(eq.cloneNode(true));
      stage.appendChild(holder);
      _pdfFixKatexSvg(holder);
      const canvas = await window.html2canvas(holder, { backgroundColor: '#ffffff', scale: 2.5 });
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.width = Math.max(1, Math.round(holder.offsetWidth));
      img.height = Math.max(1, Math.round(holder.offsetHeight));
      img.style.cssText = 'vertical-align:middle; max-width:100%;';
      eq.parentNode.replaceChild(img, eq);
      stage.removeChild(holder);
    } catch (e) {
      console.warn('[WordExport] math rasterize failed, using text fallback:', e);
      toTextFallback(eq);
    }
  }

  stage.remove();
}

// ===== WORD EXPORT — SVG VISUAL RASTERIZATION =====
// Converts every remaining <svg> in the export (chart-library bar/line/pie/
// donut charts, diagram-library figures, illustration-library scenes, and
// any hand-drawn figure svg) to an embedded PNG using the same
// rasterizeSvgPreservingAspect() rasterizer slide-studio.js uses for PPTX
// export, so nothing renders as blank/broken when opened in Word.
async function _rasterizeSvgVisualsForWordExport(temp) {
  if (typeof window.rasterizeSvgPreservingAspect !== 'function') return;
  const svgNodes = Array.from(temp.querySelectorAll('svg'));
  for (const svg of svgNodes) {
    try {
      const result = await window.rasterizeSvgPreservingAspect(svg.outerHTML, 1400);
      if (result && result.dataUrl) {
        const img = document.createElement('img');
        img.src = result.dataUrl;
        img.style.cssText = 'max-width:100%; height:auto;';
        svg.parentNode.replaceChild(img, svg);
      }
    } catch (e) {
      console.warn('[WordExport] svg rasterize failed:', e);
    }
  }
}



// ===== COVERAGE CHECK: does every piece of document text reach the PDF? (diagnostic, never blocks the export) =====
function _pdfCoverageSource() {
  const out = [];
  try {
    if (typeof getAllCanvasHTML !== 'function') return out;
    const tmp = document.createElement('div');
    tmp.innerHTML = getAllCanvasHTML() || '';
    tmp.querySelectorAll('.katex-eq, .katex, .katex-display, annotation, script, style, noscript, .page-footer-number').forEach((n) => n.remove());
    const norm = (t) => String(t || '').replace(/\s+/g, '');
    const w = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = norm(n.nodeValue);
      if (t.length < 4) continue;
      const chain = [];
      for (let e = n.parentElement, k = 0; e && e !== tmp && k < 4; e = e.parentElement, k++) {
        chain.push(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
      }
      out.push({ probe: t.slice(0, 14), text: String(n.nodeValue).trim().slice(0, 40), path: chain.join(' < ') });
    }
  } catch (_) { /* diagnostic only */ }
  return out;
}
function _pdfCoverageCheck(source, haystackRaw, label) {
  try {
    const hay = String(haystackRaw || '').replace(/\s+/g, '');
    // This is only a diagnostic, but it is O(pieces x text length): on a long document it used to cost many seconds.
    // Sample the pieces so the work stays bounded (~1.2e8 character comparisons at most).
    let src = source;
    const budget = 1.2e8, cost = source.length * Math.max(1, hay.length);
    if (cost > budget) {
      const step = Math.ceil(cost / budget);
      src = source.filter((_, i) => i % step === 0);
    }
    const missing = src.filter((s) => !hay.includes(s.probe));
    if (missing.length) console.warn('[PDF coverage] ' + missing.length + ' text piece(s) missing — ' + label + ':', missing.slice(0, 30));
    return missing.length;
  } catch (_) { return 0; }
}

// Counts lists / list items / tables / images in the document model vs. the paginated pages, so a block that
// silently disappears during pagination is reported in the console instead of going unnoticed.
function _pdfStructureCheck(pageList) {
  if (typeof getAllCanvasHTML !== 'function') return;
  const src = document.createElement('div');
  src.innerHTML = getAllCanvasHTML() || '';
  src.querySelectorAll('.page-footer-number').forEach((n) => n.remove());
  const count = (root) => ({
    li: root.querySelectorAll('li').length, ul: root.querySelectorAll('ul, ol').length, table: root.querySelectorAll('table').length,
    img: root.querySelectorAll('img, svg').length, eq: root.querySelectorAll('.katex-eq').length
  });
  const a = count(src);
  const host = document.createElement('div');
  pageList.forEach((pg) => { if (pg.el) host.appendChild(pg.el.cloneNode(true)); });
  const b = count(host);
  const diff = Object.keys(a).filter((k) => a[k] !== b[k] && !(k === 'table' && b[k] > a[k]) && !(k === 'ul' && b[k] > a[k]));
  if (diff.length) console.warn('[PDF structure] document vs paginated pages differ:', diff.map((k) => k + ' ' + a[k] + ' -> ' + b[k]).join(', '), '(if li/ul drop here, the loss happens before export — in the editor HTML / sanitizeHTML / professionalizeDocumentHTML)');
  const flat = (host.textContent || '');
  if (/([A-Za-z]{1,3}[+\-\d]*)\1?[A-Za-z]?\^[{]?[+\-\d]/.test(flat) || /[A-Za-z]_\d?[A-Za-z]/.test(flat)) console.warn('[PDF structure] raw TeX-looking text found in the pages (an equation was flattened to text).');
}

// ===== LIVE PROGRESS TOAST (percentage while the PDF is being built) =====
function _pdfProgressStart(label, btn) {
  const old = document.getElementById('pdf-progress-toast'); if (old) old.remove();
  if (!document.getElementById('pdf-progress-toast-css')) {
    const st = document.createElement('style'); st.id = 'pdf-progress-toast-css';
    st.textContent = `
#pdf-progress-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%) translateY(0);z-index:2147483000;
 min-width:240px;max-width:min(92vw,380px);padding:12px 16px 14px;border-radius:14px;background:#111827;color:#f9fafb;
 box-shadow:0 12px 30px rgba(0,0,0,.35);font:600 14px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;transition:opacity .35s,transform .35s}
#pdf-progress-toast.pp-hide{opacity:0;transform:translateX(-50%) translateY(12px);pointer-events:none}
#pdf-progress-toast .pp-row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:9px}
#pdf-progress-toast .pp-pct{font-variant-numeric:tabular-nums;font-size:15px}
#pdf-progress-toast .pp-bar{height:6px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden}
#pdf-progress-toast .pp-bar i{display:block;height:100%;width:0;border-radius:99px;background:#60a5fa;transition:width .25s ease-out}
#pdf-progress-toast.pp-done .pp-bar i{background:#34d399}`;
    document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.id = 'pdf-progress-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<div class="pp-row"><span class="pp-text"></span><span class="pp-pct">0%</span></div><div class="pp-bar"><i></i></div>';
  document.body.appendChild(el);
  const textEl = el.querySelector('.pp-text'), pctEl = el.querySelector('.pp-pct'), bar = el.querySelector('.pp-bar i');
  let cur = 0, closed = false, timer = null;
  textEl.textContent = label || 'Preparing PDF';
  const api = {
    set(p, text) {
      if (closed) return;
      p = Math.max(cur, Math.min(99, Math.round(p)));     // never goes backwards, 100% only when the file is saved
      cur = p;
      pctEl.textContent = p + '%'; bar.style.width = p + '%';
      if (text) textEl.textContent = text;
      if (btn) _updateExportButtonProgress(btn, p + '%');
    },
    finish(text) {
      if (closed) return; cur = 100;
      pctEl.textContent = '100%'; bar.style.width = '100%'; el.classList.add('pp-done');
      textEl.textContent = text || 'PDF downloaded';
      if (btn) _updateExportButtonProgress(btn, '100%');
      closed = true; timer = setTimeout(() => { el.classList.add('pp-hide'); setTimeout(() => el.remove(), 450); }, 1600);
    },
    close() { if (closed) return; closed = true; el.classList.add('pp-hide'); setTimeout(() => el.remove(), 450); }
  };
  return api;
}

// ===== TRUE PDF — ONE CLICK, VECTOR, NO DIALOG =====
// A web page can NOT save a PDF through the browser's own print engine without
// showing its print dialog (window.print() always asks). So the same engine is
// run where no dialog exists: pdf-print-server.js (headless Chromium).
//   click -> the print document is built here -> POST to the server ->
//   Chromium prints it to a native PDF (vector shapes, embedded fonts, real
//   selectable text, zoom never blurs) -> saved straight to the download folder.
// Configure once:   window.PDF_CONVERT_CONFIG = { url: 'https://host/api/html-to-pdf' };
// Optional: headers:{...} (auth), timeoutMs.
// If no server is configured (or it is unreachable) the old browser print
// dialog is used as a fallback, so a vector PDF is always possible.
const PDF_CONVERT_DEFAULTS = Object.freeze({ timeoutMs: 120000 });
let _truePdfRunning = false;
let _kalpurushB64Promise = null;

function _getPDFConvertConfig() {
  const c = window.PDF_CONVERT_CONFIG || {};
  return { url: c.url || window.PDF_CONVERT_URL || '', timeoutMs: c.timeoutMs > 0 ? c.timeoutMs : PDF_CONVERT_DEFAULTS.timeoutMs, headers: c.headers || {} };
}

// Kalpurush is shipped with the app (fonts/Kalpurush.ttf). Embedding it in the
// document means the server prints Bengali with the exact same font and does
// not need it installed. Missing file = silently skipped.
function _loadKalpurushBase64() {
  if (_kalpurushB64Promise) return _kalpurushB64Promise;
  _kalpurushB64Promise = (async () => {
    try {
      const res = await fetch(window.PDF_BENGALI_FONT_URL || new URL('fonts/Kalpurush.ttf', document.baseURI).href);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!_pdfLooksLikeFont(bytes)) throw new Error('not a font file');
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    } catch (e) { _kalpurushB64Promise = null; return null; }
  })();
  return _kalpurushB64Promise;
}

// The same self-contained print document the old print flow used.
async function _buildTruePDFPrintHTML() {
  const signature = typeof hashPDFPreviewSignature === 'function' ? hashPDFPreviewSignature() : '';
  if (typeof prepareDocumentForPDFPreview === 'function') prepareDocumentForPDFPreview(signature);
  let pageChunks = _normalizePDFPageChunks(_collectRenderableEditorPages().map(_serializePageForPDF));
  if (!pageChunks.length && typeof computeTruePDFPageChunks === 'function') {
    pageChunks = _normalizePDFPageChunks(await computeTruePDFPageChunks({ signature, allowCache: true }));
  }
  const isDark = false;   // a downloaded PDF is always a light (print) document, whatever the app theme is
  const isMonochrome = document.body.classList.contains('photocopy-mode');
  let html = buildUnifiedPDFPreviewDocument(pageChunks, isMonochrome, isDark);
  if (!html) throw new Error('Print document is empty.');
  const b64 = await _loadKalpurushBase64();
  const inject = `<base href="${document.baseURI.replace(/"/g, '&quot;')}">` +
    (b64 ? `<style>@font-face{font-family:'Kalpurush';src:url(data:font/ttf;base64,${b64}) format('truetype');font-weight:normal;font-style:normal;}</style>` : '');
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
}

async function _printHTMLToPDFBlob(html) {
  const cfg = _getPDFConvertConfig();
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), cfg.timeoutMs) : null;
  try {
    let res;
    try {
      res = await fetch(cfg.url, { method: 'POST', signal: ctrl ? ctrl.signal : undefined,
        headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, cfg.headers), body: html });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('PDF server timed out.');
      throw new Error('PDF server is unreachable (' + cfg.url + ').');
    }
    if (!res.ok) {
      let d = ''; try { d = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 160); } catch (_) { /* ignore */ }
      throw new Error('PDF server failed (HTTP ' + res.status + (d ? ': ' + d : '') + ').');
    }
    const buf = await res.arrayBuffer();
    if (String.fromCharCode.apply(null, Array.from(new Uint8Array(buf.slice(0, 5)))) !== '%PDF-') throw new Error('PDF server did not return a PDF.');
    return new Blob([buf], { type: 'application/pdf' });
  } finally { if (timer) clearTimeout(timer); }
}

// Plain download link = browser's default download folder, no dialog.
function _downloadBlobToDefaultFolder(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function exportToHighQualityPDF(btn) {
  const toast = (m) => { if (typeof displayToastNotification === 'function') displayToastNotification(m); };
  const pages = _collectRenderableEditorPages();
  if (!pages.length || (typeof docContainer !== 'undefined' && docContainer && docContainer.innerText && docContainer.innerText.includes('Start typing here'))) {
    toast('⚠️ Document is empty.');
    return;
  }
  if (!_getPDFConvertConfig().url) return _exportTruePDFVectorInBrowser(btn);   // default: no server, no dialog
  if (_truePdfRunning) return;
  _truePdfRunning = true;
  _setExportButtonBusy(btn, true, 'PDF');
  let fallback = false;
  const prog = _pdfProgressStart('Preparing PDF', btn);
  try {
    prog.set(5);
    await runPreExportLocalQualityPass();
    prog.set(20, 'Building document');
    const html = await _buildTruePDFPrintHTML();
    prog.set(40, 'Preparing PDF');
    const pdfBlob = await _printHTMLToPDFBlob(html);
    prog.set(90, 'Saving');
    _downloadBlobToDefaultFolder(pdfBlob, (getDocumentTopicName() || 'Document') + '.pdf');
    prog.finish();
    toast('✅ PDF downloaded — selectable text.');
  } catch (error) {
    console.error('True PDF (server) failed:', error);
    toast('⚠️ ' + (error && error.message ? error.message : 'PDF server error') + ' Using the emergency fallback (no text layer).');
    fallback = true;
    prog.close();
  } finally {
    _truePdfRunning = false;
    _setExportButtonBusy(btn, false);
  }
  if (fallback) return _exportTruePDFViaPrintDialog(btn);
}

// ========================================================================
// EXPORT TO PDF (FAST) — native browser print engine ("True PDF" of the old exporter)
// ------------------------------------------------------------------------
// There are now TWO PDF exporters:
//   * Export to PDF (slow)  = exportToHighQualityPDF / exportToPDFSlow
//       measures the laid-out pages and writes a vector PDF with pdf-lib (no dialog, one click,
//       shaped Bengali, equation sprites ...). Thorough but slower.
//   * Export to PDF (fast)  = exportToPDFFast (this one)
//       builds the self-contained print document and hands it to the browser's own print engine
//       (Print > "Save as PDF"). Very fast, real selectable text, but the browser's print dialog
//       is shown (a web page cannot save through the print engine without it).
// ========================================================================
let _fastPdfRunning = false;

async function exportToPDFFast(btn) {
  const toast = (m) => { if (typeof displayToastNotification === 'function') displayToastNotification(m); };
  if (_fastPdfRunning) return;
  const pages = _collectRenderableEditorPages();
  if (!pages.length || (typeof docContainer !== 'undefined' && docContainer && docContainer.innerText && docContainer.innerText.includes('Start typing here'))) {
    toast('⚠️ Document is empty.');
    return;
  }
  if (!_pdfCanUseNativePrint()) {
    toast('⚠️ Fast PDF needs the browser Print / Save as PDF engine. Use "Export to PDF (slow)" instead.');
    return;
  }

  _fastPdfRunning = true;
  _setExportButtonBusy(btn, true, 'PDF');

  const docName = getDocumentTopicName() || 'Document';     // read BEFORE anything re-renders the editor
  const pdfView = document.getElementById('pdf-view-container');
  const iframe = document.getElementById('pdf-iframe');
  if (!iframe || !pdfView) {
    _fastPdfRunning = false;
    _setExportButtonBusy(btn, false);
    toast('Error PDF preview frame is unavailable.');
    return;
  }

  // The print frame lives inside the (normally hidden) PDF tab. It is shown off-screen for the duration of the print,
  // then everything is put back exactly as it was.
  const prevPdfViewStyle = pdfView.getAttribute('style');
  const prevTitle = document.title;
  let viewRestored = false;
  let printed = false;
  let timeoutId = null, safetyId = null, messageHandler = null, loadHandler = null;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (messageHandler) window.removeEventListener('message', messageHandler);
    if (loadHandler) iframe.removeEventListener('load', loadHandler);
    timeoutId = null; messageHandler = null; loadHandler = null;
  };
  const restoreView = () => {
    if (viewRestored) return;
    viewRestored = true;
    cleanup();
    if (safetyId) clearTimeout(safetyId);
    window.removeEventListener('focus', restoreView);
    document.removeEventListener('visibilitychange', onVisible);
    try { document.title = prevTitle; } catch (_) {}
    if (prevPdfViewStyle === null) pdfView.removeAttribute('style');
    else pdfView.setAttribute('style', prevPdfViewStyle);
    _pdfLastRenderedSignature = '';           // the preview frame now holds the print document: rebuild it next time
    _pdfLastRenderedMode = '';
    const resyncAndFit = () => {
      if (typeof window.__resyncMobileViewportHeight === 'function') window.__resyncMobileViewportHeight();
      try { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); } catch (_) {}
      try {
        if (pdfView.style.display !== 'none' && getComputedStyle(pdfView).display !== 'none') {
          if (typeof generateLivePDFIframePreview === 'function') generateLivePDFIframePreview();
        }
      } catch (_) {}
    };
    resyncAndFit();
    setTimeout(resyncAndFit, 250);
    setTimeout(resyncAndFit, 700);
    _fastPdfRunning = false;
    _setExportButtonBusy(btn, false);
  };
  const onVisible = () => { if (!document.hidden) restoreView(); };

  let printHTML = '';
  try {
    await runPreExportLocalQualityPass();

    // Same self-contained print document the preview uses (editor pages, Times New Roman / Kalpurush embedded,
    // KaTeX, theme, monochrome mode). Falls back to a fresh pagination when the editor has no pages.
    printHTML = await _buildTruePDFPrintHTML();

    pdfView.style.cssText = (prevPdfViewStyle || '') +
      ';display:flex !important;position:fixed !important;left:-10000px !important;top:0 !important;' +
      `width:${window.innerWidth}px !important;height:${window.innerHeight}px !important;` +
      'visibility:visible !important;pointer-events:none !important;';

    iframe.onload = null;
    iframe.removeAttribute('src');
    iframe.srcdoc = printHTML;
  } catch (buildError) {
    console.warn('Fast PDF print document build failed:', buildError);
    toast('Error Fast PDF preparation failed: ' + (buildError && buildError.message ? buildError.message : 'Unknown error') + '. Try "Export to PDF (slow)".');
    restoreView();
    return;
  }

  const runPrint = () => {
    if (printed || viewRestored) return;
    printed = true;
    cleanup();
    try {
      document.title = docName;                 // browsers suggest the page title as the saved file name
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      iframe.contentWindow.focus();
      try { iframe.contentWindow.addEventListener('afterprint', restoreView, { once: true }); } catch (_) {}
      iframe.contentWindow.print();
      const took = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      if (took > 300) {
        restoreView();                          // print() blocked until the dialog was closed (Chrome / Edge): done
      } else {
        // non-blocking browsers: wait for afterprint / the window getting focus back / a long safety timeout
        setTimeout(() => window.addEventListener('focus', restoreView, { once: true }), 800);
        document.addEventListener('visibilitychange', onVisible);
        if (safetyId) clearTimeout(safetyId);
        safetyId = setTimeout(restoreView, 45000);
      }
    } catch (error) {
      toast('Error Fast PDF print failed: ' + (error && error.message ? error.message : 'Unknown error') + '. Try "Export to PDF (slow)".');
      restoreView();
    }
  };

  messageHandler = (e) => { if (e.source === iframe.contentWindow && e.data === 'pdf-iframe-ready') runPrint(); };
  // The print frame posts 'pdf-iframe-ready' once its fonts (KaTeX, Kalpurush) and images are loaded: that is the normal trigger.
  // The load / timeout paths below only catch a frame that never reports back.
  loadHandler = () => setTimeout(() => { if (!printed) runPrint(); }, 6000);
  window.addEventListener('message', messageHandler);
  iframe.addEventListener('load', loadHandler, { once: true });
  timeoutId = setTimeout(() => runPrint(), 10000);
  safetyId = setTimeout(restoreView, 60000);        // never leave the PDF tab stuck off-screen
}

// ===== TRUE PDF — IN-BROWSER VECTOR RENDERER (no server, no dialog) =====
// Each page is measured from the live, laid-out DOM and written with pdf-lib as
// REAL PDF content: text (embedded fonts, selectable, zoom-proof), solid
// backgrounds and borders (vector rules/rects) and list markers. Only things
// that cannot be drawn as vectors here — images, charts/SVG, equations, gradients,
// shadows, generated (::before/::after) content — are rendered once by
// html2canvas into a background layer with all vector text/boxes hidden, so
// nothing is drawn twice. Pages with nothing to rasterize skip that step
// entirely (instant, tiny, 100% vector).
const VEC_HIDE_CSS = `
.pdf-vtext, .pdf-vtext :not(.katex):not(.katex *):not([data-pdfkeep]) {
  color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important;
}
.pdf-vtext [data-pdfv~="g"] { background-color: transparent !important; }
.pdf-vtext [data-pdfv~="b"] { border-color: transparent !important; }
`;
const VEC_PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
const VEC_FONTKIT_URL = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';

const _vecScriptPromises = {};
function _vecLoadScript(url) {
  if (_vecScriptPromises[url]) return _vecScriptPromises[url];
  return (_vecScriptPromises[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { delete _vecScriptPromises[url]; s.remove(); reject(new Error('Could not load ' + url)); };
    document.head.appendChild(s);
  }));
}
async function _vecEnsureLibs() {
  const urls = window.PDF_VECTOR_LIB_URLS || {};
  // pdf-lib and fontkit download in parallel (they used to load one after the other)
  const wantBn = window.PDF_BENGALI_VECTOR !== false;
  await Promise.all([
    window.PDFLib ? null : _vecLoadScript(urls.pdfLib || VEC_PDFLIB_URL),
    (!wantBn || typeof window.regeneratorRuntime !== 'undefined') ? null : _vecLoadScript('https://cdn.jsdelivr.net/npm/regenerator-runtime@0.13.11/runtime.js').catch(() => {}),
    (!wantBn || window.fontkit) ? null : _vecLoadScript(urls.fontkit || VEC_FONTKIT_URL)
      .catch(() => _vecLoadScript('https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js'))
      .catch((e) => console.warn('fontkit unavailable — Bengali text layer cannot be built:', e))
  ]);
  if (!window.PDFLib) throw new Error('pdf-lib failed to load.');
}
// Warm everything the export needs while the user is still reading, so the click itself has no download wait.
function prefetchPDFExportAssets() {
  try {
    _vecEnsureLibs().catch(() => {});
    ensurePDFRenderLibraries().catch(() => {});
    _vecLoadKalpurushBytes();
    _pdfEnsureKatexFonts();
  } catch (_) { /* best effort */ }
}
(function schedulePDFPrefetch() {
  const go = () => { if (typeof requestIdleCallback === 'function') requestIdleCallback(prefetchPDFExportAssets, { timeout: 4000 }); else setTimeout(prefetchPDFExportAssets, 2000); };
  if (document.readyState === 'complete') setTimeout(go, 1500); else window.addEventListener('load', () => setTimeout(go, 1500), { once: true });
})();

// The raster layer must contain NO text/boxes that are also drawn as vectors, otherwise every word shows twice.
// Done with inline !important styles on the cloned nodes (does not depend on a stylesheet selector matching).
function _vecHideVectorLayerInClone(root) {
  const TXT = [['color', 'transparent'], ['-webkit-text-fill-color', 'transparent'], ['text-shadow', 'none'],
    ['-webkit-text-stroke', '0'], ['text-decoration-color', 'transparent']];
  const hideText = (el) => TXT.forEach(([k, v]) => el.style.setProperty(k, v, 'important'));
  hideText(root);
  root.querySelectorAll('[data-pdfsprite]').forEach((e) => e.style.setProperty('visibility', 'hidden', 'important'));   // drawn separately as sprites
  root.querySelectorAll('[data-pdfpseudo]').forEach((el) => {      // hide the owner's own text, keep its ::before/::after visible
    Array.from(el.childNodes).forEach((n) => {
      if (n.nodeType === 3 && n.nodeValue.trim()) {
        const sp = el.ownerDocument.createElement('span');
        hideText(sp);
        el.replaceChild(sp, n); sp.appendChild(n);
      }
    });
  });
  root.querySelectorAll('*').forEach((el) => {
    const v = el.getAttribute('data-pdfv');
    if (v) {
      if (/\bg\b/.test(v)) el.style.setProperty('background-color', 'transparent', 'important');
      if (/\bb\b/.test(v)) el.style.setProperty('border-color', 'transparent', 'important');
    }
    if (el.closest('svg') || el.closest('.katex') || el.hasAttribute('data-pdfkeep') || el.hasAttribute('data-pdfpseudo')) return;
    hideText(el);
  });
}

function _vecParseColor(str) {
  if (!str || str === 'transparent') return null;
  const n = String(str).match(/-?[\d.]+%?/g);
  if (!n || n.length < 3) return null;
  const v = n.map((x, i) => (x.endsWith('%') ? (i < 3 ? parseFloat(x) * 2.55 : parseFloat(x) / 100) : parseFloat(x)));
  return { r: Math.max(0, Math.min(255, v[0])) / 255, g: Math.max(0, Math.min(255, v[1])) / 255, b: Math.max(0, Math.min(255, v[2])) / 255, a: v.length > 3 && isFinite(v[3]) ? v[3] : 1 };
}
function _vecCase(t, tt) {
  if (tt === 'uppercase') return t.toUpperCase();
  if (tt === 'lowercase') return t.toLowerCase();
  if (tt === 'capitalize') return t.replace(/^(\S)/, (m) => m.toUpperCase());
  return t;
}
function _vecListMarkerText(li, type) {
  const list = li.parentElement;
  let n = 1;
  if (list && list.tagName === 'OL') {
    n = parseInt(list.getAttribute('start'), 10); if (!isFinite(n)) n = 1;
    for (const c of Array.from(list.children)) {
      if (c.tagName !== 'LI') continue;
      if (c.hasAttribute('value') && isFinite(parseInt(c.getAttribute('value'), 10))) n = parseInt(c.getAttribute('value'), 10);
      if (c === li) break;
      n++;
    }
  }
  const alpha = (k, up) => { let o = ''; k = Math.max(1, k); while (k > 0) { k--; o = String.fromCharCode(97 + (k % 26)) + o; k = Math.floor(k / 26); } return up ? o.toUpperCase() : o; };
  const roman = (k, up) => { const m = [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']]; let o = ''; k = Math.max(1, k); m.forEach(([v, s]) => { while (k >= v) { o += s; k -= v; } }); return up ? o.toUpperCase() : o; };
  let t;
  switch (type) {
    case 'lower-alpha': case 'lower-latin': t = alpha(n, false); break;
    case 'upper-alpha': case 'upper-latin': t = alpha(n, true); break;
    case 'lower-roman': t = roman(n, false); break;
    case 'upper-roman': t = roman(n, true); break;
    case 'decimal-leading-zero': t = (n < 10 ? '0' : '') + n; break;
    case 'bengali': t = String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]); break;
    default: t = String(n);
  }
  return t + '.';
}

// ---- measuring one laid-out page element (runs in the live DOM) ----
const _VEC_SPRITE_PAD = 4;   // CSS px of transparent margin around every equation sprite
function _vecMeasurePage(root, fx, opts) {
  const spriteMode = !(opts && opts.noSprites) && window.PDF_FAST_EQUATIONS !== false;
  const base = root.getBoundingClientRect();
  const W = PDF_LAYOUT.width, H = PDF_LAYOUT.height;
  const out = { boxes: [], words: [], ghosts: [], markers: [], eqs: [], sprites: [], needsRaster: false, sharp: false, kept: 0, reasons: [] };
  const need = (why, el) => { out.needsRaster = true; if (/^(media|kept-word|pseudo-content|bgimage)/.test(why)) out.sharp = true; if (out.reasons.length < 12) out.reasons.push(why + (el && el.tagName ? ':' + el.tagName.toLowerCase() + (el.className && el.className.baseVal === undefined ? '.' + el.className : '') : '')); };
  const csMap = new Map();
  const CS = (el) => { let c = csMap.get(el); if (!c) { c = getComputedStyle(el); csMap.set(el, c); } return c; };
  const hiddenMap = new Map();
  const isHidden = (el) => {
    if (!el || el === root) return false;
    if (hiddenMap.has(el)) return hiddenMap.get(el);
    const c = CS(el);
    const h = c.display === 'none' || c.visibility === 'hidden' || c.visibility === 'collapse' || parseFloat(c.opacity) === 0 || isHidden(el.parentElement);
    hiddenMap.set(el, h); return h;
  };
  const opMap = new Map();
  const opacityOf = (el) => {
    if (!el || el === root) return 1;
    if (opMap.has(el)) return opMap.get(el);
    const o = (parseFloat(CS(el).opacity) || 1) * opacityOf(el.parentElement);
    opMap.set(el, o); return o;
  };
  const rel = (r) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
  const onPage = (b) => b.x < W && b.y < H && b.x + b.w > 0 && b.y + b.h > 0;
  const all = Array.from(root.querySelectorAll('*'));
  const inSvgOrMath = (el) => !!el.closest('svg, .katex');

  // elements whose subtree needs the raster layer ("dirty") can't have their boxes vectorised
  const dirty = new Set();
  const markUp = (el) => { for (let n = el; n && n !== root; n = n.parentElement) { if (dirty.has(n)) break; dirty.add(n); } };
  // An equation that can be reproduced exactly on its own becomes a "sprite": rendered once, in a shared sheet, as a
  // transparent PNG, and placed above the vector boxes. Anything unusual (transforms, clipping, opacity) stays in the
  // classic full-page raster layer, so the output is never worse than before.
  const makeSprite = (m) => {
    if (!spriteMode || !m.classList.contains('katex') || m.closest('svg')) return false;
    const se = (m.parentElement && m.parentElement.classList.contains('katex-display')) ? m.parentElement : m;
    const r = se.getBoundingClientRect();
    if (!(r.width > 1 && r.height > 1)) return false;
    if (se.getClientRects().length > 1) return false;   // FIX: equation wrapped over 2 lines -> one box would cover both lines (garbled picture)
    if (opacityOf(se) !== 1) return false;
    for (let n = se; n; n = n.parentElement) {
      const c = CS(n);
      if ((c.transform && c.transform !== 'none') || (c.filter && c.filter !== 'none') || (c.zoom && c.zoom !== '1' && c.zoom !== 'normal')) return false;
      if (n === root) break;
    }
    const cse = CS(se);
    if ((cse.overflowX !== 'visible' || cse.overflowY !== 'visible') && (se.scrollWidth > se.clientWidth + 2 || se.scrollHeight > se.clientHeight + 2)) return false;
    m.style.setProperty('color', CS(m).color, 'important');
    se.setAttribute('data-pdfsprite', '1');
    const box = rel(r);
    const node = se.cloneNode(true); node.removeAttribute('data-pdfsprite');
    node.querySelectorAll('.katex-mathml').forEach((e) => e.style.setProperty('display', 'none', 'important'));   // html2canvas ignores clip: MathML text would show up beside the real glyphs
    out.sprites.push({ node, x: box.x, y: box.y, w: box.w, h: box.h, fs: CS(se.parentElement || se).fontSize, color: CS(m).color, disp: se !== m });
    return true;
  };
  root.querySelectorAll('img, svg, canvas, video, iframe, picture, object, embed, .katex').forEach((m) => {
    if (m.closest('svg') && m.tagName.toLowerCase() !== 'svg') return;
    if (m.classList && m.classList.contains('katex') && spriteMode && m.parentElement && m.parentElement.closest('[data-pdfsprite]')) return;   // inside a sprite
    if (!isHidden(m)) {
      if (makeSprite(m)) return;
      need('media', m); markUp(m);
      // equations keep their own colour in the raster layer (their parent's text is hidden, and colour is inherited)
      if (m.classList && m.classList.contains('katex') && !(m.parentElement && m.parentElement.closest('.katex'))) m.style.setProperty('color', CS(m).color, 'important');
    }
  });
  {   // the page element itself is not part of `all`: a theme paints a gradient / grid / tint on it
    const rc = CS(root), rbg = _vecParseColor(rc.backgroundColor);
    const tinted = !!(rbg && rbg.a > 0 && !(rbg.r > 0.99 && rbg.g > 0.99 && rbg.b > 0.99));
    if ((rc.backgroundImage && rc.backgroundImage !== 'none') || tinted) need('page-theme-bg', root);
  }
  all.forEach((el) => {
    if (inSvgOrMath(el) || isHidden(el)) return;
    const c = CS(el);
    if (c.backgroundImage && c.backgroundImage !== 'none') { need('bgimage', el); markUp(el); }
    // generated content (::before / ::after text) is drawn by the raster layer, together with its owner's own text
    for (const ps of ['::before', '::after']) {
      const pc = getComputedStyle(el, ps).content;
      if (pc && pc !== 'none' && pc !== 'normal' && pc !== '""' && pc !== "''") {
        // Only the generated ::before/::after content is rasterised; the element's own text stays vector.
        el.setAttribute('data-pdfpseudo', '1');
        el.style.setProperty('color', c.color, 'important');
        need('pseudo-content', el);
        break;
      }
    }
  });

  // ---- boxes: solid backgrounds + borders, in DOM order ----
  all.forEach((el) => {
    if (inSvgOrMath(el) || isHidden(el)) return;
    const c = CS(el);
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return;
    const bg = _vecParseColor(c.backgroundColor);
    const hasBg = !!(bg && bg.a > 0) && (!c.backgroundImage || c.backgroundImage === 'none');
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map((sd) => ({
      w: parseFloat(c['border' + sd + 'Width']) || 0, st: c['border' + sd + 'Style'], col: _vecParseColor(c['border' + sd + 'Color'])
    }));
    const hasBorder = sides.some((s) => s.w > 0 && s.st !== 'none' && s.st !== 'hidden' && s.col && s.col.a > 0);
    const hasShadow = c.boxShadow && c.boxShadow !== 'none';
    if (!hasBg && !hasBorder && !hasShadow) return;
    if (hasShadow) need('shadow', el);
    if (!hasBg && !hasBorder) return;
    const rad = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => parseFloat(c['border' + k + 'Radius']) || 0);
    const hasRad = rad.some((v) => v > 0);
    let ok = !dirty.has(el);
    if (ok && hasBorder && hasRad) {
      const f = sides[0];
      ok = sides.every((s) => s.w === f.w && s.st === f.st && s.col && f.col && s.col.r === f.col.r && s.col.g === f.col.g && s.col.b === f.col.b && s.col.a === f.col.a);
    }
    if (!ok) { need('box-not-vectorisable', el); return; }
    const box = rel(r);
    const op = opacityOf(el);
    const tags = [];
    if (hasBg) { if (onPage(box)) out.boxes.push({ k: 'fill', ...box, c: bg, a: bg.a * op, rad }); tags.push('g'); }
    if (hasBorder) {
      const collapse = c.display === 'table-cell' && el.closest('table') && CS(el.closest('table')).borderCollapse === 'collapse';
      if (onPage(box)) out.boxes.push({ k: 'border', ...box, sides, rad, a: op, collapse: !!collapse });
      tags.push('b');
    }
    el.setAttribute('data-pdfv', tags.join(' '));
  });

  // ---- words ----
  const mctx = document.createElement('canvas').getContext('2d');
  const metricCache = new Map();
  const metricsOf = (c) => {
    const key = c.fontStyle + c.fontWeight + c.fontSize + c.fontFamily;
    let m = metricCache.get(key);
    if (!m) {
      const fs = parseFloat(c.fontSize) || 14;
      mctx.font = `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
      const t = mctx.measureText('Hg');
      m = { asc: t.fontBoundingBoxAscent != null ? t.fontBoundingBoxAscent : fs * 0.8, desc: t.fontBoundingBoxDescent != null ? t.fontBoundingBoxDescent : fs * 0.2 };
      metricCache.set(key, m);
    }
    return m;
  };
  const decoMap = new Map();
  const decoOf = (el) => {
    if (!el || el === root) return '';
    if (decoMap.has(el)) return decoMap.get(el);
    const d = (CS(el).textDecorationLine || '') + ' ' + decoOf(el.parentElement);
    decoMap.set(el, d); return d;
  };
  const baselineOf = (rect, c) => { const m = metricsOf(c); return rect.top - base.top + (rect.height - (m.asc + m.desc)) / 2 + m.asc; };

  const SKIP = 'svg, .katex, script, style, noscript, .page-footer-number';
  const keepJobs = [];
  let seq = 0;
  const BNRE = /[\u0980-\u09FF\u0964\u0965]/;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const firstWordOf = new Map();           // li -> rect of its first word (for markers)
  // Bengali syllable clusters (base consonant + conjuncts + every vowel sign, e-kar included). The BROWSER measures where each
  // cluster starts, so the PDF can pin every cluster to that exact x. A pre-base vowel sign (ে ৈ ো ৌ ি) is drawn left of its
  // consonant; shaping the whole word in one run let it drift away from the previous letter ("ক রে" instead of "করে").
  const BN_CLUSTER = /(?:[অ-হৎড়-য়](?:্[‌‍]?[ক-হড়-য়])*|[ঀ-৿]|[^ঀ-৿‌‍])[়া-্ৗঁ-ঃ‌‍]*/g;
  // SELF-CHECK: the browser's own width for a piece of Bengali text is compared with the width the PDF glyph layout (fontkit)
  // would give. If they disagree, the PDF layout is NOT the same as what the browser draws (that is exactly what makes a vowel
  // sign drift away from its letter), so that word is not drawn as vector glyphs: it stays in the raster layer, which is the
  // browser's own picture of the word (with an invisible text layer on top, so copy / search still work).
  const bnFits = (str, wpx, fsz) => {
    try {
      const sh = fx.bn.shape(str);
      const exp = sh.adv / fx.bn.upem * fsz;
      const ok = Math.abs(exp - wpx) <= Math.max(0.9, wpx * 0.03);
      if (!ok) { const L = (window.__pdfBnMismatch = window.__pdfBnMismatch || []); if (L.length < 80) L.push({ text: str, browserPx: +wpx.toFixed(1), pdfPx: +exp.toFixed(1) }); }
      // A width difference is only logged. It must NOT send the word to html2canvas: that path cannot shape Bengali, so e-kar / i-kar
      // come out small and detached from their consonant. The vector path pins every syllable to the browser x and fits its width itself.
      return true;
    } catch (_) { return true; }
  };
  // returns: array of clusters | null (not applicable, draw the word as one run) | false (layout mismatch -> raster)
  const bnClusters = (node, start, str, fsz) => {
    try {
      return null;   // NATIVE SHAPING: never split a Bengali word into pinned syllables; the font lays the whole word out itself
      if (!BNRE.test(str)) return null;
      const parts = str.match(BN_CLUSTER);
      if (!parts || parts.length < 2 || parts.join('') !== str) return null;
      const rg = document.createRange(); const res = []; let off = 0;
      for (const p of parts) {
        rg.setStart(node, start + off); rg.setEnd(node, start + off + p.length);
        const rr = Array.from(rg.getClientRects()).filter((q) => q.width > 0.2 && q.height > 0.4);
        if (rr.length !== 1) return null;                 // wrapped / odd layout: keep whole-word drawing
        if (/[ঀ-৿]/.test(p) && !bnFits(p, rr[0].width, fsz)) return false;
        res.push({ t: p, x: rr[0].left - base.left, w: rr[0].width });
        off += p.length;
      }
      return res;
    } catch (_) { return null; }
  };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || parent.closest(SKIP) || isHidden(parent)) continue;
    const c = CS(parent);
    const txt = n.nodeValue;
    const ownerKept = parent.hasAttribute('data-pdfkeep') && !(n.parentElement.hasAttribute('data-pdfkeep') && n.parentElement.getAttribute('data-pdfkeep') === 'w');
    const col = _vecParseColor(c.color) || { r: 0, g: 0, b: 0, a: 1 };
    const op = opacityOf(parent);
    const deco = decoOf(parent);
    const fs = parseFloat(c.fontSize) || 14;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(txt))) {
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      const rects = Array.from(range.getClientRects()).filter((q) => q.width > 0.4 && q.height > 0.4);
      if (!rects.length) continue;
      const box = rel(rects[0]);
      if (!onPage(box)) continue;
      const li = parent.closest('li');
      if (li && !firstWordOf.has(li)) firstWordOf.set(li, { rect: rects[0], c, col, op });
      const word = _vecCase(m[0], c.textTransform);
      let pick = (ownerKept || rects.length > 1 || parent.hasAttribute('data-pdfkeep')) ? null : fx.pick(c, word);
      let wcl = null;
      if (pick && pick.bn) {
        if (!bnFits(pick.t || word, box.w, fs)) pick = null;
        else if (!pick.t && c.textTransform === 'none') { wcl = bnClusters(n, m.index, m[0], fs); if (wcl === false) { pick = null; wcl = null; } }
      }
      // a Bengali word glued to punctuation/Latin ("সংজ্ঞা,") is split into runs so each run gets a font that covers it
      if (!pick && rects.length === 1 && !parent.hasAttribute('data-pdfkeep') && BNRE.test(m[0]) && c.textTransform === 'none') {
        const parts = []; const sre = /[\u0980-\u09FF\u0964\u0965\u200C\u200D]+|[^\u0980-\u09FF\u0964\u0965\u200C\u200D]+/g; let sm, ok = true;
        while ((sm = sre.exec(m[0]))) {
          range.setStart(n, m.index + sm.index); range.setEnd(n, m.index + sm.index + sm[0].length);
          const rr = Array.from(range.getClientRects()).filter((q) => q.width > 0.4 && q.height > 0.4);
          let pk = rr.length === 1 ? fx.pick(c, sm[0]) : null;
          let pcl = null;
          if (pk && pk.bn) {
            if (!bnFits(pk.t || sm[0], rr[0].width, fs)) pk = null;
            else if (!pk.t) { pcl = bnClusters(n, m.index + sm.index, sm[0], fs); if (pcl === false) { pk = null; pcl = null; } }
          }
          if (!pk) { ok = false; break; }
          parts.push({ orig: sm[0], pk, rect: rr[0], off: sm.index, cl: pcl });
        }
        if (ok && parts.length > 1) {
          parts.forEach((pt) => {
            const bx = rel(pt.rect);
            const cl = pt.cl || null;
            out.words.push({ seq: seq++, orig: pt.orig, t: pt.pk.t || pt.orig, x: bx.x, y: bx.y, w: bx.w, h: bx.h, base: baselineOf(pt.rect, c), fs, color: col, a: col.a * op, font: pt.pk, clusters: cl, u: /underline/.test(deco), st: /line-through/.test(deco) });
          });
          continue;
        }
      }
      if (!pick) {
        keepJobs.push({ n, s: m.index, e: m.index + m[0].length, color: c.color }); out.kept++; need('kept-word:' + word, parent);
        // the pixels come from the raster layer, but the word still gets an invisible text layer (select / search / copy)
        out.ghosts.push({ seq: seq++, t: word, x: box.x, y: box.y, w: box.w, h: box.h, base: baselineOf(rects[0], c), fs });
        continue;
      }
      out.words.push({ seq: seq++, orig: pick.t || word, t: pick.t || word, x: box.x, y: box.y, w: box.w, h: box.h, base: baselineOf(rects[0], c), fs, color: col, a: col.a * op, font: pick, clusters: wcl, u: /underline/.test(deco), st: /line-through/.test(deco) });
    }
  }
  // words the vector fonts cannot draw stay in the raster layer (original look, just not zoom-proof / selectable)
  for (let i = keepJobs.length - 1; i >= 0; i--) {
    const j = keepJobs[i];
    try {
      range.setStart(j.n, j.s); range.setEnd(j.n, j.e);
      const sp = document.createElement('span');
      sp.setAttribute('data-pdfkeep', 'w');
      sp.style.setProperty('color', j.color, 'important');
      range.surroundContents(sp);
    } catch (_) { /* leave as is */ }
  }

  // ---- list markers ----
  root.querySelectorAll('li').forEach((li) => {
    if (inSvgOrMath(li) || isHidden(li)) return;
    const c = CS(li);
    if (c.display !== 'list-item' || c.listStyleType === 'none') return;
    const fw = firstWordOf.get(li);
    if (!fw) return;
    const lr = li.getBoundingClientRect();
    const fs = parseFloat(c.fontSize) || 14;
    const contentLeft = lr.left - base.left + (parseFloat(c.paddingLeft) || 0) + (parseFloat(c.borderLeftWidth) || 0);
    const type = c.listStyleType;
    const mk = { kind: 'text', x: contentLeft, base: baselineOf(fw.rect, c), fs, color: fw.col, a: fw.col.a * fw.op, c };
    if (type === 'disc' || type === 'circle' || type === 'square') mk.kind = type; else mk.text = _vecListMarkerText(li, type);
    out.markers.push(mk);
  });

  // ---- equations: invisible TeX text so they stay searchable (pixels come from the raster layer) ----
  root.querySelectorAll('.katex-eq, .katex').forEach((eq) => {
    if (eq.parentElement && eq.parentElement.closest('.katex-eq, .katex')) return;
    if (isHidden(eq)) return;
    const ann = eq.querySelector('annotation[encoding="application/x-tex"]');
    const t = (eq.getAttribute('data-latex') || (ann && ann.textContent) || '').replace(/\s+/g, ' ').trim();
    const box = rel(eq.getBoundingClientRect());
    const hh = eq.querySelector('.katex-html') || eq;
    const txt = (hh.textContent || '').replace(/[\u200B\u00A0]/g, ' ').replace(/\u2212/g, '-').replace(/\s+/g, ' ').trim();
    if (t && onPage(box)) out.eqs.push({ t, txt, ...box, fs: parseFloat(CS(eq).fontSize) || 14 });
  });
  return out;
}

// ---- Bengali syllable segmentation + split-vowel helpers (pure functions, no font needed) ----
// WHY SYLLABLES: Indic shaping is defined per syllable (HarfBuzz = the engine Chrome uses on screen, and Uniscribe, both cut the text
// into syllables first and reorder / substitute inside each one). fontkit does NOT confine its GSUB lookups to a syllable, so when a
// whole word is handed over in one run, contextual lookups can leak across a syllable border and a pre-base vowel sign (e-kar ে,
// ai-kar ৈ, i-kar ি) lands in the wrong place or glued to the wrong letter. Every syllable is therefore shaped on its own and the
// glyph runs are concatenated.
const _BN_C = '[\\u0995-\\u09B9\\u09CE\\u09DC-\\u09DF\\u09F0\\u09F1]';                                   // consonants (incl. ৎ  য় ড় ঢ় ৰ ৱ)
const _BN_SIGN = '[\\u0981-\\u0983\\u09BC\\u09BE-\\u09C4\\u09C7\\u09C8\\u09CB\\u09CC\\u09D7\\u09E2\\u09E3\\u200C\\u200D]';  // ঁ ং ঃ nukta, vowel signs, ZWNJ/ZWJ
const _BN_SYLLABLE_RE = new RegExp(
  '(?:' + _BN_C + '|[\\u0985-\\u0994])\\u09BC?[\\u200C\\u200D]?(?:\\u09CD[\\u200C\\u200D]?' + _BN_C + '\\u09BC?[\\u200C\\u200D]?)*(?:\\u09CD[\\u200C\\u200D]?)?' + _BN_SIGN + '*' +   // consonant OR independent vowel (অ্যা = অ + ্য + া !), then conjunct chain (ZWJ allowed: র‍্য), then its signs
  '|[^\\u0980-\\u09FF\\u200C\\u200D]+' +                                                                                           // Latin, digits, punctuation, danda
  '|[\\u0980-\\u09FF\\u200C\\u200D]', 'g');                                                                                        // any other lone Bengali-block code point
const _VEC_BN_PRE = new Set([0x09BF, 0x09C7, 0x09C8]);   // vowel signs that are DRAWN LEFT of their consonant: ি ে ৈ
function _vecBnIsCons(cp) { return (cp >= 0x0995 && cp <= 0x09B9) || cp === 0x09CE || (cp >= 0x09DC && cp <= 0x09DF) || cp === 0x09F0 || cp === 0x09F1; }
// self-test material: [text, the pre-base vowel sign that must come out BEFORE the consonant glyph(s)]
const _VEC_BN_PRE_TESTS = [
  ['কে', 0x09C7],                 // কে
  ['কো', 0x09C7],                 // কো   (o-kar: ে goes left, া stays right)
  ['কৌ', 0x09C7],                 // কৌ   (au-kar)
  ['কৈ', 0x09C8],                 // কৈ
  ['কি', 0x09BF],                 // কি
  ['ক্ষে', 0x09C7],     // ক্ষে  (the sign must precede the WHOLE conjunct)
  ['স্ট্রো', 0x09C7]   // স্ট্রো
];
const _VEC_BN_CONJ_TESTS = ['ক্ষ', 'ক্র', 'র্ক'];   // ক্ষ  ক্র  র্ক  (must NOT stay a plain letter+hasant sequence)
// OpenType script argument for fontkit's layout(): tried in this order, the first best-scoring one wins.
// 'beng' stays first = what the exporter always forced, so a font that already works keeps its exact current output.
const _VEC_BN_SCRIPT_CANDIDATES = [['beng', 'beng'], ['bng2+beng', ['bng2', 'beng']], ['bng2', 'bng2'], ['auto', undefined]];

// ---- fonts for the vector text ----
// ---- real shaped Bengali text for pdf-lib (GSUB+GPOS via fontkit, per-glyph placement, ToUnicode) ----
function _vecCreateBnFont(pdfDoc, bytes) {
  const L = window.PDFLib, fk = window.fontkit;
  const font = fk.create(bytes);
  const upem = font.unitsPerEm || 1000, k1000 = 1000 / upem;
  const subset = font.createSubset();
  const used = new Map();                       // subset gid -> { w, uni }
  const ctx = pdfDoc.context, ref = ctx.nextRef(), key = 'FBn' + ref.objectNumber;
  const gsCache = new Map();
  const isZW = (cp) => cp === 0x200B || cp === 0x200C || cp === 0x200D;
  const hasCp = (cp) => { try { return font.hasGlyphForCodePoint(cp); } catch (_) { return false; } };

  // o-kar ো (U+09CB) and au-kar ৌ (U+09CC) are TWO glyphs in Bengali: ে goes LEFT of the consonant, া / ৗ stays RIGHT of it.
  // Written out as ে + া / ে + ৗ (their canonical decomposition) every shaper reorders them correctly. Left as one code point, a
  // shaper that does not run the Indic rules draws the whole two-sided glyph after the consonant: the "detached o-kar".
  const prep = (s) => String(s).replace(/[োৌ]/g, (ch) => {
    const b = ch === 'ো' ? 0x09BE : 0x09D7;
    return (hasCp(0x09C7) && hasCp(b)) ? String.fromCharCode(0x09C7, b) : ch;
  });

  // ---- SELF-TEST: pick the OpenType script that really makes fontkit run the Bengali rules for THIS font ----
  // (the old code forced 'beng'; for a font whose Bengali lookups sit under 'bng2' that silently switched shaping OFF, and the
  //  "did shaping activate?" check compared the argument with itself, so it could never fail.)
  const rawLayout = (str, sc) => font.layout(str, undefined, sc);
  const cpsOf = (run) => run.glyphs.map((g) => (g.codePoints && g.codePoints.length) ? g.codePoints : []);
  const nominalIds = (str) => Array.from(str).map((ch) => font.glyphForCodePoint(ch.codePointAt(0)).id);
  const evalCandidate = (label, sc) => {
    const r = { label, sc, pre: 0, preFailed: [], conj: 0, error: '' };
    _VEC_BN_PRE_TESTS.forEach(([s, pre]) => {
      try {
        const cps = cpsOf(rawLayout(prep(s), sc));
        const pi = cps.findIndex((c) => c.indexOf(pre) >= 0);          // glyph that carries the vowel sign
        const bi = cps.findIndex((c) => c.some(_vecBnIsCons));         // first glyph that carries a consonant
        if (pi < 0 || bi < 0 || pi <= bi) r.pre++; else r.preFailed.push(s);   // pi === bi: fused into one glyph = fine
      } catch (e) { r.preFailed.push(s); r.error = String(e && e.message || e); }
    });
    _VEC_BN_CONJ_TESTS.forEach((s) => {
      try {
        const str = prep(s), ids = rawLayout(str, sc).glyphs.map((g) => g.id), nom = nominalIds(str);
        if (!(ids.length === nom.length && ids.every((v, i) => v === nom[i]))) r.conj++;   // anything but the raw letter + hasant glyphs = shaped
      } catch (e) { r.error = String(e && e.message || e); }
    });
    r.score = r.pre + r.conj;
    return r;
  };
  let best = null;
  const tried = _VEC_BN_SCRIPT_CANDIDATES.map(([label, sc]) => {
    const r = evalCandidate(label, sc);
    if (!best || r.score > best.score) best = r;                       // strict '>': on a tie the earlier candidate stays
    return label + ':' + r.score;
  });
  const scriptArg = best.sc;
  const diag = {
    script: best.label, tried, preOK: best.pre + '/' + _VEC_BN_PRE_TESTS.length, preFailed: best.preFailed,
    conjOK: best.conj + '/' + _VEC_BN_CONJ_TESTS.length, shaped: best.conj >= 2, netFixes: 0, error: best.error, font: window.__pdfBengaliFont || '?'
  };

  // ---- shape ONE syllable (cached). Safety net: a pre-base vowel sign that came out AFTER its consonant is moved to the front ----
  // Full-font embedding (default for TrueType-outline fonts such as Kalpurush.ttf): fontkit's subsetter rewrites glyph data, and
  // alternate / composite glyphs appended at the end of the font (Kalpurush's pre-base e-kar is glyph 433, ai-kar 434) can come out
  // shrunken or detached. Embedding the original font file keeps every glyph byte-exact. window.PDF_BN_SUBSET = true restores subsetting.
  const sig = bytes && bytes.length > 4 ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) : '';
  const fullEmbed = window.PDF_BN_SUBSET !== true && (sig === '\u0000\u0001\u0000\u0000' || sig === 'true');
  diag.fullEmbed = fullEmbed;
  try { const eg = font.glyphForCodePoint(0x09C7); const sg = font.layout('\u09B0\u09C7', undefined, scriptArg).glyphs[0]; diag.eKarGlyph = { nominal: eg.id, shaped: sg.id, shapedComposite: (sg._decode && sg._decode() && sg._decode().numberOfContours < 0) || false }; } catch (_) { /* diagnostic only */ }
  const chunkCache = new Map();
  const shapeChunk = (str) => {
    let r = chunkCache.get(str);
    if (r) return r;
    let items;
    try {
      const run = rawLayout(str, scriptArg);
      items = run.glyphs.map((g, i) => ({ g, cps: g.codePoints || [], xa: run.positions[i].xAdvance || 0, xo: run.positions[i].xOffset || 0, yo: run.positions[i].yOffset || 0 }));
    } catch (e) {          // the layout engine refused this piece: draw nominal glyphs, so the word is never silently dropped
      items = Array.from(str).map((ch) => { const cp = ch.codePointAt(0), g = font.glyphForCodePoint(cp); return { g, cps: [cp], xa: g.advanceWidth || 0, xo: 0, yo: 0 }; });
    }
    // অ্যা / এ্যা / আ্যা ...: fontkit's Indic shaper does not treat an independent VOWEL as a base, so the hasant + য after it stay
    // as separate full-width glyphs (the word comes out ~0.7em too wide and its neighbours overlap). Browsers (HarfBuzz) do form it.
    // The syllable is shaped with a consonant (ক) standing in for the vowel - that makes the font run its ya-phala / ra-phala
    // rules - and the stand-in glyph is then swapped for the real vowel glyph. Only done when ক came out as a plain, unfused glyph.
    if (/^[\u0985-\u0994]\u09CD/.test(str)) {
      try {
        const sr = rawLayout('\u0995' + str.slice(1), scriptArg);
        const g0 = sr.glyphs[0];
        if (g0 && g0.codePoints && g0.codePoints.length === 1 && g0.codePoints[0] === 0x0995 && sr.glyphs.length > 1) {
          const vg = font.glyphForCodePoint(str.codePointAt(0));
          items = sr.glyphs.map((g, i) => ({ g: i === 0 ? vg : g, cps: i === 0 ? [str.codePointAt(0)] : (g.codePoints || []), xa: i === 0 ? (vg.advanceWidth || 0) : (sr.positions[i].xAdvance || 0), xo: sr.positions[i].xOffset || 0, yo: sr.positions[i].yOffset || 0 }));
          diag.vowelConj = (diag.vowelConj || 0) + 1;
        }
      } catch (_) { /* keep the plain layout */ }
    }
    if (/[ঀ-৿]/.test(str)) {
      for (let i = 1; i < items.length; i++) {
        const c = items[i].cps;
        if (c.length === 1 && _VEC_BN_PRE.has(c[0]) && items.slice(0, i).some((it) => it.cps.some(_vecBnIsCons))) {
          items.unshift(items.splice(i, 1)[0]);       // ে ৈ ি belong in FRONT of the syllable's consonant(s)
          diag.netFixes++;
        }
      }
    }
    // Kalpurush: fontkit swaps the pre-base e-kar (glyph 105, 426 wide) for a narrower alternate (glyph 433, 303 wide) that the browser
    // does not use, so every ে / ো came out small and cut off from its consonant. The regular glyph is kept (as the browser draws it).
    // window.PDF_BN_E_ALTERNATE = true gives the old behaviour back.
    if (window.PDF_BN_E_ALTERNATE !== true) {
      items.forEach((it) => {
        if (it.cps.length === 1 && it.cps[0] === 0x09C7) {
          const ng = font.glyphForCodePoint(0x09C7);
          if (ng && ng.id !== it.g.id) { it.g = ng; it.xa = ng.advanceWidth || it.xa; diag.eNominal = (diag.eNominal || 0) + 1; }
        }
      });
    }
    let pen = 0; const gl = [];
    items.forEach((it) => {
      const gid = fullEmbed ? it.g.id : subset.includeGlyph(it.g);   // full embed: real glyph ids, no subsetting
      if (!used.has(gid)) used.set(gid, { w: it.g.advanceWidth, uni: (it.cps && it.cps.length) ? String.fromCodePoint.apply(null, it.cps) : '' });
      gl.push({ gid, x: pen + it.xo, y: it.yo });
      pen += it.xa;
    });
    r = { glyphs: gl, adv: pen };
    chunkCache.set(str, r);
    return r;
  };

  const api = {
    key, upem, diag,
    covers(text) {
      for (const ch of prep(text)) { const cp = ch.codePointAt(0); if (isZW(cp)) continue; if (!font.hasGlyphForCodePoint(cp)) return false; }
      return true;
    },
    has(cp) { return font.hasGlyphForCodePoint(cp); },
    shape(text) {
      const glyphs = []; let pen = 0;
      (prep(text).match(_BN_SYLLABLE_RE) || []).forEach((ch) => {
        const r = shapeChunk(ch);
        r.glyphs.forEach((g) => glyphs.push({ gid: g.gid, x: pen + g.x, y: g.y }));
        pen += r.adv;
      });
      return { glyphs, adv: pen };
    },
    // draws one shaped run; (x, baselineY) in PDF points. Returns nothing.
    draw(page, shaped, x, y, size, color, opacity, embolden, hs) {
      hs = (hs && Math.abs(hs - 1) > 0.005) ? hs : 1;
      const sc = size / upem, ops = [], O = L.PDFOperator.of, N = L.PDFOperatorNames;
      page.node.setFontDictionary(L.PDFName.of(key), ref);
      ops.push(O(N.PushGraphicsState));
      if (opacity != null && opacity < 0.999) {
        const kk = String(Math.round(opacity * 1000));
        let gsRef = gsCache.get(kk);
        if (!gsRef) { gsRef = ctx.register(ctx.obj({ Type: 'ExtGState', ca: opacity, CA: opacity })); gsCache.set(kk, gsRef); }
        const gsName = L.PDFName.of('GBn' + kk + '_' + ref.objectNumber);
        page.node.setExtGState(gsName, gsRef);
        ops.push(O(N.SetGraphicsStateParams, [gsName]));
      }
      ops.push(O(N.NonStrokingColorRgb, [L.asPDFNumber(color.r), L.asPDFNumber(color.g), L.asPDFNumber(color.b)]));
      if (embolden) {   // faux bold in the SAME text run (fill + thin stroke), so copy/search never sees duplicate text
        ops.push(O(N.StrokingColorRgb, [L.asPDFNumber(color.r), L.asPDFNumber(color.g), L.asPDFNumber(color.b)]));
        ops.push(O(N.SetLineWidth, [L.asPDFNumber(Math.max(0.15, size * 0.014))]));
        ops.push(O(N.SetTextRenderingMode, [L.asPDFNumber(2)]));
      }
      ops.push(O(N.BeginText));
      if (hs !== 1 && N.SetTextHorizontalScaling) ops.push(O(N.SetTextHorizontalScaling, [L.asPDFNumber(hs * 100)]));
      ops.push(O(N.SetFontAndSize, [L.PDFName.of(key), L.asPDFNumber(size)]));
      shaped.glyphs.forEach((g) => {
        ops.push(O(N.SetTextMatrix, [1, 0, 0, 1, x + g.x * sc * hs, y + g.y * sc].map((v) => L.asPDFNumber(v))));
        ops.push(O(N.ShowText, [L.PDFHexString.of(g.gid.toString(16).padStart(4, '0'))]));
      });
      ops.push(O(N.EndText));
      ops.push(O(N.PopGraphicsState));
      page.pushOperators.apply(page, ops);
    },
    async finish() {
      if (!used.size) return;   // a font that was drawn with must always be finished, else its object stays dangling
      let fontBytes;
      if (fullEmbed) fontBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      else {
        const chunks = await new Promise((resolve) => { const c = []; subset.encodeStream().on('data', (d) => c.push(d)).on('end', () => resolve(c)); });
        let total = 0; chunks.forEach((c) => { total += c.length; });
        fontBytes = new Uint8Array(total); let o = 0; chunks.forEach((c) => { fontBytes.set(c, o); o += c.length; });
      }
      const name = 'AAAAAA+BnText';
      const ff = ctx.register(ctx.flateStream(fontBytes, { Length1: fontBytes.length }));
      const bb = font.bbox || { minX: 0, minY: -300, maxX: 1000, maxY: 900 };
      const desc = ctx.register(ctx.obj({
        Type: 'FontDescriptor', FontName: name, Flags: 4,
        FontBBox: [bb.minX * k1000, bb.minY * k1000, bb.maxX * k1000, bb.maxY * k1000].map(Math.round),
        ItalicAngle: 0, Ascent: Math.round((font.ascent || 900) * k1000), Descent: Math.round((font.descent || -250) * k1000),
        CapHeight: Math.round((font.capHeight || font.ascent || 700) * k1000), StemV: 80, FontFile2: ff
      }));
      const W = []; Array.from(used.keys()).sort((a, b) => a - b).forEach((gid) => { W.push(gid, [Math.round(used.get(gid).w * k1000)]); });
      const cid = ctx.register(ctx.obj({
        Type: 'Font', Subtype: 'CIDFontType2', BaseFont: name,
        CIDSystemInfo: { Registry: L.PDFString.of('Adobe'), Ordering: L.PDFString.of('Identity'), Supplement: 0 },
        FontDescriptor: desc, W, DW: 1000, CIDToGIDMap: 'Identity'
      }));
      const hex = (s) => { let h = ''; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0'); return h; };
      const rows = Array.from(used.entries()).filter(([, v]) => v.uni).sort((a, b) => a[0] - b[0]);
      let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
      for (let i = 0; i < rows.length; i += 100) {
        const part = rows.slice(i, i + 100);
        cmap += part.length + ' beginbfchar\n' + part.map(([gid, v]) => '<' + gid.toString(16).padStart(4, '0') + '> <' + hex(v.uni) + '>').join('\n') + '\nendbfchar\n';
      }
      cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      const tu = ctx.register(ctx.stream(cmap));
      ctx.assign(ref, ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: tu }));
    }
  };
  return api;
}

const fx_missing = new Set();   // code points the Bengali font cannot draw (reported once per export)
async function _vecMakeFonts(pdfDoc) {
  fx_missing.clear();
  const { StandardFonts } = window.PDFLib;
  const S = StandardFonts;
  const table = {
    serif: { n: S.TimesRoman, b: S.TimesRomanBold, i: S.TimesRomanItalic, bi: S.TimesRomanBoldItalic },
    sans: { n: S.Helvetica, b: S.HelveticaBold, i: S.HelveticaOblique, bi: S.HelveticaBoldOblique },
    mono: { n: S.Courier, b: S.CourierBold, i: S.CourierOblique, bi: S.CourierBoldOblique }
  };
  const fonts = {};
  for (const cls of Object.keys(table)) {
    fonts[cls] = {};
    for (const v of Object.keys(table[cls])) {
      const f = await pdfDoc.embedFont(table[cls][v]);
      fonts[cls][v] = { font: f, set: new Set(f.getCharacterSet()) };
    }
  }
  // Bengali: real, fully shaped glyph text (GSUB + GPOS through fontkit, placed glyph by glyph, subset-embedded, with a
  // ToUnicode map and /ActualText). pdf-lib's own drawText cannot position Indic glyphs, so _vecCreateBnFont does it.
  let bn = null;
  if (window.fontkit && window.PDF_BENGALI_VECTOR !== false) {
    const bytes = await _vecLoadKalpurushBytes();
    if (bytes) {
      try {
        bn = _vecCreateBnFont(pdfDoc, bytes);
        const d = window.__pdfBnDiag = bn.diag;          // inspect in the console:  __pdfBnDiag
        console.info('[PDF] Bengali shaping check:', d);
        // Vector Bengali is used ONLY when the font really shaped the conjuncts (ক্ষ ক্র র্ক). If it did not, fontkit is not running the
        // Indic rules for this font and every vowel sign / conjunct would be drawn detached: those words stay in the raster layer.
        // (window.PDF_BENGALI_FORCE_VECTOR = true skips this guard.)
        if (!d.shaped && window.PDF_BENGALI_FORCE_VECTOR !== true) throw new Error('fontkit does not form Bengali conjuncts for this font (script tried: ' + d.tried.join(', ') + ')');
        if (d.preFailed.length) console.warn('[PDF] fontkit left the vowel sign in logical order for: ' + d.preFailed.join(' ') + ' (script "' + d.script + '"); the exporter moves it in front of the consonant itself.');
        bn.shape('ক্ষি'); bn.shape('করে, খোঁজে'); bn.shape('কোথায়, বৌদ্ধ, ক্ষেত্রে');   // smoke test (must not throw)
      }
      catch (e) { console.warn('Bengali shaping is unavailable; Bengali keeps raster pixels + invisible text layer:', e); bn = null; }
    }
  }
  const BN = /[\u0980-\u09FF\u0964\u0965]/;
  const covers = (set, text) => { for (const ch of text) if (!set.has(ch.codePointAt(0))) return false; return true; };
  return {
    bn,
    pick(c, text) {
      const bold = parseInt(c.fontWeight, 10) >= 600 || c.fontWeight === 'bold';
      if (BN.test(text)) {
        if (!bn) return null;
        if (bn.covers(text)) return { bn: true, bold };
        // Text pasted from AI output often uses the precomposed য় ড় ঢ় (U+09DF/09DC/09DD) or invisible marks the font has
        // no glyph for. Normalising them keeps the word as REAL vector text (the raster fallback draws Bengali through
        // html2canvas, which cannot shape conjuncts: stray hasant marks, glued words, lost spaces).
        const clean = _pdfDevaToBn(text.normalize('NFC')).replace(/[\u00AD\u2060\uFEFF\u200E\u200F]/g, '');
        if (clean !== text && bn.covers(clean)) return { bn: true, bold, t: clean };
        try {
          const miss = [];
          for (const ch of clean) { const cp = ch.codePointAt(0); if (cp !== 0x200B && cp !== 0x200C && cp !== 0x200D && !bn.has(cp)) miss.push('U+' + cp.toString(16).toUpperCase().padStart(4, '0')); }
          if (miss.length && fx_missing.size < 40) miss.forEach((m) => fx_missing.add(m));
        } catch (_) { /* diagnostic only */ }
        return null;
      }
      let cls = 'serif';
      for (const raw of c.fontFamily.toLowerCase().split(',')) {
        const p = raw.trim().replace(/['"]/g, '');
        if (/courier|mono|consolas|menlo|monaco/.test(p)) { cls = 'mono'; break; }
        if (/arial|helvetica|sans-serif|segoe|calibri|verdana|tahoma|inter|roboto|system-ui|-apple-system|open sans|trebuchet/.test(p)) { cls = 'sans'; break; }
        if (/times|tinos|liberation serif|georgia|cambria|garamond|serif|kalpurush/.test(p)) { cls = 'serif'; break; }
      }
      const italic = c.fontStyle === 'italic' || c.fontStyle === 'oblique';
      const f = fonts[cls][bold && italic ? 'bi' : bold ? 'b' : italic ? 'i' : 'n'];
      if (covers(f.set, text)) return { font: f.font };
      return null;
    },
    ghost(text) {   // font + encodable text for an invisible layer (real text is carried by /ActualText)
      const t = Array.from(text).filter((ch) => fonts.serif.n.set.has(ch.codePointAt(0))).join('');
      if (t) return { font: fonts.serif.n.font, t };
      const len = Array.from(text).filter((ch) => !/[\u200B-\u200D]/.test(ch)).length;
      return { font: fonts.serif.n.font, t: 'n'.repeat(Math.max(1, len)) };
    },
    anyAscii(text) { const f = fonts.serif.n; return Array.from(text).filter((ch) => f.set.has(ch.codePointAt(0))).join(''); },
    async finishBn() { if (bn) await bn.finish(); },
    plain: fonts.serif.n.font
  };
}
let _vecKalBytesPromise = null;
// A real font file starts with one of these signatures. A missing file that the server answers with
// index.html (HTTP 200) is NOT a font: it used to be accepted, shaping failed, and every Bengali word
// silently fell back to html2canvas (broken conjuncts / detached vowel signs / wrong font).
function _pdfLooksLikeFont(b) {
  if (!b || b.length < 2000) return false;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  return (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || tag === 'true' || tag === 'OTTO' || tag === 'wOFF' || tag === 'wOF2' || tag === 'ttcf';
}
function _vecLoadKalpurushBytes() {
  if (window.PDF_BENGALI_VECTOR === false) return Promise.resolve(null);
  if (!_vecKalBytesPromise) {
    const mk = (p) => { try { return new URL(p, document.baseURI).href; } catch (_) { return null; } };
    // Kalpurush ONLY first. Put the file at  fonts/Kalpurush.ttf  (next to index.html)
    // or set  window.PDF_BENGALI_FONT_URL = 'https://your-site/path/Kalpurush.ttf'.
    const own = [window.PDF_BENGALI_FONT_URL, mk('fonts/Kalpurush.ttf'), mk('/fonts/Kalpurush.ttf'), mk('fonts/kalpurush.ttf'),
      mk('Kalpurush.ttf'), mk('assets/fonts/Kalpurush.ttf'), mk('fonts/Kalpurush.woff2')].filter(Boolean);
    const fallback = 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff';
    _vecKalBytesPromise = (async () => {
      const seen = new Set();
      for (const u of own) {
        if (seen.has(u)) continue; seen.add(u);
        try {
          const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status);
          const bytes = new Uint8Array(await r.arrayBuffer());
          if (!_pdfLooksLikeFont(bytes)) throw new Error('not a font file (server returned something else)');
          window.__pdfBengaliFont = 'Kalpurush';
          return bytes;
        } catch (e) { console.warn('Kalpurush not available at ' + u + ':', e && e.message ? e.message : e); }
      }
      try {   // last resort only: real shaped Bengali text, but NOT Kalpurush
        const r = await fetch(fallback); if (!r.ok) throw new Error('HTTP ' + r.status);
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (_pdfLooksLikeFont(bytes)) { window.__pdfBengaliFont = 'fallback'; console.error('[PDF] Kalpurush.ttf NOT FOUND - using a fallback Bengali font. Put fonts/Kalpurush.ttf next to index.html or set window.PDF_BENGALI_FONT_URL.'); return bytes; }
      } catch (e) { console.warn('Fallback Bengali font failed:', e); }
      window.__pdfBengaliFont = 'none';
      _vecKalBytesPromise = null; return null;
    })();
  }
  return _vecKalBytesPromise;
}

// ===== FONT POLICY FOR THE EXPORT (measuring + raster): English = Times New Roman, Bengali = Kalpurush =====
// The vector exporter MEASURES every word in the live page and then draws it with Times (English) / Kalpurush
// (Bengali). If the measuring page used any other font (the app's UI font, or a system Bengali fallback), the
// measured widths did not match the drawn glyphs: words were squeezed, spaces vanished, shapes looked wrong.
// So, before laying out pages, the real Kalpurush bytes are registered as a FontFace and every export page is
// forced onto the same font stack that the PDF itself uses.
let _pdfDocFontsPromise = null;
const PDF_EXPORT_FONT_STACK = "'Times New Roman','Tinos','Liberation Serif',Times,'KalpurushPDF','Kalpurush',serif";
function _pdfEnsureDocFonts() {
  if (_pdfDocFontsPromise) return _pdfDocFontsPromise;
  _pdfDocFontsPromise = (async () => {
    try {
      if (!document.getElementById('pdf-export-font-policy')) {
        const st = document.createElement('style');
        st.id = 'pdf-export-font-policy';
        st.textContent = `.pdf-export-measure-page, .pdf-export-measure-page *:not(.katex):not(.katex *):not(.katex-eq *):not(svg):not(svg *):not(pre):not(pre *):not(code):not(code *){font-family:${PDF_EXPORT_FONT_STACK} !important;font-kerning:normal;text-rendering:geometricPrecision;}
.pdf-export-measure-page, .pdf-export-measure-page *{letter-spacing:normal !important;word-spacing:normal !important;font-variant-ligatures:normal !important;}`;
        document.head.appendChild(st);
      }
      const bytes = await _vecLoadKalpurushBytes();
      if (bytes && typeof FontFace === 'function' && document.fonts) {
        const face = new FontFace('KalpurushPDF', bytes.slice().buffer, { style: 'normal', weight: '400' });
        await face.load();
        document.fonts.add(face);
        try { await document.fonts.load("16px KalpurushPDF", "\u0985\u0995\u09CD\u09B7"); } catch (_) {}
      }
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (e) {
      console.warn('Could not prepare export fonts:', e);
      _pdfDocFontsPromise = null;
    }
  })();
  return _pdfDocFontsPromise;
}
function _pdfWarnIfNoKalpurush() {
  if (window.__pdfBengaliFont && window.__pdfBengaliFont !== 'Kalpurush' && typeof displayToastNotification === 'function') {
    displayToastNotification('⚠️ Kalpurush font file not found (fonts/Kalpurush.ttf). Bengali is using a fallback font.');
  }
}

// ===== SIMPLE EQUATIONS -> REAL NATIVE TEXT =====
// An equation made only of numbers, letters, + - = x /, units (\text{ L}, \text{ mL}) and Bengali words has no 2-D
// layout (no fraction, root, exponent, big operator). Such an equation used to be a picture: no real text layer
// ("L", "mL" could not be selected / searched) and its Bengali / danda glyphs came from KaTeX's fallback fonts.
// It is now replaced by a plain text run (Times New Roman / Kalpurush), which the vector exporter draws as real text.
// Anything with a fraction, exponent, root, Greek, etc. is left alone and stays a sharp equation image.
function _pdfNativizeSimpleMath(root) {
  try {
    if (!root || !root.querySelectorAll) return;
    const COMPLEX = '.vlist-t, .sqrt, .delimsizing, .delimcenter, .mop, .op-symbol, .accent, .overline, .underline, .stretchy, .mfrac, .mtable, .enclosing, .fbox, .boxpad, .svg-align, .mathbb, .mathcal, .mathfrak, .mathscr, .mathsf, .mathtt, .boldsymbol, .nulldelimiter, svg';
    const OK = /^[\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2212\u0980-\u09FF\u0964\u0965\u200C\u200D]+$/;
    Array.from(root.querySelectorAll('.katex')).forEach((k) => {
      if (!k.isConnected || k.closest('.katex-display') || k.closest('svg')) return;
      if (k.parentElement && k.parentElement.closest('.katex')) return;
      const html = k.querySelector('.katex-html');
      if (!html || html.querySelector(COMPLEX)) return;
      const host = (k.parentElement && k.parentElement.classList.contains('katex-eq') && k.parentElement.children.length === 1 && !(k.parentElement.textContent || '').replace(k.textContent || '', '').trim()) ? k.parentElement : k;
      const hd = getComputedStyle(host).display;
      if (hd === 'block' || hd === 'flex' || hd === 'grid' || hd === 'table') return;
      // read the equation leaf by leaf, putting back the spacing KaTeX draws with margins
      const runs = [];
      const push = (t, it, bd) => {
        if (!t) return;
        const last = runs[runs.length - 1];
        if (last && last.it === it && last.bd === bd) last.t += t; else runs.push({ t, it, bd });
      };
      html.querySelectorAll('*').forEach((n) => {
        if (n.children.length) return;
        const cl = n.classList;
        if (cl.contains('strut')) return;
        let t = (n.textContent || '').replace(/[\u200B]/g, '').replace(/[\u00A0\u2009\u200A\u2002\u2003]/g, ' ').replace(/\u2212/g, '\u2013');
        const it = !!(cl.contains('mathnormal') || cl.contains('mathit') || n.closest('.mathnormal, .mathit'));
        const bd = !!(cl.contains('mathbf') || n.closest('.mathbf, .textbf'));
        if (!t) { if (cl.contains('mspace')) push(' ', false, false); return; }
        if (cl.contains('mrel') || cl.contains('mbin') || n.closest('.mrel, .mbin')) t = ' ' + t.trim() + ' ';
        else if (cl.contains('mpunct') || n.closest('.mpunct')) t = t.trim() + ' ';
        push(t, it && !/[\u0980-\u09FF]/.test(t), bd);
      });
      if (!runs.length) return;
      for (let i = 0; i < runs.length; i++) {          // tidy spaces across run borders
        runs[i].t = runs[i].t.replace(/\s{2,}/g, ' ');
        if (i > 0 && /\s$/.test(runs[i - 1].t)) runs[i].t = runs[i].t.replace(/^\s+/, '');
      }
      const all = runs.map((r) => r.t).join('');
      if (!all.trim() || !OK.test(all)) return;        // Greek, arrows, exotic symbols: keep the equation image
      const wrap = document.createElement('span');
      wrap.className = 'pdf-native-math';
      wrap.setAttribute('data-pdf-native-math', '1');
      wrap.style.setProperty('font-size', '1.08em');
      runs.forEach((r) => {
        if (!r.it && !r.bd) { wrap.appendChild(document.createTextNode(r.t)); return; }
        const sp = document.createElement('span');
        if (r.it) sp.style.setProperty('font-style', 'italic');
        if (r.bd) sp.style.setProperty('font-weight', '700');
        sp.textContent = r.t;
        wrap.appendChild(sp);
      });
      host.parentNode.replaceChild(wrap, host);
    });
  } catch (e) { console.warn('Simple-equation text conversion failed (equations left as images):', e); }
}

// ===== INLINE EQUATIONS MUST STAY INLINE =====
// The page is cloned into the export host, outside the editor, so the editor's own rules for an equation that sits inside a sentence
// ("... হাইড্রোজেন আয়ন (H⁺) উৎপন্ন করে") are gone and the equation wrapper falls back to display:block / width:100%. The sentence is then
// cut in two and the equation gets a line of its own. Any equation wrapper that has text around it (and is not a real display
// equation) is put back to inline-block before the layout is measured.
function _pdfKeepInlineEquationsInline(root) {
  try {
    if (!root || !root.querySelectorAll) return 0;
    let n = 0;
    root.querySelectorAll('.katex-eq').forEach((eq) => {
      if (eq.querySelector('.katex-display') || eq.closest('.katex-display')) return;     // real display equation: leave alone
      const par = eq.parentElement;
      if (!par) return;
      let around = '';
      par.childNodes.forEach((c) => { if (c !== eq) around += (c.textContent || ''); });
      if (!around.replace(/\s+/g, '')) return;                                            // equation alone in its block: leave alone
      const cs = getComputedStyle(eq);
      if (cs.display === 'inline-block' || cs.display === 'inline') return;
      ['display:inline-block', 'width:auto', 'max-width:100%', 'float:none', 'clear:none', 'margin-left:0', 'margin-right:0', 'vertical-align:baseline'].forEach((d) => { const [k, v] = d.split(':'); eq.style.setProperty(k, v, 'important'); });
      n++;
    });
    return n;
  } catch (e) { console.warn('Inline equation fix failed (left as is):', e); return 0; }
}

// ===== DEVANAGARI SIGNS INSIDE BENGALI WORDS (broken e-kar / o-kar / i-kar) =====
// Text pasted from AI output sometimes carries a DEVANAGARI sign (ि े ो ् ा ...) where the BENGALI sign belongs, e.g. "আংশ" + U+093F + "ক".
// In the editor it looks almost right, but Kalpurush has no glyph for it. The word then fell out of the vector path into the raster
// fallback, and the vowel sign came out detached from its letter ("আংশ◌িক"). Bengali and Devanagari are laid out in parallel
// (offset 0x80), so each such sign is replaced by its Bengali twin. It is applied only to text that already holds Bengali letters.
const _PDF_DEVA_SIGN_RE = /[\u0901-\u0903\u093C\u093E-\u0943\u0947\u0948\u094B-\u094D]/g;
function _pdfDevaToBn(str) {
  _PDF_DEVA_SIGN_RE.lastIndex = 0;
  return (str && _PDF_DEVA_SIGN_RE.test(str)) ? str.replace(_PDF_DEVA_SIGN_RE, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x80)) : str;
}
function _pdfFixForeignBengaliSigns(root) {
  try {
    if (!root || !document.createTreeWalker) return 0;
    const BNL = /[\u0985-\u09B9\u09DC-\u09DF]/;               // a Bengali letter
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue;
      if (!v) continue;
      _PDF_DEVA_SIGN_RE.lastIndex = 0;
      if (!_PDF_DEVA_SIGN_RE.test(v)) continue;
      const p = n.parentElement;
      if (p && p.closest('script, style, noscript')) continue;
      if (BNL.test(v) || (p && BNL.test(p.textContent || ''))) hits.push(n);
    }
    hits.forEach((n) => { n.nodeValue = _pdfDevaToBn(n.nodeValue); });
    _PDF_DEVA_SIGN_RE.lastIndex = 0;
    return hits.length;
  } catch (e) { console.warn('Foreign Bengali sign fix failed (text left as is):', e); return 0; }
}

// ===== BENGALI INSIDE EQUATIONS (\text{...}) =====
// KaTeX writes every character of a \text{...} group into its OWN <span>. html2canvas draws each text node
// separately, so a Bengali word loses its shaping: vowel signs (matra, e.g. ু ি ো) detach and drop/float, the
// headline (মাত্রা) breaks between letters, "এবং" / "।" shrink or jump. Before the equations are drawn, every such
// group is collapsed into ONE text node in Kalpurush, so the browser shapes the whole word as a unit.
function _pdfFixBengaliInMath(root) {
  try {
    if (!root || !root.querySelectorAll) return;
    const BN = /[\u0980-\u09FF\u0964\u0965]/;
    const collapse = (el) => {
      const txt = (el.textContent || '').replace(/[\u00A0\u2009\u200A\u2002\u2003]/g, ' ').replace(/\u200B/g, '');
      if (!txt.trim()) return;
      const bold = !!el.querySelector('.textbf, .mathbf, .boldsymbol') || /\b(textbf|mathbf)\b/.test(el.className || '');
      const sp = document.createElement('span');
      sp.className = 'pdf-bn-math';
      sp.setAttribute('data-pdfbn', '1');
      sp.style.setProperty('font-family', PDF_EXPORT_FONT_STACK, 'important');
      sp.style.setProperty('font-style', 'normal', 'important');
      sp.style.setProperty('font-weight', bold ? '700' : '400', 'important');
      sp.style.setProperty('white-space', 'pre', 'important');
      sp.style.setProperty('letter-spacing', 'normal', 'important');
      sp.style.setProperty('margin', '0', 'important');
      sp.style.setProperty('padding', '0', 'important');
      sp.textContent = txt;
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(sp);
      el.style.setProperty('margin-right', '0', 'important');
    };
    root.querySelectorAll('.katex-html').forEach((html) => {
      if (!BN.test(html.textContent || '')) return;
      // 1) \text{...} groups (and \textbf / \mathrm groups KaTeX marks as text)
      html.querySelectorAll('.text').forEach((g) => { if (BN.test(g.textContent) && !g.closest('[data-pdfbn]') && !g.querySelector('.vlist-t, .mfrac, .sqrt')) collapse(g); });
      // 2) any remaining group made only of single-character leaf spans that contains Bengali
      html.querySelectorAll('span').forEach((g) => {
        if (g.hasAttribute('data-pdfbn') || g.closest('[data-pdfbn]') || g.children.length < 2) return;
        if (!BN.test(g.textContent || '')) return;
        const kids = Array.from(g.children);
        if (kids.every((k) => k.children.length === 0 && !k.classList.contains('strut'))) collapse(g);
      });
      // 3) Bengali typed in MATH mode (not inside \text{}), e.g. "pOH = -\u09B2\u09CB\u0997[OH-]": KaTeX puts every character (consonant,
      //    vowel sign, hasant) in its own <span> next to the other math symbols, so no group qualifies above and html2canvas draws
      //    the vowel sign detached. Every run of neighbouring one-character spans that holds Bengali becomes ONE text node.
      const isBnLeaf = (k) => k.nodeType === 1 && k.children.length === 0 && !k.hasAttribute('data-pdfbn') && /^[\u0980-\u09FF\u200C\u200D\u0964\u0965]+$/.test(k.textContent || '');
      const parents = new Set();
      html.querySelectorAll('span').forEach((k) => { if (isBnLeaf(k) && k.parentElement && !k.closest('[data-pdfbn]')) parents.add(k.parentElement); });
      parents.forEach((par) => {
        if (par.closest('[data-pdfbn]')) return;
        let run = [];
        const flush = () => {
          if (run.length >= 2 || (run.length === 1 && /[\u09BC-\u09CD\u09D7\u0981-\u0983]/.test(run[0].textContent))) {
            const sp = document.createElement('span');
            sp.className = 'pdf-bn-math'; sp.setAttribute('data-pdfbn', '1');
            sp.style.setProperty('font-family', PDF_EXPORT_FONT_STACK, 'important');
            sp.style.setProperty('font-style', 'normal', 'important'); sp.style.setProperty('font-weight', '400', 'important');
            sp.style.setProperty('white-space', 'pre', 'important'); sp.style.setProperty('letter-spacing', 'normal', 'important');
            sp.style.setProperty('margin', '0', 'important'); sp.style.setProperty('padding', '0', 'important');
            sp.textContent = run.map((r) => r.textContent).join('');
            run[0].parentNode.insertBefore(sp, run[0]);
            run.forEach((r) => r.remove());
          }
          run = [];
        };
        Array.from(par.childNodes).forEach((ch) => { if (ch.nodeType === 1 && isBnLeaf(ch)) run.push(ch); else flush(); });
        flush();
      });
    });
  } catch (e) { console.warn('Bengali-in-equation fix failed (equation left as is):', e); }
}


// ===== KaTeX TALL DELIMITERS ({ } [ ] ( ) | ‖ ⌊ ⌋ ⌈ ⌉) -> ONE fixed-size <svg> =====
// WHY: KaTeX builds every delimiter taller than \Bigg out of a vlist: separate glyph pieces (top hook / middle cusp / bottom hook
// in KaTeX_Size4) plus separate absolutely-positioned <svg> rods, each placed with a negative `top`, inside an inline-table.
// html2canvas cannot reproduce that stack: the rods vanish or drift and the hooks end up detached (the "broken brace/bracket"
// symptom). Before any capture, each such delimiter is replaced by a single self-contained <svg> whose width/height/baseline are
// measured from the live layout, so the picture no longer depends on how the stack is laid out. Idempotent; never throws.
function _pdfBakeKatexDelimiters(root) {
  try {
    if (!root || !root.querySelectorAll) return;
    const doc = root.ownerDocument || document;
    const win = doc.defaultView || window;
    const NS = 'http://www.w3.org/2000/svg';
    const GLYPH_KIND = [
      [/[\u23A7-\u23A9]/, 'lbrace'], [/[\u23AB-\u23AD]/, 'rbrace'],
      [/[\u239B-\u239D]/, 'lparen'], [/[\u239E-\u23A0]/, 'rparen'],
      [/[\u23A1-\u23A3]/, 'lbrack'], [/[\u23A4-\u23A6]/, 'rbrack']
    ];
    root.querySelectorAll('.katex .delimsizing.mult').forEach((el) => {
      if (el.getAttribute('data-pdfbaked')) return;
      try {
        const vt = el.querySelector('.vlist-t');
        const first = vt && vt.querySelector('.vlist-r .vlist');
        if (!vt || !first) return;
        const cs = win.getComputedStyle(el);
        const fs = parseFloat(cs.fontSize) || 16;
        const color = cs.color || '#000';
        const T = vt.getBoundingClientRect();           // whole stack: height above baseline + depth below it
        const F = first.getBoundingClientRect();        // its bottom edge is the baseline
        const svgs = Array.from(el.querySelectorAll('svg'));
        const glyphs = Array.from(el.querySelectorAll('.delimsizinginner'));
        // ---- real extent = union of every piece (the table itself can be narrower than its absolutely placed pieces) ----
        const E = el.getBoundingClientRect();           // the delimiter's real LAYOUT box (an inline box one line tall): kept untouched
        let L = Infinity, Rr = -Infinity, Tp = T.top, Bt = T.bottom;
        svgs.forEach((s) => { const r = s.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { L = Math.min(L, r.left); Rr = Math.max(Rr, r.right); Tp = Math.min(Tp, r.top); Bt = Math.max(Bt, r.bottom); } });
        glyphs.forEach((g) => { const r = g.getBoundingClientRect(); if (r.width > 0) { L = Math.min(L, r.left); Rr = Math.max(Rr, r.right); } });
        if (!isFinite(L)) { L = E.left; Rr = E.right; }
        const W = Rr - L, H = Bt - Tp;
        if (!(W > 1 && H > 1)) return;
        const depth = Bt - F.bottom;                    // how far the stack hangs below the text baseline
        const glyphText = glyphs.map((g) => g.textContent).join('');
        let kind = '';
        for (const [re, k] of GLYPH_KIND) if (re.test(glyphText)) { kind = k; break; }

        const svg = doc.createElementNS(NS, 'svg');
        svg.setAttribute('xmlns', NS);
        svg.setAttribute('width', W.toFixed(3)); svg.setAttribute('height', H.toFixed(3));
        svg.setAttribute('viewBox', '0 0 ' + W.toFixed(3) + ' ' + H.toFixed(3));
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('overflow', 'visible');
        svg.setAttribute('data-pdfbaked-svg', '1');
        svg.style.cssText = 'display:block;position:static;overflow:visible;width:' + W.toFixed(3) + 'px;height:' + H.toFixed(3) + 'px;';

        if (kind && glyphs.length) {
          // glyph-stacked delimiter (braces / parentheses / old-style brackets): redraw the whole thing as one stroked path
          const th = Math.max(0.9, 0.085 * fs);          // stroke weight ~ KaTeX rule
          const y0 = th / 2, yE = H - th / 2;
          const right = /^r/.test(kind);
          const X = (x) => (right ? W - x : x);
          const p = doc.createElementNS(NS, 'path');
          let d = '';
          if (/brace/.test(kind)) {
            const c = 0.5 * W, xe = 0.84 * W, xt = 0.14 * W;
            const hh = Math.min(0.46 * fs, H * 0.2), ch = Math.min(0.46 * fs, H * 0.2), ym = H / 2;
            d = 'M' + X(xe) + ' ' + y0 +
                ' C' + X(c + (xe - c) * 0.45) + ' ' + y0 + ' ' + X(c) + ' ' + (y0 + hh * 0.35) + ' ' + X(c) + ' ' + (y0 + hh) +
                ' L' + X(c) + ' ' + (ym - ch) +
                ' C' + X(c) + ' ' + (ym - ch * 0.4) + ' ' + X(xt + (c - xt) * 0.45) + ' ' + ym + ' ' + X(xt) + ' ' + ym +
                ' C' + X(xt + (c - xt) * 0.45) + ' ' + ym + ' ' + X(c) + ' ' + (ym + ch * 0.4) + ' ' + X(c) + ' ' + (ym + ch) +
                ' L' + X(c) + ' ' + (yE - hh) +
                ' C' + X(c) + ' ' + (yE - hh * 0.35) + ' ' + X(c + (xe - c) * 0.45) + ' ' + yE + ' ' + X(xe) + ' ' + yE;
          } else if (/paren/.test(kind)) {
            const xe = 0.78 * W, xc = 0.22 * W;
            d = 'M' + X(xe) + ' ' + y0 + ' C' + X(xc) + ' ' + (H * 0.30) + ' ' + X(xc) + ' ' + (H * 0.70) + ' ' + X(xe) + ' ' + yE;
          } else {                                       // bracket
            const xs = 0.30 * W, xv = 0.72 * W;          // vertical bar at xv, serifs reach back to xs
            d = 'M' + X(xs) + ' ' + y0 + ' L' + X(xv) + ' ' + y0 + ' L' + X(xv) + ' ' + yE + ' L' + X(xs) + ' ' + yE;
          }
          p.setAttribute('d', d);
          p.setAttribute('fill', 'none'); p.setAttribute('stroke', color);
          p.setAttribute('stroke-width', th.toFixed(3)); p.setAttribute('stroke-linecap', 'butt'); p.setAttribute('stroke-linejoin', 'miter');
          // katex.css has `.katex svg path { stroke: none }`, which beats presentation attributes: pin the stroke inline as well
          p.style.setProperty('stroke', color, 'important'); p.style.setProperty('fill', 'none', 'important');
          p.style.setProperty('stroke-width', th.toFixed(3) + 'px', 'important');
          svg.appendChild(p);
        } else if (svgs.length) {
          // pure-SVG delimiter (brackets, bars, floors, ceilings): keep KaTeX's own outline, but pin every piece at an explicit
          // pixel box with preserveAspectRatio="none" so nothing can be cropped, re-anchored or rescaled during capture
          svgs.forEach((s) => {
            const r = s.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) return;
            const vb = (s.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
            if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) return;
            const g = doc.createElementNS(NS, 'svg');
            g.setAttribute('x', (r.left - L).toFixed(3)); g.setAttribute('y', (r.top - Tp).toFixed(3));
            g.setAttribute('width', r.width.toFixed(3)); g.setAttribute('height', r.height.toFixed(3));
            g.setAttribute('viewBox', vb.join(' ')); g.setAttribute('preserveAspectRatio', 'none'); g.setAttribute('overflow', 'visible');
            s.querySelectorAll('path').forEach((pa) => {
              const q = doc.createElementNS(NS, 'path');
              q.setAttribute('d', pa.getAttribute('d') || ''); q.setAttribute('fill', color); q.setAttribute('stroke', 'none'); q.style.setProperty('fill', color, 'important');
              g.appendChild(q);
            });
            svg.appendChild(g);
          });
          if (!svg.firstChild) return;
        } else return;

        // ---- swap the stack for the single svg WITHOUT touching layout ----
        // KaTeX's delimiter takes only one line of layout height; the tall stack hangs out of it through negative offsets.
        // So: a zero-height inline-block (its bottom edge sits exactly on the text baseline) keeps the original width, and the
        // svg is positioned absolutely from that baseline.
        svg.style.cssText += ';position:absolute;left:' + (L - E.left).toFixed(3) + 'px;top:' + (Tp - F.bottom).toFixed(3) + 'px;';
        const holder = doc.createElement('span');
        holder.setAttribute('data-pdfbaked', '1');
        holder.style.cssText = 'display:inline-block;position:relative;box-sizing:content-box;padding:0;margin:0;border:0;' +
          'width:' + E.width.toFixed(3) + 'px;height:0;vertical-align:baseline;line-height:0;overflow:visible;';
        holder.appendChild(svg);
        el.textContent = '';
        el.setAttribute('data-pdfbaked', '1');
        el.appendChild(holder);
      } catch (_) { /* leave this delimiter as KaTeX drew it */ }
    });
  } catch (_) { /* never break the export */ }
}

// ===== KaTeX SVG (square-root sign, long arrows, braces) =====
// KaTeX draws \sqrt as an inline <svg> that is sized and coloured ONLY by katex.min.css (width:100%, fill:currentColor,
// path{stroke:none}, overflow hidden on .hide-tail). html2canvas copies the <svg> into a standalone image, so those CSS rules
// are lost and the root sign + its top bar vanish (sigma = 8 instead of sigma = sqrt(8)). Before every capture, the size,
// colour and aspect-ratio rules are written onto each <svg> as plain attributes, so the standalone copy looks identical.
function _pdfFixKatexSvg(root) {
  try {
    if (!root || !root.querySelectorAll) return;
    _pdfBakeKatexDelimiters(root);     // tall { } [ ] ( ) | delimiters -> one pinned <svg> each (see above)
    root.querySelectorAll('.katex svg').forEach((sv) => {
      try {
        if (sv.closest && sv.closest('[data-pdfbaked-svg]')) return;   // already pinned: do not re-slice / re-colour
        const win = (sv.ownerDocument && sv.ownerDocument.defaultView) || window;
        const cs = win.getComputedStyle(sv);
        const r = sv.getBoundingClientRect();
        const w = r.width || parseFloat(cs.width) || 0, h = r.height || parseFloat(cs.height) || 0;
        if (w > 0 && h > 0) {
          sv.setAttribute('width', w.toFixed(3)); sv.setAttribute('height', h.toFixed(3));
          sv.style.setProperty('width', w.toFixed(3) + 'px', 'important'); sv.style.setProperty('height', h.toFixed(3) + 'px', 'important');
        }
        const col = cs.color || '#000';
        sv.setAttribute('fill', col); sv.setAttribute('stroke', col);
        sv.style.setProperty('fill', col, 'important'); sv.style.setProperty('stroke', col, 'important');
        sv.setAttribute('fill-rule', 'nonzero'); sv.setAttribute('stroke-width', '1'); sv.setAttribute('overflow', 'hidden');
        if (!sv.getAttribute('preserveAspectRatio')) sv.setAttribute('preserveAspectRatio', 'xMinYMin slice');
        if (!sv.getAttribute('xmlns')) sv.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        sv.querySelectorAll('path').forEach((pa) => { pa.setAttribute('stroke', 'none'); pa.setAttribute('fill', col); });
      } catch (_) { /* leave this svg as is */ }
    });
  } catch (_) { /* never break the export */ }
}


// ===== FIX: INLINE EQUATIONS MUST NEVER BREAK IN THE MIDDLE =====
// KaTeX lets an inline equation wrap after every "+", "=" or "∈" (between its .base boxes). The editor hides that with its own CSS, but the
// export pages live outside the editor, so "(x1,y1)+(x2,y2)=(x1+" / "x2,y1+y2)" was split over two lines. The equation was then
// measured as ONE tall box and drawn as a garbled picture. Inside the export pages an equation is now an unbreakable unit:
// it moves to the next line as a whole, exactly like a long word.
(function _pdfInstallEquationNoWrapCSS() {
  try {
    if (typeof document === 'undefined' || document.getElementById('pdf-equation-nowrap-css')) return;
    const st = document.createElement('style');
    st.id = 'pdf-equation-nowrap-css';
    st.textContent = '.pdf-export-measure-page .katex, .pdf-export-measure-page .katex-eq, #image-pdf-render-host .katex, #image-pdf-render-host .katex-eq { white-space: nowrap !important; }';
    (document.head || document.documentElement).appendChild(st);
  } catch (_) { /* cosmetic */ }
})();

// An inline equation that is wider than the whole line cannot fit even alone: only THOSE may wrap again (as before), otherwise
// they would run past the right margin.
function _pdfFitWideInlineMath(root) {
  try {
    if (!root || !root.querySelectorAll) return 0;
    let n = 0;
    root.querySelectorAll('.katex').forEach((k) => {
      if (k.closest('.katex-display') || (k.parentElement && k.parentElement.closest('.katex'))) return;
      let blk = k.parentElement;
      while (blk && blk !== root) {
        const d = getComputedStyle(blk).display;
        if (d !== 'inline' && d !== 'inline-block' && d !== 'contents' && d !== 'inline-flex') break;
        blk = blk.parentElement;
      }
      if (!blk) return;
      const cs = getComputedStyle(blk);
      const avail = blk.getBoundingClientRect().width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      if (avail > 20 && k.getBoundingClientRect().width > avail + 1) {
        k.style.setProperty('white-space', 'normal', 'important');
        const eq = k.closest('.katex-eq'); if (eq) eq.style.setProperty('white-space', 'normal', 'important');
        n++;
      }
    });
    return n;
  } catch (_) { return 0; }
}

// KaTeX fonts (KaTeX_Size1-4 hold the big brackets/braces) are loaded lazily by the browser, only when a glyph is first used. If an export
// measures / draws a tall delimiter before its font arrived, the glyph pieces get the wrong width and a fallback shape. Load them all once.
let _pdfKatexFontsPromise = null;
function _pdfEnsureKatexFonts() {
  if (_pdfKatexFontsPromise) return _pdfKatexFontsPromise;
  _pdfKatexFontsPromise = (async () => {
    try {
      if (!document.fonts || typeof document.fonts.load !== 'function') return;
      const specs = ['KaTeX_Main', 'bold KaTeX_Main', 'italic KaTeX_Main', 'italic KaTeX_Math', 'bold italic KaTeX_Math', 'KaTeX_AMS',
        'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4', 'KaTeX_Caligraphic', 'KaTeX_Fraktur', 'KaTeX_SansSerif', 'KaTeX_Script', 'KaTeX_Typewriter'];
      await Promise.race([
        Promise.all(specs.map((sp) => document.fonts.load(sp.replace(/KaTeX_[A-Za-z0-9]+/, (m) => '16px "' + m + '"')).catch(() => null))),
        new Promise((r) => setTimeout(r, 3000))
      ]);
    } catch (_) { /* best effort */ }
  })();
  return _pdfKatexFontsPromise;
}

// ---- drawing one measured page ----
function _vecDrawPage(page, data, fx) {
  const { rgb } = window.PDFLib;
  const PW = 595.28, PH = 841.89;
  const kx = PW / PDF_LAYOUT.width, ky = PH / PDF_LAYOUT.height;
  const col = (c) => rgb(c.r, c.g, c.b);
  const rrPath = (w, h, r) => {
    const [tl, tr, br, bl] = r.map((v) => Math.min(v, w / 2, h / 2));
    return `M ${tl} 0 H ${w - tr} A ${tr} ${tr} 0 0 1 ${w} ${tr} V ${h - br} A ${br} ${br} 0 0 1 ${w - br} ${h} H ${bl} A ${bl} ${bl} 0 0 1 0 ${h - bl} V ${tl} A ${tl} ${tl} 0 0 1 ${tl} 0 Z`;
  };
  const clampBox = (b) => { const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(PDF_LAYOUT.width, b.x + b.w), y1 = Math.min(PDF_LAYOUT.height, b.y + b.h); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  const rect = (x, y, w, h, c, a) => { if (w <= 0 || h <= 0) return; page.drawRectangle({ x: x * kx, y: PH - (y + h) * ky, width: w * kx, height: h * ky, color: col(c), opacity: a, borderWidth: 0 }); };

  data.boxes.forEach((b) => {
    try {
      const hasRad = b.rad && b.rad.some((v) => v > 0);
      if (b.k === 'fill') {
        if (hasRad) page.drawSvgPath(rrPath(b.w * kx, b.h * ky, b.rad.map((v) => v * kx)), { x: b.x * kx, y: PH - b.y * ky, color: col(b.c), opacity: b.a, borderWidth: 0 });
        else { const q = clampBox(b); rect(q.x, q.y, q.w, q.h, b.c, b.a); }
        return;
      }
      const s = b.sides;
      if (hasRad) {
        const w = s[0].w, ins = w / 2;
        page.drawSvgPath(rrPath((b.w - w) * kx, (b.h - w) * ky, b.rad.map((v) => Math.max(0, v - ins) * kx)), {
          x: (b.x + ins) * kx, y: PH - (b.y + ins) * ky, borderColor: col(s[0].col), borderWidth: w * kx, borderOpacity: s[0].col.a * b.a
        });
        return;
      }
      const side = (i) => {
        const sd = s[i];
        if (!(sd.w > 0) || sd.st === 'none' || sd.st === 'hidden' || !sd.col || sd.col.a <= 0) return;
        const a = sd.col.a * b.a, w = sd.w;
        const ctr = b.collapse ? w / 2 : 0;                  // collapsed table borders sit centred on the cell edge
        let x1, y1, x2, y2, th = w;
        if (i === 0) { x1 = b.x - ctr; x2 = b.x + b.w + ctr; y1 = y2 = b.y + (b.collapse ? 0 : w / 2); }
        if (i === 2) { x1 = b.x - ctr; x2 = b.x + b.w + ctr; y1 = y2 = b.y + b.h - (b.collapse ? 0 : w / 2); }
        if (i === 1) { y1 = b.y - ctr; y2 = b.y + b.h + ctr; x1 = x2 = b.x + b.w - (b.collapse ? 0 : w / 2); }
        if (i === 3) { y1 = b.y - ctr; y2 = b.y + b.h + ctr; x1 = x2 = b.x + (b.collapse ? 0 : w / 2); }
        const dash = sd.st === 'dashed' ? [w * 3 * kx, w * 2 * kx] : sd.st === 'dotted' ? [w * kx, w * kx] : undefined;
        page.drawLine({ start: { x: x1 * kx, y: PH - y1 * ky }, end: { x: x2 * kx, y: PH - y2 * ky }, thickness: th * kx, color: col(sd.col), opacity: a, dashArray: dash, lineCap: dash && sd.st === 'dotted' ? 1 : 0 });
      };
      [0, 1, 2, 3].forEach(side);
    } catch (e) { /* one odd box must never break the export */ }
  });

  (data.sprites || []).forEach((sp) => {     // equations: above boxes, below text
    try {
      if (!sp.pdfImg) return;
      const P = _VEC_SPRITE_PAD;
      page.drawImage(sp.pdfImg, { x: (sp.x - P) * kx, y: PH - (sp.y + sp.h + P) * ky, width: (sp.w + 2 * P) * kx, height: (sp.h + 2 * P) * ky });
    } catch (e) { /* ignore */ }
  });

  data.markers.forEach((m) => {
    try {
      const fs = m.fs, c = m.color;
      if (m.kind === 'disc' || m.kind === 'circle') {
        const d = fs * 0.34, cx = m.x - fs * 0.86, cy = m.base - fs * 0.3;
        page.drawCircle({ x: cx * kx, y: PH - cy * ky, size: d / 2 * kx, color: m.kind === 'disc' ? col(c) : undefined, borderColor: col(c), borderWidth: m.kind === 'circle' ? Math.max(0.5, fs * 0.05) * kx : 0, opacity: m.a, borderOpacity: m.a });
      } else if (m.kind === 'square') {
        const d = fs * 0.3; rect(m.x - fs * 1.0, m.base - fs * 0.38, d, d, c, m.a);
      } else if (m.text) {
        const f = fx.plain; const size = fs * kx;
        const wpt = f.widthOfTextAtSize(m.text, size);
        page.drawText(m.text, { x: m.x * kx - wpt - fs * 0.28 * kx, y: PH - m.base * ky, size, font: f, color: col(c), opacity: m.a });
      }
    } catch (e) { /* ignore */ }
  });

  // marked-content helpers: /ActualText makes copy & search return the real (logical-order) Bengali text
  const marked = (begin, fn) => {
    let ops = null;
    try {
      const L = window.PDFLib;
      ops = { b: L.PDFOperator.of(begin.name, begin.args(L)), e: L.PDFOperator.of(L.PDFOperatorNames.EndMarkedContent) };
    } catch (_) { ops = null; }
    if (!ops) return fn();
    page.pushOperators(ops.b);
    try { fn(); } finally { page.pushOperators(ops.e); }
  };
  const withActual = (actual, fn) => marked({
    name: 'BDC',
    args: (L) => [L.PDFName.of('Span'), page.doc.context.obj({ ActualText: L.PDFHexString.fromText(actual) })]
  }, fn);
  const asArtifact = (fn) => marked({ name: 'BMC', args: (L) => [L.PDFName.of('Artifact')] }, fn);

  const drawWordAt = (w, wi) => {
    try {
      const f = w.font.font;
      const nx = data.words[wi + 1];
      const joined = (flag) => nx && nx[flag] && Math.abs(nx.base - w.base) < 2 && nx.x > w.x && nx.x - (w.x + w.w) < w.fs;   // same line, same decoration
      const uEnd = joined('u') ? nx.x : w.x + w.w, sEnd = joined('st') ? nx.x : w.x + w.w;
      if (w.font.bn) {   // real shaped Bengali glyph run
        const bn = fx.bn;
        if (w.clusters && w.clusters.length > 1) {   // every syllable (with its e-kar etc.) is placed at the browser-measured x
          const csz = w.fs * kx, cby = PH - w.base * ky;
          withActual((w.orig || w.t) + ' ', () => w.clusters.forEach((cl) => {
            const sh = bn.shape(cl.t);
            const nat = sh.adv / bn.upem * csz, tgt = (cl.w || 0) * kx;
            // glyph HEIGHT always stays the CSS font size; only the width is nudged (<=8%) to the browser's width
            const hs = (nat > 0 && tgt > 0 && Math.abs(tgt / nat - 1) > 0.03) ? Math.max(0.92, Math.min(1.08, tgt / nat)) : 1;
            bn.draw(page, sh, cl.x * kx, cby, csz, w.color, w.a, !!w.font.bold, hs);
          }));
          const clw = Math.max(0.4, w.fs * 0.06) * kx;
          if (w.u) page.drawLine({ start: { x: w.x * kx, y: cby - w.fs * 0.13 * kx }, end: { x: (w.x + w.w) * kx, y: cby - w.fs * 0.13 * kx }, thickness: clw, color: col(w.color), opacity: w.a });
          if (w.st) page.drawLine({ start: { x: w.x * kx, y: cby + w.fs * 0.26 * kx }, end: { x: (w.x + w.w) * kx, y: cby + w.fs * 0.26 * kx }, thickness: clw, color: col(w.color), opacity: w.a });
          return;
        }
        const sh = bn.shape(w.t);
        let bsize = w.fs * kx;
        const bnat = sh.adv / bn.upem * bsize, btgt = w.w * kx;
        // Measuring and drawing now use the SAME font (Kalpurush), so the ratio is ~1. A 1-2 glyph word (danda "।", "ও") is
        // never rescaled: shrinking it is what made the danda come out short, thin and slanted.
        let bhs = 1;   // never shrink/grow the font size (that made e-kar words look smaller than their neighbours); fit the width only
        // Bengali is drawn exactly as the font shapes it (no scaling), so vowel signs stay attached to their consonants
        const bx = w.x * kx, by = PH - w.base * ky;
        withActual((w.orig || w.t) + ' ', () => bn.draw(page, sh, bx, by, bsize, w.color, w.a, !!w.font.bold, bhs));   // no bold face: emboldened
        const blw = Math.max(0.4, w.fs * 0.06) * kx;
        if (w.u) page.drawLine({ start: { x: bx, y: by - w.fs * 0.13 * kx }, end: { x: (w.x + w.w) * kx, y: by - w.fs * 0.13 * kx }, thickness: blw, color: col(w.color), opacity: w.a });
        if (w.st) page.drawLine({ start: { x: bx, y: by + w.fs * 0.26 * kx }, end: { x: (w.x + w.w) * kx, y: by + w.fs * 0.26 * kx }, thickness: blw, color: col(w.color), opacity: w.a });
        return;
      }
      let size = w.fs * kx;
      const nat = f.widthOfTextAtSize(w.t, size), tgt = w.w * kx;
      // keep the font SIZE equal to the CSS size (so English never looks bigger than the Bengali beside it); fit width with Tz
      let ehs = 1;
      if (nat > 0 && tgt > 0 && Math.abs(tgt / nat - 1) > 0.03) ehs = Math.max(0.88, Math.min(1.12, tgt / nat));
      const x = w.x * kx, y = PH - w.base * ky, color = col(w.color);
      const L2 = window.PDFLib, tzOK = ehs !== 1 && L2.PDFOperatorNames.SetTextHorizontalScaling;
      const drawWord = () => {
        if (tzOK) page.pushOperators(L2.PDFOperator.of(L2.PDFOperatorNames.PushGraphicsState), L2.PDFOperator.of(L2.PDFOperatorNames.SetTextHorizontalScaling, [L2.asPDFNumber(ehs * 100)]));
        try { page.drawText(w.t, { x, y, size, font: f, color, opacity: w.a }); }
        finally { if (tzOK) page.pushOperators(L2.PDFOperator.of(L2.PDFOperatorNames.PopGraphicsState)); }
      };
      if (w.font.kal) withActual((w.orig || w.t) + ' ', drawWord); else drawWord();
      if (w.font.kal && w.font.bold) asArtifact(() => page.drawText(w.t, { x: x + size * 0.02, y, size, font: f, color, opacity: w.a }));   // Kalpurush has no bold face
      const lw = Math.max(0.4, w.fs * 0.06) * kx;
      if (w.u) page.drawLine({ start: { x, y: y - w.fs * 0.13 * kx }, end: { x: uEnd * kx, y: y - w.fs * 0.13 * kx }, thickness: lw, color, opacity: w.a });
      if (w.st) page.drawLine({ start: { x, y: y + w.fs * 0.26 * kx }, end: { x: sEnd * kx, y: y + w.fs * 0.26 * kx }, thickness: lw, color, opacity: w.a });
    } catch (e) {   // a glyph the font rejects must never break the export - but a word that silently vanishes must be traceable
      try { const L = (window.__pdfWordDrawErrors = window.__pdfWordDrawErrors || []); if (L.length < 40) { L.push({ word: w && (w.orig || w.t), error: String(e && e.message || e) }); if (L.length === 1) console.warn('[PDF] a word could not be drawn (see window.__pdfWordDrawErrors):', L[0]); } } catch (_) { /* diagnostic only */ }
    }
  };

  const drawGhost = (g) => {
    try {
      const gf = fx.ghost(g.t);
      let size = Math.max(4, Math.min(g.h, g.fs) * kx);
      const nat = gf.font.widthOfTextAtSize(gf.t, size);
      if (nat > 0) size *= Math.max(0.2, Math.min(4, (g.w * kx) / nat));
      withActual(g.t + ' ', () => page.drawText(gf.t, { x: g.x * kx, y: PH - g.base * ky, size, font: gf.font, color: rgb(0, 0, 0), opacity: 0 }));
    } catch (e) { /* ignore */ }
  };

  // one pass in document order, so selecting / copying / searching reads top-to-bottom like the page
  const seqItems = [];
  data.words.forEach((w, wi) => seqItems.push({ s: w.seq, w, wi }));
  (data.ghosts || []).forEach((g) => seqItems.push({ s: g.seq, g }));
  seqItems.sort((a, b) => a.s - b.s);
  seqItems.forEach((it) => { if (it.w) drawWordAt(it.w, it.wi); else drawGhost(it.g); });

  data.eqs.forEach((q) => {
    try {
      const text = fx.anyAscii(q.t); if (!text) return;
      let size = Math.max(4, Math.min(q.h, q.fs) * kx);
      const nat = fx.plain.widthOfTextAtSize(text, size);
      if (nat > 0) size *= Math.max(0.3, Math.min(1.5, (q.w * kx) / nat));
      const runEq = () => page.drawText(text, { x: q.x * kx, y: PH - (q.y + q.h * 0.75) * ky, size, font: fx.plain, color: rgb(0, 0, 0), opacity: 0 });
      if (q.txt) withActual(q.txt + ' ', runEq); else runEq();   // copy / search returns the equation's real text (e.g. "1 L = 1000 mL")
    } catch (e) { /* ignore */ }
  });
}

function _vecCanvasHasInk(canvas) {
  try {
    const t = document.createElement('canvas'); t.width = 300; t.height = Math.max(1, Math.round(300 * canvas.height / canvas.width));
    const x = t.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height);
    x.drawImage(canvas, 0, 0, t.width, t.height);
    const d = x.getImageData(0, 0, t.width, t.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 246 || d[i + 1] < 246 || d[i + 2] < 246) return true;
    return false;
  } catch (_) { return true; }
}
function _vecCanvasToJpeg(canvas, q) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((x) => resolve(new Uint8Array(x))) : reject(new Error('Canvas export failed'))), 'image/jpeg', q));
}


// Renders all unique equations of the document in as few html2canvas passes as possible (usually ONE).
// Returns the Set of keys that could not be reproduced exactly (those pages are redone the classic way).
async function _vecRenderSprites(list, scale) {
  const bad = new Set();
  try {
    const libs = await ensurePDFRenderLibraries(); _assertPDFRenderLibraries(libs, true);
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (_) {} }
    const P = _VEC_SPRITE_PAD, MAXH = 4200;
    let i = 0;
    while (i < list.length) {
      const sheet = document.createElement('div');
      sheet.style.cssText = 'position:fixed;left:-30000px;top:0;z-index:-1;pointer-events:none;background:transparent;margin:0;padding:0;overflow:visible';
      if (document.body.classList.contains('photocopy-mode')) sheet.classList.add('photocopy-mode');
      document.body.appendChild(sheet);
      const group = []; let h = 0;
      while (i < list.length && (h < MAXH || !group.length)) {
        const u = list[i++];
        const slot = document.createElement('div');
        slot.style.cssText = `display:block;box-sizing:content-box;padding:${P}px;margin:0 0 6px 0;font-size:${u.fs};color:${u.color};white-space:nowrap;` + (u.disp ? `width:${u.w}px;` : 'width:fit-content;');
        slot.appendChild(u.node);
        sheet.appendChild(slot);
        group.push({ u, slot });
        h += u.h + 2 * P + 6;
      }
      try {
        if (typeof nextFrame === 'function') await nextFrame();
        const sr = sheet.getBoundingClientRect();
        const rects = group.map(({ u }) => u.node.getBoundingClientRect());
        group.forEach(({ u }, k) => {                       // verify the stand-alone render matches the in-page size
          const tol = Math.max(2, u.w * 0.04);
          if (Math.abs(rects[k].width - u.w) > tol || Math.abs(rects[k].height - u.h) > Math.max(2, u.h * 0.06)) bad.add(u.key);
        });
        _pdfFixKatexSvg(sheet);
        const sw = Math.ceil(sheet.scrollWidth), sh = Math.ceil(sheet.scrollHeight);
        const canvas = await window.html2canvas(sheet, {
          scale, backgroundColor: null, useCORS: true, allowTaint: false, logging: false, removeContainer: true,
          width: sw, height: sh, windowWidth: sw, windowHeight: sh, scrollX: 0, scrollY: 0, imageTimeout: 4000,
          ignoreElements: (node) => {
            try {
              if (node === sheet || sheet.contains(node) || node.contains(sheet)) return false;
              const tag = node.tagName;
              if (tag === 'STYLE' || tag === 'LINK' || tag === 'SCRIPT' || tag === 'META') return false;
              return !!(node.closest && node.closest('body'));
            } catch (_) { return false; }
          }
        });
        await Promise.all(group.map(({ u }, k) => new Promise((resolve) => {
          if (bad.has(u.key)) return resolve();
          const r = rects[k];
          const sx = Math.max(0, Math.floor((r.left - sr.left - P) * scale)), sy = Math.max(0, Math.floor((r.top - sr.top - P) * scale));
          const cw = Math.min(canvas.width - sx, Math.ceil((r.width + 2 * P) * scale)), ch = Math.min(canvas.height - sy, Math.ceil((r.height + 2 * P) * scale));
          if (cw < 2 || ch < 2) { bad.add(u.key); return resolve(); }
          const c = document.createElement('canvas'); c.width = cw; c.height = ch;
          c.getContext('2d').drawImage(canvas, sx, sy, cw, ch, 0, 0, cw, ch);
          c.toBlob((b) => {
            if (!b) { bad.add(u.key); c.width = 0; return resolve(); }
            b.arrayBuffer().then((buf) => { u.png = new Uint8Array(buf); }).catch(() => bad.add(u.key)).finally(() => { c.width = 0; resolve(); });
          }, 'image/png');
        })));
        canvas.width = 0; canvas.height = 0;
      } catch (e) {
        console.warn('Equation sheet failed; those pages use the classic raster path:', e);
        group.forEach(({ u }) => bad.add(u.key));
      } finally {
        sheet.remove();
      }
    }
  } catch (e) {
    console.warn('Equation sprites unavailable:', e);
    list.forEach((u) => bad.add(u.key));
  }
  return bad;
}

async function _exportTruePDFVectorInBrowser(btn) {
  const toast = (m) => { if (typeof displayToastNotification === 'function') displayToastNotification(m); };
  if (_truePdfRunning) return;
  _truePdfRunning = true;
  _setExportButtonBusy(btn, true, 'PDF');
  let renderPages = null, renderHost = null, fallback = false;
  const docName = getDocumentTopicName() || 'Document';   // read BEFORE anything re-renders the editor
  const prog = _pdfProgressStart('Preparing PDF', btn);
  try {
    prog.set(2, 'Loading PDF engine');
    await Promise.all([_vecEnsureLibs(), ensurePDFRenderLibraries(), _vecLoadKalpurushBytes()]);
    await _pdfEnsureDocFonts();        // Times New Roman + Kalpurush must be active BEFORE pages are laid out and measured
    await _pdfEnsureKatexFonts();      // KaTeX_Size1-4 (tall brackets/braces) too
    _pdfWarnIfNoKalpurush();
    prog.set(8, 'Preparing document');
    await runPreExportLocalQualityPass();
    prog.set(14, 'Laying out pages');

    renderPages = await _buildImagePDFRenderPages();
    prog.set(26, 'Preparing pages');
    const pageList = renderPages.pages || [];     // FIX: declared BEFORE use (was a temporal-dead-zone ReferenceError that aborted the vector export)
    if (!pageList.length) throw new Error('No renderable pages were produced.');
    const covSource = _pdfCoverageSource();
    const lostInPages = _pdfCoverageCheck(covSource, pageList.map((pg) => (pg.el ? pg.el.textContent : '')).join(''), 'already missing from the paginated pages');
    try { _pdfStructureCheck(pageList); } catch (_) { /* diagnostic only */ }

    renderHost = document.createElement('div');
    renderHost.id = 'image-pdf-render-host';
    renderHost.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_LAYOUT.width}px;height:${PDF_LAYOUT.height}px;overflow:hidden;visibility:visible;opacity:1;pointer-events:none;z-index:9998;background:#fff`;
    if (document.body.classList.contains('photocopy-mode')) renderHost.classList.add('photocopy-mode');
    document.body.appendChild(renderHost);

    const { PDFDocument } = window.PDFLib;
    const pdfDoc = await PDFDocument.create();
    const name = docName;
    try { pdfDoc.setTitle(name.replace(/_/g, ' ')); pdfDoc.setProducer('True PDF (vector)'); } catch (_) { /* optional */ }
    const fx = await _vecMakeFonts(pdfDoc);

    const mobile = typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout();
    // 2x = ~190 dpi for the equation/image layer; text is vector anyway. Long documents get a lighter raster layer:
    // fewer pixels per page = much faster, and far less memory (huge canvases are what made long exports come out blank).
    const nPages = pageList.length;
    const scale = mobile ? (nPages > 25 ? 1.1 : 1.5) : (nPages > 60 ? 1.25 : nPages > 30 ? 1.5 : 2);
    const cancelledAtStart = typeof isCancellationRequested !== 'undefined' && !!isCancellationRequested;   // a stale "stop" flag must not truncate the export
    const PW = 595.28, PH = 841.89;
    let rasterPages = 0, keptWords = 0, rasterFailedPages = 0;
    const timing = {}, tStart = performance.now();
    const items = [];
    const spriteScale = mobile ? 2 : 3;                       // equations are rendered sharper than before (was 2x)
    const renderPage = (i, noSprites) => _renderImagePDFPage(pageList[i].el, renderHost, i + 1, scale, { measure: (el) => _vecMeasurePage(el, fx, { noSprites }), timing });
    const startJpeg = (res) => {                              // encoding runs off the main thread while the next page is prepared
      if (!res.canvas) return null;
      const cv = res.canvas;
      if (!_vecCanvasHasInk(cv)) { cv.width = 0; cv.height = 0; return null; }
      return _vecCanvasToJpeg(cv, (res.data && res.data.kept) ? 0.92 : 0.86)
        .then((bts) => { cv.width = 0; cv.height = 0; return bts; })
        .catch(() => { res.imgFail = true; try { cv.width = 0; cv.height = 0; } catch (_) {} return null; });   // never reject: the page is rescued below
    };
    for (let i = 0; i < pageList.length; i++) {
      if (!cancelledAtStart && typeof isCancellationRequested !== 'undefined' && isCancellationRequested) { toast(`Stopped at page ${i} – partial PDF saved.`); break; }
      if (i > 0 && i % 3 === 0) await _yieldToBrowser();      // keep the tab responsive (and rAF alive) on long documents
      prog.set(26 + 54 * (i / pageList.length), `Preparing page ${i + 1} of ${pageList.length}`);
      if (!pageList[i].el) throw new Error(`Page ${i + 1} has no renderable DOM.`);
      const res = await renderPage(i, false);
      const page = pdfDoc.addPage([PW, PH]);                  // created now so the page order is fixed
      if (res.rasterFailed) rasterFailedPages++;
      items.push({ i, page, res, jpgJob: startJpeg(res) });
      prog.set(26 + 54 * ((i + 1) / pageList.length));
      renderHost.innerHTML = '';
    }

    // all equations of the document, rendered together
    const uniq = new Map();
    items.forEach((it) => (it.res.data.sprites || []).forEach((sp) => {
      sp.key = sp.node.outerHTML + '|' + Math.round(sp.w) + 'x' + Math.round(sp.h) + '|' + sp.color + '|' + sp.fs;
      if (!uniq.has(sp.key)) uniq.set(sp.key, sp);
    }));
    let badKeys = new Set();
    if (uniq.size) {
      prog.set(82, 'Preparing equations');
      const t0 = performance.now();
      badKeys = await _vecRenderSprites(Array.from(uniq.values()), spriteScale);
      timing.sprites = performance.now() - t0; timing.equationCount = uniq.size; timing.equationRetryCount = badKeys.size;
    }
    // a page with an equation that could not be reproduced exactly is redone the classic (full-page raster) way
    for (const it of items) {
      const ds = it.res.data.sprites || [];
      if (ds.length && ds.some((sp) => badKeys.has(sp.key) || !uniq.get(sp.key).png)) {
        prog.set(88, `Preparing page ${it.i + 1} of ${pageList.length}`);
        const res = await renderPage(it.i, true);
        renderHost.innerHTML = '';
        it.res = res; it.jpgJob = startJpeg(res);
        timing.fallbackPages = (timing.fallbackPages || 0) + 1;
      }
    }

    // ---- blank-page guard ----
    // A page can come out empty when its raster layer failed (canvas too large / out of memory / tab throttled) or when
    // nothing could be measured. Such a page is rendered again as one plain full-page picture (text becomes pixels, but
    // the page is never blank). The export is never allowed to silently deliver an empty page.
    if (!items.length) throw new Error('No pages were rendered.');
    let rescuedPages = 0;
    for (const it of items) {
      it.jpgBytes = it.jpgJob ? await it.jpgJob : null;
      const d = it.res.data || {};
      const srcEl = pageList[it.i].el;
      const hasSrc = !!srcEl && (((srcEl.textContent || '').replace(/\s+/g, '').length > 1) || !!srcEl.querySelector('img, svg, canvas, table'));
      const drawn = (d.words && d.words.length) || (d.ghosts && d.ghosts.length) || (d.markers && d.markers.length) || (d.sprites && d.sprites.length) || (d.boxes && d.boxes.length);
      const broken = (!drawn && !it.jpgBytes) || it.res.rasterFailed || it.res.imgFail;
      if (!hasSrc || !broken) continue;
      prog.set(88, `Repairing page ${it.i + 1} of ${pageList.length}`);
      try {
        const cv = await _renderImagePDFPage(srcEl, renderHost, it.i + 1, Math.min(scale, 1.4));
        const bts = await _vecCanvasToJpeg(cv, 0.86);
        cv.width = 0; cv.height = 0;
        it.rescued = bts; rescuedPages++;
      } catch (e) { console.warn('Page ' + (it.i + 1) + ' could not be repaired:', e); }
      renderHost.innerHTML = '';
    }
    if (rescuedPages) timing.rescuedPages = rescuedPages;

    prog.set(90, 'Assembling pages');
    const drawnText = items.map((it) => { const d = it.res.data; return [].concat(d.words.map((w) => w.orig || w.t), (d.ghosts || []).map((g) => g.t), d.markers.map((m) => m.text || '')).join(' '); }).join(' ');
    const lostInPdf = _pdfCoverageCheck(covSource, drawnText, 'not written to the PDF text layer');
    const pngCache = new Map();
    for (const it of items) {
      const { page, res } = it, d = res.data;
      if (it.rescued) {                       // repaired page: one full-page picture already contains everything
        const img = await pdfDoc.embedJpg(it.rescued);
        page.drawImage(img, { x: 0, y: 0, width: PW, height: PH });
        rasterPages++;
        try {
          const label = (it.i + 1) + '/' + pageList.length;
          const size = 9, w = fx.plain.widthOfTextAtSize(label, size);
          page.drawText(label, { x: (PW - w) / 2, y: 22, size, font: fx.plain, color: window.PDFLib.rgb(0.32, 0.36, 0.42) });
        } catch (_) { /* never block the export */ }
        (d.sprites || []).forEach((sp) => { sp.node = null; });
        continue;
      }
      if (it.jpgBytes) {
        const img = await pdfDoc.embedJpg(it.jpgBytes);
        page.drawImage(img, { x: 0, y: 0, width: PW, height: PH });
        rasterPages++;
        it.jpgBytes = null;
      }
      for (const sp of (d.sprites || [])) {
        const u = uniq.get(sp.key);
        if (!u || !u.png) continue;
        let im = pngCache.get(sp.key);
        if (!im) { im = await pdfDoc.embedPng(u.png); pngCache.set(sp.key, im); }
        sp.pdfImg = im;
      }
      _vecDrawPage(page, d, fx);
      try {   // page number "n/total", always English digits, bottom centre
        const label = (it.i + 1) + '/' + pageList.length;
        const size = 9, w = fx.plain.widthOfTextAtSize(label, size);
        page.drawText(label, { x: (PW - w) / 2, y: 22, size, font: fx.plain, color: window.PDFLib.rgb(0.32, 0.36, 0.42) });
      } catch (_) { /* never block the export */ }
      keptWords += d.kept || 0;
      (d.sprites || []).forEach((sp) => { sp.node = null; });
    }
    try { console.info('[PDF timing] total ' + Math.round(performance.now() - tStart) + ' ms for ' + pageList.length + ' pages', Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, /(Pages|Count)$/.test(k) ? v : Math.round(v) + ' ms']))); } catch (_) {}

    if (fx_missing.size) console.warn('[PDF] These characters are not in the Bengali font, so their words stay as raster images (shaping/spacing can look wrong). Replace them in the text:', Array.from(fx_missing).join(' '));
    prog.set(95, 'Saving file');
    try { await fx.finishBn(); } catch (e) { console.warn('Bengali font finalisation failed:', e); }
    const bytes = await pdfDoc.save();
    prog.set(98, 'Downloading');
    _downloadBlobToDefaultFolder(new Blob([bytes], { type: 'application/pdf' }), name + '.pdf');
    prog.finish();
    if (lostInPages || lostInPdf) toast(`⚠️ ${Math.max(lostInPages, lostInPdf)} text block(s) are missing from the PDF — open the browser console (F12) for the list.`);
    if (rasterFailedPages) toast(`⚠️ ${rasterFailedPages} page(s): images/equations could not be drawn, text is intact.`);
    toast(keptWords
      ? `✅ PDF downloaded — selectable text. ${keptWords} word(s) with unsupported glyphs stay as sharp-at-100% images.`
      : '✅ PDF downloaded — selectable text, sharp at any zoom.');
  } catch (error) {
    console.error('True PDF (vector) failed:', error);
    toast('⚠️ ' + (error && error.message ? error.message : 'Vector PDF failed') + ' Using the emergency fallback (no text layer).');
    fallback = true;
    prog.close();
  } finally {
    if (renderHost && renderHost.parentNode) renderHost.parentNode.removeChild(renderHost);
    if (renderPages && typeof renderPages.dispose === 'function') renderPages.dispose();
    _truePdfRunning = false;
    _setExportButtonBusy(btn, false);
  }
  if (fallback) return _exportTruePDFViaPrintDialog(btn);
}

// ===== TRUE PDF FALLBACK (NO print dialog) =====
// The native print dialog (window.print()) is intentionally never used: it can
// not save in one click. If the vector/server export fails, fall back to the
// Image PDF exporter, which saves straight to the browser's download folder.
async function _exportTruePDFViaPrintDialog(btn) {
  return exportToImagePDF(btn);
}


// ===== IMAGE PDF (RASTERIZED) =====
async function exportToImagePDF(btn) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  if (typeof ensureAllPagesMathRendered === 'function') ensureAllPagesMathRendered();
  const editorPagesBefore = _collectRenderableEditorPages();
  if (!editorPagesBefore.length || (typeof docContainer !== 'undefined' && docContainer && docContainer.innerText && docContainer.innerText.includes('Start typing here'))) {
    if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ Document is empty.');
    return;
  }

  const analyticsStart = Date.now();
  const modelsUsed = new Set();
  let renderPages = null;
  let renderHost = null;

  const staleHost = document.getElementById('image-pdf-render-host');
  if (staleHost && staleHost.parentNode) staleHost.parentNode.removeChild(staleHost);

  _setExportButtonBusy(btn, true, 'PDF');
  const prog = _pdfProgressStart('Preparing PDF', btn);

  try {
    prog.set(3);
    const libs = await ensurePDFRenderLibraries();
    _assertPDFRenderLibraries(libs, true);
    await _pdfEnsureDocFonts();
    await _pdfEnsureKatexFonts();
    await runPreExportLocalQualityPass();
    prog.set(12, 'Laying out pages');

    renderPages = typeof _buildImagePDFRenderPages === 'function' ? await _buildImagePDFRenderPages() : { pages: [] };
    const pageList = renderPages.pages || [];
    if (!pageList.length) throw new Error('No renderable pages were produced.');

    renderHost = document.createElement('div');
    renderHost.id = 'image-pdf-render-host';
    renderHost.style.cssText = [
      'position:fixed',
      'left:-10000px',
      'top:0',
      `width:${PDF_LAYOUT.width}px`,
      `height:${PDF_LAYOUT.height}px`,
      'overflow:hidden',
      'visibility:visible',
      'opacity:1',
      'pointer-events:none',
      'z-index:9998',
      'background:#fff'
    ].join(';');
    if (document.body.classList.contains('photocopy-mode')) renderHost.classList.add('photocopy-mode');
    document.body.appendChild(renderHost);

    const pdf = new window.jspdf.jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true
    });

    let exportedPages = 0;
    for (let i = 0; i < pageList.length; i++) {
      if (isCancellationRequested) {
        if (typeof displayToastNotification === 'function') displayToastNotification(`Stopped at page ${i} – partial PDF saved.`);
        break;
      }

      prog.set(15 + 78 * (i / pageList.length), `Preparing page ${i + 1} of ${pageList.length}`);
      const sourcePage = pageList[i].el;
      if (!sourcePage) throw new Error(`Page ${i + 1} has no renderable DOM.`);

      const canvas = await _renderImagePDFPage(sourcePage, renderHost, i + 1, _getPDFRenderScale());
      if (i > 0) pdf.addPage('a4', 'portrait');
      const imageData = canvas.toDataURL('image/jpeg', typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout() ? 0.84 : 0.90);
      pdf.addImage(imageData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      try {   // page number "n/total", always English digits, bottom centre
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(82, 92, 107);
        pdf.text((i + 1) + '/' + pageList.length, 105, 289, { align: 'center' });
      } catch (_) { /* never block the export */ }
      exportedPages++;

      canvas.width = 0;
      canvas.height = 0;
      renderHost.innerHTML = '';

      if (i < pageList.length - 1 && i % 2 === 1) await _yieldToBrowser();
    }

    if (!exportedPages) throw new Error('No pages were exported.');
    prog.set(97, 'Saving file');
    pdf.save(getDocumentTopicName() + '.pdf');
    prog.finish();
    if (typeof displayToastNotification === 'function') {
      displayToastNotification(`✅ Saved Image PDF — raster pages, no text layer — ${exportedPages} page${exportedPages === 1 ? '' : 's'}.`);
    }

    try {
      const analytics = typeof computeDocumentAnalytics === 'function' ? await computeDocumentAnalytics(analyticsStart, modelsUsed) : null;
      if (analytics && typeof appendChatMessageToUI === 'function') {
        appendChatMessageToUI('ai', typeof formatAnalyticsChatMessage === 'function' ? formatAnalyticsChatMessage(analytics) : '');
      }
    } catch (analyticsErr) {
      console.warn('Analytics failed:', analyticsErr);
    }
  } catch (error) {
    console.error('Image PDF export failed:', error);
    prog.close();
    if (typeof displayToastNotification === 'function') {
      displayToastNotification('Error Image PDF Error: ' + error.message);
    }
  } finally {
    if (renderHost && renderHost.parentNode) renderHost.parentNode.removeChild(renderHost);
    if (renderPages && typeof renderPages.dispose === 'function') renderPages.dispose();
    _setExportButtonBusy(btn, false);
  }
}

// ===== CANVAS VISIBILITY CHECK =====
function _canvasHasVisibleInk(canvas) {
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
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const lum = (r * 0.299) + (g * 0.587) + (b * 0.114);
      if (lum < 248) nonWhite++;
      if (lum < 220) strong++;
    }
    const pixels = Math.max(1, (data.length / 4));
    return (nonWhite / pixels) > 0.0015 || (strong / pixels) > 0.0005;
  } catch (_) {
    return true;
  }
}

// ===== RENDER IMAGE PDF PAGE =====
async function _renderImagePDFPage(sourcePage, host, pageNumber, requestedScale, vec) {
  let vecData = null;
  const libs = await ensurePDFRenderLibraries();
  _assertPDFRenderLibraries(libs, true);
  const prepare = (el) => {
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('display', 'block', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('filter', 'none', 'important');
    el.style.setProperty('transform', 'none', 'important');
    el.style.setProperty('contain', 'none', 'important');
    el.style.setProperty('content-visibility', 'visible', 'important');
    el.style.setProperty('width', PDF_LAYOUT.width + 'px', 'important');
    el.style.setProperty('height', PDF_LAYOUT.height + 'px', 'important');
    el.style.setProperty('max-height', PDF_LAYOUT.height + 'px', 'important');
    el.style.setProperty('padding', `${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px`, 'important');
    el.style.setProperty('box-sizing', 'border-box', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('position', 'relative', 'important');
    if (/(?:^|\s)pdf-format-/.test(el.className)) el.style.removeProperty('background');   // themed page: the theme paints it
    else el.style.setProperty('background', '#fff', 'important');
    // The live page element (.doc-page-canvas) carries a subtle on-screen
    // border/rounded corner as a UI affordance — html2canvas is well known
    // for mis-rendering a low-alpha rgba() border combined with
    // border-radius + overflow:hidden clipping at a >1x capture scale: the
    // anti-aliased edge pixels composite wrong and the faint border comes
    // out as a harsh, near-black line (most visible along the tall
    // left/right edges). The editor itself shows no such border to the
    // eye, so the exported page shouldn't either — strip both so the
    // rasterized image matches what's actually on screen.
    el.style.setProperty('border', 'none', 'important');
    el.style.setProperty('border-radius', '0', 'important');
  };

  const capture = async (el, scale) => {
    prepare(el);
    host.innerHTML = '';
    host.appendChild(el);
    _pdfFixForeignBengaliSigns(el);
    _pdfKeepInlineEquationsInline(el);                                // (H⁺) inside a sentence must not get a line of its own                                   // Devanagari ি/ে/ো inside Bengali words -> Bengali signs, BEFORE layout is measured
    const T = vec && vec.timing, now = () => performance.now();
    let t0 = now();
    if (typeof waitForPDFLayoutStable === 'function') await waitForPDFLayoutStable(el);
    if (typeof prepareEquationsForPDF === 'function') prepareEquationsForPDF(el);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(el);
    _pdfNativizeSimpleMath(el);                                       // plain equations (1 L = 1000 mL ...) become real text
    _pdfFixBengaliInMath(el);                                         // Bengali inside equations: one text node per word (matra stay attached)
    if (typeof nextFrame === 'function') await nextFrame();            // one frame is enough for the layout to settle
    _pdfFitWideInlineMath(el);                                        // FIX: only equations wider than a whole line may wrap
    _pdfFixKatexSvg(el);                                              // FIX: tall ( ) [ ] { } are redrawn as ONE svg in the LIVE, laid-out page (before they were only
                                                                      //      redone inside html2canvas' hidden clone, where layout/fonts are not ready -> short, broken brackets)
    if (T) { T.settle = (T.settle || 0) + now() - t0; t0 = now(); }
    if (vec) {                                   // vector mode: measure text/boxes, skip the raster pass if nothing needs it
      vecData = vec.measure(el);
      if (T) { T.measure = (T.measure || 0) + now() - t0; t0 = now(); }
      if (!vecData.needsRaster) { if (T) T.vectorOnlyPages = (T.vectorOnlyPages || 0) + 1; return null; }
      try { console.info('[PDF] page ' + pageNumber + ' needs a picture layer because: ' + (vecData.reasons.join(', ') || '?') + (vecData.sharp ? '  (sharp)' : '  (flat colours only)')); } catch (_) {}
    }
    let canvas;
    try {
    // pages whose text stays in the raster layer (Bengali) are captured sharper so they stay crisp when zoomed
    const mobileLayout = typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout();
    // every page that still needs a raster layer (equations, charts, images, kept words) is captured sharp: Bengali inside equations/charts lives
    // in this layer, and at 1.5x it looked small and blurred (vowel signs smeared away from the letter)
    // SPEED: a 3x full-page capture is only needed when the picture layer holds equations / images / words. When it only holds flat
    // boxes, borders, shadows or a tinted background, 1.5x looks identical and is ~4x fewer pixels (the biggest cost of a long export).
    const rasterScale = (vec && vecData)
      ? (vecData.sharp ? Math.max(scale, mobileLayout ? 2.4 : 3) : Math.min(scale, mobileLayout ? 1.4 : 1.6))
      : scale;
    canvas = await window.html2canvas(el, {
      scale: rasterScale,
      imageTimeout: 4000,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#fff',
      width: PDF_LAYOUT.width,
      height: PDF_LAYOUT.height,
      windowWidth: PDF_LAYOUT.width,
      windowHeight: PDF_LAYOUT.height,
      scrollX: 0,
      scrollY: 0,
      logging: false,
      removeContainer: true,
      // html2canvas clones the WHOLE document for every capture. Skipping everything that is not this page
      // (editor, chat, toolbars, the other pages) makes each page render several times faster.
      ignoreElements: (node) => {
        try {
          if (node === el || el.contains(node) || node.contains(el)) return false;
          const tag = node.tagName;
          if (tag === 'STYLE' || tag === 'LINK' || tag === 'SCRIPT' || tag === 'META') return false;
          return !!(node.closest && node.closest('body'));
        } catch (_) { return false; }
      },
      onclone: (clonedDoc) => {
        const clonedEl = clonedDoc.querySelector('.doc-page-canvas');
        if (vec && clonedEl) {                   // raster layer = everything EXCEPT the text/boxes drawn as vectors
          clonedEl.classList.add('pdf-vtext');
          const st = clonedDoc.createElement('style');
          st.textContent = VEC_HIDE_CSS;
          clonedDoc.head.appendChild(st);
          _vecHideVectorLayerInClone(clonedEl);
        }
        if (clonedEl) {
          clonedEl.querySelectorAll('.katex-mathml').forEach((e) => e.style.setProperty('display', 'none', 'important'));
          _pdfFixKatexSvg(clonedEl);
          clonedEl.style.visibility = 'visible';
          clonedEl.style.opacity = '1';
          clonedEl.style.display = 'block';
          clonedEl.style.filter = 'none';
          clonedEl.style.transform = 'none';
          clonedEl.style.contain = 'none';
          if (document.body.classList.contains('photocopy-mode')) {
            clonedEl.classList.add('photocopy-mode');
            if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(clonedEl);
            if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(clonedEl);
          }
        }
      }
    });
      if (T) { T.raster = (T.raster || 0) + now() - t0; T.rasterPages = (T.rasterPages || 0) + 1; }
    } catch (rasterErr) {
      if (!vec) throw rasterErr;               // vector mode: keep the real text, only the image/equation layer is lost
      console.warn('Raster layer failed for page ' + pageNumber + '; keeping vector text only:', rasterErr);
      vec.rasterFailed = true;
      return null;
    }
    return canvas;
  };

  const cloneForCapture = () => {
    const clone = sourcePage.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    clone.className = 'doc-page-canvas pdf-export-measure-page';
    const themeCls = _pdfActiveFormatClass();
    if (themeCls) clone.classList.add(themeCls);                        // keep the selected theme in the exported page
    if (document.body.classList.contains('photocopy-mode')) {
      clone.classList.add('photocopy-mode');
      if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(clone);
      if (typeof autoFitDiagramTextToNodes === 'function') autoFitDiagramTextToNodes(clone);
    }
    const srcCanvases = Array.from(sourcePage.querySelectorAll('canvas'));
    const dstCanvases = Array.from(clone.querySelectorAll('canvas'));
    srcCanvases.forEach((src, idx) => {
      const dst = dstCanvases[idx];
      if (!dst) return;
      try {
        dst.width = src.width;
        dst.height = src.height;
        const ctx = dst.getContext('2d');
        if (ctx) ctx.drawImage(src, 0, 0);
      } catch (_) {}
    });
    return clone;
  };

  const targetScale = Number.isFinite(requestedScale) ? requestedScale : _getPDFRenderScale();
  let working = cloneForCapture();
  let canvas = await capture(working, targetScale);
  if (vec) return { canvas, data: vecData, rasterFailed: !!vec.rasterFailed };   // vector mode: a blank / absent raster layer is normal

  if (!_canvasHasVisibleInk(canvas)) {
    canvas.width = 0;
    canvas.height = 0;
    working = cloneForCapture();
    working.style.setProperty('overflow', 'visible', 'important');
    canvas = await capture(working, Math.max(1.15, targetScale * 0.82));
  }

  if (!_canvasHasVisibleInk(canvas)) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error(`Image PDF page ${pageNumber} rendered blank. Export was stopped to prevent a blank PDF.`);
  }
  return canvas;
}

// ===== BUILD IMAGE PDF RENDER PAGES =====
async function _buildImagePDFRenderPages() {
  const result = typeof computeTruePDFPages === 'function' ? await computeTruePDFPages() : { pages: [], offscreen: null };
  if (typeof applyLocalMarginSafetyFixes === 'function') applyLocalMarginSafetyFixes(result);

  const computedPages = result.pages ? result.pages.filter(p => p.html && p.html.trim()) : [];
  const editorPages = _collectRenderableEditorPages();

  if (editorPages.length > 1 && computedPages.length < editorPages.length) {
    const fallbackPages = editorPages.map(el => ({
      el: el.cloneNode(true),
      html: el.innerHTML,
      overflow: false,
      brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(el) : [],
      brokenDiagrams: typeof findBrokenDiagrams === 'function' ? findBrokenDiagrams(el) : []
    }));
    if (typeof disposeTruePDFPages === 'function') disposeTruePDFPages(result);
    return { pages: fallbackPages };
  }

  return {
    pages: computedPages.map(p => ({
      el: p.el,
      html: p.html,
      overflow: p.overflow,
      brokenEquations: p.brokenEquations,
      brokenDiagrams: p.brokenDiagrams
    })),
    dispose: () => { if (typeof disposeTruePDFPages === 'function') disposeTruePDFPages(result); }
  };
}

// ===== LIVE PDF IFRAME PREVIEW (Enhanced UX + Scroll Fix) =====
let _pdfPreviewGenerationToken = 0;
let _pdfPreviewDebounceTimer = null;
let _pdfPreviewRunning = false;
let _pdfPreviewPending = false;
let _pdfLayoutCache = { signature: '', chunks: null };
let _pdfMathPreparedSignature = '';
let _pdfDocumentRevision = 0;
let _pdfLastRenderedSignature = '';
let _pdfLastRenderedMode = '';
let _pdfPreviewRetryCount = 0;
const MAX_PREVIEW_RETRIES = 3;

function invalidatePDFPreviewCache() {
  _pdfDocumentRevision++;
  _pdfLayoutCache.signature = '';
  _pdfLayoutCache.chunks = null;
  _pdfMathPreparedSignature = '';
  _pdfLastRenderedSignature = '';
  _pdfLastRenderedMode = '';
  _pdfPreviewRetryCount = 0;
}

function hashPDFPreviewSignature() {
  let hash = 2166136261;
  const container = document.getElementById('document-view-container');
  const pages = container ? container.querySelectorAll('.doc-page-canvas') : [];
  for (let i = 0; i < pages.length; i++) {
    const html = pages[i].innerHTML || '';
    hash ^= html.length;
    hash = Math.imul(hash, 16777619);
    for (let j = 0; j < html.length; j += 193) {
      hash ^= html.charCodeAt(j);
      hash = Math.imul(hash, 16777619);
    }
  }
  // Include dark mode and monochrome state in the signature so theme changes trigger refresh
  const isDark = document.body.classList.contains('dark');
  const isMonochrome = document.body.classList.contains('photocopy-mode');
  return `${_pdfDocumentRevision}:${pages.length}:${(hash >>> 0).toString(16)}:dark${isDark ? '1' : '0'}:mono${isMonochrome ? '1' : '0'}:pc${typeof getPaginateCompactLevel === 'function' ? getPaginateCompactLevel() : 0}`;
}

function prepareDocumentForPDFPreview(signature) {
  if (_pdfMathPreparedSignature === signature && typeof findBrokenEquations === 'function' && !findBrokenEquations(document.getElementById('document-view-container')).length) return;
  const container = document.getElementById('document-view-container');
  if (!container) return;
  if (typeof normalizeAIHTMLTextArtifacts === 'function') normalizeAIHTMLTextArtifacts(container);
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(container);
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof prepareEquationsForPDF === 'function') prepareEquationsForPDF(container);
  _pdfMathPreparedSignature = signature;
}

function generateLivePDFIframePreview() {
  if (_pdfPreviewDebounceTimer) clearTimeout(_pdfPreviewDebounceTimer);
  const isMobile = typeof isMobilePreviewMode === 'function' && isMobilePreviewMode();
  const delay = isMobile ? 120 : 40; // Increased debounce for mobile to reduce re-renders
  const scheduledToken = ++_pdfPreviewGenerationToken;
  _pdfPreviewPending = true;
  _pdfPreviewDebounceTimer = setTimeout(() => {
    _pdfPreviewDebounceTimer = null;
    _pdfPreviewPending = false;
    _runLivePDFIframePreview(scheduledToken);
  }, delay);
}

function _buildSimplePDFPageChunksFallback() {
  try {
    return _collectRenderableEditorPages().map(_serializePageForPDF).filter(html => html && html.trim());
  } catch (_) {
    return [];
  }
}

let _pdfPreviewObjectURL = null;

function _revokePDFPreviewObjectURL() {
  if (_pdfPreviewObjectURL) {
    try { URL.revokeObjectURL(_pdfPreviewObjectURL); } catch (_) {}
    _pdfPreviewObjectURL = null;
  }
}

function _setPDFPreviewFrameHTML(iframe, html) {
  try {
    _revokePDFPreviewObjectURL();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    _pdfPreviewObjectURL = URL.createObjectURL(blob);
    iframe.src = _pdfPreviewObjectURL;
    return true;
  } catch (err) {
    console.warn('Blob PDF preview failed; falling back to srcdoc.', err);
    try {
      iframe.srcdoc = html;
      return true;
    } catch (_) {
      return false;
    }
  }
}

async function _runLivePDFIframePreview(requestedToken) {
  const myToken = requestedToken || ++_pdfPreviewGenerationToken;
  if (myToken !== _pdfPreviewGenerationToken) return;
  const iframe = document.getElementById('pdf-iframe');
  const loadingEl = document.getElementById('pdf-preview-loading');
  const loadingStatusEl = document.getElementById('pdf-preview-loading-status');
  const pdfViewContainer = document.getElementById('pdf-view-container');
  if (pdfViewContainer) {
    pdfViewContainer.style.overflowY = 'auto';
    pdfViewContainer.style.overflowX = 'hidden';
    pdfViewContainer.style.webkitOverflowScrolling = 'touch';
    pdfViewContainer.style.height = '100%';
    pdfViewContainer.style.flex = '1 1 auto';
  }
  if (!iframe) return;

  if (_pdfPreviewRunning) {
    _pdfPreviewPending = true;
    return;
  }

  const earlySignature = hashPDFPreviewSignature();
  const earlyIsDark = document.body.classList.contains('dark');
  const earlyIsMonochrome = document.body.classList.contains('photocopy-mode');
  const earlyPreviewMode = `${earlyIsDark ? 'dark' : 'light'}-${earlyIsMonochrome ? 'mono' : 'color'}`;
  if (_pdfLastRenderedSignature === earlySignature && _pdfLastRenderedMode === earlyPreviewMode && (iframe.src || iframe.srcdoc)) {
    if (loadingEl) {
      loadingEl.classList.remove('active');
      loadingEl.style.display = 'none';
      loadingEl.setAttribute('aria-busy', 'false');
    }
    iframe.classList.remove('pdf-loading');
    iframe.style.opacity = '1';
    return;
  }

  _pdfPreviewRunning = true;
  
  if (loadingEl) {
    loadingEl.classList.add('active');
    loadingEl.setAttribute('aria-busy', 'true');
    loadingEl.style.display = 'flex';
  }
  if (loadingStatusEl) {
    loadingStatusEl.textContent = '📄 Preparing PDF preview...';
  }
  iframe.classList.add('pdf-loading');
  iframe.style.opacity = '0.3';
  iframe.style.height = '100%';
  iframe.style.width = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';

  try {
    const signature = hashPDFPreviewSignature();
    const isDark = document.body.classList.contains('dark');
    const isMonochrome = document.body.classList.contains('photocopy-mode');
    const previewMode = `${isDark ? 'dark' : 'light'}-${isMonochrome ? 'mono' : 'color'}`;

    prepareDocumentForPDFPreview(signature);

    let pageChunks = _normalizePDFPageChunks(_collectRenderableEditorPages().map(_serializePageForPDF));
    if (!pageChunks.length) {
      pageChunks = _normalizePDFPageChunks(_buildSimplePDFPageChunksFallback());
    }
    if (!pageChunks.length) throw new Error('No renderable document pages available.');
    if (myToken !== _pdfPreviewGenerationToken) return;

    if (loadingStatusEl) {
      loadingStatusEl.textContent = `📄 Rendering ${pageChunks.length} page${pageChunks.length === 1 ? '' : 's'}...`;
    }

    let loadResolve, loadReject;
    const loadPromise = new Promise((resolve, reject) => {
      loadResolve = resolve;
      loadReject = reject;
    });

    const onLoad = () => {
      if (myToken !== _pdfPreviewGenerationToken) return;
      loadResolve();
    };

    const onError = () => {
      if (myToken !== _pdfPreviewGenerationToken) return;
      loadReject(new Error('Iframe failed to load'));
    };

    iframe.onload = onLoad;
    iframe.onerror = onError;

    // Pass dark and monochrome flags to the preview builder
    const previewHTML = typeof buildUnifiedPDFPreviewDocument === 'function' ?
      buildUnifiedPDFPreviewDocument(pageChunks, isMonochrome, isDark) :
      _buildFallbackPreviewHTML(pageChunks, isMonochrome, isDark);

    if (!_setPDFPreviewFrameHTML(iframe, previewHTML)) {
      throw new Error('Unable to initialize PDF preview frame.');
    }

    await Promise.race([
      loadPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Preview load timeout')), 12000))
    ]);

    _pdfLastRenderedSignature = signature;
    _pdfLastRenderedMode = previewMode;
    _pdfPreviewRetryCount = 0;

    if (loadingStatusEl) loadingStatusEl.textContent = '✅ PDF preview ready';
    if (loadingEl) {
      loadingEl.classList.remove('active');
      loadingEl.style.display = 'none';
      loadingEl.setAttribute('aria-busy', 'false');
    }
    iframe.classList.remove('pdf-loading');
    iframe.style.opacity = '1';

  } catch (error) {
    const _isEmptyDocError = !!(error && error.message === 'No renderable document pages available.');
    if (_isEmptyDocError) {
      // Nothing to render (blank project, or Slides mode where the A4 editor
      // is empty) is a normal idle state, not a failure: no retries, no toast.
      console.info('PDF preview skipped: no document pages yet.');
      if (myToken === _pdfPreviewGenerationToken) {
        _pdfPreviewRetryCount = 0;
        if (loadingEl) {
          loadingEl.classList.remove('active');
          loadingEl.style.display = 'none';
          loadingEl.setAttribute('aria-busy', 'false');
        }
        iframe.classList.remove('pdf-loading');
        iframe.style.opacity = '1';
      }
      return;
    }
    console.error('PDF preview generation failed:', error);
    if (myToken === _pdfPreviewGenerationToken) {
      _pdfPreviewRetryCount++;
      if (_pdfPreviewRetryCount <= MAX_PREVIEW_RETRIES) {
        if (loadingStatusEl) {
          loadingStatusEl.textContent = `🔄 Retrying preview (${_pdfPreviewRetryCount}/${MAX_PREVIEW_RETRIES})...`;
        }
        setTimeout(() => {
          if (_pdfPreviewGenerationToken === myToken) {
            _pdfPreviewRunning = false;
            _runLivePDFIframePreview(myToken);
          }
        }, 1500 * _pdfPreviewRetryCount);
        return;
      }
      if (loadingEl) {
        loadingEl.classList.remove('active');
        loadingEl.style.display = 'none';
        loadingEl.setAttribute('aria-busy', 'false');
      }
      if (loadingStatusEl) {
        loadingStatusEl.textContent = '⚠️ Preview failed to render. Please try refreshing.';
      }
      iframe.classList.remove('pdf-loading');
      iframe.style.opacity = '1';
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('⚠️ PDF preview failed: ' + (error && error.message ? error.message : 'unknown error'));
      }
    }
  } finally {
    _pdfPreviewRunning = false;
    if (_pdfPreviewPending) {
      _pdfPreviewPending = false;
      _runLivePDFIframePreview(_pdfPreviewGenerationToken);
    }
  }
}

// ===== FALLBACK PREVIEW HTML (Theme-aware) =====
// ===== PDF VISUAL FORMAT THEME CSS (for print/preview export) =====
// The "True PDF" (print-based) and live-preview documents built below are
// fully self-contained HTML documents (set as an iframe's srcdoc) that do
// NOT load the app's own styles.css — so the .pdf-format-* theme rules
// (aurora/editorial/midnight/etc.) that give each page its own background
// and heading colors were simply absent there, and every export silently
// fell back to the plain white .pdf-page background defined further below,
// even when a colorful format was selected in the editor. This constant is
// the same .doc-page-canvas.pdf-format-* ruleset from styles.css, copied in
// so the exported page (which also carries the doc-page-canvas and
// pdf-format-<id> classes) picks up the correct themed background/colors.
// Keep this in sync with styles.css if a format's colors are ever changed there.
const PDF_FORMAT_THEME_CSS = `
.doc-page-canvas.pdf-format-aurora {
  background:linear-gradient(180deg,#fff,#f0fdfa)!important;
  color:#123b3a;
}
.doc-page-canvas.pdf-format-aurora h1,
.doc-page-canvas.pdf-format-aurora h2 {
  color:#0f766e!important;
  border-left:5px solid #14b8a6!important;
  padding-left:12px;
}
.doc-page-canvas.pdf-format-aurora h3 { color:#115e59!important; }
.doc-page-canvas.pdf-format-aurora table th {
  background:#ccfbf1!important;
  color:#134e4a!important;
}
.dark .doc-page-canvas.pdf-format-aurora {
  background:linear-gradient(180deg,#091d1b,#0f172a)!important;
  color:#ecfeff!important;
}
.dark .doc-page-canvas.pdf-format-aurora h1,
.dark .doc-page-canvas.pdf-format-aurora h2,
.dark .doc-page-canvas.pdf-format-aurora h3 {
  color:#a7f3d0!important;
  border-left-color:#2dd4bf!important;
}
.dark .doc-page-canvas.pdf-format-aurora table th {
  background:#0f766e!important;
  color:#ecfeff!important;
}

.doc-page-canvas.pdf-format-editorial {
  background:#fffaf5!important;
  color:#292524;
}
.doc-page-canvas.pdf-format-editorial h1 {
  font-family:Georgia,serif!important;
  color:#7c2d12!important;
  border-bottom:2px solid #ea580c!important;
  padding-bottom:10px;
}
.doc-page-canvas.pdf-format-editorial h2 {
  font-family:Georgia,serif!important;
  color:#9a3412!important;
}
.doc-page-canvas.pdf-format-editorial h3 { color:#c2410c!important; }
.doc-page-canvas.pdf-format-editorial table th {
  background:#fed7aa!important;
  color:#7c2d12!important;
}
.dark .doc-page-canvas.pdf-format-editorial {
  background:linear-gradient(180deg,#1f120d,#0f172a)!important;
  color:#fef3c7!important;
}
.dark .doc-page-canvas.pdf-format-editorial h1,
.dark .doc-page-canvas.pdf-format-editorial h2,
.dark .doc-page-canvas.pdf-format-editorial h3 {
  color:#fdba74!important;
  border-bottom-color:#fb923c!important;
}
.dark .doc-page-canvas.pdf-format-editorial table th {
  background:#9a4d17!important;
  color:#fff7ed!important;
}

.doc-page-canvas.pdf-format-midnight {
  background:#f7f7ff!important;
  color:#1e1b4b;
}
.doc-page-canvas.pdf-format-midnight h1 {
  color:#fff!important;
  background:linear-gradient(135deg,#312e81,#6366f1)!important;
  padding:16px 20px;
  border-radius:12px;
}
.doc-page-canvas.pdf-format-midnight h2 {
  color:#4338ca!important;
  border-bottom:2px solid #818cf8!important;
  padding-bottom:7px;
}
.doc-page-canvas.pdf-format-midnight h3 { color:#4f46e5!important; }
.doc-page-canvas.pdf-format-midnight table th {
  background:#c7d2fe!important;
  color:#312e81!important;
}
.dark .doc-page-canvas.pdf-format-midnight {
  background:linear-gradient(180deg,#0f132b,#090d18)!important;
  color:#e2e8f0!important;
}
.dark .doc-page-canvas.pdf-format-midnight h1 {
  background:linear-gradient(135deg,#312e81,#6d5ef8)!important;
  color:#f8fafc!important;
}
.dark .doc-page-canvas.pdf-format-midnight h2,
.dark .doc-page-canvas.pdf-format-midnight h3 {
  color:#c4b5fd!important;
  border-bottom-color:#8b5cf6!important;
}
.dark .doc-page-canvas.pdf-format-midnight table th {
  background:#312e81!important;
  color:#e0e7ff!important;
}

.doc-page-canvas.pdf-format-blueprint {
  background-color:#f8fafc!important;
  background-image:linear-gradient(rgba(56,189,248,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.08) 1px,transparent 1px)!important;
  background-size:24px 24px!important;
  color:#0f172a;
}
.doc-page-canvas.pdf-format-blueprint h1 {
  color:#0c4a6e!important;
  border-left:6px solid #0284c7!important;
  background:rgba(224,242,254,.88)!important;
  padding:12px 16px!important;
}
.doc-page-canvas.pdf-format-blueprint h2 {
  color:#075985!important;
  border-bottom:2px solid #38bdf8!important;
  padding-bottom:7px!important;
}
.doc-page-canvas.pdf-format-blueprint h3 { color:#0369a1!important; }
.doc-page-canvas.pdf-format-blueprint table th {
  background:#bae6fd!important;
  color:#0c4a6e!important;
}
.dark .doc-page-canvas.pdf-format-blueprint {
  background-color:#071827!important;
  background-image:linear-gradient(rgba(125,211,252,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(125,211,252,.08) 1px,transparent 1px)!important;
  color:#e0f2fe!important;
}
.dark .doc-page-canvas.pdf-format-blueprint h1,
.dark .doc-page-canvas.pdf-format-blueprint h2,
.dark .doc-page-canvas.pdf-format-blueprint h3 {
  color:#bae6fd!important;
  border-color:#38bdf8!important;
}
.dark .doc-page-canvas.pdf-format-blueprint table th {
  background:#0f4c81!important;
  color:#e0f2fe!important;
}

.doc-page-canvas.pdf-format-sage {
  background:linear-gradient(180deg,#fff,#f7fee7)!important;
  color:#27351b;
}
.doc-page-canvas.pdf-format-sage h1 {
  color:#365314!important;
  border-bottom:4px solid #84cc16!important;
  padding-bottom:9px!important;
}
.doc-page-canvas.pdf-format-sage h2 {
  color:#4d7c0f!important;
  border-left:4px solid #a3e635!important;
  padding-left:10px!important;
}
.doc-page-canvas.pdf-format-sage h3 { color:#3f6212!important; }
.doc-page-canvas.pdf-format-sage table th {
  background:#ecfccb!important;
  color:#365314!important;
}
.dark .doc-page-canvas.pdf-format-sage {
  background:linear-gradient(180deg,#111b10,#0b1220)!important;
  color:#ecfccb!important;
}
.dark .doc-page-canvas.pdf-format-sage h1,
.dark .doc-page-canvas.pdf-format-sage h2,
.dark .doc-page-canvas.pdf-format-sage h3 {
  color:#bef264!important;
  border-color:#a3e635!important;
}
.dark .doc-page-canvas.pdf-format-sage table th {
  background:#365314!important;
  color:#ecfccb!important;
}

.doc-page-canvas.pdf-format-minimal {
  background:linear-gradient(180deg,#ffffff,#f8fafc)!important;
  color:#1f2937;
}
.doc-page-canvas.pdf-format-minimal h1 {
  color:#111827!important;
  border-bottom:2px solid #cbd5e1!important;
  padding-bottom:8px!important;
}
.doc-page-canvas.pdf-format-minimal h2 {
  color:#334155!important;
  border-bottom:1px solid #e2e8f0!important;
  padding-bottom:6px!important;
}
.doc-page-canvas.pdf-format-minimal h3 { color:#475569!important; }
.doc-page-canvas.pdf-format-minimal table th {
  background:#e2e8f0!important;
  color:#111827!important;
}
.dark .doc-page-canvas.pdf-format-minimal {
  background:linear-gradient(180deg,#0d1422,#0a0f1a)!important;
  color:#e5e7eb!important;
}
.dark .doc-page-canvas.pdf-format-minimal h1,
.dark .doc-page-canvas.pdf-format-minimal h2,
.dark .doc-page-canvas.pdf-format-minimal h3 {
  color:#e5e7eb!important;
  border-color:#94a3b8!important;
}
.dark .doc-page-canvas.pdf-format-minimal table th {
  background:#334155!important;
  color:#f8fafc!important;
}

.doc-page-canvas.pdf-format-rose {
  background:linear-gradient(180deg,#fff8fb,#fff1f2)!important;
  color:#4c1d2d;
}
.doc-page-canvas.pdf-format-rose h1 {
  color:#9f1239!important;
  border-bottom:3px solid #f9a8d4!important;
  padding-bottom:8px!important;
}
.doc-page-canvas.pdf-format-rose h2 {
  color:#be185d!important;
  border-left:4px solid #f9a8d4!important;
  padding-left:10px!important;
}
.doc-page-canvas.pdf-format-rose h3 { color:#9d174d!important; }
.doc-page-canvas.pdf-format-rose table th {
  background:#fbcfe8!important;
  color:#831843!important;
}
.dark .doc-page-canvas.pdf-format-rose {
  background:linear-gradient(180deg,#1f1024,#120d18)!important;
  color:#ffe4e6!important;
}
.dark .doc-page-canvas.pdf-format-rose h1,
.dark .doc-page-canvas.pdf-format-rose h2,
.dark .doc-page-canvas.pdf-format-rose h3 {
  color:#f9a8d4!important;
  border-color:#f472b6!important;
}
.dark .doc-page-canvas.pdf-format-rose table th {
  background:#9d174d!important;
  color:#fff1f2!important;
}

.doc-page-canvas.pdf-format-ocean {
  background:linear-gradient(180deg,#f0f9ff,#ecfeff)!important;
  color:#082f49;
}
.doc-page-canvas.pdf-format-ocean h1 {
  color:#0f172a!important;
  border-bottom:3px solid #38bdf8!important;
  padding-bottom:9px!important;
}
.doc-page-canvas.pdf-format-ocean h2 {
  color:#075985!important;
  border-left:4px solid #7dd3fc!important;
  padding-left:10px!important;
}
.doc-page-canvas.pdf-format-ocean h3 { color:#155e75!important; }
.doc-page-canvas.pdf-format-ocean table th {
  background:#bae6fd!important;
  color:#082f49!important;
}
.dark .doc-page-canvas.pdf-format-ocean {
  background:linear-gradient(180deg,#081827,#0b1120)!important;
  color:#dbeafe!important;
}
.dark .doc-page-canvas.pdf-format-ocean h1,
.dark .doc-page-canvas.pdf-format-ocean h2,
.dark .doc-page-canvas.pdf-format-ocean h3 {
  color:#7dd3fc!important;
  border-color:#38bdf8!important;
}
.dark .doc-page-canvas.pdf-format-ocean table th {
  background:#0f4c81!important;
  color:#f0f9ff!important;
}

.doc-page-canvas.pdf-format-highcontrast {
  background:#ffffff!important;
  color:#0f172a;
}
.doc-page-canvas.pdf-format-highcontrast h1 {
  color:#000000!important;
  background:#f8fafc!important;
  border-left:6px solid #111827!important;
  padding:10px 14px!important;
}
.doc-page-canvas.pdf-format-highcontrast h2 {
  color:#111827!important;
  border-bottom:2px solid #000!important;
  padding-bottom:7px!important;
}
.doc-page-canvas.pdf-format-highcontrast h3 { color:#111827!important; }
.doc-page-canvas.pdf-format-highcontrast table th {
  background:#111827!important;
  color:#ffffff!important;
}
.dark .doc-page-canvas.pdf-format-highcontrast {
  background:#0b0f17!important;
  color:#f8fafc!important;
}
.dark .doc-page-canvas.pdf-format-highcontrast h1,
.dark .doc-page-canvas.pdf-format-highcontrast h2,
.dark .doc-page-canvas.pdf-format-highcontrast h3 {
  color:#f8fafc!important;
  border-color:#f8fafc!important;
}
.dark .doc-page-canvas.pdf-format-highcontrast table th {
  background:#f8fafc!important;
  color:#0b0f17!important;
}
`;

// ========================================================================
// FIGURE SIZE / PLACEMENT VARIANTS — kept byte-for-byte in sync with the
// live editor's styles.css (.figure-pro.figure-compact / .figure-float-left
// / .figure-float-right). Without these, an AI-authored figure that the
// live editor renders as a small centered or side-floated illustration
// falls back to plain block width in the exported/printed PDF — the figure
// (and any colored background baked into its wrapper) ends up a different
// size/position than what the person saw while editing.
// ========================================================================
const PDF_FIGURE_LAYOUT_CSS = `
.figure-pro.figure-compact {
  max-width: 380px;
  margin-left: auto;
  margin-right: auto;
}
.figure-pro.figure-compact .figure-frame {
  max-width: 100%;
}
.figure-pro.figure-float-left,
.figure-pro.figure-float-right {
  max-width: 300px;
  margin-bottom: 10pt;
  clear: none;
}
.figure-pro.figure-float-left {
  float: left;
  margin-right: 18px;
}
.figure-pro.figure-float-right {
  float: right;
  margin-left: 18px;
}
.pdf-page h1,
.pdf-page h2,
.pdf-page h3 {
  clear: both;
}
`;

// ===== FONT POLICY: Bengali = Kalpurush, English = Times New Roman (always) =====
// Times New Roman has no Bengali glyphs, so the browser uses Kalpurush for Bengali
// characters automatically. The preview/print document is a separate HTML document,
// so it needs its own @font-face (absolute URL: it may be a blob/srcdoc page).
const PDF_DOC_FONT_STACK = "'Times New Roman','Tinos','Liberation Serif',Times,'Kalpurush',serif";
const PDF_MONO_INK = '#1f1f1f';
function _pdfFontFaceCSS() {
  let base = '';
  try { base = new URL('fonts/', document.baseURI).href; } catch (_) { base = 'fonts/'; }
  return `@font-face{font-family:'Kalpurush';src:local('Kalpurush'),local('kalpurush'),url('${base}Kalpurush.woff2') format('woff2'),url('${base}Kalpurush.ttf') format('truetype');font-weight:normal;font-style:normal;font-display:swap;}
      .pdf-page,.pdf-page :not(.katex):not(.katex *):not(svg):not(svg *):not(pre):not(pre *):not(code):not(.katex-eq):not(.katex-eq *){font-family:${PDF_DOC_FONT_STACK} !important;}
      /* FIX: do NOT force a font on .katex descendants. KaTeX's own CSS assigns KaTeX_Math / KaTeX_Main /
         KaTeX_AMS / KaTeX_Size1-4 per glyph class; overriding them breaks glyph->Unicode mapping and
         makes the equation text un-extractable / wrong in the PDF text layer. */
      .pdf-page .katex-eq .katex{font-family:KaTeX_Main,'Times New Roman',serif;}
      .photocopy-mode, .photocopy-mode *{text-shadow:none !important;-webkit-text-stroke:0 !important;}`;
}

function _buildFallbackPreviewHTML(pageChunks, isMonochromeMode, isDark) {
  const pageClasses = _getActivePDFFormatClasses(isMonochromeMode, isDark);
  const pageClassAttr = pageClasses ? ` ${pageClasses}` : '';

  const bgColor = '#f3f4f6';
  const pageBg = '#ffffff';
  const textColor = isMonochromeMode ? PDF_MONO_INK : '#111827';
  const headingColor = isMonochromeMode ? PDF_MONO_INK : '#1e3a8a';
  const headingBorderColor = isMonochromeMode ? '#000000' : '#2563eb';
  const borderColor = isMonochromeMode ? '#000000' : '#d1d5db';
  const footerColor = isMonochromeMode ? '#111111' : '#4b5563';
  const pageShadow = isMonochromeMode ? 'none' : '0 18px 26px -22px rgba(15,23,42,0.28)';
  const pageBorder = isMonochromeMode ? '1px solid #000000' : '1px solid rgba(15,23,42,0.08)';

  const pagesHTML = pageChunks.map((html, idx) =>
    `<div class="pdf-page-wrap"><div class="pdf-page doc-page-canvas${pageClassAttr}" style="color:${textColor};border:${pageBorder};box-shadow:${pageShadow};">${html}<div class="pdf-footer" style="color:${footerColor};">Page ${idx + 1} of ${pageChunks.length}</div></div></div>`
  ).join('');

  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin:0; padding:0; background:${bgColor}; font-family:${PDF_DOC_FONT_STACK}; line-height:1.38; font-size:12pt; display:flex; flex-direction:column; align-items:center; padding:20px; }
      .pdf-page-wrap { width:794px; height:1123px; margin:0 auto 18px; overflow:hidden; flex:0 0 auto; contain:layout style paint; content-visibility:auto; contain-intrinsic-size:1123px; }
      .pdf-page { background:${pageBg}; color:${textColor}; width:794px; height:1123px; padding:62px 58px 58px 58px; box-sizing:border-box; position:relative; overflow:hidden; text-align:left; line-height:1.38; font-size:12pt; }
      ${PDF_FORMAT_THEME_CSS}
      ${PDF_FIGURE_LAYOUT_CSS}
      ${_pdfFontFaceCSS()}
      .pdf-page p, .pdf-page li, .pdf-page td, .pdf-page th, .pdf-page blockquote, .pdf-page figcaption { line-height:1.38; }
      .pdf-page p { margin:0 0 7pt; }
      .pdf-page ul, .pdf-page ol { margin:6pt 0 8pt 20pt; padding-left:20pt; }
      .pdf-footer { position:absolute; bottom:22px; left:0; right:0; text-align:center; font-size:10pt; color:${footerColor}; font-family:${PDF_DOC_FONT_STACK}; }
      h1{font-family:${PDF_DOC_FONT_STACK};font-size:22pt;color:${headingColor};border-bottom:2px solid ${headingBorderColor};padding-bottom:4px;line-height:1.2;margin:0 0 10pt;}
      h2{font-family:${PDF_DOC_FONT_STACK};font-size:16pt;color:#1e40af;line-height:1.25;}
      h3{font-family:${PDF_DOC_FONT_STACK};font-size:13pt;color:#0369a1;line-height:1.28;}
      /* FIX: this fallback builder had no table/img/svg rules at all -- see the
         matching fix in buildUnifiedPDFPreviewDocument() above for why these
         are needed (image/table content otherwise renders unstyled/oversized). */
      table{width:100%;border-collapse:collapse;margin:10pt 0} th{background:${isMonochromeMode ? '#000000' : '#2563eb'};color:#ffffff;font-weight:bold;padding:8px;border:1px solid ${borderColor};text-align:left} td{border:1px solid ${borderColor};padding:6px 8px;text-align:left;word-break:break-word} tr:nth-child(even){background:${isMonochromeMode ? 'transparent' : '#f8fafc'}} img{max-width:100%;height:auto;object-fit:contain} svg{max-width:100%;height:auto}
      .katex-eq { display:inline-block; max-width:100%; background:transparent !important; border:none !important; box-shadow:none !important; overflow:visible !important; color:${textColor} !important; }
      .katex-eq .katex { color:${textColor} !important; }
      .katex-display { overflow:visible !important; max-width:100%; scrollbar-width:none !important; }
      .katex-display::-webkit-scrollbar { display:none !important; }
      .katex-eq.katex-render-failed { background-color:#fee2e2; color:#dc2626; border:1px solid #fca5a5; padding:2px 6px; border-radius:4px; display:inline-block; font-weight:600; }
      .katex-eq.katex-render-failed .katex-fallback { color:#dc2626; font-weight:600; }
      ${isMonochromeMode ? `
      .fc-wrapper svg text, .fc-wrapper svg .fc-node-text, .fc-wrapper svg .fc-node-note { fill:#000 !important; color:#000 !important; }
      svg .fc-node-rect, svg .fc-line { stroke:#000 !important; }
      svg .fc-node-rect { fill:#fff !important; }
      svg .fc-label-pill { fill:#fff !important; stroke:#000 !important; }
      @media screen { .figure-frame svg, .figure-pro svg { filter: grayscale(1); } }
      @media print { .figure-frame svg, .figure-pro svg { filter: none !important; } }
      @media screen { img, canvas { filter: grayscale(1); } }
      ` : ''}
      @media screen and (max-width:850px) { body{padding:8px 0 !important;} .pdf-page-wrap { overflow:hidden; margin:0 auto 12px; } .pdf-page { transform-origin:top left; } }
      @page { size:210mm 297mm; margin:0; }
      @media print { html, body { height:auto !important; overflow:visible !important; } .pdf-page-wrap { width:210mm !important; height:297mm !important; background:${pageBg} !important; content-visibility:visible !important; contain-intrinsic-size:auto !important; page-break-before:always !important; break-before:page !important; page-break-after:avoid !important; break-after:avoid !important; margin:0 !important; } .pdf-page-wrap:first-of-type { page-break-before:auto !important; break-before:auto !important; } .pdf-page { width:210mm !important; height:297mm !important; } body { padding:0; background:${pageBg} !important; } }
      ${typeof getPaginateCompactCSS === 'function' ? getPaginateCompactCSS('.pdf-page') : ''}
      ${PDF_SPLIT_CONTINUATION_CSS}
    </style>
  </head><body${pageClasses ? ` class="${pageClasses}"` : ''}>${pagesHTML}
  <script>
    function fitPages(){
      var vw=document.documentElement.clientWidth||window.innerWidth||360;
      if(vw<=850){
        var scale=Math.min(1,Math.max(0.48,(vw-8)/794));
        var sw=794*scale, sh=1123*scale;
        document.body.style.padding='8px 0';
        document.body.style.alignItems='center';
        document.querySelectorAll('.pdf-page-wrap').forEach(function(w){
          var page=w.querySelector('.pdf-page');
          if(page){ page.style.transformOrigin='top left'; page.style.transform='scale('+scale+')'; page.style.width='794px'; page.style.height='1123px'; }
          w.style.overflow='hidden'; w.style.width=sw+'px'; w.style.height=sh+'px'; w.style.margin='0 auto 12px'; w.style.transform='';
        });
      } else {
        document.querySelectorAll('.pdf-page-wrap').forEach(function(w){
          var page=w.querySelector('.pdf-page');
          if(page){ page.style.transform=''; page.style.transformOrigin=''; }
          w.style.width='794px'; w.style.height='1123px'; w.style.margin='0 auto 20px';
        });
      }
    }
    fitPages(); window.addEventListener('resize',fitPages);
    document.addEventListener('DOMContentLoaded', fitPages);
    window.addEventListener('load', function(){ fitPages(); setTimeout(fitPages,150); setTimeout(fitPages,500); });
    if (typeof ResizeObserver === 'function') {
      var __lastW2 = 0;
      var ro2 = new ResizeObserver(function(entries){
        var w = Math.round((entries[0] && entries[0].contentRect && entries[0].contentRect.width) || 0);
        if (w > 0 && w !== __lastW2) { __lastW2 = w; fitPages(); }
      });
      ro2.observe(document.documentElement);
    }
    setTimeout(function(){ try{ parent.postMessage('pdf-iframe-ready','*'); }catch(e){} }, 500);
  <\/script></body></html>`;
}

// ===== FORWARD THE HOST APP'S OWN STYLESHEETS INTO THE PRINT/PREVIEW IFRAME =====
function _collectHostStylesheetLinksHTML() {
  // The export preview must not inherit the app's dark theme CSS or UI styling.
  // Keep the PDF document self-contained and neutral so downloaded files remain readable.
  return '';
}

function _getActivePDFFormatClasses(isMonochromeMode, isDark) {
  const classes = [];
  if (!isMonochromeMode) {
    const fmt = _pdfActiveFormatClass();
    if (fmt) classes.push(fmt);
  }
  if (isMonochromeMode) classes.push('monochrome-document', 'photocopy-mode');
  if (isDark) classes.push('dark');
  return classes.join(' ');
}

function _stripPageFooterHTML(html) {
  return String(html || '').replace(/<(div|span)\s+[^>]*class=["'][^"']*page-footer-number[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, '');
}

function _normalizePDFPageChunks(pageChunks) {
  const safeChunks = Array.isArray(pageChunks) ? pageChunks : [];
  const normalized = [];

  for (const chunk of safeChunks) {
    if (chunk === null || chunk === undefined) continue;
    let html = String(chunk || '').trim();
    if (!html) continue;
    html = _stripPageFooterHTML(html);
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');

    // The real PDF page fit engine uses a .pdf-fit-wrapper as an internal
    // measurement envelope. It should never survive into the public preview
    // chunk stream as an outer block, because that dummy wrapper is what
    // creates the false leading break and odd page-scoping behavior.
    const parser = document.createElement('div');
    parser.innerHTML = html;
    // Remove HTML <style> blocks but keep <style> that lives inside an <svg> (diagram/chart class rules).
    parser.querySelectorAll('style').forEach(st => { if (!st.closest('svg')) st.remove(); });
    const wrappers = Array.from(parser.querySelectorAll('.pdf-fit-wrapper'));
    for (const wrapper of wrappers) {
      const parent = wrapper.parentNode;
      if (!parent) continue;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
    }
    html = parser.innerHTML;

    html = html.replace(/\n\s*\n/g, '\n');
    const cleanText = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanText) continue;
    if (/^(start typing here|ask ai on the left to generate notes|page\s*\d+\s*of\s*\d+|page\s*\d+)$/i.test(cleanText)) continue;
    normalized.push(html);
  }

  return normalized;
}

// ===== BUILD UNIFIED PDF PREVIEW DOCUMENT (Theme-aware) =====
function buildUnifiedPDFPreviewDocument(pageChunks, isMonochromeMode, isDark) {
  const pageClasses = _getActivePDFFormatClasses(isMonochromeMode, isDark);
  const pageClassAttr = pageClasses ? ` ${pageClasses}` : '';

  const bgColor = '#f3f4f6';
  const pageBg = '#ffffff';
  const textColor = isMonochromeMode ? PDF_MONO_INK : '#111827';
  const headingColor = isMonochromeMode ? PDF_MONO_INK : '#1e3a8a';
  const headingBorderColor = isMonochromeMode ? '#000000' : '#2563eb';
  const borderColor = isMonochromeMode ? '#000000' : '#d1d5db';
  const footerColor = isMonochromeMode ? '#111111' : '#4b5563';
  const pageShadow = isMonochromeMode ? 'none' : '0 18px 26px -22px rgba(15,23,42,0.28)';
  const pageBorder = isMonochromeMode ? '1px solid #000000' : '1px solid rgba(15,23,42,0.08)';

  const pagesHTML = pageChunks.map((html, idx) =>
    `<div class="pdf-page-wrap"><div class="pdf-page doc-page-canvas${pageClassAttr}" style="color:${textColor};border:${pageBorder};box-shadow:${pageShadow};">${html}<div class="pdf-footer" style="color:${footerColor};">Page ${idx + 1} of ${pageChunks.length}</div></div></div>`
  ).join('');

  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <style>
      @page { size: 210mm 297mm; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      html, body { margin:0; padding:0; height:100%; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; }
      body { background:${bgColor}; font-family:${PDF_DOC_FONT_STACK}; line-height:1.38; font-size:12pt; display:flex; flex-direction:column; align-items:center; padding:20px 10px; }
      .pdf-page-wrap { width:${PDF_LAYOUT.width}px; height:${PDF_LAYOUT.height}px; margin:0 auto 18px; overflow:hidden; flex:0 0 auto; break-inside:avoid; page-break-inside:avoid; contain:layout style paint; content-visibility:auto; contain-intrinsic-size:${PDF_LAYOUT.width}px ${PDF_LAYOUT.height}px; }
      .pdf-page { background:${pageBg}; color:${textColor}; width:${PDF_LAYOUT.width}px; height:${PDF_LAYOUT.height}px; padding:${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px; box-sizing:border-box; position:relative; overflow:hidden; text-align:left; border-radius:12px; box-shadow:${pageShadow}; break-inside:avoid; page-break-inside:avoid; line-height:1.38; font-size:12pt; }
      ${PDF_FORMAT_THEME_CSS}
      ${PDF_FIGURE_LAYOUT_CSS}
      ${_pdfFontFaceCSS()}
      .pdf-page :not(th):not([style*="background"]):not(.block-example):not(.block-example *):not(.block-definition):not(.block-definition *):not(.block-warning):not(.block-warning *):not(.block-important):not(.block-important *):not(.block-note):not(.block-note *):not(.block-solution):not(.block-solution *):not(.block-accent):not(.pdf-footer) { background-color:transparent !important; }
      ${isMonochromeMode ? `
      /* h2/h3/h4 below have their own hardcoded blue/cyan/slate colors that
         only get overridden here, in monochrome mode, so printed headings
         stay pure black. In colorful mode this rule is skipped entirely so
         those heading colors (and any other intentionally-colored text)
         come through as authored instead of being flattened to one gray. */
      .pdf-page :not(th):not(.block-example):not(.block-example *):not(.block-definition):not(.block-definition *):not(.block-warning):not(.block-warning *):not(.block-important):not(.block-important *):not(.block-note):not(.block-note *):not(.block-solution):not(.block-solution *):not(.block-accent):not(.pdf-footer) { color:${PDF_MONO_INK} !important; }
      ` : ''}
      .pdf-page p, .pdf-page li, .pdf-page h1, .pdf-page h2, .pdf-page h3, .pdf-page h4, .pdf-page blockquote, .pdf-page table, .pdf-page pre, .pdf-page code, .pdf-page img { orphans:2; widows:2; break-inside:avoid; page-break-inside:avoid; }
      .pdf-page p { margin:0 0 7pt; line-height:1.38; }
      .pdf-page ul, .pdf-page ol { margin:6pt 0 8pt 20pt; padding-left:20pt; }
      .pdf-page li { margin:3pt 0; line-height:1.38; }
      .pdf-page > h1:first-child { margin-top:0; }
      .pdf-page > h2:first-child { margin-top:0; }
      .pdf-footer { position:absolute; bottom:${PDF_LAYOUT.footerBottom}px; left:0; right:0; text-align:center; font-size:10pt; color:${footerColor}; font-family:${PDF_DOC_FONT_STACK}; }
      h1{font-family:${PDF_DOC_FONT_STACK};font-size:22pt;margin:0 0 10pt;color:${headingColor};border-bottom:2px solid ${headingBorderColor};padding-bottom:4px;line-height:1.2}
      h2{font-family:${PDF_DOC_FONT_STACK};font-size:16pt;margin:12pt 0 6pt;color:#1e40af;line-height:1.25}
      h3{font-family:${PDF_DOC_FONT_STACK};font-size:13pt;margin:10pt 0 4pt;color:#0369a1;line-height:1.28}
      h4{font-family:${PDF_DOC_FONT_STACK};font-size:12.8pt;margin:8pt 0 4pt;color:#334155;line-height:1.32}
      table{width:100%;border-collapse:collapse;table-layout:fixed;margin:10pt 0;font-size:10.6pt} th{background:${isMonochromeMode ? '#000000' : '#2563eb'};color:#ffffff;padding:7px 8px;border:1px solid ${borderColor};text-align:left;font-size:10.8pt;line-height:1.3} td{border:1px solid ${borderColor};padding:6px 8px;word-break:break-word;line-height:1.34;vertical-align:top} tr:nth-child(even){background:${isMonochromeMode ? 'transparent' : '#f8fafc'}}
      /* FIX: styles.css's ".doc-page-canvas svg { max-width:100%; height:auto; }"
         has no equivalent here. AI-drawn figures/diagrams (illustration-library.js,
         diagram-library.js) are raw <svg viewBox="0 0 W H"> with no width/height
         attribute, so without this rule the svg has no size constraint tying it to
         its container -- the .figure-pro.figure-compact wrapper above can cap the
         FIGURE at 380px, but the svg inside it still needs its own max-width:100%
         to actually shrink to fit, which is why it was rendering oversized even
         with PDF_FIGURE_LAYOUT_CSS in place. */
      svg{max-width:100%;height:auto} img{max-width:100%;height:auto;object-fit:contain}
      pre,code{max-width:100%;overflow-wrap:anywhere;white-space:pre-wrap}
      ${isMonochromeMode ? `
      /* PHOTOCOPY-STANDARD callouts. No box, no left rule — just plain
         body text. The bold label already written inside each one
         ("Definition:", "Example:", ...) is what tells them apart. */
      .block-example,.block-definition,.block-warning,.block-important,.block-note{background:transparent;border:none;padding:0;margin:10px 0;border-radius:0}
      .block-accent{background:transparent !important;border:none !important;border-left:3.5pt solid #000 !important;padding:8px 14px;margin:10px 0}.block-solution{background:transparent;border:none;border-radius:0;padding:0;margin:14px 0}
      ` : `
      .block-example{background:#f0fdf4;border-left:4px solid #10b981;padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-definition{background:#eff6ff;border-left:4px solid #3b82f6;padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-warning{background:#fef2f2;border-left:4px solid #ef4444;padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-important{background:#fff7ed;border-left:4px solid #f97316;padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-note{background:#fdf2f8;border-left:4px solid #ec4899;padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}
      .block-accent{background:transparent !important;border:none !important;border-left:4px solid ${borderColor} !important;padding:8px 14px;margin:10px 0}.block-solution{background:#f5f3ff;border:1px solid ${borderColor};border-radius:8px;padding:14px 16px 10px;margin:14px 0}
      `}
      .photocopy-mode .quiz-answer-key { background:#fff !important; border-color:#000 !important; }
      ${isMonochromeMode ? `
      /* Diagram handling for monochrome PDF preview/export — mirrors the
         live-editor rules. The simple concept-map system (.fc-wrapper) always
         pairs a light box with dark text, so it is safe to force pure
         black/white. The freeform "figure-pro" system is AI-authored SVG that
         may use a dark box with light text intentionally; converting it with
         a grayscale filter (instead of forcing black text on an unrelated
         dark fill) keeps it readable instead of looking like a solid block. */
      .fc-wrapper svg text, .fc-wrapper svg .fc-node-text, .fc-wrapper svg .fc-node-note { fill:#000 !important; color:#000 !important; }
      svg .fc-node-rect, svg .fc-line { stroke:#000 !important; }
      svg .fc-node-rect { fill:#fff !important; }
      svg .fc-label-pill { fill:#fff !important; stroke:#000 !important; }
      @media screen { .figure-frame svg, .figure-pro svg { filter: grayscale(1); } }
      @media print { .figure-frame svg, .figure-pro svg { filter: none !important; } }
      ` : ''}
      .katex-eq .katex { color:${textColor} !important; }
      @media print { .pdf-page-wrap{content-visibility:visible !important;contain:none !important;contain-intrinsic-size:auto !important;} .pdf-page,.pdf-page *{filter:none !important;backdrop-filter:none !important;mix-blend-mode:normal !important;text-shadow:none !important;} .katex-eq,.katex-eq *{opacity:1 !important;} html, body { height:auto !important; overflow:visible !important; -webkit-overflow-scrolling:auto !important; } body{padding:0 !important;background:${pageBg} !important; display:block !important;} .pdf-page-wrap{width:210mm !important;height:297mm !important;background:${pageBg} !important;margin:0 !important;overflow:hidden !important;page-break-before:always !important; break-before:page !important; page-break-after:avoid !important; break-after:avoid !important; page-break-inside:avoid !important; break-inside:avoid !important;} .pdf-page-wrap:first-of-type{page-break-before:auto !important; break-before:auto !important;} .pdf-page{width:210mm !important;height:297mm !important;transform:none !important;box-shadow:none !important; border:none !important; border-radius:0 !important; page-break-inside:avoid !important; break-inside:avoid !important;} }
      @media screen and (max-width:850px) { body{padding:8px 0 !important; align-items:center;} .pdf-page-wrap{margin:0 auto 12px; overflow:hidden;} .pdf-page{transform-origin:top left;} }
      ${typeof getPaginateCompactCSS === 'function' ? getPaginateCompactCSS('.pdf-page') : ''}
      ${PDF_SPLIT_CONTINUATION_CSS}
    </style>
  </head><body${pageClasses ? ` class="${pageClasses}"` : ''}>${pagesHTML}
  <script>
    function fitPagesToScreen(){
      var vw = document.documentElement.clientWidth || window.innerWidth || 360;
      var pageWidth = ${PDF_LAYOUT.width};
      var pageHeight = ${PDF_LAYOUT.height};
      if (vw <= 850) {
        var available = Math.max(1, vw - 4);
        var scale = Math.min(1, Math.max(0.48, available / pageWidth));
        var scaledW = pageWidth * scale;
        var scaledH = pageHeight * scale;
        document.body.style.padding = '4px 0';
        document.body.style.alignItems = 'center';
        document.querySelectorAll('.pdf-page-wrap').forEach(function(wrap){
          var page = wrap.querySelector('.pdf-page');
          if (!page) return;
          page.style.width = pageWidth + 'px';
          page.style.height = pageHeight + 'px';
          page.style.transformOrigin = 'top left';
          page.style.transform = 'scale(' + scale + ')';
          wrap.style.overflow = 'hidden';
          wrap.style.width = scaledW + 'px';
          wrap.style.height = scaledH + 'px';
          wrap.style.margin = '0 auto 8px';
          wrap.style.transform = '';
          wrap.style.transformOrigin = '';
        });
      } else {
        document.body.style.padding = '';
        document.querySelectorAll('.pdf-page-wrap').forEach(function(wrap){
          var page = wrap.querySelector('.pdf-page');
          if (!page) return;
          page.style.transform = '';
          page.style.transformOrigin = '';
          wrap.style.width = pageWidth + 'px';
          wrap.style.height = pageHeight + 'px';
          wrap.style.margin = '0 auto 20px';
          wrap.style.overflow = 'hidden';
        });
      }
    }
    function shrinkKatexToFit(){
      document.querySelectorAll('.katex-display').forEach(function(d){
        d.style.overflow = 'visible';
        var w = d.closest('.katex-eq') || d.parentElement;
        if (w) { w.style.overflow = 'visible'; w.style.background = 'transparent'; w.style.border = 'none'; w.style.boxShadow = 'none'; }
        var a = (w && w.clientWidth) || d.clientWidth;
        var c = d.scrollWidth;
        if (a > 0 && c > a + 1) {
          var r = Math.max(0.4, Math.min(a / c, 1));
          var b = parseFloat(getComputedStyle(d).fontSize) || 16;
          d.style.fontSize = (b * r) + 'px';
        }
      });
    }
    var readySent = false;
    function allImagesLoaded(){
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        if (!imgs[i].complete || imgs[i].naturalWidth === 0) return false;
      }
      return true;
    }
    function waitForImagesThenReady(){
      if (allImagesLoaded()) { notifyPrintReady(); return; }
      var imgs = document.querySelectorAll('img');
      var remaining = 0;
      var settle = function(){ remaining--; if (remaining <= 0) notifyPrintReady(); };
      Array.prototype.forEach.call(imgs, function(img){
        if (img.complete && img.naturalWidth > 0) return;
        remaining++;
        img.addEventListener('load', settle, { once: true });
        img.addEventListener('error', settle, { once: true });
      });
      if (remaining === 0) { notifyPrintReady(); return; }
      setTimeout(notifyPrintReady, 1500);
    }
    var __fontsPrimed = null;
    function primeFontsForPrint(){
      if (__fontsPrimed) return __fontsPrimed;
      if (!(document.fonts && document.fonts.load)) { __fontsPrimed = Promise.resolve(); return __fontsPrimed; }
      var specs = [
        ['16px KaTeX_Main','x'], ['bold 16px KaTeX_Main','x'], ['italic 16px KaTeX_Main','x'],
        ['italic 16px KaTeX_Math','x'], ['16px KaTeX_AMS','x'],
        ['16px KaTeX_Size1','x'], ['16px KaTeX_Size2','x'], ['16px KaTeX_Size3','x'], ['16px KaTeX_Size4','x'],
        ['16px Kalpurush','\u0985\u0995']
      ];
      var loads = specs.map(function(sp){ try { return document.fonts.load(sp[0], sp[1]).catch(function(){}); } catch(e){ return Promise.resolve(); } });
      var settled = Promise.all(loads)
        .then(function(){ return new Promise(function(r){ setTimeout(r, 80); }); })   // let layout request any remaining faces
        .then(function(){ return document.fonts.ready; });
      __fontsPrimed = Promise.race([settled, new Promise(function(r){ setTimeout(r, 8000); })]);
      return __fontsPrimed;
    }
    function notifyPrintReady(){
      if (readySent) return;
      readySent = true;
      // Wait for KaTeX/Kalpurush faces BEFORE measuring (shrinkKatexToFit) and BEFORE the parent prints.
      primeFontsForPrint().then(function(){
        shrinkKatexToFit();
        fitPagesToScreen();
        try { parent.postMessage('pdf-iframe-ready', '*'); } catch(e) {}
      });
    }
    fitPagesToScreen();
    window.addEventListener('resize', function(){ requestAnimationFrame(fitPagesToScreen); });
    document.addEventListener('DOMContentLoaded', fitPagesToScreen);
    window.addEventListener('load', function(){
      fitPagesToScreen();
      setTimeout(fitPagesToScreen, 150);
      setTimeout(fitPagesToScreen, 500);
    });
    if (typeof ResizeObserver === 'function') {
      var __lastW = 0;
      var ro = new ResizeObserver(function(entries){
        var w = Math.round((entries[0] && entries[0].contentRect && entries[0].contentRect.width) || 0);
        if (w > 0 && w !== __lastW) { __lastW = w; fitPagesToScreen(); }
      });
      ro.observe(document.documentElement);
    }
    window.addEventListener('orientationchange', function(){ setTimeout(fitPagesToScreen, 200); });
    function resetInlineStylesForPrint(){
      document.querySelectorAll('.pdf-page-wrap').forEach(function(wrap){
        wrap.style.width = ''; wrap.style.height = ''; wrap.style.margin = ''; wrap.style.transform = ''; wrap.style.transformOrigin = '';
        var page = wrap.querySelector('.pdf-page');
        if (page) { page.style.transform = ''; page.style.transformOrigin = ''; page.style.width = ''; page.style.height = ''; }
      });
    }
    window.addEventListener('beforeprint', resetInlineStylesForPrint);
    window.addEventListener('afterprint', function(){ setTimeout(fitPagesToScreen, 50); });
    if (window.matchMedia) {
      var printMql = window.matchMedia('print');
      var onPrintChange = function(mql){ if (mql.matches) resetInlineStylesForPrint(); else setTimeout(fitPagesToScreen, 50); };
      if (printMql.addEventListener) printMql.addEventListener('change', onPrintChange);
      else if (printMql.addListener) printMql.addListener(onPrintChange);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(waitForImagesThenReady).catch(waitForImagesThenReady);
    } else {
      window.addEventListener('load', waitForImagesThenReady, { once: true });
    }
    waitForImagesThenReady();
  <\/script></body></html>`;
}

// ===== COMPUTE TRUE PDF PAGES =====
async function computeTruePDFPages(htmlOverride) {
  const rawHtml = htmlOverride !== undefined ? htmlOverride : (typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '');

  const offscreen = document.createElement('div');
  offscreen.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_LAYOUT.width}px;pointer-events:none;visibility:hidden;z-index:-1;`;
  document.body.appendChild(offscreen);

  const tempSource = document.createElement('div');
  tempSource.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(typeof sanitizeHTML === 'function' ? sanitizeHTML(rawHtml) : rawHtml) : rawHtml;
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(tempSource);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(tempSource);
  
  const topLevelNodes = typeof flattenContentTopLevelNodes === 'function' ? flattenContentTopLevelNodes(tempSource) : Array.from(tempSource.childNodes);

  const pageEls = [];
  const createPage = () => {
    const page = typeof createPDFMeasurePage === 'function' ? createPDFMeasurePage(offscreen) : null;
    if (page) {
      if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
      if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
      pageEls.push(page);
    }
    return page;
  };

  let currentPage = createPage();
  for (let i = 0; i < topLevelNodes.length; i++) {
    if (typeof appendNodeWithPagination === 'function') {
      currentPage = await appendNodeWithPagination(topLevelNodes[i], currentPage, createPage);
    }
    if (i % (typeof isMobilePreviewMode === 'function' && isMobilePreviewMode() ? 2 : 6) === 5) await new Promise(r => setTimeout(r, 0));
  }

  try { _keepHeadingsWithNext(pageEls); } catch (e) { console.warn('keep-with-next pass failed:', e); }

  for (const page of pageEls) {
    _pdfFitWideInlineMath(page);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(page);
    if (typeof waitForPDFLayoutStable === 'function') await waitForPDFLayoutStable(page);
    if (typeof shrinkPageToFit === 'function') {
      shrinkPageToFit(page);
    }
  }

  const pages = pageEls.map(el => ({
    el,
    html: _exportPageHTMLWithoutFitWrapper(el),
    overflow: typeof pageFits === 'function' ? !pageFits(el) : false,
    brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(el) : [],
    brokenDiagrams: typeof findBrokenDiagrams === 'function' ? findBrokenDiagrams(el) : []
  })).filter(p => {
    const clone = p.el.cloneNode(true);
    const footer = clone.querySelector('.page-footer-number');
    if (footer) footer.remove();
    const text = ((clone.innerText || clone.textContent || '')).replace(/\s+/g, ' ').trim();
    const hasVisual = !!clone.querySelector('img, svg, table, .katex-eq, .fc-wrapper, .figure-pro, .block-solution');
    let hasCanvasInk = false;
    const canvases = clone.querySelectorAll('canvas');
    for (const canvas of canvases) {
      if (_canvasHasVisibleInk(canvas)) { hasCanvasInk = true; break; }
    }
    const hasContent = text.length > 0 || hasVisual || hasCanvasInk;
    return hasContent;
  });

  return { offscreen, pages };
}

// A heading must never be the last thing on a page (its content would start on the next one).
function _pdfWrapperOf(page) { return (page && page.querySelector && page.querySelector('.pdf-fit-wrapper')) || page; }
function _keepHeadingsWithNext(pageEls) {
  const isHeading = (el) => !!el && el.nodeType === 1 && /^H[1-6]$/.test(el.tagName);
  for (let i = 0; i < pageEls.length - 1; i++) {
    const cur = _pdfWrapperOf(pageEls[i]), nxt = _pdfWrapperOf(pageEls[i + 1]);
    const isEmptyBlock = (el) => !!el && el.nodeType === 1 && !(el.textContent || '').trim() && !el.querySelector('img, svg, canvas, table, hr, .katex-eq');
    while (cur.lastElementChild && cur.children.length > 1 && isEmptyBlock(cur.lastElementChild)) cur.removeChild(cur.lastElementChild);
    const moved = [];
    while (cur.lastElementChild && isHeading(cur.lastElementChild) && cur.children.length > 1) {
      moved.unshift(cur.lastElementChild);
      cur.removeChild(cur.lastElementChild);
    }
    if (!moved.length) continue;
    const ref = nxt.firstChild;
    moved.forEach((h) => nxt.insertBefore(h, ref));
    if (!pageFits(pageEls[i + 1])) {            // the next page has no room: put them back
      moved.forEach((h) => h.remove());
      moved.forEach((h) => cur.appendChild(h));
    }
  }
}

function disposeTruePDFPages(result) {
  if (result && result.offscreen && result.offscreen.parentNode) {
    result.offscreen.parentNode.removeChild(result.offscreen);
  }
}

async function computeTruePDFPageChunks(options = {}) {
  const signature = options.signature || (typeof hashPDFPreviewSignature === 'function' ? hashPDFPreviewSignature() : '');
  if (options.allowCache !== false && _pdfLayoutCache.signature === signature && _pdfLayoutCache.chunks) {
    return _pdfLayoutCache.chunks;
  }
  const result = await computeTruePDFPages();
  try {
    if (typeof applyLocalMarginSafetyFixes === 'function') applyLocalMarginSafetyFixes(result);
    const chunks = result.pages.map(p => p.html);
    if (options.allowCache !== false) _pdfLayoutCache = { signature, chunks };
    return chunks;
  } finally {
    disposeTruePDFPages(result);
  }
}

// ===== WORD-LIKE PAGE FLOW: constants + continuation styles =====
// Safety band kept clear above the bottom margin. Layout can still grow a little AFTER a page is measured
// (Bengali shaping, equation sprites, font swaps), and that growth used to push the last lines into the
// bottom margin / page number. Raise it if text still gets too close to the footer, lower it to pack more in.
const PDF_BOTTOM_SAFETY = 12;

// A block (callout panel / equation panel / table) that is cut by a page break must look like ONE block:
// the open edge is flat, has no margin and no border, so the two halves join the way a Word table does.
const PDF_SPLIT_CONTINUATION_CSS = `
.pdf-split-next{margin-bottom:0 !important;border-bottom-left-radius:0 !important;border-bottom-right-radius:0 !important;border-bottom-width:0 !important;}
.pdf-split-prev{margin-top:0 !important;border-top-left-radius:0 !important;border-top-right-radius:0 !important;border-top-width:0 !important;}
.pdf-table-cont-next{margin-bottom:0 !important;}
.pdf-table-cont-prev{margin-top:0 !important;}
`;
(function _pdfInstallSplitStyles() {
  try {
    if (typeof document === 'undefined' || document.getElementById('pdf-split-continuation-css')) return;
    const st = document.createElement('style');
    st.id = 'pdf-split-continuation-css';
    st.textContent = PDF_SPLIT_CONTINUATION_CSS;
    (document.head || document.documentElement).appendChild(st);
  } catch (_) { /* cosmetic */ }
})();

// ===== PAGE MEASUREMENT HELPERS =====
function createPDFMeasurePage(offscreen) {
  const page = document.createElement('div');
  page.className = 'doc-page-canvas pdf-export-measure-page';
  page.style.setProperty('width', PDF_LAYOUT.width + 'px', 'important');
  page.style.setProperty('height', PDF_LAYOUT.height + 'px', 'important');
  page.style.setProperty('max-height', PDF_LAYOUT.height + 'px', 'important');
  page.style.setProperty('padding', `${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px`, 'important');
  page.style.setProperty('box-sizing', 'border-box', 'important');
  page.style.setProperty('overflow', 'hidden', 'important');
  page.style.setProperty('margin', '0', 'important');
  page.style.setProperty('position', 'relative', 'important');
  const _fmt = _pdfActiveFormatClass();
  if (_fmt) page.classList.add(_fmt);                                   // theme decides the page background
  else page.style.setProperty('background', '#fff', 'important');

  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-fit-wrapper';
  wrapper.style.setProperty('font-size', '100%', 'important');
  wrapper.style.setProperty('line-height', '1.6', 'important');
  // flow-root: the last block's bottom margin used to collapse OUT of the wrapper, so scrollHeight ignored it and
  // the page filled ~10-25px past the real bottom margin (text ended up almost touching the page number).
  wrapper.style.setProperty('display', 'flow-root', 'important');
  page.appendChild(wrapper);

  offscreen.appendChild(page);
  return page;
}

function pageFits(page) {
  if (!page) return false;
  const wrapper = page && page.querySelector ? page.querySelector('.pdf-fit-wrapper') : null;

  // IMPORTANT: the wrapper sits *inside* the page's own padding box, so its
  // scrollHeight is the content height only — it does NOT include the
  // page's top+bottom padding. Comparing that against the page's *full*
  // height (which already reserves ~120px for that padding) let content run
  // up to 120px taller than what actually fits inside the printable area.
  // The overflow then either got clipped by the page's overflow:hidden
  // (showing as missing text or a mostly-empty figure box) or spilled down
  // far enough to collide visually with the absolutely-positioned page
  // number footer. The fit check must use the available *content* height
  // (page height minus top/bottom padding), not the full page height.
  const pageHeight = wrapper
    ? (Number(PDF_LAYOUT.contentHeight) || 1003) - PDF_BOTTOM_SAFETY
    : (Number(PDF_LAYOUT.height) || 1123);

  // Prefer the wrapper content height whenever the exporter has already
  // normalized the page into the PDF preview fit shell. That height is the
  // same measurement view that the HTML preview and image PDF reuse, while
  // page.scrollHeight can include the stale page frame's hidden padding and
  // artificially report an overflow for a page that is otherwise fit.
  let measuredHeight = wrapper
    ? Number(wrapper.scrollHeight || wrapper.offsetHeight || wrapper.clientHeight || 0)
    : Number(page.scrollHeight || page.offsetHeight || page.clientHeight || 0);

  // Geometric double-check: where does the last block REALLY end (its bottom margin included)? scrollHeight can
  // under-report when a margin collapses through or a block is floated/positioned.
  if (wrapper && wrapper.lastElementChild) {
    try {
      const last = wrapper.lastElementChild;
      const wr = wrapper.getBoundingClientRect();
      const lr = last.getBoundingClientRect();
      if (lr.height || lr.width) {
        const mb = parseFloat(getComputedStyle(last).marginBottom) || 0;
        measuredHeight = Math.max(measuredHeight, Math.ceil(lr.bottom - wr.top + mb));
      }
    } catch (_) { /* fall back to scrollHeight */ }
  }

  return measuredHeight <= pageHeight + 1;
}

function _exportPageHTMLWithoutFitWrapper(pageEl) {
  if (!pageEl || typeof pageEl.querySelector !== 'function') return '';
  const wrapper = pageEl.querySelector('.pdf-fit-wrapper');
  if (wrapper) return wrapper.innerHTML;
  return pageEl.innerHTML;
}

// ===== MARGIN SAFETY FIXES =====
function applyLocalMarginSafetyFixes(result) {
  if (!result || !result.pages) return;
  for (let i = 0; i < result.pages.length; i++) {
    const p = result.pages[i];
    if (!p.overflow) {
      if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(p.el);
      p.html = _exportPageHTMLWithoutFitWrapper(p.el);
      continue;
    }
    const { extraPages } = typeof autoFitPageWithinMargins === 'function' ? autoFitPageWithinMargins(p.el, () => {
      const page = typeof createPDFMeasurePage === 'function' ? createPDFMeasurePage(result.offscreen) : null;
      return page;
    }) : { extraPages: [] };
    p.overflow = !pageFits(p.el);
    p.html = _exportPageHTMLWithoutFitWrapper(p.el);
    if (extraPages && extraPages.length) {
      const extraEntries = extraPages.map(el => ({
        el,
        html: _exportPageHTMLWithoutFitWrapper(el),
        overflow: !pageFits(el),
        brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(el) : []
      }));
      result.pages.splice(i + 1, 0, ...extraEntries);
    }
  }
}

// ===== SWITCH PREVIEW TAB =====
function switchPreviewTab(tabName) {
  // There is no A4 "document editor" view for a slide-deck tab — its own
  // editor IS the Slides view. Every "Editor" entry point (desktop tab
  // button, mobile nav button, setMobileView) used to hard-request
  // 'editor' unconditionally, which — while a slide deck was the active
  // tab's content — hid the slide editor and showed the (empty/wrong) A4
  // document view instead. Centralizing the redirect here means every
  // caller of switchPreviewTab('editor') is fixed at once: whenever the
  // active tab currently holds a real slide deck, an 'editor' request is
  // treated as a 'slides' request instead.
  if (tabName === 'editor' && window.APP_STATE && window.APP_STATE.slideDeck &&
      Array.isArray(window.APP_STATE.slideDeck.slides) && window.APP_STATE.slideDeck.slides.length) {
    tabName = 'slides';
  }

  const docView = document.getElementById('document-view-container');
  const pdfView = document.getElementById('pdf-view-container');
  const slideView = document.getElementById('slide-view-container');
  const main = document.getElementById('main-container');
  const toolbar = document.getElementById('editor-toolbar');
  const btnChat = document.getElementById('tab-chat-btn-desktop');
  const btnEditor = document.getElementById('tab-editor-btn');
  const btnPdf = document.getElementById('tab-pdf-btn');
  const btnEditorDesktop = document.getElementById('tab-editor-btn-desktop');
  const btnPdfDesktop = document.getElementById('tab-pdf-btn-desktop');
  const btnViewSlides = document.getElementById('view-slides-btn');

  if (btnChat) btnChat.classList.toggle('active', tabName === 'chat');
  if (btnEditor) btnEditor.classList.toggle('active', tabName === 'editor');
  if (btnPdf) btnPdf.classList.toggle('active', tabName === 'pdf');
  if (btnEditorDesktop) btnEditorDesktop.classList.toggle('active', tabName === 'editor');
  if (btnPdfDesktop) btnPdfDesktop.classList.toggle('active', tabName === 'pdf');
  if (btnViewSlides) btnViewSlides.classList.toggle('active', tabName === 'slides');

  const setDisplay = (el, display) => {
    if (el) el.style.setProperty('display', display, 'important');
  };

  if (main) {
    main.classList.remove('mobile-view-chat', 'mobile-view-editor', 'mobile-view-pdf', 'mobile-view-slides', 'desktop-view-chat', 'desktop-view-editor', 'desktop-view-pdf', 'desktop-view-slides');
    if (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout()) {
      main.classList.add('mobile-view-' + tabName);
      document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.classList.remove('active'));
      const mobBtn = document.getElementById('mob-btn-' + (tabName === 'slides' ? 'editor' : tabName));
      if (mobBtn) mobBtn.classList.add('active');
    } else {
      main.classList.add('desktop-view-' + tabName);
    }
  }

  if (tabName === 'chat') {
    if (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout()) {
      setDisplay(docView, 'none');
      setDisplay(toolbar, 'none');
      setDisplay(pdfView, 'none');
      setDisplay(slideView, 'none');
      return;
    }

    setDisplay(docView, 'flex');
    setDisplay(toolbar, 'flex');
    setDisplay(pdfView, 'none');
    setDisplay(slideView, 'none');
    return;
  }

  if (tabName === 'editor') {
    setDisplay(docView, 'flex');
    setDisplay(toolbar, 'flex');
    setDisplay(pdfView, 'none');
    setDisplay(slideView, 'none');
    const strayHost = document.getElementById('image-pdf-render-host');
    if (strayHost && strayHost.parentNode) strayHost.parentNode.removeChild(strayHost);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
        setTimeout(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); }, 150);
        setTimeout(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); }, 400);
      });
    }
    return;
  }

  if (tabName === 'slides') {
    setDisplay(docView, 'none');
    setDisplay(toolbar, 'none');
    setDisplay(pdfView, 'none');
    setDisplay(slideView, 'flex');
    if (typeof renderSlideDeckPreview === 'function') renderSlideDeckPreview(typeof APP_STATE !== 'undefined' ? APP_STATE.slideDeck : null);
    return;
  }

  {
    setDisplay(docView, 'none');
    setDisplay(toolbar, 'none');
    setDisplay(slideView, 'none');
    setDisplay(pdfView, 'flex');
    if (pdfView) {
      pdfView.style.flexDirection = 'column';
      pdfView.style.height = '100%';
      pdfView.style.overflowY = 'auto';
      pdfView.style.overflowX = 'hidden';
      pdfView.style.webkitOverflowScrolling = 'touch';
      const iframe = document.getElementById('pdf-iframe');
      if (iframe) {
        iframe.style.height = '100%';
        iframe.style.width = '100%';
        iframe.style.border = 'none';
        iframe.style.display = 'block';
        iframe.style.flex = '1 1 auto';
      }
    }
    const iframeForCheck = document.getElementById('pdf-iframe');
    const willReuseCache = iframeForCheck && (iframeForCheck.src || iframeForCheck.srcdoc) &&
      typeof hashPDFPreviewSignature === 'function' &&
      hashPDFPreviewSignature() === _pdfLastRenderedSignature &&
      ((document.body.classList.contains('dark') ? 'dark' : 'light') + '-' + (document.body.classList.contains('photocopy-mode') ? 'mono' : 'color')) === _pdfLastRenderedMode;
    const loadingEl = document.getElementById('pdf-preview-loading');
    if (loadingEl && !willReuseCache) {
      loadingEl.style.display = 'flex';
      loadingEl.classList.add('active');
      const statusEl = document.getElementById('pdf-preview-loading-status');
      if (statusEl) statusEl.textContent = '📄 Loading PDF preview...';
    }
    if (typeof generateLivePDFIframePreview === 'function') generateLivePDFIframePreview();
    _refitPDFIframeSoon();
    setTimeout(_refitPDFIframeSoon, 300);
    setTimeout(_refitPDFIframeSoon, 700);
  }
}

function _refitPDFIframeSoon() {
  const iframe = document.getElementById('pdf-iframe');
  if (!iframe) return;
  const isMobile = typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout();
  const tryRefit = () => {
    try {
      if (iframe.contentWindow && typeof iframe.contentWindow.fitPagesToScreen === 'function') {
        iframe.contentWindow.fitPagesToScreen();
      }
    } catch (_) { /* cross-origin or not ready yet — ignore */ }
  };
  // Fewer refits on mobile to improve performance
  const delays = isMobile ? [200, 600] : [120, 400, 900];
  delays.forEach(delay => setTimeout(tryRefit, delay));
}
if (!window.__pdfPanelResizeBound && typeof ResizeObserver === 'function') {
  window.__pdfPanelResizeBound = true;
  document.addEventListener('DOMContentLoaded', () => {
    const pdfView = document.getElementById('pdf-view-container');
    if (!pdfView) return;
    let lastW = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round((entries[0] && entries[0].contentRect && entries[0].contentRect.width) || 0);
      if (w > 0 && w !== lastW) {
        lastW = w;
        if (typeof _refitPDFIframeSoon === 'function') _refitPDFIframeSoon();
      }
    });
    ro.observe(pdfView);
  });
}

// ===== WAIT FOR LAYOUT STABLE =====
async function waitForPDFLayoutStable(container) {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch (_) {}
  if (typeof waitForImagesToLoad === 'function') await waitForImagesToLoad(container);
  if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(container);
  await (typeof nextFrame === 'function' ? nextFrame() : Promise.resolve());
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function waitForImagesToLoad(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return Promise.resolve();
  const imgs = Array.from(container.querySelectorAll('img'));
  return Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 2000);
    });
  }));
}

// ===== AUTO-FIT PAGE WITHIN MARGINS =====
function autoFitPageWithinMargins(pageEl, createContinuationPage, steps) {
  if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(pageEl);
  if (pageFits(pageEl)) return { fixed: true, extraPages: [] };
  if (typeof shrinkPageToFit === 'function' && shrinkPageToFit(pageEl, steps)) return { fixed: true, extraPages: [] };
  // Move whole trailing blocks (in order) to a continuation page. The old code went straight to
  // splitOversizedTableToFit, which pulled the LAST TABLE ROW onto a new page placed right after this one while the
  // paragraphs that followed the table stayed behind: wrong order, a duplicated header row and a nearly empty page.
  const spilled = _spillTrailingBlocks(pageEl, createContinuationPage);
  if (spilled.length) { if (typeof shrinkPageToFit === 'function') shrinkPageToFit(pageEl, steps); return { fixed: pageFits(pageEl), extraPages: spilled }; }
  const extraPages = typeof splitOversizedTableToFit === 'function' ? splitOversizedTableToFit(pageEl, createContinuationPage) : [];
  if (typeof shrinkPageToFit === 'function') shrinkPageToFit(pageEl, steps);
  return { fixed: pageFits(pageEl), extraPages };
}

function _spillTrailingBlocks(pageEl, createContinuationPage) {
  if (!createContinuationPage) return [];
  const wrapper = _pdfWrapperOf(pageEl);
  if (!wrapper || wrapper.children.length <= 1) return [];
  const queued = [];
  let guard = 0;
  while (!pageFits(pageEl) && wrapper.children.length > 1 && guard++ < 300) {
    const last = wrapper.lastElementChild;
    queued.unshift(last);
    wrapper.removeChild(last);
  }
  while (wrapper.lastElementChild && /^H[1-6]$/.test(wrapper.lastElementChild.tagName) && wrapper.children.length > 1) {
    const h = wrapper.lastElementChild;           // never leave a heading stranded at the bottom
    queued.unshift(h);
    wrapper.removeChild(h);
  }
  if (!queued.length) return [];
  const cont = createContinuationPage();
  if (!cont) { queued.forEach((q) => wrapper.appendChild(q)); return []; }
  const cw = ensurePageFitWrapper(cont);
  queued.forEach((q) => cw.appendChild(q));
  return [cont];
}

function shrinkPageToFit(pageEl, steps) {
  const wrapper = ensurePageFitWrapper(pageEl);
  const shrinkSteps = steps || [1, 11 / 12];
  for (const scale of shrinkSteps) {
    wrapper.style.fontSize = (scale * 100) + '%';
    wrapper.style.lineHeight = String(scale >= 0.99 ? 1.6 : 1.55);
    if (pageFits(pageEl)) return true;
  }
  // Text-only shrinking cannot help a figure/diagram: an <svg> with explicit
  // width/height attributes does not resize with font-size, so a large
  // AI-drawn figure that is taller than the page was previously left
  // overflowing and got silently clipped by the page's overflow:hidden —
  // this is what produced "an empty box with the rest of the figure
  // missing" in the exported PDF. Scale such visuals down to fit instead.
  if (typeof _fitOversizedVisualsToPage === 'function' && _fitOversizedVisualsToPage(pageEl)) {
    if (pageFits(pageEl)) return true;
  }
  return pageFits(pageEl);
}

// ===== SCALE DOWN OVERSIZED FIGURES/IMAGES SO THEY FIT WITHIN ONE PAGE =====
// AI-authored diagrams (.fc-svg-wrapper svg, .figure-frame svg/img) can come
// back taller than a single printable page. Because a figure must not be
// split across pages, the only safe option when it doesn't fit — even alone
// on an otherwise empty page — is to scale the whole figure down uniformly
// so it fits, rather than leaving it to overflow and get clipped (which
// previously showed as a mostly-empty box with the diagram content missing).
function _fitOversizedVisualsToPage(pageEl) {
  if (!pageEl) return false;
  const wrapper = pageEl.querySelector('.pdf-fit-wrapper') || pageEl;
  const targets = Array.from(wrapper.querySelectorAll('.fc-svg-wrapper svg, .figure-frame svg, .figure-frame img'));
  if (!targets.length) return false;

  const contentHeight = Number(PDF_LAYOUT.contentHeight) || 1003;
  let changed = false;

  targets.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (!rect.height || !rect.width) return;
    const wrapRect = wrapper.getBoundingClientRect();
    const usedAbove = Math.max(0, rect.top - wrapRect.top);
    // Leave a little breathing room below the figure for caption/margins.
    const available = Math.max(140, contentHeight - usedAbove - 16);
    if (rect.height <= available + 1) return;

    const scale = Math.max(0.3, Math.min(1, available / rect.height));
    if (el.tagName.toLowerCase() === 'svg') {
      const curW = parseFloat(el.getAttribute('width')) || rect.width;
      const curH = parseFloat(el.getAttribute('height')) || rect.height;
      el.setAttribute('width', Math.max(1, Math.round(curW * scale)));
      el.setAttribute('height', Math.max(1, Math.round(curH * scale)));
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('max-height', available + 'px', 'important');
    } else {
      el.style.setProperty('max-height', available + 'px', 'important');
      el.style.setProperty('width', 'auto', 'important');
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('object-fit', 'contain', 'important');
    }
    changed = true;
  });

  return changed;
}

function ensurePageFitWrapper(pageEl) {
  const existing = Array.from(pageEl.children).find(c => c.classList && c.classList.contains('pdf-fit-wrapper'));
  if (existing) return existing;
  const footer = Array.from(pageEl.children).find(c => c.classList && c.classList.contains('page-footer-number'));
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-fit-wrapper';
  wrapper.style.setProperty('display', 'flow-root', 'important');
  const toMove = Array.from(pageEl.childNodes).filter(n => n !== footer);
  toMove.forEach(n => wrapper.appendChild(n));
  pageEl.insertBefore(wrapper, footer || null);
  return wrapper;
}

function splitOversizedTableToFit(pageEl, createContinuationPage) {
  const newPages = [];
  if (!createContinuationPage) return newPages;
  const wrapper = Array.from(pageEl.children).find(c => c.classList && c.classList.contains('pdf-fit-wrapper')) || pageEl;
  const table = wrapper.querySelector('table');
  if (!table) return newPages;
  const thead = table.querySelector('thead');
  let headerRow = null;
  if (!thead) {
    const firstRow = table.querySelector('tr');
    if (firstRow && firstRow.querySelector('th')) headerRow = firstRow;
  }

  // Step 1: pull rows off the back of the source table (kept in original
  // order) until the source page itself fits.
  const queued = [];
  let guard = 0;
  while (!pageFits(pageEl) && guard < 300) {
    guard++;
    const rows = Array.from(table.querySelectorAll('tr')).filter(r => r !== headerRow && !r.closest('thead'));
    if (rows.length <= 1) break;
    const lastRow = rows[rows.length - 1];
    lastRow.remove();
    queued.unshift(lastRow);
  }
  if (!queued.length) return newPages;

  // Step 2: lay the queued rows onto continuation page(s), checking the
  // TARGET page's own fit as each row lands — not the source page's — so a
  // table spanning several pages gets one header per *actual* page instead
  // of a brand-new page + repeated header for almost every single row.
  let targetPage = null, targetTable = null;
  const newContinuationTable = () => {
    targetPage = createContinuationPage();
    newPages.push(targetPage);
    const targetWrapper = ensurePageFitWrapper(targetPage);
    targetTable = table.cloneNode(false);
    if (thead) targetTable.appendChild(thead.cloneNode(true));
    else if (headerRow) targetTable.appendChild(headerRow.cloneNode(true));
    targetWrapper.appendChild(targetTable);
  };
  newContinuationTable();

  for (const row of queued) {
    targetTable.appendChild(row);
    if (!pageFits(targetPage)) {
      // This row overflowed the current continuation page — move it to a
      // fresh one instead; that page genuinely needs its own header.
      targetTable.removeChild(row);
      newContinuationTable();
      targetTable.appendChild(row);
    }
  }
  return newPages;
}

// ===== splitPlainTextElement (FIXED: never flatten the paragraph to plain text) =====
// The old version did `el.textContent = words.join(' ')`, which threw away every inline child:
// KaTeX equations turned into "H+H^+H+" (MathML text + TeX annotation + HTML glyphs), and bold /
// italic / links / <sub> / <sup> were lost. A paragraph that does not fit the rest of the page is
// now moved to the next page AS IS (a deep clone), keeping all of its markup.
async function splitPlainTextElement(node, currentPage, createPage) {
    const hasText = !!((node.textContent || '').trim());
    const hasVisual = !!(node.querySelector && node.querySelector('img, svg, canvas, .katex-eq, .katex'));
    if (!hasText && !hasVisual) {
        return { page: currentPage, didSplit: false };
    }

    let page = currentPage;
    const prep = async (el) => {
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(el);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(el);
        await waitForImagesToLoad(el);
        if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(el);
    };

    // The current page is already over-full: start the paragraph on a fresh page.
    if (pageHasContent(page) && !pageFits(page)) {
        page = createPage();
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
    }

    const whole = node.cloneNode(true);
    whole.removeAttribute('contenteditable');
    whole.removeAttribute('spellcheck');
    appendToFitWrapper(page, whole);
    await prep(whole);

    // Fits cleanly: keep it here as one block.
    if (pageFits(page)) {
        return { page, didSplit: false };
    }

    // Does not fit: if the page already holds something else, move the whole block to a new page.
    if (whole.parentNode && page.querySelector('.pdf-fit-wrapper') && whole.parentNode.children.length > 1) {
        whole.remove();
        page = createPage();
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
        const moved = node.cloneNode(true);
        moved.removeAttribute('contenteditable');
        moved.removeAttribute('spellcheck');
        appendToFitWrapper(page, moved);
        await prep(moved);
        if (!pageFits(page) && typeof shrinkPageToFit === 'function') shrinkPageToFit(page);
        return { page, didSplit: true };
    }

    // Alone on an empty page and still too tall: shrink slightly instead of dropping anything.
    if (typeof shrinkPageToFit === 'function') shrinkPageToFit(page);
    return { page, didSplit: false };
}

// ===== appendNodeWithPagination =====
async function appendNodeWithPagination(node, currentPage, createPage) {
    if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent.trim()) return currentPage;
        const wrapper = document.createElement('p');
        wrapper.textContent = node.textContent.trim();
        const result = await splitPlainTextElement(wrapper, currentPage, createPage);
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(result.page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(result.page);
        return result.page;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return currentPage;
    if (node.classList && node.classList.contains('manual-page-break')) {
        return pageHasContent(currentPage) ? createPage() : currentPage;
    }

    if (/^(UL|OL)$/i.test(node.tagName)) {
        if (pageHasContent(currentPage) && !pageFits(currentPage)) currentPage = createPage();
        const result = await splitListElement(node, currentPage, createPage);
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(result.page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(result.page);
        return result.page;
    }

    const testClone2 = appendClone(currentPage, node);
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(testClone2);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(testClone2);
    await waitForImagesToLoad(testClone2);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(testClone2);

    if (pageFits(currentPage)) return currentPage;

    if (testClone2 && testClone2.parentNode) {
        testClone2.parentNode.removeChild(testClone2);
    }

    const childElements = Array.from(node.children || []);
    const hasOnlyText = childElements.length === 0;
    const hasOnlyInlineTextChildren = childElements.length > 0 &&
      childElements.every(el => /^(SPAN|EM|STRONG|A|B|I|U|SMALL|SUB|SUP|CODE)$/i.test(el.tagName));
    // Treat only actual text-bearing block containers as breakable text.
    // Generic DIV/SPAN wrappers can contain nested inline formatting and should
    // stay as one flow block instead of being force-fed through plain-text
    // word splitting, which creates the one-line-per-page fragmentation seen.
    const isBreakableText = /^(P|LI|BLOCKQUOTE|PRE|CODE)$/i.test(node.tagName) &&
      (hasOnlyText || hasOnlyInlineTextChildren);
    
    if (isBreakableText) {
        if (pageHasContent(currentPage) && !pageFits(currentPage)) currentPage = createPage();
        const result = await splitPlainTextElement(node, currentPage, createPage);
        return result.page;
    }

    if (childElements.length && !/^(IMG|SVG|CANVAS|TABLE|HR)$/i.test(node.tagName)) {
        if (pageHasContent(currentPage) && !pageFits(currentPage)) currentPage = createPage();
        const result = await splitChildFlowElement(node, currentPage, createPage);
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(result.page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(result.page);
        return result.page;
    }

    // TABLES flow across pages like in Word (header row repeated, rows never cut) instead of jumping whole to the
    // next page and leaving the rest of this page empty.
    {
        const _tinfo = typeof _pdfTableInfo === 'function' ? _pdfTableInfo(node) : null;
        if (_tinfo && _tinfo.table.rows && _tinfo.table.rows.length > 1) {
            const _fw0 = currentPage && currentPage.querySelector ? currentPage.querySelector('.pdf-fit-wrapper') : null;
            let _page = currentPage;
            const _nextCtx = () => {
                _page = createPage();
                if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(_page);
                if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(_page);
                return { page: _page, host: _page.querySelector('.pdf-fit-wrapper') || _page };
            };
            const _res = await _splitTableAcrossPages(_tinfo, { page: currentPage, host: _fw0 || currentPage }, _nextCtx);
            return _res.page;
        }
    }

    // FIX (blank / heading-only page): we only get here when this unsplittable block (heading, table,
    // image, hr, empty-child div ...) did NOT fit on the current page, and its test clone was removed
    // above. The old guard `pageHasContent && !pageFits` was therefore always false (the page "fit"
    // again after the removal), so the block was re-appended to the SAME page, overflowed it, and later
    // pages were created while this one stayed overfull. applyLocalMarginSafetyFixes() then spilled the
    // block onto a continuation page inserted BETWEEN pages -> a page with only a heading (page 2) and
    // a table pushed away from the text that followed it (pages 4/5). Start a new page right here instead.
    {
        const _fw = currentPage && currentPage.querySelector ? currentPage.querySelector('.pdf-fit-wrapper') : null;
        const _hasBlocks = _fw ? _fw.children.length > 0 : pageHasContent(currentPage);
        if (_hasBlocks) currentPage = createPage();
    }
    const finalClone = appendClone(currentPage, node);
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(finalClone);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(finalClone);
    await waitForImagesToLoad(finalClone);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(finalClone);

    if (!pageFits(currentPage)) {
        if (typeof shrinkPageToFit === 'function') {
            shrinkPageToFit(currentPage);
        }
    }

    return currentPage;
}

function appendToFitWrapper(page, child) {
    const wrapper = page && page.querySelector ? page.querySelector('.pdf-fit-wrapper') : null;
    if (wrapper) {
        wrapper.appendChild(child);
    } else {
        page.appendChild(child);
    }
    return child;
}

function appendClone(page, sourceNode) {
    const clone = sourceNode.cloneNode(true);
    return appendToFitWrapper(page, clone);
}

function cloneElementShell(node) {
    const shell = node.cloneNode(false);
    shell.removeAttribute('contenteditable');
    shell.removeAttribute('spellcheck');
    return shell;
}

// ===== TABLE SPLITTING (Word-like) =====
// A table is either the node itself or a <div> that holds nothing but that table.
function _pdfTableInfo(node) {
  if (!node || node.nodeType !== 1) return null;
  if (/^TABLE$/i.test(node.tagName)) return { outer: null, table: node };
  if (!/^(DIV|SECTION)$/i.test(node.tagName)) return null;
  const els = Array.from(node.children);
  if (els.length !== 1 || !/^TABLE$/i.test(els[0].tagName)) return null;
  const stray = Array.from(node.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim());
  return stray ? null : { outer: node, table: els[0] };
}

function _pdfPageHasBlocks(page) {
  const w = _pdfWrapperOf(page);
  if (!w) return false;
  return Array.from(w.children).some((c) => (c.textContent || '').trim() || (c.querySelector && c.querySelector('img, svg, canvas, table, hr, .katex-eq')));
}

// Lays a table onto `ctx.page` and continues on new pages (made by nextCtx) when the rows run out of room.
// Rows are never cut; the header row(s) repeat on every page; the pieces carry pdf-table-cont-* classes so they join.
async function _splitTableAcrossPages(info, ctx, nextCtx) {
  const { outer, table } = info;
  const allRows = Array.from(table.rows);
  let headRows = table.tHead ? Array.from(table.tHead.rows) : [];
  if (!headRows.length && allRows.length > 1 && allRows[0].cells.length && Array.from(allRows[0].cells).every((c) => c.tagName === 'TH')) headRows = [allRows[0]];
  const bodyRows = allRows.filter((r) => !headRows.includes(r));
  const colgroups = Array.from(table.children).filter((c) => /^COLGROUP$/i.test(c.tagName));

  const prep = async (el) => {
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(el);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(el);
    await waitForImagesToLoad(el);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(el);
  };

  let cur = ctx;
  const makeChunk = async (c) => {
    const holder = outer ? cloneElementShell(outer) : null;
    const t = table.cloneNode(false);
    colgroups.forEach((cg) => t.appendChild(cg.cloneNode(true)));
    if (headRows.length) {
      const th = document.createElement('thead');
      headRows.forEach((r) => th.appendChild(r.cloneNode(true)));
      t.appendChild(th);
    }
    const tb = document.createElement('tbody');
    t.appendChild(tb);
    if (holder) holder.appendChild(t);
    c.host.appendChild(holder || t);
    await prep(t);
    return { t, tb, el: holder || t, rows: 0 };
  };

  // nothing to split (header only / no body rows): behave like any other unsplittable block
  if (!bodyRows.length) {
    const whole = (outer || table).cloneNode(true);
    cur.host.appendChild(whole);
    await prep(whole);
    if (!pageFits(cur.page) && typeof shrinkPageToFit === 'function') shrinkPageToFit(cur.page);
    return cur;
  }

  let chunk = await makeChunk(cur);
  let pieces = 1;
  for (const row of bodyRows) {
    const rc = row.cloneNode(true);
    chunk.tb.appendChild(rc);
    await prep(rc);
    if (pageFits(cur.page)) { chunk.rows++; continue; }
    chunk.tb.removeChild(rc);

    if (chunk.rows === 0) {
      // not even ONE body row fits under what is already on this page
      chunk.el.remove();
      if (_pdfPageHasBlocks(cur.page)) {
        cur = nextCtx();                                  // start the table on a fresh page (with its header)
        chunk = await makeChunk(cur);
        if (pieces > 1) chunk.t.classList.add('pdf-table-cont-prev');
      } else {
        cur.host.appendChild(chunk.el);                   // empty page and the row is still too tall: keep it, shrink to fit
      }
      chunk.tb.appendChild(rc);
      await prep(rc);
      chunk.rows++;
      if (!pageFits(cur.page) && typeof shrinkPageToFit === 'function') shrinkPageToFit(cur.page);
      continue;
    }

    // this page is full: close the piece and continue on the next page, joined to it
    chunk.t.classList.add('pdf-table-cont-next');
    cur = nextCtx();
    chunk = await makeChunk(cur);
    pieces++;
    chunk.t.classList.add('pdf-table-cont-prev');
    chunk.tb.appendChild(rc);
    await prep(rc);
    chunk.rows++;
    if (!pageFits(cur.page) && typeof shrinkPageToFit === 'function') shrinkPageToFit(cur.page);
  }
  return cur;
}

async function splitListElement(node, currentPage, createPage) {
    const items = Array.from(node.children || []).filter(el => /^(LI)$/i.test(el.tagName));
    if (!items.length) return { page: currentPage, didSplit: false };

    let page = currentPage;
    let list = cloneElementShell(node);
    appendToFitWrapper(page, list);
    list.innerHTML = '';
    let didSplit = false;

    for (const item of items) {
        const itemClone = item.cloneNode(true);
        list.appendChild(itemClone);

        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(itemClone);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(itemClone);
        await waitForImagesToLoad(itemClone);
        if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(itemClone);

        // If this LI alone pushes the current list page over the real PDF page
        // height, move that LI to a brand new list page instead of trying to
        // carry an already-overflowing page state to the next page.
        if (!pageFits(page)) {
            list.removeChild(itemClone);
            if (!list.children.length && list.parentNode) list.parentNode.removeChild(list);   // do not leave an empty <ul> behind (it hid a stranded heading)
            page = createPage();
            if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
            if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);

            list = cloneElementShell(node);
            appendToFitWrapper(page, list);
            list.innerHTML = '';
            list.appendChild(itemClone);
            didSplit = true;
        }
    }

    return { page, didSplit };
}

async function splitChildFlowElement(node, currentPage, createPage) {
    const children = Array.from(node.childNodes || []);
    if (!children.length) return { page: currentPage, didSplit: false };

    let page = currentPage;
    let shell = cloneElementShell(node);
    appendToFitWrapper(page, shell);
    let didSplit = false;

    // Opens the next page + a fresh copy of this block. If the block already has content on the page we are
    // leaving, both halves are flagged so they join (flat edge, no margin, no rounded corner / border at the cut).
    const openNextPage = () => {
        const oldShell = shell;
        const hadContent = oldShell.childNodes.length > 0;
        if (!hadContent && oldShell.parentNode) oldShell.parentNode.removeChild(oldShell);   // never leave an empty shell behind
        page = createPage();
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
        shell = cloneElementShell(node);
        appendToFitWrapper(page, shell);
        if (hadContent) {
            oldShell.classList.add('pdf-split-next');
            shell.classList.add('pdf-split-prev');
        }
        didSplit = true;
        return { page, host: shell };
    };

    for (const child of children) {
        // a table inside this block flows over the page break instead of jumping to the next page as a whole
        const tinfo = child.nodeType === Node.ELEMENT_NODE && typeof _pdfTableInfo === 'function' ? _pdfTableInfo(child) : null;
        if (tinfo && tinfo.table.rows && tinfo.table.rows.length > 1) {
            await _splitTableAcrossPages(tinfo, { page, host: shell }, openNextPage);
            continue;
        }

        const childClone = child.cloneNode(true);
        shell.appendChild(childClone);
        if (childClone.nodeType === Node.ELEMENT_NODE) {
            if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(childClone);
            if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(childClone);
            await waitForImagesToLoad(childClone);
            if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(childClone);
        }
        if (!pageFits(page)) {
            shell.removeChild(childClone);
            openNextPage();
            shell.appendChild(childClone);
            // A figure/diagram can still be taller than a whole empty page.
            // It must not be split across pages, so scale it down to fit
            // instead of leaving it to overflow and get silently clipped.
            if (!pageFits(page) && typeof _fitOversizedVisualsToPage === 'function') {
                _fitOversizedVisualsToPage(page);
            }
        }
    }
    return { page, didSplit };
}

// ===== MENU: single "Download as PDF" entry (Image PDF option removed) =====
function _applyPDFMenuChanges() {
  try {
    const sel = 'button, a, li, [role="menuitem"], .dropdown-item, .menu-item, .export-option, [onclick], [data-action], [data-export]';
    document.querySelectorAll(sel).forEach((el) => {
      if (el.dataset && el.dataset.pdfMenuDone) return;
      const attrs = ((el.getAttribute('onclick') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('data-action') || '') + ' ' + (el.getAttribute('data-export') || '')).toLowerCase();
      const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ');
      const label = ((el.children.length ? own : el.textContent) || '').trim().toLowerCase();
      if (/exporttoimagepdf|image[-_ ]?pdf/.test(attrs) || /^image\s*pdf\b/.test(label)) { el.remove(); return; }
      if (/exporttohighqualitypdf|true[-_ ]?pdf/.test(attrs) || /^true\s*pdf\b/.test(label)) {
        el.dataset.pdfMenuDone = '1';
        let done = false;
        const walk = (n) => { n.childNodes.forEach((c) => {
          if (c.nodeType === 3 && /true\s*pdf/i.test(c.nodeValue)) { c.nodeValue = c.nodeValue.replace(/true\s*pdf[^\n]*/i, 'Download as PDF'); done = true; }
          else if (c.nodeType === 1) walk(c);
        }); };
        walk(el);
        if (!done && !el.children.length) el.textContent = 'Download as PDF';
        if (el.title && /true\s*pdf/i.test(el.title)) el.title = 'Download as PDF';
        if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Download as PDF');
      }
    });
  } catch (_) { /* cosmetic only */ }
}
(function watchPDFMenu() {
  const run = () => { _applyPDFMenuChanges(); try { new MutationObserver(() => _applyPDFMenuChanges()).observe(document.body, { childList: true, subtree: true }); } catch (_) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
})();

// ============================================================
// WINDOW EXPOSURE – PDF Export
// ============================================================
window.exportToHighQualityPDF = exportToHighQualityPDF;   // = "Export to PDF (slow)" (vector exporter)
window.exportToPDFSlow = exportToHighQualityPDF;
window.exportToPDFFast = exportToPDFFast;                 // = "Export to PDF (fast)" (native print engine)
window.exportToImagePDF = exportToImagePDF;
window.exportToWordDocumentLegacy = exportToWordDocumentLegacy;
// Safety net only: word-export.js loads after this file and replaces this with
// the native .docx exporter. If that file ever fails to load, the Word button
// still works via the legacy path instead of throwing a ReferenceError.
window.exportToWordDocument = window.exportToWordDocument || exportToWordDocumentLegacy;
window.generateLivePDFIframePreview = generateLivePDFIframePreview;
window.invalidatePDFPreviewCache = invalidatePDFPreviewCache;
window.hashPDFPreviewSignature = hashPDFPreviewSignature;
window.prepareDocumentForPDFPreview = prepareDocumentForPDFPreview;
window.buildUnifiedPDFPreviewDocument = buildUnifiedPDFPreviewDocument;
window.computeTruePDFPages = computeTruePDFPages;
window.disposeTruePDFPages = disposeTruePDFPages;
window.computeTruePDFPageChunks = computeTruePDFPageChunks;
window.createPDFMeasurePage = createPDFMeasurePage;
window.pageFits = pageFits;
window.applyLocalMarginSafetyFixes = applyLocalMarginSafetyFixes;
window.switchPreviewTab = switchPreviewTab;
window.waitForPDFLayoutStable = waitForPDFLayoutStable;
window.nextFrame = nextFrame;
window.waitForImagesToLoad = waitForImagesToLoad;
window.autoFitPageWithinMargins = autoFitPageWithinMargins;
window.shrinkPageToFit = shrinkPageToFit;
window._fitOversizedVisualsToPage = _fitOversizedVisualsToPage;
window.ensurePageFitWrapper = ensurePageFitWrapper;
window.splitOversizedTableToFit = splitOversizedTableToFit;
window.appendNodeWithPagination = appendNodeWithPagination;
window.appendClone = appendClone;
window.cloneElementShell = cloneElementShell;
window.splitPlainTextElement = splitPlainTextElement;
window.splitListElement = splitListElement;
window.splitChildFlowElement = splitChildFlowElement;
