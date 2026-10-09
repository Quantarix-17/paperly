// ========================================================================
// SLIDE THEME SYSTEM — one source of truth for a deck's look & feel
// ========================================================================
// CONTENT and DESIGN are separate:
//   deck.slides[]  -> words, layouts, data      (never touched by this file)
//   deck.theme     -> preset id | FULL inline theme object | stored { id, overrides }
//
// The same resolved theme feeds all three renderers, so they cannot drift:
//   - live preview / present mode -> CSS variables (--ss-*) on each canvas
//   - PDF export                  -> the same CSS variables on :root
//   - PPTX export                 -> slideThemePptx() (hex colors + font faces)
//
// A deck with NO deck.theme (every deck saved before this file existed) and
// a deck on the untouched "classic" theme render exactly as they did before.
//
// Background precedence (highest first): slide.customBg / slide.bg (manual
// picks) -> deck.backgrounds[bgIndex] (Auto BG: varied/single) -> THEME
// background (hero for title/section/quote slides, content otherwise).
// ========================================================================

// ------------------------------------------------------------------------
// FONT REGISTRY — the only fonts a theme (or the AI) may refer to, by id.
//   label/kind  name shown in the UI / short style tag the AI uses when choosing
//   css         quoted family names for the browser / PDF
//   google      Google Fonts css2 "family=" value, loaded on demand (only weights that really exist)
//   pptx        SAFE face written into the .pptx by default: a font that every Windows/Mac PowerPoint
//               already has, so a slide never silently turns into a random substitute on a computer
//               that lacks the web font. (PowerPoint cannot embed web fonts.)
//   pptxExact   the real face name. Written instead of `pptx` only when exact fonts are requested
//               (window.SLIDE_PPTX_EXACT_FONTS = true, or slideThemePptx(deck, {exact:true}));
//               it displays correctly only where that font is installed.
//   localNames/family  fonts that are not on Google Fonts: used when installed on the device
//               (local()) or when window.SLIDE_FONT_URLS[id] supplies a file URL.
// ------------------------------------------------------------------------
const _ST_CSS_FALLBACK = { 'sans-serif': "'Segoe UI'", serif: "'Georgia'", monospace: "'Consolas'", cursive: "'Segoe UI'" };
const _stLatin = (label, kind, generic, safe, google, extra) => Object.assign({
  label, script: 'latin', kind, generic, pptx: safe, pptxExact: label, google: google || undefined,
  css: `'${label}',${_ST_CSS_FALLBACK[generic] || "'Segoe UI'"}`
}, extra || {});
const _stBengali = (label, kind, generic, google, extra) => Object.assign({
  label, script: 'bengali', kind, generic, pptx: 'Nirmala UI', pptxExact: label, google: google || undefined,
  css: `'${label}','Nirmala UI'`
}, extra || {});

const SLIDE_FONT_REGISTRY = {
  // ===== Latin: system fonts (look identical in preview, PDF and PowerPoint) =====
  'arial':   _stLatin('Arial', 'system-sans', 'sans-serif', 'Arial', null, { css: 'Arial' }),
  'calibri': _stLatin('Calibri', 'system-sans', 'sans-serif', 'Calibri', null, { css: "Calibri,'Carlito'" }),
  'georgia': _stLatin('Georgia', 'system-serif', 'serif', 'Georgia', null, { css: 'Georgia' }),
  // ===== Latin: sans =====
  'inter':             _stLatin('Inter', 'clean', 'sans-serif', 'Arial', 'Inter:wght@400;500;600;700;800'),
  'poppins':           _stLatin('Poppins', 'geometric', 'sans-serif', 'Arial', 'Poppins:wght@400;500;600;700;800'),
  'space-grotesk':     _stLatin('Space Grotesk', 'techy', 'sans-serif', 'Arial', 'Space+Grotesk:wght@400;500;600;700'),
  'montserrat':        _stLatin('Montserrat', 'geometric', 'sans-serif', 'Arial', 'Montserrat:wght@400;500;600;700;800'),
  'roboto':            _stLatin('Roboto', 'neutral', 'sans-serif', 'Arial', 'Roboto:wght@400;500;700'),
  'open-sans':         _stLatin('Open Sans', 'humanist', 'sans-serif', 'Calibri', 'Open+Sans:wght@400;500;600;700;800'),
  'lato':              _stLatin('Lato', 'humanist', 'sans-serif', 'Calibri', 'Lato:wght@400;700;900'),
  'nunito':            _stLatin('Nunito', 'rounded', 'sans-serif', 'Calibri', 'Nunito:wght@400;600;700;800'),
  'work-sans':         _stLatin('Work Sans', 'neutral', 'sans-serif', 'Arial', 'Work+Sans:wght@400;500;600;700;800'),
  'dm-sans':           _stLatin('DM Sans', 'clean', 'sans-serif', 'Arial', 'DM+Sans:wght@400;500;600;700'),
  'manrope':           _stLatin('Manrope', 'modern', 'sans-serif', 'Arial', 'Manrope:wght@400;500;600;700;800'),
  'plus-jakarta-sans': _stLatin('Plus Jakarta Sans', 'modern', 'sans-serif', 'Arial', 'Plus+Jakarta+Sans:wght@400;500;600;700;800'),
  'outfit':            _stLatin('Outfit', 'geometric', 'sans-serif', 'Arial', 'Outfit:wght@400;500;600;700;800'),
  'sora':              _stLatin('Sora', 'techy', 'sans-serif', 'Arial', 'Sora:wght@400;500;600;700;800'),
  'rubik':             _stLatin('Rubik', 'friendly', 'sans-serif', 'Arial', 'Rubik:wght@400;500;600;700;800'),
  'ibm-plex-sans':     _stLatin('IBM Plex Sans', 'corporate', 'sans-serif', 'Arial', 'IBM+Plex+Sans:wght@400;500;600;700'),
  'lexend':            _stLatin('Lexend', 'readable', 'sans-serif', 'Arial', 'Lexend:wght@400;500;600;700;800'),
  'urbanist':          _stLatin('Urbanist', 'modern', 'sans-serif', 'Arial', 'Urbanist:wght@400;500;600;700;800'),
  'quicksand':         _stLatin('Quicksand', 'rounded', 'sans-serif', 'Calibri', 'Quicksand:wght@400;500;600;700'),
  'raleway':           _stLatin('Raleway', 'elegant-sans', 'sans-serif', 'Arial', 'Raleway:wght@400;500;600;700;800'),
  // ===== Latin: serif =====
  'playfair':           _stLatin('Playfair Display', 'display-serif', 'serif', 'Georgia', 'Playfair+Display:wght@500;700;800'),
  'lora':               _stLatin('Lora', 'serif', 'serif', 'Georgia', 'Lora:wght@400;500;600;700'),
  'merriweather':       _stLatin('Merriweather', 'serif', 'serif', 'Georgia', 'Merriweather:wght@400;700'),
  'libre-baskerville':  _stLatin('Libre Baskerville', 'classic-serif', 'serif', 'Georgia', 'Libre+Baskerville:wght@400;700'),
  'cormorant-garamond': _stLatin('Cormorant Garamond', 'elegant-serif', 'serif', 'Georgia', 'Cormorant+Garamond:wght@400;500;600;700'),
  'eb-garamond':        _stLatin('EB Garamond', 'classic-serif', 'serif', 'Georgia', 'EB+Garamond:wght@400;500;600;700'),
  'crimson-pro':        _stLatin('Crimson Pro', 'book-serif', 'serif', 'Georgia', 'Crimson+Pro:wght@400;600;700'),
  'source-serif':       _stLatin('Source Serif 4', 'news-serif', 'serif', 'Georgia', 'Source+Serif+4:wght@400;600;700'),
  'dm-serif-display':   _stLatin('DM Serif Display', 'display-serif', 'serif', 'Georgia', 'DM+Serif+Display'),
  'noto-serif':         _stLatin('Noto Serif', 'serif', 'serif', 'Georgia', 'Noto+Serif:wght@400;500;600;700'),
  'pt-serif':           _stLatin('PT Serif', 'serif', 'serif', 'Georgia', 'PT+Serif:wght@400;700'),
  'spectral':           _stLatin('Spectral', 'book-serif', 'serif', 'Georgia', 'Spectral:wght@400;500;600;700;800'),
  // ===== Latin: mono =====
  'jetbrains-mono': _stLatin('JetBrains Mono', 'mono', 'monospace', 'Courier New', 'JetBrains+Mono:wght@400;500;700'),
  'ibm-plex-mono':  _stLatin('IBM Plex Mono', 'mono', 'monospace', 'Courier New', 'IBM+Plex+Mono:wght@400;500;600'),
  'space-mono':     _stLatin('Space Mono', 'mono', 'monospace', 'Courier New', 'Space+Mono:wght@400;700'),
  // ===== Latin: display / script =====
  'bebas-neue':    _stLatin('Bebas Neue', 'display-condensed', 'sans-serif', 'Impact', 'Bebas+Neue'),
  'anton':         _stLatin('Anton', 'display-condensed', 'sans-serif', 'Impact', 'Anton'),
  'oswald':        _stLatin('Oswald', 'condensed', 'sans-serif', 'Arial Narrow', 'Oswald:wght@400;500;600;700'),
  'abril-fatface': _stLatin('Abril Fatface', 'display-serif', 'serif', 'Georgia', 'Abril+Fatface'),
  'caveat':        _stLatin('Caveat', 'script', 'cursive', 'Comic Sans MS', 'Caveat:wght@400;500;600;700'),
  'pacifico':      _stLatin('Pacifico', 'script', 'cursive', 'Comic Sans MS', 'Pacifico'),

  // ===== Bengali (Google Fonts) — PowerPoint safe face is Nirmala UI for all of them =====
  'nirmala':       { label: 'Nirmala UI', script: 'bengali', kind: 'system-sans', css: "'Nirmala UI','Noto Sans Bengali'", generic: 'sans-serif', pptx: 'Nirmala UI', pptxExact: 'Nirmala UI' },
  'noto-sans-bn':  _stBengali('Noto Sans Bengali', 'clean', 'sans-serif', 'Noto+Sans+Bengali:wght@400;500;600;700;800'),
  'noto-serif-bn': _stBengali('Noto Serif Bengali', 'serif', 'serif', 'Noto+Serif+Bengali:wght@400;500;600;700;800'),
  'hind-siliguri': _stBengali('Hind Siliguri', 'readable', 'sans-serif', 'Hind+Siliguri:wght@400;500;600;700'),
  'tiro-bangla':   _stBengali('Tiro Bangla', 'literary-serif', 'serif', 'Tiro+Bangla'),
  'anek-bangla':   _stBengali('Anek Bangla', 'modern', 'sans-serif', 'Anek+Bangla:wght@400;500;600;700;800'),
  'baloo-da-2':    _stBengali('Baloo Da 2', 'rounded', 'sans-serif', 'Baloo+Da+2:wght@400;500;600;700;800'),
  'mina':          _stBengali('Mina', 'friendly', 'sans-serif', 'Mina:wght@400;700'),
  'atma':          _stBengali('Atma', 'playful', 'sans-serif', 'Atma:wght@400;500;600;700'),
  'galada':        _stBengali('Galada', 'decorative', 'cursive', 'Galada'),
  // ===== Bengali (NOT on Google Fonts): used when installed (local()) or when SLIDE_FONT_URLS[id] gives a file =====
  // The `google` entry loads a close look-alike so the design degrades gracefully instead of dropping to a system font.
  'kalpurush':     _stBengali('কালপুরুষ (Kalpurush)', 'literary-serif', 'serif', 'Noto+Serif+Bengali:wght@400;600;700',
                     { family: 'Kalpurush', pptxExact: 'Kalpurush', css: "'Kalpurush','Noto Serif Bengali','Nirmala UI'", localNames: ['Kalpurush', 'Kalpurush ANSI'] }),
  'siyam-rupali':  _stBengali('Siyam Rupali', 'classic-sans', 'sans-serif', 'Noto+Sans+Bengali:wght@400;600;700',
                     { family: 'Siyam Rupali', css: "'Siyam Rupali','Noto Sans Bengali','Nirmala UI'", localNames: ['Siyam Rupali', 'SiyamRupali', 'Siyam Rupali ANSI'] }),
  'solaimanlipi':  _stBengali('SolaimanLipi', 'classic-sans', 'sans-serif', 'Noto+Sans+Bengali:wght@400;600;700',
                     { family: 'SolaimanLipi', css: "'SolaimanLipi','Noto Sans Bengali','Nirmala UI'", localNames: ['SolaimanLipi', 'Solaiman Lipi'] }),
  'nikosh':        _stBengali('Nikosh', 'classic-sans', 'sans-serif', 'Noto+Sans+Bengali:wght@400;600;700',
                     { family: 'Nikosh', css: "'Nikosh','Noto Sans Bengali','Nirmala UI'", localNames: ['Nikosh', 'NikoshBAN'] })
};

// ------------------------------------------------------------------------
// FONT PAIRS — ready-made heading/body combinations for BOTH scripts. The AI may pick a pair
// ({"fonts":{"pair":"tech-sharp"}}) or mix any registry ids freely.
// ------------------------------------------------------------------------
const SLIDE_FONT_PAIRS = {
  'modern-clean':     { label: 'Modern clean',     mood: 'neutral, product, general',        latinHeading: 'inter',              latinBody: 'inter',         bengaliHeading: 'hind-siliguri', bengaliBody: 'hind-siliguri' },
  'geometric-bold':   { label: 'Geometric bold',   mood: 'confident, marketing, startup',    latinHeading: 'montserrat',         latinBody: 'open-sans',     bengaliHeading: 'anek-bangla',   bengaliBody: 'hind-siliguri' },
  'editorial-serif':  { label: 'Editorial serif',  mood: 'magazine, culture, storytelling',  latinHeading: 'playfair',           latinBody: 'lora',          bengaliHeading: 'noto-serif-bn', bengaliBody: 'noto-serif-bn' },
  'academic-classic': { label: 'Academic classic', mood: 'textbook, lecture, research',      latinHeading: 'lora',               latinBody: 'lora',          bengaliHeading: 'kalpurush',     bengaliBody: 'kalpurush' },
  'tech-sharp':       { label: 'Tech sharp',       mood: 'software, data, engineering',      latinHeading: 'space-grotesk',      latinBody: 'ibm-plex-sans', bengaliHeading: 'anek-bangla',   bengaliBody: 'noto-sans-bn' },
  'friendly-round':   { label: 'Friendly round',   mood: 'kids, community, health',          latinHeading: 'nunito',             latinBody: 'nunito',        bengaliHeading: 'baloo-da-2',    bengaliBody: 'hind-siliguri' },
  'elegant-luxe':     { label: 'Elegant luxe',     mood: 'premium, fashion, weddings',       latinHeading: 'cormorant-garamond', latinBody: 'lato',          bengaliHeading: 'tiro-bangla',   bengaliBody: 'noto-serif-bn' },
  'poster-impact':    { label: 'Poster impact',    mood: 'campaign, sports, bold statements',latinHeading: 'bebas-neue',         latinBody: 'work-sans',     bengaliHeading: 'anek-bangla',   bengaliBody: 'noto-sans-bn' },
  'playful-creative': { label: 'Playful creative', mood: 'design, events, youth',            latinHeading: 'poppins',            latinBody: 'quicksand',     bengaliHeading: 'baloo-da-2',    bengaliBody: 'atma' },
  'corporate-trust':  { label: 'Corporate trust',  mood: 'finance, consulting, reports',     latinHeading: 'ibm-plex-sans',      latinBody: 'ibm-plex-sans', bengaliHeading: 'noto-sans-bn',  bengaliBody: 'noto-sans-bn' },
  'warm-story':       { label: 'Warm story',       mood: 'history, literature, humanities',  latinHeading: 'merriweather',       latinBody: 'open-sans',     bengaliHeading: 'noto-serif-bn', bengaliBody: 'hind-siliguri' },
  'minimal-light':    { label: 'Minimal light',    mood: 'calm, design portfolio, wellness', latinHeading: 'manrope',            latinBody: 'manrope',       bengaliHeading: 'hind-siliguri', bengaliBody: 'hind-siliguri' },
  'news-journal':     { label: 'News journal',     mood: 'analysis, policy, journalism',     latinHeading: 'source-serif',       latinBody: 'work-sans',     bengaliHeading: 'noto-serif-bn', bengaliBody: 'noto-sans-bn' },
  'vintage-display':  { label: 'Vintage display',  mood: 'heritage, food, craft',            latinHeading: 'abril-fatface',      latinBody: 'lora',          bengaliHeading: 'galada',        bengaliBody: 'noto-serif-bn' },
  'code-lab':         { label: 'Code lab',         mood: 'programming, hackathon, science',  latinHeading: 'jetbrains-mono',     latinBody: 'ibm-plex-sans', bengaliHeading: 'noto-sans-bn',  bengaliBody: 'noto-sans-bn' },
  'system-safe':      { label: 'System safe',      mood: 'must look identical in PowerPoint on any computer', latinHeading: 'arial', latinBody: 'arial',        bengaliHeading: 'nirmala',       bengaliBody: 'nirmala' }
};

// Accepts a font id, its label, or its family name (case/space-insensitive, Bengali names too).
function _stFontId(v, script) {
  if (typeof v !== 'string') return '';
  const key = v.trim();
  if (!key) return '';
  const R = SLIDE_FONT_REGISTRY;
  const ok = id => R[id] && (!script || R[id].script === script);
  if (ok(key)) return key;
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]+/g, '');
  const nk = norm(key);
  if (!nk) return '';
  return Object.keys(R).find(id => ok(id) && (
    norm(id) === nk || norm(R[id].label) === nk || norm(R[id].label.replace(/\(.*?\)/g, '')) === nk ||
    (R[id].family && norm(R[id].family) === nk)
  )) || '';
}

function _stFontCatalogForPrompt() {
  const R = SLIDE_FONT_REGISTRY;
  const list = s => Object.keys(R).filter(id => R[id].script === s).map(id => `${id}[${R[id].kind}]`).join(', ');
  const pairs = Object.keys(SLIDE_FONT_PAIRS).map(id => `${id} (${SLIDE_FONT_PAIRS[id].mood})`).join('; ');
  return { latin: list('latin'), bengali: list('bengali'), pairs };
}


// ------------------------------------------------------------------------
// THEME REGISTRY
// palette.cardBg may be #hex or rgba(); every other palette entry is #RRGGBB.
// backgrounds.* use the same {label,css,pptx,dark} shape as SLIDE_BACKGROUNDS.
// ------------------------------------------------------------------------
const SLIDE_THEMES = {
  'classic': {
    id: 'classic', label: 'Classic', blurb: 'Clean white, blue accent',
    palette: { accent: '#4f7df3', accent2: '#7aa2ff', text: '#1f2937', title: '#111827', muted: '#64748b', cardBg: 'rgba(100,116,139,0.12)' },
    fonts: { latinHeading: 'arial', latinBody: 'arial', bengaliHeading: 'nirmala', bengaliBody: 'nirmala' },
    radius: 0.5,
    backgrounds: { content: null, hero: null },
    chart: ['22C55E', 'F59E0B', 'EF4444', 'A855F7', '06B6D4', 'EC4899', '84CC16']
  },
  'aurora': {
    id: 'aurora', label: 'Aurora', blurb: 'Modern violet, soft glow',
    palette: { accent: '#6d5dfc', accent2: '#a78bfa', text: '#2a2650', title: '#1e1b4b', muted: '#6b6a8f', cardBg: 'rgba(109,93,252,0.08)' },
    fonts: { latinHeading: 'inter', latinBody: 'inter', bengaliHeading: 'hind-siliguri', bengaliBody: 'hind-siliguri' },
    radius: 0.8,
    backgrounds: {
      content: { label: 'Aurora Mist', css: 'radial-gradient(circle at 92% 6%, rgba(109,93,252,0.16) 0%, transparent 42%), linear-gradient(135deg,#faf9ff 0%,#eef0ff 100%)', pptx: 'F4F3FF', dark: false },
      hero: { label: 'Aurora Night', css: 'linear-gradient(135deg,#3b2a8c 0%,#6d5dfc 60%,#a78bfa 100%)', pptx: '4B3BB0', dark: true }
    },
    chart: ['F59E0B', '22C55E', 'EC4899', '06B6D4', 'EF4444', 'A855F7', '84CC16']
  },
  'midnight': {
    id: 'midnight', label: 'Midnight', blurb: 'Dark, cyan highlights',
    palette: { accent: '#38bdf8', accent2: '#818cf8', text: '#e2e8f0', title: '#f8fafc', muted: '#94a3b8', cardBg: 'rgba(148,163,184,0.12)' },
    fonts: { latinHeading: 'space-grotesk', latinBody: 'inter', bengaliHeading: 'hind-siliguri', bengaliBody: 'hind-siliguri' },
    radius: 0.7,
    backgrounds: {
      content: { label: 'Midnight', css: 'radial-gradient(circle at 12% 0%, rgba(56,189,248,0.16) 0%, transparent 40%), linear-gradient(135deg,#0b1220 0%,#111a2e 100%)', pptx: '0B1220', dark: true },
      hero: { label: 'Midnight Hero', css: 'linear-gradient(135deg,#050816 0%,#1e1b4b 100%)', pptx: '0A0A24', dark: true }
    },
    chart: ['F59E0B', '22C55E', 'EC4899', 'A855F7', 'EF4444', '818CF8', '84CC16']
  },
  'editorial': {
    id: 'editorial', label: 'Editorial', blurb: 'Warm paper, serif headlines',
    palette: { accent: '#b4452b', accent2: '#e07a5f', text: '#2b2623', title: '#1a1613', muted: '#7a6f66', cardBg: 'rgba(180,69,43,0.07)' },
    fonts: { latinHeading: 'playfair', latinBody: 'lora', bengaliHeading: 'noto-serif-bn', bengaliBody: 'noto-serif-bn' },
    radius: 0.15,
    backgrounds: {
      content: { label: 'Paper', css: '#fbf7f0', pptx: 'FBF7F0', dark: false },
      hero: { label: 'Ink', css: 'linear-gradient(135deg,#1f1a17 0%,#3a2e27 100%)', pptx: '1F1A17', dark: true }
    },
    chart: ['0F766E', 'F59E0B', '4F7DF3', 'A855F7', '84CC16', 'EC4899', '06B6D4']
  },
  'textbook': {
    id: 'textbook', label: 'Textbook', blurb: 'Calm teal, notebook paper',
    palette: { accent: '#0f766e', accent2: '#5eead4', text: '#1f2937', title: '#0f172a', muted: '#5b6b73', cardBg: 'rgba(15,118,110,0.08)' },
    fonts: { latinHeading: 'lora', latinBody: 'lora', bengaliHeading: 'kalpurush', bengaliBody: 'kalpurush' },
    radius: 0.35,
    backgrounds: {
      content: { label: 'Notebook', css: 'linear-gradient(180deg,#fffdf5 0%,#f6f3e8 100%)', pptx: 'FAF8EE', dark: false },
      hero: { label: 'Deep Teal', css: 'linear-gradient(135deg,#0f4c4a 0%,#0f766e 100%)', pptx: '0F5D59', dark: true }
    },
    chart: ['F59E0B', '4F7DF3', 'EF4444', 'A855F7', '84CC16', 'EC4899', '06B6D4']
  },
  'sunset': {
    id: 'sunset', label: 'Sunset', blurb: 'Bold orange, pitch energy',
    palette: { accent: '#f97316', accent2: '#fb923c', text: '#3b2314', title: '#2a1810', muted: '#8a6a55', cardBg: 'rgba(249,115,22,0.09)' },
    fonts: { latinHeading: 'poppins', latinBody: 'poppins', bengaliHeading: 'anek-bangla', bengaliBody: 'anek-bangla' },
    radius: 1.0,
    backgrounds: {
      content: { label: 'Peach', css: 'linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%)', pptx: 'FFF3E3', dark: false },
      hero: { label: 'Sunset', css: 'linear-gradient(135deg,#7c2d12 0%,#ea580c 55%,#f59e0b 100%)', pptx: 'C2410C', dark: true }
    },
    chart: ['4F7DF3', '22C55E', 'EF4444', 'A855F7', '06B6D4', 'EC4899', '84CC16']
  },
  'slate': {
    id: 'slate', label: 'Slate', blurb: 'Neutral, report-ready',
    palette: { accent: '#334155', accent2: '#64748b', text: '#1e293b', title: '#0f172a', muted: '#64748b', cardBg: 'rgba(51,65,85,0.07)' },
    fonts: { latinHeading: 'inter', latinBody: 'inter', bengaliHeading: 'noto-sans-bn', bengaliBody: 'noto-sans-bn' },
    radius: 0.3,
    backgrounds: {
      content: { label: 'Slate Light', css: 'linear-gradient(135deg,#f8fafc 0%,#e2e8f0 100%)', pptx: 'EEF2F6', dark: false },
      hero: { label: 'Slate Dark', css: 'linear-gradient(135deg,#0f172a 0%,#334155 100%)', pptx: '1E293B', dark: true }
    },
    chart: ['4F7DF3', '22C55E', 'F59E0B', 'EF4444', 'A855F7', '06B6D4', 'EC4899']
  }
};

// NOTE: the old "content category -> theme" table is gone on purpose. It pushed almost every deck
// to the same preset. The AI now designs each theme from the deck's own subject, either as a
// preset id or as a FULL inline theme object (palette, fonts, radius, backgrounds, chart).

// ------------------------------------------------------------------------
// RESOLUTION
// deck.theme may be:  "aurora"  |  { id, overrides } (stored form)  |  a full inline object
// { base?, palette?, fonts?, radius?, backgrounds?, chart?, mode? }. All three resolve the same way.
// ------------------------------------------------------------------------
function _stIsObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function _stMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  Object.keys(patch || {}).forEach(k => {
    const pv = patch[k];
    out[k] = (_stIsObj(pv) && _stIsObj(out[k])) ? _stMerge(out[k], pv) : pv;
  });
  return out;
}

function _stDeck(deck) {
  return deck || (typeof APP_STATE !== 'undefined' ? APP_STATE.slideDeck : null);
}

const _ST_INLINE_KEYS = ['palette', 'fonts', 'radius', 'backgrounds', 'chart', 'mode', 'pair', 'tokens'];
function _stHasInline(o) { return _stIsObj(o) && _ST_INLINE_KEYS.some(k => o[k] !== undefined); }

// Any accepted form -> { id, overrides } (or null). Inline objects are sanitized here.
function _stNormalizeRef(ref) {
  if (!ref) return null;
  if (typeof ref === 'string' || (_stIsObj(ref) && !_stIsObj(ref.overrides) && _stHasInline(ref))) return sanitizeDeckThemeRef(ref);
  return _stIsObj(ref) ? ref : null;
}

// WCAG-style helpers: an AI-chosen palette must never end up unreadable.
function _stLum(hex) {
  const h = String(hex).replace('#', '');
  const c = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function _stContrast(a, b) {
  const la = _stLum(a), lb = _stLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Last step for any customised theme: readable text on the content background, 7+ chart colors.
function _stFinalize(t) {
  const out = Object.assign({}, t, { palette: Object.assign({}, t.palette) });
  const bg = t.backgrounds && t.backgrounds.content;
  const bgHex = bg && /^[0-9a-fA-F]{6}$/.test(bg.pptx || '') ? '#' + bg.pptx : '';
  if (bgHex) {
    const dark = _stLum(bgHex) < 0.25;
    const fix = (key, min, onDark, onLight) => {
      const v = out.palette[key];
      if (_ST_HEX.test(v || '') && _stContrast(v, bgHex) < min) out.palette[key] = dark ? onDark : onLight;
    };
    fix('text', 4.5, '#e2e8f0', '#1f2937');
    fix('title', 4.5, '#f8fafc', '#111827');
    fix('muted', 3, '#94a3b8', '#64748b');
  }
  const seen = {}, chart = [];
  (Array.isArray(t.chart) ? t.chart : []).forEach(c => { const h = _stHex6(c); if (h && !seen[h]) { seen[h] = 1; chart.push(h); } });
  SLIDE_THEMES.classic.chart.forEach(c => { if (chart.length < 7 && !seen[c]) { seen[c] = 1; chart.push(c); } });
  out.chart = chart;
  return out;
}

function resolveSlideTheme(deck) {
  const d = _stDeck(deck);
  const ref = _stNormalizeRef(d && d.theme);
  // Canonicalise legacy / inline forms once so every later read sees { id, overrides }.
  if (ref && d && d.theme !== ref) d.theme = ref;
  const base = (ref && SLIDE_THEMES[ref.id]) || SLIDE_THEMES.classic;
  if (!(ref && _stIsObj(ref.overrides) && Object.keys(ref.overrides).length)) return base;
  return _stFinalize(_stMerge(base, ref.overrides));
}

// "Themed" = anything other than the untouched classic look. Classic decks
// emit no theme CSS at all, so they are pixel-identical to before.
function isSlideDeckThemed(deck) {
  const d = _stDeck(deck);
  const ref = _stNormalizeRef(d && d.theme);
  if (!ref) return false;
  return (ref.id && ref.id !== 'classic') || (_stIsObj(ref.overrides) && Object.keys(ref.overrides).length > 0);
}

function slideThemeFontStack(theme, role) {
  const f = theme.fonts || {};
  const R = SLIDE_FONT_REGISTRY;
  const lat = R[role === 'heading' ? f.latinHeading : f.latinBody] || R.arial;
  const bn = R[role === 'heading' ? f.bengaliHeading : f.bengaliBody] || R.nirmala;
  // Latin first, Bengali second: the browser falls back PER GLYPH, so mixed
  // Bengali/English text picks the right font for each character.
  return `${lat.css}, ${bn.css}, ${lat.generic}`;
}

// Design tokens -> CSS variables. Absent tokens emit nothing, so token-less decks render as before.
function _stTokenCssVars(tk) {
  if (!tk) return [];
  const v = [], em = px => (px / 16).toFixed(3) + 'em';
  const ty = tk.typography;
  if (ty) {
    if (ty.title !== undefined) v.push(`--ss-title-scale:${ty.title}`);
    if (ty.h2 !== undefined) v.push(`--ss-h2-scale:${ty.h2}`);
    if (ty.caption !== undefined) v.push(`--ss-caption-scale:${ty.caption}`);
    if (ty.formula !== undefined) v.push(`--ss-formula-scale:${ty.formula}`);
    if (ty.lineHeight && ty.lineHeight.title) v.push(`--ss-lh-title:${ty.lineHeight.title}`);
    if (ty.lineHeight && ty.lineHeight.body) v.push(`--ss-lh-body:${ty.lineHeight.body}`);
    if (ty.letterSpacing && ty.letterSpacing.title) v.push(`--ss-ls-title:${ty.letterSpacing.title}`);
    if (ty.weight && ty.weight.title) v.push(`--ss-w-title:${ty.weight.title}`);
    if (ty.headingWidth) v.push(`--ss-heading-width:${ty.headingWidth}%`);
    if (ty.paragraphWidth) v.push(`--ss-para-width:${ty.paragraphWidth}%`);
  }
  if (tk.spacing) {
    if (tk.spacing.gap) v.push(`--ss-gap:${em(tk.spacing.gap)}`);
    if (tk.spacing.pad) v.push(`--ss-pad:${em(tk.spacing.pad)}`);
    [4, 8, 12, 16, 24, 32, 48, 64].forEach((px, i) => v.push(`--ss-sp-${i + 1}:${em(px)}`));
  }
  if (tk.border) { v.push(`--ss-border-w:${tk.border.width}px`); v.push(`--ss-border-style:${tk.border.width === 0 ? 'none' : tk.border.style}`); }
  if (tk.shadow) v.push(`--ss-shadow:${tk.shadow}`);
  if (tk.material) v.push(`--ss-material-blur:${tk.material.blur}px`);
  return v;
}

// force=true always emits every variable (PDF :root); otherwise classic -> ''.
function slideThemeCssVars(theme, force) {
  theme = theme || resolveSlideTheme();
  const p = theme.palette;
  return [
    `--ss-accent:${p.accent}`, `--ss-accent2:${p.accent2}`, `--ss-text:${p.text}`, `--ss-title:${p.title}`,
    `--ss-muted:${p.muted}`, `--ss-card-bg:${p.cardBg}`,
    `--ss-radius:${theme.radius}em`, `--ss-radius-in:${(theme.radius * 0.16).toFixed(3)}in`,
    `--ss-font-body:${slideThemeFontStack(theme, 'body')}`, `--ss-font-heading:${slideThemeFontStack(theme, 'heading')}`
  ].concat(_stTokenCssVars(theme.tokens)).join(';') + ';';
}

function slideThemeCanvasStyle(deck) {
  if (!isSlideDeckThemed(deck)) return '';
  return slideThemeCssVars(resolveSlideTheme(deck)) + 'font-family:var(--ss-font-body);';
}

function slideThemeBackgroundFor(slide, deck) {
  if (!isSlideDeckThemed(deck)) return null;
  const bgs = resolveSlideTheme(deck).backgrounds || {};
  const hero = slide && (slide.layout === 'title' || slide.layout === 'section' || slide.layout === 'quote' ||
    (typeof _isTitleOnlySlide === 'function' && _isTitleOnlySlide(slide)));
  return (hero ? (bgs.hero || bgs.content) : bgs.content) || null;
}

// ----- PPTX view of the theme -----
// Fonts: by default every face is the registry's SAFE equivalent (Arial / Calibri / Georgia /
// Courier New / Impact / Nirmala UI ...), so the .pptx looks the same on any computer.
// Pass { exact:true } (or set window.SLIDE_PPTX_EXACT_FONTS = true) to write the real font names
// instead; those only display correctly where the fonts are installed.
function slideThemePptx(deck, opts) {
  const t = resolveSlideTheme(deck);
  const exact = !!((opts && opts.exact) || (typeof window !== 'undefined' && window.SLIDE_PPTX_EXACT_FONTS === true));
  const hex = c => String(c || '').replace('#', '').toUpperCase().slice(0, 6);
  const R = SLIDE_FONT_REGISTRY, f = t.fonts || {};
  const face = (id, fb) => { const r = R[id] || R[fb]; return exact ? (r.pptxExact || r.pptx) : r.pptx; };
  return {
    accent: hex(t.palette.accent), accent2: hex(t.palette.accent2), text: hex(t.palette.text),
    title: hex(t.palette.title), muted: hex(t.palette.muted),
    chart: [hex(t.palette.accent)].concat((t.chart || []).map(hex)),
    exactFonts: exact,
    fonts: {
      latinHeading: face(f.latinHeading, 'arial'), latinBody: face(f.latinBody, 'arial'),
      bengaliHeading: face(f.bengaliHeading, 'nirmala'), bengaliBody: face(f.bengaliBody, 'nirmala')
    }
  };
}

function slideThemePptxFont(text, role, deck, opts) {
  const fonts = slideThemePptx(deck, opts).fonts;
  const bn = typeof text === 'string' && /[\u0980-\u09FF]/.test(text);
  if (role === 'heading') return bn ? fonts.bengaliHeading : fonts.latinHeading;
  return bn ? fonts.bengaliBody : fonts.latinBody;
}

// ------------------------------------------------------------------------
// ------------------------------------------------------------------------
// ASSETS: Google Fonts <link>, local() Kalpurush, panel/preview CSS
// ------------------------------------------------------------------------
function slideThemeFontsHref(theme) {
  const f = theme.fonts || {}, R = SLIDE_FONT_REGISTRY;
  const fams = [];
  ['latinHeading', 'latinBody', 'bengaliHeading', 'bengaliBody'].forEach(k => {
    const g = R[f[k]] && R[f[k]].google;
    if (g && fams.indexOf(g) === -1) fams.push(g);
  });
  return fams.length ? `https://fonts.googleapis.com/css2?${fams.map(g => 'family=' + g).join('&')}&display=swap` : '';
}

// @font-face for every font that is not on Google Fonts (Kalpurush, Siyam Rupali, ...): uses the
// installed copy via local(), or window.SLIDE_FONT_URLS[id] when a file URL is supplied.
function slideThemeFontFaceCss() {
  const urls = (typeof window !== 'undefined' && window.SLIDE_FONT_URLS) || {};
  const R = SLIDE_FONT_REGISTRY;
  return Object.keys(R).filter(id => R[id].localNames).map(id => {
    const r = R[id];
    const src = r.localNames.map(n => `local('${n}')`).concat(urls[id] ? [`url('${String(urls[id]).replace(/'/g, '')}')`] : []).join(',');
    return `@font-face{font-family:'${r.family || r.label}';src:${src};font-display:swap;}`;
  }).join('');
}

function ensureSlideThemeAssets(deck) {
  if (typeof document === 'undefined' || !document.head) return;
  if (!document.getElementById('slide-theme-base-styles')) {
    const st = document.createElement('style');
    st.id = 'slide-theme-base-styles';
    st.textContent = `
      .slide-canvas-16x9.ss-themed .slide-canvas-title,.slide-canvas-16x9.ss-themed .ss-card-h,.slide-canvas-16x9.ss-themed .ss-stat-v{font-family:var(--ss-font-heading);}
      .slide-canvas-16x9.ss-themed .slide-canvas-title{color:var(--ss-title);}
      .slide-canvas-16x9.ss-themed .slide-canvas-bullets{color:var(--ss-text);}
      .slide-canvas-16x9.ss-themed.slide-canvas-dark-text .slide-canvas-title{color:#ffffff;}
      .slide-canvas-16x9.ss-themed.slide-canvas-dark-text .slide-canvas-bullets{color:#f1f5f9;}
      .sth-sec{margin:0.2em 0 0.5em;font-size:0.8em;font-weight:700;opacity:0.7;letter-spacing:0.03em;text-transform:uppercase;}
      .sth-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;}
      .sth-card{border:2px solid transparent;border-radius:10px;padding:0;cursor:pointer;background:transparent;text-align:left;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,0.18);}
      .sth-card.active{border-color:#4f7df3;}
      .sth-card-prev{height:54px;padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;}
      .sth-card-bar{width:26px;height:4px;border-radius:2px;}
      .sth-card-aa{font-size:15px;font-weight:700;line-height:1;}
      .sth-card-name{font-size:11px;font-weight:600;padding:5px 8px;background:rgba(255,255,255,0.92);color:#1f2937;}
      .sth-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0;}
      .sth-row select,.sth-row input[type=text]{padding:5px 8px;border-radius:8px;border:1px solid rgba(100,116,139,0.45);font-size:12px;background:#fff;color:#1f2937;min-width:0;}
      .sth-row input[type=text]{flex:1 1 220px;}
      .sth-btn{padding:5px 10px;border-radius:8px;border:1px solid rgba(100,116,139,0.45);background:#fff;color:#1f2937;font-size:12px;font-weight:600;cursor:pointer;}
      .sth-btn.active{background:#4f7df3;border-color:#4f7df3;color:#fff;}
      .sth-btn:disabled{opacity:0.5;cursor:wait;}
      .sth-note{font-size:11px;opacity:0.7;margin:4px 0 0;}`;
    document.head.appendChild(st);
  }
  const theme = resolveSlideTheme(deck);
  let ff = document.getElementById('slide-theme-fontface');
  if (!ff) { ff = document.createElement('style'); ff.id = 'slide-theme-fontface'; document.head.appendChild(ff); }
  // @font-face for the non-Google Bengali fonts is always registered so they work the moment they are picked.
  ff.textContent = slideThemeFontFaceCss();
  const href = slideThemeFontsHref(theme);
  let link = document.getElementById('slide-theme-fonts-link');
  if (href) {
    if (!link) { link = document.createElement('link'); link.id = 'slide-theme-fonts-link'; link.rel = 'stylesheet'; document.head.appendChild(link); }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  } else if (link) { link.removeAttribute('href'); }
}

// ------------------------------------------------------------------------
// SANITIZE (AI patches and AI-chosen deck theme ids are untrusted input)
// ------------------------------------------------------------------------
const _ST_HEX = /^#[0-9a-fA-F]{6}$/;
const _ST_RGBA = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;

// "#abc" | "abc" | "#AABBCC" | "aabbcc"  ->  "AABBCC" (or '')
function _stHex6(v) {
  let s = typeof v === 'string' ? v.trim().replace(/^#/, '') : '';
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map(c => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : '';
}
// ... -> "#aabbcc" (or '')
function _stHex(v) { const h = _stHex6(v); return h ? '#' + h.toLowerCase() : ''; }

// Background: reuse the app's own sanitizer when present (slide-studio.js), otherwise a strict
// built-in one (no url(), no @import, no scripts). `dark` is always recomputed from the real
// colour, so an AI that mislabels a background cannot produce light-on-light text.
function _stSanitizeBg(raw) {
  let b = null;
  if (typeof _sanitizeCustomBackgroundJSON === 'function') b = _sanitizeCustomBackgroundJSON(raw);
  else if (_stIsObj(raw) && typeof raw.css === 'string') {
    const css = raw.css.trim();
    if (css && css.length <= 500 && /^[#a-zA-Z0-9\s.,%()\/-]+$/.test(css) && !/url\s*\(|expression|import|javascript/i.test(css)) {
      const m = css.match(/#[0-9a-fA-F]{6}\b/) || css.match(/#[0-9a-fA-F]{3}\b/);
      const px = _stHex6(raw.pptx) || (m ? _stHex6(m[0]) : '');
      if (px) b = { label: String(raw.label || 'Custom').slice(0, 40), css, pptx: px, dark: false };
    }
  }
  if (!b) return null;
  const px = _stHex6(b.pptx);
  return px ? Object.assign({}, b, { pptx: px, dark: _stLum(px) < 0.25 }) : b;
}

function sanitizeSlideThemePatch(raw) {
  if (!_stIsObj(raw)) return null;
  const out = {};
  if (typeof raw.base === 'string' && SLIDE_THEMES[raw.base.trim().toLowerCase()]) out.base = raw.base.trim().toLowerCase();
  if (raw.mode === 'dark' || raw.mode === 'light') out.mode = raw.mode;

  if (_stIsObj(raw.palette)) {
    const pal = {};
    ['accent', 'accent2', 'text', 'title', 'muted'].forEach(k => { const v = _stHex(raw.palette[k]); if (v) pal[k] = v; });
    const cb = typeof raw.palette.cardBg === 'string' ? raw.palette.cardBg.trim() : '';
    if (_stHex(cb)) pal.cardBg = _stHex(cb); else if (_ST_RGBA.test(cb)) pal.cardBg = cb;
    if (Object.keys(pal).length) out.palette = pal;
  }

  // Fonts: a ready-made pair, any registry ids, or both (explicit ids win over the pair).
  if (raw.fonts !== undefined || raw.pair !== undefined) {
    const rf = _stIsObj(raw.fonts) ? raw.fonts : {};
    const pairId = String(typeof raw.fonts === 'string' ? raw.fonts : (rf.pair || raw.pair || '')).trim().toLowerCase();
    const fonts = {};
    const pair = SLIDE_FONT_PAIRS[pairId];
    if (pair) ['latinHeading', 'latinBody', 'bengaliHeading', 'bengaliBody'].forEach(k => { fonts[k] = pair[k]; });
    const put = (key, v, script) => { const id = _stFontId(v, script); if (id) fonts[key] = id; };
    put('latinHeading', rf.latin, 'latin'); put('latinBody', rf.latin, 'latin');
    put('bengaliHeading', rf.bengali, 'bengali'); put('bengaliBody', rf.bengali, 'bengali');
    put('latinHeading', rf.latinHeading, 'latin'); put('latinBody', rf.latinBody, 'latin');
    put('bengaliHeading', rf.bengaliHeading, 'bengali'); put('bengaliBody', rf.bengaliBody, 'bengali');
    if (Object.keys(fonts).length) out.fonts = fonts;
  }

  const r = Number(raw.radius);
  if (raw.radius !== undefined && raw.radius !== null && raw.radius !== '' && isFinite(r)) out.radius = Math.max(0, Math.min(1.2, r));

  if (_stIsObj(raw.backgrounds)) {
    const bgs = {};
    ['content', 'hero'].forEach(k => {
      if (raw.backgrounds[k] === null) bgs[k] = null;
      else { const b = _stSanitizeBg(raw.backgrounds[k]); if (b) bgs[k] = b; }
    });
    if (Object.keys(bgs).length) out.backgrounds = bgs;
  }

  // Chart colours: stored as "RRGGBB" (no #), same as the presets.
  if (Array.isArray(raw.chart)) {
    const seen = {}, chart = [];
    raw.chart.forEach(c => { const h = _stHex6(c); if (h && !seen[h]) { seen[h] = 1; chart.push(h); } });
    if (chart.length >= 2) out.chart = chart.slice(0, 10);
  }
  if (_stIsObj(raw.tokens)) { const tk = _stSanitizeTokens(raw.tokens); if (tk) out.tokens = tk; }
  return Object.keys(out).length ? out : null;
}

// Design tokens (typography / spacing / border / shadow / material) come from the code-side
// design engine, but they travel inside deck.theme, so they are re-validated here: numbers are
// clamped, enums are whitelisted, and the shadow string may only contain shadow-safe characters.
function _stNum(v, lo, hi) { const n = Number(v); return (v !== null && v !== '' && isFinite(n)) ? Math.max(lo, Math.min(hi, n)) : undefined; }
function _stSanitizeTokens(raw) {
  if (!_stIsObj(raw)) return null;
  const out = {};
  if (_stIsObj(raw.typography)) {
    const t = raw.typography, ty = {};
    [['title', 1, 5], ['h2', 0.8, 3.5], ['body', 0.7, 1.6], ['caption', 0.5, 1.1], ['formula', 1, 4],
     ['headingWidth', 40, 100], ['paragraphWidth', 40, 100]].forEach(([k, lo, hi]) => { const n = _stNum(t[k], lo, hi); if (n !== undefined) ty[k] = n; });
    if (_stIsObj(t.lineHeight)) { const lh = {}; ['title', 'body'].forEach(k => { const n = _stNum(t.lineHeight[k], 0.9, 2); if (n !== undefined) lh[k] = n; }); if (Object.keys(lh).length) ty.lineHeight = lh; }
    if (_stIsObj(t.letterSpacing)) { const ls = {}; ['title', 'caption'].forEach(k => { if (/^-?\d{1,2}(\.\d+)?em$/.test(String(t.letterSpacing[k] || ''))) ls[k] = String(t.letterSpacing[k]); }); if (Object.keys(ls).length) ty.letterSpacing = ls; }
    if (_stIsObj(t.weight)) { const w = {}; ['title', 'heading', 'body'].forEach(k => { const n = _stNum(t.weight[k], 300, 900); if (n !== undefined) w[k] = Math.round(n / 100) * 100; }); if (Object.keys(w).length) ty.weight = w; }
    if (_stIsObj(t.maxLines)) { const ml = {}; ['title', 'body'].forEach(k => { const n = _stNum(t.maxLines[k], 1, 30); if (n !== undefined) ml[k] = Math.round(n); }); if (Object.keys(ml).length) ty.maxLines = ml; }
    if (Object.keys(ty).length) out.typography = ty;
  }
  if (_stIsObj(raw.spacing)) {
    const sp = {}, SCALE = [4, 8, 12, 16, 24, 32, 48, 64];
    ['gap', 'pad'].forEach(k => { const n = _stNum(raw.spacing[k], 4, 64); if (n !== undefined) sp[k] = SCALE.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a); });
    if (Object.keys(sp).length) { sp.scale = SCALE; out.spacing = sp; }
  }
  if (_stIsObj(raw.border)) {
    const w = _stNum(raw.border.width, 0, 6), st = ['none', 'solid', 'double'].indexOf(raw.border.style) !== -1 ? raw.border.style : undefined;
    if (w !== undefined || st) out.border = { width: w !== undefined ? w : 1, style: st || 'solid' };
  }
  if (['paper', 'technical', 'tech', 'corporate', 'editorial', 'luxury'].indexOf(raw.placeholder) !== -1) out.placeholder = raw.placeholder;
  if (typeof raw.shadow === 'string' && (raw.shadow === 'none' || (raw.shadow.length < 220 && /^[0-9a-z.,()\s\-]+$/i.test(raw.shadow)))) out.shadow = raw.shadow;
  if (_stIsObj(raw.material)) {
    const a = _stNum(raw.material.fillAlpha, 0, 0.4), b = _stNum(raw.material.blur, 0, 24);
    if (a !== undefined || b !== undefined) out.material = { fillAlpha: a !== undefined ? a : 0.07, blur: b !== undefined ? b : 0, grain: !!raw.material.grain };
  }
  return Object.keys(out).length ? out : null;
}

// Writes a sanitized patch onto an overrides object (shared by the AI deck theme and the Theme panel).
function _stApplyPatch(ov, patch, baseId) {
  const baseTheme = SLIDE_THEMES[baseId] || SLIDE_THEMES.classic;
  if (patch.mode) {
    const accent = (patch.palette && patch.palette.accent) || (ov.palette && ov.palette.accent) || baseTheme.palette.accent;
    ov.backgrounds = Object.assign({}, ov.backgrounds, _stModeBackgrounds(patch.mode, accent));
  }
  if (patch.palette) ov.palette = Object.assign({}, ov.palette, patch.palette);
  if (patch.fonts) ov.fonts = Object.assign({}, ov.fonts, patch.fonts);
  if (patch.radius !== undefined) ov.radius = patch.radius;
  if (patch.backgrounds) ov.backgrounds = Object.assign({}, ov.backgrounds, patch.backgrounds);
  if (patch.chart) ov.chart = patch.chart.slice();
  if (patch.tokens) ov.tokens = _stMerge(ov.tokens || {}, patch.tokens);
  return ov;
}

// deck.theme coming from the AI (untrusted): a preset id string, or a FULL theme object.
// Returns the stored form { id, overrides }, or null if there is nothing usable.
function sanitizeDeckThemeRef(raw) {
  if (typeof raw === 'string') {
    const sid = raw.trim().toLowerCase();
    return SLIDE_THEMES[sid] ? { id: sid, overrides: {} } : null;
  }
  if (!_stIsObj(raw)) return null;
  const idRaw = String(raw.base || raw.id || '').trim().toLowerCase();
  const known = !!SLIDE_THEMES[idRaw];
  const baseId = known ? idRaw : 'classic';
  const src = Object.assign({}, _stIsObj(raw.overrides) ? raw.overrides : {}, raw);
  delete src.base; delete src.id;
  const patch = sanitizeSlideThemePatch(src);
  if (!patch && !known) return null;
  return { id: baseId, overrides: patch ? _stApplyPatch({}, patch, baseId) : {} };
}

function _stModeBackgrounds(mode, accent) {
  const a = _ST_HEX.test(accent) ? accent : '#4f7df3';
  const glow = 'rgba(' + [1, 3, 5].map(i => parseInt(a.substr(i, 2), 16)).join(',') + ',0.16)';
  return mode === 'dark'
    ? { content: { label: 'Deep Dark', css: `radial-gradient(circle at 12% 0%, ${glow} 0%, transparent 42%), linear-gradient(135deg,#0b1220 0%,#111a2e 100%)`, pptx: '0B1220', dark: true },
        hero: { label: 'Deep Dark Hero', css: 'linear-gradient(135deg,#050816 0%,#14122e 100%)', pptx: '0A0A1E', dark: true } }
    : { content: { label: 'Light', css: 'linear-gradient(135deg,#ffffff 0%,#f1f5f9 100%)', pptx: 'F8FAFC', dark: false }, hero: null };
}

// ------------------------------------------------------------------------
// APPLY (touches deck.theme + background selections ONLY — never content)
// ------------------------------------------------------------------------
let _slideThemeUndoSnapshot = null;

function _stSnapshot(deck) {
  _slideThemeUndoSnapshot = JSON.stringify({
    theme: deck.theme || null, backgrounds: deck.backgrounds || null,
    per: deck.slides.map(s => ({ bg: s.bg || null, customBg: s.customBg || null, bgIndex: s.bgIndex == null ? null : s.bgIndex }))
  });
}

function undoSlideThemeChange() {
  const deck = typeof APP_STATE !== 'undefined' ? APP_STATE.slideDeck : null;
  if (!deck || !_slideThemeUndoSnapshot) return;
  try {
    const snap = JSON.parse(_slideThemeUndoSnapshot);
    deck.theme = snap.theme; deck.backgrounds = snap.backgrounds;
    deck.slides.forEach((s, i) => { const p = snap.per[i]; if (p) { s.bg = p.bg; s.customBg = p.customBg; s.bgIndex = p.bgIndex; } });
    _slideThemeUndoSnapshot = null;
    _stCommit(deck, 'Theme change undone.');
  } catch (e) { console.warn('[SlideTheme] undo failed:', e); }
}

function _stCommit(deck, toast) {
  if (typeof persistSlideDeckToActiveTab === 'function') persistSlideDeckToActiveTab(deck);
  if (typeof renderSlideDeckPreview === 'function') renderSlideDeckPreview(deck);
  if (toast && typeof displayToastNotification === 'function') displayToastNotification(toast);
}

function applySlideThemePatch(patch, opts) {
  const deck = typeof APP_STATE !== 'undefined' ? APP_STATE.slideDeck : null;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length || !patch) return false;
  const o = opts || {};
  _stSnapshot(deck);

  const cur = _stNormalizeRef(deck.theme);
  let ref = cur ? { id: cur.id, overrides: JSON.parse(JSON.stringify(cur.overrides || {})) } : { id: 'classic', overrides: {} };
  if (patch.base) ref = { id: patch.base, overrides: {} };   // a new base theme starts clean
  _stApplyPatch(ref.overrides, patch, ref.id);
  deck.theme = ref;

  const touchesBg = !!(patch.base || patch.mode || patch.backgrounds);
  if (touchesBg && o.resetBackgrounds !== false) {
    deck.backgrounds = null;
    deck.slides.forEach(s => { s.bg = null; s.customBg = null; s.bgIndex = null; });
  }
  _stCommit(deck, o.toast || 'Theme updated — slide content unchanged.');
  return true;
}

function setSlideTheme(id) {
  if (!SLIDE_THEMES[id]) return;
  applySlideThemePatch({ base: id }, { toast: `Theme: ${SLIDE_THEMES[id].label} — content unchanged. Slide backgrounds were reset to the theme (use Undo to revert).` });
}
function setSlideThemeMode(mode) { applySlideThemePatch({ mode }); }
function setSlideThemePair(id) {
  const key = String(id || '').toLowerCase();
  if (!SLIDE_FONT_PAIRS[key]) return;
  applySlideThemePatch(sanitizeSlideThemePatch({ fonts: { pair: key } }),
    { toast: 'Font pair: ' + SLIDE_FONT_PAIRS[key].label + '. PowerPoint uses safe equivalent fonts.' });
}
function setSlideThemeFont(kind, id) {
  const fonts = kind === 'bengali' ? { bengaliHeading: id, bengaliBody: id } : { latinHeading: id, latinBody: id };
  const p = sanitizeSlideThemePatch({ fonts });
  if (p) applySlideThemePatch(p, { toast: 'Font changed. PowerPoint uses a safe equivalent font so it looks the same everywhere.' });
}

// ------------------------------------------------------------------------
// AI: "make it darker", "keep Bengali font Kalpurush" -> a small JSON patch
// ------------------------------------------------------------------------
function buildSlideThemeSystemPrompt(deck) {
  const themes = Object.keys(SLIDE_THEMES).map(id => `${id} (${SLIDE_THEMES[id].label}: ${SLIDE_THEMES[id].blurb})`).join('; ');
  const cat = _stFontCatalogForPrompt();
  const cur = resolveSlideTheme(deck);
  return (
    `You are the THEME DESIGNER for AI PDF Studio's slide decks. The user describes, in ANY language (often Bengali or English), how they want the deck's LOOK to change.\n` +
    `You change ONLY the visual theme. You NEVER change, rewrite, add or remove slide text, layouts, or data.\n` +
    `Return ONLY one JSON object containing JUST the keys that must change (omit everything else): {"base":"<theme id>","mode":"dark"|"light","palette":{"accent":"#RRGGBB","accent2":"#RRGGBB","text":"#RRGGBB","title":"#RRGGBB","muted":"#RRGGBB","cardBg":"#RRGGBB or rgba(r,g,b,a)"},"fonts":{"pair":"<pair id>","latin":"<font id>","bengali":"<font id>","latinHeading":"..","latinBody":"..","bengaliHeading":"..","bengaliBody":".."},"radius":0.0-1.2,"backgrounds":{"content":{"label":"..","css":"valid CSS background, no url()","pptx":"RRGGBB","dark":true|false},"hero":{...}},"chart":["RRGGBB","RRGGBB", "... 5-7 distinct colors"]}\n` +
    `PRESET THEMES (use "base" only when the user asks to switch to a different overall style; otherwise just change the keys they mention): ${themes}.\n` +
    `FONT PAIRS (heading+body for both scripts, set with "fonts.pair"): ${cat.pairs}.\n` +
    `LATIN FONT IDS: ${cat.latin}.\nBENGALI FONT IDS: ${cat.bengali}.\n` +
    `Use ONLY the font ids above; match fonts by the name the user says (e.g. "কালপুরুষ"/"Kalpurush" -> "kalpurush"). "fonts.bengali"/"fonts.latin" set heading and body together; explicit ids win over "pair".\n` +
    `RULES: "darker"/"আরও গাঢ়" = use "mode":"dark" (and/or deepen the palette); "lighter"/"হালকা" = "mode":"light"; "rounder"/"sharper" = change "radius". Keep colors with enough contrast (text/title must stay clearly readable on the content background). "pptx" is a 6-digit hex approximating the css. "dark":true only if text on that background must be light. Keep everything the user did NOT mention unchanged.\n` +
    `CURRENT THEME: ${JSON.stringify({ id: (deck.theme && deck.theme.id) || 'classic', palette: cur.palette, fonts: cur.fonts, radius: cur.radius })}\n`
  );
}

async function applySlideThemeViaAI(promptText, fileContextString, modelsUsedSet) {
  const deck = typeof APP_STATE !== 'undefined' ? APP_STATE.slideDeck : null;
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) return { ok: false, message: 'No slide deck is available to style.' };
  // Start every request from the model the user currently has selected. The
  // lock is only for keeping one multi-call build on the same model; a stale
  // lock from an earlier turn made the app ignore model switches.
  if (typeof _generationLockedModelConfig !== 'undefined') _generationLockedModelConfig = null;
  const activeCfg = undefined;
  const userPrompt = `DECK TITLE: ${deck.title || ''}\n` + (fileContextString ? `CONTEXT:\n${fileContextString}\n\n` : '') +
    `REQUESTED THEME CHANGE:\n${promptText}\n\nReturn the JSON patch now.`;
  try {
    const result = await callAIAPI(
      [{ role: 'system', content: buildSlideThemeSystemPrompt(deck) }, { role: 'user', content: userPrompt }],
      { forceJson: true, modelsUsedSet, modelConfig: activeCfg, maxTokens: undefined }
    );
    if (result && result.modelConfig && typeof _generationLockedModelConfig !== 'undefined') _generationLockedModelConfig = result.modelConfig;
    let parsed = safeParseAIJson(result.content, null);
    if (!parsed) parsed = attemptRepairAndParse(result.content);
    const patch = sanitizeSlideThemePatch(parsed && parsed.patch ? parsed.patch : parsed);
    if (!patch) return { ok: false, message: 'The AI did not return a usable theme change. Try describing it differently.' };
    applySlideThemePatch(patch);
    return { ok: true, patch };
  } catch (e) {
    console.error('[SlideTheme] AI theme change failed:', e);
    return { ok: false, message: (e && e.message) ? String(e.message) : 'Unknown error.', noModelConfigured: !!(e && e.noModelConfigured) };
  }
}

// Same slot as the text field in the panel; also callable from the chat router.
async function submitSlideThemePrompt() {
  const input = document.getElementById('slide-theme-prompt-input');
  const btn = document.getElementById('slide-theme-prompt-btn');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  const res = await applySlideThemeViaAI(text, '', new Set());
  if (!res.ok && typeof displayToastNotification === 'function') displayToastNotification(res.message || 'Theme change failed.');
  if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }
}

// ------------------------------------------------------------------------
// UI: toolbar button + panel (rendered by renderSlideDeckPreview)
// ------------------------------------------------------------------------
let _slideThemePickerOpen = false;

function toggleSlideThemePicker() {
  _slideThemePickerOpen = !_slideThemePickerOpen;
  const panel = document.getElementById('slide-theme-picker-panel');
  const btn = document.getElementById('slide-theme-toggle-btn');
  if (panel) { panel.classList.toggle('open', _slideThemePickerOpen); if (_slideThemePickerOpen) panel.innerHTML = renderSlideThemePanelHTML(); }
  if (btn) btn.setAttribute('aria-expanded', _slideThemePickerOpen ? 'true' : 'false');
}

function renderSlideThemePanelHTML(deck) {
  const d = _stDeck(deck);
  const cur = resolveSlideTheme(d);
  const curId = (d && d.theme && SLIDE_THEMES[d.theme.id]) ? d.theme.id : 'classic';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const cards = Object.keys(SLIDE_THEMES).map(id => {
    const t = SLIDE_THEMES[id], bg = (t.backgrounds.content && t.backgrounds.content.css) || '#ffffff';
    const dark = t.backgrounds.content && t.backgrounds.content.dark;
    return `<button type="button" class="sth-card${id === curId ? ' active' : ''}" onclick="setSlideTheme('${id}')" title="${esc(t.blurb)}">
      <div class="sth-card-prev" style="background:${bg};--f:${slideThemeFontStack(t, 'heading')};">
        <div class="sth-card-bar" style="background:${t.palette.accent};"></div>
        <div class="sth-card-aa" style="font-family:var(--f);color:${dark ? '#ffffff' : t.palette.title};">Aa অ</div>
      </div><div class="sth-card-name">${esc(t.label)}</div></button>`;
  }).join('');
  const opts = (script, sel) => Object.keys(SLIDE_FONT_REGISTRY).filter(id => SLIDE_FONT_REGISTRY[id].script === script)
    .map(id => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(SLIDE_FONT_REGISTRY[id].label)}</option>`).join('');
  const pairOpts = '<option value="">— choose —</option>' + Object.keys(SLIDE_FONT_PAIRS).map(id =>
    '<option value="' + id + '">' + SLIDE_FONT_PAIRS[id].label + ' · ' + SLIDE_FONT_PAIRS[id].mood + '</option>').join('');
  const isDark = !!(cur.backgrounds.content && cur.backgrounds.content.dark);
  return `
    <div class="sth-sec">Theme — changes the look only, never your content</div>
    <div class="sth-grid">${cards}</div>
    <div class="sth-row">
      <button type="button" class="sth-btn${isDark ? '' : ' active'}" onclick="setSlideThemeMode('light')">☀ Light</button>
      <button type="button" class="sth-btn${isDark ? ' active' : ''}" onclick="setSlideThemeMode('dark')">🌙 Dark</button>
      <label>Bengali font <select onchange="setSlideThemeFont('bengali', this.value)">${opts('bengali', cur.fonts.bengaliBody)}</select></label>
      <label>English font <select onchange="setSlideThemeFont('latin', this.value)">${opts('latin', cur.fonts.latinBody)}</select></label>
      <label>Font pair <select onchange="if(this.value)setSlideThemePair(this.value)">${pairOpts}</select></label>
      <button type="button" class="sth-btn" onclick="undoSlideThemeChange()">↶ Undo</button>
    </div>
    <div class="sth-row">
      <input type="text" id="slide-theme-prompt-input" placeholder="e.g. আরও গাঢ় করো, বাংলা ফন্ট কালপুরুষ রাখো" onkeydown="if(event.key==='Enter'){event.preventDefault();submitSlideThemePrompt();}">
      <button type="button" class="sth-btn" id="slide-theme-prompt-btn" onclick="submitSlideThemePrompt()">Apply</button>
    </div>
    <p class="sth-note">Preview, PDF and PowerPoint all read this one theme. PowerPoint uses a safe equivalent font (Arial, Georgia, Nirmala UI …) so slides look the same on every computer.</p>`;
}

function slideThemeToolbarButtonHTML() {
  return `<button type="button" class="slide-edit-btn" id="slide-theme-toggle-btn" onclick="toggleSlideThemePicker()" title="Change the deck's theme: colors, fonts, backgrounds" aria-haspopup="true" aria-expanded="${_slideThemePickerOpen ? 'true' : 'false'}">🎭 Theme</button>`;
}

function slideThemePanelHTML(deck) {
  return `<div class="slide-bg-picker-panel${_slideThemePickerOpen ? ' open' : ''}" id="slide-theme-picker-panel">${renderSlideThemePanelHTML(deck)}</div>`;
}

// ------------------------------------------------------------------------
// AI DECK GENERATION HOOK — appended to the deck JSON schema/rules
// ------------------------------------------------------------------------
function getSlideThemeSchemaKeyForPrompt() {
  return `,"theme":{"base":"optional preset id","palette":{"accent":"#RRGGBB","accent2":"#RRGGBB","text":"#RRGGBB","title":"#RRGGBB","muted":"#RRGGBB","cardBg":"rgba(r,g,b,0.1)"},"fonts":{"pair":"pair id"},"radius":0.5,"backgrounds":{"content":{"label":"..","css":"CSS gradient or color","pptx":"RRGGBB","dark":false},"hero":{"label":"..","css":"..","pptx":"RRGGBB","dark":true}},"chart":["RRGGBB","RRGGBB","RRGGBB","RRGGBB","RRGGBB","RRGGBB"]}`;
}
function getSlideThemeRuleForPrompt() {
  const presets = Object.keys(SLIDE_THEMES).map(id => `${id} (${SLIDE_THEMES[id].blurb})`).join('; ');
  const cat = _stFontCatalogForPrompt();
  return (
    `- "theme" (top-level, sibling of "slides"): you are free to DESIGN this deck's look. Give either a preset id string or, whenever the subject calls for its own look (usually), a full theme OBJECT. Every key inside is optional: "base", "palette", "fonts", "radius", "backgrounds", "chart".\n` +
    `  * Derive colors, fonts, corner style and mood from THIS deck's subject, audience and tone (examples: ocean/environment -> teal + deep blue; finance/law -> navy + gold with a serif; health -> calm greens; kids -> bright, rounded; tech/startup -> dark or vivid with a geometric sans; history/literature -> warm paper tones with a serif). Do NOT reuse one look for every deck and do not fall back to purple/blue out of habit.\n` +
    `  * "palette": hex colors #RRGGBB ("cardBg" may be rgba). "text" and "title" MUST contrast strongly with "backgrounds.content"; "muted" must stay readable.\n` +
    `  * "backgrounds": "content" (normal slides) and "hero" (title/section/quote slides), each {"label","css":"a CSS gradient or color, no url()","pptx":"RRGGBB of its dominant color","dark":true only if text on it must be light}.\n` +
    `  * "chart": 5-7 distinct hex colors that harmonize with the palette.\n` +
    `  * "radius": 0 (sharp) to 1.2 (very round).\n` +
    `  * "fonts": either {"pair":"<pair id>"} or choose by id: {"latinHeading","latinBody","bengaliHeading","bengaliBody"} (or "latin"/"bengali" to set heading+body together). Use ONLY these ids. For Bengali content always set Bengali fonts too.\n` +
    `    PAIRS: ${cat.pairs}.\n    LATIN: ${cat.latin}.\n    BENGALI: ${cat.bengali}.\n` +
    `  * Presets are optional starting points via "base" (a preset is a start, never a default): ${presets}.\n`
  );
}

window.SLIDE_FONT_REGISTRY = SLIDE_FONT_REGISTRY;
window.SLIDE_THEMES = SLIDE_THEMES;
window.resolveSlideTheme = resolveSlideTheme;
window.setSlideTheme = setSlideTheme;
window.setSlideThemeMode = setSlideThemeMode;
window.setSlideThemeFont = setSlideThemeFont;
window.undoSlideThemeChange = undoSlideThemeChange;
window.toggleSlideThemePicker = toggleSlideThemePicker;
window.submitSlideThemePrompt = submitSlideThemePrompt;
window.applySlideThemeViaAI = applySlideThemeViaAI;
window.applySlideThemePatch = applySlideThemePatch;
window.SLIDE_FONT_PAIRS = SLIDE_FONT_PAIRS;
window.setSlideThemePair = setSlideThemePair;
window.sanitizeDeckThemeRef = sanitizeDeckThemeRef;
window.slideThemePptx = slideThemePptx;