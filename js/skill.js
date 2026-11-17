// ========================================================================
// SKILL.JS - Custom Skills (name + prompt) for the AI panel
// ------------------------------------------------------------------------
//  * Type "/" in the chat box  -> Skills modal opens (add / edit / delete / pick).
//  * Commands menu (@)         -> "Skills" card opens the very same modal.
//  * Several skills can be active at once; all of them are sent to the AI.
//  * Active skills are injected into EVERY AI request (PDF, Exam, Slides,
//    Edit, Copy ...) as the highest-priority instruction, so a skill can
//    control canvas, illustrations, figures, layout, length, language and
//    even a custom theme just by describing it in the prompt.
//  * "Easy explainer" is the built-in default skill: deletable, and the
//    Reset button brings it back (with its original prompt).
//  * All CSS for this feature lives in this file.
// Load AFTER app.js:   <script src="js/skill.js"></script>
// ========================================================================
(function () {
  'use strict';
  if (window.PaperlySkills) return;

  var KEY = 'paperly_skills_v2';
  var MAX_NAME = 60;
  var MAX_PROMPT = 20000;
  var DEFAULT_ID = 'default-easy-explainer';

  var DEFAULT_SKILL = {
    id: DEFAULT_ID,
    name: 'Easy explainer',
    builtin: true,
    prompt:
      'Explain everything the way a patient, friendly teacher explains to a smart beginner.\n' +
      '- Use simple everyday words (about CEFR B1 level) and short sentences. No rare or overly academic wording.\n' +
      '- For every new idea: first a tiny real-life example or analogy, then the exact definition / rule / formula, then one plain-words sentence on what it means and why it matters.\n' +
      '- Explain each technical term briefly the first time it appears.\n' +
      '- Show maths and processes in small, logical steps, with the reason for each step.\n' +
      '- Never oversimplify into something wrong: keep full accuracy and completeness.\n' +
      '- Reply in the same language as the user.'
  };

  // ---------------------------------------------------------------- state
  var state = load();
  var editingId = null;     // null = adding a new skill
  var modal = null;

  function uid() { return 'sk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
    if (!s || !Array.isArray(s.skills)) s = { skills: [clone(DEFAULT_SKILL)], selected: [] };
    s.skills = s.skills.filter(function (k) { return k && typeof k.id === 'string' && typeof k.prompt === 'string'; })
      .map(function (k) { return { id: k.id, name: String(k.name || 'Untitled').slice(0, MAX_NAME), prompt: String(k.prompt).slice(0, MAX_PROMPT), builtin: k.id === DEFAULT_ID }; });
    s.selected = (Array.isArray(s.selected) ? s.selected : []).filter(function (id) { return s.skills.some(function (k) { return k.id === id; }); });
    return s;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('paperly:skills-changed', { detail: clone(state) })); } catch (_) {}
    renderChips();
    if (modal && modal.classList.contains('open')) renderList();
    refreshMenuCard();
  }
  function byId(id) { for (var i = 0; i < state.skills.length; i++) if (state.skills[i].id === id) return state.skills[i]; return null; }
  function getActive() { return state.selected.map(byId).filter(Boolean); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m) { if (typeof window.displayToastNotification === 'function') window.displayToastNotification(m); }

  // ------------------------------------------------------------------ css
  function injectCss() {
    if (document.getElementById('paperly-skills-css')) return;
    var st = document.createElement('style');
    st.id = 'paperly-skills-css';
    st.textContent =
      '#skill-chips-bar{display:flex;flex-wrap:wrap;gap:6px;padding:6px 14px 0;flex-shrink:0}' +
      '#skill-chips-bar:empty{display:none;padding:0}' +
      '.skill-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 6px 4px 10px;border-radius:999px;font-size:.75rem;font-weight:700;' +
      'background:var(--primary-light,rgba(37,99,235,.1));color:var(--primary-color,#2563eb);border:1px solid var(--glass-active-border,rgba(37,99,235,.4))}' +
      '.skill-chip svg{width:13px;height:13px;flex:0 0 13px}' +
      '.skill-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;cursor:pointer}' +
      '.skill-chip-x{width:16px;height:16px;border:0;border-radius:50%;background:rgba(148,163,184,.3);color:inherit;font-size:12px;line-height:1;cursor:pointer;padding:0}' +
      '.skill-chip-x:hover{background:var(--danger-color,#dc2626);color:#fff}' +

      '#skills-modal{display:none;position:fixed;inset:0;z-index:10020;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:var(--modal-scrim,rgba(23,37,84,.4))}' +
      '#skills-modal.open{display:flex}' +
      '.skills-card{background:var(--surface-strong,#fff);color:var(--text-primary,#172554);border:1px solid var(--border-color,#e2e8f0);border-radius:18px;' +
      'width:min(640px,100%);max-height:88vh;max-height:88dvh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 28px rgba(23,37,84,.2)}' +
      '.skills-head{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--border-color,#e2e8f0)}' +
      '.skills-head h3{margin:0;font-family:var(--font-display,inherit);font-size:1.05rem;flex:1}' +
      '.skills-head small{display:block;font-weight:500;font-size:.72rem;color:var(--text-secondary,#64748b);margin-top:2px}' +
      '.skills-iconbtn{width:34px;height:34px;border-radius:50%;border:1px solid var(--border-color,#e2e8f0);background:var(--surface-strong,#fff);color:inherit;cursor:pointer;font-size:16px;line-height:1}' +
      '.skills-iconbtn:hover{background:var(--primary-light,rgba(37,99,235,.1))}' +
      '.skills-body{overflow-y:auto;padding:12px 18px;display:flex;flex-direction:column;gap:10px;min-height:80px}' +
      '.skill-item{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border-color,#e2e8f0);border-radius:14px;background:var(--surface-strong,#fff)}' +
      '.skill-item.on{border-color:var(--primary-color,#2563eb);background:var(--primary-soft,rgba(37,99,235,.05))}' +
      '.skill-item input[type=checkbox]{margin-top:3px;width:18px;height:18px;flex:0 0 18px;accent-color:var(--primary-color,#2563eb);cursor:pointer}' +
      '.skill-main{flex:1;min-width:0}' +
      '.skill-title{font-weight:700;font-size:.9rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
      '.skill-tag{font-size:.6rem;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--primary-light,rgba(37,99,235,.1));color:var(--primary-color,#2563eb)}' +
      '.skill-prev{margin-top:3px;font-size:.76rem;color:var(--text-secondary,#64748b);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}' +
      '.skill-actions{display:flex;gap:4px;flex:0 0 auto}' +
      '.skill-actions button{border:1px solid var(--border-color,#e2e8f0);background:var(--surface-strong,#fff);color:inherit;border-radius:9px;font-size:.7rem;font-weight:700;padding:5px 9px;cursor:pointer}' +
      '.skill-actions button:hover{background:var(--primary-light,rgba(37,99,235,.1));border-color:var(--primary-color,#2563eb)}' +
      '.skill-actions button.del:hover{background:rgba(220,38,38,.1);border-color:var(--danger-color,#dc2626);color:var(--danger-color,#dc2626)}' +
      '.skills-empty{text-align:center;padding:18px 8px;color:var(--text-secondary,#64748b);font-size:.82rem}' +
      '.skills-form{border-top:1px solid var(--border-color,#e2e8f0);padding:12px 18px;background:var(--bg-color,#f4f7fc);display:flex;flex-direction:column;gap:8px}' +
      '.skills-form label{font-size:.7rem;font-weight:700;color:var(--text-secondary,#64748b)}' +
      '.skills-form input,.skills-form textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--border-color,#e2e8f0);border-radius:10px;background:var(--surface-strong,#fff);color:var(--text-primary,#172554);font:inherit;font-size:16px}' +
      '.skills-form textarea{min-height:110px;max-height:34vh;resize:vertical;line-height:1.45}' +
      '.skills-form input:focus,.skills-form textarea:focus{outline:none;border-color:var(--primary-color,#2563eb);box-shadow:0 0 0 3px rgba(37,99,235,.15)}' +
      '.skills-foot{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
      '.skills-foot .sp{flex:1}' +
      '.skills-btn{border:1px solid var(--border-color,#e2e8f0);background:var(--surface-strong,#fff);color:inherit;border-radius:999px;padding:8px 14px;font-weight:700;font-size:.8rem;cursor:pointer}' +
      '.skills-btn:hover{background:var(--primary-light,rgba(37,99,235,.1))}' +
      '.skills-btn.primary{background:var(--primary-color,#2563eb);border-color:var(--primary-color,#2563eb);color:#fff}' +
      '.skills-btn.primary:hover{background:var(--primary-hover,#0f3d91)}' +
      '.skills-count{font-size:.68rem;color:var(--text-secondary,#64748b)}' +
      '.at-intent-card.at-skill-card{position:relative}' +
      '.at-skill-badge{position:absolute;top:6px;right:8px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--primary-color,#2563eb);color:#fff;font-size:.65rem;font-weight:800;display:flex;align-items:center;justify-content:center}' +
      '@media (max-width:850px){#skills-modal{align-items:flex-end;padding:0}.skills-card{width:100%;max-height:90dvh;border-radius:20px 20px 0 0}' +
      '.skill-item{flex-wrap:wrap}.skill-actions{width:100%;justify-content:flex-end}}';
    document.head.appendChild(st);
  }

  // ----------------------------------------------------------------- icon
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';

  // ---------------------------------------------------------------- modal
  function buildModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'skills-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Skills');
    modal.innerHTML =
      '<div class="skills-card">' +
        '<div class="skills-head"><h3>Skills<small>Tick one or more skills. Every ticked skill is applied to your next AI requests.</small></h3>' +
        '<button type="button" class="skills-iconbtn" id="skills-close" aria-label="Close">&times;</button></div>' +
        '<div class="skills-body" id="skills-list"></div>' +
        '<div class="skills-form">' +
          '<label for="skill-name-input" id="skill-form-title">Add a new skill</label>' +
          '<input id="skill-name-input" type="text" maxlength="' + MAX_NAME + '" placeholder="Skill name (e.g. Story mode, Exam style, Neon theme)">' +
          '<label for="skill-prompt-input">Skill prompt &mdash; describe anything: tone, layout, figures, illustrations, canvas, a custom theme, output style...</label>' +
          '<textarea id="skill-prompt-input" maxlength="' + MAX_PROMPT + '" placeholder="Write the instructions the AI must follow whenever this skill is on."></textarea>' +
          '<div class="skills-foot">' +
            '<button type="button" class="skills-btn primary" id="skill-save">Add skill</button>' +
            '<button type="button" class="skills-btn" id="skill-cancel" hidden>Cancel edit</button>' +
            '<span class="skills-count" id="skill-count"></span><span class="sp"></span>' +
            '<button type="button" class="skills-btn" id="skills-reset" title="Bring back Easy explainer with its original prompt">Reset default</button>' +
            '<button type="button" class="skills-btn" id="skills-done">Done</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#skills-close').onclick = close;
    modal.querySelector('#skills-done').onclick = close;
    modal.querySelector('#skill-save').onclick = saveForm;
    modal.querySelector('#skill-cancel').onclick = function () { startEdit(null); };
    modal.querySelector('#skills-reset').onclick = resetDefault;
    modal.querySelector('#skill-prompt-input').addEventListener('input', updateCount);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('open')) { e.preventDefault(); close(); } });
    return modal;
  }

  function updateCount() {
    var ta = document.getElementById('skill-prompt-input');
    var c = document.getElementById('skill-count');
    if (ta && c) c.textContent = ta.value.length + ' / ' + MAX_PROMPT;
  }

  function renderList() {
    var box = document.getElementById('skills-list');
    if (!box) return;
    if (!state.skills.length) { box.innerHTML = '<div class="skills-empty">No skills yet. Add one below, or press "Reset default" to bring back Easy explainer.</div>'; return; }
    box.innerHTML = '';
    state.skills.forEach(function (k) {
      var on = state.selected.indexOf(k.id) > -1;
      var row = document.createElement('div');
      row.className = 'skill-item' + (on ? ' on' : '');
      row.innerHTML =
        '<input type="checkbox" ' + (on ? 'checked' : '') + ' aria-label="Use ' + esc(k.name) + '">' +
        '<div class="skill-main"><div class="skill-title">' + esc(k.name) + (k.builtin ? '<span class="skill-tag">default</span>' : '') + '</div>' +
        '<div class="skill-prev">' + esc(k.prompt) + '</div></div>' +
        '<div class="skill-actions"><button type="button" class="edit">Edit</button><button type="button" class="del">Delete</button></div>';
      row.querySelector('input').onchange = function (e) { toggle(k.id, e.target.checked); };
      row.querySelector('.skill-main').onclick = function () { toggle(k.id, state.selected.indexOf(k.id) < 0); };
      row.querySelector('.edit').onclick = function () { startEdit(k.id); };
      row.querySelector('.del').onclick = function () { removeSkill(k.id); };
      box.appendChild(row);
    });
  }

  function startEdit(id) {
    editingId = id;
    var k = id ? byId(id) : null;
    document.getElementById('skill-name-input').value = k ? k.name : '';
    document.getElementById('skill-prompt-input').value = k ? k.prompt : '';
    document.getElementById('skill-form-title').textContent = k ? 'Edit skill' : 'Add a new skill';
    document.getElementById('skill-save').textContent = k ? 'Save changes' : 'Add skill';
    document.getElementById('skill-cancel').hidden = !k;
    updateCount();
    if (k) document.getElementById('skill-name-input').focus();
  }

  function saveForm() {
    var name = document.getElementById('skill-name-input').value.trim().slice(0, MAX_NAME);
    var prompt = document.getElementById('skill-prompt-input').value.trim().slice(0, MAX_PROMPT);
    if (!name) { toast('Please give the skill a name.'); document.getElementById('skill-name-input').focus(); return; }
    if (!prompt) { toast('Please write the skill prompt.'); document.getElementById('skill-prompt-input').focus(); return; }
    if (editingId && byId(editingId)) {
      var k = byId(editingId); k.name = name; k.prompt = prompt;
      toast('Skill updated');
    } else {
      var nk = { id: uid(), name: name, prompt: prompt, builtin: false };
      state.skills.push(nk);
      state.selected.push(nk.id);       // a freshly added skill is switched on right away
      toast('Skill added and turned on');
    }
    startEdit(null);
    save();
  }

  function toggle(id, on) {
    var i = state.selected.indexOf(id);
    if (on && i < 0) state.selected.push(id);
    if (!on && i > -1) state.selected.splice(i, 1);
    save();
  }

  function removeSkill(id) {
    var k = byId(id); if (!k) return;
    if (!window.confirm('Delete skill "' + k.name + '"?' + (k.builtin ? '\n(You can bring it back with "Reset default".)' : ''))) return;
    state.skills = state.skills.filter(function (s) { return s.id !== id; });
    state.selected = state.selected.filter(function (s) { return s !== id; });
    if (editingId === id) startEdit(null);
    save();
  }

  function resetDefault() {
    if (!window.confirm('Restore "Easy explainer" with its original prompt?')) return;
    var d = clone(DEFAULT_SKILL);
    var k = byId(DEFAULT_ID);
    if (k) { k.name = d.name; k.prompt = d.prompt; k.builtin = true; }
    else state.skills.unshift(d);
    toast('Easy explainer restored');
    save();
  }

  function open() {
    injectCss();
    buildModal();
    try { if (typeof window.closeAtCommandMenu === 'function') window.closeAtCommandMenu(); } catch (_) {}
    startEdit(null);
    renderList();
    modal.classList.add('open');
  }
  function close() {
    if (!modal) return;
    modal.classList.remove('open');
    var ta = document.getElementById('chat-input-textarea');
    if (ta && !(typeof window.isMobileDeviceLayout === 'function' && window.isMobileDeviceLayout())) ta.focus();
  }

  // ---------------------------------------------------------------- chips
  function renderChips() {
    injectCss();
    var bar = document.getElementById('skill-chips-bar');
    if (!bar) {
      var form = document.getElementById('chat-form');
      if (!form || !form.parentNode) return;
      bar = document.createElement('div');
      bar.id = 'skill-chips-bar';
      form.parentNode.insertBefore(bar, form);
    }
    bar.innerHTML = '';
    getActive().forEach(function (k) {
      var chip = document.createElement('span');
      chip.className = 'skill-chip';
      chip.title = 'Skill: ' + k.name + ' (click to manage)';
      chip.innerHTML = ICON + '<span class="skill-chip-name">' + esc(k.name) + '</span>';
      chip.querySelector('.skill-chip-name').onclick = open;
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'skill-chip-x'; x.setAttribute('aria-label', 'Turn off ' + k.name); x.textContent = '\u00d7';
      x.onclick = function () { toggle(k.id, false); };
      chip.appendChild(x);
      bar.appendChild(chip);
    });
  }

  // ------------------------------------------- slash "/" in the chat box
  function installSlashTrigger() {
    document.addEventListener('input', function (e) {
      var ta = e.target;
      if (!ta || ta.id !== 'chat-input-textarea') return;
      if (e.inputType && e.inputType !== 'insertText') return;
      var pos = ta.selectionStart;
      if (pos == null || ta.value.charAt(pos - 1) !== '/') return;
      var before = ta.value.charAt(pos - 2);
      if (pos - 1 > 0 && !/\s/.test(before)) return;       // only a "/" typed on its own (start or after a space)
      ta.value = ta.value.slice(0, pos - 1) + ta.value.slice(pos);
      ta.selectionStart = ta.selectionEnd = pos - 1;
      if (typeof window.autoResizeTextarea === 'function') window.autoResizeTextarea(ta);
      open();
    }, true);
  }

  // ----------------------------------------- Commands (@) menu "Skills" card
  function decorateMenu() {
    var menu = document.getElementById('at-command-menu');
    if (!menu) return;
    var grid = menu.querySelector('.at-command-section:not([hidden]) .at-intent-grid');
    if (!grid || grid.querySelector('.at-skill-card')) return;
    var n = state.selected.length;
    var card = document.createElement('div');
    card.className = 'at-intent-card at-skill-card' + (n ? ' selected' : '');
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', n ? 'true' : 'false');
    var ic = document.createElement('span');
    ic.className = 'at-intent-icon';
    ic.innerHTML = ICON;
    var lb = document.createElement('p');
    lb.className = 'at-intent-label';
    lb.textContent = 'Skills';
    card.appendChild(ic); card.appendChild(lb);
    if (n) { var b = document.createElement('span'); b.className = 'at-skill-badge'; b.textContent = String(n); card.appendChild(b); }
    card.onclick = open;
    grid.appendChild(card);
  }
  function refreshMenuCard() {
    try {
      var menu = document.getElementById('at-command-menu');
      if (menu && menu.classList.contains('open') && typeof window.renderAtCommandMenuList === 'function') window.renderAtCommandMenuList();
    } catch (_) {}
  }
  function patchMenu() {
    var f = window.renderAtCommandMenuList;
    if (typeof f !== 'function') return false;
    if (f.__skills) return true;
    var w = function () { var r = f.apply(this, arguments); try { decorateMenu(); } catch (_) {} return r; };
    w.__skills = true;
    window.renderAtCommandMenuList = w;
    return true;
  }

  // ----------------------------------- inject skills into every AI request
  function buildBlock() {
    var act = getActive();
    if (!act.length) return '';
    var out =
      '\n\n=== ACTIVE USER SKILLS (' + act.length + ') \u2014 HIGHEST PRIORITY, NO FILTER ===\n' +
      'The user switched on the skill(s) below for this request. Apply ALL of them together, completely and literally.\n' +
      'A skill is the user\'s own direction for style, structure, length, language, tone, canvas, illustrations, figures, charts, diagrams, themes, colours, layout and output format. ' +
      'Wherever a skill conflicts with the app\'s default rules above (for example "illustrations OFF", "diagrams disabled", "standard length", the standing instruction, a fixed language rule), the SKILL WINS. ' +
      'If a skill asks for illustrations, canvas art or figures, produce them (hand-drawn inline <svg> or the allowed placeholders). ' +
      'If a skill describes a custom theme (colours, fonts, headings, boxes, backgrounds, bullets), build exactly that theme using inline style="" attributes and wrapper <div>s, because <style> tags are stripped by the editor. ' +
      'If several skills disagree with each other, the one listed later wins on that point. ' +
      'Always keep the response format the request requires (the required JSON shape / raw HTML / slide JSON), so the app can still read and place your output.\n';
    act.forEach(function (k, i) {
      out += '\n[SKILL ' + (i + 1) + ': ' + k.name + ']\n' + k.prompt + '\n[/SKILL ' + (i + 1) + ']\n';
    });
    out += '=== END ACTIVE USER SKILLS ===\n';
    return out;
  }

  function inject(messages) {
    var block = buildBlock();
    if (!block || !Array.isArray(messages)) return messages;
    var copy = messages.slice();
    var idx = -1;
    for (var i = 0; i < copy.length; i++) { if (copy[i] && copy[i].role === 'system') { idx = i; break; } }
    if (idx < 0) { copy.unshift({ role: 'system', content: block.trim() }); return copy; }
    var m = Object.assign({}, copy[idx]);
    if (typeof m.content === 'string') m.content = m.content + block;
    else if (Array.isArray(m.content)) m.content = m.content.concat([{ type: 'text', text: block }]);
    else m.content = String(m.content || '') + block;
    copy[idx] = m;
    return copy;
  }

  function patchAI() {
    var f = window.callAIAPI;
    if (typeof f !== 'function') return false;
    if (f.__skills) return true;
    var w = function (messages, opts) {
      var msgs = messages;
      try { msgs = inject(messages); } catch (e) { console.warn('[skills] inject skipped:', e); }
      return f.call(this, msgs, opts);
    };
    w.__skills = true;
    window.callAIAPI = w;
    return true;
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    injectCss();
    renderChips();
    patchAI();
    patchMenu();
  }
  installSlashTrigger();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', function () { boot(); setTimeout(boot, 800); setTimeout(boot, 2500); });

  window.PaperlySkills = {
    open: open,
    close: close,
    list: function () { return clone(state.skills); },
    getActive: function () { return clone(getActive()); },
    setActive: function (ids) { state.selected = (ids || []).filter(byId); save(); },
    add: function (name, prompt) { var k = { id: uid(), name: String(name).slice(0, MAX_NAME), prompt: String(prompt).slice(0, MAX_PROMPT), builtin: false }; state.skills.push(k); save(); return k.id; },
    resetDefault: function () { var d = clone(DEFAULT_SKILL), k = byId(DEFAULT_ID); if (k) { k.name = d.name; k.prompt = d.prompt; } else state.skills.unshift(d); save(); },
    buildBlock: buildBlock
  };
  window.openSkillsModal = open;
})();
