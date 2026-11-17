// ========================================================================
// PaperLy — Prompt "needs" detector + instruction splitter
// ------------------------------------------------------------------------
// Goal: do NOT send every rule block on every AI call. buildSharedRules() and
// the standing Instruction ask this file which modules the CURRENT call needs.
//
// Everything here is plain code (no AI call, no tokens spent).
//
// Safety rules:
//  * If a caller passes NO `needs`, behaviour is unchanged (everything is sent).
//  * When unsure, the detector leans toward INCLUDING a module.
//  * A tiny always-on safety line remains for math and figures, so a missed
//    detection still produces correctly delimited math / well-formed figures.
//
// Load this file BEFORE app.js (or any time before the first send).
// Debug: set window.PROMPT_DEBUG = true to log which modules were loaded and
// their estimated token size for every call.
// ========================================================================
(function () {
  'use strict';

  // ---------------------------------------------------------------- tokens
  // Same heuristic used for the measurements: ~3.6 chars/token for English/code,
  // ~1.2 chars/token for Bengali.
  function estimateTokens(str) {
    var s = String(str || '');
    var bn = (s.match(/[ঀ-৿]/g) || []).length;
    return Math.round((s.length - bn) / 3.6 + bn / 1.2);
  }

  // ---------------------------------------------------------------- signals
  var RX = {
    math: new RegExp([
      '\\b(?:equation|formula|formulae|solve|derive|derivation|proof|prove|theorem|lemma|calculus|algebra|trigonometry|geometry|integral|derivative|differentiat|integrat|limit|probability|statistic|variance|distribution|matrix|matrices|vector|logarithm|polynomial|quadratic|physics|chemistry|mechanics|thermodynamic|electric|magnetic|numerical|calculate|computation|mathematics|maths?|stoichiometry|kinematics|circuit|ohm|newton|voltage|velocity|acceleration|molar|mole|ph\\b)',
      '(?:সমীকরণ|সূত্র|সমাধান|প্রমাণ|গণিত|অংক|অঙ্ক|ক্যালকুলাস|বীজগণিত|জ্যামিতি|ত্রিকোণমিতি|সম্ভাব্যতা|পরিসংখ্যান|ম্যাট্রিক্স|ভেক্টর|পদার্থ|রসায়ন|বলবিদ্যা|গতি|বেগ|ত্বরণ|বিদ্যুৎ|ফাংশন|লগারিদম|ইন্টিগ্রাল|অন্তরীকরণ|সমাকলন|মোল)'
    ].join('|'), 'i'),
    visual: new RegExp([
      '\\b(?:chart|graph|plot|figure|diagram|draw|drawing|illustrat|picture|image|sketch|timeline|pie|bar chart|histogram|flowchart|mind ?map|concept map|schematic|visual|infographic|table of data)',
      '(?:ছবি|চিত্র|গ্রাফ|চার্ট|আঁক|আঁকো|ডায়াগ্রাম|ফ্লোচার্ট|মাইন্ডম্যাপ|রেখাচিত্র|পাইচার্ট|হিস্টোগ্রাম|ইনফোগ্রাফিক)'
    ].join('|'), 'i'),
    concept: /(?:concept ?map|mind ?map|relationship diagram|ধারণা ?মানচিত্র|মাইন্ডম্যাপ)/i,
    exam: /(?:\bexam\b|question paper|\bmcq\b|\bomr\b|model test|class test|\bquiz\b|পরীক্ষা|প্রশ্নপত্র|ওএমআর|বহুনির্বাচনি|সৃজনশীল)/i,
    refbook: /(?:\bbook\b|textbook|chapter|reference|author|\bpage \d|বই|অধ্যায়|গ্রন্থ|রেফারেন্স|লেখক)/i,
    grammar: /(?:grammar|\btense\b|\bvoice\b|narration|clause|preposition|article\b|parts of speech|ব্যাকরণ|গ্রামার|ট্রান্সফরমেশন)/i,
    fileMath: /(?:\$[^$\n]{1,80}\$|\\(?:frac|sum|int|sqrt|lim|begin)|[∫∑√≈≤≥∂π∞]|\b\d+\s*[+\-×÷*\/=^]\s*\d+)/g
  };

  function sampleFileText(fileText) {
    var t = String(fileText || '');
    if (t.length <= 24000) return t;
    // head + middle + tail is enough to see whether the file has math
    var mid = Math.floor(t.length / 2);
    return t.slice(0, 8000) + '\n' + t.slice(mid, mid + 8000) + '\n' + t.slice(-8000);
  }

  // ---------------------------------------------------------------- detector
  // ctx = {
  //   prompt, fileText, hasFiles,
  //   intent      : 'create_pdf' | 'add' | 'edit' | 'refine' | 'refine_equation' | 'redesign_diagram' | ...
  //   length      : 'long_pdf' | 'short_pdf' | 'standard' | null
  //   canvas      : true when the Canvas chip is on (illustrations allowed)
  //   extraDetail : true in Extra Detailed mode
  //   stage       : 'write' (default) | 'expand' | 'continue' | 'plan' | 'edit'
  //   json        : true when the model must answer with the JSON action wrapper
  // }
  function detectPromptNeeds(ctx) {
    ctx = ctx || {};
    var prompt = String(ctx.prompt || '');
    var intent = ctx.intent || 'create_pdf';
    var stage = ctx.stage || 'write';
    var hasFiles = !!ctx.hasFiles;
    var sample = hasFiles ? sampleFileText(ctx.fileText) : '';
    var haystack = prompt + '\n' + sample.slice(0, 6000);

    // ---- math
    var mathWords = RX.math.test(prompt);
    var fileMathHits = hasFiles ? (sample.match(RX.fileMath) || []).length : 0;
    var promptHasLatex = /\$|\\\(|\\\[|\\frac|\\int|\\sum/.test(prompt);
    var math = mathWords || promptHasLatex || fileMathHits >= 3 || intent === 'refine_equation';
    // very short topic-only prompts with no signal: stay safe for science-like topics
    // (handled by the always-on safety line, not by loading the full module).

    // ---- visuals
    var wantsVisual = RX.visual.test(prompt) || intent === 'redesign_diagram';
    var canvas = !!ctx.canvas;
    var visual = (wantsVisual || canvas) ? 'full' : 'lite';
    var concept = RX.concept.test(prompt);

    // ---- exam / reference / grammar
    var exam = RX.exam.test(prompt);
    var refbook = hasFiles ? RX.refbook.test(haystack) : /(?:book|chapter|reference|বই|অধ্যায়)/i.test(prompt);
    var grammar = RX.grammar.test(haystack);

    // ---- stage-specific trimming
    var isExpansion = stage === 'expand' || stage === 'continue';
    var isEditLike = stage === 'edit' || ['edit', 'refine', 'refine_equation', 'refine_pagination', 'beautify'].indexOf(intent) >= 0;

    var needs = {
      stage: stage,
      intent: intent,
      math: math,
      solution: math,                       // Given/Step/Final-answer structure only for math
      visual: isExpansion ? (wantsVisual || canvas ? 'full' : 'lite') : visual,
      charts: visual === 'full',
      illustrations: canvas,
      concept: concept,
      sources: hasFiles,                    // "source interpretation" rules only with attachments
      json: ctx.json !== false,             // JSON-action wrapper rules
      exam: exam,
      refbook: refbook,
      grammar: grammar,
      files: hasFiles,
      // standing-instruction "final quality control" only on the first write
      qc: stage === 'write' && !isEditLike,
      // length wording is replaced by the chip/extra-detail block, so the plain
      // "standard length" section is only needed when no chip is active
      lengthSection: !(ctx.length === 'long_pdf' || ctx.length === 'short_pdf' || ctx.extraDetail),
      extraDetail: !!ctx.extraDetail
    };

    if (isEditLike) {
      // edits touch existing pages: no title/numbering for a new document, no length rules
      needs.lengthSection = false;
    }
    if (intent === 'refine_equation') {
      needs.visual = 'none';
      needs.charts = false; needs.illustrations = false; needs.concept = false; needs.sources = false;
    }
    return needs;
  }

  // ---------------------------------------------------------------- always-on safety lines (tiny)
  // Used when a module is skipped so a wrong guess cannot break rendering.
  var SAFETY_MATH_LINE =
    'MATH SAFETY: if any mathematical expression appears, wrap it in delimiters — inline $...$ for short symbols inside a sentence, centered $$...$$ on its own line for standalone formulas — and write it as correct LaTeX with doubled backslashes in JSON. Never leave raw backslash commands outside delimiters.';
  var SAFETY_FIGURE_LINE =
    'FIGURE SAFETY: no diagrams, flowcharts, concept maps or schematics. Add a chart, table or figure only when the request needs it; wrap any figure as <figure class="figure-pro"><div class="figure-title">…</div><div class="figure-frame"><svg viewBox="0 0 W H">…</svg></div><figcaption class="figure-caption">…</figcaption></figure>, self-contained SVG, no overlapping labels, never a solid black box behind light text, and shapes that join must overlap by 8-20 units.';

  // ---------------------------------------------------------------- instruction splitter
  // The standing Instruction uses "### N. Title" headings. We split on them and
  // tag each part so only the needed ones are sent. Text without headings is
  // sent whole (custom text keeps working unchanged).
  function classifySection(title) {
    var t = String(title || '').toLowerCase();
    if (/final quality|quality control/.test(t)) return 'qc';
    if (/exam/.test(t)) return 'exam';
    if (/reference book/.test(t)) return 'refbook';
    if (/document.*length|\(pdf\) length|\blength\b/.test(t) && /(pdf|document)/.test(t)) return 'length';
    if (/mathematic|formula/.test(t)) return 'math';
    if (/uploaded file/.test(t)) return 'files';
    return 'core';
  }

  function parseInstructionSections(text) {
    var src = String(text || '').replace(/\r\n?/g, '\n');
    var re = /^###\s+(.+)$/gm;
    var marks = [], m;
    while ((m = re.exec(src))) marks.push({ idx: m.index, title: m[1] });
    if (!marks.length) return null;                       // no headings → send whole
    var parts = [];
    var head = src.slice(0, marks[0].idx).trim();
    if (head) parts.push({ kind: 'core', title: '', text: head });
    marks.forEach(function (mk, i) {
      var end = i + 1 < marks.length ? marks[i + 1].idx : src.length;
      var body = src.slice(mk.idx, end).trim();
      parts.push({ kind: classifySection(mk.title), title: mk.title, text: body });
    });
    return parts;
  }

  // Remove an inner "#### ..." sub-block whose title matches rx (keeps the rest).
  function dropSubBlock(text, rx) {
    var lines = String(text).split('\n'), out = [], skipping = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var h = /^####\s+(.+)$/.exec(ln);
      if (h) { skipping = rx.test(h[1]); }
      else if (/^###\s/.test(ln)) { skipping = false; }
      if (!skipping) out.push(ln);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Returns the instruction text to send for these needs. With no needs → full text.
  // isDefault = true when the person never edited the instruction: only then do we
  // dedupe sections that the shared rules repeat word for word.
  function selectInstructionText(text, needs, isDefault) {
    var full = String(text || '');
    if (!needs || !full.trim()) return full;
    var parts = parseInstructionSections(full);
    if (!parts) return full;

    var out = [];
    parts.forEach(function (p) {
      var keep = true;
      switch (p.kind) {
        case 'qc': keep = !!needs.qc; break;
        case 'exam': keep = !!needs.exam; break;
        case 'refbook': keep = !!needs.refbook; break;
        case 'files': keep = !!needs.files; break;
        case 'math': keep = !!needs.math; break;
        case 'length':
          // user-edited length rules must stay; the default text only repeats the shared rule
          keep = !!needs.lengthSection && !isDefault;
          break;
        default: keep = true;
      }
      if (!keep) return;
      var body = p.text;
      if (p.kind === 'core' || p.kind === 'math') {
        // the shared rules already carry the full math layout rule
        if (isDefault) body = dropSubBlock(body, /^math layout/i);
        if (!needs.grammar) body = dropSubBlock(body, /english grammar/i);
      }
      if (body) out.push(body);
    });
    return out.join('\n\n').trim();
  }

  // ---------------------------------------------------------------- debug
  function logModules(label, needs, blocks) {
    if (!window.PROMPT_DEBUG) return;
    try {
      var rows = Object.keys(blocks).map(function (k) { return [k, estimateTokens(blocks[k])]; });
      var total = rows.reduce(function (s, r) { return s + r[1]; }, 0);
      console.groupCollapsed('[prompt] ' + label + ' ≈ ' + total + ' tokens');
      console.log('needs:', needs);
      console.table(rows.map(function (r) { return { module: r[0], tokens: r[1] }; }));
      console.groupEnd();
    } catch (_) { /* debug only */ }
  }

  window.PromptNeeds = {
    detect: detectPromptNeeds,
    estimateTokens: estimateTokens,
    parseInstructionSections: parseInstructionSections,
    selectInstructionText: selectInstructionText,
    SAFETY_MATH_LINE: SAFETY_MATH_LINE,
    SAFETY_FIGURE_LINE: SAFETY_FIGURE_LINE,
    log: logModules
  };
  window.detectPromptNeeds = detectPromptNeeds;
})();
