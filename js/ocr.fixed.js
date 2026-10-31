// ========================================================================
// OCR PIPELINE - Local OCR for images and PDFs using Tesseract.js
// (fixed + faster revision)
// ========================================================================

let ocrWorkerPool = [];
let ocrWorkerPoolInitPromise = null;
let ocrPoolGeneration = 0;

// ===== SMALL SHARED HELPERS =====
function _figCfg(key, fallback) {
  const v = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG) ? APP_CONFIG[key] : undefined;
  return v === undefined ? fallback : v;
}
// numeric config that keeps legitimate 0 values and ignores NaN
function _ocrNum(key, fallback) {
  const v = Number(_figCfg(key, fallback));
  return Number.isFinite(v) ? v : fallback;
}
// safe cancellation check (the flag lives in another script and may not exist yet)
function _ocrCancelled() {
  try { return typeof isCancellationRequested !== 'undefined' && !!isCancellationRequested; } catch (_) { return false; }
}
function _ocrSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function _ocrTick() { return new Promise(resolve => setTimeout(resolve, 0)); } // let the UI breathe between heavy steps
function _ocrFreeCanvas(c) { try { if (c) { c.width = 0; c.height = 0; } } catch (_) {} }

// run fn over items with at most `limit` running at once
async function _ocrMapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: n }, run));
  return out;
}

function _ocrPoolTarget() {
  return Math.max(1, Math.min(4, Math.floor(_ocrNum('OCR_MAX_PARALLEL_WORKERS', 2)) || 2));
}

// ===== OCR WORKER MANAGEMENT =====
async function createConfiguredOcrWorker() {
  if (typeof Tesseract === 'undefined') throw new Error('OCR engine (Tesseract.js) is not loaded');
  const languageCandidates = [
    ['eng', 'ben'],
    'eng'
  ];
  let lastError = null;
  for (const langs of languageCandidates) {
    try {
      const worker = await Tesseract.createWorker(langs, 1, {
        logger: () => {},
        errorHandler: (e) => console.warn('Tesseract worker error:', e)
      });
      try {
        await worker.setParameters({
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
        });
      } catch (e) {
        console.warn('Tesseract parameter setup skipped:', e);
      }
      return worker;
    } catch (e) {
      lastError = e;
      console.warn('Tesseract worker initialization failed for', langs, e);
    }
  }
  throw new Error('OCR engine could not initialize' + (lastError?.message ? `: ${lastError.message}` : ''));
}

// Returns live slots. Dead slots (failed replacement) are dropped and rebuilt. Workers are created in parallel.
async function ensureOcrWorkerPool(size) {
  const target = Math.max(1, Math.min(size || 1, _ocrPoolTarget()));
  while (true) {
    const live = ocrWorkerPool.filter(s => s && !s.dead);
    if (live.length >= target) return live.slice(0, target);
    if (ocrWorkerPoolInitPromise) { await ocrWorkerPoolInitPromise; continue; }

    const generation = ocrPoolGeneration;
    ocrWorkerPoolInitPromise = (async () => {
      ocrWorkerPool = ocrWorkerPool.filter(s => s && !s.dead);
      const need = target - ocrWorkerPool.length;
      const settled = await Promise.allSettled(Array.from({ length: need }, () => createConfiguredOcrWorker()));
      let firstError = null;
      for (const r of settled) {
        if (r.status !== 'fulfilled') { firstError = firstError || r.reason; continue; }
        if (generation !== ocrPoolGeneration) {          // cancelled while starting -> do not keep it
          try { await r.value.terminate(); } catch (_) {}
          continue;
        }
        ocrWorkerPool.push({ worker: r.value, busy: false, dead: false, psm: null });
      }
      if (!ocrWorkerPool.some(s => s && !s.dead) && generation === ocrPoolGeneration) {
        throw firstError || new Error('OCR engine could not initialize');
      }
    })();
    try {
      await ocrWorkerPoolInitPromise;
    } finally {
      ocrWorkerPoolInitPromise = null;
    }
    const after = ocrWorkerPool.filter(s => s && !s.dead);
    if (after.length) return after.slice(0, target);
    if (_ocrCancelled()) throw new Error('OCR cancelled');
  }
}

// Take a free worker slot. Never spins forever: stops on cancellation or after maxWaitMs.
async function acquireOcrSlot(maxWaitMs) {
  const deadline = Date.now() + (maxWaitMs || 180000);
  while (true) {
    if (_ocrCancelled()) throw new Error('OCR cancelled');
    await ensureOcrWorkerPool(_ocrPoolTarget());
    const slot = ocrWorkerPool.find(s => s && !s.busy && !s.dead);
    if (slot) { slot.busy = true; return slot; } // find + flag happen in the same tick
    if (Date.now() > deadline) throw new Error('Timed out waiting for a free OCR worker');
    await _ocrSleep(20);
  }
}

async function terminateOcrWorkersForCancellation() {
  try {
    ocrPoolGeneration++;
    const pool = Array.isArray(ocrWorkerPool) ? ocrWorkerPool.slice() : [];
    ocrWorkerPool = [];
    await Promise.all(pool.map(async (slot) => {
      try {
        if (!slot) return;
        slot.dead = true;
        if (slot.worker && typeof slot.worker.terminate === 'function') await slot.worker.terminate();
      } catch (e) {}
    }));
  } catch (e) {}
}

async function replaceTimedOutOcrWorker(slot) {
  if (!slot) return;
  const old = slot.worker;
  slot.dead = true;          // unusable until a replacement exists
  slot.psm = null;
  try {
    if (old && typeof old.terminate === 'function') await old.terminate();
  } catch (e) {
    console.warn('Failed to terminate timed-out OCR worker:', e);
  }
  if (_ocrCancelled() || ocrWorkerPool.indexOf(slot) < 0) { slot.worker = null; return; } // pool was torn down meanwhile
  try {
    slot.worker = await createConfiguredOcrWorker();
    slot.dead = false;
  } catch (e) {
    console.error('Could not replace OCR worker:', e);
    slot.worker = null;      // stays dead; ensureOcrWorkerPool will rebuild it for later callers
  }
}

// setParameters only when the page-seg mode actually changes; tolerate params a Tesseract build rejects
async function _ocrSetPsm(slot, psm) {
  if (slot.psm === psm) return;
  const attempts = [
    { tessedit_pageseg_mode: psm, preserve_interword_spaces: '1', user_defined_dpi: '300' },
    { tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' },
    { tessedit_pageseg_mode: psm }
  ];
  for (const p of attempts) {
    try { await slot.worker.setParameters(p); slot.psm = psm; return; } catch (_) {}
  }
  slot.psm = null;
}

// ===== OCR IMAGE PREPROCESSING (single shared engine) =====
function _ocrOtsu(hist, total) {
  if (!total) return 128;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, maxVar = -1, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; t = i; }
  }
  return t;
}

function _ocrBuildLut(mode, profile, mean, std, hist, total) {
  const lut = new Uint8ClampedArray(256); // clamps + rounds for us
  const src = profile === 'source';
  if (mode === 'threshold') {
    const t = _ocrOtsu(hist, total);
    for (let g = 0; g < 256; g++) lut[g] = g <= t ? 0 : 255;
  } else if (mode === 'inverted') {
    const gain = src ? (std < 50 ? 1.15 : 1.0) : 1.2;
    for (let g = 0; g < 256; g++) lut[g] = (255 - g - 128) * gain + 128;
  } else if (mode === 'soft') {
    const gain = src ? 1.18 : (std < 45 ? 1.35 : 1.12);
    const off = src ? 135 : 132;
    for (let g = 0; g < 256; g++) lut[g] = (g - mean) * gain + off;
  } else if (mode === 'fixed') {
    for (let g = 0; g < 256; g++) lut[g] = (g - 128) * 1.28 + 132;
  } else { // 'base'
    const gain = src ? (std < 34 ? 1.55 : std < 50 ? 1.25 : 1.08) : 1.15;
    const off = src ? 128 : 132;
    for (let g = 0; g < 256; g++) lut[g] = (g - mean) * gain + off;
  }
  return lut;
}

// grayscale + histogram in one pass, mean/std from the histogram, then one lookup-table pass
function _ocrPreprocessInPlace(canvas, mode, profile) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const n = data.length >> 2;
    if (!n) return canvas;
    const gray = new Uint8Array(n);
    const hist = new Uint32Array(256);
    for (let p = 0, j = 0; j < n; p += 4, j++) {
      const g = (77 * data[p] + 150 * data[p + 1] + 29 * data[p + 2]) >> 8;
      gray[j] = g;
      hist[g]++;
    }
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    const mean = sum / n;
    let variance = 0;
    for (let i = 0; i < 256; i++) { const d = i - mean; variance += hist[i] * d * d; }
    const std = Math.sqrt(variance / n);
    const lut = _ocrBuildLut(mode, profile, mean, std, hist, n);
    for (let p = 0, j = 0; j < n; p += 4, j++) {
      const v = lut[gray[j]];
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (e) {
    console.warn('OCR preprocessing skipped:', e);
  }
  return canvas;
}

function createOcrCanvasFromImage(img, scale = 1, mode = 'base', rotateDeg = 0) {
  const naturalW = Math.max(1, img.naturalWidth || img.width || 1);
  const naturalH = Math.max(1, img.naturalHeight || img.height || 1);
  const baseScale = Math.max(0.5, Math.min(4.0, scale));
  let w = Math.max(1, Math.round(naturalW * baseScale));
  let h = Math.max(1, Math.round(naturalH * baseScale));

  const maxPixels = _ocrNum('OCR_MAX_IMAGE_PIXELS', 18000000);
  const pixels = w * h;
  if (pixels > maxPixels) {
    const factor = Math.sqrt(maxPixels / pixels);
    w = Math.max(1, Math.floor(w * factor));
    h = Math.max(1, Math.floor(h * factor));
  }

  const angle = ((rotateDeg % 360) + 360) % 360;
  const canvas = document.createElement('canvas');
  if (angle === 90 || angle === 270) {
    canvas.width = h;
    canvas.height = w;
  } else {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (angle === 90) {
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
  } else if (angle === 180) {
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
  } else if (angle === 270) {
    ctx.translate(0, w);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();

  return _ocrPreprocessInPlace(canvas, mode, 'source');
}

function preprocessCanvasForOcr(canvas) {
  return _ocrPreprocessInPlace(canvas, 'fixed', 'variant');
}

function createOcrVariantFromCanvas(sourceCanvas, mode = 'base') {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
  return _ocrPreprocessInPlace(canvas, mode, 'variant');
}

// Plain rotation of an already prepared canvas (NO second preprocessing). Optionally downsized for speed.
function _ocrRotateCanvas(src, angle, maxLongEdge) {
  const k = Math.min(1, (maxLongEdge || 1e9) / Math.max(1, Math.max(src.width, src.height)));
  const w = Math.max(1, Math.round(src.width * k));
  const h = Math.max(1, Math.round(src.height * k));
  const swap = angle === 90 || angle === 270;
  const c = document.createElement('canvas');
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  if (angle === 90) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
  else if (angle === 180) { ctx.translate(w, h); ctx.rotate(Math.PI); }
  else if (angle === 270) { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(src, 0, 0, w, h);
  ctx.restore();
  return c;
}

// ===== OCR RECOGNITION WITH TIMEOUT =====
async function recognizeWithTimeout(worker, canvas, timeoutMs) {
  const timeout = Math.max(3000, Number(timeoutMs) || 15000);
  let timer = null;
  const job = worker.recognize(canvas);
  job.catch(() => {}); // a late rejection (after timeout / terminate) must not become an unhandled rejection
  try {
    return await Promise.race([
      job,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`OCR recognition timeout after ${Math.round(timeout / 1000)}s`)), timeout);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// big canvases legitimately need longer; avoids killing (and rebuilding) workers for no reason
function _ocrScaledTimeout(baseMs, canvas) {
  const mp = ((canvas && canvas.width) || 0) * ((canvas && canvas.height) || 0) / 2e6;
  return Math.round(baseMs * Math.min(6, Math.max(1, mp)));
}

async function _ocrRecognizeOnce(slot, canvas, psm, timeoutMs) {
  if (!slot || slot.dead || !slot.worker) throw new Error('OCR worker unavailable');
  await _ocrSetPsm(slot, psm);
  const { data } = await recognizeWithTimeout(slot.worker, canvas, timeoutMs);
  const text = (data && data.text) ? data.text.trim() : '';
  return {
    text,
    confidence: (data && typeof data.confidence === 'number') ? data.confidence : 0,
    lineCount: getOcrLineCount(text)
  };
}

// ===== OCR LINE NORMALIZATION =====
function normalizeOcrLineText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[|¦]/g, 'i');
}

function getOcrLineCount(text) {
  return String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean).length;
}

function mergeOcrCandidates(primary, secondary) {
  const primaryText = String(primary?.text || '').trim();
  const secondaryText = String(secondary?.text || '').trim();
  if (!primaryText) return secondary || { text: '', confidence: 0 };
  if (!secondaryText) return primary || { text: '', confidence: 0 };

  const primaryLines = primaryText.split(/\n+/).map(normalizeOcrLineText).filter(Boolean);
  const seen = new Set(primaryLines);
  const primaryNorm = primaryLines.join('\n');
  const extras = [];
  for (const line of secondaryText.split(/\n+/)) {
    const n = normalizeOcrLineText(line);
    if (!n || seen.has(n)) continue;
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
    if (primaryNorm.includes(n)) continue;   // fragment of a line we already have (sparse modes split lines)
    seen.add(n);
    extras.push(line.trim());
  }
  const mergedText = extras.length ? `${primaryText}\n${extras.join('\n')}` : primaryText;
  return {
    text: mergedText,
    confidence: Math.max(primary.confidence || 0, secondary.confidence || 0),
    lineCount: getOcrLineCount(mergedText)
  };
}

// ===== RECOGNIZE IMAGE WITH OCR =====
// opts: { maxPasses, allowRotation }  (figure crops use maxPasses:2, allowRotation:false for speed)
async function recognizeImageWithOcr(imageSource, opts = {}) {
  const slot = await acquireOcrSlot();
  try {
    const candidates = [];
    const allowRotation = opts.allowRotation !== false && _figCfg('OCR_ROTATION_RECOVERY', true) !== false;
    const allPasses = [
      { psm: '6', mode: 'base' },
      { psm: '11', mode: 'soft' },
      { psm: '12', mode: 'threshold' },
      { psm: '7', mode: 'base' }
    ].slice(0, Math.max(1, _ocrNum('OCR_HIGH_ACCURACY_PASSES', 4)));
    const maxTotalPasses = Math.max(1, Math.min(
      Math.max(1, _ocrNum('OCR_MAX_TOTAL_PASSES', allPasses.length)),
      opts.maxPasses || 99
    ));
    const triagePasses = Math.max(1, Math.min(_ocrNum('OCR_FAST_TRIAGE_PASSES', 2), allPasses.length, maxTotalPasses));
    const triageTimeout = Math.max(1200, _ocrNum('OCR_FAST_TRIAGE_TIMEOUT_MS', 2200));
    const deepTimeout = Math.max(2500, _ocrNum('OCR_PASS_TIMEOUT_MS', 5000));
    const minConfSingle = _ocrNum('OCR_MIN_CONFIDENCE_FOR_SINGLE_PASS', 82);
    let attempts = 0;

    const runPass = async (pass, canvas, baseTimeout, group) => {
      attempts++;
      try {
        const cand = await _ocrRecognizeOnce(slot, canvas, pass.psm, _ocrScaledTimeout(baseTimeout, canvas));
        // text read from a rotated copy only counts when it is believable (wrong rotation yields gibberish)
        if (cand.text && (group === 0 || cand.confidence >= 40)) { cand.group = group; candidates.push(cand); }
        return cand;
      } catch (err) {
        console.warn(`OCR pass ${pass.psm}/${pass.mode || 'rot' + group} failed:`, err);
        if (/timeout/i.test(String(err && err.message || ''))) await replaceTimedOutOcrWorker(slot);
        return null;
      }
    };
    const scoreOf = (c) => (c.confidence || 0) + Math.min(35, Math.log1p((c.text || '').length) * 2.2);
    const stop = () => slot.dead || _ocrCancelled();

    // ---- FAST TRIAGE ----
    for (let i = 0; i < triagePasses && attempts < maxTotalPasses && !stop(); i++) {
      const pass = allPasses[i];
      let cv = imageSource, own = false;
      if (!(i === 0 && pass.mode === 'base')) { await _ocrTick(); cv = createOcrVariantFromCanvas(imageSource, pass.mode); own = true; }
      const cand = await runPass(pass, cv, triageTimeout, 0);
      if (own) _ocrFreeCanvas(cv);
      if (cand && cand.text && cand.confidence >= minConfSingle && cand.lineCount >= 3) {
        return { text: cand.text, confidence: cand.confidence || 0, passes: attempts, lineCount: cand.lineCount, skipped: false };
      }
    }

    // ---- DEEP PASSES (only when triage saw some text) ----
    if (candidates.length) {
      for (let i = triagePasses; i < allPasses.length && attempts < maxTotalPasses && !stop(); i++) {
        const pass = allPasses[i];
        await _ocrTick();
        const cv = createOcrVariantFromCanvas(imageSource, pass.mode);
        await runPass(pass, cv, deepTimeout, 0);
        _ocrFreeCanvas(cv);
      }
    }

    // ---- ROTATION RECOVERY (runs for weak AND for empty results: sideways scans return nothing upright) ----
    const upright = candidates.filter(c => c.group === 0).sort((a, b) => scoreOf(b) - scoreOf(a));
    const bestUp = upright[0] || null;
    const needRotation = allowRotation && !stop() && (!bestUp || bestUp.confidence < 55 || bestUp.lineCount < 2);
    if (needRotation) {
      const rotLimit = Math.max(0, _ocrNum('OCR_ROTATION_PASSES', 2));
      const rotEdge = Math.max(1200, _ocrNum('OCR_ROTATION_MAX_LONG_EDGE', 2600));
      let tried = 0;
      for (const angle of [90, 270]) {
        if (tried >= rotLimit || stop()) break;
        tried++;
        let rc = null;
        try {
          await _ocrTick();
          rc = _ocrRotateCanvas(imageSource, angle, rotEdge);
          const cand = await runPass({ psm: '6' }, rc, deepTimeout, angle);
          if (cand && cand.confidence >= 60 && cand.lineCount >= 3) break; // good enough, skip the other direction
        } finally {
          _ocrFreeCanvas(rc);
        }
      }
    }

    if (!candidates.length) {
      return {
        text: '', confidence: 0, passes: attempts,
        lineCount: 0, skipped: true, reason: 'no_text',
        skipReason: 'No readable text detected after bounded OCR attempts; region skipped.'
      };
    }

    // ---- pick the best orientation group, merge only inside that group ----
    const groups = new Map();
    for (const c of candidates) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    }
    let bestList = null, bestScore = -Infinity;
    for (const [g, list] of groups) {
      list.sort((a, b) => scoreOf(b) - scoreOf(a));
      const s = scoreOf(list[0]) + (g === 0 ? 8 : 0); // small bias: do not flip orientation on a tie
      if (s > bestScore) { bestScore = s; bestList = list; }
    }
    let merged = bestList[0];
    for (let i = 1; i < bestList.length; i++) {
      const c = bestList[i];
      if ((c.confidence || 0) >= 35 || ((c.text || '').length > 25 && (c.confidence || 0) >= 20)) {
        merged = mergeOcrCandidates(merged, c);
      }
    }
    return {
      text: merged.text,
      confidence: merged.confidence || 0,
      passes: attempts,
      lineCount: merged.lineCount || getOcrLineCount(merged.text),
      skipped: false
    };
  } finally {
    slot.busy = false;
  }
}

// ===== GEMINI VISION OCR FALLBACK =====
// Used ONLY when the default local pipeline (Tesseract / pdf.js text layer) fails to
// read a file. Everything stays local-first; an API call is spent only on the rare
// page/image the local engine can't handle. Set APP_CONFIG.VISION_FALLBACK_ENABLED = false
// to guarantee that nothing is ever uploaded.
const GEMINI_VISION_OCR_PROMPT =
  'You are an OCR engine. Transcribe every piece of readable text in this image exactly ' +
  'as written, preserving line breaks, bullet points, and reading order. Write any ' +
  'mathematical expressions using LaTeX wrapped in $$...$$. Do not add commentary, ' +
  'headers, or explanations of your own — output only the transcribed content. If the ' +
  'image genuinely has no readable text, respond with exactly: [NO_TEXT_FOUND]';

function _parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl || ''));
  if (!match) return null;
  return { mimeType: match[1], base64Data: match[2] };
}

async function callGeminiVisionForOCR(cfg, base64Data, mimeType, promptText, signal) {
  // The API key goes in a header, never in the URL (URLs end up in history, proxy logs, devtools).
  const baseUrl = String(cfg.apiUrl || '')
    .replace(/([?&])key=[^&]*&?/i, '$1')
    .replace(/[?&]$/, '');
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: promptText || GEMINI_VISION_OCR_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64Data } }
      ]
    }],
    generationConfig: { temperature: 0 }
  };
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify(body),
    signal: signal || undefined
  });
  if (!response.ok) {
    let detail = '';
    try { const j = await response.json(); detail = j.error?.message || JSON.stringify(j); }
    catch (_) { try { detail = await response.text(); } catch (_2) {} }
    throw new Error(`Gemini Vision OCR error (${response.status}): ${detail || 'no further details returned'}`);
  }
  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').trim();
  if (!text || /^\[NO_TEXT_FOUND\]$/i.test(text)) return '';
  return text;
}

function getVisionFallbackModelCandidates() {
  const state = (typeof AI_MODELS_STATE !== 'undefined') ? AI_MODELS_STATE : null;
  const models = Array.isArray(state?.models) ? state.models : [];
  if (!models.length) return [];

  const active = typeof getActiveAIModel === 'function' ? getActiveAIModel() : null;
  const ordered = [];
  if (active) ordered.push(active);

  for (const model of models) {
    if (!ordered.some(m => m.id === model.id)) ordered.push(model);
  }

  return ordered.filter(model => model && (model.apiType === 'gemini' || model.apiType === 'openai'));
}

async function callVisionModelForOCR(cfg, dataUrl, label, promptText, signal) {
  const parsed = _parseDataUrl(dataUrl);
  if (!parsed) return '';

  if (cfg?.apiType === 'gemini') {
    return await callGeminiVisionForOCR(cfg, parsed.base64Data, parsed.mimeType, promptText, signal);
  }

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: promptText || GEMINI_VISION_OCR_PROMPT },
      { type: 'image_url', image_url: { url: dataUrl } }
    ]
  }];

  if (typeof callAIAPIRaw !== 'function') {
    throw new Error('AI vision OCR model driver is unavailable because the raw AI caller is not loaded.');
  }

  const result = await callAIAPIRaw(messages, {
    forceJson: false,
    modelConfig: cfg,
    bypassThinkingCooldown: true
  });

  const text = String(result?.content || '').trim();
  if (!text || /^\[NO_TEXT_FOUND\]$/i.test(text)) return '';
  return text;
}

// ---- AI vision step: ONE attempt per configured model, then give up ----------------
// Rules (so OCR can always finish):
//   * every model is tried exactly once, one after the other (a failure -> next model)
//   * every attempt has a time limit; a hanging request counts as a failure
//   * a model that answers "no text here" is a real answer -> the other models are not asked again
//   * calls run one at a time
//   * a model that fails VISION_MODEL_MAX_FAILS times in a row is skipped for the rest of the run
//   * if EVERY model failed with an error, vision is switched off for a while (VISION_BREAKER_MS)
let _visionChain = Promise.resolve();
const _visionBreaker = { until: 0, notified: false };
const _visionModelFails = new Map();

function resetVisionBreaker() { _visionBreaker.until = 0; _visionBreaker.notified = false; _visionModelFails.clear(); }
window.resetVisionBreaker = resetVisionBreaker;

function _visionBreakerActive() { return Date.now() < _visionBreaker.until; }
function _visionModelKey(cfg) { return String((cfg && (cfg.id || cfg.modelId || cfg.name)) || 'model'); }

async function _callVisionModelOnce(cfg, dataUrl, label, promptText, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch (_) {}
      reject(new Error(`AI vision timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });
  const call = callVisionModelForOCR(cfg, dataUrl, label, promptText, controller.signal);
  call.catch(() => {}); // aborted request rejecting after the timeout won the race
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function _runVisionPass(dataUrl, label, promptText) {
  if (_figCfg('VISION_FALLBACK_ENABLED', true) === false) return '';
  if (_visionBreakerActive()) return '';
  const all = getVisionFallbackModelCandidates();
  if (!all.length) return '';
  const maxFails = Math.max(1, _ocrNum('VISION_MODEL_MAX_FAILS', 3));
  const models = all.filter(m => (_visionModelFails.get(_visionModelKey(m)) || 0) < maxFails);
  const timeoutMs = Math.max(5000, _ocrNum('VISION_MODEL_TIMEOUT_MS', 30000));
  const stopOnEmpty = _figCfg('VISION_STOP_ON_EMPTY_ANSWER', true) !== false;
  let failed = 0;
  let answered = false;
  for (const cfg of models) {
    if (_ocrCancelled()) return '';
    const key = _visionModelKey(cfg);
    try {
      const text = await _callVisionModelOnce(cfg, dataUrl, label, promptText, timeoutMs);
      _visionModelFails.set(key, 0);
      if (text && String(text).trim()) return text;
      answered = true;                 // the model worked and found no text
      if (stopOnEmpty) return '';
    } catch (err) {
      failed++;
      _visionModelFails.set(key, (_visionModelFails.get(key) || 0) + 1);
      console.warn(`AI vision: "${cfg?.name || cfg?.modelId || 'model'}" failed${label ? ` for ${label}` : ''} — trying the next model:`, err && err.message ? err.message : err);
    }
  }
  if (!answered && failed >= models.length) {
    _visionBreaker.until = Date.now() + Math.max(10000, _ocrNum('VISION_BREAKER_MS', 120000));
    if (!_visionBreaker.notified) {
      _visionBreaker.notified = true;
      console.warn('AI vision: all models failed — skipping AI vision for the rest of this run.');
      if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ AI vision failed on every model — skipping it and moving on.');
    }
  }
  return '';
}

function runGeminiVisionOCRFromDataUrl(dataUrl, label, promptText) {
  const job = _visionChain.then(() => _runVisionPass(dataUrl, label, promptText));
  _visionChain = job.catch(() => {});
  return job;
}

// ===== RUN OCR ON IMAGE FILE =====
async function runOcrOnImageFile(file) {
  let dataUrlPromise = null;
  const getDataUrl = () => dataUrlPromise || (dataUrlPromise = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  }));

  if (_figCfg('SCANNED_PAGE_POLICY', 'ocr-then-image') === 'image-only') {
    const tok = await _keepImageFileAsImage(await getDataUrl());
    if (tok) return { text: tok, confidence: 0, skipped: false, keptAsImage: true, figureTokens: [tok] };
  }

  // decode through an object URL: no giant base64 string unless a fallback really needs one
  const objUrl = URL.createObjectURL(file);
  let canvas = null, cleanCanvas = null;
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode the image file'));
      image.src = objUrl;
    });

    const longEdge = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
    const targetLongEdge = _ocrNum('OCR_TARGET_LONG_EDGE', 4200);
    const scale = Math.min(3.2, Math.max(1, targetLongEdge / Math.max(1, longEdge)));
    canvas = createOcrCanvasFromImage(img, scale, 'base', 0);
    let result = await recognizeImageWithOcr(canvas);

    const isWeakOcrResult = (candidate) => {
      const text = String(candidate?.text || '').trim();
      const confidence = Number(candidate?.confidence) || 0;
      const lineCount = Number(candidate?.lineCount) || getOcrLineCount(text);
      return !text || (confidence < 50 && lineCount < 2);
    };
    const hasText = (r) => !!String(r && r.text || '').trim();

    if (hasText(result) && !isWeakOcrResult(result)) return result;

    // weak (but non-empty) result: one retry on the un-preprocessed picture
    if (hasText(result) && !_ocrCancelled()) {
      try {
        cleanCanvas = document.createElement('canvas');
        cleanCanvas.width = canvas.width;
        cleanCanvas.height = canvas.height;
        const cleanCtx = cleanCanvas.getContext('2d');
        cleanCtx.fillStyle = '#ffffff';
        cleanCtx.fillRect(0, 0, cleanCanvas.width, cleanCanvas.height);
        cleanCtx.drawImage(img, 0, 0, cleanCanvas.width, cleanCanvas.height);
        const retry = await recognizeImageWithOcr(cleanCanvas, { allowRotation: false });
        if (hasText(retry) && !isWeakOcrResult(retry)) return retry;
        if (hasText(retry) && (Number(retry.confidence) || 0) >= (Number(result.confidence) || 0)) result = retry;
      } catch (retryError) {
        console.warn('Clean-image OCR retry failed:', retryError);
      }
    }

    // local OCR failed or is unsure -> AI vision (if configured and allowed)
    const dataUrl = await getDataUrl();
    const visionText = await runGeminiVisionOCRFromDataUrl(dataUrl, file.name);
    if (visionText) {
      return {
        text: visionText,
        confidence: 60,
        passes: (result && result.passes) || 0,
        lineCount: getOcrLineCount(visionText),
        skipped: false,
        source: 'gemini-vision'
      };
    }

    // nothing (or only junk) could be read -> keep the original picture instead of junk text / an error
    const veryWeak = !hasText(result) || (Number(result.confidence) || 0) < 30;
    if (veryWeak) {
      const keptTok = await _keepImageFileAsImage(dataUrl);
      if (keptTok) return { text: keptTok, confidence: 0, skipped: false, keptAsImage: true, figureTokens: [keptTok] };
    }
    if (hasText(result)) return { ...result, needsVision: true, visionDataUrl: dataUrl };
    throw new Error('This image could not be read or decoded.');
  } finally {
    try { URL.revokeObjectURL(objUrl); } catch (_) {}
    _ocrFreeCanvas(canvas);
    _ocrFreeCanvas(cleanCanvas);
  }
}

async function runOCRWithAIFallback(file, options = {}) {
  const ext = String(file?.name || '').split('.').pop().toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
  try {
    if (imageExts.includes(ext)) {
      try {
        const result = await runOcrOnImageFile(file);
        if (result && String(result.text || '').trim()) return { ...result, source: result.source || 'ocr' };
      } catch (localErr) {
        console.warn('Local OCR failed, trying AI fallback:', localErr); // do not skip the fallback below
      }
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not prepare the image for AI fallback.'));
      reader.readAsDataURL(file);
    });
    const text = await runGeminiVisionOCRFromDataUrl(dataUrl, file?.name || 'attachment');
    if (text && String(text).trim()) {
      return {
        text: String(text).trim(),
        confidence: 60,
        lineCount: getOcrLineCount(text),
        source: 'gemini-vision',
        needsVision: true,
        visionDataUrl: dataUrl
      };
    }
    throw new Error('OCR and AI fallback both failed to read this file.');
  } catch (error) {
    const message = error?.message || 'OCR could not read this file.';
    throw new Error(message);
  }
}

// ===== EXTRACT TEXT FROM IMAGES =====
async function extractTextFromImageFilesWithOCR(files, options = {}) {
  resetVisionBreaker();
  if (!Array.isArray(files) || files.length === 0) return [];

  const progressKeys = Array.isArray(options.progressKeys) ? options.progressKeys : files.map((file, index) => `${file.name}#ocr#${index}`);
  const preservePreview = !!options.preservePreview;
  const queue = files.map((file, index) => ({ file, index, progressKey: progressKeys[index] }));
  const results = new Array(files.length).fill(null);
  const parallel = Math.max(1, Math.min(_ocrPoolTarget(), queue.length));
  let nextIndex = 0;
  let completed = 0;

  if (!preservePreview && typeof ProgressUI !== 'undefined' && ProgressUI.clearPreview) ProgressUI.clearPreview();
  files.forEach((file, index) => {
    if (typeof ProgressUI !== 'undefined' && ProgressUI.addFileProgress) {
      ProgressUI.addFileProgress(progressKeys[index], file.name, 'Queued', 'Waiting to start');
    }
  });
  if (typeof ProgressUI !== 'undefined' && ProgressUI.setLabel) {
    ProgressUI.setLabel(`OCR reading ${files.length} image(s) — ${parallel} in parallel...`);
    ProgressUI.startStepEstimate(files.length);
  }

  async function worker() {
    while (true) {
      const itemIndex = nextIndex++;
      if (itemIndex >= queue.length || _ocrCancelled()) return;
      const { file, index, progressKey } = queue[itemIndex];
      try {
        if (typeof ProgressUI !== 'undefined' && ProgressUI.updateFileProgress) {
          ProgressUI.updateFileProgress(progressKey, 8, 'Reading', 'Loading image and preparing OCR');
        }
        const ocrResult = await runOcrOnImageFile(file);
        results[index] = {
          file,
          text: (ocrResult?.text || '').trim(),
          ai: false,
          confidence: typeof ocrResult?.confidence === 'number' ? ocrResult.confidence : 0,
          skipped: !!ocrResult?.skipped,
          skipReason: ocrResult?.skipReason || '',
          needsVision: !!ocrResult?.needsVision,
          visionDataUrls: ocrResult?.visionDataUrl ? [ocrResult.visionDataUrl] : [],
          figureTokens: Array.isArray(ocrResult?.figureTokens) ? ocrResult.figureTokens : [],
          keptAsImage: !!ocrResult?.keptAsImage,
          error: null
        };
        if (ocrResult?.skipped && !String(ocrResult?.text || '').trim()) {
          const skipMeta = ocrResult?.skipReason || 'No readable text detected; skipped this non-text region.';
          if (typeof ProgressUI !== 'undefined' && ProgressUI.updateFileProgress) {
            ProgressUI.updateFileProgress(progressKey, 100, 'Skipped', skipMeta, 'fallback');
          }
        } else {
          const confidenceText = ocrResult?.keptAsImage
            ? 'Not readable as text — kept as original image'
            : ocrResult?.needsVision
            ? 'OCR uncertain — image will be sent to AI vision when you ask a question'
            : (typeof ocrResult?.confidence === 'number' ? `OCR confidence ${Math.round(ocrResult.confidence)}%` : 'OCR complete');
          if (typeof ProgressUI !== 'undefined' && ProgressUI.updateFileProgress) {
            ProgressUI.updateFileProgress(progressKey, 100, 'Done', confidenceText, 'done');
          }
        }
      } catch (error) {
        console.warn(`OCR failed for image ${index + 1} (${file.name}):`, error);
        results[index] = { file, text: '', ai: false, confidence: 0, needsVision: true, error };
        const message = ((error && error.message) || 'OCR failed').slice(0, 140);
        if (typeof ProgressUI !== 'undefined' && ProgressUI.updateFileProgress) {
          ProgressUI.updateFileProgress(progressKey, 100, 'Failed', message, 'error');
        }
      } finally {
        completed++;
        if (typeof ProgressUI !== 'undefined' && ProgressUI.reportStepComplete) {
          ProgressUI.reportStepComplete(completed);
        }
        if (typeof ProgressUI !== 'undefined' && ProgressUI.setLabel) {
          ProgressUI.setLabel(`OCR: ${completed}/${files.length} files complete — remaining ${files.length - completed}`);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: parallel }, () => worker()));
  return results;
}

// ===== OCR MATH NORMALIZATION =====
function normalizeOcrMathLine(line) {
  let t = String(line || '').trim();
  if (!t) return '';
  t = t.replace(/[−–—]/g, '-').replace(/×/g, '\\times ').replace(/÷/g, '\\div ')
    .replace(/≤/g, '\\le ').replace(/≥/g, '\\ge ').replace(/≠/g, '\\ne ')
    .replace(/≈/g, '\\approx ').replace(/∞/g, '\\infty ')
    .replace(/π/g, '\\pi ').replace(/√/g, '\\sqrt ')
    .replace(/\s+/g, ' ').trim();

  if (/[=<>]|\\times|\\div|\\sqrt|\^/.test(t)) {
    // x1 -> x_1 only for a lone variable letter glued to 1-2 digits (not "Page 12", "H2O", "\pi2")
    t = t.replace(/(^|[^A-Za-z0-9\\])([A-Za-z])(\d{1,2})\b/g, '$1$2_$3');
  }
  if (/^[A-Za-z0-9()\s.+\-\\^_]+\/[A-Za-z0-9()\s.+\-\\^_]+$/.test(t)) {
    t = t.replace(/\b([0-9]+)\s*\/\s*([0-9]+)\b/g, '\\frac{$1}{$2}');
  }
  t = t.replace(/\\sqrt\s*\(?\s*([A-Za-z0-9.+\-]+)\s*\)?/g, '\\sqrt{$1}');
  return t;
}

function looksLikeOcrEquation(line) {
  const t = String(line || '').trim();
  if (!t || t.length > 180) return false;
  if (/^[-•*\d]+\s*(steps?|example|definition|important)/i.test(t)) return false;
  if (/https?:\/\/|www\.|\S+@\S+\.\S+/i.test(t)) return false;                 // URLs / e-mail addresses
  if (/(?![\p{Script=Latin}\p{Script=Greek}])\p{L}/u.test(t)) return false;      // Bengali etc. is prose, not an equation
  // prose guard: after removing function names, an equation has no real words ("Total = 5 apples" is text)
  const stripped = t.replace(/\\[A-Za-z]+/g, ' ')
    .replace(/\b(sin|cos|tan|cot|sec|csc|log|ln|exp|lim|sqrt|min|max|det|mod|frac)\b/gi, ' ');
  if ((stripped.match(/[A-Za-z]{4,}/g) || []).length > 0) return false;
  const mathSignals = (t.match(/(?:=|\\times|\\div|\\sqrt|\\frac|\^|≤|≥|≠|≈|∑|∫|π|θ|[×÷√±]|\bcos\b|\bsin\b|\btan\b)/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  return mathSignals >= 1 && (digits >= 1 || letters >= 2);
}

// Only meant for OCR output (images / scanned PDFs). Do NOT run it on DOCX / TXT text.
function postProcessOCRTextForMath(text) {
  const raw = String(text || '');
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(''); continue; }
    if (/^\s*(\$\$|\\\[|\\\()/.test(trimmed)) { out.push(trimmed); continue; }
    if (looksLikeOcrEquation(trimmed)) {
      const math = normalizeOcrMathLine(trimmed);
      out.push(`$$${math}$$`);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

// ========================================================================
// SELECTIVE FIGURE EXTRACTION  (Hybrid Preservation Mode)
// ------------------------------------------------------------------------
// For PDF pages that DO have a text layer, find the parts that are really
// pictures (embedded images + vector drawings such as graphs, circuits,
// diagrams), crop ONLY those regions from the rendered page, and put a
// placeholder token  [[FIG_<tag>_p<page>_<n>]]  into the extracted text at the
// position where the figure sits. The rest of the page stays normal text.
//   - text that lies INSIDE a figure (axis labels, circuit values) is removed from
//     the text, because it is already part of the picture (never re-typed by OCR)
//   - pages that are scans still use the normal OCR path
//   - anything doubtful (full-page images, text boxes, table lines, tiny
//     decorations, header/footer logos) is NOT cut -> normal text behaviour
// The cropped pictures live in PDF_FIGURE_STORE (in memory); the Copy command
// swaps the tokens for <img> tags after the AI has restyled the text.
// ========================================================================
const PDF_FIGURE_STORE = new Map(); // token -> { dataUrl, widthPt, heightPt, page }
const PDF_FIGURE_TOKEN_REGEX = /\[\[FIG_[A-Za-z0-9]+_p\d+_\d+\]\]/g;
window.PDF_FIGURE_STORE = PDF_FIGURE_STORE;
window.PDF_FIGURE_TOKEN_REGEX = PDF_FIGURE_TOKEN_REGEX;

function _figMul(m1, m2) { // same convention as pdf.js Util.transform
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}
function _figPt(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
function _figBox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
function _figNear(a, b, gap) { return !(a[2] + gap < b[0] || b[2] + gap < a[0] || a[3] + gap < b[1] || b[3] + gap < a[1]); }
function _figUnion(a, b) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }

// Returns { figures: [{bbox:[x0,y0,x1,y1] (PDF user space), hasImage, hasVector}], rects, removed: Set(text item index) }
async function _detectPdfFigures(page, textContent) {
  const OPS = (typeof pdfjsLib !== 'undefined' && pdfjsLib.OPS) ? pdfjsLib.OPS : null;
  if (!OPS) return { figures: [], removed: new Set(), rects: [] };

  const view = page.view || [0, 0, 595, 842];
  const pageW = view[2] - view[0], pageH = view[3] - view[1];
  const pageArea = pageW * pageH;
  const minSize = _figCfg('FIGURE_MIN_SIZE_PT', 36);
  const gap = _figCfg('FIGURE_MERGE_GAP_PT', 10);
  const minScore = _figCfg('FIGURE_MIN_VECTOR_SCORE', 3);

  // ---- 1. text boxes ----
  const items = textContent.items || [];
  const rects = items.map(it => {
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const h = Math.abs(it.height || tr[3] || 0) || 8;
    const w = Math.abs(it.width || 0);
    const x0 = tr[4], y0 = tr[5];
    return { x0, y0, x1: x0 + w, y1: y0 + h, cx: x0 + w / 2, cy: y0 + h / 2, len: String(it.str || '').trim().length };
  });

  // ---- 2. walk the drawing operators, tracking the transform matrix ----
  const opList = await page.getOperatorList();
  const fn = opList.fnArray, args = opList.argsArray;
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter(v => v !== undefined));
  const paintOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter(v => v !== undefined));
  const dropOps = new Set([OPS.endPath, OPS.clip, OPS.eoClip].filter(v => v !== undefined));
  const fillOnly = new Set([OPS.fill, OPS.eoFill].filter(v => v !== undefined));

  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let pending = null;
  const entries = []; // { bbox, img:bool, score, thin }

  const commitPending = (op) => {
    const p = pending; pending = null;
    if (!p || !p.pts.length) return;
    const bbox = _figBox(p.pts);
    const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1];
    if (!isFinite(w) || !isFinite(h)) return;
    if (w * h > 0.85 * pageArea) return;                                    // page background / border
    if ((w > 0.6 * pageW && h < 2) || (h > 0.6 * pageH && w < 2)) return;  // full-width rules, separators
    const complexity = p.curves + p.diag;
    const score = complexity === 0 ? 0 : (complexity >= 6 ? 3 : 1);
    if (score === 0 && fillOnly.has(op) && w * h > 0.35 * pageArea) return; // big plain filled box
    entries.push({ bbox, img: false, score, thin: (w < 1.5 || h < 1.5) });
  };

  for (let i = 0; i < fn.length; i++) {
    const op = fn[i], a = args[i];
    if (op === OPS.save) { stack.push(ctm); }
    else if (op === OPS.restore) { if (stack.length) ctm = stack.pop(); }
    else if (op === OPS.transform) { if (a && a.length >= 6) ctm = _figMul(ctm, a); }
    else if (op === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0] && a[0].length >= 6) ctm = _figMul(ctm, a[0]); }
    else if (op === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
    else if (imageOps.has(op)) {
      const bbox = _figBox([_figPt(ctm, 0, 0), _figPt(ctm, 1, 0), _figPt(ctm, 0, 1), _figPt(ctm, 1, 1)]);
      const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1];
      if (w >= minSize * 0.67 && h >= minSize * 0.67) entries.push({ bbox, img: true, score: 0, thin: false });
    }
    else if (op === OPS.constructPath) {
      const ops = a[0], c = a[1];
      if (!pending) pending = { pts: [], curves: 0, diag: 0 };
      let k = 0, cur = null;
      for (const o of ops) {
        if (o === OPS.moveTo) { const p = _figPt(ctm, c[k], c[k + 1]); k += 2; pending.pts.push(p); cur = p; }
        else if (o === OPS.lineTo) {
          const p = _figPt(ctm, c[k], c[k + 1]); k += 2; pending.pts.push(p);
          if (cur && Math.abs(p[0] - cur[0]) > 0.8 && Math.abs(p[1] - cur[1]) > 0.8) pending.diag++;
          cur = p;
        }
        else if (o === OPS.curveTo) { for (let j = 0; j < 6; j += 2) pending.pts.push(_figPt(ctm, c[k + j], c[k + j + 1])); k += 6; pending.curves++; cur = pending.pts[pending.pts.length - 1]; }
        else if (o === OPS.curveTo2 || o === OPS.curveTo3) { for (let j = 0; j < 4; j += 2) pending.pts.push(_figPt(ctm, c[k + j], c[k + j + 1])); k += 4; pending.curves++; cur = pending.pts[pending.pts.length - 1]; }
        else if (o === OPS.rectangle) {
          const x = c[k], y = c[k + 1], rw = c[k + 2], rh = c[k + 3]; k += 4;
          pending.pts.push(_figPt(ctm, x, y), _figPt(ctm, x + rw, y), _figPt(ctm, x, y + rh), _figPt(ctm, x + rw, y + rh));
          cur = null;
        }
      }
    }
    else if (paintOps.has(op)) { commitPending(op); }
    else if (dropOps.has(op)) { pending = null; }
    if (entries.length > 6000) break; // absurdly complex page (maps etc.) — use what was found so far
  }

  // ---- 3. cluster nearby entries ----
  const useful = entries.filter(e => !(e.thin && Math.max(e.bbox[2] - e.bbox[0], e.bbox[3] - e.bbox[1]) > 0.6 * Math.max(pageW, pageH)));
  const parent = useful.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  // sort indices by x0 and sweep; a box is compared with later boxes while their x0 is within reach of the widest box seen
  const order = useful.map((_, i) => i).sort((p, q) => useful[p].bbox[0] - useful[q].bbox[0]);
  for (let a = 0; a < order.length; a++) {
    const i = order[a];
    for (let b = a + 1; b < order.length; b++) {
      const j = order[b];
      if (useful[j].bbox[0] - gap > useful[i].bbox[2]) break;
      if (_figNear(useful[i].bbox, useful[j].bbox, gap)) parent[find(j)] = find(i);
    }
  }
  // the sweep above can miss a link when a big box sits between small ones; one more pass over group boxes fixes it
  for (let pass = 0; pass < 3; pass++) {
    const gb = new Map();
    useful.forEach((e, i) => { const r = find(i); gb.set(r, gb.has(r) ? _figUnion(gb.get(r), e.bbox) : e.bbox.slice()); });
    const roots = Array.from(gb.keys());
    let changed = false;
    for (let a = 0; a < roots.length; a++) for (let b = a + 1; b < roots.length; b++) {
      if (find(roots[a]) !== find(roots[b]) && _figNear(gb.get(roots[a]), gb.get(roots[b]), gap)) { parent[find(roots[b])] = find(roots[a]); changed = true; }
    }
    if (!changed) break;
  }
  const groups = new Map();
  useful.forEach((e, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { bbox: e.bbox.slice(), imgCount: 0, score: 0, n: 0 });
    const g = groups.get(r);
    g.bbox = _figUnion(g.bbox, e.bbox); g.n++; g.score += e.score; if (e.img) g.imgCount++;
  });

  // ---- 4. decide which clusters are real figures ----
  const bandTop = view[3] - 0.06 * pageH, bandBottom = view[1] + 0.06 * pageH;
  const unrotated = !page.rotate;
  const figs = [];
  for (const g of groups.values()) {
    const [x0, y0, x1, y1] = g.bbox;
    const w = x1 - x0, h = y1 - y0;
    if (w < minSize || h < minSize || w * h < 2000) continue;
    if (w * h > 0.92 * pageArea) continue;                        // whole-page picture -> normal handling
    if (g.imgCount === 0 && g.score < minScore) continue;         // plain lines / boxes / table borders
    if (unrotated && h < 80 && ((y0 + y1) / 2 >= bandTop || (y0 + y1) / 2 <= bandBottom)) continue; // header/footer logos
    figs.push({ bbox: [x0, y0, x1, y1], hasImage: g.imgCount > 0, hasVector: g.imgCount < g.n });
  }

  // ---- 5. absorb short labels that belong to the figure, reject text boxes ----
  const accepted = [];
  for (const f of figs) {
    let [x0, y0, x1, y1] = f.bbox;
    let sumLen = 0, maxLen = 0;
    rects.forEach((r) => {
      if (r.cx >= x0 - 2 && r.cx <= x1 + 2 && r.cy >= y0 - 2 && r.cy <= y1 + 2) { sumLen += r.len; if (r.len > maxLen) maxLen = r.len; }
    });
    if (!f.hasImage && (sumLen > 220 || maxLen > 45)) continue;   // bordered text box, not a diagram
    if (f.hasImage && sumLen > 400) continue;                     // text printed over a background picture
    const ring = 12;
    rects.forEach((r) => {
      if (r.len === 0 || r.len > 14) return;
      if (r.cx >= x0 - ring && r.cx <= x1 + ring && r.cy >= y0 - ring && r.cy <= y1 + ring) {
        x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0 - 1); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1);
      }
    });
    const pad = 4;
    f.bbox = [Math.max(view[0], x0 - pad), Math.max(view[1], y0 - pad), Math.min(view[2], x1 + pad), Math.min(view[3], y1 + pad)];
    accepted.push(f);
  }
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < accepted.length; i++) for (let j = i + 1; j < accepted.length; j++) {
      if (_figNear(accepted[i].bbox, accepted[j].bbox, 0)) {
        accepted[i] = { bbox: _figUnion(accepted[i].bbox, accepted[j].bbox), hasImage: accepted[i].hasImage || accepted[j].hasImage, hasVector: accepted[i].hasVector || accepted[j].hasVector };
        accepted.splice(j, 1); merged = true; break outer;
      }
    }
  }
  const area = (f) => (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]);
  accepted.sort((p, q) => area(q) - area(p));
  const final = accepted.slice(0, _figCfg('FIGURE_MAX_PER_PAGE', 8));
  final.sort((p, q) => q.bbox[3] - p.bbox[3]); // top of the page first

  const removed = new Set(); // text that is already inside a kept picture
  rects.forEach((r, idx) => {
    for (const f of final) {
      if (r.cx >= f.bbox[0] && r.cx <= f.bbox[2] && r.cy >= f.bbox[1] && r.cy <= f.bbox[3]) { removed.add(idx); break; }
    }
  });
  return { figures: final, removed, rects };
}

// Prompt for a picture cut out of a text-layer page: transcribe only if it is mainly text.
const GEMINI_VISION_FIGURE_PROMPT =
  'You are an OCR engine reading a picture that was cut out of a document page. ' +
  'If the picture is mainly TEXT (printed or handwritten sentences, equations, a table of words), transcribe ALL of it exactly as written, ' +
  'keeping line breaks and reading order, with mathematical expressions as LaTeX wrapped in $$...$$. ' +
  'If the picture is mainly a drawing, graph, chart, diagram, circuit, map or photo that only carries a few labels, do NOT transcribe the labels: respond with exactly: [NO_TEXT_FOUND]. ' +
  'Output only the transcription, with no commentary.';

function _figTextStats(text) {
  const t = String(text || '').trim();
  const words = (t.match(/[\p{L}\p{M}\p{N}]+/gu) || []).length;
  const nonSpace = (t.match(/\S/gu) || []).length;
  const wordy = (t.match(/[\p{L}\p{M}\p{N}]/gu) || []).length;
  const lines = t.split(/\n+/).filter(l => l.trim());
  const avgLine = lines.length ? t.replace(/\s+/g, ' ').length / lines.length : 0;
  return { words, chars: nonSpace, ratio: nonSpace ? wordy / nonSpace : 0, lines: lines.length, avgLine };
}

// "Readable" = real running text, not the stray digits/labels OCR finds inside a drawing or photo.
function _figLooksReadable(text, confidence, viaVision) {
  const s = _figTextStats(text);
  if (viaVision) return s.words >= _figCfg('FIGURE_VISION_MIN_WORDS', 4);
  return (Number(confidence) || 0) >= _figCfg('FIGURE_OCR_MIN_CONFIDENCE', 60) &&
    s.words >= _figCfg('FIGURE_OCR_MIN_WORDS', 6) &&
    s.chars >= 40 &&
    s.ratio >= 0.6 &&
    s.avgLine >= 15;
}

// Render the page once, cut every figure out of it -> array of canvases (null where the cut failed).
async function _cropPdfFigureCanvases(page, figures) {
  let scale = Math.max(1, Math.min(4, _figCfg('FIGURE_RENDER_SCALE', 2.2)));
  const base = page.getViewport({ scale: 1 });
  const maxPixels = 20000000;
  if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
  const viewport = page.getViewport({ scale });
  const full = document.createElement('canvas');
  full.width = Math.ceil(viewport.width); full.height = Math.ceil(viewport.height);
  const fctx = full.getContext('2d');
  fctx.fillStyle = '#ffffff'; fctx.fillRect(0, 0, full.width, full.height);
  await page.render({ canvasContext: fctx, viewport }).promise;
  const out = [];
  for (const f of figures) {
    const r = viewport.convertToViewportRectangle(f.bbox);
    const x = Math.max(0, Math.floor(Math.min(r[0], r[2]))), y = Math.max(0, Math.floor(Math.min(r[1], r[3])));
    const w = Math.min(full.width - x, Math.ceil(Math.abs(r[2] - r[0]))), h = Math.min(full.height - y, Math.ceil(Math.abs(r[3] - r[1])));
    if (w < 8 || h < 8) { out.push(null); continue; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(full, x, y, w, h, 0, 0, w, h);
    out.push(c);
  }
  _ocrFreeCanvas(full);
  return out;
}

function _encodeFigureCanvas(canvas, f) {
  let dataUrl = (f.hasImage && !f.hasVector) ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  if (dataUrl.length > 1500000 && dataUrl.startsWith('data:image/png')) dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return dataUrl;
}

// Cascade for ONE picture region of a text-layer page:
//   1) local OCR (quick: 2 passes, no rotation)  ->  2) AI vision  ->  3) keep it as a cropped picture.
async function _readFigureRegion(canvas, label) {
  // 1. local OCR (on a copy — the original crop must stay clean for the picture fallback)
  let copy = null;
  try {
    copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);
    preprocessCanvasForOcr(copy);
    const r = await recognizeImageWithOcr(copy, { maxPasses: 2, allowRotation: false });
    const t = String((r && r.text) || '').trim();
    if (t && _figLooksReadable(t, r && r.confidence, false)) return { kind: 'text', text: t, source: 'ocr' };
  } catch (e) {
    console.warn(`Figure OCR failed (${label}):`, e);
  } finally {
    _ocrFreeCanvas(copy);
  }
  if (_ocrCancelled()) return { kind: 'image' };
  // 2. AI vision (returns '' when no model is configured, on API errors, or when the picture is not text)
  try {
    const url = canvas.toDataURL('image/jpeg', 0.92);
    const v = await runGeminiVisionOCRFromDataUrl(url, label, GEMINI_VISION_FIGURE_PROMPT);
    if (v && _figLooksReadable(v, 100, true)) return { kind: 'text', text: String(v).trim(), source: 'vision' };
  } catch (e) { console.warn(`Figure AI vision failed (${label}):`, e); }
  // 3. neither could read it -> keep the original picture
  return { kind: 'image' };
}

// One text-layer page. Returns null when there is no reliable figure, otherwise
// { text, tokens }: pictures OCR/AI could read are now plain text; the rest are [[FIG_..]] placeholders.
async function _extractFiguresForTextPage(page, textContent, pageNum, fileTag, budget) {
  if (_figCfg('FIGURE_EXTRACT_ENABLED', true) === false) return null;
  if (budget.left <= 0) return null;
  const det = await _detectPdfFigures(page, textContent);
  if (!det.figures.length) return null;
  const figures = det.figures.slice(0, budget.left);
  const canvases = await _cropPdfFigureCanvases(page, figures);
  if (!budget.stats) budget.stats = { ocr: 0, vision: 0, image: 0 };

  // ---- decide, per picture: text (OCR / vision) or keep as picture ----
  const outcomes = [];
  for (let n = 0; n < figures.length; n++) {
    const f = figures[n], canvas = canvases[n];
    if (!canvas) { outcomes.push(null); continue; }
    let o = { kind: 'image' };
    // A pure vector drawing (graph, circuit) has its labels in the text layer already and cannot be "read" as
    // text, so it goes straight to the picture fallback. Pictures that contain a raster image run the cascade.
    if ((f.hasImage || _figCfg('FIGURE_CASCADE_VECTOR', false)) && !_ocrCancelled()) {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.setLabel) ProgressUI.setLabel(`Page ${pageNum}: reading picture ${n + 1}/${figures.length} (OCR → AI vision → keep as image)…`);
      o = await _readFigureRegion(canvas, `page ${pageNum} picture ${n + 1}`);
    }
    if (o.kind === 'text') budget.stats[o.source === 'vision' ? 'vision' : 'ocr']++;
    else { o.dataUrl = _encodeFigureCanvas(canvas, f); budget.stats.image++; }
    outcomes.push(o);
  }
  canvases.forEach(c => _ocrFreeCanvas(c));

  // ---- text inside a resolved picture is now covered by the picture / the recognized text ----
  const items = textContent.items;
  const rects = det.rects;
  const removed = new Set();
  rects.forEach((r, idx) => {
    figures.forEach((f, n) => {
      if (outcomes[n] && r.cx >= f.bbox[0] && r.cx <= f.bbox[2] && r.cy >= f.bbox[1] && r.cy <= f.bbox[3]) removed.add(idx);
    });
  });

  // ---- reading-order position of every resolved picture ----
  const placed = [];
  const tokens = [];
  figures.forEach((f, n) => {
    const o = outcomes[n];
    if (!o) return;
    let payload;
    if (o.kind === 'text') payload = o.text;
    else {
      const token = `[[FIG_${fileTag}_p${pageNum}_${n + 1}]]`;
      _storeFigure(token, { dataUrl: o.dataUrl, widthPt: f.bbox[2] - f.bbox[0], heightPt: f.bbox[3] - f.bbox[1], page: pageNum, hash: f.hasImage && !f.hasVector ? _figHash(o.dataUrl) : '' });
      if (f.hasImage && !f.hasVector) { (budget.hashes = budget.hashes || new Map()); const hk = _figHash(o.dataUrl); budget.hashes.set(hk, (budget.hashes.get(hk) || []).concat(token)); }
      tokens.push(token);
      payload = token;
    }
    const fw = f.bbox[2] - f.bbox[0];
    const overlapX = (r) => {
      const ov = Math.min(r.x1, f.bbox[2]) - Math.max(r.x0, f.bbox[0]);
      const rw = r.x1 - r.x0;
      return rw <= 1 ? (r.cx >= f.bbox[0] && r.cx <= f.bbox[2]) : ov >= Math.min(rw, fw) * 0.3;
    };
    const live = (i) => !removed.has(i) && String(items[i].str || '').trim();
    let at = -1;
    for (let i = 0; i < items.length; i++) {            // first text after the picture (same column)
      if (live(i) && rects[i].cy < f.bbox[3] - 1 && overlapX(rects[i])) { at = i; break; }
    }
    if (at < 0) {                                       // no text under it in its own column: first text anywhere below its top
      for (let i = 0; i < items.length; i++) {
        if (live(i) && rects[i].cy < f.bbox[3] - 1) { at = i; break; }
      }
    }
    if (at < 0) at = items.length;                      // nothing below at all: end of the page
    placed.push({ at, payload });
  });
  if (!placed.length) return null;
  budget.left -= tokens.length;

  const pieces = [];
  for (let i = 0; i <= items.length; i++) {
    placed.filter(p => p.at === i).forEach(p => pieces.push(`\n\n${p.payload}\n\n`));
    if (i < items.length && !removed.has(i)) pieces.push(items[i].str);
  }
  const text = pieces.join(' ').replace(/[ \t]*\n\n[ \t]*/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, tokens };
}

// ---- Persist cropped pictures in IndexedDB so [[FIG_..]] tokens still work after a page reload ----
// (the in-memory Map is empty after a reload while the attachment text still holds the tokens)
const _FIG_DB = { name: 'aiPdfStudio_figures_v1', store: 'figs', dbp: null };
function _figDb() {
  if (_FIG_DB.dbp) return _FIG_DB.dbp;
  _FIG_DB.dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const rq = indexedDB.open(_FIG_DB.name, 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore(_FIG_DB.store); } catch (_) {} };
      rq.onsuccess = () => { const db = rq.result; resolve(db); _figDbPruneOld(db); };
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
  return _FIG_DB.dbp;
}
function _figDbPruneOld(db) { // pictures nobody asked for in N days are dropped, so storage never grows forever
  try {
    const maxAge = (_figCfg('FIGURE_DB_MAX_AGE_DAYS', 14)) * 86400000;
    const tx = db.transaction(_FIG_DB.store, 'readwrite');
    const rq = tx.objectStore(_FIG_DB.store).openCursor();
    rq.onsuccess = () => {
      const cur = rq.result;
      if (!cur) return;
      const savedAt = cur.value && cur.value.savedAt;
      if (savedAt && Date.now() - savedAt > maxAge) cur.delete();
      cur.continue();
    };
  } catch (_) {}
}
async function figureDbPut(token, rec) {
  const db = await _figDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(_FIG_DB.store, 'readwrite');
      tx.objectStore(_FIG_DB.store).put({ ...rec, savedAt: Date.now() }, token);
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch (_) { resolve(false); }
  });
}
async function figureDbGet(token) {
  const db = await _figDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const rq = db.transaction(_FIG_DB.store, 'readonly').objectStore(_FIG_DB.store).get(token);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}
async function figureDbDelete(tokens) {
  const db = await _figDb();
  if (!db || !tokens || !tokens.length) return;
  try {
    const tx = db.transaction(_FIG_DB.store, 'readwrite');
    tokens.forEach(t => tx.objectStore(_FIG_DB.store).delete(t));
  } catch (_) {}
}
function _storeFigure(token, rec) {
  PDF_FIGURE_STORE.set(token, rec);
  figureDbPut(token, rec); // fire-and-forget; failure just means "no persistence"
}
// Returns the figure record from memory, or (after a reload) from IndexedDB.
async function loadFigure(token) {
  if (PDF_FIGURE_STORE.has(token)) return PDF_FIGURE_STORE.get(token);
  const rec = await figureDbGet(token);
  if (rec && rec.dataUrl) { PDF_FIGURE_STORE.set(token, rec); return rec; }
  return null;
}
window.figureDbGet = figureDbGet;
window.loadFigure = loadFigure;

// Same picture on many pages (logo, watermark, letterhead) is decoration, not content.
function _figHash(dataUrl) {
  let h = 2166136261 >>> 0;
  const str = String(dataUrl);
  const step = Math.max(1, Math.floor(str.length / 4000)); // sample ~4000 chars
  for (let i = 0; i < str.length; i += step) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${str.length}:${h}`;
}

// ---- Unreadable page / image -> keep it as the ORIGINAL picture (never an error) ----
// Used for pages without a usable text layer (scanned pages) and for image files when
// local OCR and AI vision could not read them.
function _newFigureTag() {
  return Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(2, 8) || 'f0';
}
function _keptImageToken(tag, pageNum, dataUrl, widthPt, heightPt) {
  const token = `[[FIG_${tag}_p${pageNum}_0]]`;
  _storeFigure(token, { dataUrl, widthPt, heightPt, page: pageNum });
  return token;
}
function _previewText(t) {
  return String(t || '').replace(new RegExp(PDF_FIGURE_TOKEN_REGEX.source, 'g'), '[image kept]');
}
// Render a whole PDF page to a data URL at a bounded size -> { dataUrl, width, height } or null.
async function _renderPageDataUrl(page, longEdgePx, quality) {
  let canvas = null;
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(0.5, Math.min(3, longEdgePx / Math.max(base.width, base.height)));
    const viewport = page.getViewport({ scale });
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: base.width, height: base.height };
  } catch (e) {
    console.warn('Could not render page to an image:', e);
    return null;
  } finally {
    _ocrFreeCanvas(canvas);
  }
}
// Render a whole PDF page as a clean picture (no OCR preprocessing) -> token, or '' on failure.
async function _keepPdfPageAsImage(page, tag, pageNum) {
  const r = await _renderPageDataUrl(page, _figCfg('SCANNED_PAGE_IMAGE_LONG_EDGE', 1800), 0.86);
  if (!r) return '';
  return _keptImageToken(tag, pageNum, r.dataUrl, r.width, r.height);
}
// An uploaded image file (png/jpg/...) -> token, or '' on failure.
async function _keepImageFileAsImage(dataUrl) {
  let canvas = null;
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im); im.onerror = () => reject(new Error('decode failed'));
      im.src = dataUrl;
    });
    const maxEdge = _figCfg('SCANNED_PAGE_IMAGE_LONG_EDGE', 1800);
    const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    const k = Math.min(1, maxEdge / Math.max(nw, nh));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(nw * k)); canvas.height = Math.max(1, Math.round(nh * k));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', 0.88);
    const w = canvas.width, h = canvas.height;
    return _keptImageToken(_newFigureTag(), 1, out, w * 0.75, h * 0.75);
  } catch (e) {
    console.warn('Could not keep the image file as an image:', e);
    return '';
  } finally {
    _ocrFreeCanvas(canvas);
  }
}

function releasePdfFigures(tokens) {
  (tokens || []).forEach(t => PDF_FIGURE_STORE.delete(t));
  figureDbDelete(tokens || []);
}
window.releasePdfFigures = releasePdfFigures;

// ===== PDF TEXT EXTRACTION WITH OCR =====
// preloadedDoc (optional): an already opened pdf.js document, so the file is not parsed twice.
// The caller keeps ownership of a preloaded document.
async function extractTextFromPDFWithOCRFallback(file, startPage, endPage, preloadedDoc) {
  resetVisionBreaker();
  extractTextFromPDFWithOCRFallback.lastVisionDataUrls = [];
  extractTextFromPDFWithOCRFallback.lastFigureTokens = [];
  const _figTag = _newFigureTag();
  const _figBudget = { left: _figCfg('FIGURE_MAX_PER_DOC', 80) };
  const _figTokens = [];
  const _keptPages = { kept: 0, dropped: 0 };
  const _scannedPolicy = _figCfg('SCANNED_PAGE_POLICY', 'ocr-then-image'); // 'ocr-then-image' | 'image-only'
  const _keptPageMax = _figCfg('SCANNED_PAGE_IMAGE_MAX', 120);
  const ownsDoc = !preloadedDoc;
  const pdfDoc = preloadedDoc || await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const totalPages = pdfDoc.numPages;
    const start = Math.max(1, startPage || 1);
    const end = Math.min(totalPages, endPage || totalPages);
    const pagesToProcess = end - start + 1;

    if (typeof ProgressUI !== 'undefined') {
      ProgressUI.clearPreview();
      ProgressUI.setLabel(`Reading pages ${start}–${end} of ${totalPages}...`);
      ProgressUI.startStepEstimate(pagesToProcess);
    }

    const minTextLen = _ocrNum('OCR_MIN_TEXT_LEN_PER_PAGE', 30);
    const minTextItems = _ocrNum('OCR_MIN_TEXT_ITEMS_PER_PAGE', 5);
    const results = new Array(pagesToProcess).fill(null);
    const needsOcr = [];
    for (let idx = 0; idx < pagesToProcess; idx++) {
      if (_ocrCancelled()) break;
      const pageNum = start + idx;
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(it => it.str).join(' ').trim();
      const isLikelyScanned = pageText.length < minTextLen && textContent.items.length < minTextItems;
      if (isLikelyScanned) {
        needsOcr.push({ idx, pageNum, page });
      } else {
        // Hybrid Preservation: cut out only the picture parts of this text page and leave
        // a [[FIG_..]] placeholder in the text. Any failure -> the page keeps plain text.
        let pageTextOut = pageText;
        try {
          const fx = await _extractFiguresForTextPage(page, textContent, pageNum, _figTag, _figBudget);
          if (fx && fx.text) { pageTextOut = fx.text; _figTokens.push(...fx.tokens); }
        } catch (figErr) {
          console.warn(`Figure extraction skipped on page ${pageNum}:`, figErr);
        }
        results[idx] = { text: pageTextOut, ocr: false };
        if (typeof ProgressUI !== 'undefined' && ProgressUI.addPagePreview) {
          ProgressUI.addPagePreview(` Page ${pageNum} (text)`, pageText.slice(0, 120) + (pageText.length > 120 ? '…' : ''), 'done');
        }
        try { page.cleanup(); } catch (_) {}   // release page resources early on big documents
      }
    }

    let completedSteps = results.filter(Boolean).length;
    if (typeof ProgressUI !== 'undefined' && ProgressUI.reportStepComplete) {
      ProgressUI.reportStepComplete(completedSteps);
    }

    let avgConf = 0;
    if (needsOcr.length > 0 && !_ocrCancelled()) {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.setLabel) {
        ProgressUI.setLabel(`OCR reading ${needsOcr.length} scanned page(s) with full pipeline...`);
      }

      // A page that no OCR / AI vision could read is NOT an error: it is kept as the original page picture.
      const keepPageAsImage = async (page, pageNum) => {
        if (_keptPages.kept >= _keptPageMax) { _keptPages.dropped++; return ''; }
        const token = await _keepPdfPageAsImage(page, _figTag, pageNum);
        if (token) { _keptPages.kept++; _figTokens.push(token); } else { _keptPages.dropped++; }
        return token;
      };

      const processScannedPage = async ({ idx, pageNum, page }) => {
        if (_ocrCancelled()) {
          return { idx, pageNum, text: '', confidence: 0, skipped: true, skipReason: 'Cancelled' };
        }
        if (_scannedPolicy === 'image-only') {
          const tok = await keepPageAsImage(page, pageNum);
          return { idx, pageNum, text: tok, confidence: 0, skipped: !tok, skipReason: tok ? '' : 'Not kept', keptAsImage: !!tok };
        }
        let canvas = null;
        try {
          // 1. scale to the target long edge
          const baseViewport = page.getViewport({ scale: 1 });
          const longEdge = Math.max(baseViewport.width, baseViewport.height);
          const targetLongEdge = _ocrNum('OCR_TARGET_LONG_EDGE', 4200);
          const scale = Math.min(3.2, Math.max(1, targetLongEdge / longEdge));

          // 2. render
          const viewport = page.getViewport({ scale });
          canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport }).promise;

          // 3. light preprocessing, then the full OCR pipeline
          await _ocrTick();
          preprocessCanvasForOcr(canvas);
          const result = await recognizeImageWithOcr(canvas);
          _ocrFreeCanvas(canvas); canvas = null;   // free the big canvas before any slow fallback

          const resultText = String(result?.text || '').trim();
          const resultLines = Number(result?.lineCount) || getOcrLineCount(resultText);
          const resultIsWeak = !resultText || ((Number(result?.confidence) || 0) < 50 && resultLines < 2);
          if (resultText && !resultIsWeak) {
            return {
              idx, pageNum,
              text: result.text || '',
              confidence: result.confidence || 0,
              skipped: result.skipped || false,
              skipReason: result.skipReason || '',
              passes: result?.passes || 0,
              lineCount: result.lineCount
            };
          }

          // Local OCR found nothing usable: AI vision on a clean, bounded-size render (smaller upload than the OCR canvas)
          const clean = _figCfg('VISION_FALLBACK_ENABLED', true) === false ? null
            : await _renderPageDataUrl(page, _ocrNum('VISION_PAGE_LONG_EDGE', 2400), 0.9);
          const visionDataUrl = clean ? clean.dataUrl : '';
          const visionText = visionDataUrl ? await runGeminiVisionOCRFromDataUrl(visionDataUrl, `page ${pageNum}`) : '';
          if (visionText) {
            return {
              idx, pageNum,
              text: visionText,
              confidence: 60,
              skipped: false,
              skipReason: '',
              passes: result.passes,
              lineCount: getOcrLineCount(visionText),
              source: 'gemini-vision'
            };
          }
          // OCR and AI vision both failed -> keep the original page as a picture
          const keptToken = await keepPageAsImage(page, pageNum);
          return {
            idx, pageNum,
            text: keptToken || (result?.text || ''),
            confidence: result?.confidence || 0,
            skipped: result?.skipped || false,
            skipReason: result?.skipReason || '',
            passes: result?.passes || 0,
            lineCount: result?.lineCount || 0,
            needsVision: true,
            keptAsImage: !!keptToken,
            visionDataUrl
          };
        } catch (err) {
          console.warn(`OCR failed on page ${pageNum}:`, err);
          _ocrFreeCanvas(canvas); canvas = null;
          const keptToken = _ocrCancelled() ? '' : await keepPageAsImage(page, pageNum);
          return { idx, pageNum, text: keptToken, confidence: 0, skipped: !keptToken, skipReason: keptToken ? '' : 'OCR error', keptAsImage: !!keptToken };
        } finally {
          _ocrFreeCanvas(canvas);
          try { page.cleanup(); } catch (_) {}
        }
      };

      // Concurrency is capped: rendering a page is the memory-heavy step, so never render more pages than workers.
      const renderLimit = Math.max(1, _ocrNum('OCR_RENDER_CONCURRENCY', _ocrPoolTarget()));
      const ocrResults = await _ocrMapLimit(needsOcr, renderLimit, async (item) => {
        const res = await processScannedPage(item);
        results[res.idx] = {
          text: res.text,
          ocr: true,
          confidence: res.confidence,
          skipped: res.skipped,
          skipReason: res.skipReason,
          needsVision: !!res.needsVision,
          keptAsImage: !!res.keptAsImage,
          visionDataUrls: res.visionDataUrl ? [res.visionDataUrl] : []
        };
        completedSteps++;
        if (typeof ProgressUI !== 'undefined') {
          const previewContainer = document.getElementById('progress-live-preview');
          if (previewContainer) {
            const items = previewContainer.querySelectorAll('.progress-page-thumb');
            const lastItem = items[items.length - 1];
            if (lastItem) {
              lastItem.className = 'progress-page-thumb done';
              const thumbText = lastItem.querySelector('.thumb-text');
              const thumbBadge = lastItem.querySelector('.thumb-badge');
              if (thumbText) { const _pv = _previewText(res.text); thumbText.textContent = _pv ? _pv.slice(0, 140) + (_pv.length > 140 ? '…' : '') : (res.skipReason || 'Skipped'); }
              if (thumbBadge) thumbBadge.textContent = res.skipped ? 'Skipped' : '';
            }
          }
          ProgressUI.setLabel(`OCR reading page ${res.pageNum} (${completedSteps}/${pagesToProcess}) — ${res.skipped ? 'skipped' : 'complete'}`);
          ProgressUI.reportStepComplete(completedSteps);
        }
        return res;
      });

      // Average confidence
      let totalConfidence = 0, confCount = 0;
      for (const r of results) {
        if (r && r.ocr && !r.keptAsImage && r.confidence > 0) {
          totalConfidence += r.confidence;
          confCount++;
        }
      }
      avgConf = confCount > 0 ? Math.round(totalConfidence / confCount) : 0;
      void ocrResults;
    }

    if (_ocrCancelled() && typeof displayToastNotification === 'function') {
      displayToastNotification(`Cancelled — ${completedSteps}/${pagesToProcess} page(s) read, rest saved as blank.`);
    }

    let fullText = '';
    let ocrPageCount = 0;
    const visionDataUrls = [];
    for (let idx = 0; idx < pagesToProcess; idx++) {
      const pageNum = start + idx;
      const r = results[idx] || { text: '', ocr: false };
      if (r.ocr && !r.keptAsImage) ocrPageCount++;
      if (Array.isArray(r.visionDataUrls)) visionDataUrls.push(...r.visionDataUrls);
      fullText += `\n--- Page ${pageNum}${r.text ? '' : ' (empty)'} ---\n` + r.text;
      if (typeof ProgressUI !== 'undefined' && r.text) {
        const _pv2 = _previewText(r.text);
        ProgressUI.addPagePreview(` Page ${pageNum}${r.ocr ? ' (OCR)' : ''}`, _pv2.slice(0, 120) + (_pv2.length > 120 ? '…' : ''), 'done');
      }
    }

    if (ocrPageCount > 0) {
      if (typeof displayToastNotification === 'function') {
        displayToastNotification(` OCR applied to ${ocrPageCount} scanned page(s)`);
      }
      fullText =
        `[OCR Quality: Avg confidence ${avgConf}% on ${ocrPageCount} page(s), ${Math.min(_ocrPoolTarget(), ocrPageCount)} parallel worker(s)]\n` +
        fullText;
    }

    if (typeof ProgressUI !== 'undefined') {
      ProgressUI.setLabel(`OCR finished: ${pagesToProcess}/${pagesToProcess} pages processed${ocrPageCount ? `; ${ocrPageCount} scanned page(s)` : ''}.`);
      ProgressUI.finish();
    }
    // A picture that shows up on 3+ pages (logo, watermark, letterhead) is decoration: drop it again.
    let _repeatedDropped = 0;
    if (_figBudget.hashes) {
      const minRepeat = _figCfg('FIGURE_REPEAT_MIN_PAGES', 3);
      for (const toks of _figBudget.hashes.values()) {
        if (toks.length < minRepeat) continue;
        toks.forEach(t => {
          fullText = fullText.split(t).join('');
          const i = _figTokens.indexOf(t); if (i >= 0) _figTokens.splice(i, 1);
          if (_figBudget.stats) _figBudget.stats.image = Math.max(0, _figBudget.stats.image - 1);
        });
        releasePdfFigures(toks);
        _repeatedDropped += toks.length;
      }
      fullText = fullText.replace(/\n{3,}/g, '\n\n');
    }
    extractTextFromPDFWithOCRFallback.lastVisionDataUrls = visionDataUrls;
    extractTextFromPDFWithOCRFallback.lastFigureTokens = _figTokens;
    if (_repeatedDropped && typeof displayToastNotification === 'function') {
      displayToastNotification(`ℹ️ ${_repeatedDropped} repeated picture(s) (logo / watermark on many pages) were ignored`);
    }
    if (_figBudget.stats && typeof displayToastNotification === 'function') {
      const st = _figBudget.stats;
      displayToastNotification(`🖼️ Pictures in text pages — read by OCR: ${st.ocr}, read by AI vision: ${st.vision}, kept as original image: ${st.image}`);
    }
    if (typeof displayToastNotification === 'function') {
      if (_keptPages.kept > 0) displayToastNotification(`🖼️ ${_keptPages.kept} page(s) could not be read as text — kept as original page images`);
      if (_keptPages.dropped > 0) displayToastNotification(`ℹ️ ${_keptPages.dropped} page(s) were left blank (image limit of ${_keptPageMax} reached or page could not be rendered).`);
    }
    // math formatting is applied here (OCR output) and only here: callers must not run it a second time
    return postProcessOCRTextForMath(fullText);
  } finally {
    if (ownsDoc) { try { await pdfDoc.destroy(); } catch (_) {} }
  }
}

// ===== FILE HANDLING =====
function makeAttachedFileContent(file, extractedContent) {
  let content = extractedContent || '';
  const maxChars = _ocrNum('ATTACHMENT_MAX_TEXT_CHARS', 100000);
  if (content.length > maxChars) {
    let cut = content.substring(0, maxChars);
    // never leave half of a [[FIG_..]] placeholder at the cut
    const open = cut.lastIndexOf('[[FIG_');
    if (open >= 0 && open > cut.lastIndexOf(']]')) cut = cut.substring(0, open);
    content = cut + `\n...[ATTACHMENT CONTENT LIMIT: first ${maxChars} characters preserved]`;
  }
  return { name: file.name, content, sent: false, sourceMode: 'ocr' };
}

async function handleFileUploads(fileList) {
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const imageJobs = [];
  const otherJobs = [];
  const baseStamp = Date.now();
  files.forEach((file, i) => {
    const fileId = `f_${baseStamp}_${i}_${Math.random().toString(36).slice(2, 7)}`;
    if (!window.APP_STATE) window.APP_STATE = {};
    if (!window.APP_STATE.fileObjects) window.APP_STATE.fileObjects = {};
    window.APP_STATE.fileObjects[fileId] = file;
    if (!window.APP_STATE.attachedFiles) window.APP_STATE.attachedFiles = {};
    window.APP_STATE.attachedFiles[fileId] = {
      name: file.name, content: '', sent: false, status: 'queued', sourceMode: 'ocr', order: i
    };
    const ext = file.name.split('.').pop().toLowerCase();
    const job = { file, fileId, ext, index: i };
    if (IMAGE_EXTS.includes(ext)) imageJobs.push(job);
    else otherJobs.push(job);
  });
  if (typeof syncCurrentTabFileObjects === 'function') syncCurrentTabFileObjects();
  if (typeof renderAttachmentBar === 'function') renderAttachmentBar();

  try {
    // Images: always local OCR
    if (imageJobs.length) {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(
          imageJobs.length > 1 ? `Reading ${imageJobs.length} images with Studio OCR` : `Reading ${imageJobs[0].file.name} with Studio OCR`,
          'Local OCR is extracting text and equations. Gemini Vision is used only if local OCR can\'t read a file.'
        );
        ProgressUI.clearPreview();
      }
      imageJobs.forEach(job => {
        if (typeof ProgressUI !== 'undefined' && ProgressUI.addFileProgress) {
          ProgressUI.addFileProgress(job.fileId, job.file.name, 'Queued', 'Waiting to start');
        }
      });
      const results = await extractTextFromImageFilesWithOCR(
        imageJobs.map(j => j.file),
        { progressKeys: imageJobs.map(j => j.fileId), preservePreview: true }
      );
      for (let i = 0; i < imageJobs.length; i++) {
        const job = imageJobs[i];
        const result = results[i] || { text: '', confidence: 0, error: null };
        if (result.error) {
          delete window.APP_STATE.fileObjects[job.fileId];
          delete window.APP_STATE.attachedFiles[job.fileId];
          if (typeof displayToastNotification === 'function') {
            displayToastNotification(`⚠️ Could not read "${job.file.name}". OCR could not extract text, and the AI fallback also failed to read it.`);
          }
          continue;
        }
        const extractedContent = postProcessOCRTextForMath(String(result.text || '').trim());
        window.APP_STATE.attachedFiles[job.fileId] = {
          ...makeAttachedFileContent(job.file, extractedContent),
          status: extractedContent ? 'ready' : 'skipped',
          sourceMode: 'ocr', order: job.index,
          ocrConfidence: result.confidence || 0,
          needsVision: !!result.needsVision,
          visionDataUrls: Array.isArray(result.visionDataUrls) ? result.visionDataUrls : [],
          figureTokens: Array.isArray(result.figureTokens) ? result.figureTokens : []
        };
        if (result.keptAsImage && typeof displayToastNotification === 'function') {
          displayToastNotification(`🖼️ "${job.file.name}" could not be read as text — kept as the original image`);
        }
      }
      if (typeof ProgressUI !== 'undefined') {
        ProgressUI.setLabel(`Studio OCR complete: ${imageJobs.length}/${imageJobs.length} image(s) processed.`);
        ProgressUI.finish();
        setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 700);
      }
    }

    // PDFs/DOCX/TXT: always use local extraction/OCR
    for (const job of otherJobs) {
      const file = job.file;
      let extractedContent = '';
      try {
        if (job.ext === 'docx') {
          if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
            ProgressUI.show(`Reading ${file.name}`, 'Extracting document text locally...');
          }
          // plain document text: NO math post-processing (it is not OCR output)
          extractedContent = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value || '[Empty DOCX]';
        } else if (job.ext === 'pdf') {
          const pdfDocForCount = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
          try {
            const totalPages = pdfDocForCount.numPages;
            const range = await promptForPageRange(totalPages);
            if (!range) {
              delete window.APP_STATE.fileObjects[job.fileId];
              delete window.APP_STATE.attachedFiles[job.fileId];
              continue;
            }
            if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
              ProgressUI.show(`Reading ${file.name} with Studio OCR`, `Pages ${range.start}–${range.end}...`);
              ProgressUI.clearPreview();
            }
            try {
              // reuse the already opened document; math formatting is applied inside
              extractedContent = await extractTextFromPDFWithOCRFallback(file, range.start, range.end, pdfDocForCount);
            } catch (pdfError) {
              delete window.APP_STATE.fileObjects[job.fileId];
              delete window.APP_STATE.attachedFiles[job.fileId];
              if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
              if (typeof displayToastNotification === 'function') {
                displayToastNotification(`⚠️ Could not read "${file.name}". OCR could not extract text, and the AI fallback also failed to read it.`);
              }
              continue;
            }
          } finally {
            try { await pdfDocForCount.destroy(); } catch (_) {}
          }
          if (typeof ProgressUI !== 'undefined') {
            ProgressUI.setLabel('Studio OCR complete.');
            ProgressUI.finish();
            setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 500);
          }
        } else {
          if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
            ProgressUI.show(`Reading ${file.name}`, 'Reading text locally...');
          }
          extractedContent = await file.text(); // plain text: NO math post-processing
          if (typeof ProgressUI !== 'undefined') {
            ProgressUI.finish();
            setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 400);
          }
        }
        window.APP_STATE.attachedFiles[job.fileId] = {
          ...makeAttachedFileContent(file, extractedContent),
          status: extractedContent ? 'ready' : 'skipped', sourceMode: 'ocr', order: job.index,
          needsVision: job.ext === 'pdf' && Array.isArray(extractTextFromPDFWithOCRFallback.lastVisionDataUrls) && extractTextFromPDFWithOCRFallback.lastVisionDataUrls.length > 0,
          visionDataUrls: job.ext === 'pdf' && Array.isArray(extractTextFromPDFWithOCRFallback.lastVisionDataUrls) ? extractTextFromPDFWithOCRFallback.lastVisionDataUrls : [],
          figureTokens: job.ext === 'pdf' && Array.isArray(extractTextFromPDFWithOCRFallback.lastFigureTokens) ? extractTextFromPDFWithOCRFallback.lastFigureTokens : []
        };
        if (typeof displayToastNotification === 'function') {
          displayToastNotification(`✅ Loaded: ${file.name} — Studio OCR/local extraction complete`);
        }
      } catch (error) {
        console.error(`Attachment read failed for ${file.name}:`, error);
        try { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); } catch (e) {}
        window.APP_STATE.attachedFiles[job.fileId] = {
          name: file.name, content: '', sent: false, status: 'error', sourceMode: 'ocr', order: job.index
        };
        if (typeof displayToastNotification === 'function') {
          displayToastNotification(`Error Error reading ${file.name}: ${error.message}`);
        }
      }
    }
  } finally {
    const input = document.getElementById('file-upload-input');
    if (input) input.value = '';
    if (typeof renderAttachmentBar === 'function') renderAttachmentBar();
    if (typeof syncCurrentTabFileObjects === 'function') syncCurrentTabFileObjects();
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
      TAB_MANAGER._persist();
    }
  }
}

// ===== ATTACHMENT BAR (built with DOM APIs: file names are never parsed as HTML) =====
function renderAttachmentBar() {
  const bar = document.getElementById('attachment-bar');
  if (!bar) return;
  bar.textContent = '';
  if (!window.APP_STATE || !window.APP_STATE.attachedFiles) return;
  for (const [id, fileData] of Object.entries(window.APP_STATE.attachedFiles)) {
    const tag = document.createElement('div');
    tag.className = 'file-tag';
    tag.setAttribute('data-id', id);

    const nameEl = document.createElement('span');
    nameEl.className = 'file-tag-name';
    nameEl.textContent = fileData.name || 'file';
    tag.appendChild(nameEl);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-tag-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeAttachedFile(id); });
    tag.appendChild(removeBtn);

    const hasContent = fileData.content && fileData.content.length > 0;
    if (!hasContent) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-vision-btn';
      btn.textContent = ' Retry OCR';
      btn.title = 'Read this file again using local OCR only';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleFileWithStudioOCR(id);
      });
      tag.appendChild(btn);
    }
    bar.appendChild(tag);
  }
}

function removeAttachedFile(fileId) {
  if (!window.APP_STATE) return;
  try { releasePdfFigures(window.APP_STATE.attachedFiles[fileId] && window.APP_STATE.attachedFiles[fileId].figureTokens); } catch (_) {}
  delete window.APP_STATE.attachedFiles[fileId];
  delete window.APP_STATE.fileObjects[fileId];
  renderAttachmentBar();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
    TAB_MANAGER._persist();
  }
}

function handleSidebarFileDrop(event) {
  event.preventDefault();
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('drag-over');
  const files = event.dataTransfer?.files;
  if (files && files.length) handleFileUploads(files);
}

async function handleFileWithStudioOCR(fileId) {
  if (!window.APP_STATE) return;
  const fileData = window.APP_STATE.attachedFiles[fileId];
  const file = window.APP_STATE.fileObjects && window.APP_STATE.fileObjects[fileId];
  if (!fileData || !file) {
    if (typeof displayToastNotification === 'function') {
      displayToastNotification('⚠️ File data not available. Please re-upload the file.');
    }
    return;
  }
  const ext = file.name.split('.').pop().toLowerCase();
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
  // old figure tokens are released only AFTER the new read succeeded, so a failed retry never leaves dangling tokens
  const oldTokens = Array.isArray(fileData.figureTokens) ? fileData.figureTokens.slice() : [];
  try {
    let extractedContent = '';
    let newTokens = [];
    let newNeedsVision = false;
    let newVisionUrls = [];
    if (IMAGE_EXTS.includes(ext)) {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(`Retrying OCR: ${file.name}`, 'Local OCR is reading the image again...');
      }
      resetVisionBreaker();
      const result = await runOcrOnImageFile(file);
      extractedContent = postProcessOCRTextForMath(String(result?.text || '').trim());
      newTokens = Array.isArray(result?.figureTokens) ? result.figureTokens : [];
      if (result?.confidence != null) fileData.ocrConfidence = result.confidence;
      newNeedsVision = !!result?.needsVision;
      newVisionUrls = result?.visionDataUrl ? [result.visionDataUrl] : [];
    } else if (ext === 'pdf') {
      const pdfDoc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      try {
        const totalPages = pdfDoc.numPages;
        const range = await promptForPageRange(totalPages);
        if (!range) return;
        if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
          ProgressUI.show(`Retrying OCR: ${file.name}`, `Pages ${range.start}–${range.end}...`);
          ProgressUI.clearPreview();
        }
        extractedContent = await extractTextFromPDFWithOCRFallback(file, range.start, range.end, pdfDoc); // math already applied
      } finally {
        try { await pdfDoc.destroy(); } catch (_) {}
      }
      newTokens = Array.isArray(extractTextFromPDFWithOCRFallback.lastFigureTokens) ? extractTextFromPDFWithOCRFallback.lastFigureTokens : [];
      newNeedsVision = Array.isArray(extractTextFromPDFWithOCRFallback.lastVisionDataUrls) && extractTextFromPDFWithOCRFallback.lastVisionDataUrls.length > 0;
      newVisionUrls = newNeedsVision ? extractTextFromPDFWithOCRFallback.lastVisionDataUrls : [];
    } else if (ext === 'docx') {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(`Reading ${file.name}`, 'Extracting document text locally...');
      }
      extractedContent = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value || '';
    } else {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(`Reading ${file.name}`, 'Reading text locally...');
      }
      extractedContent = await file.text();
    }
    releasePdfFigures(oldTokens);
    fileData.figureTokens = newTokens;
    fileData.needsVision = newNeedsVision;
    fileData.visionDataUrls = newVisionUrls;
    fileData.content = extractedContent;
    fileData.sent = false;
    fileData.sourceMode = 'ocr';
    fileData.status = extractedContent ? 'ready' : 'skipped';
    const currentHTML = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
    const isCanvasEmpty = currentHTML.includes('Start typing here');
    if (extractedContent) {
      const newHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(extractedContent) : extractedContent;
      if (typeof setDocumentHTMLAndPaginate === 'function') {
        if (isCanvasEmpty) setDocumentHTMLAndPaginate(newHTML);
        else setDocumentHTMLAndPaginate(currentHTML + '<br><br>' + newHTML);
      }
      if (typeof displayToastNotification === 'function') {
        displayToastNotification(`✅ OCR extracted content from "${file.name}"`);
      }
    } else {
      if (typeof displayToastNotification === 'function') {
        displayToastNotification(`⚠️ No readable text found in "${file.name}" — skipped.`);
      }
    }
    if (typeof ProgressUI !== 'undefined') {
      ProgressUI.finish();
      setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 500);
    }
    renderAttachmentBar();
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
      TAB_MANAGER._persist();
    }
  } catch (err) {
    if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
    fileData.status = 'error';
    if (typeof displayToastNotification === 'function') {
      displayToastNotification(`Error OCR failed for "${file.name}": ${err.message}`);
    }
    renderAttachmentBar();
  }
}

// Backward compatibility
async function handleFileWithAIVision(fileId) {
  return handleFileWithStudioOCR(fileId);
}

// ===== OCR CONFIDENCE BADGE =====
function getConfidenceBadge(confidence) {
  if (confidence >= 75) return '<span class="ocr-confidence-badge ocr-conf-high">High </span>';
  if (confidence >= 45) return '<span class="ocr-confidence-badge ocr-conf-med">Medium ~</span>';
  return '<span class="ocr-confidence-badge ocr-conf-low">Low Warning</span>';
}

// ============================================================
// WINDOW EXPOSURE – OCR
// ============================================================
window.handleFileUploads = handleFileUploads;
window.handleSidebarFileDrop = handleSidebarFileDrop;
window.renderAttachmentBar = renderAttachmentBar;
window.runOcrOnImageFile = runOcrOnImageFile;
window.extractTextFromPDFWithOCRFallback = extractTextFromPDFWithOCRFallback;
window.runGeminiVisionOCRFromDataUrl = runGeminiVisionOCRFromDataUrl;
window.callGeminiVisionForOCR = callGeminiVisionForOCR;
window.terminateOcrWorkersForCancellation = terminateOcrWorkersForCancellation;
