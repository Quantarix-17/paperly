// ========================================================================
// UI ICONS
// ========================================================================

const UI_ICONS = Object.freeze({
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H11l-4.5 4v-4.6A2.5 2.5 0 0 1 4 12.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 8h8M8 11.5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h9l3 3V20H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14.5 3.5V7H18M8.5 10h7M8.5 13h7M8.5 16h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.8V20h3.2L18.7 8.5l-3.2-3.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m14.5 6.3 3.2 3.2M5 13.5l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  refine: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13.5 4.5 6 6M4 20l3.2-7.8L16.8 2.6l4.6 4.6-9.6 9.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 15l-3 3M4 8h4M16 17h4M12 4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  equation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 17h14M8 4l-3 3 3 3M16 14l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  diagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="15" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 6.5h3v11h0M6.5 9v6M13.5 17.5h-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  beautify: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.2 4.1L17 8.5l-3.8 1.4L12 14l-1.2-4.1L7 8.5l3.8-1.4zM18.2 14.2l.7 2.4 2.1.7-2.1.8-.7 2.4-.7-2.4-2.1-.8 2.1-.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  pagination: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 7h8M8 10.5h8M8 14h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M15.5 17.5h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  long: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h9l3 3V20H7z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15 3.5V7h4M10 11h6M10 14h6M10 17h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  short: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16H6z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 8h6M9 12h6M9 16h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h9l3 3V20H6z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14.5 3.5V7H18" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 11h6M9 14h6M9 17h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  language: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 12h17M12 3.5c2.1 2.2 3.2 5 3.2 8.5s-1.1 6.3-3.2 8.5c-2.1-2.2-3.2-5-3.2-8.5S9.9 5.7 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  canvas: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 16.5 11 13l2.3 2.3L17 11.5M7.5 8h.01M10 8h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 15.5 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 9v4.2l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 2.5h6M12 2.5v2.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  slides: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 20.5h8M12 17v3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6.5 14.5 10 10.2l2.4 2.6L17.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  background: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3.5" width="18" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8.3" cy="8.7" r="1.7" fill="currentColor"/><path d="M4 16.5l4.6-4.7a1.4 1.4 0 0 1 2 0l2.4 2.4M13 14.5l1.8-1.8a1.4 1.4 0 0 1 2 0L20.5 16.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  pencilSlide: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.8V20h3.2L18.7 8.5l-3.2-3.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m14.5 6.3 3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
});

// ========================================================================
// @ COMMANDS (exam and question types removed)
// ========================================================================

const AT_COMMANDS = [
  { id: 'create_pdf', label: 'Create PDF', icon: 'document', category: 'intent',
    description: 'Create, add to, or replace document content', autoParent: null },
  { id: 'create_slides', label: 'Create Slides', icon: 'slides', category: 'intent',
    description: 'Create a new slide deck/presentation (title + bullet points, downloadable as PowerPoint)', autoParent: null, requiresDocument: false },
  { id: 'add', label: 'Add', icon: 'long', category: 'intent',
    description: 'Add more notes, content, or pages according to the prompt', autoParent: null, requiresDocument: false },
  { id: 'edit', label: 'Edit', icon: 'edit', category: 'intent',
    description: 'Edit selected pages/sections of the current document', autoParent: null, requiresDocument: true },
  { id: 'refine', label: 'Refine', icon: 'refine', category: 'intent',
    description: 'Improve the requested content while preserving useful information', autoParent: null, requiresDocument: true },
  { id: 'refine_equation', label: 'Refine Equation', icon: 'equation', category: 'intent',
    description: 'Fix only equations, LaTeX/KaTeX and math rendering', autoParent: null, requiresDocument: true },
  { id: 'redesign_diagram', label: 'Redesign Diagram', icon: 'diagram', category: 'intent',
    description: 'Redesign/replace a chart, diagram, concept map, flowchart, or SVG illustration/artwork (tree, person, animal, nature scene, object, etc.)', autoParent: null, requiresDocument: true },
  { id: 'beautify', label: 'Beautify', icon: 'beautify', category: 'intent',
    description: 'Improve layout, typography and visual hierarchy only', autoParent: null, requiresDocument: true },
  { id: 'refine_pagination', label: 'Refine Pagination [N]', icon: 'pagination', category: 'intent',
    hasParam: true, insertText: '@refine_pagination:', paramPattern: /@refine_pagination:(\d+)\b/i,
    description: 'Fix only page-break/pagination of a specified page', autoParent: null, requiresDocument: true },
  { id: 'long_pdf', label: 'Long PDF', icon: 'long', category: 'length', modes: ['pdf'],
    description: 'Create a genuinely long, in-depth document — detailed explanations, derivations and worked math examples; length is decided by how much depth the topic supports, not a fixed page count. Use only with @Create PDF',
    autoParent: 'create_pdf', requiresParent: 'create_pdf' },
  { id: 'short_pdf', label: 'Short PDF', icon: 'short', category: 'length', modes: ['pdf'],
    description: 'Compact version with only essential concepts and examples; use only with @Create PDF',
    autoParent: 'create_pdf', requiresParent: 'create_pdf' },
  // Slide-deck counterparts of Long/Short PDF. A page-count concept like
  // "Long PDF" doesn't mean anything for a slide deck, so these replace
  // long_pdf/short_pdf whenever the header's creation-mode dropdown is set
  // to Slides (see getModeFilteredAtCommands() in command-menu.js, which
  // reads the `modes` field on every @ command).
  { id: 'long_slides', label: 'Detailed Deck', icon: 'long', category: 'length', modes: ['slides'],
    description: 'More slides with deeper sub-points, examples and supporting detail per topic — one idea per slide, nothing crammed in. Use only with @Create Slides',
    autoParent: 'create_pdf', requiresParent: 'create_pdf' },
  { id: 'short_slides', label: 'Compact Deck', icon: 'short', category: 'length', modes: ['slides'],
    description: 'A tight deck with fewer slides, each covering only the essential point — no filler slides. Use only with @Create Slides',
    autoParent: 'create_pdf', requiresParent: 'create_pdf' },
  { id: 'page', label: 'Page [N ...]', icon: 'page', category: 'target', hasParam: true,
    autoParent: null, insertText: '@page:', paramPattern: /@page\s*:?\s*(\d+(?:\s*[, ]\s*\d+)*)/i,
    description: 'Target one or more pages, e.g. @page 5 10 11; use with Edit/Refine' },
  { id: 'language', label: 'Language [X]', icon: 'language', category: 'language',
    hasParam: true, autoParent: null, insertText: '@language:', paramPattern: /@language:([a-zA-Z\u0980-\u09FF]+)\b/i,
    description: 'Choose the output language, e.g. @language:bangla' },
  { id: 'canvas', label: 'Canvas', icon: 'canvas', category: 'visual', autoParent: null,
    description: 'Force at least one visual into the response: a table/diagram/concept map/SVG illustration/chart is always added, not just when it happens to help' },
  { id: 'chat', label: 'Chat', icon: 'chat', category: 'intent',
    description: 'Plain conversation; does not edit the document' }
];

// ========================================================================
// AT COMMAND CATEGORIES
// ========================================================================

const AT_COMMAND_CATEGORIES = [
  { id: 'chat', label: 'Chat', icon: 'chat', description: 'Conversation' },
  { id: 'create_edit', label: 'Create & Edit', icon: 'document', description: 'Create, edit and refine documents' },
  { id: 'views', label: 'Views', icon: 'canvas', description: 'PDF, text and display options' }
];

const AT_COMMAND_PRIORITY = {
  chat: 0,
  create_pdf: 10,
  create_slides: 15,
  edit: 40
};

// ========================================================================
// PDF VISUAL & TEXT FORMATS
// ========================================================================

const PDF_VISUAL_FORMATS = ['default', 'aurora', 'editorial', 'midnight', 'blueprint', 'sage', 'minimal', 'rose', 'ocean', 'highcontrast'];
const PDF_TEXT_FORMATS = ['default', 'academic', 'modern', 'compact'];

// ========================================================================
// SANITIZATION
// ========================================================================

const SANITIZE_DISALLOWED_TAGS = ['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'STYLE', 'TITLE', 'HEAD', 'HTML', 'BODY'];

// ========================================================================
// EMOJI REGEX
// ========================================================================

const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/gu;

// ========================================================================
// VALID LATEX COMMANDS FOR AUTOWRAP
// ========================================================================

const VALID_AUTOWRAP_LATEX_COMMANDS = new Set([
  'frac', 'dfrac', 'tfrac', 'cfrac', 'sqrt', 'binom', 'left', 'right', 'text', 'mathrm', 'mathbf', 'mathit', 'mathbb',
  'operatorname', 'vec', 'overline', 'underline', 'bar', 'hat', 'tilde', 'dot', 'ddot', 'widetilde', 'widehat',
  'sum', 'prod', 'int', 'iint', 'iiint', 'oint', 'lim', 'log', 'ln', 'exp', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan', 'cdot', 'times', 'div', 'pm', 'mp', 'leq', 'geq', 'neq', 'approx', 'equiv', 'sim',
  'propto', 'infty', 'partial', 'nabla', 'forall', 'exists', 'in', 'notin', 'subset', 'subseteq', 'supset', 'supseteq',
  'cup', 'cap', 'setminus', 'emptyset', 'to', 'mapsto', 'implies', 'iff', 'rightarrow', 'leftarrow', 'leftrightarrow',
  'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'uparrow', 'downarrow', 'updownarrow', 'cdots', 'ldots', 'vdots', 'ddots',
  'dots', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi',
  'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
  'degree', 'circ', 'prime', 'quad', 'qquad', 'hspace', 'vspace', 'boxed', 'mathcal', 'mathscr', 'mathsf', 'mathtt',
  'pmb', 'cancel', 'overbrace', 'underbrace', 'overset', 'underset', 'substack', 'textbf', 'textit', 'begin', 'end',
  'cases', 'aligned', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix'
]);

// ========================================================================
// UTILITY FUNCTIONS
// ========================================================================

function getUIIcon(name, cls = '') {
  const svg = UI_ICONS[name] || UI_ICONS.document;
  return `<span class="ui-icon ${cls}" aria-hidden="true">${svg}</span>`;
}

function renderCommandIcon(name) {
  return UI_ICONS[name] || UI_ICONS.document;
}

function getAtCommandById(id) {
  return AT_COMMANDS.find(c => c.id === id) || null;
}

function getOrderedAtCommands(commands) {
  return [...commands].sort((a, b) =>
    (AT_COMMAND_PRIORITY[a.id] ?? 100) - (AT_COMMAND_PRIORITY[b.id] ?? 100)
  );
}

function getCommandsForCategory(category) {
  return AT_COMMANDS.filter(c => getCommandCategoryKey(c) === category);
}

function getCommandCategoryKey(cmd) {
  if (!cmd) return 'views';
  if (cmd.id === 'chat') return 'chat';
  if (['add', 'edit', 'refine', 'refine_equation', 'redesign_diagram', 'beautify', 'refine_pagination'].includes(cmd.id)) {
    return 'create_edit';
  }
  if (cmd.id === 'create_pdf' || cmd.id === 'create_slides' || cmd.category === 'length' || cmd.id === 'language' || cmd.id === 'canvas' || cmd.id === 'page') {
    return 'create_edit';
  }
  return 'views';
}

function isKnownLatexCommand(cmd) {
  return VALID_AUTOWRAP_LATEX_COMMANDS.has(String(cmd || ''));
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========================================================================
// SLIDE THEMES
// ========================================================================
// One theme object drives every slide surface: the live preview (via CSS
// variables set on each slide canvas), the PDF export, and the PPTX
// export. slide-studio.js reads these through getSlideTheme(); nothing in
// there hardcodes an accent colour, text colour or font any more.
//
// Colour fields are '#rrggbb'. fontLatin / fontBengali are the names used
// in the PPTX (PowerPoint needs a single installed face per run);
// fontStack / pdfFontStack are the CSS stacks for preview / PDF.

const DEFAULT_SLIDE_THEME_ID = 'classic';

function _slideThemeFrom(o) {
  const t = Object.assign({
    accent2: '#7aa2ff',
    text: '#1f2937',
    muted: '#64748b',
    onDarkText: '#f8fafc',
    onDarkBullet: '#f1f5f9',
    onDarkMuted: '#e2e8f0',
    tableStripe: '#f8fafc',
    fontLatin: 'Arial',
    fontBengali: 'Nirmala UI',
    fontStack: "'Segoe UI', 'Inter', 'Noto Sans Bengali', Arial, Helvetica, sans-serif",
    pdfFontStack: "Arial, 'Noto Sans Bengali', 'Nirmala UI', Helvetica, sans-serif"
  }, o);
  if (!t.mutedCss) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(t.muted);
    t.mutedCss = m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0.85)` : t.muted;
  }
  return Object.freeze(t);
}

const SLIDE_THEME_PRESETS = Object.freeze([
  _slideThemeFrom({ id: 'classic', label: 'Classic Blue', accent: '#4f7df3' }),
  _slideThemeFrom({ id: 'emerald', label: 'Emerald', accent: '#0f9b6c', accent2: '#5fd3a8',
    text: '#10261f', muted: '#4b6358', tableStripe: '#f3faf7' }),
  _slideThemeFrom({ id: 'sunset', label: 'Sunset', accent: '#e8590c', accent2: '#ffa94d',
    text: '#2b1a10', muted: '#7c5a45', tableStripe: '#fff8f2' }),
  _slideThemeFrom({ id: 'violet', label: 'Violet', accent: '#7c3aed', accent2: '#b197fc',
    text: '#1e1633', muted: '#6b5b8c', tableStripe: '#f8f5ff' }),
  _slideThemeFrom({ id: 'graphite', label: 'Graphite', accent: '#334155', accent2: '#94a3b8',
    text: '#111827', muted: '#64748b', tableStripe: '#f1f5f9',
    fontLatin: 'Calibri',
    fontStack: "'Calibri', 'Segoe UI', 'Noto Sans Bengali', Arial, sans-serif",
    pdfFontStack: "Calibri, Arial, 'Noto Sans Bengali', 'Nirmala UI', sans-serif" }),
  _slideThemeFrom({ id: 'editorial', label: 'Editorial Serif', accent: '#b4232a', accent2: '#e8868a',
    text: '#222222', muted: '#6b6b6b', tableStripe: '#faf6f3',
    fontLatin: 'Georgia', fontBengali: 'Nirmala UI',
    fontStack: "Georgia, 'Noto Serif Bengali', 'Nirmala UI', 'Times New Roman', serif",
    pdfFontStack: "Georgia, 'Noto Serif Bengali', 'Nirmala UI', 'Times New Roman', serif" })
]);

function getSlideThemeById(id) {
  return SLIDE_THEME_PRESETS.find(t => t.id === id) || null;
}