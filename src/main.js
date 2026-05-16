// main.js — UI wiring (slice 1: graph spec → live render)

import { buildGraph, layout, positions, adjacency, mkRng } from './graph.js?v=40';
import { drawGraph } from './render.js?v=40';
import { parseGraphML } from './graphml.js?v=40';
import { simulate } from './sim.js?v=40';
import { drawWalkerPlot, PLOT_PADDING } from './plot.js?v=40';
import { Player } from './animate.js?v=40';
import { exportPlotPNG, exportCsv, exportManimZip, exportGraphML } from './export.js?v=40';

console.log('[playground] main.js v3 loaded');

// ── state ──
const state = {
  // graph
  N: 100,
  topology: 'grid',
  p: 0.10,
  seed: 11,
  graph: null,
  uploaded: false,
  // adversaries — default to random selection so the user lands on a fully
  // configured scenario they can just click Simulate on.
  advMode: 'random',       // 'list' | 'random'
  advListRaw: '',          // raw text in the CSV input
  advCount: 10,            // M (used in random mode)
  advSeed: 123456789,
  adversaries: new Set(),  // 0-indexed Set<number>
  // algorithm
  algorithm: 'dil',        // '' | 'dil' | 'cil'
  threshold: 3,            // strictly positive integer
  pcreate: 0.10,           // real in [0, 1]
  // start
  startMode: 'farthest',   // '' | 'manual' | 'random' | 'farthest'
  startIdRaw: 1,           // 1-indexed value from manual input
  startSeed: 11,
  startNode: null,         // 0-indexed (or null if not set)
  // time
  T: 500,                  // positive integer
  // simulation result
  simResult: null,         // last simulate() output, or null
};

// ── DOM refs ──
const el = (id) => document.getElementById(id);
const canvas = el('canvas');
const overlay = el('overlay');
const overlayTitle = el('overlay-title');
const overlayMsg = el('overlay-msg');
const N_input = el('N');
const topology = el('topology');
const topologyHint = el('topology-hint');
const rowP = el('row-p');
const pSlider = el('p-slider');
const pInput = el('p');
const rowSeed = el('row-seed');
const seedInput = el('seed');
const regenBtn = el('regen-graph');
const upload = el('upload');

// adversary controls
const advMode = el('adv-mode');
const rowAdvList = el('row-adv-list');
const advList = el('adv-list');
const rowAdvCount = el('row-adv-count');
const advCount = el('adv-count');
const rowAdvSeed = el('row-adv-seed');
const advSeed = el('adv-seed');
const regenAdvBtn = el('regen-adv');
const advEcho = el('adv-echo');

// algorithm controls
const algorithmSel = el('algorithm');
const rowThreshold = el('row-threshold');
const thresholdInput = el('threshold');
const thresholdLabel = el('threshold-label');
const rowPcreate = el('row-pcreate');
const pcreateInput = el('pcreate');

// start-node controls
const startMode = el('start-mode');
const rowStartId = el('row-start-id');
const startId = el('start-id');
const rowStartSeed = el('row-start-seed');
const startSeedInput = el('start-seed');
const regenStartBtn = el('regen-start');
const startEcho = el('start-echo');

// time / simulate
const TInput = el('T');
const simulateBtn = el('simulate');
const simHint = el('sim-hint');
const plotArea = el('plot-area');

// player controls
const playerBar = el('player-bar');
const playerPlay = el('player-play');
const playerReplay = el('player-replay');
const playerEnd = el('player-end');
const playerSpeed = el('player-speed');
const playerTime = el('player-time');
const playerProgress = el('player-progress');
const playerProgressFill = el('player-progress-fill');
const hud = el('hud');
const hudT = el('hud-t');
const hudWalkers = el('hud-walkers');
let player = null;        // current Player instance, or null
let lastDrawnPlotT = -1;  // skip plot redraws when t hasn't advanced

// graphics-pane title elements
const paneTitle = el('pane-title');
const paneSubtitle = el('pane-subtitle');
const warningsDiv = el('warnings');

// ── error overlay: always names the offending input ──
// Errors are keyed by input name so each input can clear its OWN error without
// stomping unrelated errors from other fields.
const activeErrors = new Map(); // name → message
export function showError(inputName, message) {
  activeErrors.set(inputName, message);
  refreshOverlay();
}
export function clearError(inputName) {
  activeErrors.delete(inputName);
  refreshOverlay();
}
function refreshOverlay() {
  if (activeErrors.size === 0) {
    overlay.hidden = true;
  } else {
    const [name, msg] = activeErrors.entries().next().value;
    overlayTitle.textContent = `Invalid input on ${name}`;
    overlayMsg.textContent = msg;
    overlay.hidden = false;
  }
  // Any error change can flip the Simulate gate; refresh if button exists.
  if (typeof refreshSimulateButton === 'function') refreshSimulateButton();
}

// ── input validators ──
// Returns { ok: true, value } or { ok: false, error }. Empty string is treated
// as "user hasn't entered anything yet" → { ok: 'empty' } so the caller can
// skip both error display AND state update.
function validateInteger(raw, { min, max, name }) {
  if (raw === '' || raw == null) return { ok: 'empty' };
  const trimmed = String(raw).trim();
  // strict integer: optional sign, digits only — no decimals, no scientific notation
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, error: `${name} must be an integer (you entered "${raw}").` };
  }
  const v = parseInt(trimmed, 10);
  if (!Number.isFinite(v)) {
    return { ok: false, error: `${name} must be a finite integer.` };
  }
  if (min != null && v < min) {
    return { ok: false, error: `${name} must be at least ${min}.` };
  }
  if (max != null && v > max) {
    return { ok: false, error: `${name} must be at most ${max}.` };
  }
  return { ok: true, value: v };
}

// Block disallowed characters at the keystroke level. `disallowed` is a string
// of single chars to reject (e.g. ".,eE" for integer-only inputs). Backspace,
// arrow keys, etc. still work because `beforeinput.data` is null for those.
function blockChars(input, disallowed) {
  input.addEventListener('beforeinput', (e) => {
    if (e.data == null) return;
    for (const c of e.data) {
      if (disallowed.includes(c)) {
        e.preventDefault();
        return;
      }
    }
  });
}

// Parse a CSV list of node IDs (1-indexed in the input, 0-indexed in the
// returned array). Validates each token is a positive integer in [1, N],
// no duplicates. Returns same shape as the other validators.
function parseAdvCsv(raw, N) {
  if (raw == null || raw.trim() === '') return { ok: 'empty' };
  const tokens = raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
  if (tokens.length === 0) return { ok: 'empty' };
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (!/^\d+$/.test(t)) {
      return { ok: false, error: `"${t}" is not a positive integer.` };
    }
    const v = parseInt(t, 10);
    if (v < 1 || v > N) {
      return { ok: false, error: `${v} is out of range; must be between 1 and ${N}.` };
    }
    if (seen.has(v)) {
      return { ok: false, error: `${v} appears more than once.` };
    }
    seen.add(v);
    out.push(v - 1);
  }
  return { ok: true, value: out };
}

// Sample M distinct integers from [0, N) using a seeded PRNG.
function sampleUnique(N, M, rng) {
  const a = Array.from({ length: N }, (_, i) => i);
  for (let i = 0; i < M; i++) {
    const j = i + Math.floor(rng() * (N - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, M).sort((x, y) => x - y);
}

function validateNumber(raw, { min, max, name, exclusiveMin = false, exclusiveMax = false }) {
  if (raw === '' || raw == null) return { ok: 'empty' };
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) {
    return { ok: false, error: `${name} must be a number (you entered "${raw}").` };
  }
  if (min != null && (exclusiveMin ? v <= min : v < min)) {
    return { ok: false, error: `${name} must be ${exclusiveMin ? 'greater than' : 'at least'} ${min}.` };
  }
  if (max != null && (exclusiveMax ? v >= max : v > max)) {
    return { ok: false, error: `${name} must be ${exclusiveMax ? 'less than' : 'at most'} ${max}.` };
  }
  return { ok: true, value: v };
}

// ── topology hint text ──
// The ER hint computes the connectivity threshold ln(n)/n from the current N
// rather than quoting a fixed value, so it stays accurate as the user changes N.
const TOPOLOGY_HINTS = {
  grid: () => 'Each node is connected to its up/down/left/right neighbors (where they exist).',
  toroidal: () => 'Same as grid, but boundary nodes wrap to the opposite side (shown as dashed stubs).',
  er: (n) => {
    const thr = Math.log(n) / n;
    return `Each of the n(n−1)/2 possible edges is added independently with probability p. Once p > ln(n)/n = ${thr.toFixed(5)} (at n=${n}) the graph is almost-surely connected; below that you'll likely see isolated nodes.`;
  },
};

// ── show/hide rows based on topology ──
function updateTopologyVisibility() {
  rowP.hidden = topology.value !== 'er';
  rowSeed.hidden = topology.value !== 'er';
  refreshTopologyHint();
}

function refreshTopologyHint() {
  const make = TOPOLOGY_HINTS[topology.value];
  topologyHint.textContent = make ? make(state.N) : '';
}

// ── render: compute the graph and draw it ──
function render() {
  if (state.uploaded && state.graph) {
    // graph already built from upload
    drawGraph(canvas, state.graph, {
      adversaries: state.adversaries,
      startNode: state.startNode,
      mode: 'setup',
    });
    return;
  }
  // canvas has not been laid out yet at first call → use clientWidth/Height
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) {
    // canvas not visible yet; defer to next frame
    requestAnimationFrame(render);
    return;
  }
  state.graph = buildGraph({
    N: state.N,
    topology: state.topology,
    p: state.p,
    seed: state.seed,
    width: rect.width,
    height: rect.height,
  });
  drawGraph(canvas, state.graph, {
    adversaries: state.adversaries,
    startNode: state.startNode,
    mode: 'setup',
  });
}

// ── input wiring ──
// Stop disallowed characters at the keystroke layer so the validator only
// has to worry about range / empty, not malformed numbers.
blockChars(N_input, '.,eE-+');   // N: positive integer only
blockChars(seedInput, '.,eE');   // seed: any integer (negative OK)
blockChars(advCount, '.eE-+');   // M: non-negative integer
blockChars(advSeed,  '.,eE');    // adversary seed: any integer
blockChars(thresholdInput, '.,eE-+');  // threshold: strictly positive integer
blockChars(pcreateInput, 'eE,-+');     // pcreate: real in [0,1] — decimals OK
blockChars(startId, '.,eE-+');         // start ID: positive integer
blockChars(startSeedInput, '.,eE');    // start seed: any integer
blockChars(TInput, '.,eE-+');          // T: strictly positive integer
// CSV input: digits, commas, spaces. Letters and decimals blocked.
advList.addEventListener('beforeinput', (e) => {
  if (e.data == null) return;
  if (!/^[\d,\s]*$/.test(e.data)) e.preventDefault();
});

N_input.addEventListener('input', () => {
  const r = validateInteger(N_input.value, { min: 2, max: 100, name: 'Number of nodes (N)' });
  if (r.ok === true) {
    clearError('Number of nodes (N)');
    state.N = r.value;
    state.uploaded = false;
    upload.value = '';
    render();
    syncPaneTitle();         // subtitle reflects N
    refreshTopologyHint();   // ln(n)/n threshold depends on N
    recomputeAdversaries(); // adversary IDs may now be out of range; also re-runs start + warnings
  } else if (r.ok === 'empty') {
    clearError('Number of nodes (N)');
  } else {
    // The keystroke filter prevents non-digit characters, so this fires only
    // for legitimate out-of-range entries like "1" or "101".
    showError('Number of nodes (N)', r.error);
  }
});

topology.addEventListener('change', () => {
  state.topology = topology.value;
  updateTopologyVisibility();
  // Any error tied to a now-hidden ER-only input is stale; drop it so the
  // overlay doesn't keep complaining about a field that isn't visible.
  if (topology.value !== 'er') {
    clearError('p (edge probability)');
    clearError('Random seed');
  }
  state.uploaded = false;
  upload.value = '';
  render();
  recomputeStart();  // graph shape changed → reachability and farthest may change
});

// p slider + text input stay in sync, but the reflective update has to know
// which surface fired it: writing the normalized number back to the typed
// input mid-keystroke strips the trailing decimal ("0." → "0"), so a user
// typing "0.046" ends up with "46". `source` tells us which side to skip.
function applyP(v, source) {
  state.p = v;
  if (source !== 'slider') pSlider.value = String(v);
  if (source !== 'input')  pInput.value  = String(v);
  if (state.topology === 'er') {
    state.uploaded = false;
    upload.value = '';
    render();
    recomputeStart();
  }
}
pSlider.addEventListener('input', () => {
  clearError('p (edge probability)');
  applyP(parseFloat(pSlider.value), 'slider');
});
pInput.addEventListener('input', () => {
  const r = validateNumber(pInput.value, { min: 0, max: 1, name: 'p (edge probability)' });
  if (r.ok === true) {
    clearError('p (edge probability)');
    applyP(r.value, 'input');
  } else if (r.ok === 'empty') {
    clearError('p (edge probability)');
  } else {
    showError('p (edge probability)', r.error);
  }
});

seedInput.addEventListener('input', () => {
  const r = validateInteger(seedInput.value, { name: 'Random seed' });
  if (r.ok === true) {
    clearError('Random seed');
    state.seed = r.value;
    if (state.topology === 'er') {
      state.uploaded = false;
      upload.value = '';
      render();
      recomputeStart();
    }
  } else if (r.ok === 'empty') {
    clearError('Random seed');
  } else {
    showError('Random seed', r.error);
  }
});

regenBtn.addEventListener('click', () => {
  state.seed = Math.floor(Math.random() * 1e9);
  seedInput.value = String(state.seed);
  state.uploaded = false;
  upload.value = '';
  render();
  recomputeStart();
});

// ── adversary wiring ──
function updateAdvVisibility() {
  const isList = advMode.value === 'list';
  rowAdvList.hidden = !isList;
  rowAdvCount.hidden = isList;
  rowAdvSeed.hidden = isList;
}

function renderAdvEcho() {
  if (state.adversaries.size === 0) {
    advEcho.textContent = '';
    return;
  }
  const ids = [...state.adversaries].sort((a, b) => a - b).map(i => i + 1).join(', ');
  advEcho.innerHTML = `<span class="echo-label">Pac Man Nodes Are:</span>${ids}`;
}

// Recompute adversaries based on current mode + state.N. Called any time the
// graph size, mode, or any adversary input changes.
function recomputeAdversaries() {
  if (advMode.value === 'list') {
    const r = parseAdvCsv(state.advListRaw, state.N);
    if (r.ok === true) {
      clearError('Adversary list');
      state.adversaries = new Set(r.value);
    } else if (r.ok === 'empty') {
      clearError('Adversary list');
      state.adversaries = new Set();
    } else {
      showError('Adversary list', r.error);
      state.adversaries = new Set();
    }
  } else {
    // random mode
    const M = state.advCount;
    if (M > state.N) {
      showError('Number of adversaries (M)', `M must be at most N (${state.N}).`);
      state.adversaries = new Set();
    } else {
      clearError('Number of adversaries (M)');
      const rng = mkRng(state.advSeed);
      state.adversaries = new Set(sampleUnique(state.N, M, rng));
    }
  }
  renderAdvEcho();
  syncPaneTitle();  // subtitle reflects # of Pac-Mans
  render();
  recomputeStart(); // adversaries changed → start node + warnings may shift
}

advMode.addEventListener('change', () => {
  state.advMode = advMode.value;
  updateAdvVisibility();
  // Drop errors tied to the mode we're leaving so the overlay doesn't keep
  // showing a complaint for a hidden field.
  if (advMode.value !== 'list')   clearError('Adversary list');
  if (advMode.value !== 'random') {
    clearError('Number of adversaries (M)');
    clearError('Adversary seed');
  }
  recomputeAdversaries();
});

advList.addEventListener('input', () => {
  state.advListRaw = advList.value;
  recomputeAdversaries();
});

advCount.addEventListener('input', () => {
  const r = validateInteger(advCount.value, { min: 0, max: 100, name: 'Number of adversaries (M)' });
  if (r.ok === true) {
    clearError('Number of adversaries (M)');
    state.advCount = r.value;
    recomputeAdversaries();
  } else if (r.ok === 'empty') {
    clearError('Number of adversaries (M)');
  } else {
    showError('Number of adversaries (M)', r.error);
  }
});

advSeed.addEventListener('input', () => {
  const r = validateInteger(advSeed.value, { name: 'Adversary seed' });
  if (r.ok === true) {
    clearError('Adversary seed');
    state.advSeed = r.value;
    recomputeAdversaries();
  } else if (r.ok === 'empty') {
    clearError('Adversary seed');
  } else {
    showError('Adversary seed', r.error);
  }
});

regenAdvBtn.addEventListener('click', () => {
  state.advSeed = Math.floor(Math.random() * 1e9);
  advSeed.value = String(state.advSeed);
  recomputeAdversaries();
});

// ── warning system (non-blocking; coexists with error overlay) ──
const activeWarnings = new Map();
function showWarning(key, message) {
  activeWarnings.set(key, message);
  refreshWarnings();
}
function clearWarning(key) {
  activeWarnings.delete(key);
  refreshWarnings();
}
function refreshWarnings() {
  warningsDiv.innerHTML = '';
  for (const msg of activeWarnings.values()) {
    const div = document.createElement('div');
    div.className = 'warning';
    div.textContent = `⚠ ${msg}`;
    warningsDiv.appendChild(div);
  }
}

// ── start-node logic ──
function farthestFromAdversaries(N, adj, advs) {
  if (advs.size === 0) {
    // No adversaries → any non-adversary works; pick node 0.
    return 0;
  }
  const dist = new Array(N).fill(Infinity);
  const q = [];
  for (const a of advs) { dist[a] = 0; q.push(a); }
  // BFS (shift is O(n) but N≤100 so trivial)
  let head = 0;
  while (head < q.length) {
    const u = q[head++];
    for (const v of adj[u]) {
      if (dist[v] > dist[u] + 1) { dist[v] = dist[u] + 1; q.push(v); }
    }
  }
  let best = -1, bestD = -1;
  for (let i = 0; i < N; i++) {
    if (advs.has(i)) continue;
    if (dist[i] === Infinity) continue;
    if (dist[i] > bestD) { bestD = dist[i]; best = i; }
  }
  if (best < 0) {
    // All non-adversaries are unreachable from any adversary; pick first non-adv.
    for (let i = 0; i < N; i++) if (!advs.has(i)) return i;
    return 0;
  }
  return best;
}

function randomStartNode(N, advs, seed) {
  const candidates = [];
  for (let i = 0; i < N; i++) if (!advs.has(i)) candidates.push(i);
  if (candidates.length === 0) return 0;
  const rng = mkRng(seed);
  return candidates[Math.floor(rng() * candidates.length)];
}

function updateStartVisibility() {
  const m = startMode.value;
  rowStartId.hidden = m !== 'manual';
  rowStartSeed.hidden = m !== 'random';
}

function renderStartEcho() {
  if (state.startNode == null) { startEcho.textContent = ''; return; }
  startEcho.innerHTML = `<span class="echo-label">Starting Node Chosen as</span>Node ${state.startNode + 1}`;
}

// Recompute start node from current mode + adversaries + graph.
function recomputeStart() {
  if (!state.graph) return;
  const m = startMode.value;
  if (m === '') {
    state.startNode = null;
  } else if (m === 'manual') {
    const r = validateInteger(startId.value, { min: 1, max: state.N, name: 'Starting node ID' });
    if (r.ok === true) {
      clearError('Starting node ID');
      state.startNode = r.value - 1;
    } else if (r.ok === 'empty') {
      clearError('Starting node ID');
      state.startNode = null;
    } else {
      showError('Starting node ID', r.error);
      state.startNode = null;
    }
  } else if (m === 'random') {
    state.startNode = randomStartNode(state.N, state.adversaries, state.startSeed);
  } else if (m === 'farthest') {
    state.startNode = farthestFromAdversaries(state.N, state.graph.adj, state.adversaries);
  }
  renderStartEcho();
  recomputeWarnings();
  render();
  refreshSimulateButton();
}

// ── soft warnings (start-on-adversary, all-neighbors-adversaries, unreachable) ──
function recomputeWarnings() {
  if (state.startNode == null || !state.graph) {
    clearWarning('start-on-adv');
    clearWarning('all-neighbors-adv');
    clearWarning('unreachable-adv');
    return;
  }
  const s = state.startNode;
  const advs = state.adversaries;
  const adj = state.graph.adj;

  // 1. start IS an adversary
  if (advs.has(s)) {
    showWarning('start-on-adv', `Starting node (${s + 1}) is itself an adversary — walker is dead at t=0. Simulate anyway if you want.`);
  } else {
    clearWarning('start-on-adv');
  }

  // 2. all neighbors of start are adversaries
  const nbrs = adj[s] || [];
  if (nbrs.length > 0 && nbrs.every(n => advs.has(n))) {
    showWarning('all-neighbors-adv', `Every neighbor of starting node ${s + 1} is an adversary — the first step kills the walker.`);
  } else {
    clearWarning('all-neighbors-adv');
  }

  // 3. some adversaries unreachable from start (BFS from start, count reachable advs)
  if (advs.size > 0) {
    const seen = new Array(state.N).fill(false);
    seen[s] = true;
    const q = [s];
    let head = 0;
    let reachedAdvs = 0;
    while (head < q.length) {
      const u = q[head++];
      if (advs.has(u) && u !== s) reachedAdvs++;
      for (const v of adj[u]) {
        if (!seen[v]) { seen[v] = true; q.push(v); }
      }
    }
    const targetAdvs = advs.has(s) ? advs.size - 1 : advs.size;
    if (reachedAdvs < targetAdvs) {
      const missed = targetAdvs - reachedAdvs;
      showWarning('unreachable-adv', `${missed} of ${targetAdvs} adversaries are unreachable from start — walkers in this component never die.`);
    } else {
      clearWarning('unreachable-adv');
    }
  } else {
    clearWarning('unreachable-adv');
  }
}

// ── time-step input + Simulate gating ──
// Decide whether Simulate can fire. Returns a reason string when blocked, '' when OK.
function simulateBlockedReason() {
  if (activeErrors.size > 0) return 'Fix the input error above';
  if (!state.graph) return 'Set up a graph first';
  if (!state.algorithm) return 'Pick an algorithm';
  if (!Number.isInteger(state.threshold) || state.threshold < 1) return 'Enter a valid threshold';
  if (state.algorithm === 'cil' && !(state.pcreate >= 0 && state.pcreate <= 1)) return 'Enter a valid P[Create | Threshold Reached]';
  if (state.startNode == null) return 'Pick a starting node';
  if (!Number.isInteger(state.T) || state.T < 1) return 'Enter a valid T';
  return '';
}

function refreshSimulateButton() {
  const reason = simulateBlockedReason();
  simulateBtn.disabled = reason !== '';
  simHint.textContent = reason ? `Waiting on: ${reason}` : '';
  refreshExportButtons();
}

TInput.addEventListener('input', () => {
  const r = validateInteger(TInput.value, { min: 1, max: 10000, name: 'Number of time steps (T)' });
  if (r.ok === true) {
    clearError('Number of time steps (T)');
    state.T = r.value;
  } else if (r.ok === 'empty') {
    clearError('Number of time steps (T)');
    state.T = null;
  } else {
    showError('Number of time steps (T)', r.error);
    state.T = null;
  }
  refreshSimulateButton();
});

// Every Simulate run uses a fresh random seed so consecutive clicks produce
// independent samples (matches the user's request that re-clicking re-rolls).
simulateBtn.addEventListener('click', () => {
  if (simulateBlockedReason() !== '') return;
  const t0 = performance.now();
  state.simResult = simulate({
    N: state.N,
    adj: state.graph.adj,
    adversaries: state.adversaries,
    startNode: state.startNode,
    algorithm: state.algorithm,
    threshold: state.threshold,
    pcreate: state.pcreate,
    T: state.T,
    seed: Math.floor(Math.random() * 1e9),
  });
  const dt = (performance.now() - t0).toFixed(1);
  console.log(`[simulate] ${state.algorithm.toUpperCase()} ran in ${dt}ms, peak=${state.simResult.peak}, extinct=${state.simResult.extinctAt}`);
  drawWalkerPlot(plotArea, state.simResult);
  startPlayback();
  refreshExportButtons();   // enable Plot/CSV now that simResult exists
});

// ── playback wiring ──
function startPlayback() {
  if (player) player.destroy();
  playerBar.hidden = false;
  hud.hidden = false;
  lastDrawnPlotT = -1;
  // Tell the user the plot is scrubbable now that a simulation exists.
  plotArea.style.cursor = 'ew-resize';
  player = new Player({
    graph: state.graph,
    simResult: state.simResult,
    startNode: state.startNode,
    drawScene: (s) => {
      drawGraph(canvas, state.graph, {
        adversaries: state.adversaries,
        startNode: state.startNode,
        mode: 'playback',
        trails: s.trails,
      });
    },
    onTick: ({ t, tProgress, T, playing }) => {
      playerTime.textContent = `t = ${t} / ${T}`;
      playerPlay.textContent = playing ? '⏸' : '▶';
      const pct = T > 0 ? ((t + (tProgress || 0)) / T) * 100 : 0;
      playerProgressFill.style.width = `${Math.min(100, pct).toFixed(1)}%`;
      // HUD: t and walker count, mirroring the Manim upper-left HUD.
      const wc = state.simResult.walkerCount[t] ?? 0;
      hudT.textContent = t;
      hudWalkers.textContent = wc;
      // Plot marker: redraw only when t advances to an integer step.
      if (t !== lastDrawnPlotT) {
        drawWalkerPlot(plotArea, state.simResult, t);
        lastDrawnPlotT = t;
      }
    },
  });
  player.setSpeed(parseFloat(playerSpeed.value));
  player.play();
}

playerPlay.addEventListener('click', () => {
  if (!player) return;
  if (player.playing) player.pause(); else player.play();
});
playerReplay.addEventListener('click', () => player?.replay());
playerEnd.addEventListener('click', () => player?.jumpToEnd());
playerSpeed.addEventListener('change', () => player?.setSpeed(parseFloat(playerSpeed.value)));

// ── click-and-drag scrubbing ──
// Two surfaces are scrubbable: the player progress bar and the walker-count
// plot. The implementation uses Pointer Events (pointerdown/move/up) so the
// same code path handles mouse, touch, and pen on every modern browser.
//
// `setPointerCapture` on pointerdown locks all subsequent events for that
// pointer to the captured element — even when the finger or mouse leaves
// the element's box. That replaces the old window-level listeners and
// makes touch scrubbing work without bouncing the page.
let lastScrubMs = 0;

function attachScrubbing(element, computeT) {
  let scrubbing = false;
  let resumeAfter = false;
  let activePointerId = null;

  element.addEventListener('pointerdown', (ev) => {
    if (!player) return;
    ev.preventDefault();
    try { element.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    activePointerId = ev.pointerId;
    scrubbing = true;
    resumeAfter = player.playing;
    player.seekTo(computeT(ev.clientX));
    lastScrubMs = performance.now();
  });

  element.addEventListener('pointermove', (ev) => {
    if (!scrubbing || !player || ev.pointerId !== activePointerId) return;
    // Throttle to ~60Hz so very large T values don't backlog seeks.
    const now = performance.now();
    if (now - lastScrubMs < 16) return;
    lastScrubMs = now;
    player.seekTo(computeT(ev.clientX));
  });

  const endScrub = (ev) => {
    if (!scrubbing || ev.pointerId !== activePointerId) return;
    try { element.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    activePointerId = null;
    scrubbing = false;
    if (resumeAfter && player && player.t < player.T) player.play();
  };
  element.addEventListener('pointerup', endScrub);
  element.addEventListener('pointercancel', endScrub);
}

// Progress-bar geometry: the whole bar maps linearly to [0, T].
attachScrubbing(playerProgress, (clientX) => {
  const rect = playerProgress.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(frac * player.T);
});

// Plot geometry: only the inner area between the y-axis labels (padL) and
// the right margin (padR) maps to [0, T]. Clicks on the axis labels clamp
// to the nearest end.
attachScrubbing(plotArea, (clientX) => {
  const rect = plotArea.getBoundingClientRect();
  const innerW = rect.width - PLOT_PADDING.L - PLOT_PADDING.R;
  if (innerW <= 0) return 0;
  const x = clientX - rect.left - PLOT_PADDING.L;
  const frac = Math.max(0, Math.min(1, x / innerW));
  return Math.round(frac * player.T);
});

// ── export buttons ──
// Each is gated on the same conditions as Simulate (graph + algorithm + start
// + valid params). The graph-only export needs just a graph.
const exportGraphBtn = el('export-graph');
const exportPlotBtn  = el('export-plot');
const exportCsvBtn   = el('export-csv');
const exportZipBtn   = el('export-zip');

function refreshExportButtons() {
  const fullReady = simulateBlockedReason() === '';
  // Graph export needs only a graph. Plot export needs a completed simulation
  // (we draw the cached result off-screen). Manim zip needs the full scenario.
  if (exportGraphBtn) exportGraphBtn.disabled = !state.graph || activeErrors.size > 0;
  if (exportPlotBtn)  exportPlotBtn.disabled  = !state.simResult;
  if (exportCsvBtn)   exportCsvBtn.disabled   = !state.simResult;
  if (exportZipBtn)   exportZipBtn.disabled   = !fullReady;
}

function safeExport(fn) {
  return async () => {
    try { await fn(state); }
    catch (err) {
      console.error(err);
      alert(`Export failed: ${err.message}`);
    }
  };
}

exportGraphBtn.addEventListener('click', safeExport(exportGraphML));
exportPlotBtn.addEventListener('click',  safeExport(exportPlotPNG));
exportCsvBtn.addEventListener('click',   safeExport(exportCsv));
exportZipBtn.addEventListener('click',   safeExport(exportManimZip));

// Hide the player bar (and tear down any running animation) when the user
// changes any input — the current simResult is now stale.
function invalidatePlayback() {
  if (player) { player.destroy(); player = null; }
  playerBar.hidden = true;
  hud.hidden = true;
  state.simResult = null;
  lastDrawnPlotT = -1;
  plotArea.style.cursor = '';
  refreshExportButtons();   // disable Plot/CSV now that simResult is gone
}
// Invalidate when any input that affects the SCENARIO changes (graph,
// adversaries, algorithm, start, time). Specifically NOT triggered by:
//   - Simulate     — its click is what builds the player we'd tear down
//   - Export buttons — they only trigger downloads, the scenario is unchanged
// Player controls (play/pause/speed/etc.) live outside .inputs, so they're
// excluded automatically.
['change', 'input'].forEach((ev) => {
  document.querySelectorAll('.inputs input, .inputs select').forEach((node) => {
    node.addEventListener(ev, invalidatePlayback);
  });
  document.querySelectorAll('.inputs button').forEach((node) => {
    if (node.id === 'simulate') return;
    if (node.id.startsWith('export-')) return;
    node.addEventListener('click', invalidatePlayback);
  });
});

// ── start input wiring ──
startMode.addEventListener('change', () => {
  state.startMode = startMode.value;
  updateStartVisibility();
  // Drop errors tied to inputs the new mode doesn't expose.
  if (startMode.value !== 'manual') clearError('Starting node ID');
  if (startMode.value !== 'random') clearError('Start seed');
  recomputeStart();
});
startId.addEventListener('input', () => recomputeStart());
startSeedInput.addEventListener('input', () => {
  const r = validateInteger(startSeedInput.value, { name: 'Start seed' });
  if (r.ok === true) {
    clearError('Start seed');
    state.startSeed = r.value;
    if (startMode.value === 'random') recomputeStart();
  } else if (r.ok === 'empty') {
    clearError('Start seed');
  } else {
    showError('Start seed', r.error);
  }
});
regenStartBtn.addEventListener('click', () => {
  state.startSeed = Math.floor(Math.random() * 1e9);
  startSeedInput.value = String(state.startSeed);
  recomputeStart();
});

// ── algorithm wiring + pane title/subtitle ──
const ALGO_TITLES = {
  dil: 'Duplicate If Late Algorithm',
  cil: 'Create If Late Algorithm',
};

function updateAlgoVisibility() {
  const alg = algorithmSel.value;
  rowThreshold.hidden = alg === '';
  rowPcreate.hidden = alg !== 'cil';
  if (alg === 'dil') thresholdLabel.textContent = 'Threshold for Duplication';
  else if (alg === 'cil') thresholdLabel.textContent = 'Threshold for Creation';
}

// Match the static title text drawn in the Manim videos.
function syncPaneTitle() {
  const alg = state.algorithm;
  if (!alg) {
    paneTitle.textContent = 'Graph Preview';
    paneSubtitle.textContent = '';
  } else {
    paneTitle.textContent = ALGO_TITLES[alg];
    const M = state.adversaries.size;
    const parts = [`N = ${state.N}`, `# of Pac-Mans = ${M}`];
    if (alg === 'dil') {
      parts.push(`Threshold for Duplication = ${state.threshold}`);
    } else if (alg === 'cil') {
      parts.push(`Threshold for Creation = ${state.threshold}`);
      parts.push(`P[Create | Threshold Reached] = ${state.pcreate}`);
    }
    paneSubtitle.textContent = parts.join(',   ');
  }
  refreshSimulateButton();
}

algorithmSel.addEventListener('change', () => {
  state.algorithm = algorithmSel.value;
  updateAlgoVisibility();
  // Drop errors tied to inputs the new algorithm doesn't expose.
  if (algorithmSel.value === '')    clearError('Threshold');
  if (algorithmSel.value !== 'cil') clearError('P[Create | Threshold Reached]');
  syncPaneTitle();
});

thresholdInput.addEventListener('input', () => {
  const r = validateInteger(thresholdInput.value, { min: 1, name: 'Threshold' });
  if (r.ok === true) {
    clearError('Threshold');
    state.threshold = r.value;
    syncPaneTitle();
  } else if (r.ok === 'empty') {
    clearError('Threshold');
  } else {
    showError('Threshold', r.error.replace('Threshold', state.algorithm === 'cil'
      ? 'Threshold for Creation'
      : 'Threshold for Duplication'));
  }
});

pcreateInput.addEventListener('input', () => {
  const r = validateNumber(pcreateInput.value, { min: 0, max: 1, name: 'P[Create | Threshold Reached]' });
  if (r.ok === true) {
    clearError('P[Create | Threshold Reached]');
    state.pcreate = r.value;
    syncPaneTitle();
  } else if (r.ok === 'empty') {
    clearError('P[Create | Threshold Reached]');
  } else {
    showError('P[Create | Threshold Reached]', r.error);
  }
});

// ── GraphML upload ──
upload.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseGraphML(text);
    state.N = parsed.N;
    N_input.value = String(parsed.N);
    state.uploaded = true;
    const rect = canvas.getBoundingClientRect();
    const layout_ = layout(parsed.N);
    const pos = positions(layout_, rect.width, rect.height);
    state.graph = {
      N: parsed.N,
      layout: layout_,
      positions: pos,
      edges: parsed.edges,
      adj: adjacency(parsed.N, parsed.edges),
    };
    render();
  } catch (err) {
    alert(`Could not load GraphML: ${err.message}`);
    upload.value = '';
  }
});

// ── window resize: redraw at new size ──
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 80);
});

// ── init ──
// Push every default from `state` into the corresponding DOM control so the
// page is fully configured the moment it loads. The user can click Simulate
// immediately — Quick Start without a button.
N_input.value        = String(state.N);
topology.value       = state.topology;
seedInput.value      = String(state.seed);
pSlider.value        = String(state.p);
pInput.value         = String(state.p);
advMode.value        = state.advMode;
advCount.value       = String(state.advCount);
advSeed.value        = String(state.advSeed);
algorithmSel.value   = state.algorithm;
thresholdInput.value = String(state.threshold);
pcreateInput.value   = String(state.pcreate);
startMode.value      = state.startMode;
startId.value        = String(state.startIdRaw);
startSeedInput.value = String(state.startSeed);
TInput.value         = String(state.T);

updateTopologyVisibility();
updateAdvVisibility();
updateAlgoVisibility();
updateStartVisibility();
syncPaneTitle();
render();                 // builds state.graph
recomputeAdversaries();   // generates 10 random adversaries + re-runs start/warnings
refreshSimulateButton();
refreshExportButtons();

// ── collapse-all / expand-all toggle ──
const collapseAllBtn = el('collapse-all');
function refreshCollapseLabel() {
  const groups = document.querySelectorAll('.inputs details.group');
  const allOpen = [...groups].every(d => d.open);
  collapseAllBtn.textContent = allOpen ? 'Collapse all' : 'Expand all';
}
collapseAllBtn.addEventListener('click', () => {
  const groups = document.querySelectorAll('.inputs details.group');
  const allOpen = [...groups].every(d => d.open);
  groups.forEach(d => { d.open = !allOpen; });
  refreshCollapseLabel();
});
document.querySelectorAll('.inputs details.group').forEach(d => {
  d.addEventListener('toggle', refreshCollapseLabel);
});
refreshCollapseLabel();
