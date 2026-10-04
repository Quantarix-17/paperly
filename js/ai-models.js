// ========================================================================
// AI MODELS MANAGER - Manage AI model configurations, testing, and selection
// ========================================================================

let AI_MODELS_STATE = { version: 1, models: [], activeModelId: null };
let _aiModelsStorageAvailable = true;
let _draggedModelId = null;
let _pendingFailedModelSave = null;

// ===== LOAD / SAVE STATE =====
function loadAIModelsState() {
  try {
    const raw = localStorage.getItem(AI_MODELS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.models)) {
        const models = parsed.models.map(m => m.status === 'testing' ? { ...m, status: 'idle', statusMessage: '' } : m);
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

// ===== TEST MODEL CONNECTION =====
async function testAIModelConnection(cfg) {
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
        return { ok: false, message: `HTTP ${response.status}: ${detail || 'No further details returned'}` };
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
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.models || !Array.isArray(data.models)) {
        if (typeof displayToastNotification === 'function') {
          displayToastNotification("Error Invalid file format — expected an array of models.");
        }
        return;
      }
      let added = 0;
      for (const m of data.models) {
        if (!m.name || !m.apiUrl || !m.apiKey || !m.modelId) continue;
        // "Duplicate" used to mean apiUrl+modelId only, so any two entries
        // pointing at the same model with DIFFERENT API keys (multiple keys
        // for the same model, for load balancing/failover — exactly what a
        // file like this one has, 4 keys per model) were treated as the same
        // model and all but the first of each group got silently skipped.
        // 16 entries, 4 distinct apiUrl+modelId combinations -> only 4
        // actually got imported. Comparing apiKey too makes different keys
        // count as different models, as intended.
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
          apiType: m.apiType || 'openai',
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
  if (AI_MODELS_STATE.models.length === 0) {
    listEl.innerHTML = `<div class="ai-model-empty">No model configured yet. Use <b>Add model</b> to connect one.</div>`;
    return;
  }

  const gripIcon = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>`;
  const checkIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`;
  const testIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.7"/><path d="M20 12a8 8 0 0 1-13.7 5.7"/><path d="M17 3v4h-4M7 21v-4h4"/></svg>`;
  const trashIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M8 10v7M12 10v7M16 10v7M7 7l1 14h8l1-14"/></svg>`;
  const infoIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 10v6"/><circle cx="12" cy="7.2" r=".8" fill="currentColor" stroke="none"/></svg>`;

  listEl.innerHTML = AI_MODELS_STATE.models.map((m, idx) => `
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
  renderAIModelsListInModal();
}

function closeAIModelsModal() {
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
window.renderAIModelSelectBar = renderAIModelSelectBar;
window.sizeAIModelSelect = sizeAIModelSelect;
window.switchActiveModelTo = switchActiveModelTo;
window.getAutoSwitchEnabled = getAutoSwitchEnabled;
window.markModelSuccess = markModelSuccess;
window.markModelFailure = markModelFailure;
window.classifyAIError = classifyAIError;
window.describeAIErrorForToast = describeAIErrorForToast;
window.probeAIModelHealth = probeAIModelHealth;