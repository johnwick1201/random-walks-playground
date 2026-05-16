// graph.js — graph layout + generators

// ── seeded PRNG (Mulberry32): deterministic, simple, no library needed ──
export function mkRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── layout: place N nodes per the spec ──
// cols = floor(sqrt(N)); rows fill left-to-right top-to-bottom;
// last row may be partial.
export function layout(N) {
  const cols = Math.max(1, Math.floor(Math.sqrt(N)));
  const fullRows = Math.floor(N / cols);
  const partial = N % cols;
  const rows = fullRows + (partial > 0 ? 1 : 0);
  const grid = []; // [{r, c}, ...] indexed by node id (0-based)
  for (let i = 0; i < N; i++) {
    grid.push({ r: Math.floor(i / cols), c: i % cols });
  }
  return { N, cols, rows, fullRows, partial, grid };
}

// ── canvas positions for layout ──
// Returns positions in canvas pixel coords, centered with margin. On narrow
// canvases (mobile) the margin shrinks so the grid spreads further across
// the available height/width instead of cramming into the centre.
export function positions(layout_, width, height, margin) {
  if (margin === undefined) margin = width < 500 ? 20 : 40;
  const { N, cols, rows, grid } = layout_;
  const usableW = width - 2 * margin;
  const usableH = height - 2 * margin;
  // spread nodes evenly; if only one row/col, center it
  const dx = cols > 1 ? usableW / (cols - 1) : 0;
  const dy = rows > 1 ? usableH / (rows - 1) : 0;
  const offsetX = cols > 1 ? margin : width / 2;
  const offsetY = rows > 1 ? margin : height / 2;
  const pos = [];
  for (let i = 0; i < N; i++) {
    const { r, c } = grid[i];
    pos.push({ x: offsetX + c * dx, y: offsetY + r * dy });
  }
  return pos;
}

// ── grid (no wrap) edges ──
// Each node connects to right neighbor (same row) and below neighbor
// (same column). Skipped when neighbor doesn't exist (partial last row).
export function gridEdges(layout_) {
  const { N, cols, grid } = layout_;
  const edges = [];
  const idOf = new Map();
  for (let i = 0; i < N; i++) idOf.set(`${grid[i].r},${grid[i].c}`, i);
  for (let i = 0; i < N; i++) {
    const { r, c } = grid[i];
    const right = idOf.get(`${r},${c + 1}`);
    if (right !== undefined) edges.push({ u: i, v: right, wrap: null });
    const below = idOf.get(`${r + 1},${c}`);
    if (below !== undefined) edges.push({ u: i, v: below, wrap: null });
  }
  return edges;
}

// ── toroidal edges (grid + snake wrap-around) ──
// Wrap edges flagged with wrap = 'h' (horizontal) or 'v' (vertical) so
// the renderer can draw them as boundary stubs instead of long lines.
export function toroidalEdges(layout_) {
  const { N, cols, rows, grid } = layout_;
  const edges = gridEdges(layout_);
  const idOf = new Map();
  for (let i = 0; i < N; i++) idOf.set(`${grid[i].r},${grid[i].c}`, i);

  // horizontal wrap: per row, connect last existing column ↔ column 0
  for (let r = 0; r < rows; r++) {
    // find max column existing in this row
    let maxC = -1;
    for (let c = 0; c < cols; c++) {
      if (idOf.has(`${r},${c}`)) maxC = c;
    }
    if (maxC > 0) {
      const right = idOf.get(`${r},${maxC}`);
      const left = idOf.get(`${r},0`);
      // avoid duplicate when row has 1 node or wrap = direct neighbor
      if (right !== left && maxC > 1) {
        edges.push({ u: right, v: left, wrap: 'h' });
      }
    }
  }

  // vertical wrap: per column, connect last existing row ↔ row 0
  for (let c = 0; c < cols; c++) {
    let maxR = -1;
    for (let r = 0; r < rows; r++) {
      if (idOf.has(`${r},${c}`)) maxR = r;
    }
    if (maxR > 0) {
      const bottom = idOf.get(`${maxR},${c}`);
      const top = idOf.get(`0,${c}`);
      if (bottom !== top && maxR > 1) {
        edges.push({ u: bottom, v: top, wrap: 'v' });
      }
    }
  }
  return edges;
}

// ── Erdős–Rényi G(n, p) edges ──
export function erdosRenyiEdges(N, p, rng) {
  const edges = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (rng() < p) edges.push({ u: i, v: j, wrap: null });
    }
  }
  return edges;
}

// ── adjacency list from edges ──
export function adjacency(N, edges) {
  const adj = Array.from({ length: N }, () => []);
  for (const e of edges) {
    adj[e.u].push(e.v);
    adj[e.v].push(e.u);
  }
  return adj;
}

// ── dispatcher: build graph from inputs ──
// Returns { layout, positions, edges, adj }.
export function buildGraph({ N, topology, p, seed, width, height }) {
  const layout_ = layout(N);
  const pos = positions(layout_, width, height);
  let edges;
  if (topology === 'grid') {
    edges = gridEdges(layout_);
  } else if (topology === 'toroidal') {
    edges = toroidalEdges(layout_);
  } else if (topology === 'er') {
    const rng = mkRng(seed);
    edges = erdosRenyiEdges(N, p, rng);
  } else {
    throw new Error(`Unknown topology: ${topology}`);
  }
  return { N, layout: layout_, positions: pos, edges, adj: adjacency(N, edges) };
}
