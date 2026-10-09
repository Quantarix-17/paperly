// ========================================================================
// PDF EXPORT - True PDF (native print), Image PDF (rasterized), Word export,
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
  const container = document.getElementById('document-view-container');
  if (!container) return 'Document';
  const heading = container.querySelector('h1, h2, h3');
  if (heading && heading.innerText.trim() && !heading.innerText.includes('Start typing here')) {
    return heading.innerText.trim().replace(/[^a-zA-Z0-9\u0980-\u09FF\s_-]/g, '').trim().replace(/\s+/g, '_');
  }
  return 'Document';
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

// ===== TRUE PDF (NATIVE PRINT) =====
async function exportToHighQualityPDF(btn) {
  const pages = _collectRenderableEditorPages();
  if (!pages.length || (typeof docContainer !== 'undefined' && docContainer && docContainer.innerText && docContainer.innerText.includes('Start typing here'))) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ Document is empty.");
    return;
  }

  _setExportButtonBusy(btn, true, 'PDF');

  if (!_pdfCanUseNativePrint()) {
    _setExportButtonBusy(btn, false);
    if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ True PDF requires the browser Print / Save as PDF engine.');
    return;
  }

  await runPreExportLocalQualityPass();

  const pdfView = document.getElementById('pdf-view-container');
  const iframe = document.getElementById('pdf-iframe');
  if (!iframe || !pdfView) {
    _setExportButtonBusy(btn, false);
    if (typeof displayToastNotification === 'function') displayToastNotification('Error PDF preview frame is unavailable.');
    return;
  }

  const restorePdfViewStyle = pdfView.getAttribute('style');
  pdfView.style.cssText = (restorePdfViewStyle || '') +
    ';display:flex !important;position:fixed !important;left:-10000px !important;top:0 !important;' +
    `width:${window.innerWidth}px !important;height:${window.innerHeight}px !important;` +
    'visibility:visible !important;pointer-events:none !important;';

  let viewRestored = false;
  const restoreView = () => {
    if (viewRestored) return;
    viewRestored = true;
    if (restorePdfViewStyle === null) pdfView.removeAttribute('style');
    else pdfView.setAttribute('style', restorePdfViewStyle);
    _pdfLastRenderedSignature = '';
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
    _setExportButtonBusy(btn, false);
  };
  let printStartedAt = 0; // set when window.print() is actually invoked
  const restoreIfPrintDone = () => { if (printStartedAt && Date.now() - printStartedAt > 1500) restoreView(); };
  window.addEventListener('afterprint', restoreView, { once: true });
  window.addEventListener('focus', restoreIfPrintDone, { once: true });
  document.addEventListener('visibilitychange', function onVis() {
    if (!document.hidden && printStartedAt) { document.removeEventListener('visibilitychange', onVis); restoreIfPrintDone(); }
  });
  setTimeout(restoreView, 120000); // safety net only; afterprint normally restores

  let printReady = false;
  try {
    const signature = typeof hashPDFPreviewSignature === 'function' ? hashPDFPreviewSignature() : '';
    if (typeof prepareDocumentForPDFPreview === 'function') prepareDocumentForPDFPreview(signature);
    let pageChunks = typeof _collectRenderableEditorPages === 'function' ?
      _normalizePDFPageChunks(_collectRenderableEditorPages().map(_serializePageForPDF)) : [];
    if (!pageChunks.length && typeof computeTruePDFPageChunks === 'function') {
      pageChunks = _normalizePDFPageChunks(await computeTruePDFPageChunks({ signature, allowCache: true }));
    }
    const isDark = document.body.classList.contains('dark');
    const isMonochrome = document.body.classList.contains('photocopy-mode');
    const printHTML = typeof buildUnifiedPDFPreviewDocument === 'function' ?
      buildUnifiedPDFPreviewDocument(pageChunks, isMonochrome, isDark) :
      '';
    iframe.onload = null;
    iframe.removeAttribute('src');
    iframe.srcdoc = printHTML;
    printReady = true;
  } catch (printBuildError) {
    console.warn('True PDF print document build failed:', printBuildError);
    restoreView();
    if (typeof displayToastNotification === 'function') {
      displayToastNotification('Error True PDF preparation failed: ' + (printBuildError?.message || 'Unknown error') + '. Image PDF remains available separately.');
    }
    _setExportButtonBusy(btn, false);
    return;
  }

  let printed = false;
  let timeoutId = null;
  let messageHandler = null;
  let loadHandler = null;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (messageHandler) window.removeEventListener('message', messageHandler);
    if (loadHandler) iframe.removeEventListener('load', loadHandler);
  };

  const runPrint = () => {
    if (printed || !printReady) return;
    printed = true;
    cleanup();
    try {
      printStartedAt = Date.now();
      try { iframe.contentWindow.addEventListener('afterprint', restoreView, { once: true }); } catch (_) {}
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (error) {
      restoreView();
      if (typeof displayToastNotification === 'function') {
        displayToastNotification("Error True PDF print failed: " + (error?.message || 'Unknown error') + '. Image PDF remains available separately.');
      }
    }
  };

  messageHandler = (e) => {
    if (e.source === iframe.contentWindow && e.data === 'pdf-iframe-ready') runPrint();
  };
  loadHandler = () => setTimeout(() => { if (!printed) runPrint(); }, 10000); // fallback only; normal path = 'pdf-iframe-ready'

  window.addEventListener('message', messageHandler);
  iframe.addEventListener('load', loadHandler, { once: true });
  timeoutId = setTimeout(() => runPrint(), 15000);
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

  try {
    const libs = await ensurePDFRenderLibraries();
    _assertPDFRenderLibraries(libs, true);
    await runPreExportLocalQualityPass();

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

      _updateExportButtonProgress(btn, `${i + 1}/${pageList.length}`);
      const sourcePage = pageList[i].el;
      if (!sourcePage) throw new Error(`Page ${i + 1} has no renderable DOM.`);

      const canvas = await _renderImagePDFPage(sourcePage, renderHost, i + 1, _getPDFRenderScale());
      if (i > 0) pdf.addPage('a4', 'portrait');
      const imageData = canvas.toDataURL('image/jpeg', typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout() ? 0.84 : 0.90);
      pdf.addImage(imageData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      exportedPages++;

      canvas.width = 0;
      canvas.height = 0;
      renderHost.innerHTML = '';

      if (i < pageList.length - 1 && i % 2 === 1) await _yieldToBrowser();
    }

    if (!exportedPages) throw new Error('No pages were exported.');
    pdf.save(getDocumentTopicName() + '.pdf');
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
async function _renderImagePDFPage(sourcePage, host, pageNumber, requestedScale) {
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
    el.style.setProperty('background', '#fff', 'important');
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
    if (typeof waitForPDFLayoutStable === 'function') await waitForPDFLayoutStable(el);
    if (typeof prepareEquationsForPDF === 'function') prepareEquationsForPDF(el);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(el);
    if (typeof nextFrame === 'function') await nextFrame();
    if (typeof nextFrame === 'function') await nextFrame();
    const canvas = await window.html2canvas(el, {
      scale,
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
      onclone: (clonedDoc) => {
        const clonedEl = clonedDoc.querySelector('.doc-page-canvas');
        if (clonedEl) {
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
    return canvas;
  };

  const cloneForCapture = () => {
    const clone = sourcePage.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    clone.className = 'doc-page-canvas pdf-export-measure-page';
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
    try {
      const formatId = typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default';
      if (formatId && formatId !== 'default') classes.push('pdf-format-' + formatId);
    } catch (_) {}
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

  for (const page of pageEls) {
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
  page.style.setProperty('background', '#fff', 'important');

  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-fit-wrapper';
  wrapper.style.setProperty('font-size', '100%', 'important');
  wrapper.style.setProperty('line-height', '1.6', 'important');
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
    ? (Number(PDF_LAYOUT.contentHeight) || 1003)
    : (Number(PDF_LAYOUT.height) || 1123);

  // Prefer the wrapper content height whenever the exporter has already
  // normalized the page into the PDF preview fit shell. That height is the
  // same measurement view that the HTML preview and image PDF reuse, while
  // page.scrollHeight can include the stale page frame's hidden padding and
  // artificially report an overflow for a page that is otherwise fit.
  const measuredHeight = wrapper
    ? Number(wrapper.scrollHeight || wrapper.offsetHeight || wrapper.clientHeight || 0)
    : Number(page.scrollHeight || page.offsetHeight || page.clientHeight || 0);

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
  const extraPages = typeof splitOversizedTableToFit === 'function' ? splitOversizedTableToFit(pageEl, createContinuationPage) : [];
  if (typeof shrinkPageToFit === 'function') shrinkPageToFit(pageEl, steps);
  return { fixed: pageFits(pageEl), extraPages };
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

// ===== UPDATED splitPlainTextElement =====
async function splitPlainTextElement(node, currentPage, createPage) {
    const textContent = (node.textContent || '').trim();
    const words = textContent ? textContent.split(/\s+/).filter(Boolean) : [];
    if (!words.length) {
        return { page: currentPage, didSplit: false };
    }

    let page = currentPage;

    // If the block is paragraph/quote text and the current page already has
    // content but cannot contain this paragraph, move the whole paragraph to
    // the next generated page as a single semantic block. Never try a word
    // prefix, never try a one-token stack, and never create an empty page
    // just to satisfy a page boundary test.
    if (pageHasContent(page) && !pageFits(page)) {
        page = createPage();
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
    }

    const whole = cloneElementShell(node);
    appendToFitWrapper(page, whole);
    whole.textContent = words.join(' ');
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(whole);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(whole);
    await waitForImagesToLoad(whole);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(whole);

    // If the paragraph fits cleanly, keep it as one paragraph block.
    if (pageFits(page)) {
        return { page, didSplit: false };
    }

    // Otherwise, remove the candidate test block and preserve the exact
    // paragraph node on a new page as a whole block, avoiding the page
    // cap of "one line per page" due to oversplit remainder handling.
    whole.remove();
    page = createPage();
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);

    const moved = cloneElementShell(node);
    appendToFitWrapper(page, moved);
    moved.textContent = words.join(' ');
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(moved);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(moved);
    await waitForImagesToLoad(moved);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(moved);

    if (typeof shrinkPageToFit === 'function') {
        shrinkPageToFit(page);
    }

    return { page, didSplit: true };
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

    if (pageHasContent(currentPage) && !pageFits(currentPage)) currentPage = createPage();
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

    for (const child of children) {
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
            page = createPage();
            if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
            if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
            shell = cloneElementShell(node);
            appendToFitWrapper(page, shell);
            shell.appendChild(childClone);
            didSplit = true;
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

// ============================================================
// WINDOW EXPOSURE – PDF Export
// ============================================================
window.exportToHighQualityPDF = exportToHighQualityPDF;
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