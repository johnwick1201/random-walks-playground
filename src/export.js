// export.js — code generation + downloads.
// Fetches the Manim render templates in /templates, substitutes {{KEY}}
// placeholders with the current scenario, and triggers a file download.

import { serializeGraphML } from './graphml.js';
import { createZip } from './zip.js';
import { drawWalkerPlot } from './plot.js';

// ── helpers ──
function substitute(template, vars) {
  return template.replace(/{{(\w+)}}/g, (match, key) => {
    if (vars[key] === undefined) {
      console.warn(`[export] placeholder not substituted: ${key}`);
      return match;
    }
    return String(vars[key]);
  });
}

async function fetchTemplate(name) {
  // Cache-bust to match the rest of the site's "force fresh" policy.
  const r = await fetch(`templates/${name}?v=28`);
  if (!r.ok) throw new Error(`Failed to load template ${name}: HTTP ${r.status}`);
  return await r.text();
}

function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function topologyDesc(state) {
  if (state.uploaded) return 'Imported from a GraphML file';
  if (state.topology === 'grid')     return `Grid (no wrap), N=${state.N}`;
  if (state.topology === 'toroidal') return `Grid (toroidal / snake wrap), N=${state.N}`;
  if (state.topology === 'er')       return `Random (Erdős–Rényi, p=${state.p}), N=${state.N}`;
  return `N=${state.N}`;
}

// Serialize the per-step events the simulator already records, in a stripped
// form: drop `from` on moves (recoverable from walker state during playback)
// and drop `source` on spawns (purely metadata). Returns Python literals plus
// a total-character estimate so the export can warn on outsized payloads.
function buildEventStrings(events) {
  const moveLines = events.map(e =>
    `[${e.moves.map(m => `(${m.wid},${m.to})`).join(',')}]`).join(',\n  ');
  const killedLines = events.map(e =>
    `[${e.killed.join(',')}]`).join(',\n  ');
  const spawnedLines = events.map(e =>
    `[${e.spawned.map(s => `(${s.wid},${s.from})`).join(',')}]`).join(',\n  ');
  return {
    moveLines, killedLines, spawnedLines,
    size: moveLines.length + killedLines.length + spawnedLines.length,
  };
}

// Substitution dictionary for the Manim render templates.
function buildVars(state) {
  const isDil = state.algorithm === 'dil';
  const advList = [...state.adversaries].sort((a, b) => a - b);
  const edges = state.graph.edges;
  const ev = buildEventStrings(state.simResult.events);
  return {
    DATE: new Date().toISOString().slice(0, 10),
    ALGORITHM:         state.algorithm,
    ALGORITHM_LABEL:   isDil ? 'Duplicate-If-Late' : 'Create-If-Late',
    ALGORITHM_TITLE:   isDil ? 'Duplicate If Late Algorithm' : 'Create If Late Algorithm',
    TOPOLOGY_DESC:     topologyDesc(state),
    N:           state.N,
    NUM_EDGES:   edges.length,
    NUM_ADV:     advList.length,
    ADV_HUMAN:   advList.length === 0 ? '(none)' : advList.map(i => i + 1).join(', '),
    ADV_PY:      advList.length === 0 ? 'set()' : `{${advList.join(', ')}}`,
    EDGES_PY:    edges.map(e => `(${e.u}, ${e.v}, ${e.wrap ? `'${e.wrap}'` : 'None'})`).join(', '),
    START_NODE_PY:  state.startNode,
    START_HUMAN:    state.startNode + 1,
    A:           state.threshold,
    P_CREATE:    state.pcreate,
    T:           state.T,
    SEED:        state.seed,
    PEAK_WALKERS:   state.simResult.peak,
    EVENT_MOVES_LINES:   ev.moveLines,
    EVENT_KILLED_LINES:  ev.killedLines,
    EVENT_SPAWNED_LINES: ev.spawnedLines,
    _eventsSize:     ev.size,   // not substituted; read by the caller for the size guard
  };
}

// ── public exports ──

export function exportGraphML(state) {
  const xml = serializeGraphML({ N: state.N, edges: state.graph.edges });
  download('graph.graphml', xml, 'application/xml');
}

export function exportCsv(state) {
  if (!state.simResult) return;
  const counts = state.simResult.walkerCount;
  const lines = ['t,walker_count'];
  for (let t = 0; t < counts.length; t++) lines.push(`${t},${counts[t]}`);
  download('walker_count.csv', lines.join('\n') + '\n', 'text/csv');
}

// Render the walker-count plot to an off-screen canvas at high resolution
// (1600×600 CSS pixels × devicePixelRatio) and download the PNG. Off-screen
// rendering avoids picking up the "current t" marker from the live preview
// and gives a higher-resolution result than just grabbing the on-screen canvas.
export function exportPlotPNG(state) {
  if (!state.simResult) return;
  const W = 1600, H = 600;
  const container = document.createElement('div');
  container.style.cssText = `position:absolute;left:-9999px;top:0;width:${W}px;height:${H}px;background:#000;`;
  document.body.appendChild(container);
  try {
    drawWalkerPlot(container, state.simResult, null);
    const canvas = container.querySelector('canvas');
    canvas.toBlob((blob) => {
      try {
        if (blob) download('walker_count.png', blob);
      } finally {
        document.body.removeChild(container);
      }
    }, 'image/png');
  } catch (e) {
    document.body.removeChild(container);
    throw e;
  }
}

export async function exportManimZip(state) {
  // The Manim render scripts are direct adaptations of the user's existing
  // graph_walks.py / graph_walks_create.py — one per algorithm. They consume
  // the simulation's recorded events (moves, kills, spawns) so the local
  // render reproduces the exact run the user just saw in the browser.
  if (!state.simResult) {
    alert('Run Simulate first — the Manim package embeds the events from that run.');
    return;
  }
  const isDil = state.algorithm === 'dil';
  const scriptName = isDil ? 'render_manimgl_dil.py' : 'render_manimgl_cil.py';
  const vars = buildVars(state);

  // Guard rail: warn if the recorded events are unusually large. Typical
  // grid + DIL scenarios are well under 100 KB; only dense Create-If-Late
  // runs at high T push past a few MB. We don't block — we just inform.
  const sizeMB = vars._eventsSize / 1024 / 1024;
  if (sizeMB > 20) {
    const proceed = confirm(
      `Heads up: the events from this run encode to ${sizeMB.toFixed(1)} MB ` +
      `inside the downloaded script — this scenario is at the high end. The ` +
      `download will still work but the file will be large. Continue?`
    );
    if (!proceed) return;
  } else if (sizeMB > 5) {
    console.warn(`[export] Manim script will embed ~${sizeMB.toFixed(1)} MB of recorded events`);
  }

  const [gl, readme, req] = await Promise.all([
    fetchTemplate(scriptName),
    fetchTemplate('README.md'),
    fetchTemplate('requirements.txt'),
  ]);
  const zip = createZip([
    { name: scriptName,            content: substitute(gl, vars) },
    { name: 'README.md',           content: substitute(readme, vars) },
    { name: 'requirements.txt',    content: req },
  ]);
  download('random_walks_animation.zip', zip);
}
