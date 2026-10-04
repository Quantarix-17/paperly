// ========================================================================
// WORD EXPORT — native .docx (OOXML) via docx.js
// ------------------------------------------------------------------------
// Replaces the old "raw HTML saved as .doc" trick with a real Word file, the
// same way slide-studio.js builds real .pptx files with PptxGenJS: every
// heading / paragraph / table cell / list item is created as an explicit docx
// object with its own colour, font, border and background, so nothing depends
// on an external stylesheet being available inside Word.
//
// Where the styling comes from
//   The editor HTML is mounted off-screen inside a .doc-page-canvas stage
//   (so the real styles.css rules apply) and every value is read back with
//   getComputedStyle(). Nothing is hard-coded here, so changing styles.css
//   automatically changes the Word output too.
//
// Dependencies (all optional except `docx`; each has a fallback)
//   - window.docx                         docx CDN script in index.html
//   - getAllCanvasHTML(), getDocumentTopicName(), _setExportButtonBusy(),
//     _rasterizeMathForWordExport(), ensurePDFRenderLibraries()   pdf-export.js
//   - window.rasterizeSvgPreservingAspect()                     slide-studio.js
//   - window.exportToWordDocumentLegacy   raw-HTML fallback      pdf-export.js
//
// Load order: after slide-studio.js, before app.js.
// ========================================================================
(function () {
  'use strict';

  // ---- unit helpers (CSS px @96dpi -> Word units) -----------------------
  const TW = 15;        // 1px = 15 twips (DXA)
  const HALF_PT = 1.5;  // 1px = 0.75pt = 1.5 half-points
  const EIGHTH_PT = 6;  // 1px = 0.75pt = 6 eighths of a point
  const MAX_IMG_PX = 1800; // larger raster images are downscaled (still sharp at page width)
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const tw = (v) => Math.max(0, Math.round(px(v) * TW));

  const A4 = { w: 11906, h: 16838 }; // twips

  function pageLayout() {
    const L = (typeof PDF_LAYOUT !== 'undefined' && PDF_LAYOUT) || {};
    return {
      width: L.width || 794,
      height: L.height || 1123,
      top: L.padTop != null ? L.padTop : 62,
      right: L.padRight != null ? L.padRight : 58,
      bottom: L.padBottom != null ? L.padBottom : 58,
      left: L.padLeft != null ? L.padLeft : 58
    };
  }

  // ---- colour helpers ---------------------------------------------------
  let _colorCanvasCtx = null;
  function parseCssColor(str) {
    if (!str) return null;
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i.exec(str.trim());
    if (m) {
      let a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (m[5] === '%') a /= 100;
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    // color(srgb ...), oklch(), named colours etc. -> let a canvas resolve it
    try {
      if (!_colorCanvasCtx) {
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        _colorCanvasCtx = c.getContext('2d', { willReadFrequently: true });
      }
      _colorCanvasCtx.clearRect(0, 0, 1, 1);
      _colorCanvasCtx.fillStyle = '#000';
      _colorCanvasCtx.fillStyle = str;
      _colorCanvasCtx.fillRect(0, 0, 1, 1);
      const d = _colorCanvasCtx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch (_) { return null; }
  }
  // CSS colour -> 'RRGGBB' (alpha blended over white); null when transparent
  // Monochrome mode (body.photocopy-mode): every colour is exported as a gray.
  function isMono() {
    return !!((document.body && document.body.classList.contains('photocopy-mode')) ||
      (document.documentElement && document.documentElement.classList.contains('photocopy-mode')));
  }
  function toGray(hex) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b).toString(16).padStart(2, '0').toUpperCase();
    return y + y + y;
  }
  const monoHex = (hex) => (hex && isMono()) ? toGray(hex) : hex;
  function hexColor(str) {
    if (!str || str === 'transparent') return null;
    const c = parseCssColor(str);
    if (!c || c.a <= 0.01) return null;
    const mix = (v) => Math.round(v * c.a + 255 * (1 - c.a));
    return monoHex([mix(c.r), mix(c.g), mix(c.b)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase());
  }

  // ---- font helpers -----------------------------------------------------
  const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong',
    '-apple-system', 'blinkmacsystemfont']);
  const BENGALI_RE = /[\u0980-\u09FF]/;
  const BENGALI_FONT_RE = /bangla|bengali|siyam|kalpurush|solaiman|nikosh|lohit|vrinda|shonar|nirmala|siliguri|mukti|akaash|sutonny/i;

  function fontFamilies(fontFamily) {
    return String(fontFamily || '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  // Fixed font policy: English -> Times New Roman, Bengali -> Kalpurush, always
  // (the on-screen CSS font stack no longer decides the Word font).
  const LATIN_FONT = 'Times New Roman';
  const BENGALI_FONT = 'Kalpurush';
  function pickFont(fontFamily) {
    const parts = fontFamilies(fontFamily);
    const g = (parts[parts.length - 1] || '').toLowerCase();
    // code blocks keep a monospace face so they stay readable
    if (parts.some(p => /^(courier|consolas|menlo|monaco|monospace|ui-monospace)/i.test(p)) || g === 'monospace') return 'Courier New';
    return LATIN_FONT;
  }
  function pickComplexFont() {
    return BENGALI_FONT;
  }

  // ---- misc DOM helpers -------------------------------------------------
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'head',
    'button', 'input', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'audio', 'video']);
  const BLOCK_DISPLAY = new Set(['block', 'flex', 'grid', 'list-item', 'table', 'table-row-group',
    'table-header-group', 'table-footer-group', 'table-row', 'table-cell', 'table-caption', 'flow-root', '-webkit-box']);
  const BLOCK_SELECTOR = 'p,div,ul,ol,li,table,h1,h2,h3,h4,h5,h6,blockquote,pre,figure,hr,section,article';

  const isEl = (n) => n && n.nodeType === 1;
  const isText = (n) => n && n.nodeType === 3;
  const tagOf = (el) => (el.localName || '').toLowerCase();

  function isHidden(el, cs) {
    if (SKIP_TAGS.has(tagOf(el))) return true;
    if (el.hasAttribute('hidden')) return true;
    if (el.classList.contains('katex-mathml') || el.classList.contains('page-footer-number')) return true;
    cs = cs || getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse';
  }

  // ---- run (character) formatting --------------------------------------
  function decorationOf(el, stopAt) {
    let under = false, strike = false;
    for (let n = el; n && n !== stopAt && isEl(n); n = n.parentElement) {
      const d = getComputedStyle(n).textDecorationLine || '';
      if (d.includes('underline')) under = true;
      if (d.includes('line-through')) strike = true;
      if (getComputedStyle(n).display !== 'inline') break;
    }
    return { under, strike };
  }
  function inlineBackground(el) {
    for (let n = el; n && isEl(n); n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display !== 'inline' && cs.display !== 'inline-block') break;
      const bg = isMono() ? null : hexColor(cs.backgroundColor);
      if (bg) return bg;
    }
    return null;
  }

  function runFormat(el) {
    const cs = getComputedStyle(el);
    const weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400);
    const dec = decorationOf(el);
    const fam = cs.fontFamily;
    return {
      size: Math.max(2, Math.round(px(cs.fontSize) * HALF_PT)),
      bold: weight >= 600,
      italics: /italic|oblique/.test(cs.fontStyle),
      underline: dec.under,
      strike: dec.strike,
      color: hexColor(cs.color) || '000000',
      font: pickFont(fam),
      csFont: pickComplexFont(fam),
      bg: inlineBackground(el),
      sup: cs.verticalAlign === 'super' || tagOf(el) === 'sup',
      sub: cs.verticalAlign === 'sub' || tagOf(el) === 'sub',
      transform: cs.textTransform
    };
  }

  let BASE = null; // run format of the page itself (Word's document default)

  // Only properties that differ from the page default are written on the run, so
  // text typed next to it in Word stays plain (no stuck colours / sizes / fonts).
  function makeTextRun(text, f, extra) {
    const D = window.docx;
    let t = text;
    if (f.transform === 'lowercase') t = t.toLowerCase();
    else if (f.transform === 'capitalize') t = t.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    const B = BASE || {};
    const opts = { text: t };
    if (f.size !== B.size) { opts.size = f.size; opts.sizeComplexScript = f.size; }
    if (f.bold) { opts.bold = true; opts.boldComplexScript = true; }
    if (f.italics) { opts.italics = true; opts.italicsComplexScript = true; }
    if (f.color !== B.color) opts.color = f.color;
    if (f.font !== B.font) opts.font = { ascii: f.font, hAnsi: f.font, eastAsia: f.font, cs: BENGALI_RE.test(t) ? f.csFont : f.font };
    if (f.underline) opts.underline = { type: D.UnderlineType.SINGLE, color: f.color };
    if (f.strike) opts.strike = true;
    if (f.transform === 'uppercase') opts.allCaps = true;
    if (f.sup) opts.superScript = true;
    if (f.sub) opts.subScript = true;
    if (f.bg) opts.shading = { type: D.ShadingType.CLEAR, fill: f.bg, color: 'auto' };
    return new D.TextRun(Object.assign(opts, extra || {}));
  }

  // ---- equations: KaTeX MathML -> native Word equations (OMML) ---------
  // KaTeX keeps a hidden <math> tree beside its visual output. Converting that
  // tree to Office Math gives real, vector, editable Word equations at any
  // zoom, with no canvas snapshot. Anything the converter cannot handle
  // returns null and the older picture path is used instead.
  const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const mathCache = new WeakMap();
  const BIG_OPS = new Set(['\u2211', '\u220F', '\u222B', '\u222E', '\u22C3', '\u22C2', '\u2210', '\u2A01', '\u22C1', '\u22C0']);
  const mEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const mEls = (el) => Array.from(el.childNodes).filter(isEl);

  function mRun(text, plain, style) {
    const sty = style ? `<m:rPr><m:sty m:val="${style}"/></m:rPr>` : (plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : '');
    return `<m:r>${sty}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${mEsc(text)}</m:t></m:r>`;
  }
  const mArg = (el) => (el ? mmlNode(el) : '');

  // Stretchy fences (brackets, bars, braces) must be Word delimiters (m:d) so
  // Word grows them to the height of their content. A plain <mo> stays the
  // size of a text character, which is why matrix brackets looked tiny.
  const FENCE_PAIR = { '(': ')', '[': ']', '{': '}', '|': '|', '\u2016': '\u2016',
    '\u2329': '\u232A', '\u27E8': '\u27E9', '\u230A': '\u230B', '\u2308': '\u2309',
    '\u27E6': '\u27E7', '\u230C': '\u230D' };
  // KaTeX / MathML often use look-alike code points for bars and angle brackets
  // (e.g. vmatrix -> U+2223). Map them to the characters Word stretches.
  const FENCE_ALIAS = { '\u2223': '|', '\u2225': '\u2016', '\u01C0': '|', '\uFF5C': '|',
    '\u3008': '\u27E8', '\u3009': '\u27E9', '\u2329': '\u27E8', '\u232A': '\u27E9' };
  const fch = (el) => { const t = el.textContent.trim(); return FENCE_ALIAS[t] || t; };
  const CLOSERS = new Set(Object.values(FENCE_PAIR).map(c => FENCE_ALIAS[c] || c));
  const TALL = new Set(['mtable', 'mfrac', 'msqrt', 'mroot', 'munder', 'mover', 'munderover']);
  const hasTall = (el) => TALL.has(tagOf(el)) || mEls(el).some(hasTall);
  const mDelim = (open, close, inner) =>
    `<m:d><m:dPr><m:begChr m:val="${mEsc(open)}"/><m:endChr m:val="${mEsc(close)}"/></m:dPr><m:e>${inner}</m:e></m:d>`;
  // index of the closing fence matching the opener at kids[i] (same level), or -1
  function findClose(kids, i) {
    const open = fch(kids[i]), close = FENCE_ALIAS[FENCE_PAIR[open]] || FENCE_PAIR[open];
    let depth = 0;
    for (let j = i + 1; j < kids.length; j++) {
      if (tagOf(kids[j]) !== 'mo') continue;
      const t = fch(kids[j]);
      if (open !== close && t === open) depth++;
      else if (t === close) { if (depth === 0) return j; depth--; }
    }
    return -1;
  }

  function mmlChildren(parent) {
    const kids = mEls(parent);
    let out = '';
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i], t = tagOf(k), ks = mEls(k);
      const isSub = ['msub', 'msubsup', 'munder', 'munderover'].includes(t);
      const isSup = ['msup', 'msubsup', 'mover', 'munderover'].includes(t);
      const base = ks[0];
      // stretchy fence: emit an auto-sizing Word delimiter
      if (t === 'mo') {
        const ch = fch(k), stretchy = k.getAttribute('stretchy') === 'true';
        if (FENCE_PAIR[ch]) {
          const close = findClose(kids, i);
          if (close > i) {
            const inner = kids.slice(i + 1, close);
            if (stretchy || inner.some(hasTall)) {
              out += mDelim(ch, FENCE_ALIAS[FENCE_PAIR[ch]] || FENCE_PAIR[ch], mmlChildren({ childNodes: inner }));
              i = close;
              continue;
            }
          } else if (stretchy) {
            // unmatched stretchy fence: \left| ... \right.  or  \left. ... \right|
            if (i === kids.length - 1 && out && (ch === '|' || ch === '\u2016')) {
              out = mDelim('', ch, out);                       // closing-only bar
            } else if (i < kids.length - 1) {
              out += mDelim(ch, '', mmlChildren({ childNodes: kids.slice(i + 1) })); // cases: { ... (no closer)
              break;
            }
            if (i === kids.length - 1) continue;
          }
        } else if (stretchy && CLOSERS.has(ch) && out) {
          out = mDelim('', ch, out);                           // \left. ... \right) / ] / }
          continue;
        }
      }
      if ((isSub || isSup) && base && tagOf(base) === 'mo' && BIG_OPS.has(base.textContent.trim())) {
        // big operator (sum / product / integral): the rest of the row is its body
        let idx = 1;
        const sub = isSub ? mArg(ks[idx++]) : '';
        const sup = isSup ? mArg(ks[idx++]) : '';
        const chr = mEsc(base.textContent.trim());
        const limLoc = /[\u222B\u222E]/.test(chr) ? 'subSup' : 'undOvr';
        const hide = (on, tag) => (on ? '' : `<m:${tag} m:val="1"/>`);
        const body = mmlChildren({ childNodes: kids.slice(i + 1) });
        return out + `<m:nary><m:naryPr><m:chr m:val="${chr}"/><m:limLoc m:val="${limLoc}"/>${hide(!!sub, 'subHide')}${hide(!!sup, 'supHide')}</m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${body}</m:e></m:nary>`;
      }
      out += mmlNode(k);
    }
    return out;
  }

  function mmlNode(el) {
    const t = tagOf(el), ks = mEls(el);
    switch (t) {
      case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'merror':
        return mmlChildren(el);
      case 'menclose': {
        const n = (el.getAttribute('notation') || '').split(/\s+/);
        const box = n.includes('box') || n.includes('roundedbox');
        const up = n.includes('updiagonalstrike'), down = n.includes('downdiagonalstrike');
        if (!box && !up && !down) return mmlChildren(el);
        const hide = box ? '' : ['Top', 'Bot', 'Left', 'Right'].map(x => `<m:hide${x} m:val="1"/>`).join('');
        const strike = (up ? '<m:strikeBLTR m:val="1"/>' : '') + (down ? '<m:strikeTLBR m:val="1"/>' : '');
        return `<m:borderBox><m:borderBoxPr>${hide}${strike}</m:borderBoxPr><m:e>${mmlChildren(el)}</m:e></m:borderBox>`;
      }
      case 'semantics': return ks.length ? mmlNode(ks[0]) : '';
      case 'mspace': {
        const wEm = parseFloat(el.getAttribute('width') || '0');
        return wEm >= 0.15 ? `<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space="preserve"> </m:t></m:r>` : '';
      }
      case 'annotation': case 'annotation-xml': case 'mphantom': case 'mprescripts': case 'none':
        return '';
      case 'mtext': case 'ms': {
        // Ordinary words inside an equation (\text{...}, \textbf{...}). KaTeX puts
        // the spaces between words in their own <mtext>&nbsp;</mtext>, and
        // String.trim() strips NBSP, so they used to be dropped -> "hegoestoschool".
        // <m:nor/> = "normal text" run: Word keeps every space in it.
        const text = el.textContent.replace(/\u00A0/g, ' ');
        if (!text) return '';
        const mv = el.getAttribute('mathvariant') || ((el.closest && el.closest('[mathvariant]')) || { getAttribute: () => '' }).getAttribute('mathvariant');
        const bold = /bold/.test(mv || '');
        return `<m:r><m:rPr><m:nor/></m:rPr><w:rPr><w:rFonts w:ascii="${LATIN_FONT}" w:hAnsi="${LATIN_FONT}" w:eastAsia="${LATIN_FONT}" w:cs="${BENGALI_FONT}"/>${bold ? '<w:b/><w:bCs/>' : ''}${/italic/.test(mv || '') ? '<w:i/><w:iCs/>' : ''}</w:rPr><m:t xml:space="preserve">${mEsc(text)}</m:t></m:r>`;
      }
      case 'mi': case 'mn': case 'mo': {
        const text = el.textContent;
        if (!text.trim() || text === '\u2061') return '';   // invisible function-application mark
        const mv = el.getAttribute('mathvariant');
        const style = ({ bold: 'b', italic: 'i', 'bold-italic': 'bi' })[mv] || '';
        const plain = mv === 'normal' ||
          (t === 'mi' && /^[A-Za-z]{2,}$/.test(text));
        return mRun(text, plain, style);
      }
      case 'mfrac': {
        const noBar = el.getAttribute('linethickness') === '0';
        return `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${mArg(ks[0])}</m:num><m:den>${mArg(ks[1])}</m:den></m:f>`;
      }
      case 'msqrt':
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${mmlChildren(el)}</m:e></m:rad>`;
      case 'mroot':
        return `<m:rad><m:deg>${mArg(ks[1])}</m:deg><m:e>${mArg(ks[0])}</m:e></m:rad>`;
      case 'msup':
        return `<m:sSup><m:e>${mArg(ks[0])}</m:e><m:sup>${mArg(ks[1])}</m:sup></m:sSup>`;
      case 'msub':
        return `<m:sSub><m:e>${mArg(ks[0])}</m:e><m:sub>${mArg(ks[1])}</m:sub></m:sSub>`;
      case 'msubsup':
        return `<m:sSubSup><m:e>${mArg(ks[0])}</m:e><m:sub>${mArg(ks[1])}</m:sub><m:sup>${mArg(ks[2])}</m:sup></m:sSubSup>`;
      case 'mover': {
        if (el.getAttribute('accent') === 'true') {
          return `<m:acc><m:accPr><m:chr m:val="${mEsc((ks[1] || {}).textContent || '')}"/></m:accPr><m:e>${mArg(ks[0])}</m:e></m:acc>`;
        }
        return `<m:limUpp><m:e>${mArg(ks[0])}</m:e><m:lim>${mArg(ks[1])}</m:lim></m:limUpp>`;
      }
      case 'munder':
        return `<m:limLow><m:e>${mArg(ks[0])}</m:e><m:lim>${mArg(ks[1])}</m:lim></m:limLow>`;
      case 'munderover':
        return `<m:limUpp><m:e><m:limLow><m:e>${mArg(ks[0])}</m:e><m:lim>${mArg(ks[1])}</m:lim></m:limLow></m:e><m:lim>${mArg(ks[2])}</m:lim></m:limUpp>`;
      case 'mfenced': {
        const open = el.getAttribute('open') ?? '(';
        const close = el.getAttribute('close') ?? ')';
        const sep = (el.getAttribute('separators') ?? ',').charAt(0);
        const elems = ks.map(k => `<m:e>${mmlNode(k)}</m:e>`).join('');
        return `<m:d><m:dPr><m:begChr m:val="${mEsc(open)}"/><m:sepChr m:val="${mEsc(sep)}"/><m:endChr m:val="${mEsc(close)}"/></m:dPr>${elems}</m:d>`;
      }
      case 'mtable': {
        const rows = ks.filter(k => tagOf(k) === 'mtr' || tagOf(k) === 'mlabeledtr');
        const cells = rows.map(r => mEls(r).filter(c => tagOf(c) === 'mtd'));
        const ncol = Math.max(1, ...cells.map(c => c.length));
        const aligns = (el.getAttribute('columnalign') || 'center').split(/\s+/).filter(Boolean);
        const jc = (i) => { const a = aligns[Math.min(i, aligns.length - 1)]; return a === 'left' || a === 'right' ? a : 'center'; };
        const mcs = Array.from({ length: ncol }, (_, i) => `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${jc(i)}"/></m:mcPr></m:mc>`).join('');
        const mPr = Array.from({ length: ncol }, (_, i) => jc(i)).some(a => a !== 'center') ? `<m:mPr><m:mcs>${mcs}</m:mcs></m:mPr>` : '';
        return `<m:m>${mPr}${cells.map(r => `<m:mr>${Array.from({ length: ncol }, (_, i) => `<m:e>${r[i] ? mmlChildren(r[i]) : ''}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
      }
      default: {
        if (ks.length) return mmlChildren(el);
        const text = el.textContent;
        return text.trim() ? mRun(text, false) : '';
      }
    }
  }

  // Text that was only WRAPPED in math (\textbf{he goes to school}, \mathbf{...},
  // \text{...}) is ordinary text, not an equation: return it as plain runs so it
  // stays normal, editable Word text with its spaces (and bold) intact.
  // Returns [{text, bold, italics}] or null when the node is a real equation.
  const TEXT_CMD = /\\(textbf|mathbf|boldsymbol|bf|text|textrm|mathrm|textnormal|textit|mathit|emph|textsf|mathsf)\s*\{([^{}\\^_$]*)\}/y;
  function mathAsPlainText(node) {
    let tex = node.getAttribute && node.getAttribute('data-latex');
    if (!tex) {
      const ann = node.querySelector && node.querySelector('annotation[encoding="application/x-tex"]');
      tex = ann ? ann.textContent : '';
    }
    if (tex) {
      const segs = [];
      let i = 0;
      const src = tex.trim();
      while (i < src.length) {
        TEXT_CMD.lastIndex = i;
        const m = TEXT_CMD.exec(src);
        if (m) {
          const cmd = m[1];
          segs.push({ text: m[2], bold: /^(textbf|mathbf|boldsymbol|bf)$/.test(cmd), italics: /^(textit|mathit|emph)$/.test(cmd) });
          i = TEXT_CMD.lastIndex;
          continue;
        }
        const rest = src.slice(i);
        const gap = /^(?:\s+|~|\\[ ,;:!]|\\quad|\\qquad)/.exec(rest);
        if (gap) { segs.push({ text: ' ', bold: false, italics: false }); i += gap[0].length; continue; }
        return null; // anything else (numbers, operators, ^, _, \frac ...) = real math
      }
      if (segs.length && segs.some(x => /[A-Za-z\u0980-\u09FF]/.test(x.text))) return segs;
      return null;
    }
    // no TeX source available: accept math made only of <mtext>
    const root = node.querySelector && node.querySelector('math');
    if (!root) return null;
    const leaves = Array.from(root.querySelectorAll('mi,mn,mo,mtext,ms,mspace')).filter(l => !l.closest('annotation'));
    if (!leaves.length || !leaves.every(l => /^(mtext|mspace)$/.test(tagOf(l)))) return null;
    const segs = leaves.map(l => ({
      text: tagOf(l) === 'mspace' ? ' ' : l.textContent.replace(/\u00A0/g, ' '),
      bold: /bold/.test(l.getAttribute('mathvariant') || ''), italics: /italic/.test(l.getAttribute('mathvariant') || '')
    }));
    return segs.some(x => /\S/.test(x.text)) ? segs : null;
  }

  // OMML for one rendered equation node, or null (-> picture fallback)
  function mathOmml(node) {
    if (mathCache.has(node)) return mathCache.get(node);
    let out = null;
    try {
      const root = node.querySelector('math');
      if (root) { const x = mmlNode(root); out = /<m:/.test(x) ? x : null; }
    } catch (e) {
      console.warn('[WordExport] equation kept as picture:', e);
    }
    mathCache.set(node, out);
    return out;
  }

  // ---- inline content -> pieces -> docx runs ----------------------------
  // pieces: {t:'text',text,f} | {t:'br'} | {t:'img',el} | {t:'link',href,pieces}
  function collectPieces(nodes, st) {
    const w = { prevSpace: true, lastText: null };
    const walk = (list, out) => {
      for (const node of list) {
        if (isText(node)) {
          const parent = node.parentElement;
          if (!parent) continue;
          const pcs = getComputedStyle(parent);
          const ws = pcs.whiteSpace;
          const keepSpaces = ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces';
          const keepLines = keepSpaces || ws === 'pre-line';
          let raw = node.nodeValue.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
          if (!raw) continue;
          const f = runFormat(parent);
          if (keepLines) {
            raw = raw.replace(/\r\n?/g, '\n');
            raw.split('\n').forEach((line, i) => {
              if (i > 0) { out.push({ t: 'br' }); w.lastText = null; w.prevSpace = true; }
              let seg = line.replace(/\t/g, '    ');
              if (!keepSpaces) seg = seg.replace(/[ \t\f]+/g, ' ');
              if (seg) { const p = { t: 'text', text: seg, f }; out.push(p); w.lastText = p; w.prevSpace = false; }
            });
            continue;
          }
          let text = raw.replace(/[ \t\r\n\f]+/g, ' ');
          if (w.prevSpace && text.startsWith(' ')) text = text.slice(1);
          if (!text) continue;
          w.prevSpace = text.endsWith(' ');
          const p = { t: 'text', text, f };
          out.push(p); w.lastText = p;
        } else if (isEl(node)) {
          const cs = getComputedStyle(node);
          if (isHidden(node, cs)) continue;
          const tag = tagOf(node);
          if (tag === 'br') { out.push({ t: 'br' }); w.lastText = null; w.prevSpace = true; continue; }
          if (node.classList.contains('katex-eq') || node.classList.contains('katex')) {
            const plainSegs = mathAsPlainText(node);
            if (plainSegs) {
              const base = runFormat(node.parentElement || node);
              for (const sg of plainSegs) {
                let text = sg.text.replace(/[ \t\r\n\f\u00A0]+/g, ' ');
                if (w.prevSpace && text.startsWith(' ')) text = text.slice(1);
                if (!text) continue;
                w.prevSpace = text.endsWith(' ');
                const p = { t: 'text', text, f: Object.assign({}, base, { bold: base.bold || sg.bold, italics: base.italics || sg.italics }) };
                out.push(p); w.lastText = p;
              }
              continue;
            }
            const omml = mathOmml(node);
            if (omml) { out.push({ t: 'math', xml: omml }); w.lastText = null; w.prevSpace = false; continue; }
          }
          if (st.media.has(node)) { out.push({ t: 'img', el: node }); w.lastText = null; w.prevSpace = false; continue; }
          if (tag === 'svg' || tag === 'canvas') continue; // could not be rasterized: never dump its <text> nodes
          if (node.classList.contains('katex-eq') || node.classList.contains('katex')) {
            const tex = node.getAttribute('data-latex') || node.textContent || '';
            const f = Object.assign({}, runFormat(node), { italics: true, font: 'Cambria Math' });
            const p = { t: 'text', text: ' ' + tex.trim() + ' ', f };
            out.push(p); w.lastText = null; w.prevSpace = true; continue;
          }
          if (tag === 'a') {
            const href = node.getAttribute('href') || '';
            if (/^(https?:|mailto:)/i.test(href)) {
              const inner = [];
              walk(Array.from(node.childNodes), inner);
              if (inner.length) out.push({ t: 'link', href, pieces: inner });
              continue;
            }
          }
          walk(Array.from(node.childNodes), out);
        }
      }
    };
    const pieces = [];
    walk(nodes, pieces);
    if (w.lastText && w.lastText.text.endsWith(' ')) w.lastText.text = w.lastText.text.replace(/ +$/, '');
    // trailing <br> renders nothing in HTML
    let hadTrailingBreak = false;
    while (pieces.length && (pieces[pieces.length - 1].t === 'br' ||
      (pieces[pieces.length - 1].t === 'text' && !pieces[pieces.length - 1].text))) {
      if (pieces[pieces.length - 1].t === 'br') hadTrailingBreak = true;
      pieces.pop();
    }
    return { pieces, hadBreak: hadTrailingBreak };
  }

  function piecesToRuns(pieces, st, maxWidthPx) {
    const D = window.docx;
    const runs = [];
    for (const p of pieces) {
      if (p.t === 'text') { if (p.text) runs.push(makeTextRun(p.text, p.f)); }
      else if (p.t === 'br') runs.push(new D.TextRun({ break: 1 }));
      else if (p.t === 'math') { st.maths.push(p.xml); runs.push(new D.TextRun({ text: `[[WORDMATH:${st.maths.length}]]` })); }
      else if (p.t === 'img') { const r = imageRun(p.el, st, maxWidthPx); if (r) runs.push(r); }
      else if (p.t === 'link') {
        const kids = piecesToRuns(p.pieces, st, maxWidthPx);
        if (kids.length) runs.push(new D.ExternalHyperlink({ children: kids, link: p.href }));
      }
    }
    return runs;
  }

  // ---- media (images / svg / canvas / diagrams) -------------------------
  const FLAT_IMG_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' };

  function dataUrlToBytes(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function loadImage(src, cors) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    });
  }
  function canvasToMedia(canvas, mime) {
    const jpg = mime === 'image/jpeg';
    return { data: dataUrlToBytes(canvas.toDataURL(jpg ? 'image/jpeg' : 'image/png', 0.92)), type: jpg ? 'jpg' : 'png' };
  }

  async function rasterizeImgElement(img) {
    const src = img.currentSrc || img.src || '';
    const m = /^data:([^;,]+)/i.exec(src);
    const big = Math.max(img.naturalWidth || 0, img.naturalHeight || 0) > MAX_IMG_PX;
    if (m && FLAT_IMG_MIME[m[1].toLowerCase()] && /;base64,/i.test(src) && !big) {
      return { data: dataUrlToBytes(src), type: FLAT_IMG_MIME[m[1].toLowerCase()] };
    }
    // svg / webp / remote / blob / oversized images: redraw onto a canvas
    const el = await loadImage(src, !m);
    const scale = Math.min(1, MAX_IMG_PX / Math.max(el.naturalWidth || 1, el.naturalHeight || 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((el.naturalWidth || img.width || 300) * scale));
    c.height = Math.max(1, Math.round((el.naturalHeight || img.height || 150) * scale));
    const ctx = c.getContext('2d');
    const jpeg = !!m && /^image\/jpe?g$/i.test(m[1]);   // photos stay JPEG (smaller); others keep alpha
    if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(el, 0, 0, c.width, c.height);
    return canvasToMedia(c, jpeg ? 'image/jpeg' : 'image/png');
  }

  // Serialises an inline <svg> as a standalone file: computed paint/text
  // properties are inlined so class / CSS-variable based colours survive.
  function serializeSvg(svg, w, h, opts) {
    const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
      'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
      'text-anchor', 'dominant-baseline', 'letter-spacing'];
    const mono = isMono();
    const props = mono ? PROPS.concat(['stop-color', 'flood-color']) : PROPS;
    const PAINT = { 'fill': 1, 'stroke': 1, 'stop-color': 1, 'flood-color': 1 };
    // monochrome: every paint colour becomes a gray (gradients/urls/none are left alone)
    const grayPaint = (v) => {
      if (!v || /^\s*(none|transparent|currentcolor|url\(|inherit)/i.test(v)) return v;
      const hx = hexColor(v);
      return hx ? '#' + hx : v;
    };
    const clone = svg.cloneNode(true);
    const srcEls = [svg].concat(Array.from(svg.querySelectorAll('*')));
    const dstEls = [clone].concat(Array.from(clone.querySelectorAll('*')));
    srcEls.forEach((el, i) => {
      const d = dstEls[i]; if (!d) return;
      const cs = getComputedStyle(el);
      const inline = props.map(p => `${p}:${mono && PAINT[p] ? grayPaint(cs.getPropertyValue(p)) : cs.getPropertyValue(p)}`).join(';');
      let prev = d.getAttribute('style') || '';
      if (mono) {
        // the original colours (presentation attributes + inline style) must not stay in the file either
        Object.keys(PAINT).forEach(a => { if (d.hasAttribute(a)) d.setAttribute(a, grayPaint(d.getAttribute(a))); });
        prev = prev.replace(/(fill|stroke|stop-color|flood-color)\s*:\s*([^;]+)/gi, (m0, k, v) => `${k}:${grayPaint(v.trim())}`);
      }
      d.setAttribute('style', (prev ? prev + ';' : '') + inline);
    });
    if (opts && opts.stripText) clone.querySelectorAll('text').forEach(t => t.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    if (!clone.getAttribute('viewBox')) {
      const bw = px(svg.getAttribute('width')) || w, bh = px(svg.getAttribute('height')) || h;
      clone.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
    }
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    return new XMLSerializer().serializeToString(clone);
  }

  async function drawSvgToPng(xml, w, h) {
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml), false);
    // ~4x the on-page size (capped) so the PNG stays sharp when zoomed in Word
    const scale = Math.max(1, Math.min(4, 4096 / w, 4096 / h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return canvasToMedia(c);
  }

  // Charts / diagrams are embedded as real vector SVG (perfectly sharp at any
  // zoom in Word 2016+/365) with a high-resolution PNG fallback for older viewers.
  async function rasterizeSvgElement(svg, rect, opts) {
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    try {
      const xml = serializeSvg(svg, w, h, opts);
      const png = await drawSvgToPng(xml, w, h);
      return { type: 'svg', data: new TextEncoder().encode(xml), fallback: png.data };
    } catch (e) { console.warn('[WordExport] vector SVG embed failed, trying slide rasterizer:', e); }
    if (typeof window.rasterizeSvgPreservingAspect === 'function') {
      const r = await window.rasterizeSvgPreservingAspect(svg.outerHTML, 3200);
      if (r && r.dataUrl) return { data: dataUrlToBytes(r.dataUrl), type: 'png' };
    }
    return null;
  }

  async function ensureHtml2Canvas() {
    if (typeof window.html2canvas === 'function') return true;
    if (typeof ensurePDFRenderLibraries === 'function') {
      try { const libs = await ensurePDFRenderLibraries(); return !!(libs && libs.htmlOK && typeof window.html2canvas === 'function'); } catch (_) { return false; }
    }
    return false;
  }

  async function rasterizeWithHtml2Canvas(el, scale) {
    if (!(await ensureHtml2Canvas())) return null;
    const canvas = await window.html2canvas(el, { backgroundColor: null, scale: scale || 3 });
    return canvasToMedia(canvas);
  }

  // KaTeX equation -> transparent PNG, sized like the on-page equation.
  async function rasterizeMathNode(eq) {
    if (!(await ensureHtml2Canvas())) return null;
    const pcs = getComputedStyle(eq.parentElement || eq);
    const holderStage = document.createElement('div');
    holderStage.style.cssText = 'position:fixed; left:-10000px; top:0;';
    const holder = document.createElement('div');
    // No width cap on the holder: a wide matrix/aligned block must lay out at
    // its natural width before being measured, or it gets clipped and any
    // later fit-to-page scaling shrinks the (already-cropped) result further,
    // which is a second source of the "blurry/broken" look on complex equations.
    holder.style.cssText = `display:inline-block; padding:2px 4px; font-size:${pcs.fontSize}; color:${pcs.color}; line-height:normal; white-space:nowrap;`;
    holder.appendChild(eq.cloneNode(true));
    holderStage.appendChild(holder);
    document.body.appendChild(holderStage);
    try {
      // Wait for KaTeX's web fonts to actually be loaded, and let one frame
      // pass so layout has settled, before snapshotting — otherwise complex
      // equations (fractions, radicals, matrices) can be captured mid-layout
      // or with fallback glyph metrics, which reads as "blurry"/misaligned.
      if (document.fonts && document.fonts.ready) {
        await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]);
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const canvas = await window.html2canvas(holder, {
        backgroundColor: null,
        scale: 6,
        letterRendering: true
      });
      // A holder that failed to lay out (0 width/height) must not become an
      // embedded picture: w/h=0 propagates through imageRun()'s size math as
      // NaN, which docx.js writes straight into the picture's <wp:extent> —
      // invalid OOXML that makes the *entire* .docx fail to open in Word,
      // with no JS exception anywhere to catch it. Skip this one equation
      // instead (it falls back to plain text) so the rest of the document —
      // and the file itself — stays intact.
      if (!holder.offsetWidth || !holder.offsetHeight) return null;
      return Object.assign(canvasToMedia(canvas), { w: holder.offsetWidth, h: holder.offsetHeight });
    } finally { holderStage.remove(); }
  }

  // AI-generated flowcharts/mind-maps (app.js's conceptMapRules) are one
  // <svg class="fc-svg"> with .fc-node-rect boxes, .fc-node-text labels and
  // .fc-line connectors. Pair every label to the box it visually sits inside
  // (by position, not DOM order — robust to however the boxes/texts happen
  // to be interleaved) so each box can become a real, editable Word shape
  // instead of being permanently baked into a flattened picture.
  function extractFlowchartBoxes(svgEl) {
    const rects = Array.from(svgEl.querySelectorAll('.fc-node-rect'));
    if (!rects.length) return null;
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const boxes = rects.map(r => {
      const x = num(r.getAttribute('x')), y = num(r.getAttribute('y'));
      const w = num(r.getAttribute('width')), h = num(r.getAttribute('height'));
      const cs = getComputedStyle(r);
      return { el: r, x, y, w, h, fill: cs.fill, stroke: cs.stroke, texts: [] };
    }).filter(b => b.w > 0.5 && b.h > 0.5);
    if (!boxes.length) return null;
    Array.from(svgEl.querySelectorAll('.fc-node-text')).forEach(t => {
      const tx = num(t.getAttribute('x')), ty = num(t.getAttribute('y'));
      let inside = null, insideD = Infinity, nearest = null, nearestD = Infinity;
      boxes.forEach(b => {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const d = (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy);
        if (tx >= b.x - 1 && tx <= b.x + b.w + 1 && ty >= b.y - 1 && ty <= b.y + b.h + 1 && d < insideD) { insideD = d; inside = b; }
        if (d < nearestD) { nearestD = d; nearest = b; }
      });
      const target = inside || nearest;
      if (target) {
        const content = (t.textContent || '').replace(/\s+/g, ' ').trim();
        if (content) target.texts.push({ y: ty, content, color: getComputedStyle(t).fill, fontSize: parseFloat(getComputedStyle(t).fontSize) || 13 });
      }
    });
    return boxes.map(b => {
      b.texts.sort((p, q) => p.y - q.y);
      return {
        x: b.x, y: b.y, w: b.w, h: b.h,
        fill: b.fill, strokeColor: b.stroke,
        // Each box's title + subtitle (if the AI drew both, as separate
        // .fc-node-text elements) keep their own line, color and size
        // instead of being merged into one run-together line.
        lines: b.texts.map(t => ({ text: t.content, color: t.color, fontSize: t.fontSize }))
      };
    }).filter(b => b.lines.length);
  }

  // Measure + rasterize everything visual up-front so the converter below can
  // stay synchronous. Results are keyed by element (the DOM is not mutated).
  // runs fn over items with at most `limit` in flight
  async function mapLimit(items, limit, fn) {
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i]); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }

  // ---- monochrome: grayscale every raster picture (photos, svg->png, charts, math) ----
  function grayCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
  }
  async function grayBytes(bytes, type) {
    const jpg = type === 'jpg' || type === 'jpeg';
    const mime = jpg ? 'image/jpeg' : type === 'gif' ? 'image/gif' : type === 'bmp' ? 'image/bmp' : 'image/png';
    const blob = new Blob([bytes], { type: mime });
    let src;
    if (typeof createImageBitmap === 'function') { try { src = await createImageBitmap(blob); } catch (_) { src = null; } }
    if (!src) {
      const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      src = await loadImage(url, false);
    }
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
    const ctx = c.getContext('2d');
    if (jpg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(src, 0, 0);
    grayCanvas(c);
    return canvasToMedia(c, jpg ? 'image/jpeg' : 'image/png');
  }
  async function grayMedia(list) {
    for (const m of list) {
      try {
        if (m.data && m.type !== 'svg') { const g = await grayBytes(m.data, m.type); m.data = g.data; m.type = g.type; }
        if (m.fallback) m.fallback = (await grayBytes(m.fallback, 'png')).data;
      } catch (e) { console.warn('[WordExport] could not convert a picture to grayscale:', e); }
    }
  }

  async function prepareMedia(stage, media) {
    // media is a WeakMap (not iterable): remember what gets stored so it can be post-processed
    const made = [];
    const origSet = media.set.bind(media);
    media.set = (k, v) => { made.push(v); return origSet(k, v); };
    const nodes = Array.from(stage.querySelectorAll('.katex-eq, img, svg, canvas, .fc-wrapper'))
      .filter(n => !(n.parentElement && n.parentElement.closest('svg')))
      .filter(n => n.classList.contains('katex-eq') || !n.parentElement || !n.parentElement.closest('.katex-eq, .katex'));
    let uneditable = 0;
    let doneCount = 0;
    const step = Math.max(1, Math.ceil(nodes.length / 4));
    await mapLimit(nodes, 3, async (n) => {
      try {
        if (!n.isConnected || isHidden(n)) return;
        if (n.closest('.katex-mathml, .katex-html')) return;
        const tag = tagOf(n);
        if (n.classList.contains('katex-eq')) {
          if (mathOmml(n)) return;   // native Word equation, no picture needed
          const mm = await rasterizeMathNode(n);
          if (mm) media.set(n, mm);
          return;
        }
        if (n.classList.contains('fc-wrapper')) {
          // Diagrams (mindmaps / flowcharts) rely on absolute/relative CSS
          // positioning docx has no equivalent for, so the box is always
          // snapshotted whole, at high resolution, so it survives intact.
          // A real <table> is the one case left to structural conversion,
          // since a data table should stay a real, editable Word table
          // rather than becoming a flattened picture.
          if (n.querySelector('table') && !n.querySelector('svg')) return;
          if (!(n.textContent || '').trim() && !n.querySelector('svg, img, canvas')) return;
          let rect = n.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return;

          const fcSvg = n.querySelector('svg.fc-svg, svg');
          const boxes = fcSvg ? extractFlowchartBoxes(fcSvg) : null;
          let vb = null;
          if (boxes) {
            const vbAttr = (fcSvg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
            if (vbAttr.length === 4 && vbAttr[2] > 0 && vbAttr[3] > 0) vb = { w: vbAttr[2], h: vbAttr[3] };
          }

          // Hide just the box rects + labels for the background capture, so
          // the raster layer keeps only connector lines/arrowheads — the
          // boxes themselves are about to be laid on top as real Word shapes,
          // and capturing them into the picture too would leave a duplicate
          // "ghost" box behind whenever the native one is edited or moved.
          const hidden = boxes ? Array.from(fcSvg.querySelectorAll('.fc-node-rect, .fc-node-text')) : [];
          hidden.forEach(el => { el.style.visibility = 'hidden'; });

          // Same generous own-size-derived sizing as chart/template SVGs, not
          // the on-page rect, which a narrow/mobile editor can shrink.
          if (vb) {
            const targetW = Math.max(rect.width, 640);
            rect = { width: targetW, height: targetW * (vb.h / vb.w) };
          }
          const targetW = Math.max(rect.width, 640);
          const snapScale = Math.min(4, Math.max(3, targetW / Math.max(1, rect.width)));
          const m = await rasterizeWithHtml2Canvas(n, snapScale);

          hidden.forEach(el => { el.style.visibility = ''; });

          if (m) {
            Object.assign(m, { w: rect.width, h: rect.height });
            if (boxes && boxes.length && vb) { m.diagramLabels = boxes; m.diagramViewBox = vb; }
            media.set(n, m);
          }
          return;
        }
        if (tag === 'img' && n.decode) { try { await n.decode(); } catch (_) { /* keep going */ } }
        const rect = n.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        let m = null;
        let mediaRect = rect;
        if (tag === 'img') m = await rasterizeImgElement(n);
        else if (tag === 'svg') {
          const chartData = window.JSZip ? readChartData(n) : null;
          let diagramLabels = null, diagramViewBox = null;
          const labelsRaw = n.getAttribute('data-diagram-labels');
          if (labelsRaw) {
            try {
              const arr = JSON.parse(labelsRaw);
              if (Array.isArray(arr) && arr.length) diagramLabels = arr;
            } catch (_) { /* malformed stamp: safe no-op, falls back to plain picture */ }
          }
          // plain SVG text (no stamps): rebuild each label as an editable Word text box
          const textLabels = !chartData && !diagramLabels && n.querySelector('text') ? textLabelsFromSvg(n) : [];
          if (textLabels.length) diagramLabels = textLabels;
          const stripText = textLabels.length > 0;
          if (chartData || diagramLabels) {
            // Chart / template-diagram SVGs carry an exact viewBox — derive the
            // embed frame from that at a fixed, generous size instead of
            // trusting the on-page rect, which can be shrunk by a narrow
            // editor viewport and would otherwise force Word to cram the
            // whole chart (title + axes + data labels), or every diagram
            // label, into a tiny frame.
            const vb = (n.getAttribute('viewBox') || '').split(/\s+/).map(Number);
            if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
              const targetW = Math.max(rect.width || 0, 560);
              mediaRect = { width: targetW, height: targetW * (vb[3] / vb[2]) };
              diagramViewBox = { w: vb[2], h: vb[3] };
            }
          }
          m = await rasterizeSvgElement(n, mediaRect, { stripText });   // vector/PNG version = fallback if native chart/diagram fails
          if (m && chartData) m.chart = chartData;
          if (m && diagramLabels) { m.diagramLabels = diagramLabels; m.diagramViewBox = diagramViewBox || { w: mediaRect.width, h: mediaRect.height }; }
          if (m && !chartData && !diagramLabels && n.querySelector('text')) uneditable++;
        }
        else if (tag === 'canvas') {
          m = canvasToMedia(n);
          const cd = readCanvasChart(n);
          if (cd) m.chart = cd; else uneditable++;
        }
        if (m) media.set(n, Object.assign(m, { w: mediaRect.width, h: mediaRect.height, alt: altTextOf(n) }));
      } catch (e) {
        console.warn('[WordExport] skipping visual that could not be embedded:', e);
      } finally {
        if (++doneCount % step === 0) toast(`⏳ Preparing visuals ${Math.round(100 * doneCount / nodes.length)}%`);
      }
    });
    if (isMono()) await grayMedia(made);
    return uneditable;
  }

  function imageRun(el, st, maxWidthPx) {
    const D = window.docx;
    const m = st.media.get(el);
    if (!m) return null;
    let w = m.w, h = m.h;
    const maxH = Math.max(100, st.layout.height - st.layout.top - st.layout.bottom - 20);
    const s = Math.min(1, (maxWidthPx || 1e9) / w, maxH / h);
    w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    // A chart/diagram <wp:extent> must be a finite, positive integer — a
    // NaN or 0 (from a not-yet-laid-out or hidden source element) produces
    // XML that Word's schema validator rejects outright ("Word experienced
    // an error trying to open the file"), with no JS exception to catch it.
    // Guard here so those cases fall back to the safe plain-picture path.
    const hasValidExtent = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
    if (m.chart && st.nativeCharts && hasValidExtent) {
      st.charts.push({ chart: m.chart, w, h });
      return new D.TextRun({ text: `[[WORDCHART:${st.charts.length}]]` });
    }
    if (m.diagramLabels && st.nativeDiagrams && hasValidExtent) {
      // Background art is embedded as a plain PNG (the complex curved anatomy
      // isn't worth reproducing as native shapes) with real, editable Word
      // text boxes layered on top for every label — see injectNativeDiagrams.
      const png = m.type === 'svg' ? m.fallback : m.data;
      const vb = m.diagramViewBox || { w, h };
      if (png && Number.isFinite(vb.w) && Number.isFinite(vb.h) && vb.w > 0 && vb.h > 0) {
        st.diagrams.push({ png, w, h, labels: m.diagramLabels, vb, alt: m.alt });
        return new D.TextRun({ text: `[[WORDDIAGRAM:${st.diagrams.length}]]` });
      }
    }
    const transformation = { width: w, height: h };
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
      console.warn('[WordExport] skipping a visual with an invalid computed size:', m);
      return null;
    }
    const altText = { name: 'Image', title: (m.alt || 'Image').slice(0, 80), description: m.alt || 'Image' };
    if (m.type === 'svg') return new D.ImageRun({ type: 'svg', data: m.data, fallback: { type: 'png', data: m.fallback }, transformation, altText });
    return new D.ImageRun({ type: m.type, data: m.data, transformation, altText });
  }

  // ---- native (editable) Word charts ----------------------------------
  // chart-library.js stamps each chart <svg> with its source data
  // (data-chart-type / data-chart). docx.js cannot create charts, so:
  //   1. a marker run "[[WORDCHART:n]]" is placed where the chart belongs,
  //   2. after Packer builds the .docx we open the zip (JSZip) and add, per chart,
  //      word/charts/chartN.xml + an embedded Excel workbook (so "Edit Data"
  //      works) + relationships + content types,
  //   3. each marker run is replaced by an inline <w:drawing> pointing at the chart.
  // Any failure falls back to the sharp vector-SVG picture, never a broken file.
  const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const xesc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const DEFAULT_CHART_COLORS_RAW = ['4F7DF3', '22C55E', 'F59E0B', 'EF4444', 'A855F7', '06B6D4', 'EC4899', '84CC16', '6366F1', 'F97316'];
  const MONO_CHART_COLORS = ['000000', '555555', '999999', 'CCCCCC', '333333', '777777', 'BBBBBB', 'DDDDDD', '444444', '888888'];
  const DEFAULT_CHART_COLORS = new Proxy([], { get: (_, k) => (isMono() ? MONO_CHART_COLORS : DEFAULT_CHART_COLORS_RAW)[k] });

  // Chart.js canvases: read the live chart instance so the picture can also be
  // rebuilt as a native, editable Word chart (single-series bar/line/pie/donut).
  function readCanvasChart(canvas) {
    try {
      const inst = window.Chart && typeof window.Chart.getChart === 'function' ? window.Chart.getChart(canvas) : null;
      if (!inst || !inst.data || !inst.data.datasets || !inst.data.datasets.length) return null;
      const t = inst.config && inst.config.type;
      const type = t === 'doughnut' ? 'donut' : t;
      if (!['bar', 'line', 'pie', 'donut'].includes(type)) return null;
      const ds = inst.data.datasets[0];
      const values = (ds.data || []).map(v => (v !== null && typeof v === 'object' ? +v.y : +v) || 0);
      if (!values.length) return null;
      const labels = values.map((_, i) => (inst.data.labels && inst.data.labels[i] != null ? String(inst.data.labels[i]) : 'Item ' + (i + 1)));
      const bg = ds.backgroundColor;
      const src = Array.isArray(bg) ? bg : null;
      const base = type === 'line' ? (ds.borderColor || bg) : bg;
      const colors = values.map((_, i) => hexColor(src ? src[i % src.length] : base) || DEFAULT_CHART_COLORS[i % DEFAULT_CHART_COLORS.length]);
      const tt = inst.options && inst.options.plugins && inst.options.plugins.title;
      const title = tt && tt.display && tt.text ? String(Array.isArray(tt.text) ? tt.text.join(' ') : tt.text) : '';
      return { type, title, unit: '', labels, values, colors, min: null, max: null };
    } catch (_) { return null; }
  }

  // Alt text for an image: alt / aria-label / SVG <title> / figure caption
  function altTextOf(el) {
    const fig = el.closest && el.closest('figure');
    const cap = fig && fig.querySelector('figcaption');
    const title = el.querySelector && el.querySelector('title');
    return (el.getAttribute('alt') || el.getAttribute('aria-label') || (title && title.textContent) || (cap && cap.textContent) || '')
      .replace(/\s+/g, ' ').trim();
  }

  // Plain SVG text (no chart/diagram stamp): one transparent label box per <text>,
  // so the words stay editable in Word while the shapes stay in the picture.
  function textLabelsFromSvg(svg) {
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const out = [];
    svg.querySelectorAll('text').forEach(t => {
      const content = (t.textContent || '').replace(/\s+/g, ' ').trim();
      if (!content) return;
      const cs = getComputedStyle(t);
      const fs = parseFloat(cs.fontSize) || 13;
      const anchor = cs.textAnchor || t.getAttribute('text-anchor') || 'start';
      const w = Math.max(fs, content.length * fs * 0.6);
      const x0 = num(t.getAttribute('x')), y0 = num(t.getAttribute('y'));
      const left = anchor === 'middle' ? x0 - w / 2 : anchor === 'end' ? x0 - w : x0;
      out.push({ x: left, y: y0 - fs, w, h: fs * 1.3, plain: true, lines: [{ text: content, color: cs.fill, fontSize: fs }] });
    });
    return out;
  }

  function readChartData(svg) {
    if (!svg.hasAttribute('data-chart') || !svg.hasAttribute('data-chart-type')) return null;
    try {
      const type = svg.getAttribute('data-chart-type');
      const d = JSON.parse(svg.getAttribute('data-chart'));
      if (!['bar', 'line', 'pie', 'donut'].includes(type)) return null;
      if (!Array.isArray(d.values) || !d.values.length || !Array.isArray(d.labels)) return null;
      const values = d.values.map(v => (Number.isFinite(+v) ? +v : 0));
      const labels = values.map((_, i) => String(d.labels[i] != null ? d.labels[i] : 'Item ' + (i + 1)));
      const colors = values.map((_, i) => hexColor(d.colors && d.colors[i]) || DEFAULT_CHART_COLORS[i % DEFAULT_CHART_COLORS.length]);
      return { type, title: String(d.title || ''), unit: String(d.unit || '').replace(/"/g, ''), labels, values, colors,
        min: Number.isFinite(d.min) ? d.min : null, max: Number.isFinite(d.max) ? d.max : null };
    } catch (_) { return null; }
  }

  function chartXml(ch) {
    const bengali = BENGALI_RE.test(ch.title || '') || ch.labels.some(l => BENGALI_RE.test(l));
    const latin = 'Times New Roman';
    const n = ch.values.length;
    const isPie = ch.type === 'pie' || ch.type === 'donut';
    const valFmt = ch.unit ? `General&quot;${xesc(ch.unit)}&quot;` : 'General'; // already XML-escaped for use inside attributes
    const serName = ch.title || (isPie ? 'Values' : 'Series 1');
    const fill = (c) => `<a:solidFill><a:srgbClr val="${monoHex(c)}"/></a:solidFill>`;
    const txPr = (sz, color, bold) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}">${fill(color)}<a:latin typeface="${latin}"/><a:cs typeface="Kalpurush"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
    const strCache = (arr) => `<c:strCache><c:ptCount val="${arr.length}"/>${arr.map((v, i) => `<c:pt idx="${i}"><c:v>${xesc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
    const numCache = (arr) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${arr.length}"/>${arr.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
    const tx = `<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f>${strCache([serName])}</c:strRef></c:tx>`;
    const cat = `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f>${strCache(ch.labels)}</c:strRef></c:cat>`;
    const val = `<c:val><c:numRef><c:f>Sheet1!$B$2:$B$${n + 1}</c:f>${numCache(ch.values)}</c:numRef></c:val>`;
    // A light, semi-opaque backing behind every label + always-dark text: label
    // legibility must not depend on matching whatever color the bar/slice/point
    // underneath happens to be, since that color is exactly what a person is
    // likely to change after the chart lands in Word.
    const lumOf = (hex) => { const v = parseInt(hex, 16); return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; };
    // pie/donut: label text is dark on light slices, white on dark slices
    const sliceLbls = (pos) => ch.colors.map((c, i) => `<c:dLbl><c:idx val="${i}"/><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(1000, lumOf(c) < 0.55 ? 'FFFFFF' : '1F2937', true)}${pos ? `<c:dLblPos val="${pos}"/>` : ''}<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbl>`).join('');
    const dLbls = (pos, pct) => `<c:dLbls>${pct ? sliceLbls(pos) : ''}<c:numFmt formatCode="${pct ? '0.0%' : valFmt}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(1000, '1F2937', true)}${pos ? `<c:dLblPos val="${pos}"/>` : ''}<c:showLegendKey val="0"/><c:showVal val="${pct ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${pct ? 1 : 0}"/><c:showBubbleSize val="0"/>${pct ? '<c:showLeaderLines val="0"/>' : ''}</c:dLbls>`;

    const dPts = ch.colors.map((c, i) => ch.type === 'bar'
      ? `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${fill(c)}</c:spPr></c:dPt>`
      : `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${fill(c)}<a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`).join('');

    const scaling = (min, max) => `<c:scaling><c:orientation val="minMax"/>${max != null ? `<c:max val="${max}"/>` : ''}${min != null ? `<c:min val="${min}"/>` : ''}</c:scaling>`;
    const axes = isPie ? '' :
      `<c:catAx><c:axId val="111111"/>${scaling()}<c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="15875"><a:solidFill><a:srgbClr val="${monoHex('9CA3AF')}"/></a:solidFill></a:ln></c:spPr>${txPr(1000, '374151', false)}<c:crossAx val="222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      `<c:valAx><c:axId val="222222"/>${scaling(ch.min, ch.max)}<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="${monoHex('E2E6EE')}"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${valFmt}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="15875"><a:solidFill><a:srgbClr val="${monoHex('9CA3AF')}"/></a:solidFill></a:ln></c:spPr>${txPr(1000, '6B7280', false)}<c:crossAx val="111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>${ch.min != null && ch.max != null && ch.max > ch.min ? `<c:majorUnit val="${(ch.max - ch.min) / 4}"/>` : ''}</c:valAx>`;

    let plot;
    if (ch.type === 'bar') {
      plot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx}<c:spPr>${fill(ch.colors[0])}</c:spPr><c:invertIfNegative val="0"/>${dPts}${dLbls('outEnd', false)}${cat}${val}</c:ser><c:gapWidth val="60"/><c:axId val="111111"/><c:axId val="222222"/></c:barChart>`;
    } else if (ch.type === 'line') {
      const c0 = ch.colors[0];
      plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx}<c:spPr><a:ln w="33020" cap="rnd">${fill(c0)}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="8"/><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="31750">${fill(c0)}</a:ln></c:spPr></c:marker>${dLbls('t', false)}${cat}${val}<c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="111111"/><c:axId val="222222"/></c:lineChart>`;
    } else if (ch.type === 'pie') {
      plot = `<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx}${dPts}${dLbls('ctr', true)}${cat}${val}</c:ser><c:firstSliceAng val="0"/></c:pieChart>`;
    } else {
      plot = `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx}${dPts}${dLbls(null, true)}${cat}${val}</c:ser><c:firstSliceAng val="0"/><c:holeSize val="57"/></c:doughnutChart>`;
    }

    const title = ch.title
      ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1600" b="1">${fill('111827')}<a:latin typeface="${latin}"/><a:cs typeface="Kalpurush"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1600" b="1">${fill('111827')}<a:latin typeface="${latin}"/><a:cs typeface="Kalpurush"/></a:rPr><a:t>${xesc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
      : '';
    const legend = isPie ? `<c:legend><c:legendPos val="r"/><c:overlay val="0"/>${txPr(1100, '1F2937', false)}</c:legend>` : '';

    return `${XML_HEAD}<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>${title}<c:autoTitleDeleted val="${ch.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(1000, '374151', false)}<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
  }

  // minimal .xlsx behind "Edit Data": A1 blank, B1 series name, A2.. labels, B2.. values
  async function chartWorkbook(ch) {
    const Z = new window.JSZip();
    const serName = ch.title || (ch.type === 'pie' || ch.type === 'donut' ? 'Values' : 'Series 1');
    const cell = (ref, v) => typeof v === 'number'
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    const rows = [`<row r="1">${cell('B1', serName)}</row>`].concat(ch.labels.map((l, i) => `<row r="${i + 2}">${cell('A' + (i + 2), l)}${cell('B' + (i + 2), ch.values[i])}</row>`));
    Z.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    Z.file('_rels/.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    Z.file('xl/workbook.xml', `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    Z.file('xl/_rels/workbook.xml.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
    Z.file('xl/worksheets/sheet1.xml', `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData></worksheet>`);
    return Z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  // Replaces every "[[NAME:n]]" marker run with map[n] (single pass).
  function replaceMarkers(doc, name, map) {
    const re = new RegExp(`<w:r>(?:(?!</w:r>)[\\s\\S])*?\\[\\[${name}:(\\d+)\\]\\](?:(?!</w:r>)[\\s\\S])*?</w:r>`, 'g');
    return doc.replace(re, (whole, idx) => (map[idx] != null ? map[idx] : whole));
  }

  // Adds native charts to a shared package context {zip, doc, rels, types}.
  async function applyNativeCharts(ctx, charts) {
    const drawings = {};
    for (let i = 1; i <= charts.length; i++) {
      const { chart, w, h } = charts[i - 1];
      ctx.zip.file(`word/charts/chart${i}.xml`, chartXml(chart));
      ctx.zip.file(`word/charts/_rels/chart${i}.xml.rels`, `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/package" Target="../embeddings/Microsoft_Excel_Sheet${i}.xlsx"/></Relationships>`);
      ctx.zip.file(`word/embeddings/Microsoft_Excel_Sheet${i}.xlsx`, await chartWorkbook(chart));
      ctx.rels = ctx.rels.replace('</Relationships>', `<Relationship Id="rIdWordChart${i}" Type="${NS_R}/chart" Target="charts/chart${i}.xml"/></Relationships>`);
      ctx.types = ctx.types.replace('</Types>', `<Override PartName="/word/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
      drawings[i] = `<w:r><w:drawing><wp:inline xmlns:wp="${NS_WP}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(w * 9525)}" cy="${Math.round(h * 9525)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${9000 + i}" name="Chart ${i}" descr="${xesc(chart.title || 'Chart')}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rIdWordChart${i}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }
    ctx.doc = replaceMarkers(ctx.doc, 'WORDCHART', drawings);
    if (!/Extension="xlsx"/i.test(ctx.types)) {
      ctx.types = ctx.types.replace('<Override', '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Override');
    }
  }

  // ---- native (editable-label) template diagrams ------------------------
  // diagram-library.js stamps a template SVG (e.g. the heart) with the exact
  // geometry/text/colors of every label box it drew (data-diagram-labels).
  // The curved anatomy itself stays a plain picture (not worth reproducing
  // as native shapes), but each label becomes a real Word text box grouped
  // on top of it at the same spot — so a person can retype, recolor, move
  // or resize any label's text directly in Word, and the label can never go
  // invisible the way a label baked into the picture's pixels could.
  // Same "marker run now, raw XML after Packer, safe fallback on failure"
  // pattern as injectNativeCharts above.
  const NS_WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
  const NS_WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

  function diagramGroupXml(dg, imgRelId, dgIdx) {
    const cx = Math.round(dg.w * 9525), cy = Math.round(dg.h * 9525);
    const vbW = dg.vb.w || dg.w, vbH = dg.vb.h || dg.h;
    // Real point size for label text, derived from the box height's share of
    // the whole diagram's height at the diagram's actual embedded size —
    // child shapes are positioned in raw viewBox units (Word rescales the
    // whole group to fit cx/cy) but font size is always absolute, not scaled.
    const ptPerVbUnit = (dg.h * 0.75) / vbH;

    const fontN = (BASE && BASE.font) || 'Times New Roman';
    const fontCs = (BASE && BASE.csFont) || 'Kalpurush';
    const pic = `<pic:pic xmlns:pic="${NS_PIC}"><pic:nvPicPr><pic:cNvPr id="${7000 + dgIdx}" name="diagram-art"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${imgRelId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${vbW}" cy="${vbH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`;

    const boxes = (dg.labels || []).map((l, idx) => {
      const x = Math.round(Number(l.x) || 0), y = Math.round(Number(l.y) || 0);
      const w = Math.max(1, Math.round(Number(l.w) || 1)), h = Math.max(1, Math.round(Number(l.h) || 1));
      const stroke = hexColor(l.strokeColor) || monoHex('9CA3AF');
      const fill = hexColor(l.fill) || 'FFFFFF';
      // Multi-line boxes (a title + a lighter subtitle, drawn as separate
      // .fc-node-text elements) keep each line's own color/size; single-line
      // label data (e.g. the heart template's { text, textColor, fontSize })
      // is normalized into the same one-line-array shape.
      const lineData = Array.isArray(l.lines) && l.lines.length
        ? l.lines
        : [{ text: l.text, color: l.textColor, fontSize: l.fontSize }];
      const paras = lineData.filter(ln => ln && String(ln.text || '').trim()).map((ln, li) => {
        const textColor = hexColor(ln.color) || hexColor(l.textColor) || (isMono() ? '000000' : '1F2937');
        const szHalfPt = Math.max(12, Math.min(48, Math.round((Number(ln.fontSize) || Number(l.fontSize) || 14) * ptPerVbUnit * 2)));
        const bold = li === 0 ? 1 : 0; // first line (title) bold, any further line (subtitle) regular
        return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${fontN}" w:hAnsi="${fontN}" w:cs="${fontCs}"/>${bold ? '<w:b/>' : ''}<w:color w:val="${textColor}"/><w:sz w:val="${szHalfPt}"/></w:rPr><w:t xml:space="preserve">${xesc(String(ln.text))}</w:t></w:r></w:p>`;
      }).join('');
      const boxFill = l.plain ? '<a:noFill/>' : `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>`;
      const boxLine = l.plain ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="12700"><a:solidFill><a:srgbClr val="${stroke}"/></a:solidFill></a:ln>`;
      if (!paras) return '';
      return `<wps:wsp><wps:cNvPr id="${5000 + dgIdx * 200 + idx}" name="Label ${idx + 1}"/><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${boxFill}${boxLine}</wps:spPr><wps:txbx><w:txbxContent>${paras}</w:txbxContent></wps:txbx><wps:bodyPr wrap="square" lIns="27432" tIns="9144" rIns="27432" bIns="9144" anchor="ctr"><a:noAutofit/></wps:bodyPr></wps:wsp>`;
    }).join('');

    const group = `<wpg:wgp xmlns:wpg="${NS_WPG}" xmlns:wps="${NS_WPS}"><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${vbW}" cy="${vbH}"/></a:xfrm></wpg:grpSpPr>${pic}${boxes}</wpg:wgp>`;
    return `<w:r><w:drawing><wp:inline xmlns:wp="${NS_WP}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${9500 + dgIdx}" name="Diagram ${dgIdx}" descr="${xesc(dg.alt || 'Diagram')}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_WPG}">${group}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  // Adds template diagrams (picture + editable label boxes) to the package context.
  async function applyNativeDiagrams(ctx, diagrams) {
    const drawings = {};
    for (let i = 1; i <= diagrams.length; i++) {
      const dg = diagrams[i - 1];
      const relId = `rIdWordDiagram${i}`;
      ctx.zip.file(`word/media/diagram${i}.png`, dg.png);
      ctx.rels = ctx.rels.replace('</Relationships>', `<Relationship Id="${relId}" Type="${NS_R}/image" Target="media/diagram${i}.png"/></Relationships>`);
      drawings[i] = diagramGroupXml(dg, relId, i);
    }
    ctx.doc = replaceMarkers(ctx.doc, 'WORDDIAGRAM', drawings);
    if (!/Extension="png"/i.test(ctx.types)) {
      ctx.types = ctx.types.replace('<Override', '<Default Extension="png" ContentType="image/png"/><Override');
    }
  }

  // ---- block classification --------------------------------------------
  function isBlockNode(n) {
    if (!isEl(n)) return false;
    const cs = getComputedStyle(n);
    if (isHidden(n, cs)) return false;
    if (tagOf(n) === 'hr') return true;
    if (BLOCK_DISPLAY.has(cs.display)) return true;
    if (cs.display === 'inline' || cs.display === 'contents') {
      return !!n.querySelector(BLOCK_SELECTOR) && !n.classList.contains('katex') && !n.classList.contains('katex-eq');
    }
    return false;
  }

  // ---- borders / shading ------------------------------------------------
  function borderStyleName(css) {
    const D = window.docx;
    return ({ dashed: D.BorderStyle.DASHED, dotted: D.BorderStyle.DOTTED, double: D.BorderStyle.DOUBLE })[css] || D.BorderStyle.SINGLE;
  }
  function borderSpec(cs, side, spaceTw) {
    const w = px(cs['border' + side + 'Width']);
    const stl = cs['border' + side + 'Style'];
    if (!(w > 0) || stl === 'none' || stl === 'hidden') return null;
    return {
      style: borderStyleName(stl),
      size: Math.min(96, Math.max(2, Math.round(w * EIGHTH_PT))),
      color: hexColor(cs['border' + side + 'Color']) || '000000',
      space: Math.max(0, Math.min(31, Math.round((spaceTw || 0) / 20)))
    };
  }
  const NO_BORDER = () => ({ style: window.docx.BorderStyle.NONE, size: 0, color: 'auto' });

  // ---- paragraphs -------------------------------------------------------
  function alignmentOf(cs) {
    const A = window.docx.AlignmentType;
    const t = cs.textAlign || '';
    if (t.includes('center')) return A.CENTER;
    if (t === 'right' || t === 'end' || t.includes('right')) return A.RIGHT;
    if (t === 'justify') return A.JUSTIFIED;
    return A.LEFT;
  }

  // Build one paragraph "block" (later finalised into a docx Paragraph).
  //   styleEl : element whose computed style drives the paragraph
  //   nodes   : inline nodes that make up its content
  //   leaf    : true when styleEl itself is the paragraph (its margins apply)
  function makeParagraph(styleEl, nodes, ctx, st, leaf, plain) {
    const D = window.docx;
    const cs = getComputedStyle(styleEl);
    const { pieces, hadBreak } = collectPieces(nodes, st);
    if (!pieces.length && !hadBreak) return null;

    const onlyImage = pieces.length === 1 && pieces[0].t === 'img';
    let indentLeft = ctx.indentLeft, indentRight = ctx.indentRight;
    let before = 0, after = 0;
    let widthTw = ctx.width;

    // Decoration (background / side borders) is NOT written on the paragraph:
    // Word copies paragraph shading & borders into every new paragraph typed
    // after it. Decorated blocks are built as a 1-cell table by convertBox().
    if (leaf && !plain) {
      const pl = tw(cs.paddingLeft), pr = tw(cs.paddingRight);
      before = tw(cs.marginTop) + tw(cs.paddingTop);
      after = tw(cs.marginBottom) + tw(cs.paddingBottom);
      indentLeft += tw(cs.marginLeft) + pl;
      indentRight += tw(cs.marginRight) + pr;
      widthTw -= tw(cs.marginLeft) + pl + tw(cs.marginRight) + pr;
    }

    const opts = { children: piecesToRuns(pieces, st, Math.max(50, widthTw / TW)) };
    if (!opts.children.length && !hadBreak) return null;

    const tag = tagOf(styleEl);
    if (leaf && !plain && /^h[1-6]$/.test(tag)) {
      opts.heading = D.HeadingLevel['HEADING_' + tag[1]];
      opts.keepNext = true;
    }

    opts.alignment = alignmentOf(cs);
    if (onlyImage) {
      // block-level image centred with margin:auto -> keep it centred in Word
      const im = pieces[0].el.getBoundingClientRect();
      const host = styleEl.getBoundingClientRect();
      const slack = host.width - im.width;
      if (slack > 12 && Math.abs((im.left - host.left) - (host.right - im.right)) < 6) opts.alignment = D.AlignmentType.CENTER;
    }

    // numbering / list indentation
    const list = ctx.list;
    let numbering = null;
    if (list && !list.used && list.ref) { numbering = { reference: list.ref, level: list.level }; list.used = true; }
    else if (list && !list.used) list.used = true; // list-style:none -> plain indented paragraph
    if (numbering) {
      opts.numbering = numbering;
      opts.indent = { left: indentLeft, hanging: Math.min(360, indentLeft) };
      const f = pieces.find(p => p.t === 'text');
      if (f) opts.run = { size: f.f.size, color: f.f.color, font: f.f.font };
    } else if (indentLeft || indentRight) {
      opts.indent = { left: indentLeft, right: indentRight };
    }

    // line spacing (CSS line-height in px -> "at least" so tall inline images can grow the line)
    const lh = px(cs.lineHeight);
    const spacing = {};
    if (lh > 0 && cs.lineHeight !== 'normal') { spacing.line = Math.max(20, Math.round(lh * TW)); spacing.lineRule = D.LineRuleType.AT_LEAST; }
    opts.spacing = spacing;

    if (st.pageBreakPending) { opts.pageBreakBefore = true; st.pageBreakPending = false; }

    return { kind: 'p', opts, before, after };
  }

  function makeHr(el, ctx, st) {
    const D = window.docx;
    const cs = getComputedStyle(el);
    const w = Math.max(1, px(cs.borderTopWidth) || 1);
    return {
      kind: 'p', before: tw(cs.marginTop), after: tw(cs.marginBottom),
      opts: {
        children: [],
        indent: ctx.indentLeft || ctx.indentRight ? { left: ctx.indentLeft, right: ctx.indentRight } : undefined,
        border: { bottom: { style: D.BorderStyle.SINGLE, size: Math.min(96, Math.round(w * EIGHTH_PT)), color: hexColor(cs.borderTopColor) || monoHex('CBD5E1'), space: 1 } },
        spacing: { line: 20, lineRule: D.LineRuleType.EXACT }
      }
    };
  }

  // ---- containers -------------------------------------------------------
  function childCtx(el, ctx) {
    const cs = getComputedStyle(el);
    const c = Object.assign({}, ctx);
    const pl = tw(cs.paddingLeft), pr = tw(cs.paddingRight);
    c.indentLeft = ctx.indentLeft + tw(cs.marginLeft) + pl;
    c.indentRight = ctx.indentRight + tw(cs.marginRight) + pr;
    c.width = ctx.width - (tw(cs.marginLeft) + pl + tw(cs.marginRight) + pr);
    return { ctx: c, before: tw(cs.marginTop) + tw(cs.paddingTop), after: tw(cs.marginBottom) + tw(cs.paddingBottom) };
  }

  // ---- decorated blocks -------------------------------------------------
  function boxInfo(cs) {
    const own = {
      top: borderSpec(cs, 'Top', 0), right: borderSpec(cs, 'Right', 0),
      bottom: borderSpec(cs, 'Bottom', 0), left: borderSpec(cs, 'Left', 0)
    };
    // Monochrome: no shading and no left/right (side) borders on any block.
    if (isMono()) { own.left = null; own.right = null; }
    const bg = isMono() ? null : hexColor(cs.backgroundColor);
    return { bg, own, box: !!(bg || own.left || own.right) };
  }

  // A rule line (border-top / border-bottom) as its own thin paragraph, so the
  // heading/paragraph it belongs to stays completely clean to edit.
  function makeRule(spec, before, after, ctx) {
    const D = window.docx;
    const b = { style: spec.style, size: spec.size, color: spec.color, space: 1 };
    return {
      kind: 'p', before, after,
      opts: {
        children: [],
        indent: ctx.indentLeft || ctx.indentRight ? { left: ctx.indentLeft, right: ctx.indentRight } : undefined,
        border: { bottom: b },
        spacing: { line: 20, lineRule: D.LineRuleType.EXACT }
      }
    };
  }

  function applyRules(items, cs, info, ctx) {
    if (!items.length) return items;
    const mt = tw(cs.marginTop), mb = tw(cs.marginBottom);
    if (info.own.bottom) {
      const last = items[items.length - 1];
      last.after = Math.max(0, (last.after || 0) - mb);
      items.push(makeRule(info.own.bottom, 0, mb, ctx));
    }
    if (info.own.top) {
      const first = items[0];
      first.before = Math.max(0, (first.before || 0) - mt);
      items.unshift(makeRule(info.own.top, mt, 0, ctx));
    }
    return items;
  }

  // Background / left-right border blocks (callouts, quotes, code blocks) become
  // a single-cell table: colour lives in the cell, so pressing Enter in Word
  // never drags a background or border into the next paragraph.
  function convertBox(el, cs, info, ctx, st, out, custom) {
    const D = window.docx;
    const pl = tw(cs.paddingLeft), pr = tw(cs.paddingRight), pt = tw(cs.paddingTop), pb = tw(cs.paddingBottom);
    const ml = tw(cs.marginLeft), mr = tw(cs.marginRight);
    const outerW = Math.max(720, ctx.width - ml - mr);
    const cellCtx = { indentLeft: 0, indentRight: 0, list: null, listDepth: 0, width: Math.max(360, outerW - pl - pr) };

    let inner;
    if (typeof custom === 'function') inner = custom(cellCtx);
    else if (!Array.from(el.childNodes).some(isBlockNode)) {
      const p = makeParagraph(el, Array.from(el.childNodes), cellCtx, st, true, true);
      inner = p ? [p] : [];
    } else inner = convertChildren(el, cellCtx, st);
    if (!inner.length) return;

    const kids = finalizeBlocks(inner);
    if (kids[kids.length - 1] instanceof D.Table) kids.push(new D.Paragraph({ children: [] }));

    const borders = {};
    ['top', 'right', 'bottom', 'left'].forEach(k => {
      borders[k] = info.own[k] ? { style: info.own[k].style, size: info.own[k].size, color: info.own[k].color } : NO_BORDER();
    });
    const cellOpts = {
      children: kids,
      width: { size: outerW, type: D.WidthType.DXA },
      margins: { top: pt, bottom: pb, left: pl, right: pr },
      borders
    };
    if (info.bg) cellOpts.shading = { type: D.ShadingType.CLEAR, fill: info.bg, color: 'auto' };
    const none = NO_BORDER();
    const tblOpts = {
      rows: [new D.TableRow({ cantSplit: typeof custom === 'function', children: [new D.TableCell(cellOpts)] })],   // OMR sheet frame never splits across pages
      width: { size: outerW, type: D.WidthType.DXA },
      columnWidths: [outerW],
      layout: D.TableLayoutType.FIXED,
      borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
    };
    if (ctx.indentLeft + ml) tblOpts.indent = { size: ctx.indentLeft + ml, type: D.WidthType.DXA };
    out.push({ kind: 'table', table: new D.Table(tblOpts), before: tw(cs.marginTop), after: tw(cs.marginBottom), tight: typeof custom === 'function' });
  }

  // ---- OMR (Optical Mark Recognition) answer sheet ----------------------
  // exam-library.js renders OMR as flexbox (.exam-omr / .omr-grid), which Word's
  // flow layout cannot reproduce. Instead of guessing a fixed layout, every
  // sheet is rebuilt from the REAL rendered geometry (getBoundingClientRect +
  // getComputedStyle), so whatever OMR the editor shows — grid 2x2, compact,
  // classic (any number of columns / options), or an unknown hand-made layout —
  // comes out the same in Word, and everything stays editable:
  //   * title, Name/Roll/Class/Date fields, note, question numbers = real text
  //     (fields use tab stops with underscore leaders)
  //   * the sheet = real Word tables (column boxes, grey header, zebra rows,
  //     dotted row lines are cell borders / shading)
  //   * every bubble = a native Word ellipse whose letter is real, editable text
  const omrNone = () => ({ style: window.docx.BorderStyle.NONE, size: 0, color: 'auto' });
  const omrSum = (a) => a.reduce((x, y) => x + y, 0);
  function omrEdge(cs, side) {                    // computed border -> docx border (or null)
    const b = borderSpec(cs, side, 0);
    return b ? { style: b.style, size: b.size, color: b.color } : null;
  }
  // a block made only of bubble rows (every child holds bubbles / numbers): OMR without the known wrapper classes
  const isCircleRegion = (el) => !!(el && el.querySelector && el.querySelector('.circle') && !el.querySelector('.exam-omr, .omr-grid') &&
    Array.from(el.children).every(c => c.classList.contains('circle') || c.classList.contains('q-number') || c.querySelector('.circle')));
  const isOmrBlock = (el) => !!(el && el.classList && (el.classList.contains('exam-omr') ||
    el.classList.contains('omr-grid') || el.querySelector(':scope > .omr-grid')));

  function omrEmptyPara() {
    const D = window.docx;
    return new D.Paragraph({ children: [], spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT }, run: { size: 2 } });
  }
  function omrTextPara(el, st, widthPx) {
    const D = window.docx;
    const { pieces } = collectPieces([el], st);
    const children = piecesToRuns(pieces, st, widthPx || 200);
    if (!children.length) return omrEmptyPara();
    return new D.Paragraph({ alignment: alignmentOf(getComputedStyle(el)), spacing: { before: 0, after: 0 }, run: { size: runFormat(el).size }, children });
  }

  // One bubble: measured from the real .circle element, drawn later (finalizeDocx)
  function omrBubble(c, st, maxPx) {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return '';
    const cs = getComputedStyle(c);
    const k = maxPx && r.width > maxPx ? Math.max(0.3, maxPx / r.width) : 1;
    const rad = cs.borderTopLeftRadius || '0px';
    const round = /%$/.test(rad) ? parseFloat(rad) >= 40 : px(rad) >= Math.min(r.width, r.height) / 2 - 1;
    const weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400);
    const bw = px(cs.borderTopWidth);
    st.bubbles.push({
      letter: (c.textContent || '').replace(/\s+/g, ' ').trim(),
      w: Math.max(5, r.width * k), h: Math.max(5, r.height * k), round,
      fontPx: (px(cs.fontSize) || r.width * 0.5) * k,
      bold: weight >= 600,
      noBorder: !(bw > 0) || cs.borderTopStyle === 'none',
      border: Math.max(0.5, bw * k),
      borderColor: hexColor(cs.borderTopColor) || monoHex('000000'),
      fill: hexColor(cs.backgroundColor) || 'FFFFFF',
      color: hexColor(cs.color) || '000000'
    });
    return `[[WORDBUBBLE:${st.bubbles.length - 1}]]`;
  }
  function omrBubblePara(c, st, maxPx) {
    const D = window.docx;
    const m = c ? omrBubble(c, st, maxPx) : '';
    if (!m) return omrEmptyPara();
    return new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 0, after: 0 }, run: { size: 2 },
      children: [new D.TextRun({ text: m, size: 2 })] });
  }

  // Replaces a [[WORDBUBBLE:n]] run with a native inline Word shape. The letter
  // lives in the shape's text box, so it can be retyped / restyled in Word.
  function bubbleRunXml(b, id) {
    const wE = Math.round(b.w * 9525), hE = Math.round(b.h * 9525);
    // An ellipse's text area is its inscribed rectangle (~70%): keep font and line inside it
    const fontPx = Math.min(b.fontPx, b.h * 0.5);
    const sz = Math.max(8, Math.round(fontPx * HALF_PT));
    const lineTw = Math.max(20, Math.round(b.h * (b.round ? 0.68 : 0.9) * TW));
    const lnW = Math.max(3175, Math.round(b.border * 9525));
    const ln = b.noBorder ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${lnW}"><a:solidFill><a:srgbClr val="${b.borderColor}"/></a:solidFill></a:ln>`;
    const geom = b.round ? 'ellipse' : 'roundRect';
    const inner =
      `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0" w:line="${lineTw}" w:lineRule="exact"/></w:pPr>` +
      `<w:r><w:rPr><w:rFonts w:ascii="${LATIN_FONT}" w:hAnsi="${LATIN_FONT}" w:eastAsia="${LATIN_FONT}" w:cs="${BENGALI_FONT}"/>` +
      `${b.bold ? '<w:b/><w:bCs/>' : ''}<w:color w:val="${b.color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>` +
      `<w:t xml:space="preserve">${xesc(b.letter)}</w:t></w:r></w:p>`;
    return `<w:r><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:drawing><wp:inline xmlns:wp="${NS_WP}" distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${wE}" cy="${hE}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="${id}" name="OMR Bubble ${id}" descr="${xesc(b.letter)}"/>` +
      `<wp:cNvGraphicFramePr/>` +
      `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_WPS}">` +
      `<wps:wsp xmlns:wps="${NS_WPS}">` +
      `<wps:cNvSpPr txBox="1"/>` +
      `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wE}" cy="${hE}"/></a:xfrm>` +
      `<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>` +
      `<a:solidFill><a:srgbClr val="${b.fill}"/></a:solidFill>${ln}` +
      `</wps:spPr><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx>` +
      `<wps:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="1"><a:noAutofit/></wps:bodyPr>` +
      `</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  // ---- table helpers ----
  function omrCell(o) {
    const D = window.docx;
    const b = o.borders || {};
    const opts = {
      children: o.paras && o.paras.length ? o.paras : [omrEmptyPara()],
      width: { size: Math.max(1, Math.round(o.w)), type: D.WidthType.DXA },
      margins: Object.assign({ top: 0, bottom: 0, left: 0, right: 0 }, o.margins || {}),
      borders: { top: b.top || omrNone(), bottom: b.bottom || omrNone(), left: b.left || omrNone(), right: b.right || omrNone() },
      verticalAlign: D.VerticalAlign.CENTER
    };
    if (o.span > 1) opts.columnSpan = o.span;
    if (o.shade) opts.shading = { type: D.ShadingType.CLEAR, fill: o.shade, color: 'auto' };
    return new D.TableCell(opts);
  }
  function omrGapRow(totalW, nCols, hTw) {
    const D = window.docx;
    return new D.TableRow({ cantSplit: true, height: { value: Math.max(20, Math.round(hTw)), rule: 'exact' },
      children: [omrCell({ w: totalW, span: nCols })] });
  }
  function omrTable(colW, rows, ctx) {
    const D = window.docx;
    const total = omrSum(colW);
    const n = () => omrNone();
    const opts = {
      rows, width: { size: total, type: D.WidthType.DXA }, columnWidths: colW, layout: D.TableLayoutType.FIXED,
      borders: { top: n(), bottom: n(), left: n(), right: n(), insideHorizontal: n(), insideVertical: n() }
    };
    if (ctx.indentLeft) opts.indent = { size: ctx.indentLeft, type: D.WidthType.DXA };
    return new D.Table(opts);
  }
  const omrPush = (out, table) => out.push({ kind: 'table', table, before: 0, after: 0, tight: true });

  // circles -> visual rows (top to bottom), each row left to right
  function omrRowsOf(circles) {
    if (!circles.length) return [];
    const items = circles.map(c => ({ c, r: c.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
    const tol = Math.max(2, items[0].r.height * 0.4);
    const rows = [];
    items.forEach(it => {
      const row = rows.find(rw => Math.abs(rw.top - it.r.top) <= tol);
      if (row) row.items.push(it); else rows.push({ top: it.r.top, items: [it] });
    });
    return rows.sort((a, b) => a.top - b.top).map(rw => rw.items.sort((a, b) => a.r.left - b.r.left).map(i => i.c));
  }

  // ---- header line: title + "Name: ____  Roll: ____ ..." -> ONE paragraph,
  // fields are text + tab stops with underscore leaders (real editable text)
  function omrFieldOf(node) {
    const kids = Array.from(node.children);
    const line = kids.find(k => px(getComputedStyle(k).borderBottomWidth) > 0 && !(k.textContent || '').replace(/[\s\u00A0]/g, ''));
    return line ? { line, label: kids.filter(k => k !== line) } : null;
  }
  function omrHeaderItem(el, ctx, st) {
    const D = window.docx;
    const cs = getComputedStyle(el);
    if (!/flex/.test(cs.display)) return null;
    const kids = Array.from(el.children).filter(k => !isHidden(k));
    const parts = kids.map(k => ({ k, f: omrFieldOf(k) }));
    if (!parts.some(p => p.f)) return null;
    const base = el.getBoundingClientRect();
    const runs = [], stops = [];
    const wpx = Math.max(50, ctx.width / TW);
    const leader = (D.LeaderType && D.LeaderType.UNDERSCORE) || 'underscore';
    const left = (D.TabStopType && D.TabStopType.LEFT) || 'left';
    parts.forEach(({ k, f }) => {
      if (!f) {
        runs.push(...piecesToRuns(collectPieces([k], st).pieces, st, wpx));
        runs.push(new D.TextRun({ text: '  ' }));
        return;
      }
      runs.push(...piecesToRuns(collectPieces(f.label, st).pieces, st, wpx));
      const lr = f.line.getBoundingClientRect();
      const pos = Math.min(ctx.width - 30, Math.max(60, Math.round((lr.right - base.left) * TW)));
      if (!stops.length || pos > stops[stops.length - 1].position) stops.push({ type: left, position: pos, leader });
      runs.push(D.Tab ? new D.TextRun({ children: [new D.Tab()] }) : new D.TextRun({ text: '\t' }));
      runs.push(new D.TextRun({ text: ' ' }));
    });
    if (!runs.length) return null;
    return { kind: 'p', before: tw(cs.marginTop), after: tw(cs.marginBottom) + 20,
      opts: { children: runs, tabStops: stops, alignment: D.AlignmentType.LEFT, spacing: {} } };
  }

  // ---- grid 2x2 / compact: rows of .q-col boxes (number header + bubbles) ----
  // One table for ALL rows of boxes. Each box = `perRow` sub-columns (1 for the
  // stacked compact style, 2 for the 2x2 grid), thin gap columns between boxes.
  function convertOmrQCols(grids, ctx, st, out) {
    const D = window.docx;
    const geo = grids.reduce((a, g) => (!a || g.children.length > a.children.length) ? g : a, null);
    const kids = Array.from(geo.children);
    if (!kids.length) return false;
    const rects = kids.map(k => k.getBoundingClientRect());
    const totalPx = Math.max(1, rects[rects.length - 1].right - rects[0].left);
    const availTw = Math.max(720, ctx.width);
    const scale = Math.min(1, availTw / (totalPx * TW));
    const isQ = (q) => !!(q && q.classList && q.classList.contains('q-col'));

    const cache = new Map();
    const rowsOf = (q) => {
      if (!isQ(q)) return [];
      if (!cache.has(q)) cache.set(q, omrRowsOf(Array.from(q.querySelectorAll('.circle')).filter(c => !isHidden(c))));
      return cache.get(q);
    };
    let perRow = 1, nRows = 0;
    grids.forEach(g => Array.from(g.children).forEach(q => {
      const rs = rowsOf(q);
      nRows = Math.max(nRows, rs.length);
      rs.forEach(r => { perRow = Math.max(perRow, r.length); });
    }));
    if (!nRows) return false;

    const segs = [];     // {t:'q', i, w:[sub widths]} | {t:'gap', w:[w]}
    kids.forEach((k, i) => {
      const wTw = Math.max(perRow * 40, Math.round(rects[i].width * TW * scale));
      const sub = Math.floor(wTw / perRow);
      segs.push({ t: 'q', i, w: Array.from({ length: perRow }, (_, s) => (s === perRow - 1 ? wTw - sub * (perRow - 1) : sub)) });
      if (i < kids.length - 1) {
        const gapTw = Math.round(Math.max(0, rects[i + 1].left - rects[i].right) * TW * scale);
        if (gapTw >= 10) segs.push({ t: 'gap', w: [gapTw] });
      }
    });
    const colW = [].concat(...segs.map(s => s.w));
    const total = omrSum(colW);
    const rowsOut = [];

    grids.forEach((g, gi) => {
      if (gi > 0) rowsOut.push(omrGapRow(total, colW.length, Math.max(40, tw(getComputedStyle(grids[gi - 1]).marginBottom))));
      const qEls = Array.from(g.children);

      // header: question numbers
      const head = [];
      segs.forEach(sg => {
        if (sg.t === 'gap') { head.push(omrCell({ w: sg.w[0] })); return; }
        const q = qEls[sg.i], wSum = omrSum(sg.w);
        if (!isQ(q)) { head.push(omrCell({ w: wSum, span: perRow })); return; }
        const qcs = getComputedStyle(q);
        const num = q.querySelector('.q-number');
        const ncs = num ? getComputedStyle(num) : null;
        head.push(omrCell({
          w: wSum, span: perRow,
          paras: [num ? omrTextPara(num, st, wSum / TW) : omrEmptyPara()],
          shade: ncs ? hexColor(ncs.backgroundColor) : null,
          borders: { top: omrEdge(qcs, 'Top'), left: omrEdge(qcs, 'Left'), right: omrEdge(qcs, 'Right'),
            bottom: (ncs && omrEdge(ncs, 'Bottom')) || omrEdge(qcs, 'Bottom') },
          margins: { top: ncs ? tw(ncs.paddingTop) : 0, bottom: ncs ? tw(ncs.paddingBottom) : 0 }
        }));
      });
      rowsOut.push(new D.TableRow({ children: head, cantSplit: true }));

      // bubble rows
      for (let r = 0; r < nRows; r++) {
        const cells = [];
        segs.forEach(sg => {
          if (sg.t === 'gap') { cells.push(omrCell({ w: sg.w[0] })); return; }
          const q = qEls[sg.i];
          if (!isQ(q)) { sg.w.forEach(w => cells.push(omrCell({ w }))); return; }
          const qcs = getComputedStyle(q);
          const rowCircles = rowsOf(q)[r] || [];
          const probe = rowCircles[0];
          const wrap = probe && probe.parentElement;
          const holder = wrap && wrap.parentElement;               // .options container
          const hcs = holder && holder !== q ? getComputedStyle(holder) : null;
          let top = 0, bottom = 0;
          if (wrap && wrap !== q) { const wcs = getComputedStyle(wrap); top += tw(wcs.paddingTop); bottom += tw(wcs.paddingBottom); }
          if (hcs) {
            const rg = tw(hcs.rowGap) / 2;
            top += rg; bottom += rg;
            if (r === 0) top += tw(hcs.paddingTop);
            if (r === nRows - 1) bottom += tw(hcs.paddingBottom);
          }
          for (let s = 0; s < perRow; s++) {
            const c = rowCircles[s];
            const own = (c || probe) && (c || probe).parentElement;
            const shade = own && own !== q ? hexColor(getComputedStyle(own).backgroundColor) : null;
            const b = {};
            if (s === 0) b.left = omrEdge(qcs, 'Left');
            if (s === perRow - 1) b.right = omrEdge(qcs, 'Right');
            if (r === nRows - 1) b.bottom = omrEdge(qcs, 'Bottom');
            cells.push(omrCell({ w: sg.w[s], paras: [omrBubblePara(c, st, sg.w[s] / TW - 1)], shade, borders: b,
              margins: { top: Math.round(top), bottom: Math.round(bottom) } }));
          }
        });
        rowsOut.push(new D.TableRow({ children: cells, cantSplit: true }));
      }
    });
    omrPush(out, omrTable(colW, rowsOut, ctx));
    return true;
  }

  // ---- classic: N columns of .q-row  (number + K bubbles in a line) ----
  function convertOmrClassic(grid, columns, ctx, st, out) {
    const D = window.docx;
    const circlesOf = (row) => Array.from(row.querySelectorAll('.circle')).filter(c => !isHidden(c));
    const blocks = columns.map(col => Array.from(col.querySelectorAll('.q-row')).filter(r => !isHidden(r)));
    const nRows = Math.max(0, ...blocks.map(b => b.length));
    if (!nRows) return false;
    const K = Math.max(1, ...[].concat(...blocks).map(r => circlesOf(r).length));
    const sample = (blocks.find(b => b.length) || [])[0];
    const sNum = sample.querySelector('.q-number');
    const sCirc = circlesOf(sample);
    const scs = getComputedStyle(sample);
    const rc = columns.map(c => c.getBoundingClientRect());
    const totalPx = Math.max(1, rc[rc.length - 1].right - rc[0].left);
    const availTw = Math.max(720, ctx.width);
    const scale = Math.min(1, availTw / (totalPx * TW));

    const numPx = sNum ? sNum.getBoundingClientRect().width + px(getComputedStyle(sNum).marginRight) + px(scs.paddingLeft) : 30;
    const bubPx = sCirc.length ? sCirc[0].getBoundingClientRect().width : 20;
    let gapPx = 6;
    if (sCirc.length > 1) { const a = sCirc[0].getBoundingClientRect(), b = sCirc[1].getBoundingClientRect(); gapPx = Math.max(0, b.left - a.right); }

    const segs = [];     // {t:'num'|'bub'|'fill'|'gap', b, k, w}
    columns.forEach((col, bi) => {
      const bw = rc[bi].width;
      const need = numPx + K * (bubPx + gapPx);
      const f = Math.min(1, bw / need);
      const numTw = Math.round(numPx * f * TW * scale);
      const bubTw = Math.round((bubPx + gapPx) * f * TW * scale);
      const blockTw = Math.round(bw * TW * scale);
      const fill = Math.max(0, blockTw - numTw - K * bubTw);
      segs.push({ t: 'num', b: bi, w: numTw });
      for (let k = 0; k < K; k++) segs.push({ t: 'bub', b: bi, k, w: bubTw });
      if (fill >= 10) segs.push({ t: 'fill', b: bi, w: fill });
      if (bi < columns.length - 1) {
        const g = Math.round(Math.max(0, rc[bi + 1].left - rc[bi].right) * TW * scale);
        if (g >= 10) segs.push({ t: 'gap', b: bi, w: g });
      }
    });
    const colW = segs.map(s => s.w);

    const rowsOut = [];
    for (let r = 0; r < nRows; r++) {
      const cells = segs.map(sg => {
        if (sg.t === 'gap') return omrCell({ w: sg.w });
        const row = blocks[sg.b][r];
        if (!row) return omrCell({ w: sg.w });
        const rcs = getComputedStyle(row);
        const prev = r > 0 ? blocks[sg.b][r - 1] : null;
        const gapAbove = prev ? tw(getComputedStyle(prev).marginBottom) : 0;
        const common = { w: sg.w, borders: { bottom: omrEdge(rcs, 'Bottom') }, margins: { top: gapAbove, bottom: 0 } };
        if (sg.t === 'num') {
          const num = row.querySelector('.q-number');
          return omrCell(Object.assign(common, {
            paras: [num ? omrTextPara(num, st, sg.w / TW) : omrEmptyPara()],
            margins: { top: gapAbove, bottom: 0, left: tw(rcs.paddingLeft), right: num ? tw(getComputedStyle(num).marginRight) : 0 }
          }));
        }
        if (sg.t === 'bub') return omrCell(Object.assign(common, { paras: [omrBubblePara(circlesOf(row)[sg.k], st, sg.w / TW - 1)] }));
        return omrCell(common);   // filler keeps the dotted line running to the column edge
      });
      rowsOut.push(new D.TableRow({ children: cells, cantSplit: true }));
    }
    omrPush(out, omrTable(colW, rowsOut, ctx));
    return true;
  }

  // ---- unknown OMR markup: rebuild from the positions of numbers + bubbles ----
  function convertOmrGeneric(el, ctx, st, out) {
    const D = window.docx;
    const atoms = [];
    const add = (n, circle) => {
      if (isHidden(n)) return;
      const r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      atoms.push({ n, r, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, circle });
    };
    Array.from(el.querySelectorAll('.circle')).forEach(n => add(n, true));
    // every other text leaf (question numbers, labels, headings) stays real text
    Array.from(el.querySelectorAll('*')).forEach(n => {
      if (n.closest('.circle') || n.children.length || !(n.textContent || '').trim()) return;
      add(n, false);
    });
    if (!atoms.length) return false;
    const centres = (vals, tol) => {
      const s = vals.slice().sort((a, b) => a - b), o = [];
      s.forEach(v => {
        const c = o[o.length - 1];
        if (!c || v - c.max > tol) o.push({ max: v, sum: v, n: 1 }); else { c.max = v; c.sum += v; c.n++; }
      });
      return o.map(c => c.sum / c.n);
    };
    const xs = centres(atoms.map(a => a.cx), 3), ys = centres(atoms.map(a => a.cy), 3);
    const left = Math.min(...atoms.map(a => a.r.left)), right = Math.max(...atoms.map(a => a.r.right));
    const edges = [left].concat(xs.slice(1).map((x, i) => (xs[i] + x) / 2), [right]);
    const scale = Math.min(1, Math.max(720, ctx.width) / (Math.max(1, right - left) * TW));
    const colW = edges.slice(1).map((e, i) => Math.max(40, Math.round((e - edges[i]) * TW * scale)));
    const grid = ys.map(() => xs.map(() => []));
    atoms.forEach(a => grid[nearest(ys, a.cy)][nearest(xs, a.cx)].push(a));
    const rows = grid.map(row => new D.TableRow({ cantSplit: true, children: row.map((cell, ci) =>
      omrCell({ w: colW[ci], margins: { top: 20, bottom: 20 },
        paras: cell.sort((p, q) => p.r.left - q.r.left).map(a => a.circle ? omrBubblePara(a.n, st, colW[ci] / TW - 1) : omrTextPara(a.n, st)) })) }));
    omrPush(out, omrTable(colW, rows, ctx));
    return true;
  }

  function convertOmrGrids(grids, ctx, st, out) {
    grids = grids.filter(g => !isHidden(g));
    if (!grids.length) return;
    const direct = (g, cls) => !!g.querySelector(':scope > .' + cls);
    if (grids.some(g => direct(g, 'q-col'))) {
      if (convertOmrQCols(grids, ctx, st, out)) return;
    } else if (grids.some(g => direct(g, 'column'))) {
      let ok = false;
      grids.forEach(g => {
        const cols = Array.from(g.children).filter(c => c.classList && c.classList.contains('column'));
        if (cols.length && convertOmrClassic(g, cols, ctx, st, out)) ok = true;
      });
      if (ok) return;
    }
    grids.forEach(g => convertOmrGeneric(g, ctx, st, out));
  }

  // Walks a container: header line -> text, consecutive .omr-grid rows -> ONE
  // table, wrappers -> recursed, anything else (note, titles) -> normal blocks.
  function convertOmrContainer(el, ctx, st, out) {
    let batch = [];
    const flush = () => { if (batch.length) { convertOmrGrids(batch, ctx, st, out); batch = []; } };
    for (const child of Array.from(el.children)) {
      if (isHidden(child)) continue;
      if (child.classList.contains('omr-grid')) { batch.push(child); continue; }
      flush();
      if (child.querySelector('.omr-grid')) {
        const cc = childCtx(child, ctx);
        const items = [];
        convertOmrContainer(child, cc.ctx, st, items);
        if (items.length) { addOuterSpacing(items, cc.before, cc.after); out.push(...items); }
        continue;
      }
      const head = omrHeaderItem(child, ctx, st);
      if (head) { out.push(head); continue; }
      if (isBlockNode(child)) convertBlock(child, ctx, st, out);
      else { const p = makeParagraph(el, [child], ctx, st, false); if (p) out.push(p); }
    }
    flush();
  }

  function convertOmr(el, ctx, st, out) {
    flushBreak(st, out);
    if (el.classList.contains('omr-grid')) { convertOmrGrids([el], ctx, st, out); return; }
    const cs = getComputedStyle(el);
    const info = boxInfo(cs);
    const build = (c) => { const items = []; convertOmrContainer(el, c, st, items); return items; };
    if (info.box) {   // the sheet's outer frame = a one-cell table (no border leaks into typed text)
      convertBox(el, cs, info, ctx, st, out, (c) => build(Object.assign({}, c, { width: Math.max(360, c.width - 60) })));
      return;
    }
    const cc = childCtx(el, ctx);
    const items = build(cc.ctx);
    if (items.length) { addOuterSpacing(items, cc.before, cc.after); out.push(...items); }
  }

  // ---- exam paper (exam-library.js): questions, 2-column page, header, answer key ----
  // Same idea as the OMR: nothing is flattened. Question = one hanging-indent
  // paragraph (number, tab, stem); options = real text on tab stops (2 per line)
  // or hanging paragraphs when an option is long; the two question columns =
  // a one-row table with the column rule as a cell border; the time/marks line
  // = one paragraph with centre/right tab stops; the answer key = a text table.
  function tabRun() {
    const D = window.docx;
    return D.Tab ? new D.TextRun({ children: [new D.Tab()] }) : new D.TextRun({ text: '\t' });
  }
  function flushBreak(st, out) {          // a pending manual page break must not land inside a table cell
    if (!st.pageBreakPending) return;
    st.pageBreakPending = false;
    out.push({ kind: 'p', before: 0, after: 0,
      opts: { children: [], pageBreakBefore: true, spacing: { line: 20, lineRule: window.docx.LineRuleType.EXACT } } });
  }
  const visKids = (el) => Array.from(el.children).filter(k => !isHidden(k));
  function rowsByTop(items, tol) {         // items: {r: rect} -> visual rows, left to right
    const rows = [];
    items.slice().sort((a, b) => a.r.top - b.r.top).forEach(it => {
      const row = rows.find(x => Math.abs(x.top - it.r.top) <= tol);
      if (row) row.items.push(it); else rows.push({ top: it.r.top, items: [it] });
    });
    return rows.sort((a, b) => a.top - b.top).map(x => x.items.sort((a, b) => a.r.left - b.r.left));
  }

  function convertExamQ(el, ctx, st, out) {
    const D = window.docx;
    const cs = getComputedStyle(el);
    const kids = visKids(el);
    if (!kids.length) return false;
    const wpx = Math.max(50, ctx.width / TW);
    const lineOf = (e) => { const lh = px(getComputedStyle(e).lineHeight); return lh > 0 ? { line: Math.max(20, Math.round(lh * TW)), lineRule: D.LineRuleType.AT_LEAST } : {}; };
    const plainIndent = (ctx.indentLeft || ctx.indentRight) ? { left: ctx.indentLeft, right: ctx.indentRight } : undefined;
    const mk = (children, opts) => ({ kind: 'p', before: 0, after: 0, opts: Object.assign({ children, alignment: D.AlignmentType.LEFT, keepNext: true, keepLines: true }, opts) });

    // "label<TAB>body" with a hanging indent, so wrapped lines stay under the body text
    const hangPara = (labelEl, bodyNodes, styleEl) => {
      const lw = labelEl ? Math.max(300, Math.round((labelEl.getBoundingClientRect().width + 6) * TW)) : 0;
      const runs = [];
      if (labelEl) { runs.push(...piecesToRuns(collectPieces([labelEl], st).pieces, st, 100)); runs.push(tabRun()); }
      runs.push(...piecesToRuns(collectPieces(bodyNodes, st).pieces, st, Math.max(50, wpx - lw / TW)));
      if (!runs.length) return null;
      return mk(runs, { spacing: lineOf(styleEl), indent: labelEl ? { left: ctx.indentLeft + lw, hanging: lw, right: ctx.indentRight } : plainIndent });
    };
    const parts = (item) => { const ik = visKids(item); return ik.length >= 2 ? { lab: ik[0], body: [ik[1]], style: ik[1] } : { lab: null, body: Array.from(item.childNodes), style: item }; };

    const items = [];
    // stem: number + question text
    const sp = parts(kids[0]);
    items.push(hangPara(sp.lab, sp.body, sp.style));

    // options
    const optBox = kids[1];
    if (optBox) {
      const ob = optBox.getBoundingClientRect();
      const lineH = px(getComputedStyle(optBox).lineHeight) || 16;
      const optItems = visKids(optBox).map(k => ({ k, r: k.getBoundingClientRect() })).filter(it => it.r.width > 0);
      rowsByTop(optItems, 3).forEach(row => {
        const wraps = row.some(it => it.r.height > lineH * 1.6);
        if (row.length > 1 && !wraps) {      // (ক) text <tab> (খ) text  — all real text on tab stops
          const runs = [], stops = [];
          row.forEach((it, i) => {
            const p = parts(it.k);
            if (i > 0) {
              runs.push(tabRun());
              stops.push({ type: D.TabStopType.LEFT, position: Math.max(60, Math.round((it.r.left - ob.left) * TW)) + ctx.indentLeft });
            }
            if (p.lab) { runs.push(...piecesToRuns(collectPieces([p.lab], st).pieces, st, 100)); runs.push(new D.TextRun({ text: ' ' })); }
            runs.push(...piecesToRuns(collectPieces(p.body, st).pieces, st, Math.max(50, it.r.width)));
          });
          items.push(mk(runs, { tabStops: stops, spacing: lineOf(optBox), indent: plainIndent }));
        } else {
          row.forEach(it => { const p = parts(it.k); items.push(hangPara(p.lab, p.body, p.style)); });
        }
      });
    }
    const real = items.filter(Boolean);
    if (!real.length) return false;
    real[0].before = tw(cs.marginTop) + tw(cs.paddingTop);
    const last = real[real.length - 1];
    last.opts.keepNext = false;
    last.after = tw(cs.paddingBottom) + tw(cs.marginBottom);
    out.push(...real);
    return true;
  }

  // .block-exam-cols : left questions | right questions  ->  1-row table, column rule = cell border
  function convertExamCols(el, ctx, st, out) {
    const D = window.docx;
    const cols = visKids(el);
    if (!cols.length) return false;
    flushBreak(st, out);
    const rects = cols.map(c => c.getBoundingClientRect());
    const totalPx = Math.max(1, rects[rects.length - 1].right - rects[0].left);
    const scale = Math.min(1, Math.max(720, ctx.width) / (totalPx * TW));
    const colW = rects.map(r => Math.max(300, Math.round(r.width * TW * scale)));
    const cells = cols.map((c, i) => {
      const ccs = getComputedStyle(c);
      const pl = tw(ccs.paddingLeft), pr = tw(ccs.paddingRight), pt = tw(ccs.paddingTop), pb = tw(ccs.paddingBottom);
      const cellCtx = { indentLeft: 0, indentRight: 0, list: null, listDepth: 0, width: Math.max(360, colW[i] - pl - pr - 10) };
      const kids = finalizeBlocks(convertChildren(c, cellCtx, st));
      if (!kids.length || kids[kids.length - 1] instanceof D.Table) kids.push(new D.Paragraph({ children: [] }));
      return new D.TableCell({
        children: kids, width: { size: colW[i], type: D.WidthType.DXA }, verticalAlign: D.VerticalAlign.TOP,
        margins: { top: pt, bottom: pb, left: pl, right: pr },
        borders: { top: omrEdge(ccs, 'Top') || omrNone(), bottom: omrEdge(ccs, 'Bottom') || omrNone(),
          left: omrEdge(ccs, 'Left') || omrNone(), right: omrEdge(ccs, 'Right') || omrNone() }
      });
    });
    const n = () => omrNone();
    const opts = {
      rows: [new D.TableRow({ children: cells })], width: { size: omrSum(colW), type: D.WidthType.DXA }, columnWidths: colW,
      layout: D.TableLayoutType.FIXED,
      borders: { top: n(), bottom: n(), left: n(), right: n(), insideHorizontal: n(), insideVertical: n() }
    };
    if (ctx.indentLeft) opts.indent = { size: ctx.indentLeft, type: D.WidthType.DXA };
    out.push({ kind: 'table', table: new D.Table(opts), before: 0, after: 0, tight: true });
    return true;
  }

  // "Time: 40 min      Marks per Q: 1      Full marks: 40"  ->  ONE paragraph, centre/right tab stops
  function convertTextRow(el, cs, ctx, st, out) {
    const D = window.docx;
    if (!/flex/.test(cs.display) || cs.flexWrap !== 'nowrap' || !/^row/.test(cs.flexDirection)) return false;
    const kids = visKids(el).filter(k => (k.textContent || '').trim() || k.querySelector('img,svg'));
    if (kids.length < 2 || kids.length > 4 || kids.some(k => k.querySelector(BLOCK_SELECTOR))) return false;
    const base = el.getBoundingClientRect();
    const L = base.left + px(cs.paddingLeft), W = base.width - px(cs.paddingLeft) - px(cs.paddingRight);
    const runs = [], stops = [];
    kids.forEach((k, i) => {
      if (i > 0) {
        const r = k.getBoundingClientRect(), isLast = i === kids.length - 1;
        const posPx = isLast ? W : (r.left + r.right) / 2 - L;
        stops.push({ type: isLast ? D.TabStopType.RIGHT : D.TabStopType.CENTER,
          position: Math.min(ctx.width - 10, Math.max(60, Math.round(posPx * TW))) + ctx.indentLeft });
        runs.push(tabRun());
      }
      runs.push(...piecesToRuns(collectPieces([k], st).pieces, st, Math.max(50, W)));
    });
    if (!runs.length) return false;
    const item = { kind: 'p', before: tw(cs.marginTop) + tw(cs.paddingTop), after: tw(cs.marginBottom) + tw(cs.paddingBottom),
      opts: { children: runs, tabStops: stops, alignment: D.AlignmentType.LEFT, spacing: {},
        indent: (ctx.indentLeft || ctx.indentRight) ? { left: ctx.indentLeft, right: ctx.indentRight } : undefined } };
    out.push(...applyRules([item], cs, boxInfo(cs), ctx));   // top/bottom lines stay as rule lines
    return true;
  }

  // wrapped row of short text cells (answer key "১ – ক", ...)  ->  borderless text table
  function convertTextGrid(el, cs, ctx, st, out) {
    const D = window.docx;
    if (!/flex/.test(cs.display) || cs.flexWrap === 'nowrap') return false;
    const kids = visKids(el);
    if (kids.length < 2 || kids.some(k => k.querySelector(BLOCK_SELECTOR))) return false;
    flushBreak(st, out);
    const items = kids.map(k => ({ k, r: k.getBoundingClientRect() })).filter(it => it.r.width > 0);
    const rows = rowsByTop(items, 3);
    const nCols = Math.max(...rows.map(r => r.length));
    const ref = rows.find(r => r.length === nCols);
    const totalPx = Math.max(1, ref[nCols - 1].r.right - ref[0].r.left);
    const scale = Math.min(1, Math.max(720, ctx.width) / (totalPx * TW));
    const colW = ref.map(it => Math.max(120, Math.round(it.r.width * TW * scale)));
    const trs = rows.map(row => new D.TableRow({ cantSplit: true, children: colW.map((w, ci) => {
      const it = row[ci];
      if (!it) return omrCell({ w });
      const ics = getComputedStyle(it.k);
      const runs = piecesToRuns(collectPieces([it.k], st).pieces, st, w / TW);
      return omrCell({ w, margins: { top: tw(ics.paddingTop), bottom: tw(ics.paddingBottom) },
        paras: [runs.length ? new D.Paragraph({ alignment: alignmentOf(ics), spacing: { before: 0, after: 0 }, children: runs }) : omrEmptyPara()] });
    }) }));
    out.push({ kind: 'table', table: omrTable(colW, trs, ctx), before: tw(cs.marginTop), after: tw(cs.marginBottom), tight: true });
    return true;
  }

  function convertBlock(el, ctx, st, out) {
    const cs = getComputedStyle(el);
    if (isHidden(el, cs)) return;
    const tag = tagOf(el);

    // OMR sheets must be handled before generic box/paragraph conversion,
    // otherwise flexbox collapses into stacked single-letter paragraphs.
    if (isOmrBlock(el)) {
      convertOmr(el, ctx, st, out);
      return;
    }
    if (isCircleRegion(el) && convertOmrGeneric(el, ctx, st, out)) return;
    if (el.classList.contains('exam-q') && convertExamQ(el, ctx, st, out)) return;
    if (el.classList.contains('block-exam-cols') && convertExamCols(el, ctx, st, out)) return;
    if (el.closest && el.closest('.exam-header, .exam-key')) {
      const ecs = getComputedStyle(el);
      if (convertTextRow(el, ecs, ctx, st, out) || convertTextGrid(el, ecs, ctx, st, out)) return;
    }

    if (cs.breakBefore === 'page' || cs.pageBreakBefore === 'always') st.pageBreakPending = true;

    if (tag === 'hr') { out.push(makeHr(el, ctx, st)); return; }
    if (tag === 'table' || cs.display === 'table') { convertTable(el, ctx, st, out); return; }
    if (tag === 'ul' || tag === 'ol') { convertList(el, ctx, st, out); return; }
    if (st.media.has(el)) {
      const p = makeParagraph(el.parentElement || el, [el], ctx, st, false);
      // block-level images / .fc-wrapper snapshots carry their own margins
      if (p) { p.before = tw(cs.marginTop); p.after = tw(cs.marginBottom); out.push(p); }
      return;
    }
    if (el.classList.contains('katex-eq') || el.classList.contains('katex')) {
      const p = makeParagraph(el.parentElement || el, [el], ctx, st, false);
      if (p) out.push(p);
      return;
    }
    if (tag === 'li') { convertListItem(el, ctx, st, out); return; }

    const info = boxInfo(cs);
    if (info.box) { convertBox(el, cs, info, ctx, st, out); return; }

    const hasBlock = Array.from(el.childNodes).some(isBlockNode);
    let items = [];
    if (!hasBlock) {
      const p = makeParagraph(el, Array.from(el.childNodes), ctx, st, true);
      if (p) items.push(p);
      else {
        // empty block acting as a divider line
        const h = px(cs.height), bd = info.own.bottom || info.own.top;
        if (bd && h <= 6) items.push(makeHr(el, ctx, st));
      }
    } else {
      const cc = childCtx(el, ctx);
      items = convertChildren(el, cc.ctx, st);
      if (items.length) addOuterSpacing(items, cc.before, cc.after);
    }
    out.push(...applyRules(items, cs, info, ctx));
  }

  function addOuterSpacing(items, before, after) {
    const first = items[0], last = items[items.length - 1];
    if (before) { if (first.kind === 'p') first.before += before; else first.before = (first.before || 0) + before; }
    if (after) { if (last.kind === 'p') last.after += after; else last.after = (last.after || 0) + after; }
  }

  // Walks child nodes: runs of inline nodes become anonymous paragraphs (styled
  // by the parent), block children are converted recursively.
  function convertChildren(parent, ctx, st) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const p = makeParagraph(parent, run, ctx, st, false);
      if (p) out.push(p);
      run = [];
    };
    for (const n of Array.from(parent.childNodes)) {
      if (isBlockNode(n)) { flush(); convertBlock(n, ctx, st, out); }
      else if (isText(n) || isEl(n)) run.push(n);
    }
    flush();
    return out;
  }

  // ---- lists ------------------------------------------------------------
  function listFormat(type) {
    const L = window.docx.LevelFormat;
    return ({
      'decimal': L.DECIMAL, 'decimal-leading-zero': L.DECIMAL_ZERO,
      'lower-alpha': L.LOWER_LETTER, 'lower-latin': L.LOWER_LETTER,
      'upper-alpha': L.UPPER_LETTER, 'upper-latin': L.UPPER_LETTER,
      'lower-roman': L.LOWER_ROMAN, 'upper-roman': L.UPPER_ROMAN
    })[type] || L.DECIMAL;
  }
  function orderedRef(ol, cs, st) {
    const D = window.docx;
    const ref = 'ol-' + (++st.olCount);
    const start = parseInt(ol.getAttribute('start'), 10);
    const fmt = listFormat(cs.listStyleType);
    st.numbering.push({
      reference: ref,
      levels: Array.from({ length: 9 }, (_, l) => ({
        level: l, format: fmt, text: `%${l + 1}.`, alignment: D.AlignmentType.LEFT,
        start: Number.isFinite(start) ? start : 1,
        style: { paragraph: { indent: { left: 720 + 360 * l, hanging: 360 } } }
      }))
    });
    return ref;
  }
  function bulletConfig() {
    const D = window.docx;
    const glyphs = ['\u2022', '\u25E6', '\u25AA'];
    return {
      reference: 'bul',
      levels: Array.from({ length: 9 }, (_, l) => ({
        level: l, format: D.LevelFormat.BULLET, text: glyphs[l % 3], alignment: D.AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720 + 360 * l, hanging: 360 } } }
      }))
    };
  }

  function convertList(list, ctx, st, out) {
    const cs = getComputedStyle(list);
    const ordered = tagOf(list) === 'ol';
    const level = Math.min(8, ctx.listDepth || 0);
    const ref = cs.listStyleType === 'none' ? null : (ordered ? orderedRef(list, cs, st) : 'bul');
    const lc = Object.assign({}, ctx, {
      listDepth: level + 1,
      indentLeft: ctx.indentLeft + tw(cs.marginLeft) + tw(cs.paddingLeft),
      width: ctx.width - tw(cs.marginLeft) - tw(cs.paddingLeft)
    });
    const inner = [];
    for (const child of Array.from(list.children)) {
      if (isHidden(child)) continue;
      if (tagOf(child) === 'li') {
        const liCtx = Object.assign({}, lc, { list: { ref: getComputedStyle(child).listStyleType === 'none' ? null : ref, level, used: false } });
        convertListItem(child, liCtx, st, inner);
      } else convertBlock(child, lc, st, inner);
    }
    if (!inner.length) return;
    addOuterSpacing(inner, tw(cs.marginTop), tw(cs.marginBottom));
    out.push(...inner);
  }

  function convertListItem(li, ctx, st, out) {
    const cs = getComputedStyle(li);
    const c = Object.assign({}, ctx);
    if (!c.list) c.list = { ref: null, level: 0, used: true };
    const items = convertChildren(li, c, st);
    // nested <ul>/<ol> inside the li are handled by convertBlock -> convertList
    if (!items.length) return;
    addOuterSpacing(items, tw(cs.marginTop), tw(cs.marginBottom));
    out.push(...items);
  }

  // ---- tables -----------------------------------------------------------
  function cluster(values, tol) {
    const sorted = values.slice().sort((a, b) => a - b);
    const out = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
    return out;
  }
  const nearest = (arr, v) => { let bi = 0, bd = Infinity; arr.forEach((a, i) => { const d = Math.abs(a - v); if (d < bd) { bd = d; bi = i; } }); return bi; };

  function cellBackground(cell) {
    if (isMono()) return null;
    for (let n = cell; n && n.localName !== 'table'; n = n.parentElement) {
      const bg = hexColor(getComputedStyle(n).backgroundColor);
      if (bg) return bg;
    }
    const tbl = cell.closest('table');
    return tbl ? hexColor(getComputedStyle(tbl).backgroundColor) : null;
  }

  function convertTable(tbl, ctx, st, out) {
    const D = window.docx;
    const tcs = getComputedStyle(tbl);
    const rows = Array.from(tbl.rows).filter(r => !isHidden(r));
    if (!rows.length) return;
    if (tbl.caption && !isHidden(tbl.caption)) {
      const cp = makeParagraph(tbl.caption, Array.from(tbl.caption.childNodes), ctx, st, true);
      if (cp) out.push(cp);
    }

    // column grid from real rendered cell edges (handles colspan / rowspan)
    const edges = [];
    rows.forEach(r => Array.from(r.cells).forEach(c => { const b = c.getBoundingClientRect(); edges.push(b.left, b.right); }));
    const grid = cluster(edges, 2);
    if (grid.length < 2) return;
    const colPx = grid.slice(1).map((x, i) => x - grid[i]);
    const totalPx = grid[grid.length - 1] - grid[0];
    const availTw = Math.max(720, ctx.width);
    const tableTw = Math.min(Math.round(totalPx * TW), availTw);
    const scale = tableTw / (totalPx * TW);
    let colTw = colPx.map(w => Math.max(120, Math.round(w * TW * scale)));
    const diff = tableTw - colTw.reduce((a, b) => a + b, 0);
    colTw[colTw.length - 1] += diff;

    const docRows = rows.map(r => {
      const rcs = getComputedStyle(r);
      const cells = Array.from(r.cells).filter(c => !isHidden(c)).map(cell => {
        const ccs = getComputedStyle(cell);
        const b = cell.getBoundingClientRect();
        const c0 = nearest(grid, b.left), c1 = Math.max(c0 + 1, nearest(grid, b.right));
        const span = c1 - c0;
        const widthTw = colTw.slice(c0, c1).reduce((a, x) => a + x, 0);

        const padT = tw(ccs.paddingTop), padB = tw(ccs.paddingBottom), padL = tw(ccs.paddingLeft), padR = tw(ccs.paddingRight);
        const cellCtx = { indentLeft: 0, indentRight: 0, shading: null, border: null, list: null, listDepth: 0, width: Math.max(360, widthTw - padL - padR) };
        let kids = finalizeBlocks(convertChildren(cell, cellCtx, st));
        if (!kids.length || kids[kids.length - 1] instanceof D.Table) kids.push(new D.Paragraph({ children: [] }));

        const borders = {};
        [['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']].forEach(([k, K]) => {
          borders[k] = borderSpec(ccs, K, 0) || NO_BORDER();
          delete borders[k].space;
        });
        const va = ccs.verticalAlign;
        const cellOpts = {
          children: kids,
          width: { size: widthTw, type: D.WidthType.DXA },
          margins: { top: padT, bottom: padB, left: padL, right: padR },
          borders,
          verticalAlign: va === 'middle' ? D.VerticalAlign.CENTER : va === 'bottom' ? D.VerticalAlign.BOTTOM : D.VerticalAlign.TOP
        };
        if (span > 1) cellOpts.columnSpan = span;
        if (cell.rowSpan > 1) cellOpts.rowSpan = cell.rowSpan;
        const bg = cellBackground(cell);
        if (bg) cellOpts.shading = { type: D.ShadingType.CLEAR, fill: bg, color: 'auto' };
        return new D.TableCell(cellOpts);
      });
      if (!cells.length) return null;
      const inHead = r.parentElement && tagOf(r.parentElement) === 'thead';
      return new D.TableRow({ children: cells, cantSplit: true, tableHeader: !!inHead });
    }).filter(Boolean);
    if (!docRows.length) return;

    const none = NO_BORDER();
    const tblOpts = {
      rows: docRows,
      width: { size: tableTw, type: D.WidthType.DXA },
      columnWidths: colTw,
      layout: D.TableLayoutType.FIXED,
      borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
    };
    // centred table (margin: auto) vs. left-aligned with optional indent
    const host = (tbl.parentElement || tbl).getBoundingClientRect();
    const tr = tbl.getBoundingClientRect();
    const leftGap = tr.left - host.left, rightGap = host.right - tr.right;
    if (leftGap > 12 && Math.abs(leftGap - rightGap) < 6) tblOpts.alignment = D.AlignmentType.CENTER;
    else if (ctx.indentLeft) tblOpts.indent = { size: ctx.indentLeft, type: D.WidthType.DXA };

    out.push({ kind: 'table', table: new D.Table(tblOpts), before: tw(tcs.marginTop), after: tw(tcs.marginBottom) });
  }

  // ---- finalise: collapse CSS-style margins, then build docx objects ----
  function finalizeBlocks(items) {
    const D = window.docx;
    const out = [];
    const lineTw = ((BASE && BASE.size) || 24) * 12; // height of one normal empty line
    const build = (it) => {
      if (it.kind !== 'p') return it.table;
      it.opts.spacing = Object.assign({}, it.opts.spacing, { before: Math.max(0, Math.round(it.before || 0)), after: Math.max(0, Math.round(it.after || 0)) });
      if (it.opts.indent === undefined) delete it.opts.indent;
      return new D.Paragraph(it.opts);
    };
    for (let i = 0; i < items.length; i++) {
      const a = items[i], b = items[i + 1];
      if (a.kind === 'table') {
        // Every table / box is followed by a normal-height, completely plain empty
        // paragraph. It is the place to click (or press Down) to leave the box and
        // keep typing; a hair-thin spacer would be impossible to click. It also
        // stops two tables from merging into one in Word.
        out.push(build(a));
        out.push(a.tight
          ? new D.Paragraph({ children: [], spacing: { before: 0, after: 0, line: 100, lineRule: D.LineRuleType.EXACT }, run: { size: 2 } })
          : new D.Paragraph({ children: [] }));
        if (b && b.kind === 'p') b.before = Math.max(0, Math.max(a.after || 0, b.before || 0) - (a.tight ? 0 : lineTw));
        continue;
      }
      if (b && b.kind === 'p') {
        // CSS sibling margins collapse to the larger one; Word would add them
        const gap = Math.max(a.after || 0, b.before || 0);
        a.after = gap; b.before = 0;
      } else if (b && b.kind === 'table') {
        a.after = Math.max(a.after || 0, b.before || 0);
      }
      out.push(build(a));
    }
    return out;
  }

  // ---- one-pass package finish -----------------------------------------
  // Opens the .docx once, writes equations, charts, diagrams and OMR bubbles
  // into it, gives every drawing a unique id (Word flags duplicates as
  // unreadable content), and compresses once.
  async function finalizeDocx(blob, st) {
    const zip = await window.JSZip.loadAsync(blob);
    const ctx = {
      zip,
      doc: await zip.file('word/document.xml').async('string'),
      rels: await zip.file('word/_rels/document.xml.rels').async('string'),
      types: await zip.file('[Content_Types].xml').async('string')
    };
    if (st.maths.length) {
      const map = {};
      st.maths.forEach((xml, k) => { map[k + 1] = `<m:oMath xmlns:m="${NS_M}">${xml}</m:oMath>`; });
      ctx.doc = replaceMarkers(ctx.doc, 'WORDMATH', map);
    }
    if (st.charts.length) await applyNativeCharts(ctx, st.charts);
    if (st.diagrams.length) await applyNativeDiagrams(ctx, st.diagrams);
    if (st.bubbles && st.bubbles.length) {
      const map = {};
      st.bubbles.forEach((b, k) => { map[k] = bubbleRunXml(b, 20000 + k); });
      ctx.doc = replaceMarkers(ctx.doc, 'WORDBUBBLE', map);
    }

    let n = 100;
    ctx.doc = ctx.doc.replace(/<wp:docPr id="\d+"/g, () => `<wp:docPr id="${n++}"`);
    ctx.doc = ctx.doc.replace(/<pic:cNvPr id="\d+"/g, () => `<pic:cNvPr id="${n++}"`);

    zip.file('word/document.xml', ctx.doc);
    zip.file('word/_rels/document.xml.rels', ctx.rels);
    zip.file('[Content_Types].xml', ctx.types);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }

  // ---- download ---------------------------------------------------------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function toast(msg) { if (typeof displayToastNotification === 'function') displayToastNotification(msg); }
  function busy(btn, on) { if (typeof _setExportButtonBusy === 'function') _setExportButtonBusy(btn, on, 'Word'); }

  function mountStage(fragmentHost) {
    const L = pageLayout();
    const live = document.querySelector('.doc-page-canvas');
    const stage = document.createElement('div');
    stage.className = live ? live.className.replace(/\bpdf-export-measure-page\b/g, '') : 'doc-page-canvas';
    const set = (k, v) => stage.style.setProperty(k, v, 'important');
    set('position', 'fixed'); set('left', '-20000px'); set('top', '0');
    set('width', L.width + 'px'); set('height', 'auto'); set('min-height', '0'); set('max-height', 'none');
    set('padding', `${L.top}px ${L.right}px ${L.bottom}px ${L.left}px`);
    set('margin', '0'); set('box-sizing', 'border-box'); set('overflow', 'visible');
    set('background', '#fff'); set('box-shadow', 'none'); set('border', 'none'); set('border-radius', '0');
    set('pointer-events', 'none'); set('z-index', '-1'); set('transform', 'none');
    while (fragmentHost.firstChild) stage.appendChild(fragmentHost.firstChild);
    document.body.appendChild(stage);
    return stage;
  }

  // ---- main entry -------------------------------------------------------
  async function exportToWordDocumentPro(btn) {
    const legacy = window.exportToWordDocumentLegacy;

    if (!window.docx || !window.docx.Document || !window.docx.Packer) {
      console.warn('[WordExport] docx library not loaded — using raw-HTML fallback.');
      if (typeof legacy === 'function') return legacy(btn);
      toast('⚠️ Word export library failed to load. Check your connection and reload.');
      return;
    }

    if (typeof ensureAllPagesMathRendered === 'function') ensureAllPagesMathRendered();
    const rawContent = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
    if (!rawContent || rawContent.includes('Start typing here')) { toast('⚠️ Document is empty.'); return; }

    busy(btn, true);
    let stage = null, failed = null;
    try {
      const D = window.docx;
      const temp = document.createElement('div');
      temp.innerHTML = rawContent;
      temp.querySelectorAll('.page-footer-number').forEach(f => f.remove());
      Array.from(temp.querySelectorAll('*')).forEach(el => { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); });

      stage = mountStage(temp);
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (_) { /* ignore */ } }

      const L = pageLayout();
      const contentTw = A4.w - Math.round((L.left + L.right) * TW);
      const st = {
        layout: L, media: new WeakMap(), numbering: [bulletConfig()], olCount: 0, pageBreakPending: false, maths: [],
        bubbles: []
      };
      BASE = runFormat(stage);
      toast('⏳ Preparing Word export…');
      const uneditableCount = await prepareMedia(stage, st.media);  // equations, charts, images -> sharp embedded media

      const rootCtx = { indentLeft: 0, indentRight: 0, shading: null, border: null, list: null, listDepth: 0, width: contentTw };
      const name = typeof getDocumentTopicName === 'function' ? getDocumentTopicName() : 'Document';

      // Word's built-in Heading 1-6 / Hyperlink styles come with their own blue and
      // sizes, and a run only states the properties that differ from the page default —
      // so a black heading would silently turn blue. Make those styles neutral: runs
      // then look exactly like the page (in colour AND monochrome).
      const neutralStyles = () => {
        const plain = { run: { color: BASE.color, size: BASE.size, sizeComplexScript: BASE.size, bold: false, italics: false } };
        const o = { hyperlink: { run: { color: BASE.color, underline: { type: D.UnderlineType.NONE } } } };
        for (let n = 1; n <= 6; n++) o['heading' + n] = plain;
        return o;
      };

      const assemble = async (nativeCharts, nativeDiagrams) => {
        st.nativeCharts = nativeCharts; st.charts = [];
        st.nativeDiagrams = nativeDiagrams !== false; st.diagrams = [];
        st.numbering = [bulletConfig()]; st.olCount = 0; st.pageBreakPending = false; st.maths = [];
        st.bubbles = [];
        const blocks = convertChildren(stage, rootCtx, st);
        const children = finalizeBlocks(blocks);
        // end on a clean, unformatted paragraph (a trailing table already got one)
        if (!blocks.length || blocks[blocks.length - 1].kind !== 'table') children.push(new D.Paragraph({ children: [] }));
        const doc = new D.Document({
          title: name,
          creator: document.title || 'Document',
          styles: { default: Object.assign({ document: { run: {
            font: { ascii: BASE.font, hAnsi: BASE.font, eastAsia: BASE.font, cs: BASE.csFont },
            size: BASE.size, sizeComplexScript: BASE.size, color: BASE.color
          } } }, neutralStyles()) },
          numbering: { config: st.numbering },
          sections: [{
            properties: {
              page: {
                size: { width: A4.w, height: A4.h },
                margin: { top: Math.round(L.top * TW), right: Math.round(L.right * TW), bottom: Math.round(L.bottom * TW), left: Math.round(L.left * TW), header: 708, footer: 708 }
              }
            },
            children,
            headers: { default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ text: name, size: 16, color: isMono() ? '000000' : '888888' })] })] }) },
            footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES], size: 16, color: isMono() ? '000000' : '888888' })] })] }) }
          }]
        });
        return D.Packer.toBlob(doc);
      };

      let blob = await assemble(true, true);
      try {
        blob = await finalizeDocx(blob, st);
      } catch (e) {
        console.warn('[WordExport] native chart/diagram embed failed, retrying with pictures:', e);
        blob = await assemble(false, false);
        blob = await finalizeDocx(blob, st);
      }
      downloadBlob(blob, name + '.docx');
      toast(uneditableCount
        ? `⚠️ Saved. ${uneditableCount} chart/figure(s) were exported as pictures, so their text is not editable.`
        : '✅ Word Document Saved');
    } catch (e) {
      failed = e;
      console.error('[WordExport] native .docx build failed:', e);
    } finally {
      if (stage) stage.remove();
      busy(btn, false);
    }

    if (failed) {
      if (typeof legacy === 'function') {
        toast('⚠️ Native Word export failed — saving compatibility version instead.');
        return legacy(btn);
      }
      toast('⚠️ Word export failed: ' + (failed.message || 'Unknown error'));
    }
  }

  window.exportToWordDocumentPro = exportToWordDocumentPro;
  window.exportToWordDocument = exportToWordDocumentPro;
})();