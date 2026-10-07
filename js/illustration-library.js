// ========================================================================
// FLAT ILLUSTRATION LIBRARY — deterministic, code-composed scene SVGs
// ========================================================================
// Same choke-point pattern as diagram-library.js / chart-library.js, but
// for decorative FLAT-DESIGN illustrations (the kind used to decorate a
// slide or a document — a small landscape, a city skyline, a person
// thinking, a person surrounded by plants, a concept icon badge) instead
// of technical diagrams or data charts.
//
// WHY THIS EXISTS: asking an AI (especially a small/free model) to
// hand-draw a full multi-layer flat-illustration scene from scratch in
// one shot routinely produces soft/wobbly paths, mismatched palettes, and
// visibly "off" proportions — the same class of problem chart-library.js
// solves for chart geometry and diagram-library.js solves for anatomy.
// Here the AI only ever supplies: a scene id, a palette name, a shape/
// size, and a couple of small parameters (pose, symbol, count). Every
// coordinate, gradient stop and layered shape is then computed here in
// code, so the result is crisp and visually consistent regardless of
// which model (large or small) requested it.
//
// SHARPNESS: every generated SVG uses shape-rendering="geometricPrecision"
// (crispEdges for rectangular window/building details), rounds every
// coordinate to one decimal, and avoids blur filters entirely — soft
// "glow" effects (sun/moon halo) are done with a radial-gradient circle,
// never a <feGaussianBlur>, so nothing in the artwork is ever rasterized
// or fuzzy at any zoom level.
//
// SHAPE / SIZE: every scene is wrapped in a <svg viewBox="0 0 W H"> with
// no hardcoded pixel width/height (same convention as diagram/chart
// libraries), so surrounding CSS scales it responsively. The wrapper can
// additionally clip the whole composition to "circle", "rounded" or leave
// it as a plain rectangle ("wide"/"square"), so the same scene can be
// dropped into a round badge, a square tile, or a wide slide banner.
//
// Placeholder syntax (see getIllustrationCatalogForPrompt() for the
// exact prompt-facing spec):
//   <!--ILLUSTRATION:scene_id:palette=name|shape=wide|pose=...|symbol=...|count=n-->
// All params are optional key=value pairs separated by "|", matching the
// flat parsing style already used by chart-library.js (no characters that
// collide with living inside an HTML comment).
// ========================================================================

// ===== SMALL MATH / COLOR HELPERS =====
let _ilCounter = 0;
function _ilUid() {
  _ilCounter++;
  return 'il' + Date.now().toString(36).slice(-4) + _ilCounter.toString(36);
}

function _ilR1(n) {
  return Math.round(n * 10) / 10;
}

// Lightens (negative amt) or darkens (positive amt) a #rrggbb color by a
// fraction 0-1. Used only for small internal shading (smile lines, leaf
// veins, gradient shadow stops) — never for anything the document's main
// palette contrast depends on.
function _ilShade(hex, amt) {
  amt = amt == null ? 0.3 : amt;
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return hex;
  const num = parseInt(h, 16);
  if (!Number.isFinite(num)) return hex;
  let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  const f = v => Math.min(255, Math.max(0, Math.round(v * (1 - amt))));
  r = f(r); g = f(g); b = f(b);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ========================================================================
// PALETTES — small, curated flat-design color sets. Each scene picks the
// keys it needs and falls back to sensible defaults if a key is missing,
// so a palette can be reused loosely across scene types.
// ========================================================================
const ILLUSTRATION_PALETTES = {
  sunset_bay: {
    label: 'Warm sunset over water (mountains, birds, reflection)',
    sky: ['#6a3b6e', '#c9577a', '#f4a35d'],
    sun: '#ffe0a3', sunGlow: '#ffb56b',
    mountains: ['#3e2657', '#5a3568', '#7a4a75'],
    water: ['#4a2f61', '#8a4a68'],
    reeds: '#2d1b3d', birds: '#2d1b3d',
    mood: 'sunset'
  },
  moonlit_bay: {
    label: 'Cool moonlit night over water',
    sky: ['#0f1d3a', '#1c3358', '#2d4d78'],
    sun: '#eef3ff', sunGlow: '#9db7e0',
    mountains: ['#0c1830', '#152443', '#203358'],
    water: ['#0a1730', '#173154'],
    reeds: '#0a1220', birds: '#0a1220',
    mood: 'night'
  },
  spring_valley: {
    label: 'Bright spring/summer valley with road and trees',
    sky: ['#8ecae6', '#bfe3f0', '#eaf6ff'],
    sun: '#fff3b0', sunGlow: '#ffe38a',
    mountains: ['#6a7fa8', '#93a8c9', '#b9c9df'],
    hills: ['#4c8c5c', '#6fb06f'],
    road: '#8b7355', clouds: '#ffffff',
    mood: 'day'
  },
  autumn_valley: {
    label: 'Autumn valley, warm foliage colors',
    sky: ['#bcd6e8', '#dcebf2', '#f3ede1'],
    sun: '#ffe9b0', sunGlow: '#ffd27a',
    mountains: ['#5c6b8a', '#8496b0', '#aab8cc'],
    hills: ['#c96b3c', '#e08a3e'],
    road: '#7a6248', clouds: '#ffffff',
    mood: 'day'
  },
  warm_city: {
    label: 'Warm red/orange/terracotta city street, daytime',
    sky: ['#f6dcc4', '#f8e6d2'],
    buildings: ['#b3432f', '#c85a3c', '#d97a4a', '#e0955d', '#8f3527'],
    windows: '#2c2320', windowLit: '#ffe9a8',
    ground: '#e0c9ad', trees: '#5a7d4a',
    mood: 'day'
  },
  cool_city_night: {
    label: 'Cool blue/teal night city skyline',
    sky: ['#16213e', '#233a63', '#3a5a8c'],
    buildings: ['#1f3352', '#274267', '#31567f', '#3f6a99'],
    windows: '#0e1b30', windowLit: '#ffd97a',
    ground: '#12203a', trees: '#264a3e',
    mood: 'night'
  },
  ocean_city: {
    label: 'Cool blue ocean-side city skyline, daytime',
    sky: ['#bfe4f0', '#e7f6fa'],
    buildings: ['#2a6f8f', '#3a89ab', '#5aa6c4', '#79bcd6', '#1f5a75'],
    windows: '#123244', windowLit: '#fff3c4',
    ground: '#cfe9ee', trees: '#2f7d6a',
    mood: 'day'
  },
  calm_thought: {
    label: 'Plain calm neutral background for a thinking figure',
    bg: ['#f4ece1', '#f4ece1'],
    skin: '#e8b48a', hair: '#3d2b1f', clothing: '#4c6fa5',
    bubble: '#ffffff', bubbleStroke: '#3d2b1f', symbolColor: '#2d3a52',
    mood: 'neutral'
  },
  cool_thought: {
    label: 'Plain cool neutral background for a thinking figure',
    bg: ['#eaf1f5', '#eaf1f5'],
    skin: '#c98a55', hair: '#241d18', clothing: '#2f7d6a',
    bubble: '#ffffff', bubbleStroke: '#22303a', symbolColor: '#1f4d40',
    mood: 'neutral'
  },
  tropical_night: {
    label: 'Deep purple/navy tropical night portrait with plants',
    bg: ['#241b3a', '#342050'],
    skin: '#c98a55', hair: '#1c1420', clothing: '#e8c34a',
    leaves: ['#1d5c53', '#2f7d6a', '#3fae8c', '#245e73'],
    accent: '#f2a341',
    mood: 'night'
  },
  tropical_day: {
    label: 'Warm cream daytime portrait with plants',
    bg: ['#fbeedb', '#f6ddb8'],
    skin: '#e8b48a', hair: '#3d2b1f', clothing: '#b3432f',
    leaves: ['#2f7d6a', '#4c8c5c', '#6fb06f', '#245e73'],
    accent: '#f2a341',
    mood: 'day'
  }
};

// ========================================================================
// THEMES (v2) — 24 extra flat-design color themes. A theme works with EVERY
// scene: the original scenes receive it converted by _ilThemeToPalette(),
// the new scenes read it directly. Roles: a (strong) b (main) c (light)
// d (pale) e (contrast hue), ink (dark text), light (near-white), acc
// (highlight), bg [top, bottom].
// ========================================================================
const ILLUSTRATION_THEMES = {
  ocean: { bg: ['#e0f2fe', '#bae6fd'], a: '#0369a1', b: '#0ea5e9', c: '#38bdf8', d: '#bae6fd', e: '#14b8a6', ink: '#0c2a43', light: '#f0f9ff', acc: '#fbbf24' },
  forest: { bg: ['#ecfdf3', '#c8f0d5'], a: '#166534', b: '#22a35a', c: '#4ade80', d: '#bbf7d0', e: '#a16207', ink: '#0f2a1a', light: '#f4fff8', acc: '#f59e0b' },
  sunset: { bg: ['#ffe4cf', '#fdba8c'], a: '#c2410c', b: '#f97316', c: '#fb923c', d: '#fed7aa', e: '#be185d', ink: '#3b1a10', light: '#fff7ed', acc: '#fde047' },
  candy: { bg: ['#ffe4f1', '#fbcfe8'], a: '#db2777', b: '#f472b6', c: '#f9a8d4', d: '#fce7f3', e: '#2dd4bf', ink: '#4a1230', light: '#fff5fa', acc: '#fde047' },
  midnight: { bg: ['#1e1b4b', '#312e81'], a: '#6366f1', b: '#818cf8', c: '#a5b4fc', d: '#c7d2fe', e: '#f472b6', ink: '#0f0d2e', light: '#eef2ff', acc: '#fde047', dark: 1 },
  earth: { bg: ['#f5efe6', '#e6d5bd'], a: '#78350f', b: '#a16207', c: '#ca8a04', d: '#e7d3a8', e: '#4d7c0f', ink: '#2b1a0c', light: '#fbf7f0', acc: '#dc2626' },
  corporate: { bg: ['#eef2f7', '#d6dfeb'], a: '#1e3a8a', b: '#2563eb', c: '#60a5fa', d: '#dbeafe', e: '#f59e0b', ink: '#0f172a', light: '#f8fafc', acc: '#10b981' },
  mono: { bg: ['#f4f4f5', '#e4e4e7'], a: '#27272a', b: '#52525b', c: '#a1a1aa', d: '#d4d4d8', e: '#71717a', ink: '#09090b', light: '#fafafa', acc: '#ef4444' },
  pastel: { bg: ['#fdf6ff', '#e9e3ff'], a: '#8b7cf6', b: '#a78bfa', c: '#f9a8d4', d: '#c7f0e4', e: '#fcd9a8', ink: '#3b3660', light: '#ffffff', acc: '#fbbf24' },
  neon: { bg: ['#0b0f1a', '#151b2e'], a: '#06b6d4', b: '#22d3ee', c: '#a3e635', d: '#e879f9', e: '#f472b6', ink: '#020617', light: '#e2e8f0', acc: '#facc15', dark: 1 },
  autumn: { bg: ['#fff1e0', '#f8d7a8'], a: '#9a3412', b: '#ea580c', c: '#f59e0b', d: '#fde68a', e: '#65a30d', ink: '#3a1a08', light: '#fffbeb', acc: '#dc2626' },
  spring: { bg: ['#f0fdf4', '#fef9c3'], a: '#16a34a', b: '#4ade80', c: '#f9a8d4', d: '#fef08a', e: '#38bdf8', ink: '#14351f', light: '#ffffff', acc: '#fb7185' },
  desert: { bg: ['#fdebd0', '#f3c98b'], a: '#b45309', b: '#d97706', c: '#f59e0b', d: '#fde3a7', e: '#0f766e', ink: '#3b2410', light: '#fff8eb', acc: '#dc2626' },
  arctic: { bg: ['#f0f9ff', '#dbeafe'], a: '#1d4ed8', b: '#60a5fa', c: '#93c5fd', d: '#e0f2fe', e: '#67e8f9', ink: '#172554', light: '#ffffff', acc: '#f97316' },
  lavender: { bg: ['#f5f3ff', '#ddd6fe'], a: '#6d28d9', b: '#8b5cf6', c: '#c4b5fd', d: '#ede9fe', e: '#f0abfc', ink: '#2e1065', light: '#faf5ff', acc: '#fbbf24' },
  coral: { bg: ['#fff1f0', '#ffd0c9'], a: '#e11d48', b: '#fb7185', c: '#fda4af', d: '#ffe4e6', e: '#0ea5e9', ink: '#4c0519', light: '#fff7f7', acc: '#fbbf24' },
  mint: { bg: ['#ecfeff', '#ccfbf1'], a: '#0f766e', b: '#14b8a6', c: '#5eead4', d: '#ccfbf1', e: '#fb923c', ink: '#042f2e', light: '#f0fdfa', acc: '#f43f5e' },
  royal: { bg: ['#2e1065', '#4c1d95'], a: '#7c3aed', b: '#a78bfa', c: '#fbbf24', d: '#fde68a', e: '#f9a8d4', ink: '#1e0a4a', light: '#faf5ff', acc: '#fbbf24', dark: 1 },
  retro: { bg: ['#fbf1d9', '#f3dfae'], a: '#0f766e', b: '#d97706', c: '#e4572e', d: '#f6e3a4', e: '#2b6f77', ink: '#3d2b1f', light: '#fff9e8', acc: '#e4572e' },
  sky: { bg: ['#dff3ff', '#f0fbff'], a: '#2563eb', b: '#38bdf8', c: '#7dd3fc', d: '#e0f7ff', e: '#fbbf24', ink: '#123a5e', light: '#ffffff', acc: '#fb923c' },
  rose: { bg: ['#fff0f3', '#ffd6e0'], a: '#be123c', b: '#f43f5e', c: '#fb7185', d: '#ffe4e9', e: '#a855f7', ink: '#4c0519', light: '#fff7f9', acc: '#facc15' },
  emerald: { bg: ['#052e2b', '#064e3b'], a: '#10b981', b: '#34d399', c: '#6ee7b7', d: '#d1fae5', e: '#fbbf24', ink: '#022c22', light: '#ecfdf5', acc: '#fbbf24', dark: 1 },
  slate_amber: { bg: ['#f1f5f9', '#e2e8f0'], a: '#334155', b: '#475569', c: '#f59e0b', d: '#fde68a', e: '#0ea5e9', ink: '#0f172a', light: '#f8fafc', acc: '#f59e0b' },
  cream: { bg: ['#fffaf0', '#f7ecd7'], a: '#8a5a44', b: '#c08457', c: '#e0b589', d: '#f3e0c7', e: '#6b8f71', ink: '#3a2a20', light: '#fffdf8', acc: '#d97757' }
};

// Original palette (scene-keyed) -> theme-shaped object, so the NEW scenes
// can also be drawn in any of the 12 original palettes.
function _ilPaletteToTheme(p) {
  const b = p.buildings || [], m = p.mountains || [], sky = p.sky || ['#e0f2fe', '#bae6fd'];
  return {
    bg: [sky[0], sky[1] || sky[0]], a: b[0] || p.clothing || m[0] || '#2563eb', b: b[1] || m[1] || p.clothing || '#3b82f6',
    c: b[2] || m[2] || '#60a5fa', d: b[4] || p.ground || '#dbeafe', e: b[3] || (p.leaves && p.leaves[0]) || '#f59e0b',
    ink: '#1f2430', light: '#fbfcfe', acc: p.accent || p.sun || '#f59e0b', dark: p.mood === 'night' ? 1 : 0
  };
}
function _ilThemeToPalette(t, label) {
  return {
    label: label, sky: [t.bg[0], t.bg[1], t.light], sun: t.acc, sunGlow: t.acc, mountains: [t.a, t.b, t.c], water: [t.a, t.b], reeds: t.a,
    birds: t.ink, hills: [t.b, t.c], road: t.a, clouds: t.light, buildings: [t.a, t.b, t.c, t.e, t.d], windows: t.ink, windowLit: t.acc,
    ground: t.d, trees: t.b, bg: t.bg, skin: '#e8b48a', hair: '#3d2b1f', clothing: t.a, bubble: t.light, bubbleStroke: t.ink,
    symbolColor: t.ink, leaves: [t.a, t.b, t.c, t.e], accent: t.acc, mood: t.dark ? 'night' : 'day'
  };
}
// Resolves ANY palette name (24 themes + 12 original palettes) into a theme.
function _ilResolveTheme(name, fallback) {
  const k = String(name || '').trim().toLowerCase();
  const t = ILLUSTRATION_THEMES[k] || (ILLUSTRATION_PALETTES[k] ? _ilPaletteToTheme(ILLUSTRATION_PALETTES[k]) : ILLUSTRATION_THEMES[fallback || 'ocean']);
  return Object.assign({ bg0: t.bg[0] }, t);
}
// hook object the extension closure fills in (icons, character drawer, catalog data)
const _ilExt = {};

function _ilGetPalette(name, fallbackName) {
  const k = String(name || '').trim().toLowerCase();
  if (ILLUSTRATION_PALETTES[k]) return ILLUSTRATION_PALETTES[k];
  if (ILLUSTRATION_THEMES[k]) return _ilThemeToPalette(ILLUSTRATION_THEMES[k], k);
  return ILLUSTRATION_PALETTES[fallbackName] || ILLUSTRATION_PALETTES.warm_city;
}

// ========================================================================
// PRIMITIVES — each returns either a markup string, or {defs, markup}
// when it needs a <defs> entry (gradients). `defs` strings are always the
// raw gradient/clip element with no outer <defs> wrapper — the outer
// wrapper is added once, at the very end, by _ilWrap().
// ========================================================================

function _ilSkyGradientAndRect(w, h, stops, uid) {
  const gid = 'sky_' + uid;
  const list = (stops && stops.length ? stops : ['#eef2f7', '#eef2f7']);
  const stopEls = list.map((c, i) => `<stop offset="${_ilR1(i / (list.length - 1 || 1) * 100)}%" stop-color="${c}"/>`).join('');
  return {
    defs: `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">${stopEls}</linearGradient>`,
    rect: `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#${gid})"/>`
  };
}

function _ilSunOrMoon(cx, cy, r, color, glowColor, uid, isMoon) {
  const gid = 'glow_' + uid;
  const defs = `<radialGradient id="${gid}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${glowColor}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${glowColor}" stop-opacity="0"/>
    </radialGradient>`;
  let markup = `<circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(r * 2.4)}" fill="url(#${gid})"/>
    <circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(r)}" fill="${color}"/>`;
  if (isMoon) {
    markup += `<circle cx="${_ilR1(cx - r * 0.32)}" cy="${_ilR1(cy - r * 0.22)}" r="${_ilR1(r * 0.16)}" fill="#000000" opacity="0.14"/>
    <circle cx="${_ilR1(cx + r * 0.28)}" cy="${_ilR1(cy + r * 0.28)}" r="${_ilR1(r * 0.11)}" fill="#000000" opacity="0.12"/>`;
  }
  return { defs, markup };
}

function _ilCloud(cx, cy, s, color, opacity) {
  opacity = opacity == null ? 0.9 : opacity;
  return `<g opacity="${opacity}">
    <ellipse cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" rx="${_ilR1(22 * s)}" ry="${_ilR1(13 * s)}" fill="${color}"/>
    <ellipse cx="${_ilR1(cx - 16 * s)}" cy="${_ilR1(cy + 4 * s)}" rx="${_ilR1(14 * s)}" ry="${_ilR1(9 * s)}" fill="${color}"/>
    <ellipse cx="${_ilR1(cx + 18 * s)}" cy="${_ilR1(cy + 3 * s)}" rx="${_ilR1(16 * s)}" ry="${_ilR1(10 * s)}" fill="${color}"/>
    <ellipse cx="${_ilR1(cx - 4 * s)}" cy="${_ilR1(cy - 8 * s)}" rx="${_ilR1(15 * s)}" ry="${_ilR1(10 * s)}" fill="${color}"/>
  </g>`;
}

function _ilBird(x, y, s, color) {
  return `<path d="M ${_ilR1(x - 6 * s)},${_ilR1(y)} Q ${_ilR1(x - 3 * s)},${_ilR1(y - 5 * s)} ${_ilR1(x)},${_ilR1(y)} Q ${_ilR1(x + 3 * s)},${_ilR1(y - 5 * s)} ${_ilR1(x + 6 * s)},${_ilR1(y)}" fill="none" stroke="${color}" stroke-width="${_ilR1(1.6 * s)}" stroke-linecap="round"/>`;
}

function _ilBirdFlock(points, color) {
  return points.map(p => _ilBird(p[0], p[1], p[2] || 1, color)).join('');
}

// One jagged/rolling ridge layer, built from smooth Bezier segments so it
// reads as organic terrain rather than a blocky zig-zag.
function _ilMountainLayer(w, baseY, peakH, colorFill, freq, phase, roughness) {
  const segs = 6;
  const segW = w / segs;
  let prevX = 0, prevY = baseY - peakH * 0.4;
  let d = `M 0,${_ilR1(baseY)} L ${_ilR1(prevX)},${_ilR1(prevY)} `;
  for (let i = 1; i <= segs; i++) {
    const x = i * segW;
    const y = baseY - peakH * (0.35 + 0.65 * Math.abs(Math.sin(freq * i + phase))) * roughness - peakH * 0.15;
    d += `C ${_ilR1(prevX + segW * 0.5)},${_ilR1(prevY)} ${_ilR1(x - segW * 0.5)},${_ilR1(y)} ${_ilR1(x)},${_ilR1(y)} `;
    prevX = x; prevY = y;
  }
  d += `L ${_ilR1(w)},${_ilR1(baseY)} Z`;
  return `<path d="${d}" fill="${colorFill}"/>`;
}

// colors: array back -> front. Deliberately overlaps each layer down to
// the same baseline so there is never a visible seam between layers.
function _ilMountainRange(w, baseY, colors, peakBase) {
  const n = colors.length || 1;
  let out = '';
  for (let i = 0; i < n; i++) {
    const peakH = peakBase * (0.55 + 0.5 * (i / (n - 1 || 1)));
    out += _ilMountainLayer(w, baseY - (n - 1 - i) * 6, peakH, colors[i], 1.1 + i * 0.35, i * 1.7, 0.9 - i * 0.08);
  }
  return out;
}

function _ilWater(w, topY, totalH, colorTop, colorBottom, uid, sunCx, sunR, sunColor) {
  const gid = 'water_' + uid;
  const defs = `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${colorTop}"/>
      <stop offset="100%" stop-color="${colorBottom}"/>
    </linearGradient>`;
  let markup = `<rect x="0" y="${_ilR1(topY)}" width="${w}" height="${_ilR1(totalH - topY)}" fill="url(#${gid})"/>`;
  if (sunCx != null) {
    markup += `<ellipse cx="${_ilR1(sunCx)}" cy="${_ilR1(topY + (totalH - topY) * 0.42)}" rx="${_ilR1(sunR * 1.4)}" ry="${_ilR1((totalH - topY) * 0.4)}" fill="${sunColor}" opacity="0.28"/>`;
    for (let i = 0; i < 4; i++) {
      const ry = topY + 10 + i * ((totalH - topY - 14) / 4);
      const rw = sunR * 2 * (1 - i * 0.15);
      markup += `<rect x="${_ilR1(sunCx - rw / 2)}" y="${_ilR1(ry)}" width="${_ilR1(rw)}" height="3" rx="1.5" fill="${sunColor}" opacity="${_ilR1(0.35 - i * 0.06)}"/>`;
    }
  }
  for (let i = 0; i < 5; i++) {
    const ry = topY + 14 + i * ((totalH - topY - 20) / 5);
    markup += `<line x1="0" y1="${_ilR1(ry)}" x2="${w}" y2="${_ilR1(ry)}" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1"/>`;
  }
  return { defs, markup };
}

function _ilReeds(w, baseY, color) {
  let out = `<rect x="0" y="${_ilR1(baseY)}" width="${w}" height="60" fill="${color}"/>`;
  const stalks = [[0.06, 70], [0.13, 95], [0.21, 60], [0.86, 90], [0.93, 65], [0.79, 105]];
  stalks.forEach(([fx, hh]) => {
    const x = fx * w;
    out += `<path d="M ${_ilR1(x)},${_ilR1(baseY + 10)} C ${_ilR1(x - 6)},${_ilR1(baseY - hh * 0.5)} ${_ilR1(x + 10)},${_ilR1(baseY - hh * 0.8)} ${_ilR1(x + 4)},${_ilR1(baseY - hh)}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
  });
  return out;
}

function _ilBoat(cx, y, s, color) {
  return `<g>
    <path d="M ${_ilR1(cx - 14 * s)},${_ilR1(y)} Q ${_ilR1(cx)},${_ilR1(y + 8 * s)} ${_ilR1(cx + 14 * s)},${_ilR1(y)} L ${_ilR1(cx + 10 * s)},${_ilR1(y - 2 * s)} L ${_ilR1(cx - 10 * s)},${_ilR1(y - 2 * s)} Z" fill="${color}"/>
    <line x1="${_ilR1(cx)}" y1="${_ilR1(y - 2 * s)}" x2="${_ilR1(cx)}" y2="${_ilR1(y - 18 * s)}" stroke="${color}" stroke-width="1.4"/>
  </g>`;
}

// Crisp flat buildings with a window grid. shape-rendering="crispEdges" on
// every rectangular element keeps window/wall edges pixel-sharp instead of
// softly anti-aliased at small sizes.
function _ilBuildingsRow(w, baseY, count, colors, windowColor, windowLitColor) {
  count = Math.max(3, Math.min(9, count || 6));
  const gap = 4;
  const bw = (w - gap * (count - 1)) / count;
  let out = '';
  for (let i = 0; i < count; i++) {
    const heightFactor = 0.45 + ((i * 37) % 53) / 100;
    const bh = _ilR1(150 + heightFactor * 150);
    const x = _ilR1(i * (bw + gap));
    const y = _ilR1(baseY - bh);
    const color = colors[i % colors.length];
    out += `<rect x="${x}" y="${y}" width="${_ilR1(bw)}" height="${bh}" fill="${color}" shape-rendering="crispEdges"/>`;
    const cols = Math.max(2, Math.floor(bw / 18));
    const rows = Math.max(3, Math.floor(bh / 22));
    const wW = _ilR1((bw / cols) * 0.5), wH = _ilR1((bh / rows) * 0.45);
    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const wx = _ilR1(x + (cc + 0.5) * (bw / cols) - wW / 2);
        const wy = _ilR1(y + (rr + 0.6) * (bh / rows) - wH / 2);
        const lit = ((i * 7 + rr * 3 + cc) % 5 === 0);
        out += `<rect x="${wx}" y="${wy}" width="${wW}" height="${wH}" fill="${lit ? windowLitColor : windowColor}" opacity="0.9" shape-rendering="crispEdges"/>`;
      }
    }
  }
  out += `<rect x="0" y="${_ilR1(baseY)}" width="${w}" height="4" fill="${colors[0]}" opacity="0.5"/>`;
  return out;
}

// Trunk drawn overlapping up into the foliage blobs (no floating-trunk
// seam), per the same connectivity discipline as diagram-library.js.
function _ilTree(cx, baseY, s, trunkColor, foliageColors) {
  const trunkTop = baseY - 26 * s;
  let out = `<path d="M ${_ilR1(cx - 3 * s)},${_ilR1(baseY)} C ${_ilR1(cx - 4 * s)},${_ilR1(baseY - 14 * s)} ${_ilR1(cx - 2 * s)},${_ilR1(trunkTop + 10 * s)} ${_ilR1(cx)},${_ilR1(trunkTop)} C ${_ilR1(cx + 2 * s)},${_ilR1(trunkTop + 10 * s)} ${_ilR1(cx + 4 * s)},${_ilR1(baseY - 14 * s)} ${_ilR1(cx + 3 * s)},${_ilR1(baseY)} Z" fill="${trunkColor}"/>`;
  const blobs = [[0, -6, 16], [-12, 2, 13], [12, 2, 13], [0, 10, 15]];
  blobs.forEach(([dx, dy, rr], i) => {
    out += `<circle cx="${_ilR1(cx + dx * s)}" cy="${_ilR1(trunkTop + dy * s - 4 * s)}" r="${_ilR1(rr * s)}" fill="${foliageColors[i % foliageColors.length]}"/>`;
  });
  return out;
}

function _ilRollingForeground(w, baseY, totalH, color) {
  return `<path d="M 0,${_ilR1(totalH)} L 0,${_ilR1(baseY + 20)} C ${_ilR1(w * 0.25)},${_ilR1(baseY - 16)} ${_ilR1(w * 0.4)},${_ilR1(baseY + 14)} ${_ilR1(w * 0.6)},${_ilR1(baseY - 6)} C ${_ilR1(w * 0.8)},${_ilR1(baseY - 20)} ${_ilR1(w * 0.9)},${_ilR1(baseY + 6)} ${_ilR1(w)},${_ilR1(baseY - 4)} L ${_ilR1(w)},${_ilR1(totalH)} Z" fill="${color}"/>`;
}

// A gently tapered road strip from a narrow "vanishing point" (baseY) down
// to a wide near edge (totalH). Control points stay close to a straight
// line between the top/bottom edges (only a small `bend` offset) so the
// shape reads as a receding road, not a rounded blob/mound.
function _ilRoad(w, baseY, totalH, color) {
  const topW = w * 0.05, botW = w * 0.34;
  const topXL = w / 2 - topW / 2, topXR = w / 2 + topW / 2;
  const botXL = w / 2 - botW / 2, botXR = w / 2 + botW / 2;
  const midY = baseY + (totalH - baseY) * 0.35;
  const bend = w * 0.045;
  const d = `M ${_ilR1(topXL)},${_ilR1(baseY)} C ${_ilR1(topXL - bend * 0.3)},${_ilR1(midY)} ${_ilR1(botXL - bend)},${_ilR1(totalH - 30)} ${_ilR1(botXL)},${_ilR1(totalH)} L ${_ilR1(botXR)},${_ilR1(totalH)} C ${_ilR1(botXR - bend)},${_ilR1(totalH - 30)} ${_ilR1(topXR - bend * 0.3)},${_ilR1(midY)} ${_ilR1(topXR)},${_ilR1(baseY)} Z`;
  return `<path d="${d}" fill="${color}"/>
    <line x1="${_ilR1(w / 2)}" y1="${_ilR1(baseY + 8)}" x2="${_ilR1(w / 2 - bend * 0.6)}" y2="${_ilR1(totalH - 6)}" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2" stroke-dasharray="6 8"/>`;
}

// Simple stylized person: head, hair cap, torso, two arms (pose-dependent),
// minimal face, soft contact shadow underneath. Cropped at the waist by
// design (baseY is the bottom edge of the canvas), matching the reference
// "bust portrait" framing used for thinking/nature scenes.
function _ilPerson(cx, baseY, s, skin, hair, clothing, pose) {
  const headR = 30 * s;
  const headCY = baseY - 150 * s;
  const neckW = 14 * s;
  let out = '';
  out += `<path d="M ${_ilR1(cx - 46 * s)},${_ilR1(baseY)} C ${_ilR1(cx - 50 * s)},${_ilR1(headCY + 70 * s)} ${_ilR1(cx - 30 * s)},${_ilR1(headCY + 34 * s)} ${_ilR1(cx - neckW)},${_ilR1(headCY + 26 * s)} L ${_ilR1(cx + neckW)},${_ilR1(headCY + 26 * s)} C ${_ilR1(cx + 30 * s)},${_ilR1(headCY + 34 * s)} ${_ilR1(cx + 50 * s)},${_ilR1(headCY + 70 * s)} ${_ilR1(cx + 46 * s)},${_ilR1(baseY)} Z" fill="${clothing}"/>`;
  out += `<rect x="${_ilR1(cx - neckW / 2)}" y="${_ilR1(headCY + 18 * s)}" width="${_ilR1(neckW)}" height="${_ilR1(20 * s)}" fill="${skin}"/>`;

  if (pose === 'thinking') {
    out += `<path d="M ${_ilR1(cx + 26 * s)},${_ilR1(headCY + 50 * s)} C ${_ilR1(cx + 40 * s)},${_ilR1(headCY + 40 * s)} ${_ilR1(cx + 34 * s)},${_ilR1(headCY + 10 * s)} ${_ilR1(cx + 18 * s)},${_ilR1(headCY + 8 * s)}" fill="none" stroke="${clothing}" stroke-width="${_ilR1(16 * s)}" stroke-linecap="round"/>`;
    out += `<circle cx="${_ilR1(cx + 16 * s)}" cy="${_ilR1(headCY + 8 * s)}" r="${_ilR1(8 * s)}" fill="${skin}"/>`;
    out += `<path d="M ${_ilR1(cx - 30 * s)},${_ilR1(headCY + 55 * s)} C ${_ilR1(cx - 40 * s)},${_ilR1(headCY + 85 * s)} ${_ilR1(cx - 38 * s)},${_ilR1(baseY - 20 * s)} ${_ilR1(cx - 34 * s)},${_ilR1(baseY)}" fill="none" stroke="${clothing}" stroke-width="${_ilR1(16 * s)}" stroke-linecap="round"/>`;
  } else if (pose === 'giving') {
    out += `<path d="M ${_ilR1(cx + 30 * s)},${_ilR1(headCY + 55 * s)} C ${_ilR1(cx + 55 * s)},${_ilR1(headCY + 60 * s)} ${_ilR1(cx + 70 * s)},${_ilR1(headCY + 70 * s)} ${_ilR1(cx + 78 * s)},${_ilR1(headCY + 78 * s)}" fill="none" stroke="${clothing}" stroke-width="${_ilR1(16 * s)}" stroke-linecap="round"/>`;
    out += `<circle cx="${_ilR1(cx + 80 * s)}" cy="${_ilR1(headCY + 80 * s)}" r="${_ilR1(9 * s)}" fill="${skin}"/>`;
    out += `<path d="M ${_ilR1(cx - 30 * s)},${_ilR1(headCY + 55 * s)} C ${_ilR1(cx - 42 * s)},${_ilR1(headCY + 85 * s)} ${_ilR1(cx - 40 * s)},${_ilR1(baseY - 20 * s)} ${_ilR1(cx - 36 * s)},${_ilR1(baseY)}" fill="none" stroke="${clothing}" stroke-width="${_ilR1(16 * s)}" stroke-linecap="round"/>`;
  } else {
    out += `<path d="M ${_ilR1(cx + 30 * s)},${_ilR1(headCY + 55 * s)} C ${_ilR1(cx + 40 * s)},${_ilR1(headCY + 85 * s)} ${_ilR1(cx + 38 * s)},${_ilR1(baseY - 20 * s)} ${_ilR1(cx + 34 * s)},${_ilR1(baseY)}" fill="none" stroke="${clothing}" stroke-width="${_ilR1(16 * s)}" stroke-linecap="round"/>`;
    out += `<path d="M ${_ilR1(cx - 30 * s)},${_ilR1(headCY + 55 * s)} C ${_ilR1(cx - 40 * s)},${_ilR1(headCY + 85 * s)} ${_ilR1(cx - 38 * s)},${_ilR1(baseY - 20 * s)} ${_ilR1(cx - 34 * s)},${_ilR1(baseY)}" fill="none" stroke="${clothing}" stroke-width="${_ilR1(16 * s)}" stroke-linecap="round"/>`;
  }

  out += `<circle cx="${_ilR1(cx)}" cy="${_ilR1(headCY)}" r="${_ilR1(headR)}" fill="${skin}"/>`;
  out += `<path d="M ${_ilR1(cx - headR)},${_ilR1(headCY - 2 * s)} C ${_ilR1(cx - headR)},${_ilR1(headCY - headR * 1.15)} ${_ilR1(cx + headR)},${_ilR1(headCY - headR * 1.15)} ${_ilR1(cx + headR)},${_ilR1(headCY - 2 * s)} C ${_ilR1(cx + headR * 0.9)},${_ilR1(headCY - headR * 0.5)} ${_ilR1(cx - headR * 0.9)},${_ilR1(headCY - headR * 0.5)} ${_ilR1(cx - headR)},${_ilR1(headCY - 2 * s)} Z" fill="${hair}"/>`;
  out += `<path d="M ${_ilR1(cx - 8 * s)},${_ilR1(headCY + 8 * s)} Q ${_ilR1(cx)},${_ilR1(headCY + 13 * s)} ${_ilR1(cx + 8 * s)},${_ilR1(headCY + 8 * s)}" fill="none" stroke="${_ilShade(skin, 0.35)}" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>`;
  out += `<ellipse cx="${_ilR1(cx)}" cy="${_ilR1(baseY + 6 * s)}" rx="${_ilR1(48 * s)}" ry="${_ilR1(7 * s)}" fill="#000000" opacity="0.08"/>`;
  return out;
}

function _ilThoughtBubble(cx, cy, s, bg, stroke, symbolType, symbolColor) {
  const rx = 46 * s, ry = 34 * s;
  let out = `<ellipse cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" rx="${_ilR1(rx)}" ry="${_ilR1(ry)}" fill="${bg}" stroke="${stroke}" stroke-width="2"/>
    <circle cx="${_ilR1(cx - rx * 0.55)}" cy="${_ilR1(cy + ry * 0.85)}" r="${_ilR1(10 * s)}" fill="${bg}" stroke="${stroke}" stroke-width="1.6"/>
    <circle cx="${_ilR1(cx - rx * 0.75)}" cy="${_ilR1(cy + ry * 1.5)}" r="${_ilR1(6 * s)}" fill="${bg}" stroke="${stroke}" stroke-width="1.4"/>`;
  out += _ilSymbol(symbolType, cx, cy, s * 1.1, symbolColor);
  return out;
}

// Small vector concept icons — deliberately built from paths/shapes
// (never emoji/raster) so they stay crisp at any size.
function _ilSymbol(type, cx, cy, s, color) {
  switch (String(type || 'question').toLowerCase()) {
    case 'question':
      return `<text x="${_ilR1(cx)}" y="${_ilR1(cy + 9 * s)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${_ilR1(30 * s)}" font-weight="800" fill="${color}">?</text>`;
    case 'idea':
      return `<g fill="${color}">
        <circle cx="${_ilR1(cx)}" cy="${_ilR1(cy - 4 * s)}" r="${_ilR1(13 * s)}" opacity="0.9"/>
        <rect x="${_ilR1(cx - 5 * s)}" y="${_ilR1(cy + 7 * s)}" width="${_ilR1(10 * s)}" height="${_ilR1(6 * s)}" rx="1.5"/>
        <line x1="${_ilR1(cx)}" y1="${_ilR1(cy - 22 * s)}" x2="${_ilR1(cx)}" y2="${_ilR1(cy - 17 * s)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        <line x1="${_ilR1(cx - 14 * s)}" y1="${_ilR1(cy - 4 * s)}" x2="${_ilR1(cx - 19 * s)}" y2="${_ilR1(cy - 4 * s)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        <line x1="${_ilR1(cx + 14 * s)}" y1="${_ilR1(cy - 4 * s)}" x2="${_ilR1(cx + 19 * s)}" y2="${_ilR1(cy - 4 * s)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      </g>`;
    case 'check':
      return `<path d="M ${_ilR1(cx - 14 * s)},${_ilR1(cy)} L ${_ilR1(cx - 3 * s)},${_ilR1(cy + 11 * s)} L ${_ilR1(cx + 16 * s)},${_ilR1(cy - 12 * s)}" fill="none" stroke="${color}" stroke-width="${_ilR1(5 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + i * Math.PI / 5;
        const rr = (i % 2 === 0) ? 16 * s : 7 * s;
        pts.push(`${_ilR1(cx + Math.cos(ang) * rr)},${_ilR1(cy + Math.sin(ang) * rr)}`);
      }
      return `<polygon points="${pts.join(' ')}" fill="${color}"/>`;
    }
    case 'arrow':
      return `<path d="M ${_ilR1(cx - 14 * s)},${_ilR1(cy)} L ${_ilR1(cx + 10 * s)},${_ilR1(cy)} M ${_ilR1(cx + 2 * s)},${_ilR1(cy - 8 * s)} L ${_ilR1(cx + 14 * s)},${_ilR1(cy)} L ${_ilR1(cx + 2 * s)},${_ilR1(cy + 8 * s)}" fill="none" stroke="${color}" stroke-width="${_ilR1(4 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'chat':
      return `<g>
        <rect x="${_ilR1(cx - 16 * s)}" y="${_ilR1(cy - 11 * s)}" width="${_ilR1(32 * s)}" height="${_ilR1(20 * s)}" rx="${_ilR1(6 * s)}" fill="${color}"/>
        <path d="M ${_ilR1(cx - 6 * s)},${_ilR1(cy + 9 * s)} L ${_ilR1(cx - 2 * s)},${_ilR1(cy + 16 * s)} L ${_ilR1(cx + 4 * s)},${_ilR1(cy + 9 * s)} Z" fill="${color}"/>
      </g>`;
    case 'gear': {
      let teeth = '';
      for (let i = 0; i < 8; i++) {
        const ang = i * Math.PI / 4;
        const tx = cx + Math.cos(ang) * 15 * s, ty = cy + Math.sin(ang) * 15 * s;
        teeth += `<rect x="${_ilR1(tx - 2.5 * s)}" y="${_ilR1(ty - 2.5 * s)}" width="${_ilR1(5 * s)}" height="${_ilR1(5 * s)}" fill="${color}" transform="rotate(${_ilR1(ang * 180 / Math.PI)} ${_ilR1(tx)} ${_ilR1(ty)})"/>`;
      }
      return `<g>${teeth}<circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(11 * s)}" fill="${color}"/><circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(5 * s)}" fill="#ffffff"/></g>`;
    }
    case 'book':
      return `<g fill="${color}">
        <path d="M ${_ilR1(cx - 15 * s)},${_ilR1(cy - 10 * s)} C ${_ilR1(cx - 15 * s)},${_ilR1(cy - 12 * s)} ${_ilR1(cx - 2 * s)},${_ilR1(cy - 12 * s)} ${_ilR1(cx)},${_ilR1(cy - 8 * s)} L ${_ilR1(cx)},${_ilR1(cy + 12 * s)} C ${_ilR1(cx - 2 * s)},${_ilR1(cy + 8 * s)} ${_ilR1(cx - 15 * s)},${_ilR1(cy + 8 * s)} ${_ilR1(cx - 15 * s)},${_ilR1(cy + 10 * s)} Z"/>
        <path d="M ${_ilR1(cx + 15 * s)},${_ilR1(cy - 10 * s)} C ${_ilR1(cx + 15 * s)},${_ilR1(cy - 12 * s)} ${_ilR1(cx + 2 * s)},${_ilR1(cy - 12 * s)} ${_ilR1(cx)},${_ilR1(cy - 8 * s)} L ${_ilR1(cx)},${_ilR1(cy + 12 * s)} C ${_ilR1(cx + 2 * s)},${_ilR1(cy + 8 * s)} ${_ilR1(cx + 15 * s)},${_ilR1(cy + 8 * s)} ${_ilR1(cx + 15 * s)},${_ilR1(cy + 10 * s)} Z" opacity="0.8"/>
      </g>`;
    case 'target':
      return `<g fill="none" stroke="${color}">
        <circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(16 * s)}" stroke-width="${_ilR1(3 * s)}"/>
        <circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(9 * s)}" stroke-width="${_ilR1(3 * s)}"/>
        <circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(2.5 * s)}" fill="${color}"/>
      </g>`;
    case 'clock':
      return `<g>
        <circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(16 * s)}" fill="none" stroke="${color}" stroke-width="${_ilR1(3 * s)}"/>
        <line x1="${_ilR1(cx)}" y1="${_ilR1(cy)}" x2="${_ilR1(cx)}" y2="${_ilR1(cy - 9 * s)}" stroke="${color}" stroke-width="${_ilR1(2.4 * s)}" stroke-linecap="round"/>
        <line x1="${_ilR1(cx)}" y1="${_ilR1(cy)}" x2="${_ilR1(cx + 7 * s)}" y2="${_ilR1(cy + 2 * s)}" stroke="${color}" stroke-width="${_ilR1(2.4 * s)}" stroke-linecap="round"/>
      </g>`;
    default: {
      const ext = _ilExt.icon ? _ilExt.icon(type, cx, cy, s, color) : null;
      if (ext) return ext;
      return `<text x="${_ilR1(cx)}" y="${_ilR1(cy + 9 * s)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${_ilR1(28 * s)}" font-weight="800" fill="${color}">!</text>`;
    }
  }
}

function _ilLeaf(cx, cy, rotDeg, len, wid, color) {
  const d = `M 0,0 C ${_ilR1(wid * 0.5)},${_ilR1(-len * 0.3)} ${_ilR1(wid * 0.5)},${_ilR1(-len * 0.7)} 0,${_ilR1(-len)} C ${_ilR1(-wid * 0.5)},${_ilR1(-len * 0.7)} ${_ilR1(-wid * 0.5)},${_ilR1(-len * 0.3)} 0,0 Z`;
  return `<g transform="translate(${_ilR1(cx)},${_ilR1(cy)}) rotate(${_ilR1(rotDeg)})">
    <path d="${d}" fill="${color}"/>
    <path d="M 0,0 L 0,${_ilR1(-len * 0.94)}" stroke="${_ilShade(color, 0.25)}" stroke-width="1.4" opacity="0.5"/>
  </g>`;
}

function _ilLeavesFrame(w, h, colors) {
  const c = colors && colors.length ? colors : ['#2f7d6a', '#3fae8c'];
  const leaves = [
    [w * 0.02, h * 1.02, -12, 170, 90, c[0 % c.length]],
    [w * 0.12, h * 1.05, 15, 190, 100, c[1 % c.length]],
    [w * 0.98, h * 1.02, 12, 175, 95, c[2 % c.length]],
    [w * 0.88, h * 1.05, -15, 200, 105, c[3 % c.length]],
    [w * 0.06, -h * 0.02, 165, 120, 70, c[1 % c.length]],
    [w * 0.94, -h * 0.02, -165, 120, 70, c[2 % c.length]]
  ];
  return leaves.map(l => _ilLeaf(l[0], l[1], l[2], l[3], l[4], l[5])).join('');
}

function _ilFlower(cx, cy, s, petalColor, centerColor) {
  let petals = '';
  for (let i = 0; i < 6; i++) {
    const ang = i * Math.PI / 3;
    const px = cx + Math.cos(ang) * 10 * s, py = cy + Math.sin(ang) * 10 * s;
    petals += `<ellipse cx="${_ilR1(px)}" cy="${_ilR1(py)}" rx="${_ilR1(9 * s)}" ry="${_ilR1(6 * s)}" fill="${petalColor}" transform="rotate(${_ilR1(ang * 180 / Math.PI)} ${_ilR1(px)} ${_ilR1(py)})"/>`;
  }
  return `<g>${petals}<circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(6 * s)}" fill="${centerColor}"/></g>`;
}

function _ilStars(w, h, count, color) {
  count = count || 22;
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = (i * 97) % w;
    const y = (i * 53 + i * i * 3) % Math.max(1, h * 0.6);
    const r = 1 + ((i * 7) % 3) * 0.5;
    out += `<circle cx="${_ilR1(x)}" cy="${_ilR1(y)}" r="${_ilR1(r)}" fill="${color}" opacity="${_ilR1(0.4 + ((i * 13) % 6) * 0.1)}"/>`;
  }
  return out;
}

function _ilBadgeBackdrop(cx, cy, r, mainColor, accentColor, uid) {
  const gid = 'badgeGrad_' + uid;
  const defs = `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${mainColor}"/>
      <stop offset="100%" stop-color="${_ilShade(mainColor, 0.18)}"/>
    </linearGradient>`;
  const markup = `<circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(r * 1.22)}" fill="${accentColor}" opacity="0.18"/>
    <circle cx="${_ilR1(cx)}" cy="${_ilR1(cy)}" r="${_ilR1(r)}" fill="url(#${gid})"/>`;
  return { defs, markup };
}

// ========================================================================
// SCENE COMPOSERS — each returns {w, h, defs, body}. defs is a flat
// string of raw gradient elements (no <defs> wrapper — added once by
// _ilWrap). body is the full layered scene markup.
// ========================================================================

function _renderLandscapeWater(params) {
  const pal = _ilGetPalette(params.palette, 'sunset_bay');
  const w = 700, h = 400, uid = _ilUid();
  const horizon = 210;
  const sky = _ilSkyGradientAndRect(w, horizon + 40, pal.sky, uid);
  const isMoon = pal.mood === 'night';
  const sun = _ilSunOrMoon(w * 0.32, 120, 30, pal.sun || '#ffe0a3', pal.sunGlow || pal.sun || '#ffb56b', uid, isMoon);
  const mts = _ilMountainRange(w, horizon - 10, pal.mountains || ['#3e2657', '#5a3568', '#7a4a75'], 90);
  const water = _ilWater(w, horizon + 10, h, (pal.water && pal.water[0]) || '#4a2f61', (pal.water && pal.water[1]) || '#8a4a68', uid, w * 0.32, 30, pal.sun || '#ffe0a3');
  const birds = _ilBirdFlock([[w * 0.6, 70, 1], [w * 0.64, 60, 0.8], [w * 0.56, 66, 0.7]], pal.birds || '#2d1b3d');
  const reedColor = pal.reeds || (pal.mountains && pal.mountains[0]) || '#2d1b3d';
  const showBoat = params.count !== 0;
  const boat = showBoat ? _ilBoat(w * 0.72, horizon + 55, 1.1, reedColor) : '';
  const reeds = _ilReeds(w, h - 70, reedColor);
  return {
    w, h,
    defs: sky.defs + sun.defs + water.defs,
    body: sky.rect + sun.markup + mts + water.markup + birds + boat + reeds
  };
}

function _renderLandscapeValley(params) {
  const pal = _ilGetPalette(params.palette, 'spring_valley');
  const w = 700, h = 400, uid = _ilUid();
  const horizon = 230;
  const sky = _ilSkyGradientAndRect(w, h, pal.sky, uid);
  const sun = _ilSunOrMoon(w * 0.78, 80, 26, pal.sun || '#fff3b0', pal.sunGlow || '#ffe38a', uid, false);
  const clouds = _ilCloud(w * 0.18, 70, 1, pal.clouds || '#ffffff', 0.9) + _ilCloud(w * 0.42, 50, 0.7, pal.clouds || '#ffffff', 0.8);
  const mts = _ilMountainRange(w, horizon - 20, pal.mountains || ['#6a7fa8', '#93a8c9', '#b9c9df'], 80);
  const hillBack = (pal.hills && pal.hills[0]) || '#4c8c5c';
  const hillFront = (pal.hills && pal.hills[1]) || hillBack;
  const hillsBack = _ilRollingForeground(w, horizon + 30, h, hillBack);
  const hillsFront = _ilRollingForeground(w, horizon + 70, h, hillFront);
  const road = _ilRoad(w, horizon + 100, h, pal.road || '#8b7355');
  const foliage = [_ilShade(hillFront, 0.3), _ilShade(hillFront, 0.1), _ilShade(hillFront, 0.42)];
  const trees = [[w * 0.18, h - 30, 0.9], [w * 0.82, h - 20, 1.1], [w * 0.65, h - 45, 0.7]]
    .map(t => _ilTree(t[0], t[1], t[2], _ilShade(hillFront, 0.5), foliage))
    .join('');
  return {
    w, h,
    defs: sky.defs + sun.defs,
    body: sky.rect + sun.markup + clouds + mts + hillsBack + hillsFront + road + trees
  };
}

function _renderCityscape(params) {
  const pal = _ilGetPalette(params.palette, 'warm_city');
  const w = 700, h = 400, uid = _ilUid();
  const horizon = 320;
  const sky = _ilSkyGradientAndRect(w, horizon + 30, pal.sky, uid);
  const count = params.count ? Math.max(3, Math.min(9, params.count)) : 6;
  const buildings = _ilBuildingsRow(w, horizon, count, pal.buildings || ['#b3432f', '#c85a3c', '#d97a4a', '#e0955d'], pal.windows || '#2c2320', pal.windowLit || '#ffe9a8');
  const ground = `<rect x="0" y="${_ilR1(horizon)}" width="${w}" height="${_ilR1(h - horizon)}" fill="${pal.ground || '#e0c9ad'}"/>`;
  const treeColor = pal.trees || '#5a7d4a';
  const trees = [[w * 0.06, horizon + 2, 0.8], [w * 0.95, horizon + 2, 0.9]]
    .map(t => _ilTree(t[0], t[1], t[2], _ilShade(treeColor, 0.3), [treeColor, _ilShade(treeColor, -0.12)]))
    .join('');
  return {
    w, h,
    defs: sky.defs,
    body: sky.rect + buildings + ground + trees
  };
}

function _renderPersonThinking(params) {
  const pal = _ilGetPalette(params.palette, 'calm_thought');
  const w = 520, h = 520, uid = _ilUid();
  const bg = _ilSkyGradientAndRect(w, h, pal.bg || ['#f4ece1', '#f4ece1'], uid);
  const pose = params.pose || 'thinking';
  const figure = _ilPerson(w * 0.5, h * 0.94, 1.15, pal.skin || '#e8b48a', pal.hair || '#3d2b1f', pal.clothing || '#4c6fa5', pose);
  const bubble = _ilThoughtBubble(w * 0.66, h * 0.26, 1, pal.bubble || '#ffffff', pal.bubbleStroke || '#3d2b1f', params.symbol || 'question', pal.symbolColor || '#2d3a52');
  return {
    w, h,
    defs: bg.defs,
    body: bg.rect + figure + bubble
  };
}

function _renderPersonNature(params) {
  const pal = _ilGetPalette(params.palette, 'tropical_night');
  const w = 520, h = 520, uid = _ilUid();
  const bg = _ilSkyGradientAndRect(w, h, pal.bg || ['#241b3a', '#342050'], uid);
  const stars = pal.mood === 'night' ? _ilStars(w, h * 0.55, 20, '#ffffff') : '';
  const pose = params.pose || 'giving';
  const figCx = w * 0.46, figBase = h * 0.99;
  const figure = _ilPerson(figCx, figBase, 1.3, pal.skin || '#c98a55', pal.hair || '#1c1420', pal.clothing || '#e8c34a', pose);
  const flower = pose === 'giving' ? _ilFlower(figCx + 95, figBase - 102, 1.3, pal.accent || '#f2a341', '#ffffff') : '';
  const leaves = _ilLeavesFrame(w, h, pal.leaves || ['#1d5c53', '#2f7d6a', '#3fae8c', '#245e73']);
  return {
    w, h,
    defs: bg.defs,
    body: bg.rect + stars + figure + flower + leaves
  };
}

function _renderIconBadge(params) {
  const pal = _ilGetPalette(params.palette, 'warm_city');
  const w = 360, h = 360, uid = _ilUid();
  const mainColor = (pal.buildings && pal.buildings[0]) || pal.clothing || pal.sun || '#4f7df3';
  const accentColor = (pal.buildings && pal.buildings[2]) || pal.accent || pal.sunGlow || '#f59e0b';
  const badge = _ilBadgeBackdrop(w / 2, h / 2, 120, mainColor, accentColor, uid);
  const glyph = _ilSymbol(params.symbol || 'star', w / 2, h / 2, 2.4, '#ffffff');
  return {
    w, h,
    defs: badge.defs,
    body: badge.markup + glyph
  };
}

// ========================================================================
// SCENE REGISTRY, PARSING, WRAPPING, INJECTION
// ========================================================================
const ILLUSTRATION_SCENES = {
  landscape_water: { render: _renderLandscapeWater, defaultShape: 'wide' },
  landscape_valley: { render: _renderLandscapeValley, defaultShape: 'wide' },
  cityscape: { render: _renderCityscape, defaultShape: 'wide' },
  person_thinking: { render: _renderPersonThinking, defaultShape: 'square' },
  person_nature: { render: _renderPersonNature, defaultShape: 'square' },
  icon_badge: { render: _renderIconBadge, defaultShape: 'circle' }
};

// ========================================================================
// EXTENDED LIBRARY (v2 + v3) — hundreds of additional code-composed
// subjects. Everything below is deterministic flat-vector SVG: no blur
// filters, no raster data, no external assets, every shape is a crisp
// path/rect/circle.
// ========================================================================
(function () {
  'use strict';

  // ---------- tiny SVG string builders (local to this closure) ----------
  const R = (x, y, w, h, fill, rx, ex) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''} fill="${fill}"${ex || ''}/>`;
  const C = (x, y, r, fill, ex) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"${ex || ''}/>`;
  const E = (x, y, rx, ry, fill, ex) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"${ex || ''}/>`;
  const P = (d, fill, ex) => `<path d="${d}" fill="${fill}"${ex || ''}/>`;
  const S = (d, stroke, sw, ex) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw || 3}" stroke-linecap="round" stroke-linejoin="round"${ex || ''}/>`;
  const L = (x1, y1, x2, y2, stroke, sw) => S(`M${x1} ${y1}L${x2} ${y2}`, stroke, sw);
  const PG = (pts, fill, ex) => `<polygon points="${pts}" fill="${fill}"${ex || ''}/>`;
  const G = (inner, tf, ex) => `<g transform="${tf}"${ex || ''}>${inner}</g>`;
  const OP = (inner, o) => `<g opacity="${o}">${inner}</g>`;
  const SH = (cx, w) => E(cx, 184, w, 7, '#000000', ' opacity=".09"');
  const rnd = n => Math.round(n * 10) / 10;

  // deterministic pseudo-random (so every render of the same params is identical)
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // natural (theme independent) colors
  const K = {
    white: '#ffffff', ink: '#2b2f3a', red: '#ef4444', dred: '#b91c1c', green: '#22c55e', dgreen: '#15803d', lgreen: '#86efac',
    blue: '#3b82f6', dblue: '#1d4ed8', lblue: '#93c5fd', yellow: '#facc15', orange: '#fb923c', brown: '#92603a', dbrown: '#6b4226',
    wood: '#c58b55', lwood: '#e0b078', gray: '#94a3b8', lgray: '#e2e8f0', dgray: '#475569', gold: '#fbbf24', pink: '#f9a8d4',
    purple: '#a855f7', teal: '#14b8a6', cream: '#fff4de', sky: '#7dd3fc', metal: '#9aa7b4', dmetal: '#64748b'
  };
  const SKINS = { light: '#f6d3b3', fair: '#f6d3b3', tan: '#e0ac7e', olive: '#d19a66', brown: '#b9784a', dark: '#7a4a2e' };
  const HAIRS = { black: '#1f1a17', brown: '#5a3825', darkbrown: '#3d2b1f', blonde: '#e6c26e', red: '#b5482a', gray: '#b8b8b8', white: '#ececec', blue: '#3b6fd4', pink: '#e879a8', purple: '#7c4dcc' };

  // ---------- compact stroke-icon engine (48 x 48 grid) ----------
  function iconMarkup(spec, color, sw) {
    const nums = a => a.trim().split(/[\s,]+/).map(Number);
    const parts = String(spec).split(';').map(tok => {
      tok = tok.trim(); if (!tok) return '';
      const ty = tok[0], a = tok.slice(1).trim();
      const filled = ty === ty.toUpperCase();
      const fa = filled ? ` fill="${color}" stroke="none"` : '';
      if (ty === 'p' || ty === 'P') return `<path d="${a}"${fa}/>`;
      const n = nums(a);
      if (ty === 'c' || ty === 'C') return `<circle cx="${n[0]}" cy="${n[1]}" r="${n[2]}"${fa}/>`;
      if (ty === 'r' || ty === 'R') {
        const rot = n[5] ? ` transform="rotate(${n[5]} ${n[0] + n[2] / 2} ${n[1] + n[3] / 2})"` : '';
        return `<rect x="${n[0]}" y="${n[1]}" width="${n[2]}" height="${n[3]}" rx="${n[4] || 0}"${rot}${fa}/>`;
      }
      if (ty === 'e' || ty === 'E') {
        const rot = n[4] ? ` transform="rotate(${n[4]} ${n[0]} ${n[1]})"` : '';
        return `<ellipse cx="${n[0]}" cy="${n[1]}" rx="${n[2]}" ry="${n[3]}"${rot}${fa}/>`;
      }
      return '';
    }).join('');
    return `<g fill="none" stroke="${color}" stroke-width="${sw || 3}" stroke-linecap="round" stroke-linejoin="round">${parts}</g>`;
  }

  // ---------- ICON DATA ----------
  const ICON_GROUPS = {
    ui: {
      home: 'p M6 22L24 7L42 22; p M10 20V39H38V20; p M20 39V28H28V39',
      search: 'c 21 21 12; p M30 30L41 41',
      sliders: 'p M8 14H40; p M8 24H40; p M8 34H40; C 16 14 4; C 32 24 4; C 20 34 4',
      user: 'c 24 16 8; p M8 41C8 32 15 27 24 27C33 27 40 32 40 41',
      users: 'c 17 17 7; p M4 39C4 31 10 27 17 27C24 27 30 31 30 39; c 33 15 6; p M33 25C39 25 44 29 44 37',
      mail: 'r 5 10 38 28 4; p M6 14L24 28L42 14',
      phone: 'r 14 4 20 40 4; p M21 38H27',
      bell: 'p M12 34V22C12 15 17 10 24 10C31 10 36 15 36 22V34L40 38H8Z; p M20 42C21 44 27 44 28 42',
      lock: 'r 9 21 30 21 4; p M15 21V15C15 10 19 7 24 7C29 7 33 10 33 15V21; C 24 31 3',
      unlock: 'r 9 21 30 21 4; p M15 21V15C15 10 19 7 24 7C29 7 33 10 33 14; C 24 31 3',
      key: 'c 15 24 8; p M23 24H42; p M35 24V31; p M41 24V29',
      heart: 'p M24 41C10 31 6 23 6 17C6 11 10 7 15 7C19 7 22 9 24 13C26 9 29 7 33 7C38 7 42 11 42 17C42 23 38 31 24 41Z',
      bookmark: 'p M12 6H36V42L24 33L12 42Z',
      flag: 'p M11 43V6; p M11 8H37L31 16L37 24H11',
      pin: 'p M24 43C24 43 9 30 9 19C9 11 16 5 24 5C32 5 39 11 39 19C39 30 24 43 24 43Z; c 24 19 5',
      calendar: 'r 6 9 36 33 4; p M6 19H42; p M15 5V13; p M33 5V13; C 16 27 2; C 24 27 2; C 32 27 2; C 16 34 2; C 24 34 2',
      download: 'p M24 6V30; p M14 21L24 31L34 21; p M8 36V40H40V36',
      upload: 'p M24 32V8; p M14 17L24 7L34 17; p M8 36V40H40V36',
      share: 'C 12 24 5; C 36 11 5; C 36 37 5; p M16 22L32 13; p M16 26L32 35',
      link: 'p M20 28L28 20; p M22 14L26 10C30 6 36 6 39 9C42 12 42 18 38 22L34 26; p M26 34L22 38C18 42 12 42 9 39C6 36 6 30 10 26L14 22',
      trash: 'p M8 12H40; p M18 12V7H30V12; p M11 12L13 42H35L37 12; p M20 20V34; p M28 20V34',
      edit: 'p M7 41L9 31L32 8L40 16L17 39Z; p M28 12L36 20',
      plus: 'p M24 8V40; p M8 24H40',
      minus: 'p M8 24H40',
      close: 'p M10 10L38 38; p M38 10L10 38',
      menu: 'p M8 12H40; p M8 24H40; p M8 36H40',
      filter: 'p M6 9H42L29 25V39L19 43V25Z',
      refresh: 'p M40 24C40 33 33 40 24 40C15 40 8 33 8 24C8 15 15 8 24 8C29 8 34 10 37 14; p M38 6V15H29',
      eye: 'p M3 24C9 14 16 10 24 10C32 10 39 14 45 24C39 34 32 38 24 38C16 38 9 34 3 24Z; c 24 24 6',
      eye_off: 'p M3 24C9 14 16 10 24 10C32 10 39 14 45 24C39 34 32 38 24 38C16 38 9 34 3 24Z; c 24 24 6; p M8 42L40 6',
      camera: 'p M6 15H14L17 10H31L34 15H42V38H6Z; c 24 26 8',
      image: 'r 5 8 38 32 4; C 16 19 4; p M5 34L17 24L27 33L34 27L43 35',
      video: 'r 4 12 28 24 4; p M32 21L44 13V35L32 27Z',
      mic: 'r 17 5 14 24 7; p M10 22C10 30 16 36 24 36C32 36 38 30 38 22; p M24 36V43; p M17 43H31',
      speaker: 'p M6 19H14L26 9V39L14 29H6Z; p M32 18C35 22 35 26 32 30; p M37 12C43 19 43 29 37 36',
      wifi: 'p M4 18C15 8 33 8 44 18; p M10 25C18 18 30 18 38 25; p M16 32C21 28 27 28 32 32; C 24 39 2.5',
      battery: 'r 5 15 34 18 4; p M43 21V27; R 9 19 18 10 1',
      power: 'p M24 6V22; p M14 12C9 16 6 21 6 27C6 36 14 43 24 43C34 43 42 36 42 27C42 21 39 16 34 12',
      cloud: 'p M13 38C7 38 3 34 3 29C3 24 7 20 12 20C13 12 19 7 27 7C34 7 40 12 41 19C45 20 46 24 46 28C46 33 42 38 37 38Z',
      folder: 'p M4 12C4 10 5 9 7 9H18L23 15H41C43 15 44 16 44 18V37C44 39 43 40 41 40H7C5 40 4 39 4 37Z',
      file: 'p M11 4H28L38 14V44H11Z; p M28 4V14H38; p M17 26H32; p M17 34H32',
      copy: 'r 15 15 27 27 4; p M33 15V10C33 8 32 7 30 7H10C8 7 7 8 7 10V30C7 32 8 33 10 33H15',
      clipboard: 'r 8 9 32 34 4; r 16 4 16 8 3; p M15 24H33; p M15 32H27',
      printer: 'p M13 17V6H35V17; r 5 17 38 16 3; p M13 28H35V43H13Z',
      save: 'p M7 7H35L41 13V41H7Z; p M14 7V17H30V7; r 14 27 20 14 2',
      globe: 'c 24 24 19; p M5 24H43; p M24 5C15 14 15 34 24 43C33 34 33 14 24 5',
      map: 'p M4 11L16 6L32 12L44 7V37L32 42L16 36L4 41Z; p M16 6V36; p M32 12V42',
      compass: 'c 24 24 19; p M32 16L28 28L16 32L20 20Z',
      info: 'c 24 24 19; p M24 22V34; C 24 15 2.2',
      warning: 'p M24 6L45 41H3Z; p M24 19V29; C 24 35 2',
      help: 'c 24 24 19; p M18 19C18 15 21 13 24 13C28 13 30 16 30 19C30 24 24 24 24 29; C 24 35 2',
      check_circle: 'c 24 24 19; p M15 25L22 32L34 17',
      cross_circle: 'c 24 24 19; p M17 17L31 31; p M31 17L17 31',
      thumbs_up: 'p M4 21H12V42H4Z; p M12 23L21 6C25 6 27 9 26 13L25 19H39C42 19 44 22 43 25L39 39C38 41 37 42 35 42H12',
      arrow_up: 'p M24 40V8; p M12 20L24 8L36 20',
      arrow_down: 'p M24 8V40; p M12 28L24 40L36 28',
      arrow_left: 'p M40 24H8; p M20 12L8 24L20 36',
      arrow_right: 'p M8 24H40; p M28 12L40 24L28 36',
      exchange: 'p M10 16H38; p M31 9L38 16L31 23; p M38 32H10; p M17 25L10 32L17 39',
      undo: 'p M12 20H30C36 20 40 24 40 30C40 36 36 40 30 40H16; p M19 12L11 20L19 28',
      layers: 'p M24 6L43 16L24 26L5 16Z; p M5 24L24 34L43 24; p M5 32L24 42L43 32',
      grid: 'r 6 6 15 15 2; r 27 6 15 15 2; r 6 27 15 15 2; r 27 27 15 15 2',
      list: 'p M16 12H42; p M16 24H42; p M16 36H42; C 7 12 2; C 7 24 2; C 7 36 2',
      zoom_in: 'c 21 21 13; p M31 31L42 42; p M21 15V27; p M15 21H27',
      cursor: 'p M10 6L38 22L25 26L20 39Z',
      tag: 'p M6 6H24L42 24L24 42L6 24Z; C 15 15 3'
    },
    business: {
      chart_bar: 'p M6 6V42H42; r 12 24 6 12 1; r 22 16 6 20 1; r 32 9 6 27 1',
      chart_line: 'p M6 6V42H42; p M12 32L20 22L27 28L38 12; p M31 12H38V19',
      chart_pie: 'c 24 24 18; p M24 24V6; p M24 24L38 35',
      briefcase: 'r 5 14 38 26 4; p M17 14V9H31V14; p M5 26H43; p M21 26V30H27V26',
      coin: 'c 24 24 18; c 24 24 12',
      dollar: 'c 24 24 18; p M28 17C27 15 25 14 24 14C21 14 19 16 19 19C19 24 29 23 29 29C29 32 27 34 24 34C21 34 19 32 19 30; p M24 10V38',
      wallet: 'p M6 14C6 12 8 10 10 10H36V16; r 6 14 36 26 4; p M42 24H34C31 24 31 32 34 32H42',
      credit_card: 'r 4 10 40 28 4; p M4 20H44; p M10 30H18',
      bank: 'p M4 18L24 6L44 18Z; p M9 22V36; p M19 22V36; p M29 22V36; p M39 22V36; p M5 40H43',
      cart: 'p M4 6H10L16 30H38L43 13H12; c 19 39 3; c 35 39 3',
      bag: 'p M8 15H40L42 42H6Z; p M17 20V13C17 9 20 6 24 6C28 6 31 9 31 13V20',
      gift: 'r 6 19 36 22 2; r 4 12 40 8 2; p M24 12V41; p M24 12C24 12 18 12 16 9C14 6 18 3 21 5C23 6 24 12 24 12Z; p M24 12C24 12 30 12 32 9C34 6 30 3 27 5C25 6 24 12 24 12Z',
      presentation: 'r 5 6 38 24 3; p M24 30V40; p M16 43L24 40L32 43; p M12 22L19 15L25 20L34 11',
      trophy: 'p M14 6H34V20C34 26 30 30 24 30C18 30 14 26 14 20Z; p M14 10H7C7 17 10 20 14 20; p M34 10H41C41 17 38 20 34 20; p M24 30V38; p M15 42H33',
      medal: 'c 24 30 12; p M15 4L20 20; p M33 4L28 20; p M24 24L26 29H31L27 32L29 37L24 34L19 37L21 32L17 29H22Z',
      crown: 'p M5 15L14 26L24 9L34 26L43 15L38 38H10Z; p M10 42H38',
      rocket: 'p M24 4C32 10 34 20 32 32H16C14 20 16 10 24 4Z; c 24 20 4; p M16 26L8 34V40L16 34; p M32 26L40 34V40L32 34; p M20 38C21 43 23 45 24 45C25 45 27 43 28 38',
      trend_up: 'p M4 34L16 22L24 30L42 12; p M30 12H42V24',
      trend_down: 'p M4 12L16 24L24 16L42 34; p M30 34H42V22',
      calculator: 'r 9 4 30 40 4; r 14 9 20 8 1; C 16 25 2; C 24 25 2; C 32 25 2; C 16 32 2; C 24 32 2; C 32 32 2; C 16 39 2; C 24 39 2; C 32 39 2',
      piggy_bank: 'e 23 27 17 12; p M14 18L12 11L20 15; C 32 24 1.6; p M12 37V43; p M20 39V43; p M30 39V43; p M36 36V43; p M40 26H44; p M20 15H27',
      percent: 'c 14 14 5; c 34 34 5; p M38 10L10 38',
      diamond: 'p M14 8H34L44 19L24 42L4 19Z; p M4 19H44; p M17 19L24 42L31 19L26 8; p M22 8L17 19',
      scale: 'p M24 6V40; p M14 42H34; p M8 12H40; p M8 12L3 26H13Z; p M40 12L35 26H45Z',
      store: 'p M6 18L9 6H39L42 18C42 22 39 24 36 24C33 24 30 22 30 18C30 22 27 24 24 24C21 24 18 22 18 18C18 22 15 24 12 24C9 24 6 22 6 18Z; p M9 24V42H39V24; r 19 30 10 12 0',
      handshake: 'p M4 22L14 14L22 18L28 14L38 16L44 22L38 30L30 38L22 34L14 32Z; p M22 18L28 26L22 30',
      bulb: 'p M18 34H30; p M19 40H29; p M24 4C16 4 11 10 11 17C11 23 15 26 17 30V34H31V30C33 26 37 23 37 17C37 10 32 4 24 4Z',
      id_card: 'r 4 9 40 30 4; c 16 21 5; p M8 33C9 29 12 27 16 27C20 27 23 29 24 33; p M28 19H38; p M28 26H38',
      envelope_open: 'p M5 20L24 6L43 20V40H5Z; p M5 20L24 32L43 20'
    },
    tech: {
      laptop: 'r 8 9 32 22 3; p M3 38H45L41 31H7Z',
      monitor: 'r 4 6 40 28 3; p M24 34V41; p M15 43H33',
      tablet: 'r 10 4 28 40 4; p M22 38H26',
      code: 'p M16 14L6 24L16 34; p M32 14L42 24L32 34; p M27 9L21 39',
      terminal: 'r 4 8 40 32 4; p M12 18L20 25L12 32; p M24 32H34',
      database: 'e 24 11 16 6; p M8 11V37C8 40 15 43 24 43C33 43 40 40 40 37V11; p M8 24C8 27 15 30 24 30C33 30 40 27 40 24',
      server: 'r 6 6 36 14 3; r 6 28 36 14 3; C 13 13 2; C 13 35 2; p M22 13H36; p M22 35H36',
      cpu: 'r 12 12 24 24 3; r 19 19 10 10 1; p M18 12V5; p M24 12V5; p M30 12V5; p M18 36V43; p M24 36V43; p M30 36V43; p M12 18H5; p M12 24H5; p M12 30H5; p M36 18H43; p M36 24H43; p M36 30H43',
      bug: 'e 24 27 10 13; p M24 14V40; p M14 27H34; p M18 12L22 16; p M30 12L26 16; p M6 20L14 24; p M42 20L34 24; p M6 36L14 31; p M42 36L34 31',
      shield: 'p M24 4L40 10V23C40 33 33 40 24 44C15 40 8 33 8 23V10Z',
      shield_check: 'p M24 4L40 10V23C40 33 33 40 24 44C15 40 8 33 8 23V10Z; p M16 24L22 30L32 18',
      fingerprint: 'p M14 20C14 14 18 10 24 10C30 10 34 14 34 20V26; p M9 22C9 13 15 6 24 6C33 6 39 13 39 22V30C39 34 37 38 34 41; p M19 20V27C19 32 17 36 14 40; p M24 17C27 17 29 19 29 22V28C29 34 27 39 24 43',
      robot: 'r 9 15 30 24 5; c 18 26 3; c 30 26 3; p M18 33H30; p M24 15V8; C 24 6 2; p M4 24V30; p M44 24V30',
      network: 'C 24 9 5; C 9 37 5; C 39 37 5; p M22 13L12 33; p M26 13L36 33; p M14 37H34',
      antenna: 'p M24 26V42; p M16 42H32; c 24 20 4; p M15 12C11 17 11 23 15 28; p M33 12C37 17 37 23 33 28; p M9 7C2 15 2 25 9 33; p M39 7C46 15 46 25 39 33',
      qr_code: 'r 6 6 14 14 2; r 28 6 14 14 2; r 6 28 14 14 2; R 11 11 4 4 0; R 33 11 4 4 0; R 11 33 4 4 0; p M28 28H34; p M42 28V34; p M28 36V42H36; p M40 40H42',
      keyboard: 'r 3 12 42 24 4; p M9 19H11; p M16 19H18; p M23 19H25; p M30 19H32; p M37 19H39; p M9 25H11; p M16 25H18; p M23 25H25; p M30 25H32; p M37 25H39; p M14 31H34',
      mouse: 'r 13 5 22 38 11; p M24 5V21; p M13 21H35',
      headphones: 'p M8 30V24C8 14 15 7 24 7C33 7 40 14 40 24V30; r 5 28 8 14 3; r 35 28 8 14 3',
      gamepad: 'r 4 14 40 22 10; p M14 22V30; p M10 26H18; C 32 23 2; C 37 28 2',
      vr_headset: 'r 4 14 40 20 6; c 15 24 4; c 33 24 4; p M20 34L24 29L28 34',
      drone: 'r 19 20 10 8 2; p M14 16L19 21; p M34 16L29 21; p M14 32L19 27; p M34 32L29 27; c 10 12 5; c 38 12 5; c 10 36 5; c 38 36 5',
      plug: 'p M17 5V16; p M31 5V16; p M11 16H37V25C37 31 31 36 24 36C17 36 11 31 11 25Z; p M24 36V44',
      smartwatch: 'r 14 12 20 24 6; p M17 12L19 4H29L31 12; p M17 36L19 44H29L31 36; p M24 20V25L28 27',
      cloud_upload: 'p M13 36C7 36 3 32 3 27C3 22 7 18 12 18C13 10 19 5 27 5C34 5 40 10 41 17C45 18 46 22 46 26C46 31 42 36 37 36; p M24 43V24; p M17 30L24 23L31 30',
      chip: 'r 10 10 28 28 4; c 24 24 6; p M17 10V4; p M31 10V4; p M17 44V38; p M31 44V38; p M10 17H4; p M10 31H4; p M44 17H38; p M44 31H38',
      bluetooth: 'p M14 15L34 33L24 43V5L34 15L14 33',
      usb: 'p M24 42V10; p M24 10L20 16H28Z; p M24 30L14 24V19; p M24 26L34 20V17; R 11 14 6 5 0; c 34 14 3',
      globe_net: 'c 24 24 19; e 24 24 8 19; p M5 24H43; p M9 14H39; p M9 34H39'
    },
    education: {
      graduation_cap: 'p M2 18L24 8L46 18L24 28Z; p M11 23V33C11 36 17 40 24 40C31 40 37 36 37 33V23; p M43 20V32',
      book_open: 'p M24 12C19 8 11 8 4 10V38C11 36 19 36 24 40C29 36 37 36 44 38V10C37 8 29 8 24 12Z; p M24 12V40',
      pencil: 'p M7 41L10 30L33 7L41 15L18 38Z; p M28 12L36 20',
      ruler: 'r 3 15 42 18 2; p M10 15V22; p M17 15V25; p M24 15V22; p M31 15V25; p M38 15V22',
      atom: 'e 24 24 20 8 0; e 24 24 20 8 60; e 24 24 20 8 120; C 24 24 3',
      flask: 'p M18 4H30; p M20 4V18L8 40C7 42 8 44 10 44H38C40 44 41 42 40 40L28 18V4; p M13 34H35',
      microscope: 'p M16 6H26V26H16Z; p M21 26V30; p M12 44H38; p M14 40C14 32 20 30 28 30C36 30 40 34 40 40; p M34 12C40 14 42 20 40 26',
      telescope: 'p M6 26L36 10L40 18L10 34Z; p M28 14L32 22; p M20 30L14 44; p M22 30L30 44',
      dna: 'p M14 4C14 16 34 32 34 44; p M34 4C34 16 14 32 14 44; p M18 12H30; p M19 24H29; p M18 36H30',
      magnet: 'p M8 6H18V26C18 30 30 30 30 26V6H40V26C40 38 32 44 24 44C16 44 8 38 8 26Z; p M8 14H18; p M30 14H40',
      backpack: 'p M12 14C12 8 17 5 24 5C31 5 36 8 36 14; r 8 14 32 30 8; r 15 28 18 12 3; p M8 24H40',
      blackboard: 'r 4 8 40 28 2; p M10 16H26; p M10 24H34; p M12 40H36',
      palette: 'p M24 5C13 5 5 13 5 24C5 35 13 43 22 43C27 43 27 39 24 36C22 33 24 30 28 30H34C39 30 43 27 43 22C43 12 35 5 24 5Z; C 15 21 3; C 22 14 3; C 32 14 3; C 37 21 3',
      brush: 'p M40 5L20 25; p M20 25C16 25 13 28 13 32C13 36 11 39 7 41C15 44 25 42 27 33C27 30 26 27 20 25',
      music: 'p M18 36V10L38 6V32; C 12 37 6; C 32 33 6',
      puzzle: 'p M6 16H15C13 10 20 6 22 12C24 6 32 10 29 16H40V26C34 24 34 34 40 32V42H6Z',
      brain: 'p M24 8C21 4 14 5 13 10C8 10 5 15 8 19C4 23 6 29 11 30C11 36 18 39 22 36C23 38 25 38 26 36C30 39 37 36 37 30C42 29 44 23 40 19C43 15 40 10 35 10C34 5 27 4 24 8Z; p M24 8V38',
      lightning: 'p M27 4L10 26H23L20 44L38 20H25Z',
      molecule: 'C 24 24 6; C 8 12 4; C 40 12 4; C 8 38 4; C 40 38 4; p M12 14L20 20; p M36 14L28 20; p M12 36L20 28; p M36 36L28 28',
      test_tube: 'p M15 4H33; p M18 4V34C18 40 21 44 24 44C27 44 30 40 30 34V4; p M18 24H30',
      planet: 'c 24 24 12; e 24 24 22 7 -25',
      certificate: 'r 4 8 40 26 3; p M11 16H37; p M11 23H29; c 35 34 5; p M32 38L30 45L35 42L40 45L38 38',
      abc: 'p M6 36L13 12L20 36; p M8.5 28H17.5; p M27 12V36H34C38 36 39 33 39 30C39 27 37 24 34 24H27; p M27 24H33C36 24 37 22 37 18C37 14 35 12 32 12H27',
      library: 'r 6 6 8 36 1; r 16 12 8 30 1; p M28 10L36 8L42 40L34 42Z',
      earth: 'c 24 24 19; p M11 12C14 16 18 16 20 20C22 24 18 27 20 32; p M28 8C28 12 33 13 37 15C40 18 38 22 34 24C31 26 32 30 36 32'
    },
    health: {
      medical_cross: 'p M18 5H30V18H43V30H30V43H18V30H5V18H18Z',
      heartbeat: 'p M24 41C10 31 6 23 6 17C6 11 10 7 15 7C19 7 22 9 24 13C26 9 29 7 33 7C38 7 42 11 42 17C42 23 38 31 24 41Z; p M10 22H18L21 16L26 28L29 22H38',
      pill: 'r 4 16 40 16 8 -45; p M17 31L31 17',
      syringe: 'p M30 6L42 18; p M34 10L14 30V36L20 42H26L38 22; p M14 36L6 44; p M24 20L28 24',
      stethoscope: 'p M12 6V20C12 27 17 31 22 31C27 31 32 27 32 20V6; p M8 6H16; p M28 6H36; p M22 31V34C22 40 27 43 32 43C38 43 41 39 41 34; c 41 29 4',
      bandage: 'r 4 16 40 16 8 -45; r 18 18 12 12 1 -45; C 22 22 1.4; C 26 26 1.4',
      thermometer: 'p M20 30V10C20 6 28 6 28 10V30C32 32 34 36 34 39C34 44 30 46 24 46C18 46 14 44 14 39C14 36 16 32 20 30Z',
      tooth: 'p M12 6C8 6 5 10 5 15C5 22 10 26 11 34C12 40 13 44 16 44C19 44 20 38 24 38C28 38 29 44 32 44C35 44 36 40 37 34C38 26 43 22 43 15C43 10 40 6 36 6C31 6 28 9 24 9C20 9 17 6 12 6Z',
      apple: 'p M24 15C20 12 8 12 8 26C8 36 14 43 19 43C22 43 23 42 24 42C25 42 26 43 29 43C34 43 40 36 40 26C40 12 28 12 24 15Z; p M24 15C24 10 26 7 30 5',
      dumbbell: 'p M6 19V29; p M11 14V34; p M37 14V34; p M42 19V29; p M11 24H37',
      water_drop: 'p M24 5C24 5 10 21 10 30C10 38 16 43 24 43C32 43 38 38 38 30C38 21 24 5 24 5Z',
      first_aid: 'r 5 12 38 28 4; p M17 12V8H31V12; p M24 20V32; p M18 26H30',
      hospital: 'r 8 8 32 34 2; p M24 16V28; p M18 22H30; p M20 42V34H28V42',
      sleep: 'p M38 30C28 32 18 25 18 14C18 11 19 8 20 6C11 9 6 18 8 27C10 36 19 42 29 40C33 39 36 36 38 30Z',
      yoga: 'c 24 9 4; p M24 14V28; p M10 22L24 18L38 22; p M24 28L14 40; p M24 28L34 40; p M8 44H40',
      lungs: 'p M24 6V24; p M24 24C24 24 20 28 16 26C10 30 6 40 10 42C16 44 22 38 22 30V16C22 12 24 10 24 6; p M24 24C24 24 28 28 32 26C38 30 42 40 38 42C32 44 26 38 26 30',
      wheelchair: 'c 20 8 4; p M20 14V26H32L38 40; p M20 20H30; c 20 32 9; p M14 44H40',
      ambulance_cross: 'r 4 14 30 22 3; p M34 20H41L45 28V36H34; c 14 38 4; c 36 38 4; p M19 20V30; p M14 25H24'
    },
    nature: {
      sun: 'c 24 24 9; p M24 4V10; p M24 38V44; p M4 24H10; p M38 24H44; p M10 10L14 14; p M34 34L38 38; p M38 10L34 14; p M10 38L14 34',
      moon_stars: 'p M34 30C24 32 14 25 14 14C14 11 15 8 16 6C7 9 2 18 4 27C6 36 15 42 25 40C29 39 32 36 34 30Z; C 36 10 2; C 42 20 1.6; C 30 5 1.4',
      cloud_rain: 'p M13 30C8 30 5 26 5 22C5 18 8 15 12 15C13 9 18 5 24 5C30 5 35 9 36 14C40 14 43 17 43 22C43 26 40 30 35 30Z; p M16 36L13 43; p M25 36L22 43; p M34 36L31 43',
      cloud_snow: 'p M13 30C8 30 5 26 5 22C5 18 8 15 12 15C13 9 18 5 24 5C30 5 35 9 36 14C40 14 43 17 43 22C43 26 40 30 35 30Z; C 15 38 1.8; C 24 41 1.8; C 33 38 1.8',
      storm: 'p M13 30C8 30 5 26 5 22C5 18 8 15 12 15C13 9 18 5 24 5C30 5 35 9 36 14C40 14 43 17 43 22C43 26 40 30 35 30Z; p M25 30L18 38H25L21 45',
      wind: 'p M4 18H28C34 18 34 8 28 8; p M4 26H38C44 26 44 38 36 38; p M4 33H20C24 33 24 40 20 40',
      rainbow: 'p M4 38C4 20 13 10 24 10C35 10 44 20 44 38; p M11 38C11 24 17 17 24 17C31 17 37 24 37 38; p M18 38C18 29 20 24 24 24C28 24 30 29 30 38',
      flame: 'p M24 4C24 4 12 16 12 28C12 36 17 43 24 43C31 43 36 36 36 28C36 24 34 21 32 18C31 22 29 24 27 24C29 16 24 4 24 4Z',
      leaf: 'p M8 40C6 20 18 8 42 6C42 30 32 42 12 40Z; p M8 40L28 20',
      tree_pine: 'p M24 5L36 24H29L39 37H9L19 24H12Z; p M24 37V44',
      tree_round: 'c 24 19 14; p M24 33V44; p M24 40L18 35; p M24 37L30 31',
      flower: 'c 24 24 5; c 24 12 6; c 24 36 6; c 12 24 6; c 36 24 6',
      mountain: 'p M3 40L18 12L28 28L34 20L45 40Z; p M14 19L18 23L22 19',
      wave: 'p M4 20C10 12 16 12 22 20C28 28 34 28 40 20; p M4 34C10 26 16 26 22 34C28 42 34 42 44 32',
      umbrella: 'p M4 24C4 13 13 5 24 5C35 5 44 13 44 24Z; p M24 24V38C24 42 30 42 30 38',
      snowflake: 'p M24 4V44; p M7 14L41 34; p M7 34L41 14; p M19 8L24 12L29 8; p M19 40L24 36L29 40',
      sparkles: 'P M20 6L23 17L34 20L23 23L20 34L17 23L6 20L17 17Z; P M36 26L38 32L44 34L38 36L36 42L34 36L28 34L34 32Z',
      recycle: 'p M20 8L28 8L34 18; p M30 14L34 18L27 20; p M39 30L35 38L26 38; p M30 34L26 38L30 43; p M9 30L13 38L22 38; p M8 26L9 30L14 28; p M17 43L13 38L18 34; p M18 22L14 14L20 8',
      seedling: 'p M24 44V22; p M24 26C24 16 16 10 6 12C6 22 12 28 24 26; p M24 20C24 12 30 6 40 6C40 16 34 22 24 20',
      paw: 'e 24 32 10 8 0; e 10 22 4 6 -20; e 19 12 4 6 -8; e 29 12 4 6 8; e 38 22 4 6 20',
      fish: 'p M4 24C10 12 24 10 32 20L44 12V36L32 28C24 38 10 36 4 24Z; C 14 22 2',
      bird: 'p M8 30C8 20 16 14 24 16C28 8 38 8 42 12L44 14L38 16C38 30 30 40 18 40C12 40 8 36 8 30Z; C 34 16 1.5',
      butterfly: 'p M24 14V38; p M24 24C18 8 6 10 8 22C9 28 16 28 24 26; p M24 26C18 30 12 32 14 40C22 42 24 34 24 26; p M24 24C30 8 42 10 40 22C39 28 32 28 24 26; p M24 26C30 30 36 32 34 40C26 42 24 34 24 26',
      volcano: 'p M4 42L18 16H30L44 42Z; p M18 16C18 12 22 10 24 10C26 10 30 12 30 16; p M24 4V8; p M17 6L19 9; p M31 6L29 9',
      cactus: 'p M24 44V10C24 5 30 5 30 10V44; p M24 30H16C12 30 12 20 16 20V26; p M30 26H36C40 26 40 16 36 16V22; p M14 44H40',
      mushroom: 'p M6 26C6 14 14 6 24 6C34 6 42 14 42 26Z; p M18 26V38C18 42 30 42 30 38V26; C 16 18 2.5; C 30 15 2.5',
      shell: 'p M24 6C10 6 4 20 8 32C10 40 18 44 24 44C30 44 38 40 40 32C44 20 38 6 24 6Z; p M24 44V12; p M24 44L12 16; p M24 44L36 16; p M24 44L7 26; p M24 44L41 26'
    },
    transport: {
      car: 'p M5 30L9 20C10 16 13 14 17 14H31C35 14 37 16 39 20L43 30V37H5Z; p M12 22H36; c 14 38 4; c 34 38 4',
      bus: 'r 6 6 36 34 6; p M6 24H42; p M6 15H42; c 15 41 3; c 33 41 3; p M14 32H16; p M32 32H34',
      train: 'r 10 4 28 34 6; p M10 24H38; r 15 9 18 10 2; p M16 38L10 45; p M32 38L38 45; C 17 31 2; C 31 31 2',
      plane: 'p M4 26L22 21L14 5H19L33 20L42 17C45 16 46 19 43 21L34 26L40 42H35L24 31L8 36Z',
      ship: 'p M4 30H44L38 40H10Z; p M12 30V20H36V30; p M24 20V8H32; p M20 20V15',
      bicycle: 'c 11 32 8; c 37 32 8; p M11 32L19 16H28L37 32; p M19 16L24 32H11; p M28 16L24 32; p M16 10H22; p M28 16L34 10H38',
      fuel: 'r 8 8 22 34 3; r 13 13 12 8 1; p M30 20H36C39 20 40 22 40 25V36C40 39 43 39 43 36V16L38 11',
      tent: 'p M4 40L24 8L44 40Z; p M17 40L24 26L31 40',
      suitcase: 'r 6 14 36 28 4; p M17 14V8H31V14; p M6 26H42; p M17 26V32; p M31 26V32',
      ticket: 'p M4 14H44V21C40 21 40 27 44 27V34H4V27C8 27 8 21 4 21Z; p M32 14V34',
      hotel: 'r 8 5 32 38 2; p M15 14H19; p M29 14H33; p M15 22H19; p M29 22H33; p M20 43V33H28V43',
      anchor: 'c 24 9 4; p M24 13V42; p M14 20H34; p M8 30C8 38 16 43 24 43C32 43 40 38 40 30; p M4 32L8 28L12 32; p M36 32L40 28L44 32',
      traffic_light: 'r 14 4 20 40 5; c 24 14 4; c 24 24 4; c 24 34 4',
      motorbike: 'c 10 32 8; c 38 32 8; p M10 32L20 20H30L38 32; p M18 20L14 14H10; p M28 20L32 12H38; p M20 32H30',
      helicopter: 'p M6 10H42; p M24 10V16; e 22 26 14 9; p M36 24L46 20; p M12 36H34; p M16 35V36',
      sailboat: 'p M24 4V34; p M24 6L40 30H24; p M24 12L12 30H24; p M6 36H42L36 44H12Z',
      skateboard: 'p M4 20C6 26 10 28 14 28H34C38 28 42 26 44 20; c 14 36 4; c 34 36 4',
      map_route: 'c 10 36 5; c 38 12 5; p M15 36H28C36 36 36 24 28 24H20C12 24 12 12 20 12H33',
      parking: 'r 6 6 36 36 6; p M18 36V12H27C33 12 33 26 27 26H18'
    },
    food: {
      coffee: 'p M8 16H32V32C32 38 28 42 22 42H18C12 42 8 38 8 32Z; p M32 20H37C41 20 41 30 36 30H32; p M15 6V11; p M22 4V11',
      pizza: 'p M4 12C20 2 34 2 44 12L24 44Z; c 20 16 3; c 30 16 3; c 24 28 3',
      burger: 'p M6 22C6 12 14 6 24 6C34 6 42 12 42 22Z; p M6 28H42; p M8 28C8 32 12 32 14 30C18 34 22 34 24 30C28 34 32 34 34 30C36 32 40 32 40 28; p M6 36H42V38C42 40 40 42 38 42H10C8 42 6 40 6 38Z',
      cake: 'r 8 24 32 18 3; p M8 32C12 36 16 36 20 32C24 36 28 36 32 32C36 36 38 36 40 32; p M24 24V16; p M24 6C24 6 21 10 24 12C27 10 24 6 24 6Z',
      ice_cream: 'p M14 22C10 22 8 18 10 15C12 10 18 8 24 8C30 8 36 10 38 15C40 18 38 22 34 22Z; p M14 22L24 44L34 22',
      fork_knife: 'p M14 4V16C14 20 18 20 18 16V4; p M16 20V44; p M32 4C28 8 28 16 32 22V44; p M32 4V22',
      wine: 'p M14 4H34C34 20 30 28 24 28C18 28 14 20 14 4Z; p M24 28V42; p M15 44H33',
      egg: 'p M24 5C15 5 9 20 9 30C9 38 16 43 24 43C32 43 39 38 39 30C39 20 33 5 24 5Z',
      bread: 'p M10 18C4 18 4 8 12 8H36C44 8 44 18 38 18V38C38 40 36 42 34 42H14C12 42 10 40 10 38Z',
      cookie: 'c 24 24 18; C 17 18 2; C 30 16 2; C 30 30 2; C 18 31 2; C 24 24 2',
      carrot: 'p M38 10C44 16 34 24 20 38C14 44 8 42 8 42C8 42 6 36 12 30C26 14 32 4 38 10Z; p M34 6L40 2; p M40 12L44 8',
      lemon: 'p M6 28C6 16 16 8 28 10L38 6L36 16C42 26 32 42 20 40C12 40 6 36 6 28Z',
      cheese: 'p M4 34L44 24V16L4 12Z; p M4 34V40H44V24; c 14 30 3; c 30 27 2',
      soda: 'p M14 8H34L32 42H16Z; p M12 8H36; p M24 8L28 2H34; p M15 20H33',
      fries: 'p M10 20H38L34 44H14Z; p M14 20V8M20 20V4M26 20V6M32 20V10',
      donut: 'c 24 24 18; c 24 24 6; p M14 12L16 15; p M32 10L30 14; p M38 26L34 26; p M12 30L16 28'
    },
    home_tools: {
      wrench: 'p M32 6C26 6 22 11 23 17L6 34C4 36 4 40 6 42C8 44 12 44 14 42L31 25C37 26 42 22 42 16L35 22L28 18L27 11L34 6Z',
      hammer: 'r 10 6 28 12 3; p M24 18V44',
      screwdriver: 'p M8 40L28 20; p M28 20L36 12; p M34 6L42 14L38 18L30 10Z',
      lamp: 'p M14 6H34L40 24H8Z; p M24 24V40; p M14 44H34',
      bed: 'p M4 38V12; p M4 26H44V38; p M44 26V20C44 16 40 14 36 14H20V26; c 12 20 4',
      sofa: 'p M8 22V16C8 12 11 10 14 10H34C37 10 40 12 40 16V22; p M4 24C4 20 10 20 10 24V32H38V24C38 20 44 20 44 24V36H4Z; p M8 36V42; p M40 36V42',
      door: 'r 10 4 28 40 2; C 32 25 2',
      window: 'r 6 6 36 36 3; p M24 6V42; p M6 24H42',
      ladder: 'p M14 4V44; p M34 4V44; p M14 12H34; p M14 22H34; p M14 32H34',
      bucket: 'p M8 12H40L36 42H12Z; p M8 12C8 4 40 4 40 12',
      broom: 'p M38 4L24 26; p M16 24L32 32L26 44H6C6 36 10 28 16 24Z',
      scissors: 'c 12 36 6; c 12 12 6; p M17 16L42 34; p M17 32L42 14',
      toolbox: 'r 4 16 40 26 3; p M16 16V10H32V16; p M4 28H44; p M21 25V31H27V25',
      paint_roller: 'r 6 6 30 12 3; p M36 12H42V26H22V34; r 18 34 8 10 2',
      hard_hat: 'p M6 32C6 20 14 12 24 12C34 12 42 20 42 32Z; p M3 32H45V38H3Z; p M20 12V8H28V12; p M24 12V32',
      chair: 'p M12 6V26H36V6; p M10 26H38V32H10Z; p M14 32V44; p M34 32V44',
      fridge: 'r 10 3 28 42 3; p M10 18H38; p M15 9V14; p M15 23V32',
      washer: 'r 7 4 34 40 3; c 24 27 10; c 24 27 5; p M12 10H16; p M22 10H36',
      tv: 'r 4 8 40 26 3; p M16 42H32; p M24 34V42; p M14 2L24 8L34 2',
      bath: 'p M6 22H42V28C42 36 36 40 30 40H18C12 40 6 36 6 28Z; p M10 22V10C10 6 16 6 16 10; p M12 40L10 44; p M36 40L38 44',
      plant_pot: 'p M12 26H36L32 44H16Z; p M24 26V14; p M24 20C24 12 16 10 12 12C12 18 16 22 24 20; p M24 16C24 8 32 6 36 8C36 14 32 18 24 16'
    },
    comms: {
      chat_dots: 'p M6 8H42V32H24L14 42V32H6Z; C 15 20 2; C 24 20 2; C 33 20 2',
      megaphone: 'p M6 20V30H12L32 40V10L12 20Z; p M12 30L15 42H21L18 33; p M38 18C41 22 41 28 38 32',
      at_sign: 'c 24 24 6; p M30 18V27C30 31 39 31 39 24C39 13 32 7 24 7C14 7 8 15 8 24C8 34 15 41 24 41C29 41 33 39 36 36',
      hashtag: 'p M18 6L14 42; p M34 6L30 42; p M8 18H42; p M6 30H40',
      send: 'p M42 6L4 22L18 28L24 42Z; p M18 28L42 6',
      rss: 'C 10 38 3; p M8 22C20 22 26 28 26 40; p M8 8C28 8 40 20 40 40',
      newspaper: 'r 6 8 36 32 3; r 12 14 12 10 1; p M28 15H37; p M28 22H37; p M12 30H37; p M12 35H37',
      quote: 'P M6 28C6 20 10 14 18 12L19 16C15 18 14 21 14 24H19V34H6Z; P M26 28C26 20 30 14 38 12L39 16C35 18 34 21 34 24H39V34H26Z',
      smile: 'c 24 24 19; C 17 20 2; C 31 20 2; p M15 29C19 35 29 35 33 29',
      sad: 'c 24 24 19; C 17 20 2; C 31 20 2; p M15 35C19 29 29 29 33 35',
      neutral: 'c 24 24 19; C 17 20 2; C 31 20 2; p M16 32H32',
      wink: 'c 24 24 19; C 17 20 2; p M27 20H35; p M15 29C19 35 29 35 33 29',
      phone_call: 'p M10 6H18L22 16L17 20C19 26 22 29 28 31L32 26L42 30V38C42 41 39 43 36 42C20 40 8 28 6 12C5 9 7 6 10 6Z',
      podcast: 'r 18 4 12 22 6; p M10 22C10 30 16 36 24 36C32 36 38 30 38 22; p M24 36V44; p M16 44H32',
      language: 'c 24 24 19; p M14 16H28; p M21 12V16; p M16 30C22 26 26 22 26 16; p M18 20C20 26 26 30 30 30; p M28 42L36 22L44 42; p M31 36H41'
    },
    fun_time: {
      soccer: 'c 24 24 19; p M24 14L33 21L30 31H18L15 21Z; p M24 14V5; p M33 21L42 18; p M30 31L36 39; p M18 31L12 39; p M15 21L6 18',
      basketball: 'c 24 24 19; p M5 24H43; p M24 5V43; p M10 10C17 16 17 32 10 38; p M38 10C31 16 31 32 38 38',
      dice: 'r 6 6 36 36 6; C 16 16 2.5; C 32 16 2.5; C 24 24 2.5; C 16 32 2.5; C 32 32 2.5',
      guitar: 'p M28 20L41 7; p M38 4L44 10; p M26 22C22 18 16 20 14 24C10 24 6 28 6 33C6 40 12 44 19 42C24 40 26 36 26 32C30 30 32 26 26 22Z',
      balloon: 'p M24 4C14 4 10 12 10 19C10 28 18 34 24 36C30 34 38 28 38 19C38 12 34 4 24 4Z; p M22 36L26 36L24 40; p M24 40C20 43 28 45 24 47',
      party: 'p M8 42L16 14L36 34Z; p M28 8V12; p M40 18H44; p M36 6L39 9',
      chess: 'p M17 42H31; p M19 42L21 26H27L29 42; p M15 26H33; c 24 16 6; p M24 4V8',
      hourglass: 'p M12 4H36; p M12 44H36; p M14 4C14 16 24 20 24 24C24 28 14 32 14 44; p M34 4C34 16 24 20 24 24C24 28 34 32 34 44',
      alarm: 'c 24 26 15; p M24 18V26L30 30; p M8 10L14 4; p M40 10L34 4',
      stopwatch: 'c 24 27 16; p M24 27V18; p M20 6H28; p M24 6V11; p M38 13L41 10',
      watch: 'r 14 12 20 24 6; p M17 12L19 4H29L31 12; p M17 36L19 44H29L31 36; p M24 20V25L28 27',
      glasses: 'c 13 28 8; c 35 28 8; p M21 28H27; p M5 28L8 14; p M43 28L40 14',
      tennis: 'p M32 4C40 4 44 12 40 20C36 28 26 30 20 26C14 22 16 8 24 5C27 4 30 4 32 4Z; p M22 28L10 40; p M6 44L10 40',
      swimming: 'c 34 10 4; p M8 24L24 16L36 26; p M4 34C9 30 13 30 18 34C23 38 27 38 32 34C37 30 41 30 44 34',
      film: 'r 4 8 40 32 3; p M14 8V40; p M34 8V40; p M4 16H14; p M4 24H14; p M4 32H14; p M34 16H44; p M34 24H44; p M34 32H44',
      game_target: 'c 24 24 18; c 24 24 11; c 24 24 4; p M24 2V10; p M24 38V46; p M2 24H10; p M38 24H46'
    },
    weather: {
      sun_icon:      'c 24 24 9; p M24 3V8; p M24 40V45; p M3 24H8; p M40 24H45; p M9 9L13 13; p M35 35L39 39; p M39 9L35 13; p M9 39L13 35',
      moon_icon:     'p M34 30C24 32 14 25 14 14C14 11 15 8 16 6C7 9 2 18 4 27C6 36 15 42 25 40C29 39 32 36 34 30Z',
      cloud_icon:    'p M13 34C7 34 3 30 3 25C3 20 7 17 12 17C13 11 18 7 25 7C32 7 38 12 39 18C43 19 45 22 45 26C45 31 41 34 36 34Z',
      rain_icon:     'p M13 28C7 28 3 24 3 19C3 14 7 11 12 11C13 5 18 1 25 1C32 1 38 6 39 12C43 13 45 16 45 20C45 25 41 28 36 28Z; p M15 32L12 41; p M23 32L20 41; p M31 32L28 41',
      snow_icon:     'p M13 28C7 28 3 24 3 19C3 14 7 11 12 11C13 5 18 1 25 1C32 1 38 6 39 12C43 13 45 16 45 20C45 25 41 28 36 28Z; C 14 36 2; C 24 40 2; C 34 36 2',
      wind_icon:     'p M3 15H28C34 15 34 5 28 5; p M3 24H40C46 24 46 36 38 36; p M3 32H20C24 32 24 40 20 40',
      lightning_icon:'p M26 3L8 26H22L18 45L38 20H24Z',
      tornado_icon:  'p M3 8H45; p M6 15H40; p M9 22H35; p M13 29H29; p M17 36H24; p M20 43H22',
      thermometer_icon:'p M22 30V10C22 6 28 6 28 10V30C32 32 34 36 34 39C34 44 30 46 24 46C18 46 14 44 14 39C14 36 16 32 22 30Z',
      rainbow_icon:  'p M4 40C4 22 13 12 24 12C35 12 44 22 44 40; p M11 40C11 26 17 19 24 19C31 19 37 26 37 40; p M18 40C18 32 20 27 24 27C28 27 30 32 30 40'
    },
    fitness: {
      dumbbell_icon: 'p M4 18V30; p M10 12V36; p M36 12V36; p M42 18V30; p M10 24H36',
      running_icon:  'c 26 8 4; p M15 22L23 18L29 26L35 28; p M29 26L23 34L29 42; p M23 18L17 24; p M11 30L17 30',
      yoga_icon:     'c 24 8 4; p M20 16V24; p M24 24V40; p M20 24H28; p M8 30C14 26 20 26 24 30C28 26 34 26 40 30; p M14 42H34',
      bicycle_icon:  'c 11 32 8; c 37 32 8; p M11 32L19 16H28L37 32; p M19 16L24 32H11; p M28 16L24 32; p M16 10H22; p M28 16L34 10H38',
      heart_rate:    'p M24 41C10 31 6 23 6 17C6 11 10 7 15 7C19 7 22 9 24 13C26 9 29 7 33 7C38 7 42 11 42 17C42 23 38 31 24 41Z; p M10 22H18L21 16L26 28L29 22H38',
      sneaker:       'p M4 30H14L18 24H26L32 30H44V36C44 39 42 40 39 40H9C6 40 4 38 4 36Z; p M8 34H12; p M20 34H24',
      water_bottle:  'p M18 4H30V10H18Z; p M16 10H32V42C32 44 30 46 28 46H20C18 46 16 44 16 42Z; p M16 20H32; p M16 30H32',
      stopwatch_icon:'c 24 27 16; p M24 27V18; p M20 6H28; p M24 6V11; p M38 13L41 10',
      trophy_fit:    'p M14 6H34V20C34 26 30 30 24 30C18 30 14 26 14 20Z; p M14 10H7C7 17 10 20 14 20; p M34 10H41C41 17 38 20 34 20; p M24 30V38; p M15 42H33',
      scale_weight:  'r 6 12 36 28 4; p M12 20H36; p M24 26V34; C 24 26 2; p M18 36H30'
    },
    social: {
      like_icon:     'p M24 41C10 31 6 23 6 17C6 11 10 7 15 7C19 7 22 9 24 13C26 9 29 7 33 7C38 7 42 11 42 17C42 23 38 31 24 41Z',
      share_icon:    'C 12 24 5; C 36 11 5; C 36 37 5; p M16 22L32 13; p M16 26L32 35',
      comment_icon:  'p M6 8H42V32H24L14 42V32H6Z; p M14 16H34; p M14 24H28',
      follow_icon:   'c 24 14 8; p M8 42C8 34 15 30 24 30C33 30 40 34 40 42; p M36 6V18; p M30 12H42',
      group_icon:    'c 17 17 7; p M4 39C4 31 10 27 17 27C24 27 30 31 30 39; c 33 15 6; p M33 25C39 25 44 29 44 37',
      verified_icon: 'p M24 4L38 10L44 22L38 38L24 44L10 38L4 22L10 10Z; p M15 24L21 30L33 18',
      hashtag_icon:  'p M18 6L14 42; p M34 6L30 42; p M8 18H42; p M6 30H40',
      mention_icon:  'c 24 24 6; p M30 18V27C30 31 39 31 39 24C39 13 32 7 24 7C14 7 8 15 8 24C8 34 15 41 24 41C29 41 33 39 36 36',
      bell_social:   'p M12 34V22C12 15 17 10 24 10C31 10 36 15 36 22V34L40 38H8Z; p M20 42C21 44 27 44 28 42',
      star_rating:   'PG 12 20 15 10 18 20 29 21 21 27 24 38 15 32 7 38 10 27 2 21 11 20'
    },
    media: {
      play_icon:     'PG 14 6 42 24 14 42',
      pause_icon:    'R 14 6 8 36 0; R 26 6 8 36 0',
      stop_icon:     'R 12 12 24 24 2',
      forward_icon:  'PG 6 6 24 24 6 42; PG 26 6 44 24 26 42',
      rewind_icon:   'PG 42 6 24 24 42 42; PG 22 6 4 24 22 42',
      volume_icon:   'p M6 19H14L26 9V39L14 29H6Z; p M32 18C35 22 35 26 32 30; p M37 12C43 19 43 29 37 36',
      mute_icon:     'p M6 19H14L26 9V39L14 29H6Z; p M34 18L42 26; p M42 18L34 26',
      fullscreen_icon:'p M6 6V16H10V10H16V6Z; p M42 6V16H38V10H32V6Z; p M6 42V32H10V38H16V42Z; p M42 42V32H38V38H32V42Z',
      subtitles_icon:'r 4 12 40 24 3; p M14 22H20; p M24 22H34; p M14 30H26; p M30 30H34',
      cast_icon:     'p M4 40H8C8 32 14 26 22 26; p M4 32C10 32 14 36 14 42; C 6 42 2; p M22 42H40C42 42 44 40 44 38V14C44 12 42 10 40 10H8C6 10 4 12 4 14V18'
    }
  };
  const ICONS = {};
  const ICON_CATS = {};
  Object.keys(ICON_GROUPS).forEach(g => {
    ICON_CATS[g] = Object.keys(ICON_GROUPS[g]);
    Object.assign(ICONS, ICON_GROUPS[g]);
  });

  function extIcon(type, cx, cy, s, color) {
    const spec = ICONS[String(type || '').toLowerCase()];
    if (!spec) return null;
    const px = 34 * s, k = px / 48;
    return `<g transform="translate(${rnd(cx - px / 2)},${rnd(cy - px / 2)}) scale(${rnd(k * 100) / 100})">${iconMarkup(spec, color, 3)}</g>`;
  }
  _ilExt.icon = extIcon;
  _ilExt.iconNames = () => Object.keys(ICONS);

  // ---------- OBJECT LIBRARY ----------
  const OBJ = {}, OBJ_CATS = {};
  function def(cat, name, fn) { OBJ[name] = fn; (OBJ_CATS[cat] = OBJ_CATS[cat] || []).push(name); }
  const LT = ' opacity=".55"';
  const DK = ' opacity=".18"';

  // ----- education -----
  def('education', 'book_stack', t => SH(100, 70) +
    R(26, 142, 148, 28, t.a, 6) + R(26, 150, 148, 4, t.d) + R(26, 160, 148, 4, t.d) + R(122, 142, 10, 28, t.b) +
    R(40, 114, 124, 28, t.e, 6) + R(40, 122, 124, 4, t.light, 0, LT) + R(40, 132, 124, 4, t.light, 0, LT) + R(72, 114, 10, 28, t.b) +
    R(34, 88, 132, 26, t.b, 6) + R(34, 96, 132, 4, t.light, 0, LT) + R(34, 104, 132, 4, t.light, 0, LT) + R(54, 88, 10, 26, t.a));
  def('education', 'open_book', t => SH(100, 74) +
    P('M100 62C80 46 48 46 24 56V150C48 140 80 140 100 156C120 140 152 140 176 150V56C152 46 120 46 100 62Z', t.a) +
    P('M100 70C82 58 54 58 32 66V142C54 134 82 134 100 148Z', t.light) + P('M100 70C118 58 146 58 168 66V142C146 134 118 134 100 148Z', t.d) +
    S('M44 82C58 78 74 80 88 86M44 98C58 94 74 96 88 102M44 114C58 110 74 112 88 118', t.c, 3) +
    S('M112 86C126 80 142 78 156 82M112 102C126 96 142 94 156 98M112 118C126 112 142 110 156 114', t.c, 3));
  def('education', 'pencil', t => SH(100, 60) +
    G(R(84, 20, 32, 120, t.acc, 4) + R(84, 20, 10, 120, '#000', 0, ' opacity=".08"') + P('M84 140H116L100 176Z', '#f3d9b1') + P('M92 158H108L100 176Z', t.ink) + R(84, 20, 32, 20, t.a, 4) + R(84, 46, 32, 6, t.metal || K.metal), 'rotate(35 100 100)'));
  def('education', 'backpack', t => SH(100, 62) +
    R(50, 50, 100, 126, t.a, 30) + R(64, 100, 72, 56, t.b, 12) + R(74, 116, 52, 8, t.light, 3) + S('M74 60C74 30 126 30 126 60', t.a, 10) + R(66, 62, 68, 22, t.c, 10, ' opacity=".6"') + R(30, 96, 20, 44, t.e, 8) + R(150, 96, 20, 44, t.e, 8) + C(100, 132, 5, t.acc));
  def('education', 'globe_stand', t => SH(100, 60) +
    C(100, 90, 58, t.b) + P('M72 56C82 64 96 60 100 74C104 88 90 92 94 108C98 122 84 128 72 122C62 108 56 88 62 72Z', t.a) + P('M118 46C132 50 148 62 144 78C140 92 126 88 122 100C118 112 132 116 128 130C112 132 108 112 110 96C112 80 106 60 118 46Z', t.a, ' opacity=".9"') +
    S('M48 74C74 86 126 86 152 74M46 108C74 120 126 120 154 108', t.light, 2, ' opacity=".5"') + S('M158 40C176 90 158 148 100 152', t.ink, 5) + R(90, 152, 20, 16, t.ink, 3) + R(64, 166, 72, 12, t.ink, 6));
  def('education', 'grad_cap', t => SH(100, 66) +
    P('M52 96V126C52 142 148 142 148 126V96Z', t.a) + PG('100,44 184,82 100,120 16,82', t.b) + PG('100,44 184,82 100,120', '#000', ' opacity=".10"') + S('M162 90V134', t.acc, 5) + C(162, 138, 7, t.acc));
  def('education', 'blackboard', t => SH(100, 74) +
    R(24, 40, 152, 100, '#a9714b', 8) + R(32, 48, 136, 84, '#2f4f46', 4) + S('M44 70H110M44 88H140M44 106H92', '#ffffff', 4, ' opacity=".8"') + C(140, 106, 8, t.acc, ' opacity=".9"') +
    R(24, 140, 152, 10, '#8a5a36', 3) + R(60, 150, 6, 30, '#8a5a36') + R(134, 150, 6, 30, '#8a5a36') + R(120, 134, 26, 6, '#fff', 2));
  def('education', 'notebook', t => SH(100, 58) +
    R(48, 24, 104, 152, t.a, 10) + R(58, 24, 94, 152, t.light, 6) + R(48, 24, 16, 152, t.a, 8) + S('M74 62H140M74 82H140M74 102H140M74 122H120', t.c, 3) +
    [40, 64, 88, 112, 136, 160].map(y => C(56, y, 4, t.d)).join('') + R(74, 38, 50, 12, t.acc, 3));
  def('education', 'abc_blocks', t => SH(100, 70) +
    R(30, 116, 60, 60, t.a, 8) + R(96, 116, 60, 60, t.e, 8) + R(62, 54, 60, 60, t.b, 8) +
    ['A', 'B', 'C'].map((ch, i) => `<text x="${[60, 126, 92][i]}" y="${[158, 158, 96][i]}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="40" fill="#fff">${ch}</text>`).join(''));
  def('education', 'microscope', t => SH(100, 60) +
    R(58, 164, 84, 12, t.a, 5) + P('M76 164C64 120 82 70 122 66L132 92C106 96 100 128 118 164Z', t.a) + G(R(88, 24, 26, 62, t.b, 6) + R(84, 78, 34, 12, t.ink, 3), 'rotate(-22 100 60)') + R(64, 138, 62, 8, t.c, 3) + C(122, 80, 8, t.d));
  def('education', 'flask_lab', t => SH(100, 58) +
    R(84, 24, 32, 14, t.light, 4) + P('M88 38H112V80L152 150C158 162 150 176 136 176H64C50 176 42 162 48 150L88 80Z', t.light, ' opacity=".9"') +
    P('M64 128H136L152 150C158 162 150 176 136 176H64C50 176 42 162 48 150Z', t.b) + C(84, 148, 6, t.light, ' opacity=".7"') + C(112, 138, 4, t.light, ' opacity=".7"') + C(120, 158, 5, t.light, ' opacity=".7"') + S('M88 38H112', t.ink, 4));
  def('education', 'atom_model', t => SH(100, 50) +
    [0, 60, 120].map(a => `<ellipse cx="100" cy="94" rx="70" ry="26" fill="none" stroke="${t.b}" stroke-width="5" transform="rotate(${a} 100 94)"/>`).join('') +
    C(100, 94, 14, t.a) + C(166, 94, 7, t.acc) + C(66, 152, 7, t.acc) + C(66, 36, 7, t.acc));
  def('education', 'trophy_cup', t => SH(100, 56) +
    P('M64 30H136V80C136 104 120 116 100 116C80 116 64 104 64 80Z', K.gold) + S('M64 44H44C44 72 54 84 68 88M136 44H156C156 72 146 84 132 88', K.gold, 8) + R(90, 114, 20, 28, K.gold) + R(66, 142, 68, 14, t.ink, 4) + R(56, 156, 88, 18, t.a, 5) + P('M78 40H92V100C82 94 78 84 78 72Z', '#fff', ' opacity=".35"') + PG('100,54 106,68 121,68 109,77 113,92 100,83 87,92 91,77 79,68 94,68', '#fff', ' opacity=".8"'));
  def('education', 'medal_award', t => SH(100, 50) +
    PG('64,20 96,20 110,86 82,86', t.a) + PG('136,20 104,20 90,86 118,86', t.b) + C(100, 118, 42, K.gold) + C(100, 118, 32, '#fde68a') + PG('100,98 107,113 124,115 112,126 115,142 100,134 85,142 88,126 76,115 93,113', K.gold));

  // ----- office -----
  def('office', 'laptop', t => SH(100, 78) +
    R(40, 46, 120, 84, t.ink, 8) + R(48, 54, 104, 68, t.d, 3) + R(56, 64, 40, 8, t.b, 2) + R(56, 78, 68, 6, t.c, 2) + R(56, 90, 56, 6, t.c, 2) + R(112, 92, 30, 22, t.a, 3) +
    P('M22 136H178L170 156C168 160 164 162 160 162H40C36 162 32 160 30 156Z', t.c) + R(84, 136, 32, 6, t.b, 3));
  def('office', 'monitor_desk', t => SH(100, 78) +
    R(28, 34, 144, 96, t.ink, 8) + R(36, 42, 128, 80, t.light, 3) + R(44, 52, 34, 34, t.c, 4) + R(86, 52, 70, 8, t.b, 2) + R(86, 68, 52, 6, t.d, 2) + R(44, 96, 112, 18, t.d, 3) + R(50, 100, 40, 10, t.a, 2) +
    R(90, 130, 20, 26, t.dmetal || K.dmetal) + R(64, 154, 72, 10, t.dmetal || K.dmetal, 5));
  def('office', 'desk_lamp', t => SH(100, 60) +
    R(58, 164, 84, 12, t.ink, 5) + S('M100 164L76 104L122 62', t.b, 8) + P('M96 42L152 40L138 82L84 84Z', t.a) + C(142, 92, 10, K.gold, ' opacity=".9"') + PG('120,90 168,150 84,150', K.gold, ' opacity=".18"') + C(76, 104, 8, t.ink) + C(122, 62, 8, t.ink));
  def('office', 'coffee_mug', t => SH(100, 58) +
    R(46, 66, 90, 100, t.a, 14) + S('M136 84H150C168 84 168 132 146 132H136', t.a, 12) + R(54, 74, 74, 14, '#5b3a22', 7) + R(46, 108, 90, 22, t.b) + S('M78 54C70 42 88 38 80 24M100 54C92 42 110 38 102 24', t.c, 5));
  def('office', 'briefcase', t => SH(100, 60) +
    S('M76 62V50C76 42 82 38 90 38H110C118 38 124 42 124 50V62', t.ink, 9) + R(28, 62, 144, 100, t.a, 14) + R(28, 100, 144, 10, t.ink, 0, ' opacity=".25"') + R(86, 94, 28, 26, t.acc, 5) + R(94, 102, 12, 10, t.ink, 2));
  def('office', 'calendar_page', t => SH(100, 62) +
    R(34, 40, 132, 130, t.light, 12) + P('M34 52C34 45 39 40 46 40H154C161 40 166 45 166 52V80H34Z', t.a) + R(66, 26, 10, 26, t.ink, 5) + R(124, 26, 10, 26, t.ink, 5) +
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => R(46 + (i % 4) * 30, 92 + Math.floor(i / 4) * 24, 20, 14, i === 6 ? t.acc : t.d, 3)).join(''));
  def('office', 'envelope', t => SH(100, 66) +
    R(28, 56, 144, 98, t.light, 10) + P('M28 66C28 60 33 56 39 56H161C167 56 172 60 172 66L100 116Z', t.c) + P('M28 150L82 104M172 150L118 104', t.d, ' opacity="0"') + S('M32 148L84 100M168 148L116 100', t.d, 4) + C(150, 62, 18, t.acc) + S('M143 62L148 67L158 56', '#fff', 4));
  def('office', 'folder_files', t => SH(100, 66) +
    P('M26 56C26 48 32 44 38 44H80L94 60H162C170 60 174 66 174 72V150C174 158 168 164 160 164H40C32 164 26 158 26 150Z', t.b) + R(44, 72, 112, 70, t.light, 6) + R(54, 62, 96, 70, '#fff', 6) + R(64, 80, 60, 6, t.c, 2) + R(64, 94, 76, 6, t.d, 2) +
    P('M26 84H174V150C174 158 168 164 160 164H40C32 164 26 158 26 150Z', t.a));
  def('office', 'paper_plane', t => SH(100, 50) +
    PG('20,84 184,24 132,168 96,120', t.c) + PG('20,84 184,24 96,120', t.light) + PG('96,120 184,24 108,150 100,170 90,138', t.b, '') + S('M40 176C56 168 60 148 78 148', t.d, 4, ' stroke-dasharray="2 9"'));
  def('office', 'clipboard_check', t => SH(100, 66) +
    R(44, 34, 112, 142, t.a, 12) + R(54, 50, 92, 116, t.light, 6) + R(76, 22, 48, 28, t.ink, 8) + C(100, 30, 5, t.light) +
    [72, 100, 128].map((y, i) => R(94, y, 42, 6, t.d, 3) + S(`M66 ${y + 3}L71 ${y + 8}L80 ${y - 4}`, t.b, 5)).join(''));
  def('office', 'sticky_notes', t => SH(100, 66) +
    G(R(30, 44, 80, 80, t.acc, 4), 'rotate(-8 70 84)') + G(R(90, 56, 80, 80, t.d, 4), 'rotate(6 130 96)') + G(R(56, 100, 84, 76, t.c, 4) + S('M70 124H126M70 142H116', t.light, 4), 'rotate(-3 98 138)') + C(100, 104, 6, t.ink));
  def('office', 'printer_obj', t => SH(100, 74) +
    R(56, 24, 88, 50, t.light, 4) + R(24, 68, 152, 76, t.a, 14) + R(56, 122, 88, 50, '#fff', 3) + S('M66 138H134M66 152H118', t.d, 4) + C(150, 90, 6, K.green) + R(40, 82, 60, 8, t.d, 4));
  def('office', 'megaphone_obj', t => SH(100, 60) +
    P('M44 74L138 30V150L44 114Z', t.a) + R(28, 70, 32, 48, t.b, 8) + R(138, 24, 16, 132, t.ink, 6) + P('M50 118L62 166H84L76 122Z', t.ink) + S('M164 62C176 78 176 102 164 118M172 42C194 68 194 112 172 138', t.acc, 6));

  // ----- tech -----
  def('tech', 'smartphone', t => SH(100, 50) +
    R(56, 16, 88, 168, t.ink, 18) + R(64, 30, 72, 136, t.light, 6) + R(70, 38, 60, 30, t.b, 6) + R(70, 76, 60, 8, t.c, 3) + R(70, 90, 44, 8, t.d, 3) + R(70, 108, 28, 24, t.a, 5) + R(102, 108, 28, 24, t.e, 5) + R(88, 21, 24, 5, '#3a3f4b', 2) + C(100, 176, 4, '#3a3f4b'));
  def('tech', 'tablet_obj', t => SH(100, 74) +
    R(28, 34, 144, 124, t.ink, 14) + R(38, 44, 124, 104, t.light, 4) + R(48, 54, 48, 40, t.c, 4) + R(104, 54, 48, 8, t.b, 2) + R(104, 68, 40, 6, t.d, 2) + R(104, 80, 48, 14, t.a, 3) + R(48, 104, 104, 34, t.d, 4) + S('M56 128L74 114L90 122L112 108L142 128', t.a, 4));
  def('tech', 'server_rack', t => SH(100, 60) +
    [0, 1, 2, 3].map(i => R(40, 26 + i * 38, 120, 32, i % 2 ? t.b : t.a, 6) + C(58, 42 + i * 38, 5, K.green) + C(72, 42 + i * 38, 5, i === 2 ? K.orange : t.acc) + R(96, 38 + i * 38, 50, 8, t.light, 3, ' opacity=".7"')).join(''));
  def('tech', 'cloud_server', t => SH(100, 50) +
    P('M52 110C30 110 18 94 22 78C26 62 44 58 54 62C60 40 82 28 106 34C126 38 138 54 138 66C160 62 176 76 174 92C172 104 162 110 150 110Z', t.c) +
    R(72, 118, 56, 42, t.a, 6) + R(80, 126, 40, 8, t.light, 3) + R(80, 142, 40, 8, t.light, 3) + C(114, 130, 2.5, K.green) + S('M100 160V172M64 178H136', t.ink, 5) + C(64, 178, 6, t.b) + C(136, 178, 6, t.b));
  def('tech', 'router', t => SH(100, 70) +
    S('M46 74L36 24M100 70V18M154 74L164 24', t.ink, 7) + R(24, 72, 152, 60, t.a, 14) + C(52, 102, 6, K.green) + C(72, 102, 6, t.acc) + C(92, 102, 6, t.light) + R(120, 96, 42, 12, t.light, 6, LT) + R(40, 132, 20, 12, t.ink, 3) + R(140, 132, 20, 12, t.ink, 3));
  def('tech', 'robot_head', t => SH(100, 58) +
    S('M100 40V18', t.ink, 6) + C(100, 16, 9, t.acc) + R(38, 46, 124, 100, t.a, 26) + R(52, 62, 96, 64, t.ink, 16) + C(78, 92, 13, t.acc) + C(122, 92, 13, t.acc) + C(78, 92, 5, t.ink) + C(122, 92, 5, t.ink) + S('M84 116H116', t.light, 5) + R(20, 80, 18, 36, t.b, 7) + R(162, 80, 18, 36, t.b, 7) + R(76, 146, 48, 22, t.b, 6));
  def('tech', 'drone_obj', t => SH(100, 66) +
    S('M60 76L84 92M140 76L116 92M60 124L84 108M140 124L116 108', t.ink, 7) + R(76, 84, 48, 32, t.a, 12) + C(100, 100, 8, t.acc) +
    [[46, 68], [154, 68], [46, 132], [154, 132]].map(p => E(p[0], p[1], 28, 5, t.c, ' opacity=".75"') + C(p[0], p[1], 6, t.ink)).join(''));
  def('tech', 'vr_headset_obj', t => SH(100, 66) +
    S('M40 92C26 92 24 132 40 138M160 92C174 92 176 132 160 138', t.ink, 9) + R(28, 66, 144, 76, t.a, 24) + R(38, 76, 124, 56, t.ink, 16) + P('M82 132C86 118 114 118 118 132Z', t.a) + C(70, 104, 16, t.b) + C(130, 104, 16, t.b) + C(70, 104, 7, t.acc) + C(130, 104, 7, t.acc));
  def('tech', 'camera_obj', t => SH(100, 68) +
    P('M28 66H60L70 48H130L140 66H172C178 66 184 72 184 78V150C184 156 178 162 172 162H28C22 162 16 156 16 150V78C16 72 22 66 28 66Z', t.a) + R(16, 78, 168, 22, t.b) + C(100, 116, 34, t.ink) + C(100, 116, 24, t.b) + C(100, 116, 12, t.c) + C(92, 108, 5, t.light, ' opacity=".8"') + R(146, 52, 22, 10, t.acc, 3));
  def('tech', 'gamepad_obj', t => SH(100, 74) +
    P('M52 60H148C172 60 188 92 186 126C184 152 168 160 156 148L138 122H62L44 148C32 160 16 152 14 126C12 92 28 60 52 60Z', t.a) + R(38, 84, 34, 10, t.light, 3) + R(50, 72, 10, 34, t.light, 3) + C(140, 78, 8, K.red) + C(158, 94, 8, K.yellow) + C(122, 94, 8, K.green) + C(140, 108, 8, K.blue) + C(84, 112, 7, t.ink) + C(116, 112, 7, t.ink));
  def('tech', 'headphones_obj', t => SH(100, 60) +
    S('M38 112V92C38 54 66 30 100 30C134 30 162 54 162 92V112', t.ink, 12) + R(26, 100, 36, 62, t.a, 16) + R(138, 100, 36, 62, t.a, 16) + R(34, 112, 20, 38, t.c, 10) + R(146, 112, 20, 38, t.c, 10));
  def('tech', 'smartwatch_obj', t => SH(100, 50) +
    R(70, 16, 60, 40, t.ink, 6) + R(70, 144, 60, 40, t.ink, 6) + R(52, 48, 96, 104, t.a, 26) + R(60, 58, 80, 84, t.ink, 18) + S('M100 78V102L118 112', t.light, 6) + C(100, 100, 4, t.acc) + R(148, 88, 8, 22, t.b, 3));
  def('tech', 'keyboard_obj', t => SH(100, 68) +
    R(14, 66, 172, 82, t.a, 12) +
    [0, 1, 2].map(r => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(c => R(24 + c * 15.4 + (r === 1 ? 5 : r === 2 ? 10 : 0), 76 + r * 17, 12, 12, t.light, 2)).join('')).join('') + R(56, 128, 88, 12, t.light, 3));
  def('tech', 'satellite', t => SH(100, 40) +
    G(R(84, 76, 32, 48, t.a, 6) + R(20, 84, 58, 32, t.b, 3) + R(122, 84, 58, 32, t.b, 3) + S('M36 84V116M52 84V116M148 84V116M164 84V116', t.light, 2) + R(96, 124, 8, 16, t.ink) + P('M78 148C92 138 108 138 122 148Z', t.acc) + C(100, 100, 8, t.acc), 'rotate(-30 100 100)') + S('M148 40C160 46 166 56 166 66M156 26C174 34 182 50 182 66', t.d, 4));
  def('tech', 'circuit_chip', t => SH(100, 66) +
    [0, 1, 2, 3, 4].map(i => R(58 + i * 20, 22, 8, 22, t.metal || K.metal, 2) + R(58 + i * 20, 156, 8, 22, K.metal, 2) + R(22, 58 + i * 20, 22, 8, K.metal, 2) + R(156, 58 + i * 20, 22, 8, K.metal, 2)).join('') +
    R(44, 44, 112, 112, t.ink, 14) + R(64, 64, 72, 72, t.a, 10) + C(100, 100, 16, t.acc) + S('M74 74H92M126 126H108M74 126V110M126 74V90', t.light, 3));
  def('tech', 'lightbulb', t => SH(100, 46) +
    P('M100 22C68 22 48 46 48 74C48 96 62 108 72 122C76 128 76 134 76 140H124C124 134 124 128 128 122C138 108 152 96 152 74C152 46 132 22 100 22Z', K.yellow) + P('M76 40C64 50 60 66 64 80', '#fff', ' opacity="0"') + S('M72 54C78 40 92 34 104 34', '#fff', 6, ' opacity=".6"') + R(76, 144, 48, 12, t.ink, 4) + R(82, 158, 36, 12, t.ink, 4) + S('M100 12V4M42 32L36 26M158 32L164 26M30 74H20M170 74H180', K.gold, 5) + S('M86 122L92 96L100 108L108 96L114 122', t.a, 4));

  // ----- finance & shopping -----
  def('finance', 'coin_stack', t => SH(100, 60) +
    [0, 1, 2, 3].map(i => E(72, 160 - i * 20, 44, 14, K.gold) + R(28, 146 - i * 20, 88, 14, K.gold) + E(72, 146 - i * 20, 44, 14, '#fde68a') + E(72, 146 - i * 20, 30, 8, K.gold, ' opacity=".5"')).join('') +
    E(146, 158, 34, 11, K.gold) + R(112, 146, 68, 12, K.gold) + E(146, 146, 34, 11, '#fde68a') + `<text x="146" y="151" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="16" fill="${K.dbrown}">$</text>`);
  def('finance', 'piggy_bank_obj', t => SH(100, 66) +
    R(64, 140, 20, 32, t.b, 6) + R(120, 140, 20, 32, t.b, 6) + E(100, 112, 70, 50, t.c) + P('M52 76L44 44L80 62Z', t.b) + E(172, 112, 16, 20, t.b) + C(172, 112, 4, t.ink) + C(150, 92, 6, t.ink) + R(84, 62, 36, 8, t.ink, 4) + S('M30 108C18 106 18 92 30 90', t.c, 6) + C(100, 30, 16, K.gold) + S('M100 24V36', K.dbrown, 3));
  def('finance', 'wallet_obj', t => SH(100, 66) +
    R(22, 50, 156, 110, t.a, 16) + R(22, 66, 156, 94, t.b, 14) + R(120, 96, 66, 40, t.c, 12) + C(140, 116, 7, t.ink) + R(34, 40, 90, 18, K.green, 4) + R(34, 46, 90, 8, '#15803d', 0, ' opacity=".3"'));
  def('finance', 'credit_card_obj', t => SH(100, 60) +
    G(R(24, 54, 152, 96, t.a, 14) + R(24, 74, 152, 20, t.ink) + R(38, 108, 40, 26, K.gold, 5) + R(38, 121, 40, 2, K.dbrown) + R(90, 116, 68, 8, t.light, 3, LT) + R(90, 130, 44, 8, t.light, 3, LT), 'rotate(-6 100 100)'));
  def('finance', 'bar_chart_obj', t => SH(100, 74) +
    R(24, 28, 152, 132, t.light, 10) + R(38, 118, 26, 30, t.c, 4) + R(74, 92, 26, 56, t.b, 4) + R(110, 70, 26, 78, t.a, 4) + R(146, 46, 20, 102, t.e, 4) + S('M36 60L70 50L106 62L160 34', t.acc, 5) + C(160, 34, 6, t.acc));
  def('finance', 'pie_chart_obj', t => SH(100, 66) +
    C(100, 100, 66, t.a) + P('M100 100L100 34A66 66 0 0 1 160 128Z', t.acc) + P('M100 100L160 128A66 66 0 0 1 100 166Z', t.b) + P('M100 100L100 166A66 66 0 0 1 40 128Z', t.c) + G(P('M100 100L100 34A66 66 0 0 1 160 128Z', t.acc), 'translate(8,-8)', '') + C(100, 100, 24, t.light));
  def('finance', 'safe_box', t => SH(100, 70) +
    R(30, 34, 140, 130, t.dmetal || K.dmetal, 14) + R(42, 46, 116, 106, t.metal || K.metal, 8) + C(100, 100, 32, t.ink) + C(100, 100, 24, t.d) + S('M100 100L112 88', t.ink, 5) + C(100, 100, 5, t.acc) + R(38, 164, 20, 10, t.ink, 3) + R(142, 164, 20, 10, t.ink, 3));
  def('finance', 'money_bag', t => SH(100, 62) +
    P('M78 40C82 28 92 22 100 34C108 22 118 28 122 40C118 48 112 52 108 58H92C88 52 82 48 78 40Z', K.dgreen) + R(84, 54, 32, 12, t.acc, 5) + P('M92 62C56 82 32 116 44 148C54 174 146 174 156 148C168 116 144 82 108 62Z', K.green) +
    `<text x="100" y="146" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="56" fill="#fff">$</text>`);
  def('finance', 'shopping_cart_obj', t => SH(100, 66) +
    S('M14 34H40L58 118H150L170 60H50', t.a, 10) + P('M50 60H172L154 116H60Z', t.b) + S('M80 72V104M104 72V104M128 72V104', t.light, 4) + C(70, 148, 14, t.ink) + C(140, 148, 14, t.ink) + C(70, 148, 5, t.light) + C(140, 148, 5, t.light));
  def('finance', 'gift_box', t => SH(100, 66) +
    R(34, 88, 132, 84, t.a, 6) + R(26, 62, 148, 32, t.b, 6) + R(88, 62, 24, 110, t.acc) + P('M100 62C78 62 64 56 64 44C64 30 84 30 100 62Z', t.acc) + P('M100 62C122 62 136 56 136 44C136 30 116 30 100 62Z', t.acc) + R(34, 88, 132, 10, '#000', 0, DK));
  def('finance', 'price_tag', t => SH(100, 60) +
    G(P('M30 90L96 24H176V104L110 170C104 176 96 176 90 170L30 110C24 104 24 96 30 90Z', t.a) + C(146, 54, 10, t.light) + `<text x="98" y="122" text-anchor="middle" transform="rotate(-45 98 122)" font-family="Arial, sans-serif" font-weight="800" font-size="34" fill="#fff">%</text>`, 'translate(0,0)'));
  def('finance', 'shopping_bag_obj', t => SH(100, 60) +
    S('M74 66V52C74 34 126 34 126 52V66', t.ink, 8) + P('M40 62H160L170 172H30Z', t.a) + P('M40 62H160L164 100H36Z', '#000', ' opacity=".10"') + C(74, 70, 6, t.ink) + C(126, 70, 6, t.ink) + S('M84 118C84 138 116 138 116 118', t.light, 6) + PG('100,96 105,108 117,108 108,115 111,127 100,120 89,127 92,115 83,108 95,108', t.acc));

  // ----- health -----
  def('health', 'test_tubes', t => SH(100, 66) +
    [[52, t.a], [100, t.e], [148, t.b]].map((p, i) => G(R(p[0] - 16, 30, 32, 128, t.light, 16, ' opacity=".9"') + P(`M${p[0] - 16} ${100 + i * 12}H${p[0] + 16}V142A16 16 0 0 1 ${p[0] - 16} 142Z`, p[1]) + R(p[0] - 20, 26, 40, 10, t.ink, 4) + C(p[0] - 4, 124, 3, '#fff', ' opacity=".6"'), `translate(0,${i === 1 ? 8 : 0})`)).join('') + R(24, 158, 152, 14, t.ink, 5));
  def('health', 'dna_helix', t => SH(100, 40) +
    (() => { let s = ''; for (let i = 0; i < 9; i++) { const y = 26 + i * 18, a = Math.sin(i * 0.8) * 34; s += L(100 - a, y, 100 + a, y, t.d, 5) + C(100 - a, y, 8, t.a) + C(100 + a, y, 8, t.acc); } return s; })());
  def('health', 'medical_kit', t => SH(100, 66) +
    S('M76 62V50C76 40 84 36 92 36H108C116 36 124 40 124 50V62', t.ink, 9) + R(24, 62, 152, 106, t.light, 14) + R(24, 62, 152, 106, 'none', 14, ` stroke="${t.a}" stroke-width="8"`) + R(90, 84, 20, 62, K.red, 4) + R(69, 105, 62, 20, K.red, 4));
  def('health', 'pill_bottle', t => SH(100, 58) +
    R(64, 24, 72, 30, t.a, 8) + R(56, 50, 88, 122, t.light, 14) + R(56, 78, 88, 62, t.b, 0) + R(70, 90, 60, 38, t.light, 6) + R(80, 102, 40, 6, t.d, 3) + R(80, 114, 28, 6, t.d, 3) + P('M120 24L136 24L136 54L120 54Z', '#000', ' opacity=".08"'));
  def('health', 'stethoscope_obj', t => SH(100, 50) +
    S('M54 28V86C54 118 86 118 86 86V28', t.ink, 8) + S('M146 28V70C146 100 128 112 108 118', t.ink, 8, '') + S('M100 118V138C100 158 118 166 138 160C156 154 164 138 158 126', t.dmetal || K.dmetal, 8) + C(54, 24, 8, t.metal || K.metal) + C(146, 24, 8, K.metal) + C(154, 118, 20, t.a) + C(154, 118, 10, t.light));
  def('health', 'syringe_obj', t => SH(100, 50) +
    G(R(50, 82, 100, 36, t.light, 8, ` stroke="${t.dmetal || K.dmetal}" stroke-width="5"`) + R(56, 92, 60, 16, t.a, 4) + R(150, 96, 26, 8, t.metal || K.metal, 3) + R(176, 96, 20, 8, K.dmetal, 3, '') + R(34, 74, 12, 52, t.ink, 4) + R(14, 96, 24, 8, t.ink, 3) + S('M64 82V92M80 82V92M96 82V92', t.ink, 3), 'rotate(-35 100 100) translate(-6 0)'));
  def('health', 'thermometer_obj', t => SH(100, 40) +
    R(84, 20, 32, 116, t.light, 16, ` stroke="${t.ink}" stroke-width="6"`) + C(100, 148, 30, t.light, ` stroke="${t.ink}" stroke-width="6"`) + C(100, 148, 20, K.red) + R(94, 60, 12, 88, K.red, 6) + S('M124 44H136M124 64H136M124 84H136M124 104H136', t.ink, 4));
  def('health', 'heart_pulse', t => SH(100, 60) +
    P('M100 170C40 128 22 94 22 68C22 44 40 28 62 28C80 28 94 38 100 54C106 38 120 28 138 28C160 28 178 44 178 68C178 94 160 128 100 170Z', K.red) + P('M100 170C40 128 22 94 22 68C22 44 40 28 62 28C80 28 94 38 100 54Z', '#fff', ' opacity=".15"') + S('M34 100H70L84 70L106 132L120 100H166', '#fff', 8));
  def('health', 'tooth_obj', t => SH(100, 60) +
    P('M60 28C40 28 28 44 28 66C28 92 46 108 50 136C52 156 58 174 72 174C88 174 88 148 100 148C112 148 112 174 128 174C142 174 148 156 150 136C154 108 172 92 172 66C172 44 160 28 140 28C122 28 114 36 100 36C86 36 78 28 60 28Z', '#ffffff', ` stroke="${t.c}" stroke-width="6" stroke-linejoin="round"`) + S('M56 50C48 54 44 62 44 72', t.c, 5));
  def('health', 'brain_obj', t => SH(100, 66) +
    P('M100 34C84 18 52 22 48 50C28 54 22 82 38 98C26 116 40 142 62 140C68 162 92 168 100 152C108 168 132 162 138 140C160 142 174 116 162 98C178 82 172 54 152 50C148 22 116 18 100 34Z', t.c) + S('M100 34V152M66 70C76 74 82 84 78 96M134 70C124 74 118 84 122 96M60 120C72 118 80 124 84 134M140 120C128 118 120 124 116 134', t.a, 5));
  def('health', 'bandage_obj', t => SH(100, 50) +
    G(R(20, 74, 160, 52, t.d, 26) + R(66, 74, 68, 52, t.light, 0) + [0, 1, 2].map(i => [0, 1, 2].map(j => C(80 + i * 20, 86 + j * 14, 2.5, t.c)).join('')).join('') + R(20, 74, 160, 52, 'none', 26, ` stroke="${t.c}" stroke-width="4"`), 'rotate(-35 100 100)'));

  // ----- nature / weather / space -----
  def('nature', 'sun_obj', t => SH(100, 40) +
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => G(P('M100 14L108 42H92Z', K.gold), `rotate(${i * 30} 100 100)`)).join('') + C(100, 100, 46, K.yellow));
  def('nature', 'cloud_obj', t => SH(100, 70) +
    P('M52 150C26 150 14 130 20 112C26 96 44 90 58 96C62 68 88 50 114 58C136 64 146 82 146 96C168 92 184 108 180 128C177 142 166 150 150 150Z', '#ffffff', ` stroke="${t.c}" stroke-width="5" stroke-linejoin="round"`) + P('M40 140C60 152 130 152 168 138C166 146 160 150 150 150H52C46 150 42 146 40 140Z', t.d, ' opacity=".8"') + C(96, 86, 16, t.d, ' opacity=".5"'));
  def('nature', 'rain_cloud', t => SH(100, 40) +
    P('M52 110C26 110 14 90 20 72C26 56 44 50 58 56C62 28 88 10 114 18C136 24 146 42 146 56C168 52 184 68 180 88C177 102 166 110 150 110Z', t.d) + [[54, 128], [84, 138], [114, 128], [144, 138]].map(p => S(`M${p[0]} ${p[1]}L${p[0] - 8} ${p[1] + 24}`, t.b, 6)).join(''));
  def('nature', 'storm_cloud', t => SH(100, 40) +
    P('M52 100C26 100 14 80 20 62C26 46 44 40 58 46C62 18 88 0 114 8C136 14 146 32 146 46C168 42 184 58 180 78C177 92 166 100 150 100Z', t.a) + PG('112,94 84,142 106,142 92,186 138,124 114,124 128,94', K.yellow) + S('M40 120L34 140M150 122L144 142', t.c, 6));
  def('nature', 'rainbow_obj', t => SH(100, 66) +
    ['#ef4444', '#fb923c', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6'].map((c, i) => S(`M${16 + i * 10} 150A${84 - i * 10} ${84 - i * 10} 0 0 1 ${184 - i * 10} 150`, c, 10)).join('') +
    P('M26 156C12 156 8 138 22 132C26 120 46 120 52 132C64 130 68 148 58 156Z', '#fff') + P('M144 156C130 156 126 138 140 132C144 120 164 120 170 132C182 130 186 148 176 156Z', '#fff'));
  def('nature', 'moon_stars_obj', t => SH(100, 30) +
    P('M124 24C82 26 52 62 60 106C68 148 112 172 150 156C120 154 92 130 92 94C92 66 104 42 124 24Z', K.gold) +
    PG('150,40 155,54 170,54 158,63 162,77 150,69 138,77 142,63 130,54 145,54', K.yellow) + PG('174,104 177,112 186,112 179,117 182,126 174,120 166,126 169,117 162,112 171,112', K.yellow) + C(140, 130, 4, K.yellow));
  def('nature', 'umbrella_obj', t => SH(100, 50) +
    P('M20 96C20 54 56 24 100 24C144 24 180 54 180 96C168 84 152 84 140 96C128 84 112 84 100 96C88 84 72 84 60 96C48 84 32 84 20 96Z', t.a) + P('M100 24C84 40 74 66 74 96C86 84 92 84 100 96Z', t.c, ' opacity=".7"') + P('M100 24C116 40 126 66 126 96C114 84 108 84 100 96Z', t.c, ' opacity=".7"') + S('M100 96V152C100 172 128 172 128 152', t.ink, 8) + S('M100 24V14', t.ink, 6));
  def('nature', 'snowman', t => SH(100, 60) +
    C(100, 142, 42, '#ffffff') + C(100, 80, 30, '#ffffff') + C(100, 142, 42, t.d, ' opacity=".25"') + R(72, 36, 56, 10, t.ink, 3) + R(80, 14, 40, 26, t.ink, 4) + R(80, 30, 40, 6, t.a) +
    C(90, 74, 3.5, t.ink) + C(110, 74, 3.5, t.ink) + PG('100,80 128,86 100,90', K.orange) + C(100, 118, 4, t.ink) + C(100, 138, 4, t.ink) + C(100, 158, 4, t.ink) + S('M66 106C56 96 44 92 36 86M134 106C144 96 156 92 164 86', '#8a5a36', 5) + R(76, 96, 48, 10, t.a, 5));
  def('nature', 'campfire', t => SH(100, 66) +
    G(R(36, 150, 128, 18, '#8a5a36', 9), 'rotate(-14 100 160)') + G(R(36, 150, 128, 18, '#a9714b', 9), 'rotate(14 100 160)') +
    P('M100 30C100 30 60 74 60 112C60 138 78 154 100 154C122 154 140 138 140 112C140 92 128 78 122 66C118 82 110 88 106 88C112 62 100 30 100 30Z', K.orange) + P('M100 74C100 74 80 100 80 120C80 138 90 148 100 148C110 148 120 138 120 120C120 108 112 98 108 92C106 102 102 104 100 104Z', K.yellow));
  def('nature', 'mushroom_obj', t => SH(100, 60) +
    R(76, 104, 48, 68, '#fdf2e0', 14) + P('M24 112C24 60 58 28 100 28C142 28 176 60 176 112C176 122 168 126 158 126H42C32 126 24 122 24 112Z', t.a) + C(66, 76, 12, '#fff') + C(112, 60, 9, '#fff') + C(138, 96, 13, '#fff') + C(88, 100, 7, '#fff'));
  def('nature', 'seashell', t => SH(100, 60) +
    P('M100 32C46 32 20 96 36 138C46 164 76 176 100 176C124 176 154 164 164 138C180 96 154 32 100 32Z', t.d) +
    [-60, -36, -12, 12, 36, 60].map(a => S(`M100 176L${rnd(100 + Math.sin(a * Math.PI / 180) * 92)} ${rnd(176 - Math.cos(a * Math.PI / 180) * 128)}`, t.a, 5)).join('') + R(76, 172, 48, 10, t.a, 5));
  def('nature', 'leaf_branch', t => SH(100, 40) +
    S('M100 178C100 130 108 84 140 36', '#6b8f3a', 6) +
    [[104, 152, -50], [108, 128, 46], [112, 104, -50], [120, 82, 46], [130, 60, -46]].map((p, i) => G(P('M0 0C18 -12 40 -12 56 0C40 12 18 12 0 0Z', i % 2 ? K.green : K.dgreen), `translate(${p[0]} ${p[1]}) rotate(${p[2] > 0 ? 25 : 180 - 25})`)).join('') + G(P('M0 0C18 -12 40 -12 56 0C40 12 18 12 0 0Z', K.green), 'translate(140 36) rotate(-70)'));
  def('nature', 'planet_saturn', t => SH(100, 30) +
    C(100, 100, 46, t.b) + P('M60 84C80 70 118 72 144 96C126 84 88 82 60 84Z', t.a, ' opacity=".5"') + P('M56 110C86 126 122 124 148 112C130 132 86 138 56 110Z', t.a, ' opacity=".4"') +
    `<ellipse cx="100" cy="100" rx="88" ry="22" fill="none" stroke="${t.acc}" stroke-width="9" transform="rotate(-20 100 100)"/>`);
  def('nature', 'earth_globe', t => SH(100, 50) +
    C(100, 100, 66, K.blue) + P('M68 60C82 54 96 62 92 76C88 88 70 88 66 100C62 112 72 126 60 128C46 110 46 76 68 60Z', K.green) + P('M118 52C136 52 150 66 146 82C142 96 128 92 124 104C120 116 134 124 126 138C112 138 106 124 108 108C110 92 102 62 118 52Z', K.green) + P('M92 136C104 132 114 142 108 156C98 160 86 152 92 136Z', K.green) + S('M60 56C72 44 90 36 108 36', '#fff', 5, ' opacity=".5"'));
  def('nature', 'star_burst', t => SH(100, 30) +
    PG('100,20 118,72 172,72 128,104 146,158 100,126 54,158 72,104 28,72 82,72', K.gold) + PG('100,20 118,72 100,100 82,72', '#fde68a') + S('M28 32L40 44M172 32L160 44M20 100H36M164 100H180', t.acc, 6));
  def('nature', 'comet', t => SH(100, 30) +
    S('M174 34C126 50 78 90 40 158', t.c, 22, ' opacity=".35"') + S('M164 44C126 60 88 92 58 142', t.c, 12, ' opacity=".6"') + C(48, 154, 26, t.b) + C(40, 148, 8, t.a) + C(58, 164, 5, t.a) + C(160, 30, 5, t.acc) + C(184, 66, 4, t.acc));

  // ----- food -----
  def('food', 'apple_obj', t => SH(100, 50) +
    P('M100 62C84 46 34 46 34 108C34 148 62 176 82 176C92 176 94 172 100 172C106 172 108 176 118 176C138 176 166 148 166 108C166 46 116 46 100 62Z', K.red) + S('M56 80C48 92 46 108 50 124', '#fff', 6, ' opacity=".4"') + S('M100 62C100 40 108 26 122 20', K.dbrown, 7) + P('M106 44C118 30 138 30 146 38C138 52 120 54 106 44Z', K.green));
  def('food', 'banana', t => SH(100, 40) +
    P('M32 60C40 132 100 176 168 148C172 146 172 140 166 138C110 130 78 96 64 40C62 32 32 34 32 60Z', K.yellow) + P('M32 60C40 132 100 176 168 148C120 146 66 112 50 50Z', '#eab308', ' opacity=".55"') + R(36, 34, 22, 16, K.dbrown, 4) + P('M164 138L174 144L170 152L160 146Z', K.dbrown));
  def('food', 'orange_obj', t => SH(100, 46) +
    C(100, 108, 66, K.orange) + S('M62 76C54 88 52 104 56 118', '#fff', 6, ' opacity=".4"') + S('M100 44C100 36 104 30 112 26', K.dbrown, 5) + P('M106 44C120 28 144 30 148 42C136 54 116 54 106 44Z', K.green) + C(80, 132, 2.5, '#ea580c') + C(120, 150, 2.5, '#ea580c') + C(132, 112, 2.5, '#ea580c') + C(96, 100, 2.5, '#ea580c'));
  def('food', 'strawberry', t => SH(100, 50) +
    P('M100 178C50 150 30 96 40 76C52 56 84 62 100 70C116 62 148 56 160 76C170 96 150 150 100 178Z', K.red) + P('M64 62C76 52 88 60 100 50C112 60 124 52 136 62C128 76 116 70 100 78C84 70 72 76 64 62Z', K.green) + S('M100 50V34', K.dgreen, 6) +
    [[70, 96], [96, 104], [126, 96], [82, 128], [112, 132], [98, 156], [136, 120], [62, 118]].map(p => E(p[0], p[1], 3, 4.5, '#fde68a')).join(''));
  def('food', 'watermelon_slice', t => SH(100, 66) +
    P('M20 76A80 80 0 0 0 180 76Z', K.dgreen) + P('M30 76A70 70 0 0 0 170 76Z', '#dcfce7') + P('M36 76A64 64 0 0 0 164 76Z', K.red) + R(16, 66, 168, 14, K.red, 7) +
    [[64, 100], [90, 112], [116, 104], [140, 96], [100, 136], [76, 128]].map(p => E(p[0], p[1], 3.5, 6, K.ink)).join(''));
  def('food', 'grapes', t => SH(100, 40) +
    [[70, 72], [100, 72], [130, 72], [84, 98], [116, 98], [70, 124], [100, 124], [130, 124], [100, 150], [86, 124]].slice(0, 9).map(p => C(p[0], p[1] + 8, 17, t.a)).join('') + C(76, 70, 4, '#fff', ' opacity=".5"') + C(106, 70, 4, '#fff', ' opacity=".5"') + S('M100 68C100 50 108 40 120 34', K.dbrown, 6) + P('M112 40C124 22 150 22 158 34C146 48 124 50 112 40Z', K.green));
  def('food', 'carrot_obj', t => SH(100, 40) +
    G(P('M100 60C130 60 122 130 100 176C78 130 70 60 100 60Z', K.orange) + S('M86 84H104M88 106H108M92 128H104', '#ea580c', 4) + P('M100 60C84 40 78 26 88 18C98 22 100 40 100 60Z', K.green) + P('M100 60C110 36 122 28 130 32C126 48 114 56 100 60Z', K.dgreen) + P('M100 60C100 34 106 16 114 12C120 26 112 46 100 60Z', K.green), 'rotate(28 100 100)'));
  def('food', 'broccoli', t => SH(100, 46) +
    R(84, 108, 32, 68, '#a3d977', 12) + [[60, 84, 30], [100, 62, 36], [140, 84, 30], [78, 104, 26], [124, 104, 26]].map(p => C(p[0], p[1], p[2], K.dgreen)).join('') + C(88, 60, 6, '#22c55e') + C(126, 80, 6, '#22c55e') + C(56, 84, 5, '#22c55e'));
  def('food', 'pizza_slice', t => SH(100, 66) +
    P('M100 178L28 50C60 30 140 30 172 50Z', K.yellow) + P('M28 50C60 30 140 30 172 50L166 64C136 46 64 46 34 64Z', '#e0a96d') + C(84, 80, 10, K.red) + C(120, 76, 10, K.red) + C(102, 112, 10, K.red) + C(100, 142, 7, K.red) + C(72, 100, 4, K.green) + C(132, 100, 4, K.green));
  def('food', 'burger_obj', t => SH(100, 66) +
    P('M26 92C26 52 58 30 100 30C142 30 174 52 174 92Z', '#e09a4a') + [[64, 56], [96, 46], [130, 58], [84, 70], [120, 74]].map(p => E(p[0], p[1], 4, 2.5, '#fdf2e0')).join('') +
    P('M22 100C30 108 42 96 52 104C62 112 72 96 84 104C96 112 106 96 118 104C130 112 140 96 150 104C160 112 172 100 178 104V116H22Z', K.green) + R(28, 114, 144, 18, '#6b3f22', 9) + P('M24 132H176L170 142C150 136 134 148 116 140C100 148 84 136 66 142C48 148 36 136 24 142Z', K.yellow) + P('M26 146H174V150C174 164 164 172 150 172H50C36 172 26 164 26 150Z', '#e09a4a'));
  def('food', 'sandwich', t => SH(100, 66) +
    R(28, 146, 144, 26, '#e8c68a', 12) + P('M24 142C38 150 50 134 64 142C78 150 90 134 104 142C118 150 130 134 144 142C158 150 168 134 176 142V132H24Z', K.green) + R(34, 124, 132, 14, K.red, 6) + PG('28,124 172,124 156,108 44,108', K.yellow) + R(34, 92, 132, 14, '#6b3f22', 7) + P('M28 92C28 52 62 36 100 36C138 36 172 52 172 92Z', '#e8c68a') + [[70, 62], [100, 54], [132, 64]].map(p => E(p[0], p[1], 4, 2.5, '#fdf2e0')).join(''));
  def('food', 'cupcake', t => SH(100, 54) +
    P('M44 108H156L142 174H58Z', t.a) + [70, 90, 110, 130].map(x => S(`M${x} 112L${x - 4 + (x > 100 ? 0 : 0)} 170`, t.light, 3, ' opacity=".4"')).join('') +
    P('M36 110C24 92 46 78 52 84C48 62 78 56 92 66C98 44 130 44 136 66C156 58 172 78 160 92C176 100 170 112 156 112Z', t.c) + C(100, 44, 12, K.red) + S('M100 34C100 28 106 24 110 22', K.dgreen, 4));
  def('food', 'donut_obj', t => SH(100, 46) +
    C(100, 100, 74, '#e0a96d') + C(100, 96, 74, t.c) + C(100, 96, 22, '#e09a4a') +
    [[54, 70, 20], [90, 42, -30], [132, 52, 50], [154, 88, 80], [60, 116, 130], [78, 148, 10], [132, 138, 60]].map(p => G(R(-8, -2.5, 16, 5, [K.yellow, '#fff', t.d, K.green][Math.abs(p[2]) % 4], 2), `translate(${p[0]} ${p[1]}) rotate(${p[2]})`)).join(''));
  def('food', 'ice_cream_cone', t => SH(100, 46) +
    PG('60,102 140,102 100,180', '#e0a96d') + S('M72 108L112 168M96 106L120 150M120 106L92 158M84 106L70 140', '#b7803f', 3, ' opacity=".6"') +
    C(100, 88, 34, t.c) + C(72, 74, 26, t.b) + C(128, 74, 26, t.a) + C(100, 46, 26, t.e) + C(100, 20, 8, K.red));
  def('food', 'coffee_cup', t => SH(100, 66) +
    E(100, 166, 82, 14, t.d) + E(100, 162, 70, 9, t.light) + P('M44 82H148C148 128 136 160 104 160H88C56 160 44 128 44 82Z', t.a) + R(44, 106, 104, 14, t.b, 0, ' opacity=".7"') + S('M148 96H160C182 96 182 138 158 138H144', t.a, 12) + E(96, 82, 52, 12, '#5b3a22') + E(96, 82, 52, 12, 'none', ` stroke="${t.light}" stroke-width="4"`) + S('M78 62C68 50 88 44 78 30M104 62C94 50 114 44 104 30', t.c, 5));
  def('food', 'teapot', t => SH(100, 66) +
    P('M48 84C48 62 148 62 148 84V126C148 154 132 166 98 166C64 166 48 154 48 126Z', t.a) + R(80, 50, 36, 14, t.b, 6) + C(98, 46, 8, t.b) + S('M148 96C176 92 182 132 150 134', t.a, 10) + P('M48 96C28 84 20 70 26 60C40 66 52 78 58 92Z', t.a) + S('M68 96V140M90 90V150', t.light, 4, ' opacity=".4"') + R(60, 108, 76, 12, t.b, 0, ' opacity=".6"'));
  def('food', 'cake_slice', t => SH(100, 66) +
    R(34, 132, 132, 34, '#e8c68a', 8) + R(34, 122, 132, 14, t.light, 4) + R(34, 96, 132, 28, '#e8c68a', 6) + R(34, 90, 132, 10, t.light, 4) + P('M28 92C28 70 60 58 100 58C140 58 172 70 172 92C160 100 150 88 138 100C126 110 116 92 100 100C84 108 74 92 62 100C50 106 40 96 28 92Z', t.c) + C(100, 44, 14, K.red) + S('M100 32C100 24 108 20 114 20', K.dgreen, 4) + [56, 84, 116, 144].map(x => C(x, 148, 3, K.dbrown, ' opacity=".35"')).join(''));
  def('food', 'fries_box', t => SH(100, 66) +
    [[52, 40, -8], [70, 26, -4], [88, 34, 2], [108, 22, 4], [128, 32, 6], [146, 44, 10]].map((p, i) => G(R(-7, 0, 14, 86, i % 2 ? '#fbbf24' : '#f59e0b', 3), `translate(${p[0]} ${p[1]}) rotate(${p[2]})`)).join('') +
    P('M38 84H162L150 174H50Z', K.red) + P('M38 84H162L156 118H44Z', K.dred, ' opacity=".35"') + `<text x="100" y="146" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="38" fill="#fde047">F</text>`);
  def('food', 'egg_fried', t => SH(100, 70) +
    P('M32 96C24 54 70 32 108 40C154 36 184 70 170 112C160 148 116 170 74 160C46 154 36 126 32 96Z', '#ffffff') + P('M32 96C24 54 70 32 108 40C154 36 184 70 170 112C160 148 116 170 74 160C46 154 36 126 32 96Z', t.d, ' opacity=".18"') + C(104, 100, 34, K.yellow) + C(94, 90, 9, '#fff', ' opacity=".55"'));
  def('food', 'bread_loaf', t => SH(100, 66) +
    P('M32 88C14 88 14 42 60 40H140C186 42 186 88 168 88V158C168 168 160 174 150 174H50C40 174 32 168 32 158Z', '#e0a96d') + P('M32 88C14 88 14 42 60 40H140C186 42 186 88 168 88Z', '#c58b55') + S('M70 60L82 92M100 56L112 92M130 60L142 92', '#f3d9b1', 6));
  def('food', 'cheese_wedge', t => SH(100, 66) +
    P('M22 114L176 66V144L22 144Z', K.yellow) + P('M22 114L176 66V90L22 138Z', '#fde68a') + P('M22 114L120 30L176 66Z', '#fde047') + C(60, 128, 8, '#eab308') + C(110, 116, 11, '#eab308') + C(146, 108, 6, '#eab308') + C(82, 76, 6, '#eab308'));
  def('food', 'sushi', t => SH(100, 66) +
    [[62, 100], [138, 100]].map(p => R(p[0] - 36, 88, 72, 68, '#1f2937', 14) + E(p[0], 88, 36, 14, '#fff') + E(p[0], 88, 30, 10, '#fef3c7') + E(p[0], 86, 14, 6, t.acc)).join('') +
    R(46, 146, 108, 28, '#fff', 12) + P('M46 154C70 136 130 136 154 154V160C130 148 70 148 46 160Z', t.a));
  def('food', 'avocado', t => SH(100, 50) +
    P('M100 16C70 16 52 52 46 92C40 140 62 176 100 176C138 176 160 140 154 92C148 52 130 16 100 16Z', K.dgreen) + P('M100 30C78 30 64 60 60 96C56 136 74 162 100 162C126 162 144 136 140 96C136 60 122 30 100 30Z', '#d9f2a4') + C(100, 122, 26, '#8a5a36') + C(92, 114, 7, '#fff', ' opacity=".4"'));
  def('food', 'cherries', t => SH(100, 46) +
    S('M60 138C64 96 90 56 118 30M138 132C132 92 124 60 118 30', '#5c8a3a', 5) + P('M118 30C134 12 164 16 172 32C158 46 132 44 118 30Z', K.green) + C(58, 148, 28, K.red) + C(140, 142, 28, K.dred) + C(48, 138, 6, '#fff', ' opacity=".5"') + C(130, 132, 6, '#fff', ' opacity=".4"'));

  // ----- home -----
  def('home', 'sofa_obj', t => SH(100, 80) +
    R(36, 60, 128, 62, t.b, 22) + R(14, 90, 42, 66, t.a, 18) + R(144, 90, 42, 66, t.a, 18) + R(46, 104, 108, 46, t.a, 12) + R(50, 108, 48, 36, t.c, 8, ' opacity=".5"') + R(102, 108, 48, 36, t.c, 8, ' opacity=".5"') + R(34, 156, 8, 18, t.ink, 3) + R(158, 156, 8, 18, t.ink, 3) + G(R(-12, -12, 24, 24, t.acc, 6), 'translate(64 100) rotate(-12)'));
  def('home', 'bed_obj', t => SH(100, 80) +
    R(18, 46, 20, 128, t.ink, 6) + R(162, 82, 20, 92, t.ink, 6) + R(30, 108, 142, 40, t.a, 8) + R(30, 132, 142, 22, t.b, 6) + R(40, 82, 52, 30, t.light, 12) + P('M96 112C110 96 140 96 168 112V132H96Z', t.c) + R(30, 150, 142, 8, t.ink, 3));
  def('home', 'floor_lamp', t => SH(100, 50) +
    R(96, 76, 8, 96, t.ink, 3) + E(100, 176, 34, 8, t.ink) + P('M62 76L74 24H126L138 76Z', t.acc) + P('M74 24H126L132 50H68Z', '#fff', ' opacity=".25"') + R(88, 76, 24, 8, t.ink, 3));
  def('home', 'wall_clock', t => SH(100, 40) +
    C(100, 100, 74, t.ink) + C(100, 100, 64, t.light) + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => G(R(-2, -60, 4, i % 3 ? 7 : 12, t.ink, 2), `translate(100 100) rotate(${i * 30})`)).join('') + S('M100 100V56M100 100L128 116', t.a, 7) + S('M100 100L86 132', t.acc, 3) + C(100, 100, 6, t.a));
  def('home', 'door_obj', t => SH(100, 60) +
    R(46, 20, 108, 156, t.ink, 6) + R(54, 28, 92, 148, t.a, 4) + R(64, 40, 30, 48, t.b, 4) + R(106, 40, 30, 48, t.b, 4) + R(64, 100, 30, 62, t.b, 4) + R(106, 100, 30, 62, t.b, 4) + C(136, 118, 6, K.gold));
  def('home', 'window_curtain', t => SH(100, 50) +
    R(38, 30, 124, 140, t.ink, 8) + R(46, 38, 108, 124, K.sky, 4) + C(120, 70, 14, K.yellow) + P('M46 162V130C64 112 90 130 110 122C128 116 140 112 154 122V162Z', K.green, ' opacity=".7"') + S('M100 38V162M46 100H154', t.ink, 5) + P('M28 24H74V176C60 168 50 150 44 130C40 110 34 60 28 24Z', t.c) + P('M172 24H126V176C140 168 150 150 156 130C160 110 166 60 172 24Z', t.c) + R(22, 20, 156, 8, t.a, 4));
  def('home', 'armchair', t => SH(100, 70) +
    R(48, 30, 104, 90, t.a, 30) + R(20, 84, 40, 70, t.b, 16) + R(140, 84, 40, 70, t.b, 16) + R(50, 100, 100, 50, t.b, 12) + R(58, 108, 84, 30, t.c, 8, ' opacity=".5"') + R(40, 154, 8, 20, t.ink, 3) + R(152, 154, 8, 20, t.ink, 3));
  def('home', 'bookshelf', t => SH(100, 60) +
    R(30, 20, 140, 156, t.a, 6) + R(38, 28, 124, 140, t.d, 3) + R(38, 92, 124, 6, t.a) +
    [[42, 52, 14, K.red], [58, 46, 12, t.b], [72, 50, 16, K.gold], [90, 42, 12, t.e], [106, 54, 18, t.a], [128, 48, 14, K.green]].map(b => R(b[0], b[1], b[2], 92 - b[1], b[3], 2)).join('') +
    R(42, 122, 18, 46, t.e, 2) + R(62, 114, 14, 54, K.red, 2) + R(78, 126, 16, 42, K.gold, 2) + G(R(-7, -26, 14, 52, t.b, 2), 'translate(118 142) rotate(20)') + C(144, 152, 10, t.acc));
  def('home', 'tv_obj', t => SH(100, 70) +
    R(20, 40, 160, 104, t.ink, 10) + R(28, 48, 144, 88, t.b, 4) + P('M28 116C52 100 76 122 104 108C130 96 150 110 172 100V136H28Z', t.a) + C(140, 74, 12, t.acc) + S('M78 40L60 18M122 40L140 18', t.ink, 5) + R(80, 144, 40, 12, t.ink, 3) + R(56, 156, 88, 10, t.ink, 5));
  def('home', 'fridge_obj', t => SH(100, 60) +
    R(54, 14, 92, 164, t.light, 12) + R(54, 14, 92, 164, 'none', 12, ` stroke="${t.b}" stroke-width="6"`) + R(54, 72, 92, 6, t.b) + R(64, 40, 6, 22, t.c, 3) + R(64, 92, 6, 40, t.c, 3) + R(80, 22, 50, 8, t.d, 4, LT));
  def('home', 'washing_machine', t => SH(100, 60) +
    R(38, 20, 124, 156, t.light, 12) + R(38, 20, 124, 156, 'none', 12, ` stroke="${t.b}" stroke-width="6"`) + R(38, 20, 124, 32, t.b, 10) + C(58, 36, 6, t.acc) + C(76, 36, 6, t.d) + R(112, 30, 38, 12, t.d, 6) + C(100, 108, 42, t.c) + C(100, 108, 32, t.a) + P('M72 112C82 100 92 124 102 112C112 100 120 124 130 112C128 132 116 140 100 140C84 140 74 132 72 112Z', t.d, ' opacity=".8"'));
  def('home', 'house_key', t => SH(100, 46) +
    P('M22 100L100 30L178 100Z', t.a) + R(40, 100, 120, 72, t.d, 4) + R(86, 118, 28, 54, t.b, 3) + R(54, 112, 24, 24, t.light, 3) + R(122, 112, 24, 24, t.light, 3) + R(134, 36, 16, 34, t.ink, 3) + C(100, 100, 0.1, t.a));

  // ----- tools -----
  def('tools', 'hammer_obj', t => SH(100, 50) +
    G(R(90, 60, 20, 116, '#c58b55', 8) + R(46, 34, 92, 40, t.dmetal || K.dmetal, 8) + P('M138 34H160C170 34 172 40 168 46L138 74Z', K.metal), 'rotate(30 100 110)'));
  def('tools', 'wrench_obj', t => SH(100, 50) +
    G(P('M64 26C64 14 78 8 88 14V44H112V14C122 8 136 14 136 26V56C136 72 120 84 100 84C80 84 64 72 64 56Z', t.metal || K.metal) + R(86, 76, 28, 96, t.metal || K.metal, 14) + C(100, 162, 9, t.bg0 || '#fff') + R(92, 88, 6, 60, '#fff', 3, ' opacity=".35"'), 'rotate(40 100 100)'));
  def('tools', 'screwdriver_obj', t => SH(100, 50) +
    G(R(84, 18, 32, 76, t.acc, 14) + R(84, 74, 32, 8, '#000', 0, DK) + R(94, 92, 12, 74, t.metal || K.metal, 2) + PG('94,166 106,166 103,180 97,180', K.dmetal), 'rotate(38 100 100)'));
  def('tools', 'paint_bucket', t => SH(100, 66) +
    P('M34 66L48 172H152L166 66Z', t.metal || K.metal) + P('M34 66L38 90H162L166 66Z', t.a) + E(100, 66, 66, 14, t.a) + E(100, 66, 56, 9, t.c) + S('M34 66C34 20 166 20 166 66', t.ink, 5) + P('M62 90V128C62 138 72 138 72 128V90Z', t.c) + P('M112 90V112C112 122 122 122 122 112V90Z', t.c));
  def('tools', 'toolbox_obj', t => SH(100, 70) +
    S('M72 62V46C72 38 80 34 88 34H112C120 34 128 38 128 46V62', t.ink, 9) + R(22, 58, 156, 108, t.a, 12) + R(22, 96, 156, 12, t.ink, 0, ' opacity=".25"') + R(82, 90, 36, 28, t.acc, 6) + R(92, 100, 16, 8, t.ink, 3) + R(22, 58, 156, 24, t.b, 10));
  def('tools', 'ladder_obj', t => SH(100, 50) +
    G(R(56, 14, 14, 168, t.acc, 5) + R(130, 14, 14, 168, t.acc, 5) + [34, 64, 94, 124, 154].map(y => R(56, y, 88, 10, t.b, 4)).join(''), 'rotate(0)'));
  def('tools', 'hard_hat_obj', t => SH(100, 66) +
    P('M26 138C26 84 58 50 100 50C142 50 174 84 174 138Z', K.yellow) + R(14, 136, 172, 22, '#eab308', 10) + R(86, 42, 28, 96, '#eab308', 8) + R(92, 42, 16, 96, K.yellow, 6) + S('M52 96C58 80 68 72 80 66', '#fff', 6, ' opacity=".6"'));
  def('tools', 'drill', t => SH(100, 60) +
    P('M30 56H128C142 56 150 64 150 76V90H64L54 156C52 166 40 168 40 158L30 96Z', t.a) + R(128, 68, 38, 24, t.dmetal || K.dmetal, 4) + R(166, 74, 22, 12, t.metal || K.metal, 3) + R(38, 108, 26, 44, t.ink, 8) + R(42, 62, 52, 14, t.acc, 4) + S('M172 74L182 74M172 86L184 86', K.ink, 2));
  def('tools', 'saw', t => SH(100, 50) +
    G(P('M30 90H182L182 122H120L30 102Z', t.metal || K.metal) + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => `<polygon points="${64 + i * 14},112 ${71 + i * 14},128 ${78 + i * 14},112" fill="${K.metal}"/>`).join('') + R(20, 84, 30, 44, t.a, 14) + R(28, 96, 14, 20, t.light, 7), 'rotate(-14 100 100)'));
  def('tools', 'scissors_obj', t => SH(100, 50) +
    G(P('M100 108L52 24C50 20 58 16 62 20L112 100Z', t.metal || K.metal) + P('M100 108L148 24C150 20 142 16 138 20L88 100Z', K.metal), 'rotate(0)') + C(64, 148, 26, 'none', ` stroke="${t.a}" stroke-width="12"`) + C(136, 148, 26, 'none', ` stroke="${t.a}" stroke-width="12"`) + S('M74 126L96 104M126 126L104 104', t.a, 10) + C(100, 104, 6, t.ink));

  // ----- fun & sports -----
  def('fun', 'soccer_ball', t => SH(100, 60) +
    C(100, 100, 70, '#ffffff') + C(100, 100, 70, 'none', ` stroke="${t.ink}" stroke-width="5"`) + PG('100,66 128,86 118,120 82,120 72,86', t.ink) +
    S('M100 66V38M128 86L156 78M118 120L138 146M82 120L62 146M72 86L44 78', t.ink, 5));
  def('fun', 'basketball_obj', t => SH(100, 60) +
    C(100, 100, 70, K.orange) + S('M30 100H170M100 30V170', t.ink, 5) + S('M50 50C76 76 76 124 50 150M150 50C124 76 124 124 150 150', t.ink, 5) + C(100, 100, 70, 'none', ` stroke="${t.ink}" stroke-width="5"`));
  def('fun', 'tennis_racket', t => SH(100, 46) +
    G(E(100, 66, 44, 56, 'none', ` stroke="${t.a}" stroke-width="12"`) + S('M100 12V120M60 40H140M56 66H144M60 92H140M78 18V114M122 18V114', t.light, 3, ' opacity=".8"') + R(92, 118, 16, 56, t.ink, 6) + R(90, 118, 20, 12, t.acc, 3), 'rotate(-30 100 100)') + C(150, 158, 16, K.yellow) + S('M138 152C146 156 154 164 156 172', '#fff', 3));
  def('fun', 'dumbbell_obj', t => SH(100, 66) +
    G(R(58, 92, 84, 16, t.metal || K.metal, 6) + R(28, 62, 26, 76, t.a, 8) + R(146, 62, 26, 76, t.a, 8) + R(12, 78, 18, 44, t.b, 6) + R(170, 78, 18, 44, t.b, 6), 'rotate(-20 100 100)'));
  def('fun', 'guitar_obj', t => SH(100, 44) +
    G(R(94, 10, 12, 92, '#5b3a22', 4) + R(88, 4, 24, 20, t.ink, 5) + P('M100 88C74 76 54 92 62 114C44 124 42 158 70 172C88 182 112 182 130 172C158 158 156 124 138 114C146 92 126 76 100 88Z', t.a) + C(100, 132, 15, t.ink) + R(78, 156, 44, 8, '#5b3a22', 3) + S('M97 24V150M103 24V150', t.light, 1.6, ' opacity=".8"'), 'rotate(35 100 100)'));
  def('fun', 'drum', t => SH(100, 66) +
    E(100, 70, 72, 24, t.light) + P('M28 70V132C28 152 60 164 100 164C140 164 172 152 172 132V70C172 90 140 100 100 100C60 100 28 90 28 70Z', t.a) + S('M40 92L60 150M76 100L84 160M124 100L116 160M160 92L140 150', t.light, 4, ' opacity=".6"') + E(100, 70, 72, 24, 'none', ` stroke="${t.b}" stroke-width="6"`) + G(R(-4, -50, 8, 100, K.wood, 4), 'translate(74 44) rotate(-30)') + G(R(-4, -50, 8, 100, K.lwood, 4), 'translate(128 44) rotate(28)'));
  def('fun', 'piano_keys', t => SH(100, 60) +
    R(20, 60, 160, 100, t.light, 8, ` stroke="${t.ink}" stroke-width="4"`) + [1, 2, 3, 4, 5, 6].map(i => S(`M${20 + i * 22.8} 60V160`, t.ink, 3)).join('') + [1, 2, 4, 5, 6].map(i => R(20 + i * 22.8 - 8, 60, 16, 62, t.ink, 3)).join('') + R(20, 44, 160, 20, t.a, 6) + R(30, 48, 30, 8, t.light, 3, LT));
  def('fun', 'paint_palette', t => SH(100, 60) +
    P('M100 26C52 26 20 62 24 104C28 144 62 170 100 170C124 170 126 152 116 140C106 126 116 112 136 112H150C170 112 182 100 180 82C176 50 144 26 100 26Z', '#f3d9b1') + C(64, 76, 11, K.red) + C(96, 54, 11, K.yellow) + C(134, 60, 11, K.green) + C(156, 86, 11, K.blue) + C(56, 116, 11, K.purple) + C(100, 148, 0.1, '#fff'));
  def('fun', 'balloons', t => SH(100, 40) +
    S('M66 116C74 140 96 150 100 180M134 110C126 138 106 150 100 180M100 96C102 130 100 150 100 180', t.ink, 2.5) +
    [[66, 68, t.a], [134, 64, t.e], [100, 46, t.acc]].map(b => P(`M${b[0]} ${b[1] - 40}C${b[0] - 30} ${b[1] - 40} ${b[0] - 34} ${b[1] + 8} ${b[0]} ${b[1] + 34}C${b[0] + 34} ${b[1] + 8} ${b[0] + 30} ${b[1] - 40} ${b[0]} ${b[1] - 40}Z`, b[2]) + C(b[0] - 10, b[1] - 16, 5, '#fff', ' opacity=".5"')).join(''));
  def('fun', 'party_hat', t => SH(100, 50) +
    P('M100 22L44 170H156Z', t.a) + S('M78 100L128 120M64 138L140 152', t.acc, 8) + C(100, 20, 14, t.acc) + [[84, 70], [110, 100], [70, 156], [126, 160]].map(p => C(p[0], p[1], 5, t.light)).join('') + E(100, 170, 56, 10, t.b));
  def('fun', 'dice_obj', t => SH(100, 66) +
    G(R(50, 50, 100, 100, t.light, 20, ` stroke="${t.a}" stroke-width="8"`) + [[76, 76], [124, 76], [76, 124], [124, 124], [100, 100]].map(p => C(p[0], p[1], 8, t.a)).join(''), 'rotate(-12 100 100)'));
  def('fun', 'kite', t => SH(100, 30) +
    P('M110 14L166 82L110 150L54 82Z', t.a) + P('M110 14L166 82L110 82Z', t.c) + P('M110 150L54 82L110 82Z', t.e) + S('M110 14V150M54 82H166', t.light, 3) + S('M110 150C90 166 130 172 108 188', t.ink, 3) + PG('96,168 108,162 108,174', t.acc) + PG('112,178 124,172 122,184', t.acc));
  def('fun', 'chess_piece', t => SH(100, 66) +
    R(96, 12, 8, 26, t.ink, 3) + R(86, 22, 28, 8, t.ink, 3) + P('M100 38C80 38 70 52 76 68C80 78 88 84 88 92C88 104 70 118 66 150H134C130 118 112 104 112 92C112 84 120 78 124 68C130 52 120 38 100 38Z', t.a) + R(54, 150, 92, 14, t.b, 6) + R(44, 164, 112, 14, t.a, 6));
  def('fun', 'film_clapper', t => SH(100, 66) +
    R(28, 82, 144, 88, t.ink, 8) + G(R(28, 52, 144, 26, t.ink, 5) + [0, 1, 2, 3, 4, 5].map(i => P(`M${34 + i * 24} 52H${52 + i * 24}L${40 + i * 24} 78H${22 + i * 24}Z`, '#fff')).join(''), 'rotate(-10 28 78)') + R(28, 78, 144, 22, t.ink, 0) + S('M50 124H150M50 146H120', t.light, 5, ' opacity=".7"'));
  def('fun', 'ticket_obj', t => SH(100, 60) +
    G(P('M20 64H180V90C166 90 166 112 180 112V138H20V112C34 112 34 90 20 90Z', t.a) + S('M136 64V138', t.light, 4, ' stroke-dasharray="6 6"') + PG('78,80 86,98 106,100 91,112 96,130 78,120 60,130 65,112 50,100 70,98', t.acc), 'rotate(-8 100 100)'));
  def('fun', 'skateboard_obj', t => SH(100, 56) +
    P('M18 92C20 110 34 118 52 118H148C166 118 180 110 182 92C170 100 158 104 148 104H52C42 104 30 100 18 92Z', t.a) + R(44, 104, 112, 8, t.b, 4) + C(60, 140, 15, t.ink) + C(140, 140, 15, t.ink) + C(60, 140, 6, t.acc) + C(140, 140, 6, t.acc) + R(52, 118, 16, 12, t.metal || K.metal) + R(132, 118, 16, 12, K.metal));

  // ----- travel -----
  def('travel', 'suitcase_obj', t => SH(100, 66) +
    S('M76 56V44C76 34 84 30 92 30H108C116 30 124 34 124 44V56', t.ink, 9) + R(26, 54, 148, 110, t.a, 16) + R(50, 54, 12, 110, t.b) + R(138, 54, 12, 110, t.b) + R(88, 100, 24, 18, t.acc, 4) + R(38, 164, 24, 10, t.ink, 4) + R(138, 164, 24, 10, t.ink, 4));
  def('travel', 'passport', t => SH(100, 66) +
    G(R(50, 24, 100, 148, t.a, 10) + R(60, 24, 90, 148, t.b, 8) + C(110, 88, 26, 'none', ` stroke="${t.acc}" stroke-width="4"`) + S('M84 88H136M110 62V114M92 70C100 80 100 98 92 108M128 70C120 80 120 98 128 108', t.acc, 3) + R(80, 132, 60, 8, t.acc, 3) + R(80, 146, 40, 6, t.acc, 3), 'rotate(-6 100 100)'));
  def('travel', 'compass_obj', t => SH(100, 60) +
    C(100, 100, 74, t.a) + C(100, 100, 62, t.light) + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => G(R(-1.5, -60, 3, 8, t.ink, 1), `translate(100 100) rotate(${i * 30})`)).join('') + G(PG('100,38 112,100 88,100', K.red) + PG('100,162 112,100 88,100', t.d), 'rotate(35 100 100)') + C(100, 100, 7, t.ink) + R(92, 16, 16, 14, t.b, 3));
  def('travel', 'map_pin', t => SH(100, 40) +
    P('M100 178C100 178 40 116 40 78C40 44 66 22 100 22C134 22 160 44 160 78C160 116 100 178 100 178Z', t.a) + C(100, 78, 26, t.light) + E(100, 184, 32, 6, '#000', ' opacity=".15"'));
  def('travel', 'tent_obj', t => SH(100, 74) +
    PG('100,28 184,166 16,166', t.a) + PG('100,28 184,166 100,166', '#000', ' opacity=".12"') + PG('100,90 130,166 70,166', t.ink) + S('M100 28V14', t.ink, 5) + PG('100,14 116,20 100,26', t.acc) + R(8, 166, 184, 8, K.green, 4, ' opacity=".7"'));
  def('travel', 'sunglasses', t => SH(100, 46) +
    P('M18 76H182C182 76 178 82 176 100C172 132 150 138 134 132C118 126 114 112 112 98H88C86 112 82 126 66 132C50 138 28 132 24 100C22 82 18 76 18 76Z', t.ink) + P('M32 88C32 110 40 122 56 124C68 124 76 114 76 100V88Z', t.b, ' opacity=".6"') + P('M168 88C168 110 160 122 144 124C132 124 124 114 124 100V88Z', t.b, ' opacity=".6"') + S('M18 76L8 64M182 76L192 64', t.ink, 6));
  def('travel', 'life_ring', t => SH(100, 50) +
    C(100, 100, 70, 'none', ` stroke="${t.a}" stroke-width="34"`) + [0, 90, 180, 270].map(a => G(R(-18, -86, 36, 34, '#fff', 0), `translate(100 100) rotate(${a + 45})`)).join('') + C(100, 100, 86, 'none', ` stroke="${t.ink}" stroke-width="4" opacity=".2"`));
  def('travel', 'anchor_obj', t => SH(100, 46) +
    C(100, 42, 14, 'none', ` stroke="${t.a}" stroke-width="10"`) + R(94, 54, 12, 108, t.a, 4) + R(66, 74, 68, 10, t.a, 4) + S('M32 128C36 160 68 178 100 178C132 178 164 160 168 128', t.a, 12) + PG('22,124 42,110 46,136', t.a) + PG('178,124 158,110 154,136', t.a));

  // ----- symbols & concepts -----
  def('symbol', 'magnifier', t => SH(100, 50) +
    C(84, 84, 52, t.light, ` stroke="${t.a}" stroke-width="14"`) + S('M64 64C70 54 80 50 92 52', '#fff', 6, ' opacity=".7"') + G(R(-9, 0, 18, 60, t.ink, 8), 'translate(128 128) rotate(-45)'));
  def('symbol', 'key_obj', t => SH(100, 50) +
    G(C(56, 100, 34, K.gold) + C(56, 100, 14, t.bg0 || '#ffffff') + R(84, 92, 92, 16, K.gold, 4) + R(140, 108, 14, 22, K.gold, 3) + R(162, 108, 14, 16, K.gold, 3), 'rotate(-28 100 100)'));
  def('symbol', 'padlock', t => SH(100, 60) +
    S('M64 90V64C64 40 76 26 100 26C124 26 136 40 136 64V90', t.metal || K.metal, 14) + R(38, 84, 124, 92, t.a, 16) + R(38, 84, 124, 20, '#fff', 16, ' opacity=".12"') + C(100, 124, 14, t.ink) + R(94, 130, 12, 24, t.ink, 4));
  def('symbol', 'shield_obj', t => SH(100, 50) +
    P('M100 20L162 44V100C162 140 136 164 100 180C64 164 38 140 38 100V44Z', t.a) + P('M100 20L162 44V100C162 140 136 164 100 180Z', '#000', ' opacity=".12"') + P('M100 40L146 56V100C146 130 126 148 100 162C74 148 54 130 54 100V56Z', t.b) + S('M76 100L94 118L126 80', '#fff', 10));
  def('symbol', 'crown_obj', t => SH(100, 50) +
    P('M22 66L58 100L100 40L142 100L178 66L162 152H38Z', K.gold) + R(38, 152, 124, 18, '#eab308', 6) + C(22, 62, 9, t.acc) + C(178, 62, 9, t.acc) + C(100, 36, 10, t.acc) + C(100, 130, 10, K.red) + C(66, 130, 7, t.b) + C(134, 130, 7, t.b));
  def('symbol', 'flag_obj', t => SH(100, 50) +
    R(44, 20, 10, 156, t.ink, 5) + P('M54 28C80 16 100 40 126 28C148 20 160 24 168 30V96C160 90 148 86 126 94C100 106 80 82 54 96Z', t.a) + P('M54 62C80 50 100 74 126 62C148 54 160 58 168 64V96C160 90 148 86 126 94C100 106 80 82 54 96Z', t.c, ' opacity=".55"') + C(49, 20, 8, t.acc));
  def('symbol', 'bell_obj', t => SH(100, 40) +
    P('M100 22C64 22 56 56 56 88C56 122 40 132 32 146H168C160 132 144 122 144 88C144 56 136 22 100 22Z', K.gold) + S('M74 44C68 56 66 70 66 86', '#fff', 6, ' opacity=".5"') + C(100, 16, 8, '#eab308') + P('M78 150C82 172 118 172 122 150Z', K.dbrown) + S('M164 40C172 48 176 60 176 72M36 40C28 48 24 60 24 72', t.acc, 6));
  def('symbol', 'heart_obj', t => SH(100, 50) +
    P('M100 174C36 130 20 96 20 68C20 42 40 26 62 26C80 26 94 36 100 52C106 36 120 26 138 26C160 26 180 42 180 68C180 96 164 130 100 174Z', t.a) + S('M46 62C46 52 54 44 66 44', '#fff', 8, ' opacity=".5"'));
  def('symbol', 'star_obj', t => SH(100, 40) +
    PG('100,22 122,74 178,78 136,114 149,168 100,138 51,168 64,114 22,78 78,74', K.gold) + PG('100,22 122,74 100,100 78,74', '#fde68a') + PG('100,138 51,168 64,114 100,100', '#eab308', ' opacity=".6"'));
  def('symbol', 'puzzle_piece', t => SH(100, 50) +
    P('M48 60H86C80 40 100 26 114 34C128 26 148 40 142 60H160V96C180 90 192 108 178 122C192 136 180 154 160 148V168H48V128C68 134 76 108 58 100C40 92 48 76 48 60Z', t.a) + S('M58 76C66 68 84 68 92 74', '#fff', 5, ' opacity=".4"'));
  def('symbol', 'hourglass_obj', t => SH(100, 40) +
    R(44, 20, 112, 14, t.ink, 6) + R(44, 166, 112, 14, t.ink, 6) + P('M58 34H142C142 76 112 90 112 100C112 110 142 124 142 166H58C58 124 88 110 88 100C88 90 58 76 58 34Z', t.light, ` opacity=".9" stroke="${t.ink}" stroke-width="4"`) + P('M74 152C74 130 92 118 100 112C108 118 126 130 126 152Z', K.gold) + P('M88 40H112C110 52 104 60 100 64C96 60 90 52 88 40Z', K.gold));
  def('symbol', 'speech_bubbles', t => SH(100, 50) +
    P('M22 40H128C138 40 144 46 144 56V104C144 114 138 120 128 120H70L42 146V120H22C12 120 8 114 8 104V56C8 46 12 40 22 40Z', t.a) + P('M84 84H178C188 84 192 90 192 100V140C192 150 188 156 178 156H170V180L142 156H98C88 156 84 150 84 140Z', t.acc) + R(28, 62, 88, 8, t.light, 4) + R(28, 80, 60, 8, t.light, 4) + C(110, 120, 5, t.ink) + C(132, 120, 5, t.ink) + C(154, 120, 5, t.ink));
  def('symbol', 'gear_pair', t => SH(100, 40) +
    (function gear(cx, cy, r, teeth, fill, hole) { let s = ''; for (let i = 0; i < teeth; i++) s += G(R(-7, -r - 10, 14, 20, fill, 3), `translate(${cx} ${cy}) rotate(${i * 360 / teeth})`); return s + C(cx, cy, r, fill) + C(cx, cy, r * 0.42, hole); })(72, 84, 44, 8, t.a, t.bg0 || '#fff') +
    (function gear(cx, cy, r, teeth, fill, hole) { let s = ''; for (let i = 0; i < teeth; i++) s += G(R(-6, -r - 9, 12, 18, fill, 3), `translate(${cx} ${cy}) rotate(${i * 360 / teeth + 12})`); return s + C(cx, cy, r, fill) + C(cx, cy, r * 0.42, hole); })(140, 140, 32, 7, t.acc, t.bg0 || '#fff'));
  def('symbol', 'target_obj', t => SH(100, 60) +
    C(100, 100, 74, t.a) + C(100, 100, 56, t.light) + C(100, 100, 38, t.b) + C(100, 100, 20, t.light) + C(100, 100, 8, t.acc) + S('M100 100L164 36', t.ink, 5) + PG('164,36 178,26 172,44', t.e));
  def('symbol', 'recycle_sign', t => SH(100, 40) +
    [0, 120, 240].map(a => G(P('M100 26L128 26L146 58L128 56L112 84L84 84L104 50L88 48Z', K.green) + PG('146,58 168,48 156,74', K.dgreen), `rotate(${a} 100 100)`)).join(''));
  def('symbol', 'check_badge', t => SH(100, 40) +
    (function () { let s = ''; for (let i = 0; i < 12; i++) s += G(C(0, -60, 22, t.a), `translate(100 100) rotate(${i * 30})`); return s; })() + C(100, 100, 66, t.a) + S('M68 102L92 126L136 76', '#fff', 14));
  def('symbol', 'ribbon_award', t => SH(100, 40) +
    PG('62,120 92,120 78,184 56,160 30,164', t.b) + PG('138,120 108,120 122,184 144,160 170,164', t.a) + (function () { let s = ''; for (let i = 0; i < 16; i++) s += G(C(0, -50, 13, K.gold), `translate(100 90) rotate(${i * 22.5})`); return s; })() + C(100, 90, 52, K.gold) + C(100, 90, 40, '#fde68a') + PG('100,64 108,82 128,84 113,96 118,116 100,106 82,116 87,96 72,84 92,82', K.gold));
  def('symbol', 'question_block', t => SH(100, 50) +
    R(36, 36, 128, 128, t.acc, 14) + R(36, 36, 128, 128, 'none', 14, ` stroke="${t.a}" stroke-width="8"`) + [[50, 50], [150, 50], [50, 150], [150, 150]].map(p => C(p[0], p[1], 5, t.a)).join('') + `<text x="100" y="136" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="96" fill="${t.a}">?</text>`);
  def('symbol', 'trophy_star', t => SH(100, 50) +
    PG('100,22 118,64 164,68 130,98 140,144 100,120 60,144 70,98 36,68 82,64', K.gold) + R(84, 130, 32, 30, t.a, 4) + R(64, 158, 72, 16, t.ink, 6));
  def('symbol', 'thumbs_up_obj', t => SH(100, 50) +
    R(24, 84, 36, 88, t.b, 8) + P('M68 92L100 30C122 30 128 50 122 68L118 84H164C178 84 184 96 180 108L168 156C165 166 158 172 148 172H68Z', t.a) + R(36, 150, 12, 10, '#fff', 5, ' opacity=".5"'));
  def('symbol', 'rocket_obj', t => SH(100, 40) +
    G(P('M100 16C136 40 148 84 138 134H62C52 84 64 40 100 16Z', t.light) + P('M100 16C136 40 148 84 138 134H100Z', '#000', ' opacity=".07"') + C(100, 74, 16, t.a) + C(100, 74, 9, t.c) + P('M62 100L34 128L34 156L66 136Z', t.a) + P('M138 100L166 128L166 156L134 136Z', t.a) + R(84, 134, 32, 10, t.ink, 3) + P('M82 146H118C114 166 108 178 100 190C92 178 86 166 82 146Z', K.orange) + P('M92 146H108C106 160 104 168 100 176C96 168 94 160 92 146Z', K.yellow), 'rotate(30 100 100)'));

  // ----- music -----
  def('music', 'music_note', t => SH(100, 40) + C(70, 156, 22, t.a) + C(138, 140, 22, t.a) + R(88, 46, 10, 112, t.ink, 3) + R(126, 40, 10, 100, t.ink, 3) + P('M88 46C104 40 122 40 136 52C122 46 106 48 88 60Z', t.ink));
  def('music', 'treble_clef', t => SH(100, 40) + S('M104 30C70 30 66 62 92 78C120 96 140 116 130 142C122 164 92 166 84 144C78 128 92 118 100 130C106 140 94 148 88 138M104 30V178', t.ink, 9));
  def('music', 'violin', t => SH(100, 40) + P('M100 26C118 26 122 44 114 54C130 60 136 78 124 90C136 100 132 122 114 124C122 140 108 158 100 158C92 158 78 140 86 124C68 122 64 100 76 90C64 78 70 60 86 54C78 44 82 26 100 26Z', t.a) + R(94, 158, 12, 32, t.dbrown || K.dbrown) + S('M100 42V150', t.ink, 3) + C(88, 74, 4, t.ink) + C(112, 74, 4, t.ink));
  def('music', 'saxophone', t => SH(100, 46) + S('M74 26C110 26 122 46 110 66C96 88 72 96 72 126C72 150 92 162 112 152', t.acc, 18) + C(74, 26, 9, t.ink) + C(116, 156, 22, t.b) + [86, 100, 114].map(y => C(78, y, 3, t.ink)).join(''));
  def('music', 'trumpet', t => SH(100, 36) + P('M30 96C30 88 36 84 44 86L110 100V116L44 130C36 132 30 128 30 120Z', t.acc) + P('M110 92C150 92 178 96 178 108C178 120 150 124 110 124Z', t.acc) + [128, 146, 164].map(x => R(x, 76, 8, 20, t.acc, 3)).join('') + [128, 146, 164].map(x => C(x + 4, 74, 5, t.ink)).join(''));
  def('music', 'drum_set', t => SH(100, 60) + E(100, 150, 46, 14, t.d) + R(54, 96, 92, 54, t.a, 4) + E(100, 96, 46, 12, t.light) + S('M60 100V146M100 100V150M140 100V146', t.ink, 2, ' opacity=".3"') + S('M150 150V70', t.metal || K.metal, 5) + E(150, 66, 30, 8, t.b) + E(150, 66, 30, 8, 'none', ` stroke="${t.d}" stroke-width="2"`));
  def('music', 'vinyl_record', t => SH(100, 40) + C(100, 100, 66, t.ink) + C(100, 100, 50, '#000', ' opacity=".15"') + C(100, 100, 34, t.a) + C(100, 100, 8, t.light));
  def('music', 'microphone_obj', t => SH(100, 40) + S('M100 118V158M74 156H126', t.ink, 8) + R(80, 30, 40, 84, t.ink, 20) + [42, 54, 66, 78].map(y => S(`M80 ${y}H120`, t.metal || K.metal, 3)).join('') + S('M64 84C64 108 80 120 100 120C120 120 136 108 136 84', t.ink, 8));
  def('music', 'boombox', t => SH(100, 46) + R(30, 76, 140, 84, t.a, 10) + R(30, 76, 140, 20, t.ink, 6, ' opacity=".2"') + C(64, 132, 26, t.ink) + C(64, 132, 16, t.light) + C(136, 132, 26, t.ink) + C(136, 132, 16, t.light) + R(84, 88, 32, 14, t.ink, 3) + S('M46 60L58 76M154 60L142 76', t.ink, 6));

  // ----- space -----
  def('space', 'astronaut_helmet', t => SH(100, 40) + C(100, 100, 62, t.light) + C(100, 100, 62, 'none', ` stroke="${t.b}" stroke-width="8"`) + E(100, 100, 40, 44, t.c) + E(84, 90, 12, 16, t.light, ' opacity=".7"') + R(30, 128, 140, 20, t.b, 10) + R(90, 30, 20, 24, t.acc, 6));
  def('space', 'alien_obj', t => SH(100, 40) + P('M100 26C60 26 48 70 60 100C48 108 48 124 62 128C70 150 130 150 138 128C152 124 152 108 140 100C152 70 140 26 100 26Z', t.a) + E(74, 90, 14, 20, t.ink) + E(126, 90, 14, 20, t.ink) + E(74, 86, 4, 6, t.light) + E(126, 86, 4, 6, t.light) + S('M88 122C94 128 106 128 112 122', t.ink, 4) + S('M60 150V172M100 156V178M140 150V172', t.acc, 6));
  def('space', 'moon_phase', t => SH(100, 40) + C(100, 100, 66, t.light) + P('M100 34C64 34 38 66 38 100C38 134 64 166 100 166C76 150 66 128 66 100C66 72 76 50 100 34Z', t.d) + [[70, 66, 8], [122, 86, 6], [92, 128, 9], [130, 130, 5]].map(c => C(c[0], c[1], c[2], t.d, ' opacity=".5"')).join(''));
  def('space', 'asteroid_obj', t => SH(100, 40) + P('M60 60C82 40 128 38 152 58C176 76 178 116 158 138C140 158 100 168 72 152C44 136 36 84 60 60Z', t.d) + [[76, 78, 8], [122, 66, 6], [140, 108, 9], [86, 130, 7], [116, 138, 5]].map(c => C(c[0], c[1], c[2], t.b, ' opacity=".5"')).join(''));
  def('space', 'spaceship_obj', t => SH(100, 40) + P('M100 30C130 30 148 70 148 108C148 128 128 138 100 138C72 138 52 128 52 108C52 70 70 30 100 30Z', t.light) + P('M52 108C40 108 30 122 30 140H70Z', t.light) + P('M148 108C160 108 170 122 170 140H130Z', t.light) + C(100, 90, 20, t.b) + C(100, 90, 12, t.c) + PG('80,138 100,178 120,138', t.acc));
  def('space', 'telescope_obj', t => SH(100, 46) + G(P('M40 60L160 100L152 128L36 92Z', t.a) + C(40, 60, 12, t.d), 'rotate(0 100 90)') + S('M100 128L70 178M130 128L160 178', t.ink, 8) + S('M84 154H146', t.ink, 8) + C(150, 96, 5, t.acc));
  def('space', 'shooting_star', t => SH(100, 40) + PG('130,80 138,104 162,108 142,124 150,148 130,134 108,146 116,122 100,104 124,102', K.gold) + S('M92 96C68 88 44 84 22 88M100 80C86 62 68 48 46 40M116 96C104 78 92 62 78 46', t.acc, 4, ' opacity=".5"'));
  def('space', 'space_flag', t => SH(100, 40) + R(90, 40, 10, 140, t.ink, 3) + PG('100,44 168,58 100,84', t.acc) + C(80, 150, 36, t.d) + [[64, 138, 5], [96, 158, 4], [58, 162, 4]].map(c => C(c[0], c[1], c[2], t.b, ' opacity=".5"')).join(''));

  // ----- celebration -----
  def('celebration', 'confetti_pop', t => SH(100, 46) + P('M60 176C60 176 76 116 100 100C124 84 176 90 176 90L100 60Z', t.a) + [[64, 60, t.acc], [96, 40, t.c], [128, 66, t.b], [150, 40, K.gold], [78, 92, t.acc], [40, 100, t.c]].map(c => R(c[0] - 5, c[1] - 5, 10, 10, c[2], 2, ` transform="rotate(${(c[0] * 7) % 45} ${c[0]} ${c[1]})"`)).join('') + [[110, 30], [140, 96], [50, 60]].map(c => C(c[0], c[1], 4, K.gold)).join(''));
  def('celebration', 'fireworks_obj', t => SH(100, 40) + [0, 45, 90, 135, 180, 225, 270, 315].map(a => S(`M100 100L${100 + Math.cos(a * Math.PI / 180) * 56} ${100 + Math.sin(a * Math.PI / 180) * 56}`, t.acc, 5)).join('') + [0, 45, 90, 135, 180, 225, 270, 315].map(a => C(100 + Math.cos(a * Math.PI / 180) * 56, 100 + Math.sin(a * Math.PI / 180) * 56, 5, K.gold)).join('') + C(100, 100, 10, t.a));
  def('celebration', 'lantern_obj', t => SH(100, 40) + S('M100 20V38', t.ink, 4) + R(84, 38, 32, 10, t.ink, 3) + P('M66 48C66 100 66 130 100 170C134 130 134 100 134 48Z', t.acc) + S('M78 60C78 104 78 122 100 150M122 60C122 104 122 122 100 150', t.a, 3, ' opacity=".5"') + R(84, 160, 32, 10, t.ink, 3));
  def('celebration', 'pumpkin_obj', t => SH(100, 40) + S('M100 60V38C100 30 110 26 116 32', K.dgreen, 6) + [-42, -14, 14, 42].map(dx => P(`M${100 + dx} 174C${86 + dx} 174 ${78 + dx} 140 ${78 + dx} 110C${78 + dx} 82 ${88 + dx} 60 ${100 + dx} 60C${112 + dx} 60 ${122 + dx} 82 ${122 + dx} 110C${122 + dx} 140 ${114 + dx} 174 ${100 + dx} 174Z`, K.orange, ' opacity=".92"')).join('') + PG('82,90 92,110 76,110', t.ink) + PG('118,90 128,110 112,110', t.ink) + PG('84,130 100,140 116,130 116,144 84,144', t.ink));
  def('celebration', 'christmas_tree_obj', t => SH(100, 60) + PG('100,26 130,74 70,74', K.dgreen) + PG('100,58 138,112 62,112', K.dgreen) + PG('100,96 148,158 52,158', K.dgreen) + R(88, 158, 24, 18, t.dbrown || K.dbrown, 3) + [[86, 90], [116, 76], [78, 130], [122, 140], [100, 106]].map(p => C(p[0], p[1], 5, K.gold)).join('') + PG('100,10 106,22 118,22 108,30 112,42 100,34 88,42 92,30 82,22 94,22', K.gold));
  def('celebration', 'easter_egg', t => SH(100, 40) + P('M100 30C130 30 152 78 152 114C152 148 128 172 100 172C72 172 48 148 48 114C48 78 70 30 100 30Z', t.acc) + S('M60 90C80 100 120 100 140 90M56 122C80 132 120 132 144 122', t.light, 6) + [[80, 60], [120, 150], [70, 140]].map(p => C(p[0], p[1], 5, t.light)).join(''));
  def('celebration', 'party_streamer', t => SH(100, 40) + S('M20 40C60 80 40 120 80 140C120 160 100 100 140 90C180 80 170 140 178 160', t.acc, 6) + [[36, 44, t.a], [92, 130, t.c], [150, 88, t.b], [66, 96, K.gold]].map(c => R(c[0] - 5, c[1] - 5, 10, 10, c[2], 2)).join(''));
  def('celebration', 'birthday_cake', t => SH(100, 50) + R(40, 132, 120, 44, t.acc, 6) + R(40, 132, 120, 12, t.a, 0) + R(58, 96, 84, 40, t.c, 4) + R(58, 96, 84, 10, t.b, 0) + R(76, 66, 48, 34, t.light, 3) + [64, 100, 136].map(x => S(`M${x} 66V44`, K.gold, 4)).join('') + [64, 100, 136].map(x => PG(`${x - 5},44 ${x + 5},44 ${x},32`, K.orange)).join(''));
  def('celebration', 'candle_obj', t => SH(100, 40) + R(80, 92, 40, 92, t.a, 8) + S('M84 108H116M84 128H116M84 148H116', t.light, 3, ' opacity=".5"') + PG('80,120 100,90 120,120', t.acc, ' opacity=".9"') + S('M100 92V64', t.ink, 3) + P('M100 34C88 48 88 62 100 66C112 62 112 48 100 34Z', K.orange));

  // ----- baby_kids -----
  def('baby_kids', 'baby_bottle', t => SH(100, 40) + R(72, 30, 56, 24, t.light, 8) + R(70, 54, 60, 30, t.acc, 6) + R(62, 84, 76, 88, t.light, 16) + S('M72 100H128M72 120H128M72 140H128', t.acc, 3, ' opacity=".4"') + R(66, 30, 68, 10, t.b, 4));
  def('baby_kids', 'pacifier_obj', t => SH(100, 40) + C(100, 90, 32, t.a) + C(100, 90, 32, 'none', ` stroke="${t.b}" stroke-width="8"`) + R(84, 118, 32, 26, t.c, 10) + C(100, 158, 20, t.d) + C(100, 158, 12, t.light));
  def('baby_kids', 'rattle_obj', t => SH(100, 40) + C(100, 74, 44, t.acc) + C(88, 60, 8, t.light) + C(114, 88, 8, t.light) + C(70, 90, 6, t.light) + S('M100 116L120 176', t.b, 14) + C(120, 178, 12, t.b));
  def('baby_kids', 'teddy_bear_obj', t => SH(100, 46) + [64, 136].map(x => C(x, 46, 18, t.a)).join('') + [64, 136].map(x => C(x, 46, 9, t.d)).join('') + C(100, 92, 48, t.a) + [72, 128].map(x => C(x, 84, 8, t.d)).join('') + E(100, 100, 20, 16, t.d) + C(100, 156, 40, t.a) + C(100, 74, 5, t.ink) + C(126, 74, 5, t.ink));
  def('baby_kids', 'building_blocks', t => SH(100, 60) + G(R(0, 0, 56, 56, t.a, 6) + `<text x="28" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="28" fill="#fff">A</text>`, 'translate(32 108)') + G(R(0, 0, 56, 56, t.c, 6) + `<text x="28" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="28" fill="#fff">B</text>`, 'translate(96 108)') + G(R(0, 0, 40, 40, t.acc, 6), 'translate(112 64)'));
  def('baby_kids', 'stroller_obj', t => SH(100, 46) + wheel(66, 166, 20, t) + wheel(146, 166, 20, t) + S('M66 166L86 110H150', t.ink, 8) + P('M86 110C86 82 110 64 138 70C154 74 160 92 150 108Z', t.a) + R(90, 108, 60, 42, t.b, 6) + S('M150 108C168 108 178 92 186 72', t.ink, 6));
  def('baby_kids', 'night_light', t => SH(100, 40) + P('M100 30C76 30 58 50 58 74C58 100 78 116 100 116C122 116 142 100 142 74C138 92 122 100 108 92C120 84 124 66 112 52C114 66 104 78 90 78C92 60 96 44 100 30Z', t.acc) + R(84, 116, 32, 10, t.ink, 3) + R(74, 126, 52, 12, t.ink, 4) + S('M60 60L48 54M60 90L46 92M140 60L152 54', t.acc, 3, ' opacity=".4"'));
  def('baby_kids', 'baby_onesie', t => SH(100, 46) + P('M70 30H130V54L150 66V100H126V174H74V100H50V66L70 54Z', t.a) + C(100, 44, 10, t.light) + [[80, 116], [100, 128], [120, 116]].map(p => C(p[0], p[1], 6, t.light, ' opacity=".7"')).join(''));

  // ----- WEATHER OBJECTS (new) -----
  def('weather', 'sun_obj2', t => SH(100, 46) +
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => G(P('M100 12L108 40H92Z', K.gold), `rotate(${i * 30} 100 100)`)).join('') +
    C(100, 100, 48, K.yellow) + C(84, 86, 12, '#fde68a') + C(120, 116, 6, '#fde68a'));
  def('weather', 'cloud_rain_obj', t => SH(100, 46) +
    P('M46 120C20 120 10 96 18 78C26 62 44 56 58 62C62 34 88 16 114 24C136 30 146 48 146 62C168 58 184 74 180 94C177 108 166 116 150 116Z', t.d) +
    [[58, 132], [86, 144], [114, 132], [142, 144]].map(p => S(`M${p[0]} ${p[1]}L${p[0] - 8} ${p[1] + 30}`, t.b, 6)).join(''));
  def('weather', 'cloud_snow_obj', t => SH(100, 46) +
    P('M46 120C20 120 10 96 18 78C26 62 44 56 58 62C62 34 88 16 114 24C136 30 146 48 146 62C168 58 184 74 180 94C177 108 166 116 150 116Z', t.light) +
    [[60, 140], [90, 156], [120, 140], [150, 156]].map(p => C(p[0], p[1], 6, t.light, ` stroke="${t.c}" stroke-width="3"`)).join(''));
  def('weather', 'cloud_lightning_obj', t => SH(100, 46) +
    P('M46 108C20 108 10 84 18 66C26 50 44 44 58 50C62 22 88 4 114 12C136 18 146 36 146 50C168 46 184 62 180 82C177 96 166 104 150 104Z', t.a) +
    PG('112,96 82,142 106,142 90,184 140,128 114,128 128,96', K.yellow));
  def('weather', 'tornado_obj', t => SH(100, 40) +
    [0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="${20 + i * 6}" y="${28 + i * 22}" width="${160 - i * 20}" height="16" rx="8" fill="${i % 2 ? t.a : t.b}" opacity="${1 - i * 0.06}"/>`).join(''));
  def('weather', 'thermometer_full', t => SH(100, 40) +
    R(86, 20, 28, 120, t.light, 14, ` stroke="${t.ink}" stroke-width="6"`) + C(100, 148, 32, t.light, ` stroke="${t.ink}" stroke-width="6"`) + C(100, 148, 22, K.red) + R(94, 56, 12, 92, K.red, 6) + S('M128 44H142M128 64H142M128 84H142M128 104H142', t.ink, 4));
  def('weather', 'wind_sock', t => SH(100, 50) +
    R(40, 20, 8, 160, K.metal, 3) + P('M48 40H140L176 70L140 100H48Z', t.acc) + P('M48 100H140L168 122L140 144H48Z', t.b) + S('M90 40V100M132 40V100', t.light, 3, ' opacity=".4"'));

  // ----- CAMPING OBJECTS (new) -----
  def('camping', 'camp_tent', t => SH(100, 60) +
    PG('100,32 184,172 16,172', t.a) + PG('100,32 184,172 100,172', '#000', ' opacity=".12"') + PG('100,86 130,172 70,172', t.ink) + S('M100 32V16', t.ink, 4) + PG('100,16 114,20 100,26', t.acc));
  def('camping', 'camp_stove', t => SH(100, 66) +
    R(30, 100, 140, 60, t.metal, 8) + C(66, 130, 18, K.ink) + C(134, 130, 18, K.ink) + R(30, 90, 140, 14, t.dmetal, 4) + S('M60 90L66 130M140 90L134 130', t.dmetal, 3) + P('M76 90C72 74 84 68 88 80C90 64 108 64 108 80C116 72 124 84 116 90Z', K.orange));
  def('camping', 'lantern_camp', t => SH(100, 60) +
    S('M100 24V44', t.ink, 4) + E(100, 46, 42, 8, t.metal) + P('M62 50L74 20H126L138 50Z', t.acc) + P('M74 20H126L132 44H68Z', '#fff', ' opacity=".25"') + E(100, 138, 42, 8, t.metal) + S('M100 138V158', t.ink, 4) + E(100, 160, 20, 6, t.ink) + C(100, 90, 16, K.yellow, ' opacity=".35"'));
  def('camping', 'sleeping_bag', t => SH(100, 46) +
    P('M30 60C60 44 140 44 170 60V152C170 168 150 176 100 176C50 176 30 168 30 152Z', t.a) + S('M70 60V162', t.b, 3) + S('M130 60V162', t.b, 3) + P('M44 60C74 48 126 48 156 60L146 80H54Z', t.b, ' opacity=".8"') + S('M100 130V158', t.acc, 4));
  def('camping', 'camp_map', t => SH(100, 60) +
    P('M20 70L80 40L120 70L180 40V170L120 200L80 170L20 200Z', '#f3e3c4') + S('M80 40V170M120 70V200', t.ink, 3) + S('M46 130C60 130 70 100 90 100C110 100 120 130 140 120', t.a, 4, ' stroke-dasharray="4 6"') + C(46, 130, 6, K.red) + C(140, 120, 6, K.red));
  def('camping', 'canteen', t => SH(100, 46) +
    R(78, 24, 44, 20, t.dmetal, 6) + R(60, 40, 80, 130, t.metal, 14) + R(60, 40, 80, 16, t.b, 0) + R(60, 100, 80, 16, t.b, 0) + S('M100 44V170', t.dmetal, 3) + C(100, 20, 8, t.dmetal));
  def('camping', 'flashlight', t => SH(100, 46) +
    G(R(58, 68, 84, 56, t.acc, 12) + R(58, 68, 84, 14, t.a, 6) + R(120, 62, 12, 68, t.dmetal, 3) + R(52, 74, 8, 44, t.dmetal, 3) + P('M142 78L182 68V136L142 118Z', K.yellow, ' opacity=".35"'), 'rotate(-15 100 100)'));
  def('camping', 'pocket_knife', t => SH(100, 50) +
    G(R(60, 100, 80, 20, t.dmetal, 6) + R(76, 100, 48, 6, t.metal, 3) + S('M120 100L150 68V84L138 100', t.metal, 6) + C(90, 110, 6, t.ink), 'rotate(-25 100 100)'));

  // ----- KITCHEN OBJECTS (new) -----
  def('kitchen', 'pot', t => SH(100, 62) +
    E(100, 130, 70, 14, t.dmetal) + P('M32 78H168V128C168 148 152 160 100 160C48 160 32 148 32 128Z', t.dmetal) + S('M32 78C32 66 168 66 168 78', t.metal, 6) + S('M32 100H8M168 100H192', t.metal, 8) + E(100, 78, 68, 10, t.metal) + C(100, 78, 8, t.ink) + S('M80 44V62M100 44V62M120 44V62', t.metal, 4));
  def('kitchen', 'pan', t => SH(100, 62) +
    C(96, 120, 62, t.dmetal) + C(96, 120, 52, t.ink) + C(96, 120, 44, t.metal, ' opacity=".4"') + S('M156 116H196', t.dmetal, 12) + C(196, 116, 8, t.ink) + C(78, 100, 8, '#fff', ' opacity=".3"'));
  def('kitchen', 'chef_knife', t => SH(100, 46) +
    G(P('M60 40C60 30 100 26 140 30L140 100H60Z', t.metal) + P('M60 40C60 30 100 26 140 30L140 60L60 60Z', '#fff', ' opacity=".25"') + R(40, 92, 100, 12, t.ink, 6) + R(40, 100, 100, 12, t.ink, 6), 'rotate(15 100 100)'));
  def('kitchen', 'whisk', t => SH(100, 40) +
    G(R(92, 20, 16, 90, t.metal, 3) + C(100, 130, 10, t.metal) + S('M100 130C82 140 82 168 100 178C118 168 118 140 100 130', t.metal, 5) + S('M100 130C90 148 90 168 100 178', t.metal, 3) + S('M100 130C110 148 110 168 100 178', t.metal, 3), 'rotate(-20 100 100)'));
  def('kitchen', 'spoon_fork', t => SH(100, 46) +
    G(E(70, 56, 22, 30, t.metal) + R(62, 82, 16, 110, t.metal, 4), 'rotate(-12 70 100)') + G(P('M130 30C114 30 106 44 106 54V60H154V54C154 44 146 30 130 30Z', t.metal) + S('M130 60V194', t.metal, 6) + S('M122 60V130M138 60V130', t.metal, 3), 'rotate(-12 130 100)'));
  def('kitchen', 'cutting_board', t => SH(100, 66) +
    R(40, 40, 120, 160, '#e0b078', 12) + R(40, 40, 120, 12, '#c58b55', 4) + C(80, 46, 4, t.ink) + P('M80 100C80 80 100 76 120 76L120 140H80Z', t.light, ' opacity=".35"') + S('M120 140H80', t.ink, 3));
  def('kitchen', 'blender', t => SH(100, 40) +
    R(74, 20, 52, 24, t.dmetal, 6) + P('M64 44H136L126 140H74Z', t.light, ' opacity=".75"') + R(64, 44, 72, 96, 'none', 12, ` stroke="${t.metal}" stroke-width="6"`) + R(54, 140, 92, 20, t.a, 8) + R(70, 160, 60, 20, t.metal, 6) + C(100, 172, 5, K.red));
  def('kitchen', 'toaster', t => SH(100, 76) +
    R(30, 74, 140, 100, t.metal, 12) + R(30, 74, 140, 20, t.dmetal, 12) + R(56, 60, 32, 22, t.ink, 3) + R(112, 60, 32, 22, t.ink, 3) + R(66, 50, 68, 22, '#d9a86f', 6) + R(80, 26, 12, 26, '#d9a86f', 4) + R(110, 26, 12, 26, '#d9a86f', 4) + C(140, 122, 6, t.acc) + R(46, 118, 80, 4, t.dmetal, 2));

  // ----- FANTASY OBJECTS (new) -----
  def('fantasy', 'sword', t => SH(100, 30) +
    G(P('M100 8L112 24V130H88V24Z', t.light) + P('M100 8L112 24H88Z', t.dmetal) + S('M100 24V130', t.dmetal, 2) + R(76, 130, 48, 12, K.gold, 4) + R(92, 142, 16, 46, '#8a5a36', 4) + E(100, 190, 14, 6, K.gold), 'rotate(0)'));
  def('fantasy', 'shield_heraldic', t => SH(100, 44) +
    P('M100 16L172 40V100C172 144 142 172 100 190C58 172 28 144 28 100V40Z', t.b) + P('M100 16L172 40V100C172 144 142 172 100 190Z', '#000', ' opacity=".12"') + P('M100 30L160 50V98C160 136 134 160 100 178C66 160 40 136 40 98V50Z', t.a) + PG('100,60 108,88 138,90 114,110 122,140 100,124 78,140 86,110 62,90 92,88', K.gold));
  def('fantasy', 'potion', t => SH(100, 40) +
    C(100, 140, 44, t.light, ` stroke="${t.metal}" stroke-width="4"`) + R(88, 60, 24, 40, t.light, 4, ` stroke="${t.metal}" stroke-width="3"`) + R(80, 44, 40, 20, t.acc, 6) + C(100, 90, 8, t.b, ' opacity=".5"') + C(100, 130, 5, t.b, ' opacity=".5"') + C(100, 156, 4, t.b, ' opacity=".7"'));
  def('fantasy', 'spellbook', t => SH(100, 60) +
    R(46, 40, 108, 144, '#5b3a22', 8) + R(56, 40, 88, 144, '#c58b55', 6) + S('M76 60H146M76 76H126', '#5b3a22', 3) + PG('100,90 108,110 130,112 114,126 120,150 100,138 80,150 86,126 70,112 92,110', K.gold));
  def('fantasy', 'wand', t => SH(100, 36) +
    G(R(96, 70, 8, 130, '#8a5a36', 4) + PG('100,20 108,44 130,44 114,58 122,80 100,66 78,80 86,58 70,44 92,44', K.gold) + C(100, 50, 6, t.acc), 'rotate(20 100 100)'));
  def('fantasy', 'dragon_egg', t => SH(100, 56) +
    P('M100 20C140 20 164 76 164 122C164 160 134 184 100 184C66 184 36 160 36 122C36 76 60 20 100 20Z', t.a) + S('M60 80C80 90 120 90 140 80M56 116C80 130 120 130 144 116M60 152C80 162 120 162 140 152', t.b, 5, ' opacity=".7"') + C(80, 60, 6, t.light, ' opacity=".5"'));
  def('fantasy', 'wizard_hat', t => SH(100, 66) +
    P('M100 20L40 170H160Z', t.a) + E(100, 170, 76, 12, t.b) + S('M76 110L128 130', K.gold, 6) + PG('100,20 96,44 104,44', K.gold, ' opacity=".8"') + C(140, 70, 6, K.gold) + C(60, 90, 5, K.gold));
  def('fantasy', 'crystal_ball', t => SH(100, 60) +
    C(100, 100, 62, t.b, ' opacity=".8"') + C(80, 80, 18, t.light, ' opacity=".4"') + R(60, 156, 80, 24, t.ink, 8) + E(100, 164, 44, 8, t.dmetal));

  // ---------- ANIMALS (base registry + custom critters) ----------
  const ANI = {}, ANI_LIST = [];
  const FURS = { orange: '#f4a95f', gray: '#9aa3b0', black: '#3a3a44', white: '#f6f6f6', brown: '#a36a3f', cream: '#f0d9b5', golden: '#e6b25a' };
  const lighten = (hex, a) => _ilShade(hex, -a);
  const darken = (hex, a) => _ilShade(hex, a);

  const EARS = {
    cat: (c, i) => PG('56,70 58,24 96,50', c) + PG('144,70 142,24 104,50', c) + PG('63,62 64,36 86,52', i) + PG('137,62 136,36 114,52', i),
    pointy: (c, i) => PG('54,74 54,14 100,46', c) + PG('146,74 146,14 100,46', c) + PG('62,64 62,34 88,50', i) + PG('138,64 138,34 112,50', i),
    round: (c, i) => C(58, 58, 20, c) + C(142, 58, 20, c) + C(58, 58, 11, i) + C(142, 58, 11, i),
    biground: (c, i) => C(50, 60, 28, c) + C(150, 60, 28, c) + C(50, 60, 16, i) + C(150, 60, 16, i),
    long: (c, i) => E(78, 32, 15, 42, c) + E(122, 32, 15, 42, c) + E(78, 34, 7, 30, i) + E(122, 34, 7, 30, i),
    floppy: (c, i) => G(E(0, 0, 18, 36, c), 'translate(52 90) rotate(14)') + G(E(0, 0, 18, 36, c), 'translate(148 90) rotate(-14)'),
    small: (c, i) => PG('58,66 56,36 84,54', c) + PG('142,66 144,36 116,54', c),
    leaf: (c, i) => G(E(0, 0, 12, 26, c) + E(0, 2, 6, 16, i), 'translate(52 62) rotate(-40)') + G(E(0, 0, 12, 26, c) + E(0, 2, 6, 16, i), 'translate(148 62) rotate(40)'),
    none: () => ''
  };

  const SP = {
    cat: { body: '#f4a95f', belly: '#fff1dc', ear: 'cat', earI: '#f7c6c0', nose: '#e7788c', front: c => S('M84 58L86 70M100 54V68M116 58L114 70', darken(c, .25), 4) + S('M64 108L38 102M64 114L38 118M136 108L162 102M136 114L162 118', '#5b4636', 2.5, ' opacity=".6"'), back: c => S('M148 168C176 172 184 140 170 120', c, 12) },
    dog: { body: '#c69566', belly: '#f7e6d0', ear: 'floppy', earC: '#8a5a34', nose: '#2b2f3a', front: c => G(E(0, 0, 15, 17, '#8a5a34', ' opacity=".9"'), 'translate(124 88)'), back: c => S('M148 170C170 172 184 150 176 132', c, 12) },
    bear: { body: '#a06a44', belly: '#e6c79d', ear: 'round', earI: '#e6c79d', nose: '#2b2f3a' },
    panda: { body: '#ffffff', belly: '#ffffff', ear: 'round', earC: '#2b2f3a', earI: '#2b2f3a', nose: '#2b2f3a', eyeP: true, back: c => E(58, 172, 22, 26, '#2b2f3a') + E(142, 172, 22, 26, '#2b2f3a') },
    rabbit: { body: '#f4f1ee', belly: '#ffffff', ear: 'long', earI: '#f7b8c6', nose: '#f08ba0', front: c => R(96, 118, 8, 10, '#fff', 2, ' stroke="#ddd" stroke-width="1"') },
    fox: { body: '#f08a3c', belly: '#ffffff', ear: 'pointy', earI: '#3b2a24', nose: '#2b2f3a', front: c => P('M50 96C60 114 84 124 100 128C116 124 140 114 150 96C136 108 116 112 100 112C84 112 64 108 50 96Z', '#ffffff'), back: c => P('M146 168C186 178 200 140 176 108C166 128 150 138 140 150Z', '#f08a3c') + P('M176 108C190 130 186 160 168 168C182 148 182 126 176 108Z', '#fff') },
    lion: { body: '#e8b45c', belly: '#fbe3b0', ear: 'round', earI: '#b5652b', nose: '#7a3f22', back: c => C(100, 94, 70, '#b5652b') + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => G(C(0, -62, 14, '#b5652b'), `translate(100 94) rotate(${i * 36})`)).join('') },
    tiger: { body: '#f3a04a', belly: '#fff3e0', ear: 'round', earI: '#fff3e0', nose: '#e7788c', front: c => S('M100 48V62M82 52L86 64M118 52L114 64M52 90L64 92M148 90L136 92', '#2b2f3a', 5) },
    mouse: { body: '#b9bec8', belly: '#f0f0f4', ear: 'biground', earI: '#f7c6c0', nose: '#f08ba0', back: c => S('M148 172C186 172 190 132 170 118', '#f7c6c0', 6) },
    pig: { body: '#f9b7c4', belly: '#f48fa6', ear: 'small', earI: '#f48fa6', nose: '#e56b88', snout: true },
    cow: { body: '#ffffff', belly: '#f9c6cf', ear: 'floppy', earC: '#2b2f3a', nose: '#e56b88', front: c => P('M104 52C120 44 140 54 136 72C126 76 108 72 104 52Z', '#2b2f3a') + S('M66 34C60 22 48 24 46 34M134 34C140 22 152 24 154 34', '#f3e6c4', 8), snout: true },
    sheep: { body: '#5b4a42', belly: '#7a655a', ear: 'floppy', earC: '#5b4a42', nose: '#2b2f3a', back: c => [[46, 76], [62, 44], [100, 36], [138, 44], [154, 76], [54, 116], [146, 116]].map(p => C(p[0], p[1], 26, '#f4efe6')).join(''), front: c => [[70, 50], [100, 44], [130, 50], [86, 42], [116, 42]].map(p => C(p[0], p[1], 16, '#f4efe6')).join('') },
    monkey: { body: '#a0673d', belly: '#f3d3b0', ear: 'round', earI: '#f3d3b0', nose: '#5b3a22', front: c => P('M100 74C120 62 140 74 140 96C140 118 122 124 100 122C78 124 60 118 60 96C60 74 80 62 100 74Z', '#f3d3b0'), back: c => S('M148 170C186 172 188 132 168 112', c, 10) },
    koala: { body: '#a9afbb', belly: '#eceef2', ear: 'biground', earI: '#f4f4f7', nose: '#2b2f3a', bigNose: true },
    frog: { body: '#5cc36b', belly: '#d9f5c8', ear: 'none', nose: '#3aa055', frog: true },
    owl: { body: '#a9764a', belly: '#f3dcbc', ear: 'cat', earI: '#7a4e2b', nose: '#f59e0b', owl: true },
    penguin: { body: '#2f3542', belly: '#ffffff', ear: 'none', nose: '#f59e0b', penguin: true },
    chicken: { body: '#ffffff', belly: '#ffffff', ear: 'none', nose: '#f59e0b', front: c => P('M84 50C80 34 92 30 96 40C98 28 112 28 112 42C118 34 124 44 116 52Z', '#e5484d') + P('M96 118C90 134 110 134 104 118Z', '#e5484d'), beak: true },
    duck: { body: '#ffd84d', belly: '#fff0a8', ear: 'none', nose: '#f59e0b', duck: true },
    elephant: { body: '#9ba7b4', belly: '#cbd3dc', ear: 'none', nose: '#7d8896', elephant: true },
    hippo: { body: '#a99cc9', belly: '#d9d1ee', ear: 'round', earI: '#d9d1ee', nose: '#7f72a3', snout: true, hippo: true },
    deer: { body: '#c98b52', belly: '#f6e3c8', ear: 'leaf', earI: '#f6e3c8', nose: '#2b2f3a', back: c => S('M74 52C62 36 64 18 50 8M74 40L60 30M126 52C138 36 136 18 150 8M126 40L140 30', '#8a5a34', 6) + S('M72 44C64 40 60 30 60 26', '#8a5a34', 5), front: c => [[70, 72], [130, 72], [100, 66]].map(p => C(p[0], p[1], 3, '#fff', ' opacity=".7"')).join('') },
    wolf: { body: '#8f99a8', belly: '#e3e7ee', ear: 'pointy', earI: '#4b5563', nose: '#2b2f3a', longMuzzle: true, back: c => P('M146 168C186 178 196 140 180 118C170 134 156 140 142 150Z', '#8f99a8') },
    raccoon: { body: '#9da3ad', belly: '#e6e8ec', ear: 'round', earC: '#9da3ad', earI: '#2b2f3a', nose: '#2b2f3a', front: c => P('M52 84C62 72 82 76 92 90C82 102 62 104 52 84Z', '#2b2f3a') + P('M148 84C138 72 118 76 108 90C118 102 138 104 148 84Z', '#2b2f3a') + C(80, 90, 6, '#fff') + C(120, 90, 6, '#fff'), back: c => [0, 1, 2, 3].map(i => E(168, 150 - i * 12, 14, 8, i % 2 ? '#2b2f3a' : '#9da3ad')).join(''), eyesCustom: true },
    hamster: { body: '#f2c48b', belly: '#fff3df', ear: 'round', earI: '#f7c6c0', nose: '#f08ba0', cheeks: true, front: c => P('M100 46C84 46 76 60 84 74C92 66 108 66 116 74C124 60 116 46 100 46Z', '#e59c5a') },
    dragon: { body: '#5cc36b', belly: '#f3e8a3', ear: 'none', nose: '#3aa055', dragon: true },
    unicorn: { body: '#ffffff', belly: '#f6f0ff', ear: 'small', earC: '#ffffff', earI: '#f7b8c6', nose: '#f08ba0', unicorn: true },
    horse: { body: '#a9713f', belly: '#d9a36b', ear: 'small', earC: '#a9713f', earI: '#5b3a22', nose: '#5b3a22', horse: true },
    giraffe: { body: '#f3c14e', belly: '#fff0c4', ear: 'leaf', earI: '#f6d28a', nose: '#c98b52', giraffe: true }
  };

  function animalHead(name, t, o) {
    const sp = SP[name];
    let fur = o.fur && FURS[o.fur] ? FURS[o.fur] : sp.body;
    const belly = o.fur && FURS[o.fur] ? lighten(fur, .55) : sp.belly;
    const ink = K.ink;
    const earC = sp.earC || fur;
    let out = SH(100, 62);
    if (sp.back) out += sp.back(fur);
    out += E(100, 158, sp.penguin ? 46 : 50, 36, fur);
    if (sp.penguin) out += E(100, 164, 32, 30, '#ffffff') + E(80, 190, 17, 7, '#f59e0b') + E(120, 190, 17, 7, '#f59e0b');
    else {
      out += E(100, 166, 32, 24, belly) + E(74, 190, 19, 8, darken(fur, .12)) + E(126, 190, 19, 8, darken(fur, .12));
      if (name === 'cow') out += C(140, 150, 14, '#2b2f3a') + C(60, 170, 10, '#2b2f3a');
      if (name === 'tiger') out += S('M62 140L72 150M138 140L128 150M58 160L70 164', '#2b2f3a', 5);
      if (name === 'giraffe') out += R(74, 108, 52, 40, fur) + [[84, 116], [110, 126], [96, 138]].map(p => C(p[0], p[1], 6, '#c98b52')).join('');
    }
    if (sp.dragon) out += P('M50 140C24 110 16 92 22 72C40 84 56 96 62 116Z', '#3aa055') + P('M150 140C176 110 184 92 178 72C160 84 144 96 138 116Z', '#3aa055');
    if (sp.unicorn || sp.horse) out += P('M56 50C36 70 34 110 52 136C64 104 70 80 84 60Z', sp.unicorn ? t.e : '#3b2a24') + P('M144 50C164 70 166 110 148 136C136 104 130 80 116 60Z', sp.unicorn ? t.c : '#3b2a24');
    out += EARS[sp.ear](earC, sp.earI || belly);
    if (sp.dragon) out += PG('66,58 60,26 88,46', '#f59e0b') + PG('134,58 140,26 112,46', '#f59e0b') + [0, 1, 2].map(i => PG(`${88 + i * 12},50 ${94 + i * 12},34 ${100 + i * 12},50`, '#3aa055')).join('');
    if (sp.giraffe) out += S('M80 42L78 24M120 42L122 24', '#c98b52', 5) + C(78, 22, 6, '#c98b52') + C(122, 22, 6, '#c98b52');
    if (sp.horse || sp.unicorn) out += E(100, 92, 44, 54, fur) + E(100, 124, 30, 24, belly);
    else if (sp.hippo) out += E(100, 96, 54, 46, fur);
    else out += C(100, 96, 50, fur);
    if (sp.penguin) out += P('M100 60C66 60 56 96 70 118C82 134 118 134 130 118C144 96 134 60 100 60Z', '#ffffff');
    if (sp.owl) out += P('M100 60C72 60 54 76 56 100C58 122 80 128 100 128C120 128 142 122 144 100C146 76 128 60 100 60Z', belly) + C(78, 92, 22, '#fff') + C(122, 92, 22, '#fff') + C(78, 92, 22, 'none', ` stroke="#7a4e2b" stroke-width="3"`) + C(122, 92, 22, 'none', ` stroke="#7a4e2b" stroke-width="3"`);
    if (sp.front) out += sp.front(fur);
    if (sp.cheeks) out += C(66, 110, 20, '#ffe3bd') + C(134, 110, 20, '#ffe3bd');
    if (sp.snout) out += E(100, 116, 30, 20, sp.nose === '#7f72a3' ? '#c3b8e0' : '#f48fa6') + E(90, 116, 4, 6, darken(sp.nose, .2)) + E(110, 116, 4, 6, darken(sp.nose, .2));
    else if (sp.elephant) out += P('M86 106C86 130 84 156 96 164C104 170 112 162 108 154C104 148 110 130 114 106Z', fur) + E(60, 104, 32, 42, fur, '') + E(140, 104, 32, 42, fur, '') + E(60, 104, 20, 30, '#f2c6c6', ' opacity=".7"') + E(140, 104, 20, 30, '#f2c6c6', ' opacity=".7"') + C(100, 96, 50, fur) + P('M86 100C86 128 84 156 96 166C104 172 116 164 112 154C108 146 114 128 114 100Z', fur) + S('M90 122H110M91 136H109', darken(fur, .2), 3);
    else if (sp.duck) out += P('M64 112C64 100 136 100 136 112C136 128 120 134 100 134C80 134 64 128 64 112Z', '#f59e0b');
    else if (sp.beak) out += PG('86,104 114,104 100,124', '#f59e0b');
    else if (sp.penguin) out += PG('88,104 112,104 100,122', '#f59e0b');
    else if (sp.owl) out += PG('92,104 108,104 100,124', '#f59e0b');
    else if (sp.frog) out += C(70, 60, 22, fur) + C(130, 60, 22, fur) + C(70, 60, 14, '#fff') + C(130, 60, 14, '#fff') + C(70, 62, 7, ink) + C(130, 62, 7, ink);
    else if (sp.dragon) out += E(100, 116, 32, 22, '#8fe0a0') + C(90, 112, 3, '#2b7a44') + C(110, 112, 3, '#2b7a44');
    else if (sp.longMuzzle) out += P('M76 92C76 84 124 84 124 92L118 128C112 138 88 138 82 128Z', belly);
    else if (sp.horse || sp.unicorn) out += E(100, 124, 26, 22, belly) + C(90, 126, 3.5, darken(sp.nose, .2)) + C(110, 126, 3.5, darken(sp.nose, .2));
    else if (sp.giraffe) out += E(100, 122, 28, 20, '#f6d28a') + C(90, 122, 3.5, '#a5672a') + C(110, 122, 3.5, '#a5672a');
    else out += E(100, 114, 28, 22, belly);
    if (!sp.frog && !sp.owl && !sp.eyesCustom) {
      if (sp.eyeP) out += G(E(0, 0, 10, 13, ink), 'translate(76 92) rotate(20)') + G(E(0, 0, 10, 13, ink), 'translate(124 92) rotate(-20)');
      const ey = sp.horse || sp.unicorn ? 84 : 92, ex = sp.horse || sp.unicorn ? 20 : 22;
      out += C(100 - ex, ey, 6.2, ink) + C(100 + ex, ey, 6.2, ink) + C(98 - ex, ey - 2.4, 2.2, '#fff') + C(98 + ex, ey - 2.4, 2.2, '#fff');
    } else if (sp.frog) { /* eyes above */ }
    else if (sp.owl) out += C(78, 92, 8, ink) + C(122, 92, 8, ink) + C(76, 89, 2.6, '#fff') + C(120, 89, 2.6, '#fff');
    else if (sp.eyesCustom) out += C(80, 90, 3, ink) + C(120, 90, 3, ink);
    if (sp.bigNose) out += E(100, 108, 14, 10, sp.nose);
    else if (!sp.snout && !sp.beak && !sp.duck && !sp.penguin && !sp.owl && !sp.elephant && !sp.horse && !sp.unicorn && !sp.giraffe && !sp.dragon) out += E(100, 106, 7.5, 5.4, sp.nose);
    if (!sp.beak && !sp.duck && !sp.penguin && !sp.owl && !sp.elephant && !sp.bigNose) out += S('M100 112V118M92 121C96 126 100 121 100 118C100 121 104 126 108 121', ink, 2.6);
    if (sp.frog) out += S('M76 112C90 126 110 126 124 112', ink, 3);
    if (sp.unicorn) out += PG('92,44 108,44 100,4', K.gold) + S('M94 34L106 30M96 22L104 20', '#eab308', 2.5);
    if (sp.horse) out += P('M84 36C90 26 110 26 116 36C110 40 90 40 84 36Z', '#3b2a24');
    if (!sp.frog) out += E(64, 108, 8, 5, '#f472b6', ' opacity=".35"') + E(136, 108, 8, 5, '#f472b6', ' opacity=".35"');
    return out;
  }

  Object.keys(SP).forEach(n => { ANI[n] = (t, o) => animalHead(n, t, o || {}); ANI_LIST.push(n); });

  const AC = (n, fn) => { ANI[n] = fn; ANI_LIST.push(n); };

  // ----- base custom critters -----
  AC('goldfish', t => SH(100, 50) + P('M22 100C40 56 108 44 138 86L182 54L172 100L182 146L138 114C108 156 40 144 22 100Z', K.orange) + P('M22 100C40 56 108 44 138 86C120 76 60 80 40 100Z', '#fdba74', ' opacity=".7"') + C(58, 92, 8, '#fff') + C(56, 92, 4, K.ink) + S('M84 62C92 80 92 118 84 138M108 66C114 84 114 116 108 134', '#ea580c', 3, ' opacity=".6"') + [[30, 40, 7], [50, 28, 5], [22, 62, 4]].map(b => C(b[0], b[1], b[2], 'none', ` stroke="${t.c}" stroke-width="2.5"`)).join(''));
  AC('whale', t => SH(100, 60) + P('M14 110C14 66 60 44 108 52C150 58 172 90 170 116C178 100 188 86 188 70C200 78 200 104 182 130C168 154 130 168 90 164C46 160 14 142 14 110Z', t.b) + P('M30 124C58 150 130 160 168 126C150 164 90 176 50 156C38 148 30 138 30 124Z', t.d) + C(52, 96, 6, K.ink) + S('M64 112C70 118 78 118 84 114', K.ink, 3) + S('M96 46C96 30 84 24 76 26M96 46C96 30 108 24 116 26', t.c, 5));
  AC('dolphin', t => SH(100, 50) + P('M14 130C40 60 110 34 156 54C168 36 178 30 190 32C186 46 182 56 172 66C178 120 120 176 44 156C30 152 20 146 14 130Z', t.b) + P('M20 132C50 156 120 160 166 100C160 140 110 178 44 158C32 154 24 146 20 132Z', t.d) + P('M84 96L116 132L92 138Z', t.a) + C(56, 96, 5, K.ink) + P('M14 130L2 124L8 142Z', t.b));
  AC('octopus', t => SH(100, 60) + P('M36 98C36 50 68 26 100 26C132 26 164 50 164 98C164 120 150 128 100 128C50 128 36 120 36 98Z', t.a) + [[46, 130, 28], [76, 138, 40], [104, 140, 40], [134, 138, 40], [156, 130, 28]].map(p => S(`M${p[0]} 120C${p[0] - 12} ${p[1] + 20} ${p[0] + 16} ${p[1] + 30} ${p[0] + 2} ${p[1] + p[2] + 10}`, t.a, 13)).join('') + C(80, 90, 12, '#fff') + C(120, 90, 12, '#fff') + C(82, 92, 6, K.ink) + C(122, 92, 6, K.ink) + S('M90 110C96 116 106 116 112 110', K.ink, 3));
  AC('turtle', t => SH(100, 60) + P('M150 130C168 128 186 116 184 100C176 100 164 108 150 112Z', '#86c96a') + E(46, 150, 14, 12, '#86c96a') + E(72, 168, 14, 12, '#86c96a') + E(134, 168, 14, 12, '#86c96a') + E(160, 150, 14, 12, '#86c96a') + C(178, 98, 18, '#86c96a') + C(184, 94, 3.5, K.ink) + P('M28 140C28 78 66 50 100 50C134 50 172 78 172 140Z', t.a) + P('M28 140H172V150C172 160 160 164 148 164H52C40 164 28 160 28 150Z', '#e9d8a6') + PG('100,66 128,84 118,116 82,116 72,84', t.b) + S('M100 66V50M128 84L160 76M118 116L146 138M82 116L54 138M72 84L40 76', t.b, 5));
  AC('butterfly_o', t => SH(100, 30) + P('M100 100C80 40 22 34 26 84C28 108 66 112 100 104Z', t.a) + P('M100 100C120 40 178 34 174 84C172 108 134 112 100 104Z', t.a) + P('M100 108C74 108 40 126 50 158C64 180 96 150 100 108Z', t.c) + P('M100 108C126 108 160 126 150 158C136 180 104 150 100 108Z', t.c) + C(56, 76, 10, t.light, ' opacity=".7"') + C(144, 76, 10, t.light, ' opacity=".7"') + C(68, 148, 6, t.light, ' opacity=".7"') + C(132, 148, 6, t.light, ' opacity=".7"') + R(94, 62, 12, 96, K.ink, 6) + C(100, 58, 10, K.ink) + S('M96 50C92 36 84 30 78 28M104 50C108 36 116 30 122 28', K.ink, 3));
  AC('bee', t => SH(100, 40) + E(64, 74, 30, 20, t.light, ' opacity=".8"') + E(112, 66, 30, 20, t.light, ' opacity=".8"') + E(100, 106, 56, 44, K.yellow) + P('M74 68C86 72 88 140 76 146C60 130 60 84 74 68Z', K.ink) + P('M108 64C120 68 122 148 110 152C98 148 96 68 108 64Z', K.ink) + P('M150 90L172 106L150 122Z', K.ink) + C(56, 100, 14, K.ink) + C(52, 96, 3, '#fff') + S('M46 84C42 72 36 68 30 68M56 82C58 70 54 62 50 58', K.ink, 3));
  AC('ladybug', t => SH(100, 50) + C(100, 60, 28, K.ink) + C(88, 54, 5, '#fff') + C(112, 54, 5, '#fff') + P('M100 76C56 76 34 108 42 142C52 172 148 172 158 142C166 108 144 76 100 76Z', K.red) + S('M100 78V166', K.ink, 4) + [[74, 108], [126, 108], [66, 138], [134, 138], [88, 152], [112, 152]].map(p => C(p[0], p[1], 8, K.ink)).join('') + S('M88 34L78 20M112 34L122 20', K.ink, 3));
  AC('snail', t => SH(100, 60) + P('M20 160C20 140 40 138 60 138H150C170 138 170 158 150 162H30C24 162 20 162 20 160Z', '#f3c98b') + S('M34 140C32 120 30 106 26 92M44 138C46 120 48 106 54 94', '#f3c98b', 6) + C(26, 90, 6, K.ink) + C(54, 92, 6, K.ink) + C(112, 100, 52, t.a) + C(112, 100, 38, t.b) + C(112, 100, 24, t.a) + C(112, 100, 10, t.b));
  AC('crab', t => SH(100, 60) + [[50, 150], [66, 164], [134, 164], [150, 150]].map(p => S(`M${p[0] < 100 ? 76 : 124} 134L${p[0]} ${p[1]}`, K.red, 7)).join('') + S('M62 96C36 88 26 64 40 48M138 96C164 88 174 64 160 48', K.red, 9) + P('M28 42C20 30 34 20 46 28C40 34 44 44 50 46C44 54 32 52 28 42Z', K.red) + P('M172 42C180 30 166 20 154 28C160 34 156 44 150 46C156 54 168 52 172 42Z', K.red) + E(100, 118, 62, 40, K.red) + S('M82 82V68M118 82V68', K.red, 5) + C(82, 64, 9, '#fff') + C(118, 64, 9, '#fff') + C(83, 65, 4.5, K.ink) + C(119, 65, 4.5, K.ink) + S('M88 122C94 130 106 130 112 122', K.ink, 3));
  AC('seahorse', t => SH(100, 30) + P('M104 20C132 20 142 46 128 64C118 76 130 92 126 112C122 138 104 150 100 168C94 184 72 176 78 158C82 146 98 142 96 126C94 108 78 100 80 76C82 54 88 20 104 20Z', t.acc) + S('M62 34C54 30 44 34 40 42', t.acc, 6) + P('M134 60C152 62 156 82 144 90Z', t.c) + C(112, 42, 5, K.ink) + [[100, 82], [98, 102], [94, 122]].map(p => S(`M${p[0] + 10} ${p[1]}H${p[0] + 24}`, t.a, 4)).join(''));
  AC('bird_blue', t => SH(100, 50) + P('M24 120C24 70 62 44 104 50C142 56 160 84 156 118C152 148 120 166 84 160C50 156 24 146 24 120Z', t.b) + P('M60 128C72 150 116 156 150 124C144 150 116 166 84 160C68 158 60 144 60 128Z', t.light) + P('M100 92C118 76 146 84 152 104C136 108 114 106 100 92Z', t.a) + PG('150,84 186,96 150,106', K.orange) + C(128, 76, 6.5, K.ink) + C(126, 74, 2, '#fff') + PG('24,110 6,96 10,126', t.a) + S('M92 160V174M112 160V174', K.orange, 4));
  AC('flamingo', t => SH(100, 40) + S('M96 172V132M116 172V140', '#f472b6', 6) + P('M60 92C60 60 96 56 122 74C140 86 148 104 140 122C132 142 90 148 68 130C62 122 60 108 60 92Z', '#f9a8d4') + S('M120 78C126 54 108 34 92 40C80 44 84 62 96 60', '#f9a8d4', 10) + P('M84 40C90 30 106 30 108 44C100 52 88 50 84 40Z', '#f9a8d4') + PG('84,40 70,50 88,52', K.ink) + C(96, 40, 3.5, K.ink) + P('M86 100C100 88 124 96 130 112C114 118 94 116 86 100Z', '#f472b6'));
  AC('parrot', t => SH(100, 40) + P('M76 40C76 22 126 22 128 48C130 70 126 90 120 106C128 130 112 176 90 182L84 130C68 110 60 66 76 40Z', K.red) + P('M120 106C132 130 118 176 96 186L90 130Z', K.blue) + P('M74 70C60 86 64 118 82 130C72 108 74 90 80 78Z', K.yellow) + C(96, 48, 10, '#fff') + C(98, 48, 5, K.ink) + P('M82 38C68 34 56 46 66 60C74 52 82 50 88 54Z', '#fde68a') + S('M84 178L76 190M96 180L100 192', K.dgray, 4));
  AC('bat', t => SH(100, 30) + P('M100 74C82 60 70 40 44 44C22 48 12 62 6 90C24 86 32 98 36 112C44 104 54 104 62 112C70 104 84 106 92 122C94 110 96 96 100 74Z', t.a) + P('M100 74C118 60 130 40 156 44C178 48 188 62 194 90C176 86 168 98 164 112C156 104 146 104 138 112C130 104 116 106 108 122C106 110 104 96 100 74Z', t.a) + E(100, 96, 20, 30, t.ink) + C(100, 66, 20, t.ink) + PG('86,54 82,30 98,48', t.ink) + PG('114,54 118,30 102,48', t.ink) + C(92, 66, 4.5, K.yellow) + C(108, 66, 4.5, K.yellow) + PG('96,78 100,88 104,78', '#fff'));
  AC('squirrel', t => SH(100, 40) + P('M132 96C168 76 190 96 186 138C182 172 148 188 122 168C140 148 148 118 132 96Z', '#c07a3f') + P('M136 100C160 86 178 102 174 132C170 158 146 168 128 154Z', '#e0a468', ' opacity=".8"') + P('M24 132C24 90 56 66 92 66C128 66 154 92 154 130C154 156 132 172 100 172C68 172 24 164 24 132Z', '#c07a3f') + E(100, 142, 34, 30, '#f3d9b1') + PG('54,80 46,44 76,64', '#c07a3f') + PG('146,80 154,44 124,64', '#c07a3f') + C(78, 108, 6.5, K.ink) + C(112, 108, 6.5, K.ink) + C(76, 105, 2.2, '#fff') + C(110, 105, 2.2, '#fff') + E(100, 122, 7, 5, '#a9713f') + C(66, 128, 6, '#f472b6', ' opacity=".3"') + C(134, 128, 6, '#f472b6', ' opacity=".3"'));
  AC('hedgehog', t => SH(100, 40) + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => G(PG('0,0 -8,-26 8,-26', '#7a5a44'), `translate(${58 + i * 8.4} 108) rotate(${(i - 5) * 9})`)).join('') + P('M40 130C40 96 66 78 100 78C134 78 160 96 160 130C160 158 132 172 100 172C68 172 40 158 40 130Z', '#a9714b') + E(100, 148, 46, 30, '#f0d9b5') + PG('44,120 20,110 30,138', '#a9714b') + C(70, 118, 6, K.ink) + C(130, 118, 6, K.ink) + C(68, 115, 2, '#fff') + C(128, 115, 2, '#fff') + E(100, 138, 8, 6, K.ink) + C(60, 142, 5, '#f472b6', ' opacity=".3"') + C(140, 142, 5, '#f472b6', ' opacity=".3"'));
  AC('peacock', t => SH(100, 30) + [-100, -72, -44, -16, 12].map((a, i) => G(E(0, -70, 19, 44, i % 2 ? t.a : t.c) + C(0, -110, 8, i % 2 ? t.acc : t.e) + C(0, -110, 3.5, t.light), `translate(76 152) rotate(${a})`)).join('') + E(100, 158, 26, 34, t.b) + S('M108 146C116 128 120 110 130 94', t.b, 16) + C(134, 86, 15, t.b) + PG('134,70 130,54 140,62', t.b) + C(139, 84, 3.5, K.ink) + PG('118,178 126,190 110,190', '#f59e0b') + S('M92 190V176M108 190V176', K.ink, 4));
  AC('shark', t => SH(100, 30) + P('M14 108C40 78 80 66 130 70C168 74 190 90 196 108C190 96 166 92 140 96C154 106 160 118 158 132C142 122 128 116 112 116C126 128 130 142 122 156C108 144 98 128 86 122C70 130 46 128 30 118C42 112 52 104 56 94C40 92 24 100 14 108Z', t.c) + P('M170 74L192 50L188 82Z', t.c) + PG('68,116 76,132 60,132', '#fff') + PG('88,120 96,136 80,136', '#fff') + PG('108,120 116,136 100,136', '#fff') + C(150, 90, 4.5, K.ink) + S('M150 100C158 104 164 104 170 100', K.ink, 2.5));
  AC('jellyfish', t => SH(100, 20) + P('M40 96C40 60 66 36 100 36C134 36 160 60 160 96C160 108 150 116 140 110C130 122 112 122 100 108C88 122 70 122 60 110C50 116 40 108 40 96Z', t.acc, ' opacity=".85"') + S('M60 110C56 130 64 148 58 168M84 116C80 138 88 156 82 178M100 108C100 132 108 152 102 176M116 116C120 138 112 156 118 178M140 110C144 130 136 148 142 168', t.acc, 5, ' opacity=".55"') + C(78, 78, 6, '#fff', ' opacity=".7"') + C(122, 78, 6, '#fff', ' opacity=".7"') + C(80, 70, 22, t.light, ' opacity=".25"'));
  AC('chameleon', t => SH(100, 40) + S('M150 130C170 150 178 168 172 178', '#5cc36b', 10) + P('M36 130C36 96 66 76 106 78C144 80 168 100 172 122C158 116 140 118 130 128C120 116 100 112 84 118C76 126 62 130 50 128C42 130 40 130 36 130Z', '#5cc36b') + PG('92,74 84,54 104,66', '#3aa055') + C(66, 100, 15, '#fff') + C(66, 100, 15, 'none', ' stroke="#3aa055" stroke-width="3"') + C(63, 97, 6, K.ink) + P('M96 96C112 92 112 108 96 106Z', '#e5484d') + [[54, 84], [74, 86], [50, 108]].map(p => C(p[0], p[1], 3, '#3aa055')).join(''));

  // ----- v3 new animals -----
  AC('zebra', t => SH(100, 50) +
    E(100, 158, 50, 36, '#ffffff') + P('M64 128L76 148M84 124L92 148M104 124L112 148M124 128L132 148', t.ink, 5) +
    E(100, 166, 32, 24, '#ffffff') + C(58, 60, 20, '#ffffff') + C(142, 60, 20, '#ffffff') + PG('54,74 54,14 100,46', '#ffffff') + PG('146,74 146,14 100,46', '#ffffff') +
    PG('62,64 62,34 88,50', '#2b2f3a') + PG('138,64 138,34 112,50', '#2b2f3a') + C(100, 96, 50, '#ffffff') +
    P('M60 76L76 100L90 76L106 100L120 76L134 100', t.ink, 5) + C(78, 92, 6, t.ink) + C(122, 92, 6, t.ink) + C(76, 89, 2, '#fff') + C(120, 89, 2, '#fff') +
    E(100, 114, 28, 22, '#f3d9b1') + E(100, 106, 7, 5, '#2b2f3a') + S('M100 112V118M92 121C96 126 100 121 100 118C100 121 104 126 108 121', t.ink, 2.6));
  AC('camel', t => SH(100, 40) +
    P('M40 170C40 130 60 110 80 110C86 90 94 90 100 110C106 90 114 90 120 110C140 110 160 130 160 170Z', '#d9a86b') + E(60, 186, 12, 8, '#c58b55') + E(140, 186, 12, 8, '#c58b55') +
    C(100, 70, 30, '#d9a86b') + PG('76,50 72,14 100,40', '#d9a86b') + PG('124,50 128,14 100,40', '#d9a86b') + E(100, 92, 22, 18, '#f3d9b1') + C(90, 68, 6, t.ink) + C(110, 68, 6, t.ink) + E(100, 88, 5, 4, t.ink));
  AC('sloth', t => SH(100, 50) +
    P('M48 168C48 128 68 106 100 106C132 106 152 128 152 168Z', '#8a6a4a') + C(100, 76, 44, '#a07a54') + E(90, 66, 8, 12, '#3a2a1a') + E(110, 66, 8, 12, '#3a2a1a') +
    C(88, 64, 4, '#f3d9b1') + C(108, 64, 4, '#f3d9b1') + E(100, 88, 12, 8, '#3a2a1a') + S('M100 96C96 102 100 108 100 108', t.ink, 3) +
    S('M48 130L26 100L14 106', '#8a6a4a', 8) + S('M152 130L174 100L186 106', '#8a6a4a', 8) + C(70, 108, 8, '#fff', ' opacity=".4"'));
  AC('otter', t => SH(100, 40) +
    E(100, 140, 60, 46, '#8a6a4a') + E(100, 150, 42, 32, '#d9b58a') + C(100, 88, 38, '#8a6a4a') + C(80, 72, 14, '#8a6a4a') + C(120, 72, 14, '#8a6a4a') + C(80, 72, 8, '#e8b48a') + C(120, 72, 8, '#e8b48a') +
    C(88, 84, 6, t.ink) + C(112, 84, 6, t.ink) + C(86, 81, 2, '#fff') + C(110, 81, 2, '#fff') + E(100, 96, 8, 6, t.ink) + S('M100 102V108M92 112C96 117 104 117 108 112', t.ink, 2.6) + S('M160 130C186 130 190 100 174 88', '#8a6a4a', 10));
  AC('walrus', t => SH(100, 46) +
    E(100, 156, 56, 40, '#8a5a3a') + E(100, 168, 40, 28, '#a9764a') + C(100, 90, 46, '#8a5a3a') +
    E(80, 92, 22, 20, '#a9764a') + E(120, 92, 22, 20, '#a9764a') + C(82, 84, 6, t.ink) + C(118, 84, 6, t.ink) + C(80, 81, 2, '#fff') + C(116, 81, 2, '#fff') +
    PG('88,110 82,168 94,168', '#f3f0e8') + PG('112,110 118,168 106,168', '#f3f0e8') + E(100, 108, 8, 5, t.ink) + C(60, 100, 10, '#f472b6', ' opacity=".3"') + C(140, 100, 10, '#f472b6', ' opacity=".3"'));
  AC('kangaroo', t => SH(100, 34) +
    P('M110 176C86 176 70 150 70 120C70 96 84 76 106 60C112 46 122 40 132 40C142 40 152 48 156 62C160 78 156 96 144 108C138 116 130 122 124 126C130 146 132 164 122 174C118 178 114 178 110 176Z', '#c58b55') +
    E(86, 92, 22, 40, '#d9a86b') + C(140, 58, 32, '#c58b55') + PG('124,34 120,4 144,26', '#c58b55') + PG('156,34 160,4 136,26', '#c58b55') +
    E(150, 76, 20, 14, '#e8c68a') + C(128, 54, 5, t.ink) + C(148, 54, 5, t.ink) + C(126, 51, 1.8, '#fff') + C(146, 51, 1.8, '#fff') + E(150, 72, 4, 3, t.ink) +
    S('M60 160V184M96 176V190M128 168V184', '#8a5a36', 6));
  AC('axolotl', t => SH(100, 40) +
    S('M44 90L20 76L14 84', '#f9a8d4', 6) + S('M44 110L18 116L20 128', '#f9a8d4', 6) + S('M156 90L180 76L186 84', '#f9a8d4', 6) + S('M156 110L182 116L180 128', '#f9a8d4', 6) +
    C(100, 110, 46, '#f9a8d4') + E(100, 130, 40, 26, '#fbc4dc') + C(78, 98, 8, t.ink) + C(122, 98, 8, t.ink) + C(76, 95, 3, '#fff') + C(120, 95, 3, '#fff') +
    S('M90 124C94 130 106 130 110 124', t.ink, 3) + C(60, 130, 6, '#f472b6', ' opacity=".4"') + C(140, 130, 6, '#f472b6', ' opacity=".4"') + C(80, 76, 6, '#fbc4dc', ' opacity=".7"') + C(120, 76, 6, '#fbc4dc', ' opacity=".7"'));
  AC('narwhal', t => SH(100, 50) +
    P('M14 130C14 90 60 66 108 74C150 80 172 110 170 136C178 122 188 108 188 92C200 100 200 126 182 152C168 174 130 188 90 184C46 180 14 162 14 130Z', t.b) +
    P('M30 142C58 168 130 178 168 144C150 184 90 196 50 176C38 168 30 158 30 142Z', t.d) +
    P('M140 70L156 8L168 16L156 74Z', '#f0d9b5') + C(52, 116, 6, t.ink) + S('M64 130C70 136 78 136 84 132', t.ink, 3));
  AC('starfish', t => SH(100, 46) +
    [0, 72, 144, 216, 288].map(a => G(P('M0 0C-16 -40 -16 -80 0 -100C16 -80 16 -40 0 0Z', '#fbbf24'), `translate(100 100) rotate(${a})`)).join('') +
    C(100, 100, 36, '#f59e0b') + C(100, 100, 26, '#fbbf24') +
    [0, 1, 2, 3, 4, 5, 6, 7].map(i => C(100 + Math.cos(i * Math.PI / 4) * 14, 100 + Math.sin(i * Math.PI / 4) * 14, 3, '#d97706')).join('') + C(100, 92, 4, '#d97706'));
  AC('lobster', t => SH(100, 50) +
    S('M48 60L20 30L14 44', K.red, 6) + S('M48 84L20 92L26 106', K.red, 6) + S('M152 60L180 30L186 44', K.red, 6) + S('M152 84L180 92L174 106', K.red, 6) +
    E(100, 118, 34, 62, K.red) + E(100, 108, 24, 42, '#ef4444') + S('M92 90V150M108 90V150', '#b91c1c', 3) +
    S('M100 60V30', '#b91c1c', 8) + C(100, 26, 14, K.red) + C(90, 22, 4, '#2b2f3a') + C(110, 22, 4, '#2b2f3a') + S('M92 36L80 44M108 36L120 44', '#b91c1c', 4));
  AC('toucan', t => SH(100, 42) +
    E(100, 110, 62, 52, '#2b2f3a') + E(100, 130, 42, 34, '#ffffff') + C(100, 76, 44, '#2b2f3a') +
    E(80, 72, 14, 14, '#ffffff') + C(78, 74, 8, t.ink) + C(76, 72, 3, '#fff') +
    P('M130 68C180 60 200 78 200 96C200 110 184 118 148 110Z', K.orange) + P('M148 110C170 110 184 106 190 96C186 106 176 112 160 112Z', '#2b2f3a') +
    S('M78 158V180M122 158V180', K.orange, 6) + P('M96 158L100 170L104 158Z', K.blue));
  AC('polar_bear', t => SH(100, 40) +
    E(100, 158, 56, 40, '#ffffff') + E(100, 168, 40, 28, '#f0f0f0') + C(100, 96, 48, '#ffffff') +
    C(58, 58, 18, '#ffffff') + C(142, 58, 18, '#ffffff') + C(58, 58, 10, '#c9d8ea') + C(142, 58, 10, '#c9d8ea') +
    E(100, 116, 32, 22, '#f0f0f0') + C(80, 92, 6, t.ink) + C(120, 92, 6, t.ink) + C(78, 89, 2, '#fff') + C(118, 89, 2, '#fff') + E(100, 108, 9, 6, t.ink) + S('M100 116V122M90 124C94 129 100 124 100 122C100 124 106 129 110 124', t.ink, 2.6));

  // ---------- PLANTS ----------
  const PLA = {}, PLA_LIST = [];
  const PL = (n, fn) => { PLA[n] = fn; PLA_LIST.push(n); };
  const SEASONS = { summer: ['#2f9e5b', '#3fb56b', '#5ccf85'], spring: ['#7dd69a', '#a5e6b5', '#f9b8d0'], autumn: ['#d9822b', '#e8a23a', '#c8552b'], winter: ['#e6eef7', '#ffffff', '#c9d8ea'] };
  const seasonOf = o => SEASONS[o.season] || SEASONS.summer;
  const trunk = (x, w, top, bot, c) => P(`M${x - w} ${bot}C${x - w} ${bot - 30} ${x - w * 0.6} ${top + 30} ${x - w * 0.5} ${top}H${x + w * 0.5}C${x + w * 0.6} ${top + 30} ${x + w} ${bot - 30} ${x + w} ${bot}Z`, c);
  PL('oak_tree', (t, o) => { const g = seasonOf(o); return SH(100, 60) + trunk(100, 14, 96, 178, K.brown) + S('M100 130L74 104M100 120L128 98', K.brown, 8) + C(64, 88, 34, g[0]) + C(136, 88, 34, g[0]) + C(100, 58, 42, g[1]) + C(72, 62, 28, g[2]) + C(128, 66, 26, g[2]) + C(100, 100, 34, g[1]); });
  PL('pine_tree', (t, o) => { const w = o.season === 'winter'; return SH(100, 44) + R(92, 148, 16, 30, K.dbrown, 3) + PG('100,110 156,158 44,158', '#1f7a4d') + PG('100,64 148,120 52,120', '#2a9160') + PG('100,18 140,78 60,78', '#3aab73') + (w ? PG('100,18 116,40 84,40', '#fff') + PG('100,64 120,86 80,86', '#fff') + PG('100,110 126,132 74,132', '#fff') : ''); });
  PL('palm_tree', t => SH(100, 50) + P('M92 178C90 140 96 100 114 62L126 66C112 104 108 140 112 178Z', '#b98552') + [-70, -35, 0, 35, 70].map((a, i) => G(P('M0 0C24 -30 66 -24 86 8C60 -6 30 -2 0 8Z', i % 2 ? '#2f9e5b' : '#22854a'), `translate(120 66) rotate(${a - 12})`)).join('') + G(P('M0 0C24 -30 66 -24 86 8C60 -6 30 -2 0 8Z', '#3fb56b'), 'translate(120 66) rotate(-165) scale(1 -1)') + C(112, 74, 8, '#8a5a36') + C(128, 76, 8, '#8a5a36'));
  PL('cherry_tree', t => SH(100, 56) + trunk(100, 13, 100, 178, '#6b4a3a') + S('M100 130L70 100M100 120L134 96', '#6b4a3a', 8) + [[56, 88, 32], [144, 88, 32], [100, 54, 40], [72, 66, 28], [130, 64, 28], [100, 98, 32]].map((p, i) => C(p[0], p[1], p[2], i % 2 ? '#f9a8d4' : '#fbc4dc')).join('') + [[70, 60], [120, 50], [140, 90], [60, 100], [100, 80]].map(p => C(p[0], p[1], 4, '#fff', ' opacity=".8"')).join('') + [[80, 176], [126, 180], [104, 172]].map(p => C(p[0], p[1], 3, '#f9a8d4')).join(''));
  PL('birch_tree', (t, o) => { const g = seasonOf(o); return SH(100, 46) + R(90, 60, 20, 118, '#f3f0e8', 4) + [[76, 76], [110, 96], [82, 122], [108, 146], [90, 164]].map(p => R(p[0], p[1], 14, 5, '#3d3d3d', 2)).join('') + C(100, 44, 34, g[1]) + C(72, 64, 26, g[0]) + C(130, 62, 26, g[0]) + C(100, 76, 24, g[2]); });
  PL('autumn_tree', t => PLA.oak_tree(t, { season: 'autumn' }) + [[60, 178], [138, 182], [96, 184]].map(p => E(p[0], p[1], 8, 4, '#e8a23a')).join(''));
  PL('apple_tree', (t, o) => PLA.oak_tree(t, o) + [[70, 84], [130, 78], [100, 62], [104, 106], [64, 108]].map(p => C(p[0], p[1], 7, K.red) + C(p[0] - 2, p[1] - 2, 2, '#fff', ' opacity=".6"')).join(''));
  PL('lollipop_tree', t => SH(100, 40) + R(94, 90, 12, 88, K.brown, 5) + C(100, 66, 50, t.a) + C(84, 50, 14, t.light, ' opacity=".25"') + C(120, 78, 10, t.light, ' opacity=".2"'));
  PL('bush', t => SH(100, 60) + C(52, 138, 34, '#2f9e5b') + C(148, 138, 34, '#2f9e5b') + C(100, 116, 46, '#3fb56b') + C(72, 132, 32, '#5ccf85') + C(130, 132, 30, '#5ccf85') + R(30, 150, 140, 26, '#3fb56b', 8) + [[80, 110], [120, 130], [64, 150]].map(p => C(p[0], p[1], 5, t.acc)).join(''));
  PL('cactus', t => SH(100, 46) + R(82, 50, 36, 128, '#3f9e5b', 18) + P('M82 112H60C48 112 46 96 46 84C46 72 66 72 66 84V98H82Z', '#3f9e5b') + P('M118 96H140C152 96 154 80 154 68C154 56 134 56 134 68V82H118Z', '#3f9e5b') + S('M100 60V166M92 70V160M108 70V160', '#2f7d47', 3, ' opacity=".6"') + PG('100,38 92,52 108,52', t.acc) + C(100, 48, 9, t.c) + R(66, 158, 68, 22, t.a, 6));
  PL('succulent', t => SH(100, 50) + R(58, 128, 84, 50, t.a, 10) + R(52, 122, 96, 14, t.b, 7) + [-60, -30, 0, 30, 60].map((a, i) => G(P('M0 0C-16 -26 -12 -58 0 -66C12 -58 16 -26 0 0Z', i % 2 ? '#5ccf85' : '#3fb56b'), `translate(100 124) rotate(${a})`)).join('') + [-30, 30].map(a => G(P('M0 0C-12 -20 -8 -44 0 -50C8 -44 12 -20 0 0Z', '#86e2a5'), `translate(100 124) rotate(${a * 0.6})`)).join(''));
  PL('potted_plant', t => SH(100, 50) + P('M62 128H138L128 178H72Z', t.a) + R(56, 120, 88, 16, t.b, 6) + [[-50, 90, 0], [-20, 106, 0], [20, 106, 0], [50, 90, 0]].map((p, i) => S(`M100 122C${100 + p[0] * 0.4} ${p[1]} ${100 + p[0]} ${p[1] - 16} ${100 + p[0] * 1.1} ${p[1] - 32}`, '#2f9e5b', 4) + G(P('M0 0C14 -18 34 -18 46 0C34 18 14 18 0 0Z', i % 2 ? '#3fb56b' : '#5ccf85'), `translate(${100 + p[0] * 1.1} ${p[1] - 32}) rotate(${p[0] > 0 ? -35 : 215})`)).join('') + G(P('M0 0C14 -18 34 -18 46 0C34 18 14 18 0 0Z', '#5ccf85'), 'translate(100 122) rotate(-90)'));
  PL('monstera', t => SH(100, 50) + P('M64 132H136L128 178H72Z', t.a) + R(58, 124, 84, 14, t.b, 6) + S('M100 128C96 104 84 80 70 66M100 128C104 100 120 76 136 64M100 128V66', '#2f7d47', 4) + [[70, 62, -20], [136, 60, 20], [100, 60, 0]].map(p => G(P('M0 0C-34 -8 -44 -40 -20 -58C-8 -70 10 -70 22 -58C46 -40 34 -8 0 0Z', '#2f9e5b') + S('M0 0V-52M0 -20L-18 -32M0 -20L18 -32M0 -38L-12 -48M0 -38L12 -48', '#22854a', 3), `translate(${p[0]} ${p[1] + 20}) rotate(${p[2]})`)).join(''));
  PL('bamboo', t => SH(100, 50) + [[64, 178, 18], [100, 178, 26], [136, 178, 14]].map((p, i) => R(p[0] - 8, 20 + p[2], 16, 158 - p[2], '#7bc77e', 5) + [50, 80, 110, 140].map(y => R(p[0] - 10, y + p[2] * 0.4, 20, 5, '#3f9e5b', 2)).join('') + G(P('M0 0C20 -10 40 -6 52 8C36 8 18 8 0 0Z', '#3fb56b'), `translate(${p[0] + 8} ${50 + p[2]}) rotate(-20)`) + G(P('M0 0C-20 -10 -40 -6 -52 8C-36 8 -18 8 0 0Z', '#5ccf85'), `translate(${p[0] - 8} ${88 + p[2]}) rotate(20)`)).join(''));
  const flowerHead = (cx, cy, r, petals, pc, cc, n) => { let s = ''; for (let i = 0; i < n; i++) s += G(E(0, -r * 0.62, r * 0.28, r * 0.42, pc), `translate(${cx} ${cy}) rotate(${i * 360 / n})`); return s + C(cx, cy, r * 0.3, cc); };
  const hueGreen = hex => { const h = String(hex).replace('#', ''); if (h.length !== 6) return false; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return g > r * 1.05 && g >= b * 0.95 && g > 90; };
  const petalC = (t, i) => { const c = [t.a, t.c, t.e, t.acc, t.b, '#f472b6'].filter(x => !hueGreen(x)); return c[(i || 0) % c.length]; };
  const stem = (x, y0, y1, c) => S(`M${x} ${y0}C${x - 10} ${(y0 + y1) / 2} ${x + 10} ${(y0 + y1) / 2} ${x} ${y1}`, c || '#2f9e5b', 7);
  PL('sunflower', t => SH(100, 40) + stem(100, 178, 96) + G(P('M0 0C20 -16 46 -12 56 6C36 14 14 12 0 0Z', '#3fb56b'), 'translate(100 150) rotate(-15)') + G(P('M0 0C-20 -16 -46 -12 -56 6C-36 14 -14 12 0 0Z', '#3fb56b'), 'translate(100 128) rotate(15)') + flowerHead(100, 70, 62, 14, K.yellow, '#6b4226', 14) + C(100, 70, 15, '#5b3a22') + C(100, 70, 15, 'none', ' stroke="#8a5a36" stroke-width="3" stroke-dasharray="2 4"'));
  PL('tulip', t => SH(100, 40) + stem(100, 178, 90) + G(P('M0 0C-6 -40 -30 -70 -50 -84C-30 -60 -14 -34 0 0Z', '#3fb56b'), 'translate(100 176)') + G(P('M0 0C6 -40 30 -70 50 -84C30 -60 14 -34 0 0Z', '#5ccf85'), 'translate(100 176)') + P('M70 40C70 84 84 100 100 100C116 100 130 84 130 40C120 52 112 52 100 40C88 52 80 52 70 40Z', petalC(t, 0)) + P('M100 40C112 52 120 52 130 40C130 84 116 100 100 100Z', petalC(t, 1), ' opacity=".55"'));
  PL('rose', t => SH(100, 40) + stem(100, 178, 96) + S('M98 140L82 132M104 118L120 108', '#22854a', 4) + G(P('M0 0C14 -12 30 -8 34 6C20 10 8 8 0 0Z', '#3fb56b'), 'translate(102 150)') + C(100, 70, 42, petalC(t, 0)) + P('M70 60C74 40 126 40 130 60C126 80 74 80 70 60Z', petalC(t, 1)) + S('M82 60C90 48 110 48 118 60C112 70 88 70 82 60Z', petalC(t, 0), 4) + S('M92 60C96 54 104 54 108 60', t.light, 3));
  PL('daisy', t => SH(100, 40) + stem(100, 178, 94) + G(P('M0 0C14 -12 34 -8 40 6C24 12 8 10 0 0Z', '#3fb56b'), 'translate(100 148)') + flowerHead(100, 72, 60, 12, '#ffffff', K.yellow, 12) + C(100, 72, 12, K.yellow) + C(100, 72, 12, 'none', ` stroke="${K.gold}" stroke-width="3"`));
  PL('lotus', t => SH(100, 50) + E(100, 158, 80, 16, '#3fb56b') + E(100, 154, 66, 10, '#5ccf85') + [-60, -30, 30, 60].map(a => G(P('M0 0C-22 -22 -18 -54 0 -66C18 -54 22 -22 0 0Z', t.c), `translate(100 148) rotate(${a})`)).join('') + G(P('M0 0C-22 -28 -18 -66 0 -82C18 -66 22 -28 0 0Z', t.a), 'translate(100 148)') + G(P('M0 0C-16 -20 -12 -50 0 -62C12 -50 16 -20 0 0Z', t.b), 'translate(100 148) rotate(-18)') + G(P('M0 0C-16 -20 -12 -50 0 -62C12 -50 16 -20 0 0Z', t.b), 'translate(100 148) rotate(18)'));
  PL('lavender', t => SH(100, 46) + [[64, 22], [82, 10], [100, 0], [118, 10], [136, 22]].map(p => S(`M${p[0]} 178C${p[0]} 120 ${p[0] + (p[0] - 100) * 0.2} 80 ${p[0] + (p[0] - 100) * 0.4} ${60 + p[1]}`, '#3f9e5b', 3) + [0, 1, 2, 3, 4, 5, 6].map(i => E(p[0] + (p[0] - 100) * 0.4 + (i % 2 ? 4 : -4), 50 + p[1] + i * 10, 5, 8, i % 2 ? '#a78bfa' : '#8b5cf6')).join('')).join(''));
  PL('seedling', t => SH(100, 50) + E(100, 176, 62, 12, '#8a5a36') + E(100, 170, 50, 8, '#a9714b') + S('M100 170V96', '#3f9e5b', 7) + G(P('M0 0C-6 -26 -34 -42 -64 -36C-60 -10 -34 4 0 0Z', '#3fb56b'), 'translate(100 110)') + G(P('M0 0C6 -26 34 -42 64 -36C60 -10 34 4 0 0Z', '#5ccf85'), 'translate(100 96)') + S('M60 172L48 178M148 172L156 176', '#8a5a36', 4));
  PL('bonsai', t => SH(100, 60) + R(46, 158, 108, 16, t.a, 5) + R(56, 170, 88, 10, t.b, 4) + S('M100 158C96 140 76 132 84 114C92 98 116 104 112 84C110 70 100 66 100 60', '#7a4e2b', 10) + [[66, 108, 26], [130, 96, 26], [100, 60, 30], [80, 128, 22]].map((p, i) => E(p[0], p[1], p[2] + 8, p[2] - 6, i % 2 ? '#3fb56b' : '#2f9e5b')).join(''));
  PL('fern', t => SH(100, 46) + [-70, -45, -20, 0, 20, 45, 70].map((a, i) => G(S('M0 0C0 -40 0 -80 0 -110', '#2f9e5b', 4) + [1, 2, 3, 4, 5, 6, 7, 8].map(k => G(E(0, 0, 3, 12, i % 2 ? '#3fb56b' : '#5ccf85'), `translate(0 ${-k * 13}) rotate(${60 - k * 3})`) + G(E(0, 0, 3, 12, i % 2 ? '#3fb56b' : '#5ccf85'), `translate(0 ${-k * 13}) rotate(${-60 + k * 3})`)).join(''), `translate(100 176) rotate(${a}) scale(${0.85 + (i % 3) * 0.1})`)).join(''));
  PL('maple_tree', (t, o) => { const g = o.season === 'autumn' ? ['#d9822b', '#e8a23a', '#c8552b'] : seasonOf(o); return SH(100, 60) + trunk(100, 14, 100, 178, '#6b4a3a') + S('M100 130L72 108M100 118L130 100', '#6b4a3a', 8) + C(64, 92, 32, g[0]) + C(136, 92, 32, g[0]) + C(100, 60, 42, g[1]) + C(74, 66, 26, g[2]) + C(126, 68, 26, g[2]) + C(100, 102, 32, g[1]); });
  PL('willow_tree', t => SH(100, 50) + R(94, 130, 12, 48, '#7a5a3a', 4) + C(100, 90, 56, '#5aae66') + C(100, 90, 56, '#6fbe78', ' opacity=".4"') + [-56, -34, -14, 8, 30, 52].map((dx, i) => S(`M${100 + dx * 0.5} ${70 + Math.abs(dx) * 0.3}C${94 + dx * 0.6} 120 ${96 + dx * 0.7} 150 ${92 + dx * 0.8} 176`, i % 2 ? '#3f9e5b' : '#2f8e56', 3, ' opacity=".8"')).join(''));
  PL('orchid', t => SH(100, 40) + stem(100, 178, 88) + G(P('M0 0C10 -30 34 -54 54 -54C50 -30 30 -8 0 0Z', '#3fb56b'), 'translate(100 168) rotate(6)') + [0, 72, 144, 216, 288].map((a, i) => G(P('M0 -8C14 -20 14 -40 0 -50C-14 -40 -14 -20 0 -8Z', i === 0 ? K.gold : petalC(t, i)), `translate(100 84) rotate(${a})`)).join('') + C(100, 84, 9, '#fff') + C(100, 84, 5, K.gold));
  PL('venus_flytrap', t => SH(100, 46) + [-40, -18, 18, 40].map((dx, i) => S(`M100 176C${100 + dx * 0.3} 150 ${100 + dx * 0.6} 130 ${100 + dx} 112`, '#2f8e56', 5)).join('') + [-40, -12, 16, 42].map((dx, i) => G(P('M0 0C-4 -22 -22 -34 -34 -30C-30 -14 -14 -2 0 0Z', i % 2 ? '#e5484d' : '#f26b6b') + P('M0 0C4 -22 22 -34 34 -30C30 -14 14 -2 0 0Z', i % 2 ? '#f26b6b' : '#e5484d') + [1, 2, 3, 4].map(k => S(`M${-30 + k * 8} ${-4 - k}L${-38 + k * 8} ${-16 - k}`, '#2f8e56', 2)).join(''), `translate(${100 + dx} 110) rotate(${dx}) scale(0.9)`)).join(''));
  PL('snake_plant', t => SH(100, 46) + E(100, 172, 58, 12, '#8a5a36') + E(100, 166, 46, 8, '#a9714b') + [-40, -20, 0, 20, 40].map((dx, i) => G(P('M0 0C-10 -34 -8 -78 0 -100C8 -78 10 -34 0 0Z', i % 2 ? '#2f8e56' : '#3fb56b') + S('M-2 -10C-2 -44 -2 -74 0 -96M2 -10C2 -44 2 -74 0 -96', '#1f6e42', 2, ' opacity=".5"'), `translate(${100 + dx} 166) rotate(${dx * 0.3}) scale(${1 - Math.abs(dx) * 0.004})`)).join(''));
  PL('hibiscus', t => SH(100, 40) + stem(100, 178, 96) + G(P('M0 0C14 -12 30 -8 34 6C20 10 8 8 0 0Z', '#3fb56b'), 'translate(102 150)') + [0, 72, 144, 216, 288].map(a => G(P('M0 -6C10 -34 6 -56 -8 -62C-18 -40 -16 -14 0 -6Z', K.red), `translate(100 74) rotate(${a})`)).join('') + S('M100 74V38', K.gold, 4) + C(100, 36, 6, K.gold) + [-4, 4].map(dx => C(100 + dx, 28, 2.5, '#f59e0b')).join(''));

  // ----- v3 new plants -----
  PL('olive_tree', (t, o) => SH(100, 60) + P('M92 178C88 140 86 100 96 60C96 56 104 56 104 60C114 100 112 140 108 178Z', '#8a7a5a') + S('M100 130L72 96M100 118L132 92M100 148L78 122', '#8a7a5a', 5) +
    [[64, 84, 28], [136, 84, 28], [100, 54, 34], [72, 62, 22], [128, 62, 22], [100, 96, 28]].map((p, i) => C(p[0], p[1], p[2], ['#7c9455', '#8faa62', '#a3bf75'][i % 3])).join('') +
    [[72, 82], [124, 66], [88, 104], [130, 96], [64, 68]].map(p => C(p[0], p[1], 4, '#2b2f3a')).join(''));
  PL('joshua_tree', t => SH(100, 50) + P('M88 178C92 130 92 80 100 44C108 80 108 130 112 178Z', '#8a6a4a') + S('M100 130L62 108M100 116L140 96M100 96L76 68M100 84L134 56', '#8a6a4a', 6) +
    [[62, 108, 30], [140, 96, 30], [76, 68, 28], [134, 56, 28], [100, 44, 40]].map((p, i) => G(P('M0 0C-8 -14 -8 -28 0 -36C8 -28 8 -14 0 0Z', ['#3f7d4a', '#4d9157', '#2f6d3a'][i % 3]), `translate(${p[0]} ${p[1]}) rotate(${i * 72})`)).join(''));
  PL('baobab_tree', t => SH(100, 40) + P('M60 178C64 120 68 80 84 50C84 46 116 46 116 50C132 80 136 120 140 178Z', '#a9714b') + S('M100 68L58 40M100 68L142 40M100 68L76 24M100 68L124 24M100 68V14', '#8a5a36', 7) +
    [[58, 40, 22], [142, 40, 22], [76, 24, 18], [124, 24, 18], [100, 14, 26]].map((p, i) => C(p[0], p[1], p[2], ['#5a8a4a', '#6b9e57', '#4a7a3a'][i % 3])).join(''));
  PL('pampas_grass', t => SH(100, 46) + E(100, 176, 62, 12, t.d) + [-40, -20, 0, 20, 40].map(dx => S(`M${100 + dx} 176C${100 + dx * 0.8} 120 ${100 + dx * 0.6} 80 ${100 + dx * 0.4} 40`, '#8a9e6a', 4) + [0, 1, 2, 3, 4].map(i => G(P('M0 0C-8 -8 -4 -16 0 -22C4 -16 8 -8 0 0Z', '#f0e8d0'), `translate(${100 + dx * 0.4} ${40 + i * 12}) rotate(${-8 + i * 4})`)).join('')).join(''));
  PL('wheat_stalk', t => SH(100, 40) + [-30, -10, 10, 30].map((dx, i) => S(`M${100 + dx * 0.5} 178C${100 + dx * 0.7} 120 ${100 + dx * 0.9} 80 ${100 + dx} 40`, '#a89a3a', 3) + [0, 1, 2, 3, 4, 5].map(k => E(100 + dx, 44 + k * 14, 7, 5, '#e8c846')).join('')).join(''));
  PL('corn_stalk', t => SH(100, 44) + R(96, 20, 8, 158, '#4a7d3a', 3) + G(P('M0 0C30 -14 30 -50 0 -60C-30 -50 -30 -14 0 0Z', '#7cc552'), 'translate(100 70) rotate(-10)') + G(P('M0 0C30 -14 30 -50 0 -60C-30 -50 -30 -14 0 0Z', '#5cb042'), 'translate(120 90) rotate(-25)') + E(100, 50, 16, 28, K.yellow) + E(100, 46, 12, 20, '#fde68a'));
  PL('strawberry_plant', t => SH(100, 46) + E(100, 176, 62, 12, '#8a5a36') + C(100, 150, 30, '#3f9e5b') + C(80, 138, 22, '#4dae66') + C(120, 138, 22, '#4dae66') +
    [[80, 110], [120, 110], [100, 96], [64, 130], [136, 130]].map((p, i) => P(`M${p[0]} ${p[1]}C${p[0] - 14} ${p[1] + 20} ${p[0] + 14} ${p[1] + 20} ${p[0]} ${p[1] + 30}Z`, K.red) + C(p[0], p[1] + 10, 3, '#fde68a')).join(''));
  PL('aloe_vera', t => SH(100, 50) + P('M60 130H140L132 178H68Z', t.a) + R(56, 122, 88, 14, t.b, 6) +
    [-50, -25, 0, 25, 50].map(a => G(P('M0 0C-16 -30 -16 -68 0 -86C16 -68 16 -30 0 0Z', '#5ccf85'), `translate(100 122) rotate(${a})`)).join('') +
    [-30, 30].map(a => G(P('M0 0C-10 -22 -10 -50 0 -62C10 -50 10 -22 0 0Z', '#3fb56b'), `translate(100 122) rotate(${a * 0.5})`)).join(''));
  PL('jade_plant', t => SH(100, 50) + P('M64 130H136L128 178H72Z', t.a) + R(58, 122, 84, 14, t.b, 6) + S('M100 122V50M100 80L76 60M100 96L128 70M100 66L128 46', '#6b8a4a', 5) +
    [[50, 44, 16], [76, 56, 18], [100, 40, 20], [128, 44, 16], [128, 68, 16], [76, 76, 16], [100, 96, 18]].map((p, i) => C(p[0], p[1], p[2], ['#7cb06a', '#8fc47a', '#6b9a56'][i % 3])).join(''));
  PL('ivy_vine', t => SH(100, 46) + S('M100 178C80 140 120 100 90 60C70 32 90 14 100 6', '#3f8a4a', 6) + [1, 2, 3, 4, 5, 6, 7, 8].map(i => G(P('M0 0C14 -8 30 -8 40 0C30 10 14 10 0 0Z', i % 2 ? '#5cae66' : '#4a9e56'), `translate(${100 + Math.sin(i * 1.3) * 26} ${170 - i * 20}) rotate(${i % 2 ? 24 : 200}) scale(0.8)`)).join(''));
  PL('bonsai_pine', t => SH(100, 60) + R(50, 160, 100, 12, t.a, 4) + R(58, 172, 84, 8, t.b, 3) + P('M100 160C88 138 66 130 60 108C66 104 82 106 90 122C92 100 104 78 100 60C98 44 106 30 118 26C122 42 116 60 112 78C130 88 138 108 134 128C122 118 110 116 100 122Z', '#6b4a3a') +
    C(64, 100, 24, '#2f8e56') + C(96, 78, 22, '#3fb56b') + C(118, 38, 26, '#2f8e56') + C(138, 122, 22, '#3fb56b') + C(100, 60, 20, '#5ccf85'));
  PL('moss_ball', t => SH(100, 60) + P('M58 130H142L132 178H68Z', t.a) + R(52, 122, 96, 14, t.b, 6) + C(100, 80, 54, '#4a9e56') + C(100, 76, 54, '#5cae66') + [[80, 60, 10], [120, 60, 10], [100, 44, 12], [80, 96, 10], [120, 96, 10], [100, 108, 8]].map((p, i) => C(p[0], p[1], p[2], '#3f8a4a', ' opacity=".7"')).join(''));

  // ---------- BUILDINGS ----------
  const BLD = {}, BLD_LIST = [];
  const BD = (n, fn) => { BLD[n] = fn; BLD_LIST.push(n); };
  const win = (x, y, w, h, t, lit) => R(x, y, w, h, lit ? K.yellow : K.sky, 2, ` stroke="${t.ink}" stroke-width="2"`);
  BD('house', t => SH(100, 80) + R(38, 92, 124, 84, t.d, 4) + PG('24,96 100,32 176,96', t.a) + PG('24,96 100,32 100,96', '#000', ' opacity=".1"') + R(84, 118, 32, 58, t.b, 3) + C(108, 148, 2.5, K.gold) + win(48, 108, 28, 26, t, false) + win(124, 108, 28, 26, t, true) + R(134, 40, 16, 34, t.ink, 3) + C(100, 80, 8, t.light));
  BD('cottage', t => SH(100, 80) + R(40, 106, 120, 70, '#f3e3c4', 4) + P('M26 110C40 70 70 44 100 30C130 44 160 70 174 110Z', '#b56a3c') + [0, 1, 2, 3].map(i => S(`M${52 + i * 26} 100L${64 + i * 22} 50`, '#8f4f26', 3, ' opacity=".5"')).join('') + R(88, 130, 26, 46, '#7a4e2b', 13) + win(52, 122, 26, 24, t, true) + win(126, 122, 26, 24, t, false) + R(132, 44, 14, 30, '#8a5a36', 2) + S('M139 40C132 30 146 24 138 14', '#cfd6df', 4) + [50, 150].map(x => C(x, 170, 8, '#3fb56b')).join(''));
  BD('apartment', t => SH(100, 80) + R(44, 24, 112, 152, t.a, 4) + R(38, 20, 124, 10, t.ink, 3) + [0, 1, 2, 3, 4].map(r => [0, 1, 2].map(c => win(56 + c * 34, 38 + r * 26, 24, 16, t, (r + c * 2) % 3 === 0)).join('')).join('') + R(88, 148, 24, 28, t.ink, 3));
  BD('skyscraper', t => SH(100, 60) + R(72, 40, 56, 138, t.b, 3) + R(84, 22, 32, 20, t.a, 3) + R(98, 4, 4, 20, t.ink) + [0, 1, 2, 3, 4, 5, 6].map(r => R(78, 48 + r * 19, 44, 10, t.light, 1, ' opacity=".75"')).join('') + R(48, 96, 26, 82, t.a, 3) + R(126, 84, 26, 94, t.a, 3) + [0, 1, 2, 3].map(r => R(54, 104 + r * 18, 14, 8, t.light, 1, ' opacity=".6"') + R(132, 92 + r * 20, 14, 8, t.light, 1, ' opacity=".6"')).join(''));
  BD('school', t => SH(100, 84) + R(20, 96, 160, 80, t.d, 4) + R(70, 66, 60, 110, t.c, 4) + PG('62,68 100,34 138,68', t.a) + C(100, 84, 12, t.light) + S('M100 84V76M100 84L106 88', t.ink, 2.5) + [30, 42, 138, 150].map(x => R(x, 108, 16, 24, K.sky, 2, ` stroke="${t.ink}" stroke-width="2"`)).join('') + R(86, 132, 28, 44, t.b, 3) + R(98, 14, 3, 22, t.ink) + PG('101,14 118,20 101,26', t.acc));
  BD('hospital', t => SH(100, 80) + R(30, 56, 140, 120, t.light, 4, ` stroke="${t.c}" stroke-width="4"`) + R(76, 20, 48, 40, t.a, 4) + R(96, 26, 8, 28, '#fff') + R(86, 36, 28, 8, '#fff') + [72, 102, 132].map((y, r) => win(44, y, 22, 18, t, r === 1) + win(134, y, 22, 18, t, false)).join('') + R(84, 130, 32, 46, t.b, 3));
  BD('factory', t => SH(100, 84) + R(30, 96, 140, 80, t.a, 3) + PG('30,96 30,70 66,96', t.b) + PG('66,96 66,70 102,96', t.b) + PG('102,96 102,70 138,96', t.b) + R(138, 50, 26, 126, t.b, 3) + R(136, 42, 30, 10, t.ink, 3) + [46, 84, 122].map(x => R(x, 116, 22, 18, K.yellow, 2)).join('') + R(76, 140, 34, 36, t.ink, 3) + OP(C(154, 30, 12, '#cfd6df') + C(168, 18, 10, '#dfe5ec') + C(180, 6, 8, '#eef1f5'), .9));
  BD('castle', t => SH(100, 84) + R(56, 76, 88, 100, t.c, 3) + [22, 154].map(x => R(x, 60, 30, 116, t.b, 3) + PG(`${x - 4},60 ${x + 15},22 ${x + 34},60`, t.a) + R(x + 9, 84, 12, 20, t.ink, 6)).join('') + [62, 84, 106, 128].map(x => R(x, 66, 12, 12, t.c)).join('') + P('M84 176V136C84 118 116 118 116 136V176Z', t.ink) + R(94, 92, 12, 20, t.ink, 6) + R(94, 8, 3, 16, t.ink) + PG('97,8 112,13 97,18', t.acc));
  BD('lighthouse', t => SH(100, 60) + P('M74 176L86 60H114L126 176Z', '#ffffff') + P('M80 130H120L123 150H77Z', t.a) + P('M84 78H116L118 96H82Z', t.a) + R(80, 52, 40, 10, t.ink, 2) + R(86, 30, 28, 24, K.yellow, 3) + R(84, 26, 32, 6, t.ink) + PG('84,26 100,10 116,26', t.a) + PG('114,42 190,20 190,64', K.yellow, ' opacity=".3"') + PG('86,42 10,20 10,64', K.yellow, ' opacity=".3"') + R(92, 152, 16, 24, t.ink, 8) + P('M20 176C50 164 150 164 180 176Z', t.c));
  BD('mosque', t => SH(100, 84) + R(50, 100, 100, 76, t.d, 3) + P('M60 100C60 60 140 60 140 100Z', t.a) + R(98, 36, 4, 22, K.gold) + C(100, 34, 5, K.gold) + [24, 168].map(x => R(x - 8, 72, 16, 104, t.c, 2) + PG(`${x - 10},72 ${x},46 ${x + 10},72`, t.a) + R(x - 2, 30, 4, 18, K.gold) + R(x - 10, 92, 20, 5, t.b)).join('') + P('M82 176V132C82 112 118 112 118 132V176Z', t.b) + [62, 138].map(x => P(`M${x - 8} 150V128C${x - 8} 114 ${x + 8} 114 ${x + 8} 128V150Z`, K.sky)).join(''));
  BD('pagoda', t => SH(100, 66) + [[132, 44], [96, 56], [60, 68]].map((r, i) => R(100 - r[1] / 2 + 6, r[0] - 4, r[1] - 12, 34, t.d, 2) + P(`M${100 - r[1] / 2 - 14} ${r[0] - 2}C${100 - r[1] / 2 + 4} ${r[0] - 8} ${100 - r[1] / 2 + 20} ${r[0] - 26} 100 ${r[0] - 30}C${100 + r[1] / 2 - 20} ${r[0] - 26} ${100 + r[1] / 2 - 4} ${r[0] - 8} ${100 + r[1] / 2 + 14} ${r[0] - 2}Z`, t.a)).join('') + R(94, 12, 12, 24, K.gold, 2) + R(66, 150, 68, 26, t.d, 2) + R(90, 152, 20, 24, t.b, 10, '') + R(50, 176, 100, 6, t.ink, 2));
  BD('church', t => SH(100, 80) + R(40, 100, 120, 76, t.d, 3) + R(80, 60, 40, 116, t.c, 3) + PG('72,64 100,26 128,64', t.a) + R(98, 6, 4, 24, t.ink) + R(90, 12, 20, 4, t.ink) + C(100, 84, 10, t.light) + P('M86 176V138C86 122 114 122 114 138V176Z', t.b) + [48, 138].map(x => P(`M${x} 148V124C${x} 112 ${x + 14} 112 ${x + 14} 124V148Z`, K.sky)).join(''));
  BD('windmill', t => SH(100, 60) + P('M70 176L82 76H118L130 176Z', t.d) + PG('76,76 100,44 124,76', t.a) + R(92, 130, 16, 46, t.b, 3) + G([0, 90, 180, 270].map(a => G(R(-3, -66, 6, 66, t.ink) + R(-1, -64, 18, 36, t.light, 2, ` stroke="${t.ink}" stroke-width="2"`), `rotate(${a + 20})`)).join('') + C(0, 0, 8, t.ink), 'translate(100 68)') + R(88, 100, 24, 18, K.sky, 2));
  BD('barn', t => SH(100, 80) + P('M28 176V86L60 54H140L172 86V176Z', K.red) + P('M20 88L100 30L180 88L172 88L100 42L28 88Z', '#fff') + R(70, 106, 60, 70, K.dred, 3) + S('M70 106L130 176M130 106L70 176', '#fff', 5) + R(86, 66, 28, 22, '#fff', 2) + S('M100 66V88M86 77H114', K.dred, 3));
  BD('shop', t => SH(100, 80) + R(30, 66, 140, 110, t.d, 3) + R(24, 44, 152, 26, t.ink, 4) + [0, 1, 2, 3, 4, 5, 6].map(i => P(`M${30 + i * 20} 70H${50 + i * 20}V78C${50 + i * 20} 90 ${30 + i * 20} 90 ${30 + i * 20} 78Z`, i % 2 ? '#fff' : t.a)).join('') + R(44, 96, 62, 52, K.sky, 3, ` stroke="${t.ink}" stroke-width="3"`) + R(120, 96, 36, 80, t.b, 3) + C(148, 138, 3, K.gold) + `<text x="100" y="62" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="14" fill="#fff">SHOP</text>`);
  BD('bank_building', t => SH(100, 80) + PG('20,72 100,30 180,72', t.a) + R(20, 72, 160, 10, t.b, 2) + [0, 1, 2, 3, 4].map(i => R(34 + i * 30, 86, 14, 70, t.light, 2, ` stroke="${t.c}" stroke-width="2"`)).join('') + R(14, 156, 172, 10, t.b, 2) + R(8, 166, 184, 12, t.a, 2) + C(100, 60, 8, K.gold));
  BD('igloo', t => SH(100, 66) + P('M24 176C24 100 60 58 100 58C140 58 176 100 176 176Z', '#eaf6ff', ` stroke="${t.c}" stroke-width="5"`) + S('M28 150H172M34 124H166M50 98H150M78 72H122', t.c, 3, ' opacity=".7"') + S('M100 58V176M62 78L72 176M138 78L128 176', t.c, 3, ' opacity=".5"') + P('M74 176V148C74 128 126 128 126 148V176Z', t.ink) + P('M20 176C40 168 160 168 180 176V184H20Z', '#fff'));
  BD('greenhouse', t => SH(100, 80) + P('M28 176V96L100 40L172 96V176Z', K.sky, ' opacity=".55"') + S('M28 176V96L100 40L172 96V176Z', t.c, 5) + S('M100 40V176M64 68V176M136 68V176M28 130H172', t.c, 3) + [[48, 156], [82, 150], [118, 152], [152, 156]].map(p => C(p[0], p[1], 10, '#3fb56b') + C(p[0], p[1] - 4, 4, t.acc)).join('') + R(20, 170, 160, 10, t.a, 3));
  BD('treehouse', t => SH(100, 60) + R(90, 100, 22, 78, K.dbrown, 4) + C(60, 76, 42, '#2f9e5b') + C(140, 76, 42, '#2f9e5b') + C(100, 46, 44, '#3fb56b') + R(60, 96, 80, 8, K.wood, 2) + R(68, 62, 64, 36, K.lwood, 3) + PG('62,64 100,36 138,64', t.a) + R(92, 76, 16, 22, t.ink, 8) + S('M100 106L74 176M96 130H82M92 150H78', K.brown, 4) + win(74, 72, 14, 12, t, true));
  BD('train_station', t => SH(100, 80) + R(20, 96, 160, 80, t.d, 3) + P('M12 100H188L176 78H24Z', t.a) + R(88, 34, 24, 44, t.b, 3) + C(100, 52, 9, t.light) + S('M100 52V46M100 52L104 55', t.ink, 2) + [34, 62, 126, 154].map(x => R(x, 112, 16, 28, K.sky, 2)).join('') + P('M84 176V140C84 124 116 124 116 140V176Z', t.ink) + R(10, 176, 180, 6, t.ink, 2));
  BD('stadium', t => SH(100, 70) + P('M10 160C10 100 46 64 100 64C154 64 190 100 190 160Z', t.d) + P('M24 160C24 108 56 78 100 78C144 78 176 108 176 160Z', t.b) + E(100, 158, 76, 16, '#5aae66') + [24, 176].map(x => R(x - 8, 40, 16, 40, t.a, 3)).join(''));
  BD('library_building', t => SH(100, 80) + R(30, 92, 140, 84, t.d, 3) + PG('22,96 100,44 178,96', t.a) + R(50, 118, 20, 58, t.b, 2) + R(78, 118, 20, 58, t.b, 2) + R(106, 118, 20, 58, t.b, 2) + R(134, 118, 20, 58, t.b, 2) + R(22, 96, 156, 8, t.ink, 2) + R(86, 156, 28, 20, t.ink, 3) + `<text x="100" y="80" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="12" fill="#fff">LIBRARY</text>`);
  BD('temple', t => SH(100, 84) + R(24, 130, 152, 46, t.d, 3) + R(16, 172, 168, 8, t.ink, 2) + [36, 66, 96, 126, 156].map(x => R(x - 6, 96, 12, 40, t.b, 1)).join('') + PG('16,96 100,52 184,96', t.a) + PG('16,96 184,96 176,84 24,84', t.ink, ' opacity=".15"') + C(100, 40, 8, K.gold) + R(96, 20, 8, 22, t.ink, 2));
  BD('water_tower', t => SH(100, 44) + [46, 154].map(x => S(`M${x} 176V96`, K.metal, 6)).join('') + S('M46 176L154 96M154 176L46 96M46 136H154', K.metal, 3, ' opacity=".7"') + P('M56 92C56 66 144 66 144 92C144 108 132 116 100 116C68 116 56 108 56 92Z', t.a) + R(56 - 4, 44, 96, 48, t.b, 8) + PG('52,92 100,46 148,92', t.a) + R(94, 30, 12, 16, t.ink, 2));
  BD('circus_tent', t => SH(100, 66) + PG('20,176 100,58 180,176', t.a) + [0, 1, 2, 3, 4, 5].map(i => PG(`${20 + i * 26.6},176 ${20 + (i + 1) * 26.6},176 ${100 + ((20 + (i + 1) * 26.6) - 100) * 0.42},58 ${100 + ((20 + i * 26.6) - 100) * 0.42},58`, i % 2 ? '#fff' : K.red)).join('') + S('M100 58V26', K.metal, 3) + PG('100,18 108,28 92,28', t.acc) + R(60, 150, 20, 26, t.ink, 3) + R(120, 150, 20, 26, t.ink, 3));

  // ----- v3 new buildings -----
  BD('townhouse', t => SH(100, 84) + R(30, 80, 140, 96, t.d, 4) + R(24, 72, 152, 12, t.a, 3) + R(50, 96, 24, 24, K.sky, 2, ` stroke="${t.ink}" stroke-width="2"`) + R(126, 96, 24, 24, K.sky, 2, ` stroke="${t.ink}" stroke-width="2"`) + R(50, 130, 24, 24, K.yellow, 2, ` stroke="${t.ink}" stroke-width="2"`) + R(126, 130, 24, 24, K.sky, 2, ` stroke="${t.ink}" stroke-width="2"`) + R(88, 118, 24, 58, t.b, 3) + C(108, 148, 2.5, K.gold));
  BD('bungalow', t => SH(100, 84) + R(28, 108, 144, 70, t.c, 4) + P('M20 112L100 60L180 112Z', t.a) + R(88, 130, 24, 48, t.b, 3) + R(48, 122, 28, 28, K.sky, 3, ` stroke="${t.ink}" stroke-width="2"`) + R(124, 122, 28, 28, K.yellow, 3, ` stroke="${t.ink}" stroke-width="2"`) + [40, 160].map(x => C(x, 174, 8, '#3fb56b')).join(''));
  BD('warehouse', t => SH(100, 84) + R(20, 76, 160, 100, t.b, 3) + P('M16 80L100 44L184 80Z', t.ink) + R(60, 112, 80, 64, t.a, 2) + S('M60 112V176M100 112V176M140 112V176', t.ink, 3) + R(40, 96, 22, 22, K.sky, 2) + R(138, 96, 22, 22, K.sky, 2));
  BD('observatory', t => SH(100, 74) + R(40, 100, 120, 76, t.d, 3) + P('M60 100C60 66 140 66 140 100Z', t.a) + S('M56 100H144', t.ink, 4) + R(98, 30, 6, 20, t.ink) + C(100, 28, 6, t.acc) + R(60, 130, 20, 46, K.sky, 3) + R(120, 130, 20, 46, K.sky, 3) + R(88, 130, 24, 46, t.b, 3));
  BD('radio_tower', t => SH(100, 44) + P('M80 176L94 60H106L120 176Z', t.dmetal || '#64748b') + S('M86 130L114 130M84 100L116 100M90 70L110 70', t.dmetal, 3) + [0, 1, 2].map(i => S(`M${98 - i * 12} 60 C${98 - i * 12} ${40 - i * 8} ${98 + i * 12} ${40 - i * 8} ${98 + i * 12} 60`, '#3f8a4a', 2, ' opacity=".6"')).join('') + S('M100 60V40', t.dmetal, 4) + C(100, 36, 5, K.red) + R(78, 176, 44, 8, t.ink, 3));
  BD('clock_tower', t => SH(100, 40) + R(78, 60, 44, 116, t.b, 3) + P('M72 60L100 20L128 60Z', t.a) + C(100, 100, 16, '#fff') + C(100, 100, 16, 'none', ` stroke="${t.ink}" stroke-width="3"`) + S('M100 100V90M100 100L108 104', t.ink, 3) + R(90, 130, 20, 46, t.ink, 3));
  BD('amphitheater', t => SH(100, 74) + P('M20 176C20 120 60 80 100 80C140 80 180 120 180 176Z', t.d) + P('M40 176C40 130 68 100 100 100C132 100 160 130 160 176Z', t.c) + P('M60 176C60 140 78 120 100 120C122 120 140 140 140 176Z', t.b) + E(100, 172, 76, 14, '#5aae66') + [24, 176].map(x => R(x - 4, 60, 8, 40, t.a, 2)).join('') + PG('100,90 106,110 126,110 110,122 116,142 100,132 84,142 90,122 74,110 94,110', K.gold));
  BD('palace', t => SH(100, 80) + R(20, 90, 160, 86, t.d, 3) + PG('14,90 100,50 186,90', t.a) + PG('14,90 100,50 100,90', '#000', ' opacity=".12"') + [30, 60, 90, 120, 150].map(x => R(x, 110, 12, 66, t.b, 2)).join('') + R(88, 140, 24, 36, t.ink, 3) + R(14, 90, 172, 6, t.b, 3) + C(100, 40, 10, K.gold) + [40, 160].map(x => P(`M${x - 12} 90V70C${x - 12} 56 ${x + 12} 56 ${x + 12} 70V90Z`, K.sky)).join(''));
  BD('beach_hut', t => SH(100, 84) + P('M40 176V116H160V176Z', '#d9a86b') + PG('30,118 100,70 170,118', '#c58b55') + P('M100 70C80 58 70 42 80 32C92 36 100 52 100 70Z', '#5cae66') + P('M100 70C120 58 130 42 120 32C108 36 100 52 100 70Z', '#4a9e56') + R(90, 130, 20, 46, t.ink, 3) + R(52, 122, 26, 22, K.sky, 3) + R(122, 122, 26, 22, K.sky, 3) + R(20, 176, 160, 6, '#f4dfae', 3));
  BD('hangar', t => SH(100, 84) + P('M20 176V100C20 68 56 40 100 40C144 40 180 68 180 100V176Z', t.dmetal || '#64748b') + R(90, 100, 20, 76, t.dmetal, 3) + S('M40 70L160 70M40 88L160 88M40 106L160 106', t.light, 2, ' opacity=".35"'));
  BD('dojo', t => SH(100, 84) + R(28, 100, 144, 78, t.d, 3) + P('M14 104L100 62L186 104L176 116H24Z', '#8a5a36') + R(60, 130, 80, 48, '#5b3a22', 3) + S('M60 130V178M100 130V178M140 130V178', '#2b1a14', 3) + PG('100,66 88,60 100,56 112,60', K.gold) + C(50, 130, 10, '#3fb56b') + C(150, 130, 10, '#3fb56b'));
  BD('villa', t => SH(100, 84) + R(24, 96, 152, 80, t.light, 3) + R(24, 96, 152, 10, t.a, 3) + P('M20 96L100 46L180 96Z', '#c58b55') + R(40, 116, 30, 34, K.sky, 3, ` stroke="${t.ink}" stroke-width="2"`) + R(130, 116, 30, 34, K.sky, 3, ` stroke="${t.ink}" stroke-width="2"`) + R(84, 116, 32, 60, t.a, 3) + [56, 144].map(x => C(x, 100, 8, '#3fb56b')).join('') + E(100, 176, 80, 8, t.d));

  // ---------- VEHICLES ----------
  const VEH = {}, VEH_LIST = [];
  const VH = (n, fn) => { VEH[n] = fn; VEH_LIST.push(n); };
  const wheel = (x, y, r, t) => C(x, y, r, K.ink) + C(x, y, r * 0.55, K.metal) + C(x, y, r * 0.2, K.ink);
  VH('car', t => SH(100, 80) + P('M14 124C14 108 26 104 40 100L62 72C68 66 76 62 86 62H128C138 62 146 66 154 76L168 100C182 102 188 110 188 124V136H14Z', t.a) + P('M70 78H98V100H54Z', K.sky) + P('M106 78H130C136 78 140 82 144 88L152 100H106Z', K.sky) + R(14, 118, 174, 6, '#000', 0, ' opacity=".1"') + R(178, 112, 10, 10, K.yellow, 3) + R(14, 112, 8, 10, K.red, 3) + wheel(56, 138, 20, t) + wheel(146, 138, 20, t));
  VH('sports_car', t => SH(100, 84) + P('M8 128C8 112 22 110 40 106C56 92 80 80 106 80C134 80 152 92 168 104C186 108 194 114 194 128V138H8Z', t.acc) + P('M84 88C98 84 116 84 130 88L150 104H70Z', K.sky) + R(8, 122, 186, 6, '#000', 0, ' opacity=".12"') + S('M100 104V124', '#000', 3, ' opacity=".3"') + R(14, 112, 14, 6, K.red, 3) + wheel(52, 138, 19, t) + wheel(150, 138, 19, t));
  VH('bus', t => SH(100, 88) + R(12, 52, 176, 86, t.a, 14) + R(12, 108, 176, 10, '#000', 0, ' opacity=".12"') + [0, 1, 2, 3, 4].map(i => R(24 + i * 30, 64, 24, 30, K.sky, 4)).join('') + R(158, 64, 22, 60, K.sky, 4) + R(12, 96, 176, 4, t.light, 0, ' opacity=".7"') + wheel(48, 140, 18, t) + wheel(146, 140, 18, t) + C(184, 116, 5, K.yellow));
  VH('school_bus', t => SH(100, 88) + R(10, 54, 164, 86, K.yellow, 12) + P('M174 76H188C194 76 196 84 196 92V140H174Z', K.yellow) + [0, 1, 2, 3].map(i => R(20 + i * 34, 66, 24, 28, K.sky, 3)).join('') + R(150, 66, 20, 60, K.sky, 3) + R(10, 108, 186, 5, K.ink) + R(10, 96, 186, 3, K.ink) + wheel(48, 140, 18, t) + wheel(146, 140, 18, t) + C(194, 118, 4, K.red));
  VH('truck', t => SH(100, 88) + R(10, 52, 116, 84, t.b, 6) + P('M126 78H160C168 78 174 84 178 92L190 108V136H126Z', t.a) + P('M136 86H160L172 106H136Z', K.sky) + R(10, 124, 180, 6, '#000', 0, ' opacity=".12"') + `<text x="68" y="102" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="22" fill="#fff">CARGO</text>` + wheel(42, 140, 18, t) + wheel(96, 140, 18, t) + wheel(156, 140, 18, t));
  VH('train', t => SH(100, 80) + R(10, 60, 180, 76, t.a, 18) + P('M150 60H172C184 60 190 78 190 96V136H150Z', t.b) + P('M160 70H172C178 70 180 80 180 90H160Z', K.sky) + [0, 1, 2, 3].map(i => R(24 + i * 30, 72, 22, 26, K.sky, 4)).join('') + R(10, 106, 180, 8, t.light, 0, ' opacity=".6"') + wheel(44, 140, 15, t) + wheel(84, 140, 15, t) + wheel(130, 140, 15, t) + R(4, 148, 192, 6, t.ink, 2) + C(186, 118, 4, K.yellow));
  VH('plane', t => SH(100, 40) + G(P('M12 100C12 88 26 84 50 86L138 86C170 86 190 92 190 100C190 108 170 114 138 114L50 114C26 116 12 112 12 100Z', t.light) + P('M84 96L120 26H146L124 96Z', t.a) + P('M84 104L120 174H146L124 104Z', t.a) + P('M22 92L12 60H32L46 90Z', t.b) + [0, 1, 2, 3, 4, 5].map(i => C(60 + i * 12, 98, 3.5, K.sky)).join('') + P('M158 90C172 90 184 94 190 100C184 106 172 108 158 108Z', K.sky), 'rotate(-8 100 100)'));
  VH('helicopter', t => SH(100, 60) + R(30, 42, 140, 6, t.ink, 3) + R(96, 46, 8, 22, t.ink) + P('M66 100C66 78 84 66 104 66C130 66 146 82 146 100C146 120 130 128 108 128H84C72 128 66 114 66 100Z', t.a) + P('M146 92L188 84V104L146 108Z', t.a) + P('M182 68L196 68L192 100L182 100Z', t.b) + P('M76 96C76 84 88 78 100 78H112V108H76Z', K.sky) + S('M62 148H140M84 128V148M118 128V148', t.ink, 5) + C(190, 84, 10, t.ink, ' opacity=".6"'));
  VH('ship', t => SH(100, 84) + P('M8 128H192L172 168C168 174 162 176 156 176H44C38 176 32 174 28 168Z', t.a) + R(8, 122, 184, 10, t.light, 3) + R(50, 78, 100, 46, t.light, 4) + R(60, 88, 16, 14, K.sky, 2) + R(86, 88, 16, 14, K.sky, 2) + R(112, 88, 16, 14, K.sky, 2) + R(86, 44, 44, 34, t.b, 4) + R(96, 22, 24, 22, t.a, 3) + R(96, 30, 24, 5, t.light) + P('M0 176C20 168 40 184 60 176C80 168 100 184 120 176C140 168 160 184 180 176C190 172 196 174 200 176V190H0Z', t.c, ' opacity=".8"'));
  VH('sailboat_o', t => SH(100, 66) + R(98, 20, 4, 116, t.ink) + P('M96 24C60 50 44 88 40 120H96Z', t.light) + P('M104 40C132 62 152 92 160 120H104Z', t.acc) + P('M20 132H180L160 166H40Z', t.a) + R(20, 126, 160, 8, t.b, 3) + PG('102,20 122,26 102,32', t.acc) + P('M0 176C30 164 60 186 100 174C140 162 170 184 200 174V190H0Z', t.c, ' opacity=".8"'));
  VH('bicycle', t => SH(100, 66) + C(50, 132, 38, 'none', ` stroke="${K.ink}" stroke-width="7"`) + C(150, 132, 38, 'none', ` stroke="${K.ink}" stroke-width="7"`) + [50, 150].map(x => S(`M${x - 38} 132H${x + 38}M${x} 94V170M${x - 27} 105L${x + 27} 159M${x + 27} 105L${x - 27} 159`, K.metal, 1.5)).join('') + S('M50 132L84 84H128L150 132M84 84L104 132H50M104 132L128 84', t.a, 7) + S('M76 76H98', t.ink, 8) + S('M128 84L120 62H140', t.ink, 7) + C(104, 132, 8, t.ink));
  VH('motorbike_o', t => SH(100, 80) + C(46, 140, 28, K.ink) + C(46, 140, 14, K.metal) + C(154, 140, 28, K.ink) + C(154, 140, 14, K.metal) + P('M46 140L74 96H108L130 120H150L154 140Z', t.a) + P('M86 96C90 80 116 78 122 94Z', t.ink) + P('M74 96H110L100 116H74Z', t.b) + S('M126 118L140 76H158', K.ink, 7) + R(60, 122, 60, 12, K.dmetal, 4) + C(160, 74, 8, K.yellow));
  VH('scooter', t => SH(100, 80) + C(42, 150, 20, K.ink) + C(160, 150, 20, K.ink) + C(42, 150, 8, K.metal) + C(160, 150, 8, K.metal) + R(42, 134, 118, 12, t.a, 6) + S('M156 138L146 60H168', K.ink, 8) + S('M146 60L134 56', K.ink, 6) + R(20, 110, 50, 14, t.b, 6));
  VH('rocket_v', t => SH(100, 40) + G(P('M100 14C136 40 148 84 138 134H62C52 84 64 40 100 14Z', t.light) + P('M100 14C136 40 148 84 138 134H100Z', '#000', ' opacity=".08"') + P('M100 14C90 22 82 32 76 44H124C118 32 110 22 100 14Z', t.a) + C(100, 84, 16, t.a) + C(100, 84, 9, K.sky) + P('M62 102L34 130V158L66 138Z', t.a) + P('M138 102L166 130V158L134 138Z', t.a) + R(84, 134, 32, 10, t.ink, 3) + P('M82 146H118C114 166 108 178 100 192C92 178 86 166 82 146Z', K.orange) + P('M92 146H108C106 160 104 168 100 178C96 168 94 160 92 146Z', K.yellow), 'rotate(0)'));
  VH('hot_air_balloon', t => SH(100, 30) + P('M100 14C60 14 34 46 38 82C42 108 64 128 80 140H120C136 128 158 108 162 82C166 46 140 14 100 14Z', t.a) + P('M100 14C82 24 74 50 76 82C78 110 90 130 98 140H102C110 130 122 110 124 82C126 50 118 24 100 14Z', t.acc) + P('M100 14C90 24 88 50 90 82C92 110 96 130 98 140H102C104 130 108 110 110 82C112 50 110 24 100 14Z', t.light, ' opacity=".5"') + S('M80 140L86 160M120 140L114 160', K.ink, 3) + R(84, 158, 32, 22, K.wood, 4) + R(84, 158, 32, 6, K.lwood, 2));
  VH('submarine', t => SH(100, 40) + R(60, 44, 40, 34, t.b, 8) + R(76, 30, 6, 18, t.ink) + R(76, 30, 18, 5, t.ink) + E(100, 110, 84, 44, t.acc) + P('M18 96L4 84V136L18 124Z', t.a) + [70, 100, 130].map(x => C(x, 108, 11, K.sky, ` stroke="${t.ink}" stroke-width="4"`)).join('') + [[40, 60, 6], [30, 44, 4], [50, 40, 5]].map(b => C(b[0] - 20, b[1], b[2], 'none', ` stroke="${t.c}" stroke-width="2.5"`)).join(''));
  VH('tractor', t => SH(100, 80) + C(58, 134, 34, K.ink) + C(58, 134, 20, K.orange) + C(58, 134, 6, K.ink) + C(158, 148, 22, K.ink) + C(158, 148, 10, K.orange) + P('M88 72H128C134 72 138 78 140 86L146 118H88Z', t.a) + P('M96 78H124L130 100H96Z', K.sky) + R(84, 100, 100, 32, t.a, 6) + R(150, 96, 6, 22, K.ink) + R(26, 40, 40, 6, K.ink, 3) + R(44, 44, 4, 24, K.ink));
  VH('ambulance', t => SH(100, 88) + R(12, 56, 130, 82, '#ffffff', 8) + P('M142 78H166C174 78 180 84 184 92L192 106V138H142Z', '#ffffff') + P('M152 86H166L178 104H152Z', K.sky) + R(12, 108, 180, 10, K.red) + R(80, 66, 12, 34, K.red) + R(69, 77, 34, 12, K.red) + R(60, 42, 30, 10, K.red, 4) + wheel(52, 140, 18, t) + wheel(156, 140, 18, t));
  VH('fire_truck', t => SH(100, 88) + R(10, 60, 130, 76, K.red, 6) + P('M140 80H166C174 80 180 86 184 94L192 108V136H140Z', K.red) + P('M150 88H166L178 106H150Z', K.sky) + G(R(20, 32, 100, 8, K.lgray, 3) + R(20, 32, 6, 30, K.metal) + R(112, 32, 6, 30, K.metal), 'translate(0 8)') + S('M22 52L118 52M40 40V60M60 40V60M80 40V60M100 40V60', K.lgray, 3) + R(10, 110, 182, 8, K.yellow) + wheel(48, 140, 18, t) + wheel(96, 140, 18, t) + wheel(156, 140, 18, t));
  VH('taxi', t => SH(100, 80) + PG('82,50 118,50 112,62 88,62', K.yellow) + `<text x="100" y="60" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="9" fill="#111">TAXI</text>` + P('M14 124C14 108 26 104 40 100L62 72C68 66 76 62 86 62H128C138 62 146 66 154 76L168 100C182 102 188 110 188 124V136H14Z', K.yellow) + P('M70 78H98V100H54Z', K.sky) + P('M106 78H130C136 78 140 82 144 88L152 100H106Z', K.sky) + S('M20 118H182', K.ink, 3, ' stroke-dasharray="10 8"') + wheel(56, 138, 20, t) + wheel(146, 138, 20, t));
  VH('ufo', t => SH(100, 30) + P('M74 92C74 60 126 60 126 92Z', K.sky) + E(100, 104, 82, 24, t.a) + E(100, 98, 74, 16, t.b) + [30, 64, 100, 136, 170].map((x, i) => C(x, 104, 5, i % 2 ? K.yellow : t.light)).join('') + PG('70,118 130,118 156,186 44,186', K.yellow, ' opacity=".25"') + C(100, 74, 6, t.c, ' opacity=".7"'));
  VH('tram', t => SH(100, 84) + R(16, 54, 168, 84, t.a, 16) + [0, 1, 2, 3].map(i => R(30 + i * 38, 66, 26, 30, K.sky, 4)).join('') + R(16, 100, 168, 6, t.light, 0, ' opacity=".6"') + S('M100 30V54', K.ink, 4) + PG('92,30 108,30 100,20', t.ink) + wheel(50, 140, 16, t) + wheel(150, 140, 16, t) + R(30, 150, 20, 4, t.ink, 2) + R(150, 150, 20, 4, t.ink, 2));
  VH('jeep', t => SH(100, 80) + R(20, 84, 150, 46, t.a, 6) + R(30, 46, 120, 40, t.b, 8) + R(40, 54, 46, 30, K.sky, 3) + R(94, 54, 46, 30, K.sky, 3) + R(16, 88, 12, 30, t.ink, 3) + R(160, 88, 14, 30, t.ink, 3) + R(20, 110, 150, 8, '#000', 0, ' opacity=".12"') + wheel(56, 140, 20, t) + wheel(146, 140, 20, t) + R(24, 60, 6, 30, t.ink, 2));
  VH('canoe', t => SH(100, 30) + P('M10 108C40 96 160 96 190 108C170 128 30 128 10 108Z', t.a) + P('M10 108C40 118 160 118 190 108', 'none', ` stroke="${t.b}" stroke-width="3"`) + S('M60 70L60 100M140 70L140 100', t.ink, 4) + PG('56,66 64,66 60,54', t.ink) + PG('136,66 144,66 140,54', t.ink) + P('M0 128C30 118 170 118 200 128V140H0Z', t.c, ' opacity=".7"'));
  VH('jet_ski', t => SH(100, 80) + P('M20 118C24 92 56 78 96 78C132 78 160 92 172 112C182 106 190 108 188 118C184 132 160 138 130 136C100 150 50 148 30 132C18 130 16 124 20 118Z', t.acc) + R(46, 60, 28, 26, t.a, 8) + R(66, 66, 16, 10, K.sky, 2) + S('M96 108C110 104 120 104 130 110', t.ink, 3) + P('M0 138C30 128 170 128 200 138V150H0Z', t.c, ' opacity=".7"'));
  VH('cable_car', t => SH(100, 60) + S('M4 24L196 76', t.ink, 3) + S('M40 34L60 66M160 62L140 44', t.ink, 3) + P('M60 66H140L156 108C156 118 148 124 138 124H62C52 124 44 118 44 108Z', t.a) + R(66, 58, 68, 12, t.b, 4) + [80, 120].map(x => R(x - 12, 82, 24, 22, K.sky, 3)).join('') + R(84, 118, 32, 8, t.ink, 3));

  // ----- v3 new vehicles -----
  VH('ferry', t => SH(100, 74) + P('M6 130H194L172 178H28Z', t.a) + R(6, 122, 188, 10, t.light, 3) + R(40, 80, 120, 42, '#fff', 4) + R(56, 90, 18, 20, K.sky, 2) + R(86, 90, 18, 20, K.sky, 2) + R(116, 90, 18, 20, K.sky, 2) + R(142, 62, 40, 22, t.b, 3) + C(172, 74, 5, K.yellow) + C(28, 74, 5, K.red));
  VH('cruise_ship', t => SH(100, 60) + P('M6 140H194L176 178H24Z', t.light) + R(6, 132, 188, 10, t.a, 3) + R(28, 92, 144, 40, '#fff', 4) + [44, 72, 100, 128, 156].map(x => R(x - 8, 100, 16, 22, K.sky, 2)).join('') + R(40, 68, 120, 24, '#fff', 4) + R(60, 60, 80, 12, t.b, 3) + R(70, 40, 60, 22, '#fff', 3) + R(96, 20, 20, 20, t.a, 3));
  VH('rowboat', t => SH(100, 46) + P('M14 118C30 106 170 106 186 118C172 142 30 142 14 118Z', '#c58b55') + P('M14 118C30 128 170 128 186 118', 'none', ` stroke="${t.b}" stroke-width="3"`) + S('M52 82L52 118M148 82L148 118', t.ink, 4) + PG('48,80 56,80 52,68', t.ink) + PG('144,80 152,80 148,68', t.ink) + S('M96 116L108 132M116 116L104 132', '#8a5a36', 3));
  VH('kayak', t => SH(100, 40) + P('M6 118C40 108 160 108 194 118C180 132 20 132 6 118Z', K.red) + P('M6 118C40 122 160 122 194 118', 'none', ` stroke="${t.ink}" stroke-width="2"`) + E(60, 116, 10, 4, t.ink) + E(140, 116, 10, 4, t.ink) + S('M100 90L100 130', '#c58b55', 4) + E(100, 90, 12, 4, '#c58b55') + E(100, 130, 12, 4, '#c58b55'));
  VH('limousine', t => SH(100, 84) + P('M8 138C8 120 20 114 36 110L56 90C64 82 78 78 90 78H150C166 78 178 86 184 100L192 116C196 120 196 128 196 134V140H8Z', t.ink) + P('M66 94H100V118H52Z', K.sky) + P('M106 94H150C160 94 168 100 174 108L180 118H106Z', K.sky) + S('M60 130H180', t.dmetal, 2) + wheel(50, 140, 18, t) + wheel(96, 140, 18, t) + wheel(154, 140, 18, t));
  VH('camper_van', t => SH(100, 84) + R(10, 76, 160, 76, t.b, 8) + P('M170 76H186C190 76 194 80 194 86V132H170Z', t.b) + R(24, 90, 34, 30, K.sky, 3) + R(66, 90, 34, 30, K.sky, 3) + R(140, 84, 30, 52, K.sky, 3) + R(10, 116, 184, 6, t.light, 2, ' opacity=".6"') + R(40, 34, 100, 44, t.d, 4) + wheel(46, 152, 16, t) + wheel(146, 152, 16, t));
  VH('pickup_truck', t => SH(100, 80) + R(10, 80, 100, 72, t.a, 8) + R(30, 44, 76, 38, t.a, 8) + R(38, 52, 60, 30, K.sky, 3) + P('M110 92H194V152H110Z', t.a) + R(110, 92, 84, 10, t.light, 3, ' opacity=".5"') + R(10, 140, 184, 6, '#000', 2, ' opacity=".15"') + wheel(46, 152, 18, t) + wheel(156, 152, 18, t));
  VH('formula_one', t => SH(100, 84) + P('M6 132C6 124 22 118 60 116L100 100C130 98 160 100 184 106C194 110 198 116 198 124V132H6Z', t.acc) + P('M100 100C120 98 140 100 160 104L156 116H100Z', K.sky) + P('M100 104L96 82H132L140 104Z', t.a) + P('M6 128H60L70 132H14Z', '#2b2f3a') + wheel(54, 136, 20, t) + wheel(150, 136, 20, t) + R(180, 110, 12, 6, K.yellow, 2));
  VH('glider', t => SH(100, 40) + G(P('M8 110C8 100 24 96 60 96L120 96C150 96 180 100 186 110C180 116 150 120 120 120H60C24 120 8 116 8 110Z', t.light) + P('M90 96L100 40L110 96Z', t.b) + P('M60 96L80 70L96 96Z', t.a) + P('M140 96L120 70L104 96Z', t.a) + C(100, 40, 4, t.acc), 'rotate(-12 100 100)'));
  VH('seaplane', t => SH(100, 60) + P('M14 110C14 96 30 90 60 92L138 92C168 92 186 100 186 110C186 118 168 124 138 124L60 124C30 126 14 118 14 110Z', t.light) + P('M92 100L120 40H140L124 100Z', t.a) + P('M96 110L130 168H150L130 110Z', t.a) + R(16, 96, 30, 22, t.b, 6) + [0, 1, 2, 3, 4].map(i => C(64 + i * 12, 108, 3, K.sky)).join('') + R(16, 128, 60, 8, t.a, 3) + R(124, 128, 60, 8, t.a, 3));
  VH('segway', t => SH(100, 60) + R(20, 140, 60, 12, t.dmetal, 6) + R(120, 140, 60, 12, t.dmetal, 6) + C(50, 152, 18, K.ink) + C(150, 152, 18, K.ink) + C(50, 152, 8, K.metal) + C(150, 152, 8, K.metal) + R(88, 60, 24, 90, t.metal, 4) + S('M100 60L100 40', t.metal, 4) + R(80, 30, 40, 12, t.ink, 4));

  // ---------- CHARACTERS ----------
  const CHR = {}, CHR_LIST = [];
  const ROLE = (n, spec) => { CHR[n] = spec; CHR_LIST.push(n); };
  ROLE('casual', { shirt: t => t.b, pants: t => t.a });
  ROLE('student', { shirt: t => t.c, pants: t => t.a, prop: (t) => R(52, 100, 16, 46, t.acc, 6) + R(132, 100, 16, 46, t.acc, 6) + R(56, 110, 8, 14, t.ink, 3, ' opacity=".25"') });
  ROLE('teacher', { shirt: t => t.a, pants: t => t.ink, over: t => S('M100 88V150', t.light, 3, ' opacity=".5"'), prop: t => G(R(-2, -60, 4, 120, K.wood, 2), 'translate(158 150) rotate(-18)') });
  ROLE('doctor', { shirt: t => '#ffffff', pants: t => t.a, over: (t) => R(66, 84, 68, 90, '#fff', 14) + S('M86 88L100 122L114 88', t.ink, 2, ' opacity=".2"'), prop: t => S('M84 92C84 116 116 116 116 92', t.ink, 4) + C(100, 128, 5, t.metal || K.metal) + R(120, 130, 10, 12, t.a, 2) + R(123, 133, 4, 6, '#fff') });
  ROLE('nurse', { shirt: t => t.c, pants: t => t.c, hat: t => R(78, 20, 44, 14, '#fff', 4) + R(96, 22, 8, 10, K.red, 1) + R(94, 24, 12, 6, K.red, 1), prop: t => S('M84 92C84 114 116 114 116 92', '#fff', 3, ' opacity=".9"') + R(112, 116, 14, 14, '#fff', 3) + R(117, 119, 4, 8, K.red) + R(114, 121, 10, 4, K.red) });
  ROLE('engineer', { shirt: t => t.b, pants: t => t.ink, over: t => R(66, 120, 68, 8, K.yellow, 0, ' opacity=".9"') + R(66, 138, 68, 6, K.yellow, 0, ' opacity=".9"'), hat: t => P('M70 44C70 20 130 20 130 44Z', K.yellow) + R(64, 42, 72, 8, '#eab308', 4) + R(96, 20, 8, 22, '#eab308', 2), prop: t => R(140, 132, 30, 22, '#e0f2fe', 2, ` stroke="${t.ink}" stroke-width="2"`) + S('M146 140H164M146 146H158', t.a, 2) });
  ROLE('scientist', { shirt: t => '#ffffff', pants: t => t.ink, over: t => R(64, 84, 72, 100, '#fff', 14) + R(94, 88, 12, 96, t.light, 0, ' opacity=".4"'), prop: t => P('M154 138H178L180 166C180 172 152 172 152 166Z', K.lgreen, ' opacity=".9"') + R(160, 128, 12, 12, '#eef2f7', 2) + C(166, 158, 3, '#fff', ' opacity=".7"') + C(88, 50, 9, 'none', ` stroke="${t.ink}" stroke-width="2.5"`) + C(112, 50, 9, 'none', ` stroke="${t.ink}" stroke-width="2.5"`) + S('M97 50H103', t.ink, 2.5) });
  ROLE('chef', { shirt: t => '#ffffff', pants: t => t.ink, over: t => S('M80 96L120 146M120 96L80 146', t.d, 3, ' opacity=".5"') + C(92, 112, 3, t.c) + C(108, 112, 3, t.c), hat: t => R(76, 26, 48, 22, '#fff', 4) + C(80, 24, 15, '#fff') + C(100, 16, 17, '#fff') + C(120, 24, 15, '#fff'), prop: t => C(160, 150, 16, t.metal || K.metal) + R(174, 148, 22, 6, K.dbrown, 3) });
  ROLE('farmer', { shirt: t => '#e8f0ff', pants: t => '#3b6fd4', over: t => R(74, 100, 52, 74, '#3b6fd4', 8) + R(78, 88, 8, 16, '#3b6fd4') + R(114, 88, 8, 16, '#3b6fd4') + C(82, 108, 3, K.gold) + C(118, 108, 3, K.gold), hat: t => E(100, 42, 52, 10, '#e6c26e') + P('M76 42C76 20 124 20 124 42Z', '#e6c26e') + R(76, 34, 48, 5, K.red), prop: t => S('M164 96V204', K.wood, 5) + S('M154 100H174M156 100V112M164 100V112M172 100V112', K.metal, 3) });
  ROLE('businessperson', { shirt: t => '#ffffff', pants: t => t.ink, over: t => R(66, 84, 68, 90, t.a, 14) + PG('100,90 88,88 100,118 112,88', '#fff') + PG('100,96 95,104 100,146 105,104', t.acc), prop: t => R(140, 150, 44, 32, K.dbrown, 5) + R(154, 144, 16, 8, K.dbrown, 3) + R(158, 156, 8, 6, K.gold, 2) });
  ROLE('developer', { shirt: t => t.a, pants: t => t.ink, prop: t => G(R(-26, -18, 52, 34, t.light, 3, ` stroke="${t.ink}" stroke-width="3"`) + R(-30, 16, 60, 6, t.metal || K.metal, 3) + C(0, 0, 5, t.b), 'translate(100 146)') });
  ROLE('designer', { shirt: t => t.e, pants: t => t.ink, prop: t => G(R(-2, -30, 4, 60, t.ink, 2) + P('M-4 30H4L0 44Z', t.acc), 'translate(158 150) rotate(20)') + C(58, 150, 16, t.light, ` stroke="${t.ink}" stroke-width="2"`) + C(52, 146, 4, K.red) + C(62, 144, 4, K.blue) + C(60, 156, 4, K.yellow) });
  ROLE('artist', { shirt: t => t.c, pants: t => t.ink, over: t => R(70, 100, 60, 74, '#fff', 8, ' opacity=".7"') + C(86, 130, 5, K.red) + C(112, 118, 5, K.blue) + C(102, 148, 5, K.yellow), hat: t => P('M68 44C68 20 128 14 134 40C120 34 90 34 68 44Z', t.a) + C(100, 20, 5, t.a), prop: t => P('M150 130C164 122 184 130 184 146C184 160 168 164 158 158C152 154 158 146 152 142Z', '#f3d9b1') + C(160, 136, 4, K.red) + C(172, 140, 4, K.blue) + C(170, 152, 4, K.green) });
  ROLE('athlete', { shirt: t => t.a, pants: t => t.ink, over: t => `<text x="100" y="134" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="28" fill="#fff">7</text>`, hat: t => R(72, 30, 56, 8, t.acc, 4), prop: t => C(164, 218, 14, '#fff', ` stroke="${K.ink}" stroke-width="3"`) + PG('164,208 172,214 169,224 159,224 156,214', K.ink) });
  ROLE('astronaut', { shirt: t => '#f1f5f9', pants: t => '#f1f5f9', over: t => R(84, 104, 32, 30, t.a, 6) + C(94, 118, 4, K.red) + C(106, 118, 4, K.green), hat: t => C(100, 50, 40, '#f1f5f9', ` stroke="${t.c}" stroke-width="5"`) + R(74, 36, 52, 32, t.ink, 14) + S('M82 44C90 40 100 40 106 42', '#fff', 3, ' opacity=".6"'), prop: t => R(52, 96, 16, 50, t.metal || K.metal, 6) + R(132, 96, 16, 50, K.metal, 6), hairless: true, faceHidden: true });
  ROLE('pilot', { shirt: t => '#ffffff', pants: t => t.ink, over: t => R(66, 84, 68, 90, t.a, 14) + PG('100,90 90,88 100,110 110,88', '#fff') + R(78, 104, 12, 5, K.gold, 1) + R(78, 112, 12, 5, K.gold, 1), hat: t => P('M70 38C70 18 130 18 130 38Z', t.a) + R(66, 36, 68, 8, t.ink, 4) + C(100, 30, 4, K.gold) });
  ROLE('police', { shirt: t => t.a, pants: t => t.ink, over: t => R(66, 118, 68, 8, t.ink) + R(94, 116, 12, 12, K.gold, 2) + PG('108,96 118,96 116,112 108,112', K.gold), hat: t => P('M70 40C70 18 130 18 130 40Z', t.ink) + R(64, 38, 72, 8, t.ink, 4) + C(100, 30, 5, K.gold) });
  ROLE('firefighter', { shirt: t => K.red, pants: t => t.ink, over: t => R(66, 122, 68, 10, K.yellow) + R(66, 144, 68, 10, K.yellow), hat: t => P('M68 42C68 16 132 16 132 42Z', K.yellow) + R(60, 40, 80, 8, '#eab308', 4) + R(92, 26, 16, 14, K.red, 3), prop: t => R(150, 150, 40, 12, K.red, 6) + S('M190 156C198 156 198 170 190 170', K.metal, 4) });
  ROLE('worker', { shirt: t => K.orange, pants: t => t.ink, over: t => R(66, 84, 68, 90, K.orange, 14) + R(66, 118, 68, 8, '#e5e7eb', 0, ' opacity=".9"') + R(66, 144, 68, 8, '#e5e7eb', 0, ' opacity=".9"'), hat: t => P('M70 44C70 20 130 20 130 44Z', '#fff') + R(64, 42, 72, 8, '#e5e7eb', 4), prop: t => G(R(-3, -24, 6, 48, K.wood, 2) + R(-14, -30, 28, 14, K.metal, 3), 'translate(160 150) rotate(30)') });
  ROLE('musician', { shirt: t => t.e, pants: t => t.ink, prop: t => G(P('M0 0C-14 -6 -24 8 -18 20C-30 26 -28 44 -14 48C0 52 14 44 12 30C22 22 14 6 0 0Z', t.acc) + C(-6, 26, 6, t.ink) + R(-3, -50, 6, 50, '#5b3a22', 2), 'translate(150 176) rotate(-30)') });
  ROLE('traveler', { shirt: t => t.e, pants: t => t.ink, hat: t => E(100, 42, 54, 9, K.lwood) + P('M76 42C76 24 124 24 124 42Z', K.lwood) + R(76, 36, 48, 5, t.a), prop: t => R(140, 96, 34, 60, t.a, 12) + R(146, 110, 22, 24, t.b, 6) + R(140, 96, 34, 10, '#000', 0, ' opacity=".1"') + S('M150 96V88C150 82 164 82 164 88V96', t.ink, 3) });
  ROLE('gardener', { shirt: t => '#e7f7d4', pants: t => '#5b8a3a', over: t => R(72, 108, 56, 66, '#8a5a36', 6, ' opacity=".9"'), hat: t => E(100, 42, 52, 10, '#e6c26e') + P('M76 42C76 20 124 20 124 42Z', '#e6c26e') + R(76, 34, 48, 5, K.green), prop: t => P('M148 148H180L174 178H154Z', t.a) + S('M164 148V128C152 128 150 112 160 108C166 104 172 112 164 128', K.green, 5) + C(164, 104, 8, t.acc) });
  ROLE('mechanic', { shirt: t => t.b, pants: t => t.ink, over: t => R(66, 84, 68, 90, t.b, 14) + R(90, 100, 20, 16, t.a, 3) + S('M100 88V120', t.light, 2, ' opacity=".6"'), hat: t => R(70, 30, 60, 14, t.a, 6) + R(120, 40, 24, 6, t.a, 3), prop: t => G(R(-3, -30, 6, 60, K.metal, 2) + P('M-10 -30C-10 -44 10 -44 10 -30L4 -22H-4Z', K.metal), 'translate(160 152) rotate(25)') });
  ROLE('photographer', { shirt: t => t.c, pants: t => t.ink, over: t => S('M84 90L112 140', t.ink, 3), prop: t => R(112, 112, 46, 30, K.ink, 6) + C(135, 127, 11, K.dmetal) + C(135, 127, 6, K.sky) + R(120, 106, 16, 8, K.ink, 2) + C(148, 118, 2.5, K.red) });
  ROLE('writer', { shirt: t => t.d, pants: t => t.a, over: t => S('M100 88V150', t.b, 3, ' opacity=".4"'), prop: t => G(R(-20, -26, 40, 52, t.a, 4) + R(-16, -22, 34, 48, '#fff', 3) + S('M-8 -10H10M-8 0H10M-8 10H2', t.b, 3), 'translate(148 146) rotate(8)') + G(R(-2, -20, 4, 40, t.acc, 2), 'translate(174 128) rotate(30)') });
  ROLE('waiter', { shirt: t => '#ffffff', pants: t => t.ink, over: t => PG('100,90 84,88 100,104 116,88', t.ink) + C(100, 116, 3, t.ink) + C(100, 132, 3, t.ink), prop: t => E(150, 96, 30, 6, K.metal) + R(148, 98, 4, 10, K.metal) + P('M138 92C138 80 162 80 162 92Z', '#fff') + R(146, 74, 8, 8, t.acc, 2) });
  ROLE('graduate', { shirt: t => t.ink, pants: t => t.ink, over: t => R(66, 84, 68, 100, t.ink, 14) + PG('100,88 92,88 100,150 108,88', t.acc, ' opacity=".8"'), hat: t => PG('100,16 148,34 100,52 52,34', t.ink) + R(78, 34, 44, 14, t.ink, 3) + S('M144 36V60', t.acc, 3) + C(144, 62, 4, t.acc), prop: t => G(R(-6, -20, 12, 40, '#fff', 3) + R(-6, -8, 12, 4, K.red), 'translate(158 150) rotate(60)') });
  ROLE('king', { shirt: t => K.red, pants: t => t.ink, over: t => R(60, 84, 80, 104, K.red, 16) + P('M60 92H140V106H60Z', '#fff') + [66, 78, 90, 102, 114, 126].map(x => C(x, 99, 2.4, K.ink)).join(''), hat: t => P('M74 40L78 16L90 30L100 10L110 30L122 16L126 40Z', K.gold) + R(74, 38, 52, 8, K.gold, 2) });

  // ----- v3 new roles -----
  ROLE('barista', { shirt: t => '#2b2f3a', pants: t => t.a, over: t => R(66, 84, 68, 100, '#2b2f3a', 14) + PG('100,90 84,88 100,104 116,88', '#fff') + R(66, 148, 68, 8, t.acc), prop: t => R(146, 130, 34, 50, '#fff', 6) + R(152, 138, 22, 12, '#5b3a22', 3) + S('M180 140H190C196 140 196 152 190 152H180', '#fff', 3) + S('M154 116C148 106 158 100 152 90M168 116C162 106 172 100 166 90', t.c, 3) });
  ROLE('florist', { shirt: t => '#7dd3fc', pants: t => '#f9a8d4', over: t => R(66, 84, 68, 100, '#7dd3fc', 14) + C(80, 120, 4, '#f472b6') + C(120, 140, 4, '#f472b6'), prop: t => R(146, 138, 32, 50, t.c, 6) + S('M158 138V120C148 120 144 106 154 102C160 98 168 104 162 120', '#3fb56b', 5) + C(162, 98, 8, t.acc) + C(154, 108, 6, '#fff') });
  ROLE('baker', { shirt: t => '#fff', pants: t => '#a9714b', over: t => R(66, 84, 68, 100, '#fff', 14) + R(66, 118, 68, 8, '#a9714b') + C(84, 108, 3, '#fbbf24'), hat: t => R(74, 28, 52, 22, '#fff', 4) + C(78, 26, 15, '#fff') + C(100, 18, 17, '#fff') + C(122, 26, 15, '#fff'), prop: t => R(140, 130, 44, 44, '#e0a96d', 6) + S('M146 138H178M146 146H178M146 154H178', '#8a5a36', 3) });
  ROLE('veterinarian', { shirt: t => '#fff', pants: t => t.b, over: t => R(66, 84, 68, 100, '#fff', 14) + S('M100 88V140', '#e5e7eb', 3, ' opacity=".5"') + C(84, 120, 3, t.acc), prop: t => '' });
  ROLE('detective', { shirt: t => '#8a5a36', pants: t => '#3b2a1a', over: t => R(66, 84, 68, 100, '#8a5a36', 14) + R(72, 96, 56, 8, '#3b2a1a') + PG('100,90 88,88 100,118 112,88', '#fff'), hat: t => E(100, 42, 60, 9, '#3b2a1a') + P('M74 42C74 20 126 20 126 42Z', '#3b2a1a') + R(74, 34, 52, 5, '#2b1a14'), prop: t => G(C(0, 0, 22, 'none', ` stroke="${t.ink}" stroke-width="4"`) + C(0, 0, 16, t.light, ' opacity=".35"') + R(-3, 22, 6, 34, t.ink, 3), 'translate(158 130) rotate(-30)') });
  ROLE('explorer', { shirt: t => '#d9a86b', pants: t => '#5b3a22', over: t => R(66, 84, 68, 100, '#d9a86b', 14) + R(66, 118, 68, 8, '#5b3a22') + R(66, 140, 68, 6, '#5b3a22') + C(84, 108, 3, K.gold), hat: t => E(100, 42, 56, 9, '#a9714b') + P('M76 42C76 20 124 20 124 42Z', '#a9714b') + R(76, 34, 48, 5, '#5b3a22'), prop: t => C(160, 128, 22, t.acc) + C(160, 128, 14, t.light) + S('M160 128L172 116', t.ink, 3) });
  ROLE('yogi', { shirt: t => '#7dd3fc', pants: t => '#5b8a3a', over: t => R(66, 84, 68, 100, '#7dd3fc', 14) + PG('100,92 92,92 100,140 108,92', '#fff', ' opacity=".5"'), prop: t => C(160, 218, 20, '#c58b55', ` stroke="#8a5a36" stroke-width="3"`) + C(160, 218, 10, '#8a5a36') });
  ROLE('dancer', { shirt: t => '#f9a8d4', pants: t => '#2b2f3a', over: t => R(66, 84, 68, 100, '#f9a8d4', 14) + PG('100,90 80,90 100,150 120,90', '#fbc4dc') });
  ROLE('dj', { shirt: t => '#2b2f3a', pants: t => '#1a1a24', over: t => R(66, 84, 68, 100, '#2b2f3a', 14) + C(80, 120, 4, t.acc) + C(120, 140, 4, t.acc), hat: t => E(100, 42, 60, 9, '#1a1a24') + P('M74 42C74 24 126 24 126 42Z', '#1a1a24'), prop: t => S('M52 92C40 60 44 30 52 20', '#2b2f3a', 5) + S('M148 92C160 60 156 30 148 20', '#2b2f3a', 5) + C(52, 18, 12, t.acc) + C(148, 18, 12, t.acc) });
  ROLE('journalist', { shirt: t => t.a, pants: t => '#2b2f3a', over: t => R(66, 84, 68, 100, t.a, 14) + R(70, 96, 60, 8, '#fff', 0, ' opacity=".4"'), prop: t => G(R(-22, -26, 44, 52, '#fff', 4) + S('M-16 -18H16M-16 -8H16M-16 2H4M-16 12H16', t.ink, 2) + R(-6, 30, 12, 6, t.acc, 2), 'translate(160 130) rotate(-10)') });
  ROLE('librarian', { shirt: t => t.d, pants: t => '#4a3560', over: t => R(66, 84, 68, 100, t.d, 14) + C(84, 110, 3, t.a), prop: t => R(146, 130, 32, 50, t.a, 4) + R(150, 138, 24, 34, t.b, 2) + S('M156 146H170M156 156H166', t.light, 3) });
  ROLE('knight', { shirt: t => '#9aa7b4', pants: t => '#64748b', over: t => R(66, 84, 68, 100, '#9aa7b4', 14) + R(66, 118, 68, 8, '#64748b') + PG('100,90 90,90 100,118 110,90', '#fff') + C(84, 108, 4, K.gold) + C(116, 108, 4, K.gold), hat: t => P('M64 56C64 20 136 20 136 56V64H64Z', '#9aa7b4') + R(72, 42, 56, 14, '#2b2f3a') + S('M96 46H104', K.gold, 3), prop: t => G(P('M-4 -26L4 -26V20H-4Z', t.light) + R(-10, 20, 20, 4, K.gold) + R(-3, 24, 6, 20, '#8a5a36') + E(0, 48, 6, 3, K.gold), 'translate(160 140) rotate(20)') });

  const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'bald', 'ponytail', 'afro', 'bob'];

  function hairBack(style, h) {
    switch (style) {
      case 'long': return R(66, 34, 68, 110, h, 30);
      case 'ponytail': return P('M126 40C160 40 170 80 156 120C150 100 140 80 128 70Z', h);
      case 'afro': return C(100, 42, 52, h);
      case 'bob': return R(66, 34, 68, 62, h, 28);
      default: return '';
    }
  }
  function hairFront(style, h) {
    const cap = P('M70 50C68 24 86 16 102 16C122 16 132 30 130 50C120 42 112 38 100 38C86 40 78 42 70 50Z', h);
    switch (style) {
      case 'bald': return '';
      case 'bun': return C(100, 16, 15, h) + cap;
      case 'curly': return [[74, 32], [90, 22], [110, 22], [126, 32], [70, 48], [130, 48]].map(p => C(p[0], p[1], 14, h)).join('');
      case 'afro': return P('M68 52C64 22 136 22 132 52C120 42 112 38 100 38C86 40 78 42 68 52Z', h);
      case 'long': case 'bob': return P('M68 56C62 22 138 22 132 56C126 44 112 38 100 36C84 38 74 46 68 56Z', h);
      default: return cap;
    }
  }
  function arms(pose, sleeve, skin) {
    const arm = (d, hx, hy) => S(d, sleeve, 15) + C(hx, hy, 8, skin);
    switch (pose) {
      case 'wave': return arm('M68 98C52 116 50 140 54 158', 54, 162) + arm('M132 98C152 92 162 72 160 52', 160, 46);
      case 'point': return arm('M68 98C52 116 50 140 54 158', 54, 162) + arm('M132 98C156 100 172 98 186 92', 190, 91);
      case 'hold': return arm('M68 98C62 122 76 144 96 148', 100, 148) + arm('M132 98C138 122 124 144 104 148', 100, 148);
      case 'cheer': return arm('M68 98C50 84 44 64 48 46', 48, 40) + arm('M132 98C150 84 156 64 152 46', 152, 40);
      default: return arm('M68 98C52 116 50 140 54 158', 54, 162) + arm('M132 98C148 116 150 140 146 158', 146, 162);
    }
  }
  function drawCharacter(t, o) {
    const role = CHR[o.role] ? o.role : 'casual';
    const sp = CHR[role];
    const skin = SKINS[o.skin] || SKINS.light;
    const hairC = HAIRS[o.haircolor] || HAIRS[o.hair && HAIRS[o.hair] ? o.hair : 'darkbrown'];
    const style = HAIR_STYLES.indexOf(o.style) >= 0 ? o.style : (o.gender === 'f' ? 'long' : 'short');
    const shirt = sp.shirt(t), pants = sp.pants(t);
    const pose = o.pose || 'stand';
    let out = SH(100, 52);
    out += R(76, 164, 22, 82, pants, 8) + R(102, 164, 22, 82, pants, 8) + E(84, 248, 20, 8, K.ink) + E(116, 248, 20, 8, K.ink);
    if (sp.hairless === undefined) out += hairBack(style, hairC);
    out += R(66, 84, 68, 90, shirt, 22);
    if (sp.over) out += sp.over(t, shirt);
    out += R(92, 68, 16, 22, skin);
    out += arms(pose, shirt === '#ffffff' ? '#ffffff' : (role === 'doctor' || role === 'scientist' ? '#ffffff' : shirt), skin);
    if (role === 'doctor' || role === 'scientist') out += S('M68 98C52 116 50 140 54 158', '#fff', 15) + C(54, 162, 8, skin);
    out += C(100, 52, 28, skin);
    if (!sp.faceHidden) {
      out += E(72, 56, 4, 6, skin) + E(128, 56, 4, 6, skin);
      out += C(90, 52, 3, K.ink) + C(110, 52, 3, K.ink) + S('M92 64C96 69 104 69 108 64', K.ink, 2.5) + E(84, 62, 5, 3, '#f472b6', ' opacity=".3"') + E(116, 62, 5, 3, '#f472b6', ' opacity=".3"');
    }
    if (!sp.hairless && !sp.faceHidden) out += hairFront(style, hairC);
    if (sp.hat) out += sp.hat(t, shirt);
    if (sp.prop) out += sp.prop(t, shirt);
    if (o.accessory === 'glasses') out += C(90, 52, 9, 'none', ` stroke="${K.ink}" stroke-width="2.5"`) + C(110, 52, 9, 'none', ` stroke="${K.ink}" stroke-width="2.5"`) + S('M99 52H101', K.ink, 2.5);
    return out;
  }
  _ilExt.drawCharacter = drawCharacter;

  // ---------- SPOT-ILLUSTRATION RENDERERS ----------
  function themeOf(params, fallback) {
    return _ilResolveTheme(params.palette, fallback || 'ocean');
  }
  function spotBackdrop(t, params, w, h, uid, seed) {
    const mode = String(params.bg || params.backdrop || 'gradient').toLowerCase();
    if (mode === 'none' || mode === 'transparent') return { defs: '', body: '' };
    const gid = 'sb_' + uid;
    const defs = `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${t.bg[0]}"/><stop offset="100%" stop-color="${t.bg[1]}"/></linearGradient>`;
    let body = mode === 'solid' ? R(0, 0, w, h, t.bg[0]) : R(0, 0, w, h, `url(#${gid})`);
    const r = rng(seed);
    if (mode === 'blob') body += P(`M${w * .5} ${h * .1}C${w * .82} ${h * .06} ${w * .96} ${h * .38} ${w * .88} ${h * .66}C${w * .8} ${h * .92} ${w * .4} ${h * .98} ${w * .18} ${h * .78}C${w * .0} ${h * .58} ${w * .1} ${h * .16} ${w * .5} ${h * .1}Z`, t.light, ' opacity=".6"');
    else if (mode === 'circle') body += C(w / 2, h / 2, Math.min(w, h) * 0.42, t.light, ' opacity=".6"');
    else if (mode === 'rings') body += C(w / 2, h / 2, w * .44, 'none', ` stroke="${t.light}" stroke-width="4" opacity=".6"`) + C(w / 2, h / 2, w * .34, 'none', ` stroke="${t.light}" stroke-width="4" opacity=".4"`);
    else if (mode === 'dots') { for (let i = 0; i < 26; i++) body += C(r() * w, r() * h, 2 + r() * 4, t.c, ' opacity=".35"'); body += C(w / 2, h / 2, Math.min(w, h) * .38, t.light, ' opacity=".5"'); }
    else { body += C(w / 2, h * 0.52, Math.min(w, h) * 0.4, t.light, ' opacity=".5"') + C(w * .14, h * .16, 9, t.c, ' opacity=".35"') + C(w * .88, h * .2, 6, t.acc, ' opacity=".5"') + C(w * .84, h * .84, 12, t.c, ' opacity=".25"') + C(w * .1, h * .8, 5, t.a, ' opacity=".25"'); }
    return { defs, body };
  }
  function spotRenderer(getFn) {
    return function (params) {
      const t = themeOf(params, 'ocean');
      const uid = _ilUid(), w = 240, h = 240;
      const key = String(params.item || '').toLowerCase();
      const fn = getFn(key);
      const bd = spotBackdrop(t, params, w, h, uid, hashStr(key + (params.palette || '')));
      const scale = Math.max(0.5, Math.min(1.3, parseFloat(params.scale) || 1));
      const s = 1.0 * scale, off = (w - 200 * s) / 2;
      const art = fn(t, params);
      return { w, h, defs: bd.defs, body: bd.body + G(art, `translate(${rnd(off)} ${rnd((h - 200 * s) / 2 + 2)}) scale(${s})`) };
    };
  }
  const _IL_NOISE_SUFFIXES = ['obj', 'lab', 'model', 'chip', 'helix', 'award', 'cup', 'pair', 'stand', 'rack',
    'page', 'files', 'check', 'desk', 'cone', 'bucket', 'pin', 'bag', 'cart', 'badge', 'globe', 'stars',
    'palette', 'bottle', 'bulb', 'block', 'blocks', 'sign', 'curtain', 'machine', 'pulse', 'burst', 'kit',
    'slice', 'box', 'stack', 'piece', 'lamp', 'wedge', 'tubes', 'tag'];
  const _IL_NOISE_SUFFIX_RE = new RegExp('_(' + _IL_NOISE_SUFFIXES.join('|') + ')$', 'i');
  function _ilAliasKey(k) {
    return String(k || '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/_+/g, '_');
  }
  function _ilBuildAliasIndex(list) {
    const index = {};
    list.forEach(name => {
      const base = name.replace(_IL_NOISE_SUFFIX_RE, '');
      [name, base].forEach(variant => {
        const alias = _ilAliasKey(variant);
        if (alias && !(alias in index)) index[alias] = name;
      });
    });
    return index;
  }
  const pickFrom = (reg, list) => {
    const aliasIndex = _ilBuildAliasIndex(list);
    return key => {
      const raw = String(key || '').toLowerCase().trim();
      if (reg[raw]) return reg[raw];
      const norm = _ilAliasKey(raw);
      if (aliasIndex[norm]) return reg[aliasIndex[norm]];
      if (norm.endsWith('s') && aliasIndex[norm.slice(0, -1)]) return reg[aliasIndex[norm.slice(0, -1)]];
      return reg[list[hashStr(raw || 'x') % list.length]];
    };
  };
  const withAccessory = (fn) => (t, o) => {
    let out = fn(t, o);
    const a = String(o.accessory || '').toLowerCase();
    if (!a || a === 'none') return out;
    if (a === 'bow') out += PG('100,148 80,136 80,160', t.acc) + PG('100,148 120,136 120,160', t.acc) + C(100, 148, 6, t.a);
    if (a === 'scarf') out += P('M60 136C84 154 116 154 140 136L146 156C118 174 82 174 54 156Z', t.a) + R(118, 150, 16, 34, t.a, 4) + R(118, 172, 16, 5, t.acc);
    if (a === 'party_hat') out += PG('100,2 74,52 126,52', t.acc) + C(100, 4, 7, t.a) + S('M84 40L112 30M80 50L120 40', t.a, 4);
    if (a === 'crown') out += P('M70 50L74 18L88 34L100 10L112 34L126 18L130 50Z', K.gold) + C(100, 30, 4, K.red);
    if (a === 'glasses') out += C(78, 92, 15, 'none', ` stroke="${K.ink}" stroke-width="4"`) + C(122, 92, 15, 'none', ` stroke="${K.ink}" stroke-width="4"`) + S('M93 92H107', K.ink, 4);
    if (a === 'flower') out += flowerHead(140, 46, 40, 8, t.c, K.yellow, 8);
    if (a === 'headphones') out += S('M52 92C52 30 148 30 148 92', K.ink, 8) + R(40, 82, 18, 32, t.a, 8) + R(142, 82, 18, 32, t.a, 8);
    return out;
  };

  const renderObject = spotRenderer(pickFrom(OBJ, Object.keys(OBJ)));
  const renderAnimal = spotRenderer(k => withAccessory(pickFrom(ANI, ANI_LIST)(k)));
  const renderPlant = spotRenderer(pickFrom(PLA, PLA_LIST));
  const renderBuilding = spotRenderer(pickFrom(BLD, BLD_LIST));
  const renderVehicle = spotRenderer(pickFrom(VEH, VEH_LIST));

  function renderCharacter(params) {
    const t = themeOf(params, 'ocean');
    const uid = _ilUid(), w = 260, h = 320;
    const bd = spotBackdrop(t, params, w, h, uid, hashStr(String(params.role || 'casual')));
    const art = drawCharacter(t, { role: String(params.role || 'casual').toLowerCase(), skin: String(params.skin || 'light').toLowerCase(), hair: String(params.hair || '').toLowerCase(), haircolor: String(params.haircolor || '').toLowerCase(), style: String(params.style || '').toLowerCase(), pose: String(params.pose || 'stand').toLowerCase(), gender: String(params.gender || '').toLowerCase(), accessory: String(params.accessory || '').toLowerCase() });
    return { w, h, defs: bd.defs, body: bd.body + G(art, 'translate(30 24)') };
  }

  function renderIconBadgeExt(params) {
    const t = themeOf(params, 'corporate');
    const w = 360, h = 360, uid = _ilUid();
    const style = String(params.style || 'solid').toLowerCase();
    const sym = params.symbol || 'star';
    const cx = w / 2, cy = h / 2;
    const gid = 'ib_' + uid;
    const grad = `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${t.b}"/><stop offset="100%" stop-color="${t.a}"/></linearGradient>`;
    let body = '';
    const glyph = (color, s) => _ilSymbol(sym, cx, cy, s || 2.4, color);
    if (style === 'tile') body = R(50, 50, 260, 260, `url(#${gid})`, 64) + R(50, 50, 260, 260, 'none', 64, ' stroke="#fff" stroke-opacity=".12" stroke-width="4"') + glyph('#ffffff');
    else if (style === 'soft') body = C(cx, cy, 130, t.d) + C(cx, cy, 104, t.light) + glyph(t.a);
    else if (style === 'outline') body = C(cx, cy, 128, 'none', ` stroke="${t.a}" stroke-width="12"`) + glyph(t.a);
    else if (style === 'ring') body = C(cx, cy, 150, t.c, ' opacity=".2"') + C(cx, cy, 124, `url(#${gid})`) + C(cx, cy, 108, 'none', ' stroke="#fff" stroke-opacity=".35" stroke-width="4" stroke-dasharray="4 10"') + glyph('#ffffff');
    else if (style === 'flat') body = glyph(t.a, 4.2);
    else if (style === 'duo') body = C(cx + 18, cy + 18, 120, t.c, ' opacity=".55"') + C(cx, cy, 120, `url(#${gid})`) + glyph('#ffffff');
    else body = C(cx, cy, 146, t.acc, ' opacity=".18"') + C(cx, cy, 120, `url(#${gid})`) + glyph('#ffffff');
    return { w, h, defs: grad, body };
  }

  function renderIconGrid(params) {
    const t = themeOf(params, 'corporate');
    const cat = ICON_CATS[String(params.category || params.cat || 'business').toLowerCase()] ? String(params.category || params.cat || 'business').toLowerCase() : 'business';
    const names = ICON_CATS[cat];
    const n = Math.max(3, Math.min(12, params.count || 6));
    const start = params.start ? Math.max(0, parseInt(params.start, 10) || 0) : 0;
    const picked = params.symbols ? String(params.symbols).split(',').map(s => s.trim()).filter(s => ICONS[s]) : Array.from({ length: n }, (_, i) => names[(start + i) % names.length]);
    const cols = picked.length <= 4 ? picked.length : picked.length <= 6 ? 3 : picked.length <= 8 ? 4 : picked.length === 9 ? 3 : 4;
    const rows = Math.ceil(picked.length / cols), cell = 150, gap = 26, lab = params.labels === '1' || params.labels === 'yes' ? 26 : 0;
    const w = cols * cell + (cols + 1) * gap, h = rows * (cell + lab) + (rows + 1) * gap;
    const uid = _ilUid(), cols5 = [t.a, t.b, t.e, t.c, t.a];
    let body = R(0, 0, w, h, t.light);
    picked.forEach((nm, i) => {
      const cx = gap + (i % cols) * (cell + gap), cy = gap + Math.floor(i / cols) * (cell + lab + gap), col = cols5[i % cols5.length];
      body += R(cx, cy, cell, cell, col, 30) + R(cx, cy, cell, cell, '#fff', 30, ' opacity=".08"') + extIcon(nm, cx + cell / 2, cy + cell / 2, 2.6, '#ffffff');
      if (lab) body += `<text x="${cx + cell / 2}" y="${cy + cell + 20}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="600" fill="${t.ink}">${nm.replace(/_/g, ' ')}</text>`;
    });
    return { w, h, defs: '', body };
  }

  // ---------- LANDSCAPE SCENES ----------
  const LW = 700, LH = 400;
  function ridge(w, y0, amp, f, ph, color, bottom) {
    let d = `M0 ${bottom}L0 ${rnd(y0 + amp * Math.sin(ph))}`;
    for (let x = 10; x <= w; x += 10) d += `L${x} ${rnd(y0 + amp * Math.sin(x * f + ph) + amp * 0.4 * Math.sin(x * f * 2.3 + ph * 1.7))}`;
    return P(d + `L${w} ${bottom}Z`, color);
  }
  function peak(cx, base, h, wd, color, snow) {
    let s = PG(`${cx - wd},${base} ${cx},${base - h} ${cx + wd},${base}`, color) + PG(`${cx},${base - h} ${cx + wd},${base} ${cx + wd * 0.1},${base}`, '#000', ' opacity=".1"');
    if (snow) s += PG(`${cx},${base - h} ${rnd(cx - wd * 0.28)},${rnd(base - h + h * 0.28)} ${rnd(cx - wd * 0.08)},${rnd(base - h + h * 0.2)} ${rnd(cx + wd * 0.1)},${rnd(base - h + h * 0.3)} ${rnd(cx + wd * 0.28)},${rnd(base - h + h * 0.28)}`, snow);
    return s;
  }
  const use = (fn, x, y, s, t, o) => G(fn(t, o || {}), `translate(${rnd(x - 100 * s)} ${rnd(y - 180 * s)}) scale(${s})`);
  function skyOf(t, uid, stops, h) { return _ilSkyGradientAndRect(LW, h || LH, stops || [t.bg[0], t.bg[1]], uid); }
  const sunMoon = (t, uid, x, y, r, dark) => _ilSunOrMoon(x, y, r, dark ? '#fdf6d8' : t.acc, dark ? '#fdf6d8' : t.acc, uid, !!dark);
  const rain = (n, seed, color, len) => { const r = rng(seed); let s = ''; for (let i = 0; i < n; i++) { const x = r() * LW, y = r() * LH; s += `<line x1="${rnd(x)}" y1="${rnd(y)}" x2="${rnd(x - 6)}" y2="${rnd(y + len)}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity=".55"/>`; } return s; };
  const dots = (n, seed, color, rmin, rmax, w, h, op) => { const r = rng(seed); let s = ''; for (let i = 0; i < n; i++) s += C(rnd(r() * w), rnd(r() * h), rnd(rmin + r() * (rmax - rmin)), color, ` opacity="${op || .6}"`); return s; };

  const SC = {};
  const SCN = [];
  const add = (id, fn, shape) => { SC[id] = { render: fn, defaultShape: shape || 'wide' }; SCN.push(id); };

  add('landscape_desert', p => { const t = themeOf(p, 'desert'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.d, t.bg[1]], 300), sun = sunMoon(t, uid, 500, 120, 44);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + ridge(LW, 250, 22, 0.012, 0.6, t.d, LH) + PG('130,264 230,150 330,264', t.c) + PG('230,150 330,264 240,264', '#000', ' opacity=".12"') + PG('300,268 370,190 440,268', t.b) + ridge(LW, 290, 26, 0.009, 2, t.c, LH) + ridge(LW, 330, 22, 0.014, 4, t.b, LH) + use(PLA.cactus, 90, 322, 0.75, t) + use(PLA.cactus, 590, 350, 1, t) + use(PLA.cactus, 520, 312, 0.5, t) + _ilCloud(200, 70, 1.1, '#fff', .7) + _ilCloud(380, 46, .8, '#fff', .6) }; });
  add('landscape_snow', p => { const t = themeOf(p, 'arctic'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 300), sun = sunMoon(t, uid, 120, 90, 26);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + peak(220, 270, 190, 170, t.c, '#fff') + peak(430, 270, 230, 200, t.b, '#fff') + peak(590, 270, 150, 130, t.c, '#fff') + ridge(LW, 280, 18, 0.011, 1, '#f5faff', LH) + ridge(LW, 320, 16, 0.015, 3, '#ffffff', LH) + [[80, 310, .9], [150, 296, .7], [560, 300, .8], [630, 330, 1.1], [510, 316, .6]].map(a => use(PLA.pine_tree, a[0], a[1], a[2], t, { season: 'winter' })).join('') + use(OBJ.snowman, 340, 350, .6, t) + dots(60, 7, '#fff', 1.5, 3.4, LW, LH, .9) };
  });
  add('landscape_forest', p => { const t = themeOf(p, 'forest'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 260), sun = sunMoon(t, uid, 520, 100, 32);
    let body = sky.rect + sun.markup + ridge(LW, 220, 26, 0.012, 0.4, t.c, LH) + ridge(LW, 250, 22, 0.015, 2, t.b, LH);
    for (let i = 0; i < 16; i++) body += use(PLA.pine_tree, 20 + i * 44, 290 + (i % 3) * 6, 0.62 + (i % 2) * .1, t);
    body += R(0, 240, LW, 60, t.light, 0, ' opacity=".18"') + ridge(LW, 320, 14, 0.02, 1, t.a, LH);
    for (let i = 0; i < 9; i++) body += use(i % 2 ? PLA.oak_tree : PLA.pine_tree, 30 + i * 80, 362 + (i % 2) * 6, 0.9 + (i % 3) * .12, t);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(OBJ.mushroom_obj, 350, 392, .28, t) + use(ANI.deer, 220, 392, .42, t, {}) }; });
  add('landscape_beach', p => { const t = themeOf(p, 'ocean'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.d], 230), sun = sunMoon(t, uid, 540, 90, 38);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + _ilCloud(150, 70, 1.2, '#fff', .85) + _ilCloud(340, 44, .8, '#fff', .8) + R(0, 210, LW, 100, t.b) + R(0, 210, LW, 34, t.c, 0, ' opacity=".6"') + [0, 1, 2].map(i => S(`M0 ${254 + i * 18}C100 ${244 + i * 18} 200 ${264 + i * 18} 300 ${254 + i * 18}S500 ${244 + i * 18} 700 ${254 + i * 18}`, '#fff', 3, ' opacity=".4"')).join('') + use(VEH.sailboat_o, 380, 250, .5, t) + P('M0 300C120 280 260 296 420 306C540 314 640 300 700 292V400H0Z', '#f4dfae') + P('M0 330C140 312 300 326 470 338C580 344 660 334 700 328V400H0Z', '#efd394') + use(PLA.palm_tree, 110, 350, 1.1, t) + use(PLA.palm_tree, 600, 340, .95, t) + use(OBJ.umbrella_obj, 330, 360, .5, t) + use(OBJ.seashell, 470, 380, .22, t) };
  });
  add('landscape_farm', p => { const t = themeOf(p, 'spring'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240), sun = sunMoon(t, uid, 110, 80, 30);
    let body = sky.rect + sun.markup + _ilCloud(330, 60, 1, '#fff', .9) + _ilCloud(560, 90, 1.2, '#fff', .8) + ridge(LW, 200, 14, 0.012, 1, '#8ccf8a', LH) + ridge(LW, 232, 10, 0.02, 3, '#6fbe78', LH);
    [['#5aae66', 260], ['#79c07a', 290], ['#5aae66', 322], ['#79c07a', 356]].forEach((r, i) => body += P(`M0 ${r[1]}H${LW}V${r[1] + 34 + i * 2}H0Z`, r[0]));
    body += use(BLD.barn, 480, 262, .95, t) + use(BLD.windmill, 250, 250, .9, t) + use(PLA.oak_tree, 60, 262, 1, t) + use(PLA.apple_tree, 640, 300, 1.05, t) + use(VEH.tractor, 200, 366, .6, t) + use(ANI.cow, 400, 360, .48, t, {}) + use(ANI.sheep, 470, 380, .42, t, {}) + use(ANI.chicken, 560, 384, .3, t, {});
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body }; });
  add('landscape_space', p => { const t = themeOf(p, 'midnight'), uid = _ilUid(), sky = _ilSkyGradientAndRect(LW, LH, ['#0b0f2a', '#1b1b4b', '#0b0f2a'], uid);
    return { w: LW, h: LH, defs: sky.defs, body: sky.rect + _ilStars(LW, LH * 1.5, 70, '#ffffff') + C(560, 110, 64, t.b) + P('M520 90C540 80 580 84 610 104C580 96 550 98 520 90Z', t.a, ' opacity=".5"') + `<ellipse cx="560" cy="110" rx="110" ry="24" fill="none" stroke="${t.acc}" stroke-width="8" transform="rotate(-20 560 110)"/>` + C(140, 90, 36, t.e) + C(126, 82, 8, '#000', ' opacity=".12"') + C(154, 100, 5, '#000', ' opacity=".12"') + C(330, 190, 18, t.c) + use(VEH.rocket_v, 350, 250, 0.9, t) + ridge(LW, 350, 12, .02, 1, '#1a1f3d', LH) + C(180, 372, 22, '#000', ' opacity=".15"') + C(500, 380, 30, '#000', ' opacity=".15"') + use(OBJ.star_burst, 640, 300, .3, t) + use(OBJ.comet, 100, 250, .5, t) };
  });
  add('landscape_underwater', p => { const t = themeOf(p, 'ocean'), uid = _ilUid(), sky = _ilSkyGradientAndRect(LW, LH, [t.c, t.b, t.a], uid);
    let body = sky.rect + [80, 200, 330, 470, 600].map((x, i) => PG(`${x},0 ${x + 60},0 ${x + 160},${LH} ${x - 40},${LH}`, '#fff', ' opacity=".07"')).join('');
    body += ridge(LW, 340, 14, .02, 1, t.d, LH) + [[60, 1], [180, .8], [520, 1.1], [640, .9]].map((a, i) => use(i % 2 ? PLA.succulent : PLA.fern, a[0], 380, a[1] * 0.9, t)).join('');
    body += [[70, 330], [150, 320], [560, 336]].map((a, i) => S(`M${a[0]} 392C${a[0] - 20} 350 ${a[0] + 20} 340 ${a[0]} 300`, [K.pink, t.acc, K.orange][i], 10) + S(`M${a[0]} 340L${a[0] + 16} 322M${a[0]} 350L${a[0] - 16} 332`, [K.pink, t.acc, K.orange][i], 7)).join('');
    return { w: LW, h: LH, defs: sky.defs, body: body + use(ANI.goldfish, 250, 200, .5, t) + use(ANI.whale, 470, 170, .8, t) + use(ANI.octopus, 360, 340, .5, t) + use(ANI.turtle, 130, 240, .42, t) + use(ANI.seahorse, 590, 260, .42, t) + use(ANI.crab, 300, 396, .3, t) + [[210, 120, 8], [222, 90, 5], [180, 60, 6], [560, 100, 7], [575, 70, 4], [90, 130, 5]].map(b => C(b[0], b[1], b[2], 'none', ` stroke="#fff" stroke-width="2.5" opacity=".7"`)).join('') };
  });
  add('landscape_village', p => { const t = themeOf(p, 'spring'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 250), sun = sunMoon(t, uid, 580, 80, 28);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + _ilCloud(160, 70, 1.1, '#fff', .9) + ridge(LW, 200, 34, 0.009, 0.5, '#9ad3a0', LH) + ridge(LW, 250, 20, 0.012, 2, '#79c07a', LH) + use(BLD.church, 350, 270, .75, t) + use(BLD.cottage, 190, 290, .7, t) + use(BLD.house, 500, 290, .7, t) + use(PLA.oak_tree, 110, 300, .8, t) + use(PLA.pine_tree, 620, 292, .8, t) + ridge(LW, 320, 14, .016, 1, '#5aae66', LH) + P('M330 400C340 360 320 340 350 300C370 300 380 340 400 400Z', '#e6d3a8') + use(BLD.windmill, 640, 350, .6, t) + use(PLA.bush, 240, 360, .5, t) + use(PLA.sunflower, 90, 380, .4, t) + use(PLA.tulip, 480, 385, .35, t) + use(ANI.dog, 430, 392, .32, t, {}) };
  });
  add('landscape_mountain_lake', p => { const t = themeOf(p, 'sky'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 250), sun = sunMoon(t, uid, 560, 84, 28);
    const peaks = peak(200, 250, 170, 170, t.b, '#fff') + peak(380, 250, 220, 190, t.a, '#fff') + peak(560, 250, 140, 130, t.b, '#fff');
    const pines = [40, 90, 130, 590, 640, 670].map((x, i) => use(PLA.pine_tree, x, 264 + (i % 2) * 8, 0.5 + (i % 3) * .1, t)).join('');
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + peaks + ridge(LW, 250, 8, .02, 1, '#4b8f5a', 280) + pines + R(0, 270, LW, 130, t.c) + G(peaks + ridge(LW, 250, 8, .02, 1, '#4b8f5a', 280), `translate(0 540) scale(1 -1)`, ' opacity=".28"') + [0, 1, 2, 3].map(i => S(`M${60 + i * 150} ${300 + i * 20}h${90}`, '#fff', 3, ' opacity=".4"')).join('') + use(VEH.sailboat_o, 420, 350, .4, t) };
  });
  add('landscape_night_sky', p => { const t = themeOf(p, 'midnight'), uid = _ilUid(), sky = _ilSkyGradientAndRect(LW, LH, ['#070a1f', _ilShade(t.a, .5), _ilShade(t.b, .45)], uid), moon = sunMoon(t, uid, 520, 100, 40, true);
    return { w: LW, h: LH, defs: sky.defs + moon.defs, body: sky.rect + _ilStars(LW, LH * 1.4, 80, '#fff') + moon.markup + ridge(LW, 290, 30, 0.01, 1, _ilShade(t.a, .6), LH) + ridge(LW, 330, 22, 0.014, 3, '#0b0f24', LH) + [60, 110, 620, 660].map((x, i) => use(PLA.pine_tree, x, 340, 0.8 + (i % 2) * .2, t)).join('') + use(OBJ.tent_obj, 330, 372, .6, t) + use(OBJ.campfire, 440, 384, .4, t) + C(440, 350, 60, K.orange, ' opacity=".08"') + use(OBJ.star_burst, 200, 90, .16, t) };
  });
  add('landscape_rain_city', p => { const t = themeOf(p, 'mono'), uid = _ilUid(), sky = skyOf(t, uid, [t.c, t.d], 400);
    return { w: LW, h: LH, defs: sky.defs, body: sky.rect + _ilCloud(120, 60, 1.6, t.b, .9) + _ilCloud(340, 40, 1.9, t.a, .8) + _ilCloud(560, 70, 1.6, t.b, .9) + _ilBuildingsRow(LW, 320, 9, [t.a, t.b, t.e, t.c], t.light, K.yellow) + R(0, 320, LW, 80, t.a) + R(0, 320, LW, 6, t.b) + rain(120, 3, t.light, 18) + use(OBJ.umbrella_obj, 220, 388, .44, t) + use(OBJ.umbrella_obj, 470, 388, .5, t) + E(340, 382, 90, 8, t.light, ' opacity=".2"') + use(VEH.taxi, 610, 390, .38, t) };
  });
  add('landscape_meadow', p => { const t = themeOf(p, 'spring'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240), sun = sunMoon(t, uid, 560, 84, 30);
    let body = sky.rect + sun.markup + _ilCloud(180, 70, 1.1, '#fff', .9) + ridge(LW, 220, 28, 0.01, 1, '#a5dfa0', LH) + ridge(LW, 270, 20, 0.013, 2, '#7ccf85', LH) + ridge(LW, 330, 16, 0.018, 4, '#5cb872', LH);
    const r = rng(11);
    for (let i = 0; i < 34; i++) { const x = r() * LW, y = 290 + r() * 100, k = [t.a, t.c, t.acc, '#fff', t.e][i % 5]; body += stem(x, y + 20, y, '#3f9e5b').replace('stroke-width="7"', 'stroke-width="2.5"') + C(x, y, 5 + r() * 3, k) + C(x, y, 2, K.yellow); }
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(ANI.butterfly_o, 200, 220, .3, t) + use(ANI.butterfly_o, 420, 250, .24, t) + use(ANI.bee, 300, 280, .2, t) + use(PLA.oak_tree, 80, 300, .7, t) + use(ANI.rabbit, 560, 390, .4, t, {}) + use(ANI.ladybug, 100, 394, .16, t) };
  });
  add('landscape_island', p => { const t = themeOf(p, 'ocean'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.d], 230), sun = sunMoon(t, uid, 130, 100, 40);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + _ilCloud(420, 60, 1.3, '#fff', .85) + _ilCloud(590, 110, .9, '#fff', .8) + R(0, 220, LW, 180, t.b) + R(0, 220, LW, 26, t.c, 0, ' opacity=".5"') + [0, 1, 2, 3, 4].map(i => S(`M0 ${270 + i * 26}C120 ${258 + i * 26} 240 ${282 + i * 26} 360 ${270 + i * 26}S600 ${258 + i * 26} 700 ${270 + i * 26}`, '#fff', 3, ' opacity=".3"')).join('') + E(360, 300, 200, 40, '#f4dfae') + E(360, 292, 170, 26, '#7ccf85') + use(PLA.palm_tree, 330, 300, 1.3, t) + use(PLA.palm_tree, 420, 306, .9, t) + use(OBJ.tent_obj, 280, 312, .3, t) + use(VEH.sailboat_o, 570, 320, .5, t) + use(ANI.whale, 110, 380, .5, t) + use(ANI.dolphin, 220, 350, .3, t) };
  });
  add('landscape_autumn', p => { const t = themeOf(p, 'autumn'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 260), sun = sunMoon(t, uid, 560, 90, 30);
    let body = sky.rect + sun.markup + ridge(LW, 220, 30, .01, 1, '#e0a55a', LH) + ridge(LW, 268, 22, .013, 2, '#c8782c', LH);
    body += [50, 150, 250, 470, 560, 650].map((x, i) => use(PLA.autumn_tree, x, 300 + (i % 2) * 14, .8 + (i % 3) * .14, t)).join('') + ridge(LW, 336, 14, .018, 3, '#9a5a24', LH) + P('M300 400C320 350 330 330 350 300C370 300 390 350 420 400Z', '#e6d3a8') + use(PLA.bush, 200, 390, .55, t) + use(OBJ.mushroom_obj, 560, 392, .3, t) + use(ANI.fox, 470, 392, .4, t, {});
    const r = rng(5); for (let i = 0; i < 22; i++) body += G(P('M0 0C6 -8 14 -8 18 0C14 8 6 8 0 0Z', ['#d9822b', '#e8a23a', '#c8552b'][i % 3]), `translate(${rnd(r() * LW)} ${rnd(60 + r() * 320)}) rotate(${Math.round(r() * 360)})`);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body }; });
  add('landscape_harbor', p => { const t = themeOf(p, 'ocean'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.d], 250), sun = sunMoon(t, uid, 590, 78, 30);
    let body = sky.rect + sun.markup + _ilCloud(180, 60, 1.1, '#fff', .85) + _ilCloud(400, 40, .9, '#fff', .8) + R(0, 240, LW, 160, t.b) + R(0, 240, LW, 20, t.c, 0, ' opacity=".5"');
    body += use(BLD.lighthouse, 110, 280, .7, t) + use(VEH.ship, 420, 300, .7, t) + use(VEH.sailboat_o, 580, 320, .45, t) + use(VEH.canoe, 230, 350, .4, t) + S('M0 260H700M40 300H660', t.d, 3, ' opacity=".4"') + R(30, 250, 60, 40, t.d, 2) + use(ANI.crab, 610, 388, .28, t);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body }; });
  add('landscape_orchard', p => { const t = themeOf(p, 'spring'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 250), sun = sunMoon(t, uid, 120, 84, 28);
    let body = sky.rect + sun.markup + _ilCloud(340, 60, 1, '#fff', .9) + ridge(LW, 220, 20, 0.012, 1, '#9ad3a0', LH) + ridge(LW, 260, 16, 0.015, 2, '#79c07a', LH);
    body += [70, 220, 370, 520, 630].map((x, i) => use(i % 2 ? PLA.cherry_tree : PLA.apple_tree, x, 320 + (i % 2) * 10, .85 + (i % 3) * .08, t)).join('') + ridge(LW, 340, 12, .02, 3, '#5aae66', LH) + use(BLD.cottage, 480, 356, .6, t) + use(ANI.rabbit, 150, 392, .34, t, {}) + use(ANI.bee, 260, 300, .18, t);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body }; });
  add('landscape_rainforest', p => { const t = themeOf(p, 'forest'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 260);
    let body = sky.rect + ridge(LW, 200, 30, 0.01, 0.5, _ilShade(t.c, .1), LH) + ridge(LW, 240, 24, 0.014, 2, t.c, LH);
    for (let i = 0; i < 10; i++) body += use(PLA.oak_tree, 10 + i * 76, 270 + (i % 3) * 10, 1.0 + (i % 2) * .2, t);
    body += ridge(LW, 330, 16, .018, 3, t.b, LH) + use(PLA.monstera, 90, 380, 1.0, t) + use(PLA.bamboo, 560, 370, 1.1, t) + use(PLA.fern, 260, 392, .8, t) + use(PLA.fern, 460, 392, .7, t);
    return { w: LW, h: LH, defs: sky.defs, body: body + use(ANI.parrot, 200, 220, .5, t) + use(ANI.frog, 350, 392, .4, t) + use(ANI.chameleon, 480, 300, .4, t) }; });
  add('landscape_savanna', p => { const t = themeOf(p, 'earth'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 280), sun = sunMoon(t, uid, 560, 90, 40);
    let body = sky.rect + sun.markup + ridge(LW, 260, 14, 0.01, 1, '#d9b56a', LH) + ridge(LW, 300, 10, 0.015, 3, '#c9a35a', LH);
    body += use(PLA.oak_tree, 120, 300, .9, t) + use(PLA.oak_tree, 600, 320, .7, t) + use(PLA.bush, 300, 370, .5, t);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(ANI.giraffe, 420, 340, .5, t, {}) + use(ANI.elephant, 220, 390, .55, t, {}) + use(ANI.lion, 540, 392, .4, t, {}) }; });
  add('landscape_vineyard', p => { const t = themeOf(p, 'autumn'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240), sun = sunMoon(t, uid, 120, 84, 28);
    let body = sky.rect + sun.markup + _ilCloud(400, 60, 1, '#fff', .85) + ridge(LW, 220, 22, 0.011, 1, '#a9c26a', LH) + ridge(LW, 258, 16, 0.014, 2.4, '#8fae52', LH);
    for (let row = 0; row < 3; row++) { const y = 288 + row * 30; for (let i = 0; i < 9; i++) body += L(30 + i * 80, y, 30 + i * 80, y + 20, K.dbrown, 4) + C(30 + i * 80, y + 3, 5, '#5a7d3a'); }
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(BLD.cottage, 560, 300, .8, t) + use(PLA.oak_tree, 80, 300, .8, t) + use(VEH.tractor, 300, 392, .55, t) + use(ANI.rabbit, 480, 392, .3, t, {}) }; });
  add('landscape_ski_slope', p => { const t = themeOf(p, 'arctic'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 260), sun = sunMoon(t, uid, 580, 70, 30);
    let body = sky.rect + sun.markup + peak(250, 260, 200, 190, t.b, '#fff') + peak(460, 260, 160, 150, t.c, '#fff');
    body += ridge(LW, 270, 20, 0.012, 1, '#eef6ff', LH) + ridge(LW, 320, 16, 0.016, 3, '#ffffff', LH);
    body += [[60, 300, .7], [130, 290, .6], [600, 300, .7], [650, 320, .9]].map(a => use(PLA.pine_tree, a[0], a[1], a[2], t, { season: 'winter' })).join('');
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(BLD.cottage, 350, 360, .7, t) + use(OBJ.snowman, 220, 392, .5, t) + dots(50, 4, '#fff', 1.2, 3, LW, LH, .8) }; });
  add('landscape_canal_town', p => { const t = themeOf(p, 'cream'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240), sun = sunMoon(t, uid, 590, 78, 26);
    let body = sky.rect + sun.markup + _ilCloud(180, 60, 1, '#fff', .85) + R(0, 240, LW, 160, t.c) + R(0, 240, LW, 20, t.d, 0, ' opacity=".5"');
    const houses = use(BLD.house, 90, 260, .55, t) + use(BLD.house, 190, 258, .5, t) + use(BLD.house, 280, 262, .6, t) + use(BLD.apartment, 400, 250, .55, t) + use(BLD.house, 500, 260, .5, t) + use(BLD.cottage, 590, 262, .55, t);
    body += houses + G(houses, 'translate(0 540) scale(1 -1)', ' opacity=".22"');
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(VEH.canoe, 350, 330, .5, t) + use(VEH.sailboat_o, 470, 340, .35, t) }; });
  add('landscape_temple_garden', p => { const t = themeOf(p, 'rose'), uid = _ilUid(), sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 250), sun = sunMoon(t, uid, 580, 84, 30);
    let body = sky.rect + sun.markup + _ilCloud(180, 60, 1, '#fff', .85) + ridge(LW, 230, 20, 0.011, 1, '#bcd8b0', LH) + ridge(LW, 268, 16, 0.015, 2.5, '#9cc491', LH);
    body += use(BLD.pagoda, 380, 300, .9, t) + use(PLA.cherry_tree, 140, 320, 1.0, t) + use(PLA.cherry_tree, 610, 330, .85, t) + use(PLA.bonsai, 250, 380, .5, t);
    body += R(0, 350, LW, 50, t.c, 0, ' opacity=".5"');
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(ANI.goldfish, 500, 380, .3, t) + use(ANI.crab, 90, 392, .25, t) }; });

  // ----- v3 new landscapes -----
  add('landscape_volcano', p => { const t = themeOf(p, 'earth'), uid = _ilUid();
    const sky = skyOf(t, uid, ['#3b1a10', '#7a3a1a', '#c97a3a'], 280);
    const sun = sunMoon(t, uid, 540, 90, 40);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + ridge(LW, 220, 30, 0.013, 0.6, _ilShade(t.a, .3), LH) + PG('120,300 300,120 480,300', '#3b1a10') + PG('300,120 480,300 380,300', '#000', ' opacity=".15"') + P('M280 180C290 150 310 150 320 180L330 220C336 240 300 240 300 220Z', K.orange) + P('M290 190C300 165 305 165 310 190L318 220C320 236 296 236 296 220Z', K.yellow) + P('M120 300C160 240 220 220 260 240L280 300Z', '#2b1a10') + P('M340 300C360 260 400 240 460 280L480 300Z', '#2b1a10') + [[400, 60, 6], [430, 80, 4], [380, 100, 5], [460, 40, 3], [340, 80, 4]].map(b => C(b[0], b[1], b[2], '#8a6a4a', ' opacity=".5"')).join('') };
  });
  add('landscape_canyon', p => { const t = themeOf(p, 'desert'), uid = _ilUid();
    const sky = skyOf(t, uid, [t.bg[0], t.d, t.bg[1]], 260);
    const sun = sunMoon(t, uid, 560, 80, 34);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + P('M0 200L80 180L120 220L160 190L200 240V400H0Z', t.a) + P('M700 200L620 180L580 220L540 190L500 240V400H700Z', t.a) + P('M0 220L80 200L120 240L160 210L200 260V400H0Z', _ilShade(t.a, .15)) + P('M700 220L620 200L580 240L540 210L500 260V400H700Z', _ilShade(t.a, .15)) + P('M200 240L260 260L300 280L340 280L380 300L420 280L460 280L500 260L540 190L500 240Z', _ilShade(t.a, .3)) + S('M180 240C240 260 280 280 360 280C440 280 480 260 520 240', t.b, 4) + R(0, 340, LW, 60, '#8a5a36') + S('M0 340C120 330 200 350 340 340C480 330 600 350 700 340', '#c58b55', 3) + use(PLA.cactus, 90, 340, .55, t) + use(PLA.cactus, 620, 350, .6, t) + use(ANI.crab, 340, 386, .28, t) + [[140, 80, 3], [180, 60, 2], [220, 90, 2.5]].map(b => C(b[0], b[1], b[2], '#fff', ' opacity=".6"')).join('') };
  });
  add('landscape_waterfall', p => { const t = themeOf(p, 'forest'), uid = _ilUid();
    const sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240);
    const sun = sunMoon(t, uid, 120, 90, 30);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + ridge(LW, 200, 20, 0.012, 1, '#3f8a56', LH) + ridge(LW, 230, 18, 0.015, 2, '#2f7a46', LH) + P('M280 200H420V320H280Z', '#7a9eb5') + P('M300 200C300 240 300 280 310 320H390C400 280 400 240 400 200Z', '#cfe3ea') + S('M310 220V320M330 210V320M350 210V320M370 220V320M390 220V320', '#fff', 3, ' opacity=".6"') + E(350, 340, 90, 18, '#7a9eb5') + E(350, 344, 60, 10, '#cfe3ea', ' opacity=".7"') + [30, 90, 620, 660].map((x, i) => use(PLA.pine_tree, x, 300, .8 + (i % 2) * .2, t)).join('') + use(PLA.fern, 220, 340, .6, t) + use(PLA.fern, 480, 340, .6, t) + [[280, 60, 4], [300, 40, 3], [320, 70, 4]].map(b => C(b[0], b[1], b[2], 'none', ` stroke="${t.light}" stroke-width="2.5"`)).join('') };
  });
  add('landscape_iceberg', p => { const t = themeOf(p, 'arctic'), uid = _ilUid();
    const sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240);
    const sun = sunMoon(t, uid, 560, 70, 30);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + R(0, 220, LW, 180, '#7ab5d4') + R(0, 220, LW, 20, '#a8d4e6', 0, ' opacity=".6"') + [0, 1, 2, 3, 4].map(i => S(`M0 ${280 + i * 26}C120 ${268 + i * 26} 240 ${292 + i * 26} 360 ${280 + i * 26}S600 ${268 + i * 26} 700 ${280 + i * 26}`, '#fff', 3, ' opacity=".4"')).join('') + P('M180 260L200 140L220 110L260 80L310 90L340 120L360 200L380 260Z', '#cfe3ea') + P('M200 140L260 80L310 90L360 200L380 260L340 260L300 160L260 130L220 200L200 260Z', '#fff', ' opacity=".8"') + P('M40 260L90 200L140 210L160 260Z', '#cfe3ea') + P('M560 260L620 220L680 230L700 260Z', '#cfe3ea') + use(ANI.penguin, 480, 260, .35, t, {}) + use(ANI.polar_bear, 130, 268, .4, t, {}) + dots(40, 5, '#fff', 1.5, 3, LW, 240, .8) };
  });
  add('landscape_swamp', p => { const t = themeOf(p, 'forest'), uid = _ilUid();
    const sky = skyOf(t, uid, ['#4a3a20', '#6a5a30', '#8a7a40'], 240);
    const sun = sunMoon(t, uid, 140, 90, 30);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + ridge(LW, 220, 14, 0.012, 1, '#3a4a2a', LH) + R(0, 250, LW, 150, '#3a5a3a') + R(0, 250, LW, 20, '#5a7a4a', 0, ' opacity=".6"') + [[80, 300], [140, 320], [620, 310], [560, 330]].map(a => use(PLA.pine_tree, a[0], a[1], .7, t)).join('') + use(PLA.willow_tree, 350, 300, .9, t) + S('M0 300C100 290 200 310 300 300S500 290 600 300 700 290 700 300', '#8aa67a', 2, ' opacity=".4"') + S('M0 340C100 330 200 350 300 340S500 330 600 340 700 330 700 340', '#8aa67a', 2, ' opacity=".4"') + use(ANI.frog, 480, 380, .35, t) + use(ANI.duck, 220, 380, .35, t, {}) + use(PLA.bamboo, 90, 340, .5, t) };
  });
  add('landscape_terrace', p => { const t = themeOf(p, 'spring'), uid = _ilUid();
    const sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 260);
    const sun = sunMoon(t, uid, 560, 80, 30);
    let body = sky.rect + sun.markup + ridge(LW, 200, 30, 0.011, 1, '#a5cf85', LH) + ridge(LW, 230, 20, 0.014, 2, '#8fc46f', LH);
    for (let i = 0; i < 5; i++) body += E(350, 260 + i * 30, 340 - i * 20, 18, i % 2 ? '#7cb566' : '#8fc474');
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(BLD.cottage, 130, 240, .5, t) + use(BLD.cottage, 570, 240, .5, t) + use(PLA.palm_tree, 80, 260, .8, t) + use(PLA.palm_tree, 620, 260, .8, t) + use(ANI.duck, 300, 320, .28, t, {}) };
  });
  add('landscape_lavender_field', p => { const t = themeOf(p, 'lavender'), uid = _ilUid();
    const sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240);
    const sun = sunMoon(t, uid, 580, 80, 30);
    let body = sky.rect + sun.markup + _ilCloud(180, 60, 1.2, '#fff', .85) + ridge(LW, 220, 20, 0.012, 1, '#b8a0d4', LH) + ridge(LW, 260, 14, 0.016, 2, '#a68ac6', LH);
    for (let row = 0; row < 4; row++) { const y = 280 + row * 30; for (let i = 0; i < 22; i++) body += C(20 + i * 32 + (row % 2) * 16, y, 4, '#8b5cf6') + C(20 + i * 32 + (row % 2) * 16, y - 4, 3, '#c4b5fd'); }
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(BLD.windmill, 600, 300, .7, t) + use(BLD.cottage, 100, 300, .6, t) + use(ANI.bee, 260, 300, .2, t) + use(ANI.bee, 440, 340, .18, t) };
  });
  add('landscape_sunflower_field', p => { const t = themeOf(p, 'sunset'), uid = _ilUid();
    const sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240);
    const sun = sunMoon(t, uid, 120, 90, 40);
    let body = sky.rect + sun.markup + _ilCloud(500, 70, 1.2, '#fff', .85) + ridge(LW, 220, 20, 0.012, 1, '#e0c060', LH) + ridge(LW, 260, 14, 0.016, 2, '#c9a34a', LH);
    for (let row = 0; row < 4; row++) { const y = 280 + row * 30; for (let i = 0; i < 14; i++) body += use(PLA.sunflower, 30 + i * 50 + (row % 2) * 25, y, .35 + row * .05, t); }
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: body + use(BLD.barn, 600, 300, .6, t) + use(BLD.cottage, 80, 300, .5, t) };
  });
  add('landscape_bamboo_forest', p => { const t = themeOf(p, 'forest'), uid = _ilUid();
    const sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 260);
    let body = sky.rect + ridge(LW, 240, 20, 0.012, 1, '#4a7a4a', LH);
    for (let i = 0; i < 12; i++) body += use(PLA.bamboo, 30 + i * 58, 280, 1.2 + (i % 2) * .2, t);
    body += ridge(LW, 300, 16, 0.016, 2, '#3a6a3a', LH);
    return { w: LW, h: LH, defs: sky.defs, body: body + use(PLA.fern, 200, 380, .7, t) + use(PLA.fern, 500, 380, .7, t) + use(ANI.panda, 350, 380, .5, t, {}) };
  });
  add('landscape_night_desert', p => { const t = themeOf(p, 'midnight'), uid = _ilUid();
    const sky = _ilSkyGradientAndRect(LW, LH, ['#0a1a2e', '#1a2a4a', '#3a2a3a'], uid);
    const moon = sunMoon(t, uid, 540, 90, 36, true);
    return { w: LW, h: LH, defs: sky.defs + moon.defs, body: sky.rect + _ilStars(LW, LH, 60, '#fff') + moon.markup + ridge(LW, 240, 20, 0.012, 1, '#3a2a4a', LH) + PG('120,280 240,180 360,280', '#2a1a3a') + PG('360,280 460,200 560,280', '#3a2a4a') + ridge(LW, 300, 14, 0.016, 2, '#2a1a3a', LH) + use(PLA.cactus, 90, 320, .8, t) + use(PLA.cactus, 600, 330, .9, t) + use(PLA.cactus, 480, 300, .6, t) + use(ANI.crab, 340, 386, .28, t) + use(OBJ.campfire, 220, 380, .35, t) };
  });
  add('landscape_reef', p => { const t = themeOf(p, 'ocean'), uid = _ilUid();
    const sky = _ilSkyGradientAndRect(LW, LH, ['#00b4d8', '#0077b6', '#023e8a'], uid);
    let body = sky.rect + [0, 1, 2, 3, 4].map(i => PG(`${80 + i * 130},0 ${120 + i * 130},0 ${180 + i * 130},${LH} ${20 + i * 130},${LH}`, '#fff', ' opacity=".08"')).join('') + ridge(LW, 340, 14, 0.02, 1, '#c9a86b', LH) + ridge(LW, 380, 12, 0.025, 3, '#e0b878', LH);
    body += [40, 100, 600, 660].map((x, i) => use(i % 2 ? PLA.fern : PLA.succulent, x, 380, .8, t)).join('') + use(OBJ.star_burst, 350, 200, .3, t) + use(OBJ.star_burst, 480, 260, .25, t) + use(OBJ.star_burst, 220, 180, .22, t);
    return { w: LW, h: LH, defs: sky.defs, body: body + use(ANI.goldfish, 200, 240, .5, t) + use(ANI.goldfish, 500, 200, .4, t) + use(ANI.turtle, 380, 340, .5, t) + use(ANI.starfish, 140, 350, .4, t) + use(ANI.crab, 580, 360, .3, t) + [[240, 140, 7], [250, 110, 5], [560, 160, 6], [570, 130, 4], [400, 100, 5]].map(b => C(b[0], b[1], b[2], 'none', ` stroke="#fff" stroke-width="2.5" opacity=".6"`)).join('') };
  });
  add('landscape_geyser', p => { const t = themeOf(p, 'arctic'), uid = _ilUid();
    const sky = skyOf(t, uid, [t.bg[0], t.bg[1]], 240);
    const sun = sunMoon(t, uid, 120, 90, 30);
    return { w: LW, h: LH, defs: sky.defs + sun.defs, body: sky.rect + sun.markup + ridge(LW, 220, 22, 0.012, 1, '#c9a86b', LH) + ridge(LW, 260, 16, 0.016, 2, '#a98040', LH) + P('M320 260L350 260L370 200L380 240L400 220L410 260Z', '#7a5a30') + P('M340 260C330 220 340 160 350 130C360 100 370 80 380 60C390 80 400 110 400 150C400 200 390 240 380 260Z', '#fff', ' opacity=".85"') + P('M350 260C340 200 350 140 360 100C370 80 380 60 380 60C375 90 370 140 365 200C360 240 358 260 358 260Z', '#fff') + P('M370 260C370 220 375 180 380 150C385 180 388 220 388 260Z', '#fff', ' opacity=".6"') + [130, 530].map((x, i) => use(PLA.pine_tree, x, 260 + i * 10, .6 + i * .1, t, { season: 'winter' })).join('') + E(360, 264, 60, 10, '#8a9a7a', ' opacity=".5"') + use(OBJ.campfire, 200, 380, .35, t) };
  });

  // ---------- CONCEPT SCENES ----------
  const CW = 700, CH = 420;
  function conceptBase(t, uid, seed) {
    const gid = 'cb_' + uid, r = rng(seed);
    const defs = `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${t.bg[0]}"/><stop offset="100%" stop-color="${t.bg[1]}"/></linearGradient>`;
    let body = R(0, 0, CW, CH, `url(#${gid})`) + C(120, 90, 110, t.light, ' opacity=".35"') + C(600, 340, 130, t.light, ' opacity=".3"') + C(560, 70, 60, t.c, ' opacity=".18"');
    for (let i = 0; i < 16; i++) body += C(r() * CW, r() * CH, 2 + r() * 4, [t.a, t.c, t.acc][i % 3], ' opacity=".28"');
    body += E(350, 392, 300, 18, t.a, ' opacity=".10"');
    return { defs, body };
  }
  const CN = {}, CNL = [];
  const cadd = (id, fn) => { CN[id] = p => { const t = themeOf(p, 'corporate'), uid = _ilUid(), b = conceptBase(t, uid, hashStr(id)); return { w: CW, h: CH, defs: b.defs, body: b.body + fn(t, p) }; }; CNL.push(id); };
  const CH_ = (role, x, y, s, t, o) => G(drawCharacter(t, Object.assign({ role: role, skin: 'light', pose: 'stand' }, o || {})), `translate(${rnd(x - 100 * s)} ${rnd(y - 250 * s)}) scale(${s})`);
  cadd('concept_teamwork', (t, p) => use(OBJ.puzzle_piece, 350, 230, 1.3, t) + CH_('casual', 170, 390, 1, t, { skin: 'tan', style: 'bun', gender: 'f', pose: 'point' }) + CH_('businessperson', 350, 396, .95, t, { skin: 'dark', style: 'short', pose: 'wave' }) + CH_('student', 530, 390, 1, t, { skin: 'light', style: 'ponytail', gender: 'f', pose: 'hold' }) + use(OBJ.speech_bubbles, 550, 130, .7, t) + use(OBJ.lightbulb, 130, 130, .6, t));
  cadd('concept_growth', (t) => [0, 1, 2, 3, 4].map(i => R(120 + i * 84, 330 - (i + 1) * 46, 60, (i + 1) * 46, [t.c, t.b, t.a, t.e, t.a][i], 8)).join('') + S('M110 250L240 200L330 226L470 130L580 74', t.acc, 8) + PG('600,64 566,72 584,100', t.acc) + use(PLA.seedling, 100, 386, .7, t) + use(OBJ.coin_stack, 600, 386, .6, t) + use(OBJ.star_obj, 630, 130, .4, t));
  cadd('concept_idea', (t) => use(OBJ.lightbulb, 350, 330, 2.0, t) + [[120, 160, 'gear_pair'], [560, 150, 'puzzle_piece'], [150, 320, 'magnifier'], [560, 320, 'rocket_obj'], [80, 240, 'brain_obj'], [620, 240, 'target_obj']].map(a => use(OBJ[a[2]], a[0], a[1] + 60, .55, t)).join('') + dots(24, 9, t.acc, 2, 5, CW, CH, .5));
  cadd('concept_launch', (t) => use(VEH.rocket_v, 350, 300, 1.7, t) + _ilCloud(200, 340, 2.2, '#fff', .95) + _ilCloud(500, 350, 2.4, '#fff', .95) + _ilCloud(350, 380, 2.8, '#fff', .95) + use(OBJ.star_burst, 130, 110, .5, t) + use(OBJ.star_burst, 580, 90, .4, t) + use(OBJ.planet_saturn, 590, 250, .55, t) + use(OBJ.comet, 100, 250, .5, t));
  cadd('concept_goal', (t) => use(OBJ.target_obj, 230, 300, 1.6, t) + CH_('businessperson', 500, 396, 1.15, t, { skin: 'tan', pose: 'point' }) + use(OBJ.flag_obj, 100, 390, .7, t) + use(OBJ.trophy_star, 620, 150, .6, t));
  cadd('concept_learning', (t) => use(OBJ.book_stack, 190, 380, 1.5, t) + use(OBJ.grad_cap, 190, 120, .8, t) + CH_('student', 420, 396, 1.15, t, { skin: 'brown', style: 'curly', gender: 'f', pose: 'hold' }) + use(OBJ.globe_stand, 590, 380, 1.0, t) + use(OBJ.pencil, 320, 330, .6, t) + use(OBJ.lightbulb, 560, 110, .55, t));
  cadd('concept_science', (t) => CH_('scientist', 350, 396, 1.15, t, { skin: 'light', style: 'bun', gender: 'f', pose: 'hold' }) + use(OBJ.microscope, 150, 392, 1.1, t) + use(OBJ.flask_lab, 540, 392, 1.0, t) + use(OBJ.atom_model, 580, 160, .8, t) + use(OBJ.test_tubes, 130, 200, .7, t) + use(OBJ.dna_helix, 240, 200, .6, t));
  cadd('concept_security', (t) => use(OBJ.shield_obj, 350, 350, 2.0, t) + use(OBJ.padlock, 130, 340, .9, t) + use(OBJ.key_obj, 580, 320, .8, t) + use(OBJ.circuit_chip, 590, 150, .8, t) + use(OBJ.laptop, 130, 160, .7, t));
  cadd('concept_cloud_tech', (t) => S('M350 190L140 300M350 190L560 300M350 190L350 330', t.c, 4, ' stroke-dasharray="6 8"') + use(OBJ.cloud_server, 350, 230, 1.5, t) + use(OBJ.laptop, 140, 340, 0.85, t) + use(OBJ.smartphone, 560, 350, .85, t) + use(OBJ.tablet_obj, 350, 390, .7, t) + use(OBJ.router, 590, 160, .55, t) + use(OBJ.server_rack, 110, 190, .55, t));
  cadd('concept_healthcare', (t) => CH_('doctor', 350, 396, 1.15, t, { skin: 'tan', style: 'short', pose: 'wave' }) + use(OBJ.medical_kit, 130, 350, 1.0, t) + use(OBJ.heart_pulse, 570, 300, 1.1, t) + use(OBJ.thermometer_obj, 580, 150, .6, t) + use(OBJ.pill_bottle, 120, 160, .6, t) + use(OBJ.stethoscope_obj, 240, 220, .55, t));
  cadd('concept_ecommerce', (t) => use(OBJ.shopping_cart_obj, 300, 350, 1.6, t) + use(OBJ.gift_box, 130, 380, .8, t) + use(OBJ.smartphone, 560, 350, 1.1, t) + use(OBJ.credit_card_obj, 590, 140, .8, t) + use(OBJ.price_tag, 130, 170, .7, t) + use(OBJ.shopping_bag_obj, 440, 390, .7, t));
  cadd('concept_finance', (t) => use(OBJ.coin_stack, 200, 384, 1.5, t) + use(OBJ.piggy_bank_obj, 400, 370, 1.3, t) + use(OBJ.bar_chart_obj, 590, 250, 1.0, t) + use(OBJ.wallet_obj, 590, 384, .6, t) + use(OBJ.money_bag, 90, 200, .6, t));
  cadd('concept_communication', (t) => use(OBJ.speech_bubbles, 350, 270, 1.7, t) + use(OBJ.smartphone, 120, 380, .95, t) + use(OBJ.envelope, 570, 380, .8, t) + use(OBJ.megaphone_obj, 590, 170, .7, t) + use(OBJ.paper_plane, 130, 150, .6, t));
  cadd('concept_travel', (t) => use(VEH.plane, 380, 250, 1.25, t) + _ilCloud(130, 90, 1.4, '#fff', .9) + _ilCloud(560, 120, 1.6, '#fff', .9) + use(OBJ.suitcase_obj, 180, 392, .9, t) + use(OBJ.compass_obj, 560, 392, .75, t) + use(OBJ.map_pin, 430, 392, .6, t) + use(OBJ.passport, 320, 396, .6, t));
  cadd('concept_sustainability', (t) => use(OBJ.earth_globe, 350, 300, 1.6, t) + use(PLA.oak_tree, 130, 392, 1.0, t) + use(PLA.seedling, 580, 392, .8, t) + use(OBJ.recycle_sign, 570, 160, .8, t) + use(OBJ.sun_obj, 130, 130, .7, t) + use(OBJ.leaf_branch, 220, 250, .5, t));
  cadd('concept_analytics', (t) => use(OBJ.pie_chart_obj, 200, 330, 1.3, t) + use(OBJ.bar_chart_obj, 440, 320, 1.4, t) + use(OBJ.magnifier, 590, 250, 1.0, t) + use(OBJ.laptop, 350, 392, .8, t) + use(OBJ.clipboard_check, 100, 170, .6, t));
  cadd('concept_mobile_app', (t) => use(OBJ.smartphone, 350, 384, 2.0, t) + [[120, 130, 'chat_ic'], [580, 140, 'bell_obj'], [110, 300, 'star_obj'], [590, 300, 'heart_obj'], [200, 380, 'gear_pair'], [510, 384, 'camera_obj']].map(a => use(OBJ[a[2]] || OBJ.speech_bubbles, a[0], a[1] + 50, .5, t)).join(''));
  cadd('concept_meeting', (t) => use(OBJ.blackboard, 350, 210, 1.5, t) + R(120, 300, 460, 16, K.wood, 6) + R(150, 316, 10, 70, K.dbrown) + R(540, 316, 10, 70, K.dbrown) + CH_('businessperson', 190, 300, .7, t, { skin: 'tan', pose: 'point' }) + CH_('casual', 350, 300, .7, t, { skin: 'light', style: 'long', gender: 'f' }) + CH_('developer', 510, 300, .7, t, { skin: 'brown', style: 'afro' }) + use(OBJ.coffee_mug, 420, 300, .3, t));
  cadd('concept_time', (t) => use(OBJ.wall_clock, 350, 330, 1.8, t) + use(OBJ.calendar_page, 140, 340, .95, t) + use(OBJ.hourglass_obj, 570, 340, .95, t) + use(OBJ.check_badge, 570, 160, .55, t) + use(OBJ.clipboard_check, 130, 160, .6, t));
  cadd('concept_success', (t) => [0, 1, 2, 3].map(i => R(150 + i * 90, 340 - (i + 1) * 50, 90, (i + 1) * 50 + 40, [t.c, t.b, t.a, t.e][i])).join('') + CH_('casual', 465, 142, .42, t, { skin: 'brown', pose: 'cheer', style: 'curly', gender: 'f' }) + use(OBJ.trophy_cup, 610, 390, .8, t) + use(OBJ.star_burst, 150, 130, .55, t) + use(OBJ.medal_award, 100, 340, .5, t));
  cadd('concept_remote_work', (t) => use(OBJ.laptop, 350, 300, 1.6, t) + CH_('casual', 350, 396, 1.1, t, { skin: 'tan', style: 'ponytail', gender: 'f', pose: 'wave' }) + use(OBJ.coffee_mug, 560, 380, .6, t) + use(OBJ.headphones_obj, 150, 180, .6, t) + use(PLA.potted_plant, 130, 380, .7, t) + use(OBJ.smartphone, 590, 160, .5, t));
  cadd('concept_customer_support', (t) => use(OBJ.speech_bubbles, 350, 260, 1.7, t) + CH_('casual', 210, 396, 1.05, t, { skin: 'light', style: 'short', pose: 'wave' }) + use(OBJ.smartphone, 470, 380, .8, t) + use(OBJ.check_badge, 590, 160, .7, t) + use(OBJ.headphones_obj, 130, 160, .6, t));
  cadd('concept_partnership', (t) => CH_('businessperson', 260, 396, 1.05, t, { skin: 'tan', pose: 'wave' }) + CH_('developer', 440, 396, 1.05, t, { skin: 'brown', style: 'afro', pose: 'point' }) + use(OBJ.briefcase, 350, 340, .8, t) + use(OBJ.check_badge, 560, 150, .7, t) + use(OBJ.folder_files, 130, 350, .8, t));
  cadd('concept_wellness', (t) => CH_('casual', 350, 396, 1.2, t, { skin: 'tan', style: 'bun', gender: 'f' }) + use(PLA.potted_plant, 160, 370, .9, t) + use(PLA.lotus, 560, 380, .8, t) + use(OBJ.heart_pulse, 590, 160, .7, t) + use(OBJ.coffee_cup, 130, 170, .6, t));
  cadd('concept_party_celebration', (t) => CH_('casual', 350, 396, 1.15, t, { skin: 'brown', pose: 'cheer', style: 'curly' }) + use(OBJ.balloons, 180, 300, .9, t) + use(OBJ.confetti_pop, 560, 300, .9, t) + use(OBJ.birthday_cake, 480, 392, .7, t) + use(OBJ.party_streamer, 130, 150, .6, t));
  cadd('concept_construction', (t) => CH_('worker', 350, 396, 1.15, t, { skin: 'tan', pose: 'point' }) + use(OBJ.hard_hat_obj, 150, 160, .6, t) + use(OBJ.toolbox_obj, 560, 384, .8, t) + use(OBJ.drill, 190, 340, .6, t) + use(OBJ.ladder_obj, 590, 200, .8, t));

  // ----- v3 new concept scenes -----
  cadd('concept_podcast', (t) => use(OBJ.microphone_obj, 350, 350, 1.6, t) + CH_('casual', 350, 396, .95, t, { skin: 'tan', style: 'bun', gender: 'f', pose: 'wave' }) + use(OBJ.headphones_obj, 130, 150, .8, t) + use(OBJ.speech_bubbles, 570, 130, .7, t) + C(120, 320, 60, t.acc, ' opacity=".2"') + C(580, 320, 60, t.a, ' opacity=".2"'));
  cadd('concept_onboarding', (t) => use(OBJ.smartphone, 260, 340, 1.5, t) + use(OBJ.check_badge, 480, 240, 1.0, t) + use(OBJ.star_burst, 130, 130, .5, t) + use(OBJ.arrow, 590, 160, .6, t) + S('M180 320C240 280 320 280 400 320', t.c, 4, ' stroke-dasharray="8 10"') + CH_('casual', 560, 396, .9, t, { skin: 'brown', pose: 'wave', style: 'curly' }));
  cadd('concept_fitness', (t) => CH_('athlete', 350, 396, 1.15, t, { skin: 'tan', pose: 'cheer', style: 'short' }) + use(OBJ.dumbbell_obj, 130, 350, .8, t) + use(OBJ.heart_pulse, 570, 330, .9, t) + use(OBJ.water_bottle, 130, 170, .7, t) + use(OBJ.wall_clock, 570, 150, .6, t));
  cadd('concept_recipe', (t) => use(OBJ.open_book, 350, 350, 1.4, t) + use(OBJ.chef_knife, 130, 340, .8, t) + use(OBJ.cutting_board, 570, 350, .9, t) + use(OBJ.egg_fried, 130, 150, .6, t) + use(OBJ.carrot_obj, 570, 150, .6, t) + CH_('chef', 350, 396, .55, t, { skin: 'light' }));
  cadd('concept_gaming', (t) => use(OBJ.gamepad_obj, 350, 350, 1.4, t) + use(OBJ.monitor_desk, 130, 300, 1.0, t) + use(OBJ.dice_obj, 570, 330, .7, t) + use(OBJ.trophy_cup, 600, 150, .7, t) + use(OBJ.chess_piece, 100, 150, .6, t));
  cadd('concept_wedding', (t) => C(300, 280, 60, t.a) + C(360, 280, 60, t.acc) + S('M300 220L300 180M360 220L360 180', t.ink, 3) + P('M300 180L290 160L300 140L310 160Z', '#fff') + P('M360 180L350 160L360 140L370 160Z', '#fff') + C(330, 160, 14, K.gold) + use(PLA.rose, 130, 380, .7, t) + use(PLA.rose, 570, 380, .7, t) + use(OBJ.heart_obj, 620, 130, .5, t) + dots(20, 5, K.gold, 2, 4, CW, CH, .5));
  cadd('concept_graduation', (t) => CH_('graduate', 350, 396, 1.15, t, { skin: 'tan', pose: 'cheer' }) + use(OBJ.grad_cap, 130, 200, .9, t) + use(OBJ.trophy_cup, 570, 350, .8, t) + use(OBJ.book_stack, 130, 380, .9, t) + use(OBJ.medal_award, 570, 150, .7, t));
  cadd('concept_research', (t) => CH_('scientist', 350, 396, 1.15, t, { skin: 'light', style: 'short', pose: 'hold' }) + use(OBJ.magnifier, 130, 350, .9, t) + use(OBJ.microscope, 570, 350, .8, t) + use(OBJ.dna_helix, 590, 150, .7, t) + use(OBJ.notebook, 130, 150, .7, t));
  cadd('concept_newsletter', (t) => use(OBJ.envelope, 350, 300, 1.6, t) + use(OBJ.paper_plane, 130, 170, .8, t) + use(OBJ.smartphone, 570, 350, .9, t) + use(OBJ.check_badge, 590, 150, .6, t) + CH_('casual', 130, 396, .85, t, { skin: 'brown', pose: 'point', style: 'afro' }));
  cadd('concept_leadership', (t) => [0, 1, 2, 3, 4].map(i => R(100 + i * 90, 340 - i * 20, 80, 20 + i * 20, [t.a, t.b, t.c, t.e, t.acc][i], 6)).join('') + CH_('businessperson', 300, 320, .9, t, { skin: 'tan', pose: 'wave' }) + CH_('casual', 470, 320, .85, t, { skin: 'light', style: 'curly', gender: 'f' }) + use(OBJ.flag_obj, 620, 180, .8, t) + use(OBJ.target_obj, 100, 150, .6, t));

  // ---------- PATTERNS ----------
  const PT = {}, PTL = [];
  const padd = (id, fn) => { PT[id] = p => { const t = themeOf(p, 'ocean'), uid = _ilUid(); const gid = 'pt_' + uid; const defs = `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${t.bg[0]}"/><stop offset="100%" stop-color="${t.bg[1]}"/></linearGradient>`; return { w: LW, h: LH, defs, body: R(0, 0, LW, LH, `url(#${gid})`) + fn(t, rng(hashStr(id + (p.seed || '')))) }; }; PTL.push(id); };
  padd('pattern_waves', (t) => [0, 1, 2, 3, 4, 5, 6].map(i => P(`M0 ${60 + i * 50}C90 ${20 + i * 50} 180 ${100 + i * 50} 280 ${60 + i * 50}S470 ${20 + i * 50} 700 ${60 + i * 50}V400H0Z`, [t.d, t.c, t.b, t.a, t.e, t.c, t.a][i], ` opacity="${.5 + i * .07}"`)).join(''));
  padd('pattern_dots', (t) => { let s = ''; for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) s += C(24 + x * 48 + (y % 2) * 24, 24 + y * 46, 7, [t.a, t.b, t.c][(x + y) % 3], ' opacity=".55"'); return s; });
  padd('pattern_stripes', (t) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(i => R(i * 50, 0, 25, LH, i % 3 === 0 ? t.a : i % 3 === 1 ? t.b : t.c, 0, ' opacity=".5"')).join(''));
  padd('pattern_diagonal', (t) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => PG(`${i * 90 - 400},400 ${i * 90 - 340},400 ${i * 90 + 60},0 ${i * 90},0`, [t.a, t.c, t.e][i % 3], ' opacity=".4"')).join(''));
  padd('pattern_grid', (t) => { let s = ''; for (let i = 0; i <= 14; i++) s += `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="${LH}" stroke="${t.b}" stroke-width="2" opacity=".3"/>`; for (let j = 0; j <= 8; j++) s += `<line x1="0" y1="${j * 50}" x2="${LW}" y2="${j * 50}" stroke="${t.b}" stroke-width="2" opacity=".3"/>`; for (let j = 0; j <= 8; j++) for (let i = 0; i <= 14; i++) if ((i * 3 + j * 5) % 7 === 0) s += C(i * 50, j * 50, 5, t.a, ' opacity=".7"'); return s; });
  padd('pattern_hexagons', (t) => { let s = ''; const hx = (cx, cy, r, f) => PG([0, 1, 2, 3, 4, 5].map(k => `${rnd(cx + r * Math.cos(k * Math.PI / 3 + Math.PI / 6))},${rnd(cy + r * Math.sin(k * Math.PI / 3 + Math.PI / 6))}`).join(' '), f, ' opacity=".55"'); for (let y = 0; y < 9; y++) for (let x = 0; x < 12; x++) s += hx(30 + x * 60 + (y % 2) * 30, 26 + y * 52, 27, [t.a, t.b, t.c, t.d, t.e][(x * 2 + y * 3) % 5]); return s; });
  padd('pattern_triangles', (t) => { let s = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 15; x++) { const X = x * 50, Y = y * 50; s += PG(`${X},${Y + 50} ${X + 25},${Y} ${X + 50},${Y + 50}`, [t.a, t.b, t.c, t.d][(x + y * 2) % 4], ' opacity=".5"'); } return s; });
  padd('pattern_circles', (t, r) => { let s = ''; for (let i = 0; i < 26; i++) s += C(rnd(r() * LW), rnd(r() * LH), rnd(24 + r() * 70), [t.a, t.b, t.c, t.e, t.acc][i % 5], ' opacity=".28"'); return s; });
  padd('pattern_blobs', (t, r) => { let s = ''; for (let i = 0; i < 9; i++) { const cx = r() * LW, cy = r() * LH, k = 50 + r() * 80; s += P(`M${rnd(cx)} ${rnd(cy - k)}C${rnd(cx + k)} ${rnd(cy - k)} ${rnd(cx + k * 1.2)} ${rnd(cy + k * .2)} ${rnd(cx + k * .3)} ${rnd(cy + k)}C${rnd(cx - k)} ${rnd(cy + k * 1.1)} ${rnd(cx - k * 1.2)} ${rnd(cy - k * .3)} ${rnd(cx)} ${rnd(cy - k)}Z`, [t.a, t.b, t.c, t.e, t.acc][i % 5], ' opacity=".4"'); } return s; });
  padd('pattern_confetti', (t, r) => { let s = ''; for (let i = 0; i < 90; i++) { const x = r() * LW, y = r() * LH, c = [t.a, t.b, t.c, t.e, t.acc][i % 5]; s += i % 3 === 0 ? C(rnd(x), rnd(y), 5, c) : i % 3 === 1 ? G(R(-8, -3, 16, 6, c, 2), `translate(${rnd(x)} ${rnd(y)}) rotate(${Math.round(r() * 180)})`) : G(PG('0,-8 7,6 -7,6', c), `translate(${rnd(x)} ${rnd(y)}) rotate(${Math.round(r() * 360)})`); } return s; });
  padd('pattern_topography', (t) => { let s = ''; for (let i = 0; i < 12; i++) s += `<ellipse cx="350" cy="200" rx="${40 + i * 34}" ry="${24 + i * 20}" fill="none" stroke="${i % 2 ? t.b : t.c}" stroke-width="3" opacity=".5" transform="rotate(${i * 4} 350 200)"/>`; for (let i = 0; i < 5; i++) s += `<ellipse cx="130" cy="330" rx="${20 + i * 26}" ry="${14 + i * 16}" fill="none" stroke="${t.a}" stroke-width="3" opacity=".4"/>`; return s; });
  padd('pattern_zigzag', (t) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => S(`M0 ${30 + i * 50}` + Array.from({ length: 15 }, (_, k) => `L${(k + 1) * 50} ${30 + i * 50 + (k % 2 ? 0 : 26)}`).join(''), [t.a, t.b, t.c, t.e][i % 4], 6, ' opacity=".55"')).join(''));
  padd('pattern_scales', (t) => { let s = ''; for (let y = 0; y < 14; y++) for (let x = 0; x < 15; x++) s += C(x * 50 + (y % 2) * 25, y * 25, 25, [t.a, t.b, t.c, t.d][(x + y) % 4], ` stroke="${t.light}" stroke-width="2" opacity=".55"`); return s; });
  padd('pattern_plus', (t) => { let s = ''; for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) s += S(`M${x * 50 + 16 + (y % 2) * 25} ${y * 46 + 26}h16M${x * 50 + 24 + (y % 2) * 25} ${y * 46 + 18}v16`, [t.a, t.b, t.e][(x + y) % 3], 3.5, ' opacity=".5"'); return s; });
  padd('pattern_sunburst', (t) => { let s = ''; for (let i = 0; i < 24; i++) s += PG(`350,400 ${rnd(350 + 900 * Math.cos((i * 15 - 90) * Math.PI / 180))},${rnd(400 + 900 * Math.sin((i * 15 - 90) * Math.PI / 180))} ${rnd(350 + 900 * Math.cos(((i + 1) * 15 - 90) * Math.PI / 180))},${rnd(400 + 900 * Math.sin(((i + 1) * 15 - 90) * Math.PI / 180))}`, i % 2 ? t.c : t.d, ' opacity=".5"'); return s + C(350, 400, 120, t.acc, ' opacity=".7"') + C(350, 400, 84, t.light, ' opacity=".7"'); });
  padd('pattern_bokeh', (t, r) => { let s = ''; for (let i = 0; i < 30; i++) s += C(rnd(r() * LW), rnd(r() * LH), rnd(14 + r() * 46), [t.light, t.c, t.acc, t.d][i % 4], ` opacity="${(0.15 + r() * 0.3).toFixed(2)}"`); return s; });
  padd('pattern_stars', (t, r) => { let s = ''; for (let i = 0; i < 44; i++) { const x = r() * LW, y = r() * LH, k = 6 + r() * 12; s += G(PG('0,-10 3,-3 10,-3 4,2 6,9 0,5 -6,9 -4,2 -10,-3 -3,-3', [t.a, t.acc, t.c, t.light][i % 4], ' opacity=".7"'), `translate(${rnd(x)} ${rnd(y)}) scale(${rnd(k / 10)})`); } return s; });
  padd('pattern_checker', (t) => { let s = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) if ((x + y) % 2 === 0) s += R(x * 50, y * 50, 50, 50, t.a, 0, ' opacity=".18"'); return s; });
  padd('pattern_rings', (t, r) => { let s = ''; for (let i = 0; i < 16; i++) s += C(rnd(r() * LW), rnd(r() * LH), rnd(20 + r() * 50), 'none', ` stroke="${[t.a, t.b, t.e, t.acc][i % 4]}" stroke-width="${4 + (i % 3) * 2}" opacity=".45"`); return s; });
  padd('pattern_mesh', (t) => C(120, 90, 260, t.c, ' opacity=".55"') + C(600, 80, 240, t.e, ' opacity=".45"') + C(420, 340, 280, t.b, ' opacity=".45"') + C(90, 380, 200, t.acc, ' opacity=".35"') + C(600, 380, 170, t.d, ' opacity=".6"'));
  padd('pattern_arrows', (t) => { let s = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 15; x++) { const X = x * 50 + 25, Y = y * 50 + 25; s += S(`M${X - 14} ${Y}H${X + 6}M${X - 2} ${Y - 8}L${X + 8} ${Y}L${X - 2} ${Y + 8}`, [t.a, t.b, t.e][(x + y) % 3], 3, ' opacity=".5"'); } return s; });
  padd('pattern_leaves', (t) => { let s = ''; for (let y = 0; y < 6; y++) for (let x = 0; x < 9; x++) s += _ilLeaf(40 + x * 80 + (y % 2) * 40, 30 + y * 70, (x * 37 + y * 53) % 360, 34, 18, [t.a, t.b, t.c, t.e][(x + y) % 4]); return s; });
  padd('pattern_crosshatch', (t) => { let s = ''; for (let i = -8; i < 22; i++) { s += S(`M${i * 50} 0L${i * 50 + 400} 400`, t.a, 2, ' opacity=".28"'); s += S(`M${i * 50} 400L${i * 50 + 400} 0`, t.b, 2, ' opacity=".22"'); } return s; });
  padd('pattern_pixels', (t, r) => { let s = ''; for (let y = 0; y < 10; y++) for (let x = 0; x < 18; x++) if (r() > .5) s += R(x * 40, y * 40, 38, 38, [t.a, t.b, t.c, t.e][(x * 3 + y * 5) % 4], 4, ' opacity=".5"'); return s; });
  padd('pattern_ripple', (t) => { let s = ''; for (let cx = 0; cx <= LW; cx += 140) for (let i = 1; i <= 4; i++) s += C(cx, LH, i * 40, 'none', ` stroke="${i % 2 ? t.a : t.c}" stroke-width="3" opacity=".4"`); return s; });
  padd('pattern_puzzle', (t) => { let s = ''; for (let y = 0; y < 7; y++) for (let x = 0; x < 12; x++) { const X = x * 60, Y = y * 60, c = [t.a, t.b, t.c, t.e][(x + y) % 4]; s += R(X + 4, Y + 4, 52, 52, c, 8, ' opacity=".4"') + C(X + 56, Y + 30, 7, c, ' opacity=".4"'); } return s; });

  // ----- v3 new patterns -----
  padd('pattern_diamonds', (t) => { let s = ''; for (let y = 0; y < 10; y++) for (let x = 0; x < 15; x++) { const X = x * 50 + (y % 2) * 25, Y = y * 40; s += PG(`${X},${Y - 20} ${X + 20},${Y} ${X},${Y + 20} ${X - 20},${Y}`, [t.a, t.b, t.c, t.e][(x + y) % 4], ' opacity=".55"'); } return s; });
  padd('pattern_plaid', (t) => { let s = ''; for (let i = 0; i < 7; i++) s += R(i * 100, 0, 40, LH, t.a, 0, ' opacity=".35"'); for (let j = 0; j < 4; j++) s += R(0, j * 100, LW, 40, t.a, 0, ' opacity=".35"'); for (let i = 0; i < 7; i++) s += R(i * 100 + 60, 0, 20, LH, t.b, 0, ' opacity=".4"'); for (let j = 0; j < 4; j++) s += R(0, j * 100 + 60, LW, 20, t.b, 0, ' opacity=".4"'); return s; });
  padd('pattern_seigaiha', (t) => { let s = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) { const cx = x * 70 + (y % 2) * 35, cy = y * 60 + 60; s += `<path d="M${cx - 35},${cy} A35 35 0 0 1 ${cx + 35},${cy}" fill="none" stroke="${[t.a, t.b, t.c, t.e][(x + y) % 4]}" stroke-width="3" opacity=".5"/>`; s += `<path d="M${cx - 25},${cy} A25 25 0 0 1 ${cx + 25},${cy}" fill="none" stroke="${[t.a, t.b, t.c, t.e][(x + y) % 4]}" stroke-width="2" opacity=".4"/>`; s += `<path d="M${cx - 15},${cy} A15 15 0 0 1 ${cx + 15},${cy}" fill="none" stroke="${[t.a, t.b, t.c, t.e][(x + y) % 4]}" stroke-width="2" opacity=".3"/>`; } return s; });
  padd('pattern_moroccan', (t) => { let s = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) { const cx = x * 60 + (y % 2) * 30, cy = y * 55 + 30; s += P(`M${cx} ${cy - 20}L${cx + 20} ${cy}L${cx} ${cy + 20}L${cx - 20} ${cy}Z`, 'none', ` stroke="${[t.a, t.b, t.c][(x + y) % 3]}" stroke-width="3" opacity=".55"`); s += C(cx, cy, 4, [t.a, t.b, t.c][(x + y) % 3], ' opacity=".7"'); } return s; });
  padd('pattern_honeycomb', (t) => { let s = ''; for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) { const cx = x * 52 + (y % 2) * 26, cy = y * 46; const pts = [0, 1, 2, 3, 4, 5].map(k => `${rnd(cx + 26 * Math.cos(k * Math.PI / 3 + Math.PI / 6))},${rnd(cy + 26 * Math.sin(k * Math.PI / 3 + Math.PI / 6))}`).join(' '); s += PG(pts, 'none', ` stroke="${[t.a, t.b, t.c][(x + y) % 3]}" stroke-width="3" opacity=".55"`); } return s; });
  padd('pattern_herringbone', (t) => { let s = ''; for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) { const X = x * 60 + (y % 2) * 30, Y = y * 40; s += G(R(-25, -6, 50, 12, [t.a, t.b, t.c][(x + y) % 3], 4, ' opacity=".55"'), `translate(${X} ${Y}) rotate(45)`); s += G(R(-25, -6, 50, 12, [t.b, t.c, t.a][(x + y) % 3], 4, ' opacity=".55"'), `translate(${X} ${Y}) rotate(-45)`); } return s; });
  padd('pattern_dashes', (t) => { let s = ''; for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) { s += G(R(-12, -3, 24, 6, [t.a, t.b, t.c, t.e][(x + y) % 4], 3, ' opacity=".65"'), `translate(${x * 38 + (y % 2) * 19} ${y * 42}) rotate(${(x + y) * 17 % 90})`); } return s; });
  padd('pattern_cross_stitch', (t) => { let s = ''; for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) { const X = x * 46, Y = y * 42; s += S(`M${X + 8} ${Y + 8}L${X + 32} ${Y + 32}M${X + 32} ${Y + 8}L${X + 8} ${Y + 32}`, [t.a, t.b, t.c][(x + y) % 3], 3, ' opacity=".55"'); } return s; });
  padd('pattern_ikat', (t, r) => { let s = ''; for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) { const cx = x * 90 + (y % 2) * 45, cy = y * 70 + 40; const k = 30 + r() * 8; s += P(`M${cx - k} ${cy}C${cx - k} ${cy - k} ${cx + k} ${cy - k} ${cx + k} ${cy}C${cx + k} ${cy + k} ${cx - k} ${cy + k} ${cx - k} ${cy}Z`, 'none', ` stroke="${[t.a, t.b, t.e][(x + y) % 3]}" stroke-width="4" opacity=".55"`); s += C(cx, cy, 5, [t.a, t.b, t.e][(x + y) % 3], ' opacity=".7"'); } return s; });
  padd('pattern_bubbles', (t, r) => { let s = ''; for (let i = 0; i < 60; i++) { const x = r() * LW, y = r() * LH, rad = 8 + r() * 26; s += C(x, y, rad, 'none', ` stroke="${[t.a, t.b, t.c, t.e][i % 4]}" stroke-width="3" opacity=".55"`); s += C(x - rad * 0.3, y - rad * 0.3, rad * 0.2, t.light, ' opacity=".7"'); } return s; });

  // ---------- DECOR ----------
  const DC = {}, DCL = [];
  const dadd = (id, w, h, fn) => { DC[id] = p => { const t = themeOf(p, 'corporate'); const transparent = String(p.bg || 'none') === 'none'; return { w, h, defs: '', body: (transparent ? '' : R(0, 0, w, h, t.bg[0])) + fn(t, w, h) }; }; DCL.push(id); };
  dadd('decor_ribbon_banner', 700, 220, (t) => PG('20,60 120,60 120,160 20,160 60,110', t.b) + PG('680,60 580,60 580,160 680,160 640,110', t.b) + PG('120,150 160,150 160,180 120,160', '#000', ' opacity=".2"') + PG('580,150 540,150 540,180 580,160', '#000', ' opacity=".2"') + P('M100 40H600V150H100Z', t.a) + P('M100 40H600V70H100Z', '#fff', ' opacity=".12"') + `<text x="350" y="112" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="34" fill="#fff" letter-spacing="3">TITLE HERE</text>`);
  dadd('decor_laurel', 360, 360, (t) => [-1, 1].map(sd => Array.from({ length: 11 }, (_, i) => { const a = (24 + i * 15) * Math.PI / 180, x = 180 + sd * 118 * Math.sin(a), y = 180 + 118 * Math.cos(a), dir = Math.atan2(-Math.sin(a), sd * Math.cos(a)) * 180 / Math.PI; return G(P('M0 0C10 -12 28 -12 38 0C28 12 10 12 0 0Z', i % 2 ? t.b : t.a), `translate(${rnd(x)} ${rnd(y)}) rotate(${rnd(dir + (i % 2 ? 24 : -24))})`); }).join('')).join('') + C(180, 180, 54, t.acc, ' opacity=".9"') + PG('180,150 190,172 214,174 196,190 202,214 180,202 158,214 164,190 146,174 170,172', '#fff'));
  dadd('decor_seal_badge', 360, 360, (t) => Array.from({ length: 24 }, (_, i) => G(PG('0,-150 22,-118 -22,-118', t.a), `translate(180 180) rotate(${i * 15})`)).join('') + C(180, 180, 128, t.a) + C(180, 180, 112, 'none', ' stroke="#fff" stroke-width="4" stroke-dasharray="3 9"') + C(180, 180, 92, t.b) + PG('180,120 195,160 238,162 204,188 216,230 180,206 144,230 156,188 122,162 165,160', K.gold));
  dadd('decor_divider_leaf', 700, 120, (t) => L(40, 60, 300, 60, t.c, 3) + L(400, 60, 660, 60, t.c, 3) + G(P('M0 0C14 -20 40 -20 54 0C40 20 14 20 0 0Z', t.b), 'translate(292 60) rotate(-20) scale(1.3)') + G(P('M0 0C14 -20 40 -20 54 0C40 20 14 20 0 0Z', t.a), 'translate(350 60) rotate(-90) scale(.8)') + G(P('M0 0C14 -20 40 -20 54 0C40 20 14 20 0 0Z', t.b), 'translate(400 60) rotate(200) scale(1)') + C(350, 60, 6, t.acc));
  dadd('decor_divider_stars', 700, 120, (t) => L(40, 60, 250, 60, t.c, 3) + L(450, 60, 660, 60, t.c, 3) + [[290, 8], [350, 14], [410, 8]].map(a => G(PG('0,-10 3,-3 10,-3 4,2 6,9 0,5 -6,9 -4,2 -10,-3 -3,-3', t.acc), `translate(${a[0]} 60) scale(${a[1] / 6})`)).join(''));
  dadd('decor_divider_wave', 700, 120, (t) => S('M20 60C60 20 100 100 140 60S220 20 260 60S340 100 380 60S460 20 500 60S580 100 620 60S680 40 690 60', t.b, 6) + S('M20 76C60 36 100 116 140 76S220 36 260 76S340 116 380 76S460 36 500 76S580 116 620 76', t.c, 4, ' opacity=".6"'));
  dadd('decor_corner_flourish', 360, 360, (t) => S('M20 340V90C20 50 50 20 90 20H340', t.a, 8) + S('M44 340V110C44 74 74 44 110 44H340', t.c, 4) + C(20, 340, 10, t.acc) + C(340, 20, 10, t.acc) + G(P('M0 0C14 -20 40 -20 54 0C40 20 14 20 0 0Z', t.b), 'translate(58 58) rotate(45)') + [[120, 20], [20, 120]].map(p => C(p[0], p[1], 6, t.acc)).join(''));
  dadd('decor_frame_arch', 360, 460, (t) => P('M30 440V190C30 90 100 30 180 30C260 30 330 90 330 190V440Z', t.d) + P('M60 440V196C60 108 116 58 180 58C244 58 300 108 300 196V440Z', t.light) + S('M30 440V190C30 90 100 30 180 30C260 30 330 90 330 190V440', t.a, 8) + S('M46 440V192C46 98 108 44 180 44C252 44 314 98 314 192V440', t.c, 3));
  dadd('decor_sparkles', 360, 360, (t) => [[180, 180, 110, t.a], [280, 90, 44, t.acc], [80, 96, 34, t.c], [90, 280, 46, t.e], [286, 276, 30, t.b]].map(a => G(P('M0 -100C6 -30 30 -6 100 0C30 6 6 30 0 100C-6 30 -30 6 -100 0C-30 -6 -6 -30 0 -100Z', a[3]), `translate(${a[0]} ${a[1]}) scale(${a[2] / 100})`)).join(''));
  dadd('decor_speech_frame', 460, 360, (t) => P('M40 30H420C440 30 450 40 450 60V240C450 260 440 270 420 270H210L130 340V270H40C20 270 10 260 10 240V60C10 40 20 30 40 30Z', t.a) + P('M56 50H404C420 50 430 58 430 74V226C430 242 420 250 404 250H196L146 296V250H56C40 250 30 242 30 226V74C30 58 40 50 56 50Z', t.light) + C(60, 40, 6, t.acc) + C(400, 40, 6, t.acc));
  dadd('decor_bunting', 700, 220, (t) => S('M20 30C200 110 500 110 680 30', t.ink, 4) + Array.from({ length: 9 }, (_, i) => { const x = 60 + i * 72, y = 30 + 80 * Math.sin((x - 20) / 660 * Math.PI) * 0.98 + 6; return PG(`${x - 26},${rnd(y - 4)} ${x + 26},${rnd(y - 4)} ${x},${rnd(y + 56)}`, [t.a, t.b, t.c, t.e, t.acc][i % 5]); }).join(''));
  dadd('decor_wreath_round', 360, 360, (t) => { let s = ''; for (let i = 0; i < 28; i++) { const a = i * 360 / 28; s += G(P('M-18 0C-8 -12 10 -12 18 0C10 12 -8 12 -18 0Z', i % 3 === 0 ? t.acc : i % 2 ? t.b : t.a), `translate(180 180) rotate(${a}) translate(112 0) rotate(${90 + (i % 2 ? 28 : -28)})`); } return s + C(180, 180, 84, 'none', ` stroke="${t.c}" stroke-width="3" opacity=".6"`); });
  dadd('decor_confetti_burst', 360, 360, (t) => { let s = ''; const r = rng(21); for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2, d = 40 + r() * 140, x = 180 + Math.cos(a) * d, y = 180 + Math.sin(a) * d, c = [t.a, t.b, t.c, t.e, t.acc][i % 5]; s += i % 2 ? C(x, y, 4 + r() * 3, c) : G(R(-6, -3, 12, 6, c, 2), `translate(${rnd(x)} ${rnd(y)}) rotate(${Math.round(r() * 180)})`); } return s + C(180, 180, 30, t.acc); });
  dadd('decor_ribbon_tag', 360, 220, (t) => P('M30 40H280C300 40 300 60 280 80L200 110L280 140C300 160 300 180 280 180H30Z', t.a) + C(70, 110, 10, t.light) + `<text x="170" y="118" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="26" fill="#fff">SALE</text>`);
  dadd('decor_starburst_frame', 360, 360, (t) => { let s = ''; for (let i = 0; i < 16; i++) s += G(PG('0,-160 10,-118 -10,-118', i % 2 ? t.a : t.c), `translate(180 180) rotate(${i * 22.5})`); return s + C(180, 180, 100, t.b) + C(180, 180, 84, t.light); });
  dadd('decor_leaf_corner', 360, 360, (t) => { let s = ''; for (let i = 0; i < 7; i++) { const a = 10 + i * 10; s += _ilLeaf(30 + i * 4, 30 + i * 4, a, 90 - i * 4, 40 - i * 2, i % 2 ? t.a : t.b); } return s; });
  dadd('decor_balloon_cluster', 360, 360, (t) => { const b = (x, y, rx, ry, c) => E(x, y, rx, ry, c) + S(`M${x} ${y + ry}C${x - 6} ${y + ry + 40} ${x + 6} ${y + ry + 60} ${x} ${y + ry + 90}`, t.ink, 2); return b(140, 140, 44, 54, t.a) + b(200, 110, 38, 48, t.acc) + b(240, 160, 36, 46, t.c) + PG('190,290 196,296 184,296', t.ink); });
  dadd('decor_wave_banner', 700, 180, (t) => P('M0 60C120 20 240 100 360 60S600 20 700 60V140C580 180 460 100 340 140S120 180 0 140Z', t.a) + `<text x="350" y="108" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="30" fill="#fff" letter-spacing="2">BANNER</text>`);

  // ----- v3 new decor -----
  dadd('decor_number_badge', 200, 200, (t) => C(100, 100, 80, t.a) + C(100, 100, 68, t.d) + C(100, 100, 56, t.a) + `<text x="100" y="130" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="80" fill="#fff">1</text>` + C(160, 40, 12, t.acc) + C(40, 160, 8, t.acc));
  dadd('decor_arrow_banner', 700, 200, (t) => P('M20 60H680L640 100L680 140H20Z', t.a) + P('M20 70H620L590 100L620 130H20Z', t.light) + `<text x="330" y="116" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="34" fill="${t.ink}" letter-spacing="2">NEXT</text>` + S('M580 80L620 100L580 120', t.a, 4));
  dadd('decor_quote_card', 500, 300, (t) => R(20, 20, 460, 260, t.light, 16) + R(20, 20, 460, 60, t.a, 16) + `<text x="60" y="58" font-family="Georgia, serif" font-weight="900" font-size="48" fill="#fff">"</text>` + P('M60 110H120V170H100C80 170 70 160 70 140V130H60Z', t.a, ' opacity=".9"') + P('M120 110H180V170H160C140 170 130 160 130 140V130H120Z', t.a, ' opacity=".9"') + S('M60 200H440M60 230H400M60 260H320', t.d, 6));
  dadd('decor_hexagon_badge', 300, 300, (t) => { const cx = 150, cy = 150, r = 130; const pts = [0, 1, 2, 3, 4, 5].map(k => `${rnd(cx + r * Math.cos(k * Math.PI / 3 + Math.PI / 6))},${rnd(cy + r * Math.sin(k * Math.PI / 3 + Math.PI / 6))}`).join(' '); const ptsIn = [0, 1, 2, 3, 4, 5].map(k => `${rnd(cx + (r - 20) * Math.cos(k * Math.PI / 3 + Math.PI / 6))},${rnd(cy + (r - 20) * Math.sin(k * Math.PI / 3 + Math.PI / 6))}`).join(' '); return PG(pts, t.a) + PG(ptsIn, t.light) + `<text x="150" y="170" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="60" fill="${t.a}">★</text>`; });
  dadd('decor_frame_circle', 400, 400, (t) => C(200, 200, 180, 'none', ` stroke="${t.a}" stroke-width="10"`) + C(200, 200, 160, 'none', ` stroke="${t.b}" stroke-width="4"`) + C(200, 200, 130, t.light) + C(200, 200, 130, 'none', ` stroke="${t.a}" stroke-width="2"`) + [0, 1, 2, 3, 4, 5, 6, 7].map(i => G(C(0, -180, 8, t.acc), `translate(200 200) rotate(${i * 45})`)).join('') + C(200, 200, 20, t.a, ' opacity=".3"'));
  dadd('decor_star_burst', 400, 400, (t) => { let s = ''; for (let i = 0; i < 20; i++) s += G(PG('0,-190 14,-140 -14,-140', [t.a, t.b, t.c, t.acc][i % 4]), `translate(200 200) rotate(${i * 18})`); return s + C(200, 200, 100, t.light) + C(200, 200, 70, t.a, ' opacity=".85"') + PG('200,140 210,180 250,182 218,208 228,246 200,224 172,246 182,208 150,182 190,180', K.gold); });

  // ---------- REGISTRATION ----------
  Object.keys(SC).forEach(k => { ILLUSTRATION_SCENES[k] = SC[k]; });
  Object.keys(CN).forEach(k => { ILLUSTRATION_SCENES[k] = { render: CN[k], defaultShape: 'wide' }; });
  Object.keys(PT).forEach(k => { ILLUSTRATION_SCENES[k] = { render: PT[k], defaultShape: 'wide' }; });
  Object.keys(DC).forEach(k => { ILLUSTRATION_SCENES[k] = { render: DC[k], defaultShape: 'wide' }; });
  Object.assign(ILLUSTRATION_SCENES, {
    object: { render: renderObject, defaultShape: 'rounded' },
    animal: { render: renderAnimal, defaultShape: 'rounded' },
    plant: { render: renderPlant, defaultShape: 'rounded' },
    building: { render: renderBuilding, defaultShape: 'rounded' },
    vehicle: { render: renderVehicle, defaultShape: 'rounded' },
    character: { render: renderCharacter, defaultShape: 'rounded' },
    icon_badge: { render: renderIconBadgeExt, defaultShape: 'circle' },
    icon_grid: { render: renderIconGrid, defaultShape: 'rounded' }
  });

  // catalog data for the prompt + stats
  _ilExt.data = {
    OBJ_CATS, ANI_LIST, PLA_LIST, BLD_LIST, VEH_LIST, CHR_LIST, ICON_CATS, HAIR_STYLES,
    SEASONS: Object.keys(SEASONS), FURS: Object.keys(FURS), SKINS: Object.keys(SKINS), HAIRS: Object.keys(HAIRS),
    LANDSCAPES: SCN, CONCEPTS: CNL, PATTERNS: PTL, DECORS: DCL,
    ACCESSORIES: ['bow', 'scarf', 'party_hat', 'crown', 'glasses', 'flower', 'headphones'],
    objects: OBJ, animals: ANI, plants: PLA, buildings: BLD, vehicles: VEH, icons: ICONS
  };
})();

function _ilParseParams(paramString) {
  const out = {};
  if (!paramString || typeof paramString !== 'string') return out;
  paramString.split('|').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq === -1) return;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const value = pair.slice(eq + 1).trim();
    if (key) out[key] = value;
  });
  if (out.count != null) {
    const n = parseInt(out.count, 10);
    out.count = Number.isFinite(n) ? n : undefined;
  }
  return out;
}

function _ilWrap(scene, shape) {
  const { w, h, defs, body } = scene;
  const uid = _ilUid();
  let clipDefs = '', clipAttr = '';
  const s = String(shape || '').toLowerCase();
  if (s === 'circle') {
    const r = Math.min(w, h) / 2;
    clipDefs = `<clipPath id="clip_${uid}"><circle cx="${_ilR1(w / 2)}" cy="${_ilR1(h / 2)}" r="${_ilR1(r)}"/></clipPath>`;
    clipAttr = ` clip-path="url(#clip_${uid})"`;
  } else if (s === 'rounded') {
    const rx = Math.min(w, h) * 0.12;
    clipDefs = `<clipPath id="clip_${uid}"><rect x="0" y="0" width="${w}" height="${h}" rx="${_ilR1(rx)}" ry="${_ilR1(rx)}"/></clipPath>`;
    clipAttr = ` clip-path="url(#clip_${uid})"`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
  <defs>${defs}${clipDefs}</defs>
  <g${clipAttr}>${body}</g>
</svg>`;
}

function renderIllustrationByScene(sceneId, paramString) {
  const scene = ILLUSTRATION_SCENES[String(sceneId || '').trim().toLowerCase()];
  if (!scene) return null;
  const params = _ilParseParams(paramString);
  try {
    const result = scene.render(params);
    const shape = params.shape || scene.defaultShape || 'wide';
    return _ilWrap(result, shape);
  } catch (e) {
    console.warn('[IllustrationLibrary] render failed for', sceneId, e);
    return null;
  }
}

function injectIllustrationTemplates(html) {
  if (!html || typeof html !== 'string' || html.indexOf('ILLUSTRATION:') === -1) return html;
  return html.replace(/<!--\s*ILLUSTRATION:([a-zA-Z0-9_]+):([\s\S]*?)-->/g, function (match, sceneId, paramString) {
    const svg = renderIllustrationByScene(sceneId, paramString);
    return svg || match;
  });
}

function getIllustrationCatalogForPrompt() {
  const d = _ilExt.data || {};
  const paletteNames = Object.keys(ILLUSTRATION_PALETTES).concat(Object.keys(ILLUSTRATION_THEMES)).join(', ');
  const objLines = Object.keys(d.OBJ_CATS || {}).map(c => `    ${c}: ${d.OBJ_CATS[c].join(', ')}`).join('\n');
  const iconLines = Object.keys(d.ICON_CATS || {}).map(c => `    ${c}: ${d.ICON_CATS[c].join(', ')}`).join('\n');
  return [
    'MATCH RULE: only use an entry below as an ILLUSTRATION/object/animal/plant/building/vehicle/character/icon placeholder if it is a genuine, near-exact (~90-100%) match for the actual subject being depicted — never substitute "the closest-sounding" entry for something that is not really there. If nothing below is a real match, hand-draw a small custom SVG instead (see the calling instructions for the fallback option).',
    'landscape_water — sunset/night mountains + water + reflection + birds (rivers, lakes, coastal, calm/scenic topics)',
    'landscape_valley — daytime rolling hills/mountains + sun + road + trees (nature, geography, growth, journey topics)',
    'cityscape — row of flat-style buildings with windows (urban, infrastructure, business, city-life topics)',
    'person_thinking — person figure + thought bubble with a symbol (questions, problem-solving, ideas, decisions)',
    'person_nature — person portrait framed by large tropical leaves (wellness, nature-connection, growth, care topics)',
    'icon_badge — badge with a centered symbol icon (a generic concept icon/accent for any topic). Params: symbol=<any icon name below>; style=solid|tile|soft|outline|ring|flat|duo',
    'icon_grid — grid of 3-12 icons from one category (feature lists, "what we cover" slides). Params: category=<icon category>; count=3..12; start=<offset>; symbols=<comma list>; labels=1 to print names',
    `More LANDSCAPES (wide, 700x400): ${(d.LANDSCAPES || []).join(', ')}`,
    `CONCEPT SCENES (wide, story-style compositions of objects + people): ${(d.CONCEPTS || []).join(', ')}`,
    `PATTERNS (wide decorative backgrounds): ${(d.PATTERNS || []).join(', ')}`,
    `DECOR (dividers, banners, badges, frames): ${(d.DECORS || []).join(', ')}`,
    `object — one flat spot illustration; param item=<name>; names by category:\n${objLines}`,
    `animal — cute animal; item=<${(d.ANI_LIST || []).join(', ')}>; optional fur=<${(d.FURS || []).join('|')}> (cat/dog/bear etc.), accessory=<${(d.ACCESSORIES || []).join('|')}>`,
    `plant — item=<${(d.PLA_LIST || []).join(', ')}>; optional season=<${(d.SEASONS || []).join('|')}> (trees)`,
    `building — item=<${(d.BLD_LIST || []).join(', ')}>`,
    `vehicle — item=<${(d.VEH_LIST || []).join(', ')}>`,
    `character — full-body person; role=<${(d.CHR_LIST || []).join(', ')}>; skin=<${(d.SKINS || []).filter(s => s !== 'fair').join('|')}>; style=<${(d.HAIR_STYLES || []).join('|')}>; haircolor=<${(d.HAIRS || []).join('|')}>; pose=stand|wave|point|hold|cheer; accessory=glasses`,
    `Icon names by category (for icon_badge symbol=, icon_grid): also the original ones question, idea, check, star, arrow, chat, gear, book, target, clock.\n${iconLines}`,
    `Params (all optional, key=value joined by "|"): palette=<${paletteNames}>; shape=wide|square|circle|rounded; bg=gradient|blob|circle|rings|dots|solid|none (object/animal/plant/building/vehicle/character); pose=thinking|giving|standing (person scenes only); symbol=<icon name> (person_thinking/icon_badge only); count=<number> (building count for cityscape, icon count for icon_grid).`
  ].join('\n      ');
}

function getIllustrationStats() {
  const d = _ilExt.data || {};
  const nObj = Object.keys(d.objects || {}).length, nAni = (d.ANI_LIST || []).length, nPla = (d.PLA_LIST || []).length,
    nBld = (d.BLD_LIST || []).length, nVeh = (d.VEH_LIST || []).length, nChr = (d.CHR_LIST || []).length, nIcon = Object.keys(d.icons || {}).length;
  const nScenes = Object.keys(ILLUSTRATION_SCENES).length;
  const palettes = Object.keys(ILLUSTRATION_PALETTES).length + Object.keys(ILLUSTRATION_THEMES).length;
  const subjects = nObj + nAni + nPla + nBld + nVeh + nChr + nIcon + (d.LANDSCAPES || []).length + (d.CONCEPTS || []).length + (d.PATTERNS || []).length + (d.DECORS || []).length + 6;
  return { objects: nObj, animals: nAni, plants: nPla, buildings: nBld, vehicles: nVeh, characterRoles: nChr, icons: nIcon,
    landscapes: (d.LANDSCAPES || []).length + 3, concepts: (d.CONCEPTS || []).length, patterns: (d.PATTERNS || []).length, decor: (d.DECORS || []).length,
    sceneIds: nScenes, palettes: palettes, distinctSubjects: subjects, subjectsTimesPalettes: subjects * palettes };
}

// ============================================================
// WINDOW EXPOSURE — Illustration Library
// ============================================================
window.ILLUSTRATION_PALETTES = ILLUSTRATION_PALETTES;
window.ILLUSTRATION_SCENES = ILLUSTRATION_SCENES;
window.injectIllustrationTemplates = injectIllustrationTemplates;
window.getIllustrationCatalogForPrompt = getIllustrationCatalogForPrompt;
window.getIllustrationStats = getIllustrationStats;
window.ILLUSTRATION_THEMES = ILLUSTRATION_THEMES;
window.renderIllustrationByScene = renderIllustrationByScene;