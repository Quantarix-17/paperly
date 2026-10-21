// ========================================================================
// DIAGRAM TEMPLATE LIBRARY
// ========================================================================
// A freehand AI-drawn SVG can misjudge coordinates: a vessel that ends a
// few units short of the chamber it enters, an arrowhead pointing the
// wrong way, a valve floating beside a junction instead of sitting on it.
// For a set of very commonly requested, well-known subjects, this file
// supplies a FIXED, hand-authored, pre-verified SVG asset instead of
// asking the AI to redraw the anatomy from scratch every time.
//
// Construction discipline used in every template here:
//   1. Every physically-joined part (a vessel entering a chamber, a branch
//      leaving a trunk) is drawn with deliberate coordinate OVERLAP, and
//      thick vessel/branch strokes use round line-caps so two segments
//      that share a junction point always render as one continuous tube
//      instead of two abutting shapes with a visible seam.
//   2. Chambers/organs are drawn as shapes INSET inside a single solid
//      outer body/silhouette path, so there is never a "does this piece
//      touch that piece" question for the main structure.
//   3. Every label's leader line targets an exact coordinate that was
//      chosen to match the real feature drawn at that spot — not guessed.
//      Labels are placed by _dlLabelColumn(), which sorts them by target
//      height so leader lines never cross each other.
//   4. Flow arrows are authored so the path's own start->end direction is
//      the true direction of flow, so the marker orientation is correct
//      by construction rather than by chance.
//   5. Every template uses its own unique id prefix for gradients, clip
//      paths and markers, so several diagrams can live in the same HTML
//      document without id collisions.
//
// Available templates (id — subject):
//   human_heart      — heart, internal cross-section, blood flow, valves
//   human_eye        — eye, horizontal cross-section
//   human_lungs      — respiratory system: trachea, bronchi, lobes, diaphragm
//   human_brain      — brain, lateral view: lobes, sulci, cerebellum, stem
//   human_kidney     — kidney, frontal section: cortex, pyramids, pelvis
//   human_digestive  — digestive system, anterior view
//   human_tooth      — tooth, longitudinal section
//
// See buildSharedRules() in app.js for how the AI is told to defer to
// this library instead of hand-drawing these specific subjects.
// ========================================================================

const DIAGRAM_TEMPLATES = {
  human_heart: {
    id: 'human_heart',
    label: 'Human heart (internal cross-section, labeled, with blood flow)',
    keywords: [
      'heart', 'human heart', 'cardiac', 'heart anatomy', 'heart diagram',
      'heart cross section', 'heart cross-section', 'chambers of the heart',
      'হার্ট', 'হৃদপিণ্ড', 'হৃৎপিণ্ড', 'হৃদযন্ত্র', 'হৃৎযন্ত্র'
    ],
    render: renderHumanHeartDiagram
  },
  human_eye: {
    id: 'human_eye',
    label: 'Human eye (horizontal cross-section, labeled)',
    keywords: [
      'eye', 'human eye', 'eye anatomy', 'eye diagram', 'eyeball',
      'structure of the eye', 'parts of the eye', 'retina', 'cornea',
      'চোখ', 'চক্ষু', 'চক্ষুগোলক', 'চোখের গঠন'
    ],
    render: renderHumanEyeDiagram
  },
  human_lungs: {
    id: 'human_lungs',
    label: 'Human lungs / respiratory system (anterior view, labeled)',
    keywords: [
      'lungs', 'human lungs', 'lung', 'lung anatomy', 'respiratory system',
      'human respiratory system', 'trachea and bronchi', 'breathing system',
      'ফুসফুস', 'শ্বসনতন্ত্র', 'শ্বাসতন্ত্র', 'শ্বসনতন্ত্রের চিত্র'
    ],
    render: renderHumanLungsDiagram
  },
  human_brain: {
    id: 'human_brain',
    label: 'Human brain (lateral view: lobes, cerebellum, brain stem, labeled)',
    keywords: [
      'brain', 'human brain', 'brain anatomy', 'brain diagram', 'lobes of the brain',
      'cerebrum', 'cerebellum', 'parts of the brain',
      'মস্তিষ্ক', 'মগজ', 'মস্তিষ্কের গঠন', 'মানব মস্তিষ্ক'
    ],
    render: renderHumanBrainDiagram
  },
  human_kidney: {
    id: 'human_kidney',
    label: 'Human kidney (frontal section: cortex, medulla, pelvis, labeled)',
    keywords: [
      'kidney', 'human kidney', 'kidney anatomy', 'kidney diagram', 'renal',
      'excretory system', 'structure of the kidney', 'urinary system',
      'বৃক্ক', 'কিডনি', 'বৃক্কের গঠন', 'রেচনতন্ত্র'
    ],
    render: renderHumanKidneyDiagram
  },
  human_digestive: {
    id: 'human_digestive',
    label: 'Human digestive system (anterior view, labeled)',
    keywords: [
      'digestive system', 'human digestive system', 'digestive tract', 'alimentary canal',
      'stomach and intestines', 'gastrointestinal tract', 'gi tract', 'digestion diagram',
      'পরিপাকতন্ত্র', 'পাচনতন্ত্র', 'পরিপাক তন্ত্র', 'খাদ্যনালি'
    ],
    render: renderHumanDigestiveDiagram
  },
  human_tooth: {
    id: 'human_tooth',
    label: 'Human tooth (longitudinal section, labeled)',
    keywords: [
      'tooth', 'teeth', 'human tooth', 'tooth anatomy', 'tooth diagram',
      'structure of a tooth', 'molar', 'parts of a tooth',
      'দাঁত', 'দন্ত', 'দাঁতের গঠন', 'দাঁতের চিত্র'
    ],
    render: renderHumanToothDiagram
  }
  // Add more well-known subjects here over time (plant cell, animal cell,
  // water cycle, ear, skeleton, DNA double helix, ...) following the same
  // { id, label, keywords, render() } shape. Each render() function must
  // return one self-contained <svg ...>...</svg> string with no external
  // assets, matching the technical rules in app.js section 3.
};

// ===== PROMPT-FACING CATALOG STRING =====
function getDiagramTemplateCatalogForPrompt() {
  try {
    return Object.values(DIAGRAM_TEMPLATES)
      .map(t => `${t.id} — matches requests like: ${t.keywords.slice(0, 5).join(', ')}`)
      .join('\n      ');
  } catch (e) {
    return '';
  }
}

// ===== PLACEHOLDER SUBSTITUTION (DISABLED BY PRODUCT DECISION) =====
// Diagrams are permanently disabled across the app (never used in PDF/Word
// documents; replaced with a described image placeholder in Slides — see
// slide-studio.js's IMAGE_PLACEHOLDER mechanism). buildSharedRules() no
// longer tells the AI to emit <!--DIAGRAM_TEMPLATE:id--> at all, but this
// function stays as a defense-in-depth no-op: if that comment ever leaks
// through anyway (stale cached content, a hand-typed request, etc.), it is
// simply stripped out — never rendered as an actual diagram.
function injectDiagramTemplates(html) {
  if (!html || typeof html !== 'string' || html.indexOf('DIAGRAM_TEMPLATE:') === -1) return html;
  return html.replace(/<!--\s*DIAGRAM_TEMPLATE:([a-zA-Z0-9_]+)\s*-->/g, '');
}

// ========================================================================
// SHARED HELPERS
// ========================================================================

function _dlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Wraps artwork in the standard <svg> shell used by every template.
function _dlSvg(w, h, defs, body) {
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" font-family="Arial, Helvetica, sans-serif">
  <defs>${defs || ''}</defs>
${body}
</svg>`;
}

// Places a column of labelled boxes with leader lines.
//   items: [{ text, tx, ty, color? }]  — tx,ty = exact point the leader hits
//   side : 'left'  -> boxes are right-aligned to o.edge
//          'right' -> boxes are left-aligned to o.edge
//   o    : { edge, top?, bottom?, font?, boxH?, gap? }
// Boxes are stacked in order of target height (ty) and pushed apart so they
// never overlap; because order follows ty, leader lines do not cross.
function _dlLabelColumn(items, side, o) {
  const font = o.font || 13, boxH = o.boxH || 28, gap = o.gap || 8;
  const top = o.top == null ? 8 : o.top, bottom = o.bottom || 712;
  const widths = items.map(it => Math.round(it.text.length * font * 0.6 + 22));
  const order = items.map((it, i) => i).sort((a, b) => items[a].ty - items[b].ty);
  const ys = new Array(items.length);
  let prev = top - boxH - gap;
  order.forEach(function (i) {
    const y = Math.max(items[i].ty - boxH / 2, prev + boxH + gap);
    ys[i] = y; prev = y;
  });
  let limit = bottom - boxH;
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (ys[i] > limit) ys[i] = limit;
    limit = ys[i] - boxH - gap;
  }
  return items.map(function (it, i) {
    const w = widths[i], y = ys[i];
    const bx = side === 'left' ? o.edge - w : o.edge;
    const ax = side === 'left' ? bx + w : bx, ay = y + boxH / 2;
    const c = it.color || '#1f2937';
    return `<g>
    <line x1="${ax}" y1="${ay}" x2="${it.tx}" y2="${it.ty}" stroke="#ffffff" stroke-width="4" stroke-opacity="0.8" stroke-linecap="round"/>
    <line x1="${ax}" y1="${ay}" x2="${it.tx}" y2="${it.ty}" stroke="#475569" stroke-width="1.4"/>
    <circle cx="${it.tx}" cy="${it.ty}" r="4.2" fill="${c}" stroke="#ffffff" stroke-width="1.5"/>
    <rect x="${bx}" y="${y}" width="${w}" height="${boxH}" rx="7" fill="#ffffff" stroke="${c}" stroke-width="1.6"/>
    <text x="${bx + w / 2}" y="${y + boxH / 2 + font * 0.36}" text-anchor="middle" font-size="${font}" font-weight="600" fill="${c}">${_dlEsc(it.text)}</text>
  </g>`;
  }).join('\n  ');
}

// Small colour-key strip, e.g. _dlLegend(330, 700, [['#5b93d3','Deoxygenated'], ...])
function _dlLegend(x, y, entries) {
  let cx = x;
  return entries.map(function (e) {
    const w = e[1].length * 7.6 + 34;
    const g = `<g><rect x="${cx}" y="${y - 11}" width="16" height="16" rx="4" fill="${e[0]}" stroke="#334155" stroke-width="1"/>
    <text x="${cx + 23}" y="${y + 2}" font-size="13" fill="#334155">${_dlEsc(e[1])}</text></g>`;
    cx += w + 14;
    return g;
  }).join('\n  ');
}

// Smooth wavy line made from quadratic curves (used for gyri/folds/coils).
function _dlWave(x, y, segLen, amp, count) {
  let d = `M ${x},${y} q ${segLen / 2},${-amp} ${segLen},0`;
  for (let i = 1; i < count; i++) d += ` t ${segLen},0`;
  return d;
}

// Nearest intersection distance of a ray with a closed polygon (list of [x,y]).
function _dlRayHit(px, py, ang, poly) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - px) * ey - (a[1] - py) * ex) / den;
    const u = ((a[0] - px) * dy - (a[1] - py) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

// Builds a single smooth closed (or open) curve through a list of anchor
// points using Catmull-Rom-to-Bezier conversion. Used for every organic
// organ silhouette/chamber in this file so contours are guaranteed smooth
// and self-consistent instead of hand-guessed control points that can
// self-intersect or pinch.
function _dlSmoothPath(points, closed) {
  const pts = points;
  const n = pts.length;
  const get = (i) => pts[(i % n + n) % n];
  let d = `M ${pts[0][0]},${pts[0][1]} `;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0]},${p2[1]} `;
  }
  return d + (closed ? 'Z' : '');
}

// ========================================================================
// TEMPLATE: HUMAN HEART
// ========================================================================
function renderHumanHeartDiagram() {
  const W = 860, H = 720;
  const outerPts = [
    [330,110], [382,78], [300,62], [225,85], [178,148], [148,225], [128,320],
    [138,420], [178,510], [250,575], [330,625], [410,665], [485,698],
    [545,655], [590,600], [605,530], [635,440], [648,340], [635,235],
    [598,155], [560,95], [495,68], [428,82]
  ];
  const outer = _dlSmoothPath(outerPts, true);

  const defs = `
    <marker id="hArrB" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2f6db0"/></marker>
    <marker id="hArrR" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#b3222c"/></marker>
    <linearGradient id="hMyo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8a2430"/><stop offset="100%" stop-color="#661a22"/>
    </linearGradient>`;

  // Chambers: inset shapes, built the same smoothed-curve way for clean
  // rounded contours. RA/RV on image-left (deoxygenated, blue); LA/LV on
  // image-right (oxygenated, red) — LV alone reaches down to the apex.
  const RA = _dlSmoothPath([[248,110],[290,100],[320,130],[325,175],[300,215],[255,225],[215,200],[200,155],[212,120]], true);
  const RV = _dlSmoothPath([[190,255],[250,238],[310,255],[335,320],[340,420],[320,500],[270,555],[220,520],[185,440],[170,340]], true);
  const LA = _dlSmoothPath([[560,95],[605,90],[625,130],[615,175],[575,195],[535,175],[520,135],[535,105]], true);
  const LV = _dlSmoothPath([[430,250],[490,232],[555,250],[585,320],[590,420],[565,510],[520,590],[475,650],[440,600],[418,500],[412,380],[418,300]], true);

  const septum = `M 372,270 C 390,340 396,420 388,495 C 382,545 400,590 435,625`;

  return _dlSvg(W, H, defs, `
  <path d="${outer}" fill="url(#hMyo)" stroke="#4a0f18" stroke-width="3"/>

  <path d="${RA}" fill="#cfe3f7" stroke="#5b87b8" stroke-width="2"/>
  <path d="${RV}" fill="#7fa8d9" stroke="#3f6fb0" stroke-width="2"/>
  <path d="${LA}" fill="#f7d9d9" stroke="#c98080" stroke-width="2"/>
  <path d="${LV}" fill="#d97f7f" stroke="#a5453f" stroke-width="2"/>
  <path d="${septum}" fill="none" stroke="#5c1420" stroke-width="5" stroke-linecap="round" opacity="0.5"/>

  <!-- Tricuspid valve: sits exactly on the RA/RV junction -->
  <ellipse cx="270" cy="235" rx="42" ry="9" fill="none" stroke="#d19a2a" stroke-width="3"/>
  <path d="M 242,235 L 270,269 L 298,235" fill="none" stroke="#d19a2a" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Mitral (bicuspid) valve: sits exactly on the LA/LV junction -->
  <ellipse cx="525" cy="222" rx="40" ry="9" fill="none" stroke="#d19a2a" stroke-width="3"/>
  <path d="M 498,222 L 525,255 L 552,222" fill="none" stroke="#d19a2a" stroke-width="2.5" stroke-linecap="round"/>

  <!-- Superior vena cava -> right atrium (flow: down, into RA top) -->
  <path d="M 268,15 C 262,55 258,90 255,118" fill="none" stroke="#3f6fb0" stroke-width="26" stroke-linecap="round" marker-end="url(#hArrB)"/>
  <!-- Inferior vena cava -> right atrium (flow: up, into RA bottom) -->
  <path d="M 165,700 C 138,610 128,510 140,440 C 148,390 165,325 200,290" fill="none" stroke="#3f6fb0" stroke-width="24" stroke-linecap="round" marker-end="url(#hArrB)"/>

  <!-- Aorta: left ventricle -> ascending -> arch (curves toward image-left,
       over the pulmonary trunk) -> branches + descending. Drawn BEHIND the
       pulmonary artery so the PA visibly crosses in front of it. -->
  <path d="M 480,235 C 470,195 464,155 466,118" fill="none" stroke="#b3222c" stroke-width="22" stroke-linecap="round"/>
  <path d="M 466,118 C 455,80 420,54 372,48 C 342,45 314,50 290,64" fill="none" stroke="#b3222c" stroke-width="20" stroke-linecap="round"/>
  <path d="M 298,60 C 282,44 270,29 262,16" fill="none" stroke="#b3222c" stroke-width="10" stroke-linecap="round" marker-end="url(#hArrR)"/>
  <path d="M 262,66 C 242,50 227,34 216,20" fill="none" stroke="#b3222c" stroke-width="10" stroke-linecap="round" marker-end="url(#hArrR)"/>
  <path d="M 290,64 C 252,78 222,106 210,146" fill="none" stroke="#b3222c" stroke-width="15" stroke-linecap="round" marker-end="url(#hArrR)"/>
  <!-- Descending aorta: continues directly off the arch (same path, no
       gap) down through the middle of the heart to exit at the bottom. -->
  <path d="M 372,48 C 364,92 356,140 362,190 C 368,260 372,330 375,400 C 378,470 382,540 388,610 C 391,645 395,670 398,695" fill="none" stroke="#b3222c" stroke-width="17" stroke-linecap="round" marker-end="url(#hArrR)"/>

  <!-- Pulmonary artery: right ventricle -> rises centrally -> bifurcates
       to left & right lungs (crosses in front of the aorta above). -->
  <path d="M 335,245 C 340,200 345,160 353,125" fill="none" stroke="#3f6fb0" stroke-width="20" stroke-linecap="round"/>
  <path d="M 355,119 C 325,104 285,97 250,100" fill="none" stroke="#3f6fb0" stroke-width="16" stroke-linecap="round" marker-end="url(#hArrB)"/>
  <path d="M 355,119 C 405,106 462,104 505,114" fill="none" stroke="#3f6fb0" stroke-width="16" stroke-linecap="round" marker-end="url(#hArrB)"/>

  <!-- Pulmonary veins: lungs -> left atrium (flow: into LA) -->
  <path d="M 655,148 C 635,148 615,152 602,164" fill="none" stroke="#d98a8a" stroke-width="14" stroke-linecap="round" marker-end="url(#hArrR)"/>
  <path d="M 658,202 C 636,200 614,202 598,214" fill="none" stroke="#d98a8a" stroke-width="14" stroke-linecap="round" marker-end="url(#hArrR)"/>

  ${_dlLabelColumn([
    { text: 'Superior Vena Cava', tx: 261, ty: 55, color: '#204a80' },
    { text: 'Right Atrium', tx: 225, ty: 155, color: '#204a80' },
    { text: 'Tricuspid Valve', tx: 245, ty: 235, color: '#8a6212' },
    { text: 'Right Ventricle', tx: 200, ty: 400, color: '#204a80' },
    { text: 'Inferior Vena Cava', tx: 150, ty: 560, color: '#204a80' }
  ], 'left', { edge: 168, top: 20, bottom: 690, boxH: 30 })}

  ${_dlLabelColumn([
    { text: 'Aortic Arch', tx: 330, ty: 48, color: '#b3222c' },
    { text: 'Pulmonary Artery', tx: 430, ty: 108, color: '#204a80' },
    { text: 'Pulmonary Veins', tx: 628, ty: 172, color: '#b3222c' },
    { text: 'Left Atrium', tx: 598, ty: 110, color: '#b3222c' },
    { text: 'Mitral (Bicuspid) Valve', tx: 547, ty: 222, color: '#8a6212' },
    { text: 'Left Ventricle', tx: 570, ty: 420, color: '#b3222c' },
    { text: 'Interventricular Septum', tx: 392, ty: 560, color: '#4b5563' },
    { text: 'Descending Aorta', tx: 400, ty: 670, color: '#b3222c' }
  ], 'right', { edge: 660, top: 15, bottom: 700, boxH: 30 })}

  ${_dlLegend(300, 20, [['#5b87b8','Deoxygenated blood'], ['#c9666b','Oxygenated blood']])}
`);
}

// ========================================================================
// TEMPLATE: HUMAN EYE
// ========================================================================
function renderHumanEyeDiagram() {
  const W = 900, H = 640;
  const defs = `
    <radialGradient id="eLens" cx="35%" cy="45%" r="70%">
      <stop offset="0%" stop-color="#eaf6ff"/><stop offset="100%" stop-color="#bfe3f7"/>
    </radialGradient>
    <radialGradient id="eVitreous" cx="40%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#eaf4ff"/><stop offset="100%" stop-color="#cfe6f9"/>
    </radialGradient>`;

  // Outer globe: sclera (white), roughly circular but slightly elongated,
  // with a distinct corneal bulge at the front (left) — the cornea is
  // drawn as an outward bulge continuous with the sclera, not a separate
  // floating disc.
  const cx = 470, cy = 320, r = 235;
  const globe = `M ${cx-r},${cy}
    C ${cx-r},${cy-r*0.62} ${cx-r*0.62},${cy-r} ${cx},${cy-r}
    C ${cx+r*0.66},${cy-r} ${cx+r},${cy-r*0.55} ${cx+r},${cy}
    C ${cx+r},${cy+r*0.55} ${cx+r*0.66},${cy+r} ${cx},${cy+r}
    C ${cx-r*0.62},${cy+r} ${cx-r},${cy+r*0.62} ${cx-r},${cy} Z`;
  // Corneal bulge on the front (left) pole, blended into the sclera outline.
  const corneaFrontX = cx - r;
  const cornea = `M ${corneaFrontX},${cy-95} C ${corneaFrontX-58},${cy-70} ${corneaFrontX-58},${cy+70} ${corneaFrontX},${cy+95}`;

  const irisX = corneaFrontX + 46;
  const lensX = irisX + 55;

  return _dlSvg(W, H, defs, `
  <!-- Sclera (outer white coat) + cornea bulge as one continuous outline -->
  <path d="${globe}" fill="#f5f7f2" stroke="#94a3b8" stroke-width="3"/>
  <path d="${cornea}" fill="#eaf7ff" fill-opacity="0.55" stroke="#5b8fae" stroke-width="3"/>

  <!-- Choroid + retina layered just inside the sclera, thickest at the back -->
  <path d="M ${cx-r+10},${cy-r*0.60+6}
    C ${cx-r*0.60+6},${cy-r+10} ${cx*0.02+cx*0.6},${cy-r+8} ${cx+4},${cy-r+8}
    C ${cx+r*0.63-6},${cy-r+10} ${cx+r-14},${cy-r*0.52+8} ${cx+r-14},${cy}
    C ${cx+r-14},${cy+r*0.52-8} ${cx+r*0.63-6},${cy+r-10} ${cx+4},${cy+r-8}
    C ${cx*0.02+cx*0.6},${cy+r-8} ${cx-r*0.60+6},${cy+r-10} ${cx-r+10},${cy+r*0.60-6}"
    fill="none" stroke="#c96a4a" stroke-width="10" opacity="0.6"/>
  <path d="M ${cx-r+22},${cy-r*0.55+10}
    C ${cx-r*0.55+14},${cy-r+22} ${cx-6},${cy-r+18} ${cx+2},${cy-r+18}
    C ${cx+r*0.58-10},${cy-r+22} ${cx+r-28},${cy-r*0.48+16} ${cx+r-28},${cy}
    C ${cx+r-28},${cy+r*0.48-16} ${cx+r*0.58-10},${cy+r-22} ${cx+2},${cy+r-18}
    C ${cx-6},${cy+r-18} ${cx-r*0.55+14},${cy+r-22} ${cx-r+22},${cy+r*0.55-10}"
    fill="none" stroke="#8b5a2b" stroke-width="7" opacity="0.55"/>

  <!-- Vitreous humor fills the posterior chamber -->
  <path d="M ${irisX+30},${cy-150} C ${cx+120},${cy-190} ${cx+r-55},${cy-140} ${cx+r-40},${cy}
    C ${cx+r-55},${cy+140} ${cx+120},${cy+190} ${irisX+30},${cy+150}
    C ${irisX+90},${cy+70} ${irisX+90},${cy-70} ${irisX+30},${cy-150} Z" fill="url(#eVitreous)" opacity="0.7"/>

  <!-- Iris (colored ring) with central pupil opening -->
  <path d="M ${irisX},${cy-105} C ${irisX-20},${cy-60} ${irisX-20},${cy+60} ${irisX},${cy+105}"
        fill="none" stroke="#5b8140" stroke-width="26" stroke-linecap="round"/>
  <ellipse cx="${irisX-6}" cy="${cy}" rx="14" ry="60" fill="#1b1b1b"/>

  <!-- Lens: biconvex, directly behind the iris/pupil (overlapping so the
       zonule fibers visibly bridge the two). -->
  <path d="M ${lensX},${cy-78} C ${lensX+34},${cy-55} ${lensX+34},${cy+55} ${lensX},${cy+78}
            C ${lensX-34},${cy+55} ${lensX-34},${cy-55} ${lensX},${cy-78} Z" fill="url(#eLens)" stroke="#7fb0cf" stroke-width="2.5"/>
  <path d="M ${irisX+2},${cy-100} L ${lensX-24},${cy-70}" stroke="#94a37a" stroke-width="2"/>
  <path d="M ${irisX+2},${cy+100} L ${lensX-24},${cy+70}" stroke="#94a37a" stroke-width="2"/>

  <!-- Optic nerve: exits the back of the globe, overlapping the sclera -->
  <path d="M ${cx+r-30},${cy-8} C ${cx+r+45},${cy-35} ${cx+r+100},${cy-48} ${cx+r+160},${cy-60}" fill="none" stroke="#e8d9b0" stroke-width="30" stroke-linecap="round"/>
  <path d="M ${cx+r-30},${cy-8} C ${cx+r+45},${cy-35} ${cx+r+100},${cy-48} ${cx+r+160},${cy-60}" fill="none" stroke="#c9b98a" stroke-width="30" stroke-linecap="round" opacity="0.4"/>

  <!-- Fovea marker on the retina, directly opposite the pupil axis -->
  <circle cx="${cx+r-40}" cy="${cy}" r="7" fill="#a13a2a"/>

  ${_dlLabelColumn([
    { text: 'Cornea', tx: corneaFrontX-30, ty: cy-90, color: '#3f6f8f' },
    { text: 'Iris', tx: irisX-2, ty: cy-98, color: '#4a6b34' },
    { text: 'Pupil', tx: irisX-8, ty: cy-40, color: '#1b1b1b' },
    { text: 'Lens', tx: lensX, ty: cy-60, color: '#3f6f8f' },
    { text: 'Ciliary Muscle', tx: irisX+10, ty: cy+102, color: '#4a6b34' }
  ], 'left', { edge: 190, top: 20, bottom: 600, boxH: 30 })}

  ${_dlLabelColumn([
    { text: 'Vitreous Humor', tx: cx+60, ty: cy-90, color: '#3f6f8f' },
    { text: 'Sclera', tx: cx+10, ty: cy-r+18, color: '#64748b' },
    { text: 'Choroid', tx: cx+10, ty: cy-r+40, color: '#8b5a2b' },
    { text: 'Retina', tx: cx+r-28, ty: cy-70, color: '#a13a2a' },
    { text: 'Fovea', tx: cx+r-40, ty: cy+6, color: '#a13a2a' },
    { text: 'Optic Nerve', tx: cx+r+130, ty: cy-52, color: '#8a6212' }
  ], 'right', { edge: 720, top: 15, bottom: 610, boxH: 30 })}
`);
}

// ========================================================================
// TEMPLATE: HUMAN LUNGS / RESPIRATORY SYSTEM
// ========================================================================
function renderHumanLungsDiagram() {
  const W = 860, H = 700;
  const defs = `
    <linearGradient id="lgLung" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f3b3ae"/><stop offset="100%" stop-color="#d98186"/>
    </linearGradient>`;

  // Right lung (image-left): 3 lobes, shorter (liver sits beneath it).
  const rightLung = _dlSmoothPath([
    [355,180],[330,165],[295,168],[262,190],[232,230],[212,285],[200,345],
    [198,410],[208,470],[232,515],[268,540],[310,548],[345,530],
    [362,480],[368,410],[366,320],[362,240]
  ], true);
  // Left lung (image-right): 2 lobes, longer, with a cardiac notch cut
  // into its lower-medial border where the heart sits.
  const leftLung = _dlSmoothPath([
    [420,175],[450,162],[488,168],[520,195],[545,240],[558,300],
    [562,370],[558,440],[542,500],[512,540],[478,558],
    [452,540],[460,490],[440,455],[418,470],[410,410],
    [406,330],[408,250],[414,205]
  ], true);

  const trachea = `M 400,40 C 398,75 396,108 394,138`;
  const rBronchus = `M 394,138 C 375,155 358,168 344,182`;
  const lBronchus = `M 394,138 C 412,158 428,172 440,188`;

  return _dlSvg(W, H, defs, `
  <!-- Rib-cage guide (light, decorative) -->
  <path d="M 190,220 C 300,195 500,195 610,220" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 5" opacity="0.6"/>

  <path d="${rightLung}" fill="url(#lgLung)" stroke="#a5525a" stroke-width="2.5"/>
  <path d="${leftLung}" fill="url(#lgLung)" stroke="#a5525a" stroke-width="2.5"/>

  <!-- Lobe division lines, drawn ON TOP of each lung so they read as
       internal fissures rather than separate glued-on pieces. -->
  <path d="M 205,300 C 250,290 300,292 340,305" fill="none" stroke="#8a3f46" stroke-width="2" opacity="0.6"/>
  <path d="M 210,430 C 255,420 305,418 350,428" fill="none" stroke="#8a3f46" stroke-width="2" opacity="0.6"/>
  <path d="M 415,370 C 460,362 505,364 545,378" fill="none" stroke="#8a3f46" stroke-width="2" opacity="0.6"/>

  <!-- Cardiac notch: a visible concave bite out of the left lung's lower
       edge where the heart normally sits. -->
  <path d="M 460,490 C 448,470 440,455 418,470" fill="none" stroke="#a5525a" stroke-width="2.5"/>

  <!-- Trachea + primary bronchi: one continuous branching tube -->
  <path d="${trachea}" fill="none" stroke="#e8dfc8" stroke-width="26" stroke-linecap="round"/>
  <path d="${trachea}" fill="none" stroke="#c7bd9e" stroke-width="26" stroke-linecap="round" opacity="0.35"/>
  <!-- Tracheal cartilage rings -->
  ${[55,68,81,94,107,120].map(y=>`<line x1="386" y1="${y}" x2="410" y2="${y}" stroke="#a99b6d" stroke-width="3" opacity="0.6"/>`).join('\n  ')}
  <path d="${rBronchus}" fill="none" stroke="#e8dfc8" stroke-width="20" stroke-linecap="round"/>
  <path d="${lBronchus}" fill="none" stroke="#e8dfc8" stroke-width="20" stroke-linecap="round"/>
  <!-- Secondary bronchi fanning into each lung -->
  <path d="M 344,182 C 320,205 298,235 280,270" fill="none" stroke="#e8dfc8" stroke-width="10" stroke-linecap="round"/>
  <path d="M 344,182 C 330,215 320,255 312,300" fill="none" stroke="#e8dfc8" stroke-width="8" stroke-linecap="round"/>
  <path d="M 344,182 C 335,230 335,290 340,350" fill="none" stroke="#e8dfc8" stroke-width="8" stroke-linecap="round"/>
  <path d="M 440,188 C 460,215 478,248 490,285" fill="none" stroke="#e8dfc8" stroke-width="11" stroke-linecap="round"/>
  <path d="M 440,188 C 445,235 448,290 448,345" fill="none" stroke="#e8dfc8" stroke-width="10" stroke-linecap="round"/>

  <!-- Diaphragm: a continuous dome closing off the bottom of the thorax,
       drawn overlapping the base of both lungs. -->
  <path d="M 140,555 C 220,595 320,608 400,600 C 460,594 500,570 545,595 C 590,615 630,600 660,570"
        fill="none" stroke="#c9722f" stroke-width="10" stroke-linecap="round"/>

  ${_dlLabelColumn([
    { text: 'Trachea', tx: 398, ty: 80, color: '#8a6212' },
    { text: 'Right Bronchus', tx: 358, ty: 170, color: '#8a6212' },
    { text: 'Right Lung (3 lobes)', tx: 250, ty: 250, color: '#a5525a' },
    { text: 'Bronchioles', tx: 300, ty: 320, color: '#8a6212' }
  ], 'left', { edge: 175, top: 30, bottom: 400, boxH: 30 })}

  ${_dlLabelColumn([
    { text: 'Left Bronchus', tx: 430, ty: 178, color: '#8a6212' },
    { text: 'Left Lung (2 lobes)', tx: 520, ty: 250, color: '#a5525a' },
    { text: 'Cardiac Notch', tx: 435, ty: 480, color: '#a5525a' },
    { text: 'Diaphragm', tx: 500, ty: 588, color: '#c9722f' }
  ], 'right', { edge: 640, top: 140, bottom: 620, boxH: 30 })}
`);
}

// ========================================================================
// TEMPLATE: HUMAN BRAIN
// ========================================================================
function renderHumanBrainDiagram() {
  const W = 860, H = 620;
  const defs = `
    <linearGradient id="brCortex" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e8b8bd"/><stop offset="100%" stop-color="#d99aa2"/>
    </linearGradient>`;

  // Cerebrum outline (facing left): rounded frontal pole (left), longer
  // gently-tapering occipital pole (right), flatter inferior border.
  const cerebrum = _dlSmoothPath([
    [175,270],[185,220],[225,178],[280,155],[330,148],
    [360,120],[410,105],[470,102],[520,112],
    [570,135],[615,170],[645,215],[665,270],
    [672,330],[665,385],[635,425],
    [590,435],[560,455],[520,468],[470,472],
    [415,468],[365,455],[320,435],
    [270,420],[225,395],[195,355],[178,315]
  ], true);

  // Cerebellum: smaller rounded, folded structure tucked under the
  // occipital lobe, overlapping the cerebrum outline so it reads as
  // sitting beneath it rather than floating separately.
  const cerebellum = _dlSmoothPath([
    [545,400],[580,388],[615,395],[638,418],[645,448],
    [632,475],[600,488],[565,485],[540,465],[530,435]
  ], true);

  // Brain stem: short tube descending from the base of the cerebrum,
  // overlapping both the cerebrum and cerebellum at its top.
  const stem = `M 500,455 C 495,478 492,502 495,528 C 497,548 505,562 520,572`;

  return _dlSvg(W, H, defs, `
  <path d="${cerebrum}" fill="url(#brCortex)" stroke="#a15a63" stroke-width="3"/>

  <!-- Sulci/gyri texture (surface folds), kept within the outline bounds -->
  ${[ [210,235,42,10,4],[195,280,46,11,4],[210,330,48,10,4],[240,375,50,9,4],
      [300,190,44,9,5],[290,410,50,9,4],[380,160,46,8,5],[420,430,52,9,4],
      [480,150,42,8,4],[500,440,44,8,4] ]
    .map(a=>`<path d="${_dlWave(a[0],a[1],a[2],a[3],a[4])}" fill="none" stroke="#a15a63" stroke-width="2" opacity="0.45"/>`).join('\n  ')}

  <!-- Lateral sulcus: the deep fold separating frontal/parietal from
       temporal lobe, drawn as a clear diagonal groove. -->
  <path d="M 300,270 C 350,290 410,300 460,298" fill="none" stroke="#8a3f46" stroke-width="4" stroke-linecap="round" opacity="0.65"/>
  <!-- Central sulcus: separates frontal from parietal lobe. -->
  <path d="M 400,115 C 392,170 388,225 392,270" fill="none" stroke="#8a3f46" stroke-width="3" stroke-linecap="round" opacity="0.55"/>
  <!-- Parieto-occipital boundary (approximate, dashed since not a true fissure at surface) -->
  <path d="M 560,140 C 555,220 555,320 560,410" fill="none" stroke="#8a3f46" stroke-width="2" stroke-dasharray="5 5" opacity="0.5"/>

  <!-- Cerebellum: distinctive tight, layered folia texture -->
  <path d="${cerebellum}" fill="#cf8a92" stroke="#a15a63" stroke-width="2.5"/>
  ${[560,570,580,590,600,610].map(x=>`<path d="M ${x},400 C ${x-6},420 ${x-6},450 ${x},470" fill="none" stroke="#a15a63" stroke-width="2" opacity="0.55"/>`).join('\n  ')}

  <!-- Brain stem -->
  <path d="${stem}" fill="none" stroke="#d9c08a" stroke-width="26" stroke-linecap="round"/>
  <path d="${stem}" fill="none" stroke="#b89b5f" stroke-width="26" stroke-linecap="round" opacity="0.3"/>

  ${_dlLabelColumn([
    { text: 'Frontal Lobe', tx: 300, ty: 190, color: '#a15a63' },
    { text: 'Temporal Lobe', tx: 330, ty: 400, color: '#a15a63' },
    { text: 'Brain Stem', tx: 505, ty: 500, color: '#8a7a3a' }
  ], 'left', { edge: 195, top: 120, bottom: 540, boxH: 30 })}

  ${_dlLabelColumn([
    { text: 'Parietal Lobe', tx: 490, ty: 135, color: '#a15a63' },
    { text: 'Occipital Lobe', tx: 630, ty: 240, color: '#a15a63' },
    { text: 'Cerebellum', tx: 610, ty: 440, color: '#a15a63' }
  ], 'right', { edge: 690, top: 100, bottom: 470, boxH: 30 })}
`);
}

// ========================================================================
// TEMPLATE: HUMAN KIDNEY
// ========================================================================
function renderHumanKidneyDiagram() {
  const W = 860, H = 640;
  const defs = `
    <linearGradient id="kCortex" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c97a52"/><stop offset="100%" stop-color="#a85f3d"/>
    </linearGradient>`;

  // Bean-shaped outline: convex lateral border (left), concave medial
  // border (right, the hilum notch).
  const outline = _dlSmoothPath([
    [230,120],[300,90],[380,85],[440,110],
    [472,155],[484,205],[460,240],[412,265],[460,300],
    [484,335],[476,385],[448,430],
    [440,480],[400,520],[330,545],[260,530],
    [210,490],[180,430],[168,350],[168,270],[180,190]
  ], true);

  // Cortex is the outer shell; medulla sits just inside it. We render the
  // cortex as the full bean, then lay pyramids + pelvis on top so the
  // remaining visible cortex reads as the outer band by construction.
  const pyramids = [
    { cx: 330, cy: 150, ang: -80 },
    { cx: 395, cy: 190, ang: -35 },
    { cx: 420, cy: 260, ang: 0 },
    { cx: 410, cy: 335, ang: 25 },
    { cx: 375, cy: 400, ang: 55 },
    { cx: 300, cy: 440, ang: 95 }
  ];
  function pyramid(p) {
    const a = p.ang * Math.PI / 180;
    const tipX = 300 + Math.cos(a) * 60, tipY = 300 + Math.sin(a) * 90; // apex toward the pelvis (center)
    const baseAx = p.cx + Math.cos(a + 1.4) * 30, baseAy = p.cy + Math.sin(a + 1.4) * 30;
    const baseBx = p.cx + Math.cos(a - 1.4) * 30, baseBy = p.cy + Math.sin(a - 1.4) * 30;
    return `<path d="M ${baseAx},${baseAy} L ${tipX+150},${tipY+40} L ${baseBx},${baseBy} Z" fill="#8a4a2e" stroke="#6f3a24" stroke-width="1.5" opacity="0.9"/>`;
  }

  return _dlSvg(W, H, defs, `
  <path d="${outline}" fill="url(#kCortex)" stroke="#6f3a24" stroke-width="3"/>

  <!-- Renal pelvis: funnel-shaped cavity collecting from the pyramids,
       narrowing into the ureter — drawn overlapping the medial notch. -->
  <path d="M 300,190 C 340,210 365,250 368,300 C 365,350 340,395 300,415
           C 320,360 322,240 300,190 Z" fill="#e8c9a8" stroke="#a5794f" stroke-width="2"/>

  <!-- Medullary pyramids: bases toward the cortex, apices (papillae)
       pointing into the pelvis — correct orientation by construction. -->
  ${[
    [330,150,300,190],[400,185,320,220],[425,255,330,260],
    [412,330,325,310],[378,398,315,360],[305,435,300,400]
  ].map(p=>`<path d="M ${p[0]-26},${p[1]-14} L ${p[2]},${p[3]} L ${p[0]+10},${p[1]+26} Z" fill="#8a4a2e" stroke="#6f3a24" stroke-width="1.5"/>`).join('\n  ')}

  <!-- Renal artery + vein entering at the hilum (the concave notch) -->
  <path d="M 620,255 C 560,258 510,258 478,260" fill="none" stroke="#b3222c" stroke-width="16" stroke-linecap="round"/>
  <path d="M 620,300 C 560,295 512,290 482,282" fill="none" stroke="#3f6fb0" stroke-width="16" stroke-linecap="round"/>
  <!-- Ureter draining the pelvis downward -->
  <path d="M 305,415 C 300,460 296,510 292,560" fill="none" stroke="#c9a15a" stroke-width="14" stroke-linecap="round"/>

  <!-- Cortex label points to the outer band (between outline and pyramid bases) -->
  ${_dlLabelColumn([
    { text: 'Renal Cortex', tx: 210, ty: 170, color: '#7a4023' },
    { text: 'Renal Medulla', tx: 330, ty: 150, color: '#6f3a24' },
    { text: 'Renal Pelvis', tx: 320, ty: 300, color: '#a5794f' },
    { text: 'Ureter', tx: 296, ty: 500, color: '#a5794f' }
  ], 'left', { edge: 195, top: 20, bottom: 560, boxH: 30 })}

  ${_dlLabelColumn([
    { text: 'Renal Artery', tx: 560, ty: 258, color: '#b3222c' },
    { text: 'Renal Vein', tx: 545, ty: 294, color: '#204a80' },
    { text: 'Renal Hilum', tx: 465, ty: 270, color: '#6f3a24' }
  ], 'right', { edge: 640, top: 200, bottom: 400, boxH: 30 })}
`);
}

// ========================================================================
// TEMPLATE: HUMAN DIGESTIVE SYSTEM
// ========================================================================
function renderHumanDigestiveDiagram() {
  const W = 760, H = 780;

  const body = `M 350,20 C 380,20 400,45 400,75 C 400,95 392,110 380,120
    C 430,140 470,190 480,260 C 495,340 495,430 480,520
    C 470,590 460,660 450,745
    L 250,745 C 240,660 230,590 220,520 C 205,430 205,340 220,260
    C 230,190 270,140 320,120 C 308,110 300,95 300,75 C 300,45 320,20 350,20 Z`;

  // Stomach: proper J-shape — fundus (top-left bulge), body curving down,
  // antrum narrowing toward the pylorus (bottom-right), which is where
  // the duodenum picks up, all as one continuous filled outline.
  const stomach = _dlSmoothPath([
    [300,175],[275,190],[262,220],[270,255],
    [295,280],[335,292],[375,288],
    [405,275],[418,255],[410,230],
    [385,205],[350,180],[322,168]
  ], true);

  const esophagus = `M 322,110 C 320,130 318,150 316,172`;
  // Duodenum: short C-shaped curve right after the pylorus.
  const duodenum = `M 405,275 C 425,282 440,298 442,318 C 440,335 425,345 408,345`;
  // Small intestine: a tight zigzag coil, kept fully inside the
  // rectangular colon frame (x 300-430, y 355-590).
  const smallIntestine = `M 408,345
      C 375,352 335,358 320,375 C 310,390 325,402 355,404
      C 385,406 415,412 420,428 C 422,442 400,450 365,450
      C 332,450 305,458 302,475 C 300,490 325,498 360,498
      C 395,498 422,505 424,522 C 425,535 402,542 368,542
      C 335,542 308,550 305,565 C 303,578 322,585 350,586`;

  // Large intestine forms a rectangular frame AROUND the small intestine.
  const cecum = `M 425,590 C 425,608 420,622 408,630`;
  const appendix = `M 412,633 C 415,645 415,656 411,665`;
  const ascending = `M 425,590 C 430,520 432,440 430,365`;
  const transverse = `M 430,365 C 400,340 320,335 275,358`;
  const descending = `M 275,358 C 260,430 258,510 262,580`;
  const sigmoid = `M 262,580 C 260,600 272,612 295,610 C 318,608 328,622 316,635 C 306,646 300,655 300,665`;

  return _dlSvg(W, H, `
    <linearGradient id="dgTube" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#e0a86a"/><stop offset="100%" stop-color="#c98a4a"/>
    </linearGradient>`, `
  <path d="${body}" fill="#f5ede2" stroke="#d9cbb0" stroke-width="2"/>

  <!-- Liver: wedge in the upper-right of the abdomen, overlapping only
       the stomach's upper-right corner (not covering the stomach body). -->
  <path d="M 400,150 C 450,138 500,148 520,178 C 534,202 528,228 500,240
           C 465,254 425,248 405,225 C 393,208 392,172 400,150 Z"
        fill="#8a4a3a" stroke="#6f3a2c" stroke-width="2.5"/>
  <!-- Gallbladder tucked beneath the liver's right edge -->
  <path d="M 495,232 C 506,240 508,254 500,264 C 492,270 481,266 478,254 C 476,244 486,234 495,232 Z"
        fill="#4a7a4a" stroke="#365c36" stroke-width="2"/>
  <!-- Pancreas, lying behind/below the stomach -->
  <path d="M 330,308 C 360,300 392,302 415,315 C 392,326 360,328 335,320 Z"
        fill="#e0b25a" stroke="#b8903f" stroke-width="2"/>

  <!-- Esophagus -->
  <path d="${esophagus}" fill="none" stroke="url(#dgTube)" stroke-width="18" stroke-linecap="round"/>
  <!-- Stomach -->
  <path d="${stomach}" fill="#e0a86a" stroke="#a5713a" stroke-width="3"/>
  <!-- Duodenum -->
  <path d="${duodenum}" fill="none" stroke="#c98a4a" stroke-width="16" stroke-linecap="round"/>
  <!-- Small intestine -->
  <path d="${smallIntestine}" fill="none" stroke="#dba05f" stroke-width="15" stroke-linecap="round"/>
  <!-- Large intestine frame: ascending -> transverse -> descending -> sigmoid -->
  <path d="${ascending}" fill="none" stroke="#b97a3f" stroke-width="22" stroke-linecap="round"/>
  <path d="${transverse}" fill="none" stroke="#b97a3f" stroke-width="22" stroke-linecap="round"/>
  <path d="${descending}" fill="none" stroke="#b97a3f" stroke-width="22" stroke-linecap="round"/>
  <path d="${sigmoid}" fill="none" stroke="#a5713a" stroke-width="18" stroke-linecap="round"/>
  <!-- Cecum + appendix stub -->
  <path d="${cecum}" fill="none" stroke="#c9975a" stroke-width="24" stroke-linecap="round"/>
  <path d="${appendix}" fill="none" stroke="#c9975a" stroke-width="7" stroke-linecap="round"/>

  ${_dlLabelColumn([
    { text: 'Esophagus', tx: 319, ty: 130, color: '#a5713a' },
    { text: 'Liver', tx: 440, ty: 175, color: '#6f3a2c' },
    { text: 'Stomach', tx: 275, ty: 235, color: '#a5713a' },
    { text: 'Gallbladder', tx: 493, ty: 250, color: '#365c36' },
    { text: 'Pancreas', tx: 365, ty: 313, color: '#b8903f' },
    { text: 'Small Intestine', tx: 355, ty: 450, color: '#a5713a' }
  ], 'left', { edge: 150, top: 110, bottom: 470, boxH: 30 })}

  ${_dlLabelColumn([
    { text: 'Duodenum', tx: 435, ty: 320, color: '#a5713a' },
    { text: 'Transverse Colon', tx: 350, ty: 345, color: '#8a5a28' },
    { text: 'Ascending Colon', tx: 428, ty: 470, color: '#8a5a28' },
    { text: 'Descending Colon', tx: 260, ty: 470, color: '#8a5a28' },
    { text: 'Cecum / Appendix', tx: 410, ty: 640, color: '#8a5a28' },
    { text: 'Sigmoid / Rectum', tx: 305, ty: 650, color: '#a5713a' }
  ], 'right', { edge: 560, top: 280, bottom: 660, boxH: 30 })}
`);
}

// ========================================================================
// TEMPLATE: HUMAN TOOTH
// ========================================================================
function renderHumanToothDiagram() {
  const W = 760, H = 700;
  const defs = `
    <linearGradient id="tEnamel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fdfdf8"/><stop offset="100%" stop-color="#eef0e2"/>
    </linearGradient>`;

  // Jaw bone block (context), with the tooth socket cut into it.
  const jaw = `M 140,330 C 140,300 160,280 200,280 L 500,280 C 540,280 560,300 560,330
      L 560,600 C 560,630 540,650 500,650 L 200,650 C 160,650 140,630 140,600 Z`;

  // Whole-tooth outline (enamel/cementum surface): crown bulges above the
  // gumline, tapering to two roots below — one continuous silhouette.
  const wholeTooth = _dlSmoothPath([
    [230,120],[260,90],[310,75],[350,72],[390,75],[430,92],[458,120],
    [468,160],[460,200],[440,225],
    [455,255],[458,320],[452,400],[435,470],[418,510],[402,480],[396,400],[392,330],[380,300],
    [368,330],[364,400],[358,470],[342,510],[326,480],[320,400],[316,330],[304,300],
    [292,225],[270,200],[248,160],[230,140]
  ], true);

  // Gumline: a band drawn across the tooth/jaw junction.
  const gumTop = `M 195,290 C 260,268 440,268 505,290`;
  const gumBottom = `M 195,340 C 260,320 440,320 505,340`;

  // Dentin: inset just beneath the enamel, following the same crown+root
  // contour but pulled inward on every edge.
  const dentin = _dlSmoothPath([
    [248,145],[268,118],[305,105],[350,102],[395,105],[428,120],[448,145],
    [452,175],[440,200],[422,218],
    [432,250],[435,320],[430,395],[416,455],[404,485],[392,455],[388,395],[384,335],[376,308],
    [368,330],[364,395],[358,455],[346,485],[334,455],[330,395],[326,335],[316,308],
    [300,218],[282,200],[264,175],[248,160]
  ], true);

  // Pulp chamber + root canals: the innermost soft-tissue cavity.
  const pulp = `M 320,150 C 320,135 335,128 350,128 C 365,128 380,135 380,150
      C 380,170 372,185 358,190 L 358,300 C 358,340 356,390 352,430
      C 350,445 344,445 342,430 C 338,390 336,340 336,300 L 336,190
      C 322,185 320,170 320,150 Z`;

  return _dlSvg(W, H, defs, `
  <path d="${jaw}" fill="#f2ead8" stroke="#d9cba0" stroke-width="2.5"/>
  <!-- Trabecular bone texture -->
  ${[ [180,470],[210,540],[490,470],[460,540],[200,600],[490,600] ].map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="14" fill="none" stroke="#d9cba0" stroke-width="1.5" opacity="0.6"/>`).join('\n  ')}

  <!-- Periodontal ligament + socket around the roots (drawn first so the
       tooth root sits visibly inside it, overlapping). -->
  <path d="M 300,340 C 280,400 278,470 292,520 C 300,545 315,545 320,520
           C 312,470 310,400 316,345 Z" fill="#e8a0a0" opacity="0.5"/>
  <path d="M 400,340 C 420,400 422,470 408,520 C 400,545 385,545 380,520
           C 388,470 390,400 384,345 Z" fill="#e8a0a0" opacity="0.5"/>

  <path d="${wholeTooth}" fill="url(#tEnamel)" stroke="#c9c9b5" stroke-width="3"/>
  <path d="${dentin}" fill="#f0dcae" stroke="#d8bd7f" stroke-width="2"/>
  <path d="${pulp}" fill="#e8607a" stroke="#b8405a" stroke-width="2"/>

  <!-- Nerve + blood vessels entering the root apex, overlapping the pulp -->
  <path d="M 358,450 C 358,470 358,485 358,495" fill="none" stroke="#e8b0b8" stroke-width="6" stroke-linecap="round"/>

  <!-- Gum tissue drawn on top of the enamel/dentin at the neck of the tooth -->
  <path d="M 190,285 L 510,285 L 510,345 C 440,365 260,365 190,345 Z" fill="#e58a8a" opacity="0.85"/>
  <path d="${gumTop}" fill="none" stroke="#c96a6a" stroke-width="2" opacity="0.7"/>

  ${_dlLabelColumn([
    { text: 'Enamel', tx: 300, ty: 110, color: '#8a8a70' },
    { text: 'Dentin', tx: 280, ty: 175, color: '#a5843f' },
    { text: 'Gum (Gingiva)', tx: 220, ty: 315, color: '#c96a6a' },
    { text: 'Root Canal', tx: 348, ty: 380, color: '#b8405a' }
  ], 'left', { edge: 130, top: 60, bottom: 420, boxH: 30 })}

  ${_dlLabelColumn([
    { text: 'Crown', tx: 420, ty: 100, color: '#8a8a70' },
    { text: 'Pulp Cavity', tx: 370, ty: 155, color: '#b8405a' },
    { text: 'Periodontal Ligament', tx: 400, ty: 420, color: '#c07070' },
    { text: 'Root', tx: 400, ty: 470, color: '#a5843f' },
    { text: 'Jawbone', tx: 520, ty: 550, color: '#a5915f' }
  ], 'right', { edge: 560, top: 60, bottom: 600, boxH: 30 })}
`);
}

// ============================================================
// WINDOW EXPOSURE — Diagram Library
// ============================================================
window.DIAGRAM_TEMPLATES = DIAGRAM_TEMPLATES;
window.injectDiagramTemplates = injectDiagramTemplates;
window.getDiagramTemplateCatalogForPrompt = getDiagramTemplateCatalogForPrompt;