// ========================================================================
// SLIDE STUDIO — @Create Slides / PowerPoint export (MVP)
// ========================================================================
// Self-contained module for the "Create Slides" feature, following the
// same pattern as diagram-library.js / chart-library.js: a focused file
// that owns one feature end-to-end and fails soft everywhere so a bad AI
// response or a missing library never breaks the rest of the app.
//
// Pipeline:
//   0. OUTLINE-FIRST: generateSlideDeckDirectMode() first has the AI plan an
//      OUTLINE (titles + key points + layout per slide), shows it in chat,
//      applies the user's change requests, and only builds the deck once
//      the user approves (see the OUTLINE-FIRST FLOW block below).
//   1. The approved outline is then turned into a SLIDE-SHAPED JSON
//      response (title + bullets + optional visual per slide); long decks
//      are written in batches.
//   2. sanitizeSlideDeckJSON() caps/cleans whatever the AI returned so a
//      malformed response degrades gracefully instead of crashing.
//   3. Each slide's "visual" field may be a <!--CHART:...-->,
//      <!--ILLUSTRATION:scene_id:params-->, <!--ELEMENT:element_id:params-->
//      or <!--IMAGE_PLACEHOLDER:shape:description--> placeholder (resolved
//      via the existing chart-library.js / illustration-library.js /
//      element-library.js, or the local renderImagePlaceholderSVG() below)
//      or a hand-drawn <svg>. Diagrams are permanently disabled — see the
//      IMAGE PLACEHOLDER note below, which replaces the old
//      <!--DIAGRAM_TEMPLATE:id--> mechanism entirely.
//
// IMAGE PLACEHOLDER — REPLACES DIAGRAMS (product decision: diagrams are
// never generated anywhere in this app anymore). Whenever a slide's point
// would normally call for a diagram (an anatomical/technical/schematic
// figure), the AI instead emits <!--IMAGE_PLACEHOLDER:box:description-->
// or <!--IMAGE_PLACEHOLDER:circle:description-->, a box- or circle-shaped
// placeholder frame with the detailed description of the needed image
// rendered as text inside it, so a real image can be dropped in later.
//   4. renderSlideDeckPreview() shows the deck in a lightweight
//      PowerPoint-style thumbnail-rail + main-canvas view.
//   5. exportSlideDeckToPptx() rasterizes each slide's SVG to a PNG (via
//      canvas) and uses PptxGenJS to build and download a real .pptx.
//
// AUTO BACKGROUND — 3 MODES (see SLIDE_AUTO_BG_MODES):
//   - "off"    — plain white canvas (default)
//   - "single" — one AI-designed background applied to every slide
//   - "varied" — AI designs a 3-5-entry SET of visually different
//                backgrounds (solid / gradient / layered-pattern / dark
//                accent) and each slide is assigned one (a section or
//                title slide typically gets the boldest/darkest one,
//                content slides rotate through the lighter ones). This
//                is what produces a deck that isn't one flat color
//                repeated 20 times.
//
// ELEMENT-LIBRARY DROP-INS (HYBRID): every slide may carry an `elements`
// array of small icons placed at any x/y/size/rotate, in one of two
// layers — "behind" or "front". Each entry is EITHER a reference to a
// pre-made element-library.js piece (by id, with optional color overrides)
// OR a custom hand-drawn SVG the AI supplies inline (for topics the
// library doesn't cover).
// ========================================================================

// Source resolution used to rasterize a slide's SVG visual to PNG for
// PowerPoint export. Kept well above the largest on-slide display size
// so exported visuals stay crisp.
const PPTX_VISUAL_RASTER_W = 1800;
const PPTX_VISUAL_RASTER_H = 1000;

// Runaway-guards, not design caps.
const SLIDE_DECK_MAX_SLIDES = 80;
const SLIDE_DECK_MAX_BULLETS_PER_SLIDE = 24;
const SLIDE_DECK_MAX_BULLET_CHARS = 600;
const SLIDE_DECK_MAX_TITLE_CHARS = 200;

// ========================================================================
// SLIDE LAYOUTS
// ========================================================================
const SLIDE_LAYOUTS = ['title', 'content', 'section', 'two_column', 'three_column', 'big_stat', 'quote', 'timeline',
  'visual_focus', 'visual_left', 'cards', 'stats', 'table', 'agenda', 'icon_row', 'comparison', 'faq', 'profiles', 'free'];
const SLIDE_VISUAL_LAYOUTS = ['content', 'visual_left', 'visual_focus'];
const SLIDE_BULLET_LAYOUTS = ['content', 'visual_left', 'big_stat'];
const SLIDE_LAYOUT_MAX_COLUMNS = 2;
const SLIDE_LAYOUT_MAX_COLUMN_BULLETS = 12;
const SLIDE_LAYOUT_MAX_COLUMN_HEADING_CHARS = 80;
const SLIDE_LAYOUT_MAX_STAT_VALUE_CHARS = 40;
const SLIDE_LAYOUT_MAX_STAT_LABEL_CHARS = 200;
const SLIDE_LAYOUT_MAX_QUOTE_CHARS = 600;
const SLIDE_LAYOUT_MAX_QUOTE_AUTHOR_CHARS = 120;
const SLIDE_LAYOUT_MIN_STEPS = 2;
const SLIDE_LAYOUT_MAX_STEPS = 8;
const SLIDE_LAYOUT_MAX_STEP_LABEL_CHARS = 60;
const SLIDE_LAYOUT_MAX_STEP_TEXT_CHARS = 240;
const SLIDE_LAYOUT_MAX_SUBTITLE_CHARS = 280;
const SLIDE_LAYOUT_MIN_CARDS = 2;
const SLIDE_LAYOUT_MAX_CARDS = 8;
const SLIDE_LAYOUT_MAX_CARD_HEADING_CHARS = 80;
const SLIDE_LAYOUT_MAX_CARD_TEXT_CHARS = 280;
const SLIDE_LAYOUT_MIN_STATS = 2;
const SLIDE_LAYOUT_MAX_STATS = 6;
const SLIDE_LAYOUT_MAX_STATS_LABEL_CHARS = 160;
const SLIDE_LAYOUT_MIN_TABLE_COLS = 2;
const SLIDE_LAYOUT_MAX_TABLE_COLS = 8;
const SLIDE_LAYOUT_MAX_TABLE_ROWS = 20;
const SLIDE_LAYOUT_MAX_TABLE_CELL_CHARS = 120;
const SLIDE_LAYOUT_MIN_AGENDA_ITEMS = 2;
const SLIDE_LAYOUT_MAX_AGENDA_ITEMS = 12;
const SLIDE_LAYOUT_MAX_AGENDA_ITEM_CHARS = 160;
const SLIDE_LAYOUT_MAX_CAPTION_CHARS = 300;
const SLIDE_MAX_BACKGROUNDS = 6;
const SLIDE_LAYOUT_MIN_COMPARISON_ITEMS = 1;
const SLIDE_LAYOUT_MAX_COMPARISON_ITEMS = 6;
const SLIDE_LAYOUT_MAX_COMPARISON_HEADING_CHARS = 60;
const SLIDE_LAYOUT_MAX_COMPARISON_ITEM_CHARS = 140;
const SLIDE_LAYOUT_MIN_FAQ_ITEMS = 2;
const SLIDE_LAYOUT_MAX_FAQ_ITEMS = 6;
const SLIDE_LAYOUT_MAX_FAQ_QUESTION_CHARS = 140;
const SLIDE_LAYOUT_MAX_FAQ_ANSWER_CHARS = 320;
const SLIDE_LAYOUT_MIN_PROFILES = 2;
const SLIDE_LAYOUT_MAX_PROFILES = 6;
const SLIDE_LAYOUT_MAX_PROFILE_NAME_CHARS = 60;
const SLIDE_LAYOUT_MAX_PROFILE_ROLE_CHARS = 80;
const SLIDE_LAYOUT_MAX_PROFILE_BIO_CHARS = 200;

const PPTX_VISUAL_RASTER_LONG_EDGE = 1800;

function getSlideLayoutCatalogForPrompt() {
  return [
    'title — deck-opening title slide: "title" only (the deck/topic name), no bullets/visual/extra fields. Use ONLY for the very first slide.',
    'content — "title" + "bullets" (left) + optional "visual" (right). Use when a plain list of points (optionally with one visual) is genuinely the best way to say it.',
    'section — a short mid-deck divider slide: "title" (the new section name) + optional "subtitle" (one short line). No bullets/visual.',
    'two_column — side-by-side comparison/contrast: "title" + "columns": [{"heading":"...","bullets":["...",...]}, {"heading":"...","bullets":["...",...]}] — EXACTLY 2 columns.',
    'three_column — same as two_column but with EXACTLY 3 columns.',
    'big_stat — one big highlighted number/metric: "title" (optional short context line) + "stat": {"value":"87%","label":"..."} + optional short "bullets".',
    'quote — a single highlighted quotation or key statement, no title: "quote": {"text":"...","author":"..."}.',
    'timeline — a short sequence/process/steps flow: "title" + "steps": [{"label":"...","text":"..."}, ...] — 2 to 8 steps.',
    'visual_focus — the slide IS one large visual: "title" + "visual" (REQUIRED) + optional "caption".',
    'visual_left — like "content" but the visual sits on the LEFT: "title" + "visual" (REQUIRED) + "bullets".',
    'cards — parallel points/features as short cards: "title" + "cards": [{"heading":"short","text":"..."}, ...] — 2 to 8 cards (4 or fewer look best).',
    'stats — several key numbers side by side: "title" + "stats": [{"value":"87%","label":"..."}, ...] — 2 to 6 items.',
    'table — a small comparison / spec / data table: "title" + "table": {"headers":["A","B"],"rows":[["..",".."], ...]} — 2 to 8 columns, up to 20 rows.',
    'agenda — a numbered overview / ordered list of parts: "title" + "agenda": ["item 1","item 2",...] — 2 to 12 short items.',
    'icon_row — a row of 2 to 6 icons, each with a short label/description: "title" + "icons": [{"id":"sun","label":"short","text":"one short line","color":"#f5a623"}, ...] or [{"svg":"<svg viewBox=\\"0 0 100 100\\">...</svg>","label":"..."}, ...]. Use when several small CONCEPTS (not numbers) sit side by side.',
    'comparison — a two-sided comparison (pros/cons, before/after, us-vs-them, do/don\'t): "title" + "left": {"heading":"Pros","items":["...",...]} + "right": {"heading":"Cons","items":["...",...]} — 1 to 6 items per side. Use instead of two_column specifically when the two sides are FOR/AGAINST or POSITIVE/NEGATIVE, since this layout renders with matching plus/minus styling.',
    'faq — a short list of question-and-answer pairs: "title" + "items": [{"question":"...","answer":"..."}, ...] — 2 to 6 pairs.',
    'profiles — a grid of people (team, speakers, testimonials, panelists): "title" + "profiles": [{"name":"...","role":"...","bio":"..."}, ...] — 2 to 6 profiles. Each gets an initials avatar automatically; do not supply a photo.',
    'free — the composition layout. Use this for ANY slide that would feel cramped in a single fixed layout: a big number PLUS a quote PLUS supporting bullets all on one slide; a 2x2 grid of related concepts; a visual with a heading above and notes below; a "hero" moment mixing text and image. If a slide feels like it needs more than one thing at once, switch to "free". REQUIRED KEY: "title" + "blocks": [...] — "blocks" is the exact, mandatory top-level array key for this layout (same as "columns" on two_column or "steps" on timeline); do NOT name it "content", "items", "elements" or anything else, and do NOT omit it — a "free" slide with no "blocks" array is invalid and will be discarded. "blocks" is a vertical stack of typed blocks; each entry is one of: {"type":"heading","text":...,"align":"left|center|right","color":"#rrggbb","size":"xs|sm|md|lg|xl|xxl","weight":"normal|bold","italic":true} | {"type":"text","text":...} | {"type":"bullets","items":[...]} | {"type":"quote","text":...,"author":...} | {"type":"stat","value":...,"label":...} | {"type":"visual","visual":"<a CHART/ILLUSTRATION/ELEMENT/IMAGE_PLACEHOLDER placeholder or raw <svg>>","caption":...} | {"type":"element","id":"sun",...} (or {"type":"element","svg":"<svg viewBox=\\"0 0 100 100\\">...</svg>",...}) | {"type":"table","headers":[...],"rows":[[...],...]} | {"type":"spacer","size":"sm|md|lg"} | {"type":"divider"} | {"type":"row","blocks":[<other blocks>]} | {"type":"grid","cols":2,"blocks":[<other blocks>]} (nested "row"/"grid" children reuse this SAME "blocks" key). On a "free" slide you can still set "title" (used as the thumbnail label). MINIMAL EXAMPLE: {"layout":"free","title":"Impact","blocks":[{"type":"stat","value":"87%","label":"faster onboarding"},{"type":"bullets","items":["Point one","Point two"]}]}.'
  ].join('\n      ');
}

// ===== STATE =====
let _slideDeckCurrentIndex = 0;
let _slideBackgroundPickerOpen = false;
let _customBgScopeAll = false;

// ========================================================================
// SLIDE BACKGROUNDS — 20 FIXED, PRE-DESIGNED PRESETS
// ========================================================================
const SLIDE_BACKGROUNDS = [
  { id: 'sunrise', label: 'Sunrise Blush', css: 'linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%)', pptx: 'FCB69F', dark: false },
  { id: 'ocean-depth', label: 'Ocean Depth', css: 'linear-gradient(135deg,#2b5876 0%,#4e4376 100%)', pptx: '2B5876', dark: true },
  { id: 'aurora-mint', label: 'Aurora Mint', css: 'linear-gradient(135deg,#d4fc79 0%,#96e6a1 100%)', pptx: '96E6A1', dark: false },
  { id: 'midnight-navy', label: 'Midnight Navy', css: 'linear-gradient(135deg,#0f2027 0%,#203a43 55%,#2c5364 100%)', pptx: '0F2027', dark: true },
  { id: 'rose-gold', label: 'Rose Gold', css: 'linear-gradient(135deg,#f7cac9 0%,#f4a9a8 100%)', pptx: 'F4A9A8', dark: false },
  { id: 'slate-pro', label: 'Slate Professional', css: 'linear-gradient(135deg,#e2e8f0 0%,#cbd5e1 100%)', pptx: 'CBD5E1', dark: false },
  { id: 'royal-purple', label: 'Royal Purple', css: 'linear-gradient(135deg,#41295a 0%,#2f0743 100%)', pptx: '2F0743', dark: true },
  { id: 'sunset-orange', label: 'Sunset Orange', css: 'linear-gradient(135deg,#ff9a56 0%,#ff6666 100%)', pptx: 'FF7A56', dark: false },
  { id: 'emerald-corp', label: 'Emerald Corporate', css: 'linear-gradient(135deg,#0f9b6c 0%,#0c6b58 100%)', pptx: '0F9B6C', dark: true },
  { id: 'sky-fresh', label: 'Sky Fresh', css: 'linear-gradient(135deg,#89f7fe 0%,#66a6ff 100%)', pptx: '66A6FF', dark: false },
  { id: 'charcoal-editorial', label: 'Charcoal Editorial', css: 'linear-gradient(135deg,#232526 0%,#414345 100%)', pptx: '232526', dark: true },
  { id: 'peach-cream', label: 'Peach Cream', css: 'linear-gradient(135deg,#fddb92 0%,#d1fdff 100%)', pptx: 'FDDB92', dark: false },
  { id: 'berry-punch', label: 'Berry Punch', css: 'linear-gradient(135deg,#ff5f6d 0%,#ffc371 100%)', pptx: 'FF5F6D', dark: false },
  { id: 'deep-teal', label: 'Deep Teal', css: 'linear-gradient(135deg,#134e5e 0%,#71b280 100%)', pptx: '134E5E', dark: true },
  { id: 'lavender-fields', label: 'Lavender Fields', css: 'linear-gradient(135deg,#c471f5 0%,#fa71cd 100%)', pptx: 'C471F5', dark: false },
  { id: 'golden-hour', label: 'Golden Hour', css: 'linear-gradient(135deg,#f6d365 0%,#fda085 100%)', pptx: 'F6D365', dark: false },
  { id: 'graphite-blue', label: 'Graphite Blue', css: 'linear-gradient(135deg,#3a6073 0%,#16222a 100%)', pptx: '16222A', dark: true },
  { id: 'cotton-candy', label: 'Cotton Candy', css: 'linear-gradient(135deg,#fbc2eb 0%,#a6c1ee 100%)', pptx: 'A6C1EE', dark: false },
  { id: 'forest-corp', label: 'Forest Corporate', css: 'linear-gradient(135deg,#0b3d2e 0%,#11998e 100%)', pptx: '0B3D2E', dark: true },
  { id: 'crimson-bold', label: 'Crimson Bold', css: 'linear-gradient(135deg,#0f0c29 0%,#302b63 55%,#24243e 100%)', pptx: '24243E', dark: true }
];

function getSlideBackgroundById(id) {
  if (!id) return null;
  return SLIDE_BACKGROUNDS.find(b => b.id === id) || null;
}

function getSlideBackgroundCatalogForPrompt() {
  return SLIDE_BACKGROUNDS.map(b => `${b.id} (${b.label}, ${b.dark ? 'dark' : 'light'})`).join(', ');
}

// Resolves a slide's EFFECTIVE background to the shared {css,pptx,dark}
// shape, whichever of the three sources it came from:
//   1. slide.customBg (set by ✨ Custom Background, or Single-mode Auto BG)
//   2. slide.bg = <preset id> (set by the manual Background picker)
//   3. slide.bgIndex into the deck-level `backgrounds` array (set by
//      Varied-mode Auto BG)
// Falls back to APP_STATE.slideDeck so existing call sites that pass only
// the slide keep working.
function _resolveSlideBackground(slide, deck) {
  if (!slide) return null;
  if (slide.bg === 'custom' && slide.customBg) return slide.customBg;
  if (slide.bg) return getSlideBackgroundById(slide.bg);
  const d = deck || (typeof APP_STATE !== 'undefined' ? APP_STATE.slideDeck : null);
  if (d && Array.isArray(d.backgrounds) && d.backgrounds.length && Number.isInteger(slide.bgIndex) && slide.bgIndex >= 0) {
    return d.backgrounds[slide.bgIndex % d.backgrounds.length] || null;
  }
  // Lowest priority: the deck THEME's own background (hero for title/section/quote, content otherwise).
  return (typeof slideThemeBackgroundFor === 'function') ? slideThemeBackgroundFor(slide, d) : null;
}

// ========================================================================
// AUTO BACKGROUND — 3 modes: off | single | varied
// ========================================================================
// - "off"    — plain white canvas
// - "single" — AI designs ONE background applied to every slide
// - "varied" — AI designs a 3-5 entry SET of visually-different
//              backgrounds and each slide picks one. Section / title /
//              quote slides usually take the boldest (often dark) entry;
//              content slides rotate through the lighter ones. This is
//              what produces a deck where different slides actually look
//              different, instead of the same gradient repeated N times.
const SLIDE_AUTO_BG_STORAGE_KEY = 'aipdf_slide_auto_background_mode';
const SLIDE_AUTO_BG_LEGACY_KEY = 'aipdf_slide_auto_background_enabled';
const SLIDE_AUTO_BG_MODES = ['off', 'single', 'varied'];
const SLIDE_AUTO_BG_MODE_LABELS = { off: 'Off', single: 'Single', varied: 'Varied' };

function getSlideAutoBackgroundMode() {
  try {
    const m = localStorage.getItem(SLIDE_AUTO_BG_STORAGE_KEY);
    if (SLIDE_AUTO_BG_MODES.indexOf(m) !== -1) return m;
    // Legacy boolean key → migrate to new mode
    const legacy = localStorage.getItem(SLIDE_AUTO_BG_LEGACY_KEY);
    if (legacy === '1') {
      try { localStorage.setItem(SLIDE_AUTO_BG_STORAGE_KEY, 'single'); } catch (_) {}
      return 'single';
    }
    return 'off';
  } catch (_) { return 'off'; }
}

function setSlideAutoBackgroundMode(mode) {
  const m = SLIDE_AUTO_BG_MODES.indexOf(mode) !== -1 ? mode : 'off';
  try { localStorage.setItem(SLIDE_AUTO_BG_STORAGE_KEY, m); } catch (_) {}
  return m;
}

function getSlideAutoBackgroundEnabled() {
  // Backward-compat helper for any old callers still asking the boolean
  // question ("is auto bg on at all?").
  return getSlideAutoBackgroundMode() !== 'off';
}

function _updateAutoBgButtonLabel() {
  const btn = document.getElementById('slide-auto-bg-toggle-btn');
  if (!btn) return;
  const mode = getSlideAutoBackgroundMode();
  const label = SLIDE_AUTO_BG_MODE_LABELS[mode] || 'Off';
  btn.classList.toggle('active', mode !== 'off');
  btn.setAttribute('aria-pressed', mode !== 'off' ? 'true' : 'false');
  btn.innerHTML = `${typeof getUIIcon === 'function' ? getUIIcon('background') : '🎨'} Auto BG: ${label}`;
}

function cycleSlideAutoBackgroundMode() {
  const cur = getSlideAutoBackgroundMode();
  const idx = SLIDE_AUTO_BG_MODES.indexOf(cur);
  const next = SLIDE_AUTO_BG_MODES[(idx + 1) % SLIDE_AUTO_BG_MODES.length];
  setSlideAutoBackgroundMode(next);
  _updateAutoBgButtonLabel();
  if (typeof displayToastNotification === 'function') {
    const msgs = {
      off: '🎨 Auto Background: OFF — new decks get a plain white canvas.',
      single: '🎨 Auto Background: SINGLE — the next generated deck gets ONE AI background applied to every slide.',
      varied: '🎨 Auto Background: VARIED — the next generated deck gets a SET of 3-5 different AI backgrounds, assigned per slide for real visual variety.'
    };
    displayToastNotification(msgs[next]);
  }
}

// Legacy alias — the old toggle handler name is still referenced by any
// cached version of the toolbar HTML, so keep it functional: a click on
// the old button now cycles the mode instead of just toggling on/off.
function toggleSlideAutoBackground() { cycleSlideAutoBackgroundMode(); }

// ===== PROMPT: SCHEMA + RULES =====
function _slideDeckLengthRule(lengthHint) {
  if (lengthHint === 'long_slides') {
    return `- LENGTH: DETAILED DECK — the user explicitly asked for a detailed deck. Use MORE slides than a default deck and give each sub-idea its own slide instead of merging them. The exact count is your call — typically 20-40 for a genuinely detailed topic.\n`;
  }
  if (lengthHint === 'short_slides') {
    return `- LENGTH: COMPACT DECK — the user explicitly asked for a compact deck. Cover only the essential points, one per slide, and cut anything that isn't necessary. The exact count is your call — typically 3-6 for a simple topic.\n`;
  }
  return `- SLIDE COUNT is your call — as many or as few as the topic genuinely needs (typically somewhere between 3 and 25; go higher only if the material really is that big). One idea per slide.\n`;
}

// ========================================================================
// CONTENT CATEGORY — subject-aware pairing of DEPTH + LAYOUT MIX + MOOD
// ========================================================================
// The single biggest complaint about auto-generated decks is that a class
// note on thermodynamics, a startup pitch, and a quarterly ops report all
// come out looking/reading like the exact same "generic slide deck". This
// block makes the model classify the request's SUBJECT first, then locks
// in a different recipe (how much to explain, which layouts to reach for,
// which background mood/palette fits) for each category, instead of one
// flat set of instructions applied to every topic alike.
const SLIDE_CONTENT_CATEGORIES = [
  {
    id: 'academic',
    match: 'a school/college/university subject, a textbook chapter, exam/revision prep, a lecture or class-note topic, a syllabus item, homework help',
    content:
      'Write like a genuinely educational, detailed CLASS NOTE — not a marketing pitch. Give real definitions, key terms, short worked examples, classifications/formulas where the subject has them, and a recap/exam-tip feel where useful. Bullets may be a little more explanatory than a business deck\'s punchy fragments (still not full paragraphs). Let each slide\'s form follow the shape of that specific material (a term-by-term comparison, a process in sequence, a key definition worth isolating, a likely exam question, a real quantifiable fact) — never force a layout the material doesn\'t have, and never invent a statistic to fill one.',
    mood:
      'Calm, legible, notebook/paper-like: soft off-white, cream, muted pastel, or gentle blue/green tones. Avoid loud saturated business colors and avoid a sterile pure-white corporate look. Palette family to lean toward: sunrise-blush / peach-cream / aurora-mint / sky-fresh / cotton-candy (light, warm-neutral, low-saturation). For the bold/dark entry used on title or section dividers, keep it muted and studious (deep-teal, midnight-navy) rather than flashy neon/magenta.'
  },
  {
    id: 'business',
    match: 'a pitch deck, investor update, product launch, marketing or sales plan, startup/growth topic, brand or campaign proposal',
    content:
      'Write punchy, benefit-led, headline-first bullets. Where the material is genuinely numbers-forward or comparative, let those slides carry the weight with number-, comparison- or card-style layouts; show roadmap steps as a sequence only if the request really has one. End the deck on its strongest note (a big stat, a call-to-action, or a sharp quote) rather than a generic recap slide.',
    mood:
      'Confident and modern: bold gradients, saturated brand-like colors, at least one strong dark "hero" background reserved for the title/section slides. Palette family to lean toward: royal-purple / emerald-corp / sunset-orange / berry-punch / crimson-bold — vivid, energetic, premium.'
  },
  {
    id: 'office',
    match: 'an internal status update, quarterly/annual report, SOP or policy briefing, project update, meeting deck, operations or admin topic',
    content:
      'Write precise, restrained, fact-first bullets. Pick whichever structured layout fits each point (a table for records, a sequence for schedules, and so on); keep decorative "elements" minimal (0-2 per slide, subtle); every number must be real/quantifiable from the request or attached source — never fabricate a statistic just to fill big_stat/stats.',
    mood:
      'Neutral and professional, low-decoration: slate/graphite/charcoal tones with subtle gradients, never playful or pastel. Palette family to lean toward: slate-pro / graphite-blue / charcoal-editorial / midnight-navy — muted, formal, low-saturation.'
  },
  {
    id: 'general',
    match: 'anything else — travel, hobbies, personal stories, events, portfolios, casual or creative topics that don\'t fit the three categories above',
    content: 'Use your normal best judgment for depth and layout mix — no forced category conventions.',
    mood: 'Free to be as expressive or colorful as genuinely fits the specific topic; no palette restriction.'
  }
];

// Fixed, deterministic display labels for the 4 content categories — used
// ONLY for the "which category of deck do you want?" checkbox clarify UI
// (see buildSlideDeckClarifyDecisionPrompt / generateSlideDeckDirectMode
// below and appendCategoryClarifyMessageToUI in app.js). These are NEVER
// written by the AI — the app always shows exactly these 4 fixed choices
// (plus a "type my own" option) so the user picks from a stable, known set
// instead of AI-invented option text that could vary between requests.
const SLIDE_CATEGORY_DISPLAY_LABELS = {
  academic: { en: 'Academic / Class Notes', bn: 'একাডেমিক / ক্লাস নোট' },
  business: { en: 'Business / Pitch Deck', bn: 'বিজনেস / পিচ ডেক' },
  office: { en: 'Office / Report', bn: 'অফিস / রিপোর্ট' },
  general: { en: 'General / Other', bn: 'সাধারণ / অন্যান্য' }
};

function _slideContentCategoryRules() {
  const lines = SLIDE_CONTENT_CATEGORIES.map((c, i) =>
    `    ${i + 1}) ${c.id.toUpperCase()} — subject looks like: ${c.match}.\n` +
    `       CONTENT: ${c.content}\n` +
    `       BACKGROUND MOOD: ${c.mood}`
  ).join('\n');
  return (
    `CONTENT CATEGORY — CLASSIFY FIRST, THEN APPLY CONSISTENTLY:\n` +
    `Before writing slide 1, decide which ONE category the user's SUBJECT (not their phrasing) most belongs to, then apply that category's content depth, layout mix AND background mood to the WHOLE deck — do not mix conventions from two categories in a way that makes the deck feel inconsistent (e.g. do not write pitch-deck-style punchy fragments for a physics class note, and do not write a textbook-style definition dump for a sales pitch). If the user explicitly names a different intended use (e.g. "make this a pitch deck" on an academic subject, or "make class notes" on a business topic), that explicit instruction always wins over the automatic subject-based classification.\n` +
    lines + '\n' +
    `Whichever category you pick also governs your background choice below: when designing "background"/"backgrounds", follow that category's BACKGROUND MOOD guidance (palette family, saturation, light vs dark) so the deck's colors and its content feel like they belong together, instead of a generic gradient bolted onto unrelated content.\n`
  );
}

// ========================================================================
// DECK VARIETY ENGINE — keeps every deck from collapsing to the "safe average"
// ========================================================================
// Models drift to the most generic answer. Variety is therefore forced from
// code, not hoped for from the prompt:
//   1. ART DIRECTION SEED  — one direction picked at random per request
//      (never one of the recently used ones) that the AI must adapt to the subject.
//   2. DESIGN FINGERPRINTS — theme / main colour / layout mix / background type of
//      the last DECK_FINGERPRINT_MAX decks live in localStorage and are fed back
//      as "be different from these".
//   3. FORM RULES — every slide picks a content form; bullet slides are capped.
//   4. TWO TEMPERATURES — a creative DESIGN pass (APP_CONFIG.DESIGN_TEMPERATURE)
//      and a precise CONTENT pass (APP_CONFIG.CONTENT_TEMPERATURE).

function _slideDesignTemp() {
  return (typeof APP_CONFIG !== 'undefined' && typeof APP_CONFIG.DESIGN_TEMPERATURE === 'number') ? APP_CONFIG.DESIGN_TEMPERATURE : 0.85;
}
function _slideContentTemp() {
  return (typeof APP_CONFIG !== 'undefined' && typeof APP_CONFIG.CONTENT_TEMPERATURE === 'number') ? APP_CONFIG.CONTENT_TEMPERATURE : 0.3;
}

// Each direction is expressed ONLY through what the schema can carry: CSS
// backgrounds, palette, the element library, layout/form choices and the voice
// of the headlines (no external images or fonts).
const SLIDE_ART_DIRECTIONS = [
  { id: 'swiss_editorial', label: 'Swiss editorial', brief: 'strict grid, lots of white space, one hard accent colour (red or cobalt), flat solid backgrounds, huge confident titles, tiny precise captions.' },
  { id: 'bauhaus', label: 'Bauhaus', brief: 'primary red/yellow/blue plus black on warm off-white, bold geometric shapes (circles, triangles, bars) as elements, asymmetric balance.' },
  { id: 'brutalist', label: 'Brutalist', brief: 'raw high-contrast: stark black/white or concrete grey with one loud acid colour, blunt oversized headlines, hard-edged blocks, zero softness.' },
  { id: 'paper_cut', label: 'Paper-cut layers', brief: 'overlapping pastel paper shapes with soft depth, wave/blob compositions (wave_band_stack, blob_cluster), warm friendly tone.' },
  { id: 'blueprint', label: 'Blueprint', brief: 'deep blueprint-blue background with fine white grid lines (repeating-linear-gradient), technical annotation feel, cyan/white only.' },
  { id: 'retro_70s', label: 'Retro 70s', brief: 'burnt orange, mustard, brown and olive, sunset-stripe gradients, rounded friendly shapes, warm nostalgic voice.' },
  { id: 'japanese_minimal', label: 'Japanese minimal', brief: 'washi-paper off-white, ink black, a single vermilion accent, generous empty space (ma), one small motif per slide, quiet restrained voice.' },
  { id: 'magazine_cover', label: 'Magazine cover', brief: 'dramatic title slides like a cover, strong contrast, big pull-quote moments, editorial confident headlines, glossy saturated accent.' },
  { id: 'neon_dark', label: 'Neon on dark', brief: 'near-black background with electric cyan/magenta/lime glows (radial-gradient glows, radial_glow_orb), futuristic energy.' },
  { id: 'risograph', label: 'Risograph print', brief: 'two-ink print look (e.g. fluorescent pink + teal) on cream paper, halftone dot textures (dot_grid_texture), slightly misregistered playful feel.' },
  { id: 'memphis', label: 'Memphis pop', brief: 'squiggles, confetti shapes, clashing bright colours on pastel or white, playful 80s geometry, loud and cheerful.' },
  { id: 'art_deco', label: 'Art deco', brief: 'black/navy with gold, symmetric fan/sunburst patterns (repeating gradients), elegant luxurious tone.' },
  { id: 'scandinavian_calm', label: 'Scandinavian calm', brief: 'soft greys, birch beige, muted sage or dusty blue, airy layouts, gentle rounded elements, quiet and functional.' },
  { id: 'newspaper', label: 'Broadsheet newspaper', brief: 'newsprint cream, black ink, thin rules, column-based layouts, headline-driven writing with a reporting voice.' },
  { id: 'constructivist', label: 'Constructivist poster', brief: 'red, black and cream, diagonal compositions, bold bars and angled blocks, urgent propaganda-poster energy.' },
  { id: 'mid_century', label: 'Mid-century modern', brief: 'teal, mustard, walnut and cream, boomerang/atomic shapes, optimistic 1950s catalogue feel.' },
  { id: 'terminal_mono', label: 'Terminal / hacker', brief: 'black background, phosphor green or amber, monospace-feeling terse text, command-line and log-style framing.' },
  { id: 'watercolor', label: 'Watercolor wash', brief: 'soft layered radial-gradient washes that bleed into each other, translucent pastel hues on warm white, gentle organic feel.' },
  { id: 'botanical_plate', label: 'Botanical plate', brief: 'aged cream paper, deep leaf green and rust, specimen-plate framing, plant/leaf elements, scholarly natural-history voice.' },
  { id: 'isometric_tech', label: 'Isometric tech', brief: 'cool gradient backgrounds, isometric/cube-like geometry, clean product-launch feel in indigo, sky and mint.' },
  { id: 'travel_poster', label: 'Vintage travel poster', brief: 'flat sun-and-horizon colour fields, sunset gradients, bold simple scenery, adventurous inviting tone.' },
  { id: 'museum_label', label: 'Museum exhibit', brief: 'neutral gallery walls (warm grey or deep oxblood), object-label style text, curated, one featured idea per slide.' },
  { id: 'comic_halftone', label: 'Comic halftone', brief: 'bright primaries, halftone dots, bold outlines, punchy exclamatory headlines, speech-bubble energy.' },
  { id: 'y2k_chrome', label: 'Y2K gloss', brief: 'silver-blue chrome gradients, bubbly translucent shapes, icy pink and aqua, glossy optimistic early-web feel.' },
  { id: 'dark_luxury', label: 'Dark luxury', brief: 'charcoal/black with muted gold or champagne, very sparse, slow and premium, small refined elements.' },
  { id: 'pastel_clay', label: 'Soft clay pastel', brief: 'chunky rounded soft shapes in peach, lilac, mint on creamy backgrounds, friendly tactile 3D-clay feel.' },
  { id: 'topographic', label: 'Topographic map', brief: 'contour-line textures (repeating radial gradients), earthy greens/browns or deep teal, exploratory field-guide tone.' },
  { id: 'ledger_stamp', label: 'Ledger & stamp', brief: 'accounting-paper green/cream, rubber-stamp red accents, ruled lines, official-record feel.' },
  { id: 'swiss_bold', label: 'Bold type poster', brief: 'type-as-image: enormous title, saturated single-colour fields (tomato, ultramarine, sunflower), almost no decoration.' },
  { id: 'folk_pattern', label: 'Folk pattern', brief: 'repeating geometric folk-art borders and textile patterns (repeating gradients), rich warm jewel colours, handcrafted warmth.' },
  { id: 'noir_cinematic', label: 'Cinematic noir', brief: 'deep shadows, black to slate gradients with a single warm spotlight glow, dramatic title-card pacing.' },
  { id: 'sunset_poster', label: 'Gradient sunset poster', brief: 'large smooth multi-stop sunset gradients (coral to violet to indigo), soft glow orbs, dreamy modern feel.' },
  { id: 'chalkboard', label: 'Chalkboard classroom', brief: 'slate-green board, chalk-white and pastel-chalk accents, hand-drawn-feeling doodle elements, teacherly warmth.' },
  { id: 'graph_paper', label: 'Graph-paper notebook', brief: 'pale grid paper (repeating-linear-gradient lines), pencil-grey ink, highlighter-yellow accents, working-notes feel.' },
  { id: 'aurora_glass', label: 'Aurora glass', brief: 'dark-to-teal aurora gradients with soft glowing orbs, frosted/translucent card feeling, calm futuristic mood.' },
  { id: 'ink_single_accent', label: 'Monochrome + one accent', brief: 'strictly black/white/grey plus exactly one accent colour used sparingly; contrast and rhythm do all the work.' },
  { id: 'collage_cutout', label: 'Cut-out collage', brief: 'torn-paper style overlapping shapes, mixed textures, tape-and-scrap feel, eclectic but cohesive palette.' }
];

function _slideArtDirectionById(id) {
  return SLIDE_ART_DIRECTIONS.find(d => d.id === id) || null;
}

function _deckFpLoad() {
  try {
    const raw = localStorage.getItem(DECK_FINGERPRINT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(x => x && typeof x === 'object') : [];
  } catch (_) { return []; }
}

function _deckFpSave(list) {
  try { localStorage.setItem(DECK_FINGERPRINT_KEY, JSON.stringify(list.slice(-DECK_FINGERPRINT_MAX))); } catch (_) {}
}

// Random direction that was NOT used by any of the recent decks.
function pickSlideArtDirection() {
  const window_ = Math.min(DECK_FINGERPRINT_MAX, SLIDE_ART_DIRECTIONS.length - 1);
  const recent = _deckFpLoad().slice(-window_).map(f => f.art);
  const pool = SLIDE_ART_DIRECTIONS.filter(d => recent.indexOf(d.id) === -1);
  const list = pool.length ? pool : SLIDE_ART_DIRECTIONS;
  return list[Math.floor(Math.random() * list.length)];
}

function _hexToHueFamily(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return 'unknown';
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max < 0.15) return 'black';
  if (d < 0.08) return max > 0.85 ? 'white' : 'grey';
  let hue;
  if (max === r) hue = ((g - b) / d) % 6; else if (max === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15) return 'red';
  if (hue < 40) return 'orange';
  if (hue < 65) return 'yellow';
  if (hue < 160) return 'green';
  if (hue < 195) return 'teal';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  if (hue < 335) return 'pink';
  return 'red';
}

function _classifyBgCss(css) {
  const s = String(css || '');
  if (/repeating-/i.test(s)) return 'pattern';
  const layers = s.split(/,(?![^(]*\))/).filter(x => /gradient/i.test(x)).length;
  if (layers > 1) return 'layered';
  if (/gradient/i.test(s)) return 'gradient';
  return 'solid';
}

function buildDeckFingerprint(deck, artId, brief) {
  const bgs = Array.isArray(deck && deck.backgrounds) ? deck.backgrounds : [];
  const lead = bgs.find(b => b && b.dark) || bgs[0] || null;
  const m = lead && String(lead.css || '').match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
  const briefColor = brief && Array.isArray(brief.palette) && brief.palette[0] ? brief.palette[0] : '';
  const color = (m ? m[0] : briefColor || '').toLowerCase();
  const bgTypes = Array.from(new Set(bgs.map(b => _classifyBgCss(b && b.css))));
  const counts = {};
  (deck && deck.slides || []).forEach(s => { if (s && s.layout) counts[s.layout] = (counts[s.layout] || 0) + 1; });
  const layouts = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 6);
  return {
    ts: Date.now(),
    art: artId || '',
    theme: (brief && brief.theme_name) || (lead && lead.label) || '',
    color,
    hue: _hexToHueFamily(color),
    bg: bgTypes,
    layouts,
    title: (deck && deck.title) || ''
  };
}

function recordDeckFingerprint(deck, artId, brief) {
  const list = _deckFpLoad();
  list.push(buildDeckFingerprint(deck, artId, brief));
  _deckFpSave(list);
}

// Content-form discipline (replaces the old "one comparison, one timeline…" formula).
function _slideFormRules() {
  return (
    `- STRUCTURE IS BORN FROM THE SUBJECT, NOT FROM A FORMULA. Do not include a comparison, a timeline, a big number or a quote just because decks "usually have" one — use a form only when THIS material genuinely has that shape, and never invent numbers or quotations to justify one.\n` +
    `- SLIDE FORMS: before writing each slide, choose the ONE form its content naturally takes: number, comparison, steps/process, quote/statement, grid/cards, story/example, image-led, or plain list. Let that form pick the layout (use \"free\" when no fixed layout fits).\n` +
    `- BULLET LIMIT: bullets are allowed but capped — at most about 25-30% of the slides (and at most 2 slides in a deck under 8 slides) may be a plain bullet-list slide. Everything else must carry its idea in another form.\n` +
    `- NO REPEATS: never put two consecutive slides in the same structure (same layout AND same form).\n`
  );
}

function buildDeckVarietyBlock(artDir, fingerprints, brief) {
  let t = '';
  if (artDir) {
    t +=
      `=== ART DIRECTION FOR THIS DECK (picked at random by the app so decks never all look alike) ===\n` +
      `Direction: ${artDir.label} — ${artDir.brief}\n` +
      `ADAPT this direction to the deck's subject: keep its spirit (palette logic, background technique, motifs, voice of headlines) but make it feel designed for THIS topic, not pasted on. It takes precedence over any generic \"palette family to lean toward\" hint above; the content category above still governs tone and legibility (text must stay readable on every background).\n`;
  }
  if (brief) {
    t += `DESIGN BRIEF (already decided by the art-director pass — follow it, do not redesign it): theme \"${brief.theme_name || ''}\"` +
      (brief.adaptation ? `; ${brief.adaptation}` : '') +
      (Array.isArray(brief.palette) && brief.palette.length ? `; palette ${brief.palette.join(', ')}` : '') +
      (Array.isArray(brief.motifs) && brief.motifs.length ? `; decorative motifs: ${brief.motifs.join(', ')}` : '') +
      (brief.voice ? `; headline voice: ${brief.voice}` : '') + `.\n`;
    const bgKey = brief.backgrounds ? 'backgrounds' : (brief.background ? 'background' : '');
    if (bgKey) {
      t += `The slide background(s) are ALREADY designed — in your JSON output copy the \"${bgKey}\" key EXACTLY as given here, do not alter it:\n${JSON.stringify({ [bgKey]: brief[bgKey] })}\n`;
    }
  }
  const fps = (fingerprints || []).slice(-DECK_FINGERPRINT_MAX);
  if (fps.length) {
    t += `=== RECENT DECKS BY THIS USER — BE CLEARLY DIFFERENT FROM ALL OF THEM ===\n` +
      fps.map(f => `- theme: ${f.theme || '?'} | main colour: ${f.color || '?'} (${f.hue || '?'}) | backgrounds: ${(f.bg || []).join('+') || '?'} | layouts used: ${(f.layouts || []).join(', ') || '?'}`).join('\n') + '\n' +
      `Do not reuse their main colour family, background type mix or layout mix; choose a different theme name too.\n`;
  }
  return t;
}

// Creative pass (high temperature): decides ONLY the look. Returns a sanitized
// brief or null (the caller then builds without one — never blocks the deck).
async function _generateDeckDesignBrief(pending, artDir, fingerprints, autoBgMode, env) {
  const outputLanguage = pending.outputLanguage;
  let bgShape = '';
  let bgRules = '';
  if (autoBgMode === 'single') {
    bgShape = `,\"background\":{\"label\":\"...\",\"css\":\"...\",\"pptx\":\"RRGGBB\",\"dark\":false}`;
    bgRules = `- \"background\": ONE original background for the whole deck. \"css\" = one valid CSS background value (solid, gradient or layered comma-separated gradients); \"pptx\" = 6-digit hex (no #) approximating it; \"dark\" = true only if text on it must be LIGHT.\n`;
  } else if (autoBgMode === 'varied') {
    bgShape = `,\"backgrounds\":[{\"id\":\"primary\",\"label\":\"...\",\"css\":\"...\",\"pptx\":\"RRGGBB\",\"dark\":false}]`;
    bgRules =
      `- \"backgrounds\": an ARRAY of 3 to ${SLIDE_MAX_BACKGROUNDS} cohesive but DIFFERENT backgrounds, each {\"id\",\"label\",\"css\",\"pptx\",\"dark\"}. Mix the styles: at least one solid, one soft gradient, one layered/patterned (multiple comma-separated layers, or repeating-linear-gradient stripes/grids), and one bold dark one for title/section slides.\n`;
  }
  const cssRule = bgShape
    ? `- CSS allowed functions ONLY: linear-gradient, radial-gradient, conic-gradient, repeating-linear-gradient, repeating-radial-gradient with hex/rgb()/rgba()/hsl()/hsla() stops. Never url(), images or external assets. Text must stay readable on every background.\n`
    : '';
  const system =
    `You are the ART DIRECTOR for AI PDF Studio's \"Create Slides\" feature. Decide ONLY the visual identity of one slide deck — write NO slide content. Return ONLY one JSON object, no markdown fences.\n` +
    `JSON SHAPE: {\"theme_name\":\"2-4 words\",\"adaptation\":\"1-2 sentences: how the art direction is adapted to THIS subject\",\"palette\":[\"#RRGGBB\",\"#RRGGBB\",\"#RRGGBB\",\"#RRGGBB\"],\"motifs\":[\"up to 4 short motif ideas (library element ids or plain concepts)\"],\"voice\":\"one short phrase describing the headline voice\"${bgShape}}\n` +
    `Be bold and specific. Avoid the safe default look (generic blue/purple gradient, white cards). Write \"label\" values in ${outputLanguage}; every other field in English.\n` +
    bgRules + cssRule +
    _slideContentCategoryRules() +
    buildDeckVarietyBlock(artDir, fingerprints, null);
  const outlineTitles = pending.outline && Array.isArray(pending.outline.slides)
    ? pending.outline.slides.map(s => s.title).filter(Boolean).join(' | ')
    : '';
  const userMsg =
    `USER REQUEST:\n${pending.originalPrompt}\n\n` +
    (outlineTitles ? `DECK OUTLINE TITLES: ${outlineTitles}\n\n` : '') +
    (pending.sourceContext ? `SOURCE CONTEXT (excerpt):\n${String(pending.sourceContext).slice(0, 1500)}\n\n` : '') +
    `Design the deck's visual identity now. Return the JSON object only.`;

  const result = await callAIAPI(
    [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
    { forceJson: true, modelsUsedSet: env.modelsUsedSet, modelConfig: _generationLockedModelConfig || env.activeCfg, maxTokens: undefined, temperature: _slideDesignTemp() }
  );
  if (result && result.modelConfig) _generationLockedModelConfig = result.modelConfig;
  let j = safeParseAIJson(result.content, null);
  if (!j) j = attemptRepairAndParse(result.content);
  if (!j || typeof j !== 'object') return null;

  const clip = (v, n) => String(v == null ? '' : v).replace(/<[^>]*>/g, '').trim().slice(0, n);
  const brief = {
    theme_name: clip(j.theme_name, 60),
    adaptation: clip(j.adaptation, 280),
    palette: (Array.isArray(j.palette) ? j.palette : []).filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim())).map(c => c.trim()).slice(0, 6),
    motifs: (Array.isArray(j.motifs) ? j.motifs : []).filter(m => typeof m === 'string' && m.trim()).map(m => clip(m, 40)).slice(0, 4),
    voice: clip(j.voice, 120)
  };
  const okBg = b => b && typeof b === 'object' && typeof b.css === 'string' && b.css.trim() && !/url\s*\(/i.test(b.css);
  if (autoBgMode === 'single' && okBg(j.background)) brief.background = j.background;
  if (autoBgMode === 'varied' && Array.isArray(j.backgrounds) && j.backgrounds.length >= 2 && j.backgrounds.every(okBg)) {
    brief.backgrounds = j.backgrounds.slice(0, SLIDE_MAX_BACKGROUNDS);
  }
  return brief;
}

function buildSlideDeckRules(outputLanguage, lengthHint, autoBgMode, varietyBlock) {
  const chartCatalog = typeof getChartCatalogForPrompt === 'function' ? getChartCatalogForPrompt() : '';
  const illustrationCatalog = typeof getIllustrationCatalogForPrompt === 'function' ? getIllustrationCatalogForPrompt() : '';
  const elementCatalog = typeof getElementCatalogForPrompt === 'function' ? getElementCatalogForPrompt() : '';
  const layoutCatalog = typeof getSlideLayoutCatalogForPrompt === 'function' ? getSlideLayoutCatalogForPrompt() : '';

  let bgSchemaKey = '';
  let bgRule = '';
  if (autoBgMode === 'single') {
    bgSchemaKey = `,"background":{"label":"...","css":"...","pptx":"RRGGBB","dark":true}`;
    bgRule =
      `- "background" (top-level, sibling of "slides"): DESIGN AN ORIGINAL background that fits THIS deck's specific topic, mood and tone AND matches the BACKGROUND MOOD of the CONTENT CATEGORY you classified above (an academic deck should not get a loud business gradient; a business pitch should not get a pastel notebook look) — do not fall back to a generic default. "label" is a short 2-4 word name; "css" is a single valid CSS background value (solid color, gradient, or layered comma-separated gradients — see the CSS rules note above); "pptx" is a 6-digit hex (no "#") approximating css's overall color, for PowerPoint export; "dark" is true only if slide title/bullet text needs to render LIGHT to stay readable on it. This single design is applied to every slide for a cohesive look. Set the whole "background" key to null instead for a plain white deck.\n`;
  } else if (autoBgMode === 'varied') {
    bgSchemaKey = `,"backgrounds":[{"id":"primary","label":"...","css":"...","pptx":"RRGGBB","dark":false},{"id":"accent","label":"...","css":"...","pptx":"RRGGBB","dark":true}]`;
    bgRule =
      `- "backgrounds" (top-level ARRAY, sibling of "slides"): produce a SET of 3 to ${SLIDE_MAX_BACKGROUNDS} DIFFERENT backgrounds that together form a cohesive palette for this deck, drawn from the BACKGROUND MOOD of the CONTENT CATEGORY you classified above (do not default to the same palette family for every topic — an academic deck's set should read calm/pastel, a business deck's set should read bold/premium, an office deck's set should read neutral/muted). Each entry: {"id":"short_id","label":"2-4 word name","css":"...","pptx":"RRGGBB","dark":false}. IMPORTANT — VARY the visual STYLE across the array, do NOT make them all the same kind of linear gradient:\n` +
      `    • at least ONE solid color (e.g. "#f4ede4")\n` +
      `    • at least ONE soft gradient (e.g. "linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%)")\n` +
      `    • at least ONE layered / patterned entry — for a collage or texture look use MULTIPLE comma-separated CSS background layers (e.g. "radial-gradient(circle at 20% 30%, rgba(79,125,243,0.20) 0%, transparent 45%), radial-gradient(circle at 80% 70%, rgba(255,140,120,0.20) 0%, transparent 45%), linear-gradient(135deg,#f8fafc,#e2e8f0)"); for stripes / wave bands use repeating-linear-gradient (e.g. "repeating-linear-gradient(135deg, #e8e2d6 0 14px, #f5efe6 14px 28px)" or "repeating-linear-gradient(90deg, #0f2b48 0 40px, #13375a 40px 80px)")\n` +
      `    • at least ONE bold / dark entry (deep saturated color or dark gradient) meant for section dividers and the title slide\n` +
      `    Every entry must be readable behind text, use a coherent palette across the whole set (same family of hues), and never include url(), images, or external assets. Allowed CSS functions ONLY: linear-gradient, radial-gradient, conic-gradient, repeating-linear-gradient, repeating-radial-gradient (all with hex / rgb() / rgba() / hsl() / hsla() color stops).\n` +
      `- Each slide MAY include "bgIndex": 0-based index into the "backgrounds" array, choosing which entry that slide uses. Rules of thumb: title / section / quote slides usually look best with the boldest / darkest entry; regular content slides look best with the lighter or patterned entries. If you do not specify "bgIndex", the app picks one automatically for good visual variety (title/section/quote → bold, content → rotating light/pattern).\n`;
  } else {
    bgRule = `- Every slide is generated on a plain white canvas — never mention or imply a colored/patterned slide background; that is a separate, user-controlled styling step outside this JSON.`;
  }

  return (
    `You are the dedicated SLIDE DECK generator for AI PDF Studio's "Create Slides" feature.\n` +
    `Return ONLY a single JSON object — no markdown fences, no commentary outside the JSON.\n` +
    `Language: ${outputLanguage}.\n` +
    `- If ${outputLanguage} uses a complex script (Bengali, Devanagari, Arabic, Thai, Tamil, etc.), take extra care to write every word with the CORRECT characters and combining marks. Do not substitute visually-similar characters from other scripts (e.g. Assamese ৰ/ৱ for Bengali ব, or ড for দ). If unsure of a word's spelling, prefer simpler synonyms you are confident about. Broken script in the output is worse than a slightly simpler sentence.\n` +
    _slideContentCategoryRules() +
    `CLARIFYING QUESTION — this has already been decided in an earlier step for this request; do NOT ask a clarifying question here and do NOT return the {"action":"clarify",...} shape — always generate the deck directly now.\n` +
    `JSON SHAPE (exact keys) — the normal case:\n` +
    `{"action":"generate_slides","deck_title":"...","slides":[{"layout":"content","title":"...","bullets":["...","..."],"visual":null,"elements":[]}]${bgSchemaKey}${typeof getSlideThemeSchemaKeyForPrompt === 'function' ? getSlideThemeSchemaKeyForPrompt() : ''}}\n` +
    `Each slide's exact keys depend on its "layout" — see LAYOUTS below. Every slide MUST include "layout".\n` +
    (typeof getSlideThemeRuleForPrompt === 'function' ? getSlideThemeRuleForPrompt() : '') +
    `LAYOUTS (each slide MUST have one; pick whichever best fits that slide's content, and reach for "free" whenever none of the fixed ones does):\n      ${layoutCatalog}\n` +
    _slideFormRules() +
    _slideDeckLengthRule(lengthHint) +
    `- MATH NOTATION (KaTeX): anywhere text appears in this schema ("title", "bullets", "subtitle", quote/stat/table/agenda/card/step/faq/profile/comparison text, and any "text" inside a "free" layout block) you MAY write real mathematical, physics or chemistry notation using LaTeX, delimited exactly like this: "$...$" for INLINE math (e.g. "the area is $A = \\pi r^2$") and "$$...$$" for a DISPLAY equation on its own line (e.g. "$$E = mc^2$$"). The app renders this with real KaTeX typesetting (proper fractions, exponents, roots, Greek letters, integrals, matrices, etc.) — use it whenever the subject genuinely involves a formula, equation, unit, or symbolic expression (STEM/academic topics especially), instead of writing it out as plain text or ASCII approximations ("x^2", "sqrt(x)"). Do NOT wrap ordinary non-math text in "$" — only use it for actual mathematical notation.\n` +
    `- "title" is a short slide headline. Omit it only on "quote" layout.\n` +
    `- "bullets" is an array of short phrases (NOT paragraphs). Give each slide as many or as few as it needs; if a slide is title-only, leave it an empty array. Omit for layouts that don't use it.\n` +
    `- STATS STRICTNESS: on "stats" and "big_stat" layouts, EVERY entry with a "label" MUST also have a "value" (a short number with optional unit, like "80%" / "5.4B" / "+1.1°C"). Never send an item with only a label and no value — pick a different layout (content/cards/free) for numbers you cannot quantify. The in-app renderer keeps value-less items but shows them as plain text, which looks broken next to real numbers.\n` +
    `- QUOTE AUTHENTICITY (applies to "quote" layout AND any {"type":"quote",...} block inside a "free" layout): you must NEVER invent, paraphrase-as-if-verbatim, or misattribute a quote. Every "text" you put in a quote MUST be a real quotation that a real, named person actually said or wrote, reproduced as accurately as you can from what you actually know — not a plausible-sounding line you composed and attached a famous name to. Put ONLY the real person's name (and title/role if it adds clarity, e.g. "Marie Curie, physicist") in "author" — never invent a fictional or generic attribution ("Anonymous", "Unknown", "A wise teacher") to cover for a made-up line. If you are not genuinely confident a quote is real and correctly attributed to that exact person, DO NOT use the quote layout/block for that slide at all — use "content", "big_stat", "cards", or another layout that does not require a quotation instead. A slide with no quote is always better than a slide with a fabricated one.\n` +
    `- "elements" (OPTIONAL on ANY slide): a decorative layer of small flat-design icons/illustrations placed BEHIND or IN FRONT OF the slide's content. Each entry is ONE of:\n` +
    `    (a) a pre-made library element: {"id":"sun","layer":"behind","x":80,"y":10,"size":15,"color":"#f5a623","opacity":0.4}. Use this when the element you need matches one of the ids listed below — it renders crisper than a hand-drawn one and honors "color"/"color2" overrides for theming.\n` +
    `    (b) a custom hand-drawn element: {"svg":"<svg viewBox=\\"0 0 100 100\\"><path d=\\"...\\" fill=\\"#5a3a1f\\"/></svg>","layer":"behind","x":80,"y":10,"size":15,"opacity":0.4}. Use this when NO library element matches the topic (a specific historical artifact, a niche object, a topic-specific shape). Draw in the SAME flat style as the library: simple solid-filled shapes, 1-3 colors, no gradients, no strokes wider than 3px, no text, no filters. Always use viewBox=\\"0 0 100 100\\" so proportions match the library.\n` +
    `    Both forms accept: "layer":"behind"|"front" ("behind" paints behind the title/bullets/visual — for background accents; "front" paints over everything — for corner decorations, keep opacity 0.5-0.8 for visibility), "x" and "y" (0-100 as percent of slide width/height — CAN go negative or past 100 to bleed off the slide edge), "size" (percent of slide width, 5-30 for a corner decoration; see FULL-BLEED recipe below for a much larger use), "rotate" (degrees), "opacity" (0-1; 0.2-0.4 for "subtle"/"background" phrasing).\n` +
    `    FULL-BLEED BACKGROUND/FOREGROUND COMPOSITIONS: 5 library ids — wave_band_stack, blob_cluster, dot_grid_texture, low_poly_mosaic, radial_glow_orb — are drawn edge-to-edge (not centered like a normal icon), so placed LARGE they become a real organic slide background or foreground wash instead of a small icon, e.g. to recreate a "paper-cut pastel wave background", a "pastel blob/notes background", a "dotted texture over pastel shapes", a "low-poly / geometric triangle background", or a "soft glow accent" the user asks for or pastes as a reference image. Recipe: {"id":"wave_band_stack","layer":"behind","x":-35,"y":-35,"size":170,"opacity":1,"color":"#e0c3fc","color2":"#8ec5fc","color3":"#d3f8e2","color4":"#faf3c0","color5":"#f7b8c4"} — x≈-35,y≈-35,size≈170 is the standard full-coverage placement (bleeds past every edge regardless of exact crop) for ANY of these 5; do not use a small size for them. These 5 (and only these 5) also accept "color3"/"color4"/"color5" (all optional hex, same rules as "color") for extra tones — wave_band_stack and blob_cluster use up to 5/3 tones for the different bands/blobs, low_poly_mosaic uses up to 3 for its facets, dot_grid_texture and radial_glow_orb use only "color". A rich background is usually 1-2 of these stacked (e.g. low_poly_mosaic behind + dot_grid_texture behind at opacity 0.15 for texture, or blob_cluster behind + radial_glow_orb front for an accent glow) — still respect the elements-per-slide guidance below when combining them.\n` +
    `    For a typical deck: 0-4 elements total per slide (a full-bleed background composition counts as 1-2 of those, even though it's visually large), each well-placed. Do NOT overcrowd.\n` +
    `    MANDATORY USE OF "elements":\n` +
    `    • Whenever the user's request mentions decorations, background pieces, subtle accents, small icons, symbolic imagery, a "theme", a mood accent, or says things like "add a sun", "add clouds", "add small icons", "add subtle decorations" — you MUST include a non-empty "elements" array on the relevant slides. Skipping it is a failure of the request.\n` +
    `    • Whenever the user asks for an organic/wavy/blob/geometric/low-poly/dotted/textured SLIDE BACKGROUND, pastes a reference image of one, or asks to make the deck "look like" such a background — you MUST use the FULL-BLEED recipe above on layer "behind" (typically on every slide, or at least the title/section slides) instead of (or alongside) the CSS "background"/"backgrounds" mechanism, since CSS gradients alone cannot draw organic blob/wave/triangle shapes. Skipping this when it is clearly what the user is asking for is a failure of the request.\n` +
    `    • Also include "elements" proactively on 2-4 slides when a small topic-specific accent would strengthen the slide (a topical icon near a section title, a subtle theme motif in a corner of an otherwise plain slide).\n` +
    `    • Do NOT skip "elements" because a slide's "visual" already contains similar imagery — a visual is a distinct block; "elements" is a separate decorative LAYER on top of or behind the whole slide. Both can coexist.\n` +
    `    • When the user explicitly asked for decorations, use layer "behind" with opacity 0.2-0.4 for subtle/background phrasing, or layer "front" with opacity 0.5-0.8 for corner-visible accents.\n` +
    `    Pre-made library element ids (try these FIRST; if nothing here fits, hand-draw a custom svg per (b)):\n      ${elementCatalog}\n` +
    `- VISUAL: "visual" is OPTIONAL on "content", REQUIRED on "visual_left"/"visual_focus", and never set on other layouts. Set it to exactly one of:\n` +
    `    (a) null — no visual,\n` +
    `    (b) a chart placeholder when the slide's point is data, one of:\n      ${chartCatalog}\n` +
    `    (c) an illustration placeholder — "<!--ILLUSTRATION:scene_id:params-->" — for a decorative flat-design scene, ONLY when an entry below is a genuine, near-exact (~90-100%) match for the slide's actual subject (e.g. a slide literally about a fox → animal item=fox). Do not pick the closest-sounding entry as a stand-in for something that isn't really there — an approximate/wrong illustration is worse than a plain slide. If nothing below genuinely matches, use (f) instead. Catalog:\n      ${illustrationCatalog}\n` +
    `    (d) a single element-library piece as "<!--ELEMENT:id:size=..|x=..|y=..|color=..#..-->" (see the element ids above) — for a small clean icon as the slide's visual. Wrap it in a raw "<svg viewBox=\\"0 0 700 400\\">...<!--ELEMENT:...-->...</svg>" if you need to place it inside a wider canvas.\n` +
    `    (e) an IMAGE PLACEHOLDER — "<!--IMAGE_PLACEHOLDER:box:description-->" or "<!--IMAGE_PLACEHOLDER:circle:description-->" — DIAGRAMS ARE PERMANENTLY DISABLED, so use this whenever the slide's point would normally need a diagram (an anatomical, technical, schematic, process/flow, or any other labeled figure). "box" or "circle" picks the placeholder's shape; "description" must be a detailed, specific description of exactly what image should go there (the subject, its key labeled parts, what it should show) written as plain text — it is rendered as visible text inside the placeholder frame so a real image can be dropped in later. Example: "<!--IMAGE_PLACEHOLDER:circle:Diagram of the human heart in cross-section, labeling the four chambers, the septum, and the aorta/pulmonary vessels-->". Never hand-draw the diagram yourself — always use this placeholder instead.\n` +
    `    (f) a small hand-drawn illustration/icon as a raw, complete "<svg ...>...</svg>" string (viewBox 0 0 700 400, no external assets) — for any non-diagram decorative concept NOT covered by (b)-(e) with a genuine match, INCLUDING when (c)'s catalog has no near-exact (~90-100%) match for the slide's real subject. Never hand-draw a diagram, schematic, or labeled technical/anatomical figure this way — use (e) instead.\n` +
    `    Decide freely per slide whether a visual helps and which kind helps most; text-only slides are fine, and an irrelevant picture makes the deck worse.\n` +
    `- Never put a visual placeholder or raw svg inside "bullets" — it belongs only in the "visual" field or a "visual" block.\n` +
    `- DECK STRUCTURE — do NOT repeat the same overall flow every time. Vary the sequence based on the topic: a historical topic benefits from an early timeline; a comparison topic from early two_column / table; a data-driven topic from early stats / chart; a philosophical topic from an early quote; a how-to topic from an early timeline or agenda. Don't automatically insert an "agenda" slide unless the deck is long enough (8+ slides) to need one. Don't automatically end on a summary / conclusion — end on the strongest note for THAT topic, which might be a big stat, a quote, a call-to-action, a timeline endpoint, or a visual. Never open with anything but "title".\n` +
    `- The FIRST slide MUST use "layout":"title": {"layout":"title","title":"..."} — deck title/topic only, nothing else.\n` +
    `- Do not add a closing "Thank you" slide unless the user explicitly asked for one.\n` +
    bgRule +
    (varietyBlock ? '\n' + varietyBlock : '')
  );
}

// ===== SANITIZATION =====
function _truncateSlideText(text, maxChars) {
  const s = String(text == null ? '' : text).replace(/<[^>]*>/g, '').trim();
  return s.length > maxChars ? s.slice(0, maxChars - 1).trim() + '…' : s;
}

function _sanitizeSlideLayout(rawLayout) {
  const id = String(rawLayout || '').trim().toLowerCase();
  return SLIDE_LAYOUTS.indexOf(id) !== -1 ? id : 'content';
}

function _sanitizeSlideColumns(raw, maxCols) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const max = maxCols || SLIDE_LAYOUT_MAX_COLUMNS;
  const columns = raw.slice(0, max).map(c => {
    if (!c || typeof c !== 'object') return null;
    const heading = _truncateSlideText(c.heading || '', SLIDE_LAYOUT_MAX_COLUMN_HEADING_CHARS);
    const bulletsSrc = Array.isArray(c.bullets) ? c.bullets : [];
    const bullets = bulletsSrc
      .filter(b => typeof b === 'string' && b.trim())
      .slice(0, SLIDE_LAYOUT_MAX_COLUMN_BULLETS)
      .map(b => _truncateSlideText(b, SLIDE_DECK_MAX_BULLET_CHARS));
    if (!heading && !bullets.length) return null;
    return { heading: heading || '', bullets };
  }).filter(Boolean);
  return columns.length >= 2 ? columns : null;
}

function _sanitizeSlideStat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const value = _truncateSlideText(raw.value || '', SLIDE_LAYOUT_MAX_STAT_VALUE_CHARS);
  const label = _truncateSlideText(raw.label || '', SLIDE_LAYOUT_MAX_STAT_LABEL_CHARS);
  // Accept items that have EITHER a value OR a label. AI frequently
  // provides a label without a value for stats it can't quantify. Dropping
  // those used to leave orphan labels rendered next to the remaining
  // values. Keeping them means the label just renders without a big
  // number — worse-looking, but shows all the AI's content.
  if (!value && !label) return null;
  return { value: value || '', label: label || '' };
}

function _sanitizeSlideQuote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = _truncateSlideText(raw.text || '', SLIDE_LAYOUT_MAX_QUOTE_CHARS);
  const author = _truncateSlideText(raw.author || '', SLIDE_LAYOUT_MAX_QUOTE_AUTHOR_CHARS);
  if (!text) return null;
  return { text, author };
}

function _sanitizeSlideSteps(raw) {
  if (!Array.isArray(raw) || raw.length < SLIDE_LAYOUT_MIN_STEPS) return null;
  const steps = raw.slice(0, SLIDE_LAYOUT_MAX_STEPS).map(s => {
    if (!s || typeof s !== 'object') return null;
    const label = _truncateSlideText(s.label || '', SLIDE_LAYOUT_MAX_STEP_LABEL_CHARS);
    const text = _truncateSlideText(s.text || '', SLIDE_LAYOUT_MAX_STEP_TEXT_CHARS);
    if (!label && !text) return null;
    return { label: label || '', text: text || '' };
  }).filter(Boolean);
  return steps.length >= SLIDE_LAYOUT_MIN_STEPS ? steps : null;
}

function _sanitizeSlideCards(raw) {
  if (!Array.isArray(raw) || raw.length < SLIDE_LAYOUT_MIN_CARDS) return null;
  const cards = raw.slice(0, SLIDE_LAYOUT_MAX_CARDS).map(c => {
    if (!c || typeof c !== 'object') return null;
    const heading = _truncateSlideText(c.heading || '', SLIDE_LAYOUT_MAX_CARD_HEADING_CHARS);
    const text = _truncateSlideText(c.text || '', SLIDE_LAYOUT_MAX_CARD_TEXT_CHARS);
    if (!heading && !text) return null;
    return { heading, text };
  }).filter(Boolean);
  return cards.length >= SLIDE_LAYOUT_MIN_CARDS ? cards : null;
}

function _sanitizeSlideStats(raw) {
  if (!Array.isArray(raw) || raw.length < SLIDE_LAYOUT_MIN_STATS) return null;
  const stats = raw.slice(0, SLIDE_LAYOUT_MAX_STATS).map(s => {
    if (!s || typeof s !== 'object') return null;
    const value = _truncateSlideText(s.value || '', SLIDE_LAYOUT_MAX_STAT_VALUE_CHARS);
    const label = _truncateSlideText(s.label || '', SLIDE_LAYOUT_MAX_STATS_LABEL_CHARS);
    if (!value && !label) return null;
    return { value: value || '', label: label || '' };
  }).filter(Boolean);
  return stats.length >= SLIDE_LAYOUT_MIN_STATS ? stats : null;
}

function _sanitizeSlideTable(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.headers) || !Array.isArray(raw.rows)) return null;
  const headers = raw.headers.slice(0, SLIDE_LAYOUT_MAX_TABLE_COLS).map(h => _truncateSlideText(h, SLIDE_LAYOUT_MAX_TABLE_CELL_CHARS));
  if (headers.length < SLIDE_LAYOUT_MIN_TABLE_COLS) return null;
  const rows = raw.rows.slice(0, SLIDE_LAYOUT_MAX_TABLE_ROWS).map(r => {
    if (!Array.isArray(r)) return null;
    const cells = headers.map((_, ci) => _truncateSlideText(r[ci], SLIDE_LAYOUT_MAX_TABLE_CELL_CHARS));
    return cells.some(Boolean) ? cells : null;
  }).filter(Boolean);
  if (!rows.length) return null;
  return { headers, rows };
}

function _sanitizeSlideAgenda(raw) {
  if (!Array.isArray(raw) || raw.length < SLIDE_LAYOUT_MIN_AGENDA_ITEMS) return null;
  const items = raw.slice(0, SLIDE_LAYOUT_MAX_AGENDA_ITEMS).map(it => {
    const t = (it && typeof it === 'object') ? (it.label || it.text || '') : it;
    return _truncateSlideText(t, SLIDE_LAYOUT_MAX_AGENDA_ITEM_CHARS);
  }).filter(Boolean);
  return items.length >= SLIDE_LAYOUT_MIN_AGENDA_ITEMS ? items : null;
}

// ---- comparison — a two-sided pros/cons-style list ----
function _sanitizeSlideComparisonSide(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const heading = _truncateSlideText(raw.heading || '', SLIDE_LAYOUT_MAX_COMPARISON_HEADING_CHARS);
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter(x => typeof x === 'string' && x.trim())
    .slice(0, SLIDE_LAYOUT_MAX_COMPARISON_ITEMS)
    .map(x => _truncateSlideText(x, SLIDE_LAYOUT_MAX_COMPARISON_ITEM_CHARS));
  if (!heading && items.length < SLIDE_LAYOUT_MIN_COMPARISON_ITEMS) return null;
  return { heading, items };
}

function _sanitizeSlideComparison(s) {
  const left = _sanitizeSlideComparisonSide(s.left);
  const right = _sanitizeSlideComparisonSide(s.right);
  if (!left || !right) return null;
  if (!left.items.length && !right.items.length) return null;
  return { left, right };
}

// ---- faq — question/answer pairs ----
function _sanitizeSlideFaq(raw) {
  if (!Array.isArray(raw) || raw.length < SLIDE_LAYOUT_MIN_FAQ_ITEMS) return null;
  const items = raw.slice(0, SLIDE_LAYOUT_MAX_FAQ_ITEMS).map(it => {
    if (!it || typeof it !== 'object') return null;
    const question = _truncateSlideText(it.question || '', SLIDE_LAYOUT_MAX_FAQ_QUESTION_CHARS);
    const answer = _truncateSlideText(it.answer || '', SLIDE_LAYOUT_MAX_FAQ_ANSWER_CHARS);
    if (!question || !answer) return null;
    return { question, answer };
  }).filter(Boolean);
  return items.length >= SLIDE_LAYOUT_MIN_FAQ_ITEMS ? items : null;
}

// ---- profiles — a grid of people (team/speakers/testimonials) ----
function _sanitizeSlideProfiles(raw) {
  if (!Array.isArray(raw) || raw.length < SLIDE_LAYOUT_MIN_PROFILES) return null;
  const profiles = raw.slice(0, SLIDE_LAYOUT_MAX_PROFILES).map(p => {
    if (!p || typeof p !== 'object') return null;
    const name = _truncateSlideText(p.name || '', SLIDE_LAYOUT_MAX_PROFILE_NAME_CHARS);
    const role = _truncateSlideText(p.role || '', SLIDE_LAYOUT_MAX_PROFILE_ROLE_CHARS);
    const bio = _truncateSlideText(p.bio || '', SLIDE_LAYOUT_MAX_PROFILE_BIO_CHARS);
    if (!name) return null;
    return { name, role, bio };
  }).filter(Boolean);
  return profiles.length >= SLIDE_LAYOUT_MIN_PROFILES ? profiles : null;
}

// ========================================================================
// SLIDE ELEMENTS (element-library.js drop-ins + custom hand-drawn)
// ========================================================================
const SLIDE_MAX_ELEMENTS_PER_SLIDE = 30;
const SLIDE_ELEMENT_LAYERS_BEHIND = ['bg', 'back', 'behind', 'behind_text'];
const SLIDE_ELEMENT_LAYERS_FRONT = ['fg', 'front', 'foreground'];

function _sanitizeSlideElement(e) {
  if (!e || typeof e !== 'object') return null;
  // Each element is EITHER a library reference (by id) OR a custom
  // hand-drawn SVG — not both.
  const rawSvg = (typeof e.svg === 'string' && e.svg.trim().length > 20) ? e.svg.trim() : '';
  const id = String(e.id || '').trim().toLowerCase();
  if (!rawSvg && !id) return null;
  const rawLayer = String(e.layer || 'fg').trim().toLowerCase();
  const layer = SLIDE_ELEMENT_LAYERS_BEHIND.indexOf(rawLayer) !== -1 ? 'behind'
    : (SLIDE_ELEMENT_LAYERS_FRONT.indexOf(rawLayer) !== -1 ? 'front' : 'front');
  const num = (v, d, lo, hi) => {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(lo, Math.min(hi, n));
  };
  const hex = v => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : null;
  return {
    id,
    svg: rawSvg || null,
    layer,
    x: num(e.x, 0, -100, 200),
    y: num(e.y, 0, -100, 200),
    size: num(e.size, 15, 0.5, 200),
    rotate: num(e.rotate, 0, -360, 360),
    opacity: num(e.opacity, 1, 0, 1),
    // color..color5 only apply to library elements — a hand-drawn SVG has
    // its own baked-in colors. color3-5 only matter for the multi-tone
    // "backgrounds_scenic" pieces (wave_band_stack, blob_cluster,
    // low_poly_mosaic); every other element simply ignores them.
    color: rawSvg ? null : hex(e.color),
    color2: rawSvg ? null : hex(e.color2),
    color3: rawSvg ? null : hex(e.color3),
    color4: rawSvg ? null : hex(e.color4),
    color5: rawSvg ? null : hex(e.color5)
  };
}

function _sanitizeSlideElements(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, SLIDE_MAX_ELEMENTS_PER_SLIDE).map(_sanitizeSlideElement).filter(Boolean);
}

// ========================================================================
// FREE LAYOUT ("layout":"free") — AI-composed blocks
// ========================================================================
const SLIDE_MAX_BLOCKS = 24;
const SLIDE_MAX_NESTED_BLOCKS = 12;
const SLIDE_MAX_BLOCK_DEPTH = 2;

const _SLIDE_BLOCK_ALIGNS = ['left', 'center', 'right'];
const _SLIDE_BLOCK_SIZES = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
const _SLIDE_BLOCK_SIZE_EM = { xs: '0.75em', sm: '0.9em', md: '1em', lg: '1.4em', xl: '1.9em', xxl: '2.5em' };

function _slideBlockStyle(raw) {
  const style = {};
  if (typeof raw.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(raw.color)) style.color = raw.color;
  if (typeof raw.size === 'string' && _SLIDE_BLOCK_SIZES.indexOf(raw.size) !== -1) style.size = raw.size;
  if (typeof raw.weight === 'string' && (raw.weight === 'bold' || raw.weight === 'normal')) style.weight = raw.weight;
  if (typeof raw.italic === 'boolean') style.italic = raw.italic;
  return style;
}

function _slideBlockAlign(raw) {
  const a = String(raw.align || '').trim().toLowerCase();
  return _SLIDE_BLOCK_ALIGNS.indexOf(a) !== -1 ? a : null;
}

function _sanitizeBlock(raw, depth) {
  if (!raw || typeof raw !== 'object') return null;
  const d = depth || 0;
  const type = String(raw.type || '').trim().toLowerCase();
  const align = _slideBlockAlign(raw);
  const style = _slideBlockStyle(raw);

  if (type === 'heading') { const text = _truncateSlideText(raw.text || '', 400); return text ? { type, text, align, style } : null; }
  if (type === 'text')    { const text = _truncateSlideText(raw.text || '', 1200); return text ? { type, text, align, style } : null; }
  if (type === 'bullets') {
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .filter(x => typeof x === 'string' && x.trim())
      .slice(0, SLIDE_DECK_MAX_BULLETS_PER_SLIDE)
      .map(x => _truncateSlideText(x, SLIDE_DECK_MAX_BULLET_CHARS));
    return items.length ? { type, items, align, style } : null;
  }
  if (type === 'quote') { const q = _sanitizeSlideQuote(raw); return q ? { type, quote: q, align, style } : null; }
  if (type === 'stat')  { const st = _sanitizeSlideStat(raw); return st ? { type, stat: st, align, style } : null; }
  if (type === 'table') { const t = _sanitizeSlideTable(raw); return t ? { type, table: t, align, style } : null; }
  if (type === 'visual') {
    const v = (typeof raw.visual === 'string' && raw.visual.trim()) ? raw.visual.trim() : null;
    if (!v) return null;
    const caption = _truncateSlideText(raw.caption || '', SLIDE_LAYOUT_MAX_CAPTION_CHARS);
    return { type, visual: v, caption, style };
  }
  if (type === 'element') {
    const el = _sanitizeSlideElement(raw);
    if (!el) return null;
    return { type, element: el, align, style };
  }
  if (type === 'spacer')  { const size = (raw.size === 'lg' ? 'lg' : (raw.size === 'sm' ? 'sm' : 'md')); return { type, size, style }; }
  if (type === 'divider') { return { type, style }; }
  if (type === 'row' || type === 'grid') {
    if (d >= SLIDE_MAX_BLOCK_DEPTH) return null;
    const inner = (Array.isArray(raw.blocks) ? raw.blocks : []).slice(0, SLIDE_MAX_NESTED_BLOCKS).map(b => _sanitizeBlock(b, d + 1)).filter(Boolean);
    if (!inner.length) return null;
    const cols = Number.isFinite(parseInt(raw.cols, 10)) ? Math.max(1, Math.min(6, parseInt(raw.cols, 10))) : (type === 'grid' ? 2 : inner.length);
    return { type, blocks: inner, cols };
  }
  return null;
}

function _sanitizeSlideBlocks(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const blocks = raw.slice(0, SLIDE_MAX_BLOCKS).map(b => _sanitizeBlock(b, 0)).filter(Boolean);
  return blocks.length ? blocks : null;
}

function _resolveBlockVisuals(blocks) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach(b => {
    if (!b) return;
    if (b.type === 'visual') {
      b.visualSVG = resolveSlideVisualSVG(b.visual);
      b.visualChartData = _parseSlideChartData(b.visual);
    }
    if ((b.type === 'row' || b.type === 'grid') && Array.isArray(b.blocks)) _resolveBlockVisuals(b.blocks);
  });
}

// ---- icon_row — a row of element-library icons with short labels ----
function _sanitizeSlideIconRow(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const items = raw.slice(0, 6).map(it => {
    if (!it || typeof it !== 'object') return null;
    const el = _sanitizeSlideElement(it);
    if (!el) return null;
    return {
      element: el,
      label: _truncateSlideText(it.label || '', 80),
      text: _truncateSlideText(it.text || '', 200)
    };
  }).filter(Boolean);
  return items.length >= 2 ? items : null;
}

function _sanitizeSlideLayoutData(s, layout) {
  if (layout === 'two_column') {
    const columns = _sanitizeSlideColumns(s.columns, 2);
    return columns ? { layout, columns } : { layout: 'content' };
  }
  if (layout === 'three_column') {
    const columns = _sanitizeSlideColumns(s.columns, 3);
    return (columns && columns.length === 3) ? { layout, columns } : { layout: 'content' };
  }
  if (layout === 'big_stat') {
    const stat = _sanitizeSlideStat(s.stat);
    return stat ? { layout, stat } : { layout: 'content' };
  }
  if (layout === 'quote') {
    const quote = _sanitizeSlideQuote(s.quote);
    return quote ? { layout, quote } : { layout: 'content' };
  }
  if (layout === 'timeline') {
    const steps = _sanitizeSlideSteps(s.steps);
    return steps ? { layout, steps } : { layout: 'content' };
  }
  if (layout === 'section') {
    return { layout, subtitle: _truncateSlideText(s.subtitle || '', SLIDE_LAYOUT_MAX_SUBTITLE_CHARS) };
  }
  if (layout === 'cards') {
    const cards = _sanitizeSlideCards(s.cards);
    return cards ? { layout, cards } : { layout: 'content' };
  }
  if (layout === 'stats') {
    const stats = _sanitizeSlideStats(s.stats);
    return stats ? { layout, stats } : { layout: 'content' };
  }
  if (layout === 'table') {
    const table = _sanitizeSlideTable(s.table);
    return table ? { layout, table } : { layout: 'content' };
  }
  if (layout === 'agenda') {
    const agenda = _sanitizeSlideAgenda(s.agenda);
    return agenda ? { layout, agenda } : { layout: 'content' };
  }
  if (layout === 'icon_row') {
    const icons = _sanitizeSlideIconRow(s.icons || s.items);
    return icons ? { layout, icons } : { layout: 'content' };
  }
  if (layout === 'comparison') {
    const comparison = _sanitizeSlideComparison(s);
    return comparison ? { layout, comparison } : { layout: 'content' };
  }
  if (layout === 'faq') {
    const faq = _sanitizeSlideFaq(s.items || s.faq);
    return faq ? { layout, faq } : { layout: 'content' };
  }
  if (layout === 'profiles') {
    const profiles = _sanitizeSlideProfiles(s.profiles || s.items);
    return profiles ? { layout, profiles } : { layout: 'content' };
  }
  if (layout === 'free') {
    // "blocks" is the correct/documented key, but fall back to a couple of
    // plausible near-misses so a slide isn't silently downgraded to
    // "content" just because a model named the array something else.
    const rawBlocks = Array.isArray(s.blocks) ? s.blocks
      : Array.isArray(s.content) ? s.content
      : Array.isArray(s.items) ? s.items
      : null;
    const blocks = _sanitizeSlideBlocks(rawBlocks);
    return blocks ? { layout, blocks } : { layout: 'content' };
  }
  if (layout === 'visual_focus' || layout === 'visual_left') {
    if (!(typeof s.visual === 'string' && s.visual.trim())) return { layout: 'content' };
    return { layout, caption: layout === 'visual_focus' ? _truncateSlideText(s.caption || '', SLIDE_LAYOUT_MAX_CAPTION_CHARS) : null };
  }
  return { layout };
}

function _applyLayoutFieldsToSlide(slide, ld) {
  slide.layout = ld.layout;
  slide.columns = ld.columns || null;
  slide.stat = ld.stat || null;
  slide.quote = ld.quote || null;
  slide.steps = ld.steps || null;
  slide.subtitle = ld.subtitle || null;
  slide.cards = ld.cards || null;
  slide.stats = ld.stats || null;
  slide.table = ld.table || null;
  slide.agenda = ld.agenda || null;
  slide.caption = ld.caption || null;
  slide.icons = ld.icons || null;
  slide.comparison = ld.comparison || null;
  slide.faq = ld.faq || null;
  slide.profiles = ld.profiles || null;
  slide.blocks = ld.blocks || null;
}

function _downgradeVisualLayoutIfNoVisual(slide) {
  if (slide && (slide.layout === 'visual_focus' || slide.layout === 'visual_left') && !slide.visualSVG) {
    slide.layout = 'content';
    slide.caption = null;
  }
}

// Auto-assigns bgIndex to any slide that doesn't have one, when the deck
// is in Varied auto-background mode. Title/section/quote get the boldest
// entry (index 0 by convention); everything else rotates through the
// remaining entries so consecutive content slides don't repeat.
function _assignVariedBgIndexes(slides, backgrounds) {
  if (!Array.isArray(slides) || !Array.isArray(backgrounds) || backgrounds.length < 2) return;
  let rotator = 1;
  const n = backgrounds.length;
  slides.forEach((s, i) => {
    if (Number.isInteger(s.bgIndex) && s.bgIndex >= 0 && s.bgIndex < n) return;
    if (s.bg) { s.bgIndex = null; return; } // explicit preset/custom wins; no auto index
    const isAccent = s.layout === 'title' || s.layout === 'section' || s.layout === 'quote';
    if (isAccent) { s.bgIndex = 0; return; }
    s.bgIndex = rotator % n;
    rotator++;
    if (rotator % n === 0) rotator++; // skip 0 (reserved for accent slides)
  });
}

function sanitizeSlideDeckJSON(raw, autoBgMode) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.slides)) return null;
  const deckTitle = _truncateSlideText(raw.deck_title || raw.title || '', SLIDE_DECK_MAX_TITLE_CHARS) || 'Untitled Deck';

  // Backgrounds:
  //   single mode → one `background` object applied to every slide as a
  //                 per-slide custom bg (existing behaviour)
  //   varied mode → `backgrounds` array stored on the deck, plus per-slide
  //                 bgIndex; falls back to treating `background` (single)
  //                 as a 1-element set if the AI sent the wrong shape.
  let singleCustomBg = null;
  let backgrounds = null;
  if (autoBgMode === 'single') {
    singleCustomBg = _sanitizeCustomBackgroundJSON(raw.background);
  } else if (autoBgMode === 'varied') {
    backgrounds = _sanitizeSlideBackgroundsArray(raw.backgrounds);
    if (!backgrounds) {
      const fallback = _sanitizeCustomBackgroundJSON(raw.background);
      if (fallback) backgrounds = [fallback];
    }
  }

  const slides = raw.slides.slice(0, SLIDE_DECK_MAX_SLIDES).map((s, i) => {
    if (!s || typeof s !== 'object') return null;
    let title = _truncateSlideText(s.title || '', SLIDE_DECK_MAX_TITLE_CHARS);
    const bulletsSrc = Array.isArray(s.bullets) ? s.bullets : [];
    const bullets = bulletsSrc
      .filter(b => typeof b === 'string' && b.trim())
      .slice(0, SLIDE_DECK_MAX_BULLETS_PER_SLIDE)
      .map(b => _truncateSlideText(b, SLIDE_DECK_MAX_BULLET_CHARS));
    const visualRaw = (typeof s.visual === 'string' && s.visual.trim()) ? s.visual.trim() : null;
    const requestedLayout = i === 0 ? 'title' : _sanitizeSlideLayout(s.layout);
    const layoutData = requestedLayout === 'title' ? { layout: 'title' } : _sanitizeSlideLayoutData(s, requestedLayout);
    if (!title && layoutData.blocks && layoutData.blocks[0] && layoutData.blocks[0].type === 'heading') {
      title = _truncateSlideText(layoutData.blocks[0].text || '', SLIDE_DECK_MAX_TITLE_CHARS);
    }
    // bgIndex only meaningful in varied mode; otherwise ignore whatever
    // the AI sent so a leftover index can't accidentally reference a
    // background that isn't there.
    let bgIndex = null;
    if (backgrounds && backgrounds.length) {
      const aiIdx = parseInt(s.bgIndex, 10);
      if (Number.isInteger(aiIdx) && aiIdx >= 0 && aiIdx < backgrounds.length) bgIndex = aiIdx;
    }
    return {
      title: title || 'Untitled Slide',
      bullets,
      visual: visualRaw,
      visualSVG: null,
      visualChartData: null,
      align: null,
      bg: singleCustomBg ? 'custom' : null,
      customBg: singleCustomBg,
      bgIndex,
      layout: layoutData.layout,
      columns: layoutData.columns || null,
      stat: layoutData.stat || null,
      quote: layoutData.quote || null,
      steps: layoutData.steps || null,
      subtitle: layoutData.subtitle || null,
      cards: layoutData.cards || null,
      stats: layoutData.stats || null,
      table: layoutData.table || null,
      agenda: layoutData.agenda || null,
      caption: layoutData.caption || null,
      elements: _sanitizeSlideElements(s.elements),
      icons: layoutData.icons || null,
      comparison: layoutData.comparison || null,
      faq: layoutData.faq || null,
      profiles: layoutData.profiles || null,
      blocks: layoutData.blocks || null
    };
  }).filter(Boolean);

  if (!slides.length) return null;
  if (backgrounds && backgrounds.length) _assignVariedBgIndexes(slides, backgrounds);
  // Theme: a preset id OR a full inline theme object (palette/fonts/radius/backgrounds/chart).
  const themeRef = (typeof sanitizeDeckThemeRef === 'function') ? sanitizeDeckThemeRef(raw.theme) : null;
  return { title: deckTitle, slides, backgrounds: backgrounds || null, theme: themeRef || null };
}

// ========================================================================
// IMAGE PLACEHOLDER — REPLACES DIAGRAMS (product decision: this app never
// generates diagrams anywhere, including Slides). Instead of hand-drawing
// or resolving a diagram, a slide's "visual" may carry
// <!--IMAGE_PLACEHOLDER:box:description--> or
// <!--IMAGE_PLACEHOLDER:circle:description-->, which this renders as a
// box- or circle-shaped placeholder frame with the description text
// wrapped inside it, so a real image can be dropped in by hand later.
// ========================================================================
function _imgPhEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Simple greedy word-wrap by character count — good enough for a
// placeholder caption, not meant to be typographically perfect.
function _imgPhWrapText(text, maxCharsPerLine, maxLines) {
  const words = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const test = cur ? cur + ' ' + w : w;
    if (test.length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = test;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  // Mark truncation if there's more text than fit.
  const consumed = lines.join(' ').length;
  if (consumed < String(text || '').trim().length && lines.length) {
    let last = lines[lines.length - 1];
    if (last.length > 3) last = last.slice(0, -3);
    lines[lines.length - 1] = last.replace(/[.,;:\s]+$/, '') + '…';
  }
  return lines;
}

function renderImagePlaceholderSVG(shape, description) {
  const W = 700, H = 400;
  const shapeId = (shape === 'circle') ? 'circle' : 'box';
  const desc = String(description == null ? '' : description).trim() || 'Image needed here';
  const lines = _imgPhWrapText(desc, 34, 6).map(_imgPhEsc);
  const lineHeight = 24;
  const textBlockH = lines.length * lineHeight;
  const cx = W / 2, cy = H / 2;

  const iconGroup = `
    <g transform="translate(${cx - 22}, ${cy - (textBlockH / 2) - 62})" opacity="0.55">
      <rect x="0" y="0" width="44" height="34" rx="4" fill="none" stroke="#94a3b8" stroke-width="2.5"/>
      <circle cx="11" cy="11" r="4.5" fill="none" stroke="#94a3b8" stroke-width="2.2"/>
      <path d="M 3,29 L 16,17 L 25,25 L 33,14 L 41,29 Z" fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-linejoin="round"/>
    </g>`;

  const label = `IMAGE PLACEHOLDER`;
  const labelY = cy - (textBlockH / 2) - 14;

  const textLines = lines.map((ln, i) =>
    `<text x="${cx}" y="${cy - (textBlockH / 2) + (i * lineHeight) + lineHeight - 6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#64748b">${ln}</text>`
  ).join('\n      ');

  const frameShape = shapeId === 'circle'
    ? `<circle cx="${cx}" cy="${cy}" r="${Math.min(W, H) / 2 - 18}" fill="#f8fafc" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="10 8"/>`
    : `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="16" fill="#f8fafc" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="10 8"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${frameShape}
    ${iconGroup}
    <text x="${cx}" y="${labelY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" letter-spacing="2" font-weight="bold" fill="#94a3b8" opacity="0.7">${label}</text>
    ${textLines}
  </svg>`;
}

function injectImagePlaceholders(html) {
  if (!html || typeof html !== 'string' || html.indexOf('IMAGE_PLACEHOLDER:') === -1) return html;
  return html.replace(/<!--\s*IMAGE_PLACEHOLDER:(box|circle):([\s\S]*?)-->/g, function(match, shape, description) {
    try {
      return renderImagePlaceholderSVG(shape, description);
    } catch (e) {
      console.warn('[SlideStudio] image placeholder render failed:', e);
      return match;
    }
  });
}

// ===== VISUAL RESOLUTION (placeholders -> real inline SVG) =====
function resolveSlideVisualSVG(visualRaw) {
  if (!visualRaw) return null;
  let out = visualRaw;
  try {
    if (out.indexOf('CHART:') !== -1 && typeof injectChartTemplates === 'function') out = injectChartTemplates(out);
    if (out.indexOf('DIAGRAM_TEMPLATE:') !== -1 && typeof injectDiagramTemplates === 'function') out = injectDiagramTemplates(out);
    if (out.indexOf('IMAGE_PLACEHOLDER:') !== -1) out = injectImagePlaceholders(out);
    if (out.indexOf('ILLUSTRATION:') !== -1 && typeof injectIllustrationTemplates === 'function') out = injectIllustrationTemplates(out);
    if (out.indexOf('ELEMENT:') !== -1 && typeof injectElementTemplates === 'function') out = injectElementTemplates(out);
  } catch (e) {
    console.warn('[SlideStudio] visual placeholder resolution failed:', e);
    return null;
  }
  out = String(out || '').trim();
  if (!/^<svg[\s>]/i.test(out) && /<!--\s*ELEMENT:/i.test(visualRaw)) {
    // Wrap a bare element placeholder in a 1:1 canvas so a single
    // element-library icon doesn't balloon to cover a visual_focus slot.
    out = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
  }
  if (!/^<svg[\s>]/i.test(out)) return null;
  if (typeof sanitizeHTML === 'function') {
    try { out = sanitizeHTML(out); } catch (e) { /* keep unsanitized fallback */ }
  }
  return /^<svg[\s>]/i.test(out.trim()) ? out.trim() : null;
}

// ===== NATIVE CHART DATA =====
const SLIDE_NATIVE_CHART_TYPES = ['bar', 'line', 'pie', 'donut'];

function _parseSlideChartData(visualRaw) {
  if (!visualRaw || typeof visualRaw !== 'string') return null;
  const m = visualRaw.trim().match(/^<!--\s*CHART:([a-zA-Z]+):([\s\S]*?)-->$/);
  if (!m) return null;
  const type = m[1].trim().toLowerCase();
  if (SLIDE_NATIVE_CHART_TYPES.indexOf(type) === -1) return null;
  if (typeof window.parseChartParamString !== 'function') return null;
  try {
    const params = window.parseChartParamString(m[2]);
    if (!params || !Array.isArray(params.values) || !params.values.length) return null;
    return { type, params };
  } catch (e) {
    console.warn('[SlideStudio] chart data parse failed:', e);
    return null;
  }
}

function resolveAllSlideVisuals(deck) {
  if (!deck || !Array.isArray(deck.slides)) return deck;
  deck.slides.forEach(slide => {
    slide.visualSVG = resolveSlideVisualSVG(slide.visual);
    slide.visualChartData = _parseSlideChartData(slide.visual);
    if (Array.isArray(slide.blocks)) _resolveBlockVisuals(slide.blocks);
    _downgradeVisualLayoutIfNoVisual(slide);
  });
  return deck;
}

// ===== GENERATION =====
// Small, fast, text-only system prompt used ONLY to decide whether to ask a
// clarifying question before building a slide deck — deliberately separate
// from buildSlideDeckRules() (the full, very large deck-generation prompt)
// so this decision call stays cheap and quick, under the ordinary chat
// "typing" bubble, and so the "Generating Slides..." overlay is never shown
// before we actually know a real deck is being built (see the two-call flow
// note in generateSlideDeckDirectMode below).
function buildSlideDeckClarifyDecisionPrompt(outputLanguage) {
  const categoryList = SLIDE_CONTENT_CATEGORIES.map((c, i) => `${i + 1}. ${c.id} — subject looks like: ${c.match}`).join('\n');
  return (
    `You are the dedicated SLIDE DECK generator for AI PDF Studio's "Create Slides" feature, currently deciding ONLY whether to ask a clarifying question before building anything. Do NOT design or generate any slides in this response.\n` +
    `Language: ${outputLanguage}.\n` +
    `STEP 1 — CONTENT CATEGORY CHECK (always do this FIRST): every deck is classified into exactly ONE of these 4 fixed content categories, which decides the whole deck's depth, layout mix and background mood:\n${categoryList}\n` +
    `If the request could genuinely fit MORE THAN ONE of these 4 categories — the subject/phrasing does not make it obvious which style of deck is wanted (e.g. a school subject could be quick class notes OR could just as well be a general/creative deck; a business-sounding word could be an investor pitch OR an internal office report) — respond with ONLY this JSON object and NOTHING else: {"action":"clarify_category","question":"one short question, in ${outputLanguage}, asking which style/category of deck they want"}. Do NOT invent your own "options" list for this case — the app always shows the exact 4 fixed category choices itself, plus a "type my own" option. Only skip this step when the category is already obvious from the request.\n` +
    `STEP 2 — only reached once the category is already obvious (or was just resolved): THEN, and only then, consider an ordinary clarifying question. DEFAULT TO ASKING: asking is your default action, not generating. Ask ONE short clarifying question with tick-style options whenever audience/level, depth or length, tone/style, scope, or which angle/sub-topics to emphasize could reasonably go more than one way — this is true for almost every request, including short or single-line topics (e.g. a school topic could be a quick class-note deck OR a full exam-prep deck; a business topic could be an investor pitch OR an internal team update). Only skip the question on the rare request that already pins ALL of these down explicitly enough that no other reasonable deck could result; treat that as a high bar, not a low one. When genuinely unsure whether to ask, ask.\n` +
    `Respond with ONLY one of these THREE JSON objects, nothing else:\n` +
    `1. {"action":"clarify_category","question":"..."} — see STEP 1 above. Takes priority over #2.\n` +
    `2. {"action":"clarify","question":"one short, specific question","options":["short option A","short option B","short option C"]} ("options" is 2 to 5 short, concrete, genuinely different phrases, a few words each, NOT full sentences — do NOT include a "write my own"/"other" option, the app adds that automatically).\n` +
    `3. {"action":"proceed"} — only once the request is already fully specific (category obvious AND no other ambiguity).\n` +
    `Never ask more than one question total (never both #1 and #2 in the same turn). If the user's request already answers the ambiguity (explicit category, explicit length, explicit audience, explicit tone, or this is a follow-up message that already contains a prior clarification's answer), return {"action":"proceed"}.`
  );
}

// ========================================================================
// OUTLINE-FIRST FLOW (Gamma-style)
// ========================================================================
// Instead of asking the AI for the whole deck in one shot, the flow is:
//   STEP 1  _generateSlideOutline()      → ONLY slide titles + key points +
//                                          layout per slide (cheap, fast).
//                                          Shown in chat (app.js:
//                                          appendSlideOutlineMessageToUI).
//   STEP 2  _continueSlideOutlineFlow()  → every later message while an
//                                          outline is pending is treated as
//                                          a change request ("drop slide 3",
//                                          "add an example to slide 5") or
//                                          as approval. The AI returns the
//                                          FULL updated outline each time.
//   STEP 3  _buildSlideDeckFromOutline() → the real deck. Long outlines are
//                                          written in batches so slide 30
//                                          gets the same attention as
//                                          slide 3 (one-shot 30-slide
//                                          generations degrade at the end).
// State lives in APP_STATE.pendingOutline (cleared on success, on a switch
// to another intent, or on a session switch):
//   { sessionId, originalPrompt, sourceContext, outputLanguage, lengthHint,
//     outline: { deck_title, slides: [{layout, title, points[]}] },
//     approveNow }   // approveNow is set by the "Generate deck" button so
//                    // approval is deterministic and costs no AI call.
const SLIDE_OUTLINE_MAX_SLIDES = 40;
const SLIDE_OUTLINE_MAX_POINTS = 6;
const SLIDE_OUTLINE_POINT_CHARS = 160;
// Outlines up to this many slides are built in ONE call (as before). Longer
// ones are split into batches of ~SLIDE_BUILD_BATCH_SIZE slides.
const SLIDE_BUILD_SINGLE_CALL_MAX = 12;
const SLIDE_BUILD_BATCH_SIZE = 8;
const SLIDE_BUILD_MIN_LAST_BATCH = 4;

function _slideIsBengali(text, lang) {
  return /[\u0980-\u09FF]/.test(String(text || '')) || /bengali|bangla|^bn/i.test(String(lang || ''));
}

// The pending outline is remembered PER TAB/SESSION (stored on the tab object
// as well as APP_STATE), so it survives tab switches and is never confused with
// another chat's outline. Previously only a global APP_STATE value was kept and
// the "Generate deck" press was treated as a brand-new, topic-less request.
function _slideOutlineTab() {
  try {
    if (typeof TAB_MANAGER === 'undefined' || !Array.isArray(TAB_MANAGER.tabs)) return null;
    return TAB_MANAGER.tabs.find(t => t.id === TAB_MANAGER.activeId) || null;
  } catch (_) { return null; }
}

function _setPendingSlideOutline(state) {
  APP_STATE.pendingOutline = state || null;
  const tab = _slideOutlineTab();
  if (!tab) return;
  if (state) { state.tabId = tab.id; tab.pendingOutline = state; }
  else { delete tab.pendingOutline; }
  try { if (typeof TAB_MANAGER._persist === 'function') TAB_MANAGER._persist(); } catch (e) { console.warn('[SlideStudio] outline persist failed:', e); }
}

function _getPendingSlideOutline() {
  const tab = _slideOutlineTab();
  let p = (tab && tab.pendingOutline && tab.pendingOutline.outline) ? tab.pendingOutline : null;
  if (!p) {
    const g = (typeof APP_STATE !== 'undefined') ? APP_STATE.pendingOutline : null;
    if (g && g.outline && (!tab || !g.tabId || g.tabId === tab.id)) p = g;
  }
  if (p) APP_STATE.pendingOutline = p;
  return p;
}

function buildSlideOutlinePrompt(outputLanguage, lengthHint, varietyBlock) {
  return (
    `You are the dedicated SLIDE OUTLINE planner for AI PDF Studio's "Create Slides" feature. Plan the deck's STRUCTURE ONLY — do NOT write the final slide content. The user will review this outline in chat and may ask for changes before the real deck is built.\n` +
    `Return ONLY a single JSON object — no markdown fences, no commentary outside the JSON.\n` +
    `Language: ${outputLanguage}. Write every title and point in that language. If it uses a complex script (Bengali, Devanagari, Arabic, etc.), take extra care with correct characters and combining marks; prefer simpler words you are sure of.\n` +
    _slideContentCategoryRules() +
    `JSON SHAPE (exact keys): {"deck_title":"...","slides":[{"layout":"title","title":"...","points":["..."]},{"layout":"content","title":"...","points":["...","..."]}]}\n` +
    `- "layout": one of ${SLIDE_LAYOUTS.join(', ')}. Let each slide's content decide its form and layout (a comparison, a sequence, a number, a statement, parallel ideas, a visual-first moment, common questions, or a plain list) — structure is born from the subject, not from a formula, so do NOT add a form the material does not have. Plain bullet-list slides (\"content\") may be at most about 25-30% of the deck, and never put two consecutive slides in the same structure.\n` +
    `- "title": the slide's headline (short).\n` +
    `- "points": 2-5 very short phrases (about 12 words max each) naming WHAT that slide will cover. This is a plan, not slide text. For "big_stat"/"stats"/"quote" layouts, describe the KIND of content (e.g. "key statistic on market growth") — never invent numbers or quotations here. Use an empty array for the title slide and for "section" slides.\n` +
    `- The FIRST slide MUST be {"layout":"title",...} (deck title/topic only, empty points).\n` +
    `- Do not add a closing "Thank you" slide unless the user explicitly asked for one.\n` +
    _slideDeckLengthRule(lengthHint) +
    `- Hard cap: at most ${SLIDE_OUTLINE_MAX_SLIDES} slides.\n` +
    `- If the user attached source material, base the outline on it and cover its real structure.` +
    (varietyBlock ? '\n' + varietyBlock : '')
  );
}

function buildSlideOutlineRevisePrompt(outputLanguage) {
  return (
    `You are the SLIDE OUTLINE editor for AI PDF Studio's "Create Slides" feature. The user is looking at a numbered slide outline (not yet built into a deck) and has sent a chat message. Decide what it means and respond with ONLY one JSON object, no fences:\n` +
    `1. {"action":"revise","note":"one short sentence, in ${outputLanguage}, saying what you changed","outline":{"deck_title":"...","slides":[{"layout":"...","title":"...","points":["..."]}]}} — the message asks for a change to the outline (remove / add / reorder / rename / expand / merge / split slides, add or change points, change a layout, change depth or length). "outline" MUST be the COMPLETE updated outline.\n` +
    `2. {"action":"approve"} — the user is happy and tells you to go ahead and build the deck (e.g. "looks good", "ok generate it", "ঠিক আছে, বানাও").\n` +
    `3. {"action":"restart"} — the message is clearly a NEW, unrelated deck request, not a comment on this outline.\n` +
    `RULES FOR "revise":\n` +
    `- Slide numbers in the user's message are the 1-based numbers shown in the CURRENT OUTLINE (field "n"). Resolve them against that numbering BEFORE applying any change, even when several changes are requested at once ("remove 3 and add an example to 5" → 5 means the ORIGINAL slide 5).\n` +
    `- Apply EXACTLY what was asked and leave everything else untouched (same order, titles, layouts, points). Do not "improve" other slides.\n` +
    `- "add an example to slide N" → add a point (or two) about the example to that slide; do NOT create a new slide unless asked. "add another slide" without a position → append it at the end of the main content (before any closing/summary slide); with a topic, place it where it fits logically.\n` +
    `- Keep slide 1 as the "title" layout. Never return a slide with an empty title. Keep every slide's "layout" one of: ${SLIDE_LAYOUTS.join(', ')}. Return the same keys as the input (layout, title, points) — do not return "n".\n` +
    `- If the message refers to a slide number that does not exist, or is too ambiguous to apply, return "revise" with the outline UNCHANGED and explain in "note".\n` +
    `- Write in ${outputLanguage}. Do not invent statistics or quotations.`
  );
}

function _outlineForPrompt(outline, forAI) {
  const slides = (outline && outline.slides || []).map((s, i) => ({ n: i + 1, layout: s.layout, title: s.title, points: s.points }));
  return JSON.stringify({ deck_title: outline && outline.deck_title, slides }, null, forAI ? 0 : 2);
}

function _sanitizeSlideOutline(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.slides)) return null;
  const slides = raw.slides.slice(0, SLIDE_OUTLINE_MAX_SLIDES).map(s => {
    if (!s || typeof s !== 'object') return null;
    const title = _truncateSlideText(s.title || '', SLIDE_DECK_MAX_TITLE_CHARS);
    if (!title) return null;
    const points = (Array.isArray(s.points) ? s.points : [])
      .filter(p => typeof p === 'string' && p.trim())
      .slice(0, SLIDE_OUTLINE_MAX_POINTS)
      .map(p => _truncateSlideText(p, SLIDE_OUTLINE_POINT_CHARS));
    return { layout: _sanitizeSlideLayout(s.layout), title, points };
  }).filter(Boolean);
  if (!slides.length) return null;
  slides[0].layout = 'title';
  slides[0].points = [];
  return {
    deck_title: _truncateSlideText(raw.deck_title || raw.title || slides[0].title, SLIDE_DECK_MAX_TITLE_CHARS) || slides[0].title,
    slides
  };
}

// STEP 1 — outline only. Returns a sanitized outline, or null if the AI's
// response was unusable (the caller then falls back to one-shot generation).
async function _generateSlideOutline(promptText, fileContextString, outputLanguage, lengthHint, modelsUsedSet, activeCfg, artDirectionId) {
  const userPrompt =
    `USER REQUEST:\n${promptText}\n\n` +
    (fileContextString ? `ATTACHED SOURCE CONTEXT:\n${fileContextString}\n\n` : '') +
    `Plan the slide outline now. Return the JSON object only.`;
  const result = await callAIAPI(
    [{ role: 'system', content: buildSlideOutlinePrompt(outputLanguage, lengthHint, buildDeckVarietyBlock(_slideArtDirectionById(artDirectionId), _deckFpLoad(), null)) }, { role: 'user', content: userPrompt }],
    { forceJson: true, modelsUsedSet, modelConfig: _generationLockedModelConfig || activeCfg, maxTokens: undefined, temperature: _slideDesignTemp() }
  );
  if (result && result.modelConfig) _generationLockedModelConfig = result.modelConfig;
  let parsed = safeParseAIJson(result.content, null);
  if (!parsed) parsed = attemptRepairAndParse(result.content);
  return _sanitizeSlideOutline(parsed);
}

// STEP 2 — a message arrived while an outline is pending. Returns either
// { restart: true } (the message is a brand-new request) or
// { result } where result is what generateSlideDeckDirectMode() should
// return: an outline result (revised / unchanged-with-note) or the built deck.
async function _continueSlideOutlineFlow(pending, userMessage, env) {
  const isBn = _slideIsBengali(pending.originalPrompt + ' ' + userMessage, pending.outputLanguage);

  // "Generate deck" button — deterministic approval, no AI call.
  if (pending.approveNow) {
    pending.approveNow = false;
    return { result: await _buildSlideDeckFromOutline(pending, env) };
  }

  const result = await callAIAPI(
    [
      { role: 'system', content: buildSlideOutlineRevisePrompt(pending.outputLanguage) },
      { role: 'user', content: `CURRENT OUTLINE:\n${_outlineForPrompt(pending.outline, true)}\n\nUSER MESSAGE:\n${userMessage}` }
    ],
    { forceJson: true, modelsUsedSet: env.modelsUsedSet, modelConfig: _generationLockedModelConfig || env.activeCfg, maxTokens: undefined, temperature: _slideContentTemp() }
  );
  if (result && result.modelConfig) _generationLockedModelConfig = result.modelConfig;
  let j = safeParseAIJson(result.content, null);
  if (!j) j = attemptRepairAndParse(result.content);

  if (j && j.action === 'restart') return { restart: true };
  if (j && j.action === 'approve') return { result: await _buildSlideDeckFromOutline(pending, env) };
  if (j && j.action === 'revise') {
    const revised = _sanitizeSlideOutline(j.outline);
    if (revised) {
      pending.outline = revised;
      _setPendingSlideOutline(pending);
      const note = (typeof j.note === 'string' && j.note.trim()) ? j.note.trim() : (isBn ? 'আউটলাইন আপডেট করা হয়েছে।' : 'Outline updated.');
      return { result: { ok: false, outline: revised, outlineNote: note, isBn } };
    }
  }
  // Unparseable / unusable response: keep the current outline untouched so
  // nothing the user already approved of is lost, and let them rephrase.
  return {
    result: {
      ok: false,
      outline: pending.outline,
      isBn,
      outlineNote: isBn
        ? '⚠️ পরিবর্তনটি প্রয়োগ করা যায়নি, আউটলাইন আগের মতোই আছে। অন্যভাবে লিখে আবার বলুন।'
        : '⚠️ I couldn\'t apply that change, so the outline is unchanged. Try rephrasing it.'
    }
  };
}

function _outlineBatchRanges(total, hasOutline) {
  if (!hasOutline || total <= SLIDE_BUILD_SINGLE_CALL_MAX) return [[0, total]];
  const ranges = [];
  for (let a = 0; a < total; a += SLIDE_BUILD_BATCH_SIZE) ranges.push([a, Math.min(total, a + SLIDE_BUILD_BATCH_SIZE)]);
  // Don't leave a tiny last batch — fold it into the previous one.
  if (ranges.length > 1) {
    const last = ranges[ranges.length - 1];
    if (last[1] - last[0] < SLIDE_BUILD_MIN_LAST_BATCH) {
      ranges.pop();
      ranges[ranges.length - 1][1] = last[1];
    }
  }
  return ranges;
}

// Extra instructions appended to buildSlideDeckRules() when a deck is built
// from an approved outline (single call or one batch of several).
function _outlineBuildInstructions(outline, range, rangeIdx, rangeCount, ctx) {
  const total = outline.slides.length;
  const [a, b] = range;
  let t =
    `\n=== APPROVED OUTLINE — FOLLOW IT (OVERRIDES ANY SLIDE-COUNT / STRUCTURE GUIDANCE ABOVE) ===\n` +
    `The user reviewed and approved the outline in the user message. Build exactly those slides: same order, same topics, cover every listed point. Use each slide's suggested "layout" unless it genuinely cannot carry that content (then pick the closest one that can). Do not add, drop, merge or reorder slides. Do not ask a clarifying question.\n`;
  if (rangeCount <= 1) return t;
  t += `This deck is written in ${rangeCount} parts to keep quality high. THIS CALL: generate ONLY slides ${a + 1} to ${b} of ${total} — nothing before or after.\n`;
  if (rangeIdx === 0) {
    t += `Part 1 of ${rangeCount}: include "deck_title"${ctx.autoBgMode !== 'off' ? ' and the background/backgrounds key exactly as described above (they apply to the WHOLE deck, so design them for all ' + total + ' slides)' : ''}. Slide 1 is the title slide.\n`;
  } else {
    t +=
      `Part ${rangeIdx + 1} of ${rangeCount} (continuation): the deck title slide and the background design already exist. Return {"action":"generate_slides","slides":[...]} with ONLY slides ${a + 1}-${b}; do NOT include a title slide, "deck_title", "background" or "backgrounds" (the "FIRST slide MUST use title layout" rule does NOT apply to this part).\n`;
    if (ctx.autoBgMode === 'varied' && ctx.bgLabels) {
      t += `Backgrounds already designed (you may set "bgIndex" on slides to reuse them): ${ctx.bgLabels}.\n`;
    }
    if (ctx.prevLayouts && ctx.prevLayouts.length) {
      t += `Layout continuity: the previous slides ended with layouts [${ctx.prevLayouts.join(', ')}] — keep the "no two consecutive slides with the same structure" rule across the boundary.\n`;
    }
    t += `Keep the same depth, tone and level of detail as the earlier slides.\n`;
  }
  return t;
}

// STEP 3 — build the real deck. `pending.outline` may be null (fallback when
// the outline call failed): then it's a plain one-shot build, as before.
async function _buildSlideDeckFromOutline(pending, env) {
  const outputLanguage = pending.outputLanguage;
  const lengthHint = pending.lengthHint;
  const autoBgMode = typeof getSlideAutoBackgroundMode === 'function' ? getSlideAutoBackgroundMode() : 'off';
  const outline = pending.outline;
  const isBn = _slideIsBengali(pending.originalPrompt, outputLanguage);
  const total = outline ? outline.slides.length : 0;
  const ranges = _outlineBatchRanges(total, !!outline);

  if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
    ProgressUI.show('Generating Slides...', outline ? 'Building the deck from your approved outline…' : 'AI is planning the deck…');
    if (ProgressUI.startAutoEstimate) ProgressUI.startAutoEstimate(APP_CONFIG.SINGLE_SHOT_ESTIMATED_SECONDS * ranges.length);
  }

  try {
    // DESIGN PASS (creative, high temperature) → CONTENT PASS (precise, low temperature)
    const artDir = _slideArtDirectionById(pending.artDirectionId) || pickSlideArtDirection();
    pending.artDirectionId = artDir.id;
    const fingerprints = _deckFpLoad();
    let designBrief = null;
    if (typeof ProgressUI !== 'undefined' && ProgressUI.setStage) ProgressUI.setStage('Designing the look…', 6, 20, { indeterminate: true });
    try {
      designBrief = await _generateDeckDesignBrief(pending, artDir, fingerprints, autoBgMode, env);
    } catch (briefErr) {
      if (briefErr && briefErr.noModelConfigured) throw briefErr;
      console.warn('[Slide Studio] design pass failed, building without a design brief:', briefErr);
    }
    const varietyBlock = buildDeckVarietyBlock(artDir, fingerprints, designBrief);
    const systemBase = buildSlideDeckRules(outputLanguage, lengthHint, autoBgMode, varietyBlock);
    const mergedSlides = [];
    let deckRaw = null;

    for (let ri = 0; ri < ranges.length; ri++) {
      const range = ranges[ri];
      if (typeof ProgressUI !== 'undefined' && ProgressUI.setStage) {
        const from = 20 + Math.round((ri / ranges.length) * 55);
        const to = 20 + Math.round(((ri + 1) / ranges.length) * 55);
        const label = ranges.length > 1
          ? `Writing slides ${range[0] + 1}–${range[1]} of ${total}…`
          : 'AI slide generation in progress…';
        ProgressUI.setStage(label, from, to, { indeterminate: true });
      }

      const ctx = {
        autoBgMode,
        bgLabels: (deckRaw && Array.isArray(deckRaw.backgrounds))
          ? deckRaw.backgrounds.map((bg, i) => `${i} = ${(bg && bg.label) || 'background'}${bg && bg.dark ? ' (dark)' : ''}`).join('; ')
          : '',
        prevLayouts: mergedSlides.slice(-3).map(s => s && s.layout).filter(Boolean)
      };
      const system = outline ? systemBase + _outlineBuildInstructions(outline, range, ri, ranges.length, ctx) : systemBase;
      const userMsg =
        `USER REQUEST:\n${pending.originalPrompt}\n\n` +
        (pending.sourceContext ? `ATTACHED SOURCE CONTEXT:\n${pending.sourceContext}\n\n` : '') +
        (outline
          ? `APPROVED OUTLINE (deck title: "${outline.deck_title}") — slide "n" is its position in the deck:\n${_outlineForPrompt(outline, true)}\n\n` +
            (ranges.length > 1
              ? `Generate ONLY slides ${range[0] + 1} to ${range[1]} of ${total} now. Return the JSON object only.`
              : `Generate the complete slide deck from this outline now. Return the JSON object only.`)
          : `Generate the complete slide deck now. Return the JSON object only.`);

      const result = await callAIAPI(
        [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
        { forceJson: true, modelsUsedSet: env.modelsUsedSet, modelConfig: _generationLockedModelConfig || env.activeCfg, maxTokens: undefined, temperature: _slideContentTemp() }
      );
      if (result && result.modelConfig) _generationLockedModelConfig = result.modelConfig;

      let parsed = safeParseAIJson(result.content, null);
      if (!parsed) parsed = attemptRepairAndParse(result.content);
      if (!parsed || !Array.isArray(parsed.slides) || !parsed.slides.length) {
        throw new Error(ranges.length > 1
          ? `The AI did not return usable slides for part ${ri + 1} of ${ranges.length}.`
          : 'The AI did not return a usable slide deck.');
      }
      if (ri === 0) {
        deckRaw = parsed;
        // The design pass is authoritative for backgrounds (the low-temperature
        // content pass was told to copy them; enforce it in code).
        if (designBrief && autoBgMode === 'single' && designBrief.background) deckRaw.background = designBrief.background;
        if (designBrief && autoBgMode === 'varied' && designBrief.backgrounds) deckRaw.backgrounds = designBrief.backgrounds;
      }
      parsed.slides.forEach(s => mergedSlides.push(s));
    }

    if (typeof ProgressUI !== 'undefined' && ProgressUI.setStage) ProgressUI.setStage('Building slides…', 75, 92);

    deckRaw.slides = mergedSlides;
    if (outline && !deckRaw.deck_title) deckRaw.deck_title = outline.deck_title;
    const deck = sanitizeSlideDeckJSON(deckRaw, autoBgMode);
    if (!deck) throw new Error('The AI did not return a usable slide deck.');
    try { recordDeckFingerprint(deck, artDir.id, designBrief); } catch (_) {}

    resolveAllSlideVisuals(deck);

    _setPendingSlideOutline(null);
    APP_STATE.slideDeck = deck;
    _slideDeckCurrentIndex = 0;
    if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);

    renderSlideDeckPreview(deck);
    if (typeof switchPreviewTab === 'function') switchPreviewTab('slides');
    if (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout() && typeof setMobileView === 'function') setMobileView('editor');

    if (typeof ProgressUI !== 'undefined') {
      ProgressUI.finish();
      setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 400);
    }
    return { ok: true, deck };
  } catch (e) {
    console.error('[Slide Studio] build from outline failed:', e);
    if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
    if (e && e.noModelConfigured) throw e; // outer catch shows the "no model" message
    // Keep the approved outline pending so the user can just press
    // "Generate deck" again instead of starting over.
    if (outline) {
      const msg = (e && e.message) ? String(e.message) : 'Unknown error.';
      return {
        ok: false,
        outline,
        isBn,
        outlineNote: isBn
          ? `⚠️ ডেক তৈরি ব্যর্থ হয়েছে: ${msg} আউটলাইন সংরক্ষিত আছে — আবার "ডেক বানাও" চাপুন।`
          : `⚠️ Deck generation failed: ${msg} Your outline is still saved — press "Generate deck" to retry.`
      };
    }
    throw e;
  }
}

async function generateSlideDeckDirectMode(promptText, fileContextString, modelsUsedSet, intentPayload) {
  const outputLanguage = (intentPayload && intentPayload.language) || (typeof detectOutputLanguage === 'function' ? detectOutputLanguage(promptText) : 'English');
  const lengthHint = (intentPayload && (intentPayload.length === 'long_slides' || intentPayload.length === 'short_slides')) ? intentPayload.length : null;
  // Start every request from the model the user currently has selected. The
  // lock is only for keeping one multi-call build on the same model; a stale
  // lock from an earlier turn made the app ignore model switches.
  if (typeof _generationLockedModelConfig !== 'undefined') _generationLockedModelConfig = null;
  const activeCfg = undefined;

  const userPrompt =
    `USER REQUEST:\n${promptText}\n\n` +
    (fileContextString ? `ATTACHED SOURCE CONTEXT:\n${fileContextString}\n\n` : '') +
    `Generate the complete slide deck now. Return the JSON object only.`;

  // THREE-STEP FLOW — decision → outline → deck (see the OUTLINE-FIRST FLOW
  // note above). The original small DECISION call (clarify vs proceed) still
  // runs first, under the ordinary chat typing bubble, with the overlay NOT
  // shown yet. Once it says "proceed" we make a cheap OUTLINE call and hand
  // the outline back to the chat for review; the overlay only appears when
  // the (slow) deck build actually starts, in _buildSlideDeckFromOutline().
  try {
    // A pending outline means this message is feedback on it (or approval).
    const pending = _getPendingSlideOutline();
    if (pending) {
      const cont = await _continueSlideOutlineFlow(pending, promptText, { modelsUsedSet, activeCfg });
      if (!cont.restart) return cont.result;
      // The user started a brand-new request instead — drop the old outline
      // and handle this message as a fresh one below.
      _setPendingSlideOutline(null);
    }

    const _decisionCallStartedAt = Date.now();
    const decisionResult = await callAIAPI(
      [{ role: 'system', content: buildSlideDeckClarifyDecisionPrompt(outputLanguage) }, { role: 'user', content: userPrompt }],
      { forceJson: true, modelsUsedSet, modelConfig: activeCfg, maxTokens: APP_CONFIG.ROUTER_MAX_OUTPUT_TOKENS }
    );
    if (decisionResult && decisionResult.modelConfig) _generationLockedModelConfig = decisionResult.modelConfig;
    if (typeof ensureMinimumThinkingDelay === 'function') await ensureMinimumThinkingDelay(_decisionCallStartedAt);

    let decisionJson = safeParseAIJson(decisionResult.content, null);
    if (!decisionJson) decisionJson = attemptRepairAndParse(decisionResult.content);

    // Category ambiguity takes priority — the app renders this as a FIXED
    // set of 4 choices (never AI-authored option text) plus a "type my own"
    // option, per SLIDE_CATEGORY_DISPLAY_LABELS above.
    if (decisionJson && decisionJson.action === 'clarify_category' && decisionJson.question) {
      const isBn = /[\u0980-\u09FF]/.test(String(promptText)) || /bengali|bangla|bn/i.test(String(outputLanguage));
      const categories = SLIDE_CONTENT_CATEGORIES.map(c => {
        const disp = SLIDE_CATEGORY_DISPLAY_LABELS[c.id] || { en: c.id, bn: c.id };
        return { id: c.id, label: isBn ? disp.bn : disp.en };
      });
      return {
        ok: false,
        clarifyCategory: {
          question: String(decisionJson.question).trim(),
          categories
        }
      };
    }
    if (decisionJson && decisionJson.action === 'clarify' && decisionJson.question) {
      return {
        ok: false,
        clarify: {
          question: String(decisionJson.question).trim(),
          options: Array.isArray(decisionJson.options) ? decisionJson.options.filter(o => typeof o === 'string' && o.trim()).slice(0, 5).map(o => o.trim()) : []
        }
      };
    }
    // 'proceed', or a malformed/unparseable decision response — either way,
    // move on to the outline rather than leaving the user stuck.

    const artDir = pickSlideArtDirection();
    let outline = null;
    try {
      outline = await _generateSlideOutline(promptText, fileContextString, outputLanguage, lengthHint, modelsUsedSet, activeCfg, artDir.id);
    } catch (outlineErr) {
      if (outlineErr && outlineErr.noModelConfigured) throw outlineErr;
      console.warn('[Slide Studio] outline step failed, falling back to one-shot generation:', outlineErr);
    }

    const pendingState = {
      sessionId: APP_STATE.activeSessionId,
      originalPrompt: promptText,
      sourceContext: fileContextString || '',
      outputLanguage,
      lengthHint,
      outline,
      artDirectionId: artDir.id,
      approveNow: false
    };

    if (!outline) {
      // Fallback: the outline could not be produced — build the deck in one
      // shot exactly like the pre-outline flow, so the user is never stuck.
      return await _buildSlideDeckFromOutline(pendingState, { modelsUsedSet, activeCfg });
    }

    _setPendingSlideOutline(pendingState);
    return { ok: false, outline, isBn: _slideIsBengali(promptText, outputLanguage) };
  } catch (e) {
    console.error('[Slide Studio] generation failed:', e);
    const errorMsg = (e && e.message) ? String(e.message) : 'Unknown error.';
    if (e && e.noModelConfigured) {
      if (typeof appendChatMessageToUI === 'function') appendChatMessageToUI('error', '⚠️ No AI model configured. Please click the "AI Models" button in the top bar, add a model, and try again.');
    } else {
      if (typeof appendChatMessageToUI === 'function') appendChatMessageToUI('error', `⚠️ Slide generation failed: ${errorMsg}`);
      if (typeof displayToastNotification === 'function') displayToastNotification(`Error: ${errorMsg}`);
    }
    if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
    return { ok: false, message: errorMsg };
  }
}

// ============================================================
// SPECIAL TEXT COMMAND: "copy" (Slides variant)
// ============================================================
// Mirrors handleCopyStyleCommand() in app.js, but produces a slide deck
// instead of a document: takes the attached file(s) and restyles ALL of
// their content into slides — nothing summarized, added, or omitted. Called
// from app.js's handleCopyStyleCommand() when the @Create Slides chip is the
// active one at the moment "copy" is typed. attachedEntries/loadingElement/
// sendBtn/inputField are passed in from there — this function owns the rest
// of the flow (the actual AI call, the deck being applied, and cleanup).
async function handleCopyToSlidesCommand(attachedEntries, loadingElement, sendBtn, inputField) {
  const modelsUsed = new Set();
  const autoBgMode = typeof getSlideAutoBackgroundMode === 'function' ? getSlideAutoBackgroundMode() : 'off';

  try {
    if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
      ProgressUI.show('Copying & restyling…', 'Turning the attached file content into slides — nothing added or removed.');
      ProgressUI.setStage('AI building slides…', 8, 78, { indeterminate: true });
    }

    const sourceBlocks = attachedEntries.map(([, fileData], i) => {
      const cleaned = typeof cleanAttachmentSourceForAI === 'function' ? cleanAttachmentSourceForAI(fileData.content) : fileData.content;
      const name = String(fileData.name || `file ${i + 1}`).replace(/[\r\n]+/g, ' ').trim();
      return `\n[SOURCE FILE ${i + 1}: ${name}]\n${cleaned}\nEND SOURCE FILE ${i + 1}\n`;
    });
    const joinedSource = sourceBlocks.join('\n');
    const outputLanguage = typeof detectOutputLanguage === 'function' ? detectOutputLanguage(joinedSource) : 'en';

    // Reuse the full slide-deck JSON schema/rules (layouts, elements,
    // backgrounds, etc.) so the output is a normal well-formed deck, then
    // layer strict "copy, don't compose" rules on top that override the
    // usual creative-writing behavior of that base prompt.
    const baseSchemaPrompt = buildSlideDeckRules(outputLanguage, null, autoBgMode);
    const copySystem =
      `${baseSchemaPrompt}\n` +
      `=== ABSOLUTE RULES FOR THIS "COPY" TASK (OVERRIDE EVERYTHING ELSE ABOVE) ===\n` +
      `You are in pure FORMATTING mode. Your ONLY job is to take the source content below and turn ALL of it into a slide deck — you must NOT summarize, shorten, paraphrase, correct, invent, or omit ANY fact, sentence, number, or value from it.\n` +
      `1. Every piece of substantive content from the source MUST end up on some slide — nothing added, nothing removed, nothing summarized away. Use as many slides as needed to fit everything; do not compress just to hit a "typical" slide count.\n` +
      `2. Do NOT add your own commentary, analysis, or conclusions that weren't in the source. Do NOT invent statistics, examples, or claims not present in the source.\n` +
      `3. Split the source into slides by its own natural structure (its headings/sections/topics) rather than an arbitrary slide count; a section with a lot of material gets more slides rather than being trimmed.\n` +
      `4. You MAY choose layouts, write slide titles, and reorganize bullets/tables for slide-sized readability — but never change the substance, order of ideas, or numbers.\n` +
      `5. Ignore page numbers, running headers/footers, and OCR control markers — those are not content to copy.\n` +
      `6. Do NOT ask a clarifying question for this task — always generate the deck directly.`;

    const userMsg = `Turn ALL of the following source content into a slide deck, preserving every detail:\n${joinedSource}`;

    const result = await callAIAPI([
      { role: 'system', content: copySystem },
      { role: 'user', content: userMsg }
    ], {
      forceJson: true,
      modelsUsedSet: modelsUsed
    });

    if (typeof ProgressUI !== 'undefined' && ProgressUI.setStage) ProgressUI.setStage('Finalizing…', 78, 92);

    let parsed = safeParseAIJson(result.content, null);
    if (!parsed) parsed = attemptRepairAndParse(result.content);
    const deck = sanitizeSlideDeckJSON(parsed, autoBgMode);
    if (!deck) throw new Error('The AI did not return a usable slide deck.');

    resolveAllSlideVisuals(deck);
    APP_STATE.slideDeck = deck;
    _slideDeckCurrentIndex = 0;
    if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);

    renderSlideDeckPreview(deck);
    if (typeof switchPreviewTab === 'function') switchPreviewTab('slides');
    if (typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout() && typeof setMobileView === 'function') setMobileView('editor');
    if (typeof updateCreationModeLockUI === 'function') updateCreationModeLockUI();

    attachedEntries.forEach(([, fileData]) => { fileData.sent = true; });
    if (typeof renderAttachmentBar === 'function') renderAttachmentBar();

    if (loadingElement && loadingElement.isConnected) loadingElement.remove();
    if (typeof appendChatMessageToUI === 'function') {
      appendChatMessageToUI('ai', attachedEntries.length > 1 ?
        `✅ Copied and restyled ${attachedEntries.length} files' content into ${deck.slides.length} slides — nothing added or removed.` :
        `✅ Copied and restyled the file's content into ${deck.slides.length} slides — nothing added or removed.`);
    }
    if (typeof displayToastNotification === 'function') displayToastNotification('✅ Copy complete — restyled into slides, content unchanged.');
  } catch (err) {
    if (loadingElement && loadingElement.isConnected) loadingElement.remove();
    console.error('Copy-to-slides command failed:', err);
    if (typeof appendChatMessageToUI === 'function') appendChatMessageToUI('error', `Copy failed: ${err.message || err}`);
    if (typeof displayToastNotification === 'function') displayToastNotification(`Error Copy failed: ${err.message || err}`);
  } finally {
    if (typeof ProgressUI !== 'undefined') { ProgressUI.finish(); setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 300); }
    APP_STATE.isAIGenerating = false;
    if (sendBtn) sendBtn.disabled = false;
    inputField.focus();
  }
}
window.handleCopyToSlidesCommand = handleCopyToSlidesCommand;

// ===== TAB PERSISTENCE HOOK =====
function persistSlideDeckToActiveTab(deck) {
  try {
    if (typeof TAB_MANAGER === 'undefined' || !TAB_MANAGER.tabs) return;
    const active = TAB_MANAGER.tabs.find(t => t.id === TAB_MANAGER.activeId);
    if (active) {
      active.slideDeck = deck || null;
      if (typeof TAB_MANAGER._persist === 'function') TAB_MANAGER._persist();
    }
  } catch (e) {
    console.warn('[SlideStudio] persist failed:', e);
    const isQuotaError = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 ||
      /quota/i.test(String(e.message || '')));
    if (isQuotaError && typeof displayToastNotification === 'function') {
      displayToastNotification('⚠️ This deck is too large to save (likely from uploaded images) — your last change may not persist after a refresh. Try smaller images or fewer of them.');
    }
  }
}

// ========================================================================
// PER-SLIDE AI EDIT
// ========================================================================
function startSlideAIEditCommand(index) {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides[index]) return;
  if (!window.APP_STATE) return;
  goToSlide(index);
  window.APP_STATE.selectedCommands = window.APP_STATE.selectedCommands.filter(c => c.id !== 'chat');
  const slideNumber = index + 1;
  const cmd = { id: 'edit_slide', category: 'intent', label: `Edit Slide ${slideNumber}`, icon: 'edit' };
  if (typeof attemptAddAtCommand === 'function') {
    attemptAddAtCommand(cmd, String(slideNumber));
  } else {
    window.APP_STATE.selectedCommands = [{ id: cmd.id, category: cmd.category, label: cmd.label, icon: cmd.icon, param: String(slideNumber), implicit: false }];
    if (typeof renderSelectedCommandChips === 'function') renderSelectedCommandChips();
  }
  const ta = document.getElementById('chat-input-textarea');
  if (ta) { try { ta.focus(); } catch (_) { /* noop */ } }
  if (typeof displayToastNotification === 'function') displayToastNotification(`AI replies now edit only Slide ${slideNumber}. Remove the chip to return to normal chat.`);
}

function buildSingleSlideEditSystemPrompt(outputLanguage) {
  const chartCatalog = typeof getChartCatalogForPrompt === 'function' ? getChartCatalogForPrompt() : '';
  const illustrationCatalog = typeof getIllustrationCatalogForPrompt === 'function' ? getIllustrationCatalogForPrompt() : '';
  const elementCatalog = typeof getElementCatalogForPrompt === 'function' ? getElementCatalogForPrompt() : '';
  const layoutCatalog = typeof getSlideLayoutCatalogForPrompt === 'function' ? getSlideLayoutCatalogForPrompt() : '';
  return (
    `You are editing ONE SLIDE inside an existing slide deck for AI PDF Studio's "Create Slides" feature.\n` +
    `Return ONLY a single JSON object — no markdown fences, no commentary outside the JSON.\n` +
    `Language: ${outputLanguage}.\n` +
    `- If ${outputLanguage} uses a complex script (Bengali, Devanagari, Arabic, Thai, Tamil, etc.), take extra care to write every word with the CORRECT characters and combining marks. Do not substitute visually-similar characters from other scripts.\n` +
    `JSON SHAPE: {"layout":"content","title":"...","bullets":["...","..."],"visual":null} plus, when the layout needs it, that layout's extra field(s) (columns/stat/quote/steps/subtitle/cards/stats/table/agenda/caption/icons/comparison/faq/profiles/blocks/elements) exactly as described in LAYOUTS.\n` +
    `LAYOUTS (each slide has one; pick whichever best fits what this slide now has to say):\n      ${layoutCatalog}\n` +
    `- Reach for "free" whenever none of the fixed layouts fits what this slide now needs to say.\n` +
    `RULES:\n` +
    `- Edit ONLY the one slide described below. Never reference, summarize, or try to change any other slide.\n` +
    `- LAYOUT: keep the slide's current layout unless the user asks for a different presentation of it or the new content clearly no longer fits it. Never return layout "title" unless the current layout is "title".\n` +
    `- "title" is a short slide headline (a few words to one line), never a full sentence paragraph.\n` +
    `- "bullets" is an array of short, punchy phrases (NOT full paragraphs). Use as many or as few as the slide needs.\n` +
    `- STATS STRICTNESS: on "stats" and "big_stat" layouts, EVERY entry with a "label" MUST also have a "value".\n` +
    `- "elements" (OPTIONAL, any layout): a decorative layer of small icons placed behind or in front of the content. Each entry is EITHER {"id":"sun",...} (a pre-made library element, preferred when one fits) OR {"svg":"<svg viewBox=\\"0 0 100 100\\">...</svg>","layer":"behind","x":..,"y":..,"size":..,"opacity":..} (a custom hand-drawn element). MANDATORY: if the user's request mentions decorations, accents, icons, a theme, or small symbolic imagery, you MUST return a non-empty "elements" array on this slide. Do NOT skip elements just because the slide's visual already has similar content. If the user asks to give THIS slide an organic/wavy/blob/geometric/dotted background (or references a pasted background image), use one of the 5 full-bleed ids — wave_band_stack, blob_cluster, dot_grid_texture, low_poly_mosaic, radial_glow_orb — placed large: {"id":"wave_band_stack","layer":"behind","x":-35,"y":-35,"size":170,"color":"...","color2":"...","color3":"..."} (these 5 alone also accept optional "color4"/"color5"). Library element ids:\n      ${elementCatalog}\n` +
    `- "visual" is OPTIONAL. Set it to exactly one of:\n` +
    `    (a) null — remove the slide's visual entirely,\n` +
    `    (b) a chart placeholder string, one of:\n      ${chartCatalog}\n` +
    `    (c) an illustration placeholder string — "<!--ILLUSTRATION:scene_id:params-->" — for a decorative flat-design scene, ONLY when an entry below is a genuine, near-exact (~90-100%) match for the slide's actual subject (not just the closest-sounding one). One of:\n      ${illustrationCatalog}\n      If nothing above genuinely matches, use (f) instead of forcing a mismatched pick.\n` +
    `    (d) a single element-library piece: "<!--ELEMENT:id:size=..|x=..|y=..-->" — for a small clean icon visual.\n` +
    `    (e) an IMAGE PLACEHOLDER — "<!--IMAGE_PLACEHOLDER:box:description-->" or "<!--IMAGE_PLACEHOLDER:circle:description-->" — DIAGRAMS ARE PERMANENTLY DISABLED, so use this whenever a diagram (anatomical, technical, schematic, process/flow, or any other labeled figure) would normally be needed. "description" is a detailed, specific description of the needed image, shown as text inside the placeholder frame. Never hand-draw a diagram.\n` +
    `    (f) a small hand-drawn illustration/icon as a raw, complete "<svg ...>...</svg>" string (viewBox 0 0 700 400, no external assets) — non-diagram decorative concepts only, INCLUDING when (c)'s catalog has no near-exact match for the slide's real subject; use (e) instead for any diagram/schematic/labeled technical or anatomical figure.\n` +
    `    (g) the exact string "KEEP" — leave the slide's current visual exactly as it is. Use this (or simply omit "visual" entirely) whenever the user's request does not ask you to add, replace, or remove the visual.\n` +
    `- VISUAL: only include a visual if it truly helps this slide. "visual" is used by layouts "content", "visual_left" and "visual_focus" only.\n` +
    `- NEVER try to retype or reproduce the slide's existing visual/svg content yourself — you may only be shown a placeholder for it. Bullets you're not asked to touch should likewise be preserved, not dropped.\n` +
    `- This slide's background is a separate user-controlled setting outside this JSON — do not try to change it via your reply.`
  );
}

const SLIDE_VISUAL_CONTEXT_MAX_CHARS = 400;

function _slideVisualContextPlaceholder(visual) {
  if (!visual) return null;
  if (visual.length <= SLIDE_VISUAL_CONTEXT_MAX_CHARS) return visual;
  return '[existing visual on this slide — omitted here to save space; return "visual":"KEEP" to leave it unchanged]';
}

function _slideEditableSnapshot(slide) {
  const out = { layout: slide.layout || 'content', title: slide.title || '', bullets: slide.bullets || [], visual: _slideVisualContextPlaceholder(slide.visual) };
  ['columns', 'stat', 'quote', 'steps', 'subtitle', 'cards', 'stats', 'table', 'agenda', 'caption', 'icons', 'comparison', 'faq', 'profiles', 'blocks'].forEach(k => {
    if (slide[k]) out[k] = slide[k];
  });
  if (Array.isArray(slide.elements) && slide.elements.length) out.elements = slide.elements;
  return out;
}

async function editSingleSlideViaAI(promptText, slideIndex, fileContextString, modelsUsedSet) {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides[slideIndex]) {
    return { ok: false, message: 'That slide no longer exists.' };
  }
  const slide = deck.slides[slideIndex];
  const outputLanguage = typeof detectOutputLanguage === 'function' ? detectOutputLanguage(promptText) : 'English';
  // Start every request from the model the user currently has selected. The
  // lock is only for keeping one multi-call build on the same model; a stale
  // lock from an earlier turn made the app ignore model switches.
  if (typeof _generationLockedModelConfig !== 'undefined') _generationLockedModelConfig = null;
  const activeCfg = undefined;

  const otherTitles = deck.slides.map((s, i) => i === slideIndex ? null : `${i + 1}. ${s.title || ''}`).filter(Boolean).join('\n');
  const currentSlideJSON = JSON.stringify(_slideEditableSnapshot(slide));

  const systemPrompt = buildSingleSlideEditSystemPrompt(outputLanguage);
  const userPrompt =
    `DECK TITLE: ${deck.title || ''}\n` +
    `THIS IS SLIDE ${slideIndex + 1} OF ${deck.slides.length}.\n` +
    (otherTitles ? `OTHER SLIDE TITLES (context only — do not edit these):\n${otherTitles}\n\n` : '\n') +
    `CURRENT SLIDE CONTENT:\n${currentSlideJSON}\n\n` +
    (fileContextString ? `ATTACHED SOURCE CONTEXT:\n${fileContextString}\n\n` : '') +
    `USER REQUEST FOR THIS SLIDE ONLY:\n${promptText}\n\n` +
    `Return the updated JSON object for this one slide now.`;

  try {
    const result = await callAIAPI(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      { forceJson: true, modelsUsedSet, modelConfig: activeCfg, maxTokens: undefined, temperature: _slideContentTemp() }
    );
    if (result && result.modelConfig) _generationLockedModelConfig = result.modelConfig;

    let parsed = safeParseAIJson(result.content, null);
    if (!parsed) parsed = attemptRepairAndParse(result.content);
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, message: 'The AI did not return a usable slide update.' };
    }

    const title = _truncateSlideText(parsed.title || slide.title || '', SLIDE_DECK_MAX_TITLE_CHARS) || slide.title || 'Untitled Slide';
    const bulletsSrc = Array.isArray(parsed.bullets) ? parsed.bullets : [];
    const bullets = bulletsSrc
      .filter(b => typeof b === 'string' && b.trim())
      .slice(0, SLIDE_DECK_MAX_BULLETS_PER_SLIDE)
      .map(b => _truncateSlideText(b, SLIDE_DECK_MAX_BULLET_CHARS));
    let visualRaw;
    const parsedVisual = parsed.visual;
    if (!('visual' in parsed) || (typeof parsedVisual === 'string' && parsedVisual.trim().toUpperCase() === 'KEEP')) {
      visualRaw = slide.visual || null;
    } else if (parsedVisual === null) {
      visualRaw = null;
    } else if (typeof parsedVisual === 'string' && parsedVisual.trim()) {
      visualRaw = parsedVisual.trim();
    } else {
      visualRaw = slide.visual || null;
    }

    const merged = Object.assign({}, _slideEditableSnapshot(slide), parsed, { title, bullets, visual: visualRaw });
    let requestedLayout = slideIndex === 0 ? 'title' : _sanitizeSlideLayout(merged.layout);
    if (requestedLayout === 'title' && slideIndex !== 0) requestedLayout = 'content';
    const layoutData = requestedLayout === 'title' ? { layout: 'title' } : _sanitizeSlideLayoutData(merged, requestedLayout);

    slide.title = title;
    slide.bullets = bullets;
    slide.visual = visualRaw;
    slide.visualSVG = resolveSlideVisualSVG(visualRaw);
    slide.visualChartData = _parseSlideChartData(visualRaw);
    _applyLayoutFieldsToSlide(slide, layoutData);
    if (Array.isArray(slide.blocks)) _resolveBlockVisuals(slide.blocks);
    if (Array.isArray(parsed.elements)) slide.elements = _sanitizeSlideElements(parsed.elements);
    _downgradeVisualLayoutIfNoVisual(slide);

    if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);
    _slideDeckCurrentIndex = slideIndex;
    renderSlideDeckPreview(deck);

    return { ok: true, slideNumber: slideIndex + 1, title: slide.title };
  } catch (e) {
    console.error('[Slide Studio] single-slide AI edit failed:', e);
    return { ok: false, message: (e && e.message) ? String(e.message) : 'Unknown error.', noModelConfigured: !!(e && e.noModelConfigured) };
  }
}

// ========================================================================
// ✨ CUSTOM BACKGROUND — AI-designed background from the user's own words
// ========================================================================
// Each background CSS value is a SINGLE string that may contain up to 4
// comma-separated LAYERS (e.g. two radial gradients + one linear gradient
// for a collage-like look, or repeating-linear-gradient for stripes /
// wave bands). Splitting on commas at depth 0 (i.e. not inside
// parentheses) lets us validate each layer independently without falsely
// rejecting a layered background.
const CUSTOM_BG_LAYER_PATTERN = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%\/]+\)|hsla?\([0-9.,\s%\/]+(?:deg)?\)|(?:repeating-)?(?:linear|radial|conic)-gradient\([0-9a-zA-Z#.,%\s()\-\/]+\)|[a-zA-Z]+)$/;
const CUSTOM_BG_MAX_LAYERS = 4;

function _splitCssLayers(css) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(css.slice(start, i));
      start = i + 1;
    }
  }
  out.push(css.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

function _isValidSlideBgCss(css) {
  if (!css || typeof css !== 'string') return false;
  // Hard safety pre-test: block anything that could carry active content
  // into an inline style attribute. Everything the prompt allows is made
  // of hex / rgb / hsl / *-gradient, none of which need quotes, angle
  // brackets, semicolons, url() or expression().
  if (/["'<>;]/.test(css)) return false;
  if (/url\s*\(|expression\s*\(|javascript:|@import/i.test(css)) return false;
  const layers = _splitCssLayers(css);
  if (!layers.length || layers.length > CUSTOM_BG_MAX_LAYERS) return false;
  return layers.every(l => CUSTOM_BG_LAYER_PATTERN.test(l));
}

function _sanitizeCustomBackgroundJSON(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = _truncateSlideText(typeof raw.label === 'string' ? raw.label : '', 40) || 'Custom';
  const css = typeof raw.css === 'string' ? raw.css.trim() : '';
  if (!_isValidSlideBgCss(css)) return null;
  const pptxRaw = typeof raw.pptx === 'string' ? raw.pptx.replace('#', '').trim() : '';
  const pptx = /^[0-9a-fA-F]{6}$/.test(pptxRaw) ? pptxRaw.toUpperCase() : SLIDE_LAYOUT_ACCENT_PPTX;
  const dark = !!raw.dark;
  const id = (typeof raw.id === 'string' && /^[a-z0-9_\-]{1,32}$/i.test(raw.id.trim())) ? raw.id.trim().toLowerCase() : null;
  return { id, label, css, pptx, dark };
}

function _sanitizeSlideBackgroundsArray(raw) {
  if (!Array.isArray(raw)) return null;
  const arr = raw.slice(0, SLIDE_MAX_BACKGROUNDS).map(b => _sanitizeCustomBackgroundJSON(b)).filter(Boolean);
  return arr.length >= 2 ? arr : null;
}

function buildCustomBackgroundSystemPrompt() {
  return (
    `You are the BACKGROUND DESIGNER for AI PDF Studio's "Create Slides" feature.\n` +
    `The user describes, in their own words, a background they want for one or more presentation slides.\n` +
    `Return ONLY a single JSON object — no markdown fences, no commentary outside the JSON.\n` +
    `JSON SHAPE (exact keys): {"label":"...","css":"...","pptx":"RRGGBB","dark":true}\n` +
    `RULES:\n` +
    `- "label" is a short 2-4 word name for this background (e.g. "Midnight Aurora").\n` +
    `- "css" is a single valid CSS background value. It may be:\n` +
    `    • one solid color (e.g. "#0f2027", "rgba(15,32,39,0.9)", "hsl(200 50% 50%)")\n` +
    `    • one gradient: linear-gradient / radial-gradient / conic-gradient with hex, rgb()/rgba() or hsl()/hsla() stops\n` +
    `    • a LAYERED value with up to 4 comma-separated layers for a collage/texture look — e.g. "radial-gradient(circle at 20% 30%, rgba(79,125,243,0.20) 0%, transparent 45%), radial-gradient(circle at 80% 70%, rgba(255,140,120,0.20) 0%, transparent 45%), linear-gradient(135deg,#f8fafc,#e2e8f0)"\n` +
    `    • repeating-linear-gradient / repeating-radial-gradient for stripes / wave bands — e.g. "repeating-linear-gradient(135deg, #e8e2d6 0 14px, #f5efe6 14px 28px)"\n` +
    `    No url(), no images, no external assets, nothing else.\n` +
    `- "pptx" is a single 6-digit hex color (no "#") approximating the overall/average color of "css" — used as a solid-fill fallback for PowerPoint export, which cannot render CSS gradients or layered backgrounds.\n` +
    `- "dark" is true if slide title/bullet text needs to render in a LIGHT color to stay readable on this background, false if dark text stays readable.\n` +
    `- Interpret the user's description faithfully (colors, mood, style) but keep it readable behind text — avoid anything so busy or high-contrast that text would be illegible.\n` +
    `- Never include text, shapes, images, or patterns beyond what CSS gradients/stripes can do.`
  );
}

async function applyCustomSlideBackgroundViaAI(promptText, bgTarget, fileContextString, modelsUsedSet) {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
    return { ok: false, message: 'No slide deck is available to style.' };
  }
  const targetIndexes = bgTarget === 'all'
    ? deck.slides.map((_, i) => i)
    : [parseInt(bgTarget, 10) - 1].filter(i => Number.isInteger(i) && deck.slides[i]);
  if (!targetIndexes.length) {
    return { ok: false, message: 'That slide is no longer available.' };
  }

  // Start every request from the model the user currently has selected. The
  // lock is only for keeping one multi-call build on the same model; a stale
  // lock from an earlier turn made the app ignore model switches.
  if (typeof _generationLockedModelConfig !== 'undefined') _generationLockedModelConfig = null;
  const activeCfg = undefined;
  const systemPrompt = buildCustomBackgroundSystemPrompt();
  const userPrompt =
    `DECK TITLE: ${deck.title || ''}\n` +
    (fileContextString ? `ATTACHED SOURCE CONTEXT:\n${fileContextString}\n\n` : '') +
    `DESCRIPTION OF THE BACKGROUND WANTED:\n${promptText}\n\n` +
    `Return the JSON object for this background now.`;

  try {
    const result = await callAIAPI(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      { forceJson: true, modelsUsedSet, modelConfig: activeCfg, maxTokens: undefined, temperature: _slideDesignTemp() }
    );
    if (result && result.modelConfig) _generationLockedModelConfig = result.modelConfig;

    let parsed = safeParseAIJson(result.content, null);
    if (!parsed) parsed = attemptRepairAndParse(result.content);
    const customBg = _sanitizeCustomBackgroundJSON(parsed);
    if (!customBg) {
      return { ok: false, message: 'The AI did not return a usable background. Try describing it differently.' };
    }

    targetIndexes.forEach(i => {
      deck.slides[i].bg = 'custom';
      deck.slides[i].customBg = customBg;
      // Explicit per-slide custom overrides any deck-level varied index
      // for this slide; clear so precedence is unambiguous.
      deck.slides[i].bgIndex = null;
    });
    if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);
    if (targetIndexes.indexOf(_slideDeckCurrentIndex) === -1) _slideDeckCurrentIndex = targetIndexes[0];
    renderSlideDeckPreview(deck);

    return { ok: true, label: customBg.label };
  } catch (e) {
    console.error('[Slide Studio] custom background generation failed:', e);
    return { ok: false, message: (e && e.message) ? String(e.message) : 'Unknown error.', noModelConfigured: !!(e && e.noModelConfigured) };
  }
}

function setCustomBgScope(isAll) {
  _customBgScopeAll = !!isAll;
  const panel = document.getElementById('slide-bg-picker-panel');
  if (panel) panel.innerHTML = _renderBackgroundPickerSwatches(APP_STATE.slideDeck);
}

function startCustomSlideBackgroundCommand() {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
    if (typeof displayToastNotification === 'function') displayToastNotification('Generate a slide deck first.');
    return;
  }
  if (!window.APP_STATE) return;

  const target = _customBgScopeAll ? 'all' : String(_slideDeckCurrentIndex + 1);
  window.APP_STATE.selectedCommands = window.APP_STATE.selectedCommands.filter(c => c.id !== 'chat' && c.id !== 'edit_slide');
  const cmd = {
    id: 'custom_background',
    category: 'intent',
    label: target === 'all' ? 'Custom Background (All Slides)' : `Custom Background (Slide ${target})`,
    icon: 'background'
  };
  if (typeof attemptAddAtCommand === 'function') {
    attemptAddAtCommand(cmd, target);
  } else {
    window.APP_STATE.selectedCommands = [{ id: cmd.id, category: cmd.category, label: cmd.label, icon: cmd.icon, param: target, implicit: false }];
    if (typeof renderSelectedCommandChips === 'function') renderSelectedCommandChips();
  }

  _slideBackgroundPickerOpen = false;
  const panel = document.getElementById('slide-bg-picker-panel');
  if (panel) panel.classList.remove('open');
  const btn = document.getElementById('slide-bg-toggle-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');

  const ta = document.getElementById('chat-input-textarea');
  if (ta) { try { ta.focus(); } catch (_) { /* noop */ } }
  const scopeText = target === 'all' ? 'every slide' : `Slide ${target}`;
  if (typeof displayToastNotification === 'function') {
    displayToastNotification(`Describe the background you want, then send — AI will design it for ${scopeText}. Remove the chip to go back to normal chat.`);
  }
}

// ========================================================================
// MANUAL IMAGE INSERT — toolbar "+ Image" button
// ========================================================================
const SLIDE_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const SLIDE_IMAGE_MAX_DIMENSION = 1280;
const SLIDE_IMAGE_JPEG_QUALITY = 0.85;

function triggerSlideImageUpload() {
  const slide = _currentSlide();
  if (!slide) {
    if (typeof displayToastNotification === 'function') displayToastNotification('Open or create a slide deck first.');
    return;
  }
  if (SLIDE_VISUAL_LAYOUTS.indexOf(slide.layout || 'content') === -1) {
    if (typeof displayToastNotification === 'function') displayToastNotification("This slide's layout doesn't show an image — switch it to Content, Visual Left, or Visual Focus first.");
    return;
  }
  const input = document.getElementById('slide-image-file-input');
  if (!input) return;
  input.value = '';
  input.click();
}

function _isSvgFile(file) {
  return !!file && (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || ''));
}

function _readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsText(file);
  });
}

function _downscaleImageFileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { reject(new Error('Could not read image dimensions.')); return; }
        const longEdge = Math.max(w, h);
        if (longEdge > SLIDE_IMAGE_MAX_DIMENSION) {
          const scale = SLIDE_IMAGE_MAX_DIMENSION / longEdge;
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const keepPng = /^image\/(png|gif|webp)$/i.test(file.type || '');
        const dataUrl = keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', SLIDE_IMAGE_JPEG_QUALITY);
        resolve({ dataUrl, width: w, height: h });
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not load the selected file as an image.')); };
    img.src = objectUrl;
  });
}

async function handleSlideImageFileSelected(event) {
  const file = event && event.target && event.target.files && event.target.files[0];
  if (event && event.target) event.target.value = '';
  if (!file) return;
  const slide = _currentSlide();
  if (!slide) {
    if (typeof displayToastNotification === 'function') displayToastNotification('Open or create a slide deck first.');
    return;
  }
  if (file.size > SLIDE_IMAGE_MAX_SOURCE_BYTES) {
    if (typeof displayToastNotification === 'function') displayToastNotification('That image is too large (max 20MB).');
    return;
  }
  if (!_isSvgFile(file) && !/^image\//i.test(file.type || '')) {
    if (typeof displayToastNotification === 'function') displayToastNotification('Please choose an image file (PNG, JPG, WEBP, GIF, or SVG).');
    return;
  }

  try {
    let svgString;
    if (_isSvgFile(file)) {
      let raw = (await _readFileAsText(file)).trim();
      if (typeof sanitizeHTML === 'function') {
        try { raw = sanitizeHTML(raw); } catch (_) { /* keep unsanitized fallback */ }
      }
      if (!/^<svg[\s>]/i.test(raw.trim())) {
        if (typeof displayToastNotification === 'function') displayToastNotification('That file is not a valid SVG image.');
        return;
      }
      svgString = raw.trim();
    } else {
      const { dataUrl, width, height } = await _downscaleImageFileToDataURL(file);
      svgString = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><image href="${dataUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></svg>`;
    }

    slide.visual = svgString;
    slide.visualSVG = typeof resolveSlideVisualSVG === 'function' ? resolveSlideVisualSVG(svgString) : svgString;
    slide.visualChartData = null;
    if (!slide.visualSVG) {
      if (typeof displayToastNotification === 'function') displayToastNotification('That image could not be added to the slide.');
      return;
    }
    if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(APP_STATE.slideDeck);
    renderSlideDeckPreview(APP_STATE.slideDeck);
    if (typeof displayToastNotification === 'function') displayToastNotification('Image added to the slide.');
  } catch (e) {
    console.error('[Slide Studio] image insert failed:', e);
    if (typeof displayToastNotification === 'function') displayToastNotification(`Could not add that image: ${(e && e.message) ? e.message : 'unknown error'}`);
  }
}

function clearCurrentSlideVisual() {
  const slide = _currentSlide();
  if (!slide || !slide.visualSVG) return;
  slide.visual = null;
  slide.visualSVG = null;
  slide.visualChartData = null;
  _downgradeVisualLayoutIfNoVisual(slide);
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(APP_STATE.slideDeck);
  renderSlideDeckPreview(APP_STATE.slideDeck);
}

// ===== PREVIEW RENDERING =====
function _escSlideHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _buildSlideElementLayerHTML(slide, layer) {
  if (!slide || !Array.isArray(slide.elements) || !slide.elements.length) return '';
  const items = slide.elements.filter(e => e.layer === layer);
  if (!items.length) return '';
  const parts = items.map(e => {
    let svgEl = '';
    if (e.svg) {
      // Custom hand-drawn element: sanitize, then force it to fill its
      // wrapper (strip any width/height/style the AI put on the root svg
      // tag so the wrapper's % sizing wins).
      let s = e.svg;
      if (typeof sanitizeHTML === 'function') {
        try { s = sanitizeHTML(s); } catch (_) { /* keep original */ }
      }
      if (!/^<svg[\s>]/i.test(s.trim())) return '';
      svgEl = s.replace(/^<svg\b([^>]*)>/i, (m, attrs) => {
        const a = attrs.replace(/\s(?:width|height|style)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
        return `<svg${a} style="width:100%;height:auto;display:block;">`;
      });
    } else {
      if (typeof renderElementById !== 'function') return '';
      const params = [
        'size=100', 'x=0', 'y=0', `rotate=${e.rotate}`,
        e.color ? `color=${e.color}` : '',
        e.color2 ? `color2=${e.color2}` : '',
        e.color3 ? `color3=${e.color3}` : '',
        e.color4 ? `color4=${e.color4}` : '',
        e.color5 ? `color5=${e.color5}` : ''
      ].filter(Boolean).join('|');
      const inner = renderElementById(e.id, params);
      if (!inner) return '';
      svgEl = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;">${inner}</svg>`;
    }
    if (!svgEl) return '';
    const wrapStyle = [
      'position:absolute',
      `left:${e.x}%`,
      `top:${e.y}%`,
      `width:${e.size}%`,
      `transform:rotate(${e.rotate}deg)`,
      'transform-origin:center',
      `opacity:${e.opacity}`,
      'pointer-events:none'
    ].join(';');
    return `<div style="${wrapStyle}">${svgEl}</div>`;
  }).filter(Boolean).join('');
  if (!parts) return '';
  return `<div class="slide-element-layer slide-element-layer-${layer}" style="position:absolute;inset:0;pointer-events:none;overflow:hidden;">${parts}</div>`;
}

function renderSlideDeckPreview(deck) {
  const container = document.getElementById('slide-view-container');
  if (!container) return;
  deck = deck || APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
    container.innerHTML = `<div class="slide-empty-state">
      <div class="slide-empty-icon">🖼️</div>
      <p>No slide deck yet. Use <b>@Create Slides</b> in the chat to generate one.</p>
    </div>`;
    return;
  }
  if (_slideDeckCurrentIndex >= deck.slides.length) _slideDeckCurrentIndex = 0;
  if (typeof ensureSlideThemeAssets === 'function') ensureSlideThemeAssets(deck);

  const thumbs = deck.slides.map((s, i) => `
    <div class="slide-thumb-row">
      <button type="button" class="slide-thumb${i === _slideDeckCurrentIndex ? ' active' : ''}" onclick="goToSlide(${i})" title="${_escSlideHtml(s.title)}">
        <span class="slide-thumb-index">${i + 1}</span>
        <span class="slide-thumb-title">${_escSlideHtml(s.title) || '&nbsp;'}</span>
      </button>
      <button type="button" class="slide-thumb-pencil" title="Edit only Slide ${i + 1} with AI" aria-label="Edit only Slide ${i + 1} with AI" onmousedown="event.preventDefault()" onclick="event.stopPropagation(); startSlideAIEditCommand(${i})">${typeof getUIIcon === 'function' ? getUIIcon('pencilSlide') : '✏️'}</button>
    </div>`).join('');

  const autoBgMode = getSlideAutoBackgroundMode();
  const autoBgLabel = SLIDE_AUTO_BG_MODE_LABELS[autoBgMode] || 'Off';

  container.innerHTML = `
    <div class="slide-edit-toolbar" role="toolbar" aria-label="Slide editor">
      <div class="slide-edit-group slide-nav-group">
        <button type="button" class="slide-nav-btn" onclick="navigateSlide(-1)" aria-label="Previous slide">⬅</button>
        <span class="slide-counter">${_slideDeckCurrentIndex + 1} / ${deck.slides.length}</span>
        <button type="button" class="slide-nav-btn" onclick="navigateSlide(1)" aria-label="Next slide">➡</button>
      </div>
      <div class="slide-edit-divider" aria-hidden="true"></div>
      <div class="slide-edit-group">
        <button type="button" class="slide-edit-btn" onclick="addSlideAfterCurrent()" title="Add a new slide after this one">+ Slide</button>
        <button type="button" class="slide-edit-btn" onclick="deleteCurrentSlide()" title="Delete this slide">🗑 Slide</button>
      </div>
      <div class="slide-edit-group">
        <button type="button" class="slide-edit-btn" onclick="addBulletToCurrentSlide()" title="Add a bullet point">+ Point</button>
        <button type="button" class="slide-edit-btn" onclick="triggerSlideImageUpload()" title="Add a photo, PNG/JPG image, or SVG image to this slide">${typeof getUIIcon === 'function' ? getUIIcon('canvas') : '🖼'} + Image</button>
        <input type="file" id="slide-image-file-input" accept="image/*,.svg,image/svg+xml" style="display:none" onchange="handleSlideImageFileSelected(event)">
      </div>
      <div class="slide-edit-group" role="group" aria-label="Text alignment">
        <button type="button" class="slide-edit-btn" onclick="setCurrentSlideAlign('left')" title="Align left">⫷</button>
        <button type="button" class="slide-edit-btn" onclick="setCurrentSlideAlign('center')" title="Align center">≡</button>
        <button type="button" class="slide-edit-btn" onclick="setCurrentSlideAlign('right')" title="Align right">⫸</button>
      </div>
      <div class="slide-edit-group slide-edit-group-bg">
        <button type="button" class="slide-edit-btn${autoBgMode !== 'off' ? ' active' : ''}" id="slide-auto-bg-toggle-btn" onclick="cycleSlideAutoBackgroundMode()" title="Cycles through Off / Single / Varied. Varied = AI designs a SET of different backgrounds assigned per slide for real visual variety." aria-pressed="${autoBgMode !== 'off' ? 'true' : 'false'}">${typeof getUIIcon === 'function' ? getUIIcon('background') : '🎨'} Auto BG: ${autoBgLabel}</button>
        <button type="button" class="slide-edit-btn" id="slide-bg-toggle-btn" onclick="toggleSlideBackgroundPicker()" title="Choose a slide background" aria-haspopup="true" aria-expanded="${_slideBackgroundPickerOpen ? 'true' : 'false'}">${typeof getUIIcon === 'function' ? getUIIcon('background') : '🎨'} Background</button>
      </div>
      <div class="slide-edit-group">${typeof slideThemeToolbarButtonHTML === 'function' ? slideThemeToolbarButtonHTML() : ''}</div>
    </div>
    <div class="slide-bg-picker-panel${_slideBackgroundPickerOpen ? ' open' : ''}" id="slide-bg-picker-panel">${_renderBackgroundPickerSwatches(deck)}</div>
    ${typeof slideThemePanelHTML === 'function' ? slideThemePanelHTML(deck) : ''}
    <div class="slide-studio-body">
      <div class="slide-thumbnail-rail" id="slide-thumbnail-rail">${thumbs}</div>
      <div class="slide-main-view" id="slide-main-view"></div>
    </div>`;

  _renderCurrentSlideCanvas(deck);
  _attachEditorSlideWheelNav();
}

let _editorWheelLocked = false;
function _attachEditorSlideWheelNav() {
  const mainView = document.getElementById('slide-main-view');
  if (!mainView) return;
  mainView.addEventListener('wheel', _onEditorSlideWheel, { passive: true });
}
function _onEditorSlideWheel(e) {
  if (_editorWheelLocked) return;
  const delta = e.deltaY || e.detail || 0;
  if (Math.abs(delta) < 4) return;
  _editorWheelLocked = true;
  navigateSlide(delta > 0 ? 1 : -1);
  setTimeout(() => { _editorWheelLocked = false; }, 450);
}

// ===== BACKGROUND PICKER =====
function _renderBackgroundPickerSwatches(deck) {
  deck = deck || APP_STATE.slideDeck;
  const current = _currentSlide();
  const currentBg = current ? current.bg : null;
  const noneSwatch = `
    <button type="button" class="slide-bg-swatch slide-bg-swatch-none${!currentBg && !(current && current.bgIndex != null) ? ' active' : ''}" title="No background (plain white)" onclick="setCurrentSlideBackground(null)">
      <span class="slide-bg-swatch-label">None</span>
    </button>`;
  const swatches = SLIDE_BACKGROUNDS.map(b => `
    <button type="button" class="slide-bg-swatch${currentBg === b.id ? ' active' : ''}" style="background:${b.css};" title="${_escSlideHtml(b.label)}" onclick="setCurrentSlideBackground('${b.id}')">
      <span class="slide-bg-swatch-label${b.dark ? ' light-text' : ''}">${_escSlideHtml(b.label)}</span>
    </button>`).join('');

  // Deck-level varied backgrounds (from Varied-mode Auto BG) shown as an
  // extra row so the user can preview and pick from the AI-designed set.
  let deckRowHTML = '';
  if (deck && Array.isArray(deck.backgrounds) && deck.backgrounds.length) {
    deckRowHTML = `<div class="slide-bg-picker-head" style="margin-top:0.6em;"><span>AI-generated palette (this deck)</span></div><div class="slide-bg-swatch-grid">${
      deck.backgrounds.map((b, bi) => `<button type="button" class="slide-bg-swatch${current && current.bgIndex === bi && !currentBg ? ' active' : ''}" style="background:${b.css};" title="${_escSlideHtml(b.label || ('Background ' + (bi + 1)))} — click to use on this slide" onclick="useDeckBackground(${bi})"><span class="slide-bg-swatch-label${b.dark ? ' light-text' : ''}">${_escSlideHtml(b.label || ('BG ' + (bi + 1)))}</span></button>`).join('')
    }</div>`;
  }

  const isCustomActive = currentBg === 'custom' && current && current.customBg;
  const customSwatchStyle = isCustomActive ? ` style="background:${current.customBg.css};"` : '';
  const customSwatch = `
    <button type="button" class="slide-bg-swatch slide-bg-swatch-custom${isCustomActive ? ' active' : ''}"${customSwatchStyle} title="Describe a background in your own words — AI designs it" onclick="startCustomSlideBackgroundCommand()">
      <span class="slide-bg-swatch-label${isCustomActive && current.customBg.dark ? ' light-text' : ''}">✨ ${isCustomActive ? _escSlideHtml(current.customBg.label) : 'Custom…'}</span>
    </button>`;
  return `
    <div class="slide-bg-picker-head">
      <span>Choose a background for this slide</span>
      <button type="button" class="slide-bg-apply-all" onclick="applyCurrentBackgroundToAllSlides()" title="Apply this background to every slide in the deck">Apply to all slides</button>
    </div>
    <div class="slide-bg-swatch-grid">${noneSwatch}${swatches}${customSwatch}</div>
    ${deckRowHTML}
    <div class="slide-bg-custom-scope" role="group" aria-label="Scope for the next Custom Background description">
      <span class="slide-bg-custom-scope-label">✨ Custom applies to:</span>
      <button type="button" class="slide-bg-scope-btn${_customBgScopeAll ? '' : ' active'}" onclick="setCustomBgScope(false)">Just this slide</button>
      <button type="button" class="slide-bg-scope-btn${_customBgScopeAll ? ' active' : ''}" onclick="setCustomBgScope(true)">Same on all slides</button>
    </div>`;
}

// Click on one of the AI-generated deck-level backgrounds: assign that
// index to the current slide (clearing any per-slide custom/preset override).
function useDeckBackground(bgIndex) {
  const deck = APP_STATE.slideDeck;
  const slide = _currentSlide();
  if (!deck || !slide || !Array.isArray(deck.backgrounds) || !deck.backgrounds[bgIndex]) return;
  slide.bg = null;
  slide.customBg = null;
  slide.bgIndex = bgIndex;
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);
  renderSlideDeckPreview(deck);
  _slideBackgroundPickerOpen = true;
  const panel = document.getElementById('slide-bg-picker-panel');
  if (panel) { panel.classList.add('open'); panel.innerHTML = _renderBackgroundPickerSwatches(deck); }
  const btn = document.getElementById('slide-bg-toggle-btn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function toggleSlideBackgroundPicker() {
  _slideBackgroundPickerOpen = !_slideBackgroundPickerOpen;
  const panel = document.getElementById('slide-bg-picker-panel');
  const btn = document.getElementById('slide-bg-toggle-btn');
  if (panel) panel.classList.toggle('open', _slideBackgroundPickerOpen);
  if (btn) btn.setAttribute('aria-expanded', _slideBackgroundPickerOpen ? 'true' : 'false');
  if (_slideBackgroundPickerOpen && panel) panel.innerHTML = _renderBackgroundPickerSwatches(APP_STATE.slideDeck);
}

function setCurrentSlideBackground(bgId) {
  const slide = _currentSlide();
  if (!slide) return;
  slide.bg = bgId || null;
  // Switching to a preset (or "None") must drop the previous custom
  // definition and any varied-mode index so precedence is unambiguous.
  if (slide.bg !== 'custom') slide.customBg = null;
  if (slide.bg) slide.bgIndex = null;
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(APP_STATE.slideDeck);
  renderSlideDeckPreview(APP_STATE.slideDeck);
  _slideBackgroundPickerOpen = true;
  const panel = document.getElementById('slide-bg-picker-panel');
  if (panel) { panel.classList.add('open'); panel.innerHTML = _renderBackgroundPickerSwatches(APP_STATE.slideDeck); }
  const btn = document.getElementById('slide-bg-toggle-btn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function applyCurrentBackgroundToAllSlides() {
  const deck = APP_STATE.slideDeck;
  const current = _currentSlide();
  if (!deck || !Array.isArray(deck.slides) || !current) return;
  const bg = current.bg || null;
  // Carry the actual custom-background DEFINITION too, not just the
  // 'custom' tag — the old code copied only `bg`, so every other slide
  // got bg:'custom' but kept its own (usually null) customBg, and
  // _resolveSlideBackground() then found neither a preset nor a custom
  // definition and rendered those slides with no background at all.
  const customBg = current.customBg || null;
  // If the current slide uses a deck-level varied index, "apply to all"
  // means "make this whole deck use this one index" — clear overrides
  // and set the same index everywhere.
  const currentIdx = (current.bgIndex != null && !bg) ? current.bgIndex : null;
  deck.slides.forEach(s => {
    s.bg = bg;
    s.customBg = customBg;
    s.bgIndex = currentIdx;
  });
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);
  if (typeof displayToastNotification === 'function') displayToastNotification(bg ? 'Background applied to every slide.' : 'Background cleared from every slide.');
  _slideBackgroundPickerOpen = true;
  renderSlideDeckPreview(deck);
}

function _isTitleOnlySlide(slide) {
  if (!slide) return false;
  if (slide.layout && slide.layout !== 'content') return slide.layout === 'title' || slide.layout === 'section';
  return (!slide.bullets || !slide.bullets.length) && !slide.visualSVG;
}

// ========================================================================
// MATH (KaTeX) SUPPORT FOR SLIDES
// ========================================================================
// Reuses the same generic, container-agnostic functions math-renderer.js
// already provides for the document editor (processMathEquationsInContainer
// scans an element's text nodes for $...$ / $$...$$ / raw LaTeX commands and
// swaps them for .katex-eq spans; renderAllKatexVisuals/forceRenderAllKatexVisuals
// then actually run KaTeX on those spans) — nothing document-specific about
// either function, so no changes were needed in math-renderer.js itself.
function _renderMathInSlideElement(el) {
  if (!el) return;
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(el);
  const run = () => { if (typeof forceRenderAllKatexVisuals === 'function') forceRenderAllKatexVisuals(el); };
  if (typeof isKatexReady === 'function' && isKatexReady()) {
    run();
  } else if (typeof waitForKatex === 'function') {
    waitForKatex(4000).then(ok => { if (ok) run(); });
  }
}

// Reads a slide title/bullet contenteditable's CURRENT content back into
// plain text, converting any already-rendered .katex-eq spans back to their
// $...$/$$...$$ LaTeX SOURCE first (via math-renderer.js's
// convertKatexSpansToLatexSource) instead of reading the rendered glyphs via
// innerText/textContent. Without this, a bullet that already contains a
// rendered equation would have its LaTeX source silently replaced by
// whatever the rendered KaTeX output "looks like" as plain text the moment
// the user types anywhere in that field — corrupting the equation.
function _extractSlideTextWithLatexSource(el) {
  if (!el) return '';
  let html = el.innerHTML;
  if (typeof convertKatexSpansToLatexSource === 'function') html = convertKatexSpansToLatexSource(html);
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.innerText != null ? tmp.innerText : tmp.textContent || '').trim();
}

function _renderCurrentSlideCanvas(deck) {
  deck = deck || APP_STATE.slideDeck;
  const mainView = document.getElementById('slide-main-view');
  if (!mainView || !deck || !deck.slides[_slideDeckCurrentIndex]) return;
  mainView.innerHTML = _buildSlideCanvasHTML(deck.slides[_slideDeckCurrentIndex], true);
  _renderMathInSlideElement(mainView);
  _scheduleSlideFit();
}

// ===== FIT-TO-FRAME =====
function _fitSlideCanvas(canvas) {
  if (!canvas) return;
  canvas.style.setProperty('--fit', '1');
  if (!canvas.clientHeight) return;
  let fit = 1;
  for (let i = 0; i < 24 && canvas.scrollHeight > canvas.clientHeight + 1 && fit > 0.3; i++) {
    fit = Math.round((fit - 0.04) * 100) / 100;
    canvas.style.setProperty('--fit', String(fit));
  }
}
function _fitAllSlideCanvases() {
  document.querySelectorAll('.slide-canvas-16x9').forEach(_fitSlideCanvas);
}
function _scheduleSlideFit() {
  requestAnimationFrame(() => { _fitAllSlideCanvases(); requestAnimationFrame(_fitAllSlideCanvases); });
}
window.addEventListener('resize', _scheduleSlideFit);
document.addEventListener('fullscreenchange', _scheduleSlideFit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(_scheduleSlideFit);

// ========================================================================
// PER-LAYOUT BODY BUILDERS (canvas preview)
// ========================================================================
const SLIDE_LAYOUT_ACCENT = '#4f7df3';
const SLIDE_LAYOUT_DARK_TEXT = '#1f2937';
const SLIDE_LAYOUT_ACCENT_PPTX = SLIDE_LAYOUT_ACCENT.replace('#', '').toUpperCase();
const SLIDE_LAYOUT_DARK_TEXT_PPTX = SLIDE_LAYOUT_DARK_TEXT.replace('#', '').toUpperCase();
const SLIDE_LAYOUT_MUTED = 'rgba(100,116,139,0.85)';

function _slideLayoutTitleHTML(slide, editable, align, extraStyle) {
  const style = `text-align:${align};${extraStyle || ''}`;
  return editable
    ? `<div class="slide-canvas-title" contenteditable="true" spellcheck="false" style="${style}" oninput="onSlideTitleInput(this)" onblur="onSlideTitleBlur(this)">${_escSlideHtml(slide.title)}</div>`
    : `<div class="slide-canvas-title" style="${style}">${_escSlideHtml(slide.title)}</div>`;
}

function _bulletsHTML(bullets, editable) {
  return (bullets && bullets.length)
    ? `<ul class="slide-canvas-bullets">${bullets.map((b, i) => editable ? `
      <li class="slide-bullet-row">
        <span class="slide-bullet-text" contenteditable="true" spellcheck="false" oninput="onSlideBulletInput(${i}, this)" onblur="onSlideBulletBlur(${i}, this)">${_escSlideHtml(b)}</span>
        <button type="button" class="slide-bullet-del" title="Delete this point" onmousedown="event.preventDefault()" onclick="deleteBulletFromCurrentSlide(${i})">×</button>
      </li>` : `
      <li class="slide-bullet-row slide-bullet-row-readonly">
        <span class="slide-bullet-text">${_escSlideHtml(b)}</span>
      </li>`).join('')}</ul>`
    : '';
}

function _visualHTML(slide, editable) {
  return slide.visualSVG
    ? (editable
      ? `<div class="slide-canvas-visual">
      ${slide.visualSVG}
      <button type="button" class="slide-visual-remove-btn" title="Remove this image/visual" aria-label="Remove this image/visual" onmousedown="event.preventDefault()" onclick="event.stopPropagation(); clearCurrentSlideVisual()">×</button>
    </div>`
      : `<div class="slide-canvas-visual slide-canvas-visual-readonly">${slide.visualSVG}</div>`)
    : '';
}

function _buildContentLayoutBody(slide, editable, align) {
  return `${_slideLayoutTitleHTML(slide, editable, align)}${_visualHTML(slide, editable)}${_bulletsHTML(slide.bullets, editable)}`;
}

function _buildSectionLayoutBody(slide, editable, align) {
  const subtitle = slide.subtitle
    ? `<div style="text-align:${align};font-size:0.62em;font-weight:500;opacity:0.75;margin-top:0.3em;">${_escSlideHtml(slide.subtitle)}</div>`
    : '';
  return `<div style="width:2.4em;height:0.09em;background:var(--ss-accent,#4f7df3);border-radius:2px;margin-bottom:0.35em;${align === 'center' ? 'margin-left:auto;margin-right:auto;' : ''}"></div>${_slideLayoutTitleHTML(slide, editable, align)}${subtitle}`;
}

function _buildTwoColumnLayoutBody(slide, editable, align) {
  const cols = (slide.columns || []).map((c, ci) => `
    <div style="flex:1 1 0;min-width:0;${ci === 1 ? `border-left:1px solid rgba(100,116,139,0.25);padding-left:1.1em;` : `padding-right:1.1em;`}">
      ${c.heading ? `<div style="font-weight:700;font-size:1.7em;color:var(--ss-accent,#4f7df3);margin-bottom:0.5em;">${_escSlideHtml(c.heading)}</div>` : ''}
      ${_bulletsHTML(c.bullets, false)}
    </div>`).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div style="display:flex;width:100%;margin-top:0.4em;">${cols}</div>`;
}

function _buildThreeColumnLayoutBody(slide, editable, align) {
  const cols = (slide.columns || []).map((c, ci) => `
    <div style="flex:1 1 0;min-width:0;${ci > 0 ? 'border-left:1px solid rgba(100,116,139,0.25);padding-left:1.1em;' : ''}${ci < 2 ? 'padding-right:1.1em;' : ''}">
      ${c.heading ? `<div style="font-weight:700;font-size:1.55em;color:var(--ss-accent,#4f7df3);margin-bottom:0.5em;">${_escSlideHtml(c.heading)}</div>` : ''}
      ${_bulletsHTML(c.bullets, false)}
    </div>`).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div style="display:flex;width:100%;margin-top:0.4em;">${cols}</div>`;
}

function _buildBigStatLayoutBody(slide, editable, align) {
  const stat = slide.stat || { value: '', label: '' };
  return `
    ${slide.title ? _slideLayoutTitleHTML(slide, editable, align, 'font-size:0.6em;opacity:0.75;font-weight:600;') : ''}
    <div style="font-size:2.6em;font-weight:800;color:var(--ss-accent,#4f7df3);line-height:1.05;text-align:${align};">${_escSlideHtml(stat.value)}</div>
    ${stat.label ? `<div style="font-size:0.85em;font-weight:500;color:var(--ss-muted,rgba(100,116,139,0.85));text-align:${align};margin-top:0.15em;">${_escSlideHtml(stat.label)}</div>` : ''}
    ${slide.bullets && slide.bullets.length ? `<div style="margin-top:0.6em;">${_bulletsHTML(slide.bullets, false)}</div>` : ''}`;
}

function _buildQuoteLayoutBody(slide, editable) {
  const q = slide.quote || { text: '', author: '' };
  return `
    <div style="font-size:2.4em;line-height:1.4;font-weight:600;font-style:italic;text-align:center;">"${_escSlideHtml(q.text)}"</div>
    ${q.author ? `<div style="margin-top:0.6em;font-size:0.85em;font-weight:600;color:var(--ss-muted,rgba(100,116,139,0.85));text-align:center;">— ${_escSlideHtml(q.author)}</div>` : ''}`;
}

function _buildTimelineLayoutBody(slide, editable, align) {
  const steps = slide.steps || [];
  const stepsHTML = steps.map(st => `
    <div style="flex:1 1 0;min-width:0;text-align:center;position:relative;">
      <div style="width:1.2em;height:1.2em;border-radius:50%;background:var(--ss-accent,#4f7df3);margin:0 auto 0.5em;"></div>
      <div style="font-weight:700;font-size:1.4em;margin-bottom:0.35em;">${_escSlideHtml(st.label)}</div>
      <div style="font-size:1.15em;color:var(--ss-muted,rgba(100,116,139,0.85));line-height:1.4;">${_escSlideHtml(st.text)}</div>
    </div>`).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div style="position:relative;display:flex;width:100%;margin-top:0.8em;">
      <div style="position:absolute;top:0.6em;left:8%;right:8%;height:2px;background:rgba(100,116,139,0.3);z-index:0;"></div>
      ${stepsHTML}
    </div>`;
}

// ===== STYLES FOR NEW LAYOUTS =====
let _slideLayoutStylesInjected = false;
function _ensureSlideLayoutStyles() {
  if (_slideLayoutStylesInjected || typeof document === 'undefined' || !document.head) return;
  _slideLayoutStylesInjected = true;
  const st = document.createElement('style');
  st.id = 'slide-layout-extra-styles';
  st.textContent = `
    .ss-fit-svg{position:relative;margin:0 auto;}
    .ss-fit-svg > svg{width:100%;height:auto;display:block;}
    .ss-vfocus{width:100%;margin-top:0.4em;}
    .ss-vfocus-caption{font-size:1.35em;opacity:0.75;text-align:center;margin-top:0.35em;}
    .ss-vleft{display:flex;align-items:center;gap:0.9em;width:100%;margin-top:0.4em;}
    .ss-vleft-media{flex:0 0 48%;min-width:0;}
    .ss-vleft-body{flex:1 1 0;min-width:0;}
    .ss-cards{display:grid;gap:0.6em;width:100%;margin-top:0.5em;flex:1 1 0;min-height:0;}
    .ss-card{background:var(--ss-card-bg,rgba(100,116,139,0.12));border:1px solid rgba(15,23,42,0.18);border-top:0.14em solid var(--ss-accent,#4f7df3);border-radius:var(--ss-radius,0.5em);padding:1.2em 1.15em;min-width:0;display:flex;flex-direction:column;}
    .ss-card-h{font-weight:700;font-size:1.8em;margin-bottom:1.6em;color:var(--ss-accent,#4f7df3);line-height:1.2;}
    .ss-card-t{font-size:1.3em;line-height:1.4;opacity:0.85;flex:1 1 auto;}
    .ss-cards-4 .ss-card-h{font-size:1.6em;margin-bottom:1.35em;}
    .ss-cards-4 .ss-card-t{font-size:1.2em;}
    .ss-stats{display:grid;gap:0.4em;width:100%;margin-top:0.9em;flex:1 1 0;min-height:0;}
    .ss-stat{text-align:center;min-width:0;padding:0 0.3em;display:flex;flex-direction:column;justify-content:center;}
    .ss-stat + .ss-stat{border-left:1px solid rgba(100,116,139,0.28);}
    .ss-stat-v{font-weight:800;color:var(--ss-accent,#4f7df3);line-height:1.05;}
    .ss-stat-l{font-size:1.5em;opacity:0.8;margin-top:0.5em;line-height:1.3;}
    .ss-table{width:100%;border-collapse:collapse;margin-top:0.5em;}
    .ss-table th{background:var(--ss-accent,#4f7df3);color:#fff;text-align:left;padding:0.5em 0.7em;font-weight:700;font-size:1.35em;}
    .ss-table td{padding:0.5em 0.7em;border-bottom:1px solid rgba(100,116,139,0.3);font-size:1.25em;}
    .ss-table tr:nth-child(even) td{background:rgba(100,116,139,0.08);}
    .ss-agenda{width:100%;margin-top:0.8em;display:flex;flex-direction:column;gap:0.6em;}
    .ss-agenda-row{display:flex;align-items:center;gap:0.8em;}
    .ss-agenda-num{flex:0 0 auto;width:3em;height:3em;border-radius:50%;background:var(--ss-accent,#4f7df3);color:#fff;font-weight:700;font-size:1.5em;display:flex;align-items:center;justify-content:center;}
    .ss-agenda-txt{font-size:1.9em;font-weight:500;min-width:0;}
    .slide-canvas-dark-text .ss-card-h,.slide-canvas-dark-text .ss-stat-v{color:#ffffff;}
    .slide-canvas-dark-text .ss-card{border-color:rgba(255,255,255,0.55);border-top-color:#ffffff;}
    .ss-comparison{display:flex;width:100%;margin-top:0.6em;gap:1.2em;flex:1 1 0;min-height:0;}
    .ss-comparison-side{flex:1 1 0;min-width:0;}
    .ss-comparison-h{font-weight:700;font-size:1.7em;margin-bottom:0.5em;}
    .ss-comparison-left .ss-comparison-h{color:#1f9d55;}
    .ss-comparison-right .ss-comparison-h{color:#e0473f;}
    .ss-comparison-divider{width:1px;background:rgba(100,116,139,0.28);flex:0 0 auto;}
    .ss-comparison-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.5em;}
    .ss-comparison-list li{display:flex;align-items:flex-start;gap:0.5em;font-size:1.25em;line-height:1.4;}
    .ss-comparison-glyph{flex:0 0 auto;width:1.1em;height:1.1em;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.85em;color:#fff;}
    .ss-comparison-left .ss-comparison-glyph{background:#1f9d55;}
    .ss-comparison-right .ss-comparison-glyph{background:#e0473f;}
    .slide-canvas-dark-text .ss-comparison-left .ss-comparison-h{color:#6ee7a5;}
    .slide-canvas-dark-text .ss-comparison-right .ss-comparison-h{color:#ffb4ae;}
    .ss-faq{width:100%;margin-top:0.6em;display:flex;flex-direction:column;gap:0.6em;flex:1 1 0;min-height:0;overflow:hidden;}
    .ss-faq-item{border-left:0.14em solid var(--ss-accent,#4f7df3);padding-left:0.7em;}
    .ss-faq-q{font-weight:700;font-size:1.4em;line-height:1.3;}
    .ss-faq-a{font-size:1.15em;opacity:0.82;line-height:1.4;margin-top:0.15em;}
    .slide-canvas-dark-text .ss-faq-item{border-left-color:#ffffff;}
    .ss-profiles{display:grid;gap:0.8em;width:100%;margin-top:0.6em;flex:1 1 0;min-height:0;}
    .ss-profile{text-align:center;min-width:0;display:flex;flex-direction:column;align-items:center;}
    .ss-profile-avatar{width:2.6em;height:2.6em;border-radius:50%;background:var(--ss-accent,#4f7df3);color:#fff;font-weight:700;font-size:1.3em;display:flex;align-items:center;justify-content:center;margin-bottom:0.4em;}
    .ss-profile-name{font-weight:700;font-size:1.3em;}
    .ss-profile-role{font-size:1.05em;opacity:0.75;margin-top:0.1em;}
    .ss-profile-bio{font-size:1em;opacity:0.85;margin-top:0.35em;line-height:1.35;}
    .slide-canvas-dark-text .ss-profile-avatar{background:#ffffff;color:var(--ss-accent,#4f7df3);}
    .slide-element-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  `;
  document.head.appendChild(st);
}

function _slideVisualFrameHTML(slide, editable, boxW, boxH) {
  if (!slide.visualSVG) return '';
  const fit = _fitAspectInBox(_getSvgAspectRatio(slide.visualSVG), { x: 0, y: 0, w: boxW, h: boxH });
  const pct = Math.max(10, Math.min(100, Math.round(fit.w / boxW * 1000) / 10));
  const removeBtn = editable
    ? `<button type="button" class="slide-visual-remove-btn" title="Remove this image/visual" aria-label="Remove this image/visual" onmousedown="event.preventDefault()" onclick="event.stopPropagation(); clearCurrentSlideVisual()">×</button>`
    : '';
  return `<div class="ss-fit-svg" style="width:${pct}%;">${slide.visualSVG}${removeBtn}</div>`;
}

function _buildVisualFocusLayoutBody(slide, editable, align) {
  const boxH = slide.caption ? 3.4 : 3.9;
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div class="ss-vfocus">${_slideVisualFrameHTML(slide, editable, 8.6, boxH)}
    ${slide.caption ? `<div class="ss-vfocus-caption">${_escSlideHtml(slide.caption)}</div>` : ''}</div>`;
}

function _buildVisualLeftLayoutBody(slide, editable, align) {
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div class="ss-vleft">
      <div class="ss-vleft-media">${_slideVisualFrameHTML(slide, editable, 4.4, 3.9)}</div>
      <div class="ss-vleft-body">${_bulletsHTML(slide.bullets, editable)}</div>
    </div>`;
}

function _buildCardsLayoutBody(slide, editable, align) {
  const cards = slide.cards || [];
  const cols = cards.length === 4 ? 2 : (cards.length > 4 ? 3 : cards.length);
  const rows = Math.ceil(cards.length / cols);
  const html = cards.map(c => `<div class="ss-card">
      ${c.heading ? `<div class="ss-card-h">${_escSlideHtml(c.heading)}</div>` : ''}
      ${c.text ? `<div class="ss-card-t">${_escSlideHtml(c.text)}</div>` : ''}
    </div>`).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div class="ss-cards${cards.length === 4 ? ' ss-cards-4' : ''}" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr));">${html}</div>`;
}

function _buildStatsLayoutBody(slide, editable, align) {
  const stats = slide.stats || [];
  const valueSize = stats.length >= 4 ? '3.6em' : (stats.length === 3 ? '4.4em' : '5.3em');
  const html = stats.map(st => {
    if (!st.value && st.label) {
      return `<div class="ss-stat"><div style="font-weight:600;font-size:1.7em;line-height:1.3;padding:0 0.15em;">${_escSlideHtml(st.label)}</div></div>`;
    }
    return `<div class="ss-stat">
      <div class="ss-stat-v" style="font-size:${valueSize};">${_escSlideHtml(st.value)}</div>
      ${st.label ? `<div class="ss-stat-l">${_escSlideHtml(st.label)}</div>` : ''}
    </div>`;
  }).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div class="ss-stats" style="grid-template-columns:repeat(${stats.length},minmax(0,1fr));">${html}</div>`;
}

function _buildTableLayoutBody(slide, editable, align) {
  const t = slide.table || { headers: [], rows: [] };
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <table class="ss-table"><thead><tr>${t.headers.map(h => `<th>${_escSlideHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${_escSlideHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function _buildAgendaLayoutBody(slide, editable, align) {
  const rows = (slide.agenda || []).map((it, i) => `<div class="ss-agenda-row"><div class="ss-agenda-num">${i + 1}</div><div class="ss-agenda-txt">${_escSlideHtml(it)}</div></div>`).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}<div class="ss-agenda">${rows}</div>`;
}

function _buildIconRowLayoutBody(slide, editable, align) {
  const items = (slide.icons || []).map(it => {
    const e = it.element;
    let inner = '';
    if (e.svg) {
      let s = e.svg;
      if (typeof sanitizeHTML === 'function') { try { s = sanitizeHTML(s); } catch (_) {} }
      if (!/^<svg[\s>]/i.test(s.trim())) return '';
      inner = s.replace(/^<svg\b([^>]*)>/i, (m, attrs) => {
        const a = attrs.replace(/\s(?:width|height|style)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
        return `<svg${a} style="width:100%;height:auto;display:block;">`;
      });
    } else {
      if (typeof renderElementById !== 'function') return '';
      const rendered = renderElementById(e.id, `size=100|x=0|y=0|rotate=${e.rotate}${e.color ? `|color=${e.color}` : ''}${e.color2 ? `|color2=${e.color2}` : ''}`);
      if (!rendered) return '';
      inner = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;">${rendered}</svg>`;
    }
    return `<div style="flex:1 1 0;min-width:0;text-align:center;">
      <div style="width:38%;max-width:96px;margin:0 auto;">${inner}</div>
      ${it.label ? `<div style="font-weight:700;font-size:1.4em;margin-top:0.4em;">${_escSlideHtml(it.label)}</div>` : ''}
      ${it.text ? `<div style="font-size:1.1em;opacity:0.8;margin-top:0.2em;line-height:1.4;">${_escSlideHtml(it.text)}</div>` : ''}
    </div>`;
  }).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div style="display:flex;gap:1em;width:100%;margin-top:0.6em;align-items:flex-start;">${items}</div>`;
}

function _slideInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function _buildComparisonLayoutBody(slide, editable, align) {
  const c = slide.comparison || { left: { heading: '', items: [] }, right: { heading: '', items: [] } };
  const side = (sd, cls, glyph) => `
    <div class="ss-comparison-side ${cls}">
      ${sd.heading ? `<div class="ss-comparison-h">${_escSlideHtml(sd.heading)}</div>` : ''}
      <ul class="ss-comparison-list">${(sd.items || []).map(it => `<li><span class="ss-comparison-glyph">${glyph}</span><span>${_escSlideHtml(it)}</span></li>`).join('')}</ul>
    </div>`;
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div class="ss-comparison">
      ${side(c.left, 'ss-comparison-left', '+')}
      <div class="ss-comparison-divider"></div>
      ${side(c.right, 'ss-comparison-right', '–')}
    </div>`;
}

function _buildFaqLayoutBody(slide, editable, align) {
  const items = slide.faq || [];
  const rows = items.map(it => `
    <div class="ss-faq-item">
      <div class="ss-faq-q">${_escSlideHtml(it.question)}</div>
      <div class="ss-faq-a">${_escSlideHtml(it.answer)}</div>
    </div>`).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}<div class="ss-faq">${rows}</div>`;
}

function _buildProfilesLayoutBody(slide, editable, align) {
  const profiles = slide.profiles || [];
  const cols = profiles.length >= 5 ? 3 : (profiles.length === 4 ? 2 : profiles.length);
  const rows = Math.ceil(profiles.length / cols);
  const html = profiles.map(p => `
    <div class="ss-profile">
      <div class="ss-profile-avatar">${_escSlideHtml(_slideInitials(p.name))}</div>
      <div class="ss-profile-name">${_escSlideHtml(p.name)}</div>
      ${p.role ? `<div class="ss-profile-role">${_escSlideHtml(p.role)}</div>` : ''}
      ${p.bio ? `<div class="ss-profile-bio">${_escSlideHtml(p.bio)}</div>` : ''}
    </div>`).join('');
  return `${_slideLayoutTitleHTML(slide, editable, align)}
    <div class="ss-profiles" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr));">${html}</div>`;
}

// ===== FREE LAYOUT RENDERING =====
function _slideBlockInlineStyle(block, align, extra) {
  const s = [];
  if (align) s.push(`text-align:${align}`);
  if (block.style) {
    if (block.style.color) s.push(`color:${block.style.color}`);
    if (block.style.weight) s.push(`font-weight:${block.style.weight === 'bold' ? 700 : 400}`);
    if (block.style.italic) s.push('font-style:italic');
    if (block.style.size) s.push(`font-size:${_SLIDE_BLOCK_SIZE_EM[block.style.size] || '1em'}`);
  }
  if (extra) s.push(extra);
  return s.join(';');
}

function _renderBlockHTML(block, editable, defaultAlign) {
  const align = block.align || defaultAlign || 'left';
  switch (block.type) {
    case 'heading':
      return `<div class="slide-block slide-block-heading" style="${_slideBlockInlineStyle(block, align, 'font-weight:700;font-size:1.6em;line-height:1.25;')}">${_escSlideHtml(block.text)}</div>`;
    case 'text':
      return `<div class="slide-block slide-block-text" style="${_slideBlockInlineStyle(block, align, 'font-size:1.05em;line-height:1.5;')}">${_escSlideHtml(block.text)}</div>`;
    case 'bullets':
      return `<ul class="slide-block slide-block-bullets slide-canvas-bullets" style="${_slideBlockInlineStyle(block, align)}">${block.items.map(it => `<li class="slide-bullet-row slide-bullet-row-readonly"><span class="slide-bullet-text">${_escSlideHtml(it)}</span></li>`).join('')}</ul>`;
    case 'quote':
      return `<blockquote class="slide-block slide-block-quote" style="${_slideBlockInlineStyle(block, align, `border-left:3px solid var(--ss-accent,#4f7df3);padding-left:0.7em;font-style:italic;font-size:1.3em;line-height:1.4;margin:0;`)}">"${_escSlideHtml(block.quote.text)}"${block.quote.author ? `<div style="font-style:normal;font-size:0.7em;font-weight:600;opacity:0.7;margin-top:0.3em;">— ${_escSlideHtml(block.quote.author)}</div>` : ''}</blockquote>`;
    case 'stat':
      return `<div class="slide-block slide-block-stat" style="${_slideBlockInlineStyle(block, align)}"><div style="font-size:2.6em;font-weight:800;color:var(--ss-accent,#4f7df3);line-height:1.05;">${_escSlideHtml(block.stat.value)}</div>${block.stat.label ? `<div style="font-size:0.9em;font-weight:500;color:var(--ss-muted,rgba(100,116,139,0.85));margin-top:0.2em;">${_escSlideHtml(block.stat.label)}</div>` : ''}</div>`;
    case 'visual': {
      if (!block.visualSVG) return '';
      const cap = block.caption ? `<div style="font-size:0.85em;opacity:0.7;text-align:center;margin-top:0.3em;">${_escSlideHtml(block.caption)}</div>` : '';
      return `<div class="slide-block slide-block-visual" style="${_slideBlockInlineStyle(block, 'center', 'display:flex;flex-direction:column;align-items:center;width:100%;')}">${block.visualSVG}${cap}</div>`;
    }
    case 'element': {
      const e = block.element;
      let innerSvg = '';
      if (e.svg) {
        let s = e.svg;
        if (typeof sanitizeHTML === 'function') { try { s = sanitizeHTML(s); } catch (_) {} }
        if (!/^<svg[\s>]/i.test(s.trim())) return '';
        innerSvg = s.replace(/^<svg\b([^>]*)>/i, (m, attrs) => {
          const a = attrs.replace(/\s(?:width|height|style)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
          return `<svg${a} style="width:100%;height:auto;display:block;">`;
        });
      } else {
        if (typeof renderElementById !== 'function') return '';
        const rendered = renderElementById(e.id, `size=100|x=0|y=0|rotate=${e.rotate}${e.color ? `|color=${e.color}` : ''}${e.color2 ? `|color2=${e.color2}` : ''}`);
        if (!rendered) return '';
        innerSvg = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;">${rendered}</svg>`;
      }
      const sizePct = Math.max(3, Math.min(100, e.size || 20));
      return `<div class="slide-block slide-block-element" style="${_slideBlockInlineStyle(block, align)}"><div style="width:${sizePct}%;max-width:180px;display:inline-block;opacity:${e.opacity};transform:rotate(${e.rotate}deg);transform-origin:center;">${innerSvg}</div></div>`;
    }
    case 'table':
      return `<table class="ss-table slide-block slide-block-table" style="${_slideBlockInlineStyle(block, null)}"><thead><tr>${block.table.headers.map(h => `<th>${_escSlideHtml(h)}</th>`).join('')}</tr></thead><tbody>${block.table.rows.map(r => `<tr>${r.map(c => `<td>${_escSlideHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    case 'spacer': {
      const h = block.size === 'lg' ? '1.6em' : (block.size === 'sm' ? '0.4em' : '0.9em');
      return `<div class="slide-block slide-block-spacer" style="height:${h}"></div>`;
    }
    case 'divider':
      return `<hr class="slide-block slide-block-divider" style="border:0;border-top:1px solid rgba(100,116,139,0.3);margin:0.4em 0;width:100%;">`;
    case 'row':
      return `<div class="slide-block slide-block-row" style="display:flex;gap:0.9em;align-items:flex-start;width:100%;">${block.blocks.map(b => `<div style="flex:1 1 0;min-width:0;">${_renderBlockHTML(b, editable, defaultAlign)}</div>`).join('')}</div>`;
    case 'grid':
      return `<div class="slide-block slide-block-grid" style="display:grid;grid-template-columns:repeat(${block.cols},minmax(0,1fr));gap:0.8em;width:100%;">${block.blocks.map(b => `<div style="min-width:0;">${_renderBlockHTML(b, editable, defaultAlign)}</div>`).join('')}</div>`;
    default:
      return '';
  }
}

function _buildFreeLayoutBody(slide, editable, align) {
  if (!slide.blocks || !slide.blocks.length) return _buildContentLayoutBody(slide, editable, align);
  _ensureSlideLayoutStyles();
  const html = slide.blocks.map(b => _renderBlockHTML(b, editable, align)).filter(Boolean).join('');
  if (!html) return _buildContentLayoutBody(slide, editable, align);
  return `<div class="slide-free-stack" style="display:flex;flex-direction:column;gap:0.7em;width:100%;flex:1 1 auto;min-height:0;">${html}</div>`;
}

function _buildSlideLayoutBody(slide, editable, align) {
  _ensureSlideLayoutStyles();
  switch (slide.layout) {
    case 'visual_focus': return slide.visualSVG ? _buildVisualFocusLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'visual_left': return slide.visualSVG ? _buildVisualLeftLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'cards': return (slide.cards && slide.cards.length >= SLIDE_LAYOUT_MIN_CARDS) ? _buildCardsLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'stats': return (slide.stats && slide.stats.length >= SLIDE_LAYOUT_MIN_STATS) ? _buildStatsLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'table': return (slide.table && slide.table.headers && slide.table.rows && slide.table.rows.length) ? _buildTableLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'agenda': return (slide.agenda && slide.agenda.length >= SLIDE_LAYOUT_MIN_AGENDA_ITEMS) ? _buildAgendaLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'title': return _slideLayoutTitleHTML(slide, editable, align);
    case 'section': return _buildSectionLayoutBody(slide, editable, align);
    case 'two_column': return (slide.columns && slide.columns.length === 2) ? _buildTwoColumnLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'three_column': return (slide.columns && slide.columns.length === 3) ? _buildThreeColumnLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'big_stat': return slide.stat ? _buildBigStatLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'quote': return slide.quote ? _buildQuoteLayoutBody(slide, editable) : _buildContentLayoutBody(slide, editable, align);
    case 'timeline': return (slide.steps && slide.steps.length >= SLIDE_LAYOUT_MIN_STEPS) ? _buildTimelineLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'icon_row': return (slide.icons && slide.icons.length >= 2) ? _buildIconRowLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'comparison': return slide.comparison ? _buildComparisonLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'faq': return (slide.faq && slide.faq.length >= SLIDE_LAYOUT_MIN_FAQ_ITEMS) ? _buildFaqLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'profiles': return (slide.profiles && slide.profiles.length >= SLIDE_LAYOUT_MIN_PROFILES) ? _buildProfilesLayoutBody(slide, editable, align) : _buildContentLayoutBody(slide, editable, align);
    case 'free': return _buildFreeLayoutBody(slide, editable, align);
    default: return _buildContentLayoutBody(slide, editable, align);
  }
}

function _buildSlideCanvasHTML(slide, editable) {
  const isTitleOnly = _isTitleOnlySlide(slide);
  const align = slide.layout === 'quote' ? 'center' : (slide.align || (isTitleOnly ? 'center' : 'left'));
  const containerAlignItems = align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start');

  const bgPreset = _resolveSlideBackground(slide);
  const _themeDeck = (typeof APP_STATE !== 'undefined') ? APP_STATE.slideDeck : null;
  const _themed = typeof isSlideDeckThemed === 'function' && isSlideDeckThemed(_themeDeck);
  const centeredLayout = isTitleOnly || slide.layout === 'quote' || slide.layout === 'big_stat';
  const canvasStyle = [
    `text-align:${align}`,
    centeredLayout ? `align-items:${slide.layout === 'quote' ? 'center' : containerAlignItems}` : '',
    slide.layout === 'quote' || slide.layout === 'big_stat' ? 'justify-content:center' : '',
    _themed ? slideThemeCanvasStyle(_themeDeck) : '',
    bgPreset ? `background:${bgPreset.css}` : '',
    'position:relative',
    'overflow:hidden'
  ].filter(Boolean).join(';');
  const canvasClasses = [
    'slide-canvas-16x9',
    isTitleOnly ? 'slide-canvas-title-slide' : '',
    slide.layout ? `slide-canvas-layout-${slide.layout}` : '',
    _themed ? 'ss-themed' : '',
    bgPreset ? 'slide-canvas-has-bg' : '',
    bgPreset && bgPreset.dark ? 'slide-canvas-dark-text' : '',
    editable ? '' : 'slide-canvas-readonly'
  ].filter(Boolean).join(' ');

  return `
    <div class="${canvasClasses}" style="${canvasStyle};">
      ${_buildSlideElementLayerHTML(slide, 'behind')}
      ${_buildSlideLayoutBody(slide, editable, align)}
      ${_buildSlideElementLayerHTML(slide, 'front')}
    </div>`;
}

// ===== DEDICATED SLIDE EDITOR =====
function _currentSlide() {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides[_slideDeckCurrentIndex]) return null;
  return deck.slides[_slideDeckCurrentIndex];
}

function addSlideAfterCurrent() {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides)) return;
  if (deck.slides.length >= SLIDE_DECK_MAX_SLIDES) {
    if (typeof displayToastNotification === 'function') displayToastNotification(`A deck can have at most ${SLIDE_DECK_MAX_SLIDES} slides.`);
    return;
  }
  const current = _currentSlide();
  const inheritedBg = current ? (current.bg || null) : null;
  const inheritedCustomBg = current ? (current.customBg || null) : null;
  const inheritedBgIndex = (current && current.bgIndex != null && !inheritedBg) ? current.bgIndex : null;
  deck.slides.splice(_slideDeckCurrentIndex + 1, 0, {
    title: 'New Slide', bullets: [], visual: null, visualSVG: null, visualChartData: null,
    align: null, bg: inheritedBg, customBg: inheritedCustomBg, bgIndex: inheritedBgIndex, layout: 'content',
    columns: null, stat: null, quote: null, steps: null, subtitle: null,
    cards: null, stats: null, table: null, agenda: null, caption: null,
    elements: [], icons: null, comparison: null, faq: null, profiles: null, blocks: null
  });
  _slideDeckCurrentIndex += 1;
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);
  renderSlideDeckPreview(deck);
}

function deleteCurrentSlide() {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) return;
  if (deck.slides.length <= 1) {
    if (typeof displayToastNotification === 'function') displayToastNotification('A deck needs at least one slide.');
    return;
  }
  deck.slides.splice(_slideDeckCurrentIndex, 1);
  if (_slideDeckCurrentIndex >= deck.slides.length) _slideDeckCurrentIndex = deck.slides.length - 1;
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);
  renderSlideDeckPreview(deck);
}

function addBulletToCurrentSlide() {
  const slide = _currentSlide();
  if (!slide) return;
  if (SLIDE_BULLET_LAYOUTS.indexOf(slide.layout || 'content') === -1) {
    if (typeof displayToastNotification === 'function') displayToastNotification("This slide's layout doesn't show bullet points — switch it to Content first.");
    return;
  }
  if (!Array.isArray(slide.bullets)) slide.bullets = [];
  if (slide.bullets.length >= SLIDE_DECK_MAX_BULLETS_PER_SLIDE) {
    if (typeof displayToastNotification === 'function') displayToastNotification(`A slide can have at most ${SLIDE_DECK_MAX_BULLETS_PER_SLIDE} points.`);
    return;
  }
  slide.bullets.push('New point');
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(APP_STATE.slideDeck);
  renderSlideDeckPreview(APP_STATE.slideDeck);
}

function deleteBulletFromCurrentSlide(idx) {
  const slide = _currentSlide();
  if (!slide || !Array.isArray(slide.bullets)) return;
  slide.bullets.splice(idx, 1);
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(APP_STATE.slideDeck);
  renderSlideDeckPreview(APP_STATE.slideDeck);
}

function setCurrentSlideAlign(align) {
  const slide = _currentSlide();
  if (!slide) return;
  if (slide.layout === 'quote') {
    if (typeof displayToastNotification === 'function') displayToastNotification('Quote slides are always centered.');
    return;
  }
  slide.align = (align === 'left' || align === 'center' || align === 'right') ? align : null;
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(APP_STATE.slideDeck);
  renderSlideDeckPreview(APP_STATE.slideDeck);
}

function onSlideTitleInput(el) {
  const slide = _currentSlide();
  if (!slide) return;
  slide.title = _extractSlideTextWithLatexSource(el);
  _scheduleSlideFit();
  const rail = document.getElementById('slide-thumbnail-rail');
  const titleEl = rail ? rail.querySelectorAll('.slide-thumb-title')[_slideDeckCurrentIndex] : null;
  if (titleEl) titleEl.textContent = slide.title || '\u00A0';
}
function onSlideTitleBlur(el) {
  onSlideTitleInput(el);
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(APP_STATE.slideDeck);
}
function onSlideBulletInput(idx, el) {
  const slide = _currentSlide();
  if (!slide || !Array.isArray(slide.bullets)) return;
  slide.bullets[idx] = _extractSlideTextWithLatexSource(el);
  _scheduleSlideFit();
}
function onSlideBulletBlur(idx, el) {
  onSlideBulletInput(idx, el);
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(APP_STATE.slideDeck);
}

function goToSlide(index) {
  const deck = APP_STATE.slideDeck;
  if (!deck || !deck.slides[index]) return;
  _slideDeckCurrentIndex = index;
  const rail = document.getElementById('slide-thumbnail-rail');
  if (rail) {
    rail.querySelectorAll('.slide-thumb').forEach((el, i) => el.classList.toggle('active', i === index));
  }
  const counter = document.querySelector('.slide-counter');
  if (counter) counter.textContent = `${index + 1} / ${deck.slides.length}`;
  _renderCurrentSlideCanvas(deck);
}

function navigateSlide(direction) {
  const deck = APP_STATE.slideDeck;
  if (!deck || !deck.slides.length) return;
  let next = _slideDeckCurrentIndex + direction;
  if (next < 0) next = 0;
  if (next >= deck.slides.length) next = deck.slides.length - 1;
  goToSlide(next);
}

function viewSlideDeck() {
  if (!APP_STATE.slideDeck) {
    if (typeof displayToastNotification === 'function') displayToastNotification('No slide deck yet — use @Create Slides first.');
    return;
  }
  renderSlideDeckPreview(APP_STATE.slideDeck);
  if (typeof switchPreviewTab === 'function') switchPreviewTab('slides');
  openSlidePresentationMode();
}

// ========================================================================
// FULLSCREEN PRESENTATION MODE
// ========================================================================
let _presentModeIndex = 0;
let _presentWheelLocked = false;

function openSlidePresentationMode() {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
    if (typeof displayToastNotification === 'function') displayToastNotification('No slide deck yet — use @Create Slides first.');
    return;
  }
  _presentModeIndex = Number.isInteger(_slideDeckCurrentIndex) ? _slideDeckCurrentIndex : 0;

  let overlay = document.getElementById('slide-present-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'slide-present-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="slide-present-stage" id="slide-present-stage">
      <button type="button" class="slide-present-close" id="slide-present-close" title="Exit presentation (Esc)" aria-label="Exit presentation">✕</button>
      <button type="button" class="slide-present-arrow slide-present-arrow-left" id="slide-present-arrow-prev" title="Previous slide" aria-label="Previous slide">‹</button>
      <div class="slide-present-canvas-wrap" id="slide-present-canvas-wrap"></div>
      <button type="button" class="slide-present-arrow slide-present-arrow-right" id="slide-present-arrow-next" title="Next slide" aria-label="Next slide">›</button>
      <div class="slide-present-counter" id="slide-present-counter"></div>
    </div>`;
  overlay.style.display = 'flex';

  _renderPresentSlide();

  const closeBtn = document.getElementById('slide-present-close');
  const prevArrow = document.getElementById('slide-present-arrow-prev');
  const nextArrow = document.getElementById('slide-present-arrow-next');
  const stage = document.getElementById('slide-present-stage');
  if (closeBtn) closeBtn.onclick = e => { e.stopPropagation(); closeSlidePresentationMode(); };
  if (prevArrow) prevArrow.onclick = e => { e.stopPropagation(); _presentNavigate(-1); };
  if (nextArrow) nextArrow.onclick = e => { e.stopPropagation(); _presentNavigate(1); };
  if (stage) {
    stage.onclick = _onPresentStageClick;
    stage.addEventListener('wheel', _onPresentWheel, { passive: true });
  }
  document.addEventListener('keydown', _onPresentKeydown);
  document.addEventListener('fullscreenchange', _onPresentFullscreenChange);

  if (stage && stage.requestFullscreen) {
    stage.requestFullscreen().catch(() => { /* denied/unsupported */ });
  }
}

function _renderPresentSlide() {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) return;
  if (_presentModeIndex < 0) _presentModeIndex = 0;
  if (_presentModeIndex >= deck.slides.length) _presentModeIndex = deck.slides.length - 1;

  const wrap = document.getElementById('slide-present-canvas-wrap');
  if (typeof ensureSlideThemeAssets === 'function') ensureSlideThemeAssets(deck);
  if (wrap) { wrap.innerHTML = _buildSlideCanvasHTML(deck.slides[_presentModeIndex], false); _renderMathInSlideElement(wrap); }
  _scheduleSlideFit();

  const counter = document.getElementById('slide-present-counter');
  if (counter) counter.textContent = `${_presentModeIndex + 1} / ${deck.slides.length}`;
  const prevArrow = document.getElementById('slide-present-arrow-prev');
  const nextArrow = document.getElementById('slide-present-arrow-next');
  if (prevArrow) prevArrow.disabled = _presentModeIndex === 0;
  if (nextArrow) nextArrow.disabled = _presentModeIndex === deck.slides.length - 1;

  _slideDeckCurrentIndex = _presentModeIndex;
}

function _presentNavigate(direction) {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) return;
  _presentModeIndex += direction;
  _renderPresentSlide();
}

function _onPresentStageClick(e) {
  if (e.target.closest('.slide-present-close') || e.target.closest('.slide-present-arrow')) return;
  const stage = document.getElementById('slide-present-stage');
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const relX = e.clientX - rect.left;
  _presentNavigate(relX < rect.width / 2 ? -1 : 1);
}

function _onPresentWheel(e) {
  if (_presentWheelLocked) return;
  const delta = e.deltaY || e.detail || 0;
  if (Math.abs(delta) < 4) return;
  _presentWheelLocked = true;
  _presentNavigate(delta > 0 ? 1 : -1);
  setTimeout(() => { _presentWheelLocked = false; }, 450);
}

function _onPresentKeydown(e) {
  if (e.key === 'Escape') { closeSlidePresentationMode(); return; }
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); _presentNavigate(1); return; }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); _presentNavigate(-1); }
}

function _onPresentFullscreenChange() {
  if (!document.fullscreenElement) closeSlidePresentationMode();
}

function closeSlidePresentationMode() {
  const overlay = document.getElementById('slide-present-overlay');
  if (overlay) { overlay.style.display = 'none'; overlay.innerHTML = ''; }
  document.removeEventListener('keydown', _onPresentKeydown);
  document.removeEventListener('fullscreenchange', _onPresentFullscreenChange);
  if (document.fullscreenElement) {
    try { document.exitFullscreen(); } catch (_) { /* already exiting / unsupported */ }
  }
  if (typeof renderSlideDeckPreview === 'function') renderSlideDeckPreview(APP_STATE.slideDeck);
}

// ========================================================================
// SLIDE DECK -> TRUE PDF
// ========================================================================
const SLIDE_PDF_PAGE_WIDTH_IN = 10;
const SLIDE_PDF_PAGE_HEIGHT_IN = 5.63;

function _pdfBulletsHTML(bullets) {
  return (bullets && bullets.length) ? `<ul class="slide-pdf-bullets">${bullets.map(b => `<li>${_escSlideHtml(b)}</li>`).join('')}</ul>` : '';
}

function _buildSlidePDFBody(s, align) {
  if (s.layout === 'section') {
    return `<div class="slide-pdf-accent-bar" style="${align === 'center' ? 'margin-left:auto;margin-right:auto;' : ''}"></div>
      <div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      ${s.subtitle ? `<div class="slide-pdf-subtitle" style="text-align:${align};">${_escSlideHtml(s.subtitle)}</div>` : ''}`;
  }
  if (s.layout === 'two_column' && s.columns && s.columns.length === 2) {
    const cols = s.columns.map((c, ci) => `
      <div class="slide-pdf-col${ci === 1 ? ' slide-pdf-col-right' : ''}">
        ${c.heading ? `<div class="slide-pdf-col-heading">${_escSlideHtml(c.heading)}</div>` : ''}
        ${_pdfBulletsHTML(c.bullets)}
      </div>`).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-columns">${cols}</div>`;
  }
  if (s.layout === 'three_column' && s.columns && s.columns.length === 3) {
    const cols = s.columns.map((c, ci) => `
      <div class="slide-pdf-col${ci > 0 ? ' slide-pdf-col-right' : ''}">
        ${c.heading ? `<div class="slide-pdf-col-heading">${_escSlideHtml(c.heading)}</div>` : ''}
        ${_pdfBulletsHTML(c.bullets)}
      </div>`).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-columns slide-pdf-columns-3">${cols}</div>`;
  }
  if (s.layout === 'big_stat' && s.stat) {
    return `${s.title ? `<div class="slide-pdf-title slide-pdf-stat-eyebrow" style="text-align:${align};">${_escSlideHtml(s.title)}</div>` : ''}
      <div class="slide-pdf-stat-value" style="text-align:${align};">${_escSlideHtml(s.stat.value)}</div>
      ${s.stat.label ? `<div class="slide-pdf-stat-label" style="text-align:${align};">${_escSlideHtml(s.stat.label)}</div>` : ''}
      ${_pdfBulletsHTML(s.bullets)}`;
  }
  if (s.layout === 'quote' && s.quote) {
    return `<div class="slide-pdf-quote-text">"${_escSlideHtml(s.quote.text)}"</div>
      ${s.quote.author ? `<div class="slide-pdf-quote-author">— ${_escSlideHtml(s.quote.author)}</div>` : ''}`;
  }
  if (s.layout === 'timeline' && s.steps && s.steps.length >= SLIDE_LAYOUT_MIN_STEPS) {
    const steps = s.steps.map(st => `
      <div class="slide-pdf-step">
        <div class="slide-pdf-step-dot"></div>
        <div class="slide-pdf-step-label">${_escSlideHtml(st.label)}</div>
        <div class="slide-pdf-step-text">${_escSlideHtml(st.text)}</div>
      </div>`).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-timeline"><div class="slide-pdf-timeline-line"></div>${steps}</div>`;
  }
  if (s.layout === 'visual_focus' && s.visualSVG) {
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-vfocus">${_slideVisualFrameHTML(s, false, 8.6, s.caption ? 3.4 : 3.9)}
      ${s.caption ? `<div class="slide-pdf-caption">${_escSlideHtml(s.caption)}</div>` : ''}</div>`;
  }
  if (s.layout === 'visual_left' && s.visualSVG) {
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-vleft">
        <div class="slide-pdf-vleft-media">${_slideVisualFrameHTML(s, false, 4.4, 3.9)}</div>
        <div class="slide-pdf-vleft-body">${_pdfBulletsHTML(s.bullets)}</div>
      </div>`;
  }
  if (s.layout === 'cards' && s.cards && s.cards.length >= SLIDE_LAYOUT_MIN_CARDS) {
    const cols = s.cards.length === 4 ? 2 : (s.cards.length > 4 ? 3 : s.cards.length);
    const cards = s.cards.map(c => `<div class="slide-pdf-card">
        ${c.heading ? `<div class="slide-pdf-card-h">${_escSlideHtml(c.heading)}</div>` : ''}
        ${c.text ? `<div class="slide-pdf-card-t">${_escSlideHtml(c.text)}</div>` : ''}
      </div>`).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-cards" style="grid-template-columns:repeat(${cols},minmax(0,1fr));">${cards}</div>`;
  }
  if (s.layout === 'stats' && s.stats && s.stats.length >= SLIDE_LAYOUT_MIN_STATS) {
    const size = s.stats.length >= 4 ? '34pt' : (s.stats.length === 3 ? '42pt' : '50pt');
    const items = s.stats.map(st => {
      if (!st.value && st.label) {
        return `<div class="slide-pdf-stats-item"><div style="font-weight:600;font-size:14pt;line-height:1.3;">${_escSlideHtml(st.label)}</div></div>`;
      }
      return `<div class="slide-pdf-stats-item">
        <div class="slide-pdf-stats-value" style="font-size:${size};">${_escSlideHtml(st.value)}</div>
        ${st.label ? `<div class="slide-pdf-stats-label">${_escSlideHtml(st.label)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-stats" style="grid-template-columns:repeat(${s.stats.length},minmax(0,1fr));">${items}</div>`;
  }
  if (s.layout === 'table' && s.table && s.table.rows && s.table.rows.length) {
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <table class="slide-pdf-table"><thead><tr>${s.table.headers.map(h => `<th>${_escSlideHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${s.table.rows.map(r => `<tr>${r.map(c => `<td>${_escSlideHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if (s.layout === 'agenda' && s.agenda && s.agenda.length >= SLIDE_LAYOUT_MIN_AGENDA_ITEMS) {
    const rows = s.agenda.map((it, i) => `<div class="slide-pdf-agenda-row"><div class="slide-pdf-agenda-num">${i + 1}</div><div class="slide-pdf-agenda-txt">${_escSlideHtml(it)}</div></div>`).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-agenda">${rows}</div>`;
  }
  if (s.layout === 'icon_row' && s.icons && s.icons.length >= 2) {
    const items = s.icons.map(it => {
      const e = it.element;
      let inner = '';
      if (e.svg) {
        let s2 = e.svg;
        if (typeof sanitizeHTML === 'function') { try { s2 = sanitizeHTML(s2); } catch (_) {} }
        if (/^<svg[\s>]/i.test(s2.trim())) {
          inner = s2.replace(/^<svg\b([^>]*)>/i, (m, attrs) => {
            const a = attrs.replace(/\s(?:width|height|style)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
            return `<svg${a} style="width:0.5in;height:0.5in;display:block;margin:0 auto 0.08in;">`;
          });
        }
      } else if (typeof renderElementById === 'function') {
        const rendered = renderElementById(e.id, `size=100|x=0|y=0|rotate=${e.rotate}${e.color ? `|color=${e.color}` : ''}${e.color2 ? `|color2=${e.color2}` : ''}`);
        if (rendered) inner = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="width:0.5in;height:0.5in;display:block;margin:0 auto 0.08in;">${rendered}</svg>`;
      }
      return `<div class="slide-pdf-icon-row-item">
        ${inner}
        ${it.label ? `<div class="slide-pdf-icon-row-label">${_escSlideHtml(it.label)}</div>` : ''}
        ${it.text ? `<div class="slide-pdf-icon-row-text">${_escSlideHtml(it.text)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-icon-row">${items}</div>`;
  }
  if (s.layout === 'comparison' && s.comparison) {
    const c = s.comparison;
    const side = (sd, cls, glyph) => `
      <div class="slide-pdf-comparison-side ${cls}">
        ${sd.heading ? `<div class="slide-pdf-comparison-h">${_escSlideHtml(sd.heading)}</div>` : ''}
        <ul class="slide-pdf-comparison-list">${(sd.items || []).map(it => `<li><span class="slide-pdf-comparison-glyph">${glyph}</span><span>${_escSlideHtml(it)}</span></li>`).join('')}</ul>
      </div>`;
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-comparison">
        ${side(c.left, 'slide-pdf-comparison-left', '+')}
        <div class="slide-pdf-comparison-divider"></div>
        ${side(c.right, 'slide-pdf-comparison-right', '\u2013')}
      </div>`;
  }
  if (s.layout === 'faq' && s.faq && s.faq.length >= SLIDE_LAYOUT_MIN_FAQ_ITEMS) {
    const rows = s.faq.map(it => `
      <div class="slide-pdf-faq-item">
        <div class="slide-pdf-faq-q">${_escSlideHtml(it.question)}</div>
        <div class="slide-pdf-faq-a">${_escSlideHtml(it.answer)}</div>
      </div>`).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-faq">${rows}</div>`;
  }
  if (s.layout === 'profiles' && s.profiles && s.profiles.length >= SLIDE_LAYOUT_MIN_PROFILES) {
    const n = s.profiles.length;
    const cols = n >= 5 ? 3 : (n === 4 ? 2 : n);
    const items = s.profiles.map(p => `
      <div class="slide-pdf-profile">
        <div class="slide-pdf-profile-avatar">${_escSlideHtml(_slideInitials(p.name))}</div>
        <div class="slide-pdf-profile-name">${_escSlideHtml(p.name)}</div>
        ${p.role ? `<div class="slide-pdf-profile-role">${_escSlideHtml(p.role)}</div>` : ''}
        ${p.bio ? `<div class="slide-pdf-profile-bio">${_escSlideHtml(p.bio)}</div>` : ''}
      </div>`).join('');
    return `<div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
      <div class="slide-pdf-profiles" style="grid-template-columns:repeat(${cols},minmax(0,1fr));">${items}</div>`;
  }
  if (s.layout === 'free' && Array.isArray(s.blocks) && s.blocks.length) {
    const html = s.blocks.map(b => _slideBlockToPDFHTML(b, align)).filter(Boolean).join('');
    return `<div class="slide-pdf-free-stack">${html}</div>`;
  }
  const visualHTML = s.visualSVG ? `<div class="slide-pdf-visual">${s.visualSVG}</div>` : '';
  return `${_buildSlideElementLayerHTML(s, 'behind')}
    <div class="slide-pdf-title" style="text-align:${align};">${_escSlideHtml(s.title)}</div>
    ${visualHTML}
    ${_pdfBulletsHTML(s.bullets)}
    ${_buildSlideElementLayerHTML(s, 'front')}`;
}

function _slideBlockToPDFHTML(block, defaultAlign) {
  const align = block.align || defaultAlign || 'left';
  const styleBits = [];
  if (block.style) {
    if (block.style.color) styleBits.push(`color:${block.style.color}`);
    if (block.style.weight) styleBits.push(`font-weight:${block.style.weight === 'bold' ? 700 : 400}`);
    if (block.style.italic) styleBits.push('font-style:italic');
    if (block.style.size) styleBits.push(`font-size:${_SLIDE_BLOCK_SIZE_EM[block.style.size] || '1em'}`);
  }
  const inline = `text-align:${align};${styleBits.join(';')}`;
  switch (block.type) {
    case 'heading': return `<div class="slide-pdf-block slide-pdf-block-heading" style="${inline}">${_escSlideHtml(block.text)}</div>`;
    case 'text': return `<div class="slide-pdf-block slide-pdf-block-text" style="${inline}">${_escSlideHtml(block.text)}</div>`;
    case 'bullets': return `<ul class="slide-pdf-block slide-pdf-block-bullets slide-pdf-bullets" style="${inline}">${block.items.map(it => `<li>${_escSlideHtml(it)}</li>`).join('')}</ul>`;
    case 'quote': return `<blockquote class="slide-pdf-block slide-pdf-block-quote" style="${inline}">"${_escSlideHtml(block.quote.text)}"${block.quote.author ? `<div style="font-style:normal;font-size:0.7em;font-weight:600;opacity:0.7;margin-top:0.2em;">— ${_escSlideHtml(block.quote.author)}</div>` : ''}</blockquote>`;
    case 'stat': return `<div class="slide-pdf-block slide-pdf-block-stat" style="${inline}"><div style="font-size:2.6em;font-weight:800;color:var(--ss-accent,#4f7df3);">${_escSlideHtml(block.stat.value)}</div>${block.stat.label ? `<div style="font-size:0.9em;opacity:0.8;">${_escSlideHtml(block.stat.label)}</div>` : ''}</div>`;
    case 'visual': return block.visualSVG ? `<div class="slide-pdf-block slide-pdf-block-visual" style="text-align:center;width:100%;">${block.visualSVG}${block.caption ? `<div style="font-size:0.8em;opacity:0.75;">${_escSlideHtml(block.caption)}</div>` : ''}</div>` : '';
    case 'element': {
      const e = block.element;
      let innerSvg = '';
      if (e.svg) {
        let s = e.svg;
        if (typeof sanitizeHTML === 'function') { try { s = sanitizeHTML(s); } catch (_) {} }
        if (!/^<svg[\s>]/i.test(s.trim())) return '';
        innerSvg = s.replace(/^<svg\b([^>]*)>/i, (m, attrs) => {
          const a = attrs.replace(/\s(?:width|height|style)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
          return `<svg${a} style="width:100%;height:auto;display:block;">`;
        });
      } else {
        if (typeof renderElementById !== 'function') return '';
        const rendered = renderElementById(e.id, `size=100|x=0|y=0|rotate=${e.rotate}${e.color ? `|color=${e.color}` : ''}${e.color2 ? `|color2=${e.color2}` : ''}`);
        if (!rendered) return '';
        innerSvg = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;">${rendered}</svg>`;
      }
      const sizePct = Math.max(3, Math.min(100, e.size || 20));
      return `<div class="slide-pdf-block slide-pdf-block-element" style="${inline}"><div style="width:${sizePct}%;max-width:1.6in;display:inline-block;opacity:${e.opacity};">${innerSvg}</div></div>`;
    }
    case 'table': return `<table class="slide-pdf-table slide-pdf-block" style="${inline}"><thead><tr>${block.table.headers.map(h => `<th>${_escSlideHtml(h)}</th>`).join('')}</tr></thead><tbody>${block.table.rows.map(r => `<tr>${r.map(c => `<td>${_escSlideHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    case 'spacer': { const h = block.size === 'lg' ? '0.3in' : (block.size === 'sm' ? '0.08in' : '0.16in'); return `<div style="height:${h}"></div>`; }
    case 'divider': return `<hr style="border:0;border-top:1px solid rgba(100,116,139,0.3);margin:0.1in 0;width:100%;">`;
    case 'row': return `<div style="display:flex;gap:0.2in;width:100%;">${block.blocks.map(b => `<div style="flex:1 1 0;min-width:0;">${_slideBlockToPDFHTML(b, defaultAlign)}</div>`).join('')}</div>`;
    case 'grid': return `<div style="display:grid;grid-template-columns:repeat(${block.cols},minmax(0,1fr));gap:0.15in;width:100%;">${block.blocks.map(b => `<div style="min-width:0;">${_slideBlockToPDFHTML(b, defaultAlign)}</div>`).join('')}</div>`;
    default: return '';
  }
}

// Pre-renders any $...$/$$...$$ math inside an HTML string into STATIC,
// already-rendered KaTeX markup (using the KaTeX already loaded in THIS
// page) before that HTML gets embedded into the separate iframe document
// used for True-PDF export (see exportSlideDeckToPdf/buildSlideDeckPDFDocument
// below). The iframe is a brand-new document/window with no access to this
// page's `katex` global or math-renderer.js functions, so equations can't be
// rendered a second time inside it — instead we render them HERE, in the
// main page, on a detached offscreen element, and hand the iframe the
// resulting static HTML (a normal .katex span tree) plus the KaTeX
// stylesheet so it only needs to lay it out, not execute anything.
function _prerenderSlideMathForPdfExport(htmlString) {
  try {
    if (typeof processMathEquationsInContainer !== 'function' && typeof forceRenderAllKatexVisuals !== 'function') return htmlString;
    const temp = document.createElement('div');
    temp.style.cssText = 'position:absolute;left:-99999px;top:-99999px;visibility:hidden;';
    temp.innerHTML = htmlString;
    document.body.appendChild(temp);
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(temp);
    if (typeof forceRenderAllKatexVisuals === 'function') forceRenderAllKatexVisuals(temp);
    const out = temp.innerHTML;
    document.body.removeChild(temp);
    return out;
  } catch (e) {
    console.warn('[SlideStudio] math pre-render for PDF export failed:', e);
    return htmlString;
  }
}

function buildSlideDeckPDFDocument(deck) {
  const W = SLIDE_PDF_PAGE_WIDTH_IN, H = SLIDE_PDF_PAGE_HEIGHT_IN;
  // Themed deck: same CSS variables + fonts as the live preview (one theme, three renderers).
  const _themed = typeof isSlideDeckThemed === 'function' && isSlideDeckThemed(deck);
  const _theme = _themed ? resolveSlideTheme(deck) : null;
  const _fontsHref = _themed ? slideThemeFontsHref(_theme) : '';
  const _themeHead = _themed
    ? (_fontsHref ? `<link rel="stylesheet" href="${_fontsHref.replace(/&/g, '&amp;')}">` : '') + `<style>${slideThemeFontFaceCss()}:root{${slideThemeCssVars(_theme)}}</style>`
    : '';
  const slidesHTML = deck.slides.map(s => {
    const isTitleOnly = _isTitleOnlySlide(s);
    const align = s.layout === 'quote' ? 'center' : (s.align || (isTitleOnly ? 'center' : 'left'));
    const bgPreset = _resolveSlideBackground(s, deck);
    const pageStyle = `text-align:${align};position:relative;overflow:hidden;${bgPreset ? `background:${bgPreset.css};` : ''}`;
    const darkCls = bgPreset && bgPreset.dark ? ' slide-pdf-dark-text' : '';
    const layoutCls = s.layout ? ` slide-pdf-layout-${s.layout}` : '';
    return `<section class="slide-pdf-page${isTitleOnly ? ' slide-pdf-title-page' : ''}${darkCls}${layoutCls}" style="${pageStyle}">
      ${_buildSlidePDFBody(s, align)}
    </section>`;
  }).join('');

  const slidesHTMLWithMath = _prerenderSlideMathForPdfExport(slidesHTML);

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>${_escSlideHtml(deck.title || 'Slides')}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  ${_themeHead}
  <style>
    @page { size: ${W}in ${H}in; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
    html, body { margin: 0; padding: 0; background: #f3f4f6; }
    body { font-family: var(--ss-font-body, Arial, 'Noto Sans Bengali', 'Nirmala UI', Helvetica, sans-serif); }
    .slide-pdf-page {
      width: ${W}in; height: ${H}in;
      margin: 0 auto 14px;
      padding: 0.5in 0.65in;
      background: #ffffff;
      color: var(--ss-text,${SLIDE_LAYOUT_DARK_TEXT});
      display: flex;
      flex-direction: column;
      gap: 0.18in;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
      position: relative;
    }
    .slide-pdf-page:last-child { page-break-after: auto; break-after: auto; margin-bottom: 0; }
    .slide-pdf-title-page { align-items: center; justify-content: center; }
    .slide-pdf-accent-bar { width: 0.55in; height: 0.045in; border-radius: 3px; background: linear-gradient(90deg,var(--ss-accent,#4f7df3),#7aa2ff); margin-bottom: 0.02in; }
    .slide-pdf-title-page .slide-pdf-accent-bar { display: none; }
    .slide-pdf-title { font-family: var(--ss-font-heading, inherit); font-size: 26pt; font-weight: 700; color: var(--ss-title,#111827); line-height: 1.25; letter-spacing: -0.01em; }
    .slide-pdf-title-page .slide-pdf-title { font-size: 34pt; text-align: center; }
    .slide-pdf-bullets { margin: 0; padding-left: 0.32in; font-size: 14pt; color: var(--ss-text,#374151); line-height: 1.45; }
    .slide-pdf-bullets li { margin: 0.08in 0; }
    .slide-pdf-visual { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .slide-pdf-visual svg { max-width: 100%; max-height: 100%; }
    .slide-pdf-dark-text, .slide-pdf-dark-text .slide-pdf-title { color: #f8fafc; }
    .slide-pdf-dark-text .slide-pdf-bullets { color: #e2e8f0; }
    .slide-pdf-dark-text .slide-pdf-accent-bar { background: linear-gradient(90deg,#ffffff,#cbd5e1); }
    .slide-pdf-layout-section .slide-pdf-accent-bar { display: block; width: 0.5in; height: 0.05in; border-radius: 3px; background: linear-gradient(90deg,var(--ss-accent,#4f7df3),#7aa2ff); margin-bottom: 0.15in; }
    .slide-pdf-subtitle { font-size: 13pt; font-weight: 500; opacity: 0.75; margin-top: 0.08in; }
    .slide-pdf-columns { display: flex; width: 100%; margin-top: 0.15in; gap: 0.3in; }
    .slide-pdf-columns-3 { gap: 0.2in; }
    .slide-pdf-col { flex: 1 1 0; min-width: 0; }
    .slide-pdf-col-right { border-left: 1px solid rgba(100,116,139,0.25); padding-left: 0.3in; }
    .slide-pdf-col-heading { font-weight: 700; font-size: 13pt; color: var(--ss-accent,#4f7df3); margin-bottom: 0.1in; }
    .slide-pdf-dark-text .slide-pdf-col-heading { color: #ffffff; }
    .slide-pdf-stat-eyebrow { font-size: 14pt; opacity: 0.75; font-weight: 600; }
    .slide-pdf-stat-value { font-size: 56pt; font-weight: 800; color: var(--ss-accent,#4f7df3); line-height: 1.05; }
    .slide-pdf-dark-text .slide-pdf-stat-value { color: #ffffff; }
    .slide-pdf-stat-label { font-size: 15pt; font-weight: 500; opacity: 0.75; margin-top: 0.05in; }
    .slide-pdf-layout-quote { align-items: center; justify-content: center; }
    .slide-pdf-layout-big_stat { justify-content: center; }
    .slide-pdf-quote-text { font-size: 24pt; font-weight: 600; font-style: italic; text-align: center; line-height: 1.4; }
    .slide-pdf-quote-author { margin-top: 0.2in; font-size: 13pt; font-weight: 600; opacity: 0.75; text-align: center; }
    .slide-pdf-timeline { position: relative; display: flex; width: 100%; margin-top: 0.25in; }
    .slide-pdf-timeline-line { position: absolute; top: 0.09in; left: 8%; right: 8%; height: 2px; background: rgba(100,116,139,0.3); }
    .slide-pdf-step { flex: 1 1 0; min-width: 0; text-align: center; position: relative; padding: 0 0.08in; }
    .slide-pdf-step-dot { width: 0.16in; height: 0.16in; border-radius: 50%; background: var(--ss-accent,#4f7df3); margin: 0 auto 0.1in; position: relative; }
    .slide-pdf-step-label { font-weight: 700; font-size: 12pt; margin-bottom: 0.05in; }
    .slide-pdf-step-text { font-size: 10.5pt; opacity: 0.75; line-height: 1.3; }
    .ss-fit-svg { position: relative; margin: 0 auto; }
    .ss-fit-svg > svg { width: 100%; height: auto; display: block; }
    .slide-pdf-vfocus { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; }
    .slide-pdf-caption { font-size: 11pt; opacity: 0.75; text-align: center; margin-top: 0.08in; }
    .slide-pdf-vleft { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; gap: 0.35in; width: 100%; }
    .slide-pdf-vleft-media { flex: 0 0 48%; min-width: 0; }
    .slide-pdf-vleft-body { flex: 1 1 0; min-width: 0; }
    .slide-pdf-cards { display: grid; gap: 0.18in; width: 100%; margin-top: 0.1in; }
    .slide-pdf-card { background: var(--ss-card-bg,rgba(100,116,139,0.12)); border-top: 0.05in solid var(--ss-accent,#4f7df3); border-radius: var(--ss-radius-in,0.08in); padding: 0.16in 0.2in; min-width: 0; }
    .slide-pdf-card-h { font-weight: 700; font-size: 14pt; color: var(--ss-accent,#4f7df3); margin-bottom: 0.06in; }
    .slide-pdf-card-t { font-size: 11.5pt; line-height: 1.35; opacity: 0.85; }
    .slide-pdf-dark-text .slide-pdf-card-h, .slide-pdf-dark-text .slide-pdf-stats-value { color: #ffffff; }
    .slide-pdf-dark-text .slide-pdf-card { border-top-color: #ffffff; }
    .slide-pdf-layout-stats .slide-pdf-title, .slide-pdf-layout-table .slide-pdf-title { margin-bottom: 0.05in; }
    .slide-pdf-stats { display: grid; gap: 0.1in; width: 100%; margin-top: 0.3in; }
    .slide-pdf-stats-item { text-align: center; min-width: 0; padding: 0 0.1in; }
    .slide-pdf-stats-item + .slide-pdf-stats-item { border-left: 1px solid rgba(100,116,139,0.28); }
    .slide-pdf-stats-value { font-weight: 800; color: var(--ss-accent,#4f7df3); line-height: 1.05; }
    .slide-pdf-stats-label { font-size: 12pt; opacity: 0.8; margin-top: 0.08in; line-height: 1.3; }
    .slide-pdf-table { width: 100%; border-collapse: collapse; margin-top: 0.1in; font-size: 12pt; }
    .slide-pdf-table th { background: var(--ss-accent,#4f7df3); color: #ffffff; text-align: left; padding: 0.09in 0.14in; font-weight: 700; }
    .slide-pdf-table td { padding: 0.09in 0.14in; border-bottom: 1px solid rgba(100,116,139,0.3); }
    .slide-pdf-table tr:nth-child(even) td { background: rgba(100,116,139,0.08); }
    .slide-pdf-agenda { display: flex; flex-direction: column; gap: 0.1in; width: 100%; margin-top: 0.1in; }
    .slide-pdf-agenda-row { display: flex; align-items: center; gap: 0.16in; }
    .slide-pdf-agenda-num { flex: 0 0 auto; width: 0.36in; height: 0.36in; border-radius: 50%; background: var(--ss-accent,#4f7df3); color: #ffffff; font-weight: 700; font-size: 12pt; display: flex; align-items: center; justify-content: center; }
    .slide-pdf-agenda-txt { font-size: 16pt; font-weight: 500; min-width: 0; }
    .slide-pdf-icon-row { display: flex; gap: 0.2in; width: 100%; margin-top: 0.15in; }
    .slide-pdf-icon-row-item { flex: 1 1 0; min-width: 0; text-align: center; }
    .slide-pdf-icon-row-label { font-weight: 700; font-size: 13pt; margin-top: 0.06in; }
    .slide-pdf-icon-row-text { font-size: 11pt; opacity: 0.8; margin-top: 0.03in; line-height: 1.3; }
    .slide-pdf-comparison { display: flex; width: 100%; margin-top: 0.15in; gap: 0.3in; }
    .slide-pdf-comparison-side { flex: 1 1 0; min-width: 0; }
    .slide-pdf-comparison-h { font-weight: 700; font-size: 14pt; margin-bottom: 0.08in; }
    .slide-pdf-comparison-left .slide-pdf-comparison-h { color: #1f9d55; }
    .slide-pdf-comparison-right .slide-pdf-comparison-h { color: #e0473f; }
    .slide-pdf-comparison-divider { width: 1px; background: rgba(100,116,139,0.28); flex: 0 0 auto; }
    .slide-pdf-comparison-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.08in; }
    .slide-pdf-comparison-list li { display: flex; align-items: flex-start; gap: 0.08in; font-size: 11.5pt; line-height: 1.35; }
    .slide-pdf-comparison-glyph { flex: 0 0 auto; width: 0.18in; height: 0.18in; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 9pt; color: #ffffff; }
    .slide-pdf-comparison-left .slide-pdf-comparison-glyph { background: #1f9d55; }
    .slide-pdf-comparison-right .slide-pdf-comparison-glyph { background: #e0473f; }
    .slide-pdf-faq { display: flex; flex-direction: column; gap: 0.12in; width: 100%; margin-top: 0.12in; }
    .slide-pdf-faq-item { border-left: 0.04in solid var(--ss-accent,#4f7df3); padding-left: 0.14in; }
    .slide-pdf-faq-q { font-weight: 700; font-size: 13pt; line-height: 1.3; }
    .slide-pdf-faq-a { font-size: 11pt; opacity: 0.82; line-height: 1.35; margin-top: 0.03in; }
    .slide-pdf-profiles { display: grid; gap: 0.16in; width: 100%; margin-top: 0.12in; }
    .slide-pdf-profile { text-align: center; min-width: 0; }
    .slide-pdf-profile-avatar { width: 0.5in; height: 0.5in; border-radius: 50%; background: var(--ss-accent,#4f7df3); color: #ffffff; font-weight: 700; font-size: 14pt; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.08in; }
    .slide-pdf-profile-name { font-weight: 700; font-size: 12.5pt; }
    .slide-pdf-profile-role { font-size: 10pt; opacity: 0.75; margin-top: 0.02in; }
    .slide-pdf-profile-bio { font-size: 9.5pt; opacity: 0.85; margin-top: 0.06in; line-height: 1.3; }
    .slide-pdf-dark-text .slide-pdf-faq-item { border-left-color: #ffffff; }
    .slide-pdf-dark-text .slide-pdf-profile-avatar { background: #ffffff; color: var(--ss-accent,#4f7df3); }
    .slide-pdf-free-stack { display: flex; flex-direction: column; gap: 0.08in; width: 100%; flex: 1 1 auto; min-height: 0; }
    .slide-pdf-block-heading { font-weight: 700; font-size: 20pt; line-height: 1.2; }
    .slide-pdf-block-text { font-size: 12pt; line-height: 1.5; }
    .slide-pdf-block-quote { border-left: 2px solid var(--ss-accent,#4f7df3); padding-left: 0.15in; font-style: italic; font-size: 15pt; line-height: 1.4; margin: 0; }
    .slide-pdf-block-bullets { padding-left: 0.28in; }
    .slide-pdf-block-element { text-align: center; }
    .slide-element-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .slide-pdf-card-h, .slide-pdf-col-heading, .slide-pdf-block-heading, .slide-pdf-stat-value, .slide-pdf-stats-value { font-family: var(--ss-font-heading, inherit); }
    .katex-display { overflow: visible; margin: 0.05in 0; }
    @media print {
      html, body { background: #ffffff !important; }
      .slide-pdf-page { margin: 0 !important; box-shadow: none !important; }
    }
    @media screen {
      body { padding: 16px 0; display: flex; flex-direction: column; align-items: center; }
      .slide-pdf-page { box-shadow: 0 10px 24px -14px rgba(15,23,42,0.35); }
    }
  </style></head>
  <body>${slidesHTMLWithMath}
  <script>
    window.addEventListener('load', function () {
      // wait for web fonts so the print uses the theme's fonts, not a fallback
      var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
      ready.then(function () { window.parent && window.parent.postMessage('slide-pdf-iframe-ready', '*'); });
    });
  <\/script>
  </body></html>`;
}

async function exportSlideDeckToPdf(btn) {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
    if (typeof displayToastNotification === 'function') displayToastNotification('No slide deck to export yet — use @Create Slides first.');
    return;
  }
  if (typeof window.print !== 'function') {
    if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ True PDF requires the browser Print / Save as PDF engine.');
    return;
  }

  if (typeof _setExportButtonBusy === 'function') _setExportButtonBusy(btn, true, 'PDF');
  else if (btn) btn.disabled = true;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener('message', onMessage);
    window.removeEventListener('afterprint', cleanup);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    if (typeof _setExportButtonBusy === 'function') _setExportButtonBusy(btn, false);
    else if (btn) btn.disabled = false;
  };

  const runPrint = () => {
    if (finished) return;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.error('[Slide Studio] slide PDF print failed:', e);
      if (typeof displayToastNotification === 'function') displayToastNotification('True PDF export failed: ' + (e.message || e));
      cleanup();
      return;
    }
    setTimeout(cleanup, 500);
  };

  const onMessage = (e) => {
    if (e.source === iframe.contentWindow && e.data === 'slide-pdf-iframe-ready') runPrint();
  };
  window.addEventListener('message', onMessage);
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => { if (!finished) runPrint(); }, 1200);
  setTimeout(cleanup, 8000);

  try {
    if (typeof waitForKatex === 'function') await waitForKatex(3000);
    iframe.srcdoc = buildSlideDeckPDFDocument(deck);
  } catch (e) {
    console.error('[Slide Studio] slide PDF build failed:', e);
    if (typeof displayToastNotification === 'function') displayToastNotification('True PDF export failed: ' + (e.message || e));
    cleanup();
  }
}

// ===== SVG -> PNG RASTERIZATION =====
const SVG_DEFAULT_W = 700, SVG_DEFAULT_H = 400;

function _getSvgIntrinsicSize(svgString) {
  const tagMatch = String(svgString || '').match(/^\s*<svg\b[^>]*>/i);
  const tag = tagMatch ? tagMatch[0] : '';
  const vb = tag.match(/\sviewBox\s*=\s*["']([^"']+)["']/i);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(parseFloat);
    if (p.length === 4 && p[2] > 0 && p[3] > 0 && isFinite(p[2]) && isFinite(p[3])) {
      return { w: p[2], h: p[3], hasViewBox: true };
    }
  }
  const wm = tag.match(/\swidth\s*=\s*["']?\s*([\d.]+)\s*(?:px)?\s*["']/i);
  const hm = tag.match(/\sheight\s*=\s*["']?\s*([\d.]+)\s*(?:px)?\s*["']/i);
  const w = wm ? parseFloat(wm[1]) : 0, h = hm ? parseFloat(hm[1]) : 0;
  if (w > 0 && h > 0) return { w, h, hasViewBox: false };
  return { w: SVG_DEFAULT_W, h: SVG_DEFAULT_H, hasViewBox: false };
}

function _getSvgAspectRatio(svgString) {
  const s = _getSvgIntrinsicSize(svgString);
  return Math.max(0.2, Math.min(6, s.w / s.h));
}

function _fitAspectInBox(aspect, box) {
  let w = box.w, h = w / aspect;
  if (h > box.h) { h = box.h; w = h * aspect; }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function _forceSvgPixelSize(svgString, wPx, hPx) {
  const intrinsic = _getSvgIntrinsicSize(svgString);
  return String(svgString).replace(/^\s*<svg\b([^>]*)>/i, (m, attrs) => {
    let a = attrs.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
    if (!/\sviewBox\s*=/i.test(a)) a += ` viewBox="0 0 ${intrinsic.w} ${intrinsic.h}"`;
    if (!/\sxmlns\s*=/i.test(' ' + a)) a += ' xmlns="http://www.w3.org/2000/svg"';
    return `<svg${a} width="${wPx}" height="${hPx}">`;
  });
}

function rasterizeSvgPreservingAspect(svgString, longEdgePx) {
  return new Promise((resolve) => {
    try {
      const aspect = _getSvgAspectRatio(svgString);
      const longEdge = Math.max(200, Math.round(longEdgePx || PPTX_VISUAL_RASTER_LONG_EDGE));
      const width = aspect >= 1 ? longEdge : Math.max(1, Math.round(longEdge * aspect));
      const height = aspect >= 1 ? Math.max(1, Math.round(longEdge / aspect)) : longEdge;
      const sized = _forceSvgPixelSize(svgString, width, height);
      const svgBlob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          resolve({ dataUrl: canvas.toDataURL('image/png'), aspect, width, height });
        } catch (e) {
          console.warn('[SlideStudio] rasterize draw failed:', e);
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch (e) {
      console.warn('[SlideStudio] rasterize failed:', e);
      resolve(null);
    }
  });
}

function rasterizeSvgToPngDataUrl(svgString, targetWidthPx, targetHeightPx) {
  return new Promise((resolve) => {
    try {
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(targetWidthPx || img.width || 700));
          canvas.height = Math.max(1, Math.round(targetHeightPx || img.height || 400));
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          console.warn('[SlideStudio] rasterize draw failed:', e);
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch (e) {
      console.warn('[SlideStudio] rasterize failed:', e);
      resolve(null);
    }
  });
}

// ===== NATIVE PPTX CHART BUILDER =====
const SLIDE_CHART_FALLBACK_COLORS = [SLIDE_LAYOUT_ACCENT_PPTX, '22C55E', 'F59E0B', 'EF4444', 'A855F7', '06B6D4', 'EC4899', '84CC16'];
const SLIDE_CHART_TYPE_MAP = { bar: 'bar', line: 'line', pie: 'pie', donut: 'doughnut' };

function _addNativePptxChart(pptx, slide, chartData, box, bgPreset) {
  try {
    const chartTypeKey = SLIDE_CHART_TYPE_MAP[chartData.type];
    if (!chartTypeKey || !pptx.ChartType || !pptx.ChartType[chartTypeKey]) return false;
    const p = chartData.params;
    const labels = (p.labels || []).map(l => String(l == null ? '' : l));
    const values = (p.values || []).map(v => (typeof v === 'number' && isFinite(v)) ? v : 0);
    if (!labels.length || !values.length || labels.length !== values.length) return false;

    const dark = !!(bgPreset && bgPreset.dark);
    const labelColor = dark ? 'F1F5F9' : '374151';
    const gridColor = dark ? '475569' : 'E2E6EE';
    const isSliceType = chartData.type === 'pie' || chartData.type === 'donut';
    const seriesName = p.title || (isSliceType ? 'Share' : 'Value');
    const chartColors = (p.colors && p.colors.length ? p.colors : _pptxChartColors()).map(c => String(c).replace('#', ''));

    const options = {
      x: box.x, y: box.y, w: box.w, h: box.h,
      chartColors,
      showTitle: !!p.title,
      title: p.title || undefined,
      titleColor: dark ? 'F1F5F9' : (_pptxTheme() ? _pptxTheme().text : SLIDE_LAYOUT_DARK_TEXT_PPTX),
      showLegend: isSliceType,
      legendColor: labelColor,
      showValue: true,
      dataLabelColor: labelColor,
      catAxisLabelColor: labelColor,
      valAxisLabelColor: labelColor,
      catAxisLineColor: gridColor
    };
    // Every other text element in the export routes Bangla text to Nirmala
    // UI (see _pptxFontFor); charts were the one place that didn't, so a
    // chart with Bangla category labels or a Bangla title fell back to
    // PowerPoint's chart default and could render as tofu boxes.
    const _chartText = labels.join(' ') + ' ' + (p.title || '') + ' ' + seriesName;
    const _chartFont = _pptxFontFor(_chartText, 'body');
    options.catAxisLabelFontFace = _chartFont;
    options.valAxisLabelFontFace = _chartFont;
    options.dataLabelFontFace = _chartFont;
    options.legendFontFace = _chartFont;
    options.titleFontFace = _chartFont;

    if (chartData.type === 'bar') options.barDir = 'col';
    if (chartData.type === 'donut') options.holeSize = 55;

    slide.addChart(pptx.ChartType[chartTypeKey], [{ name: seriesName, labels, values }], options);
    return true;
  } catch (e) {
    console.warn('[SlideStudio] native PPTX chart failed, falling back to raster image:', e);
    return false;
  }
}

async function _addSlideVisualToPptx(pptx, slide, s, box, bgPreset) {
  if (s.visualChartData && _addNativePptxChart(pptx, slide, s.visualChartData, box, bgPreset)) return true;
  if (!s.visualSVG) return false;
  const r = await rasterizeSvgPreservingAspect(s.visualSVG, PPTX_VISUAL_RASTER_LONG_EDGE);
  if (!r) return false;
  const f = _fitAspectInBox(r.aspect, box);
  slide.addImage({ data: r.dataUrl, x: f.x, y: f.y, w: f.w, h: f.h });
  return true;
}

// Themed decks: set by exportSlideDeckToPptx so every helper reads the same theme.
let _pptxThemeDeck = null;
function _pptxTheme() { return (_pptxThemeDeck && typeof slideThemePptx === 'function') ? slideThemePptx(_pptxThemeDeck) : null; }
function _pptxAccent() { const t = _pptxTheme(); return t ? t.accent : SLIDE_LAYOUT_ACCENT_PPTX; }
function _pptxChartColors() { const t = _pptxTheme(); return t ? t.chart : SLIDE_CHART_FALLBACK_COLORS; }
// role: 'heading' | 'body'. Themed decks get the theme's SAFE PowerPoint fonts (see slide-theme.js).
function _pptxFontFor(text, role) {
  if (_pptxThemeDeck && typeof slideThemePptxFont === 'function') return slideThemePptxFont(text, role || 'body', _pptxThemeDeck);
  return (typeof text === 'string' && /[\u0980-\u09FF]/.test(text)) ? 'Nirmala UI' : 'Arial';
}

function _pptxBulletRuns(bullets) {
  return (bullets || []).map(b => ({
    text: b,
    options: { bullet: true, breakLine: true, fontFace: _pptxFontFor(b) }
  }));
}

// ===== FREE LAYOUT PPTX BLOCK EXPORTER =====
async function _addSlideBlockToPptx(pptx, slide, block, x, y, w, bgPreset, defaultAlign, textColor, bulletColor, mutedColor, depth) {
  const align = block.align || defaultAlign || 'left';
  const isDarkBg = !!(bgPreset && bgPreset.dark);
  const accentColor = isDarkBg ? 'FFFFFF' : _pptxAccent();
  const FSSIZE = { xs: 10, sm: 12, md: 14, lg: 18, xl: 24, xxl: 32 };
  const baseSize = (block.style && block.style.size) ? FSSIZE[block.style.size] : null;
  const color = (block.style && block.style.color) ? block.style.color.replace('#', '').toUpperCase() : textColor;

  if (block.type === 'heading') {
    const size = baseSize || 22;
    slide.addText(block.text, { x, y, w, h: 0.6, align, fontSize: size, bold: true, color, fontFace: _pptxFontFor(block.text), fit: 'shrink' });
    return y + 0.65;
  }
  if (block.type === 'text') {
    const size = baseSize || 13;
    const h = Math.max(0.4, Math.min(3, 0.25 + block.text.length / 90));
    slide.addText(block.text, { x, y, w, h, align, fontSize: size, color, fontFace: _pptxFontFor(block.text), valign: 'top', fit: 'shrink' });
    return y + h + 0.15;
  }
  if (block.type === 'bullets') {
    const size = baseSize || 15;
    const h = Math.min(4.5, 0.35 * block.items.length + 0.3);
    slide.addText(_pptxBulletRuns(block.items), { x, y, w, h, fontSize: size, color: bulletColor, valign: 'top', fit: 'shrink' });
    return y + h + 0.15;
  }
  if (block.type === 'quote') {
    const size = baseSize || 18;
    slide.addText(`"${block.quote.text}"`, { x, y, w, h: 1.0, align, fontSize: size, italic: true, color, fontFace: _pptxFontFor(block.quote.text), fit: 'shrink' });
    let ny = y + 1.05;
    if (block.quote.author) {
      slide.addText(`— ${block.quote.author}`, { x, y: ny, w, h: 0.35, align, fontSize: 12, color: mutedColor, fontFace: _pptxFontFor(block.quote.author), fit: 'shrink' });
      ny += 0.4;
    }
    return ny;
  }
  if (block.type === 'stat') {
    slide.addText(block.stat.value, { x, y, w, h: 0.95, align, fontSize: 44, bold: true, color: accentColor, fontFace: _pptxFontFor(block.stat.value, 'heading'), fit: 'shrink' });
    let ny = y + 1.0;
    if (block.stat.label) {
      slide.addText(block.stat.label, { x, y: ny, w, h: 0.4, align, fontSize: 13, color: mutedColor, fontFace: _pptxFontFor(block.stat.label), fit: 'shrink' });
      ny += 0.45;
    }
    return ny;
  }
  if (block.type === 'visual') {
    const box = { x, y, w, h: 2.5 };
    if (block.visualChartData && _addNativePptxChart(pptx, slide, block.visualChartData, box, bgPreset)) return y + 2.6;
    if (block.visualSVG) {
      const r = await rasterizeSvgPreservingAspect(block.visualSVG, PPTX_VISUAL_RASTER_LONG_EDGE);
      if (r) {
        const f = _fitAspectInBox(r.aspect, box);
        slide.addImage({ data: r.dataUrl, x: f.x, y: f.y, w: f.w, h: f.h });
        return y + f.h + 0.15;
      }
    }
    return y;
  }
  if (block.type === 'element') {
    const e = block.element;
    let svgStr;
    if (e.svg) {
      let s2 = e.svg;
      if (typeof sanitizeHTML === 'function') { try { s2 = sanitizeHTML(s2); } catch (_) {} }
      if (!/^<svg[\s>]/i.test(s2.trim())) return y;
      svgStr = s2;
    } else {
      if (typeof renderElementById !== 'function') return y;
      const inner = renderElementById(e.id, `size=100|x=0|y=0|rotate=${e.rotate}${e.color ? `|color=${e.color}` : ''}${e.color2 ? `|color2=${e.color2}` : ''}`);
      if (!inner) return y;
      svgStr = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    }
    const r = await rasterizeSvgPreservingAspect(svgStr, 800);
    if (!r) return y;
    const boxW = Math.min(w, Math.max(0.6, (e.size || 15) / 100 * 10));
    const f = _fitAspectInBox(r.aspect, { x, y, w: boxW, h: boxW });
    slide.addImage({ data: r.dataUrl, x: f.x, y: f.y, w: f.w, h: f.h });
    return y + f.h + 0.15;
  }
  if (block.type === 'table') {
    const t = block.table;
    const cols = t.headers.length, rowCount = t.rows.length + 1;
    const rowH = Math.min(0.5, 2.4 / rowCount);
    const border = { type: 'solid', pt: 0.75, color: isDarkBg ? '94A3B8' : 'CBD5E1' };
    const headerRow = t.headers.map(h => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: _pptxAccent() }, fontSize: 12, fontFace: _pptxFontFor(h), align: 'left', valign: 'middle', border } }));
    const bodyRows = t.rows.map((row, ri) => row.map(c => ({ text: c, options: { color: bulletColor, fontSize: 11, fontFace: _pptxFontFor(c), align: 'left', valign: 'middle', border, ...(isDarkBg ? {} : { fill: { color: ri % 2 ? 'F8FAFC' : 'FFFFFF' } }) } })));
    slide.addTable([headerRow, ...bodyRows], { x, y, w, colW: Array(cols).fill(w / cols), rowH });
    return y + rowH * rowCount + 0.15;
  }
  if (block.type === 'spacer') {
    const h = block.size === 'lg' ? 0.5 : (block.size === 'sm' ? 0.15 : 0.3);
    return y + h;
  }
  if (block.type === 'divider') {
    slide.addShape('line', { x, y, w, h: 0, line: { color: isDarkBg ? 'FFFFFF' : 'CBD5E1', width: 1 } });
    return y + 0.2;
  }
  if (block.type === 'row' || block.type === 'grid') {
    const inner = block.blocks;
    const n = block.type === 'grid' ? Math.min(block.cols || 2, inner.length) : inner.length;
    const gap = 0.2;
    const cw = (w - gap * (n - 1)) / n;
    let cursorY = y, maxY = y;
    for (let i = 0; i < inner.length; i++) {
      const col = i % n;
      const cx = x + col * (cw + gap);
      const endY = await _addSlideBlockToPptx(pptx, slide, inner[i], cx, cursorY, cw, bgPreset, defaultAlign, textColor, bulletColor, mutedColor, (depth || 0) + 1);
      if (endY > maxY) maxY = endY;
      if (col === n - 1) cursorY = maxY;
    }
    return maxY + 0.15;
  }
  return y;
}

// ===== PPTX EXPORT =====
// ===== MATH FLATTENING FOR PPTX EXPORT =====
// PowerPoint text runs (via PptxGenJS's slide.addText) are plain native
// text — there is no way to embed real KaTeX/LaTeX typesetting inside them
// the way the on-screen editor and the True-PDF export (both real HTML/CSS)
// can. Rather than dumping raw "$...$"/"\frac{...}{...}" source into the
// exported deck, this converts common LaTeX into a readable plain-text
// approximation (unicode Greek letters/operators, "a/b" for \frac, "√(x)"
// for \sqrt, etc.) so the .pptx file still reads sensibly even though the
// equation itself is no longer properly typeset.
const _LATEX_UNICODE_MAP = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  infty: '∞', pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', leq: '≤', geq: '≥', neq: '≠', approx: '≈',
  sum: 'Σ', prod: '∏', int: '∫', partial: '∂', nabla: '∇', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
  cup: '∪', cap: '∩', forall: '∀', exists: '∃', rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftrightarrow: '⇔', propto: '∝', therefore: '∴', because: '∵', degree: '°', ldots: '…', cdots: '⋯'
};

function _flattenLatexToPlainText(str) {
  let s = String(str == null ? '' : str);
  if (!/[$\\]/.test(s)) return s;
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (m, inner) => inner);
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (m, inner) => inner);
  s = s.replace(/\$([\s\S]*?)\$/g, (m, inner) => inner);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (m, inner) => inner);
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  s = s.replace(/\^\{([^{}]*)\}/g, '^$1');
  s = s.replace(/_\{([^{}]*)\}/g, '_$1');
  s = s.replace(/\\(left|right|displaystyle|text|mathrm|operatorname|boldsymbol)\b/g, '');
  s = s.replace(/\\([A-Za-z]+)/g, (m, cmd) => (_LATEX_UNICODE_MAP[cmd] != null ? _LATEX_UNICODE_MAP[cmd] : cmd));
  s = s.replace(/[{}]/g, '');
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}

// Deep-clones a slide and flattens LaTeX math (see above) in every string
// field. Only touches strings that actually contain "$" or "\\" (checked
// inside _flattenLatexToPlainText), so normal text/labels — and non-math
// fields like SVG markup or CSS colors, which essentially never contain
// those characters — pass through unchanged.
function _flattenSlideMathForPlainText(slide) {
  if (!slide) return slide;
  let clone;
  try { clone = JSON.parse(JSON.stringify(slide)); } catch (e) { return slide; }
  const walk = (val) => {
    if (typeof val === 'string') return _flattenLatexToPlainText(val);
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === 'object') {
      const out = {};
      for (const k in val) out[k] = walk(val[k]);
      return out;
    }
    return val;
  };
  return walk(clone);
}

async function exportSlideDeckToPptx(btn) {
  const deck = APP_STATE.slideDeck;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
    if (typeof displayToastNotification === 'function') displayToastNotification('No slide deck to export yet — use @Create Slides first.');
    return;
  }
  if (typeof window.PptxGenJS === 'undefined') {
    if (typeof displayToastNotification === 'function') displayToastNotification('PowerPoint export library failed to load. Check your connection and try again.');
    return;
  }

  if (btn) {
    if (btn._pptxBusy) return;
    btn._pptxBusy = true;
    if (typeof _setExportButtonBusy === 'function') _setExportButtonBusy(btn, true, 'PPTX');
    else { btn.disabled = true; }
  }
  const releaseBtn = () => {
    if (!btn) return;
    btn._pptxBusy = false;
    if (typeof _setExportButtonBusy === 'function') _setExportButtonBusy(btn, false);
    else { btn.disabled = false; }
  };

  if (typeof displayToastNotification === 'function') displayToastNotification('Building PowerPoint file…');

  try {
    const pptx = new window.PptxGenJS();
    _pptxThemeDeck = (typeof isSlideDeckThemed === 'function' && isSlideDeckThemed(deck)) ? deck : null;
    pptx.defineLayout({ name: 'AIPDF_16x9', width: 10, height: 5.63 });
    pptx.layout = 'AIPDF_16x9';

    const _TH = _pptxTheme();
    const ACCENT = _TH ? _TH.accent : SLIDE_LAYOUT_ACCENT_PPTX;
    const DARK = _TH ? _TH.text : SLIDE_LAYOUT_DARK_TEXT_PPTX;
    const TITLE = _TH ? _TH.title : DARK;

    for (let i = 0; i < deck.slides.length; i++) {
      const s = deck.slides[i];
      const slide = pptx.addSlide();
      const isTitleOnly = (typeof _isTitleOnlySlide === 'function') ? _isTitleOnlySlide(s) : ((!s.bullets || !s.bullets.length) && !s.visualSVG);
      const textAlign = s.layout === 'quote' ? 'center' : (s.align || (isTitleOnly ? 'center' : 'left'));

      const bgPreset = (typeof _resolveSlideBackground === 'function') ? _resolveSlideBackground(s, deck) : null;
      if (bgPreset) slide.background = { color: bgPreset.pptx };
      const textColor = bgPreset && bgPreset.dark ? 'FFFFFF' : TITLE;
      const bulletColor = bgPreset && bgPreset.dark ? 'F1F5F9' : DARK;
      const mutedColor = bgPreset && bgPreset.dark ? 'E2E8F0' : (_TH ? _TH.muted : '64748B');

      const _addElementLayer = async (layer) => {
        if (!Array.isArray(s.elements) || !s.elements.length) return;
        for (const e of s.elements) {
          if (e.layer !== layer) continue;
          let svgStr;
          if (e.svg) {
            let s2 = e.svg;
            if (typeof sanitizeHTML === 'function') { try { s2 = sanitizeHTML(s2); } catch (_) {} }
            if (!/^<svg[\s>]/i.test(s2.trim())) continue;
            svgStr = s2;
          } else {
            if (typeof renderElementById !== 'function') continue;
            const inner = renderElementById(e.id, `size=100|x=0|y=0|rotate=${e.rotate}${e.color ? `|color=${e.color}` : ''}${e.color2 ? `|color2=${e.color2}` : ''}${e.color3 ? `|color3=${e.color3}` : ''}${e.color4 ? `|color4=${e.color4}` : ''}${e.color5 ? `|color5=${e.color5}` : ''}`);
            if (!inner) continue;
            svgStr = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
          }
          const r = await rasterizeSvgPreservingAspect(svgStr, 800);
          if (!r) continue;
          const elW = Math.max(0.15, e.size / 100 * 10);
          const elH = elW / r.aspect;
          slide.addImage({ data: r.dataUrl, x: e.x / 100 * 10, y: e.y / 100 * 5.63, w: elW, h: elH, transparency: e.opacity < 1 ? Math.round((1 - e.opacity) * 100) : undefined });
        }
      };

      try {
        await _addElementLayer('behind');

        if (s.layout === 'section') {
          const sectionAccentW = 0.55;
          const sectionAccentX = textAlign === 'center'
            ? (10 - sectionAccentW) / 2
            : (textAlign === 'right' ? 9.4 - sectionAccentW : 0.6);
          slide.addShape('rect', { x: sectionAccentX, y: 2.05, w: sectionAccentW, h: 0.05, fill: { color: ACCENT } });
          slide.addText(s.title || '', { x: 0.6, y: 2.2, w: 8.8, h: 1.0, align: textAlign, fontSize: 32, bold: true, color: textColor, fontFace: _pptxFontFor(s.title, 'heading'), fit: 'shrink' });
          if (s.subtitle) slide.addText(s.subtitle, { x: 0.6, y: 3.15, w: 8.8, h: 0.6, align: textAlign, fontSize: 15, color: mutedColor, fontFace: _pptxFontFor(s.subtitle), fit: 'shrink' });
          continue;
        }

        if (s.layout === 'quote' && s.quote) {
          slide.addText(`"${s.quote.text || ''}"`, { x: 0.9, y: 1.6, w: 8.2, h: 2.0, align: 'center', valign: 'middle', fontSize: 24, italic: true, bold: true, color: textColor, fontFace: _pptxFontFor(s.quote.text), fit: 'shrink' });
          if (s.quote.author) slide.addText(`— ${s.quote.author}`, { x: 0.9, y: 3.65, w: 8.2, h: 0.5, align: 'center', fontSize: 14, bold: true, color: mutedColor, fontFace: _pptxFontFor(s.quote.author), fit: 'shrink' });
          continue;
        }

        if (s.layout === 'big_stat' && s.stat) {
          const top = 1.3;
          if (s.title) slide.addText(s.title, { x: 0.6, y: 0.7, w: 8.8, h: 0.5, align: textAlign, fontSize: 15, bold: true, color: mutedColor, fontFace: _pptxFontFor(s.title, 'heading'), fit: 'shrink' });
          slide.addText(s.stat.value || '', { x: 0.6, y: top, w: 8.8, h: 1.5, align: textAlign, fontSize: 60, bold: true, color: bgPreset && bgPreset.dark ? 'FFFFFF' : ACCENT, fontFace: _pptxFontFor(s.stat.value, 'heading'), fit: 'shrink' });
          if (s.stat.label) slide.addText(s.stat.label, { x: 0.6, y: 2.75, w: 8.8, h: 0.6, align: textAlign, fontSize: 16, color: mutedColor, fontFace: _pptxFontFor(s.stat.label), fit: 'shrink' });
          if (s.bullets && s.bullets.length) {
            slide.addText(_pptxBulletRuns(s.bullets), { x: 0.6, y: 3.5, w: 8.8, h: 1.6, fontSize: 14, color: bulletColor, valign: 'top', fit: 'shrink' });
          }
          continue;
        }

        if (s.layout === 'two_column' && s.columns && s.columns.length === 2) {
          slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9.0, h: 0.7, fontSize: 26, bold: true, color: textColor, fontFace: _pptxFontFor(s.title, 'heading'), align: textAlign, fit: 'shrink' });
          const colW = 4.2;
          slide.addShape('line', { x: 5.0, y: 1.35, w: 0, h: 3.9, line: { color: bgPreset && bgPreset.dark ? 'FFFFFF' : 'CBD5E1', width: 1 } });
          s.columns.forEach((c, ci) => {
            const x = ci === 0 ? 0.5 : 5.3;
            if (c.heading) slide.addText(c.heading, { x, y: 1.35, w: colW, h: 0.5, fontSize: 16, bold: true, color: bgPreset && bgPreset.dark ? 'FFFFFF' : ACCENT, fontFace: _pptxFontFor(c.heading, 'heading'), fit: 'shrink' });
            if (c.bullets && c.bullets.length) {
              slide.addText(_pptxBulletRuns(c.bullets), { x, y: 1.9, w: colW, h: 3.3, fontSize: 14, color: bulletColor, valign: 'top', fit: 'shrink' });
            }
          });
          continue;
        }

        if (s.layout === 'three_column' && s.columns && s.columns.length === 3) {
          slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9.0, h: 0.7, fontSize: 26, bold: true, color: textColor, fontFace: _pptxFontFor(s.title, 'heading'), align: textAlign, fit: 'shrink' });
          const colW = 2.85;
          [3.35, 6.15].forEach(lx => slide.addShape('line', { x: lx, y: 1.35, w: 0, h: 3.9, line: { color: bgPreset && bgPreset.dark ? 'FFFFFF' : 'CBD5E1', width: 1 } }));
          s.columns.forEach((c, ci) => {
            const x = 0.5 + ci * 3.0;
            if (c.heading) slide.addText(c.heading, { x, y: 1.35, w: colW, h: 0.5, fontSize: 15, bold: true, color: bgPreset && bgPreset.dark ? 'FFFFFF' : ACCENT, fontFace: _pptxFontFor(c.heading, 'heading'), fit: 'shrink' });
            if (c.bullets && c.bullets.length) {
              slide.addText(_pptxBulletRuns(c.bullets), { x, y: 1.9, w: colW, h: 3.3, fontSize: 12, color: bulletColor, valign: 'top', fit: 'shrink' });
            }
          });
          continue;
        }

        if (s.layout === 'timeline' && s.steps && s.steps.length >= SLIDE_LAYOUT_MIN_STEPS) {
          slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9.0, h: 0.7, fontSize: 26, bold: true, color: textColor, fontFace: _pptxFontFor(s.title, 'heading'), align: textAlign, fit: 'shrink' });
          const n = s.steps.length, colW = 8.6 / n;
          slide.addShape('line', { x: 0.7, y: 2.0, w: 8.6, h: 0, line: { color: bgPreset && bgPreset.dark ? 'FFFFFF' : 'CBD5E1', width: 1.5 } });
          s.steps.forEach((st, si) => {
            const x = 0.7 + si * colW;
            slide.addShape('ellipse', { x: x + colW / 2 - 0.08, y: 1.92, w: 0.16, h: 0.16, fill: { color: bgPreset && bgPreset.dark ? 'FFFFFF' : ACCENT } });
            slide.addText(st.label || '', { x, y: 2.25, w: colW, h: 0.5, align: 'center', fontSize: 13, bold: true, color: textColor, fontFace: _pptxFontFor(st.label), fit: 'shrink' });
            slide.addText(st.text || '', { x, y: 2.7, w: colW, h: 1.4, align: 'center', fontSize: 11, color: mutedColor, fontFace: _pptxFontFor(st.text), valign: 'top', fit: 'shrink' });
          });
          continue;
        }

        const isDarkBg = !!(bgPreset && bgPreset.dark);
        const accentColor = isDarkBg ? 'FFFFFF' : ACCENT;
        const ruleColor = isDarkBg ? 'FFFFFF' : 'CBD5E1';
        const addSlideTitle = () => slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9.0, h: 0.7, fontSize: 26, bold: true, color: textColor, fontFace: _pptxFontFor(s.title, 'heading'), align: textAlign, fit: 'shrink' });

        if (s.layout === 'visual_focus' && (s.visualSVG || s.visualChartData)) {
          addSlideTitle();
          const box = { x: 0.7, y: 1.3, w: 8.6, h: s.caption ? 3.4 : 3.9 };
          await _addSlideVisualToPptx(pptx, slide, s, box, bgPreset);
          if (s.caption) slide.addText(s.caption, { x: 0.7, y: 4.75, w: 8.6, h: 0.45, align: 'center', fontSize: 13, color: mutedColor, fontFace: _pptxFontFor(s.caption), fit: 'shrink' });
          continue;
        }

        if (s.layout === 'visual_left' && (s.visualSVG || s.visualChartData)) {
          addSlideTitle();
          await _addSlideVisualToPptx(pptx, slide, s, { x: 0.5, y: 1.35, w: 4.4, h: 3.9 }, bgPreset);
          if (s.bullets && s.bullets.length) {
            slide.addText(_pptxBulletRuns(s.bullets), { x: 5.2, y: 1.35, w: 4.3, h: 3.9, fontSize: 16, color: bulletColor, valign: 'middle', fit: 'shrink' });
          }
          continue;
        }

        if (s.layout === 'cards' && s.cards && s.cards.length >= SLIDE_LAYOUT_MIN_CARDS) {
          addSlideTitle();
          const n = s.cards.length, cols = n === 4 ? 2 : (n > 4 ? 3 : n), rows = Math.ceil(n / cols);
          const gap = 0.25, areaX = 0.5, areaY = 1.4, areaW = 9.0, areaH = 3.8;
          const cw = (areaW - gap * (cols - 1)) / cols, ch = (areaH - gap * (rows - 1)) / rows;
          s.cards.forEach((c, ci) => {
            const x = areaX + (ci % cols) * (cw + gap), y = areaY + Math.floor(ci / cols) * (ch + gap);
            slide.addShape('roundRect', { x, y, w: cw, h: ch, rectRadius: 0.08, fill: isDarkBg ? { color: 'FFFFFF', transparency: 88 } : { color: 'F1F5F9' }, line: { color: isDarkBg ? 'FFFFFF' : 'E2E8F0', width: 0.75 } });
            slide.addShape('rect', { x: x + 0.15, y, w: cw - 0.3, h: 0.06, fill: { color: accentColor } });
            if (c.heading) slide.addText(c.heading, { x: x + 0.15, y: y + 0.18, w: cw - 0.3, h: 0.5, fontSize: n === 4 ? 15 : 17, bold: true, color: accentColor, fontFace: _pptxFontFor(c.heading, 'heading'), valign: 'top', fit: 'shrink' });
            if (c.text) slide.addText(c.text, { x: x + 0.15, y: y + 0.72, w: cw - 0.3, h: ch - 0.85, fontSize: n === 4 ? 12 : 13, color: bulletColor, fontFace: _pptxFontFor(c.text), valign: 'top', fit: 'shrink' });
          });
          continue;
        }

        if (s.layout === 'stats' && s.stats && s.stats.length >= SLIDE_LAYOUT_MIN_STATS) {
          addSlideTitle();
          const n = s.stats.length, gap = 0.2, colW = (9.0 - gap * (n - 1)) / n;
          s.stats.forEach((st, si) => {
            const x = 0.5 + si * (colW + gap);
            if (!st.value && st.label) {
              slide.addText(st.label, { x, y: 1.9, w: colW, h: 2.4, align: 'center', valign: 'middle', fontSize: 16, bold: true, color: textColor, fontFace: _pptxFontFor(st.label), fit: 'shrink' });
            } else {
              slide.addText(st.value || '', { x, y: 1.9, w: colW, h: 1.2, align: 'center', valign: 'middle', fontSize: n >= 4 ? 34 : (n === 3 ? 42 : 50), bold: true, color: accentColor, fontFace: _pptxFontFor(st.value), fit: 'shrink' });
              if (st.label) slide.addText(st.label, { x, y: 3.15, w: colW, h: 1.1, align: 'center', valign: 'top', fontSize: 14, color: mutedColor, fontFace: _pptxFontFor(st.label), fit: 'shrink' });
            }
            if (si > 0) slide.addShape('line', { x: x - gap / 2, y: 2.0, w: 0, h: 2.1, line: { color: ruleColor, width: 1 } });
          });
          continue;
        }

        if (s.layout === 'table' && s.table && s.table.headers && s.table.rows && s.table.rows.length) {
          addSlideTitle();
          const cols = s.table.headers.length, rowCount = s.table.rows.length + 1;
          const rowH = Math.min(0.55, 3.8 / rowCount);
          const border = { type: 'solid', pt: 0.75, color: isDarkBg ? '94A3B8' : 'CBD5E1' };
          const headerRow = s.table.headers.map(h => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT }, fontSize: 13, fontFace: _pptxFontFor(h), align: 'left', valign: 'middle', border } }));
          const bodyRows = s.table.rows.map((r, ri) => r.map(c => ({ text: c, options: { color: bulletColor, fontSize: 12, fontFace: _pptxFontFor(c), align: 'left', valign: 'middle', border, ...(isDarkBg ? {} : { fill: { color: ri % 2 ? 'F8FAFC' : 'FFFFFF' } }) } })));
          slide.addTable([headerRow, ...bodyRows], { x: 0.5, y: 1.4, w: 9.0, colW: Array(cols).fill(9.0 / cols), rowH });
          continue;
        }

        if (s.layout === 'agenda' && s.agenda && s.agenda.length >= SLIDE_LAYOUT_MIN_AGENDA_ITEMS) {
          addSlideTitle();
          const n = s.agenda.length, step = Math.min(0.7, 3.8 / n);
          s.agenda.forEach((it, ai) => {
            const y = 1.4 + ai * step;
            slide.addText(String(ai + 1), { shape: 'ellipse', x: 0.7, y, w: 0.42, h: 0.42, fill: { color: ACCENT }, align: 'center', valign: 'middle', fontSize: 14, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
            slide.addText(it, { x: 1.35, y, w: 8.0, h: 0.42, fontSize: 18, color: textColor, fontFace: _pptxFontFor(it), valign: 'middle', fit: 'shrink' });
          });
          continue;
        }

        if (s.layout === 'icon_row' && Array.isArray(s.icons) && s.icons.length >= 2) {
          addSlideTitle();
          const n = s.icons.length, colW = 9.0 / n;
          for (let ii = 0; ii < n; ii++) {
            const it = s.icons[ii];
            const e = it.element;
            const x = 0.5 + ii * colW;
            let svgStr = null;
            if (e.svg) {
              let s2 = e.svg;
              if (typeof sanitizeHTML === 'function') { try { s2 = sanitizeHTML(s2); } catch (_) {} }
              if (/^<svg[\s>]/i.test(s2.trim())) svgStr = s2;
            } else if (typeof renderElementById === 'function') {
              const inner = renderElementById(e.id, `size=100|x=0|y=0|rotate=${e.rotate}${e.color ? `|color=${e.color}` : ''}${e.color2 ? `|color2=${e.color2}` : ''}`);
              if (inner) svgStr = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
            }
            if (svgStr) {
              const r = await rasterizeSvgPreservingAspect(svgStr, 600);
              if (r) {
                const iconW = Math.min(1.2, colW * 0.4);
                const iconH = iconW / r.aspect;
                slide.addImage({ data: r.dataUrl, x: x + (colW - iconW) / 2, y: 1.4, w: iconW, h: iconH });
              }
            }
            if (it.label) slide.addText(it.label, { x, y: 2.85, w: colW, h: 0.5, align: 'center', fontSize: 14, bold: true, color: textColor, fontFace: _pptxFontFor(it.label), fit: 'shrink' });
            if (it.text) slide.addText(it.text, { x, y: 3.35, w: colW, h: 1.4, align: 'center', fontSize: 11, color: mutedColor, fontFace: _pptxFontFor(it.text), valign: 'top', fit: 'shrink' });
          }
          continue;
        }

        if (s.layout === 'comparison' && s.comparison) {
          addSlideTitle();
          const c = s.comparison;
          const colW = 4.2;
          slide.addShape('line', { x: 5.0, y: 1.35, w: 0, h: 3.9, line: { color: ruleColor, width: 1 } });
          const GREEN = '1F9D55', RED = 'E0473F';
          [{ data: c.left, x: 0.5, color: GREEN, glyph: '+' }, { data: c.right, x: 5.3, color: RED, glyph: '\u2013' }].forEach(side => {
            let y = 1.35;
            if (side.data.heading) {
              slide.addText(side.data.heading, { x: side.x, y, w: colW, h: 0.5, fontSize: 16, bold: true, color: isDarkBg ? textColor : side.color, fontFace: _pptxFontFor(side.data.heading, 'heading'), fit: 'shrink' });
              y += 0.55;
            }
            (side.data.items || []).forEach(it => {
              slide.addText(`${side.glyph}  ${it}`, { x: side.x, y, w: colW, h: 0.5, fontSize: 13, color: bulletColor, fontFace: _pptxFontFor(it), valign: 'top', fit: 'shrink' });
              y += 0.5;
            });
          });
          continue;
        }

        if (s.layout === 'faq' && Array.isArray(s.faq) && s.faq.length >= SLIDE_LAYOUT_MIN_FAQ_ITEMS) {
          addSlideTitle();
          const n = s.faq.length, step = 3.8 / n;
          s.faq.forEach((it, fi) => {
            const y = 1.4 + fi * step;
            slide.addShape('rect', { x: 0.55, y: y + 0.02, w: 0.04, h: step - 0.12, fill: { color: accentColor } });
            slide.addText(it.question || '', { x: 0.75, y, w: 8.7, h: step * 0.42, fontSize: 14, bold: true, color: textColor, fontFace: _pptxFontFor(it.question), valign: 'top', fit: 'shrink' });
            slide.addText(it.answer || '', { x: 0.75, y: y + step * 0.42, w: 8.7, h: step * 0.55, fontSize: 12, color: mutedColor, fontFace: _pptxFontFor(it.answer), valign: 'top', fit: 'shrink' });
          });
          continue;
        }

        if (s.layout === 'profiles' && Array.isArray(s.profiles) && s.profiles.length >= SLIDE_LAYOUT_MIN_PROFILES) {
          addSlideTitle();
          const n = s.profiles.length, cols = n >= 5 ? 3 : (n === 4 ? 2 : n), rows = Math.ceil(n / cols);
          const gap = 0.25, areaX = 0.5, areaY = 1.4, areaW = 9.0, areaH = 3.8;
          const cw = (areaW - gap * (cols - 1)) / cols, ch = (areaH - gap * (rows - 1)) / rows;
          s.profiles.forEach((p, pi) => {
            const x = areaX + (pi % cols) * (cw + gap), y = areaY + Math.floor(pi / cols) * (ch + gap);
            const avatarSize = 0.55;
            slide.addShape('ellipse', { x: x + (cw - avatarSize) / 2, y: y + 0.05, w: avatarSize, h: avatarSize, fill: { color: accentColor } });
            slide.addText(_slideInitials(p.name), { x: x + (cw - avatarSize) / 2, y: y + 0.05, w: avatarSize, h: avatarSize, align: 'center', valign: 'middle', fontSize: 14, bold: true, color: isDarkBg ? ACCENT : 'FFFFFF', fontFace: 'Arial' });
            slide.addText(p.name || '', { x, y: y + 0.65, w: cw, h: 0.35, align: 'center', fontSize: 13, bold: true, color: textColor, fontFace: _pptxFontFor(p.name), fit: 'shrink' });
            if (p.role) slide.addText(p.role, { x, y: y + 0.98, w: cw, h: 0.3, align: 'center', fontSize: 11, color: mutedColor, fontFace: _pptxFontFor(p.role), fit: 'shrink' });
            if (p.bio) slide.addText(p.bio, { x, y: y + 1.28, w: cw, h: ch - 1.3, align: 'center', valign: 'top', fontSize: 10, color: bulletColor, fontFace: _pptxFontFor(p.bio), fit: 'shrink' });
          });
          continue;
        }

        if (s.layout === 'free' && Array.isArray(s.blocks) && s.blocks.length) {
          let cursorY = 0.35;
          for (const b of s.blocks) {
            if (cursorY > 5.3) break;
            cursorY = await _addSlideBlockToPptx(pptx, slide, b, 0.5, cursorY, 9.0, bgPreset, textAlign, textColor, bulletColor, mutedColor, 0);
          }
          continue;
        }

        if (isTitleOnly) {
          slide.addText(s.title || deck.title || '', {
            x: 0.6, y: 2.2, w: 8.8, h: 1.4, align: textAlign, fontSize: 36, bold: true, color: textColor, fontFace: _pptxFontFor(s.title || deck.title, 'heading'), fit: 'shrink'
          });
          continue;
        }

        // "content" layout (and any unrecognized fallback) — original template.
        slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9.0, h: 0.8, fontSize: 26, bold: true, color: textColor, fontFace: _pptxFontFor(s.title, 'heading'), align: textAlign, fit: 'shrink' });

        const hasBullets = s.bullets && s.bullets.length;
        const contentVisualBox = hasBullets ? { x: 5.15, y: 1.35, w: 4.35, h: 3.9 } : { x: 0.9, y: 1.35, w: 8.2, h: 3.9 };
        await _addSlideVisualToPptx(pptx, slide, s, contentVisualBox, bgPreset);

        if (s.bullets && s.bullets.length) {
          const bulletWidth = s.visualSVG ? 4.35 : 9.0;
          slide.addText(
            _pptxBulletRuns(s.bullets),
            { x: 0.5, y: 1.35, w: bulletWidth, h: 3.9, fontSize: 16, color: bulletColor, valign: 'top', fit: 'shrink' }
          );
        }
      } finally {
        await _addElementLayer('front');
      }
    }

    // \w is ASCII-only and the old pattern explicitly whitelisted just
    // Bangla on top of that, so a deck titled entirely in Arabic/Chinese/
    // Cyrillic/Devanagari got stripped down to '' and fell back to the
    // generic "slides.pptx". Using the Unicode property escapes (with a
    // safe fallback for very old browsers) keeps whatever script the title
    // actually uses.
    let _pptxSafeNameRe;
    try { _pptxSafeNameRe = /[^\p{L}\p{N}\-_ ]+/gu; }
    catch (_) { _pptxSafeNameRe = /[^\w\-\u0980-\u09FF ]+/g; }
    const safeName = (deck.title || 'slides').replace(_pptxSafeNameRe, '').trim().slice(0, 60) || 'slides';
    await pptx.writeFile({ fileName: `${safeName}.pptx` });
    if (typeof displayToastNotification === 'function') displayToastNotification('✅ PowerPoint file downloaded.');
  } catch (e) {
    console.error('[Slide Studio] pptx export failed:', e);
    if (typeof displayToastNotification === 'function') displayToastNotification(`PowerPoint export failed: ${e.message || e}`);
  } finally {
    releaseBtn();
  }
}

// ============================================================
// WINDOW EXPOSURE — Slide Studio
// ============================================================
window.SLIDE_LAYOUTS = SLIDE_LAYOUTS;
window.getSlideLayoutCatalogForPrompt = getSlideLayoutCatalogForPrompt;
window.buildSlideDeckRules = buildSlideDeckRules;
window.sanitizeSlideDeckJSON = sanitizeSlideDeckJSON;
window.renderImagePlaceholderSVG = renderImagePlaceholderSVG;
window.injectImagePlaceholders = injectImagePlaceholders;
window.resolveSlideVisualSVG = resolveSlideVisualSVG;
window.generateSlideDeckDirectMode = generateSlideDeckDirectMode;
window.renderSlideDeckPreview = renderSlideDeckPreview;
window.goToSlide = goToSlide;
window.navigateSlide = navigateSlide;
window.viewSlideDeck = viewSlideDeck;
window.openSlidePresentationMode = openSlidePresentationMode;
window.closeSlidePresentationMode = closeSlidePresentationMode;
window.rasterizeSvgToPngDataUrl = rasterizeSvgToPngDataUrl;
window.rasterizeSvgPreservingAspect = rasterizeSvgPreservingAspect;
window.exportSlideDeckToPptx = exportSlideDeckToPptx;
window.exportSlideDeckToPdf = exportSlideDeckToPdf;
window.buildSlideDeckPDFDocument = buildSlideDeckPDFDocument;
window.persistSlideDeckToActiveTab = persistSlideDeckToActiveTab;
window.addSlideAfterCurrent = addSlideAfterCurrent;
window.deleteCurrentSlide = deleteCurrentSlide;
window.addBulletToCurrentSlide = addBulletToCurrentSlide;
window.deleteBulletFromCurrentSlide = deleteBulletFromCurrentSlide;
window.setCurrentSlideAlign = setCurrentSlideAlign;
window.onSlideTitleInput = onSlideTitleInput;
window.onSlideTitleBlur = onSlideTitleBlur;
window.onSlideBulletInput = onSlideBulletInput;
window.onSlideBulletBlur = onSlideBulletBlur;
window.SLIDE_BACKGROUNDS = SLIDE_BACKGROUNDS;
window.getSlideBackgroundById = getSlideBackgroundById;
window.toggleSlideBackgroundPicker = toggleSlideBackgroundPicker;
window.setCurrentSlideBackground = setCurrentSlideBackground;
window.applyCurrentBackgroundToAllSlides = applyCurrentBackgroundToAllSlides;
window.useDeckBackground = useDeckBackground;
window.getSlideAutoBackgroundMode = getSlideAutoBackgroundMode;
window.setSlideAutoBackgroundMode = setSlideAutoBackgroundMode;
window.getSlideAutoBackgroundEnabled = getSlideAutoBackgroundEnabled;
window.setSlideAutoBackgroundEnabled = function (enabled) { return setSlideAutoBackgroundMode(enabled ? 'single' : 'off'); };
window.toggleSlideAutoBackground = toggleSlideAutoBackground;
window.cycleSlideAutoBackgroundMode = cycleSlideAutoBackgroundMode;
window.setCustomBgScope = setCustomBgScope;
window.startCustomSlideBackgroundCommand = startCustomSlideBackgroundCommand;
window.applyCustomSlideBackgroundViaAI = applyCustomSlideBackgroundViaAI;
window.startSlideAIEditCommand = startSlideAIEditCommand;
window.editSingleSlideViaAI = editSingleSlideViaAI;
window.triggerSlideImageUpload = triggerSlideImageUpload;
window.handleSlideImageFileSelected = handleSlideImageFileSelected;
window.clearCurrentSlideVisual = clearCurrentSlideVisual;