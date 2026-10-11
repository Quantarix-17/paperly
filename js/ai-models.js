// ========================================================================
// AI MODELS MANAGER - Manage AI model configurations, testing, and selection
// ========================================================================

let AI_MODELS_STATE = { version: 1, models: [], activeModelId: null };
let _aiModelsStorageAvailable = true;
let _draggedModelId = null;
let _pendingFailedModelSave = null;
let _removeMode = { active: false, selected: new Set() };

// ===== LOAD / SAVE STATE =====
function loadAIModelsState() {
  try {
    const raw = localStorage.getItem(AI_MODELS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.models)) {
        const models = parsed.models.map(m => m.status === 'testing' ? { ...m, status: 'idle', statusMessage: '' } : m);
        // Auto-complete a missing /chat/completions on saved models — but never touch one that is already working.
        models.forEach(m => { if (m && m.status !== 'ok' && m.apiUrl) { const f = normalizeAIModelApiUrl(m.apiUrl, m.apiType, m.modelId); if (f.changed) m.apiUrl = f.url; } });
        AI_MODELS_STATE = { version: 1, models, activeModelId: parsed.activeModelId || (models[0] && models[0].id) || null };
      }
    }
  } catch (e) { console.error('Failed to load AI models state:', e); }
  _applyDailyModelReset();
}

// ===== DAILY RESET TO FIRST MODEL =====
// Whichever model the last request happened to land on (after failover
// through the list) otherwise stays active indefinitely. The first time
// the app is opened on a new local calendar day (i.e. any time after
// midnight that day), this jumps the active model back to the first one
// in the saved list — once per day, not on every load, so switching
// models by hand during the day isn't fought.
const AI_MODEL_DAILY_RESET_KEY = 'aiModelDailyResetDate_v1';
function _applyDailyModelReset() {
  try {
    if (!AI_MODELS_STATE.models.length) return;
    const todayStr = new Date().toDateString();
    if (localStorage.getItem(AI_MODEL_DAILY_RESET_KEY) === todayStr) return;
    AI_MODELS_STATE.activeModelId = AI_MODELS_STATE.models[0].id;
    localStorage.setItem(AI_MODEL_DAILY_RESET_KEY, todayStr);
    saveAIModelsState();
  } catch (_) { /* best-effort only */ }
}

function saveAIModelsState() {
  try {
    const payload = JSON.stringify(AI_MODELS_STATE);
    localStorage.setItem(AI_MODELS_STORAGE_KEY, payload);
    _aiModelsStorageAvailable = localStorage.getItem(AI_MODELS_STORAGE_KEY) === payload;
    return _aiModelsStorageAvailable;
  } catch (e) { return false; }
}

// ===== GET ACTIVE MODEL =====
function getActiveAIModel() {
  if (!AI_MODELS_STATE.activeModelId) return null;
  return AI_MODELS_STATE.models.find(m => m.id === AI_MODELS_STATE.activeModelId) || null;
}

// ===== FIND A GEMINI MODEL (for Google Search grounding / Vision OCR fallback) =====
// Prefers the currently active model if it's Gemini, otherwise falls back to the
// first configured Gemini model. Returns null if no Gemini model is configured.
function findGeminiModelConfig() {
  const active = getActiveAIModel();
  if (active && active.apiType === 'gemini') return active;
  const list = AI_MODELS_STATE.models || [];
  return list.find(m => m.apiType === 'gemini') || null;
}

function generateModelId() {
  return 'model_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===== SET ACTIVE MODEL =====
function setActiveAIModel(id) {
  if (id === '__add_new__') {
    if (typeof openAIModelsModal === 'function') openAIModelsModal();
    if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
    return;
  }
  AI_MODELS_STATE.activeModelId = id;
  saveAIModelsState();
  if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  const m = getActiveAIModel();
  if (m && typeof displayToastNotification === 'function') displayToastNotification(`✅ Active model: ${m.name}`);
}

// ===== DELETE MODEL =====
function deleteAIModel(id) {
  const m = AI_MODELS_STATE.models.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Delete the model "${m.name}"?`)) return;
  AI_MODELS_STATE.models = AI_MODELS_STATE.models.filter(x => x.id !== id);
  if (AI_MODELS_STATE.activeModelId === id) {
    AI_MODELS_STATE.activeModelId = AI_MODELS_STATE.models.length ? AI_MODELS_STATE.models[0].id : null;
  }
  saveAIModelsState();
  if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  if (typeof displayToastNotification === 'function') displayToastNotification(`🗑️ "${m.name}" deleted`);
}

// ===== API URL AUTO-FIX =====
// If the person pasted only the base URL (e.g. https://api.groq.com/openai/v1 or https://api.openai.com)
// and forgot "/chat/completions", add it. Only clear "base URL" shapes are touched:
//   https://host                      -> https://host/v1/chat/completions
//   .../v1  .../v4  .../v1beta  .../openai   -> .../chat/completions
//   .../chat                          -> .../chat/completions
// URLs that already end in a real endpoint (chat/completions, completions, responses, messages,
// generateContent ...) and Gemini-type models are never changed.
// Gemini type: the URL must be the NATIVE endpoint  .../v1beta/models/<model>:generateContent
// (an OpenAI-compatible Gemini URL ".../v1beta/openai/chat/completions" gives HTTP 400 with the Gemini type).
function _normalizeGeminiApiUrl(original, modelId) {
  const same = { url: original, changed: false };
  let u;
  try { u = new URL(original); } catch (_) { return same; }
  if (!/(^|\.)generativelanguage\.googleapis\.com$/i.test(u.hostname)) return same; // custom proxy: leave alone
  const path = u.pathname.replace(/\/+$/, '');
  const lower = path.toLowerCase();
  const id = String(modelId || '').trim().replace(/^models\//i, '');
  let newPath = null;
  if (/:generatecontent$/.test(lower)) return same;
  if (/:streamgeneratecontent$/.test(lower)) { newPath = path.replace(/:streamGenerateContent$/i, ':generateContent'); u.searchParams.delete('alt'); }
  else if (/\/openai(\/|$)/.test(lower)) { if (id) newPath = `/v1beta/models/${id}:generateContent`; }
  else if (/\/models\/[^/:]+$/.test(lower)) newPath = path + ':generateContent';
  else if (!path || /^\/v1(beta)?$/.test(lower) || /^\/v1(beta)?\/models$/.test(lower)) {
    if (id) newPath = `${path.replace(/\/models$/i, '') || '/v1beta'}/models/${id}:generateContent`;
  }
  if (!newPath) return same;
  u.pathname = newPath;
  return { url: u.toString(), changed: true };
}

function normalizeAIModelApiUrl(rawUrl, apiType, modelId) {
  const original = String(rawUrl || '').trim();
  const same = { url: original, changed: false };
  if (!original) return same;
  if (apiType === 'gemini') return _normalizeGeminiApiUrl(original, modelId);
  let u;
  try { u = new URL(original); } catch (_) { return same; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return same;
  const path = u.pathname.replace(/\/+$/, '');
  const lower = path.toLowerCase();
  if (/\/(chat\/completions|completions|responses|messages|embeddings)$/.test(lower) || /:(stream)?generatecontent$/.test(lower)) return same;
  let newPath = null;
  if (!path) newPath = '/v1/chat/completions';
  else if (/\/chat$/.test(lower)) newPath = path + '/completions';
  else {
    const last = lower.split('/').pop();
    if (/^v\d+[a-z]*\d*$/.test(last) || last === 'openai') newPath = path + '/chat/completions';
  }
  if (!newPath) return same;
  u.pathname = newPath;
  return { url: u.toString(), changed: true };
}

// ===== TEST MODEL CONNECTION =====
// Wrapper: fixes a missing "/chat/completions" first. If the fixed URL works it is KEPT on the
// model; if only the original URL works (unusual custom endpoint) the original is kept.
async function testAIModelConnection(cfg) {
  if (!cfg) return _testAIModelConnectionOnce(cfg);
  const original = String(cfg.apiUrl || '').trim();
  // A Gemini-native URL (…:generateContent) saved as OpenAI-compatible can only work as Gemini type.
  let typeNote = '';
  if (cfg.apiType !== 'gemini' && /generativelanguage\.googleapis\.com/i.test(original) && /:(stream)?generatecontent/i.test(original)) {
    cfg.apiType = 'gemini';
    typeNote = ' — type switched to Gemini (URL is a Gemini endpoint)';
  }
  const fixed = normalizeAIModelApiUrl(original, cfg.apiType, cfg.modelId);
  if (!fixed.changed) {
    const r0 = await _testAIModelConnectionOnce(cfg);
    return typeNote && r0.ok ? Object.assign({}, r0, { message: r0.message + typeNote }) : r0;
  }
  cfg.apiUrl = fixed.url;
  const r = await _testAIModelConnectionOnce(cfg);
  if (r.ok) return Object.assign({}, r, { urlFixed: true, message: `${r.message} — URL auto-fixed${typeNote}` });
  cfg.apiUrl = original;
  const r2 = await _testAIModelConnectionOnce(cfg);
  if (r2.ok) return r2;
  cfg.apiUrl = fixed.url; // neither worked: keep the completed URL (most likely what was meant)
  return Object.assign({}, r, { message: `${r.message} (URL auto-completed)` });
}

async function _testAIModelConnectionOnce(cfg) {
  if (cfg?.apiType === 'gemini') {
    const geminiUrl = cfg.apiUrl.endsWith('?key=') ? cfg.apiUrl : cfg.apiUrl + (cfg.apiUrl.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(cfg.apiKey);
    try {
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { temperature: 0 }
        })
      });
      if (!response.ok) {
        let detail = '';
        try { const j = await response.json(); detail = j.error?.message || JSON.stringify(j); } catch (e) { try { detail = await response.text(); } catch (e2) {} }
        let hint = '';
        if (/api key not valid|api_key_invalid|invalid api key/i.test(detail)) hint = ' — Hint: Gemini says the API key is not valid; check the key.';
        else if (/invalid json payload|unknown name|cannot find field/i.test(detail)) hint = ' — Hint: this URL looks like an OpenAI-compatible endpoint, not a native Gemini one.';
        else if (/is not found|not supported for generatecontent|not found for api version/i.test(detail)) hint = ' — Hint: check the Model ID (and that the URL has models/<model-id>:generateContent).';
        return { ok: false, message: `HTTP ${response.status}: ${detail || 'No further details returned'}${hint}` };
      }
      const data = await response.json();
      if (!data?.candidates?.length) {
        return { ok: false, message: 'Gemini responded but not in the expected format.' };
      }
      return { ok: true, message: 'Gemini connection successful' };
    } catch (networkError) {
      return { ok: false, message: 'Network/CORS error: could not reach this Gemini URL.' };
    }
  }

  const body = {
    model: cfg.modelId,
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 5,
    temperature: 0
  };
  try {
    const response = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      let detail = '';
      try { const j = await response.json();
        detail = (j.error && (j.error.message || j.error.type)) || JSON.stringify(j); } catch (e) { try {
          detail = await response.text(); } catch (e2) {} }
      return { ok: false, message: `HTTP ${response.status}: ${detail || 'No further details returned'}` };
    }
    const data = await response.json();
    if (!data || !data.choices) {
      return { ok: false, message: 'API responded but not in the expected format (is it OpenAI-compatible?)' };
    }
    return { ok: true, message: 'Text connection successful' };
  } catch (networkError) {
    return { ok: false, message: 'Network/CORS error: could not reach this URL.' };
  }
}

async function probeAIModelHealth(cfg) {
  if (!cfg) return { ok: false, message: 'No model selected.' };
  try {
    const result = await testAIModelConnection(cfg);
    if (result?.ok) return { ok: true, message: result.message || 'Model healthy' };
    return { ok: false, message: result?.message || 'Model probe failed' };
  } catch (err) {
    return { ok: false, message: err?.message || 'Model probe failed' };
  }
}

async function handleTestExistingModel(id) {
  const m = AI_MODELS_STATE.models.find(x => x.id === id);
  if (!m) return;
  m.status = 'testing';
  m.statusMessage = '';
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  const result = await testAIModelConnection(m);
  m.status = result.ok ? 'ok' : 'error';
  m.statusMessage = result.message;
  m.lastTestedAt = Date.now();
  saveAIModelsState();
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
}

// ===== SMALL DIALOG HELPERS (built in JS, no HTML needed) =====
const _AI_DLG_INPUT = 'width:100%;padding:9px 11px;border:1.5px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-color);color:var(--text-primary);box-sizing:border-box;font-size:.92rem;';
const _AI_DLG_LABEL = 'display:block;font-size:.78rem;font-weight:600;color:var(--text-secondary);margin:12px 0 5px;';

function _createAIDialog(innerHTML) {
  const overlay = document.createElement('div');
  overlay.className = 'ai-models-dialog-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;background:rgba(0,0,0,.45);';
  overlay.innerHTML = `<div style="background:var(--surface-color);color:var(--text-primary);border:1px solid var(--border-color);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:22px 24px;max-width:430px;width:100%;max-height:90vh;overflow:auto;box-sizing:border-box;">${innerHTML}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}

// ===== IMPORT: ASK THE API TYPE =====
// Resolves 'openai' | 'gemini' | 'file' (use the type saved in the file) | null (cancelled)
function askImportApiType(models) {
  return new Promise(resolve => {
    const valid = (models || []).filter(m => m && m.name && m.apiUrl && m.apiKey && m.modelId);
    const typed = valid.filter(m => m.apiType === 'openai' || m.apiType === 'gemini');
    const allTyped = valid.length > 0 && typed.length === valid.length;
    const radio = (val, label, hint, checked) => `
      <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1.5px solid var(--border-color);border-radius:var(--radius-sm);margin-top:8px;cursor:pointer;">
        <input type="radio" name="ai-import-type" value="${val}" ${checked ? 'checked' : ''} style="margin-top:3px;">
        <span><b>${label}</b>${hint ? `<span style="display:block;font-size:.8rem;color:var(--text-secondary);margin-top:2px;">${hint}</span>` : ''}</span>
      </label>`;
    const overlay = _createAIDialog(`
      <h3 style="margin:0 0 4px;font-size:1.05rem;">Import ${valid.length} model(s)</h3>
      <div style="font-size:.85rem;color:var(--text-secondary);">What API type are these models?</div>
      ${radio('openai', 'OpenAI-compatible', 'OpenAI, Groq, OpenRouter, DeepSeek and others', !allTyped)}
      ${radio('gemini', 'Google Gemini', 'Gemini API URL with generateContent', false)}
      ${typed.length ? radio('file', 'Use the type saved in the file', allTyped ? 'Every model in the file has its own type' : `${typed.length} of ${valid.length} have a type; the rest become OpenAI-compatible`, allTyped) : ''}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
        <button type="button" class="topbar-btn" data-act="cancel">Cancel</button>
        <button type="button" class="topbar-btn btn-primary" data-act="ok">Import</button>
      </div>`);
    const done = v => { overlay.remove(); resolve(v); };
    overlay.addEventListener('click', e => { if (e.target === overlay) done(null); });
    overlay.querySelector('[data-act="cancel"]').onclick = () => done(null);
    overlay.querySelector('[data-act="ok"]').onclick = () => {
      const sel = overlay.querySelector('input[name="ai-import-type"]:checked');
      done(sel ? sel.value : 'openai');
    };
  });
}

// ===== EDIT A MODEL (everything except API URL and API key) =====
function openAIModelEditDialog(id) {
  const m = AI_MODELS_STATE.models.find(x => x.id === id);
  if (!m) return;
  const type = m.apiType === 'gemini' ? 'gemini' : 'openai';
  const overlay = _createAIDialog(`
    <h3 style="margin:0 0 2px;font-size:1.05rem;">Edit model</h3>
    <div style="font-size:.8rem;color:var(--text-secondary);">API URL and API key cannot be changed here.</div>

    <label style="${_AI_DLG_LABEL}">Name</label>
    <input type="text" id="edit-ai-name" value="${escapeHTML(m.name)}" style="${_AI_DLG_INPUT}">

    <label style="${_AI_DLG_LABEL}">Model ID</label>
    <input type="text" id="edit-ai-modelid" value="${escapeHTML(m.modelId)}" style="${_AI_DLG_INPUT}">

    <label style="${_AI_DLG_LABEL}">API Type</label>
    <select id="edit-ai-type" style="${_AI_DLG_INPUT}">
      <option value="openai" ${type === 'openai' ? 'selected' : ''}>OpenAI-compatible</option>
      <option value="gemini" ${type === 'gemini' ? 'selected' : ''}>Google Gemini</option>
    </select>

    <label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:.88rem;"><input type="checkbox" id="edit-ai-json" ${m.supportsJson !== false ? 'checked' : ''}> Supports JSON response format</label>
    <label id="edit-ai-search-row" style="display:${type === 'gemini' ? 'flex' : 'none'};gap:8px;align-items:center;margin-top:8px;font-size:.88rem;"><input type="checkbox" id="edit-ai-search" ${m.enableGoogleSearch !== false ? 'checked' : ''}> Enable Google Search grounding (Gemini only)</label>

    <label style="${_AI_DLG_LABEL}">API URL (locked)</label>
    <div style="${_AI_DLG_INPUT}opacity:.65;word-break:break-all;">${escapeHTML(m.apiUrl)}</div>
    <label style="${_AI_DLG_LABEL}">API Key (locked)</label>
    <div style="${_AI_DLG_INPUT}opacity:.65;">••••••••••••</div>

    <div id="edit-ai-error" style="color:var(--danger-color);font-size:.82rem;margin-top:10px;min-height:1em;"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
      <button type="button" class="topbar-btn" data-act="cancel">Cancel</button>
      <button type="button" class="topbar-btn btn-primary" data-act="save">Save</button>
    </div>`);
  const $ = sel => overlay.querySelector(sel);
  $('#edit-ai-type').onchange = () => { $('#edit-ai-search-row').style.display = $('#edit-ai-type').value === 'gemini' ? 'flex' : 'none'; };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('[data-act="cancel"]').onclick = () => overlay.remove();
  $('[data-act="save"]').onclick = () => {
    const name = $('#edit-ai-name').value.trim();
    const modelId = $('#edit-ai-modelid').value.trim();
    if (!name || !modelId) { $('#edit-ai-error').textContent = 'Name and Model ID cannot be empty.'; return; }
    const newType = $('#edit-ai-type').value === 'gemini' ? 'gemini' : 'openai';
    const newJson = $('#edit-ai-json').checked;
    const coreChanged = modelId !== m.modelId || newType !== type || newJson !== (m.supportsJson !== false);
    m.name = name;
    m.modelId = modelId;
    m.apiType = newType;
    { const f = normalizeAIModelApiUrl(m.apiUrl, newType, modelId); if (f.changed) m.apiUrl = f.url; }
    m.supportsJson = newJson;
    m.enableGoogleSearch = $('#edit-ai-search').checked;
    if (coreChanged) { m.status = 'idle'; m.statusMessage = 'Settings changed — test again'; }
    saveAIModelsState();
    overlay.remove();
    if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
    if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
    if (typeof displayToastNotification === 'function') displayToastNotification(`✏️ "${m.name}" updated${coreChanged ? ' — please test it again' : ''}`);
  };
  setTimeout(() => { const el = $('#edit-ai-name'); if (el) el.focus(); }, 40);
}

// ===== REMOVE MODE (mark models, then remove them together) =====
function toggleAIModelsRemoveMode() {
  if (!AI_MODELS_STATE.models.length) return;
  _removeMode.active = !_removeMode.active;
  _removeMode.selected.clear();
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
}

function toggleModelRemoveMark(id) {
  if (!_removeMode.active) return;
  if (_removeMode.selected.has(id)) _removeMode.selected.delete(id); else _removeMode.selected.add(id);
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
}

function markAllModelsForRemove() {
  if (!_removeMode.active) return;
  const all = AI_MODELS_STATE.models.map(m => m.id);
  if (all.length && all.every(id => _removeMode.selected.has(id))) _removeMode.selected.clear();
  else all.forEach(id => _removeMode.selected.add(id));
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
}

function removeMarkedAIModels() {
  const ids = AI_MODELS_STATE.models.map(m => m.id).filter(id => _removeMode.selected.has(id));
  if (!ids.length) return;
  const everything = ids.length === AI_MODELS_STATE.models.length;
  if (!confirm(everything ? `Remove ALL ${ids.length} model(s)? This cannot be undone.` : `Remove ${ids.length} marked model(s)? This cannot be undone.`)) return;
  const idSet = new Set(ids);
  AI_MODELS_STATE.models = AI_MODELS_STATE.models.filter(m => !idSet.has(m.id));
  if (!AI_MODELS_STATE.models.some(m => m.id === AI_MODELS_STATE.activeModelId)) {
    AI_MODELS_STATE.activeModelId = AI_MODELS_STATE.models.length ? AI_MODELS_STATE.models[0].id : null;
  }
  _removeMode.active = false;
  _removeMode.selected.clear();
  saveAIModelsState();
  if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  if (typeof displayToastNotification === 'function') displayToastNotification(`🗑️ Removed ${ids.length} model(s)`);
}

// ===== TEST ALL MODELS =====
let _testAllState = { running: false, done: 0, total: 0, summary: '' };

async function handleTestAllModels() {
  if (_testAllState.running) return;
  const models = AI_MODELS_STATE.models.slice();
  if (!models.length) {
    if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ No models to test.');
    return;
  }
  _testAllState = { running: true, done: 0, total: models.length, summary: '' };
  models.forEach(m => { m.status = 'testing'; m.statusMessage = ''; });
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();

  let okCount = 0, failCount = 0, next = 0;
  const lanes = Math.min(4, models.length); // a few at a time, so one provider is not flooded
  async function lane() {
    while (next < models.length) {
      const m = models[next++];
      let result;
      try { result = await testAIModelConnection(m); }
      catch (err) { result = { ok: false, message: (err && err.message) || 'Test failed' }; }
      if (AI_MODELS_STATE.models.some(x => x.id === m.id)) { // still exists (not deleted meanwhile)
        m.status = result.ok ? 'ok' : 'error';
        m.statusMessage = result.message;
        m.lastTestedAt = Date.now();
        saveAIModelsState();
      }
      result.ok ? okCount++ : failCount++;
      _testAllState.done++;
      if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
    }
  }
  try { await Promise.all(Array.from({ length: lanes }, lane)); }
  finally {
    _testAllState.running = false;
    _testAllState.summary = `Tested ${models.length}: ${okCount} working, ${failCount} failed`;
    if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
    if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
    if (typeof displayToastNotification === 'function') displayToastNotification(`🧪 ${_testAllState.summary}`);
  }
}

// Keeps the toolbar "Test all" button (in index.html) in step with the test run.
function _syncTestAllButton() {
  const btn = document.getElementById('ai-models-testall-btn');
  const none = AI_MODELS_STATE.models.length === 0;
  if (btn) {
    const label = document.getElementById('ai-models-testall-label');
    btn.disabled = _testAllState.running || none;
    if (label) label.textContent = _testAllState.running ? `Testing ${_testAllState.done}/${_testAllState.total}…` : 'Test all';
  }
  const rbtn = document.getElementById('ai-models-remove-btn');
  if (rbtn) {
    const rlabel = document.getElementById('ai-models-remove-label');
    rbtn.disabled = none || _testAllState.running;
    if (rlabel) rlabel.textContent = _removeMode.active ? 'Cancel' : 'Remove';
  }
}

// ===== READ MODEL FORM =====
function readAIModelForm() {
  const name = document.getElementById('ai-model-name-input')?.value.trim() || '';
  const apiUrl = document.getElementById('ai-model-url-input')?.value.trim() || '';
  const apiKey = document.getElementById('ai-model-key-input')?.value.trim() || '';
  const modelId = document.getElementById('ai-model-id-input')?.value.trim() || '';
  const supportsJson = document.getElementById('ai-model-json-checkbox')?.checked !== false;
  const enableGoogleSearch = document.getElementById('ai-model-search-checkbox')?.checked !== false;
  const apiType = document.getElementById('ai-model-api-type-select')?.value || 'openai';
  return { name, apiUrl, apiKey, modelId, supportsJson, supportsVision: false, enableGoogleSearch, apiType };
}

function clearAIModelForm() {
  ['ai-model-name-input', 'ai-model-url-input', 'ai-model-key-input', 'ai-model-id-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const jsonCheckbox = document.getElementById('ai-model-json-checkbox');
  if (jsonCheckbox) jsonCheckbox.checked = true;
  const searchCheckbox = document.getElementById('ai-model-search-checkbox');
  if (searchCheckbox) searchCheckbox.checked = true;
  const statusEl = document.getElementById('ai-model-add-status');
  if (statusEl) { statusEl.innerHTML = '';
    statusEl.className = 'ai-model-add-status'; }
  _pendingFailedModelSave = null;
}

// ===== ADD NEW MODEL =====
async function handleAddNewAIModel() {
  const form = readAIModelForm();
  const statusEl = document.getElementById('ai-model-add-status');
  if (!form.name || !form.apiUrl || !form.apiKey || !form.modelId) {
    statusEl.className = 'ai-model-add-status error';
    statusEl.innerHTML = '⚠️ Please fill in all fields (Name, API URL, API Key, Model ID).';
    return;
  }
  statusEl.className = 'ai-model-add-status testing';
  statusEl.innerHTML = '<span class="ai-model-mini-spinner"></span>Processing... verifying connection.';
  const addBtn = document.getElementById('ai-model-add-btn');
  if (addBtn) addBtn.disabled = true;

  const result = await testAIModelConnection(form);
  if (addBtn) addBtn.disabled = false;

  if (result.ok) {
    _pendingFailedModelSave = null;
    statusEl.className = 'ai-model-add-status success';
    statusEl.innerHTML = `✅ ${result.message} — saving...`;
    saveNewAIModel(form, 'ok', result.message);
  } else {
    _pendingFailedModelSave = { form, message: result.message };
    { const _urlEl = document.getElementById('ai-model-url-input'); if (_urlEl && form.apiUrl) _urlEl.value = form.apiUrl; }
    statusEl.className = 'ai-model-add-status error';
    statusEl.innerHTML =
      `❌ Test failed: ${escapeHTML(result.message)}<br><button type="button" class="topbar-btn" style="margin-top:8px;" onclick="handleAddNewAIModel()">Retry</button> <button type="button" class="topbar-btn" style="margin-top:8px;" onclick="saveFailedModelAnyway()">Save anyway</button>`;
  }
}

function saveFailedModelAnyway() {
  if (!_pendingFailedModelSave) return;
  saveNewAIModel(_pendingFailedModelSave.form, 'error', _pendingFailedModelSave.message);
  _pendingFailedModelSave = null;
}

function saveNewAIModel(form, status, statusMessage) {
  const newModel = {
    id: generateModelId(),
    name: form.name,
    apiUrl: form.apiUrl,
    apiKey: form.apiKey,
    modelId: form.modelId,
    supportsJson: form.supportsJson !== false,
    supportsVision: form.supportsVision !== false,
    enableGoogleSearch: form.enableGoogleSearch !== false,
    apiType: form.apiType || 'openai',
    status: status || 'idle',
    statusMessage: statusMessage || '',
    lastTestedAt: Date.now()
  };
  AI_MODELS_STATE.models.push(newModel);
  if (!AI_MODELS_STATE.activeModelId) AI_MODELS_STATE.activeModelId = newModel.id;
  saveAIModelsState();
  clearAIModelForm();
  if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  if (typeof displayToastNotification === 'function') displayToastNotification(`✅ "${newModel.name}" added!`);
}

// ===== EXPORT / IMPORT MODELS =====
function exportAIModels() {
  if (AI_MODELS_STATE.models.length === 0) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ No models to export.");
    return;
  }
  const data = {
    version: AI_MODELS_STATE.version || 1,
    models: AI_MODELS_STATE.models.map(m => ({
      id: m.id,
      name: m.name,
      apiUrl: m.apiUrl,
      apiKey: m.apiKey,
      modelId: m.modelId,
      supportsJson: m.supportsJson !== false,
      supportsVision: m.supportsVision !== false,
      enableGoogleSearch: m.enableGoogleSearch !== false,
      apiType: m.apiType || 'openai',
      status: m.status || 'idle',
      statusMessage: m.statusMessage || '',
      lastTestedAt: m.lastTestedAt || Date.now()
    })),
    activeModelId: AI_MODELS_STATE.activeModelId
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'ai_models_backup.json';
  link.click();
  URL.revokeObjectURL(link.href);
  if (typeof displayToastNotification === 'function') displayToastNotification(`📤 Exported ${data.models.length} model(s).`);
}

function importAIModels(fileList) {
  if (!fileList || fileList.length === 0) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.models || !Array.isArray(data.models)) {
        if (typeof displayToastNotification === 'function') {
          displayToastNotification("Error Invalid file format — expected an array of models.");
        }
        return;
      }
      // Ask which API type these models are (previously everything silently became OpenAI-compatible)
      const importType = await askImportApiType(data.models);
      if (!importType) {
        if (typeof displayToastNotification === 'function') displayToastNotification('Import cancelled.');
        return;
      }
      let added = 0;
      for (const m of data.models) {
        if (!m.name || !m.apiUrl || !m.apiKey || !m.modelId) continue;
        const typeForModel = importType === 'file' ? (m.apiType === 'gemini' ? 'gemini' : 'openai') : importType;
        // "Duplicate" used to mean apiUrl+modelId only, so any two entries
        // pointing at the same model with DIFFERENT API keys (multiple keys
        // for the same model, for load balancing/failover — exactly what a
        // file like this one has, 4 keys per model) were treated as the same
        // model and all but the first of each group got silently skipped.
        // 16 entries, 4 distinct apiUrl+modelId combinations -> only 4
        // actually got imported. Comparing apiKey too makes different keys
        // count as different models, as intended.
        if (m.status !== 'ok') { const f = normalizeAIModelApiUrl(m.apiUrl, typeForModel, m.modelId); if (f.changed) m.apiUrl = f.url; }
        const exists = AI_MODELS_STATE.models.some(ex => ex.apiUrl === m.apiUrl && ex.modelId === m.modelId && ex.apiKey === m.apiKey);
        if (exists) continue;
        const newModel = {
          id: m.id || generateModelId(),
          name: m.name,
          apiUrl: m.apiUrl,
          apiKey: m.apiKey,
          modelId: m.modelId,
          supportsJson: m.supportsJson !== false,
          supportsVision: m.supportsVision !== false,
          enableGoogleSearch: m.enableGoogleSearch !== false,
          apiType: typeForModel,
          status: m.status || 'idle',
          statusMessage: m.statusMessage || '',
          lastTestedAt: m.lastTestedAt || Date.now()
        };
        AI_MODELS_STATE.models.push(newModel);
        added++;
      }
      if (data.activeModelId && AI_MODELS_STATE.models.some(m => m.id === data.activeModelId)) {
        AI_MODELS_STATE.activeModelId = data.activeModelId;
      } else if (AI_MODELS_STATE.models.length > 0 && !AI_MODELS_STATE.activeModelId) {
        AI_MODELS_STATE.activeModelId = AI_MODELS_STATE.models[0].id;
      }
      saveAIModelsState();
      if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
      if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
      if (typeof displayToastNotification === 'function') displayToastNotification(`📥 Imported ${added} new model(s).`);
    } catch (err) {
      if (typeof displayToastNotification === 'function') displayToastNotification("Error Failed to import: " + err.message);
    }
  };
  reader.readAsText(fileList[0]);
  const input = document.getElementById('ai-models-import-input');
  if (input) input.value = '';
}

// ===== AUTO-SWITCH TOGGLE =====
function getAutoSwitchEnabled() {
  return true; // Always enabled
}

function setAutoSwitchEnabled(enabled) {
  try { localStorage.setItem(AI_MODEL_AUTOSWITCH_KEY, enabled ? 'true' : 'false'); } catch (e) {}
}

function handleAutoSwitchToggle(checked) {
  setAutoSwitchEnabled(true);
  const checkbox = document.getElementById('ai-model-autoswitch-checkbox');
  if (checkbox) {
    checkbox.checked = true;
    checkbox.disabled = true;
  }
  if (typeof displayToastNotification === 'function') {
    displayToastNotification('🔄 Auto-switch is always ON — every AI error moves to the next model.');
  }
}

// ===== DRAG & DROP REORDERING =====
function handleModelDragStart(evt, id) {
  _draggedModelId = id;
  try { evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData('text/plain', id); } catch (e) {}
  evt.currentTarget.classList.add('dragging');
}

function handleModelDragEnd(evt) {
  evt.currentTarget.classList.remove('dragging');
  _draggedModelId = null;
}

function handleModelDragOver(evt) {
  evt.preventDefault();
  try { evt.dataTransfer.dropEffect = 'move'; } catch (e) {}
}

function handleModelDrop(evt, targetId) {
  evt.preventDefault();
  const draggedId = _draggedModelId || (evt.dataTransfer && evt.dataTransfer.getData('text/plain'));
  if (!draggedId || draggedId === targetId) return;
  const models = AI_MODELS_STATE.models;
  const fromIdx = models.findIndex(m => m.id === draggedId);
  const toIdx = models.findIndex(m => m.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = models.splice(fromIdx, 1);
  models.splice(toIdx, 0, moved);
  saveAIModelsState();
  if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
}

// ===== STATUS BADGE HTML =====
function aiModelStatusBadgeHTML(m) {
  if (m.status === 'testing') {
    return `<span class="ai-model-badge testing"><span class="ai-model-mini-spinner"></span>Testing</span>`;
  }
  if (m.status === 'ok') {
    return `<span class="ai-model-badge ok" title="${(m.statusMessage || '').replace(/"/g, '&quot;')}">Working</span>`;
  }
  if (m.status === 'error') {
    return `<span class="ai-model-badge error" title="${(m.statusMessage || '').replace(/"/g, '&quot;')}">Error</span>`;
  }
  return `<span class="ai-model-badge idle">Untested</span>`;
}

// ===== RENDER MODELS LIST IN MODAL =====
function renderAIModelsListInModal() {
  const listEl = document.getElementById('ai-models-list');
  if (!listEl) return;
  if (AI_MODELS_STATE.models.length === 0) { _removeMode.active = false; _removeMode.selected.clear(); }
  _syncTestAllButton();
  if (AI_MODELS_STATE.models.length === 0) {
    listEl.innerHTML = `<div class="ai-model-empty">No model configured yet. Use <b>Add model</b> to connect one.</div>`;
    return;
  }

  const gripIcon = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>`;
  const checkIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`;
  const testIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.7"/><path d="M20 12a8 8 0 0 1-13.7 5.7"/><path d="M17 3v4h-4M7 21v-4h4"/></svg>`;
  const trashIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M8 10v7M12 10v7M16 10v7M7 7l1 14h8l1-14"/></svg>`;
  const infoIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 10v6"/><circle cx="12" cy="7.2" r=".8" fill="currentColor" stroke="none"/></svg>`;

  const _running = _testAllState.running;
  const _testAllBar = (_testAllState.summary && !_running)
    ? `<div class="ai-models-testall-bar" style="margin-bottom:10px;font-size:.85em;opacity:.8;">${escapeHTML(_testAllState.summary)}</div>`
    : '';

  // ---- remove mode: simple selectable cards + a bar with Mark all / Remove selected ----
  if (_removeMode.active) {
    const total = AI_MODELS_STATE.models.length;
    _removeMode.selected.forEach(id => { if (!AI_MODELS_STATE.models.some(m => m.id === id)) _removeMode.selected.delete(id); });
    const n = _removeMode.selected.size;
    const allMarked = total > 0 && n === total;
    listEl.innerHTML = `
      <div class="ai-models-remove-bar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
        <button type="button" class="topbar-btn" onclick="markAllModelsForRemove()"><span>${allMarked ? 'Unmark all' : 'Mark all'}</span></button>
        <button type="button" class="topbar-btn" style="color:var(--danger-color);" onclick="removeMarkedAIModels()" ${n ? '' : 'disabled'}>${trashIcon}<span>Remove selected (${n})</span></button>
        <span style="font-size:.85em;opacity:.8;">${n} of ${total} marked</span>
      </div>` + AI_MODELS_STATE.models.map((m, idx) => {
        const marked = _removeMode.selected.has(m.id);
        return `
      <div class="ai-model-card" data-model-id="${m.id}" onclick="toggleModelRemoveMark('${m.id}')" style="cursor:pointer;${marked ? 'outline:2px solid var(--danger-color);outline-offset:-2px;' : ''}">
        <input type="checkbox" ${marked ? 'checked' : ''} style="margin:0 8px 0 4px;width:18px;height:18px;pointer-events:none;flex:none;" aria-label="Mark for removal">
        <span class="ai-model-order-badge">${idx + 1}</span>
        <div class="ai-model-card-main">
          <div class="ai-model-card-title"><strong>${escapeHTML(m.name)}</strong> ${aiModelStatusBadgeHTML(m)}</div>
          <div class="ai-model-card-sub">${escapeHTML(m.modelId)}</div>
        </div>
      </div>`;
      }).join('');
    return;
  }

  const editIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14 7 3 3"/></svg>`;
  listEl.innerHTML = _testAllBar + AI_MODELS_STATE.models.map((m, idx) => `
    <div class="ai-model-card ${m.id === AI_MODELS_STATE.activeModelId ? 'active' : ''}"
      draggable="true"
      data-model-id="${m.id}"
      ondragstart="handleModelDragStart(event, '${m.id}')"
      ondragend="handleModelDragEnd(event)"
      ondragover="handleModelDragOver(event)"
      ondrop="handleModelDrop(event, '${m.id}')">
      <button class="ai-model-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">${gripIcon}</button>
      <span class="ai-model-order-badge">${idx + 1}</span>
      <div class="ai-model-card-main">
        <div class="ai-model-card-title">
          ${m.id === AI_MODELS_STATE.activeModelId ? '<span class="ai-model-active-dot" title="Active model"></span>' : ''}
          <strong>${escapeHTML(m.name)}</strong>
          ${aiModelStatusBadgeHTML(m)}
          <button class="ai-model-info-btn" onclick="toggleModelInfoPopover('${m.id}')" title="Model details" aria-label="Model details">${infoIcon}</button>
        </div>
        <div class="ai-model-card-sub">${escapeHTML(m.modelId)}</div>
        <div class="ai-model-info-popover" id="popover-${m.id}">
          <span class="info-label">Model ID</span><span class="info-value">${escapeHTML(m.modelId)}</span>
          <span class="info-label">API URL</span><span class="info-value">${escapeHTML(m.apiUrl)}</span>
          <span class="info-label">API Type</span><span class="info-value">${escapeHTML(m.apiType || 'openai')}</span>
          ${m.apiType === 'gemini' ? `<span class="info-label">Google Search</span><span class="info-value">${m.enableGoogleSearch !== false ? 'Enabled' : 'Disabled'}</span>` : ''}
          <span class="info-label">Status</span><span class="info-value">${escapeHTML(m.statusMessage || 'OK')}</span>
        </div>
      </div>
      <div class="ai-model-card-actions">
        ${m.id !== AI_MODELS_STATE.activeModelId ?
          `<button type="button" class="topbar-btn" onclick="setActiveAIModel('${m.id}')">${checkIcon}<span class="label-desktop">Use</span></button>` :
          `<span class="topbar-btn" style="opacity:.65;cursor:default;">${checkIcon}<span class="label-desktop">Active</span></span>`}
        <button type="button" class="topbar-btn" onclick="handleTestExistingModel('${m.id}')">${testIcon}<span class="label-desktop">Test</span></button>
        <button type="button" class="topbar-btn" onclick="openAIModelEditDialog('${m.id}')">${editIcon}<span class="label-desktop">Edit</span></button>
        <button type="button" class="topbar-btn" style="color:var(--danger-color);" onclick="deleteAIModel('${m.id}')">${trashIcon}<span class="label-desktop">Delete</span></button>
      </div>
    </div>
  `).join('');
}

// ===== MODEL INFO POPOVER =====
function toggleModelInfoPopover(modelId) {
  const popover = document.getElementById('popover-' + modelId);
  if (!popover) return;
  document.querySelectorAll('.ai-model-info-popover.open').forEach(el => {
    if (el.id !== 'popover-' + modelId) el.classList.remove('open');
  });
  popover.classList.toggle('open');
}

// Close popovers when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.ai-model-info-btn')) {
    document.querySelectorAll('.ai-model-info-popover.open').forEach(el => el.classList.remove('open'));
  }
});

// ===== AI MODEL SELECT BAR =====
function sizeAIModelSelect() {
  const select = document.getElementById('active-model-select');
  if (!select) return;
  try {
    const styles = getComputedStyle(select);
    const canvas = sizeAIModelSelect._canvas || (sizeAIModelSelect._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
      let maxTextWidth = 0;
      Array.from(select.options).forEach(opt => {
        maxTextWidth = Math.max(maxTextWidth, ctx.measureText(opt.textContent || '').width);
      });
      const extra = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0) + 36;
      const minWidth = (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout()) ? 150 : 180;
      select.style.width = `${Math.ceil(Math.max(minWidth, maxTextWidth + extra))}px`;
    } else {
      select.style.width = 'max-content';
    }
    select.style.maxWidth = 'none';
  } catch (_) {
    select.style.width = 'max-content';
    select.style.maxWidth = 'none';
  }
}

function syncActiveModelVisualTheme() {
  const select = document.getElementById('active-model-select');
  const isDark = !!document.body.classList.contains('dark') || !!document.documentElement.classList.contains('dark');

  if (select) {
    select.style.setProperty('background', isDark ? 'rgba(10, 15, 24, 0.97)' : 'rgba(255, 255, 255, 0.92)', 'important');
    select.style.setProperty('border-color', isDark ? 'rgba(155, 167, 206, 0.22)' : 'rgba(128, 135, 170, 0.28)', 'important');
    select.style.setProperty('color', isDark ? '#edf2ff' : '#141a2d', 'important');
    select.style.setProperty('box-shadow', isDark ? 'inset 0 1px 0 rgba(255,255,255,0.03)' : 'inset 0 1px 0 rgba(255,255,255,0.2)', 'important');
  }

  document.querySelectorAll('.ai-model-card.active').forEach(card => {
    card.style.setProperty('background', isDark ?
      'linear-gradient(180deg, rgba(118,102,255,0.37), rgba(8,12,20,0.98))' :
      'linear-gradient(180deg, rgba(87,81,232,0.10), rgba(87,81,232,0.04))', 'important');
    card.style.setProperty('border-color', isDark ? 'rgba(176,165,255,0.95)' : 'rgba(87,81,232,0.75)', 'important');
    card.style.setProperty('color', isDark ? '#edf2ff' : '#141a2d', 'important');
    card.style.setProperty('box-shadow', isDark ?
      '0 0 0 3px rgba(143,130,255,0.22), inset 0 1px 0 rgba(255,255,255,0.04)' :
      '0 0 0 3px rgba(87,81,232,0.08), inset 0 1px 0 rgba(255,255,255,0.06)', 'important');
  });
}

function renderAIModelSelectBar() {
  const select = document.getElementById('active-model-select');
  if (!select) return;
  if (AI_MODELS_STATE.models.length === 0) {
    select.innerHTML = `<option value="">No model added</option>`;
  } else {
    select.innerHTML = AI_MODELS_STATE.models.map(m =>
      `<option value="${m.id}" ${m.id === AI_MODELS_STATE.activeModelId ? 'selected' : ''}>${escapeHTML(m.name)}</option>`
    ).join('');
  }
  sizeAIModelSelect();
  syncActiveModelVisualTheme();
}

// ===== TOGGLE MODAL PANELS =====
function toggleAIModelsInfo() {
  const panel = document.getElementById('ai-model-info-panel');
  if (panel) panel.classList.toggle('open');
}

function toggleAIModelAddForm() {
  const form = document.getElementById('ai-model-add-form');
  if (!form) return;
  form.classList.toggle('open');
  if (!form.classList.contains('open')) return;
  const input = document.getElementById('ai-model-name-input');
  if (input) setTimeout(() => input.focus(), 60);
}

function openAIModelsModal() {
  const modal = document.getElementById('ai-models-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const info = document.getElementById('ai-model-info-panel');
  if (info) info.classList.remove('open');
  const form = document.getElementById('ai-model-add-form');
  if (form) form.classList.remove('open');
  const autoSwitchCheckbox = document.getElementById('ai-model-autoswitch-checkbox');
  if (autoSwitchCheckbox) {
    autoSwitchCheckbox.checked = true;
    autoSwitchCheckbox.disabled = true;
    autoSwitchCheckbox.title = 'Auto-switch is mandatory for all AI requests';
  }
  _removeMode.active = false; _removeMode.selected.clear();
  renderAIModelsListInModal();
}

function closeAIModelsModal() {
  _removeMode.active = false; _removeMode.selected.clear();
  const modal = document.getElementById('ai-models-modal');
  if (modal) modal.style.display = 'none';
}

// ===== MARK MODEL SUCCESS/FAILURE =====
function markModelFailure(cfg, err) {
  try {
    const stateModel = AI_MODELS_STATE.models.find(m => m.id === cfg.id);
    if (!stateModel) return;
    stateModel.status = 'error';
    stateModel.statusMessage = describeAIErrorForToast(err);
    stateModel.lastErrorAt = Date.now();
    stateModel.failureCount = (stateModel.failureCount || 0) + 1;
    saveAIModelsState();
    if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
    if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  } catch (e) {}
}

function markModelSuccess(cfg) {
  try {
    const stateModel = AI_MODELS_STATE.models.find(m => m.id === cfg.id);
    if (!stateModel) return;
    stateModel.status = 'ok';
    stateModel.statusMessage = 'Connection successful ✅';
    stateModel.lastSuccessAt = Date.now();
    stateModel.failureCount = 0;
    saveAIModelsState();
    if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
    if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  } catch (e) {}
}

function switchActiveModelTo(cfg, previousCfg) {
  if (!cfg) return;
  try {
    AI_MODELS_STATE.activeModelId = cfg.id;
    saveAIModelsState();
    if (typeof renderAIModelSelectBar === 'function') renderAIModelSelectBar();
    if (typeof renderAIModelsListInModal === 'function') renderAIModelsListInModal();
  } catch (e) {}
  if (cfg.id !== (previousCfg && previousCfg.id)) {
    if (typeof displayToastNotification === 'function') {
      displayToastNotification(`🔄 @Thinking switched to "${cfg.name}"`);
    }
  }
}

function describeAIErrorForToast(err) {
  if (!err) return 'API error';
  const status = Number(err.status) || 0;
  const detail = String((err.detail || err.message) || '').toLowerCase();
  const kind = err.kind || '';

  if (detail.includes('quota') || /rate.?limit|too many requests|insufficient_quota|billing|payment|required.*balance|exceeded.*limit|usage.?limit|credits?\b/.test(detail) || status === 429) {
    return 'quota/rate limit';
  }
  if (/model.*(not found|unavailable|does not exist|deprecated|retired)|unknown model|invalid model/.test(detail)) {
    return 'model unavailable';
  }
  if (status === 401 || status === 403) return `HTTP ${status}`;
  if (kind === 'network' || /network|cors|timeout|timed out|fetch failed|gateway|temporarily|overloaded|server error|service unavailable|bad gateway|connection/.test(detail)) {
    return `temporary/API error${status ? ` (${status})` : ''}`;
  }
  return status ? `HTTP ${status}` : 'API error';
}

function classifyAIError(err) {
  if (!err) return { shouldFallback: true, retryableLocally: false };
  const status = Number(err.status) || 0;
  const detail = String((err.detail || err.message) || '').toLowerCase();
  const kind = err.kind || '';

  const quota = /quota|rate.?limit|too many requests|insufficient_quota|billing|payment|required.*balance|exceeded.*limit|usage.?limit|credits?\b/.test(detail);
  const unavailable = /model.*(not found|unavailable|does not exist|deprecated|retired)|unknown model|invalid model/.test(detail);
  const transient = kind === 'network' || /network|cors|timeout|timed out|fetch failed|gateway|temporarily|overloaded|server error|service unavailable|bad gateway|connection/.test(detail);
  const httpRetryable = status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  const authOrConfig = status === 401 || status === 403;
  const emptyOrMalformed = kind === 'empty_response' || kind === 'malformed_response';
  const retryableLocally = !authOrConfig && !unavailable && !quota && (transient || httpRetryable || emptyOrMalformed);
  return { status, detail, kind, quota, unavailable, transient, httpRetryable, authOrConfig, emptyOrMalformed, retryableLocally, shouldFallback: true };
}

// ============================================================
// WINDOW EXPOSURE – AI Models
// ============================================================
window.openAIModelsModal = openAIModelsModal;
window.closeAIModelsModal = closeAIModelsModal;
window.toggleAIModelsInfo = toggleAIModelsInfo;
window.handleAutoSwitchToggle = handleAutoSwitchToggle;
window.importAIModels = importAIModels;
window.exportAIModels = exportAIModels;
window.toggleAIModelAddForm = toggleAIModelAddForm;
window.clearAIModelForm = clearAIModelForm;
window.handleAddNewAIModel = handleAddNewAIModel;
window.loadAIModelsState = loadAIModelsState;
window.saveAIModelsState = saveAIModelsState;
window.getActiveAIModel = getActiveAIModel;
window.findGeminiModelConfig = findGeminiModelConfig;
window.setActiveAIModel = setActiveAIModel;
window.testAIModelConnection = testAIModelConnection;
window.handleTestAllModels = handleTestAllModels;
window.openAIModelEditDialog = openAIModelEditDialog;
window.toggleAIModelsRemoveMode = toggleAIModelsRemoveMode;
window.toggleModelRemoveMark = toggleModelRemoveMark;
window.markAllModelsForRemove = markAllModelsForRemove;
window.removeMarkedAIModels = removeMarkedAIModels;
window.askImportApiType = askImportApiType;
window.normalizeAIModelApiUrl = normalizeAIModelApiUrl;
window.renderAIModelSelectBar = renderAIModelSelectBar;
window.sizeAIModelSelect = sizeAIModelSelect;
window.switchActiveModelTo = switchActiveModelTo;
window.getAutoSwitchEnabled = getAutoSwitchEnabled;
window.markModelSuccess = markModelSuccess;
window.markModelFailure = markModelFailure;
window.classifyAIError = classifyAIError;
window.describeAIErrorForToast = describeAIErrorForToast;
window.probeAIModelHealth = probeAIModelHealth;