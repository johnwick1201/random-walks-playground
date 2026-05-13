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
  const r = await fetch(`templates/${name}?v=22`);
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

// Substitution dictionary for the Manim render templates.
function buildVars(state) {
  const isDil = state.algorithm === 'dil';
  const advList = [...state.adversaries].sort((a, b) => a - b);
  const edges = state.graph.edges;
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
  // graph_walks.py / graph_walks_create.py — one per algorithm. We ship only
  // the one matching the chosen algorithm; switching means re-exporting from
  // the playground.
  const isDil = state.algorithm === 'dil';
  const scriptName = isDil ? 'render_manimgl_dil.py' : 'render_manimgl_cil.py';
  const [gl, readme, req] = await Promise.all([
    fetchTemplate(scriptName),
    fetchTemplate('README.md'),
    fetchTemplate('requirements.txt'),
  ]);
  const vars = buildVars(state);
  const zip = createZip([
    { name: scriptName,            content: substitute(gl, vars) },
    { name: 'README.md',           content: substitute(readme, vars) },
    { name: 'requirements.txt',    content: req },
  ]);
  download('random_walks_animation.zip', zip);
}
