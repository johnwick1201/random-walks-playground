// render.js — static Canvas drawing for the graphics pane.
// Animation logic comes in a later slice.

// Two visual modes:
//   - 'setup'    → high-contrast for inputting/reviewing the configuration.
//                  Bright white nodes & edges, large numerals inside discs.
//   - 'playback' → matches the existing Manim MP4s. Grey discs, dim edges,
//                  no numerals (so the colored walker trails are the focus).
// Adversary red and start-node green are the same in both modes — those
// signals matter regardless of mode.
const THEMES = {
  setup: {
    bg:        '#000000',
    edge:      '#ffffff',  // bright white
    edgeWidth: 1.5,
    node:      '#ffffff',  // white circles
    nodeText:  '#000000',
    showText:  true,
    radiusScale: 0.25,     // slightly larger than playback so numerals fit comfortably
    stub:      '#cccccc',  // bright-but-distinct dashed stubs
  },
  playback: {
    bg:        '#000000',
    edge:      '#444444',  // ManimGL GREY_D
    edgeWidth: 1.2,
    node:      '#888888',  // ManimGL GREY_C
    nodeText:  '#000000',
    showText:  false,      // numerals hidden so trails read clearly (matches Manim)
    radiusScale: 0.18,     // ManimGL's `spacing * 0.18`
    stub:      '#444444',
  },
};
const ADV_COL          = '#fc6255';  // ManimGL RED — adversary nodes
const START_COL        = '#83c167';  // ManimGL GREEN_C — starting node
const HIGHLIGHT_RADIUS_SCALE = 1.6;  // ManimGL: adversaries are 1.6× normal radius; start node matches
const STUB_LEN_SCALE   = 2.8;        // doubled from before so wrap stubs read clearly

// Stub length scale (exported so animate.js can reuse it for wrap-edge paths).
export const STUB_LEN_SCALE_EXPORT = STUB_LEN_SCALE;
export function computeNodeRadius(positions, N, mode = 'playback') {
  const scale = (THEMES[mode] || THEMES.playback).radiusScale;
  return nodeRadius(positions, N, scale);
}
export function computeStubLen(positions, N, mode = 'playback') {
  const r = computeNodeRadius(positions, N, mode);
  return Math.max(28, r * STUB_LEN_SCALE);
}

// ── set up canvas with devicePixelRatio for crisp rendering ──
export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // future draws use CSS pixels
  return { ctx, w: rect.width, h: rect.height };
}

// ── compute a node radius that fits the spacing ──
// Scale factor is theme-dependent: setup mode is larger to host numerals,
// playback mode matches ManimGL's 0.18 factor.
function nodeRadius(positions, N, scale) {
  if (N <= 1) return 22;
  let minD = Infinity;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < minD) minD = d;
    }
  }
  if (!isFinite(minD)) return 22;
  return Math.max(8, Math.min(28, minD * scale));
}

// ── draw the static graph view (+ optional walker trails) ──
// graph: { N, positions, edges } — edges have optional wrap = 'h'|'v'|null.
// state: { adversaries: Set<int>, startNode: int|null, mode: 'setup'|'playback',
//          trails?: [{a:{x,y}, b:{x,y}, color:'#...'}, ...] }
// In setup mode, start node is drawn green for clarity. In playback mode it
// reverts to the grey of the regular nodes — matching Manim, where walker
// colors come from the edge trails rather than the starting node.
export function drawGraph(canvas, graph, state = {}) {
  const { ctx, w, h } = fitCanvas(canvas);
  const { N, positions, edges } = graph;
  if (typeof N !== 'number') {
    console.error('[render] graph.N missing or not a number:', graph);
    return;
  }
  const advs = state.adversaries || new Set();
  const start = state.startNode ?? null;
  const theme = THEMES[state.mode] || THEMES.setup;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const r = nodeRadius(positions, N, theme.radiusScale);

  // edges
  ctx.lineWidth = theme.edgeWidth;
  ctx.strokeStyle = theme.edge;
  for (const e of edges) {
    const a = positions[e.u], b = positions[e.v];
    if (!e.wrap) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      drawWrapStubs(ctx, a, b, e.wrap, r, theme);
    }
  }

  // walker trails (playback mode only)
  if (state.trails && state.trails.length) {
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const t of state.trails) {
      ctx.strokeStyle = t.color;
      ctx.beginPath();
      ctx.moveTo(t.a.x, t.a.y);
      ctx.lineTo(t.b.x, t.b.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // nodes
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < N; i++) {
    const p = positions[i];
    const isAdv = advs.has(i);
    const isStart = i === start;
    const highlight = isAdv || (isStart && state.mode !== 'playback');
    const radius = highlight ? r * HIGHLIGHT_RADIUS_SCALE : r;
    const fontSize = Math.max(8, Math.round(radius * 0.85));

    // Start-node green is a setup-mode affordance only. During playback the
    // start node reverts to grey so the walker's color stands out instead.
    if (isStart && state.mode !== 'playback') ctx.fillStyle = START_COL;
    else if (isAdv) ctx.fillStyle = ADV_COL;
    else ctx.fillStyle = theme.node;

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (theme.showText) {
      ctx.font = `600 ${fontSize}px -apple-system, system-ui, sans-serif`;
      ctx.fillStyle = theme.nodeText;
      ctx.fillText(String(i + 1), p.x, p.y + 0.5);
    }
  }
}

// ── draw wrap-around stubs at boundary ──
// For a 'h' wrap: stubs extend right from the right-end node and left from
// the left-end node. For 'v': stubs extend down and up respectively.
function drawWrapStubs(ctx, a, b, wrap, r, theme) {
  const stubLen = Math.max(28, r * STUB_LEN_SCALE);
  ctx.save();
  ctx.strokeStyle = theme.stub;
  ctx.lineWidth = theme.edgeWidth;
  ctx.setLineDash([6, 4]);

  if (wrap === 'h') {
    const [right, left] = a.x > b.x ? [a, b] : [b, a];
    ctx.beginPath();
    ctx.moveTo(right.x, right.y);
    ctx.lineTo(right.x + stubLen, right.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(left.x - stubLen, left.y);
    ctx.stroke();
  } else if (wrap === 'v') {
    const [bottom, top] = a.y > b.y ? [a, b] : [b, a];
    ctx.beginPath();
    ctx.moveTo(bottom.x, bottom.y);
    ctx.lineTo(bottom.x, bottom.y + stubLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x, top.y - stubLen);
    ctx.stroke();
  }
  ctx.restore();
}

export const THEMES_EXPORT = THEMES;
