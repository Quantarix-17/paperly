// ========================================================================
// CHART LIBRARY — deterministic, code-computed data charts
// ========================================================================
// Freehand AI-drawn "bar charts" routinely get the actual math wrong: bar
// heights that don't match their own numbers, pie slices whose angles
// don't reflect the data, misaligned gridlines. None of that is a drawing
// problem — it's an arithmetic problem, and arithmetic is exactly what
// code does perfectly and language models do approximately.
//
// This file is the data-chart counterpart to diagram-library.js: instead
// of asking the AI to hand-draw a chart's geometry, the AI emits a small
// placeholder describing the DATA ONLY (chart type + labels + values),
// and this file computes every coordinate, bar height, gridline value and
// pie-slice angle from that data with normal arithmetic, then returns a
// self-contained, ready-to-render <svg>. The AI never touches chart
// geometry — it only ever supplies numbers.
//
// Supported placeholder syntax (see getChartCatalogForPrompt() for the
// exact prompt-facing spec):
//   <!--CHART:bar:title=...|labels=A,B,C|values=1,2,3|unit=%|colors=#4f7df3,#22c55e-->
//   <!--CHART:line:title=...|labels=Jan,Feb,Mar|values=10,14,9-->
//   <!--CHART:pie:title=...|labels=A,B,C|values=30,50,20-->
//   <!--CHART:donut:title=...|labels=A,B,C|values=30,50,20-->
// `labels`/`values`/`colors` are comma-separated; `title` and `unit` are
// optional. Unknown/malformed params fail soft (see injectChartTemplates).
// ========================================================================

const CHART_DEFAULT_PALETTE = [
  '#4f7df3', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#f97316'
];

// ===== PARAM PARSING =====
// Deliberately a flat "key=value|key=value" format rather than JSON: it
// has no characters ('"', '{', '}') that collide with being embedded
// inside an HTML comment, so the AI can produce it reliably every time.
function parseChartParamString(paramString) {
  const out = { title: '', labels: [], values: [], colors: [], unit: '' };
  if (!paramString || typeof paramString !== 'string') return out;
  paramString.split('|').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq === -1) return;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const value = pair.slice(eq + 1).trim();
    if (key === 'title') out.title = value;
    else if (key === 'unit') out.unit = value;
    else if (key === 'labels') out.labels = value.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'colors') out.colors = value.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'values') {
      out.values = value.split(',').map(s => {
        const n = parseFloat(String(s).trim().replace(/[^\d.\-]/g, ''));
        return Number.isFinite(n) ? n : 0;
      });
    }
  });
  // Keep labels/values in sync length-wise so a mismatched count never
  // throws mid-render — missing labels get an index, extra labels are dropped.
  const n = Math.max(out.values.length, out.labels.length);
  for (let i = 0; i < n; i++) {
    if (out.labels[i] === undefined) out.labels[i] = 'Item ' + (i + 1);
    if (out.values[i] === undefined) out.values[i] = 0;
  }
  return out;
}

function colorFor(params, i) {
  return params.colors[i] || CHART_DEFAULT_PALETTE[i % CHART_DEFAULT_PALETTE.length];
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "Nice" axis ceiling so gridlines land on round numbers instead of the
// raw max value (e.g. max=87 -> ceiling 100, not 87).
function niceCeiling(max) {
  if (max <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / magnitude;
  let niceNormalized;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function formatAxisValue(v) {
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}

// ===== CHART DATA STAMP =====
// Every generated <svg> carries the chart's exact source data
// (data-chart-type + data-chart JSON). The picture stays a picture on screen,
// but exporters (e.g. word-export.js -> native, editable Word charts) can read
// the real numbers back instead of guessing them from bar heights.
function chartDataAttrs(type, params, axis) {
  const payload = {
    title: params.title,
    unit: params.unit,
    labels: params.labels,
    values: params.values,
    colors: params.values.map((_, i) => colorFor(params, i))
  };
  if (axis) { payload.min = axis.min; payload.max = axis.max; }
  return ` data-chart-type="${type}" data-chart="${escXml(JSON.stringify(payload))}"`;
}

// ===== BAR CHART =====
function renderBarChart(params) {
  const W = 700, H = 420;
  const padL = 64, padR = 30, padT = params.title ? 56 : 26, padB = 64;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = params.values.length || 1;
  const maxVal = niceCeiling(Math.max(...params.values, 0));
  const gridCount = 4;

  const slot = plotW / n;
  const barW = Math.min(64, slot * 0.55);

  let gridlines = '';
  for (let g = 0; g <= gridCount; g++) {
    const val = (maxVal / gridCount) * g;
    const y = padT + plotH - (val / maxVal) * plotH;
    gridlines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e2e6ee" stroke-width="1"/>
    <text x="${padL - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="#6b7280">${escXml(formatAxisValue(val))}${params.unit ? escXml(params.unit) : ''}</text>`;
  }

  let bars = '';
  params.values.forEach((val, i) => {
    const cx = padL + slot * i + slot / 2;
    const barH = maxVal > 0 ? (Math.max(val, 0) / maxVal) * plotH : 0;
    const x = cx - barW / 2;
    const y = padT + plotH - barH;
    const color = colorFor(params, i);
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="${color}"/>
    <text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12.5" font-weight="600" fill="#1f2937">${escXml(formatAxisValue(val))}${params.unit ? escXml(params.unit) : ''}</text>
    <text x="${cx.toFixed(1)}" y="${(padT + plotH + 22).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12.5" fill="#374151">${escXml(params.labels[i])}</text>`;
  });

  const title = params.title ? `<text x="${W / 2}" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#111827">${escXml(params.title)}</text>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, sans-serif"${chartDataAttrs('bar', params, { min: 0, max: maxVal })}>
  ${title}
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#9ca3af" stroke-width="1.3"/>
  <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#9ca3af" stroke-width="1.3"/>
  ${gridlines}
  ${bars}
</svg>`;
}

// ===== LINE CHART =====
function renderLineChart(params) {
  const W = 700, H = 420;
  const padL = 64, padR = 30, padT = params.title ? 56 : 26, padB = 56;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = params.values.length || 1;
  const maxVal = niceCeiling(Math.max(...params.values, 0));
  const minVal = Math.min(...params.values, 0);
  const gridCount = 4;
  const color = colorFor(params, 0);

  const xFor = i => padL + (n === 1 ? plotW / 2 : (plotW / (n - 1)) * i);
  const yFor = v => padT + plotH - ((v - minVal) / (maxVal - minVal || 1)) * plotH;

  let gridlines = '';
  for (let g = 0; g <= gridCount; g++) {
    const val = minVal + ((maxVal - minVal) / gridCount) * g;
    const y = yFor(val);
    gridlines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e2e6ee" stroke-width="1"/>
    <text x="${padL - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="#6b7280">${escXml(formatAxisValue(val))}${params.unit ? escXml(params.unit) : ''}</text>`;
  }

  const points = params.values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');

  let markers = '';
  params.values.forEach((v, i) => {
    const x = xFor(i), y = yFor(v);
    markers += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#fff" stroke="${color}" stroke-width="2.5"/>
    <text x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12.5" font-weight="600" fill="#1f2937">${escXml(formatAxisValue(v))}${params.unit ? escXml(params.unit) : ''}</text>
    <text x="${x.toFixed(1)}" y="${(padT + plotH + 22).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12.5" fill="#374151">${escXml(params.labels[i])}</text>`;
  });

  const title = params.title ? `<text x="${W / 2}" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#111827">${escXml(params.title)}</text>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, sans-serif"${chartDataAttrs('line', params, { min: minVal, max: maxVal })}>
  ${title}
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#9ca3af" stroke-width="1.3"/>
  <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#9ca3af" stroke-width="1.3"/>
  ${gridlines}
  <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
  ${markers}
</svg>`;
}

// ===== PIE / DONUT CHART =====
// Uses the stroke-dasharray-on-a-circle technique: each slice's exact
// share of the circle's circumference is computed by code, so slice
// angles are always mathematically exact — never eyeballed.
function renderPieChart(params, isDonut) {
  const W = 620, H = 420;
  const cx = 230, cy = H / 2 + (params.title ? 10 : 0);
  const r = 130;
  const total = params.values.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  const circumference = 2 * Math.PI * r;
  const strokeWidth = isDonut ? r * 0.55 : r; // full pie: stroke spans the whole radius (solid disc-like wedges)
  const drawRadius = isDonut ? r : r / 2;

  let cumulative = 0;
  let slices = '';
  let labels = '';
  const legendX = 420, legendYStart = params.title ? 76 : 56, legendRowH = 30;

  params.values.forEach((val, i) => {
    const v = Math.max(val, 0);
    const fraction = v / total;
    const dash = fraction * circumference;
    const gap = circumference - dash;
    const offset = -((cumulative / total) * circumference);
    const color = colorFor(params, i);
    slices += `<circle cx="${cx}" cy="${cy}" r="${drawRadius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;

    const midFraction = (cumulative + v / 2) / total;
    const midAngle = midFraction * 2 * Math.PI - Math.PI / 2;
    const pct = Math.round(fraction * 1000) / 10;
    if (fraction >= 0.06) {
      const labelR = isDonut ? r : r * 0.65;
      const lx = cx + Math.cos(midAngle) * labelR;
      const ly = cy + Math.sin(midAngle) * labelR;
      labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12.5" font-weight="700" fill="${isDonut ? color : '#ffffff'}">${pct}%</text>`;
    }

    const ly2 = legendYStart + i * legendRowH;
    labels += `<rect x="${legendX}" y="${(ly2 - 12).toFixed(1)}" width="14" height="14" rx="3" fill="${color}"/>
    <text x="${legendX + 20}" y="${(ly2).toFixed(1)}" font-family="Arial, sans-serif" font-size="13" fill="#1f2937">${escXml(params.labels[i])} (${pct}%)</text>`;

    cumulative += v;
  });

  const title = params.title ? `<text x="${W / 2}" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#111827">${escXml(params.title)}</text>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, sans-serif"${chartDataAttrs(isDonut ? 'donut' : 'pie', params)}>
  ${title}
  ${slices}
  ${labels}
</svg>`;
}

// ===== DISPATCH =====
const CHART_RENDERERS = {
  bar: p => renderBarChart(p),
  line: p => renderLineChart(p),
  pie: p => renderPieChart(p, false),
  donut: p => renderPieChart(p, true)
};

function renderChartByType(type, paramString) {
  const key = String(type || '').trim().toLowerCase();
  const renderer = CHART_RENDERERS[key];
  if (!renderer) return null;
  const params = parseChartParamString(paramString);
  if (!params.values.length) return null;
  try {
    return renderer(params);
  } catch (e) {
    console.warn('[ChartLibrary] render failed for', key, e);
    return null;
  }
}

// ===== PLACEHOLDER SUBSTITUTION =====
// Same choke-point pattern as injectDiagramTemplates(): replaces every
// <!--CHART:type:params--> comment with the real, code-computed SVG.
// Unknown type or unparsable params is a safe no-op (placeholder is just
// invisible HTML), so a malformed AI response never breaks the document.
function injectChartTemplates(html) {
  if (!html || typeof html !== 'string' || html.indexOf('CHART:') === -1) return html;
  return html.replace(/<!--\s*CHART:([a-zA-Z]+):([\s\S]*?)-->/g, function(match, type, paramString) {
    const svg = renderChartByType(type, paramString);
    return svg || match;
  });
}

// ===== PROMPT-FACING SPEC STRING =====
function getChartCatalogForPrompt() {
  return [
    'bar   — <!--CHART:bar:title=Optional Title|labels=A,B,C|values=10,25,15|unit=%|colors=#4f7df3,#22c55e-->',
    'line  — <!--CHART:line:title=Optional Title|labels=Jan,Feb,Mar|values=10,14,9-->',
    'pie   — <!--CHART:pie:title=Optional Title|labels=A,B,C|values=30,50,20-->',
    'donut — <!--CHART:donut:title=Optional Title|labels=A,B,C|values=30,50,20-->'
  ].join('\n      ');
}

// ============================================================
// WINDOW EXPOSURE — Chart Library
// ============================================================
window.injectChartTemplates = injectChartTemplates;
window.getChartCatalogForPrompt = getChartCatalogForPrompt;
window.renderChartByType = renderChartByType;
// Exposed so other modules (e.g. Slide Studio's native PPTX chart export)
// can parse a "<!--CHART:type:params-->" placeholder's raw DATA the same
// way this file does, instead of duplicating/forking the parsing rules.
window.parseChartParamString = parseChartParamString;