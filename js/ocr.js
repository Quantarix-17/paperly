// ========================================================================
// OCR PIPELINE - Local OCR for images and PDFs using Tesseract.js
// ========================================================================

let ocrWorkerPool = [];
let ocrWorkerPoolInitPromise = null;

// ===== OCR WORKER MANAGEMENT =====
async function createConfiguredOcrWorker() {
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

async function ensureOcrWorkerPool(size) {
  size = Math.max(1, Math.min(size || 1, APP_CONFIG.OCR_MAX_PARALLEL_WORKERS || 2));
  if (ocrWorkerPool.length >= size) return ocrWorkerPool.slice(0, size);

  if (ocrWorkerPoolInitPromise) {
    await ocrWorkerPoolInitPromise;
    if (ocrWorkerPool.length >= size) return ocrWorkerPool.slice(0, size);
  }

  const targetSize = size;
  ocrWorkerPoolInitPromise = (async () => {
    const toCreate = Math.max(0, targetSize - ocrWorkerPool.length);
    const created = [];
    for (let i = 0; i < toCreate; i++) {
      const worker = await createConfiguredOcrWorker();
      created.push({ worker, busy: false });
    }
    ocrWorkerPool.push(...created);
  })();

  try {
    await ocrWorkerPoolInitPromise;
  } finally {
    ocrWorkerPoolInitPromise = null;
  }
  return ocrWorkerPool.slice(0, size);
}

async function terminateOcrWorkersForCancellation() {
  try {
    const pool = Array.isArray(ocrWorkerPool) ? ocrWorkerPool.slice() : [];
    ocrWorkerPool = [];
    await Promise.all(pool.map(async (slot) => {
      try { if (slot && slot.worker && typeof slot.worker.terminate === 'function') await slot.worker.terminate(); } catch (e) {}
    }));
  } catch (e) {}
}

async function replaceTimedOutOcrWorker(slot) {
  if (!slot) return;
  try {
    if (slot.worker && typeof slot.worker.terminate === 'function') await slot.worker.terminate();
  } catch (e) {
    console.warn('Failed to terminate timed-out OCR worker:', e);
  }
  try {
    slot.worker = await createConfiguredOcrWorker();
  } catch (e) {
    console.error('Could not replace OCR worker:', e);
  }
}

// ===== OCR IMAGE PREPROCESSING =====
function createOcrCanvasFromImage(img, scale = 1, mode = 'base', rotateDeg = 0) {
  const naturalW = Math.max(1, img.naturalWidth || img.width || 1);
  const naturalH = Math.max(1, img.naturalHeight || img.height || 1);
  const baseScale = Math.max(0.5, Math.min(4.0, scale));
  let w = Math.max(1, Math.round(naturalW * baseScale));
  let h = Math.max(1, Math.round(naturalH * baseScale));

  const maxPixels = APP_CONFIG.OCR_MAX_IMAGE_PIXELS || 18000000;
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

  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const gray = new Uint8ClampedArray(canvas.width * canvas.height);
    let mean = 0;
    for (let p = 0, j = 0; p < data.length; p += 4, j++) {
      const g = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
      gray[j] = g;
      mean += g;
    }
    mean /= Math.max(1, gray.length);

    let variance = 0;
    for (let j = 0; j < gray.length; j++) {
      const d = gray[j] - mean;
      variance += d * d;
    }
    const contrastStd = Math.sqrt(variance / Math.max(1, gray.length));

    for (let p = 0, j = 0; p < data.length; p += 4, j++) {
      let v = gray[j];
      if (mode === 'base') {
        const gain = contrastStd < 34 ? 1.55 : contrastStd < 50 ? 1.25 : 1.08;
        v = Math.max(0, Math.min(255, Math.round((v - mean) * gain + 128)));
      } else if (mode === 'threshold') {
        const t = mean - (contrastStd < 38 ? 6 : 0);
        v = v < t ? 0 : 255;
      } else if (mode === 'inverted') {
        v = 255 - v;
        const gain = contrastStd < 50 ? 1.15 : 1.0;
        v = Math.max(0, Math.min(255, Math.round((v - 128) * gain + 128)));
      } else if (mode === 'soft') {
        v = Math.max(0, Math.min(255, Math.round((v - mean) * 1.18 + 135)));
      }
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (e) {
    console.warn('Advanced OCR preprocessing skipped:', e);
  }
  return canvas;
}

function preprocessCanvasForOcr(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const contrasted = Math.min(255, Math.max(0, (gray - 128) * 1.28 + 132));
      data[i] = data[i + 1] = data[i + 2] = contrasted;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (e) { console.warn('OCR preprocessing skipped:', e); }
  return canvas;
}

function createOcrVariantFromCanvas(sourceCanvas, mode = 'base') {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let mean = 0;
    const gray = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let p = 0, j = 0; p < data.length; p += 4, j++) {
      const g = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
      gray[j] = g;
      mean += g;
    }
    mean /= Math.max(1, gray.length);
    let variance = 0;
    for (let j = 0; j < gray.length; j++) {
      const d = gray[j] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / Math.max(1, gray.length));
    for (let p = 0, j = 0; p < data.length; p += 4, j++) {
      let v = gray[j];
      if (mode === 'threshold') {
        const t = mean - (std < 42 ? 8 : 2);
        v = v < t ? 0 : 255;
      } else if (mode === 'inverted') {
        v = 255 - v;
        v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.2 + 128)));
      } else if (mode === 'soft') {
        v = Math.max(0, Math.min(255, Math.round((v - mean) * (std < 45 ? 1.35 : 1.12) + 132)));
      } else {
        v = Math.max(0, Math.min(255, Math.round((v - mean) * 1.15 + 132)));
      }
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (e) {
    console.warn('OCR variant preprocessing skipped:', e);
  }
  return canvas;
}

// ===== OCR RECOGNITION WITH TIMEOUT =====
async function recognizeWithTimeout(worker, canvas, timeoutMs) {
  const timeout = Math.max(3000, Number(timeoutMs) || 15000);
  let timer = null;
  try {
    return await Promise.race([
      worker.recognize(canvas),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`OCR recognition timeout after ${Math.round(timeout / 1000)}s`)), timeout);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ===== OCR LINE NORMALIZATION =====
function normalizeOcrLineText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[|¦]+/g, 'I')
    .trim()
    .toLowerCase();
}

function getOcrLineCount(text) {
  return String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean).length;
}

function mergeOcrCandidates(primary, secondary) {
  const primaryText = String(primary?.text || '').trim();
  const secondaryText = String(secondary?.text || '').trim();
  if (!primaryText) return secondary || { text: '', confidence: 0 };
  if (!secondaryText) return primary || { text: '', confidence: 0 };

  const seen = new Set(primaryText.split(/\n+/).map(normalizeOcrLineText).filter(Boolean));
  const extras = [];
  for (const line of secondaryText.split(/\n+/)) {
    const n = normalizeOcrLineText(line);
    if (!n || n.length < 2 || seen.has(n)) continue;
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
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
async function recognizeImageWithOcr(imageSource) {
  const workerCount = Math.max(1, Math.min(
    APP_CONFIG.OCR_MAX_PARALLEL_WORKERS || 2,
    4
  ));
  const pool = await ensureOcrWorkerPool(workerCount);
  let slot = null;
  while (!slot) {
    slot = pool.find(item => item && !item.busy) || null;
    if (!slot) await new Promise(resolve => setTimeout(resolve, 15));
  }

  slot.busy = true;
  try {
    const candidates = [];
    const baseW = imageSource?.width || 1;
    const baseH = imageSource?.height || 1;
    const longEdge = Math.max(baseW, baseH);
    const extraScale = longEdge < 1800 ? (APP_CONFIG.OCR_SMALL_TEXT_SCALE || 3.2) : 1;
    const passes = [
      { psm: '6', mode: 'base', scale: Math.max(1, extraScale) },
      { psm: '11', mode: 'soft', scale: Math.max(1, Math.min(extraScale, 3.0)) },
      { psm: '12', mode: 'threshold', scale: Math.max(1, Math.min(extraScale, 3.0)) },
      { psm: '7', mode: 'base', scale: Math.max(1, Math.min(extraScale, 3.0)) }
    ].slice(0, APP_CONFIG.OCR_HIGH_ACCURACY_PASSES || 4);
    const maxTotalPasses = Math.max(1, Number(APP_CONFIG.OCR_MAX_TOTAL_PASSES) || passes.length);
    const triagePasses = Math.max(1, Math.min(Number(APP_CONFIG.OCR_FAST_TRIAGE_PASSES) || 2, passes.length));
    const triageTimeout = Math.max(1200, Number(APP_CONFIG.OCR_FAST_TRIAGE_TIMEOUT_MS) || 2200);
    const deepTimeout = Math.max(2500, Number(APP_CONFIG.OCR_PASS_TIMEOUT_MS) || 5000);
    let attemptCount = 0;
    let sawAnyText = false;

    // FAST TRIAGE
    for (let i = 0; i < triagePasses && attemptCount < maxTotalPasses; i++) {
      const pass = passes[i];
      attemptCount++;
      try {
        await slot.worker.setParameters({
          tessedit_pageseg_mode: pass.psm,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
        });
        const candidateCanvas = (i === 0 && pass.mode === 'base') ? imageSource : createOcrVariantFromCanvas(imageSource, pass.mode);
        const { data } = await recognizeWithTimeout(slot.worker, candidateCanvas, triageTimeout);
        const candidate = {
          text: (data && data.text) ? data.text.trim() : '',
          confidence: (data && typeof data.confidence === 'number') ? data.confidence : 0,
          lineCount: getOcrLineCount(data && data.text)
        };
        if (candidate.text) {
          candidates.push(candidate);
          sawAnyText = true;
          if (candidate.confidence >= (APP_CONFIG.OCR_MIN_CONFIDENCE_FOR_SINGLE_PASS || 82) && candidate.lineCount >= 3) {
            return { text: candidate.text, confidence: candidate.confidence || 0, passes: attemptCount, lineCount: candidate.lineCount, skipped: false };
          }
        }
      } catch (err) {
        console.warn(`OCR triage pass ${pass.psm}/${pass.mode} failed:`, err);
        if (/timeout/i.test(String(err?.message || ''))) await replaceTimedOutOcrWorker(slot);
      }
    }

    if (!sawAnyText) {
      return { text: '', confidence: 0, passes: attemptCount, lineCount: 0, skipped: true, skipReason: 'Fast OCR triage found no readable text; non-text region skipped.' };
    }

    // DEEP PASSES
    for (let i = triagePasses; i < passes.length && attemptCount < maxTotalPasses; i++) {
      const pass = passes[i];
      attemptCount++;
      try {
        await slot.worker.setParameters({
          tessedit_pageseg_mode: pass.psm,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
        });
        const candidateCanvas = createOcrVariantFromCanvas(imageSource, pass.mode);
        const { data } = await recognizeWithTimeout(slot.worker, candidateCanvas, deepTimeout);
        const candidate = {
          text: (data && data.text) ? data.text.trim() : '',
          confidence: (data && typeof data.confidence === 'number') ? data.confidence : 0,
          lineCount: getOcrLineCount(data && data.text)
        };
        if (candidate.text) candidates.push(candidate);
      } catch (err) {
        console.warn(`OCR refinement pass ${pass.psm}/${pass.mode} failed:`, err);
        if (/timeout/i.test(String(err?.message || ''))) await replaceTimedOutOcrWorker(slot);
      }
    }

    // ROTATION RECOVERY
    const bestSoFar = candidates[0] || { text: '', confidence: 0, lineCount: 0 };
    if ((bestSoFar.confidence < 55 || bestSoFar.lineCount < 2) && imageSource && typeof imageSource.toDataURL === 'function' && attemptCount < maxTotalPasses) {
      try {
        const rotatedDataUrl = imageSource.toDataURL('image/png');
        const rotatedImg = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = reject;
          im.src = rotatedDataUrl;
        });
        for (const angle of [90, 270]) {
          if (attemptCount >= maxTotalPasses) break;
          attemptCount++;
          try {
            const rotatedCanvas = createOcrCanvasFromImage(rotatedImg, 1, 'base', angle);
            await slot.worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' });
            const { data } = await recognizeWithTimeout(slot.worker, rotatedCanvas, APP_CONFIG.OCR_PASS_TIMEOUT_MS || 15000);
            const candidate = {
              text: (data && data.text) ? data.text.trim() : '',
              confidence: (data && typeof data.confidence === 'number') ? data.confidence : 0,
              lineCount: getOcrLineCount(data && data.text)
            };
            if (candidate.text) candidates.push(candidate);
          } catch (rotationError) {
            console.warn(`OCR rotation ${angle} failed:`, rotationError);
            if (/timeout/i.test(String(rotationError?.message || ''))) await replaceTimedOutOcrWorker(slot);
          }
        }
      } catch (rotationSetupError) {
        console.warn('OCR rotation recovery skipped:', rotationSetupError);
      }
    }

    if (!candidates.length) {
      return {
        text: '', confidence: 0, passes: attemptCount,
        lineCount: 0, skipped: true,
        skipReason: 'No readable text detected after bounded OCR attempts; region skipped.'
      };
    }

    candidates.sort((a, b) => {
      const score = c => (c.confidence || 0) + Math.min(35, Math.log1p((c.text || '').length) * 2.2);
      return score(b) - score(a);
    });
    let merged = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      if ((c.confidence || 0) >= 35 || (c.text || '').length > 25) {
        merged = mergeOcrCandidates(merged, c);
      }
    }
    return {
      text: merged.text,
      confidence: merged.confidence || 0,
      passes: attemptCount,
      lineCount: merged.lineCount || getOcrLineCount(merged.text),
      skipped: false
    };
  } finally {
    slot.busy = false;
  }
}

// ===== GEMINI VISION OCR FALLBACK =====
// Used ONLY when the default local pipeline (Tesseract / pdf.js text layer) fails to
// read a file. This keeps everything local-first and fast, and only spends an API call
// on the rare page/image that the local engine genuinely can't handle (e.g. very messy
// handwriting, unusual fonts, exotic scripts Tesseract wasn't loaded for).
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

async function callGeminiVisionForOCR(cfg, base64Data, mimeType) {
  const geminiUrl = cfg.apiUrl.endsWith('?key=') ? cfg.apiUrl + encodeURIComponent(cfg.apiKey) :
    cfg.apiUrl + (cfg.apiUrl.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(cfg.apiKey);
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: GEMINI_VISION_OCR_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64Data } }
      ]
    }],
    generationConfig: { temperature: 0 }
  };
  const response = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let detail = '';
    try { const j = await response.json(); detail = j.error?.message || JSON.stringify(j); }
    catch (_) { try { detail = await response.text(); } catch (_2) {} }
    throw new Error(`Gemini Vision OCR error (${response.status}): ${detail || 'no further details returned'}`);
  }
  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '').trim();
  if (!text || /^\[NO_TEXT_FOUND\]$/i.test(text)) return '';
  return text;
}

function getVisionFallbackModelCandidates() {
  const models = Array.isArray(AI_MODELS_STATE?.models) ? AI_MODELS_STATE.models : [];
  if (!models.length) return [];

  const active = typeof getActiveAIModel === 'function' ? getActiveAIModel() : null;
  const ordered = [];
  if (active) ordered.push(active);

  for (const model of models) {
    if (!ordered.some(m => m.id === model.id)) ordered.push(model);
  }

  return ordered.filter(model => model && (model.apiType === 'gemini' || model.apiType === 'openai'));
}

async function callVisionModelForOCR(cfg, dataUrl, label) {
  const parsed = _parseDataUrl(dataUrl);
  if (!parsed) return '';

  if (cfg?.apiType === 'gemini') {
    return await callGeminiVisionForOCR(cfg, parsed.base64Data, parsed.mimeType);
  }

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: GEMINI_VISION_OCR_PROMPT },
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

async function runGeminiVisionOCRFromDataUrl(dataUrl, label) {
  const models = getVisionFallbackModelCandidates();
  if (!models.length) return '';

  const original = typeof getActiveAIModel === 'function' ? getActiveAIModel() : null;
  let lastErr = null;
  let chosen = null;

  for (const cfg of models) {
    try {
      if (cfg && typeof switchActiveModelTo === 'function' && original && cfg.id !== original.id) {
        switchActiveModelTo(cfg, original);
      }

      const text = await callVisionModelForOCR(cfg, dataUrl, label);
      if (text && String(text).trim()) {
        chosen = cfg;
        if (original && cfg.id !== original.id && typeof switchActiveModelTo === 'function') {
          switchActiveModelTo(original, cfg);
        }
        return text;
      }
    } catch (err) {
      lastErr = err;
      console.warn(`Vision OCR fallback failed on "${cfg?.name || cfg?.modelId || 'model'}"${label ? ` for ${label}` : ''}:`, err);
      if (cfg && typeof markModelFailure === 'function') {
        try { markModelFailure(cfg, err); } catch (_) {}
      }
    }
  }

  if (original && typeof switchActiveModelTo === 'function') {
    try { switchActiveModelTo(original, chosen || models[models.length - 1] || original); } catch (_) {}
  }

  if (lastErr) console.warn(`All vision OCR fallback models failed${label ? ` for ${label}` : ''}:`, lastErr);
  return '';
}

// ===== RUN OCR ON IMAGE FILE =====
async function runOcrOnImageFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image file'));
    image.src = dataUrl;
  });

  const longEdge = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
  const targetLongEdge = APP_CONFIG.OCR_TARGET_LONG_EDGE || 4200;
  const scale = Math.min(3.2, Math.max(1, targetLongEdge / Math.max(1, longEdge)));
  const canvas = createOcrCanvasFromImage(img, scale, 'base', 0);
  let result = await recognizeImageWithOcr(canvas);
  const isWeakOcrResult = (candidate) => {
    const text = String(candidate?.text || '').trim();
    const confidence = Number(candidate?.confidence) || 0;
    const lineCount = Number(candidate?.lineCount) || getOcrLineCount(text);
    return !text || (confidence < 50 && lineCount < 2);
  };
  if (result && String(result.text || '').trim()) {
    if (!isWeakOcrResult(result)) return result;
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = canvas.width;
    cleanCanvas.height = canvas.height;
    const cleanCtx = cleanCanvas.getContext('2d');
    cleanCtx.drawImage(img, 0, 0, cleanCanvas.width, cleanCanvas.height);
    try {
      const retry = await recognizeImageWithOcr(cleanCanvas);
      if (retry && String(retry.text || '').trim() && !isWeakOcrResult(retry)) return retry;
      if (retry && String(retry.text || '').trim()) result = retry;
    } catch (retryError) {
      console.warn('Clean-image OCR retry failed:', retryError);
    }
    const visionText = await runGeminiVisionOCRFromDataUrl(dataUrl, file.name);
    if (visionText) {
      return {
        text: visionText,
        confidence: 60,
        passes: result?.passes || 0,
        lineCount: getOcrLineCount(visionText),
        skipped: false,
        source: 'gemini-vision'
      };
    }
    return { ...result, needsVision: true, visionDataUrl: dataUrl };
  }

  // Local OCR found nothing at all — this is exactly the "default system fails to read
  // the file" case. Fall back to Gemini Vision if a Gemini model is configured.
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
  throw new Error('OCR could not read this file, and AI vision also failed to extract readable text.');
}

async function runOCRWithAIFallback(file, options = {}) {
  const ext = String(file?.name || '').split('.').pop().toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
  try {
    if (imageExts.includes(ext)) {
      const result = await runOcrOnImageFile(file);
      if (result && String(result.text || '').trim()) return { ...result, source: result.source || 'ocr' };
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
  if (!Array.isArray(files) || files.length === 0) return [];

  const progressKeys = Array.isArray(options.progressKeys) ? options.progressKeys : files.map((file, index) => `${file.name}#ocr#${index}`);
  const preservePreview = !!options.preservePreview;
  const queue = files.map((file, index) => ({ file, index, progressKey: progressKeys[index] }));
  const results = new Array(files.length).fill(null);
  const parallel = Math.max(1, Math.min(
    APP_CONFIG.OCR_MAX_PARALLEL_WORKERS || 2,
    Math.min(queue.length, 4)
  ));
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
      if (itemIndex >= queue.length || isCancellationRequested) return;
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
          error: null
        };
        if (ocrResult?.skipped && !String(ocrResult?.text || '').trim()) {
          const skipMeta = ocrResult?.skipReason || 'No readable text detected; skipped this non-text region.';
          if (typeof ProgressUI !== 'undefined' && ProgressUI.updateFileProgress) {
            ProgressUI.updateFileProgress(progressKey, 100, 'Skipped', skipMeta, 'fallback');
          }
        } else {
          const confidenceText = ocrResult?.needsVision
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
    t = t.replace(/([A-Za-z])\s*([0-9]{1,2})\b/g, '$1_$2');
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
  const mathSignals = (t.match(/(?:=|\\times|\\div|\\sqrt|\\frac|\^|≤|≥|≠|≈|∑|∫|π|θ|\bcos\b|\bsin\b|\btan\b)/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  return mathSignals >= 1 && (digits >= 1 || letters >= 2);
}

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

// ===== PDF TEXT EXTRACTION WITH OCR =====
async function extractTextFromPDFWithOCRFallback(file, startPage, endPage) {
  extractTextFromPDFWithOCRFallback.lastVisionDataUrls = [];
  const pdfDoc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const totalPages = pdfDoc.numPages;
  const start = Math.max(1, startPage || 1);
  const end = Math.min(totalPages, endPage || totalPages);
  const pagesToProcess = end - start + 1;

  if (typeof ProgressUI !== 'undefined') {
    ProgressUI.clearPreview();
    ProgressUI.setLabel(`Reading pages ${start}–${end} of ${totalPages}...`);
    ProgressUI.startStepEstimate(pagesToProcess);
  }

  const results = new Array(pagesToProcess).fill(null);
  const needsOcr = [];
  for (let idx = 0; idx < pagesToProcess; idx++) {
    const pageNum = start + idx;
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(it => it.str).join(' ').trim();
    const isLikelyScanned = pageText.length < APP_CONFIG.OCR_MIN_TEXT_LEN_PER_PAGE && textContent.items.length < APP_CONFIG.OCR_MIN_TEXT_ITEMS_PER_PAGE;
    if (isLikelyScanned) {
      needsOcr.push({ idx, pageNum, page });
    } else {
      results[idx] = { text: pageText, ocr: false };
      if (typeof ProgressUI !== 'undefined' && ProgressUI.addPagePreview) {
        ProgressUI.addPagePreview(` Page ${pageNum} (text)`, pageText.slice(0, 120) + (pageText.length > 120 ? '…' : ''), 'done');
      }
    }
  }

  let completedSteps = pagesToProcess - needsOcr.length;
  if (typeof ProgressUI !== 'undefined' && ProgressUI.reportStepComplete) {
    ProgressUI.reportStepComplete(completedSteps);
  }

  let avgConf = 0;
  if (needsOcr.length > 0 && !isCancellationRequested) {
    // We'll process scanned pages using the full image OCR pipeline.
    if (typeof ProgressUI !== 'undefined' && ProgressUI.setLabel) {
      ProgressUI.setLabel(`OCR reading ${needsOcr.length} scanned page(s) with full pipeline...`);
    }

    // Process each page in parallel by rendering to a canvas and calling recognizeImageWithOcr.
    const ocrResults = await Promise.all(
      needsOcr.map(async ({ idx, pageNum, page }) => {
        if (isCancellationRequested) {
          return { idx, pageNum, text: '', confidence: 0, skipped: true, skipReason: 'Cancelled' };
        }
        try {
          // 1. Determine scale to reach target long edge (like runOcrOnImageFile)
          const baseViewport = page.getViewport({ scale: 1 });
          const longEdge = Math.max(baseViewport.width, baseViewport.height);
          const targetLongEdge = APP_CONFIG.OCR_TARGET_LONG_EDGE || 4200;
          const scale = Math.min(3.2, Math.max(1, targetLongEdge / longEdge));

          // 2. Render page at that scale
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport }).promise;

          // 3. Optional preprocessing (the pipeline also creates variants)
          preprocessCanvasForOcr(canvas);

          // 4. Use the full OCR pipeline
          let result = await recognizeImageWithOcr(canvas);
          const resultText = String(result?.text || '').trim();
          const resultLines = Number(result?.lineCount) || getOcrLineCount(resultText);
          const resultIsWeak = !resultText || ((Number(result?.confidence) || 0) < 50 && resultLines < 2);
          if (resultText && !resultIsWeak) {
            return {
              idx,
              pageNum,
              text: result.text || '',
              confidence: result.confidence || 0,
              skipped: result.skipped || false,
              skipReason: result.skipReason || '',
              passes: result?.passes || 0,
              lineCount: result.lineCount
            };
          }

          // Local OCR found nothing on this scanned page — try Gemini Vision before
          // giving up on it, same "default system failed" fallback used for images.
          const visionDataUrl = canvas.toDataURL('image/jpeg', 0.92);
          const visionText = await runGeminiVisionOCRFromDataUrl(visionDataUrl, `page ${pageNum}`);
          if (visionText) {
            return {
              idx,
              pageNum,
              text: visionText,
              confidence: 60,
              skipped: false,
              skipReason: '',
              passes: result.passes,
              lineCount: getOcrLineCount(visionText),
              source: 'gemini-vision'
            };
          }
          return {
            idx,
            pageNum,
            text: result?.text || '',
            confidence: result?.confidence || 0,
            skipped: result?.skipped || false,
            skipReason: result?.skipReason || '',
            passes: result?.passes || 0,
            lineCount: result?.lineCount || 0,
            needsVision: true,
            visionDataUrl
          };
        } catch (err) {
          console.warn(`OCR failed on page ${pageNum}:`, err);
          return { idx, pageNum, text: '', confidence: 0, skipped: true, skipReason: 'OCR error' };
        }
      })
    );

    // Fill results and update progress
    for (const res of ocrResults) {
      results[res.idx] = {
        text: res.text,
        ocr: true,
        confidence: res.confidence,
        skipped: res.skipped,
        skipReason: res.skipReason,
        needsVision: !!res.needsVision,
        visionDataUrls: res.visionDataUrl ? [res.visionDataUrl] : []
      };
      completedSteps++;
      if (typeof ProgressUI !== 'undefined') {
        const previewContainer = document.getElementById('progress-live-preview');
        if (previewContainer) {
          // Update preview if exists
          const items = previewContainer.querySelectorAll('.progress-page-thumb');
          const lastItem = items[items.length - 1];
          if (lastItem) {
            lastItem.className = `progress-page-thumb ${res.skipped ? 'done' : 'done'}`;
            const thumbText = lastItem.querySelector('.thumb-text');
            const thumbBadge = lastItem.querySelector('.thumb-badge');
            if (thumbText) thumbText.textContent = res.text ? res.text.slice(0, 140) + (res.text.length > 140 ? '…' : '') : (res.skipReason || 'Skipped');
            if (thumbBadge) thumbBadge.textContent = res.skipped ? 'Skipped' : '';
          }
        }
        ProgressUI.setLabel(`OCR reading page ${res.pageNum} (${completedSteps}/${pagesToProcess}) — ${res.skipped ? 'skipped' : 'complete'}`);
        ProgressUI.reportStepComplete(completedSteps);
      }
    }

    // Compute average confidence
    let totalConfidence = 0, confCount = 0;
    for (const r of results) {
      if (r && r.ocr && r.confidence > 0) {
        totalConfidence += r.confidence;
        confCount++;
      }
    }
    avgConf = confCount > 0 ? Math.round(totalConfidence / confCount) : 0;

    if (needsOcr.length > 0 && results.every(r => r && r.ocr && r.needsVision)) {
      throw new Error('Both local OCR and AI vision failed to read this PDF.');
    }

    if (isCancellationRequested) {
      if (typeof displayToastNotification === 'function') {
        displayToastNotification(`Cancelled — ${completedSteps}/${pagesToProcess} page(s) read, rest saved as blank.`);
      }
    }
  }

  let fullText = '';
  let ocrPageCount = 0;
  const visionDataUrls = [];
  for (let idx = 0; idx < pagesToProcess; idx++) {
    const pageNum = start + idx;
    const r = results[idx] || { text: '', ocr: false };
    if (r.ocr) ocrPageCount++;
    if (Array.isArray(r.visionDataUrls)) visionDataUrls.push(...r.visionDataUrls);
    fullText += `\n--- Page ${pageNum}${r.text ? '' : ' (empty)'} ---\n` + r.text;
    // Add preview if not already
    if (typeof ProgressUI !== 'undefined' && r.text) {
      ProgressUI.addPagePreview(` Page ${pageNum}${r.ocr ? ' (OCR)' : ''}`, r.text.slice(0, 120) + (r.text.length > 120 ? '…' : ''), 'done');
    }
  }

  if (ocrPageCount > 0) {
    if (typeof displayToastNotification === 'function') {
      displayToastNotification(` OCR applied to ${ocrPageCount} scanned page(s)`);
    }
    fullText =
      `[OCR Quality: Avg confidence ${avgConf}% on ${ocrPageCount} page(s), ${Math.min(APP_CONFIG.OCR_MAX_PARALLEL_WORKERS, ocrPageCount)} parallel worker(s)]\n` +
      fullText;
  }

  if (typeof ProgressUI !== 'undefined') {
    ProgressUI.setLabel(`OCR finished: ${pagesToProcess}/${pagesToProcess} pages processed${ocrPageCount ? `; ${ocrPageCount} scanned page(s)` : ''}.`);
    ProgressUI.finish();
  }
  extractTextFromPDFWithOCRFallback.lastVisionDataUrls = visionDataUrls;
  return postProcessOCRTextForMath(fullText);
}

// ===== FILE HANDLING =====
function makeAttachedFileContent(file, extractedContent) {
  let content = extractedContent || '';
  const maxChars = APP_CONFIG.ATTACHMENT_MAX_TEXT_CHARS || 100000;
  if (content.length > maxChars) {
    content = content.substring(0, maxChars) + `\n...[ATTACHMENT CONTENT LIMIT: first ${maxChars} characters preserved]`;
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
          visionDataUrls: Array.isArray(result.visionDataUrls) ? result.visionDataUrls : []
        };
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
          extractedContent = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value || '[Empty DOCX]';
          extractedContent = postProcessOCRTextForMath(extractedContent);
        } else if (job.ext === 'pdf') {
          const pdfDocForCount = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
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
            extractedContent = await extractTextFromPDFWithOCRFallback(file, range.start, range.end);
          } catch (pdfError) {
            delete window.APP_STATE.fileObjects[job.fileId];
            delete window.APP_STATE.attachedFiles[job.fileId];
            if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
            if (typeof displayToastNotification === 'function') {
              displayToastNotification(`⚠️ Could not read "${file.name}". OCR could not extract text, and the AI fallback also failed to read it.`);
            }
            continue;
          }
          extractedContent = postProcessOCRTextForMath(extractedContent);
          if (typeof ProgressUI !== 'undefined') {
            ProgressUI.setLabel(`Studio OCR complete: pages ${range.start}–${range.end} processed.`);
            ProgressUI.finish();
            setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 500);
          }
        } else {
          if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
            ProgressUI.show(`Reading ${file.name}`, 'Reading text locally...');
          }
          extractedContent = postProcessOCRTextForMath(await file.text());
          if (typeof ProgressUI !== 'undefined') {
            ProgressUI.finish();
            setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 400);
          }
        }
        window.APP_STATE.attachedFiles[job.fileId] = {
          ...makeAttachedFileContent(file, extractedContent),
          status: extractedContent ? 'ready' : 'skipped', sourceMode: 'ocr', order: job.index,
          needsVision: job.ext === 'pdf' && Array.isArray(extractTextFromPDFWithOCRFallback.lastVisionDataUrls) && extractTextFromPDFWithOCRFallback.lastVisionDataUrls.length > 0,
          visionDataUrls: job.ext === 'pdf' && Array.isArray(extractTextFromPDFWithOCRFallback.lastVisionDataUrls) ? extractTextFromPDFWithOCRFallback.lastVisionDataUrls : []
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

// ===== ATTACHMENT BAR =====
function renderAttachmentBar() {
  const bar = document.getElementById('attachment-bar');
  if (!bar) return;
  bar.innerHTML = '';
  if (!window.APP_STATE || !window.APP_STATE.attachedFiles) return;
  for (const [id, fileData] of Object.entries(window.APP_STATE.attachedFiles)) {
    const tag = document.createElement('div');
    tag.className = 'file-tag';
    tag.setAttribute('data-id', id);
    const hasContent = fileData.content && fileData.content.length > 0;
    tag.innerHTML = ` ${fileData.name || 'file'} <button class="file-tag-remove" onclick="removeAttachedFile('${id}')">×</button>`;
    if (!hasContent) {
      const btn = document.createElement('button');
      btn.className = 'ai-vision-btn';
      btn.textContent = ' Retry OCR';
      btn.title = 'Read this file again using local OCR only';
      btn.onclick = (e) => {
        e.stopPropagation();
        handleFileWithStudioOCR(id);
      };
      tag.appendChild(btn);
    }
    bar.appendChild(tag);
  }
}

function removeAttachedFile(fileId) {
  if (!window.APP_STATE) return;
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
  try {
    let extractedContent = '';
    if (IMAGE_EXTS.includes(ext)) {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(`Retrying OCR: ${file.name}`, 'Local OCR is reading the image again...');
      }
      const result = await runOcrOnImageFile(file);
      extractedContent = postProcessOCRTextForMath(String(result?.text || '').trim());
      if (result?.confidence != null) fileData.ocrConfidence = result.confidence;
      fileData.needsVision = !!result?.needsVision;
      fileData.visionDataUrls = result?.visionDataUrl ? [result.visionDataUrl] : [];
    } else if (ext === 'pdf') {
      const pdfDoc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const totalPages = pdfDoc.numPages;
      const range = await promptForPageRange(totalPages);
      if (!range) return;
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(`Retrying OCR: ${file.name}`, `Pages ${range.start}–${range.end}...`);
        ProgressUI.clearPreview();
      }
      extractedContent = await extractTextFromPDFWithOCRFallback(file, range.start, range.end);
      extractedContent = postProcessOCRTextForMath(extractedContent);
      fileData.needsVision = Array.isArray(extractTextFromPDFWithOCRFallback.lastVisionDataUrls) && extractTextFromPDFWithOCRFallback.lastVisionDataUrls.length > 0;
      fileData.visionDataUrls = fileData.needsVision ? extractTextFromPDFWithOCRFallback.lastVisionDataUrls : [];
    } else if (ext === 'docx') {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(`Reading ${file.name}`, 'Extracting document text locally...');
      }
      extractedContent = postProcessOCRTextForMath((await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value || '');
    } else {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(`Reading ${file.name}`, 'Reading text locally...');
      }
      extractedContent = postProcessOCRTextForMath(await file.text());
    }
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
