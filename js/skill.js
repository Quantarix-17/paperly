// ========================================================================
// SKILL — user-defined "skills" for the AI panel
//
//  * Type "/" in the chat box -> Skills modal opens. The same modal opens from
//    the "Skills" card in the @ menu (like Create / Copy / Copy & Refine) and,
//    on desktop only, from a separate "/" button beside "@".
//  * Add / edit / delete any number of skills (name + prompt).
//  * Tick one or more skills -> they appear as chips above the chat box and
//    ALL of them are applied to every AI generation call until removed (x).
//  * A default skill "Easy explainer" ships with the app. It can be deleted
//    and brought back any time with "Reset default".
//  * Skills are injected into the AI request itself (system prompt + a short
//    reminder on the last user message), so a skill can control content,
//    layout, canvas look, illustrations, figures, custom themes, output
//    style... anything the prompt describes. The app adds no filter of its own.
//  * All CSS for this feature lives in this file (injected at runtime).
//
// Load AFTER app.js:  <script src="js/skill.js"></script>
// ========================================================================
(function () {
  'use strict';
  if (window.PaperlySkills) return;

  // ===== CONSTANTS =====
  var STORE_KEY = 'paperly_skills_v1';
  var DEFAULT_ID = 'default_easy_explainer';
  var MAX_NAME = 30;   // max characters in a skill title
  var MAX_PROMPT = 40000;

  var OLD_DEFAULT_PROMPTS = [
    [
    'Explain everything in an easy, friendly way, as if teaching a curious beginner who has never seen the topic before.',
    '',
    '- Use simple everyday words. If a technical term is unavoidable, define it right away in one plain sentence.',
    '- Use short sentences and one idea at a time. Go from the basic idea to the details, step by step.',
    '- Give a relatable real-life analogy or example for every important concept.',
    '- Show small worked examples with every step written out.',
    '- End each major section with a one- or two-line "In short" recap.',
    '- Write in the same language as the person\'s request.',
    '- Keep full accuracy: simplify the wording, never the facts.'
  ].join('\n')
  ];

  var DEFAULT_PROMPT = [
    "Act as a friendly, patient, and highly skilled teacher who genuinely enjoys helping me understand things.",
    "",
    "Your main goal is not just to give me information, but to make sure I truly understand what you are explaining.",
    "",
    "1. Simple and Natural Explanation",
    "",
    "- Explain everything in very simple, easy-to-understand language.",
    "- Sound like a real human teacher or a knowledgeable friend, not a robot or an AI.",
    "- Use a natural, conversational tone. Avoid overly formal, robotic, or textbook-like language.",
    "- Explain difficult ideas using familiar situations and simple examples.",
    "- Never assume I already understand something just because it seems basic to you.",
    "",
    "2. Teach Step by Step",
    "",
    "- Start with the basic idea before introducing technical definitions or formulas.",
    "- Break complicated topics into small, manageable parts.",
    "- Explain why something works, not just what it is.",
    "- When explaining formulas, describe what each symbol means and why the formula is used.",
    "- For mathematical problems, show every important step and explain how you got there.",
    "- Never skip steps that might confuse a beginner.",
    "",
    "3. Language and Communication",
    "",
    "- Use the same language I use to communicate with you.",
    "- If I ask in Bangla, explain in Bangla while keeping important technical terms, formulas, and definitions in English.",
    "- If I ask in English, explain in clear and simple English (B1–B2 level).",
    "- Keep sentences relatively short and natural.",
    "",
    "4. Examples and Understanding",
    "",
    "- Give simple examples before moving to complex ones.",
    "- Use practical examples whenever they help explain an idea.",
    "- For mathematical topics, include relevant solved examples.",
    "- If a concept has multiple parts, explain each part separately.",
    "",
    "5. Visual Learning: Figures, Diagrams and Illustrations",
    "",
    "Visual explanation is an important part of your teaching approach. Do not rely on text alone when a visual can make a concept easier to understand.",
    "",
    "- Whenever a figure, diagram, graph, chart, illustration, or other visual representation can improve understanding, create and include one.",
    "- Use any type of visual that best fits the topic. Do not limit yourself to a particular format.",
    "- For mathematical topics, use relevant mathematical figures, coordinate diagrams, graphs, geometric illustrations, and step-by-step visual solutions.",
    "- For Statistics and Probability, use probability distribution curves, histograms, bar charts, pie charts, tables, probability trees, Venn diagrams, and other relevant statistical illustrations.",
    "- For scientific topics, use labelled diagrams, process illustrations, and flowcharts.",
    "- For theoretical topics, use concept maps, comparison diagrams, timelines, and flowcharts whenever helpful.",
    "- Label important parts of every figure clearly.",
    "- Explain the figure in simple language so I understand what it represents and how it connects to the concept.",
    "- When a mathematical problem involves a graph or geometric relationship, show the relevant figure alongside the solution whenever possible.",
    "- Create original, topic-specific visuals instead of using unrelated decorative images.",
    "- Do not add visuals just for decoration. Every figure must serve a clear learning purpose.",
    "- If a visual is not necessary, explain normally without forcing one.",
    "",
    "Important: Do not simply tell me that a figure would be helpful. Actually generate or display the relevant figure whenever your available tools and interface support it.",
    "",
    "6. Interaction and Teaching Style",
    "",
    "- Teach me like a patient personal tutor.",
    "- Do not dump too much information at once.",
    "- Focus on one concept at a time.",
    "- If I say \"I don't understand,\" explain it again in a different and even simpler way.",
    "- Do not repeat the same explanation using slightly different words.",
    "- Do not move to the next concept until the current one is clear.",
    "- Avoid unnecessary questions. Ask only when clarification is genuinely needed.",
    "",
    "7. Important Rules",
    "",
    "- Be accurate and academically correct, even when simplifying explanations.",
    "- Avoid unnecessary jargon, complicated vocabulary, and lengthy introductions.",
    "- Do not use generic AI phrases or robotic transitions.",
    "- Do not give unnecessary summaries after every small explanation.",
    "- Prioritize understanding over memorization.",
    "- All mathematical equations and formulas must be written in proper LaTeX format.",
    "- Keep equations mobile-friendly. Avoid unnecessarily long equations on a single line; break complicated equations into smaller steps using appropriate alignment.",
    "- Maintain proper mathematical notation and formatting.",
    "",
    "Remember: I want to understand things naturally, as if a good friend who is also an excellent teacher is sitting beside me and explaining everything patiently. Make even difficult topics feel surprisingly easy through simple explanations, practical examples, and meaningful visual illustrations."
  ].join('\n');

  function makeDefaults() {
    return [{ id: DEFAULT_ID, name: 'Easy explainer', prompt: DEFAULT_PROMPT, builtin: true }];
  }

  // ===== STATE =====
  var skills = [];          // [{id, name, prompt, builtin?}]
  var selected = [];        // ids, in the order the person ticked them
  var ui = { built: false, editingId: null, confirmDeleteId: null, confirmReset: false, resetTimer: 0, delTimer: 0 };

  // ===== STORAGE =====
  function isValid(s) {
    return s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.prompt === 'string';
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (_) {}
    if (raw === null) { skills = makeDefaults(); save(); return; }   // first run: seed the default
    try {
      var arr = JSON.parse(raw);
      skills = Array.isArray(arr) ? arr.filter(isValid).map(function (s) { s.name = s.name.slice(0, MAX_NAME); return s; }) : makeDefaults();
      // Upgrade: if the default skill still holds an older, untouched default text, switch it to the new one.
      var d = byId(DEFAULT_ID);
      if (d && OLD_DEFAULT_PROMPTS.indexOf(d.prompt) !== -1) { d.prompt = DEFAULT_PROMPT; save(); }
    } catch (_) { skills = makeDefaults(); }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(skills)); return true; }
    catch (_) { toast('Could not save skills (browser storage is full or blocked).'); return false; }
  }

  // ===== SMALL HELPERS =====
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    if (typeof window.displayToastNotification === 'function') window.displayToastNotification(msg);
  }
  function byId(id) { for (var i = 0; i < skills.length; i++) if (skills[i].id === id) return skills[i]; return null; }
  function newId() { return 'sk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function el(id) { return document.getElementById(id); }
  function getSelectedSkills() {
    return selected.map(byId).filter(Boolean);
  }

  var ICON = {
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    reset: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/></svg>'
  };

  // ===== CSS (all skill UI styling lives here) =====
  function injectCSS() {
    if (el('paperly-skill-css')) return;
    var css = [
      /* Blue scheme for the whole Skills feature. Light values on :root, dark values on .dark (html or body). */
      ':root{--sk-accent:#2563eb;--sk-accent-hover:#1d4ed8;--sk-on-accent:#ffffff;--sk-accent-soft:rgba(37,99,235,.10);--sk-accent-border:rgba(37,99,235,.55);--sk-text:#1e40af;--sk-glow:rgba(37,99,235,.22);}',
      '.dark{--sk-accent:#60a5fa;--sk-accent-hover:#93c5fd;--sk-on-accent:#0b1220;--sk-accent-soft:rgba(96,165,250,.16);--sk-accent-border:rgba(96,165,250,.6);--sk-text:#bfdbfe;--sk-glow:rgba(96,165,250,.28);}',
      /* slash button + chips */
      '#skill-slash-btn{font-weight:800;font-size:1.05rem;font-family:var(--font-display,inherit);}',
      '#skill-slash-btn{color:var(--sk-accent);}#skill-slash-btn.has-skills{border-color:var(--sk-accent);background:var(--sk-accent-soft);}',
      '@media (max-width:850px){#skill-slash-btn{display:none!important;}}',   /* desktop only; on mobile use the Skills card in the @ menu */
      /* "Skills" card inside the @ menu (same look as Create / Copy / Copy & Refine) */
      '.at-intent-card.skill-card{position:relative;}',
      '#at-command-menu .at-intent-card.skill-card .at-intent-icon{color:var(--sk-accent)!important;}',
      '#at-command-menu .at-intent-card.skill-card.selected{background:var(--sk-accent-soft)!important;border-color:var(--sk-accent)!important;box-shadow:inset 0 0 0 1px var(--sk-accent)!important;}',
      '#at-command-menu .at-intent-card.skill-card.selected .at-intent-label{color:var(--sk-text)!important;}',
      '.skill-card-count{position:absolute;top:8px;right:8px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;',
      '  font-size:.68rem;font-weight:800;background:var(--sk-accent);color:var(--sk-on-accent);}',
      /* ONE shared row: running @ command chips + skill chips sit together */
      '#chips-row{display:none;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 14px 2px;flex:0 0 auto;min-width:0;max-width:100%;}',
      '#chips-row:has(.at-chip,.skill-chip){display:flex;}',
      '#chips-row #at-command-chips,#chips-row #skill-chips{display:contents!important;padding:0!important;}',
      '.skill-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 6px 5px 10px;border-radius:var(--radius-pill,999px);',
      '  font-size:.75rem;font-weight:700;color:var(--sk-text);background:var(--sk-accent-soft);',
      '  border:1px solid var(--sk-accent-border);max-width:100%;}',
      '.skill-chip>svg{flex:0 0 16px;color:var(--sk-accent);}',
      '.skill-chip-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.skill-chip-x{all:unset;box-sizing:border-box;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-secondary);}',
      '.skill-chip-x:hover{background:var(--sk-accent-soft);color:var(--sk-accent);}',
      '.skill-chip-x:focus-visible{outline:2px solid var(--sk-accent);}',

      /* modal shell */
      '#skill-modal{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;padding:16px;',
      '  background:var(--modal-scrim,rgba(60,64,82,.28));-webkit-backdrop-filter:var(--modal-blur,blur(14px));backdrop-filter:var(--modal-blur,blur(14px));}',
      '#skill-modal.open{display:flex;}',
      '.skill-box{width:min(640px,100%);max-height:min(86vh,760px);display:flex;flex-direction:column;overflow:hidden;',
      '  background:var(--surface-strong,#fff);color:var(--text-primary);border:1px solid var(--border-color);',
      '  border-radius:var(--radius-lg,22px);box-shadow:var(--shadow-lg);animation:skillIn .18s var(--ease,ease-out);}',
      '@keyframes skillIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}',
      '.skill-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px 12px;}',
      '.skill-head-ic{width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--sk-accent-soft);color:var(--sk-accent);flex:0 0 36px;}',
      '.skill-head-tx{flex:1;min-width:0;}',
      '.skill-title{font-family:var(--font-display,inherit);font-size:1.1rem;font-weight:800;line-height:1.25;}',
      '.skill-sub{font-size:.8rem;color:var(--text-secondary);margin-top:2px;line-height:1.4;}',
      '.skill-x{all:unset;box-sizing:border-box;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-secondary);flex:0 0 34px;}',
      '.skill-x:hover{background:var(--surface-hover);color:var(--text-primary);}',
      '.skill-x:focus-visible{outline:2px solid var(--sk-accent);}',
      '.skill-body{flex:1;min-height:0;overflow:auto;padding:4px 20px 14px;-webkit-overflow-scrolling:touch;}',
      '.skill-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0 10px;}',
      '.skill-count{font-size:.78rem;font-weight:700;color:var(--text-secondary);}',

      /* buttons */
      '.skill-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:var(--radius-pill,999px);',
      '  font-size:.82rem;font-weight:700;cursor:pointer;color:var(--text-primary);background:var(--surface-color);border:1.5px solid var(--border-color);',
      '  transition:transform .12s var(--ease,ease),background .12s;touch-action:manipulation;}',
      '.skill-btn:hover{background:var(--surface-hover);transform:translateY(-1px);}',
      '.skill-btn:focus-visible{outline:2px solid var(--sk-accent);outline-offset:2px;}',
      '.skill-btn.primary{background:var(--sk-accent);color:var(--sk-on-accent);border-color:transparent;}',
      '.skill-btn.primary:hover{background:var(--sk-accent-hover);}',
      '.skill-btn.danger{color:var(--danger-color,#f04452);border-color:var(--danger-color,#f04452);}',
      '.skill-btn.sm{padding:7px 11px;font-size:.76rem;}',

      /* list */
      '.skill-list{display:flex;flex-direction:column;gap:8px;}',
      '.skill-item{display:flex;align-items:flex-start;gap:12px;padding:12px 12px 12px 14px;border-radius:var(--radius-md,16px);cursor:pointer;',
      '  border:1.5px solid var(--border-color);background:var(--surface-color);transition:border-color .12s,background .12s;}',
      '.skill-item:hover{background:var(--surface-hover);}',
      '.skill-item.on{border-color:var(--sk-accent);background:var(--sk-accent-soft);}',
      '.skill-item:focus-visible{outline:2px solid var(--sk-accent);outline-offset:2px;}',
      '.skill-check{flex:0 0 22px;width:22px;height:22px;margin-top:1px;border-radius:7px;border:2px solid var(--border-color);display:flex;align-items:center;justify-content:center;color:transparent;transition:all .12s;}',
      '.skill-item.on .skill-check{background:var(--sk-accent);border-color:var(--sk-accent);color:var(--sk-on-accent);}',
      '.skill-main{flex:1;min-width:0;}',
      '.skill-name{font-weight:800;font-size:.92rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.skill-tag{font-size:.64rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:var(--sk-accent-soft);color:var(--sk-text);}',
      '.skill-prev{font-size:.78rem;color:var(--text-secondary);margin-top:4px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word;}',
      '.skill-acts{display:flex;gap:2px;flex:0 0 auto;}',
      '.skill-ib{all:unset;box-sizing:border-box;min-width:34px;height:34px;padding:0 8px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;font-size:.74rem;font-weight:700;color:var(--text-secondary);}',
      '.skill-ib:hover{background:var(--surface-hover);color:var(--text-primary);}',
      '.skill-ib.danger:hover,.skill-ib.confirm{color:var(--danger-color,#f04452);}',
      '.skill-ib:focus-visible{outline:2px solid var(--sk-accent);}',
      '.skill-empty{text-align:center;padding:30px 10px;color:var(--text-secondary);font-size:.86rem;line-height:1.55;}',

      /* form */
      '.skill-form{display:flex;flex-direction:column;gap:12px;padding-top:6px;}',
      '.skill-label{font-size:.78rem;font-weight:800;color:var(--text-secondary);display:flex;justify-content:space-between;align-items:baseline;gap:8px;}',
      '.skill-label small{font-weight:600;opacity:.8;}',
      '.skill-input,.skill-textarea{width:100%;box-sizing:border-box;padding:11px 13px;border-radius:var(--radius-sm,12px);font:inherit;font-size:.9rem;',
      '  color:var(--text-primary);background:var(--select-control-bg,var(--surface-color));border:1.5px solid var(--border-color);margin-top:6px;}',
      '.skill-textarea{min-height:230px;resize:vertical;line-height:1.5;}',
      '.skill-input:focus,.skill-textarea:focus{outline:none;border-color:var(--sk-accent);box-shadow:0 0 0 3px var(--sk-glow);}',
      '.skill-err{color:var(--danger-color,#f04452);font-size:.78rem;font-weight:700;min-height:1em;}',
      '.skill-form-acts{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;}',
      '.skill-hint{font-size:.76rem;color:var(--text-secondary);line-height:1.5;padding:10px 12px;border-radius:var(--radius-sm,12px);background:var(--sk-accent-soft);}',

      /* footer */
      '.skill-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 20px 16px;border-top:1px solid var(--border-color);flex-wrap:wrap;}',

      /* mobile: bottom sheet */
      '@media (max-width:640px){',
      '  #skill-modal{align-items:flex-end;padding:0;}',
      '  .skill-box{width:100%;max-height:92dvh;border-radius:22px 22px 0 0;animation:skillUp .2s var(--ease,ease-out);padding-bottom:env(safe-area-inset-bottom,0);}',
      '  .skill-head{padding:16px 16px 10px;} .skill-body{padding:4px 16px 12px;} .skill-foot{padding:10px 16px 14px;}',
      '  .skill-textarea{min-height:200px;}',
      '}',
      '@keyframes skillUp{from{transform:translateY(40px);opacity:.6}to{transform:none;opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.skill-box{animation:none!important}}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'paperly-skill-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ===== MODAL =====
  function buildModal() {
    if (ui.built) return;
    var m = document.createElement('div');
    m.id = 'skill-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'skill-title');
    m.innerHTML =
      '<div class="skill-box">' +
        '<div class="skill-head">' +
          '<span class="skill-head-ic" aria-hidden="true">' + ICON.spark + '</span>' +
          '<div class="skill-head-tx"><div class="skill-title" id="skill-title">Skills</div>' +
          '<div class="skill-sub" id="skill-sub">Tick one or more skills. Every ticked skill is applied to your AI requests.</div></div>' +
          '<button type="button" class="skill-x" id="skill-close" aria-label="Close">' + ICON.close + '</button>' +
        '</div>' +
        '<div class="skill-body" id="skill-body"></div>' +
        '<div class="skill-foot" id="skill-foot"></div>' +
      '</div>';
    document.body.appendChild(m);

    m.addEventListener('mousedown', function (e) { if (e.target === m) closeModal(); });
    el('skill-close').addEventListener('click', closeModal);
    m.addEventListener('click', onModalClick);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && m.classList.contains('open')) {
        e.preventDefault(); e.stopPropagation();
        if (ui.editingId) { ui.editingId = null; render(); } else closeModal();
      }
    }, true);
    ui.built = true;
  }

  function openModal() {
    injectCSS();
    buildModal();
    ui.editingId = null; ui.confirmDeleteId = null; ui.confirmReset = false;
    render();
    el('skill-modal').classList.add('open');
    setTimeout(function () { var f = el('skill-modal').querySelector('.skill-item, #skill-new'); if (f) f.focus(); }, 30);
  }
  function closeModal() {
    var m = el('skill-modal');
    if (m) m.classList.remove('open');
    ui.editingId = null;
    var ta = el('chat-input-textarea');
    if (ta && !(window.matchMedia && window.matchMedia('(pointer:coarse)').matches)) { try { ta.focus(); } catch (_) {} }
  }

  function render() {
    var body = el('skill-body'), foot = el('skill-foot'), sub = el('skill-sub');
    if (!body) return;
    if (ui.editingId) { renderForm(body, foot, sub); return; }
    sub.textContent = 'Tick one or more skills. Every ticked skill is applied to your AI requests.';

    var list = skills.length ? skills.map(function (s) {
      var on = selected.indexOf(s.id) !== -1;
      var confirming = ui.confirmDeleteId === s.id;
      return '<div class="skill-item' + (on ? ' on' : '') + '" role="checkbox" aria-checked="' + on + '" tabindex="0" data-act="toggle" data-id="' + esc(s.id) + '">' +
        '<span class="skill-check">' + ICON.check + '</span>' +
        '<div class="skill-main"><div class="skill-name">' + esc(s.name) + (s.builtin ? '<span class="skill-tag">Default</span>' : '') + '</div>' +
        '<div class="skill-prev">' + esc(s.prompt) + '</div></div>' +
        '<div class="skill-acts">' +
          '<button type="button" class="skill-ib" data-act="edit" data-id="' + esc(s.id) + '" aria-label="Edit ' + esc(s.name) + '" title="Edit">' + ICON.edit + '</button>' +
          '<button type="button" class="skill-ib danger' + (confirming ? ' confirm' : '') + '" data-act="delete" data-id="' + esc(s.id) + '" aria-label="Delete ' + esc(s.name) + '" title="Delete">' +
            ICON.trash + (confirming ? '<span>Delete?</span>' : '') + '</button>' +
        '</div></div>';
    }).join('') : '<div class="skill-empty">No skills yet.<br>Create one with “New skill”, or bring back the default with “Reset default”.</div>';

    body.innerHTML =
      '<div class="skill-toolbar">' +
        '<span class="skill-count">' + selected.length + ' selected · ' + skills.length + ' total</span>' +
        '<button type="button" class="skill-btn primary sm" id="skill-new" data-act="new">' + ICON.plus + 'New skill</button>' +
      '</div><div class="skill-list">' + list + '</div>';

    foot.innerHTML =
      '<button type="button" class="skill-btn' + (ui.confirmReset ? ' danger' : '') + '" data-act="reset">' + ICON.reset +
        (ui.confirmReset ? 'Tap again to confirm' : 'Reset default') + '</button>' +
      '<button type="button" class="skill-btn primary" data-act="done">Done</button>';
    foot.style.display = '';
  }

  function renderForm(body, foot, sub) {
    var isNew = ui.editingId === 'new';
    var s = isNew ? { name: '', prompt: '' } : (byId(ui.editingId) || { name: '', prompt: '' });
    sub.textContent = isNew ? 'Create a new skill.' : 'Edit skill.';
    body.innerHTML =
      '<div class="skill-form">' +
        '<div><div class="skill-label"><span>Skill name</span><small id="skill-name-n">0/' + MAX_NAME + '</small></div>' +
          '<input class="skill-input" id="skill-name" type="text" maxlength="' + MAX_NAME + '" placeholder="e.g. Exam-ready notes" autocomplete="off" value="' + esc(s.name) + '"></div>' +
        '<div><div class="skill-label"><span>Skill prompt</span><small id="skill-prompt-n">0</small></div>' +
          '<textarea class="skill-textarea" id="skill-prompt" maxlength="' + MAX_PROMPT + '" placeholder="Describe exactly how the AI should work and what the output should look like: structure, tone, language, canvas / page look, illustrations, figures, colors, a custom theme and how to build it…">' + esc(s.prompt) + '</textarea></div>' +
        '<div class="skill-hint">Write it like an instruction to the AI. A skill can control anything about the output: layout, canvas, illustrations, figures, charts, and even how a custom theme is built. If several skills are ticked, all of them are applied together.</div>' +
        '<div class="skill-err" id="skill-err" role="alert"></div>' +
      '</div>';
    foot.innerHTML =
      '<span></span><div class="skill-form-acts">' +
        '<button type="button" class="skill-btn" data-act="cancel">Cancel</button>' +
        '<button type="button" class="skill-btn primary" data-act="save">Save skill</button></div>';
    var n = el('skill-name'), p = el('skill-prompt');
    function counts() { el('skill-name-n').textContent = n.value.length + '/' + MAX_NAME; el('skill-prompt-n').textContent = p.value.length + ' chars'; }
    n.addEventListener('input', counts); p.addEventListener('input', counts); counts();
    setTimeout(function () { try { (isNew ? n : p).focus(); } catch (_) {} }, 30);
  }

  function onModalClick(e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (act === 'toggle') { toggleSelected(id); render(); return; }
    if (act === 'edit') { e.stopPropagation(); ui.editingId = id; render(); return; }
    if (act === 'new') { ui.editingId = 'new'; render(); return; }
    if (act === 'cancel') { ui.editingId = null; render(); return; }
    if (act === 'done') { closeModal(); return; }
    if (act === 'save') { saveForm(); return; }
    if (act === 'delete') {
      e.stopPropagation();
      if (ui.confirmDeleteId === id) {
        clearTimeout(ui.delTimer); ui.confirmDeleteId = null;
        skills = skills.filter(function (s) { return s.id !== id; });
        selected = selected.filter(function (x) { return x !== id; });
        save(); renderChips(); render();
      } else {
        ui.confirmDeleteId = id; render();
        clearTimeout(ui.delTimer);
        ui.delTimer = setTimeout(function () { ui.confirmDeleteId = null; if (!ui.editingId) render(); }, 3000);
      }
      return;
    }
    if (act === 'reset') {
      if (ui.confirmReset) {
        clearTimeout(ui.resetTimer); ui.confirmReset = false;
        resetDefault(); render();
      } else {
        ui.confirmReset = true; render();
        clearTimeout(ui.resetTimer);
        ui.resetTimer = setTimeout(function () { ui.confirmReset = false; if (!ui.editingId) render(); }, 3000);
      }
    }
  }
  // keyboard support on list rows
  document.addEventListener('keydown', function (e) {
    var m = el('skill-modal');
    if (!m || !m.classList.contains('open')) return;
    var row = e.target && e.target.classList && e.target.classList.contains('skill-item') ? e.target : null;
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSelected(row.getAttribute('data-id')); render(); var again = m.querySelector('.skill-item[data-id="' + row.getAttribute('data-id') + '"]'); if (again) again.focus(); }
  });

  function toggleSelected(id) {
    if (!byId(id)) return;
    var i = selected.indexOf(id);
    if (i === -1) selected.push(id); else selected.splice(i, 1);
    renderChips();
  }

  function saveForm() {
    var name = el('skill-name').value.trim().slice(0, MAX_NAME);
    var prompt = el('skill-prompt').value.trim();
    var err = el('skill-err');
    if (!name) { err.textContent = 'Please enter a skill name.'; el('skill-name').focus(); return; }
    if (!prompt) { err.textContent = 'Please write the skill prompt.'; el('skill-prompt').focus(); return; }
    if (ui.editingId === 'new') {
      var s = { id: newId(), name: name, prompt: prompt };
      skills.push(s);
      selected.push(s.id);               // a skill you just created is ready to use
    } else {
      var cur = byId(ui.editingId);
      if (cur) { cur.name = name; cur.prompt = prompt; }
    }
    save(); ui.editingId = null; renderChips(); render();
  }

  // Restore the default skill (re-adds it if deleted, restores its text if edited). Custom skills are untouched.
  function resetDefault() {
    var def = makeDefaults()[0];
    var cur = byId(DEFAULT_ID);
    if (cur) { cur.name = def.name; cur.prompt = def.prompt; cur.builtin = true; }
    else skills.unshift(def);
    save(); renderChips();
    toast('Default skill restored');
  }

  // ===== CHIPS (above the chat box) =====
  function ensureChipHost() {
    var host = el('skill-chips');
    if (host) return host;
    var anchor = el('at-command-chips');
    if (!anchor || !anchor.parentNode) return null;
    // Shared row that holds BOTH the running @ command chips and the skill chips.
    var row = el('chips-row');
    if (!row) {
      row = document.createElement('div');
      row.id = 'chips-row';
      anchor.parentNode.insertBefore(row, anchor);
      row.appendChild(anchor);                 // command chips first
    }
    host = document.createElement('div');
    host.id = 'skill-chips';
    row.appendChild(host);                      // skill chips right after, same row
    host.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.skill-chip-x') : null;
      if (!b) return;
      var id = b.getAttribute('data-id');
      selected = selected.filter(function (x) { return x !== id; });
      renderChips();
      if (el('skill-modal') && el('skill-modal').classList.contains('open') && !ui.editingId) render();
    });
    return host;
  }
  function renderChips() {
    var host = ensureChipHost();
    var list = getSelectedSkills();
    selected = list.map(function (s) { return s.id; });   // drop ids of deleted skills
    if (host) {
      host.innerHTML = list.map(function (s) {
        return '<span class="skill-chip" title="' + esc(s.name) + '">' + ICON.spark +
          '<span class="skill-chip-name">' + esc(s.name) + '</span>' +
          '<button type="button" class="skill-chip-x" data-id="' + esc(s.id) + '" aria-label="Remove skill ' + esc(s.name) + '">' + ICON.close.replace(/width="18" height="18"/, 'width="12" height="12"') + '</button></span>';
      }).join('');
    }
    var b = el('skill-slash-btn');
    if (b) b.classList.toggle('has-skills', list.length > 0);
  }

  // ===== "/" TRIGGER + BUTTON =====
  function installTrigger() {
    var ta = el('chat-input-textarea');
    if (ta && !ta.__skillBound) {
      ta.__skillBound = true;
      ta.addEventListener('input', function (e) {
        if (e.data !== '/') return;
        var pos = ta.selectionStart, before = ta.value.slice(0, pos);
        if (!/(^|\s)\/$/.test(before)) return;       // only a "/" at the start or after a space
        ta.value = before.slice(0, -1) + ta.value.slice(pos);
        try { ta.setSelectionRange(pos - 1, pos - 1); } catch (_) {}
        if (typeof window.autoResizeTextarea === 'function') window.autoResizeTextarea(ta);
        openModal();
      });
    }
    var at = el('at-command-btn');
    if (at && !el('skill-slash-btn')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.id = 'skill-slash-btn';
      b.className = 'icon-btn';
      b.title = 'Skills';
      b.setAttribute('aria-label', 'Skills');
      b.textContent = '/';
      b.addEventListener('click', openModal);
      at.parentNode.insertBefore(b, at.nextSibling);
    }
  }

  // ===== PROMPT INJECTION =====
  function buildSkillBlock(list) {
    list = list || getSelectedSkills();
    if (!list.length) return '';
    var parts = list.map(function (s, i) {
      return '--- SKILL ' + (i + 1) + ' of ' + list.length + ': ' + s.name + ' ---\n' + s.prompt.trim() + '\n--- END OF SKILL ' + (i + 1) + ' ---';
    }).join('\n\n');
    return '\n\n=== ACTIVE SKILLS (USER-DEFINED) — HIGHEST PRIORITY ===\n' +
      'The person activated ' + list.length + ' skill' + (list.length > 1 ? 's' : '') + ' for this work. A skill is the person\'s own operating instruction. ' +
      'It can define the content, structure, tone, language, layout, page / canvas look, illustrations, figures, charts, diagrams, colors, custom themes (including HOW a theme must be built) and the exact shape of the output.\n' +
      'RULES:\n' +
      '1. Follow every active skill literally and completely, from the first line to the last. Apply ALL active skills together; combine overlapping ones, and if two truly contradict, the later-numbered skill wins.\n' +
      '2. A skill overrides this app\'s default style, formatting, design and length rules wherever they differ. Do not soften, skip or "correct" what a skill asks for just because it differs from the defaults. The person\'s own message still decides the topic and task.\n' +
      '3. Keep the skill applied to the WHOLE output (every page, section, slide, figure) — never drift back to the default style later on.\n' +
      '4. Technical contract: still return the response in the exact format / JSON structure the other instructions require, so the app can parse and render it; put everything the skill asks for inside that structure. The app removes <style> and <script> tags and on* attributes from HTML, so build custom designs with inline style="" attributes, SVG and normal HTML elements.\n\n' +
      parts + '\n=== END OF ACTIVE SKILLS ===\n';
  }

  function appendToContent(content, extra) {
    if (Array.isArray(content)) {
      var copy = content.slice(), idx = -1;
      for (var i = copy.length - 1; i >= 0; i--) if (copy[i] && copy[i].type === 'text') { idx = i; break; }
      if (idx === -1) copy.push({ type: 'text', text: extra.trim() });
      else copy[idx] = Object.assign({}, copy[idx], { text: String(copy[idx].text || '') + extra });
      return copy;
    }
    return String(content == null ? '' : content) + extra;
  }

  function withSkills(messages) {
    var list = getSelectedSkills();
    if (!list.length || !Array.isArray(messages) || !messages.length) return messages;
    var block = buildSkillBlock(list);
    var names = list.map(function (s) { return s.name; }).join(', ');
    var out = messages.map(function (m) { return m; });
    var si = -1;
    for (var i = 0; i < out.length; i++) if (out[i] && out[i].role === 'system') { si = i; break; }
    if (si === -1) out.unshift({ role: 'system', content: block.trim() });
    else out[si] = Object.assign({}, out[si], { content: appendToContent(out[si].content, block) });
    for (var j = out.length - 1; j >= 0; j--) {
      if (out[j] && out[j].role === 'user') {
        out[j] = Object.assign({}, out[j], { content: appendToContent(out[j].content, '\n\n[Reminder: strictly apply the active skill(s) — ' + names + ' — over the default styling.]') });
        break;
      }
    }
    return out;
  }

  function installAIHook() {
    if (typeof window.callAIAPI !== 'function' || window.callAIAPI.__skillWrapped) return false;
    var orig = window.callAIAPI;
    var wrapped = function (messages, opts) {
      var o = opts || {};
      var msgs = o.fast ? messages : withSkills(messages);    // tiny clarify/decision gate calls stay untouched
      return orig.call(this, msgs, opts);
    };
    wrapped.__skillWrapped = true;
    window.callAIAPI = wrapped;
    return true;
  }

  // ===== "SKILLS" CARD IN THE @ MENU (next to Create / Copy / Copy & Refine) =====
  function buildMenuCard() {
    var n = getSelectedSkills().length;
    var card = document.createElement('div');
    card.className = 'at-intent-card skill-card' + (n ? ' selected' : '');
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', n ? 'true' : 'false');
    card.setAttribute('tabindex', '0');
    card.title = 'Skills — add your own instructions for the AI';
    var ic = document.createElement('span');
    ic.className = 'at-intent-icon';
    ic.innerHTML = ICON.spark.replace(/width="16" height="16"/, 'width="1em" height="1em"');
    var label = document.createElement('p');
    label.className = 'at-intent-label';
    label.textContent = 'Skills';
    card.appendChild(ic);
    card.appendChild(label);
    if (n) {
      var b = document.createElement('span');
      b.className = 'skill-card-count';
      b.textContent = String(n);
      card.appendChild(b);
    }
    function go() {
      if (typeof window.closeAtCommandMenu === 'function') window.closeAtCommandMenu();
      openModal();
    }
    card.addEventListener('click', go);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    return card;
  }

  function installMenuHook() {
    if (typeof window._buildAtIntentGrid !== 'function' || window._buildAtIntentGrid.__skillWrapped) return false;
    var orig = window._buildAtIntentGrid;
    var wrapped = function () {
      var grid = orig.apply(this, arguments);
      var q = '';
      try { q = String((typeof AT_MENU_STATE !== 'undefined' && AT_MENU_STATE.query) || '').toLowerCase().replace(/^@/, ''); } catch (_) {}
      if (q && 'skills'.indexOf(q) !== 0) return grid;       // typing "@xyz" filters the cards
      if (!grid) { grid = document.createElement('div'); grid.className = 'at-intent-grid'; }
      grid.appendChild(buildMenuCard());
      return grid;
    };
    wrapped.__skillWrapped = true;
    window._buildAtIntentGrid = wrapped;
    return true;
  }

  // ===== INIT =====
  function init() {
    injectCSS();
    load();
    installTrigger();
    renderChips();
    if (!installMenuHook()) console.warn('[Skill] @ menu not found — load skill.js after command-menu.js.');
    if (!installAIHook()) console.warn('[Skill] callAIAPI not found — load skill.js after app.js.');
  }

  window.PaperlySkills = {
    open: openModal,
    close: closeModal,
    list: function () { return skills.map(function (s) { return Object.assign({}, s); }); },
    selected: function () { return getSelectedSkills().map(function (s) { return Object.assign({}, s); }); },
    buildBlock: function () { return buildSkillBlock(); },
    resetDefault: function () { resetDefault(); if (ui.built) render(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
